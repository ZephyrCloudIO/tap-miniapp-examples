/** @rstest-environment jsdom */
import { afterEach, describe, expect, it, rstest as rs } from '@rstest/core';
import type { TapFederatedSurfaceMountContext } from '@theaiplatform/miniapp-sdk/surface';
import { installEmailAppearanceSync } from './appearance';

const root = document.documentElement;
const parentDescriptor = Object.getOwnPropertyDescriptor(window, 'parent')!;
const originalUrl = window.location.href;
let stop = () => {};

afterEach(() => {
  stop();
  root.removeAttribute('data-theme');
  root.removeAttribute('data-app-theme');
  root.removeAttribute('data-ui-scale');
  root.removeAttribute('class');
  root.removeAttribute('style');
  Object.defineProperty(window, 'parent', parentDescriptor);
  window.history.replaceState(null, '', originalUrl);
});

function fixture(options: { nativeHeader?: boolean; embedded?: boolean } = {}) {
  const listeners = new Map<string, (payload: unknown) => void>();
  const subscribe = rs.fn((name: string, listener: (payload: unknown) => void) => {
    listeners.set(name, listener);
    return () => { listeners.delete(name); };
  });
  const context = { events: { subscribe } } as unknown as TapFederatedSurfaceMountContext;
  const render = rs.fn();
  stop = installEmailAppearanceSync({
    container: document.createElement('div'), context, render,
    nativeHeader: options.nativeHeader === true, embedded: options.embedded === true,
  });
  return { render, listeners, subscribe };
}

function iframeHost() {
  const parent = {} as Window;
  Object.defineProperty(window, 'parent', { configurable: true, value: parent });
  window.history.replaceState(null, '', '?hostOrigin=https%3A%2F%2Ftap.example.test&appTheme=dark&appUiScale=18');
  const message = (data: unknown, source = parent, origin = 'https://tap.example.test') => {
    window.dispatchEvent(new MessageEvent('message', { data, source, origin }));
  };
  return { message };
}

describe('federated Email appearance ownership', () => {
  for (const theme of ['dark', 'light'] as const) {
    it(`retains the ${theme} host document without relying on or applying URL appearance`, () => {
      root.dataset.theme = theme;
      root.style.setProperty('--app-font-size', '19px');
      root.dataset.uiScale = '19';
      root.classList.add('host-document');
      window.history.replaceState(null, '', `?appTheme=${theme === 'dark' ? 'light' : 'dark'}&appUiScale=12`);
      const before = root.outerHTML;
      const { render } = fixture();
      expect(render).toHaveBeenCalledExactlyOnceWith(theme);
      expect(root.outerHTML).toBe(before);
    });
  }

  it('leaves a same-document host untouched while waiting for its initial appearance', async () => {
    root.style.setProperty('--app-font-size', '19px');
    const before = root.outerHTML;
    const { render } = fixture();
    expect(render).toHaveBeenCalledExactlyOnceWith('light');
    expect(root.outerHTML).toBe(before);
    root.dataset.theme = 'dark';
    await Promise.resolve();
    expect(render).toHaveBeenLastCalledWith('dark');
  });

  it('follows later host theme changes once per theme and disconnects on teardown', async () => {
    root.dataset.theme = 'dark';
    const { render } = fixture();
    root.dataset.theme = 'light';
    await Promise.resolve();
    expect(render.mock.calls).toEqual([['dark'], ['light']]);
    root.classList.add('host-layout');
    root.dataset.theme = 'light';
    await Promise.resolve();
    expect(render).toHaveBeenCalledTimes(2);
    root.dataset.theme = 'dark';
    await Promise.resolve();
    expect(render).toHaveBeenLastCalledWith('dark');
    stop();
    root.dataset.theme = 'light';
    await Promise.resolve();
    expect(render).toHaveBeenCalledTimes(3);
  });

  it('uses the host-owned document for an explicitly embedded MCP iframe', async () => {
    const { message } = iframeHost();
    root.dataset.theme = 'light';
    root.dataset.uiScale = '20';
    const { render } = fixture({ embedded: true });
    expect(render).toHaveBeenCalledExactlyOnceWith('light');
    expect(root.dataset.appTheme).toBeUndefined();
    expect(root.dataset.uiScale).toBe('20');
    message({ type: 'tap-miniapp-theme-changed', appTheme: 'dark' });
    expect(render).toHaveBeenCalledTimes(1);
    root.dataset.theme = 'dark';
    await Promise.resolve();
    expect(render).toHaveBeenLastCalledWith('dark');
  });

  it('keeps isolated TAP frame theme and bounded UI scale messages through the SDK', () => {
    const { message } = iframeHost();
    const { render } = fixture();
    expect(render).toHaveBeenCalledExactlyOnceWith('dark');
    expect(root.dataset.theme).toBe('dark');
    expect(root.dataset.appTheme).toBe('dark');
    expect(root.classList.contains('dark')).toBe(true);
    expect(root.dataset.uiScale).toBe('18');
    message({ type: 'tap-miniapp-theme-changed', appTheme: 'light' }, window);
    message({ type: 'tap-miniapp-theme-changed', appTheme: 'light' }, undefined, 'https://other.test');
    message({ type: 'tap-miniapp-theme-changed', appTheme: 'system' });
    expect(render).toHaveBeenCalledTimes(1);
    message({ type: 'tap-miniapp-theme-changed', appTheme: 'light' });
    expect(root.dataset.theme).toBe('light');
    expect(root.dataset.appTheme).toBe('light');
    expect(root.classList.contains('dark')).toBe(false);
    message({ type: 'zephyr-app-theme-changed', appTheme: 'dark' });
    expect(render.mock.calls).toEqual([['dark'], ['light'], ['dark']]);
    message({ type: 'zephyr-app-ui-scale-changed', appUiScale: 21 });
    expect(root.dataset.uiScale).toBe('18');
    message({ type: 'zephyr-app-ui-scale-changed', appUiScale: 20 });
    expect(root.dataset.uiScale).toBe('20');
    stop();
    message({ type: 'tap-miniapp-theme-changed', appTheme: 'light' });
    message({ type: 'zephyr-app-ui-scale-changed', appUiScale: 12 });
    expect(render).toHaveBeenCalledTimes(3);
    expect(root.dataset.theme).toBe('dark');
    expect(root.dataset.uiScale).toBe('20');
  });

  it('retains native initial theme and presentation events without writing the host document', async () => {
    root.dataset.appTheme = 'dark';
    const { render, listeners } = fixture({ nativeHeader: true });
    expect(render).toHaveBeenCalledExactlyOnceWith('dark');
    const before = root.outerHTML;
    const presentation = listeners.get('tap.mobile.presentation')!;
    presentation({ theme: 'system' });
    presentation(null);
    expect(render).toHaveBeenCalledTimes(1);
    presentation({ theme: 'light' });
    expect(render).toHaveBeenLastCalledWith('light');
    expect(root.outerHTML).toBe(before);
    root.dataset.appTheme = 'light';
    await Promise.resolve();
    expect(render).toHaveBeenCalledTimes(2);
    stop();
    expect(listeners.size).toBe(0);
  });

  it('reads native host class themes and gives MCP data-theme priority over legacy attributes', async () => {
    root.classList.add('dark');
    const { render } = fixture({ embedded: true });
    expect(render).toHaveBeenCalledExactlyOnceWith('dark');
    root.classList.replace('dark', 'light');
    await Promise.resolve();
    expect(render).toHaveBeenLastCalledWith('light');
    root.dataset.theme = 'dark';
    root.dataset.appTheme = 'light';
    await Promise.resolve();
    expect(render).toHaveBeenLastCalledWith('dark');
    expect(root.dataset.appTheme).toBe('light');
  });
});
