/** @rstest-environment jsdom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, rs } from '@rstest/core';
import * as localStore from './local-store';
import { sqliteStoreFixture } from './sqlite-store-fixture';
import { previewMailState, emailThreadKey } from './domain';
import { TapEmailApp } from './app';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function eventually(assertion: () => void) {
  for (let attempt = 0; attempt < 60; attempt++) {
    try { assertion(); return; } catch (error) { if (attempt === 59) throw error; }
    await act(async () => new Promise(resolve => setTimeout(resolve, 10)));
  }
}

describe('disk-backed mail history UI', () => {
  afterEach(() => { window.history.replaceState(null, '', '/'); });
  it('does not claim an empty inbox or reuse pagination while an account query is pending', async () => {
    const fixture = sqliteStoreFixture();
    const store = new localStore.ProfileSqliteMailStore(fixture.profile);
    const source = previewMailState();
    const otherAccount = source.accounts.find(account => account.accountId !== source.threads[0]!.accountId)!;
    const threads = Array.from({ length: 110 }, (_, index) => ({ ...source.threads[0]!,
      threadId: `recent_${index}`, receivedAt: new Date(Date.UTC(2026, 0, 1) - index * 60_000).toISOString(),
    }));
    const otherThread = { ...threads[0]!, accountId: otherAccount.accountId,
      threadId: 'older_other_account', subject: 'Mail in the selected account', receivedAt: '2025-01-01T00:00:00.000Z' };
    await store.save({ ...source, accounts: source.accounts.map(account => ({ ...account, coverage: { ...account.coverage, state: 'current' as const, unresolvedFailures: 0 } })), threads: [...threads, otherThread] });
    const mock = rs.spyOn(localStore, 'createLocalMailStore').mockReturnValue(store);
    const queryThreads = store.queryThreads.bind(store);
    const summarize = store.summarize.bind(store);
    rs.spyOn(store, 'summarize').mockImplementation(async accountId => ({
      ...await summarize(accountId), coverageComplete: true,
    }));
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    rs.spyOn(store, 'queryThreads').mockImplementation(async options => {
      if (options.accountId === otherAccount.accountId) await pending;
      return queryThreads(options);
    });
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(<TapEmailApp preview />));
      await eventually(() => expect(container.querySelectorAll('.mail-row')).toHaveLength(100));
      expect(container.querySelector('nav[aria-label="Mail history pages"]')).toBeNull();
      await eventually(() => expect(container.querySelector('.zero-card')?.textContent).toContain('all selected accounts synced'));
      expect(container.querySelector('.split-sidebar button[aria-label="Inbox, 111 threads"] .nav-count')?.textContent).toBe('111');
      const account = [...container.querySelectorAll<HTMLButtonElement>('.account-switcher button')]
        .find(button => button.textContent?.includes(otherAccount.displayName))!;
      await act(async () => account.click());
      expect(container.querySelector('.thread-list')?.textContent).toContain('Loading mail');
      expect(container.querySelector('.thread-list')?.textContent).not.toContain('Inbox is clear');
      expect(container.querySelector('.mail-history-status')?.textContent).toContain('Loading more mail');
      await act(async () => release());
      await eventually(() => {
        expect(container.querySelectorAll('.mail-row')).toHaveLength(1);
        expect(container.querySelector('.mail-row')?.textContent).toContain(otherThread.subject);
      });
    } finally {
      release();
      await act(async () => root.unmount());
      mock.mockRestore();
      container.remove();
    }
  });

  it('appends older batches without losing newer rows, opens older mail, and searches beyond it', async () => {
    const fixture = sqliteStoreFixture();
    const store = new localStore.ProfileSqliteMailStore(fixture.profile);
    const source = previewMailState();
    const threads = Array.from({ length: 250 }, (_, index) => ({ ...source.threads[0]!,
      threadId: `history_${index}`, subject: `Historical item ${String(index).padStart(3, '0')}`,
      receivedAt: new Date(Date.UTC(2026, 0, 1) - index * 60_000).toISOString(),
      messages: [{ ...source.threads[0]!.messages[0]!, bodyText: `Message ${index}` }],
    }));
    await store.save({ ...source, threads, selectedThreadKey: emailThreadKey(threads[0]!) });
    const queryThreads = store.queryThreads.bind(store);
    let failOlder = true;
    rs.spyOn(store, 'queryThreads').mockImplementation(async options => {
      if (options.after && failOlder) { failOlder = false; throw new Error('Transient local history failure'); }
      return queryThreads(options);
    });
    const mock = rs.spyOn(localStore, 'createLocalMailStore').mockReturnValue(store);
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(<TapEmailApp preview />));
      await eventually(() => expect(container.querySelectorAll('.mail-row')).toHaveLength(100));
      const scroller = container.querySelector<HTMLElement>('.thread-list')!;
      Object.defineProperty(scroller, 'clientHeight', { value: 500, configurable: true });
      Object.defineProperty(scroller, 'scrollHeight', { get: () => container.querySelectorAll('.mail-row').length * 100 + 500, configurable: true });
      await eventually(() => expect(container.querySelector('.mail-history-status')?.textContent).not.toContain('Loading'));
      await act(async () => { scroller.scrollTop = 10500; scroller.dispatchEvent(new Event('scroll')); });
      await eventually(() => {
        expect(container.querySelectorAll('.mail-row')).toHaveLength(100);
        expect(container.querySelector('.mail-history-status')?.textContent).toContain('Retry loading mail');
      });
      await act(async () => container.querySelector<HTMLButtonElement>('.mail-history-status button')!.click());
      await eventually(() => {
        expect(container.querySelectorAll('.mail-row')).toHaveLength(200);
        expect(container.querySelector('.mail-row')?.textContent).toContain('Historical item 000');
      });
      await act(async () => (container.querySelectorAll('.mail-row')[100] as HTMLButtonElement).click());
      await eventually(() => expect(container.querySelector('.message-header h2')?.textContent).toBe('Historical item 100'));
      Object.defineProperty(scroller, 'scrollHeight', { value: 21000, configurable: true });
      await act(async () => { scroller.scrollTop = 20500; scroller.dispatchEvent(new Event('scroll')); });
      await eventually(() => expect(container.querySelectorAll('.mail-row')).toHaveLength(250));
      expect(container.querySelector('.mail-history-status')?.textContent).toContain('End of available mail');
      const search = container.querySelector<HTMLInputElement>('input[aria-label="Search mail"]')!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'Historical item 249');
        search.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await eventually(() => {
        expect(container.querySelectorAll('.mail-row')).toHaveLength(1);
        expect(container.querySelector('.mail-row')?.textContent).toContain('Historical item 249');
      });
      await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true })));
      const searchDialog = document.querySelector<HTMLInputElement>('input[name="mail-search-dialog"]')!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(searchDialog, 'Historical item 225');
        searchDialog.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await eventually(() => expect(document.querySelector('.search-dialog-result')?.textContent).toContain('Historical item 225'));
      await act(async () => searchDialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
      await eventually(() => expect(container.querySelector('.message-header h2')?.textContent).toBe('Historical item 225'));
      expect(document.querySelector('input[name="mail-search-dialog"]')).toBeNull();
      expect(fixture.sqlite.prepare('SELECT COUNT(*) AS n FROM local_mail_threads').get()?.n).toBe(250);
    } finally {
      await act(async () => root.unmount());
      mock.mockRestore();
      container.remove();
    }
  });
});
