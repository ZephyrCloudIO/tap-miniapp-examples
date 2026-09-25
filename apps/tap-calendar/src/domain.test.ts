import { describe, expect, it } from "@rstest/core";
import {
  addCalendarsToAccount,
  addAvailabilitySchedule,
  addBookingProfile,
  addConnectedAccount,
  addEventType,
  allCalendars,
  applyPublicBookingProfilePublicationReceipt,
  applyAvailabilityBookingPolicy,
  availabilityForDate,
  conversionRate,
  createAdditionalAvailabilityWindow,
  createEmptyCalendarState,
  createWorkBlock,
  decideBookingRequest,
  disconnectCalendarAccount,
  deriveBookingProfilePublicationState,
  enforceImmutablePublicationSlugs,
  expireBookingRequest,
  findAvailableSlots,
  findAvailableSlotsAcrossWindows,
  isCalendarState,
  isEventTypePublicationLive,
  markPublicBookingProfilePublicationPending,
  migrateLegacyEventTypeAvailabilitySchedules,
  preferredDestinationCalendar,
  publicBookingUrl,
  renameCalendarAccount,
  removeCalendarFromTap,
  reminderAt,
  resolveEventTypeAvailabilityScheduleId,
  scheduleMeeting,
  schedulePublicBooking,
  trackFunnel,
  updateCalendarAccountCalendars,
  updateCalendar,
  validateGuestCompatibility,
  validateAvailabilityWindows,
  validateSlug,
  visibleEvents,
  zonedWallClockInstant,
  type AddConnectedAccountInput,
  type AvailabilitySchedule,
  type BookingProfile,
  type BookingProfileServerPublicationReceipt,
  type CalendarAttendee,
  type CalendarState,
  type EventType,
  type NewEventType,
} from "./domain";
import { createInitialCalendarState } from "./test-fixtures";
import channelSchedulerSeed from "../tests/fixtures/tap-calendar.channel-scheduler.json";
import tapCalendarSeed from "../tests/fixtures/tap-calendar.seed.json";

const externalGuest: CalendarAttendee = {
  id: "external",
  name: "External Guest",
  email: "guest@example.com",
  kind: "external",
  required: true,
};

const scheduleFixture = (
  update: Partial<AvailabilitySchedule> = {},
): AvailabilitySchedule => ({
  id: "availability-deep-work",
  name: "Deep work",
  timezone: "America/New_York",
  preferredStart: "09:00",
  preferredEnd: "12:00",
  windows: [
    { day: 1, enabled: true, start: "09:00", end: "12:00" },
  ],
  bufferBeforeMinutes: 5,
  bufferAfterMinutes: 5,
  minimumNoticeMinutes: 60,
  bookingHorizonDays: 30,
  ...update,
});

const eventTypeFixture = (
  update: Partial<NewEventType> = {},
): NewEventType => ({
  id: "event-type-intro",
  slug: "intro-call",
  title: "Intro call",
  description: "A short introduction.",
  durationMinutes: 30,
  approvalRequired: false,
  location: "google-meet",
  destinationCalendarId: "cal-work",
  availabilityScheduleId: "availability-standard",
  active: true,
  color: "#6366f1",
  analytics: {
    views: 0,
    slotViews: 0,
    starts: 0,
    requests: 0,
    confirmed: 0,
  },
  ...update,
});

const bookingProfileFixture = (
  update: Partial<BookingProfile> = {},
): BookingProfile => ({
  id: "profile-consulting",
  ownerType: "organization",
  slug: "zephyr-consulting",
  displayName: "Zephyr Consulting",
  timezone: "America/New_York",
  published: false,
  eventTypes: [],
  ...update,
});

const publicationStateFixture = (): CalendarState => {
  const state = structuredClone(
    tapCalendarSeed.storage[0]!.value,
  ) as unknown as CalendarState;
  const profile = state.bookingProfiles[0]!;
  const firstEventType = profile.eventTypes[0]!;
  return {
    ...state,
    bookingProfiles: [{
      ...profile,
      eventTypes: [
        firstEventType,
        {
          ...firstEventType,
          id: "fixture-event-type-advisory",
          slug: "architecture-advisory",
          title: "Architecture advisory",
          durationMinutes: 60,
        },
      ],
    }],
  };
};

const withoutAvailabilitySchedule = (eventType: EventType): EventType => {
  const { availabilityScheduleId: _availabilityScheduleId, ...legacy } = eventType;
  return legacy;
};

const asLegacyEventTypeState = (state: CalendarState): CalendarState => ({
  ...state,
  bookingProfiles: state.bookingProfiles.map(profile => ({
    ...profile,
    eventTypes: profile.eventTypes.map(withoutAvailabilitySchedule),
  })),
});

const legacyAvailabilityState = (withSchedule = true): CalendarState => {
  const schedule = scheduleFixture({ id: "availability-standard" });
  return {
    ...createEmptyCalendarState(),
    availability: withSchedule ? [schedule] : [],
    activeAvailabilityId: withSchedule ? schedule.id : "",
    bookingProfiles: [bookingProfileFixture({
      eventTypes: [withoutAvailabilitySchedule(eventTypeFixture({
        destinationCalendarId: "",
        active: false,
      }))],
    })],
  };
};

describe("TAP Calendar domain", () => {
  it("starts runtime storage without seeded customer data", () => {
    const empty = createEmptyCalendarState();
    expect(empty).toMatchObject({
      accounts: [],
      events: [],
      availability: [],
      activeAvailabilityId: "",
      bookingProfiles: [],
      bookingRequests: [],
      notificationChannels: [],
      notificationPreferences: { reminderMinutes: [10] },
    });
    expect(isCalendarState(empty)).toBe(true);
  });

  it("rejects malformed persisted members and broken relationships", () => {
    const empty = createEmptyCalendarState();
    expect(isCalendarState({ ...empty, bookingRequests: [null] })).toBe(false);
    expect(isCalendarState({
      ...empty,
      events: [{
        id: "orphan-event",
        calendarId: "missing-calendar",
        title: "Orphan",
        start: "2026-08-17T09:00:00Z",
        end: "2026-08-17T10:00:00Z",
        kind: "meeting",
        status: "confirmed",
        location: null,
        attendees: [],
      }],
    })).toBe(false);
    expect(isCalendarState({ ...empty, notificationPreferences: {} })).toBe(false);
  });

  it("accepts the explicit seeded Test Lab projection", () => {
    expect(isCalendarState(tapCalendarSeed.storage[0]?.value)).toBe(true);
    expect(isCalendarState(channelSchedulerSeed.storage[0]?.value)).toBe(true);
  });

  it("keeps receipt-less schema-v1 profiles valid without assuming they are live", () => {
    const legacy = publicationStateFixture();
    const profile = legacy.bookingProfiles[0]!;

    expect(isCalendarState(legacy)).toBe(true);
    expect(profile.publication).toBeUndefined();
    expect(profile.pendingPublication).toBeUndefined();
    expect(deriveBookingProfilePublicationState(profile)).toEqual({
      liveStatus: "never-published",
      desiredStatus: "published",
      pending: true,
      expectedGeneration: 0,
    });
  });

  it("strictly rejects malformed publication metadata and broken receipt relationships", () => {
    const initial = publicationStateFixture();
    const profile = initial.bookingProfiles[0]!;
    const eventType = profile.eventTypes[0]!;
    const replaceProfile = (replacement: BookingProfile): CalendarState => ({
      ...initial,
      bookingProfiles: initial.bookingProfiles.map(candidate =>
        candidate.id === replacement.id ? replacement : candidate
      ),
    });
    const confirmed: BookingProfile = {
      ...profile,
      publication: {
        generation: 1,
        status: "published",
        reservedSlug: profile.slug,
        updatedAt: "2026-08-16T14:00:00.000Z",
      },
      eventTypes: profile.eventTypes.map(candidate =>
        candidate.id === eventType.id
          ? {
              ...candidate,
              publication: {
                revisionId: "public-revision-1",
                reservedSlug: candidate.slug,
              },
            }
          : candidate
      ),
    };

    expect(isCalendarState(replaceProfile(confirmed))).toBe(true);
    expect(isCalendarState(replaceProfile({
      ...confirmed,
      publication: { ...confirmed.publication!, generation: 0 },
    }))).toBe(false);
    expect(isCalendarState(replaceProfile({
      ...confirmed,
      publication: {
        ...confirmed.publication!,
        updatedAt: "2026-08-16T10:00:00-04:00",
      },
    }))).toBe(false);
    expect(isCalendarState(replaceProfile({
      ...confirmed,
      pendingPublication: {
        desiredStatus: "published",
        expectedGeneration: 0,
        requestedAt: "2026-08-16T14:01:00.000Z",
      },
    }))).toBe(false);
    expect(isCalendarState(replaceProfile({
      ...profile,
      eventTypes: profile.eventTypes.map(candidate =>
        candidate.id === eventType.id
          ? {
              ...candidate,
              publication: {
                revisionId: "public-revision-orphan",
                reservedSlug: candidate.slug,
              },
            }
          : candidate
      ),
    }))).toBe(false);
    expect(isCalendarState(replaceProfile({
      ...confirmed,
      slug: "renamed-after-publication",
    }))).toBe(false);
  });

  it("maps whole-profile server receipts by source Event Type ID", () => {
    const initial = publicationStateFixture();
    const marked = markPublicBookingProfilePublicationPending(
      initial,
      "fixture-profile-alex",
      "2026-08-16T14:00:00.000Z",
    );
    const pending = marked.bookingProfiles[0]!.pendingPublication;
    const receipt: BookingProfileServerPublicationReceipt = {
      sourceProfileId: "fixture-profile-alex",
      generation: 1,
      status: "published",
      reservedSlug: "alex-morgan",
      updatedAt: "2026-08-16T14:00:01.000Z",
      eventTypes: [{
        sourceEventTypeId: "fixture-event-type-advisory",
        revisionId: "public-revision-advisory",
        reservedSlug: "architecture-advisory",
      }, {
        sourceEventTypeId: "fixture-event-type-30min",
        revisionId: "public-revision-30min",
        reservedSlug: "30min",
      }],
    };
    const applied = applyPublicBookingProfilePublicationReceipt(
      marked,
      receipt,
      pending,
    );
    const profile = applied.bookingProfiles[0]!;

    expect(profile.publication).toEqual({
      generation: 1,
      status: "published",
      reservedSlug: "alex-morgan",
      updatedAt: "2026-08-16T14:00:01.000Z",
    });
    expect(profile.pendingPublication).toBeUndefined();
    expect(profile.eventTypes.map(eventType => [
      eventType.id,
      eventType.publication?.revisionId,
      eventType.publication?.generation,
    ])).toEqual([
      ["fixture-event-type-30min", "public-revision-30min", 1],
      ["fixture-event-type-advisory", "public-revision-advisory", 1],
    ]);
    expect(isCalendarState(applied)).toBe(true);
  });

  it("marks only pages included in the confirmed profile generation as live", () => {
    const initial = publicationStateFixture();
    const first = applyPublicBookingProfilePublicationReceipt(initial, {
      sourceProfileId: "fixture-profile-alex",
      generation: 1,
      status: "published",
      reservedSlug: "alex-morgan",
      updatedAt: "2026-08-16T14:00:01.000Z",
      eventTypes: initial.bookingProfiles[0]!.eventTypes.map(eventType => ({
        sourceEventTypeId: eventType.id,
        revisionId: `revision-${eventType.id}`,
        reservedSlug: eventType.slug,
      })),
    });
    const second = applyPublicBookingProfilePublicationReceipt(first, {
      sourceProfileId: "fixture-profile-alex",
      generation: 2,
      status: "published",
      reservedSlug: "alex-morgan",
      updatedAt: "2026-08-16T14:05:00.000Z",
      eventTypes: [{
        sourceEventTypeId: "fixture-event-type-30min",
        revisionId: "revision-30min-v2",
        reservedSlug: "30min",
      }],
    });
    const profile = second.bookingProfiles[0]!;
    const meeting = profile.eventTypes.find(eventType =>
      eventType.id === "fixture-event-type-30min")!;
    const omitted = profile.eventTypes.find(eventType =>
      eventType.id === "fixture-event-type-advisory")!;

    expect(meeting.publication?.generation).toBe(2);
    expect(omitted.publication?.generation).toBe(1);
    expect(isEventTypePublicationLive(profile, meeting)).toBe(true);
    expect(isEventTypePublicationLive(profile, omitted)).toBe(false);
    expect(isEventTypePublicationLive(profile, { ...omitted, active: true })).toBe(false);
    expect(isCalendarState(second)).toBe(true);
  });

  it("keeps a newer pending intent when an earlier request receipt arrives", () => {
    const initial = publicationStateFixture();
    const firstMarked = markPublicBookingProfilePublicationPending(
      initial,
      "fixture-profile-alex",
      "2026-08-16T14:00:00.000Z",
    );
    const acknowledged = firstMarked.bookingProfiles[0]!.pendingPublication;
    const changed = {
      ...firstMarked,
      bookingProfiles: firstMarked.bookingProfiles.map(profile =>
        profile.id === "fixture-profile-alex"
          ? {
              ...profile,
              displayName: "Updated while publishing",
              pendingPublication: {
                ...profile.pendingPublication!,
                requestedAt: "2026-08-16T14:00:02.000Z",
              },
            }
          : profile
      ),
    } satisfies CalendarState;
    const applied = applyPublicBookingProfilePublicationReceipt(changed, {
      sourceProfileId: "fixture-profile-alex",
      generation: 1,
      status: "published",
      reservedSlug: "alex-morgan",
      updatedAt: "2026-08-16T14:00:01.000Z",
      eventTypes: [],
    }, acknowledged);
    const profile = applied.bookingProfiles[0]!;

    expect(profile.displayName).toBe("Updated while publishing");
    expect(profile.pendingPublication).toEqual({
      desiredStatus: "published",
      expectedGeneration: 1,
      requestedAt: "2026-08-16T14:00:02.000Z",
    });
    expect(deriveBookingProfilePublicationState(profile)).toMatchObject({
      liveStatus: "published",
      desiredStatus: "published",
      pending: true,
      expectedGeneration: 1,
    });
  });

  it("locks received slugs while preserving unrelated profile and Event Type edits", () => {
    const initial = publicationStateFixture();
    const profile = applyPublicBookingProfilePublicationReceipt(initial, {
      sourceProfileId: "fixture-profile-alex",
      generation: 1,
      status: "published",
      reservedSlug: "alex-morgan",
      updatedAt: "2026-08-16T14:00:01.000Z",
      eventTypes: [{
        sourceEventTypeId: "fixture-event-type-30min",
        revisionId: "public-revision-30min",
        reservedSlug: "30min",
      }],
    }).bookingProfiles[0]!;
    const candidate: BookingProfile = {
      ...profile,
      slug: "attempted-profile-rename",
      displayName: "A better display name",
      eventTypes: profile.eventTypes.map(eventType =>
        eventType.id === "fixture-event-type-30min"
          ? {
              ...eventType,
              slug: "attempted-event-rename",
              title: "A better event title",
            }
          : eventType
      ),
    };
    const guarded = enforceImmutablePublicationSlugs(profile, candidate);

    expect(guarded.slug).toBe("alex-morgan");
    expect(guarded.displayName).toBe("A better display name");
    expect(guarded.eventTypes[0]).toMatchObject({
      slug: "30min",
      title: "A better event title",
      publication: { revisionId: "public-revision-30min" },
    });
    expect(guarded.eventTypes[1]?.slug).toBe("architecture-advisory");
  });

  it("keeps legacy schema-v1 availability readable until the user repairs it", () => {
    const empty = createEmptyCalendarState();
    const legacySchedule = scheduleFixture({
      windows: [{ day: 1, enabled: true, start: "09:00", end: "09:00" }],
    });
    const legacy: CalendarState = {
      ...empty,
      availability: [legacySchedule],
      activeAvailabilityId: legacySchedule.id,
    };
    expect(isCalendarState(legacy)).toBe(true);
    const rejected = addAvailabilitySchedule(
      createEmptyCalendarState(),
      scheduleFixture({ windows: [{ day: 1, enabled: true, start: "09:00", end: "09:00" }] }),
    );
    expect(rejected.ok).toBe(false);
    expect(rejected.error?.code).toBe("invalid-availability");
  });

  it("allows a read-only account first and automatically selects the first writable destination", () => {
    const empty = createEmptyCalendarState();
    const readOnly = addConnectedAccount(empty, {
      id: "acct-shared",
      provider: "google",
      label: "Shared calendars",
      status: "read-only",
      calendars: [{
        id: "cal-shared",
        name: "Advisory board",
        color: "#facc15",
        role: "reader",
        visible: true,
        conflicts: true,
        writable: false,
        destination: false,
        freshness: "live",
      }],
    });
    expect(readOnly.ok).toBe(true);
    expect(allCalendars(readOnly.state).filter(calendar => calendar.destination)).toHaveLength(0);

    const writable = addConnectedAccount(readOnly.state, {
      id: "acct-owned",
      provider: "microsoft",
      label: "Work",
      status: "connected",
      calendars: [{
        id: "cal-owned",
        name: "Work",
        color: "#22c55e",
        role: "owner",
        visible: true,
        conflicts: true,
        writable: true,
        destination: false,
        freshness: "live",
      }],
    });
    expect(writable.ok).toBe(true);
    expect(allCalendars(writable.state).find(calendar => calendar.id === "cal-owned")).toMatchObject({
      destination: true,
    });
  });

  it("prefers the provider primary calendar for an automatic destination", () => {
    const connected = addConnectedAccount(createEmptyCalendarState(), {
      id: "acct-google",
      provider: "google",
      label: "me@example.com",
      status: "connected",
      calendars: [
        {
          id: "cal-transferred",
          name: "Transferred team calendar",
          color: "#a78bfa",
          role: "owner",
          visible: true,
          conflicts: true,
          writable: true,
          destination: false,
          primary: false,
          freshness: "live",
        },
        {
          id: "cal-primary",
          name: "me@example.com",
          color: "#4285f4",
          role: "owner",
          visible: true,
          conflicts: true,
          writable: true,
          destination: false,
          primary: true,
          freshness: "live",
        },
      ],
    });

    expect(connected.ok).toBe(true);
    expect(allCalendars(connected.state)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "cal-transferred", destination: false }),
      expect.objectContaining({ id: "cal-primary", destination: true, primary: true }),
    ]));
    expect(preferredDestinationCalendar(allCalendars(connected.state))?.id).toBe("cal-primary");
    expect(isCalendarState(connected.state)).toBe(true);
  });

  it("keeps an explicit destination ahead of the provider primary calendar", () => {
    expect(preferredDestinationCalendar([
      { id: "cal-primary", writable: true, destination: false, primary: true },
      { id: "cal-selected", writable: true, destination: true, primary: false },
    ])?.id).toBe("cal-selected");
  });

  it("adds several calendars to an existing account with independent preferences", () => {
    const initialAccount = addConnectedAccount(createEmptyCalendarState(), {
      id: "acct-google",
      provider: "google",
      label: "Google",
      status: "read-only",
      calendars: [{
        id: "cal-holidays",
        name: "Holidays",
        color: "#34d399",
        role: "reader",
        visible: false,
        conflicts: false,
        writable: false,
        destination: false,
        freshness: "live",
      }],
    });
    const added = addCalendarsToAccount(initialAccount.state, {
      accountId: "acct-google",
      calendars: [
        {
          id: "cal-personal",
          name: "Personal",
          color: "#60a5fa",
          role: "owner",
          visible: true,
          conflicts: true,
          writable: true,
          destination: false,
          freshness: "live",
        },
        {
          id: "cal-team",
          name: "Team",
          color: "#a78bfa",
          role: "writer",
          visible: false,
          conflicts: true,
          writable: true,
          destination: false,
          freshness: "live",
        },
      ],
    });
    expect(added.ok).toBe(true);
    expect(added.state.accounts[0]?.calendars).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "cal-personal", visible: true, destination: true }),
      expect.objectContaining({ id: "cal-team", visible: false, destination: false }),
    ]));
    expect(added.state.accounts[0]?.status).toBe("attention");
  });

  it("makes the first Availability Schedule active and can return to no accounts", () => {
    const schedule = addAvailabilitySchedule(createEmptyCalendarState(), scheduleFixture(), {
      makeDefault: false,
    });
    expect(schedule.state.activeAvailabilityId).toBe("availability-deep-work");

    const account = addConnectedAccount(createEmptyCalendarState(), {
      id: "acct-only",
      provider: "caldav",
      label: "Only account",
      status: "connected",
      calendars: [{
        id: "cal-only",
        name: "Only calendar",
        color: "#4f7cff",
        role: "owner",
        visible: true,
        conflicts: true,
        writable: true,
        destination: false,
        freshness: "live",
      }],
    });
    const disconnected = disconnectCalendarAccount(account.state, "acct-only");
    expect(disconnected.ok).toBe(true);
    expect(disconnected.state.accounts).toEqual([]);
  });

  it("renames a connected account without changing its provider identity", () => {
    const initial = createInitialCalendarState();
    const renamed = renameCalendarAccount(initial, "acct-icloud", "  Personal iCloud  ");
    expect(renamed.ok).toBe(true);
    expect(renamed.state.accounts.find(account => account.id === "acct-icloud")).toMatchObject({
      label: "Personal iCloud",
      provider: "icloud",
      status: "attention",
    });
    expect(renameCalendarAccount(initial, "acct-icloud", " ")).toMatchObject({
      ok: false,
      error: { code: "empty-name", field: "label" },
    });
  });

  it("updates all account calendar preferences while stale conflicts stay fail-closed", () => {
    const initial = createInitialCalendarState();
    const hidden = updateCalendarAccountCalendars(initial, "acct-microsoft", {
      visible: false,
      conflicts: true,
    });
    expect(hidden.accounts.find(account => account.id === "acct-microsoft")?.calendars).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "cal-work", visible: false, conflicts: true }),
        expect.objectContaining({ id: "cal-charlie", visible: false, conflicts: true }),
      ]),
    );
    const stale = updateCalendarAccountCalendars(initial, "acct-exchange", {
      conflicts: true,
    });
    expect(stale.accounts.find(account => account.id === "acct-exchange")?.calendars[0]).toMatchObject({
      freshness: "stale",
      conflicts: false,
    });
  });

  it("disconnects a non-destination account and clears only its cached events", () => {
    const initial = createInitialCalendarState();
    const disconnected = disconnectCalendarAccount(initial, "acct-google");
    expect(disconnected.ok).toBe(true);
    expect(disconnected.state.accounts.some(account => account.id === "acct-google")).toBe(false);
    expect(disconnected.state.events.some(event => event.calendarId === "cal-google-main")).toBe(false);
    expect(disconnected.state.events.some(event => event.calendarId === "cal-work")).toBe(true);
    expect(
      disconnected.state.accounts.flatMap(account => account.calendars).find(calendar => calendar.id === "cal-work"),
    ).toMatchObject({ destination: true });
  });

  it("requires and applies a writable replacement when disconnecting the destination account", () => {
    const initial = createInitialCalendarState();
    expect(disconnectCalendarAccount(initial, "acct-microsoft")).toMatchObject({
      ok: false,
      error: { code: "missing-destination", field: "replacementDestinationId" },
    });
    expect(
      disconnectCalendarAccount(initial, "acct-microsoft", "cal-holidays"),
    ).toMatchObject({
      ok: false,
      error: { code: "invalid-destination", field: "replacementDestinationId" },
    });

    const disconnected = disconnectCalendarAccount(
      initial,
      "acct-microsoft",
      "cal-google-main",
    );
    expect(disconnected.ok).toBe(true);
    expect(
      disconnected.state.accounts.flatMap(account => account.calendars).find(calendar => calendar.id === "cal-google-main"),
    ).toMatchObject({ destination: true });
    expect(
      disconnected.state.bookingProfiles.flatMap(profile => profile.eventTypes),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ destinationCalendarId: "cal-google-main" }),
      ]),
    );
    expect(disconnected.state.events.some(event => event.calendarId === "cal-work")).toBe(false);
  });

  it("removes one provider calendar only from TAP's local projection", () => {
    const initial = createInitialCalendarState();
    const removed = removeCalendarFromTap(initial, "cal-google-main");

    expect(removed.ok).toBe(true);
    expect(initial.accounts.find(account => account.id === "acct-google")?.calendars)
      .toHaveLength(2);
    expect(removed.state.accounts.find(account => account.id === "acct-google")?.calendars)
      .toEqual([expect.objectContaining({ id: "cal-holidays" })]);
    expect(removed.state.events.some(event => event.calendarId === "cal-google-main"))
      .toBe(false);
    expect(removed.state.accounts.some(account => account.id === "acct-microsoft"))
      .toBe(true);
  });

  it("requires a writable replacement and cleans destination references", () => {
    const initial = createInitialCalendarState();
    expect(removeCalendarFromTap(initial, "cal-work")).toMatchObject({
      ok: false,
      error: { code: "missing-destination", field: "replacementDestinationId" },
    });
    expect(removeCalendarFromTap(initial, "cal-work", "cal-holidays")).toMatchObject({
      ok: false,
      error: { code: "invalid-destination", field: "replacementDestinationId" },
    });

    const withApprovalEvent = {
      ...initial,
      events: [
        ...initial.events,
        {
          id: "event-hold-1",
          calendarId: "cal-work",
          title: "Architecture advisory hold",
          start: "2026-08-17T14:00:00-04:00",
          end: "2026-08-17T15:00:00-04:00",
          kind: "hold" as const,
          status: "pending" as const,
          location: "microsoft-teams" as const,
          attendees: [externalGuest],
        },
      ],
    };
    expect(isCalendarState(withApprovalEvent)).toBe(true);

    const removed = removeCalendarFromTap(
      withApprovalEvent,
      "cal-work",
      "cal-google-main",
    );
    expect(removed.ok).toBe(true);
    expect(
      allCalendars(removed.state).find(calendar => calendar.id === "cal-google-main"),
    ).toMatchObject({ destination: true });
    expect(removed.state.bookingProfiles.flatMap(profile => profile.eventTypes))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ destinationCalendarId: "cal-google-main" }),
      ]));
    expect(removed.state.events.some(event => event.calendarId === "cal-work")).toBe(false);
    expect(removed.state.bookingRequests).toHaveLength(0);
    expect(removed.state.notificationChannels.flatMap(channel => channel.entries).some(
      entry => entry.bookingRequestId === "booking-pending-1",
    )).toBe(false);
    expect(isCalendarState(removed.state)).toBe(true);
  });

  it("drops an empty local account and rejects an unknown calendar", () => {
    const connected = addConnectedAccount(createEmptyCalendarState(), {
      id: "acct-google-only",
      provider: "google",
      label: "Google",
      status: "connected",
      calendars: [{
        id: "cal-google-only",
        name: "Primary",
        color: "#4285f4",
        role: "owner",
        visible: true,
        conflicts: true,
        writable: true,
        destination: false,
        freshness: "live",
      }],
    });
    const removed = removeCalendarFromTap(connected.state, "cal-google-only");

    expect(removed.ok).toBe(true);
    expect(removed.state.accounts).toEqual([]);
    expect(isCalendarState(removed.state)).toBe(true);
    expect(removeCalendarFromTap(removed.state, "cal-google-only")).toMatchObject({
      ok: false,
      error: { code: "calendar-not-found", field: "calendarId" },
    });
  });

  it("keeps visibility, conflict, and destination controls independent", () => {
    const initial = createInitialCalendarState();
    const hidden = updateCalendar(initial, "cal-work", { visible: false });
    const work = hidden.accounts.flatMap(account => account.calendars).find(calendar => calendar.id === "cal-work");
    expect(work).toMatchObject({ visible: false, conflicts: true, destination: true });
    expect(visibleEvents(hidden).some(event => event.calendarId === "cal-work")).toBe(false);
  });

  it("never makes a read-only calendar the destination", () => {
    const initial = createInitialCalendarState();
    const updated = updateCalendar(initial, "cal-holidays", { destination: true });
    const holidays = updated.accounts.flatMap(account => account.calendars).find(calendar => calendar.id === "cal-holidays");
    expect(holidays?.destination).toBe(false);
    expect(updated.accounts.flatMap(account => account.calendars).find(calendar => calendar.id === "cal-work")?.destination).toBe(true);
  });

  it("warns but does not block TAP-native locations when an external guest is present", () => {
    expect(validateGuestCompatibility("tap-huddle", [externalGuest])).toContain("External guests");
    expect(validateGuestCompatibility("zoom", [externalGuest])).toBeNull();
    const result = scheduleMeeting(createInitialCalendarState(), {
      id: "meeting-external-tap",
      title: "External TAP huddle",
      calendarId: "cal-work",
      start: "2026-08-17T14:00:00-04:00",
      end: "2026-08-17T14:30:00-04:00",
      location: "tap-huddle",
      attendees: [externalGuest],
      approvalRequired: false,
      requestedAt: "2026-08-14T12:00:00-04:00",
    });
    expect(result.error).toBeNull();
    expect(result.state.events.at(-1)?.location).toBe("tap-huddle");
  });

  it("blocks the calendar without guests or a meeting location, including after replay", () => {
    const input = {
      id: "personal-event",
      title: "Focus time",
      calendarId: "cal-work",
      start: "2026-08-17T14:00:00-04:00",
      end: "2026-08-17T15:00:00-04:00",
      location: null,
      attendees: [],
      approvalRequired: false,
      requestedAt: "2026-08-14T12:00:00-04:00",
    } as const;
    const result = scheduleMeeting(createInitialCalendarState(), input);
    expect(result.error).toBeNull();
    expect(result.bookingRequestId).toBeNull();
    expect(result.state.events.at(-1)).toMatchObject({
      title: "Focus time", attendees: [], location: null, busy: true, status: "confirmed",
    });
    expect(result.state.notificationChannels[0]?.entries[0]?.summary).toBe("Just you · Focus time");
    expect(scheduleMeeting(result.state, input).state).toBe(result.state);
  });

  it("creates an approval hold and actionable channel entry", () => {
    const initial = createInitialCalendarState();
    const result = scheduleMeeting(initial, {
      id: "meeting-approval",
      title: "Architecture review",
      calendarId: "cal-work",
      start: "2026-08-17T14:00:00-04:00",
      end: "2026-08-17T15:00:00-04:00",
      location: "zoom",
      attendees: [externalGuest],
      approvalRequired: true,
      requestedAt: "2026-08-14T12:00:00-04:00",
    });
    expect(result.error).toBeNull();
    expect(result.bookingRequestId).toBe("meeting-approval-request");
    expect(result.state.events.at(-1)).toMatchObject({ kind: "hold", status: "pending" });
    expect(result.state.notificationChannels[0]?.entries[0]).toMatchObject({
      kind: "approval",
      bookingRequestId: "meeting-approval-request",
    });
  });

  it("keeps the gateway hold key when the provider normalizes the Event ID", () => {
    const result = scheduleMeeting(createInitialCalendarState(), {
      id: "google-event-normalized-id",
      bookingRequestId: "gateway-hold-idempotency-key",
      title: "Architecture review",
      calendarId: "cal-work",
      start: "2026-08-17T14:00:00-04:00",
      end: "2026-08-17T15:00:00-04:00",
      location: "zoom",
      attendees: [externalGuest],
      approvalRequired: true,
      requestedAt: "2026-08-14T12:00:00-04:00",
    });

    expect(result.bookingRequestId).toBe("gateway-hold-idempotency-key");
    expect(result.state.events.at(-1)?.id).toBe("google-event-normalized-id");
    expect(result.state.bookingRequests[0]).toMatchObject({
      id: "gateway-hold-idempotency-key",
      eventId: "google-event-normalized-id",
    });
    expect(result.state.notificationChannels[0]?.entries[0]?.bookingRequestId)
      .toBe("gateway-hold-idempotency-key");
  });

  it("reconciles an exact provider booking replay without duplicate local records", () => {
    const input = {
      id: "google-event-replay-id",
      title: "Architecture review",
      calendarId: "cal-work",
      start: "2026-08-17T14:00:00-04:00",
      end: "2026-08-17T15:00:00-04:00",
      location: "google-meet" as const,
      attendees: [externalGuest],
      approvalRequired: false,
      providerHtmlLink: "https://calendar.google.com/event/1",
      providerJoinUrl: "https://meet.google.com/abc-defg-hij",
      requestedAt: "2026-08-14T12:00:00-04:00",
    };
    const first = scheduleMeeting(createInitialCalendarState(), input);
    const replay = scheduleMeeting(first.state, input);

    expect(replay.error).toBeNull();
    expect(replay.state).toBe(first.state);
    expect(replay.state.events.filter(event => event.id === input.id)).toHaveLength(1);
    expect(replay.state.events.find(event => event.id === input.id)).toMatchObject({
      providerHtmlLink: input.providerHtmlLink,
      providerJoinUrl: input.providerJoinUrl,
    });
  });

  it("applies a public booking and funnel analytics to the latest state atomically", () => {
    const initial = createInitialCalendarState();
    const latest = {
      ...initial,
      notificationPreferences: {
        ...initial.notificationPreferences,
        system: false,
      },
    };
    const before = latest.bookingProfiles[0]?.eventTypes[0]?.analytics;

    const result = schedulePublicBooking(latest, {
      id: "public-booking-latest",
      title: "30 minute meeting",
      calendarId: "cal-work",
      start: "2026-08-24T14:00:00-04:00",
      end: "2026-08-24T14:30:00-04:00",
      location: "google-meet",
      attendees: [externalGuest],
      approvalRequired: false,
      eventTypeId: "event-type-30min",
      requestedAt: "2026-08-15T12:00:00-04:00",
    });

    expect(result.error).toBeNull();
    expect(result.state.notificationPreferences.system).toBe(false);
    expect(result.state.events.some(item => item.id === "public-booking-latest")).toBe(true);
    expect(result.state.bookingProfiles[0]?.eventTypes[0]?.analytics).toMatchObject({
      starts: (before?.starts ?? 0) + 1,
      requests: (before?.requests ?? 0) + 1,
      confirmed: (before?.confirmed ?? 0) + 1,
    });
  });

  it("does not record public booking analytics when the domain mutation fails", () => {
    const initial = createInitialCalendarState();
    const result = schedulePublicBooking(initial, {
      id: "public-booking-invalid",
      title: "30 minute meeting",
      calendarId: "cal-holidays",
      start: "2026-08-24T14:00:00-04:00",
      end: "2026-08-24T14:30:00-04:00",
      location: "google-meet",
      attendees: [externalGuest],
      approvalRequired: false,
      eventTypeId: "event-type-30min",
      requestedAt: "2026-08-15T12:00:00-04:00",
    });

    expect(result.error).toContain("writable Destination Calendar");
    expect(result.state).toBe(initial);
  });

  it("does not increment public analytics twice for an exact provider replay", () => {
    const input = {
      id: "public-booking-replay",
      title: "30 minute meeting",
      calendarId: "cal-work",
      start: "2026-08-24T14:00:00-04:00",
      end: "2026-08-24T14:30:00-04:00",
      location: "google-meet" as const,
      attendees: [externalGuest],
      approvalRequired: false,
      eventTypeId: "event-type-30min",
      requestedAt: "2026-08-15T12:00:00-04:00",
    };
    const first = schedulePublicBooking(createInitialCalendarState(), input);
    const analytics = first.state.bookingProfiles[0]?.eventTypes[0]?.analytics;
    const replay = schedulePublicBooking(first.state, input);

    expect(replay.state).toBe(first.state);
    expect(replay.state.bookingProfiles[0]?.eventTypes[0]?.analytics).toEqual(analytics);
  });

  it("approves a pending request once", () => {
    const initial = createInitialCalendarState();
    const approved = decideBookingRequest(
      initial,
      "booking-pending-1",
      "confirmed",
      "2026-08-14T10:00:00-04:00",
    );
    const replayed = decideBookingRequest(
      approved,
      "booking-pending-1",
      "declined",
      "2026-08-14T10:01:00-04:00",
    );
    expect(replayed.bookingRequests[0]?.status).toBe("confirmed");
    expect(replayed.notificationChannels[0]?.entries.filter(entry => entry.id.startsWith("booking-pending-1-"))).toHaveLength(1);
  });

  it("counts an approved public request as confirmed exactly once", () => {
    const pending = schedulePublicBooking(createInitialCalendarState(), {
      id: "public-approval",
      bookingRequestId: "public-approval-request",
      title: "30 minute meeting",
      calendarId: "cal-work",
      start: "2026-08-24T14:00:00-04:00",
      end: "2026-08-24T14:30:00-04:00",
      location: "google-meet",
      attendees: [externalGuest],
      approvalRequired: true,
      eventTypeId: "event-type-30min",
      requestedAt: "2026-08-15T12:00:00-04:00",
    });
    const before = pending.state.bookingProfiles[0]?.eventTypes[0]?.analytics.confirmed;
    const approved = decideBookingRequest(
      pending.state,
      "public-approval-request",
      "confirmed",
      "2026-08-15T12:05:00-04:00",
    );
    const replay = decideBookingRequest(
      approved,
      "public-approval-request",
      "confirmed",
      "2026-08-15T12:06:00-04:00",
    );

    expect(approved.bookingProfiles[0]?.eventTypes[0]?.analytics.confirmed).toBe(
      (before ?? 0) + 1,
    );
    expect(replay.bookingProfiles[0]?.eventTypes[0]?.analytics.confirmed).toBe(
      (before ?? 0) + 1,
    );
  });

  it("marks a declined approval hold as free", () => {
    const initial = createInitialCalendarState();
    const pending = scheduleMeeting(initial, {
      id: "declinable-hold",
      title: "Architecture review",
      calendarId: "cal-work",
      start: "2026-08-17T14:00:00-04:00",
      end: "2026-08-17T15:00:00-04:00",
      location: "google-meet",
      attendees: [externalGuest],
      approvalRequired: true,
      requestedAt: "2026-08-14T09:00:00-04:00",
    });
    const declined = decideBookingRequest(
      pending.state,
      "declinable-hold-request",
      "declined",
      "2026-08-14T10:00:00-04:00",
    );
    expect(declined.events.find(event => event.id === "declinable-hold")).toMatchObject({
      status: "declined",
      busy: false,
    });
  });

  it("expires a pending hold distinctly and makes it free", () => {
    const pending = scheduleMeeting(createInitialCalendarState(), {
      id: "expiring-hold",
      bookingRequestId: "expiring-hold-request",
      title: "Architecture review",
      calendarId: "cal-work",
      start: "2026-08-17T14:00:00-04:00",
      end: "2026-08-17T15:00:00-04:00",
      location: "google-meet",
      attendees: [externalGuest],
      approvalRequired: true,
      requestedAt: "2026-08-14T09:00:00-04:00",
    });
    const expired = expireBookingRequest(
      pending.state,
      "expiring-hold-request",
      "2026-08-14T12:00:00-04:00",
    );

    expect(expired.bookingRequests.find(request => request.id === "expiring-hold-request")?.status).toBe("cancelled");
    expect(expired.events.find(event => event.id === "expiring-hold")).toMatchObject({
      status: "cancelled",
      busy: false,
    });
    expect(expired.notificationChannels[0]?.entries[0]).toMatchObject({
      id: "expiring-hold-request-expired",
      title: "Meeting request expired",
    });
  });

  it("links work blocks without copying source content", () => {
    const initial = createInitialCalendarState();
    const blocked = createWorkBlock(initial, {
      id: "work-1",
      calendarId: "cal-work",
      title: "Write launch brief",
      start: "2026-08-17T09:00:00-04:00",
      end: "2026-08-17T10:00:00-04:00",
      sourceKind: "task",
      sourceId: "task-1",
      sourceLabel: "Task · Launch brief",
    });
    expect(blocked.events.at(-1)).toMatchObject({
      kind: "work-block",
      source: { kind: "task", id: "task-1", label: "Task · Launch brief" },
    });
    const replayed = createWorkBlock(blocked, {
      id: "work-1",
      calendarId: "cal-work",
      title: "Write launch brief",
      start: "2026-08-17T09:00:00-04:00",
      end: "2026-08-17T10:00:00-04:00",
      sourceKind: "task",
      sourceId: "task-1",
      sourceLabel: "Task · Launch brief",
    });
    expect(replayed).toBe(blocked);
    expect(replayed.events.filter(event => event.id === "work-1")).toHaveLength(1);
  });

  it("calculates buffered availability deterministically", () => {
    const slots = findAvailableSlots({
      date: "2026-08-17",
      timezoneOffset: "-04:00",
      durationMinutes: 30,
      intervalMinutes: 30,
      windowStart: "09:00",
      windowEnd: "11:00",
      busy: [
        {
          start: "2026-08-17T09:45:00-04:00",
          end: "2026-08-17T10:15:00-04:00",
        },
      ],
      bufferBeforeMinutes: 5,
      bufferAfterMinutes: 10,
    });
    expect(slots.map(slot => slot.start)).toEqual([
      "2026-08-17T13:00:00.000Z",
      "2026-08-17T14:30:00.000Z",
    ]);
  });

  it("validates split daily availability and rejects overlaps", () => {
    const splitMonday = [
      { id: "morning", day: 1, enabled: true, start: "09:00", end: "12:00" },
      { id: "afternoon", day: 1, enabled: true, start: "13:00", end: "17:00" },
    ];
    expect(validateAvailabilityWindows(splitMonday)).toBeNull();
    expect(validateAvailabilityWindows([
      ...splitMonday,
      { id: "overlap", day: 1, enabled: true, start: "11:30", end: "13:30" },
    ])).toBe("Monday time ranges cannot overlap.");
    expect(validateAvailabilityWindows([
      { day: 2, enabled: true, start: "09:00", end: "09:04" },
    ])).toBe("Tuesday time ranges must be at least 5 minutes and end after they start.");
    expect(validateAvailabilityWindows([
      { day: 3, enabled: true, start: "09:00", end: "12:00" },
      { day: 3, enabled: false, start: "13:00", end: "17:00" },
    ])).toBe("Wednesday time ranges must be enabled or disabled together.");
  });

  it("creates the next daily timeframe in a free gap", () => {
    expect(createAdditionalAvailabilityWindow([
      { day: 1, enabled: true, start: "09:00", end: "17:00" },
    ], 1, "evening")).toEqual({
      id: "evening",
      day: 1,
      enabled: true,
      start: "17:00",
      end: "18:00",
    });
    expect(createAdditionalAvailabilityWindow([
      { day: 1, enabled: true, start: "00:00", end: "23:59" },
    ], 1, "full")).toBeNull();
  });

  it("unions, sorts, and deduplicates slots across daily timeframes", () => {
    const slots = findAvailableSlotsAcrossWindows({
      date: "2026-08-17",
      timezoneOffset: "-04:00",
      durationMinutes: 30,
      intervalMinutes: 30,
      windows: [
        { enabled: true, start: "13:00", end: "14:00" },
        { enabled: false, start: "07:00", end: "08:00" },
        { enabled: true, start: "09:00", end: "10:00" },
        { enabled: true, start: "09:00", end: "10:00" },
      ],
      busy: [],
    });
    expect(slots.map(slot => slot.start)).toEqual([
      "2026-08-17T13:00:00.000Z",
      "2026-08-17T13:30:00.000Z",
      "2026-08-17T17:00:00.000Z",
      "2026-08-17T17:30:00.000Z",
    ]);
  });

  it("enforces notice and host-local horizon while ranking preferred slots", () => {
    const slots = applyAvailabilityBookingPolicy([
      { start: "2026-03-07T16:00:00.000Z", end: "2026-03-07T16:30:00.000Z" },
      { start: "2026-03-08T13:00:00.000Z", end: "2026-03-08T13:30:00.000Z" },
      { start: "2026-03-07T17:00:00.000Z", end: "2026-03-07T17:30:00.000Z" },
      { start: "2026-03-09T13:00:00.000Z", end: "2026-03-09T13:30:00.000Z" },
      { start: "2026-03-07T18:00:00.000Z", end: "2026-03-07T18:30:00.000Z" },
    ], {
      timeZone: "America/New_York",
      preferredStart: "13:00",
      preferredEnd: "15:00",
      minimumNoticeMinutes: 120,
      bookingHorizonDays: 2,
      now: Date.parse("2026-03-07T15:00:00.000Z"),
    });

    expect(slots.map(slot => slot.start)).toEqual([
      "2026-03-07T18:00:00.000Z",
      "2026-03-07T17:00:00.000Z",
      "2026-03-08T13:00:00.000Z",
    ]);
  });

  it("anchors travel-override horizons to the schedule calendar date", () => {
    const slots = applyAvailabilityBookingPolicy([
      { start: "2026-08-21T16:00:00.000Z", end: "2026-08-21T16:30:00.000Z" },
    ], {
      timeZone: "America/Los_Angeles",
      horizonTimeZone: "Asia/Tokyo",
      calendarDate: "2026-08-21",
      preferredStart: "09:00",
      preferredEnd: "12:00",
      minimumNoticeMinutes: 0,
      bookingHorizonDays: 7,
      now: Date.parse("2026-08-15T02:00:00.000Z"),
    });

    expect(slots.map(slot => slot.start)).toEqual(["2026-08-21T16:00:00.000Z"]);
  });

  it("resolves travel overrides in their own local time zone", () => {
    const base = createInitialCalendarState().availability[0]!;
    const travelSchedule: AvailabilitySchedule = {
      ...base,
      timezone: "America/New_York",
      overrides: [{
        id: "override-tokyo",
        date: "2026-08-22",
        label: "Tokyo customer week",
        available: true,
        timezone: "Asia/Tokyo",
        start: "09:00",
        end: "10:00",
      }],
    };
    const resolved = availabilityForDate(travelSchedule, "2026-08-22");
    expect(resolved).toMatchObject({
      timeZone: "Asia/Tokyo",
      override: { id: "override-tokyo" },
      windows: [{ enabled: true, start: "09:00", end: "10:00" }],
    });
    expect(findAvailableSlotsAcrossWindows({
      date: "2026-08-22",
      timeZone: resolved.timeZone,
      durationMinutes: 30,
      intervalMinutes: 30,
      windows: resolved.windows,
      busy: [],
    }).map(slot => slot.start)).toEqual([
      "2026-08-22T00:00:00.000Z",
      "2026-08-22T00:30:00.000Z",
    ]);
  });

  it("keeps legacy overrides on the schedule time zone", () => {
    const base = createInitialCalendarState().availability[0]!;
    const legacySchedule: AvailabilitySchedule = {
      ...base,
      timezone: "America/New_York",
      overrides: [{
        id: "override-legacy",
        date: "2026-08-22",
        label: "Legacy custom day",
        available: true,
        start: "10:00",
        end: "11:00",
      }],
    };
    expect(availabilityForDate(legacySchedule, "2026-08-22").timeZone).toBe(
      "America/New_York",
    );
    expect(isCalendarState({
      ...createEmptyCalendarState(),
      availability: [legacySchedule],
      activeAvailabilityId: legacySchedule.id,
    })).toBe(true);
  });

  it("does not block availability for provider events marked free", () => {
    const slots = findAvailableSlots({
      date: "2026-08-17",
      timezoneOffset: "-04:00",
      durationMinutes: 30,
      intervalMinutes: 30,
      windowStart: "09:00",
      windowEnd: "10:00",
      busy: [{
        start: "2026-08-17T09:00:00-04:00",
        end: "2026-08-17T10:00:00-04:00",
        busy: false,
      }],
    });

    expect(slots).toHaveLength(2);
  });

  it("resolves non-hour IANA zones without using the device offset", () => {
    const slots = findAvailableSlots({
      date: "2026-01-15",
      timeZone: "Asia/Kathmandu",
      durationMinutes: 30,
      intervalMinutes: 30,
      windowStart: "09:00",
      windowEnd: "10:00",
      busy: [],
    });
    expect(slots.map(slot => slot.start)).toEqual([
      "2026-01-15T03:15:00.000Z",
      "2026-01-15T03:45:00.000Z",
    ]);
  });

  it("skips spring-forward gaps and chooses one fall-back occurrence", () => {
    const spring = findAvailableSlots({
      date: "2026-03-08",
      timeZone: "America/New_York",
      durationMinutes: 30,
      intervalMinutes: 30,
      windowStart: "00:00",
      windowEnd: "05:00",
      busy: [],
    });
    expect(spring.map(slot => slot.start)).toEqual([
      "2026-03-08T05:00:00.000Z",
      "2026-03-08T05:30:00.000Z",
      "2026-03-08T06:00:00.000Z",
      "2026-03-08T06:30:00.000Z",
      "2026-03-08T07:00:00.000Z",
      "2026-03-08T07:30:00.000Z",
      "2026-03-08T08:00:00.000Z",
      "2026-03-08T08:30:00.000Z",
    ]);
    expect(zonedWallClockInstant("2026-03-08", 150, "America/New_York")).toBeNull();

    const repeated = zonedWallClockInstant("2026-11-01", 90, "America/New_York");
    expect(repeated?.toISOString()).toBe("2026-11-01T05:30:00.000Z");
  });

  it("keeps elapsed meeting duration inside a DST-shortened availability window", () => {
    const slots = findAvailableSlots({
      date: "2026-03-08",
      timeZone: "America/New_York",
      durationMinutes: 60,
      intervalMinutes: 30,
      windowStart: "01:30",
      windowEnd: "03:00",
      busy: [],
    });
    expect(slots).toEqual([]);
  });

  it("creates the agreed public URL and rejects unsafe slugs", () => {
    expect(publicBookingUrl("alex-morgan", "30min")).toBe(
      "https://cal.with-tap.ai/alex-morgan/30min",
    );
    expect(validateSlug("Bad Slug")).not.toBeNull();
    expect(() => publicBookingUrl("../admin", "30min")).toThrow();
  });

  it("tracks public page funnel stages and conversion", () => {
    const initial = createInitialCalendarState();
    const viewed = trackFunnel(initial, "event-type-30min", "views");
    const eventType = viewed.bookingProfiles[0]?.eventTypes[0];
    expect(eventType?.analytics.views).toBe(843);
    expect(conversionRate(eventType!.analytics)).toBeCloseTo(184 / 843);
  });

  it("computes the default ten-minute reminder", () => {
    const event = createInitialCalendarState().events[0]!;
    expect(reminderAt(event, 10)).toBe("2026-08-10T16:50:00.000Z");
  });

  describe("Event Type Availability Schedule relationships", () => {
    it("loads legacy Event Types and deterministically migrates them to the active schedule", () => {
      const legacy = legacyAvailabilityState();
      const legacyEventType = legacy.bookingProfiles[0]!.eventTypes[0]!;

      expect(isCalendarState(legacy)).toBe(true);
      expect(legacyEventType.availabilityScheduleId).toBeUndefined();
      expect(resolveEventTypeAvailabilityScheduleId(legacy, legacyEventType)).toBe(
        "availability-standard",
      );

      const migrated = migrateLegacyEventTypeAvailabilitySchedules(legacy);
      expect(migrated).not.toBe(legacy);
      expect(migrated.bookingProfiles.flatMap(profile => profile.eventTypes)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "event-type-intro",
            availabilityScheduleId: "availability-standard",
          }),
        ]),
      );
      expect(migrateLegacyEventTypeAvailabilitySchedules(migrated)).toBe(migrated);
    });

    it("uses the first stored schedule only when a legacy state's active schedule is unavailable", () => {
      const legacy = legacyAvailabilityState();
      const withoutActive = { ...legacy, activeAvailabilityId: "missing" };
      const eventType = withoutActive.bookingProfiles[0]!.eventTypes[0]!;

      expect(resolveEventTypeAvailabilityScheduleId(withoutActive, eventType)).toBe(
        "availability-standard",
      );
      expect(
        migrateLegacyEventTypeAvailabilitySchedules(withoutActive)
          .bookingProfiles[0]!.eventTypes[0]!.availabilityScheduleId,
      ).toBe("availability-standard");
    });

    it("never hides a dangling explicit relationship behind the legacy fallback", () => {
      const initial = createInitialCalendarState();
      const explicitDangling: EventType = {
        ...initial.bookingProfiles[0]!.eventTypes[0]!,
        availabilityScheduleId: "availability-missing",
      };
      const danglingState: CalendarState = {
        ...initial,
        bookingProfiles: [{
          ...initial.bookingProfiles[0]!,
          eventTypes: [explicitDangling, ...initial.bookingProfiles[0]!.eventTypes.slice(1)],
        }, ...initial.bookingProfiles.slice(1)],
      };

      expect(resolveEventTypeAvailabilityScheduleId(initial, explicitDangling)).toBeNull();
      expect(migrateLegacyEventTypeAvailabilitySchedules(danglingState)).toBe(danglingState);
      expect(isCalendarState(danglingState)).toBe(false);
    });

    it("rejects missing and dangling schedules on create without dropping legacy state", () => {
      const legacy = asLegacyEventTypeState(createInitialCalendarState());
      const { availabilityScheduleId: _availabilityScheduleId, ...missingSchedule } =
        eventTypeFixture({ id: "event-type-missing-schedule" });
      const missing = addEventType(
        legacy,
        "profile-tap",
        missingSchedule as NewEventType,
      );
      const dangling = addEventType(
        legacy,
        "profile-tap",
        eventTypeFixture({
          id: "event-type-dangling-schedule",
          availabilityScheduleId: "availability-missing",
        }),
      );

      expect(missing).toMatchObject({
        ok: false,
        state: legacy,
        error: {
          code: "invalid-availability",
          field: "availabilityScheduleId",
        },
      });
      expect(dangling).toMatchObject({
        ok: false,
        state: legacy,
        error: {
          code: "invalid-availability",
          field: "availabilityScheduleId",
        },
      });
      expect(legacy.bookingProfiles[0]!.eventTypes[0]!.availabilityScheduleId)
        .toBeUndefined();
    });

    it("validates nested Event Types when creating a Booking Profile", () => {
      const initial = createInitialCalendarState();
      const legacyNested = withoutAvailabilitySchedule(eventTypeFixture({
        id: "event-type-profile-legacy",
      }));
      const result = addBookingProfile(initial, bookingProfileFixture({
        eventTypes: [legacyNested],
      }));

      expect(result).toMatchObject({
        ok: false,
        state: initial,
        error: {
          code: "invalid-availability",
          field: "eventTypes[0].availabilityScheduleId",
        },
      });
    });

    it("stores an explicit schedule and migrates older Event Types on successful create", () => {
      const legacy = asLegacyEventTypeState(createInitialCalendarState());
      const result = addEventType(
        legacy,
        "profile-tap",
        eventTypeFixture({
          id: "event-type-customer-hours",
          slug: "customer-hours",
          availabilityScheduleId: "availability-customer",
        }),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(
        result.state.bookingProfiles
          .find(profile => profile.id === "profile-tap")
          ?.eventTypes.find(eventType => eventType.id === "event-type-customer-hours"),
      ).toMatchObject({
        availabilityScheduleId: "availability-customer",
      });
      expect(
        result.state.bookingProfiles
          .find(profile => profile.id === "profile-alex")
          ?.eventTypes.every(eventType =>
            eventType.availabilityScheduleId === "availability-standard"
          ),
      ).toBe(true);
    });

    it("migrates against the previous active schedule before changing the default", () => {
      const legacy = legacyAvailabilityState();
      const added = addAvailabilitySchedule(legacy, scheduleFixture(), {
        makeDefault: true,
      });

      expect(added.ok).toBe(true);
      if (!added.ok) throw new Error(added.error.message);
      expect(added.state.activeAvailabilityId).toBe("availability-deep-work");
      expect(
        added.state.bookingProfiles.flatMap(profile => profile.eventTypes)
          .every(eventType =>
            eventType.availabilityScheduleId === "availability-standard"
          ),
      ).toBe(true);
    });

    it("binds schedule-less legacy Event Types when their first schedule is created", () => {
      const legacyWithoutSchedules: CalendarState = {
        ...legacyAvailabilityState(false),
      };
      expect(isCalendarState(legacyWithoutSchedules)).toBe(true);

      const added = addAvailabilitySchedule(
        legacyWithoutSchedules,
        scheduleFixture(),
      );

      expect(added.ok).toBe(true);
      if (!added.ok) throw new Error(added.error.message);
      expect(
        added.state.bookingProfiles.flatMap(profile => profile.eventTypes)
          .every(eventType =>
            eventType.availabilityScheduleId === "availability-deep-work"
          ),
      ).toBe(true);
      expect(isCalendarState(added.state)).toBe(true);
    });
  });

  describe("configuration CRUD", () => {
    it("adds owned and shared calendars immutably and moves the sole destination", () => {
      const initial = createInitialCalendarState();
      const input = {
        id: "acct-fastmail",
        provider: "caldav",
        label: "  Fastmail  ",
        status: "connected",
        calendars: [
          {
            id: "cal-fastmail-primary",
            name: "  Personal  ",
            color: "#0ea5e9",
            role: "owner",
            visible: true,
            conflicts: true,
            writable: true,
            destination: true,
            freshness: "live",
          },
          {
            id: "cal-fastmail-shared",
            name: "Partner calendar",
            color: "#f59e0b",
            role: "reader",
            visible: true,
            conflicts: true,
            writable: false,
            destination: false,
            freshness: "live",
          },
        ],
      } satisfies AddConnectedAccountInput;

      const result = addConnectedAccount(initial, input);

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(initial.accounts).toHaveLength(4);
      expect(input.label).toBe("  Fastmail  ");
      expect(result.state.accounts).toHaveLength(5);
      expect(result.state.accounts.at(-1)).toMatchObject({
        id: "acct-fastmail",
        label: "Fastmail",
        calendars: [
          {
            id: "cal-fastmail-primary",
            accountId: "acct-fastmail",
            name: "Personal",
            role: "owner",
            destination: true,
          },
          {
            id: "cal-fastmail-shared",
            accountId: "acct-fastmail",
            role: "reader",
            destination: false,
          },
        ],
      });
      expect(
        result.state.accounts
          .flatMap(account => account.calendars)
          .filter(calendar => calendar.destination)
          .map(calendar => calendar.id),
      ).toEqual(["cal-fastmail-primary"]);
      expect(
        initial.accounts
          .flatMap(account => account.calendars)
          .find(calendar => calendar.id === "cal-work")?.destination,
      ).toBe(true);
    });

    it("rejects duplicate account and calendar IDs without changing state", () => {
      const initial = createInitialCalendarState();
      const duplicateAccount = addConnectedAccount(initial, {
        id: "acct-google",
        provider: "google",
        label: "Another Google account",
        status: "connected",
        calendars: [
          {
            id: "cal-another-google",
            name: "Another calendar",
            color: "#111827",
            role: "owner",
            visible: true,
            conflicts: true,
            writable: true,
            destination: false,
            freshness: "live",
          },
        ],
      });
      const duplicateCalendar = addConnectedAccount(initial, {
        id: "acct-other-google",
        provider: "google",
        label: "Other Google account",
        status: "connected",
        calendars: [
          {
            id: "cal-work",
            name: "Copied work calendar",
            color: "#111827",
            role: "reader",
            visible: true,
            conflicts: true,
            writable: false,
            destination: false,
            freshness: "live",
          },
        ],
      });

      expect(duplicateAccount).toMatchObject({
        ok: false,
        state: initial,
        error: { code: "duplicate-id", field: "id" },
      });
      expect(duplicateCalendar).toMatchObject({
        ok: false,
        state: initial,
        error: { code: "duplicate-id", field: "calendars[0].id" },
      });
    });

    it("requires at least one named calendar and a writable destination", () => {
      const initial = createInitialCalendarState();
      const empty = addConnectedAccount(initial, {
        id: "acct-empty",
        provider: "ics",
        label: "Empty feed",
        status: "read-only",
        calendars: [],
      });
      const readOnlyDestination = addConnectedAccount(initial, {
        id: "acct-shared",
        provider: "google",
        label: "Shared account",
        status: "read-only",
        calendars: [
          {
            id: "cal-shared",
            name: "Shared calendar",
            color: "#a855f7",
            role: "reader",
            visible: true,
            conflicts: true,
            writable: false,
            destination: true,
            freshness: "live",
          },
        ],
      });

      expect(empty).toMatchObject({ ok: false, error: { code: "empty-calendars" } });
      expect(readOnlyDestination).toMatchObject({
        ok: false,
        error: { code: "invalid-destination" },
      });
    });

    it("adds a named Availability Schedule and can make it the default", () => {
      const initial = createInitialCalendarState();
      const result = addAvailabilitySchedule(
        initial,
        scheduleFixture({ name: "  Deep work  " }),
        { makeDefault: true },
      );

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(initial.activeAvailabilityId).toBe("availability-standard");
      expect(result.state.activeAvailabilityId).toBe("availability-deep-work");
      expect(result.state.availability.at(-1)?.name).toBe("Deep work");
    });

    it("rejects duplicate and unnamed Availability Schedules", () => {
      const initial = createInitialCalendarState();
      expect(
        addAvailabilitySchedule(
          initial,
          scheduleFixture({ id: "availability-standard" }),
        ),
      ).toMatchObject({ ok: false, error: { code: "duplicate-id" } });
      expect(
        addAvailabilitySchedule(initial, scheduleFixture({ name: "   " })),
      ).toMatchObject({ ok: false, error: { code: "empty-name" } });
    });

    it("adds a Booking Profile with a globally unique valid slug", () => {
      const initial = createInitialCalendarState();
      const result = addBookingProfile(
        initial,
        bookingProfileFixture({ displayName: "  Zephyr Consulting  " }),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(initial.bookingProfiles).toHaveLength(2);
      expect(result.state.bookingProfiles.at(-1)).toMatchObject({
        slug: "zephyr-consulting",
        displayName: "Zephyr Consulting",
      });
    });

    it("rejects duplicate, invalid, and unnamed Booking Profiles", () => {
      const initial = createInitialCalendarState();
      expect(
        addBookingProfile(initial, bookingProfileFixture({ slug: "alex-morgan" })),
      ).toMatchObject({ ok: false, error: { code: "duplicate-slug" } });
      expect(
        addBookingProfile(initial, bookingProfileFixture({ slug: "Bad Slug" })),
      ).toMatchObject({ ok: false, error: { code: "invalid-slug" } });
      expect(
        addBookingProfile(initial, bookingProfileFixture({ displayName: " " })),
      ).toMatchObject({ ok: false, error: { code: "empty-name" } });
    });

    it("scopes Event Type Slug uniqueness to its Booking Profile", () => {
      const initial = createInitialCalendarState();
      const allowed = addEventType(
        initial,
        "profile-tap",
        eventTypeFixture({ id: "event-type-team-30min", slug: "30min" }),
      );

      expect(allowed.ok).toBe(true);
      if (!allowed.ok) throw new Error(allowed.error.message);
      expect(
        allowed.state.bookingProfiles
          .find(profile => profile.id === "profile-tap")
          ?.eventTypes.at(-1)?.slug,
      ).toBe("30min");
      expect(
        addEventType(
          allowed.state,
          "profile-tap",
          eventTypeFixture({ id: "event-type-team-30min-copy", slug: "30min" }),
        ),
      ).toMatchObject({ ok: false, error: { code: "duplicate-slug" } });
    });

    it("requires a unique Event Type ID, reasonable duration, and writable destination", () => {
      const initial = createInitialCalendarState();
      expect(
        addEventType(
          initial,
          "profile-tap",
          eventTypeFixture({ id: "event-type-30min", slug: "another-call" }),
        ),
      ).toMatchObject({ ok: false, error: { code: "duplicate-id" } });
      expect(
        addEventType(
          initial,
          "profile-tap",
          eventTypeFixture({ durationMinutes: 4 }),
        ),
      ).toMatchObject({ ok: false, error: { code: "invalid-duration" } });
      expect(
        addEventType(
          initial,
          "profile-tap",
          eventTypeFixture({ destinationCalendarId: "cal-holidays" }),
        ),
      ).toMatchObject({ ok: false, error: { code: "invalid-destination" } });
    });

    it("returns a typed error when the Booking Profile does not exist", () => {
      const initial = createInitialCalendarState();
      expect(
        addEventType(initial, "profile-missing", eventTypeFixture()),
      ).toMatchObject({
        ok: false,
        state: initial,
        error: { code: "profile-not-found", field: "profileId" },
      });
    });
  });
});
