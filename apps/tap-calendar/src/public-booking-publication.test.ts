import { describe, expect, it } from "@rstest/core";
import { createInitialCalendarState } from "./test-fixtures";
import {
  buildPublicBookingProfilePublication,
  buildPublicBookingPublication,
  publicBookingProfilePublicationFingerprint,
} from "./public-booking-publication";

describe("public booking publication projection", () => {
  it("projects the bound schedule and only calendar identifiers needed by the gateway", () => {
    const state = createInitialCalendarState();
    const profile = state.bookingProfiles[0]!;
    const eventType = profile.eventTypes[1]!;
    const result = buildPublicBookingPublication(state, profile, eventType);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.publication).toMatchObject({
      schemaVersion: "tap.calendar.publication.v1",
      ownerType: "individual",
      sourceProfileId: profile.id,
      sourceEventTypeId: eventType.id,
      sourceAvailabilityScheduleId: "availability-customer",
      destinationCalendarId: eventType.destinationCalendarId,
      schedule: {
        preferredStart: "11:00",
        preferredEnd: "16:00",
        minimumNoticeMinutes: 240,
      },
    });
    expect(result.publication.conflictCalendarIds).toContain(eventType.destinationCalendarId);
    expect(JSON.stringify(result.publication)).not.toMatch(
      /alex\.personal@|maya@|event-alex|booking-pending/u,
    );
  });

  it("still enforces the Event Type destination when every global conflict calendar is disabled", () => {
    const initial = createInitialCalendarState();
    const state = {
      ...initial,
      accounts: initial.accounts.map(account => ({
        ...account,
        calendars: account.calendars.map(calendar => ({
          ...calendar,
          conflicts: false,
        })),
      })),
    };
    const profile = state.bookingProfiles[0]!;
    const eventType = profile.eventTypes[0]!;

    const result = buildPublicBookingPublication(state, profile, eventType);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.publication.conflictCalendarIds).toEqual([
      eventType.destinationCalendarId,
    ]);
  });

  it("fails closed for unsupported owners, drafts, and missing schedules", () => {
    const state = createInitialCalendarState();
    const individual = state.bookingProfiles[0]!;
    const team = state.bookingProfiles[1]!;
    expect(buildPublicBookingPublication(state, team, team.eventTypes[0]!)).toMatchObject({
      ok: false,
      message: expect.stringContaining("individual"),
    });
    expect(buildPublicBookingPublication(
      state,
      { ...individual, published: false },
      individual.eventTypes[0]!,
    )).toMatchObject({ ok: false });
    expect(buildPublicBookingPublication(
      state,
      individual,
      { ...individual.eventTypes[0]!, availabilityScheduleId: "missing" },
    )).toMatchObject({
      ok: false,
      message: expect.stringContaining("Availability Schedule"),
    });
  });

  it("projects every active page as one deterministic profile generation", () => {
    const state = createInitialCalendarState();
    const profile = state.bookingProfiles[0]!;
    const result = buildPublicBookingProfilePublication(state, profile, 7);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.publication).toMatchObject({
      schemaVersion: "tap.calendar.profile-publication.v1",
      sourceProfileId: profile.id,
      profileSlug: profile.slug,
      displayName: profile.displayName,
      ownerType: "individual",
      expectedGeneration: 7,
    });
    expect(result.publication.publications.map(page => page.eventTypeSlug)).toEqual(
      [...result.publication.publications.map(page => page.eventTypeSlug)].sort(),
    );
    expect(result.publication.publications.every(
      page => page.sourceProfileId === profile.id,
    )).toBe(true);
  });

  it("publishes a profile namespace without Event Types and rejects invalid profiles", () => {
    const state = createInitialCalendarState();
    const profile = state.bookingProfiles[0]!;
    const empty = buildPublicBookingProfilePublication(
      state,
      { ...profile, eventTypes: profile.eventTypes.map(eventType => ({ ...eventType, active: false })) },
      0,
    );
    expect(empty).toMatchObject({
      ok: true,
      publication: {
        sourceProfileId: profile.id,
        profileSlug: profile.slug,
        displayName: profile.displayName,
        publications: [],
      },
    });
    expect(buildPublicBookingProfilePublication(
      state,
      { ...profile, ownerType: "team", eventTypes: [] },
      0,
    )).toMatchObject({ ok: false, message: expect.stringContaining("individual") });
    expect(buildPublicBookingProfilePublication(state, profile, -1)).toMatchObject({
      ok: false,
      message: expect.stringContaining("generation"),
    });
  });

  it("fingerprints only publication-relevant profile state", () => {
    const state = createInitialCalendarState();
    const profile = state.bookingProfiles[0]!;
    const original = publicBookingProfilePublicationFingerprint(state, profile);
    const analyticsOnly = {
      ...profile,
      eventTypes: profile.eventTypes.map((eventType, index) => index === 0
        ? { ...eventType, analytics: { ...eventType.analytics, views: eventType.analytics.views + 1 } }
        : eventType),
    };
    expect(publicBookingProfilePublicationFingerprint(state, analyticsOnly)).toBe(original);
    const scheduleChanged = {
      ...state,
      availability: state.availability.map(schedule =>
        schedule.id === profile.eventTypes[0]?.availabilityScheduleId
          ? { ...schedule, bufferBeforeMinutes: schedule.bufferBeforeMinutes + 5 }
          : schedule),
    };
    expect(publicBookingProfilePublicationFingerprint(scheduleChanged, profile)).not.toBe(original);

    const emptyProfile = { ...profile, eventTypes: [] };
    const emptyOriginal = publicBookingProfilePublicationFingerprint(state, emptyProfile);
    expect(publicBookingProfilePublicationFingerprint(
      state,
      { ...emptyProfile, displayName: `${emptyProfile.displayName} updated` },
    )).not.toBe(emptyOriginal);
    expect(publicBookingProfilePublicationFingerprint(
      state,
      { ...emptyProfile, slug: `${emptyProfile.slug}-new` },
    )).not.toBe(emptyOriginal);
  });
});
