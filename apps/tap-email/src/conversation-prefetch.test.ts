import { describe, expect, it, rs } from '@rstest/core';
import { ConversationQueryCache } from './conversation-query-cache';
import { prepareConversation } from './conversation-prefetch';
import { previewMailState } from './domain';

describe('neighbor preparation shares the foreground query cache', () => {
  it('uses a matching downloaded disk page and deduplicates simultaneous preparation', async () => {
    const cache = new ConversationQueryCache();
    const source = previewMailState().threads[0]!;
    const downloaded = { ...source, downloadedPage: { providerRevision: source.providerRevision,
      nextCursor: null, complete: true, windowed: false, seenCursors: [] } };
    const read = rs.fn(async () => downloaded);
    const client = { getThreadPage: rs.fn() };
    try {
      await Promise.all([1, 2].map(() => prepareConversation(cache, source, read, client, new AbortController().signal)));
      expect(read).toHaveBeenCalledTimes(1);
      expect(client.getThreadPage).not.toHaveBeenCalled();
      expect(cache.snapshot(source.accountId, source.threadId, source.providerRevision)?.messages).toBe(downloaded.messages);
      await prepareConversation(cache, source, read, client, new AbortController().signal);
      expect(read).toHaveBeenCalledTimes(1);
    } finally { cache.clear(); }
  });

  it('does not publish a response to a canceled warming session or reuse another revision', async () => {
    const cache = new ConversationQueryCache();
    const source = previewMailState().threads[0]!;
    const read = rs.fn(async () => ({ ...source, providerRevision: 'old' }));
    const abort = new AbortController();
    const client = { getThreadPage: rs.fn(async () => {
      abort.abort();
      return { messages: source.messages, providerRevision: source.providerRevision, complete: true, nextCursor: null };
    }) };
    try {
      expect(await prepareConversation(cache, source, read, client, abort.signal)).toBe(false);
      expect(cache.snapshot(source.accountId, source.threadId, source.providerRevision)).toBeUndefined();
      expect(client.getThreadPage).toHaveBeenCalledTimes(1);
    } finally { cache.clear(); }
  });
});
