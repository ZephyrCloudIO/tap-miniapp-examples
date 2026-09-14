import * as React from 'react';
import type {
  EmailAccount,
  EmailThread,
  ThreadAttentionCorrectionRecord,
} from './domain';
import {
  explainThreadAttention,
  type AttentionEvidence,
  type AttentionRisk,
  type AttentionUrgency,
} from './thread-intelligence';

type ResponseState = NonNullable<ThreadAttentionCorrectionRecord['responseState']>;

export interface ThreadAttentionCorrectionInput {
  readonly critical?: boolean;
  readonly responseState?: ResponseState;
}

export interface ThreadAttentionPanelProps {
  readonly account: EmailAccount | null;
  readonly now: Date;
  readonly onCorrect: (correction: ThreadAttentionCorrectionInput) => void;
  readonly thread: EmailThread;
  readonly timeZone: string;
}

const urgencyLabels: Readonly<Record<AttentionUrgency, string>> = {
  immediate: 'Immediate',
  soon: 'Soon',
  normal: 'Normal',
  none: 'No action',
};

const riskLabels: Readonly<Record<AttentionRisk, string>> = {
  billing: 'Billing',
  relationship: 'Relationship',
  security: 'Security',
};

const evidenceLabels: Readonly<Record<AttentionEvidence['source'], string>> = {
  'message-text': 'Text pattern',
  'provider-state': 'Mailbox state',
  reminder: 'Reminder',
  'user-correction': 'Your correction',
};

function currentResponseState(thread: EmailThread): ResponseState {
  if (thread.needsResponse) return 'needs-response';
  if (thread.waitingOnOthers) return 'waiting';
  return 'none';
}

function formatDueAt(dueAt: string, timeZone: string): string {
  const date = new Date(dueAt);
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone,
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(date);
  }
}

function riskSummary(risks: readonly AttentionRisk[]): string {
  return risks.length === 0
    ? 'No flagged risk'
    : `${risks.map(risk => riskLabels[risk]).join(', ')} risk`;
}

export function ThreadAttentionPanel({
  account,
  now,
  onCorrect,
  thread,
  timeZone,
}: ThreadAttentionPanelProps) {
  const explanation = explainThreadAttention(thread, account, now);
  const responseState = currentResponseState(thread);
  const dueLabel = explanation.dueAt
    ? formatDueAt(explanation.dueAt, timeZone)
    : null;

  const correctCritical = (critical: boolean) => {
    if (critical === thread.critical) return;
    onCorrect({ critical });
  };
  const correctResponseState = (nextResponseState: ResponseState) => {
    if (nextResponseState === responseState) return;
    onCorrect({ responseState: nextResponseState });
  };

  return (
    <details className="attention-panel">
      <summary
        aria-label={`Explain ${explanation.requestedAction.toLocaleLowerCase()} recommendation and correct triage`}
        className="attention-panel-summary"
      >
        <span className="attention-action">{explanation.requestedAction}</span>
        <span className={`attention-urgency is-${explanation.urgency}`}>
          {urgencyLabels[explanation.urgency]}
        </span>
        <span>Owner: {explanation.owner}</span>
        <span>Waiting: {explanation.waitingOn ?? 'No one'}</span>
        {explanation.dueAt && dueLabel ? (
          <time dateTime={explanation.dueAt}>Due: {dueLabel}</time>
        ) : null}
        <span>{riskSummary(explanation.risks)}</span>
        <span className="attention-confidence">
          {explanation.confidence[0]?.toLocaleUpperCase()}{explanation.confidence.slice(1)} confidence
        </span>
        <span aria-hidden="true" className="attention-expand-label">Why &amp; correct</span>
      </summary>

      <div className="attention-panel-details">
        <section aria-labelledby="attention-evidence-heading" className="attention-evidence">
          <h3 id="attention-evidence-heading">Why TAP placed it here</h3>
          {explanation.evidence.length > 0 ? (
            <ul>
              {explanation.evidence.map((item, index) => (
                <li key={`${item.source}:${index}`}>
                  <span>{evidenceLabels[item.source]}</span>
                  <p>{item.detail}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p>No attention signal is active. TAP is not claiming this thread needs action.</p>
          )}
        </section>

        <section aria-labelledby="attention-correct-heading" className="attention-correction">
          <h3 id="attention-correct-heading">Correct TAP’s view</h3>
          <div aria-label="Urgency classification" className="attention-choice-group" role="group">
            <button
              aria-pressed={thread.critical}
              onClick={() => correctCritical(true)}
              type="button"
            >
              Critical
            </button>
            <button
              aria-pressed={!thread.critical}
              onClick={() => correctCritical(false)}
              type="button"
            >
              Not critical
            </button>
          </div>
          <div aria-label="Response ownership" className="attention-choice-group" role="group">
            <button
              aria-pressed={responseState === 'needs-response'}
              onClick={() => correctResponseState('needs-response')}
              type="button"
            >
              Needs my reply
            </button>
            <button
              aria-pressed={responseState === 'waiting'}
              onClick={() => correctResponseState('waiting')}
              type="button"
            >
              Waiting on them
            </button>
            <button
              aria-pressed={responseState === 'none'}
              onClick={() => correctResponseState('none')}
              type="button"
            >
              No response needed
            </button>
          </div>
          <p>Corrections stay in TAP Email and survive provider sync.</p>
        </section>
      </div>
    </details>
  );
}
