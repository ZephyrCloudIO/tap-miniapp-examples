import {
  allCalendars,
  resolveEventTypeAvailabilityScheduleId,
  type BookingProfile,
  type CalendarState,
  type EventType,
} from "./domain";

export const PUBLIC_BOOKING_PUBLICATION_SCHEMA_VERSION =
  "tap.calendar.publication.v1" as const;
export const PUBLIC_BOOKING_PROFILE_PUBLICATION_SCHEMA_VERSION =
  "tap.calendar.profile-publication.v1" as const;

export interface PublicBookingPublicationInput {
  readonly schemaVersion: typeof PUBLIC_BOOKING_PUBLICATION_SCHEMA_VERSION;
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
    readonly windows: readonly {
      readonly day: number;
      readonly enabled: boolean;
      readonly start: string;
      readonly end: string;
    }[];
    readonly overrides: readonly {
      readonly date: string;
      readonly label: string;
      readonly available: boolean;
      readonly timeZone: string;
      readonly start?: string;
      readonly end?: string;
    }[];
  };
}

export interface PublicBookingProfilePublicationInput {
  readonly schemaVersion: typeof PUBLIC_BOOKING_PROFILE_PUBLICATION_SCHEMA_VERSION;
  readonly sourceProfileId: string;
  readonly profileSlug: string;
  readonly displayName: string;
  readonly ownerType: "individual";
  readonly expectedGeneration: number;
  readonly publications: readonly PublicBookingPublicationInput[];
}

export type BuildPublicBookingPublicationResult =
  | { readonly ok: true; readonly publication: PublicBookingPublicationInput }
  | { readonly ok: false; readonly message: string };

export type BuildPublicBookingProfilePublicationResult =
  | {
    readonly ok: true;
    readonly publication: PublicBookingProfilePublicationInput;
  }
  | { readonly ok: false; readonly message: string };

/**
 * Build the bounded publication snapshot sent from the permissioned TAP
 * miniapp. Provider ownership and slug uniqueness are revalidated by the
 * gateway; this projection intentionally contains no event or attendee data.
 */
export function buildPublicBookingPublication(
  state: CalendarState,
  profile: BookingProfile,
  eventType: EventType,
): BuildPublicBookingPublicationResult {
  if (profile.ownerType !== "individual") {
    return {
      ok: false,
      message: "Public booking v1 supports individual Booking Profiles only.",
    };
  }
  if (!profile.published || !eventType.active) {
    return {
      ok: false,
      message: "Only published profiles with active Event Types can be published.",
    };
  }
  const scheduleId = resolveEventTypeAvailabilityScheduleId(state, eventType);
  const schedule = state.availability.find(candidate => candidate.id === scheduleId);
  if (!schedule) {
    return {
      ok: false,
      message: "Choose a valid Availability Schedule for this Event Type.",
    };
  }
  const destination = allCalendars(state).find(
    calendar => calendar.id === eventType.destinationCalendarId,
  );
  if (!destination?.writable) {
    return {
      ok: false,
      message: "Choose a writable Destination Calendar for this Event Type.",
    };
  }
  const conflictCalendarIds = [
    ...new Set(
      allCalendars(state)
        .filter(calendar => calendar.conflicts || calendar.id === destination.id)
        .map(calendar => calendar.id),
    ),
  ].sort();
  return {
    ok: true,
    publication: {
      schemaVersion: PUBLIC_BOOKING_PUBLICATION_SCHEMA_VERSION,
      sourceProfileId: profile.id,
      profileSlug: profile.slug,
      displayName: profile.displayName,
      ownerType: "individual",
      sourceEventTypeId: eventType.id,
      eventTypeSlug: eventType.slug,
      title: eventType.title,
      description: eventType.description,
      durationMinutes: eventType.durationMinutes,
      approvalRequired: eventType.approvalRequired,
      location: eventType.location,
      destinationCalendarId: destination.id,
      conflictCalendarIds,
      sourceAvailabilityScheduleId: schedule.id,
      schedule: {
        timeZone: schedule.timezone,
        preferredStart: schedule.preferredStart,
        preferredEnd: schedule.preferredEnd,
        bufferBeforeMinutes: schedule.bufferBeforeMinutes,
        bufferAfterMinutes: schedule.bufferAfterMinutes,
        minimumNoticeMinutes: schedule.minimumNoticeMinutes,
        bookingHorizonDays: schedule.bookingHorizonDays,
        windows: schedule.windows
          .map(window => ({
            day: window.day,
            enabled: window.enabled,
            start: window.start,
            end: window.end,
          }))
          .sort((left, right) => left.day - right.day || left.start.localeCompare(right.start)),
        overrides: (schedule.overrides ?? [])
          .map(override => ({
            date: override.date,
            label: override.label,
            available: override.available,
            timeZone: override.timezone ?? schedule.timezone,
            ...(override.available
              ? { start: override.start!, end: override.end! }
              : {}),
          }))
          .sort((left, right) => left.date.localeCompare(right.date)),
      },
    },
  };
}

/**
 * Build one authoritative profile snapshot. Omitting an inactive Event Type
 * tells the gateway to unpublish that page in the same atomic generation.
 */
export function buildPublicBookingProfilePublication(
  state: CalendarState,
  profile: BookingProfile,
  expectedGeneration: number,
): BuildPublicBookingProfilePublicationResult {
  if (!Number.isInteger(expectedGeneration) || expectedGeneration < 0) {
    return { ok: false, message: "The public Booking Profile generation is invalid." };
  }
  if (!profile.published) {
    return { ok: false, message: "Only a profile marked for publication can be published." };
  }
  if (profile.ownerType !== "individual") {
    return {
      ok: false,
      message: "Public booking v1 supports individual Booking Profiles only.",
    };
  }
  const activeEventTypes = profile.eventTypes
    .filter(eventType => eventType.active)
    .sort((left, right) =>
      left.slug.localeCompare(right.slug) || left.id.localeCompare(right.id));
  const publications: PublicBookingPublicationInput[] = [];
  for (const eventType of activeEventTypes) {
    const result = buildPublicBookingPublication(state, profile, eventType);
    if (!result.ok) return result;
    publications.push(result.publication);
  }
  return {
    ok: true,
    publication: {
      schemaVersion: PUBLIC_BOOKING_PROFILE_PUBLICATION_SCHEMA_VERSION,
      sourceProfileId: profile.id,
      profileSlug: profile.slug,
      displayName: profile.displayName,
      ownerType: "individual",
      expectedGeneration,
      publications,
    },
  };
}

/** Stable desired-state fingerprint used only to decide whether an existing
 * server receipt is stale. Analytics and other non-public state are excluded. */
export function publicBookingProfilePublicationFingerprint(
  state: CalendarState,
  profile: BookingProfile,
): string {
  if (!profile.published) {
    return JSON.stringify({ sourceProfileId: profile.id, published: false });
  }
  const result = buildPublicBookingProfilePublication(state, profile, 0);
  return result.ok
    ? JSON.stringify({
      sourceProfileId: result.publication.sourceProfileId,
      profileSlug: result.publication.profileSlug,
      displayName: result.publication.displayName,
      ownerType: result.publication.ownerType,
      publications: result.publication.publications,
    })
    : JSON.stringify({
      sourceProfileId: profile.id,
      published: true,
      invalid: result.message,
    });
}
