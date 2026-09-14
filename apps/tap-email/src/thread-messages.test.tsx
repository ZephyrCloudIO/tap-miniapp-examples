/** @rstest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, rstest as rs } from '@rstest/core';
import {
  emailThreadKey,
  mergeMailboxSnapshot,
  previewMailState,
  type EmailMessage,
} from './domain';
import { shouldEnterOpenReply } from './keybindings';
import {
  messageSnippet,
  scrollMessageVerticallyIntoView,
  splitPlainMessageQuotedText,
  ThreadMessageList,
} from './thread-messages';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const tinyPngBytes = Uint8Array.from(
  atob(tinyPngBase64),
  character => character.charCodeAt(0),
);

function participant(name: string, address = `${name.toLowerCase()}@example.com`) {
  return { name, address };
}

function message(
  messageId: string,
  from: string,
  sentAt: string,
  bodyText: string,
  bodyHtml?: string,
): EmailMessage {
  return {
    messageId,
    from: participant(from),
    to: [participant('Zack')],
    sentAt,
    bodyText,
    bodyHtml,
  };
}

const threeMessages = [
  message('message-1', 'Avery', '2026-09-12T13:00:00.000Z', 'First\n\nmessage'),
  message('message-2', 'Blair', '2026-09-12T14:00:00.000Z', 'Second message'),
  message('message-3', 'Casey', '2026-09-12T15:00:00.000Z', 'Latest message'),
] as const;

const defaultProps = {
  accountId: 'account-1',
  appTheme: 'dark' as const,
  attachmentExportSupported: true,
  imagesEnabled: true,
  loadAttachment: null,
  loadRemoteImages: async () => ({}),
  onKeyDown: () => undefined,
  saveAttachment: async () => 'saved' as const,
  threadId: 'thread-1',
  trackingPixelsEnabled: false,
};

async function mountMessages(
  messages: readonly EmailMessage[],
  key = 'thread-1',
  overrides: Partial<React.ComponentProps<typeof ThreadMessageList>> = {},
): Promise<{ container: HTMLDivElement; root: Root }> {
  const container = document.createElement('div');
  container.className = 'message-body';
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <ThreadMessageList
        {...defaultProps}
        {...overrides}
        key={key}
        messages={messages}
      />,
    );
  });
  return { container, root };
}

async function unmount(root: Root, container: HTMLElement): Promise<void> {
  await act(async () => root.unmount());
  container.remove();
}

function toggleButtons(container: ParentNode): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>('button.thread-message-toggle')];
}

describe('TAP Email thread message disclosure', () => {
  it('collapses thread history and leaves the latest message open', async () => {
    const { container, root } = await mountMessages(threeMessages);
    const buttons = toggleButtons(container);

    expect(buttons.map(button => button.getAttribute('aria-expanded')))
      .toEqual(['false', 'false', 'true']);
    expect(container.querySelectorAll('.thread-message-content')).toHaveLength(1);
    expect(container.querySelector('.thread-message-snippet')?.textContent)
      .toBe('First message');

    await unmount(root, container);
  });

  it('toggles messages independently and keeps keyboard activation out of global reply', async () => {
    const { container, root } = await mountMessages(threeMessages);
    const buttons = toggleButtons(container);
    let replyCommands = 0;
    const countReplyCommands = (event: KeyboardEvent) => {
      if (shouldEnterOpenReply(event, event.target, true)) replyCommands += 1;
    };
    document.addEventListener('keydown', countReplyCommands);

    await act(async () => buttons[0]?.click());
    expect(buttons[0]?.getAttribute('aria-expanded')).toBe('true');
    expect(buttons[1]?.getAttribute('aria-expanded')).toBe('false');
    expect(buttons[2]?.getAttribute('aria-expanded')).toBe('true');

    await act(async () => {
      buttons[0]?.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Enter',
      }));
    });
    expect(replyCommands).toBe(0);

    expect(buttons.every(button => button.type === 'button')).toBe(true);
    expect(buttons.every(button => button.hasAttribute('aria-expanded'))).toBe(true);

    document.removeEventListener('keydown', countReplyCommands);
    await unmount(root, container);
  });

  it('supports O for the active message and Shift+O for the whole thread', async () => {
    const { container, root } = await mountMessages(threeMessages);

    await act(async () => {
      root.render(
        <ThreadMessageList
          {...defaultProps}
          expansionRequest={{
            accountId: 'account-1',
            threadId: 'thread-1',
            action: 'toggle-active',
            requestId: 'toggle-latest',
          }}
          messages={threeMessages}
        />,
      );
    });
    expect(toggleButtons(container).map(button => button.getAttribute('aria-expanded')))
      .toEqual(['false', 'false', 'false']);

    await act(async () => toggleButtons(container)[0]?.click());
    await act(async () => {
      root.render(
        <ThreadMessageList
          {...defaultProps}
          expansionRequest={{
            accountId: 'account-1',
            threadId: 'thread-1',
            action: 'toggle-active',
            requestId: 'toggle-first',
          }}
          messages={threeMessages}
        />,
      );
    });
    expect(toggleButtons(container).map(button => button.getAttribute('aria-expanded')))
      .toEqual(['false', 'false', 'false']);

    await act(async () => {
      root.render(
        <ThreadMessageList
          {...defaultProps}
          expansionRequest={{
            accountId: 'account-1',
            threadId: 'thread-1',
            action: 'expand-all',
            requestId: 'expand-all',
          }}
          messages={threeMessages}
        />,
      );
    });
    expect(toggleButtons(container).map(button => button.getAttribute('aria-expanded')))
      .toEqual(['true', 'true', 'true']);

    await unmount(root, container);
  });

  it('does not construct a rich frame until its message is expanded', async () => {
    const richMessages = [
      message('rich-1', 'Avery', '2026-09-12T13:00:00.000Z', 'Earlier', '<p>Earlier rich message</p>'),
      message('rich-2', 'Blair', '2026-09-12T14:00:00.000Z', 'Latest', '<p>Latest rich message</p>'),
    ];
    const { container, root } = await mountMessages(richMessages);

    expect(container.querySelectorAll('iframe.rich-message-frame')).toHaveLength(1);
    await act(async () => toggleButtons(container)[0]?.click());
    expect(container.querySelectorAll('iframe.rich-message-frame')).toHaveLength(2);

    await unmount(root, container);
  });

  it('renders attachment controls after the message body without fetching bytes', async () => {
    const saveAttachment = rs.fn(async () => 'saved' as const);
    const richMessage = {
      ...message(
        'rich-attachment',
        'Avery',
        '2026-09-12T13:00:00.000Z',
        'Attached',
        '<p>Rich message</p>',
      ),
      attachments: [{
        resourceId: 'attachment_1',
        fileName: 'brief.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2_048,
        disposition: 'attachment' as const,
        contentId: null,
      }],
    };
    const { container, root } = await mountMessages(
      [richMessage],
      'thread-1',
      { saveAttachment },
    );
    const content = container.querySelector('.thread-message-content')!;
    const frame = content.querySelector<HTMLIFrameElement>('iframe.rich-message-frame')!;
    const attachments = content.querySelector('.message-attachments')!;

    expect(frame.compareDocumentPosition(attachments) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
    expect(frame.contentDocument?.querySelector('.message-attachments')).toBeNull();
    expect(saveAttachment).not.toHaveBeenCalled();

    await act(async () => attachments.querySelector<HTMLButtonElement>('button')?.click());
    expect(saveAttachment).toHaveBeenCalledTimes(1);

    await unmount(root, container);
  });

  it('loads an image preview with the exact message identity only after a click', async () => {
    const imageAttachment = {
      resourceId: 'image_1',
      fileName: 'image.png',
      mimeType: 'image/png',
      sizeBytes: tinyPngBytes.byteLength,
      disposition: 'inline' as const,
      contentId: 'image@example.com',
    };
    const imageMessage = {
      ...message(
        'message-with-image',
        'Avery',
        '2026-09-12T13:00:00.000Z',
        'Image attached',
      ),
      attachments: [imageAttachment],
    };
    const loadAttachment = rs.fn(async () => tinyPngBytes);
    const { container, root } = await mountMessages(
      [imageMessage],
      'thread-1',
      { loadAttachment },
    );

    expect(loadAttachment).not.toHaveBeenCalled();
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Preview image.png"]')?.click();
    });

    expect(loadAttachment).toHaveBeenCalledWith(
      {
        accountId: 'account-1',
        threadId: 'thread-1',
        messageId: 'message-with-image',
      },
      imageAttachment,
      { cacheMode: 'read-only' },
    );
    expect(document.body.querySelector('[role="dialog"] img')).not.toBeNull();
    await unmount(root, container);
  });

  it('keeps a rich frame and reader position mounted through summary merge and rehydration', async () => {
    const state = previewMailState();
    const hydratedThread = state.threads[0]!;
    const latestMessage = hydratedThread.messages.at(-1)!;
    const { container, root } = await mountMessages(hydratedThread.messages);
    const frame = container.querySelector<HTMLIFrameElement>('iframe.rich-message-frame');
    expect(frame).not.toBeNull();
    container.scrollTop = 275;

    const mergedState = mergeMailboxSnapshot(state, {
      schemaVersion: 1,
      accounts: structuredClone(state.accounts),
      threads: state.threads.map(item =>
        emailThreadKey(item) === emailThreadKey(hydratedThread)
          ? {
              ...structuredClone(item),
              unread: false,
              messages: [{ ...structuredClone(latestMessage), bodyHtml: undefined }],
            }
          : structuredClone(item),
      ),
    });
    const mergedThread = mergedState.threads.find(item =>
      emailThreadKey(item) === emailThreadKey(hydratedThread)
    )!;
    expect(mergedThread.messages).toBe(hydratedThread.messages);

    await act(async () => {
      root.render(
        <ThreadMessageList
          {...defaultProps}
          key="thread-1"
          messages={mergedThread.messages}
        />,
      );
    });

    expect(container.querySelector('iframe.rich-message-frame')).toBe(frame);
    expect(container.scrollTop).toBe(275);

    await act(async () => {
      root.render(
        <ThreadMessageList
          {...defaultProps}
          key="thread-1"
          messages={structuredClone(mergedThread.messages)}
        />,
      );
    });

    expect(container.querySelector('iframe.rich-message-frame')).toBe(frame);
    expect(container.scrollTop).toBe(275);

    await unmount(root, container);
  });

  it('keeps a single-message conversation expanded without a disclosure control', async () => {
    const { container, root } = await mountMessages([threeMessages[0]]);

    expect(toggleButtons(container)).toHaveLength(0);
    expect(container.querySelectorAll('.thread-message-content')).toHaveLength(1);
    expect(container.querySelector('.thread-message-toggle.is-static')).not.toBeNull();

    await unmount(root, container);
  });

  it('preserves explicit choices on refresh and opens a newly arrived latest message', async () => {
    const initialMessages = threeMessages.slice(0, 2);
    const { container, root } = await mountMessages(initialMessages);
    await act(async () => toggleButtons(container)[0]?.click());

    await act(async () => {
      root.render(
        <ThreadMessageList
          {...defaultProps}
          key="thread-1"
          messages={threeMessages}
        />,
      );
    });

    expect(toggleButtons(container).map(button => button.getAttribute('aria-expanded')))
      .toEqual(['true', 'false', 'true']);

    await unmount(root, container);
  });

  it('resets disclosure choices when the selected thread changes', async () => {
    const { container, root } = await mountMessages(threeMessages, 'thread-1');
    await act(async () => toggleButtons(container)[0]?.click());

    await act(async () => {
      root.render(
        <ThreadMessageList
          {...defaultProps}
          key="thread-2"
          messages={threeMessages}
          threadId="thread-2"
        />,
      );
    });

    expect(toggleButtons(container).map(button => button.getAttribute('aria-expanded')))
      .toEqual(['false', 'false', 'true']);

    await unmount(root, container);
  });

  it('anchors the latest message vertically without changing horizontal position', async () => {
    const originalBounds = HTMLElement.prototype.getBoundingClientRect;
    let latestMeasurementCount = 0;
    HTMLElement.prototype.getBoundingClientRect = function getTestBounds() {
      if (this.classList.contains('message-body')) {
        return DOMRect.fromRect({ x: 0, y: 0, width: 320, height: 300 });
      }
      if (this.getAttribute('aria-label') === 'Message from Casey') {
        latestMeasurementCount += 1;
        return DOMRect.fromRect({ x: 80, y: 500, width: 400, height: 100 });
      }
      return DOMRect.fromRect();
    };

    const { container, root } = await mountMessages(threeMessages);
    container.scrollTop = 0;
    container.scrollLeft = 41;
    // The mount effect measured once before scrollLeft was set; exercise the
    // helper directly to assert the horizontal invariant as well.
    const latestMessage = container.querySelector<HTMLElement>('[aria-label="Message from Casey"]')!;
    scrollMessageVerticallyIntoView(latestMessage);
    expect(container.scrollTop).toBe(300);
    expect(container.scrollLeft).toBe(41);
    const measurementsAfterAnchor = latestMeasurementCount;
    await act(async () => toggleButtons(container)[0]?.click());
    expect(latestMeasurementCount).toBe(measurementsAfterAnchor);

    await unmount(root, container);
    HTMLElement.prototype.getBoundingClientRect = originalBounds;
  });

  it('normalizes line breaks and repeated whitespace in compact snippets', () => {
    expect(messageSnippet(threeMessages[0])).toBe('First message');
  });

  it('bounds compact snippets so large messages do not remain in the row DOM', () => {
    const large = message(
      'large-message',
      'Avery',
      '2026-09-12T13:00:00.000Z',
      `Beginning ${'large message content '.repeat(30_000)}`,
    );
    const snippet = messageSnippet(large);

    expect(snippet.length).toBeLessThanOrEqual(240);
    expect(snippet.startsWith('Beginning large message content')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
  });

  it('folds recognized quoted suffixes in plain-text messages', async () => {
    const quotedMessage = message(
      'quoted-message',
      'Avery',
      '2026-09-12T13:00:00.000Z',
      'My current reply.\n\nOn Sep 12, 2026, at 8:00 AM, Blair wrote:\nEarlier reply text.',
    );
    const { container, root } = await mountMessages([quotedMessage]);
    const quoteToggle = container.querySelector<HTMLButtonElement>('.quoted-content-toggle');

    expect(splitPlainMessageQuotedText(quotedMessage.bodyText)).toEqual({
      current: 'My current reply.',
      quoted: 'On Sep 12, 2026, at 8:00 AM, Blair wrote:\nEarlier reply text.',
    });
    expect(quoteToggle?.getAttribute('aria-expanded')).toBe('false');
    expect(container.textContent).not.toContain('Earlier reply text.');

    await act(async () => quoteToggle?.click());
    expect(quoteToggle?.getAttribute('aria-expanded')).toBe('true');
    expect(container.textContent).toContain('Earlier reply text.');

    await unmount(root, container);
  });
});
