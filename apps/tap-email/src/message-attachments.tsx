import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@theaiplatform/miniapp-sdk/ui';
import { Check, Download, Eye, LoaderCircle, Paperclip, X } from 'lucide-react';
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import {
  attachmentExportErrorMessage,
  maximumAttachmentExportBytes,
  type AttachmentExportPhase,
  type AttachmentExportResult,
} from './attachment-export';
import {
  AttachmentPreviewError,
  attachmentPreviewDataUrl,
  attachmentPreviewErrorMessage,
  attachmentPreviewMimeType,
} from './attachment-preview';
import type { EmailAttachment } from './domain';

export type SaveMessageAttachment = (
  attachment: EmailAttachment,
  onPhase: (phase: AttachmentExportPhase) => void,
) => Promise<AttachmentExportResult>;

export type LoadMessageAttachment = (
  attachment: EmailAttachment,
  options: AttachmentLoadOptions,
) => Promise<Uint8Array>;

export type AttachmentCacheMode = 'read-write' | 'read-only' | 'bypass';

export interface AttachmentLoadOptions {
  readonly cacheMode: AttachmentCacheMode;
}

export interface MessageAttachmentsProps {
  readonly attachments: readonly EmailAttachment[];
  readonly exportSupported: boolean;
  readonly onLoadAttachment: LoadMessageAttachment | null;
  readonly onSaveAttachment: SaveMessageAttachment;
}

type AttachmentRowState =
  | { readonly phase: 'idle' | 'choosing' | 'loading' | 'saving' | 'saved' }
  | { readonly phase: 'error'; readonly message: string };

type AttachmentPreviewState =
  | { readonly phase: 'closed' }
  | { readonly phase: 'loading'; readonly attachment: EmailAttachment }
  | {
      readonly phase: 'ready';
      readonly attachment: EmailAttachment;
      readonly dataUrl: string;
    }
  | {
      readonly phase: 'error';
      readonly attachment: EmailAttachment;
      readonly message: string;
      readonly retryCacheMode: Extract<AttachmentCacheMode, 'read-only' | 'bypass'> | null;
    };

function formatAttachmentSize(sizeBytes: number): string {
  if (sizeBytes < 1_024) return `${sizeBytes} B`;
  if (sizeBytes < 1_024 * 1_024) return `${(sizeBytes / 1_024).toFixed(sizeBytes < 10_240 ? 1 : 0)} KB`;
  return `${(sizeBytes / (1_024 * 1_024)).toFixed(1)} MB`;
}

function formatAttachmentType(mimeType: string): string {
  const subtype = mimeType.split('/', 2)[1]?.split(/[;+]/u, 1)[0]?.trim();
  return (subtype || mimeType).toUpperCase().slice(0, 24);
}

function isolateKeyboard(event: KeyboardEvent<HTMLElement>): void {
  event.stopPropagation();
}

function AttachmentDetails({
  attachment,
  previewSupported,
  unavailableMessage,
}: {
  readonly attachment: EmailAttachment;
  readonly previewSupported: boolean;
  readonly unavailableMessage: string;
}) {
  return (
    <>
      <span className="message-attachment-icon" aria-hidden="true"><Paperclip /></span>
      <span className="message-attachment-copy">
        <span className="message-attachment-name">{attachment.fileName || 'Attachment'}</span>
        <span className="message-attachment-meta">
          {formatAttachmentSize(attachment.sizeBytes)}
          {` · ${formatAttachmentType(attachment.mimeType)}`}
          {attachment.disposition === 'inline' ? ' · Inline' : ''}
          {previewSupported ? ' · Preview' : ''}
          {unavailableMessage ? ` · ${unavailableMessage}` : ''}
        </span>
      </span>
    </>
  );
}

function AttachmentRow({
  attachment,
  exportSupported,
  onPreviewAttachment,
  onSaveAttachment,
}: {
  readonly attachment: EmailAttachment;
  readonly exportSupported: boolean;
  readonly onPreviewAttachment: ((
    attachment: EmailAttachment,
    trigger: HTMLButtonElement,
  ) => void) | null;
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
  const previewSupported = onPreviewAttachment !== null &&
    attachmentPreviewMimeType(attachment.mimeType) !== null &&
    attachment.sizeBytes > 0 &&
    !tooLarge;

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
      {previewSupported ? (
        <button
          aria-haspopup="dialog"
          aria-label={`Preview ${attachment.fileName || 'attachment'}`}
          className="message-attachment-preview"
          disabled={busy}
          onClick={event => {
            event.stopPropagation();
            onPreviewAttachment(attachment, event.currentTarget);
          }}
          onKeyDown={isolateKeyboard}
          onKeyUp={isolateKeyboard}
          type="button"
        >
          <AttachmentDetails
            attachment={attachment}
            previewSupported
            unavailableMessage={unavailableMessage}
          />
        </button>
      ) : (
        <span className="message-attachment-details">
          <AttachmentDetails
            attachment={attachment}
            previewSupported={false}
            unavailableMessage={unavailableMessage}
          />
        </span>
      )}
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
      {state.phase === 'error' ? (
        <span className="message-attachment-error" role="alert">{state.message}</span>
      ) : null}
    </li>
  );
}

function AttachmentPreviewDialog({
  onClose,
  onDisplayError,
  onRetry,
  state,
}: {
  readonly onClose: () => void;
  readonly onDisplayError: () => void;
  readonly onRetry: (
    attachment: EmailAttachment,
    cacheMode: Extract<AttachmentCacheMode, 'read-only' | 'bypass'>,
  ) => void;
  readonly state: Exclude<AttachmentPreviewState, { readonly phase: 'closed' }>;
}) {
  const { attachment } = state;
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const retryCacheMode = state.phase === 'error' ? state.retryCacheMode : null;
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent
        className="attachment-preview-dialog"
        hideCloseButton
        onOpenAutoFocus={event => {
          event.preventDefault();
          closeButtonRef.current?.focus({ preventScroll: true });
        }}
        onKeyDown={isolateKeyboard}
        onKeyUp={isolateKeyboard}
      >
        <header className="attachment-preview-header">
          <div>
            <span className="eyebrow">Attachment preview</span>
            <DialogTitle>{attachment.fileName || 'Attachment'}</DialogTitle>
            <DialogDescription>
              {formatAttachmentSize(attachment.sizeBytes)} · {formatAttachmentType(attachment.mimeType)}
            </DialogDescription>
          </div>
          <Button
            aria-label="Close attachment preview"
            onClick={onClose}
            ref={closeButtonRef}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <X aria-hidden="true" />
          </Button>
        </header>
        <div className={`attachment-preview-stage is-${state.phase}`}>
          {state.phase === 'loading' ? (
            <div className="attachment-preview-status" role="status">
              <LoaderCircle aria-hidden="true" className="is-spinning" />
              <span>Loading preview…</span>
            </div>
          ) : state.phase === 'error' ? (
            <div className="attachment-preview-status" role="alert">
              <Eye aria-hidden="true" />
              <span>{state.message}</span>
              {retryCacheMode ? (
                <Button
                  onClick={() => {
                    closeButtonRef.current?.focus({ preventScroll: true });
                    onRetry(attachment, retryCacheMode);
                  }}
                  type="button"
                  variant="outline"
                >
                  Try again
                </Button>
              ) : null}
            </div>
          ) : (
            <img
              alt={`Preview of ${attachment.fileName || 'attachment'}`}
              onError={onDisplayError}
              src={state.dataUrl}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function MessageAttachments({
  attachments,
  exportSupported,
  onLoadAttachment,
  onSaveAttachment,
}: MessageAttachmentsProps) {
  const [previewState, setPreviewState] = useState<AttachmentPreviewState>({ phase: 'closed' });
  const previewRequest = useRef(0);
  const previewTrigger = useRef<HTMLButtonElement | null>(null);
  const restorePreviewFocus = useRef(false);
  const closePreview = useCallback(() => {
    previewRequest.current += 1;
    restorePreviewFocus.current = true;
    setPreviewState({ phase: 'closed' });
  }, []);
  const failPreviewDisplay = useCallback(() => {
    setPreviewState(current => current.phase === 'ready'
      ? {
          phase: 'error',
          attachment: current.attachment,
          message: 'This image could not be displayed.',
          retryCacheMode: 'bypass',
        }
      : current);
  }, []);
  const previewAttachment = useCallback(async (
    attachment: EmailAttachment,
    cacheMode: AttachmentCacheMode,
  ) => {
    if (!onLoadAttachment) return;
    const request = previewRequest.current + 1;
    previewRequest.current = request;
    setPreviewState({ phase: 'loading', attachment });
    try {
      const bytes = await onLoadAttachment(attachment, { cacheMode });
      const dataUrl = attachmentPreviewDataUrl(attachment, bytes);
      if (previewRequest.current === request) {
        setPreviewState({ phase: 'ready', attachment, dataUrl });
      }
    } catch (error) {
      if (previewRequest.current === request) {
        setPreviewState({
          phase: 'error',
          attachment,
          message: attachmentPreviewErrorMessage(error),
          retryCacheMode: error instanceof AttachmentPreviewError
            ? error.code === 'content_mismatch' ? 'bypass' : null
            : 'read-only',
        });
      }
    }
  }, [onLoadAttachment]);
  useEffect(() => {
    if (previewState.phase !== 'closed' || !restorePreviewFocus.current) return;
    restorePreviewFocus.current = false;
    const trigger = previewTrigger.current;
    previewTrigger.current = null;
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
  }, [previewState.phase]);
  useEffect(() => () => {
    previewRequest.current += 1;
  }, []);

  if (attachments.length === 0) return null;
  return (
    <>
      <section className="message-attachments" aria-label="Attachments">
        <h3>{attachments.length === 1 ? 'Attachment' : `${attachments.length} attachments`}</h3>
        <ul>
          {attachments.map(attachment => (
            <AttachmentRow
              attachment={attachment}
              exportSupported={exportSupported}
              key={attachment.resourceId}
              onPreviewAttachment={onLoadAttachment ? (attachment, trigger) => {
                previewTrigger.current = trigger;
                void previewAttachment(attachment, 'read-only');
              } : null}
              onSaveAttachment={onSaveAttachment}
            />
          ))}
        </ul>
      </section>
      {previewState.phase === 'closed' ? null : (
        <AttachmentPreviewDialog
          onClose={closePreview}
          onDisplayError={failPreviewDisplay}
          onRetry={(attachment, cacheMode) => {
            void previewAttachment(attachment, cacheMode);
          }}
          state={previewState}
        />
      )}
    </>
  );
}
