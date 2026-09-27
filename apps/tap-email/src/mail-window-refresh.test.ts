import { describe, expect, it } from '@rstest/core';
import { boundMailWindow } from './bounded-mail-replica';
import { emailThreadKey, mergeMailboxPage, previewMailState } from './domain';
import { MailWindowCache, MailWindowRefresh, mergeMailWindow, retainMailWindow } from './mail-window-refresh';

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

  it('returns cached account/pages synchronously, bounds retention, and clears on wipe', () => {
    const cache = new MailWindowCache();
    const seed = previewMailState();
    const rows = seed.threads.map(thread => ({ ...thread, messages: thread.messages.map(({ bodyHtml: _html, ...message }) => message) }));
    cache.set('work/inbox/1', rows);
    cache.set('personal/sent/2', rows.slice(0, 1));
    expect(cache.get('work/inbox/1')![0]).toBe(rows[0]);
    expect(cache.get('personal/sent/1')).toBeUndefined();
    for (let index = 0; index < 12; index++) cache.set(`page-${index}`, rows);
    expect(cache.get('work/inbox/1')).toBeUndefined();
    cache.clear();
    expect(cache.get('page-11')).toBeUndefined();
  });

  it('retains hydrated object identity and bounds bytes across recent views', () => {
    const cache = new MailWindowCache();
    const source = previewMailState().threads[0]!;
    const thread = { ...source, messages: [{ ...source.messages[0]!, bodyHtml: '<b>Hydrated</b>', bodyText: 'x'.repeat(4_300_000) }] };
    cache.set('first', [thread]);
    expect(cache.get('first')![0]).toBe(thread);
    cache.set('second', [thread]);
    expect(cache.get('first')).toBeUndefined();
    expect(cache.get('second')![0]!.messages[0]!.bodyHtml).toBe('<b>Hydrated</b>');
  });

  it('keeps current local edits and selected bodies while incremental rows arrive', () => {
    const seed = previewMailState();
    const original = seed.threads[0]!;
    const edited = { ...original, starred: !original.starred };
    const current = { ...seed, threads: [edited], selectedThreadKey: emailThreadKey(edited) };
    expect(mergeMailWindow(current, [original]).threads[0]).toBe(edited);
    expect(mergeMailWindow(current, [seed.threads[1]!]).threads).toEqual([seed.threads[1], edited]);
    const updated = { ...original, providerRevision: 'newer-provider-revision' };
    expect(mergeMailWindow(current, [updated]).threads[0]).toBe(updated);
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
