import { describe, expect, it } from '@rstest/core';
import {
  calendarDateInstant,
  calendarDateLabel,
  calendarWhenLabel,
  calendarEventKey,
  calendarReply,
  calendarSafeUrl,
  maximumCalendarBytes,
  parseCalendarInvitations,
} from './calendar';
import { isMailCommand } from './protocol';
const invite = (extra = '', method = 'REQUEST') =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nMETHOD:${method}\r\nBEGIN:VEVENT\r\nUID:event@example.com\r\nSEQUENCE:2\r\nDTSTART;TZID=America/New_York:20261005T180000\r\nDTEND;TZID=America/New_York:20261005T190000\r\nSUMMARY:Account review\r\nORGANIZER;CN=Organizer:mailto:host@example.com\r\nATTENDEE;CN="Doe; Jane";PARTSTAT=NEEDS-ACTION:mailto:viewer@example.com\r\n${extra}END:VEVENT\r\nEND:VCALENDAR\r\n`;
describe('iCalendar reader projection and replies', () => {
  it('unfolds UTF-8 text, quoted parameters, escaped descriptions and attendee statuses', () => {
    const [event] = parseCalendarInvitations(
      invite(
        'DESCRIPTION:Bring notes\\nA\\, B\\; C\r\nLOCATION:https://meet.example.com/\r\nCOMMENT:A long\r\n  comment\r\n',
      ),
    );
    expect(event).toMatchObject({
      method: 'REQUEST',
      sequence: 2,
      description: 'Bring notes\nA, B; C',
      comment: 'A long comment',
      attendees: [
        {
          name: 'Doe; Jane',
          address: 'viewer@example.com',
          status: 'NEEDS-ACTION',
        },
      ],
    });
  });
  it('keeps zoned, UTC, date-only and floating time distinct', () => {
    const event = parseCalendarInvitations(invite())[0]!;
    expect(calendarDateInstant(event.start!)?.toISOString()).toBe(
      '2026-10-05T22:00:00.000Z',
    );
    expect(
      calendarDateInstant({
        value: '20261005T220000Z',
        timeZone: 'UTC',
        dateOnly: false,
      })?.toISOString(),
    ).toBe('2026-10-05T22:00:00.000Z');
    expect(calendarDateInstant({ ...event.start!, timeZone: null })).toBeNull();
    expect(
      calendarDateLabel({ ...event.start!, timeZone: 'Unsupported/Zone' }),
    ).toContain('Unsupported/Zone');
    expect(
      calendarDateLabel({ value: '20261005', timeZone: null, dateOnly: true }),
    ).toContain('All day');
  });
  it('formats an event range compactly and keeps all-day DTEND exclusive', () => {
    const event = parseCalendarInvitations(invite())[0]!;
    expect(calendarWhenLabel(event, 'America/New_York')).toContain('6:00');
    expect(calendarWhenLabel(event, 'America/New_York')).toContain('7:00');
    expect(calendarWhenLabel(event, 'America/New_York')).toContain('EDT');
    const utc = {
      start: { value: '20261005T220000Z', timeZone: 'UTC', dateOnly: false },
      end: { value: '20261005T230000Z', timeZone: 'UTC', dateOnly: false },
    };
    expect(calendarWhenLabel(utc, 'America/New_York')).toBe(
      calendarWhenLabel(event, 'America/New_York'),
    );
    const allDay = {
      start: { value: '20261005', timeZone: null, dateOnly: true },
      end: { value: '20261006', timeZone: null, dateOnly: true },
    };
    expect(calendarWhenLabel(allDay)).toBe(calendarDateLabel(allDay.start));
  });
  it('distinguishes reply and cancellation from invitations', () => {
    expect(parseCalendarInvitations(invite('', 'REPLY'))[0]?.method).toBe(
      'REPLY',
    );
    expect(parseCalendarInvitations(invite('', 'CANCEL'))[0]?.cancelled).toBe(
      true,
    );
  });
  it('renders valid attendee replies that omit the optional start time', () => {
    const reply = invite('', 'REPLY').replace(
      'DTSTART;TZID=America/New_York:20261005T180000\r\n',
      '',
    );
    const event = parseCalendarInvitations(reply)[0]!;
    expect(event.start).toBeNull();
    expect(calendarWhenLabel(event)).toBe(
      'Event time not included in this notice.',
    );
    expect(() =>
      parseCalendarInvitations(reply.replace('METHOD:REPLY', 'METHOD:REQUEST')),
    ).toThrow();
  });
  it('preserves recurrence identity and emits only the responding attendee, with valid octet folding', () => {
    const source = invite(
      'RECURRENCE-ID;TZID=America/New_York:20261005T180000\r\nATTENDEE:mailto:other@example.com\r\n',
    ).replace('SUMMARY:Account review', `SUMMARY:${'会'.repeat(50)}${'🙂'.repeat(25)}`);
    const event = parseCalendarInvitations(source)[0]!;
    const reply = calendarReply(
      source,
      event,
      event.attendees[0]!,
      'tentative',
      new Date('2026-10-03T20:00:00Z'),
    );
    expect(reply).toContain('METHOD:REPLY');
    expect(reply).toContain('PARTSTAT=TENTATIVE');
    expect(reply).not.toContain('other@example.com');
    expect(reply).toContain(
      'RECURRENCE-ID;TZID="America/New_York":20261005T180000',
    );
    expect(parseCalendarInvitations(reply)[0]?.uid).toBe(event.uid);
    expect(parseCalendarInvitations(reply)[0]?.title).toBe(event.title);
    expect(calendarEventKey(parseCalendarInvitations(reply)[0]!)).toBe(
      calendarEventKey(event),
    );
    for (const line of reply.split('\r\n'))
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
  it('rejects malformed and oversized input; excludes executable and credential URLs', () => {
    expect(() =>
      parseCalendarInvitations('x'.repeat(maximumCalendarBytes + 1)),
    ).toThrow();
    expect(() =>
      parseCalendarInvitations(
        invite().replace('20261005T180000', '20261305T180000'),
      ),
    ).toThrow();
    expect(() => parseCalendarInvitations('not a calendar')).toThrow();
    for (const invalid of [
      invite().replace('END:VCALENDAR', ''),
      invite().replace('END:VEVENT', 'END:VALARM'),
      invite('UID:second-id\r\n'),
      invite('RECURRENCE-ID:invalid\r\n'),
      invite().replace('20261005T190000', '20269905T190000'),
      invite().replace('BEGIN:VEVENT', 'BEGIN:VTIMEZONE\r\nBEGIN:VEVENT'),
    ])
      expect(() => parseCalendarInvitations(invalid)).toThrow();
    expect(calendarSafeUrl('javascript:alert(1)')).toBeNull();
    expect(calendarSafeUrl('https://user:pass@example.com')).toBeNull();
  });
  it('requires account, event, resource, revision and captured sender context for RSVP commands', () => {
    const c = {
      v: 1,
      commandId: 'cmd_1',
      idempotencyKey: 'rsvp_1',
      accountId: 'acct_1',
      threadId: 'thread_1',
      kind: 'calendar_rsvp',
      createdAt: '2026-10-03T20:00:00Z',
      expectedProviderRevision: '123',
      payload: {
        messageId: 'msg_1',
        resourceId: 'att_1',
        eventKey: 'event_1',
        response: 'accepted',
        expectedContext: { userId: 'user_1', workspaceId: 'org_1' },
      },
    };
    expect(isMailCommand(c)).toBe(true);
    expect(isMailCommand({ ...c, expectedProviderRevision: null })).toBe(false);
    expect(
      isMailCommand({ ...c, payload: { ...c.payload, response: 'unknown' } }),
    ).toBe(false);
    expect(
      isMailCommand({
        ...c,
        payload: { ...c.payload, expectedContext: undefined },
      }),
    ).toBe(false);
  });
});
