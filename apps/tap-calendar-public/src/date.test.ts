import { describe, expect, it } from "@rstest/core";
import {
  addCalendarDays,
  addCalendarMonths,
  calendarDateInTimeZone,
  monthStartForDate,
  parseCalendarDate,
  viewerBookingMonthBounds,
} from "./date";

describe("public calendar dates", () => {
  it("pages calendar months without elapsed-time DST math", () => {
    expect(addCalendarMonths("2026-01-31", 1)).toBe("2026-02-01");
    expect(addCalendarDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(monthStartForDate("2026-08-16")).toBe("2026-08-01");
  });

  it("groups an instant under the viewer-local calendar date", () => {
    const instant = new Date("2026-08-18T03:00:00.000Z");
    expect(calendarDateInTimeZone(instant, "America/Los_Angeles")).toBe("2026-08-17");
    expect(calendarDateInTimeZone(instant, "Asia/Tokyo")).toBe("2026-08-18");
  });

  it("keeps adjacent viewer months reachable at host-date boundaries", () => {
    expect(viewerBookingMonthBounds("2026-08-01", "2026-08-31")).toEqual({
      firstMonth: "2026-07-01",
      lastMonth: "2026-09-01",
    });
  });

  it("rejects malformed route dates", () => {
    expect(() => parseCalendarDate("08/16/2026")).toThrow(/YYYY-MM-DD/u);
  });
});
