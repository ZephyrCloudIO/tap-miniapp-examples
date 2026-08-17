import { describe, expect, it } from "@rstest/core";
import { createInitialCalendarState } from "./test-fixtures";
import { markChangedPublicBookingProfilesPending } from "./publication-state";

const requestedAt = "2026-08-16T20:00:00.000Z";

describe("public Booking Profile desired-state tracking", () => {
  it("marks availability policy changes but ignores funnel-only changes", () => {
    const state = createInitialCalendarState();
    const profile = state.bookingProfiles[0]!;
    const analyticsOnly = {
      ...state,
      bookingProfiles: state.bookingProfiles.map(candidate => candidate.id === profile.id
        ? {
          ...candidate,
          eventTypes: candidate.eventTypes.map((eventType, index) => index === 0
            ? { ...eventType, analytics: { ...eventType.analytics, views: eventType.analytics.views + 1 } }
            : eventType),
        }
        : candidate),
    };
    expect(markChangedPublicBookingProfilesPending(
      state,
      analyticsOnly,
      requestedAt,
    )).toBe(analyticsOnly);

    const scheduleId = profile.eventTypes[0]!.availabilityScheduleId;
    const policyChanged = {
      ...state,
      availability: state.availability.map(schedule => schedule.id === scheduleId
        ? { ...schedule, bufferAfterMinutes: schedule.bufferAfterMinutes + 5 }
        : schedule),
    };
    expect(markChangedPublicBookingProfilesPending(
      state,
      policyChanged,
      requestedAt,
    ).bookingProfiles.find(candidate => candidate.id === profile.id)?.pendingPublication)
      .toMatchObject({ desiredStatus: "published", requestedAt });
  });

  it("tracks an explicit unpublish while leaving a new draft alone", () => {
    const state = createInitialCalendarState();
    const profile = state.bookingProfiles[0]!;
    const withReceipt = {
      ...state,
      bookingProfiles: state.bookingProfiles.map(candidate => candidate.id === profile.id
        ? {
          ...candidate,
          publication: {
            generation: 4,
            status: "published" as const,
            reservedSlug: candidate.slug,
            updatedAt: "2026-08-16T19:00:00.000Z",
          },
        }
        : candidate),
    };
    const unpublished = {
      ...withReceipt,
      bookingProfiles: withReceipt.bookingProfiles.map(candidate => candidate.id === profile.id
        ? { ...candidate, published: false }
        : candidate),
    };
    expect(markChangedPublicBookingProfilesPending(
      withReceipt,
      unpublished,
      requestedAt,
    ).bookingProfiles.find(candidate => candidate.id === profile.id)?.pendingPublication)
      .toEqual({ desiredStatus: "unpublished", expectedGeneration: 4, requestedAt });

    const draft = {
      ...state,
      bookingProfiles: [...state.bookingProfiles, {
        id: "profile-draft",
        ownerType: "individual" as const,
        slug: "draft-profile",
        displayName: "Draft",
        timezone: "UTC",
        published: false,
        eventTypes: [],
      }],
    };
    expect(markChangedPublicBookingProfilesPending(state, draft, requestedAt))
      .toBe(draft);
  });

  it("does not silently publish a receipt-less legacy profile after an unrelated edit", () => {
    const state = createInitialCalendarState();
    const profile = state.bookingProfiles[0]!;
    expect(profile.published).toBe(true);
    expect(profile.publication).toBeUndefined();

    const renamedSchedule = {
      ...state,
      availability: state.availability.map((schedule, index) => index === 0
        ? { ...schedule, name: `${schedule.name} updated` }
        : schedule),
    };
    expect(markChangedPublicBookingProfilesPending(
      state,
      renamedSchedule,
      requestedAt,
    )).toBe(renamedSchedule);
  });
});
