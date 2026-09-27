import type { MiniAppPrivateSqlTransaction } from '@theaiplatform/miniapp-sdk/sdk';
import { CoordinatorError, type MailboxChanges, type MailboxPage } from './coordinator-client';
import { readRecord, readReplicaAccounts, writeRecord, writeReplicaThreads } from './bounded-mail-replica';
import { emailThreadKey } from './domain';
import { insertBoundedRows } from './bounded-sql';
import { deleteNormalizedLocalThread } from './local-replica';

export interface RevisionedMailboxUpdate {
  readonly changes?: MailboxChanges;
  /** A session identifier, present only until the initial change replay completes. */
  readonly bootstrap?: string;
}

async function removeThread(tx: MiniAppPrivateSqlTransaction, accountId: string, threadId: string) {
  await deleteNormalizedLocalThread(tx, accountId, threadId);
  await tx.execute('DELETE FROM local_mail_records WHERE account_id = ? AND thread_id = ?', [accountId, threadId]);
  await tx.execute('DELETE FROM local_mail_bodies WHERE account_id = ? AND thread_id = ?', [accountId, threadId]);
}

/** Revision guards and bootstrap membership grow on disk, never with UI memory. */
export async function writeRevisionedMailboxPage(tx: MiniAppPrivateSqlTransaction, page: MailboxPage,
  options: RevisionedMailboxUpdate, updatedAt: string) {
  const revision = page.revision;
  if (revision === undefined) throw new CoordinatorError(502, 'mailbox_upgrade_required',
    'The coordinator must support revisioned mailbox synchronization.');
  const control = await readRecord<{ complete: number; accounts: number }>(tx, 'local_mail_records', 'revision')
    ?? { complete: -1, accounts: -1 };
  const threads: typeof page.mailbox.threads[number][] = [];
  const deleted: { accountId: string; threadId: string }[] = [];
  const versions: (string | number | null)[][] = [];
  const previousVersions = new Map<string, readonly unknown[]>();
  const identities = [...page.mailbox.threads, ...(options.changes?.deletedThreads ?? [])];
  for (let offset = 0; offset < identities.length; offset += 100) {
    const batch = identities.slice(offset, offset + 100);
    const result = await tx.query(`SELECT account_id, thread_id, revision, bootstrap, present FROM local_mail_versions
      WHERE (account_id, thread_id) IN (VALUES ${batch.map(() => '(?, ?)').join(', ')})`,
    batch.flatMap(thread => [thread.accountId, thread.threadId]));
    for (const [accountId, threadId, ...version] of result.rows) previousVersions.set(emailThreadKey({ accountId: String(accountId), threadId: String(threadId) }), version);
    if (options.bootstrap) {
      const present = batch.filter(thread => 'providerRevision' in thread);
      if (present.length) await tx.execute(`UPDATE local_mail_versions SET bootstrap = ? WHERE present = 1
        AND (account_id, thread_id) IN (VALUES ${present.map(() => '(?, ?)').join(', ')})`,
      [options.bootstrap, ...present.flatMap(thread => [thread.accountId, thread.threadId])]);
    }
  }
  for (const [items, present] of [[page.mailbox.threads, 1], [options.changes?.deletedThreads ?? [], 0]] as const) {
    for (const thread of items) {
      const previous = previousVersions.get(emailThreadKey(thread));
      if (revision < Math.max(Number(previous?.[0] ?? control.complete + 1), control.complete)) continue;
      versions.push([thread.accountId, thread.threadId, revision, present,
        options.bootstrap ?? (typeof previous?.[1] === 'string' ? previous[1] : null)]);
      if (present && 'providerRevision' in thread) {
        const projected = { ...thread, localReplicaRevision: revision };
        threads.push(projected);
      }
      else {
        deleted.push(thread);
        await removeThread(tx, thread.accountId, thread.threadId);
      }
    }
  }
  await insertBoundedRows(tx, 'local_mail_versions', ['account_id', 'thread_id', 'revision', 'present', 'bootstrap'], versions);
  const accounts = revision >= control.accounts ? page.mailbox.accounts : [];
  if (revision >= control.accounts) {
    // A revisioned page includes the complete account list, including an empty one.
    await tx.execute("DELETE FROM local_mail_records WHERE kind = 'account'");
    await tx.execute('DELETE FROM local_mail_accounts');
    control.accounts = revision;
  }
  await writeReplicaThreads(tx, { schemaVersion: 1, accounts, threads }, updatedAt, false);
  if (options.bootstrap && options.changes && !options.changes.hasMore) {
    // Prune only after a complete replay. Newer head rows survive its watermark.
    while (true) {
      const stale = await tx.query(`SELECT t.account_id, t.thread_id FROM local_mail_threads t
        LEFT JOIN local_mail_versions v ON v.account_id = t.account_id AND v.thread_id = t.thread_id
        WHERE COALESCE(v.revision, -1) <= ? AND COALESCE(v.bootstrap, '') != ? LIMIT 100`, [revision, options.bootstrap]);
      if (!stale.rows.length) break;
      for (const [accountId, threadId] of stale.rows) {
        await removeThread(tx, String(accountId), String(threadId));
      }
      await insertBoundedRows(tx, 'local_mail_versions', ['account_id', 'thread_id', 'revision', 'present', 'bootstrap'],
        stale.rows.map(([accountId, threadId]) => [accountId!, threadId!, revision, 0, options.bootstrap!]));
    }
    control.complete = revision;
  }
  await writeRecord(tx, 'local_mail_records', 'revision', '', '', '', control);
  return { mailbox: { schemaVersion: 1 as const, accounts: await readReplicaAccounts(tx), threads }, deleted };
}
