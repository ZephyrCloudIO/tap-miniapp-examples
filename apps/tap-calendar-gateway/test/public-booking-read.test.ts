import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  assertPublicPageStillCurrent,
  availabilityQueryWindow,
  buildPublicAvailability,
  generatePublicAvailabilityCandidates,
  parsePublicBookingPagePath,
  parsePublicBookingProfilePath,
  projectPublicBookingProfile,
  projectPublicBookingPage,
  publicAvailabilityQuery,
  publicSlotSatisfiesPublishedSchedule,
  resolvePublishedPublicBookingProfile,
  resolvePublishedPublicBookingPage,
  signPublicSlotToken,
  verifyPublicSlotToken,
  type PrivatePageSnapshot,
  type PublicAvailabilityQuery,
  type PublicPageSnapshot,
  type ResolvedPublishedPublicBookingPage,
} from "../src/public-booking-read";

const now = Date.parse("2026-08-16T12:00:00.000Z");
const MILLISECONDS_PER_MINUTE = 60_000;
const revisionId = "public-revision-read-1";
const signingKey = "test-only-public-slot-signing-key-1234567890";

const publicSnapshot: PublicPageSnapshot = {
  schemaVersion: "tap.calendar.public-page-snapshot.v1",
  displayName: "Alex Morgan",
  title: "30 minute meeting",
  description: "Pick a time that works for you.",
  durationMinutes: 30,
  location: "google-meet",
  locationLabel: "Google Meet",
  approvalRequired: false,
};

const privateSnapshot: PrivatePageSnapshot = {
  schemaVersion: "tap.calendar.private-page-snapshot.v1",
  workspaceId: "workspace-public-read",
  principalId: "principal-public-read",
  destinationCalendarId: "calendar-destination-read",
  conflictCalendarIds: ["calendar-conflict-read", "calendar-destination-read"],
  sourceAvailabilityScheduleId: "availability-public-read",
  location: "google-meet",
  schedule: {
    timeZone: "America/New_York",
    preferredStart: "10:00",
    preferredEnd: "15:00",
    bufferBeforeMinutes: 5,
    bufferAfterMinutes: 10,
    minimumNoticeMinutes: 0,
    bookingHorizonDays: 60,
    windows: [
      { day: 1, enabled: true, start: "09:00", end: "11:00" },
    ],
    overrides: [{
      date: "2026-08-22",
      label: "Tokyo trip",
      available: true,
      timeZone: "Asia/Tokyo",
      start: "09:00",
      end: "10:00",
    }],
  },
};

function resolvedFixture(options: {
  readonly revision?: string;
  readonly public?: PublicPageSnapshot;
  readonly private?: PrivatePageSnapshot;
} = {}): ResolvedPublishedPublicBookingPage {
  return {
    profileId: "profile-public-read",
    pageId: "page-public-read",
    revisionId: options.revision ?? revisionId,
    profileSlug: "alex-morgan",
    eventTypeSlug: "30min",
    publishedAt: "2026-08-16T11:00:00.000Z",
    publicSnapshot: options.public ?? publicSnapshot,
    privateSnapshot: options.private ?? privateSnapshot,
  };
}

const query = (overrides: Partial<PublicAvailabilityQuery> = {}): PublicAvailabilityQuery => ({
  month: "2026-08-01",
  timeZone: "America/New_York",
  pageRevision: revisionId,
  ...overrides,
});

async function seedPublishedPage(options: {
  readonly storedPublicSnapshot?: unknown;
  readonly storedPrivateSnapshot?: PrivatePageSnapshot;
} = {}): Promise<void> {
  const createdAt = "2026-08-16T11:00:00.000Z";
  await env.CALENDAR_DB.batch([
    env.CALENDAR_DB.prepare(
      `INSERT INTO public_booking_profiles (
         id, workspace_id, principal_id, source_profile_id, current_slug,
         display_name, owner_type, status, publication_generation,
         created_at, updated_at, published_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'individual', 'published', 1, ?, ?, ?)`,
    ).bind(
      "profile-public-read",
      privateSnapshot.workspaceId,
      privateSnapshot.principalId,
      "source-profile-public-read",
      "alex-morgan",
      publicSnapshot.displayName,
      createdAt,
      createdAt,
      createdAt,
    ),
    env.CALENDAR_DB.prepare(
      `INSERT INTO public_booking_profile_slugs (slug, profile_id, active, created_at)
       VALUES ('alex-morgan', 'profile-public-read', 1, ?)`,
    ).bind(createdAt),
    env.CALENDAR_DB.prepare(
      `INSERT INTO public_booking_pages (
         id, profile_id, source_event_type_id, current_slug,
         current_revision_id, status, created_at, updated_at, published_at
       ) VALUES (?, ?, ?, ?, ?, 'published', ?, ?, ?)`,
    ).bind(
      "page-public-read",
      "profile-public-read",
      "source-event-public-read",
      "30min",
      revisionId,
      createdAt,
      createdAt,
      createdAt,
    ),
    env.CALENDAR_DB.prepare(
      `INSERT INTO public_booking_page_slugs (profile_id, slug, page_id, active, created_at)
       VALUES ('profile-public-read', '30min', 'page-public-read', 1, ?)`,
    ).bind(createdAt),
    env.CALENDAR_DB.prepare(
      `INSERT INTO public_booking_page_revisions (
         id, page_id, snapshot_hash, public_snapshot_json, private_snapshot_json, created_at
       ) VALUES (?, 'page-public-read', ?, ?, ?, ?)`,
    ).bind(
      revisionId,
      "snapshot-hash-public-read-1",
      JSON.stringify(options.storedPublicSnapshot ?? publicSnapshot),
      JSON.stringify(options.storedPrivateSnapshot ?? privateSnapshot),
      createdAt,
    ),
  ]);
}

async function seedPublishedProfileWithoutPages(): Promise<void> {
  const createdAt = "2026-08-16T11:00:00.000Z";
  await env.CALENDAR_DB.batch([
    env.CALENDAR_DB.prepare(
      `INSERT INTO public_booking_profiles (
         id, workspace_id, principal_id, source_profile_id, current_slug,
         display_name, owner_type, status, publication_generation,
         created_at, updated_at, published_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'individual', 'published', 1, ?, ?, ?)`,
    ).bind(
      "profile-public-read",
      privateSnapshot.workspaceId,
      privateSnapshot.principalId,
      "source-profile-public-read",
      "alex-morgan",
      publicSnapshot.displayName,
      createdAt,
      createdAt,
      createdAt,
    ),
    env.CALENDAR_DB.prepare(
      `INSERT INTO public_booking_profile_slugs (slug, profile_id, active, created_at)
       VALUES ('alex-morgan', 'profile-public-read', 1, ?)`,
    ).bind(createdAt),
  ]);
}

beforeEach(async () => {
  await env.CALENDAR_DB.batch([
    env.CALENDAR_DB.prepare("DELETE FROM public_booking_publication_audit"),
    env.CALENDAR_DB.prepare("DELETE FROM public_booking_page_revisions"),
    env.CALENDAR_DB.prepare("DELETE FROM public_booking_page_slugs"),
    env.CALENDAR_DB.prepare("DELETE FROM public_booking_pages"),
    env.CALENDAR_DB.prepare("DELETE FROM public_booking_profile_generations"),
    env.CALENDAR_DB.prepare("DELETE FROM public_booking_profile_slugs"),
    env.CALENDAR_DB.prepare("DELETE FROM public_booking_owner_profile_slots"),
    env.CALENDAR_DB.prepare("DELETE FROM public_booking_profiles"),
  ]);
});

describe("anonymous public booking request parsing", () => {
  it("accepts only canonical slug routes", () => {
    expect(parsePublicBookingProfilePath("/api/public/profiles/alex-morgan"))
      .toBe("alex-morgan");
    expect(parsePublicBookingProfilePath("/api/public/profiles/Alex-Morgan")).toBeNull();
    expect(parsePublicBookingProfilePath("/api/public/profiles/%61lex-morgan")).toBeNull();
    expect(parsePublicBookingProfilePath("/api/public/profiles/alex-morgan/30min")).toBeNull();
    expect(parsePublicBookingPagePath("/api/public/pages/alex-morgan/30min"))
      .toEqual({ profileSlug: "alex-morgan", eventTypeSlug: "30min", resource: "page" });
    expect(parsePublicBookingPagePath("/api/public/pages/alex-morgan/30min/availability"))
      .toEqual({ profileSlug: "alex-morgan", eventTypeSlug: "30min", resource: "availability" });
    expect(parsePublicBookingPagePath("/api/public/pages/alex-morgan/30min/bookings"))
      .toEqual({ profileSlug: "alex-morgan", eventTypeSlug: "30min", resource: "bookings" });
    expect(parsePublicBookingPagePath("/api/public/pages/alex-morgan/30min/")).toBeNull();
    expect(parsePublicBookingPagePath("/api/public/pages/%61lex-morgan/30min")).toBeNull();
    expect(parsePublicBookingPagePath("/api/public/pages/../30min")).toBeNull();
  });

  it("requires one bounded month, IANA zone, and page revision with no extra query keys", () => {
    expect(publicAvailabilityQuery(new URLSearchParams({
      month: "2026-08-01",
      timeZone: "America/Los_Angeles",
      pageRevision: revisionId,
    }))).toEqual({
      month: "2026-08-01",
      timeZone: "America/Los_Angeles",
      pageRevision: revisionId,
    });
    expect(() => publicAvailabilityQuery(new URLSearchParams(
      `month=2026-08-01&timeZone=UTC&pageRevision=${revisionId}&debug=1`,
    ))).toThrowError(expect.objectContaining({ code: "invalid_availability_query" }));
    expect(() => publicAvailabilityQuery(new URLSearchParams(
      `month=2026-08-01&month=2026-09-01&timeZone=UTC&pageRevision=${revisionId}`,
    ))).toThrowError(expect.objectContaining({ code: "invalid_availability_query" }));
    expect(() => publicAvailabilityQuery(new URLSearchParams({
      month: "2026-08-02",
      timeZone: "UTC",
      pageRevision: revisionId,
    }))).toThrowError(expect.objectContaining({ code: "invalid_month" }));
    expect(() => publicAvailabilityQuery(new URLSearchParams({
      month: "2026-08-01",
      timeZone: "Mars/Olympus",
      pageRevision: revisionId,
    }))).toThrowError(expect.objectContaining({ code: "invalid_time_zone" }));
  });
});

describe("published profile resolution", () => {
  it("projects exact guest-safe event summaries in deterministic slug order", async () => {
    await seedPublishedPage();
    const briefSnapshot: PublicPageSnapshot = {
      ...publicSnapshot,
      title: "Brief phone call",
      description: "",
      durationMinutes: 15,
      location: "phone",
      locationLabel: "Phone call",
      approvalRequired: true,
    };
    const createdAt = "2026-08-16T11:05:00.000Z";
    await env.CALENDAR_DB.batch([
      env.CALENDAR_DB.prepare(
        `INSERT INTO public_booking_pages (
           id, profile_id, source_event_type_id, current_slug,
           current_revision_id, status, created_at, updated_at, published_at
         ) VALUES ('page-public-read-brief', 'profile-public-read',
                   'source-event-public-read-brief', '15min',
                   'public-revision-read-brief', 'published', ?, ?, ?)`,
      ).bind(createdAt, createdAt, createdAt),
      env.CALENDAR_DB.prepare(
        `INSERT INTO public_booking_page_slugs (profile_id, slug, page_id, active, created_at)
         VALUES ('profile-public-read', '15min', 'page-public-read-brief', 1, ?)`,
      ).bind(createdAt),
      env.CALENDAR_DB.prepare(
        `INSERT INTO public_booking_page_revisions (
           id, page_id, snapshot_hash, public_snapshot_json, private_snapshot_json, created_at
         ) VALUES ('public-revision-read-brief', 'page-public-read-brief',
                   'snapshot-hash-public-read-brief', ?, ?, ?)`,
      ).bind(JSON.stringify(briefSnapshot), JSON.stringify(privateSnapshot), createdAt),
    ]);

    const resolved = await resolvePublishedPublicBookingProfile(
      env.CALENDAR_DB.withSession("first-primary"),
      "alex-morgan",
    );
    expect(resolved.eventTypes.map(eventType => eventType.eventTypeSlug))
      .toEqual(["15min", "30min"]);
    const projected = projectPublicBookingProfile(resolved, {
      baseUrl: "https://cal.with-tap.ai",
    });
    expect(projected).toEqual({
      schemaVersion: "tap.calendar.public-profile.v1",
      canonicalUrl: "https://cal.with-tap.ai/alex-morgan",
      profile: { displayName: "Alex Morgan", initials: "AM" },
      eventTypes: [{
        eventTypeSlug: "15min",
        canonicalUrl: "https://cal.with-tap.ai/alex-morgan/15min",
        title: "Brief phone call",
        durationMinutes: 15,
        location: "phone",
        locationLabel: "Phone call",
        approvalRequired: true,
      }, {
        eventTypeSlug: "30min",
        canonicalUrl: "https://cal.with-tap.ai/alex-morgan/30min",
        title: "30 minute meeting",
        description: "Pick a time that works for you.",
        durationMinutes: 30,
        location: "google-meet",
        locationLabel: "Google Meet",
        approvalRequired: false,
      }],
    });
    expect(JSON.stringify(projected)).not.toMatch(
      /workspace-public-read|principal-public-read|calendar-destination-read|calendar-conflict-read/u,
    );
  });

  it("returns a published profile with no Event Types", async () => {
    await seedPublishedProfileWithoutPages();
    const resolved = await resolvePublishedPublicBookingProfile(
      env.CALENDAR_DB,
      "alex-morgan",
    );
    expect(projectPublicBookingProfile(resolved, {
      baseUrl: "https://cal.with-tap.ai",
    })).toEqual({
      schemaVersion: "tap.calendar.public-profile.v1",
      canonicalUrl: "https://cal.with-tap.ai/alex-morgan",
      profile: { displayName: "Alex Morgan", initials: "AM" },
      eventTypes: [],
    });
  });

  it("uses one generic 404 and fails closed on a malformed current public snapshot", async () => {
    const unavailable = { code: "public_profile_unavailable", status: 404 };
    await expect(resolvePublishedPublicBookingProfile(env.CALENDAR_DB, "missing-profile"))
      .rejects.toMatchObject(unavailable);
    await expect(resolvePublishedPublicBookingProfile(env.CALENDAR_DB, "Malformed-Profile"))
      .rejects.toMatchObject(unavailable);

    await seedPublishedPage({
      storedPublicSnapshot: {
        ...publicSnapshot,
        durationMinutes: "private-calendar-id",
      },
    });
    await expect(resolvePublishedPublicBookingProfile(env.CALENDAR_DB, "alex-morgan"))
      .rejects.toMatchObject({ code: "published_page_invalid", status: 503 });
    await env.CALENDAR_DB.prepare(
      "UPDATE public_booking_profiles SET status = 'unpublished' WHERE id = 'profile-public-read'",
    ).run();
    await expect(resolvePublishedPublicBookingProfile(env.CALENDAR_DB, "alex-morgan"))
      .rejects.toMatchObject(unavailable);
  });
});

describe("published page resolution", () => {
  it("projects only guest-safe fields and keeps routing scope internal", async () => {
    await seedPublishedPage();
    const resolved = await resolvePublishedPublicBookingPage(
      env.CALENDAR_DB.withSession("first-primary"),
      "alex-morgan",
      "30min",
    );
    expect(resolved.privateSnapshot).toMatchObject({
      workspaceId: privateSnapshot.workspaceId,
      principalId: privateSnapshot.principalId,
      conflictCalendarIds: privateSnapshot.conflictCalendarIds,
    });
    const projected = projectPublicBookingPage(resolved, {
      baseUrl: "https://cal.with-tap.ai",
      turnstileSiteKey: "turnstile-site-key",
      now,
    });
    expect(projected).toMatchObject({
      schemaVersion: "tap.calendar.public-page.v1",
      pageRevision: revisionId,
      canonicalUrl: "https://cal.with-tap.ai/alex-morgan/30min",
      profile: { displayName: "Alex Morgan", initials: "AM" },
      bookingWindow: { firstDate: "2026-08-16", lastDate: "2026-10-14" },
    });
    expect(JSON.stringify(projected)).not.toMatch(
      /workspace-public-read|principal-public-read|calendar-destination-read|calendar-conflict-read/u,
    );
  });

  it("fails closed when the stored private owner differs from the profile owner", async () => {
    await seedPublishedPage({
      storedPrivateSnapshot: { ...privateSnapshot, principalId: "principal-attacker" },
    });
    await expect(resolvePublishedPublicBookingPage(
      env.CALENDAR_DB,
      "alex-morgan",
      "30min",
    )).rejects.toMatchObject({ code: "published_page_invalid", status: 503 });
  });

  it("uses one generic unavailable error and fences a revision changed after resolution", async () => {
    await expect(resolvePublishedPublicBookingPage(env.CALENDAR_DB, "missing-profile", "30min"))
      .rejects.toMatchObject({ code: "public_page_unavailable", status: 404 });
    await seedPublishedPage();
    const resolved = await resolvePublishedPublicBookingPage(env.CALENDAR_DB, "alex-morgan", "30min");
    await env.CALENDAR_DB.prepare(
      `INSERT INTO public_booking_page_revisions (
         id, page_id, snapshot_hash, public_snapshot_json, private_snapshot_json, created_at
       ) VALUES ('public-revision-read-2', 'page-public-read', 'snapshot-hash-public-read-2', ?, ?, ?)`,
    ).bind(JSON.stringify(publicSnapshot), JSON.stringify(privateSnapshot), "2026-08-16T11:05:00.000Z").run();
    await env.CALENDAR_DB.prepare(
      "UPDATE public_booking_pages SET current_revision_id = 'public-revision-read-2' WHERE id = 'page-public-read'",
    ).run();
    await expect(assertPublicPageStillCurrent(env.CALENDAR_DB, resolved))
      .rejects.toMatchObject({ code: "public_page_changed", status: 409 });
  });
});

describe("public availability generation", () => {
  it("applies busy buffers and returns an exact provider query window", () => {
    const resolved = resolvedFixture();
    const request = query({ timeZone: "America/Los_Angeles" });
    const window = availabilityQueryWindow(resolved, request, now);
    expect(window).toEqual({
      timeMin: "2026-08-17T12:55:00.000Z",
      timeMax: "2026-08-31T15:10:00.000Z",
    });
    const dates = generatePublicAvailabilityCandidates({
      resolved,
      query: request,
      busyIntervals: [{
        start: "2026-08-17T13:45:00.000Z",
        end: "2026-08-17T14:15:00.000Z",
      }],
      now,
    });
    expect(dates.find(date => date.date === "2026-08-17")).toEqual({
      date: "2026-08-17",
      slots: [
        { start: "2026-08-17T14:30:00.000Z", end: "2026-08-17T15:00:00.000Z" },
        { start: "2026-08-17T13:00:00.000Z", end: "2026-08-17T13:30:00.000Z" },
      ],
    });
  });

  it("uses a travel override's IANA zone and groups its instants by viewer month/date", () => {
    const dates = generatePublicAvailabilityCandidates({
      resolved: resolvedFixture(),
      query: query({ timeZone: "America/Los_Angeles" }),
      busyIntervals: [],
      now,
    });
    expect(dates.find(date => date.date === "2026-08-21")?.slots).toEqual([
      { start: "2026-08-22T00:00:00.000Z", end: "2026-08-22T00:30:00.000Z" },
      { start: "2026-08-22T00:30:00.000Z", end: "2026-08-22T01:00:00.000Z" },
    ]);
  });

  it("resolves non-hour IANA offsets without using the Worker process zone", () => {
    const kathmanduPrivate: PrivatePageSnapshot = {
      ...privateSnapshot,
      schedule: {
        ...privateSnapshot.schedule,
        timeZone: "Asia/Kathmandu",
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 0,
        windows: [{ day: 1, enabled: true, start: "09:00", end: "10:00" }],
        overrides: [],
      },
    };
    const dates = generatePublicAvailabilityCandidates({
      resolved: resolvedFixture({ private: kathmanduPrivate }),
      query: query({ timeZone: "UTC" }),
      busyIntervals: [],
      now,
    });
    expect(dates.find(date => date.date === "2026-08-17")?.slots).toEqual([
      { start: "2026-08-17T03:15:00.000Z", end: "2026-08-17T03:45:00.000Z" },
      { start: "2026-08-17T03:45:00.000Z", end: "2026-08-17T04:15:00.000Z" },
    ]);
  });

  it("skips spring-forward gaps and keeps elapsed duration inside the wall-clock window", () => {
    const springPrivate: PrivatePageSnapshot = {
      ...privateSnapshot,
      schedule: {
        ...privateSnapshot.schedule,
        timeZone: "America/New_York",
        bookingHorizonDays: 14,
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 0,
        windows: [{ day: 0, enabled: true, start: "00:00", end: "05:00" }],
        overrides: [],
      },
    };
    const dates = generatePublicAvailabilityCandidates({
      resolved: resolvedFixture({ private: springPrivate }),
      query: query({ month: "2026-03-01", timeZone: "America/New_York" }),
      busyIntervals: [],
      now: Date.parse("2026-03-01T12:00:00.000Z"),
    });
    expect(dates.find(date => date.date === "2026-03-08")?.slots.map(slot => slot.start)).toEqual([
      "2026-03-08T05:00:00.000Z",
      "2026-03-08T05:30:00.000Z",
      "2026-03-08T06:00:00.000Z",
      "2026-03-08T07:00:00.000Z",
      "2026-03-08T07:30:00.000Z",
      "2026-03-08T08:00:00.000Z",
      "2026-03-08T08:30:00.000Z",
    ]);

    const hourMeeting = { ...publicSnapshot, durationMinutes: 60 };
    const narrowSpringPrivate: PrivatePageSnapshot = {
      ...springPrivate,
      schedule: {
        ...springPrivate.schedule,
        windows: [{ day: 0, enabled: true, start: "01:30", end: "03:00" }],
      },
    };
    const narrowDates = generatePublicAvailabilityCandidates({
      resolved: resolvedFixture({ public: hourMeeting, private: narrowSpringPrivate }),
      query: query({ month: "2026-03-01", timeZone: "America/New_York" }),
      busyIntervals: [],
      now: Date.parse("2026-03-01T12:00:00.000Z"),
    });
    expect(narrowDates.find(date => date.date === "2026-03-08")).toBeUndefined();
  });

  it("rejects slots whose local clock crosses a fall-back fold", () => {
    const fallPrivate: PrivatePageSnapshot = {
      ...privateSnapshot,
      schedule: {
        ...privateSnapshot.schedule,
        timeZone: "America/New_York",
        bookingHorizonDays: 14,
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 0,
        windows: [{ day: 0, enabled: true, start: "00:00", end: "04:00" }],
        overrides: [],
      },
    };
    const dates = generatePublicAvailabilityCandidates({
      resolved: resolvedFixture({ private: fallPrivate }),
      query: query({ month: "2026-11-01", timeZone: "America/New_York" }),
      busyIntervals: [],
      now: Date.parse("2026-10-25T12:00:00.000Z"),
    });
    const starts = dates.find(date => date.date === "2026-11-01")?.slots.map(slot => slot.start);
    expect(starts).toContain("2026-11-01T05:00:00.000Z");
    expect(starts).not.toContain("2026-11-01T05:30:00.000Z");
    expect(starts).toContain("2026-11-01T07:00:00.000Z");
  });

  it("enforces notice and host-calendar horizon without silently truncating valid slots", () => {
    const noticePrivate: PrivatePageSnapshot = {
      ...privateSnapshot,
      schedule: {
        ...privateSnapshot.schedule,
        minimumNoticeMinutes: 60,
        bookingHorizonDays: 1,
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 0,
        windows: [{ day: 1, enabled: true, start: "09:00", end: "12:00" }],
        overrides: [],
      },
    };
    const dates = generatePublicAvailabilityCandidates({
      resolved: resolvedFixture({ private: noticePrivate }),
      query: query(),
      busyIntervals: [],
      now: Date.parse("2026-08-17T13:15:00.000Z"),
    });
    expect(dates).toEqual([{
      date: "2026-08-17",
      slots: [
        { start: "2026-08-17T14:30:00.000Z", end: "2026-08-17T15:00:00.000Z" },
        { start: "2026-08-17T15:00:00.000Z", end: "2026-08-17T15:30:00.000Z" },
        { start: "2026-08-17T15:30:00.000Z", end: "2026-08-17T16:00:00.000Z" },
      ],
    }]);

    const fullDayPrivate: PrivatePageSnapshot = {
      ...noticePrivate,
      schedule: {
        ...noticePrivate.schedule,
        minimumNoticeMinutes: 0,
        windows: [{ day: 1, enabled: true, start: "00:00", end: "23:59" }],
      },
    };
    const bounded = generatePublicAvailabilityCandidates({
      resolved: resolvedFixture({ public: { ...publicSnapshot, durationMinutes: 5 }, private: fullDayPrivate }),
      query: query(),
      busyIntervals: [],
      now: Date.parse("2026-08-17T04:00:00.000Z"),
    });
    expect(bounded[0]?.slots).toHaveLength(48);
    // Preferred times are offered first; the rest remain bookable.
    expect(bounded[0]?.slots[0]).toEqual({
      start: "2026-08-17T14:00:00.000Z",
      end: "2026-08-17T14:05:00.000Z",
    });
    expect(bounded[0]?.slots).toContainEqual({
      start: "2026-08-17T04:00:00.000Z",
      end: "2026-08-17T04:05:00.000Z",
    });
  });

  it("revalidates the exact slot against notice, windows, horizon, and travel overrides", () => {
    const noticePage = resolvedFixture({
      private: {
        ...privateSnapshot,
        schedule: {
          ...privateSnapshot.schedule,
          minimumNoticeMinutes: 1_500,
          windows: [{ day: 1, enabled: true, start: "09:00", end: "10:00" }],
          overrides: [],
        },
      },
    });
    const exactSlot = {
      resolved: noticePage,
      start: "2026-08-17T13:00:00.000Z",
      end: "2026-08-17T13:30:00.000Z",
    };
    expect(publicSlotSatisfiesPublishedSchedule({ ...exactSlot, now })).toBe(true);
    expect(publicSlotSatisfiesPublishedSchedule({
      ...exactSlot,
      now: now + MILLISECONDS_PER_MINUTE,
    })).toBe(false);

    const travelPage = resolvedFixture({
      private: {
        ...privateSnapshot,
        schedule: {
          ...privateSnapshot.schedule,
          windows: [{ day: 1, enabled: true, start: "09:00", end: "17:00" }],
          overrides: [{
            date: "2026-08-17",
            label: "Los Angeles trip",
            available: true,
            timeZone: "America/Los_Angeles",
            start: "09:00",
            end: "10:00",
          }],
        },
      },
    });
    expect(publicSlotSatisfiesPublishedSchedule({
      resolved: travelPage,
      start: "2026-08-17T16:00:00.000Z",
      end: "2026-08-17T16:30:00.000Z",
      now,
    })).toBe(true);
    // The date override replaces the ordinary New York weekly window.
    expect(publicSlotSatisfiesPublishedSchedule({
      resolved: travelPage,
      start: "2026-08-17T13:00:00.000Z",
      end: "2026-08-17T13:30:00.000Z",
      now,
    })).toBe(false);

    const unavailablePage = resolvedFixture({
      private: {
        ...privateSnapshot,
        schedule: {
          ...privateSnapshot.schedule,
          overrides: [{
            date: "2026-08-17",
            label: "Out of office",
            available: false,
            timeZone: "America/New_York",
          }],
        },
      },
    });
    expect(publicSlotSatisfiesPublishedSchedule({
      resolved: unavailablePage,
      start: "2026-08-17T13:00:00.000Z",
      end: "2026-08-17T13:30:00.000Z",
      now,
    })).toBe(false);

    const outsideHorizonPage = resolvedFixture({
      private: {
        ...privateSnapshot,
        schedule: { ...privateSnapshot.schedule, bookingHorizonDays: 1 },
      },
    });
    expect(publicSlotSatisfiesPublishedSchedule({
      resolved: outsideHorizonPage,
      start: "2026-08-17T13:00:00.000Z",
      end: "2026-08-17T13:30:00.000Z",
      now,
    })).toBe(false);
  });
});

describe("public slot tokens", () => {
  it("signs only the six public claims, verifies them, and rejects tampering or expiry", async () => {
    const claims = {
      v: 1 as const,
      revisionId,
      start: "2026-08-17T13:00:00.000Z",
      end: "2026-08-17T13:30:00.000Z",
      iat: 1_787_000_000,
      exp: 1_787_000_300,
    };
    const token = await signPublicSlotToken(signingKey, claims);
    const payload = token.split(".")[0]!;
    const decoded = JSON.parse(atob(
      payload.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - payload.length % 4) % 4),
    )) as Record<string, unknown>;
    expect(Object.keys(decoded).sort()).toEqual(["end", "exp", "iat", "revisionId", "start", "v"]);
    expect(JSON.stringify(decoded)).not.toMatch(/workspace|principal|calendar/iu);
    await expect(verifyPublicSlotToken(signingKey, token, { now: claims.iat * 1_000 }))
      .resolves.toEqual(claims);
    const [payloadPart, signaturePart] = token.split(".");
    const tamperedPayload = `${payloadPart!.slice(0, -1)}${payloadPart!.endsWith("A") ? "B" : "A"}`;
    await expect(verifyPublicSlotToken(signingKey, `${tamperedPayload}.${signaturePart}`, {
      now: claims.iat * 1_000,
    })).rejects.toMatchObject({ code: "slot_token_invalid" });
    await expect(verifyPublicSlotToken(signingKey, token, { now: claims.exp * 1_000 }))
      .rejects.toMatchObject({ code: "slot_token_expired", status: 409 });
  });

  it("builds tokens bound to the immutable revision and shared response expiry", async () => {
    const result = await buildPublicAvailability(
      resolvedFixture(),
      query(),
      [],
      signingKey,
      now,
    );
    expect(result).toMatchObject({
      schemaVersion: "tap.calendar.public-availability.v1",
      pageRevision: revisionId,
      viewerTimeZone: "America/New_York",
      month: "2026-08-01",
      generatedAt: "2026-08-16T12:00:00.000Z",
      expiresAt: "2026-08-16T12:05:00.000Z",
    });
    const slot = result.dates.flatMap(date => date.slots)[0]!;
    await expect(verifyPublicSlotToken(signingKey, slot.token, { now }))
      .resolves.toMatchObject({
        revisionId,
        start: slot.start,
        end: slot.end,
      });
  });
});
