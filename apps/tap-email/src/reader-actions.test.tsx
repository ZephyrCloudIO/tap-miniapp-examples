/** @rstest-environment jsdom */

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from '@rstest/core';
import { ReaderActions, type ReaderAction } from './reader-actions';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe('ReaderActions', () => {
  it('keeps actions compact while exposing labels and shortcuts accessibly', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const actions: ReaderAction[] = [];
    const chloeActions: string[] = [];

    try {
      await act(async () => {
        root.render(
          <ReaderActions
            conversationBusy={false}
            conversationFinished={false}
            onAskChloe={action => chloeActions.push(action)}
            onAction={action => actions.push(action)}
            onCreateTask={() => actions.push('done')}
            starred={false}
            taskBusy={false}
            taskFinished={false}
          />,
        );
      });

      const buttons = [...container.querySelectorAll<HTMLButtonElement>('button')];
      expect(buttons.map(button => button.getAttribute('aria-label'))).toEqual([
        'Done',
        'Remind me',
        'Reply',
        'Ask Chloe',
        'Create task',
        'Discuss in TAP',
        'Star thread',
      ]);
      expect(buttons.map(button => button.getAttribute('aria-keyshortcuts'))).toEqual([
        'E', 'H', 'R', '⌘Enter', null, 'B', 'S',
      ]);
      expect(buttons.every(button => button.textContent === '')).toBe(true);
      expect(container.querySelector('kbd')).toBeNull();

      await act(async () => {
        buttons[0]?.focus();
        await new Promise(resolve => setTimeout(resolve, 300));
      });
      const tooltip = document.body.querySelector<HTMLElement>('[role="tooltip"]');
      expect(tooltip?.textContent).toContain('Done');
      expect(tooltip?.querySelector('kbd')?.textContent).toBe('E');

      await act(async () => buttons[1]?.click());
      expect(actions).toEqual(['remind']);

      await act(async () => buttons[3]?.click());
      const menu = container.querySelector<HTMLElement>('[role="menu"]');
      expect(menu?.getAttribute('aria-label')).toBe('Ask Chloe about this email');
      const menuItems = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
      expect(menuItems.map(item => item.querySelector('span')?.textContent)).toEqual([
        'Summarize',
        'Why important?',
        'Extract commitments',
        'Draft reply',
      ]);

      await act(async () => menuItems[3]?.click());
      expect(chloeActions).toEqual(['draft-reply']);
      expect(container.querySelector('[role="menu"]')).toBeNull();
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('opens the Chloe menu with ArrowDown and returns focus on Escape', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          <ReaderActions
            conversationBusy={false}
            conversationFinished={false}
            onAskChloe={() => undefined}
            onAction={() => undefined}
            onCreateTask={() => undefined}
            starred={false}
            taskBusy={false}
            taskFinished={false}
          />,
        );
      });
      const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Ask Chloe"]')!;
      trigger.focus();
      await act(async () => {
        trigger.dispatchEvent(new KeyboardEvent('keydown', {
          bubbles: true,
          key: 'ArrowDown',
        }));
        await new Promise(resolve => setTimeout(resolve, 0));
      });
      expect(document.activeElement?.getAttribute('role')).toBe('menuitem');

      await act(async () => {
        document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', {
          bubbles: true,
          key: 'Escape',
        }));
      });
      expect(document.activeElement).toBe(trigger);
      expect(container.querySelector('[role="menu"]')).toBeNull();
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('closes the Chloe menu with Escape while its trigger retains focus', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          <ReaderActions
            conversationBusy={false}
            conversationFinished={false}
            onAskChloe={() => undefined}
            onAction={() => undefined}
            onCreateTask={() => undefined}
            starred={false}
            taskBusy={false}
            taskFinished={false}
          />,
        );
      });
      const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Ask Chloe"]')!;
      await act(async () => trigger.click());
      expect(container.querySelector('[role="menu"]')).not.toBeNull();

      await act(async () => {
        trigger.dispatchEvent(new KeyboardEvent('keydown', {
          bubbles: true,
          key: 'Escape',
        }));
      });
      expect(container.querySelector('[role="menu"]')).toBeNull();
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
