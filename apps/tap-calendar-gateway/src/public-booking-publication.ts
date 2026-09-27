import type { CollectiveHost } from "./collective-types";

const PUBLICATION_SCHEMA_VERSION = "tap.calendar.publication.v1" as const;
const PROFILE_PUBLICATION_SCHEMA_VERSION = "tap.calendar.profile-publication.v1" as const;
const PROFILE_UNPUBLICATION_SCHEMA_VERSION = "tap.calendar.profile-unpublication.v1" as const;
const PUBLIC_PAGE_SNAPSHOT_SCHEMA_VERSION = "tap.calendar.public-page-snapshot.v1" as const;
const PRIVATE_PAGE_SNAPSHOT_SCHEMA_VERSION = "tap.calendar.private-page-snapshot.v1" as const;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const CLOCK_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const MAX_CONFLICT_CALENDARS = 50;
const MAX_WINDOWS = 28;
const MAX_OVERRIDES = 366;
const MAX_PAGES_PER_PROFILE = 50;
const MAX_PROFILES_PER_OWNER = 20;
const MAX_PUBLIC_SNAPSHOT_BYTES = 32_768;
const MAX_PRIVATE_SNAPSHOT_BYTES = 131_072;
const RESERVED_PROFILE_SLUGS = new Set([
  "admin",
  "api",
  "assets",
  "auth",
  "callback",
  "favicon",
  "health",
  "manage",
  "oauth",
  "privacy",
  "robots",
  "sitemap",
  "static",
  "support",
  "www",
]);

export interface PublicBookingOwnerScope {
  readonly workspace: string;
  readonly principal: string;
  /** Only the authenticated workspace-management route may set this. */
  readonly ownerKind?: "workspace";
}

export interface PublicationAvailabilityWindow {
  readonly day: number;
  readonly enabled: boolean;
  readonly start: string;
  readonly end: string;
}

export interface PublicationAvailabilityOverride {
  readonly date: string;
  readonly label: string;
  readonly available: boolean;
  readonly timeZone: string;
  readonly start?: string;
  readonly end?: string;
}

export interface PublicBookingPublicationInput {
  /** Resolved from enrolled hosts by the gateway, never parsed from public input. */
  readonly collectiveHosts?: readonly CollectiveHost[];
  readonly schemaVersion: typeof PUBLICATION_SCHEMA_VERSION;
  readonly sourceProfileId: string;
  readonly profileSlug: string;
  readonly displayName: string;
  readonly ownerType: "individual";
  readonly sourceEventTypeId: string;
  readonly eventTypeSlug: string;
  readonly title: string;
  readonly description: string;
  readonly durationMinutes: number;
  readonly approvalRequired: boolean;
  readonly location: string;
  readonly destinationCalendarId: string;
  readonly conflictCalendarIds: readonly string[];
  readonly sourceAvailabilityScheduleId: string;
  readonly schedule: {
    readonly timeZone: string;
    readonly preferredStart: string;
    readonly preferredEnd: string;
    readonly bufferBeforeMinutes: number;
    readonly bufferAfterMinutes: number;
    readonly minimumNoticeMinutes: number;
    readonly bookingHorizonDays: number;
    readonly windows: readonly PublicationAvailabilityWindow[];
    readonly overrides: readonly PublicationAvailabilityOverride[];
  };
}

export interface PublicBookingProfilePublicationInput {
  readonly schemaVersion: typeof PROFILE_PUBLICATION_SCHEMA_VERSION;
  readonly sourceProfileId: string;
  readonly profileSlug: string;
  readonly displayName: string;
  readonly ownerType: "individual";
  readonly expectedGeneration: number;
  readonly publications: readonly PublicBookingPublicationInput[];
}

export interface PublicBookingProfileUnpublicationInput {
  readonly schemaVersion: typeof PROFILE_UNPUBLICATION_SCHEMA_VERSION;
  readonly sourceProfileId: string;
  readonly expectedGeneration: number;
}

export interface PublishedBookingPageRecord {
  readonly profileId: string;
  readonly pageId: string;
  readonly revisionId: string;
  readonly sourceEventTypeId: string;
  readonly profileSlug: string;
  readonly eventTypeSlug: string;
  readonly canonicalUrl: string;
  readonly publishedAt: string;
}

export interface PublishedBookingProfileRecord {
  readonly profileId: string;
  readonly sourceProfileId: string;
  readonly profileSlug: string;
  readonly generation: number;
  readonly publishedAt: string;
  readonly idempotentReplay: boolean;
  readonly pages: readonly PublishedBookingPageRecord[];
}

export interface UnpublishedBookingProfileRecord {
  readonly profileId: string;
  readonly sourceProfileId: string;
  readonly generation: number;
  readonly unpublishedAt: string;
  readonly idempotentReplay: boolean;
}

interface ProfileRow {
  readonly id: string;
  readonly current_slug: string;
  readonly source_profile_id: string;
  readonly display_name: string;
  readonly status: "draft" | "published" | "unpublished";
  readonly publication_generation: number;
  readonly published_at: string | null;
  readonly updated_at: string;
}

interface SlugOwnerRow {
  readonly profile_id: string;
}

interface PageRow {
  readonly id: string;
  readonly current_slug: string;
  readonly source_event_type_id: string;
  readonly current_revision_id: string | null;
  readonly current_snapshot_hash: string | null;
  readonly status: "draft" | "published" | "paused" | "unpublished";
  readonly published_at: string | null;
}

interface PageSlugOwnerRow {
  readonly page_id: string;
}

interface RevisionRow {
  readonly id: string;
}

interface OwnedCalendarRow {
  readonly id: string;
  readonly provider: string;
  readonly mode: string;
  readonly role: string;
  readonly writable: number;
  readonly status: string;
}

export class PublicBookingPublicationError extends Error {
  readonly status: number;
  readonly code: string;
  readonly currentGeneration: number | undefined;

  constructor(status: number, code: string, message: string, currentGeneration?: number) {
    super(message);
    this.name = "PublicBookingPublicationError";
    this.status = status;
    this.code = code;
    this.currentGeneration = currentGeneration;
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: unknown, field: string, maximum = 255): string {
  if (typeof value !== "string") {
    throw new PublicBookingPublicationError(400, "invalid_publication", `${field} is required.`);
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximum) {
    throw new PublicBookingPublicationError(400, "invalid_publication", `${field} is invalid.`);
  }
  return normalized;
}

function optionalString(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string") {
    throw new PublicBookingPublicationError(400, "invalid_publication", `${field} must be text.`);
  }
  const normalized = value.trim();
  if (normalized.length > maximum) {
    throw new PublicBookingPublicationError(400, "invalid_publication", `${field} is too long.`);
  }
  return normalized;
}

function integerInRange(value: unknown, field: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new PublicBookingPublicationError(
      400,
      "invalid_publication",
      `${field} must be a whole number between ${minimum} and ${maximum}.`,
    );
  }
  return Number(value);
}

function slug(value: unknown, field: string): string {
  const normalized = requiredString(value, field, 64);
  if (normalized.length < 2 || !SLUG_PATTERN.test(normalized)) {
    throw new PublicBookingPublicationError(
      400,
      "invalid_slug",
      `${field} must use 2–64 lowercase letters, numbers, and single hyphens.`,
    );
  }
  return normalized;
}

function clockTime(value: unknown, field: string): string {
  const normalized = requiredString(value, field, 5);
  if (!CLOCK_TIME_PATTERN.test(normalized)) {
    throw new PublicBookingPublicationError(400, "invalid_publication", `${field} must use HH:MM.`);
  }
  return normalized;
}

function calendarDate(value: unknown, field: string): string {
  const normalized = requiredString(value, field, 10);
  const parsed = Date.parse(`${normalized}T00:00:00.000Z`);
  if (
    !CALENDAR_DATE_PATTERN.test(normalized) ||
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString().slice(0, 10) !== normalized
  ) {
    throw new PublicBookingPublicationError(400, "invalid_publication", `${field} must use YYYY-MM-DD.`);
  }
  return normalized;
}

function timeZone(value: unknown, field: string): string {
  const normalized = requiredString(value, field, 255);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: normalized }).format(0);
  } catch {
    throw new PublicBookingPublicationError(400, "invalid_time_zone", `${field} is not a supported IANA time zone.`);
  }
  return normalized;
}

function minutes(clock: string): number {
  return Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
}

function parseWindows(value: unknown): readonly PublicationAvailabilityWindow[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_WINDOWS) {
    throw new PublicBookingPublicationError(400, "invalid_publication", `schedule.windows must contain 1–${MAX_WINDOWS} ranges.`);
  }
  const byDay = new Map<number, PublicationAvailabilityWindow[]>();
  const result = value.map((candidate, index) => {
    if (!isRecord(candidate)) {
      throw new PublicBookingPublicationError(400, "invalid_publication", `schedule.windows[${index}] is invalid.`);
    }
    const day = integerInRange(candidate.day, `schedule.windows[${index}].day`, 0, 6);
    if (typeof candidate.enabled !== "boolean") {
      throw new PublicBookingPublicationError(400, "invalid_publication", `schedule.windows[${index}].enabled is required.`);
    }
    const start = clockTime(candidate.start, `schedule.windows[${index}].start`);
    const end = clockTime(candidate.end, `schedule.windows[${index}].end`);
    if (minutes(end) - minutes(start) < 5) {
      throw new PublicBookingPublicationError(400, "invalid_publication", "Availability ranges must last at least 5 minutes and end after they start.");
    }
    const window = { day, enabled: candidate.enabled, start, end };
    const daily = byDay.get(day) ?? [];
    daily.push(window);
    byDay.set(day, daily);
    return window;
  });
  for (const daily of byDay.values()) {
    if (daily.some(window => window.enabled !== daily[0]?.enabled)) {
      throw new PublicBookingPublicationError(400, "invalid_publication", "Every range on a weekday must share its enabled state.");
    }
    const ordered = [...daily].sort((left, right) => left.start.localeCompare(right.start));
    for (let index = 1; index < ordered.length; index += 1) {
      if (ordered[index]!.start < ordered[index - 1]!.end) {
        throw new PublicBookingPublicationError(400, "invalid_publication", "Availability ranges on one day cannot overlap.");
      }
    }
  }
  return [...result].sort((left, right) => left.day - right.day || left.start.localeCompare(right.start));
}

function parseOverrides(value: unknown, inheritedTimeZone: string): readonly PublicationAvailabilityOverride[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_OVERRIDES) {
    throw new PublicBookingPublicationError(400, "invalid_publication", `schedule.overrides may contain at most ${MAX_OVERRIDES} dates.`);
  }
  const dates = new Set<string>();
  return value.map((candidate, index) => {
    if (!isRecord(candidate)) {
      throw new PublicBookingPublicationError(400, "invalid_publication", `schedule.overrides[${index}] is invalid.`);
    }
    const date = calendarDate(candidate.date, `schedule.overrides[${index}].date`);
    if (dates.has(date)) {
      throw new PublicBookingPublicationError(400, "invalid_publication", "Availability override dates must be unique.");
    }
    dates.add(date);
    if (typeof candidate.available !== "boolean") {
      throw new PublicBookingPublicationError(400, "invalid_publication", `schedule.overrides[${index}].available is required.`);
    }
    const label = requiredString(candidate.label, `schedule.overrides[${index}].label`, 160);
    const overrideTimeZone = candidate.timeZone === undefined
      ? inheritedTimeZone
      : timeZone(candidate.timeZone, `schedule.overrides[${index}].timeZone`);
    if (!candidate.available) return { date, label, available: false, timeZone: overrideTimeZone };
    const start = clockTime(candidate.start, `schedule.overrides[${index}].start`);
    const end = clockTime(candidate.end, `schedule.overrides[${index}].end`);
    if (minutes(end) - minutes(start) < 5) {
      throw new PublicBookingPublicationError(400, "invalid_publication", "Available overrides must last at least 5 minutes and end after they start.");
    }
    return { date, label, available: true, timeZone: overrideTimeZone, start, end };
  }).sort((left, right) => left.date.localeCompare(right.date));
}

function parseUniqueIdentifiers(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || value.length > MAX_CONFLICT_CALENDARS) {
    throw new PublicBookingPublicationError(400, "invalid_publication", `${field} may contain at most ${MAX_CONFLICT_CALENDARS} calendars.`);
  }
  const identifiers = value.map((candidate, index) => requiredString(candidate, `${field}[${index}]`, 255));
  if (new Set(identifiers).size !== identifiers.length) {
    throw new PublicBookingPublicationError(400, "invalid_publication", `${field} must not contain duplicates.`);
  }
  return [...identifiers].sort();
}

export function parsePublicBookingPublication(value: unknown): PublicBookingPublicationInput {
  if (!isRecord(value) || value.schemaVersion !== PUBLICATION_SCHEMA_VERSION) {
    throw new PublicBookingPublicationError(400, "invalid_publication", `schemaVersion must be ${PUBLICATION_SCHEMA_VERSION}.`);
  }
  if (value.ownerType !== "individual") {
    throw new PublicBookingPublicationError(400, "unsupported_owner_type", "Public booking v1 supports individual owners only.");
  }
  if (!isRecord(value.schedule)) {
    throw new PublicBookingPublicationError(400, "invalid_publication", "schedule is required.");
  }
  const scheduleTimeZone = timeZone(value.schedule.timeZone, "schedule.timeZone");
  const preferredStart = clockTime(value.schedule.preferredStart, "schedule.preferredStart");
  const preferredEnd = clockTime(value.schedule.preferredEnd, "schedule.preferredEnd");
  if (minutes(preferredStart) >= minutes(preferredEnd)) {
    throw new PublicBookingPublicationError(400, "invalid_publication", "Preferred start must be earlier than preferred end.");
  }
  return {
    schemaVersion: PUBLICATION_SCHEMA_VERSION,
    sourceProfileId: requiredString(value.sourceProfileId, "sourceProfileId"),
    profileSlug: slug(value.profileSlug, "profileSlug"),
    displayName: requiredString(value.displayName, "displayName", 160),
    ownerType: "individual",
    sourceEventTypeId: requiredString(value.sourceEventTypeId, "sourceEventTypeId"),
    eventTypeSlug: slug(value.eventTypeSlug, "eventTypeSlug"),
    title: requiredString(value.title, "title", 160),
    description: optionalString(value.description, "description", 2000),
    durationMinutes: integerInRange(value.durationMinutes, "durationMinutes", 5, 1440),
    approvalRequired: (() => {
      if (typeof value.approvalRequired !== "boolean") {
        throw new PublicBookingPublicationError(400, "invalid_publication", "approvalRequired is required.");
      }
      return value.approvalRequired;
    })(),
    location: requiredString(value.location, "location", 64),
    destinationCalendarId: requiredString(value.destinationCalendarId, "destinationCalendarId"),
    conflictCalendarIds: parseUniqueIdentifiers(value.conflictCalendarIds, "conflictCalendarIds"),
    sourceAvailabilityScheduleId: requiredString(value.sourceAvailabilityScheduleId, "sourceAvailabilityScheduleId"),
    schedule: {
      timeZone: scheduleTimeZone,
      preferredStart,
      preferredEnd,
      bufferBeforeMinutes: integerInRange(value.schedule.bufferBeforeMinutes, "schedule.bufferBeforeMinutes", 0, 1440),
      bufferAfterMinutes: integerInRange(value.schedule.bufferAfterMinutes, "schedule.bufferAfterMinutes", 0, 1440),
      minimumNoticeMinutes: integerInRange(value.schedule.minimumNoticeMinutes, "schedule.minimumNoticeMinutes", 0, 10080),
      bookingHorizonDays: integerInRange(value.schedule.bookingHorizonDays, "schedule.bookingHorizonDays", 1, 365),
      windows: parseWindows(value.schedule.windows),
      overrides: parseOverrides(value.schedule.overrides, scheduleTimeZone),
    },
  };
}

function publicationGeneration(value: unknown, field: string): number {
  return integerInRange(value, field, 0, 2_147_483_647);
}

export function parsePublicBookingProfilePublication(
  value: unknown,
): PublicBookingProfilePublicationInput {
  if (!isRecord(value) || value.schemaVersion !== PROFILE_PUBLICATION_SCHEMA_VERSION) {
    throw new PublicBookingPublicationError(
      400,
      "invalid_publication",
      `schemaVersion must be ${PROFILE_PUBLICATION_SCHEMA_VERSION}.`,
    );
  }
  if (
    !Array.isArray(value.publications) ||
    value.publications.length > MAX_PAGES_PER_PROFILE
  ) {
    throw new PublicBookingPublicationError(
      400,
      "invalid_publication",
      `publications may contain at most ${MAX_PAGES_PER_PROFILE} active Event Types.`,
    );
  }
  const publications = value.publications.map(parsePublicBookingPublication);
  const first = publications[0];
  const sourceProfileId = value.sourceProfileId === undefined && first
    ? first.sourceProfileId
    : requiredString(value.sourceProfileId, "sourceProfileId");
  const profileSlug = value.profileSlug === undefined && first
    ? first.profileSlug
    : slug(value.profileSlug, "profileSlug");
  const displayName = value.displayName === undefined && first
    ? first.displayName
    : requiredString(value.displayName, "displayName", 160);
  const ownerType = value.ownerType === undefined && first
    ? first.ownerType
    : value.ownerType;
  if (ownerType !== "individual") {
    throw new PublicBookingPublicationError(
      400,
      "unsupported_owner_type",
      "Public booking v1 supports individual owners only.",
    );
  }
  if (
    publications.some(publication =>
      publication.sourceProfileId !== sourceProfileId ||
      publication.profileSlug !== profileSlug ||
      publication.displayName !== displayName ||
      publication.ownerType !== ownerType
    )
  ) {
    throw new PublicBookingPublicationError(
      400,
      "invalid_publication",
      "Every page in a profile publication must identify the same Booking Profile.",
    );
  }
  if (RESERVED_PROFILE_SLUGS.has(profileSlug)) {
    throw new PublicBookingPublicationError(
      409,
      "profile_slug_reserved",
      "That Booking Profile slug is reserved by TAP.",
    );
  }
  if (
    new Set(publications.map(publication => publication.sourceEventTypeId)).size !== publications.length ||
    new Set(publications.map(publication => publication.eventTypeSlug.toLowerCase())).size !== publications.length
  ) {
    throw new PublicBookingPublicationError(
      400,
      "invalid_publication",
      "Event Type IDs and slugs must be unique within a Booking Profile.",
    );
  }
  return {
    schemaVersion: PROFILE_PUBLICATION_SCHEMA_VERSION,
    sourceProfileId,
    profileSlug,
    displayName,
    ownerType,
    expectedGeneration: publicationGeneration(value.expectedGeneration, "expectedGeneration"),
    publications,
  };
}

export function parsePublicBookingProfileUnpublication(
  value: unknown,
): PublicBookingProfileUnpublicationInput {
  if (!isRecord(value) || value.schemaVersion !== PROFILE_UNPUBLICATION_SCHEMA_VERSION) {
    throw new PublicBookingPublicationError(
      400,
      "invalid_publication",
      `schemaVersion must be ${PROFILE_UNPUBLICATION_SCHEMA_VERSION}.`,
    );
  }
  return {
    schemaVersion: PROFILE_UNPUBLICATION_SCHEMA_VERSION,
    sourceProfileId: requiredString(value.sourceProfileId, "sourceProfileId"),
    expectedGeneration: publicationGeneration(value.expectedGeneration, "expectedGeneration"),
  };
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

async function snapshotHash(publicSnapshot: unknown, privateSnapshot: unknown): Promise<string> {
  const body = JSON.stringify([publicSnapshot, privateSnapshot]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  return base64Url(new Uint8Array(digest));
}

function identifier(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function publicLocation(location: string): { location: "google-meet" | "zoom" | "phone" | "in-person" | "custom"; label: string } {
  if (location === "google-meet") return { location: "google-meet", label: "Google Meet" };
  if (location === "zoom") return { location: "zoom", label: "Zoom" };
  if (location === "phone") return { location: "phone", label: "Phone call" };
  if (location === "physical") return { location: "in-person", label: "In person" };
  return { location: "custom", label: "Meeting details provided after booking" };
}

async function validateOwnedCalendars(
  database: D1Database,
  scope: PublicBookingOwnerScope,
  publication: PublicBookingPublicationInput,
): Promise<void> {
  const requested = Array.from(new Set([
    publication.destinationCalendarId,
    ...publication.conflictCalendarIds,
  ]));
  const placeholders = requested.map(() => "?").join(", ");
  const rows = await database.prepare(
    `SELECT provider_calendars.id, calendar_connections.provider,
            calendar_connections.mode, provider_calendars.role,
            provider_calendars.writable, calendar_connections.status
       FROM provider_calendars
       INNER JOIN calendar_connections
         ON calendar_connections.id = provider_calendars.connection_id
      WHERE calendar_connections.workspace_id = ?
        AND calendar_connections.principal_id = ?
        AND provider_calendars.id IN (${placeholders})`,
  ).bind(scope.workspace, scope.principal, ...requested).all<OwnedCalendarRow>();
  if (rows.results.length !== requested.length) {
    throw new PublicBookingPublicationError(403, "calendar_scope_denied", "One or more publication calendars do not belong to this TAP user.");
  }
  const destination = rows.results.find(row => row.id === publication.destinationCalendarId);
  if (
    !destination || destination.provider !== "google" ||
    destination.mode !== "oauth" || destination.role === "free-busy" ||
    destination.writable !== 1 || destination.status !== "connected"
  ) {
    throw new PublicBookingPublicationError(409, "destination_unavailable", "Public booking v1 requires a connected writable Google Destination Calendar.");
  }
  if (!publication.conflictCalendarIds.includes(publication.destinationCalendarId)) {
    throw new PublicBookingPublicationError(
      400,
      "destination_conflict_required",
      "The Destination Calendar must always be checked for public booking conflicts.",
    );
  }
  const conflicts = rows.results.filter(row =>
    publication.conflictCalendarIds.includes(row.id)
  );
  if (conflicts.some(row =>
    row.provider !== "google" || row.mode !== "oauth" || row.status !== "connected"
  )) {
    throw new PublicBookingPublicationError(
      409,
      "conflict_calendar_unavailable",
      "Public booking v1 requires every conflict calendar to use a connected Google OAuth account.",
    );
  }
}

interface PreparedPublication {
  readonly input: PublicBookingPublicationInput;
  readonly page: PageRow | null;
  readonly pageId: string;
  readonly revisionId: string;
  readonly existingRevision: boolean;
  readonly snapshotHash: string;
  readonly publicSnapshotJson: string;
  readonly privateSnapshotJson: string;
}

const snapshotByteLength = (value: string): number =>
  new TextEncoder().encode(value).byteLength;

function assertSnapshotSize(
  publicSnapshotJson: string,
  privateSnapshotJson: string,
): void {
  if (
    snapshotByteLength(publicSnapshotJson) > MAX_PUBLIC_SNAPSHOT_BYTES ||
    snapshotByteLength(privateSnapshotJson) > MAX_PRIVATE_SNAPSHOT_BYTES
  ) {
    throw new PublicBookingPublicationError(
      413,
      "publication_too_large",
      "This Booking Profile is too large to publish. Reduce its public copy or availability overrides.",
    );
  }
}

async function loadProfile(
  database: D1Database,
  scope: PublicBookingOwnerScope,
  sourceProfileId: string,
): Promise<ProfileRow | null> {
  return database.prepare(
    `SELECT id, source_profile_id, current_slug, display_name, status,
            publication_generation, published_at, updated_at
       FROM public_booking_profiles
      WHERE workspace_id = ? AND principal_id = ? AND source_profile_id = ?`,
  ).bind(scope.workspace, scope.principal, sourceProfileId).first<ProfileRow>();
}

async function loadPages(
  database: D1Database,
  profileId: string,
): Promise<readonly PageRow[]> {
  const rows = await database.prepare(
    `SELECT public_booking_pages.id,
            public_booking_pages.current_slug,
            public_booking_pages.source_event_type_id,
            public_booking_pages.current_revision_id,
            public_booking_page_revisions.snapshot_hash AS current_snapshot_hash,
            public_booking_pages.status,
            public_booking_pages.published_at
       FROM public_booking_pages
       LEFT JOIN public_booking_page_revisions
         ON public_booking_page_revisions.id = public_booking_pages.current_revision_id
      WHERE public_booking_pages.profile_id = ?`,
  ).bind(profileId).all<PageRow>();
  return rows.results;
}

function publicationSnapshots(
  scope: PublicBookingOwnerScope,
  input: PublicBookingPublicationInput,
): { readonly publicSnapshot: unknown; readonly privateSnapshot: unknown } {
  const location = publicLocation(input.location);
  return {
    publicSnapshot: {
      schemaVersion: PUBLIC_PAGE_SNAPSHOT_SCHEMA_VERSION,
      displayName: input.displayName,
      title: input.title,
      description: input.description,
      durationMinutes: input.durationMinutes,
      location: location.location,
      locationLabel: location.label,
      approvalRequired: input.approvalRequired,
    },
    privateSnapshot: {
      schemaVersion: PRIVATE_PAGE_SNAPSHOT_SCHEMA_VERSION,
      workspaceId: scope.workspace,
      principalId: input.collectiveHosts?.[0]?.principalId ?? scope.principal,
      destinationCalendarId: input.destinationCalendarId,
      conflictCalendarIds: input.conflictCalendarIds,
      sourceAvailabilityScheduleId: input.sourceAvailabilityScheduleId,
      location: input.location,
      schedule: input.schedule,
      ...(input.collectiveHosts ? { collectiveHosts: input.collectiveHosts } : {}),
    },
  };
}

function publicationConflict(
  currentGeneration?: number,
  message = "This Booking Profile changed in another TAP session. Refresh it and try again.",
): never {
  throw new PublicBookingPublicationError(
    409,
    "publication_conflict",
    message,
    currentGeneration,
  );
}

function batchConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /UNIQUE constraint failed.*public_booking_|public_booking_profile_generations|public_booking_owner_profile_slots/iu.test(message);
}

function publishedProfileRecord(options: {
  readonly profile: ProfileRow;
  readonly publications: readonly PreparedPublication[];
  readonly publicBaseUrl: string;
  readonly generation: number;
  readonly publishedAt: string;
  readonly idempotentReplay: boolean;
}): PublishedBookingProfileRecord {
  const base = options.publicBaseUrl.replace(/\/$/u, "");
  return {
    profileId: options.profile.id,
    sourceProfileId: options.profile.source_profile_id,
    profileSlug: options.profile.current_slug,
    generation: options.generation,
    publishedAt: options.publishedAt,
    idempotentReplay: options.idempotentReplay,
    pages: options.publications.map(prepared => ({
      profileId: options.profile.id,
      pageId: prepared.pageId,
      revisionId: prepared.revisionId,
      sourceEventTypeId: prepared.input.sourceEventTypeId,
      profileSlug: options.profile.current_slug,
      eventTypeSlug: prepared.input.eventTypeSlug,
      canonicalUrl: `${base}/${options.profile.current_slug}/${prepared.input.eventTypeSlug}`,
      publishedAt: prepared.page?.published_at ?? options.publishedAt,
    })),
  };
}

async function preparePublications(options: {
  readonly database: D1Database;
  readonly scope: PublicBookingOwnerScope;
  readonly profileId: string;
  readonly existingPages: readonly PageRow[];
  readonly inputs: readonly PublicBookingPublicationInput[];
}): Promise<readonly PreparedPublication[]> {
  const bySourceId = new Map(options.existingPages.map(page => [page.source_event_type_id, page]));
  const newPageCount = options.inputs.filter(input => !bySourceId.has(input.sourceEventTypeId)).length;
  if (options.existingPages.length + newPageCount > MAX_PAGES_PER_PROFILE) {
    throw new PublicBookingPublicationError(
      409,
      "publication_page_quota_exceeded",
      `A Booking Profile may reserve at most ${MAX_PAGES_PER_PROFILE} Event Type slugs.`,
    );
  }
  const result: PreparedPublication[] = [];
  for (const input of options.inputs) {
    if (input.collectiveHosts && options.scope.ownerKind !== "workspace") {
      throw new PublicBookingPublicationError(403, "workspace_management_required", "Shared publication requires workspace management authority.");
    }
    if (input.collectiveHosts) {
      for (const host of input.collectiveHosts) {
        await validateOwnedCalendars(options.database, { workspace: options.scope.workspace, principal: host.principalId },
          { ...input, destinationCalendarId: host.destinationCalendarId, conflictCalendarIds: host.conflictCalendarIds });
      }
    } else {
      await validateOwnedCalendars(options.database, options.scope, input);
    }
    const page = bySourceId.get(input.sourceEventTypeId) ?? null;
    if (page && page.current_slug !== input.eventTypeSlug) {
      throw new PublicBookingPublicationError(
        409,
        "event_type_slug_immutable",
        "Published Event Type slugs cannot be changed in public booking v1.",
      );
    }
    const slugOwner = await options.database.prepare(
      "SELECT page_id FROM public_booking_page_slugs WHERE profile_id = ? AND slug = ? COLLATE NOCASE",
    ).bind(options.profileId, input.eventTypeSlug).first<PageSlugOwnerRow>();
    if (slugOwner && slugOwner.page_id !== page?.id) {
      throw new PublicBookingPublicationError(
        409,
        "event_type_slug_unavailable",
        "That Event Type slug is already reserved in this Booking Profile.",
      );
    }
    const snapshots = publicationSnapshots(options.scope, input);
    const publicSnapshotJson = JSON.stringify(snapshots.publicSnapshot);
    const privateSnapshotJson = JSON.stringify(snapshots.privateSnapshot);
    assertSnapshotSize(publicSnapshotJson, privateSnapshotJson);
    const hash = await snapshotHash(snapshots.publicSnapshot, snapshots.privateSnapshot);
    const existingRevision = page
      ? await options.database.prepare(
        "SELECT id FROM public_booking_page_revisions WHERE page_id = ? AND snapshot_hash = ?",
      ).bind(page.id, hash).first<RevisionRow>()
      : null;
    result.push({
      input,
      page,
      pageId: page?.id ?? identifier("public-page"),
      revisionId: existingRevision?.id ?? identifier("public-revision"),
      existingRevision: Boolean(existingRevision),
      snapshotHash: hash,
      publicSnapshotJson,
      privateSnapshotJson,
    });
  }
  return result;
}

function profileAlreadyMatches(
  profile: ProfileRow,
  existingPages: readonly PageRow[],
  prepared: readonly PreparedPublication[],
  displayName: string,
): boolean {
  if (profile.status !== "published" || profile.display_name !== displayName) return false;
  const desiredByPage = new Map(prepared.map(item => [item.pageId, item]));
  return prepared.every(item =>
    item.page?.status === "published" &&
    item.page.current_snapshot_hash === item.snapshotHash
  ) && existingPages.every(page =>
    desiredByPage.has(page.id) ? page.status === "published" : page.status !== "published"
  );
}

async function nextOwnerProfileSlot(
  database: D1Database,
  scope: PublicBookingOwnerScope,
): Promise<number> {
  const rows = await database.prepare(
    `SELECT slot FROM public_booking_owner_profile_slots
      WHERE workspace_id = ? AND principal_id = ? ORDER BY slot`,
  ).bind(scope.workspace, scope.principal).all<{ readonly slot: number }>();
  const occupied = new Set(rows.results.map(row => row.slot));
  for (let slot = 1; slot <= MAX_PROFILES_PER_OWNER; slot += 1) {
    if (!occupied.has(slot)) return slot;
  }
  throw new PublicBookingPublicationError(
    409,
    "publication_profile_quota_exceeded",
    `One TAP user may publish at most ${MAX_PROFILES_PER_OWNER} Booking Profiles.`,
  );
}

export async function publishPublicBookingProfile(options: {
  readonly database: D1Database;
  readonly scope: PublicBookingOwnerScope;
  readonly input: PublicBookingProfilePublicationInput;
  readonly publicBaseUrl: string;
  readonly now?: string;
}): Promise<PublishedBookingProfileRecord> {
  const now = options.now ?? new Date().toISOString();
  let profile = await loadProfile(
    options.database,
    options.scope,
    options.input.sourceProfileId,
  );
  if (profile && profile.current_slug !== options.input.profileSlug) {
    throw new PublicBookingPublicationError(
      409,
      "profile_slug_immutable",
      "Published Booking Profile slugs cannot be changed in public booking v1.",
    );
  }
  const slugOwner = await options.database.prepare(
    "SELECT profile_id FROM public_booking_profile_slugs WHERE slug = ? COLLATE NOCASE",
  ).bind(options.input.profileSlug).first<SlugOwnerRow>();
  if (slugOwner && slugOwner.profile_id !== profile?.id) {
    throw new PublicBookingPublicationError(
      409,
      "profile_slug_unavailable",
      "That Booking Profile slug is already reserved.",
    );
  }
  if (!profile && options.input.expectedGeneration !== 0) publicationConflict(0);
  const profileId = profile?.id ?? identifier("public-profile");
  const existingPages = profile ? await loadPages(options.database, profile.id) : [];
  const prepared = await preparePublications({
    database: options.database,
    scope: options.scope,
    profileId,
    existingPages,
    inputs: options.input.publications,
  });
  if (profile && options.input.expectedGeneration !== profile.publication_generation) {
    if (profileAlreadyMatches(profile, existingPages, prepared, options.input.displayName)) {
      return publishedProfileRecord({
        profile,
        publications: prepared,
        publicBaseUrl: options.publicBaseUrl,
        generation: profile.publication_generation,
        publishedAt: profile.updated_at,
        idempotentReplay: true,
      });
    }
    publicationConflict(profile.publication_generation);
  }
  const targetGeneration = (profile?.publication_generation ?? 0) + 1;
  const ownerSlot = profile ? null : await nextOwnerProfileSlot(options.database, options.scope);
  const desiredPageIds = new Set(prepared.map(item => item.pageId));
  const omittedPublishedPages = existingPages.filter(
    page => page.status === "published" && !desiredPageIds.has(page.id),
  );
  const statements: D1PreparedStatement[] = [];
  if (!profile) {
    statements.push(
      options.database.prepare(
        `INSERT INTO public_booking_profiles (
           id, workspace_id, principal_id, source_profile_id, current_slug,
           display_name, owner_type, owner_kind, status, publication_generation,
           created_at, updated_at, published_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'individual', ?, 'published', ?, ?, ?, ?)`,
      ).bind(
        profileId,
        options.scope.workspace,
        options.scope.principal,
        options.input.sourceProfileId,
        options.input.profileSlug,
        options.input.displayName,
        options.scope.ownerKind ?? "individual",
        targetGeneration,
        now,
        now,
        now,
      ),
      options.database.prepare(
        `INSERT INTO public_booking_owner_profile_slots (
           workspace_id, principal_id, slot, profile_id, created_at
         ) VALUES (?, ?, ?, ?, ?)`,
      ).bind(options.scope.workspace, options.scope.principal, ownerSlot, profileId, now),
      options.database.prepare(
        `INSERT INTO public_booking_profile_slugs (slug, profile_id, active, created_at)
         VALUES (?, ?, 1, ?)`,
      ).bind(options.input.profileSlug, profileId, now),
    );
  }
  statements.push(
    options.database.prepare(
      `INSERT INTO public_booking_profile_generations (
         profile_id, generation, action, created_at
       ) VALUES (?, ?, 'publish', ?)`,
    ).bind(profileId, targetGeneration, now),
  );
  if (profile) {
    statements.push(options.database.prepare(
      `UPDATE public_booking_profiles
          SET display_name = ?, status = 'published',
              publication_generation = ?, updated_at = ?,
              published_at = COALESCE(published_at, ?)
        WHERE id = ? AND publication_generation = ?`,
    ).bind(
      options.input.displayName,
      targetGeneration,
      now,
      now,
      profile.id,
      options.input.expectedGeneration,
    ));
  }
  for (const preparedPage of prepared) {
    if (!preparedPage.page) {
      statements.push(
        options.database.prepare(
          `INSERT INTO public_booking_pages (
             id, profile_id, source_event_type_id, current_slug, status,
             created_at, updated_at, published_at
           ) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)`,
        ).bind(
          preparedPage.pageId,
          profileId,
          preparedPage.input.sourceEventTypeId,
          preparedPage.input.eventTypeSlug,
          now,
          now,
          now,
        ),
        options.database.prepare(
          `INSERT INTO public_booking_page_slugs (
             profile_id, slug, page_id, active, created_at
           ) VALUES (?, ?, ?, 1, ?)`,
        ).bind(profileId, preparedPage.input.eventTypeSlug, preparedPage.pageId, now),
      );
    }
    if (!preparedPage.existingRevision) {
      statements.push(options.database.prepare(
        `INSERT INTO public_booking_page_revisions (
           id, page_id, snapshot_hash, public_snapshot_json,
           private_snapshot_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(
        preparedPage.revisionId,
        preparedPage.pageId,
        preparedPage.snapshotHash,
        preparedPage.publicSnapshotJson,
        preparedPage.privateSnapshotJson,
        now,
      ));
    }
    statements.push(
      options.database.prepare(
        `UPDATE public_booking_pages
            SET current_revision_id = ?, status = 'published', updated_at = ?,
                published_at = COALESCE(published_at, ?)
          WHERE id = ?`,
      ).bind(preparedPage.revisionId, now, now, preparedPage.pageId),
      options.database.prepare(
        `INSERT INTO public_booking_publication_audit (
           id, profile_id, page_id, workspace_id, principal_id, action,
           revision_id, created_at
         ) VALUES (?, ?, ?, ?, ?, 'publish', ?, ?)`,
      ).bind(
        identifier("public-audit"),
        profileId,
        preparedPage.pageId,
        options.scope.workspace,
        options.scope.principal,
        preparedPage.revisionId,
        now,
      ),
    );
  }
  for (const page of omittedPublishedPages) {
    statements.push(
      options.database.prepare(
        "UPDATE public_booking_pages SET status = 'unpublished', updated_at = ? WHERE id = ?",
      ).bind(now, page.id),
      options.database.prepare(
        `INSERT INTO public_booking_publication_audit (
           id, profile_id, page_id, workspace_id, principal_id, action, created_at
         ) VALUES (?, ?, ?, ?, ?, 'unpublish', ?)`,
      ).bind(
        identifier("public-audit"),
        profileId,
        page.id,
        options.scope.workspace,
        options.scope.principal,
        now,
      ),
    );
  }
  try {
    await options.database.batch(statements);
  } catch (error) {
    profile = await loadProfile(options.database, options.scope, options.input.sourceProfileId);
    if (profile) {
      const currentPages = await loadPages(options.database, profile.id);
      const currentPrepared = await preparePublications({
        database: options.database,
        scope: options.scope,
        profileId: profile.id,
        existingPages: currentPages,
        inputs: options.input.publications,
      });
      if (profileAlreadyMatches(profile, currentPages, currentPrepared, options.input.displayName)) {
        return publishedProfileRecord({
          profile,
          publications: currentPrepared,
          publicBaseUrl: options.publicBaseUrl,
          generation: profile.publication_generation,
          publishedAt: profile.updated_at,
          idempotentReplay: true,
        });
      }
    }
    if (batchConflict(error)) publicationConflict(profile?.publication_generation);
    throw error;
  }
  const committedProfile: ProfileRow = profile
    ? {
      ...profile,
      display_name: options.input.displayName,
      status: "published",
      publication_generation: targetGeneration,
      published_at: profile.published_at ?? now,
      updated_at: now,
    }
    : {
      id: profileId,
      source_profile_id: options.input.sourceProfileId,
      current_slug: options.input.profileSlug,
      display_name: options.input.displayName,
      status: "published",
      publication_generation: targetGeneration,
      published_at: now,
      updated_at: now,
    };
  return publishedProfileRecord({
    profile: committedProfile,
    publications: prepared,
    publicBaseUrl: options.publicBaseUrl,
    generation: targetGeneration,
    publishedAt: committedProfile.updated_at,
    idempotentReplay: false,
  });
}

export async function unpublishPublicBookingProfile(options: {
  readonly database: D1Database;
  readonly scope: PublicBookingOwnerScope;
  readonly input: PublicBookingProfileUnpublicationInput;
  readonly now?: string;
}): Promise<UnpublishedBookingProfileRecord> {
  const now = options.now ?? new Date().toISOString();
  const profile = await loadProfile(
    options.database,
    options.scope,
    options.input.sourceProfileId,
  );
  if (!profile) {
    throw new PublicBookingPublicationError(
      404,
      "publication_not_found",
      "This public Booking Profile was not found.",
    );
  }
  const pages = await loadPages(options.database, profile.id);
  const alreadyUnpublished = profile.status === "unpublished" &&
    pages.every(page => page.status !== "published");
  if (alreadyUnpublished) {
    return {
      profileId: profile.id,
      sourceProfileId: profile.source_profile_id,
      generation: profile.publication_generation,
      unpublishedAt: profile.updated_at,
      idempotentReplay: true,
    };
  }
  if (options.input.expectedGeneration !== profile.publication_generation) {
    publicationConflict(profile.publication_generation);
  }
  const targetGeneration = profile.publication_generation + 1;
  const statements: D1PreparedStatement[] = [
    options.database.prepare(
      `INSERT INTO public_booking_profile_generations (
         profile_id, generation, action, created_at
       ) VALUES (?, ?, 'unpublish', ?)`,
    ).bind(profile.id, targetGeneration, now),
    options.database.prepare(
      `UPDATE public_booking_profiles
          SET status = 'unpublished', publication_generation = ?, updated_at = ?
        WHERE id = ? AND publication_generation = ?`,
    ).bind(targetGeneration, now, profile.id, options.input.expectedGeneration),
  ];
  for (const page of pages.filter(candidate => candidate.status === "published")) {
    statements.push(
      options.database.prepare(
        "UPDATE public_booking_pages SET status = 'unpublished', updated_at = ? WHERE id = ?",
      ).bind(now, page.id),
      options.database.prepare(
        `INSERT INTO public_booking_publication_audit (
           id, profile_id, page_id, workspace_id, principal_id, action, created_at
         ) VALUES (?, ?, ?, ?, ?, 'unpublish', ?)`,
      ).bind(
        identifier("public-audit"),
        profile.id,
        page.id,
        options.scope.workspace,
        options.scope.principal,
        now,
      ),
    );
  }
  try {
    await options.database.batch(statements);
  } catch (error) {
    const current = await loadProfile(
      options.database,
      options.scope,
      options.input.sourceProfileId,
    );
    if (current) {
      const currentPages = await loadPages(options.database, current.id);
      if (current.status === "unpublished" && currentPages.every(page => page.status !== "published")) {
        return {
          profileId: current.id,
          sourceProfileId: current.source_profile_id,
          generation: current.publication_generation,
          unpublishedAt: current.updated_at,
          idempotentReplay: true,
        };
      }
    }
    if (batchConflict(error)) publicationConflict(current?.publication_generation);
    throw error;
  }
  return {
    profileId: profile.id,
    sourceProfileId: profile.source_profile_id,
    generation: targetGeneration,
    unpublishedAt: now,
    idempotentReplay: false,
  };
}
