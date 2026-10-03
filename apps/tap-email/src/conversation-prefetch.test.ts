import { describe, expect, it, rs } from '@rstest/core';
import { ConversationQueryCache } from './conversation-query-cache';
import { conversationEntryReady, prepareConversation } from './conversation-prefetch';
import { previewMailState } from './domain';

describe('neighbor preparation shares the foreground query cache', () => {
  it('warms through older pages to the actual first unread, then needs no more reads', async () => {
    const cache = new ConversationQueryCache();
    const source = { ...previewMailState().threads[0]!, unread: true, firstUnreadMessageId: 'first-unread' };
    const latest = { ...source.messages[0]!, messageId: 'latest', sentAt: '2026-10-03T15:00:00Z', unread: true };
    const older = { ...latest, messageId: 'first-unread', sentAt: '2026-10-03T14:00:00Z' };
    const read = rs.fn(async () => null);
    const client = { getThreadPage: rs.fn(async (_account: string, _thread: string, cursor?: string | null) => ({
      providerRevision: source.providerRevision, messages: [cursor ? older : latest],
      nextCursor: cursor ? null : 'older-cursor', complete: Boolean(cursor),
    })) };
    try {
      await prepareConversation(cache, source, read, client, new AbortController().signal);
      expect(client.getThreadPage).toHaveBeenCalledTimes(2);
      expect(client.getThreadPage.mock.calls[1]?.[2]).toBe('older-cursor');
      expect(cache.get(source.accountId, source.threadId, source.providerRevision)?.messages.map(message => message.messageId))
        .toEqual(['first-unread', 'latest']);
      expect(conversationEntryReady(cache, source)).toBe(true);
      for (let index = 0; index < 10; index++) await prepareConversation(cache, source, read, client, new AbortController().signal);
      expect(client.getThreadPage).toHaveBeenCalledTimes(2);
      expect(read).toHaveBeenCalledTimes(1);
    } finally { cache.clear(); }
  });

  it('rejects repeating cursors while warming toward an older unread message', async () => {
    const cache = new ConversationQueryCache();
    const source = { ...previewMailState().threads[0]!, unread: true, firstUnreadMessageId: 'missing' };
    let count = 0;
    const client = { getThreadPage: rs.fn(async () => ({ providerRevision: source.providerRevision,
      messages: [{ ...source.messages[0]!, messageId: `page-${count++}` }], nextCursor: 'same', complete: false })) };
    try {
      await expect(prepareConversation(cache, source, async () => null, client, new AbortController().signal)).rejects.toThrow('did not advance');
      expect(client.getThreadPage).toHaveBeenCalledTimes(2);
    } finally { cache.clear(); }
  });

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
