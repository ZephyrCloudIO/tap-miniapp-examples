import { describe, expect, it } from "@rstest/core";
import {
  calendarGridHourLabel,
  timeGridEventLayout,
  timeGridNowPercentage,
} from "./calendar-time-grid";

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
});
