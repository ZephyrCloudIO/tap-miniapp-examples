/** @rstest-environment jsdom */

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from '@rstest/core';
import { MailSyncButton } from './sync-button';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe('MailSyncButton', () => {
  it('keeps its visible and accessible label stable while busy', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    let syncCalls = 0;

    try {
      await act(async () => {
        root.render(
          <MailSyncButton
            onSync={() => { syncCalls += 1; }}
            syncing={false}
          />,
        );
      });
      const button = container.querySelector('button')!;
      expect(button.textContent).toBe('Sync');
      expect(button.getAttribute('aria-label')).toBe('Sync mail');
      expect(button.getAttribute('aria-busy')).toBe('false');
      expect(button.disabled).toBe(false);
      expect(button.querySelector('.sync-status-icon')?.getAttribute('aria-hidden')).toBe('true');

      await act(async () => button.click());
      expect(syncCalls).toBe(1);

      await act(async () => {
        root.render(
          <MailSyncButton
            onSync={() => { syncCalls += 1; }}
            syncing
          />,
        );
      });
      expect(button.textContent).toBe('Sync');
      expect(button.getAttribute('aria-label')).toBe('Sync mail');
      expect(button.getAttribute('aria-busy')).toBe('true');
      expect(button.disabled).toBe(true);
      expect(button.classList.contains('is-syncing')).toBe(true);

      await act(async () => button.click());
      expect(syncCalls).toBe(1);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
