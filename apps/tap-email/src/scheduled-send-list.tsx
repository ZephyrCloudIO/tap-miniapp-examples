import type { ScheduledSendSummary } from '@tap-examples/tap-email-protocol';
import React from 'react';
import type { EmailAccount } from './domain';

export interface ScheduledSendListProps {
  readonly accounts: readonly EmailAccount[];
  readonly items: readonly ScheduledSendSummary[];
  readonly now?: Date;
  readonly onCancel: (item: ScheduledSendSummary) => void;
}

function dueLabel(dueAt: string, now: Date): string {
  const due = new Date(dueAt);
  const sameYear = due.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(undefined, {
    ...(sameYear ? {} : { year: 'numeric' as const }),
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(due);
}

export function ScheduledSendList({
  accounts,
  items,
  now = new Date(),
  onCancel,
}: ScheduledSendListProps) {
  if (items.length === 0) {
    return (
      <div className="zero-state scheduled-zero-state">
        <h2>No scheduled messages</h2>
        <p>Messages you schedule will remain provider-visible drafts until delivery.</p>
      </div>
    );
  }
  return (
    <div aria-label="Scheduled messages" className="scheduled-send-list" role="list">
      {items.map(item => {
        const account = accounts.find(candidate => candidate.accountId === item.accountId);
        const needsAttention = item.state === 'failed' || item.state === 'uncertain';
        return (
          <article className={needsAttention ? 'needs-attention' : ''} key={item.scheduleCommandId} role="listitem">
            <div className="scheduled-send-main">
              <strong>{item.subject || '(no subject)'}</strong>
              <span>To {item.to}</span>
              <small>
                {account?.displayName || account?.address || item.accountId}
                {' · '}
                {item.cancelIfReply ? 'Cancel if they reply' : 'Send regardless of replies'}
              </small>
            </div>
            <div className="scheduled-send-status">
              <time dateTime={item.dueAt}>{dueLabel(item.dueAt, now)}</time>
              <span>{needsAttention ? `Needs attention${item.errorCode ? ` · ${item.errorCode}` : ''}` : item.state}</span>
              {item.state === 'pending' || item.state === 'enqueued' ? (
                <button onClick={() => onCancel(item)} type="button">Cancel send</button>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}
