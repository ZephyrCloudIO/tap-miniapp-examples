/** Bounded iCalendar projection shared by the reader and the trusted RSVP executor. */
export const maximumCalendarBytes = 256 * 1024;
export type CalendarResponse = 'accepted' | 'declined' | 'tentative';
export interface CalendarPerson {
  readonly address: string;
  readonly name: string;
  readonly status: string;
}
export interface CalendarDate {
  readonly value: string;
  readonly timeZone: string | null;
  readonly dateOnly: boolean;
}
export interface CalendarInvitation {
  readonly uid: string;
  readonly sequence: number;
  readonly recurrenceId: CalendarDate | null;
  readonly method: string;
  readonly title: string;
  readonly start: CalendarDate | null;
  readonly end: CalendarDate | null;
  readonly organizer: CalendarPerson | null;
  readonly attendees: readonly CalendarPerson[];
  readonly location: string;
  readonly description: string;
  readonly url: string;
  readonly comment: string;
  readonly cancelled: boolean;
}
interface Property {
  name: string;
  params: Record<string, string>;
  value: string;
}
const encoder = new TextEncoder();
const addressPattern = /^[^\s@,;<>\r\n]+@[^\s@,;<>\r\n]+\.[^\s@,;<>\r\n]+$/u;
const unescapeText = (s: string) =>
  s.replace(/\\([nN,;\\])/gu, (_match, c: string) =>
    c.toLowerCase() === 'n' ? '\n' : c,
  );
const escapeText = (s: string) =>
  s
    .replaceAll('\\', '\\\\')
    .replaceAll('\n', '\\n')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')
    .replaceAll('\r', '');
function lines(text: string): string[] {
  if (
    encoder.encode(text).byteLength > maximumCalendarBytes ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(text)
  )
    throw new Error('Calendar attachment is too large or malformed.');
  const result = text
    .replace(/^\uFEFF/u, '')
    .replace(/\r?\n[ \t]/gu, '')
    .split(/\r?\n/u);
  if (result.length > 5000 || result.some((line) => line.length > 16000))
    throw new Error('Calendar attachment is too complex.');
  return result;
}
function property(line: string): Property | null {
  // Separators inside quoted parameters (e.g. CN="Doe; Jane") are not delimiters.
  const parts: string[] = [];
  let quoted = false;
  let offset = 0;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    if (!quoted && (line[i] === ';' || line[i] === ':')) {
      parts.push(line.slice(offset, i));
      offset = i + 1;
      if (line[i] === ':') {
        colon = i;
        break;
      }
    }
  }
  if (colon < 0) return null;
  const name = parts.shift()!.toUpperCase();
  const params: Record<string, string> = {};
  for (const part of parts) {
    const equal = part.indexOf('=');
    if (equal < 1) continue;
    params[part.slice(0, equal).toUpperCase()] = part
      .slice(equal + 1)
      .replace(/^"|"$/gu, '')
      .replace(/\^([nN'^])/gu, (_match, c: string) =>
        c.toLowerCase() === 'n' ? '\n' : c === "'" ? '"' : '^',
      );
  }
  return { name, params, value: line.slice(colon + 1) };
}
function date(p: Property | undefined): CalendarDate | null {
  if (!p) return null;
  const dateOnly =
    p.params.VALUE?.toUpperCase() === 'DATE' || /^\d{8}$/u.test(p.value);
  if (!(dateOnly ? /^\d{8}$/u : /^\d{8}T\d{6}Z?$/u).test(p.value)) return null;
  const s = p.value;
  const y = +s.slice(0, 4),
    m = +s.slice(4, 6),
    d = +s.slice(6, 8);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() + 1 !== m ||
    check.getUTCDate() !== d ||
    (!dateOnly &&
      (+s.slice(9, 11) > 23 || +s.slice(11, 13) > 59 || +s.slice(13, 15) > 59))
  )
    return null;
  return {
    value: s,
    timeZone: dateOnly ? null : s.endsWith('Z') ? 'UTC' : p.params.TZID || null,
    dateOnly,
  };
}
function person(p: Property | undefined): CalendarPerson | null {
  if (!p || !/^mailto:/iu.test(p.value)) return null;
  const address = p.value.slice(7).toLowerCase();
  if (address.length > 320 || !addressPattern.test(address)) return null;
  return {
    address,
    name: unescapeText(p.params.CN || ''),
    status: (p.params.PARTSTAT || 'NEEDS-ACTION').toUpperCase(),
  };
}
export function parseCalendarInvitations(
  text: string,
): readonly CalendarInvitation[] {
  const unfolded = lines(text);
  let method = 'PUBLISH';
  let calendarCount = 0;
  let methodCount = 0;
  let props: Property[] | null = null;
  const stack: string[] = [];
  const events: Property[][] = [];
  for (const line of unfolded) {
    const p = property(line);
    if (!p) continue;
    const component = p.value.toUpperCase();
    if (p.name === 'BEGIN') {
      if (component === 'VCALENDAR') {
        if (stack.length || ++calendarCount !== 1)
          throw new Error('Invalid calendar envelope.');
      } else if (!stack.length)
        throw new Error('Calendar component outside its envelope.');
      if (component === 'VEVENT') {
        if (stack.length !== 1 || stack[0] !== 'VCALENDAR')
          throw new Error('Invalid nested calendar event.');
        props = [];
      }
      stack.push(component);
    } else if (p.name === 'END') {
      if (stack.pop() !== component)
        throw new Error('Unbalanced calendar components.');
      if (component === 'VEVENT' && props) {
        events.push(props);
        props = null;
        if (events.length > 10) throw new Error('Too many calendar events.');
      }
    } else if (props && stack.at(-1) === 'VEVENT') props.push(p);
    else if (stack.length === 1 && p.name === 'METHOD') {
      if (++methodCount > 1) throw new Error('Ambiguous calendar method.');
      method = component;
    }
  }
  if (calendarCount !== 1 || stack.length || props || !events.length)
    throw new Error(
      'This attachment does not contain a readable calendar event.',
    );
  const invitations = events.map((properties) => {
    const first = (name: string) => properties.find((p) => p.name === name);
    for (const name of [
      'UID',
      'DTSTART',
      'DTEND',
      'SEQUENCE',
      'RECURRENCE-ID',
      'ORGANIZER',
    ]) {
      if (properties.filter((p) => p.name === name).length > 1)
        throw new Error('Ambiguous calendar event identity.');
    }
    const end = date(first('DTEND'));
    const recurrenceId = date(first('RECURRENCE-ID'));
    if ((first('DTEND') && !end) || (first('RECURRENCE-ID') && !recurrenceId))
      throw new Error('Invalid calendar event date.');
    const uid = unescapeText(first('UID')?.value || '');
    const start = date(first('DTSTART'));
    const sequence = Number(first('SEQUENCE')?.value || '0');
    if (
      !uid ||
      uid.length > 1024 ||
      /[\r\n\u0000-\u001f]/u.test(uid) ||
      (first('DTSTART') ? !start : !['REPLY', 'CANCEL'].includes(method)) ||
      !Number.isSafeInteger(sequence) ||
      sequence < 0
    )
      throw new Error('Calendar event identity or date is invalid.');
    const text = (name: string) =>
      unescapeText(first(name)?.value || '').slice(0, 16000);
    return {
      uid,
      sequence,
      start,
      end,
      recurrenceId,
      method,
      title: text('SUMMARY') || 'Calendar event',
      organizer: person(first('ORGANIZER')),
      attendees: properties
        .filter((p) => p.name === 'ATTENDEE')
        .slice(0, 100)
        .flatMap((p) => {
          const v = person(p);
          return v ? [v] : [];
        }),
      location: text('LOCATION'),
      description: text('DESCRIPTION'),
      url: text('URL'),
      comment: text('COMMENT'),
      cancelled:
        method === 'CANCEL' ||
        first('STATUS')?.value.toUpperCase() === 'CANCELLED',
    };
  });
  if (new Set(invitations.map(calendarEventKey)).size !== invitations.length)
    throw new Error('Ambiguous calendar events.');
  return invitations;
}
export function calendarEventKey(event: CalendarInvitation): string {
  return JSON.stringify([event.uid, event.sequence, event.recurrenceId]);
}
export function calendarDateInstant(value: CalendarDate): Date | null {
  const s = value.value;
  const wall = Date.UTC(
    +s.slice(0, 4),
    +s.slice(4, 6) - 1,
    +s.slice(6, 8),
    +(s.slice(9, 11) || 0),
    +(s.slice(11, 13) || 0),
    +(s.slice(13, 15) || 0),
  );
  if (value.dateOnly || value.timeZone === 'UTC') return new Date(wall);
  if (!value.timeZone) return null; // Floating wall time has no absolute instant.
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: value.timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    let instant = wall;
    for (let i = 0; i < 3; i++) {
      const parts = Object.fromEntries(
        formatter
          .formatToParts(new Date(instant))
          .map((p) => [p.type, p.value]),
      );
      const projected = Date.UTC(
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day),
        Number(parts.hour),
        Number(parts.minute),
        Number(parts.second),
      );
      const delta = wall - projected;
      if (!delta) return new Date(instant);
      instant += delta;
    }
  } catch {
    /* Unsupported TZID: keep its original wall time and zone in the UI. */
  }
  return null;
}
export function calendarDateLabel(
  value: CalendarDate,
  displayTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  const instant = calendarDateInstant(value);
  if (instant)
    return (
      new Intl.DateTimeFormat(undefined, {
        dateStyle: 'full',
        ...(value.dateOnly ? {} : { timeStyle: 'short' }),
        timeZone: value.dateOnly ? 'UTC' : displayTimeZone,
      }).format(instant) +
      (value.dateOnly ? ' · All day' : ` · ${displayTimeZone}`)
    );
  const s = value.value;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)} ${s.slice(9, 11)}:${s.slice(11, 13)} · ${value.timeZone || 'Local time (no timezone specified)'}`;
}
/** Calendar DTEND is exclusive for all-day events. */
export function calendarWhenLabel(
  event: Pick<CalendarInvitation, 'start' | 'end'>,
  displayTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  const { start, end } = event;
  if (!start) return 'Event time not included in this notice.';
  if (!end) return calendarDateLabel(start, displayTimeZone);
  const first = calendarDateInstant(start);
  const last = calendarDateInstant(end);
  if (start.dateOnly && end.dateOnly && first && last && last > first) {
    const finalDay = new Date(last.getTime() - 86_400_000);
    if (first.getTime() === finalDay.getTime()) return calendarDateLabel(start);
    return `${calendarDateLabel(start)} – ${new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeZone: 'UTC' }).format(finalDay)}`;
  }
  const sameDay =
    first &&
    last &&
    new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: displayTimeZone,
    }).format(first) ===
      new Intl.DateTimeFormat('en-CA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        timeZone: displayTimeZone,
      }).format(last);
  if (first && last && !start.dateOnly && !end.dateOnly && sameDay) {
    const timeZone = displayTimeZone;
    const day = new Intl.DateTimeFormat(undefined, {
      dateStyle: 'full',
      timeZone,
    }).format(first);
    const from = new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      timeZone,
    }).format(first);
    const until = new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      timeZone,
      timeZoneName: 'short',
    }).format(last);
    return `${day} · ${from} – ${until}`;
  }
  return `${calendarDateLabel(start, displayTimeZone)} – ${calendarDateLabel(end, displayTimeZone)}`;
}
export function calendarSafeUrl(text: string): string | null {
  try {
    const u = new URL(text);
    return ['https:', 'http:'].includes(u.protocol) &&
      !u.username &&
      !u.password
      ? u.href
      : null;
  } catch {
    return null;
  }
}
/** Preserve date/time/recurrence and custom timezone definitions; omit alarms and other attendees. */
export function calendarReply(
  text: string,
  event: CalendarInvitation,
  attendee: CalendarPerson,
  response: CalendarResponse,
  now: Date,
): string {
  if (
    event.method !== 'REQUEST' ||
    event.cancelled ||
    !event.organizer ||
    !event.start
  )
    throw new Error('This is not an actionable invitation.');
  const unfolded = lines(text);
  const zones: string[] = [];
  let inside = false;
  for (const line of unfolded) {
    if (line.toUpperCase() === 'BEGIN:VTIMEZONE') inside = true;
    if (inside) zones.push(line);
    if (line.toUpperCase() === 'END:VTIMEZONE') inside = false;
  }
  const dateLine = (name: string, v: CalendarDate) =>
    `${name}${v.dateOnly ? ';VALUE=DATE' : v.timeZone && v.timeZone !== 'UTC' ? `;TZID="${v.timeZone.replace(/["\r\n]/gu, '')}"` : ''}:${v.value}`;
  const content = [
    'BEGIN:VCALENDAR',
    'PRODID:-//TAP//Email RSVP//EN',
    'VERSION:2.0',
    'METHOD:REPLY',
    ...zones,
    'BEGIN:VEVENT',
    `UID:${escapeText(event.uid)}`,
    `SEQUENCE:${event.sequence}`,
    `DTSTAMP:${now
      .toISOString()
      .replace(/[-:]/gu, '')
      .replace(/\.\d{3}/u, '')}`,
    dateLine('DTSTART', event.start),
    ...(event.end ? [dateLine('DTEND', event.end)] : []),
    ...(event.recurrenceId
      ? [dateLine('RECURRENCE-ID', event.recurrenceId)]
      : []),
    `SUMMARY:${escapeText(event.title)}`,
    `ORGANIZER:mailto:${event.organizer.address}`,
    `ATTENDEE;PARTSTAT=${response.toUpperCase()}:mailto:${attendee.address}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  // Fold by UTF-8 octets, never splitting a code point.
  return (
    content
      .map((line) => {
        let result = '',
          width = 0;
        for (const char of line) {
          const bytes = encoder.encode(char).length;
          if (width + bytes > 74) {
            result += '\r\n ';
            width = 1;
          }
          result += char;
          width += bytes;
        }
        return result;
      })
      .join('\r\n') + '\r\n'
  );
}
