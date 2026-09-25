import { describe, expect, it } from '@rstest/core';
import type { MailboxChanges, MailboxPage } from './coordinator-client';
import { emailThreadKey, markDone, previewMailState, projectedThreads, type EmailThread, type MailState } from './domain';
import type { MailboxPageProgress } from './local-store';
import { MailboxCheckpointWriter, MailboxSync } from './mailbox-sync';

const seed = previewMailState();
const rows = Array.from({ length: 250 }, (_, index) => ({ ...seed.threads[0]!, threadId: `thread_${index}` }));
function page(threads: readonly EmailThread[], revision = 1, nextCursor: string | null = null): MailboxPage {
  return { mailbox: { schemaVersion: 1, accounts: seed.accounts, threads }, revision, nextCursor };
}
function changes(threads: readonly EmailThread[], revision = 1, hasMore = false,
  deletedThreads: MailboxChanges['deletedThreads'] = []): MailboxChanges {
  return { ...page(threads, revision), revision, nextRevision: revision, hasMore, deletedThreads };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe('mailbox synchronization', () => {
  it('connects with 250 cached threads, preserving pages and loading older rows of the new account', async () => {
    let state: MailState = { ...seed, threads: rows };
    const connected = { ...seed.accounts[0]!, accountId: 'new_account' };
    const added = { ...rows[0]!, accountId: connected.accountId };
    const older = { ...rows[249]!, accountId: connected.accountId };
    let calls = 0;
    const sync = new MailboxSync({
      getMailboxPage: async () => page([]),
      getMailboxChanges: async () => {
        const response = calls++ === 0 ? changes(rows.slice(0, 100), 1, true)
          : calls === 2 ? changes(rows.slice(100, 200), 2, true)
            : calls === 3 ? changes(rows.slice(200), 3)
              : changes([added, older], 5);
        return { ...response, mailbox: { ...response.mailbox,
          accounts: calls <= 3 ? seed.accounts : [...seed.accounts, connected] } };
      },
    }, update => { state = update(state); });
    await sync.reconcile();
    sync.applyPage({ ...page([...rows.slice(0, 99), added], 4),
      mailbox: { schemaVersion: 1, accounts: [...seed.accounts, connected], threads: [...rows.slice(0, 99), added] } });
    expect(state.threads).toHaveLength(251);
    await sync.reconcile();
    expect(state.threads).toHaveLength(252);
    expect(new Set(state.threads.map(emailThreadKey)).size).toBe(252);
    expect(state.threads).toContainEqual(older);
  });

  it('reconciles older read/star/archive/delete mutations while retaining optimistic commands', async () => {
    let state = markDone(seed, 'pending_archive', '2026-09-24T10:00:00.000Z');
    const pending = state.commands;
    const intents = state.pendingThreadIntents;
    const original = seed.threads[0]!;
    const older = { ...seed.threads[1]!, unread: false, starred: true, status: 'done' as const };
    const removed = seed.threads[2]!;
    const sync = new MailboxSync({
      getMailboxPage: async () => page([]),
      getMailboxChanges: async () => changes([original, older, ...seed.threads.slice(3)], 10, false, [removed]),
    }, update => { state = update(state); });
    await sync.reconcile();
    expect(state.threads.find(thread => emailThreadKey(thread) === emailThreadKey(older))).toMatchObject(older);
    expect(state.threads.some(thread => emailThreadKey(thread) === emailThreadKey(removed))).toBe(false);
    expect(state.commands).toBe(pending);
    expect(state.pendingThreadIntents).toBe(intents);
    expect(projectedThreads(state).find(thread => emailThreadKey(thread) === emailThreadKey(original))?.status).toBe('done');
    // Late history cannot revert metadata or resurrect the tombstone.
    sync.applyPage(page(seed.threads, 9));
    expect(state.threads.some(thread => emailThreadKey(thread) === emailThreadKey(removed))).toBe(false);
    expect(state.threads.find(thread => emailThreadKey(thread) === emailThreadKey(older))?.starred).toBe(true);
  });

  it('shows fresh head mail while resumed backfill is blocked and ignores late pages after disposal', async () => {
    let state = seed;
    const history = deferred<MailboxPage>();
    const fresh = { ...rows[0]!, threadId: 'fresh_mail' };
    const cursors: Array<string | null | undefined> = [];
    const sync = new MailboxSync({
      getMailboxPage: async cursor => { cursors.push(cursor); return cursor ? history.promise : page([fresh], 20); },
      getMailboxChanges: async () => changes([]),
    }, update => { state = update(state); });
    const loading = sync.loadHistory('saved_cursor', () => undefined);
    await sync.refreshHead();
    expect(cursors).toEqual(['saved_cursor', undefined]);
    expect(state.threads).toContainEqual(fresh);
    sync.dispose();
    const before = state;
    history.resolve(page(rows, 10));
    await loading;
    expect(state).toBe(before);
  });

  it('does not prune on a partial or interrupted traversal, resumes, then safely replays after restart', async () => {
    let state: MailState = { ...seed, threads: rows };
    let fail = true;
    const requested: number[] = [];
    const source = {
      getMailboxPage: async () => page([]),
      getMailboxChanges: async (revision: number) => {
        requested.push(revision);
        if (revision === 0) return changes(rows.slice(0, 100), 1, true);
        if (fail) throw new Error('offline');
        if (revision === 1) return changes(rows.slice(100, 200), 2, true);
        return changes(rows.slice(200, 249), 3);
      },
    };
    const sync = new MailboxSync(source, update => { state = update(state); });
    await expect(sync.reconcile()).rejects.toThrow('offline');
    expect(state.threads).toHaveLength(250);
    fail = false;
    await sync.reconcile();
    expect(requested).toEqual([0, 1, 1, 2]);
    expect(state.threads).toHaveLength(249);
    // A complete traversal is authoritative even for pre-migration cache rows.
    sync.applyPage(page([rows[249]!], 1));
    expect(state.threads).toHaveLength(249);
    const restarted = new MailboxSync(source, update => { state = update(state); });
    await restarted.reconcile();
    expect(requested.slice(-3)).toEqual([0, 1, 2]);
    expect(state.threads).toHaveLength(249);
  });

  it('resumes historical loading from the last applied page after a failed request', async () => {
    let state: MailState = { ...seed, threads: rows.slice(0, 100) };
    let checkpoint: MailboxPageProgress | null = null;
    let offline = true;
    const requested: Array<string | null | undefined> = [];
    const source = {
      getMailboxPage: async (cursor?: string | null) => {
        requested.push(cursor);
        if (cursor === 'page_2') return page(rows.slice(100, 200), 2, 'page_3');
        if (offline) throw new Error('offline');
        return page(rows.slice(200), 3);
      },
      getMailboxChanges: async () => changes([]),
    };
    const sync = new MailboxSync(source, update => { state = update(state); });
    await expect(sync.loadHistory('page_2', progress => { checkpoint = progress; })).rejects.toThrow('offline');
    expect(checkpoint).toMatchObject({ nextCursor: 'page_3' });
    expect(state.threads).toHaveLength(200);
    offline = false;
    const restarted = new MailboxSync(source, update => { state = update(state); });
    await restarted.loadHistory('page_3', progress => { checkpoint = progress; });
    expect(requested).toEqual(['page_2', 'page_3', 'page_3']);
    expect(state.threads).toHaveLength(250);
    expect(checkpoint).toBeNull();
  });

  it('preserves head rows newer than a completed reconciliation and account-scoped deletions', async () => {
    const sameId = { ...rows[0]!, accountId: 'other_account' };
    let state: MailState = { ...seed, threads: [rows[0]!, sameId] };
    const response = deferred<MailboxChanges>();
    const sync = new MailboxSync({ getMailboxPage: async () => page([]), getMailboxChanges: () => response.promise },
      update => { state = update(state); });
    const running = sync.reconcile();
    sync.applyPage(page([sameId], 30));
    response.resolve(changes([], 20, false, [rows[0]!]));
    await running;
    expect(state.threads).toEqual([sameId]);
  });
});

describe('mailbox checkpoints', () => {
  it('reports durable commands even when saving the later historical cursor fails', async () => {
    let durable = false;
    const writer = new MailboxCheckpointWriter();
    await expect(writer.save({
      save: async () => undefined,
      clearMailboxPageProgress: async () => { throw new Error('cursor checkpoint failed'); },
      saveMailboxPageProgress: async () => undefined,
    }, seed, null, () => { durable = true; })).rejects.toThrow('cursor checkpoint failed');
    expect(durable).toBe(true);
  });

  it('saves the captured rows before their cursor, serializes writes, and never advances a failed save', async () => {
    const calls: string[] = [];
    const firstSave = deferred<void>();
    let attempt = 0;
    const store = {
      save: async () => {
        calls.push(`rows_${++attempt}`);
        if (attempt === 1) await firstSave.promise;
        if (attempt === 2) throw new Error('disk full');
      },
      saveMailboxPageProgress: async (progress: MailboxPageProgress) => { calls.push(progress.nextCursor); },
      clearMailboxPageProgress: async () => { calls.push('complete'); },
    };
    const writer = new MailboxCheckpointWriter();
    const progress = { nextCursor: 'page_2', pagesLoaded: 1, threadsLoaded: 100, updatedAt: '2026-09-24T00:00:00.000Z' };
    const first = writer.save(store, seed, progress);
    const failed = expect(writer.save(store, seed, { ...progress, nextCursor: 'page_3' })).rejects.toThrow('disk full');
    const last = writer.save(store, seed, null);
    await Promise.resolve();
    expect(calls).toEqual(['rows_1']);
    firstSave.resolve();
    await Promise.all([first, failed, last]);
    expect(calls).toEqual(['rows_1', 'page_2', 'rows_2', 'rows_3', 'complete']);
  });
});
