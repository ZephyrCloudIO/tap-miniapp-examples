/** @rstest-environment jsdom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, rs } from '@rstest/core';
import { MailSearchDialog } from './mail-search-dialog';
import { TapEmailApp } from './app';
import { previewMailState, type MailState } from './domain';
import { PreviewFixtureMailStore } from './local-store';
import type { MailWindow, MailWindowQuery } from './bounded-mail-replica';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function key(target: EventTarget, value: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: value, ...options });
  await act(async () => { target.dispatchEvent(event); });
  return event;
}
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function mount(element: React.ReactNode) {
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(element));
  return { container, async dispose() { await act(async () => root.unmount()); container.remove(); } };
}
const searchInput = () => document.querySelector<HTMLInputElement>('input[name="mail-search-dialog"]')!;
const options = () => [...document.querySelectorAll<HTMLButtonElement>('.search-dialog-result')];

describe('keyboard mail search', () => {
  afterEach(() => { window.history.replaceState(null, '', '/'); localStorage.clear(); });

  it('opens with slash from a mail row, focuses typing, navigates, and opens with Enter', async () => {
    const app = await mount(<TapEmailApp preview />);
    try {
      const row = app.container.querySelector<HTMLButtonElement>('.mail-row')!;
      row.focus();
      expect((await key(row, '/')).defaultPrevented).toBe(true);
      const input = searchInput();
      expect(document.activeElement).toBe(input);
      expect(input.value).toBe('');
      const before = app.container.querySelector('.message-header h2')?.textContent;
      await type(input, 'review');
      expect(options()).toHaveLength(3);
      expect(app.container.querySelector('.message-header h2')?.textContent).toBe(before);
      await key(input, 'ArrowDown');
      const chosen = options()[1]!;
      expect(input.getAttribute('aria-activedescendant')).toBe(chosen.id);
      const subject = chosen.querySelector('.search-result-subject')!.textContent;
      await key(input, 'Enter', { isComposing: true });
      expect(searchInput()).not.toBeNull();
      await key(input, 'Enter');
      expect(searchInput()).toBeNull();
      expect(app.container.querySelector('.message-header h2')?.textContent).toBe(subject);
      await act(async () => new Promise(resolve => setTimeout(resolve, 10)));
      expect(document.activeElement).toBe(app.container.querySelector('.tap-email'));
    } finally { await app.dispose(); }
  });

  it('cancels without changing the reader, restores focus, and does not steal slash while typing', async () => {
    const app = await mount(<TapEmailApp preview />);
    try {
      const row = app.container.querySelector<HTMLButtonElement>('.mail-row')!;
      row.focus();
      const before = app.container.querySelector('.message-header h2')?.textContent;
      await key(row, '/'); await type(searchInput(), 'Invoice'); await key(searchInput(), 'Escape');
      expect(searchInput()).toBeNull();
      expect(app.container.querySelector('.message-header h2')?.textContent).toBe(before);
      await act(async () => new Promise(resolve => setTimeout(resolve, 10)));
      expect(document.activeElement).toBe(row);
      const inline = app.container.querySelector<HTMLInputElement>('input[name="mail-search"]')!;
      inline.focus();
      expect((await key(inline, '/')).defaultPrevented).toBe(false);
      expect(searchInput()).toBeNull();
      await key(inline, 'Enter');
      expect(document.activeElement).toBe(searchInput());
    } finally { await app.dispose(); }
  });

  it('accepts slash forwarded from the focused HTML email body', async () => {
    const app = await mount(<TapEmailApp preview />);
    try {
      const frame = app.container.querySelector<HTMLIFrameElement>('.rich-message-frame')!;
      expect(frame).not.toBeNull();
      await act(async () => frame.dispatchEvent(new Event('load')));
      await key(frame.contentDocument!, '/');
      expect(document.activeElement).toBe(searchInput());
      expect(searchInput()).not.toBeNull();
    } finally { await app.dispose(); }
  });

  it('keeps queries scoped, searches all folders, and ignores a late result for an older query', async () => {
    const seed = previewMailState();
    const state: MailState = { ...seed, selectedAccountId: 'google_work' };
    const pending: { query: MailWindowQuery; resolve: (page: MailWindow) => void }[] = [];
    const store = Object.assign(new PreviewFixtureMailStore(), {
      queryThreads: (query: MailWindowQuery) => new Promise<MailWindow>(resolve => pending.push({ query, resolve })),
    });
    const select = rs.fn();
    const app = await mount(<MailSearchDialog state={state} store={store} initialQuery="" onClose={() => {}} onSelect={select} onRestoreFocus={() => {}} />);
    try {
      expect(options().length).toBeGreaterThan(0);
      await type(searchInput(), 'older');
      await act(async () => new Promise(resolve => setTimeout(resolve, 140)));
      const old = pending.at(-1)!;
      expect(old.query.accountId).toBe('google_work');
      expect(old.query.split).toBeUndefined();
      await type(searchInput(), 'Invoice');
      expect(options()).toHaveLength(0); // Personal mail must not leak into TAP account results.
      expect(old.query.signal?.aborted).toBe(true);
      await act(async () => old.resolve({ threads: [{ ...seed.threads[0]!, subject: 'Stale result' }], next: null }));
      expect(options()).toHaveLength(0);
      await key(searchInput(), 'Enter');
      expect(select).not.toHaveBeenCalled();
      const account = document.querySelector<HTMLSelectElement>('[aria-label="Search account"]')!;
      await act(async () => { account.value = 'all'; account.dispatchEvent(new Event('change', { bubbles: true })); });
      expect(options()).toHaveLength(1);
      await key(searchInput(), 'Enter');
      expect(select.mock.calls[0]![0].subject).toBe('Invoice 4418 paid');
    } finally { await app.dispose(); }
  });
});
