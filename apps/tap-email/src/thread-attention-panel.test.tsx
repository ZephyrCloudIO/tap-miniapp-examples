/** @rstest-environment jsdom */

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from '@rstest/core';
import type { EmailAccount, EmailThread } from './domain';
import { ThreadAttentionPanel } from './thread-attention-panel';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const account: EmailAccount = {
  accountId: 'acct_work',
  provider: 'google',
  address: 'zack@example.com',
  displayName: 'Zack',
  accent: '#fff',
  coverage: {
    accountId: 'acct_work',
    state: 'current',
    newestHistoryId: '10',
    observedAt: '2026-09-14T10:00:00.000Z',
    backfillCompleteThrough: '2025-01-01T00:00:00.000Z',
    unresolvedFailures: 0,
  },
};

const thread: EmailThread = {
  threadId: 'thread_1',
  accountId: account.accountId,
  providerRevision: '10',
  subject: 'Action required: subscription payment is past due',
  participants: [{ name: 'Finance', address: 'finance@example.com' }],
  snippet: 'Please review the invoice.',
  receivedAt: '2026-09-14T09:00:00.000Z',
  unread: true,
  starred: false,
  critical: true,
  needsResponse: true,
  waitingOnOthers: false,
  status: 'inbox',
  labels: ['INBOX'],
  messages: [],
  reminder: {
    reminderId: 'reminder_1',
    accountId: account.accountId,
    threadId: 'thread_1',
    dueAt: '2026-09-14T09:30:00.000Z',
    condition: 'if_no_reply',
    createdAt: '2026-09-13T09:30:00.000Z',
  },
};

describe('ThreadAttentionPanel', () => {
  it('shows a compact explanation and exposes exact evidence', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          <ThreadAttentionPanel
            account={account}
            now={new Date('2026-09-14T10:00:00.000Z')}
            onCorrect={() => undefined}
            thread={thread}
            timeZone="UTC"
          />,
        );
      });

      const summary = container.querySelector('summary')!;
      expect(summary.textContent).toContain('Reply');
      expect(summary.textContent).toContain('Immediate');
      expect(summary.textContent).toContain('Owner: Zack');
      expect(summary.textContent).toContain('Waiting: Zack');
      expect(summary.textContent).toContain('Billing risk');
      expect(summary.textContent).toContain('Medium confidence');
      expect(summary.querySelector('time')?.dateTime).toBe('2026-09-14T09:30:00.000Z');

      await act(async () => summary.click());
      expect(container.querySelector('details')?.open).toBe(true);
      expect(container.querySelector('[aria-labelledby="attention-evidence-heading"]')?.textContent)
        .toContain('The thread is currently in Critical.');
      expect(container.querySelector('[aria-labelledby="attention-evidence-heading"]')?.textContent)
        .toContain('The reminder is due.');
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('emits complete, mutually exclusive corrections from accessible controls', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const corrections: Array<{ critical?: boolean; responseState?: string }> = [];

    try {
      await act(async () => {
        root.render(
          <ThreadAttentionPanel
            account={account}
            now={new Date('2026-09-14T10:00:00.000Z')}
            onCorrect={correction => corrections.push(correction)}
            thread={thread}
            timeZone="UTC"
          />,
        );
      });

      const buttons = [...container.querySelectorAll<HTMLButtonElement>('button')];
      expect(buttons.map(button => button.textContent?.trim())).toEqual([
        'Critical',
        'Not critical',
        'Needs my reply',
        'Waiting on them',
        'No response needed',
      ]);
      expect(buttons.map(button => button.getAttribute('aria-pressed'))).toEqual([
        'true', 'false', 'true', 'false', 'false',
      ]);

      await act(async () => buttons[1]?.click());
      await act(async () => buttons[3]?.click());
      expect(corrections).toEqual([
        { critical: false },
        { responseState: 'waiting' },
      ]);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
