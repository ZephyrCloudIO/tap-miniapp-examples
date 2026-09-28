import React from 'react';
import type { EmailAccount, OutboxSend, RecoverableImmediateSend } from './domain';

export interface PendingSendStatus {
  readonly label: string;
  readonly detail: string;
}

export interface OutboxListProps {
  readonly accounts: readonly EmailAccount[];
  readonly items: readonly OutboxSend[];
  readonly pendingStatus?: (item: OutboxSend) => PendingSendStatus;
  readonly onReconcile: (item: RecoverableImmediateSend) => void | Promise<void>;
  readonly onRetry: (item: RecoverableImmediateSend) => void;
}

function recordedLabel(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

export function OutboxList({
  accounts,
  items,
  pendingStatus,
  onReconcile,
  onRetry,
}: OutboxListProps) {
  if (items.length === 0) {
    return (
      <div className="zero-state outbox-zero-state">
        <h2>Outbox is empty</h2>
        <p>Messages waiting to send will appear here until delivery is confirmed.</p>
      </div>
    );
  }
  return (
    <div aria-label="Outgoing messages" className="outbox-list" role="list">
      {items.map(item => {
        const origin = item.attempts[0]!.command;
        const current = item.attempts[item.attempts.length - 1]!;
        const account = accounts.find(candidate => candidate.accountId === origin.accountId);
        const state = current.receipt?.state ?? (item.attempts.length > 1 ? 'retrying' : 'queued');
        const pending = current.receipt === null ? pendingStatus?.(item) : undefined;
        const uncertain = state === 'uncertain';
        const failed = state === 'failed';
        return (
          <article className={`outbox-item is-${state}`} key={origin.commandId} role="listitem">
            <header>
              <div>
                <strong>{origin.payload.subject || '(no subject)'}</strong>
                <span>To {origin.payload.to}</span>
              </div>
              <div className="outbox-status" role="status">
                <strong>{uncertain ? 'Delivery unknown' : failed ? 'Not sent' : pending?.label ?? (state === 'retrying' ? 'Retry in progress' : 'Queued')}</strong>
                <time dateTime={item.updatedAt}>{recordedLabel(item.updatedAt)}</time>
              </div>
            </header>
            <p className="outbox-guidance">
              {uncertain
                ? 'Do not resend. Recheck the original send identity to learn whether the provider applied it.'
                : failed
                  ? 'The provider reported a definite failure. Retry will reuse the original draft and Message-ID.'
                  : pending?.detail ?? 'Your message is waiting for delivery confirmation. It will stay here until the send is resolved.'}
            </p>
            <small>
              {account?.displayName || account?.address || origin.accountId}
              {' · '}
              Draft {origin.payload.draftKey}
              {' · '}
              {item.attempts.length} {item.attempts.length === 1 ? 'attempt' : 'attempts'}
              {current.receipt?.errorCode ? ` · ${current.receipt.errorCode}` : ''}
            </small>
            <details>
              <summary>Review original message</summary>
              <dl>
                <div><dt>Command</dt><dd>{origin.commandId}</dd></div>
                {origin.payload.cc ? <div><dt>Cc</dt><dd>{origin.payload.cc}</dd></div> : null}
                {origin.payload.bcc ? <div><dt>Bcc</dt><dd>{origin.payload.bcc}</dd></div> : null}
              </dl>
              <pre>{origin.payload.bodyText}</pre>
              {origin.payload.attachments?.length ? (
                <ul aria-label="Original attachments">
                  {origin.payload.attachments.map(attachment => (
                    <li key={attachment.stageId}>{attachment.fileName}</li>
                  ))}
                </ul>
              ) : null}
            </details>
            <footer>
              {uncertain ? (
                <button onClick={() => { void onReconcile(item); }} type="button">
                  Recheck original send
                </button>
              ) : null}
              {failed ? (
                <button className="primary-button" onClick={() => onRetry(item)} type="button">
                  Retry with same Message-ID
                </button>
              ) : null}
            </footer>
          </article>
        );
      })}
    </div>
  );
}
