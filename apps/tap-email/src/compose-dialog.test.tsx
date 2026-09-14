/** @rstest-environment jsdom */

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from '@rstest/core';
import { ComposeDialog, type ComposeDraftMessage } from './compose-dialog';
import { previewMailState } from './domain';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

async function typeInto(textarea: HTMLTextAreaElement, value: string): Promise<void> {
  const valueSetter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value',
  )?.set;
  if (!valueSetter) throw new Error('HTMLTextAreaElement value setter unavailable');
  await act(async () => {
    valueSetter.call(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('ComposeDialog draft preservation', () => {
  it('flushes the latest eligible draft before an ordinary close', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const events: string[] = [];
    const autosaved: ComposeDraftMessage[] = [];
    try {
      await act(async () => root.render(
        <ComposeDialog
          accounts={previewMailState().accounts}
          draftKey="draft_close_1"
          initialAccountId="google_work"
          initialBodyText=""
          initialSubject="Follow up"
          initialTo="maya@example.com"
          onAttach={async () => ({ attachments: [], cancelled: false, failures: [] })}
          onAutosave={message => {
            autosaved.push(message);
            events.push('autosave');
          }}
          onClose={() => events.push('close')}
          onSchedule={() => undefined}
          onSend={() => undefined}
        />,
      ));
      const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
      const body = dialog.querySelector<HTMLTextAreaElement>('[aria-label="Message body"]')!;
      await typeInto(body, 'Latest unsaved words');
      await act(async () => dialog
        .querySelector<HTMLButtonElement>('[aria-label="Save and close draft"]')!
        .click());

      expect(events.slice(0, 2)).toEqual(['autosave', 'close']);
      expect(autosaved).toHaveLength(1);
      expect(autosaved[0]).toMatchObject({
        bodyText: 'Latest unsaved words',
        draftKey: 'draft_close_1',
        draftRevision: 2,
        to: 'maya@example.com',
      });
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
