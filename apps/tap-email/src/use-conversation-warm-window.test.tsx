/** @rstest-environment jsdom */
import React, { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, rs } from '@rstest/core';
import { previewMailState, type EmailThread } from './domain';
import { ConversationQueryCache } from './conversation-query-cache';
import { ConversationReaderDeck } from './conversation-reader-deck';
import { conversationReaderKey } from './conversation-warm-window';
import { useConversationWarmWindow } from './use-conversation-warm-window';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('rolling warm window React lifecycle', () => {
  it('registers twenty pending disk queries together and deduplicates Strict Mode replay', async () => {
    const source = previewMailState().threads[0]!;
    const rows = Array.from({ length: 41 }, (_, i) => ({ ...source, threadId: `pending_${i}`, providerRevision: `revision_${i}`,
      downloadedPage: undefined }));
    const cache = new ConversationQueryCache();
    const pending: (() => void)[] = [];
    const read = rs.fn((_account: string, threadId: string) => new Promise<EmailThread>(resolve => pending.push(() => {
      const thread = rows.find(thread => thread.threadId === threadId)!;
      resolve({ ...thread, downloadedPage: { providerRevision: thread.providerRevision,
        nextCursor: null, complete: true, windowed: false, seenCursors: [] } });
    })));
    const container = document.createElement('div'); const root = createRoot(container);
    function Reader() {
      useConversationWarmWindow({ cache, rows, activeKey: conversationReaderKey(rows[20]!), enabled: true,
        preview: false, read, client: null });
      return null;
    }
    try {
      await act(async () => root.render(<StrictMode><Reader /></StrictMode>));
      expect(read).toHaveBeenCalledTimes(20);
      await act(async () => { for (const done of pending) done(); });
      expect(rows.filter(thread => cache.has(thread.accountId, thread.threadId, thread.providerRevision))).toHaveLength(20);
      expect(read).toHaveBeenCalledTimes(20);
    } finally { await act(async () => root.unmount()); cache.clear(); container.remove(); }
  });

  it('warms twenty bodies, mounts at most five readers, moves both ways, and stops after unmount', async () => {
    rs.useFakeTimers(); const source = previewMailState().threads[0]!;
    const rows: EmailThread[] = Array.from({ length: 61 }, (_, i) => ({ ...source, threadId: `react_${i}`,
      providerRevision: `r${i}`, downloadedPage: { providerRevision: `r${i}`, complete: true,
        nextCursor: null, windowed: false, seenCursors: [] } }));
    const cache = new ConversationQueryCache(); const read = rs.fn(async () => null);
    const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
    function Reader({ index, enabled = true }: { index: number; enabled?: boolean }) {
      const activeKey = conversationReaderKey(rows[index]!);
      const keys = useConversationWarmWindow({ cache, rows, activeKey, enabled, preview: false, read, client: null });
      return <ConversationReaderDeck activeKey={activeKey} warmKeys={keys}>
        {(key, active) => <span data-active={active}>{key}</span>}
      </ConversationReaderDeck>;
    }
    const render = async (index: number, enabled = true) => {
      await act(async () => root.render(<StrictMode><Reader index={index} enabled={enabled} /></StrictMode>));
      await act(async () => { rs.advanceTimersByTime(48); for (let i = 0; i < 60; i++) await Promise.resolve(); });
    };
    try {
      await render(30);
      expect(rows.filter(thread => cache.get(thread.accountId, thread.threadId, thread.providerRevision))).toHaveLength(20);
      expect(container.querySelectorAll('[data-reader-active]')).toHaveLength(5);
      for (const index of [31, 32, 33, 32, 31, 30, 29, 28]) {
        await render(index);
        expect(container.querySelectorAll('[data-reader-active]').length).toBeLessThanOrEqual(5);
        expect(container.querySelector('[data-active="true"]')?.textContent).toBe(conversationReaderKey(rows[index]!));
        for (const distance of [-10, -1, 1, 10]) {
          const thread = rows[index + distance]!;
          expect(cache.get(thread.accountId, thread.threadId, thread.providerRevision)).toBeDefined();
        }
      }
      expect(read).not.toHaveBeenCalled();
      await render(28, false);
      await act(async () => root.unmount());
      cache.clear(); rs.advanceTimersByTime(1000);
      expect(cache.client.getQueryCache().getAll()).toHaveLength(0);
    } finally { await act(async () => root.unmount()); cache.clear(); container.remove(); rs.useRealTimers(); }
  });
});
