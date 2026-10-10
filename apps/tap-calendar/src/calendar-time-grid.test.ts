import { describe, expect, it } from "@rstest/core";
import {
  calendarGridHourLabel,
  timeGridDayPlacements,
  timeGridEventLayout,
  timeGridNowPercentage,
} from "./calendar-time-grid";

const timed = (id: string, start: string, end: string) => ({
  id,
  start: `2026-10-09T${start}:00`,
  end: `2026-10-09T${end}:00`,
});

const columns = (placements: ReturnType<typeof timeGridDayPlacements>) =>
  Object.fromEntries([...placements].map(([id, placement]) => [
    id,
    [placement.column, placement.columnSpan, placement.columnCount],
  ]));

describe("TAP Calendar time grid", () => {
  it("lays out late-evening events completely inside a 24-hour day", () => {
    const layout = timeGridEventLayout({
      start: "2026-08-15T19:30:00",
      end: "2026-08-15T23:30:00",
    });

    expect(layout.topPercentage).toBeCloseTo(81.25);
    expect(layout.heightPercentage).toBeCloseTo(16.6667, 3);
    expect(layout.topPercentage + layout.heightPercentage).toBeLessThanOrEqual(100);
  });

  it("clamps an event crossing midnight to the end of its starting day", () => {
    const layout = timeGridEventLayout({
      start: "2026-08-15T23:00:00",
      end: "2026-08-16T01:00:00",
    });

    expect(layout.topPercentage).toBeCloseTo(95.8333, 3);
    expect(layout.topPercentage + layout.heightPercentage).toBeCloseTo(100);
  });

  it("keeps the minimum-height event box inside the grid at midnight", () => {
    const layout = timeGridEventLayout({
      start: "2026-08-15T23:45:00",
      end: "2026-08-16T00:00:00",
    });

    expect(layout.heightPercentage).toBeCloseTo((30 / 1_440) * 100);
    expect(layout.topPercentage + layout.heightPercentage).toBeCloseTo(100);
  });

  it("formats midnight, noon, and the final visible hour correctly", () => {
    expect(calendarGridHourLabel(0)).toBe("12:00 AM");
    expect(calendarGridHourLabel(12)).toBe("12:00 PM");
    expect(calendarGridHourLabel(23)).toBe("11:00 PM");
    expect(timeGridNowPercentage(new Date("2026-08-15T23:59:00"))).toBeCloseTo(99.9306, 3);
  });

  it("gives a lone event the full day column", () => {
    expect(columns(timeGridDayPlacements([timed("solo", "09:00", "10:00")]))).toEqual({ solo: [0, 1, 1] });
  });

  it("places overlapping events side by side and leaves back-to-back events full width", () => {
    const placements = timeGridDayPlacements([
      timed("refinement", "10:00", "11:00"),
      timed("demo", "10:30", "11:00"),
      timed("standup", "11:30", "12:15"),
      timed("harness", "12:00", "12:30"),
      timed("one-on-one", "12:30", "13:00"),
    ]);

    expect(columns(placements)).toEqual({
      refinement: [0, 1, 2],
      demo: [1, 1, 2],
      standup: [0, 1, 2],
      harness: [1, 1, 2],
      "one-on-one": [0, 1, 1],
    });
  });

  it("treats the minimum rendered height as an overlap", () => {
    const placements = timeGridDayPlacements([
      timed("planning", "09:30", "09:40"),
      timed("sync", "09:45", "10:15"),
    ]);

    expect(columns(placements)).toEqual({ planning: [0, 1, 2], sync: [1, 1, 2] });
  });

  it("reuses freed columns and widens events into free neighbours", () => {
    const placements = timeGridDayPlacements([
      timed("gym", "06:00", "08:30"),
      timed("reminder", "07:00", "07:30"),
      timed("standup", "07:00", "07:30"),
      timed("coffee", "07:30", "08:00"),
    ]);

    expect(columns(placements)).toEqual({
      gym: [0, 1, 3],
      reminder: [1, 1, 3],
      standup: [2, 1, 3],
      coffee: [1, 2, 3],
    });
  });

  it("marks only half-hour-or-shorter events as compact", () => {
    const placements = timeGridDayPlacements([
      timed("short", "09:00", "09:15"),
      timed("half", "10:00", "10:30"),
      timed("long", "11:00", "11:45"),
    ]);

    expect(placements.get("short")?.compact).toBe(true);
    expect(placements.get("half")?.compact).toBe(true);
    expect(placements.get("long")?.compact).toBe(false);
  });
});
