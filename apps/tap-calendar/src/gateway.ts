import type { WorkspaceBookings, SharedHostInput, WorkspaceBookingProfileInput } from "./workspace-bookings";
import type { MiniAppHttpApi } from "@theaiplatform/miniapp-sdk/sdk";
import { isPublicBookingAnalytics, type PublicBookingAnalytics } from "./public-booking-analytics";
import type {
  CalendarEvent,
  CalendarProvider,
  CalendarRole,
  CalendarView,
} from "./domain";
import type {
  PublicBookingProfilePublicationInput,
  PublicBookingPublicationInput,
} from "./public-booking-publication";

export type {
  PublicBookingProfilePublicationInput,
  PublicBookingPublicationInput,
} from "./public-booking-publication";

export const DEFAULT_LOCAL_CALENDAR_GATEWAY_URL = "http://127.0.0.1:8787";
export const PRODUCTION_CALENDAR_GATEWAY_ORIGIN =
  "https://calendar-api.theaiplatform.app";

const PLATFORM_SESSION_CREDENTIAL_REF = "platform-session";

declare const __TAP_CALENDAR_GATEWAY_URL__: string | undefined;

export interface CalendarGatewayProviderStatus {
  readonly id: CalendarProvider;
  readonly authorization:
    | "oauth"
    | "app-specific-password"
    | "credentials"
    | "enterprise"
    | "subscription-url";
  readonly configured: boolean;
  readonly note?: string;
}

export interface CalendarGatewayProviderCatalog {
  readonly localConnector: boolean;
  readonly providers: readonly CalendarGatewayProviderStatus[];
}

export interface CalendarGatewayCalendar {
  readonly id: string;
  readonly providerCalendarId: string;
  readonly name: string;
  readonly color: string;
  readonly role: CalendarRole;
  readonly writable: boolean;
  readonly freshness: "live" | "delayed" | "stale";
  readonly primary: boolean;
}

export interface CalendarGatewayConnection {
  readonly id: string;
  readonly workspaceId: string;
  readonly ownerPrincipalId: string;
  readonly provider: CalendarProvider;
  readonly mode: "local" | "oauth" | "credentials" | "subscription";
  readonly label: string;
  readonly status: "pending" | "connected" | "attention" | "read-only";
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastSyncedAt: string | null;
  readonly calendars: readonly CalendarGatewayCalendar[];
}

export interface LocalCalendarGatewayInput {
  readonly id: string;
  readonly providerCalendarId: string;
  readonly name: string;
  readonly color: string;
  readonly role: CalendarRole;
  readonly writable: boolean;
  readonly freshness: "live" | "delayed" | "stale";
  readonly primary: boolean;
}

export interface CalendarGatewayEventError {
  readonly calendarId: string;
  readonly code: string;
  readonly message: string;
}

export interface CalendarGatewayEventCacheProof {
  readonly calendarId: string;
  readonly cacheRevision: number;
  readonly freshness: "pending" | "fresh" | "stale" | "error";
  readonly lastSuccessAt: string | null;
  readonly nextSyncAt: string;
  readonly error: {
    readonly code: string;
    readonly message: string;
  } | null;
}

export interface CalendarGatewayEventQueryResult {
  readonly timeMin: string;
  readonly timeMax: string;
  readonly syncedAt: string;
  readonly events: readonly CalendarEvent[];
  readonly syncedCalendarIds: readonly string[];
  /** Complete calendar slices returned by newer cache-aware gateways. */
  readonly servedCalendarIds?: readonly string[];
  readonly errors: readonly CalendarGatewayEventError[];
  readonly truncated: boolean;
  readonly source?: "live" | "cache" | "cache+live";
  readonly cache?: {
    readonly servedAt: string;
    readonly calendars: readonly CalendarGatewayEventCacheProof[];
  };
}

export interface CalendarGatewayAvailabilityConfirmation {
  readonly available: true;
  readonly conclusive: true;
  readonly validatedAt: string;
  readonly source: "provider-live";
  readonly conflicts: readonly CalendarEvent[];
  readonly syncedCalendarIds: readonly string[];
  readonly errors: readonly CalendarGatewayEventError[];
  readonly timeMin: string;
  readonly timeMax: string;
  readonly confirmationId: string;
  readonly availabilityConfirmed: true;
  readonly idempotentReplay: boolean;
}

export type CalendarGatewayBookingKind =
  | "meeting"
  | "approval-hold"
  | "work-block";

export type CalendarGatewayConferenceProvider = "none" | "google-meet" | "zoom";

export interface CalendarGatewayMeetingProviderConnection {
  readonly id: string;
  readonly workspaceId: string;
  readonly ownerPrincipalId: string;
  readonly provider: "zoom";
  readonly mode: "oauth";
  readonly label: string;
  readonly status: "pending" | "connected" | "attention";
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CalendarGatewayCommittedBooking {
  readonly state: "committed";
  readonly provider: "google";
  readonly providerEventId: string;
  readonly destinationCalendarId: string;
  readonly bookingKind: CalendarGatewayBookingKind;
  readonly approvalStatus: "pending" | null;
  readonly pendingAttendeeEmails: readonly string[];
  readonly approvalExpiresAt: string | null;
  readonly providerHtmlLink: string | null;
  readonly providerJoinUrl: string | null;
  readonly conferenceStatus: "none" | "pending" | "ready";
  readonly event: CalendarEvent;
}

export interface CalendarGatewayBookingCommit {
  readonly booking: CalendarGatewayCommittedBooking;
  readonly committedAt: string;
  readonly idempotentReplay: boolean;
  readonly concurrencyBoundary: "tap-conflict-calendar-set-serialized";
}

export interface CalendarGatewayBookingStatus {
  readonly commit: CalendarGatewayBookingCommit;
  readonly lifecycle: {
    readonly state: "active" | "approved" | "declined" | "expired";
    readonly resolvedAt: string | null;
    readonly providerEventRemoved: boolean;
  };
  readonly currentEvent: CalendarEvent | null;
}

export interface CalendarGatewayBookingResolution {
  readonly resolution: {
    readonly state: "committed";
    readonly decision: "approved" | "declined";
    readonly bookingIdempotencyKey: string;
    readonly providerEventId: string;
    readonly providerEventRemoved: boolean;
    readonly providerJoinUrl: string | null;
    readonly event: CalendarEvent | null;
  };
  readonly resolvedAt: string;
  readonly idempotentReplay: boolean;
}

export interface CalendarGatewayHttpResponse {
  readonly status: number;
  readonly bodyText: string | null;
}

export const PUBLIC_BOOKING_PROFILE_UNPUBLICATION_SCHEMA_VERSION =
  "tap.calendar.profile-unpublication.v1" as const;

export interface PublicBookingProfileUnpublicationInput {
  readonly schemaVersion: typeof PUBLIC_BOOKING_PROFILE_UNPUBLICATION_SCHEMA_VERSION;
  readonly sourceProfileId: string;
  readonly expectedGeneration: number;
}

export interface CalendarGatewayPublishedBookingPage {
  readonly profileId: string;
  readonly pageId: string;
  readonly revisionId: string;
  readonly sourceEventTypeId: string;
  readonly profileSlug: string;
  readonly eventTypeSlug: string;
  readonly canonicalUrl: string;
  readonly publishedAt: string;
}

export interface CalendarGatewayPublishedBookingProfile {
  readonly profileId: string;
  readonly sourceProfileId: string;
  readonly profileSlug: string;
  readonly generation: number;
  readonly publishedAt: string;
  readonly idempotentReplay: boolean;
  readonly pages: readonly CalendarGatewayPublishedBookingPage[];
}

export interface CalendarGatewayUnpublishedBookingProfile {
  readonly profileId: string;
  readonly sourceProfileId: string;
  readonly generation: number;
  readonly unpublishedAt: string;
  readonly idempotentReplay: boolean;
}

export type CalendarGatewayTransport = (
  url: string,
  input: {
    readonly method: "DELETE" | "GET" | "POST";
    readonly headers: readonly { readonly name: string; readonly value: string }[];
    readonly body: string | null;
  },
) => Promise<CalendarGatewayHttpResponse>;

export class CalendarGatewayError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly currentGeneration?: number,
  ) {
    super(message);
  }
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const calendarProviderIds = new Set<CalendarProvider>([
  "google",
  "microsoft",
  "icloud",
  "caldav",
  "exchange",
  "ics",
]);

const providerAuthorizationKinds = new Set<
  CalendarGatewayProviderStatus["authorization"]
>([
  "oauth",
  "app-specific-password",
  "credentials",
  "enterprise",
  "subscription-url",
]);

const isCalendarGatewayProviderStatus = (
  value: unknown,
): value is CalendarGatewayProviderStatus => {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.every(key => ["id", "authorization", "configured", "note"].includes(key)) &&
    calendarProviderIds.has(value.id as CalendarProvider) &&
    providerAuthorizationKinds.has(
      value.authorization as CalendarGatewayProviderStatus["authorization"],
    ) &&
    typeof value.configured === "boolean" &&
    (value.note === undefined || typeof value.note === "string");
};

export function isCalendarGatewayProviderCatalog(
  value: unknown,
): value is CalendarGatewayProviderCatalog {
  return isRecord(value) &&
    Object.keys(value).length === 2 &&
    typeof value.localConnector === "boolean" &&
    Array.isArray(value.providers) &&
    value.providers.every(isCalendarGatewayProviderStatus);
}

const isIsoDateTime = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every(item => typeof item === "string");

const hasExactKeys = (
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean => {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
};

const isReceiptIdentifier = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 255 &&
  value.trim() === value;

const isCanonicalIsoInstant = (value: unknown): value is string => {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
  ) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
};

const isPublicationGeneration = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= 2_147_483_647;

const serializePublicBookingPublication = (
  value: PublicBookingPublicationInput,
): Readonly<Record<string, unknown>> => ({
  schemaVersion: value.schemaVersion,
  sourceProfileId: value.sourceProfileId,
  profileSlug: value.profileSlug,
  displayName: value.displayName,
  ownerType: value.ownerType,
  sourceEventTypeId: value.sourceEventTypeId,
  eventTypeSlug: value.eventTypeSlug,
  title: value.title,
  description: value.description,
  durationMinutes: value.durationMinutes,
  approvalRequired: value.approvalRequired,
  location: value.location,
  destinationCalendarId: value.destinationCalendarId,
  conflictCalendarIds: [...value.conflictCalendarIds],
  sourceAvailabilityScheduleId: value.sourceAvailabilityScheduleId,
  schedule: {
    timeZone: value.schedule.timeZone,
    preferredStart: value.schedule.preferredStart,
    preferredEnd: value.schedule.preferredEnd,
    bufferBeforeMinutes: value.schedule.bufferBeforeMinutes,
    bufferAfterMinutes: value.schedule.bufferAfterMinutes,
    minimumNoticeMinutes: value.schedule.minimumNoticeMinutes,
    bookingHorizonDays: value.schedule.bookingHorizonDays,
    windows: value.schedule.windows.map(window => ({
      day: window.day,
      enabled: window.enabled,
      start: window.start,
      end: window.end,
    })),
    overrides: value.schedule.overrides.map(override => ({
      date: override.date,
      label: override.label,
      available: override.available,
      timeZone: override.timeZone,
      ...(override.start === undefined ? {} : { start: override.start }),
      ...(override.end === undefined ? {} : { end: override.end }),
    })),
  },
});

const serializePublicBookingProfilePublication = (
  value: PublicBookingProfilePublicationInput,
): Readonly<Record<string, unknown>> => ({
  schemaVersion: value.schemaVersion,
  sourceProfileId: value.sourceProfileId,
  profileSlug: value.profileSlug,
  displayName: value.displayName,
  ownerType: value.ownerType,
  expectedGeneration: value.expectedGeneration,
  publications: value.publications.map(serializePublicBookingPublication),
});

const invalidPublicationReceipt = (message: string): never => {
  throw new CalendarGatewayError(
    502,
    "gateway_response_invalid",
    message,
  );
};

function publishedBookingProfileReceipt(
  value: unknown,
  input: PublicBookingProfilePublicationInput,
): CalendarGatewayPublishedBookingProfile {
  if (
    !input.publications.every(publication =>
      publication.sourceProfileId === input.sourceProfileId &&
      publication.profileSlug === input.profileSlug &&
      publication.displayName === input.displayName &&
      publication.ownerType === input.ownerType
    ) ||
    !isRecord(value) ||
    !hasExactKeys(value, [
      "profileId",
      "sourceProfileId",
      "profileSlug",
      "generation",
      "publishedAt",
      "idempotentReplay",
      "pages",
    ]) ||
    !isReceiptIdentifier(value.profileId) ||
    value.sourceProfileId !== input.sourceProfileId ||
    value.profileSlug !== input.profileSlug ||
    !isPublicationGeneration(value.generation) ||
    value.generation < 1 ||
    !isCanonicalIsoInstant(value.publishedAt) ||
    typeof value.idempotentReplay !== "boolean" ||
    !Array.isArray(value.pages) ||
    value.pages.length !== input.publications.length
  ) {
    return invalidPublicationReceipt(
      "The Calendar gateway returned an invalid Booking Profile publication receipt.",
    );
  }
  if (
    (value.idempotentReplay && value.generation < input.expectedGeneration) ||
    (!value.idempotentReplay && value.generation !== input.expectedGeneration + 1)
  ) {
    return invalidPublicationReceipt(
      "The Calendar gateway returned a mismatched Booking Profile generation.",
    );
  }

  const desiredBySourceId = new Map(
    input.publications.map(publication => [publication.sourceEventTypeId, publication]),
  );
  if (desiredBySourceId.size !== input.publications.length) {
    return invalidPublicationReceipt(
      "The Calendar gateway returned a receipt for an invalid Booking Profile request.",
    );
  }
  const pageIds = new Set<string>();
  const revisionIds = new Set<string>();
  const receivedSourceIds = new Set<string>();
  for (const page of value.pages) {
    if (
      !isRecord(page) ||
      !hasExactKeys(page, [
        "profileId",
        "pageId",
        "revisionId",
        "sourceEventTypeId",
        "profileSlug",
        "eventTypeSlug",
        "canonicalUrl",
        "publishedAt",
      ]) ||
      page.profileId !== value.profileId ||
      !isReceiptIdentifier(page.pageId) ||
      !isReceiptIdentifier(page.revisionId) ||
      !isReceiptIdentifier(page.sourceEventTypeId) ||
      page.profileSlug !== input.profileSlug ||
      !isCanonicalIsoInstant(page.publishedAt)
    ) {
      return invalidPublicationReceipt(
        "The Calendar gateway returned an invalid Booking Page publication receipt.",
      );
    }
    const desired = desiredBySourceId.get(page.sourceEventTypeId);
    if (
      !desired ||
      page.eventTypeSlug !== desired.eventTypeSlug ||
      page.canonicalUrl !==
        `https://cal.with-tap.ai/${input.profileSlug}/${desired.eventTypeSlug}` ||
      pageIds.has(page.pageId) ||
      revisionIds.has(page.revisionId) ||
      receivedSourceIds.has(page.sourceEventTypeId)
    ) {
      return invalidPublicationReceipt(
        "The Calendar gateway returned a Booking Page receipt that did not match the publication request.",
      );
    }
    pageIds.add(page.pageId);
    revisionIds.add(page.revisionId);
    receivedSourceIds.add(page.sourceEventTypeId);
  }
  if (receivedSourceIds.size !== desiredBySourceId.size) {
    return invalidPublicationReceipt(
      "The Calendar gateway returned an incomplete Booking Profile publication receipt.",
    );
  }
  return value as unknown as CalendarGatewayPublishedBookingProfile;
}

function unpublishedBookingProfileReceipt(
  value: unknown,
  input: PublicBookingProfileUnpublicationInput,
): CalendarGatewayUnpublishedBookingProfile {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "profileId",
      "sourceProfileId",
      "generation",
      "unpublishedAt",
      "idempotentReplay",
    ]) ||
    !isReceiptIdentifier(value.profileId) ||
    value.sourceProfileId !== input.sourceProfileId ||
    !isPublicationGeneration(value.generation) ||
    !isCanonicalIsoInstant(value.unpublishedAt) ||
    typeof value.idempotentReplay !== "boolean" ||
    (value.idempotentReplay && value.generation < input.expectedGeneration) ||
    (!value.idempotentReplay && value.generation !== input.expectedGeneration + 1)
  ) {
    return invalidPublicationReceipt(
      "The Calendar gateway returned an invalid Booking Profile unpublication receipt.",
    );
  }
  return value as unknown as CalendarGatewayUnpublishedBookingProfile;
}

const isTrustedGoogleHttpsUrl = (
  value: unknown,
  allowed: (url: URL) => boolean,
): value is string => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 4_096 ||
    value.trim() !== value
  ) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      allowed(url);
  } catch {
    return false;
  }
};

const isGoogleCalendarHtmlUrl = (value: unknown): value is string =>
  isTrustedGoogleHttpsUrl(value, url =>
    (url.hostname === "calendar.google.com" &&
      (url.pathname.startsWith("/calendar/") ||
        url.pathname === "/event" ||
        url.pathname.startsWith("/event/"))) ||
    (url.hostname === "www.google.com" && url.pathname.startsWith("/calendar/"))
  );

const isGoogleMeetJoinUrl = (value: unknown): value is string =>
  isTrustedGoogleHttpsUrl(
    value,
    url => url.hostname === "meet.google.com" && url.pathname !== "/",
  );

const isZoomJoinUrl = (value: unknown): value is string =>
  isTrustedGoogleHttpsUrl(
    value,
    url => {
      if (
        !(url.hostname === "zoom.us" || url.hostname.endsWith(".zoom.us")) ||
        url.hash ||
        !/^\/j\/\d{9,11}\/?$/u.test(url.pathname)
      ) return false;
      return [...url.searchParams.keys()].every(key => key === "pwd" || key === "omn");
    },
  );

const isConferenceJoinUrl = (value: unknown): value is string =>
  isGoogleMeetJoinUrl(value) || isZoomJoinUrl(value);

const isGatewayEventError = (value: unknown): value is CalendarGatewayEventError =>
  isRecord(value) &&
  typeof value.calendarId === "string" &&
  typeof value.code === "string" &&
  typeof value.message === "string";

const isGatewayCalendarEvent = (value: unknown): value is CalendarEvent =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.calendarId === "string" &&
  typeof value.title === "string" &&
  isIsoDateTime(value.start) &&
  isIsoDateTime(value.end) &&
  Date.parse(value.end) > Date.parse(value.start) &&
  (value.kind === "meeting" || value.kind === "work-block" ||
    value.kind === "hold" || value.kind === "focus") &&
  (value.status === "pending" || value.status === "confirmed" ||
    value.status === "declined" || value.status === "cancelled") &&
  (value.location === null || [
    "tap-room",
    "tap-huddle",
    "google-meet",
    "microsoft-teams",
    "zoom",
    "webex",
    "goto",
    "phone",
    "physical",
    "custom",
  ].includes(String(value.location))) &&
  Array.isArray(value.attendees) &&
  value.attendees.every(attendee =>
    isRecord(attendee) &&
    typeof attendee.id === "string" &&
    typeof attendee.name === "string" &&
    typeof attendee.email === "string" &&
    (attendee.kind === "tap" || attendee.kind === "external") &&
    typeof attendee.required === "boolean"
  ) &&
  (value.busy === undefined || typeof value.busy === "boolean") &&
  (value.allDay === undefined || typeof value.allDay === "boolean") &&
  (value.providerHtmlLink === undefined || isGoogleCalendarHtmlUrl(value.providerHtmlLink)) &&
  (value.providerJoinUrl === undefined || isConferenceJoinUrl(value.providerJoinUrl)) &&
  (value.source === undefined || (
    isRecord(value.source) &&
    (value.source.kind === "task" || value.source.kind === "channel" ||
      value.source.kind === "message") &&
    typeof value.source.id === "string" &&
    typeof value.source.label === "string"
  ));

const isGatewayEventCacheProof = (
  value: unknown,
): value is CalendarGatewayEventCacheProof => {
  if (!isRecord(value)) return false;
  const errorValid = value.error === null || (
    isRecord(value.error) &&
    typeof value.error.code === "string" &&
    typeof value.error.message === "string"
  );
  return (
    typeof value.calendarId === "string" &&
    typeof value.cacheRevision === "number" &&
    Number.isInteger(value.cacheRevision) &&
    value.cacheRevision >= 0 &&
    (value.freshness === "pending" || value.freshness === "fresh" ||
      value.freshness === "stale" || value.freshness === "error") &&
    (value.lastSuccessAt === null || isIsoDateTime(value.lastSuccessAt)) &&
    isIsoDateTime(value.nextSyncAt) &&
    errorValid
  );
};

export function isCalendarGatewayEventQueryResult(
  value: unknown,
): value is CalendarGatewayEventQueryResult {
  if (!isRecord(value)) return false;
  const sourceValid = value.source === undefined ||
    value.source === "live" ||
    value.source === "cache" ||
    value.source === "cache+live";
  const cacheValid = value.cache === undefined || (
    isRecord(value.cache) &&
    isIsoDateTime(value.cache.servedAt) &&
    Array.isArray(value.cache.calendars) &&
    value.cache.calendars.every(isGatewayEventCacheProof)
  );
  return (
    isIsoDateTime(value.timeMin) &&
    isIsoDateTime(value.timeMax) &&
    isIsoDateTime(value.syncedAt) &&
    Array.isArray(value.events) &&
    value.events.every(isGatewayCalendarEvent) &&
    isStringArray(value.syncedCalendarIds) &&
    (value.servedCalendarIds === undefined || isStringArray(value.servedCalendarIds)) &&
    Array.isArray(value.errors) &&
    value.errors.every(isGatewayEventError) &&
    typeof value.truncated === "boolean" &&
    sourceValid &&
    cacheValid
  );
}

export function isCalendarGatewayAvailabilityConfirmation(
  value: unknown,
): value is CalendarGatewayAvailabilityConfirmation {
  return (
    isRecord(value) &&
    value.available === true &&
    value.conclusive === true &&
    isIsoDateTime(value.validatedAt) &&
    value.source === "provider-live" &&
    Array.isArray(value.conflicts) &&
    value.conflicts.every(isGatewayCalendarEvent) &&
    isStringArray(value.syncedCalendarIds) &&
    Array.isArray(value.errors) &&
    value.errors.every(isGatewayEventError) &&
    isIsoDateTime(value.timeMin) &&
    isIsoDateTime(value.timeMax) &&
    typeof value.confirmationId === "string" &&
    value.confirmationId.length > 0 &&
    value.availabilityConfirmed === true &&
    typeof value.idempotentReplay === "boolean"
  );
}

export function isCalendarGatewayBookingCommit(
  value: unknown,
): value is CalendarGatewayBookingCommit {
  if (!isRecord(value) || !isRecord(value.booking)) return false;
  const booking = value.booking;
  return (
    booking.state === "committed" &&
    booking.provider === "google" &&
    typeof booking.providerEventId === "string" &&
    booking.providerEventId.length > 0 &&
    typeof booking.destinationCalendarId === "string" &&
    (booking.bookingKind === "meeting" ||
      booking.bookingKind === "approval-hold" ||
      booking.bookingKind === "work-block") &&
    (booking.approvalStatus === null || booking.approvalStatus === "pending") &&
    isStringArray(booking.pendingAttendeeEmails) &&
    (booking.approvalExpiresAt === null || isIsoDateTime(booking.approvalExpiresAt)) &&
    (booking.providerHtmlLink === null || isGoogleCalendarHtmlUrl(booking.providerHtmlLink)) &&
    (booking.providerJoinUrl === null || isConferenceJoinUrl(booking.providerJoinUrl)) &&
    (booking.conferenceStatus === "none" ||
      booking.conferenceStatus === "pending" ||
      booking.conferenceStatus === "ready") &&
    ((booking.conferenceStatus === "ready") === (booking.providerJoinUrl !== null)) &&
    isGatewayCalendarEvent(booking.event) &&
    isIsoDateTime(value.committedAt) &&
    typeof value.idempotentReplay === "boolean" &&
    value.concurrencyBoundary === "tap-conflict-calendar-set-serialized"
  );
}

export function isCalendarGatewayBookingStatus(
  value: unknown,
): value is CalendarGatewayBookingStatus {
  if (
    !isRecord(value) ||
    !isCalendarGatewayBookingCommit(value.commit) ||
    !isRecord(value.lifecycle)
  ) return false;
  const lifecycle = value.lifecycle;
  const active = lifecycle.state === "active";
  const approved = lifecycle.state === "approved";
  const removed = lifecycle.state === "declined" || lifecycle.state === "expired";
  const currentEvent = value.currentEvent;
  if (!active && !approved && !removed) return false;
  return (
    value.commit.idempotentReplay === true &&
    (active
      ? lifecycle.resolvedAt === null
      : isIsoDateTime(lifecycle.resolvedAt)) &&
    lifecycle.providerEventRemoved === removed &&
    (removed
      ? currentEvent === null
      : isGatewayCalendarEvent(currentEvent)) &&
    (currentEvent === null ||
      (isGatewayCalendarEvent(currentEvent) &&
        currentEvent.calendarId === value.commit.booking.destinationCalendarId)) &&
    (!approved || (
      isRecord(currentEvent) &&
      currentEvent.kind === "meeting" &&
      currentEvent.status === "confirmed"
    )) &&
    (active || value.commit.booking.bookingKind === "approval-hold")
  );
}

export function isCalendarGatewayBookingResolution(
  value: unknown,
): value is CalendarGatewayBookingResolution {
  if (!isRecord(value) || !isRecord(value.resolution)) return false;
  const resolution = value.resolution;
  return (
    resolution.state === "committed" &&
    (resolution.decision === "approved" || resolution.decision === "declined") &&
    typeof resolution.bookingIdempotencyKey === "string" &&
    resolution.bookingIdempotencyKey.length > 0 &&
    typeof resolution.providerEventId === "string" &&
    resolution.providerEventId.length > 0 &&
    typeof resolution.providerEventRemoved === "boolean" &&
    (resolution.providerJoinUrl === null || isConferenceJoinUrl(resolution.providerJoinUrl)) &&
    (resolution.event === null || isGatewayCalendarEvent(resolution.event)) &&
    isIsoDateTime(value.resolvedAt) &&
    typeof value.idempotentReplay === "boolean"
  );
}

function gatewayOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("TAP Calendar gateway URL is invalid.");
  }
  const secure = url.protocol === "https:";
  const local =
    url.protocol === "http:" &&
    url.hostname === "127.0.0.1" &&
    url.port.length > 0;
  if (
    (!secure && !local) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new Error(
      "TAP Calendar gateway must be an exact HTTPS origin or a port-qualified 127.0.0.1 development origin.",
    );
  }
  return url.origin;
}

export function resolveCalendarGatewayUrl(
  preview: boolean,
  search = globalThis.location?.search ?? "",
): string {
  if (preview) {
    const explicit = new URLSearchParams(search).get("gateway");
    return gatewayOrigin(explicit ?? DEFAULT_LOCAL_CALENDAR_GATEWAY_URL);
  }
  const configured =
    typeof __TAP_CALENDAR_GATEWAY_URL__ === "string"
      ? __TAP_CALENDAR_GATEWAY_URL__.trim()
      : "";
  return gatewayOrigin(configured || PRODUCTION_CALENDAR_GATEWAY_ORIGIN);
}

export function createFetchCalendarGatewayTransport(
  fetcher: typeof fetch = globalThis.fetch,
): CalendarGatewayTransport {
  return async (url, input) => {
    const response = await fetcher(url, {
      method: input.method,
      headers: Object.fromEntries(input.headers.map(header => [header.name, header.value])),
      ...(input.body === null ? {} : { body: input.body }),
    });
    return { status: response.status, bodyText: await response.text() };
  };
}

export function createTapCalendarGatewayTransport(
  http: MiniAppHttpApi | undefined,
): CalendarGatewayTransport {
  return async (url, input) => {
    if (!http) {
      throw new CalendarGatewayError(
        503,
        "host_http_unavailable",
        "This TAP host does not expose governed HTTP requests.",
      );
    }
    const request = {
      method: input.method,
      url,
      headers: input.headers.map(header => ({ ...header })),
      body: input.body,
      timeoutMs: 30_000,
      responseBodyLimitBytes: 1_048_576,
      followRedirects: false,
    } as const;
    const response = new URL(url).origin === PRODUCTION_CALENDAR_GATEWAY_ORIGIN
      ? await http.request(request, { credentialRef: PLATFORM_SESSION_CREDENTIAL_REF })
      : await http.request(request);
    if (response.bodyTruncated) {
      throw new CalendarGatewayError(
        502,
        "gateway_response_too_large",
        "The Calendar gateway response exceeded the declared limit.",
      );
    }
    return { status: response.status, bodyText: response.bodyText };
  };
}

export interface CalendarGatewayClient {
  readonly baseUrl: string;
  readonly principalId: string;
  workspaceBookings(): Promise<WorkspaceBookings>;
  saveSharedHost(input: SharedHostInput): Promise<void>;
  saveWorkspaceBookingProfile(input: WorkspaceBookingProfileInput): Promise<void>;
  health(): Promise<{ readonly ok: boolean; readonly localDevelopment: boolean }>;
  providers(): Promise<CalendarGatewayProviderCatalog>;
  publicBookingAnalytics(): Promise<PublicBookingAnalytics>;
  publishPublicBookingProfile(
    input: PublicBookingProfilePublicationInput,
  ): Promise<CalendarGatewayPublishedBookingProfile>;
  unpublishPublicBookingProfile(
    input: PublicBookingProfileUnpublicationInput,
  ): Promise<CalendarGatewayUnpublishedBookingProfile>;
  listConnections(): Promise<readonly CalendarGatewayConnection[]>;
  getConnection(connectionId: string): Promise<CalendarGatewayConnection>;
  createLocalConnection(input: {
    readonly id: string;
    readonly provider: CalendarProvider;
    readonly label: string;
    readonly calendars: readonly LocalCalendarGatewayInput[];
  }): Promise<CalendarGatewayConnection>;
  addLocalCalendars(
    connectionId: string,
    calendars: readonly LocalCalendarGatewayInput[],
  ): Promise<CalendarGatewayConnection>;
  removeLocalCalendars(
    connectionId: string,
    calendarIds: readonly string[],
  ): Promise<CalendarGatewayConnection>;
  removeCalendars(
    connectionId: string,
    calendarIds: readonly string[],
  ): Promise<CalendarGatewayConnection>;
  startOAuth(input: {
    readonly id: string;
    readonly provider: "google" | "microsoft" | "zoom";
    readonly label?: string;
  }): Promise<{
    readonly connectionId: string;
    readonly authorizationUrl: string;
    readonly expiresAt: string;
  }>;
  listMeetingProviderConnections(): Promise<readonly CalendarGatewayMeetingProviderConnection[]>;
  verifyMeetingProviderConnection(
    connectionId: string,
  ): Promise<CalendarGatewayMeetingProviderConnection>;
  deleteMeetingProviderConnection(connectionId: string): Promise<void>;
  syncConnection(connectionId: string): Promise<CalendarGatewayConnection>;
  queryEvents(input: {
    readonly timeMin: string;
    readonly timeMax: string;
    readonly calendarIds: readonly string[];
    readonly revalidate?: "wait" | "background";
  }): Promise<CalendarGatewayEventQueryResult>;
  confirmAvailability(input: {
    readonly timeMin: string;
    readonly timeMax: string;
    readonly calendarIds: readonly string[];
    readonly idempotencyKey: string;
  }): Promise<CalendarGatewayAvailabilityConfirmation>;
  commitBooking(input: {
    readonly destinationCalendarId: string;
    readonly conflictCalendarIds: readonly string[];
    readonly idempotencyKey: string;
    readonly title: string;
    readonly start: string;
    readonly end: string;
    readonly conflictTimeMin?: string;
    readonly conflictTimeMax?: string;
    readonly bookingKind: CalendarGatewayBookingKind;
    readonly description?: string;
    readonly location?: string;
    readonly attendeeEmails?: readonly string[];
    readonly conferenceProvider?: CalendarGatewayConferenceProvider;
    readonly expiresAt?: string;
  }): Promise<CalendarGatewayBookingCommit>;
  getBookingStatus(idempotencyKey: string): Promise<CalendarGatewayBookingStatus>;
  resolveApprovalHold(
    bookingIdempotencyKey: string,
    input: {
      readonly idempotencyKey: string;
      readonly decision: "approve" | "decline";
      readonly title?: string;
      readonly description?: string;
      readonly location?: string;
      readonly attendeeEmails?: readonly string[];
      readonly conferenceProvider?: CalendarGatewayConferenceProvider;
      readonly conflictCalendarIds?: readonly string[];
    },
  ): Promise<CalendarGatewayBookingResolution>;
  deleteConnection(connectionId: string): Promise<void>;
}

export interface CalendarGatewayPrincipalAccess {
  readonly calendarIds: readonly string[];
  readonly writableGoogleDestinationIds: readonly string[];
}

/**
 * Derive scheduling authority only from gateway connections explicitly bound
 * to the mounted TAP principal. Workspace membership is never treated as
 * permission to use another person's provider credentials.
 */
export function calendarGatewayPrincipalAccess(
  connections: readonly CalendarGatewayConnection[],
  principalId: string,
): CalendarGatewayPrincipalAccess {
  const normalizedPrincipal = principalId.trim();
  if (!normalizedPrincipal) {
    return { calendarIds: [], writableGoogleDestinationIds: [] };
  }
  const calendarIds = new Set<string>();
  const writableGoogleDestinationIds = new Set<string>();
  for (const connection of connections) {
    if (connection.ownerPrincipalId !== normalizedPrincipal) continue;
    for (const calendar of connection.calendars) {
      calendarIds.add(calendar.id);
      if (
        connection.provider === "google" &&
        connection.mode === "oauth" &&
        connection.status === "connected" &&
        calendar.writable &&
        (calendar.role === "owner" || calendar.role === "writer")
      ) {
        writableGoogleDestinationIds.add(calendar.id);
      }
    }
  }
  return {
    calendarIds: [...calendarIds].sort(),
    writableGoogleDestinationIds: [...writableGoogleDestinationIds].sort(),
  };
}

const addUtcDays = (date: Date, amount: number): Date => {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + amount);
  return result;
};

const startOfUtcWeek = (date: Date): Date => {
  const weekday = date.getUTCDay();
  return addUtcDays(date, -(weekday === 0 ? 6 : weekday - 1));
};

export function calendarGatewayEventWindow(
  view: CalendarView,
  anchorDate: string,
): { readonly timeMin: string; readonly timeMax: string } {
  const anchor = new Date(`${anchorDate}T00:00:00.000Z`);
  if (!Number.isFinite(anchor.getTime())) {
    throw new Error("Calendar event window requires a valid date.");
  }
  let start = anchor;
  let end: Date;
  if (view === "month") {
    start = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
    end = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 1));
  } else if (view === "week" || view === "work-week") {
    start = startOfUtcWeek(anchor);
    end = addUtcDays(start, 7);
  } else if (view === "agenda") {
    end = addUtcDays(start, 30);
  } else {
    end = addUtcDays(start, 1);
  }
  return {
    timeMin: addUtcDays(start, -1).toISOString(),
    timeMax: addUtcDays(end, 1).toISOString(),
  };
}

export function createCalendarGatewayClient(input: {
  readonly baseUrl: string;
  readonly workspaceId: string;
  readonly principalId: string;
  readonly transport: CalendarGatewayTransport;
}): CalendarGatewayClient {
  const baseUrl = gatewayOrigin(input.baseUrl);
  const workspaceId = input.workspaceId.trim();
  if (!workspaceId) throw new Error("Calendar gateway workspace ID is required.");
  const principalId = input.principalId.trim();
  if (!principalId) throw new Error("Calendar gateway TAP principal ID is required.");

  const request = async <T>(
    method: "DELETE" | "GET" | "POST",
    path: string,
    body?: Readonly<Record<string, unknown>>,
  ): Promise<T> => {
    const response = await input.transport(`${baseUrl}${path}`, {
      method,
      headers: [
        { name: "Accept", value: "application/json" },
        { name: "X-TAP-Principal-Id", value: principalId },
        { name: "X-TAP-Workspace-Id", value: workspaceId },
        ...(body === undefined
          ? []
          : [{ name: "Content-Type", value: "application/json" }]),
      ],
      body: body === undefined ? null : JSON.stringify(body),
    });
    if (response.status === 204) return undefined as T;
    let parsed: unknown = null;
    try {
      parsed = response.bodyText ? JSON.parse(response.bodyText) : null;
    } catch {
      parsed = null;
    }
    if (response.status < 200 || response.status >= 300) {
      const error = isRecord(parsed) ? parsed : {};
      const currentGeneration =
        error.error === "publication_conflict" &&
          isPublicationGeneration(error.currentGeneration)
          ? error.currentGeneration
          : undefined;
      throw new CalendarGatewayError(
        response.status,
        typeof error.error === "string" ? error.error : "gateway_request_failed",
        typeof error.message === "string"
          ? error.message
          : `Calendar gateway returned HTTP ${response.status}.`,
        currentGeneration,
      );
    }
    if (!isRecord(parsed)) {
      throw new CalendarGatewayError(
        502,
        "gateway_response_invalid",
        "The Calendar gateway returned invalid JSON.",
      );
    }
    return parsed as T;
  };

  const ownedConnection = (value: unknown): CalendarGatewayConnection => {
    if (
      !isRecord(value) ||
      value.workspaceId !== workspaceId ||
      value.ownerPrincipalId !== principalId ||
      typeof value.id !== "string" ||
      !Array.isArray(value.calendars)
    ) {
      throw new CalendarGatewayError(
        502,
        "gateway_owner_mismatch",
        "The Calendar gateway returned a connection outside the mounted TAP owner boundary.",
      );
    }
    return value as unknown as CalendarGatewayConnection;
  };

  const ownedMeetingProviderConnection = (
    value: unknown,
  ): CalendarGatewayMeetingProviderConnection => {
    if (
      !isRecord(value) ||
      value.workspaceId !== workspaceId ||
      value.ownerPrincipalId !== principalId ||
      typeof value.id !== "string" ||
      !value.id.trim() ||
      value.provider !== "zoom" ||
      value.mode !== "oauth" ||
      typeof value.label !== "string" ||
      !value.label.trim() ||
      (value.status !== "pending" &&
        value.status !== "connected" &&
        value.status !== "attention") ||
      !isIsoDateTime(value.createdAt) ||
      !isIsoDateTime(value.updatedAt)
    ) {
      throw new CalendarGatewayError(
        502,
        "gateway_owner_mismatch",
        "The Calendar gateway returned a meeting-provider connection outside the mounted TAP owner boundary.",
      );
    }
    return value as unknown as CalendarGatewayMeetingProviderConnection;
  };

  const connection = async (
    method: "POST" | "GET",
    path: string,
    body?: Readonly<Record<string, unknown>>,
  ): Promise<CalendarGatewayConnection> => {
    const result = await request<{ readonly connection: unknown }>(
      method,
      path,
      body,
    );
    return ownedConnection(result.connection);
  };

  return {
    baseUrl,
    principalId,
    async workspaceBookings() {
      return request<WorkspaceBookings>("GET", "/v1/workspace-bookings");
    },
    async saveSharedHost(value) {
      await request("POST", "/v1/workspace-bookings/host", value);
    },
    async saveWorkspaceBookingProfile(value) {
      await request("POST", "/v1/workspace-bookings/profile", value);
    },
    async health() {
      return request("GET", "/health");
    },
    async providers() {
      const result = await request<unknown>("GET", "/v1/providers");
      if (!isCalendarGatewayProviderCatalog(result)) {
        throw new CalendarGatewayError(
          502,
          "gateway_response_invalid",
          "The Calendar gateway returned an invalid provider catalog.",
        );
      }
      return result;
    },
    async publicBookingAnalytics() {
      const result = await request<unknown>("GET", "/v2/publications/analytics");
      if (!isPublicBookingAnalytics(result)) {
        throw new CalendarGatewayError(502, "gateway_response_invalid",
          "The Calendar gateway returned invalid booking analytics.");
      }
      return result;
    },
    async publishPublicBookingProfile(value) {
      const result = await request<unknown>(
        "POST",
        "/v1/publications/profiles",
        serializePublicBookingProfilePublication(value),
      );
      if (!isRecord(result) || !hasExactKeys(result, ["publication"])) {
        return invalidPublicationReceipt(
          "The Calendar gateway returned an invalid Booking Profile publication response.",
        );
      }
      return publishedBookingProfileReceipt(result.publication, value);
    },
    async unpublishPublicBookingProfile(value) {
      const result = await request<unknown>(
        "POST",
        "/v1/publications/profiles/unpublish",
        {
          schemaVersion: value.schemaVersion,
          sourceProfileId: value.sourceProfileId,
          expectedGeneration: value.expectedGeneration,
        },
      );
      if (!isRecord(result) || !hasExactKeys(result, ["publication"])) {
        return invalidPublicationReceipt(
          "The Calendar gateway returned an invalid Booking Profile unpublication response.",
        );
      }
      return unpublishedBookingProfileReceipt(result.publication, value);
    },
    async listConnections() {
      const result = await request<{
        readonly connections: unknown;
      }>("GET", "/v1/connections");
      if (!Array.isArray(result.connections)) {
        throw new CalendarGatewayError(
          502,
          "gateway_response_invalid",
          "The Calendar gateway returned an invalid connection list.",
        );
      }
      return result.connections.map(ownedConnection);
    },
    async getConnection(connectionId) {
      return connection("GET", `/v1/connections/${encodeURIComponent(connectionId)}`);
    },
    async createLocalConnection(value) {
      return connection("POST", "/v1/connections/local", value);
    },
    async addLocalCalendars(connectionId, calendars) {
      return connection(
        "POST",
        `/v1/connections/${encodeURIComponent(connectionId)}/calendars/local`,
        { calendars },
      );
    },
    async removeLocalCalendars(connectionId, calendarIds) {
      return connection(
        "POST",
        `/v1/connections/${encodeURIComponent(connectionId)}/calendars/local/remove`,
        { calendarIds },
      );
    },
    async removeCalendars(connectionId, calendarIds) {
      return connection(
        "POST",
        `/v1/connections/${encodeURIComponent(connectionId)}/calendars/remove`,
        { calendarIds },
      );
    },
    async startOAuth(value) {
      const { provider, ...body } = value;
      return request(
        "POST",
        `/v1/oauth/${provider}/start`,
        body,
      );
    },
    async listMeetingProviderConnections() {
      const result = await request<{
        readonly connections: unknown;
      }>("GET", "/v1/meeting-providers/connections");
      if (!Array.isArray(result.connections)) {
        throw new CalendarGatewayError(
          502,
          "gateway_response_invalid",
          "The Calendar gateway returned an invalid meeting-provider connection list.",
        );
      }
      return result.connections.map(ownedMeetingProviderConnection);
    },
    async verifyMeetingProviderConnection(connectionId) {
      const result = await request<{ readonly connection: unknown }>(
        "POST",
        `/v1/meeting-providers/connections/${encodeURIComponent(connectionId)}/verify`,
        {},
      );
      return ownedMeetingProviderConnection(result.connection);
    },
    async deleteMeetingProviderConnection(connectionId) {
      await request(
        "DELETE",
        `/v1/meeting-providers/connections/${encodeURIComponent(connectionId)}`,
      );
    },
    async syncConnection(connectionId) {
      return connection(
        "POST",
        `/v1/connections/${encodeURIComponent(connectionId)}/sync`,
        {},
      );
    },
    async queryEvents(value) {
      const result = await request<unknown>("POST", "/v1/events/query", {
        timeMin: value.timeMin,
        timeMax: value.timeMax,
        calendarIds: [...value.calendarIds],
        ...(value.revalidate ? { revalidate: value.revalidate } : {}),
      });
      if (!isCalendarGatewayEventQueryResult(result)) {
        throw new CalendarGatewayError(
          502,
          "gateway_response_invalid",
          "The Calendar gateway returned an invalid event query response.",
        );
      }
      return result;
    },
    async confirmAvailability(value) {
      const result = await request<unknown>("POST", "/v1/availability/confirm", {
        timeMin: value.timeMin,
        timeMax: value.timeMax,
        calendarIds: [...value.calendarIds],
        idempotencyKey: value.idempotencyKey,
      });
      if (!isCalendarGatewayAvailabilityConfirmation(result)) {
        throw new CalendarGatewayError(
          502,
          "gateway_response_invalid",
          "The Calendar gateway returned an invalid availability confirmation.",
        );
      }
      return result;
    },
    async commitBooking(value) {
      const result = await request<unknown>("POST", "/v1/bookings/commit", {
        destinationCalendarId: value.destinationCalendarId,
        conflictCalendarIds: [...value.conflictCalendarIds],
        idempotencyKey: value.idempotencyKey,
        title: value.title,
        start: value.start,
        end: value.end,
        ...(value.conflictTimeMin ? { conflictTimeMin: value.conflictTimeMin } : {}),
        ...(value.conflictTimeMax ? { conflictTimeMax: value.conflictTimeMax } : {}),
        bookingKind: value.bookingKind,
        ...(value.description ? { description: value.description } : {}),
        ...(value.location ? { location: value.location } : {}),
        attendeeEmails: [...(value.attendeeEmails ?? [])],
        conferenceProvider: value.conferenceProvider ?? "none",
        ...(value.expiresAt ? { expiresAt: value.expiresAt } : {}),
      });
      if (!isCalendarGatewayBookingCommit(result)) {
        throw new CalendarGatewayError(
          502,
          "gateway_response_invalid",
          "The Calendar gateway returned an invalid booking commit response.",
        );
      }
      return result;
    },
    async getBookingStatus(idempotencyKey) {
      const result = await request<unknown>(
        "GET",
        `/v1/bookings/${encodeURIComponent(idempotencyKey)}/status`,
      );
      if (!isCalendarGatewayBookingStatus(result)) {
        throw new CalendarGatewayError(
          502,
          "gateway_response_invalid",
          "The Calendar gateway returned an invalid booking status response.",
        );
      }
      return result;
    },
    async resolveApprovalHold(bookingIdempotencyKey, value) {
      const result = await request<unknown>(
        "POST",
        `/v1/bookings/${encodeURIComponent(bookingIdempotencyKey)}/resolve`,
        {
          idempotencyKey: value.idempotencyKey,
          decision: value.decision,
          ...(value.title ? { title: value.title } : {}),
          ...(value.description ? { description: value.description } : {}),
          ...(value.location ? { location: value.location } : {}),
          attendeeEmails: [...(value.attendeeEmails ?? [])],
          conferenceProvider: value.conferenceProvider ?? "none",
          conflictCalendarIds: [...(value.conflictCalendarIds ?? [])],
        },
      );
      if (!isCalendarGatewayBookingResolution(result)) {
        throw new CalendarGatewayError(
          502,
          "gateway_response_invalid",
          "The Calendar gateway returned an invalid booking resolution response.",
        );
      }
      return result;
    },
    async deleteConnection(connectionId) {
      await request(
        "DELETE",
        `/v1/connections/${encodeURIComponent(connectionId)}`,
      );
    },
  };
}
