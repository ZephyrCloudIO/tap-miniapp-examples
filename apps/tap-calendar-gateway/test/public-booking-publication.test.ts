import { resolvePublishedPublicBookingPage, assertPublicPageStillCurrent } from "../src/public-booking-read";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  parsePublicBookingProfileRename,
  renamePublicBookingProfile,
  parsePublicBookingProfilePublication,
  parsePublicBookingProfileUnpublication,
  publishPublicBookingProfile,
  PublicBookingPublicationError,
  unpublishPublicBookingProfile,
} from "../src/public-booking-publication";

const now = "2026-08-16T18:00:00.000Z";
const scope = { workspace: "workspace-public", principal: "user-public" };

const page = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: "tap.calendar.publication.v1",
  sourceProfileId: "profile-source-1",
  profileSlug: "alex-morgan",
  displayName: "Alex Morgan",
  ownerType: "individual",
  sourceEventTypeId: "event-type-source-1",
  eventTypeSlug: "30min",
  title: "30 minute meeting",
  description: "Pick a time that works for you.",
  durationMinutes: 30,
  approvalRequired: false,
  location: "google-meet",
  destinationCalendarId: "calendar-destination",
  conflictCalendarIds: ["calendar-conflict", "calendar-destination"],
  sourceAvailabilityScheduleId: "availability-1",
  schedule: {
    timeZone: "America/New_York",
    preferredStart: "10:00",
    preferredEnd: "15:00",
    bufferBeforeMinutes: 5,
    bufferAfterMinutes: 10,
    minimumNoticeMinutes: 120,
    bookingHorizonDays: 60,
    windows: [
      { day: 1, enabled: true, start: "09:00", end: "12:00" },
      { day: 1, enabled: true, start: "13:00", end: "17:00" },
      { day: 2, enabled: true, start: "09:00", end: "17:00" },
    ],
    overrides: [{
      date: "2026-08-22",
      label: "London trip",
      available: true,
      timeZone: "Europe/London",
      start: "10:00",
      end: "15:00",
    }],
  },
  ...overrides,
});

const profilePublication = (options: {
  expectedGeneration?: number;
  pages?: readonly Record<string, unknown>[];
  identity?: Readonly<Record<string, unknown>>;
} = {}) => {
  const publications = options.pages ?? [page()];
  const first = publications[0] ?? page();
  return parsePublicBookingProfilePublication({
    schemaVersion: "tap.calendar.profile-publication.v1",
    sourceProfileId: first.sourceProfileId,
    profileSlug: first.profileSlug,
    displayName: first.displayName,
    ownerType: first.ownerType,
    ...options.identity,
    expectedGeneration: options.expectedGeneration ?? 0,
    publications,
  });
};

async function publish(options: {
  input?: ReturnType<typeof profilePublication>;
  requestScope?: typeof scope;
  publishedAt?: string;
} = {}) {
  return publishPublicBookingProfile({
    database: env.CALENDAR_DB,
    scope: options.requestScope ?? scope,
    input: options.input ?? profilePublication(),
    publicBaseUrl: "https://cal.with-tap.ai",
    now: options.publishedAt ?? now,
  });
}

async function seedOwnedCalendars(options: {
  workspace?: string;
  principal?: string;
  suffix?: string;
} = {}) {
  const workspace = options.workspace ?? scope.workspace;
  const principal = options.principal ?? scope.principal;
  const suffix = options.suffix ?? "";
  const connectionId = `connection-google${suffix}`;
  const destinationId = `calendar-destination${suffix}`;
  const conflictId = `calendar-conflict${suffix}`;
  await env.CALENDAR_DB.batch([
    env.CALENDAR_DB.prepare(
      `INSERT INTO calendar_connections (
         id, workspace_id, principal_id, provider, mode, label, status,
         credential_ciphertext, token_expires_at, created_at, updated_at
       ) VALUES (?, ?, ?, 'google', 'oauth', 'alex@example.com', 'connected',
                 'ciphertext', ?, ?, ?)`,
    ).bind(connectionId, workspace, principal, "2026-08-16T20:00:00.000Z", now, now),
    env.CALENDAR_DB.prepare(
      `INSERT INTO provider_calendars (
         id, connection_id, provider_calendar_id, name, color, role, writable,
         freshness, is_primary, raw_json, created_at, updated_at
       ) VALUES (?, ?, ?, 'Primary', '#6758e8', 'owner', 1, 'live', 1, '{}', ?, ?)`,
    ).bind(destinationId, connectionId, `${destinationId}@provider.test`, now, now),
    env.CALENDAR_DB.prepare(
      `INSERT INTO provider_calendars (
         id, connection_id, provider_calendar_id, name, color, role, writable,
         freshness, is_primary, raw_json, created_at, updated_at
       ) VALUES (?, ?, ?, 'Conflicts', '#10a875', 'owner', 1, 'live', 0, '{}', ?, ?)`,
    ).bind(conflictId, connectionId, `${conflictId}@provider.test`, now, now),
  ]);
  return { destinationId, conflictId };
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
    env.CALENDAR_DB.prepare("DELETE FROM provider_calendars"),
    env.CALENDAR_DB.prepare("DELETE FROM calendar_connections"),
  ]);
  await seedOwnedCalendars();
});

describe("public booking publication", () => {
  it("validates a bounded, internally consistent whole-profile snapshot", () => {
    const parsed = profilePublication();
    expect(parsed.expectedGeneration).toBe(0);
    expect(parsed).toMatchObject({
      sourceProfileId: "profile-source-1",
      profileSlug: "alex-morgan",
      displayName: "Alex Morgan",
      ownerType: "individual",
    });
    expect(parsed.publications[0]?.profileSlug).toBe("alex-morgan");
    expect(parsed.publications[0]?.schedule.overrides[0]).toMatchObject({
      date: "2026-08-22",
      timeZone: "Europe/London",
    });
    expect(profilePublication({ pages: [] })).toMatchObject({
      sourceProfileId: "profile-source-1",
      profileSlug: "alex-morgan",
      publications: [],
    });
  });

  it("requires explicit identity for an empty profile and derives it for legacy nonempty requests", () => {
    expect(() => parsePublicBookingProfilePublication({
      schemaVersion: "tap.calendar.profile-publication.v1",
      expectedGeneration: 0,
      publications: [],
    })).toThrowError(
      expect.objectContaining({ code: "invalid_publication" }),
    );
    const legacy = parsePublicBookingProfilePublication({
      schemaVersion: "tap.calendar.profile-publication.v1",
      expectedGeneration: 0,
      publications: [page()],
    });
    expect(legacy).toMatchObject({
      sourceProfileId: "profile-source-1",
      profileSlug: "alex-morgan",
      displayName: "Alex Morgan",
      ownerType: "individual",
    });
    expect(() => profilePublication({
      pages: [page(), page({ sourceProfileId: "different-profile", sourceEventTypeId: "event-2" })],
    })).toThrowError(expect.objectContaining({ code: "invalid_publication" }));
    expect(() => profilePublication({
      pages: [page({ profileSlug: "api" })],
    })).toThrowError(expect.objectContaining({ code: "profile_slug_reserved" }));
  });

  it("reserves and publishes an empty profile namespace without creating pages", async () => {
    const result = await publish({ input: profilePublication({ pages: [] }) });
    expect(result).toMatchObject({
      sourceProfileId: "profile-source-1",
      profileSlug: "alex-morgan",
      generation: 1,
      idempotentReplay: false,
      pages: [],
    });
    expect(await env.CALENDAR_DB.prepare(
      `SELECT source_profile_id, current_slug, display_name, owner_type,
              status, publication_generation
         FROM public_booking_profiles`,
    ).first()).toMatchObject({
      source_profile_id: "profile-source-1",
      current_slug: "alex-morgan",
      display_name: "Alex Morgan",
      owner_type: "individual",
      status: "published",
      publication_generation: 1,
    });
    const counts = await env.CALENDAR_DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM public_booking_profile_slugs) AS slugs,
         (SELECT COUNT(*) FROM public_booking_owner_profile_slots) AS owner_slots,
         (SELECT COUNT(*) FROM public_booking_profile_generations) AS generations,
         (SELECT COUNT(*) FROM public_booking_pages) AS pages,
         (SELECT COUNT(*) FROM public_booking_page_revisions) AS revisions`,
    ).first<{
      slugs: number;
      owner_slots: number;
      generations: number;
      pages: number;
      revisions: number;
    }>();
    expect(counts).toEqual({
      slugs: 1,
      owner_slots: 1,
      generations: 1,
      pages: 0,
      revisions: 0,
    });
  });

  it("replays an identical empty-profile claim and rejects a stale different claim", async () => {
    const input = profilePublication({ pages: [] });
    const first = await publish({ input });
    const replay = await publish({
      input,
      publishedAt: "2026-08-16T18:05:00.000Z",
    });
    expect(replay).toMatchObject({
      profileId: first.profileId,
      generation: 1,
      publishedAt: first.publishedAt,
      idempotentReplay: true,
      pages: [],
    });
    await expect(publish({
      input: profilePublication({
        pages: [],
        identity: { displayName: "A different profile name" },
      }),
      publishedAt: "2026-08-16T18:06:00.000Z",
    })).rejects.toMatchObject({
      code: "publication_conflict",
      status: 409,
      currentGeneration: 1,
    });
    expect(await env.CALENDAR_DB.prepare(
      "SELECT COUNT(*) AS count FROM public_booking_profile_generations",
    ).first<number>("count")).toBe(1);
  });

  it("prevents another owner from claiming an empty profile's reserved slug", async () => {
    await publish({ input: profilePublication({ pages: [] }) });
    const secondScope = { workspace: "workspace-other", principal: "user-other" };
    await expect(publish({
      requestScope: secondScope,
      input: profilePublication({
        pages: [],
        identity: {
          sourceProfileId: "profile-source-other",
          profileSlug: "alex-morgan",
          displayName: "Other Owner",
          ownerType: "individual",
        },
      }),
    })).rejects.toMatchObject({
      code: "profile_slug_unavailable",
      status: 409,
    });
    expect(await env.CALENDAR_DB.prepare(
      "SELECT COUNT(*) AS count FROM public_booking_profiles",
    ).first<number>("count")).toBe(1);
  });

  it("adds pages to an empty published profile and later accepts an empty authoritative page set", async () => {
    const empty = await publish({ input: profilePublication({ pages: [] }) });
    const populated = await publish({
      input: profilePublication({ expectedGeneration: empty.generation }),
      publishedAt: "2026-08-16T18:10:00.000Z",
    });
    expect(populated).toMatchObject({
      profileId: empty.profileId,
      generation: 2,
      idempotentReplay: false,
      pages: [{
        sourceEventTypeId: "event-type-source-1",
        canonicalUrl: "https://cal.with-tap.ai/alex-morgan/30min",
      }],
    });
    expect(await env.CALENDAR_DB.prepare(
      "SELECT COUNT(*) AS count FROM public_booking_page_revisions",
    ).first<number>("count")).toBe(1);

    const emptied = await publish({
      input: profilePublication({
        expectedGeneration: populated.generation,
        pages: [],
      }),
      publishedAt: "2026-08-16T18:15:00.000Z",
    });
    expect(emptied).toMatchObject({
      profileId: empty.profileId,
      generation: 3,
      idempotentReplay: false,
      pages: [],
    });
    expect(await env.CALENDAR_DB.prepare(
      "SELECT status FROM public_booking_pages",
    ).first<string>("status")).toBe("unpublished");
    expect(await env.CALENDAR_DB.prepare(
      "SELECT COUNT(*) AS count FROM public_booking_page_revisions",
    ).first<number>("count")).toBe(1);
  });

  it("persists multiple pages, immutable revisions, and guest-safe projections in one generation", async () => {
    const result = await publish({ input: profilePublication({ pages: [
      page(),
      page({
        sourceEventTypeId: "event-type-source-2",
        eventTypeSlug: "60min",
        title: "60 minute meeting",
        durationMinutes: 60,
      }),
    ] }) });
    expect(result).toMatchObject({
      generation: 1,
      idempotentReplay: false,
      profileSlug: "alex-morgan",
    });
    expect(result.pages.map(candidate => candidate.canonicalUrl)).toEqual([
      "https://cal.with-tap.ai/alex-morgan/30min",
      "https://cal.with-tap.ai/alex-morgan/60min",
    ]);
    expect(await env.CALENDAR_DB.prepare(
      "SELECT COUNT(*) AS count FROM public_booking_page_revisions",
    ).first<number>("count")).toBe(2);
    const revision = await env.CALENDAR_DB.prepare(
      "SELECT public_snapshot_json, private_snapshot_json FROM public_booking_page_revisions WHERE id = ?",
    ).bind(result.pages[0]!.revisionId).first<{
      public_snapshot_json: string;
      private_snapshot_json: string;
    }>();
    expect(JSON.stringify(JSON.parse(revision!.public_snapshot_json))).not.toMatch(
      /calendar-destination|workspace-public|user-public/u,
    );
    expect(JSON.parse(revision!.private_snapshot_json)).toMatchObject({
      workspaceId: scope.workspace,
      principalId: scope.principal,
      destinationCalendarId: "calendar-destination",
    });
  });

  it("replays an ambiguous identical retry without advancing its generation", async () => {
    const input = profilePublication();
    const first = await publish({ input });
    const replay = await publish({ input, publishedAt: "2026-08-16T18:05:00.000Z" });
    expect(replay.generation).toBe(first.generation);
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.pages[0]?.revisionId).toBe(first.pages[0]?.revisionId);
    expect(await env.CALENDAR_DB.prepare(
      "SELECT COUNT(*) AS count FROM public_booking_profile_generations",
    ).first<number>("count")).toBe(1);
  });

  it("rejects a stale different writer without changing routing or revisions", async () => {
    const first = await publish();
    const second = await publish({
      input: profilePublication({
        expectedGeneration: first.generation,
        pages: [page({ title: "Updated title" })],
      }),
      publishedAt: "2026-08-16T18:01:00.000Z",
    });
    await expect(publish({
      input: profilePublication({
        expectedGeneration: first.generation,
        pages: [page({ title: "Stale title" })],
      }),
      publishedAt: "2026-08-16T18:02:00.000Z",
    })).rejects.toMatchObject({ code: "publication_conflict", status: 409 });
    expect(await env.CALENDAR_DB.prepare(
      "SELECT publication_generation FROM public_booking_profiles",
    ).first<number>("publication_generation")).toBe(second.generation);
    expect(await env.CALENDAR_DB.prepare(
      "SELECT COUNT(*) AS count FROM public_booking_page_revisions",
    ).first<number>("count")).toBe(2);
  });

  it("serializes concurrent writers that claim the same profile generation", async () => {
    const first = await publish();
    const contenders = await Promise.allSettled([
      publish({
        input: profilePublication({
          expectedGeneration: first.generation,
          pages: [page({ title: "Writer A" })],
        }),
        publishedAt: "2026-08-16T18:03:00.000Z",
      }),
      publish({
        input: profilePublication({
          expectedGeneration: first.generation,
          pages: [page({ title: "Writer B" })],
        }),
        publishedAt: "2026-08-16T18:03:01.000Z",
      }),
    ]);
    expect(contenders.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const rejected = contenders.find(result => result.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({ code: "publication_conflict", currentGeneration: 2 }),
    });
    expect(await env.CALENDAR_DB.prepare(
      "SELECT publication_generation FROM public_booking_profiles",
    ).first<number>("publication_generation")).toBe(2);
    expect(await env.CALENDAR_DB.prepare(
      "SELECT COUNT(*) AS count FROM public_booking_profile_generations",
    ).first<number>("count")).toBe(2);
  });

  it("returns a typed conflict when concurrent first publishes create the same source profile", async () => {
    const contenders = await Promise.allSettled([
      publish({ input: profilePublication({ pages: [page({ title: "First writer" })] }) }),
      publish({ input: profilePublication({ pages: [page({ title: "Second writer" })] }) }),
    ]);
    expect(contenders.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(contenders.find(result => result.status === "rejected")).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({
        code: "publication_conflict",
        currentGeneration: 1,
      }),
    });
    expect(await env.CALENDAR_DB.prepare(
      "SELECT COUNT(*) AS count FROM public_booking_profiles",
    ).first<number>("count")).toBe(1);
    expect(await env.CALENDAR_DB.prepare(
      "SELECT COUNT(*) AS count FROM public_booking_profile_slugs",
    ).first<number>("count")).toBe(1);
  });

  it("treats the submitted page set as authoritative and unpublishes omissions atomically", async () => {
    const first = await publish({ input: profilePublication({ pages: [
      page(),
      page({ sourceEventTypeId: "event-2", eventTypeSlug: "60min", durationMinutes: 60 }),
    ] }) });
    const second = await publish({
      input: profilePublication({ expectedGeneration: first.generation, pages: [page()] }),
      publishedAt: "2026-08-16T18:10:00.000Z",
    });
    expect(second.generation).toBe(2);
    const rows = await env.CALENDAR_DB.prepare(
      "SELECT current_slug, status FROM public_booking_pages ORDER BY current_slug",
    ).all<{ current_slug: string; status: string }>();
    expect(rows.results).toEqual([
      { current_slug: "30min", status: "published" },
      { current_slug: "60min", status: "unpublished" },
    ]);
    const offlinePage = await env.CALENDAR_DB.prepare(
      "SELECT id, current_revision_id FROM public_booking_pages WHERE current_slug = '60min'",
    ).first<{ id: string; current_revision_id: string }>();
    const restored = await publish({
      input: profilePublication({ expectedGeneration: second.generation, pages: [
        page(), page({ sourceEventTypeId: "event-2", eventTypeSlug: "60min", durationMinutes: 60 }),
      ] }),
      publishedAt: "2026-08-16T18:20:00.000Z",
    });
    expect(restored.pages.find(page => page.eventTypeSlug === "60min")?.pageId).toBe(offlinePage!.id);
    expect(await env.CALENDAR_DB.prepare(
      "SELECT status FROM public_booking_pages WHERE id = ?",
    ).bind(offlinePage!.id).first<string>("status")).toBe("published");
    // Existing bookings can still reference the old immutable revision.
    expect(await env.CALENDAR_DB.prepare(
      "SELECT page_id FROM public_booking_page_revisions WHERE id = ?",
    ).bind(offlinePage!.current_revision_id).first<string>("page_id")).toBe(offlinePage!.id);
  });

  it("requires explicit profile renaming and blocks global takeover", async () => {
    await publish();
    await expect(publish({
      input: profilePublication({
        expectedGeneration: 1,
        pages: [page({ profileSlug: "alex-calendar" })],
      }),
    })).rejects.toMatchObject({ code: "profile_slug_immutable" });
    await expect(publish({
      input: profilePublication({
        expectedGeneration: 1,
        pages: [page({ eventTypeSlug: "meeting" })],
      }),
    })).rejects.toMatchObject({ code: "event_type_slug_immutable" });

    const secondScope = { workspace: "workspace-other", principal: "user-other" };
    const calendars = await seedOwnedCalendars({ ...secondScope, suffix: "-other" });
    const takeover = profilePublication({ pages: [page({
      sourceProfileId: "profile-other",
      sourceEventTypeId: "event-other",
      destinationCalendarId: calendars.destinationId,
      conflictCalendarIds: [calendars.conflictId, calendars.destinationId],
    })] });
    await expect(publish({ input: takeover, requestScope: secondScope })).rejects.toMatchObject({
      code: "profile_slug_unavailable",
      status: 409,
    } satisfies Partial<PublicBookingPublicationError>);
  });

  it("does not create a profile when any page fails calendar ownership validation", async () => {
    await expect(publish({ input: profilePublication({ pages: [
      page(),
      page({
        sourceEventTypeId: "event-2",
        eventTypeSlug: "60min",
        destinationCalendarId: "calendar-not-owned",
      }),
    ] }) })).rejects.toMatchObject({ code: "calendar_scope_denied" });
    expect(await env.CALENDAR_DB.prepare(
      "SELECT COUNT(*) AS count FROM public_booking_profiles",
    ).first<number>("count")).toBe(0);
    expect(await env.CALENDAR_DB.prepare(
      "SELECT COUNT(*) AS count FROM public_booking_profile_slugs",
    ).first<number>("count")).toBe(0);
  });

  it("requires the Destination Calendar in the conflict set", async () => {
    await expect(publish({
      input: profilePublication({ pages: [page({
        conflictCalendarIds: ["calendar-conflict"],
      })] }),
    })).rejects.toMatchObject({
      code: "destination_conflict_required",
      status: 400,
    });
    expect(await env.CALENDAR_DB.prepare(
      "SELECT COUNT(*) AS count FROM public_booking_profiles",
    ).first<number>("count")).toBe(0);
  });

  it("rejects conflict calendars without connected Google OAuth authority", async () => {
    await env.CALENDAR_DB.batch([
      env.CALENDAR_DB.prepare(
        `INSERT INTO calendar_connections (
           id, workspace_id, principal_id, provider, mode, label, status,
           credential_ciphertext, token_expires_at, created_at, updated_at
         ) VALUES ('connection-local-conflict', ?, ?, 'google', 'local',
                   'Local conflicts', 'connected', NULL, NULL, ?, ?)`,
      ).bind(scope.workspace, scope.principal, now, now),
      env.CALENDAR_DB.prepare(
        "UPDATE provider_calendars SET connection_id = 'connection-local-conflict' WHERE id = 'calendar-conflict'",
      ),
    ]);
    await expect(publish()).rejects.toMatchObject({
      code: "conflict_calendar_unavailable",
      status: 409,
    });
    expect(await env.CALENDAR_DB.prepare(
      "SELECT COUNT(*) AS count FROM public_booking_profiles",
    ).first<number>("count")).toBe(0);
  });

  it("enforces the permanent twenty-profile reservation quota per owner", async () => {
    for (let index = 1; index <= 20; index += 1) {
      const suffix = String(index).padStart(2, "0");
      await publish({
        input: profilePublication({
          pages: [page({
            sourceProfileId: `profile-source-${suffix}`,
            profileSlug: `profile-${suffix}`,
            sourceEventTypeId: `event-source-${suffix}`,
          })],
        }),
      });
    }
    await expect(publish({
      input: profilePublication({
        pages: [page({
          sourceProfileId: "profile-source-21",
          profileSlug: "profile-21",
          sourceEventTypeId: "event-source-21",
        })],
      }),
    })).rejects.toMatchObject({
      code: "publication_profile_quota_exceeded",
      status: 409,
    });
    expect(await env.CALENDAR_DB.prepare(
      "SELECT COUNT(*) AS count FROM public_booking_profiles",
    ).first<number>("count")).toBe(20);
    expect(await env.CALENDAR_DB.prepare(
      "SELECT COUNT(*) AS count FROM public_booking_owner_profile_slots",
    ).first<number>("count")).toBe(20);
  });

  it("keeps at most fifty permanent Event Type slug reservations per profile", async () => {
    const firstPages = Array.from({ length: 50 }, (_, index) => page({
      sourceEventTypeId: `event-source-${index + 1}`,
      eventTypeSlug: `event-${index + 1}`,
    }));
    const first = await publish({ input: profilePublication({ pages: firstPages }) });
    await expect(publish({
      input: profilePublication({
        expectedGeneration: first.generation,
        pages: [page({
          sourceEventTypeId: "event-source-51",
          eventTypeSlug: "event-51",
        })],
      }),
    })).rejects.toMatchObject({
      code: "publication_page_quota_exceeded",
      status: 409,
    });
    expect(await env.CALENDAR_DB.prepare(
      "SELECT COUNT(*) AS count FROM public_booking_pages",
    ).first<number>("count")).toBe(50);
    expect(await env.CALENDAR_DB.prepare(
      "SELECT COUNT(*) AS count FROM public_booking_page_slugs",
    ).first<number>("count")).toBe(50);
  });

  it("unpublishes every page with CAS and replays the same desired result safely", async () => {
    const published = await publish();
    const input = parsePublicBookingProfileUnpublication({
      schemaVersion: "tap.calendar.profile-unpublication.v1",
      sourceProfileId: "profile-source-1",
      expectedGeneration: published.generation,
    });
    const result = await unpublishPublicBookingProfile({
      database: env.CALENDAR_DB,
      scope,
      input,
      now: "2026-08-16T19:00:00.000Z",
    });
    expect(result).toMatchObject({ generation: 2, idempotentReplay: false });
    const replay = await unpublishPublicBookingProfile({
      database: env.CALENDAR_DB,
      scope,
      input,
      now: "2026-08-16T19:01:00.000Z",
    });
    expect(replay).toMatchObject({
      generation: 2,
      idempotentReplay: true,
      unpublishedAt: result.unpublishedAt,
    });
    expect(await env.CALENDAR_DB.prepare(
      "SELECT status FROM public_booking_pages",
    ).first<string>("status")).toBe("unpublished");
    expect(await env.CALENDAR_DB.prepare(
      "SELECT COUNT(*) AS count FROM public_booking_profile_slugs",
    ).first<number>("count")).toBe(1);
  });
});

const rename = (options: { slug?: string; previous?: string; generation?: number; requestScope?: typeof scope; source?: string } = {}) => renamePublicBookingProfile({
  database: env.CALENDAR_DB, scope: options.requestScope ?? scope,
  input: parsePublicBookingProfileRename({ schemaVersion: "tap.calendar.profile-rename.v1", sourceProfileId: options.source ?? "profile-source-1",
    previousSlug: options.previous ?? "alex-morgan", profileSlug: options.slug ?? "alex-calendar", expectedGeneration: options.generation ?? 1 }),
  publicBaseUrl: "https://cal.with-tap.ai", now: "2026-08-16T18:30:00.000Z",
});

describe("booking profile address changes", () => {
  it("moves the routing address, preserves page identity, and releases the old name for another owner", async () => {
    const original = await publish();
    const oldPage = await resolvePublishedPublicBookingPage(env.CALENDAR_DB, "alex-morgan", "30min");
    const changed = await rename();
    expect(changed).toMatchObject({ generation: 2, reservedSlug: "alex-calendar", status: "published" });
    expect(changed.eventTypes[0]?.revisionId).toBe(original.pages[0]?.revisionId);
    const newPage = await resolvePublishedPublicBookingPage(env.CALENDAR_DB, "alex-calendar", "30min");
    expect(newPage).toMatchObject({ pageId: oldPage.pageId, revisionId: oldPage.revisionId });
    await expect(resolvePublishedPublicBookingPage(env.CALENDAR_DB, "alex-morgan", "30min")).rejects.toMatchObject({ status: 404 });
    await expect(assertPublicPageStillCurrent(env.CALENDAR_DB, oldPage)).rejects.toMatchObject({ code: "public_page_changed" });
    expect(await env.CALENDAR_DB.prepare("SELECT canonical_url FROM public_booking_pages WHERE id = ?").bind(oldPage.pageId).first<string>("canonical_url")).toBe("https://cal.with-tap.ai/alex-calendar/30min");
    const other = { workspace: "another-workspace", principal: "another-person" };
    const claimed = await publish({ requestScope: other, input: profilePublication({ pages: [], identity: { sourceProfileId: "other-profile" } }) });
    expect(claimed.profileSlug).toBe("alex-morgan");
    expect(claimed.profileId).not.toBe(original.profileId);
    await expect(rename({ previous: "alex-calendar", slug: "alex-morgan", generation: 2 })).rejects.toMatchObject({ code: "profile_slug_unavailable" });
  });

  it("keeps offline profiles offline and replays a completed request after a lost response", async () => {
    await publish();
    await unpublishPublicBookingProfile({ database: env.CALENDAR_DB, scope,
      input: { schemaVersion: "tap.calendar.profile-unpublication.v1", sourceProfileId: "profile-source-1", expectedGeneration: 1 } });
    const changed = await rename({ generation: 2 });
    expect(changed).toMatchObject({ status: "unpublished", generation: 3, eventTypes: [] });
    expect(await rename({ generation: 2 })).toEqual(changed);
    await expect(resolvePublishedPublicBookingPage(env.CALENDAR_DB, "alex-calendar", "30min")).rejects.toMatchObject({ status: 404 });
    const republished = await publish({ input: profilePublication({ expectedGeneration: 3, pages: [page({ profileSlug: "alex-calendar" })] }) });
    expect(republished.pages[0]?.canonicalUrl).toBe("https://cal.with-tap.ai/alex-calendar/30min");
  });

  it("rejects occupied names, stale generations, and other owners without releasing the current address", async () => {
    await publish();
    await publish({ input: profilePublication({ pages: [], identity: { sourceProfileId: "second-profile", profileSlug: "already-taken" } }) });
    await expect(rename({ slug: "already-taken" })).rejects.toMatchObject({ code: "profile_slug_unavailable" });
    await expect(rename({ generation: 0 })).rejects.toMatchObject({ code: "publication_conflict" });
    await expect(rename({ requestScope: { ...scope, principal: "other" } })).rejects.toMatchObject({ status: 404 });
    expect((await resolvePublishedPublicBookingPage(env.CALENDAR_DB, "alex-morgan", "30min")).profileSlug).toBe("alex-morgan");
    expect(() => parsePublicBookingProfileRename({ schemaVersion: "tap.calendar.profile-rename.v1", sourceProfileId: "profile-source-1", previousSlug: "alex-morgan", profileSlug: "api", expectedGeneration: 1 })).toThrowError(expect.objectContaining({ code: "profile_slug_reserved" }));
  });

  it("keeps the losing profile's address when two profiles request the same new name", async () => {
    await publish();
    await publish({ input: profilePublication({ pages: [], identity: { sourceProfileId: "second-profile", profileSlug: "second-owner" } }) });
    const attempts = await Promise.allSettled([
      rename({ slug: "shared-target" }),
      rename({ source: "second-profile", previous: "second-owner", slug: "shared-target" }),
    ]);
    expect(attempts.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const losingIndex = attempts.findIndex(result => result.status === "rejected");
    expect(attempts[losingIndex]).toMatchObject({ reason: { code: "profile_slug_unavailable" } });
    const oldSlug = losingIndex === 0 ? "alex-morgan" : "second-owner";
    expect(await env.CALENDAR_DB.prepare("SELECT COUNT(*) AS count FROM public_booking_profile_slugs WHERE slug = ?").bind(oldSlug).first<number>("count")).toBe(1);
    expect(await env.CALENDAR_DB.prepare("SELECT COUNT(*) AS count FROM public_booking_profile_slugs").first<number>("count")).toBe(2);
  });

  it("allows only one competing rename and keeps the winning address reserved", async () => {
    await publish();
    const results = await Promise.allSettled([rename({ slug: "first-name" }), rename({ slug: "second-name" })]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    const row = await env.CALENDAR_DB.prepare("SELECT current_slug, publication_generation FROM public_booking_profiles WHERE source_profile_id = 'profile-source-1'").first<{current_slug: string; publication_generation: number}>();
    expect(row!.publication_generation).toBe(2);
    expect(await env.CALENDAR_DB.prepare("SELECT slug FROM public_booking_profile_slugs").first<string>("slug")).toBe(row!.current_slug);
    expect(await env.CALENDAR_DB.prepare("SELECT COUNT(*) AS count FROM public_booking_publication_audit WHERE action = 'rename'").first<number>("count")).toBe(1);
  });
});
