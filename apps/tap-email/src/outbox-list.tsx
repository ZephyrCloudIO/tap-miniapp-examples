import React from 'react';
import type { EmailAccount, RecoverableImmediateSend } from './domain';

export interface OutboxListProps {
  readonly accounts: readonly EmailAccount[];
  readonly items: readonly RecoverableImmediateSend[];
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
  onReconcile,
  onRetry,
}: OutboxListProps) {
  if (items.length === 0) {
    return (
      <div className="zero-state outbox-zero-state">
        <h2>No sends need attention</h2>
        <p>Failed or delivery-unknown sends will remain here until safely resolved.</p>
      </div>
    );
  }
  return (
    <div aria-label="Outbox items needing attention" className="outbox-list" role="list">
      {items.map(item => {
        const origin = item.attempts[0]!.command;
        const current = item.attempts[item.attempts.length - 1]!;
        const account = accounts.find(candidate => candidate.accountId === origin.accountId);
        const state = current.receipt?.state ?? 'retrying';
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
                <strong>{uncertain ? 'Delivery unknown' : failed ? 'Not sent' : 'Retry in progress'}</strong>
                <time dateTime={item.updatedAt}>{recordedLabel(item.updatedAt)}</time>
              </div>
            </header>
            <p className="outbox-guidance">
              {uncertain
                ? 'Do not resend. Recheck the original send identity to learn whether the provider applied it.'
                : failed
                  ? 'The provider reported a definite failure. Retry will reuse the original draft and Message-ID.'
                  : 'The original draft and Message-ID are being reused. Wait for this attempt to settle.'}
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
