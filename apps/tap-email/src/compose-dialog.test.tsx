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
  it('keeps the draft open when Escape dismisses recipient suggestions and does not send on selection', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    let closes = 0;
    let sends = 0;
    try {
      await act(async () => root.render(
        <ComposeDialog accounts={previewMailState().accounts} draftKey="typeahead" initialAccountId="google_work"
          initialBodyText={'Ready to send\n\n-- \nSent with The AI Platform'} initialSubject="Test" initialTo="ma"
          recipientContacts={[{ name: 'Maya Chen', address: 'maya@example.com', lastSentAt: '2026-09-26T12:00:00Z' }]}
          onAttach={async () => ({ attachments: [], cancelled: false, failures: [] })}
          onAutosave={() => undefined} onClose={() => { closes++; }} onSchedule={() => undefined} onSend={() => { sends++; }} />,
      ));
      const input = document.body.querySelector<HTMLInputElement>('[aria-label="To"]')!;
      expect(document.body.querySelector<HTMLTextAreaElement>('[aria-label="Message body"]')?.value).toBe('Ready to send');
      expect(input.getAttribute('aria-expanded')).toBe('true');
      const press = async (key: string) => act(async () => {
        input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      });
      await press('Escape');
      expect(closes).toBe(0);
      expect(input.getAttribute('aria-expanded')).toBe('false');
      await press('ArrowDown');
      await press('Enter');
      expect(input.value).toBe('maya@example.com');
      expect(sends).toBe(0);
      expect(document.body.querySelectorAll('[data-recipient-input]')).toHaveLength(1);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('reveals Cc and Bcc independently, keeps focus predictable, and preserves copied recipients in the draft', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const saved: ComposeDraftMessage[] = [];
    let closes = 0;
    const press = async (target: HTMLElement, key: string, modifiers: KeyboardEventInit = {}) => act(async () => {
      target.dispatchEvent(new KeyboardEvent('keydown', { key, ...modifiers, bubbles: true, cancelable: true }));
    });
    const click = async (selector: string) => act(async () => document.body.querySelector<HTMLButtonElement>(selector)!.click());
    try {
      await act(async () => root.render(
        <ComposeDialog accounts={previewMailState().accounts} draftKey="optional-copies" initialAccountId="google_work"
          initialBodyText="Ready to send" initialSubject="Test" initialTo="maya@example.com"
          onAttach={async () => ({ attachments: [], cancelled: false, failures: [] })}
          onAutosave={message => saved.push(message)} onClose={() => { closes++; }} onSchedule={() => undefined} onSend={() => undefined} />,
      ));
      expect(document.body.querySelector('[aria-label="Cc"]')).toBeNull();
      expect(document.body.querySelector('[aria-label="Bcc"]')).toBeNull();
      await click('[aria-label="Add Cc or Bcc"]');
      expect(document.activeElement?.textContent).toContain('Cc');
      await press(document.activeElement as HTMLElement, 'Escape');
      expect(closes).toBe(0);
      expect(document.body.querySelector('[role="menu"]')).toBeNull();
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Add Cc or Bcc');
      await press(document.activeElement as HTMLElement, 'ArrowDown');
      await press(document.activeElement as HTMLElement, 'ArrowDown');
      expect(document.activeElement?.textContent).toContain('Bcc');
      await act(async () => (document.activeElement as HTMLButtonElement).click());
      const bcc = document.body.querySelector<HTMLInputElement>('[aria-label="Bcc"]')!;
      expect(document.activeElement).toBe(bcc);
      expect(document.body.querySelector('[aria-label="Cc"]')).toBeNull();
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(bcc, 'private@example.com');
        bcc.dispatchEvent(new Event('input', { bubbles: true }));
      });
      expect(document.body.querySelector('[aria-label="Hide Bcc"]')).toBeNull();
      await press(bcc, 'C', { metaKey: true, shiftKey: true });
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Cc');
      expect(document.body.querySelector('[aria-label="Add Cc or Bcc"]')).toBeNull();
      await click('[aria-label="Hide Cc"]');
      expect(document.activeElement?.getAttribute('aria-label')).toBe('To');
      expect(document.body.querySelector('[aria-label="Cc"]')).toBeNull();
      await press(document.activeElement as HTMLElement, 'B', { ctrlKey: true, shiftKey: true });
      expect(document.activeElement).toBe(bcc);
      await click('[aria-label="Save and close draft"]');
      expect(saved.at(-1)?.bcc).toBe('private@example.com');
      expect(closes).toBe(1);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

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

describe('composer actions', () => {
  it('saves writing with no recipient and keeps reminder intent with the draft', async () => {
    const container = document.createElement('div'); document.body.append(container);
    const root = createRoot(container);
    const saved: ComposeDraftMessage[] = [];
    const button = (label: string) => [...document.body.querySelectorAll('button')].find(item => item.textContent === label)!;
    try {
      await act(async () => root.render(<ComposeDialog accounts={previewMailState().accounts} draftKey="incomplete"
        initialAccountId="google_work" initialBodyText="Writing before addressing" initialSubject="" initialTo=""
        onAttach={async () => ({ attachments: [], cancelled: false, failures: [] })}
        onAutosave={value => saved.push(value)} onClose={() => {}} onSchedule={() => {}} onSend={() => {}} />));
      await act(async () => button('Remind me').click());
      await act(async () => button('3 days').click());
      await act(async () => button('Set reminder').click());
      expect(document.body.textContent).toContain('3 days after sending · If no reply');
      await act(async () => document.body.querySelector<HTMLButtonElement>('[aria-label="Save and close draft"]')!.click());
      expect(saved.at(-1)).toMatchObject({ to: '', bodyText: 'Writing before addressing', followUp: { delayMinutes: 4320, condition: 'if_no_reply' } });
    } finally { await act(async () => root.unmount()); container.remove(); }
  });
});
