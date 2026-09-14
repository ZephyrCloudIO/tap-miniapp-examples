/** @rstest-environment jsdom */

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from '@rstest/core';
import type { ScheduledSendSummary } from '@tap-examples/tap-email-protocol';
import { previewMailState } from './domain';
import { ScheduledSendList } from './scheduled-send-list';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const scheduled: ScheduledSendSummary = {
  scheduleCommandId: 'cmd_schedule_1',
  accountId: 'google_work',
  threadId: 'thread_1',
  draftKey: 'draft_1',
  to: 'maya@example.com',
  subject: 'Launch follow-up',
  dueAt: '2026-09-15T12:00:00.000Z',
  cancelIfReply: true,
  state: 'pending',
  dispatchCommandId: null,
  errorCode: null,
};

describe('ScheduledSendList', () => {
  it('shows account, due policy, and an explicit cancel action', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const cancelled: ScheduledSendSummary[] = [];
    try {
      await act(async () => root.render(
        <ScheduledSendList
          accounts={previewMailState().accounts}
          items={[scheduled]}
          now={new Date('2026-09-14T12:00:00.000Z')}
          onCancel={item => cancelled.push(item)}
        />,
      ));
      expect(container.textContent).toContain('Launch follow-up');
      expect(container.textContent).toContain('Cancel if they reply');
      expect(container.querySelector('time')?.dateTime).toBe(scheduled.dueAt);
      await act(async () => container.querySelector<HTMLButtonElement>('button')?.click());
      expect(cancelled).toEqual([scheduled]);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('keeps failed sends visible without offering a misleading cancel', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
      await act(async () => root.render(
        <ScheduledSendList
          accounts={[]}
          items={[{ ...scheduled, state: 'uncertain', errorCode: 'gmail_send_outcome_unknown' }]}
          onCancel={() => undefined}
        />,
      ));
      expect(container.textContent).toContain('Needs attention');
      expect(container.querySelector('button')).toBeNull();
    } finally {
      await act(async () => root.unmount());
    }
  });
});
