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
import type { EmailAttachment, EmailMessage, EmailParticipant } from './domain';
import {
  MessageAttachments,
  type AttachmentLoadOptions,
  type LoadMessageAttachment,
  type SaveMessageAttachment,
} from './message-attachments';
import { plainTextFromRichMessage, RichMessageBody } from './rich-message';
import type { OutgoingThreadMessage } from './outgoing-messages';

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
  readonly mobile?: boolean;
  readonly appTheme: MiniAppTheme;
  readonly html: string;
  readonly scriptsEnabled?: boolean;
  readonly imagesEnabled: boolean;
  readonly loadRemoteImages: ContextualRemoteImageLoader;
  readonly onKeyDown: (event: globalThis.KeyboardEvent) => void;
  readonly senderName: string;
  readonly trackingPixelsEnabled: boolean;
}

export interface ThreadMessageListProps {
  readonly mobile?: boolean;
  readonly accountId: string;
  readonly appTheme: MiniAppTheme;
  readonly attachmentExportSupported: boolean;
  readonly expansionRequest?: MessageExpansionRequest | null;
  readonly htmlEnabled?: boolean;
  readonly scriptsEnabled?: boolean;
  readonly imagesEnabled: boolean;
  readonly loadAttachment: ContextualAttachmentLoader | null;
  readonly loadRemoteImages: ContextualRemoteImageLoader;
  readonly messages: readonly EmailMessage[];
  readonly outgoingMessages?: readonly OutgoingThreadMessage[];
  readonly onKeyDown: (event: globalThis.KeyboardEvent) => void;
  readonly saveAttachment: ContextualAttachmentSaver;
  readonly threadId: string;
  readonly trackingPixelsEnabled: boolean;
  readonly unread?: boolean;
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
  readonly outgoing?: OutgoingThreadMessage;
  readonly onToggle: (messageId: string) => void;
  readonly sectionRef?: Ref<HTMLElement>;
}

interface MessageDateProps {
  readonly mobile?: boolean;
  readonly message: EmailMessage;
  readonly outgoing?: OutgoingThreadMessage;
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
const messageTimeFormatter = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const messageDayFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const messageDetailsDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'full',
  timeStyle: 'long',
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
  mobile,
  accountId,
  appTheme,
  html,
  imagesEnabled,
  scriptsEnabled = true,
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
      mobile={mobile}
      html={html}
      imagesEnabled={imagesEnabled}
      scriptsEnabled={scriptsEnabled}
      loadRemoteImages={loadMessageImages}
      onKeyDown={onKeyDown}
      theme={appTheme}
      title={`Rich email from ${senderName}`}
      trackingPixelsEnabled={trackingPixelsEnabled}
    />
  );
}

function MessageDate({
  mobile = false,
  message,
  outgoing,
}: MessageDateProps) {
  if (outgoing) {
    const labels = { sending: 'Sending…', delayed: 'Send delayed', failed: 'Not sent', uncertain: 'Delivery unknown', sent: 'Sent' };
    return <span className={`thread-message-delivery is-${outgoing.status}`} role="status">{labels[outgoing.status]}</span>;
  }
  const sent = new Date(message.sentAt);
  const compactDate = (sent.toDateString() === new Date().toDateString()
    ? messageTimeFormatter : messageDayFormatter).format(sent);
  return <time className="thread-message-date" dateTime={message.sentAt} title={messageDetailsDateFormatter.format(sent)}>
    {mobile ? compactDate : messageDateFormatter.format(sent)}
  </time>;
}

function ParticipantDetails({ participant }: { readonly participant: EmailParticipant }) {
  return <span className="thread-message-address">
    {participant.name ? <span>{participant.name} </span> : null}
    {participant.address ? <span className="thread-message-address-email">
      {participant.name ? `<${participant.address}>` : participant.address}
    </span> : null}
  </span>;
}

function ThreadMessageCard({
  mobile,
  htmlEnabled = true,
  accountId,
  appTheme,
  attachmentExportSupported,
  collapsible,
  expanded,
  imagesEnabled,
  scriptsEnabled = true,
  loadAttachment,
  loadRemoteImages,
  message,
  outgoing,
  onKeyDown,
  onToggle,
  saveAttachment,
  sectionRef,
  threadId,
  trackingPixelsEnabled,
  unread = false,
}: ThreadMessageCardProps) {
  const contentId = useId();
  const detailsId = useId();
  const [detailsExpanded, setDetailsExpanded] = useState(false);
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
  const className = `thread-message${expanded ? ' is-expanded' : ' is-collapsed'}${unread ? ' is-unread' : ''}${outgoing ? ' is-outgoing' : ''}`;

  return (
    <section className={className} aria-label={`Message from ${senderName}`} ref={sectionRef}>
      <div className="thread-message-header">
        {expanded ? (
          <button
            aria-controls={detailsId}
            aria-expanded={detailsExpanded}
            aria-label={`Message details for ${senderName}`}
            className="thread-message-sender-toggle"
            onClick={() => setDetailsExpanded(current => !current)}
            onKeyDown={event => {
              if (event.key === 'Escape' && detailsExpanded) {
                event.stopPropagation();
                setDetailsExpanded(false);
              }
            }}
            type="button"
          >
            {mobile ? <span className="thread-message-avatar" aria-hidden="true">{senderName.slice(0, 1).toUpperCase()}</span> : null}
            <span className="thread-message-sender">{senderName}</span>
            <span className="thread-message-recipients">{recipientLabel(message)}</span>
            <ChevronDown className="thread-message-details-chevron" aria-hidden="true" />
          </button>
        ) : null}
        {collapsible ? (
          <button
            aria-controls={contentId}
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} message from ${senderName}`}
            className="thread-message-toggle"
            onClick={event => {
              event.stopPropagation();
              toggle();
            }}
            type="button"
          >
            {!expanded ? <>
              <span className="thread-message-sender">{senderName}</span>
              <span className="thread-message-snippet">{messageSnippet(message)}</span>
            </> : null}
            <MessageDate mobile={mobile} message={message} outgoing={outgoing} />
            <span className="thread-message-chevron" aria-hidden="true"><ChevronDown /></span>
          </button>
        ) : <div className="thread-message-toggle is-static"><MessageDate mobile={mobile} message={message} outgoing={outgoing} /></div>}
      </div>
      {expanded ? (
        <div className="thread-message-content" id={contentId}>
          {detailsExpanded ? <dl className="thread-message-details" id={detailsId}>
            <dt>From</dt><dd><ParticipantDetails participant={message.from} /></dd>
            <dt>To</dt><dd>{message.to.length > 0 ? message.to.map((recipient, index) => (
              <ParticipantDetails key={`${recipient.address}-${index}`} participant={recipient} />
            )) : 'Undisclosed recipients'}</dd>
            {outgoing?.cc ? <><dt>Cc</dt><dd>{outgoing.cc}</dd></> : null}
            {outgoing?.bcc ? <><dt>Bcc</dt><dd>{outgoing.bcc}</dd></> : null}
            <dt>Date</dt><dd><time dateTime={message.sentAt}>{messageDetailsDateFormatter.format(new Date(message.sentAt))}</time></dd>
          </dl> : null}
          {htmlEnabled && message.bodyHtml ? (
            <CachedRichMessageBody
              mobile={mobile}
              accountId={accountId}
              appTheme={appTheme}
              html={message.bodyHtml}
              imagesEnabled={imagesEnabled}
              scriptsEnabled={scriptsEnabled}
              loadRemoteImages={loadRemoteImages}
              messageId={message.messageId}
              onKeyDown={onKeyDown}
              senderName={senderName}
              threadId={threadId}
              trackingPixelsEnabled={trackingPixelsEnabled}
            />
          ) : (
            <PlainMessageBody bodyText={message.bodyText.trim() ? message.bodyText : plainTextFromRichMessage(message.bodyHtml ?? '')} />
          )}
          <MessageAttachments
            attachments={message.attachments ?? []}
            exportSupported={attachmentExportSupported}
            onLoadAttachment={loadAttachment ? loadMessageAttachment : null}
            onSaveAttachment={saveMessageAttachment}
          />
          {outgoing?.attachments.length ? <ul className="outgoing-message-attachments" aria-label="Outgoing attachments">
            {outgoing.attachments.map(attachment => <li key={attachment.stageId}>{attachment.fileName}</li>)}
          </ul> : null}
          {outgoing && ['delayed', 'failed', 'uncertain'].includes(outgoing.status) ? (
            <p className="thread-message-delivery-note">{outgoing.status === 'failed'
              ? 'This reply was not sent. Review it in Outbox.'
              : 'Delivery has not been confirmed. Review its status in Outbox.'}</p>
          ) : null}
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
  mobile,
  accountId,
  appTheme,
  attachmentExportSupported,
  expansionRequest,
  htmlEnabled = true,
  imagesEnabled,
  scriptsEnabled = true,
  loadAttachment,
  loadRemoteImages,
  messages: providerMessages,
  outgoingMessages = [],
  onKeyDown,
  saveAttachment,
  threadId,
  trackingPixelsEnabled,
  unread = false,
}: ThreadMessageListProps) {
  const messages = [...providerMessages, ...outgoingMessages.map(item => item.message)];
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
      mobile={mobile}
      htmlEnabled={htmlEnabled}
      accountId={accountId}
      appTheme={appTheme}
      attachmentExportSupported={attachmentExportSupported}
      collapsible={collapsible}
      expanded={!collapsible || (expansionOverrides[message.messageId] ?? message.messageId === latestMessageId)}
      imagesEnabled={imagesEnabled}
      scriptsEnabled={scriptsEnabled}
      key={message.messageId}
      loadAttachment={loadAttachment}
      loadRemoteImages={loadRemoteImages}
      message={message}
      outgoing={outgoingMessages.find(item => item.message.messageId === message.messageId)}
      onKeyDown={onKeyDown}
      onToggle={toggleMessage}
      saveAttachment={saveAttachment}
      sectionRef={message.messageId === latestMessageId ? latestMessageRef : undefined}
      threadId={threadId}
      trackingPixelsEnabled={trackingPixelsEnabled}
      // The provider exposes unread state for the conversation, not each message.
      unread={unread && message.messageId === providerMessages.at(-1)?.messageId}
    />
  ));
}
