/** @rstest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from '@rstest/core';
import { previewMailState } from './domain';
import { ReminderDialog } from './reminder-dialog';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

interface MountedDialog {
  readonly container: HTMLDivElement;
  readonly dialog: HTMLElement;
  readonly input: HTMLInputElement;
  readonly root: Root;
}

async function mountDialog(
  onConfirm: (input: string) => void = () => undefined,
): Promise<MountedDialog> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <ReminderDialog
        onClose={() => undefined}
        onConfirm={onConfirm}
        thread={previewMailState().threads[0]!}
      />,
    );
  });
  const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
  const input = dialog?.querySelector<HTMLInputElement>('input[name="reminder-time"]');
  if (!dialog || !input) throw new Error('Reminder dialog did not mount');
  return { container, dialog, input, root };
}

async function unmountDialog({ container, root }: MountedDialog): Promise<void> {
  await act(async () => root.unmount());
  container.remove();
}

async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
  const valueSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set;
  if (!valueSetter) throw new Error('HTMLInputElement value setter unavailable');
  await act(async () => {
    valueSetter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function pressKey(input: HTMLInputElement, key: string): Promise<void> {
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key,
    }));
  });
}

function optionButtons(dialog: ParentNode): HTMLButtonElement[] {
  return [...dialog.querySelectorAll<HTMLButtonElement>('button[role="option"]')];
}

describe('ReminderDialog', () => {
  it('uses an empty compact typeahead instead of a pre-filled reminder value', async () => {
    const mounted = await mountDialog();
    try {
      expect(mounted.input.value).toBe('');
      expect(mounted.input.placeholder).toContain('tomorrow');
      expect(mounted.input.classList.contains('reminder-input')).toBe(true);
      expect(mounted.input.getAttribute('role')).toBe('combobox');
    } finally {
      await unmountDialog(mounted);
    }
  });

  it('removes the condition controls, footer hint, and redundant submit button', async () => {
    const mounted = await mountDialog();
    try {
      expect(mounted.dialog.textContent?.toLowerCase()).not.toContain('if no reply');
      expect(mounted.dialog.textContent?.toLowerCase()).not.toContain('set reminder');
      expect(optionButtons(mounted.dialog)).toHaveLength(4);
      expect([...mounted.dialog.querySelectorAll('button')].some(button =>
        button.textContent?.trim().toLowerCase() === 'remind me'
      )).toBe(false);
    } finally {
      await unmountDialog(mounted);
    }
  });

  it('replaces suggestions in response to each typed phrase', async () => {
    const mounted = await mountDialog();
    try {
      await typeInto(mounted.input, 'in');
      expect(optionButtons(mounted.dialog).map(button => button.textContent)).toEqual([
        expect.stringContaining('In 1 minute'),
        expect.stringContaining('In 1 hour'),
        expect.stringContaining('In 1 day'),
        expect.stringContaining('In 1 week'),
      ]);

      await typeInto(mounted.input, 'next');
      expect(optionButtons(mounted.dialog).map(button => button.textContent)).toEqual([
        expect.stringContaining('Next week'),
        expect.stringContaining('Next weekend'),
      ]);
    } finally {
      await unmountDialog(mounted);
    }
  });

  it('moves from the input into suggestions with ArrowDown at any caret position', async () => {
    const confirmed: string[] = [];
    const mounted = await mountDialog(input => confirmed.push(input));
    const originalRequestAnimationFrame = window.requestAnimationFrame;
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    window.requestAnimationFrame = callback => {
      callback(0);
      return 1;
    };
    HTMLElement.prototype.scrollIntoView = () => undefined;

    try {
      await typeInto(mounted.input, 'in');
      mounted.input.setSelectionRange(1, 1);
      await pressKey(mounted.input, 'ArrowDown');
      await pressKey(mounted.input, 'ArrowDown');

      const activeId = mounted.input.getAttribute('aria-activedescendant');
      const activeOption = activeId ? document.getElementById(activeId) : null;
      expect(activeOption?.textContent).toContain('In 1 hour');
      expect(activeOption?.getAttribute('aria-selected')).toBe('true');

      await pressKey(mounted.input, 'Enter');
      expect(confirmed).toEqual(['in 1 hour']);
    } finally {
      window.requestAnimationFrame = originalRequestAnimationFrame;
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
      await unmountDialog(mounted);
    }
  });
});
