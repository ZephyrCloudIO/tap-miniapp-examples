import { describe, expect, it, rs } from '@rstest/core';
import { createConversationDiskReader } from './conversation-disk-reader';
import { previewMailState, emailThreadKey } from './domain';

describe('coalesced conversation disk reads', () => {
  it('caps each bridge batch at twenty-one and runs only one batch at a time', async () => {
    let running = 0; let maximum = 0;
    const loadThreads = rs.fn(async (_identities: readonly { accountId: string; threadId: string }[]) => {
      running++; maximum = Math.max(maximum, running); await Promise.resolve(); running--;
      return new Map();
    });
    const read = createConversationDiskReader({ loadThreads });
    await Promise.all(Array.from({ length: 50 }, (_, i) => read('account', `thread_${i}`, new AbortController().signal)));
    expect(loadThreads.mock.calls.map(call => call[0].length)).toEqual([21, 21, 8]);
    expect(maximum).toBe(1);
  });

  it('shares a bounded batch, preserves account identity, and does not cancel a live sibling', async () => {
    const source = previewMailState().threads[0]!;
    const other = { ...source, accountId: 'other' };
    let finish!: (value: ReadonlyMap<string, typeof source>) => void;
    const loadThreads = rs.fn((_identities: readonly { accountId: string; threadId: string }[], _signal?: AbortSignal) =>
      new Promise<ReadonlyMap<string, typeof source>>(resolve => { finish = resolve; }));
    const read = createConversationDiskReader({ loadThreads });
    const a = new AbortController(); const b = new AbortController();
    const first = read(source.accountId, source.threadId, a.signal).catch(() => null);
    const second = read(other.accountId, other.threadId, b.signal);
    await Promise.resolve(); a.abort();
    expect(loadThreads).toHaveBeenCalledTimes(1);
    expect(loadThreads.mock.calls[0]![1]?.aborted).toBe(false);
    finish(new Map([[emailThreadKey(source), source], [emailThreadKey(other), other]]));
    expect(await first).toBeNull(); expect(await second).toBe(other);
  });

  it('skips canceled queued requests and retries after a failed batch', async () => {
    const loadThreads = rs.fn(async () => { throw new Error('disk unavailable'); });
    const read = createConversationDiskReader({ loadThreads });
    const abort = new AbortController();
    const canceled = read('a', 'canceled', abort.signal); abort.abort();
    await expect(canceled).rejects.toBeDefined(); expect(loadThreads).not.toHaveBeenCalled();
    await expect(read('a', 'retry', new AbortController().signal)).rejects.toThrow('disk unavailable');
    await expect(read('a', 'retry', new AbortController().signal)).rejects.toThrow('disk unavailable');
    expect(loadThreads).toHaveBeenCalledTimes(2);
  });
});
