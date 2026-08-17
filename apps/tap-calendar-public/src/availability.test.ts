import { describe, expect, it } from "@rstest/core";
import {
  availabilityRefreshDelay,
  reconcileAvailabilitySelection,
} from "./availability";
import {
  PUBLIC_AVAILABILITY_SCHEMA_VERSION,
  type PublicBookingAvailability,
  type PublicBookingSlot,
} from "./contracts";

const firstSlot: PublicBookingSlot = {
  start: "2026-08-18T14:00:00.000Z",
  end: "2026-08-18T14:30:00.000Z",
  token: "old-slot-token-123456",
};

const availability = (slots: readonly PublicBookingSlot[]): PublicBookingAvailability => ({
  schemaVersion: PUBLIC_AVAILABILITY_SCHEMA_VERSION,
  pageRevision: "revision-1",
  viewerTimeZone: "America/New_York",
  month: "2026-08-01",
  generatedAt: "2026-08-16T12:00:00.000Z",
  expiresAt: "2026-08-16T12:05:00.000Z",
  dates: [{ date: "2026-08-18", slots }],
});

describe("public availability lifecycle", () => {
  it("refreshes ahead of expiration and backs off expired responses", () => {
    const now = Date.parse("2026-08-16T12:00:00.000Z");
    expect(availabilityRefreshDelay("2026-08-16T12:01:00.000Z", now)).toBe(55_000);
    expect(availabilityRefreshDelay("2026-08-16T12:00:00.100Z", now)).toBe(0);
    expect(availabilityRefreshDelay("2026-08-16T11:59:59.000Z", now)).toBe(1_000);
  });

  it("keeps the selected interval while replacing its rotated token", () => {
    const refreshed = { ...firstSlot, token: "new-slot-token-654321" };
    expect(reconcileAvailabilitySelection(
      availability([refreshed]),
      "2026-08-18",
      firstSlot,
    )).toEqual({ dateAvailable: true, slot: refreshed });
  });

  it("clears a selection when its date or interval disappears", () => {
    expect(reconcileAvailabilitySelection(
      availability([]),
      "2026-08-18",
      firstSlot,
    )).toEqual({ dateAvailable: true, slot: null });
    expect(reconcileAvailabilitySelection(
      { ...availability([]), dates: [] },
      "2026-08-18",
      firstSlot,
    )).toEqual({ dateAvailable: false, slot: null });
  });
});
