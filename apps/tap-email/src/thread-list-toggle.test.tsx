/** @rstest-environment jsdom */

import { TooltipProvider } from '@theaiplatform/miniapp-sdk/ui';
import { describe, expect, it } from '@rstest/core';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import {
  THREAD_LIST_PANE_ID,
  ThreadListToggle,
} from './thread-list-toggle';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe('ThreadListToggle', () => {
  it('keeps the hidden mail list recoverable and explains the control on focus', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    let toggleCount = 0;

    const renderToggle = (collapsed: boolean) => (
      <TooltipProvider delayDuration={0}>
        <ThreadListToggle
          collapsed={collapsed}
          onToggle={() => { toggleCount += 1; }}
        />
      </TooltipProvider>
    );

    try {
      await act(async () => root.render(renderToggle(false)));
      let button = container.querySelector<HTMLButtonElement>('button');
      expect(button?.getAttribute('aria-label')).toBe('Collapse email list');
      expect(button?.getAttribute('aria-controls')).toBe(THREAD_LIST_PANE_ID);
      expect(button?.getAttribute('aria-expanded')).toBe('true');

      await act(async () => button?.focus());
      expect(document.body.querySelector('[role="tooltip"]')?.textContent)
        .toContain('Collapse email list');

      await act(async () => button?.click());
      expect(toggleCount).toBe(1);

      await act(async () => root.render(renderToggle(true)));
      button = container.querySelector<HTMLButtonElement>('button');
      expect(button?.getAttribute('aria-label')).toBe('Expand email list');
      expect(button?.getAttribute('aria-expanded')).toBe('false');
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
