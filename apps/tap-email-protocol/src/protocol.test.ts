import { describe, expect, it } from '@rstest/core';
import {
  isEmailMessageRef,
  isMailCoverageReceipt,
  isMailCommand,
  isMailDraftAttachment,
  isMailDraftPayload,
  isMailSchedulePayload,
  isScheduledSendSummary,
  type MailAccountDescriptor,
  operationalZeroAllowed,
  TAP_EMAIL_PROTOCOL_VERSION,
} from './protocol';

describe('TAP Email protocol', () => {
  it('requires complete, failure-free account coverage for Operational Zero', () => {
    expect(
      operationalZeroAllowed([
        {
          accountId: 'acct_personal',
          state: 'current',
          newestHistoryId: '123',
          observedAt: '2026-08-18T12:00:00.000Z',
          backfillCompleteThrough: '2021-01-01T00:00:00.000Z',
          unresolvedFailures: 0,
        },
      ]),
    ).toBe(true);
    expect(
      operationalZeroAllowed([
        {
          accountId: 'acct_personal',
          state: 'stale',
          newestHistoryId: '123',
          observedAt: '2026-08-18T12:00:00.000Z',
          backfillCompleteThrough: null,
          unresolvedFailures: 1,
        },
      ]),
    ).toBe(false);
    expect(operationalZeroAllowed([])).toBe(false);
  });

  it('accepts an explicitly account-scoped command', () => {
    expect(
      isMailCommand({
        v: TAP_EMAIL_PROTOCOL_VERSION,
        commandId: 'cmd_1',
        idempotencyKey: 'tap-email:acct_personal:cmd_1',
        accountId: 'acct_personal',
        threadId: 'thread_1',
        kind: 'archive',
        createdAt: '2026-08-18T12:00:00.000Z',
        expectedProviderRevision: 'W/"opaque-revision=="',
        payload: {},
      }),
    ).toBe(true);
  });

  it('validates stable, revisioned draft payloads and rejects header injection', () => {
    const payload = {
      draftKey: 'draft_reply_1',
      draftRevision: 3,
      to: 'maya@example.com',
      cc: 'team@example.com',
      subject: 'Re: Launch review',
      bodyText: 'Looks good to me.',
      replyToMessageId: '<message-1@example.com>',
    };
    expect(isMailDraftPayload(payload)).toBe(true);
    expect(isMailDraftPayload({
      ...payload,
      sendAfter: '2026-08-18T12:00:05.000Z',
    })).toBe(true);
    expect(isMailDraftPayload({
      ...payload,
      sendAfter: 'after five seconds',
    })).toBe(false);
    expect(isMailCommand({
      v: TAP_EMAIL_PROTOCOL_VERSION,
      commandId: 'cmd_save_draft_1',
      idempotencyKey: 'tap-email:acct_personal:cmd_save_draft_1',
      accountId: 'acct_personal',
      threadId: 'thread_1',
      kind: 'save_draft',
      createdAt: '2026-08-18T12:00:00.000Z',
      expectedProviderRevision: 'history_1',
      payload,
    })).toBe(true);
    expect(isMailDraftPayload({
      ...payload,
      subject: 'Safe subject\r\nBcc: attacker@example.com',
    })).toBe(false);
    expect(isMailDraftPayload({
      ...payload,
      draftRevision: 0,
    })).toBe(false);
  });

  it('accepts only bounded opaque attachment stages in draft commands', () => {
    const attachment = {
      stageId: 'stage_contract_1',
      fileName: 'signed-contract.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1_024,
      sha256Base64Url: 'A'.repeat(43),
    };
    expect(isMailDraftAttachment(attachment)).toBe(true);
    expect(isMailDraftPayload({
      draftKey: 'draft_with_attachment',
      draftRevision: 2,
      to: 'maya@example.com',
      subject: 'Signed contract',
      bodyText: 'Attached.',
      attachments: [attachment],
    })).toBe(true);

    expect(isMailDraftAttachment({ ...attachment, fileName: '../secret.txt' })).toBe(false);
    expect(isMailDraftAttachment({ ...attachment, sizeBytes: 8 * 1_024 * 1_024 + 1 })).toBe(false);
    expect(isMailDraftAttachment({ ...attachment, sha256Base64Url: 'not-a-digest' })).toBe(false);
    expect(isMailDraftPayload({
      draftKey: 'draft_duplicate_attachment',
      draftRevision: 1,
      to: 'maya@example.com',
      subject: 'Duplicate',
      bodyText: 'Attached.',
      attachments: [attachment, attachment],
    })).toBe(false);
  });

  it('requires an absolute future instant and stable target for scheduled sends', () => {
    const payload = {
      draftKey: 'draft_scheduled_1',
      draftRevision: 2,
      to: 'maya@example.com',
      subject: 'Launch review',
      bodyText: 'Sending this tomorrow.',
      scheduledFor: '2026-08-19T12:00:00.000Z',
      cancelIfReply: true,
    };
    expect(isMailSchedulePayload(payload)).toBe(true);
    expect(isMailCommand({
      v: TAP_EMAIL_PROTOCOL_VERSION,
      commandId: 'cmd_schedule_1',
      idempotencyKey: 'tap-email:acct_personal:cmd_schedule_1',
      accountId: 'acct_personal',
      threadId: 'thread_1',
      kind: 'schedule_send',
      createdAt: '2026-08-18T12:00:00.000Z',
      expectedProviderRevision: 'history_1',
      payload,
    })).toBe(true);
    expect(isMailCommand({
      v: TAP_EMAIL_PROTOCOL_VERSION,
      commandId: 'cmd_schedule_past',
      idempotencyKey: 'tap-email:acct_personal:cmd_schedule_past',
      accountId: 'acct_personal',
      threadId: 'thread_1',
      kind: 'schedule_send',
      createdAt: '2026-08-20T12:00:00.000Z',
      expectedProviderRevision: 'history_1',
      payload,
    })).toBe(false);
    expect(isMailCommand({
      v: TAP_EMAIL_PROTOCOL_VERSION,
      commandId: 'cmd_cancel_1',
      idempotencyKey: 'tap-email:acct_personal:cmd_cancel_1',
      accountId: 'acct_personal',
      threadId: 'thread_1',
      kind: 'cancel_scheduled_send',
      createdAt: '2026-08-18T13:00:00.000Z',
      expectedProviderRevision: null,
      payload: { scheduledCommandId: 'cmd_schedule_1' },
    })).toBe(true);
    expect(isScheduledSendSummary({
      scheduleCommandId: 'cmd_schedule_1',
      accountId: 'acct_personal',
      threadId: 'thread_1',
      draftKey: 'draft_scheduled_1',
      to: 'maya@example.com',
      subject: 'Launch review',
      dueAt: '2026-08-19T12:00:00.000Z',
      cancelIfReply: true,
      state: 'pending',
      dispatchCommandId: null,
      errorCode: null,
    })).toBe(true);
  });

  it('rejects commands without an account partition', () => {
    expect(
      isMailCommand({
        v: TAP_EMAIL_PROTOCOL_VERSION,
        commandId: 'cmd_1',
        idempotencyKey: 'cmd_1',
        accountId: '',
        threadId: 'thread_1',
        kind: 'archive',
        createdAt: '2026-08-18T12:00:00.000Z',
        expectedProviderRevision: null,
        payload: {},
      }),
    ).toBe(false);
  });

  it('accepts exact provider-neutral message references', () => {
    expect(isEmailMessageRef({
      accountId: 'google_personal',
      threadId: 'thread_1',
      messageId: 'message_1',
    })).toBe(true);
    expect(isEmailMessageRef({
      threadId: 'thread_1',
      messageId: 'message_1',
    })).toBe(false);
  });

  it('keeps platform account descriptors open to non-Google providers', () => {
    const account: MailAccountDescriptor = {
      accountId: 'microsoft_work',
      provider: 'microsoft',
      address: 'zack@example.com',
      displayName: 'Work',
      connectionState: 'active',
      coverage: {
        accountId: 'microsoft_work',
        state: 'current',
        newestProviderRevision: 'W/"opaque-revision=="',
        observedAt: '2026-08-18T12:00:00.000Z',
        backfillCompleteThrough: '2021-01-01T00:00:00.000Z',
        unresolvedFailures: 0,
      },
    };
    expect(account.provider).toBe('microsoft');
  });

  it('validates scoped coverage receipts instead of a global completeness flag', () => {
    const validReceipt = {
      version: 1,
      observedAt: '2026-08-18T12:00:00.000Z',
      request: {
        accountIds: ['google_personal'],
        resources: ['message-content'],
        threadRefs: [{ accountId: 'google_personal', threadId: 'thread_1' }],
        messageRefs: [{
          accountId: 'google_personal',
          threadId: 'thread_1',
          messageId: 'message_1',
        }],
        afterInclusive: null,
        beforeExclusive: null,
      },
      accounts: [{
        accountId: 'google_personal',
        state: 'current',
        newestProviderRevision: '123',
        observedAt: '2026-08-18T12:00:00.000Z',
        backfillCompleteThrough: '2021-01-01T00:00:00.000Z',
        unresolvedFailures: 0,
      }],
      completeness: 'complete',
      source: 'coordinator-replica',
      fallback: 'not-needed',
      resultTruncated: false,
      nextCursor: null,
      warnings: [],
    } as const;
    expect(isMailCoverageReceipt(validReceipt)).toBe(true);
    expect(isMailCoverageReceipt({
      ...validReceipt,
      accounts: [],
    })).toBe(false);
    expect(isMailCoverageReceipt({
      ...validReceipt,
      request: {
        ...validReceipt.request,
        resources: ['message-content', 'message-content'],
      },
    })).toBe(false);
    expect(isMailCoverageReceipt({
      ...validReceipt,
      request: {
        ...validReceipt.request,
        messageRefs: [{
          accountId: 'another_account',
          threadId: 'thread_1',
          messageId: 'message_1',
        }],
      },
    })).toBe(false);
  });
});
