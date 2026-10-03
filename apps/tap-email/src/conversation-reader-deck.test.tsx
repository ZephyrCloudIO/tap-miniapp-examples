/** @rstest-environment jsdom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, rs } from '@rstest/core';
import { ConversationReaderDeck } from './conversation-reader-deck';
import { RichMessageBody } from './rich-message';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('bounded retained HTML readers', () => {
  it('evicts inactive readers when their bodies exceed the byte budget', async () => {
    const container = document.createElement('div'); document.body.append(container);
    const root = createRoot(container);
    let evicted = false;
    const cost = (key: string) => evicted && key === 'A' ? 0 : 5 * 1024 * 1024;
    const render = (activeKey: string) => <ConversationReaderDeck activeKey={activeKey} warmKeys={['A', 'B', 'C']} cost={cost}>
      {key => <span>{key}</span>}
    </ConversationReaderDeck>;
    try {
      await act(async () => root.render(render('A')));
      expect(container.querySelectorAll('[data-reader-active]')).toHaveLength(1);
      evicted = true; // Query eviction does not free the mounted reader's bodies.
      await act(async () => root.render(render('B')));
      expect(container.querySelectorAll('[data-reader-active]')).toHaveLength(1);
      expect(container.textContent).toBe('B');
    } finally { await act(async () => root.unmount()); container.remove(); }
  });
  it('reuses the same iframe and performs no parsing across ten warm switches', async () => {
    const container = document.createElement('div'); document.body.append(container);
    const root = createRoot(container);
    const parse = rs.spyOn(DOMParser.prototype, 'parseFromString');
    const imageLoader = rs.fn(async (urls: readonly string[]) => Object.fromEntries(urls.map(url => [url, 'data:image/png;base64,AAAA'])));
    const render = (activeKey: string) => <ConversationReaderDeck activeKey={activeKey} warmKeys={['A', 'B']}>
      {(key, active) => <RichMessageBody active={active} html={`<p>Message ${key}</p><img src="https://example.com/${key}.png">`}
        title={`Email ${key}`} imagesEnabled loadRemoteImages={imageLoader} scriptsEnabled={false} />}
    </ConversationReaderDeck>;
    try {
      await act(async () => root.render(render('A')));
      const a = container.querySelector('iframe[title="Email A"]');
      const b = container.querySelector('iframe[title="Email B"]');
      expect(a).not.toBeNull(); expect(b).not.toBeNull();
      expect(imageLoader).toHaveBeenCalledTimes(1); // Warming B must not load its external images.
      await act(async () => root.render(render('B')));
      expect(imageLoader).toHaveBeenCalledTimes(2);
      const readyA = container.querySelector('iframe[title="Email A"]');
      const readyB = container.querySelector('iframe[title="Email B"]');
      const hydrated = new DOMParser().parseFromString(readyB!.getAttribute('srcdoc')!, 'text/html');
      expect(hydrated.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AAAA');
      parse.mockClear(); imageLoader.mockClear();
      for (let index = 0; index < 10; index++) await act(async () => root.render(render(index % 2 ? 'B' : 'A')));
      expect(container.querySelector('iframe[title="Email A"]')).toBe(readyA);
      expect(container.querySelector('iframe[title="Email B"]')).toBe(readyB);
      expect(parse).not.toHaveBeenCalled(); expect(imageLoader).not.toHaveBeenCalled();
      expect(container.querySelectorAll('[inert]')).toHaveLength(1);
      expect(container.querySelector('[data-reader-active="true"] iframe')?.getAttribute('title')).toBe('Email B');
      for (let index = 0; index < 10; index++) await act(async () => root.render(render(`C${index}`)));
      expect(container.querySelectorAll('iframe').length).toBeLessThanOrEqual(5);
      await act(async () => root.render(<ConversationReaderDeck activeKey="other" canRetain={key => key === 'other'}>
        {key => <RichMessageBody html={`<p>${key}</p>`} title={key} />}
      </ConversationReaderDeck>));
      expect(container.querySelectorAll('iframe')).toHaveLength(1);
    } finally { await act(async () => root.unmount()); container.remove(); rs.restoreAllMocks(); }
  });
});
