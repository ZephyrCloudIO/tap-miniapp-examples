import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAXIMUM_THREAD_RESPONSE_BYTES, TARGET_THREAD_PAGE_BYTES, serializedUtf8Bytes,
} from '@tap-examples/tap-email-protocol';
import { encodeBase64Url, sealSecret } from '../src/crypto';
import { syncGoogleMailbox, threadSnapshot } from '../src/mailbox';
import { createTapEmailCoordinator } from '../src/index';

const now = new Date('2026-09-24T12:00:00Z');
const key = env.GOOGLE_TOKEN_ENCRYPTION_KEY;
const scope = { profileId: 'pages_profile', accountId: 'pages_account' };
const threadId = 'pages_thread';
const read = async (cursor?: string) => {
  const page = await threadSnapshot(env, scope.profileId, scope.accountId, threadId, now, cursor);
  if (!page) throw new Error('Missing test conversation');
  return page;
};

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM google_accounts WHERE profile_id = ?').bind(scope.profileId).run();
  await env.DB.prepare(`INSERT INTO google_accounts
    (profile_id, account_id, google_subject, connection_state, coverage_state,
     newest_history_id, unresolved_failures, email_address, created_at, updated_at)
    VALUES (?, ?, 'pages_subject', 'active', 'current', 'h1', 0, 'owner@example.com', ?, ?)`)
    .bind(scope.profileId, scope.accountId, now.toISOString(), now.toISOString()).run();
  await env.DB.prepare(`INSERT INTO google_credentials
    (profile_id, account_id, refresh_token_ciphertext, access_token_ciphertext,
     access_token_expires_at, granted_scopes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'gmail.modify', ?, ?)`)
    .bind(scope.profileId, scope.accountId, await sealSecret('refresh', key), await sealSecret('access', key),
      '2026-09-24T15:00:00Z', now.toISOString(), now.toISOString()).run();
});
afterEach(() => vi.restoreAllMocks());

function providerMessage(index: number, text: string, html: string) {
  return {
    id: `message_${index}`, threadId, labelIds: ['INBOX'], internalDate: String(now.getTime()),
    snippet: 'synthetic', payload: {
      mimeType: 'multipart/mixed', headers: [
        { name: 'From', value: 'Sender <sender@example.com>' },
        { name: 'To', value: 'Owner <owner@example.com>' },
        { name: 'Subject', value: 'Synthetic conversation' },
      ], parts: [
        { mimeType: 'text/plain', body: { data: encodeBase64Url(text) } },
        { mimeType: 'text/html', body: { data: encodeBase64Url(html) } },
        { mimeType: 'application/pdf', filename: `${index}.pdf`, body: { attachmentId: `attachment_${index}`, size: 10 } },
      ],
    },
  };
}
function provider(messages: ReturnType<typeof providerMessage>[], forceFallback = false) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname.endsWith('/profile')) return Response.json({ emailAddress: 'owner@example.com', historyId: 'h1' });
    if (url.pathname.endsWith('/threads')) return Response.json({ threads: [{ id: threadId }] });
    if (url.pathname.endsWith(`/threads/${threadId}`)) {
      if (url.searchParams.get('format') === 'metadata') {
        return Response.json({ id: threadId, historyId: 'h1', messages: messages.map(message => ({
          ...message, payload: { headers: message.payload.headers },
        })) });
      }
      if (forceFallback) return new Response('{}', { headers: { 'Content-Length': '2097153' } });
      return Response.json({ id: threadId, historyId: 'h1', messages });
    }
    const message = messages.find(message => url.pathname.endsWith(`/messages/${message.id}`));
    if (message) return Response.json(message);
    throw new Error(`Unexpected request ${url}`);
  });
}
async function sync() {
  await syncGoogleMailbox(env, { ...scope, mode: 'newest' }, now);
}

async function seedBodies(bodies: Array<[string, string]>) {
  await env.DB.prepare(`INSERT INTO mail_threads
    (profile_id, account_id, thread_id, history_id, subject, snippet, participants_json, received_at,
     unread, starred, important, in_inbox, needs_response, waiting_on_others, label_ids_json, updated_at)
    VALUES (?, ?, ?, 'h1', 'Synthetic', '', '[]', ?, 0, 0, 0, 1, 0, 0, '[]', ?)`)
    .bind(scope.profileId, scope.accountId, threadId, now.toISOString(), now.toISOString()).run();
  for (const [ordinal, [text, html]] of bodies.entries()) {
    await env.DB.prepare(`INSERT INTO mail_messages
      (profile_id, account_id, thread_id, message_id, sender_json, recipients_json, sent_at,
       body_text_ciphertext, body_html_ciphertext, ordinal, updated_at)
      VALUES (?, ?, ?, ?, '{"name":"Sender","address":"sender@example.com"}', '[]', ?, ?, ?, ?, ?)`)
      .bind(scope.profileId, scope.accountId, threadId, `message_${ordinal}`, now.toISOString(),
        await sealSecret(text, key), await sealSecret(html, key), ordinal, now.toISOString()).run();
  }
}

describe('bounded conversation history', () => {
  it('recovers the three-large-message provider response and returns complete bounded pages', async () => {
    const text = 'x'.repeat(400_000);
    const html = 'y'.repeat(400_000);
    const fetch = provider(Array.from({ length: 3 }, (_, index) => providerMessage(index, text, html)));
    await sync();
    const first = await read();
    expect(first.messages.map(message => message.messageId)).toEqual(['message_1', 'message_2']);
    expect(first.pageInfo.complete).toBe(false);
    const second = await read(first.pageInfo.nextCursor!);
    expect(second.messages.map(message => message.messageId)).toEqual(['message_0']);
    expect(second.pageInfo).toEqual({ nextCursor: null, complete: true });
    for (const page of [first, second]) {
      expect(serializedUtf8Bytes({ thread: page })).toBeLessThanOrEqual(TARGET_THREAD_PAGE_BYTES);
      for (const message of page.messages) {
        expect(message.bodyText).toBe(text);
        expect(message.bodyHtml).toBe(html);
        expect(message.attachments).toHaveLength(1);
      }
    }
    expect(fetch.mock.calls.some(([input]) => String(input).includes('format=metadata'))).toBe(true);
  });

  it.each([false, true])('retains 25 identities, ordering and attachment metadata (fallback=%s)', async fallback => {
    const messages = Array.from({ length: 25 }, (_, index) => providerMessage(index, `Body ${index}`, `<b>${index}</b>`));
    // Duplicate identity from a provider must not create duplicate rows/cards.
    provider([...messages, messages[24]!], fallback);
    await sync();
    const first = await read();
    const second = await read(first.pageInfo.nextCursor!);
    expect(first.messages).toHaveLength(20);
    expect(second.messages).toHaveLength(5);
    expect([...second.messages, ...first.messages].map(message => message.messageId)).toEqual(messages.map(message => message.id));
    expect(second.messages.every(message => message.attachments.length === 1)).toBe(true);
    expect(second.pageInfo.complete).toBe(true);
    expect(await env.DB.prepare(`SELECT COUNT(*) AS count FROM mail_messages WHERE profile_id = ?`)
      .bind(scope.profileId).first()).toEqual({ count: 25 });
    expect(await env.DB.prepare(`SELECT COUNT(*) AS count FROM mail_attachments WHERE profile_id = ?`)
      .bind(scope.profileId).first()).toEqual({ count: 25 });
  });

  it('binds continuation to the account, thread, profile and revision', async () => {
    provider(Array.from({ length: 25 }, (_, index) => providerMessage(index, 'body', '<b>body</b>')));
    await sync();
    const first = await read();
    const cursor = first.pageInfo.nextCursor!;
    await expect(read('not a cursor')).rejects.toMatchObject({ code: 'invalid_thread_cursor' });
    for (const property of ['profileId', 'accountId', 'threadId']) {
      const decoded = JSON.parse(atob(cursor.replaceAll('-', '+').replaceAll('_', '/')));
      decoded[property] = 'different';
      await expect(read(encodeBase64Url(JSON.stringify(decoded)))).rejects.toMatchObject({ code: 'invalid_thread_cursor' });
    }
    await env.DB.prepare('UPDATE mail_threads SET history_id = ? WHERE profile_id = ?').bind('h2', scope.profileId).run();
    await expect(read(cursor)).rejects.toMatchObject({ code: 'thread_changed', status: 409 });
  });

  it('keeps escaped and multibyte alternatives intact within the shared wire budget', async () => {
    const bodies: Array<[string, string]> = [
      ['\u0000'.repeat(500_000), '\u0001'.repeat(500_000)],
      ['日本語😀"\\'.repeat(20_000), '<b>é😀</b>'.repeat(25_000)],
    ];
    await seedBodies(bodies);
    const first = await read();
    const second = await read(first.pageInfo.nextCursor!);
    expect(first.messages).toHaveLength(1);
    expect(second.messages).toHaveLength(1);
    for (const [page, index] of [[first, 1], [second, 0]] as const) {
      expect(page.messages[0]!.bodyText).toBe(bodies[index]![0]);
      expect(page.messages[0]!.bodyHtml).toBe(bodies[index]![1]);
      expect(serializedUtf8Bytes({ thread: page })).toBeLessThanOrEqual(MAXIMUM_THREAD_RESPONSE_BYTES);
    }
    const worker = createTapEmailCoordinator({ verifyAccess: async () => ({ profileId: scope.profileId }), now: () => now });
    const response = await worker.fetch(new Request(`https://coordinator.example/v1/accounts/${scope.accountId}/threads/${threadId}?cursor=${encodeURIComponent(first.pageInfo.nextCursor!)}`), env);
    expect(response.status).toBe(200);
    expect((await response.arrayBuffer()).byteLength).toBe(serializedUtf8Bytes({ thread: second }));
  });

  it('accepts exactly the page byte target and splits at one byte over, including the envelope', async () => {
    await seedBodies([['', ''], ['', '']]);
    const overhead = serializedUtf8Bytes({ thread: await read() }) - 4; // Two null HTML values become empty strings.
    const remaining = TARGET_THREAD_PAGE_BYTES - overhead - 1_500_000;
    const tail = '\u0000'.repeat(Math.floor(remaining / 6)) + 'x'.repeat(remaining % 6);
    const update = async (extra: string) => {
      for (const index of [0, 1]) await env.DB.prepare(`UPDATE mail_messages SET body_text_ciphertext = ?, body_html_ciphertext = ? WHERE profile_id = ? AND message_id = ?`)
        .bind(await sealSecret('a'.repeat(500_000), key), await sealSecret(index === 0 ? 'b'.repeat(500_000) : tail + extra, key), scope.profileId, `message_${index}`).run();
    };
    await update('');
    const exact = await read();
    expect(exact.messages).toHaveLength(2);
    expect(serializedUtf8Bytes({ thread: exact })).toBe(TARGET_THREAD_PAGE_BYTES);
    await update('x');
    const over = await read();
    expect(over.messages).toHaveLength(1);
    expect(over.pageInfo.complete).toBe(false);
  });

  it('refreshes an existing truncated cache before reporting complete history', async () => {
    await seedBodies(Array.from({ length: 20 }, () => ['cached', ''] as [string, string]));
    // Migration 0014 invalidates old completeness this way without removing cached mail.
    await env.DB.prepare("UPDATE mail_threads SET content_state = 'metadata' WHERE profile_id = ?")
      .bind(scope.profileId).run();
    provider(Array.from({ length: 25 }, (_, index) => providerMessage(index, `Restored ${index}`, '<b>body</b>')));
    const first = await read();
    expect(first.pageInfo.complete).toBe(false);
    const older = await read(first.pageInfo.nextCursor!);
    expect(older.messages[0]!.messageId).toBe('message_0');
    expect(older.messages[0]!.bodyText).toBe('Restored 0');
    expect(older.pageInfo.complete).toBe(true);
  });

  it('does not report an unreadable provider body as an empty successful message', async () => {
    provider([providerMessage(0, 'x'.repeat(500_001), '<b>body</b>')]);
    await sync();
    expect(await env.DB.prepare('SELECT body_state FROM mail_messages WHERE profile_id = ?')
      .bind(scope.profileId).first()).toEqual({ body_state: 'metadata' });
    await expect(read()).rejects.toMatchObject({ code: 'message_body_unavailable' });
  });

  it('retains a failed older-message load for an explicit successful retry', async () => {
    const messages = Array.from({ length: 25 }, (_, index) => providerMessage(index, `Body ${index}`, '<b>body</b>'));
    const fetch = provider(messages, true);
    await sync();
    const first = await read();
    const implementation = fetch.getMockImplementation()!;
    fetch.mockImplementationOnce(async () => Response.json({ error: { message: 'temporary' } }, { status: 503 }));
    await expect(read(first.pageInfo.nextCursor!)).rejects.toMatchObject({ code: 'google_temporarily_unavailable' });
    fetch.mockImplementation(implementation);
    const retried = await read(first.pageInfo.nextCursor!);
    expect(retried.messages).toHaveLength(5);
    expect(retried.messages[0]!.bodyText).toBe('Body 0');
    expect(retried.pageInfo.complete).toBe(true);
  });
});
