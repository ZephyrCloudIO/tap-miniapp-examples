/** @rstest-environment jsdom */
import React, { StrictMode, act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, rs } from '@rstest/core';
import { useMailboxCounts } from './use-mailbox-counts';
import { mailboxSummary, previewMailState, type MailState } from './domain';
import type { LocalMailStore } from './local-store';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const now = Date.parse('2026-10-03T00:00:00Z');
const seed = previewMailState();
const thread = { ...seed.threads[0]!, status: 'inbox' as const, critical: true, needsResponse: true, providerResources: ['inbox'] as const };
const state = { ...seed, threads: [thread], selectedAccountId: thread.accountId };
const summary = { ...mailboxSummary(state, new Date(now).toISOString()), inbox: 240, critical: 120, needsResponse: 200,
  mailboxCounts: { inbox: 240, critical: 120, 'needs-response': 200, starred: 0, done: 0 } };

describe('mailbox count React lifecycle', () => {
  it('retains cached totals with a partial marker when a refresh fails', async () => {
    const summarize = rs.fn().mockResolvedValueOnce({ ...summary, coverageComplete: true }).mockRejectedValueOnce(new Error('disk unavailable'));
    const store = { summarize } as unknown as LocalMailStore;
    const root = createRoot(document.createElement('div'));
    let value = { inbox: 0, coverageComplete: true };
    function Counts({ version }: { version: number }) {
      value = useMailboxCounts({ ...state, accounts: state.accounts.map(account => ({ ...account, coverage: { ...account.coverage, state: 'current' } })) }, store, true, version, now);
      return null;
    }
    try {
      await act(async () => root.render(<Counts version={1} />));
      expect(value.inbox).toBe(240);
      expect(value.coverageComplete).toBe(true);
      await act(async () => root.render(<Counts version={2} />));
      expect(value.inbox).toBe(240);
      expect(value.coverageComplete).toBe(false);
    } finally { await act(async () => root.unmount()); }
  });
  it('deduplicates Strict Mode and navigation, publishes local actions immediately and coalesces refreshes', async () => {
    const completions: ((value: typeof summary) => void)[] = [];
    const summarize = rs.fn(() => new Promise<typeof summary>(resolve => completions.push(resolve)));
    const store = { capability: 'profile-sqlite', summarize } as unknown as LocalMailStore;
    const container = document.createElement('div');
    const root = createRoot(container);
    function Counts({ value }: { value: MailState }) {
      const counts = useMailboxCounts(value, store, true, 1, now);
      return <output>{counts.inbox}/{counts.critical}</output>;
    }
    const render = (value: MailState) => act(async () => { root.render(<StrictMode><Counts value={value} /></StrictMode>); });
    try {
      await render(state);
      expect(summarize).toHaveBeenCalledTimes(1);
      await act(async () => completions.shift()!(summary));
      expect(summarize).toHaveBeenCalledTimes(1);
      expect(container.textContent).toBe('240/120');
      await render({ ...state, selectedThreadKey: null, pendingThreadIntents: [{ commandId: 'read', accountId: thread.accountId, threadId: thread.threadId, patch: { unread: false } }] });
      expect(summarize).toHaveBeenCalledTimes(1);
      const archived = { ...state, pendingThreadIntents: [{ commandId: 'archive', accountId: thread.accountId, threadId: thread.threadId,
        patch: { status: 'done' as const, providerResources: [] } }] };
      await render(archived);
      expect(container.textContent).toBe('239/119');
      expect(summarize).toHaveBeenCalledTimes(2);
      await render(state); // Undo before the slow query completes.
      expect(container.textContent).toBe('240/120');
      expect(summarize).toHaveBeenCalledTimes(2);
      await act(async () => completions.shift()!({ ...summary, inbox: 239, critical: 119, needsResponse: 199,
        mailboxCounts: { ...summary.mailboxCounts, inbox: 239, critical: 119, 'needs-response': 199, done: 1 } }));
      expect(container.textContent).toBe('240/120');
      expect(summarize).toHaveBeenCalledTimes(3);
      await act(async () => completions.shift()!(summary));
      expect(container.textContent).toBe('240/120');
    } finally { await act(async () => root.unmount()); }
  });

  it('rejects another account or store scope while an old summary is pending', async () => {
    const completions: ((value: typeof summary) => void)[] = [];
    const summarize = rs.fn(() => new Promise<typeof summary>(resolve => completions.push(resolve)));
    const store = { summarize } as unknown as LocalMailStore;
    const otherStore = { summarize } as unknown as LocalMailStore;
    const root = createRoot(document.createElement('div'));
    let value = 0;
    function Counts({ current, port }: { current: MailState; port: LocalMailStore }) {
      value = useMailboxCounts(current, port, true, 1, now).inbox;
      return null;
    }
    try {
      await act(async () => root.render(<Counts current={state} port={store} />));
      const other = { ...state, selectedAccountId: seed.accounts.find(account => account.accountId !== thread.accountId)!.accountId };
      await act(async () => root.render(<Counts current={other} port={store} />));
      await act(async () => completions.shift()!(summary));
      expect(value).toBe(0);
      expect(summarize).toHaveBeenCalledTimes(2);
      await act(async () => completions.shift()!({ ...summary, inbox: 7, mailboxCounts: { ...summary.mailboxCounts, inbox: 7 } }));
      expect(value).toBe(7);
      await act(async () => root.render(<Counts current={other} port={otherStore} />));
      expect(value).toBe(0);
      await act(async () => completions.shift()!({ ...summary, inbox: 9, mailboxCounts: { ...summary.mailboxCounts, inbox: 9 } }));
      expect(value).toBe(9);
    } finally { await act(async () => root.unmount()); }
  });
});
