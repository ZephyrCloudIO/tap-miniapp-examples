import { AiWriter } from './ai-writer';
import { ComposerToolbar, FollowUpDialog, FollowUpSummary, ShareDraftDialog } from './composer-tools';
import type { ComposerServices } from './composer-services';
import { recipientError } from './recipient-validation';
import type { MailDraftAttachment, MailFollowUp } from '@tap-examples/tap-email-protocol';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@theaiplatform/miniapp-sdk/ui';
import { Paperclip, X } from 'lucide-react';
import React, { useEffect, useId, useRef, useState } from 'react';
import type { EmailAccount } from './domain';
import { withoutEmailSignature } from './email-signature';
import { MessageEditor } from './message-editor';
import { RecipientInput } from './recipient-input';
import { RecipientOptions, useCopyRecipients } from './recipient-options';
import { NO_RECIPIENTS, type RecipientSearch, type RecipientSuggestion } from './recipient-history';
import { resolveComposeShortcut } from './keybindings';
import {
  mentionsMissingAttachment,
  type SelectAndStageAttachmentsResult,
} from './outbound-attachment';
import { SendLaterDialog } from './send-later-dialog';
import type { BookingLinksClient } from './booking-links';
import { ShareAvailability } from './share-availability';

export interface ComposeDraftMessage {
  readonly followUp?: MailFollowUp;
  readonly accountId: string;
  readonly attachments: readonly MailDraftAttachment[];
  readonly bcc: string;
  readonly bodyText: string;
  readonly cc: string;
  readonly draftKey: string;
  readonly draftRevision: number;
  readonly subject: string;
  readonly to: string;
}

export interface ComposeDialogProps {
  readonly bookingLinks?: BookingLinksClient;
  readonly services?: ComposerServices;
  readonly recipientContacts?: readonly RecipientSuggestion[];
  readonly searchRecipients?: RecipientSearch;
  readonly accounts: readonly EmailAccount[];
  readonly draftKey: string;
  readonly initialAccountId: string;
  readonly initialBodyText: string;
  readonly initialSubject: string;
  readonly initialTo: string;
  readonly onAttach: (
    accountId: string,
    draftKey: string,
    existing: readonly MailDraftAttachment[],
  ) => Promise<SelectAndStageAttachmentsResult>;
  readonly onAutosave: (message: ComposeDraftMessage) => void;
  readonly onClose: () => void;
  readonly onSchedule: (
    message: ComposeDraftMessage,
    scheduledFor: string,
    cancelIfReply: boolean,
  ) => void;
  readonly onSend: (message: ComposeDraftMessage) => void;
}

export function ComposeDialog({
  bookingLinks,
  services,
  recipientContacts = NO_RECIPIENTS,
  searchRecipients,
  accounts,
  draftKey,
  initialAccountId,
  initialTo,
  initialSubject,
  initialBodyText,
  onAttach,
  onAutosave,
  onClose,
  onSchedule,
  onSend,
}: ComposeDialogProps) {
  const recipientId = useId();
  const [from, setFrom] = useState(initialAccountId || accounts[0]?.accountId || '');
  const [to, setTo] = useState(initialTo);
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState(initialSubject);
  const [bodyText, setBodyText] = useState(() => withoutEmailSignature(initialBodyText));
  const [attachments, setAttachments] = useState<readonly MailDraftAttachment[]>([]);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [attachmentError, setAttachmentError] = useState('');
  const [draftRevision, setDraftRevision] = useState(1);
  const [missingAttachmentConfirmation, setMissingAttachmentConfirmation] = useState(false);
  const [sendLaterOpen, setSendLaterOpen] = useState(false);
  const [followUp, setFollowUp] = useState<MailFollowUp>();
  const [tool, setTool] = useState<'ai' | 'remind' | 'share' | null>(null);
  const [validationError, setValidationError] = useState('');
  const recipientRef = useRef<HTMLInputElement>(null);
  const copies = useCopyRecipients(recipientRef, cc, bcc);
  const fromRef = useRef<HTMLButtonElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const canSend = Boolean(from && to.trim() && bodyText.trim() && !attachmentBusy);
  const missingAttachment = mentionsMissingAttachment(bodyText, attachments);
  const message = (): ComposeDraftMessage => ({
    accountId: from,
    attachments,
    bcc: bcc.trim(),
    bodyText,
    cc: cc.trim(),
    draftKey,
    draftRevision,
    ...(followUp ? { followUp } : {}),
    subject: subject.trim(),
    to: to.trim(),
  });
  const change = (update: () => void) => {
    setMissingAttachmentConfirmation(false);
    setValidationError('');
    update();
    setDraftRevision(revision => revision + 1);
  };
  const requestSend = () => {
    if (!canSend) return;
    const error = recipientError({ to, cc, bcc });
    if (error) { setValidationError(error); return; }
    if (missingAttachment && !missingAttachmentConfirmation) {
      setMissingAttachmentConfirmation(true);
      return;
    }
    onSend(message());
  };
  const closePreservingDraft = () => {
    if (from && (to.trim() || subject.trim() || bodyText.trim() || attachments.length || followUp)) onAutosave(message());
    onClose();
  };

  useEffect(() => {
    if (!from || !(to.trim() || subject.trim() || bodyText.trim() || attachments.length || followUp)) return;
    const timer = window.setTimeout(() => onAutosave(message()), 800);
    return () => window.clearTimeout(timer);
  }, [attachments, bcc, bodyText, cc, draftRevision, followUp, from, onAutosave, subject, to]);

  const attach = async () => {
    if (attachmentBusy || !from) return;
    setAttachmentBusy(true);
    setAttachmentError('');
    try {
      const result = await onAttach(from, draftKey, attachments);
      if (result.attachments.length > 0) {
        setAttachments(current => [...current, ...result.attachments]);
        setDraftRevision(revision => revision + 1);
        setMissingAttachmentConfirmation(false);
      }
      setAttachmentError(result.failures.join(' '));
    } finally {
      setAttachmentBusy(false);
    }
  };

  return (
    <>
      <Dialog open={!sendLaterOpen} onOpenChange={open => { if (!open) closePreservingDraft(); }}>
        <DialogContent
          className="compose-dialog"
          hideCloseButton
          onEscapeKeyDown={event => {
            if (event.target instanceof Element && (
              event.target.closest('.ai-writer') ||
              event.target.matches('[data-recipient-input][aria-expanded="true"]') ||
              event.target.closest('[data-recipient-options]')?.querySelector('[aria-expanded="true"]')
            )) event.preventDefault();
          }}
          onOpenAutoFocus={event => {
            event.preventDefault();
            recipientRef.current?.focus({ preventScroll: true });
          }}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing || event.repeat || (event.target instanceof Element && event.target.closest('[data-composer-tool]'))) return;
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j' && !event.shiftKey && !event.altKey) { event.preventDefault(); setTool('ai'); return; }
            const command = resolveComposeShortcut(event);
            if (!command) return;
            event.preventDefault();
            if (command === 'send') requestSend();
            if (command === 'focus-to') recipientRef.current?.focus();
            if (command === 'focus-cc') copies.reveal('cc');
            if (command === 'focus-bcc') copies.reveal('bcc');
            if (command === 'focus-from') fromRef.current?.focus();
            if (command === 'focus-subject') subjectRef.current?.focus();
            if (command === 'focus-message') bodyRef.current?.focus();
            if (command === 'close-draft') closePreservingDraft();
          }}
        >
          <header>
            <DialogTitle>New Message</DialogTitle>
            <DialogDescription className="sr-only">
              Write and send an email through a connected account.
            </DialogDescription>
            <Button variant="ghost" size="icon-sm" type="button" onClick={closePreservingDraft} aria-label="Save and close draft">×</Button>
          </header>
          <div className="compose-line">
            <label id={`${recipientId}-from`}>From</label>
            <Select value={from} onValueChange={value => change(() => {
              setFrom(value);
              if (attachments.length) { setAttachments([]); setAttachmentError('Choose attachments again after changing the sending account.'); }
            })}>
              <SelectTrigger ref={fromRef} aria-labelledby={`${recipientId}-from`} density="compact"><SelectValue /></SelectTrigger>
              <SelectContent>{accounts.map(account => <SelectItem key={account.accountId} value={account.accountId}>
                {account.displayName && account.displayName.toLowerCase() !== account.address.toLowerCase() ? `${account.displayName} · ${account.address}` : account.address}
              </SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="compose-line">
            <label htmlFor={`${recipientId}-to`}>To</label>
            <div className="recipient-field-control">
              <RecipientInput id={`${recipientId}-to`} ref={recipientRef} label="To" name="recipients" value={to} onValueChange={value => change(() => setTo(value))} contacts={recipientContacts} searchRecipients={searchRecipients} otherRecipients={[cc, bcc]} />
              <RecipientOptions ccVisible={copies.ccVisible} bccVisible={copies.bccVisible} onReveal={copies.reveal} />
            </div>
          </div>
          {copies.ccVisible ? (
            <div className="compose-line">
              <label htmlFor={`${recipientId}-cc`}>Cc</label>
              <div className="recipient-field-control">
                <RecipientInput id={`${recipientId}-cc`} ref={copies.ccRef} label="Cc" name="cc-recipients" value={cc} onValueChange={value => change(() => setCc(value))} contacts={recipientContacts} searchRecipients={searchRecipients} otherRecipients={[to, bcc]} />
                {!cc.trim() ? <Button type="button" variant="ghost" size="icon-sm" aria-label="Hide Cc" title="Hide Cc" onClick={() => copies.hide('cc')}><X aria-hidden="true" /></Button> : null}
              </div>
            </div>
          ) : null}
          {copies.bccVisible ? (
            <div className="compose-line">
              <label htmlFor={`${recipientId}-bcc`}>Bcc</label>
              <div className="recipient-field-control">
                <RecipientInput id={`${recipientId}-bcc`} ref={copies.bccRef} label="Bcc" name="bcc-recipients" value={bcc} onValueChange={value => change(() => setBcc(value))} contacts={recipientContacts} searchRecipients={searchRecipients} otherRecipients={[to, cc]} />
                {!bcc.trim() ? <Button type="button" variant="ghost" size="icon-sm" aria-label="Hide Bcc" title="Hide Bcc" onClick={() => copies.hide('bcc')}><X aria-hidden="true" /></Button> : null}
              </div>
            </div>
          ) : null}
          <label className="compose-line">
            <span>Subject</span>
            <Input ref={subjectRef} autoComplete="off" name="subject" value={subject} onChange={event => change(() => setSubject(event.target.value))} />
          </label>
          {tool === 'ai' ? <AiWriter key={services?.conversationId} services={services} subject={subject} bodyText={bodyText} onApply={value => change(() => setBodyText(value))} onClose={() => { setTool(null); bodyRef.current?.focus(); }} /> : null}
          <MessageEditor inputRef={bodyRef} label="Message body" name="message-body" placeholder="Write your message…" value={bodyText} onValueChange={value => change(() => setBodyText(value))} variant="compose" />
          {attachments.length > 0 ? (
            <div className="draft-attachments" aria-label="Message attachments">
              {attachments.map(attachment => (
                <span className="draft-attachment" key={attachment.stageId}>
                  <Paperclip aria-hidden="true" />
                  <span>{attachment.fileName}</span>
                  <small>{Math.max(1, Math.round(attachment.sizeBytes / 1_024))} KB</small>
                  <button aria-label={`Remove ${attachment.fileName}`} onClick={() => change(() => setAttachments(current => current.filter(item => item.stageId !== attachment.stageId)))} type="button"><X aria-hidden="true" /></button>
                </span>
              ))}
            </div>
          ) : null}
          {attachmentError ? <p className="draft-attachment-error" role="status">{attachmentError}</p> : null}
          {missingAttachmentConfirmation ? <p className="draft-attachment-warning" role="alert">This message mentions an attachment, but no file is attached. Send again to confirm.</p> : null}
          {validationError ? <p className="draft-attachment-error" role="alert">{validationError}</p> : null}
          <FollowUpSummary value={followUp} onEdit={() => setTool('remind')} onRemove={() => change(() => setFollowUp(undefined))} />
          <footer>
            <ComposerToolbar canSend={canSend} attachmentBusy={attachmentBusy || !from} sendAnyway={missingAttachmentConfirmation}
              onAttach={() => { void attach(); }} onSend={requestSend}
              onSchedule={() => { const error = recipientError({ to, cc, bcc }); if (error) setValidationError(error); else setSendLaterOpen(true); }}
              onRemind={() => setTool('remind')} onShare={() => setTool('share')} onWriteAi={() => setTool('ai')}>
              <ShareAvailability client={bookingLinks} bodyRef={bodyRef} onBodyTextChange={value => change(() => setBodyText(value))} />
            </ComposerToolbar>
          </footer>
        </DialogContent>
      </Dialog>
      {tool === 'remind' ? <FollowUpDialog value={followUp} onChange={value => change(() => setFollowUp(value))} onClose={() => setTool(null)} /> : null}
      {tool === 'share' ? <ShareDraftDialog key={services?.workspaceId} services={services} draft={message()} onClose={() => setTool(null)} /> : null}
      {sendLaterOpen ? (
        <SendLaterDialog
          cancelIfReplyDefault={false}
          onClose={() => setSendLaterOpen(false)}
          onConfirm={(scheduledFor, cancelIfReply) => {
            if (missingAttachment && !missingAttachmentConfirmation) {
              setMissingAttachmentConfirmation(true);
              setSendLaterOpen(false);
              return;
            }
            onSchedule(message(), scheduledFor, cancelIfReply);
          }}
        />
      ) : null}
    </>
  );
}
