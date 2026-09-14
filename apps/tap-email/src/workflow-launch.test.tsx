/** @rstest-environment jsdom */

import { describe, expect, it } from '@rstest/core';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { TapEmailApp } from './app';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

async function waitForWorkflowButton(container: HTMLElement): Promise<HTMLButtonElement> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const button = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Open Email Workflows"]',
    );
    if (button && !button.disabled) return button;
    await act(async () => new Promise(resolve => setTimeout(resolve, 10)));
  }
  throw new Error('Email Workflows launcher was not available.');
}

describe('Email Workflows launch integration', () => {
  it('opens every workflow shell and keeps host effects disabled in fixture mode', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    try {
      await act(async () => root.render(<TapEmailApp preview />));
      const launcher = await waitForWorkflowButton(container);
      await act(async () => launcher.click());

      const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
      expect(dialog?.textContent).toContain('Morning Brief');
      expect(dialog?.textContent).toContain('EOD Wrap');
      expect(dialog?.textContent).toContain('Daily Rollup');
      expect(dialog?.textContent).toContain('Missed Mail Audit');
      expect(dialog?.textContent).toContain('Prepare Follow-up Drafts');
      expect(dialog?.textContent).toContain('Mail Merge');
      expect(dialog?.textContent).toContain('Email Activity Summary');
      expect(dialog?.textContent).toContain('Saved workflows require a mounted TAP workspace');

      const effectButtons = [...dialog!.querySelectorAll<HTMLButtonElement>('button')]
        .filter(button => button.textContent?.includes('Run') ||
          button.textContent?.includes('Preview recipient drafts'));
      expect(effectButtons.length).toBeGreaterThan(0);
      expect(effectButtons.every(button => button.disabled)).toBe(true);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
