import { describe, expect, it } from "@rstest/core";
import type { CalendarEvent } from "./domain";
import { calculateDailyTimeAllocation } from "./daily-time-allocation";

const event = (
  input: Partial<CalendarEvent> & Pick<CalendarEvent, "end" | "kind" | "start">,
): CalendarEvent => ({
  id: input.id ?? `${input.kind}-${input.start}`,
  calendarId: input.calendarId ?? "calendar-owner",
  title: input.title ?? "Private title",
  start: input.start,
  end: input.end,
  kind: input.kind,
  status: input.status ?? "confirmed",
  location: input.location ?? null,
  attendees: input.attendees ?? [],
  ...(input.busy === undefined ? {} : { busy: input.busy }),
  ...(input.allDay === undefined ? {} : { allDay: input.allDay }),
});

const period = {
  periodStart: "2026-08-15T04:00:00.000Z",
  periodEnd: "2026-08-16T04:00:00.000Z",
} as const;

describe("daily calendar time allocation", () => {
  it("separates meetings from focused work and reports event counts", () => {
    const result = calculateDailyTimeAllocation({
      ...period,
      asOf: Date.parse(period.periodEnd),
      events: [
        event({ kind: "meeting", start: "2026-08-15T13:00:00Z", end: "2026-08-15T14:00:00Z" }),
        event({ kind: "work-block", start: "2026-08-15T14:00:00Z", end: "2026-08-15T15:30:00Z" }),
        event({ kind: "focus", start: "2026-08-15T16:00:00Z", end: "2026-08-15T18:00:00Z" }),
      ],
    });
    expect(result.scheduled).toEqual({
      meetingMinutes: 60,
      focusedWorkMinutes: 210,
      overlapMinutes: 0,
      totalMinutes: 270,
    });
    expect(result.eventCounts).toEqual({ meetings: 1, workBlocks: 1, focusBlocks: 1 });
  });

  it("excludes holds, unconfirmed, transparent, and all-day events", () => {
    const variants: CalendarEvent[] = [
      event({ kind: "hold", start: "2026-08-15T10:00:00Z", end: "2026-08-15T11:00:00Z" }),
      event({ kind: "meeting", status: "pending", start: "2026-08-15T11:00:00Z", end: "2026-08-15T12:00:00Z" }),
      event({ kind: "meeting", status: "declined", start: "2026-08-15T12:00:00Z", end: "2026-08-15T13:00:00Z" }),
      event({ kind: "meeting", status: "cancelled", start: "2026-08-15T13:00:00Z", end: "2026-08-15T14:00:00Z" }),
      event({ kind: "meeting", busy: false, start: "2026-08-15T14:00:00Z", end: "2026-08-15T15:00:00Z" }),
      event({ kind: "meeting", allDay: true, start: period.periodStart, end: period.periodEnd }),
    ];
    expect(calculateDailyTimeAllocation({
      ...period,
      asOf: Date.parse(period.periodEnd),
      events: variants,
    }).scheduled).toEqual({
      meetingMinutes: 0,
      focusedWorkMinutes: 0,
      overlapMinutes: 0,
      totalMinutes: 0,
    });
  });

  it("clips cross-midnight and in-progress events for elapsed totals", () => {
    const result = calculateDailyTimeAllocation({
      ...period,
      asOf: Date.parse("2026-08-15T14:30:00Z"),
      events: [
        event({ kind: "meeting", start: "2026-08-15T03:30:00Z", end: "2026-08-15T05:00:00Z" }),
        event({ kind: "focus", start: "2026-08-15T14:00:00Z", end: "2026-08-15T16:00:00Z" }),
        event({ kind: "work-block", start: "2026-08-16T03:30:00Z", end: "2026-08-16T04:30:00Z" }),
      ],
    });
    expect(result.scheduled).toEqual({
      meetingMinutes: 60,
      focusedWorkMinutes: 150,
      overlapMinutes: 0,
      totalMinutes: 210,
    });
    expect(result.elapsed).toEqual({
      meetingMinutes: 60,
      focusedWorkMinutes: 30,
      overlapMinutes: 0,
      totalMinutes: 90,
    });
  });

  it("unions duplicate events and gives meetings precedence over work", () => {
    const shared = event({ kind: "meeting", start: "2026-08-15T13:00:00Z", end: "2026-08-15T14:00:00Z" });
    const result = calculateDailyTimeAllocation({
      ...period,
      asOf: Date.parse(period.periodEnd),
      events: [
        shared,
        { ...shared, id: "provider-copy", calendarId: "calendar-two" },
        event({ kind: "meeting", start: "2026-08-15T13:30:00Z", end: "2026-08-15T14:30:00Z" }),
        event({ kind: "work-block", start: "2026-08-15T14:00:00Z", end: "2026-08-15T15:00:00Z" }),
      ],
    });
    expect(result.scheduled).toEqual({
      meetingMinutes: 90,
      focusedWorkMinutes: 30,
      overlapMinutes: 30,
      totalMinutes: 120,
    });
  });

  it("uses elapsed instants across spring and fall DST days", () => {
    const spring = calculateDailyTimeAllocation({
      periodStart: "2026-03-08T05:00:00Z",
      periodEnd: "2026-03-09T04:00:00Z",
      asOf: Date.parse("2026-03-09T04:00:00Z"),
      events: [event({ kind: "meeting", start: "2026-03-08T06:30:00Z", end: "2026-03-08T07:30:00Z" })],
    });
    const fall = calculateDailyTimeAllocation({
      periodStart: "2026-11-01T04:00:00Z",
      periodEnd: "2026-11-02T05:00:00Z",
      asOf: Date.parse("2026-11-02T05:00:00Z"),
      events: [event({ kind: "meeting", start: "2026-11-01T05:30:00Z", end: "2026-11-01T06:30:00Z" })],
    });
    expect(Date.parse(spring.periodEnd) - Date.parse(spring.periodStart)).toBe(23 * 60 * 60_000);
    expect(Date.parse(fall.periodEnd) - Date.parse(fall.periodStart)).toBe(25 * 60 * 60_000);
    expect(spring.scheduled.meetingMinutes).toBe(60);
    expect(fall.scheduled.meetingMinutes).toBe(60);
  });

  it("returns zero elapsed time for a future day without mutating inputs", () => {
    const events = [event({ kind: "focus", start: "2026-08-15T13:00:00Z", end: "2026-08-15T14:00:00Z" })];
    const before = JSON.stringify(events);
    const result = calculateDailyTimeAllocation({
      ...period,
      asOf: Date.parse("2026-08-14T12:00:00Z"),
      events,
    });
    expect(result.elapsed.totalMinutes).toBe(0);
    expect(result.scheduled.focusedWorkMinutes).toBe(60);
    expect(JSON.stringify(events)).toBe(before);
  });

  it("rejects malformed periods", () => {
    expect(() => calculateDailyTimeAllocation({
      events: [],
      periodStart: period.periodEnd,
      periodEnd: period.periodStart,
      asOf: Date.now(),
    })).toThrow(/valid period/u);
  });
});
