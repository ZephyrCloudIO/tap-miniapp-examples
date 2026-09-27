import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeBase64Url, sealSecret } from '../src/crypto';
import { createTapEmailCoordinator } from '../src/index';
import { syncGoogleMailbox } from '../src/mailbox';
import { searchSentRecipients } from '../src/recipient-history';

const now = new Date('2026-09-26T12:00:00.000Z');
const profile = 'recipient_test_profile';

async function account(accountId: string, profileId = profile, state = 'active') {
  await env.DB.prepare(`INSERT INTO google_accounts
    (profile_id, account_id, google_subject, email_address, connection_state, coverage_state, created_at, updated_at)
    VALUES (?, ?, ?, 'me@example.com', ?, 'current', ?, ?)`)
    .bind(profileId, accountId, accountId, state, now.toISOString(), now.toISOString()).run();
}

async function recipient(accountId: string, address: string, name: string, sentAt = now.toISOString(), profileId = profile) {
  await env.DB.prepare(`INSERT INTO mail_recipient_history
    (profile_id, account_id, address, display_name, last_sent_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(profileId, accountId, address, name, sentAt).run();
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM google_accounts WHERE profile_id LIKE 'recipient_test_%'").run();
});
afterEach(() => vi.restoreAllMocks());

describe('sent-recipient search', () => {
  it('matches names and addresses across accounts, deduplicates, and isolates profiles', async () => {
    await account('work');
    await account('personal');
    await account('removed', profile, 'revoked');
    await account('other', 'recipient_test_other');
    await recipient('work', 'maya@example.com', 'Older name', '2026-09-01T12:00:00.000Z');
    await recipient('personal', 'maya@example.com', 'Maya Chen');
    await recipient('work', 'patel@example.com', 'Maya Patel');
    await recipient('removed', 'maya-revoked@example.com', 'Maya Revoked');
    await recipient('other', 'maya-private@example.com', 'Maya Private', now.toISOString(), 'recipient_test_other');
    expect(await searchSentRecipients(env, profile, 'MaYa')).toEqual([
      { name: 'Maya Chen', address: 'maya@example.com', lastSentAt: now.toISOString() },
      { name: 'Maya Patel', address: 'patel@example.com', lastSentAt: now.toISOString() },
    ]);
    expect(await searchSentRecipients(env, profile, '   ')).toEqual([]);
    expect(await searchSentRecipients(env, profile, '%')).toEqual([]);
    expect(await searchSentRecipients(env, profile, '_')).toEqual([]);
    await env.DB.prepare('DELETE FROM google_accounts WHERE profile_id = ? AND account_id = ?').bind(profile, 'personal').run();
    expect(await searchSentRecipients(env, profile, 'maya')).toContainEqual({
      name: 'Older name', address: 'maya@example.com', lastSentAt: '2026-09-01T12:00:00.000Z',
    });
  });

  it('bounds results and requires view authority at the recipient endpoint', async () => {
    await account('work');
    for (let index = 0; index < 25; index++) await recipient('work', `person${index}@example.com`, `Person ${index}`);
    const verifyAccess = vi.fn(async () => ({ profileId: profile }));
    const worker = createTapEmailCoordinator({ verifyAccess });
    const response = await worker.fetch(new Request('https://coordinator.example/v1/recipients?q=person'), env);
    expect(response.status).toBe(200);
    expect(verifyAccess).toHaveBeenCalledWith(expect.any(Request), env, 'tap-email.view');
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect((await response.json() as { recipients: unknown[] }).recipients).toHaveLength(20);
    for (const query of ['q=x&q=y', `q=${'x'.repeat(255)}`, 'q=x%0Ay']) {
      expect((await worker.fetch(new Request(`https://coordinator.example/v1/recipients?${query}`), env)).status).toBe(400);
    }
    const unauthenticated = createTapEmailCoordinator();
    expect((await unauthenticated.fetch(new Request('https://coordinator.example/v1/recipients?q=person'), env)).status).toBe(401);
  });

  it('seeds known sent To recipients from the pre-upgrade cache', async () => {
    await account('work');
    await env.DB.prepare(`INSERT INTO mail_threads
      (profile_id, account_id, thread_id, history_id, subject, snippet, participants_json,
       received_at, unread, starred, important, in_inbox, needs_response, waiting_on_others, label_ids_json, updated_at)
      VALUES (?, 'work', 'cached', '1', 'Old sent mail', '', '[]', ?, 0, 0, 0, 0, 0, 0, '["SENT"]', ?)`)
      .bind(profile, now.toISOString(), now.toISOString()).run();
    await env.DB.prepare(`INSERT INTO mail_messages
      (profile_id, account_id, thread_id, message_id, sender_json, recipients_json, sent_at, body_text_ciphertext, ordinal, updated_at)
      VALUES (?, 'work', 'cached', 'cached-message', '{"address":"me@example.com"}',
        '[{"name":"Cached Person","address":"CACHED@example.com"}]', ?, '', 0, ?)`)
      .bind(profile, now.toISOString(), now.toISOString()).run();
    const migration = env.TEST_MIGRATIONS.find(item => item.name.includes('0017_recipient_history'))!;
    const insert = migration.queries.find((query: string) => query.includes('INSERT INTO mail_recipient_history'))!;
    await env.DB.prepare(insert).run();
    expect(await searchSentRecipients(env, profile, 'cached')).toEqual([{
      name: 'Cached Person', address: 'cached@example.com', lastSentAt: now.toISOString(),
    }]);
  });
});

describe('recipient history indexing', () => {
  it('indexes historical To/Cc/Bcc, accepts sent aliases, and skips drafts and incoming mail', async () => {
    await account('work');
    await env.DB.prepare(`UPDATE google_accounts SET recipient_history_backfill_pending = 1,
      newest_history_id = 'existing-history' WHERE profile_id = ?`).bind(profile).run();
    const key = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    await env.DB.prepare(`INSERT INTO google_credentials
      (profile_id, account_id, refresh_token_ciphertext, access_token_ciphertext, access_token_expires_at, granted_scopes, created_at, updated_at)
      VALUES (?, 'work', ?, ?, ?, 'gmail.modify', ?, ?)`)
      .bind(profile, await sealSecret('refresh-token', key), await sealSecret('access-token', key),
        '2026-09-26T14:00:00.000Z', now.toISOString(), now.toISOString()).run();
    const message = (id: string, labelIds: string[], headers: Array<{ name: string; value: string }>, offset: number) => ({
      id, threadId: 'historical', labelIds, internalDate: String(now.getTime() + offset), snippet: 'Hello',
      payload: { mimeType: 'text/plain', headers, body: { data: encodeBase64Url('Hello') } },
    });
    const sentHeaders = [
      { name: 'From', value: 'Team <alias@example.com>' },
      { name: 'To', value: Array.from({ length: 55 }, (_, index) => `Person ${index} <person${index}@example.com>`).join(', ') },
      { name: 'Cc', value: 'Copy Person <copy@example.com>' },
      { name: 'Bcc', value: 'Private Person <private@example.com>' },
    ];
    const messages = [
      message('old-sent', ['SENT'], sentHeaders, -30_000),
      message('draft', ['DRAFT', 'SENT'], [{ name: 'To', value: 'draft@example.com' }], -29_000),
      ...Array.from({ length: 20 }, (_, index) => message(`incoming-${index}`, ['INBOX'], [
        { name: 'From', value: 'Stranger <stranger@example.com>' },
        { name: 'To', value: 'Incoming Only <incoming@example.com>' },
      ], -20_000 + index)),
    ];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname.endsWith('/profile')) return Response.json({ historyId: 'new-history' });
      if (url.pathname.endsWith('/threads')) {
        return url.searchParams.has('pageToken')
          ? Response.json({ threads: [] })
          : Response.json({ threads: [{ id: 'historical' }], nextPageToken: 'older-page' });
      }
      if (url.pathname.endsWith('/threads/historical')) return Response.json({ id: 'historical', historyId: 'new-history', messages });
      if (url.pathname.endsWith('/history')) return Response.json({ historyId: 'new-history', history: [] });
      throw new Error(`Unexpected request ${url}`);
    });
    // An upgraded account starts a full pass even if its normal history cursor is current.
    await syncGoogleMailbox(env, { profileId: profile, accountId: 'work', mode: 'partial' }, now);
    expect(await env.DB.prepare('SELECT count(*) AS count FROM mail_recipient_history WHERE profile_id = ?').bind(profile).first()).toEqual({ count: 57 });
    expect(await searchSentRecipients(env, profile, 'copy')).toHaveLength(1);
    expect(await searchSentRecipients(env, profile, 'private')).toHaveLength(1);
    expect(await searchSentRecipients(env, profile, 'person54')).toHaveLength(1);
    expect(await searchSentRecipients(env, profile, 'draft')).toEqual([]);
    expect(await searchSentRecipients(env, profile, 'incoming')).toEqual([]);
    expect(await searchSentRecipients(env, profile, 'stranger')).toEqual([]);
    expect(await env.DB.prepare(`SELECT count(*) AS count FROM mail_messages WHERE profile_id = ?`).bind(profile).first()).toEqual({ count: 22 });
    expect(await env.DB.prepare(`SELECT recipient_history_backfill_pending, backfill_page_token FROM google_accounts WHERE profile_id = ?`).bind(profile).first()).toEqual({
      recipient_history_backfill_pending: 0, backfill_page_token: 'older-page',
    });
    await syncGoogleMailbox(env, { profileId: profile, accountId: 'work', mode: 'continue', pageToken: 'older-page' }, now);
    await syncGoogleMailbox(env, { profileId: profile, accountId: 'work', mode: 'partial' }, now);
    expect(String(fetchSpy.mock.calls.at(-1)?.[0])).toContain('/history?');
    await syncGoogleMailbox(env, { profileId: profile, accountId: 'work', mode: 'newest' }, now);
    expect(await env.DB.prepare('SELECT count(*) AS count FROM mail_recipient_history WHERE profile_id = ?').bind(profile).first()).toEqual({ count: 57 });
    // Reader retention/removal does not destroy contacts; removing the account does.
    await env.DB.prepare('DELETE FROM mail_threads WHERE profile_id = ?').bind(profile).run();
    expect(await searchSentRecipients(env, profile, 'private')).toHaveLength(1);
    await env.DB.prepare('DELETE FROM google_accounts WHERE profile_id = ?').bind(profile).run();
    expect(await searchSentRecipients(env, profile, 'private')).toEqual([]);
  });
});
