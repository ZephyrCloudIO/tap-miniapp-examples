import { describe, expect, it } from '@rstest/core';
import type { EmailThread } from './domain';
import {
  filterMailThreads,
  parseMailSearchQuery,
  threadMatchesMailDate,
  type MailSearchContext,
} from './mail-search';

const newYorkNow: MailSearchContext = {
  // 00:30 on September 13 in New York, but September 13 in UTC too; message
  // fixtures around midnight below verify the local calendar boundary.
  now: '2026-09-13T04:30:00.000Z',
  timeZone: 'America/New_York',
};

function thread(
  threadId: string,
  receivedAt: string,
  subject = threadId,
  messageTimes: readonly string[] = [],
): EmailThread {
  return {
    threadId,
    accountId: 'google_work',
    providerRevision: `history_${threadId}`,
    subject,
    participants: [{ name: 'PitchBook Research', address: 'research@pitchbook.com' }],
    snippet: 'Private market briefing',
    receivedAt,
    unread: false,
    starred: false,
    critical: false,
    needsResponse: false,
    waitingOnOthers: false,
    status: 'inbox',
    labels: ['INBOX'],
    messages: messageTimes.map((sentAt, index) => ({
      messageId: `${threadId}_${index}`,
      from: { name: 'PitchBook Research', address: 'research@pitchbook.com' },
      to: [{ name: 'Zack', address: 'zack@example.com' }],
      sentAt,
      bodyText: 'Private market briefing',
    })),
    reminder: null,
  };
}

describe('mail date search', () => {
  it('resolves today and yesterday in the supplied time zone, not UTC', () => {
    const context = {
      now: '2026-09-13T03:30:00.000Z', // Sep 12, 11:30 PM in New York
      timeZone: 'America/New_York',
    } satisfies MailSearchContext;

    expect(parseMailSearchQuery('today', context)).toEqual({
      textQuery: '',
      dateRange: { startDate: '2026-09-12', endDate: '2026-09-12' },
    });
    expect(parseMailSearchQuery('yesterday', context)).toEqual({
      textQuery: '',
      dateRange: { startDate: '2026-09-11', endDate: '2026-09-11' },
    });
  });

  it('parses exact ISO, named, abbreviated, reversed, and numeric dates', () => {
    for (const query of [
      '2026-09-08',
      'September 8th, 2026',
      'Sep 8 2026',
      '8 September 2026',
      '9/8/2026',
    ]) {
      expect(parseMailSearchQuery(query, newYorkNow).dateRange).toEqual({
        startDate: '2026-09-08',
        endDate: '2026-09-08',
      });
    }
  });

  it('infers the most recent occurrence when an exact date omits its year', () => {
    expect(parseMailSearchQuery('September 8th', newYorkNow).dateRange).toEqual({
      startDate: '2026-09-08',
      endDate: '2026-09-08',
    });
    expect(parseMailSearchQuery('December 20', newYorkNow).dateRange).toEqual({
      startDate: '2025-12-20',
      endDate: '2025-12-20',
    });
  });

  it('supports calendar week, month, and common relative ranges', () => {
    expect(parseMailSearchQuery('this week', newYorkNow).dateRange).toEqual({
      startDate: '2026-09-07',
      endDate: '2026-09-13',
    });
    expect(parseMailSearchQuery('last week', newYorkNow).dateRange).toEqual({
      startDate: '2026-08-31',
      endDate: '2026-09-06',
    });
    expect(parseMailSearchQuery('August', newYorkNow).dateRange).toEqual({
      startDate: '2026-08-01',
      endDate: '2026-08-31',
    });
    expect(parseMailSearchQuery('last 7 days', newYorkNow).dateRange).toEqual({
      startDate: '2026-09-07',
      endDate: '2026-09-13',
    });
    expect(parseMailSearchQuery('3 days ago', newYorkNow).dateRange).toEqual({
      startDate: '2026-09-10',
      endDate: '2026-09-10',
    });
  });

  it('keeps remaining text so normal search and a date predicate can combine', () => {
    expect(parseMailSearchQuery('PitchBook on September 8th', newYorkNow)).toEqual({
      textQuery: 'PitchBook',
      dateRange: { startDate: '2026-09-08', endDate: '2026-09-08' },
    });
  });

  it('keeps semantic intent while resolving natural date phrases', () => {
    expect(parseMailSearchQuery('VC emails from last week', newYorkNow)).toEqual({
      textQuery: 'VC emails',
      dateRange: { startDate: '2026-08-31', endDate: '2026-09-06' },
    });
  });

  it('parses deterministic mailbox operators without treating them as search text', () => {
    expect(parseMailSearchQuery(
      'term sheet from:"PitchBook Research" to:zack@example.com account:google_work in:starred label:INBOX has:attachment is:unread yesterday',
      newYorkNow,
    )).toEqual({
      textQuery: 'term sheet',
      dateRange: { startDate: '2026-09-12', endDate: '2026-09-12' },
      operators: {
        from: ['pitchbook research'],
        to: ['zack@example.com'],
        accounts: ['google_work'],
        resources: ['starred'],
        labels: ['inbox'],
        hasAttachment: true,
        unread: true,
        starred: null,
      },
    });
  });

  it('leaves invalid and unrecognized date-looking text as ordinary search text', () => {
    expect(parseMailSearchQuery('February 30 report', newYorkNow)).toEqual({
      textQuery: 'February 30 report',
      dateRange: null,
    });
    expect(parseMailSearchQuery('launch whenever', newYorkNow)).toEqual({
      textQuery: 'launch whenever',
      dateRange: null,
    });
  });

  it('matches a thread when its local received date or any message date is in range', () => {
    const receivedJustBeforeLocalMidnight = thread(
      'boundary',
      '2026-09-13T03:59:00.000Z', // Sep 12 in New York
    );
    const olderThreadWithMatchingMessage = thread(
      'conversation',
      '2026-09-10T16:00:00.000Z',
      'Older conversation',
      ['2026-09-12T18:00:00.000Z'],
    );
    const dateRange = parseMailSearchQuery('yesterday', newYorkNow).dateRange;

    expect(threadMatchesMailDate(receivedJustBeforeLocalMidnight, dateRange, newYorkNow.timeZone)).toBe(true);
    expect(threadMatchesMailDate(olderThreadWithMatchingMessage, dateRange, newYorkNow.timeZone)).toBe(true);
  });

  it('filters date-only and combined date/text queries without changing ordinary text search', () => {
    const otherYesterday = {
      ...thread('other-yesterday', '2026-09-12T15:00:00.000Z', 'Team update'),
      participants: [{ name: 'Operations', address: 'ops@example.com' }],
    } satisfies EmailThread;
    const threads = [
      thread('pitchbook-yesterday', '2026-09-12T14:00:00.000Z', 'PitchBook daily'),
      otherYesterday,
      thread('pitchbook-today', '2026-09-13T14:00:00.000Z', 'PitchBook research'),
    ];

    expect(filterMailThreads(threads, 'yesterday', newYorkNow).map(item => item.threadId)).toEqual([
      'pitchbook-yesterday',
      'other-yesterday',
    ]);
    expect(filterMailThreads(threads, 'PitchBook yesterday', newYorkNow).map(item => item.threadId)).toEqual([
      'pitchbook-yesterday',
    ]);
    expect(filterMailThreads(threads, 'Team update', newYorkNow).map(item => item.threadId)).toEqual([
      'other-yesterday',
    ]);
  });

  it('applies account, sender, recipient, resource, label, attachment, and state operators', () => {
    const matching = {
      ...thread('matching', '2026-09-12T14:00:00.000Z', 'Term sheet'),
      unread: true,
      starred: true,
      providerResources: ['inbox', 'starred'] as const,
      messages: [{
        messageId: 'message_matching',
        from: { name: 'PitchBook Research', address: 'research@pitchbook.com' },
        to: [{ name: 'Zack', address: 'zack@example.com' }],
        sentAt: '2026-09-12T14:00:00.000Z',
        bodyText: 'A venture capital term sheet update.',
        attachments: [{
          resourceId: 'term_sheet_pdf',
          fileName: 'term-sheet.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 123,
          disposition: 'attachment' as const,
          contentId: null,
        }],
      }],
    } satisfies EmailThread;
    const notMatching = thread('other', '2026-09-12T14:00:00.000Z', 'Other');
    const query = 'venture capital from:pitchbook to:zack account:google_work in:starred label:inbox has:attachment is:unread yesterday';

    expect(filterMailThreads([matching, notMatching], query, newYorkNow)).toEqual([matching]);
    expect(filterMailThreads([matching], 'is:read', newYorkNow)).toEqual([]);
    expect(filterMailThreads([matching], 'has:no-attachment', newYorkNow)).toEqual([]);
  });
});
