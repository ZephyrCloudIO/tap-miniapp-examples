import { describe, expect, it } from '@rstest/core';
import { boundMailWindow } from './bounded-mail-replica';
import { emailThreadKey, mergeMailboxPage, previewMailState } from './domain';
import { MailWindowRefresh, retainMailWindow } from './mail-window-refresh';

describe('mail window refresh', () => {
  it('finishes an in-flight read despite continuous sync commits and coalesces the next read', async () => {
    const gates: (() => void)[] = [];
    const signals: AbortSignal[] = [];
    const delivered: number[] = [];
    const errors: unknown[] = [];
    const refresh = new MailWindowRefresh(async signal => {
      const page = signals.push(signal);
      await new Promise<void>(resolve => gates.push(resolve));
      if (!signal.aborted) delivered.push(page);
    }, error => errors.push(error));
    refresh.refresh();
    for (let index = 0; index < 100; index++) refresh.refresh();
    expect(signals).toHaveLength(1);
    expect(signals[0]!.aborted).toBe(false);
    gates[0]!();
    await Promise.resolve();
    await Promise.resolve();
    expect(delivered).toEqual([1]);
    expect(signals).toHaveLength(2);
    gates[1]!();
    await Promise.resolve();
    await Promise.resolve();
    expect(delivered).toEqual([1, 2]);
    expect(errors).toEqual([]);
    refresh.dispose();
  });

  it('cancels a superseded account/page read without reporting an error or starting its queued refresh', async () => {
    let release!: () => void;
    let reads = 0;
    let delivered = 0;
    const errors: unknown[] = [];
    const refresh = new MailWindowRefresh(async signal => {
      reads++;
      await new Promise<void>(resolve => { release = resolve; });
      signal.throwIfAborted();
      delivered++;
    }, error => errors.push(error));
    refresh.refresh();
    refresh.refresh();
    refresh.dispose();
    release();
    await Promise.resolve();
    await Promise.resolve();
    expect(reads).toBe(1);
    expect(delivered).toBe(0);
    expect(errors).toEqual([]);
  });

  it('keeps an older selected account window while incoming mail updates matching rows', () => {
    const seed = previewMailState();
    const displayed = Array.from({ length: 100 }, (_, index) => ({ ...seed.threads[0]!,
      threadId: `visible_${index}`, receivedAt: '2025-01-01T00:00:00.000Z',
    }));
    const current = { ...seed, threads: displayed, selectedThreadKey: emailThreadKey(displayed[0]!) };
    const incoming = Array.from({ length: 100 }, (_, index) => ({ ...seed.threads[1]!,
      threadId: `incoming_${index}`, receivedAt: '2026-01-01T00:00:00.000Z',
    }));
    const merged = mergeMailboxPage(current, { schemaVersion: 1, accounts: seed.accounts,
      threads: [...incoming, { ...displayed[5]!, starred: true }] });
    const result = boundMailWindow(retainMailWindow(current, merged));
    expect(new Set(result.threads.map(emailThreadKey))).toEqual(new Set(displayed.map(emailThreadKey)));
    expect(result.threads.find(thread => thread.threadId === displayed[5]!.threadId)!.starred).toBe(true);
    const deleted = { ...merged, threads: merged.threads.filter(thread => thread.threadId !== displayed[4]!.threadId) };
    expect(retainMailWindow(current, deleted).threads.some(thread => thread.threadId === displayed[4]!.threadId)).toBe(false);
  });
});
