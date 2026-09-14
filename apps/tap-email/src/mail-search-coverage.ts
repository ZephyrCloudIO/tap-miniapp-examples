import type { AccountCoverage } from '@tap-examples/tap-email-protocol';
import type { ParsedMailSearchQuery } from './mail-search';

export interface MailSearchCoverageRequest {
  readonly parsedQuery: Pick<ParsedMailSearchQuery, 'textQuery' | 'dateRange' | 'operators'>;
  readonly timeZone: string;
}

export interface MailSearchCoverageReceipt {
  readonly accountIds: readonly string[];
  readonly complete: boolean;
  /** Oldest instant covered by every selected account, when known. */
  readonly commonBackfillThrough: string | null;
  readonly observedThrough: string | null;
  readonly unresolvedFailures: number;
  readonly contentScope: 'thread-metadata-and-latest-message-preview';
  readonly warnings: readonly string[];
}

export function createMailSearchCoverageReceipt(
  coverage: readonly AccountCoverage[],
  request?: MailSearchCoverageRequest,
): MailSearchCoverageReceipt {
  const commonBackfillThrough = coverage.some(item => item.backfillCompleteThrough === null)
    ? null
    : coverage.map(item => item.backfillCompleteThrough!).toSorted().at(-1) ?? null;
  const observedThrough = coverage.map(item => item.observedAt).toSorted().at(0) ?? null;
  const unresolvedFailures = coverage.reduce(
    (total, item) => total + item.unresolvedFailures,
    0,
  );
  const warnings = coverage.flatMap(item => [
    ...(item.state === 'current' ? [] : [`${item.accountId} is ${item.state}.`]),
    ...(item.backfillCompleteThrough === null
      ? [`${item.accountId} has no verified historical horizon.`]
      : []),
    ...(item.unresolvedFailures > 0
      ? [`${item.accountId} has ${item.unresolvedFailures} unresolved sync failure${item.unresolvedFailures === 1 ? '' : 's'}.`]
      : []),
  ]);
  const requestedStart = request?.parsedQuery.dateRange?.startDate;
  const requestedEnd = request?.parsedQuery.dateRange?.endDate;
  if (
    requestedStart &&
    commonBackfillThrough &&
    localDateKey(commonBackfillThrough, request.timeZone) > requestedStart
  ) {
    warnings.push(
      `The requested range begins before the common local horizon (${commonBackfillThrough}).`,
    );
  }
  if (
    requestedEnd &&
    observedThrough &&
    localDateKey(observedThrough, request.timeZone) < requestedEnd
  ) {
    warnings.push(
      `The requested range ends after the last observed mailbox state (${observedThrough}).`,
    );
  }
  if (request?.parsedQuery.textQuery.trim()) {
    warnings.push(
      'Text and meaning search cover thread metadata plus the latest locally cached message preview; older messages and content beyond 8,000 characters are not proven complete.',
    );
  }
  if (request?.parsedQuery.operators?.to.length) {
    warnings.push(
      'Recipient search covers locally cached message headers and may omit recipients from messages that have not been opened locally.',
    );
  }
  if (request?.parsedQuery.operators?.hasAttachment !== null &&
      request?.parsedQuery.operators?.hasAttachment !== undefined) {
    warnings.push(
      'Attachment search covers locally cached message metadata and may omit attachments from messages that have not been opened locally.',
    );
  }
  return {
    accountIds: coverage.map(item => item.accountId),
    complete: coverage.length > 0 && warnings.length === 0,
    commonBackfillThrough,
    observedThrough,
    unresolvedFailures,
    contentScope: 'thread-metadata-and-latest-message-preview',
    warnings,
  };
}

function localDateKey(timestamp: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    calendar: 'gregory',
    numberingSystem: 'latn',
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp));
  const values = new Map(parts.map(part => [part.type, part.value]));
  return `${values.get('year')}-${values.get('month')}-${values.get('day')}`;
}

function shortDate(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(date)
    : timestamp;
}

export function mailSearchCoverageLabel(receipt: MailSearchCoverageReceipt): string {
  const accounts = `${receipt.accountIds.length} account${receipt.accountIds.length === 1 ? '' : 's'}`;
  const horizon = receipt.commonBackfillThrough
    ? `back to ${shortDate(receipt.commonBackfillThrough)}`
    : 'historical horizon unknown';
  return `${receipt.complete ? 'Covered locally' : 'Partial'} · ${accounts} · ${horizon}`;
}
