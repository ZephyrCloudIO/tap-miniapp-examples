/** @rstest-environment jsdom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect } from '@rstest/core';
import { BodyCoveragePanel } from './body-coverage-panel';
import { previewMailState } from './domain';
import type { MailBodyCoverage } from '@tap-examples/tap-email-protocol';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('body coverage controls', () => {
  it('shows missing scope and unavailable bodies, and scopes pause/resume to the selected account', async () => {
    const account = previewMailState().accounts[0]!;
    let rows: readonly MailBodyCoverage[] = [{ accountId: account.accountId, enabled: false, total: 100,
      downloaded: 80, pending: 18, unavailable: 2, metadataThreads: 3, providerHistoryComplete: false, updatedAt: null, errorCode: null }];
    const changes: unknown[] = [];
    const client = {
      getBodyCoverage: async () => rows,
      setBodyBackfill: async (accountId: string, enabled: boolean) => {
        changes.push({ accountId, enabled }); rows = [{ ...rows[0]!, enabled }]; return rows;
      },
    };
    const container = document.createElement('div'); const root = createRoot(container);
    try {
      await act(async () => root.render(<BodyCoveragePanel accounts={[account]} client={client} />));
      expect(container.textContent).toContain('80 of 100 known messages downloaded');
      expect(container.textContent).toContain('18 pending · 2 unavailable');
      expect(container.textContent).toContain('Provider history is incomplete');
      expect(container.textContent).not.toContain('Caught up');
      await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
      expect(changes).toEqual([{ accountId: account.accountId, enabled: true }]);
      expect(container.textContent).toContain('Pause body downloads');
      await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
      expect(changes.at(-1)).toEqual({ accountId: account.accountId, enabled: false });
    } finally { await act(async () => root.unmount()); }
  });

  it('does not show zero coverage when the status endpoint is unavailable', async () => {
    const container = document.createElement('div'); const root = createRoot(container);
    const client = { getBodyCoverage: async (): Promise<readonly MailBodyCoverage[]> => { throw new Error('offline'); }, setBodyBackfill: async () => [] };
    try {
      await act(async () => root.render(<BodyCoveragePanel accounts={[]} client={client} />));
      expect(container.querySelector('[role=alert]')?.textContent).toContain('Body coverage is unavailable');
      expect(container.textContent).not.toContain('0 known messages');
    } finally { await act(async () => root.unmount()); }
  });
});
