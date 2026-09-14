import { env } from 'cloudflare:workers';
import {
  createScheduledController,
} from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  TAP_EMAIL_PROTOCOL_VERSION,
  type MailCommand,
} from '@tap-examples/tap-email-protocol';
import { createTapEmailCoordinator } from '../src/index';
import type { GoogleProviderPort } from '../src/provider';
import { sealSecret } from '../src/crypto';

const now = '2026-08-18T15:30:00.000Z';
const identity = async () => ({ profileId: 'profile_1' });

function command(
  overrides: Partial<MailCommand> = {},
): MailCommand {
  return {
    v: TAP_EMAIL_PROTOCOL_VERSION,
    commandId: 'cmd_1',
    idempotencyKey: 'tap-email:google_personal:cmd_1',
    accountId: 'google_personal',
    threadId: 'gmail_thread_1',
    kind: 'archive',
    createdAt: now,
    expectedProviderRevision: 'history_10',
    payload: {},
    ...overrides,
  };
}

function submit(body: MailCommand, profileId = 'profile_1'): Request {
  return new Request('https://coordinator.example/v1/commands', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:3000',
      'X-TAP-Test-Profile': profileId,
    },
    body: JSON.stringify(body),
  });
}

function fakeMessage(body: {
  profileId: string;
  accountId: string;
  commandId: string;
}) {
  const commandBody = { kind: 'command' as const, ...body };
  let disposition: 'none' | 'ack' | 'retry' = 'none';
  let delaySeconds = 0;
  const message = {
    id: 'queue_message_1',
    timestamp: new Date(now),
    body: commandBody,
    attempts: 1,
    ack() {
      disposition = 'ack';
    },
    retry(options?: QueueRetryOptions) {
      disposition = 'retry';
      delaySeconds = options?.delaySeconds ?? 0;
    },
  } satisfies Message<typeof commandBody>;
  return {
    message,
    result: () => ({ disposition, delaySeconds }),
  };
}

function batch(message: Message<ReturnType<typeof fakeMessage>['message']['body']>) {
  return {
    queue: 'tap-email-commands',
    messages: [message],
    metadata: {
      metrics: { backlogCount: 0, backlogBytes: 0 },
    },
    ackAll() {},
    retryAll() {},
  } satisfies MessageBatch<typeof message.body>;
}

async function seedThread(threadId = 'gmail_thread_1'): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO mail_threads
       (profile_id, account_id, thread_id, history_id, subject, snippet,
        participants_json, received_at, unread, starred, important,
        in_inbox, needs_response, waiting_on_others, label_ids_json, updated_at)
     VALUES ('profile_1', 'google_personal', ?, 'history_10', 'Launch review',
             'Please review', '[]', ?, 1, 0, 0, 1, 1, 0, '["INBOX","UNREAD"]', ?)`,
  )
    .bind(threadId, now, now)
    .run();
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM coordinator_audit'),
    env.DB.prepare('DELETE FROM provider_events'),
    env.DB.prepare('DELETE FROM tap_reminders'),
    env.DB.prepare('DELETE FROM scheduled_sends'),
    env.DB.prepare('DELETE FROM mail_messages'),
    env.DB.prepare('DELETE FROM mail_threads'),
    env.DB.prepare('DELETE FROM mail_commands'),
    env.DB.prepare('DELETE FROM google_credentials'),
    env.DB.prepare('DELETE FROM google_oauth_states'),
    env.DB.prepare('DELETE FROM google_accounts'),
  ]);
  for (const profileId of ['profile_1', 'profile_2']) {
    await env.DB.prepare(
      `INSERT INTO google_accounts
        (profile_id, account_id, google_subject, connection_state,
         coverage_state, unresolved_failures, created_at, updated_at)
       VALUES (?, 'google_personal', ?, 'active', 'current', 0, ?, ?)`,
    )
      .bind(profileId, `google_subject_${profileId}`, now, now)
      .run();
  }
});

describe('TAP Email coordinator command outbox', () => {
  it('persists stable intent before acknowledging the command', async () => {
    const worker = createTapEmailCoordinator({
      verifyAccess: identity,
      now: () => new Date(now),
    });
    const response = await worker.fetch(
      submit(command({ createdAt: '2026-08-18T15:29:00.000Z' })),
      env,
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      accepted: true,
      duplicate: false,
      receipt: {
        commandId: 'cmd_1',
        accountId: 'google_personal',
        state: 'accepted',
        acceptedAt: now,
      },
    });
    const row = await env.DB.prepare(
      `SELECT profile_id, account_id, command_id, idempotency_key,
              client_created_at, state, payload_json, payload_ciphertext
         FROM mail_commands WHERE profile_id = ? AND command_id = ?`,
    )
      .bind('profile_1', 'cmd_1')
      .first();
    expect(row).toEqual({
      profile_id: 'profile_1',
      account_id: 'google_personal',
      command_id: 'cmd_1',
      idempotency_key: 'tap-email:google_personal:cmd_1',
      client_created_at: '2026-08-18T15:29:00.000Z',
      state: 'accepted',
      payload_json: '{}',
      payload_ciphertext: expect.stringMatching(/^v2\./u),
    });
  });

  it('re-dispatches an identical accepted command when its first queue send was deferred', async () => {
    const worker = createTapEmailCoordinator({
      verifyAccess: identity,
      now: () => new Date(now),
    });
    expect((await worker.fetch(submit(command()), env)).status).toBe(202);
    await env.DB.prepare(
      `UPDATE mail_commands SET dispatch_pending = 1
        WHERE profile_id = ? AND command_id = ?`,
    ).bind('profile_1', 'cmd_1').run();

    const duplicate = await worker.fetch(submit(command()), env);

    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toMatchObject({
      accepted: true,
      duplicate: true,
    });
    expect(await env.DB.prepare(
      `SELECT state, dispatch_pending FROM mail_commands
        WHERE profile_id = ? AND command_id = ?`,
    ).bind('profile_1', 'cmd_1').first()).toEqual({
      state: 'accepted',
      dispatch_pending: 0,
    });
  });

  it('accepts a maximum-length multibyte draft beyond the former transport limit', async () => {
    const worker = createTapEmailCoordinator({
      verifyAccess: identity,
      now: () => new Date(now),
    });
    const response = await worker.fetch(submit(command({
      commandId: 'cmd_large_draft',
      idempotencyKey: 'tap-email:google_personal:cmd_large_draft',
      kind: 'save_draft',
      threadId: null,
      payload: {
        draftKey: 'draft_large',
        draftRevision: 1,
        to: 'maya@example.com',
        subject: 'Long but valid',
        bodyText: '🙂'.repeat(250_000),
      },
    })), env);

    expect(response.status).toBe(202);
    const stored = await env.DB.prepare(
      `SELECT payload_json, payload_ciphertext FROM mail_commands
        WHERE profile_id = ? AND command_id = ?`,
    ).bind('profile_1', 'cmd_large_draft').first<{
      payload_json: string;
      payload_ciphertext: string;
    }>();
    expect(stored?.payload_json).toBe('{}');
    expect(stored?.payload_ciphertext).toMatch(/^v2\./u);
    expect(JSON.stringify(stored)).not.toContain('Long but valid');
  });

  it('does not accept a send command before its local undo window expires', async () => {
    const worker = createTapEmailCoordinator({
      verifyAccess: identity,
      now: () => new Date(now),
    });
    const response = await worker.fetch(submit(command({
      commandId: 'cmd_undo_send',
      idempotencyKey: 'tap-email:google_personal:cmd_undo_send',
      kind: 'send_draft',
      payload: {
        draftKey: 'draft_undo',
        draftRevision: 1,
        to: 'maya@example.com',
        subject: 'Wait',
        bodyText: 'This should still be undoable.',
        sendAfter: '2026-08-18T15:30:05.000Z',
      },
    })), env);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'send_not_ready' });
    expect(await env.DB.prepare(
      `SELECT command_id FROM mail_commands
        WHERE profile_id = ? AND command_id = ?`,
    ).bind('profile_1', 'cmd_undo_send').first()).toBeNull();
  });

  it('reads legacy scheduled payloads and lazily scrubs plaintext outbound data', async () => {
    const legacySchedule = JSON.stringify({
      draftKey: 'draft_legacy',
      draftRevision: 1,
      to: 'legacy@example.com',
      subject: 'Legacy subject',
      bodyText: 'Legacy command body',
      scheduledFor: '2026-08-19T15:30:00.000Z',
      cancelIfReply: false,
    });
    const legacyDraft = JSON.stringify({
      draftKey: 'draft_legacy',
      draftRevision: 1,
      to: 'legacy@example.com',
      subject: 'Legacy subject',
      bodyText: 'Legacy scheduled body',
    });
    const legacyCiphertext = await sealSecret(
      JSON.stringify({ legacy: 'ciphertext' }),
      env.GOOGLE_TOKEN_ENCRYPTION_KEY,
    );
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO mail_commands
           (profile_id, account_id, command_id, idempotency_key, kind, thread_id,
            expected_provider_revision, payload_json, state, dispatch_pending,
            client_created_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'schedule_send', NULL, NULL, ?, 'applied', 0, ?, ?, ?)`,
      ).bind(
        'profile_1',
        'google_personal',
        'cmd_legacy_schedule',
        'tap-email:google_personal:cmd_legacy_schedule',
        legacySchedule,
        now,
        now,
        now,
      ),
      env.DB.prepare(
        `INSERT INTO scheduled_sends
           (profile_id, account_id, schedule_command_id, thread_id, draft_key,
            draft_payload_json, due_at, cancel_if_reply, state, created_at, updated_at)
         VALUES (?, ?, ?, NULL, ?, ?, ?, 0, 'pending', ?, ?)`,
      ).bind(
        'profile_1',
        'google_personal',
        'cmd_legacy_schedule',
        'draft_legacy',
        legacyDraft,
        '2026-08-19T15:30:00.000Z',
        now,
        now,
      ),
      env.DB.prepare(
        `INSERT INTO mail_commands
           (profile_id, account_id, command_id, idempotency_key, kind, thread_id,
            expected_provider_revision, payload_json, payload_ciphertext, state,
            dispatch_pending, client_created_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'archive', NULL, NULL, '{}', ?, 'applied', 0, ?, ?, ?)`,
      ).bind(
        'profile_1',
        'google_personal',
        'cmd_legacy_ciphertext',
        'tap-email:google_personal:cmd_legacy_ciphertext',
        legacyCiphertext,
        now,
        now,
        now,
      ),
    ]);
    const worker = createTapEmailCoordinator({
      verifyAccess: identity,
      now: () => new Date(now),
    });

    const list = await worker.fetch(
      new Request('https://coordinator.example/v1/scheduled-sends'),
      env,
    );
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({
      scheduledSends: [{
        scheduleCommandId: 'cmd_legacy_schedule',
        to: 'legacy@example.com',
        subject: 'Legacy subject',
      }],
    });
    const scrubbedSchedule = await env.DB.prepare(
      `SELECT draft_payload_json, draft_payload_ciphertext FROM scheduled_sends
        WHERE profile_id = ? AND schedule_command_id = ?`,
    ).bind('profile_1', 'cmd_legacy_schedule').first<{
      draft_payload_json: string;
      draft_payload_ciphertext: string;
    }>();
    expect(scrubbedSchedule?.draft_payload_json).toBe('{}');
    expect(scrubbedSchedule?.draft_payload_ciphertext).toMatch(/^v2\./u);

    await worker.scheduled(
      createScheduledController({ cron: '*/5 * * * *' }),
      env,
    );
    const scrubbedCommand = await env.DB.prepare(
      `SELECT payload_json, payload_ciphertext FROM mail_commands
        WHERE profile_id = ? AND command_id = ?`,
    ).bind('profile_1', 'cmd_legacy_schedule').first<{
      payload_json: string;
      payload_ciphertext: string;
    }>();
    expect(scrubbedCommand?.payload_json).toBe('{}');
    expect(scrubbedCommand?.payload_ciphertext).toMatch(/^v2\./u);
    const resealedLegacyCiphertext = await env.DB.prepare(
      `SELECT payload_ciphertext FROM mail_commands
        WHERE profile_id = ? AND command_id = ?`,
    ).bind('profile_1', 'cmd_legacy_ciphertext').first<{
      payload_ciphertext: string;
    }>();
    expect(resealedLegacyCiphertext?.payload_ciphertext).toMatch(/^v2\./u);
    expect(JSON.stringify({ scrubbedSchedule, scrubbedCommand })).not.toContain('legacy@example.com');
  });

  it('rejects an outbound ciphertext copied to a different command row', async () => {
    let providerCalls = 0;
    const worker = createTapEmailCoordinator({
      verifyAccess: identity,
      provider: {
        async execute() {
          providerCalls += 1;
          return { outcome: 'acknowledged', providerRevision: null };
        },
      },
      now: () => new Date(now),
    });
    const source = command({
      commandId: 'cmd_ciphertext_source',
      idempotencyKey: 'tap-email:google_personal:cmd_ciphertext_source',
      kind: 'archive',
      payload: {},
    });
    const target = command({
      commandId: 'cmd_ciphertext_target',
      idempotencyKey: 'tap-email:google_personal:cmd_ciphertext_target',
      kind: 'trash',
      payload: {},
    });
    expect((await worker.fetch(submit(source), env)).status).toBe(202);
    expect((await worker.fetch(submit(target), env)).status).toBe(202);
    await env.DB.prepare(
      `UPDATE mail_commands
          SET payload_ciphertext = (
            SELECT payload_ciphertext FROM mail_commands
             WHERE profile_id = ? AND command_id = ?
          )
        WHERE profile_id = ? AND command_id = ?`,
    ).bind(
      'profile_1',
      source.commandId,
      'profile_1',
      target.commandId,
    ).run();

    const queued = fakeMessage({
      profileId: 'profile_1',
      accountId: 'google_personal',
      commandId: target.commandId,
    });
    await worker.queue(batch(queued.message), env);

    expect(providerCalls).toBe(0);
    expect(queued.result().disposition).toBe('retry');
    expect(await env.DB.prepare(
      `SELECT state, error_code FROM mail_commands
        WHERE profile_id = ? AND command_id = ?`,
    ).bind('profile_1', target.commandId).first()).toEqual({
      state: 'retryable',
      error_code: 'provider_transport_error',
    });
  });

  it('suppresses an exact replay and rejects changed intent', async () => {
    const worker = createTapEmailCoordinator({
      verifyAccess: identity,
      now: () => new Date(now),
    });
    expect((await worker.fetch(submit(command()), env)).status).toBe(202);
    const replay = await worker.fetch(submit(command()), env);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ duplicate: true });

    const conflict = await worker.fetch(
      submit(command({ kind: 'trash' })),
      env,
    );
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ error: 'idempotency_conflict' });
  });

  it('rejects an idempotency key reused under a different command ID', async () => {
    const worker = createTapEmailCoordinator({
      verifyAccess: identity,
      now: () => new Date(now),
    });
    expect((await worker.fetch(submit(command()), env)).status).toBe(202);

    const conflict = await worker.fetch(
      submit(command({ commandId: 'cmd_2' })),
      env,
    );
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ error: 'idempotency_conflict' });
  });

  it('partitions command reads by authenticated profile', async () => {
    const first = createTapEmailCoordinator({
      verifyAccess: identity,
      now: () => new Date(now),
    });
    expect((await first.fetch(submit(command()), env)).status).toBe(202);
    const second = createTapEmailCoordinator({
      verifyAccess: async () => ({ profileId: 'profile_2' }),
      now: () => new Date(now),
    });
    const response = await second.fetch(
      new Request('https://coordinator.example/v1/commands/cmd_1'),
      env,
    );
    expect(response.status).toBe(404);
  });

  it('applies a provider acknowledgement once through a leased command', async () => {
    const calls: MailCommand[] = [];
    const provider: GoogleProviderPort = {
      async execute(_scope, value) {
        calls.push(value);
        return { outcome: 'acknowledged', providerRevision: 'history_11' };
      },
    };
    const worker = createTapEmailCoordinator({
      verifyAccess: identity,
      provider,
      now: () => new Date(now),
    });
    expect((await worker.fetch(submit(command()), env)).status).toBe(202);
    const queued = fakeMessage({
      profileId: 'profile_1',
      accountId: 'google_personal',
      commandId: 'cmd_1',
    });
    await worker.queue(batch(queued.message), env);
    expect(queued.result()).toEqual({ disposition: 'ack', delaySeconds: 0 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      idempotencyKey: 'tap-email:google_personal:cmd_1',
      accountId: 'google_personal',
    });
    const row = await env.DB.prepare(
      `SELECT state, provider_revision, provider_acknowledged_at
         FROM mail_commands WHERE profile_id = ? AND command_id = ?`,
    )
      .bind('profile_1', 'cmd_1')
      .first();
    expect(row).toEqual({
      state: 'applied',
      provider_revision: 'history_11',
      provider_acknowledged_at: now,
    });
  });

  it('projects an acknowledged mark-read command into the mailbox snapshot', async () => {
    await seedThread();
    const provider: GoogleProviderPort = {
      async execute() {
        return { outcome: 'acknowledged', providerRevision: 'history_11' };
      },
    };
    const worker = createTapEmailCoordinator({
      verifyAccess: identity,
      provider,
      now: () => new Date(now),
    });
    const markRead = command({ kind: 'mark_read' });
    expect((await worker.fetch(submit(markRead), env)).status).toBe(202);
    const queued = fakeMessage({
      profileId: 'profile_1',
      accountId: 'google_personal',
      commandId: markRead.commandId,
    });
    await worker.queue(batch(queued.message), env);

    expect(queued.result().disposition).toBe('ack');
    expect(await env.DB.prepare(
      `SELECT history_id, unread, label_ids_json, updated_at
         FROM mail_threads
        WHERE profile_id = ? AND account_id = ? AND thread_id = ?`,
    ).bind('profile_1', 'google_personal', 'gmail_thread_1').first()).toEqual({
      history_id: 'history_11',
      unread: 0,
      label_ids_json: '["INBOX"]',
      updated_at: now,
    });
  });

  it('projects an acknowledged archive into Done before the next history sync', async () => {
    await seedThread();
    const provider: GoogleProviderPort = {
      async execute() {
        return { outcome: 'acknowledged', providerRevision: 'history_11' };
      },
    };
    const worker = createTapEmailCoordinator({
      verifyAccess: identity,
      provider,
      now: () => new Date(now),
    });
    const archive = command();
    expect((await worker.fetch(submit(archive), env)).status).toBe(202);
    const queued = fakeMessage({
      profileId: 'profile_1',
      accountId: 'google_personal',
      commandId: archive.commandId,
    });
    await worker.queue(batch(queued.message), env);

    expect(queued.result().disposition).toBe('ack');
    expect(await env.DB.prepare(
      `SELECT history_id, in_inbox, needs_response, waiting_on_others,
              label_ids_json, updated_at
         FROM mail_threads
        WHERE profile_id = ? AND account_id = ? AND thread_id = ?`,
    ).bind('profile_1', 'google_personal', 'gmail_thread_1').first()).toEqual({
      history_id: 'history_11',
      in_inbox: 0,
      needs_response: 0,
      waiting_on_others: 0,
      label_ids_json: '["UNREAD"]',
      updated_at: now,
    });
  });

  it('projects an acknowledged mark-unread command into cached labels', async () => {
    await seedThread();
    await env.DB.prepare(
      `UPDATE mail_threads SET unread = 0, label_ids_json = '["INBOX"]'
        WHERE profile_id = ? AND account_id = ? AND thread_id = ?`,
    ).bind('profile_1', 'google_personal', 'gmail_thread_1').run();
    const provider: GoogleProviderPort = {
      async execute() {
        return { outcome: 'acknowledged', providerRevision: null };
      },
    };
    const worker = createTapEmailCoordinator({
      verifyAccess: identity,
      provider,
      now: () => new Date(now),
    });
    const markUnread = command({ kind: 'mark_unread' });
    expect((await worker.fetch(submit(markUnread), env)).status).toBe(202);
    const queued = fakeMessage({
      profileId: 'profile_1',
      accountId: 'google_personal',
      commandId: markUnread.commandId,
    });
    await worker.queue(batch(queued.message), env);

    expect(queued.result().disposition).toBe('ack');
    const firstProjection = await env.DB.prepare(
      `SELECT history_id, unread, label_ids_json
         FROM mail_threads
        WHERE profile_id = ? AND account_id = ? AND thread_id = ?`,
    ).bind('profile_1', 'google_personal', 'gmail_thread_1').first<{
      history_id: string;
      unread: number;
      label_ids_json: string;
    }>();
    expect(firstProjection).toEqual({
      history_id: 'history_10',
      unread: 1,
      label_ids_json: '["INBOX","UNREAD"]',
    });
  });

  it('reclaims an expired command lease after a worker interruption', async () => {
    const calls: MailCommand[] = [];
    const provider: GoogleProviderPort = {
      async execute(_scope, value) {
        calls.push(value);
        return { outcome: 'acknowledged', providerRevision: 'history_12' };
      },
    };
    const worker = createTapEmailCoordinator({
      verifyAccess: identity,
      provider,
      now: () => new Date(now),
    });
    expect((await worker.fetch(submit(command()), env)).status).toBe(202);
    await env.DB.prepare(
      `UPDATE mail_commands
          SET state = 'leased', lease_token = 'abandoned',
              lease_expires_at = ?, dispatch_pending = 0
        WHERE profile_id = ? AND command_id = ?`,
    )
      .bind('2026-08-18T15:29:59.000Z', 'profile_1', 'cmd_1')
      .run();

    const queued = fakeMessage({
      profileId: 'profile_1',
      accountId: 'google_personal',
      commandId: 'cmd_1',
    });
    await worker.queue(batch(queued.message), env);

    expect(queued.result().disposition).toBe('ack');
    expect(calls).toHaveLength(1);
    expect(
      await env.DB.prepare(
        `SELECT state, provider_revision FROM mail_commands
          WHERE profile_id = ? AND command_id = ?`,
      )
        .bind('profile_1', 'cmd_1')
        .first(),
    ).toEqual({ state: 'applied', provider_revision: 'history_12' });
  });

  it('fences a late provider result after another worker reclaims the command lease', async () => {
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>(resolve => {
      markFirstStarted = resolve;
    });
    const holdFirst = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });
    let calls = 0;
    const provider: GoogleProviderPort = {
      async execute() {
        calls += 1;
        if (calls === 1) {
          markFirstStarted();
          await holdFirst;
          return { outcome: 'failed', errorCode: 'late_failure' };
        }
        return { outcome: 'acknowledged', providerRevision: 'history_new_owner' };
      },
    };
    const worker = createTapEmailCoordinator({
      verifyAccess: identity,
      provider,
      now: () => new Date(now),
    });
    expect((await worker.fetch(submit(command()), env)).status).toBe(202);
    const first = fakeMessage({
      profileId: 'profile_1',
      accountId: 'google_personal',
      commandId: 'cmd_1',
    });
    const firstRun = worker.queue(batch(first.message), env);
    await firstStarted;
    await env.DB.prepare(
      `UPDATE mail_commands SET lease_expires_at = ?
        WHERE profile_id = ? AND command_id = ? AND state = 'leased'`,
    ).bind('2026-08-18T15:29:59.000Z', 'profile_1', 'cmd_1').run();

    const replacement = fakeMessage({
      profileId: 'profile_1',
      accountId: 'google_personal',
      commandId: 'cmd_1',
    });
    await worker.queue(batch(replacement.message), env);
    releaseFirst();
    await firstRun;

    expect(calls).toBe(2);
    expect(replacement.result().disposition).toBe('ack');
    expect(first.result().disposition).toBe('ack');
    expect(await env.DB.prepare(
      `SELECT state, provider_revision, error_code FROM mail_commands
        WHERE profile_id = ? AND command_id = ?`,
    ).bind('profile_1', 'cmd_1').first()).toEqual({
      state: 'applied',
      provider_revision: 'history_new_owner',
      error_code: null,
    });
  });

  it('serializes autosave and send mutations for the same provider draft key', async () => {
    let releaseAutosave!: () => void;
    let markAutosaveStarted!: () => void;
    const autosaveStarted = new Promise<void>(resolve => {
      markAutosaveStarted = resolve;
    });
    const holdAutosave = new Promise<void>(resolve => {
      releaseAutosave = resolve;
    });
    const calls: string[] = [];
    const provider: GoogleProviderPort = {
      async execute(_scope, value) {
        calls.push(value.kind);
        if (value.kind === 'save_draft') {
          markAutosaveStarted();
          await holdAutosave;
        }
        return { outcome: 'acknowledged', providerRevision: null };
      },
    };
    let clock = new Date(now);
    const worker = createTapEmailCoordinator({
      verifyAccess: identity,
      provider,
      now: () => clock,
    });
    const payload = {
      draftKey: 'draft_serialized',
      draftRevision: 1,
      to: 'maya@example.com',
      subject: 'Serialized draft',
      bodyText: 'Only one provider mutation may run at a time.',
    };
    const autosave = command({
      commandId: 'cmd_autosave_serialized',
      idempotencyKey: 'tap-email:google_personal:cmd_autosave_serialized',
      kind: 'save_draft',
      threadId: null,
      payload,
    });
    const send = command({
      commandId: 'cmd_send_serialized',
      idempotencyKey: 'tap-email:google_personal:cmd_send_serialized',
      kind: 'send_draft',
      threadId: null,
      payload: { ...payload, draftRevision: 2 },
    });
    expect((await worker.fetch(submit(autosave), env)).status).toBe(202);
    expect((await worker.fetch(submit(send), env)).status).toBe(202);

    const queuedAutosave = fakeMessage({
      profileId: 'profile_1',
      accountId: 'google_personal',
      commandId: autosave.commandId,
    });
    const autosaveRun = worker.queue(batch(queuedAutosave.message), env);
    await autosaveStarted;
    const queuedSend = fakeMessage({
      profileId: 'profile_1',
      accountId: 'google_personal',
      commandId: send.commandId,
    });
    await worker.queue(batch(queuedSend.message), env);

    expect(calls).toEqual(['save_draft']);
    expect(queuedSend.result().disposition).toBe('retry');
    expect(await env.DB.prepare(
      `SELECT state, error_code FROM mail_commands
        WHERE profile_id = ? AND command_id = ?`,
    ).bind('profile_1', send.commandId).first()).toEqual({
      state: 'retryable',
      error_code: 'provider_draft_busy',
    });

    releaseAutosave();
    await autosaveRun;
    clock = new Date('2026-08-18T15:30:05.000Z');
    const retriedSend = fakeMessage({
      profileId: 'profile_1',
      accountId: 'google_personal',
      commandId: send.commandId,
    });
    await worker.queue(batch(retriedSend.message), env);
    expect(calls).toEqual(['save_draft', 'send_draft']);
    expect(retriedSend.result().disposition).toBe('ack');
  });

  it('never retries an uncertain provider outcome blindly', async () => {
    const provider: GoogleProviderPort = {
      async execute() {
        return { outcome: 'uncertain', errorCode: 'provider_timeout_after_write' };
      },
    };
    const worker = createTapEmailCoordinator({
      verifyAccess: identity,
      provider,
      now: () => new Date(now),
    });
    expect((await worker.fetch(submit(command()), env)).status).toBe(202);
    const queued = fakeMessage({
      profileId: 'profile_1',
      accountId: 'google_personal',
      commandId: 'cmd_1',
    });
    await worker.queue(batch(queued.message), env);
    expect(queued.result().disposition).toBe('ack');
    expect(
      await env.DB.prepare(
        `SELECT state, error_code FROM mail_commands
          WHERE profile_id = ? AND command_id = ?`,
      )
        .bind('profile_1', 'cmd_1')
        .first(),
    ).toEqual({
      state: 'uncertain',
      error_code: 'provider_timeout_after_write',
    });
  });

  it('reconciles an uncertain send under its original command identity', async () => {
    const calls: MailCommand[] = [];
    const provider: GoogleProviderPort = {
      async execute(_scope, value) {
        calls.push(value);
        return calls.length === 1
          ? { outcome: 'uncertain', errorCode: 'gmail_send_outcome_unknown' }
          : { outcome: 'acknowledged', providerRevision: 'history_sent' };
      },
    };
    const send = command({
      commandId: 'cmd_reconcile_send',
      idempotencyKey: 'tap-email:google_personal:cmd_reconcile_send',
      kind: 'send_draft',
      payload: {
        draftKey: 'draft_reconcile_send',
        draftRevision: 1,
        to: 'maya@example.com',
        subject: 'Original identity',
        bodyText: 'Reconcile this exact send.',
      },
    });
    const worker = createTapEmailCoordinator({
      verifyAccess: identity,
      provider,
      now: () => new Date(now),
    });
    expect((await worker.fetch(submit(send), env)).status).toBe(202);
    const queued = fakeMessage({
      profileId: 'profile_1',
      accountId: 'google_personal',
      commandId: send.commandId,
    });
    await worker.queue(batch(queued.message), env);
    expect(queued.result().disposition).toBe('ack');

    const response = await worker.fetch(new Request(
      `https://coordinator.example/v1/commands/${send.commandId}/reconcile`,
      { method: 'POST', headers: { Origin: 'http://localhost:3000' } },
    ), env);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      receipt: {
        commandId: send.commandId,
        state: 'applied',
        providerAcknowledgedAt: now,
      },
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      commandId: send.commandId,
      idempotencyKey: send.idempotencyKey,
    });
    expect(calls[1]).toEqual(calls[0]);
  });

  it('keeps a transient reconciliation failure terminal-uncertain', async () => {
    let call = 0;
    const send = command({
      commandId: 'cmd_reconcile_unavailable',
      idempotencyKey: 'tap-email:google_personal:cmd_reconcile_unavailable',
      kind: 'send_draft',
      payload: {
        draftKey: 'draft_reconcile_unavailable',
        draftRevision: 1,
        to: 'maya@example.com',
        subject: 'Still unknown',
        bodyText: 'Do not blindly retry.',
      },
    });
    const worker = createTapEmailCoordinator({
      verifyAccess: identity,
      provider: {
        async execute() {
          call += 1;
          return call === 1
            ? { outcome: 'uncertain', errorCode: 'gmail_send_outcome_unknown' }
            : { outcome: 'retryable', errorCode: 'google_transport_error' };
        },
      },
      now: () => new Date(now),
    });
    expect((await worker.fetch(submit(send), env)).status).toBe(202);
    const queued = fakeMessage({
      profileId: 'profile_1',
      accountId: 'google_personal',
      commandId: send.commandId,
    });
    await worker.queue(batch(queued.message), env);

    const response = await worker.fetch(new Request(
      `https://coordinator.example/v1/commands/${send.commandId}/reconcile`,
      { method: 'POST', headers: { Origin: 'http://localhost:3000' } },
    ), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      receipt: {
        commandId: send.commandId,
        state: 'uncertain',
        errorCode: 'google_transport_error',
      },
    });
    expect(await env.DB.prepare(
      `SELECT state, dispatch_pending FROM mail_commands
        WHERE profile_id = ? AND command_id = ?`,
    ).bind('profile_1', send.commandId).first()).toEqual({
      state: 'uncertain',
      dispatch_pending: 0,
    });
  });

  it('persists a provider-visible draft before dispatching a scheduled send', async () => {
    const calls: MailCommand[] = [];
    const provider: GoogleProviderPort = {
      async execute(_scope, value) {
        calls.push(value);
        return { outcome: 'acknowledged', providerRevision: null };
      },
    };
    const worker = createTapEmailCoordinator({
      verifyAccess: identity,
      provider,
      checkFreshReply: async () => false,
      now: () => new Date(now),
    });
    const schedule = command({
      commandId: 'cmd_schedule_1',
      idempotencyKey: 'tap-email:google_personal:cmd_schedule_1',
      kind: 'schedule_send',
      payload: {
        draftKey: 'draft_scheduled_1',
        draftRevision: 1,
        to: 'maya@example.com',
        subject: 'Launch review',
        bodyText: 'Following up.',
        scheduledFor: '2026-08-18T15:29:00.000Z',
        cancelIfReply: true,
      },
      createdAt: '2026-08-18T15:28:00.000Z',
    });
    expect((await worker.fetch(submit(schedule), env)).status).toBe(202);
    const queuedSchedule = fakeMessage({
      profileId: 'profile_1',
      accountId: 'google_personal',
      commandId: schedule.commandId,
    });
    await worker.queue(batch(queuedSchedule.message), env);

    expect(calls.map(value => value.kind)).toEqual(['schedule_send']);
    const storedSchedule = await env.DB.prepare(
      `SELECT state, due_at, cancel_if_reply, dispatch_command_id,
              draft_payload_json, draft_payload_ciphertext
         FROM scheduled_sends
        WHERE profile_id = ? AND schedule_command_id = ?`,
    ).bind('profile_1', schedule.commandId).first<{
      state: string;
      due_at: string;
      cancel_if_reply: number;
      dispatch_command_id: string | null;
      draft_payload_json: string;
      draft_payload_ciphertext: string;
    }>();
    expect(storedSchedule).toEqual({
      state: 'pending',
      due_at: '2026-08-18T15:29:00.000Z',
      cancel_if_reply: 1,
      dispatch_command_id: null,
      draft_payload_json: '{}',
      draft_payload_ciphertext: expect.stringMatching(/^v2\./u),
    });
    expect(JSON.stringify(storedSchedule)).not.toContain('maya@example.com');
    expect(JSON.stringify(storedSchedule)).not.toContain('Following up.');

    await worker.scheduled(
      createScheduledController({ cron: '*/5 * * * *' }),
      env,
    );
    const scheduled = await env.DB.prepare(
      `SELECT state, dispatch_command_id
         FROM scheduled_sends
        WHERE profile_id = ? AND schedule_command_id = ?`,
    ).bind('profile_1', schedule.commandId).first<{
      state: string;
      dispatch_command_id: string;
    }>();
    expect(scheduled?.state).toBe('enqueued');
    expect(scheduled?.dispatch_command_id).toMatch(/^scheduled_send_[0-9a-f]{64}$/u);
    const dispatched = await env.DB.prepare(
      `SELECT kind, state, payload_json, payload_ciphertext
         FROM mail_commands
        WHERE profile_id = ? AND command_id = ?`,
    ).bind('profile_1', scheduled!.dispatch_command_id).first<{
      kind: string;
      state: string;
      payload_json: string;
      payload_ciphertext: string;
    }>();
    expect(dispatched).toEqual({
      kind: 'send_draft',
      state: 'accepted',
      payload_json: '{}',
      payload_ciphertext: expect.stringMatching(/^v2\./u),
    });
    expect(JSON.stringify(dispatched)).not.toContain('maya@example.com');
    expect(JSON.stringify(dispatched)).not.toContain('Following up.');

    const queuedSend = fakeMessage({
      profileId: 'profile_1',
      accountId: 'google_personal',
      commandId: scheduled!.dispatch_command_id,
    });
    await worker.queue(batch(queuedSend.message), env);
    expect(calls.map(value => value.kind)).toEqual(['schedule_send', 'send_draft']);
    expect(await env.DB.prepare(
      `SELECT state, error_code FROM scheduled_sends
        WHERE profile_id = ? AND schedule_command_id = ?`,
    ).bind('profile_1', schedule.commandId).first()).toEqual({
      state: 'sent',
      error_code: null,
    });
  });

  it('uses a provider-fresh reply barrier from the original command time', async () => {
    const checks: Array<{
      profileId: string;
      accountId: string;
      threadId: string;
      after: string;
    }> = [];
    const calls: MailCommand[] = [];
    const schedule = command({
      commandId: 'cmd_schedule_reply_barrier',
      idempotencyKey: 'tap-email:google_personal:cmd_schedule_reply_barrier',
      kind: 'schedule_send',
      createdAt: '2026-08-18T15:20:00.000Z',
      payload: {
        draftKey: 'draft_reply_barrier',
        draftRevision: 1,
        to: 'maya@example.com',
        subject: 'Conditional follow-up',
        bodyText: 'Only send if there is no reply.',
        scheduledFor: '2026-08-18T15:29:00.000Z',
        cancelIfReply: true,
      },
    });
    const worker = createTapEmailCoordinator({
      verifyAccess: identity,
      provider: {
        async execute(_scope, value) {
          calls.push(value);
          return { outcome: 'acknowledged', providerRevision: null };
        },
      },
      checkFreshReply: async (_env, profileId, accountId, threadId, after) => {
        checks.push({ profileId, accountId, threadId, after });
        return true;
      },
      now: () => new Date(now),
    });
    expect((await worker.fetch(submit(schedule), env)).status).toBe(202);
    const queued = fakeMessage({
      profileId: 'profile_1',
      accountId: 'google_personal',
      commandId: schedule.commandId,
    });
    await worker.queue(batch(queued.message), env);

    await worker.scheduled(createScheduledController({ cron: '* * * * *' }), env);

    expect(checks).toEqual([{
      profileId: 'profile_1',
      accountId: 'google_personal',
      threadId: 'gmail_thread_1',
      after: '2026-08-18T15:20:00.000Z',
    }]);
    expect(calls.map(value => value.kind)).toEqual(['schedule_send']);
    expect(await env.DB.prepare(
      `SELECT state, error_code, dispatch_command_id FROM scheduled_sends
        WHERE profile_id = ? AND schedule_command_id = ?`,
    ).bind('profile_1', schedule.commandId).first()).toEqual({
      state: 'cancelled',
      error_code: 'reply_received',
      dispatch_command_id: null,
    });
  });

  it('keeps a conditional send pending when its fresh reply barrier fails', async () => {
    const schedule = command({
      commandId: 'cmd_schedule_reply_check_failure',
      idempotencyKey: 'tap-email:google_personal:cmd_schedule_reply_check_failure',
      kind: 'schedule_send',
      createdAt: '2026-08-18T15:20:00.000Z',
      payload: {
        draftKey: 'draft_reply_check_failure',
        draftRevision: 1,
        to: 'maya@example.com',
        subject: 'Conditional follow-up',
        bodyText: 'Do not send without the barrier.',
        scheduledFor: '2026-08-18T15:29:00.000Z',
        cancelIfReply: true,
      },
    });
    const worker = createTapEmailCoordinator({
      verifyAccess: identity,
      provider: {
        async execute() {
          return { outcome: 'acknowledged', providerRevision: null };
        },
      },
      checkFreshReply: async () => {
        throw new Error('provider unavailable');
      },
      now: () => new Date(now),
    });
    expect((await worker.fetch(submit(schedule), env)).status).toBe(202);
    const queued = fakeMessage({
      profileId: 'profile_1',
      accountId: 'google_personal',
      commandId: schedule.commandId,
    });
    await worker.queue(batch(queued.message), env);

    await worker.scheduled(createScheduledController({ cron: '* * * * *' }), env);

    expect(await env.DB.prepare(
      `SELECT state, error_code, dispatch_command_id FROM scheduled_sends
        WHERE profile_id = ? AND schedule_command_id = ?`,
    ).bind('profile_1', schedule.commandId).first()).toEqual({
      state: 'pending',
      error_code: 'reply_check_unavailable',
      dispatch_command_id: null,
    });
  });

  it('cancels a pending scheduled send without discarding its provider draft', async () => {
    let providerCalls = 0;
    const provider: GoogleProviderPort = {
      async execute() {
        providerCalls += 1;
        return { outcome: 'acknowledged', providerRevision: null };
      },
    };
    const worker = createTapEmailCoordinator({
      verifyAccess: identity,
      provider,
      now: () => new Date(now),
    });
    const schedule = command({
      commandId: 'cmd_schedule_cancel',
      idempotencyKey: 'tap-email:google_personal:cmd_schedule_cancel',
      kind: 'schedule_send',
      payload: {
        draftKey: 'draft_cancel_1',
        draftRevision: 1,
        to: 'maya@example.com',
        subject: 'Tomorrow',
        bodyText: 'This remains a draft.',
        scheduledFor: '2026-08-19T15:30:00.000Z',
        cancelIfReply: false,
      },
      createdAt: '2026-08-18T15:29:00.000Z',
    });
    expect((await worker.fetch(submit(schedule), env)).status).toBe(202);
    const queuedSchedule = fakeMessage({
      profileId: 'profile_1',
      accountId: 'google_personal',
      commandId: schedule.commandId,
    });
    await worker.queue(batch(queuedSchedule.message), env);

    const cancel = command({
      commandId: 'cmd_cancel_schedule',
      idempotencyKey: 'tap-email:google_personal:cmd_cancel_schedule',
      kind: 'cancel_scheduled_send',
      expectedProviderRevision: null,
      payload: { scheduledCommandId: schedule.commandId },
    });
    expect((await worker.fetch(submit(cancel), env)).status).toBe(202);
    const queuedCancel = fakeMessage({
      profileId: 'profile_1',
      accountId: 'google_personal',
      commandId: cancel.commandId,
    });
    await worker.queue(batch(queuedCancel.message), env);

    expect(providerCalls).toBe(1);
    expect(await env.DB.prepare(
      `SELECT state, error_code FROM scheduled_sends
        WHERE profile_id = ? AND schedule_command_id = ?`,
    ).bind('profile_1', schedule.commandId).first()).toEqual({
      state: 'cancelled',
      error_code: 'cancelled_by_user',
    });
  });

  it('lists only live schedules inside the authenticated profile partition', async () => {
    const schedule = command({
      commandId: 'cmd_schedule_list',
      idempotencyKey: 'tap-email:google_personal:cmd_schedule_list',
      kind: 'schedule_send',
      payload: {
        draftKey: 'draft_list_1',
        draftRevision: 1,
        to: 'maya@example.com',
        subject: 'Tomorrow',
        bodyText: 'Private body must not appear in the list.',
        scheduledFor: '2026-08-19T15:30:00.000Z',
        cancelIfReply: true,
      },
      createdAt: '2026-08-18T15:29:00.000Z',
    });
    const worker = createTapEmailCoordinator({
      verifyAccess: identity,
      provider: {
        async execute() {
          return { outcome: 'acknowledged', providerRevision: null };
        },
      },
      now: () => new Date(now),
    });
    expect((await worker.fetch(submit(schedule), env)).status).toBe(202);
    const queued = fakeMessage({
      profileId: 'profile_1',
      accountId: 'google_personal',
      commandId: schedule.commandId,
    });
    await worker.queue(batch(queued.message), env);

    const response = await worker.fetch(
      new Request('https://coordinator.example/v1/scheduled-sends'),
      env,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      scheduledSends: [{
        scheduleCommandId: schedule.commandId,
        accountId: 'google_personal',
        threadId: 'gmail_thread_1',
        draftKey: 'draft_list_1',
        to: 'maya@example.com',
        subject: 'Tomorrow',
        dueAt: '2026-08-19T15:30:00.000Z',
        cancelIfReply: true,
        state: 'pending',
        dispatchCommandId: null,
        errorCode: null,
      }],
    });
    expect(JSON.stringify(body)).not.toContain('Private body');

    const otherProfile = createTapEmailCoordinator({
      verifyAccess: async () => ({ profileId: 'profile_2' }),
    });
    const other = await otherProfile.fetch(
      new Request('https://coordinator.example/v1/scheduled-sends'),
      env,
    );
    expect(await other.json()).toEqual({ scheduledSends: [] });
  });

  it('returns account coverage without exposing Google identity data', async () => {
    const worker = createTapEmailCoordinator({ verifyAccess: identity });
    const response = await worker.fetch(
      new Request('https://coordinator.example/v1/accounts/coverage'),
      env,
    );
    const body = await response.json<{ accounts: unknown[] }>();
    expect(response.status).toBe(200);
    expect(body.accounts).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain('google_subject_profile_1');
  });

  it('requests view authority for reads and manage authority for mutations', async () => {
    const actions: string[] = [];
    const worker = createTapEmailCoordinator({
      verifyAccess: async (_request, _env, requiredAction) => {
        actions.push(requiredAction);
        return { profileId: 'profile_1' };
      },
      now: () => new Date(now),
    });

    expect((await worker.fetch(
      new Request('https://coordinator.example/v1/accounts/coverage'),
      env,
    )).status).toBe(200);
    expect((await worker.fetch(
      new Request('https://coordinator.example/v1/accounts/google_personal/sync', {
        method: 'POST',
        headers: { Origin: 'http://localhost:3000' },
      }),
      env,
    )).status).toBe(202);
    expect(actions).toEqual(['tap-email.view', 'tap-email.manage']);
  });

  it('starts a profile-bound Google OAuth flow with PKCE', async () => {
    const worker = createTapEmailCoordinator({
      verifyAccess: identity,
      now: () => new Date(now),
    });
    const response = await worker.fetch(
      new Request('https://coordinator.example/v1/accounts/google/connect', {
        method: 'POST',
        headers: { Origin: 'http://localhost:3000' },
      }),
      env,
    );
    expect(response.status).toBe(200);
    const body = await response.json<{ authorizationUrl: string }>();
    const authorization = new URL(body.authorizationUrl);
    expect(authorization.origin).toBe('https://accounts.google.com');
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorization.searchParams.get('scope')).toContain(
      'https://www.googleapis.com/auth/gmail.modify',
    );
    const rawState = authorization.searchParams.get('state');
    expect(rawState).toBeTruthy();
    const stored = await env.DB.prepare(
      `SELECT profile_id, state_hash, code_verifier_ciphertext
         FROM google_oauth_states`,
    ).first<{
      profile_id: string;
      state_hash: string;
      code_verifier_ciphertext: string;
    }>();
    expect(stored?.profile_id).toBe('profile_1');
    expect(stored?.state_hash).not.toBe(rawState);
    expect(stored?.code_verifier_ciphertext.startsWith('v1.')).toBe(true);
  });

  it('applies TAP reminders without calling Gmail', async () => {
    await seedThread();
    let providerCalls = 0;
    const provider: GoogleProviderPort = {
      async execute() {
        providerCalls += 1;
        return { outcome: 'failed', errorCode: 'provider_must_not_run' };
      },
    };
    const worker = createTapEmailCoordinator({
      verifyAccess: identity,
      provider,
      now: () => new Date(now),
    });
    const reminder = command({
      commandId: 'cmd_reminder',
      idempotencyKey: 'tap-email:google_personal:cmd_reminder',
      kind: 'create_reminder',
      payload: {
        reminderId: 'reminder_1',
        dueAt: '2026-08-19T12:00:00.000Z',
        condition: 'if_no_reply',
      },
    });
    expect((await worker.fetch(submit(reminder), env)).status).toBe(202);
    const queued = fakeMessage({
      profileId: 'profile_1',
      accountId: 'google_personal',
      commandId: 'cmd_reminder',
    });
    await worker.queue(batch(queued.message), env);

    expect(queued.result().disposition).toBe('ack');
    expect(providerCalls).toBe(0);
    expect(
      await env.DB.prepare(
        `SELECT reminder_id, condition, state FROM tap_reminders
          WHERE profile_id = ? AND reminder_id = ?`,
      )
        .bind('profile_1', 'reminder_1')
        .first(),
    ).toEqual({
      reminder_id: 'reminder_1',
      condition: 'if_no_reply',
      state: 'pending',
    });
  });

  it('rejects reminders for threads outside the authenticated account scope', async () => {
    let providerCalls = 0;
    const worker = createTapEmailCoordinator({
      verifyAccess: identity,
      provider: {
        async execute() {
          providerCalls += 1;
          return { outcome: 'acknowledged', providerRevision: null };
        },
      },
      now: () => new Date(now),
    });
    const reminder = command({
      commandId: 'cmd_missing_thread',
      idempotencyKey: 'tap-email:google_personal:cmd_missing_thread',
      threadId: 'missing_thread',
      kind: 'create_reminder',
      payload: {
        reminderId: 'reminder_missing',
        dueAt: '2026-08-19T12:00:00.000Z',
        condition: 'if_no_reply',
      },
    });
    expect((await worker.fetch(submit(reminder), env)).status).toBe(202);
    const queued = fakeMessage({
      profileId: 'profile_1',
      accountId: 'google_personal',
      commandId: reminder.commandId,
    });
    await worker.queue(batch(queued.message), env);

    expect(queued.result().disposition).toBe('ack');
    expect(providerCalls).toBe(0);
    expect(await env.DB.prepare(
      `SELECT state, error_code FROM mail_commands
        WHERE profile_id = ? AND command_id = ?`,
    ).bind('profile_1', reminder.commandId).first()).toEqual({
      state: 'failed',
      error_code: 'thread_not_found',
    });
  });

  it('returns a cloud mailbox snapshot partitioned by TAP profile', async () => {
    await env.DB.prepare(
      `UPDATE google_accounts
          SET email_address = 'zack@example.com', display_name = 'Zack',
              accent = '#74a7a1'
        WHERE profile_id = 'profile_1' AND account_id = 'google_personal'`,
    ).run();
    const worker = createTapEmailCoordinator({ verifyAccess: identity });
    const response = await worker.fetch(
      new Request('https://coordinator.example/v1/mailbox'),
      env,
    );
    expect(response.status).toBe(200);
    const body = await response.json<{
      mailbox: { accounts: Array<{ accountId: string; address: string }> };
    }>();
    expect(body.mailbox.accounts).toEqual([
      expect.objectContaining({
        accountId: 'google_personal',
        address: 'zack@example.com',
      }),
    ]);
    expect(JSON.stringify(body)).not.toContain('google_subject_profile_1');
  });

  it('serves mailbox continuation pages with an opaque cursor', async () => {
    await seedThread('gmail_thread_1');
    await seedThread('gmail_thread_2');
    const worker = createTapEmailCoordinator({ verifyAccess: identity });
    const firstResponse = await worker.fetch(
      new Request('https://coordinator.example/v1/mailbox?limit=1'),
      env,
    );
    expect(firstResponse.status).toBe(200);
    const first = await firstResponse.json<{
      mailbox: { threads: Array<{ threadId: string }> };
      pageInfo: { nextCursor: string | null };
    }>();
    expect(first.mailbox.threads.map(thread => thread.threadId)).toEqual(['gmail_thread_1']);
    expect(first.pageInfo.nextCursor).toEqual(expect.any(String));

    const secondResponse = await worker.fetch(
      new Request(
        `https://coordinator.example/v1/mailbox?limit=1&cursor=${encodeURIComponent(first.pageInfo.nextCursor!)}`,
      ),
      env,
    );
    expect(secondResponse.status).toBe(200);
    const second = await secondResponse.json<{
      mailbox: { threads: Array<{ threadId: string }> };
      pageInfo: { nextCursor: string | null };
    }>();
    expect(second.mailbox.threads.map(thread => thread.threadId)).toEqual(['gmail_thread_2']);
    expect(second.pageInfo.nextCursor).toBeNull();
  });

  it('rejects malformed mailbox pagination without querying another profile', async () => {
    const worker = createTapEmailCoordinator({ verifyAccess: identity });
    const cursorResponse = await worker.fetch(
      new Request('https://coordinator.example/v1/mailbox?cursor=not-a-valid-cursor'),
      env,
    );
    expect(cursorResponse.status).toBe(400);
    expect(await cursorResponse.json()).toMatchObject({ error: 'invalid_mailbox_cursor' });

    const limitResponse = await worker.fetch(
      new Request('https://coordinator.example/v1/mailbox?limit=101'),
      env,
    );
    expect(limitResponse.status).toBe(400);
    expect(await limitResponse.json()).toMatchObject({ error: 'invalid_mailbox_limit' });
  });

  it('exposes a non-secret readiness probe before session verification', async () => {
    const worker = createTapEmailCoordinator({
      verifyAccess: async () => {
        throw new Error('readiness must not require a user session');
      },
    });
    const response = await worker.fetch(
      new Request('https://coordinator.example/ready'),
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      service: 'tap-email-coordinator',
      checks: { configuration: true, database: true },
    });
  });
});
