/** @rstest-environment jsdom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, rs } from '@rstest/core';
import { TapEmailApp } from './app';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { rs.unstubAllGlobals(); localStorage.clear(); window.history.replaceState(null, '', '/'); });

it('keeps phone search collapsed, switches folders and accounts, and clears search on dismissal', async () => {
  rs.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  const click = async (button: HTMLElement) => { await act(async () => { button.click(); }); };
  const button = (label: string) => [...(document.querySelector('[role="dialog"]') ?? container).querySelectorAll<HTMLButtonElement>('button')].find(item => item.getAttribute('aria-label') === label || item.textContent === label)!;
  try {
    await act(async () => root.render(<TapEmailApp preview nativeHeader />));
    expect(container.querySelector('.mobile-account-toolbar')).toBeNull();
    expect(container.querySelector('input[name="mail-search"]')).toBeNull();
    expect(container.querySelector('.compact-mail-view-select')).toBeNull();
    const navigate = () => container.querySelector<HTMLButtonElement>('.mobile-mail-location')!;
    await click(navigate());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Mailboxes');
    expect(document.activeElement).toBe(button('Close mailboxes'));
    expect(button('Inbox').getAttribute('aria-current')).toBe('page');
    await click(button('Spam'));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(navigate().textContent).toContain('Spam');
    expect(container.querySelector('.zero-state')?.textContent).toContain('Spam');
    await click(navigate());
    expect(button('Spam').getAttribute('aria-current')).toBe('page');
    const account = document.querySelector<HTMLButtonElement>('[aria-label="Email accounts"] button:nth-of-type(2)')!;
    const accountName = account.textContent!;
    await click(account);
    expect(navigate().textContent).toContain(accountName);
    await click(navigate()); await click(button('Inbox'));
    await click(button('Search mail'));
    const input = container.querySelector<HTMLInputElement>('input[name="mail-search"]')!;
    expect(document.activeElement).toBe(input);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'no match in this inbox');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(button('Search by meaning using the local semantic index').disabled).toBe(false);
    await click(button('Close search'));
    expect(container.querySelector('input[name="mail-search"]')).toBeNull();
    await click(button('Search mail'));
    expect(container.querySelector<HTMLInputElement>('input[name="mail-search"]')!.value).toBe('');
    await act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(container.querySelector('input[name="mail-search"]')).toBeNull();
  } finally { await act(async () => root.unmount()); container.remove(); }
});
