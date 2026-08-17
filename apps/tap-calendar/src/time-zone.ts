import { rawTimeZones, timeZonesNames } from "@vvo/tzdb";
import timeZoneAbbreviations from "@vvo/tzdb/abbreviations.json";

const UTC_TIME_ZONE = "UTC";
const DEFAULT_TIME_ZONE_RESULT_LIMIT = 80;

type IntlWithSupportedValues = typeof Intl & {
  supportedValuesOf?: (key: "timeZone") => string[];
};

let cachedTimeZoneOptions: readonly string[] | null = null;
const supportedTimeZoneCache = new Map<string, boolean>();
const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();
const nameFormatterCache = new Map<string, Intl.DateTimeFormat>();
const displayDetailsCache = new Map<string, TimeZoneDisplayDetails>();
const abbreviationsByLongName = timeZoneAbbreviations as Readonly<Record<string, string>>;

interface TimeZoneSearchMetadata {
  readonly alternativeName: string | null;
  readonly countryName: string | null;
  readonly normalizedAliases: readonly string[];
  readonly normalizedCombinedAliases: string;
}

const countrySearchAliases: Readonly<Record<string, readonly string[]>> = {
  US: ["USA", "United States of America"],
};

const commonTimeZoneAliases: Readonly<Record<string, readonly string[]>> = {
  "America/New_York": ["ET", "EST", "EDT", "Eastern", "Eastern Time"],
  "America/Chicago": ["CT", "CST", "CDT", "Central", "Central Time"],
  "America/Denver": ["MT", "MST", "MDT", "Mountain", "Mountain Time"],
  "America/Phoenix": ["Arizona", "MST", "Mountain Standard Time"],
  "America/Los_Angeles": [
    "PT",
    "PST",
    "PDT",
    "Pacific",
    "Pacific Time",
    "Pacific Standard Time",
    "Pacific Daylight Time",
    "US Pacific",
    "USA Pacific",
    "Pacific USA",
    "West Coast",
  ],
  "America/Anchorage": ["AKT", "AKST", "AKDT", "Alaska", "Alaska Time"],
  "Pacific/Honolulu": ["HT", "HST", "Hawaii", "Hawaii Time"],
};

const timeZoneSearchMetadata = new Map<string, TimeZoneSearchMetadata>();
const rawTimeZoneMetadata = rawTimeZones.map(rawTimeZone => {
  const aliases = Array.from(new Set([
    rawTimeZone.alternativeName,
    rawTimeZone.countryName,
    rawTimeZone.countryCode,
    ...rawTimeZone.mainCities,
    ...rawTimeZone.group,
    rawTimeZone.abbreviation,
    abbreviationsByLongName[rawTimeZone.alternativeName],
    ...(countrySearchAliases[rawTimeZone.countryCode] ?? []),
    ...(commonTimeZoneAliases[rawTimeZone.name] ?? []),
  ].filter((alias): alias is string => Boolean(alias?.trim()))));
  return {
    rawTimeZone,
    metadata: {
      alternativeName: rawTimeZone.alternativeName || null,
      countryName: rawTimeZone.countryName || null,
      normalizedAliases: aliases.map(normalizeTimeZoneSearch),
      normalizedCombinedAliases: normalizeTimeZoneSearch(aliases.join(" ")),
    } satisfies TimeZoneSearchMetadata,
  };
});

// Canonical records are authoritative. tzdb groups overlap, so assigning a
// group alias first can otherwise give a real zone another country's label.
for (const { rawTimeZone, metadata } of rawTimeZoneMetadata) {
  timeZoneSearchMetadata.set(rawTimeZone.name, metadata);
}

const groupAliasOwners = new Map<string, Set<string>>();
for (const { rawTimeZone } of rawTimeZoneMetadata) {
  for (const alias of rawTimeZone.group) {
    if (alias === rawTimeZone.name || timeZoneSearchMetadata.has(alias)) continue;
    const owners = groupAliasOwners.get(alias) ?? new Set<string>();
    owners.add(rawTimeZone.name);
    groupAliasOwners.set(alias, owners);
  }
}
for (const [alias, owners] of groupAliasOwners) {
  if (owners.size !== 1) continue;
  const owner = owners.values().next().value;
  if (owner === undefined) continue;
  const metadata = timeZoneSearchMetadata.get(owner);
  if (metadata) timeZoneSearchMetadata.set(alias, metadata);
}

export interface TimeZoneDisplayDetails {
  readonly abbreviation: string | null;
  readonly gmtOffset: string;
}

function runtimeTimeZoneNames(): readonly string[] {
  try {
    return (Intl as IntlWithSupportedValues).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    return [];
  }
}

/** Return true when the active JavaScript runtime can calculate this zone. */
export function isSupportedTimeZone(value: string): boolean {
  const candidate = value.trim();
  if (candidate.length === 0 || candidate.length > 255) return false;
  const cached = supportedTimeZoneCache.get(candidate);
  if (cached !== undefined) return cached;

  let supported = false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(0);
    supported = true;
  } catch {
    supported = false;
  }
  supportedTimeZoneCache.set(candidate, supported);
  return supported;
}

/**
 * The picker uses the maintained IANA list as its baseline and unions it with
 * the webview's own ICU data. The union preserves both modern and legacy names,
 * while validation prevents offering a zone the current runtime cannot use.
 */
export function timeZoneOptions(currentValues: readonly string[] = []): readonly string[] {
  if (cachedTimeZoneOptions === null) {
    cachedTimeZoneOptions = Array.from(new Set([
      UTC_TIME_ZONE,
      ...timeZonesNames,
      ...runtimeTimeZoneNames(),
    ]))
      .filter(isSupportedTimeZone)
      .sort((left, right) => {
        if (left === UTC_TIME_ZONE) return -1;
        if (right === UTC_TIME_ZONE) return 1;
        return left.localeCompare(right);
      });
  }

  const validExtras = currentValues
    .map(value => value.trim())
    .filter(value => !cachedTimeZoneOptions!.includes(value) && isSupportedTimeZone(value));
  if (validExtras.length === 0) return cachedTimeZoneOptions;
  return [...cachedTimeZoneOptions, ...new Set(validExtras)];
}

export function detectedTimeZone(): string {
  try {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isSupportedTimeZone(detected) ? detected : UTC_TIME_ZONE;
  } catch {
    return UTC_TIME_ZONE;
  }
}

export function normalizeTimeZoneSearch(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\/_-]+/g, " ")
    .replace(/[^\p{L}\p{N}:+]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

function searchScore(normalizedValue: string, normalizedQuery: string): number | null {
  if (normalizedQuery.length === 0) return 10;
  if (normalizedValue === normalizedQuery) return 0;
  if (normalizedValue.startsWith(normalizedQuery)) return 1;

  const zoneWords = normalizedValue.split(" ");
  const queryWords = normalizedQuery.split(" ");
  if (queryWords.every(queryWord => zoneWords.some(word => word.startsWith(queryWord)))) return 2;
  if (queryWords.every(queryWord => normalizedValue.includes(queryWord))) return 3;
  return null;
}

function timeZoneSearchScore(timeZone: string, normalizedQuery: string): number | null {
  const scores = [searchScore(normalizeTimeZoneSearch(timeZone), normalizedQuery)];
  const metadata = timeZoneSearchMetadata.get(timeZone);
  if (metadata) {
    for (const normalizedAlias of metadata.normalizedAliases) {
      scores.push(searchScore(normalizedAlias, normalizedQuery));
    }
    scores.push(searchScore(metadata.normalizedCombinedAliases, normalizedQuery));
  }
  const matches = scores.filter((score): score is number => score !== null);
  return matches.length === 0 ? null : Math.min(...matches);
}

function canonicalGmtOffsetQuery(value: string): string | null {
  const match = /^(?:GMT)?\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?$/iu.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[2]);
  const minutes = Number(match[3] ?? "0");
  if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) return null;
  return `GMT${match[1]}${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function filterTimeZones(
  options: readonly string[],
  query: string,
  limit = DEFAULT_TIME_ZONE_RESULT_LIMIT,
  referenceInstant = Date.now(),
): readonly string[] {
  const normalizedQuery = normalizeTimeZoneSearch(query);
  const gmtOffsetQuery = canonicalGmtOffsetQuery(query);
  const locationMatches = options
    .map(timeZone => ({ timeZone, score: timeZoneSearchScore(timeZone, normalizedQuery) }))
    .filter((candidate): candidate is { readonly timeZone: string; readonly score: number } =>
      candidate.score !== null
    );
  const locationMatchNames = new Set(locationMatches.map(candidate => candidate.timeZone));
  const shouldSearchMetadata = gmtOffsetQuery !== null || normalizedQuery.startsWith("gmt") || locationMatches.length === 0;
  const metadataMatches = shouldSearchMetadata
    ? options
      .filter(timeZone => !locationMatchNames.has(timeZone))
      .map(timeZone => {
        const details = timeZoneDisplayDetails(timeZone, referenceInstant);
        const metadata = normalizeTimeZoneSearch([
          details.gmtOffset,
          details.abbreviation,
        ].filter(Boolean).join(" "));
        const score = gmtOffsetQuery === null
          ? searchScore(metadata, normalizedQuery)
          : details.gmtOffset === gmtOffsetQuery ? 0 : null;
        return { timeZone, score: score === null ? null : score + 4 };
      })
      .filter((candidate): candidate is { readonly timeZone: string; readonly score: number } =>
        candidate.score !== null
      )
    : [];
  return [...locationMatches, ...metadataMatches]
    .sort((left, right) => left.score - right.score || left.timeZone.localeCompare(right.timeZone))
    .slice(0, Math.max(0, limit))
    .map(candidate => candidate.timeZone);
}

/** Resolve an exact typed alias even when it is not enumerated by ICU. */
export function exactTimeZoneMatch(
  query: string,
  options: readonly string[],
): string | null {
  const candidate = query.trim();
  if (candidate.length === 0) return null;
  const listed = options.find(timeZone =>
    timeZone.localeCompare(candidate, "en-US", { sensitivity: "accent" }) === 0
  );
  if (listed) return listed;
  // Bare abbreviations are ambiguous and some ICU builds accept them as
  // implementation-specific aliases. Let the result list disambiguate those
  // terms and persist only a canonical IANA identifier.
  if (!candidate.includes("/") && candidate.toLocaleUpperCase("en-US") !== UTC_TIME_ZONE) {
    return null;
  }
  if (!isSupportedTimeZone(candidate)) return null;
  const canonical = new Intl.DateTimeFormat("en-US", { timeZone: candidate })
    .resolvedOptions()
    .timeZone;
  return options.find(timeZone => timeZone === canonical) ?? canonical;
}

export function timeZoneLocationLabel(timeZone: string): string {
  if (timeZone === UTC_TIME_ZONE) return UTC_TIME_ZONE;
  const metadata = timeZoneSearchMetadata.get(timeZone);
  if (metadata?.alternativeName && metadata.countryName) {
    return `${metadata.alternativeName} (${metadata.countryName})`;
  }
  const parts = timeZone.split("/");
  return (parts.length > 1 ? parts.slice(1) : parts)
    .join(" · ")
    .replaceAll("_", " ");
}

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = partsFormatterCache.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    calendar: "iso8601",
    numberingSystem: "latn",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  partsFormatterCache.set(timeZone, formatter);
  return formatter;
}

function offsetMinutesAtInstant(timeZone: string, instant: number): number {
  const values: Record<string, number> = {};
  for (const part of partsFormatter(timeZone).formatToParts(new Date(instant))) {
    if (["year", "month", "day", "hour", "minute", "second"].includes(part.type)) {
      values[part.type] = Number(part.value);
    }
  }
  const asUtc = Date.UTC(
    values.year ?? 0,
    (values.month ?? 1) - 1,
    values.day ?? 1,
    values.hour ?? 0,
    values.minute ?? 0,
    values.second ?? 0,
  );
  return Math.round((asUtc - Math.trunc(instant / 1_000) * 1_000) / 60_000);
}

function formatOffset(minutes: number): string {
  const sign = minutes >= 0 ? "+" : "-";
  const absolute = Math.abs(minutes);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}

function timeZoneNameAtInstant(
  timeZone: string,
  instant: number,
  format: "long" | "short",
): string | null {
  const cacheKey = `${timeZone}:${format}`;
  let formatter = nameFormatterCache.get(cacheKey);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: format,
      year: "numeric",
    });
    nameFormatterCache.set(cacheKey, formatter);
  }
  return formatter
    .formatToParts(new Date(instant))
    .find(part => part.type === "timeZoneName")
    ?.value ?? null;
}

/** Return the current numeric GMT offset and familiar short code for a zone. */
export function timeZoneDisplayDetails(
  timeZone: string,
  instant = Date.now(),
): TimeZoneDisplayDetails {
  if (!isSupportedTimeZone(timeZone)) throw new Error(`Unsupported time zone: ${timeZone}`);
  const cacheKey = `${timeZone}:${Math.floor(instant / 60_000)}`;
  const cached = displayDetailsCache.get(cacheKey);
  if (cached) return cached;

  const shortName = timeZoneNameAtInstant(timeZone, instant, "short");
  const longName = timeZoneNameAtInstant(timeZone, instant, "long");
  const shortCode = shortName && !/^GMT(?:[+-]|$)/u.test(shortName) ? shortName : null;
  const details = {
    abbreviation: shortCode ?? (longName ? abbreviationsByLongName[longName] ?? null : null),
    gmtOffset: `GMT${formatOffset(offsetMinutesAtInstant(timeZone, instant))}`,
  } satisfies TimeZoneDisplayDetails;
  displayDetailsCache.set(cacheKey, details);
  return details;
}

/** A compact, copyable label used by picker options and schedule summaries. */
export function timeZoneDisplayLabel(timeZone: string, instant = Date.now()): string {
  const details = timeZoneDisplayDetails(timeZone, instant);
  return Array.from(new Set([
    details.gmtOffset,
    details.abbreviation,
    timeZone,
  ].filter((part): part is string => Boolean(part)))).join(" · ");
}

/** Format a zone using the offset/code in effect for a local calendar date. */
export function timeZoneDisplayLabelForDate(
  date: string,
  timeZone: string,
  localTime = "12:00",
): string {
  const offset = timeZoneOffsetForDate(date, timeZone, localTime);
  const instant = Date.parse(`${date}T${localTime}:00${offset}`);
  return timeZoneDisplayLabel(timeZone, instant);
}

/**
 * Calculate the numeric offset for a wall-clock time in an IANA zone. Two
 * refinement passes account for zones whose local date differs from UTC and
 * for daylight-saving changes.
 */
export function timeZoneOffsetForDate(
  date: string,
  timeZone: string,
  localTime = "12:00",
): string {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(localTime);
  if (!dateMatch || !timeMatch) throw new Error("A calendar date and HH:MM time are required.");
  if (!isSupportedTimeZone(timeZone)) throw new Error(`Unsupported time zone: ${timeZone}`);

  const wallClockUtc = Date.UTC(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    Number(timeMatch[1]),
    Number(timeMatch[2]),
  );
  let offset = offsetMinutesAtInstant(timeZone, wallClockUtc);
  for (let pass = 0; pass < 2; pass += 1) {
    const candidateInstant = wallClockUtc - offset * 60_000;
    const refined = offsetMinutesAtInstant(timeZone, candidateInstant);
    if (refined === offset) break;
    offset = refined;
  }
  return formatOffset(offset);
}
