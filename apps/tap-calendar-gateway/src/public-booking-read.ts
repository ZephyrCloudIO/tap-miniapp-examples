import type {
  PublicationAvailabilityOverride,
  PublicationAvailabilityWindow,
} from "./public-booking-publication";

const PUBLIC_PAGE_SNAPSHOT_SCHEMA_VERSION = "tap.calendar.public-page-snapshot.v1" as const;
const PRIVATE_PAGE_SNAPSHOT_SCHEMA_VERSION = "tap.calendar.private-page-snapshot.v1" as const;
const PUBLIC_PROFILE_SCHEMA_VERSION = "tap.calendar.public-profile.v1" as const;
const PUBLIC_PAGE_SCHEMA_VERSION = "tap.calendar.public-page.v1" as const;
const PUBLIC_AVAILABILITY_SCHEMA_VERSION = "tap.calendar.public-availability.v1" as const;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const CLOCK_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
const REVISION_PATTERN = /^[A-Za-z0-9_-]{8,255}$/u;
const BASE64_URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const SLOT_INTERVAL_MINUTES = 30;
const SLOT_TOKEN_TTL_SECONDS = 5 * 60;
const MAX_SLOT_TOKEN_TTL_SECONDS = 15 * 60;
const MAX_TOKEN_LENGTH = 4_096;
const MAX_SIGNING_KEY_BYTES = 4_096;
const MIN_SIGNING_KEY_BYTES = 32;
const MILLISECONDS_PER_MINUTE = 60_000;
const MILLISECONDS_PER_DAY = 86_400_000;

export type PublicBookingPageRouteResource = "page" | "availability" | "bookings";

export interface PublicBookingPageRoute {
  readonly profileSlug: string;
  readonly eventTypeSlug: string;
  readonly resource: PublicBookingPageRouteResource;
}

export interface PublicAvailabilityQuery {
  readonly month: string;
  readonly timeZone: string;
  readonly pageRevision: string;
}

export interface PublicPageSnapshot {
  readonly schemaVersion: typeof PUBLIC_PAGE_SNAPSHOT_SCHEMA_VERSION;
  readonly displayName: string;
  readonly title: string;
  readonly description: string;
  readonly durationMinutes: number;
  readonly location: "google-meet" | "phone" | "in-person" | "custom";
  readonly locationLabel: string;
  readonly approvalRequired: boolean;
}

export interface PublicAvailabilityScheduleSnapshot {
  readonly timeZone: string;
  readonly preferredStart: string;
  readonly preferredEnd: string;
  readonly bufferBeforeMinutes: number;
  readonly bufferAfterMinutes: number;
  readonly minimumNoticeMinutes: number;
  readonly bookingHorizonDays: number;
  readonly windows: readonly PublicationAvailabilityWindow[];
  readonly overrides: readonly PublicationAvailabilityOverride[];
}

export interface PrivatePageSnapshot {
  readonly schemaVersion: typeof PRIVATE_PAGE_SNAPSHOT_SCHEMA_VERSION;
  readonly workspaceId: string;
  readonly principalId: string;
  readonly destinationCalendarId: string;
  readonly conflictCalendarIds: readonly string[];
  readonly sourceAvailabilityScheduleId: string;
  readonly location: string;
  readonly schedule: PublicAvailabilityScheduleSnapshot;
}

/**
 * Internal routing result. Never serialize this value: it intentionally carries
 * provider routing and owner scope used for the authoritative availability read.
 */
export interface ResolvedPublishedPublicBookingPage {
  readonly profileId: string;
  readonly pageId: string;
  readonly revisionId: string;
  readonly profileSlug: string;
  readonly eventTypeSlug: string;
  readonly publishedAt: string;
  readonly publicSnapshot: PublicPageSnapshot;
  readonly privateSnapshot: PrivatePageSnapshot;
}

export interface ProjectedPublicBookingPage {
  readonly schemaVersion: typeof PUBLIC_PAGE_SCHEMA_VERSION;
  readonly pageRevision: string;
  readonly canonicalUrl: string;
  readonly profile: {
    readonly displayName: string;
    readonly initials: string;
  };
  readonly eventType: {
    readonly title: string;
    readonly description?: string;
    readonly durationMinutes: number;
    readonly location: PublicPageSnapshot["location"];
    readonly locationLabel: string;
    readonly approvalRequired: boolean;
  };
  readonly bookingWindow: {
    readonly firstDate: string;
    readonly lastDate: string;
  };
  readonly turnstile: {
    readonly siteKey: string;
  };
}

export interface ResolvedPublishedPublicBookingProfile {
  readonly profileId: string;
  readonly profileSlug: string;
  readonly displayName: string;
  readonly eventTypes: readonly {
    readonly eventTypeSlug: string;
    readonly publicSnapshot: PublicPageSnapshot;
  }[];
}

export interface ProjectedPublicBookingProfile {
  readonly schemaVersion: typeof PUBLIC_PROFILE_SCHEMA_VERSION;
  readonly canonicalUrl: string;
  readonly profile: {
    readonly displayName: string;
    readonly initials: string;
  };
  readonly eventTypes: readonly {
    readonly eventTypeSlug: string;
    readonly canonicalUrl: string;
    readonly title: string;
    readonly description?: string;
    readonly durationMinutes: number;
    readonly location: PublicPageSnapshot["location"];
    readonly locationLabel: string;
    readonly approvalRequired: boolean;
  }[];
}

export interface PublicBusyInterval {
  readonly start: string;
  readonly end: string;
}

export interface PublicAvailabilityCandidate {
  readonly start: string;
  readonly end: string;
}

interface RankedPublicAvailabilityCandidate extends PublicAvailabilityCandidate {
  readonly preferred: boolean;
}

export interface GroupedPublicAvailabilityCandidates {
  readonly date: string;
  readonly slots: readonly PublicAvailabilityCandidate[];
}

export interface PublicAvailabilityQueryWindow {
  readonly timeMin: string;
  readonly timeMax: string;
}

export interface PublicSlotTokenClaims {
  readonly v: 1;
  readonly revisionId: string;
  readonly start: string;
  readonly end: string;
  /** Unix seconds. */
  readonly iat: number;
  /** Unix seconds. */
  readonly exp: number;
}

export interface PublicBookingAvailability {
  readonly schemaVersion: typeof PUBLIC_AVAILABILITY_SCHEMA_VERSION;
  readonly pageRevision: string;
  readonly viewerTimeZone: string;
  readonly month: string;
  readonly generatedAt: string;
  readonly expiresAt: string;
  readonly dates: readonly {
    readonly date: string;
    readonly slots: readonly {
      readonly start: string;
      readonly end: string;
      readonly token: string;
    }[];
  }[];
}

interface PublishedPageRow {
  readonly profile_id: string;
  readonly workspace_id: string;
  readonly principal_id: string;
  readonly page_id: string;
  readonly revision_id: string;
  readonly profile_slug: string;
  readonly event_type_slug: string;
  readonly published_at: string;
  readonly public_snapshot_json: string;
  readonly private_snapshot_json: string;
}

interface PublishedProfilePageRow {
  readonly profile_id: string;
  readonly profile_slug: string;
  readonly display_name: string;
  readonly event_type_slug: string | null;
  readonly public_snapshot_json: string | null;
}

interface WallClockParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

type FormatterCache = Map<string, Intl.DateTimeFormat>;

export type PublicBookingReadDatabase = Pick<D1Database, "prepare">;

export class PublicBookingReadError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "PublicBookingReadError";
    this.status = status;
    this.code = code;
  }
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const exactKeys = (value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};

const validIdentifier = (value: unknown, maximum = 255): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= maximum && value.trim() === value;

const validInteger = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum;

const validClockTime = (value: unknown): value is string =>
  typeof value === "string" && CLOCK_TIME_PATTERN.test(value);

const validCalendarDate = (value: unknown): value is string => {
  if (typeof value !== "string" || !CALENDAR_DATE_PATTERN.test(value)) return false;
  const instant = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(instant) && new Date(instant).toISOString().slice(0, 10) === value;
};

const validInstant = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value));

const validTimeZone = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length === 0 || value.length > 255 || value.trim() !== value) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
};

const invalidStoredSnapshot = (): never => {
  throw new PublicBookingReadError(
    503,
    "published_page_invalid",
    "This booking page is temporarily unavailable.",
  );
};

function parsePublicSnapshot(value: unknown): PublicPageSnapshot {
  if (
    !isRecord(value) ||
    value.schemaVersion !== PUBLIC_PAGE_SNAPSHOT_SCHEMA_VERSION ||
    !validIdentifier(value.displayName, 160) ||
    !validIdentifier(value.title, 160) ||
    typeof value.description !== "string" ||
    value.description.length > 2_000 ||
    !validInteger(value.durationMinutes, 5, 1_440) ||
    !["google-meet", "phone", "in-person", "custom"].includes(String(value.location)) ||
    !validIdentifier(value.locationLabel, 160) ||
    typeof value.approvalRequired !== "boolean"
  ) return invalidStoredSnapshot();
  return {
    schemaVersion: PUBLIC_PAGE_SNAPSHOT_SCHEMA_VERSION,
    displayName: value.displayName,
    title: value.title,
    description: value.description,
    durationMinutes: value.durationMinutes,
    location: value.location as PublicPageSnapshot["location"],
    locationLabel: value.locationLabel,
    approvalRequired: value.approvalRequired,
  };
}

function parseWindow(value: unknown): PublicationAvailabilityWindow {
  if (
    !isRecord(value) ||
    !validInteger(value.day, 0, 6) ||
    typeof value.enabled !== "boolean" ||
    !validClockTime(value.start) ||
    !validClockTime(value.end) ||
    value.start >= value.end
  ) return invalidStoredSnapshot();
  return { day: value.day, enabled: value.enabled, start: value.start, end: value.end };
}

function parseOverride(value: unknown, scheduleTimeZone: string): PublicationAvailabilityOverride {
  if (
    !isRecord(value) ||
    !validCalendarDate(value.date) ||
    !validIdentifier(value.label, 160) ||
    typeof value.available !== "boolean"
  ) return invalidStoredSnapshot();
  const timeZone = value.timeZone === undefined ? scheduleTimeZone : value.timeZone;
  if (!validTimeZone(timeZone)) return invalidStoredSnapshot();
  if (!value.available) {
    return { date: value.date, label: value.label, available: false, timeZone };
  }
  if (!validClockTime(value.start) || !validClockTime(value.end) || value.start >= value.end) {
    return invalidStoredSnapshot();
  }
  return {
    date: value.date,
    label: value.label,
    available: true,
    timeZone,
    start: value.start,
    end: value.end,
  };
}

function parsePrivateSnapshot(value: unknown): PrivatePageSnapshot {
  if (
    !isRecord(value) ||
    value.schemaVersion !== PRIVATE_PAGE_SNAPSHOT_SCHEMA_VERSION ||
    !validIdentifier(value.workspaceId) ||
    !validIdentifier(value.principalId) ||
    !validIdentifier(value.destinationCalendarId) ||
    !Array.isArray(value.conflictCalendarIds) ||
    value.conflictCalendarIds.length === 0 ||
    value.conflictCalendarIds.length > 50 ||
    !validIdentifier(value.sourceAvailabilityScheduleId) ||
    !validIdentifier(value.location, 64) ||
    !isRecord(value.schedule)
  ) return invalidStoredSnapshot();
  const conflictCalendarIds = value.conflictCalendarIds.filter(candidate => validIdentifier(candidate));
  if (
    conflictCalendarIds.length !== value.conflictCalendarIds.length ||
    new Set(conflictCalendarIds).size !== conflictCalendarIds.length ||
    !conflictCalendarIds.includes(value.destinationCalendarId)
  ) return invalidStoredSnapshot();
  const schedule = value.schedule;
  if (
    !validTimeZone(schedule.timeZone) ||
    !validClockTime(schedule.preferredStart) ||
    !validClockTime(schedule.preferredEnd) ||
    schedule.preferredStart >= schedule.preferredEnd ||
    !validInteger(schedule.bufferBeforeMinutes, 0, 1_440) ||
    !validInteger(schedule.bufferAfterMinutes, 0, 1_440) ||
    !validInteger(schedule.minimumNoticeMinutes, 0, 10_080) ||
    !validInteger(schedule.bookingHorizonDays, 1, 365) ||
    !Array.isArray(schedule.windows) ||
    schedule.windows.length === 0 ||
    schedule.windows.length > 28 ||
    !Array.isArray(schedule.overrides) ||
    schedule.overrides.length > 366
  ) return invalidStoredSnapshot();
  const scheduleTimeZone = schedule.timeZone;
  const windows = schedule.windows.map(parseWindow);
  const overrides = schedule.overrides.map(candidate => parseOverride(candidate, scheduleTimeZone));
  if (new Set(overrides.map(override => override.date)).size !== overrides.length) {
    return invalidStoredSnapshot();
  }
  return {
    schemaVersion: PRIVATE_PAGE_SNAPSHOT_SCHEMA_VERSION,
    workspaceId: value.workspaceId,
    principalId: value.principalId,
    destinationCalendarId: value.destinationCalendarId,
    conflictCalendarIds,
    sourceAvailabilityScheduleId: value.sourceAvailabilityScheduleId,
    location: value.location,
    schedule: {
      timeZone: scheduleTimeZone,
      preferredStart: schedule.preferredStart,
      preferredEnd: schedule.preferredEnd,
      bufferBeforeMinutes: schedule.bufferBeforeMinutes,
      bufferAfterMinutes: schedule.bufferAfterMinutes,
      minimumNoticeMinutes: schedule.minimumNoticeMinutes,
      bookingHorizonDays: schedule.bookingHorizonDays,
      windows,
      overrides,
    },
  };
}

const validSlug = (value: string): boolean =>
  value.length >= 2 && value.length <= 64 && SLUG_PATTERN.test(value);

export function parsePublicBookingPagePath(pathname: string): PublicBookingPageRoute | null {
  const match = /^\/api\/public\/pages\/([a-z0-9]+(?:-[a-z0-9]+)*)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/(availability|bookings))?$/u.exec(pathname);
  if (!match?.[1] || !match[2] || !validSlug(match[1]) || !validSlug(match[2])) return null;
  return {
    profileSlug: match[1],
    eventTypeSlug: match[2],
    resource: match[3] === "availability" || match[3] === "bookings" ? match[3] : "page",
  };
}

export function parsePublicBookingProfilePath(pathname: string): string | null {
  const match = /^\/api\/public\/profiles\/([a-z0-9]+(?:-[a-z0-9]+)*)$/u.exec(pathname);
  return match?.[1] && validSlug(match[1]) ? match[1] : null;
}

export function publicAvailabilityQuery(searchParams: URLSearchParams): PublicAvailabilityQuery {
  const allowed = new Set(["month", "timeZone", "pageRevision"]);
  const entries = [...searchParams.entries()];
  if (
    entries.length !== 3 ||
    entries.some(([key]) => !allowed.has(key)) ||
    [...allowed].some(key => searchParams.getAll(key).length !== 1)
  ) {
    throw new PublicBookingReadError(
      400,
      "invalid_availability_query",
      "Availability requires exactly one month, timeZone, and pageRevision.",
    );
  }
  const month = searchParams.get("month");
  const timeZone = searchParams.get("timeZone");
  const pageRevision = searchParams.get("pageRevision");
  if (!validCalendarDate(month) || !month.endsWith("-01")) {
    throw new PublicBookingReadError(400, "invalid_month", "month must be the first date of a calendar month.");
  }
  if (!validTimeZone(timeZone)) {
    throw new PublicBookingReadError(400, "invalid_time_zone", "timeZone must be a supported IANA time zone.");
  }
  if (typeof pageRevision !== "string" || !REVISION_PATTERN.test(pageRevision)) {
    throw new PublicBookingReadError(400, "invalid_revision", "pageRevision is invalid.");
  }
  return { month, timeZone, pageRevision };
}

function parseSnapshotJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return invalidStoredSnapshot();
  }
}

export async function resolvePublishedPublicBookingProfile(
  database: PublicBookingReadDatabase,
  profileSlug: string,
): Promise<ResolvedPublishedPublicBookingProfile> {
  if (!validSlug(profileSlug)) {
    throw new PublicBookingReadError(
      404,
      "public_profile_unavailable",
      "This booking profile is unavailable.",
    );
  }
  const rows = (await database.prepare(
    `SELECT profiles.id AS profile_id,
            profile_slugs.slug AS profile_slug,
            profiles.display_name,
            published_pages.event_type_slug,
            published_pages.public_snapshot_json
       FROM public_booking_profile_slugs AS profile_slugs
       INNER JOIN public_booking_profiles AS profiles
         ON profiles.id = profile_slugs.profile_id
       LEFT JOIN (
         SELECT pages.profile_id,
                page_slugs.slug AS event_type_slug,
                revisions.public_snapshot_json
           FROM public_booking_pages AS pages
           INNER JOIN public_booking_page_slugs AS page_slugs
             ON page_slugs.page_id = pages.id
            AND page_slugs.profile_id = pages.profile_id
           INNER JOIN public_booking_page_revisions AS revisions
             ON revisions.id = pages.current_revision_id
            AND revisions.page_id = pages.id
          WHERE pages.status = 'published'
            AND page_slugs.active = 1
            AND pages.current_slug = page_slugs.slug COLLATE NOCASE
       ) AS published_pages
         ON published_pages.profile_id = profiles.id
      WHERE profile_slugs.slug = ? COLLATE NOCASE
        AND profile_slugs.active = 1
        AND profiles.current_slug = profile_slugs.slug COLLATE NOCASE
        AND profiles.status = 'published'
      ORDER BY published_pages.event_type_slug COLLATE NOCASE,
               published_pages.event_type_slug`,
  ).bind(profileSlug).all<PublishedProfilePageRow>()).results;
  const profile = rows[0];
  if (!profile) {
    throw new PublicBookingReadError(
      404,
      "public_profile_unavailable",
      "This booking profile is unavailable.",
    );
  }
  if (
    !validIdentifier(profile.profile_id) ||
    !validSlug(profile.profile_slug) ||
    !validIdentifier(profile.display_name, 160)
  ) return invalidStoredSnapshot();
  const eventTypes = rows.flatMap(page => {
    if (
      page.profile_id !== profile.profile_id ||
      page.profile_slug !== profile.profile_slug ||
      page.display_name !== profile.display_name
    ) return invalidStoredSnapshot();
    if (page.event_type_slug === null && page.public_snapshot_json === null) return [];
    if (
      typeof page.event_type_slug !== "string" ||
      !validSlug(page.event_type_slug) ||
      typeof page.public_snapshot_json !== "string"
    ) return invalidStoredSnapshot();
    return [{
      eventTypeSlug: page.event_type_slug,
      publicSnapshot: parsePublicSnapshot(parseSnapshotJson(page.public_snapshot_json)),
    }];
  });
  return {
    profileId: profile.profile_id,
    profileSlug: profile.profile_slug,
    displayName: profile.display_name,
    eventTypes,
  };
}

export async function resolvePublishedPublicBookingPage(
  database: PublicBookingReadDatabase,
  profileSlug: string,
  eventTypeSlug: string,
): Promise<ResolvedPublishedPublicBookingPage> {
  if (!validSlug(profileSlug) || !validSlug(eventTypeSlug)) {
    throw new PublicBookingReadError(404, "public_page_unavailable", "This booking page is unavailable.");
  }
  const row = await database.prepare(
    `SELECT profiles.id AS profile_id,
            profiles.workspace_id,
            profiles.principal_id,
            pages.id AS page_id,
            revisions.id AS revision_id,
            profile_slugs.slug AS profile_slug,
            page_slugs.slug AS event_type_slug,
            pages.published_at AS published_at,
            revisions.public_snapshot_json,
            revisions.private_snapshot_json
       FROM public_booking_profile_slugs AS profile_slugs
       INNER JOIN public_booking_profiles AS profiles
         ON profiles.id = profile_slugs.profile_id
       INNER JOIN public_booking_page_slugs AS page_slugs
         ON page_slugs.profile_id = profiles.id
       INNER JOIN public_booking_pages AS pages
         ON pages.id = page_slugs.page_id
        AND pages.profile_id = profiles.id
       INNER JOIN public_booking_page_revisions AS revisions
         ON revisions.id = pages.current_revision_id
        AND revisions.page_id = pages.id
      WHERE profile_slugs.slug = ? COLLATE NOCASE
        AND page_slugs.slug = ? COLLATE NOCASE
        AND profile_slugs.active = 1
        AND page_slugs.active = 1
        AND profiles.current_slug = profile_slugs.slug COLLATE NOCASE
        AND pages.current_slug = page_slugs.slug COLLATE NOCASE
        AND profiles.status = 'published'
        AND pages.status = 'published'
      LIMIT 1`,
  ).bind(profileSlug, eventTypeSlug).first<PublishedPageRow>();
  if (!row || !row.published_at) {
    throw new PublicBookingReadError(404, "public_page_unavailable", "This booking page is unavailable.");
  }
  const privateSnapshot = parsePrivateSnapshot(parseSnapshotJson(row.private_snapshot_json));
  if (
    privateSnapshot.workspaceId !== row.workspace_id ||
    privateSnapshot.principalId !== row.principal_id
  ) return invalidStoredSnapshot();
  return {
    profileId: row.profile_id,
    pageId: row.page_id,
    revisionId: row.revision_id,
    profileSlug: row.profile_slug,
    eventTypeSlug: row.event_type_slug,
    publishedAt: row.published_at,
    publicSnapshot: parsePublicSnapshot(parseSnapshotJson(row.public_snapshot_json)),
    privateSnapshot,
  };
}

export async function assertPublicPageStillCurrent(
  database: PublicBookingReadDatabase,
  resolved: ResolvedPublishedPublicBookingPage,
): Promise<void> {
  const current = await database.prepare(
    `SELECT 1 AS current
       FROM public_booking_profiles AS profiles
       INNER JOIN public_booking_profile_slugs AS profile_slugs
         ON profile_slugs.profile_id = profiles.id
        AND profile_slugs.active = 1
       INNER JOIN public_booking_pages AS pages
         ON pages.profile_id = profiles.id
       INNER JOIN public_booking_page_slugs AS page_slugs
         ON page_slugs.page_id = pages.id
        AND page_slugs.profile_id = profiles.id
        AND page_slugs.active = 1
       INNER JOIN public_booking_page_revisions AS revisions
         ON revisions.id = pages.current_revision_id
        AND revisions.page_id = pages.id
      WHERE profiles.id = ?
        AND pages.id = ?
        AND revisions.id = ?
        AND profile_slugs.slug = ? COLLATE NOCASE
        AND page_slugs.slug = ? COLLATE NOCASE
        AND profiles.status = 'published'
        AND pages.status = 'published'
      LIMIT 1`,
  ).bind(
    resolved.profileId,
    resolved.pageId,
    resolved.revisionId,
    resolved.profileSlug,
    resolved.eventTypeSlug,
  ).first<number>("current");
  if (current !== 1) {
    throw new PublicBookingReadError(
      409,
      "public_page_changed",
      "This booking page changed. Reload it before choosing a time.",
    );
  }
}

const formatterFor = (timeZone: string, cache: FormatterCache): Intl.DateTimeFormat => {
  const cached = cache.get(timeZone);
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
  cache.set(timeZone, formatter);
  return formatter;
};

const wallClockParts = (instant: number, timeZone: string, cache: FormatterCache): WallClockParts => {
  const values: Record<string, number> = {};
  for (const part of formatterFor(timeZone, cache).formatToParts(new Date(instant))) {
    if (["year", "month", "day", "hour", "minute", "second"].includes(part.type)) {
      values[part.type] = Number(part.value);
    }
  }
  return {
    year: values.year ?? 0,
    month: values.month ?? 0,
    day: values.day ?? 0,
    hour: values.hour ?? 0,
    minute: values.minute ?? 0,
    second: values.second ?? 0,
  };
};

const calendarDateInTimeZone = (instant: number, timeZone: string, cache: FormatterCache): string => {
  const parts = wallClockParts(instant, timeZone, cache);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
};

const offsetMinutesAtInstant = (instant: number, timeZone: string, cache: FormatterCache): number => {
  const parts = wallClockParts(instant, timeZone, cache);
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((localAsUtc - Math.trunc(instant / 1_000) * 1_000) / MILLISECONDS_PER_MINUTE);
};

/** Nonexistent wall times return null; repeated wall times choose the earlier occurrence. */
function zonedWallClockInstant(
  date: string,
  minuteFromMidnight: number,
  timeZone: string,
  cache: FormatterCache,
): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(date);
  if (!match || !Number.isInteger(minuteFromMidnight) || minuteFromMidnight < 0 || minuteFromMidnight >= 1_440) {
    return null;
  }
  const desired: WallClockParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Math.floor(minuteFromMidnight / 60),
    minute: minuteFromMidnight % 60,
    second: 0,
  };
  const wallClockUtc = Date.UTC(desired.year, desired.month - 1, desired.day, desired.hour, desired.minute);
  const possibleOffsets = new Set<number>();
  for (const sampleHours of [-36, -24, -12, -6, 0, 6, 12, 24, 36]) {
    possibleOffsets.add(offsetMinutesAtInstant(
      wallClockUtc + sampleHours * 60 * MILLISECONDS_PER_MINUTE,
      timeZone,
      cache,
    ));
  }
  const candidates = [...possibleOffsets]
    .map(offset => wallClockUtc - offset * MILLISECONDS_PER_MINUTE)
    .filter(instant => {
      const actual = wallClockParts(instant, timeZone, cache);
      return actual.year === desired.year && actual.month === desired.month && actual.day === desired.day &&
        actual.hour === desired.hour && actual.minute === desired.minute;
    })
    .sort((left, right) => left - right);
  return candidates[0] ?? null;
}

const minutesFromMidnight = (value: string): number =>
  Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));

const addCalendarDays = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00.000Z`) + days * MILLISECONDS_PER_DAY).toISOString().slice(0, 10);

const nextCalendarMonth = (month: string): string => {
  const date = new Date(`${month}T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString().slice(0, 10);
};

const initials = (displayName: string): string => {
  const words = displayName.trim().split(/[\s-]+/u).filter(Boolean);
  const chosen = words.length > 1 ? [words[0], words.at(-1)] : [words[0]];
  const result = chosen.flatMap(word => word ? Array.from(word)[0] ?? [] : []).join("").toLocaleUpperCase("en-US");
  return result || "T";
};

const normalizedPublicBaseUrl = (value: string): URL => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PublicBookingReadError(503, "public_booking_unconfigured", "Public booking is not configured.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new PublicBookingReadError(503, "public_booking_unconfigured", "Public booking is not configured.");
  }
  return url;
};

export function projectPublicBookingProfile(
  resolved: ResolvedPublishedPublicBookingProfile,
  options: { readonly baseUrl: string },
): ProjectedPublicBookingProfile {
  const base = normalizedPublicBaseUrl(options.baseUrl);
  const profilePath = `/${encodeURIComponent(resolved.profileSlug)}`;
  return {
    schemaVersion: PUBLIC_PROFILE_SCHEMA_VERSION,
    canonicalUrl: new URL(profilePath, base).toString(),
    profile: {
      displayName: resolved.displayName,
      initials: initials(resolved.displayName),
    },
    eventTypes: resolved.eventTypes.map(eventType => {
      const snapshot = eventType.publicSnapshot;
      return {
        eventTypeSlug: eventType.eventTypeSlug,
        canonicalUrl: new URL(
          `${profilePath}/${encodeURIComponent(eventType.eventTypeSlug)}`,
          base,
        ).toString(),
        title: snapshot.title,
        ...(snapshot.description ? { description: snapshot.description } : {}),
        durationMinutes: snapshot.durationMinutes,
        location: snapshot.location,
        locationLabel: snapshot.locationLabel,
        approvalRequired: snapshot.approvalRequired,
      };
    }),
  };
}

export function projectPublicBookingPage(
  resolved: ResolvedPublishedPublicBookingPage,
  options: {
    readonly baseUrl: string;
    readonly turnstileSiteKey: string;
    readonly now: number;
  },
): ProjectedPublicBookingPage {
  if (!Number.isFinite(options.now) || !validIdentifier(options.turnstileSiteKey, 2_048)) {
    throw new PublicBookingReadError(503, "public_booking_unconfigured", "Public booking is not configured.");
  }
  const cache: FormatterCache = new Map();
  const today = calendarDateInTimeZone(options.now, resolved.privateSnapshot.schedule.timeZone, cache);
  const base = normalizedPublicBaseUrl(options.baseUrl);
  const canonicalUrl = new URL(
    `/${encodeURIComponent(resolved.profileSlug)}/${encodeURIComponent(resolved.eventTypeSlug)}`,
    base,
  ).toString();
  const snapshot = resolved.publicSnapshot;
  return {
    schemaVersion: PUBLIC_PAGE_SCHEMA_VERSION,
    pageRevision: resolved.revisionId,
    canonicalUrl,
    profile: { displayName: snapshot.displayName, initials: initials(snapshot.displayName) },
    eventType: {
      title: snapshot.title,
      ...(snapshot.description ? { description: snapshot.description } : {}),
      durationMinutes: snapshot.durationMinutes,
      location: snapshot.location,
      locationLabel: snapshot.locationLabel,
      approvalRequired: snapshot.approvalRequired,
    },
    bookingWindow: {
      firstDate: today,
      lastDate: addCalendarDays(today, resolved.privateSnapshot.schedule.bookingHorizonDays - 1),
    },
    turnstile: { siteKey: options.turnstileSiteKey },
  };
}

function candidateHostDateRange(
  snapshot: PrivatePageSnapshot,
  query: PublicAvailabilityQuery,
  now: number,
  cache: FormatterCache,
): { readonly first: string; readonly last: string } | null {
  const viewerMonthStart = zonedWallClockInstant(query.month, 0, query.timeZone, cache);
  const viewerMonthEnd = zonedWallClockInstant(nextCalendarMonth(query.month), 0, query.timeZone, cache);
  if (viewerMonthStart === null || viewerMonthEnd === null) return null;
  const today = calendarDateInTimeZone(now, snapshot.schedule.timeZone, cache);
  const horizonLast = addCalendarDays(today, snapshot.schedule.bookingHorizonDays - 1);
  // The widest current IANA-zone separation is under two calendar days. The
  // padding also covers a travel override whose wall-clock zone differs from
  // both the schedule and viewer zones.
  const firstPossible = calendarDateInTimeZone(
    viewerMonthStart - 2 * MILLISECONDS_PER_DAY,
    snapshot.schedule.timeZone,
    cache,
  );
  const lastPossible = calendarDateInTimeZone(
    viewerMonthEnd + 2 * MILLISECONDS_PER_DAY,
    snapshot.schedule.timeZone,
    cache,
  );
  const first = firstPossible > today ? firstPossible : today;
  const last = lastPossible < horizonLast ? lastPossible : horizonLast;
  return first <= last ? { first, last } : null;
}

function windowsForHostDate(
  schedule: PublicAvailabilityScheduleSnapshot,
  hostDate: string,
): { readonly timeZone: string; readonly windows: readonly PublicationAvailabilityWindow[] } {
  const override = schedule.overrides.find(candidate => candidate.date === hostDate);
  if (override) {
    return {
      timeZone: override.timeZone,
      windows: override.available && override.start && override.end
        ? [{ day: new Date(`${hostDate}T00:00:00.000Z`).getUTCDay(), enabled: true, start: override.start, end: override.end }]
        : [],
    };
  }
  const day = new Date(`${hostDate}T00:00:00.000Z`).getUTCDay();
  return {
    timeZone: schedule.timeZone,
    windows: schedule.windows.filter(window => window.day === day && window.enabled),
  };
}

function checkedBusyIntervals(busyIntervals: readonly PublicBusyInterval[]): readonly { start: number; end: number }[] {
  const checked = busyIntervals.map(interval => {
    const start = Date.parse(interval.start);
    const end = Date.parse(interval.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      throw new PublicBookingReadError(502, "availability_source_invalid", "Availability could not be verified.");
    }
    return { start, end };
  }).sort((left, right) => left.start - right.start || left.end - right.end);
  const coalesced: { start: number; end: number }[] = [];
  for (const interval of checked) {
    const prior = coalesced.at(-1);
    if (prior && interval.start <= prior.end) {
      prior.end = Math.max(prior.end, interval.end);
    } else {
      coalesced.push({ ...interval });
    }
  }
  return coalesced;
}

const overlapsBusy = (
  busy: readonly { readonly start: number; readonly end: number }[],
  start: number,
  end: number,
): boolean => {
  let low = 0;
  let high = busy.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (busy[middle]!.end <= start) low = middle + 1;
    else high = middle;
  }
  const candidate = busy[low];
  return Boolean(candidate && candidate.start < end);
};

function generateCandidates(
  resolved: ResolvedPublishedPublicBookingPage,
  query: PublicAvailabilityQuery,
  busyIntervals: readonly PublicBusyInterval[],
  now: number,
): readonly GroupedPublicAvailabilityCandidates[] {
  if (!Number.isFinite(now)) {
    throw new PublicBookingReadError(503, "public_booking_unconfigured", "Public booking is not configured.");
  }
  if (query.pageRevision !== resolved.revisionId) {
    throw new PublicBookingReadError(
      409,
      "public_page_changed",
      "This booking page changed. Reload it before choosing a time.",
    );
  }
  const cache: FormatterCache = new Map();
  const range = candidateHostDateRange(resolved.privateSnapshot, query, now, cache);
  if (!range) return [];
  const busy = checkedBusyIntervals(busyIntervals);
  const schedule = resolved.privateSnapshot.schedule;
  const preferredStart = minutesFromMidnight(schedule.preferredStart);
  const preferredEnd = minutesFromMidnight(schedule.preferredEnd);
  const earliestStart = now + schedule.minimumNoticeMinutes * MILLISECONDS_PER_MINUTE;
  const viewerMonthEnd = nextCalendarMonth(query.month);
  const grouped = new Map<string, Map<string, RankedPublicAvailabilityCandidate>>();
  for (let hostDate = range.first; hostDate <= range.last; hostDate = addCalendarDays(hostDate, 1)) {
    const availability = windowsForHostDate(schedule, hostDate);
    for (const window of availability.windows) {
      const windowStart = minutesFromMidnight(window.start);
      const windowEndMinute = minutesFromMidnight(window.end);
      const windowEnd = zonedWallClockInstant(hostDate, windowEndMinute, availability.timeZone, cache);
      if (windowEnd === null) continue;
      for (
        let minute = windowStart;
        minute + resolved.publicSnapshot.durationMinutes <= windowEndMinute;
        minute += SLOT_INTERVAL_MINUTES
      ) {
        const start = zonedWallClockInstant(hostDate, minute, availability.timeZone, cache);
        if (start === null || start < earliestStart) continue;
        const end = start + resolved.publicSnapshot.durationMinutes * MILLISECONDS_PER_MINUTE;
        if (end > windowEnd) continue;
        // Avoid displaying an elapsed-duration slot whose local end clock moves
        // across a DST transition (especially backward through a repeated hour).
        if (
          offsetMinutesAtInstant(start, availability.timeZone, cache) !==
          offsetMinutesAtInstant(end, availability.timeZone, cache)
        ) continue;
        const bufferedStart = start - schedule.bufferBeforeMinutes * MILLISECONDS_PER_MINUTE;
        const bufferedEnd = end + schedule.bufferAfterMinutes * MILLISECONDS_PER_MINUTE;
        if (overlapsBusy(busy, bufferedStart, bufferedEnd)) continue;
        const viewerDate = calendarDateInTimeZone(start, query.timeZone, cache);
        if (viewerDate < query.month || viewerDate >= viewerMonthEnd) continue;
        const slots = grouped.get(viewerDate) ?? new Map<string, RankedPublicAvailabilityCandidate>();
        const candidate = {
          start: new Date(start).toISOString(),
          end: new Date(end).toISOString(),
          preferred: minute >= preferredStart && minute < preferredEnd,
        };
        slots.set(`${candidate.start}\u0000${candidate.end}`, candidate);
        grouped.set(viewerDate, slots);
      }
    }
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, slots]) => ({
      date,
      slots: [...slots.values()]
        .sort((left, right) =>
          Number(right.preferred) - Number(left.preferred) ||
          left.start.localeCompare(right.start) ||
          left.end.localeCompare(right.end)
        )
        .map(({ start, end }) => ({ start, end })),
    }));
}

/** Pure, provider-agnostic slot generation from one immutable page revision. */
export function generatePublicAvailabilityCandidates(options: {
  readonly resolved: ResolvedPublishedPublicBookingPage;
  readonly query: PublicAvailabilityQuery;
  readonly busyIntervals: readonly PublicBusyInterval[];
  readonly now: number;
}): readonly GroupedPublicAvailabilityCandidates[] {
  return generateCandidates(options.resolved, options.query, options.busyIntervals, options.now);
}

/**
 * Revalidates one exact signed slot against the commit-time policy of the
 * immutable published revision. Provider conflicts are checked separately.
 *
 * This deliberately delegates to the same candidate generator used by the
 * public availability response. That keeps minimum notice, host-calendar
 * horizon, weekly windows, date overrides (including travel time zones), DST,
 * duration, and slot alignment identical at display and commit time.
 */
export function publicSlotSatisfiesPublishedSchedule(options: {
  readonly resolved: ResolvedPublishedPublicBookingPage;
  readonly start: string;
  readonly end: string;
  readonly now: number;
}): boolean {
  const start = Date.parse(options.start);
  const end = Date.parse(options.end);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start ||
    new Date(start).toISOString() !== options.start ||
    new Date(end).toISOString() !== options.end
  ) return false;

  const utcDate = new Date(start).toISOString().slice(0, 10);
  const query: PublicAvailabilityQuery = {
    month: `${utcDate.slice(0, 7)}-01`,
    timeZone: "UTC",
    pageRevision: options.resolved.revisionId,
  };
  return generateCandidates(options.resolved, query, [], options.now)
    .some(group => group.slots.some(slot =>
      slot.start === options.start && slot.end === options.end
    ));
}

/** Exact provider interval needed to check every candidate, including buffers. */
export function availabilityQueryWindow(
  resolved: ResolvedPublishedPublicBookingPage,
  query: PublicAvailabilityQuery,
  now: number,
): PublicAvailabilityQueryWindow | null {
  const candidates = generateCandidates(resolved, query, [], now)
    .flatMap(group => group.slots);
  if (candidates.length === 0) return null;
  const before = resolved.privateSnapshot.schedule.bufferBeforeMinutes * MILLISECONDS_PER_MINUTE;
  const after = resolved.privateSnapshot.schedule.bufferAfterMinutes * MILLISECONDS_PER_MINUTE;
  const timeMin = Math.min(...candidates.map(candidate => Date.parse(candidate.start) - before));
  const timeMax = Math.max(...candidates.map(candidate => Date.parse(candidate.end) + after));
  return { timeMin: new Date(timeMin).toISOString(), timeMax: new Date(timeMax).toISOString() };
}

const base64UrlEncode = (bytes: Uint8Array | ArrayBuffer): string => {
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of array) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
};

const base64UrlDecode = (value: string): Uint8Array | null => {
  if (!BASE64_URL_PATTERN.test(value) || value.length % 4 === 1) return null;
  try {
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4);
    const binary = atob(base64);
    const result = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) result[index] = binary.charCodeAt(index);
    return base64UrlEncode(result) === value ? result : null;
  } catch {
    return null;
  }
};

const signingKeyBytes = (secret: string): Uint8Array => {
  const bytes = new TextEncoder().encode(secret);
  if (bytes.byteLength < MIN_SIGNING_KEY_BYTES || bytes.byteLength > MAX_SIGNING_KEY_BYTES) {
    throw new PublicBookingReadError(503, "public_booking_unconfigured", "Public booking is not configured.");
  }
  return bytes;
};

export const preparePublicSlotSigningKey = (secret: string): Promise<CryptoKey> =>
  crypto.subtle.importKey(
    "raw",
    signingKeyBytes(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );

const validateSlotClaims = (value: unknown): PublicSlotTokenClaims => {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["v", "revisionId", "start", "end", "iat", "exp"]) ||
    value.v !== 1 ||
    typeof value.revisionId !== "string" ||
    !REVISION_PATTERN.test(value.revisionId) ||
    !validInstant(value.start) ||
    !validInstant(value.end) ||
    Date.parse(value.end) <= Date.parse(value.start) ||
    !validInteger(value.iat, 0, Number.MAX_SAFE_INTEGER) ||
    !validInteger(value.exp, 0, Number.MAX_SAFE_INTEGER) ||
    value.exp <= value.iat ||
    value.exp - value.iat > MAX_SLOT_TOKEN_TTL_SECONDS
  ) {
    throw new PublicBookingReadError(400, "slot_token_invalid", "This selected time is invalid. Choose it again.");
  }
  return {
    v: 1,
    revisionId: value.revisionId,
    start: value.start,
    end: value.end,
    iat: value.iat,
    exp: value.exp,
  };
};

export async function signPublicSlotToken(
  secret: string,
  claims: PublicSlotTokenClaims,
): Promise<string> {
  return signPublicSlotTokenWithKey(await preparePublicSlotSigningKey(secret), claims);
}

const signPublicSlotTokenWithKey = async (
  key: CryptoKey,
  claims: PublicSlotTokenClaims,
): Promise<string> => {
  const validated = validateSlotClaims(claims);
  const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(validated)));
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return `${payload}.${base64UrlEncode(signature)}`;
};

export async function verifyPublicSlotToken(
  secret: string,
  token: string,
  options: { readonly now: number },
): Promise<PublicSlotTokenClaims> {
  const parts = token.split(".");
  if (token.length > MAX_TOKEN_LENGTH || parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new PublicBookingReadError(400, "slot_token_invalid", "This selected time is invalid. Choose it again.");
  }
  const payloadBytes = base64UrlDecode(parts[0]);
  const signature = base64UrlDecode(parts[1]);
  if (!payloadBytes || !signature || signature.byteLength !== 32 || payloadBytes.byteLength > 2_048) {
    throw new PublicBookingReadError(400, "slot_token_invalid", "This selected time is invalid. Choose it again.");
  }
  const validSignature = await crypto.subtle.verify(
    "HMAC",
    await preparePublicSlotSigningKey(secret),
    signature as BufferSource,
    new TextEncoder().encode(parts[0]),
  );
  if (!validSignature) {
    throw new PublicBookingReadError(400, "slot_token_invalid", "This selected time is invalid. Choose it again.");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(payloadBytes)) as unknown;
  } catch {
    throw new PublicBookingReadError(400, "slot_token_invalid", "This selected time is invalid. Choose it again.");
  }
  const claims = validateSlotClaims(decoded);
  if (!Number.isFinite(options.now)) {
    throw new PublicBookingReadError(503, "public_booking_unconfigured", "Public booking is not configured.");
  }
  const nowSeconds = Math.floor(options.now / 1_000);
  if (claims.exp <= nowSeconds) {
    throw new PublicBookingReadError(409, "slot_token_expired", "This selected time expired. Choose it again.");
  }
  if (claims.iat > nowSeconds + 60) {
    throw new PublicBookingReadError(400, "slot_token_invalid", "This selected time is invalid. Choose it again.");
  }
  return claims;
}

export async function buildPublicAvailability(
  resolved: ResolvedPublishedPublicBookingPage,
  query: PublicAvailabilityQuery,
  busyIntervals: readonly PublicBusyInterval[],
  signingKey: string | CryptoKey,
  now: number,
): Promise<PublicBookingAvailability> {
  const grouped = generatePublicAvailabilityCandidates({ resolved, query, busyIntervals, now });
  const preparedSigningKey = typeof signingKey === "string"
    ? await preparePublicSlotSigningKey(signingKey)
    : signingKey;
  const issuedAt = Math.floor(now / 1_000);
  const expiresAt = issuedAt + SLOT_TOKEN_TTL_SECONDS;
  const dates = await Promise.all(grouped.map(async group => ({
    date: group.date,
    slots: await Promise.all(group.slots.map(async slot => ({
      ...slot,
      token: await signPublicSlotTokenWithKey(preparedSigningKey, {
        v: 1,
        revisionId: resolved.revisionId,
        start: slot.start,
        end: slot.end,
        iat: issuedAt,
        exp: expiresAt,
      }),
    }))),
  })));
  return {
    schemaVersion: PUBLIC_AVAILABILITY_SCHEMA_VERSION,
    pageRevision: resolved.revisionId,
    viewerTimeZone: query.timeZone,
    month: query.month,
    generatedAt: new Date(now).toISOString(),
    expiresAt: new Date(expiresAt * 1_000).toISOString(),
    dates,
  };
}
