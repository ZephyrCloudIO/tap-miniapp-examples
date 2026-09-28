/** @rstest-environment jsdom */

import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from '@rstest/core';
import { ReplyComposer, type ReplyPlacement } from './reply-composer';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

interface ReplyHarnessProps {
  readonly onClose: () => void;
  readonly initialPlacement?: ReplyPlacement;
  readonly attachmentBusy?: boolean;
  readonly onSend: () => void;
}

function ReplyHarness({ onClose, onSend, initialPlacement = 'inline', attachmentBusy = false }: ReplyHarnessProps) {
  const [bodyText, setBodyText] = useState('');
  const [placement, setPlacement] = useState<ReplyPlacement>(initialPlacement);
  const [to, setTo] = useState('maya@example.com');
  return (
    <ReplyComposer
      attachmentBusy={attachmentBusy}
      attachmentError=""
      attachments={[]}
      bcc=""
      bodyText={bodyText}
      cc=""
      focusRequestId={1}
      onAddressChange={(field, value) => { if (field === 'to') setTo(value); }}
      onAttach={() => undefined}
      onBodyTextChange={setBodyText}
      onClose={onClose}
      onRemoveAttachment={() => undefined}
      onSchedule={() => undefined}
      onSend={onSend}
      onTogglePlacement={() => setPlacement(current => current === 'inline' ? 'sidecar' : 'inline')}
      placement={placement}
      recipientLabel="Maya Chen"
      to={to}
    />
  );
}

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

async function pressKey(
  target: HTMLElement,
  key: string,
  options: KeyboardEventInit = {},
): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key,
      ...options,
    }));
  });
}

async function mountReply(
  onClose = () => undefined,
  onSend = () => undefined,
  initialPlacement: ReplyPlacement = 'inline',
  attachmentBusy = false,
): Promise<{
  readonly container: HTMLDivElement;
  readonly root: Root;
}> {
  const container = document.createElement('div');
  container.className = 'message-body';
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(
    <ReplyHarness onClose={onClose} onSend={onSend} initialPlacement={initialPlacement} attachmentBusy={attachmentBusy} />,
  ));
  return { container, root };
}

describe('ReplyComposer', () => {
  it('keeps send validation and missing-attachment confirmation on the shortcut', async () => {
    let sends = 0;
    const mounted = await mountReply(undefined, () => { sends += 1; });
    try {
      const textarea = mounted.container.querySelector<HTMLTextAreaElement>('textarea')!;
      await pressKey(textarea, 'Enter', { metaKey: true });
      expect(sends).toBe(0);

      await typeInto(textarea, 'Ready to send');
      const to = mounted.container.querySelector<HTMLInputElement>('[aria-label="Reply recipients"]')!;
      const setTo = async (value: string) => act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(to, value);
        to.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await setTo('invalid-address');
      await pressKey(textarea, 'Enter', { metaKey: true });
      expect(sends).toBe(0);
      expect(mounted.container.querySelector('[role="alert"]')).not.toBeNull();

      await setTo('maya@example.com');
      await typeInto(textarea, 'Please see the attached document.');
      await pressKey(textarea, 'Enter', { metaKey: true });
      expect(sends).toBe(0);
      expect(mounted.container.querySelector('.draft-attachment-warning')).not.toBeNull();
      await pressKey(textarea, 'Enter', { metaKey: true });
      expect(sends).toBe(1);
    } finally {
      await act(async () => mounted.root.unmount());
      mounted.container.remove();
    }
  });

  it('does not send during uploads, composition, repeated keys, or from a scheduling dialog', async () => {
    let sends = 0;
    const mounted = await mountReply(undefined, () => { sends += 1; }, 'sidecar', true);
    try {
      const textarea = mounted.container.querySelector<HTMLTextAreaElement>('textarea')!;
      await typeInto(textarea, 'Ready to send');
      await pressKey(textarea, 'Enter', { metaKey: true });
      expect(sends).toBe(0);
      await act(async () => mounted.root.render(<ReplyHarness onClose={() => undefined} onSend={() => { sends += 1; }} />));
      for (const options of [
        { metaKey: true, isComposing: true },
        { metaKey: true, keyCode: 229 },
        { metaKey: true, repeat: true },
        { metaKey: true, shiftKey: true },
        { metaKey: true, altKey: true },
      ]) await pressKey(textarea, 'Enter', options);
      expect(sends).toBe(0);
      await act(async () => [...mounted.container.querySelectorAll('button')].find(button => button.textContent === 'Send later')!.click());
      const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
      expect(dialog).not.toBeNull();
      await pressKey(dialog, 'Enter', { metaKey: true });
      expect(sends).toBe(0);
    } finally {
      await act(async () => mounted.root.unmount());
      mounted.container.remove();
    }
  });

  it('starts inline without a modal and keeps the draft while popping out and in', async () => {
    const mounted = await mountReply();
    try {
      const form = mounted.container.querySelector<HTMLFormElement>('form')!;
      const textarea = mounted.container.querySelector<HTMLTextAreaElement>('textarea')!;
      expect(form.dataset.replyPlacement).toBe('inline');
      expect(document.body.querySelector('[role="dialog"]')).toBeNull();
      expect(document.activeElement).toBe(textarea);

      await typeInto(textarea, 'The launch plan looks good.');
      await act(async () => mounted.container
        .querySelector<HTMLButtonElement>('[aria-label="Pop out reply"]')!
        .click());
      expect(form.dataset.replyPlacement).toBe('sidecar');
      expect(textarea.value).toBe('The launch plan looks good.');

      await pressKey(textarea, 'p', { metaKey: true, shiftKey: true });
      expect(form.dataset.replyPlacement).toBe('inline');
      expect(textarea.value).toBe('The launch plan looks good.');
    } finally {
      await act(async () => mounted.root.unmount());
      mounted.container.remove();
    }
  });

  it.each(['inline', 'sidecar'] as const)('sends with command/control enter or the button in an %s reply', async placement => {
    let closes = 0;
    let sends = 0;
    const mounted = await mountReply(
      () => { closes += 1; },
      () => { sends += 1; },
      placement,
    );
    try {
      const textarea = mounted.container.querySelector<HTMLTextAreaElement>('textarea')!;
      await typeInto(textarea, 'Ready to send');
      await pressKey(textarea, 'Enter');
      expect(sends).toBe(0);
      await pressKey(textarea, 'Enter', { metaKey: true });
      expect(sends).toBe(1);
      await pressKey(textarea, 'Enter', { ctrlKey: true });
      expect(sends).toBe(2);

      await act(async () => [...mounted.container.querySelectorAll('button')].find(button => button.textContent === 'Send')!
        .click());
      expect(sends).toBe(3);

      await act(async () => mounted.container
        .querySelector<HTMLButtonElement>('[aria-label="Close reply draft"]')!
        .click());
      expect(closes).toBe(1);
    } finally {
      await act(async () => mounted.root.unmount());
      mounted.container.remove();
    }
  });
});
