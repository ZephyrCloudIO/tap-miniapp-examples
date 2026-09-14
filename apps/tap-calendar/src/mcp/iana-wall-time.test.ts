import { describe, expect, it } from "@rstest/core";
import { timeZonesNames } from "@vvo/tzdb";
import { MCP_TIME_ZONE_DATA_VERSION } from "./time-zone-data.generated";
import { ianaZonedInstant, resolveIanaWallTime } from "./iana-wall-time";

function instant(input: Parameters<typeof resolveIanaWallTime>[0]): string {
  const result = resolveIanaWallTime(input);
  if (!result.ok) throw new Error(`Resolution failed: ${result.reason}`);
  return result.instant.toISOString();
}

describe("IANA wall-time resolution for the MCP isolate", () => {
  it("uses the generated 2026c TZDB data", () => {
    expect(MCP_TIME_ZONE_DATA_VERSION).toBe("2026c");
  });

  it("covers every time zone offered by the desktop typeahead", () => {
    const unavailable = [...timeZonesNames, "UTC"].flatMap(timeZone => {
      const result = resolveIanaWallTime({
        date: "2026-08-15",
        time: "12:00",
        timeZone,
      });
      return result.ok ? [] : [{ timeZone, reason: result.reason }];
    });
    expect(unavailable).toEqual([]);
  });

  it("resolves an ordinary wall time and an IANA link without Intl", () => {
    expect(instant({
      date: "2026-08-15",
      time: "10:00",
      timeZone: "America/New_York",
    })).toBe("2026-08-15T14:00:00.000Z");
    expect(instant({
      date: "2026-08-15",
      time: "10:00",
      timeZone: "US/Eastern",
    })).toBe("2026-08-15T14:00:00.000Z");
    expect(instant({
      date: "2026-08-15",
      time: "10:00",
      timeZone: "UTC",
    })).toBe("2026-08-15T10:00:00.000Z");
    expect(instant({
      date: "2026-08-15",
      time: "10:00",
      timeZone: "America/Coyhaique",
    })).toBe("2026-08-15T13:00:00.000Z");
  });

  it("converts instants back to local dates and wall times across DST", () => {
    expect(ianaZonedInstant(
      Date.parse("2026-03-08T06:30:00.000Z"),
      "America/New_York",
    )).toMatchObject({ ok: true, date: "2026-03-08", time: "01:30" });
    expect(ianaZonedInstant(
      Date.parse("2026-03-08T07:30:00.000Z"),
      "America/New_York",
    )).toMatchObject({ ok: true, date: "2026-03-08", time: "03:30" });
  });

  it("fails closed for spring-forward gaps", () => {
    expect(resolveIanaWallTime({
      date: "2026-03-08",
      time: "02:30",
      timeZone: "America/New_York",
    })).toEqual({ ok: false, reason: "nonexistent-wall-time" });
    expect(resolveIanaWallTime({
      date: "2026-03-29",
      time: "02:30",
      timeZone: "Europe/Berlin",
    })).toEqual({ ok: false, reason: "nonexistent-wall-time" });
  });

  it("can explicitly move backward or forward across a gap", () => {
    expect(instant({
      date: "2026-03-08",
      time: "02:30",
      timeZone: "America/New_York",
      disambiguation: "earlier",
    })).toBe("2026-03-08T06:30:00.000Z");
    expect(instant({
      date: "2026-03-08",
      time: "02:30",
      timeZone: "America/New_York",
      disambiguation: "later",
    })).toBe("2026-03-08T07:30:00.000Z");
    expect(instant({
      date: "2026-03-08",
      time: "02:30",
      timeZone: "America/New_York",
      disambiguation: "compatible",
    })).toBe("2026-03-08T07:30:00.000Z");
  });

  it("fails closed for fall-back folds and exposes both candidates", () => {
    expect(resolveIanaWallTime({
      date: "2026-11-01",
      time: "01:30",
      timeZone: "America/New_York",
    })).toEqual({
      ok: false,
      reason: "ambiguous-wall-time",
      candidates: [
        "2026-11-01T05:30:00.000Z",
        "2026-11-01T06:30:00.000Z",
      ],
    });
  });

  it("can explicitly choose either side of a fold", () => {
    expect(instant({
      date: "2026-11-01",
      time: "01:30",
      timeZone: "America/New_York",
      disambiguation: "earlier",
    })).toBe("2026-11-01T05:30:00.000Z");
    expect(instant({
      date: "2026-11-01",
      time: "01:30",
      timeZone: "America/New_York",
      disambiguation: "later",
    })).toBe("2026-11-01T06:30:00.000Z");
    expect(instant({
      date: "2026-11-01",
      time: "01:30",
      timeZone: "America/New_York",
      disambiguation: "compatible",
    })).toBe("2026-11-01T05:30:00.000Z");
  });

  it("handles Lord Howe's half-hour DST transitions", () => {
    expect(resolveIanaWallTime({
      date: "2026-10-04",
      time: "02:15",
      timeZone: "Australia/Lord_Howe",
    })).toEqual({ ok: false, reason: "nonexistent-wall-time" });
    expect(resolveIanaWallTime({
      date: "2026-04-05",
      time: "01:45",
      timeZone: "Australia/Lord_Howe",
    })).toMatchObject({ ok: false, reason: "ambiguous-wall-time" });
  });

  it("rejects malformed, unsupported, and unknown inputs", () => {
    expect(resolveIanaWallTime({
      date: "2026-02-30",
      time: "10:00",
      timeZone: "America/New_York",
    })).toEqual({ ok: false, reason: "invalid-wall-time" });
    expect(resolveIanaWallTime({
      date: "2101-01-01",
      time: "10:00",
      timeZone: "America/New_York",
    })).toEqual({ ok: false, reason: "unsupported-year" });
    expect(resolveIanaWallTime({
      date: "2026-08-15",
      time: "10:00",
      timeZone: "Mars/Olympus_Mons",
    })).toEqual({ ok: false, reason: "unknown-time-zone" });
    expect(resolveIanaWallTime({
      date: "2026-08-15",
      time: "10:00",
      timeZone: "America/New_York",
      disambiguation: "guess" as "reject",
    })).toEqual({ ok: false, reason: "invalid-wall-time" });
  });
});
