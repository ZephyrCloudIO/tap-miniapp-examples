import { describe, expect, it, rs } from '@rstest/core';
import { previewMailState, type EmailThread } from './domain';
import { ConversationQueryCache } from './conversation-query-cache';
import { prepareConversation } from './conversation-prefetch';
import { ConversationWarmWindow, conversationReaderKey, conversationWarmWindow } from './conversation-warm-window';

const rows = (): EmailThread[] => Array.from({ length: 81 }, (_, index) => ({
  ...previewMailState().threads[0]!, threadId: `moving_${index}`, providerRevision: `revision_${index}`,
}));
const downloaded = (thread: EmailThread): EmailThread => ({ ...thread, downloadedPage: {
  providerRevision: thread.providerRevision, nextCursor: null, complete: true, windowed: false, seenCursors: [],
} });
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const advance = async (ms: number) => {
  for (let elapsed = 0; elapsed < ms; elapsed += 10) { rs.advanceTimersByTime(Math.min(10, ms - elapsed)); await flush(); }
};

describe('moving conversation warm window', () => {
  it('coalesces movement during a disk restore and restores only the latest window next', async () => {
    const threads = rows(); let finish!: () => void;
    const restore = rs.fn((_threads: readonly EmailThread[]) => new Promise<void>(resolve => { finish = resolve; }));
    const warmer = new ConversationWarmWindow(() => false, async () => false, () => undefined, 2, restore);
    try {
      warmer.update(threads, conversationReaderKey(threads[20]!));
      for (const index of [30, 40, 50]) warmer.update(threads, conversationReaderKey(threads[index]!));
      expect(restore).toHaveBeenCalledTimes(1);
      finish(); await flush(); expect(restore).toHaveBeenCalledTimes(2);
      const batch = restore.mock.calls[1]?.[0] as readonly EmailThread[] | undefined;
      expect(batch?.map(thread => thread.threadId)).toEqual(conversationWarmWindow(threads, conversationReaderKey(threads[50]!), 1)
        .map(thread => thread.threadId));
      warmer.dispose(); finish(); await flush(); expect(restore).toHaveBeenCalledTimes(2);
    } finally { warmer.dispose(); finish(); await flush(); }
  });

  it('reproduces the former one-neighbor cache falling behind the same sixty-key sequence', async () => {
    rs.useFakeTimers(); const threads = rows(); const cache = new ConversationQueryCache();
    const read = (_account: string, threadId: string) => new Promise<EmailThread>(resolve => {
      setTimeout(() => resolve(downloaded(threads.find(thread => thread.threadId === threadId)!)), 150);
    });
    let timer: ReturnType<typeof setTimeout> | undefined; let abort: AbortController | undefined;
    // The released 1.0.1 effect: one on each side, reset a 48 ms timer per move.
    const move = (index: number) => {
      clearTimeout(timer); abort?.abort(); abort = new AbortController(); const signal = abort.signal;
      timer = setTimeout(() => {
        void Promise.all([threads[index + 1]!, threads[index - 1]!].map(thread =>
          prepareConversation(cache, thread, read, null, signal)));
      }, 48);
    };
    let hits = 0;
    try {
      move(30); await advance(1800);
      expect(threads.filter(thread => cache.has(thread.accountId, thread.threadId, thread.providerRevision))).toHaveLength(2);
      for (const index of [...Array.from({ length: 30 }, (_, i) => 31 + i), ...Array.from({ length: 30 }, (_, i) => 59 - i)]) {
        const thread = threads[index]!;
        if (cache.has(thread.accountId, thread.threadId, thread.providerRevision)) hits++;
        move(index); await advance(100);
      }
      expect(hits).toBe(31); // 29 forward selections reach a body that is still loading.
    } finally { clearTimeout(timer); abort?.abort(); await advance(200); cache.clear(); rs.useRealTimers(); }
  });
  it('covers exactly ten on each side and changes nearest-first priority on reversal', () => {
    const threads = rows();
    const plan = conversationWarmWindow(threads, conversationReaderKey(threads[40]!), 1);
    expect(plan.map(thread => thread.threadId)).toEqual(Array.from({ length: 10 }, (_, i) =>
      [`moving_${41 + i}`, `moving_${39 - i}`]).flat());
    expect(conversationWarmWindow(threads, conversationReaderKey(threads[40]!), -1)[0]!.threadId).toBe('moving_39');
    expect(conversationWarmWindow(threads, conversationReaderKey(threads[0]!), 1)).toHaveLength(10);
    expect(conversationWarmWindow(threads, 'missing', 1)).toEqual([]);
  });

  it('publishes a ready neighbor while the other neighbor is still stalled', async () => {
    rs.useFakeTimers();
    const threads = rows(); const ready = new Set<string>(); const publications: string[][] = [];
    const pending = new Map<string, () => void>();
    const prepare = rs.fn((thread: EmailThread) => new Promise<boolean>(resolve => {
      pending.set(thread.threadId, () => { ready.add(thread.threadId); resolve(true); });
    }));
    const warmer = new ConversationWarmWindow(thread => ready.has(thread.threadId), prepare,
      keys => publications.push([...keys]));
    try {
      warmer.update(threads, conversationReaderKey(threads[40]!)); await advance(48);
      expect(prepare).toHaveBeenCalledTimes(2);
      pending.get('moving_41')!(); await flush();
      expect(publications.at(-1)).toContain(conversationReaderKey(threads[41]!));
      expect(publications.at(-1)).not.toContain(conversationReaderKey(threads[39]!));
      expect(prepare).toHaveBeenCalledTimes(3); // Fill the free slot immediately.
    } finally { warmer.dispose(); for (const done of pending.values()) done(); await flush(); rs.useRealTimers(); }
  });

  it('does not reset preparation on rapid keys, cancels obsolete work, and keeps concurrency bounded', async () => {
    rs.useFakeTimers(); const threads = rows(); const signals: AbortSignal[] = [];
    const pending: (() => void)[] = [];
    const prepare = rs.fn((_thread: EmailThread, signal: AbortSignal) => {
      signals.push(signal); return new Promise<boolean>(resolve => pending.push(() => resolve(false)));
    });
    const publish = rs.fn(); const warmer = new ConversationWarmWindow(() => false, prepare, publish);
    try {
      for (let index = 20; index < 25; index++) { warmer.update(threads, conversationReaderKey(threads[index]!)); await advance(10); }
      expect(prepare).toHaveBeenCalledTimes(2); // First timer fires despite keys every 10 ms.
      warmer.update(threads, conversationReaderKey(threads[60]!));
      expect(signals.every(signal => signal.aborted)).toBe(true);
      expect(prepare).toHaveBeenCalledTimes(2); // Uncancelable transports still occupy their slots.
      pending[0]!(); await flush(); expect(prepare).toHaveBeenCalledTimes(3);
      expect(prepare.mock.calls[2]![0].threadId).toBe('moving_61');
      warmer.dispose(); publish.mockClear();
      for (const done of pending) done(); await flush(); expect(publish).not.toHaveBeenCalled();
    } finally { warmer.dispose(); for (const done of pending) done(); await flush(); rs.useRealTimers(); }
  });

  it('keeps thirty forward and thirty reverse opens in memory with 150 ms disk reads and keys every 100 ms', async () => {
    rs.useFakeTimers(); const threads = rows(); const cache = new ConversationQueryCache();
    let reads = 0; let inFlight = 0; let maximumInFlight = 0;
    const read = rs.fn((_account: string, threadId: string) => new Promise<EmailThread>(resolve => {
      reads++; inFlight++; maximumInFlight = Math.max(maximumInFlight, inFlight);
      setTimeout(() => { inFlight--; resolve(downloaded(threads.find(thread => thread.threadId === threadId)!)); }, 150);
    }));
    const client = { getThreadPage: rs.fn() }; let keys: readonly string[] = [];
    const warmer = new ConversationWarmWindow(thread => cache.has(thread.accountId, thread.threadId, thread.providerRevision),
      (thread, signal) => prepareConversation(cache, thread, read, client, signal), next => { keys = next; });
    let hits = 0;
    try {
      warmer.update(threads, conversationReaderKey(threads[30]!)); await advance(1800);
      const initiallyWarmed = threads.filter(thread => cache.get(thread.accountId, thread.threadId, thread.providerRevision));
      expect(initiallyWarmed).toHaveLength(20);
      for (const index of [...Array.from({ length: 30 }, (_, i) => 31 + i), ...Array.from({ length: 30 }, (_, i) => 59 - i)]) {
        const thread = threads[index]!;
        if (cache.get(thread.accountId, thread.threadId, thread.providerRevision)) hits++;
        warmer.update(threads, conversationReaderKey(thread)); await advance(100);
        expect(keys.length).toBeLessThanOrEqual(4);
      }
      expect(hits).toBe(60);
      expect(maximumInFlight).toBeLessThanOrEqual(2);
      expect(client.getThreadPage).not.toHaveBeenCalled();
      // Crossing the initial radius continues preparing new mail, without rereading revisits.
      expect(reads).toBeGreaterThan(20);
      expect(new Set(read.mock.calls.map(call => call[1])).size).toBe(reads);
    } finally { warmer.dispose(); await advance(200); cache.clear(); rs.useRealTimers(); }
  });

  it('shares a pending warmed disk read with a foreground open', async () => {
    const threads = rows(); const thread = threads[20]!; const cache = new ConversationQueryCache();
    let finish!: (value: EmailThread) => void;
    const read = rs.fn(() => new Promise<EmailThread>(resolve => { finish = resolve; }));
    try {
      const warm = prepareConversation(cache, thread, read, null, new AbortController().signal);
      const foreground = cache.localThread(thread.accountId, thread.threadId, thread.providerRevision, read);
      finish(downloaded(thread)); await Promise.all([warm, foreground]);
      expect(read).toHaveBeenCalledTimes(1);
      expect(cache.get(thread.accountId, thread.threadId, thread.providerRevision)?.messages).toBe(thread.messages);
    } finally { cache.clear(); }
  });

  it('does not publish an obsolete revision after a mailbox refresh', async () => {
    rs.useFakeTimers(); const threads = rows(); const ready = new Set<string>();
    const pending = new Map<string, () => void>(); let published: readonly string[] = [];
    const warmer = new ConversationWarmWindow(thread => ready.has(conversationReaderKey(thread)),
      thread => new Promise(resolve => pending.set(conversationReaderKey(thread), () => {
        ready.add(conversationReaderKey(thread)); resolve(true);
      })), keys => { published = keys; });
    try {
      warmer.update(threads, conversationReaderKey(threads[40]!)); await advance(48);
      const obsolete = conversationReaderKey(threads[41]!);
      const updated = threads.map((thread, i) => i === 41 ? { ...thread, providerRevision: 'new-revision' } : thread);
      warmer.update(updated, conversationReaderKey(updated[40]!));
      pending.get(obsolete)!(); await flush();
      expect(published).not.toContain(obsolete);
      const fresh = conversationReaderKey(updated[41]!);
      expect(pending.has(fresh)).toBe(true);
      pending.get(fresh)!(); await flush(); expect(published).toContain(fresh);
    } finally { warmer.dispose(); for (const done of pending.values()) done(); await flush(); rs.useRealTimers(); }
  });
});
