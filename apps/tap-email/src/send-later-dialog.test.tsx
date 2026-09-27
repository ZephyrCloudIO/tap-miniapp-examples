/** @rstest-environment jsdom */

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from '@rstest/core';
import { SendLaterDialog, sendLaterChoices } from './send-later-dialog';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe('SendLaterDialog', () => {
  it('offers only future deterministic choices', () => {
    const now = new Date('2026-09-14T19:00:00-04:00');
    expect(sendLaterChoices(now).every(choice => choice.at > now)).toBe(true);
  });

  it('returns an absolute time and cancel-on-reply policy', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const confirmations: unknown[] = [];
    try {
      await act(async () => root.render(
        <SendLaterDialog
          cancelIfReplyDefault
          now={new Date('2026-09-14T10:00:00-04:00')}
          onClose={() => undefined}
          onConfirm={(scheduledFor, cancelIfReply) =>
            confirmations.push({ scheduledFor, cancelIfReply })}
        />,
      ));
      expect(document.body.textContent).toContain('stays saved as a draft');
      const schedule = [...document.body.querySelectorAll<HTMLButtonElement>('button')]
        .find(button => button.textContent?.includes('Schedule send'))!;
      await act(async () => schedule.click());
      expect(confirmations).toEqual([{
        scheduledFor: expect.stringMatching(/^2026-09-15T/u),
        cancelIfReply: true,
      }]);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});

describe('custom delivery time validation', () => {
  it('does not schedule the previous preset after the custom time is cleared', async () => {
    const container = document.createElement('div'); document.body.append(container);
    const root = createRoot(container);
    const confirmations: string[] = [];
    try {
      await act(async () => root.render(<SendLaterDialog cancelIfReplyDefault={false} now={new Date('2026-09-26T12:00:00Z')}
        onClose={() => {}} onConfirm={value => confirmations.push(value)} />));
      const input = document.body.querySelector<HTMLInputElement>('[name="send-later-time"]')!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      const schedule = [...document.body.querySelectorAll('button')].find(button => button.textContent === 'Schedule send')!;
      expect(schedule.disabled).toBe(true);
      await act(async () => schedule.click());
      expect(confirmations).toEqual([]);
      expect(input.getAttribute('aria-invalid')).toBe('true');
    } finally { await act(async () => root.unmount()); container.remove(); }
  });
});
