import { describe, expect, it } from '@rstest/core';
import { ProfileSqliteMailStore } from './local-store';
import { sqliteStoreFixture } from './sqlite-store-fixture';
import { previewMailState } from './domain';
import { maintainSemanticIndexBatch } from './semantic-index-maintenance';
import type { EmailSemanticIndex } from './semantic-email-index';

function indexFixture() {
  const rows = new Set<string>();
  let fail = false;
  const index: EmailSemanticIndex = {
    capability: 'private-profile-zvec', collectionName: 'test_collection',
    binding: { model: 'local', revision: '1', dimensions: 3, fingerprint: 'test', provenance: 'custom-unverified' },
    indexThreads: async threads => {
      if (fail) throw new Error('embedding failed');
      for (const thread of threads) rows.add(thread.threadId);
      return { indexedCount: threads.length, skippedCount: 0, stats: await index.stats() };
    },
    deleteThreads: async threads => { for (const thread of threads) rows.delete(thread.threadId); return threads.length; },
    search: async () => [], stats: async () => ({ docCount: rows.size, storedBytes: rows.size * 100, indexes: [] }), close: async () => {},
  };
  return { index, rows, fail: (value: boolean) => { fail = value; } };
}

const seed = previewMailState();
const threads = Array.from({ length: 35 }, (_, n) => ({ ...seed.threads[0]!, threadId: `mail_${n}` }));

describe('durable semantic maintenance', () => {
  it('processes bounded batches, resumes after failure/reopen, and never acknowledges unindexed mail', async () => {
    const fixture = sqliteStoreFixture();
    let store = new ProfileSqliteMailStore(fixture.profile);
    await store.save({ ...seed, threads });
    const { index, rows, fail } = indexFixture();
    await store.prepareSemanticIndex(index.collectionName);
    const signal = new AbortController().signal;
    expect(await maintainSemanticIndexBatch(index, store, signal)).toEqual({ indexed: 8, pending: 27 });
    fail(true);
    await expect(maintainSemanticIndexBatch(index, store, signal)).rejects.toThrow('embedding failed');
    expect((await store.readSemanticBatch(index.collectionName)).pending).toBe(27);
    store = new ProfileSqliteMailStore(fixture.profile);
    await store.prepareSemanticIndex(index.collectionName);
    expect((await store.readSemanticBatch(index.collectionName)).pending).toBe(27);
    fail(false);
    while ((await store.readSemanticBatch(index.collectionName)).pending) await maintainSemanticIndexBatch(index, store, signal);
    expect(rows.size).toBe(35);
    expect(await maintainSemanticIndexBatch(index, store, signal)).toEqual({ indexed: 35, pending: 0 });
  });

  it('preserves newer edits on late acknowledgment and drains deletion tombstones', async () => {
    const fixture = sqliteStoreFixture();
    const store = new ProfileSqliteMailStore(fixture.profile);
    await store.save({ ...seed, threads: threads.slice(0, 1) });
    const { index, rows } = indexFixture();
    await store.prepareSemanticIndex(index.collectionName);
    const old = await store.readSemanticBatch(index.collectionName);
    await store.commitMailboxRefresh({ schemaVersion: 1, accounts: seed.accounts, threads: [{ ...threads[0]!, subject: 'changed' }] });
    await store.acknowledgeSemanticBatch(index.collectionName, old.jobs);
    expect((await store.readSemanticBatch(index.collectionName)).pending).toBe(1);
    await maintainSemanticIndexBatch(index, store, new AbortController().signal);
    expect(rows.size).toBe(1);
    await store.commitMailboxUpdate({ revision: 2, nextCursor: null, mailbox: { schemaVersion: 1, accounts: seed.accounts, threads: [] } }, {
      changes: { revision: 2, nextRevision: 2, nextCursor: null, hasMore: false,
        mailbox: { schemaVersion: 1, accounts: seed.accounts, threads: [] }, deletedThreads: [threads[0]!] },
    });
    expect((await store.readSemanticBatch(index.collectionName)).jobs[0]?.thread).toBeNull();
    await maintainSemanticIndexBatch(index, store, new AbortController().signal);
    expect(rows.size).toBe(0);
  });

  it('does not requeue unchanged UI saves and retains deletion jobs through a device wipe', async () => {
    const fixture = sqliteStoreFixture();
    const store = new ProfileSqliteMailStore(fixture.profile);
    const state = { ...seed, threads: threads.slice(0, 1) };
    await store.save(state);
    const { index, rows } = indexFixture();
    await store.prepareSemanticIndex(index.collectionName);
    await maintainSemanticIndexBatch(index, store, new AbortController().signal);
    await store.save(state);
    expect((await store.readSemanticBatch(index.collectionName)).pending).toBe(0);
    await store.wipeDevice();
    expect((await store.readSemanticBatch(index.collectionName)).jobs).toEqual([
      expect.objectContaining({ thread: null }),
    ]);
    await maintainSemanticIndexBatch(index, store, new AbortController().signal);
    expect(rows.size).toBe(0);
  });

  it('rebuilds for a new model without accepting old-model acknowledgments', async () => {
    const fixture = sqliteStoreFixture();
    const store = new ProfileSqliteMailStore(fixture.profile);
    await store.save({ ...seed, threads });
    await store.prepareSemanticIndex('model_a');
    const old = await store.readSemanticBatch('model_a');
    await store.prepareSemanticIndex('model_b');
    await store.acknowledgeSemanticBatch('model_a', old.jobs);
    expect((await store.readSemanticBatch('model_b')).pending).toBe(35);
    await expect(store.readSemanticBatch('model_a')).rejects.toThrow('model changed');
  });

  it('keeps pending changes after cancellation so the next worker can finish', async () => {
    const fixture = sqliteStoreFixture();
    const store = new ProfileSqliteMailStore(fixture.profile);
    await store.save({ ...seed, threads });
    const { index } = indexFixture();
    await store.prepareSemanticIndex(index.collectionName);
    const abort = new AbortController();
    const original = index.indexThreads;
    index.indexThreads = async input => { const result = await original(input); abort.abort(); return result; };
    await expect(maintainSemanticIndexBatch(index, store, abort.signal)).rejects.toThrow();
    expect((await store.readSemanticBatch(index.collectionName)).pending).toBe(35);
  });
});
