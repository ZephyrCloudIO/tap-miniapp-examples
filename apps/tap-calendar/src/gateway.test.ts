import { describe, expect, it } from "@rstest/core";
import type { MiniAppHttpApi } from "@theaiplatform/miniapp-sdk/sdk";
import {
  CalendarGatewayError,
  calendarGatewayPrincipalAccess,
  calendarGatewayEventWindow,
  createCalendarGatewayClient,
  createFetchCalendarGatewayTransport,
  createTapCalendarGatewayTransport,
  isCalendarGatewayBookingCommit,
  isCalendarGatewayBookingResolution,
  isCalendarGatewayBookingStatus,
  PUBLIC_BOOKING_PROFILE_UNPUBLICATION_SCHEMA_VERSION,
  resolveCalendarGatewayUrl,
  type PublicBookingProfilePublicationInput,
  type CalendarGatewayTransport,
} from "./gateway";

const profilePublicationInput = (): PublicBookingProfilePublicationInput => ({
  schemaVersion: "tap.calendar.profile-publication.v1",
  sourceProfileId: "profile-source-1",
  profileSlug: "alex-morgan",
  displayName: "Alex Morgan",
  ownerType: "individual",
  expectedGeneration: 3,
  publications: [{
    schemaVersion: "tap.calendar.publication.v1",
    sourceProfileId: "profile-source-1",
    profileSlug: "alex-morgan",
    displayName: "Alex Morgan",
    ownerType: "individual",
    sourceEventTypeId: "event-type-source-1",
    eventTypeSlug: "30min",
    title: "30 Minute Meeting",
    description: "A short planning call.",
    durationMinutes: 30,
    approvalRequired: false,
    location: "google-meet",
    destinationCalendarId: "calendar-destination",
    conflictCalendarIds: ["calendar-conflicts", "calendar-destination"],
    sourceAvailabilityScheduleId: "availability-main",
    schedule: {
      timeZone: "America/New_York",
      preferredStart: "10:00",
      preferredEnd: "15:00",
      bufferBeforeMinutes: 10,
      bufferAfterMinutes: 15,
      minimumNoticeMinutes: 120,
      bookingHorizonDays: 60,
      windows: [{ day: 1, enabled: true, start: "09:00", end: "17:00" }],
      overrides: [{
        date: "2026-08-24",
        label: "Pacific travel",
        available: true,
        timeZone: "America/Los_Angeles",
        start: "10:00",
        end: "14:00",
      }],
    },
  }],
});

const profilePublicationReceipt = () => ({
  publication: {
    profileId: "public-profile-1",
    sourceProfileId: "profile-source-1",
    profileSlug: "alex-morgan",
    generation: 4,
    publishedAt: "2026-08-16T18:00:00.000Z",
    idempotentReplay: false,
    pages: [{
      profileId: "public-profile-1",
      pageId: "public-page-1",
      revisionId: "public-revision-1",
      sourceEventTypeId: "event-type-source-1",
      profileSlug: "alex-morgan",
      eventTypeSlug: "30min",
      canonicalUrl: "https://cal.with-tap.ai/alex-morgan/30min",
      publishedAt: "2026-08-16T18:00:00.000Z",
    }],
  },
});

describe("Calendar gateway client", () => {
  it("defaults packaged surfaces to the production Calendar gateway", () => {
    expect(resolveCalendarGatewayUrl(false, "")).toBe(
      "https://calendar-api.theaiplatform.app",
    );
  });

  it("uses the exact loopback origin for local preview", () => {
    expect(resolveCalendarGatewayUrl(true, "")).toBe("http://127.0.0.1:8787");
    expect(
      resolveCalendarGatewayUrl(true, "?gateway=http%3A%2F%2F127.0.0.1%3A9797"),
    ).toBe("http://127.0.0.1:9797");
    expect(() => resolveCalendarGatewayUrl(true, "?gateway=http://example.com")).toThrow(
      /exact HTTPS origin/u,
    );
  });

  it("preserves the provider catalog local-connector capability", async () => {
    const client = createCalendarGatewayClient({
      baseUrl: "https://calendar-api.theaiplatform.app",
      workspaceId: "workspace-1",
      principalId: "user-1",
      transport: async () => ({
        status: 200,
        bodyText: JSON.stringify({
          localConnector: false,
          providers: [
            { id: "google", authorization: "oauth", configured: true },
          ],
        }),
      }),
    });

    await expect(client.providers()).resolves.toEqual({
      localConnector: false,
      providers: [
        { id: "google", authorization: "oauth", configured: true },
      ],
    });
  });

  it("fails closed when the provider catalog omits localConnector", async () => {
    const client = createCalendarGatewayClient({
      baseUrl: "https://calendar-api.theaiplatform.app",
      workspaceId: "workspace-1",
      principalId: "user-1",
      transport: async () => ({
        status: 200,
        bodyText: JSON.stringify({
          providers: [
            { id: "google", authorization: "oauth", configured: true },
          ],
        }),
      }),
    });

    await expect(client.providers()).rejects.toMatchObject({
      status: 502,
      code: "gateway_response_invalid",
    });
  });

  it("keeps local preview requests on ordinary fetch", async () => {
    const calls: Parameters<typeof fetch>[] = [];
    const fetcher = (async (...input: Parameters<typeof fetch>) => {
      calls.push(input);
      return new Response("preview response", { status: 200 });
    }) as typeof fetch;
    const transport = createFetchCalendarGatewayTransport(fetcher);

    await expect(transport("http://127.0.0.1:8787/v1/health", {
      method: "GET",
      headers: [{ name: "X-TAP-Workspace-Id", value: "workspace-1" }],
      body: null,
    })).resolves.toEqual({ status: 200, bodyText: "preview response" });

    expect(calls).toEqual([[
      "http://127.0.0.1:8787/v1/health",
      {
        method: "GET",
        headers: { "X-TAP-Workspace-Id": "workspace-1" },
      },
    ]]);
  });

  it("asks the host to attach its platform session to packaged gateway requests", async () => {
    const calls: Parameters<MiniAppHttpApi["request"]>[] = [];
    const http = {
      request: async (...input: Parameters<MiniAppHttpApi["request"]>) => {
        calls.push(input);
        return {
          finalUrl: "https://calendar-api.theaiplatform.app/v1/health",
          status: 200,
          statusText: "OK",
          headers: [],
          bodyText: "host response",
          bodyBase64: null,
          bodyKind: "text" as const,
          bodyTruncated: false,
          sizeBytes: 13,
          elapsedMs: 1,
          contentType: "text/plain",
        };
      },
    } satisfies MiniAppHttpApi;
    const transport = createTapCalendarGatewayTransport(http);

    await expect(transport(
      "https://calendar-api.theaiplatform.app/v1/health",
      {
        method: "GET",
        headers: [{ name: "X-TAP-Workspace-Id", value: "workspace-1" }],
        body: null,
      },
    )).resolves.toEqual({ status: 200, bodyText: "host response" });

    expect(calls).toEqual([[
      {
        method: "GET",
        url: "https://calendar-api.theaiplatform.app/v1/health",
        headers: [{ name: "X-TAP-Workspace-Id", value: "workspace-1" }],
        body: null,
        timeoutMs: 30_000,
        responseBodyLimitBytes: 1_048_576,
        followRedirects: false,
      },
      { credentialRef: "platform-session" },
    ]]);
  });

  it("does not attach a TAP bearer to loopback or lookalike gateway origins", async () => {
    const calls: Parameters<MiniAppHttpApi["request"]>[] = [];
    const http = {
      request: async (...input: Parameters<MiniAppHttpApi["request"]>) => {
        calls.push(input);
        return {
          finalUrl: "http://127.0.0.1:8787/health",
          status: 200,
          statusText: "OK",
          headers: [],
          bodyText: "host response",
          bodyBase64: null,
          bodyKind: "text" as const,
          bodyTruncated: false,
          sizeBytes: 13,
          elapsedMs: 1,
          contentType: "text/plain",
        };
      },
    } satisfies MiniAppHttpApi;
    const transport = createTapCalendarGatewayTransport(http);
    await transport("http://127.0.0.1:8787/health", {
      method: "GET",
      headers: [],
      body: null,
    });
    await transport("https://calendar-api.theaiplatform.app.attacker.example/health", {
      method: "GET",
      headers: [],
      body: null,
    });
    expect(calls).toEqual([[
      {
        method: "GET",
        url: "http://127.0.0.1:8787/health",
        headers: [],
        body: null,
        timeoutMs: 30_000,
        responseBodyLimitBytes: 1_048_576,
        followRedirects: false,
      },
    ], [
      {
        method: "GET",
        url: "https://calendar-api.theaiplatform.app.attacker.example/health",
        headers: [],
        body: null,
        timeoutMs: 30_000,
        responseBodyLimitBytes: 1_048_576,
        followRedirects: false,
      },
    ]]);
  });

  it("sends workspace-scoped local connections and returns discovery", async () => {
    const requests: Parameters<CalendarGatewayTransport>[] = [];
    const transport: CalendarGatewayTransport = async (...input) => {
      requests.push(input);
      return {
        status: 201,
        bodyText: JSON.stringify({
          connection: {
            id: "account-1",
            workspaceId: "workspace-1",
            ownerPrincipalId: "user-1",
            provider: "google",
            mode: "local",
            label: "alex@example.com",
            status: "connected",
            createdAt: "2026-08-14T19:00:00.000Z",
            updatedAt: "2026-08-14T19:00:00.000Z",
            lastSyncedAt: "2026-08-14T19:00:00.000Z",
            calendars: [],
          },
        }),
      };
    };
    const client = createCalendarGatewayClient({
      baseUrl: "http://127.0.0.1:8787",
      workspaceId: "workspace-1",
      principalId: "user-1",
      transport,
    });
    await expect(
      client.createLocalConnection({
        id: "account-1",
        provider: "google",
        label: "alex@example.com",
        calendars: [],
      }),
    ).resolves.toMatchObject({ id: "account-1", mode: "local" });
    await expect(
      client.removeLocalCalendars("account-1", ["calendar-1"]),
    ).resolves.toMatchObject({ id: "account-1", mode: "local" });
    await expect(
      client.removeCalendars("account-1", ["calendar-2"]),
    ).resolves.toMatchObject({ id: "account-1", mode: "local" });
    expect(requests).toHaveLength(3);
    expect(requests[0]?.[0]).toBe("http://127.0.0.1:8787/v1/connections/local");
    expect(requests[0]?.[1].headers).toContainEqual({
      name: "X-TAP-Workspace-Id",
      value: "workspace-1",
    });
    expect(requests[0]?.[1].headers).toContainEqual({
      name: "X-TAP-Principal-Id",
      value: "user-1",
    });
    expect(requests[1]?.[0]).toBe(
      "http://127.0.0.1:8787/v1/connections/account-1/calendars/local/remove",
    );
    expect(requests[1]?.[1].body).toBe(
      JSON.stringify({ calendarIds: ["calendar-1"] }),
    );
    expect(requests[2]?.[0]).toBe(
      "http://127.0.0.1:8787/v1/connections/account-1/calendars/remove",
    );
    expect(requests[2]?.[1].body).toBe(
      JSON.stringify({ calendarIds: ["calendar-2"] }),
    );
  });

  it("normalizes gateway errors without hiding provider setup guidance", async () => {
    const client = createCalendarGatewayClient({
      baseUrl: "http://127.0.0.1:8787",
      workspaceId: "workspace-1",
      principalId: "user-1",
      transport: async () => ({
        status: 503,
        bodyText: JSON.stringify({
          error: "provider_unconfigured",
          message: "Google OAuth credentials are not configured in .dev.vars.",
        }),
      }),
    });
    await expect(
      client.startOAuth({ id: "account-1", provider: "google" }),
    ).rejects.toEqual(
      new CalendarGatewayError(
        503,
        "provider_unconfigured",
        "Google OAuth credentials are not configured in .dev.vars.",
      ),
    );
  });

  it("publishes and unpublishes authoritative profile snapshots through the exact routes", async () => {
    const requests: Parameters<CalendarGatewayTransport>[] = [];
    const responses = [
      {
        status: 200,
        bodyText: JSON.stringify(profilePublicationReceipt()),
      },
      {
        status: 200,
        bodyText: JSON.stringify({
          publication: {
            profileId: "public-profile-1",
            sourceProfileId: "profile-source-1",
            generation: 5,
            unpublishedAt: "2026-08-16T18:05:00.000Z",
            idempotentReplay: false,
          },
        }),
      },
    ];
    const client = createCalendarGatewayClient({
      baseUrl: "https://calendar-api.theaiplatform.app",
      workspaceId: "workspace-1",
      principalId: "user-1",
      transport: async (...input) => {
        requests.push(input);
        const response = responses.shift();
        if (!response) throw new Error("Unexpected gateway request.");
        return response;
      },
    });
    const publishInput = profilePublicationInput();

    await expect(client.publishPublicBookingProfile(publishInput)).resolves.toEqual(
      profilePublicationReceipt().publication,
    );
    await expect(client.unpublishPublicBookingProfile({
      schemaVersion: PUBLIC_BOOKING_PROFILE_UNPUBLICATION_SCHEMA_VERSION,
      sourceProfileId: "profile-source-1",
      expectedGeneration: 4,
    })).resolves.toMatchObject({
      profileId: "public-profile-1",
      sourceProfileId: "profile-source-1",
      generation: 5,
      idempotentReplay: false,
    });

    expect(requests).toHaveLength(2);
    expect(requests[0]?.[0]).toBe(
      "https://calendar-api.theaiplatform.app/v1/publications/profiles",
    );
    expect(requests[0]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify(publishInput),
    });
    expect(requests[1]?.[0]).toBe(
      "https://calendar-api.theaiplatform.app/v1/publications/profiles/unpublish",
    );
    expect(requests[1]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        schemaVersion: "tap.calendar.profile-unpublication.v1",
        sourceProfileId: "profile-source-1",
        expectedGeneration: 4,
      }),
    });
  });

  it("rejects malformed and unexpected fields in publication receipts", async () => {
    const receipt = profilePublicationReceipt();
    const malformed = {
      ...receipt,
      debug: true,
    };
    const client = createCalendarGatewayClient({
      baseUrl: "http://127.0.0.1:8787",
      workspaceId: "workspace-1",
      principalId: "user-1",
      transport: async () => ({
        status: 200,
        bodyText: JSON.stringify(malformed),
      }),
    });

    await expect(
      client.publishPublicBookingProfile(profilePublicationInput()),
    ).rejects.toMatchObject({ status: 502, code: "gateway_response_invalid" });
  });

  it("accepts a server-confirmed profile namespace with no Event Type pages", async () => {
    const input: PublicBookingProfilePublicationInput = {
      ...profilePublicationInput(),
      expectedGeneration: 0,
      publications: [],
    };
    const publication = {
      profileId: "public-profile-1",
      sourceProfileId: input.sourceProfileId,
      profileSlug: input.profileSlug,
      generation: 1,
      publishedAt: "2026-08-16T18:00:00.000Z",
      idempotentReplay: false,
      pages: [],
    };
    const client = createCalendarGatewayClient({
      baseUrl: "https://calendar-api.theaiplatform.app",
      workspaceId: "workspace-1",
      principalId: "user-1",
      transport: async () => ({
        status: 200,
        bodyText: JSON.stringify({ publication }),
      }),
    });

    await expect(client.publishPublicBookingProfile(input)).resolves.toEqual(publication);
  });

  it("rejects publication receipts with an off-origin canonical URL", async () => {
    const receipt = profilePublicationReceipt();
    receipt.publication.pages[0]!.canonicalUrl =
      "https://cal.with-tap.ai.attacker.example/alex-morgan/30min";
    const client = createCalendarGatewayClient({
      baseUrl: "http://127.0.0.1:8787",
      workspaceId: "workspace-1",
      principalId: "user-1",
      transport: async () => ({
        status: 200,
        bodyText: JSON.stringify(receipt),
      }),
    });

    await expect(
      client.publishPublicBookingProfile(profilePublicationInput()),
    ).rejects.toMatchObject({ status: 502, code: "gateway_response_invalid" });
  });

  it("rejects publication and unpublication receipts for another source object", async () => {
    const publishReceipt = profilePublicationReceipt();
    publishReceipt.publication.pages[0]!.sourceEventTypeId = "event-type-source-other";
    const responses = [
      publishReceipt,
      {
        publication: {
          profileId: "public-profile-1",
          sourceProfileId: "profile-source-other",
          generation: 5,
          unpublishedAt: "2026-08-16T18:05:00.000Z",
          idempotentReplay: false,
        },
      },
    ];
    const client = createCalendarGatewayClient({
      baseUrl: "http://127.0.0.1:8787",
      workspaceId: "workspace-1",
      principalId: "user-1",
      transport: async () => ({
        status: 200,
        bodyText: JSON.stringify(responses.shift()),
      }),
    });

    await expect(
      client.publishPublicBookingProfile(profilePublicationInput()),
    ).rejects.toMatchObject({ status: 502, code: "gateway_response_invalid" });
    await expect(client.unpublishPublicBookingProfile({
      schemaVersion: PUBLIC_BOOKING_PROFILE_UNPUBLICATION_SCHEMA_VERSION,
      sourceProfileId: "profile-source-1",
      expectedGeneration: 4,
    })).rejects.toMatchObject({ status: 502, code: "gateway_response_invalid" });
  });

  it("propagates only a valid publication conflict generation", async () => {
    const bodies = [
      {
        error: "publication_conflict",
        message: "Refresh and retry.",
        currentGeneration: 8,
      },
      {
        error: "publication_conflict",
        message: "Refresh and retry.",
        currentGeneration: "8",
      },
    ];
    const client = createCalendarGatewayClient({
      baseUrl: "http://127.0.0.1:8787",
      workspaceId: "workspace-1",
      principalId: "user-1",
      transport: async () => ({
        status: 409,
        bodyText: JSON.stringify(bodies.shift()),
      }),
    });

    await expect(
      client.publishPublicBookingProfile(profilePublicationInput()),
    ).rejects.toMatchObject({
      status: 409,
      code: "publication_conflict",
      currentGeneration: 8,
    });
    await expect(
      client.publishPublicBookingProfile(profilePublicationInput()),
    ).rejects.toMatchObject({
      status: 409,
      code: "publication_conflict",
      currentGeneration: undefined,
    });
  });

  it("rejects connection projections outside the exact owner boundary", async () => {
    const client = createCalendarGatewayClient({
      baseUrl: "http://127.0.0.1:8787",
      workspaceId: "workspace-1",
      principalId: "user-1",
      transport: async () => ({
        status: 200,
        bodyText: JSON.stringify({
          connection: {
            id: "account-other",
            workspaceId: "workspace-1",
            ownerPrincipalId: "user-other",
            calendars: [],
          },
        }),
      }),
    });

    await expect(client.getConnection("account-other")).rejects.toMatchObject({
      code: "gateway_owner_mismatch",
      status: 502,
    });

    const listClient = createCalendarGatewayClient({
      baseUrl: "http://127.0.0.1:8787",
      workspaceId: "workspace-1",
      principalId: "user-1",
      transport: async () => ({
        status: 200,
        bodyText: JSON.stringify({
          connections: [{
            id: "account-other",
            workspaceId: "workspace-1",
            ownerPrincipalId: "user-other",
            calendars: [],
          }],
        }),
      }),
    });
    await expect(listClient.listConnections()).rejects.toMatchObject({
      code: "gateway_owner_mismatch",
      status: 502,
    });
  });

  it("derives writable destinations only from the exact TAP principal owner", () => {
    const connection = {
      id: "account-1",
      workspaceId: "workspace-1",
      ownerPrincipalId: "user-1",
      provider: "google" as const,
      mode: "oauth" as const,
      label: "user@example.com",
      status: "connected" as const,
      createdAt: "2026-08-14T19:00:00.000Z",
      updatedAt: "2026-08-14T19:00:00.000Z",
      lastSyncedAt: "2026-08-14T19:00:00.000Z",
      calendars: [{
        id: "calendar-1",
        providerCalendarId: "primary@example.com",
        name: "Primary",
        color: "#4285f4",
        role: "owner" as const,
        writable: true,
        freshness: "live" as const,
        primary: true,
      }],
    };
    expect(calendarGatewayPrincipalAccess([connection], "user-1")).toEqual({
      calendarIds: ["calendar-1"],
      writableGoogleDestinationIds: ["calendar-1"],
    });
    expect(calendarGatewayPrincipalAccess([connection], "user-2")).toEqual({
      calendarIds: [],
      writableGoogleDestinationIds: [],
    });
    expect(calendarGatewayPrincipalAccess([
      { ...connection, mode: "local" },
    ], "user-1").writableGoogleDestinationIds).toEqual([]);
  });

  it("derives bounded provider windows for each calendar view", () => {
    expect(calendarGatewayEventWindow("work-week", "2026-08-14")).toEqual({
      timeMin: "2026-08-09T00:00:00.000Z",
      timeMax: "2026-08-18T00:00:00.000Z",
    });
    expect(calendarGatewayEventWindow("month", "2026-08-14")).toEqual({
      timeMin: "2026-07-31T00:00:00.000Z",
      timeMax: "2026-09-02T00:00:00.000Z",
    });
    expect(calendarGatewayEventWindow("agenda", "2026-08-14")).toEqual({
      timeMin: "2026-08-13T00:00:00.000Z",
      timeMax: "2026-09-14T00:00:00.000Z",
    });
  });

  it("queries visible calendar events through the workspace-scoped gateway", async () => {
    const requests: Parameters<CalendarGatewayTransport>[] = [];
    const client = createCalendarGatewayClient({
      baseUrl: "http://127.0.0.1:8787",
      workspaceId: "workspace-1",
      principalId: "user-1",
      transport: async (...input) => {
        requests.push(input);
        return {
          status: 200,
          bodyText: JSON.stringify({
            timeMin: "2026-08-09T00:00:00.000Z",
            timeMax: "2026-08-18T00:00:00.000Z",
            syncedAt: "2026-08-15T12:00:00.000Z",
            events: [],
            syncedCalendarIds: ["calendar-1"],
            servedCalendarIds: ["calendar-1"],
            errors: [],
            truncated: false,
            source: "cache",
            cache: {
              servedAt: "2026-08-15T12:00:00.000Z",
              calendars: [{
                calendarId: "calendar-1",
                cacheRevision: 3,
                freshness: "fresh",
                lastSuccessAt: "2026-08-15T12:00:00.000Z",
                nextSyncAt: "2026-08-15T12:05:00.000Z",
                error: null,
              }],
            },
          }),
        };
      },
    });

    await expect(client.queryEvents({
      timeMin: "2026-08-09T00:00:00.000Z",
      timeMax: "2026-08-18T00:00:00.000Z",
      calendarIds: ["calendar-1"],
      revalidate: "wait",
    })).resolves.toMatchObject({
      syncedCalendarIds: ["calendar-1"],
      servedCalendarIds: ["calendar-1"],
      source: "cache",
    });
    expect(requests[0]?.[0]).toBe("http://127.0.0.1:8787/v1/events/query");
    expect(requests[0]?.[1].body).toBe(JSON.stringify({
      timeMin: "2026-08-09T00:00:00.000Z",
      timeMax: "2026-08-18T00:00:00.000Z",
      calendarIds: ["calendar-1"],
      revalidate: "wait",
    }));
  });

  it("confirms a slot through the live, idempotent availability boundary", async () => {
    const requests: Parameters<CalendarGatewayTransport>[] = [];
    const client = createCalendarGatewayClient({
      baseUrl: "http://127.0.0.1:8787",
      workspaceId: "workspace-1",
      principalId: "user-1",
      transport: async (...input) => {
        requests.push(input);
        return {
          status: 200,
          bodyText: JSON.stringify({
            available: true,
            conclusive: true,
            validatedAt: "2026-08-15T12:00:00.000Z",
            source: "provider-live",
            conflicts: [],
            syncedCalendarIds: ["calendar-1"],
            errors: [],
            timeMin: "2026-08-15T14:00:00.000Z",
            timeMax: "2026-08-15T14:30:00.000Z",
            confirmationId: "confirmation-1",
            availabilityConfirmed: true,
            idempotentReplay: false,
          }),
        };
      },
    });

    await expect(client.confirmAvailability({
      timeMin: "2026-08-15T14:00:00.000Z",
      timeMax: "2026-08-15T14:30:00.000Z",
      calendarIds: ["calendar-1"],
      idempotencyKey: "meeting-1-availability",
    })).resolves.toMatchObject({
      availabilityConfirmed: true,
      confirmationId: "confirmation-1",
    });
    expect(requests[0]?.[0]).toBe(
      "http://127.0.0.1:8787/v1/availability/confirm",
    );
    expect(requests[0]?.[1].body).toBe(JSON.stringify({
      timeMin: "2026-08-15T14:00:00.000Z",
      timeMax: "2026-08-15T14:30:00.000Z",
      calendarIds: ["calendar-1"],
      idempotencyKey: "meeting-1-availability",
    }));
  });

  it("commits provider bookings and resolves approval holds through idempotent boundaries", async () => {
    const requests: Parameters<CalendarGatewayTransport>[] = [];
    const event = {
      id: "calendar-1:provider-event-1",
      calendarId: "calendar-1",
      title: "Architecture review",
      start: "2026-08-17T14:00:00.000Z",
      end: "2026-08-17T14:30:00.000Z",
      kind: "hold",
      status: "pending",
      location: null,
      attendees: [],
    };
    const responses = [
      {
        status: 201,
        bodyText: JSON.stringify({
          booking: {
            state: "committed",
            provider: "google",
            providerEventId: "provider-event-1",
            destinationCalendarId: "calendar-1",
            bookingKind: "approval-hold",
            approvalStatus: "pending",
            pendingAttendeeEmails: ["guest@example.com"],
            approvalExpiresAt: "2026-08-18T14:00:00.000Z",
            providerHtmlLink: "https://calendar.google.com/event/1",
            providerJoinUrl: null,
            conferenceStatus: "none",
            event,
          },
          committedAt: "2026-08-15T12:00:00.000Z",
          idempotentReplay: false,
          concurrencyBoundary: "tap-conflict-calendar-set-serialized",
        }),
      },
      {
        status: 200,
        bodyText: JSON.stringify({
          resolution: {
            state: "committed",
            decision: "approved",
            bookingIdempotencyKey: "booking-1",
            providerEventId: "provider-event-1",
            providerEventRemoved: false,
            providerJoinUrl: "https://meet.google.com/abc-defg-hij",
            event: {
              ...event,
              kind: "meeting",
              status: "confirmed",
              location: "google-meet",
            },
          },
          resolvedAt: "2026-08-15T12:05:00.000Z",
          idempotentReplay: false,
        }),
      },
      {
        status: 200,
        bodyText: JSON.stringify({
          commit: {
            booking: {
              state: "committed",
              provider: "google",
              providerEventId: "provider-event-1",
              destinationCalendarId: "calendar-1",
              bookingKind: "approval-hold",
              approvalStatus: "pending",
              pendingAttendeeEmails: ["guest@example.com"],
              approvalExpiresAt: "2026-08-18T14:00:00.000Z",
              providerHtmlLink: "https://www.google.com/calendar/event?eid=one",
              providerJoinUrl: "https://meet.google.com/abc-defg-hij",
              conferenceStatus: "ready",
              event: {
                ...event,
              },
            },
            committedAt: "2026-08-15T12:00:00.000Z",
            idempotentReplay: true,
            concurrencyBoundary: "tap-conflict-calendar-set-serialized",
          },
          lifecycle: {
            state: "approved",
            resolvedAt: "2026-08-15T12:05:00.000Z",
            providerEventRemoved: false,
          },
          currentEvent: {
            ...event,
            kind: "meeting",
            status: "confirmed",
            location: "google-meet",
          },
        }),
      },
    ];
    const client = createCalendarGatewayClient({
      baseUrl: "http://127.0.0.1:8787",
      workspaceId: "workspace-1",
      principalId: "user-1",
      transport: async (...input) => {
        requests.push(input);
        const response = responses.shift();
        if (!response) throw new Error("Unexpected gateway request.");
        return response;
      },
    });

    await expect(client.commitBooking({
      destinationCalendarId: "calendar-1",
      conflictCalendarIds: ["calendar-1", "calendar-2"],
      idempotencyKey: "booking-1",
      title: "Architecture review",
      start: event.start,
      end: event.end,
      conflictTimeMin: "2026-08-17T13:45:00.000Z",
      conflictTimeMax: "2026-08-17T14:45:00.000Z",
      bookingKind: "approval-hold",
      attendeeEmails: ["guest@example.com"],
      expiresAt: "2026-08-18T14:00:00.000Z",
    })).resolves.toMatchObject({
      booking: { providerEventId: "provider-event-1", approvalStatus: "pending" },
    });
    await expect(client.resolveApprovalHold("booking-1", {
      idempotencyKey: "booking-1-approve",
      decision: "approve",
      attendeeEmails: ["guest@example.com"],
      conferenceProvider: "google-meet",
      conflictCalendarIds: ["calendar-1", "calendar-2"],
    })).resolves.toMatchObject({
      resolution: { decision: "approved", providerEventRemoved: false },
    });
    await expect(client.getBookingStatus("booking-1")).resolves.toMatchObject({
      commit: {
        booking: {
          bookingKind: "approval-hold",
          conferenceStatus: "ready",
          providerJoinUrl: "https://meet.google.com/abc-defg-hij",
        },
      },
      lifecycle: { state: "approved", providerEventRemoved: false },
      currentEvent: { kind: "meeting", status: "confirmed" },
    });

    expect(requests[0]?.[0]).toBe("http://127.0.0.1:8787/v1/bookings/commit");
    expect(JSON.parse(requests[0]?.[1].body ?? "null")).toEqual({
      destinationCalendarId: "calendar-1",
      conflictCalendarIds: ["calendar-1", "calendar-2"],
      idempotencyKey: "booking-1",
      title: "Architecture review",
      start: event.start,
      end: event.end,
      conflictTimeMin: "2026-08-17T13:45:00.000Z",
      conflictTimeMax: "2026-08-17T14:45:00.000Z",
      bookingKind: "approval-hold",
      attendeeEmails: ["guest@example.com"],
      conferenceProvider: "none",
      expiresAt: "2026-08-18T14:00:00.000Z",
    });
    expect(requests[1]?.[0]).toBe(
      "http://127.0.0.1:8787/v1/bookings/booking-1/resolve",
    );
    expect(requests[2]?.[0]).toBe(
      "http://127.0.0.1:8787/v1/bookings/booking-1/status",
    );
    expect(requests[2]?.[1]).toMatchObject({ method: "GET", body: null });
  });

  it("accepts only exact Google Calendar and Meet HTTPS booking links", () => {
    const event = {
      id: "calendar-1:provider-event-1",
      calendarId: "calendar-1",
      title: "Architecture review",
      start: "2026-08-17T14:00:00.000Z",
      end: "2026-08-17T14:30:00.000Z",
      kind: "meeting",
      status: "confirmed",
      location: "google-meet",
      attendees: [],
    };
    const commit = {
      booking: {
        state: "committed",
        provider: "google",
        providerEventId: "provider-event-1",
        destinationCalendarId: "calendar-1",
        bookingKind: "meeting",
        approvalStatus: null,
        pendingAttendeeEmails: [],
        approvalExpiresAt: null,
        providerHtmlLink: "https://calendar.google.com/event?eid=one",
        providerJoinUrl: "https://meet.google.com/abc-defg-hij",
        conferenceStatus: "ready",
        event,
      },
      committedAt: "2026-08-15T12:00:00.000Z",
      idempotentReplay: true,
      concurrencyBoundary: "tap-conflict-calendar-set-serialized",
    };
    expect(isCalendarGatewayBookingCommit(commit)).toBe(true);
    expect(isCalendarGatewayBookingCommit({
      ...commit,
      booking: { ...commit.booking, providerHtmlLink: "javascript:alert(1)" },
    })).toBe(false);
    expect(isCalendarGatewayBookingCommit({
      ...commit,
      booking: { ...commit.booking, providerHtmlLink: "https://attacker.example/event/1" },
    })).toBe(false);
    expect(isCalendarGatewayBookingCommit({
      ...commit,
      booking: { ...commit.booking, providerHtmlLink: "https://calendar.google.com/settings" },
    })).toBe(false);
    for (const providerJoinUrl of [
      "http://meet.google.com/abc-defg-hij",
      "https://attacker.example/abc-defg-hij",
      "https://meet.google.com.attacker.example/abc-defg-hij",
      "javascript:alert(1)",
    ]) {
      expect(isCalendarGatewayBookingCommit({
        ...commit,
        booking: { ...commit.booking, providerJoinUrl },
      })).toBe(false);
    }
    expect(isCalendarGatewayBookingCommit({
      ...commit,
      booking: { ...commit.booking, providerJoinUrl: null },
    })).toBe(false);
    expect(isCalendarGatewayBookingCommit({
      ...commit,
      booking: {
        ...commit.booking,
        event: { ...event, providerJoinUrl: "https://attacker.example/join" },
      },
    })).toBe(false);

    const resolution = {
      resolution: {
        state: "committed",
        decision: "approved",
        bookingIdempotencyKey: "booking-1",
        providerEventId: "provider-event-1",
        providerEventRemoved: false,
        providerJoinUrl: "https://meet.google.com/abc-defg-hij",
        event,
      },
      resolvedAt: "2026-08-15T12:05:00.000Z",
      idempotentReplay: true,
    };
    expect(isCalendarGatewayBookingResolution(resolution)).toBe(true);
    expect(isCalendarGatewayBookingResolution({
      ...resolution,
      resolution: {
        ...resolution.resolution,
        providerJoinUrl: "https://video.example/abc-defg-hij",
      },
    })).toBe(false);

    const activeStatus = {
      commit,
      lifecycle: {
        state: "active",
        resolvedAt: null,
        providerEventRemoved: false,
      },
      currentEvent: event,
    };
    expect(isCalendarGatewayBookingStatus(activeStatus)).toBe(true);
    const terminalCommit = {
      ...commit,
      booking: {
        ...commit.booking,
        bookingKind: "approval-hold",
        approvalStatus: "pending",
        providerJoinUrl: null,
        conferenceStatus: "none",
        event: { ...event, kind: "hold", status: "pending", location: null },
      },
    };
    const declinedStatus = {
      commit: terminalCommit,
      lifecycle: {
        state: "declined",
        resolvedAt: "2026-08-15T12:05:00.000Z",
        providerEventRemoved: true,
      },
      currentEvent: null,
    };
    expect(isCalendarGatewayBookingStatus(declinedStatus)).toBe(true);
    expect(isCalendarGatewayBookingStatus({
      ...declinedStatus,
      lifecycle: { ...declinedStatus.lifecycle, providerEventRemoved: false },
    })).toBe(false);
    expect(isCalendarGatewayBookingStatus({
      ...declinedStatus,
      currentEvent: event,
    })).toBe(false);
  });
});
