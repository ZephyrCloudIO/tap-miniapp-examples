import type { MailDraftAttachment } from '@tap-examples/tap-email-protocol';
import { Clock3, PanelBottom, PanelRightOpen, Paperclip, X } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { resolveComposeShortcut } from './keybindings';
import { mentionsMissingAttachment } from './outbound-attachment';
import { SendLaterDialog } from './send-later-dialog';

export type ReplyPlacement = 'inline' | 'sidecar';

export interface ReplyComposerProps {
  readonly attachmentBusy: boolean;
  readonly attachmentError: string;
  readonly attachments: readonly MailDraftAttachment[];
  readonly bcc: string;
  readonly bodyText: string;
  readonly cc: string;
  readonly focusRequestId: number;
  readonly onAddressChange: (field: 'to' | 'cc' | 'bcc', value: string) => void;
  readonly onAttach: () => void | Promise<void>;
  readonly onBodyTextChange: (bodyText: string) => void;
  readonly onClose: () => void;
  readonly onRemoveAttachment: (stageId: string) => void;
  readonly onPromptReply: () => void;
  readonly onSchedule: (scheduledFor: string, cancelIfReply: boolean) => void;
  readonly onSend: () => void;
  readonly onTogglePlacement: () => void;
  readonly placement: ReplyPlacement;
  readonly recipientLabel: string;
  readonly to: string;
}

function isPlacementShortcut(event: React.KeyboardEvent): boolean {
  return (
    Boolean(event.metaKey || event.ctrlKey) &&
    event.shiftKey &&
    !event.altKey &&
    event.key.toLowerCase() === 'p'
  );
}

export function ReplyComposer({
  attachmentBusy,
  attachmentError,
  attachments,
  bcc,
  bodyText,
  cc,
  focusRequestId,
  onAddressChange,
  onAttach,
  onBodyTextChange,
  onClose,
  onRemoveAttachment,
  onPromptReply,
  onSchedule,
  onSend,
  onTogglePlacement,
  placement,
  recipientLabel,
  to,
}: ReplyComposerProps) {
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const toRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLFormElement>(null);
  const [showCopies, setShowCopies] = useState(Boolean(cc || bcc));
  const [missingAttachmentConfirmation, setMissingAttachmentConfirmation] = useState(false);
  const [sendLaterOpen, setSendLaterOpen] = useState(false);
  const canSend = bodyText.trim().length > 0 && to.trim().length > 0 && !attachmentBusy;
  const popped = placement === 'sidecar';
  const missingAttachment = mentionsMissingAttachment(bodyText, attachments);

  const requestSend = () => {
    if (!canSend) return;
    if (missingAttachment && !missingAttachmentConfirmation) {
      setMissingAttachmentConfirmation(true);
      return;
    }
    onSend();
  };

  useEffect(() => {
    bodyRef.current?.focus({ preventScroll: true });
    if (!popped) {
      const reader = rootRef.current?.closest<HTMLElement>('.message-body');
      if (reader) reader.scrollTop = reader.scrollHeight;
    }
  }, [focusRequestId, popped]);

  return (
    <form
      aria-label={`Reply to ${recipientLabel}`}
      className={`reply-composer is-${placement}`}
      data-reply-placement={placement}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.repeat) return;
        if (isPlacementShortcut(event)) {
          event.preventDefault();
          onTogglePlacement();
          return;
        }
        if (
          event.key === 'Enter' &&
          Boolean(event.metaKey || event.ctrlKey) &&
          !event.altKey &&
          !event.shiftKey
        ) {
          event.preventDefault();
          onPromptReply();
          return;
        }
        const command = resolveComposeShortcut(event);
        if (command === 'send') {
          event.preventDefault();
          requestSend();
        } else if (command === 'focus-to') {
          event.preventDefault();
          toRef.current?.focus();
        } else if (command === 'focus-message') {
          event.preventDefault();
          bodyRef.current?.focus();
        } else if (command === 'close-draft') {
          event.preventDefault();
          onClose();
        }
      }}
      onSubmit={event => {
        event.preventDefault();
        requestSend();
      }}
      ref={rootRef}
    >
      <header className="reply-composer-header">
        <div className="reply-addresses">
          <label>
            <span>To</span>
            <input
              aria-label="Reply recipients"
              autoComplete="off"
              multiple
              onChange={event => {
                setMissingAttachmentConfirmation(false);
                onAddressChange('to', event.target.value);
              }}
              ref={toRef}
              type="email"
              value={to}
            />
          </label>
          {!showCopies ? (
            <button className="reply-copy-toggle" onClick={() => setShowCopies(true)} type="button">
              Cc/Bcc
            </button>
          ) : (
            <>
              <label>
                <span>Cc</span>
                <input aria-label="Reply Cc recipients" autoComplete="off" multiple onChange={event => onAddressChange('cc', event.target.value)} type="email" value={cc} />
              </label>
              <label>
                <span>Bcc</span>
                <input aria-label="Reply Bcc recipients" autoComplete="off" multiple onChange={event => onAddressChange('bcc', event.target.value)} type="email" value={bcc} />
              </label>
            </>
          )}
        </div>
        <div className="reply-composer-actions">
          <button
            aria-label={popped ? 'Return reply inline' : 'Pop out reply'}
            aria-keyshortcuts="Meta+Shift+P Control+Shift+P"
            onClick={onTogglePlacement}
            title={`${popped ? 'Pop in' : 'Pop out'} · ⌘⇧P`}
            type="button"
          >
            {popped ? <PanelBottom aria-hidden="true" /> : <PanelRightOpen aria-hidden="true" />}
          </button>
          <button aria-label="Close reply draft" onClick={onClose} title="Close draft" type="button">
            <X aria-hidden="true" />
          </button>
        </div>
      </header>
      <textarea
        aria-label="Reply message"
        autoComplete="off"
        className="reply-composer-body"
        name="reply-message"
        onChange={event => {
          setMissingAttachmentConfirmation(false);
          onBodyTextChange(event.target.value);
        }}
        placeholder="Write your reply…"
        ref={bodyRef}
        value={bodyText}
      />
      {attachments.length > 0 ? (
        <div className="draft-attachments" aria-label="Reply attachments">
          {attachments.map(attachment => (
            <span className="draft-attachment" key={attachment.stageId}>
              <Paperclip aria-hidden="true" />
              <span>{attachment.fileName}</span>
              <small>{Math.max(1, Math.round(attachment.sizeBytes / 1_024))} KB</small>
              <button
                aria-label={`Remove ${attachment.fileName}`}
                onClick={() => {
                  setMissingAttachmentConfirmation(false);
                  onRemoveAttachment(attachment.stageId);
                }}
                type="button"
              >
                <X aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {attachmentError ? <p className="draft-attachment-error" role="status">{attachmentError}</p> : null}
      {missingAttachmentConfirmation ? (
        <p className="draft-attachment-warning" role="alert">
          This reply mentions an attachment, but no file is attached. Send again to confirm.
        </p>
      ) : null}
      <footer className="reply-composer-footer">
        <button
          aria-label="Attach files"
          disabled={attachmentBusy}
          onClick={() => { void onAttach(); }}
          title="Attach files"
          type="button"
        >
          <Paperclip aria-hidden="true" />
          <span>{attachmentBusy ? 'Attaching…' : 'Attach'}</span>
        </button>
        <button
          aria-label="Send reply later"
          disabled={!canSend}
          onClick={() => setSendLaterOpen(true)}
          title="Send later"
          type="button"
        >
          <Clock3 aria-hidden="true" />
          <span>Send later</span>
        </button>
        <span className="reply-footer-spacer" />
        <button
          className="primary-button"
          disabled={!canSend}
          type="submit"
        >
          {missingAttachmentConfirmation ? 'Send anyway' : 'Send'}
        </button>
      </footer>
      {sendLaterOpen ? (
        <SendLaterDialog
          cancelIfReplyDefault
          onClose={() => setSendLaterOpen(false)}
          onConfirm={(scheduledFor, cancelIfReply) => {
            if (missingAttachment && !missingAttachmentConfirmation) {
              setMissingAttachmentConfirmation(true);
              setSendLaterOpen(false);
              return;
            }
            onSchedule(scheduledFor, cancelIfReply);
          }}
        />
      ) : null}
    </form>
  );
}
