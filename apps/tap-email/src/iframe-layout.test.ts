/** @rstest-environment jsdom */

import { describe, expect, it } from '@rstest/core';
import { watchRichMessageLayout } from './iframe-layout';

class TestResizeObserver {
  static instance: TestResizeObserver | null = null;

  readonly callback: ResizeObserverCallback;
  target: Element | null = null;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    TestResizeObserver.instance = this;
  }

  disconnect(): void {
    this.target = null;
  }

  observe(target: Element): void {
    this.target = target;
  }

  unobserve(): void {
    this.target = null;
  }

  emit(width: number): void {
    if (!this.target) return;
    this.callback([{
      borderBoxSize: [],
      contentBoxSize: [],
      contentRect: { width } as DOMRectReadOnly,
      devicePixelContentBoxSize: [],
      target: this.target,
    }], this as unknown as ResizeObserver);
  }
}

describe('watchRichMessageLayout', () => {
  it('remeasures only when the host width changes', () => {
    const previousResizeObserver = window.ResizeObserver;
    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      value: TestResizeObserver,
    });
    const shell = document.createElement('div');
    shell.className = 'rich-message-shell';
    const frame = document.createElement('iframe');
    shell.append(frame);
    document.body.append(shell);
    Object.defineProperty(shell, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ width: 800 }),
    });
    let layouts = 0;

    try {
      const stop = watchRichMessageLayout(frame, () => { layouts += 1; });
      TestResizeObserver.instance?.emit(800);
      expect(layouts).toBe(0);
      TestResizeObserver.instance?.emit(520);
      expect(layouts).toBe(1);
      TestResizeObserver.instance?.emit(520);
      expect(layouts).toBe(1);
      stop();
      expect(TestResizeObserver.instance?.target).toBeNull();
    } finally {
      shell.remove();
      Object.defineProperty(window, 'ResizeObserver', {
        configurable: true,
        value: previousResizeObserver,
      });
      TestResizeObserver.instance = null;
    }
  });
});
