import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { sealSecret } from '../src/crypto';
import { createTapEmailCoordinator } from '../src/index';
import { AccessError } from '../src/auth';
import {
  createTapEmailLiveMcpHandler,
  type EmailMcpPrincipal,
} from '../src/mcp';

const observedAt = '2026-09-13T16:00:00.000Z';
const profile = { profileId: 'profile_1' };
const fullPrincipal: EmailMcpPrincipal = {
  ...profile,
  audience: 'tap-email-mcp',
  scopes: ['email.metadata.read', 'email.content.read'],
};

function mcpRequest(body: Readonly<Record<string, unknown>>): Request {
  return new Request('https://coordinator.example/mcp', {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function mcpCall(
  body: Readonly<Record<string, unknown>>,
  principal: EmailMcpPrincipal = fullPrincipal,
): Promise<Readonly<Record<string, unknown>>> {
  const response = await createTapEmailLiveMcpHandler(
    env,
    principal,
    () => new Date(observedAt),
  ).fetch(mcpRequest(body));
  const text = await response.text();
  expect(response.status, text).toBe(200);
  const payload = response.headers.get('Content-Type')?.includes('text/event-stream')
    ? text.split('\n').find(line => line.startsWith('data: '))?.slice(6)
    : text;
  if (!payload) throw new Error('MCP response omitted its payload.');
  return JSON.parse(payload) as Readonly<Record<string, unknown>>;
}

async function callTool(
  name: string,
  args: Readonly<Record<string, unknown>>,
  principal: EmailMcpPrincipal = fullPrincipal,
): Promise<Readonly<Record<string, unknown>>> {
  const response = await mcpCall({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name, arguments: args },
  }, principal);
  return response.result as Readonly<Record<string, unknown>>;
}

async function seedMailbox(): Promise<void> {
  const ciphertext = await sealSecret(
    'Please approve the launch plan before Friday. This second sentence is deliberately long.',
    env.GOOGLE_TOKEN_ENCRYPTION_KEY,
  );
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO google_accounts
        (profile_id, account_id, google_subject, connection_state,
         coverage_state, newest_history_id, backfill_complete_through,
         unresolved_failures, email_address, display_name, created_at, updated_at)
       VALUES ('profile_1', 'account_work', 'subject_work', 'active', 'current',
               'history_20', '2026-01-01T00:00:00.000Z', 0,
               'zack@example.com', 'Work', ?, ?)`,
    ).bind(observedAt, observedAt),
    env.DB.prepare(
      `INSERT INTO google_accounts
        (profile_id, account_id, google_subject, connection_state,
         coverage_state, newest_history_id, backfill_complete_through,
         unresolved_failures, email_address, display_name, created_at, updated_at)
       VALUES ('profile_2', 'account_work', 'subject_other', 'active', 'current',
               'history_99', '2026-01-01T00:00:00.000Z', 0,
               'other@example.com', 'Other', ?, ?)`,
    ).bind(observedAt, observedAt),
    env.DB.prepare(
      `INSERT INTO mail_threads
        (profile_id, account_id, thread_id, history_id, subject, snippet,
         participants_json, received_at, unread, starred, important, in_inbox,
         needs_response, waiting_on_others, label_ids_json, updated_at)
       VALUES ('profile_1', 'account_work', 'thread_launch', 'history_20',
               'VC launch plan', 'Please approve before Friday',
               '[{"name":"Maya","address":"maya@example.com"}]',
               '2026-09-11T14:00:00.000Z', 1, 1, 1, 1, 1, 0,
               '["INBOX","Launch"]', ?)`,
    ).bind(observedAt),
    env.DB.prepare(
      `INSERT INTO mail_threads
        (profile_id, account_id, thread_id, history_id, subject, snippet,
         participants_json, received_at, unread, starred, important, in_inbox,
         needs_response, waiting_on_others, label_ids_json, updated_at)
       VALUES ('profile_2', 'account_work', 'thread_secret', 'history_99',
               'Other profile secret', 'Must not cross profiles', '[]',
               '2026-09-12T14:00:00.000Z', 1, 0, 0, 1, 0, 0, '["INBOX"]', ?)`,
    ).bind(observedAt),
    env.DB.prepare(
      `INSERT INTO mail_messages
        (profile_id, account_id, thread_id, message_id, internet_message_id,
         sender_json, recipients_json, sent_at, body_text_ciphertext,
         body_html_ciphertext, ordinal, updated_at)
       VALUES ('profile_1', 'account_work', 'thread_launch', 'message_launch',
               '<message@example.com>',
               '{"name":"Maya","address":"maya@example.com"}',
               '[{"name":"Zack","address":"zack@example.com"}]',
               '2026-09-11T14:00:00.000Z', ?, NULL, 0, ?)`,
    ).bind(ciphertext, observedAt),
    env.DB.prepare(
      `INSERT INTO mail_attachments
        (profile_id, account_id, thread_id, message_id, resource_id, file_name,
         mime_type, size_bytes, disposition, content_id, gmail_part_path,
         gmail_attachment_id_ciphertext, updated_at)
       VALUES ('profile_1', 'account_work', 'thread_launch', 'message_launch',
               'resource_brief', 'brief.pdf', 'application/pdf', 2048,
               'attachment', NULL, '1', NULL, ?)`,
    ).bind(observedAt),
    env.DB.prepare(
      `INSERT INTO mail_commands
        (profile_id, account_id, command_id, idempotency_key, kind, thread_id,
         expected_provider_revision, payload_json, state, dispatch_pending,
         client_created_at, created_at, updated_at)
       VALUES ('profile_1', 'account_work', 'command_done',
               'tap-email:account_work:command_done', 'archive', 'thread_launch',
               'history_20', '{}', 'applied', 0, ?, ?, ?)`,
    ).bind(observedAt, observedAt, observedAt),
  ]);
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM email_mcp_credentials'),
    env.DB.prepare('DELETE FROM mail_profile_users'),
    env.DB.prepare('DELETE FROM coordinator_audit'),
    env.DB.prepare('DELETE FROM provider_events'),
    env.DB.prepare('DELETE FROM tap_reminders'),
    env.DB.prepare('DELETE FROM mail_attachments'),
    env.DB.prepare('DELETE FROM mail_messages'),
    env.DB.prepare('DELETE FROM mail_threads'),
    env.DB.prepare('DELETE FROM mail_commands'),
    env.DB.prepare('DELETE FROM google_credentials'),
    env.DB.prepare('DELETE FROM google_oauth_states'),
    env.DB.prepare('DELETE FROM google_accounts'),
  ]);
  await seedMailbox();
});

describe('TAP Email live MCP', () => {
  it('does not mount the live MCP behind an unscoped platform session', async () => {
    let accessChecks = 0;
    const worker = createTapEmailCoordinator({
      verifyAccess: async request => {
        accessChecks += 1;
        expect(request.headers.get('Authorization')).toBe('Bearer platform-session');
        return profile;
      },
      now: () => new Date(observedAt),
    });
    const request = mcpRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    });
    request.headers.set('Authorization', 'Bearer platform-session');
    const response = await worker.fetch(request, env);
    expect(response.status).toBe(401);
    expect(accessChecks).toBe(0);
  });

  it('enforces content scope inside the authenticated server', async () => {
    const metadataOnly: EmailMcpPrincipal = {
      ...profile,
      audience: 'tap-email-mcp',
      scopes: ['email.metadata.read'],
    };
    const accounts = await callTool('list_email_accounts', {}, metadataOnly);
    expect(accounts.isError).not.toBe(true);

    const content = await callTool('read_email_messages', {
      accountId: 'account_work',
      threadId: 'thread_launch',
      messageIds: ['message_launch'],
    }, metadataOnly);
    expect(content.isError).toBe(true);
    expect(JSON.stringify(content)).toContain('permission_denied');
  });

  it('advertises bounded read and receipt-backed draft/send tools', async () => {
    const response = await mcpCall({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    });
    const tools = (response.result as { tools: readonly { name: string }[] }).tools;
    expect(tools.map(tool => tool.name)).toEqual([
      'list_email_accounts',
      'search_email_threads',
      'get_email_thread',
      'read_email_messages',
      'get_email_command_receipt',
      'save_email_draft',
      'send_email',
    ]);
  });

  it('lists only the authenticated profile account catalog', async () => {
    const result = await callTool('list_email_accounts', {});
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      accounts: [{
        accountId: 'account_work',
        address: 'zack@example.com',
        displayName: 'Work',
        connectionState: 'active',
      }],
      coverage: {
        completeness: 'complete',
        request: {
          accountIds: ['account_work'],
          resources: ['account-metadata'],
        },
      },
    });
    expect(JSON.stringify(result.structuredContent)).not.toContain('other@example.com');
  });

  it('searches only explicit account scopes and returns a coverage receipt, not bodies', async () => {
    const result = await callTool('search_email_threads', {
      accountIds: ['account_work'],
      text: 'VC',
      afterInclusive: '2026-09-07T00:00:00.000Z',
      beforeExclusive: '2026-09-14T00:00:00.000Z',
      limit: 10,
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      matchingMode: 'deterministic-metadata-substring-and-structured-filters',
      threads: [{
        accountId: 'account_work',
        threadId: 'thread_launch',
        latestMessageRef: { messageId: 'message_launch' },
      }],
      coverage: {
        request: { accountIds: ['account_work'] },
        source: 'coordinator-replica',
        fallback: 'unavailable',
      },
    });
    const serialized = JSON.stringify(result.structuredContent);
    expect(serialized).not.toContain('approve the launch plan');
    expect(serialized).not.toContain('Please approve before Friday');
    expect(serialized).not.toContain('thread_secret');
  });

  it('requires exact message identity and returns only bounded plaintext', async () => {
    const metadata = await callTool('get_email_thread', {
      accountId: 'account_work',
      threadId: 'thread_launch',
    });
    expect(metadata.structuredContent).toMatchObject({
      messages: [{
        messageId: 'message_launch',
        attachments: [{ resourceId: 'resource_brief', fileName: 'brief.pdf' }],
      }],
      coverage: {
        completeness: 'partial',
        fallback: 'unavailable',
        request: {
          threadRefs: [{ accountId: 'account_work', threadId: 'thread_launch' }],
        },
        warnings: [
          expect.stringContaining('Exact replica reads cannot yet prove'),
        ],
      },
    });
    expect(JSON.stringify(metadata.structuredContent)).not.toContain('bodyText');

    const content = await callTool('read_email_messages', {
      accountId: 'account_work',
      threadId: 'thread_launch',
      messageIds: ['message_launch'],
      maximumCharactersPerMessage: 22,
    });
    expect(content.structuredContent).toMatchObject({
      untrustedContent: true,
      contentPolicy: {
        rawHtmlIncluded: false,
        remoteImagesIncluded: false,
        attachmentBytesIncluded: false,
      },
      messages: [{
        messageId: 'message_launch',
        bodyText: 'Please approve the lau',
        bodyTextTruncated: true,
      }],
      coverage: { resultTruncated: true },
    });

    const wrongThread = await callTool('read_email_messages', {
      accountId: 'account_work',
      threadId: 'missing_thread',
      messageIds: ['message_launch'],
    });
    expect(wrongThread.isError).toBe(true);
    expect(JSON.stringify(wrongThread)).toContain('thread_not_found');
  });

  it('reads command receipts through an exact account partition', async () => {
    const result = await callTool('get_email_command_receipt', {
      accountId: 'account_work',
      commandId: 'command_done',
    });
    expect(result.structuredContent).toMatchObject({
      receipt: {
        accountId: 'account_work',
        commandId: 'command_done',
        state: 'applied',
      },
      coverage: { completeness: 'complete' },
    });
  });

  it('normalizes offset ISO bounds before querying and reporting coverage', async () => {
    const result = await callTool('search_email_threads', {
      accountIds: ['account_work'],
      text: 'VC',
      afterInclusive: '2026-09-11T10:00:00-04:00',
      beforeExclusive: '2026-09-11T10:01:00-04:00',
      inInbox: true,
      limit: 10,
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      threads: [{ threadId: 'thread_launch' }],
      coverage: {
        completeness: 'complete',
        fallback: 'not-needed',
        request: {
          afterInclusive: '2026-09-11T14:00:00.000Z',
          beforeExclusive: '2026-09-11T14:01:00.000Z',
        },
      },
    });
  });

  it('binds encrypted continuation cursors to the complete search query', async () => {
    await env.DB.prepare(
      `INSERT INTO mail_threads
        (profile_id, account_id, thread_id, history_id, subject, snippet,
         participants_json, received_at, unread, starred, important, in_inbox,
         needs_response, waiting_on_others, label_ids_json, updated_at)
       VALUES ('profile_1', 'account_work', 'thread_earlier', 'history_19',
               'VC earlier plan', 'Body-derived text that must not be returned',
               '[{"name":"Rina","address":"rina@example.com"}]',
               '2026-09-10T14:00:00.000Z', 0, 0, 0, 1, 0, 0,
               '["INBOX"]', ?)`,
    ).bind(observedAt).run();

    const query = {
      accountIds: ['account_work'],
      text: 'plan',
      afterInclusive: '2026-09-01T00:00:00.000Z',
      beforeExclusive: '2026-09-14T00:00:00.000Z',
      inInbox: true,
      limit: 1,
    } as const;
    const first = await callTool('search_email_threads', query);
    const firstPage = first.structuredContent as {
      readonly threads: readonly { readonly threadId: string }[];
      readonly coverage: {
        readonly nextCursor: string | null;
        readonly resultTruncated: boolean;
      };
    };
    expect(firstPage.threads.map(thread => thread.threadId)).toEqual(['thread_launch']);
    expect(firstPage.coverage.resultTruncated).toBe(true);
    expect(firstPage.coverage.nextCursor).toEqual(expect.any(String));
    expect(first.structuredContent).toMatchObject({
      coverage: { completeness: 'partial', fallback: 'not-needed' },
    });

    const second = await callTool('search_email_threads', {
      ...query,
      cursor: firstPage.coverage.nextCursor,
    });
    const secondPage = second.structuredContent as {
      readonly threads: readonly { readonly threadId: string }[];
      readonly coverage: {
        readonly nextCursor: string | null;
        readonly resultTruncated: boolean;
      };
    };
    expect(secondPage.threads.map(thread => thread.threadId)).toEqual(['thread_earlier']);
    expect(secondPage.coverage).toMatchObject({
      nextCursor: null,
      resultTruncated: true,
    });
    expect(JSON.stringify(secondPage)).not.toContain('Body-derived text');

    const reusedForDifferentQuery = await callTool('search_email_threads', {
      ...query,
      text: 'Rina',
      cursor: firstPage.coverage.nextCursor,
    });
    expect(reusedForDifferentQuery.isError).toBe(true);
    expect(JSON.stringify(reusedForDifferentQuery)).toContain('invalid_cursor');
  });

  it('writes content-free audit records for successful and denied reads', async () => {
    await callTool('search_email_threads', {
      accountIds: ['account_work'],
      text: 'Never audit this merger phrase',
      limit: 10,
    });
    await callTool('read_email_messages', {
      accountId: 'account_work',
      threadId: 'thread_launch',
      messageIds: ['message_launch'],
    });
    const metadataOnly: EmailMcpPrincipal = {
      ...profile,
      audience: 'tap-email-mcp',
      scopes: ['email.metadata.read'],
    };
    await callTool('read_email_messages', {
      accountId: 'account_work',
      threadId: 'thread_launch',
      messageIds: ['message_launch'],
    }, metadataOnly);

    const audit = await env.DB.prepare(
      `SELECT profile_id, account_id, operation, object_id, outcome, occurred_at
         FROM coordinator_audit
        WHERE profile_id = ?
        ORDER BY rowid`,
    ).bind(profile.profileId).all<{
      readonly profile_id: string;
      readonly account_id: string | null;
      readonly operation: string;
      readonly object_id: string;
      readonly outcome: string;
      readonly occurred_at: string;
    }>();
    expect(audit.results).toEqual([
      {
        profile_id: 'profile_1',
        account_id: null,
        operation: 'mcp.search_email_threads',
        object_id: 'accounts:account_work',
        outcome: 'succeeded',
        occurred_at: observedAt,
      },
      {
        profile_id: 'profile_1',
        account_id: 'account_work',
        operation: 'mcp.read_email_messages',
        object_id: 'thread_launch:message_launch',
        outcome: 'succeeded',
        occurred_at: observedAt,
      },
      {
        profile_id: 'profile_1',
        account_id: 'account_work',
        operation: 'mcp.read_email_messages',
        object_id: 'thread_launch:message_launch',
        outcome: 'failed:permission_denied',
        occurred_at: observedAt,
      },
    ]);
    const serialized = JSON.stringify(audit.results);
    expect(serialized).not.toContain('Never audit this merger phrase');
    expect(serialized).not.toContain('Please approve the launch plan');
  });

  it('rejects oversized requests and JSON-RPC batches before tool dispatch', async () => {
    const handler = createTapEmailLiveMcpHandler(
      env,
      fullPrincipal,
      () => new Date(observedAt),
    );
    const oversized = await handler.fetch(new Request('https://coordinator.example/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'x'.repeat(524_289),
    }));
    expect(oversized.status).toBe(413);
    expect(oversized.headers.get('Cache-Control')).toBe('no-store');

    const batch = Array.from({ length: 21 }, (_, index) => ({
      jsonrpc: '2.0',
      id: index + 1,
      method: 'tools/list',
      params: {},
    }));
    const tooMany = await handler.fetch(new Request('https://coordinator.example/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batch),
    }));
    expect(tooMany.status).toBe(400);
    await expect(tooMany.json()).resolves.toMatchObject({
      error: { message: expect.stringContaining('too many') },
    });
  });
});

describe('live MCP connection and delivery', () => {
  const sender = { userId: 'user_1', workspaceId: 'workspace_1' };
  const verifySender = async () => sender;
  async function connect(worker: ReturnType<typeof createTapEmailCoordinator>, allowWrites = false) {
    const response = await worker.fetch(new Request('https://coordinator.example/v1/mcp/credential', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allowWrites, ...(allowWrites ? { expectedContext: sender } : {}) }),
    }), env);
    expect(response.status).toBe(201);
    return await response.json() as { token: string; expiresAt: string };
  }
  async function invoke(worker: ReturnType<typeof createTapEmailCoordinator>, token: string, name: string, args: object = {}) {
    const request = mcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
    request.headers.set('X-TAP-Email-MCP-Token', token);
    const response = await worker.fetch(request, env);
    if (response.status !== 200) return { status: response.status, result: null };
    const text = await response.text();
    const data = response.headers.get('Content-Type')?.includes('text/event-stream')
      ? text.split('\n').find(line => line.startsWith('data: '))!.slice(6) : text;
    return { status: response.status, result: JSON.parse(data).result as { isError?: boolean; structuredContent?: { receipt?: { state: string }; duplicate?: boolean } } };
  }
  const draft = { accountId: 'account_work', commandId: 'chloe_send_1', createdAt: observedAt, draftKey: 'draft_chloe', draftRevision: 1, to: 'recipient@example.test', subject: 'Requested message', bodyText: 'Hello from Chloe.' };

  it('requires explicit write scope, stores only a hash, rotates, expires, and revokes credentials', async () => {
    const worker = createTapEmailCoordinator({ verifyAccess: async () => profile, verifySender, now: () => new Date(observedAt) });
    const first = await connect(worker);
    const accountResult = await invoke(worker, first.token, 'list_email_accounts');
    expect(accountResult.result?.isError).not.toBe(true);
    expect(JSON.stringify(accountResult.result)).not.toContain('other@example.com');
    expect((await invoke(worker, first.token, 'send_email', draft)).result?.isError).toBe(true);
    const stored = await env.DB.prepare('SELECT * FROM email_mcp_credentials WHERE profile_id = ?').bind(profile.profileId).first();
    expect(JSON.stringify(stored)).not.toContain(first.token);
    const second = await connect(worker, true);
    expect((await invoke(worker, first.token, 'list_email_accounts')).status).toBe(401);
    const later = createTapEmailCoordinator({ now: () => new Date(second.expiresAt) });
    expect((await invoke(later, second.token, 'list_email_accounts')).status).toBe(401);
    await worker.fetch(new Request('https://coordinator.example/v1/mcp/credential', { method: 'DELETE' }), env);
    expect((await invoke(worker, second.token, 'list_email_accounts')).status).toBe(401);
  });

  it('finds, reads, sends once, and exposes a content-free activity receipt', async () => {
    let providerCalls = 0;
    const referrals: object[] = [];
    const worker = createTapEmailCoordinator({
      verifyAccess: async () => profile, verifySender, now: () => new Date(observedAt),
      referralPublisher: { publishTapEmailLink: async input => {
        referrals.push(input);
        return { referralId: 'ref_mcp_1', url: `https://theaiplatform.app/refer/${'a'.repeat(32)}?utm_source=tap_email&utm_medium=email&utm_campaign=sent_with&utm_content=signature` };
      } },
      provider: { execute: async () => { providerCalls += 1; return { outcome: 'acknowledged', providerRevision: 'sent_revision' }; } },
    });
    const { token } = await connect(worker, true);
    expect((await invoke(worker, token, 'search_email_threads', { accountIds: ['account_work'], text: 'launch' })).result?.isError).not.toBe(true);
    expect((await invoke(worker, token, 'read_email_messages', { accountId: 'account_work', threadId: 'thread_launch', messageIds: ['message_launch'] })).result?.isError).not.toBe(true);
    const sent = await invoke(worker, token, 'send_email', draft);
    expect(sent.result?.structuredContent?.receipt?.state).toBe('accepted');
    const attribution = await env.DB.prepare('SELECT user_id, workspace_id FROM mail_command_attributions WHERE profile_id = ? AND command_id = ?')
      .bind(profile.profileId, draft.commandId).first();
    expect(attribution).toEqual({ user_id: sender.userId, workspace_id: sender.workspaceId });
    expect((await invoke(worker, token, 'send_email', { ...draft, expectedContext: { userId: 'other', workspaceId: 'other' } })).result?.isError).toBe(true);
    expect((await invoke(worker, token, 'send_email', draft)).result?.structuredContent?.duplicate).toBe(true);
    expect((await invoke(worker, token, 'send_email', { ...draft, bodyText: 'Changed intent' })).result?.isError).toBe(true);
    const body = { kind: 'command' as const, profileId: profile.profileId, accountId: draft.accountId, commandId: draft.commandId };
    const message: Message<typeof body> = { id: 'mcp_queue_1', timestamp: new Date(observedAt), body, attempts: 1, ack() {}, retry() {} };
    const batch = { queue: 'tap-email-commands', messages: [message], metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } }, ackAll() {}, retryAll() {} };
    await worker.queue(batch, env);
    await worker.queue(batch, env);
    expect(providerCalls).toBe(1);
    expect(referrals).toEqual([expect.objectContaining({ referrerUserId: sender.userId, referrerWorkspaceId: sender.workspaceId })]);
    expect((await invoke(worker, token, 'get_email_command_receipt', { accountId: draft.accountId, commandId: draft.commandId })).result?.structuredContent?.receipt?.state).toBe('applied');
    const activity = await worker.fetch(new Request('https://coordinator.example/v1/activity/receipts?after=2026-09-01T00%3A00%3A00.000Z'), env);
    expect(activity.status).toBe(200);
    const activityBody = await activity.json() as { items: { commandId: string; receipt: { state: string } }[]; views: { viewId: string; occurredAt: string }[] };
    expect(activityBody.views).toHaveLength(1);
    expect(Object.keys(activityBody.views[0]!).sort()).toEqual(['occurredAt', 'viewId']);
    expect(activityBody.items.find(item => item.commandId === draft.commandId)?.receipt.state).toBe('applied');
    for (const privateText of [draft.to, draft.subject, draft.bodyText, 'other@example.com']) expect(JSON.stringify(activityBody)).not.toContain(privateText);
  });

  it('requires verified sender context before issuing a write credential', async () => {
    const worker = createTapEmailCoordinator({
      verifyAccess: async () => profile, now: () => new Date(observedAt),
      verifySender: async () => { throw new AccessError(403, 'sender_context_mismatch', 'Sender changed.'); },
    });
    for (const [body, status] of [
      [{ allowWrites: true }, 400],
      [{ allowWrites: true, expectedContext: sender }, 403],
    ] as const) {
      const response = await worker.fetch(new Request('https://coordinator.example/v1/mcp/credential', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }), env);
      expect(response.status).toBe(status);
    }
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM email_mcp_credentials').first('count')).toBe(0);
  });

  it('paginates activity at identical timestamps without crossing profiles', async () => {
    await env.DB.batch(Array.from({ length: 25 }, (_, index) => env.DB.prepare(
      `INSERT INTO mail_commands (profile_id, account_id, command_id, idempotency_key, kind,
        thread_id, payload_json, state, dispatch_pending, client_created_at, created_at, updated_at, provider_acknowledged_at)
       VALUES (?, 'account_work', ?, ?, 'archive', 'thread_launch', '{}', 'applied', 0, ?, ?, ?, ?)`,
    ).bind(index === 24 ? 'profile_2' : 'profile_1', `activity_${index}`, `activity_key_${index}`, observedAt, observedAt, observedAt, observedAt)));
    const worker = createTapEmailCoordinator({ verifyAccess: async () => profile, now: () => new Date(observedAt) });
    let cursor: { after: string; afterId: string } | null = { after: '2026-09-01T00:00:00.000Z', afterId: '' };
    const ids: string[] = [];
    let pages = 0;
    while (cursor) {
      const response = await worker.fetch(new Request(`https://coordinator.example/v1/activity/receipts?${new URLSearchParams(cursor)}`), env);
      const body = await response.json() as {
        items: { commandId: string }[];
        next: { after: string; afterId: string } | null;
      };
      expect(response.status).toBe(200);
      expect(body.items.length).toBeLessThanOrEqual(20);
      ids.push(...body.items.map(item => item.commandId));
      cursor = body.next;
      if (++pages > 3) throw new Error('Activity cursor did not progress.');
    }
    expect(ids.filter(id => id.startsWith('activity_'))).toHaveLength(24);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain('activity_24');
  });

  it('does not let an MCP token mint credentials or bypass platform REST authorization', async () => {
    const worker = createTapEmailCoordinator({ now: () => new Date(observedAt) });
    const response = await worker.fetch(new Request('https://coordinator.example/v1/mcp/credential', {
      method: 'POST', headers: { 'X-TAP-Email-MCP-Token': `temcp_${'a'.repeat(64)}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ allowWrites: true }),
    }), env);
    expect(response.status).toBe(401);
  });
});
