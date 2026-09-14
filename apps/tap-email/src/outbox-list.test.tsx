/** @rstest-environment jsdom */

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from '@rstest/core';
import type { MailCommandReceipt } from '@tap-examples/tap-email-protocol';
import {
  composeMessage,
  previewMailState,
  recoverableImmediateSends,
  settleMailCommand,
  type RecoverableImmediateSend,
} from './domain';
import { OutboxList } from './outbox-list';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function itemWith(state: 'failed' | 'uncertain'): RecoverableImmediateSend {
  const now = '2026-09-14T14:00:00.000Z';
  const pending = composeMessage(
    previewMailState(),
    'cmd_send_1',
    'google_work',
    null,
    'maya@example.com',
    'Launch follow-up',
    'This is the complete original message body.',
    null,
    now,
    { draftKey: 'draft_stable_1', draftRevision: 3 },
  );
  const command = pending.commands.at(-1)!;
  const receipt: MailCommandReceipt = {
    commandId: command.commandId,
    idempotencyKey: command.idempotencyKey,
    accountId: command.accountId,
    state,
    acceptedAt: now,
    providerAcknowledgedAt: null,
    errorCode: state === 'failed' ? 'provider_rejected' : 'outcome_unknown',
  };
  return recoverableImmediateSends(settleMailCommand(pending, command, receipt, now))[0]!;
}

describe('OutboxList', () => {
  it('offers reconcile but never retry for an uncertain delivery', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const reconciled: RecoverableImmediateSend[] = [];
    const retried: RecoverableImmediateSend[] = [];
    const item = itemWith('uncertain');
    try {
      await act(async () => root.render(
        <OutboxList
          accounts={previewMailState().accounts}
          items={[item]}
          onReconcile={candidate => { reconciled.push(candidate); }}
          onRetry={candidate => { retried.push(candidate); }}
        />,
      ));
      expect(container.textContent).toContain('Delivery unknown');
      expect(container.textContent).toContain('Do not resend');
      expect(container.textContent).toContain('This is the complete original message body.');
      expect(container.textContent).not.toContain('Retry with same Message-ID');
      const recheck = Array.from(container.querySelectorAll('button')).find(button =>
        button.textContent?.includes('Recheck original send'));
      await act(async () => recheck?.click());
      expect(reconciled).toEqual([item]);
      expect(retried).toEqual([]);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('offers an explicit identity-preserving retry only for a definite failure', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    const retried: RecoverableImmediateSend[] = [];
    const item = itemWith('failed');
    try {
      await act(async () => root.render(
        <OutboxList
          accounts={previewMailState().accounts}
          items={[item]}
          onReconcile={() => undefined}
          onRetry={candidate => { retried.push(candidate); }}
        />,
      ));
      expect(container.textContent).toContain('Not sent');
      expect(container.textContent).toContain('reuse the original draft and Message-ID');
      const retry = Array.from(container.querySelectorAll('button')).find(button =>
        button.textContent?.includes('Retry with same Message-ID'));
      await act(async () => retry?.click());
      expect(retried).toEqual([item]);
      expect(container.textContent).not.toContain('Recheck original send');
    } finally {
      await act(async () => root.unmount());
    }
  });
});
