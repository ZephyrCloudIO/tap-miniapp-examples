import type { MailboxSummary } from '@tap-examples/tap-email-protocol';
import { emailThreadKey, mailboxSummary, projectedThreads, threadMatchesSplit, type EmailThread, type MailSplit, type MailState } from './domain';

export const countedThreadSplits = ['inbox', 'starred', 'drafts', 'sent', 'done', 'reminders', 'spam', 'trash', 'critical', 'needs-response', 'waiting'] as const;
export type MailboxCounts = Readonly<Partial<Record<MailSplit, number>>>;
export type ReplicaMailboxSummary = MailboxSummary & { readonly mailboxCounts: MailboxCounts };
export interface MailboxCountSnapshot {
  readonly accountId: string;
  readonly value: MailboxSummary & { readonly mailboxCounts?: MailboxCounts };
  readonly intents: MailState['pendingThreadIntents'];
  readonly threads: Map<string, EmailThread>;
}

export function countThreadSplits(threads: readonly EmailThread[]): Record<typeof countedThreadSplits[number], number> {
  return Object.fromEntries(countedThreadSplits.map(split => [split, threads.filter(thread => threadMatchesSplit(thread, split)).length])) as Record<typeof countedThreadSplits[number], number>;
}

/** Retain flags, never another body cache, when establishing the count baseline. */
export function rememberCountThreads(snapshot: MailboxCountSnapshot, threads: readonly EmailThread[]): void {
  for (const thread of threads) {
    if (!snapshot.threads.has(emailThreadKey(thread))) snapshot.threads.set(emailThreadKey(thread), { ...thread, messages: [] });
  }
}

/** Local actions update the full-replica totals immediately, including after acknowledgement. */
export function projectMailboxCounts(snapshot: MailboxCountSnapshot, state: MailState, now: string): ReplicaMailboxSummary {
  const current = state.threads.filter(thread => state.selectedAccountId === 'all' || thread.accountId === state.selectedAccountId);
  const before = projectedThreads({ threads: current.map(thread => snapshot.threads.get(emailThreadKey(thread)) ?? thread), pendingThreadIntents: snapshot.intents });
  const after = projectedThreads({ threads: current, pendingThreadIntents: state.pendingThreadIntents });
  const oldCounts = countThreadSplits(before);
  const newCounts = countThreadSplits(after);
  const mailboxCounts = { ...snapshot.value.mailboxCounts };
  // Older custom store ports may supply only the attention summary.
  const known = { inbox: snapshot.value.inbox, critical: snapshot.value.critical, 'needs-response': snapshot.value.needsResponse, waiting: snapshot.value.waiting };
  for (const [split, value] of Object.entries(known)) if (mailboxCounts[split as MailSplit] === undefined) mailboxCounts[split as MailSplit] = value;
  for (const split of countedThreadSplits) {
    if (mailboxCounts[split] !== undefined) mailboxCounts[split] = Math.max(0, mailboxCounts[split]! + newCounts[split] - oldCounts[split]);
  }
  const live = mailboxSummary({ ...state, accounts: state.accounts.filter(account => state.selectedAccountId === 'all' || account.accountId === state.selectedAccountId) }, now, after);
  const oldReminders = mailboxSummary({ ...state, threads: [], pendingThreadIntents: [] }, now, before).dueReminders;
  const dueReminders = Math.max(0, snapshot.value.dueReminders + live.dueReminders - oldReminders);
  const critical = mailboxCounts.critical!;
  const needsResponse = mailboxCounts['needs-response']!;
  const coverageComplete = snapshot.value.coverageComplete && live.coverageComplete;
  return { ...snapshot.value, mailboxCounts, inbox: mailboxCounts.inbox!, critical, needsResponse, waiting: mailboxCounts.waiting!,
    dueReminders, failedCommands: live.failedCommands, coverageComplete,
    operationalZero: coverageComplete && critical === 0 && needsResponse === 0 && dueReminders === 0 && live.failedCommands === 0 };
}

export function countLabel(count: number | undefined, complete: boolean): string {
  return count === undefined ? '—' : `${complete ? '' : '≈'}${count}`;
}
