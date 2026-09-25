export type CalendarProvider =
  | "google"
  | "microsoft"
  | "icloud"
  | "caldav"
  | "exchange"
  | "ics";

export type CalendarRole =
  | "owner"
  | "writer"
  | "reader"
  | "free-busy";

export type CalendarView =
  | "day"
  | "work-week"
  | "week"
  | "month"
  | "agenda"
  | "team";

export type BookingStatus =
  | "pending"
  | "confirmed"
  | "declined"
  | "cancelled";

export type MeetingLocation =
  | "tap-room"
  | "tap-huddle"
  | "google-meet"
  | "microsoft-teams"
  | "zoom"
  | "webex"
  | "goto"
  | "phone"
  | "physical"
  | "custom";

export interface ConnectedCalendar {
  readonly id: string;
  readonly accountId: string;
  readonly name: string;
  readonly color: string;
  readonly role: CalendarRole;
  readonly visible: boolean;
  readonly conflicts: boolean;
  readonly writable: boolean;
  readonly destination: boolean;
  /** Provider-designated primary calendar. Missing in legacy persisted state. */
  readonly primary?: boolean;
  readonly freshness: "live" | "delayed" | "stale";
  readonly unreadCount?: number;
}

export interface CalendarAccount {
  readonly id: string;
  readonly provider: CalendarProvider;
  readonly label: string;
  readonly status: "connected" | "attention" | "read-only";
  readonly calendars: readonly ConnectedCalendar[];
}

export interface CalendarAttendee {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly kind: "tap" | "external";
  readonly required: boolean;
}

export interface CalendarEvent {
  readonly id: string;
  readonly calendarId: string;
  readonly title: string;
  readonly start: string;
  readonly end: string;
  readonly kind: "meeting" | "work-block" | "hold" | "focus";
  readonly status: BookingStatus;
  readonly location: MeetingLocation | null;
  readonly attendees: readonly CalendarAttendee[];
  /** False for provider events marked free/transparent. Missing means busy. */
  readonly busy?: boolean;
  /** True when the provider supplied date-only start and end values. */
  readonly allDay?: boolean;
  /** Provider calendar UI link, retained only inside permissioned TAP state. */
  readonly providerHtmlLink?: string;
  /** Provisioned meeting join URL, retained only inside permissioned TAP state. */
  readonly providerJoinUrl?: string;
  readonly source?: {
    readonly kind: "task" | "channel" | "message";
    readonly id: string;
    readonly label: string;
  };
}

export interface AvailabilityWindow {
  /** Stable for newly-created intervals; absent on legacy schema-v1 records. */
  readonly id?: string;
  readonly day: number;
  readonly enabled: boolean;
  readonly start: string;
  readonly end: string;
}

export interface AvailabilityOverride {
  readonly id: string;
  readonly date: string;
  readonly label: string;
  readonly available: boolean;
  /** Travel time zone for this date; absent means inherit the schedule zone. */
  readonly timezone?: string;
  readonly start?: string;
  readonly end?: string;
}

export interface AvailabilitySchedule {
  readonly id: string;
  readonly name: string;
  readonly timezone: string;
  readonly preferredStart: string;
  readonly preferredEnd: string;
  readonly windows: readonly AvailabilityWindow[];
  readonly bufferBeforeMinutes: number;
  readonly bufferAfterMinutes: number;
  readonly minimumNoticeMinutes: number;
  readonly bookingHorizonDays: number;
  readonly overrides?: readonly AvailabilityOverride[];
}

export interface FunnelAnalytics {
  readonly views: number;
  readonly slotViews: number;
  readonly starts: number;
  readonly requests: number;
  readonly confirmed: number;
}

export type BookingProfilePublicationStatus = "published" | "unpublished";

/** A server-confirmed immutable public-page identity for one Event Type. */
export interface EventTypePublicationReceipt {
  readonly revisionId: string;
  readonly reservedSlug: string;
  /** The whole-profile generation in which this page was last confirmed live. */
  readonly generation?: number;
}

/** The latest whole-profile publication generation confirmed by the gateway. */
export interface BookingProfilePublicationReceipt {
  readonly generation: number;
  readonly status: BookingProfilePublicationStatus;
  readonly reservedSlug: string;
  readonly updatedAt: string;
}

/**
 * A desired publication state that has not yet been confirmed by the gateway.
 * Generation 0 is intentional: it represents a profile that has never been
 * published, including legacy schema-v1 profiles created before receipts.
 */
export interface PendingBookingProfilePublication {
  readonly desiredStatus: BookingProfilePublicationStatus;
  readonly expectedGeneration: number;
  readonly requestedAt: string;
}

/** A normalized whole-profile receipt returned by the organizer gateway. */
export interface BookingProfileServerPublicationReceipt {
  readonly sourceProfileId: string;
  readonly generation: number;
  readonly status: BookingProfilePublicationStatus;
  readonly reservedSlug: string;
  readonly updatedAt: string;
  readonly eventTypes: readonly {
    readonly sourceEventTypeId: string;
    readonly revisionId: string;
    readonly reservedSlug: string;
  }[];
}

export interface EffectiveBookingProfilePublicationState {
  readonly liveStatus: BookingProfilePublicationStatus | "never-published";
  readonly desiredStatus: BookingProfilePublicationStatus;
  readonly pending: boolean;
  readonly expectedGeneration: number;
}

export interface EventType {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly durationMinutes: number;
  readonly approvalRequired: boolean;
  readonly location: MeetingLocation;
  readonly destinationCalendarId: string;
  /**
   * Availability Schedule used by this Event Type. Absent only on legacy
   * schema-v1 records, which resolve through the state's deterministic
   * legacy fallback until they are migrated.
   */
  readonly availabilityScheduleId?: string;
  readonly active: boolean;
  readonly color: string;
  readonly analytics: FunnelAnalytics;
  /** Present after this Event Type has received its first public-page receipt. */
  readonly publication?: EventTypePublicationReceipt;
}

/** Event Type accepted by create mutations; the Availability Schedule is explicit. */
export type NewEventType = Omit<EventType, "availabilityScheduleId"> & {
  readonly availabilityScheduleId: string;
};

export interface BookingProfile {
  readonly id: string;
  readonly ownerType: "individual" | "team" | "organization";
  readonly slug: string;
  readonly displayName: string;
  readonly timezone: string;
  /**
   * Backward-compatible desired-state flag. Confirmed live state is held in
   * `publication`; legacy profiles may have this flag without a receipt.
   */
  readonly published: boolean;
  readonly eventTypes: readonly EventType[];
  /** Present after the gateway confirms the first whole-profile operation. */
  readonly publication?: BookingProfilePublicationReceipt;
  /** Present while the desired state still needs gateway reconciliation. */
  readonly pendingPublication?: PendingBookingProfilePublication;
}

export interface BookingRequest {
  readonly id: string;
  readonly eventTypeId: string;
  readonly eventId: string;
  readonly guestName: string;
  readonly guestEmail: string;
  readonly status: BookingStatus;
  readonly requestedAt: string;
  readonly expiresAt: string;
}

export interface NotificationPreferences {
  readonly reminderMinutes: readonly number[];
  readonly system: boolean;
  readonly tap: boolean;
  readonly email: boolean;
  readonly sms: boolean;
  readonly whatsapp: boolean;
  readonly telegram: boolean;
  readonly quietHoursStart: string;
  readonly quietHoursEnd: string;
}

export interface CalendarChannelEntry {
  readonly id: string;
  readonly createdAt: string;
  readonly kind: "booking" | "approval" | "cancellation" | "health";
  readonly title: string;
  readonly summary: string;
  readonly bookingRequestId?: string;
  readonly redacted: boolean;
}

export interface CalendarNotificationChannel {
  readonly id: string;
  readonly name: string;
  readonly scope: "private" | "team" | "calendar" | "event-type";
  readonly enabled: boolean;
  readonly entries: readonly CalendarChannelEntry[];
}

export interface CalendarWorkflowNode {
  readonly id: string;
  readonly kind: "trigger" | "action";
  readonly name: string;
  readonly description: string;
}

export interface CalendarState {
  readonly schemaVersion: 1;
  readonly activeView: CalendarView;
  readonly accounts: readonly CalendarAccount[];
  readonly events: readonly CalendarEvent[];
  readonly availability: readonly AvailabilitySchedule[];
  readonly activeAvailabilityId: string;
  readonly bookingProfiles: readonly BookingProfile[];
  readonly bookingRequests: readonly BookingRequest[];
  readonly notificationPreferences: NotificationPreferences;
  readonly notificationChannels: readonly CalendarNotificationChannel[];
  readonly workflowNodes: readonly CalendarWorkflowNode[];
}

export interface ScheduleMeetingInput {
  readonly id: string;
  readonly title: string;
  readonly calendarId: string;
  readonly start: string;
  readonly end: string;
  /** Null creates a calendar event without a location or video conference. */
  readonly location: MeetingLocation | null;
  readonly attendees: readonly CalendarAttendee[];
  readonly approvalRequired: boolean;
  /** Stable gateway hold/idempotency key; the Event ID may be provider-normalized. */
  readonly bookingRequestId?: string;
  readonly providerHtmlLink?: string;
  readonly providerJoinUrl?: string;
  readonly eventTypeId?: string;
  readonly requestedAt: string;
}

export interface ScheduleMeetingResult {
  readonly state: CalendarState;
  readonly error: string | null;
  readonly bookingRequestId: string | null;
}

export interface AvailableSlot {
  readonly start: string;
  readonly end: string;
}

export type CalendarDomainErrorCode =
  | "account-not-found"
  | "calendar-not-found"
  | "duplicate-id"
  | "duplicate-slug"
  | "empty-calendars"
  | "empty-name"
  | "invalid-destination"
  | "invalid-duration"
  | "invalid-id"
  | "invalid-availability"
  | "invalid-slug"
  | "missing-destination"
  | "profile-not-found";

export interface CalendarDomainError {
  readonly code: CalendarDomainErrorCode;
  readonly field: string;
  readonly message: string;
}

export type CalendarMutationResult =
  | {
      readonly ok: true;
      readonly state: CalendarState;
      readonly error: null;
    }
  | {
      readonly ok: false;
      readonly state: CalendarState;
      readonly error: CalendarDomainError;
    };

export type ConnectedCalendarInput = Omit<ConnectedCalendar, "accountId">;

export interface AddConnectedAccountInput {
  readonly id: string;
  readonly provider: CalendarProvider;
  readonly label: string;
  readonly status: CalendarAccount["status"];
  readonly calendars: readonly ConnectedCalendarInput[];
}

export interface AddCalendarsToAccountInput {
  readonly accountId: string;
  readonly calendars: readonly ConnectedCalendarInput[];
}

export interface AddAvailabilityScheduleOptions {
  readonly makeDefault?: boolean;
}

const days = [1, 2, 3, 4, 5, 6, 0] as const;
const baseWindows = days.map<AvailabilityWindow>(day => ({
  day,
  enabled: day >= 1 && day <= 5,
  start: "09:00",
  end: "17:00",
}));

const availabilityWeekdayNames = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/**
 * Availability intervals are half-open wall-clock ranges. Adjacent ranges are
 * valid, but overlapping, inverted, mixed-enabled, or sub-five-minute ranges
 * are rejected before they reach storage or slot generation.
 */
export function validateAvailabilityWindows(
  windows: readonly AvailabilityWindow[],
): string | null {
  const ids = new Set<string>();
  const byDay = new Map<number, AvailabilityWindow[]>();
  for (const window of windows) {
    const dayName = availabilityWeekdayNames[window.day] ?? "Availability";
    if (!Number.isInteger(window.day) || window.day < 0 || window.day > 6) {
      return "Availability intervals must use a valid weekday.";
    }
    if (window.id !== undefined) {
      if (!hasId(window.id)) return `${dayName} has an invalid time range ID.`;
      if (ids.has(window.id)) return `${dayName} has a duplicate time range ID.`;
      ids.add(window.id);
    }
    if (!isClockTime(window.start) || !isClockTime(window.end)) {
      return `${dayName} has an invalid time range.`;
    }
    const start = minutesFromMidnight(window.start);
    const end = minutesFromMidnight(window.end);
    if (end - start < 5) {
      return `${dayName} time ranges must be at least 5 minutes and end after they start.`;
    }
    const dayWindows = byDay.get(window.day) ?? [];
    dayWindows.push(window);
    byDay.set(window.day, dayWindows);
  }

  for (const [day, dayWindows] of byDay) {
    const dayName = availabilityWeekdayNames[day] ?? "Availability";
    if (dayWindows.some(window => window.enabled !== dayWindows[0]?.enabled)) {
      return `${dayName} time ranges must be enabled or disabled together.`;
    }
    const ordered = [...dayWindows].sort((left, right) =>
      left.start.localeCompare(right.start) || left.end.localeCompare(right.end),
    );
    for (let index = 1; index < ordered.length; index += 1) {
      if (ordered[index]!.start < ordered[index - 1]!.end) {
        return `${dayName} time ranges cannot overlap.`;
      }
    }
  }
  return null;
}

const clockTime = (minute: number): string =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

/** Create a useful one-hour interval in the nearest available daily gap. */
export function createAdditionalAvailabilityWindow(
  windows: readonly AvailabilityWindow[],
  day: number,
  id?: string,
): AvailabilityWindow | null {
  if (!Number.isInteger(day) || day < 0 || day > 6) return null;
  const dayWindows = windows
    .filter(window => window.day === day)
    .map(window => ({
      start: minutesFromMidnight(window.start),
      end: minutesFromMidnight(window.end),
    }))
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const enabled = dayWindows.length === 0 || windows.some(window => window.day === day && window.enabled);
  const gaps: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const window of dayWindows) {
    if (window.start > cursor) gaps.push({ start: cursor, end: window.start });
    cursor = Math.max(cursor, window.end);
  }
  if (cursor < 1_439) gaps.push({ start: cursor, end: 1_439 });

  const latestEnd = dayWindows.at(-1)?.end ?? 0;
  const orderedGaps = [
    ...gaps.filter(gap => gap.start >= latestEnd),
    ...gaps.filter(gap => gap.start < latestEnd && gap.start > 0),
    ...gaps.filter(gap => gap.start === 0),
  ];
  for (const minimumDuration of [60, 30]) {
    const gap = orderedGaps.find(candidate => candidate.end - candidate.start >= minimumDuration);
    if (!gap) continue;
    const duration = Math.min(60, gap.end - gap.start);
    return {
      ...(id ? { id } : {}),
      day,
      enabled,
      start: clockTime(gap.start),
      end: clockTime(gap.start + duration),
    };
  }
  return null;
}

const emptyAnalytics = (): FunnelAnalytics => ({
  views: 0,
  slotViews: 0,
  starts: 0,
  requests: 0,
  confirmed: 0,
});

const defaultNotificationPreferences = (): NotificationPreferences => ({
  reminderMinutes: [10],
  system: true,
  tap: true,
  email: true,
  sms: false,
  whatsapp: false,
  telegram: false,
  quietHoursStart: "22:00",
  quietHoursEnd: "07:00",
});

const defaultWorkflowNodes = (): readonly CalendarWorkflowNode[] => [
  {
    id: "tap-calendar.normalize-booking-created",
    kind: "trigger",
    name: "Normalize Booking created",
    description: "Normalizes a Booking-created payload delivered by the Calendar gateway.",
  },
  {
    id: "tap-calendar.normalize-booking-cancelled",
    kind: "trigger",
    name: "Normalize Booking cancelled",
    description: "Normalizes a Booking-cancelled payload delivered by the Calendar gateway.",
  },
  {
    id: "tap-calendar.draft-work-block",
    kind: "action",
    name: "Draft Work Block",
    description: "Prepares a task, channel, or message-linked Work Block for review.",
  },
  {
    id: "tap-calendar.prepare-channel-summary",
    kind: "action",
    name: "Prepare channel summary",
    description: "Prepares a permission-aware Calendar Channel Summary for delivery.",
  },
];

export function createEmptyCalendarState(): CalendarState {
  return {
    schemaVersion: 1,
    activeView: "work-week",
    accounts: [],
    events: [],
    availability: [],
    activeAvailabilityId: "",
    bookingProfiles: [],
    bookingRequests: [],
    notificationPreferences: defaultNotificationPreferences(),
    notificationChannels: [],
    workflowNodes: defaultWorkflowNodes(),
  };
}

export const allCalendars = (
  state: CalendarState,
): readonly ConnectedCalendar[] =>
  state.accounts.flatMap(account => account.calendars);

export const preferredDestinationCalendar = <Calendar extends {
  readonly writable: boolean;
  readonly destination?: boolean;
  readonly primary?: boolean;
}>(calendars: readonly Calendar[]): Calendar | undefined =>
  calendars.find(calendar => calendar.writable && calendar.destination) ??
  calendars.find(calendar => calendar.writable && calendar.primary) ??
  calendars.find(calendar => calendar.writable);

const mutationSucceeded = (state: CalendarState): CalendarMutationResult => ({
  ok: true,
  state,
  error: null,
});

const mutationFailed = (
  state: CalendarState,
  code: CalendarDomainErrorCode,
  field: string,
  message: string,
): CalendarMutationResult => ({
  ok: false,
  state,
  error: { code, field, message },
});

const hasName = (value: string): boolean => value.trim().length > 0;

const hasId = (value: string): boolean =>
  value.length > 0 && value === value.trim();

const eventDurationIsReasonable = (durationMinutes: number): boolean =>
  Number.isInteger(durationMinutes) &&
  durationMinutes >= 5 &&
  durationMinutes <= 24 * 60;

const allEventTypes = (state: CalendarState): readonly EventType[] =>
  state.bookingProfiles.flatMap(profile => profile.eventTypes);

/**
 * Resolves the Availability Schedule relationship for an Event Type.
 *
 * An explicit relationship is authoritative: a dangling explicit ID returns
 * null and never falls back silently. Legacy Event Types with no relationship
 * first inherit the current active schedule and then the first stored schedule.
 */
export function resolveEventTypeAvailabilityScheduleId(
  state: CalendarState,
  eventType: EventType,
): string | null {
  if (eventType.availabilityScheduleId !== undefined) {
    return state.availability.some(
      schedule => schedule.id === eventType.availabilityScheduleId,
    )
      ? eventType.availabilityScheduleId
      : null;
  }
  if (state.availability.some(schedule => schedule.id === state.activeAvailabilityId)) {
    return state.activeAvailabilityId;
  }
  return state.availability[0]?.id ?? null;
}

/**
 * Materializes deterministic Availability Schedule relationships for legacy
 * Event Types without changing explicit valid or dangling relationships.
 */
export function migrateLegacyEventTypeAvailabilitySchedules(
  state: CalendarState,
): CalendarState {
  let changed = false;
  const bookingProfiles = state.bookingProfiles.map(profile => {
    let profileChanged = false;
    const eventTypes = profile.eventTypes.map(eventType => {
      if (eventType.availabilityScheduleId !== undefined) return eventType;
      const availabilityScheduleId = resolveEventTypeAvailabilityScheduleId(
        state,
        eventType,
      );
      if (availabilityScheduleId === null) return eventType;
      changed = true;
      profileChanged = true;
      return { ...eventType, availabilityScheduleId };
    });
    return profileChanged ? { ...profile, eventTypes } : profile;
  });
  return changed ? { ...state, bookingProfiles } : state;
}

/**
 * Separates the last server-confirmed state from what the organizer currently
 * wants. A receipt-less legacy profile is never assumed to be live.
 */
export function deriveBookingProfilePublicationState(
  profile: BookingProfile,
): EffectiveBookingProfilePublicationState {
  const liveStatus = profile.publication?.status ?? "never-published";
  const desiredStatus = profile.pendingPublication?.desiredStatus ??
    (profile.published ? "published" : "unpublished");
  const implicitlyPending = liveStatus === "never-published"
    ? desiredStatus === "published"
    : liveStatus !== desiredStatus;
  return {
    liveStatus,
    desiredStatus,
    pending: profile.pendingPublication !== undefined || implicitlyPending,
    expectedGeneration: profile.pendingPublication?.expectedGeneration ??
      profile.publication?.generation ??
      0,
  };
}

/** True only when this exact page was included in the profile's confirmed live generation. */
export function isEventTypePublicationLive(
  profile: BookingProfile,
  eventType: EventType,
): boolean {
  const generation = profile.publication?.generation;
  return profile.publication?.status === "published" &&
    generation !== undefined &&
    eventType.publication?.generation === generation;
}

/**
 * Marks the current desired profile state for reconciliation. The caller
 * supplies the timestamp so this remains deterministic and so the exact
 * pending intent can be retained while a prior request is in flight.
 */
export function markBookingProfilePublicationPending(
  profile: BookingProfile,
  requestedAt: string,
): BookingProfile {
  if (!isPublicationTimestamp(requestedAt)) {
    throw new Error("Publication pending timestamps must be canonical UTC ISO timestamps.");
  }
  return {
    ...profile,
    pendingPublication: {
      desiredStatus: profile.published ? "published" : "unpublished",
      expectedGeneration: profile.publication?.generation ?? 0,
      requestedAt,
    },
  };
}

/** State-level convenience wrapper used by organizer storage mutations. */
export function markPublicBookingProfilePublicationPending(
  state: CalendarState,
  profileId: string,
  requestedAt: string,
): CalendarState {
  if (!state.bookingProfiles.some(profile => profile.id === profileId)) return state;
  return {
    ...state,
    bookingProfiles: state.bookingProfiles.map(profile =>
      profile.id === profileId
        ? markBookingProfilePublicationPending(profile, requestedAt)
        : profile
    ),
  };
}

/**
 * Preserves every server-reserved slug and receipt while applying unrelated
 * organizer edits. Event Types are matched by source ID, never array position.
 */
export function enforceImmutablePublicationSlugs(
  current: BookingProfile,
  candidate: BookingProfile,
): BookingProfile {
  if (current.id !== candidate.id) {
    throw new Error("Publication slug guards require the same Booking Profile ID.");
  }
  const currentEventTypes = new Map(
    current.eventTypes.map(eventType => [eventType.id, eventType]),
  );
  return {
    ...candidate,
    slug: current.publication?.reservedSlug ?? candidate.slug,
    ...(current.publication === undefined
      ? {}
      : { publication: current.publication }),
    eventTypes: candidate.eventTypes.map(eventType => {
      const existingReceipt = currentEventTypes.get(eventType.id)?.publication;
      return existingReceipt === undefined
        ? eventType
        : {
            ...eventType,
            slug: existingReceipt.reservedSlug,
            publication: existingReceipt,
          };
    }),
  };
}

const pendingPublicationsMatch = (
  left: PendingBookingProfilePublication | undefined,
  right: PendingBookingProfilePublication | undefined,
): boolean =>
  left !== undefined &&
  right !== undefined &&
  left.desiredStatus === right.desiredStatus &&
  left.expectedGeneration === right.expectedGeneration &&
  left.requestedAt === right.requestedAt;

/**
 * Applies a gateway receipt without allowing an older response to erase a
 * newer local intent. Pass the pending snapshot sent with the request; if the
 * profile was marked pending again in the meantime, that newer intent remains.
 */
export function applyBookingProfilePublicationReceipt(
  profile: BookingProfile,
  receipt: BookingProfileServerPublicationReceipt,
  acknowledgedPending?: PendingBookingProfilePublication,
): BookingProfile {
  if (!isBookingProfileServerPublicationReceipt(receipt)) {
    throw new Error("The Booking Profile publication receipt is malformed.");
  }
  if (receipt.sourceProfileId !== profile.id) {
    throw new Error("The publication receipt belongs to a different Booking Profile.");
  }
  const currentReceipt = profile.publication;
  if (currentReceipt && receipt.generation < currentReceipt.generation) return profile;
  if (
    currentReceipt &&
    receipt.generation === currentReceipt.generation &&
    (
      receipt.status !== currentReceipt.status ||
      receipt.reservedSlug !== currentReceipt.reservedSlug ||
      receipt.updatedAt !== currentReceipt.updatedAt
    )
  ) {
    throw new Error("The publication receipt conflicts with the confirmed generation.");
  }

  const eventReceipts = new Map(
    receipt.eventTypes.map(eventType => [eventType.sourceEventTypeId, eventType]),
  );
  const pendingWasAcknowledged = profile.pendingPublication !== undefined &&
    receipt.status === profile.pendingPublication.desiredStatus &&
    (acknowledgedPending === undefined || pendingPublicationsMatch(
      profile.pendingPublication,
      acknowledgedPending,
    ));
  const retainedPending = profile.pendingPublication === undefined || pendingWasAcknowledged
    ? undefined
    : {
        ...profile.pendingPublication,
        expectedGeneration: receipt.generation,
      };
  const desiredPublished = retainedPending?.desiredStatus === "published" ||
    (retainedPending === undefined && receipt.status === "published");

  const withoutPending = { ...profile };
  delete (withoutPending as { pendingPublication?: PendingBookingProfilePublication })
    .pendingPublication;
  return {
    ...withoutPending,
    slug: receipt.reservedSlug,
    published: desiredPublished,
    publication: {
      generation: receipt.generation,
      status: receipt.status,
      reservedSlug: receipt.reservedSlug,
      updatedAt: receipt.updatedAt,
    },
    ...(retainedPending === undefined ? {} : { pendingPublication: retainedPending }),
    eventTypes: profile.eventTypes.map(eventType => {
      const eventReceipt = eventReceipts.get(eventType.id);
      return eventReceipt === undefined
        ? eventType
        : {
            ...eventType,
            slug: eventReceipt.reservedSlug,
            publication: {
              revisionId: eventReceipt.revisionId,
              reservedSlug: eventReceipt.reservedSlug,
              generation: receipt.generation,
            },
          };
    }),
  };
}

/** State-level receipt application with source-profile matching. */
export function applyPublicBookingProfilePublicationReceipt(
  state: CalendarState,
  receipt: BookingProfileServerPublicationReceipt,
  acknowledgedPending?: PendingBookingProfilePublication,
): CalendarState {
  if (!state.bookingProfiles.some(profile => profile.id === receipt.sourceProfileId)) {
    return state;
  }
  return {
    ...state,
    bookingProfiles: state.bookingProfiles.map(profile =>
      profile.id === receipt.sourceProfileId
        ? applyBookingProfilePublicationReceipt(profile, receipt, acknowledgedPending)
        : profile
    ),
  };
}

function validateEventTypeDefinition(
  state: CalendarState,
  eventType: EventType,
): CalendarDomainError | null {
  if (!hasId(eventType.id)) {
    return {
      code: "invalid-id",
      field: "id",
      message: "Event Type ID must not be empty or contain surrounding whitespace.",
    };
  }
  if (allEventTypes(state).some(candidate => candidate.id === eventType.id)) {
    return {
      code: "duplicate-id",
      field: "id",
      message: `An Event Type with ID \"${eventType.id}\" already exists.`,
    };
  }
  if (!hasName(eventType.title)) {
    return {
      code: "empty-name",
      field: "title",
      message: "Event Type title is required.",
    };
  }
  const slugError = validateSlug(eventType.slug);
  if (slugError) {
    return {
      code: "invalid-slug",
      field: "slug",
      message: slugError,
    };
  }
  if (!eventDurationIsReasonable(eventType.durationMinutes)) {
    return {
      code: "invalid-duration",
      field: "durationMinutes",
      message: "Event Type duration must be a whole number between 5 and 1,440 minutes.",
    };
  }
  const destination = allCalendars(state).find(
    calendar => calendar.id === eventType.destinationCalendarId,
  );
  if (!destination?.writable) {
    return {
      code: "invalid-destination",
      field: "destinationCalendarId",
      message: "Choose a writable Destination Calendar for this Event Type.",
    };
  }
  if (!hasId(eventType.availabilityScheduleId ?? "")) {
    return {
      code: "invalid-availability",
      field: "availabilityScheduleId",
      message: "Choose an Availability Schedule for this Event Type.",
    };
  }
  if (!state.availability.some(
    schedule => schedule.id === eventType.availabilityScheduleId,
  )) {
    return {
      code: "invalid-availability",
      field: "availabilityScheduleId",
      message: `Availability Schedule \"${eventType.availabilityScheduleId}\" was not found.`,
    };
  }
  return null;
}

export function addConnectedAccount(
  state: CalendarState,
  input: AddConnectedAccountInput,
): CalendarMutationResult {
  if (!hasId(input.id)) {
    return mutationFailed(
      state,
      "invalid-id",
      "id",
      "Calendar account ID must not be empty or contain surrounding whitespace.",
    );
  }
  if (state.accounts.some(account => account.id === input.id)) {
    return mutationFailed(
      state,
      "duplicate-id",
      "id",
      `A calendar account with ID \"${input.id}\" already exists.`,
    );
  }
  if (!hasName(input.label)) {
    return mutationFailed(
      state,
      "empty-name",
      "label",
      "Calendar account name is required.",
    );
  }
  if (input.calendars.length === 0) {
    return mutationFailed(
      state,
      "empty-calendars",
      "calendars",
      "Connect at least one calendar with the account.",
    );
  }

  const existingCalendarIds = new Set(allCalendars(state).map(calendar => calendar.id));
  const incomingCalendarIds = new Set<string>();
  for (const [index, calendar] of input.calendars.entries()) {
    const field = `calendars[${index}]`;
    if (!hasId(calendar.id)) {
      return mutationFailed(
        state,
        "invalid-id",
        `${field}.id`,
        "Calendar ID must not be empty or contain surrounding whitespace.",
      );
    }
    if (existingCalendarIds.has(calendar.id) || incomingCalendarIds.has(calendar.id)) {
      return mutationFailed(
        state,
        "duplicate-id",
        `${field}.id`,
        `A connected calendar with ID \"${calendar.id}\" already exists.`,
      );
    }
    incomingCalendarIds.add(calendar.id);
    if (!hasName(calendar.name)) {
      return mutationFailed(
        state,
        "empty-name",
        `${field}.name`,
        "Calendar name is required.",
      );
    }
    if (calendar.destination && !calendar.writable) {
      return mutationFailed(
        state,
        "invalid-destination",
        `${field}.destination`,
        "Only a writable calendar can be the Destination Calendar.",
      );
    }
  }

  const incomingDestinations = input.calendars.filter(calendar => calendar.destination);
  if (incomingDestinations.length > 1) {
    return mutationFailed(
      state,
      "invalid-destination",
      "calendars",
      "Choose only one Destination Calendar.",
    );
  }
  const automaticDestination = incomingDestinations.length === 0 &&
    allCalendars(state).every(calendar => !calendar.destination)
    ? preferredDestinationCalendar(input.calendars)
    : undefined;
  const effectiveIncomingDestinations = automaticDestination
    ? [automaticDestination]
    : incomingDestinations;
  const retainedDestinations = effectiveIncomingDestinations.length === 0
    ? allCalendars(state).filter(calendar => calendar.destination)
    : effectiveIncomingDestinations;
  const hasWritableCalendar = [
    ...allCalendars(state),
    ...input.calendars,
  ].some(calendar => calendar.writable);
  if (hasWritableCalendar && retainedDestinations.length === 0) {
    return mutationFailed(
      state,
      "missing-destination",
      "calendars",
      "Choose one writable Destination Calendar before adding writable calendars.",
    );
  }
  if (retainedDestinations.length > 1) {
    return mutationFailed(
      state,
      "invalid-destination",
      "calendars",
      "Calendar state must have exactly one writable Destination Calendar.",
    );
  }
  if (retainedDestinations.length > 0 && !retainedDestinations[0]?.writable) {
    return mutationFailed(
      state,
      "invalid-destination",
      "calendars",
      "The Destination Calendar must be writable.",
    );
  }

  const replacesDestination = effectiveIncomingDestinations.length === 1;
  const existingAccounts = replacesDestination
    ? state.accounts.map(account => ({
        ...account,
        calendars: account.calendars.map(calendar =>
          calendar.destination ? { ...calendar, destination: false } : calendar,
        ),
      }))
    : state.accounts;
  const account: CalendarAccount = {
    id: input.id,
    provider: input.provider,
    label: input.label.trim(),
    status: input.status,
    calendars: input.calendars.map(calendar => ({
      ...calendar,
      accountId: input.id,
      name: calendar.name.trim(),
      destination: calendar.destination || calendar.id === automaticDestination?.id,
    })),
  };
  return mutationSucceeded({
    ...state,
    accounts: [...existingAccounts, account],
  });
}

export function addCalendarsToAccount(
  state: CalendarState,
  input: AddCalendarsToAccountInput,
): CalendarMutationResult {
  const account = state.accounts.find(candidate => candidate.id === input.accountId);
  if (!account) {
    return mutationFailed(
      state,
      "account-not-found",
      "accountId",
      "The calendar account is no longer connected.",
    );
  }
  if (input.calendars.length === 0) {
    return mutationFailed(
      state,
      "empty-calendars",
      "calendars",
      "Add at least one calendar.",
    );
  }

  const existingCalendarIds = new Set(allCalendars(state).map(calendar => calendar.id));
  const incomingCalendarIds = new Set<string>();
  for (const [index, calendar] of input.calendars.entries()) {
    const field = `calendars[${index}]`;
    if (!hasId(calendar.id)) {
      return mutationFailed(
        state,
        "invalid-id",
        `${field}.id`,
        "Calendar ID must not be empty or contain surrounding whitespace.",
      );
    }
    if (existingCalendarIds.has(calendar.id) || incomingCalendarIds.has(calendar.id)) {
      return mutationFailed(
        state,
        "duplicate-id",
        `${field}.id`,
        `A connected calendar with ID "${calendar.id}" already exists.`,
      );
    }
    incomingCalendarIds.add(calendar.id);
    if (!hasName(calendar.name)) {
      return mutationFailed(
        state,
        "empty-name",
        `${field}.name`,
        "Calendar name is required.",
      );
    }
    if (calendar.destination && !calendar.writable) {
      return mutationFailed(
        state,
        "invalid-destination",
        `${field}.destination`,
        "Only a writable calendar can be the Destination Calendar.",
      );
    }
  }

  const incomingDestinations = input.calendars.filter(calendar => calendar.destination);
  if (incomingDestinations.length > 1) {
    return mutationFailed(
      state,
      "invalid-destination",
      "calendars",
      "Choose only one Destination Calendar.",
    );
  }
  const automaticDestination = incomingDestinations.length === 0 &&
    allCalendars(state).every(calendar => !calendar.destination)
    ? preferredDestinationCalendar(input.calendars)
    : undefined;
  const effectiveIncomingDestinations = automaticDestination
    ? [automaticDestination]
    : incomingDestinations;
  const retainedDestinations = effectiveIncomingDestinations.length === 0
    ? allCalendars(state).filter(calendar => calendar.destination)
    : effectiveIncomingDestinations;
  const hasWritableCalendar = [
    ...allCalendars(state),
    ...input.calendars,
  ].some(calendar => calendar.writable);
  if (hasWritableCalendar && retainedDestinations.length === 0) {
    return mutationFailed(
      state,
      "missing-destination",
      "calendars",
      "Choose one writable Destination Calendar before adding writable calendars.",
    );
  }

  const replacesDestination = effectiveIncomingDestinations.length === 1;
  const addsWritableCalendar = input.calendars.some(calendar => calendar.writable);
  const accounts = state.accounts.map(candidate => ({
    ...candidate,
    status: candidate.id === account.id && candidate.status === "read-only" && addsWritableCalendar
      ? "attention" as const
      : candidate.status,
    calendars: [
      ...candidate.calendars.map(calendar =>
        replacesDestination && calendar.destination
          ? { ...calendar, destination: false }
          : calendar,
      ),
      ...(candidate.id === account.id
        ? input.calendars.map(calendar => ({
            ...calendar,
            accountId: account.id,
            name: calendar.name.trim(),
            destination: calendar.destination || calendar.id === automaticDestination?.id,
          }))
        : []),
    ],
  }));
  return mutationSucceeded({ ...state, accounts });
}

export function renameCalendarAccount(
  state: CalendarState,
  accountId: string,
  label: string,
): CalendarMutationResult {
  const account = state.accounts.find(candidate => candidate.id === accountId);
  if (!account) {
    return mutationFailed(
      state,
      "account-not-found",
      "accountId",
      "The calendar account is no longer connected.",
    );
  }
  if (!hasName(label)) {
    return mutationFailed(
      state,
      "empty-name",
      "label",
      "Calendar account name is required.",
    );
  }
  const nextLabel = label.trim();
  if (account.label === nextLabel) return mutationSucceeded(state);
  return mutationSucceeded({
    ...state,
    accounts: state.accounts.map(candidate =>
      candidate.id === accountId ? { ...candidate, label: nextLabel } : candidate,
    ),
  });
}

export function updateCalendarAccountCalendars(
  state: CalendarState,
  accountId: string,
  update: Partial<Pick<ConnectedCalendar, "visible" | "conflicts">>,
): CalendarState {
  let changed = false;
  const accounts = state.accounts.map(account => {
    if (account.id !== accountId) return account;
    const calendars = account.calendars.map(calendar => {
      const visible = update.visible ?? calendar.visible;
      const conflicts =
        update.conflicts === undefined
          ? calendar.conflicts
          : update.conflicts && calendar.freshness === "stale"
            ? false
            : update.conflicts;
      if (visible === calendar.visible && conflicts === calendar.conflicts) {
        return calendar;
      }
      changed = true;
      return { ...calendar, visible, conflicts };
    });
    return changed ? { ...account, calendars } : account;
  });
  return changed ? { ...state, accounts } : state;
}

/**
 * Removes a provider calendar only from TAP's local projection.
 *
 * This mutation never revokes provider access or deletes the upstream calendar.
 * The caller is responsible for persisting provider-calendar suppression in the
 * Calendar gateway before committing the returned state.
 */
export function removeCalendarFromTap(
  state: CalendarState,
  calendarId: string,
  replacementDestinationId?: string,
): CalendarMutationResult {
  const calendar = allCalendars(state).find(candidate => candidate.id === calendarId);
  if (!calendar) {
    return mutationFailed(
      state,
      "calendar-not-found",
      "calendarId",
      "The calendar is no longer connected to TAP Calendar.",
    );
  }

  const remainingCalendars = allCalendars(state).filter(candidate => candidate.id !== calendarId);
  const remainingWritableCalendars = remainingCalendars.filter(candidate => candidate.writable);
  const removesDestination = calendar.destination;
  const requestedReplacement = replacementDestinationId === undefined
    ? undefined
    : remainingCalendars.find(candidate => candidate.id === replacementDestinationId);

  if (removesDestination && replacementDestinationId !== undefined && !requestedReplacement) {
    return mutationFailed(
      state,
      "invalid-destination",
      "replacementDestinationId",
      "The replacement Destination Calendar must remain connected to TAP Calendar.",
    );
  }
  if (requestedReplacement && !requestedReplacement.writable) {
    return mutationFailed(
      state,
      "invalid-destination",
      "replacementDestinationId",
      "The replacement Destination Calendar must be writable.",
    );
  }
  if (removesDestination && remainingWritableCalendars.length > 0 && !requestedReplacement) {
    return mutationFailed(
      state,
      "missing-destination",
      "replacementDestinationId",
      "Choose a writable Destination Calendar before removing the current destination from TAP.",
    );
  }

  const retainedDestination = removesDestination
    ? requestedReplacement
    : remainingCalendars.find(candidate => candidate.destination);
  const eventTypeReplacement = retainedDestination ?? remainingWritableCalendars[0];
  const accounts = state.accounts
    .map(account => ({
      ...account,
      calendars: account.calendars
        .filter(candidate => candidate.id !== calendarId)
        .map(candidate => ({
          ...candidate,
          destination: candidate.id === retainedDestination?.id,
        })),
    }))
    .filter(account => account.calendars.length > 0);
  const removedEventIds = new Set(
    state.events
      .filter(event => event.calendarId === calendarId)
      .map(event => event.id),
  );
  const removedBookingRequestIds = new Set(
    state.bookingRequests
      .filter(request => removedEventIds.has(request.eventId))
      .map(request => request.id),
  );

  return mutationSucceeded({
    ...state,
    accounts,
    events: state.events.filter(event => event.calendarId !== calendarId),
    bookingRequests: state.bookingRequests.filter(
      request => !removedEventIds.has(request.eventId),
    ),
    bookingProfiles: state.bookingProfiles.map(profile => ({
      ...profile,
      eventTypes: profile.eventTypes.map(eventType =>
        eventType.destinationCalendarId === calendarId
          ? {
              ...eventType,
              destinationCalendarId: eventTypeReplacement?.id ?? "",
              active: eventTypeReplacement ? eventType.active : false,
            }
          : eventType,
      ),
    })),
    notificationChannels: state.notificationChannels.map(channel => ({
      ...channel,
      entries: channel.entries.filter(entry =>
        entry.bookingRequestId === undefined ||
        !removedBookingRequestIds.has(entry.bookingRequestId)
      ),
    })),
  });
}

export function disconnectCalendarAccount(
  state: CalendarState,
  accountId: string,
  replacementDestinationId?: string,
): CalendarMutationResult {
  const account = state.accounts.find(candidate => candidate.id === accountId);
  if (!account) {
    return mutationFailed(
      state,
      "account-not-found",
      "accountId",
      "The calendar account is no longer connected.",
    );
  }

  const removedCalendarIds = new Set(account.calendars.map(calendar => calendar.id));
  const remainingAccounts = state.accounts.filter(candidate => candidate.id !== accountId);
  const remainingCalendars = remainingAccounts.flatMap(candidate => candidate.calendars);
  const removesDestination = account.calendars.some(calendar => calendar.destination);
  const replacementDestination = removesDestination
    ? remainingCalendars.find(calendar => calendar.id === replacementDestinationId)
    : remainingCalendars.find(calendar => calendar.destination);
  const remainingWritableCalendars = remainingCalendars.filter(calendar => calendar.writable);

  if (!replacementDestination && remainingWritableCalendars.length > 0) {
    return mutationFailed(
      state,
      "missing-destination",
      "replacementDestinationId",
      removesDestination
        ? "Choose a writable Destination Calendar from another account before disconnecting this account."
        : "TAP Calendar must retain a writable Destination Calendar.",
    );
  }
  if (replacementDestination && !replacementDestination.writable) {
    return mutationFailed(
      state,
      "invalid-destination",
      "replacementDestinationId",
      "The replacement Destination Calendar must be writable.",
    );
  }

  const accounts = remainingAccounts.map(candidate => ({
    ...candidate,
    calendars: candidate.calendars.map(calendar => ({
      ...calendar,
      destination: calendar.id === replacementDestination?.id,
    })),
  }));
  const removedEventIds = new Set(
    state.events
      .filter(event => removedCalendarIds.has(event.calendarId))
      .map(event => event.id),
  );

  return mutationSucceeded({
    ...state,
    accounts,
    events: state.events.filter(event => !removedCalendarIds.has(event.calendarId)),
    bookingRequests: state.bookingRequests.filter(
      request => !removedEventIds.has(request.eventId),
    ),
    bookingProfiles: state.bookingProfiles.map(profile => ({
      ...profile,
      eventTypes: profile.eventTypes.map(eventType =>
        removedCalendarIds.has(eventType.destinationCalendarId)
          ? {
              ...eventType,
              destinationCalendarId: replacementDestination?.id ?? "",
              active: replacementDestination ? eventType.active : false,
            }
          : eventType,
      ),
    })),
  });
}

export function addAvailabilitySchedule(
  state: CalendarState,
  schedule: AvailabilitySchedule,
  options: AddAvailabilityScheduleOptions = {},
): CalendarMutationResult {
  if (!hasId(schedule.id)) {
    return mutationFailed(
      state,
      "invalid-id",
      "id",
      "Availability Schedule ID must not be empty or contain surrounding whitespace.",
    );
  }
  if (state.availability.some(candidate => candidate.id === schedule.id)) {
    return mutationFailed(
      state,
      "duplicate-id",
      "id",
      `An Availability Schedule with ID \"${schedule.id}\" already exists.`,
    );
  }
  if (!hasName(schedule.name)) {
    return mutationFailed(
      state,
      "empty-name",
      "name",
      "Availability Schedule name is required.",
    );
  }
  const availabilityError = validateAvailabilityWindows(schedule.windows);
  if (availabilityError) {
    return mutationFailed(
      state,
      "invalid-availability",
      "windows",
      availabilityError,
    );
  }
  const nextSchedule = { ...schedule, name: schedule.name.trim() };
  const migratedState = migrateLegacyEventTypeAvailabilitySchedules(state);
  return mutationSucceeded(migrateLegacyEventTypeAvailabilitySchedules({
    ...migratedState,
    availability: [...migratedState.availability, nextSchedule],
    activeAvailabilityId: options.makeDefault || migratedState.availability.length === 0
      ? nextSchedule.id
      : migratedState.activeAvailabilityId,
  }));
}

export function addBookingProfile(
  state: CalendarState,
  profile: BookingProfile,
): CalendarMutationResult {
  if (!hasId(profile.id)) {
    return mutationFailed(
      state,
      "invalid-id",
      "id",
      "Booking Profile ID must not be empty or contain surrounding whitespace.",
    );
  }
  if (state.bookingProfiles.some(candidate => candidate.id === profile.id)) {
    return mutationFailed(
      state,
      "duplicate-id",
      "id",
      `A Booking Profile with ID \"${profile.id}\" already exists.`,
    );
  }
  if (!hasName(profile.displayName)) {
    return mutationFailed(
      state,
      "empty-name",
      "displayName",
      "Booking Profile name is required.",
    );
  }
  const slugError = validateSlug(profile.slug);
  if (slugError) {
    return mutationFailed(state, "invalid-slug", "slug", slugError);
  }
  if (state.bookingProfiles.some(candidate => candidate.slug === profile.slug)) {
    return mutationFailed(
      state,
      "duplicate-slug",
      "slug",
      `The Booking Profile Slug \"${profile.slug}\" is already in use.`,
    );
  }

  const profileEventIds = new Set<string>();
  const profileEventSlugs = new Set<string>();
  for (const [index, eventType] of profile.eventTypes.entries()) {
    const validationError = validateEventTypeDefinition(state, eventType);
    if (validationError) {
      return mutationFailed(
        state,
        validationError.code,
        `eventTypes[${index}].${validationError.field}`,
        validationError.message,
      );
    }
    if (profileEventIds.has(eventType.id)) {
      return mutationFailed(
        state,
        "duplicate-id",
        `eventTypes[${index}].id`,
        `An Event Type with ID \"${eventType.id}\" already exists in this Booking Profile.`,
      );
    }
    if (profileEventSlugs.has(eventType.slug)) {
      return mutationFailed(
        state,
        "duplicate-slug",
        `eventTypes[${index}].slug`,
        `The Event Type Slug \"${eventType.slug}\" is already in use in this Booking Profile.`,
      );
    }
    profileEventIds.add(eventType.id);
    profileEventSlugs.add(eventType.slug);
  }

  const migratedState = migrateLegacyEventTypeAvailabilitySchedules(state);
  return mutationSucceeded({
    ...migratedState,
    bookingProfiles: [
      ...migratedState.bookingProfiles,
      {
        ...profile,
        displayName: profile.displayName.trim(),
        eventTypes: profile.eventTypes.map(eventType => ({
          ...eventType,
          title: eventType.title.trim(),
        })),
      },
    ],
  });
}

export function addEventType(
  state: CalendarState,
  profileId: string,
  eventType: NewEventType,
): CalendarMutationResult {
  const profile = state.bookingProfiles.find(candidate => candidate.id === profileId);
  if (!profile) {
    return mutationFailed(
      state,
      "profile-not-found",
      "profileId",
      `Booking Profile \"${profileId}\" was not found.`,
    );
  }
  const validationError = validateEventTypeDefinition(state, eventType);
  if (validationError) {
    return mutationFailed(
      state,
      validationError.code,
      validationError.field,
      validationError.message,
    );
  }
  if (profile.eventTypes.some(candidate => candidate.slug === eventType.slug)) {
    return mutationFailed(
      state,
      "duplicate-slug",
      "slug",
      `The Event Type Slug \"${eventType.slug}\" is already in use in this Booking Profile.`,
    );
  }
  const migratedState = migrateLegacyEventTypeAvailabilitySchedules(state);
  return mutationSucceeded({
    ...migratedState,
    bookingProfiles: migratedState.bookingProfiles.map(candidate =>
      candidate.id === profileId
        ? {
            ...candidate,
            eventTypes: [
              ...candidate.eventTypes,
              { ...eventType, title: eventType.title.trim() },
            ],
          }
        : candidate,
    ),
  });
}

export const visibleCalendarIds = (state: CalendarState): ReadonlySet<string> =>
  new Set(allCalendars(state).filter(calendar => calendar.visible).map(calendar => calendar.id));

export const visibleEvents = (state: CalendarState): readonly CalendarEvent[] => {
  const visible = visibleCalendarIds(state);
  return state.events.filter(event => visible.has(event.calendarId));
};

export function updateCalendar(
  state: CalendarState,
  calendarId: string,
  update: Partial<Pick<ConnectedCalendar, "visible" | "conflicts" | "destination">>,
): CalendarState {
  const target = allCalendars(state).find(calendar => calendar.id === calendarId);
  if (!target) return state;
  const canBecomeDestination = update.destination === true && target.writable;
  let found = false;
  const accounts = state.accounts.map(account => ({
    ...account,
    calendars: account.calendars.map(calendar => {
      if (calendar.id !== calendarId) {
        if (canBecomeDestination) return { ...calendar, destination: false };
        return calendar;
      }
      found = true;
      return {
        ...calendar,
        ...update,
        destination:
          update.destination === true && !calendar.writable
            ? calendar.destination
            : (update.destination ?? calendar.destination),
      };
    }),
  }));
  return found ? { ...state, accounts } : state;
}

export function setCalendarView(
  state: CalendarState,
  activeView: CalendarView,
): CalendarState {
  return { ...state, activeView };
}

const tapOnlyLocations = new Set<MeetingLocation>(["tap-room", "tap-huddle"]);

export const hasExternalGuests = (
  attendees: readonly CalendarAttendee[],
): boolean => attendees.some(attendee => attendee.kind === "external");

export function validateGuestCompatibility(
  location: MeetingLocation,
  attendees: readonly CalendarAttendee[],
): string | null {
  if (tapOnlyLocations.has(location) && hasExternalGuests(attendees)) {
    return "External guests are not TAP users. Confirm accountless guest access before using a TAP meeting room or scheduled TAP Voice Huddle.";
  }
  return null;
}

function appendChannelEntry(
  state: CalendarState,
  entry: CalendarChannelEntry,
): readonly CalendarNotificationChannel[] {
  const personalId = state.notificationChannels.find(channel => channel.scope === "private")?.id;
  return state.notificationChannels.map(channel =>
    channel.id === personalId
      ? { ...channel, entries: [entry, ...channel.entries] }
      : channel,
  );
}

export function scheduleMeeting(
  state: CalendarState,
  input: ScheduleMeetingInput,
): ScheduleMeetingResult {
  const calendar = allCalendars(state).find(candidate => candidate.id === input.calendarId);
  if (!calendar?.writable) {
    return {
      state,
      error: "Choose a writable Destination Calendar before scheduling.",
      bookingRequestId: null,
    };
  }
  if (new Date(input.end).getTime() <= new Date(input.start).getTime()) {
    return {
      state,
      error: "The meeting must end after it starts.",
      bookingRequestId: null,
    };
  }
  if (input.bookingRequestId !== undefined && !hasId(input.bookingRequestId)) {
    return {
      state,
      error: "The Booking request ID must not be empty or contain surrounding whitespace.",
      bookingRequestId: null,
    };
  }
  const bookingRequestId = input.approvalRequired
    ? input.bookingRequestId ?? `${input.id}-request`
    : null;
  const existingEvent = state.events.find(candidate => candidate.id === input.id);
  if (existingEvent) {
    const existingRequest = bookingRequestId
      ? state.bookingRequests.find(candidate => candidate.id === bookingRequestId)
      : undefined;
    const eventMatches =
      existingEvent.title === input.title.trim() &&
      existingEvent.calendarId === input.calendarId &&
      existingEvent.start === input.start &&
      existingEvent.end === input.end &&
      existingEvent.kind === (input.approvalRequired ? "hold" : "meeting") &&
      existingEvent.status === (input.approvalRequired ? "pending" : "confirmed") &&
      existingEvent.location === input.location &&
      JSON.stringify(existingEvent.attendees) === JSON.stringify(input.attendees);
    const requestMatches = bookingRequestId === null || (
      existingRequest?.eventId === input.id &&
      existingRequest.status === "pending"
    );
    return eventMatches && requestMatches
      ? { state, error: null, bookingRequestId }
      : {
          state,
          error: "This provider booking identifier is already attached to a different event.",
          bookingRequestId: null,
        };
  }
  if (
    bookingRequestId &&
    state.bookingRequests.some(candidate => candidate.id === bookingRequestId)
  ) {
    return {
      state,
      error: "This provider booking request identifier is already in use.",
      bookingRequestId: null,
    };
  }
  const status: BookingStatus = input.approvalRequired ? "pending" : "confirmed";
  const event: CalendarEvent = {
    id: input.id,
    title: input.title.trim(),
    calendarId: input.calendarId,
    start: input.start,
    end: input.end,
    kind: input.approvalRequired ? "hold" : "meeting",
    status,
    location: input.location,
    attendees: input.attendees,
    busy: true,
    ...(input.providerHtmlLink ? { providerHtmlLink: input.providerHtmlLink } : {}),
    ...(input.providerJoinUrl ? { providerJoinUrl: input.providerJoinUrl } : {}),
  };
  const externalGuest = input.attendees.find(attendee => attendee.kind === "external");
  const entry: CalendarChannelEntry = {
    id: `${input.id}-channel-entry`,
    createdAt: input.requestedAt,
    kind: input.approvalRequired ? "approval" : "booking",
    title: input.approvalRequired
      ? "Meeting approval requested"
      : "Meeting scheduled",
    summary: `${externalGuest?.name ?? (input.attendees.length === 0 ? "Just you" : "Channel participants")} · ${input.title.trim()}`,
    ...(bookingRequestId ? { bookingRequestId } : {}),
    redacted: false,
  };
  const bookingRequests: readonly BookingRequest[] = bookingRequestId
    ? [
        {
          id: bookingRequestId,
          eventTypeId: input.eventTypeId ?? "one-off",
          eventId: input.id,
          guestName: externalGuest?.name ?? "Channel participants",
          guestEmail: externalGuest?.email ?? "",
          status: "pending",
          requestedAt: input.requestedAt,
          expiresAt: new Date(
            new Date(input.requestedAt).getTime() + 24 * 60 * 60 * 1000,
          ).toISOString(),
        },
        ...state.bookingRequests,
      ]
    : state.bookingRequests;
  return {
    state: {
      ...state,
      events: [...state.events, event],
      bookingRequests,
      notificationChannels: appendChannelEntry(state, entry),
    },
    error: null,
    bookingRequestId,
  };
}

export function decideBookingRequest(
  state: CalendarState,
  requestId: string,
  decision: "confirmed" | "declined",
  decidedAt: string,
): CalendarState {
  const request = state.bookingRequests.find(candidate => candidate.id === requestId);
  if (!request || request.status !== "pending") return state;
  const title = decision === "confirmed" ? "Meeting approved" : "Meeting declined";
  const entry: CalendarChannelEntry = {
    id: `${requestId}-${decision}`,
    createdAt: decidedAt,
    kind: decision === "confirmed" ? "booking" : "cancellation",
    title,
    summary: `${request.guestName} · ${decision === "confirmed" ? "Booking confirmed" : "Request declined"}`,
    redacted: false,
  };
  const tracked = decision === "confirmed" && request.eventTypeId !== "one-off"
    ? trackFunnel(state, request.eventTypeId, "confirmed")
    : state;
  return {
    ...tracked,
    bookingRequests: tracked.bookingRequests.map(candidate =>
      candidate.id === requestId ? { ...candidate, status: decision } : candidate,
    ),
    events: tracked.events.map(event =>
      event.id === request.eventId
        ? {
            ...event,
            status: decision,
            kind: decision === "confirmed" ? "meeting" : event.kind,
            ...(decision === "declined" ? { busy: false } : {}),
          }
        : event,
    ),
    notificationChannels: appendChannelEntry(tracked, entry),
  };
}

export function expireBookingRequest(
  state: CalendarState,
  requestId: string,
  expiredAt: string,
): CalendarState {
  const request = state.bookingRequests.find(candidate => candidate.id === requestId);
  if (!request || request.status !== "pending") return state;
  const entry: CalendarChannelEntry = {
    id: `${requestId}-expired`,
    createdAt: expiredAt,
    kind: "cancellation",
    title: "Meeting request expired",
    summary: `${request.guestName} · Provider hold expired`,
    redacted: false,
  };
  return {
    ...state,
    bookingRequests: state.bookingRequests.map(candidate =>
      candidate.id === requestId ? { ...candidate, status: "cancelled" } : candidate,
    ),
    events: state.events.map(event =>
      event.id === request.eventId
        ? { ...event, status: "cancelled", busy: false }
        : event,
    ),
    notificationChannels: appendChannelEntry(state, entry),
  };
}

export function createWorkBlock(
  state: CalendarState,
  input: {
    readonly id: string;
    readonly calendarId: string;
    readonly title: string;
    readonly start: string;
    readonly end: string;
    readonly sourceKind: "task" | "channel" | "message";
    readonly sourceId: string;
    readonly sourceLabel: string;
    readonly providerHtmlLink?: string;
  },
): CalendarState {
  const calendar = allCalendars(state).find(candidate => candidate.id === input.calendarId);
  if (!calendar?.writable || new Date(input.end) <= new Date(input.start)) return state;
  const existingEvent = state.events.find(candidate => candidate.id === input.id);
  if (existingEvent) return state;
  return {
    ...state,
    events: [
      ...state.events,
      {
        id: input.id,
        calendarId: input.calendarId,
        title: input.title.trim(),
        start: input.start,
        end: input.end,
        kind: "work-block",
        status: "confirmed",
        location: null,
        attendees: [],
        ...(input.providerHtmlLink ? { providerHtmlLink: input.providerHtmlLink } : {}),
        source: {
          kind: input.sourceKind,
          id: input.sourceId,
          label: input.sourceLabel,
        },
      },
    ],
  };
}

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export function validateSlug(slug: string): string | null {
  if (slug.length < 2 || slug.length > 64) return "Use between 2 and 64 characters.";
  if (!slugPattern.test(slug)) return "Use lowercase letters, numbers, and single hyphens.";
  return null;
}

export function publicBookingUrl(profileSlug: string, eventSlug: string): string {
  if (validateSlug(profileSlug) || validateSlug(eventSlug)) {
    throw new Error("Cannot create a public booking URL from an invalid slug.");
  }
  return `https://cal.with-tap.ai/${profileSlug}/${eventSlug}`;
}

export function conversionRate(analytics: FunnelAnalytics): number {
  return analytics.views === 0 ? 0 : analytics.confirmed / analytics.views;
}

export function trackFunnel(
  state: CalendarState,
  eventTypeId: string,
  stage: keyof FunnelAnalytics,
): CalendarState {
  return {
    ...state,
    bookingProfiles: state.bookingProfiles.map(profile => ({
      ...profile,
      eventTypes: profile.eventTypes.map(eventType =>
        eventType.id === eventTypeId
          ? {
              ...eventType,
              analytics: {
                ...eventType.analytics,
                [stage]: eventType.analytics[stage] + 1,
              },
            }
          : eventType,
      ),
    })),
  };
}

export function schedulePublicBooking(
  state: CalendarState,
  input: Omit<ScheduleMeetingInput, "eventTypeId"> & {
    readonly eventTypeId: string;
  },
): ScheduleMeetingResult {
  if (state.events.some(event => event.id === input.id)) {
    return scheduleMeeting(state, input);
  }
  const tracked = trackFunnel(
    trackFunnel(state, input.eventTypeId, "starts"),
    input.eventTypeId,
    "requests",
  );
  const scheduled = scheduleMeeting(tracked, input);
  if (scheduled.error) {
    return { ...scheduled, state };
  }
  return scheduled.bookingRequestId
    ? scheduled
    : {
        ...scheduled,
        state: trackFunnel(scheduled.state, input.eventTypeId, "confirmed"),
      };
}

export function updateNotificationPreferences(
  state: CalendarState,
  update: Partial<NotificationPreferences>,
): CalendarState {
  return {
    ...state,
    notificationPreferences: {
      ...state.notificationPreferences,
      ...update,
    },
  };
}

export function reminderAt(event: CalendarEvent, minutesBefore: number): string {
  return new Date(new Date(event.start).getTime() - minutesBefore * 60_000).toISOString();
}

function minutesFromMidnight(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
}

const overlaps = (
  start: number,
  end: number,
  candidateStart: number,
  candidateEnd: number,
): boolean => start < candidateEnd && end > candidateStart;

interface ZonedWallClockParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

const zonedPartsFormatters = new Map<string, Intl.DateTimeFormat>();

function zonedPartsFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = zonedPartsFormatters.get(timeZone);
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
  zonedPartsFormatters.set(timeZone, formatter);
  return formatter;
}

function zonedWallClockParts(instant: number, timeZone: string): ZonedWallClockParts {
  const values: Record<string, number> = {};
  for (const part of zonedPartsFormatter(timeZone).formatToParts(new Date(instant))) {
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
}

function offsetMinutesAtInstant(instant: number, timeZone: string): number {
  const parts = zonedWallClockParts(instant, timeZone);
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return Math.round((localAsUtc - Math.trunc(instant / 1_000) * 1_000) / 60_000);
}

/**
 * Resolve a local wall-clock minute in an IANA zone. Nonexistent spring-forward
 * times are omitted; repeated fall-back times choose the earlier occurrence so
 * a displayed wall time appears exactly once.
 */
export function zonedWallClockInstant(
  date: string,
  minuteFromMidnight: number,
  timeZone: string,
): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match || !Number.isInteger(minuteFromMidnight) || minuteFromMidnight < 0 || minuteFromMidnight >= 1_440) {
    return null;
  }
  const desired: ZonedWallClockParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Math.floor(minuteFromMidnight / 60),
    minute: minuteFromMidnight % 60,
    second: 0,
  };
  const wallClockUtc = Date.UTC(
    desired.year,
    desired.month - 1,
    desired.day,
    desired.hour,
    desired.minute,
  );
  const possibleOffsets = new Set<number>();
  for (const sampleHours of [-36, -24, -12, -6, 0, 6, 12, 24, 36]) {
    possibleOffsets.add(offsetMinutesAtInstant(wallClockUtc + sampleHours * 3_600_000, timeZone));
  }
  const candidates = [...possibleOffsets]
    .map(offset => wallClockUtc - offset * 60_000)
    .filter(instant => {
      const actual = zonedWallClockParts(instant, timeZone);
      return actual.year === desired.year &&
        actual.month === desired.month &&
        actual.day === desired.day &&
        actual.hour === desired.hour &&
        actual.minute === desired.minute;
    })
    .sort((left, right) => left - right);
  return candidates[0] === undefined ? null : new Date(candidates[0]);
}

type AvailableSlotTimeZone =
  | { readonly timezoneOffset: string; readonly timeZone?: never }
  | { readonly timeZone: string; readonly timezoneOffset?: never };

export {
  availabilityForDate,
  type AvailabilityForDate,
} from "./availability-policy";

export function findAvailableSlots(input: {
  readonly date: string;
  readonly durationMinutes: number;
  readonly intervalMinutes: number;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly busy: readonly Pick<CalendarEvent, "start" | "end" | "busy">[];
  readonly bufferBeforeMinutes?: number;
  readonly bufferAfterMinutes?: number;
} & AvailableSlotTimeZone): readonly AvailableSlot[] {
  const slots: AvailableSlot[] = [];
  const startMinute = minutesFromMidnight(input.windowStart);
  const endMinute = minutesFromMidnight(input.windowEnd);
  const before = input.bufferBeforeMinutes ?? 0;
  const after = input.bufferAfterMinutes ?? 0;
  const zonedWindowEnd = typeof input.timeZone === "string"
    ? zonedWallClockInstant(input.date, endMinute, input.timeZone)
    : null;
  if (typeof input.timeZone === "string" && zonedWindowEnd === null) return [];
  for (
    let minute = startMinute;
    minute + input.durationMinutes <= endMinute;
    minute += input.intervalMinutes
  ) {
    const start = typeof input.timeZone === "string"
      ? zonedWallClockInstant(input.date, minute, input.timeZone)
      : new Date(
          `${input.date}T${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}:00${input.timezoneOffset}`,
        );
    if (start === null || Number.isNaN(start.getTime())) continue;
    const end = new Date(start.getTime() + input.durationMinutes * 60_000);
    if (zonedWindowEnd !== null && end.getTime() > zonedWindowEnd.getTime()) continue;
    const busy = input.busy.some(event =>
      event.busy !== false &&
      overlaps(
        start.getTime() - before * 60_000,
        end.getTime() + after * 60_000,
        new Date(event.start).getTime(),
        new Date(event.end).getTime(),
      ),
    );
    if (!busy) slots.push({ start: start.toISOString(), end: end.toISOString() });
  }
  return slots;
}

export function findAvailableSlotsAcrossWindows(input: {
  readonly date: string;
  readonly durationMinutes: number;
  readonly intervalMinutes: number;
  readonly windows: readonly Pick<AvailabilityWindow, "enabled" | "start" | "end">[];
  readonly busy: readonly Pick<CalendarEvent, "start" | "end" | "busy">[];
  readonly bufferBeforeMinutes?: number;
  readonly bufferAfterMinutes?: number;
} & AvailableSlotTimeZone): readonly AvailableSlot[] {
  const unique = new Map<string, AvailableSlot>();
  for (const window of input.windows) {
    if (!window.enabled) continue;
    const common = {
      date: input.date,
      durationMinutes: input.durationMinutes,
      intervalMinutes: input.intervalMinutes,
      windowStart: window.start,
      windowEnd: window.end,
      busy: input.busy,
      ...(input.bufferBeforeMinutes === undefined ? {} : { bufferBeforeMinutes: input.bufferBeforeMinutes }),
      ...(input.bufferAfterMinutes === undefined ? {} : { bufferAfterMinutes: input.bufferAfterMinutes }),
    };
    const slots = typeof input.timeZone === "string"
      ? findAvailableSlots({ ...common, timeZone: input.timeZone })
      : findAvailableSlots({ ...common, timezoneOffset: input.timezoneOffset });
    for (const slot of slots) unique.set(`${slot.start}\u0000${slot.end}`, slot);
  }
  return [...unique.values()].sort((left, right) =>
    left.start.localeCompare(right.start) || left.end.localeCompare(right.end),
  );
}

/**
 * Applies the Availability Schedule rules that operate on otherwise-free slots.
 * Busy-time buffers are applied while the slots are generated; this final pass
 * enforces booking lead time/horizon and ranks preferred wall-clock starts.
 */
export function applyAvailabilityBookingPolicy(
  slots: readonly AvailableSlot[],
  input: Pick<
    AvailabilitySchedule,
    "preferredStart" | "preferredEnd" | "minimumNoticeMinutes" | "bookingHorizonDays"
  > & {
    readonly timeZone: string;
    /** Schedule zone used for calendar-day booking-horizon boundaries. */
    readonly horizonTimeZone?: string;
    /** Requested schedule calendar date when every slot belongs to one date. */
    readonly calendarDate?: string;
    readonly now?: number;
  },
): readonly AvailableSlot[] {
  const now = input.now ?? Date.now();
  const earliestStart = now + input.minimumNoticeMinutes * 60_000;
  const preferredStart = minutesFromMidnight(input.preferredStart);
  const preferredEnd = minutesFromMidnight(input.preferredEnd);
  const preferredWindowIsValid = preferredStart < preferredEnd;
  try {
    const horizonTimeZone = input.horizonTimeZone ?? input.timeZone;
    const today = zonedWallClockParts(now, horizonTimeZone);
    const todayIndex = Math.floor(Date.UTC(today.year, today.month - 1, today.day) / 86_400_000);
    const requestedDateIndex = input.calendarDate === undefined
      ? null
      : (() => {
          const parsed = Date.parse(`${input.calendarDate}T00:00:00.000Z`);
          return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === input.calendarDate
            ? Math.floor(parsed / 86_400_000)
            : Number.NaN;
        })();
    return slots
      .flatMap(slot => {
        const start = Date.parse(slot.start);
        if (!Number.isFinite(start)) return [];
        const preferredWall = zonedWallClockParts(start, input.timeZone);
        const horizonWall = requestedDateIndex === null
          ? zonedWallClockParts(start, horizonTimeZone)
          : null;
        const dayIndex = requestedDateIndex ?? Math.floor(Date.UTC(
          horizonWall!.year,
          horizonWall!.month - 1,
          horizonWall!.day,
        ) / 86_400_000);
        const wallMinute = preferredWall.hour * 60 + preferredWall.minute;
        return [{
          slot,
          allowed: start >= earliestStart &&
            dayIndex >= todayIndex &&
            dayIndex < todayIndex + input.bookingHorizonDays,
          preferred: preferredWindowIsValid &&
            wallMinute >= preferredStart &&
            wallMinute < preferredEnd,
        }];
      })
      .filter(candidate => candidate.allowed)
      .sort((left, right) =>
        Number(right.preferred) - Number(left.preferred) ||
        left.slot.start.localeCompare(right.slot.start) ||
        left.slot.end.localeCompare(right.slot.end)
      )
      .map(candidate => candidate.slot);
  } catch {
    return [];
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isOneOf = <Value extends string>(
  value: unknown,
  options: readonly Value[],
): value is Value =>
  typeof value === "string" && options.includes(value as Value);

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

const isClockTime = (value: unknown): value is string =>
  typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value);

const isIsoDateTime = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));

const isConnectedCalendar = (value: unknown): value is ConnectedCalendar => {
  if (!isRecord(value)) return false;
  return (
    hasId(typeof value.id === "string" ? value.id : "") &&
    hasId(typeof value.accountId === "string" ? value.accountId : "") &&
    hasName(typeof value.name === "string" ? value.name : "") &&
    typeof value.color === "string" &&
    isOneOf(value.role, ["owner", "writer", "reader", "free-busy"] as const) &&
    typeof value.visible === "boolean" &&
    typeof value.conflicts === "boolean" &&
    typeof value.writable === "boolean" &&
    typeof value.destination === "boolean" &&
    (value.primary === undefined || typeof value.primary === "boolean") &&
    isOneOf(value.freshness, ["live", "delayed", "stale"] as const) &&
    (value.unreadCount === undefined || isNonNegativeInteger(value.unreadCount)) &&
    value.writable === (value.role === "owner" || value.role === "writer") &&
    !(value.destination && !value.writable) &&
    !(value.freshness === "stale" && value.conflicts)
  );
};

const isCalendarAccount = (value: unknown): value is CalendarAccount => {
  if (!isRecord(value)) return false;
  return (
    hasId(typeof value.id === "string" ? value.id : "") &&
    isOneOf(value.provider, ["google", "microsoft", "icloud", "caldav", "exchange", "ics"] as const) &&
    hasName(typeof value.label === "string" ? value.label : "") &&
    isOneOf(value.status, ["connected", "attention", "read-only"] as const) &&
    Array.isArray(value.calendars) &&
    value.calendars.length > 0 &&
    value.calendars.every(isConnectedCalendar)
  );
};

const isCalendarAttendee = (value: unknown): value is CalendarAttendee => {
  if (!isRecord(value)) return false;
  return (
    hasId(typeof value.id === "string" ? value.id : "") &&
    hasName(typeof value.name === "string" ? value.name : "") &&
    typeof value.email === "string" &&
    isOneOf(value.kind, ["tap", "external"] as const) &&
    typeof value.required === "boolean"
  );
};

const isCalendarEvent = (value: unknown): value is CalendarEvent => {
  if (!isRecord(value)) return false;
  const sourceValid = value.source === undefined || (
    isRecord(value.source) &&
    isOneOf(value.source.kind, ["task", "channel", "message"] as const) &&
    hasId(typeof value.source.id === "string" ? value.source.id : "") &&
    hasName(typeof value.source.label === "string" ? value.source.label : "")
  );
  return (
    hasId(typeof value.id === "string" ? value.id : "") &&
    hasId(typeof value.calendarId === "string" ? value.calendarId : "") &&
    hasName(typeof value.title === "string" ? value.title : "") &&
    isIsoDateTime(value.start) &&
    isIsoDateTime(value.end) &&
    Date.parse(value.end) > Date.parse(value.start) &&
    isOneOf(value.kind, ["meeting", "work-block", "hold", "focus"] as const) &&
    isOneOf(value.status, ["pending", "confirmed", "declined", "cancelled"] as const) &&
    (value.location === null || isOneOf(value.location, [
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
    ] as const)) &&
    Array.isArray(value.attendees) &&
    value.attendees.every(isCalendarAttendee) &&
    (value.busy === undefined || typeof value.busy === "boolean") &&
    (value.allDay === undefined || typeof value.allDay === "boolean") &&
    (value.providerHtmlLink === undefined ||
      (typeof value.providerHtmlLink === "string" &&
        value.providerHtmlLink.startsWith("https://"))) &&
    (value.providerJoinUrl === undefined ||
      (typeof value.providerJoinUrl === "string" &&
        value.providerJoinUrl.startsWith("https://"))) &&
    sourceValid
  );
};

const isAvailabilityWindow = (value: unknown): value is AvailabilityWindow => {
  if (!isRecord(value)) return false;
  return (
    (value.id === undefined || (typeof value.id === "string" && hasId(value.id))) &&
    typeof value.day === "number" &&
    Number.isInteger(value.day) &&
    value.day >= 0 &&
    value.day <= 6 &&
    typeof value.enabled === "boolean" &&
    isClockTime(value.start) &&
    isClockTime(value.end)
  );
};

const isAvailabilityOverride = (value: unknown): value is AvailabilityOverride => {
  if (!isRecord(value)) return false;
  return (
    hasId(typeof value.id === "string" ? value.id : "") &&
    typeof value.date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/u.test(value.date) &&
    hasName(typeof value.label === "string" ? value.label : "") &&
    typeof value.available === "boolean" &&
    (value.timezone === undefined || hasName(
      typeof value.timezone === "string" ? value.timezone : "",
    )) &&
    (value.start === undefined || isClockTime(value.start)) &&
    (value.end === undefined || isClockTime(value.end)) &&
    (!value.available || (isClockTime(value.start) && isClockTime(value.end)))
  );
};

const isAvailabilitySchedule = (value: unknown): value is AvailabilitySchedule => {
  if (!isRecord(value)) return false;
  const windows = value.windows;
  return (
    hasId(typeof value.id === "string" ? value.id : "") &&
    hasName(typeof value.name === "string" ? value.name : "") &&
    hasName(typeof value.timezone === "string" ? value.timezone : "") &&
    isClockTime(value.preferredStart) &&
    isClockTime(value.preferredEnd) &&
    Array.isArray(windows) &&
    windows.length > 0 &&
    windows.every(isAvailabilityWindow) &&
    isNonNegativeInteger(value.bufferBeforeMinutes) &&
    isNonNegativeInteger(value.bufferAfterMinutes) &&
    isNonNegativeInteger(value.minimumNoticeMinutes) &&
    isNonNegativeInteger(value.bookingHorizonDays) &&
    (value.overrides === undefined || (
      Array.isArray(value.overrides) &&
      value.overrides.every(isAvailabilityOverride)
    ))
  );
};

const isFunnelAnalytics = (value: unknown): value is FunnelAnalytics => {
  if (!isRecord(value)) return false;
  return ["views", "slotViews", "starts", "requests", "confirmed"]
    .every(key => isNonNegativeInteger(value[key]));
};

const isPublicationGeneration = (value: unknown): value is number =>
  isNonNegativeInteger(value) && value <= Number.MAX_SAFE_INTEGER;

const isConfirmedPublicationGeneration = (value: unknown): value is number =>
  isPublicationGeneration(value) && value > 0;

const isPublicationTimestamp = (value: unknown): value is string => {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
  ) return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
};

export const isEventTypePublicationReceipt = (
  value: unknown,
): value is EventTypePublicationReceipt => {
  if (!isRecord(value)) return false;
  return (
    hasId(typeof value.revisionId === "string" ? value.revisionId : "") &&
    typeof value.reservedSlug === "string" &&
    validateSlug(value.reservedSlug) === null &&
    (value.generation === undefined || isConfirmedPublicationGeneration(value.generation))
  );
};

export const isBookingProfilePublicationReceipt = (
  value: unknown,
): value is BookingProfilePublicationReceipt => {
  if (!isRecord(value)) return false;
  return (
    isConfirmedPublicationGeneration(value.generation) &&
    isOneOf(value.status, ["published", "unpublished"] as const) &&
    typeof value.reservedSlug === "string" &&
    validateSlug(value.reservedSlug) === null &&
    isPublicationTimestamp(value.updatedAt)
  );
};

export const isPendingBookingProfilePublication = (
  value: unknown,
): value is PendingBookingProfilePublication => {
  if (!isRecord(value)) return false;
  return (
    isOneOf(value.desiredStatus, ["published", "unpublished"] as const) &&
    isPublicationGeneration(value.expectedGeneration) &&
    isPublicationTimestamp(value.requestedAt)
  );
};

export const isBookingProfileServerPublicationReceipt = (
  value: unknown,
): value is BookingProfileServerPublicationReceipt => {
  if (!isRecord(value) || !Array.isArray(value.eventTypes)) return false;
  const eventTypesValid = value.eventTypes.every(candidate =>
    isRecord(candidate) &&
    hasId(typeof candidate.sourceEventTypeId === "string"
      ? candidate.sourceEventTypeId
      : "") &&
    isEventTypePublicationReceipt(candidate)
  );
  return (
    hasId(typeof value.sourceProfileId === "string" ? value.sourceProfileId : "") &&
    isConfirmedPublicationGeneration(value.generation) &&
    isOneOf(value.status, ["published", "unpublished"] as const) &&
    typeof value.reservedSlug === "string" &&
    validateSlug(value.reservedSlug) === null &&
    isPublicationTimestamp(value.updatedAt) &&
    eventTypesValid &&
    new Set(value.eventTypes.map(candidate =>
      isRecord(candidate) ? candidate.sourceEventTypeId : undefined
    )).size === value.eventTypes.length
  );
};

const isEventType = (value: unknown): value is EventType => {
  if (!isRecord(value)) return false;
  return (
    hasId(typeof value.id === "string" ? value.id : "") &&
    typeof value.slug === "string" &&
    validateSlug(value.slug) === null &&
    hasName(typeof value.title === "string" ? value.title : "") &&
    typeof value.description === "string" &&
    eventDurationIsReasonable(
      typeof value.durationMinutes === "number" ? value.durationMinutes : Number.NaN,
    ) &&
    typeof value.approvalRequired === "boolean" &&
    isOneOf(value.location, [
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
    ] as const) &&
    typeof value.destinationCalendarId === "string" &&
    (value.availabilityScheduleId === undefined || hasId(
      typeof value.availabilityScheduleId === "string"
        ? value.availabilityScheduleId
        : "",
    )) &&
    typeof value.active === "boolean" &&
    typeof value.color === "string" &&
    isFunnelAnalytics(value.analytics) &&
    (value.publication === undefined || (
      isEventTypePublicationReceipt(value.publication) &&
      value.publication.reservedSlug === value.slug
    ))
  );
};

const isBookingProfile = (value: unknown): value is BookingProfile => {
  if (!isRecord(value)) return false;
  const publicationValid = value.publication === undefined || (
    isBookingProfilePublicationReceipt(value.publication) &&
    value.publication.reservedSlug === value.slug
  );
  const pendingValid = value.pendingPublication === undefined || (
    isPendingBookingProfilePublication(value.pendingPublication) &&
    value.pendingPublication.desiredStatus === (
      value.published === true ? "published" : "unpublished"
    ) &&
    value.pendingPublication.expectedGeneration === (
      isBookingProfilePublicationReceipt(value.publication)
        ? value.publication.generation
        : 0
    )
  );
  const eventReceiptsValid = Array.isArray(value.eventTypes) && value.eventTypes.every(eventType => {
    if (!isRecord(eventType) || eventType.publication === undefined) return true;
    if (!isBookingProfilePublicationReceipt(value.publication)) return false;
    if (!isEventTypePublicationReceipt(eventType.publication)) return false;
    return eventType.publication.generation === undefined ||
      eventType.publication.generation <= value.publication.generation;
  });
  return (
    hasId(typeof value.id === "string" ? value.id : "") &&
    isOneOf(value.ownerType, ["individual", "team", "organization"] as const) &&
    typeof value.slug === "string" &&
    validateSlug(value.slug) === null &&
    hasName(typeof value.displayName === "string" ? value.displayName : "") &&
    hasName(typeof value.timezone === "string" ? value.timezone : "") &&
    typeof value.published === "boolean" &&
    Array.isArray(value.eventTypes) &&
    value.eventTypes.every(isEventType) &&
    publicationValid &&
    pendingValid &&
    eventReceiptsValid
  );
};

const isBookingRequest = (value: unknown): value is BookingRequest => {
  if (!isRecord(value)) return false;
  return (
    hasId(typeof value.id === "string" ? value.id : "") &&
    hasId(typeof value.eventTypeId === "string" ? value.eventTypeId : "") &&
    hasId(typeof value.eventId === "string" ? value.eventId : "") &&
    hasName(typeof value.guestName === "string" ? value.guestName : "") &&
    typeof value.guestEmail === "string" &&
    isOneOf(value.status, ["pending", "confirmed", "declined", "cancelled"] as const) &&
    isIsoDateTime(value.requestedAt) &&
    isIsoDateTime(value.expiresAt)
  );
};

const isNotificationPreferences = (value: unknown): value is NotificationPreferences => {
  if (!isRecord(value)) return false;
  return (
    Array.isArray(value.reminderMinutes) &&
    value.reminderMinutes.length > 0 &&
    value.reminderMinutes.every(isNonNegativeInteger) &&
    ["system", "tap", "email", "sms", "whatsapp", "telegram"]
      .every(key => typeof value[key] === "boolean") &&
    isClockTime(value.quietHoursStart) &&
    isClockTime(value.quietHoursEnd)
  );
};

const isCalendarChannelEntry = (value: unknown): value is CalendarChannelEntry => {
  if (!isRecord(value)) return false;
  return (
    hasId(typeof value.id === "string" ? value.id : "") &&
    isIsoDateTime(value.createdAt) &&
    isOneOf(value.kind, ["booking", "approval", "cancellation", "health"] as const) &&
    hasName(typeof value.title === "string" ? value.title : "") &&
    typeof value.summary === "string" &&
    (value.bookingRequestId === undefined || hasId(
      typeof value.bookingRequestId === "string" ? value.bookingRequestId : "",
    )) &&
    typeof value.redacted === "boolean"
  );
};

const isNotificationChannel = (value: unknown): value is CalendarNotificationChannel => {
  if (!isRecord(value)) return false;
  return (
    hasId(typeof value.id === "string" ? value.id : "") &&
    hasName(typeof value.name === "string" ? value.name : "") &&
    isOneOf(value.scope, ["private", "team", "calendar", "event-type"] as const) &&
    typeof value.enabled === "boolean" &&
    Array.isArray(value.entries) &&
    value.entries.every(isCalendarChannelEntry)
  );
};

const isWorkflowNode = (value: unknown): value is CalendarWorkflowNode => {
  if (!isRecord(value)) return false;
  return (
    hasId(typeof value.id === "string" ? value.id : "") &&
    isOneOf(value.kind, ["trigger", "action"] as const) &&
    hasName(typeof value.name === "string" ? value.name : "") &&
    typeof value.description === "string"
  );
};

const hasUniqueIds = (values: readonly { readonly id: string }[]): boolean =>
  new Set(values.map(value => value.id)).size === values.length;

export function isCalendarState(value: unknown): value is CalendarState {
  if (!isRecord(value)) return false;
  if (
    value.schemaVersion !== 1 ||
    !isOneOf(value.activeView, ["day", "work-week", "week", "month", "agenda", "team"] as const) ||
    typeof value.activeAvailabilityId !== "string" ||
    !Array.isArray(value.accounts) ||
    !value.accounts.every(isCalendarAccount) ||
    !Array.isArray(value.events) ||
    !value.events.every(isCalendarEvent) ||
    !Array.isArray(value.availability) ||
    !value.availability.every(isAvailabilitySchedule) ||
    !Array.isArray(value.bookingProfiles) ||
    !value.bookingProfiles.every(isBookingProfile) ||
    !Array.isArray(value.bookingRequests) ||
    !value.bookingRequests.every(isBookingRequest) ||
    !isNotificationPreferences(value.notificationPreferences) ||
    !Array.isArray(value.notificationChannels) ||
    !value.notificationChannels.every(isNotificationChannel) ||
    !Array.isArray(value.workflowNodes) ||
    !value.workflowNodes.every(isWorkflowNode)
  ) return false;

  const accounts = value.accounts;
  const calendars = accounts.flatMap(account => account.calendars);
  const events = value.events;
  const availability = value.availability;
  const profiles = value.bookingProfiles;
  const eventTypes = profiles.flatMap(profile => profile.eventTypes);
  const bookingRequests = value.bookingRequests;
  const channels = value.notificationChannels;
  const workflowNodes = value.workflowNodes;

  if (
    !hasUniqueIds(accounts) ||
    !hasUniqueIds(calendars) ||
    !hasUniqueIds(events) ||
    !hasUniqueIds(availability) ||
    !hasUniqueIds(profiles) ||
    !hasUniqueIds(eventTypes) ||
    !hasUniqueIds(bookingRequests) ||
    !hasUniqueIds(channels) ||
    !hasUniqueIds(workflowNodes)
  ) return false;

  const accountIds = new Set(accounts.map(account => account.id));
  const calendarIds = new Set(calendars.map(calendar => calendar.id));
  const writableCalendarIds = new Set(
    calendars.filter(calendar => calendar.writable).map(calendar => calendar.id),
  );
  const eventIds = new Set(events.map(event => event.id));
  const eventTypeIds = new Set(eventTypes.map(eventType => eventType.id));
  const availabilityIds = new Set(availability.map(schedule => schedule.id));
  const bookingRequestIds = new Set(bookingRequests.map(request => request.id));
  const destinations = calendars.filter(calendar => calendar.destination);

  if (
    calendars.some(calendar =>
      !accountIds.has(calendar.accountId) ||
      !accounts.some(account =>
        account.id === calendar.accountId &&
        account.calendars.some(candidate => candidate.id === calendar.id)
      )
    ) ||
    destinations.length > 1 ||
    destinations.some(calendar => !calendar.writable) ||
    events.some(event => !calendarIds.has(event.calendarId)) ||
    profiles.some((profile, profileIndex) =>
      profiles.some((candidate, candidateIndex) =>
        candidateIndex !== profileIndex && candidate.slug === profile.slug
      ) ||
      new Set(profile.eventTypes.map(eventType => eventType.slug)).size !==
        profile.eventTypes.length
    ) ||
    eventTypes.some(eventType =>
      eventType.active
        ? !writableCalendarIds.has(eventType.destinationCalendarId)
        : eventType.destinationCalendarId !== "" &&
          !writableCalendarIds.has(eventType.destinationCalendarId)
    ) ||
    eventTypes.some(eventType =>
      eventType.availabilityScheduleId !== undefined &&
      !availabilityIds.has(eventType.availabilityScheduleId)
    ) ||
    bookingRequests.some(request =>
      !eventIds.has(request.eventId) ||
      (request.eventTypeId !== "one-off" && !eventTypeIds.has(request.eventTypeId))
    ) ||
    channels.filter(channel => channel.scope === "private").length > 1 ||
    channels.some(channel =>
      channel.entries.some(entry =>
        entry.bookingRequestId !== undefined &&
        !bookingRequestIds.has(entry.bookingRequestId)
      )
    )
  ) return false;

  if (availability.length === 0) {
    return value.activeAvailabilityId === "";
  }
  return availability.some(schedule => schedule.id === value.activeAvailabilityId);
}
