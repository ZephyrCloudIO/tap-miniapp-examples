import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeBase64Url, sealSecret } from '../src/crypto';
import { mailboxSnapshot, syncGoogleMailbox } from '../src/mailbox';

const now = new Date('2026-08-18T15:30:00.000Z');
const encryptionKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Google mailbox synchronization', () => {
  it('hydrates newest mail first and keeps message bodies encrypted in D1', async () => {
    const accessToken = await sealSecret('access-token', encryptionKey);
    const refreshToken = await sealSecret('refresh-token', encryptionKey);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO google_accounts
           (profile_id, account_id, google_subject, connection_state,
            coverage_state, newest_history_id, unresolved_failures,
            email_address, display_name, accent, created_at, updated_at)
         VALUES ('profile_1', 'google_1', 'subject_1', 'active', 'backfilling',
                 'history_9', 0, 'zack@example.com', 'Zack', '#74a7a1', ?, ?)`,
      ).bind(now.toISOString(), now.toISOString()),
      env.DB.prepare(
        `INSERT INTO google_credentials
           (profile_id, account_id, refresh_token_ciphertext,
            access_token_ciphertext, access_token_expires_at, granted_scopes,
            created_at, updated_at)
         VALUES ('profile_1', 'google_1', ?, ?, ?, 'gmail.modify', ?, ?)`,
      ).bind(
        refreshToken,
        accessToken,
        '2026-08-18T17:30:00.000Z',
        now.toISOString(),
        now.toISOString(),
      ),
    ]);

    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === '/gmail/v1/users/me/threads') {
        expect(url.searchParams.get('labelIds')).toBe('INBOX');
        expect(url.searchParams.get('maxResults')).toBe('25');
        return Response.json({ threads: [{ id: 'thread_1' }] });
      }
      if (url.pathname === '/gmail/v1/users/me/profile') {
        return Response.json({ emailAddress: 'zack@example.com', historyId: 'history_10' });
      }
      if (url.pathname === '/gmail/v1/users/me/threads/thread_1') {
        return Response.json({
          id: 'thread_1',
          historyId: 'history_10',
          messages: [
            {
              id: 'message_1',
              threadId: 'thread_1',
              labelIds: ['INBOX', 'UNREAD', 'IMPORTANT'],
              internalDate: String(Date.parse('2026-08-18T15:20:00.000Z')),
              snippet: 'Can you review the launch plan?',
              payload: {
                mimeType: 'multipart/alternative',
                headers: [
                  { name: 'From', value: 'Maya Chen <maya@example.com>' },
                  { name: 'To', value: 'Zack <zack@example.com>' },
                  { name: 'Subject', value: 'Launch review' },
                  { name: 'Message-ID', value: '<message-1@example.com>' },
                ],
                parts: [
                  {
                    mimeType: 'text/plain',
                    body: { data: encodeBase64Url('Please review the launch plan.') },
                  },
                ],
              },
            },
          ],
        });
      }
      throw new Error(`Unexpected Google request: ${url}`);
    });

    await syncGoogleMailbox(
      env,
      {
        profileId: 'profile_1',
        accountId: 'google_1',
        mode: 'newest',
      },
      now,
    );

    const stored = await env.DB.prepare(
      `SELECT body_text_ciphertext FROM mail_messages
        WHERE profile_id = 'profile_1' AND message_id = 'message_1'`,
    ).first<{ body_text_ciphertext: string }>();
    expect(stored?.body_text_ciphertext).toMatch(/^v1\./u);
    expect(stored?.body_text_ciphertext).not.toContain('Please review');

    const snapshot = await mailboxSnapshot(env, 'profile_1');
    expect(snapshot).toMatchObject({
      accounts: [
        {
          accountId: 'google_1',
          coverage: { state: 'current', newestHistoryId: 'history_10' },
        },
      ],
      threads: [
        {
          threadId: 'thread_1',
          critical: true,
          needsResponse: true,
          messages: [{ bodyText: 'Please review the launch plan.' }],
        },
      ],
    });
  });

  it('keeps the last cached inbox intact when a newest-page refresh fails', async () => {
    const accessToken = await sealSecret('access-token', encryptionKey);
    const refreshToken = await sealSecret('refresh-token', encryptionKey);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO google_accounts
           (profile_id, account_id, google_subject, connection_state,
            coverage_state, newest_history_id, unresolved_failures,
            email_address, created_at, updated_at)
         VALUES ('profile_failure', 'google_failure', 'subject_failure', 'active',
                 'current', 'history_8', 0, 'cached@example.com', ?, ?)`,
      ).bind(now.toISOString(), now.toISOString()),
      env.DB.prepare(
        `INSERT INTO google_credentials
           (profile_id, account_id, refresh_token_ciphertext,
            access_token_ciphertext, access_token_expires_at, granted_scopes,
            created_at, updated_at)
         VALUES ('profile_failure', 'google_failure', ?, ?, ?, 'gmail.modify', ?, ?)`,
      ).bind(
        refreshToken,
        accessToken,
        '2026-08-18T17:30:00.000Z',
        now.toISOString(),
        now.toISOString(),
      ),
      env.DB.prepare(
        `INSERT INTO mail_threads
           (profile_id, account_id, thread_id, history_id, subject, snippet,
            participants_json, received_at, unread, starred, important,
            in_inbox, needs_response, waiting_on_others, label_ids_json, updated_at)
         VALUES ('profile_failure', 'google_failure', 'cached_thread', 'history_8',
                 'Cached thread', 'Still visible', '[]', ?, 1, 0, 0, 1, 1, 0,
                 '["INBOX"]', ?)`,
      ).bind(now.toISOString(), now.toISOString()),
    ]);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      Response.json({ error: { message: 'unavailable' } }, { status: 503 }),
    );

    await expect(syncGoogleMailbox(
      env,
      {
        profileId: 'profile_failure',
        accountId: 'google_failure',
        mode: 'newest',
      },
      now,
    )).rejects.toMatchObject({ code: 'google_temporarily_unavailable' });

    const cached = await env.DB.prepare(
      `SELECT in_inbox FROM mail_threads
        WHERE profile_id = 'profile_failure' AND account_id = 'google_failure'
          AND thread_id = 'cached_thread'`,
    ).first<{ in_inbox: number }>();
    expect(cached?.in_inbox).toBe(1);
  });
});
