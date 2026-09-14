import type { MiniAppTheme } from '@theaiplatform/miniapp-sdk/web';
import { ChevronDown } from 'lucide-react';
import React, {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type Ref,
} from 'react';
import type {
  AttachmentMessageContext,
  RemoteImageMessageContext,
} from './coordinator-client';
import type {
  AttachmentExportPhase,
  AttachmentExportResult,
} from './attachment-export';
import type { EmailAttachment, EmailMessage } from './domain';
import {
  MessageAttachments,
  type AttachmentLoadOptions,
  type LoadMessageAttachment,
  type SaveMessageAttachment,
} from './message-attachments';
import { RichMessageBody } from './rich-message';

export type ContextualRemoteImageLoader = (
  context: RemoteImageMessageContext,
  urls: readonly string[],
) => Promise<Readonly<Record<string, string>>>;

export type ContextualAttachmentSaver = (
  context: AttachmentMessageContext,
  attachment: EmailAttachment,
  onPhase: (phase: AttachmentExportPhase) => void,
) => Promise<AttachmentExportResult>;

export type ContextualAttachmentLoader = (
  context: AttachmentMessageContext,
  attachment: EmailAttachment,
  options: AttachmentLoadOptions,
) => Promise<Uint8Array>;

interface CachedRichMessageBodyProps extends RemoteImageMessageContext {
  readonly appTheme: MiniAppTheme;
  readonly html: string;
  readonly imagesEnabled: boolean;
  readonly loadRemoteImages: ContextualRemoteImageLoader;
  readonly onKeyDown: (event: globalThis.KeyboardEvent) => void;
  readonly senderName: string;
  readonly trackingPixelsEnabled: boolean;
}

export interface ThreadMessageListProps {
  readonly accountId: string;
  readonly appTheme: MiniAppTheme;
  readonly attachmentExportSupported: boolean;
  readonly expansionRequest?: MessageExpansionRequest | null;
  readonly imagesEnabled: boolean;
  readonly loadAttachment: ContextualAttachmentLoader | null;
  readonly loadRemoteImages: ContextualRemoteImageLoader;
  readonly messages: readonly EmailMessage[];
  readonly onKeyDown: (event: globalThis.KeyboardEvent) => void;
  readonly saveAttachment: ContextualAttachmentSaver;
  readonly threadId: string;
  readonly trackingPixelsEnabled: boolean;
}

export interface MessageExpansionRequest {
  readonly accountId: string;
  readonly threadId: string;
  readonly action: 'toggle-active' | 'expand-all';
  readonly requestId: string;
}

interface ThreadMessageCardProps extends Omit<ThreadMessageListProps, 'messages'> {
  readonly collapsible: boolean;
  readonly expanded: boolean;
  readonly message: EmailMessage;
  readonly onToggle: (messageId: string) => void;
  readonly sectionRef?: Ref<HTMLElement>;
}

interface MessageHeaderContentProps {
  readonly expanded: boolean;
  readonly message: EmailMessage;
  readonly showToggle: boolean;
}

interface PlainMessageBodyProps {
  readonly bodyText: string;
}

const messageDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
const maximumMessageSnippetLength = 240;
const plainQuotedMessageMarker = /^(?:On .{1,500} wrote:|-----Original Message-----)\s*$/gimu;

function displayName(message: EmailMessage): string {
  return message.from.name || message.from.address || 'Unknown sender';
}

function recipientLabel(message: EmailMessage): string {
  const recipients = message.to
    .map(recipient => recipient.name || recipient.address)
    .filter(Boolean);
  if (recipients.length === 0) return '';
  const visibleRecipients = recipients.slice(0, 3).join(', ');
  const hiddenCount = recipients.length - 3;
  return `to ${visibleRecipients}${hiddenCount > 0 ? ` +${hiddenCount}` : ''}`;
}

export function messageSnippet(message: EmailMessage): string {
  const normalized = message.bodyText.replace(/\s+/gu, ' ').trim();
  if (!normalized) return 'No message content';
  if (normalized.length <= maximumMessageSnippetLength) return normalized;
  return `${normalized.slice(0, maximumMessageSnippetLength - 1).trimEnd()}…`;
}

export function splitPlainMessageQuotedText(
  bodyText: string,
): { readonly current: string; readonly quoted: string } | null {
  plainQuotedMessageMarker.lastIndex = 0;
  const marker = plainQuotedMessageMarker.exec(bodyText);
  if (!marker) return null;
  const current = bodyText.slice(0, marker.index).trimEnd();
  const quoted = bodyText.slice(marker.index).trim();
  return current && quoted ? { current, quoted } : null;
}

/** Bring a message into the reader without letting scrollIntoView pan the app horizontally. */
export function scrollMessageVerticallyIntoView(message: HTMLElement): void {
  const reader = message.closest<HTMLElement>('.message-body');
  if (!reader) return;
  const messageBounds = message.getBoundingClientRect();
  const readerBounds = reader.getBoundingClientRect();
  const delta = messageBounds.top < readerBounds.top
    ? messageBounds.top - readerBounds.top
    : messageBounds.bottom > readerBounds.bottom
      ? messageBounds.bottom - readerBounds.bottom
      : 0;
  if (delta !== 0) reader.scrollTop += delta;
}

function PlainMessageBody({ bodyText }: PlainMessageBodyProps) {
  const parts = splitPlainMessageQuotedText(bodyText);
  const [quotedTextExpanded, setQuotedTextExpanded] = useState(false);
  if (!parts) return <p className="plain-message-body">{bodyText}</p>;
  return (
    <div className="plain-message-with-quote">
      <p className="plain-message-body">{parts.current}</p>
      <button
        aria-expanded={quotedTextExpanded}
        className="quoted-content-toggle"
        onClick={() => setQuotedTextExpanded(expanded => !expanded)}
        type="button"
      >
        {quotedTextExpanded ? 'Hide quoted text' : 'Show quoted text'}
      </button>
      {quotedTextExpanded ? (
        <p className="plain-message-body plain-message-quote">{parts.quoted}</p>
      ) : null}
    </div>
  );
}

function CachedRichMessageBody({
  accountId,
  appTheme,
  html,
  imagesEnabled,
  loadRemoteImages,
  messageId,
  onKeyDown,
  senderName,
  threadId,
  trackingPixelsEnabled,
}: CachedRichMessageBodyProps) {
  const loadMessageImages = useCallback(
    (urls: readonly string[]) => loadRemoteImages(
      { accountId, threadId, messageId },
      urls,
    ),
    [accountId, loadRemoteImages, messageId, threadId],
  );
  return (
    <RichMessageBody
      html={html}
      imagesEnabled={imagesEnabled}
      loadRemoteImages={loadMessageImages}
      onKeyDown={onKeyDown}
      theme={appTheme}
      title={`Rich email from ${senderName}`}
      trackingPixelsEnabled={trackingPixelsEnabled}
    />
  );
}

function MessageHeaderContent({
  expanded,
  message,
  showToggle,
}: MessageHeaderContentProps) {
  const senderName = displayName(message);
  return (
    <>
      {expanded ? (
        <span className="thread-message-avatar" aria-hidden="true">
          {senderName.slice(0, 1).toUpperCase()}
        </span>
      ) : null}
      <span className="thread-message-sender">{senderName}</span>
      {expanded ? (
        <span className="thread-message-recipients">{recipientLabel(message)}</span>
      ) : (
        <span className="thread-message-snippet">{messageSnippet(message)}</span>
      )}
      <time className="thread-message-date" dateTime={message.sentAt}>
        {messageDateFormatter.format(new Date(message.sentAt))}
      </time>
      {showToggle ? (
        <span className="thread-message-chevron" aria-hidden="true">
          <ChevronDown />
        </span>
      ) : null}
    </>
  );
}

function ThreadMessageCard({
  accountId,
  appTheme,
  attachmentExportSupported,
  collapsible,
  expanded,
  imagesEnabled,
  loadAttachment,
  loadRemoteImages,
  message,
  onKeyDown,
  onToggle,
  saveAttachment,
  sectionRef,
  threadId,
  trackingPixelsEnabled,
}: ThreadMessageCardProps) {
  const contentId = useId();
  const senderName = displayName(message);
  const toggle = () => onToggle(message.messageId);
  const saveMessageAttachment = useCallback<SaveMessageAttachment>(
    (attachment, onPhase) => saveAttachment(
      { accountId, threadId, messageId: message.messageId },
      attachment,
      onPhase,
    ),
    [accountId, message.messageId, saveAttachment, threadId],
  );
  const loadMessageAttachment = useCallback<LoadMessageAttachment>(
    (attachment, options) => {
      if (!loadAttachment) {
        return Promise.reject(new Error('Attachment preview is unavailable.'));
      }
      return loadAttachment(
        { accountId, threadId, messageId: message.messageId },
        attachment,
        options,
      );
    },
    [accountId, loadAttachment, message.messageId, threadId],
  );
  const className = `thread-message${expanded ? ' is-expanded' : ' is-collapsed'}`;

  return (
    <section className={className} aria-label={`Message from ${senderName}`} ref={sectionRef}>
      {collapsible ? (
        <button
          aria-controls={contentId}
          aria-expanded={expanded}
          className="thread-message-toggle"
          onClick={event => {
            event.stopPropagation();
            toggle();
          }}
          type="button"
        >
          <MessageHeaderContent expanded={expanded} message={message} showToggle />
        </button>
      ) : (
        <div className="thread-message-toggle is-static">
          <MessageHeaderContent expanded message={message} showToggle={false} />
        </div>
      )}
      {expanded ? (
        <div className="thread-message-content" id={contentId}>
          {message.bodyHtml ? (
            <CachedRichMessageBody
              accountId={accountId}
              appTheme={appTheme}
              html={message.bodyHtml}
              imagesEnabled={imagesEnabled}
              loadRemoteImages={loadRemoteImages}
              messageId={message.messageId}
              onKeyDown={onKeyDown}
              senderName={senderName}
              threadId={threadId}
              trackingPixelsEnabled={trackingPixelsEnabled}
            />
          ) : (
            <PlainMessageBody bodyText={message.bodyText} />
          )}
          <MessageAttachments
            attachments={message.attachments ?? []}
            exportSupported={attachmentExportSupported}
            onLoadAttachment={loadAttachment ? loadMessageAttachment : null}
            onSaveAttachment={saveMessageAttachment}
          />
        </div>
      ) : null}
    </section>
  );
}

/**
 * Keeps user toggles local to the selected conversation. Callers key this component
 * by account/thread so opening a different conversation restores the familiar
 * “latest open, history collapsed” starting point. On an in-place refresh, existing
 * choices survive while a newly arrived last message opens automatically.
 */
export function ThreadMessageList({
  accountId,
  appTheme,
  attachmentExportSupported,
  expansionRequest,
  imagesEnabled,
  loadAttachment,
  loadRemoteImages,
  messages,
  onKeyDown,
  saveAttachment,
  threadId,
  trackingPixelsEnabled,
}: ThreadMessageListProps) {
  const [expansionOverrides, setExpansionOverrides] = useState<Readonly<Record<string, boolean>>>({});
  const latestMessageId = messages.at(-1)?.messageId ?? null;
  const [activeMessageId, setActiveMessageId] = useState<string | null>(latestMessageId);
  const latestMessageRef = useRef<HTMLElement>(null);
  const processedExpansionRequestId = useRef<string | null>(null);
  const collapsible = messages.length > 1;
  const toggleMessage = useCallback((messageId: string) => {
    setActiveMessageId(messageId);
    setExpansionOverrides(current => ({
      ...current,
      [messageId]: !(current[messageId] ?? messageId === latestMessageId),
    }));
  }, [latestMessageId]);

  useEffect(() => {
    setActiveMessageId(latestMessageId);
  }, [latestMessageId]);

  useEffect(() => {
    if (
      !expansionRequest ||
      expansionRequest.accountId !== accountId ||
      expansionRequest.threadId !== threadId ||
      processedExpansionRequestId.current === expansionRequest.requestId
    ) return;
    processedExpansionRequestId.current = expansionRequest.requestId;
    if (expansionRequest.action === 'expand-all') {
      setExpansionOverrides(Object.fromEntries(
        messages.map(message => [message.messageId, true]),
      ));
      return;
    }
    const targetMessageId = activeMessageId ?? latestMessageId;
    if (!targetMessageId) return;
    setExpansionOverrides(current => ({
      ...current,
      [targetMessageId]: !(current[targetMessageId] ?? targetMessageId === latestMessageId),
    }));
  }, [
    accountId,
    activeMessageId,
    expansionRequest,
    latestMessageId,
    messages,
    threadId,
  ]);

  useEffect(() => {
    const latestMessage = latestMessageRef.current;
    if (!collapsible || !latestMessage) return;
    scrollMessageVerticallyIntoView(latestMessage);
  }, [collapsible, latestMessageId]);

  return messages.map(message => (
    <ThreadMessageCard
      accountId={accountId}
      appTheme={appTheme}
      attachmentExportSupported={attachmentExportSupported}
      collapsible={collapsible}
      expanded={!collapsible || (expansionOverrides[message.messageId] ?? message.messageId === latestMessageId)}
      imagesEnabled={imagesEnabled}
      key={message.messageId}
      loadAttachment={loadAttachment}
      loadRemoteImages={loadRemoteImages}
      message={message}
      onKeyDown={onKeyDown}
      onToggle={toggleMessage}
      saveAttachment={saveAttachment}
      sectionRef={message.messageId === latestMessageId ? latestMessageRef : undefined}
      threadId={threadId}
      trackingPixelsEnabled={trackingPixelsEnabled}
    />
  ));
}
