import { describe, expect, it } from '@rstest/core';
import type {
  MailCommand,
  MailCommandReceipt,
} from '@tap-examples/tap-email-protocol';
import {
  incompleteEmailActivityProjection,
  localActivityRecordFromReceipt,
  isEmailActivityProjection,
  parseEmailActivitySummaryRequest,
  summarizeEmailActivity,
  type EmailActivityProjection,
} from './activity';

const command: MailCommand = {
  v: 1,
  commandId: 'cmd_1',
  idempotencyKey: 'tap-email:account-secret:cmd_1',
  accountId: 'account-secret',
  threadId: 'thread-secret',
  kind: 'send_draft',
  createdAt: '2026-09-13T13:58:00.000Z',
  expectedProviderRevision: 'provider-secret',
  payload: {
    to: 'private@example.test',
    subject: 'Private subject',
    bodyText: 'Private body',
    replyToMessageId: 'message-secret',
  },
};

const receipt: MailCommandReceipt = {
  commandId: command.commandId,
  idempotencyKey: command.idempotencyKey,
  accountId: command.accountId,
  state: 'applied',
  acceptedAt: '2026-09-13T13:59:00.000Z',
  providerAcknowledgedAt: '2026-09-13T14:00:00.000Z',
  errorCode: null,
};

const projection: EmailActivityProjection = {
  schemaVersion: 1,
  generatedAt: '2026-09-14T00:00:00.000Z',
  entries: [
    {
      action: 'reply_sent',
      outcome: 'applied',
      occurredAt: '2026-09-13T14:00:00.000Z',
      timeSource: 'provider_acknowledged_at',
    },
    {
      action: 'thread_archived',
      outcome: 'failed',
      occurredAt: '2026-09-13T15:00:00.000Z',
      timeSource: 'coordinator_accepted_at',
    },
    {
      action: 'thread_starred',
      outcome: 'applied',
      occurredAt: '2026-09-14T00:00:00.000Z',
      timeSource: 'provider_acknowledged_at',
    },
  ],
  coverage: {
    scope: 'installation',
    source: 'private-profile-sqlite',
    trackingStartedAt: '2026-09-01T00:00:00.000Z',
    retainedAfter: '2026-09-01T00:00:00.000Z',
    availableFrom: '2026-09-01T00:00:00.000Z',
    truncated: false,
    warnings: [],
  },
};

describe('privacy-bounded email activity', () => {
  it('derives a content-free record from an authoritative terminal receipt', () => {
    const record = localActivityRecordFromReceipt(command, receipt);

    expect(record).toEqual({
      idempotencyKey: command.idempotencyKey,
      action: 'reply_sent',
      outcome: 'applied',
      occurredAt: receipt.providerAcknowledgedAt,
      timeSource: 'provider_acknowledged_at',
    });
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain('private@example.test');
    expect(serialized).not.toContain('Private subject');
    expect(serialized).not.toContain('Private body');
    expect(serialized).not.toContain('thread-secret');
  });

  it('does not turn provider-draft autosave revisions into user activity', () => {
    expect(localActivityRecordFromReceipt({
      ...command,
      kind: 'save_draft',
    }, receipt)).toBeNull();
  });

  it('rejects nonterminal or mismatched receipts', () => {
    expect(() => localActivityRecordFromReceipt(command, {
      ...receipt,
      state: 'accepted',
      providerAcknowledgedAt: null,
    })).toThrow('terminal');
    expect(() => localActivityRecordFromReceipt(command, {
      ...receipt,
      accountId: 'another-account',
    })).toThrow('does not match');
  });

  it('aggregates a half-open range without exposing identities or timelines', () => {
    const summary = summarizeEmailActivity(
      projection,
      parseEmailActivitySummaryRequest({
        start_at: '2026-09-13T00:00:00-04:00',
        end_at_exclusive: '2026-09-13T20:00:00-04:00',
        timezone: 'America/New_York',
      }),
    );

    expect(summary.counts.total).toBe(2);
    expect(summary.counts.applied).toBe(1);
    expect(summary.counts.byAction.reply_sent.applied).toBe(1);
    expect(summary.counts.byAction.thread_archived.failed).toBe(1);
    expect(summary.failures).toEqual({
      total: 1,
      failed: 1,
      uncertain: 0,
      cancelled: 0,
    });
    expect(summary.coverage.complete).toBe(true);
    expect(summary.coverage.warnings.join(' ')).toContain(
      'coordinator acceptance time',
    );
    const serialized = JSON.stringify(summary);
    for (const forbidden of [
      'account-secret',
      'thread-secret',
      'private@example.test',
      'Private subject',
      'occurredAt',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('fails coverage closed outside the retained projection', () => {
    const summary = summarizeEmailActivity(projection, {
      startAt: '2026-08-01T00:00:00.000Z',
      endAtExclusive: '2026-09-14T00:00:00.000Z',
      timeZone: 'UTC',
    });

    expect(summary.coverage.complete).toBe(false);
    expect(summary.coverage.warnings.join(' ')).toContain('before retained');
  });

  it('never claims complete coverage from a truncated or integrity-warned projection', () => {
    const request = {
      startAt: '2026-09-13T00:00:00.000Z',
      endAtExclusive: '2026-09-14T00:00:00.000Z',
      timeZone: 'UTC',
    } as const;
    const truncated = summarizeEmailActivity({
      ...projection,
      coverage: {
        ...projection.coverage,
        truncated: true,
        warnings: [
          'The rolling activity projection contains only the newest 2048 committed actions.',
        ],
      },
    }, request);
    const malformedRowOmitted = summarizeEmailActivity({
      ...projection,
      coverage: {
        ...projection.coverage,
        warnings: ['One or more malformed local activity records were omitted.'],
      },
    }, request);

    expect(truncated.coverage.complete).toBe(false);
    expect(truncated.coverage.projectionTruncated).toBe(true);
    expect(malformedRowOmitted.coverage.complete).toBe(false);
  });

  it('keeps partial counts content-free while reconciliation forces coverage incomplete', () => {
    const incomplete = incompleteEmailActivityProjection(
      projection,
      '2026-09-14T00:01:00.000Z',
    );
    const summary = summarizeEmailActivity(incomplete, {
      startAt: '2026-09-13T00:00:00.000Z',
      endAtExclusive: '2026-09-14T00:00:00.000Z',
      timeZone: 'UTC',
    });

    expect(summary.counts.total).toBe(2);
    expect(summary.coverage.complete).toBe(false);
    expect(summary.coverage.warnings.join(' ')).toContain('awaiting private activity reconciliation');
    const serialized = JSON.stringify(incomplete);
    expect(serialized).not.toContain(command.commandId);
    expect(serialized).not.toContain(command.accountId);
    expect(serialized).not.toContain(command.threadId);
  });

  it('rejects syntactically plausible but nonexistent timezones', () => {
    expect(() => parseEmailActivitySummaryRequest({
      start_at: '2026-09-13T00:00:00-04:00',
      end_at_exclusive: '2026-09-14T00:00:00-04:00',
      timezone: 'Mars/Olympus_Mons',
    })).toThrow('IANA timezone');
  });

  it('rejects undeclared projection fields instead of publishing hidden content', () => {
    expect(isEmailActivityProjection({
      ...projection,
      subject: 'must not escape',
    })).toBe(false);
    expect(isEmailActivityProjection({
      ...projection,
      entries: [{
        ...projection.entries[0],
        recipient: 'private@example.test',
      }],
    })).toBe(false);
    expect(isEmailActivityProjection({
      ...projection,
      coverage: {
        ...projection.coverage,
        accountId: 'account-secret',
      },
    })).toBe(false);
  });
});
