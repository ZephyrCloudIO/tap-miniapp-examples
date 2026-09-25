import { sdk } from "@theaiplatform/miniapp-sdk/sdk";
import type {
  MiniAppJsonValue,
  MiniAppStorageApi,
} from "@theaiplatform/miniapp-sdk/sdk";
import type { CalendarAttendee, CalendarEvent, MeetingLocation } from "./domain";
import {
  isCalendarGatewayBookingCommit,
  isCalendarGatewayBookingResolution,
  type CalendarGatewayBookingCommit,
  type CalendarGatewayBookingKind,
  type CalendarGatewayBookingResolution,
  type CalendarGatewayConferenceProvider,
} from "./gateway";
import {
  calendarPrincipalStorageAddresses,
  legacyCalendarStorageAddresses,
  mayAdoptLegacyCalendarStorage,
} from "./principal-storage";

export const providerBookingOutboxStorageAddress =
  legacyCalendarStorageAddresses.bookingOutbox;

export const previewProviderBookingOutboxStorageKey =
  "tap-example.tap-calendar.provider-booking-outbox.v1";

export const PROVIDER_BOOKING_OUTBOX_MAX_RECORDS = 48;
export const PROVIDER_BOOKING_OUTBOX_MAX_BYTES = 512 * 1024;

const MAX_ID_LENGTH = 512;
const MAX_PROVIDER_EVENT_ID_LENGTH = 2_048;
const MAX_NORMALIZED_EVENT_ID_LENGTH = 4_096;
const MAX_TITLE_LENGTH = 1_024;
const MAX_DETAIL_LENGTH = 8_192;
const MAX_URL_LENGTH = 4_096;
const MAX_CALENDAR_IDS = 128;
const MAX_ATTENDEES = 100;
const MAX_CAS_ATTEMPTS = 8;

export interface ProviderBookingOutboxProviderRequest {
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
}

export interface ProviderBookingScheduleReconciliation {
  readonly kind: "schedule-meeting" | "public-booking";
  readonly title: string;
  readonly calendarId: string;
  readonly start: string;
  readonly end: string;
  readonly location: MeetingLocation | null;
  readonly attendees: readonly CalendarAttendee[];
  readonly approvalRequired: boolean;
  readonly eventTypeId?: string;
  readonly requestedAt: string;
}

export interface ProviderBookingWorkBlockReconciliation {
  readonly kind: "work-block";
  readonly title: string;
  readonly calendarId: string;
  readonly start: string;
  readonly end: string;
  readonly sourceKind: "task" | "channel" | "message";
  readonly sourceId: string;
  readonly sourceLabel: string;
}

export type ProviderBookingReconciliation =
  | ProviderBookingScheduleReconciliation
  | ProviderBookingWorkBlockReconciliation;

interface ProviderBookingOutboxRecordBase {
  readonly idempotencyKey: string;
  readonly request: ProviderBookingOutboxProviderRequest;
  readonly reconciliation: ProviderBookingReconciliation;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PreparedProviderBookingOutboxRecord
  extends ProviderBookingOutboxRecordBase {
  readonly phase: "prepared";
}

export interface CommittedProviderBookingOutboxRecord
  extends ProviderBookingOutboxRecordBase {
  readonly phase: "provider-committed";
  readonly providerCommit: CalendarGatewayBookingCommit;
}

export type ProviderBookingOutboxRecord =
  | PreparedProviderBookingOutboxRecord
  | CommittedProviderBookingOutboxRecord;

export interface ProviderBookingOutboxSnapshot {
  readonly schemaVersion: 1;
  readonly records: readonly ProviderBookingOutboxRecord[];
  readonly resolutions: readonly ProviderApprovalResolutionOutboxRecord[];
}

export interface ProviderBookingOutboxPreparation {
  readonly request: ProviderBookingOutboxProviderRequest;
  readonly reconciliation: ProviderBookingReconciliation;
}

export interface ProviderApprovalResolutionRequest {
  readonly idempotencyKey: string;
  readonly decision: "approve" | "decline";
  readonly title?: string;
  readonly description?: string;
  readonly location?: string;
  readonly attendeeEmails?: readonly string[];
  readonly conferenceProvider?: CalendarGatewayConferenceProvider;
  readonly conflictCalendarIds?: readonly string[];
}

export interface ProviderApprovalResolutionReconciliation {
  readonly bookingRequestId: string;
  readonly decision: "approve" | "decline";
  /** Provider-semantic fingerprint of the local pending Hold being decided. */
  readonly expectedEvent: {
    /** The normalized TAP Calendar Event ID, not the raw provider Event ID. */
    readonly id: string;
    readonly title: string;
    readonly calendarId: string;
    readonly start: string;
    readonly end: string;
    readonly kind: "hold";
    readonly status: "pending";
    readonly location: MeetingLocation | null;
    readonly attendees: readonly CalendarAttendee[];
  };
}

interface ProviderApprovalResolutionOutboxRecordBase {
  readonly resolutionIdempotencyKey: string;
  readonly bookingIdempotencyKey: string;
  readonly request: ProviderApprovalResolutionRequest;
  readonly reconciliation: ProviderApprovalResolutionReconciliation;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PreparedProviderApprovalResolutionOutboxRecord
  extends ProviderApprovalResolutionOutboxRecordBase {
  readonly phase: "prepared";
}

export interface CommittedProviderApprovalResolutionOutboxRecord
  extends ProviderApprovalResolutionOutboxRecordBase {
  readonly phase: "provider-committed";
  readonly providerResolution: CalendarGatewayBookingResolution;
}

export type ProviderApprovalResolutionOutboxRecord =
  | PreparedProviderApprovalResolutionOutboxRecord
  | CommittedProviderApprovalResolutionOutboxRecord;

export interface ProviderApprovalResolutionOutboxPreparation {
  readonly bookingIdempotencyKey: string;
  readonly request: ProviderApprovalResolutionRequest;
  readonly reconciliation: ProviderApprovalResolutionReconciliation;
}

export interface ProviderBookingOutboxStorageEntry {
  readonly value: MiniAppJsonValue | null;
  readonly revision: number | null;
}

export interface ProviderBookingOutboxStoragePort {
  get(
    address: typeof providerBookingOutboxStorageAddress,
  ): Promise<ProviderBookingOutboxStorageEntry>;
  set(
    input: typeof providerBookingOutboxStorageAddress & {
      readonly value: MiniAppJsonValue;
      readonly expectedRevision: number | null;
    },
  ): Promise<{ readonly revision: number }>;
}

export interface ProviderBookingOutbox {
  load(): Promise<ProviderBookingOutboxSnapshot>;
  /** Must resolve before the caller starts the provider request. */
  putBeforeProviderCall(
    preparation: ProviderBookingOutboxPreparation,
  ): Promise<ProviderBookingOutboxRecord>;
  markProviderCommitted(
    idempotencyKey: string,
    result: CalendarGatewayBookingCommit,
  ): Promise<CommittedProviderBookingOutboxRecord>;
  listAwaitingProvider(): Promise<readonly PreparedProviderBookingOutboxRecord[]>;
  listPendingReconciliation(): Promise<readonly CommittedProviderBookingOutboxRecord[]>;
  removeAfterLocalReconciliation(
    idempotencyKey: string,
    normalizedLocalEventId: string,
  ): Promise<boolean>;
  discardPreparedAfterDefinitiveProviderFailure(
    idempotencyKey: string,
  ): Promise<boolean>;
  /** Must resolve before the caller starts the gateway approval-resolution request. */
  putApprovalResolutionBeforeProviderCall(
    preparation: ProviderApprovalResolutionOutboxPreparation,
  ): Promise<ProviderApprovalResolutionOutboxRecord>;
  markApprovalResolutionCommitted(
    resolutionIdempotencyKey: string,
    result: CalendarGatewayBookingResolution,
  ): Promise<CommittedProviderApprovalResolutionOutboxRecord>;
  listApprovalResolutionsAwaitingProvider(): Promise<
    readonly PreparedProviderApprovalResolutionOutboxRecord[]
  >;
  listPendingApprovalResolutionReconciliation(): Promise<
    readonly CommittedProviderApprovalResolutionOutboxRecord[]
  >;
  removeApprovalResolutionAfterLocalReconciliation(
    resolutionIdempotencyKey: string,
    normalizedLocalEventId: string,
  ): Promise<boolean>;
  discardPreparedApprovalResolutionAfterDefinitiveProviderFailure(
    resolutionIdempotencyKey: string,
  ): Promise<boolean>;
}

export class ProviderBookingOutboxDataError extends Error {
  constructor(message = "The stored provider booking outbox is invalid or unsupported.") {
    super(message);
    this.name = "ProviderBookingOutboxDataError";
  }
}

export class ProviderBookingOutboxConflictError extends Error {
  constructor() {
    super("TAP Calendar could not merge concurrent provider booking outbox changes.");
    this.name = "ProviderBookingOutboxConflictError";
  }
}

export class ProviderBookingOutboxInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderBookingOutboxInvariantError";
  }
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isBoundedString = (
  value: unknown,
  maximum: number,
  allowEmpty = false,
): value is string =>
  typeof value === "string" &&
  value.length <= maximum &&
  (allowEmpty || value.length > 0) &&
  value.trim() === value;

const isIsoDateTime = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= 64 &&
  Number.isFinite(Date.parse(value));

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const jsonSize = (value: unknown): number =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;

const assertBoundedSnapshot = (snapshot: ProviderBookingOutboxSnapshot): void => {
  if (
    snapshot.records.length > PROVIDER_BOOKING_OUTBOX_MAX_RECORDS ||
    snapshot.resolutions.length > PROVIDER_BOOKING_OUTBOX_MAX_RECORDS
  ) {
    throw new ProviderBookingOutboxDataError(
      `The provider booking outbox is full (${PROVIDER_BOOKING_OUTBOX_MAX_RECORDS} records per operation kind).`,
    );
  }
  if (jsonSize(snapshot) > PROVIDER_BOOKING_OUTBOX_MAX_BYTES) {
    throw new ProviderBookingOutboxDataError(
      `The provider booking outbox exceeds ${PROVIDER_BOOKING_OUTBOX_MAX_BYTES} bytes.`,
    );
  }
};

const normalizeId = (value: unknown, label: string): string => {
  if (!isBoundedString(value, MAX_ID_LENGTH)) {
    throw new ProviderBookingOutboxInvariantError(`${label} is invalid.`);
  }
  return value;
};

const normalizeNormalizedEventId = (value: unknown): string => {
  if (!isBoundedString(value, MAX_NORMALIZED_EVENT_ID_LENGTH)) {
    throw new ProviderBookingOutboxInvariantError(
      "Normalized local Event ID is invalid.",
    );
  }
  return value;
};

const normalizeDetail = (
  value: unknown,
  label: string,
  maximum = MAX_DETAIL_LENGTH,
): string => {
  if (!isBoundedString(value, maximum)) {
    throw new ProviderBookingOutboxInvariantError(`${label} is invalid.`);
  }
  return value;
};

const normalizeOptionalDetail = (
  value: unknown,
  label: string,
  maximum = MAX_DETAIL_LENGTH,
): string | undefined => {
  if (value === undefined) return undefined;
  return normalizeDetail(value, label, maximum);
};

const normalizeDateTime = (value: unknown, label: string): string => {
  if (!isIsoDateTime(value)) {
    throw new ProviderBookingOutboxInvariantError(`${label} is invalid.`);
  }
  return new Date(value).toISOString();
};

const meetingLocations = new Set<MeetingLocation>([
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
]);

const providerMeetingLocationNames: Readonly<Record<MeetingLocation, string>> = {
  "tap-room": "TAP meeting room",
  "tap-huddle": "Scheduled TAP Voice Huddle",
  "google-meet": "Google Meet",
  "microsoft-teams": "Microsoft Teams",
  zoom: "Zoom",
  webex: "Webex",
  goto: "GoTo Meeting",
  phone: "Phone call",
  physical: "Physical location",
  custom: "Custom link or instructions",
};

const bookingKinds = new Set<CalendarGatewayBookingKind>([
  "meeting",
  "approval-hold",
  "work-block",
]);

const conferenceProviders = new Set<CalendarGatewayConferenceProvider>([
  "none",
  "google-meet",
  "zoom",
]);

const normalizeStringList = (
  value: unknown,
  label: string,
  maximumItems: number,
  itemMaximum = MAX_ID_LENGTH,
): readonly string[] => {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new ProviderBookingOutboxInvariantError(`${label} is invalid.`);
  }
  const normalized = value.map((item, index) =>
    normalizeDetail(item, `${label}[${index}]`, itemMaximum)
  );
  if (new Set(normalized).size !== normalized.length) {
    throw new ProviderBookingOutboxInvariantError(`${label} contains duplicates.`);
  }
  return normalized;
};

const normalizeEmailList = (value: unknown): readonly string[] => {
  const emails = normalizeStringList(value, "Attendee emails", MAX_ATTENDEES, 320)
    .map(email => email.toLowerCase());
  if (emails.some(email => !email.includes("@"))) {
    throw new ProviderBookingOutboxInvariantError("An attendee email is invalid.");
  }
  return [...new Set(emails)].sort();
};

const normalizeAttendee = (value: unknown): CalendarAttendee => {
  if (!isRecord(value)) {
    throw new ProviderBookingOutboxInvariantError("A reconciliation attendee is invalid.");
  }
  if (value.kind !== "tap" && value.kind !== "external") {
    throw new ProviderBookingOutboxInvariantError("A reconciliation attendee kind is invalid.");
  }
  if (typeof value.required !== "boolean") {
    throw new ProviderBookingOutboxInvariantError("A reconciliation attendee requirement is invalid.");
  }
  const email = normalizeDetail(value.email, "Attendee email", 320).toLowerCase();
  if (!email.includes("@")) {
    throw new ProviderBookingOutboxInvariantError("An attendee email is invalid.");
  }
  return {
    id: normalizeId(value.id, "Attendee ID"),
    name: normalizeDetail(value.name, "Attendee name", 512),
    email,
    kind: value.kind,
    required: value.required,
  };
};

const normalizeProviderRequest = (
  value: unknown,
): ProviderBookingOutboxProviderRequest => {
  if (!isRecord(value) || !bookingKinds.has(value.bookingKind as CalendarGatewayBookingKind)) {
    throw new ProviderBookingOutboxInvariantError("The provider booking request is invalid.");
  }
  const destinationCalendarId = normalizeId(
    value.destinationCalendarId,
    "Destination calendar ID",
  );
  const conflictCalendarIds = [
    ...normalizeStringList(
      value.conflictCalendarIds,
      "Conflict calendar IDs",
      MAX_CALENDAR_IDS,
    ),
  ].sort();
  if (!conflictCalendarIds.includes(destinationCalendarId)) {
    throw new ProviderBookingOutboxInvariantError(
      "Conflict calendar IDs must include the destination calendar.",
    );
  }
  const start = normalizeDateTime(value.start, "Provider booking start");
  const end = normalizeDateTime(value.end, "Provider booking end");
  if (Date.parse(end) <= Date.parse(start)) {
    throw new ProviderBookingOutboxInvariantError(
      "The provider booking must end after it starts.",
    );
  }
  const conflictTimeMin = value.conflictTimeMin === undefined
    ? undefined
    : normalizeDateTime(value.conflictTimeMin, "Provider conflict-check start");
  const conflictTimeMax = value.conflictTimeMax === undefined
    ? undefined
    : normalizeDateTime(value.conflictTimeMax, "Provider conflict-check end");
  if ((conflictTimeMin === undefined) !== (conflictTimeMax === undefined)) {
    throw new ProviderBookingOutboxInvariantError(
      "A provider conflict-check range requires both boundaries.",
    );
  }
  if (
    conflictTimeMin !== undefined && conflictTimeMax !== undefined &&
    (
      Date.parse(conflictTimeMin) > Date.parse(start) ||
      Date.parse(conflictTimeMax) < Date.parse(end) ||
      Date.parse(conflictTimeMax) <= Date.parse(conflictTimeMin) ||
      Date.parse(conflictTimeMax) - Date.parse(conflictTimeMin) > 7 * 86_400_000
    )
  ) {
    throw new ProviderBookingOutboxInvariantError(
      "The provider conflict-check range must contain the booking and span no more than seven days.",
    );
  }
  const conferenceProvider = value.conferenceProvider === undefined
    ? undefined
    : conferenceProviders.has(value.conferenceProvider as CalendarGatewayConferenceProvider)
      ? value.conferenceProvider as CalendarGatewayConferenceProvider
      : null;
  if (conferenceProvider === null) {
    throw new ProviderBookingOutboxInvariantError("Conference provider is invalid.");
  }
  const expiresAt = value.expiresAt === undefined
    ? undefined
    : normalizeDateTime(value.expiresAt, "Approval hold expiration");
  if (value.bookingKind === "approval-hold" && expiresAt === undefined) {
    throw new ProviderBookingOutboxInvariantError(
      "An approval hold requires an expiration time.",
    );
  }
  return {
    destinationCalendarId,
    conflictCalendarIds,
    idempotencyKey: normalizeId(value.idempotencyKey, "Provider idempotency key"),
    title: normalizeDetail(value.title, "Provider booking title", MAX_TITLE_LENGTH),
    start,
    end,
    ...(conflictTimeMin !== undefined && conflictTimeMax !== undefined
      ? { conflictTimeMin, conflictTimeMax }
      : {}),
    bookingKind: value.bookingKind as CalendarGatewayBookingKind,
    ...(normalizeOptionalDetail(value.description, "Provider booking description") !== undefined
      ? { description: normalizeOptionalDetail(value.description, "Provider booking description")! }
      : {}),
    ...(normalizeOptionalDetail(value.location, "Provider booking location") !== undefined
      ? { location: normalizeOptionalDetail(value.location, "Provider booking location")! }
      : {}),
    ...(value.attendeeEmails !== undefined
      ? { attendeeEmails: normalizeEmailList(value.attendeeEmails) }
      : {}),
    ...(conferenceProvider !== undefined ? { conferenceProvider } : {}),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
  };
};

const normalizeReconciliation = (
  value: unknown,
): ProviderBookingReconciliation => {
  if (!isRecord(value)) {
    throw new ProviderBookingOutboxInvariantError("The local reconciliation intent is invalid.");
  }
  const calendarId = normalizeId(value.calendarId, "Reconciliation calendar ID");
  const title = normalizeDetail(value.title, "Reconciliation title", MAX_TITLE_LENGTH);
  const start = normalizeDateTime(value.start, "Reconciliation start");
  const end = normalizeDateTime(value.end, "Reconciliation end");
  if (Date.parse(end) <= Date.parse(start)) {
    throw new ProviderBookingOutboxInvariantError(
      "The reconciliation booking must end after it starts.",
    );
  }
  if (value.kind === "work-block") {
    if (value.sourceKind !== "task" && value.sourceKind !== "channel" && value.sourceKind !== "message") {
      throw new ProviderBookingOutboxInvariantError("The Work Block source kind is invalid.");
    }
    return {
      kind: "work-block",
      title,
      calendarId,
      start,
      end,
      sourceKind: value.sourceKind,
      sourceId: normalizeId(value.sourceId, "Work Block source ID"),
      sourceLabel: normalizeDetail(value.sourceLabel, "Work Block source label", 1_024),
    };
  }
  if (value.kind !== "schedule-meeting" && value.kind !== "public-booking") {
    throw new ProviderBookingOutboxInvariantError("The local reconciliation kind is invalid.");
  }
  if (value.location !== null && !meetingLocations.has(value.location as MeetingLocation)) {
    throw new ProviderBookingOutboxInvariantError("The reconciliation meeting location is invalid.");
  }
  if (!Array.isArray(value.attendees) || value.attendees.length > MAX_ATTENDEES) {
    throw new ProviderBookingOutboxInvariantError("Reconciliation attendees are invalid.");
  }
  if (typeof value.approvalRequired !== "boolean") {
    throw new ProviderBookingOutboxInvariantError("Approval requirement is invalid.");
  }
  const eventTypeId = value.eventTypeId === undefined
    ? undefined
    : normalizeId(value.eventTypeId, "Event Type ID");
  if (value.kind === "public-booking" && eventTypeId === undefined) {
    throw new ProviderBookingOutboxInvariantError(
      "A public booking reconciliation requires an Event Type ID.",
    );
  }
  return {
    kind: value.kind,
    title,
    calendarId,
    start,
    end,
    location: value.location as MeetingLocation | null,
    attendees: value.attendees.map(normalizeAttendee),
    approvalRequired: value.approvalRequired,
    ...(eventTypeId !== undefined ? { eventTypeId } : {}),
    requestedAt: normalizeDateTime(value.requestedAt, "Booking request time"),
  };
};

const assertPreparationMatches = (
  request: ProviderBookingOutboxProviderRequest,
  reconciliation: ProviderBookingReconciliation,
): void => {
  if (
    request.destinationCalendarId !== reconciliation.calendarId ||
    request.title !== reconciliation.title ||
    request.start !== reconciliation.start ||
    request.end !== reconciliation.end
  ) {
    throw new ProviderBookingOutboxInvariantError(
      "The provider request and local reconciliation describe different bookings.",
    );
  }
  const expectedKind = reconciliation.kind === "work-block"
    ? "work-block"
    : reconciliation.approvalRequired
      ? "approval-hold"
      : "meeting";
  if (request.bookingKind !== expectedKind) {
    throw new ProviderBookingOutboxInvariantError(
      "The provider request kind does not match local reconciliation.",
    );
  }
  if (
    request.bookingKind === "approval-hold" &&
    reconciliation.kind !== "work-block"
  ) {
    const localExpiration = new Date(
      Date.parse(reconciliation.requestedAt) + 24 * 60 * 60 * 1_000,
    ).toISOString();
    if (request.expiresAt !== localExpiration) {
      throw new ProviderBookingOutboxInvariantError(
        "The provider approval deadline does not match the local 24-hour hold.",
      );
    }
  }
  const reconciliationEmails = reconciliation.kind === "work-block"
    ? []
    : [...new Set(reconciliation.attendees.map(attendee => attendee.email.toLowerCase()))].sort();
  const providerEmails = request.attendeeEmails ?? [];
  if (JSON.stringify(providerEmails) !== JSON.stringify(reconciliationEmails)) {
    throw new ProviderBookingOutboxInvariantError(
      "Provider attendee emails do not match local reconciliation.",
    );
  }
  const conferenceProvider = request.conferenceProvider ?? "none";
  if (reconciliation.kind === "work-block") {
    if (conferenceProvider !== "none" || request.location !== undefined) {
      throw new ProviderBookingOutboxInvariantError(
        "A Work Block cannot recover as a meeting location or conference.",
      );
    }
    return;
  }
  if (reconciliation.location === "google-meet" && request.bookingKind === "meeting") {
    if (conferenceProvider !== "google-meet" || request.location !== undefined) {
      throw new ProviderBookingOutboxInvariantError(
        "A Google Meet reconciliation requires a Google Meet provider conference.",
      );
    }
    return;
  }
  if (reconciliation.location === "zoom" && request.bookingKind === "meeting") {
    if (conferenceProvider !== "zoom" || request.location !== undefined) {
      throw new ProviderBookingOutboxInvariantError(
        "A Zoom reconciliation requires a Zoom provider conference.",
      );
    }
    return;
  }
  if (
    conferenceProvider !== "none" ||
    request.location !== (reconciliation.location === null ? undefined : providerMeetingLocationNames[reconciliation.location])
  ) {
    throw new ProviderBookingOutboxInvariantError(
      "The provider location does not match local reconciliation.",
    );
  }
};

const normalizePreparation = (
  value: ProviderBookingOutboxPreparation,
): ProviderBookingOutboxPreparation => {
  const request = normalizeProviderRequest(value.request);
  const reconciliation = normalizeReconciliation(value.reconciliation);
  assertPreparationMatches(request, reconciliation);
  return { request, reconciliation };
};

const normalizeProviderEvent = (event: CalendarEvent): CalendarEvent => {
  if (event.attendees.length > MAX_ATTENDEES) {
    throw new ProviderBookingOutboxInvariantError("The provider returned too many attendees.");
  }
  const providerHtmlLink = event.providerHtmlLink === undefined
    ? undefined
    : normalizeDetail(event.providerHtmlLink, "Provider event link", MAX_URL_LENGTH);
  const providerJoinUrl = event.providerJoinUrl === undefined
    ? undefined
    : normalizeDetail(event.providerJoinUrl, "Provider join link", MAX_URL_LENGTH);
  if (providerHtmlLink !== undefined && !providerHtmlLink.startsWith("https://")) {
    throw new ProviderBookingOutboxInvariantError("The provider event link must use HTTPS.");
  }
  if (providerJoinUrl !== undefined && !providerJoinUrl.startsWith("https://")) {
    throw new ProviderBookingOutboxInvariantError("The provider join link must use HTTPS.");
  }
  return {
    id: normalizeNormalizedEventId(event.id),
    calendarId: normalizeId(event.calendarId, "Provider Event calendar ID"),
    title: normalizeDetail(event.title, "Provider Event title", MAX_TITLE_LENGTH),
    start: normalizeDateTime(event.start, "Provider Event start"),
    end: normalizeDateTime(event.end, "Provider Event end"),
    kind: event.kind,
    status: event.status,
    location: event.location,
    attendees: event.attendees.map(normalizeAttendee),
    ...(event.busy !== undefined ? { busy: event.busy } : {}),
    ...(event.allDay !== undefined ? { allDay: event.allDay } : {}),
    ...(providerHtmlLink !== undefined ? { providerHtmlLink } : {}),
    ...(providerJoinUrl !== undefined ? { providerJoinUrl } : {}),
    ...(event.source
      ? {
          source: {
            kind: event.source.kind,
            id: normalizeId(event.source.id, "Provider Event source ID"),
            label: normalizeDetail(event.source.label, "Provider Event source label", 1_024),
          },
        }
      : {}),
  };
};

const normalizeProviderCommit = (
  value: unknown,
): CalendarGatewayBookingCommit => {
  if (!isCalendarGatewayBookingCommit(value)) {
    throw new ProviderBookingOutboxInvariantError(
      "The provider booking response is invalid.",
    );
  }
  const event = normalizeProviderEvent(value.booking.event);
  const providerHtmlLink = value.booking.providerHtmlLink === null
    ? null
    : normalizeDetail(value.booking.providerHtmlLink, "Provider booking link", MAX_URL_LENGTH);
  const providerJoinUrl = value.booking.providerJoinUrl === null
    ? null
    : normalizeDetail(value.booking.providerJoinUrl, "Provider booking join link", MAX_URL_LENGTH);
  if (providerHtmlLink !== null && !providerHtmlLink.startsWith("https://")) {
    throw new ProviderBookingOutboxInvariantError("The provider booking link must use HTTPS.");
  }
  if (providerJoinUrl !== null && !providerJoinUrl.startsWith("https://")) {
    throw new ProviderBookingOutboxInvariantError("The provider booking join link must use HTTPS.");
  }
  const pendingAttendeeEmails = normalizeEmailList(
    value.booking.pendingAttendeeEmails,
  );
  const approvalExpiresAt = value.booking.approvalExpiresAt === null
    ? null
    : normalizeDateTime(
        value.booking.approvalExpiresAt,
        "Provider approval expiration",
      );
  return {
    booking: {
      state: "committed",
      provider: "google",
      providerEventId: normalizeDetail(
        value.booking.providerEventId,
        "Committed provider Event ID",
        MAX_PROVIDER_EVENT_ID_LENGTH,
      ),
      destinationCalendarId: normalizeId(
        value.booking.destinationCalendarId,
        "Committed destination calendar ID",
      ),
      bookingKind: value.booking.bookingKind,
      approvalStatus: value.booking.approvalStatus,
      pendingAttendeeEmails,
      approvalExpiresAt,
      providerHtmlLink,
      providerJoinUrl,
      conferenceStatus: value.booking.conferenceStatus,
      event,
    },
    committedAt: normalizeDateTime(value.committedAt, "Provider commit time"),
    idempotentReplay: value.idempotentReplay,
    concurrencyBoundary: "tap-conflict-calendar-set-serialized",
  };
};

const assertCommitMatchesRequest = (
  request: ProviderBookingOutboxProviderRequest,
  result: CalendarGatewayBookingCommit,
): void => {
  const { booking } = result;
  const expectedEventKind = request.bookingKind === "approval-hold"
    ? "hold"
    : request.bookingKind === "work-block"
      ? "work-block"
      : "meeting";
  const expectedStatus = request.bookingKind === "approval-hold" ? "pending" : "confirmed";
  const titleMatches = request.bookingKind === "approval-hold"
    ? booking.event.title.length > 0
    : booking.event.title === request.title;
  if (
    booking.destinationCalendarId !== request.destinationCalendarId ||
    booking.bookingKind !== request.bookingKind ||
    booking.event.calendarId !== request.destinationCalendarId ||
    !titleMatches ||
    booking.event.start !== request.start ||
    booking.event.end !== request.end ||
    booking.event.kind !== expectedEventKind ||
    booking.event.status !== expectedStatus
  ) {
    throw new ProviderBookingOutboxInvariantError(
      "The committed provider booking does not match its prepared request.",
    );
  }
  const expectedProviderAttendeeEmails = request.bookingKind === "meeting"
    ? request.attendeeEmails ?? []
    : [];
  const committedAttendeeEmails = booking.event.attendees
    .map(attendee => attendee.email.toLowerCase())
    .sort();
  const expectedProviderLocation = request.conferenceProvider === "google-meet"
    ? booking.conferenceStatus === "ready"
      ? "google-meet"
      : null
    : request.conferenceProvider === "zoom"
      ? "zoom"
    : request.location === undefined
      ? null
      : "physical";
  const conferenceValid = request.conferenceProvider === "google-meet"
    ? (
        (booking.conferenceStatus === "ready" && booking.providerJoinUrl !== null) ||
        (booking.conferenceStatus === "pending" && booking.providerJoinUrl === null)
      )
    : request.conferenceProvider === "zoom"
      ? booking.conferenceStatus === "ready" && booking.providerJoinUrl !== null
    : booking.conferenceStatus === "none" && booking.providerJoinUrl === null;
  const eventLinksAgree =
    (booking.event.providerHtmlLink === undefined ||
      booking.event.providerHtmlLink === booking.providerHtmlLink) &&
    (booking.event.providerJoinUrl === undefined ||
      booking.event.providerJoinUrl === booking.providerJoinUrl);
  if (
    JSON.stringify(committedAttendeeEmails) !==
      JSON.stringify(expectedProviderAttendeeEmails) ||
    booking.event.location !== expectedProviderLocation ||
    !conferenceValid ||
    !eventLinksAgree
  ) {
    throw new ProviderBookingOutboxInvariantError(
      "The committed provider Event semantics do not match the prepared request.",
    );
  }
  if (
    (request.bookingKind === "approval-hold") !==
      (booking.approvalStatus === "pending")
  ) {
    throw new ProviderBookingOutboxInvariantError(
      "The provider approval state does not match its prepared request.",
    );
  }
  const expectedPendingAttendees = request.bookingKind === "approval-hold"
    ? request.attendeeEmails ?? []
    : [];
  const expectedApprovalExpiration = request.bookingKind === "approval-hold"
    ? request.expiresAt ?? null
    : null;
  if (
    JSON.stringify(booking.pendingAttendeeEmails) !==
      JSON.stringify(expectedPendingAttendees) ||
    booking.approvalExpiresAt !== expectedApprovalExpiration
  ) {
    throw new ProviderBookingOutboxInvariantError(
      "The committed provider approval details do not match the prepared request.",
    );
  }
};

const normalizeApprovalResolutionRequest = (
  value: unknown,
): ProviderApprovalResolutionRequest => {
  if (!isRecord(value) || (value.decision !== "approve" && value.decision !== "decline")) {
    throw new ProviderBookingOutboxInvariantError(
      "The provider approval-resolution request is invalid.",
    );
  }
  const attendeeEmails = value.attendeeEmails === undefined
    ? []
    : normalizeEmailList(value.attendeeEmails);
  const conferenceProvider = value.conferenceProvider === undefined
    ? "none"
    : conferenceProviders.has(value.conferenceProvider as CalendarGatewayConferenceProvider)
      ? value.conferenceProvider as CalendarGatewayConferenceProvider
      : null;
  if (conferenceProvider === null) {
    throw new ProviderBookingOutboxInvariantError(
      "The approval-resolution conference provider is invalid.",
    );
  }
  const conflictCalendarIds = value.conflictCalendarIds === undefined
    ? []
    : [
        ...normalizeStringList(
          value.conflictCalendarIds,
          "Approval-resolution conflict calendar IDs",
          MAX_CALENDAR_IDS,
        ),
      ].sort();
  if (value.decision === "approve" && conflictCalendarIds.length === 0) {
    throw new ProviderBookingOutboxInvariantError(
      "Approving a hold requires the current Conflict Calendars.",
    );
  }
  if (
    value.decision === "decline" &&
    (attendeeEmails.length > 0 || conferenceProvider !== "none")
  ) {
    throw new ProviderBookingOutboxInvariantError(
      "Declining a hold cannot invite attendees or create a conference.",
    );
  }
  const title = normalizeOptionalDetail(
    value.title,
    "Approval-resolution title",
    MAX_TITLE_LENGTH,
  );
  const description = normalizeOptionalDetail(
    value.description,
    "Approval-resolution description",
  );
  const location = normalizeOptionalDetail(
    value.location,
    "Approval-resolution location",
  );
  return {
    idempotencyKey: normalizeId(
      value.idempotencyKey,
      "Approval-resolution idempotency key",
    ),
    decision: value.decision,
    ...(title !== undefined ? { title } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(location !== undefined ? { location } : {}),
    attendeeEmails,
    conferenceProvider,
    conflictCalendarIds,
  };
};

const normalizeApprovalResolutionReconciliation = (
  value: unknown,
): ProviderApprovalResolutionReconciliation => {
  if (
    !isRecord(value) ||
    (value.decision !== "approve" && value.decision !== "decline")
  ) {
    throw new ProviderBookingOutboxInvariantError(
      "The approval-resolution reconciliation intent is invalid.",
    );
  }
  if (!isRecord(value.expectedEvent)) {
    throw new ProviderBookingOutboxInvariantError(
      "The expected pending Hold fingerprint is invalid.",
    );
  }
  const expected = value.expectedEvent;
  if (expected.kind !== "hold" || expected.status !== "pending") {
    throw new ProviderBookingOutboxInvariantError(
      "Approval resolution requires a pending local Hold.",
    );
  }
  if (
    expected.location !== null &&
    !meetingLocations.has(expected.location as MeetingLocation)
  ) {
    throw new ProviderBookingOutboxInvariantError(
      "The expected Hold location is invalid.",
    );
  }
  if (!Array.isArray(expected.attendees) || expected.attendees.length > MAX_ATTENDEES) {
    throw new ProviderBookingOutboxInvariantError(
      "The expected Hold attendees are invalid.",
    );
  }
  const attendees = expected.attendees.map(normalizeAttendee);
  if (new Set(attendees.map(attendee => attendee.email)).size !== attendees.length) {
    throw new ProviderBookingOutboxInvariantError(
      "The expected Hold contains duplicate attendee emails.",
    );
  }
  const start = normalizeDateTime(expected.start, "Expected Hold start");
  const end = normalizeDateTime(expected.end, "Expected Hold end");
  if (Date.parse(end) <= Date.parse(start)) {
    throw new ProviderBookingOutboxInvariantError(
      "The expected Hold must end after it starts.",
    );
  }
  return {
    bookingRequestId: normalizeId(
      value.bookingRequestId,
      "Local Booking Request ID",
    ),
    decision: value.decision,
    expectedEvent: {
      id: normalizeNormalizedEventId(expected.id),
      title: normalizeDetail(expected.title, "Expected Hold title", MAX_TITLE_LENGTH),
      calendarId: normalizeId(expected.calendarId, "Expected Hold calendar ID"),
      start,
      end,
      kind: "hold",
      status: "pending",
      location: expected.location as MeetingLocation | null,
      attendees,
    },
  };
};

const normalizeApprovalResolutionPreparation = (
  value: ProviderApprovalResolutionOutboxPreparation,
): ProviderApprovalResolutionOutboxPreparation => {
  const bookingIdempotencyKey = normalizeId(
    value.bookingIdempotencyKey,
    "Booking idempotency key",
  );
  const request = normalizeApprovalResolutionRequest(value.request);
  const reconciliation = normalizeApprovalResolutionReconciliation(
    value.reconciliation,
  );
  if (
    reconciliation.bookingRequestId !== bookingIdempotencyKey ||
    reconciliation.decision !== request.decision
  ) {
    throw new ProviderBookingOutboxInvariantError(
      "The provider approval resolution and local reconciliation describe different decisions.",
    );
  }
  if (request.decision === "approve") {
    const expected = reconciliation.expectedEvent;
    const expectedEmails = [
      ...new Set(expected.attendees.map(attendee => attendee.email.toLowerCase())),
    ].sort();
    const expectedConference = expected.location === "google-meet"
      ? "google-meet"
      : expected.location === "zoom"
        ? "zoom"
        : "none";
    const expectedLocation = expected.location === null ||
        expected.location === "google-meet" || expected.location === "zoom"
      ? undefined
      : providerMeetingLocationNames[expected.location];
    if (
      request.title !== expected.title ||
      JSON.stringify(request.attendeeEmails ?? []) !==
        JSON.stringify(expectedEmails) ||
      (request.conferenceProvider ?? "none") !== expectedConference ||
      request.location !== expectedLocation
    ) {
      throw new ProviderBookingOutboxInvariantError(
        "The provider approval request does not match the expected local Hold.",
      );
    }
  }
  return { bookingIdempotencyKey, request, reconciliation };
};

const normalizeProviderResolution = (
  value: unknown,
): CalendarGatewayBookingResolution => {
  if (!isCalendarGatewayBookingResolution(value)) {
    throw new ProviderBookingOutboxInvariantError(
      "The provider approval-resolution response is invalid.",
    );
  }
  const providerJoinUrl = value.resolution.providerJoinUrl === null
    ? null
    : normalizeDetail(
        value.resolution.providerJoinUrl,
        "Resolved provider join link",
        MAX_URL_LENGTH,
      );
  if (providerJoinUrl !== null && !providerJoinUrl.startsWith("https://")) {
    throw new ProviderBookingOutboxInvariantError(
      "The resolved provider join link must use HTTPS.",
    );
  }
  return {
    resolution: {
      state: "committed",
      decision: value.resolution.decision,
      bookingIdempotencyKey: normalizeId(
        value.resolution.bookingIdempotencyKey,
        "Resolved Booking idempotency key",
      ),
      providerEventId: normalizeDetail(
        value.resolution.providerEventId,
        "Resolved raw provider Event ID",
        MAX_PROVIDER_EVENT_ID_LENGTH,
      ),
      providerEventRemoved: value.resolution.providerEventRemoved,
      providerJoinUrl,
      event: value.resolution.event === null
        ? null
        : normalizeProviderEvent(value.resolution.event),
    },
    resolvedAt: normalizeDateTime(value.resolvedAt, "Provider resolution time"),
    idempotentReplay: value.idempotentReplay,
  };
};

const assertResolutionMatchesPreparation = (
  preparation: Pick<
    ProviderApprovalResolutionOutboxRecordBase,
    "bookingIdempotencyKey" | "request" | "reconciliation"
  >,
  result: CalendarGatewayBookingResolution,
): void => {
  const expectedDecision = preparation.request.decision === "approve"
    ? "approved"
    : "declined";
  const approved = preparation.request.decision === "approve";
  const expectedEvent = preparation.reconciliation.expectedEvent;
  const resolvedEvent = result.resolution.event;
  const attendeeFingerprint = (attendees: readonly CalendarAttendee[]): string =>
    JSON.stringify(
      attendees
        .map(attendee => ({
          email: attendee.email.toLowerCase(),
          required: attendee.required,
        }))
        .sort((left, right) =>
          left.email.localeCompare(right.email) ||
          Number(left.required) - Number(right.required)
        ),
    );
  const approvedLocationMatches = resolvedEvent !== null &&
    expectedEvent.location === "google-meet" &&
    preparation.request.conferenceProvider === "google-meet" &&
    result.resolution.providerJoinUrl === null
      ? resolvedEvent.location === null || resolvedEvent.location === "physical"
      : resolvedEvent?.location === expectedEvent.location;
  const approvedLinksAgree = resolvedEvent !== null &&
    (resolvedEvent.providerJoinUrl === undefined ||
      resolvedEvent.providerJoinUrl === result.resolution.providerJoinUrl);
  const approvedEventMatches = resolvedEvent !== null &&
    resolvedEvent.id === expectedEvent.id &&
    resolvedEvent.title === expectedEvent.title &&
    resolvedEvent.calendarId === expectedEvent.calendarId &&
    resolvedEvent.start === expectedEvent.start &&
    resolvedEvent.end === expectedEvent.end &&
    resolvedEvent.kind === "meeting" &&
    resolvedEvent.status === "confirmed" &&
    approvedLocationMatches &&
    approvedLinksAgree &&
    attendeeFingerprint(resolvedEvent.attendees) ===
      attendeeFingerprint(expectedEvent.attendees);
  if (
    result.resolution.bookingIdempotencyKey !== preparation.bookingIdempotencyKey ||
    result.resolution.decision !== expectedDecision ||
    result.resolution.providerEventRemoved === approved ||
    (approved && !approvedEventMatches) ||
    (!approved &&
      (resolvedEvent !== null || result.resolution.providerJoinUrl !== null))
  ) {
    throw new ProviderBookingOutboxInvariantError(
      "The provider approval resolution does not match its prepared local decision.",
    );
  }
};

const normalizeApprovalResolutionRecord = (
  value: unknown,
): ProviderApprovalResolutionOutboxRecord => {
  if (!isRecord(value)) throw new ProviderBookingOutboxDataError();
  try {
    const resolutionIdempotencyKey = normalizeId(
      value.resolutionIdempotencyKey,
      "Approval-resolution idempotency key",
    );
    const bookingIdempotencyKey = normalizeId(
      value.bookingIdempotencyKey,
      "Booking idempotency key",
    );
    const request = normalizeApprovalResolutionRequest(value.request);
    const reconciliation = normalizeApprovalResolutionReconciliation(
      value.reconciliation,
    );
    if (
      request.idempotencyKey !== resolutionIdempotencyKey ||
      reconciliation.bookingRequestId !== bookingIdempotencyKey ||
      reconciliation.decision !== request.decision
    ) {
      throw new ProviderBookingOutboxInvariantError(
        "The stored approval resolution has inconsistent identifiers or decisions.",
      );
    }
    const createdAt = normalizeDateTime(
      value.createdAt,
      "Approval-resolution creation time",
    );
    const updatedAt = normalizeDateTime(
      value.updatedAt,
      "Approval-resolution update time",
    );
    if (Date.parse(updatedAt) < Date.parse(createdAt)) {
      throw new ProviderBookingOutboxInvariantError(
        "The approval-resolution update time is invalid.",
      );
    }
    const base = {
      resolutionIdempotencyKey,
      bookingIdempotencyKey,
      request,
      reconciliation,
      createdAt,
      updatedAt,
    };
    if (value.phase === "prepared") return { ...base, phase: "prepared" };
    if (value.phase === "provider-committed") {
      const providerResolution = normalizeProviderResolution(
        value.providerResolution,
      );
      assertResolutionMatchesPreparation(base, providerResolution);
      return {
        ...base,
        phase: "provider-committed",
        providerResolution,
      };
    }
  } catch (error) {
    if (error instanceof ProviderBookingOutboxInvariantError) {
      throw new ProviderBookingOutboxDataError(error.message);
    }
    throw error;
  }
  throw new ProviderBookingOutboxDataError();
};

const normalizeRecord = (value: unknown): ProviderBookingOutboxRecord => {
  if (!isRecord(value)) {
    throw new ProviderBookingOutboxDataError();
  }
  try {
    const request = normalizeProviderRequest(value.request);
    const reconciliation = normalizeReconciliation(value.reconciliation);
    assertPreparationMatches(request, reconciliation);
    const idempotencyKey = normalizeId(value.idempotencyKey, "Outbox idempotency key");
    if (idempotencyKey !== request.idempotencyKey) {
      throw new ProviderBookingOutboxInvariantError(
        "The outbox key does not match its provider request.",
      );
    }
    const createdAt = normalizeDateTime(value.createdAt, "Outbox creation time");
    const updatedAt = normalizeDateTime(value.updatedAt, "Outbox update time");
    if (Date.parse(updatedAt) < Date.parse(createdAt)) {
      throw new ProviderBookingOutboxInvariantError("The outbox update time is invalid.");
    }
    const base = {
      idempotencyKey,
      request,
      reconciliation,
      createdAt,
      updatedAt,
    };
    if (value.phase === "prepared") return { ...base, phase: "prepared" };
    if (value.phase === "provider-committed") {
      const providerCommit = normalizeProviderCommit(value.providerCommit);
      assertCommitMatchesRequest(request, providerCommit);
      return { ...base, phase: "provider-committed", providerCommit };
    }
  } catch (error) {
    if (error instanceof ProviderBookingOutboxInvariantError) {
      throw new ProviderBookingOutboxDataError(error.message);
    }
    throw error;
  }
  throw new ProviderBookingOutboxDataError();
};

export function parseProviderBookingOutboxSnapshot(
  value: unknown,
): ProviderBookingOutboxSnapshot {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.records) ||
    (value.resolutions !== undefined && !Array.isArray(value.resolutions))
  ) {
    throw new ProviderBookingOutboxDataError();
  }
  if (value.records.length > PROVIDER_BOOKING_OUTBOX_MAX_RECORDS) {
    throw new ProviderBookingOutboxDataError(
      `The provider booking outbox exceeds ${PROVIDER_BOOKING_OUTBOX_MAX_RECORDS} records.`,
    );
  }
  const records = value.records.map(normalizeRecord);
  if (new Set(records.map(record => record.idempotencyKey)).size !== records.length) {
    throw new ProviderBookingOutboxDataError(
      "The provider booking outbox contains duplicate idempotency keys.",
    );
  }
  const resolutionValues = value.resolutions ?? [];
  if (resolutionValues.length > PROVIDER_BOOKING_OUTBOX_MAX_RECORDS) {
    throw new ProviderBookingOutboxDataError(
      `The provider approval-resolution outbox exceeds ${PROVIDER_BOOKING_OUTBOX_MAX_RECORDS} records.`,
    );
  }
  const resolutions = resolutionValues.map(
    normalizeApprovalResolutionRecord,
  );
  if (
    new Set(resolutions.map(record => record.resolutionIdempotencyKey)).size !==
      resolutions.length
  ) {
    throw new ProviderBookingOutboxDataError(
      "The provider approval-resolution outbox contains duplicate idempotency keys.",
    );
  }
  const snapshot: ProviderBookingOutboxSnapshot = {
    schemaVersion: 1,
    records: records.sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.idempotencyKey.localeCompare(right.idempotencyKey)
    ),
    resolutions: resolutions.sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.resolutionIdempotencyKey.localeCompare(right.resolutionIdempotencyKey)
    ),
  };
  assertBoundedSnapshot(snapshot);
  return snapshot;
}

export function isProviderBookingOutboxSnapshot(
  value: unknown,
): value is ProviderBookingOutboxSnapshot {
  try {
    if (!isRecord(value) || !Array.isArray(value.resolutions)) return false;
    parseProviderBookingOutboxSnapshot(value);
    return true;
  } catch {
    return false;
  }
}

const emptySnapshot = (): ProviderBookingOutboxSnapshot => ({
  schemaVersion: 1,
  records: [],
  resolutions: [],
});

const isRevisionConflict = (error: unknown): boolean =>
  error instanceof ProviderBookingOutboxConflictError ||
  (error instanceof Error && /revision|conflict|expected/i.test(error.message));

const toStorageJson = (snapshot: ProviderBookingOutboxSnapshot): MiniAppJsonValue =>
  cloneJson(snapshot) as unknown as MiniAppJsonValue;

export function createSdkProviderBookingOutboxStoragePort(
  principalId: string,
): ProviderBookingOutboxStoragePort {
  const storage: MiniAppStorageApi = sdk.storage;
  const address = () => calendarPrincipalStorageAddresses(principalId).bookingOutbox;
  return {
    async get() {
      const personalAddress = address();
      const personal = await storage.get(personalAddress);
      if (personal.value !== null || !mayAdoptLegacyCalendarStorage(principalId)) {
        return personal;
      }
      const legacy = await storage.get(providerBookingOutboxStorageAddress);
      if (legacy.value === null) return personal;

      // Legacy adoption is deliberately a one-time CAS copy into the owner's
      // personal address. Returning the shared value without persisting it
      // would make a read-only recovery run appear successful while leaving
      // the final owner-less build unable to recover the outbox.
      try {
        const adopted = await storage.set({
          ...personalAddress,
          expectedRevision: null,
          value: legacy.value,
        });
        return { value: legacy.value, revision: adopted.revision };
      } catch (error) {
        if (!isRevisionConflict(error)) throw error;
        const raced = await storage.get(personalAddress);
        if (raced.value !== null) return raced;
        throw new ProviderBookingOutboxConflictError();
      }
    },
    async set(input) {
      return await storage.set({
        ...address(),
        expectedRevision: input.expectedRevision,
        value: input.value,
      });
    },
  };
}

interface PreviewEnvelope {
  readonly revision: number;
  readonly value: MiniAppJsonValue;
}

const parsePreviewEnvelope = (raw: string): PreviewEnvelope => {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new ProviderBookingOutboxDataError();
  }
  if (
    !isRecord(value) ||
    !Number.isInteger(value.revision) ||
    Number(value.revision) < 1 ||
    !("value" in value)
  ) {
    throw new ProviderBookingOutboxDataError();
  }
  return {
    revision: Number(value.revision),
    value: value.value as MiniAppJsonValue,
  };
};

export function createPreviewProviderBookingOutboxStoragePort(
  principalId: string,
  storage: Storage = globalThis.localStorage,
): ProviderBookingOutboxStoragePort {
  const storageKey = `${previewProviderBookingOutboxStorageKey}:${encodeURIComponent(principalId)}`;
  return {
    async get() {
      const raw = storage.getItem(storageKey) ??
        (mayAdoptLegacyCalendarStorage(principalId)
          ? storage.getItem(previewProviderBookingOutboxStorageKey)
          : null);
      if (raw === null) return { value: null, revision: null };
      return parsePreviewEnvelope(raw);
    },
    async set(input) {
      const raw = storage.getItem(storageKey);
      const current = raw === null ? null : parsePreviewEnvelope(raw);
      const revision = current?.revision ?? null;
      if (revision !== input.expectedRevision) {
        throw new ProviderBookingOutboxConflictError();
      }
      const nextRevision = (revision ?? 0) + 1;
      storage.setItem(
        storageKey,
        JSON.stringify({ revision: nextRevision, value: input.value } satisfies PreviewEnvelope),
      );
      return { revision: nextRevision };
    },
  };
}

const preparationsEqual = (
  record: ProviderBookingOutboxRecord,
  preparation: ProviderBookingOutboxPreparation,
): boolean =>
  JSON.stringify(record.request) === JSON.stringify(preparation.request) &&
  JSON.stringify(record.reconciliation) === JSON.stringify(preparation.reconciliation);

const approvalResolutionPreparationsEqual = (
  record: ProviderApprovalResolutionOutboxRecord,
  preparation: ProviderApprovalResolutionOutboxPreparation,
): boolean =>
  record.bookingIdempotencyKey === preparation.bookingIdempotencyKey &&
  JSON.stringify(record.request) === JSON.stringify(preparation.request) &&
  JSON.stringify(record.reconciliation) ===
    JSON.stringify(preparation.reconciliation);

export function createProviderBookingOutboxWithPort(
  port: ProviderBookingOutboxStoragePort,
  now: () => string = () => new Date().toISOString(),
): ProviderBookingOutbox {
  const read = async (): Promise<{
    readonly snapshot: ProviderBookingOutboxSnapshot;
    readonly revision: number | null;
  }> => {
    const stored = await port.get(providerBookingOutboxStorageAddress);
    return {
      snapshot: stored.value === null
        ? emptySnapshot()
        : parseProviderBookingOutboxSnapshot(stored.value),
      revision: stored.revision,
    };
  };

  const mutate = async <T>(
    mutation: (
      snapshot: ProviderBookingOutboxSnapshot,
    ) => { readonly snapshot: ProviderBookingOutboxSnapshot; readonly result: T; readonly changed: boolean },
  ): Promise<T> => {
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
      const current = await read();
      const next = mutation(current.snapshot);
      if (!next.changed) return next.result;
      const normalized = parseProviderBookingOutboxSnapshot(next.snapshot);
      assertBoundedSnapshot(normalized);
      try {
        await port.set({
          ...providerBookingOutboxStorageAddress,
          expectedRevision: current.revision,
          value: toStorageJson(normalized),
        });
        return next.result;
      } catch (error) {
        if (!isRevisionConflict(error)) throw error;
      }
    }
    throw new ProviderBookingOutboxConflictError();
  };

  return {
    async load() {
      return (await read()).snapshot;
    },

    async putBeforeProviderCall(value) {
      const preparation = normalizePreparation(value);
      return await mutate(snapshot => {
        const existing = snapshot.records.find(
          record => record.idempotencyKey === preparation.request.idempotencyKey,
        );
        if (existing) {
          if (!preparationsEqual(existing, preparation)) {
            throw new ProviderBookingOutboxInvariantError(
              "This provider idempotency key is already attached to a different booking.",
            );
          }
          return { snapshot, result: existing, changed: false };
        }
        if (snapshot.records.length >= PROVIDER_BOOKING_OUTBOX_MAX_RECORDS) {
          throw new ProviderBookingOutboxDataError(
            "Reconcile an earlier provider booking before creating another one.",
          );
        }
        const timestamp = normalizeDateTime(now(), "Current outbox time");
        if (
          preparation.request.bookingKind === "approval-hold" &&
          Date.parse(preparation.request.expiresAt!) <= Date.parse(timestamp)
        ) {
          throw new ProviderBookingOutboxInvariantError(
            "An approval hold expiration must be in the future when prepared.",
          );
        }
        const record: PreparedProviderBookingOutboxRecord = {
          phase: "prepared",
          idempotencyKey: preparation.request.idempotencyKey,
          request: preparation.request,
          reconciliation: preparation.reconciliation,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        return {
          snapshot: { ...snapshot, records: [...snapshot.records, record] },
          result: record,
          changed: true,
        };
      });
    },

    async markProviderCommitted(idempotencyKeyValue, value) {
      const idempotencyKey = normalizeId(idempotencyKeyValue, "Provider idempotency key");
      const providerCommit = normalizeProviderCommit(value);
      return await mutate(snapshot => {
        const existing = snapshot.records.find(
          record => record.idempotencyKey === idempotencyKey,
        );
        if (!existing) {
          throw new ProviderBookingOutboxInvariantError(
            "The provider booking was not durably prepared before the provider call.",
          );
        }
        assertCommitMatchesRequest(existing.request, providerCommit);
        if (
          existing.phase === "provider-committed" &&
          existing.providerCommit.booking.providerEventId !==
            providerCommit.booking.providerEventId
        ) {
          throw new ProviderBookingOutboxInvariantError(
            "The provider returned different Events for one idempotency key.",
          );
        }
        const record: CommittedProviderBookingOutboxRecord = {
          ...existing,
          phase: "provider-committed",
          providerCommit,
          updatedAt: normalizeDateTime(now(), "Current outbox time"),
        };
        const unchanged = existing.phase === "provider-committed" &&
          JSON.stringify(existing.providerCommit) === JSON.stringify(providerCommit);
        return {
          snapshot: unchanged
            ? snapshot
            : {
                ...snapshot,
                records: snapshot.records.map(candidate =>
                  candidate.idempotencyKey === idempotencyKey ? record : candidate
                ),
              },
          result: unchanged ? existing : record,
          changed: !unchanged,
        };
      });
    },

    async listAwaitingProvider() {
      const snapshot = (await read()).snapshot;
      return snapshot.records.filter(
        (record): record is PreparedProviderBookingOutboxRecord =>
          record.phase === "prepared",
      );
    },

    async listPendingReconciliation() {
      const snapshot = (await read()).snapshot;
      return snapshot.records.filter(
        (record): record is CommittedProviderBookingOutboxRecord =>
          record.phase === "provider-committed",
      );
    },

    async removeAfterLocalReconciliation(
      idempotencyKeyValue,
      normalizedLocalEventIdValue,
    ) {
      const idempotencyKey = normalizeId(idempotencyKeyValue, "Provider idempotency key");
      const normalizedLocalEventId = normalizeNormalizedEventId(
        normalizedLocalEventIdValue,
      );
      return await mutate(snapshot => {
        const existing = snapshot.records.find(
          record => record.idempotencyKey === idempotencyKey,
        );
        if (!existing) return { snapshot, result: false, changed: false };
        if (existing.phase !== "provider-committed") {
          throw new ProviderBookingOutboxInvariantError(
            "A provider booking cannot be removed before its provider result is known.",
          );
        }
        if (existing.providerCommit.booking.event.id !== normalizedLocalEventId) {
          throw new ProviderBookingOutboxInvariantError(
            "The reconciled normalized local Event ID does not match the outbox.",
          );
        }
        return {
          snapshot: {
            ...snapshot,
            records: snapshot.records.filter(
              record => record.idempotencyKey !== idempotencyKey,
            ),
          },
          result: true,
          changed: true,
        };
      });
    },

    async discardPreparedAfterDefinitiveProviderFailure(idempotencyKeyValue) {
      const idempotencyKey = normalizeId(idempotencyKeyValue, "Provider idempotency key");
      return await mutate(snapshot => {
        const existing = snapshot.records.find(
          record => record.idempotencyKey === idempotencyKey,
        );
        if (!existing) return { snapshot, result: false, changed: false };
        if (existing.phase !== "prepared") {
          throw new ProviderBookingOutboxInvariantError(
            "A committed provider booking must be locally reconciled before removal.",
          );
        }
        return {
          snapshot: {
            ...snapshot,
            records: snapshot.records.filter(
              record => record.idempotencyKey !== idempotencyKey,
            ),
          },
          result: true,
          changed: true,
        };
      });
    },

    async putApprovalResolutionBeforeProviderCall(value) {
      const preparation = normalizeApprovalResolutionPreparation(value);
      const resolutionIdempotencyKey = preparation.request.idempotencyKey;
      return await mutate(snapshot => {
        const existing = snapshot.resolutions.find(
          record =>
            record.resolutionIdempotencyKey === resolutionIdempotencyKey,
        );
        if (existing) {
          if (!approvalResolutionPreparationsEqual(existing, preparation)) {
            throw new ProviderBookingOutboxInvariantError(
              "This resolution idempotency key is already attached to a different approval decision.",
            );
          }
          return { snapshot, result: existing, changed: false };
        }
        const conflictingDecision = snapshot.resolutions.find(
          record =>
            record.bookingIdempotencyKey === preparation.bookingIdempotencyKey,
        );
        if (conflictingDecision) {
          throw new ProviderBookingOutboxInvariantError(
            "This approval hold already has a different durable resolution attempt.",
          );
        }
        if (snapshot.resolutions.length >= PROVIDER_BOOKING_OUTBOX_MAX_RECORDS) {
          throw new ProviderBookingOutboxDataError(
            "Reconcile an earlier provider approval decision before creating another one.",
          );
        }
        const timestamp = normalizeDateTime(now(), "Current outbox time");
        const record: PreparedProviderApprovalResolutionOutboxRecord = {
          phase: "prepared",
          resolutionIdempotencyKey,
          bookingIdempotencyKey: preparation.bookingIdempotencyKey,
          request: preparation.request,
          reconciliation: preparation.reconciliation,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        return {
          snapshot: {
            ...snapshot,
            resolutions: [...snapshot.resolutions, record],
          },
          result: record,
          changed: true,
        };
      });
    },

    async markApprovalResolutionCommitted(resolutionIdempotencyKeyValue, value) {
      const resolutionIdempotencyKey = normalizeId(
        resolutionIdempotencyKeyValue,
        "Approval-resolution idempotency key",
      );
      const providerResolution = normalizeProviderResolution(value);
      return await mutate(snapshot => {
        const existing = snapshot.resolutions.find(
          record =>
            record.resolutionIdempotencyKey === resolutionIdempotencyKey,
        );
        if (!existing) {
          throw new ProviderBookingOutboxInvariantError(
            "The approval resolution was not durably prepared before the provider call.",
          );
        }
        assertResolutionMatchesPreparation(existing, providerResolution);
        if (
          existing.phase === "provider-committed" &&
          existing.providerResolution.resolution.providerEventId !==
            providerResolution.resolution.providerEventId
        ) {
          throw new ProviderBookingOutboxInvariantError(
            "The provider returned different Events for one approval resolution.",
          );
        }
        const record: CommittedProviderApprovalResolutionOutboxRecord = {
          ...existing,
          phase: "provider-committed",
          providerResolution,
          updatedAt: normalizeDateTime(now(), "Current outbox time"),
        };
        const unchanged = existing.phase === "provider-committed" &&
          JSON.stringify(existing.providerResolution) ===
            JSON.stringify(providerResolution);
        return {
          snapshot: unchanged
            ? snapshot
            : {
                ...snapshot,
                resolutions: snapshot.resolutions.map(candidate =>
                  candidate.resolutionIdempotencyKey === resolutionIdempotencyKey
                    ? record
                    : candidate
                ),
              },
          result: unchanged ? existing : record,
          changed: !unchanged,
        };
      });
    },

    async listApprovalResolutionsAwaitingProvider() {
      const snapshot = (await read()).snapshot;
      return snapshot.resolutions.filter(
        (record): record is PreparedProviderApprovalResolutionOutboxRecord =>
          record.phase === "prepared",
      );
    },

    async listPendingApprovalResolutionReconciliation() {
      const snapshot = (await read()).snapshot;
      return snapshot.resolutions.filter(
        (record): record is CommittedProviderApprovalResolutionOutboxRecord =>
          record.phase === "provider-committed",
      );
    },

    async removeApprovalResolutionAfterLocalReconciliation(
      resolutionIdempotencyKeyValue,
      normalizedLocalEventIdValue,
    ) {
      const resolutionIdempotencyKey = normalizeId(
        resolutionIdempotencyKeyValue,
        "Approval-resolution idempotency key",
      );
      const normalizedLocalEventId = normalizeNormalizedEventId(
        normalizedLocalEventIdValue,
      );
      return await mutate(snapshot => {
        const existing = snapshot.resolutions.find(
          record =>
            record.resolutionIdempotencyKey === resolutionIdempotencyKey,
        );
        if (!existing) return { snapshot, result: false, changed: false };
        if (existing.phase !== "provider-committed") {
          throw new ProviderBookingOutboxInvariantError(
            "An approval resolution cannot be removed before its provider result is known.",
          );
        }
        if (existing.reconciliation.expectedEvent.id !== normalizedLocalEventId) {
          throw new ProviderBookingOutboxInvariantError(
            "The reconciled normalized local Event ID does not match the approval outbox.",
          );
        }
        return {
          snapshot: {
            ...snapshot,
            resolutions: snapshot.resolutions.filter(
              record =>
                record.resolutionIdempotencyKey !== resolutionIdempotencyKey,
            ),
          },
          result: true,
          changed: true,
        };
      });
    },

    async discardPreparedApprovalResolutionAfterDefinitiveProviderFailure(
      resolutionIdempotencyKeyValue,
    ) {
      const resolutionIdempotencyKey = normalizeId(
        resolutionIdempotencyKeyValue,
        "Approval-resolution idempotency key",
      );
      return await mutate(snapshot => {
        const existing = snapshot.resolutions.find(
          record =>
            record.resolutionIdempotencyKey === resolutionIdempotencyKey,
        );
        if (!existing) return { snapshot, result: false, changed: false };
        if (existing.phase !== "prepared") {
          throw new ProviderBookingOutboxInvariantError(
            "A committed provider approval resolution must be locally reconciled before removal.",
          );
        }
        return {
          snapshot: {
            ...snapshot,
            resolutions: snapshot.resolutions.filter(
              record =>
                record.resolutionIdempotencyKey !== resolutionIdempotencyKey,
            ),
          },
          result: true,
          changed: true,
        };
      });
    },
  };
}

export function createProviderBookingOutbox(
  preview: boolean,
  principalId: string,
): ProviderBookingOutbox {
  return createProviderBookingOutboxWithPort(
    preview
      ? createPreviewProviderBookingOutboxStoragePort(principalId)
      : createSdkProviderBookingOutboxStoragePort(principalId),
  );
}
