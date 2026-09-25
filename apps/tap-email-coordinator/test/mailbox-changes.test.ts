import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { mailboxPage, type MailboxPageResult } from '../src/mailbox';

const timestamp = '2026-09-24T00:00:00.000Z';
type Thread = { accountId: string; threadId: string; unread: boolean; starred: boolean; status: string };
const threads = (page: MailboxPageResult) => page.mailbox.threads as Thread[];

async function seed(profile: string, account: string, count = 250) {
  await env.DB.prepare(`INSERT INTO google_accounts
    (profile_id, account_id, google_subject, connection_state, coverage_state, created_at, updated_at)
    VALUES (?, ?, ?, 'active', 'current', ?, ?)`)
    .bind(profile, account, account, timestamp, timestamp).run();
  await env.DB.prepare(`WITH RECURSIVE sequence(n) AS (
    SELECT 1 UNION ALL SELECT n + 1 FROM sequence WHERE n < ?)
    INSERT INTO mail_threads (profile_id, account_id, thread_id, history_id, subject, snippet,
      participants_json, received_at, unread, starred, important, in_inbox, needs_response,
      waiting_on_others, label_ids_json, updated_at)
    SELECT ?, ?, printf('thread_%03d', n), 'history_1', 'Subject', 'Preview', '[]',
      ?, 1, 0, 0, 1, 0, 0, '["INBOX", "UNREAD"]', ? FROM sequence`)
    .bind(count, profile, account, timestamp, timestamp).run();
}

async function drain(profile: string, after = 0) {
  const seen = new Map<string, Thread>();
  const deleted = new Set<string>();
  let pages = 0;
  while (true) {
    const page = await mailboxPage(env, profile, { afterRevision: after });
    expect(threads(page).length + page.changes!.deletedThreads.length).toBeLessThanOrEqual(100);
    for (const thread of threads(page)) seen.set(`${thread.accountId}:${thread.threadId}`, thread);
    for (const thread of page.changes!.deletedThreads) {
      const key = `${thread.accountId}:${thread.threadId}`;
      seen.delete(key);
      deleted.add(key);
    }
    pages += 1;
    if (!page.changes!.hasMore) return { seen, deleted, pages, revision: page.changes!.nextRevision };
    expect(page.changes!.nextRevision).toBeGreaterThan(after);
    after = page.changes!.nextRevision;
  }
}

describe('durable mailbox changes', () => {
  it('replays all pages, then exposes older read/star/archive/delete changes with account and profile isolation', async () => {
    const profile = crypto.randomUUID();
    const unrelated = crypto.randomUUID();
    await seed(profile, 'account_a');
    await seed(profile, 'account_b');
    await seed(unrelated, 'account_a', 1);
    const baseline = await drain(profile);
    expect(baseline.seen.size).toBe(500);
    expect(baseline.pages).toBe(6); // Account metadata changes also occupy stream slots.
    await env.DB.batch([
      env.DB.prepare(`UPDATE mail_threads SET unread = 0, starred = 1, in_inbox = 0,
        history_id = 'history_2', label_ids_json = '["STARRED"]'
        WHERE profile_id = ? AND account_id = 'account_a' AND thread_id = 'thread_249'`).bind(profile),
      env.DB.prepare(`DELETE FROM mail_threads
        WHERE profile_id = ? AND account_id = 'account_a' AND thread_id = 'thread_250'`).bind(profile),
      env.DB.prepare(`UPDATE mail_threads SET starred = 1 WHERE profile_id = ?`).bind(unrelated),
    ]);
    const delta = await drain(profile, baseline.revision);
    expect([...delta.seen.values()]).toEqual([expect.objectContaining({
      accountId: 'account_a', threadId: 'thread_249', unread: false, starred: true, status: 'done',
    })]);
    expect([...delta.deleted]).toEqual(['account_a:thread_250']);
    expect(delta.revision).toBeGreaterThan(baseline.revision);
    // Tombstones are durable and replayable, not consumed by a client.
    expect((await drain(profile, baseline.revision)).deleted).toEqual(delta.deleted);
  });

  it('resumes a compacted stream after interruption and catches rows changed during traversal', async () => {
    const profile = crypto.randomUUID();
    await seed(profile, 'account_a');
    const first = await mailboxPage(env, profile, { afterRevision: 0 });
    const seen = new Set(threads(first).map(thread => thread.threadId));
    await env.DB.batch([
      env.DB.prepare(`UPDATE mail_threads SET unread = 0
        WHERE profile_id = ? AND thread_id IN ('thread_001', 'thread_200')`).bind(profile),
      env.DB.prepare(`DELETE FROM mail_threads WHERE profile_id = ? AND thread_id = 'thread_002'`).bind(profile),
    ]);
    const resumed = await drain(profile, first.changes!.nextRevision);
    for (const thread of resumed.seen.values()) seen.add(thread.threadId);
    for (const key of resumed.deleted) seen.delete(key.split(':')[1]!);
    expect(seen.size).toBe(249);
    expect(resumed.seen.get('account_a:thread_001')?.unread).toBe(false);
    expect(resumed.seen.get('account_a:thread_200')?.unread).toBe(false);
    expect((await drain(profile)).seen.size).toBe(249);
  });

  it('publishes no revision for rolled-back writes and retains deletion events after account removal', async () => {
    const profile = crypto.randomUUID();
    await seed(profile, 'account_a', 1);
    const baseline = await drain(profile);
    await expect(env.DB.batch([
      env.DB.prepare('UPDATE mail_threads SET unread = 0 WHERE profile_id = ?').bind(profile),
      env.DB.prepare('UPDATE mail_threads SET unread = 9 WHERE profile_id = ?').bind(profile),
    ])).rejects.toThrow();
    const afterRollback = await drain(profile, baseline.revision);
    expect(afterRollback.seen.size).toBe(0);
    expect(afterRollback.revision).toBe(baseline.revision);
    await env.DB.prepare('DELETE FROM google_accounts WHERE profile_id = ?').bind(profile).run();
    expect((await drain(profile, baseline.revision)).deleted).toEqual(new Set(['account_a:thread_001']));
  });

  it('tracks preview and reminder writes as well as thread rows', async () => {
    const profile = crypto.randomUUID();
    await seed(profile, 'account_a', 1);
    const baseline = await drain(profile);
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO mail_messages (profile_id, account_id, thread_id, message_id,
        sender_json, recipients_json, sent_at, body_text_ciphertext, ordinal, updated_at)
        VALUES (?, 'account_a', 'thread_001', 'message_1', '{}', '[]', ?, 'sealed', 0, ?)`)
        .bind(profile, timestamp, timestamp),
      env.DB.prepare(`INSERT INTO tap_reminders (profile_id, account_id, reminder_id, thread_id,
        due_at, condition, state, created_at, updated_at)
        VALUES (?, 'account_a', 'reminder_1', 'thread_001', ?, 'regardless', 'pending', ?, ?)`)
        .bind(profile, timestamp, timestamp, timestamp),
    ]);
    const page = await mailboxPage(env, profile, { afterRevision: baseline.revision });
    expect(page.mailbox.threads).toEqual([expect.objectContaining({
      messages: [expect.objectContaining({ messageId: 'message_1' })],
      reminder: expect.objectContaining({ reminderId: 'reminder_1' }),
    })]);
    expect(page.pageInfo.revision).toBeGreaterThan(baseline.revision);
    // Cascading preview/reminder deletes must not overwrite the thread tombstone.
    await env.DB.prepare('DELETE FROM google_accounts WHERE profile_id = ?').bind(profile).run();
    expect((await drain(profile, page.pageInfo.revision)).deleted).toEqual(new Set(['account_a:thread_001']));
  });
});
