import { describe, expect, it } from '@rstest/core';
import type { MailboxChanges, MailboxPage } from './coordinator-client';
import { DurableMailboxSync } from './durable-mailbox-sync';
import { ProfileSqliteMailStore } from './local-store';
import { sqliteStoreFixture } from './sqlite-store-fixture';
import { boundMailWindow } from './bounded-mail-replica';
import { previewMailState, type MailState } from './domain';

const seed = previewMailState();
const threads = Array.from({ length: 250 }, (_, index) => ({ ...seed.threads[0]!, threadId: `history_${index}` }));
const page = (rows = threads, revision = 1, nextCursor: string | null = null): MailboxPage =>
  ({ mailbox: { schemaVersion: 1, accounts: seed.accounts, threads: rows }, revision, nextCursor });
const changes = (rows = threads, revision = 1, hasMore = false,
  deletedThreads: MailboxChanges['deletedThreads'] = []): MailboxChanges =>
  ({ ...page(rows, revision), revision, nextRevision: revision, hasMore, deletedThreads });

describe('durable revisioned mailbox synchronization', () => {
  it('keeps full history on disk and bounded UI state, rejects stale pages and stale UI saves after deletion', async () => {
    const fixture = sqliteStoreFixture();
    const store = new ProfileSqliteMailStore(fixture.profile);
    await store.save({ ...seed, threads });
    let state = boundMailWindow({ ...seed, threads });
    const responses = [changes(threads.slice(0, 100), 1, true), changes(threads.slice(100, 200), 2, true), changes(threads.slice(200, 249), 3)];
    const sync = new DurableMailboxSync({ getMailboxPage: async () => page(), getMailboxChanges: async () => responses.shift()! },
      store, apply => { state = boundMailWindow(apply(state)); }, () => {}, () => {});
    await sync.reconcile();
    expect(state.threads.length).toBeLessThanOrEqual(101);
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS n FROM local_mail_threads').get()?.n).toBe(249);
    await sync.applyPage(page(threads, 2));
    expect(await store.loadThread(threads[249]!.accountId, threads[249]!.threadId)).toBeNull();
    await store.saveCache({ ...seed, threads: [threads[249]!] });
    expect(await store.loadThread(threads[249]!.accountId, threads[249]!.threadId)).toBeNull();
    const starred = { ...threads[0]!, starred: true };
    await store.commitMailboxUpdate(page([starred], 5));
    await store.saveCache({ ...seed, threads: [threads[0]!] });
    expect((await store.loadThread(starred.accountId, starred.threadId))?.starred).toBe(true);
    // Restart replays from zero; previous revision guards must not cause valid members to be pruned.
    const replay = [changes(threads.slice(0, 100), 1, true), changes(threads.slice(100, 200), 2, true), changes(threads.slice(200, 249), 3)];
    const restarted = new DurableMailboxSync({ getMailboxPage: async () => page(), getMailboxChanges: async () => replay.shift()! },
      store, () => {}, () => {}, () => {});
    await restarted.reconcile();
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS n FROM local_mail_threads').get()?.n).toBe(249);
  });

  it('backs off a failed revisioned page without advancing its checkpoint or change cursor', async () => {
    const fixture = sqliteStoreFixture();
    const store = new ProfileSqliteMailStore(fixture.profile);
    await store.save({ ...seed, threads: [] });
    const checkpoint = await store.beginMailboxSync();
    fixture.failOnce(sql => sql.startsWith('INSERT OR REPLACE INTO local_mail_sync'));
    await expect(store.commitMailboxUpdate(page(threads.slice(0, 100), 1, 'older'), { checkpoint })).rejects.toThrow('injected');
    expect(await store.beginMailboxSync()).toEqual(checkpoint);
    expect((await store.queryThreads({})).threads).toHaveLength(0);
    const revisions: number[] = [];
    const sync = new DurableMailboxSync({ getMailboxPage: async () => page(), getMailboxChanges: async revision => {
      revisions.push(revision); return changes(threads.slice(0, 100), 1);
    } }, store, () => {}, () => {}, () => {});
    fixture.failOnce(sql => sql.startsWith('INSERT OR REPLACE INTO local_mail_versions'));
    await expect(sync.reconcile()).rejects.toThrow('injected');
    await sync.reconcile();
    expect(revisions).toEqual([0, 0]);
    expect((await store.queryThreads({})).threads).toHaveLength(100);
  });

  it('shows current mail before resumed history, preserves newer rows at replay completion and cancels late requests', async () => {
    const fixture = sqliteStoreFixture();
    const store = new ProfileSqliteMailStore(fixture.profile);
    await store.save({ ...seed, threads: [] });
    await store.commitMailboxPage(await store.beginMailboxSync(), page(threads.slice(0, 100)).mailbox, 'resume');
    let state: MailState = seed;
    let resolve!: (value: MailboxPage) => void;
    const pending = new Promise<MailboxPage>(done => { resolve = done; });
    const cursors: (string | null | undefined)[] = [];
    const sync = new DurableMailboxSync({ getMailboxPage: async cursor => {
      cursors.push(cursor); return cursor ? pending : page([threads[249]!], 30);
    }, getMailboxChanges: async () => changes([], 20) }, store,
    apply => { state = boundMailWindow(apply(state)); }, () => {}, () => {});
    const head = await sync.refreshHead();
    expect(state.threads.some(thread => thread.threadId === threads[249]!.threadId)).toBe(true);
    const history = sync.loadHistory(head);
    await sync.reconcile();
    expect(cursors).toEqual([undefined, 'resume']);
    expect(await store.loadThread(threads[249]!.accountId, threads[249]!.threadId)).not.toBeNull();
    sync.dispose();
    resolve(page(threads.slice(100, 200), 10));
    await history;
    expect(await store.loadThread(threads[100]!.accountId, threads[100]!.threadId)).toBeNull();
  });
});
