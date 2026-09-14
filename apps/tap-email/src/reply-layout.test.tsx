/** @rstest-environment jsdom */

import { describe, expect, it } from '@rstest/core';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { TapEmailApp } from './app';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

async function waitForButton(
  container: HTMLElement,
  label: string,
): Promise<HTMLButtonElement> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    if (button) return button;
    await act(async () => new Promise(resolve => setTimeout(resolve, 10)));
  }
  throw new Error(`Button not found: ${label}`);
}

async function typeInto(textarea: HTMLTextAreaElement, value: string): Promise<void> {
  const valueSetter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value',
  )?.set;
  if (!valueSetter) throw new Error('HTMLTextAreaElement value setter unavailable');
  await act(async () => {
    valueSetter.call(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('reply layout', () => {
  it('opens inline by default and pops beside the email without losing the draft', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    try {
      await act(async () => root.render(<TapEmailApp preview />));
      await act(async () => (await waitForButton(container, 'Reply')).click());

      let composer = container.querySelector<HTMLFormElement>('.reply-composer');
      let textarea = composer?.querySelector<HTMLTextAreaElement>('textarea');
      expect(composer?.dataset.replyPlacement).toBe('inline');
      expect(composer?.closest('.message-body')).not.toBeNull();
      expect(document.body.querySelector('[role="dialog"]')).toBeNull();

      if (!textarea) throw new Error('Inline reply textarea not found');
      await typeInto(textarea, 'Keep this draft while moving it.');
      await act(async () => (await waitForButton(container, 'Pop out reply')).click());

      composer = container.querySelector<HTMLFormElement>('.reply-composer');
      textarea = composer?.querySelector<HTMLTextAreaElement>('textarea');
      expect(composer?.dataset.replyPlacement).toBe('sidecar');
      expect(composer?.closest('aside.reply-sidecar')).not.toBeNull();
      expect(textarea?.value).toBe('Keep this draft while moving it.');
      expect(container.querySelector('.mail-shell')?.classList.contains('is-thread-list-collapsed')).toBe(true);

      await act(async () => (await waitForButton(container, 'Return reply inline')).click());
      composer = container.querySelector<HTMLFormElement>('.reply-composer');
      expect(composer?.dataset.replyPlacement).toBe('inline');
      expect(composer?.querySelector<HTMLTextAreaElement>('textarea')?.value)
        .toBe('Keep this draft while moving it.');
      expect(container.querySelector('.mail-shell')?.classList.contains('is-thread-list-collapsed')).toBe(false);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('keeps New Message in its standalone compose dialog', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    try {
      await act(async () => root.render(<TapEmailApp preview />));
      const compose = [...container.querySelectorAll<HTMLButtonElement>('button')]
        .find(button => button.textContent?.includes('Compose'));
      if (!compose) throw new Error('Compose button not found');
      await act(async () => compose.click());
      expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('New Message');
      expect(container.querySelector('.reply-composer')).toBeNull();
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
