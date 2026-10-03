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
import { ConversationReaderDeck } from './conversation-reader-deck';
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
  it('does no HTML parsing across ten unchanged parent renders and still responds to rendering policy changes', async () => {
    const messages = [message('html-only', 'Avery', '2026-09-12T13:00:00Z', '', '<p>HTML-only body</p>')];
    const parse = rs.spyOn(DOMParser.prototype, 'parseFromString');
    const { root, container } = await mountMessages(messages, 'thread-1', { htmlEnabled: false });
    try {
      parse.mockClear();
      for (let index = 0; index < 10; index++) {
        await act(async () => root.render(<ThreadMessageList {...defaultProps} key="thread-1" messages={messages} htmlEnabled={false} />));
      }
      expect(parse).not.toHaveBeenCalled();
      expect(container.textContent).toContain('HTML-only body');
      await act(async () => root.render(<ThreadMessageList {...defaultProps} key="thread-1" messages={messages} htmlEnabled />));
      expect(container.querySelector('iframe.rich-message-frame')).not.toBeNull();
    } finally { await unmount(root, container); parse.mockRestore(); }
  });

  it('does not reparse an unchanged expanded sibling when another message opens', async () => {
    const messages = [
      message('first', 'Avery', '2026-09-12T13:00:00Z', 'First body'),
      message('last', 'Casey', '2026-09-12T14:00:00Z', '', '<p>HTML-only sibling</p>'),
    ];
    const parse = rs.spyOn(DOMParser.prototype, 'parseFromString');
    const { root, container } = await mountMessages(messages, 'thread-1', { htmlEnabled: false });
    try {
      parse.mockClear();
      await act(async () => toggleButtons(container)[0]!.click());
      expect(container.textContent).toContain('First body');
      expect(container.textContent).toContain('HTML-only sibling');
      expect(parse).not.toHaveBeenCalled();
      const changed = [...messages.slice(0, 1), { ...messages[1]!, bodyHtml: '<p>Updated sibling</p>' }];
      await act(async () => root.render(<ThreadMessageList {...defaultProps} messages={changed} htmlEnabled={false} />));
      expect(container.textContent).toContain('Updated sibling');
      expect(parse).toHaveBeenCalled();
    } finally { await unmount(root, container); parse.mockRestore(); }
  });

  it('appends and expands an outgoing reply with delivery status, sender details and attachments', async () => {
    const outgoing = {
      message: message('outgoing:draft_1', 'Zack', '2026-09-12T16:00:00.000Z', 'My pending reply'),
      status: 'sending' as const, cc: 'team@example.com', bcc: 'private@example.com',
      attachments: [{ stageId: 'stage_1', fileName: 'notes.pdf', mimeType: 'application/pdf', sizeBytes: 123, sha256Base64Url: 'a'.repeat(43) }],
    };
    const { container, root } = await mountMessages(threeMessages, 'thread-1', { outgoingMessages: [outgoing], unread: true });
    try {
      const cards = [...container.querySelectorAll('.thread-message')];
      const last = cards.at(-1)!;
      expect(cards).toHaveLength(4);
      expect(last.classList.contains('is-expanded')).toBe(true);
      expect(last.classList.contains('is-unread')).toBe(false);
      expect(last.textContent).toContain('Sending…');
      expect(last.textContent).toContain('My pending reply');
      expect(last.textContent).toContain('notes.pdf');
      await act(async () => last.querySelector<HTMLButtonElement>('.thread-message-sender-toggle')!.click());
      expect(last.textContent).toContain('team@example.com');
      expect(last.textContent).toContain('private@example.com');
      await act(async () => root.render(<ThreadMessageList {...defaultProps} messages={threeMessages} outgoingMessages={[{ ...outgoing, status: 'failed' }]} />));
      expect(container.querySelector('.is-outgoing')?.textContent).toContain('Not sent');
      expect(container.querySelector('.is-outgoing')?.textContent).toContain('My pending reply');
    } finally { await unmount(root, container); }
  });

  it('shows full sender, recipients and timestamp without collapsing the message', async () => {
    const detailedMessage = {
      ...threeMessages[2],
      to: [participant('Zack'), participant('Blair'), participant('Avery'), participant('', 'team@example.com')],
      cc: [participant('Iman')],
    };
    const { container, root } = await mountMessages([...threeMessages.slice(0, 2), detailedMessage]);
    const sender = container.querySelector<HTMLButtonElement>('.thread-message-sender-toggle')!;
    expect(sender.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('.thread-message-details')).toBeNull();

    await act(async () => sender.click());
    const details = container.querySelector('.thread-message-details')!;
    expect(sender.getAttribute('aria-expanded')).toBe('true');
    expect(sender.getAttribute('aria-controls')).toBe(details.id);
    expect(details.textContent).toContain('Casey <casey@example.com>');
    expect(details.textContent).toContain('Zack <zack@example.com>');
    expect(details.textContent).toContain('team@example.com');
    expect([...details.querySelectorAll('dt')].map(item => item.textContent)).toContain('Cc');
    expect(details.textContent).toContain('Iman <iman@example.com>');
    expect(details.querySelector('time')?.getAttribute('datetime')).toBe(detailedMessage.sentAt);
    expect(details.querySelector('time')?.textContent).toContain('2026');
    expect(container.querySelector('.thread-message-content')?.textContent).toContain('Latest message');
    expect(toggleButtons(container).map(button => button.getAttribute('aria-expanded'))).toEqual(['false', 'false', 'true']);
    expect(container.querySelector('button button')).toBeNull();

    await act(async () => sender.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(sender.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('.thread-message-details')).toBeNull();
    await unmount(root, container);
  });

  it('offers sender details in a single-message conversation with no named recipients', async () => {
    const { container, root } = await mountMessages([{ ...threeMessages[0], to: [] }]);
    const sender = container.querySelector<HTMLButtonElement>('.thread-message-sender-toggle')!;
    await act(async () => sender.click());
    expect(container.querySelector('.thread-message-details')?.textContent).toContain('Undisclosed recipients');
    expect(toggleButtons(container)).toHaveLength(0);
    await act(async () => sender.click());
    expect(container.querySelector('.thread-message-details')).toBeNull();
    await unmount(root, container);
  });

  it('accents only the latest message of an unread conversation and clears it when read', async () => {
    const { container, root } = await mountMessages(threeMessages, 'thread-1', { unread: true });
    expect(container.querySelectorAll('.thread-message.is-unread')).toHaveLength(1);
    expect(container.querySelector('.thread-message.is-unread')?.getAttribute('aria-label')).toBe('Message from Casey');
    await act(async () => toggleButtons(container)[0]?.click());
    expect(container.querySelectorAll('.thread-message.is-expanded')).toHaveLength(2);
    expect(container.querySelectorAll('.thread-message.is-unread')).toHaveLength(1);
    await act(async () => root.render(<ThreadMessageList {...defaultProps} key="thread-1" messages={threeMessages} unread={false} />));
    expect(container.querySelector('.thread-message.is-unread')).toBeNull();
    expect(container.querySelectorAll('.thread-message.is-expanded')).toHaveLength(2);
    await unmount(root, container);
  });

  it('removes the HTML frame and skips remote content when HTML is disabled', async () => {
    const loadRemoteImages = rs.fn(async () => ({}));
    const messages = [message('html-only', 'Avery', '2026-09-12T13:00:00.000Z', '',
      '<p>HTML-only message</p><img src="https://sender.test/image.png"><script>bad()</script>')];
    const { container, root } = await mountMessages(messages, 'html-only', {
      htmlEnabled: false, scriptsEnabled: true, loadRemoteImages,
    });
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('.plain-message-body')?.textContent).toBe('HTML-only message');
    expect(loadRemoteImages).not.toHaveBeenCalled();
    await act(async () => root.render(<ThreadMessageList {...defaultProps} messages={messages} scriptsEnabled={false} />));
    expect(container.querySelector('iframe')).not.toBeNull();
    await act(async () => root.render(<ThreadMessageList {...defaultProps} messages={messages} htmlEnabled={false} />));
    expect(container.querySelector('iframe')).toBeNull();
    await unmount(root, container);
  });

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

    buttons[0]?.focus();
    await act(async () => buttons[0]?.click());
    expect(document.activeElement).toBe(buttons[0]);
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
    expect(container.scrollTop).toBe(500);
    expect(container.scrollLeft).toBe(41);
    const measurementsAfterAnchor = latestMeasurementCount;
    await act(async () => toggleButtons(container)[0]?.click());
    expect(latestMeasurementCount).toBe(measurementsAfterAnchor);

    await unmount(root, container);
    HTMLElement.prototype.getBoundingClientRect = originalBounds;
  });

  it('resets tall single-message readers on every warm activation without remounting their frames', async () => {
    const single = [message('single', 'Avery', '2026-09-12T13:00:00Z', '', '<p>A tall newsletter</p>')];
    const container = document.createElement('div'); container.className = 'message-body'; document.body.append(container);
    const root = createRoot(container);
    const render = (activeKey: string) => <ConversationReaderDeck activeKey={activeKey} warmKeys={['A', 'B']}>
      {(key, active) => <ThreadMessageList {...defaultProps} active={active} threadId={key} messages={single} />}
    </ConversationReaderDeck>;
    try {
      await act(async () => root.render(render('A')));
      const frames = [...container.querySelectorAll('iframe')];
      expect(frames).toHaveLength(2);
      for (let index = 0; index < 10; index++) {
        container.scrollTop = 750 + index;
        container.scrollLeft = 41;
        await act(async () => root.render(render(index % 2 ? 'A' : 'B')));
        expect(container.scrollTop).toBe(0);
        expect(container.scrollLeft).toBe(41);
        expect([...container.querySelectorAll('iframe')]).toEqual(frames);
      }
    } finally { await unmount(root, container); }
  });

  it('opens the first unread header and all unread messages, then keeps that entry during mark-read and refresh', async () => {
    const originalBounds = HTMLElement.prototype.getBoundingClientRect;
    const messages = threeMessages.map((message, index) => ({ ...message, unread: index > 0 }));
    HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.classList.contains('message-body')) return DOMRect.fromRect({ y: 100, height: 300 });
      const index = ['Avery', 'Blair', 'Casey'].findIndex(name => this.getAttribute('aria-label') === `Message from ${name}`);
      return DOMRect.fromRect({ y: 100 + index * 200 - (this.closest<HTMLElement>('.message-body')?.scrollTop ?? 0), height: 1600 });
    };
    const { container, root } = await mountMessages(messages, 'thread-1', { unread: true });
    try {
      expect(toggleButtons(container).map(button => button.getAttribute('aria-expanded'))).toEqual(['false', 'true', 'true']);
      expect(container.scrollTop).toBe(200);
      container.scrollTop = 275;
      container.dispatchEvent(new Event('scroll'));
      await act(async () => root.render(<ThreadMessageList {...defaultProps} key="thread-1" unread={false}
        messages={messages.map(message => ({ ...message, unread: false }))} />));
      expect(container.scrollTop).toBe(275);
      expect(toggleButtons(container).map(button => button.getAttribute('aria-expanded'))).toEqual(['false', 'true', 'true']);
      await act(async () => root.render(<ThreadMessageList {...defaultProps} key="thread-1" unread={false} active={false} messages={messages} />));
      container.scrollTop = 700;
      await act(async () => root.render(<ThreadMessageList {...defaultProps} key="thread-1" unread={false} active messages={messages} />));
      expect(container.scrollTop).toBe(400); // Read thread returns to latest header.
    } finally { await unmount(root, container); HTMLElement.prototype.getBoundingClientRect = originalBounds; }
  });

  it('waits for hydrated messages before freezing the first-unread entry', async () => {
    const messages = threeMessages.map((message, index) => ({ ...message, unread: index > 0 }));
    const { container, root } = await mountMessages([messages[2]!], 'thread-1', { unread: true, positionReady: false });
    try {
      await act(async () => root.render(<ThreadMessageList {...defaultProps} key="thread-1" unread={false} positionReady messages={messages} />));
      expect(toggleButtons(container).map(button => button.getAttribute('aria-expanded'))).toEqual(['false', 'true', 'true']);
      // Enter toggles the first unread, even after the thread-level flag cleared.
      await act(async () => root.render(<ThreadMessageList {...defaultProps} key="thread-1" messages={messages} expansionRequest={{
        accountId: 'account-1', threadId: 'thread-1', action: 'toggle-active', requestId: 'first-unread',
      }} />));
      expect(toggleButtons(container).map(button => button.getAttribute('aria-expanded'))).toEqual(['false', 'false', 'true']);
    } finally { await unmount(root, container); }
  });

  it('does not override user scrolling when delayed bodies establish the entry', async () => {
    const messages = threeMessages.map((message, index) => ({ ...message, unread: index > 0 }));
    const { container, root } = await mountMessages([messages[2]!], 'thread-1', { unread: true, positionReady: false });
    try {
      container.dispatchEvent(new WheelEvent('wheel'));
      container.scrollTop = 325;
      await act(async () => root.render(<ThreadMessageList {...defaultProps} key="thread-1" unread positionReady messages={messages} />));
      expect(container.scrollTop).toBe(325);
    } finally { await unmount(root, container); }
  });

  it('does not let an inactive hydrated reader alter the shared panel', async () => {
    const { container, root } = await mountMessages(threeMessages, 'thread-1', { active: false });
    try {
      container.scrollTop = 840;
      await act(async () => root.render(<ThreadMessageList {...defaultProps} active={false} messages={structuredClone(threeMessages)} />));
      expect(container.scrollTop).toBe(840);
    } finally { await unmount(root, container); }
  });

  it('corrects late layout growth until user scrolling, and disconnects on deactivation', async () => {
    const originalObserver = globalThis.ResizeObserver;
    const originalBounds = HTMLElement.prototype.getBoundingClientRect;
    let resize = () => {};
    let precedingHeight = 400;
    let disconnects = 0;
    globalThis.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) { resize = () => callback([], this); }
      observe() {} unobserve() {} disconnect() { disconnects++; }
    } as typeof ResizeObserver;
    HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.classList.contains('message-body')) return DOMRect.fromRect({ y: 100, height: 300 });
      return DOMRect.fromRect({ y: 100 + precedingHeight - (this.closest<HTMLElement>('.message-body')?.scrollTop ?? 0), height: 1200 });
    };
    const { container, root } = await mountMessages(threeMessages);
    try {
      expect(container.scrollTop).toBe(400);
      precedingHeight = 650;
      resize();
      expect(container.scrollTop).toBe(650);
      container.dispatchEvent(new WheelEvent('wheel'));
      container.scrollTop = 900;
      precedingHeight = 1000;
      resize();
      expect(container.scrollTop).toBe(900);
      await act(async () => root.render(<ThreadMessageList {...defaultProps} active={false} messages={threeMessages} />));
      expect(disconnects).toBeGreaterThan(0);
      resize();
      expect(container.scrollTop).toBe(900);
    } finally { await unmount(root, container); globalThis.ResizeObserver = originalObserver; HTMLElement.prototype.getBoundingClientRect = originalBounds; }
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
