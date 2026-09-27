/** @rstest-environment jsdom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, rstest as rs } from '@rstest/core';
import { IsolatedMessageFrame } from './isolated-message-frame';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { rs.restoreAllMocks(); rs.useRealTimers(); });

async function fixture() {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const onFailure = rs.fn();
  await act(async () => root.render(<IsolatedMessageFrame
    source="<p>Only this message</p>" url="http://localhost/index.html?tap-isolated-document=v1"
    title="Email" id="message" presentation="adaptive" theme="light" onFailure={onFailure}
  />));
  const frame = container.querySelector('iframe')!;
  const child = frame.contentWindow!;
  const post = rs.spyOn(child, 'postMessage').mockImplementation(() => undefined);
  return { container, root, frame, child, post, onFailure, cleanup: async () => {
    await act(async () => root.unmount()); container.remove();
  } };
}

function ready(source: Window, origin = 'null') {
  window.dispatchEvent(new MessageEvent('message', {
    source, origin, data: { type: 'tap.isolated-document.ready', version: 1 },
  }));
}

describe('isolated message delivery', () => {
  it('delivers once to the exact opaque child and ignores other sources or origins', async () => {
    const view = await fixture();
    expect(view.frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(view.frame.hasAttribute('srcdoc')).toBe(false);
    ready(window);
    ready(view.child, 'https://sender.test');
    expect(view.post).not.toHaveBeenCalled();
    ready(view.child);
    ready(view.child);
    expect(view.post).toHaveBeenCalledTimes(1);
    expect(view.post).toHaveBeenCalledWith({
      type: 'tap.isolated-document.render', version: 1, html: '<p>Only this message</p>',
    }, '*');
    await view.cleanup();
    ready(view.child);
    expect(view.post).toHaveBeenCalledTimes(1);
  });

  it('waits for the host guard to release contentWindow instead of crashing', async () => {
    const view = await fixture();
    Object.defineProperty(view.frame, 'contentWindow', {
      configurable: true, get: () => { throw new DOMException('Pending host bootstrap', 'SecurityError'); },
    });
    ready(view.child);
    expect(view.post).not.toHaveBeenCalled();
    Object.defineProperty(view.frame, 'contentWindow', { configurable: true, value: view.child });
    ready(view.child);
    expect(view.post).toHaveBeenCalledTimes(1);
    await view.cleanup();
  });

  it('falls back when the child cannot start', async () => {
    rs.useFakeTimers();
    const view = await fixture();
    await act(async () => rs.advanceTimersByTime(10_000));
    expect(view.onFailure).toHaveBeenCalledTimes(1);
    await view.cleanup();
  });
});
