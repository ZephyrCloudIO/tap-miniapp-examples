/** @rstest-environment jsdom */
import React, { act, useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, rstest as rs } from '@rstest/core';
import { PagedThreadMessages } from './paged-thread-messages';
import type { ThreadPage } from './coordinator-client';
import type { EmailMessage } from './domain';
import * as isolatedFrame from './isolated-message-frame';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const message = (messageId: string): EmailMessage => ({
  messageId, from: { name: messageId, address: `${messageId}@example.com` }, to: [],
  sentAt: '2026-09-24T12:00:00Z', bodyText: `Plain ${messageId}`,
  bodyHtml: `<b>Rich ${messageId}</b><script>window.example = true;</script>`, attachments: [],
});
const page = (ids: string[], nextCursor: string | null): ThreadPage => ({
  messages: ids.map(message), providerRevision: 'h1', nextCursor, complete: nextCursor === null,
});
const defaults = {
  accountId: 'account', threadId: 'thread', providerRevision: 'h1', appTheme: 'dark' as const,
  attachmentExportSupported: false, imagesEnabled: false, trackingPixelsEnabled: false,
  loadAttachment: null, loadRemoteImages: async () => ({}), onKeyDown: () => {},
  saveAttachment: async () => 'saved' as const,
};

describe('paged conversation reader', () => {
  it('shows recoverable errors, retries the same page, and retains loaded content and preferences', async () => {
    const client = { getThreadPage: rs.fn<(account: string, thread: string, cursor: string | null) => Promise<ThreadPage>>()
      .mockResolvedValueOnce(page(['newer', 'latest'], 'older'))
      .mockRejectedValueOnce(new Error('Temporarily unavailable'))
      .mockResolvedValueOnce(page(['oldest', 'newer'], null)) };
    function Reader({ htmlEnabled, scriptsEnabled }: { htmlEnabled: boolean; scriptsEnabled: boolean }) {
      const [messages, setMessages] = useState<readonly EmailMessage[]>([]);
      const onMessages = useCallback((_account: string, _thread: string, next: readonly EmailMessage[]) => setMessages(next), []);
      return <PagedThreadMessages {...defaults} client={client} messages={messages}
        htmlEnabled={htmlEnabled} scriptsEnabled={scriptsEnabled} onMessages={onMessages} />;
    }
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const click = async (label: string) => {
      const button = [...container.querySelectorAll('button')].find(button => button.textContent?.includes(label));
      expect(button).toBeDefined();
      await act(async () => button!.click());
    };
    try {
      await act(async () => root.render(<Reader htmlEnabled={false} scriptsEnabled={false} />));
      expect(container.textContent).toContain('Plain latest');
      expect(container.querySelector('iframe')).toBeNull();
      await click('Load older messages');
      expect(container.querySelector('[role="alert"]')?.textContent).toContain('Temporarily unavailable');
      expect(container.textContent).toContain('Plain latest');
      expect(client.getThreadPage).toHaveBeenCalledTimes(2);
      await click('Retry loading messages');
      expect(client.getThreadPage.mock.calls).toEqual([
        ['account', 'thread', null], ['account', 'thread', 'older'], ['account', 'thread', 'older'],
      ]);
      expect(container.querySelectorAll('.thread-message')).toHaveLength(3);
      expect(container.textContent).toContain('All conversation messages loaded');
      await click('oldest');
      expect(container.textContent).toContain('Plain oldest');
      expect(container.querySelector('iframe')).toBeNull();
      await act(async () => root.render(<Reader htmlEnabled scriptsEnabled={false} />));
      expect(container.querySelectorAll('iframe.rich-message-frame')).toHaveLength(2);
      for (const frame of container.querySelectorAll('iframe')) {
        expect(frame.getAttribute('sandbox')).not.toContain('allow-scripts');
      }
      expect(client.getThreadPage).toHaveBeenCalledTimes(3);
      const renderer = rs.spyOn(isolatedFrame, 'isolatedMessageRenderer')
        .mockResolvedValue('http://localhost/?tap-isolated-document=v1');
      try {
        await act(async () => root.render(<Reader htmlEnabled scriptsEnabled />));
        expect(container.querySelectorAll('iframe[sandbox="allow-scripts"]')).toHaveLength(2);
        await act(async () => root.render(<Reader htmlEnabled={false} scriptsEnabled />));
        expect(container.querySelector('iframe')).toBeNull();
      } finally { renderer.mockRestore(); }
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('shows first-load failure as an error and waits for explicit retry', async () => {
    const client = { getThreadPage: rs.fn<() => Promise<ThreadPage>>()
      .mockRejectedValueOnce(new Error('Connection lost'))
      .mockResolvedValueOnce(page(['latest'], null)) };
    const onMessages = rs.fn();
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
      await act(async () => root.render(<PagedThreadMessages {...defaults} client={client}
        messages={[]} htmlEnabled={false} onMessages={onMessages} />));
      expect(container.querySelector('[role="alert"]')?.textContent).toContain('Connection lost');
      expect(container.textContent).not.toContain('All conversation messages loaded');
      expect(client.getThreadPage).toHaveBeenCalledTimes(1);
      await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
      expect(onMessages).toHaveBeenCalledWith('account', 'thread', [message('latest')], 'h1');
      expect(container.querySelector('[role="alert"]')).toBeNull();
    } finally { await act(async () => root.unmount()); }
  });

  it('ignores an outstanding page from a superseded account/thread', async () => {
    let resolve!: (page: ThreadPage) => void;
    const client = { getThreadPage: rs.fn<() => Promise<ThreadPage>>()
      .mockImplementationOnce(() => new Promise<ThreadPage>(done => { resolve = done; }))
      .mockResolvedValueOnce(page(['other'], null)) };
    const onMessages = rs.fn();
    const root = createRoot(document.createElement('div'));
    try {
      await act(async () => root.render(<PagedThreadMessages {...defaults} client={client} messages={[]} onMessages={onMessages} />));
      await act(async () => root.render(<PagedThreadMessages {...defaults} accountId="other" client={client} messages={[]} onMessages={onMessages} />));
      await act(async () => resolve(page(['stale'], null)));
      expect(onMessages.mock.calls).toEqual([['other', 'thread', [message('other')], 'h1']]);
    } finally { await act(async () => root.unmount()); }
  });
});
