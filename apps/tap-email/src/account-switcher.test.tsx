/** @rstest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from '@rstest/core';
import {
  AccountSwitcher,
  type AccountSwitcherProps,
} from './account-switcher';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const accounts: AccountSwitcherProps['accounts'] = [
  { accountId: 'account_1', accent: '#56b4a2', displayName: 'Work' },
  { accountId: 'account_2', accent: '#9b7bd1', displayName: 'Personal' },
];

interface Harness {
  readonly container: HTMLDivElement;
  readonly unmount: () => Promise<void>;
}

async function renderSwitcher(
  overrides: Partial<AccountSwitcherProps> = {},
): Promise<Harness> {
  const container = document.createElement('div');
  document.body.append(container);
  const root: Root = createRoot(container);

  await act(async () => {
    root.render(
      <AccountSwitcher
        accounts={accounts}
        onSelect={() => undefined}
        selectedAccountId="all"
        {...overrides}
      />,
    );
  });

  return {
    container,
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

describe('AccountSwitcher', () => {
  it('keeps shortcut hints out of button names and selects the requested account', async () => {
    const selected: string[] = [];
    const harness = await renderSwitcher({ onSelect: accountId => selected.push(accountId) });

    try {
      const buttons = [...harness.container.querySelectorAll('button')];
      const shortcuts = [...harness.container.querySelectorAll('.account-shortcut')];

      expect(buttons).toHaveLength(3);
      expect(shortcuts.map(shortcut => shortcut.textContent)).toEqual(['G A', '⌃ 1', '⌃ 2']);
      expect(shortcuts.every(shortcut => shortcut.getAttribute('aria-hidden') === 'true')).toBe(true);

      await act(async () => buttons[2]!.click());
      expect(selected).toEqual(['account_2']);
    } finally {
      await harness.unmount();
    }
  });

  it('does not reveal every hint when Command is held', async () => {
    const harness = await renderSwitcher();

    try {
      const switcher = harness.container.querySelector('.account-switcher')!;
      expect(switcher.classList.contains('is-command-held')).toBe(false);

      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', {
          bubbles: true,
          key: 'Meta',
          metaKey: true,
        }));
      });
      expect(switcher.classList.contains('is-command-held')).toBe(false);
    } finally {
      await harness.unmount();
    }
  });
});
