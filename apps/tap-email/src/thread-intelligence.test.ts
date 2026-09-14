import { describe, expect, it } from '@rstest/core';
import type { EmailAccount, EmailThread } from './domain';
import {
  applyThreadAttentionCorrection,
  explainThreadAttention,
} from './thread-intelligence';

const account: EmailAccount = {
  accountId: 'acct_work',
  provider: 'google',
  address: 'zack@example.com',
  displayName: 'Zack',
  accent: '#fff',
  coverage: {
    accountId: 'acct_work',
    state: 'current',
    newestHistoryId: '10',
    observedAt: '2026-09-14T10:00:00.000Z',
    backfillCompleteThrough: '2025-01-01T00:00:00.000Z',
    unresolvedFailures: 0,
  },
};

const thread: EmailThread = {
  threadId: 'thread_1',
  accountId: account.accountId,
  providerRevision: '10',
  subject: 'Action required: subscription payment is past due',
  participants: [{ name: 'Finance', address: 'finance@example.com' }],
  snippet: 'Please review the invoice.',
  receivedAt: '2026-09-14T09:00:00.000Z',
  unread: true,
  starred: false,
  critical: true,
  needsResponse: true,
  waitingOnOthers: false,
  status: 'inbox',
  labels: ['INBOX', 'IMPORTANT'],
  messages: [],
  reminder: null,
};

describe('explainable thread attention', () => {
  it('separates deterministic provider state from text heuristics', () => {
    const result = explainThreadAttention(
      thread,
      account,
      new Date('2026-09-14T10:00:00.000Z'),
    );
    expect(result).toMatchObject({
      urgency: 'immediate',
      requestedAction: 'Reply',
      owner: 'Zack',
      waitingOn: 'Zack',
      risks: ['billing'],
      confidence: 'medium',
    });
    expect(result.evidence).toContainEqual(expect.objectContaining({
      source: 'provider-state',
    }));
    expect(result.evidence).toContainEqual(expect.objectContaining({
      source: 'message-text',
    }));
  });

  it('makes due reminders immediate and identifies the waiting party', () => {
    const result = explainThreadAttention({
      ...thread,
      critical: false,
      needsResponse: false,
      waitingOnOthers: true,
      reminder: {
        reminderId: 'reminder_1',
        accountId: account.accountId,
        threadId: thread.threadId,
        dueAt: '2026-09-14T09:30:00.000Z',
        condition: 'if_no_reply',
        createdAt: '2026-09-13T09:30:00.000Z',
      },
    }, account, new Date('2026-09-14T10:00:00.000Z'));
    expect(result).toMatchObject({
      urgency: 'immediate',
      requestedAction: 'Follow up',
      owner: 'Finance',
      waitingOn: 'Finance',
      dueAt: '2026-09-14T09:30:00.000Z',
    });
  });

  it('applies mutually exclusive user corrections', () => {
    expect(applyThreadAttentionCorrection(thread, {
      critical: false,
      responseState: 'waiting',
    })).toMatchObject({
      critical: false,
      needsResponse: false,
      waitingOnOthers: true,
    });
  });

  it('attributes corrected triage to the user instead of provider state', () => {
    const result = explainThreadAttention({
      ...thread,
      critical: false,
      needsResponse: false,
      waitingOnOthers: true,
      attentionCorrection: {
        critical: false,
        responseState: 'waiting',
        correctedAt: '2026-09-14T09:45:00.000Z',
      },
    }, account, new Date('2026-09-14T10:00:00.000Z'));

    expect(result.evidence).toContainEqual({
      source: 'user-correction',
      detail: 'You marked this thread not critical.',
    });
    expect(result.evidence).toContainEqual({
      source: 'user-correction',
      detail: 'You marked this thread as waiting on someone else.',
    });
    expect(result.evidence).not.toContainEqual(expect.objectContaining({
      source: 'provider-state',
    }));
  });

  it('does not claim complete evidence or high confidence from partial coverage', () => {
    const result = explainThreadAttention({
      ...thread,
      subject: 'Could you take a look?',
      snippet: 'Please reply when you can.',
      critical: false,
    }, {
      ...account,
      coverage: {
        ...account.coverage,
        state: 'backfilling',
      },
    }, new Date('2026-09-14T10:00:00.000Z'));

    expect(result.confidence).toBe('medium');
    expect(result.evidence).toContainEqual({
      source: 'provider-state',
      detail: 'The latest locally available message is from someone else; mailbox coverage is partial.',
    });
    expect(result.evidence.map(item => item.detail).join(' ')).not.toContain('latest covered');
  });
});
