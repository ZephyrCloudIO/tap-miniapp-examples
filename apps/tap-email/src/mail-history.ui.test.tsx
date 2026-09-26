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
    await store.save({ ...source, threads: [...threads, otherThread] });
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
      const older = [...container.querySelectorAll<HTMLButtonElement>('nav[aria-label="Mail history pages"] button')]
        .find(button => button.textContent === 'Older')!;
      await eventually(() => expect(older.disabled).toBe(false));
      await eventually(() => expect(container.querySelector('.zero-card')?.textContent).toContain('all selected accounts synced'));
      const account = [...container.querySelectorAll<HTMLButtonElement>('.account-switcher button')]
        .find(button => button.textContent?.includes(otherAccount.displayName))!;
      await act(async () => account.click());
      expect(container.querySelector('.thread-list')?.textContent).toContain('Loading mail');
      expect(container.querySelector('.thread-list')?.textContent).not.toContain('Inbox is clear');
      expect(older.disabled).toBe(true);
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

  it('replaces the displayed window, opens older mail, and searches beyond it', async () => {
    const fixture = sqliteStoreFixture();
    const store = new localStore.ProfileSqliteMailStore(fixture.profile);
    const source = previewMailState();
    const threads = Array.from({ length: 250 }, (_, index) => ({ ...source.threads[0]!,
      threadId: `history_${index}`, subject: `Historical item ${String(index).padStart(3, '0')}`,
      receivedAt: new Date(Date.UTC(2026, 0, 1) - index * 60_000).toISOString(),
      messages: [{ ...source.threads[0]!.messages[0]!, bodyText: `Message ${index}` }],
    }));
    await store.save({ ...source, threads, selectedThreadKey: emailThreadKey(threads[0]!) });
    const mock = rs.spyOn(localStore, 'createLocalMailStore').mockReturnValue(store);
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(<TapEmailApp preview />));
      await eventually(() => expect(container.querySelectorAll('.mail-row')).toHaveLength(100));
      const older = [...container.querySelectorAll<HTMLButtonElement>('nav[aria-label="Mail history pages"] button')]
        .find(button => button.textContent === 'Older')!;
      await eventually(() => expect(older.disabled).toBe(false));
      await act(async () => older.click());
      await eventually(() => {
        expect(container.querySelectorAll('.mail-row')).toHaveLength(100);
        expect(container.querySelector('.mail-row')?.textContent).toContain('Historical item 100');
      });
      await act(async () => (container.querySelector('.mail-row') as HTMLButtonElement).click());
      await eventually(() => expect(container.querySelector('.message-header h2')?.textContent).toBe('Historical item 100'));
      const search = container.querySelector<HTMLInputElement>('input[aria-label="Search mail"]')!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'Historical item 249');
        search.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await eventually(() => {
        expect(container.querySelectorAll('.mail-row')).toHaveLength(1);
        expect(container.querySelector('.mail-row')?.textContent).toContain('Historical item 249');
      });
      expect(fixture.sqlite.prepare('SELECT COUNT(*) AS n FROM local_mail_threads').get()?.n).toBe(250);
    } finally {
      await act(async () => root.unmount());
      mock.mockRestore();
      container.remove();
    }
  });
});
