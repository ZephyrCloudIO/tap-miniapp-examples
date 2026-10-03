/** @rstest-environment jsdom */
import React, { act } from 'react';
import { describe, expect, it, rstest as rs } from '@rstest/core';
import type { TapFederatedSurfaceMountContext } from '@theaiplatform/miniapp-sdk/surface';
import { ComposeDialog } from './compose-dialog';
import { previewMailState } from './domain';
import { mount } from './surface';

rs.mock('@theaiplatform/miniapp-sdk/sdk', () => ({ sdk: { storage: {
  get: () => ({ value: null, revision: null }), set: () => ({ revision: 1 }),
} } }));
rs.mock('./app', () => {
  return {
    // Keep the actual composer under the surface's React root, without mailbox IO.
    TapEmailApp: ({ appTheme }: { appTheme: 'light' | 'dark' }) => React.createElement('main', { 'data-reader-theme': appTheme },
      React.createElement(ComposeDialog, {
        accounts: previewMailState().accounts, draftKey: 'appearance-draft', initialAccountId: 'google_work',
        initialBodyText: '', initialSubject: '', initialTo: 'maya@example.com',
        onAttach: async () => ({ attachments: [], cancelled: false, failures: [] }),
        onAutosave: () => {}, onClose: () => {}, onSchedule: () => {}, onSend: () => {},
      })),
  };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('Email surface appearance updates', () => {
  it('retains the open composer, typed draft and focus across host theme changes', async () => {
    const root = document.documentElement;
    root.dataset.theme = 'dark';
    const container = document.createElement('div');
    document.body.append(container);
    const publish = rs.fn();
    const context = { events: { publish }, instanceId: 'appearance-surface' } as unknown as TapFederatedSurfaceMountContext;
    let surface!: ReturnType<typeof mount>;
    try {
      await act(async () => { surface = mount(container, context); });
      expect(container.querySelector('main')?.dataset.readerTheme).toBe('dark');
      expect(root.dataset.appTheme).toBeUndefined();
      const editor = document.body.querySelector<HTMLTextAreaElement>('[aria-label="Message body"]')!;
      const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      await act(async () => {
        setValue.call(editor, 'Keep this unsent draft');
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        editor.focus();
      });
      for (const theme of ['light', 'dark']) {
        await act(async () => { root.dataset.theme = theme; });
        expect(container.querySelector('main')?.dataset.readerTheme).toBe(theme);
        expect(document.body.querySelector('[aria-label="Message body"]')).toBe(editor);
        expect(editor.value).toBe('Keep this unsent draft');
        expect(document.activeElement).toBe(editor);
      }
      expect(publish).toHaveBeenCalledExactlyOnceWith('tap-email.surface.mounted', { instanceId: 'appearance-surface' });
      await act(async () => { surface.unmount(); surface.unmount(); });
      expect(publish).toHaveBeenCalledTimes(2);
      expect(container.childElementCount).toBe(0);
      await act(async () => { root.dataset.theme = 'light'; });
      expect(container.childElementCount).toBe(0);
    } finally {
      if (surface) await act(async () => { surface.unmount(); });
      container.remove();
      root.removeAttribute('data-theme');
    }
  });
});
