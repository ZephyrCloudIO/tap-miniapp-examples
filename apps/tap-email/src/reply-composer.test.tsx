/** @rstest-environment jsdom */

import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from '@rstest/core';
import { ReplyComposer, type ReplyPlacement } from './reply-composer';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

interface ReplyHarnessProps {
  readonly onClose: () => void;
  readonly onPromptReply: () => void;
  readonly onSend: () => void;
}

function ReplyHarness({ onClose, onPromptReply, onSend }: ReplyHarnessProps) {
  const [bodyText, setBodyText] = useState('');
  const [placement, setPlacement] = useState<ReplyPlacement>('inline');
  const [to, setTo] = useState('maya@example.com');
  return (
    <ReplyComposer
      attachmentBusy={false}
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
      onPromptReply={onPromptReply}
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
  options: Pick<KeyboardEventInit, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'> = {},
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
  onPromptReply = () => undefined,
  onSend = () => undefined,
): Promise<{
  readonly container: HTMLDivElement;
  readonly root: Root;
}> {
  const container = document.createElement('div');
  container.className = 'message-body';
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(
    <ReplyHarness onClose={onClose} onPromptReply={onPromptReply} onSend={onSend} />,
  ));
  return { container, root };
}

describe('ReplyComposer', () => {
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

  it('opens an editable Chloe prompt on command enter and sends only from the button', async () => {
    let closes = 0;
    let prompts = 0;
    let sends = 0;
    const mounted = await mountReply(
      () => { closes += 1; },
      () => { prompts += 1; },
      () => { sends += 1; },
    );
    try {
      const textarea = mounted.container.querySelector<HTMLTextAreaElement>('textarea')!;
      await typeInto(textarea, 'Ready to send');
      await pressKey(textarea, 'Enter');
      expect(sends).toBe(0);
      await pressKey(textarea, 'Enter', { metaKey: true });
      expect(prompts).toBe(1);
      expect(sends).toBe(0);

      await act(async () => mounted.container
        .querySelector<HTMLButtonElement>('button[type="submit"]')!
        .click());
      expect(sends).toBe(1);

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
