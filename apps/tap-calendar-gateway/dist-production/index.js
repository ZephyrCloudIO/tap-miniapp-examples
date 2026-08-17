var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/public-booking-publication.ts
var PUBLICATION_SCHEMA_VERSION = "tap.calendar.publication.v1";
var PROFILE_PUBLICATION_SCHEMA_VERSION = "tap.calendar.profile-publication.v1";
var PROFILE_UNPUBLICATION_SCHEMA_VERSION = "tap.calendar.profile-unpublication.v1";
var PUBLIC_PAGE_SNAPSHOT_SCHEMA_VERSION = "tap.calendar.public-page-snapshot.v1";
var PRIVATE_PAGE_SNAPSHOT_SCHEMA_VERSION = "tap.calendar.private-page-snapshot.v1";
var SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
var CLOCK_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
var CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
var MAX_CONFLICT_CALENDARS = 50;
var MAX_WINDOWS = 28;
var MAX_OVERRIDES = 366;
var MAX_PAGES_PER_PROFILE = 50;
var MAX_PROFILES_PER_OWNER = 20;
var MAX_PUBLIC_SNAPSHOT_BYTES = 32768;
var MAX_PRIVATE_SNAPSHOT_BYTES = 131072;
var RESERVED_PROFILE_SLUGS = /* @__PURE__ */ new Set([
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
  "www"
]);
var PublicBookingPublicationError = class extends Error {
  static {
    __name(this, "PublicBookingPublicationError");
  }
  status;
  code;
  currentGeneration;
  constructor(status, code, message2, currentGeneration) {
    super(message2);
    this.name = "PublicBookingPublicationError";
    this.status = status;
    this.code = code;
    this.currentGeneration = currentGeneration;
  }
};
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
__name(isRecord, "isRecord");
function requiredString(value, field, maximum = 255) {
  if (typeof value !== "string") {
    throw new PublicBookingPublicationError(400, "invalid_publication", `${field} is required.`);
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximum) {
    throw new PublicBookingPublicationError(400, "invalid_publication", `${field} is invalid.`);
  }
  return normalized;
}
__name(requiredString, "requiredString");
function optionalString(value, field, maximum) {
  if (typeof value !== "string") {
    throw new PublicBookingPublicationError(400, "invalid_publication", `${field} must be text.`);
  }
  const normalized = value.trim();
  if (normalized.length > maximum) {
    throw new PublicBookingPublicationError(400, "invalid_publication", `${field} is too long.`);
  }
  return normalized;
}
__name(optionalString, "optionalString");
function integerInRange(value, field, minimum, maximum) {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new PublicBookingPublicationError(
      400,
      "invalid_publication",
      `${field} must be a whole number between ${minimum} and ${maximum}.`
    );
  }
  return Number(value);
}
__name(integerInRange, "integerInRange");
function slug(value, field) {
  const normalized = requiredString(value, field, 64);
  if (normalized.length < 2 || !SLUG_PATTERN.test(normalized)) {
    throw new PublicBookingPublicationError(
      400,
      "invalid_slug",
      `${field} must use 2\u201364 lowercase letters, numbers, and single hyphens.`
    );
  }
  return normalized;
}
__name(slug, "slug");
function clockTime(value, field) {
  const normalized = requiredString(value, field, 5);
  if (!CLOCK_TIME_PATTERN.test(normalized)) {
    throw new PublicBookingPublicationError(400, "invalid_publication", `${field} must use HH:MM.`);
  }
  return normalized;
}
__name(clockTime, "clockTime");
function calendarDate(value, field) {
  const normalized = requiredString(value, field, 10);
  const parsed = Date.parse(`${normalized}T00:00:00.000Z`);
  if (!CALENDAR_DATE_PATTERN.test(normalized) || !Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== normalized) {
    throw new PublicBookingPublicationError(400, "invalid_publication", `${field} must use YYYY-MM-DD.`);
  }
  return normalized;
}
__name(calendarDate, "calendarDate");
function timeZone(value, field) {
  const normalized = requiredString(value, field, 255);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: normalized }).format(0);
  } catch {
    throw new PublicBookingPublicationError(400, "invalid_time_zone", `${field} is not a supported IANA time zone.`);
  }
  return normalized;
}
__name(timeZone, "timeZone");
function minutes(clock) {
  return Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
}
__name(minutes, "minutes");
function parseWindows(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_WINDOWS) {
    throw new PublicBookingPublicationError(400, "invalid_publication", `schedule.windows must contain 1\u2013${MAX_WINDOWS} ranges.`);
  }
  const byDay = /* @__PURE__ */ new Map();
  const result = value.map((candidate, index) => {
    if (!isRecord(candidate)) {
      throw new PublicBookingPublicationError(400, "invalid_publication", `schedule.windows[${index}] is invalid.`);
    }
    const day2 = integerInRange(candidate.day, `schedule.windows[${index}].day`, 0, 6);
    if (typeof candidate.enabled !== "boolean") {
      throw new PublicBookingPublicationError(400, "invalid_publication", `schedule.windows[${index}].enabled is required.`);
    }
    const start = clockTime(candidate.start, `schedule.windows[${index}].start`);
    const end = clockTime(candidate.end, `schedule.windows[${index}].end`);
    if (minutes(end) - minutes(start) < 5) {
      throw new PublicBookingPublicationError(400, "invalid_publication", "Availability ranges must last at least 5 minutes and end after they start.");
    }
    const window = { day: day2, enabled: candidate.enabled, start, end };
    const daily = byDay.get(day2) ?? [];
    daily.push(window);
    byDay.set(day2, daily);
    return window;
  });
  for (const daily of byDay.values()) {
    if (daily.some((window) => window.enabled !== daily[0]?.enabled)) {
      throw new PublicBookingPublicationError(400, "invalid_publication", "Every range on a weekday must share its enabled state.");
    }
    const ordered = [...daily].sort((left, right) => left.start.localeCompare(right.start));
    for (let index = 1; index < ordered.length; index += 1) {
      if (ordered[index].start < ordered[index - 1].end) {
        throw new PublicBookingPublicationError(400, "invalid_publication", "Availability ranges on one day cannot overlap.");
      }
    }
  }
  return [...result].sort((left, right) => left.day - right.day || left.start.localeCompare(right.start));
}
__name(parseWindows, "parseWindows");
function parseOverrides(value, inheritedTimeZone) {
  if (value === void 0) return [];
  if (!Array.isArray(value) || value.length > MAX_OVERRIDES) {
    throw new PublicBookingPublicationError(400, "invalid_publication", `schedule.overrides may contain at most ${MAX_OVERRIDES} dates.`);
  }
  const dates = /* @__PURE__ */ new Set();
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
    const overrideTimeZone = candidate.timeZone === void 0 ? inheritedTimeZone : timeZone(candidate.timeZone, `schedule.overrides[${index}].timeZone`);
    if (!candidate.available) return { date, label, available: false, timeZone: overrideTimeZone };
    const start = clockTime(candidate.start, `schedule.overrides[${index}].start`);
    const end = clockTime(candidate.end, `schedule.overrides[${index}].end`);
    if (minutes(end) - minutes(start) < 5) {
      throw new PublicBookingPublicationError(400, "invalid_publication", "Available overrides must last at least 5 minutes and end after they start.");
    }
    return { date, label, available: true, timeZone: overrideTimeZone, start, end };
  }).sort((left, right) => left.date.localeCompare(right.date));
}
__name(parseOverrides, "parseOverrides");
function parseUniqueIdentifiers(value, field) {
  if (!Array.isArray(value) || value.length > MAX_CONFLICT_CALENDARS) {
    throw new PublicBookingPublicationError(400, "invalid_publication", `${field} may contain at most ${MAX_CONFLICT_CALENDARS} calendars.`);
  }
  const identifiers = value.map((candidate, index) => requiredString(candidate, `${field}[${index}]`, 255));
  if (new Set(identifiers).size !== identifiers.length) {
    throw new PublicBookingPublicationError(400, "invalid_publication", `${field} must not contain duplicates.`);
  }
  return [...identifiers].sort();
}
__name(parseUniqueIdentifiers, "parseUniqueIdentifiers");
function parsePublicBookingPublication(value) {
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
    description: optionalString(value.description, "description", 2e3),
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
      overrides: parseOverrides(value.schedule.overrides, scheduleTimeZone)
    }
  };
}
__name(parsePublicBookingPublication, "parsePublicBookingPublication");
function publicationGeneration(value, field) {
  return integerInRange(value, field, 0, 2147483647);
}
__name(publicationGeneration, "publicationGeneration");
function parsePublicBookingProfilePublication(value) {
  if (!isRecord(value) || value.schemaVersion !== PROFILE_PUBLICATION_SCHEMA_VERSION) {
    throw new PublicBookingPublicationError(
      400,
      "invalid_publication",
      `schemaVersion must be ${PROFILE_PUBLICATION_SCHEMA_VERSION}.`
    );
  }
  if (!Array.isArray(value.publications) || value.publications.length === 0 || value.publications.length > MAX_PAGES_PER_PROFILE) {
    throw new PublicBookingPublicationError(
      400,
      "invalid_publication",
      `publications must contain 1\u2013${MAX_PAGES_PER_PROFILE} active Event Types.`
    );
  }
  const publications = value.publications.map(parsePublicBookingPublication);
  const first = publications[0];
  if (publications.some(
    (publication) => publication.sourceProfileId !== first.sourceProfileId || publication.profileSlug !== first.profileSlug || publication.displayName !== first.displayName || publication.ownerType !== first.ownerType
  )) {
    throw new PublicBookingPublicationError(
      400,
      "invalid_publication",
      "Every page in a profile publication must identify the same Booking Profile."
    );
  }
  if (RESERVED_PROFILE_SLUGS.has(first.profileSlug)) {
    throw new PublicBookingPublicationError(
      409,
      "profile_slug_reserved",
      "That Booking Profile slug is reserved by TAP."
    );
  }
  if (new Set(publications.map((publication) => publication.sourceEventTypeId)).size !== publications.length || new Set(publications.map((publication) => publication.eventTypeSlug.toLowerCase())).size !== publications.length) {
    throw new PublicBookingPublicationError(
      400,
      "invalid_publication",
      "Event Type IDs and slugs must be unique within a Booking Profile."
    );
  }
  return {
    schemaVersion: PROFILE_PUBLICATION_SCHEMA_VERSION,
    expectedGeneration: publicationGeneration(value.expectedGeneration, "expectedGeneration"),
    publications
  };
}
__name(parsePublicBookingProfilePublication, "parsePublicBookingProfilePublication");
function parsePublicBookingProfileUnpublication(value) {
  if (!isRecord(value) || value.schemaVersion !== PROFILE_UNPUBLICATION_SCHEMA_VERSION) {
    throw new PublicBookingPublicationError(
      400,
      "invalid_publication",
      `schemaVersion must be ${PROFILE_UNPUBLICATION_SCHEMA_VERSION}.`
    );
  }
  return {
    schemaVersion: PROFILE_UNPUBLICATION_SCHEMA_VERSION,
    sourceProfileId: requiredString(value.sourceProfileId, "sourceProfileId"),
    expectedGeneration: publicationGeneration(value.expectedGeneration, "expectedGeneration")
  };
}
__name(parsePublicBookingProfileUnpublication, "parsePublicBookingProfileUnpublication");
function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}
__name(base64Url, "base64Url");
async function snapshotHash(publicSnapshot, privateSnapshot) {
  const body = JSON.stringify([publicSnapshot, privateSnapshot]);
  const digest2 = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  return base64Url(new Uint8Array(digest2));
}
__name(snapshotHash, "snapshotHash");
function identifier(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}
__name(identifier, "identifier");
function publicLocation(location) {
  if (location === "google-meet") return { location: "google-meet", label: "Google Meet" };
  if (location === "phone") return { location: "phone", label: "Phone call" };
  if (location === "physical") return { location: "in-person", label: "In person" };
  return { location: "custom", label: "Meeting details provided after booking" };
}
__name(publicLocation, "publicLocation");
async function validateOwnedCalendars(database, scope, publication) {
  const requested = Array.from(/* @__PURE__ */ new Set([
    publication.destinationCalendarId,
    ...publication.conflictCalendarIds
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
        AND provider_calendars.id IN (${placeholders})`
  ).bind(scope.workspace, scope.principal, ...requested).all();
  if (rows.results.length !== requested.length) {
    throw new PublicBookingPublicationError(403, "calendar_scope_denied", "One or more publication calendars do not belong to this TAP user.");
  }
  const destination = rows.results.find((row) => row.id === publication.destinationCalendarId);
  if (!destination || destination.provider !== "google" || destination.mode !== "oauth" || destination.role === "free-busy" || destination.writable !== 1 || destination.status !== "connected") {
    throw new PublicBookingPublicationError(409, "destination_unavailable", "Public booking v1 requires a connected writable Google Destination Calendar.");
  }
  if (!publication.conflictCalendarIds.includes(publication.destinationCalendarId)) {
    throw new PublicBookingPublicationError(
      400,
      "destination_conflict_required",
      "The Destination Calendar must always be checked for public booking conflicts."
    );
  }
  const conflicts = rows.results.filter(
    (row) => publication.conflictCalendarIds.includes(row.id)
  );
  if (conflicts.some(
    (row) => row.provider !== "google" || row.mode !== "oauth" || row.status !== "connected"
  )) {
    throw new PublicBookingPublicationError(
      409,
      "conflict_calendar_unavailable",
      "Public booking v1 requires every conflict calendar to use a connected Google OAuth account."
    );
  }
}
__name(validateOwnedCalendars, "validateOwnedCalendars");
var snapshotByteLength = /* @__PURE__ */ __name((value) => new TextEncoder().encode(value).byteLength, "snapshotByteLength");
function assertSnapshotSize(publicSnapshotJson, privateSnapshotJson) {
  if (snapshotByteLength(publicSnapshotJson) > MAX_PUBLIC_SNAPSHOT_BYTES || snapshotByteLength(privateSnapshotJson) > MAX_PRIVATE_SNAPSHOT_BYTES) {
    throw new PublicBookingPublicationError(
      413,
      "publication_too_large",
      "This Booking Profile is too large to publish. Reduce its public copy or availability overrides."
    );
  }
}
__name(assertSnapshotSize, "assertSnapshotSize");
async function loadProfile(database, scope, sourceProfileId) {
  return database.prepare(
    `SELECT id, source_profile_id, current_slug, display_name, status,
            publication_generation, published_at, updated_at
       FROM public_booking_profiles
      WHERE workspace_id = ? AND principal_id = ? AND source_profile_id = ?`
  ).bind(scope.workspace, scope.principal, sourceProfileId).first();
}
__name(loadProfile, "loadProfile");
async function loadPages(database, profileId) {
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
      WHERE public_booking_pages.profile_id = ?`
  ).bind(profileId).all();
  return rows.results;
}
__name(loadPages, "loadPages");
function publicationSnapshots(scope, input) {
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
      approvalRequired: input.approvalRequired
    },
    privateSnapshot: {
      schemaVersion: PRIVATE_PAGE_SNAPSHOT_SCHEMA_VERSION,
      workspaceId: scope.workspace,
      principalId: scope.principal,
      destinationCalendarId: input.destinationCalendarId,
      conflictCalendarIds: input.conflictCalendarIds,
      sourceAvailabilityScheduleId: input.sourceAvailabilityScheduleId,
      location: input.location,
      schedule: input.schedule
    }
  };
}
__name(publicationSnapshots, "publicationSnapshots");
function publicationConflict(currentGeneration, message2 = "This Booking Profile changed in another TAP session. Refresh it and try again.") {
  throw new PublicBookingPublicationError(
    409,
    "publication_conflict",
    message2,
    currentGeneration
  );
}
__name(publicationConflict, "publicationConflict");
function batchConflict(error) {
  const message2 = error instanceof Error ? error.message : String(error);
  return /UNIQUE constraint failed.*public_booking_|public_booking_profile_generations|public_booking_owner_profile_slots/iu.test(message2);
}
__name(batchConflict, "batchConflict");
function publishedProfileRecord(options) {
  const base = options.publicBaseUrl.replace(/\/$/u, "");
  return {
    profileId: options.profile.id,
    sourceProfileId: options.profile.source_profile_id,
    profileSlug: options.profile.current_slug,
    generation: options.generation,
    publishedAt: options.publishedAt,
    idempotentReplay: options.idempotentReplay,
    pages: options.publications.map((prepared) => ({
      profileId: options.profile.id,
      pageId: prepared.pageId,
      revisionId: prepared.revisionId,
      sourceEventTypeId: prepared.input.sourceEventTypeId,
      profileSlug: options.profile.current_slug,
      eventTypeSlug: prepared.input.eventTypeSlug,
      canonicalUrl: `${base}/${options.profile.current_slug}/${prepared.input.eventTypeSlug}`,
      publishedAt: prepared.page?.published_at ?? options.publishedAt
    }))
  };
}
__name(publishedProfileRecord, "publishedProfileRecord");
async function preparePublications(options) {
  const bySourceId = new Map(options.existingPages.map((page) => [page.source_event_type_id, page]));
  const newPageCount = options.inputs.filter((input) => !bySourceId.has(input.sourceEventTypeId)).length;
  if (options.existingPages.length + newPageCount > MAX_PAGES_PER_PROFILE) {
    throw new PublicBookingPublicationError(
      409,
      "publication_page_quota_exceeded",
      `A Booking Profile may reserve at most ${MAX_PAGES_PER_PROFILE} Event Type slugs.`
    );
  }
  const result = [];
  for (const input of options.inputs) {
    await validateOwnedCalendars(options.database, options.scope, input);
    const page = bySourceId.get(input.sourceEventTypeId) ?? null;
    if (page && page.current_slug !== input.eventTypeSlug) {
      throw new PublicBookingPublicationError(
        409,
        "event_type_slug_immutable",
        "Published Event Type slugs cannot be changed in public booking v1."
      );
    }
    const slugOwner = await options.database.prepare(
      "SELECT page_id FROM public_booking_page_slugs WHERE profile_id = ? AND slug = ? COLLATE NOCASE"
    ).bind(options.profileId, input.eventTypeSlug).first();
    if (slugOwner && slugOwner.page_id !== page?.id) {
      throw new PublicBookingPublicationError(
        409,
        "event_type_slug_unavailable",
        "That Event Type slug is already reserved in this Booking Profile."
      );
    }
    const snapshots = publicationSnapshots(options.scope, input);
    const publicSnapshotJson = JSON.stringify(snapshots.publicSnapshot);
    const privateSnapshotJson = JSON.stringify(snapshots.privateSnapshot);
    assertSnapshotSize(publicSnapshotJson, privateSnapshotJson);
    const hash = await snapshotHash(snapshots.publicSnapshot, snapshots.privateSnapshot);
    const existingRevision = page ? await options.database.prepare(
      "SELECT id FROM public_booking_page_revisions WHERE page_id = ? AND snapshot_hash = ?"
    ).bind(page.id, hash).first() : null;
    result.push({
      input,
      page,
      pageId: page?.id ?? identifier("public-page"),
      revisionId: existingRevision?.id ?? identifier("public-revision"),
      existingRevision: Boolean(existingRevision),
      snapshotHash: hash,
      publicSnapshotJson,
      privateSnapshotJson
    });
  }
  return result;
}
__name(preparePublications, "preparePublications");
function profileAlreadyMatches(profile, existingPages, prepared, displayName) {
  if (profile.status !== "published" || profile.display_name !== displayName) return false;
  const desiredByPage = new Map(prepared.map((item) => [item.pageId, item]));
  return prepared.every(
    (item) => item.page?.status === "published" && item.page.current_snapshot_hash === item.snapshotHash
  ) && existingPages.every(
    (page) => desiredByPage.has(page.id) ? page.status === "published" : page.status !== "published"
  );
}
__name(profileAlreadyMatches, "profileAlreadyMatches");
async function nextOwnerProfileSlot(database, scope) {
  const rows = await database.prepare(
    `SELECT slot FROM public_booking_owner_profile_slots
      WHERE workspace_id = ? AND principal_id = ? ORDER BY slot`
  ).bind(scope.workspace, scope.principal).all();
  const occupied = new Set(rows.results.map((row) => row.slot));
  for (let slot = 1; slot <= MAX_PROFILES_PER_OWNER; slot += 1) {
    if (!occupied.has(slot)) return slot;
  }
  throw new PublicBookingPublicationError(
    409,
    "publication_profile_quota_exceeded",
    `One TAP user may publish at most ${MAX_PROFILES_PER_OWNER} Booking Profiles.`
  );
}
__name(nextOwnerProfileSlot, "nextOwnerProfileSlot");
async function publishPublicBookingProfile(options) {
  const now = options.now ?? (/* @__PURE__ */ new Date()).toISOString();
  const first = options.input.publications[0];
  let profile = await loadProfile(
    options.database,
    options.scope,
    first.sourceProfileId
  );
  if (profile && profile.current_slug !== first.profileSlug) {
    throw new PublicBookingPublicationError(
      409,
      "profile_slug_immutable",
      "Published Booking Profile slugs cannot be changed in public booking v1."
    );
  }
  const slugOwner = await options.database.prepare(
    "SELECT profile_id FROM public_booking_profile_slugs WHERE slug = ? COLLATE NOCASE"
  ).bind(first.profileSlug).first();
  if (slugOwner && slugOwner.profile_id !== profile?.id) {
    throw new PublicBookingPublicationError(
      409,
      "profile_slug_unavailable",
      "That Booking Profile slug is already reserved."
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
    inputs: options.input.publications
  });
  if (profile && options.input.expectedGeneration !== profile.publication_generation) {
    if (profileAlreadyMatches(profile, existingPages, prepared, first.displayName)) {
      return publishedProfileRecord({
        profile,
        publications: prepared,
        publicBaseUrl: options.publicBaseUrl,
        generation: profile.publication_generation,
        publishedAt: profile.updated_at,
        idempotentReplay: true
      });
    }
    publicationConflict(profile.publication_generation);
  }
  const targetGeneration = (profile?.publication_generation ?? 0) + 1;
  const ownerSlot = profile ? null : await nextOwnerProfileSlot(options.database, options.scope);
  const desiredPageIds = new Set(prepared.map((item) => item.pageId));
  const omittedPublishedPages = existingPages.filter(
    (page) => page.status === "published" && !desiredPageIds.has(page.id)
  );
  const statements = [];
  if (!profile) {
    statements.push(
      options.database.prepare(
        `INSERT INTO public_booking_profiles (
           id, workspace_id, principal_id, source_profile_id, current_slug,
           display_name, owner_type, status, publication_generation,
           created_at, updated_at, published_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'individual', 'published', ?, ?, ?, ?)`
      ).bind(
        profileId,
        options.scope.workspace,
        options.scope.principal,
        first.sourceProfileId,
        first.profileSlug,
        first.displayName,
        targetGeneration,
        now,
        now,
        now
      ),
      options.database.prepare(
        `INSERT INTO public_booking_owner_profile_slots (
           workspace_id, principal_id, slot, profile_id, created_at
         ) VALUES (?, ?, ?, ?, ?)`
      ).bind(options.scope.workspace, options.scope.principal, ownerSlot, profileId, now),
      options.database.prepare(
        `INSERT INTO public_booking_profile_slugs (slug, profile_id, active, created_at)
         VALUES (?, ?, 1, ?)`
      ).bind(first.profileSlug, profileId, now)
    );
  }
  statements.push(
    options.database.prepare(
      `INSERT INTO public_booking_profile_generations (
         profile_id, generation, action, created_at
       ) VALUES (?, ?, 'publish', ?)`
    ).bind(profileId, targetGeneration, now)
  );
  if (profile) {
    statements.push(options.database.prepare(
      `UPDATE public_booking_profiles
          SET display_name = ?, status = 'published',
              publication_generation = ?, updated_at = ?,
              published_at = COALESCE(published_at, ?)
        WHERE id = ? AND publication_generation = ?`
    ).bind(
      first.displayName,
      targetGeneration,
      now,
      now,
      profile.id,
      options.input.expectedGeneration
    ));
  }
  for (const preparedPage of prepared) {
    if (!preparedPage.page) {
      statements.push(
        options.database.prepare(
          `INSERT INTO public_booking_pages (
             id, profile_id, source_event_type_id, current_slug, status,
             created_at, updated_at, published_at
           ) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)`
        ).bind(
          preparedPage.pageId,
          profileId,
          preparedPage.input.sourceEventTypeId,
          preparedPage.input.eventTypeSlug,
          now,
          now,
          now
        ),
        options.database.prepare(
          `INSERT INTO public_booking_page_slugs (
             profile_id, slug, page_id, active, created_at
           ) VALUES (?, ?, ?, 1, ?)`
        ).bind(profileId, preparedPage.input.eventTypeSlug, preparedPage.pageId, now)
      );
    }
    if (!preparedPage.existingRevision) {
      statements.push(options.database.prepare(
        `INSERT INTO public_booking_page_revisions (
           id, page_id, snapshot_hash, public_snapshot_json,
           private_snapshot_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(
        preparedPage.revisionId,
        preparedPage.pageId,
        preparedPage.snapshotHash,
        preparedPage.publicSnapshotJson,
        preparedPage.privateSnapshotJson,
        now
      ));
    }
    statements.push(
      options.database.prepare(
        `UPDATE public_booking_pages
            SET current_revision_id = ?, status = 'published', updated_at = ?,
                published_at = COALESCE(published_at, ?)
          WHERE id = ?`
      ).bind(preparedPage.revisionId, now, now, preparedPage.pageId),
      options.database.prepare(
        `INSERT INTO public_booking_publication_audit (
           id, profile_id, page_id, workspace_id, principal_id, action,
           revision_id, created_at
         ) VALUES (?, ?, ?, ?, ?, 'publish', ?, ?)`
      ).bind(
        identifier("public-audit"),
        profileId,
        preparedPage.pageId,
        options.scope.workspace,
        options.scope.principal,
        preparedPage.revisionId,
        now
      )
    );
  }
  for (const page of omittedPublishedPages) {
    statements.push(
      options.database.prepare(
        "UPDATE public_booking_pages SET status = 'unpublished', updated_at = ? WHERE id = ?"
      ).bind(now, page.id),
      options.database.prepare(
        `INSERT INTO public_booking_publication_audit (
           id, profile_id, page_id, workspace_id, principal_id, action, created_at
         ) VALUES (?, ?, ?, ?, ?, 'unpublish', ?)`
      ).bind(
        identifier("public-audit"),
        profileId,
        page.id,
        options.scope.workspace,
        options.scope.principal,
        now
      )
    );
  }
  try {
    await options.database.batch(statements);
  } catch (error) {
    profile = await loadProfile(options.database, options.scope, first.sourceProfileId);
    if (profile) {
      const currentPages = await loadPages(options.database, profile.id);
      const currentPrepared = await preparePublications({
        database: options.database,
        scope: options.scope,
        profileId: profile.id,
        existingPages: currentPages,
        inputs: options.input.publications
      });
      if (profileAlreadyMatches(profile, currentPages, currentPrepared, first.displayName)) {
        return publishedProfileRecord({
          profile,
          publications: currentPrepared,
          publicBaseUrl: options.publicBaseUrl,
          generation: profile.publication_generation,
          publishedAt: profile.updated_at,
          idempotentReplay: true
        });
      }
    }
    if (batchConflict(error)) publicationConflict(profile?.publication_generation);
    throw error;
  }
  const committedProfile = profile ? {
    ...profile,
    display_name: first.displayName,
    status: "published",
    publication_generation: targetGeneration,
    published_at: profile.published_at ?? now,
    updated_at: now
  } : {
    id: profileId,
    source_profile_id: first.sourceProfileId,
    current_slug: first.profileSlug,
    display_name: first.displayName,
    status: "published",
    publication_generation: targetGeneration,
    published_at: now,
    updated_at: now
  };
  return publishedProfileRecord({
    profile: committedProfile,
    publications: prepared,
    publicBaseUrl: options.publicBaseUrl,
    generation: targetGeneration,
    publishedAt: committedProfile.updated_at,
    idempotentReplay: false
  });
}
__name(publishPublicBookingProfile, "publishPublicBookingProfile");
async function unpublishPublicBookingProfile(options) {
  const now = options.now ?? (/* @__PURE__ */ new Date()).toISOString();
  const profile = await loadProfile(
    options.database,
    options.scope,
    options.input.sourceProfileId
  );
  if (!profile) {
    throw new PublicBookingPublicationError(
      404,
      "publication_not_found",
      "This public Booking Profile was not found."
    );
  }
  const pages = await loadPages(options.database, profile.id);
  const alreadyUnpublished = profile.status === "unpublished" && pages.every((page) => page.status !== "published");
  if (alreadyUnpublished) {
    return {
      profileId: profile.id,
      sourceProfileId: profile.source_profile_id,
      generation: profile.publication_generation,
      unpublishedAt: profile.updated_at,
      idempotentReplay: true
    };
  }
  if (options.input.expectedGeneration !== profile.publication_generation) {
    publicationConflict(profile.publication_generation);
  }
  const targetGeneration = profile.publication_generation + 1;
  const statements = [
    options.database.prepare(
      `INSERT INTO public_booking_profile_generations (
         profile_id, generation, action, created_at
       ) VALUES (?, ?, 'unpublish', ?)`
    ).bind(profile.id, targetGeneration, now),
    options.database.prepare(
      `UPDATE public_booking_profiles
          SET status = 'unpublished', publication_generation = ?, updated_at = ?
        WHERE id = ? AND publication_generation = ?`
    ).bind(targetGeneration, now, profile.id, options.input.expectedGeneration)
  ];
  for (const page of pages.filter((candidate) => candidate.status === "published")) {
    statements.push(
      options.database.prepare(
        "UPDATE public_booking_pages SET status = 'unpublished', updated_at = ? WHERE id = ?"
      ).bind(now, page.id),
      options.database.prepare(
        `INSERT INTO public_booking_publication_audit (
           id, profile_id, page_id, workspace_id, principal_id, action, created_at
         ) VALUES (?, ?, ?, ?, ?, 'unpublish', ?)`
      ).bind(
        identifier("public-audit"),
        profile.id,
        page.id,
        options.scope.workspace,
        options.scope.principal,
        now
      )
    );
  }
  try {
    await options.database.batch(statements);
  } catch (error) {
    const current = await loadProfile(
      options.database,
      options.scope,
      options.input.sourceProfileId
    );
    if (current) {
      const currentPages = await loadPages(options.database, current.id);
      if (current.status === "unpublished" && currentPages.every((page) => page.status !== "published")) {
        return {
          profileId: current.id,
          sourceProfileId: current.source_profile_id,
          generation: current.publication_generation,
          unpublishedAt: current.updated_at,
          idempotentReplay: true
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
    idempotentReplay: false
  };
}
__name(unpublishPublicBookingProfile, "unpublishPublicBookingProfile");

// src/public-booking-busy.ts
var canonicalInstant = /* @__PURE__ */ __name((value, field) => {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new TypeError(`${field} must be a valid timestamp.`);
  }
  return new Date(timestamp).toISOString();
}, "canonicalInstant");
async function loadPublicBookingBusyIntervals(options) {
  const timeMin = canonicalInstant(options.timeMin, "timeMin");
  const timeMax = canonicalInstant(options.timeMax, "timeMax");
  if (timeMax <= timeMin) {
    throw new RangeError("timeMax must be later than timeMin.");
  }
  const calendarIds = [...new Set(options.conflictCalendarIds)];
  if (calendarIds.length === 0) return [];
  const rows = (await options.database.prepare(
    `SELECT COALESCE(managed.start_at, commits.start_at) AS start_at,
            COALESCE(managed.end_at, commits.end_at) AS end_at
       FROM provider_booking_commits AS commits
       LEFT JOIN public_booking_management_credentials AS managed
         ON managed.workspace_id = commits.workspace_id
        AND managed.principal_id = commits.principal_id
        AND managed.provider_operation_id = commits.idempotency_key
      WHERE commits.workspace_id = ?
        AND commits.principal_id = ?
        AND commits.destination_calendar_id IN (${calendarIds.map(() => "?").join(", ")})
        AND commits.state IN ('pending', 'committed')
        AND (commits.booking_kind <> 'approval-hold' OR commits.resolution_status IS NULL OR commits.resolution_status <> 'declined')
        AND (commits.booking_kind <> 'approval-hold' OR commits.hold_expired_at IS NULL)
        AND (managed.booking_reference IS NULL OR managed.status = 'active')
        AND COALESCE(managed.start_at, commits.start_at) < ?
        AND COALESCE(managed.end_at, commits.end_at) > ?
      ORDER BY COALESCE(managed.start_at, commits.start_at),
               COALESCE(managed.end_at, commits.end_at)`
  ).bind(
    options.workspace,
    options.principal,
    ...calendarIds,
    timeMax,
    timeMin
  ).all()).results;
  const intervals = rows.map((row) => {
    const start = canonicalInstant(row.start_at, "Stored booking start");
    const end = canonicalInstant(row.end_at, "Stored booking end");
    if (end <= start) {
      throw new RangeError("A stored booking interval is invalid.");
    }
    return {
      start: start < timeMin ? timeMin : start,
      end: end > timeMax ? timeMax : end
    };
  });
  const busy = [];
  for (const interval of intervals) {
    const previous = busy.at(-1);
    if (!previous || previous.end < interval.start) {
      busy.push(interval);
      continue;
    }
    if (interval.end > previous.end) {
      busy[busy.length - 1] = { start: previous.start, end: interval.end };
    }
  }
  return busy;
}
__name(loadPublicBookingBusyIntervals, "loadPublicBookingBusyIntervals");

// src/public-booking-rate-limit.ts
var PublicBookingRateLimitError = class extends Error {
  static {
    __name(this, "PublicBookingRateLimitError");
  }
  status;
  code;
  retryable;
  constructor(status, code, message2, retryable) {
    super(message2);
    this.name = "PublicBookingRateLimitError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
};
var base64Url2 = /* @__PURE__ */ __name((bytes) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}, "base64Url");
var boundedActor = /* @__PURE__ */ __name((request) => {
  const ip = request.headers.get("CF-Connecting-IP")?.trim() ?? "";
  return /^[0-9a-f:.]{2,64}$/iu.test(ip) ? ip : "unknown-client";
}, "boundedActor");
async function enforcePublicBookingRateLimit(options) {
  if (!options.limiter) {
    if (options.localDevelopment) return;
    throw new PublicBookingRateLimitError(
      503,
      "public_booking_unconfigured",
      "Public booking protection is not configured.",
      true
    );
  }
  const digest2 = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${options.resource}\0${boundedActor(options.request)}`)
  );
  const { success } = await options.limiter.limit({
    // Keep raw IP addresses out of the rate-limiter key while retaining a
    // page-specific actor boundary.
    key: base64Url2(new Uint8Array(digest2))
  });
  if (!success) {
    throw new PublicBookingRateLimitError(
      429,
      "public_rate_limited",
      "Too many booking requests. Wait a moment and try again.",
      true
    );
  }
}
__name(enforcePublicBookingRateLimit, "enforcePublicBookingRateLimit");

// src/public-booking-read.ts
var PUBLIC_PAGE_SNAPSHOT_SCHEMA_VERSION2 = "tap.calendar.public-page-snapshot.v1";
var PRIVATE_PAGE_SNAPSHOT_SCHEMA_VERSION2 = "tap.calendar.private-page-snapshot.v1";
var PUBLIC_PAGE_SCHEMA_VERSION = "tap.calendar.public-page.v1";
var PUBLIC_AVAILABILITY_SCHEMA_VERSION = "tap.calendar.public-availability.v1";
var SLUG_PATTERN2 = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
var CALENDAR_DATE_PATTERN2 = /^\d{4}-\d{2}-\d{2}$/u;
var CLOCK_TIME_PATTERN2 = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
var REVISION_PATTERN = /^[A-Za-z0-9_-]{8,255}$/u;
var BASE64_URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
var SLOT_INTERVAL_MINUTES = 30;
var SLOT_TOKEN_TTL_SECONDS = 5 * 60;
var MAX_SLOT_TOKEN_TTL_SECONDS = 15 * 60;
var MAX_TOKEN_LENGTH = 4096;
var MAX_SIGNING_KEY_BYTES = 4096;
var MIN_SIGNING_KEY_BYTES = 32;
var MILLISECONDS_PER_MINUTE = 6e4;
var MILLISECONDS_PER_DAY = 864e5;
var PublicBookingReadError = class extends Error {
  static {
    __name(this, "PublicBookingReadError");
  }
  status;
  code;
  constructor(status, code, message2) {
    super(message2);
    this.name = "PublicBookingReadError";
    this.status = status;
    this.code = code;
  }
};
var isRecord2 = /* @__PURE__ */ __name((value) => Boolean(value) && typeof value === "object" && !Array.isArray(value), "isRecord");
var exactKeys = /* @__PURE__ */ __name((value, keys) => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}, "exactKeys");
var validIdentifier = /* @__PURE__ */ __name((value, maximum = 255) => typeof value === "string" && value.length > 0 && value.length <= maximum && value.trim() === value, "validIdentifier");
var validInteger = /* @__PURE__ */ __name((value, minimum, maximum) => typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum, "validInteger");
var validClockTime = /* @__PURE__ */ __name((value) => typeof value === "string" && CLOCK_TIME_PATTERN2.test(value), "validClockTime");
var validCalendarDate = /* @__PURE__ */ __name((value) => {
  if (typeof value !== "string" || !CALENDAR_DATE_PATTERN2.test(value)) return false;
  const instant = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(instant) && new Date(instant).toISOString().slice(0, 10) === value;
}, "validCalendarDate");
var validInstant = /* @__PURE__ */ __name((value) => typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value)), "validInstant");
var validTimeZone = /* @__PURE__ */ __name((value) => {
  if (typeof value !== "string" || value.length === 0 || value.length > 255 || value.trim() !== value) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}, "validTimeZone");
var invalidStoredSnapshot = /* @__PURE__ */ __name(() => {
  throw new PublicBookingReadError(
    503,
    "published_page_invalid",
    "This booking page is temporarily unavailable."
  );
}, "invalidStoredSnapshot");
function parsePublicSnapshot(value) {
  if (!isRecord2(value) || value.schemaVersion !== PUBLIC_PAGE_SNAPSHOT_SCHEMA_VERSION2 || !validIdentifier(value.displayName, 160) || !validIdentifier(value.title, 160) || typeof value.description !== "string" || value.description.length > 2e3 || !validInteger(value.durationMinutes, 5, 1440) || !["google-meet", "phone", "in-person", "custom"].includes(String(value.location)) || !validIdentifier(value.locationLabel, 160) || typeof value.approvalRequired !== "boolean") return invalidStoredSnapshot();
  return {
    schemaVersion: PUBLIC_PAGE_SNAPSHOT_SCHEMA_VERSION2,
    displayName: value.displayName,
    title: value.title,
    description: value.description,
    durationMinutes: value.durationMinutes,
    location: value.location,
    locationLabel: value.locationLabel,
    approvalRequired: value.approvalRequired
  };
}
__name(parsePublicSnapshot, "parsePublicSnapshot");
function parseWindow(value) {
  if (!isRecord2(value) || !validInteger(value.day, 0, 6) || typeof value.enabled !== "boolean" || !validClockTime(value.start) || !validClockTime(value.end) || value.start >= value.end) return invalidStoredSnapshot();
  return { day: value.day, enabled: value.enabled, start: value.start, end: value.end };
}
__name(parseWindow, "parseWindow");
function parseOverride(value, scheduleTimeZone) {
  if (!isRecord2(value) || !validCalendarDate(value.date) || !validIdentifier(value.label, 160) || typeof value.available !== "boolean") return invalidStoredSnapshot();
  const timeZone2 = value.timeZone === void 0 ? scheduleTimeZone : value.timeZone;
  if (!validTimeZone(timeZone2)) return invalidStoredSnapshot();
  if (!value.available) {
    return { date: value.date, label: value.label, available: false, timeZone: timeZone2 };
  }
  if (!validClockTime(value.start) || !validClockTime(value.end) || value.start >= value.end) {
    return invalidStoredSnapshot();
  }
  return {
    date: value.date,
    label: value.label,
    available: true,
    timeZone: timeZone2,
    start: value.start,
    end: value.end
  };
}
__name(parseOverride, "parseOverride");
function parsePrivateSnapshot(value) {
  if (!isRecord2(value) || value.schemaVersion !== PRIVATE_PAGE_SNAPSHOT_SCHEMA_VERSION2 || !validIdentifier(value.workspaceId) || !validIdentifier(value.principalId) || !validIdentifier(value.destinationCalendarId) || !Array.isArray(value.conflictCalendarIds) || value.conflictCalendarIds.length === 0 || value.conflictCalendarIds.length > 50 || !validIdentifier(value.sourceAvailabilityScheduleId) || !validIdentifier(value.location, 64) || !isRecord2(value.schedule)) return invalidStoredSnapshot();
  const conflictCalendarIds = value.conflictCalendarIds.filter((candidate) => validIdentifier(candidate));
  if (conflictCalendarIds.length !== value.conflictCalendarIds.length || new Set(conflictCalendarIds).size !== conflictCalendarIds.length || !conflictCalendarIds.includes(value.destinationCalendarId)) return invalidStoredSnapshot();
  const schedule = value.schedule;
  if (!validTimeZone(schedule.timeZone) || !validClockTime(schedule.preferredStart) || !validClockTime(schedule.preferredEnd) || schedule.preferredStart >= schedule.preferredEnd || !validInteger(schedule.bufferBeforeMinutes, 0, 1440) || !validInteger(schedule.bufferAfterMinutes, 0, 1440) || !validInteger(schedule.minimumNoticeMinutes, 0, 10080) || !validInteger(schedule.bookingHorizonDays, 1, 365) || !Array.isArray(schedule.windows) || schedule.windows.length === 0 || schedule.windows.length > 28 || !Array.isArray(schedule.overrides) || schedule.overrides.length > 366) return invalidStoredSnapshot();
  const scheduleTimeZone = schedule.timeZone;
  const windows = schedule.windows.map(parseWindow);
  const overrides = schedule.overrides.map((candidate) => parseOverride(candidate, scheduleTimeZone));
  if (new Set(overrides.map((override) => override.date)).size !== overrides.length) {
    return invalidStoredSnapshot();
  }
  return {
    schemaVersion: PRIVATE_PAGE_SNAPSHOT_SCHEMA_VERSION2,
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
      overrides
    }
  };
}
__name(parsePrivateSnapshot, "parsePrivateSnapshot");
var validSlug = /* @__PURE__ */ __name((value) => value.length >= 2 && value.length <= 64 && SLUG_PATTERN2.test(value), "validSlug");
function parsePublicBookingPagePath(pathname) {
  const match = /^\/api\/public\/pages\/([a-z0-9]+(?:-[a-z0-9]+)*)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/(availability|bookings))?$/u.exec(pathname);
  if (!match?.[1] || !match[2] || !validSlug(match[1]) || !validSlug(match[2])) return null;
  return {
    profileSlug: match[1],
    eventTypeSlug: match[2],
    resource: match[3] === "availability" || match[3] === "bookings" ? match[3] : "page"
  };
}
__name(parsePublicBookingPagePath, "parsePublicBookingPagePath");
function publicAvailabilityQuery(searchParams) {
  const allowed = /* @__PURE__ */ new Set(["month", "timeZone", "pageRevision"]);
  const entries = [...searchParams.entries()];
  if (entries.length !== 3 || entries.some(([key]) => !allowed.has(key)) || [...allowed].some((key) => searchParams.getAll(key).length !== 1)) {
    throw new PublicBookingReadError(
      400,
      "invalid_availability_query",
      "Availability requires exactly one month, timeZone, and pageRevision."
    );
  }
  const month = searchParams.get("month");
  const timeZone2 = searchParams.get("timeZone");
  const pageRevision = searchParams.get("pageRevision");
  if (!validCalendarDate(month) || !month.endsWith("-01")) {
    throw new PublicBookingReadError(400, "invalid_month", "month must be the first date of a calendar month.");
  }
  if (!validTimeZone(timeZone2)) {
    throw new PublicBookingReadError(400, "invalid_time_zone", "timeZone must be a supported IANA time zone.");
  }
  if (typeof pageRevision !== "string" || !REVISION_PATTERN.test(pageRevision)) {
    throw new PublicBookingReadError(400, "invalid_revision", "pageRevision is invalid.");
  }
  return { month, timeZone: timeZone2, pageRevision };
}
__name(publicAvailabilityQuery, "publicAvailabilityQuery");
function parseSnapshotJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return invalidStoredSnapshot();
  }
}
__name(parseSnapshotJson, "parseSnapshotJson");
async function resolvePublishedPublicBookingPage(database, profileSlug, eventTypeSlug) {
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
      LIMIT 1`
  ).bind(profileSlug, eventTypeSlug).first();
  if (!row || !row.published_at) {
    throw new PublicBookingReadError(404, "public_page_unavailable", "This booking page is unavailable.");
  }
  const privateSnapshot = parsePrivateSnapshot(parseSnapshotJson(row.private_snapshot_json));
  if (privateSnapshot.workspaceId !== row.workspace_id || privateSnapshot.principalId !== row.principal_id) return invalidStoredSnapshot();
  return {
    profileId: row.profile_id,
    pageId: row.page_id,
    revisionId: row.revision_id,
    profileSlug: row.profile_slug,
    eventTypeSlug: row.event_type_slug,
    publishedAt: row.published_at,
    publicSnapshot: parsePublicSnapshot(parseSnapshotJson(row.public_snapshot_json)),
    privateSnapshot
  };
}
__name(resolvePublishedPublicBookingPage, "resolvePublishedPublicBookingPage");
async function assertPublicPageStillCurrent(database, resolved) {
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
      LIMIT 1`
  ).bind(
    resolved.profileId,
    resolved.pageId,
    resolved.revisionId,
    resolved.profileSlug,
    resolved.eventTypeSlug
  ).first("current");
  if (current !== 1) {
    throw new PublicBookingReadError(
      409,
      "public_page_changed",
      "This booking page changed. Reload it before choosing a time."
    );
  }
}
__name(assertPublicPageStillCurrent, "assertPublicPageStillCurrent");
var formatterFor = /* @__PURE__ */ __name((timeZone2, cache2) => {
  const cached = cache2.get(timeZone2);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone2,
    calendar: "iso8601",
    numberingSystem: "latn",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  cache2.set(timeZone2, formatter);
  return formatter;
}, "formatterFor");
var wallClockParts = /* @__PURE__ */ __name((instant, timeZone2, cache2) => {
  const values = {};
  for (const part of formatterFor(timeZone2, cache2).formatToParts(new Date(instant))) {
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
    second: values.second ?? 0
  };
}, "wallClockParts");
var calendarDateInTimeZone = /* @__PURE__ */ __name((instant, timeZone2, cache2) => {
  const parts = wallClockParts(instant, timeZone2, cache2);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}, "calendarDateInTimeZone");
var offsetMinutesAtInstant = /* @__PURE__ */ __name((instant, timeZone2, cache2) => {
  const parts = wallClockParts(instant, timeZone2, cache2);
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((localAsUtc - Math.trunc(instant / 1e3) * 1e3) / MILLISECONDS_PER_MINUTE);
}, "offsetMinutesAtInstant");
function zonedWallClockInstant(date, minuteFromMidnight, timeZone2, cache2) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(date);
  if (!match || !Number.isInteger(minuteFromMidnight) || minuteFromMidnight < 0 || minuteFromMidnight >= 1440) {
    return null;
  }
  const desired = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Math.floor(minuteFromMidnight / 60),
    minute: minuteFromMidnight % 60,
    second: 0
  };
  const wallClockUtc = Date.UTC(desired.year, desired.month - 1, desired.day, desired.hour, desired.minute);
  const possibleOffsets = /* @__PURE__ */ new Set();
  for (const sampleHours of [-36, -24, -12, -6, 0, 6, 12, 24, 36]) {
    possibleOffsets.add(offsetMinutesAtInstant(
      wallClockUtc + sampleHours * 60 * MILLISECONDS_PER_MINUTE,
      timeZone2,
      cache2
    ));
  }
  const candidates = [...possibleOffsets].map((offset) => wallClockUtc - offset * MILLISECONDS_PER_MINUTE).filter((instant) => {
    const actual = wallClockParts(instant, timeZone2, cache2);
    return actual.year === desired.year && actual.month === desired.month && actual.day === desired.day && actual.hour === desired.hour && actual.minute === desired.minute;
  }).sort((left, right) => left - right);
  return candidates[0] ?? null;
}
__name(zonedWallClockInstant, "zonedWallClockInstant");
var minutesFromMidnight = /* @__PURE__ */ __name((value) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5)), "minutesFromMidnight");
var addCalendarDays = /* @__PURE__ */ __name((date, days) => new Date(Date.parse(`${date}T00:00:00.000Z`) + days * MILLISECONDS_PER_DAY).toISOString().slice(0, 10), "addCalendarDays");
var nextCalendarMonth = /* @__PURE__ */ __name((month) => {
  const date = /* @__PURE__ */ new Date(`${month}T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString().slice(0, 10);
}, "nextCalendarMonth");
var initials = /* @__PURE__ */ __name((displayName) => {
  const words = displayName.trim().split(/[\s-]+/u).filter(Boolean);
  const chosen = words.length > 1 ? [words[0], words.at(-1)] : [words[0]];
  const result = chosen.flatMap((word) => word ? Array.from(word)[0] ?? [] : []).join("").toLocaleUpperCase("en-US");
  return result || "T";
}, "initials");
var normalizedPublicBaseUrl = /* @__PURE__ */ __name((value) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new PublicBookingReadError(503, "public_booking_unconfigured", "Public booking is not configured.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/" && url.pathname !== "") {
    throw new PublicBookingReadError(503, "public_booking_unconfigured", "Public booking is not configured.");
  }
  return url;
}, "normalizedPublicBaseUrl");
function projectPublicBookingPage(resolved, options) {
  if (!Number.isFinite(options.now) || !validIdentifier(options.turnstileSiteKey, 2048)) {
    throw new PublicBookingReadError(503, "public_booking_unconfigured", "Public booking is not configured.");
  }
  const cache2 = /* @__PURE__ */ new Map();
  const today = calendarDateInTimeZone(options.now, resolved.privateSnapshot.schedule.timeZone, cache2);
  const base = normalizedPublicBaseUrl(options.baseUrl);
  const canonicalUrl = new URL(
    `/${encodeURIComponent(resolved.profileSlug)}/${encodeURIComponent(resolved.eventTypeSlug)}`,
    base
  ).toString();
  const snapshot = resolved.publicSnapshot;
  return {
    schemaVersion: PUBLIC_PAGE_SCHEMA_VERSION,
    pageRevision: resolved.revisionId,
    canonicalUrl,
    profile: { displayName: snapshot.displayName, initials: initials(snapshot.displayName) },
    eventType: {
      title: snapshot.title,
      ...snapshot.description ? { description: snapshot.description } : {},
      durationMinutes: snapshot.durationMinutes,
      location: snapshot.location,
      locationLabel: snapshot.locationLabel,
      approvalRequired: snapshot.approvalRequired
    },
    bookingWindow: {
      firstDate: today,
      lastDate: addCalendarDays(today, resolved.privateSnapshot.schedule.bookingHorizonDays - 1)
    },
    turnstile: { siteKey: options.turnstileSiteKey }
  };
}
__name(projectPublicBookingPage, "projectPublicBookingPage");
function candidateHostDateRange(snapshot, query, now, cache2) {
  const viewerMonthStart = zonedWallClockInstant(query.month, 0, query.timeZone, cache2);
  const viewerMonthEnd = zonedWallClockInstant(nextCalendarMonth(query.month), 0, query.timeZone, cache2);
  if (viewerMonthStart === null || viewerMonthEnd === null) return null;
  const today = calendarDateInTimeZone(now, snapshot.schedule.timeZone, cache2);
  const horizonLast = addCalendarDays(today, snapshot.schedule.bookingHorizonDays - 1);
  const firstPossible = calendarDateInTimeZone(
    viewerMonthStart - 2 * MILLISECONDS_PER_DAY,
    snapshot.schedule.timeZone,
    cache2
  );
  const lastPossible = calendarDateInTimeZone(
    viewerMonthEnd + 2 * MILLISECONDS_PER_DAY,
    snapshot.schedule.timeZone,
    cache2
  );
  const first = firstPossible > today ? firstPossible : today;
  const last = lastPossible < horizonLast ? lastPossible : horizonLast;
  return first <= last ? { first, last } : null;
}
__name(candidateHostDateRange, "candidateHostDateRange");
function windowsForHostDate(schedule, hostDate) {
  const override = schedule.overrides.find((candidate) => candidate.date === hostDate);
  if (override) {
    return {
      timeZone: override.timeZone,
      windows: override.available && override.start && override.end ? [{ day: (/* @__PURE__ */ new Date(`${hostDate}T00:00:00.000Z`)).getUTCDay(), enabled: true, start: override.start, end: override.end }] : []
    };
  }
  const day2 = (/* @__PURE__ */ new Date(`${hostDate}T00:00:00.000Z`)).getUTCDay();
  return {
    timeZone: schedule.timeZone,
    windows: schedule.windows.filter((window) => window.day === day2 && window.enabled)
  };
}
__name(windowsForHostDate, "windowsForHostDate");
function checkedBusyIntervals(busyIntervals) {
  const checked = busyIntervals.map((interval) => {
    const start = Date.parse(interval.start);
    const end = Date.parse(interval.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      throw new PublicBookingReadError(502, "availability_source_invalid", "Availability could not be verified.");
    }
    return { start, end };
  }).sort((left, right) => left.start - right.start || left.end - right.end);
  const coalesced = [];
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
__name(checkedBusyIntervals, "checkedBusyIntervals");
var overlapsBusy = /* @__PURE__ */ __name((busy, start, end) => {
  let low = 0;
  let high = busy.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (busy[middle].end <= start) low = middle + 1;
    else high = middle;
  }
  const candidate = busy[low];
  return Boolean(candidate && candidate.start < end);
}, "overlapsBusy");
function generateCandidates(resolved, query, busyIntervals, now) {
  if (!Number.isFinite(now)) {
    throw new PublicBookingReadError(503, "public_booking_unconfigured", "Public booking is not configured.");
  }
  if (query.pageRevision !== resolved.revisionId) {
    throw new PublicBookingReadError(
      409,
      "public_page_changed",
      "This booking page changed. Reload it before choosing a time."
    );
  }
  const cache2 = /* @__PURE__ */ new Map();
  const range = candidateHostDateRange(resolved.privateSnapshot, query, now, cache2);
  if (!range) return [];
  const busy = checkedBusyIntervals(busyIntervals);
  const schedule = resolved.privateSnapshot.schedule;
  const preferredStart = minutesFromMidnight(schedule.preferredStart);
  const preferredEnd = minutesFromMidnight(schedule.preferredEnd);
  const earliestStart = now + schedule.minimumNoticeMinutes * MILLISECONDS_PER_MINUTE;
  const viewerMonthEnd = nextCalendarMonth(query.month);
  const grouped = /* @__PURE__ */ new Map();
  for (let hostDate = range.first; hostDate <= range.last; hostDate = addCalendarDays(hostDate, 1)) {
    const availability = windowsForHostDate(schedule, hostDate);
    for (const window of availability.windows) {
      const windowStart = minutesFromMidnight(window.start);
      const windowEndMinute = minutesFromMidnight(window.end);
      const windowEnd = zonedWallClockInstant(hostDate, windowEndMinute, availability.timeZone, cache2);
      if (windowEnd === null) continue;
      for (let minute2 = windowStart; minute2 + resolved.publicSnapshot.durationMinutes <= windowEndMinute; minute2 += SLOT_INTERVAL_MINUTES) {
        const start = zonedWallClockInstant(hostDate, minute2, availability.timeZone, cache2);
        if (start === null || start < earliestStart) continue;
        const end = start + resolved.publicSnapshot.durationMinutes * MILLISECONDS_PER_MINUTE;
        if (end > windowEnd) continue;
        if (offsetMinutesAtInstant(start, availability.timeZone, cache2) !== offsetMinutesAtInstant(end, availability.timeZone, cache2)) continue;
        const bufferedStart = start - schedule.bufferBeforeMinutes * MILLISECONDS_PER_MINUTE;
        const bufferedEnd = end + schedule.bufferAfterMinutes * MILLISECONDS_PER_MINUTE;
        if (overlapsBusy(busy, bufferedStart, bufferedEnd)) continue;
        const viewerDate = calendarDateInTimeZone(start, query.timeZone, cache2);
        if (viewerDate < query.month || viewerDate >= viewerMonthEnd) continue;
        const slots = grouped.get(viewerDate) ?? /* @__PURE__ */ new Map();
        const candidate = {
          start: new Date(start).toISOString(),
          end: new Date(end).toISOString(),
          preferred: minute2 >= preferredStart && minute2 < preferredEnd
        };
        slots.set(`${candidate.start}\0${candidate.end}`, candidate);
        grouped.set(viewerDate, slots);
      }
    }
  }
  return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, slots]) => ({
    date,
    slots: [...slots.values()].sort(
      (left, right) => Number(right.preferred) - Number(left.preferred) || left.start.localeCompare(right.start) || left.end.localeCompare(right.end)
    ).map(({ start, end }) => ({ start, end }))
  }));
}
__name(generateCandidates, "generateCandidates");
function generatePublicAvailabilityCandidates(options) {
  return generateCandidates(options.resolved, options.query, options.busyIntervals, options.now);
}
__name(generatePublicAvailabilityCandidates, "generatePublicAvailabilityCandidates");
function publicSlotSatisfiesPublishedSchedule(options) {
  const start = Date.parse(options.start);
  const end = Date.parse(options.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || new Date(start).toISOString() !== options.start || new Date(end).toISOString() !== options.end) return false;
  const utcDate = new Date(start).toISOString().slice(0, 10);
  const query = {
    month: `${utcDate.slice(0, 7)}-01`,
    timeZone: "UTC",
    pageRevision: options.resolved.revisionId
  };
  return generateCandidates(options.resolved, query, [], options.now).some((group) => group.slots.some(
    (slot) => slot.start === options.start && slot.end === options.end
  ));
}
__name(publicSlotSatisfiesPublishedSchedule, "publicSlotSatisfiesPublishedSchedule");
function availabilityQueryWindow(resolved, query, now) {
  const candidates = generateCandidates(resolved, query, [], now).flatMap((group) => group.slots);
  if (candidates.length === 0) return null;
  const before = resolved.privateSnapshot.schedule.bufferBeforeMinutes * MILLISECONDS_PER_MINUTE;
  const after = resolved.privateSnapshot.schedule.bufferAfterMinutes * MILLISECONDS_PER_MINUTE;
  const timeMin = Math.min(...candidates.map((candidate) => Date.parse(candidate.start) - before));
  const timeMax = Math.max(...candidates.map((candidate) => Date.parse(candidate.end) + after));
  return { timeMin: new Date(timeMin).toISOString(), timeMax: new Date(timeMax).toISOString() };
}
__name(availabilityQueryWindow, "availabilityQueryWindow");
var base64UrlEncode = /* @__PURE__ */ __name((bytes) => {
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of array) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}, "base64UrlEncode");
var base64UrlDecode = /* @__PURE__ */ __name((value) => {
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
}, "base64UrlDecode");
var signingKeyBytes = /* @__PURE__ */ __name((secret) => {
  const bytes = new TextEncoder().encode(secret);
  if (bytes.byteLength < MIN_SIGNING_KEY_BYTES || bytes.byteLength > MAX_SIGNING_KEY_BYTES) {
    throw new PublicBookingReadError(503, "public_booking_unconfigured", "Public booking is not configured.");
  }
  return bytes;
}, "signingKeyBytes");
var preparePublicSlotSigningKey = /* @__PURE__ */ __name((secret) => crypto.subtle.importKey(
  "raw",
  signingKeyBytes(secret),
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["sign", "verify"]
), "preparePublicSlotSigningKey");
var validateSlotClaims = /* @__PURE__ */ __name((value) => {
  if (!isRecord2(value) || !exactKeys(value, ["v", "revisionId", "start", "end", "iat", "exp"]) || value.v !== 1 || typeof value.revisionId !== "string" || !REVISION_PATTERN.test(value.revisionId) || !validInstant(value.start) || !validInstant(value.end) || Date.parse(value.end) <= Date.parse(value.start) || !validInteger(value.iat, 0, Number.MAX_SAFE_INTEGER) || !validInteger(value.exp, 0, Number.MAX_SAFE_INTEGER) || value.exp <= value.iat || value.exp - value.iat > MAX_SLOT_TOKEN_TTL_SECONDS) {
    throw new PublicBookingReadError(400, "slot_token_invalid", "This selected time is invalid. Choose it again.");
  }
  return {
    v: 1,
    revisionId: value.revisionId,
    start: value.start,
    end: value.end,
    iat: value.iat,
    exp: value.exp
  };
}, "validateSlotClaims");
var signPublicSlotTokenWithKey = /* @__PURE__ */ __name(async (key, claims) => {
  const validated = validateSlotClaims(claims);
  const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(validated)));
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload)
  );
  return `${payload}.${base64UrlEncode(signature)}`;
}, "signPublicSlotTokenWithKey");
async function verifyPublicSlotToken(secret, token, options) {
  const parts = token.split(".");
  if (token.length > MAX_TOKEN_LENGTH || parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new PublicBookingReadError(400, "slot_token_invalid", "This selected time is invalid. Choose it again.");
  }
  const payloadBytes = base64UrlDecode(parts[0]);
  const signature = base64UrlDecode(parts[1]);
  if (!payloadBytes || !signature || signature.byteLength !== 32 || payloadBytes.byteLength > 2048) {
    throw new PublicBookingReadError(400, "slot_token_invalid", "This selected time is invalid. Choose it again.");
  }
  const validSignature = await crypto.subtle.verify(
    "HMAC",
    await preparePublicSlotSigningKey(secret),
    signature,
    new TextEncoder().encode(parts[0])
  );
  if (!validSignature) {
    throw new PublicBookingReadError(400, "slot_token_invalid", "This selected time is invalid. Choose it again.");
  }
  let decoded;
  try {
    decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(payloadBytes));
  } catch {
    throw new PublicBookingReadError(400, "slot_token_invalid", "This selected time is invalid. Choose it again.");
  }
  const claims = validateSlotClaims(decoded);
  if (!Number.isFinite(options.now)) {
    throw new PublicBookingReadError(503, "public_booking_unconfigured", "Public booking is not configured.");
  }
  const nowSeconds = Math.floor(options.now / 1e3);
  if (claims.exp <= nowSeconds) {
    throw new PublicBookingReadError(409, "slot_token_expired", "This selected time expired. Choose it again.");
  }
  if (claims.iat > nowSeconds + 60) {
    throw new PublicBookingReadError(400, "slot_token_invalid", "This selected time is invalid. Choose it again.");
  }
  return claims;
}
__name(verifyPublicSlotToken, "verifyPublicSlotToken");
async function buildPublicAvailability(resolved, query, busyIntervals, signingKey, now) {
  const grouped = generatePublicAvailabilityCandidates({ resolved, query, busyIntervals, now });
  const preparedSigningKey = typeof signingKey === "string" ? await preparePublicSlotSigningKey(signingKey) : signingKey;
  const issuedAt = Math.floor(now / 1e3);
  const expiresAt = issuedAt + SLOT_TOKEN_TTL_SECONDS;
  const dates = await Promise.all(grouped.map(async (group) => ({
    date: group.date,
    slots: await Promise.all(group.slots.map(async (slot) => ({
      ...slot,
      token: await signPublicSlotTokenWithKey(preparedSigningKey, {
        v: 1,
        revisionId: resolved.revisionId,
        start: slot.start,
        end: slot.end,
        iat: issuedAt,
        exp: expiresAt
      })
    })))
  })));
  return {
    schemaVersion: PUBLIC_AVAILABILITY_SCHEMA_VERSION,
    pageRevision: resolved.revisionId,
    viewerTimeZone: query.timeZone,
    month: query.month,
    generatedAt: new Date(now).toISOString(),
    expiresAt: new Date(expiresAt * 1e3).toISOString(),
    dates
  };
}
__name(buildPublicAvailability, "buildPublicAvailability");

// ../../node_modules/.pnpm/jose@6.2.3/node_modules/jose/dist/webapi/lib/buffer_utils.js
var encoder = new TextEncoder();
var decoder = new TextDecoder();
var MAX_INT32 = 2 ** 32;
function concat(...buffers) {
  const size = buffers.reduce((acc, { length }) => acc + length, 0);
  const buf = new Uint8Array(size);
  let i = 0;
  for (const buffer of buffers) {
    buf.set(buffer, i);
    i += buffer.length;
  }
  return buf;
}
__name(concat, "concat");
function encode(string) {
  const bytes = new Uint8Array(string.length);
  for (let i = 0; i < string.length; i++) {
    const code = string.charCodeAt(i);
    if (code > 127) {
      throw new TypeError("non-ASCII string encountered in encode()");
    }
    bytes[i] = code;
  }
  return bytes;
}
__name(encode, "encode");

// ../../node_modules/.pnpm/jose@6.2.3/node_modules/jose/dist/webapi/lib/base64.js
function decodeBase64(encoded) {
  if (Uint8Array.fromBase64) {
    return Uint8Array.fromBase64(encoded);
  }
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
__name(decodeBase64, "decodeBase64");

// ../../node_modules/.pnpm/jose@6.2.3/node_modules/jose/dist/webapi/util/base64url.js
function decode(input) {
  if (Uint8Array.fromBase64) {
    return Uint8Array.fromBase64(typeof input === "string" ? input : decoder.decode(input), {
      alphabet: "base64url"
    });
  }
  let encoded = input;
  if (encoded instanceof Uint8Array) {
    encoded = decoder.decode(encoded);
  }
  encoded = encoded.replace(/-/g, "+").replace(/_/g, "/");
  try {
    return decodeBase64(encoded);
  } catch {
    throw new TypeError("The input to be decoded is not correctly encoded.");
  }
}
__name(decode, "decode");

// ../../node_modules/.pnpm/jose@6.2.3/node_modules/jose/dist/webapi/lib/crypto_key.js
var unusable = /* @__PURE__ */ __name((name, prop = "algorithm.name") => new TypeError(`CryptoKey does not support this operation, its ${prop} must be ${name}`), "unusable");
var isAlgorithm = /* @__PURE__ */ __name((algorithm, name) => algorithm.name === name, "isAlgorithm");
function getHashLength(hash) {
  return parseInt(hash.name.slice(4), 10);
}
__name(getHashLength, "getHashLength");
function checkHashLength(algorithm, expected) {
  const actual = getHashLength(algorithm.hash);
  if (actual !== expected)
    throw unusable(`SHA-${expected}`, "algorithm.hash");
}
__name(checkHashLength, "checkHashLength");
function getNamedCurve(alg) {
  switch (alg) {
    case "ES256":
      return "P-256";
    case "ES384":
      return "P-384";
    case "ES512":
      return "P-521";
    default:
      throw new Error("unreachable");
  }
}
__name(getNamedCurve, "getNamedCurve");
function checkUsage(key, usage) {
  if (usage && !key.usages.includes(usage)) {
    throw new TypeError(`CryptoKey does not support this operation, its usages must include ${usage}.`);
  }
}
__name(checkUsage, "checkUsage");
function checkSigCryptoKey(key, alg, usage) {
  switch (alg) {
    case "HS256":
    case "HS384":
    case "HS512": {
      if (!isAlgorithm(key.algorithm, "HMAC"))
        throw unusable("HMAC");
      checkHashLength(key.algorithm, parseInt(alg.slice(2), 10));
      break;
    }
    case "RS256":
    case "RS384":
    case "RS512": {
      if (!isAlgorithm(key.algorithm, "RSASSA-PKCS1-v1_5"))
        throw unusable("RSASSA-PKCS1-v1_5");
      checkHashLength(key.algorithm, parseInt(alg.slice(2), 10));
      break;
    }
    case "PS256":
    case "PS384":
    case "PS512": {
      if (!isAlgorithm(key.algorithm, "RSA-PSS"))
        throw unusable("RSA-PSS");
      checkHashLength(key.algorithm, parseInt(alg.slice(2), 10));
      break;
    }
    case "Ed25519":
    case "EdDSA": {
      if (!isAlgorithm(key.algorithm, "Ed25519"))
        throw unusable("Ed25519");
      break;
    }
    case "ML-DSA-44":
    case "ML-DSA-65":
    case "ML-DSA-87": {
      if (!isAlgorithm(key.algorithm, alg))
        throw unusable(alg);
      break;
    }
    case "ES256":
    case "ES384":
    case "ES512": {
      if (!isAlgorithm(key.algorithm, "ECDSA"))
        throw unusable("ECDSA");
      const expected = getNamedCurve(alg);
      const actual = key.algorithm.namedCurve;
      if (actual !== expected)
        throw unusable(expected, "algorithm.namedCurve");
      break;
    }
    default:
      throw new TypeError("CryptoKey does not support this operation");
  }
  checkUsage(key, usage);
}
__name(checkSigCryptoKey, "checkSigCryptoKey");

// ../../node_modules/.pnpm/jose@6.2.3/node_modules/jose/dist/webapi/lib/invalid_key_input.js
function message(msg, actual, ...types) {
  types = types.filter(Boolean);
  if (types.length > 2) {
    const last = types.pop();
    msg += `one of type ${types.join(", ")}, or ${last}.`;
  } else if (types.length === 2) {
    msg += `one of type ${types[0]} or ${types[1]}.`;
  } else {
    msg += `of type ${types[0]}.`;
  }
  if (actual == null) {
    msg += ` Received ${actual}`;
  } else if (typeof actual === "function" && actual.name) {
    msg += ` Received function ${actual.name}`;
  } else if (typeof actual === "object" && actual != null) {
    if (actual.constructor?.name) {
      msg += ` Received an instance of ${actual.constructor.name}`;
    }
  }
  return msg;
}
__name(message, "message");
var invalidKeyInput = /* @__PURE__ */ __name((actual, ...types) => message("Key must be ", actual, ...types), "invalidKeyInput");
var withAlg = /* @__PURE__ */ __name((alg, actual, ...types) => message(`Key for the ${alg} algorithm must be `, actual, ...types), "withAlg");

// ../../node_modules/.pnpm/jose@6.2.3/node_modules/jose/dist/webapi/util/errors.js
var JOSEError = class extends Error {
  static {
    __name(this, "JOSEError");
  }
  static code = "ERR_JOSE_GENERIC";
  code = "ERR_JOSE_GENERIC";
  constructor(message2, options) {
    super(message2, options);
    this.name = this.constructor.name;
    Error.captureStackTrace?.(this, this.constructor);
  }
};
var JWTClaimValidationFailed = class extends JOSEError {
  static {
    __name(this, "JWTClaimValidationFailed");
  }
  static code = "ERR_JWT_CLAIM_VALIDATION_FAILED";
  code = "ERR_JWT_CLAIM_VALIDATION_FAILED";
  claim;
  reason;
  payload;
  constructor(message2, payload, claim = "unspecified", reason = "unspecified") {
    super(message2, { cause: { claim, reason, payload } });
    this.claim = claim;
    this.reason = reason;
    this.payload = payload;
  }
};
var JWTExpired = class extends JOSEError {
  static {
    __name(this, "JWTExpired");
  }
  static code = "ERR_JWT_EXPIRED";
  code = "ERR_JWT_EXPIRED";
  claim;
  reason;
  payload;
  constructor(message2, payload, claim = "unspecified", reason = "unspecified") {
    super(message2, { cause: { claim, reason, payload } });
    this.claim = claim;
    this.reason = reason;
    this.payload = payload;
  }
};
var JOSEAlgNotAllowed = class extends JOSEError {
  static {
    __name(this, "JOSEAlgNotAllowed");
  }
  static code = "ERR_JOSE_ALG_NOT_ALLOWED";
  code = "ERR_JOSE_ALG_NOT_ALLOWED";
};
var JOSENotSupported = class extends JOSEError {
  static {
    __name(this, "JOSENotSupported");
  }
  static code = "ERR_JOSE_NOT_SUPPORTED";
  code = "ERR_JOSE_NOT_SUPPORTED";
};
var JWSInvalid = class extends JOSEError {
  static {
    __name(this, "JWSInvalid");
  }
  static code = "ERR_JWS_INVALID";
  code = "ERR_JWS_INVALID";
};
var JWTInvalid = class extends JOSEError {
  static {
    __name(this, "JWTInvalid");
  }
  static code = "ERR_JWT_INVALID";
  code = "ERR_JWT_INVALID";
};
var JWKSInvalid = class extends JOSEError {
  static {
    __name(this, "JWKSInvalid");
  }
  static code = "ERR_JWKS_INVALID";
  code = "ERR_JWKS_INVALID";
};
var JWKSNoMatchingKey = class extends JOSEError {
  static {
    __name(this, "JWKSNoMatchingKey");
  }
  static code = "ERR_JWKS_NO_MATCHING_KEY";
  code = "ERR_JWKS_NO_MATCHING_KEY";
  constructor(message2 = "no applicable key found in the JSON Web Key Set", options) {
    super(message2, options);
  }
};
var JWKSMultipleMatchingKeys = class extends JOSEError {
  static {
    __name(this, "JWKSMultipleMatchingKeys");
  }
  [Symbol.asyncIterator];
  static code = "ERR_JWKS_MULTIPLE_MATCHING_KEYS";
  code = "ERR_JWKS_MULTIPLE_MATCHING_KEYS";
  constructor(message2 = "multiple matching keys found in the JSON Web Key Set", options) {
    super(message2, options);
  }
};
var JWKSTimeout = class extends JOSEError {
  static {
    __name(this, "JWKSTimeout");
  }
  static code = "ERR_JWKS_TIMEOUT";
  code = "ERR_JWKS_TIMEOUT";
  constructor(message2 = "request timed out", options) {
    super(message2, options);
  }
};
var JWSSignatureVerificationFailed = class extends JOSEError {
  static {
    __name(this, "JWSSignatureVerificationFailed");
  }
  static code = "ERR_JWS_SIGNATURE_VERIFICATION_FAILED";
  code = "ERR_JWS_SIGNATURE_VERIFICATION_FAILED";
  constructor(message2 = "signature verification failed", options) {
    super(message2, options);
  }
};

// ../../node_modules/.pnpm/jose@6.2.3/node_modules/jose/dist/webapi/lib/is_key_like.js
var isCryptoKey = /* @__PURE__ */ __name((key) => {
  if (key?.[Symbol.toStringTag] === "CryptoKey")
    return true;
  try {
    return key instanceof CryptoKey;
  } catch {
    return false;
  }
}, "isCryptoKey");
var isKeyObject = /* @__PURE__ */ __name((key) => key?.[Symbol.toStringTag] === "KeyObject", "isKeyObject");
var isKeyLike = /* @__PURE__ */ __name((key) => isCryptoKey(key) || isKeyObject(key), "isKeyLike");

// ../../node_modules/.pnpm/jose@6.2.3/node_modules/jose/dist/webapi/lib/helpers.js
function decodeBase64url(value, label, ErrorClass) {
  try {
    return decode(value);
  } catch {
    throw new ErrorClass(`Failed to base64url decode the ${label}`);
  }
}
__name(decodeBase64url, "decodeBase64url");

// ../../node_modules/.pnpm/jose@6.2.3/node_modules/jose/dist/webapi/lib/type_checks.js
var isObjectLike = /* @__PURE__ */ __name((value) => typeof value === "object" && value !== null, "isObjectLike");
function isObject(input) {
  if (!isObjectLike(input) || Object.prototype.toString.call(input) !== "[object Object]") {
    return false;
  }
  if (Object.getPrototypeOf(input) === null) {
    return true;
  }
  let proto = input;
  while (Object.getPrototypeOf(proto) !== null) {
    proto = Object.getPrototypeOf(proto);
  }
  return Object.getPrototypeOf(input) === proto;
}
__name(isObject, "isObject");
function isDisjoint(...headers) {
  const sources = headers.filter(Boolean);
  if (sources.length === 0 || sources.length === 1) {
    return true;
  }
  let acc;
  for (const header of sources) {
    const parameters = Object.keys(header);
    if (!acc || acc.size === 0) {
      acc = new Set(parameters);
      continue;
    }
    for (const parameter of parameters) {
      if (acc.has(parameter)) {
        return false;
      }
      acc.add(parameter);
    }
  }
  return true;
}
__name(isDisjoint, "isDisjoint");
var isJWK = /* @__PURE__ */ __name((key) => isObject(key) && typeof key.kty === "string", "isJWK");
var isPrivateJWK = /* @__PURE__ */ __name((key) => key.kty !== "oct" && (key.kty === "AKP" && typeof key.priv === "string" || typeof key.d === "string"), "isPrivateJWK");
var isPublicJWK = /* @__PURE__ */ __name((key) => key.kty !== "oct" && key.d === void 0 && key.priv === void 0, "isPublicJWK");
var isSecretJWK = /* @__PURE__ */ __name((key) => key.kty === "oct" && typeof key.k === "string", "isSecretJWK");

// ../../node_modules/.pnpm/jose@6.2.3/node_modules/jose/dist/webapi/lib/signing.js
function checkKeyLength(alg, key) {
  if (alg.startsWith("RS") || alg.startsWith("PS")) {
    const { modulusLength } = key.algorithm;
    if (typeof modulusLength !== "number" || modulusLength < 2048) {
      throw new TypeError(`${alg} requires key modulusLength to be 2048 bits or larger`);
    }
  }
}
__name(checkKeyLength, "checkKeyLength");
function subtleAlgorithm(alg, algorithm) {
  const hash = `SHA-${alg.slice(-3)}`;
  switch (alg) {
    case "HS256":
    case "HS384":
    case "HS512":
      return { hash, name: "HMAC" };
    case "PS256":
    case "PS384":
    case "PS512":
      return { hash, name: "RSA-PSS", saltLength: parseInt(alg.slice(-3), 10) >> 3 };
    case "RS256":
    case "RS384":
    case "RS512":
      return { hash, name: "RSASSA-PKCS1-v1_5" };
    case "ES256":
    case "ES384":
    case "ES512":
      return { hash, name: "ECDSA", namedCurve: algorithm.namedCurve };
    case "Ed25519":
    case "EdDSA":
      return { name: "Ed25519" };
    case "ML-DSA-44":
    case "ML-DSA-65":
    case "ML-DSA-87":
      return { name: alg };
    default:
      throw new JOSENotSupported(`alg ${alg} is not supported either by JOSE or your javascript runtime`);
  }
}
__name(subtleAlgorithm, "subtleAlgorithm");
async function getSigKey(alg, key, usage) {
  if (key instanceof Uint8Array) {
    if (!alg.startsWith("HS")) {
      throw new TypeError(invalidKeyInput(key, "CryptoKey", "KeyObject", "JSON Web Key"));
    }
    return crypto.subtle.importKey("raw", key, { hash: `SHA-${alg.slice(-3)}`, name: "HMAC" }, false, [usage]);
  }
  checkSigCryptoKey(key, alg, usage);
  return key;
}
__name(getSigKey, "getSigKey");
async function verify(alg, key, signature, data) {
  const cryptoKey = await getSigKey(alg, key, "verify");
  checkKeyLength(alg, cryptoKey);
  const algorithm = subtleAlgorithm(alg, cryptoKey.algorithm);
  try {
    return await crypto.subtle.verify(algorithm, cryptoKey, signature, data);
  } catch {
    return false;
  }
}
__name(verify, "verify");

// ../../node_modules/.pnpm/jose@6.2.3/node_modules/jose/dist/webapi/lib/jwk_to_key.js
var unsupportedAlg = 'Invalid or unsupported JWK "alg" (Algorithm) Parameter value';
function subtleMapping(jwk) {
  let algorithm;
  let keyUsages;
  switch (jwk.kty) {
    case "AKP": {
      switch (jwk.alg) {
        case "ML-DSA-44":
        case "ML-DSA-65":
        case "ML-DSA-87":
          algorithm = { name: jwk.alg };
          keyUsages = jwk.priv ? ["sign"] : ["verify"];
          break;
        default:
          throw new JOSENotSupported(unsupportedAlg);
      }
      break;
    }
    case "RSA": {
      switch (jwk.alg) {
        case "PS256":
        case "PS384":
        case "PS512":
          algorithm = { name: "RSA-PSS", hash: `SHA-${jwk.alg.slice(-3)}` };
          keyUsages = jwk.d ? ["sign"] : ["verify"];
          break;
        case "RS256":
        case "RS384":
        case "RS512":
          algorithm = { name: "RSASSA-PKCS1-v1_5", hash: `SHA-${jwk.alg.slice(-3)}` };
          keyUsages = jwk.d ? ["sign"] : ["verify"];
          break;
        case "RSA-OAEP":
        case "RSA-OAEP-256":
        case "RSA-OAEP-384":
        case "RSA-OAEP-512":
          algorithm = {
            name: "RSA-OAEP",
            hash: `SHA-${parseInt(jwk.alg.slice(-3), 10) || 1}`
          };
          keyUsages = jwk.d ? ["decrypt", "unwrapKey"] : ["encrypt", "wrapKey"];
          break;
        default:
          throw new JOSENotSupported(unsupportedAlg);
      }
      break;
    }
    case "EC": {
      switch (jwk.alg) {
        case "ES256":
        case "ES384":
        case "ES512":
          algorithm = {
            name: "ECDSA",
            namedCurve: { ES256: "P-256", ES384: "P-384", ES512: "P-521" }[jwk.alg]
          };
          keyUsages = jwk.d ? ["sign"] : ["verify"];
          break;
        case "ECDH-ES":
        case "ECDH-ES+A128KW":
        case "ECDH-ES+A192KW":
        case "ECDH-ES+A256KW":
          algorithm = { name: "ECDH", namedCurve: jwk.crv };
          keyUsages = jwk.d ? ["deriveBits"] : [];
          break;
        default:
          throw new JOSENotSupported(unsupportedAlg);
      }
      break;
    }
    case "OKP": {
      switch (jwk.alg) {
        case "Ed25519":
        case "EdDSA":
          algorithm = { name: "Ed25519" };
          keyUsages = jwk.d ? ["sign"] : ["verify"];
          break;
        case "ECDH-ES":
        case "ECDH-ES+A128KW":
        case "ECDH-ES+A192KW":
        case "ECDH-ES+A256KW":
          algorithm = { name: jwk.crv };
          keyUsages = jwk.d ? ["deriveBits"] : [];
          break;
        default:
          throw new JOSENotSupported(unsupportedAlg);
      }
      break;
    }
    default:
      throw new JOSENotSupported('Invalid or unsupported JWK "kty" (Key Type) Parameter value');
  }
  return { algorithm, keyUsages };
}
__name(subtleMapping, "subtleMapping");
async function jwkToKey(jwk) {
  if (!jwk.alg) {
    throw new TypeError('"alg" argument is required when "jwk.alg" is not present');
  }
  const { algorithm, keyUsages } = subtleMapping(jwk);
  const keyData = { ...jwk };
  if (keyData.kty !== "AKP") {
    delete keyData.alg;
  }
  delete keyData.use;
  return crypto.subtle.importKey("jwk", keyData, algorithm, jwk.ext ?? (jwk.d || jwk.priv ? false : true), jwk.key_ops ?? keyUsages);
}
__name(jwkToKey, "jwkToKey");

// ../../node_modules/.pnpm/jose@6.2.3/node_modules/jose/dist/webapi/lib/normalize_key.js
var unusableForAlg = "given KeyObject instance cannot be used for this algorithm";
var cache;
var handleJWK = /* @__PURE__ */ __name(async (key, jwk, alg, freeze = false) => {
  cache ||= /* @__PURE__ */ new WeakMap();
  let cached = cache.get(key);
  if (cached?.[alg]) {
    return cached[alg];
  }
  const cryptoKey = await jwkToKey({ ...jwk, alg });
  if (freeze)
    Object.freeze(key);
  if (!cached) {
    cache.set(key, { [alg]: cryptoKey });
  } else {
    cached[alg] = cryptoKey;
  }
  return cryptoKey;
}, "handleJWK");
var handleKeyObject = /* @__PURE__ */ __name((keyObject, alg) => {
  cache ||= /* @__PURE__ */ new WeakMap();
  let cached = cache.get(keyObject);
  if (cached?.[alg]) {
    return cached[alg];
  }
  const isPublic = keyObject.type === "public";
  const extractable = isPublic ? true : false;
  let cryptoKey;
  if (keyObject.asymmetricKeyType === "x25519") {
    switch (alg) {
      case "ECDH-ES":
      case "ECDH-ES+A128KW":
      case "ECDH-ES+A192KW":
      case "ECDH-ES+A256KW":
        break;
      default:
        throw new TypeError(unusableForAlg);
    }
    cryptoKey = keyObject.toCryptoKey(keyObject.asymmetricKeyType, extractable, isPublic ? [] : ["deriveBits"]);
  }
  if (keyObject.asymmetricKeyType === "ed25519") {
    if (alg !== "EdDSA" && alg !== "Ed25519") {
      throw new TypeError(unusableForAlg);
    }
    cryptoKey = keyObject.toCryptoKey(keyObject.asymmetricKeyType, extractable, [
      isPublic ? "verify" : "sign"
    ]);
  }
  switch (keyObject.asymmetricKeyType) {
    case "ml-dsa-44":
    case "ml-dsa-65":
    case "ml-dsa-87": {
      if (alg !== keyObject.asymmetricKeyType.toUpperCase()) {
        throw new TypeError(unusableForAlg);
      }
      cryptoKey = keyObject.toCryptoKey(keyObject.asymmetricKeyType, extractable, [
        isPublic ? "verify" : "sign"
      ]);
    }
  }
  if (keyObject.asymmetricKeyType === "rsa") {
    let hash;
    switch (alg) {
      case "RSA-OAEP":
        hash = "SHA-1";
        break;
      case "RS256":
      case "PS256":
      case "RSA-OAEP-256":
        hash = "SHA-256";
        break;
      case "RS384":
      case "PS384":
      case "RSA-OAEP-384":
        hash = "SHA-384";
        break;
      case "RS512":
      case "PS512":
      case "RSA-OAEP-512":
        hash = "SHA-512";
        break;
      default:
        throw new TypeError(unusableForAlg);
    }
    if (alg.startsWith("RSA-OAEP")) {
      return keyObject.toCryptoKey({
        name: "RSA-OAEP",
        hash
      }, extractable, isPublic ? ["encrypt"] : ["decrypt"]);
    }
    cryptoKey = keyObject.toCryptoKey({
      name: alg.startsWith("PS") ? "RSA-PSS" : "RSASSA-PKCS1-v1_5",
      hash
    }, extractable, [isPublic ? "verify" : "sign"]);
  }
  if (keyObject.asymmetricKeyType === "ec") {
    const nist = /* @__PURE__ */ new Map([
      ["prime256v1", "P-256"],
      ["secp384r1", "P-384"],
      ["secp521r1", "P-521"]
    ]);
    const namedCurve = nist.get(keyObject.asymmetricKeyDetails?.namedCurve);
    if (!namedCurve) {
      throw new TypeError(unusableForAlg);
    }
    const expectedCurve = { ES256: "P-256", ES384: "P-384", ES512: "P-521" };
    if (expectedCurve[alg] && namedCurve === expectedCurve[alg]) {
      cryptoKey = keyObject.toCryptoKey({
        name: "ECDSA",
        namedCurve
      }, extractable, [isPublic ? "verify" : "sign"]);
    }
    if (alg.startsWith("ECDH-ES")) {
      cryptoKey = keyObject.toCryptoKey({
        name: "ECDH",
        namedCurve
      }, extractable, isPublic ? [] : ["deriveBits"]);
    }
  }
  if (!cryptoKey) {
    throw new TypeError(unusableForAlg);
  }
  if (!cached) {
    cache.set(keyObject, { [alg]: cryptoKey });
  } else {
    cached[alg] = cryptoKey;
  }
  return cryptoKey;
}, "handleKeyObject");
async function normalizeKey(key, alg) {
  if (key instanceof Uint8Array) {
    return key;
  }
  if (isCryptoKey(key)) {
    return key;
  }
  if (isKeyObject(key)) {
    if (key.type === "secret") {
      return key.export();
    }
    if ("toCryptoKey" in key && typeof key.toCryptoKey === "function") {
      try {
        return handleKeyObject(key, alg);
      } catch (err) {
        if (err instanceof TypeError) {
          throw err;
        }
      }
    }
    let jwk = key.export({ format: "jwk" });
    return handleJWK(key, jwk, alg);
  }
  if (isJWK(key)) {
    if (key.k) {
      return decode(key.k);
    }
    return handleJWK(key, key, alg, true);
  }
  throw new Error("unreachable");
}
__name(normalizeKey, "normalizeKey");

// ../../node_modules/.pnpm/jose@6.2.3/node_modules/jose/dist/webapi/key/import.js
async function importJWK(jwk, alg, options) {
  if (!isObject(jwk)) {
    throw new TypeError("JWK must be an object");
  }
  let ext;
  alg ??= jwk.alg;
  ext ??= options?.extractable ?? jwk.ext;
  switch (jwk.kty) {
    case "oct":
      if (typeof jwk.k !== "string" || !jwk.k) {
        throw new TypeError('missing "k" (Key Value) Parameter value');
      }
      return decode(jwk.k);
    case "RSA":
      if ("oth" in jwk && jwk.oth !== void 0) {
        throw new JOSENotSupported('RSA JWK "oth" (Other Primes Info) Parameter value is not supported');
      }
      return jwkToKey({ ...jwk, alg, ext });
    case "AKP": {
      if (typeof jwk.alg !== "string" || !jwk.alg) {
        throw new TypeError('missing "alg" (Algorithm) Parameter value');
      }
      if (alg !== void 0 && alg !== jwk.alg) {
        throw new TypeError("JWK alg and alg option value mismatch");
      }
      return jwkToKey({ ...jwk, ext });
    }
    case "EC":
    case "OKP":
      return jwkToKey({ ...jwk, alg, ext });
    default:
      throw new JOSENotSupported('Unsupported "kty" (Key Type) Parameter value');
  }
}
__name(importJWK, "importJWK");

// ../../node_modules/.pnpm/jose@6.2.3/node_modules/jose/dist/webapi/lib/validate_crit.js
function validateCrit(Err, recognizedDefault, recognizedOption, protectedHeader, joseHeader) {
  if (joseHeader.crit !== void 0 && protectedHeader?.crit === void 0) {
    throw new Err('"crit" (Critical) Header Parameter MUST be integrity protected');
  }
  if (!protectedHeader || protectedHeader.crit === void 0) {
    return /* @__PURE__ */ new Set();
  }
  if (!Array.isArray(protectedHeader.crit) || protectedHeader.crit.length === 0 || protectedHeader.crit.some((input) => typeof input !== "string" || input.length === 0)) {
    throw new Err('"crit" (Critical) Header Parameter MUST be an array of non-empty strings when present');
  }
  let recognized;
  if (recognizedOption !== void 0) {
    recognized = new Map([...Object.entries(recognizedOption), ...recognizedDefault.entries()]);
  } else {
    recognized = recognizedDefault;
  }
  for (const parameter of protectedHeader.crit) {
    if (!recognized.has(parameter)) {
      throw new JOSENotSupported(`Extension Header Parameter "${parameter}" is not recognized`);
    }
    if (joseHeader[parameter] === void 0) {
      throw new Err(`Extension Header Parameter "${parameter}" is missing`);
    }
    if (recognized.get(parameter) && protectedHeader[parameter] === void 0) {
      throw new Err(`Extension Header Parameter "${parameter}" MUST be integrity protected`);
    }
  }
  return new Set(protectedHeader.crit);
}
__name(validateCrit, "validateCrit");

// ../../node_modules/.pnpm/jose@6.2.3/node_modules/jose/dist/webapi/lib/validate_algorithms.js
function validateAlgorithms(option, algorithms) {
  if (algorithms !== void 0 && (!Array.isArray(algorithms) || algorithms.some((s) => typeof s !== "string"))) {
    throw new TypeError(`"${option}" option must be an array of strings`);
  }
  if (!algorithms) {
    return void 0;
  }
  return new Set(algorithms);
}
__name(validateAlgorithms, "validateAlgorithms");

// ../../node_modules/.pnpm/jose@6.2.3/node_modules/jose/dist/webapi/lib/check_key_type.js
var tag = /* @__PURE__ */ __name((key) => key?.[Symbol.toStringTag], "tag");
var jwkMatchesOp = /* @__PURE__ */ __name((alg, key, usage) => {
  if (key.use !== void 0) {
    let expected;
    switch (usage) {
      case "sign":
      case "verify":
        expected = "sig";
        break;
      case "encrypt":
      case "decrypt":
        expected = "enc";
        break;
    }
    if (key.use !== expected) {
      throw new TypeError(`Invalid key for this operation, its "use" must be "${expected}" when present`);
    }
  }
  if (key.alg !== void 0 && key.alg !== alg) {
    throw new TypeError(`Invalid key for this operation, its "alg" must be "${alg}" when present`);
  }
  if (Array.isArray(key.key_ops)) {
    let expectedKeyOp;
    switch (true) {
      case (usage === "sign" || usage === "verify"):
      case alg === "dir":
      case alg.includes("CBC-HS"):
        expectedKeyOp = usage;
        break;
      case alg.startsWith("PBES2"):
        expectedKeyOp = "deriveBits";
        break;
      case /^A\d{3}(?:GCM)?(?:KW)?$/.test(alg):
        if (!alg.includes("GCM") && alg.endsWith("KW")) {
          expectedKeyOp = usage === "encrypt" ? "wrapKey" : "unwrapKey";
        } else {
          expectedKeyOp = usage;
        }
        break;
      case (usage === "encrypt" && alg.startsWith("RSA")):
        expectedKeyOp = "wrapKey";
        break;
      case usage === "decrypt":
        expectedKeyOp = alg.startsWith("RSA") ? "unwrapKey" : "deriveBits";
        break;
    }
    if (expectedKeyOp && key.key_ops?.includes?.(expectedKeyOp) === false) {
      throw new TypeError(`Invalid key for this operation, its "key_ops" must include "${expectedKeyOp}" when present`);
    }
  }
  return true;
}, "jwkMatchesOp");
var symmetricTypeCheck = /* @__PURE__ */ __name((alg, key, usage) => {
  if (key instanceof Uint8Array)
    return;
  if (isJWK(key)) {
    if (isSecretJWK(key) && jwkMatchesOp(alg, key, usage))
      return;
    throw new TypeError(`JSON Web Key for symmetric algorithms must have JWK "kty" (Key Type) equal to "oct" and the JWK "k" (Key Value) present`);
  }
  if (!isKeyLike(key)) {
    throw new TypeError(withAlg(alg, key, "CryptoKey", "KeyObject", "JSON Web Key", "Uint8Array"));
  }
  if (key.type !== "secret") {
    throw new TypeError(`${tag(key)} instances for symmetric algorithms must be of type "secret"`);
  }
}, "symmetricTypeCheck");
var asymmetricTypeCheck = /* @__PURE__ */ __name((alg, key, usage) => {
  if (isJWK(key)) {
    switch (usage) {
      case "decrypt":
      case "sign":
        if (isPrivateJWK(key) && jwkMatchesOp(alg, key, usage))
          return;
        throw new TypeError(`JSON Web Key for this operation must be a private JWK`);
      case "encrypt":
      case "verify":
        if (isPublicJWK(key) && jwkMatchesOp(alg, key, usage))
          return;
        throw new TypeError(`JSON Web Key for this operation must be a public JWK`);
    }
  }
  if (!isKeyLike(key)) {
    throw new TypeError(withAlg(alg, key, "CryptoKey", "KeyObject", "JSON Web Key"));
  }
  if (key.type === "secret") {
    throw new TypeError(`${tag(key)} instances for asymmetric algorithms must not be of type "secret"`);
  }
  if (key.type === "public") {
    switch (usage) {
      case "sign":
        throw new TypeError(`${tag(key)} instances for asymmetric algorithm signing must be of type "private"`);
      case "decrypt":
        throw new TypeError(`${tag(key)} instances for asymmetric algorithm decryption must be of type "private"`);
    }
  }
  if (key.type === "private") {
    switch (usage) {
      case "verify":
        throw new TypeError(`${tag(key)} instances for asymmetric algorithm verifying must be of type "public"`);
      case "encrypt":
        throw new TypeError(`${tag(key)} instances for asymmetric algorithm encryption must be of type "public"`);
    }
  }
}, "asymmetricTypeCheck");
function checkKeyType(alg, key, usage) {
  switch (alg.substring(0, 2)) {
    case "A1":
    case "A2":
    case "di":
    case "HS":
    case "PB":
      symmetricTypeCheck(alg, key, usage);
      break;
    default:
      asymmetricTypeCheck(alg, key, usage);
  }
}
__name(checkKeyType, "checkKeyType");

// ../../node_modules/.pnpm/jose@6.2.3/node_modules/jose/dist/webapi/jws/flattened/verify.js
async function flattenedVerify(jws, key, options) {
  if (!isObject(jws)) {
    throw new JWSInvalid("Flattened JWS must be an object");
  }
  if (jws.protected === void 0 && jws.header === void 0) {
    throw new JWSInvalid('Flattened JWS must have either of the "protected" or "header" members');
  }
  if (jws.protected !== void 0 && typeof jws.protected !== "string") {
    throw new JWSInvalid("JWS Protected Header incorrect type");
  }
  if (jws.payload === void 0) {
    throw new JWSInvalid("JWS Payload missing");
  }
  if (typeof jws.signature !== "string") {
    throw new JWSInvalid("JWS Signature missing or incorrect type");
  }
  if (jws.header !== void 0 && !isObject(jws.header)) {
    throw new JWSInvalid("JWS Unprotected Header incorrect type");
  }
  let parsedProt = {};
  if (jws.protected) {
    try {
      const protectedHeader = decode(jws.protected);
      parsedProt = JSON.parse(decoder.decode(protectedHeader));
    } catch {
      throw new JWSInvalid("JWS Protected Header is invalid");
    }
  }
  if (!isDisjoint(parsedProt, jws.header)) {
    throw new JWSInvalid("JWS Protected and JWS Unprotected Header Parameter names must be disjoint");
  }
  const joseHeader = {
    ...parsedProt,
    ...jws.header
  };
  const extensions = validateCrit(JWSInvalid, /* @__PURE__ */ new Map([["b64", true]]), options?.crit, parsedProt, joseHeader);
  let b64 = true;
  if (extensions.has("b64")) {
    b64 = parsedProt.b64;
    if (typeof b64 !== "boolean") {
      throw new JWSInvalid('The "b64" (base64url-encode payload) Header Parameter must be a boolean');
    }
  }
  const { alg } = joseHeader;
  if (typeof alg !== "string" || !alg) {
    throw new JWSInvalid('JWS "alg" (Algorithm) Header Parameter missing or invalid');
  }
  const algorithms = options && validateAlgorithms("algorithms", options.algorithms);
  if (algorithms && !algorithms.has(alg)) {
    throw new JOSEAlgNotAllowed('"alg" (Algorithm) Header Parameter value not allowed');
  }
  if (b64) {
    if (typeof jws.payload !== "string") {
      throw new JWSInvalid("JWS Payload must be a string");
    }
  } else if (typeof jws.payload !== "string" && !(jws.payload instanceof Uint8Array)) {
    throw new JWSInvalid("JWS Payload must be a string or an Uint8Array instance");
  }
  let resolvedKey = false;
  if (typeof key === "function") {
    key = await key(parsedProt, jws);
    resolvedKey = true;
  }
  checkKeyType(alg, key, "verify");
  const data = concat(jws.protected !== void 0 ? encode(jws.protected) : new Uint8Array(), encode("."), typeof jws.payload === "string" ? b64 ? encode(jws.payload) : encoder.encode(jws.payload) : jws.payload);
  const signature = decodeBase64url(jws.signature, "signature", JWSInvalid);
  const k = await normalizeKey(key, alg);
  const verified = await verify(alg, k, signature, data);
  if (!verified) {
    throw new JWSSignatureVerificationFailed();
  }
  let payload;
  if (b64) {
    payload = decodeBase64url(jws.payload, "payload", JWSInvalid);
  } else if (typeof jws.payload === "string") {
    payload = encoder.encode(jws.payload);
  } else {
    payload = jws.payload;
  }
  const result = { payload };
  if (jws.protected !== void 0) {
    result.protectedHeader = parsedProt;
  }
  if (jws.header !== void 0) {
    result.unprotectedHeader = jws.header;
  }
  if (resolvedKey) {
    return { ...result, key: k };
  }
  return result;
}
__name(flattenedVerify, "flattenedVerify");

// ../../node_modules/.pnpm/jose@6.2.3/node_modules/jose/dist/webapi/jws/compact/verify.js
async function compactVerify(jws, key, options) {
  if (jws instanceof Uint8Array) {
    jws = decoder.decode(jws);
  }
  if (typeof jws !== "string") {
    throw new JWSInvalid("Compact JWS must be a string or Uint8Array");
  }
  const { 0: protectedHeader, 1: payload, 2: signature, length } = jws.split(".");
  if (length !== 3) {
    throw new JWSInvalid("Invalid Compact JWS");
  }
  const verified = await flattenedVerify({ payload, protected: protectedHeader, signature }, key, options);
  const result = { payload: verified.payload, protectedHeader: verified.protectedHeader };
  if (typeof key === "function") {
    return { ...result, key: verified.key };
  }
  return result;
}
__name(compactVerify, "compactVerify");

// ../../node_modules/.pnpm/jose@6.2.3/node_modules/jose/dist/webapi/lib/jwt_claims_set.js
var epoch = /* @__PURE__ */ __name((date) => Math.floor(date.getTime() / 1e3), "epoch");
var minute = 60;
var hour = minute * 60;
var day = hour * 24;
var week = day * 7;
var year = day * 365.25;
var REGEX = /^(\+|\-)? ?(\d+|\d+\.\d+) ?(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)(?: (ago|from now))?$/i;
function secs(str) {
  const matched = REGEX.exec(str);
  if (!matched || matched[4] && matched[1]) {
    throw new TypeError("Invalid time period format");
  }
  const value = parseFloat(matched[2]);
  const unit = matched[3].toLowerCase();
  let numericDate;
  switch (unit) {
    case "sec":
    case "secs":
    case "second":
    case "seconds":
    case "s":
      numericDate = Math.round(value);
      break;
    case "minute":
    case "minutes":
    case "min":
    case "mins":
    case "m":
      numericDate = Math.round(value * minute);
      break;
    case "hour":
    case "hours":
    case "hr":
    case "hrs":
    case "h":
      numericDate = Math.round(value * hour);
      break;
    case "day":
    case "days":
    case "d":
      numericDate = Math.round(value * day);
      break;
    case "week":
    case "weeks":
    case "w":
      numericDate = Math.round(value * week);
      break;
    default:
      numericDate = Math.round(value * year);
      break;
  }
  if (matched[1] === "-" || matched[4] === "ago") {
    return -numericDate;
  }
  return numericDate;
}
__name(secs, "secs");
var normalizeTyp = /* @__PURE__ */ __name((value) => {
  if (value.includes("/")) {
    return value.toLowerCase();
  }
  return `application/${value.toLowerCase()}`;
}, "normalizeTyp");
var checkAudiencePresence = /* @__PURE__ */ __name((audPayload, audOption) => {
  if (typeof audPayload === "string") {
    return audOption.includes(audPayload);
  }
  if (Array.isArray(audPayload)) {
    return audOption.some(Set.prototype.has.bind(new Set(audPayload)));
  }
  return false;
}, "checkAudiencePresence");
function validateClaimsSet(protectedHeader, encodedPayload, options = {}) {
  let payload;
  try {
    payload = JSON.parse(decoder.decode(encodedPayload));
  } catch {
  }
  if (!isObject(payload)) {
    throw new JWTInvalid("JWT Claims Set must be a top-level JSON object");
  }
  const { typ } = options;
  if (typ && (typeof protectedHeader.typ !== "string" || normalizeTyp(protectedHeader.typ) !== normalizeTyp(typ))) {
    throw new JWTClaimValidationFailed('unexpected "typ" JWT header value', payload, "typ", "check_failed");
  }
  const { requiredClaims = [], issuer, subject, audience, maxTokenAge } = options;
  const presenceCheck = [...requiredClaims];
  if (maxTokenAge !== void 0)
    presenceCheck.push("iat");
  if (audience !== void 0)
    presenceCheck.push("aud");
  if (subject !== void 0)
    presenceCheck.push("sub");
  if (issuer !== void 0)
    presenceCheck.push("iss");
  for (const claim of new Set(presenceCheck.reverse())) {
    if (!(claim in payload)) {
      throw new JWTClaimValidationFailed(`missing required "${claim}" claim`, payload, claim, "missing");
    }
  }
  if (issuer && !(Array.isArray(issuer) ? issuer : [issuer]).includes(payload.iss)) {
    throw new JWTClaimValidationFailed('unexpected "iss" claim value', payload, "iss", "check_failed");
  }
  if (subject && payload.sub !== subject) {
    throw new JWTClaimValidationFailed('unexpected "sub" claim value', payload, "sub", "check_failed");
  }
  if (audience && !checkAudiencePresence(payload.aud, typeof audience === "string" ? [audience] : audience)) {
    throw new JWTClaimValidationFailed('unexpected "aud" claim value', payload, "aud", "check_failed");
  }
  let tolerance;
  switch (typeof options.clockTolerance) {
    case "string":
      tolerance = secs(options.clockTolerance);
      break;
    case "number":
      tolerance = options.clockTolerance;
      break;
    case "undefined":
      tolerance = 0;
      break;
    default:
      throw new TypeError("Invalid clockTolerance option type");
  }
  const { currentDate } = options;
  const now = epoch(currentDate || /* @__PURE__ */ new Date());
  if ((payload.iat !== void 0 || maxTokenAge) && typeof payload.iat !== "number") {
    throw new JWTClaimValidationFailed('"iat" claim must be a number', payload, "iat", "invalid");
  }
  if (payload.nbf !== void 0) {
    if (typeof payload.nbf !== "number") {
      throw new JWTClaimValidationFailed('"nbf" claim must be a number', payload, "nbf", "invalid");
    }
    if (payload.nbf > now + tolerance) {
      throw new JWTClaimValidationFailed('"nbf" claim timestamp check failed', payload, "nbf", "check_failed");
    }
  }
  if (payload.exp !== void 0) {
    if (typeof payload.exp !== "number") {
      throw new JWTClaimValidationFailed('"exp" claim must be a number', payload, "exp", "invalid");
    }
    if (payload.exp <= now - tolerance) {
      throw new JWTExpired('"exp" claim timestamp check failed', payload, "exp", "check_failed");
    }
  }
  if (maxTokenAge) {
    const age = now - payload.iat;
    const max = typeof maxTokenAge === "number" ? maxTokenAge : secs(maxTokenAge);
    if (age - tolerance > max) {
      throw new JWTExpired('"iat" claim timestamp check failed (too far in the past)', payload, "iat", "check_failed");
    }
    if (age < 0 - tolerance) {
      throw new JWTClaimValidationFailed('"iat" claim timestamp check failed (it should be in the past)', payload, "iat", "check_failed");
    }
  }
  return payload;
}
__name(validateClaimsSet, "validateClaimsSet");

// ../../node_modules/.pnpm/jose@6.2.3/node_modules/jose/dist/webapi/jwt/verify.js
async function jwtVerify(jwt, key, options) {
  const verified = await compactVerify(jwt, key, options);
  if (verified.protectedHeader.crit?.includes("b64") && verified.protectedHeader.b64 === false) {
    throw new JWTInvalid("JWTs MUST NOT use unencoded payload");
  }
  const payload = validateClaimsSet(verified.protectedHeader, verified.payload, options);
  const result = { payload, protectedHeader: verified.protectedHeader };
  if (typeof key === "function") {
    return { ...result, key: verified.key };
  }
  return result;
}
__name(jwtVerify, "jwtVerify");

// ../../node_modules/.pnpm/jose@6.2.3/node_modules/jose/dist/webapi/jwks/local.js
function getKtyFromAlg(alg) {
  switch (typeof alg === "string" && alg.slice(0, 2)) {
    case "RS":
    case "PS":
      return "RSA";
    case "ES":
      return "EC";
    case "Ed":
      return "OKP";
    case "ML":
      return "AKP";
    default:
      throw new JOSENotSupported('Unsupported "alg" value for a JSON Web Key Set');
  }
}
__name(getKtyFromAlg, "getKtyFromAlg");
function isJWKSLike(jwks) {
  return jwks && typeof jwks === "object" && Array.isArray(jwks.keys) && jwks.keys.every(isJWKLike);
}
__name(isJWKSLike, "isJWKSLike");
function isJWKLike(key) {
  return isObject(key);
}
__name(isJWKLike, "isJWKLike");
var LocalJWKSet = class {
  static {
    __name(this, "LocalJWKSet");
  }
  #jwks;
  #cached = /* @__PURE__ */ new WeakMap();
  constructor(jwks) {
    if (!isJWKSLike(jwks)) {
      throw new JWKSInvalid("JSON Web Key Set malformed");
    }
    this.#jwks = structuredClone(jwks);
  }
  jwks() {
    return this.#jwks;
  }
  async getKey(protectedHeader, token) {
    const { alg, kid } = { ...protectedHeader, ...token?.header };
    const kty = getKtyFromAlg(alg);
    const candidates = this.#jwks.keys.filter((jwk2) => {
      let candidate = kty === jwk2.kty;
      if (candidate && typeof kid === "string") {
        candidate = kid === jwk2.kid;
      }
      if (candidate && (typeof jwk2.alg === "string" || kty === "AKP")) {
        candidate = alg === jwk2.alg;
      }
      if (candidate && typeof jwk2.use === "string") {
        candidate = jwk2.use === "sig";
      }
      if (candidate && Array.isArray(jwk2.key_ops)) {
        candidate = jwk2.key_ops.includes("verify");
      }
      if (candidate) {
        switch (alg) {
          case "ES256":
            candidate = jwk2.crv === "P-256";
            break;
          case "ES384":
            candidate = jwk2.crv === "P-384";
            break;
          case "ES512":
            candidate = jwk2.crv === "P-521";
            break;
          case "Ed25519":
          case "EdDSA":
            candidate = jwk2.crv === "Ed25519";
            break;
        }
      }
      return candidate;
    });
    const { 0: jwk, length } = candidates;
    if (length === 0) {
      throw new JWKSNoMatchingKey();
    }
    if (length !== 1) {
      const error = new JWKSMultipleMatchingKeys();
      const _cached = this.#cached;
      error[Symbol.asyncIterator] = async function* () {
        for (const jwk2 of candidates) {
          try {
            yield await importWithAlgCache(_cached, jwk2, alg);
          } catch {
          }
        }
      };
      throw error;
    }
    return importWithAlgCache(this.#cached, jwk, alg);
  }
};
async function importWithAlgCache(cache2, jwk, alg) {
  const cached = cache2.get(jwk) || cache2.set(jwk, {}).get(jwk);
  if (cached[alg] === void 0) {
    const key = await importJWK({ ...jwk, ext: true }, alg);
    if (key instanceof Uint8Array || key.type !== "public") {
      throw new JWKSInvalid("JSON Web Key Set members must be public keys");
    }
    cached[alg] = key;
  }
  return cached[alg];
}
__name(importWithAlgCache, "importWithAlgCache");
function createLocalJWKSet(jwks) {
  const set = new LocalJWKSet(jwks);
  const localJWKSet = /* @__PURE__ */ __name(async (protectedHeader, token) => set.getKey(protectedHeader, token), "localJWKSet");
  Object.defineProperties(localJWKSet, {
    jwks: {
      value: /* @__PURE__ */ __name(() => structuredClone(set.jwks()), "value"),
      enumerable: false,
      configurable: false,
      writable: false
    }
  });
  return localJWKSet;
}
__name(createLocalJWKSet, "createLocalJWKSet");

// ../../node_modules/.pnpm/jose@6.2.3/node_modules/jose/dist/webapi/jwks/remote.js
function isCloudflareWorkers() {
  return typeof WebSocketPair !== "undefined" || typeof navigator !== "undefined" && true || typeof EdgeRuntime !== "undefined" && EdgeRuntime === "vercel";
}
__name(isCloudflareWorkers, "isCloudflareWorkers");
var USER_AGENT;
if (typeof navigator === "undefined" || !"Cloudflare-Workers"?.startsWith?.("Mozilla/5.0 ")) {
  const NAME = "jose";
  const VERSION = "v6.2.3";
  USER_AGENT = `${NAME}/${VERSION}`;
}
var customFetch = /* @__PURE__ */ Symbol();
async function fetchJwks(url, headers, signal, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    method: "GET",
    signal,
    redirect: "manual",
    headers
  }).catch((err) => {
    if (err.name === "TimeoutError") {
      throw new JWKSTimeout();
    }
    throw err;
  });
  if (response.status !== 200) {
    throw new JOSEError("Expected 200 OK from the JSON Web Key Set HTTP response");
  }
  try {
    return await response.json();
  } catch {
    throw new JOSEError("Failed to parse the JSON Web Key Set HTTP response as JSON");
  }
}
__name(fetchJwks, "fetchJwks");
var jwksCache = /* @__PURE__ */ Symbol();
function isFreshJwksCache(input, cacheMaxAge) {
  if (typeof input !== "object" || input === null) {
    return false;
  }
  if (!("uat" in input) || typeof input.uat !== "number" || Date.now() - input.uat >= cacheMaxAge) {
    return false;
  }
  if (!("jwks" in input) || !isObject(input.jwks) || !Array.isArray(input.jwks.keys) || !Array.prototype.every.call(input.jwks.keys, isObject)) {
    return false;
  }
  return true;
}
__name(isFreshJwksCache, "isFreshJwksCache");
var RemoteJWKSet = class {
  static {
    __name(this, "RemoteJWKSet");
  }
  #url;
  #timeoutDuration;
  #cooldownDuration;
  #cacheMaxAge;
  #jwksTimestamp;
  #pendingFetch;
  #headers;
  #customFetch;
  #local;
  #cache;
  constructor(url, options) {
    if (!(url instanceof URL)) {
      throw new TypeError("url must be an instance of URL");
    }
    this.#url = new URL(url.href);
    this.#timeoutDuration = typeof options?.timeoutDuration === "number" ? options?.timeoutDuration : 5e3;
    this.#cooldownDuration = typeof options?.cooldownDuration === "number" ? options?.cooldownDuration : 3e4;
    this.#cacheMaxAge = typeof options?.cacheMaxAge === "number" ? options?.cacheMaxAge : 6e5;
    this.#headers = new Headers(options?.headers);
    if (USER_AGENT && !this.#headers.has("User-Agent")) {
      this.#headers.set("User-Agent", USER_AGENT);
    }
    if (!this.#headers.has("accept")) {
      this.#headers.set("accept", "application/json");
      this.#headers.append("accept", "application/jwk-set+json");
    }
    this.#customFetch = options?.[customFetch];
    if (options?.[jwksCache] !== void 0) {
      this.#cache = options?.[jwksCache];
      if (isFreshJwksCache(options?.[jwksCache], this.#cacheMaxAge)) {
        this.#jwksTimestamp = this.#cache.uat;
        this.#local = createLocalJWKSet(this.#cache.jwks);
      }
    }
  }
  pendingFetch() {
    return !!this.#pendingFetch;
  }
  coolingDown() {
    return typeof this.#jwksTimestamp === "number" ? Date.now() < this.#jwksTimestamp + this.#cooldownDuration : false;
  }
  fresh() {
    return typeof this.#jwksTimestamp === "number" ? Date.now() < this.#jwksTimestamp + this.#cacheMaxAge : false;
  }
  jwks() {
    return this.#local?.jwks();
  }
  async getKey(protectedHeader, token) {
    if (!this.#local || !this.fresh()) {
      await this.reload();
    }
    try {
      return await this.#local(protectedHeader, token);
    } catch (err) {
      if (err instanceof JWKSNoMatchingKey) {
        if (this.coolingDown() === false) {
          await this.reload();
          return this.#local(protectedHeader, token);
        }
      }
      throw err;
    }
  }
  async reload() {
    if (this.#pendingFetch && isCloudflareWorkers()) {
      this.#pendingFetch = void 0;
    }
    this.#pendingFetch ||= fetchJwks(this.#url.href, this.#headers, AbortSignal.timeout(this.#timeoutDuration), this.#customFetch).then((json2) => {
      this.#local = createLocalJWKSet(json2);
      if (this.#cache) {
        this.#cache.uat = Date.now();
        this.#cache.jwks = json2;
      }
      this.#jwksTimestamp = Date.now();
      this.#pendingFetch = void 0;
    }).catch((err) => {
      this.#pendingFetch = void 0;
      throw err;
    });
    await this.#pendingFetch;
  }
};
function createRemoteJWKSet(url, options) {
  const set = new RemoteJWKSet(url, options);
  const remoteJWKSet = /* @__PURE__ */ __name(async (protectedHeader, token) => set.getKey(protectedHeader, token), "remoteJWKSet");
  Object.defineProperties(remoteJWKSet, {
    coolingDown: {
      get: /* @__PURE__ */ __name(() => set.coolingDown(), "get"),
      enumerable: true,
      configurable: false
    },
    fresh: {
      get: /* @__PURE__ */ __name(() => set.fresh(), "get"),
      enumerable: true,
      configurable: false
    },
    reload: {
      value: /* @__PURE__ */ __name(() => set.reload(), "value"),
      enumerable: true,
      configurable: false,
      writable: false
    },
    reloading: {
      get: /* @__PURE__ */ __name(() => set.pendingFetch(), "get"),
      enumerable: true,
      configurable: false
    },
    jwks: {
      value: /* @__PURE__ */ __name(() => set.jwks(), "value"),
      enumerable: true,
      configurable: false,
      writable: false
    }
  });
  return remoteJWKSet;
}
__name(createRemoteJWKSet, "createRemoteJWKSet");

// src/organizer-auth.ts
var MAX_IDENTIFIER_LENGTH = 255;
var ASYMMETRIC_JWT_ALGORITHMS = [
  "RS256",
  "RS384",
  "RS512",
  "PS256",
  "PS384",
  "PS512",
  "ES256",
  "ES384",
  "ES512",
  "EdDSA"
];
var OrganizerAuthError = class extends Error {
  constructor(status, code, message2) {
    super(message2);
    this.status = status;
    this.code = code;
    this.name = "OrganizerAuthError";
  }
  status;
  code;
  static {
    __name(this, "OrganizerAuthError");
  }
};
var cleanIdentifier = /* @__PURE__ */ __name((value) => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_IDENTIFIER_LENGTH) return null;
  if ([...normalized].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code >= 127 && code <= 159;
  })) return null;
  return normalized;
}, "cleanIdentifier");
var authUnavailable = /* @__PURE__ */ __name((message2) => new OrganizerAuthError(503, "organizer_auth_unavailable", message2), "authUnavailable");
var authRequired = /* @__PURE__ */ __name((message2) => new OrganizerAuthError(401, "organizer_auth_required", message2), "authRequired");
var accessDenied = /* @__PURE__ */ __name(() => new OrganizerAuthError(403, "organizer_access_denied", "The organizer is not authorized for this workspace."), "accessDenied");
var requiredHeader = /* @__PURE__ */ __name((request, name) => {
  const value = cleanIdentifier(request.headers.get(name));
  if (!value) throw authRequired(`${name} is required.`);
  return value;
}, "requiredHeader");
function authToken(request) {
  const match = /^Bearer ([^\s]+)$/u.exec(request.headers.get("Authorization")?.trim() ?? "");
  if (!match?.[1]) throw authRequired("A valid Bearer token is required.");
  return match[1];
}
__name(authToken, "authToken");
function auth0Configuration(env) {
  const domain = env.AUTH0_DOMAIN?.trim().replace(/^https?:\/\//u, "").replace(/\/$/u, "") ?? "";
  const audience = env.AUTH0_AUDIENCE?.trim() ?? "";
  if (!domain || !audience) throw authUnavailable("Organizer JWT verification is not configured.");
  const issuer = `https://${domain}/`;
  const jwksUrl = env.AUTH0_JWKS_URL?.trim() || `${issuer}.well-known/jwks.json`;
  try {
    if (new URL(jwksUrl).protocol !== "https:") throw new Error("HTTPS required");
  } catch {
    throw authUnavailable("Organizer JWT JWKS URL is invalid.");
  }
  return { issuer, audience, jwksUrl };
}
__name(auth0Configuration, "auth0Configuration");
var remoteJwks = /* @__PURE__ */ new Map();
var jwksFor = /* @__PURE__ */ __name((url) => {
  const existing = remoteJwks.get(url);
  if (existing) return existing;
  const created = createRemoteJWKSet(new URL(url), {
    cooldownDuration: 3e4,
    cacheMaxAge: 6e5,
    timeoutDuration: 5e3
  });
  remoteJwks.set(url, created);
  return created;
}, "jwksFor");
var verifierUnavailable = /* @__PURE__ */ __name((error) => {
  if (!(error instanceof Error)) return true;
  const code = Reflect.get(error, "code");
  return code === "ERR_JWKS_TIMEOUT" || code === "ERR_JWKS_INVALID" || code === "ERR_JWKS_NO_MATCHING_KEY" || error.name === "TypeError";
}, "verifierUnavailable");
var stringClaim = /* @__PURE__ */ __name((payload, ...names) => {
  for (const name of names) {
    const value = payload[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}, "stringClaim");
async function verifyOrganizerJwt(token, env) {
  const { issuer, audience, jwksUrl } = auth0Configuration(env);
  let payload;
  try {
    payload = (await jwtVerify(token, jwksFor(jwksUrl), {
      issuer,
      audience,
      algorithms: [...ASYMMETRIC_JWT_ALGORITHMS],
      requiredClaims: ["sub", "exp", "iat"],
      clockTolerance: 30
    })).payload;
  } catch (error) {
    if (verifierUnavailable(error)) throw authUnavailable("Organizer JWT verifier is unavailable.");
    throw authRequired("The organizer Bearer token is invalid.");
  }
  const subject = cleanIdentifier(payload.sub);
  if (!subject) throw authRequired("The organizer token has no valid subject.");
  const normalizedAudience = audience.replace(/\/$/u, "");
  return {
    subject,
    email: stringClaim(
      payload,
      "https://zephyr.agency/claims/email",
      "email",
      `${normalizedAudience}/email`
    ),
    emailVerified: payload.email_verified === true || payload[`${normalizedAudience}/email_verified`] === true
  };
}
__name(verifyOrganizerJwt, "verifyOrganizerJwt");
function parseAccessDecision(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw authUnavailable("Workspace authorization returned an invalid response.");
  }
  const record = value;
  if (typeof record.member !== "boolean" || typeof record.allowed !== "boolean") {
    throw authUnavailable("Workspace authorization returned an invalid response.");
  }
  const canonicalUserId = cleanIdentifier(record.canonicalUserId);
  if (record.member && record.allowed && !canonicalUserId) {
    throw authUnavailable("Workspace authorization omitted the canonical TAP user.");
  }
  return { member: record.member, allowed: record.allowed, canonicalUserId };
}
__name(parseAccessDecision, "parseAccessDecision");
async function checkWorkspaceAccessBySubject(identity, workspaceId, env) {
  const binding = env.AUTHZ_API;
  if (!binding || typeof binding.checkWorkspaceAccessBySubject !== "function") {
    throw authUnavailable("Workspace authorization is not configured.");
  }
  try {
    return parseAccessDecision(await binding.checkWorkspaceAccessBySubject({
      organizationId: workspaceId,
      externalSubject: identity.subject,
      email: identity.email,
      emailVerified: identity.emailVerified,
      actions: ["workspace:read"]
    }));
  } catch (error) {
    if (error instanceof OrganizerAuthError) throw error;
    throw authUnavailable("Workspace authorization is unavailable.");
  }
}
__name(checkWorkspaceAccessBySubject, "checkWorkspaceAccessBySubject");
async function resolveOrganizerScope(request, env, dependencies = {}) {
  const workspaceId = requiredHeader(request, "X-TAP-Workspace-Id");
  if (env.LOCAL_DEVELOPMENT === "true") {
    const principalId = requiredHeader(request, "X-TAP-Principal-Id");
    return { userId: principalId, principalId, workspaceId };
  }
  const identity = await (dependencies.verifyJwt ?? verifyOrganizerJwt)(authToken(request), env).catch((error) => {
    if (error instanceof OrganizerAuthError) throw error;
    throw authUnavailable("Organizer JWT verifier is unavailable.");
  });
  const decision = await (dependencies.checkWorkspaceAccessBySubject ?? checkWorkspaceAccessBySubject)(identity, workspaceId, env).catch((error) => {
    if (error instanceof OrganizerAuthError) throw error;
    throw authUnavailable("Workspace authorization is unavailable.");
  });
  if (!decision.member || !decision.allowed || !decision.canonicalUserId) throw accessDenied();
  return {
    userId: decision.canonicalUserId,
    principalId: decision.canonicalUserId,
    workspaceId
  };
}
__name(resolveOrganizerScope, "resolveOrganizerScope");

// src/public-booking-google-provider.ts
var createPublicGoogleBookingProvider = /* @__PURE__ */ __name((service) => ({
  recover(input) {
    return service.recover({
      scope: input.scope,
      destinationCalendarId: input.destinationCalendarId,
      providerEventId: input.operationId,
      requestHash: input.commitProof,
      timeMin: input.startsAt,
      timeMax: input.endsAt
    });
  },
  commit(input) {
    return service.commit({
      scope: input.scope,
      idempotencyKey: input.operationId,
      providerEventId: input.operationId,
      requestHash: input.commitProof,
      destinationCalendarId: input.destinationCalendarId,
      timeMin: input.startsAt,
      timeMax: input.endsAt,
      conflictTimeMin: input.conflictStart,
      conflictTimeMax: input.conflictEnd,
      conflictCalendarIds: input.conflictCalendarIds,
      title: input.title,
      description: input.description || null,
      location: input.location || null,
      bookingKind: input.bookingKind,
      attendeeEmails: [input.guest.email],
      conferenceProvider: input.conferenceProvider,
      expiresAt: input.expiresAt
    });
  }
}), "createPublicGoogleBookingProvider");

// src/public-booking-google-management.ts
var cancellationCommand = /* @__PURE__ */ __name((input) => input.kind === "cancel" && input.newStartsAt === null && input.newEndsAt === null && input.conflictCalendarIds.length === 0 && input.conflictStart === null && input.conflictEnd === null ? {
  scope: input.scope,
  destinationCalendarId: input.destinationCalendarId,
  providerEventId: input.providerBookingId,
  providerOperationId: input.providerOperationId,
  operationId: input.operationId,
  originalCommitHash: input.providerCommitProof,
  cancellationHash: input.mutationProof,
  timeMin: input.startsAt,
  timeMax: input.endsAt,
  bookingStatus: input.bookingStatus
} : null, "cancellationCommand");
var rescheduleCommand = /* @__PURE__ */ __name((input) => input.kind === "reschedule" && input.newStartsAt !== null && input.newEndsAt !== null && input.conflictCalendarIds.length > 0 && input.conflictStart !== null && input.conflictEnd !== null ? {
  scope: input.scope,
  destinationCalendarId: input.destinationCalendarId,
  providerEventId: input.providerBookingId,
  providerOperationId: input.providerOperationId,
  operationId: input.operationId,
  originalCommitHash: input.providerCommitProof,
  rescheduleHash: input.mutationProof,
  originalTimeMin: input.startsAt,
  originalTimeMax: input.endsAt,
  timeMin: input.newStartsAt,
  timeMax: input.newEndsAt,
  conflictCalendarIds: input.conflictCalendarIds,
  conflictTimeMin: input.conflictStart,
  conflictTimeMax: input.conflictEnd,
  bookingStatus: input.bookingStatus
} : null, "rescheduleCommand");
var createPublicGoogleBookingManagementProvider = /* @__PURE__ */ __name((service) => ({
  cancel(input) {
    const command = cancellationCommand(input);
    return command ? service.cancel(command) : Promise.resolve({ status: "uncertain" });
  },
  reschedule(input) {
    const command = rescheduleCommand(input);
    return command ? service.reschedule(command) : Promise.resolve({ status: "uncertain" });
  },
  recover(input) {
    if (input.kind === "cancel") {
      const command2 = cancellationCommand(input);
      return command2 ? service.recoverCancellation(command2) : Promise.resolve({ status: "uncertain" });
    }
    const command = rescheduleCommand(input);
    return command ? service.recoverReschedule(command) : Promise.resolve({ status: "uncertain" });
  }
}), "createPublicGoogleBookingManagementProvider");

// src/public-booking-create.ts
var PUBLIC_BOOKING_SCHEMA_VERSION = "tap.calendar.public-booking.v1";
var TURNSTILE_MAX_AGE_MS = 5 * 60 * 1e3;
var TURNSTILE_FUTURE_SKEW_MS = 60 * 1e3;
var MILLISECONDS_PER_MINUTE2 = 6e4;
var PUBLIC_APPROVAL_HOLD_TTL_MS = 24 * 60 * MILLISECONDS_PER_MINUTE2;
var UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
var MANAGEMENT_TOKEN_PATTERN = /^tapm_v1_[A-Za-z0-9_-]{16,512}$/u;
var BOOKING_REFERENCE_PATTERN = /^[A-Za-z0-9_-]{12,255}$/u;
var PublicBookingCreateError = class extends Error {
  static {
    __name(this, "PublicBookingCreateError");
  }
  status;
  code;
  retryable;
  constructor(status, code, message2, retryable = false) {
    super(message2);
    this.name = "PublicBookingCreateError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
};
var isRecord3 = /* @__PURE__ */ __name((value) => Boolean(value) && typeof value === "object" && !Array.isArray(value), "isRecord");
var exactKeys2 = /* @__PURE__ */ __name((value, expected) => {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index]);
}, "exactKeys");
function parsePublicBookingRequest(value) {
  if (!isRecord3(value) || !exactKeys2(value, ["schemaVersion", "requestId", "slotToken", "guest", "turnstileToken"]) || value.schemaVersion !== PUBLIC_BOOKING_SCHEMA_VERSION || typeof value.requestId !== "string" || !UUID_PATTERN.test(value.requestId) || typeof value.slotToken !== "string" || value.slotToken.length < 16 || value.slotToken.length > 4096 || typeof value.turnstileToken !== "string" || value.turnstileToken.length === 0 || value.turnstileToken.length > 2048 || !isRecord3(value.guest) || !exactKeys2(value.guest, ["name", "email"]) || typeof value.guest.name !== "string" || typeof value.guest.email !== "string") {
    throw new PublicBookingCreateError(
      400,
      "invalid_booking_request",
      "The booking request is invalid."
    );
  }
  return {
    schemaVersion: PUBLIC_BOOKING_SCHEMA_VERSION,
    requestId: value.requestId,
    slotToken: value.slotToken,
    guest: normalizedGuest({ name: value.guest.name, email: value.guest.email }),
    turnstileToken: value.turnstileToken
  };
}
__name(parsePublicBookingRequest, "parsePublicBookingRequest");
var canonicalInstant2 = /* @__PURE__ */ __name((value, field) => {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new PublicBookingCreateError(400, "slot_token_invalid", `${field} is invalid.`);
  }
  const canonical = new Date(parsed).toISOString();
  if (canonical !== value) {
    throw new PublicBookingCreateError(400, "slot_token_invalid", `${field} is invalid.`);
  }
  return canonical;
}, "canonicalInstant");
var sha256 = /* @__PURE__ */ __name(async (value) => {
  const digest2 = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  let binary = "";
  for (const byte of new Uint8Array(digest2)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}, "sha256");
var base32Hex = /* @__PURE__ */ __name((bytes) => {
  const alphabet = "0123456789abcdefghijklmnopqrstuv";
  let accumulator = 0;
  let bits = 0;
  let output = "";
  for (const byte of bytes) {
    accumulator = accumulator << 8 | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += alphabet[accumulator >>> bits & 31];
      accumulator &= (1 << bits) - 1;
    }
  }
  if (bits > 0) output += alphabet[accumulator << 5 - bits & 31];
  return output;
}, "base32Hex");
var digestBytes = /* @__PURE__ */ __name(async (value) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), "digestBytes");
async function publicBookingCoordinationKey(scope) {
  return `tap-public-booking-v1-${base32Hex(await digestBytes(
    `${scope.workspace}\0${scope.principal}`
  ))}`;
}
__name(publicBookingCoordinationKey, "publicBookingCoordinationKey");
async function publicBookingProviderOperationId(scope, destinationCalendarId, idempotencyKey) {
  return `tap${base32Hex(await digestBytes(
    `${scope.workspace}\0${scope.principal}\0${destinationCalendarId}\0${idempotencyKey}`
  ))}`;
}
__name(publicBookingProviderOperationId, "publicBookingProviderOperationId");
var normalizedGuest = /* @__PURE__ */ __name((value) => {
  const name = value.name.trim();
  const email = value.email.trim().toLowerCase();
  if (name.length === 0 || name.length > 160) {
    throw new PublicBookingCreateError(400, "invalid_booking_request", "Enter your name.");
  }
  if (email.length < 3 || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw new PublicBookingCreateError(400, "invalid_booking_request", "Enter a valid email address.");
  }
  return { name, email };
}, "normalizedGuest");
async function publicBookingRequestHash(input) {
  const guest = normalizedGuest(input.guest);
  const conflictCalendarIds = [...new Set(input.page.privateSnapshot.conflictCalendarIds)].sort();
  return sha256(JSON.stringify({
    v: 1,
    pageId: input.page.pageId,
    revisionId: input.slotClaims.revisionId,
    startsAt: canonicalInstant2(input.slotClaims.start, "The selected start time"),
    endsAt: canonicalInstant2(input.slotClaims.end, "The selected end time"),
    guest,
    destinationCalendarId: input.page.privateSnapshot.destinationCalendarId,
    conflictCalendarIds,
    approvalRequired: input.page.publicSnapshot.approvalRequired
  }));
}
__name(publicBookingRequestHash, "publicBookingRequestHash");
var validateTurnstile = /* @__PURE__ */ __name((result, dependencies, now) => {
  const allowedHostnames = new Set(
    dependencies.allowedTurnstileHostnames.map((hostname) => hostname.trim().toLowerCase()).filter(Boolean)
  );
  const challengeAt = result.challengeTimestamp ? Date.parse(result.challengeTimestamp) : Number.NaN;
  if (!result.success || result.action !== dependencies.expectedTurnstileAction || !result.hostname || !allowedHostnames.has(result.hostname.toLowerCase()) || !Number.isFinite(challengeAt) || challengeAt > now + TURNSTILE_FUTURE_SKEW_MS || challengeAt <= now - TURNSTILE_MAX_AGE_MS) {
    throw new PublicBookingCreateError(
      403,
      "turnstile_verification_failed",
      "Security verification expired or could not be confirmed. Try again."
    );
  }
}, "validateTurnstile");
var sameStrings = /* @__PURE__ */ __name((left, right) => {
  const leftSorted = [...new Set(left)].sort();
  const rightSorted = [...new Set(right)].sort();
  return leftSorted.length === rightSorted.length && leftSorted.every((value, index) => value === rightSorted[index]);
}, "sameStrings");
var currentRevisionMatches = /* @__PURE__ */ __name((initiallyResolved, current) => {
  if (!current) return false;
  return current.pageId === initiallyResolved.pageId && current.profileId === initiallyResolved.profileId && current.revisionId === initiallyResolved.revisionId && current.privateSnapshot.workspaceId === initiallyResolved.privateSnapshot.workspaceId && current.privateSnapshot.principalId === initiallyResolved.privateSnapshot.principalId;
}, "currentRevisionMatches");
var isCanonicalInstant = /* @__PURE__ */ __name((value) => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}, "isCanonicalInstant");
var validAttempt = /* @__PURE__ */ __name((attempt, claim, claimKind, approvalRequired) => {
  const validApprovalExpiry = approvalRequired ? typeof attempt.approvalExpiresAt === "string" && isCanonicalInstant(attempt.approvalExpiresAt) && (claimKind === "existing" || attempt.approvalExpiresAt === claim.approvalExpiresAt) : attempt.approvalExpiresAt === null && claim.approvalExpiresAt === null;
  return attempt.idempotencyKey === claim.idempotencyKey && attempt.requestHash === claim.requestHash && attempt.providerOperationId === claim.providerOperationId && attempt.guest.name === claim.guest.name && attempt.guest.email === claim.guest.email && validApprovalExpiry && BOOKING_REFERENCE_PATTERN.test(attempt.bookingReference);
}, "validAttempt");
var validateStoredResponse = /* @__PURE__ */ __name((response, attempt, startsAt, endsAt, expectedManagementOrigin) => {
  let safeManagementUrl = false;
  if (response) {
    try {
      const base = managementBase(expectedManagementOrigin);
      const url = new URL(response.managementUrl);
      safeManagementUrl = url.origin === base.origin && url.pathname === "/manage" && !url.search && /^#tapm_v1_[A-Za-z0-9_-]{16,512}$/u.test(url.hash) && !url.username && !url.password;
    } catch {
      safeManagementUrl = false;
    }
  }
  if (!response || response.schemaVersion !== PUBLIC_BOOKING_SCHEMA_VERSION || response.bookingReference !== attempt.bookingReference || response.startsAt !== startsAt || response.endsAt !== endsAt || response.status !== "confirmed" && response.status !== "pending" || !safeManagementUrl) {
    throw new PublicBookingCreateError(
      503,
      "booking_state_uncertain",
      "This booking could not be confirmed. Retry with the same request.",
      true
    );
  }
  return response;
}, "validateStoredResponse");
var assertReceipt = /* @__PURE__ */ __name((receipt, attempt, startsAt, endsAt, approvalRequired) => {
  if (receipt.operationId !== attempt.providerOperationId || receipt.commitProof !== attempt.requestHash || receipt.startsAt !== startsAt || receipt.endsAt !== endsAt || receipt.providerBookingId.length === 0 || receipt.providerBookingId.length > 2048 || receipt.status !== (approvalRequired ? "tentative" : "confirmed")) {
    throw new PublicBookingCreateError(
      503,
      "provider_commit_uncertain",
      "The calendar provider did not conclusively confirm this booking. Retry with the same request.",
      true
    );
  }
}, "assertReceipt");
var managementBase = /* @__PURE__ */ __name((value) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new PublicBookingCreateError(503, "public_booking_unconfigured", "Public booking is not configured.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/" && url.pathname !== "") {
    throw new PublicBookingCreateError(503, "public_booking_unconfigured", "Public booking is not configured.");
  }
  return url;
}, "managementBase");
var slotConflict = /* @__PURE__ */ __name(() => new PublicBookingCreateError(
  409,
  "slot_conflict",
  "That time is no longer available."
), "slotConflict");
var uncertainProvider = /* @__PURE__ */ __name(() => new PublicBookingCreateError(
  503,
  "provider_commit_uncertain",
  "The calendar provider did not conclusively confirm this booking. Retry with the same request.",
  true
), "uncertainProvider");
async function rememberUncertain(dependencies, scope, attempt, errorCode) {
  try {
    await dependencies.attempts.markUncertain({
      scope,
      idempotencyKey: attempt.idempotencyKey,
      requestHash: attempt.requestHash,
      errorCode
    });
  } catch {
  }
  throw uncertainProvider();
}
__name(rememberUncertain, "rememberUncertain");
async function finalizeReceipt(dependencies, scope, page, attempt, receipt, startsAt, endsAt) {
  try {
    assertReceipt(receipt, attempt, startsAt, endsAt, page.publicSnapshot.approvalRequired);
    const credential = await dependencies.managementTokens.issue({
      scope,
      bookingReference: attempt.bookingReference,
      pageId: page.pageId,
      revisionId: page.revisionId,
      destinationCalendarId: page.privateSnapshot.destinationCalendarId,
      providerBookingId: receipt.providerBookingId,
      providerOperationId: attempt.providerOperationId,
      startsAt,
      endsAt,
      guest: attempt.guest,
      approvalExpiresAt: attempt.approvalExpiresAt,
      organizerName: page.publicSnapshot.displayName,
      eventTitle: page.publicSnapshot.title,
      location: page.publicSnapshot.location,
      locationLabel: page.publicSnapshot.locationLabel,
      timeZone: page.privateSnapshot.schedule.timeZone
    });
    if (!MANAGEMENT_TOKEN_PATTERN.test(credential.token)) {
      throw new Error("The management token issuer returned an invalid token.");
    }
    const managementUrl = new URL(
      `/manage#${credential.token}`,
      managementBase(dependencies.managementOrigin)
    ).toString();
    const response = {
      schemaVersion: PUBLIC_BOOKING_SCHEMA_VERSION,
      status: page.publicSnapshot.approvalRequired ? "pending" : "confirmed",
      bookingReference: attempt.bookingReference,
      startsAt,
      endsAt,
      managementUrl
    };
    await dependencies.attempts.markCommitted({
      scope,
      idempotencyKey: attempt.idempotencyKey,
      requestHash: attempt.requestHash,
      response
    });
    return response;
  } catch (error) {
    if (error instanceof PublicBookingCreateError && error.code === "provider_commit_uncertain") {
      return rememberUncertain(dependencies, scope, attempt, error.code);
    }
    return rememberUncertain(dependencies, scope, attempt, "booking_finalize_uncertain");
  }
}
__name(finalizeReceipt, "finalizeReceipt");
async function createPublicBooking(initiallyResolved, input, dependencies) {
  const scope = {
    workspace: initiallyResolved.privateSnapshot.workspaceId,
    principal: initiallyResolved.privateSnapshot.principalId
  };
  const coordinationKey = await publicBookingCoordinationKey(scope);
  try {
    return await dependencies.serialization.runExclusive(coordinationKey, async () => {
      const now = dependencies.now();
      if (!Number.isFinite(now)) {
        throw new PublicBookingCreateError(503, "public_booking_unconfigured", "Public booking is not configured.");
      }
      if (!UUID_PATTERN.test(input.requestId)) {
        throw new PublicBookingCreateError(400, "invalid_booking_request", "The booking request ID is invalid.");
      }
      const configuredHostnames = dependencies.allowedTurnstileHostnames.map((hostname) => hostname.trim()).filter(Boolean);
      if (dependencies.expectedTurnstileAction.trim().length === 0 || configuredHostnames.length === 0) {
        throw new PublicBookingCreateError(
          503,
          "public_booking_unconfigured",
          "Public booking is not configured."
        );
      }
      managementBase(dependencies.managementOrigin);
      const guest = normalizedGuest(input.guest);
      validateTurnstile(input.turnstile, dependencies, now);
      const startsAt = canonicalInstant2(input.slotProof.claims.start, "The selected start time");
      const endsAt = canonicalInstant2(input.slotProof.claims.end, "The selected end time");
      const nowSeconds = Math.floor(now / 1e3);
      if (input.slotProof.claims.exp <= nowSeconds) {
        throw new PublicBookingCreateError(
          409,
          "slot_token_expired",
          "This selected time expired. Choose it again."
        );
      }
      if (input.slotProof.claims.iat > nowSeconds + 60 || input.slotProof.claims.exp <= input.slotProof.claims.iat || input.slotProof.claims.exp - input.slotProof.claims.iat > 15 * 60 || input.slotProof.token.length < 16 || input.slotProof.token.length > 4096) {
        throw new PublicBookingCreateError(400, "slot_token_invalid", "This selected time is invalid. Choose it again.");
      }
      let current;
      try {
        current = await dependencies.publications.currentPage(initiallyResolved.pageId);
      } catch {
        throw new PublicBookingCreateError(
          503,
          "public_booking_unavailable",
          "This booking page is temporarily unavailable.",
          true
        );
      }
      if (!currentRevisionMatches(initiallyResolved, current) || input.slotProof.claims.revisionId !== current.revisionId) {
        throw new PublicBookingCreateError(
          409,
          "public_page_changed",
          "This booking page changed. Reload it before choosing a time."
        );
      }
      if (Date.parse(endsAt) - Date.parse(startsAt) !== current.publicSnapshot.durationMinutes * MILLISECONDS_PER_MINUTE2) {
        throw new PublicBookingCreateError(400, "slot_token_invalid", "This selected time is invalid. Choose it again.");
      }
      if (!publicSlotSatisfiesPublishedSchedule({
        resolved: current,
        start: startsAt,
        end: endsAt,
        now
      })) {
        throw slotConflict();
      }
      const conflictStart = new Date(
        Date.parse(startsAt) - current.privateSnapshot.schedule.bufferBeforeMinutes * MILLISECONDS_PER_MINUTE2
      ).toISOString();
      const conflictEnd = new Date(
        Date.parse(endsAt) + current.privateSnapshot.schedule.bufferAfterMinutes * MILLISECONDS_PER_MINUTE2
      ).toISOString();
      const conflictCalendarIds = [...new Set(current.privateSnapshot.conflictCalendarIds)].sort();
      if (conflictCalendarIds.length === 0 || !conflictCalendarIds.includes(current.privateSnapshot.destinationCalendarId)) {
        throw new PublicBookingCreateError(
          503,
          "published_page_invalid",
          "This booking page is temporarily unavailable.",
          true
        );
      }
      const requestHash = await publicBookingRequestHash({
        page: current,
        slotClaims: input.slotProof.claims,
        guest
      });
      const providerOperationId = await publicBookingProviderOperationId(
        scope,
        current.privateSnapshot.destinationCalendarId,
        input.requestId
      );
      const approvalExpiresAt = current.publicSnapshot.approvalRequired ? new Date(now + PUBLIC_APPROVAL_HOLD_TTL_MS).toISOString() : null;
      const claimInput = {
        scope,
        idempotencyKey: input.requestId,
        requestHash,
        slotProofFingerprint: await sha256(input.slotProof.token),
        providerOperationId,
        startsAt,
        endsAt,
        revisionId: current.revisionId,
        guest,
        approvalExpiresAt
      };
      let claimed;
      try {
        claimed = await dependencies.attempts.claim(claimInput);
      } catch {
        throw new PublicBookingCreateError(
          503,
          "booking_state_uncertain",
          "This booking could not be confirmed. Retry with the same request.",
          true
        );
      }
      if (claimed.kind === "idempotency-conflict") {
        throw new PublicBookingCreateError(
          409,
          "idempotency_key_reused",
          "This request ID was already used for a different booking."
        );
      }
      if (claimed.kind === "slot-proof-replayed") {
        throw new PublicBookingCreateError(
          409,
          "slot_proof_replayed",
          "This selected time proof was already used. Choose the time again."
        );
      }
      const attempt = claimed.attempt;
      if (!validAttempt(
        attempt,
        claimInput,
        claimed.kind,
        current.publicSnapshot.approvalRequired
      )) {
        throw new PublicBookingCreateError(
          503,
          "booking_state_uncertain",
          "This booking could not be confirmed. Retry with the same request.",
          true
        );
      }
      if (attempt.state === "committed") {
        return validateStoredResponse(
          attempt.response,
          attempt,
          startsAt,
          endsAt,
          dependencies.managementOrigin
        );
      }
      if (attempt.state === "rejected") {
        if (attempt.rejectionCode === "slot_conflict") throw slotConflict();
        throw new PublicBookingCreateError(
          503,
          "booking_state_uncertain",
          "This booking could not be confirmed. Retry with the same request.",
          true
        );
      }
      if (claimed.kind === "existing") {
        let recovery;
        try {
          recovery = await dependencies.provider.recover({
            scope,
            destinationCalendarId: current.privateSnapshot.destinationCalendarId,
            operationId: attempt.providerOperationId,
            commitProof: attempt.requestHash,
            startsAt,
            endsAt
          });
        } catch {
          return rememberUncertain(dependencies, scope, attempt, "provider_recovery_uncertain");
        }
        if (recovery.status === "uncertain") {
          return rememberUncertain(dependencies, scope, attempt, "provider_recovery_uncertain");
        }
        if (recovery.status === "committed") {
          return finalizeReceipt(
            dependencies,
            scope,
            current,
            attempt,
            recovery.receipt,
            startsAt,
            endsAt
          );
        }
      }
      let live;
      try {
        live = await dependencies.availability.revalidate({
          page: current,
          eventStart: startsAt,
          eventEnd: endsAt,
          conflictStart,
          conflictEnd,
          conflictCalendarIds
        });
      } catch {
        throw new PublicBookingCreateError(
          503,
          "live_availability_unavailable",
          "Availability could not be checked. Try again shortly.",
          true
        );
      }
      const completeAttestation = live.revisionId === current.revisionId && live.eventStart === startsAt && live.eventEnd === endsAt && live.conflictStart === conflictStart && live.conflictEnd === conflictEnd && sameStrings(live.checkedCalendarIds, conflictCalendarIds);
      if (!completeAttestation || live.status === "uncertain") {
        throw new PublicBookingCreateError(
          503,
          "live_availability_unavailable",
          "Availability could not be checked. Try again shortly.",
          true
        );
      }
      if (live.status === "conflict") {
        try {
          await dependencies.attempts.markRejected({
            scope,
            idempotencyKey: attempt.idempotencyKey,
            requestHash: attempt.requestHash,
            rejectionCode: "slot_conflict"
          });
        } catch {
          throw new PublicBookingCreateError(
            503,
            "booking_state_uncertain",
            "This booking could not be confirmed. Retry with the same request.",
            true
          );
        }
        throw slotConflict();
      }
      let committed;
      try {
        committed = await dependencies.provider.commit({
          scope,
          destinationCalendarId: current.privateSnapshot.destinationCalendarId,
          operationId: attempt.providerOperationId,
          commitProof: attempt.requestHash,
          startsAt,
          endsAt,
          conflictCalendarIds,
          conflictStart,
          conflictEnd,
          title: current.publicSnapshot.title,
          description: current.publicSnapshot.description,
          location: current.privateSnapshot.location,
          guest: attempt.guest,
          bookingKind: current.publicSnapshot.approvalRequired ? "approval-hold" : "meeting",
          conferenceProvider: current.publicSnapshot.location === "google-meet" ? "google-meet" : "none",
          expiresAt: attempt.approvalExpiresAt
        });
      } catch {
        return rememberUncertain(dependencies, scope, attempt, "provider_commit_uncertain");
      }
      if (committed.status === "uncertain") {
        return rememberUncertain(dependencies, scope, attempt, "provider_commit_uncertain");
      }
      if (committed.status === "conflict") {
        if (committed.reason === "operation-collision") {
          return rememberUncertain(dependencies, scope, attempt, "provider_operation_collision");
        }
        try {
          await dependencies.attempts.markRejected({
            scope,
            idempotencyKey: attempt.idempotencyKey,
            requestHash: attempt.requestHash,
            rejectionCode: "slot_conflict"
          });
        } catch {
          throw new PublicBookingCreateError(
            503,
            "booking_state_uncertain",
            "This booking could not be confirmed. Retry with the same request.",
            true
          );
        }
        throw slotConflict();
      }
      return finalizeReceipt(
        dependencies,
        scope,
        current,
        attempt,
        committed.receipt,
        startsAt,
        endsAt
      );
    });
  } catch (error) {
    if (error instanceof PublicBookingCreateError) throw error;
    throw new PublicBookingCreateError(
      503,
      "public_booking_unavailable",
      "This booking could not be completed. Try again shortly.",
      true
    );
  }
}
__name(createPublicBooking, "createPublicBooking");

// src/public-booking-management.ts
var MANAGEMENT_SCHEMA_VERSION = "tap.calendar.public-management.v1";
var CANCEL_SCHEMA_VERSION = "tap.calendar.public-management-cancel.v1";
var RESCHEDULE_SCHEMA_VERSION = "tap.calendar.public-management-reschedule.v1";
var TOKEN_PATTERN = /^tapm_v1_[A-Za-z0-9_-]{43}$/u;
var UUID_PATTERN2 = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
var MILLISECONDS_PER_MINUTE3 = 6e4;
var PublicBookingManagementError = class extends Error {
  static {
    __name(this, "PublicBookingManagementError");
  }
  status;
  code;
  retryable;
  constructor(status, code, message2, retryable = false) {
    super(message2);
    this.name = "PublicBookingManagementError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
};
var isRecord4 = /* @__PURE__ */ __name((value) => Boolean(value) && typeof value === "object" && !Array.isArray(value), "isRecord");
var exactKeys3 = /* @__PURE__ */ __name((value, expected) => {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
}, "exactKeys");
var unavailable = /* @__PURE__ */ __name(() => new PublicBookingManagementError(
  404,
  "management_link_unavailable",
  "This booking management link is unavailable."
), "unavailable");
function parsePublicBookingManagementToken(value) {
  if (typeof value !== "string" || !TOKEN_PATTERN.test(value)) throw unavailable();
  return value;
}
__name(parsePublicBookingManagementToken, "parsePublicBookingManagementToken");
var parseMutationBase = /* @__PURE__ */ __name((value, expectedKeys, schemaVersion) => {
  if (!isRecord4(value) || !exactKeys3(value, expectedKeys) || value.schemaVersion !== schemaVersion || typeof value.requestId !== "string" || !UUID_PATTERN2.test(value.requestId) || typeof value.expectedVersion !== "number" || !Number.isSafeInteger(value.expectedVersion) || value.expectedVersion < 1) {
    throw new PublicBookingManagementError(400, "invalid_management_request", "The request is invalid.");
  }
  return {
    ...value,
    requestId: value.requestId,
    expectedVersion: value.expectedVersion
  };
}, "parseMutationBase");
function parsePublicBookingCancelRequest(value) {
  const parsed = parseMutationBase(
    value,
    ["schemaVersion", "requestId", "expectedVersion"],
    CANCEL_SCHEMA_VERSION
  );
  return {
    schemaVersion: CANCEL_SCHEMA_VERSION,
    requestId: parsed.requestId,
    expectedVersion: parsed.expectedVersion
  };
}
__name(parsePublicBookingCancelRequest, "parsePublicBookingCancelRequest");
function parsePublicBookingRescheduleRequest(value) {
  const parsed = parseMutationBase(
    value,
    ["schemaVersion", "requestId", "expectedVersion", "slotToken", "turnstileToken"],
    RESCHEDULE_SCHEMA_VERSION
  );
  if (typeof parsed.slotToken !== "string" || parsed.slotToken.length < 16 || parsed.slotToken.length > 4096 || typeof parsed.turnstileToken !== "string" || parsed.turnstileToken.length < 1 || parsed.turnstileToken.length > 2048) {
    throw new PublicBookingManagementError(400, "invalid_management_request", "The request is invalid.");
  }
  return {
    schemaVersion: RESCHEDULE_SCHEMA_VERSION,
    requestId: parsed.requestId,
    expectedVersion: parsed.expectedVersion,
    slotToken: parsed.slotToken,
    turnstileToken: parsed.turnstileToken
  };
}
__name(parsePublicBookingRescheduleRequest, "parsePublicBookingRescheduleRequest");
var projectPublicBookingManagement = /* @__PURE__ */ __name((booking, reschedulePage = null) => ({
  schemaVersion: MANAGEMENT_SCHEMA_VERSION,
  bookingReference: booking.bookingReference,
  bookingVersion: booking.version,
  status: booking.status,
  guest: booking.guest,
  host: { displayName: booking.organizerName },
  event: {
    title: booking.eventTitle,
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
    durationMinutes: Math.round((Date.parse(booking.endsAt) - Date.parse(booking.startsAt)) / MILLISECONDS_PER_MINUTE3),
    location: booking.location,
    locationLabel: booking.locationLabel,
    approvalExpiresAt: booking.approvalExpiresAt
  },
  actions: {
    canCancel: booking.status === "confirmed" || booking.status === "pending",
    canReschedule: booking.status === "confirmed" && reschedulePage !== null
  },
  reschedulePage: booking.status === "confirmed" ? reschedulePage : null
}), "projectPublicBookingManagement");
var textEncoder = new TextEncoder();
var base64Url3 = /* @__PURE__ */ __name((bytes) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}, "base64Url");
var digest = /* @__PURE__ */ __name(async (value) => base64Url3(new Uint8Array(
  await crypto.subtle.digest("SHA-256", textEncoder.encode(value))
)), "digest");
var mutationHash = /* @__PURE__ */ __name((booking, request, kind) => digest(JSON.stringify({
  v: 1,
  kind,
  bookingReference: booking.bookingReference,
  expectedVersion: request.expectedVersion,
  ...kind === "reschedule" && "slotToken" in request ? { slotToken: request.slotToken } : {}
})), "mutationHash");
var mutationOperationId = /* @__PURE__ */ __name((bookingReference, requestId, kind) => digest(`tap.calendar.public-management-operation.v1\0${bookingReference}\0${requestId}\0${kind}`).then((value) => `tapmop_${value}`), "mutationOperationId");
var sameStrings2 = /* @__PURE__ */ __name((left, right) => {
  const first = [...new Set(left)].sort();
  const second = [...new Set(right)].sort();
  return first.length === second.length && first.every((value, index) => value === second[index]);
}, "sameStrings");
var mutationError = /* @__PURE__ */ __name((mutation) => {
  const code = mutation.rejectionCode === "provider_mismatch" ? "provider_mismatch" : "slot_conflict";
  return new PublicBookingManagementError(
    409,
    code,
    code === "slot_conflict" ? "That time is no longer available." : "This booking could not be matched with the calendar provider."
  );
}, "mutationError");
var claimError = /* @__PURE__ */ __name((kind) => {
  if (kind === "idempotency-conflict") {
    throw new PublicBookingManagementError(409, "idempotency_key_reused", "This request ID was already used.");
  }
  if (kind === "version-conflict") {
    throw new PublicBookingManagementError(409, "booking_version_changed", "This booking changed. Refresh and try again.");
  }
  throw new PublicBookingManagementError(
    409,
    "management_mutation_in_progress",
    "Another change to this booking is still being confirmed. Retry shortly.",
    true
  );
}, "claimError");
async function resolvedBooking(token, store) {
  let booking = null;
  try {
    booking = await store.resolve(token);
  } catch {
    throw unavailable();
  }
  if (!booking) throw unavailable();
  return booking;
}
__name(resolvedBooking, "resolvedBooking");
var reschedulePageProjection = /* @__PURE__ */ __name((page, dependencies) => {
  const projected = projectPublicBookingPage(page, {
    baseUrl: "https://cal.with-tap.ai",
    turnstileSiteKey: dependencies.turnstileSiteKey,
    now: dependencies.now()
  });
  return {
    profileSlug: page.profileSlug,
    eventTypeSlug: page.eventTypeSlug,
    pageRevision: page.revisionId,
    bookingWindow: projected.bookingWindow,
    turnstileSiteKey: projected.turnstile.siteKey
  };
}, "reschedulePageProjection");
var providerCommand = /* @__PURE__ */ __name((booking, mutation, conflict) => ({
  kind: mutation.kind,
  scope: booking.scope,
  destinationCalendarId: booking.destinationCalendarId,
  providerBookingId: booking.providerBookingId,
  providerOperationId: booking.providerOperationId,
  providerCommitProof: booking.providerCommitProof,
  operationId: mutation.operationId,
  mutationProof: mutation.requestHash,
  bookingStatus: booking.status === "pending" ? "pending" : "confirmed",
  startsAt: booking.startsAt,
  endsAt: booking.endsAt,
  newStartsAt: mutation.toStartsAt,
  newEndsAt: mutation.toEndsAt,
  conflictCalendarIds: conflict.calendarIds,
  conflictStart: conflict.start,
  conflictEnd: conflict.end
}), "providerCommand");
var validateReceipt = /* @__PURE__ */ __name((booking, mutation, receipt) => {
  const startsAt = mutation.kind === "cancel" ? mutation.fromStartsAt : mutation.toStartsAt;
  const endsAt = mutation.kind === "cancel" ? mutation.fromEndsAt : mutation.toEndsAt;
  if (receipt.operationId !== mutation.operationId || receipt.providerBookingId !== booking.providerBookingId || receipt.startsAt !== startsAt || receipt.endsAt !== endsAt || receipt.status !== (mutation.kind === "cancel" ? "cancelled" : "confirmed")) {
    throw new PublicBookingManagementError(
      503,
      "provider_management_uncertain",
      "The calendar provider did not conclusively confirm this change. Retry the same request.",
      true
    );
  }
}, "validateReceipt");
async function providerOutcome(booking, mutation, dependencies, conflict) {
  const command = providerCommand(booking, mutation, conflict);
  let outcome;
  try {
    if (mutation.state === "uncertain" || mutation.state === "pending") {
      const recovered = await dependencies.provider.recover(command);
      if (recovered.status !== "absent") outcome = recovered;
      else outcome = mutation.kind === "cancel" ? await dependencies.provider.cancel(command) : await dependencies.provider.reschedule(command);
    } else {
      throw new Error("Only open mutations reach the provider.");
    }
  } catch {
    outcome = { status: "uncertain" };
  }
  if (outcome.status === "committed") {
    try {
      validateReceipt(booking, mutation, outcome.receipt);
      return outcome.receipt;
    } catch (error) {
      await dependencies.store.markUncertain({
        bookingReference: mutation.bookingReference,
        requestId: mutation.requestId,
        requestHash: mutation.requestHash,
        errorCode: "provider_receipt_invalid"
      }).catch(() => void 0);
      throw error;
    }
  }
  if (outcome.status === "conflict") {
    const rejectionCode = outcome.reason === "provider-mismatch" ? "provider_mismatch" : "slot_conflict";
    await dependencies.store.markRejected({
      bookingReference: mutation.bookingReference,
      requestId: mutation.requestId,
      requestHash: mutation.requestHash,
      rejectionCode
    });
    throw mutationError({ ...mutation, state: "rejected", rejectionCode });
  }
  await dependencies.store.markUncertain({
    bookingReference: mutation.bookingReference,
    requestId: mutation.requestId,
    requestHash: mutation.requestHash,
    errorCode: "provider_management_uncertain"
  }).catch(() => void 0);
  throw new PublicBookingManagementError(
    503,
    "provider_management_uncertain",
    "The calendar provider did not conclusively confirm this change. Retry the same request.",
    true
  );
}
__name(providerOutcome, "providerOutcome");
async function sendNotice(booking, mutation, dependencies) {
  const rescheduled = mutation.kind === "reschedule";
  try {
    await dependencies.email.enqueue({
      eventKey: mutation.operationId,
      bookingReference: booking.bookingReference,
      scope: booking.scope,
      kind: rescheduled ? "rescheduled" : "cancelled",
      recipient: booking.guest,
      organizerName: booking.organizerName,
      eventTitle: booking.eventTitle,
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
      timeZone: booking.timeZone,
      ...rescheduled ? {
        previousStartsAt: mutation.fromStartsAt,
        previousEndsAt: mutation.fromEndsAt
      } : {}
    });
  } catch {
    throw new PublicBookingManagementError(
      503,
      "management_notice_pending",
      "The booking changed, but its notification is still being prepared. Retry the same request.",
      true
    );
  }
}
__name(sendNotice, "sendNotice");
var terminalReplay = /* @__PURE__ */ __name(async (booking, mutation, dependencies) => {
  if (mutation.state === "rejected") throw mutationError(mutation);
  if (mutation.state !== "committed") return null;
  if (!mutation.response) {
    throw new PublicBookingManagementError(503, "management_state_uncertain", "This booking is temporarily unavailable.", true);
  }
  await sendNotice(booking, mutation, dependencies);
  const page = booking.status === "confirmed" ? await optionalReschedulePage(booking, dependencies) : null;
  return projectPublicBookingManagement(
    booking,
    page ? reschedulePageProjection(page, dependencies) : null
  );
}, "terminalReplay");
async function cancelPublicBooking(token, request, dependencies) {
  const initiallyResolved = await resolvedBooking(token, dependencies.store);
  const coordinationKey = await publicBookingCoordinationKey(initiallyResolved.scope);
  return dependencies.serialization.runExclusive(coordinationKey, async () => {
    const booking = await resolvedBooking(token, dependencies.store);
    const requestHash = await mutationHash(booking, request, "cancel");
    const existing = await dependencies.store.findMutation({
      bookingReference: booking.bookingReference,
      requestId: request.requestId
    });
    if (existing) {
      if (existing.requestHash !== requestHash || existing.kind !== "cancel") claimError("idempotency-conflict");
      const replay = await terminalReplay(booking, existing, dependencies);
      if (replay) return replay;
    }
    if (booking.status === "cancelled") {
      throw new PublicBookingManagementError(409, "booking_already_cancelled", "This booking is already cancelled.");
    }
    if (booking.status !== "confirmed" && booking.status !== "pending") {
      throw new PublicBookingManagementError(
        409,
        "booking_not_cancellable",
        "This booking request can no longer be cancelled."
      );
    }
    if (booking.version !== request.expectedVersion) claimError("version-conflict");
    const claimed = existing ? { kind: "existing", mutation: existing } : await dependencies.store.claimMutation({
      booking,
      requestId: request.requestId,
      requestHash,
      operationId: await mutationOperationId(booking.bookingReference, request.requestId, "cancel"),
      kind: "cancel",
      expectedVersion: request.expectedVersion,
      pageRevisionId: null,
      toStartsAt: null,
      toEndsAt: null,
      conflictCalendarIds: [],
      conflictStart: null,
      conflictEnd: null
    });
    const mutation = "mutation" in claimed ? claimed.mutation : claimError(claimed.kind);
    await providerOutcome(booking, mutation, dependencies, { calendarIds: [], start: null, end: null });
    const target = {
      ...booking,
      version: booking.version + 1,
      status: "cancelled",
      cancelledAt: new Date(dependencies.now()).toISOString()
    };
    const response = projectPublicBookingManagement(target);
    const committed = await dependencies.store.commitCancellation({ booking, mutation, response });
    await sendNotice(committed, { ...mutation, state: "committed", response }, dependencies);
    return response;
  });
}
__name(cancelPublicBooking, "cancelPublicBooking");
async function currentReschedulePage(booking, dependencies) {
  let page;
  try {
    page = await dependencies.publications.currentPage(booking.pageId);
  } catch {
    page = null;
  }
  if (!page || page.privateSnapshot.workspaceId !== booking.scope.workspace || page.privateSnapshot.principalId !== booking.scope.principal || page.privateSnapshot.destinationCalendarId !== booking.destinationCalendarId) {
    throw new PublicBookingManagementError(
      409,
      "reschedule_unavailable",
      "This booking cannot be rescheduled from its current booking page."
    );
  }
  return page;
}
__name(currentReschedulePage, "currentReschedulePage");
async function optionalReschedulePage(booking, dependencies) {
  if (booking.status !== "confirmed") return null;
  try {
    return await currentReschedulePage(booking, dependencies);
  } catch {
    return null;
  }
}
__name(optionalReschedulePage, "optionalReschedulePage");
async function readPublicBookingManagement(token, dependencies) {
  const booking = await resolvedBooking(token, dependencies.store);
  const page = await optionalReschedulePage(booking, dependencies);
  return projectPublicBookingManagement(
    booking,
    page ? reschedulePageProjection(page, dependencies) : null
  );
}
__name(readPublicBookingManagement, "readPublicBookingManagement");
async function reschedulePublicBooking(token, request, dependencies) {
  const initiallyResolved = await resolvedBooking(token, dependencies.store);
  const coordinationKey = await publicBookingCoordinationKey(initiallyResolved.scope);
  return dependencies.serialization.runExclusive(coordinationKey, async () => {
    const booking = await resolvedBooking(token, dependencies.store);
    const requestHash = await mutationHash(booking, request, "reschedule");
    const existing = await dependencies.store.findMutation({
      bookingReference: booking.bookingReference,
      requestId: request.requestId
    });
    if (existing) {
      if (existing.requestHash !== requestHash || existing.kind !== "reschedule") claimError("idempotency-conflict");
      const replay = await terminalReplay(booking, existing, dependencies);
      if (replay) return replay;
    }
    if (booking.status !== "confirmed") {
      throw new PublicBookingManagementError(
        409,
        "reschedule_unavailable",
        "Only a confirmed booking can be rescheduled."
      );
    }
    if (booking.version !== request.expectedVersion) claimError("version-conflict");
    let page = null;
    let slot = null;
    let newStartsAt = null;
    let newEndsAt = null;
    let conflictCalendarIds = [];
    let conflictStart = null;
    let conflictEnd = null;
    if (!existing) {
      page = await currentReschedulePage(booking, dependencies);
      try {
        slot = await dependencies.slotVerifier.verify({ page, token: request.slotToken });
      } catch {
        throw new PublicBookingManagementError(409, "slot_token_invalid", "Choose the time again.");
      }
      newStartsAt = slot.claims.start;
      newEndsAt = slot.claims.end;
      if (slot.claims.revisionId !== page.revisionId || Date.parse(newEndsAt) - Date.parse(newStartsAt) !== page.publicSnapshot.durationMinutes * MILLISECONDS_PER_MINUTE3 || !publicSlotSatisfiesPublishedSchedule({
        resolved: page,
        start: newStartsAt,
        end: newEndsAt,
        now: dependencies.now()
      })) {
        throw new PublicBookingManagementError(409, "slot_conflict", "That time is no longer available.");
      }
      conflictCalendarIds = [...new Set(page.privateSnapshot.conflictCalendarIds)].sort();
      if (!conflictCalendarIds.includes(booking.destinationCalendarId)) {
        throw new PublicBookingManagementError(409, "reschedule_unavailable", "This booking cannot be rescheduled.");
      }
      conflictStart = new Date(
        Date.parse(newStartsAt) - page.privateSnapshot.schedule.bufferBeforeMinutes * MILLISECONDS_PER_MINUTE3
      ).toISOString();
      conflictEnd = new Date(
        Date.parse(newEndsAt) + page.privateSnapshot.schedule.bufferAfterMinutes * MILLISECONDS_PER_MINUTE3
      ).toISOString();
      let availability;
      try {
        availability = await dependencies.availability.revalidate({
          page,
          eventStart: newStartsAt,
          eventEnd: newEndsAt,
          conflictStart,
          conflictEnd,
          conflictCalendarIds
        });
      } catch {
        throw new PublicBookingManagementError(503, "availability_uncertain", "Availability could not be confirmed.", true);
      }
      if (availability.status !== "available" || availability.revisionId !== page.revisionId || availability.eventStart !== newStartsAt || availability.eventEnd !== newEndsAt || availability.conflictStart !== conflictStart || availability.conflictEnd !== conflictEnd || !sameStrings2(availability.checkedCalendarIds, conflictCalendarIds)) {
        throw new PublicBookingManagementError(
          availability.status === "conflict" ? 409 : 503,
          availability.status === "conflict" ? "slot_conflict" : "availability_uncertain",
          availability.status === "conflict" ? "That time is no longer available." : "Availability could not be confirmed.",
          availability.status !== "conflict"
        );
      }
    } else {
      newStartsAt = existing.toStartsAt;
      newEndsAt = existing.toEndsAt;
      if (!newStartsAt || !newEndsAt || !existing.pageRevisionId) {
        throw new PublicBookingManagementError(503, "management_state_uncertain", "This booking is temporarily unavailable.", true);
      }
      conflictCalendarIds = existing.conflictCalendarIds;
      conflictStart = existing.conflictStart;
      conflictEnd = existing.conflictEnd;
      if (conflictCalendarIds.length === 0 || !conflictCalendarIds.includes(booking.destinationCalendarId) || !conflictStart || !conflictEnd) {
        throw new PublicBookingManagementError(503, "management_state_uncertain", "This booking is temporarily unavailable.", true);
      }
    }
    const claimed = existing ? { kind: "existing", mutation: existing } : await dependencies.store.claimMutation({
      booking,
      requestId: request.requestId,
      requestHash,
      operationId: await mutationOperationId(booking.bookingReference, request.requestId, "reschedule"),
      kind: "reschedule",
      expectedVersion: request.expectedVersion,
      pageRevisionId: page.revisionId,
      toStartsAt: newStartsAt,
      toEndsAt: newEndsAt,
      conflictCalendarIds,
      conflictStart,
      conflictEnd
    });
    const mutation = "mutation" in claimed ? claimed.mutation : claimError(claimed.kind);
    await providerOutcome(booking, mutation, dependencies, {
      calendarIds: conflictCalendarIds,
      start: conflictStart,
      end: conflictEnd
    });
    const target = {
      ...booking,
      version: booking.version + 1,
      revisionId: mutation.pageRevisionId,
      startsAt: mutation.toStartsAt,
      endsAt: mutation.toEndsAt
    };
    const projectedPage = page ?? await optionalReschedulePage(target, dependencies);
    const response = projectPublicBookingManagement(
      target,
      projectedPage ? reschedulePageProjection(projectedPage, dependencies) : null
    );
    const committed = await dependencies.store.commitReschedule({
      booking,
      mutation,
      currentPageRevisionId: mutation.pageRevisionId,
      response
    });
    await sendNotice(committed, { ...mutation, state: "committed", response }, dependencies);
    return response;
  });
}
__name(reschedulePublicBooking, "reschedulePublicBooking");

// src/public-booking-store.ts
var MANAGEMENT_TOKEN_DOMAIN = "tap.calendar.public-management.v1";
var MANAGEMENT_TOKEN_PREFIX = "tapm_v1_";
var TEXT_ENCODER = new TextEncoder();
var BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
var BOOKING_REFERENCE_PATTERN2 = /^[A-Za-z0-9_-]{16,128}$/u;
var ISO_INSTANT_MIN_LENGTH = 20;
var ISO_INSTANT_MAX_LENGTH = 40;
var PublicBookingStoreError = class extends Error {
  static {
    __name(this, "PublicBookingStoreError");
  }
  code;
  constructor(code, message2) {
    super(message2);
    this.name = "PublicBookingStoreError";
    this.code = code;
  }
};
var isRecord5 = /* @__PURE__ */ __name((value) => Boolean(value) && typeof value === "object" && !Array.isArray(value), "isRecord");
var requiredText = /* @__PURE__ */ __name((value, field, minimum, maximum) => {
  if (value.length < minimum || value.length > maximum) {
    throw new PublicBookingStoreError("invalid_store_input", `${field} is invalid.`);
  }
  return value;
}, "requiredText");
var canonicalInstant3 = /* @__PURE__ */ __name((value, field) => {
  requiredText(value, field, ISO_INSTANT_MIN_LENGTH, ISO_INSTANT_MAX_LENGTH);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new PublicBookingStoreError("invalid_store_input", `${field} is invalid.`);
  }
  return value;
}, "canonicalInstant");
var canonicalNow = /* @__PURE__ */ __name((clock) => {
  const now = clock();
  if (!Number.isFinite(now)) {
    throw new PublicBookingStoreError("invalid_store_clock", "The booking store clock is invalid.");
  }
  return new Date(now).toISOString();
}, "canonicalNow");
var base64Url4 = /* @__PURE__ */ __name((bytes) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}, "base64Url");
var sha2562 = /* @__PURE__ */ __name(async (value) => base64Url4(new Uint8Array(await crypto.subtle.digest("SHA-256", TEXT_ENCODER.encode(value)))), "sha256");
var validateManagementSecret = /* @__PURE__ */ __name((secret) => {
  if (TEXT_ENCODER.encode(secret).byteLength < 32) {
    throw new PublicBookingStoreError(
      "management_secret_invalid",
      "The public booking management secret must contain at least 32 bytes."
    );
  }
}, "validateManagementSecret");
var canonicalManagementOrigin = /* @__PURE__ */ __name((value) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new PublicBookingStoreError("management_origin_invalid", "The management origin is invalid.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/" && url.pathname !== "") {
    throw new PublicBookingStoreError("management_origin_invalid", "The management origin is invalid.");
  }
  return url.origin;
}, "canonicalManagementOrigin");
var importManagementKey = /* @__PURE__ */ __name((secret) => crypto.subtle.importKey(
  "raw",
  TEXT_ENCODER.encode(secret),
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["sign"]
), "importManagementKey");
var deriveManagementToken = /* @__PURE__ */ __name(async (key, workspace, principal, bookingReference) => {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await key,
    TEXT_ENCODER.encode(
      `${MANAGEMENT_TOKEN_DOMAIN}\0${workspace}\0${principal}\0${bookingReference}`
    )
  );
  return `${MANAGEMENT_TOKEN_PREFIX}${base64Url4(new Uint8Array(signature))}`;
}, "deriveManagementToken");
var randomBookingReference = /* @__PURE__ */ __name(() => {
  const entropy = new Uint8Array(24);
  crypto.getRandomValues(entropy);
  return `pb_${base64Url4(entropy)}`;
}, "randomBookingReference");
var claimScope = /* @__PURE__ */ __name((input) => {
  requiredText(input.scope.workspace, "workspace", 1, 255);
  requiredText(input.scope.principal, "principal", 1, 255);
  requiredText(input.idempotencyKey, "idempotencyKey", 16, 255);
  requiredText(input.requestHash, "requestHash", 16, 128);
  requiredText(input.slotProofFingerprint, "slotProofFingerprint", 16, 128);
  requiredText(input.providerOperationId, "providerOperationId", 16, 255);
  requiredText(input.revisionId, "revisionId", 8, 255);
  canonicalInstant3(input.startsAt, "startsAt");
  canonicalInstant3(input.endsAt, "endsAt");
  requiredText(input.guest.name, "guest.name", 1, 160);
  requiredText(input.guest.email, "guest.email", 3, 320);
  if (input.approvalExpiresAt !== null) {
    canonicalInstant3(input.approvalExpiresAt, "approvalExpiresAt");
  }
  if (!BASE64URL_PATTERN.test(input.requestHash) || !BASE64URL_PATTERN.test(input.slotProofFingerprint) || Date.parse(input.endsAt) <= Date.parse(input.startsAt) || input.guest.name.trim() !== input.guest.name || input.guest.email.trim().toLowerCase() !== input.guest.email || !input.guest.email.includes("@")) {
    throw new PublicBookingStoreError("invalid_store_input", "The booking claim is invalid.");
  }
}, "claimScope");
var attemptRow = /* @__PURE__ */ __name((value) => {
  if (!isRecord5(value) || typeof value.idempotency_key !== "string" || typeof value.request_hash !== "string" || typeof value.provider_operation_id !== "string" || typeof value.booking_reference !== "string" || typeof value.revision_id !== "string" || typeof value.start_at !== "string" || typeof value.end_at !== "string" || typeof value.guest_name !== "string" || typeof value.guest_email !== "string" || value.approval_expires_at !== null && typeof value.approval_expires_at !== "string" || typeof value.state !== "string" || value.response_json !== null && typeof value.response_json !== "string" || value.rejection_code !== null && typeof value.rejection_code !== "string") {
    return null;
  }
  return {
    ...value,
    idempotency_key: value.idempotency_key,
    request_hash: value.request_hash,
    provider_operation_id: value.provider_operation_id,
    booking_reference: value.booking_reference,
    revision_id: value.revision_id,
    start_at: value.start_at,
    end_at: value.end_at,
    guest_name: value.guest_name,
    guest_email: value.guest_email,
    approval_expires_at: value.approval_expires_at,
    state: value.state,
    response_json: value.response_json,
    rejection_code: value.rejection_code
  };
}, "attemptRow");
var proofUseRow = /* @__PURE__ */ __name((value) => {
  if (!isRecord5(value) || typeof value.idempotency_key !== "string") return null;
  return { ...value, idempotency_key: value.idempotency_key };
}, "proofUseRow");
var publicBookingResult = /* @__PURE__ */ __name((value) => {
  if (!isRecord5(value) || Object.keys(value).length !== 6 || value.schemaVersion !== "tap.calendar.public-booking.v1" || value.status !== "confirmed" && value.status !== "pending" || typeof value.bookingReference !== "string" || typeof value.startsAt !== "string" || typeof value.endsAt !== "string" || typeof value.managementUrl !== "string") {
    return null;
  }
  return {
    schemaVersion: "tap.calendar.public-booking.v1",
    status: value.status,
    bookingReference: value.bookingReference,
    startsAt: value.startsAt,
    endsAt: value.endsAt,
    managementUrl: value.managementUrl
  };
}, "publicBookingResult");
var parseStoredResponse = /* @__PURE__ */ __name((value) => {
  if (value === null) return null;
  try {
    const parsed = JSON.parse(value);
    if (!isRecord5(parsed) || Object.keys(parsed).length !== 5 || parsed.schemaVersion !== "tap.calendar.public-booking.v1" || parsed.status !== "confirmed" && parsed.status !== "pending" || typeof parsed.bookingReference !== "string" || typeof parsed.startsAt !== "string" || typeof parsed.endsAt !== "string") {
      throw new Error("Invalid public booking response.");
    }
    return {
      schemaVersion: "tap.calendar.public-booking.v1",
      status: parsed.status,
      bookingReference: parsed.bookingReference,
      startsAt: parsed.startsAt,
      endsAt: parsed.endsAt
    };
  } catch {
    throw new PublicBookingStoreError(
      "corrupt_booking_attempt",
      "The stored public booking response is invalid."
    );
  }
}, "parseStoredResponse");
var toAttempt = /* @__PURE__ */ __name((row, managementUrl) => {
  if (!BOOKING_REFERENCE_PATTERN2.test(row.booking_reference) || !["pending", "uncertain", "committed", "rejected"].includes(row.state) || row.rejection_code !== null && row.rejection_code !== "slot_conflict" || row.guest_name.length < 1 || row.guest_name.length > 160 || row.guest_email.length < 3 || row.guest_email.length > 320 || row.guest_name.trim() !== row.guest_name || row.guest_email.trim().toLowerCase() !== row.guest_email || !row.guest_email.includes("@") || row.approval_expires_at !== null && (!Number.isFinite(Date.parse(row.approval_expires_at)) || new Date(Date.parse(row.approval_expires_at)).toISOString() !== row.approval_expires_at)) {
    throw new PublicBookingStoreError("corrupt_booking_attempt", "The stored booking attempt is invalid.");
  }
  const response = parseStoredResponse(row.response_json);
  if (row.state === "committed" !== (response !== null) || row.state === "rejected" !== (row.rejection_code === "slot_conflict") || response !== null && (managementUrl === null || response.bookingReference !== row.booking_reference || response.startsAt !== row.start_at || response.endsAt !== row.end_at || response.status !== (row.approval_expires_at === null ? "confirmed" : "pending"))) {
    throw new PublicBookingStoreError("corrupt_booking_attempt", "The stored booking attempt is incomplete.");
  }
  return {
    idempotencyKey: row.idempotency_key,
    requestHash: row.request_hash,
    providerOperationId: row.provider_operation_id,
    bookingReference: row.booking_reference,
    guest: { name: row.guest_name, email: row.guest_email },
    approvalExpiresAt: row.approval_expires_at,
    state: row.state,
    response: response === null || managementUrl === null ? null : { ...response, managementUrl },
    rejectionCode: row.rejection_code
  };
}, "toAttempt");
var sameClaim = /* @__PURE__ */ __name((row, input) => row.request_hash === input.requestHash && row.provider_operation_id === input.providerOperationId && row.revision_id === input.revisionId && row.start_at === input.startsAt && row.end_at === input.endsAt && row.guest_name === input.guest.name && row.guest_email === input.guest.email, "sameClaim");
var D1PublicBookingAttemptStore = class {
  static {
    __name(this, "D1PublicBookingAttemptStore");
  }
  #database;
  #now;
  #bookingReference;
  #managementOrigin;
  #managementKey;
  constructor(database, options) {
    validateManagementSecret(options.managementSecret);
    this.#database = database;
    this.#now = options.now ?? Date.now;
    this.#bookingReference = options.bookingReference ?? randomBookingReference;
    this.#managementOrigin = canonicalManagementOrigin(options.managementOrigin);
    this.#managementKey = importManagementKey(options.managementSecret);
  }
  async claim(input) {
    claimScope(input);
    const now = canonicalNow(this.#now);
    const bookingReference = this.#bookingReference();
    if (!BOOKING_REFERENCE_PATTERN2.test(bookingReference)) {
      throw new PublicBookingStoreError(
        "invalid_booking_reference",
        "The booking reference generator returned an invalid value."
      );
    }
    const results = await this.#database.batch([
      this.#database.prepare(
        `INSERT OR IGNORE INTO public_booking_attempts (
           workspace_id, principal_id, idempotency_key, request_hash,
           provider_operation_id, booking_reference, revision_id, start_at,
           end_at, guest_name, guest_email, approval_expires_at, state,
           response_json, rejection_code, last_error_code,
           created_at, updated_at
         )
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                'pending', NULL, NULL, NULL, ?, ?
          WHERE NOT EXISTS (
            SELECT 1
              FROM public_booking_slot_proof_uses
             WHERE workspace_id = ? AND principal_id = ?
               AND slot_proof_fingerprint = ? AND idempotency_key <> ?
          )`
      ).bind(
        input.scope.workspace,
        input.scope.principal,
        input.idempotencyKey,
        input.requestHash,
        input.providerOperationId,
        bookingReference,
        input.revisionId,
        input.startsAt,
        input.endsAt,
        input.guest.name,
        input.guest.email,
        input.approvalExpiresAt,
        now,
        now,
        input.scope.workspace,
        input.scope.principal,
        input.slotProofFingerprint,
        input.idempotencyKey
      ),
      this.#database.prepare(
        `INSERT OR IGNORE INTO public_booking_slot_proof_uses (
           workspace_id, principal_id, slot_proof_fingerprint,
           idempotency_key, created_at
         )
         SELECT ?, ?, ?, ?, ?
          WHERE EXISTS (
            SELECT 1
              FROM public_booking_attempts
             WHERE workspace_id = ? AND principal_id = ? AND idempotency_key = ?
               AND request_hash = ? AND provider_operation_id = ?
               AND revision_id = ? AND start_at = ? AND end_at = ?
               AND guest_name = ? AND guest_email = ?
          )`
      ).bind(
        input.scope.workspace,
        input.scope.principal,
        input.slotProofFingerprint,
        input.idempotencyKey,
        now,
        input.scope.workspace,
        input.scope.principal,
        input.idempotencyKey,
        input.requestHash,
        input.providerOperationId,
        input.revisionId,
        input.startsAt,
        input.endsAt,
        input.guest.name,
        input.guest.email
      ),
      this.#database.prepare(
        `SELECT idempotency_key, request_hash, provider_operation_id,
                booking_reference, revision_id, start_at, end_at,
                guest_name, guest_email, approval_expires_at, state,
                response_json, rejection_code
           FROM public_booking_attempts
          WHERE workspace_id = ? AND principal_id = ? AND idempotency_key = ?`
      ).bind(input.scope.workspace, input.scope.principal, input.idempotencyKey),
      this.#database.prepare(
        `SELECT idempotency_key
           FROM public_booking_slot_proof_uses
          WHERE workspace_id = ? AND principal_id = ?
            AND slot_proof_fingerprint = ?`
      ).bind(input.scope.workspace, input.scope.principal, input.slotProofFingerprint)
    ]);
    const persisted = attemptRow(results[2]?.results[0]);
    const proof = proofUseRow(results[3]?.results[0]);
    if (persisted && persisted.request_hash !== input.requestHash) {
      return { kind: "idempotency-conflict" };
    }
    if (proof && proof.idempotency_key !== input.idempotencyKey) {
      return { kind: "slot-proof-replayed" };
    }
    if (!persisted || !proof || !sameClaim(persisted, input)) {
      throw new PublicBookingStoreError(
        "booking_claim_invariant_failed",
        "The public booking claim could not be persisted conclusively."
      );
    }
    const attempt = await this.#hydrateAttempt(
      persisted,
      input.scope.workspace,
      input.scope.principal
    );
    return Number(results[0]?.meta.changes ?? 0) === 1 ? { kind: "claimed", attempt } : { kind: "existing", attempt };
  }
  async markUncertain(input) {
    requiredText(input.errorCode, "errorCode", 1, 128);
    const now = canonicalNow(this.#now);
    const results = await this.#database.batch([
      this.#database.prepare(
        `UPDATE public_booking_attempts
            SET state = 'uncertain', last_error_code = ?, updated_at = ?
          WHERE workspace_id = ? AND principal_id = ? AND idempotency_key = ?
            AND request_hash = ? AND state IN ('pending', 'uncertain')`
      ).bind(
        input.errorCode,
        now,
        input.scope.workspace,
        input.scope.principal,
        input.idempotencyKey,
        input.requestHash
      ),
      this.#attemptSelect(input.scope.workspace, input.scope.principal, input.idempotencyKey)
    ]);
    const row = attemptRow(results[1]?.results[0]);
    if (!row || row.request_hash !== input.requestHash || row.state !== "uncertain") {
      throw new PublicBookingStoreError(
        "booking_attempt_cas_failed",
        "The booking attempt could not be marked uncertain."
      );
    }
  }
  async markRejected(input) {
    const now = canonicalNow(this.#now);
    const results = await this.#database.batch([
      this.#database.prepare(
        `UPDATE public_booking_attempts
            SET state = 'rejected', response_json = NULL, rejection_code = ?,
                last_error_code = NULL, updated_at = ?
          WHERE workspace_id = ? AND principal_id = ? AND idempotency_key = ?
            AND request_hash = ? AND state IN ('pending', 'uncertain')`
      ).bind(
        input.rejectionCode,
        now,
        input.scope.workspace,
        input.scope.principal,
        input.idempotencyKey,
        input.requestHash
      ),
      this.#attemptSelect(input.scope.workspace, input.scope.principal, input.idempotencyKey)
    ]);
    const row = attemptRow(results[1]?.results[0]);
    if (!row || row.request_hash !== input.requestHash || row.state !== "rejected" || row.rejection_code !== input.rejectionCode) {
      throw new PublicBookingStoreError(
        "booking_attempt_cas_failed",
        "The booking attempt could not be rejected."
      );
    }
  }
  async markCommitted(input) {
    const response = publicBookingResult(input.response);
    if (!response) {
      throw new PublicBookingStoreError("invalid_store_input", "The booking response is invalid.");
    }
    const token = await deriveManagementToken(
      this.#managementKey,
      input.scope.workspace,
      input.scope.principal,
      response.bookingReference
    );
    const expectedManagementUrl = new URL(
      `/manage#${token}`,
      this.#managementOrigin
    ).toString();
    if (response.managementUrl !== expectedManagementUrl) {
      throw new PublicBookingStoreError(
        "invalid_store_input",
        "The booking response management URL is invalid."
      );
    }
    const responseJson = JSON.stringify({
      schemaVersion: response.schemaVersion,
      status: response.status,
      bookingReference: response.bookingReference,
      startsAt: response.startsAt,
      endsAt: response.endsAt
    });
    const now = canonicalNow(this.#now);
    const results = await this.#database.batch([
      this.#database.prepare(
        `UPDATE public_booking_attempts
            SET state = 'committed', response_json = ?, rejection_code = NULL,
                last_error_code = NULL, updated_at = ?
          WHERE workspace_id = ? AND principal_id = ? AND idempotency_key = ?
            AND request_hash = ? AND booking_reference = ?
            AND start_at = ? AND end_at = ?
            AND state IN ('pending', 'uncertain')`
      ).bind(
        responseJson,
        now,
        input.scope.workspace,
        input.scope.principal,
        input.idempotencyKey,
        input.requestHash,
        response.bookingReference,
        response.startsAt,
        response.endsAt
      ),
      this.#attemptSelect(input.scope.workspace, input.scope.principal, input.idempotencyKey)
    ]);
    const row = attemptRow(results[1]?.results[0]);
    const stored = row ? await this.#hydrateAttempt(row, input.scope.workspace, input.scope.principal) : null;
    if (!stored || stored.requestHash !== input.requestHash || stored.state !== "committed" || JSON.stringify(stored.response) !== JSON.stringify(response)) {
      throw new PublicBookingStoreError(
        "booking_attempt_cas_failed",
        "The booking attempt could not be committed."
      );
    }
  }
  async #hydrateAttempt(row, workspace, principal) {
    if (row.response_json === null) return toAttempt(row, null);
    const token = await deriveManagementToken(
      this.#managementKey,
      workspace,
      principal,
      row.booking_reference
    );
    const managementUrl = new URL(
      `/manage#${token}`,
      this.#managementOrigin
    ).toString();
    return toAttempt(row, managementUrl);
  }
  #attemptSelect(workspace, principal, idempotencyKey) {
    return this.#database.prepare(
      `SELECT idempotency_key, request_hash, provider_operation_id,
              booking_reference, revision_id, start_at, end_at,
              guest_name, guest_email, approval_expires_at, state,
              response_json, rejection_code
         FROM public_booking_attempts
        WHERE workspace_id = ? AND principal_id = ? AND idempotency_key = ?`
    ).bind(workspace, principal, idempotencyKey);
  }
};
var credentialRow = /* @__PURE__ */ __name((value) => {
  if (!isRecord5(value) || typeof value.booking_reference !== "string" || typeof value.workspace_id !== "string" || typeof value.principal_id !== "string" || typeof value.token_version !== "number" || typeof value.token_hash !== "string" || typeof value.page_id !== "string" || typeof value.revision_id !== "string" || typeof value.provider_booking_id !== "string" || typeof value.provider_operation_id !== "string" || typeof value.start_at !== "string" || typeof value.end_at !== "string" || typeof value.guest_name !== "string" || typeof value.guest_email !== "string" || value.approval_expires_at !== null && typeof value.approval_expires_at !== "string" || typeof value.status !== "string" || typeof value.destination_calendar_id !== "string" || typeof value.organizer_name !== "string" || typeof value.event_title !== "string" || typeof value.location_kind !== "string" || typeof value.location_label !== "string" || typeof value.time_zone !== "string" || typeof value.booking_status !== "string" || typeof value.version !== "number") {
    return null;
  }
  return {
    ...value,
    booking_reference: value.booking_reference,
    workspace_id: value.workspace_id,
    principal_id: value.principal_id,
    token_version: value.token_version,
    token_hash: value.token_hash,
    page_id: value.page_id,
    revision_id: value.revision_id,
    provider_booking_id: value.provider_booking_id,
    provider_operation_id: value.provider_operation_id,
    start_at: value.start_at,
    end_at: value.end_at,
    guest_name: value.guest_name,
    guest_email: value.guest_email,
    approval_expires_at: value.approval_expires_at,
    status: value.status,
    destination_calendar_id: value.destination_calendar_id,
    organizer_name: value.organizer_name,
    event_title: value.event_title,
    location_kind: value.location_kind,
    location_label: value.location_label,
    time_zone: value.time_zone,
    booking_status: value.booking_status,
    version: value.version
  };
}, "credentialRow");
async function publicBookingManagementTokenHash(token) {
  requiredText(token, "managementToken", 16, 512);
  if (!BASE64URL_PATTERN.test(token)) {
    throw new PublicBookingStoreError("invalid_management_token", "The management token is invalid.");
  }
  return sha2562(token);
}
__name(publicBookingManagementTokenHash, "publicBookingManagementTokenHash");
var D1PublicBookingManagementTokenIssuer = class {
  static {
    __name(this, "D1PublicBookingManagementTokenIssuer");
  }
  #database;
  #secret;
  #now;
  #key = null;
  constructor(database, options) {
    validateManagementSecret(options.secret);
    this.#database = database;
    this.#secret = options.secret;
    this.#now = options.now ?? Date.now;
  }
  async issue(input) {
    requiredText(input.scope.workspace, "workspace", 1, 255);
    requiredText(input.scope.principal, "principal", 1, 255);
    if (!BOOKING_REFERENCE_PATTERN2.test(input.bookingReference)) {
      throw new PublicBookingStoreError("invalid_store_input", "bookingReference is invalid.");
    }
    requiredText(input.pageId, "pageId", 8, 255);
    requiredText(input.revisionId, "revisionId", 8, 255);
    requiredText(input.destinationCalendarId, "destinationCalendarId", 1, 255);
    requiredText(input.providerBookingId, "providerBookingId", 1, 2048);
    requiredText(input.providerOperationId, "providerOperationId", 16, 255);
    canonicalInstant3(input.startsAt, "startsAt");
    canonicalInstant3(input.endsAt, "endsAt");
    const guestName = input.guest.name.trim();
    const guestEmail = input.guest.email.trim().toLowerCase();
    requiredText(guestName, "guest.name", 1, 160);
    requiredText(guestEmail, "guestEmail", 3, 320);
    requiredText(input.organizerName, "organizerName", 1, 160);
    requiredText(input.eventTitle, "eventTitle", 1, 160);
    if (!["google-meet", "phone", "in-person", "custom"].includes(input.location)) {
      throw new PublicBookingStoreError("invalid_store_input", "location is invalid.");
    }
    requiredText(input.locationLabel, "locationLabel", 1, 160);
    requiredText(input.timeZone, "timeZone", 1, 255);
    if (input.approvalExpiresAt !== null) {
      canonicalInstant3(input.approvalExpiresAt, "approvalExpiresAt");
    }
    if (Date.parse(input.endsAt) <= Date.parse(input.startsAt) || !guestEmail.includes("@") || guestName !== input.guest.name || guestEmail !== input.guest.email) {
      throw new PublicBookingStoreError("invalid_store_input", "The management credential is invalid.");
    }
    const token = await this.#token(input.scope.workspace, input.scope.principal, input.bookingReference);
    const tokenHash = await publicBookingManagementTokenHash(token);
    const now = canonicalNow(this.#now);
    const results = await this.#database.batch([
      this.#database.prepare(
        `INSERT OR IGNORE INTO public_booking_management_credentials (
           booking_reference, workspace_id, principal_id, token_version,
           token_hash, page_id, revision_id, provider_booking_id,
           provider_operation_id, start_at, end_at, guest_name, guest_email,
           approval_expires_at, status,
           destination_calendar_id, organizer_name, event_title,
           location_kind, location_label, time_zone, booking_status, version,
           created_at, updated_at, revoked_at
         )
         SELECT ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                'active', ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, NULL
          WHERE EXISTS (
            SELECT 1
              FROM public_booking_attempts
             WHERE booking_reference = ? AND workspace_id = ? AND principal_id = ?
               AND provider_operation_id = ? AND revision_id = ?
               AND start_at = ? AND end_at = ?
               AND guest_name = ? AND guest_email = ?
               AND approval_expires_at IS ?
               AND state IN ('pending', 'uncertain', 'committed')
          )`
      ).bind(
        input.bookingReference,
        input.scope.workspace,
        input.scope.principal,
        tokenHash,
        input.pageId,
        input.revisionId,
        input.providerBookingId,
        input.providerOperationId,
        input.startsAt,
        input.endsAt,
        guestName,
        guestEmail,
        input.approvalExpiresAt,
        input.destinationCalendarId,
        input.organizerName,
        input.eventTitle,
        input.location,
        input.locationLabel,
        input.timeZone,
        input.approvalExpiresAt === null ? "confirmed" : "pending",
        now,
        now,
        input.bookingReference,
        input.scope.workspace,
        input.scope.principal,
        input.providerOperationId,
        input.revisionId,
        input.startsAt,
        input.endsAt,
        guestName,
        guestEmail,
        input.approvalExpiresAt
      ),
      this.#database.prepare(
        `SELECT booking_reference, workspace_id, principal_id, token_version,
                token_hash, page_id, revision_id, provider_booking_id,
                provider_operation_id, start_at, end_at, guest_name,
                guest_email, approval_expires_at, status,
                destination_calendar_id, organizer_name, event_title,
                location_kind, location_label, time_zone, booking_status, version
           FROM public_booking_management_credentials
          WHERE booking_reference = ?`
      ).bind(input.bookingReference)
    ]);
    const stored = credentialRow(results[1]?.results[0]);
    if (!stored || stored.workspace_id !== input.scope.workspace || stored.principal_id !== input.scope.principal || stored.token_version !== 1 || stored.token_hash !== tokenHash || stored.page_id !== input.pageId || stored.revision_id !== input.revisionId || stored.provider_booking_id !== input.providerBookingId || stored.provider_operation_id !== input.providerOperationId || stored.start_at !== input.startsAt || stored.end_at !== input.endsAt || stored.guest_name !== guestName || stored.guest_email !== guestEmail || stored.approval_expires_at !== input.approvalExpiresAt || stored.status !== "active" || stored.destination_calendar_id !== input.destinationCalendarId || stored.organizer_name !== input.organizerName || stored.event_title !== input.eventTitle || stored.location_kind !== input.location || stored.location_label !== input.locationLabel || stored.time_zone !== input.timeZone || stored.booking_status !== (input.approvalExpiresAt === null ? "confirmed" : "pending") || stored.version !== 1) {
      throw new PublicBookingStoreError(
        "management_credential_conflict",
        "The management credential could not be persisted conclusively."
      );
    }
    return { token };
  }
  async #token(workspace, principal, bookingReference) {
    this.#key ??= importManagementKey(this.#secret);
    return deriveManagementToken(this.#key, workspace, principal, bookingReference);
  }
};
var delay = /* @__PURE__ */ __name((milliseconds, signal) => new Promise((resolve) => {
  if (signal.aborted) {
    resolve();
    return;
  }
  const onAbort = /* @__PURE__ */ __name(() => {
    clearTimeout(timer);
    resolve();
  }, "onAbort");
  const timer = setTimeout(() => {
    signal.removeEventListener("abort", onAbort);
    resolve();
  }, milliseconds);
  signal.addEventListener("abort", onAbort, { once: true });
}), "delay");
var D1PublicBookingSerializationBoundary = class {
  static {
    __name(this, "D1PublicBookingSerializationBoundary");
  }
  #database;
  #now;
  #leaseMilliseconds;
  #renewalMilliseconds;
  #acquisitionTimeoutMilliseconds;
  #retryMilliseconds;
  constructor(database, options = {}) {
    this.#database = database;
    this.#now = options.now ?? Date.now;
    this.#leaseMilliseconds = options.leaseMilliseconds ?? 3e4;
    this.#renewalMilliseconds = options.renewalMilliseconds ?? 1e4;
    this.#acquisitionTimeoutMilliseconds = options.acquisitionTimeoutMilliseconds ?? 15e3;
    this.#retryMilliseconds = options.retryMilliseconds ?? 50;
    if (this.#leaseMilliseconds < 1e3 || this.#renewalMilliseconds < 100 || this.#renewalMilliseconds * 2 >= this.#leaseMilliseconds || this.#acquisitionTimeoutMilliseconds < 0 || this.#retryMilliseconds < 10) {
      throw new PublicBookingStoreError("owner_lease_invalid", "The owner lease configuration is invalid.");
    }
  }
  async runExclusive(coordinationKey, operation) {
    requiredText(coordinationKey, "coordinationKey", 16, 255);
    const leaseToken = crypto.randomUUID();
    await this.#acquire(coordinationKey, leaseToken);
    const renewalController = new AbortController();
    let leaseFailure = null;
    const renewal = this.#renew(coordinationKey, leaseToken, renewalController.signal).catch((error) => {
      leaseFailure = error;
    });
    let outcome = null;
    let operationFailure = null;
    try {
      outcome = { value: await operation() };
    } catch (error) {
      operationFailure = error;
    } finally {
      renewalController.abort();
      await renewal;
      try {
        const released = await this.#database.prepare(
          `UPDATE public_booking_owner_leases
              SET lease_token = NULL, lease_until = NULL, updated_at = ?
            WHERE coordination_key = ? AND lease_token = ?`
        ).bind(canonicalNow(this.#now), coordinationKey, leaseToken).run();
        if (Number(released.meta.changes ?? 0) !== 1 && !operationFailure && !leaseFailure) {
          leaseFailure = new PublicBookingStoreError(
            "owner_lease_lost",
            "The public booking owner lease was lost before release."
          );
        }
      } catch (error) {
        if (!operationFailure && !leaseFailure) leaseFailure = error;
      }
    }
    if (operationFailure) throw operationFailure;
    if (leaseFailure || !outcome) {
      throw new PublicBookingStoreError(
        "owner_lease_lost",
        "The public booking owner lease was lost during the operation."
      );
    }
    return outcome.value;
  }
  async #acquire(coordinationKey, leaseToken) {
    const startedAt = Date.now();
    do {
      const now = canonicalNow(this.#now);
      const leaseUntil = new Date(Date.parse(now) + this.#leaseMilliseconds).toISOString();
      const claimed = await this.#database.prepare(
        `INSERT INTO public_booking_owner_leases (
           coordination_key, lease_token, lease_until, updated_at
         ) VALUES (?, ?, ?, ?)
         ON CONFLICT (coordination_key) DO UPDATE SET
           lease_token = excluded.lease_token,
           lease_until = excluded.lease_until,
           updated_at = excluded.updated_at
         WHERE public_booking_owner_leases.lease_token IS NULL
            OR public_booking_owner_leases.lease_until <= excluded.updated_at`
      ).bind(coordinationKey, leaseToken, leaseUntil, now).run();
      if (Number(claimed.meta.changes ?? 0) === 1) return;
      if (Date.now() - startedAt >= this.#acquisitionTimeoutMilliseconds) break;
      await delay(this.#retryMilliseconds, new AbortController().signal);
    } while (Date.now() - startedAt <= this.#acquisitionTimeoutMilliseconds);
    throw new PublicBookingStoreError(
      "owner_lease_unavailable",
      "The public booking owner is already processing another booking."
    );
  }
  async #renew(coordinationKey, leaseToken, signal) {
    while (!signal.aborted) {
      await delay(this.#renewalMilliseconds, signal);
      if (signal.aborted) return;
      const now = canonicalNow(this.#now);
      const leaseUntil = new Date(Date.parse(now) + this.#leaseMilliseconds).toISOString();
      const renewed = await this.#database.prepare(
        `UPDATE public_booking_owner_leases
            SET lease_until = ?, updated_at = ?
          WHERE coordination_key = ? AND lease_token = ? AND lease_until > ?`
      ).bind(leaseUntil, now, coordinationKey, leaseToken, now).run();
      if (Number(renewed.meta.changes ?? 0) !== 1) {
        throw new PublicBookingStoreError(
          "owner_lease_lost",
          "The public booking owner lease expired during the operation."
        );
      }
    }
  }
};

// src/public-booking-management-store.ts
var TOKEN_PATTERN2 = /^tapm_v1_[A-Za-z0-9_-]{43}$/u;
var UUID_PATTERN3 = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
var BASE64URL_PATTERN2 = /^[A-Za-z0-9_-]+$/u;
var UNMATCHABLE_TOKEN = `tapm_v1_${"0".repeat(43)}`;
var PublicBookingManagementStoreError = class extends Error {
  static {
    __name(this, "PublicBookingManagementStoreError");
  }
  code;
  constructor(code, message2) {
    super(message2);
    this.name = "PublicBookingManagementStoreError";
    this.code = code;
  }
};
var isRecord6 = /* @__PURE__ */ __name((value) => Boolean(value) && typeof value === "object" && !Array.isArray(value), "isRecord");
var requiredText2 = /* @__PURE__ */ __name((value, field, minimum, maximum) => {
  if (value.length < minimum || value.length > maximum || value.trim() !== value) {
    throw new PublicBookingManagementStoreError("invalid_store_input", `${field} is invalid.`);
  }
  return value;
}, "requiredText");
var canonicalInstant4 = /* @__PURE__ */ __name((value, field) => {
  requiredText2(value, field, 20, 40);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new PublicBookingManagementStoreError("invalid_store_input", `${field} is invalid.`);
  }
  return value;
}, "canonicalInstant");
var canonicalNow2 = /* @__PURE__ */ __name((clock) => {
  const now = clock();
  if (!Number.isFinite(now)) {
    throw new PublicBookingManagementStoreError("invalid_store_clock", "The management clock is invalid.");
  }
  return new Date(now).toISOString();
}, "canonicalNow");
var validTimeZone2 = /* @__PURE__ */ __name((value) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}, "validTimeZone");
var credentialRow2 = /* @__PURE__ */ __name((value) => {
  if (!isRecord6(value) || typeof value.booking_reference !== "string" || typeof value.workspace_id !== "string" || typeof value.principal_id !== "string" || typeof value.token_version !== "number" || typeof value.page_id !== "string" || typeof value.revision_id !== "string" || typeof value.destination_calendar_id !== "string" || typeof value.provider_booking_id !== "string" || typeof value.provider_operation_id !== "string" || typeof value.provider_commit_proof !== "string" || typeof value.version !== "number" || typeof value.booking_status !== "string" || typeof value.start_at !== "string" || typeof value.end_at !== "string" || typeof value.guest_name !== "string" || typeof value.guest_email !== "string" || value.approval_expires_at !== null && typeof value.approval_expires_at !== "string" || typeof value.organizer_name !== "string" || typeof value.event_title !== "string" || typeof value.location_kind !== "string" || typeof value.location_label !== "string" || typeof value.time_zone !== "string" || typeof value.status !== "string" || value.cancelled_at !== null && typeof value.cancelled_at !== "string") return null;
  return {
    ...value,
    booking_reference: value.booking_reference,
    workspace_id: value.workspace_id,
    principal_id: value.principal_id,
    token_version: value.token_version,
    page_id: value.page_id,
    revision_id: value.revision_id,
    destination_calendar_id: value.destination_calendar_id,
    provider_booking_id: value.provider_booking_id,
    provider_operation_id: value.provider_operation_id,
    provider_commit_proof: value.provider_commit_proof,
    version: value.version,
    booking_status: value.booking_status,
    start_at: value.start_at,
    end_at: value.end_at,
    guest_name: value.guest_name,
    guest_email: value.guest_email,
    approval_expires_at: value.approval_expires_at,
    organizer_name: value.organizer_name,
    event_title: value.event_title,
    location_kind: value.location_kind,
    location_label: value.location_label,
    time_zone: value.time_zone,
    status: value.status,
    cancelled_at: value.cancelled_at
  };
}, "credentialRow");
var toRecord = /* @__PURE__ */ __name((row) => {
  const expectedStatus = row.status === "cancelled" ? "cancelled" : row.booking_status;
  if (row.token_version !== 1 || !["active", "cancelled"].includes(row.status) || !["confirmed", "pending", "declined", "expired", "cancelled"].includes(expectedStatus) || !Number.isSafeInteger(row.version) || row.version < 1 || row.booking_reference.length < 16 || row.booking_reference.length > 128 || row.workspace_id.length < 1 || row.workspace_id.length > 255 || row.principal_id.length < 1 || row.principal_id.length > 255 || row.page_id.length < 8 || row.page_id.length > 255 || row.revision_id.length < 8 || row.revision_id.length > 255 || row.destination_calendar_id.length < 1 || row.destination_calendar_id.length > 255 || row.provider_booking_id.length < 1 || row.provider_booking_id.length > 2048 || row.provider_operation_id.length < 16 || row.provider_operation_id.length > 255 || row.provider_commit_proof.length < 16 || row.provider_commit_proof.length > 128 || row.guest_name.length < 1 || row.guest_name.length > 160 || row.guest_email.length < 3 || row.guest_email.length > 320 || row.guest_email.trim().toLowerCase() !== row.guest_email || !row.guest_email.includes("@") || row.organizer_name.length < 1 || row.organizer_name.length > 160 || row.event_title.length < 1 || row.event_title.length > 160 || !["google-meet", "phone", "in-person", "custom"].includes(row.location_kind) || row.location_label.length < 1 || row.location_label.length > 160 || !validTimeZone2(row.time_zone) || row.status === "cancelled" !== (row.cancelled_at !== null) || row.status === "cancelled" !== (row.booking_status === "cancelled") || ["pending", "declined", "expired"].includes(row.booking_status) && row.approval_expires_at === null) {
    throw new PublicBookingManagementStoreError("corrupt_management_record", "The management record is invalid.");
  }
  canonicalInstant4(row.start_at, "start_at");
  canonicalInstant4(row.end_at, "end_at");
  if (Date.parse(row.end_at) <= Date.parse(row.start_at)) {
    throw new PublicBookingManagementStoreError("corrupt_management_record", "The management interval is invalid.");
  }
  if (row.approval_expires_at !== null) canonicalInstant4(row.approval_expires_at, "approval_expires_at");
  if (row.cancelled_at !== null) canonicalInstant4(row.cancelled_at, "cancelled_at");
  return {
    bookingReference: row.booking_reference,
    scope: { workspace: row.workspace_id, principal: row.principal_id },
    tokenVersion: 1,
    pageId: row.page_id,
    revisionId: row.revision_id,
    destinationCalendarId: row.destination_calendar_id,
    providerBookingId: row.provider_booking_id,
    providerOperationId: row.provider_operation_id,
    providerCommitProof: row.provider_commit_proof,
    version: row.version,
    status: expectedStatus,
    startsAt: row.start_at,
    endsAt: row.end_at,
    guest: { name: row.guest_name, email: row.guest_email },
    approvalExpiresAt: row.approval_expires_at,
    organizerName: row.organizer_name,
    eventTitle: row.event_title,
    location: row.location_kind,
    locationLabel: row.location_label,
    timeZone: row.time_zone,
    cancelledAt: row.cancelled_at
  };
}, "toRecord");
var parseDto = /* @__PURE__ */ __name((value) => {
  if (value === null) return null;
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new PublicBookingManagementStoreError("corrupt_management_mutation", "The mutation response is invalid.");
  }
  if (!isRecord6(parsed) || parsed.schemaVersion !== "tap.calendar.public-management.v1" || typeof parsed.bookingReference !== "string" || typeof parsed.bookingVersion !== "number" || !["confirmed", "pending", "declined", "expired", "cancelled"].includes(String(parsed.status)) || !isRecord6(parsed.guest) || typeof parsed.guest.name !== "string" || typeof parsed.guest.email !== "string" || !isRecord6(parsed.host) || typeof parsed.host.displayName !== "string" || !isRecord6(parsed.event) || typeof parsed.event.title !== "string" || typeof parsed.event.startsAt !== "string" || typeof parsed.event.endsAt !== "string" || typeof parsed.event.durationMinutes !== "number" || !["google-meet", "phone", "in-person", "custom"].includes(String(parsed.event.location)) || typeof parsed.event.locationLabel !== "string" || !(parsed.event.approvalExpiresAt === null || typeof parsed.event.approvalExpiresAt === "string") || !isRecord6(parsed.actions) || typeof parsed.actions.canCancel !== "boolean" || typeof parsed.actions.canReschedule !== "boolean" || !(parsed.reschedulePage === null || isRecord6(parsed.reschedulePage))) {
    throw new PublicBookingManagementStoreError("corrupt_management_mutation", "The mutation response is invalid.");
  }
  const guest = parsed.guest;
  const host = parsed.host;
  const event = parsed.event;
  const actions = parsed.actions;
  let reschedulePage = null;
  if (isRecord6(parsed.reschedulePage)) {
    const page = parsed.reschedulePage;
    if (typeof page.profileSlug !== "string" || typeof page.eventTypeSlug !== "string" || typeof page.pageRevision !== "string" || typeof page.turnstileSiteKey !== "string" || !isRecord6(page.bookingWindow) || typeof page.bookingWindow.firstDate !== "string" || typeof page.bookingWindow.lastDate !== "string") {
      throw new PublicBookingManagementStoreError("corrupt_management_mutation", "The mutation response is invalid.");
    }
    reschedulePage = {
      profileSlug: page.profileSlug,
      eventTypeSlug: page.eventTypeSlug,
      pageRevision: page.pageRevision,
      bookingWindow: {
        firstDate: page.bookingWindow.firstDate,
        lastDate: page.bookingWindow.lastDate
      },
      turnstileSiteKey: page.turnstileSiteKey
    };
  }
  return {
    schemaVersion: "tap.calendar.public-management.v1",
    bookingReference: parsed.bookingReference,
    bookingVersion: parsed.bookingVersion,
    status: parsed.status,
    guest: { name: String(guest.name), email: String(guest.email) },
    host: { displayName: String(host.displayName) },
    event: {
      title: String(event.title),
      startsAt: String(event.startsAt),
      endsAt: String(event.endsAt),
      durationMinutes: Number(event.durationMinutes),
      location: event.location,
      locationLabel: String(event.locationLabel),
      approvalExpiresAt: event.approvalExpiresAt === null ? null : String(event.approvalExpiresAt)
    },
    actions: {
      canCancel: Boolean(actions.canCancel),
      canReschedule: Boolean(actions.canReschedule)
    },
    reschedulePage
  };
}, "parseDto");
var mutationRow = /* @__PURE__ */ __name((value) => {
  if (!isRecord6(value) || typeof value.booking_reference !== "string" || typeof value.request_id !== "string" || typeof value.request_hash !== "string" || typeof value.operation_id !== "string" || typeof value.kind !== "string" || typeof value.expected_version !== "number" || value.page_revision_id !== null && typeof value.page_revision_id !== "string" || typeof value.from_start_at !== "string" || typeof value.from_end_at !== "string" || value.to_start_at !== null && typeof value.to_start_at !== "string" || value.to_end_at !== null && typeof value.to_end_at !== "string" || value.conflict_calendar_ids_json !== null && typeof value.conflict_calendar_ids_json !== "string" || value.conflict_start_at !== null && typeof value.conflict_start_at !== "string" || value.conflict_end_at !== null && typeof value.conflict_end_at !== "string" || typeof value.state !== "string" || value.response_json !== null && typeof value.response_json !== "string" || value.rejection_code !== null && typeof value.rejection_code !== "string") return null;
  return {
    ...value,
    booking_reference: value.booking_reference,
    request_id: value.request_id,
    request_hash: value.request_hash,
    operation_id: value.operation_id,
    kind: value.kind,
    expected_version: value.expected_version,
    page_revision_id: value.page_revision_id,
    from_start_at: value.from_start_at,
    from_end_at: value.from_end_at,
    to_start_at: value.to_start_at,
    to_end_at: value.to_end_at,
    conflict_calendar_ids_json: value.conflict_calendar_ids_json,
    conflict_start_at: value.conflict_start_at,
    conflict_end_at: value.conflict_end_at,
    state: value.state,
    response_json: value.response_json,
    rejection_code: value.rejection_code
  };
}, "mutationRow");
var parseCalendarIds = /* @__PURE__ */ __name((value) => {
  if (value === null) return [];
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new PublicBookingManagementStoreError("corrupt_management_mutation", "The conflict set is invalid.");
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 50 || parsed.some((item) => typeof item !== "string" || item.length < 1 || item.length > 255) || new Set(parsed).size !== parsed.length) {
    throw new PublicBookingManagementStoreError("corrupt_management_mutation", "The conflict set is invalid.");
  }
  return parsed;
}, "parseCalendarIds");
var toMutation = /* @__PURE__ */ __name((row) => {
  if (!UUID_PATTERN3.test(row.request_id) || !BASE64URL_PATTERN2.test(row.request_hash) || row.request_hash.length < 16 || row.request_hash.length > 128 || !BASE64URL_PATTERN2.test(row.operation_id) || row.operation_id.length < 16 || row.operation_id.length > 128 || !["cancel", "reschedule"].includes(row.kind) || !["pending", "uncertain", "committed", "rejected"].includes(row.state) || !Number.isSafeInteger(row.expected_version) || row.expected_version < 1 || row.rejection_code !== null && !["slot_conflict", "provider_mismatch"].includes(row.rejection_code)) {
    throw new PublicBookingManagementStoreError("corrupt_management_mutation", "The mutation record is invalid.");
  }
  canonicalInstant4(row.from_start_at, "from_start_at");
  canonicalInstant4(row.from_end_at, "from_end_at");
  if (row.to_start_at !== null) canonicalInstant4(row.to_start_at, "to_start_at");
  if (row.to_end_at !== null) canonicalInstant4(row.to_end_at, "to_end_at");
  if (row.conflict_start_at !== null) canonicalInstant4(row.conflict_start_at, "conflict_start_at");
  if (row.conflict_end_at !== null) canonicalInstant4(row.conflict_end_at, "conflict_end_at");
  const conflictCalendarIds = parseCalendarIds(row.conflict_calendar_ids_json);
  if (row.kind === "cancel" && (row.page_revision_id !== null || row.to_start_at !== null || row.to_end_at !== null || conflictCalendarIds.length > 0 || row.conflict_start_at !== null || row.conflict_end_at !== null) || row.kind === "reschedule" && (row.page_revision_id === null || row.to_start_at === null || row.to_end_at === null || conflictCalendarIds.length === 0 || row.conflict_start_at === null || row.conflict_end_at === null) || row.state === "committed" !== (row.response_json !== null) || row.state === "rejected" !== (row.rejection_code !== null)) {
    throw new PublicBookingManagementStoreError("corrupt_management_mutation", "The mutation record is incomplete.");
  }
  return {
    bookingReference: row.booking_reference,
    requestId: row.request_id,
    requestHash: row.request_hash,
    operationId: row.operation_id,
    kind: row.kind,
    expectedVersion: row.expected_version,
    pageRevisionId: row.page_revision_id,
    fromStartsAt: row.from_start_at,
    fromEndsAt: row.from_end_at,
    toStartsAt: row.to_start_at,
    toEndsAt: row.to_end_at,
    conflictCalendarIds,
    conflictStart: row.conflict_start_at,
    conflictEnd: row.conflict_end_at,
    state: row.state,
    response: parseDto(row.response_json),
    rejectionCode: row.rejection_code
  };
}, "toMutation");
var credentialSelect = `SELECT credentials.booking_reference,
       credentials.workspace_id, credentials.principal_id,
       credentials.token_version, credentials.page_id, credentials.revision_id,
       credentials.destination_calendar_id, credentials.provider_booking_id,
       credentials.provider_operation_id,
       attempts.request_hash AS provider_commit_proof,
       credentials.version, credentials.booking_status,
       credentials.start_at, credentials.end_at,
       credentials.guest_name, credentials.guest_email,
       credentials.approval_expires_at, credentials.organizer_name,
       credentials.event_title, credentials.location_label,
       credentials.location_kind,
       credentials.time_zone, credentials.status, credentials.cancelled_at
  FROM public_booking_management_credentials AS credentials
  INNER JOIN public_booking_attempts AS attempts
    ON attempts.booking_reference = credentials.booking_reference`;
var mutationSelect = `SELECT booking_reference, request_id, request_hash,
       operation_id, kind, expected_version, page_revision_id,
       from_start_at, from_end_at, to_start_at, to_end_at,
       conflict_calendar_ids_json, conflict_start_at, conflict_end_at,
       state, response_json, rejection_code
  FROM public_booking_management_mutations`;
var approvalEmailKind = /* @__PURE__ */ __name((status) => {
  if (status === "confirmed") return "approval-approved";
  return status === "declined" ? "approval-declined" : "approval-expired";
}, "approvalEmailKind");
var approvalTransitionSuccess = /* @__PURE__ */ __name((kind, record, status) => {
  const emailKind = approvalEmailKind(status);
  return {
    kind,
    status,
    bookingVersion: record.version,
    notice: {
      eventKey: `${emailKind}:${record.bookingReference}`,
      bookingReference: record.bookingReference,
      scope: record.scope,
      kind: emailKind,
      recipient: record.guest,
      organizerName: record.organizerName,
      eventTitle: record.eventTitle,
      startsAt: record.startsAt,
      endsAt: record.endsAt,
      timeZone: record.timeZone
    }
  };
}, "approvalTransitionSuccess");
var D1PublicBookingManagementStore = class {
  static {
    __name(this, "D1PublicBookingManagementStore");
  }
  #database;
  #now;
  constructor(database, options = {}) {
    this.#database = database;
    this.#now = options.now ?? Date.now;
  }
  async resolve(token) {
    const plausible = TOKEN_PATTERN2.test(token);
    const hash = await publicBookingManagementTokenHash(plausible ? token : UNMATCHABLE_TOKEN);
    const row = credentialRow2(await this.#database.prepare(
      `${credentialSelect}
        WHERE credentials.token_hash = ?
          AND credentials.status <> 'revoked'
        LIMIT 1`
    ).bind(hash).first());
    if (!plausible || !row) return null;
    return toRecord(row);
  }
  async transitionApproval(input) {
    requiredText2(input.scope.workspace, "scope.workspace", 1, 255);
    requiredText2(input.scope.principal, "scope.principal", 1, 255);
    requiredText2(input.providerOperationId, "providerOperationId", 16, 255);
    if (!["confirmed", "declined", "expired"].includes(input.targetStatus)) {
      throw new PublicBookingManagementStoreError("invalid_store_input", "targetStatus is invalid.");
    }
    const now = canonicalNow2(this.#now);
    const results = await this.#database.batch([
      this.#database.prepare(
        `UPDATE public_booking_management_credentials
            SET booking_status = ?, version = version + 1, updated_at = ?
          WHERE workspace_id = ? AND principal_id = ?
            AND provider_operation_id = ?
            AND status = 'active' AND booking_status = 'pending'
            AND approval_expires_at IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM public_booking_management_mutations AS open_mutation
               WHERE open_mutation.booking_reference = public_booking_management_credentials.booking_reference
                 AND open_mutation.state IN ('pending', 'uncertain')
            )
            AND (
              (? = 'expired' AND approval_expires_at <= ?) OR
              (? <> 'expired' AND approval_expires_at > ?)
            )`
      ).bind(
        input.targetStatus,
        now,
        input.scope.workspace,
        input.scope.principal,
        input.providerOperationId,
        input.targetStatus,
        now,
        input.targetStatus,
        now
      ),
      this.#database.prepare(
        `${credentialSelect}
          WHERE credentials.workspace_id = ? AND credentials.principal_id = ?
            AND credentials.provider_operation_id = ?
          LIMIT 1`
      ).bind(input.scope.workspace, input.scope.principal, input.providerOperationId),
      this.#database.prepare(
        `SELECT mutations.request_id
           FROM public_booking_management_mutations AS mutations
           INNER JOIN public_booking_management_credentials AS credentials
             ON credentials.booking_reference = mutations.booking_reference
          WHERE credentials.workspace_id = ? AND credentials.principal_id = ?
            AND credentials.provider_operation_id = ?
            AND mutations.state IN ('pending', 'uncertain')
          LIMIT 1`
      ).bind(input.scope.workspace, input.scope.principal, input.providerOperationId)
    ]);
    const row = credentialRow2(results[1]?.results[0]);
    if (!row) return { kind: "not-found" };
    const changed = Number(results[0]?.meta.changes ?? 0) === 1;
    const currentStatus = row.status === "cancelled" ? "cancelled" : row.status === "active" && [
      "confirmed",
      "pending",
      "declined",
      "expired",
      "cancelled"
    ].includes(row.booking_status) ? row.booking_status : "unavailable";
    if (row.status === "active" && currentStatus === input.targetStatus) {
      return approvalTransitionSuccess(
        changed ? "transitioned" : "existing",
        toRecord(row),
        input.targetStatus
      );
    }
    if (row.status === "active" && currentStatus === "pending" && row.approval_expires_at !== null) {
      canonicalInstant4(row.approval_expires_at, "approval_expires_at");
      const deadlineAllows = input.targetStatus === "expired" ? row.approval_expires_at <= now : row.approval_expires_at > now;
      const openMutation = results[2]?.results[0];
      if (deadlineAllows && openMutation?.request_id) return { kind: "mutation-conflict" };
      if (!deadlineAllows) {
        return { kind: "deadline-conflict", approvalExpiresAt: row.approval_expires_at };
      }
      throw new PublicBookingManagementStoreError(
        "approval_transition_invariant_failed",
        "The approval lifecycle transition could not be persisted conclusively."
      );
    }
    return { kind: "status-conflict", currentStatus };
  }
  async findMutation(input) {
    requiredText2(input.bookingReference, "bookingReference", 16, 128);
    if (!UUID_PATTERN3.test(input.requestId)) {
      throw new PublicBookingManagementStoreError("invalid_store_input", "requestId is invalid.");
    }
    const row = mutationRow(await this.#database.prepare(
      `${mutationSelect} WHERE booking_reference = ? AND request_id = ? LIMIT 1`
    ).bind(input.bookingReference, input.requestId).first());
    return row ? toMutation(row) : null;
  }
  async claimMutation(input) {
    this.#validateClaim(input);
    const now = canonicalNow2(this.#now);
    const calendarIdsJson = input.kind === "reschedule" ? JSON.stringify(input.conflictCalendarIds) : null;
    const results = await this.#database.batch([
      this.#database.prepare(
        `INSERT OR IGNORE INTO public_booking_management_mutations (
           booking_reference, request_id, request_hash, operation_id, kind,
           expected_version, page_revision_id, from_start_at, from_end_at,
           to_start_at, to_end_at, conflict_calendar_ids_json,
           conflict_start_at, conflict_end_at, state, response_json,
           rejection_code, last_error_code, created_at, updated_at
         )
         SELECT credentials.booking_reference, ?, ?, ?, ?, ?, ?,
                credentials.start_at, credentials.end_at, ?, ?, ?, ?, ?,
                'pending', NULL, NULL, NULL, ?, ?
           FROM public_booking_management_credentials AS credentials
          WHERE credentials.booking_reference = ?
            AND credentials.version = ?
            AND credentials.status = 'active'
            AND (
              (? = 'cancel' AND credentials.booking_status IN ('confirmed', 'pending')) OR
              (? = 'reschedule' AND credentials.booking_status = 'confirmed')
            )
            AND NOT EXISTS (
              SELECT 1 FROM public_booking_management_mutations AS open_mutation
               WHERE open_mutation.booking_reference = credentials.booking_reference
                 AND open_mutation.state IN ('pending', 'uncertain')
            )`
      ).bind(
        input.requestId,
        input.requestHash,
        input.operationId,
        input.kind,
        input.expectedVersion,
        input.pageRevisionId,
        input.toStartsAt,
        input.toEndsAt,
        calendarIdsJson,
        input.conflictStart,
        input.conflictEnd,
        now,
        now,
        input.booking.bookingReference,
        input.expectedVersion,
        input.kind,
        input.kind
      ),
      this.#database.prepare(
        `${mutationSelect} WHERE booking_reference = ? AND request_id = ? LIMIT 1`
      ).bind(input.booking.bookingReference, input.requestId),
      this.#database.prepare(
        `SELECT version, status, booking_status
           FROM public_booking_management_credentials
          WHERE booking_reference = ?`
      ).bind(input.booking.bookingReference),
      this.#database.prepare(
        `SELECT request_id
           FROM public_booking_management_mutations
          WHERE booking_reference = ? AND state IN ('pending', 'uncertain')
          LIMIT 1`
      ).bind(input.booking.bookingReference)
    ]);
    const persistedRow = mutationRow(results[1]?.results[0]);
    if (persistedRow) {
      const persisted = toMutation(persistedRow);
      if (persisted.requestHash !== input.requestHash || persisted.operationId !== input.operationId || persisted.kind !== input.kind || persisted.expectedVersion !== input.expectedVersion) return { kind: "idempotency-conflict" };
      return Number(results[0]?.meta.changes ?? 0) === 1 ? { kind: "claimed", mutation: persisted } : { kind: "existing", mutation: persisted };
    }
    const aggregate = results[2]?.results[0];
    if (!aggregate || aggregate.version !== input.expectedVersion || aggregate.status !== "active" || input.kind === "reschedule" && aggregate.booking_status !== "confirmed" || input.kind === "cancel" && !["confirmed", "pending"].includes(aggregate.booking_status)) return { kind: "version-conflict" };
    const open = results[3]?.results[0];
    if (open?.request_id) return { kind: "mutation-in-progress" };
    throw new PublicBookingManagementStoreError(
      "management_claim_invariant_failed",
      "The management mutation could not be claimed conclusively."
    );
  }
  async markUncertain(input) {
    requiredText2(input.errorCode, "errorCode", 1, 128);
    const now = canonicalNow2(this.#now);
    const results = await this.#database.batch([
      this.#database.prepare(
        `UPDATE public_booking_management_mutations
            SET state = 'uncertain', last_error_code = ?, updated_at = ?
          WHERE booking_reference = ? AND request_id = ? AND request_hash = ?
            AND state IN ('pending', 'uncertain')`
      ).bind(input.errorCode, now, input.bookingReference, input.requestId, input.requestHash),
      this.#database.prepare(
        `${mutationSelect} WHERE booking_reference = ? AND request_id = ? LIMIT 1`
      ).bind(input.bookingReference, input.requestId)
    ]);
    const row = mutationRow(results[1]?.results[0]);
    if (!row || row.request_hash !== input.requestHash || row.state !== "uncertain") {
      throw new PublicBookingManagementStoreError("management_mutation_cas_failed", "The mutation could not be marked uncertain.");
    }
  }
  async markRejected(input) {
    const now = canonicalNow2(this.#now);
    const results = await this.#database.batch([
      this.#database.prepare(
        `UPDATE public_booking_management_mutations
            SET state = 'rejected', rejection_code = ?, response_json = NULL,
                last_error_code = NULL, updated_at = ?
          WHERE booking_reference = ? AND request_id = ? AND request_hash = ?
            AND state IN ('pending', 'uncertain', 'rejected')`
      ).bind(input.rejectionCode, now, input.bookingReference, input.requestId, input.requestHash),
      this.#database.prepare(
        `${mutationSelect} WHERE booking_reference = ? AND request_id = ? LIMIT 1`
      ).bind(input.bookingReference, input.requestId)
    ]);
    const row = mutationRow(results[1]?.results[0]);
    if (!row || row.request_hash !== input.requestHash || row.state !== "rejected" || row.rejection_code !== input.rejectionCode) {
      throw new PublicBookingManagementStoreError("management_mutation_cas_failed", "The mutation could not be rejected.");
    }
  }
  async commitCancellation(input) {
    this.#validateCommit(input.booking, input.mutation, input.response, "cancel");
    const now = canonicalNow2(this.#now);
    const responseJson = JSON.stringify(input.response);
    const results = await this.#database.batch([
      this.#database.prepare(
        `UPDATE public_booking_management_credentials
            SET version = version + 1, status = 'cancelled',
                booking_status = 'cancelled', cancelled_at = ?, updated_at = ?
          WHERE booking_reference = ? AND version = ? AND status = 'active'
            AND provider_booking_id = ? AND provider_operation_id = ?
            AND start_at = ? AND end_at = ?`
      ).bind(
        now,
        now,
        input.booking.bookingReference,
        input.booking.version,
        input.booking.providerBookingId,
        input.booking.providerOperationId,
        input.booking.startsAt,
        input.booking.endsAt
      ),
      this.#database.prepare(
        `UPDATE public_booking_management_mutations
            SET state = 'committed', response_json = ?, rejection_code = NULL,
                last_error_code = NULL, updated_at = ?
          WHERE booking_reference = ? AND request_id = ? AND request_hash = ?
            AND expected_version = ? AND state IN ('pending', 'uncertain')
            AND EXISTS (
              SELECT 1 FROM public_booking_management_credentials AS credentials
               WHERE credentials.booking_reference = public_booking_management_mutations.booking_reference
                 AND credentials.version = ? AND credentials.status = 'cancelled'
            )`
      ).bind(
        responseJson,
        now,
        input.booking.bookingReference,
        input.mutation.requestId,
        input.mutation.requestHash,
        input.booking.version,
        input.booking.version + 1
      ),
      this.#credentialByReference(input.booking.bookingReference),
      this.#database.prepare(
        `${mutationSelect} WHERE booking_reference = ? AND request_id = ? LIMIT 1`
      ).bind(input.booking.bookingReference, input.mutation.requestId)
    ]);
    return this.#validateCommittedResults(results, input, "cancel");
  }
  async commitReschedule(input) {
    this.#validateCommit(input.booking, input.mutation, input.response, "reschedule");
    requiredText2(input.currentPageRevisionId, "currentPageRevisionId", 8, 255);
    const newStart = input.mutation.toStartsAt;
    const newEnd = input.mutation.toEndsAt;
    const now = canonicalNow2(this.#now);
    const responseJson = JSON.stringify(input.response);
    const results = await this.#database.batch([
      this.#database.prepare(
        `UPDATE public_booking_management_credentials
            SET version = version + 1, revision_id = ?, start_at = ?, end_at = ?,
                updated_at = ?
          WHERE booking_reference = ? AND version = ? AND status = 'active'
            AND booking_status = 'confirmed' AND destination_calendar_id = ?
            AND provider_booking_id = ? AND provider_operation_id = ?
            AND start_at = ? AND end_at = ?`
      ).bind(
        input.currentPageRevisionId,
        newStart,
        newEnd,
        now,
        input.booking.bookingReference,
        input.booking.version,
        input.booking.destinationCalendarId,
        input.booking.providerBookingId,
        input.booking.providerOperationId,
        input.booking.startsAt,
        input.booking.endsAt
      ),
      this.#database.prepare(
        `UPDATE public_booking_management_mutations
            SET state = 'committed', response_json = ?, rejection_code = NULL,
                last_error_code = NULL, updated_at = ?
          WHERE booking_reference = ? AND request_id = ? AND request_hash = ?
            AND expected_version = ? AND page_revision_id = ?
            AND state IN ('pending', 'uncertain')
            AND EXISTS (
              SELECT 1 FROM public_booking_management_credentials AS credentials
               WHERE credentials.booking_reference = public_booking_management_mutations.booking_reference
                 AND credentials.version = ? AND credentials.status = 'active'
                 AND credentials.start_at = ? AND credentials.end_at = ?
            )`
      ).bind(
        responseJson,
        now,
        input.booking.bookingReference,
        input.mutation.requestId,
        input.mutation.requestHash,
        input.booking.version,
        input.currentPageRevisionId,
        input.booking.version + 1,
        newStart,
        newEnd
      ),
      this.#credentialByReference(input.booking.bookingReference),
      this.#database.prepare(
        `${mutationSelect} WHERE booking_reference = ? AND request_id = ? LIMIT 1`
      ).bind(input.booking.bookingReference, input.mutation.requestId)
    ]);
    return this.#validateCommittedResults(results, input, "reschedule");
  }
  #credentialByReference(bookingReference) {
    return this.#database.prepare(
      `${credentialSelect} WHERE credentials.booking_reference = ? LIMIT 1`
    ).bind(bookingReference);
  }
  #validateClaim(input) {
    requiredText2(input.booking.bookingReference, "bookingReference", 16, 128);
    if (!UUID_PATTERN3.test(input.requestId)) {
      throw new PublicBookingManagementStoreError("invalid_store_input", "requestId is invalid.");
    }
    requiredText2(input.requestHash, "requestHash", 16, 128);
    requiredText2(input.operationId, "operationId", 16, 128);
    if (!BASE64URL_PATTERN2.test(input.requestHash) || !BASE64URL_PATTERN2.test(input.operationId)) {
      throw new PublicBookingManagementStoreError("invalid_store_input", "The mutation hashes are invalid.");
    }
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw new PublicBookingManagementStoreError("invalid_store_input", "expectedVersion is invalid.");
    }
    if (input.expectedVersion !== input.booking.version) {
      throw new PublicBookingManagementStoreError("invalid_store_input", "The mutation version is inconsistent.");
    }
    if (input.kind === "cancel") {
      if (input.pageRevisionId !== null || input.toStartsAt !== null || input.toEndsAt !== null || input.conflictCalendarIds.length > 0 || input.conflictStart !== null || input.conflictEnd !== null) throw new PublicBookingManagementStoreError("invalid_store_input", "The cancellation claim is invalid.");
      return;
    }
    if (!input.pageRevisionId || !input.toStartsAt || !input.toEndsAt || input.conflictCalendarIds.length === 0 || !input.conflictStart || !input.conflictEnd || new Set(input.conflictCalendarIds).size !== input.conflictCalendarIds.length || !input.conflictCalendarIds.includes(input.booking.destinationCalendarId)) throw new PublicBookingManagementStoreError("invalid_store_input", "The reschedule claim is invalid.");
    requiredText2(input.pageRevisionId, "pageRevisionId", 8, 255);
    canonicalInstant4(input.toStartsAt, "toStartsAt");
    canonicalInstant4(input.toEndsAt, "toEndsAt");
    canonicalInstant4(input.conflictStart, "conflictStart");
    canonicalInstant4(input.conflictEnd, "conflictEnd");
    for (const id of input.conflictCalendarIds) requiredText2(id, "conflictCalendarId", 1, 255);
    if (Date.parse(input.toEndsAt) <= Date.parse(input.toStartsAt) || Date.parse(input.conflictStart) > Date.parse(input.toStartsAt) || Date.parse(input.conflictEnd) < Date.parse(input.toEndsAt)) throw new PublicBookingManagementStoreError("invalid_store_input", "The reschedule interval is invalid.");
  }
  #validateCommit(booking, mutation, response, kind) {
    if (mutation.bookingReference !== booking.bookingReference || mutation.kind !== kind || mutation.expectedVersion !== booking.version || !["pending", "uncertain"].includes(mutation.state) || response.bookingReference !== booking.bookingReference || response.bookingVersion !== booking.version + 1 || response.status !== (kind === "cancel" ? "cancelled" : "confirmed") || response.event.startsAt !== (kind === "cancel" ? booking.startsAt : mutation.toStartsAt) || response.event.endsAt !== (kind === "cancel" ? booking.endsAt : mutation.toEndsAt)) {
      throw new PublicBookingManagementStoreError("invalid_store_input", "The mutation commit is invalid.");
    }
  }
  #validateCommittedResults(results, input, kind) {
    const recordRow = credentialRow2(results[2]?.results[0]);
    const mutation = mutationRow(results[3]?.results[0]);
    const record = recordRow ? toRecord(recordRow) : null;
    const persisted = mutation ? toMutation(mutation) : null;
    if (!record || !persisted || record.version !== input.booking.version + 1 || record.status !== (kind === "cancel" ? "cancelled" : "confirmed") || persisted.state !== "committed" || persisted.requestHash !== input.mutation.requestHash || JSON.stringify(persisted.response) !== JSON.stringify(input.response)) {
      throw new PublicBookingManagementStoreError(
        "management_mutation_cas_failed",
        "The management mutation could not be committed conclusively."
      );
    }
    return record;
  }
};

// src/public-booking-email.ts
var MANAGEMENT_TOKEN_DOMAIN2 = "tap.calendar.public-management.v1";
var MANAGEMENT_TOKEN_PREFIX2 = "tapm_v1_";
var TEXT_ENCODER2 = new TextEncoder();
var BOOKING_REFERENCE_PATTERN3 = /^[A-Za-z0-9_-]{16,128}$/u;
var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/u;
var ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/u;
var CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
var PUBLIC_BOOKING_EMAIL_KINDS = [
  "booking-confirmed",
  "approval-requested",
  "approval-approved",
  "approval-declined",
  "approval-expired",
  "booking-cancelled",
  "booking-rescheduled"
];
var PublicBookingEmailError = class extends Error {
  static {
    __name(this, "PublicBookingEmailError");
  }
  code;
  constructor(code, message2) {
    super(message2);
    this.name = "PublicBookingEmailError";
    this.code = code;
  }
};
var isRecord7 = /* @__PURE__ */ __name((value) => Boolean(value) && typeof value === "object" && !Array.isArray(value), "isRecord");
var boundedText = /* @__PURE__ */ __name((value, field, minimum, maximum) => {
  if (value.length < minimum || value.length > maximum || value.trim() !== value || CONTROL_CHARACTER_PATTERN.test(value)) {
    throw new PublicBookingEmailError("invalid_email_event", `${field} is invalid.`);
  }
  return value;
}, "boundedText");
var canonicalInstant5 = /* @__PURE__ */ __name((value, field) => {
  boundedText(value, field, 20, 40);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new PublicBookingEmailError("invalid_email_event", `${field} is invalid.`);
  }
  return value;
}, "canonicalInstant");
var canonicalNow3 = /* @__PURE__ */ __name((clock) => {
  const value = clock();
  if (!Number.isFinite(value)) {
    throw new PublicBookingEmailError("invalid_email_clock", "The email outbox clock is invalid.");
  }
  return new Date(value).toISOString();
}, "canonicalNow");
var canonicalOrigin = /* @__PURE__ */ __name((value) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new PublicBookingEmailError("invalid_management_origin", "The management origin is invalid.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/" && url.pathname !== "") {
    throw new PublicBookingEmailError("invalid_management_origin", "The management origin is invalid.");
  }
  return url.origin;
}, "canonicalOrigin");
var canonicalAddress = /* @__PURE__ */ __name((value, field) => {
  const name = boundedText(value.name, `${field}.name`, 1, 160);
  const email = boundedText(value.email, `${field}.email`, 3, 320).toLowerCase();
  if (!EMAIL_PATTERN.test(email) || email !== value.email) {
    throw new PublicBookingEmailError("invalid_email_address", `${field}.email is invalid.`);
  }
  return { name, email };
}, "canonicalAddress");
var validTimeZone3 = /* @__PURE__ */ __name((value) => {
  boundedText(value, "timeZone", 1, 255);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
  } catch {
    throw new PublicBookingEmailError("invalid_email_event", "timeZone is invalid.");
  }
  return value;
}, "validTimeZone");
var normalizeEvent = /* @__PURE__ */ __name((input) => {
  if (!PUBLIC_BOOKING_EMAIL_KINDS.includes(input.kind)) {
    throw new PublicBookingEmailError("invalid_email_event", "kind is invalid.");
  }
  const startsAt = canonicalInstant5(input.startsAt, "startsAt");
  const endsAt = canonicalInstant5(input.endsAt, "endsAt");
  if (Date.parse(endsAt) <= Date.parse(startsAt)) {
    throw new PublicBookingEmailError("invalid_email_event", "The email event interval is invalid.");
  }
  const previousStartsAt = input.previousStartsAt === void 0 ? null : canonicalInstant5(input.previousStartsAt, "previousStartsAt");
  const previousEndsAt = input.previousEndsAt === void 0 ? null : canonicalInstant5(input.previousEndsAt, "previousEndsAt");
  if (input.kind === "booking-rescheduled" !== (previousStartsAt !== null && previousEndsAt !== null) || previousStartsAt !== null && previousEndsAt !== null && Date.parse(previousEndsAt) <= Date.parse(previousStartsAt)) {
    throw new PublicBookingEmailError(
      "invalid_email_event",
      "Only a rescheduled event may include a valid previous interval."
    );
  }
  const recipient = canonicalAddress({
    name: input.recipient.name,
    email: input.recipient.email
  }, "recipient");
  const bookingReference = boundedText(input.bookingReference, "bookingReference", 16, 128);
  if (!BOOKING_REFERENCE_PATTERN3.test(bookingReference)) {
    throw new PublicBookingEmailError("invalid_email_event", "bookingReference is invalid.");
  }
  return {
    eventKey: boundedText(input.eventKey, "eventKey", 8, 255),
    bookingReference,
    workspace: boundedText(input.scope.workspace, "scope.workspace", 1, 255),
    principal: boundedText(input.scope.principal, "scope.principal", 1, 255),
    kind: input.kind,
    recipientName: recipient.name,
    recipientEmail: recipient.email,
    organizerName: boundedText(input.organizerName, "organizerName", 1, 160),
    eventTitle: boundedText(input.eventTitle, "eventTitle", 1, 200),
    startsAt,
    endsAt,
    timeZone: validTimeZone3(input.timeZone),
    previousStartsAt,
    previousEndsAt
  };
}, "normalizeEvent");
var eventFromRow = /* @__PURE__ */ __name((row) => normalizeEvent({
  eventKey: row.event_key,
  bookingReference: row.booking_reference,
  scope: { workspace: row.workspace_id, principal: row.principal_id },
  kind: row.kind,
  recipient: { name: row.recipient_name, email: row.recipient_email },
  organizerName: row.organizer_name,
  eventTitle: row.event_title,
  startsAt: row.start_at,
  endsAt: row.end_at,
  timeZone: row.time_zone,
  ...row.previous_start_at === null ? {} : { previousStartsAt: row.previous_start_at },
  ...row.previous_end_at === null ? {} : { previousEndsAt: row.previous_end_at }
}), "eventFromRow");
var rowValue = /* @__PURE__ */ __name((value) => {
  if (!isRecord7(value) || typeof value.outbox_id !== "string" || typeof value.event_key !== "string" || typeof value.booking_reference !== "string" || typeof value.workspace_id !== "string" || typeof value.principal_id !== "string" || typeof value.kind !== "string" || typeof value.recipient_name !== "string" || typeof value.recipient_email !== "string" || typeof value.organizer_name !== "string" || typeof value.event_title !== "string" || typeof value.start_at !== "string" || typeof value.end_at !== "string" || typeof value.time_zone !== "string" || value.previous_start_at !== null && typeof value.previous_start_at !== "string" || value.previous_end_at !== null && typeof value.previous_end_at !== "string" || typeof value.state !== "string" || typeof value.attempt_count !== "number" || typeof value.next_attempt_at !== "string" || value.lease_token !== null && typeof value.lease_token !== "string" || value.lease_until !== null && typeof value.lease_until !== "string") return null;
  return {
    ...value,
    outbox_id: value.outbox_id,
    event_key: value.event_key,
    booking_reference: value.booking_reference,
    workspace_id: value.workspace_id,
    principal_id: value.principal_id,
    kind: value.kind,
    recipient_name: value.recipient_name,
    recipient_email: value.recipient_email,
    organizer_name: value.organizer_name,
    event_title: value.event_title,
    start_at: value.start_at,
    end_at: value.end_at,
    time_zone: value.time_zone,
    previous_start_at: value.previous_start_at,
    previous_end_at: value.previous_end_at,
    state: value.state,
    attempt_count: value.attempt_count,
    next_attempt_at: value.next_attempt_at,
    lease_token: value.lease_token,
    lease_until: value.lease_until
  };
}, "rowValue");
var sameEvent = /* @__PURE__ */ __name((row, event) => row.event_key === event.eventKey && row.booking_reference === event.bookingReference && row.workspace_id === event.workspace && row.principal_id === event.principal && row.kind === event.kind && row.recipient_name === event.recipientName && row.recipient_email === event.recipientEmail && row.organizer_name === event.organizerName && row.event_title === event.eventTitle && row.start_at === event.startsAt && row.end_at === event.endsAt && row.time_zone === event.timeZone && row.previous_start_at === event.previousStartsAt && row.previous_end_at === event.previousEndsAt, "sameEvent");
var base64Url5 = /* @__PURE__ */ __name((bytes) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}, "base64Url");
var managementToken = /* @__PURE__ */ __name(async (secret, workspace, principal, bookingReference) => {
  if (TEXT_ENCODER2.encode(secret).byteLength < 32) {
    throw new PublicBookingEmailError(
      "invalid_management_secret",
      "The management secret must contain at least 32 bytes."
    );
  }
  const key = await crypto.subtle.importKey(
    "raw",
    TEXT_ENCODER2.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    TEXT_ENCODER2.encode(
      `${MANAGEMENT_TOKEN_DOMAIN2}\0${workspace}\0${principal}\0${bookingReference}`
    )
  );
  return `${MANAGEMENT_TOKEN_PREFIX2}${base64Url5(new Uint8Array(signature))}`;
}, "managementToken");
async function publicBookingEmailManagementUrl(input, options) {
  const origin = canonicalOrigin(options.managementOrigin);
  const token = await managementToken(
    options.managementSecret,
    input.workspace,
    input.principal,
    input.bookingReference
  );
  const url = new URL("/manage", origin);
  url.hash = token;
  return url.toString();
}
__name(publicBookingEmailManagementUrl, "publicBookingEmailManagementUrl");
var escapePublicBookingEmailHtml = /* @__PURE__ */ __name((value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"), "escapePublicBookingEmailHtml");
var zonedInterval = /* @__PURE__ */ __name((startsAt, endsAt, timeZone2) => {
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone2,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric"
  }).format(new Date(startsAt));
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone2,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  });
  return `${date}, ${time.format(new Date(startsAt))}\u2013${time.format(new Date(endsAt))}`;
}, "zonedInterval");
var copyFor = /* @__PURE__ */ __name((event) => {
  switch (event.kind) {
    case "booking-confirmed":
      return {
        subject: `Confirmed: ${event.eventTitle}`,
        heading: "Your booking is confirmed",
        body: `${event.organizerName} has you on the calendar.`
      };
    case "approval-requested":
      return {
        subject: `Request received: ${event.eventTitle}`,
        heading: "Your booking request was sent",
        body: `${event.organizerName} will review your requested time.`
      };
    case "approval-approved":
      return {
        subject: `Approved: ${event.eventTitle}`,
        heading: "Your booking request was approved",
        body: `${event.organizerName} approved your requested time.`
      };
    case "approval-declined":
      return {
        subject: `Request declined: ${event.eventTitle}`,
        heading: "Your booking request was declined",
        body: `${event.organizerName} was unable to accept this requested time.`
      };
    case "approval-expired":
      return {
        subject: `Request expired: ${event.eventTitle}`,
        heading: "Your booking request expired",
        body: "The request was not approved before its hold expired."
      };
    case "booking-cancelled":
      return {
        subject: `Cancelled: ${event.eventTitle}`,
        heading: "Your booking was cancelled",
        body: `This booking with ${event.organizerName} is no longer scheduled.`
      };
    case "booking-rescheduled":
      return {
        subject: `Rescheduled: ${event.eventTitle}`,
        heading: "Your booking was rescheduled",
        body: `${event.organizerName} has you on the calendar at the new time below.`
      };
  }
}, "copyFor");
async function renderPublicBookingEmail(input, options) {
  const event = normalizeEvent(input);
  const from = canonicalAddress(options.from, "from");
  const brandName = boundedText(options.brandName ?? "TAP", "brandName", 1, 80);
  const manageUrl = await publicBookingEmailManagementUrl(event, options);
  const copy = copyFor(event);
  const schedule = zonedInterval(event.startsAt, event.endsAt, event.timeZone);
  const previous = event.previousStartsAt === null || event.previousEndsAt === null ? null : zonedInterval(event.previousStartsAt, event.previousEndsAt, event.timeZone);
  const previousText = previous === null ? "" : `
Previous time: ${previous}`;
  const previousHtml = previous === null ? "" : `<p style="margin:8px 0 0;color:#6b6878"><strong>Previous time:</strong> ${escapePublicBookingEmailHtml(previous)}</p>`;
  const text = `${copy.heading}

${copy.body}

${event.eventTitle}
${schedule}${previousText}

Manage booking: ${manageUrl}

Powered by ${brandName}`;
  const html = `<!doctype html><html><body style="margin:0;background:#f7f6fb;color:#242230;font-family:Arial,sans-serif"><div style="max-width:600px;margin:0 auto;padding:32px 20px"><div style="background:#ffffff;border:1px solid #dedbe8;border-radius:16px;padding:28px"><p style="margin:0 0 8px;color:#6b6878;font-size:14px">${escapePublicBookingEmailHtml(brandName)} Calendar</p><h1 style="margin:0 0 20px;font-size:24px">${escapePublicBookingEmailHtml(copy.heading)}</h1><p style="margin:0 0 20px">${escapePublicBookingEmailHtml(copy.body)}</p><h2 style="margin:0 0 8px;font-size:18px">${escapePublicBookingEmailHtml(event.eventTitle)}</h2><p style="margin:0;color:#454150">${escapePublicBookingEmailHtml(schedule)}</p>${previousHtml}<p style="margin:24px 0 0"><a href="${escapePublicBookingEmailHtml(manageUrl)}" style="display:inline-block;background:#6c55f7;color:#ffffff;text-decoration:none;border-radius:10px;padding:12px 18px;font-weight:700">Manage booking</a></p></div><p style="margin:16px 0 0;text-align:center;color:#777382;font-size:13px">Powered by ${escapePublicBookingEmailHtml(brandName)}</p></div></body></html>`;
  return {
    to: { name: event.recipientName, email: event.recipientEmail },
    from,
    subject: copy.subject,
    text,
    html,
    headers: { "X-TAP-Booking-Event": event.kind }
  };
}
__name(renderPublicBookingEmail, "renderPublicBookingEmail");
var SELECT_COLUMNS = `outbox_id, event_key, booking_reference, workspace_id,
  principal_id, kind, recipient_name, recipient_email, organizer_name,
  event_title, start_at, end_at, time_zone, previous_start_at,
  previous_end_at, state, attempt_count, next_attempt_at, lease_token,
  lease_until`;
var inputFromEvent = /* @__PURE__ */ __name((event) => ({
  eventKey: event.eventKey,
  bookingReference: event.bookingReference,
  scope: { workspace: event.workspace, principal: event.principal },
  kind: event.kind,
  recipient: { name: event.recipientName, email: event.recipientEmail },
  organizerName: event.organizerName,
  eventTitle: event.eventTitle,
  startsAt: event.startsAt,
  endsAt: event.endsAt,
  timeZone: event.timeZone,
  ...event.previousStartsAt === null ? {} : { previousStartsAt: event.previousStartsAt },
  ...event.previousEndsAt === null ? {} : { previousEndsAt: event.previousEndsAt }
}), "inputFromEvent");
var errorDisposition = /* @__PURE__ */ __name((error) => {
  const rawCode = isRecord7(error) && typeof error.code === "string" ? error.code.toUpperCase() : "EMAIL_SEND_FAILED";
  const code = ERROR_CODE_PATTERN.test(rawCode) ? rawCode : "EMAIL_SEND_FAILED";
  const permanent = (/* @__PURE__ */ new Set([
    "E_VALIDATION_ERROR",
    "E_FIELD_MISSING",
    "E_SENDER_NOT_VERIFIED",
    "E_RECIPIENT_NOT_ALLOWED",
    "E_RECIPIENT_SUPPRESSED",
    "E_SENDER_DOMAIN_NOT_AVAILABLE",
    "E_CONTENT_TOO_LARGE",
    "E_HEADER_NOT_ALLOWED",
    "E_HEADER_USE_API_FIELD",
    "E_HEADER_VALUE_INVALID",
    "E_HEADER_VALUE_TOO_LONG",
    "E_HEADER_NAME_INVALID",
    "E_HEADERS_TOO_LARGE",
    "E_HEADERS_TOO_MANY"
  ])).has(code);
  return { code, permanent };
}, "errorDisposition");
var D1PublicBookingEmailOutbox = class {
  static {
    __name(this, "D1PublicBookingEmailOutbox");
  }
  #database;
  #now;
  #id;
  #leaseMilliseconds;
  #maxAttempts;
  #baseRetryMilliseconds;
  #maxRetryMilliseconds;
  #random;
  constructor(database, options = {}) {
    this.#database = database;
    this.#now = options.now ?? Date.now;
    this.#id = options.id ?? crypto.randomUUID;
    this.#leaseMilliseconds = options.leaseMilliseconds ?? 6e4;
    this.#maxAttempts = options.maxAttempts ?? 8;
    this.#baseRetryMilliseconds = options.baseRetryMilliseconds ?? 6e4;
    this.#maxRetryMilliseconds = options.maxRetryMilliseconds ?? 864e5;
    this.#random = options.random ?? Math.random;
    if (this.#leaseMilliseconds < 1e3 || !Number.isInteger(this.#maxAttempts) || this.#maxAttempts < 1 || this.#maxAttempts > 16 || this.#baseRetryMilliseconds < 1e3 || this.#maxRetryMilliseconds < this.#baseRetryMilliseconds) {
      throw new PublicBookingEmailError("invalid_outbox_options", "Email outbox options are invalid.");
    }
  }
  prepareEnqueue(input) {
    const event = normalizeEvent(input);
    const outboxId = this.#id();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(outboxId)) {
      throw new PublicBookingEmailError("invalid_outbox_id", "The email outbox ID is invalid.");
    }
    const now = canonicalNow3(this.#now);
    return {
      outboxId,
      statement: this.#database.prepare(
        `INSERT OR IGNORE INTO public_booking_email_outbox (
           outbox_id, event_key, booking_reference, workspace_id, principal_id,
           kind, recipient_name, recipient_email, organizer_name, event_title,
           start_at, end_at, time_zone, previous_start_at, previous_end_at,
           state, attempt_count, next_attempt_at, lease_token, lease_until,
           last_error_code, created_at, updated_at, delivered_at, dead_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                   'queued', 0, ?, NULL, NULL, NULL, ?, ?, NULL, NULL)`
      ).bind(
        outboxId,
        event.eventKey,
        event.bookingReference,
        event.workspace,
        event.principal,
        event.kind,
        event.recipientName,
        event.recipientEmail,
        event.organizerName,
        event.eventTitle,
        event.startsAt,
        event.endsAt,
        event.timeZone,
        event.previousStartsAt,
        event.previousEndsAt,
        now,
        now,
        now
      )
    };
  }
  async enqueue(input) {
    const event = normalizeEvent(input);
    const prepared = this.prepareEnqueue(input);
    const results = await this.#database.batch([
      prepared.statement,
      this.#database.prepare(
        `SELECT ${SELECT_COLUMNS}
           FROM public_booking_email_outbox
          WHERE booking_reference = ? AND event_key = ?`
      ).bind(event.bookingReference, event.eventKey)
    ]);
    const row = rowValue(results[1]?.results[0]);
    if (!row || !sameEvent(row, event)) {
      throw new PublicBookingEmailError(
        "email_event_conflict",
        "The email event key is already associated with different content."
      );
    }
    return {
      kind: Number(results[0]?.meta.changes ?? 0) === 1 ? "enqueued" : "existing",
      outboxId: row.outbox_id
    };
  }
  async deliverDue(sender, options) {
    const limit = options.limit ?? 10;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new PublicBookingEmailError("invalid_delivery_limit", "The delivery limit is invalid.");
    }
    canonicalOrigin(options.managementOrigin);
    canonicalAddress(options.from, "from");
    boundedText(options.brandName ?? "TAP", "brandName", 1, 80);
    if (TEXT_ENCODER2.encode(options.managementSecret).byteLength < 32) {
      throw new PublicBookingEmailError(
        "invalid_management_secret",
        "The management secret must contain at least 32 bytes."
      );
    }
    const summary = { claimed: 0, delivered: 0, retried: 0, deadLettered: 0 };
    await this.#deadLetterExhaustedLeases();
    for (let index = 0; index < limit; index += 1) {
      const leased = await this.#leaseNext();
      if (!leased) break;
      summary.claimed += 1;
      try {
        const message2 = await renderPublicBookingEmail(inputFromEvent(leased), options);
        await sender.send(message2);
        await this.#markDelivered(leased);
        summary.delivered += 1;
      } catch (error) {
        const disposition = error instanceof PublicBookingEmailError ? { code: error.code.toUpperCase(), permanent: true } : errorDisposition(error);
        const state = await this.#markFailed(leased, disposition);
        if (state === "dead") summary.deadLettered += 1;
        else summary.retried += 1;
      }
    }
    return { ...summary, infrastructureFailed: false };
  }
  async #deadLetterExhaustedLeases() {
    const now = canonicalNow3(this.#now);
    await this.#database.prepare(
      `UPDATE public_booking_email_outbox
          SET state = 'dead', lease_token = NULL, lease_until = NULL,
              last_error_code = COALESCE(last_error_code, 'EMAIL_ATTEMPTS_EXHAUSTED'),
              updated_at = ?, dead_at = ?
        WHERE state = 'leased' AND lease_until <= ? AND attempt_count >= ?`
    ).bind(now, now, now, this.#maxAttempts).run();
  }
  async #leaseNext() {
    const now = canonicalNow3(this.#now);
    const leaseToken = crypto.randomUUID();
    const leaseUntil = new Date(Date.parse(now) + this.#leaseMilliseconds).toISOString();
    const row = rowValue(await this.#database.prepare(
      `UPDATE public_booking_email_outbox
          SET state = 'leased', attempt_count = attempt_count + 1,
              lease_token = ?, lease_until = ?, updated_at = ?
        WHERE outbox_id = (
          SELECT outbox_id
            FROM public_booking_email_outbox
           WHERE attempt_count < ? AND (
             (state = 'queued' AND next_attempt_at <= ?) OR
             (state = 'leased' AND lease_until <= ?)
           )
           ORDER BY next_attempt_at ASC, created_at ASC, outbox_id ASC
           LIMIT 1
        )
          AND attempt_count < ? AND (
            (state = 'queued' AND next_attempt_at <= ?) OR
            (state = 'leased' AND lease_until <= ?)
          )
      RETURNING ${SELECT_COLUMNS}`
    ).bind(
      leaseToken,
      leaseUntil,
      now,
      this.#maxAttempts,
      now,
      now,
      this.#maxAttempts,
      now,
      now
    ).first());
    if (!row) return null;
    if (row.state !== "leased" || row.lease_token !== leaseToken || row.attempt_count < 1 || row.attempt_count > this.#maxAttempts) {
      throw new PublicBookingEmailError("corrupt_email_outbox", "The leased email row is invalid.");
    }
    return {
      ...eventFromRow(row),
      outboxId: row.outbox_id,
      attemptCount: row.attempt_count,
      leaseToken
    };
  }
  async #markDelivered(event) {
    const now = canonicalNow3(this.#now);
    const result = await this.#database.prepare(
      `UPDATE public_booking_email_outbox
          SET state = 'delivered', lease_token = NULL, lease_until = NULL,
              last_error_code = NULL, updated_at = ?, delivered_at = ?
        WHERE outbox_id = ? AND state = 'leased' AND lease_token = ?`
    ).bind(now, now, event.outboxId, event.leaseToken).run();
    if (Number(result.meta.changes ?? 0) !== 1) {
      throw new PublicBookingEmailError("email_lease_lost", "The email lease was lost after delivery.");
    }
  }
  async #markFailed(event, failure) {
    const now = canonicalNow3(this.#now);
    const dead = failure.permanent || event.attemptCount >= this.#maxAttempts;
    let result;
    if (dead) {
      result = await this.#database.prepare(
        `UPDATE public_booking_email_outbox
            SET state = 'dead', lease_token = NULL, lease_until = NULL,
                last_error_code = ?, updated_at = ?, dead_at = ?
          WHERE outbox_id = ? AND state = 'leased' AND lease_token = ?`
      ).bind(failure.code, now, now, event.outboxId, event.leaseToken).run();
    } else {
      const delay2 = this.#retryDelay(event.attemptCount);
      const nextAttemptAt = new Date(Date.parse(now) + delay2).toISOString();
      result = await this.#database.prepare(
        `UPDATE public_booking_email_outbox
            SET state = 'queued', lease_token = NULL, lease_until = NULL,
                last_error_code = ?, next_attempt_at = ?, updated_at = ?
          WHERE outbox_id = ? AND state = 'leased' AND lease_token = ?`
      ).bind(failure.code, nextAttemptAt, now, event.outboxId, event.leaseToken).run();
    }
    if (Number(result.meta.changes ?? 0) !== 1) {
      throw new PublicBookingEmailError("email_lease_lost", "The email lease was lost after failure.");
    }
    return dead ? "dead" : "queued";
  }
  #retryDelay(attemptCount) {
    const random = this.#random();
    if (!Number.isFinite(random) || random < 0 || random >= 1) {
      throw new PublicBookingEmailError("invalid_retry_random", "The retry random source is invalid.");
    }
    const exponential = Math.min(
      this.#baseRetryMilliseconds * 2 ** Math.min(attemptCount - 1, 30),
      this.#maxRetryMilliseconds
    );
    return Math.max(1e3, Math.round(exponential * (0.75 + random * 0.5)));
  }
};
function createPublicBookingManagementEmailPort(outbox) {
  return {
    async enqueue(input) {
      await outbox.enqueue({
        ...input,
        kind: input.kind === "cancelled" ? "booking-cancelled" : "booking-rescheduled"
      });
    }
  };
}
__name(createPublicBookingManagementEmailPort, "createPublicBookingManagementEmailPort");
async function deliverPublicBookingEmailOutboxSafely(outbox, sender, options) {
  try {
    return await outbox.deliverDue(sender, options);
  } catch {
    return {
      claimed: 0,
      delivered: 0,
      retried: 0,
      deadLettered: 0,
      infrastructureFailed: true
    };
  }
}
__name(deliverPublicBookingEmailOutboxSafely, "deliverPublicBookingEmailOutboxSafely");

// src/public-booking-turnstile.ts
var SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
var TOKEN_MAX_LENGTH = 2048;
var SECRET_MAX_LENGTH = 4096;
var BOOKING_REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
var VERIFICATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
var IP_PATTERN = /^[0-9a-f:.]{2,64}$/iu;
var MAX_CHALLENGE_AGE_MS = 5 * 60 * 1e3;
var MAX_FUTURE_SKEW_MS = 60 * 1e3;
var VERIFICATION_ID_DOMAIN = "tap.calendar.public-turnstile.v1";
var PublicTurnstileError = class extends Error {
  static {
    __name(this, "PublicTurnstileError");
  }
  status;
  code;
  retryable;
  constructor(status, code, message2, retryable) {
    super(message2);
    this.name = "PublicTurnstileError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
};
var isRecord8 = /* @__PURE__ */ __name((value) => Boolean(value) && typeof value === "object" && !Array.isArray(value), "isRecord");
var unconfigured = /* @__PURE__ */ __name(() => {
  throw new PublicTurnstileError(
    503,
    "public_booking_unconfigured",
    "Public booking protection is not configured.",
    true
  );
}, "unconfigured");
var unavailable2 = /* @__PURE__ */ __name(() => {
  throw new PublicTurnstileError(
    503,
    "turnstile_unavailable",
    "Security verification could not be checked. Try again shortly.",
    true
  );
}, "unavailable");
var rejected = /* @__PURE__ */ __name(() => {
  throw new PublicTurnstileError(
    403,
    "turnstile_failed",
    "Security verification expired or was rejected. Complete it again.",
    false
  );
}, "rejected");
var publicClientIp = /* @__PURE__ */ __name((request) => {
  const candidate = request.headers.get("CF-Connecting-IP")?.trim() ?? "";
  return candidate && IP_PATTERN.test(candidate) ? candidate : null;
}, "publicClientIp");
async function publicTurnstileVerificationId(bookingRequestId, token) {
  if (!BOOKING_REQUEST_ID_PATTERN.test(bookingRequestId) || !token || token.length > TOKEN_MAX_LENGTH) {
    return rejected();
  }
  const digest2 = new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      `${VERIFICATION_ID_DOMAIN}\0${bookingRequestId}\0${token}`
    )
  ));
  const bytes = digest2.slice(0, 16);
  bytes[6] = bytes[6] & 15 | 64;
  bytes[8] = bytes[8] & 63 | 128;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
__name(publicTurnstileVerificationId, "publicTurnstileVerificationId");
async function verifyPublicBookingTurnstile(options) {
  const secret = options.secret?.trim() ?? "";
  if (!secret || secret.length > SECRET_MAX_LENGTH) return unconfigured();
  if (!options.token || options.token.length > TOKEN_MAX_LENGTH || options.token.trim() !== options.token || !VERIFICATION_ID_PATTERN.test(options.verificationId) || !Number.isFinite(options.now)) return rejected();
  const expectedAction = options.expectedAction ?? "public_booking";
  if (!options.expectedHostname || options.expectedHostname.length > 255 || !expectedAction || expectedAction.length > 64) return unconfigured();
  const form = new URLSearchParams({
    secret,
    response: options.token,
    idempotency_key: options.verificationId
  });
  const remoteIp = options.remoteIp?.trim() ?? "";
  if (remoteIp && IP_PATTERN.test(remoteIp)) form.set("remoteip", remoteIp);
  let response;
  try {
    response = await (options.providerFetch ?? fetch)(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form
    });
  } catch {
    return unavailable2();
  }
  if (!response.ok) return unavailable2();
  let result;
  try {
    result = await response.json();
  } catch {
    return unavailable2();
  }
  if (!isRecord8(result) || result.success !== true) return rejected();
  if (result.action !== expectedAction || result.hostname !== options.expectedHostname) {
    return rejected();
  }
  if (typeof result.challenge_ts !== "string" || result.challenge_ts.length > 64) {
    return rejected();
  }
  const challengedAt = Date.parse(result.challenge_ts);
  if (!Number.isFinite(challengedAt) || challengedAt > options.now + MAX_FUTURE_SKEW_MS || challengedAt < options.now - MAX_CHALLENGE_AGE_MS) return rejected();
  return {
    success: true,
    action: result.action,
    hostname: result.hostname,
    challengeTimestamp: result.challenge_ts
  };
}
__name(verifyPublicBookingTurnstile, "verifyPublicBookingTurnstile");

// src/index.ts
var MAX_BODY_BYTES = 256 * 1024;
var MAX_PROVIDER_RESPONSE_BYTES = 4 * 1024 * 1024;
var MAX_PROVIDER_PAGES = 100;
var MAX_EVENT_PROVIDER_PAGES = 20;
var MAX_EVENT_QUERY_CALENDARS = 100;
var MAX_EVENT_QUERY_EVENTS = 5e3;
var MAX_EVENT_ATTENDEES = 10;
var MAX_EVENT_QUERY_RANGE_MS = 93 * 24 * 60 * 60 * 1e3;
var EVENT_PAGE_SIZE = 250;
var CACHE_EVENT_PAGE_SIZE = 500;
var MAX_CACHE_SYNC_EVENTS = 1e4;
var EVENT_QUERY_CONCURRENCY = 4;
var CACHE_INITIAL_HISTORY_MS = 31 * 24 * 60 * 60 * 1e3;
var CACHE_ROLLING_FUTURE_MS = 180 * 24 * 60 * 60 * 1e3;
var CACHE_ROLLING_REBUILD_MARGIN_MS = 14 * 24 * 60 * 60 * 1e3;
var CACHE_BOOTSTRAP_FUTURE_WINDOWS_MS = [
  CACHE_ROLLING_FUTURE_MS,
  90 * 24 * 60 * 60 * 1e3,
  30 * 24 * 60 * 60 * 1e3
];
var CACHE_FRESH_MS = 2 * 60 * 1e3;
var CACHE_REPAIR_INTERVAL_MS = 5 * 60 * 1e3;
var CACHE_ERROR_RETRY_BASE_MS = 5 * 60 * 1e3;
var CACHE_SYNC_LEASE_MS = 2 * 60 * 1e3;
var CACHE_LEASE_WAIT_ATTEMPTS = 20;
var CACHE_LEASE_WAIT_MS = 250;
var BOOKING_COMMIT_LEASE_MS = 2 * 60 * 1e3;
var MAX_BOOKING_ATTENDEES = 100;
var CACHE_WRITE_BATCH_SIZE = 75;
var CACHE_REPAIR_BATCH_SIZE = 20;
var WATCH_RENEWAL_WINDOW_MS = 24 * 60 * 60 * 1e3;
var WATCH_TTL_SECONDS = 7 * 24 * 60 * 60;
var OAUTH_STATE_TTL_MS = 10 * 60 * 1e3;
var TOKEN_REFRESH_SKEW_MS = 60 * 1e3;
var IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,254}$/u;
var COLOR = /^#[0-9a-fA-F]{6}$/u;
var RFC3339_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;
var PROVIDERS = [
  "google",
  "microsoft",
  "icloud",
  "caldav",
  "exchange",
  "ics"
];
var ApiError = class extends Error {
  constructor(status, code, message2, details) {
    super(message2);
    this.status = status;
    this.code = code;
    this.details = details;
  }
  status;
  code;
  details;
  static {
    __name(this, "ApiError");
  }
};
var ProviderHttpError = class extends ApiError {
  constructor(providerStatus, message2) {
    super(502, "provider_request_failed", message2);
    this.providerStatus = providerStatus;
  }
  providerStatus;
  static {
    __name(this, "ProviderHttpError");
  }
};
var isRecord9 = /* @__PURE__ */ __name((value) => Boolean(value) && typeof value === "object" && !Array.isArray(value), "isRecord");
var normalizedTrustedHttpsUrl = /* @__PURE__ */ __name((value, allowed) => {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096 || value.trim() !== value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || !allowed(url)) return null;
    return url.href;
  } catch {
    return null;
  }
}, "normalizedTrustedHttpsUrl");
var normalizeGoogleCalendarHtmlUrl = /* @__PURE__ */ __name((value) => normalizedTrustedHttpsUrl(
  value,
  (url) => url.hostname === "calendar.google.com" && (url.pathname.startsWith("/calendar/") || url.pathname === "/event" || url.pathname.startsWith("/event/")) || url.hostname === "www.google.com" && url.pathname.startsWith("/calendar/")
), "normalizeGoogleCalendarHtmlUrl");
var normalizeGoogleMeetJoinUrl = /* @__PURE__ */ __name((value) => normalizedTrustedHttpsUrl(
  value,
  (url) => url.hostname === "meet.google.com" && url.pathname !== "/"
), "normalizeGoogleMeetJoinUrl");
var googleMeetJoinUrl = /* @__PURE__ */ __name((value) => {
  const hangoutLink = normalizeGoogleMeetJoinUrl(value.hangoutLink);
  if (hangoutLink) return hangoutLink;
  const conferenceData = isRecord9(value.conferenceData) ? value.conferenceData : null;
  const entryPoints = conferenceData && Array.isArray(conferenceData.entryPoints) ? conferenceData.entryPoints : [];
  for (const candidate of entryPoints) {
    if (isRecord9(candidate) && candidate.entryPointType === "video") {
      const joinUrl = normalizeGoogleMeetJoinUrl(candidate.uri);
      if (joinUrl) return joinUrl;
    }
  }
  return null;
}, "googleMeetJoinUrl");
var googleMeetConferenceRequested = /* @__PURE__ */ __name((value) => {
  if (googleMeetJoinUrl(value)) return true;
  const conferenceData = isRecord9(value.conferenceData) ? value.conferenceData : null;
  const createRequest = conferenceData && isRecord9(conferenceData.createRequest) ? conferenceData.createRequest : null;
  const solutionKey = createRequest && isRecord9(createRequest.conferenceSolutionKey) ? createRequest.conferenceSolutionKey : null;
  return solutionKey?.type === "hangoutsMeet";
}, "googleMeetConferenceRequested");
var requiredText3 = /* @__PURE__ */ __name((value, field, maximumLength = 255) => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApiError(400, "invalid_request", `${field} is required.`);
  }
  const normalized = value.trim();
  if (normalized.length > maximumLength) {
    throw new ApiError(400, "invalid_request", `${field} is too long.`);
  }
  return normalized;
}, "requiredText");
var identifier2 = /* @__PURE__ */ __name((value, field) => {
  const normalized = requiredText3(value, field);
  if (!IDENTIFIER.test(normalized)) {
    throw new ApiError(400, "invalid_request", `${field} is invalid.`);
  }
  return normalized;
}, "identifier");
var provider = /* @__PURE__ */ __name((value) => {
  if (typeof value !== "string" || !PROVIDERS.includes(value)) {
    throw new ApiError(400, "invalid_provider", "The calendar provider is invalid.");
  }
  return value;
}, "provider");
var json = /* @__PURE__ */ __name((body, status = 200, headers = {}) => Response.json(body, {
  status,
  headers: {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    ...headers
  }
}), "json");
var allowedOrigins = /* @__PURE__ */ __name((env) => new Set(
  env.ALLOWED_ORIGINS.split(",").map((item) => item.trim()).filter(Boolean)
), "allowedOrigins");
function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return {};
  if (!allowedOrigins(env).has(origin)) {
    throw new ApiError(403, "origin_denied", "This origin is not allowed.");
  }
  return {
    "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version, X-TAP-Principal-Id, X-TAP-Workspace-Id",
    "Access-Control-Allow-Methods": "DELETE, GET, OPTIONS, POST",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Max-Age": "600",
    Vary: "Origin"
  };
}
__name(corsHeaders, "corsHeaders");
async function readJson(request) {
  if (!request.headers.get("Content-Type")?.toLowerCase().includes("application/json")) {
    throw new ApiError(415, "unsupported_media_type", "Use application/json.");
  }
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new ApiError(413, "payload_too_large", "The request body is too large.");
  }
  if (!request.body) {
    throw new ApiError(400, "invalid_json", "A JSON body is required.");
  }
  const reader = request.body.getReader();
  const decoder2 = new TextDecoder();
  let bytes = 0;
  let text = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > MAX_BODY_BYTES) {
      await reader.cancel("request body too large");
      throw new ApiError(413, "payload_too_large", "The request body is too large.");
    }
    text += decoder2.decode(chunk.value, { stream: true });
  }
  text += decoder2.decode();
  try {
    const parsed = JSON.parse(text);
    if (!isRecord9(parsed)) throw new Error("not an object");
    return parsed;
  } catch {
    throw new ApiError(400, "invalid_json", "The request body must be a JSON object.");
  }
}
__name(readJson, "readJson");
function eventQueryInput(body) {
  const parseInstant = /* @__PURE__ */ __name((value, field) => {
    const text = requiredText3(value, field, 64);
    const timestamp = Date.parse(text);
    if (!RFC3339_INSTANT.test(text) || !Number.isFinite(timestamp)) {
      throw new ApiError(
        400,
        "invalid_time_range",
        `${field} must be an RFC 3339 timestamp with a time-zone offset.`
      );
    }
    return new Date(timestamp).toISOString();
  }, "parseInstant");
  const timeMin = parseInstant(body.timeMin, "timeMin");
  const timeMax = parseInstant(body.timeMax, "timeMax");
  const minimum = Date.parse(timeMin);
  const maximum = Date.parse(timeMax);
  if (maximum <= minimum) {
    throw new ApiError(400, "invalid_time_range", "timeMax must be later than timeMin.");
  }
  if (maximum - minimum > MAX_EVENT_QUERY_RANGE_MS) {
    throw new ApiError(
      400,
      "event_range_too_large",
      "Event queries may span at most 93 days."
    );
  }
  if (!Array.isArray(body.calendarIds) || body.calendarIds.length === 0 || body.calendarIds.length > MAX_EVENT_QUERY_CALENDARS) {
    throw new ApiError(
      400,
      "invalid_calendar_ids",
      `Choose between 1 and ${MAX_EVENT_QUERY_CALENDARS} calendars.`
    );
  }
  const calendarIds = body.calendarIds.map(
    (value, index) => identifier2(value, `calendarIds[${index}]`)
  );
  if (new Set(calendarIds).size !== calendarIds.length) {
    throw new ApiError(400, "invalid_calendar_ids", "Calendar identifiers must be unique.");
  }
  return { timeMin, timeMax, calendarIds };
}
__name(eventQueryInput, "eventQueryInput");
function requireLocalDevelopment(env) {
  if (env.LOCAL_DEVELOPMENT !== "true") {
    throw new ApiError(
      404,
      "local_connector_unavailable",
      "The local Calendar connector is unavailable."
    );
  }
}
__name(requireLocalDevelopment, "requireLocalDevelopment");
async function bindLegacyLocalOwner(env, scope) {
  const legacy = await env.CALENDAR_DB.prepare(
    `SELECT (
       EXISTS(
         SELECT 1 FROM calendar_connections
          WHERE workspace_id = ? AND principal_id IS NULL
       ) OR EXISTS(
         SELECT 1 FROM oauth_states
          WHERE workspace_id = ? AND principal_id IS NULL
       ) OR EXISTS(
         SELECT 1 FROM availability_confirmations
          WHERE workspace_id = ? AND principal_id IS NULL
       ) OR EXISTS(
         SELECT 1 FROM provider_booking_commits
          WHERE workspace_id = ? AND principal_id IS NULL
       ) OR EXISTS(
         SELECT 1 FROM provider_booking_commit_locks
          WHERE workspace_id = ? AND principal_id IS NULL
       ) OR EXISTS(
         SELECT 1 FROM provider_booking_resolutions
          WHERE workspace_id = ? AND principal_id IS NULL
       )
     ) AS present`
  ).bind(
    scope.workspace,
    scope.workspace,
    scope.workspace,
    scope.workspace,
    scope.workspace,
    scope.workspace
  ).first("present");
  if (!legacy) return;
  const configuredOwner = env.LEGACY_OWNER_PRINCIPAL_ID?.trim() ?? "";
  if (!configuredOwner) {
    throw new ApiError(
      409,
      "legacy_owner_unconfigured",
      "Existing local Calendar data has no TAP owner. Set LEGACY_OWNER_PRINCIPAL_ID to the original owner's canonical TAP user id before opening Calendar."
    );
  }
  if (configuredOwner !== scope.principal) {
    throw new ApiError(
      403,
      "legacy_owner_mismatch",
      "Existing local Calendar data is reserved for its configured TAP owner."
    );
  }
  await env.CALENDAR_DB.batch([
    env.CALENDAR_DB.prepare(
      `UPDATE calendar_connections SET principal_id = ?
        WHERE workspace_id = ? AND principal_id IS NULL`
    ).bind(scope.principal, scope.workspace),
    env.CALENDAR_DB.prepare(
      `UPDATE oauth_states SET principal_id = ?
        WHERE workspace_id = ? AND principal_id IS NULL
          AND EXISTS (
            SELECT 1 FROM calendar_connections
             WHERE calendar_connections.id = oauth_states.connection_id
               AND calendar_connections.workspace_id = oauth_states.workspace_id
               AND calendar_connections.principal_id = ?
          )`
    ).bind(scope.principal, scope.workspace, scope.principal),
    env.CALENDAR_DB.prepare(
      `UPDATE availability_confirmations SET principal_id = ?
        WHERE workspace_id = ? AND principal_id IS NULL`
    ).bind(scope.principal, scope.workspace),
    env.CALENDAR_DB.prepare(
      `UPDATE provider_booking_commits SET principal_id = ?
        WHERE workspace_id = ? AND principal_id IS NULL
          AND EXISTS (
            SELECT 1 FROM provider_calendars
            INNER JOIN calendar_connections
              ON calendar_connections.id = provider_calendars.connection_id
             WHERE provider_calendars.id = provider_booking_commits.destination_calendar_id
               AND calendar_connections.workspace_id = provider_booking_commits.workspace_id
               AND calendar_connections.principal_id = ?
          )`
    ).bind(scope.principal, scope.workspace, scope.principal),
    env.CALENDAR_DB.prepare(
      `UPDATE provider_booking_commit_locks SET principal_id = ?
        WHERE workspace_id = ? AND principal_id IS NULL
          AND EXISTS (
            SELECT 1 FROM provider_calendars
            INNER JOIN calendar_connections
              ON calendar_connections.id = provider_calendars.connection_id
             WHERE provider_calendars.id = provider_booking_commit_locks.destination_calendar_id
               AND calendar_connections.workspace_id = provider_booking_commit_locks.workspace_id
               AND calendar_connections.principal_id = ?
          )`
    ).bind(scope.principal, scope.workspace, scope.principal),
    env.CALENDAR_DB.prepare(
      `UPDATE provider_booking_resolutions SET principal_id = ?
        WHERE workspace_id = ? AND principal_id IS NULL
          AND EXISTS (
            SELECT 1 FROM provider_booking_commits
             WHERE provider_booking_commits.workspace_id = provider_booking_resolutions.workspace_id
               AND provider_booking_commits.principal_id = ?
               AND provider_booking_commits.idempotency_key =
                   provider_booking_resolutions.booking_idempotency_key
          )`
    ).bind(scope.principal, scope.workspace, scope.principal)
  ]);
}
__name(bindLegacyLocalOwner, "bindLegacyLocalOwner");
async function principalScope(request, env) {
  let scope;
  try {
    const resolved = await resolveOrganizerScope(
      request,
      env
    );
    scope = {
      workspace: resolved.workspaceId,
      principal: resolved.principalId
    };
  } catch (error) {
    if (error instanceof OrganizerAuthError) {
      throw new ApiError(error.status, error.code, error.message);
    }
    throw error;
  }
  await bindLegacyLocalOwner(env, scope);
  return scope;
}
__name(principalScope, "principalScope");
function publicBookingBaseUrl(env) {
  const configured = env.PUBLIC_BOOKING_BASE_URL?.trim() ?? "";
  if (!configured) {
    throw new ApiError(
      503,
      "public_booking_unconfigured",
      "PUBLIC_BOOKING_BASE_URL is required before booking pages can be published."
    );
  }
  let url;
  try {
    url = new URL(configured);
  } catch {
    throw new ApiError(
      503,
      "public_booking_unconfigured",
      "PUBLIC_BOOKING_BASE_URL must be an exact HTTPS origin."
    );
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash || url.pathname !== "/" && url.pathname !== "") {
    throw new ApiError(
      503,
      "public_booking_unconfigured",
      "PUBLIC_BOOKING_BASE_URL must be an exact HTTPS origin."
    );
  }
  return url.origin;
}
__name(publicBookingBaseUrl, "publicBookingBaseUrl");
function publicationApiError(error) {
  if (error instanceof PublicBookingPublicationError) {
    throw new ApiError(
      error.status,
      error.code,
      error.message,
      error.currentGeneration === void 0 ? void 0 : { currentGeneration: error.currentGeneration }
    );
  }
  throw error;
}
__name(publicationApiError, "publicationApiError");
async function publishBookingProfile(request, env) {
  const scope = await principalScope(request, env);
  const body = await readJson(request);
  try {
    const publication = parsePublicBookingProfilePublication(body);
    const result = await publishPublicBookingProfile({
      database: env.CALENDAR_DB,
      scope,
      input: publication,
      publicBaseUrl: publicBookingBaseUrl(env)
    });
    return json({ publication: result });
  } catch (error) {
    return publicationApiError(error);
  }
}
__name(publishBookingProfile, "publishBookingProfile");
async function unpublishBookingProfile(request, env) {
  const scope = await principalScope(request, env);
  const body = await readJson(request);
  try {
    const publication = parsePublicBookingProfileUnpublication(body);
    const result = await unpublishPublicBookingProfile({
      database: env.CALENDAR_DB,
      scope,
      input: publication
    });
    return json({ publication: result });
  } catch (error) {
    return publicationApiError(error);
  }
}
__name(unpublishBookingProfile, "unpublishBookingProfile");
function publicBookingReadApiError(error) {
  if (error instanceof PublicBookingRateLimitError) {
    throw new ApiError(error.status, error.code, error.message, {
      retryable: error.retryable
    });
  }
  if (error instanceof PublicBookingReadError) {
    throw new ApiError(
      error.status,
      error.code,
      error.message,
      error.status === 409 || error.status >= 500 ? { retryable: true } : void 0
    );
  }
  throw error;
}
__name(publicBookingReadApiError, "publicBookingReadApiError");
var requiredPublicBookingConfiguration = /* @__PURE__ */ __name((value) => {
  const configured = value?.trim() ?? "";
  if (!configured) {
    throw new ApiError(
      503,
      "public_booking_unconfigured",
      "Public booking is not configured.",
      { retryable: true }
    );
  }
  return configured;
}, "requiredPublicBookingConfiguration");
var publicBookingEmailOutbox = /* @__PURE__ */ __name((env) => new D1PublicBookingEmailOutbox(
  env.CALENDAR_DB,
  {
    // Web Crypto methods require their receiver in Workers.
    id: /* @__PURE__ */ __name(() => crypto.randomUUID(), "id")
  }
), "publicBookingEmailOutbox");
async function enqueuePublicBookingNotice(env, input) {
  try {
    await publicBookingEmailOutbox(env).enqueue(input);
  } catch {
    throw new ApiError(
      503,
      "booking_notice_pending",
      "The booking changed, but its confirmation is still being prepared. Retry the same request.",
      { retryable: true }
    );
  }
}
__name(enqueuePublicBookingNotice, "enqueuePublicBookingNotice");
async function reconcilePublicApprovalResolution(env, scope, providerOperationId, targetStatus, transitionAt) {
  const store = new D1PublicBookingManagementStore(env.CALENDAR_DB, {
    now: /* @__PURE__ */ __name(() => transitionAt, "now")
  });
  const result = await store.transitionApproval({
    scope,
    providerOperationId,
    targetStatus
  });
  if (result.kind === "not-found") return;
  if (result.kind === "transitioned" || result.kind === "existing") {
    await enqueuePublicBookingNotice(env, result.notice);
    return;
  }
  throw new ApiError(
    503,
    "public_approval_state_pending",
    "The approval changed, but its guest status is still being reconciled. Retry the same request.",
    { retryable: true }
  );
}
__name(reconcilePublicApprovalResolution, "reconcilePublicApprovalResolution");
async function getPublishedPublicBookingPage(route2, env) {
  try {
    const resolved = await resolvePublishedPublicBookingPage(
      env.CALENDAR_DB.withSession("first-primary"),
      route2.profileSlug,
      route2.eventTypeSlug
    );
    return json(projectPublicBookingPage(resolved, {
      baseUrl: publicBookingBaseUrl(env),
      turnstileSiteKey: requiredPublicBookingConfiguration(
        env.PUBLIC_TURNSTILE_SITE_KEY
      ),
      now: Date.now()
    }));
  } catch (error) {
    return publicBookingReadApiError(error);
  }
}
__name(getPublishedPublicBookingPage, "getPublishedPublicBookingPage");
async function getPublishedPublicBookingAvailability(request, route2, url, env, providerFetch) {
  try {
    const requestNow = Date.now();
    await enforcePublicBookingRateLimit({
      limiter: env.PUBLIC_AVAILABILITY_RATE_LIMITER,
      localDevelopment: env.LOCAL_DEVELOPMENT === "true",
      request,
      resource: `availability:${route2.profileSlug}/${route2.eventTypeSlug}`
    });
    const query = publicAvailabilityQuery(url.searchParams);
    const signingKey = await preparePublicSlotSigningKey(
      requiredPublicBookingConfiguration(env.PUBLIC_BOOKING_SLOT_SIGNING_KEY)
    );
    const resolved = await resolvePublishedPublicBookingPage(
      env.CALENDAR_DB.withSession("first-primary"),
      route2.profileSlug,
      route2.eventTypeSlug
    );
    const window = availabilityQueryWindow(resolved, query, requestNow);
    let busyIntervals = [];
    if (window) {
      const input = {
        ...window,
        calendarIds: resolved.privateSnapshot.conflictCalendarIds
      };
      try {
        const [providerBusy, committedBusy] = await Promise.all([
          queryPublicGoogleBusyIntervals(env, {
            workspace: resolved.privateSnapshot.workspaceId,
            principal: resolved.privateSnapshot.principalId
          }, input, providerFetch),
          loadPublicBookingBusyIntervals({
            database: env.CALENDAR_DB.withSession("first-primary"),
            workspace: resolved.privateSnapshot.workspaceId,
            principal: resolved.privateSnapshot.principalId,
            conflictCalendarIds: resolved.privateSnapshot.conflictCalendarIds,
            timeMin: window.timeMin,
            timeMax: window.timeMax
          })
        ]);
        busyIntervals = [...providerBusy, ...committedBusy];
      } catch (error) {
        if (error instanceof ApiError && error.code === "public_availability_unavailable") {
          throw new ApiError(
            error.status,
            error.code,
            error.message,
            { retryable: true }
          );
        }
        throw new ApiError(
          503,
          "public_availability_unavailable",
          "Availability could not be checked. Try again shortly.",
          { retryable: true }
        );
      }
    }
    await assertPublicPageStillCurrent(
      env.CALENDAR_DB.withSession("first-primary"),
      resolved
    );
    return json(await buildPublicAvailability(
      resolved,
      query,
      busyIntervals,
      signingKey,
      requestNow
    ));
  } catch (error) {
    return publicBookingReadApiError(error);
  }
}
__name(getPublishedPublicBookingAvailability, "getPublishedPublicBookingAvailability");
function publicBookingMutationApiError(error) {
  if (error instanceof PublicBookingCreateError || error instanceof PublicTurnstileError) {
    throw new ApiError(
      error.status,
      error.code,
      error.message,
      error.retryable ? { retryable: true } : void 0
    );
  }
  if (error instanceof PublicBookingStoreError) {
    throw new ApiError(
      503,
      "public_booking_unavailable",
      "This booking could not be completed. Try again shortly.",
      { retryable: true }
    );
  }
  return publicBookingReadApiError(error);
}
__name(publicBookingMutationApiError, "publicBookingMutationApiError");
var intervalsOverlap = /* @__PURE__ */ __name((start, end, intervals) => {
  const minimum = Date.parse(start);
  const maximum = Date.parse(end);
  return intervals.some(
    (interval) => Date.parse(interval.start) < maximum && Date.parse(interval.end) > minimum
  );
}, "intervalsOverlap");
async function createPublishedPublicBooking(request, route2, env, providerFetch) {
  try {
    const requestNow = Date.now();
    await enforcePublicBookingRateLimit({
      limiter: env.PUBLIC_BOOKING_RATE_LIMITER,
      localDevelopment: env.LOCAL_DEVELOPMENT === "true",
      request,
      resource: `booking:${route2.profileSlug}/${route2.eventTypeSlug}`
    });
    const parsed = parsePublicBookingRequest(await readJson(request));
    const resolved = await resolvePublishedPublicBookingPage(
      env.CALENDAR_DB.withSession("first-primary"),
      route2.profileSlug,
      route2.eventTypeSlug
    );
    const signingSecret = requiredPublicBookingConfiguration(
      env.PUBLIC_BOOKING_SLOT_SIGNING_KEY
    );
    const claims = await verifyPublicSlotToken(signingSecret, parsed.slotToken, {
      now: requestNow
    });
    const publicOrigin = publicBookingBaseUrl(env);
    const managementSecret = requiredPublicBookingConfiguration(
      env.PUBLIC_BOOKING_MANAGEMENT_SECRET
    );
    const turnstile = await verifyPublicBookingTurnstile({
      secret: env.TURNSTILE_SECRET_KEY,
      token: parsed.turnstileToken,
      verificationId: await publicTurnstileVerificationId(
        parsed.requestId,
        parsed.turnstileToken
      ),
      remoteIp: publicClientIp(request),
      expectedHostname: new URL(publicOrigin).hostname,
      expectedAction: "public_booking",
      now: requestNow,
      providerFetch
    });
    const scope = {
      workspace: resolved.privateSnapshot.workspaceId,
      principal: resolved.privateSnapshot.principalId
    };
    const result = await createPublicBooking(resolved, {
      requestId: parsed.requestId,
      guest: parsed.guest,
      slotProof: { token: parsed.slotToken, claims },
      turnstile
    }, {
      serialization: new D1PublicBookingSerializationBoundary(env.CALENDAR_DB),
      publications: {
        currentPage: /* @__PURE__ */ __name(async (pageId) => {
          try {
            const current = await resolvePublishedPublicBookingPage(
              env.CALENDAR_DB.withSession("first-primary"),
              route2.profileSlug,
              route2.eventTypeSlug
            );
            return current.pageId === pageId ? current : null;
          } catch (error) {
            if (error instanceof PublicBookingReadError && error.status === 404) return null;
            throw error;
          }
        }, "currentPage")
      },
      attempts: new D1PublicBookingAttemptStore(env.CALENDAR_DB, {
        managementSecret,
        managementOrigin: publicOrigin
      }),
      availability: {
        revalidate: /* @__PURE__ */ __name(async (input) => {
          const busy = await queryPublicGoogleBusyIntervals(env, scope, {
            timeMin: input.conflictStart,
            timeMax: input.conflictEnd,
            calendarIds: input.conflictCalendarIds
          }, providerFetch);
          await assertPublicPageStillCurrent(
            env.CALENDAR_DB.withSession("first-primary"),
            input.page
          );
          return {
            revisionId: input.page.revisionId,
            eventStart: input.eventStart,
            eventEnd: input.eventEnd,
            conflictStart: input.conflictStart,
            conflictEnd: input.conflictEnd,
            checkedCalendarIds: input.conflictCalendarIds,
            status: intervalsOverlap(input.conflictStart, input.conflictEnd, busy) ? "conflict" : "available"
          };
        }, "revalidate")
      },
      provider: createGatewayPublicBookingProvider(env, providerFetch, {
        assertPublicationCurrent: /* @__PURE__ */ __name(() => assertPublicPageStillCurrent(
          env.CALENDAR_DB.withSession("first-primary"),
          resolved
        ), "assertPublicationCurrent")
      }),
      managementTokens: new D1PublicBookingManagementTokenIssuer(env.CALENDAR_DB, {
        secret: managementSecret
      }),
      now: Date.now,
      expectedTurnstileAction: "public_booking",
      allowedTurnstileHostnames: [new URL(publicOrigin).hostname],
      managementOrigin: publicOrigin
    });
    const noticeKind = result.status === "pending" ? "approval-requested" : "booking-confirmed";
    await enqueuePublicBookingNotice(env, {
      eventKey: `${noticeKind}:${result.bookingReference}`,
      bookingReference: result.bookingReference,
      scope,
      kind: noticeKind,
      recipient: parsed.guest,
      organizerName: resolved.publicSnapshot.displayName,
      eventTitle: resolved.publicSnapshot.title,
      startsAt: result.startsAt,
      endsAt: result.endsAt,
      timeZone: resolved.privateSnapshot.schedule.timeZone
    });
    return json(result, 201);
  } catch (error) {
    return publicBookingMutationApiError(error);
  }
}
__name(createPublishedPublicBooking, "createPublishedPublicBooking");
var publicBookingManagementUnavailable = /* @__PURE__ */ __name(() => new ApiError(
  404,
  "management_link_unavailable",
  "This booking management link is unavailable."
), "publicBookingManagementUnavailable");
function publicBookingManagementApiError(error) {
  if (error instanceof ApiError) throw error;
  if (error instanceof PublicBookingManagementError || error instanceof PublicTurnstileError || error instanceof PublicBookingRateLimitError) {
    throw new ApiError(
      error.status,
      error.code,
      error.message,
      error.retryable ? { retryable: true } : void 0
    );
  }
  if (error instanceof PublicBookingManagementStoreError || error instanceof PublicBookingEmailError || error instanceof PublicBookingStoreError) {
    throw new ApiError(
      503,
      "public_management_unavailable",
      "This booking could not be updated. Try again shortly.",
      { retryable: true }
    );
  }
  return publicBookingReadApiError(error);
}
__name(publicBookingManagementApiError, "publicBookingManagementApiError");
async function currentPublishedPublicBookingPageById(env, pageId) {
  const database = env.CALENDAR_DB.withSession("first-primary");
  const row = await database.prepare(
    `SELECT profile_slugs.slug AS profile_slug,
            page_slugs.slug AS event_type_slug
       FROM public_booking_pages AS pages
       INNER JOIN public_booking_profiles AS profiles
         ON profiles.id = pages.profile_id
       INNER JOIN public_booking_profile_slugs AS profile_slugs
         ON profile_slugs.profile_id = profiles.id
        AND profile_slugs.active = 1
       INNER JOIN public_booking_page_slugs AS page_slugs
         ON page_slugs.page_id = pages.id
        AND page_slugs.profile_id = profiles.id
        AND page_slugs.active = 1
      WHERE pages.id = ?
        AND profiles.status = 'published'
        AND pages.status = 'published'
        AND profiles.current_slug = profile_slugs.slug COLLATE NOCASE
        AND pages.current_slug = page_slugs.slug COLLATE NOCASE
      LIMIT 1`
  ).bind(pageId).first();
  if (!row || typeof row.profile_slug !== "string" || typeof row.event_type_slug !== "string") {
    return null;
  }
  try {
    const page = await resolvePublishedPublicBookingPage(
      database,
      row.profile_slug,
      row.event_type_slug
    );
    return page.pageId === pageId ? page : null;
  } catch (error) {
    if (error instanceof PublicBookingReadError && error.status === 404) return null;
    throw error;
  }
}
__name(currentPublishedPublicBookingPageById, "currentPublishedPublicBookingPageById");
async function hasPublicBookingManagementOverlap(env, booking, input) {
  if (input.conflictCalendarIds.length === 0) return true;
  const row = await env.CALENDAR_DB.prepare(
    `SELECT idempotency_key
       FROM provider_booking_commits
      WHERE workspace_id = ? AND principal_id = ?
        AND destination_calendar_id IN (${input.conflictCalendarIds.map(() => "?").join(", ")})
        AND state IN ('pending', 'committed')
        AND (booking_kind <> 'approval-hold' OR resolution_status IS NULL OR resolution_status <> 'declined')
        AND (booking_kind <> 'approval-hold' OR hold_expired_at IS NULL)
        AND provider_event_id <> ?
        AND start_at < ? AND end_at > ?
      LIMIT 1`
  ).bind(
    booking.scope.workspace,
    booking.scope.principal,
    ...input.conflictCalendarIds,
    booking.providerBookingId,
    input.conflictEnd,
    input.conflictStart
  ).first();
  return Boolean(row);
}
__name(hasPublicBookingManagementOverlap, "hasPublicBookingManagementOverlap");
var exactStringSequence = /* @__PURE__ */ __name((left, right) => left.length === right.length && left.every((value, index) => value === right[index]), "exactStringSequence");
async function assertPublicManagementRescheduleStillAuthorized(env, booking, input) {
  const mutation = await env.CALENDAR_DB.prepare(
    `SELECT page_revision_id, to_start_at, to_end_at,
            conflict_calendar_ids_json, conflict_start_at, conflict_end_at, state
       FROM public_booking_management_mutations
      WHERE booking_reference = ? AND operation_id = ? AND kind = 'reschedule'
      LIMIT 1`
  ).bind(booking.bookingReference, input.operationId).first();
  let conflictCalendarIds = [];
  try {
    const parsed = mutation?.conflict_calendar_ids_json ? JSON.parse(mutation.conflict_calendar_ids_json) : null;
    if (Array.isArray(parsed) && parsed.every((value) => typeof value === "string")) {
      conflictCalendarIds = parsed;
    }
  } catch {
    conflictCalendarIds = [];
  }
  const page = await currentPublishedPublicBookingPageById(env, booking.pageId);
  if (!mutation || !page || !["pending", "uncertain"].includes(mutation.state) || mutation.page_revision_id === null || mutation.page_revision_id !== page.revisionId || mutation.to_start_at !== input.timeMin || mutation.to_end_at !== input.timeMax || mutation.conflict_start_at !== input.conflictTimeMin || mutation.conflict_end_at !== input.conflictTimeMax || !exactStringSequence(conflictCalendarIds, input.conflictCalendarIds) || input.scope.workspace !== booking.scope.workspace || input.scope.principal !== booking.scope.principal || input.destinationCalendarId !== booking.destinationCalendarId || page.privateSnapshot.workspaceId !== booking.scope.workspace || page.privateSnapshot.principalId !== booking.scope.principal || page.privateSnapshot.destinationCalendarId !== booking.destinationCalendarId) {
    throw new Error("The public booking publication changed before the provider write.");
  }
}
__name(assertPublicManagementRescheduleStillAuthorized, "assertPublicManagementRescheduleStillAuthorized");
function publicBookingManagementDependencies(env, providerFetch, booking, store) {
  const slotSigningSecret = requiredPublicBookingConfiguration(
    env.PUBLIC_BOOKING_SLOT_SIGNING_KEY
  );
  return {
    serialization: new D1PublicBookingSerializationBoundary(env.CALENDAR_DB),
    store,
    publications: {
      currentPage: /* @__PURE__ */ __name((pageId) => currentPublishedPublicBookingPageById(env, pageId), "currentPage")
    },
    slotVerifier: {
      verify: /* @__PURE__ */ __name(async (input) => ({
        token: input.token,
        claims: await verifyPublicSlotToken(slotSigningSecret, input.token, {
          now: Date.now()
        })
      }), "verify")
    },
    availability: {
      revalidate: /* @__PURE__ */ __name(async (input) => {
        const [committedOverlap, live] = await Promise.all([
          hasPublicBookingManagementOverlap(env, booking, input),
          strictLiveAvailabilityForScope(
            booking.scope,
            env,
            {
              timeMin: input.conflictStart,
              timeMax: input.conflictEnd,
              calendarIds: input.conflictCalendarIds
            },
            providerFetch,
            /* @__PURE__ */ new Set([googleEventId(
              "event",
              booking.destinationCalendarId,
              booking.providerBookingId
            )])
          )
        ]);
        await assertPublicPageStillCurrent(
          env.CALENDAR_DB.withSession("first-primary"),
          input.page
        );
        return {
          revisionId: input.page.revisionId,
          eventStart: input.eventStart,
          eventEnd: input.eventEnd,
          conflictStart: input.conflictStart,
          conflictEnd: input.conflictEnd,
          checkedCalendarIds: input.conflictCalendarIds,
          status: !live.conclusive ? "uncertain" : committedOverlap || !live.available ? "conflict" : "available"
        };
      }, "revalidate")
    },
    provider: createGatewayPublicBookingManagementProvider(env, providerFetch, {
      assertRescheduleStillAuthorized: /* @__PURE__ */ __name((input) => assertPublicManagementRescheduleStillAuthorized(env, booking, input), "assertRescheduleStillAuthorized")
    }),
    email: createPublicBookingManagementEmailPort(
      publicBookingEmailOutbox(env)
    ),
    now: Date.now,
    turnstileSiteKey: requiredPublicBookingConfiguration(
      env.PUBLIC_TURNSTILE_SITE_KEY
    )
  };
}
__name(publicBookingManagementDependencies, "publicBookingManagementDependencies");
async function resolvePublicBookingManagementRequest(request, url, env, resource) {
  const authorization = request.headers.get("Authorization");
  const match = authorization?.match(/^Bearer ([^\s,]+)$/iu);
  let token = null;
  try {
    token = parsePublicBookingManagementToken(match?.[1]);
  } catch {
    token = null;
  }
  await enforcePublicBookingRateLimit({
    limiter: env.PUBLIC_MANAGEMENT_RATE_LIMITER,
    localDevelopment: env.LOCAL_DEVELOPMENT === "true",
    request,
    resource: `management:${resource}`
  });
  const store = new D1PublicBookingManagementStore(env.CALENDAR_DB);
  let booking = null;
  try {
    booking = await store.resolve(token ?? "");
  } catch {
    booking = null;
  }
  if (url.search || !token || !booking) throw publicBookingManagementUnavailable();
  return { token, booking, store };
}
__name(resolvePublicBookingManagementRequest, "resolvePublicBookingManagementRequest");
async function getPublicBookingManagement(request, url, env, providerFetch) {
  try {
    const context = await resolvePublicBookingManagementRequest(
      request,
      url,
      env,
      "read"
    );
    return json(await readPublicBookingManagement(
      context.token,
      publicBookingManagementDependencies(env, providerFetch, context.booking, context.store)
    ));
  } catch (error) {
    return publicBookingManagementApiError(error);
  }
}
__name(getPublicBookingManagement, "getPublicBookingManagement");
async function cancelManagedPublicBooking(request, url, env, providerFetch) {
  try {
    const context = await resolvePublicBookingManagementRequest(
      request,
      url,
      env,
      "cancel"
    );
    const parsed = parsePublicBookingCancelRequest(await readJson(request));
    return json(await cancelPublicBooking(
      context.token,
      parsed,
      publicBookingManagementDependencies(env, providerFetch, context.booking, context.store)
    ));
  } catch (error) {
    return publicBookingManagementApiError(error);
  }
}
__name(cancelManagedPublicBooking, "cancelManagedPublicBooking");
async function rescheduleManagedPublicBooking(request, url, env, providerFetch) {
  try {
    const context = await resolvePublicBookingManagementRequest(
      request,
      url,
      env,
      "reschedule"
    );
    const parsed = parsePublicBookingRescheduleRequest(await readJson(request));
    const publicOrigin = publicBookingBaseUrl(env);
    await verifyPublicBookingTurnstile({
      secret: env.TURNSTILE_SECRET_KEY,
      token: parsed.turnstileToken,
      verificationId: await publicTurnstileVerificationId(
        parsed.requestId,
        parsed.turnstileToken
      ),
      remoteIp: publicClientIp(request),
      expectedHostname: new URL(publicOrigin).hostname,
      expectedAction: "public_booking_reschedule",
      now: Date.now(),
      providerFetch
    });
    return json(await reschedulePublicBooking(
      context.token,
      parsed,
      publicBookingManagementDependencies(env, providerFetch, context.booking, context.store)
    ));
  } catch (error) {
    return publicBookingManagementApiError(error);
  }
}
__name(rescheduleManagedPublicBooking, "rescheduleManagedPublicBooking");
var base64Url6 = /* @__PURE__ */ __name((bytes) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}, "base64Url");
var fromBase64 = /* @__PURE__ */ __name((value) => {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}, "fromBase64");
var randomValue = /* @__PURE__ */ __name((bytes) => {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return base64Url6(value);
}, "randomValue");
async function sha2563(value) {
  const digest2 = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64Url6(new Uint8Array(digest2));
}
__name(sha2563, "sha256");
async function encryptionKey(env) {
  const encoded = env.TOKEN_ENCRYPTION_KEY;
  if (!encoded) {
    throw new ApiError(
      503,
      "token_encryption_unconfigured",
      "TOKEN_ENCRYPTION_KEY is required for provider authorization."
    );
  }
  let bytes;
  try {
    bytes = fromBase64(encoded);
  } catch {
    throw new ApiError(503, "token_encryption_invalid", "TOKEN_ENCRYPTION_KEY is invalid.");
  }
  if (bytes.byteLength !== 32) {
    throw new ApiError(
      503,
      "token_encryption_invalid",
      "TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes."
    );
  }
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}
__name(encryptionKey, "encryptionKey");
async function encryptSecret(env, value) {
  const key = await encryptionKey(env);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return `v1.${base64Url6(iv)}.${base64Url6(new Uint8Array(ciphertext))}`;
}
__name(encryptSecret, "encryptSecret");
async function decryptSecret(env, value) {
  const [version, ivValue, ciphertextValue, ...extra] = value.split(".");
  if (version !== "v1" || !ivValue || !ciphertextValue || extra.length > 0) {
    throw new ApiError(500, "credential_corrupt", "Stored provider credentials are invalid.");
  }
  try {
    const key = await encryptionKey(env);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(ivValue) },
      key,
      fromBase64(ciphertextValue)
    );
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, "credential_corrupt", "Stored provider credentials could not be decrypted.");
  }
}
__name(decryptSecret, "decryptSecret");
function oauthProviderConfig(env, value) {
  if (value === "google") {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.TOKEN_ENCRYPTION_KEY) {
      return null;
    }
    return {
      id: "google",
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scopes: [
        "openid",
        "email",
        "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/calendar.freebusy"
      ]
    };
  }
  if (!env.MICROSOFT_CLIENT_ID || !env.MICROSOFT_CLIENT_SECRET || !env.TOKEN_ENCRYPTION_KEY) {
    return null;
  }
  return {
    id: "microsoft",
    clientId: env.MICROSOFT_CLIENT_ID,
    clientSecret: env.MICROSOFT_CLIENT_SECRET,
    authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scopes: [
      "openid",
      "profile",
      "email",
      "offline_access",
      "User.Read",
      "Calendars.ReadWrite",
      "Calendars.ReadWrite.Shared"
    ]
  };
}
__name(oauthProviderConfig, "oauthProviderConfig");
var providerCatalog = /* @__PURE__ */ __name((env) => ({
  providers: [
    {
      id: "google",
      authorization: "oauth",
      configured: oauthProviderConfig(env, "google") !== null
    },
    {
      id: "microsoft",
      authorization: "oauth",
      configured: oauthProviderConfig(env, "microsoft") !== null
    },
    {
      id: "icloud",
      authorization: "app-specific-password",
      configured: Boolean(env.TOKEN_ENCRYPTION_KEY),
      note: "CalDAV credential discovery is the next provider adapter."
    },
    {
      id: "caldav",
      authorization: "credentials",
      configured: false,
      note: "The local gateway contract reserves credential-backed CalDAV discovery."
    },
    {
      id: "exchange",
      authorization: "enterprise",
      configured: false,
      note: "Exchange Server requires an organization-specific EWS adapter."
    },
    {
      id: "ics",
      authorization: "subscription-url",
      configured: false,
      note: "ICS subscription ingestion is not enabled in this local gateway build."
    }
  ],
  localConnector: env.LOCAL_DEVELOPMENT === "true"
}), "providerCatalog");
var calendarProjection = /* @__PURE__ */ __name((row) => ({
  id: row.id,
  providerCalendarId: row.provider_calendar_id,
  name: row.name,
  color: row.color,
  role: row.role,
  writable: row.writable === 1,
  freshness: row.freshness,
  primary: row.is_primary === 1
}), "calendarProjection");
var connectionProjection = /* @__PURE__ */ __name((row, calendars) => ({
  id: row.id,
  workspaceId: row.workspace_id,
  ownerPrincipalId: row.principal_id,
  provider: row.provider,
  mode: row.mode,
  label: row.label,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  lastSyncedAt: row.last_synced_at,
  calendars: calendars.map(calendarProjection)
}), "connectionProjection");
async function connectionById(env, workspace, principal, connectionId) {
  const row = await env.CALENDAR_DB.prepare(
    `SELECT * FROM calendar_connections
      WHERE workspace_id = ? AND principal_id = ? AND id = ?`
  ).bind(workspace, principal, connectionId).first();
  if (!row) {
    throw new ApiError(404, "connection_not_found", "The calendar connection was not found.");
  }
  const calendars = await env.CALENDAR_DB.prepare(
    "SELECT * FROM provider_calendars WHERE connection_id = ? ORDER BY name, id"
  ).bind(connectionId).all();
  return { row, calendars: calendars.results };
}
__name(connectionById, "connectionById");
async function listConnections(request, env) {
  const { workspace, principal } = await principalScope(request, env);
  const connections = await env.CALENDAR_DB.prepare(
    `SELECT * FROM calendar_connections
      WHERE workspace_id = ? AND principal_id = ?
      ORDER BY updated_at DESC, id`
  ).bind(workspace, principal).all();
  const calendars = await env.CALENDAR_DB.prepare(
    `SELECT provider_calendars.* FROM provider_calendars
       INNER JOIN calendar_connections ON calendar_connections.id = provider_calendars.connection_id
      WHERE calendar_connections.workspace_id = ?
        AND calendar_connections.principal_id = ?
      ORDER BY provider_calendars.name, provider_calendars.id`
  ).bind(workspace, principal).all();
  const grouped = /* @__PURE__ */ new Map();
  for (const calendar of calendars.results) {
    const current = grouped.get(calendar.connection_id) ?? [];
    current.push(calendar);
    grouped.set(calendar.connection_id, current);
  }
  return json({
    connections: connections.results.map(
      (row) => connectionProjection(row, grouped.get(row.id) ?? [])
    )
  });
}
__name(listConnections, "listConnections");
function localCalendarInputs(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 250) {
    throw new ApiError(400, "invalid_calendars", "Add between 1 and 250 calendars.");
  }
  const ids = /* @__PURE__ */ new Set();
  const providerIds = /* @__PURE__ */ new Set();
  return value.map((candidate, index) => {
    if (!isRecord9(candidate)) {
      throw new ApiError(400, "invalid_calendars", `calendars[${index}] is invalid.`);
    }
    const id = identifier2(candidate.id, `calendars[${index}].id`);
    const providerCalendarId = requiredText3(
      candidate.providerCalendarId ?? candidate.id,
      `calendars[${index}].providerCalendarId`,
      2048
    );
    const name = requiredText3(candidate.name, `calendars[${index}].name`);
    const role = candidate.role;
    if (role !== "owner" && role !== "writer" && role !== "reader" && role !== "free-busy") {
      throw new ApiError(400, "invalid_calendars", `calendars[${index}].role is invalid.`);
    }
    const writable = candidate.writable;
    if (typeof writable !== "boolean" || writable !== (role === "owner" || role === "writer")) {
      throw new ApiError(
        400,
        "invalid_calendars",
        `calendars[${index}].writable must match its access role.`
      );
    }
    const color = typeof candidate.color === "string" && COLOR.test(candidate.color) ? candidate.color.toLowerCase() : "#4f7cff";
    const freshness = candidate.freshness;
    if (freshness !== "live" && freshness !== "delayed" && freshness !== "stale") {
      throw new ApiError(400, "invalid_calendars", `calendars[${index}].freshness is invalid.`);
    }
    if (ids.has(id) || providerIds.has(providerCalendarId)) {
      throw new ApiError(409, "duplicate_calendar", "Calendar identifiers must be unique.");
    }
    ids.add(id);
    providerIds.add(providerCalendarId);
    return {
      id,
      providerCalendarId,
      name,
      color,
      role,
      writable,
      freshness,
      primary: candidate.primary === true
    };
  });
}
__name(localCalendarInputs, "localCalendarInputs");
function localCalendarIds(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 250) {
    throw new ApiError(400, "invalid_calendars", "Remove between 1 and 250 calendars.");
  }
  const ids = value.map((candidate, index) => identifier2(candidate, `calendarIds[${index}]`));
  if (new Set(ids).size !== ids.length) {
    throw new ApiError(400, "invalid_calendars", "Calendar identifiers must be unique.");
  }
  return ids;
}
__name(localCalendarIds, "localCalendarIds");
var calendarInsert = /* @__PURE__ */ __name((env, connectionId, calendar, timestamp) => env.CALENDAR_DB.prepare(
  `INSERT INTO provider_calendars
      (id, connection_id, provider_calendar_id, name, color, role, writable, freshness,
       is_primary, raw_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
).bind(
  calendar.id,
  connectionId,
  calendar.providerCalendarId,
  calendar.name,
  calendar.color,
  calendar.role,
  calendar.writable ? 1 : 0,
  calendar.freshness,
  calendar.primary ? 1 : 0,
  JSON.stringify({ source: "local-connector" }),
  timestamp,
  timestamp
), "calendarInsert");
async function createLocalConnection(request, env) {
  requireLocalDevelopment(env);
  const { workspace, principal } = await principalScope(request, env);
  const body = await readJson(request);
  const connectionId = identifier2(body.id, "id");
  const selectedProvider = provider(body.provider);
  const label = requiredText3(body.label, "label");
  const calendars = localCalendarInputs(body.calendars);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const status = calendars.some((calendar) => calendar.writable) ? "connected" : "read-only";
  const statements = [
    env.CALENDAR_DB.prepare(
      `INSERT INTO calendar_connections
        (id, workspace_id, principal_id, provider, mode, label, status, credential_ciphertext,
         token_expires_at, created_at, updated_at, last_synced_at)
       VALUES (?, ?, ?, ?, 'local', ?, ?, NULL, NULL, ?, ?, ?)`
    ).bind(
      connectionId,
      workspace,
      principal,
      selectedProvider,
      label,
      status,
      now,
      now,
      now
    ),
    ...calendars.map((calendar) => calendarInsert(env, connectionId, calendar, now))
  ];
  try {
    await env.CALENDAR_DB.batch(statements);
  } catch (error) {
    console.warn(JSON.stringify({ message: "local connection rejected", connectionId }));
    throw new ApiError(
      409,
      "connection_conflict",
      error instanceof Error && error.message.includes("provider_calendars") ? "A calendar identifier is already connected." : "This calendar connection already exists."
    );
  }
  const created = await connectionById(env, workspace, principal, connectionId);
  return json({ connection: connectionProjection(created.row, created.calendars) }, 201);
}
__name(createLocalConnection, "createLocalConnection");
async function addLocalCalendars(request, env, connectionId) {
  requireLocalDevelopment(env);
  const { workspace, principal } = await principalScope(request, env);
  const connection = await connectionById(env, workspace, principal, connectionId);
  if (connection.row.mode !== "local") {
    throw new ApiError(
      409,
      "provider_managed_connection",
      "Refresh provider-managed connections instead of adding invented calendars."
    );
  }
  const body = await readJson(request);
  const calendars = localCalendarInputs(body.calendars);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  try {
    await env.CALENDAR_DB.batch([
      ...calendars.map((calendar) => calendarInsert(env, connectionId, calendar, now)),
      env.CALENDAR_DB.prepare(
        `UPDATE calendar_connections
            SET status = ?, updated_at = ?, last_synced_at = ?
          WHERE workspace_id = ? AND principal_id = ? AND id = ?`
      ).bind(
        [...connection.calendars, ...calendars].some(
          (calendar) => "writable" in calendar ? Boolean(calendar.writable) : false
        ) ? "connected" : "read-only",
        now,
        now,
        workspace,
        principal,
        connectionId
      )
    ]);
  } catch {
    throw new ApiError(409, "calendar_conflict", "One or more calendars are already connected.");
  }
  const updated = await connectionById(env, workspace, principal, connectionId);
  return json({ connection: connectionProjection(updated.row, updated.calendars) });
}
__name(addLocalCalendars, "addLocalCalendars");
async function removeLocalCalendars(request, env, connectionId) {
  requireLocalDevelopment(env);
  const { workspace, principal } = await principalScope(request, env);
  const connection = await connectionById(env, workspace, principal, connectionId);
  if (connection.row.mode !== "local") {
    throw new ApiError(
      409,
      "provider_managed_connection",
      "Provider-managed calendars can only change through provider discovery."
    );
  }
  const body = await readJson(request);
  const calendarIds = localCalendarIds(body.calendarIds);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const placeholders = calendarIds.map(() => "?").join(", ");
  await env.CALENDAR_DB.batch([
    env.CALENDAR_DB.prepare(
      `DELETE FROM provider_calendars
        WHERE connection_id = ? AND id IN (${placeholders})`
    ).bind(connectionId, ...calendarIds),
    env.CALENDAR_DB.prepare(
      `UPDATE calendar_connections
          SET status = CASE
                WHEN EXISTS (
                  SELECT 1 FROM provider_calendars
                   WHERE connection_id = ? AND writable = 1
                ) THEN 'connected'
                ELSE 'read-only'
              END,
              updated_at = ?, last_synced_at = ?
        WHERE workspace_id = ? AND principal_id = ? AND id = ?`
    ).bind(connectionId, now, now, workspace, principal, connectionId)
  ]);
  const updated = await connectionById(env, workspace, principal, connectionId);
  return json({ connection: connectionProjection(updated.row, updated.calendars) });
}
__name(removeLocalCalendars, "removeLocalCalendars");
async function removeCalendars(request, env, connectionId) {
  const { workspace, principal } = await principalScope(request, env);
  const connection = await connectionById(env, workspace, principal, connectionId);
  const body = await readJson(request);
  const calendarIds = localCalendarIds(body.calendarIds);
  const requestedIds = new Set(calendarIds);
  const activeById = new Map(
    connection.calendars.filter((calendar) => requestedIds.has(calendar.id)).map((calendar) => [calendar.id, calendar])
  );
  const placeholders = calendarIds.map(() => "?").join(", ");
  const excluded = await env.CALENDAR_DB.prepare(
    `SELECT calendar_id, provider_calendar_id FROM calendar_exclusions
      WHERE workspace_id = ? AND connection_id = ?
        AND calendar_id IN (${placeholders})`
  ).bind(workspace, connectionId, ...calendarIds).all();
  const knownIds = /* @__PURE__ */ new Set([
    ...activeById.keys(),
    ...excluded.results.map((calendar) => calendar.calendar_id)
  ]);
  if (calendarIds.some((calendarId) => !knownIds.has(calendarId))) {
    throw new ApiError(
      404,
      "calendar_not_found",
      "One or more calendars were not found in this connection."
    );
  }
  const active = calendarIds.flatMap((calendarId) => {
    const calendar = activeById.get(calendarId);
    return calendar ? [calendar] : [];
  });
  if (active.length === 0) {
    return json({ connection: connectionProjection(connection.row, connection.calendars) });
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const activeIds = active.map((calendar) => calendar.id);
  await env.CALENDAR_DB.batch([
    ...active.map(
      (calendar) => env.CALENDAR_DB.prepare(
        `INSERT INTO calendar_exclusions
          (workspace_id, connection_id, calendar_id, provider_calendar_id, excluded_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (workspace_id, connection_id, provider_calendar_id)
         DO UPDATE SET calendar_id = excluded.calendar_id, excluded_at = excluded.excluded_at`
      ).bind(
        workspace,
        connectionId,
        calendar.id,
        calendar.provider_calendar_id,
        now
      )
    ),
    env.CALENDAR_DB.prepare(
      `DELETE FROM provider_calendars
        WHERE connection_id = ? AND id IN (${activeIds.map(() => "?").join(", ")})`
    ).bind(connectionId, ...activeIds),
    env.CALENDAR_DB.prepare(
      `UPDATE calendar_connections
          SET status = CASE
                WHEN EXISTS (
                  SELECT 1 FROM provider_calendars
                   WHERE connection_id = ? AND writable = 1
                ) THEN 'connected'
                ELSE 'read-only'
              END,
              updated_at = ?, last_synced_at = ?
        WHERE workspace_id = ? AND principal_id = ? AND id = ?`
    ).bind(connectionId, now, now, workspace, principal, connectionId)
  ]);
  const updated = await connectionById(env, workspace, principal, connectionId);
  return json({ connection: connectionProjection(updated.row, updated.calendars) });
}
__name(removeCalendars, "removeCalendars");
async function deleteConnection(request, env, connectionId) {
  const { workspace, principal } = await principalScope(request, env);
  const result = await env.CALENDAR_DB.prepare(
    `DELETE FROM calendar_connections
      WHERE workspace_id = ? AND principal_id = ? AND id = ?`
  ).bind(workspace, principal, connectionId).run();
  if (Number(result.meta.changes ?? 0) === 0) {
    throw new ApiError(404, "connection_not_found", "The calendar connection was not found.");
  }
  return new Response(null, { status: 204 });
}
__name(deleteConnection, "deleteConnection");
async function externalJson(url, init, providerFetch = fetch) {
  const response = await providerFetch(url, init);
  const declared = Number(response.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_PROVIDER_RESPONSE_BYTES) {
    throw new ApiError(
      502,
      "provider_response_too_large",
      "The provider response exceeded the safe response limit."
    );
  }
  if (!response.body) {
    throw new ApiError(502, "provider_response_invalid", "The provider returned an empty response.");
  }
  const reader = response.body.getReader();
  const decoder2 = new TextDecoder();
  let bytes = 0;
  let text = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > MAX_PROVIDER_RESPONSE_BYTES) {
      await reader.cancel("provider response too large");
      throw new ApiError(
        502,
        "provider_response_too_large",
        "The provider response exceeded the safe response limit."
      );
    }
    text += decoder2.decode(chunk.value, { stream: true });
  }
  text += decoder2.decode();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!response.ok) {
    const record = isRecord9(parsed) ? parsed : {};
    const nestedError = isRecord9(record.error) ? record.error : {};
    const message2 = typeof nestedError.message === "string" && nestedError.message || typeof record.error_description === "string" && record.error_description || `Provider request failed with HTTP ${response.status}.`;
    throw new ProviderHttpError(response.status, message2.slice(0, 500));
  }
  if (!isRecord9(parsed)) {
    throw new ApiError(502, "provider_response_invalid", "The provider returned invalid JSON.");
  }
  return parsed;
}
__name(externalJson, "externalJson");
function tokenSecret(value) {
  const accessToken = requiredText3(value.access_token, "provider access token", 16384);
  const expiresIn = typeof value.expires_in === "number" && Number.isFinite(value.expires_in) ? Math.max(60, value.expires_in) : 3600;
  const refreshToken2 = typeof value.refresh_token === "string" && value.refresh_token ? value.refresh_token : void 0;
  const scope = typeof value.scope === "string" ? value.scope : void 0;
  return {
    accessToken,
    ...refreshToken2 ? { refreshToken: refreshToken2 } : {},
    expiresAt: new Date(Date.now() + expiresIn * 1e3).toISOString(),
    tokenType: typeof value.token_type === "string" ? value.token_type : "Bearer",
    ...scope ? { scope } : {}
  };
}
__name(tokenSecret, "tokenSecret");
async function beginOAuth(request, env, selectedProvider) {
  const { workspace, principal } = await principalScope(request, env);
  const config = oauthProviderConfig(env, selectedProvider);
  if (!config) {
    throw new ApiError(
      503,
      "provider_unconfigured",
      `${selectedProvider === "google" ? "Google" : "Microsoft"} OAuth credentials are not configured in .dev.vars.`
    );
  }
  const body = await readJson(request);
  const connectionId = identifier2(body.id, "id");
  const labelHint = typeof body.label === "string" && body.label.trim() ? requiredText3(body.label, "label") : `${selectedProvider} account`;
  const state = randomValue(32);
  const stateHash = await sha2563(state);
  const verifier = randomValue(64);
  const challenge = await sha2563(verifier);
  const verifierCiphertext = await encryptSecret(env, { verifier });
  const now = /* @__PURE__ */ new Date();
  const expiresAt = new Date(now.valueOf() + OAUTH_STATE_TTL_MS).toISOString();
  const redirectUri = `${new URL(request.url).origin}/v1/oauth/${selectedProvider}/callback`;
  try {
    await env.CALENDAR_DB.batch([
      env.CALENDAR_DB.prepare(
        `INSERT INTO calendar_connections
          (id, workspace_id, principal_id, provider, mode, label, status, credential_ciphertext,
           token_expires_at, created_at, updated_at, last_synced_at)
         VALUES (?, ?, ?, ?, 'oauth', ?, 'pending', NULL, NULL, ?, ?, NULL)`
      ).bind(
        connectionId,
        workspace,
        principal,
        selectedProvider,
        labelHint,
        now.toISOString(),
        now.toISOString()
      ),
      env.CALENDAR_DB.prepare(
        `INSERT INTO oauth_states
          (state_hash, connection_id, workspace_id, principal_id, provider, verifier_ciphertext,
           expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        stateHash,
        connectionId,
        workspace,
        principal,
        selectedProvider,
        verifierCiphertext,
        expiresAt,
        now.toISOString()
      )
    ]);
  } catch {
    throw new ApiError(409, "connection_conflict", "This calendar connection already exists.");
  }
  const authorizationUrl = new URL(config.authorizeUrl);
  authorizationUrl.searchParams.set("client_id", config.clientId);
  authorizationUrl.searchParams.set("redirect_uri", redirectUri);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", config.scopes.join(" "));
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("code_challenge", challenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");
  if (selectedProvider === "google") {
    authorizationUrl.searchParams.set("access_type", "offline");
    authorizationUrl.searchParams.set("include_granted_scopes", "true");
    authorizationUrl.searchParams.set("prompt", "consent");
  } else {
    authorizationUrl.searchParams.set("response_mode", "query");
    authorizationUrl.searchParams.set("prompt", "select_account");
  }
  return json(
    {
      connectionId,
      authorizationUrl: authorizationUrl.href,
      expiresAt
    },
    201
  );
}
__name(beginOAuth, "beginOAuth");
async function discoverGoogle(accessToken, providerFetch = fetch) {
  const calendars = [];
  let pageToken = null;
  let pageCount = 0;
  do {
    pageCount += 1;
    if (pageCount > MAX_PROVIDER_PAGES) {
      throw new ApiError(502, "provider_pagination_invalid", "Google Calendar returned too many pages.");
    }
    const url = new URL("https://www.googleapis.com/calendar/v3/users/me/calendarList");
    url.searchParams.set("maxResults", "250");
    url.searchParams.set("showDeleted", "false");
    url.searchParams.set("showHidden", "true");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const page = await externalJson(
      url.href,
      { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } },
      providerFetch
    );
    const items = Array.isArray(page.items) ? page.items : [];
    for (const item of items) {
      if (!isRecord9(item) || typeof item.id !== "string") continue;
      const accessRole = item.accessRole;
      const role = accessRole === "owner" ? "owner" : accessRole === "writer" ? "writer" : accessRole === "freeBusyReader" ? "free-busy" : "reader";
      calendars.push({
        providerCalendarId: item.id,
        name: typeof item.summaryOverride === "string" ? item.summaryOverride : typeof item.summary === "string" ? item.summary : item.id,
        color: typeof item.backgroundColor === "string" && COLOR.test(item.backgroundColor) ? item.backgroundColor.toLowerCase() : "#4285f4",
        role,
        writable: role === "owner" || role === "writer",
        freshness: "live",
        primary: item.primary === true,
        raw: item
      });
    }
    pageToken = typeof page.nextPageToken === "string" ? page.nextPageToken : null;
  } while (pageToken);
  const primary = calendars.find((calendar) => calendar.primary);
  return {
    label: primary?.providerCalendarId ?? primary?.name ?? "Google Calendar",
    calendars
  };
}
__name(discoverGoogle, "discoverGoogle");
var microsoftColors = {
  auto: "#0078d4",
  lightBlue: "#3a96dd",
  lightGreen: "#13a10e",
  lightOrange: "#ff8c00",
  lightGray: "#7a7574",
  lightYellow: "#fce100",
  lightTeal: "#00b7c3",
  lightPink: "#e43ba6",
  lightBrown: "#a4262c",
  lightRed: "#d13438",
  maxColor: "#8764b8"
};
function normalizeMicrosoftCalendarPageUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError(502, "provider_pagination_invalid", "Microsoft returned an invalid calendar page URL.");
  }
  if (url.origin !== "https://graph.microsoft.com" || url.pathname !== "/v1.0/me/calendars" || url.username || url.password || url.hash) {
    throw new ApiError(502, "provider_pagination_invalid", "Microsoft returned an untrusted calendar page URL.");
  }
  return url.href;
}
__name(normalizeMicrosoftCalendarPageUrl, "normalizeMicrosoftCalendarPageUrl");
async function discoverMicrosoft(accessToken, providerFetch = fetch) {
  const headers = { Authorization: `Bearer ${accessToken}`, Accept: "application/json" };
  const identity = await externalJson(
    "https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName",
    { headers },
    providerFetch
  );
  const accountAddress = typeof identity.mail === "string" && identity.mail || typeof identity.userPrincipalName === "string" && identity.userPrincipalName || "";
  const calendars = [];
  let nextUrl = "https://graph.microsoft.com/v1.0/me/calendars?$top=100&$select=id,name,color,hexColor,canEdit,canViewPrivateItems,isDefaultCalendar,owner";
  let pageCount = 0;
  while (nextUrl) {
    pageCount += 1;
    if (pageCount > MAX_PROVIDER_PAGES) {
      throw new ApiError(502, "provider_pagination_invalid", "Microsoft returned too many calendar pages.");
    }
    const page = await externalJson(
      normalizeMicrosoftCalendarPageUrl(nextUrl),
      { headers },
      providerFetch
    );
    const items = Array.isArray(page.value) ? page.value : [];
    for (const item of items) {
      if (!isRecord9(item) || typeof item.id !== "string") continue;
      const owner = isRecord9(item.owner) ? item.owner : {};
      const ownerAddress = typeof owner.address === "string" ? owner.address : "";
      const owns = Boolean(accountAddress) && ownerAddress.toLowerCase() === accountAddress.toLowerCase();
      const role = owns ? "owner" : item.canEdit === true ? "writer" : "reader";
      const hexColor = typeof item.hexColor === "string" && COLOR.test(item.hexColor) ? item.hexColor.toLowerCase() : microsoftColors[typeof item.color === "string" ? item.color : "auto"] ?? "#0078d4";
      calendars.push({
        providerCalendarId: item.id,
        name: typeof item.name === "string" && item.name ? item.name : "Calendar",
        color: hexColor,
        role,
        writable: role === "owner" || role === "writer",
        freshness: "live",
        primary: item.isDefaultCalendar === true,
        raw: item
      });
    }
    nextUrl = typeof page["@odata.nextLink"] === "string" ? normalizeMicrosoftCalendarPageUrl(page["@odata.nextLink"]) : null;
  }
  return {
    label: accountAddress || (typeof identity.displayName === "string" && identity.displayName ? identity.displayName : "Microsoft 365"),
    calendars
  };
}
__name(discoverMicrosoft, "discoverMicrosoft");
var discoverProvider = /* @__PURE__ */ __name((selectedProvider, accessToken, providerFetch = fetch) => selectedProvider === "google" ? discoverGoogle(accessToken, providerFetch) : discoverMicrosoft(accessToken, providerFetch), "discoverProvider");
async function persistDiscovery(env, connection, discovery, secret) {
  if (discovery.calendars.length === 0) {
    throw new ApiError(502, "no_calendars", "The provider returned no calendars.");
  }
  const existing = await env.CALENDAR_DB.prepare(
    "SELECT * FROM provider_calendars WHERE connection_id = ?"
  ).bind(connection.id).all();
  const exclusions = await env.CALENDAR_DB.prepare(
    `SELECT calendar_id, provider_calendar_id FROM calendar_exclusions
      WHERE workspace_id = ? AND connection_id = ?`
  ).bind(connection.workspace_id, connection.id).all();
  const excludedProviderIds = new Set(
    exclusions.results.map((calendar) => calendar.provider_calendar_id)
  );
  const includedCalendars = discovery.calendars.filter(
    (calendar) => !excludedProviderIds.has(calendar.providerCalendarId)
  );
  const idsByProviderId = new Map(
    existing.results.map((calendar) => [calendar.provider_calendar_id, calendar.id])
  );
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const ciphertext = await encryptSecret(env, secret);
  const status = includedCalendars.some((calendar) => calendar.writable) ? "connected" : "read-only";
  const statements = [
    env.CALENDAR_DB.prepare(
      `UPDATE calendar_connections
          SET label = ?, status = ?, credential_ciphertext = ?, token_expires_at = ?,
              updated_at = ?, last_synced_at = ?
        WHERE id = ? AND workspace_id = ? AND principal_id = ?`
    ).bind(
      discovery.label,
      status,
      ciphertext,
      secret.expiresAt,
      now,
      now,
      connection.id,
      connection.workspace_id,
      connection.principal_id
    )
  ];
  for (const calendar of includedCalendars) {
    const calendarId = idsByProviderId.get(calendar.providerCalendarId) ?? `calendar-${crypto.randomUUID()}`;
    statements.push(
      env.CALENDAR_DB.prepare(
        `INSERT INTO provider_calendars
          (id, connection_id, provider_calendar_id, name, color, role, writable,
           freshness, is_primary, raw_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (connection_id, provider_calendar_id) DO UPDATE SET
           name = excluded.name,
           color = excluded.color,
           role = excluded.role,
           writable = excluded.writable,
           freshness = excluded.freshness,
           is_primary = excluded.is_primary,
           raw_json = excluded.raw_json,
           updated_at = excluded.updated_at`
      ).bind(
        calendarId,
        connection.id,
        calendar.providerCalendarId,
        calendar.name.slice(0, 255),
        calendar.color,
        calendar.role,
        calendar.writable ? 1 : 0,
        calendar.freshness,
        calendar.primary ? 1 : 0,
        JSON.stringify(calendar.raw),
        now,
        now
      )
    );
    if (connection.provider === "google" && calendar.role !== "free-busy") {
      statements.push(
        env.CALENDAR_DB.prepare(
          `INSERT OR IGNORE INTO calendar_sync_state
            (workspace_id, connection_id, calendar_id, active_generation, cache_revision, sync_token,
             cache_time_min, freshness, last_attempt_at, last_success_at, next_sync_at,
             error_code, error_message, consecutive_failures, lease_until,
             current_watch_channel_id, watch_expiration_at, last_notification_at)
           VALUES (?, ?, ?, ?, 0, NULL, NULL, 'pending', NULL, NULL, ?, NULL, NULL, 0,
                   NULL, NULL, NULL, NULL)`
        ).bind(
          connection.workspace_id,
          connection.id,
          calendarId,
          `initial-${crypto.randomUUID()}`,
          now
        )
      );
    } else if (calendar.role === "free-busy") {
      statements.push(
        env.CALENDAR_DB.prepare(
          "DELETE FROM calendar_event_cache WHERE workspace_id = ? AND calendar_id = ?"
        ).bind(connection.workspace_id, calendarId),
        env.CALENDAR_DB.prepare(
          "DELETE FROM calendar_watch_channels WHERE workspace_id = ? AND calendar_id = ?"
        ).bind(connection.workspace_id, calendarId),
        env.CALENDAR_DB.prepare(
          "DELETE FROM calendar_sync_state WHERE workspace_id = ? AND calendar_id = ?"
        ).bind(connection.workspace_id, calendarId)
      );
    }
  }
  statements.push(
    includedCalendars.length === 0 ? env.CALENDAR_DB.prepare(
      "DELETE FROM provider_calendars WHERE connection_id = ?"
    ).bind(connection.id) : env.CALENDAR_DB.prepare(
      `DELETE FROM provider_calendars
          WHERE connection_id = ?
            AND provider_calendar_id NOT IN (${includedCalendars.map(() => "?").join(", ")})`
    ).bind(connection.id, ...includedCalendars.map((calendar) => calendar.providerCalendarId))
  );
  await env.CALENDAR_DB.batch(statements);
}
__name(persistDiscovery, "persistDiscovery");
async function exchangeAuthorizationCode(config, code, verifier, redirectUri, providerFetch = fetch) {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    code_verifier: verifier,
    grant_type: "authorization_code",
    redirect_uri: redirectUri
  });
  if (config.id === "microsoft") body.set("scope", config.scopes.join(" "));
  return tokenSecret(
    await externalJson(
      config.tokenUrl,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: body.toString()
      },
      providerFetch
    )
  );
}
__name(exchangeAuthorizationCode, "exchangeAuthorizationCode");
var escapeHtml = /* @__PURE__ */ __name((value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"), "escapeHtml");
var oauthPage = /* @__PURE__ */ __name((title, message2, status = 200) => new Response(
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{font:16px/1.5 system-ui;background:#111;color:#f5f5f5;display:grid;min-height:100vh;place-items:center;margin:0}.card{max-width:34rem;padding:2rem;border:1px solid #444;border-radius:1rem;background:#1d1d1f}h1{margin-top:0}</style></head><body><main class="card"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message2)}</p><p>You can close this window and return to TAP Calendar.</p></main></body></html>`,
  {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
      "Content-Type": "text/html; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff"
    }
  }
), "oauthPage");
async function completeOAuth(request, env, selectedProvider, providerFetch = fetch) {
  const url = new URL(request.url);
  const providerError = url.searchParams.get("error");
  if (providerError) {
    return oauthPage("Authorization cancelled", `The provider returned ${providerError}.`, 400);
  }
  const state = requiredText3(url.searchParams.get("state"), "state", 1024);
  const code = requiredText3(url.searchParams.get("code"), "code", 16384);
  const row = await env.CALENDAR_DB.prepare(
    `SELECT connection_id, workspace_id, principal_id, provider, verifier_ciphertext, expires_at
       FROM oauth_states WHERE state_hash = ? AND provider = ?`
  ).bind(await sha2563(state), selectedProvider).first();
  if (!row || Date.parse(row.expires_at) <= Date.now()) {
    throw new ApiError(400, "oauth_state_invalid", "The provider authorization has expired.");
  }
  if (!row.principal_id) {
    throw new ApiError(
      409,
      "oauth_state_principal_unbound",
      "This authorization was started before TAP principal ownership was enabled. Start authorization again from Calendar."
    );
  }
  await env.CALENDAR_DB.prepare("DELETE FROM oauth_states WHERE state_hash = ?").bind(await sha2563(state)).run();
  const connection = await connectionById(
    env,
    row.workspace_id,
    row.principal_id,
    row.connection_id
  );
  const config = oauthProviderConfig(env, selectedProvider);
  if (!config) {
    throw new ApiError(503, "provider_unconfigured", "Provider OAuth is no longer configured.");
  }
  const verifierSecret = await decryptSecret(
    env,
    row.verifier_ciphertext
  );
  const redirectUri = `${url.origin}/v1/oauth/${selectedProvider}/callback`;
  const token = await exchangeAuthorizationCode(
    config,
    code,
    verifierSecret.verifier,
    redirectUri,
    providerFetch
  );
  const discovery = await discoverProvider(selectedProvider, token.accessToken, providerFetch);
  await persistDiscovery(env, connection.row, discovery, token);
  return oauthPage("Calendar connected", `${discovery.label} is ready in TAP Calendar.`);
}
__name(completeOAuth, "completeOAuth");
async function refreshToken(config, secret, providerFetch = fetch) {
  if (!secret.refreshToken) {
    throw new ApiError(
      409,
      "reauthorization_required",
      "The provider did not issue a refresh token. Authorize the account again."
    );
  }
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
    refresh_token: secret.refreshToken
  });
  if (config.id === "microsoft") body.set("scope", config.scopes.join(" "));
  const next = tokenSecret(
    await externalJson(
      config.tokenUrl,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: body.toString()
      },
      providerFetch
    )
  );
  return {
    ...next,
    refreshToken: next.refreshToken ?? secret.refreshToken
  };
}
__name(refreshToken, "refreshToken");
function storedTokenSecret(value) {
  if (!isRecord9(value)) {
    throw new ApiError(500, "credential_corrupt", "Stored provider credentials are invalid.");
  }
  const accessToken = value.accessToken;
  const refreshToken2 = value.refreshToken;
  const expiresAt = value.expiresAt;
  const tokenType = value.tokenType;
  const scope = value.scope;
  if (typeof accessToken !== "string" || accessToken.length === 0 || accessToken.length > 16384 || refreshToken2 !== void 0 && (typeof refreshToken2 !== "string" || refreshToken2.length === 0 || refreshToken2.length > 16384) || typeof expiresAt !== "string" || !Number.isFinite(Date.parse(expiresAt)) || typeof tokenType !== "string" || tokenType.length === 0 || tokenType.length > 64 || scope !== void 0 && (typeof scope !== "string" || scope.length > 16384)) {
    throw new ApiError(500, "credential_corrupt", "Stored provider credentials are invalid.");
  }
  return {
    accessToken,
    ...typeof refreshToken2 === "string" ? { refreshToken: refreshToken2 } : {},
    expiresAt,
    tokenType,
    ...typeof scope === "string" ? { scope } : {}
  };
}
__name(storedTokenSecret, "storedTokenSecret");
async function persistTokenSecret(env, connection, secret) {
  const ciphertext = await encryptSecret(env, secret);
  await env.CALENDAR_DB.prepare(
    `UPDATE calendar_connections
        SET credential_ciphertext = ?, token_expires_at = ?, updated_at = ?
      WHERE workspace_id = ? AND principal_id = ? AND id = ?`
  ).bind(
    ciphertext,
    secret.expiresAt,
    (/* @__PURE__ */ new Date()).toISOString(),
    connection.workspace_id,
    connection.principal_id,
    connection.id
  ).run();
}
__name(persistTokenSecret, "persistTokenSecret");
async function authorizedToken(env, connection, providerFetch = fetch) {
  if (connection.mode !== "oauth" || connection.provider !== "google" && connection.provider !== "microsoft") {
    throw new ApiError(501, "provider_adapter_unavailable", "This provider adapter is not enabled.");
  }
  if (!connection.credential_ciphertext) {
    throw new ApiError(409, "authorization_pending", "Provider authorization is not complete.");
  }
  const config = oauthProviderConfig(env, connection.provider);
  if (!config) {
    throw new ApiError(503, "provider_unconfigured", "Provider OAuth is not configured.");
  }
  let secret = storedTokenSecret(
    await decryptSecret(env, connection.credential_ciphertext)
  );
  if (Date.parse(secret.expiresAt) <= Date.now() + TOKEN_REFRESH_SKEW_MS) {
    secret = await refreshToken(config, secret, providerFetch);
    await persistTokenSecret(env, connection, secret);
  }
  return { config, secret };
}
__name(authorizedToken, "authorizedToken");
async function syncConnection(request, env, connectionId, providerFetch = fetch) {
  const { workspace, principal } = await principalScope(request, env);
  const connection = await connectionById(env, workspace, principal, connectionId);
  if (connection.row.mode === "local") {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    await env.CALENDAR_DB.prepare(
      `UPDATE calendar_connections SET updated_at = ?, last_synced_at = ?
        WHERE workspace_id = ? AND principal_id = ? AND id = ?`
    ).bind(now, now, workspace, principal, connectionId).run();
    const updated2 = await connectionById(env, workspace, principal, connectionId);
    return json({ connection: connectionProjection(updated2.row, updated2.calendars) });
  }
  const { secret } = await authorizedToken(env, connection.row, providerFetch);
  const discovery = await discoverProvider(
    connection.row.provider,
    secret.accessToken,
    providerFetch
  );
  await persistDiscovery(env, connection.row, discovery, secret);
  const updated = await connectionById(env, workspace, principal, connectionId);
  return json({ connection: connectionProjection(updated.row, updated.calendars) });
}
__name(syncConnection, "syncConnection");
var GOOGLE_EVENT_FIELDS = [
  "nextPageToken",
  "items(id,status,summary,start,end,eventType,transparency,location,hangoutLink,conferenceData,attendees(id,email,displayName,responseStatus,optional,self),extendedProperties(private))"
].join(",");
var googleEventId = /* @__PURE__ */ __name((kind, calendarId, providerIdentity) => `google-${kind}.${base64Url6(
  new TextEncoder().encode(JSON.stringify([calendarId, providerIdentity]))
)}`, "googleEventId");
var eventInstant = /* @__PURE__ */ __name((value) => {
  if (!isRecord9(value)) return null;
  if (typeof value.dateTime === "string" && Number.isFinite(Date.parse(value.dateTime))) {
    return { instant: new Date(value.dateTime).toISOString(), allDay: false };
  }
  if (typeof value.date === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value.date) && Number.isFinite(Date.parse(`${value.date}T00:00:00.000Z`))) {
    return { instant: `${value.date}T00:00:00.000Z`, allDay: true };
  }
  return null;
}, "eventInstant");
function normalizeGoogleCalendarEvent(value, calendarId) {
  if (!isRecord9(value) || typeof value.id !== "string" || value.id.length === 0) return null;
  const start = eventInstant(value.start);
  const end = eventInstant(value.end);
  if (!start || !end || start.allDay !== end.allDay || Date.parse(end.instant) <= Date.parse(start.instant)) {
    return null;
  }
  const rawAttendees = Array.isArray(value.attendees) ? value.attendees : [];
  const attendees = rawAttendees.flatMap((candidate, index) => {
    if (!isRecord9(candidate)) return [];
    const email = typeof candidate.email === "string" ? candidate.email.trim().slice(0, 320) : "";
    const displayName = typeof candidate.displayName === "string" ? candidate.displayName.trim().slice(0, 255) : "";
    const name = displayName || email || "Attendee";
    const providerId = typeof candidate.id === "string" && candidate.id ? candidate.id : email || String(index);
    return [{
      id: googleEventId("event", calendarId, `${value.id}:attendee:${providerId}`),
      name,
      email,
      kind: "external",
      required: candidate.optional !== true
    }];
  });
  const selfAttendee = rawAttendees.find((candidate) => isRecord9(candidate) && candidate.self === true);
  const selfResponse = isRecord9(selfAttendee) ? selfAttendee.responseStatus : void 0;
  const status = value.status === "cancelled" ? "cancelled" : selfResponse === "declined" ? "declined" : value.status === "tentative" || selfResponse === "tentative" || selfResponse === "needsAction" ? "pending" : "confirmed";
  const extendedProperties = isRecord9(value.extendedProperties) ? value.extendedProperties : {};
  const privateProperties = isRecord9(extendedProperties.private) ? extendedProperties.private : {};
  const tapBookingKind = privateProperties.tapBookingKind;
  const kind = tapBookingKind === "work-block" ? "work-block" : tapBookingKind === "approval-hold" ? "hold" : value.eventType === "focusTime" ? "focus" : value.eventType === "outOfOffice" || value.eventType === "workingLocation" ? "hold" : "meeting";
  const conferenceData = isRecord9(value.conferenceData) ? value.conferenceData : {};
  const conferenceSolution = isRecord9(conferenceData.conferenceSolution) ? conferenceData.conferenceSolution : {};
  const conferenceKey = isRecord9(conferenceSolution.key) ? conferenceSolution.key : {};
  const hasGoogleMeetJoinUrl = googleMeetJoinUrl(value) !== null;
  const location = hasGoogleMeetJoinUrl && (conferenceKey.type === "hangoutsMeet" || normalizeGoogleMeetJoinUrl(value.hangoutLink) !== null) ? "google-meet" : typeof value.location === "string" && value.location.trim().length > 0 ? "physical" : null;
  const summary = typeof value.summary === "string" ? value.summary.trim().slice(0, 255) : "";
  return {
    id: googleEventId("event", calendarId, value.id),
    calendarId,
    title: summary || "Busy",
    start: start.instant,
    end: end.instant,
    kind,
    status,
    location,
    attendees,
    busy: value.transparency !== "transparent",
    allDay: start.allDay
  };
}
__name(normalizeGoogleCalendarEvent, "normalizeGoogleCalendarEvent");
function normalizeGoogleFreeBusy(calendarId, value) {
  if (!isRecord9(value) || typeof value.start !== "string" || typeof value.end !== "string") {
    return null;
  }
  const start = Date.parse(value.start);
  const end = Date.parse(value.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  const startIso = new Date(start).toISOString();
  const endIso = new Date(end).toISOString();
  return {
    id: googleEventId("freebusy", calendarId, `${startIso}/${endIso}`),
    calendarId,
    title: "Busy",
    start: startIso,
    end: endIso,
    kind: "hold",
    status: "confirmed",
    location: null,
    attendees: [],
    busy: true,
    allDay: false
  };
}
__name(normalizeGoogleFreeBusy, "normalizeGoogleFreeBusy");
var providerQueryError = /* @__PURE__ */ __name((calendarId, cause) => {
  if (cause instanceof ProviderHttpError) {
    const code = cause.providerStatus === 401 ? "reauthorization_required" : cause.providerStatus === 403 ? "provider_access_denied" : cause.providerStatus === 404 ? "provider_calendar_unavailable" : cause.providerStatus === 429 ? "provider_rate_limited" : "provider_request_failed";
    return {
      calendarId,
      code,
      message: cause.providerStatus === 401 ? "Reconnect this provider account to resume event sync." : "Google Calendar could not return events for this calendar."
    };
  }
  if (cause instanceof ApiError) {
    return { calendarId, code: cause.code, message: cause.message };
  }
  return {
    calendarId,
    code: "provider_request_failed",
    message: "Google Calendar could not return events for this calendar."
  };
}, "providerQueryError");
var GOOGLE_SYNC_EVENT_FIELDS = [
  "nextPageToken",
  "nextSyncToken",
  "items(id,status,updated,summary,start,end,eventType,transparency,location,hangoutLink,conferenceData,attendees(id,email,displayName,responseStatus,optional,self),extendedProperties(private))"
].join(",");
var logCalendarSync = /* @__PURE__ */ __name((level, message2, fields) => {
  console[level](JSON.stringify({ message: message2, ...fields }));
}, "logCalendarSync");
var connectionFromSyncTarget = /* @__PURE__ */ __name((target) => ({
  id: target.connection_id,
  workspace_id: target.workspace_id,
  principal_id: target.principal_id,
  provider: target.provider,
  mode: target.mode,
  label: target.connection_label,
  status: target.connection_status,
  credential_ciphertext: target.credential_ciphertext,
  token_expires_at: target.token_expires_at,
  created_at: target.connection_created_at,
  updated_at: target.connection_updated_at,
  last_synced_at: target.connection_last_synced_at
}), "connectionFromSyncTarget");
var cacheSyncInvocation = /* @__PURE__ */ __name(() => ({
  authorizationByConnection: /* @__PURE__ */ new Map()
}), "cacheSyncInvocation");
var authorizedTokenForCacheSync = /* @__PURE__ */ __name((env, target, providerFetch, invocation) => {
  const key = `${target.workspace_id}\0${target.connection_id}`;
  const existing = invocation.authorizationByConnection.get(key);
  if (existing) return existing;
  const authorization = authorizedToken(
    env,
    connectionFromSyncTarget(target),
    providerFetch
  );
  invocation.authorizationByConnection.set(key, authorization);
  return authorization;
}, "authorizedTokenForCacheSync");
async function loadCalendarSyncTargets(env, workspace, principal, calendarIds) {
  if (calendarIds.length === 0) return [];
  return (await env.CALENDAR_DB.prepare(
    `SELECT
       provider_calendars.*,
       calendar_connections.workspace_id,
       calendar_connections.principal_id,
       calendar_connections.provider,
       calendar_connections.mode,
       calendar_connections.credential_ciphertext,
       calendar_connections.token_expires_at,
       calendar_connections.label AS connection_label,
       calendar_connections.status AS connection_status,
       calendar_connections.created_at AS connection_created_at,
       calendar_connections.updated_at AS connection_updated_at,
       calendar_connections.last_synced_at AS connection_last_synced_at
     FROM provider_calendars
     INNER JOIN calendar_connections
       ON calendar_connections.id = provider_calendars.connection_id
     WHERE calendar_connections.workspace_id = ?
       AND calendar_connections.principal_id = ?
       AND provider_calendars.id IN (${calendarIds.map(() => "?").join(", ")})`
  ).bind(workspace, principal, ...calendarIds).all()).results;
}
__name(loadCalendarSyncTargets, "loadCalendarSyncTargets");
async function ensureCalendarSyncState(env, target) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await env.CALENDAR_DB.prepare(
    `INSERT OR IGNORE INTO calendar_sync_state
      (workspace_id, connection_id, calendar_id, active_generation, cache_revision, sync_token,
       cache_time_min, freshness, last_attempt_at, last_success_at, next_sync_at,
       error_code, error_message, consecutive_failures, lease_until,
       current_watch_channel_id, watch_expiration_at, last_notification_at)
     VALUES (?, ?, ?, ?, 0, NULL, NULL, 'pending', NULL, NULL, ?, NULL, NULL, 0,
             NULL, NULL, NULL, NULL)`
  ).bind(
    target.workspace_id,
    target.connection_id,
    target.id,
    `initial-${crypto.randomUUID()}`,
    now
  ).run();
  const state = await env.CALENDAR_DB.prepare(
    `SELECT * FROM calendar_sync_state
      WHERE workspace_id = ? AND connection_id = ? AND calendar_id = ?`
  ).bind(target.workspace_id, target.connection_id, target.id).first();
  if (!state) {
    throw new ApiError(500, "cache_state_unavailable", "Calendar cache state is unavailable.");
  }
  return state;
}
__name(ensureCalendarSyncState, "ensureCalendarSyncState");
var cacheFailureDelay = /* @__PURE__ */ __name((consecutiveFailures) => Math.min(
  60 * 60 * 1e3,
  CACHE_ERROR_RETRY_BASE_MS * 2 ** Math.min(consecutiveFailures, 4)
), "cacheFailureDelay");
async function recordCacheSyncFailure(env, state, error, leaseUntil) {
  const nextSyncAt = new Date(
    Date.now() + cacheFailureDelay(state.consecutive_failures)
  ).toISOString();
  await env.CALENDAR_DB.prepare(
    `UPDATE calendar_sync_state
        SET freshness = CASE WHEN last_success_at IS NULL THEN 'error' ELSE 'stale' END,
            error_code = ?, error_message = ?, consecutive_failures = consecutive_failures + 1,
            next_sync_at = ?, lease_until = NULL
      WHERE workspace_id = ? AND connection_id = ? AND calendar_id = ?
        AND lease_until = ?`
  ).bind(
    error.code,
    error.message.slice(0, 500),
    nextSyncAt,
    state.workspace_id,
    state.connection_id,
    state.calendar_id,
    leaseUntil
  ).run();
}
__name(recordCacheSyncFailure, "recordCacheSyncFailure");
var googleCacheMutation = /* @__PURE__ */ __name((value, calendarId) => {
  if (!isRecord9(value) || typeof value.id !== "string" || value.id.length === 0) return null;
  const providerEventId = value.id.slice(0, 2048);
  const providerUpdatedAt = typeof value.updated === "string" && Number.isFinite(Date.parse(value.updated)) ? new Date(value.updated).toISOString() : null;
  const cancelled = value.status === "cancelled";
  const event = cancelled ? null : normalizeGoogleCalendarEvent(value, calendarId);
  if (!event) {
    return {
      providerEventId,
      eventId: googleEventId("event", calendarId, providerEventId),
      start: null,
      end: null,
      tombstoned: true,
      payload: { id: providerEventId, status: "cancelled" },
      providerUpdatedAt
    };
  }
  return {
    providerEventId,
    eventId: event.id,
    start: event.start,
    end: event.end,
    tombstoned: false,
    payload: event,
    providerUpdatedAt
  };
}, "googleCacheMutation");
async function collectGoogleCalendarChanges(target, accessToken, syncToken, providerFetch, fullSyncFutureMs = CACHE_ROLLING_FUTURE_MS) {
  const mutations = [];
  const fullSync = !syncToken;
  const cacheTimeMin = fullSync ? new Date(Date.now() - CACHE_INITIAL_HISTORY_MS).toISOString() : null;
  const cacheTimeMax = fullSync ? new Date(Date.now() + fullSyncFutureMs).toISOString() : null;
  let pageToken = null;
  let nextSyncToken = null;
  let pageCount = 0;
  do {
    pageCount += 1;
    if (pageCount > MAX_EVENT_PROVIDER_PAGES) {
      throw new ApiError(
        502,
        "provider_pagination_limit",
        "Google Calendar initial synchronization exceeded its safe page limit."
      );
    }
    const url = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(target.provider_calendar_id)}/events`
    );
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("showDeleted", "true");
    url.searchParams.set("maxResults", String(CACHE_EVENT_PAGE_SIZE));
    url.searchParams.set("maxAttendees", String(MAX_EVENT_ATTENDEES));
    url.searchParams.set("fields", GOOGLE_SYNC_EVENT_FIELDS);
    if (syncToken) url.searchParams.set("syncToken", syncToken);
    else {
      url.searchParams.set("timeMin", cacheTimeMin);
      url.searchParams.set("timeMax", cacheTimeMax);
    }
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const page = await externalJson(
      url.href,
      { headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` } },
      providerFetch
    );
    if (page.items !== void 0 && !Array.isArray(page.items)) {
      throw new ApiError(502, "provider_response_invalid", "Google returned an invalid event list.");
    }
    for (const item of Array.isArray(page.items) ? page.items : []) {
      const mutation = googleCacheMutation(item, target.id);
      if (mutation) mutations.push(mutation);
      if (mutations.length > MAX_CACHE_SYNC_EVENTS) {
        throw new ApiError(
          502,
          "event_limit_reached",
          "Google Calendar synchronization exceeded its safe event limit."
        );
      }
    }
    if (page.nextPageToken !== void 0 && typeof page.nextPageToken !== "string") {
      throw new ApiError(502, "provider_response_invalid", "Google returned an invalid page token.");
    }
    if (page.nextSyncToken !== void 0 && typeof page.nextSyncToken !== "string") {
      throw new ApiError(502, "provider_response_invalid", "Google returned an invalid sync token.");
    }
    pageToken = typeof page.nextPageToken === "string" ? page.nextPageToken : null;
    nextSyncToken = typeof page.nextSyncToken === "string" ? page.nextSyncToken : nextSyncToken;
  } while (pageToken);
  if (!nextSyncToken) {
    throw new ApiError(502, "provider_sync_token_missing", "Google did not return a sync token.");
  }
  return { mutations, nextSyncToken, fullSync, cacheTimeMin, cacheTimeMax };
}
__name(collectGoogleCalendarChanges, "collectGoogleCalendarChanges");
async function collectGoogleRollingSnapshot(target, accessToken, providerFetch) {
  let lastError;
  for (const futureWindowMs of CACHE_BOOTSTRAP_FUTURE_WINDOWS_MS) {
    try {
      return await collectGoogleCalendarChanges(
        target,
        accessToken,
        null,
        providerFetch,
        futureWindowMs
      );
    } catch (error) {
      lastError = error;
      if (!(error instanceof ApiError) || !["provider_pagination_limit", "event_limit_reached"].includes(error.code)) throw error;
      logCalendarSync("warn", "calendar rolling bootstrap window reduced", {
        workspace_id: target.workspace_id,
        connection_id: target.connection_id,
        calendar_id: target.id,
        attempted_future_days: Math.round(futureWindowMs / (24 * 60 * 60 * 1e3)),
        error_code: error.code
      });
    }
  }
  throw lastError;
}
__name(collectGoogleRollingSnapshot, "collectGoogleRollingSnapshot");
async function writeGoogleCacheMutations(env, state, generation, mutations) {
  const cachedAt = (/* @__PURE__ */ new Date()).toISOString();
  for (let offset = 0; offset < mutations.length; offset += CACHE_WRITE_BATCH_SIZE) {
    const chunk = mutations.slice(offset, offset + CACHE_WRITE_BATCH_SIZE);
    await env.CALENDAR_DB.batch(chunk.map(
      (mutation) => env.CALENDAR_DB.prepare(
        `INSERT INTO calendar_event_cache
          (workspace_id, connection_id, calendar_id, provider_event_id, sync_generation,
           event_id, start_at, end_at, tombstoned, payload_json, provider_updated_at, cached_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT
          (workspace_id, connection_id, calendar_id, provider_event_id, sync_generation)
         DO UPDATE SET
          event_id = excluded.event_id,
          start_at = excluded.start_at,
          end_at = excluded.end_at,
          tombstoned = excluded.tombstoned,
          payload_json = excluded.payload_json,
          provider_updated_at = excluded.provider_updated_at,
          cached_at = excluded.cached_at`
      ).bind(
        state.workspace_id,
        state.connection_id,
        state.calendar_id,
        mutation.providerEventId,
        generation,
        mutation.eventId,
        mutation.start,
        mutation.end,
        mutation.tombstoned ? 1 : 0,
        JSON.stringify(mutation.payload),
        mutation.providerUpdatedAt,
        cachedAt
      )
    ));
  }
}
__name(writeGoogleCacheMutations, "writeGoogleCacheMutations");
var configuredWebhookBase = /* @__PURE__ */ __name((env) => {
  if (!env.PUBLIC_BASE_URL?.trim()) return null;
  try {
    const value = new URL(env.PUBLIC_BASE_URL);
    if (value.protocol !== "https:" || value.username || value.password) return null;
    return value;
  } catch {
    return null;
  }
}, "configuredWebhookBase");
var secureTokenMatches = /* @__PURE__ */ __name(async (provided, expectedHash) => {
  const providedHash = await sha2563(provided);
  return crypto.subtle.timingSafeEqual(fromBase64(providedHash), fromBase64(expectedHash));
}, "secureTokenMatches");
async function ensureGoogleWatch(env, target, state, accessToken, providerFetch) {
  const base = configuredWebhookBase(env);
  if (!base) return;
  if (state.watch_expiration_at && Date.parse(state.watch_expiration_at) > Date.now() + WATCH_RENEWAL_WINDOW_MS) return;
  const channelId = crypto.randomUUID();
  const channelToken = randomValue(32);
  const tokenHash = await sha2563(channelToken);
  const address = new URL("/v1/webhooks/google/calendar", base).href;
  const response = await externalJson(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(target.provider_calendar_id)}/events/watch`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        id: channelId,
        type: "web_hook",
        address,
        token: channelToken,
        params: { ttl: String(WATCH_TTL_SECONDS) }
      })
    },
    providerFetch
  );
  if (response.id !== channelId || typeof response.resourceId !== "string") {
    throw new ApiError(502, "provider_watch_invalid", "Google returned an invalid watch channel.");
  }
  const expirationValue = typeof response.expiration === "number" ? response.expiration : typeof response.expiration === "string" ? Number(response.expiration) : Number.NaN;
  const expirationAt = Number.isFinite(expirationValue) ? new Date(expirationValue).toISOString() : new Date(Date.now() + WATCH_TTL_SECONDS * 1e3).toISOString();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await env.CALENDAR_DB.batch([
    env.CALENDAR_DB.prepare(
      `INSERT INTO calendar_watch_channels
        (channel_id, workspace_id, connection_id, calendar_id, token_hash, resource_id,
         expiration_at, created_at, last_notification_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`
    ).bind(
      channelId,
      target.workspace_id,
      target.connection_id,
      target.id,
      tokenHash,
      response.resourceId,
      expirationAt,
      now
    ),
    env.CALENDAR_DB.prepare(
      `UPDATE calendar_sync_state
          SET current_watch_channel_id = ?, watch_expiration_at = ?
        WHERE workspace_id = ? AND connection_id = ? AND calendar_id = ?`
    ).bind(
      channelId,
      expirationAt,
      target.workspace_id,
      target.connection_id,
      target.id
    ),
    env.CALENDAR_DB.prepare(
      "DELETE FROM calendar_watch_channels WHERE expiration_at <= ?"
    ).bind(now)
  ]);
}
__name(ensureGoogleWatch, "ensureGoogleWatch");
async function syncGoogleCalendarCache(env, target, providerFetch = fetch, invocation = cacheSyncInvocation(), forceFullSync = false) {
  let state = await ensureCalendarSyncState(env, target);
  const now = /* @__PURE__ */ new Date();
  const leaseUntil = new Date(now.valueOf() + CACHE_SYNC_LEASE_MS).toISOString();
  const lease = await env.CALENDAR_DB.prepare(
    `UPDATE calendar_sync_state
        SET lease_until = ?, last_attempt_at = ?
      WHERE workspace_id = ? AND connection_id = ? AND calendar_id = ?
        AND (lease_until IS NULL OR lease_until <= ?)`
  ).bind(
    leaseUntil,
    now.toISOString(),
    state.workspace_id,
    state.connection_id,
    state.calendar_id,
    now.toISOString()
  ).run();
  if (Number(lease.meta.changes ?? 0) === 0) {
    return {
      calendarId: target.id,
      synced: false,
      skipped: true,
      fullSync: false,
      resyncedAfterTokenExpiry: false,
      changedEvents: 0
    };
  }
  state = await ensureCalendarSyncState(env, target);
  try {
    const { secret } = await authorizedTokenForCacheSync(
      env,
      target,
      providerFetch,
      invocation
    );
    const rollingCoverageRefreshDue = !state.cache_time_max || Date.parse(state.cache_time_max) <= Date.now() + CACHE_ROLLING_REBUILD_MARGIN_MS;
    const requestedSyncToken = forceFullSync || rollingCoverageRefreshDue ? null : state.sync_token;
    let resyncedAfterTokenExpiry = false;
    let collection;
    try {
      collection = requestedSyncToken ? await collectGoogleCalendarChanges(
        target,
        secret.accessToken,
        requestedSyncToken,
        providerFetch
      ) : await collectGoogleRollingSnapshot(target, secret.accessToken, providerFetch);
    } catch (error) {
      if (!(error instanceof ProviderHttpError) || error.providerStatus !== 410 || !requestedSyncToken) {
        throw error;
      }
      resyncedAfterTokenExpiry = true;
      collection = await collectGoogleRollingSnapshot(
        target,
        secret.accessToken,
        providerFetch
      );
    }
    const generation = `sync-${crypto.randomUUID()}`;
    if (!collection.fullSync) {
      await env.CALENDAR_DB.prepare(
        `INSERT INTO calendar_event_cache
          (workspace_id, connection_id, calendar_id, provider_event_id, sync_generation,
           event_id, start_at, end_at, tombstoned, payload_json, provider_updated_at, cached_at)
         SELECT workspace_id, connection_id, calendar_id, provider_event_id, ?,
                event_id, start_at, end_at, tombstoned, payload_json, provider_updated_at, cached_at
           FROM calendar_event_cache
          WHERE workspace_id = ? AND connection_id = ? AND calendar_id = ?
            AND sync_generation = ?`
      ).bind(
        generation,
        state.workspace_id,
        state.connection_id,
        state.calendar_id,
        state.active_generation
      ).run();
    }
    await writeGoogleCacheMutations(env, state, generation, collection.mutations);
    const completedAt = (/* @__PURE__ */ new Date()).toISOString();
    const nextSyncAt = new Date(Date.now() + CACHE_REPAIR_INTERVAL_MS).toISOString();
    const commit = await env.CALENDAR_DB.prepare(
      `UPDATE calendar_sync_state
          SET active_generation = ?, cache_revision = cache_revision + 1, sync_token = ?,
              cache_time_min = COALESCE(?, cache_time_min),
              cache_time_max = COALESCE(?, cache_time_max), freshness = 'fresh',
              last_success_at = ?, next_sync_at = ?, error_code = NULL,
              error_message = NULL, consecutive_failures = 0, lease_until = NULL
        WHERE workspace_id = ? AND connection_id = ? AND calendar_id = ?
          AND lease_until = ? AND active_generation = ? AND cache_revision = ?`
    ).bind(
      generation,
      collection.nextSyncToken,
      collection.cacheTimeMin,
      collection.cacheTimeMax,
      completedAt,
      nextSyncAt,
      state.workspace_id,
      state.connection_id,
      state.calendar_id,
      leaseUntil,
      state.active_generation,
      state.cache_revision
    ).run();
    if (Number(commit.meta.changes ?? 0) === 0) {
      await env.CALENDAR_DB.prepare(
        `DELETE FROM calendar_event_cache
          WHERE workspace_id = ? AND connection_id = ? AND calendar_id = ?
            AND sync_generation = ?`
      ).bind(state.workspace_id, state.connection_id, state.calendar_id, generation).run();
      return {
        calendarId: target.id,
        synced: false,
        skipped: true,
        fullSync: collection.fullSync,
        resyncedAfterTokenExpiry,
        changedEvents: 0
      };
    }
    try {
      await env.CALENDAR_DB.prepare(
        `DELETE FROM calendar_event_cache
          WHERE workspace_id = ? AND connection_id = ? AND calendar_id = ?
            AND sync_generation <> ?`
      ).bind(state.workspace_id, state.connection_id, state.calendar_id, generation).run();
    } catch (error) {
      logCalendarSync("warn", "calendar cache generation cleanup failed", {
        workspace_id: target.workspace_id,
        connection_id: target.connection_id,
        calendar_id: target.id,
        error: error instanceof Error ? error.message : "unknown error"
      });
    }
    state = await ensureCalendarSyncState(env, target);
    try {
      await ensureGoogleWatch(env, target, state, secret.accessToken, providerFetch);
    } catch (error) {
      logCalendarSync("warn", "calendar watch registration failed", {
        workspace_id: target.workspace_id,
        connection_id: target.connection_id,
        calendar_id: target.id,
        error: error instanceof Error ? error.message : "unknown error"
      });
    }
    logCalendarSync("info", "calendar cache synchronized", {
      workspace_id: target.workspace_id,
      connection_id: target.connection_id,
      calendar_id: target.id,
      full_sync: collection.fullSync,
      resynced_after_token_expiry: resyncedAfterTokenExpiry,
      changed_events: collection.mutations.length,
      cache_time_min: collection.cacheTimeMin ?? state.cache_time_min,
      cache_time_max: collection.cacheTimeMax ?? state.cache_time_max
    });
    return {
      calendarId: target.id,
      synced: true,
      skipped: false,
      fullSync: collection.fullSync,
      resyncedAfterTokenExpiry,
      changedEvents: collection.mutations.length
    };
  } catch (cause) {
    const error = providerQueryError(target.id, cause);
    await recordCacheSyncFailure(env, state, error, leaseUntil);
    logCalendarSync("error", "calendar cache synchronization failed", {
      workspace_id: target.workspace_id,
      connection_id: target.connection_id,
      calendar_id: target.id,
      error_code: error.code
    });
    return {
      calendarId: target.id,
      synced: false,
      skipped: false,
      fullSync: state.sync_token === null,
      resyncedAfterTokenExpiry: false,
      changedEvents: 0,
      error
    };
  }
}
__name(syncGoogleCalendarCache, "syncGoogleCalendarCache");
async function listGoogleCalendarEvents(calendar, accessToken, input, budget, providerFetch) {
  const events = [];
  const errors = [];
  const seen = /* @__PURE__ */ new Set();
  let pageToken = null;
  let pageCount = 0;
  let complete = true;
  do {
    if (budget.remaining <= 0) {
      budget.truncated = true;
      complete = false;
      errors.push({
        calendarId: calendar.id,
        code: "event_limit_reached",
        message: "The event result limit was reached. Query a narrower time range."
      });
      break;
    }
    pageCount += 1;
    if (pageCount > MAX_EVENT_PROVIDER_PAGES) {
      budget.truncated = true;
      complete = false;
      errors.push({
        calendarId: calendar.id,
        code: "provider_pagination_limit",
        message: "Google Calendar returned too many event pages. Query a narrower time range."
      });
      break;
    }
    const url = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.provider_calendar_id)}/events`
    );
    url.searchParams.set("timeMin", input.timeMin);
    url.searchParams.set("timeMax", input.timeMax);
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("showDeleted", "false");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("timeZone", "UTC");
    url.searchParams.set("maxResults", String(EVENT_PAGE_SIZE));
    url.searchParams.set("maxAttendees", String(MAX_EVENT_ATTENDEES));
    url.searchParams.set("fields", GOOGLE_EVENT_FIELDS);
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const page = await externalJson(
      url.href,
      { headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` } },
      providerFetch
    );
    if (page.items !== void 0 && !Array.isArray(page.items)) {
      throw new ApiError(502, "provider_response_invalid", "Google returned an invalid event list.");
    }
    let invalidItems = 0;
    for (const item of Array.isArray(page.items) ? page.items : []) {
      const event = normalizeGoogleCalendarEvent(item, calendar.id);
      if (!event) {
        invalidItems += 1;
        continue;
      }
      if (seen.has(event.id)) continue;
      seen.add(event.id);
      if (budget.remaining <= 0) {
        budget.truncated = true;
        complete = false;
        break;
      }
      events.push(event);
      budget.remaining -= 1;
    }
    if (invalidItems > 0) {
      complete = false;
      errors.push({
        calendarId: calendar.id,
        code: "provider_event_invalid",
        message: `${invalidItems} Google event${invalidItems === 1 ? " was" : "s were"} skipped because required fields were invalid.`
      });
    }
    if (budget.remaining <= 0 && typeof page.nextPageToken === "string") {
      budget.truncated = true;
      complete = false;
    }
    if (page.nextPageToken !== void 0 && typeof page.nextPageToken !== "string") {
      throw new ApiError(502, "provider_response_invalid", "Google returned an invalid page token.");
    }
    pageToken = budget.remaining > 0 && typeof page.nextPageToken === "string" ? page.nextPageToken : null;
  } while (pageToken);
  return { calendarId: calendar.id, events, synced: complete, errors };
}
__name(listGoogleCalendarEvents, "listGoogleCalendarEvents");
async function mapWithConcurrency(values, concurrency, mapper) {
  const results = new Array(values.length);
  let nextIndex = 0;
  const worker = /* @__PURE__ */ __name(async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= values.length) return;
      results[index] = await mapper(values[index]);
    }
  }, "worker");
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker())
  );
  return results;
}
__name(mapWithConcurrency, "mapWithConcurrency");
async function queryGoogleFreeBusy(calendars, accessToken, input, budget, providerFetch) {
  if (calendars.length === 0) return [];
  let page;
  try {
    page = await externalJson(
      "https://www.googleapis.com/calendar/v3/freeBusy",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          timeMin: input.timeMin,
          timeMax: input.timeMax,
          items: calendars.map((calendar) => ({ id: calendar.provider_calendar_id }))
        })
      },
      providerFetch
    );
  } catch (cause) {
    return calendars.map((calendar) => ({
      calendarId: calendar.id,
      events: [],
      synced: false,
      errors: [providerQueryError(calendar.id, cause)]
    }));
  }
  const providerCalendars = page.calendars;
  const responseTimeMin = typeof page.timeMin === "string" ? Date.parse(page.timeMin) : NaN;
  const responseTimeMax = typeof page.timeMax === "string" ? Date.parse(page.timeMax) : NaN;
  if (!isRecord9(providerCalendars) || !Number.isFinite(responseTimeMin) || !Number.isFinite(responseTimeMax) || responseTimeMin !== Date.parse(input.timeMin) || responseTimeMax !== Date.parse(input.timeMax)) {
    return calendars.map((calendar) => ({
      calendarId: calendar.id,
      events: [],
      synced: false,
      errors: [{
        calendarId: calendar.id,
        code: "provider_response_invalid",
        message: "Google returned an invalid free/busy response."
      }]
    }));
  }
  return calendars.map((calendar) => {
    const providerCalendar = providerCalendars[calendar.provider_calendar_id];
    if (!isRecord9(providerCalendar) || !Array.isArray(providerCalendar.busy) || providerCalendar.errors !== void 0 && !Array.isArray(providerCalendar.errors)) {
      return {
        calendarId: calendar.id,
        events: [],
        synced: false,
        errors: [{
          calendarId: calendar.id,
          code: "provider_response_invalid",
          message: "Google returned invalid free/busy data for this calendar."
        }]
      };
    }
    if (Array.isArray(providerCalendar.errors) && providerCalendar.errors.length > 0) {
      return {
        calendarId: calendar.id,
        events: [],
        synced: false,
        errors: [{
          calendarId: calendar.id,
          code: "provider_access_denied",
          message: "Google Calendar could not return free/busy data for this calendar."
        }]
      };
    }
    const events = [];
    let invalidItems = 0;
    let complete = true;
    for (const value of Array.isArray(providerCalendar.busy) ? providerCalendar.busy : []) {
      const event = normalizeGoogleFreeBusy(calendar.id, value);
      if (!event) {
        invalidItems += 1;
        continue;
      }
      if (budget.remaining <= 0) {
        budget.truncated = true;
        complete = false;
        break;
      }
      events.push(event);
      budget.remaining -= 1;
    }
    const errors = [];
    if (invalidItems > 0) {
      complete = false;
      errors.push({
        calendarId: calendar.id,
        code: "provider_event_invalid",
        message: `${invalidItems} free/busy interval${invalidItems === 1 ? " was" : "s were"} skipped because it was invalid.`
      });
    }
    if (!complete && budget.remaining <= 0) {
      errors.push({
        calendarId: calendar.id,
        code: "event_limit_reached",
        message: "The event result limit was reached. Query a narrower time range."
      });
    }
    return { calendarId: calendar.id, events, synced: complete, errors };
  });
}
__name(queryGoogleFreeBusy, "queryGoogleFreeBusy");
async function queryPublicGoogleBusyIntervals(env, scope, input, providerFetch = fetch) {
  const targets = await loadCalendarSyncTargets(
    env,
    scope.workspace,
    scope.principal,
    input.calendarIds
  );
  if (targets.length !== input.calendarIds.length || targets.some(
    (target) => target.provider !== "google" || target.mode !== "oauth" || target.connection_status !== "connected"
  )) {
    throw new ApiError(
      503,
      "public_availability_unavailable",
      "Availability could not be checked. Try again shortly."
    );
  }
  const byConnection = /* @__PURE__ */ new Map();
  for (const target of targets) {
    const group = byConnection.get(target.connection_id) ?? [];
    group.push(target);
    byConnection.set(target.connection_id, group);
  }
  const invocation = cacheSyncInvocation();
  const budget = {
    remaining: MAX_EVENT_QUERY_EVENTS,
    truncated: false
  };
  const intervals = [];
  try {
    for (const group of byConnection.values()) {
      const authorization = await authorizedTokenForCacheSync(
        env,
        group[0],
        providerFetch,
        invocation
      );
      const results = await queryGoogleFreeBusy(
        group,
        authorization.secret.accessToken,
        input,
        budget,
        providerFetch
      );
      if (results.length !== group.length || results.some((result) => !result.synced || result.errors.length > 0)) {
        throw new Error("inconclusive provider response");
      }
      for (const result of results) {
        for (const event of result.events) {
          intervals.push({ start: event.start, end: event.end });
        }
      }
    }
  } catch {
    throw new ApiError(
      503,
      "public_availability_unavailable",
      "Availability could not be checked. Try again shortly."
    );
  }
  if (budget.truncated) {
    throw new ApiError(
      503,
      "public_availability_unavailable",
      "Availability could not be checked. Try again shortly."
    );
  }
  return intervals.sort(
    (left, right) => left.start.localeCompare(right.start) || left.end.localeCompare(right.end)
  );
}
__name(queryPublicGoogleBusyIntervals, "queryPublicGoogleBusyIntervals");
async function queryLiveEventsForScope(scope, input, env, providerFetch = fetch) {
  const { workspace, principal } = scope;
  const placeholders = input.calendarIds.map(() => "?").join(", ");
  const calendarRows = await env.CALENDAR_DB.prepare(
    `SELECT provider_calendars.* FROM provider_calendars
       INNER JOIN calendar_connections ON calendar_connections.id = provider_calendars.connection_id
      WHERE calendar_connections.workspace_id = ?
        AND calendar_connections.principal_id = ?
        AND provider_calendars.id IN (${placeholders})`
  ).bind(workspace, principal, ...input.calendarIds).all();
  const calendarsById = new Map(calendarRows.results.map((calendar) => [calendar.id, calendar]));
  const errors = input.calendarIds.filter((calendarId) => !calendarsById.has(calendarId)).map((calendarId) => ({
    calendarId,
    code: "calendar_not_found",
    message: "The calendar was not found in this workspace."
  }));
  const connectionIds = [...new Set(calendarRows.results.map((calendar) => calendar.connection_id))];
  const connections = connectionIds.length === 0 ? [] : (await env.CALENDAR_DB.prepare(
    `SELECT * FROM calendar_connections
          WHERE workspace_id = ? AND principal_id = ?
            AND id IN (${connectionIds.map(() => "?").join(", ")})`
  ).bind(workspace, principal, ...connectionIds).all()).results;
  const connectionsById = new Map(connections.map((connection) => [connection.id, connection]));
  const budget = { remaining: MAX_EVENT_QUERY_EVENTS, truncated: false };
  const eventMap = /* @__PURE__ */ new Map();
  const synced = /* @__PURE__ */ new Set();
  for (const connectionId of connectionIds) {
    const connection = connectionsById.get(connectionId);
    const calendars = calendarRows.results.filter((calendar) => calendar.connection_id === connectionId);
    if (!connection) {
      errors.push(...calendars.map((calendar) => ({
        calendarId: calendar.id,
        code: "connection_not_found",
        message: "The calendar connection was not found in this workspace."
      })));
      continue;
    }
    if (connection.provider !== "google" || connection.mode !== "oauth") {
      errors.push(...calendars.map((calendar) => ({
        calendarId: calendar.id,
        code: "provider_adapter_unavailable",
        message: "Live event queries are not available for this calendar connection."
      })));
      continue;
    }
    let accessToken;
    try {
      accessToken = (await authorizedToken(env, connection, providerFetch)).secret.accessToken;
    } catch (cause) {
      errors.push(...calendars.map((calendar) => providerQueryError(calendar.id, cause)));
      continue;
    }
    const readable = calendars.filter((calendar) => calendar.role !== "free-busy");
    const freeBusy = calendars.filter((calendar) => calendar.role === "free-busy");
    const readableResults = await mapWithConcurrency(
      readable,
      EVENT_QUERY_CONCURRENCY,
      async (calendar) => {
        try {
          return await listGoogleCalendarEvents(
            calendar,
            accessToken,
            input,
            budget,
            providerFetch
          );
        } catch (cause) {
          return {
            calendarId: calendar.id,
            events: [],
            synced: false,
            errors: [providerQueryError(calendar.id, cause)]
          };
        }
      }
    );
    const freeBusyResults = await queryGoogleFreeBusy(
      freeBusy,
      accessToken,
      input,
      budget,
      providerFetch
    );
    for (const result of [...readableResults, ...freeBusyResults]) {
      for (const event of result.events) eventMap.set(event.id, event);
      if (result.synced) synced.add(result.calendarId);
      errors.push(...result.errors);
    }
  }
  const events = [...eventMap.values()].sort(
    (left, right) => left.start.localeCompare(right.start) || left.id.localeCompare(right.id)
  );
  return {
    timeMin: input.timeMin,
    timeMax: input.timeMax,
    syncedAt: (/* @__PURE__ */ new Date()).toISOString(),
    events,
    syncedCalendarIds: input.calendarIds.filter((calendarId) => synced.has(calendarId)),
    errors,
    truncated: budget.truncated
  };
}
__name(queryLiveEventsForScope, "queryLiveEventsForScope");
async function queryLiveEvents(request, env, providerFetch = fetch) {
  const scope = await principalScope(request, env);
  const input = eventQueryInput(await readJson(request));
  return json(await queryLiveEventsForScope(scope, input, env, providerFetch));
}
__name(queryLiveEvents, "queryLiveEvents");
var parseCachedEvent = /* @__PURE__ */ __name((row) => {
  try {
    const value = JSON.parse(row.payload_json);
    if (!isRecord9(value) || typeof value.id !== "string" || value.calendarId !== row.calendar_id || typeof value.title !== "string" || typeof value.start !== "string" || typeof value.end !== "string" || !Array.isArray(value.attendees)) return null;
    return value;
  } catch {
    return null;
  }
}, "parseCachedEvent");
async function loadCalendarSyncStates(env, workspace, calendarIds) {
  if (calendarIds.length === 0) return [];
  return (await env.CALENDAR_DB.prepare(
    `SELECT * FROM calendar_sync_state
      WHERE workspace_id = ?
        AND calendar_id IN (${calendarIds.map(() => "?").join(", ")})`
  ).bind(workspace, ...calendarIds).all()).results;
}
__name(loadCalendarSyncStates, "loadCalendarSyncStates");
async function waitForLeasedCacheSyncs(env, workspace, calendarIds, priorRevisions) {
  if (calendarIds.length === 0) return;
  for (let attempt = 0; attempt < CACHE_LEASE_WAIT_ATTEMPTS; attempt += 1) {
    await scheduler.wait(CACHE_LEASE_WAIT_MS);
    const states = await loadCalendarSyncStates(env, workspace, calendarIds);
    const pending = states.some(
      (state) => state.cache_revision <= (priorRevisions.get(state.calendar_id) ?? -1) && state.lease_until !== null && Date.parse(state.lease_until) > Date.now()
    );
    if (!pending) return;
  }
}
__name(waitForLeasedCacheSyncs, "waitForLeasedCacheSyncs");
async function loadCachedEvents(env, workspace, input, calendarIds) {
  if (calendarIds.length === 0) return { events: [], truncated: false };
  const rows = (await env.CALENDAR_DB.prepare(
    `SELECT calendar_event_cache.calendar_id, calendar_event_cache.payload_json
       FROM calendar_event_cache
       INNER JOIN calendar_sync_state
         ON calendar_sync_state.workspace_id = calendar_event_cache.workspace_id
        AND calendar_sync_state.connection_id = calendar_event_cache.connection_id
        AND calendar_sync_state.calendar_id = calendar_event_cache.calendar_id
        AND calendar_sync_state.active_generation = calendar_event_cache.sync_generation
      WHERE calendar_event_cache.workspace_id = ?
        AND calendar_event_cache.calendar_id IN (${calendarIds.map(() => "?").join(", ")})
        AND calendar_event_cache.tombstoned = 0
        AND calendar_event_cache.start_at < ?
        AND calendar_event_cache.end_at > ?
      ORDER BY calendar_event_cache.start_at, calendar_event_cache.event_id
      LIMIT ?`
  ).bind(
    workspace,
    ...calendarIds,
    input.timeMax,
    input.timeMin,
    MAX_EVENT_QUERY_EVENTS + 1
  ).all()).results;
  const truncated = rows.length > MAX_EVENT_QUERY_EVENTS;
  const events = rows.slice(0, MAX_EVENT_QUERY_EVENTS).map(parseCachedEvent).filter((event) => event !== null);
  return { events, truncated };
}
__name(loadCachedEvents, "loadCachedEvents");
var stateUsableForQuery = /* @__PURE__ */ __name((state, input) => Boolean(
  state?.last_success_at && state.cache_time_min && state.cache_time_max && Date.parse(state.cache_time_min) <= Date.parse(input.timeMin) && Date.parse(state.cache_time_max) >= Date.parse(input.timeMax)
), "stateUsableForQuery");
var inputFitsRollingCoverage = /* @__PURE__ */ __name((input) => Date.parse(input.timeMin) >= Date.now() - CACHE_INITIAL_HISTORY_MS && Date.parse(input.timeMax) <= Date.now() + CACHE_ROLLING_FUTURE_MS, "inputFitsRollingCoverage");
var stateNeedsRevalidation = /* @__PURE__ */ __name((state) => state.freshness !== "fresh" || Date.parse(state.next_sync_at) <= Date.now() || !state.last_success_at || Date.parse(state.last_success_at) + CACHE_FRESH_MS <= Date.now(), "stateNeedsRevalidation");
var cacheProof = /* @__PURE__ */ __name((state, input) => ({
  calendarId: state.calendar_id,
  cacheRevision: state.cache_revision,
  freshness: state.freshness === "fresh" && stateNeedsRevalidation(state) ? "stale" : state.freshness,
  lastSuccessAt: state.last_success_at,
  nextSyncAt: state.next_sync_at,
  coverageTimeMin: state.cache_time_min,
  coverageTimeMax: state.cache_time_max,
  coversRequestedRange: stateUsableForQuery(state, input),
  error: state.error_code ? { code: state.error_code, message: state.error_message ?? "Calendar cache sync failed." } : null
}), "cacheProof");
var internalEventQueryRequest = /* @__PURE__ */ __name((request, input, calendarIds) => {
  const headers = new Headers(request.headers);
  headers.set("Content-Type", "application/json");
  headers.delete("Content-Length");
  return new Request(request.url, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...input, calendarIds })
  });
}, "internalEventQueryRequest");
async function queryEvents(request, env, executionContext, providerFetch = fetch) {
  const { workspace, principal } = await principalScope(request, env);
  const body = await readJson(request);
  const input = eventQueryInput(body);
  if (body.revalidate !== void 0 && !["wait", "background"].includes(String(body.revalidate))) {
    throw new ApiError(400, "invalid_revalidate_mode", "revalidate must be wait or background.");
  }
  const revalidateMode = body.revalidate === "background" ? "background" : "wait";
  const targets = await loadCalendarSyncTargets(
    env,
    workspace,
    principal,
    input.calendarIds
  );
  const syncInvocation = cacheSyncInvocation();
  const cacheTargets = targets.filter(
    (target) => target.provider === "google" && target.mode === "oauth" && target.role !== "free-busy"
  );
  await Promise.all(cacheTargets.map((target) => ensureCalendarSyncState(env, target)));
  let states = await loadCalendarSyncStates(env, workspace, cacheTargets.map((target) => target.id));
  let statesByCalendar = new Map(states.map((state) => [state.calendar_id, state]));
  const coldTargets = cacheTargets.filter(
    (target) => !stateUsableForQuery(statesByCalendar.get(target.id), input)
  );
  const freshlySynced = /* @__PURE__ */ new Set();
  if (coldTargets.length > 0) {
    const priorRevisions = new Map(states.map((state) => [state.calendar_id, state.cache_revision]));
    const outcomes = await mapWithConcurrency(
      coldTargets,
      EVENT_QUERY_CONCURRENCY,
      (target) => syncGoogleCalendarCache(
        env,
        target,
        providerFetch,
        syncInvocation,
        inputFitsRollingCoverage(input)
      )
    );
    for (const outcome of outcomes) if (outcome.synced) freshlySynced.add(outcome.calendarId);
    await waitForLeasedCacheSyncs(
      env,
      workspace,
      outcomes.filter((outcome) => outcome.skipped).map((outcome) => outcome.calendarId),
      priorRevisions
    );
    states = await loadCalendarSyncStates(env, workspace, cacheTargets.map((target) => target.id));
    statesByCalendar = new Map(states.map((state) => [state.calendar_id, state]));
  }
  const usableTargets = cacheTargets.filter(
    (target) => stateUsableForQuery(statesByCalendar.get(target.id), input)
  );
  const usableIds = new Set(usableTargets.map((target) => target.id));
  const staleTargets = usableTargets.filter((target) => {
    const state = statesByCalendar.get(target.id);
    return state ? stateNeedsRevalidation(state) : false;
  });
  if (staleTargets.length > 0) {
    const priorRevisions = new Map(states.map((state) => [state.calendar_id, state.cache_revision]));
    const revalidation = mapWithConcurrency(
      staleTargets,
      EVENT_QUERY_CONCURRENCY,
      (target) => syncGoogleCalendarCache(env, target, providerFetch, syncInvocation)
    );
    if (revalidateMode === "background" && executionContext) {
      executionContext.waitUntil(revalidation.then(() => void 0));
    } else {
      const outcomes = await revalidation;
      for (const outcome of outcomes) if (outcome.synced) freshlySynced.add(outcome.calendarId);
      await waitForLeasedCacheSyncs(
        env,
        workspace,
        outcomes.filter((outcome) => outcome.skipped).map((outcome) => outcome.calendarId),
        priorRevisions
      );
      states = await loadCalendarSyncStates(env, workspace, cacheTargets.map((target) => target.id));
      statesByCalendar = new Map(states.map((state) => [state.calendar_id, state]));
    }
  }
  const cached = await loadCachedEvents(env, workspace, input, [...usableIds]);
  const fallbackIds = input.calendarIds.filter((calendarId) => !usableIds.has(calendarId));
  let live = null;
  if (fallbackIds.length > 0) {
    const response = await queryLiveEvents(
      internalEventQueryRequest(request, input, fallbackIds),
      env,
      providerFetch
    );
    live = await response.json();
  }
  const eventMap = /* @__PURE__ */ new Map();
  for (const event of cached.events) eventMap.set(event.id, event);
  for (const event of live?.events ?? []) eventMap.set(event.id, event);
  const events = [...eventMap.values()].sort(
    (left, right) => left.start.localeCompare(right.start) || left.id.localeCompare(right.id)
  );
  const syncedIds = new Set(freshlySynced);
  for (const calendarId of live?.syncedCalendarIds ?? []) syncedIds.add(calendarId);
  const servedIds = new Set(usableIds);
  for (const calendarId of live?.syncedCalendarIds ?? []) servedIds.add(calendarId);
  const servedCalendarIds = input.calendarIds.filter((calendarId) => servedIds.has(calendarId));
  const cacheErrors = usableTargets.flatMap((target) => {
    const state = statesByCalendar.get(target.id);
    return state?.error_code ? [{
      calendarId: target.id,
      code: state.error_code,
      message: state.error_message ?? "The last background cache refresh failed."
    }] : [];
  });
  return json({
    timeMin: input.timeMin,
    timeMax: input.timeMax,
    syncedAt: (/* @__PURE__ */ new Date()).toISOString(),
    events,
    syncedCalendarIds: input.calendarIds.filter((calendarId) => syncedIds.has(calendarId)),
    servedCalendarIds,
    errors: [...cacheErrors, ...live?.errors ?? []],
    truncated: cached.truncated || Boolean(live?.truncated),
    source: usableIds.size === 0 ? "live" : fallbackIds.length === 0 ? "cache" : "cache+live",
    cache: {
      servedAt: (/* @__PURE__ */ new Date()).toISOString(),
      calendars: input.calendarIds.map((calendarId) => statesByCalendar.get(calendarId)).filter((state) => Boolean(state)).map((state) => cacheProof(state, input))
    }
  });
}
__name(queryEvents, "queryEvents");
async function strictLiveAvailabilityForScope(scope, env, input, providerFetch, excludedEventIds = /* @__PURE__ */ new Set()) {
  const live = await queryLiveEventsForScope(scope, input, env, providerFetch);
  const synced = new Set(live.syncedCalendarIds);
  const conclusive = input.calendarIds.every((calendarId) => synced.has(calendarId)) && live.errors.length === 0 && !live.truncated;
  const conflicts = live.events.filter(
    (event) => !excludedEventIds.has(event.id) && event.busy && event.status !== "cancelled" && event.status !== "declined"
  );
  return {
    available: conclusive && conflicts.length === 0,
    conclusive,
    validatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    source: "provider-live",
    conflicts,
    syncedCalendarIds: live.syncedCalendarIds,
    errors: live.errors
  };
}
__name(strictLiveAvailabilityForScope, "strictLiveAvailabilityForScope");
async function strictLiveAvailability(request, env, input, providerFetch, excludedEventIds = /* @__PURE__ */ new Set()) {
  const scope = await principalScope(request, env);
  return strictLiveAvailabilityForScope(
    scope,
    env,
    input,
    providerFetch,
    excludedEventIds
  );
}
__name(strictLiveAvailability, "strictLiveAvailability");
async function validateLiveAvailability(request, env, providerFetch) {
  await principalScope(request, env);
  const input = eventQueryInput(await readJson(request));
  const result = await strictLiveAvailability(request, env, input, providerFetch);
  return json({ ...result, timeMin: input.timeMin, timeMax: input.timeMax });
}
__name(validateLiveAvailability, "validateLiveAvailability");
async function confirmLiveAvailability(request, env, providerFetch) {
  const { workspace, principal } = await principalScope(request, env);
  const body = await readJson(request);
  const input = eventQueryInput(body);
  const idempotencyKey = identifier2(body.idempotencyKey, "idempotencyKey");
  const requestHash = await sha2563(JSON.stringify({
    timeMin: input.timeMin,
    timeMax: input.timeMax,
    calendarIds: [...input.calendarIds].sort()
  }));
  const existing = await env.CALENDAR_DB.prepare(
    `SELECT request_hash, response_json
       FROM availability_confirmations
      WHERE workspace_id = ? AND principal_id = ? AND idempotency_key = ?`
  ).bind(workspace, principal, idempotencyKey).first();
  if (existing) {
    if (existing.request_hash !== requestHash) {
      throw new ApiError(
        409,
        "idempotency_key_reused",
        "This idempotency key was already used for a different availability request."
      );
    }
    const stored = JSON.parse(existing.response_json);
    const storedRecord = isRecord9(stored) ? stored : {};
    if (storedRecord.error === "slot_conflict") return json(storedRecord, 409);
    return json(
      { ...storedRecord, idempotentReplay: true },
      200
    );
  }
  const cacheTargets = (await loadCalendarSyncTargets(
    env,
    workspace,
    principal,
    input.calendarIds
  )).filter(
    (target) => target.provider === "google" && target.mode === "oauth" && target.role !== "free-busy"
  );
  const syncInvocation = cacheSyncInvocation();
  await Promise.all(cacheTargets.map((target) => ensureCalendarSyncState(env, target)));
  let cacheStates = await loadCalendarSyncStates(env, workspace, cacheTargets.map((target) => target.id));
  let cacheStatesById = new Map(cacheStates.map((state) => [state.calendar_id, state]));
  const refreshTargets = cacheTargets.filter((target) => {
    const state = cacheStatesById.get(target.id);
    return !stateUsableForQuery(state, input) || (state ? stateNeedsRevalidation(state) : true);
  });
  if (refreshTargets.length > 0) {
    const outcomes = await mapWithConcurrency(
      refreshTargets,
      EVENT_QUERY_CONCURRENCY,
      (target) => syncGoogleCalendarCache(
        env,
        target,
        providerFetch,
        syncInvocation,
        inputFitsRollingCoverage(input) && !stateUsableForQuery(cacheStatesById.get(target.id), input)
      )
    );
    if (outcomes.some((outcome) => !outcome.synced && !outcome.skipped)) {
      throw new ApiError(
        503,
        "calendar_cache_refresh_failed",
        "The calendar cache could not be refreshed before live availability validation."
      );
    }
    cacheStates = await loadCalendarSyncStates(env, workspace, cacheTargets.map((target) => target.id));
    cacheStatesById = new Map(cacheStates.map((state) => [state.calendar_id, state]));
  }
  if (cacheTargets.some((target) => {
    const state = cacheStatesById.get(target.id);
    return !stateUsableForQuery(state, input) || (state ? stateNeedsRevalidation(state) : true);
  })) {
    throw new ApiError(
      503,
      "calendar_cache_not_authoritative",
      "The calendar cache is incomplete or stale; availability was not confirmed."
    );
  }
  const validation = await strictLiveAvailability(request, env, input, providerFetch);
  if (!validation.conclusive) {
    throw new ApiError(
      503,
      "live_availability_unavailable",
      "Every conflict calendar must be checked live before this slot can be confirmed."
    );
  }
  const responseBody = validation.available ? {
    ...validation,
    timeMin: input.timeMin,
    timeMax: input.timeMax,
    confirmationId: crypto.randomUUID(),
    availabilityConfirmed: true,
    idempotentReplay: false
  } : {
    error: "slot_conflict",
    message: "That time is no longer available."
  };
  await env.CALENDAR_DB.prepare(
    `INSERT INTO availability_confirmations
      (workspace_id, principal_id, idempotency_key, request_hash, response_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (workspace_id, principal_id, idempotency_key) DO NOTHING`
  ).bind(
    workspace,
    principal,
    idempotencyKey,
    requestHash,
    JSON.stringify(responseBody),
    (/* @__PURE__ */ new Date()).toISOString()
  ).run();
  const committed = await env.CALENDAR_DB.prepare(
    `SELECT request_hash, response_json
       FROM availability_confirmations
      WHERE workspace_id = ? AND principal_id = ? AND idempotency_key = ?`
  ).bind(workspace, principal, idempotencyKey).first();
  if (!committed || committed.request_hash !== requestHash) {
    throw new ApiError(
      409,
      "idempotency_key_reused",
      "This idempotency key was already used for a different availability request."
    );
  }
  return json(JSON.parse(committed.response_json), validation.available ? 200 : 409);
}
__name(confirmLiveAvailability, "confirmLiveAvailability");
var optionalCommitText = /* @__PURE__ */ __name((value, field, maximumLength) => {
  if (value === void 0 || value === null || value === "") return null;
  return requiredText3(value, field, maximumLength);
}, "optionalCommitText");
function providerBookingCommitInput(body) {
  const destinationCalendarId = identifier2(
    body.destinationCalendarId,
    "destinationCalendarId"
  );
  const range = eventQueryInput({
    timeMin: body.start,
    timeMax: body.end,
    calendarIds: body.conflictCalendarIds
  });
  const hasConflictTimeMin = body.conflictTimeMin !== void 0;
  const hasConflictTimeMax = body.conflictTimeMax !== void 0;
  if (hasConflictTimeMin !== hasConflictTimeMax) {
    throw new ApiError(
      400,
      "invalid_conflict_time_range",
      "conflictTimeMin and conflictTimeMax must be supplied together."
    );
  }
  const conflictRange = hasConflictTimeMin ? eventQueryInput({
    timeMin: body.conflictTimeMin,
    timeMax: body.conflictTimeMax,
    calendarIds: range.calendarIds
  }) : range;
  if (Date.parse(conflictRange.timeMin) > Date.parse(range.timeMin) || Date.parse(conflictRange.timeMax) < Date.parse(range.timeMax)) {
    throw new ApiError(
      400,
      "invalid_conflict_time_range",
      "The conflict validation range must contain the complete booking range."
    );
  }
  if (!range.calendarIds.includes(destinationCalendarId)) {
    throw new ApiError(
      400,
      "destination_not_checked",
      "conflictCalendarIds must include destinationCalendarId."
    );
  }
  if (body.bookingKind !== "meeting" && body.bookingKind !== "approval-hold" && body.bookingKind !== "work-block") {
    throw new ApiError(
      400,
      "invalid_booking_kind",
      "bookingKind must be meeting, approval-hold, or work-block."
    );
  }
  if (!Array.isArray(body.attendeeEmails ?? [])) {
    throw new ApiError(400, "invalid_attendees", "attendeeEmails must be an array.");
  }
  const attendeeValues = body.attendeeEmails ?? [];
  if (attendeeValues.length > MAX_BOOKING_ATTENDEES) {
    throw new ApiError(
      400,
      "invalid_attendees",
      `Choose at most ${MAX_BOOKING_ATTENDEES} attendees.`
    );
  }
  const attendeeEmails = attendeeValues.map((value, index) => {
    const email = requiredText3(value, `attendeeEmails[${index}]`, 320).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
      throw new ApiError(400, "invalid_attendees", `attendeeEmails[${index}] is invalid.`);
    }
    return email;
  });
  if (new Set(attendeeEmails).size !== attendeeEmails.length) {
    throw new ApiError(400, "invalid_attendees", "Attendee emails must be unique.");
  }
  if (body.bookingKind === "work-block" && attendeeEmails.length > 0) {
    throw new ApiError(
      400,
      "invalid_attendees",
      "Work blocks do not invite attendees."
    );
  }
  const conferenceProvider = body.conferenceProvider ?? "none";
  if (conferenceProvider !== "none" && conferenceProvider !== "google-meet") {
    throw new ApiError(
      400,
      "unsupported_conference_provider",
      "conferenceProvider must be none or google-meet for a Google destination."
    );
  }
  if (body.bookingKind !== "meeting" && conferenceProvider !== "none") {
    throw new ApiError(
      400,
      "unsupported_conference_provider",
      "Approval holds and work blocks cannot create a conference."
    );
  }
  let expiresAt = null;
  if (body.bookingKind === "approval-hold") {
    const rawExpiration = requiredText3(body.expiresAt, "expiresAt", 64);
    const expiration = Date.parse(rawExpiration);
    if (!RFC3339_INSTANT.test(rawExpiration) || !Number.isFinite(expiration)) {
      throw new ApiError(
        400,
        "invalid_hold_expiration",
        "expiresAt must be an RFC 3339 timestamp with a time-zone offset."
      );
    }
    if (expiration <= Date.now() || expiration > Date.now() + 30 * 24 * 60 * 60 * 1e3) {
      throw new ApiError(
        400,
        "invalid_hold_expiration",
        "expiresAt must be in the future and no more than 30 days away."
      );
    }
    expiresAt = new Date(expiration).toISOString();
  } else if (body.expiresAt !== void 0 && body.expiresAt !== null) {
    throw new ApiError(
      400,
      "invalid_hold_expiration",
      "expiresAt is only valid for an approval hold."
    );
  }
  return {
    ...range,
    conflictTimeMin: conflictRange.timeMin,
    conflictTimeMax: conflictRange.timeMax,
    destinationCalendarId,
    idempotencyKey: identifier2(body.idempotencyKey, "idempotencyKey"),
    title: requiredText3(body.title, "title", 255),
    description: optionalCommitText(body.description, "description", 4e3),
    location: optionalCommitText(body.location, "location", 1024),
    bookingKind: body.bookingKind,
    attendeeEmails,
    conferenceProvider,
    expiresAt
  };
}
__name(providerBookingCommitInput, "providerBookingCommitInput");
async function deterministicGoogleEventId(workspace, principal, input) {
  return publicBookingProviderOperationId(
    { workspace, principal },
    input.destinationCalendarId,
    input.idempotencyKey
  );
}
__name(deterministicGoogleEventId, "deterministicGoogleEventId");
async function acquireBookingCommitLock(env, workspace, principal, destinationCalendarId, leaseToken) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const leaseUntil = new Date(Date.now() + BOOKING_COMMIT_LEASE_MS).toISOString();
  const result = await env.CALENDAR_DB.prepare(
    `INSERT INTO provider_booking_commit_locks
      (workspace_id, principal_id, destination_calendar_id, lease_token, lease_until, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (workspace_id, principal_id, destination_calendar_id) DO UPDATE SET
       lease_token = excluded.lease_token,
       lease_until = excluded.lease_until,
       updated_at = excluded.updated_at
     WHERE provider_booking_commit_locks.lease_until IS NULL
        OR provider_booking_commit_locks.lease_until <= ?`
  ).bind(workspace, principal, destinationCalendarId, leaseToken, leaseUntil, now, now).run();
  return Number(result.meta.changes ?? 0) === 1;
}
__name(acquireBookingCommitLock, "acquireBookingCommitLock");
async function releaseBookingCommitLock(env, workspace, principal, destinationCalendarId, leaseToken) {
  await env.CALENDAR_DB.prepare(
    `UPDATE provider_booking_commit_locks
        SET lease_token = NULL, lease_until = NULL, updated_at = ?
      WHERE workspace_id = ? AND principal_id = ?
        AND destination_calendar_id = ? AND lease_token = ?`
  ).bind(
    (/* @__PURE__ */ new Date()).toISOString(),
    workspace,
    principal,
    destinationCalendarId,
    leaseToken
  ).run();
}
__name(releaseBookingCommitLock, "releaseBookingCommitLock");
var GOOGLE_COMMITTED_EVENT_FIELDS = [
  "id",
  "etag",
  "status",
  "updated",
  "summary",
  "description",
  "start",
  "end",
  "eventType",
  "transparency",
  "visibility",
  "location",
  "htmlLink",
  "hangoutLink",
  "conferenceData",
  "attendees(id,email,displayName,responseStatus,optional,self)",
  "extendedProperties(private)"
].join(",");
async function getGoogleCommittedEvent(target, providerEventId, accessToken, providerFetch) {
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(target.provider_calendar_id)}/events/${encodeURIComponent(providerEventId)}`
  );
  url.searchParams.set("maxAttendees", String(MAX_EVENT_ATTENDEES));
  url.searchParams.set("fields", GOOGLE_COMMITTED_EVENT_FIELDS);
  try {
    return await externalJson(
      url.href,
      { headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` } },
      providerFetch
    );
  } catch (error) {
    if (error instanceof ProviderHttpError && error.providerStatus === 404) return null;
    throw error;
  }
}
__name(getGoogleCommittedEvent, "getGoogleCommittedEvent");
var googleCommitEventBody = /* @__PURE__ */ __name((input, providerEventId, requestHash) => ({
  id: providerEventId,
  summary: input.bookingKind === "approval-hold" ? `Pending approval: ${input.title}`.slice(0, 255) : input.title,
  ...input.description ? { description: input.description } : {},
  ...input.location ? { location: input.location } : {},
  start: { dateTime: input.timeMin },
  end: { dateTime: input.timeMax },
  transparency: "opaque",
  status: input.bookingKind === "approval-hold" ? "tentative" : "confirmed",
  ...input.bookingKind === "meeting" && input.attendeeEmails.length > 0 ? { attendees: input.attendeeEmails.map((email) => ({ email })) } : {},
  ...input.bookingKind === "meeting" && input.conferenceProvider === "google-meet" ? {
    conferenceData: {
      createRequest: {
        requestId: `${providerEventId}m`,
        conferenceSolutionKey: { type: "hangoutsMeet" }
      }
    }
  } : {},
  ...input.bookingKind === "meeting" ? {} : { visibility: "private" },
  extendedProperties: {
    private: {
      tapCommitHash: requestHash,
      tapBookingKind: input.bookingKind
    }
  }
}), "googleCommitEventBody");
async function insertGoogleCommittedEvent(target, input, providerEventId, requestHash, accessToken, providerFetch) {
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(target.provider_calendar_id)}/events`
  );
  url.searchParams.set(
    "sendUpdates",
    input.bookingKind === "meeting" && input.attendeeEmails.length > 0 ? "all" : "none"
  );
  url.searchParams.set("maxAttendees", String(MAX_EVENT_ATTENDEES));
  if (input.conferenceProvider === "google-meet") {
    url.searchParams.set("conferenceDataVersion", "1");
  }
  url.searchParams.set("fields", GOOGLE_COMMITTED_EVENT_FIELDS);
  return externalJson(
    url.href,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(googleCommitEventBody(input, providerEventId, requestHash))
    },
    providerFetch
  );
}
__name(insertGoogleCommittedEvent, "insertGoogleCommittedEvent");
var googleCommitHash = /* @__PURE__ */ __name((value) => {
  const extended = isRecord9(value.extendedProperties) ? value.extendedProperties : null;
  const privateValues = extended && isRecord9(extended.private) ? extended.private : null;
  return privateValues && typeof privateValues.tapCommitHash === "string" ? privateValues.tapCommitHash : null;
}, "googleCommitHash");
function committedBookingEvent(input, providerEvent) {
  const normalized = normalizeGoogleCalendarEvent(providerEvent, input.destinationCalendarId);
  if (!normalized) {
    throw new ApiError(
      502,
      "provider_event_invalid",
      "Google created the event but returned an invalid event projection."
    );
  }
  return {
    ...normalized,
    kind: input.bookingKind === "work-block" ? "work-block" : input.bookingKind === "approval-hold" ? "hold" : "meeting",
    status: input.bookingKind === "approval-hold" ? "pending" : normalized.status
  };
}
__name(committedBookingEvent, "committedBookingEvent");
function committedBookingProjection(input, providerEvent, providerEventId) {
  const event = committedBookingEvent(input, providerEvent);
  return {
    booking: {
      state: "committed",
      provider: "google",
      providerEventId,
      destinationCalendarId: input.destinationCalendarId,
      bookingKind: input.bookingKind,
      approvalStatus: input.bookingKind === "approval-hold" ? "pending" : null,
      pendingAttendeeEmails: input.bookingKind === "approval-hold" ? input.attendeeEmails : [],
      approvalExpiresAt: input.expiresAt,
      providerHtmlLink: normalizeGoogleCalendarHtmlUrl(providerEvent.htmlLink),
      providerJoinUrl: googleMeetJoinUrl(providerEvent),
      conferenceStatus: input.conferenceProvider === "google-meet" ? googleMeetJoinUrl(providerEvent) ? "ready" : "pending" : "none",
      event
    },
    committedAt: (/* @__PURE__ */ new Date()).toISOString(),
    idempotentReplay: false,
    concurrencyBoundary: "tap-conflict-calendar-set-serialized"
  };
}
__name(committedBookingProjection, "committedBookingProjection");
var parsedRecord = /* @__PURE__ */ __name((value) => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return isRecord9(parsed) ? parsed : null;
  } catch {
    return null;
  }
}, "parsedRecord");
var boundedStringArray = /* @__PURE__ */ __name((value, maximum) => Array.isArray(value) && value.length <= maximum && value.every((item) => typeof item === "string") ? value : [], "boundedStringArray");
function recoveredCommittedBookingProjection(row, providerEvent) {
  const normalized = normalizeGoogleCalendarEvent(
    providerEvent,
    row.destination_calendar_id
  );
  if (!normalized) {
    throw new ApiError(
      502,
      "provider_event_invalid",
      "Google returned an invalid committed event projection."
    );
  }
  const storedResponse = parsedRecord(row.response_json);
  const storedBooking = storedResponse && isRecord9(storedResponse.booking) ? storedResponse.booking : null;
  const storedRequest = parsedRecord(row.request_json);
  const pendingAttendeeEmails = row.booking_kind === "approval-hold" ? boundedStringArray(
    storedBooking?.pendingAttendeeEmails ?? storedRequest?.attendeeEmails,
    MAX_BOOKING_ATTENDEES
  ) : [];
  const storedConferenceStatus = storedBooking?.conferenceStatus;
  const providerJoinUrl = googleMeetJoinUrl(providerEvent);
  const conferenceRequested = storedConferenceStatus === "pending" || storedConferenceStatus === "ready" || storedRequest?.conferenceProvider === "google-meet" || googleMeetConferenceRequested(providerEvent);
  const committedAt = typeof storedResponse?.committedAt === "string" && Number.isFinite(Date.parse(storedResponse.committedAt)) ? storedResponse.committedAt : typeof row.updated_at === "string" && Number.isFinite(Date.parse(row.updated_at)) ? row.updated_at : (/* @__PURE__ */ new Date()).toISOString();
  const storedApprovalExpiration = storedBooking?.approvalExpiresAt;
  const approvalExpiresAt = row.booking_kind === "approval-hold" ? typeof storedApprovalExpiration === "string" && Number.isFinite(Date.parse(storedApprovalExpiration)) ? storedApprovalExpiration : row.hold_expires_at ?? null : null;
  return {
    booking: {
      state: "committed",
      provider: "google",
      providerEventId: row.provider_event_id,
      destinationCalendarId: row.destination_calendar_id,
      bookingKind: row.booking_kind,
      approvalStatus: row.booking_kind === "approval-hold" ? "pending" : null,
      pendingAttendeeEmails,
      approvalExpiresAt,
      providerHtmlLink: normalizeGoogleCalendarHtmlUrl(providerEvent.htmlLink),
      providerJoinUrl,
      conferenceStatus: providerJoinUrl ? "ready" : conferenceRequested ? "pending" : "none",
      event: {
        ...normalized,
        kind: row.booking_kind === "work-block" ? "work-block" : row.booking_kind === "approval-hold" ? "hold" : "meeting",
        status: row.booking_kind === "approval-hold" ? "pending" : normalized.status
      }
    },
    committedAt,
    idempotentReplay: true,
    concurrencyBoundary: "tap-conflict-calendar-set-serialized"
  };
}
__name(recoveredCommittedBookingProjection, "recoveredCommittedBookingProjection");
function storedCommittedBookingProjection(row) {
  const storedResponse = parsedRecord(row.response_json);
  const storedBooking = storedResponse && isRecord9(storedResponse.booking) ? storedResponse.booking : null;
  const storedEvent = storedBooking && isRecord9(storedBooking.event) ? storedBooking.event : null;
  if (!storedResponse || !storedBooking || !storedEvent) {
    throw new ApiError(
      409,
      "booking_projection_invalid",
      "The durable booking projection is unavailable."
    );
  }
  const {
    providerHtmlLink: storedEventHtmlLink,
    providerJoinUrl: storedEventJoinUrl,
    ...eventWithoutLinks
  } = storedEvent;
  const providerHtmlLink = normalizeGoogleCalendarHtmlUrl(storedBooking.providerHtmlLink);
  const providerJoinUrl = normalizeGoogleMeetJoinUrl(storedBooking.providerJoinUrl);
  const eventProviderHtmlLink = normalizeGoogleCalendarHtmlUrl(storedEventHtmlLink);
  const eventProviderJoinUrl = normalizeGoogleMeetJoinUrl(storedEventJoinUrl);
  const storedConferenceStatus = storedBooking.conferenceStatus;
  return {
    booking: {
      ...storedBooking,
      state: "committed",
      provider: "google",
      providerEventId: row.provider_event_id,
      destinationCalendarId: row.destination_calendar_id,
      bookingKind: row.booking_kind,
      approvalStatus: row.booking_kind === "approval-hold" ? "pending" : null,
      providerHtmlLink,
      providerJoinUrl,
      conferenceStatus: providerJoinUrl ? "ready" : storedConferenceStatus === "pending" ? "pending" : "none",
      event: {
        ...eventWithoutLinks,
        ...eventProviderHtmlLink ? { providerHtmlLink: eventProviderHtmlLink } : {},
        ...eventProviderJoinUrl ? { providerJoinUrl: eventProviderJoinUrl } : {}
      }
    },
    committedAt: typeof storedResponse.committedAt === "string" && Number.isFinite(Date.parse(storedResponse.committedAt)) ? storedResponse.committedAt : row.updated_at ?? (/* @__PURE__ */ new Date()).toISOString(),
    idempotentReplay: true,
    concurrencyBoundary: "tap-conflict-calendar-set-serialized"
  };
}
__name(storedCommittedBookingProjection, "storedCommittedBookingProjection");
function enrichedStoredBookingProjection(row, providerEvent) {
  const stored = storedCommittedBookingProjection(row);
  const booking = isRecord9(stored.booking) ? stored.booking : null;
  const event = booking && isRecord9(booking.event) ? booking.event : null;
  if (!booking || !event) {
    throw new ApiError(
      409,
      "booking_projection_invalid",
      "The durable booking projection is unavailable."
    );
  }
  const storedRequest = parsedRecord(row.request_json);
  const providerJoinUrl = googleMeetJoinUrl(providerEvent);
  const storedConferenceStatus = booking.conferenceStatus;
  const conferenceRequested = storedConferenceStatus === "pending" || storedConferenceStatus === "ready" || storedRequest?.conferenceProvider === "google-meet" || googleMeetConferenceRequested(providerEvent);
  const meetingRequestedGoogleMeet = row.booking_kind === "meeting" && (storedRequest?.conferenceProvider === "google-meet" || storedConferenceStatus === "pending" || storedConferenceStatus === "ready");
  return {
    ...stored,
    booking: {
      ...booking,
      providerHtmlLink: normalizeGoogleCalendarHtmlUrl(providerEvent.htmlLink),
      providerJoinUrl,
      conferenceStatus: providerJoinUrl ? "ready" : conferenceRequested ? "pending" : "none",
      event: meetingRequestedGoogleMeet ? { ...event, location: providerJoinUrl ? "google-meet" : null } : event
    }
  };
}
__name(enrichedStoredBookingProjection, "enrichedStoredBookingProjection");
function bookingLifecycle(row) {
  const state = row.resolution_status === "approved" ? "approved" : row.resolution_status === "declined" ? "declined" : row.hold_expired_at ? "expired" : "active";
  const resolution = parsedRecord(row.resolution_response_json);
  const storedResolvedAt = typeof resolution?.resolvedAt === "string" && Number.isFinite(Date.parse(resolution.resolvedAt)) ? resolution.resolvedAt : null;
  const fallbackResolvedAt = typeof row.resolution_updated_at === "string" && Number.isFinite(Date.parse(row.resolution_updated_at)) ? row.resolution_updated_at : null;
  const expiredAt = typeof row.hold_expired_at === "string" && Number.isFinite(Date.parse(row.hold_expired_at)) ? row.hold_expired_at : null;
  return {
    state,
    resolvedAt: state === "active" ? null : state === "expired" ? expiredAt : storedResolvedAt ?? fallbackResolvedAt,
    providerEventRemoved: state === "declined" || state === "expired"
  };
}
__name(bookingLifecycle, "bookingLifecycle");
async function getGoogleBookingStatus(request, env, bookingIdempotencyKey, providerFetch) {
  const { workspace, principal } = await principalScope(request, env);
  const row = await env.CALENDAR_DB.prepare(
    `SELECT provider_booking_commits.request_hash,
            provider_booking_commits.request_json,
            provider_booking_commits.destination_calendar_id,
            provider_booking_commits.provider_event_id,
            provider_booking_commits.booking_kind,
            provider_booking_commits.start_at,
            provider_booking_commits.end_at,
            provider_booking_commits.state,
            provider_booking_commits.response_json,
            provider_booking_commits.resolution_status,
            provider_booking_commits.conflict_calendar_ids_json,
            provider_booking_commits.hold_expires_at,
            provider_booking_commits.hold_expired_at,
            provider_booking_commits.updated_at,
            provider_booking_resolutions.request_hash AS resolution_request_hash,
            provider_booking_resolutions.response_json AS resolution_response_json,
            provider_booking_resolutions.updated_at AS resolution_updated_at
       FROM provider_booking_commits
       LEFT JOIN provider_booking_resolutions
         ON provider_booking_resolutions.workspace_id = provider_booking_commits.workspace_id
        AND provider_booking_resolutions.principal_id = provider_booking_commits.principal_id
        AND provider_booking_resolutions.booking_idempotency_key =
            provider_booking_commits.idempotency_key
      WHERE provider_booking_commits.workspace_id = ?
        AND provider_booking_commits.principal_id = ?
        AND provider_booking_commits.idempotency_key = ?`
  ).bind(workspace, principal, bookingIdempotencyKey).first();
  if (!row) {
    throw new ApiError(404, "booking_not_found", "The booking was not found.");
  }
  if (row.state === "rejected") {
    const rejected2 = parsedRecord(row.response_json);
    return json(rejected2 ?? {
      error: "booking_rejected",
      message: "The booking was rejected."
    }, 409);
  }
  const lifecycle = bookingLifecycle(row);
  if (lifecycle.providerEventRemoved) {
    return json({
      commit: storedCommittedBookingProjection(row),
      lifecycle,
      currentEvent: null
    });
  }
  const target = (await loadCalendarSyncTargets(
    env,
    workspace,
    principal,
    [row.destination_calendar_id]
  ))[0];
  if (!target || target.provider !== "google" || target.mode !== "oauth") {
    throw new ApiError(
      409,
      "booking_provider_unavailable",
      "The booking's Google Calendar connection is unavailable."
    );
  }
  const { secret } = await authorizedToken(
    env,
    connectionFromSyncTarget(target),
    providerFetch
  );
  const providerEvent = await getGoogleCommittedEvent(
    target,
    row.provider_event_id,
    secret.accessToken,
    providerFetch
  );
  if (!providerEvent) {
    if (row.state === "pending") {
      throw new ApiError(
        409,
        "booking_commit_pending",
        "Google has not confirmed this booking yet. Retry the original commit key."
      );
    }
    throw new ApiError(
      502,
      "provider_commit_unverified",
      "The committed Google event could not be verified."
    );
  }
  if (googleCommitHash(providerEvent) !== row.request_hash) {
    throw new ApiError(
      502,
      "provider_commit_unverified",
      "The Google event does not contain TAP's booking proof."
    );
  }
  if (lifecycle.state === "approved" && (!row.resolution_request_hash || googleResolutionHash(providerEvent) !== row.resolution_request_hash)) {
    throw new ApiError(
      502,
      "provider_resolution_unverified",
      "The Google event does not contain TAP's approval proof."
    );
  }
  const currentEvent = normalizeGoogleCalendarEvent(providerEvent, row.destination_calendar_id);
  if (!currentEvent) {
    throw new ApiError(
      502,
      "provider_event_invalid",
      "Google returned an invalid committed event projection."
    );
  }
  const providerHtmlLink = normalizeGoogleCalendarHtmlUrl(providerEvent.htmlLink);
  const providerJoinUrl = googleMeetJoinUrl(providerEvent);
  const currentEventProjection = {
    ...currentEvent,
    ...providerHtmlLink ? { providerHtmlLink } : {},
    ...providerJoinUrl ? { providerJoinUrl } : {}
  };
  return json({
    commit: row.response_json ? enrichedStoredBookingProjection(row, providerEvent) : recoveredCommittedBookingProjection(row, providerEvent),
    lifecycle,
    currentEvent: lifecycle.state === "approved" ? { ...currentEventProjection, kind: "meeting", status: "confirmed" } : currentEventProjection
  });
}
__name(getGoogleBookingStatus, "getGoogleBookingStatus");
async function stageBookingCacheMutation(env, target, mutation) {
  const state = await ensureCalendarSyncState(env, target);
  const generation = `booking-${crypto.randomUUID()}`;
  await env.CALENDAR_DB.prepare(
    `INSERT INTO calendar_event_cache
      (workspace_id, connection_id, calendar_id, provider_event_id, sync_generation,
       event_id, start_at, end_at, tombstoned, payload_json, provider_updated_at, cached_at)
     SELECT workspace_id, connection_id, calendar_id, provider_event_id, ?,
            event_id, start_at, end_at, tombstoned, payload_json, provider_updated_at, cached_at
       FROM calendar_event_cache
      WHERE workspace_id = ? AND connection_id = ? AND calendar_id = ?
        AND sync_generation = ?`
  ).bind(
    generation,
    state.workspace_id,
    state.connection_id,
    state.calendar_id,
    state.active_generation
  ).run();
  await writeGoogleCacheMutations(env, state, generation, [mutation]);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const committed = await env.CALENDAR_DB.prepare(
    `UPDATE calendar_sync_state
        SET active_generation = ?, cache_revision = cache_revision + 1,
            freshness = CASE WHEN last_success_at IS NULL THEN 'pending' ELSE 'stale' END,
            next_sync_at = ?
      WHERE workspace_id = ? AND connection_id = ? AND calendar_id = ?
        AND active_generation = ? AND cache_revision = ?`
  ).bind(
    generation,
    now,
    state.workspace_id,
    state.connection_id,
    state.calendar_id,
    state.active_generation,
    state.cache_revision
  ).run();
  if (Number(committed.meta.changes ?? 0) === 0) {
    await env.CALENDAR_DB.prepare(
      `DELETE FROM calendar_event_cache
        WHERE workspace_id = ? AND connection_id = ? AND calendar_id = ?
          AND sync_generation = ?`
    ).bind(state.workspace_id, state.connection_id, state.calendar_id, generation).run();
    await env.CALENDAR_DB.prepare(
      `UPDATE calendar_sync_state SET next_sync_at = ?
        WHERE workspace_id = ? AND connection_id = ? AND calendar_id = ?`
    ).bind(now, state.workspace_id, state.connection_id, state.calendar_id).run();
    return;
  }
  try {
    await env.CALENDAR_DB.prepare(
      `DELETE FROM calendar_event_cache
        WHERE workspace_id = ? AND connection_id = ? AND calendar_id = ?
          AND sync_generation <> ?`
    ).bind(state.workspace_id, state.connection_id, state.calendar_id, generation).run();
  } catch (error) {
    logCalendarSync("warn", "booking cache generation cleanup failed", {
      workspace_id: state.workspace_id,
      connection_id: state.connection_id,
      calendar_id: state.calendar_id,
      error: error instanceof Error ? error.message : "unknown error"
    });
  }
}
__name(stageBookingCacheMutation, "stageBookingCacheMutation");
async function stageCommittedBookingInCache(env, target, input, providerEvent) {
  const event = committedBookingEvent(input, providerEvent);
  await stageBookingCacheMutation(env, target, {
    providerEventId: requiredText3(providerEvent.id, "provider event id", 2048),
    eventId: event.id,
    start: event.start,
    end: event.end,
    tombstoned: false,
    payload: event,
    providerUpdatedAt: typeof providerEvent.updated === "string" && Number.isFinite(Date.parse(providerEvent.updated)) ? new Date(providerEvent.updated).toISOString() : null
  });
}
__name(stageCommittedBookingInCache, "stageCommittedBookingInCache");
async function finalizeCommittedBooking(env, workspace, principal, target, input, providerEvent, response) {
  await persistCommittedBooking(env, workspace, principal, input, response);
  try {
    await stageCommittedBookingInCache(env, target, input, providerEvent);
  } catch (error) {
    logCalendarSync("warn", "committed booking cache staging failed", {
      workspace_id: workspace,
      connection_id: target.connection_id,
      calendar_id: target.id,
      provider_event_id: typeof providerEvent.id === "string" ? providerEvent.id : null,
      error: error instanceof Error ? error.message : "unknown error"
    });
    try {
      await env.CALENDAR_DB.prepare(
        `UPDATE calendar_sync_state SET next_sync_at = ?
          WHERE workspace_id = ? AND connection_id = ? AND calendar_id = ?`
      ).bind((/* @__PURE__ */ new Date()).toISOString(), workspace, target.connection_id, target.id).run();
    } catch {
    }
  }
}
__name(finalizeCommittedBooking, "finalizeCommittedBooking");
async function persistCommittedBooking(env, workspace, principal, input, response) {
  await env.CALENDAR_DB.prepare(
    `UPDATE provider_booking_commits
        SET state = 'committed', response_json = ?, last_error_code = NULL, updated_at = ?
      WHERE workspace_id = ? AND principal_id = ? AND idempotency_key = ?`
  ).bind(
    JSON.stringify(response),
    (/* @__PURE__ */ new Date()).toISOString(),
    workspace,
    principal,
    input.idempotencyKey
  ).run();
}
__name(persistCommittedBooking, "persistCommittedBooking");
var canonicalProviderBookingCommit = /* @__PURE__ */ __name((input) => {
  const hasExpandedConflictRange = input.conflictTimeMin !== input.timeMin || input.conflictTimeMax !== input.timeMax;
  return {
    destinationCalendarId: input.destinationCalendarId,
    conflictCalendarIds: [...input.calendarIds].sort(),
    start: input.timeMin,
    end: input.timeMax,
    ...hasExpandedConflictRange ? {
      conflictTimeMin: input.conflictTimeMin,
      conflictTimeMax: input.conflictTimeMax
    } : {},
    bookingKind: input.bookingKind,
    title: input.title,
    description: input.description,
    location: input.location,
    attendeeEmails: [...input.attendeeEmails].sort(),
    conferenceProvider: input.conferenceProvider,
    expiresAt: input.expiresAt
  };
}, "canonicalProviderBookingCommit");
async function organizerProviderBookingIdentity(scope, input) {
  return {
    requestHash: await sha2563(JSON.stringify(canonicalProviderBookingCommit(input))),
    providerEventId: await deterministicGoogleEventId(
      scope.workspace,
      scope.principal,
      input
    )
  };
}
__name(organizerProviderBookingIdentity, "organizerProviderBookingIdentity");
async function commitGoogleBookingForScope(scope, input, identity, env, providerFetch, assertWriteStillAuthorized) {
  const { workspace, principal } = scope;
  const canonical = canonicalProviderBookingCommit(input);
  const { requestHash, providerEventId } = identity;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await env.CALENDAR_DB.prepare(
    `INSERT OR IGNORE INTO provider_booking_commits
      (workspace_id, principal_id, idempotency_key, request_hash, destination_calendar_id,
       provider_event_id, booking_kind, start_at, end_at, state, response_json,
       last_error_code, created_at, updated_at, conflict_calendar_ids_json,
       hold_expires_at, hold_expired_at, request_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, ?, ?, ?, NULL, ?)`
  ).bind(
    workspace,
    principal,
    input.idempotencyKey,
    requestHash,
    input.destinationCalendarId,
    providerEventId,
    input.bookingKind,
    input.timeMin,
    input.timeMax,
    now,
    now,
    JSON.stringify([...input.calendarIds].sort()),
    input.expiresAt,
    JSON.stringify(canonical)
  ).run();
  const existing = await env.CALENDAR_DB.prepare(
    `SELECT request_hash, destination_calendar_id, provider_event_id, booking_kind,
            state, response_json
       FROM provider_booking_commits
      WHERE workspace_id = ? AND principal_id = ? AND idempotency_key = ?`
  ).bind(workspace, principal, input.idempotencyKey).first();
  if (!existing) {
    throw new ApiError(500, "booking_commit_unavailable", "Booking commit state is unavailable.");
  }
  if (existing.request_hash !== requestHash) {
    throw new ApiError(
      409,
      "idempotency_key_reused",
      "This idempotency key was already used for a different booking request."
    );
  }
  if (existing.state === "committed" && existing.response_json) {
    const stored = JSON.parse(existing.response_json);
    return json({ ...isRecord9(stored) ? stored : {}, idempotentReplay: true });
  }
  if (existing.state === "rejected" && existing.response_json) {
    return json(JSON.parse(existing.response_json), 409);
  }
  const targets = await loadCalendarSyncTargets(
    env,
    workspace,
    principal,
    input.calendarIds
  );
  if (targets.length !== input.calendarIds.length) {
    throw new ApiError(404, "calendar_not_found", "A conflict calendar was not found.");
  }
  const target = targets.find((candidate) => candidate.id === input.destinationCalendarId);
  if (!target || target.provider !== "google" || target.mode !== "oauth" || target.writable !== 1 || target.role === "free-busy") {
    throw new ApiError(
      409,
      "destination_not_writable",
      "Choose a writable Google destination calendar."
    );
  }
  const leaseToken = crypto.randomUUID();
  const acquiredCalendarIds = [];
  for (const calendarId of [...input.calendarIds].sort()) {
    if (await acquireBookingCommitLock(
      env,
      workspace,
      principal,
      calendarId,
      leaseToken
    )) {
      acquiredCalendarIds.push(calendarId);
      continue;
    }
    await Promise.all(acquiredCalendarIds.map(
      (acquiredCalendarId) => releaseBookingCommitLock(env, workspace, principal, acquiredCalendarId, leaseToken)
    ));
    throw new ApiError(
      409,
      "booking_commit_in_progress",
      "Another overlapping TAP booking is being committed. Retry shortly."
    );
  }
  try {
    const { secret } = await authorizedToken(env, connectionFromSyncTarget(target), providerFetch);
    let providerEvent = await getGoogleCommittedEvent(
      target,
      providerEventId,
      secret.accessToken,
      providerFetch
    );
    if (providerEvent) {
      if (googleCommitHash(providerEvent) !== requestHash) {
        throw new ApiError(
          409,
          "provider_event_id_collision",
          "The deterministic Google event identifier is already in use."
        );
      }
      const response2 = committedBookingProjection(input, providerEvent, providerEventId);
      await finalizeCommittedBooking(
        env,
        workspace,
        principal,
        target,
        input,
        providerEvent,
        response2
      );
      return json({ ...response2, idempotentReplay: true });
    }
    const overlap = await env.CALENDAR_DB.prepare(
      `SELECT idempotency_key
         FROM provider_booking_commits
        WHERE workspace_id = ? AND principal_id = ?
          AND destination_calendar_id IN (${input.calendarIds.map(() => "?").join(", ")})
          AND state IN ('pending', 'committed')
          AND (booking_kind <> 'approval-hold' OR resolution_status IS NULL OR resolution_status <> 'declined')
          AND (booking_kind <> 'approval-hold' OR hold_expired_at IS NULL)
          AND idempotency_key <> ?
          AND start_at < ? AND end_at > ?
        LIMIT 1`
    ).bind(
      workspace,
      principal,
      ...input.calendarIds,
      input.idempotencyKey,
      input.conflictTimeMax,
      input.conflictTimeMin
    ).first();
    if (overlap) {
      const conflict = {
        error: "slot_conflict",
        message: "That time is no longer available."
      };
      await env.CALENDAR_DB.prepare(
        `UPDATE provider_booking_commits
            SET state = 'rejected', response_json = ?, last_error_code = 'slot_conflict',
                updated_at = ?
          WHERE workspace_id = ? AND principal_id = ? AND idempotency_key = ?`
      ).bind(
        JSON.stringify(conflict),
        (/* @__PURE__ */ new Date()).toISOString(),
        workspace,
        principal,
        input.idempotencyKey
      ).run();
      return json(conflict, 409);
    }
    const validation = await strictLiveAvailabilityForScope(scope, env, {
      timeMin: input.conflictTimeMin,
      timeMax: input.conflictTimeMax,
      calendarIds: input.calendarIds
    }, providerFetch);
    if (!validation.conclusive) {
      throw new ApiError(
        503,
        "live_availability_unavailable",
        "Every conflict calendar must be checked live before committing this booking."
      );
    }
    if (!validation.available) {
      const conflict = {
        error: "slot_conflict",
        message: "That time is no longer available."
      };
      await env.CALENDAR_DB.prepare(
        `UPDATE provider_booking_commits
            SET state = 'rejected', response_json = ?, last_error_code = 'slot_conflict',
                updated_at = ?
          WHERE workspace_id = ? AND principal_id = ? AND idempotency_key = ?`
      ).bind(
        JSON.stringify(conflict),
        (/* @__PURE__ */ new Date()).toISOString(),
        workspace,
        principal,
        input.idempotencyKey
      ).run();
      return json(conflict, 409);
    }
    if (assertWriteStillAuthorized) {
      try {
        await assertWriteStillAuthorized();
      } catch {
        const invalidated = {
          error: "public_page_changed",
          message: "This booking page changed before the booking was created."
        };
        await env.CALENDAR_DB.prepare(
          `UPDATE provider_booking_commits
              SET state = 'rejected', response_json = ?,
                  last_error_code = 'public_page_changed', updated_at = ?
            WHERE workspace_id = ? AND principal_id = ?
              AND idempotency_key = ? AND state = 'pending'`
        ).bind(
          JSON.stringify(invalidated),
          (/* @__PURE__ */ new Date()).toISOString(),
          workspace,
          principal,
          input.idempotencyKey
        ).run();
        throw new ApiError(
          409,
          "public_page_changed",
          "This booking page changed before the booking was created."
        );
      }
    }
    try {
      providerEvent = await insertGoogleCommittedEvent(
        target,
        input,
        providerEventId,
        requestHash,
        secret.accessToken,
        providerFetch
      );
    } catch (error) {
      if (!(error instanceof ProviderHttpError) || error.providerStatus !== 409) throw error;
      providerEvent = await getGoogleCommittedEvent(
        target,
        providerEventId,
        secret.accessToken,
        providerFetch
      );
      if (!providerEvent || googleCommitHash(providerEvent) !== requestHash) {
        throw new ApiError(
          409,
          "provider_event_id_collision",
          "Google reported a duplicate event identifier that TAP could not recover."
        );
      }
    }
    if (googleCommitHash(providerEvent) !== requestHash) {
      throw new ApiError(
        502,
        "provider_commit_unverified",
        "Google created the event without TAP's commit proof."
      );
    }
    const response = committedBookingProjection(input, providerEvent, providerEventId);
    await finalizeCommittedBooking(
      env,
      workspace,
      principal,
      target,
      input,
      providerEvent,
      response
    );
    return json(response, 201);
  } catch (error) {
    if (error instanceof ApiError && [400, 409].includes(error.status)) throw error;
    await env.CALENDAR_DB.prepare(
      `UPDATE provider_booking_commits
          SET last_error_code = ?, updated_at = ?
        WHERE workspace_id = ? AND principal_id = ?
          AND idempotency_key = ? AND state = 'pending'`
    ).bind(
      error instanceof ApiError ? error.code : "provider_commit_uncertain",
      (/* @__PURE__ */ new Date()).toISOString(),
      workspace,
      principal,
      input.idempotencyKey
    ).run();
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      502,
      "provider_commit_uncertain",
      "Google did not confirm whether the booking was committed. Retry with the same idempotency key."
    );
  } finally {
    const releases = await Promise.allSettled(acquiredCalendarIds.map(
      (calendarId) => releaseBookingCommitLock(env, workspace, principal, calendarId, leaseToken)
    ));
    releases.forEach((release, index) => {
      if (release.status !== "rejected") return;
      logCalendarSync("warn", "booking commit lock release failed", {
        workspace_id: workspace,
        calendar_id: acquiredCalendarIds[index],
        error: release.reason instanceof Error ? release.reason.message : "unknown error"
      });
    });
  }
}
__name(commitGoogleBookingForScope, "commitGoogleBookingForScope");
async function commitGoogleBooking(request, env, providerFetch) {
  const scope = await principalScope(request, env);
  const input = providerBookingCommitInput(await readJson(request));
  return commitGoogleBookingForScope(
    scope,
    input,
    await organizerProviderBookingIdentity(scope, input),
    env,
    providerFetch
  );
}
__name(commitGoogleBooking, "commitGoogleBooking");
var PUBLIC_GOOGLE_OPERATION_ID = /^tap[0-9a-v]{52}$/u;
var SHA256_BASE64URL = /^[A-Za-z0-9_-]{43}$/u;
function publicGoogleCommitInput(command) {
  if (command.idempotencyKey !== command.providerEventId || !PUBLIC_GOOGLE_OPERATION_ID.test(command.providerEventId) || !SHA256_BASE64URL.test(command.requestHash)) {
    throw new ApiError(
      500,
      "public_provider_identity_invalid",
      "The public provider identity is invalid."
    );
  }
  return providerBookingCommitInput({
    destinationCalendarId: command.destinationCalendarId,
    conflictCalendarIds: command.conflictCalendarIds,
    start: command.timeMin,
    end: command.timeMax,
    conflictTimeMin: command.conflictTimeMin,
    conflictTimeMax: command.conflictTimeMax,
    idempotencyKey: command.idempotencyKey,
    title: command.title,
    description: command.description,
    location: command.location,
    bookingKind: command.bookingKind,
    attendeeEmails: command.attendeeEmails,
    conferenceProvider: command.conferenceProvider,
    expiresAt: command.expiresAt
  });
}
__name(publicGoogleCommitInput, "publicGoogleCommitInput");
var publicProviderReceipt = /* @__PURE__ */ __name((command) => ({
  operationId: command.providerEventId,
  commitProof: command.requestHash,
  providerBookingId: command.providerEventId,
  startsAt: command.timeMin,
  endsAt: command.timeMax,
  status: command.bookingKind === "approval-hold" ? "tentative" : "confirmed"
}), "publicProviderReceipt");
var publicCommitResponseMatches = /* @__PURE__ */ __name((response, command) => {
  if (!isRecord9(response) || !isRecord9(response.booking)) return false;
  const event = isRecord9(response.booking.event) ? response.booking.event : null;
  return response.booking.state === "committed" && response.booking.provider === "google" && response.booking.providerEventId === command.providerEventId && response.booking.destinationCalendarId === command.destinationCalendarId && response.booking.bookingKind === command.bookingKind && event?.start === command.timeMin && event.end === command.timeMax;
}, "publicCommitResponseMatches");
async function commitPublicGoogleBookingForScope(command, env, providerFetch, assertPublicationCurrent) {
  try {
    const input = publicGoogleCommitInput(command);
    const response = await commitGoogleBookingForScope(
      command.scope,
      input,
      {
        requestHash: command.requestHash,
        providerEventId: command.providerEventId
      },
      env,
      providerFetch,
      assertPublicationCurrent
    );
    const body = await response.json();
    if (response.status === 409 && isRecord9(body) && body.error === "slot_conflict") {
      return { status: "conflict", reason: "slot-conflict" };
    }
    if (!response.ok || !publicCommitResponseMatches(body, command)) {
      return { status: "uncertain" };
    }
    return { status: "committed", receipt: publicProviderReceipt(command) };
  } catch (error) {
    if (error instanceof ApiError && ["provider_event_id_collision", "idempotency_key_reused"].includes(error.code)) {
      return { status: "conflict", reason: "operation-collision" };
    }
    if (error instanceof ApiError && error.code === "slot_conflict") {
      return { status: "conflict", reason: "slot-conflict" };
    }
    return { status: "uncertain" };
  }
}
__name(commitPublicGoogleBookingForScope, "commitPublicGoogleBookingForScope");
var recoveredGoogleBookingKind = /* @__PURE__ */ __name((providerEvent) => {
  const extended = isRecord9(providerEvent.extendedProperties) ? providerEvent.extendedProperties : null;
  const privateValues = extended && isRecord9(extended.private) ? extended.private : null;
  return privateValues?.tapBookingKind === "meeting" || privateValues?.tapBookingKind === "approval-hold" ? privateValues.tapBookingKind : null;
}, "recoveredGoogleBookingKind");
async function recoverPublicGoogleBookingForScope(command, env, providerFetch) {
  if (!PUBLIC_GOOGLE_OPERATION_ID.test(command.providerEventId) || !SHA256_BASE64URL.test(command.requestHash)) return { status: "uncertain" };
  try {
    const stored = await env.CALENDAR_DB.prepare(
      `SELECT request_hash, state
         FROM provider_booking_commits
        WHERE workspace_id = ? AND principal_id = ?
          AND idempotency_key = ? AND destination_calendar_id = ?
          AND provider_event_id = ?`
    ).bind(
      command.scope.workspace,
      command.scope.principal,
      command.providerEventId,
      command.destinationCalendarId,
      command.providerEventId
    ).first();
    if (stored && stored.request_hash !== command.requestHash) {
      return { status: "uncertain" };
    }
    const targets = await loadCalendarSyncTargets(
      env,
      command.scope.workspace,
      command.scope.principal,
      [command.destinationCalendarId]
    );
    const target = targets[0];
    if (targets.length !== 1 || !target || target.provider !== "google" || target.mode !== "oauth" || target.writable !== 1 || target.role === "free-busy") return { status: "uncertain" };
    const { secret } = await authorizedToken(
      env,
      connectionFromSyncTarget(target),
      providerFetch
    );
    const providerEvent = await getGoogleCommittedEvent(
      target,
      command.providerEventId,
      secret.accessToken,
      providerFetch
    );
    if (!providerEvent) {
      return stored?.state === "committed" ? { status: "uncertain" } : { status: "absent" };
    }
    if (googleCommitHash(providerEvent) !== command.requestHash) {
      return { status: "uncertain" };
    }
    const normalized = normalizeGoogleCalendarEvent(
      providerEvent,
      command.destinationCalendarId
    );
    const bookingKind = recoveredGoogleBookingKind(providerEvent);
    if (!normalized || !bookingKind || normalized.start !== command.timeMin || normalized.end !== command.timeMax || normalized.status === "cancelled" || normalized.status === "declined") return { status: "uncertain" };
    return {
      status: "committed",
      receipt: publicProviderReceipt({
        ...command,
        bookingKind
      })
    };
  } catch {
    return { status: "uncertain" };
  }
}
__name(recoverPublicGoogleBookingForScope, "recoverPublicGoogleBookingForScope");
function createGatewayPublicBookingProvider(env, providerFetch, options) {
  return createPublicGoogleBookingProvider({
    commit: /* @__PURE__ */ __name((command) => commitPublicGoogleBookingForScope(
      command,
      env,
      providerFetch,
      options.assertPublicationCurrent
    ), "commit"),
    recover: /* @__PURE__ */ __name((command) => recoverPublicGoogleBookingForScope(command, env, providerFetch), "recover")
  });
}
__name(createGatewayPublicBookingProvider, "createGatewayPublicBookingProvider");
var publicGoogleManagementReceipt = /* @__PURE__ */ __name((input) => ({
  operationId: input.operationId,
  providerBookingId: input.providerEventId,
  startsAt: input.timeMin,
  endsAt: input.timeMax,
  status: "cancelled"
}), "publicGoogleManagementReceipt");
var publicGoogleRescheduleReceipt = /* @__PURE__ */ __name((input) => ({
  operationId: input.operationId,
  providerBookingId: input.providerEventId,
  startsAt: input.timeMin,
  endsAt: input.timeMax,
  status: "confirmed"
}), "publicGoogleRescheduleReceipt");
var publicGoogleManagementInstant = /* @__PURE__ */ __name((value) => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}, "publicGoogleManagementInstant");
var validPublicGoogleCancellationCommand = /* @__PURE__ */ __name((input) => PUBLIC_GOOGLE_OPERATION_ID.test(input.providerEventId) && input.providerOperationId === input.providerEventId && IDENTIFIER.test(input.destinationCalendarId) && IDENTIFIER.test(input.operationId) && SHA256_BASE64URL.test(input.originalCommitHash) && SHA256_BASE64URL.test(input.cancellationHash) && publicGoogleManagementInstant(input.timeMin) && publicGoogleManagementInstant(input.timeMax) && Date.parse(input.timeMax) > Date.parse(input.timeMin), "validPublicGoogleCancellationCommand");
var validPublicGoogleRescheduleCommand = /* @__PURE__ */ __name((input) => {
  if (!PUBLIC_GOOGLE_OPERATION_ID.test(input.providerEventId) || input.providerOperationId !== input.providerEventId || !IDENTIFIER.test(input.destinationCalendarId) || !IDENTIFIER.test(input.operationId) || !SHA256_BASE64URL.test(input.originalCommitHash) || !SHA256_BASE64URL.test(input.rescheduleHash) || !publicGoogleManagementInstant(input.originalTimeMin) || !publicGoogleManagementInstant(input.originalTimeMax) || !publicGoogleManagementInstant(input.timeMin) || !publicGoogleManagementInstant(input.timeMax) || !publicGoogleManagementInstant(input.conflictTimeMin) || !publicGoogleManagementInstant(input.conflictTimeMax) || Date.parse(input.originalTimeMax) <= Date.parse(input.originalTimeMin) || Date.parse(input.timeMax) <= Date.parse(input.timeMin) || Date.parse(input.conflictTimeMax) <= Date.parse(input.conflictTimeMin) || Date.parse(input.conflictTimeMin) > Date.parse(input.timeMin) || Date.parse(input.conflictTimeMax) < Date.parse(input.timeMax) || input.conflictCalendarIds.length === 0 || input.conflictCalendarIds.length > MAX_EVENT_QUERY_CALENDARS || !input.conflictCalendarIds.every((calendarId) => IDENTIFIER.test(calendarId)) || new Set(input.conflictCalendarIds).size !== input.conflictCalendarIds.length || !input.conflictCalendarIds.includes(input.destinationCalendarId)) return false;
  const sorted = [...input.conflictCalendarIds].sort();
  return input.conflictCalendarIds.every((calendarId, index) => calendarId === sorted[index]);
}, "validPublicGoogleRescheduleCommand");
async function verifiedPublicGoogleManagementCommit(env, input) {
  const stored = await env.CALENDAR_DB.prepare(
    `SELECT request_hash, booking_kind, state, resolution_status, hold_expired_at
      FROM provider_booking_commits
      WHERE workspace_id = ? AND principal_id = ?
        AND destination_calendar_id = ? AND provider_event_id = ?
        AND idempotency_key = ?`
  ).bind(
    input.scope.workspace,
    input.scope.principal,
    input.destinationCalendarId,
    input.providerEventId,
    input.providerOperationId
  ).first();
  if (!stored || stored.state !== "committed" || stored.request_hash !== input.originalCommitHash || stored.booking_kind === "work-block" || stored.resolution_status === "declined" || stored.hold_expired_at) return false;
  return input.bookingStatus === "pending" ? stored.booking_kind === "approval-hold" && stored.resolution_status === null : stored.booking_kind === "meeting" || stored.resolution_status === "approved";
}
__name(verifiedPublicGoogleManagementCommit, "verifiedPublicGoogleManagementCommit");
async function publicGoogleManagementTarget(env, input) {
  const targets = await loadCalendarSyncTargets(
    env,
    input.scope.workspace,
    input.scope.principal,
    [input.destinationCalendarId]
  );
  const target = targets[0];
  return targets.length === 1 && target && target.provider === "google" && target.mode === "oauth" && target.connection_status === "connected" && target.writable === 1 && target.role !== "free-busy" ? target : null;
}
__name(publicGoogleManagementTarget, "publicGoogleManagementTarget");
async function getGoogleManagedEvent(target, providerEventId, accessToken, providerFetch) {
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(target.provider_calendar_id)}/events/${encodeURIComponent(providerEventId)}`
  );
  url.searchParams.set("maxAttendees", String(MAX_EVENT_ATTENDEES));
  url.searchParams.set("fields", GOOGLE_COMMITTED_EVENT_FIELDS);
  try {
    return {
      status: "present",
      event: await externalJson(
        url.href,
        { headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` } },
        providerFetch
      )
    };
  } catch (error) {
    if (error instanceof ProviderHttpError && (error.providerStatus === 404 || error.providerStatus === 410)) return { status: "absent" };
    throw error;
  }
}
__name(getGoogleManagedEvent, "getGoogleManagedEvent");
var googleRescheduleHash = /* @__PURE__ */ __name((event) => {
  const extended = isRecord9(event.extendedProperties) ? event.extendedProperties : null;
  const privateValues = extended && isRecord9(extended.private) ? extended.private : null;
  return privateValues && typeof privateValues.tapRescheduleHash === "string" ? privateValues.tapRescheduleHash : null;
}, "googleRescheduleHash");
var verifiedManagedGoogleEvent = /* @__PURE__ */ __name((event, input, destinationCalendarId) => {
  if (event.id !== input.providerEventId || googleCommitHash(event) !== input.originalCommitHash || event.status === "cancelled") return null;
  const normalized = normalizeGoogleCalendarEvent(event, destinationCalendarId);
  return normalized && normalized.start === input.timeMin && normalized.end === input.timeMax ? normalized : null;
}, "verifiedManagedGoogleEvent");
async function releasePublicGoogleManagementLocks(env, scope, calendarIds, leaseToken) {
  const releases = await Promise.allSettled(calendarIds.map(
    (calendarId) => releaseBookingCommitLock(env, scope.workspace, scope.principal, calendarId, leaseToken)
  ));
  releases.forEach((release, index) => {
    if (release.status !== "rejected") return;
    logCalendarSync("warn", "public booking management lock release failed", {
      workspace_id: scope.workspace,
      calendar_id: calendarIds[index],
      error: release.reason instanceof Error ? release.reason.message : "unknown error"
    });
  });
}
__name(releasePublicGoogleManagementLocks, "releasePublicGoogleManagementLocks");
async function acquirePublicGoogleManagementLocks(env, scope, calendarIds, leaseToken) {
  const acquired = [];
  for (const calendarId of [...calendarIds].sort()) {
    if (await acquireBookingCommitLock(
      env,
      scope.workspace,
      scope.principal,
      calendarId,
      leaseToken
    )) {
      acquired.push(calendarId);
      continue;
    }
    await releasePublicGoogleManagementLocks(env, scope, acquired, leaseToken);
    return null;
  }
  return acquired;
}
__name(acquirePublicGoogleManagementLocks, "acquirePublicGoogleManagementLocks");
async function stageCancelledPublicGoogleBooking(env, target, providerEventId) {
  const cancelledAt = (/* @__PURE__ */ new Date()).toISOString();
  try {
    await stageBookingCacheMutation(env, target, {
      providerEventId,
      eventId: googleEventId("event", target.id, providerEventId),
      start: null,
      end: null,
      tombstoned: true,
      payload: { id: providerEventId, status: "cancelled" },
      providerUpdatedAt: cancelledAt
    });
  } catch (error) {
    logCalendarSync("warn", "public booking cancellation cache staging failed", {
      workspace_id: target.workspace_id,
      connection_id: target.connection_id,
      calendar_id: target.id,
      provider_event_id: providerEventId,
      error: error instanceof Error ? error.message : "unknown error"
    });
  }
}
__name(stageCancelledPublicGoogleBooking, "stageCancelledPublicGoogleBooking");
async function deleteVerifiedPublicGoogleBooking(target, event, input, accessToken, providerFetch) {
  if (typeof event.etag !== "string" || event.etag.length === 0) return "failed";
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(target.provider_calendar_id)}/events/${encodeURIComponent(input.providerEventId)}`
  );
  url.searchParams.set("sendUpdates", input.bookingStatus === "confirmed" ? "all" : "none");
  let response;
  try {
    response = await providerFetch(url.href, {
      method: "DELETE",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "If-Match": event.etag
      }
    });
  } catch {
    return "failed";
  }
  try {
    await response.body?.cancel();
  } catch {
  }
  if (response.ok) return "deleted";
  if (response.status === 404 || response.status === 410) return "absent";
  if (response.status === 412) return "changed";
  return "failed";
}
__name(deleteVerifiedPublicGoogleBooking, "deleteVerifiedPublicGoogleBooking");
async function cancelPublicGoogleBookingForScope(input, env, providerFetch) {
  if (!validPublicGoogleCancellationCommand(input)) return { status: "uncertain" };
  try {
    if (!await verifiedPublicGoogleManagementCommit(env, input)) {
      return { status: "conflict", reason: "provider-mismatch" };
    }
    const target = await publicGoogleManagementTarget(env, input);
    if (!target) return { status: "uncertain" };
    const leaseToken = crypto.randomUUID();
    const acquired = await acquirePublicGoogleManagementLocks(
      env,
      input.scope,
      [input.destinationCalendarId],
      leaseToken
    );
    if (!acquired) return { status: "uncertain" };
    try {
      const { secret } = await authorizedToken(
        env,
        connectionFromSyncTarget(target),
        providerFetch
      );
      const lookup = await getGoogleManagedEvent(
        target,
        input.providerEventId,
        secret.accessToken,
        providerFetch
      );
      if (lookup.status === "absent") {
        await stageCancelledPublicGoogleBooking(env, target, input.providerEventId);
        return { status: "committed", receipt: publicGoogleManagementReceipt(input) };
      }
      if (lookup.event.status === "cancelled") {
        if (lookup.event.id !== input.providerEventId || googleCommitHash(lookup.event) !== input.originalCommitHash) return { status: "conflict", reason: "provider-mismatch" };
        await stageCancelledPublicGoogleBooking(env, target, input.providerEventId);
        return { status: "committed", receipt: publicGoogleManagementReceipt(input) };
      }
      if (!verifiedManagedGoogleEvent(
        lookup.event,
        input,
        input.destinationCalendarId
      )) return { status: "conflict", reason: "provider-mismatch" };
      const deletion = await deleteVerifiedPublicGoogleBooking(
        target,
        lookup.event,
        input,
        secret.accessToken,
        providerFetch
      );
      if (deletion === "changed") {
        return { status: "conflict", reason: "provider-mismatch" };
      }
      if (deletion === "failed") return { status: "uncertain" };
      await stageCancelledPublicGoogleBooking(env, target, input.providerEventId);
      return { status: "committed", receipt: publicGoogleManagementReceipt(input) };
    } finally {
      await releasePublicGoogleManagementLocks(env, input.scope, acquired, leaseToken);
    }
  } catch {
    return { status: "uncertain" };
  }
}
__name(cancelPublicGoogleBookingForScope, "cancelPublicGoogleBookingForScope");
var rescheduleAlreadyCommitted = /* @__PURE__ */ __name((event, input) => {
  const normalized = normalizeGoogleCalendarEvent(event, input.destinationCalendarId);
  return event.id === input.providerEventId && googleCommitHash(event) === input.originalCommitHash && googleRescheduleHash(event) === input.rescheduleHash && Boolean(normalized) && normalized?.start === input.timeMin && normalized.end === input.timeMax && normalized.status !== "cancelled" && normalized.status !== "declined";
}, "rescheduleAlreadyCommitted");
async function hasPublicGoogleRescheduleOverlap(env, input) {
  const overlap = await env.CALENDAR_DB.prepare(
    `SELECT idempotency_key
       FROM provider_booking_commits
      WHERE workspace_id = ? AND principal_id = ?
        AND destination_calendar_id IN (${input.conflictCalendarIds.map(() => "?").join(", ")})
        AND state IN ('pending', 'committed')
        AND (booking_kind <> 'approval-hold' OR resolution_status IS NULL OR resolution_status <> 'declined')
        AND (booking_kind <> 'approval-hold' OR hold_expired_at IS NULL)
        AND provider_event_id <> ?
        AND start_at < ? AND end_at > ?
      LIMIT 1`
  ).bind(
    input.scope.workspace,
    input.scope.principal,
    ...input.conflictCalendarIds,
    input.providerEventId,
    input.conflictTimeMax,
    input.conflictTimeMin
  ).first();
  return Boolean(overlap);
}
__name(hasPublicGoogleRescheduleOverlap, "hasPublicGoogleRescheduleOverlap");
async function patchVerifiedPublicGoogleBooking(target, event, input, accessToken, providerFetch) {
  if (typeof event.etag !== "string" || event.etag.length === 0) {
    throw new ApiError(502, "provider_event_invalid", "Google did not return an event version.");
  }
  const extended = isRecord9(event.extendedProperties) ? event.extendedProperties : {};
  const privateValues = isRecord9(extended.private) ? extended.private : {};
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(target.provider_calendar_id)}/events/${encodeURIComponent(input.providerEventId)}`
  );
  url.searchParams.set("sendUpdates", input.bookingStatus === "confirmed" ? "all" : "none");
  url.searchParams.set("maxAttendees", String(MAX_EVENT_ATTENDEES));
  url.searchParams.set("fields", GOOGLE_COMMITTED_EVENT_FIELDS);
  return externalJson(
    url.href,
    {
      method: "PATCH",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "If-Match": event.etag
      },
      body: JSON.stringify({
        start: { dateTime: input.timeMin },
        end: { dateTime: input.timeMax },
        extendedProperties: {
          ...extended,
          private: {
            ...privateValues,
            tapCommitHash: input.originalCommitHash,
            tapRescheduleHash: input.rescheduleHash
          }
        }
      })
    },
    providerFetch
  );
}
__name(patchVerifiedPublicGoogleBooking, "patchVerifiedPublicGoogleBooking");
async function stageRescheduledPublicGoogleBooking(env, target, event) {
  const normalized = normalizeGoogleCalendarEvent(event, target.id);
  if (!normalized) return;
  try {
    await stageBookingCacheMutation(env, target, {
      providerEventId: requiredText3(event.id, "provider event id", 2048),
      eventId: normalized.id,
      start: normalized.start,
      end: normalized.end,
      tombstoned: false,
      payload: normalized,
      providerUpdatedAt: typeof event.updated === "string" && Number.isFinite(Date.parse(event.updated)) ? new Date(event.updated).toISOString() : null
    });
  } catch (error) {
    logCalendarSync("warn", "public booking reschedule cache staging failed", {
      workspace_id: target.workspace_id,
      connection_id: target.connection_id,
      calendar_id: target.id,
      provider_event_id: typeof event.id === "string" ? event.id : null,
      error: error instanceof Error ? error.message : "unknown error"
    });
  }
}
__name(stageRescheduledPublicGoogleBooking, "stageRescheduledPublicGoogleBooking");
async function reschedulePublicGoogleBookingForScope(input, env, providerFetch, assertWriteStillAuthorized) {
  if (!validPublicGoogleRescheduleCommand(input) || input.bookingStatus !== "confirmed") {
    return { status: "uncertain" };
  }
  try {
    if (!await verifiedPublicGoogleManagementCommit(env, {
      scope: input.scope,
      destinationCalendarId: input.destinationCalendarId,
      providerEventId: input.providerEventId,
      providerOperationId: input.providerOperationId,
      originalCommitHash: input.originalCommitHash,
      bookingStatus: input.bookingStatus
    })) return { status: "conflict", reason: "provider-mismatch" };
    const targets = await loadCalendarSyncTargets(
      env,
      input.scope.workspace,
      input.scope.principal,
      input.conflictCalendarIds
    );
    if (targets.length !== input.conflictCalendarIds.length || targets.some(
      (target2) => target2.provider !== "google" || target2.mode !== "oauth" || target2.connection_status !== "connected"
    )) return { status: "uncertain" };
    const target = targets.find((candidate) => candidate.id === input.destinationCalendarId);
    if (!target || target.writable !== 1 || target.role === "free-busy") {
      return { status: "uncertain" };
    }
    const leaseToken = crypto.randomUUID();
    const acquired = await acquirePublicGoogleManagementLocks(
      env,
      input.scope,
      input.conflictCalendarIds,
      leaseToken
    );
    if (!acquired) return { status: "uncertain" };
    try {
      const { secret } = await authorizedToken(
        env,
        connectionFromSyncTarget(target),
        providerFetch
      );
      let lookup = await getGoogleManagedEvent(
        target,
        input.providerEventId,
        secret.accessToken,
        providerFetch
      );
      if (lookup.status === "absent") return { status: "uncertain" };
      if (rescheduleAlreadyCommitted(lookup.event, input)) {
        await stageRescheduledPublicGoogleBooking(env, target, lookup.event);
        return { status: "committed", receipt: publicGoogleRescheduleReceipt(input) };
      }
      if (googleRescheduleHash(lookup.event) === input.rescheduleHash || !verifiedManagedGoogleEvent(
        lookup.event,
        {
          providerEventId: input.providerEventId,
          originalCommitHash: input.originalCommitHash,
          timeMin: input.originalTimeMin,
          timeMax: input.originalTimeMax
        },
        input.destinationCalendarId
      )) return { status: "conflict", reason: "provider-mismatch" };
      if (await hasPublicGoogleRescheduleOverlap(env, input)) {
        return { status: "conflict", reason: "slot-conflict" };
      }
      const validation = await strictLiveAvailabilityForScope(
        input.scope,
        env,
        {
          timeMin: input.conflictTimeMin,
          timeMax: input.conflictTimeMax,
          calendarIds: input.conflictCalendarIds
        },
        providerFetch,
        /* @__PURE__ */ new Set([googleEventId("event", target.id, input.providerEventId)])
      );
      if (!validation.conclusive) return { status: "uncertain" };
      if (!validation.available) return { status: "conflict", reason: "slot-conflict" };
      await assertWriteStillAuthorized(input);
      lookup = {
        status: "present",
        event: await patchVerifiedPublicGoogleBooking(
          target,
          lookup.event,
          input,
          secret.accessToken,
          providerFetch
        )
      };
      if (!rescheduleAlreadyCommitted(lookup.event, input)) return { status: "uncertain" };
      await stageRescheduledPublicGoogleBooking(env, target, lookup.event);
      return { status: "committed", receipt: publicGoogleRescheduleReceipt(input) };
    } finally {
      await releasePublicGoogleManagementLocks(env, input.scope, acquired, leaseToken);
    }
  } catch (error) {
    if (error instanceof ProviderHttpError && (error.providerStatus === 409 || error.providerStatus === 412)) return { status: "conflict", reason: "provider-mismatch" };
    return { status: "uncertain" };
  }
}
__name(reschedulePublicGoogleBookingForScope, "reschedulePublicGoogleBookingForScope");
async function recoverPublicGoogleCancellationForScope(input, env, providerFetch) {
  if (!validPublicGoogleCancellationCommand(input)) return { status: "uncertain" };
  try {
    if (!await verifiedPublicGoogleManagementCommit(env, input)) return { status: "uncertain" };
    const target = await publicGoogleManagementTarget(env, input);
    if (!target) return { status: "uncertain" };
    const leaseToken = crypto.randomUUID();
    const acquired = await acquirePublicGoogleManagementLocks(
      env,
      input.scope,
      [input.destinationCalendarId],
      leaseToken
    );
    if (!acquired) return { status: "uncertain" };
    try {
      const { secret } = await authorizedToken(
        env,
        connectionFromSyncTarget(target),
        providerFetch
      );
      const lookup = await getGoogleManagedEvent(
        target,
        input.providerEventId,
        secret.accessToken,
        providerFetch
      );
      if (lookup.status === "absent") {
        await stageCancelledPublicGoogleBooking(env, target, input.providerEventId);
        return { status: "committed", receipt: publicGoogleManagementReceipt(input) };
      }
      if (lookup.event.status === "cancelled") {
        if (lookup.event.id !== input.providerEventId || googleCommitHash(lookup.event) !== input.originalCommitHash) return { status: "uncertain" };
        await stageCancelledPublicGoogleBooking(env, target, input.providerEventId);
        return { status: "committed", receipt: publicGoogleManagementReceipt(input) };
      }
      return verifiedManagedGoogleEvent(lookup.event, input, input.destinationCalendarId) ? { status: "absent" } : { status: "uncertain" };
    } finally {
      await releasePublicGoogleManagementLocks(env, input.scope, acquired, leaseToken);
    }
  } catch {
    return { status: "uncertain" };
  }
}
__name(recoverPublicGoogleCancellationForScope, "recoverPublicGoogleCancellationForScope");
async function recoverPublicGoogleRescheduleForScope(input, env, providerFetch) {
  if (!validPublicGoogleRescheduleCommand(input) || input.bookingStatus !== "confirmed") {
    return { status: "uncertain" };
  }
  try {
    if (!await verifiedPublicGoogleManagementCommit(env, {
      scope: input.scope,
      destinationCalendarId: input.destinationCalendarId,
      providerEventId: input.providerEventId,
      providerOperationId: input.providerOperationId,
      originalCommitHash: input.originalCommitHash,
      bookingStatus: input.bookingStatus
    })) return { status: "uncertain" };
    const target = await publicGoogleManagementTarget(env, input);
    if (!target) return { status: "uncertain" };
    const leaseToken = crypto.randomUUID();
    const acquired = await acquirePublicGoogleManagementLocks(
      env,
      input.scope,
      input.conflictCalendarIds,
      leaseToken
    );
    if (!acquired) return { status: "uncertain" };
    try {
      const { secret } = await authorizedToken(
        env,
        connectionFromSyncTarget(target),
        providerFetch
      );
      const lookup = await getGoogleManagedEvent(
        target,
        input.providerEventId,
        secret.accessToken,
        providerFetch
      );
      if (lookup.status === "absent") return { status: "uncertain" };
      if (rescheduleAlreadyCommitted(lookup.event, input)) {
        await stageRescheduledPublicGoogleBooking(env, target, lookup.event);
        return { status: "committed", receipt: publicGoogleRescheduleReceipt(input) };
      }
      if (googleRescheduleHash(lookup.event) === input.rescheduleHash) {
        return { status: "uncertain" };
      }
      return verifiedManagedGoogleEvent(
        lookup.event,
        {
          providerEventId: input.providerEventId,
          originalCommitHash: input.originalCommitHash,
          timeMin: input.originalTimeMin,
          timeMax: input.originalTimeMax
        },
        input.destinationCalendarId
      ) ? { status: "absent" } : { status: "uncertain" };
    } finally {
      await releasePublicGoogleManagementLocks(env, input.scope, acquired, leaseToken);
    }
  } catch {
    return { status: "uncertain" };
  }
}
__name(recoverPublicGoogleRescheduleForScope, "recoverPublicGoogleRescheduleForScope");
function createGatewayPublicBookingManagementProvider(env, providerFetch, options) {
  return createPublicGoogleBookingManagementProvider({
    cancel: /* @__PURE__ */ __name((command) => cancelPublicGoogleBookingForScope(command, env, providerFetch), "cancel"),
    recoverCancellation: /* @__PURE__ */ __name((command) => recoverPublicGoogleCancellationForScope(command, env, providerFetch), "recoverCancellation"),
    reschedule: /* @__PURE__ */ __name((command) => reschedulePublicGoogleBookingForScope(
      command,
      env,
      providerFetch,
      options.assertRescheduleStillAuthorized
    ), "reschedule"),
    recoverReschedule: /* @__PURE__ */ __name((command) => recoverPublicGoogleRescheduleForScope(command, env, providerFetch), "recoverReschedule")
  });
}
__name(createGatewayPublicBookingManagementProvider, "createGatewayPublicBookingManagementProvider");
function providerBookingResolutionInput(body) {
  if (body.decision !== "approve" && body.decision !== "decline") {
    throw new ApiError(400, "invalid_resolution", "decision must be approve or decline.");
  }
  if (!Array.isArray(body.attendeeEmails ?? [])) {
    throw new ApiError(400, "invalid_attendees", "attendeeEmails must be an array.");
  }
  const attendeeValues = body.attendeeEmails ?? [];
  if (attendeeValues.length > MAX_BOOKING_ATTENDEES) {
    throw new ApiError(
      400,
      "invalid_attendees",
      `Choose at most ${MAX_BOOKING_ATTENDEES} attendees.`
    );
  }
  const attendeeEmails = attendeeValues.map((value, index) => {
    const email = requiredText3(value, `attendeeEmails[${index}]`, 320).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
      throw new ApiError(400, "invalid_attendees", `attendeeEmails[${index}] is invalid.`);
    }
    return email;
  });
  if (new Set(attendeeEmails).size !== attendeeEmails.length) {
    throw new ApiError(400, "invalid_attendees", "Attendee emails must be unique.");
  }
  const conferenceProvider = body.conferenceProvider ?? "none";
  if (conferenceProvider !== "none" && conferenceProvider !== "google-meet") {
    throw new ApiError(
      400,
      "unsupported_conference_provider",
      "conferenceProvider must be none or google-meet for a Google destination."
    );
  }
  if (body.decision === "decline" && (attendeeEmails.length > 0 || conferenceProvider !== "none")) {
    throw new ApiError(
      400,
      "invalid_resolution",
      "A declined hold cannot invite attendees or create a conference."
    );
  }
  const currentConflictValues = body.conflictCalendarIds ?? [];
  if (!Array.isArray(currentConflictValues) || currentConflictValues.length > MAX_EVENT_QUERY_CALENDARS || body.decision === "approve" && currentConflictValues.length === 0) {
    throw new ApiError(
      400,
      "invalid_calendar_ids",
      `Approve with between 1 and ${MAX_EVENT_QUERY_CALENDARS} current conflict calendars.`
    );
  }
  const currentConflictCalendarIds = currentConflictValues.map(
    (value, index) => identifier2(value, `conflictCalendarIds[${index}]`)
  );
  if (new Set(currentConflictCalendarIds).size !== currentConflictCalendarIds.length) {
    throw new ApiError(400, "invalid_calendar_ids", "Conflict calendar identifiers must be unique.");
  }
  return {
    idempotencyKey: identifier2(body.idempotencyKey, "idempotencyKey"),
    decision: body.decision,
    title: optionalCommitText(body.title, "title", 255),
    description: optionalCommitText(body.description, "description", 4e3),
    location: optionalCommitText(body.location, "location", 1024),
    attendeeEmails,
    attendeeEmailsProvided: body.attendeeEmails !== void 0,
    conferenceProvider,
    currentConflictCalendarIds
  };
}
__name(providerBookingResolutionInput, "providerBookingResolutionInput");
var googleResolutionHash = /* @__PURE__ */ __name((value) => {
  const extended = isRecord9(value.extendedProperties) ? value.extendedProperties : null;
  const privateValues = extended && isRecord9(extended.private) ? extended.private : null;
  return privateValues && typeof privateValues.tapResolutionHash === "string" ? privateValues.tapResolutionHash : null;
}, "googleResolutionHash");
async function patchGoogleApprovedHold(target, original, current, input, requestHash, accessToken, providerFetch) {
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(target.provider_calendar_id)}/events/${encodeURIComponent(original.provider_event_id)}`
  );
  url.searchParams.set("sendUpdates", input.attendeeEmails.length > 0 ? "all" : "none");
  url.searchParams.set("maxAttendees", String(MAX_EVENT_ATTENDEES));
  url.searchParams.set("fields", GOOGLE_COMMITTED_EVENT_FIELDS);
  if (input.conferenceProvider === "google-meet") {
    url.searchParams.set("conferenceDataVersion", "1");
  }
  const currentTitle = typeof current.summary === "string" ? current.summary.replace(/^Pending approval:\s*/u, "").trim() : "Approved meeting";
  const body = {
    summary: input.title ?? (currentTitle || "Approved meeting"),
    status: "confirmed",
    transparency: "opaque",
    attendees: input.attendeeEmails.map((email) => ({ email })),
    extendedProperties: {
      private: {
        tapCommitHash: original.request_hash,
        tapBookingKind: "meeting",
        tapResolutionHash: requestHash
      }
    }
  };
  if (input.description !== null) body.description = input.description;
  if (input.location !== null) body.location = input.location;
  if (input.conferenceProvider === "google-meet") {
    body.conferenceData = {
      createRequest: {
        requestId: `${original.provider_event_id}a`,
        conferenceSolutionKey: { type: "hangoutsMeet" }
      }
    };
  }
  return externalJson(
    url.href,
    {
      method: "PATCH",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    },
    providerFetch
  );
}
__name(patchGoogleApprovedHold, "patchGoogleApprovedHold");
async function deleteGoogleApprovalHold(target, providerEventId, accessToken, providerFetch) {
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(target.provider_calendar_id)}/events/${encodeURIComponent(providerEventId)}`
  );
  url.searchParams.set("sendUpdates", "none");
  const response = await providerFetch(url.href, {
    method: "DELETE",
    headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` }
  });
  if (response.ok || response.status === 404 || response.status === 410) return;
  let message2 = `Provider request failed with HTTP ${response.status}.`;
  try {
    const value = await response.json();
    if (isRecord9(value) && isRecord9(value.error) && typeof value.error.message === "string") {
      message2 = value.error.message;
    }
  } catch {
  }
  throw new ProviderHttpError(response.status, message2.slice(0, 500));
}
__name(deleteGoogleApprovalHold, "deleteGoogleApprovalHold");
function storedBookingConflictRange(original) {
  if (!original.conflict_calendar_ids_json || !original.start_at || !original.end_at) {
    throw new ApiError(
      409,
      "booking_conflict_set_missing",
      "This approval hold predates stored conflict-set validation and cannot be approved safely."
    );
  }
  let calendarIds;
  try {
    calendarIds = JSON.parse(original.conflict_calendar_ids_json);
  } catch {
    throw new ApiError(409, "booking_conflict_set_invalid", "The stored conflict set is invalid.");
  }
  const range = eventQueryInput({
    timeMin: original.start_at,
    timeMax: original.end_at,
    calendarIds
  });
  if (!range.calendarIds.includes(original.destination_calendar_id)) {
    throw new ApiError(
      409,
      "booking_conflict_set_invalid",
      "The stored conflict set does not include the destination calendar."
    );
  }
  const sorted = [...range.calendarIds].sort();
  if (!range.calendarIds.every((calendarId, index) => calendarId === sorted[index])) {
    throw new ApiError(
      409,
      "booking_conflict_set_invalid",
      "The stored conflict set is not in canonical order."
    );
  }
  if (!original.request_json) return range;
  const request = parsedRecord(original.request_json);
  if (!request) {
    throw new ApiError(
      409,
      "booking_conflict_set_invalid",
      "The stored booking request is invalid."
    );
  }
  const hasConflictTimeMin = request.conflictTimeMin !== void 0;
  const hasConflictTimeMax = request.conflictTimeMax !== void 0;
  if (!hasConflictTimeMin && !hasConflictTimeMax) return range;
  if (hasConflictTimeMin !== hasConflictTimeMax) {
    throw new ApiError(
      409,
      "booking_conflict_set_invalid",
      "The stored conflict validation range is incomplete."
    );
  }
  let conflictRange;
  try {
    conflictRange = eventQueryInput({
      timeMin: request.conflictTimeMin,
      timeMax: request.conflictTimeMax,
      calendarIds: range.calendarIds
    });
  } catch {
    throw new ApiError(
      409,
      "booking_conflict_set_invalid",
      "The stored conflict validation range is invalid."
    );
  }
  if (Date.parse(conflictRange.timeMin) > Date.parse(range.timeMin) || Date.parse(conflictRange.timeMax) < Date.parse(range.timeMax)) {
    throw new ApiError(
      409,
      "booking_conflict_set_invalid",
      "The stored conflict validation range does not contain the booking."
    );
  }
  return conflictRange;
}
__name(storedBookingConflictRange, "storedBookingConflictRange");
function storedPendingAttendeeEmails(responseJson) {
  let parsed;
  try {
    parsed = JSON.parse(responseJson);
  } catch {
    throw new ApiError(409, "booking_projection_invalid", "The stored booking projection is invalid.");
  }
  const booking = isRecord9(parsed) && isRecord9(parsed.booking) ? parsed.booking : null;
  const values = booking?.pendingAttendeeEmails ?? [];
  if (!Array.isArray(values) || values.length > MAX_BOOKING_ATTENDEES) {
    throw new ApiError(
      409,
      "booking_projection_invalid",
      "The stored pending attendee set is invalid."
    );
  }
  const emails = values.map((value, index) => {
    if (typeof value !== "string" || value.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)) {
      throw new ApiError(
        409,
        "booking_projection_invalid",
        `Stored pending attendee ${index + 1} is invalid.`
      );
    }
    return value.toLowerCase();
  });
  if (new Set(emails).size !== emails.length) {
    throw new ApiError(
      409,
      "booking_projection_invalid",
      "The stored pending attendee set contains duplicates."
    );
  }
  return emails;
}
__name(storedPendingAttendeeEmails, "storedPendingAttendeeEmails");
async function resolveGoogleApprovalHold(request, env, bookingIdempotencyKey, providerFetch) {
  const { workspace, principal } = await principalScope(request, env);
  let resolutionLifecycleAt = Date.now();
  let input = providerBookingResolutionInput(await readJson(request));
  const original = await env.CALENDAR_DB.prepare(
    `SELECT request_hash, destination_calendar_id, provider_event_id, booking_kind,
            start_at, end_at, state, response_json, resolution_status,
            conflict_calendar_ids_json, hold_expires_at, hold_expired_at, request_json
       FROM provider_booking_commits
      WHERE workspace_id = ? AND principal_id = ? AND idempotency_key = ?`
  ).bind(workspace, principal, bookingIdempotencyKey).first();
  if (!original || original.state !== "committed" || !original.response_json) {
    throw new ApiError(404, "booking_not_found", "The committed booking was not found.");
  }
  if (original.booking_kind !== "approval-hold") {
    throw new ApiError(409, "booking_not_approval_hold", "Only an approval hold can be resolved.");
  }
  if (!input.attendeeEmailsProvided && input.decision === "approve") {
    input = {
      ...input,
      attendeeEmails: storedPendingAttendeeEmails(original.response_json)
    };
  }
  const approvalConflictRange = input.decision === "approve" ? (() => {
    const storedConflictRange = storedBookingConflictRange(original);
    const calendarIds = [.../* @__PURE__ */ new Set([
      ...storedConflictRange.calendarIds,
      ...input.currentConflictCalendarIds
    ])].sort();
    if (calendarIds.length > MAX_EVENT_QUERY_CALENDARS) {
      throw new ApiError(
        400,
        "invalid_calendar_ids",
        `The stored/current conflict union may contain at most ${MAX_EVENT_QUERY_CALENDARS} calendars.`
      );
    }
    return {
      ...storedConflictRange,
      calendarIds
    };
  })() : null;
  const canonical = {
    bookingIdempotencyKey,
    resolutionIdempotencyKey: input.idempotencyKey,
    decision: input.decision,
    title: input.title,
    description: input.description,
    location: input.location,
    attendeeEmails: [...input.attendeeEmails].sort(),
    conferenceProvider: input.conferenceProvider,
    currentConflictCalendarIds: [...input.currentConflictCalendarIds].sort()
  };
  const requestHash = await sha2563(JSON.stringify(canonical));
  const resolution = await env.CALENDAR_DB.prepare(
    `SELECT request_hash, decision, state, response_json, created_at
       FROM provider_booking_resolutions
      WHERE workspace_id = ? AND principal_id = ? AND booking_idempotency_key = ?`
  ).bind(workspace, principal, bookingIdempotencyKey).first();
  if (resolution) {
    const createdAt = Date.parse(resolution.created_at);
    if (Number.isFinite(createdAt)) resolutionLifecycleAt = createdAt;
  }
  if (resolution && resolution.request_hash !== requestHash) {
    throw new ApiError(
      409,
      "approval_already_resolved",
      "This approval hold already has a different resolution."
    );
  }
  if (resolution?.state === "committed" && resolution.response_json) {
    const stored = JSON.parse(resolution.response_json);
    await reconcilePublicApprovalResolution(
      env,
      { workspace, principal },
      bookingIdempotencyKey,
      resolution.decision === "approve" ? "confirmed" : "declined",
      resolutionLifecycleAt
    );
    return json({ ...isRecord9(stored) ? stored : {}, idempotentReplay: true });
  }
  if (!resolution) {
    const reusedKey = await env.CALENDAR_DB.prepare(
      `SELECT booking_idempotency_key
         FROM provider_booking_resolutions
        WHERE workspace_id = ? AND principal_id = ? AND resolution_idempotency_key = ?`
    ).bind(workspace, principal, input.idempotencyKey).first("booking_idempotency_key");
    if (reusedKey) {
      throw new ApiError(
        409,
        "resolution_idempotency_key_reused",
        "This resolution idempotency key was already used for another booking."
      );
    }
  }
  if (!resolution && input.decision === "approve" && (original.hold_expired_at || !original.hold_expires_at || Date.parse(original.hold_expires_at) <= Date.now())) {
    throw new ApiError(410, "approval_hold_expired", "This approval hold has expired.");
  }
  const resolutionCalendarIds = input.decision === "approve" ? approvalConflictRange.calendarIds : [original.destination_calendar_id];
  const targets = await loadCalendarSyncTargets(
    env,
    workspace,
    principal,
    resolutionCalendarIds
  );
  if (targets.length !== resolutionCalendarIds.length) {
    throw new ApiError(
      409,
      "booking_conflict_set_invalid",
      "A stored conflict calendar is no longer connected."
    );
  }
  const target = targets.find((candidate) => candidate.id === original.destination_calendar_id);
  if (!target || target.provider !== "google" || target.mode !== "oauth" || target.writable !== 1 || target.role === "free-busy") {
    throw new ApiError(409, "destination_not_writable", "The Google destination is not writable.");
  }
  const leaseToken = crypto.randomUUID();
  const resolutionLockIds = input.decision === "approve" ? [...approvalConflictRange.calendarIds] : [target.id];
  const acquiredCalendarIds = [];
  for (const calendarId of resolutionLockIds) {
    if (await acquireBookingCommitLock(
      env,
      workspace,
      principal,
      calendarId,
      leaseToken
    )) {
      acquiredCalendarIds.push(calendarId);
      continue;
    }
    await Promise.allSettled(acquiredCalendarIds.map(
      (acquiredCalendarId) => releaseBookingCommitLock(env, workspace, principal, acquiredCalendarId, leaseToken)
    ));
    throw new ApiError(
      409,
      "booking_commit_in_progress",
      "A conflict calendar has another TAP booking commit in progress. Retry shortly."
    );
  }
  let pendingCreatedThisAttempt = false;
  let providerMutationMayHaveOccurred = false;
  const ensurePendingResolution = /* @__PURE__ */ __name(async () => {
    if (resolution) return;
    const createdAt = (/* @__PURE__ */ new Date()).toISOString();
    resolutionLifecycleAt = Date.parse(createdAt);
    const inserted = await env.CALENDAR_DB.prepare(
      `INSERT OR IGNORE INTO provider_booking_resolutions
        (workspace_id, principal_id, booking_idempotency_key, resolution_idempotency_key, request_hash,
         decision, state, response_json, last_error_code, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, ?)`
    ).bind(
      workspace,
      principal,
      bookingIdempotencyKey,
      input.idempotencyKey,
      requestHash,
      input.decision,
      createdAt,
      createdAt
    ).run();
    pendingCreatedThisAttempt = Number(inserted.meta.changes ?? 0) === 1;
    if (!pendingCreatedThisAttempt) {
      throw new ApiError(
        409,
        "approval_already_resolved",
        "This approval hold acquired another resolution while waiting for its lock."
      );
    }
  }, "ensurePendingResolution");
  try {
    const { secret } = await authorizedToken(env, connectionFromSyncTarget(target), providerFetch);
    let providerEvent = await getGoogleCommittedEvent(
      target,
      original.provider_event_id,
      secret.accessToken,
      providerFetch
    );
    if (providerEvent && googleCommitHash(providerEvent) !== original.request_hash) {
      throw new ApiError(
        409,
        "provider_event_id_collision",
        "The Google event no longer has TAP's original commit proof."
      );
    }
    if (input.decision === "approve") {
      if (!providerEvent) {
        const removedAt = (/* @__PURE__ */ new Date()).toISOString();
        const expired = await env.CALENDAR_DB.prepare(
          `UPDATE provider_booking_commits
              SET hold_expired_at = ?, updated_at = ?
            WHERE workspace_id = ? AND principal_id = ? AND idempotency_key = ?
              AND request_hash = ? AND provider_event_id = ?
              AND booking_kind = 'approval-hold' AND state = 'committed'
              AND resolution_status IS NULL AND hold_expired_at IS NULL`
        ).bind(
          removedAt,
          removedAt,
          workspace,
          principal,
          bookingIdempotencyKey,
          original.request_hash,
          original.provider_event_id
        ).run();
        if (Number(expired.meta.changes ?? 0) === 0) {
          const current = await env.CALENDAR_DB.prepare(
            `SELECT resolution_status, hold_expired_at
               FROM provider_booking_commits
              WHERE workspace_id = ? AND principal_id = ? AND idempotency_key = ?`
          ).bind(workspace, principal, bookingIdempotencyKey).first();
          if (current?.resolution_status) {
            throw new ApiError(
              409,
              "approval_already_resolved",
              "This approval hold was resolved while its provider state was checked."
            );
          }
          if (current?.hold_expired_at) {
            throw new ApiError(
              410,
              "approval_hold_expired",
              "This approval hold has expired."
            );
          }
          throw new ApiError(
            502,
            "provider_resolution_uncertain",
            "The missing Google approval hold could not be recorded durably. Retry with the same idempotency key."
          );
        }
        try {
          await stageBookingCacheMutation(env, target, {
            providerEventId: original.provider_event_id,
            eventId: googleEventId("event", target.id, original.provider_event_id),
            start: null,
            end: null,
            tombstoned: true,
            payload: { id: original.provider_event_id, status: "cancelled" },
            providerUpdatedAt: removedAt
          });
        } catch (error) {
          logCalendarSync("warn", "missing approval hold cache tombstone failed", {
            workspace_id: workspace,
            connection_id: target.connection_id,
            calendar_id: target.id,
            booking_idempotency_key: bookingIdempotencyKey,
            provider_event_id: original.provider_event_id,
            error: error instanceof Error ? error.message : "unknown error"
          });
          try {
            await env.CALENDAR_DB.prepare(
              `UPDATE calendar_sync_state SET next_sync_at = ?
                WHERE workspace_id = ? AND connection_id = ? AND calendar_id = ?`
            ).bind(removedAt, workspace, target.connection_id, target.id).run();
          } catch {
          }
        }
        throw new ApiError(409, "approval_hold_missing", "The Google approval hold no longer exists.");
      }
      if (googleResolutionHash(providerEvent) !== requestHash) {
        const tapOverlap = await env.CALENDAR_DB.prepare(
          `SELECT idempotency_key
             FROM provider_booking_commits
            WHERE workspace_id = ? AND principal_id = ?
              AND destination_calendar_id IN (${approvalConflictRange.calendarIds.map(() => "?").join(", ")})
              AND state IN ('pending', 'committed')
              AND (booking_kind <> 'approval-hold' OR resolution_status IS NULL OR resolution_status <> 'declined')
              AND (booking_kind <> 'approval-hold' OR hold_expired_at IS NULL)
              AND idempotency_key <> ?
              AND start_at < ? AND end_at > ?
            LIMIT 1`
        ).bind(
          workspace,
          principal,
          ...approvalConflictRange.calendarIds,
          bookingIdempotencyKey,
          approvalConflictRange.timeMax,
          approvalConflictRange.timeMin
        ).first();
        if (tapOverlap) {
          throw new ApiError(409, "slot_conflict", "That time is no longer available.");
        }
        const validation = await strictLiveAvailability(
          request,
          env,
          approvalConflictRange,
          providerFetch,
          /* @__PURE__ */ new Set([googleEventId("event", target.id, original.provider_event_id)])
        );
        if (!validation.conclusive) {
          throw new ApiError(
            503,
            "live_availability_unavailable",
            "Every stored conflict calendar must be checked live before approving this hold."
          );
        }
        if (!validation.available) {
          throw new ApiError(409, "slot_conflict", "That time is no longer available.");
        }
        await ensurePendingResolution();
        providerMutationMayHaveOccurred = true;
        providerEvent = await patchGoogleApprovedHold(
          target,
          original,
          providerEvent,
          input,
          requestHash,
          secret.accessToken,
          providerFetch
        );
      } else {
        await ensurePendingResolution();
      }
      if (googleCommitHash(providerEvent) !== original.request_hash || googleResolutionHash(providerEvent) !== requestHash) {
        throw new ApiError(
          502,
          "provider_resolution_unverified",
          "Google did not return TAP's approval proof."
        );
      }
    } else {
      await ensurePendingResolution();
      if (providerEvent) {
        providerMutationMayHaveOccurred = true;
        await deleteGoogleApprovalHold(
          target,
          original.provider_event_id,
          secret.accessToken,
          providerFetch
        );
        providerEvent = null;
      }
    }
    const resolvedEvent = providerEvent ? normalizeGoogleCalendarEvent(providerEvent, target.id) : null;
    if (providerEvent && !resolvedEvent) {
      throw new ApiError(502, "provider_event_invalid", "Google returned an invalid approved event.");
    }
    const response = {
      resolution: {
        state: "committed",
        decision: input.decision === "approve" ? "approved" : "declined",
        bookingIdempotencyKey,
        providerEventId: original.provider_event_id,
        providerEventRemoved: input.decision === "decline",
        providerJoinUrl: providerEvent ? googleMeetJoinUrl(providerEvent) : null,
        event: resolvedEvent ? { ...resolvedEvent, kind: "meeting", status: "confirmed" } : null
      },
      resolvedAt: (/* @__PURE__ */ new Date()).toISOString(),
      idempotentReplay: false
    };
    await env.CALENDAR_DB.batch([
      env.CALENDAR_DB.prepare(
        `UPDATE provider_booking_resolutions
            SET state = 'committed', response_json = ?, last_error_code = NULL, updated_at = ?
          WHERE workspace_id = ? AND principal_id = ? AND booking_idempotency_key = ?`
      ).bind(
        JSON.stringify(response),
        (/* @__PURE__ */ new Date()).toISOString(),
        workspace,
        principal,
        bookingIdempotencyKey
      ),
      env.CALENDAR_DB.prepare(
        `UPDATE provider_booking_commits
            SET resolution_status = ?, updated_at = ?
          WHERE workspace_id = ? AND principal_id = ? AND idempotency_key = ?`
      ).bind(
        input.decision === "approve" ? "approved" : "declined",
        (/* @__PURE__ */ new Date()).toISOString(),
        workspace,
        principal,
        bookingIdempotencyKey
      )
    ]);
    await reconcilePublicApprovalResolution(
      env,
      { workspace, principal },
      bookingIdempotencyKey,
      input.decision === "approve" ? "confirmed" : "declined",
      resolutionLifecycleAt
    );
    try {
      if (providerEvent) {
        const event = resolvedEvent;
        if (!event) throw new Error("approved provider event is invalid");
        await stageBookingCacheMutation(env, target, {
          providerEventId: original.provider_event_id,
          eventId: event.id,
          start: event.start,
          end: event.end,
          tombstoned: false,
          payload: { ...event, kind: "meeting", status: "confirmed" },
          providerUpdatedAt: typeof providerEvent.updated === "string" ? new Date(providerEvent.updated).toISOString() : null
        });
      } else {
        await stageBookingCacheMutation(env, target, {
          providerEventId: original.provider_event_id,
          eventId: googleEventId("event", target.id, original.provider_event_id),
          start: null,
          end: null,
          tombstoned: true,
          payload: { id: original.provider_event_id, status: "cancelled" },
          providerUpdatedAt: (/* @__PURE__ */ new Date()).toISOString()
        });
      }
    } catch (error) {
      logCalendarSync("warn", "resolved booking cache staging failed", {
        workspace_id: workspace,
        connection_id: target.connection_id,
        calendar_id: target.id,
        provider_event_id: original.provider_event_id,
        error: error instanceof Error ? error.message : "unknown error"
      });
      try {
        await env.CALENDAR_DB.prepare(
          `UPDATE calendar_sync_state SET next_sync_at = ?
            WHERE workspace_id = ? AND connection_id = ? AND calendar_id = ?`
        ).bind((/* @__PURE__ */ new Date()).toISOString(), workspace, target.connection_id, target.id).run();
      } catch {
      }
    }
    return json(response);
  } catch (error) {
    if (pendingCreatedThisAttempt && !providerMutationMayHaveOccurred) {
      await env.CALENDAR_DB.prepare(
        `DELETE FROM provider_booking_resolutions
          WHERE workspace_id = ? AND principal_id = ? AND booking_idempotency_key = ?
            AND request_hash = ? AND state = 'pending'`
      ).bind(workspace, principal, bookingIdempotencyKey, requestHash).run();
    }
    if (!(error instanceof ApiError && [400, 409].includes(error.status))) {
      await env.CALENDAR_DB.prepare(
        `UPDATE provider_booking_resolutions
            SET last_error_code = ?, updated_at = ?
          WHERE workspace_id = ? AND principal_id = ?
            AND booking_idempotency_key = ? AND state = 'pending'`
      ).bind(
        error instanceof ApiError ? error.code : "provider_resolution_uncertain",
        (/* @__PURE__ */ new Date()).toISOString(),
        workspace,
        principal,
        bookingIdempotencyKey
      ).run();
    }
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      502,
      "provider_resolution_uncertain",
      "Google did not confirm the approval resolution. Retry with the same idempotency key."
    );
  } finally {
    const releases = await Promise.allSettled(acquiredCalendarIds.map(
      (calendarId) => releaseBookingCommitLock(env, workspace, principal, calendarId, leaseToken)
    ));
    releases.forEach((release, index) => {
      if (release.status !== "rejected") return;
      logCalendarSync("warn", "approval resolution lock release failed", {
        workspace_id: workspace,
        calendar_id: acquiredCalendarIds[index],
        error: release.reason instanceof Error ? release.reason.message : "unknown error"
      });
    });
  }
}
__name(resolveGoogleApprovalHold, "resolveGoogleApprovalHold");
async function handleGoogleCalendarWebhook(request, env, executionContext, providerFetch) {
  const channelId = requiredText3(request.headers.get("X-Goog-Channel-ID"), "channel id", 64);
  const channelToken = requiredText3(
    request.headers.get("X-Goog-Channel-Token"),
    "channel token",
    512
  );
  const resourceId = requiredText3(
    request.headers.get("X-Goog-Resource-ID"),
    "resource id",
    2048
  );
  const resourceState = requiredText3(
    request.headers.get("X-Goog-Resource-State"),
    "resource state",
    32
  );
  if (!["sync", "exists", "not_exists"].includes(resourceState)) {
    throw new ApiError(400, "invalid_webhook", "The Google notification state is invalid.");
  }
  const channel = await env.CALENDAR_DB.prepare(
    `SELECT calendar_watch_channels.channel_id,
            calendar_watch_channels.workspace_id,
            calendar_watch_channels.connection_id,
            calendar_watch_channels.calendar_id,
            calendar_watch_channels.token_hash,
            calendar_watch_channels.resource_id,
            calendar_watch_channels.expiration_at,
            calendar_connections.principal_id
       FROM calendar_watch_channels
       INNER JOIN calendar_connections
         ON calendar_connections.id = calendar_watch_channels.connection_id
      WHERE calendar_watch_channels.channel_id = ?
        AND calendar_watch_channels.expiration_at > ?
        AND calendar_connections.principal_id IS NOT NULL`
  ).bind(channelId, (/* @__PURE__ */ new Date()).toISOString()).first();
  let tokenMatches = false;
  try {
    tokenMatches = Boolean(channel) && channel.resource_id === resourceId && await secureTokenMatches(channelToken, channel.token_hash);
  } catch {
    tokenMatches = false;
  }
  if (!channel || !tokenMatches) {
    throw new ApiError(403, "webhook_denied", "The Google notification channel is invalid.");
  }
  const notifiedAt = (/* @__PURE__ */ new Date()).toISOString();
  await env.CALENDAR_DB.batch([
    env.CALENDAR_DB.prepare(
      "UPDATE calendar_watch_channels SET last_notification_at = ? WHERE channel_id = ?"
    ).bind(notifiedAt, channelId),
    env.CALENDAR_DB.prepare(
      `UPDATE calendar_sync_state
          SET last_notification_at = ?, next_sync_at = ?
        WHERE workspace_id = ? AND connection_id = ? AND calendar_id = ?`
    ).bind(
      notifiedAt,
      notifiedAt,
      channel.workspace_id,
      channel.connection_id,
      channel.calendar_id
    )
  ]);
  const target = (await loadCalendarSyncTargets(
    env,
    channel.workspace_id,
    channel.principal_id,
    [channel.calendar_id]
  ))[0];
  if (!target) {
    throw new ApiError(410, "calendar_removed", "The watched calendar no longer exists.");
  }
  const synchronization = syncGoogleCalendarCache(
    env,
    target,
    providerFetch,
    cacheSyncInvocation()
  ).then(() => void 0);
  if (executionContext) executionContext.waitUntil(synchronization);
  else await synchronization;
  return new Response(null, { status: 202 });
}
__name(handleGoogleCalendarWebhook, "handleGoogleCalendarWebhook");
async function repairCalendarCaches(env, providerFetch) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const renewBefore = new Date(Date.now() + WATCH_RENEWAL_WINDOW_MS).toISOString();
  const due = (await env.CALENDAR_DB.prepare(
    `SELECT calendar_sync_state.workspace_id, calendar_sync_state.calendar_id,
            calendar_connections.principal_id
       FROM calendar_sync_state
       INNER JOIN provider_calendars
         ON provider_calendars.id = calendar_sync_state.calendar_id
       INNER JOIN calendar_connections
         ON calendar_connections.id = calendar_sync_state.connection_id
      WHERE calendar_connections.provider = 'google'
        AND calendar_connections.mode = 'oauth'
        AND calendar_connections.principal_id IS NOT NULL
        AND provider_calendars.role <> 'free-busy'
        AND (calendar_sync_state.lease_until IS NULL OR calendar_sync_state.lease_until <= ?)
        AND (
          calendar_sync_state.last_success_at IS NULL
          OR calendar_sync_state.next_sync_at <= ?
          OR (calendar_sync_state.watch_expiration_at IS NOT NULL
              AND calendar_sync_state.watch_expiration_at <= ?)
        )
      ORDER BY calendar_sync_state.next_sync_at,
               COALESCE(calendar_sync_state.last_attempt_at, ''),
               calendar_sync_state.calendar_id
      LIMIT ?`
  ).bind(now, now, renewBefore, CACHE_REPAIR_BATCH_SIZE).all()).results;
  let succeeded = 0;
  const syncInvocation = cacheSyncInvocation();
  for (const item of due) {
    const target = (await loadCalendarSyncTargets(
      env,
      item.workspace_id,
      item.principal_id,
      [item.calendar_id]
    ))[0];
    if (!target) continue;
    const outcome = await syncGoogleCalendarCache(env, target, providerFetch, syncInvocation);
    if (outcome.synced) succeeded += 1;
  }
  logCalendarSync("info", "calendar cache repair completed", {
    selected: due.length,
    succeeded,
    batch_limit: CACHE_REPAIR_BATCH_SIZE
  });
}
__name(repairCalendarCaches, "repairCalendarCaches");
async function expireApprovalHolds(env, providerFetch) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const holds = (await env.CALENDAR_DB.prepare(
    `SELECT workspace_id, principal_id, idempotency_key, request_hash, destination_calendar_id,
            provider_event_id, booking_kind, start_at, end_at, state, response_json,
            resolution_status, conflict_calendar_ids_json, hold_expires_at, hold_expired_at
       FROM provider_booking_commits
      WHERE booking_kind = 'approval-hold'
        AND principal_id IS NOT NULL
        AND state = 'committed'
        AND resolution_status IS NULL
        AND hold_expired_at IS NULL
        AND hold_expires_at IS NOT NULL
        AND hold_expires_at <= ?
        AND NOT EXISTS (
          SELECT 1 FROM provider_booking_resolutions
           WHERE provider_booking_resolutions.workspace_id = provider_booking_commits.workspace_id
             AND provider_booking_resolutions.principal_id = provider_booking_commits.principal_id
             AND provider_booking_resolutions.booking_idempotency_key =
                 provider_booking_commits.idempotency_key
             AND provider_booking_resolutions.state = 'pending'
        )
      ORDER BY hold_expires_at, workspace_id, idempotency_key
      LIMIT ?`
  ).bind(now, CACHE_REPAIR_BATCH_SIZE).all()).results;
  const authorization = cacheSyncInvocation();
  let expired = 0;
  for (const hold of holds) {
    const target = (await loadCalendarSyncTargets(
      env,
      hold.workspace_id,
      hold.principal_id,
      [hold.destination_calendar_id]
    ))[0];
    if (!target || target.provider !== "google" || target.mode !== "oauth") continue;
    const leaseToken = crypto.randomUUID();
    if (!await acquireBookingCommitLock(
      env,
      hold.workspace_id,
      hold.principal_id,
      target.id,
      leaseToken
    )) continue;
    try {
      const { secret } = await authorizedTokenForCacheSync(
        env,
        target,
        providerFetch,
        authorization
      );
      const providerEvent = await getGoogleCommittedEvent(
        target,
        hold.provider_event_id,
        secret.accessToken,
        providerFetch
      );
      if (providerEvent) {
        const extended = isRecord9(providerEvent.extendedProperties) ? providerEvent.extendedProperties : {};
        const privateValues = isRecord9(extended.private) ? extended.private : {};
        if (googleCommitHash(providerEvent) !== hold.request_hash || privateValues.tapBookingKind !== "approval-hold" || googleResolutionHash(providerEvent)) {
          logCalendarSync("warn", "expired approval hold provider proof changed", {
            workspace_id: hold.workspace_id,
            calendar_id: target.id,
            booking_idempotency_key: hold.idempotency_key
          });
          continue;
        }
        await deleteGoogleApprovalHold(
          target,
          hold.provider_event_id,
          secret.accessToken,
          providerFetch
        );
      }
      const updated = await env.CALENDAR_DB.prepare(
        `UPDATE provider_booking_commits
            SET hold_expired_at = ?, updated_at = ?
          WHERE workspace_id = ? AND principal_id = ? AND idempotency_key = ?
            AND resolution_status IS NULL AND hold_expired_at IS NULL
            AND hold_expires_at <= ?`
      ).bind(
        now,
        now,
        hold.workspace_id,
        hold.principal_id,
        hold.idempotency_key,
        now
      ).run();
      if (Number(updated.meta.changes ?? 0) === 0) continue;
      expired += 1;
      try {
        await stageBookingCacheMutation(env, target, {
          providerEventId: hold.provider_event_id,
          eventId: googleEventId("event", target.id, hold.provider_event_id),
          start: null,
          end: null,
          tombstoned: true,
          payload: { id: hold.provider_event_id, status: "cancelled" },
          providerUpdatedAt: now
        });
      } catch (error) {
        logCalendarSync("warn", "expired approval hold cache tombstone failed", {
          workspace_id: hold.workspace_id,
          calendar_id: target.id,
          booking_idempotency_key: hold.idempotency_key,
          error: error instanceof Error ? error.message : "unknown error"
        });
      }
    } catch (error) {
      logCalendarSync("warn", "approval hold expiration failed", {
        workspace_id: hold.workspace_id,
        calendar_id: target.id,
        booking_idempotency_key: hold.idempotency_key,
        error: error instanceof Error ? error.message : "unknown error"
      });
    } finally {
      try {
        await releaseBookingCommitLock(
          env,
          hold.workspace_id,
          hold.principal_id,
          target.id,
          leaseToken
        );
      } catch {
      }
    }
  }
  logCalendarSync("info", "approval hold expiration completed", {
    selected: holds.length,
    expired,
    batch_limit: CACHE_REPAIR_BATCH_SIZE
  });
}
__name(expireApprovalHolds, "expireApprovalHolds");
var publicBookingNoticeInput = /* @__PURE__ */ __name((row, kind) => ({
  eventKey: `${kind}:${row.booking_reference}`,
  bookingReference: row.booking_reference,
  scope: {
    workspace: row.workspace_id,
    principal: row.principal_id
  },
  kind,
  recipient: {
    name: row.guest_name,
    email: row.guest_email
  },
  organizerName: row.organizer_name,
  eventTitle: row.event_title,
  startsAt: row.start_at,
  endsAt: row.end_at,
  timeZone: row.time_zone
}), "publicBookingNoticeInput");
async function expirePublicBookingManagementApprovals(env) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const due = (await env.CALENDAR_DB.prepare(
    `SELECT booking_reference, workspace_id, principal_id, provider_operation_id,
            booking_status, approval_expires_at, guest_name, guest_email,
            organizer_name, event_title, start_at, end_at, time_zone
       FROM public_booking_management_credentials
      WHERE status = 'active' AND booking_status = 'pending'
        AND approval_expires_at IS NOT NULL AND approval_expires_at <= ?
      ORDER BY approval_expires_at, booking_reference
      LIMIT ?`
  ).bind(now, CACHE_REPAIR_BATCH_SIZE).all()).results;
  const store = new D1PublicBookingManagementStore(env.CALENDAR_DB);
  const outbox = publicBookingEmailOutbox(env);
  let transitioned = 0;
  for (const row of due) {
    try {
      const result = await store.transitionApproval({
        scope: { workspace: row.workspace_id, principal: row.principal_id },
        providerOperationId: row.provider_operation_id,
        targetStatus: "expired"
      });
      if (result.kind !== "transitioned" && result.kind !== "existing") continue;
      await outbox.enqueue(result.notice);
      transitioned += result.kind === "transitioned" ? 1 : 0;
    } catch (error) {
      logCalendarSync("warn", "public approval lifecycle expiration failed", {
        workspace_id: row.workspace_id,
        booking_reference: row.booking_reference,
        error: error instanceof Error ? error.name : "unknown"
      });
    }
  }
  logCalendarSync("info", "public approval lifecycle expiration completed", {
    selected: due.length,
    transitioned,
    batch_limit: CACHE_REPAIR_BATCH_SIZE
  });
}
__name(expirePublicBookingManagementApprovals, "expirePublicBookingManagementApprovals");
async function reconcilePublicBookingEmailNotices(env) {
  const initial = (await env.CALENDAR_DB.prepare(
    `SELECT booking_reference, workspace_id, principal_id, provider_operation_id,
            booking_status, approval_expires_at, guest_name, guest_email,
            organizer_name, event_title, start_at, end_at, time_zone
       FROM public_booking_management_credentials AS credentials
      WHERE NOT EXISTS (
        SELECT 1 FROM public_booking_email_outbox AS notices
         WHERE notices.booking_reference = credentials.booking_reference
           AND notices.event_key =
             (CASE WHEN credentials.approval_expires_at IS NULL
               THEN 'booking-confirmed:' ELSE 'approval-requested:' END) ||
             credentials.booking_reference
      )
      ORDER BY credentials.created_at, credentials.booking_reference
      LIMIT ?`
  ).bind(CACHE_REPAIR_BATCH_SIZE).all()).results;
  const terminal = (await env.CALENDAR_DB.prepare(
    `SELECT booking_reference, workspace_id, principal_id, provider_operation_id,
            booking_status, approval_expires_at, guest_name, guest_email,
            organizer_name, event_title, start_at, end_at, time_zone
       FROM public_booking_management_credentials AS credentials
      WHERE credentials.approval_expires_at IS NOT NULL
        AND credentials.booking_status IN ('confirmed', 'declined', 'expired')
        AND NOT EXISTS (
          SELECT 1 FROM public_booking_email_outbox AS notices
           WHERE notices.booking_reference = credentials.booking_reference
             AND notices.event_key =
               (CASE credentials.booking_status
                 WHEN 'confirmed' THEN 'approval-approved:'
                 WHEN 'declined' THEN 'approval-declined:'
                 ELSE 'approval-expired:' END) || credentials.booking_reference
        )
      ORDER BY credentials.updated_at, credentials.booking_reference
      LIMIT ?`
  ).bind(CACHE_REPAIR_BATCH_SIZE).all()).results;
  const outbox = publicBookingEmailOutbox(env);
  for (const row of initial) {
    const kind = row.approval_expires_at === null ? "booking-confirmed" : "approval-requested";
    await outbox.enqueue(publicBookingNoticeInput(row, kind)).catch(() => void 0);
  }
  for (const row of terminal) {
    const kind = row.booking_status === "confirmed" ? "approval-approved" : row.booking_status === "declined" ? "approval-declined" : "approval-expired";
    await outbox.enqueue(publicBookingNoticeInput(row, kind)).catch(() => void 0);
  }
}
__name(reconcilePublicBookingEmailNotices, "reconcilePublicBookingEmailNotices");
async function deliverPublicBookingEmails(env) {
  const sender = env.EMAIL;
  const fromEmail = env.PUBLIC_BOOKING_EMAIL_FROM?.trim() ?? "";
  const fromName = env.PUBLIC_BOOKING_EMAIL_FROM_NAME?.trim() ?? "";
  const managementSecret = env.PUBLIC_BOOKING_MANAGEMENT_SECRET?.trim() ?? "";
  if (!sender || !fromEmail || !fromName || !managementSecret) {
    logCalendarSync("warn", "public booking email delivery is not configured", {});
    return;
  }
  const summary = await deliverPublicBookingEmailOutboxSafely(
    publicBookingEmailOutbox(env),
    sender,
    {
      managementSecret,
      managementOrigin: publicBookingBaseUrl(env),
      from: { name: fromName, email: fromEmail },
      limit: CACHE_REPAIR_BATCH_SIZE
    }
  );
  logCalendarSync("info", "public booking email delivery completed", {
    claimed: summary.claimed,
    delivered: summary.delivered,
    retried: summary.retried,
    dead_lettered: summary.deadLettered,
    infrastructure_failed: summary.infrastructureFailed
  });
}
__name(deliverPublicBookingEmails, "deliverPublicBookingEmails");
var MCP_PROTOCOL_VERSION = "2025-11-25";
var MCP_MAX_EVENTS = 200;
var MCP_MAX_CONFLICTS = 50;
var mcpTools = [
  {
    name: "list_events",
    description: "List events from TAP Calendar's durable cache for a bounded time range.",
    inputSchema: {
      type: "object",
      properties: {
        timeMin: { type: "string", format: "date-time" },
        timeMax: { type: "string", format: "date-time" },
        calendarIds: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 100 }
      },
      required: ["timeMin", "timeMax", "calendarIds"],
      additionalProperties: false
    }
  },
  {
    name: "find_available_slots",
    description: "Find candidate free slots using the same revisioned TAP Calendar cache.",
    inputSchema: {
      type: "object",
      properties: {
        timeMin: { type: "string", format: "date-time" },
        timeMax: { type: "string", format: "date-time" },
        calendarIds: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 100 },
        durationMinutes: { type: "integer", minimum: 5, maximum: 480 }
      },
      required: ["timeMin", "timeMax", "calendarIds", "durationMinutes"],
      additionalProperties: false
    }
  },
  {
    name: "draft_meeting",
    description: "Draft, but do not create, a meeting and report cached conflicts.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", minLength: 1, maxLength: 255 },
        start: { type: "string", format: "date-time" },
        end: { type: "string", format: "date-time" },
        calendarIds: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 100 },
        attendeeEmails: { type: "array", items: { type: "string" }, maxItems: 100 }
      },
      required: ["title", "start", "end", "calendarIds"],
      additionalProperties: false
    }
  }
];
var redactedMcpEvent = /* @__PURE__ */ __name((event) => ({
  ...event,
  title: event.busy ? "Busy" : "Available",
  attendees: [],
  location: null
}), "redactedMcpEvent");
var mcpEventRequest = /* @__PURE__ */ __name((request, input, revalidate) => {
  const headers = new Headers(request.headers);
  headers.set("Content-Type", "application/json");
  headers.delete("Content-Length");
  return new Request(new URL("/v1/events/query", request.url), {
    method: "POST",
    headers,
    body: JSON.stringify({ ...input, revalidate })
  });
}, "mcpEventRequest");
async function mcpCachedQuery(request, env, executionContext, providerFetch, input, revalidate) {
  const response = await queryEvents(
    mcpEventRequest(request, input, revalidate),
    env,
    executionContext,
    providerFetch
  );
  const value = await response.json();
  if (!isRecord9(value)) throw new ApiError(500, "cache_response_invalid", "Cache response invalid.");
  return value;
}
__name(mcpCachedQuery, "mcpCachedQuery");
var mcpToolResult = /* @__PURE__ */ __name((value) => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
  structuredContent: value
}), "mcpToolResult");
var requireAuthoritativeMcpCache = /* @__PURE__ */ __name((result, input) => {
  const served = new Set(Array.isArray(result.servedCalendarIds) ? result.servedCalendarIds.filter((value) => typeof value === "string") : []);
  const cache2 = isRecord9(result.cache) ? result.cache : null;
  const proofs = /* @__PURE__ */ new Map();
  if (cache2 && Array.isArray(cache2.calendars)) {
    for (const proof of cache2.calendars) {
      if (isRecord9(proof) && typeof proof.calendarId === "string") {
        proofs.set(proof.calendarId, proof);
      }
    }
  }
  const incomplete = result.truncated === true || Array.isArray(result.errors) && result.errors.length > 0 || input.calendarIds.some((calendarId) => {
    const proof = proofs.get(calendarId);
    return !served.has(calendarId) || !proof || proof.freshness !== "fresh" || proof.coversRequestedRange !== true || proof.error !== null;
  });
  if (incomplete) {
    throw new ApiError(
      503,
      "calendar_cache_not_authoritative",
      "Every requested calendar must have a complete fresh cache before proposing a time."
    );
  }
}, "requireAuthoritativeMcpCache");
async function callMcpTool(name, args, request, env, executionContext, providerFetch) {
  if (name === "list_events") {
    const input = eventQueryInput(args);
    const result = await mcpCachedQuery(
      request,
      env,
      executionContext,
      providerFetch,
      input,
      "background"
    );
    const sourceEvents = Array.isArray(result.events) ? result.events : [];
    const events = sourceEvents.slice(0, MCP_MAX_EVENTS).map((event) => redactedMcpEvent(event));
    return {
      ...result,
      events,
      truncated: result.truncated === true || sourceEvents.length > MCP_MAX_EVENTS,
      detailsIncluded: false
    };
  }
  if (name === "find_available_slots") {
    const input = eventQueryInput(args);
    if (typeof args.durationMinutes !== "number" || !Number.isInteger(args.durationMinutes) || args.durationMinutes < 5 || args.durationMinutes > 480) throw new ApiError(400, "invalid_duration", "durationMinutes must be 5 through 480.");
    const result = await mcpCachedQuery(
      request,
      env,
      executionContext,
      providerFetch,
      input,
      "wait"
    );
    requireAuthoritativeMcpCache(result, input);
    const busy = (Array.isArray(result.events) ? result.events : []).filter((event) => isRecord9(event) && event.busy === true).map((event) => ({ start: Date.parse(event.start), end: Date.parse(event.end) })).filter((interval) => Number.isFinite(interval.start) && Number.isFinite(interval.end));
    const durationMs = args.durationMinutes * 60 * 1e3;
    const stepMs = 15 * 60 * 1e3;
    const slots = [];
    for (let start = Date.parse(input.timeMin); start + durationMs <= Date.parse(input.timeMax) && slots.length < 50; start += stepMs) {
      const end = start + durationMs;
      if (!busy.some((interval) => interval.start < end && interval.end > start)) {
        slots.push({ start: new Date(start).toISOString(), end: new Date(end).toISOString() });
      }
    }
    return {
      timeMin: input.timeMin,
      timeMax: input.timeMax,
      durationMinutes: args.durationMinutes,
      slots,
      cache: result.cache,
      source: result.source,
      truncated: result.truncated
    };
  }
  if (name === "draft_meeting") {
    const title = requiredText3(args.title, "title");
    const input = eventQueryInput({
      timeMin: args.start,
      timeMax: args.end,
      calendarIds: args.calendarIds
    });
    if (!Array.isArray(args.attendeeEmails ?? [])) {
      throw new ApiError(400, "invalid_attendees", "attendeeEmails must be an array.");
    }
    const attendeeEmails = args.attendeeEmails ?? [];
    if (attendeeEmails.length > 100) {
      throw new ApiError(400, "invalid_attendees", "Choose at most 100 attendees.");
    }
    const normalizedAttendees = attendeeEmails.map((value, index) => {
      const email = requiredText3(value, `attendeeEmails[${index}]`, 320).toLowerCase();
      if (!email.includes("@")) {
        throw new ApiError(400, "invalid_attendees", `attendeeEmails[${index}] is invalid.`);
      }
      return email;
    });
    const result = await mcpCachedQuery(
      request,
      env,
      executionContext,
      providerFetch,
      input,
      "wait"
    );
    requireAuthoritativeMcpCache(result, input);
    const allConflicts = (Array.isArray(result.events) ? result.events : []).filter((event) => isRecord9(event) && event.busy === true).map(redactedMcpEvent);
    const conflicts = allConflicts.slice(0, MCP_MAX_CONFLICTS);
    return {
      draft: {
        id: `draft-${crypto.randomUUID()}`,
        title,
        start: input.timeMin,
        end: input.timeMax,
        calendarIds: input.calendarIds,
        attendeeEmails: normalizedAttendees,
        persisted: false
      },
      conflicts,
      conflictsTruncated: allConflicts.length > MCP_MAX_CONFLICTS,
      cache: result.cache,
      source: result.source
    };
  }
  throw new ApiError(404, "mcp_tool_not_found", "The requested MCP tool does not exist.");
}
__name(callMcpTool, "callMcpTool");
async function handleMcp(request, env, executionContext, providerFetch) {
  await principalScope(request, env);
  const body = await readJson(request);
  const id = body.id ?? null;
  const method = requiredText3(body.method, "method", 128);
  const success = /* @__PURE__ */ __name((result) => json({ jsonrpc: "2.0", id, result }), "success");
  try {
    if (method === "initialize") {
      return success({
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "tap-calendar-gateway", version: "0.1.0" }
      });
    }
    if (method === "notifications/initialized") return new Response(null, { status: 202 });
    if (method === "tools/list") return success({ tools: mcpTools });
    if (method === "tools/call") {
      if (!isRecord9(body.params)) {
        throw new ApiError(400, "invalid_mcp_params", "tools/call params are required.");
      }
      const name = requiredText3(body.params.name, "tool name", 128);
      const args = body.params.arguments === void 0 ? {} : isRecord9(body.params.arguments) ? body.params.arguments : (() => {
        throw new ApiError(400, "invalid_mcp_params", "Tool arguments must be an object.");
      })();
      return success(mcpToolResult(await callMcpTool(
        name,
        args,
        request,
        env,
        executionContext,
        providerFetch
      )));
    }
    return json({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: "Method not found" }
    });
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    return json({
      jsonrpc: "2.0",
      id,
      error: { code: error.status === 404 ? -32601 : -32602, message: error.message }
    });
  }
}
__name(handleMcp, "handleMcp");
async function route(request, env, executionContext, providerFetch = fetch) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/u, "") || "/";
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  }
  if (request.method === "GET" && path === "/health") {
    return json({
      ok: true,
      service: "tap-calendar-gateway",
      runtime: "cloudflare-workers",
      localDevelopment: env.LOCAL_DEVELOPMENT === "true"
    });
  }
  if (request.method === "GET" && path === "/api/public/manage") {
    return getPublicBookingManagement(request, url, env, providerFetch);
  }
  if (request.method === "POST" && path === "/api/public/manage/cancel") {
    return cancelManagedPublicBooking(request, url, env, providerFetch);
  }
  if (request.method === "POST" && path === "/api/public/manage/reschedule") {
    return rescheduleManagedPublicBooking(request, url, env, providerFetch);
  }
  if (path.startsWith("/api/public/manage")) {
    throw publicBookingManagementUnavailable();
  }
  const publicBookingRoute = parsePublicBookingPagePath(path);
  if (request.method === "GET" && publicBookingRoute?.resource === "page") {
    if (url.search) {
      throw new ApiError(
        400,
        "invalid_public_request",
        "This public booking request is invalid."
      );
    }
    return getPublishedPublicBookingPage(publicBookingRoute, env);
  }
  if (request.method === "GET" && publicBookingRoute?.resource === "availability") {
    return getPublishedPublicBookingAvailability(
      request,
      publicBookingRoute,
      url,
      env,
      providerFetch
    );
  }
  if (request.method === "POST" && publicBookingRoute?.resource === "bookings") {
    if (url.search) {
      throw new ApiError(
        400,
        "invalid_public_request",
        "This public booking request is invalid."
      );
    }
    return createPublishedPublicBooking(request, publicBookingRoute, env, providerFetch);
  }
  if (path.startsWith("/api/public/pages/")) {
    throw new ApiError(
      404,
      "public_page_unavailable",
      "This booking page is unavailable."
    );
  }
  if (request.method === "GET" && path === "/v1/providers") {
    return json(providerCatalog(env));
  }
  if (request.method === "POST" && path === "/v1/publications/profiles") {
    return publishBookingProfile(request, env);
  }
  if (request.method === "POST" && path === "/v1/publications/profiles/unpublish") {
    return unpublishBookingProfile(request, env);
  }
  if (request.method === "POST" && path === "/v1/webhooks/google/calendar") {
    return handleGoogleCalendarWebhook(request, env, executionContext, providerFetch);
  }
  if (request.method === "POST" && path === "/mcp") {
    return handleMcp(request, env, executionContext, providerFetch);
  }
  const callbackMatch = path.match(/^\/v1\/oauth\/(google|microsoft)\/callback$/u);
  if (request.method === "GET" && callbackMatch) {
    return completeOAuth(
      request,
      env,
      callbackMatch[1],
      providerFetch
    );
  }
  if (request.method === "GET" && path === "/v1/connections") {
    return listConnections(request, env);
  }
  if (request.method === "POST" && path === "/v1/connections/local") {
    return createLocalConnection(request, env);
  }
  if (request.method === "POST" && path === "/v1/events/query") {
    return queryEvents(request, env, executionContext, providerFetch);
  }
  if (request.method === "POST" && path === "/v1/availability/validate") {
    return validateLiveAvailability(request, env, providerFetch);
  }
  if (request.method === "POST" && path === "/v1/bookings/commit") {
    return commitGoogleBooking(request, env, providerFetch);
  }
  const bookingStatusMatch = path.match(/^\/v1\/bookings\/([^/]+)\/status$/u);
  if (request.method === "GET" && bookingStatusMatch?.[1]) {
    return getGoogleBookingStatus(
      request,
      env,
      identifier2(decodeURIComponent(bookingStatusMatch[1]), "booking idempotency key"),
      providerFetch
    );
  }
  const bookingResolutionMatch = path.match(/^\/v1\/bookings\/([^/]+)\/resolve$/u);
  if (request.method === "POST" && bookingResolutionMatch?.[1]) {
    return resolveGoogleApprovalHold(
      request,
      env,
      identifier2(decodeURIComponent(bookingResolutionMatch[1]), "booking idempotency key"),
      providerFetch
    );
  }
  if (request.method === "POST" && path === "/v1/availability/confirm") {
    return confirmLiveAvailability(request, env, providerFetch);
  }
  const oauthStartMatch = path.match(/^\/v1\/oauth\/(google|microsoft)\/start$/u);
  if (request.method === "POST" && oauthStartMatch) {
    return beginOAuth(request, env, oauthStartMatch[1]);
  }
  const addCalendarsMatch = path.match(/^\/v1\/connections\/([^/]+)\/calendars\/local$/u);
  if (request.method === "POST" && addCalendarsMatch?.[1]) {
    return addLocalCalendars(request, env, decodeURIComponent(addCalendarsMatch[1]));
  }
  const removeCalendarsMatch = path.match(
    /^\/v1\/connections\/([^/]+)\/calendars\/local\/remove$/u
  );
  if (request.method === "POST" && removeCalendarsMatch?.[1]) {
    return removeLocalCalendars(
      request,
      env,
      decodeURIComponent(removeCalendarsMatch[1])
    );
  }
  const removeManagedCalendarsMatch = path.match(
    /^\/v1\/connections\/([^/]+)\/calendars\/remove$/u
  );
  if (request.method === "POST" && removeManagedCalendarsMatch?.[1]) {
    return removeCalendars(
      request,
      env,
      identifier2(decodeURIComponent(removeManagedCalendarsMatch[1]), "connectionId")
    );
  }
  const syncMatch = path.match(/^\/v1\/connections\/([^/]+)\/sync$/u);
  if (request.method === "POST" && syncMatch?.[1]) {
    return syncConnection(request, env, decodeURIComponent(syncMatch[1]), providerFetch);
  }
  const connectionMatch = path.match(/^\/v1\/connections\/([^/]+)$/u);
  if (connectionMatch?.[1]) {
    const connectionId = identifier2(decodeURIComponent(connectionMatch[1]), "connectionId");
    if (request.method === "GET") {
      const { workspace, principal } = await principalScope(request, env);
      const connection = await connectionById(
        env,
        workspace,
        principal,
        connectionId
      );
      return json({ connection: connectionProjection(connection.row, connection.calendars) });
    }
    if (request.method === "DELETE") {
      return deleteConnection(request, env, connectionId);
    }
  }
  throw new ApiError(404, "not_found", "The Calendar gateway route was not found.");
}
__name(route, "route");
function createCalendarGatewayWorker(providerFetch = fetch) {
  return {
    async fetch(request, env, executionContext) {
      let headers = {};
      try {
        headers = corsHeaders(request, env);
        const response = await route(request, env, executionContext, providerFetch);
        const merged = new Headers(response.headers);
        for (const [name, value] of new Headers(headers)) merged.set(name, value);
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: merged
        });
      } catch (error) {
        const apiError = error instanceof ApiError ? error : new ApiError(500, "internal_error", "The Calendar gateway could not complete the request.");
        if (!(error instanceof ApiError)) console.error(error);
        return json(
          { error: apiError.code, message: apiError.message, ...apiError.details },
          apiError.status,
          headers
        );
      }
    },
    scheduled(_controller, env, executionContext) {
      const jobs = [
        ["approval hold expiration", expireApprovalHolds(env, providerFetch)],
        ["public approval lifecycle expiration", expirePublicBookingManagementApprovals(env)],
        ["public booking email reconciliation", reconcilePublicBookingEmailNotices(env)],
        ["public booking email delivery", deliverPublicBookingEmails(env)],
        ["calendar cache repair", repairCalendarCaches(env, providerFetch)]
      ];
      for (const [name, operation] of jobs) {
        executionContext.waitUntil(operation.catch((error) => {
          logCalendarSync("error", `${name} failed`, {
            error: error instanceof Error ? error.name : "unknown"
          });
        }));
      }
    }
  };
}
__name(createCalendarGatewayWorker, "createCalendarGatewayWorker");
var index_default = createCalendarGatewayWorker();
export {
  createCalendarGatewayWorker,
  createGatewayPublicBookingManagementProvider,
  createGatewayPublicBookingProvider,
  index_default as default,
  normalizeGoogleCalendarEvent,
  normalizeGoogleCalendarHtmlUrl,
  normalizeGoogleMeetJoinUrl,
  normalizeMicrosoftCalendarPageUrl,
  queryPublicGoogleBusyIntervals
};
//# sourceMappingURL=index.js.map
