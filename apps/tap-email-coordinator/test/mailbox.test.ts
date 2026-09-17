import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeBase64Url, openSecret, sealSecret } from '../src/crypto';
import {
  freshGoogleThreadHasExternalReplyAfter,
  mailboxPage,
  mailboxSnapshot,
  requestAccountSync,
  syncGoogleMailbox,
  threadSnapshot,
} from '../src/mailbox';

const now = new Date('2026-08-18T15:30:00.000Z');
const encryptionKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fresh scheduled-send reply barrier', () => {
  it('reads the exact Gmail thread and recognizes only newer external mail', async () => {
    const accessToken = await sealSecret('access-token', encryptionKey);
    const refreshToken = await sealSecret('refresh-token', encryptionKey);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO google_accounts
           (profile_id, account_id, google_subject, connection_state,
            coverage_state, unresolved_failures, email_address, created_at, updated_at)
         VALUES ('profile_barrier', 'google_barrier', 'subject_barrier', 'active',
                 'current', 0, 'zack@example.com', ?, ?)`,
      ).bind(now.toISOString(), now.toISOString()),
      env.DB.prepare(
        `INSERT INTO google_credentials
           (profile_id, account_id, refresh_token_ciphertext,
            access_token_ciphertext, access_token_expires_at, granted_scopes,
            created_at, updated_at)
         VALUES ('profile_barrier', 'google_barrier', ?, ?, ?, 'gmail.modify', ?, ?)`,
      ).bind(
        refreshToken,
        accessToken,
        '2026-08-18T17:30:00.000Z',
        now.toISOString(),
        now.toISOString(),
      ),
    ]);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      expect(url.pathname).toBe('/gmail/v1/users/me/threads/thread_barrier');
      expect(url.searchParams.get('format')).toBe('full');
      return Response.json({
        id: 'thread_barrier',
        historyId: 'history_barrier',
        messages: [
          {
            id: 'message_self',
            threadId: 'thread_barrier',
            labelIds: ['SENT'],
            internalDate: String(Date.parse('2026-08-18T15:10:00.000Z')),
            snippet: 'Checking in',
            payload: {
              mimeType: 'text/plain',
              headers: [
                { name: 'From', value: 'Zack <zack@example.com>' },
                { name: 'To', value: 'Maya <maya@example.com>' },
                { name: 'Subject', value: 'Checking in' },
              ],
              body: { data: encodeBase64Url('Checking in') },
            },
          },
          {
            id: 'message_reply',
            threadId: 'thread_barrier',
            labelIds: ['INBOX'],
            internalDate: String(Date.parse('2026-08-18T15:25:00.000Z')),
            snippet: 'Thanks for the note',
            payload: {
              mimeType: 'text/plain',
              headers: [
                { name: 'From', value: 'Maya <maya@example.com>' },
                { name: 'To', value: 'Zack <zack@example.com>' },
                { name: 'Subject', value: 'Re: Checking in' },
              ],
              body: { data: encodeBase64Url('Thanks for the note') },
            },
          },
        ],
      });
    });

    await expect(freshGoogleThreadHasExternalReplyAfter(
      env,
      'profile_barrier',
      'google_barrier',
      'thread_barrier',
      '2026-08-18T15:20:00.000Z',
      now,
    )).resolves.toBe(true);
    await expect(freshGoogleThreadHasExternalReplyAfter(
      env,
      'profile_barrier',
      'google_barrier',
      'thread_barrier',
      '2026-08-18T15:26:00.000Z',
      now,
    )).resolves.toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe('Google mailbox synchronization', () => {
  it('sweeps provider rows and content not observed in a completed full sync', async () => {
    const accessToken = await sealSecret('access-token', encryptionKey);
    const refreshToken = await sealSecret('refresh-token', encryptionKey);
    const staleBody = await sealSecret('stale body', encryptionKey);
    const old = '2026-08-01T12:00:00.000Z';
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO google_accounts
           (profile_id, account_id, google_subject, connection_state,
            coverage_state, newest_history_id, unresolved_failures,
            email_address, created_at, updated_at)
         VALUES ('profile_sweep', 'google_sweep', 'subject_sweep', 'active',
                 'current', 'history_old', 0, 'sweep@example.com', ?, ?)`,
      ).bind(old, old),
      env.DB.prepare(
        `INSERT INTO google_credentials
           (profile_id, account_id, refresh_token_ciphertext,
            access_token_ciphertext, access_token_expires_at, granted_scopes,
            created_at, updated_at)
         VALUES ('profile_sweep', 'google_sweep', ?, ?, ?, 'gmail.modify', ?, ?)`,
      ).bind(refreshToken, accessToken, '2026-08-18T17:30:00.000Z', old, old),
      env.DB.prepare(
        `INSERT INTO mail_threads
           (profile_id, account_id, thread_id, history_id, subject, snippet,
            participants_json, received_at, unread, starred, important,
            in_inbox, needs_response, waiting_on_others, label_ids_json, updated_at)
         VALUES ('profile_sweep', 'google_sweep', 'thread_deleted', 'history_old',
                 'Deleted at provider', 'stale', '[]', ?, 0, 0, 0, 1, 0, 0,
                 '["INBOX"]', ?)`,
      ).bind(old, old),
      env.DB.prepare(
        `INSERT INTO mail_messages
           (profile_id, account_id, thread_id, message_id, sender_json,
            recipients_json, sent_at, body_text_ciphertext, ordinal, updated_at)
         VALUES ('profile_sweep', 'google_sweep', 'thread_deleted', 'message_deleted',
                 '{"name":"Sender","address":"sender@example.com"}', '[]',
                 ?, ?, 0, ?)`,
      ).bind(old, staleBody, old),
      env.DB.prepare(
        `INSERT INTO tap_reminders
           (profile_id, account_id, reminder_id, thread_id, due_at, condition,
            state, created_at, updated_at)
         VALUES ('profile_sweep', 'google_sweep', 'reminder_deleted',
                 'thread_deleted', ?, 'regardless', 'pending', ?, ?)`,
      ).bind('2026-08-20T12:00:00.000Z', old, old),
    ]);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === '/gmail/v1/users/me/threads') {
        return Response.json({ threads: [{ id: 'thread_current' }] });
      }
      if (url.pathname === '/gmail/v1/users/me/profile') {
        return Response.json({ emailAddress: 'sweep@example.com', historyId: 'history_current' });
      }
      if (url.pathname === '/gmail/v1/users/me/threads/thread_current') {
        return Response.json({
          id: 'thread_current',
          historyId: 'history_current',
          messages: [{
            id: 'message_current',
            threadId: 'thread_current',
            labelIds: ['INBOX'],
            internalDate: String(now.getTime()),
            snippet: 'current',
            payload: {
              mimeType: 'text/plain',
              headers: [
                { name: 'From', value: 'Sender <sender@example.com>' },
                { name: 'To', value: 'Sweep <sweep@example.com>' },
                { name: 'Subject', value: 'Current' },
              ],
              body: { data: encodeBase64Url('current') },
            },
          }],
        });
      }
      throw new Error(`Unexpected Google request: ${url}`);
    });

    await syncGoogleMailbox(env, {
      profileId: 'profile_sweep',
      accountId: 'google_sweep',
      mode: 'newest',
    }, now);

    expect((await env.DB.prepare(
      `SELECT thread_id FROM mail_threads
        WHERE profile_id = 'profile_sweep' ORDER BY thread_id`,
    ).all()).results).toEqual([{ thread_id: 'thread_current' }]);
    expect(await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM mail_messages
        WHERE profile_id = 'profile_sweep' AND message_id = 'message_deleted'`,
    ).first()).toEqual({ count: 0 });
    expect(await env.DB.prepare(
      `SELECT state FROM tap_reminders
        WHERE profile_id = 'profile_sweep' AND reminder_id = 'reminder_deleted'`,
    ).first()).toEqual({ state: 'cancelled' });
    expect(await env.DB.prepare(
      `SELECT sync_generation, last_full_sync_completed_at FROM google_accounts
        WHERE profile_id = 'profile_sweep' AND account_id = 'google_sweep'`,
    ).first()).toMatchObject({
      sync_generation: expect.stringMatching(/^mailbox_/u),
      last_full_sync_completed_at: now.toISOString(),
    });
  });

  it('exposes every cached thread through stable pages beyond the old 100-row boundary', async () => {
    for (const accountId of ['google_page_a', 'google_page_b']) {
      await env.DB.prepare(
        `INSERT INTO google_accounts
           (profile_id, account_id, google_subject, connection_state,
            coverage_state, unresolved_failures, email_address, created_at, updated_at)
         VALUES ('profile_page', ?, ?, 'active', 'current', 0, ?, ?, ?)`,
      ).bind(
        accountId,
        `subject_${accountId}`,
        `${accountId}@example.com`,
        now.toISOString(),
        now.toISOString(),
      ).run();
    }
    await env.DB.prepare(
      `WITH RECURSIVE sequence(value) AS (
         SELECT 1
         UNION ALL
         SELECT value + 1 FROM sequence WHERE value < 50
       )
       INSERT INTO mail_threads
         (profile_id, account_id, thread_id, history_id, subject, snippet,
          participants_json, received_at, unread, starred, important,
          in_inbox, needs_response, waiting_on_others, label_ids_json, updated_at)
       SELECT 'profile_page', 'google_page_a', printf('thread_%03d', value),
              'history_1', 'Page test', 'Cached mail', '[]',
              '2026-09-08T12:00:00.000Z', 0, 0, 0, 1, 0, 0, '[]', ?
         FROM sequence`,
    ).bind(now.toISOString()).run();
    await env.DB.prepare(
      `WITH RECURSIVE sequence(value) AS (
         SELECT 1
         UNION ALL
         SELECT value + 1 FROM sequence WHERE value < 51
       )
       INSERT INTO mail_threads
         (profile_id, account_id, thread_id, history_id, subject, snippet,
          participants_json, received_at, unread, starred, important,
          in_inbox, needs_response, waiting_on_others, label_ids_json, updated_at)
       SELECT 'profile_page', 'google_page_b', printf('thread_%03d', value),
              'history_1', 'Page test', 'Cached mail', '[]',
              '2026-09-08T12:00:00.000Z', 0, 0, 0, 1, 0, 0, '[]', ?
         FROM sequence`,
    ).bind(now.toISOString()).run();

    const first = await mailboxPage(env, 'profile_page');
    const firstThreads = (first.mailbox as {
      threads: Array<{ accountId: string; threadId: string }>;
    }).threads;
    expect(firstThreads).toHaveLength(100);
    expect(firstThreads[0]).toMatchObject({
      accountId: 'google_page_a',
      threadId: 'thread_001',
    });
    expect(firstThreads.at(-1)).toMatchObject({
      accountId: 'google_page_b',
      threadId: 'thread_050',
    });
    expect(first.pageInfo.nextCursor).toEqual(expect.any(String));

    const second = await mailboxPage(env, 'profile_page', {
      cursor: first.pageInfo.nextCursor!,
    });
    expect((second.mailbox as { threads: unknown[] }).threads).toEqual([
      expect.objectContaining({
        accountId: 'google_page_b',
        threadId: 'thread_051',
      }),
    ]);
    expect(second.pageInfo.nextCursor).toBeNull();
  });

  it('projects Gmail labels into account-scoped resources and returns non-Inbox cache rows', async () => {
    const archivedBody = await sealSecret('Archived cached body.', encryptionKey);
    for (const accountId of ['google_resources_a', 'google_resources_b']) {
      await env.DB.prepare(
        `INSERT INTO google_accounts
           (profile_id, account_id, google_subject, connection_state,
            coverage_state, unresolved_failures, email_address, created_at, updated_at)
         VALUES ('profile_resources', ?, ?, 'active', 'current', 0, ?, ?, ?)`,
      ).bind(
        accountId,
        `subject_${accountId}`,
        `${accountId}@example.com`,
        now.toISOString(),
        now.toISOString(),
      ).run();
    }
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO mail_threads
           (profile_id, account_id, thread_id, history_id, subject, snippet,
            participants_json, received_at, unread, starred, important,
            in_inbox, needs_response, waiting_on_others, label_ids_json, updated_at)
         VALUES ('profile_resources', 'google_resources_a', 'shared_thread', 'history_a',
                 'Inbox draft', 'Inbox draft', '[]', '2026-08-18T15:00:00.000Z',
                 0, 1, 0, 1, 0, 0, '["DRAFT","INBOX","STARRED"]', ?)`,
      ).bind(now.toISOString()),
      env.DB.prepare(
        `INSERT INTO mail_threads
           (profile_id, account_id, thread_id, history_id, subject, snippet,
            participants_json, received_at, unread, starred, important,
            in_inbox, needs_response, waiting_on_others, label_ids_json, updated_at)
         VALUES ('profile_resources', 'google_resources_b', 'shared_thread', 'history_b',
                 'Sent to trash', 'Sent to trash', '[]', '2026-08-18T14:00:00.000Z',
                 0, 0, 0, 0, 0, 0, '["SENT","SPAM","TRASH"]', ?)`,
      ).bind(now.toISOString()),
      env.DB.prepare(
        `INSERT INTO mail_threads
           (profile_id, account_id, thread_id, history_id, subject, snippet,
            participants_json, received_at, unread, starred, important,
            in_inbox, needs_response, waiting_on_others, label_ids_json, updated_at)
         VALUES ('profile_resources', 'google_resources_a', 'archived_thread', 'history_c',
                 'Archived', 'Archived', '[]', '2026-08-18T13:00:00.000Z',
                 0, 0, 0, 0, 0, 0, '["CATEGORY_PERSONAL"]', ?)`,
      ).bind(now.toISOString()),
      env.DB.prepare(
        `INSERT INTO mail_messages
           (profile_id, account_id, thread_id, message_id, internet_message_id,
            sender_json, recipients_json, sent_at, body_text_ciphertext,
            ordinal, updated_at)
         VALUES ('profile_resources', 'google_resources_a', 'archived_thread',
                 'archived_message', NULL,
                 '{"name":"Sender","address":"sender@example.com"}', '[]',
                 '2026-08-18T13:00:00.000Z', ?, 0, ?)`,
      ).bind(archivedBody, now.toISOString()),
    ]);

    const snapshot = await mailboxSnapshot(env, 'profile_resources') as {
      threads: Array<{
        accountId: string;
        threadId: string;
        providerResources: string[];
        status: string;
        messages: Array<{ bodyText: string }>;
      }>;
    };
    expect(snapshot.threads.map(thread => ({
      accountId: thread.accountId,
      threadId: thread.threadId,
      providerResources: thread.providerResources,
      status: thread.status,
    }))).toEqual([
      {
        accountId: 'google_resources_a',
        threadId: 'shared_thread',
        providerResources: ['inbox', 'starred', 'drafts'],
        status: 'inbox',
      },
      {
        accountId: 'google_resources_b',
        threadId: 'shared_thread',
        providerResources: ['sent', 'spam', 'trash'],
        status: 'trashed',
      },
      {
        accountId: 'google_resources_a',
        threadId: 'archived_thread',
        providerResources: [],
        status: 'done',
      },
    ]);
    expect(snapshot.threads[2]!.messages).toEqual([
      expect.objectContaining({ bodyText: '' }),
    ]);
  });

  it('persists and resumes Gmail backfill tokens until the oldest page completes', async () => {
    const accessToken = await sealSecret('access-token', encryptionKey);
    const refreshToken = await sealSecret('refresh-token', encryptionKey);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO google_accounts
           (profile_id, account_id, google_subject, connection_state,
            coverage_state, unresolved_failures, email_address, created_at, updated_at)
         VALUES ('profile_history', 'google_history', 'subject_history', 'active',
                 'backfilling', 0, 'history@example.com', ?, ?)`,
      ).bind(now.toISOString(), now.toISOString()),
      env.DB.prepare(
        `INSERT INTO google_credentials
           (profile_id, account_id, refresh_token_ciphertext,
            access_token_ciphertext, access_token_expires_at, granted_scopes,
            created_at, updated_at)
         VALUES ('profile_history', 'google_history', ?, ?, ?, 'gmail.modify', ?, ?)`,
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
      if (url.pathname === '/gmail/v1/users/me/profile') {
        return Response.json({ emailAddress: 'history@example.com', historyId: 'history_20' });
      }
      if (url.pathname === '/gmail/v1/users/me/threads') {
        expect(url.searchParams.get('labelIds')).toBeNull();
        expect(url.searchParams.get('includeSpamTrash')).toBe('true');
        expect(url.searchParams.get('maxResults')).toBe('25');
        return url.searchParams.get('pageToken') === 'older-page'
          ? Response.json({ threads: [{ id: 'thread_old' }] })
          : Response.json({
              threads: [{ id: 'thread_new' }],
              nextPageToken: 'older-page',
            });
      }
      const threadId = url.pathname.split('/').at(-1);
      if (threadId === 'thread_new' || threadId === 'thread_old') {
        const format = url.searchParams.get('format');
        if (threadId === 'thread_new') expect(format).toBe('full');
        if (threadId === 'thread_old' && format !== 'full') {
          expect(format).toBe('metadata');
          expect(url.searchParams.getAll('metadataHeaders')).toContain('Subject');
        }
        const sentAt = threadId === 'thread_new'
          ? '2026-08-18T15:20:00.000Z'
          : '2026-07-01T12:00:00.000Z';
        return Response.json({
          id: threadId,
          historyId: 'history_20',
          messages: [{
            id: `message_${threadId}`,
            threadId,
            labelIds: ['INBOX'],
            internalDate: String(Date.parse(sentAt)),
            snippet: threadId,
            payload: {
              mimeType: 'text/plain',
              headers: [
                { name: 'From', value: 'Sender <sender@example.com>' },
                { name: 'To', value: 'History <history@example.com>' },
                { name: 'Subject', value: threadId },
              ],
              body: format === 'full' ? { data: encodeBase64Url(threadId) } : {},
            },
          }],
        });
      }
      throw new Error(`Unexpected Google request: ${url}`);
    });

    await syncGoogleMailbox(env, {
      profileId: 'profile_history',
      accountId: 'google_history',
      mode: 'newest',
    }, now);
    expect(await env.DB.prepare(
      `SELECT coverage_state, backfill_page_token, backfill_complete_through
         FROM google_accounts
        WHERE profile_id = 'profile_history' AND account_id = 'google_history'`,
    ).first()).toEqual({
      coverage_state: 'backfilling',
      backfill_page_token: 'older-page',
      backfill_complete_through: '2026-08-18T15:20:00.000Z',
    });
    const continuation = await env.DB.prepare(
      `SELECT payload_json FROM provider_events
        WHERE profile_id = 'profile_history' AND account_id = 'google_history'
        ORDER BY received_at DESC LIMIT 1`,
    ).first<{ payload_json: string }>();
    expect(JSON.parse(continuation?.payload_json ?? '{}')).toMatchObject({
      mode: 'continue',
      pageToken: 'older-page',
    });

    await syncGoogleMailbox(env, {
      profileId: 'profile_history',
      accountId: 'google_history',
      mode: 'continue',
      pageToken: 'older-page',
    }, now);
    expect(await env.DB.prepare(
      `SELECT coverage_state, backfill_page_token, backfill_complete_through
         FROM google_accounts
        WHERE profile_id = 'profile_history' AND account_id = 'google_history'`,
    ).first()).toEqual({
      coverage_state: 'current',
      backfill_page_token: null,
      backfill_complete_through: '2026-07-01T12:00:00.000Z',
    });
    expect((await env.DB.prepare(
      `SELECT thread_id, content_state FROM mail_threads
        WHERE profile_id = 'profile_history' AND account_id = 'google_history'
        ORDER BY received_at DESC`,
    ).all<{ thread_id: string; content_state: string }>()).results).toEqual([
      { thread_id: 'thread_new', content_state: 'full' },
      { thread_id: 'thread_old', content_state: 'metadata' },
    ]);
    await expect(threadSnapshot(
      env,
      'profile_history',
      'google_history',
      'thread_old',
      now,
    )).resolves.toMatchObject({
      messages: [{ bodyText: 'thread_old' }],
    });
    expect(await env.DB.prepare(
      `SELECT content_state FROM mail_threads
        WHERE profile_id = 'profile_history' AND account_id = 'google_history'
          AND thread_id = 'thread_old'`,
    ).first()).toEqual({ content_state: 'full' });
  });

  it('resumes a saved newest-first backfill instead of starting a partial sync', async () => {
    await env.DB.prepare(
      `INSERT INTO google_accounts
         (profile_id, account_id, google_subject, connection_state,
          coverage_state, newest_history_id, backfill_page_token,
          unresolved_failures, email_address, created_at, updated_at)
       VALUES ('profile_resume', 'google_resume', 'subject_resume', 'active',
               'blocked', 'history_10', 'next-page-2', 1,
               'resume@example.com', ?, ?)`,
    ).bind(now.toISOString(), now.toISOString()).run();

    expect(await requestAccountSync(
      env,
      'profile_resume',
      'google_resume',
      now,
    )).toBe(true);

    expect(await env.DB.prepare(
      `SELECT coverage_state, backfill_page_token, last_sync_requested_at
         FROM google_accounts
        WHERE profile_id = 'profile_resume' AND account_id = 'google_resume'`,
    ).first()).toEqual({
      coverage_state: 'backfilling',
      backfill_page_token: 'next-page-2',
      last_sync_requested_at: now.toISOString(),
    });
    const event = await env.DB.prepare(
      `SELECT payload_json
         FROM provider_events
        WHERE profile_id = 'profile_resume' AND account_id = 'google_resume'`,
    ).first<{ payload_json: string }>();
    expect(JSON.parse(event?.payload_json ?? '{}')).toMatchObject({
      profileId: 'profile_resume',
      accountId: 'google_resume',
      mode: 'continue',
      pageToken: 'next-page-2',
    });
  });

  it('keeps a normal manual refresh on the incremental sync path', async () => {
    await env.DB.prepare(
      `INSERT INTO google_accounts
         (profile_id, account_id, google_subject, connection_state,
          coverage_state, newest_history_id, unresolved_failures,
          email_address, created_at, updated_at)
       VALUES ('profile_partial', 'google_partial', 'subject_partial', 'active',
               'current', 'history_10', 0, 'partial@example.com', ?, ?)`,
    ).bind(now.toISOString(), now.toISOString()).run();

    expect(await requestAccountSync(
      env,
      'profile_partial',
      'google_partial',
      now,
    )).toBe(true);

    const event = await env.DB.prepare(
      `SELECT payload_json
         FROM provider_events
        WHERE profile_id = 'profile_partial' AND account_id = 'google_partial'`,
    ).first<{ payload_json: string }>();
    expect(JSON.parse(event?.payload_json ?? '{}')).toMatchObject({
      profileId: 'profile_partial',
      accountId: 'google_partial',
      mode: 'partial',
    });
    expect(JSON.parse(event?.payload_json ?? '{}')).not.toHaveProperty('pageToken');
  });

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
        expect(url.searchParams.get('labelIds')).toBeNull();
        expect(url.searchParams.get('includeSpamTrash')).toBe('true');
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
                  {
                    mimeType: 'text/html',
                    body: {
                      data: encodeBase64Url(
                        '<main><h1>Launch plan</h1><p>Please <strong>review</strong> it.</p></main>',
                      ),
                    },
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
      `SELECT body_text_ciphertext, body_html_ciphertext FROM mail_messages
        WHERE profile_id = 'profile_1' AND message_id = 'message_1'`,
    ).first<{ body_text_ciphertext: string; body_html_ciphertext: string | null }>();
    expect(stored?.body_text_ciphertext).toMatch(/^v1\./u);
    expect(stored?.body_html_ciphertext).toMatch(/^v1\./u);
    expect(stored?.body_text_ciphertext).not.toContain('Please review');
    expect(stored?.body_html_ciphertext).not.toContain('<main>');
    await expect(openSecret(stored!.body_html_ciphertext!, encryptionKey)).resolves.toBe(
      '<main><h1>Launch plan</h1><p>Please <strong>review</strong> it.</p></main>',
    );

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
          messages: [{ bodyText: '' }],
        },
      ],
    });
    expect(JSON.stringify(snapshot)).not.toContain('bodyHtml');

    await expect(threadSnapshot(env, 'profile_1', 'google_1', 'thread_1', now)).resolves.toMatchObject({
      messages: [
        {
          bodyText: 'Please review the launch plan.',
          bodyHtml: '<main><h1>Launch plan</h1><p>Please <strong>review</strong> it.</p></main>',
        },
      ],
    });
  });

  it('requests an authoritative full repair when durable sync failures are unresolved', async () => {
    await env.DB.prepare(
      `INSERT INTO google_accounts
         (profile_id, account_id, google_subject, connection_state,
          coverage_state, newest_history_id, unresolved_failures,
          email_address, created_at, updated_at)
       VALUES ('profile_repair', 'google_repair', 'subject_repair', 'active',
               'stale', 'history_10', 2, 'repair@example.com', ?, ?)`,
    ).bind(now.toISOString(), now.toISOString()).run();

    expect(await requestAccountSync(
      env,
      'profile_repair',
      'google_repair',
      now,
    )).toBe(true);

    const event = await env.DB.prepare(
      `SELECT payload_json
         FROM provider_events
        WHERE profile_id = 'profile_repair' AND account_id = 'google_repair'`,
    ).first<{ payload_json: string }>();
    expect(JSON.parse(event?.payload_json ?? '{}')).toMatchObject({
      profileId: 'profile_repair',
      accountId: 'google_repair',
      mode: 'newest',
    });
  });

  it('persists provider-neutral attachment metadata without treating attached text as the body', async () => {
    const accessToken = await sealSecret('access-token', encryptionKey);
    const refreshToken = await sealSecret('refresh-token', encryptionKey);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO google_accounts
           (profile_id, account_id, google_subject, connection_state,
            coverage_state, newest_history_id, unresolved_failures,
            email_address, created_at, updated_at)
         VALUES ('profile_attachments', 'google_attachments', 'subject_attachments',
                 'active', 'backfilling', 'history_1', 0,
                 'owner@example.com', ?, ?)`,
      ).bind(now.toISOString(), now.toISOString()),
      env.DB.prepare(
        `INSERT INTO google_credentials
           (profile_id, account_id, refresh_token_ciphertext,
            access_token_ciphertext, access_token_expires_at, granted_scopes,
            created_at, updated_at)
         VALUES ('profile_attachments', 'google_attachments', ?, ?, ?,
                 'gmail.modify', ?, ?)`,
      ).bind(
        refreshToken,
        accessToken,
        '2026-08-18T17:30:00.000Z',
        now.toISOString(),
        now.toISOString(),
      ),
    ]);

    let includePdf = true;
    let floodAttachments = false;
    const paths: string[] = [];
    const persistenceBatchSizes: number[] = [];
    const instrumentedDatabase: D1Database = {
      prepare: query => env.DB.prepare(query),
      batch: <T = unknown>(statements: D1PreparedStatement[]) => {
        persistenceBatchSizes.push(statements.length);
        return env.DB.batch<T>(statements);
      },
      exec: query => env.DB.exec(query),
      withSession: constraintOrBookmark => env.DB.withSession(constraintOrBookmark),
      dump: () => env.DB.dump(),
    };
    const instrumentedEnv = { ...env, DB: instrumentedDatabase };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      paths.push(url.pathname);
      if (url.pathname === '/gmail/v1/users/me/threads') {
        return Response.json({ threads: [{ id: 'thread_attachments' }] });
      }
      if (url.pathname === '/gmail/v1/users/me/profile') {
        return Response.json({ emailAddress: 'owner@example.com', historyId: 'history_2' });
      }
      if (url.pathname === '/gmail/v1/users/me/threads/thread_attachments') {
        if (floodAttachments) {
          const messages = [0, 1].map(messageIndex => ({
            id: `message_attachment_flood_${messageIndex}`,
            threadId: 'thread_attachments',
            labelIds: ['INBOX'],
            internalDate: String(now.getTime() + messageIndex),
            snippet: 'Many attachments',
            payload: {
              mimeType: 'multipart/mixed',
              headers: [
                { name: 'From', value: 'Sender <sender@example.com>' },
                { name: 'To', value: 'Owner <owner@example.com>' },
                { name: 'Subject', value: 'Attachment test' },
              ],
              parts: Array.from({ length: 60 }, (_, attachmentIndex) => ({
                partId: `attachment_${messageIndex}_${attachmentIndex}`,
                filename: `attachment-${messageIndex}-${attachmentIndex}.bin`,
                mimeType: 'application/octet-stream',
                headers: [{ name: 'Content-Disposition', value: 'attachment' }],
                body: {
                  size: 1,
                  attachmentId: `gmail_attachment_${messageIndex}_${attachmentIndex}`,
                },
              })),
            },
          }));
          return Response.json({
            id: 'thread_attachments',
            historyId: 'history_3',
            messages,
          });
        }
        const parts: Array<Readonly<Record<string, unknown>>> = [
          {
            partId: '0',
            filename: 'notes\u061c\u200e\u200f.txt',
            mimeType: 'text/plain',
            headers: [{ name: 'Content-Disposition', value: 'attachment' }],
            body: { size: 17, data: encodeBase64Url('not the mail body') },
          },
          {
            partId: '1',
            filename: 'decorated-container.mime',
            mimeType: 'multipart/alternative',
            headers: [{ name: 'Content-Disposition', value: 'attachment' }],
            parts: [
              {
                partId: '1.0',
                mimeType: 'text/plain',
                body: { data: encodeBase64Url('This is the actual message.') },
              },
              {
                partId: '1.1',
                mimeType: 'text/html',
                headers: [
                  { name: 'Content-Disposition', value: 'inline' },
                  { name: 'Content-ID', value: '<body@example>' },
                ],
                body: { data: encodeBase64Url('<p>This is the <b>actual message</b>.</p>') },
              },
            ],
          },
          {
            partId: '3',
            filename: 'logo.png',
            mimeType: 'image/png',
            headers: [
              { name: 'Content-Disposition', value: 'inline' },
              { name: 'Content-ID', value: '<logo@example>' },
            ],
            body: { size: 3, data: encodeBase64Url('PNG') },
          },
        ];
        if (includePdf) {
          parts.splice(2, 0, {
            partId: '2',
            filename: 'brief.pdf',
            mimeType: 'application/pdf',
            headers: [{ name: 'Content-Disposition', value: 'attachment' }],
            body: { size: 3, attachmentId: 'gmail_secret_locator' },
          });
        }
        return Response.json({
          id: 'thread_attachments',
          historyId: 'history_2',
          messages: [{
            id: 'message_attachments',
            threadId: 'thread_attachments',
            labelIds: ['INBOX'],
            internalDate: String(now.getTime()),
            snippet: 'This is the actual message.',
            payload: {
              mimeType: 'multipart/mixed',
              headers: [
                { name: 'From', value: 'Sender <sender@example.com>' },
                { name: 'To', value: 'Owner <owner@example.com>' },
                { name: 'Subject', value: 'Attachment test' },
              ],
              parts,
            },
          }],
        });
      }
      throw new Error(`Unexpected Google request: ${url}`);
    });

    const sync = (targetEnv: Env = env) => syncGoogleMailbox(targetEnv, {
      profileId: 'profile_attachments',
      accountId: 'google_attachments',
      mode: 'newest' as const,
    }, now);
    await sync();

    const snapshot = await threadSnapshot(
      env,
      'profile_attachments',
      'google_attachments',
      'thread_attachments',
      now,
    ) as { messages: Array<Record<string, unknown>> };
    expect(snapshot.messages[0]).toMatchObject({
      bodyText: 'This is the actual message.',
      bodyHtml: '<p>This is the <b>actual message</b>.</p>',
      attachments: [
        {
          fileName: 'notes.txt',
          mimeType: 'text/plain',
          sizeBytes: 17,
          disposition: 'attachment',
          contentId: null,
        },
        {
          fileName: 'brief.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 3,
          disposition: 'attachment',
          contentId: null,
        },
        {
          fileName: 'logo.png',
          mimeType: 'image/png',
          sizeBytes: 3,
          disposition: 'inline',
          contentId: 'logo@example',
        },
      ],
    });
    const attachments = snapshot.messages[0]!.attachments as Array<{ resourceId: string }>;
    expect(new Set(attachments.map(attachment => attachment.resourceId)).size).toBe(3);
    expect(attachments.every(attachment => /^att_[A-Za-z0-9_-]{43}$/u.test(attachment.resourceId))).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain('gmail_secret_locator');
    expect(JSON.stringify(snapshot)).not.toContain(encodeBase64Url('PNG'));
    expect(paths.some(path => path.includes('/attachments/'))).toBe(false);
    const logoResourceId = (snapshot.messages[0]!.attachments as Array<{
      fileName: string;
      resourceId: string;
    }>).find(attachment => attachment.fileName === 'logo.png')!.resourceId;

    const stored = await env.DB.prepare(
      `SELECT file_name, gmail_part_path, gmail_attachment_id_ciphertext
         FROM mail_attachments
        WHERE profile_id = 'profile_attachments'
        ORDER BY gmail_part_path`,
    ).all<{
      file_name: string;
      gmail_part_path: string;
      gmail_attachment_id_ciphertext: string | null;
    }>();
    expect(stored.results.map(row => ({
      fileName: row.file_name,
      partPath: row.gmail_part_path,
      hasProviderLocator: row.gmail_attachment_id_ciphertext !== null,
    }))).toEqual([
      { fileName: 'notes.txt', partPath: 'id:0', hasProviderLocator: false },
      { fileName: 'brief.pdf', partPath: 'id:2', hasProviderLocator: true },
      { fileName: 'logo.png', partPath: 'id:3', hasProviderLocator: false },
    ]);
    expect(stored.results[1]!.gmail_attachment_id_ciphertext).not.toContain(
      'gmail_secret_locator',
    );
    await expect(openSecret(
      stored.results[1]!.gmail_attachment_id_ciphertext!,
      encryptionKey,
    )).resolves.toBe('gmail_secret_locator');

    const mailbox = await mailboxSnapshot(env, 'profile_attachments') as {
      threads: Array<{ messages: Array<Record<string, unknown>> }>;
    };
    expect(mailbox.threads[0]!.messages[0]!.attachments).toHaveLength(3);

    includePdf = false;
    await sync();
    expect((await env.DB.prepare(
      `SELECT file_name FROM mail_attachments
        WHERE profile_id = 'profile_attachments'
        ORDER BY gmail_part_path`,
    ).all<{ file_name: string }>()).results).toEqual([
      { file_name: 'notes.txt' },
      { file_name: 'logo.png' },
    ]);
    const refreshed = await threadSnapshot(
      env,
      'profile_attachments',
      'google_attachments',
      'thread_attachments',
      now,
    ) as { messages: Array<{ attachments: Array<{ fileName: string; resourceId: string }> }> };
    expect(refreshed.messages[0]!.attachments.find(
      attachment => attachment.fileName === 'logo.png',
    )?.resourceId).toBe(logoResourceId);

    floodAttachments = true;
    await sync(instrumentedEnv);
    expect(persistenceBatchSizes).toEqual([4, 3]);
    expect(await env.DB.prepare(
      `SELECT COUNT(*) AS attachment_count FROM mail_attachments
        WHERE profile_id = 'profile_attachments' AND thread_id = 'thread_attachments'`,
    ).first<{ attachment_count: number }>()).toEqual({ attachment_count: 100 });
    expect((await env.DB.prepare(
      `SELECT message_id, COUNT(*) AS attachment_count
         FROM mail_attachments
        WHERE profile_id = 'profile_attachments' AND thread_id = 'thread_attachments'
        GROUP BY message_id
        ORDER BY message_id`,
    ).all<{ message_id: string; attachment_count: number }>()).results).toEqual([
      { message_id: 'message_attachment_flood_0', attachment_count: 40 },
      { message_id: 'message_attachment_flood_1', attachment_count: 60 },
    ]);
  });

  it('preserves HTML-only mail and derives a plain-text fallback', async () => {
    const accessToken = await sealSecret('access-token', encryptionKey);
    const refreshToken = await sealSecret('refresh-token', encryptionKey);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO google_accounts
           (profile_id, account_id, google_subject, connection_state,
            coverage_state, newest_history_id, unresolved_failures,
            email_address, created_at, updated_at)
         VALUES ('profile_html', 'google_html', 'subject_html', 'active',
                 'backfilling', 'history_1', 0, 'html@example.com', ?, ?)`,
      ).bind(now.toISOString(), now.toISOString()),
      env.DB.prepare(
        `INSERT INTO google_credentials
           (profile_id, account_id, refresh_token_ciphertext,
            access_token_ciphertext, access_token_expires_at, granted_scopes,
            created_at, updated_at)
         VALUES ('profile_html', 'google_html', ?, ?, ?, 'gmail.modify', ?, ?)`,
      ).bind(
        refreshToken,
        accessToken,
        '2026-08-18T17:30:00.000Z',
        now.toISOString(),
        now.toISOString(),
      ),
    ]);
    const html = `<article><style>.hero{color:red}</style><h1 class="hero">Rich alert</h1><p>Open dashboard.</p><div>${'x'.repeat(120_000)}</div><footer data-tail="preserved">Complete</footer></article>`;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === '/gmail/v1/users/me/threads') {
        return Response.json({ threads: [{ id: 'thread_html' }] });
      }
      if (url.pathname === '/gmail/v1/users/me/profile') {
        return Response.json({ emailAddress: 'html@example.com', historyId: 'history_2' });
      }
      if (url.pathname === '/gmail/v1/users/me/threads/thread_html') {
        return Response.json({
          id: 'thread_html',
          historyId: 'history_2',
          messages: [{
            id: 'message_html',
            threadId: 'thread_html',
            labelIds: ['INBOX'],
            internalDate: String(Date.parse('2026-08-18T15:25:00.000Z')),
            snippet: 'Rich alert',
            payload: {
              mimeType: 'text/html',
              headers: [
                { name: 'From', value: 'Alerts <alerts@example.com>' },
                { name: 'To', value: 'HTML <html@example.com>' },
                { name: 'Subject', value: 'HTML only' },
              ],
              body: { data: encodeBase64Url(html) },
            },
          }],
        });
      }
      throw new Error(`Unexpected Google request: ${url}`);
    });

    await syncGoogleMailbox(env, {
      profileId: 'profile_html',
      accountId: 'google_html',
      mode: 'newest',
    }, now);

    const snapshot = await threadSnapshot(
      env,
      'profile_html',
      'google_html',
      'thread_html',
      now,
    );
    expect(snapshot).toMatchObject({
      messages: [{ bodyHtml: html }],
    });
    const bodyText = (snapshot as { messages: Array<{ bodyText: string }> }).messages[0]!.bodyText;
    expect(bodyText).toContain('Rich alert');
    expect(bodyText).toContain('Open dashboard.');
    expect(bodyText).not.toContain('<style>');
    expect(bodyText).not.toContain('.hero');
  });

  it('falls back to legacy plain text, then lazily hydrates missing HTML', async () => {
    const accessToken = await sealSecret('access-token', encryptionKey);
    const refreshToken = await sealSecret('refresh-token', encryptionKey);
    const legacyText = await sealSecret('Cached legacy body.', encryptionKey);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO google_accounts
           (profile_id, account_id, google_subject, connection_state,
            coverage_state, newest_history_id, unresolved_failures,
            email_address, created_at, updated_at)
         VALUES ('profile_legacy', 'google_legacy', 'subject_legacy', 'active',
                 'current', 'history_4', 0, 'legacy@example.com', ?, ?)`,
      ).bind(now.toISOString(), now.toISOString()),
      env.DB.prepare(
        `INSERT INTO google_credentials
           (profile_id, account_id, refresh_token_ciphertext,
            access_token_ciphertext, access_token_expires_at, granted_scopes,
            created_at, updated_at)
         VALUES ('profile_legacy', 'google_legacy', ?, ?, ?, 'gmail.modify', ?, ?)`,
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
         VALUES ('profile_legacy', 'google_legacy', 'thread_legacy', 'history_4',
                 'Legacy thread', 'Cached legacy body.',
                 '[{"name":"Alerts","address":"alerts@example.com"}]', ?,
                 0, 0, 0, 1, 0, 0, '["INBOX"]', ?)`,
      ).bind(now.toISOString(), now.toISOString()),
      env.DB.prepare(
        `INSERT INTO mail_messages
           (profile_id, account_id, thread_id, message_id, internet_message_id,
            sender_json, recipients_json, sent_at, body_text_ciphertext,
            ordinal, updated_at)
         VALUES ('profile_legacy', 'google_legacy', 'thread_legacy',
                 'message_legacy', NULL,
                 '{"name":"Alerts","address":"alerts@example.com"}', '[]', ?, ?, 0, ?)`,
      ).bind(now.toISOString(), legacyText, now.toISOString()),
    ]);
    const html = '<main><h1>Hydrated alert</h1></main>';
    let gmailCalls = 0;
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      expect(url.pathname).toBe('/gmail/v1/users/me/threads/thread_legacy');
      gmailCalls += 1;
      if (gmailCalls === 1) {
        return Response.json({ error: { message: 'unavailable' } }, { status: 503 });
      }
      return Response.json({
        id: 'thread_legacy',
        historyId: 'history_5',
        messages: [{
          id: 'message_legacy',
          threadId: 'thread_legacy',
          labelIds: ['INBOX'],
          internalDate: String(now.getTime()),
          snippet: 'Hydrated alert',
          payload: {
            mimeType: 'multipart/alternative',
            headers: [
              { name: 'From', value: 'Alerts <alerts@example.com>' },
              { name: 'To', value: 'Legacy <legacy@example.com>' },
              { name: 'Subject', value: 'Legacy thread' },
            ],
            parts: [
              { mimeType: 'text/plain', body: { data: encodeBase64Url('Hydrated alert') } },
              { mimeType: 'text/html', body: { data: encodeBase64Url(html) } },
            ],
          },
        }],
      });
    });

    await expect(threadSnapshot(
      env,
      'profile_legacy',
      'google_legacy',
      'thread_legacy',
      now,
    )).resolves.toMatchObject({
      messages: [{ bodyText: 'Cached legacy body.', bodyHtml: null }],
    });
    expect(await env.DB.prepare(
      `SELECT body_html_ciphertext FROM mail_messages
        WHERE profile_id = 'profile_legacy' AND message_id = 'message_legacy'`,
    ).first()).toEqual({ body_html_ciphertext: null });

    await expect(threadSnapshot(
      env,
      'profile_legacy',
      'google_legacy',
      'thread_legacy',
      now,
    )).resolves.toMatchObject({
      messages: [{ bodyText: 'Hydrated alert', bodyHtml: html }],
    });
    const stored = await env.DB.prepare(
      `SELECT body_html_ciphertext FROM mail_messages
        WHERE profile_id = 'profile_legacy' AND message_id = 'message_legacy'`,
    ).first<{ body_html_ciphertext: string | null }>();
    expect(stored?.body_html_ciphertext).toMatch(/^v1\./u);
    await expect(openSecret(stored!.body_html_ciphertext!, encryptionKey)).resolves.toBe(html);
    expect(gmailCalls).toBe(2);
    expect(warning.mock.calls.map(([entry]) => String(entry)).join('\n')).not.toContain(legacyText);
  });

  it('recovers an oversized thread without blocking backfill and omits only oversized bodies', async () => {
    const accessToken = await sealSecret('access-token', encryptionKey);
    const refreshToken = await sealSecret('refresh-token', encryptionKey);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO google_accounts
           (profile_id, account_id, google_subject, connection_state,
            coverage_state, newest_history_id, unresolved_failures,
            email_address, created_at, updated_at)
         VALUES ('profile_large', 'google_large', 'subject_large', 'active',
                 'backfilling', 'history_19', 0, 'owner@example.com', ?, ?)`,
      ).bind(now.toISOString(), now.toISOString()),
      env.DB.prepare(
        `INSERT INTO google_credentials
           (profile_id, account_id, refresh_token_ciphertext,
            access_token_ciphertext, access_token_expires_at, granted_scopes,
            created_at, updated_at)
         VALUES ('profile_large', 'google_large', ?, ?, ?, 'gmail.modify', ?, ?)`,
      ).bind(
        refreshToken,
        accessToken,
        '2026-08-18T17:30:00.000Z',
        now.toISOString(),
        now.toISOString(),
      ),
    ]);
    const metadataMessages = [
      {
        id: 'message_small',
        threadId: 'thread_large',
        labelIds: ['INBOX'],
        internalDate: String(Date.parse('2026-08-18T15:10:00.000Z')),
        snippet: 'The bounded message',
        payload: {
          headers: [
            { name: 'From', value: 'Maya <maya@example.com>' },
            { name: 'To', value: 'Owner <owner@example.com>' },
            { name: 'Subject', value: 'Large conversation' },
            { name: 'Message-ID', value: '<small@example.com>' },
          ],
        },
      },
      {
        id: 'message_large',
        threadId: 'thread_large',
        labelIds: ['INBOX', 'UNREAD'],
        internalDate: String(Date.parse('2026-08-18T15:20:00.000Z')),
        snippet: 'The oversized message remains visible',
        payload: {
          headers: [
            { name: 'From', value: 'Maya <maya@example.com>' },
            { name: 'To', value: 'Owner <owner@example.com>' },
            { name: 'Subject', value: 'Large conversation' },
            { name: 'Message-ID', value: '<large@example.com>' },
          ],
        },
      },
    ];
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === '/gmail/v1/users/me/threads') {
        return Response.json({ threads: [{ id: 'thread_large' }] });
      }
      if (url.pathname === '/gmail/v1/users/me/profile') {
        return Response.json({ emailAddress: 'owner@example.com', historyId: 'history_20' });
      }
      if (url.pathname === '/gmail/v1/users/me/threads/thread_large') {
        if (url.searchParams.get('format') === 'full') {
          return new Response('{}', { headers: { 'Content-Length': '2097153' } });
        }
        expect(url.searchParams.get('format')).toBe('metadata');
        expect(url.searchParams.get('fields')).toContain('payload/headers');
        expect(url.searchParams.getAll('metadataHeaders')).toEqual([
          'From',
          'To',
          'Date',
          'Subject',
          'Message-ID',
          'List-Unsubscribe',
        ]);
        return Response.json({
          id: 'thread_large',
          historyId: 'history_20',
          messages: metadataMessages,
        });
      }
      if (url.pathname === '/gmail/v1/users/me/messages/message_small') {
        expect(url.searchParams.get('format')).toBe('full');
        return Response.json({
          ...metadataMessages[0],
          payload: {
            ...metadataMessages[0]!.payload,
            mimeType: 'text/plain',
            body: { data: encodeBase64Url('This body still hydrates.') },
          },
        });
      }
      if (url.pathname === '/gmail/v1/users/me/messages/message_large') {
        return new Response('{}', { headers: { 'Content-Length': '2097153' } });
      }
      throw new Error(`Unexpected Google request: ${url}`);
    });

    await expect(syncGoogleMailbox(
      env,
      {
        profileId: 'profile_large',
        accountId: 'google_large',
        mode: 'newest',
      },
      now,
    )).resolves.toBeUndefined();

    const stored = await env.DB.prepare(
      `SELECT message_id, body_text_ciphertext, body_html_ciphertext
         FROM mail_messages
        WHERE profile_id = 'profile_large' AND account_id = 'google_large'
        ORDER BY ordinal`,
    ).all<{
      message_id: string;
      body_text_ciphertext: string;
      body_html_ciphertext: string | null;
    }>();
    expect(stored.results.map(message => message.message_id)).toEqual([
      'message_small',
      'message_large',
    ]);
    await expect(Promise.all(stored.results.map(message =>
      openSecret(message.body_text_ciphertext, encryptionKey),
    ))).resolves.toEqual(['This body still hydrates.', '']);
    await expect(Promise.all(stored.results.map(message =>
      openSecret(message.body_html_ciphertext!, encryptionKey),
    ))).resolves.toEqual(['', '']);
    expect(await env.DB.prepare(
      `SELECT coverage_state, newest_history_id
         FROM google_accounts
        WHERE profile_id = 'profile_large' AND account_id = 'google_large'`,
    ).first()).toEqual({
      coverage_state: 'current',
      newest_history_id: 'history_20',
    });
    const logged = warning.mock.calls.map(([entry]) => String(entry)).join('\n');
    expect(logged).toContain('thread_large');
    expect(logged).toContain('message_large');
    expect(logged).not.toContain('This body still hydrates.');
    expect(logged).not.toContain('maya@example.com');
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
