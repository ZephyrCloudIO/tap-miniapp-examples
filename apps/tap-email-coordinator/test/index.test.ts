import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  TAP_EMAIL_PROTOCOL_VERSION,
  type MailCommand,
} from '@tap-examples/tap-email-protocol';
import { createTapEmailCoordinator } from '../src/index';
import type { GoogleProviderPort } from '../src/provider';

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
             'Please review', '[]', ?, 1, 0, 0, 1, 1, 0, '["INBOX"]', ?)`,
  )
    .bind(threadId, now, now)
    .run();
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM coordinator_audit'),
    env.DB.prepare('DELETE FROM provider_events'),
    env.DB.prepare('DELETE FROM tap_reminders'),
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
              client_created_at, state
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
