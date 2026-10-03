/** @rstest-environment jsdom */
import React, { act, useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, rstest as rs } from '@rstest/core';
import { ConversationQueryCache } from './conversation-query-cache';
import { PagedThreadMessages } from './paged-thread-messages';
import type { ThreadPage } from './coordinator-client';
import { previewMailState, type DownloadedThreadPage, type EmailMessage, type EmailThread } from './domain';
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
  const marker = (nextCursor: string | null = null): DownloadedThreadPage => ({
    providerRevision: 'h1', nextCursor, complete: nextCursor === null, windowed: false,
    seenCursors: nextCursor ? [nextCursor] : [],
  });

  it('publishes a warmed snapshot only when activated without reloading its iframe or bodies', async () => {
    const cache = new ConversationQueryCache();
    cache.remember('account', 'thread', { messages: [message('warm')], downloadedPage: marker() });
    const client = { getThreadPage: rs.fn() };
    const loadCachedThread = rs.fn();
    const published = rs.fn();
    const container = document.createElement('div'); document.body.append(container);
    const root = createRoot(container);
    const render = (active: boolean) => <PagedThreadMessages {...defaults} active={active}
      client={client} cache={cache} loadCachedThread={loadCachedThread} messages={[]}
      scriptsEnabled={false} onMessages={published} />;
    try {
      await act(async () => root.render(render(false)));
      const frame = container.querySelector('iframe');
      expect(frame?.getAttribute('srcdoc')).toContain('Rich warm');
      expect(published).not.toHaveBeenCalled();
      await act(async () => root.render(render(true)));
      expect(container.querySelector('iframe')).toBe(frame);
      expect(published).toHaveBeenCalledTimes(1);
      expect(published).toHaveBeenCalledWith('account', 'thread', cache.snapshot('account', 'thread', 'h1')!.messages, 'h1', marker());
      expect(client.getThreadPage).not.toHaveBeenCalled();
      expect(loadCachedThread).not.toHaveBeenCalled();
    } finally { await act(async () => root.unmount()); cache.clear(); container.remove(); }
  });

  it('loads older pages for the first unread, even if mark-read clears the thread flag before they arrive', async () => {
    let finish!: (value: ThreadPage) => void;
    const client = { getThreadPage: rs.fn((_account: string, _thread: string, cursor?: string | null) => cursor
      ? new Promise<ThreadPage>(resolve => { finish = resolve; })
      : Promise.resolve(page(['latest'], 'older-cursor'))) };
    const container = document.createElement('div'); container.className = 'message-body'; document.body.append(container);
    const root = createRoot(container);
    const render = (unread: boolean) => <PagedThreadMessages {...defaults} client={client} onMessages={() => {}}
      messages={[]} htmlEnabled={false} unread={unread} firstUnreadMessageId={unread ? 'oldest' : null} />;
    try {
      await act(async () => root.render(render(true)));
      expect(client.getThreadPage.mock.calls).toEqual([['account', 'thread', null], ['account', 'thread', 'older-cursor']]);
      await act(async () => root.render(render(false)));
      await act(async () => finish(page(['oldest', 'middle'], null)));
      const cards = [...container.querySelectorAll('.thread-message')];
      expect(cards.map(card => card.getAttribute('aria-label'))).toEqual(['Message from oldest', 'Message from middle', 'Message from latest']);
      expect(cards[0]?.classList.contains('is-expanded')).toBe(true);
      expect(cards[1]?.classList.contains('is-collapsed')).toBe(true);
      expect(client.getThreadPage).toHaveBeenCalledTimes(2);
    } finally { await act(async () => root.unmount()); container.remove(); }
  });

  it('keeps one pending read when only the publication callback changes', async () => {
    let resolve!: (value: ThreadPage) => void;
    const client = { getThreadPage: rs.fn(() => new Promise<ThreadPage>(done => { resolve = done; })) };
    const first = rs.fn();
    const latest = rs.fn();
    const root = createRoot(document.createElement('div'));
    try {
      await act(async () => root.render(<PagedThreadMessages {...defaults} client={client} messages={[]} onMessages={first} />));
      await act(async () => root.render(<PagedThreadMessages {...defaults} client={client} messages={[]} onMessages={latest} />));
      expect(client.getThreadPage).toHaveBeenCalledTimes(1);
      await act(async () => resolve(page(['latest'], null)));
      expect(first).not.toHaveBeenCalled();
      expect(latest).toHaveBeenCalledTimes(1);
    } finally { await act(async () => root.unmount()); }
  });

  it('shares a pending SQLite lookup through Strict Mode effect replay', async () => {
    const cache = new ConversationQueryCache();
    let resolve!: (value: EmailThread | null) => void;
    const loadCachedThread = rs.fn(() => new Promise<EmailThread | null>(done => { resolve = done; }));
    const client = { getThreadPage: rs.fn().mockResolvedValue(page(['latest'], null)) };
    const root = createRoot(document.createElement('div'));
    try {
      await act(async () => root.render(<React.StrictMode><PagedThreadMessages {...defaults}
        client={client} cache={cache} loadCachedThread={loadCachedThread} messages={[]} onMessages={rs.fn()} /></React.StrictMode>));
      expect(loadCachedThread).toHaveBeenCalledTimes(1);
      await act(async () => resolve(null));
      expect(client.getThreadPage).toHaveBeenCalledTimes(1);
    } finally { await act(async () => root.unmount()); cache.clear(); }
  });

  it('keeps the accumulated Query snapshot instead of restoring an earlier parent page', async () => {
    const cache = new ConversationQueryCache();
    cache.remember('account', 'thread', { messages: [message('older'), message('latest')], downloadedPage: marker() });
    const client = { getThreadPage: rs.fn() };
    const published = rs.fn();
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
      await act(async () => root.render(<PagedThreadMessages {...defaults} client={client} cache={cache}
        messages={[message('latest')]} downloadedPage={marker('older-cursor')} htmlEnabled={false} onMessages={published} />));
      expect(container.querySelectorAll('.thread-message')).toHaveLength(2);
      expect(container.textContent).toContain('All conversation messages loaded');
      expect(container.textContent).not.toContain('Load older messages');
      expect(client.getThreadPage).not.toHaveBeenCalled();
      expect(published).toHaveBeenCalledTimes(1);
    } finally { await act(async () => root.unmount()); cache.clear(); }
  });

  it('makes zero page or SQLite reads across ten hydrated alternating opens', async () => {
    const client = { getThreadPage: rs.fn() };
    const loadCachedThread = rs.fn();
    const onMessages = rs.fn();
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
      for (let index = 0; index < 10; index++) {
        const id = index % 2 ? 'b' : 'a';
        await act(async () => root.render(<PagedThreadMessages {...defaults} key={id} threadId={id}
          client={client} loadCachedThread={loadCachedThread} downloadedPage={marker()}
          messages={[message(id)]} htmlEnabled={false} onMessages={onMessages} />));
        expect(container.textContent).toContain(`Plain ${id}`);
        expect(container.textContent).not.toContain('Loading conversation');
      }
      expect(client.getThreadPage).not.toHaveBeenCalled();
      expect(loadCachedThread).not.toHaveBeenCalled();
    } finally { await act(async () => root.unmount()); }
  });

  it('downloads A and B once, then reopens A from the parent-owned cache', async () => {
    const client = { getThreadPage: rs.fn().mockImplementation(async (_account: string, id: string) => page([id], null)) };
    function Reader({ id }: { id: string }) {
      const [cache, setCache] = useState<Record<string, { messages: readonly EmailMessage[]; downloadedPage?: DownloadedThreadPage }>>({});
      const onMessages = useCallback((_account: string, threadId: string, messages: readonly EmailMessage[],
        _revision: string, downloadedPage?: DownloadedThreadPage) => {
        setCache(current => ({ ...current, [threadId]: { messages, downloadedPage } }));
      }, []);
      return <PagedThreadMessages {...defaults} key={id} threadId={id} client={client}
        messages={cache[id]?.messages ?? []} downloadedPage={cache[id]?.downloadedPage}
        htmlEnabled={false} onMessages={onMessages} />;
    }
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
      for (const id of ['a', 'b', 'a']) {
        await act(async () => root.render(<Reader id={id} />));
        expect(container.textContent).toContain(`Plain ${id}`);
      }
      expect(client.getThreadPage.mock.calls).toEqual([['account', 'a', null], ['account', 'b', null]]);
    } finally { await act(async () => root.unmount()); }
  });

  it('keeps legacy cached bodies readable offline without marking them fully downloaded', async () => {
    const cached = { ...previewMailState().threads[0]!, accountId: 'account', threadId: 'thread',
      providerRevision: 'h1', messages: [message('legacy')] };
    const onMessages = rs.fn();
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
      await act(async () => root.render(<PagedThreadMessages {...defaults} client={null}
        loadCachedThread={async () => cached} messages={[]} htmlEnabled={false} onMessages={onMessages} />));
      expect(container.textContent).toContain('Plain legacy');
      expect(container.textContent).not.toContain('All conversation messages loaded');
      expect(onMessages).toHaveBeenCalledWith('account', 'thread', cached.messages, 'h1');
    } finally { await act(async () => root.unmount()); }
  });

  it('checks SQLite before fetching and restores a partial page with its older cursor', async () => {
    const client = { getThreadPage: rs.fn().mockResolvedValue(page(['oldest'], null)) };
    const loadCachedThread = rs.fn().mockResolvedValue({ ...previewMailState().threads[0]!,
      accountId: 'account', threadId: 'thread', providerRevision: 'h1',
      messages: [message('latest')], downloadedPage: marker('older') });
    const onMessages = rs.fn();
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
      await act(async () => root.render(<PagedThreadMessages {...defaults} client={client}
        loadCachedThread={loadCachedThread} messages={[]} htmlEnabled={false} onMessages={onMessages} />));
      expect(loadCachedThread).toHaveBeenCalledTimes(1);
      expect(client.getThreadPage).not.toHaveBeenCalled();
      expect(container.textContent).toContain('Plain latest');
      expect(container.textContent).not.toContain('All conversation messages loaded');
      await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
      expect(client.getThreadPage).toHaveBeenCalledWith('account', 'thread', 'older');
      expect(onMessages.mock.calls.at(-1)?.[2].map((item: EmailMessage) => item.messageId)).toEqual(['oldest', 'latest']);
    } finally { await act(async () => root.unmount()); }
  });

  it.each(['preview', 'revision', 'account', 'thread', 'failure'] as const)(
    'fetches when the disk cache is a %s miss', async kind => {
      const cached: EmailThread = { ...previewMailState().threads[0]!, accountId: 'account', threadId: 'thread',
        providerRevision: 'h1', messages: [message('preview')], downloadedPage: marker() };
      const result = kind === 'preview' ? { ...cached, downloadedPage: undefined }
        : kind === 'revision' ? { ...cached, providerRevision: 'old' }
        : kind === 'account' ? { ...cached, accountId: 'other' }
        : kind === 'thread' ? { ...cached, threadId: 'other' } : cached;
      const loadCachedThread = kind === 'failure' ? rs.fn().mockRejectedValue(new Error('disk unavailable'))
        : rs.fn().mockResolvedValue(result);
      const client = { getThreadPage: rs.fn().mockResolvedValue(page(['downloaded'], null)) };
      const root = createRoot(document.createElement('div'));
      try {
        await act(async () => root.render(<PagedThreadMessages {...defaults} client={client}
          loadCachedThread={loadCachedThread} messages={[message('preview')]} onMessages={rs.fn()} />));
        expect(client.getThreadPage).toHaveBeenCalledExactlyOnceWith('account', 'thread', null);
      } finally { await act(async () => root.unmount()); }
    });

  it('does not publish a first page from a different provider revision', async () => {
    const client = { getThreadPage: rs.fn().mockResolvedValue({ ...page(['changed'], null), providerRevision: 'h2' }) };
    const onMessages = rs.fn();
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
      await act(async () => root.render(<PagedThreadMessages {...defaults} client={client} messages={[]} onMessages={onMessages} />));
      expect(onMessages).not.toHaveBeenCalled();
      expect(container.querySelector('[role="alert"]')?.textContent).toContain('conversation changed');
    } finally { await act(async () => root.unmount()); }
  });

  it('cancels a superseded SQLite lookup before it can start a backend read', async () => {
    let resolve!: (value: null) => void;
    let signal!: AbortSignal;
    const loadCachedThread = rs.fn().mockImplementationOnce((_a: string, _t: string, abort: AbortSignal) => {
      signal = abort;
      return new Promise<null>(done => { resolve = done; });
    }).mockResolvedValueOnce(null);
    const client = { getThreadPage: rs.fn().mockResolvedValue(page(['other'], null)) };
    const onMessages = rs.fn();
    const root = createRoot(document.createElement('div'));
    try {
      await act(async () => root.render(<PagedThreadMessages {...defaults} client={client}
        loadCachedThread={loadCachedThread} messages={[]} onMessages={onMessages} />));
      expect(client.getThreadPage).not.toHaveBeenCalled();
      await act(async () => root.render(<PagedThreadMessages {...defaults} accountId="other" client={client}
        loadCachedThread={loadCachedThread} messages={[]} onMessages={onMessages} />));
      expect(signal.aborted).toBe(true);
      await act(async () => resolve(null));
      expect(client.getThreadPage).toHaveBeenCalledExactlyOnceWith('other', 'thread', null);
    } finally { await act(async () => root.unmount()); }
  });

  it('shares one backend read when A is reopened while its first request is pending', async () => {
    const cache = new ConversationQueryCache();
    let resolve!: (value: ThreadPage) => void;
    const client = { getThreadPage: rs.fn().mockImplementationOnce(() => new Promise<ThreadPage>(done => { resolve = done; }))
      .mockResolvedValueOnce(page(['b'], null)) };
    const onMessages = rs.fn();
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
      for (const id of ['a', 'b', 'a']) {
        await act(async () => root.render(<PagedThreadMessages {...defaults} key={id} threadId={id}
          cache={cache} client={client} messages={[]} htmlEnabled={false} onMessages={onMessages} />));
      }
      expect(client.getThreadPage).toHaveBeenCalledTimes(2);
      await act(async () => resolve(page(['a'], null)));
      expect(container.textContent).toContain('Plain a');
      expect(onMessages.mock.calls.filter(call => call[1] === 'a')).toHaveLength(1);
    } finally { await act(async () => root.unmount()); cache.clear(); }
  });

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

  it('bounds accumulated bodies and lets the reader return to newest messages', async () => {
    const large = (id: string) => ({ ...message(id), bodyText: 'x'.repeat(4_500_000), bodyHtml: undefined });
    const newest = { ...page([], 'older'), messages: [large('newest')] };
    const oldest = { ...page([], null), messages: [large('oldest')] };
    const client = { getThreadPage: rs.fn<() => Promise<ThreadPage>>()
      .mockResolvedValueOnce(newest).mockResolvedValueOnce(oldest).mockResolvedValueOnce(newest) };
    const onMessages = rs.fn();
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
      await act(async () => root.render(<PagedThreadMessages {...defaults} client={client}
        messages={[]} onMessages={onMessages} />));
      await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
      expect(onMessages.mock.calls.at(-1)?.[2]).toEqual(oldest.messages);
      expect(container.textContent).toContain('End of conversation');
      const newestButton = [...container.querySelectorAll('button')].find(button => button.textContent === 'Load newest messages')!;
      await act(async () => newestButton.click());
      expect(onMessages.mock.calls.at(-1)?.[2]).toEqual(newest.messages);
      expect(container.textContent).toContain('Load older messages');
    } finally { await act(async () => root.unmount()); }
  });

  it.each(['no progress', 'cursor loop'] as const)('evicts a cached %s response so Retry makes a fresh request', async kind => {
    const cache = new ConversationQueryCache();
    const client = { getThreadPage: rs.fn()
      .mockResolvedValueOnce(page(['latest'], 'older'))
      .mockResolvedValueOnce(page(['latest'], kind === 'cursor loop' ? 'older' : null))
      .mockResolvedValueOnce(page(['oldest'], null)) };
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
      await act(async () => root.render(<PagedThreadMessages {...defaults} client={client} cache={cache}
        messages={[]} htmlEnabled={false} onMessages={rs.fn()} />));
      await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
      expect(container.querySelector('[role="alert"]')).not.toBeNull();
      await act(async () => container.querySelector<HTMLButtonElement>('[role="alert"] button')!.click());
      expect(client.getThreadPage.mock.calls).toEqual([
        ['account', 'thread', null], ['account', 'thread', 'older'],
        ['account', 'thread', kind === 'cursor loop' ? null : 'older'],
      ]);
      expect(container.querySelector('[role="alert"]')).toBeNull();
      expect(container.textContent).toContain('Plain oldest');
    } finally { await act(async () => root.unmount()); cache.clear(); }
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
      expect(onMessages).toHaveBeenCalledWith('account', 'thread', [message('latest')], 'h1', expect.objectContaining({ complete: true }));
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
      expect(onMessages.mock.calls).toEqual([['other', 'thread', [message('other')], 'h1', expect.objectContaining({ complete: true })]]);
    } finally { await act(async () => root.unmount()); }
  });
});
