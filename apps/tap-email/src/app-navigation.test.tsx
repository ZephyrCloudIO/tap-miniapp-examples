/** @rstest-environment jsdom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, rs } from '@rstest/core';
import { TapEmailApp } from './app';
import * as localStore from './local-store';
import { previewMailState, type EmailThread } from './domain';
import type { MailWindow, MailWindowQuery } from './bounded-mail-replica';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('progressive mailbox navigation', () => {
  it('renders the first batch, keeps rows during refresh, restores a cached view before disk responds, and ignores stale reads', async () => {
    const seed = previewMailState();
    const pending: { query: MailWindowQuery; resolve: (page: MailWindow) => void }[] = [];
    const store: localStore.LocalMailStore = {
      ...new localStore.PreviewFixtureMailStore(), capability: 'preview-fixture',
      load: async () => seed,
      save: async () => {},
      queryThreads: query => new Promise(resolve => pending.push({ query, resolve })),
      loadMailboxPageProgress: async () => null, saveMailboxPageProgress: async () => {}, clearMailboxPageProgress: async () => {},
      loadRemoteImages: async () => ({}), saveRemoteImages: async () => {}, loadAttachment: async () => null, saveAttachment: async () => {},
      inspectStorage: async () => { throw new Error('unused'); }, wipeAccount: async () => { throw new Error('unused'); },
      wipeDevice: async () => { throw new Error('unused'); }, close: async () => {},
    };
    const factory = rs.spyOn(localStore, 'createLocalMailStore').mockReturnValue(store);
    const scroll = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = () => {};
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const rows = (prefix: string, count: number, sent = false): EmailThread[] => Array.from({ length: count }, (_, index) => ({
      ...seed.threads[0]!, threadId: `${prefix}_${index}`, subject: `${prefix} ${index}`, providerResources: [sent ? 'sent' : 'inbox'],
    }));
    const clickView = async (label: string) => {
      const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.getAttribute('aria-label') === label || button.getAttribute('aria-label')?.startsWith(`${label},`));
      expect(button).toBeDefined();
      await act(async () => button!.click());
    };
    try {
      await act(async () => root.render(<TapEmailApp preview />));
      const inbox = rows('Inbox row', 40);
      expect(pending.length).toBeGreaterThan(0);
      expect(container.querySelectorAll('[role="option"]')).toHaveLength(5);
      expect(container.textContent).not.toContain('Loading mail');
      await act(async () => pending.at(-1)!.query.onProgress!(inbox.slice(0, 20)));
      expect(container.querySelectorAll('[role="option"]')).toHaveLength(25);
      expect(container.textContent).not.toContain('Loading mail');
      await act(async () => pending.at(-1)!.resolve({ threads: inbox, next: null }));
      expect(container.querySelectorAll('[role="option"]')).toHaveLength(40);
      await clickView('Sent');
      const sentRead = pending.at(-1)!;
      expect(container.textContent).toContain('Loading mail');
      await clickView('Inbox');
      expect(container.querySelectorAll('[role="option"]')).toHaveLength(40);
      expect(container.textContent).not.toContain('Loading mail');
      const refresh = pending.at(-1)!;
      await act(async () => refresh.query.onProgress!(inbox.slice(0, 20)));
      expect(container.querySelectorAll('[role="option"]')).toHaveLength(40);
      await act(async () => sentRead.query.onProgress!(rows('Late Sent', 20, true)));
      expect(container.textContent).not.toContain('Late Sent');
      await act(async () => sentRead.resolve({ threads: rows('Late Sent', 20, true), next: null }));
      expect(container.querySelectorAll('[role="option"]')).toHaveLength(40);
    } finally {
      await act(async () => root.unmount());
      for (const read of pending) read.resolve({ threads: [], next: null });
      factory.mockRestore(); Element.prototype.scrollIntoView = scroll; container.remove();
    }
  });
});
