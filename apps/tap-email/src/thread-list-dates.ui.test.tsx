/** @rstest-environment jsdom */

import { describe, expect, it } from '@rstest/core';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { TapEmailApp } from './app';
import { threadListTimestamp } from './thread-list-dates';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

async function waitForThreadGroups(container: HTMLElement): Promise<HTMLElement[]> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const groups = [...container.querySelectorAll<HTMLElement>('.thread-day-group')];
    if (groups.length > 0) return groups;
    await act(async () => new Promise(resolve => setTimeout(resolve, 10)));
  }
  throw new Error('Thread day groups did not render');
}

describe('thread list date presentation', () => {
  it('renders labelled day separators and date-aware timestamps', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    try {
      await act(async () => root.render(<TapEmailApp preview />));
      const groups = await waitForThreadGroups(container);
      const referenceNow = new Date();

      expect(groups.length).toBeGreaterThan(1);
      for (const group of groups) {
        const label = group.getAttribute('aria-label');
        expect(label).toBeTruthy();
        expect(group.querySelector('.thread-day-separator')?.textContent).toBe(label);

        for (const time of group.querySelectorAll<HTMLTimeElement>('time')) {
          expect(time.textContent).toBe(
            threadListTimestamp(time.dateTime, referenceNow),
          );
        }
      }
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
