import { describe, expect, it, rs } from '@rstest/core';
import { ConversationQueryCache } from './conversation-query-cache';
import * as boundedSql from './bounded-sql';
import { onlineManager } from '@tanstack/react-query';
import type { ThreadPage } from './coordinator-client';
import { previewMailState } from './domain';

const messages = previewMailState().threads[0]!.messages;
const page = (revision = 'r1'): ThreadPage => ({ messages, providerRevision: revision, nextCursor: null, complete: true });

describe('miniapp conversation Query cache', () => {
  it('measures each new snapshot once instead of serializing the whole cache again', () => {
    const cache = new ConversationQueryCache();
    const size = rs.spyOn(boundedSql, 'serializedBytes');
    try {
      for (let index = 0; index < 10; index++) cache.remember('account', `thread-${index}`, {
        messages, downloadedPage: { providerRevision: 'r1', nextCursor: null, complete: true, windowed: false, seenCursors: [] },
      });
      expect(size).toHaveBeenCalledTimes(10);
    } finally { cache.clear(); size.mockRestore(); }
  });

  it('retains a verified disk download when its reader has already left', async () => {
    const cache = new ConversationQueryCache();
    const source = previewMailState().threads[0]!;
    try {
      await cache.localThread(source.accountId, source.threadId, source.providerRevision, async () => ({
        ...source, downloadedPage: { providerRevision: source.providerRevision, nextCursor: null, complete: true,
          windowed: false, seenCursors: [] },
      }));
      expect(cache.get(source.accountId, source.threadId, source.providerRevision)?.messages).toBe(source.messages);
    } finally { cache.clear(); }
  });

  it('keeps recently opened snapshots and releases their byte charge after removal', () => {
    const value = { messages, downloadedPage: { providerRevision: 'r1', nextCursor: null,
      complete: true, windowed: false, seenCursors: [] } };
    const cache = new ConversationQueryCache(boundedSql.serializedBytes(value) * 2);
    try {
      cache.remember('account', 'a', value);
      cache.remember('account', 'b', value);
      expect(cache.get('account', 'a', 'r1')).toBeDefined();
      cache.remember('account', 'c', value);
      expect(cache.get('account', 'b', 'r1')).toBeUndefined();
      expect(cache.get('account', 'a', 'r1')).toBeDefined();
      cache.client.removeQueries({ queryKey: ['email-reader', 'account', 'a'] });
      cache.remember('account', 'd', value);
      expect(cache.get('account', 'c', 'r1')).toBeDefined();
      expect(cache.get('account', 'd', 'r1')).toBeDefined();
      cache.clear();
      cache.remember('account', 'e', value);
      expect(cache.get('account', 'e', 'r1')).toBeDefined();
    } finally { cache.clear(); }
  });

  it('reads SQLite while offline and shares only the pending scoped lookup', async () => {
    const cache = new ConversationQueryCache();
    const previousOnline = onlineManager.isOnline();
    let resolve!: (value: null) => void;
    const read = rs.fn(() => new Promise<null>(done => { resolve = done; }));
    onlineManager.setOnline(false);
    try {
      const first = cache.localThread('account', 'thread', 'r1', read);
      const replay = cache.localThread('account', 'thread', 'r1', read);
      expect(read).toHaveBeenCalledTimes(1);
      resolve(null);
      expect(await first).toBeNull();
      expect(await replay).toBeNull();
      const newRead = rs.fn(async () => null);
      await cache.localThread('account', 'thread', 'r1', newRead);
      expect(newRead).toHaveBeenCalledTimes(1);
    } finally { cache.clear(); onlineManager.setOnline(previousOnline); }
  });

  it('aborts shared disk work when the account is removed', async () => {
    const cache = new ConversationQueryCache();
    let signal!: AbortSignal;
    const pending = cache.localThread('account', 'thread', 'r1', value => {
      signal = value;
      return new Promise(() => {});
    }).catch(() => undefined);
    expect(signal.aborted).toBe(false);
    cache.retainAccounts(new Set());
    expect(signal.aborted).toBe(true);
    await pending;
    expect(cache.client.getQueryCache().getAll()).toHaveLength(0);
  });

  it('deduplicates pending reads and reuses completed first pages across reader mounts', async () => {
    const cache = new ConversationQueryCache();
    let resolve!: (value: ThreadPage) => void;
    const fetch = rs.fn(() => new Promise<ThreadPage>(done => { resolve = done; }));
    try {
      const first = cache.page('account', 'thread', 'r1', null, fetch);
      const reopened = cache.page('account', 'thread', 'r1', null, fetch);
      expect(fetch).toHaveBeenCalledTimes(1);
      resolve(page());
      expect(await first).toEqual(await reopened);
      expect(cache.get('account', 'thread', 'r1')?.messages).toEqual(messages);
      await cache.page('account', 'thread', 'r1', null, fetch);
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally { cache.clear(); }
  });

  it('isolates accounts, revisions and independent miniapp sessions', async () => {
    const first = new ConversationQueryCache();
    const second = new ConversationQueryCache();
    try {
      await first.page('account', 'thread', 'r1', null, async () => page());
      expect(first.get('other', 'thread', 'r1')).toBeUndefined();
      expect(first.get('account', 'thread', 'r2')).toBeUndefined();
      expect(second.get('account', 'thread', 'r1')).toBeUndefined();
      first.retainRevision('account', 'thread', 'r2');
      expect(first.get('account', 'thread', 'r1')).toBeUndefined();
      await first.page('account', 'thread', 'r2', null, async () => page('r2'));
      first.retainAccounts(new Set(['other']));
      expect(first.get('account', 'thread', 'r2')).toBeUndefined();
    } finally { first.clear(); second.clear(); }
  });

  it('keeps a partial accumulated snapshot and bounds completed body storage', async () => {
    const cache = new ConversationQueryCache();
    const tiny = new ConversationQueryCache(1);
    const downloadedPage = { providerRevision: 'r1', nextCursor: 'older', complete: false,
      windowed: true, seenCursors: ['older'] };
    try {
      cache.remember('account', 'thread', { messages, downloadedPage });
      expect(cache.get('account', 'thread', 'r1')?.downloadedPage).toEqual(downloadedPage);
      await tiny.page('account', 'thread', 'r1', null, async () => page());
      expect(tiny.client.getQueryCache().getAll()).toHaveLength(0);
    } finally { cache.clear(); tiny.clear(); }
  });

  it('does not cache a mismatched revision or repopulate cleared queries from a late read', async () => {
    const cache = new ConversationQueryCache();
    try {
      await expect(cache.page('account', 'thread', 'r1', null, async () => page('r2'))).rejects.toThrow('conversation changed');
      expect(cache.get('account', 'thread', 'r1')).toBeUndefined();
      let resolve!: (value: ThreadPage) => void;
      const pending = cache.page('account', 'thread', 'r1', null,
        () => new Promise<ThreadPage>(done => { resolve = done; })).catch(() => undefined);
      cache.clear();
      resolve(page());
      await pending;
      expect(cache.get('account', 'thread', 'r1')).toBeUndefined();
    } finally { cache.clear(); }
  });
});
