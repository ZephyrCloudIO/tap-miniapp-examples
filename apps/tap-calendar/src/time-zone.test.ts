import { describe, expect, it } from "@rstest/core";
import {
  detectedTimeZone,
  exactTimeZoneMatch,
  filterTimeZones,
  isSupportedTimeZone,
  normalizeTimeZoneSearch,
  timeZoneDisplayDetails,
  timeZoneDisplayLabel,
  timeZoneDisplayLabelForDate,
  timeZoneLocationLabel,
  timeZoneOffsetForDate,
  timeZoneOptions,
} from "./time-zone";

describe("time zone support", () => {
  it("offers the complete maintained list plus UTC and runtime aliases", () => {
    const options = timeZoneOptions();
    expect(options.length).toBeGreaterThan(400);
    expect(options[0]).toBe("UTC");
    expect(options).toContain("Asia/Kathmandu");
    expect(options).toContain("Australia/Eucla");
    expect(options).toContain("Pacific/Chatham");
    expect(options).toContain("Africa/Nairobi");
    expect(options).toContain("Europe/London");
    expect(options).toContain("America/St_Johns");
    expect(new Set(options).size).toBe(options.length);
  });

  it("searches case-insensitively across slashes, underscores, and spaces", () => {
    const options = timeZoneOptions();
    expect(filterTimeZones(options, "new york")).toContain("America/New_York");
    expect(filterTimeZones(options, "ASIA kath")).toContain("Asia/Kathmandu");
    expect(filterTimeZones(options, "st/johns")).toContain("America/St_Johns");
    expect(normalizeTimeZoneSearch("America/Los_Angeles")).toBe("america los angeles");
    expect(normalizeTimeZoneSearch("Pacific (USA)")).toBe("pacific usa");
  });

  it("finds US Pacific Time by its common names, cities, and standard or daylight codes", () => {
    const summer = Date.parse("2026-07-15T13:00:00Z");
    const winter = Date.parse("2026-01-15T14:00:00Z");
    const options = timeZoneOptions();
    for (const query of [
      "ps",
      "PST",
      "PDT",
      "Pacific",
      "Pacific USA",
      "Pacific (USA)",
      "US/Pacific",
      "San Francisco",
    ]) {
      expect(filterTimeZones(options, query, 80, summer)).toContain("America/Los_Angeles");
    }
    expect(filterTimeZones(options, "Pacific", 80, summer)[0]).toBe("America/Los_Angeles");
    expect(filterTimeZones(options, "Pacific Canada", 80, summer)).toContain("America/Vancouver");
    expect(filterTimeZones(options, "Netherlands", 80, summer)).toContain("Europe/Amsterdam");
    expect(filterTimeZones(options, "PDT", 80, winter)).toContain("America/Los_Angeles");
    expect(timeZoneLocationLabel("America/Los_Angeles")).toBe(
      "Pacific Time (United States)",
    );
    expect(timeZoneDisplayLabel("America/Los_Angeles", summer)).toBe(
      "GMT-07:00 · PDT · America/Los_Angeles",
    );
    expect(timeZoneLocationLabel("Europe/Amsterdam")).toBe(
      "Central European Time (The Netherlands)",
    );
  });

  it("shows DST-aware GMT offsets, short codes, and IANA identifiers", () => {
    const winter = Date.parse("2026-01-15T14:00:00Z");
    const summer = Date.parse("2026-07-15T13:00:00Z");
    expect(timeZoneDisplayDetails("America/New_York", winter)).toEqual({
      abbreviation: "EST",
      gmtOffset: "GMT-05:00",
    });
    expect(timeZoneDisplayLabel("America/New_York", summer)).toBe(
      "GMT-04:00 · EDT · America/New_York",
    );
    expect(timeZoneDisplayLabel("Asia/Kathmandu", summer)).toBe(
      "GMT+05:45 · NPT · Asia/Kathmandu",
    );
    expect(timeZoneDisplayLabel("UTC", summer)).toBe("GMT+00:00 · UTC");
    expect(timeZoneDisplayLabelForDate("2026-01-15", "America/New_York", "10:00")).toBe(
      "GMT-05:00 · EST · America/New_York",
    );
  });

  it("finds zones by their current short code and GMT offset", () => {
    const summer = Date.parse("2026-07-15T13:00:00Z");
    const options = ["America/New_York", "America/Los_Angeles", "Asia/Kathmandu"];
    expect(filterTimeZones(options, "EDT", 80, summer)).toEqual(["America/New_York"]);
    expect(filterTimeZones(options, "GMT+05:45", 80, summer)).toEqual(["Asia/Kathmandu"]);
    expect(filterTimeZones(options, "GMT-4", 80, summer)).toEqual(["America/New_York"]);
  });

  it("accepts a valid exact alias even when the enumerated list omits it", () => {
    const options = ["UTC", "Asia/Kathmandu"];
    expect(exactTimeZoneMatch("  utc  ", options)).toBe("UTC");
    expect(exactTimeZoneMatch("Etc/GMT+12", options)).toBe("Etc/GMT+12");
    expect(exactTimeZoneMatch("PST", options)).toBeNull();
    expect(exactTimeZoneMatch("Mars/Olympus_Mons", options)).toBeNull();
  });

  it("uses the runtime zone for new records with a safe UTC fallback contract", () => {
    expect(isSupportedTimeZone(detectedTimeZone())).toBe(true);
  });

  it("calculates DST and non-hour offsets from the selected IANA zone", () => {
    expect(timeZoneOffsetForDate("2026-01-15", "America/New_York", "09:00")).toBe("-05:00");
    expect(timeZoneOffsetForDate("2026-07-15", "America/New_York", "09:00")).toBe("-04:00");
    expect(timeZoneOffsetForDate("2026-01-15", "Asia/Kathmandu", "09:00")).toBe("+05:45");
    expect(timeZoneOffsetForDate("2026-01-15", "Australia/Eucla", "09:00")).toBe("+08:45");
    expect(timeZoneOffsetForDate("2026-06-15", "Pacific/Chatham", "09:00")).toBe("+12:45");
  });
});
