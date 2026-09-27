import { AiWriter } from './ai-writer';
import { ComposerToolbar, FollowUpDialog, FollowUpSummary, ShareDraftDialog } from './composer-tools';
import type { ComposerServices } from './composer-services';
import { recipientError } from './recipient-validation';
import type { MailDraftAttachment, MailFollowUp } from '@tap-examples/tap-email-protocol';
import { Button } from '@theaiplatform/miniapp-sdk/ui';
import { PanelBottom, PanelRightOpen, Paperclip, X } from 'lucide-react';
import React, { useEffect, useId, useRef, useState } from 'react';
import { MessageEditor } from './message-editor';
import { RecipientInput } from './recipient-input';
import { RecipientOptions, useCopyRecipients } from './recipient-options';
import { NO_RECIPIENTS, type RecipientSearch, type RecipientSuggestion } from './recipient-history';
import { resolveComposeShortcut } from './keybindings';
import { mentionsMissingAttachment } from './outbound-attachment';
import { SendLaterDialog } from './send-later-dialog';
import type { BookingLinksClient } from './booking-links';
import { ShareAvailability } from './share-availability';

export type ReplyPlacement = 'inline' | 'sidecar';

export interface ReplyComposerProps {
  readonly bookingLinks?: BookingLinksClient;
  readonly services?: ComposerServices;
  readonly draftKey?: string;
  readonly subject?: string;
  readonly followUp?: MailFollowUp;
  readonly onFollowUpChange?: (value: MailFollowUp | undefined) => void;
  readonly recipientContacts?: readonly RecipientSuggestion[];
  readonly searchRecipients?: RecipientSearch;
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
  bookingLinks,
  services, draftKey = 'reply', subject = '', followUp, onFollowUpChange,
  recipientContacts = NO_RECIPIENTS,
  searchRecipients,
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
  const recipientId = useId();
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const toRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLFormElement>(null);
  const copies = useCopyRecipients(toRef, cc, bcc);
  const [missingAttachmentConfirmation, setMissingAttachmentConfirmation] = useState(false);
  const [sendLaterOpen, setSendLaterOpen] = useState(false);
  const [tool, setTool] = useState<'ai' | 'remind' | 'share' | null>(null);
  const [validationError, setValidationError] = useState('');
  const canSend = bodyText.trim().length > 0 && to.trim().length > 0 && !attachmentBusy;
  const popped = placement === 'sidecar';
  const missingAttachment = mentionsMissingAttachment(bodyText, attachments);

  const requestSend = () => {
    if (!canSend) return;
    const error = recipientError({ to, cc, bcc });
    if (error) { setValidationError(error); return; }
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
        if (event.nativeEvent.isComposing || event.repeat || (event.target instanceof Element && event.target.closest('[data-composer-tool]'))) return;
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j' && !event.shiftKey && !event.altKey) { event.preventDefault(); setTool('ai'); return; }
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
        } else if (command === 'focus-cc' || command === 'focus-bcc') {
          event.preventDefault();
          copies.reveal(command === 'focus-cc' ? 'cc' : 'bcc');
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
          <div className="reply-recipient-line">
            <label htmlFor={`${recipientId}-to`}>To</label>
            <div className="recipient-field-control">
              <RecipientInput
                id={`${recipientId}-to`}
                label="Reply recipients"
                name="reply-recipients"
                contacts={recipientContacts}
                searchRecipients={searchRecipients}
                otherRecipients={[cc, bcc]}
                onValueChange={value => {
                  setMissingAttachmentConfirmation(false);
                  onAddressChange('to', value);
                }}
                ref={toRef}
                value={to}
              />
              <RecipientOptions ccVisible={copies.ccVisible} bccVisible={copies.bccVisible} onReveal={copies.reveal} />
            </div>
          </div>
          {copies.ccVisible ? (
            <div className="reply-recipient-line">
              <label htmlFor={`${recipientId}-cc`}>Cc</label>
              <div className="recipient-field-control">
                <RecipientInput id={`${recipientId}-cc`} ref={copies.ccRef} label="Reply Cc recipients" name="reply-cc" value={cc} onValueChange={value => onAddressChange('cc', value)} contacts={recipientContacts} searchRecipients={searchRecipients} otherRecipients={[to, bcc]} />
                {!cc.trim() ? <Button type="button" variant="ghost" size="icon-sm" aria-label="Hide Cc" title="Hide Cc" onClick={() => copies.hide('cc')}><X aria-hidden="true" /></Button> : null}
              </div>
            </div>
          ) : null}
          {copies.bccVisible ? (
            <div className="reply-recipient-line">
              <label htmlFor={`${recipientId}-bcc`}>Bcc</label>
              <div className="recipient-field-control">
                <RecipientInput id={`${recipientId}-bcc`} ref={copies.bccRef} label="Reply Bcc recipients" name="reply-bcc" value={bcc} onValueChange={value => onAddressChange('bcc', value)} contacts={recipientContacts} searchRecipients={searchRecipients} otherRecipients={[to, cc]} />
                {!bcc.trim() ? <Button type="button" variant="ghost" size="icon-sm" aria-label="Hide Bcc" title="Hide Bcc" onClick={() => copies.hide('bcc')}><X aria-hidden="true" /></Button> : null}
              </div>
            </div>
          ) : null}
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
      {tool === 'ai' ? <AiWriter key={services?.conversationId} services={services} subject={subject} bodyText={bodyText} onApply={onBodyTextChange} onClose={() => { setTool(null); bodyRef.current?.focus(); }} /> : null}
      <MessageEditor
        label="Reply message"
        name="reply-message"
        onValueChange={value => {
          setMissingAttachmentConfirmation(false);
          onBodyTextChange(value);
        }}
        placeholder="Write your reply…"
        inputRef={bodyRef}
        value={bodyText}
        variant="reply"
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
      {validationError ? <p className="draft-attachment-error" role="alert">{validationError}</p> : null}
      <FollowUpSummary value={followUp} onEdit={() => setTool('remind')} onRemove={() => onFollowUpChange?.(undefined)} />
      <footer className="reply-composer-footer">
        <ComposerToolbar canSend={canSend} attachmentBusy={attachmentBusy} sendAnyway={missingAttachmentConfirmation}
          onAttach={() => { void onAttach(); }} onSend={requestSend}
          onSchedule={() => { const error = recipientError({ to, cc, bcc }); if (error) setValidationError(error); else setSendLaterOpen(true); }}
          onRemind={() => setTool('remind')} onShare={() => setTool('share')} onWriteAi={() => setTool('ai')}>
          <ShareAvailability client={bookingLinks} bodyRef={bodyRef} onBodyTextChange={value => {
            setMissingAttachmentConfirmation(false);
            onBodyTextChange(value);
          }} />
        </ComposerToolbar>
      </footer>
      {tool === 'remind' ? <FollowUpDialog value={followUp} onChange={value => onFollowUpChange?.(value)} onClose={() => setTool(null)} /> : null}
      {tool === 'share' ? <ShareDraftDialog key={services?.workspaceId} services={services} draft={{ draftKey, subject, to, cc, bodyText }} onClose={() => setTool(null)} /> : null}
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
