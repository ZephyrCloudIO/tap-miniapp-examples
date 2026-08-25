import { describe, expect, it } from '@rstest/core';
import {
  isMailCommand,
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
        expectedProviderRevision: 'history_10',
        payload: {},
      }),
    ).toBe(true);
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
});
