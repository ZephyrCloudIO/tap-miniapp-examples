import { Check, Download, LoaderCircle, Paperclip } from 'lucide-react';
import React, { useCallback, useRef, useState, type KeyboardEvent } from 'react';
import {
  attachmentExportErrorMessage,
  maximumAttachmentExportBytes,
  type AttachmentExportPhase,
  type AttachmentExportResult,
} from './attachment-export';
import type { EmailAttachment } from './domain';

export type SaveMessageAttachment = (
  attachment: EmailAttachment,
  onPhase: (phase: AttachmentExportPhase) => void,
) => Promise<AttachmentExportResult>;

export interface MessageAttachmentsProps {
  readonly attachments: readonly EmailAttachment[];
  readonly exportSupported: boolean;
  readonly onSaveAttachment: SaveMessageAttachment;
}

type AttachmentRowState =
  | { readonly phase: 'idle' | 'choosing' | 'loading' | 'saving' | 'saved' }
  | { readonly phase: 'error'; readonly message: string };

function formatAttachmentSize(sizeBytes: number): string {
  if (sizeBytes < 1_024) return `${sizeBytes} B`;
  if (sizeBytes < 1_024 * 1_024) return `${(sizeBytes / 1_024).toFixed(sizeBytes < 10_240 ? 1 : 0)} KB`;
  return `${(sizeBytes / (1_024 * 1_024)).toFixed(1)} MB`;
}

function formatAttachmentType(mimeType: string): string {
  const subtype = mimeType.split('/', 2)[1]?.split(/[;+]/u, 1)[0]?.trim();
  return (subtype || mimeType).toUpperCase().slice(0, 24);
}

function isolateKeyboard(event: KeyboardEvent<HTMLButtonElement>): void {
  event.stopPropagation();
}

function AttachmentRow({
  attachment,
  exportSupported,
  onSaveAttachment,
}: {
  readonly attachment: EmailAttachment;
  readonly exportSupported: boolean;
  readonly onSaveAttachment: SaveMessageAttachment;
}) {
  const [state, setState] = useState<AttachmentRowState>({ phase: 'idle' });
  const saveInFlight = useRef(false);
  const tooLarge = attachment.sizeBytes > maximumAttachmentExportBytes;
  const busy = state.phase === 'choosing' || state.phase === 'loading' || state.phase === 'saving';
  const unavailableMessage = !exportSupported
    ? 'Saving files is not supported by this host.'
    : tooLarge
      ? 'Over the 8 MB download limit.'
      : '';

  const save = useCallback(async () => {
    if (saveInFlight.current || tooLarge || !exportSupported) return;
    saveInFlight.current = true;
    setState({ phase: 'choosing' });
    try {
      const result = await onSaveAttachment(attachment, phase => setState({ phase }));
      setState({ phase: result === 'saved' ? 'saved' : 'idle' });
    } catch (error) {
      setState({ phase: 'error', message: attachmentExportErrorMessage(error) });
    } finally {
      saveInFlight.current = false;
    }
  }, [attachment, exportSupported, onSaveAttachment, tooLarge]);

  const actionLabel = state.phase === 'saved'
    ? 'Saved'
    : state.phase === 'error'
      ? 'Retry'
      : state.phase === 'choosing'
        ? 'Choose…'
        : state.phase === 'loading'
          ? 'Downloading…'
          : state.phase === 'saving'
        ? 'Saving…'
        : exportSupported && !tooLarge
          ? 'Save'
          : 'Unavailable';

  return (
    <li className="message-attachment">
      <span className="message-attachment-icon" aria-hidden="true"><Paperclip /></span>
      <span className="message-attachment-copy">
        <span className="message-attachment-name">{attachment.fileName || 'Attachment'}</span>
        <span className="message-attachment-meta">
          {formatAttachmentSize(attachment.sizeBytes)}
          {` · ${formatAttachmentType(attachment.mimeType)}`}
          {attachment.disposition === 'inline' ? ' · Inline' : ''}
          {unavailableMessage ? ` · ${unavailableMessage}` : ''}
        </span>
        {state.phase === 'error' ? (
          <span className="message-attachment-error" role="alert">{state.message}</span>
        ) : null}
      </span>
      <button
        aria-busy={busy || undefined}
        aria-label={`${actionLabel} ${attachment.fileName || 'attachment'}`}
        className="message-attachment-save"
        disabled={busy || tooLarge || !exportSupported}
        onClick={event => {
          event.stopPropagation();
          void save();
        }}
        onKeyDown={isolateKeyboard}
        onKeyUp={isolateKeyboard}
        type="button"
      >
        {state.phase === 'saved' ? <Check aria-hidden="true" /> : busy ? (
          <LoaderCircle aria-hidden="true" className="is-spinning" />
        ) : (
          <Download aria-hidden="true" />
        )}
        <span aria-live="polite">{actionLabel}</span>
      </button>
    </li>
  );
}

export function MessageAttachments({
  attachments,
  exportSupported,
  onSaveAttachment,
}: MessageAttachmentsProps) {
  if (attachments.length === 0) return null;
  return (
    <section className="message-attachments" aria-label="Attachments">
      <h3>{attachments.length === 1 ? 'Attachment' : `${attachments.length} attachments`}</h3>
      <ul>
        {attachments.map(attachment => (
          <AttachmentRow
            attachment={attachment}
            exportSupported={exportSupported}
            key={attachment.resourceId}
            onSaveAttachment={onSaveAttachment}
          />
        ))}
      </ul>
    </section>
  );
}
