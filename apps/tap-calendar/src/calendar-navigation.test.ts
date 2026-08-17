import { describe, expect, it } from "@rstest/core";
import {
  horizontalCalendarWheelDelta,
  shiftCalendarAnchor,
} from "./calendar-navigation";

describe("calendar range navigation", () => {
  it("moves each calendar view by its visible range", () => {
    expect(shiftCalendarAnchor("day", "2026-08-14", 1)).toBe("2026-08-15");
    expect(shiftCalendarAnchor("team", "2026-08-14", -1)).toBe("2026-08-13");
    expect(shiftCalendarAnchor("work-week", "2026-08-14", 1)).toBe("2026-08-21");
    expect(shiftCalendarAnchor("week", "2026-08-14", -1)).toBe("2026-08-07");
    expect(shiftCalendarAnchor("agenda", "2026-08-14", 1)).toBe("2026-09-13");
  });

  it("moves month view across year boundaries from the first of the month", () => {
    expect(shiftCalendarAnchor("month", "2026-12-14", 1)).toBe("2027-01-01");
    expect(shiftCalendarAnchor("month", "2026-01-14", -1)).toBe("2025-12-01");
  });

  it("accepts dominant horizontal wheel movement and shift-wheel", () => {
    expect(
      horizontalCalendarWheelDelta(
        { ctrlKey: false, deltaMode: 0, deltaX: 72, deltaY: 4, shiftKey: false },
        900,
      ),
    ).toBe(72);
    expect(
      horizontalCalendarWheelDelta(
        { ctrlKey: false, deltaMode: 0, deltaX: 0, deltaY: -80, shiftKey: true },
        900,
      ),
    ).toBe(-80);
  });

  it("normalizes line and page wheel deltas", () => {
    expect(
      horizontalCalendarWheelDelta(
        { ctrlKey: false, deltaMode: 1, deltaX: 4, deltaY: 0, shiftKey: false },
        900,
      ),
    ).toBe(64);
    expect(
      horizontalCalendarWheelDelta(
        { ctrlKey: false, deltaMode: 2, deltaX: -1, deltaY: 0, shiftKey: false },
        900,
      ),
    ).toBe(-900);
  });

  it("ignores vertical scrolling and pinch-to-zoom wheel events", () => {
    expect(
      horizontalCalendarWheelDelta(
        { ctrlKey: false, deltaMode: 0, deltaX: 3, deltaY: 70, shiftKey: false },
        900,
      ),
    ).toBeNull();
    expect(
      horizontalCalendarWheelDelta(
        { ctrlKey: true, deltaMode: 0, deltaX: 70, deltaY: 0, shiftKey: false },
        900,
      ),
    ).toBeNull();
  });
});
