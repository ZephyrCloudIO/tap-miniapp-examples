/** @rstest-environment jsdom */

import { describe, expect, it } from '@rstest/core';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { TapEmailApp } from './app';
import { THREAD_LIST_PANE_ID } from './thread-list-toggle';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

async function waitForButton(
  container: HTMLElement,
  label: string,
): Promise<HTMLButtonElement> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const button = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find(candidate => candidate.getAttribute('aria-label') === label);
    if (button) return button;
    await act(async () => new Promise(resolve => setTimeout(resolve, 10)));
  }
  throw new Error(`Button not found: ${label}`);
}

describe('thread-list collapse', () => {
  it('preserves the selected reader while hiding and restoring the email list', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    try {
      await act(async () => root.render(<TapEmailApp preview />));
      const hideButton = await waitForButton(container, 'Collapse email list');
      const shell = container.querySelector<HTMLElement>('.mail-shell');
      const listPane = document.getElementById(THREAD_LIST_PANE_ID) as HTMLElement;
      const reader = container.querySelector<HTMLElement>('.message-pane');
      const messageBody = container.querySelector<HTMLElement>('.message-body');
      const subject = container.querySelector<HTMLElement>('.message-header h2');

      expect(hideButton.getAttribute('aria-expanded')).toBe('true');
      expect(listPane.hidden).toBe(false);
      expect(subject?.textContent).toBe('Launch review needs your call');
      if (messageBody) messageBody.scrollTop = 275;

      await act(async () => hideButton.click());
      const showButton = await waitForButton(container, 'Expand email list');
      expect(showButton).toBe(hideButton);
      expect(showButton.getAttribute('aria-expanded')).toBe('false');
      expect(listPane.hidden).toBe(true);
      expect(shell?.classList.contains('is-thread-list-collapsed')).toBe(true);
      expect(container.querySelector('.message-pane')).toBe(reader);
      expect(container.querySelector('.message-body')).toBe(messageBody);
      expect(messageBody?.scrollTop).toBe(275);
      expect(subject?.textContent).toBe('Launch review needs your call');

      await act(async () => showButton.click());
      expect((await waitForButton(container, 'Collapse email list'))).toBe(hideButton);
      expect(listPane.hidden).toBe(false);
      expect(shell?.classList.contains('is-thread-list-collapsed')).toBe(false);
      expect(container.querySelector('.message-pane')).toBe(reader);
      expect(messageBody?.scrollTop).toBe(275);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
