import type { EmailAccount, EmailThread } from './domain';

export type AttentionUrgency = 'immediate' | 'soon' | 'normal' | 'none';
export type AttentionRisk = 'billing' | 'relationship' | 'security';
export type AttentionConfidence = 'high' | 'medium' | 'low';

export interface AttentionEvidence {
  readonly source: 'message-text' | 'provider-state' | 'reminder' | 'user-correction';
  readonly detail: string;
}

export interface ThreadAttentionExplanation {
  readonly urgency: AttentionUrgency;
  readonly requestedAction: 'Follow up' | 'Read' | 'Reply' | 'Review' | 'None';
  readonly owner: string;
  readonly dueAt: string | null;
  readonly waitingOn: string | null;
  readonly risks: readonly AttentionRisk[];
  readonly evidence: readonly AttentionEvidence[];
  readonly confidence: AttentionConfidence;
}

export interface ThreadAttentionCorrection {
  readonly critical?: boolean;
  readonly responseState?: 'needs-response' | 'none' | 'waiting';
}

const riskRules: readonly {
  readonly risk: AttentionRisk;
  readonly pattern: RegExp;
  readonly label: string;
}[] = [
  {
    risk: 'security',
    pattern: /\b(?:breach|compromis(?:e|ed)|security|suspicious|vulnerabilit(?:y|ies)|verify your account)\b/iu,
    label: 'Security language appears in the subject or preview.',
  },
  {
    risk: 'billing',
    pattern: /\b(?:billing|expense|invoice|past due|payment|receipt|renewal|subscription)\b/iu,
    label: 'Billing language appears in the subject or preview.',
  },
  {
    risk: 'relationship',
    pattern: /\b(?:follow[ -]?up|introduction|intro\b|meeting|partnership|relationship)\b/iu,
    label: 'Relationship language appears in the subject or preview.',
  },
] as const;

function participantLabel(thread: EmailThread): string | null {
  const participant = thread.participants[0];
  return participant?.name.trim() || participant?.address || null;
}

/**
 * Explain current deterministic state without pretending it came from a
 * specialist. Text risks are deliberately medium-confidence heuristics and
 * always carry their evidence label.
 */
export function explainThreadAttention(
  thread: EmailThread,
  account: EmailAccount | null,
  now: Date,
): ThreadAttentionExplanation {
  const evidence: AttentionEvidence[] = [];
  const coverageCurrent = account?.coverage.state === 'current' &&
    account.coverage.unresolvedFailures === 0;
  const dueAt = thread.reminder?.dueAt ?? null;
  const due = dueAt === null ? null : Date.parse(dueAt);
  const overdue = due !== null && Number.isFinite(due) && due <= now.getTime();

  if (thread.attentionCorrection?.critical !== undefined) {
    evidence.push({
      source: 'user-correction',
      detail: thread.attentionCorrection.critical
        ? 'You marked this thread critical.'
        : 'You marked this thread not critical.',
    });
  } else if (thread.critical) {
    evidence.push({
      source: 'provider-state',
      detail: 'The thread is currently in Critical.',
    });
  }
  if (thread.attentionCorrection?.responseState !== undefined) {
    const responseCorrectionLabels = {
      'needs-response': 'You marked this thread as needing your reply.',
      waiting: 'You marked this thread as waiting on someone else.',
      none: 'You marked this thread as needing no response.',
    } as const;
    evidence.push({
      source: 'user-correction',
      detail: responseCorrectionLabels[thread.attentionCorrection.responseState],
    });
  } else if (thread.needsResponse) {
    evidence.push({
      source: 'provider-state',
      detail: coverageCurrent
        ? 'The latest covered message is from someone else and remains in Inbox.'
        : 'The latest locally available message is from someone else; mailbox coverage is partial.',
    });
  } else if (thread.waitingOnOthers) {
    evidence.push({
      source: 'provider-state',
      detail: coverageCurrent
        ? 'Your latest covered message remains in Inbox.'
        : 'Your latest locally available message remains in Inbox; mailbox coverage is partial.',
    });
  } else if (thread.unread) {
    evidence.push({
      source: 'provider-state',
      detail: 'The provider marks this thread unread.',
    });
  }
  if (dueAt) {
    evidence.push({
      source: 'reminder',
      detail: overdue ? 'The reminder is due.' : `A reminder is set for ${dueAt}.`,
    });
  }

  const searchable = `${thread.subject}\n${thread.snippet}`;
  const risks = riskRules.flatMap(rule => {
    if (!rule.pattern.test(searchable)) return [];
    evidence.push({ source: 'message-text', detail: rule.label });
    return [rule.risk];
  });

  const requestedAction = thread.needsResponse
    ? 'Reply'
    : thread.waitingOnOthers
      ? 'Follow up'
      : thread.critical
        ? 'Review'
        : thread.unread
          ? 'Read'
          : 'None';
  const urgency: AttentionUrgency = overdue || thread.critical
    ? 'immediate'
    : thread.needsResponse
      ? 'soon'
      : requestedAction === 'None'
        ? 'none'
        : 'normal';
  const external = participantLabel(thread);
  const owner = thread.waitingOnOthers
    ? external ?? 'Other participant'
    : account?.displayName || account?.address || 'You';
  const waitingOn = thread.needsResponse
    ? account?.displayName || account?.address || 'You'
    : thread.waitingOnOthers
      ? external ?? 'Other participant'
      : null;
  const confidence: AttentionConfidence = evidence.some(item => item.source === 'message-text')
    ? 'medium'
    : evidence.some(item => item.source === 'user-correction' || item.source === 'reminder')
      ? 'high'
      : evidence.length > 0
        ? coverageCurrent ? 'high' : 'medium'
        : 'low';

  return {
    urgency,
    requestedAction,
    owner,
    dueAt,
    waitingOn,
    risks,
    evidence,
    confidence,
  };
}

/** Applies an explicit correction to TAP-owned triage fields. */
export function applyThreadAttentionCorrection(
  thread: EmailThread,
  correction: ThreadAttentionCorrection,
): EmailThread {
  const responseState = correction.responseState;
  return {
    ...thread,
    ...(correction.critical === undefined ? {} : { critical: correction.critical }),
    ...(responseState === undefined
      ? {}
      : {
          needsResponse: responseState === 'needs-response',
          waitingOnOthers: responseState === 'waiting',
        }),
  };
}
