/** @rstest-environment jsdom */

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, rs } from '@rstest/core';
import { previewMailState } from './domain';
import { ConversationHandoffDialog } from './conversation-handoff-dialog';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function host() {
  const create = rs.fn(async () => ({ roomId: 'room-1' }));
  const sendMessage = rs.fn(async (options: { clientMessageId?: string }) => ({
    messageId: 'message-host-1',
    clientMessageId: options.clientMessageId ?? 'missing',
  }));
  return {
    value: {
      authorization: { check: rs.fn(async () => ({ allowed: true })) },
      channels: {
        create,
        list: rs.fn(async () => ({ rooms: [], readMode: 'full' })),
        sendMessage,
      },
      chat: {
        sendTextToChat: rs.fn(async () => undefined),
        stageDeepLinkWithRollback: rs.fn(async () => ({ id: 'staged-1' })),
      },
    },
    create,
    sendMessage,
  };
}

function storage() {
  let value: unknown = null;
  let revision: number | null = null;
  return {
    get: rs.fn(async () => ({ value, revision })),
    set: rs.fn(async (options: { expectedRevision: number | null; value: unknown }) => {
      expect(options.expectedRevision).toBe(revision);
      value = options.value;
      revision = (revision ?? 0) + 1;
      return { revision };
    }),
  };
}

describe('ConversationHandoffDialog', () => {
  it('opens on privacy-safe choices and requires an explicit disclosure review', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const platform = host();
    const receiptStorage = storage();
    const thread = previewMailState().threads[0]!;
    try {
      await act(async () => {
        root.render(
          <ConversationHandoffDialog
            idFactory={() => 'review-1'}
            onClose={() => undefined}
            onCompleted={() => undefined}
            onPhase={() => undefined}
            platform={platform.value as never}
            storage={receiptStorage as never}
            thread={thread}
            workspaceId="workspace-1"
          />,
        );
      });
      const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
      expect(dialog.textContent).toContain('Redacted summary');
      expect(dialog.textContent).toContain('Live link');
      expect(dialog.querySelector<HTMLSelectElement>('select[name="handoff-destination"]')?.value)
        .toBe('new-private');
      expect(dialog.textContent).not.toContain(thread.subject);
      expect(dialog.textContent).not.toContain(thread.messages.at(-1)?.bodyText);

      const submit = [...dialog.querySelectorAll<HTMLButtonElement>('button')]
        .find(button => button.textContent?.trim() === 'Create & share')!;
      expect(submit.disabled).toBe(true);
      const review = dialog.querySelector<HTMLButtonElement>('[role="checkbox"]')!;
      await act(async () => review.click());
      expect(submit.disabled).toBe(false);

      await act(async () => {
        submit.click();
        await new Promise(resolve => setTimeout(resolve, 0));
      });
      expect(platform.create).toHaveBeenCalledTimes(1);
      expect(platform.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
        clientMessageId: 'tap-email:handoff:review-1',
      }));
      const sent = platform.sendMessage.mock.calls[0]?.[0] as { body: string };
      expect(sent.body).not.toContain(thread.subject);
      expect(sent.body).not.toContain(thread.messages.at(-1)?.bodyText);
      expect(receiptStorage.set).toHaveBeenCalledTimes(3);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('makes raw message sharing an explicit selected-message snapshot choice', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const platform = host();
    try {
      await act(async () => {
        root.render(
          <ConversationHandoffDialog
            idFactory={() => 'review-2'}
            onClose={() => undefined}
            onCompleted={() => undefined}
            onPhase={() => undefined}
            platform={platform.value as never}
            storage={storage() as never}
            thread={previewMailState().threads[0]!}
            workspaceId="workspace-1"
          />,
        );
      });
      const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
      const selectedMessages = dialog.querySelector<HTMLInputElement>(
        'input[name="handoff-content"]:not(:checked)',
      )!;
      const snapshot = dialog.querySelectorAll<HTMLInputElement>(
        'input[name="handoff-reference"]',
      )[1]!;
      await act(async () => {
        selectedMessages.click();
        snapshot.click();
      });
      expect(dialog.textContent).toContain('Messages to include');
      expect(dialog.textContent).toContain('Frozen snapshot copied');
      expect(dialog.querySelectorAll('[role="checkbox"]')).not.toHaveLength(1);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
