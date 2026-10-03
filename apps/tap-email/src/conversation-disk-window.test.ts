import { describe, expect, it, rs } from '@rstest/core';
import { ProfileSqliteMailStore } from './local-store';
import { sqliteStoreFixture } from './sqlite-store-fixture';
import { createConversationDiskReader } from './conversation-disk-reader';
import { ConversationQueryCache } from './conversation-query-cache';
import { ConversationWarmWindow, conversationReaderKey } from './conversation-warm-window';
import { prepareConversation } from './conversation-prefetch';
import { previewMailState, emailThreadKey, type EmailThread } from './domain';
import { serializedBytes } from './bounded-sql';
import { memoryBodyBudgetBytes } from './bounded-mail-replica';

const source = previewMailState();
const rows = (): EmailThread[] => Array.from({ length: 81 }, (_, index) => ({ ...source.threads[0]!,
  threadId: `disk_${index}`, providerRevision: `disk_revision_${index}`, messages: [{ ...source.threads[0]!.messages[0]!,
    messageId: `disk_message_${index}`, bodyText: 'downloaded body', bodyHtml: '<p>Downloaded body</p>' }],
  downloadedPage: { providerRevision: `disk_revision_${index}`, nextCursor: null, complete: true, windowed: false, seenCursors: [] },
}));
const settle = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
const advance = async (ms: number) => {
  for (let elapsed = 0; elapsed < ms; elapsed += 10) { rs.advanceTimersByTime(Math.min(10, ms - elapsed)); await settle(); }
};

describe('reader window over real serialized SQLite', () => {
  it('reproduces 1.0.2 preparing only three of twenty neighbors after 1800 ms on the serialized bridge', async () => {
    const fixture = sqliteStoreFixture(); const store = new ProfileSqliteMailStore(fixture.profile); const threads = rows();
    await store.save({ ...source, threads });
    const previews = threads.map(({ downloadedPage: _page, ...thread }) => thread);
    const query = fixture.database.query.bind(fixture.database);
    fixture.database.query = async (...args) => { await new Promise(resolve => setTimeout(resolve, 150)); return query(...args); };
    rs.useFakeTimers(); const cache = new ConversationQueryCache();
    const read = (account: string, thread: string, signal: AbortSignal) => store.loadThread(account, thread, true, signal);
    const warmer = new ConversationWarmWindow(thread => cache.has(thread.accountId, thread.threadId, thread.providerRevision),
      (thread, signal) => prepareConversation(cache, thread, read, null, signal), () => undefined);
    try {
      warmer.update(previews, conversationReaderKey(previews[30]!)); await advance(1800);
      expect(previews.filter(thread => cache.has(thread.accountId, thread.threadId, thread.providerRevision))).toHaveLength(3);
    } finally {
      warmer.dispose(); await advance(1500); cache.clear(); fixture.database.query = query;
      await store.close(); rs.useRealTimers();
    }
  });

  it('pages large bodies within the response limit and stops hydrating at the memory budget', async () => {
    const fixture = sqliteStoreFixture(); const store = new ProfileSqliteMailStore(fixture.profile);
    const threads = rows().slice(0, 20).map(thread => ({ ...thread,
      messages: thread.messages.map(message => ({ ...message, bodyText: 'x'.repeat(500_000), bodyHtml: '<p>Large</p>' })) }));
    try {
      await store.save({ ...source, threads }); fixture.statements.length = 0;
      const loaded = await store.loadThreads(threads);
      const hydrated = [...loaded.values()].filter(thread => thread.downloadedPage);
      expect(hydrated).toHaveLength(16);
      expect(hydrated.reduce((bytes, thread) => bytes + serializedBytes({ messages: thread.messages,
        downloadedPage: thread.downloadedPage }), 0)).toBeLessThanOrEqual(memoryBodyBudgetBytes);
      expect(fixture.statements.filter(sql => sql.includes("WHERE kind = 'body'"))).toHaveLength(3);
      expect(loaded.get(emailThreadKey(threads[0]!))?.messages[0]?.bodyText.length).toBe(500_000);
      expect(loaded.get(emailThreadKey(threads[15]!))?.messages[0]?.messageId).toBe('disk_message_15');
      expect(loaded.get(emailThreadKey(threads[16]!))?.downloadedPage).toBeUndefined();
    } finally { await store.close(); }
  });

  it('restores twenty verified bodies in three bridge reads rather than sixty', async () => {
    const fixture = sqliteStoreFixture(); const store = new ProfileSqliteMailStore(fixture.profile);
    const threads = rows().slice(0, 20);
    try {
      await store.save({ ...source, threads }); fixture.statements.length = 0;
      for (const thread of threads) await store.loadThread(thread.accountId, thread.threadId);
      expect(fixture.statements.filter(sql => sql.startsWith('SELECT'))).toHaveLength(60);
      fixture.statements.length = 0;
      const loaded = await store.loadThreads(threads);
      expect(fixture.statements.filter(sql => sql.startsWith('SELECT'))).toHaveLength(3);
      for (const thread of threads) expect(loaded.get(emailThreadKey(thread))?.downloadedPage).toEqual(thread.downloadedPage);
      // Stale/missing disk bodies cannot acquire a download marker from metadata.
      fixture.sqlite.exec("UPDATE local_mail_bodies SET provider_revision = 'stale' WHERE thread_id = 'disk_0'");
      fixture.sqlite.exec("DELETE FROM local_mail_records WHERE kind = 'body' AND thread_id = 'disk_1'");
      const mixed = await store.loadThreads(threads);
      expect(mixed.get(emailThreadKey(threads[0]!))?.downloadedPage).toBeUndefined();
      expect(mixed.get(emailThreadKey(threads[1]!))?.downloadedPage).toBeUndefined();
    } finally { await store.close(); }
  });

  it('keeps sixty sustained opens ready with each serialized SDK read taking 150 ms', async () => {
    const fixture = sqliteStoreFixture(); const store = new ProfileSqliteMailStore(fixture.profile); const threads = rows();
    await store.save({ ...source, threads });
    const previews = threads.map(({ downloadedPage: _page, messages, ...thread }) => ({ ...thread,
      messages: messages.map(message => ({ ...message, bodyText: '', bodyHtml: null })) }));
    const query = fixture.database.query.bind(fixture.database);
    fixture.database.query = async (...args) => { await new Promise(resolve => setTimeout(resolve, 150)); return query(...args); };
    rs.useFakeTimers(); const cache = new ConversationQueryCache(); const read = createConversationDiskReader(store);
    const client = { getThreadPage: rs.fn() }; let hits = 0;
    const warmer = new ConversationWarmWindow(thread => cache.has(thread.accountId, thread.threadId, thread.providerRevision),
      (thread, signal) => prepareConversation(cache, thread, read, client, signal), () => undefined, 2,
      batch => Promise.allSettled(batch.map(thread => cache.localThread(thread.accountId, thread.threadId, thread.providerRevision,
        signal => read(thread.accountId, thread.threadId, signal)))));
    try {
      warmer.update(previews, conversationReaderKey(previews[30]!)); await advance(1800);
      expect(previews.filter(thread => cache.has(thread.accountId, thread.threadId, thread.providerRevision))).toHaveLength(20);
      for (const index of [...Array.from({ length: 30 }, (_, i) => 31 + i), ...Array.from({ length: 30 }, (_, i) => 59 - i)]) {
        const thread = previews[index]!;
        if (cache.has(thread.accountId, thread.threadId, thread.providerRevision)) hits++;
        warmer.update(previews, conversationReaderKey(thread)); await advance(100);
      }
      expect(hits).toBe(60); expect(client.getThreadPage).not.toHaveBeenCalled();
    } finally {
      warmer.dispose(); await advance(3000); cache.clear(); fixture.database.query = query;
      await store.close(); rs.useRealTimers();
    }
  });
});
