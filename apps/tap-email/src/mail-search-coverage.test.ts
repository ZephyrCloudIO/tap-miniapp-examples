import { describe, expect, it } from '@rstest/core';
import {
  createMailSearchCoverageReceipt,
  mailSearchCoverageLabel,
} from './mail-search-coverage';

describe('mail search coverage receipts', () => {
  it('reports the common historical horizon and partial account failures', () => {
    const receipt = createMailSearchCoverageReceipt([
      {
        accountId: 'personal',
        state: 'current',
        newestHistoryId: '10',
        observedAt: '2026-09-14T12:00:00.000Z',
        backfillCompleteThrough: '2020-01-01T00:00:00.000Z',
        unresolvedFailures: 0,
      },
      {
        accountId: 'work',
        state: 'backfilling',
        newestHistoryId: '20',
        observedAt: '2026-09-14T11:00:00.000Z',
        backfillCompleteThrough: '2025-11-01T00:00:00.000Z',
        unresolvedFailures: 1,
      },
    ]);

    expect(receipt).toMatchObject({
      accountIds: ['personal', 'work'],
      complete: false,
      commonBackfillThrough: '2025-11-01T00:00:00.000Z',
      observedThrough: '2026-09-14T11:00:00.000Z',
      unresolvedFailures: 1,
      contentScope: 'thread-metadata-and-latest-message-preview',
    });
    expect(receipt.warnings).toEqual([
      'work is backfilling.',
      'work has 1 unresolved sync failure.',
    ]);
    expect(mailSearchCoverageLabel(receipt)).toContain('Partial · 2 accounts · back to Nov 1, 2025');
  });

  it('evaluates the requested range and cached-content depth', () => {
    const receipt = createMailSearchCoverageReceipt([{
      accountId: 'work',
      state: 'current',
      newestHistoryId: '20',
      observedAt: '2026-09-14T11:00:00.000Z',
      backfillCompleteThrough: '2026-09-08T00:00:00.000Z',
      unresolvedFailures: 0,
    }], {
      timeZone: 'America/New_York',
      parsedQuery: {
        textQuery: 'board deck',
        dateRange: { startDate: '2026-09-01', endDate: '2026-09-15' },
        operators: {
          from: [],
          to: ['investor@example.test'],
          accounts: [],
          resources: [],
          labels: [],
          hasAttachment: true,
          unread: null,
          starred: null,
        },
      },
    });

    expect(receipt.complete).toBe(false);
    expect(receipt.warnings.join(' ')).toContain('before the common local horizon');
    expect(receipt.warnings.join(' ')).toContain('after the last observed mailbox state');
    expect(receipt.warnings.join(' ')).toContain('8,000 characters');
    expect(receipt.warnings.join(' ')).toContain('Recipient search');
    expect(receipt.warnings.join(' ')).toContain('Attachment search');
  });

  it('never claims complete coverage for an empty or unknown horizon', () => {
    expect(createMailSearchCoverageReceipt([]).complete).toBe(false);
    const unknown = createMailSearchCoverageReceipt([{
      accountId: 'work',
      state: 'current',
      newestHistoryId: null,
      observedAt: '2026-09-14T11:00:00.000Z',
      backfillCompleteThrough: null,
      unresolvedFailures: 0,
    }]);
    expect(unknown.complete).toBe(false);
    expect(mailSearchCoverageLabel(unknown)).toBe(
      'Partial · 1 account · historical horizon unknown',
    );
  });
});
