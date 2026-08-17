import {
  findTimeZone,
  getZonedTime,
  populateTimeZones,
} from "timezone-support/lookup-convert";
import {
  MCP_TIME_ZONE_DATA,
  MCP_TIME_ZONE_DATA_FIRST_YEAR,
  MCP_TIME_ZONE_DATA_LAST_YEAR,
} from "./time-zone-data.generated";

/**
 * `compatible` follows Temporal's convention: later across a gap and earlier
 * in a fold. Scheduling callers should normally keep the fail-closed default.
 */
export type WallTimeDisambiguation =
  | "reject"
  | "earlier"
  | "later"
  | "compatible";

export interface IanaWallTimeInput {
  readonly date: string;
  readonly time: string;
  readonly timeZone: string;
  readonly disambiguation?: WallTimeDisambiguation;
}

export type IanaWallTimeResolution =
  | {
      readonly ok: true;
      readonly instant: Date;
      readonly kind:
        | "exact"
        | "fold-earlier"
        | "fold-later"
        | "gap-earlier"
        | "gap-later";
    }
  | {
      readonly ok: false;
      readonly reason:
        | "invalid-wall-time"
        | "unsupported-year"
        | "unknown-time-zone"
        | "nonexistent-wall-time"
        | "ambiguous-wall-time";
      readonly candidates?: readonly string[];
    };

export type IanaZonedInstantResolution =
  | {
      readonly ok: true;
      readonly date: string;
      readonly time: string;
      readonly year: number;
      readonly month: number;
      readonly day: number;
      readonly hour: number;
      readonly minute: number;
    }
  | {
      readonly ok: false;
      readonly reason: "invalid-instant" | "unsupported-year" | "unknown-time-zone";
    };

interface WallTimeParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hours: number;
  readonly minutes: number;
}

interface RuntimeTimeZone {
  readonly name: string;
  readonly offsets: readonly number[];
  readonly untils: readonly number[];
}

// timezone-support's published declaration describes `zones` as a dictionary,
// while its runtime intentionally consumes Moment's packed string array.
populateTimeZones(MCP_TIME_ZONE_DATA as never);

function parseWallTime(date: string, time: string): WallTimeParts | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dateMatch || !timeMatch) return null;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2]);
  if (hours > 23 || minutes > 59) return null;

  const normalized = new Date(Date.UTC(year, month - 1, day));
  if (
    normalized.getUTCFullYear() !== year ||
    normalized.getUTCMonth() + 1 !== month ||
    normalized.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day, hours, minutes };
}

function sameWallTime(
  epoch: number,
  timeZone: RuntimeTimeZone,
  expected: WallTimeParts,
): boolean {
  const actual = getZonedTime(epoch, timeZone) as {
    readonly year: number;
    readonly month: number;
    readonly day: number;
    readonly hours: number;
    readonly minutes: number;
    readonly seconds?: number;
    readonly milliseconds?: number;
  };
  return actual.year === expected.year &&
    actual.month === expected.month &&
    actual.day === expected.day &&
    actual.hours === expected.hours &&
    actual.minutes === expected.minutes &&
    (actual.seconds ?? 0) === 0 &&
    (actual.milliseconds ?? 0) === 0;
}

function resolveGap(
  wallClockUtc: number,
  timeZone: RuntimeTimeZone,
  disambiguation: WallTimeDisambiguation,
): IanaWallTimeResolution {
  for (let index = 0; index < timeZone.offsets.length - 1; index += 1) {
    const transition = timeZone.untils[index];
    const oldOffset = timeZone.offsets[index];
    const newOffset = timeZone.offsets[index + 1];
    if (
      transition === undefined ||
      oldOffset === undefined ||
      newOffset === undefined ||
      !Number.isFinite(transition)
    ) {
      continue;
    }

    const wallBefore = transition - oldOffset * 60_000;
    const wallAfter = transition - newOffset * 60_000;
    if (
      wallAfter > wallBefore &&
      wallClockUtc >= wallBefore &&
      wallClockUtc < wallAfter
    ) {
      if (disambiguation === "reject") {
        return { ok: false, reason: "nonexistent-wall-time" };
      }
      const chooseEarlier = disambiguation === "earlier";
      return {
        ok: true,
        instant: new Date(
          wallClockUtc + (chooseEarlier ? newOffset : oldOffset) * 60_000,
        ),
        kind: chooseEarlier ? "gap-earlier" : "gap-later",
      };
    }
  }
  return { ok: false, reason: "nonexistent-wall-time" };
}

/** Resolve an IANA wall time without relying on the host's `Intl` support. */
export function resolveIanaWallTime(
  input: IanaWallTimeInput,
): IanaWallTimeResolution {
  const parsed = parseWallTime(input.date, input.time);
  if (
    !parsed ||
    input.timeZone.trim().length === 0 ||
    (input.disambiguation !== undefined &&
      input.disambiguation !== "reject" &&
      input.disambiguation !== "earlier" &&
      input.disambiguation !== "later" &&
      input.disambiguation !== "compatible")
  ) {
    return { ok: false, reason: "invalid-wall-time" };
  }
  if (
    parsed.year < MCP_TIME_ZONE_DATA_FIRST_YEAR ||
    parsed.year > MCP_TIME_ZONE_DATA_LAST_YEAR
  ) {
    return { ok: false, reason: "unsupported-year" };
  }

  let timeZone: RuntimeTimeZone;
  try {
    timeZone = findTimeZone(input.timeZone) as RuntimeTimeZone;
  } catch {
    return { ok: false, reason: "unknown-time-zone" };
  }

  const wallClockUtc = Date.UTC(
    parsed.year,
    parsed.month - 1,
    parsed.day,
    parsed.hours,
    parsed.minutes,
  );
  const candidates = [...new Set(timeZone.offsets)]
    .map(offset => wallClockUtc + offset * 60_000)
    .filter(epoch => sameWallTime(epoch, timeZone, parsed))
    .sort((left, right) => left - right);

  const firstCandidate = candidates[0];
  if (candidates.length === 1 && firstCandidate !== undefined) {
    return { ok: true, instant: new Date(firstCandidate), kind: "exact" };
  }

  const disambiguation = input.disambiguation ?? "reject";
  if (candidates.length > 1) {
    if (disambiguation === "reject") {
      return {
        ok: false,
        reason: "ambiguous-wall-time",
        candidates: candidates.map(epoch => new Date(epoch).toISOString()),
      };
    }
    const chooseLater = disambiguation === "later";
    const selected = chooseLater
      ? candidates[candidates.length - 1]
      : firstCandidate;
    if (selected === undefined) {
      return { ok: false, reason: "ambiguous-wall-time" };
    }
    return {
      ok: true,
      instant: new Date(selected),
      kind: chooseLater ? "fold-later" : "fold-earlier",
    };
  }

  return resolveGap(wallClockUtc, timeZone, disambiguation);
}

/** Convert an instant to IANA-local fields without requiring the host's Intl. */
export function ianaZonedInstant(
  instant: Date | number,
  timeZoneName: string,
): IanaZonedInstantResolution {
  const epoch = typeof instant === "number" ? instant : instant.getTime();
  if (!Number.isFinite(epoch) || timeZoneName.trim().length === 0) {
    return { ok: false, reason: "invalid-instant" };
  }
  let timeZone: RuntimeTimeZone;
  try {
    timeZone = findTimeZone(timeZoneName) as RuntimeTimeZone;
  } catch {
    return { ok: false, reason: "unknown-time-zone" };
  }
  const zoned = getZonedTime(epoch, timeZone) as {
    readonly year: number;
    readonly month: number;
    readonly day: number;
    readonly hours: number;
    readonly minutes: number;
  };
  if (
    zoned.year < MCP_TIME_ZONE_DATA_FIRST_YEAR ||
    zoned.year > MCP_TIME_ZONE_DATA_LAST_YEAR
  ) {
    return { ok: false, reason: "unsupported-year" };
  }
  const date = `${String(zoned.year).padStart(4, "0")}-${String(zoned.month).padStart(2, "0")}-${String(zoned.day).padStart(2, "0")}`;
  const time = `${String(zoned.hours).padStart(2, "0")}:${String(zoned.minutes).padStart(2, "0")}`;
  return {
    ok: true,
    date,
    time,
    year: zoned.year,
    month: zoned.month,
    day: zoned.day,
    hour: zoned.hours,
    minute: zoned.minutes,
  };
}
