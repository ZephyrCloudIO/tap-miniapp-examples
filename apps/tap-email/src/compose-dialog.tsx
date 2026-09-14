import type { MailDraftAttachment } from '@tap-examples/tap-email-protocol';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  NativeSelect,
  NativeSelectOption,
  Textarea,
} from '@theaiplatform/miniapp-sdk/ui';
import { Clock3, Paperclip, X } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import type { EmailAccount } from './domain';
import { resolveComposeShortcut } from './keybindings';
import {
  mentionsMissingAttachment,
  type SelectAndStageAttachmentsResult,
} from './outbound-attachment';
import { SendLaterDialog } from './send-later-dialog';

export interface ComposeDraftMessage {
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
  const [from, setFrom] = useState(initialAccountId || accounts[0]?.accountId || '');
  const [to, setTo] = useState(initialTo);
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState(initialSubject);
  const [bodyText, setBodyText] = useState(initialBodyText);
  const [attachments, setAttachments] = useState<readonly MailDraftAttachment[]>([]);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [attachmentError, setAttachmentError] = useState('');
  const [draftRevision, setDraftRevision] = useState(1);
  const [missingAttachmentConfirmation, setMissingAttachmentConfirmation] = useState(false);
  const [sendLaterOpen, setSendLaterOpen] = useState(false);
  const recipientRef = useRef<HTMLInputElement>(null);
  const fromRef = useRef<HTMLSelectElement>(null);
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
    subject: subject.trim(),
    to: to.trim(),
  });
  const change = (update: () => void) => {
    setMissingAttachmentConfirmation(false);
    update();
    setDraftRevision(revision => revision + 1);
  };
  const requestSend = () => {
    if (!canSend) return;
    if (missingAttachment && !missingAttachmentConfirmation) {
      setMissingAttachmentConfirmation(true);
      return;
    }
    onSend(message());
  };
  const closePreservingDraft = () => {
    if (draftRevision > 1 && from && to.trim()) onAutosave(message());
    onClose();
  };

  useEffect(() => {
    if (draftRevision <= 1 || !from || !to.trim()) return;
    const timer = window.setTimeout(() => onAutosave(message()), 800);
    return () => window.clearTimeout(timer);
  }, [attachments, bcc, bodyText, cc, draftRevision, from, onAutosave, subject, to]);

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
          onOpenAutoFocus={event => {
            event.preventDefault();
            recipientRef.current?.focus({ preventScroll: true });
          }}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing || event.repeat) return;
            const command = resolveComposeShortcut(event);
            if (!command) return;
            event.preventDefault();
            if (command === 'send') requestSend();
            if (command === 'focus-to') recipientRef.current?.focus();
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
          <label className="compose-line">
            <span>From</span>
            <NativeSelect
              ref={fromRef}
              name="from-account"
              value={from}
              onChange={event => change(() => {
                setFrom(event.target.value);
                if (attachments.length > 0) {
                  setAttachments([]);
                  setAttachmentError('Choose attachments again after changing the sending account.');
                }
              })}
            >
              {accounts.map(account => (
                <NativeSelectOption key={account.accountId} value={account.accountId}>
                  {account.displayName} · {account.address}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <label className="compose-line">
            <span>To</span>
            <Input ref={recipientRef} autoComplete="off" multiple name="recipients" spellCheck={false} type="email" value={to} onChange={event => change(() => setTo(event.target.value))} />
          </label>
          <label className="compose-line">
            <span>Cc</span>
            <Input autoComplete="off" multiple name="cc-recipients" spellCheck={false} type="email" value={cc} onChange={event => change(() => setCc(event.target.value))} />
          </label>
          <label className="compose-line">
            <span>Bcc</span>
            <Input autoComplete="off" multiple name="bcc-recipients" spellCheck={false} type="email" value={bcc} onChange={event => change(() => setBcc(event.target.value))} />
          </label>
          <label className="compose-line">
            <span>Subject</span>
            <Input ref={subjectRef} autoComplete="off" name="subject" value={subject} onChange={event => change(() => setSubject(event.target.value))} />
          </label>
          <Textarea ref={bodyRef} autoComplete="off" className="compose-body" name="message-body" aria-label="Message body" placeholder="Write your message…" value={bodyText} onChange={event => change(() => setBodyText(event.target.value))} />
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
          <footer>
            <span>Sent through the selected connected account.</span>
            <div className="compose-footer-actions">
              <Button disabled={attachmentBusy || !from} onClick={() => { void attach(); }} type="button" variant="ghost"><Paperclip aria-hidden="true" />{attachmentBusy ? 'Attaching…' : 'Attach'}</Button>
              <Button disabled={!canSend} onClick={() => setSendLaterOpen(true)} type="button" variant="ghost"><Clock3 aria-hidden="true" />Send later</Button>
              <Button className="primary-button" type="button" disabled={!canSend} onClick={requestSend}>
                {missingAttachmentConfirmation ? 'Send anyway' : 'Send'} <kbd>⌘ Enter</kbd>
              </Button>
            </div>
          </footer>
        </DialogContent>
      </Dialog>
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
