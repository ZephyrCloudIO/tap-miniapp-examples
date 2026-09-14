import {
  threadMatchesSplit,
  type EmailThread,
  type MailSplit,
} from './domain';

export interface MailSearchContext {
  /** The instant used to resolve relative phrases such as "yesterday". */
  readonly now: Date | string;
  /** IANA time zone used for both the query and message timestamps. */
  readonly timeZone: string;
}

export interface MailSearchDateRange {
  /** Inclusive local-calendar date, formatted as YYYY-MM-DD. */
  readonly startDate: string;
  /** Inclusive local-calendar date, formatted as YYYY-MM-DD. */
  readonly endDate: string;
}

export interface ParsedMailSearchQuery {
  /** Search text left after removing the recognized date expression. */
  readonly textQuery: string;
  readonly dateRange: MailSearchDateRange | null;
  readonly operators?: MailSearchOperators;
}

export interface MailSearchOperators {
  readonly from: readonly string[];
  readonly to: readonly string[];
  readonly accounts: readonly string[];
  readonly resources: readonly MailSplit[];
  readonly labels: readonly string[];
  readonly hasAttachment: boolean | null;
  readonly unread: boolean | null;
  readonly starred: boolean | null;
}

interface CalendarDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

interface DateExpression {
  readonly index: number;
  readonly text: string;
  readonly range: MailSearchDateRange;
}

const dayMilliseconds = 86_400_000;
const monthNames = new Map<string, number>([
  ['jan', 1],
  ['january', 1],
  ['feb', 2],
  ['february', 2],
  ['mar', 3],
  ['march', 3],
  ['apr', 4],
  ['april', 4],
  ['may', 5],
  ['jun', 6],
  ['june', 6],
  ['jul', 7],
  ['july', 7],
  ['aug', 8],
  ['august', 8],
  ['sep', 9],
  ['sept', 9],
  ['september', 9],
  ['oct', 10],
  ['october', 10],
  ['nov', 11],
  ['november', 11],
  ['dec', 12],
  ['december', 12],
]);
const monthPattern = [...monthNames.keys()]
  .toSorted((left, right) => right.length - left.length)
  .join('|');
const searchableResources = new Set<MailSplit>([
  'inbox',
  'starred',
  'drafts',
  'sent',
  'done',
  'auto-archived',
  'scheduled',
  'reminders',
  'spam',
  'trash',
  'critical',
  'needs-response',
  'waiting',
]);
const operatorExpression = /\b(from|to|account|in|resource|label|has|is):("[^"]{1,256}"|[^\s]{1,256})/giu;

function operatorValue(value: string): string {
  const unquoted = value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value;
  return unquoted.trim().toLowerCase();
}

function extractOperators(query: string): {
  readonly query: string;
  readonly operators: MailSearchOperators | undefined;
} {
  const from: string[] = [];
  const to: string[] = [];
  const accounts: string[] = [];
  const resources: MailSplit[] = [];
  const labels: string[] = [];
  let hasAttachment: boolean | null = null;
  let unread: boolean | null = null;
  let starred: boolean | null = null;
  let found = false;
  const remainder = query.replace(operatorExpression, (_match, rawName: string, rawValue: string) => {
    const name = rawName.toLowerCase();
    const value = operatorValue(rawValue);
    if (!value) return _match;
    if (name === 'from') from.push(value);
    else if (name === 'to') to.push(value);
    else if (name === 'account') accounts.push(value);
    else if ((name === 'in' || name === 'resource') && searchableResources.has(value as MailSplit)) {
      resources.push(value as MailSplit);
    } else if (name === 'label') labels.push(value);
    else if (name === 'has' && value === 'attachment') hasAttachment = true;
    else if (name === 'has' && value === 'no-attachment') hasAttachment = false;
    else if (name === 'is' && value === 'unread') unread = true;
    else if (name === 'is' && value === 'read') unread = false;
    else if (name === 'is' && value === 'starred') starred = true;
    else if (name === 'is' && value === 'unstarred') starred = false;
    else return _match;
    found = true;
    return ' ';
  });
  return {
    query: remainder.replace(/\s+/gu, ' ').trim(),
    operators: found
      ? {
          from: [...new Set(from)],
          to: [...new Set(to)],
          accounts: [...new Set(accounts)],
          resources: [...new Set(resources)],
          labels: [...new Set(labels)],
          hasAttachment,
          unread,
          starred,
        }
      : undefined,
  };
}

function dateFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    calendar: 'gregory',
    numberingSystem: 'latn',
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function calendarDateAt(instant: Date | string, timeZone: string): CalendarDate {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (!Number.isFinite(date.getTime())) {
    throw new RangeError('Mail search requires a valid reference time.');
  }
  const values = new Map(
    dateFormatter(timeZone)
      .formatToParts(date)
      .map(part => [part.type, part.value]),
  );
  return {
    year: Number(values.get('year')),
    month: Number(values.get('month')),
    day: Number(values.get('day')),
  };
}

function dateOrdinal(date: CalendarDate): number {
  return Math.floor(Date.UTC(date.year, date.month - 1, date.day) / dayMilliseconds);
}

function calendarDateFromOrdinal(ordinal: number): CalendarDate {
  const date = new Date(ordinal * dayMilliseconds);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function addDays(date: CalendarDate, amount: number): CalendarDate {
  return calendarDateFromOrdinal(dateOrdinal(date) + amount);
}

function validCalendarDate(year: number, month: number, day: number): CalendarDate | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() + 1 === month &&
    candidate.getUTCDate() === day
    ? { year, month, day }
    : null;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function dateKey(date: CalendarDate): string {
  return `${String(date.year).padStart(4, '0')}-${pad(date.month)}-${pad(date.day)}`;
}

function range(start: CalendarDate, end: CalendarDate = start): MailSearchDateRange {
  return { startDate: dateKey(start), endDate: dateKey(end) };
}

function monthRange(year: number, month: number): MailSearchDateRange {
  const start = validCalendarDate(year, month, 1);
  const endDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = validCalendarDate(year, month, endDay);
  if (!start || !end) throw new RangeError('Invalid mail search month.');
  return range(start, end);
}

function inferredPastDate(
  month: number,
  day: number,
  today: CalendarDate,
): CalendarDate | null {
  let candidate = validCalendarDate(today.year, month, day);
  if (!candidate) return null;
  if (dateOrdinal(candidate) > dateOrdinal(today)) {
    candidate = validCalendarDate(today.year - 1, month, day);
  }
  return candidate;
}

function expression(
  match: RegExpExecArray,
  dateRange: MailSearchDateRange,
): DateExpression {
  return { index: match.index, text: match[0], range: dateRange };
}

function semanticDateExpression(query: string, today: CalendarDate): DateExpression | null {
  const match = /\b(today|yesterday|this\s+week|last\s+week|this\s+month|last\s+month)\b/iu.exec(query);
  if (!match) return null;
  const phrase = match[1]!.toLowerCase().replace(/\s+/gu, ' ');
  if (phrase === 'today') return expression(match, range(today));
  if (phrase === 'yesterday') return expression(match, range(addDays(today, -1)));
  if (phrase === 'this month') return expression(match, monthRange(today.year, today.month));
  if (phrase === 'last month') {
    const previousMonth = today.month === 1
      ? { year: today.year - 1, month: 12 }
      : { year: today.year, month: today.month - 1 };
    return expression(match, monthRange(previousMonth.year, previousMonth.month));
  }

  // Convert Sunday=0 into a Monday-based offset where Monday=0.
  const weekday = new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay();
  const daysSinceMonday = (weekday + 6) % 7;
  const thisMonday = addDays(today, -daysSinceMonday);
  if (phrase === 'this week') return expression(match, range(thisMonday, addDays(thisMonday, 6)));
  const lastMonday = addDays(thisMonday, -7);
  return expression(match, range(lastMonday, addDays(lastMonday, 6)));
}

function relativeDateExpression(query: string, today: CalendarDate): DateExpression | null {
  const daysAgo = /\b(\d{1,3})\s+days?\s+ago\b/iu.exec(query);
  if (daysAgo) {
    return expression(daysAgo, range(addDays(today, -Number(daysAgo[1]))));
  }
  const recentDays = /\b(?:past|last)\s+(\d{1,3})\s+days?\b/iu.exec(query);
  if (!recentDays) return null;
  const count = Number(recentDays[1]);
  if (count < 1) return null;
  return expression(recentDays, range(addDays(today, -(count - 1)), today));
}

function exactDateExpression(query: string, today: CalendarDate): DateExpression | null {
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/u.exec(query);
  if (iso) {
    const date = validCalendarDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    return date ? expression(iso, range(date)) : null;
  }

  const numeric = /\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2}|\d{4}))?\b/u.exec(query);
  if (numeric) {
    const rawYear = numeric[3];
    const year = rawYear
      ? (rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear))
      : null;
    const date = year === null
      ? inferredPastDate(Number(numeric[1]), Number(numeric[2]), today)
      : validCalendarDate(year, Number(numeric[1]), Number(numeric[2]));
    return date ? expression(numeric, range(date)) : null;
  }

  const monthDay = new RegExp(
    `\\b(${monthPattern})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`,
    'iu',
  ).exec(query);
  if (monthDay) {
    const month = monthNames.get(monthDay[1]!.toLowerCase());
    const year = monthDay[3] ? Number(monthDay[3]) : null;
    const date = month === undefined
      ? null
      : year === null
        ? inferredPastDate(month, Number(monthDay[2]), today)
        : validCalendarDate(year, month, Number(monthDay[2]));
    return date ? expression(monthDay, range(date)) : null;
  }

  const dayMonth = new RegExp(
    `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthPattern})\\.?(?:,?\\s+(\\d{4}))?\\b`,
    'iu',
  ).exec(query);
  if (dayMonth) {
    const month = monthNames.get(dayMonth[2]!.toLowerCase());
    const year = dayMonth[3] ? Number(dayMonth[3]) : null;
    const date = month === undefined
      ? null
      : year === null
        ? inferredPastDate(month, Number(dayMonth[1]), today)
        : validCalendarDate(year, month, Number(dayMonth[1]));
    return date ? expression(dayMonth, range(date)) : null;
  }

  const namedMonth = new RegExp(
    `\\b(${monthPattern})\\.?(?:\\s+(\\d{4}))?\\b(?!\\.?\\s+\\d)`,
    'iu',
  ).exec(query);
  if (!namedMonth) return null;
  const month = monthNames.get(namedMonth[1]!.toLowerCase());
  if (month === undefined) return null;
  const year = namedMonth[2]
    ? Number(namedMonth[2])
    : month > today.month ? today.year - 1 : today.year;
  return expression(namedMonth, monthRange(year, month));
}

function removeDateExpression(query: string, match: DateExpression): string {
  let before = query.slice(0, match.index);
  const after = query.slice(match.index + match.text.length);
  before = before.replace(/\b(?:on|from|during|in|sent|received|dated)\s*$/iu, '');
  const remainder = `${before} ${after}`
    .replace(/\s+/gu, ' ')
    .replace(/^[,;:\s]+|[,;:\s]+$/gu, '')
    .trim();
  return /^(?:mail|emails?|messages?)$/iu.test(remainder) ? '' : remainder;
}

/**
 * Splits a mailbox query into normal text and at most one local-calendar date
 * predicate. Unrecognized or invalid dates remain ordinary text.
 */
export function parseMailSearchQuery(
  query: string,
  context: MailSearchContext,
): ParsedMailSearchQuery {
  const normalized = query.trim();
  if (!normalized) return { textQuery: '', dateRange: null };
  const extracted = extractOperators(normalized);
  const today = calendarDateAt(context.now, context.timeZone);
  const dateMatch = semanticDateExpression(extracted.query, today) ??
    relativeDateExpression(extracted.query, today) ??
    exactDateExpression(extracted.query, today);
  return {
    textQuery: dateMatch
      ? removeDateExpression(extracted.query, dateMatch)
      : extracted.query,
    dateRange: dateMatch?.range ?? null,
    ...(extracted.operators ? { operators: extracted.operators } : {}),
  };
}

function timestampDateKey(timestamp: string, timeZone: string): string | null {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return null;
  return dateKey(calendarDateAt(date, timeZone));
}

export function threadMatchesMailDate(
  thread: EmailThread,
  dateRange: MailSearchDateRange | null,
  timeZone: string,
): boolean {
  if (!dateRange) return true;
  const timestamps = [thread.receivedAt, ...thread.messages.map(message => message.sentAt)];
  return timestamps.some(timestamp => {
    const key = timestampDateKey(timestamp, timeZone);
    return key !== null && key >= dateRange.startDate && key <= dateRange.endDate;
  });
}

function participantText(thread: EmailThread): string {
  return thread.participants
    .map(participant => `${participant.name ?? ''} ${participant.address}`)
    .join(' ') || 'Unknown sender';
}

function includesEvery(values: readonly string[], needles: readonly string[]): boolean {
  const normalized = values.map(value => value.toLowerCase());
  return needles.every(needle => normalized.some(value => value.includes(needle)));
}

function threadMatchesOperators(
  thread: EmailThread,
  operators: MailSearchOperators | undefined,
): boolean {
  if (!operators) return true;
  const senders = [
    ...thread.participants.flatMap(participant => [participant.name ?? '', participant.address]),
    ...thread.messages.flatMap(message => [message.from.name ?? '', message.from.address]),
  ];
  const recipients = thread.messages.flatMap(message =>
    message.to.flatMap(recipient => [recipient.name ?? '', recipient.address]));
  if (!includesEvery(senders, operators.from)) return false;
  if (!includesEvery(recipients, operators.to)) return false;
  if (!includesEvery([thread.accountId], operators.accounts)) return false;
  if (operators.resources.length > 0 &&
      !operators.resources.every(resource => threadMatchesSplit(thread, resource))) return false;
  if (!includesEvery(thread.labels, operators.labels)) return false;
  const hasAttachment = thread.messages.some(message => (message.attachments?.length ?? 0) > 0);
  if (operators.hasAttachment !== null && operators.hasAttachment !== hasAttachment) return false;
  if (operators.unread !== null && operators.unread !== thread.unread) return false;
  if (operators.starred !== null && operators.starred !== thread.starred) return false;
  return true;
}

export function threadMatchesMailSearchConstraints(
  thread: EmailThread,
  parsed: Pick<ParsedMailSearchQuery, 'dateRange' | 'operators'>,
  timeZone: string,
): boolean {
  return threadMatchesMailDate(thread, parsed.dateRange, timeZone) &&
    threadMatchesOperators(thread, parsed.operators);
}

export function filterMailThreads(
  threads: readonly EmailThread[],
  query: string,
  context: MailSearchContext,
): readonly EmailThread[] {
  const parsed = parseMailSearchQuery(query, context);
  const normalizedText = parsed.textQuery.toLowerCase();
  if (!normalizedText && !parsed.dateRange && !parsed.operators) return threads;
  return threads.filter(thread => {
    if (!threadMatchesMailSearchConstraints(thread, parsed, context.timeZone)) return false;
    if (!normalizedText) return true;
    return `${thread.subject} ${thread.snippet} ${participantText(thread)} ${thread.messages
      .map(message => message.bodyText)
      .join(' ')}`
      .toLowerCase()
      .includes(normalizedText);
  });
}
