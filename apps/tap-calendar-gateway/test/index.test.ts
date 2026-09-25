import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCalendarGatewayWorker,
  createGatewayPublicBookingManagementProvider,
  createGatewayPublicBookingProvider,
  normalizeGoogleCalendarHtmlUrl,
  normalizeGoogleCalendarEvent,
  normalizeGoogleMeetJoinUrl,
  normalizeMicrosoftCalendarPageUrl,
} from "../src/index";
import { publicBookingProviderOperationId } from "../src/public-booking-create";
const worker = createCalendarGatewayWorker();

const origin = "http://localhost:3000";
const workspace = "workspace-local-test";
const principal = "user-local-test";
const testNow = Date.parse("2026-08-16T12:00:00.000Z");

const isRecordForTest = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const withoutOAuthSecrets = () => ({
  ...env,
  TOKEN_ENCRYPTION_KEY: "",
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
  MICROSOFT_CLIENT_ID: "",
  MICROSOFT_CLIENT_SECRET: "",
});

const testEncryptionKey = (): string => {
  let binary = "";
  for (let index = 0; index < 32; index += 1) binary += String.fromCharCode(index + 1);
  return btoa(binary);
};

const sha256Base64Url = async (value: string): Promise<string> => {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
};

const request = (
  path: string,
  init: RequestInit & { readonly json?: unknown } = {},
): Request => {
  const headers = new Headers(init.headers);
  headers.set("Origin", origin);
  headers.set("X-TAP-Workspace-Id", workspace);
  if (!headers.has("X-TAP-Principal-Id")) {
    headers.set("X-TAP-Principal-Id", principal);
  }
  if (init.json !== undefined) headers.set("Content-Type", "application/json");
  return new Request(`https://calendar-gateway.test${path}`, {
    ...init,
    headers,
    ...(init.json === undefined ? {} : { body: JSON.stringify(init.json) }),
  });
};

const requestForPrincipal = (
  principalId: string,
  path: string,
  init: RequestInit & { readonly json?: unknown } = {},
): Request => {
  const headers = new Headers(init.headers);
  headers.set("X-TAP-Principal-Id", principalId);
  return request(path, { ...init, headers });
};

const calendar = (id: string, role: "owner" | "reader" = "owner") => ({
  id,
  providerCalendarId: `${id}@provider.test`,
  name: id === "calendar-primary" ? "Primary" : "Shared",
  color: id === "calendar-primary" ? "#4285f4" : "#34a853",
  role,
  writable: role === "owner",
  freshness: "live",
  primary: id === "calendar-primary",
});

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(testNow);
  await env.CALENDAR_DB.batch([
    env.CALENDAR_DB.prepare("DELETE FROM zoom_meeting_operations"),
    env.CALENDAR_DB.prepare("DELETE FROM meeting_provider_oauth_states"),
    env.CALENDAR_DB.prepare("DELETE FROM meeting_provider_connections"),
    env.CALENDAR_DB.prepare("DELETE FROM public_booking_email_outbox"),
    env.CALENDAR_DB.prepare("DELETE FROM public_booking_management_mutations"),
    env.CALENDAR_DB.prepare("DELETE FROM public_booking_management_credentials"),
    env.CALENDAR_DB.prepare("DELETE FROM public_booking_slot_proof_uses"),
    env.CALENDAR_DB.prepare("DELETE FROM public_booking_attempts"),
    env.CALENDAR_DB.prepare("DELETE FROM public_booking_owner_leases"),
    env.CALENDAR_DB.prepare("DELETE FROM public_booking_publication_audit"),
    env.CALENDAR_DB.prepare("DELETE FROM public_booking_page_revisions"),
    env.CALENDAR_DB.prepare("DELETE FROM public_booking_page_slugs"),
    env.CALENDAR_DB.prepare("DELETE FROM public_booking_pages"),
    env.CALENDAR_DB.prepare("DELETE FROM public_booking_profile_generations"),
    env.CALENDAR_DB.prepare("DELETE FROM public_booking_profile_slugs"),
    env.CALENDAR_DB.prepare("DELETE FROM public_booking_owner_profile_slots"),
    env.CALENDAR_DB.prepare("DELETE FROM public_booking_profiles"),
    env.CALENDAR_DB.prepare("DELETE FROM availability_confirmations"),
    env.CALENDAR_DB.prepare("DELETE FROM provider_booking_resolutions"),
    env.CALENDAR_DB.prepare("DELETE FROM provider_booking_commit_locks"),
    env.CALENDAR_DB.prepare("DELETE FROM provider_booking_commits"),
    env.CALENDAR_DB.prepare("DELETE FROM calendar_watch_channels"),
    env.CALENDAR_DB.prepare("DELETE FROM calendar_event_cache"),
    env.CALENDAR_DB.prepare("DELETE FROM calendar_sync_state"),
    env.CALENDAR_DB.prepare("DELETE FROM oauth_states"),
    env.CALENDAR_DB.prepare("DELETE FROM calendar_exclusions"),
    env.CALENDAR_DB.prepare("DELETE FROM provider_calendars"),
    env.CALENDAR_DB.prepare("DELETE FROM calendar_connections"),
  ]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("TAP Calendar local gateway", () => {
  it("normalizes Google timed, all-day, and attendee fields without provider metadata", () => {
    expect(normalizeGoogleCalendarEvent({
      id: "event-1",
      status: "confirmed",
      summary: "Planning",
      start: { dateTime: "2026-08-14T09:00:00-04:00" },
      end: { dateTime: "2026-08-14T10:00:00-04:00" },
      transparency: "transparent",
      hangoutLink: "https://meet.google.com/test",
      attendees: [{
        email: "alex@example.com",
        displayName: "Alex",
        self: true,
        responseStatus: "declined",
      }],
    }, "calendar-primary")).toMatchObject({
      calendarId: "calendar-primary",
      title: "Planning",
      start: "2026-08-14T13:00:00.000Z",
      end: "2026-08-14T14:00:00.000Z",
      status: "declined",
      location: "google-meet",
      busy: false,
      allDay: false,
      attendees: [{ name: "Alex", email: "alex@example.com", required: true }],
    });
    expect(normalizeGoogleCalendarEvent({
      id: "event-all-day",
      summary: "Holiday",
      start: { date: "2026-08-14" },
      end: { date: "2026-08-15" },
    }, "calendar-primary")).toMatchObject({
      start: "2026-08-14T00:00:00.000Z",
      end: "2026-08-15T00:00:00.000Z",
      allDay: true,
    });
    expect(normalizeGoogleCalendarEvent({
      id: "tap-work-block",
      summary: "Prepare notes",
      start: { dateTime: "2026-08-14T15:00:00Z" },
      end: { dateTime: "2026-08-14T16:00:00Z" },
      extendedProperties: { private: { tapBookingKind: "work-block" } },
    }, "calendar-primary")).toMatchObject({ kind: "work-block", title: "Prepare notes" });
    expect(normalizeGoogleCalendarHtmlUrl(
      "https://www.google.com/calendar/event?eid=one",
    )).toBe("https://www.google.com/calendar/event?eid=one");
    expect(normalizeGoogleMeetJoinUrl(
      "https://meet.google.com/abc-defg-hij",
    )).toBe("https://meet.google.com/abc-defg-hij");
    for (const value of [
      "javascript:alert(1)",
      "http://meet.google.com/abc-defg-hij",
      "https://attacker.example/abc-defg-hij",
      "https://meet.google.com.attacker.example/abc-defg-hij",
    ]) {
      expect(normalizeGoogleMeetJoinUrl(value)).toBeNull();
    }
    for (const value of [
      "javascript:alert(1)",
      "http://calendar.google.com/event?eid=one",
      "https://attacker.example/event?eid=one",
      "https://calendar.google.com.attacker.example/event?eid=one",
      "https://calendar.google.com/settings",
      "https://calendar.google.com/eventually",
    ]) {
      expect(normalizeGoogleCalendarHtmlUrl(value)).toBeNull();
    }
    expect(normalizeGoogleCalendarEvent({
      id: "event-untrusted-conference",
      summary: "Do not trust the location",
      start: { dateTime: "2026-08-14T15:00:00Z" },
      end: { dateTime: "2026-08-14T16:00:00Z" },
      hangoutLink: "https://attacker.example/join",
      conferenceData: {
        conferenceSolution: { key: { type: "hangoutsMeet" } },
        entryPoints: [{ entryPointType: "video", uri: "javascript:alert(1)" }],
      },
    }, "calendar-primary")).toMatchObject({ location: null });
  });

  it("keeps Microsoft pagination on the exact Graph calendar endpoint", () => {
    expect(
      normalizeMicrosoftCalendarPageUrl(
        "https://graph.microsoft.com/v1.0/me/calendars?$skiptoken=next",
      ),
    ).toBe("https://graph.microsoft.com/v1.0/me/calendars?$skiptoken=next");
    expect(() =>
      normalizeMicrosoftCalendarPageUrl(
        "https://attacker.example/v1.0/me/calendars?$skiptoken=next",
      ),
    ).toThrow(/untrusted calendar page URL/u);
    expect(() =>
      normalizeMicrosoftCalendarPageUrl(
        "https://graph.microsoft.com/v1.0/users/other/calendars",
      ),
    ).toThrow(/untrusted calendar page URL/u);
  });

  it("reports a healthy Workers runtime and provider configuration", async () => {
    const health = await worker.fetch(request("/health"), env);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({
      ok: true,
      service: "tap-calendar-gateway",
      runtime: "cloudflare-workers",
      localDevelopment: true,
    });

    const providers = await worker.fetch(request("/v1/providers"), withoutOAuthSecrets());
    expect(providers.status).toBe(200);
    expect(providers.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    const catalog = await providers.json<{
      readonly localConnector: boolean;
      readonly providers: readonly {
        readonly id: string;
        readonly authorization: string;
        readonly configured: boolean;
      }[];
    }>();
    expect(catalog.localConnector).toBe(true);
    expect(catalog.providers.find(item => item.id === "google")).toEqual({
      id: "google",
      authorization: "oauth",
      configured: false,
    });
    expect(catalog.providers.find(item => item.id === "microsoft")).toEqual({
      id: "microsoft",
      authorization: "oauth",
      configured: false,
    });
  });

  it("rotates Zoom OAuth state while reusing a pending or attention connection", async () => {
    const zoomEnv = {
      ...env,
      TOKEN_ENCRYPTION_KEY: testEncryptionKey(),
      ZOOM_CLIENT_ID: "zoom-client-id",
      ZOOM_CLIENT_SECRET: "zoom-client-secret",
      PUBLIC_BASE_URL: "https://calendar-api.example.test",
    };
    const first = await worker.fetch(
      request("/v1/oauth/zoom/start", {
        method: "POST",
        json: { id: "account-zoom-reconnect", label: "Original Zoom" },
      }),
      zoomEnv,
    );
    expect(first.status).toBe(201);
    const firstBody = await first.json<{
      readonly connectionId: string;
      readonly authorizationUrl: string;
    }>();
    const firstState = new URL(firstBody.authorizationUrl).searchParams.get("state");
    expect(firstBody.connectionId).toBe("account-zoom-reconnect");
    expect(firstState).toBeTruthy();
    const firstStateHash = await env.CALENDAR_DB.prepare(
      `SELECT state_hash FROM meeting_provider_oauth_states
        WHERE workspace_id = ? AND principal_id = ? AND connection_id = ?`,
    )
      .bind(workspace, principal, firstBody.connectionId)
      .first<string>("state_hash");
    expect(firstStateHash).toBeTruthy();

    await env.CALENDAR_DB.prepare(
      `UPDATE meeting_provider_connections SET status = 'attention'
        WHERE workspace_id = ? AND principal_id = ? AND id = ?`,
    )
      .bind(workspace, principal, firstBody.connectionId)
      .run();
    const second = await worker.fetch(
      request("/v1/oauth/zoom/start", {
        method: "POST",
        json: { id: "ignored-new-zoom-id", label: "Reconnected Zoom" },
      }),
      zoomEnv,
    );
    expect(second.status).toBe(201);
    const secondBody = await second.json<{
      readonly connectionId: string;
      readonly authorizationUrl: string;
    }>();
    const secondState = new URL(secondBody.authorizationUrl).searchParams.get("state");
    expect(secondBody.connectionId).toBe(firstBody.connectionId);
    expect(secondState).toBeTruthy();
    expect(secondState).not.toBe(firstState);

    const connections = await env.CALENDAR_DB.prepare(
      `SELECT id, label, status FROM meeting_provider_connections
        WHERE workspace_id = ? AND principal_id = ? AND provider = 'zoom'`,
    )
      .bind(workspace, principal)
      .all<{ readonly id: string; readonly label: string; readonly status: string }>();
    expect(connections.results).toEqual([{
      id: firstBody.connectionId,
      label: "Reconnected Zoom",
      status: "pending",
    }]);
    const oauthStates = await env.CALENDAR_DB.prepare(
      `SELECT state_hash FROM meeting_provider_oauth_states
        WHERE workspace_id = ? AND principal_id = ? AND connection_id = ?`,
    )
      .bind(workspace, principal, firstBody.connectionId)
      .all<{ readonly state_hash: string }>();
    expect(oauthStates.results).toHaveLength(1);
    expect(oauthStates.results[0]?.state_hash).not.toBe(firstStateHash);

    const staleCallback = await worker.fetch(
      request(
        `/v1/oauth/zoom/callback?state=${encodeURIComponent(firstState!)}&code=stale-code`,
      ),
      zoomEnv,
    );
    expect(staleCallback.status).toBe(400);
    expect(await staleCallback.json()).toMatchObject({ error: "oauth_state_invalid" });
  });

  it("requires the host-managed organizer session outside local development", async () => {
    const closedEnv = {
      ...env,
      LOCAL_DEVELOPMENT: "false",
    };
    const response = await worker.fetch(request("/v1/connections"), closedEnv);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "organizer_auth_required",
      message: "A valid Bearer token is required.",
    });
    const bookingStatus = await worker.fetch(
      request("/v1/bookings/booking-1/status"),
      closedEnv,
    );
    expect(bookingStatus.status).toBe(401);
    expect(await bookingStatus.json()).toMatchObject({
      error: "organizer_auth_required",
    });

    const mcp = await worker.fetch(
      request("/mcp", {
        method: "POST",
        json: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      }),
      closedEnv,
    );
    expect(mcp.status).toBe(401);
    expect(await mcp.json()).toMatchObject({ error: "organizer_auth_required" });
  });

  it("exposes local Streamable HTTP MCP discovery and rejects unknown webhooks", async () => {
    const initialized = await worker.fetch(
      request("/mcp", {
        method: "POST",
        json: { jsonrpc: "2.0", id: "init", method: "initialize", params: {} },
      }),
      env,
    );
    expect(await initialized.json()).toMatchObject({
      jsonrpc: "2.0",
      id: "init",
      result: {
        protocolVersion: "2025-11-25",
        capabilities: { tools: {} },
      },
    });
    const tools = await worker.fetch(
      request("/mcp", {
        method: "POST",
        json: { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      }),
      env,
    );
    expect(await tools.json()).toMatchObject({
      result: {
        tools: [
          { name: "list_events" },
          { name: "find_available_slots" },
          { name: "draft_meeting" },
        ],
      },
    });

    const denied = await worker.fetch(new Request(
      "https://calendar-gateway.test/v1/webhooks/google/calendar",
      {
        method: "POST",
        headers: {
          "X-Goog-Channel-ID": "unknown-channel",
          "X-Goog-Channel-Token": "invalid-token",
          "X-Goog-Resource-ID": "unknown-resource",
          "X-Goog-Resource-State": "exists",
        },
      },
    ), env);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ error: "webhook_denied" });
  });

  it("registers isolated scheduled lifecycle, email, and cache work", async () => {
    const background: Promise<unknown>[] = [];
    worker.scheduled({
      cron: "*/5 * * * *",
      scheduledTime: Date.now(),
      noRetry() {},
    } as unknown as ScheduledController, env, {
      waitUntil(promise: Promise<unknown>) {
        background.push(promise);
      },
    } as unknown as ExecutionContext);
    expect(background).toHaveLength(6);
    await expect(Promise.all(background)).resolves.toHaveLength(6);
  });

  it("persists an empty-install connection and every discovered calendar in D1", async () => {
    const created = await worker.fetch(
      request("/v1/connections/local", {
        method: "POST",
        json: {
          id: "account-google-local",
          provider: "google",
          label: "alex@example.com",
          calendars: [calendar("calendar-primary"), calendar("calendar-shared", "reader")],
        },
      }),
      env,
    );

    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({
      connection: {
        id: "account-google-local",
        workspaceId: workspace,
        provider: "google",
        mode: "local",
        label: "alex@example.com",
        status: "connected",
        calendars: [
          { id: "calendar-primary", writable: true, role: "owner" },
          { id: "calendar-shared", writable: false, role: "reader" },
        ],
      },
    });
    expect(
      await env.CALENDAR_DB.prepare(
        "SELECT COUNT(*) AS count FROM provider_calendars WHERE connection_id = ?",
      )
        .bind("account-google-local")
        .first<number>("count"),
    ).toBe(2);

    const listed = await worker.fetch(request("/v1/connections"), env);
    expect(await listed.json()).toMatchObject({
      connections: [{ id: "account-google-local", calendars: [{}, {}] }],
    });
  });

  it("adds calendars to a local connection and keeps sync idempotent", async () => {
    await worker.fetch(
      request("/v1/connections/local", {
        method: "POST",
        json: {
          id: "account-local",
          provider: "icloud",
          label: "Local iCloud fixture",
          calendars: [calendar("calendar-primary")],
        },
      }),
      env,
    );

    const added = await worker.fetch(
      request("/v1/connections/account-local/calendars/local", {
        method: "POST",
        json: { calendars: [calendar("calendar-shared", "reader")] },
      }),
      env,
    );
    expect(added.status).toBe(200);
    expect(await added.json()).toMatchObject({
      connection: { calendars: [{}, {}] },
    });

    const compensated = await worker.fetch(
      request("/v1/connections/account-local/calendars/local/remove", {
        method: "POST",
        json: { calendarIds: ["calendar-shared"] },
      }),
      env,
    );
    expect(compensated.status).toBe(200);
    expect(await compensated.json()).toMatchObject({
      connection: {
        id: "account-local",
        status: "connected",
        calendars: [{ id: "calendar-primary" }],
      },
    });

    const synced = await worker.fetch(
      request("/v1/connections/account-local/sync", { method: "POST", json: {} }),
      env,
    );
    expect(synced.status).toBe(200);
    expect(await synced.json()).toMatchObject({
      connection: { id: "account-local", mode: "local", calendars: [{}] },
    });
  });

  it("tombstones provider calendars across sync and removes the last calendar", async () => {
    const providerFetch: typeof fetch = async input => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      if (url.origin === "https://oauth2.googleapis.com" && url.pathname === "/token") {
        return Response.json({
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 3600,
          token_type: "Bearer",
        });
      }
      if (url.pathname === "/calendar/v3/users/me/calendarList") {
        return Response.json({
          items: [
            {
              id: "primary@provider.test",
              summary: "Primary",
              accessRole: "owner",
              primary: true,
              backgroundColor: "#4285f4",
            },
            {
              id: "shared@provider.test",
              summary: "Shared",
              accessRole: "reader",
              backgroundColor: "#34a853",
            },
          ],
        });
      }
      return Response.json(
        { error: { message: `Unexpected provider request: ${url.href}` } },
        { status: 500 },
      );
    };
    const oauthEnv = {
      ...env,
      TOKEN_ENCRYPTION_KEY: testEncryptionKey(),
      GOOGLE_CLIENT_ID: "google-client-id",
      GOOGLE_CLIENT_SECRET: "google-client-secret",
    };
    const oauthWorker = createCalendarGatewayWorker(providerFetch);
    const started = await oauthWorker.fetch(
      request("/v1/oauth/google/start", {
        method: "POST",
        json: { id: "account-removal-oauth", label: "Google" },
      }),
      oauthEnv,
    );
    const authorization = await started.json<{ readonly authorizationUrl: string }>();
    const state = new URL(authorization.authorizationUrl).searchParams.get("state");
    expect(state).toBeTruthy();
    expect((await oauthWorker.fetch(
      request(
        `/v1/oauth/google/callback?state=${encodeURIComponent(state!)}&code=authorization-code`,
      ),
      oauthEnv,
    )).status).toBe(200);

    const initialCalendars = await env.CALENDAR_DB.prepare(
      `SELECT id, provider_calendar_id FROM provider_calendars
        WHERE connection_id = ? ORDER BY provider_calendar_id`,
    )
      .bind("account-removal-oauth")
      .all<{ readonly id: string; readonly provider_calendar_id: string }>();
    const primary = initialCalendars.results.find(
      item => item.provider_calendar_id === "primary@provider.test",
    );
    const shared = initialCalendars.results.find(
      item => item.provider_calendar_id === "shared@provider.test",
    );
    expect(primary).toBeTruthy();
    expect(shared).toBeTruthy();

    const removedShared = await oauthWorker.fetch(
      request("/v1/connections/account-removal-oauth/calendars/remove", {
        method: "POST",
        json: { calendarIds: [shared!.id] },
      }),
      oauthEnv,
    );
    expect(removedShared.status).toBe(200);
    expect(await removedShared.json()).toMatchObject({
      connection: {
        id: "account-removal-oauth",
        status: "connected",
        calendars: [{ id: primary!.id, providerCalendarId: "primary@provider.test" }],
      },
    });
    expect(
      await env.CALENDAR_DB.prepare(
        `SELECT provider_calendar_id FROM calendar_exclusions
          WHERE workspace_id = ? AND connection_id = ? AND calendar_id = ?`,
      )
        .bind(workspace, "account-removal-oauth", shared!.id)
        .first<string>("provider_calendar_id"),
    ).toBe("shared@provider.test");

    const synced = await oauthWorker.fetch(
      request("/v1/connections/account-removal-oauth/sync", { method: "POST", json: {} }),
      oauthEnv,
    );
    expect(synced.status).toBe(200);
    expect(await synced.json()).toMatchObject({
      connection: {
        status: "connected",
        calendars: [{ id: primary!.id, providerCalendarId: "primary@provider.test" }],
      },
    });
    expect(
      await env.CALENDAR_DB.prepare(
        "SELECT COUNT(*) AS count FROM calendar_exclusions WHERE connection_id = ?",
      )
        .bind("account-removal-oauth")
        .first<number>("count"),
    ).toBe(1);

    const repeated = await oauthWorker.fetch(
      request("/v1/connections/account-removal-oauth/calendars/remove", {
        method: "POST",
        json: { calendarIds: [shared!.id] },
      }),
      oauthEnv,
    );
    expect(repeated.status).toBe(200);
    expect(await repeated.json()).toMatchObject({
      connection: { calendars: [{ id: primary!.id }] },
    });

    const unknown = await oauthWorker.fetch(
      request("/v1/connections/account-removal-oauth/calendars/remove", {
        method: "POST",
        json: { calendarIds: ["calendar-unknown"] },
      }),
      oauthEnv,
    );
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ error: "calendar_not_found" });

    const removedLast = await oauthWorker.fetch(
      request("/v1/connections/account-removal-oauth/calendars/remove", {
        method: "POST",
        json: { calendarIds: [primary!.id] },
      }),
      oauthEnv,
    );
    expect(removedLast.status).toBe(200);
    expect(await removedLast.json()).toMatchObject({
      connection: { status: "read-only", calendars: [] },
    });
    const syncedEmpty = await oauthWorker.fetch(
      request("/v1/connections/account-removal-oauth/sync", { method: "POST", json: {} }),
      oauthEnv,
    );
    expect(syncedEmpty.status).toBe(200);
    expect(await syncedEmpty.json()).toMatchObject({
      connection: { status: "read-only", calendars: [] },
    });
    expect(
      await env.CALENDAR_DB.prepare(
        "SELECT COUNT(*) AS count FROM calendar_exclusions WHERE connection_id = ?",
      )
        .bind("account-removal-oauth")
        .first<number>("count"),
    ).toBe(2);
  });

  it("validates bounded event ranges and reports unavailable calendars partially", async () => {
    const invalidRange = await worker.fetch(
      request("/v1/events/query", {
        method: "POST",
        json: {
          timeMin: "2026-01-01T00:00:00Z",
          timeMax: "2026-05-01T00:00:00Z",
          calendarIds: ["calendar-primary"],
        },
      }),
      env,
    );
    expect(invalidRange.status).toBe(400);
    expect(await invalidRange.json()).toMatchObject({ error: "event_range_too_large" });

    await worker.fetch(
      request("/v1/connections/local", {
        method: "POST",
        json: {
          id: "account-events-local",
          provider: "google",
          label: "Local fixture",
          calendars: [calendar("calendar-primary")],
        },
      }),
      env,
    );
    const response = await worker.fetch(
      request("/v1/events/query", {
        method: "POST",
        json: {
          timeMin: "2026-08-10T00:00:00Z",
          timeMax: "2026-08-17T00:00:00Z",
          calendarIds: ["calendar-primary", "calendar-missing"],
        },
      }),
      env,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      timeMin: "2026-08-10T00:00:00.000Z",
      timeMax: "2026-08-17T00:00:00.000Z",
      events: [],
      syncedCalendarIds: [],
      errors: [
        { calendarId: "calendar-missing", code: "calendar_not_found" },
        { calendarId: "calendar-primary", code: "provider_adapter_unavailable" },
      ],
      truncated: false,
    });
  });

  it("bootstraps a bounded rolling Google cache and persists a refreshed encrypted token", async () => {
    const providerCalls: { readonly url: URL; readonly authorization: string | null }[] = [];
    let calendarAccessRole = "owner";
    let liveProviderUnavailable = false;
    let simulateWideBootstrapOverflow = true;
    const providerFetch: typeof fetch = async (input, init) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      const headers = new Headers(init?.headers);
      providerCalls.push({ url, authorization: headers.get("Authorization") });
      if (url.origin === "https://oauth2.googleapis.com" && url.pathname === "/token") {
        const body = new URLSearchParams(typeof init?.body === "string" ? init.body : "");
        if (body.get("grant_type") === "refresh_token") {
          return Response.json({ access_token: "access-new", expires_in: 1, token_type: "Bearer" });
        }
        return Response.json({
          access_token: "access-old",
          refresh_token: "refresh-token",
          expires_in: 60,
          token_type: "Bearer",
        });
      }
      if (url.pathname === "/calendar/v3/users/me/calendarList") {
        return Response.json({
          items: [{
            id: "primary@example.com",
            summary: "Primary",
            accessRole: calendarAccessRole,
            primary: true,
            backgroundColor: "#4285f4",
          }],
        });
      }
      if (url.pathname.endsWith("/events/watch")) {
        const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as {
          readonly id?: string;
          readonly address?: string;
        };
        expect(body.address).toBe(
          "https://calendar-gateway.test/v1/webhooks/google/calendar",
        );
        return Response.json({
          id: body.id,
          resourceId: "registered-resource",
          expiration: String(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });
      }
      if (url.pathname.endsWith("/events")) {
        expect(headers.get("Authorization")).toBe("Bearer access-new");
        expect(url.searchParams.get("singleEvents")).toBe("true");
        if (url.searchParams.get("orderBy") === "startTime") {
          expect(url.searchParams.get("showDeleted")).toBe("false");
          expect(url.searchParams.get("timeZone")).toBe("UTC");
          if (liveProviderUnavailable) {
            return Response.json({ error: { message: "Temporary provider outage" } }, {
              status: 503,
            });
          }
          return Response.json({ items: [] });
        }
        expect(url.searchParams.get("showDeleted")).toBe("true");
        expect(url.searchParams.get("orderBy")).toBeNull();
        expect(url.searchParams.get("timeZone")).toBeNull();
        const syncToken = url.searchParams.get("syncToken");
        if (syncToken) {
          expect(url.searchParams.has("timeMin")).toBe(false);
          if (syncToken === "expired-token") {
            return Response.json({ error: { message: "Sync token is no longer valid" } }, {
              status: 410,
            });
          }
          if (syncToken === "sync-token-2") {
            return Response.json({ error: { message: "Temporary provider outage" } }, {
              status: 503,
            });
          }
          expect(syncToken).toBe("sync-token-1");
          return Response.json({
            nextSyncToken: "sync-token-2",
            items: [{
              id: "event-1",
              status: "cancelled",
              updated: "2026-08-15T12:00:00Z",
            }],
          });
        }
        expect(url.searchParams.has("timeMin")).toBe(true);
        expect(url.searchParams.has("timeMax")).toBe(true);
        const coverageDays = (
          Date.parse(url.searchParams.get("timeMax")!) -
          Date.parse(url.searchParams.get("timeMin")!)
        ) / (24 * 60 * 60 * 1000);
        const futureDays = (
          Date.parse(url.searchParams.get("timeMax")!) - Date.now()
        ) / (24 * 60 * 60 * 1000);
        if (simulateWideBootstrapOverflow && futureDays > 100) {
          const currentPage = Number(url.searchParams.get("pageToken")?.replace("wide-", "") ?? "0");
          return Response.json({ nextPageToken: `wide-${currentPage + 1}`, items: [] });
        }
        if (simulateWideBootstrapOverflow) {
          expect(coverageDays).toBeGreaterThan(120);
          expect(coverageDays).toBeLessThan(122);
          expect(futureDays).toBeGreaterThan(89);
          expect(futureDays).toBeLessThan(91);
          simulateWideBootstrapOverflow = false;
        }
        if (!url.searchParams.has("pageToken")) {
          return Response.json({
            nextPageToken: "page-2",
            items: [{
              id: "event-1",
              summary: "Planning",
              attendees: [
                { email: "host@example.com", responseStatus: "accepted" },
                { email: "primary@example.com", self: true, responseStatus: "needsAction" },
              ],
              status: "confirmed",
              start: { dateTime: "2026-08-14T09:00:00-04:00" },
              end: { dateTime: "2026-08-14T10:00:00-04:00" },
            }],
          });
        }
        expect(url.searchParams.get("pageToken")).toBe("page-2");
        return Response.json({
          nextSyncToken: "sync-token-1",
          items: [{
            id: "event-2",
            summary: "Focus",
            status: "confirmed",
            eventType: "focusTime",
            start: { dateTime: "2026-08-14T15:00:00Z" },
            end: { dateTime: "2026-08-14T16:00:00Z" },
          }],
        });
      }
      return Response.json({ error: { message: `Unexpected provider request: ${url.href}` } }, {
        status: 500,
      });
    };
    const oauthEnv = {
      ...env,
      TOKEN_ENCRYPTION_KEY: testEncryptionKey(),
      GOOGLE_CLIENT_ID: "google-client-id",
      GOOGLE_CLIENT_SECRET: "google-client-secret",
      PUBLIC_BASE_URL: "https://calendar-gateway.test",
    };
    const oauthWorker = createCalendarGatewayWorker(providerFetch);
    const started = await oauthWorker.fetch(
      request("/v1/oauth/google/start", {
        method: "POST",
        json: { id: "account-google-oauth", label: "Google" },
      }),
      oauthEnv,
    );
    const authorization = await started.json<{ readonly authorizationUrl: string }>();
    const state = new URL(authorization.authorizationUrl).searchParams.get("state");
    expect(state).toBeTruthy();
    const completed = await oauthWorker.fetch(
      request(
        `/v1/oauth/google/callback?state=${encodeURIComponent(state!)}&code=authorization-code`,
      ),
      oauthEnv,
    );
    expect(completed.status).toBe(200);
    const calendarId = await env.CALENDAR_DB.prepare(
      "SELECT id FROM provider_calendars WHERE connection_id = ?",
    )
      .bind("account-google-oauth")
      .first<string>("id");
    expect(calendarId).toBeTruthy();
    const ciphertextBefore = await env.CALENDAR_DB.prepare(
      "SELECT credential_ciphertext FROM calendar_connections WHERE id = ?",
    )
      .bind("account-google-oauth")
      .first<string>("credential_ciphertext");

    const queried = await oauthWorker.fetch(
      request("/v1/events/query", {
        method: "POST",
        json: {
          timeMin: "2026-08-10T00:00:00Z",
          timeMax: "2026-08-17T00:00:00Z",
          calendarIds: [calendarId],
        },
      }),
      oauthEnv,
    );
    expect(queried.status).toBe(200);
    const result = await queried.json<{
      readonly events: readonly { readonly title: string; readonly kind: string }[];
      readonly syncedCalendarIds: readonly string[];
      readonly servedCalendarIds: readonly string[];
      readonly cache: {
        readonly calendars: readonly {
          readonly cacheRevision: number;
          readonly freshness: string;
          readonly coverageTimeMin: string;
          readonly coverageTimeMax: string;
          readonly coversRequestedRange: boolean;
        }[];
      };
      readonly errors: readonly unknown[];
      readonly truncated: boolean;
    }>();
    expect(result.events).toMatchObject([
      { title: "Planning", kind: "meeting", status: "pending", attendees: [{ responseStatus: "accepted", isCurrentUser: false }, { responseStatus: "needsAction", isCurrentUser: true }] },
      { title: "Focus", kind: "focus" },
    ]);
    expect(result.syncedCalendarIds).toEqual([calendarId]);
    expect(result.servedCalendarIds).toEqual([calendarId]);
    expect(result.cache.calendars).toMatchObject([{
      cacheRevision: 1,
      freshness: "fresh",
      coverageTimeMin: expect.any(String),
      coverageTimeMax: expect.any(String),
      coversRequestedRange: true,
    }]);
    expect(
      Date.parse(result.cache.calendars[0]!.coverageTimeMax),
    ).toBeGreaterThan(Date.parse("2026-11-01T00:00:00Z"));
    expect(
      await env.CALENDAR_DB.prepare(
        "SELECT COUNT(*) AS count FROM calendar_watch_channels WHERE calendar_id = ?",
      )
        .bind(calendarId)
        .first<number>("count"),
    ).toBe(1);
    expect(result.errors).toEqual([]);
    expect(result.truncated).toBe(false);
    const bootstrapEventCalls = providerCalls.filter(call =>
      call.url.pathname.endsWith("/events")
    ).length;
    expect(bootstrapEventCalls).toBe(22);
    await env.CALENDAR_DB.prepare(
      "UPDATE calendar_sync_state SET next_sync_at = ? WHERE calendar_id = ?",
    )
      .bind("2000-01-01T00:00:00.000Z", calendarId)
      .run();
    const incremented = await oauthWorker.fetch(
      request("/v1/events/query", {
        method: "POST",
        json: {
          timeMin: "2026-08-10T00:00:00Z",
          timeMax: "2026-08-17T00:00:00Z",
          calendarIds: [calendarId],
        },
      }),
      oauthEnv,
    );
    expect(await incremented.json()).toMatchObject({
      syncedCalendarIds: [calendarId],
      servedCalendarIds: [calendarId],
      events: [{ title: "Focus" }],
      cache: { calendars: [{ cacheRevision: 2, freshness: "fresh" }] },
    });
    expect(providerCalls.filter(call => call.url.pathname.endsWith("/events"))).toHaveLength(
      bootstrapEventCalls + 1,
    );

    await env.CALENDAR_DB.prepare(
      `UPDATE calendar_sync_state
          SET sync_token = 'expired-token', next_sync_at = ?
        WHERE calendar_id = ?`,
    )
      .bind("2000-01-01T00:00:00.000Z", calendarId)
      .run();
    const resynchronized = await oauthWorker.fetch(
      request("/v1/events/query", {
        method: "POST",
        json: {
          timeMin: "2026-08-10T00:00:00Z",
          timeMax: "2026-08-17T00:00:00Z",
          calendarIds: [calendarId],
        },
      }),
      oauthEnv,
    );
    expect(await resynchronized.json()).toMatchObject({
      events: [{ title: "Planning" }, { title: "Focus" }],
      cache: { calendars: [{ cacheRevision: 3, freshness: "fresh" }] },
    });
    expect(providerCalls.filter(call => call.url.pathname.endsWith("/events"))).toHaveLength(
      bootstrapEventCalls + 4,
    );
    const cached = await oauthWorker.fetch(
      request("/v1/events/query", {
        method: "POST",
        json: {
          timeMin: "2026-08-10T00:00:00Z",
          timeMax: "2026-08-17T00:00:00Z",
          calendarIds: [calendarId],
        },
      }),
      oauthEnv,
    );
    expect(cached.status).toBe(200);
    expect(await cached.json()).toMatchObject({
      source: "cache",
      servedCalendarIds: [calendarId],
      syncedCalendarIds: [],
      events: [{ title: "Planning" }, { title: "Focus" }],
    });
    expect(providerCalls.filter(call => call.url.pathname.endsWith("/events"))).toHaveLength(
      bootstrapEventCalls + 4,
    );
    const rediscovered = await oauthWorker.fetch(
      request("/v1/connections/account-google-oauth/sync", { method: "POST", json: {} }),
      oauthEnv,
    );
    expect(rediscovered.status).toBe(200);
    expect(
      await env.CALENDAR_DB.prepare(
        "SELECT cache_revision FROM calendar_sync_state WHERE calendar_id = ?",
      )
        .bind(calendarId)
        .first<number>("cache_revision"),
    ).toBe(3);
    expect(
      await env.CALENDAR_DB.prepare(
        `SELECT COUNT(*) AS count FROM calendar_event_cache
          WHERE calendar_id = ? AND tombstoned = 0`,
      )
        .bind(calendarId)
        .first<number>("count"),
    ).toBe(2);
    const webhookToken = "calendar-webhook-token";
    await env.CALENDAR_DB.prepare(
      `INSERT INTO calendar_watch_channels
        (channel_id, workspace_id, connection_id, calendar_id, token_hash, resource_id,
         expiration_at, created_at, last_notification_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    )
      .bind(
        "test-channel",
        workspace,
        "account-google-oauth",
        calendarId,
        await sha256Base64Url(webhookToken),
        "test-resource",
        "2099-01-01T00:00:00.000Z",
        "2026-08-15T00:00:00.000Z",
      )
      .run();
    const background: Promise<unknown>[] = [];
    const webhook = await oauthWorker.fetch(new Request(
      "https://calendar-gateway.test/v1/webhooks/google/calendar",
      {
        method: "POST",
        headers: {
          "X-Goog-Channel-ID": "test-channel",
          "X-Goog-Channel-Token": webhookToken,
          "X-Goog-Resource-ID": "test-resource",
          "X-Goog-Resource-State": "exists",
        },
      },
    ), oauthEnv, {
      waitUntil(promise: Promise<unknown>) {
        background.push(promise);
      },
    } as unknown as ExecutionContext);
    expect(webhook.status).toBe(202);
    await Promise.all(background);
    expect(
      await env.CALENDAR_DB.prepare(
        "SELECT cache_revision FROM calendar_sync_state WHERE calendar_id = ?",
      )
        .bind(calendarId)
        .first<number>("cache_revision"),
    ).toBe(4);
    expect(
      await env.CALENDAR_DB.prepare(
        "SELECT last_notification_at FROM calendar_watch_channels WHERE channel_id = ?",
      )
        .bind("test-channel")
        .first<string>("last_notification_at"),
    ).toBeTruthy();
    const confirmationPayload = {
      timeMin: "2026-08-14T17:00:00Z",
      timeMax: "2026-08-14T17:30:00Z",
      calendarIds: [calendarId],
      idempotencyKey: "google-confirmation-1",
    };
    const confirmation = await oauthWorker.fetch(
      request("/v1/availability/confirm", {
        method: "POST",
        json: confirmationPayload,
      }),
      oauthEnv,
    );
    expect(confirmation.status).toBe(200);
    expect(await confirmation.json()).toMatchObject({
      availabilityConfirmed: true,
      available: true,
      conclusive: true,
      idempotentReplay: false,
    });
    const callsBeforeReplay = providerCalls.length;
    liveProviderUnavailable = true;
    const confirmationReplay = await oauthWorker.fetch(
      request("/v1/availability/confirm", {
        method: "POST",
        json: confirmationPayload,
      }),
      oauthEnv,
    );
    expect(confirmationReplay.status).toBe(200);
    expect(await confirmationReplay.json()).toMatchObject({
      availabilityConfirmed: true,
      idempotentReplay: true,
    });
    expect(providerCalls).toHaveLength(callsBeforeReplay);
    const mcpEvents = await oauthWorker.fetch(
      request("/mcp", {
        method: "POST",
        json: {
          jsonrpc: "2.0",
          id: "events",
          method: "tools/call",
          params: {
            name: "list_events",
            arguments: {
              timeMin: "2026-08-10T00:00:00Z",
              timeMax: "2026-08-17T00:00:00Z",
              calendarIds: [calendarId],
              includeDetails: true,
            },
          },
        },
      }),
      oauthEnv,
    );
    expect(await mcpEvents.json()).toMatchObject({
      result: {
        structuredContent: {
          detailsIncluded: false,
          events: [{ title: "Busy", attendees: [], location: null }],
        },
      },
    });
    await env.CALENDAR_DB.prepare(
      "UPDATE calendar_sync_state SET next_sync_at = ? WHERE calendar_id = ?",
    )
      .bind("2000-01-01T00:00:00.000Z", calendarId)
      .run();
    const unavailableSlots = await oauthWorker.fetch(
      request("/mcp", {
        method: "POST",
        json: {
          jsonrpc: "2.0",
          id: "slots",
          method: "tools/call",
          params: {
            name: "find_available_slots",
            arguments: {
              timeMin: "2026-08-14T14:00:00Z",
              timeMax: "2026-08-14T17:00:00Z",
              calendarIds: [calendarId],
              durationMinutes: 30,
            },
          },
        },
      }),
      oauthEnv,
    );
    expect(await unavailableSlots.json()).toMatchObject({
      error: {
        code: -32602,
        message: "Every requested calendar must have a complete fresh cache before proposing a time.",
      },
    });

    // A fresh legacy snapshot must be rebuilt even without a provider change.
    // The existing sync-token-2 would fail if this tried an incremental sync.
    await env.CALENDAR_DB.prepare(
      "UPDATE calendar_sync_state SET projection_version = 0, freshness = 'fresh', next_sync_at = '2099-01-01T00:00:00Z' WHERE calendar_id = ?",
    ).bind(calendarId).run();
    const callsBeforeUpgrade = providerCalls.length;
    const upgraded = await oauthWorker.fetch(request("/v1/events/query", {
      method: "POST",
      json: { timeMin: "2026-08-10T00:00:00Z", timeMax: "2026-08-17T00:00:00Z", calendarIds: [calendarId] },
    }), oauthEnv);
    expect(await upgraded.json()).toMatchObject({ events: [
      { title: "Planning", attendees: [{ responseStatus: "accepted" }, { responseStatus: "needsAction", isCurrentUser: true }] },
      { title: "Focus" },
    ] });
    const upgradeCalls = providerCalls.slice(callsBeforeUpgrade).filter(call => call.url.pathname.endsWith("/events"));
    expect(upgradeCalls.length).toBeGreaterThan(0);
    expect(upgradeCalls.every(call => !call.url.searchParams.has("syncToken"))).toBe(true);
    expect(await env.CALENDAR_DB.prepare("SELECT projection_version FROM calendar_sync_state WHERE calendar_id = ?")
      .bind(calendarId).first<number>("projection_version")).toBe(1);

    calendarAccessRole = "freeBusyReader";
    const downgraded = await oauthWorker.fetch(
      request("/v1/connections/account-google-oauth/sync", { method: "POST", json: {} }),
      oauthEnv,
    );
    expect(downgraded.status).toBe(200);
    expect(
      await env.CALENDAR_DB.prepare(
        "SELECT COUNT(*) AS count FROM calendar_event_cache WHERE calendar_id = ?",
      )
        .bind(calendarId)
        .first<number>("count"),
    ).toBe(0);
    expect(
      await env.CALENDAR_DB.prepare(
        "SELECT COUNT(*) AS count FROM calendar_sync_state WHERE calendar_id = ?",
      )
        .bind(calendarId)
        .first<number>("count"),
    ).toBe(0);
    const repairStatements: D1PreparedStatement[] = [];
    for (let index = 0; index < 21; index += 1) {
      const repairCalendarId = `repair-calendar-${String(index).padStart(2, "0")}`;
      repairStatements.push(
        env.CALENDAR_DB.prepare(
          `INSERT INTO provider_calendars
            (id, connection_id, provider_calendar_id, name, color, role, writable,
             freshness, is_primary, raw_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'owner', 1, 'live', 0, '{}', ?, ?)`,
        ).bind(
          repairCalendarId,
          "account-google-oauth",
          `${repairCalendarId}@provider.test`,
          repairCalendarId,
          "#4285f4",
          "2026-08-15T00:00:00.000Z",
          "2026-08-15T00:00:00.000Z",
        ),
        env.CALENDAR_DB.prepare(
          `INSERT INTO calendar_sync_state
            (workspace_id, connection_id, calendar_id, active_generation, cache_revision,
             sync_token, cache_time_min, freshness, last_attempt_at, last_success_at,
             next_sync_at, error_code, error_message, consecutive_failures, lease_until,
             current_watch_channel_id, watch_expiration_at, last_notification_at)
           VALUES (?, ?, ?, ?, 0, NULL, NULL, 'pending', NULL, NULL, ?, NULL, NULL, 0,
                   NULL, NULL, NULL, NULL)`,
        ).bind(
          workspace,
          "account-google-oauth",
          repairCalendarId,
          `initial-${index}`,
          "2000-01-01T00:00:00.000Z",
        ),
      );
    }
    await env.CALENDAR_DB.batch(repairStatements);
    const refreshCallsBeforeRepair = providerCalls.filter(call =>
      call.url.origin === "https://oauth2.googleapis.com" && call.url.pathname === "/token"
    ).length;
    const scheduledWork: Promise<unknown>[] = [];
    oauthWorker.scheduled({
      cron: "*/5 * * * *",
      scheduledTime: Date.now(),
      noRetry() {},
    } as unknown as ScheduledController, oauthEnv, {
      waitUntil(promise: Promise<unknown>) {
        scheduledWork.push(promise);
      },
    } as unknown as ExecutionContext);
    await Promise.all(scheduledWork);
    expect(
      await env.CALENDAR_DB.prepare(
        "SELECT COUNT(*) AS count FROM calendar_sync_state WHERE cache_revision > 0",
      ).first<number>("count"),
    ).toBe(20);
    expect(
      await env.CALENDAR_DB.prepare(
        "SELECT COUNT(*) AS count FROM calendar_sync_state WHERE cache_revision = 0",
      ).first<number>("count"),
    ).toBe(1);
    expect(providerCalls.filter(call =>
      call.url.origin === "https://oauth2.googleapis.com" && call.url.pathname === "/token"
    ).length).toBe(refreshCallsBeforeRepair + 1);
    expect(providerCalls.some(call => call.url.pathname === "/token" &&
      call.authorization === null)).toBe(true);
    const ciphertextAfter = await env.CALENDAR_DB.prepare(
      "SELECT credential_ciphertext FROM calendar_connections WHERE id = ?",
    )
      .bind("account-google-oauth")
      .first<string>("credential_ciphertext");
    expect(ciphertextAfter).not.toBe(ciphertextBefore);
  });

  it("serves real bearer-only guest management routes through Turnstile and Google", async () => {
    const publicOrigin = "https://cal.with-tap.ai";
    const connectionId = "account-google-public-management";
    const slotSigningKey = "route-management-slot-signing-key-at-least-32-bytes";
    const providerEvents = new Map<string, Record<string, unknown>>();
    const providerEventCalendars = new Map<string, string>();
    const siteverifyTokens: string[] = [];
    const patchRequests: { readonly sendUpdates: string | null; readonly ifMatch: string | null }[] = [];
    const deleteRequests: { readonly sendUpdates: string | null; readonly ifMatch: string | null }[] = [];
    let patchCalls = 0;
    let deleteCalls = 0;

    const providerFetch: typeof fetch = async (input, init) => {
      const providerRequest = input instanceof Request ? input : new Request(input, init);
      const url = new URL(providerRequest.url);
      if (url.origin === "https://challenges.cloudflare.com" && url.pathname.endsWith("/siteverify")) {
        const form = await providerRequest.clone().formData();
        const responseToken = String(form.get("response") ?? "");
        siteverifyTokens.push(responseToken);
        if (responseToken === "invalid-reschedule-turnstile") {
          return Response.json({ success: false, "error-codes": ["invalid-input-response"] });
        }
        return Response.json({
          success: true,
          action: responseToken.startsWith("reschedule-")
            ? "public_booking_reschedule"
            : "public_booking",
          hostname: "cal.with-tap.ai",
          challenge_ts: new Date().toISOString(),
        });
      }
      if (url.origin === "https://oauth2.googleapis.com" && url.pathname === "/token") {
        return Response.json({
          access_token: "public-management-access-token",
          refresh_token: "public-management-refresh-token",
          expires_in: 3_600,
          token_type: "Bearer",
        });
      }
      if (url.pathname === "/calendar/v3/users/me/calendarList") {
        return Response.json({
          items: [{
            id: "public-management@example.com",
            summary: "Public management calendar",
            accessRole: "owner",
            primary: true,
            backgroundColor: "#6758e8",
          }],
        });
      }
      if (url.pathname === "/calendar/v3/freeBusy") {
        const body = await providerRequest.clone().json<{
          readonly timeMin: string;
          readonly timeMax: string;
          readonly items: readonly { readonly id: string }[];
        }>();
        return Response.json({
          timeMin: body.timeMin,
          timeMax: body.timeMax,
          calendars: Object.fromEntries(body.items.map(item => [item.id, { busy: [] }])),
        });
      }
      const collectionMatch = url.pathname.match(
        /^\/calendar\/v3\/calendars\/([^/]+)\/events$/u,
      );
      const itemMatch = url.pathname.match(
        /^\/calendar\/v3\/calendars\/([^/]+)\/events\/([^/]+)$/u,
      );
      if (itemMatch?.[1] && itemMatch[2]) {
        const providerCalendarId = decodeURIComponent(itemMatch[1]);
        const eventId = decodeURIComponent(itemMatch[2]);
        const existing = providerEventCalendars.get(eventId) === providerCalendarId
          ? providerEvents.get(eventId)
          : undefined;
        if (providerRequest.method === "GET") {
          return existing
            ? Response.json(existing)
            : Response.json({ error: { message: "Not found" } }, { status: 404 });
        }
        if (providerRequest.method === "PATCH") {
          patchCalls += 1;
          patchRequests.push({
            sendUpdates: url.searchParams.get("sendUpdates"),
            ifMatch: providerRequest.headers.get("If-Match"),
          });
          if (!existing) {
            return Response.json({ error: { message: "Not found" } }, { status: 404 });
          }
          const body = await providerRequest.clone().json<Record<string, unknown>>();
          const updated = {
            ...existing,
            ...body,
            id: eventId,
            status: "confirmed",
            etag: `"${eventId}-v${patchCalls + 1}"`,
            updated: new Date().toISOString(),
          };
          providerEvents.set(eventId, updated);
          return Response.json(updated);
        }
        if (providerRequest.method === "DELETE") {
          deleteCalls += 1;
          deleteRequests.push({
            sendUpdates: url.searchParams.get("sendUpdates"),
            ifMatch: providerRequest.headers.get("If-Match"),
          });
          if (!existing) {
            return Response.json({ error: { message: "Not found" } }, { status: 404 });
          }
          providerEvents.delete(eventId);
          providerEventCalendars.delete(eventId);
          return new Response(null, { status: 204 });
        }
      }
      if (collectionMatch?.[1]) {
        const providerCalendarId = decodeURIComponent(collectionMatch[1]);
        if (providerRequest.method === "POST") {
          const body = await providerRequest.clone().json<Record<string, unknown>>();
          const eventId = String(body.id ?? "");
          const event = {
            ...body,
            id: eventId,
            status: "confirmed",
            etag: `"${eventId}-v1"`,
            updated: new Date().toISOString(),
            htmlLink: `https://calendar.google.com/event?eid=${eventId}`,
            hangoutLink: "https://meet.google.com/public-management",
            conferenceData: {
              conferenceSolution: { key: { type: "hangoutsMeet" } },
              entryPoints: [{
                entryPointType: "video",
                uri: "https://meet.google.com/public-management",
              }],
            },
          };
          providerEvents.set(eventId, event);
          providerEventCalendars.set(eventId, providerCalendarId);
          return Response.json(event);
        }
        const timeMin = Date.parse(url.searchParams.get("timeMin") ?? "");
        const timeMax = Date.parse(url.searchParams.get("timeMax") ?? "");
        const items = [...providerEvents.entries()].flatMap(([eventId, event]) => {
          if (providerEventCalendars.get(eventId) !== providerCalendarId) return [];
          const start = isRecordForTest(event.start) && typeof event.start.dateTime === "string"
            ? Date.parse(event.start.dateTime)
            : Number.NaN;
          const end = isRecordForTest(event.end) && typeof event.end.dateTime === "string"
            ? Date.parse(event.end.dateTime)
            : Number.NaN;
          return start < timeMax && end > timeMin ? [event] : [];
        });
        return Response.json({ items });
      }
      return Response.json(
        { error: { message: `Unexpected provider request: ${url.href}` } },
        { status: 500 },
      );
    };

    const runtimeEnv = {
      ...env,
      ALLOWED_ORIGINS: `${origin},${publicOrigin}`,
      TOKEN_ENCRYPTION_KEY: testEncryptionKey(),
      GOOGLE_CLIENT_ID: "google-client-id",
      GOOGLE_CLIENT_SECRET: "google-client-secret",
      PUBLIC_BASE_URL: "",
      PUBLIC_BOOKING_BASE_URL: publicOrigin,
      PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
      TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
      PUBLIC_BOOKING_SLOT_SIGNING_KEY: slotSigningKey,
      PUBLIC_BOOKING_MANAGEMENT_SECRET: "public-management-route-secret-at-least-32-bytes",
    };
    const publicRequest = (
      path: string,
      init: RequestInit & { readonly json?: unknown } = {},
    ): Request => {
      const headers = new Headers(init.headers);
      headers.set("Origin", publicOrigin);
      if (init.json !== undefined) headers.set("Content-Type", "application/json");
      return new Request(`https://calendar-gateway.test${path}`, {
        ...init,
        headers,
        ...(init.json === undefined ? {} : { body: JSON.stringify(init.json) }),
      });
    };
    const routeWorker = createCalendarGatewayWorker(providerFetch);
    const started = await routeWorker.fetch(request("/v1/oauth/google/start", {
      method: "POST",
      json: { id: connectionId, label: "Public management Google" },
    }), runtimeEnv);
    expect(started.status).toBe(201);
    const authorizationUrl = (await started.json<{ authorizationUrl: string }>()).authorizationUrl;
    const state = new URL(authorizationUrl).searchParams.get("state");
    const connected = await routeWorker.fetch(request(
      `/v1/oauth/google/callback?state=${encodeURIComponent(state!)}&code=public-management-code`,
    ), runtimeEnv);
    expect(connected.status).toBe(200);
    const calendarId = await env.CALENDAR_DB.prepare(
      "SELECT id FROM provider_calendars WHERE connection_id = ?",
    ).bind(connectionId).first<string>("id");
    expect(calendarId).toBeTruthy();

    const published = await routeWorker.fetch(request("/v1/publications/profiles", {
      method: "POST",
      json: {
        schemaVersion: "tap.calendar.profile-publication.v1",
        expectedGeneration: 0,
        publications: [{
          schemaVersion: "tap.calendar.publication.v1",
          sourceProfileId: "profile-route-management",
          profileSlug: "route-owner",
          displayName: "Route Owner",
          ownerType: "individual",
          sourceEventTypeId: "event-route-management",
          eventTypeSlug: "30min",
          title: "Route management meeting",
          description: "A real public management route test.",
          durationMinutes: 30,
          approvalRequired: false,
          location: "google-meet",
          destinationCalendarId: calendarId,
          conflictCalendarIds: [calendarId],
          sourceAvailabilityScheduleId: "availability-route-management",
          schedule: {
            timeZone: "America/New_York",
            preferredStart: "09:00",
            preferredEnd: "17:00",
            bufferBeforeMinutes: 5,
            bufferAfterMinutes: 10,
            minimumNoticeMinutes: 0,
            bookingHorizonDays: 60,
            windows: Array.from({ length: 7 }, (_, day) => ({
              day,
              enabled: true,
              start: "09:00",
              end: "17:00",
            })),
            overrides: [],
          },
        }],
      },
    }), runtimeEnv);
    expect(published.status).toBe(200);
    const publication = await published.json<{
      publication: { pages: readonly { revisionId: string }[] };
    }>();
    const revisionId = publication.publication.pages[0]!.revisionId;
    const availability = await routeWorker.fetch(publicRequest(
      "/api/public/pages/route-owner/30min/availability" +
      `?month=2026-08-01&timeZone=America%2FNew_York&pageRevision=${encodeURIComponent(revisionId)}`,
    ), runtimeEnv);
    expect(availability.status).toBe(200);
    const slots = (await availability.json<{
      dates: readonly { slots: readonly { start: string; end: string; token: string }[] }[];
    }>()).dates.flatMap(date => date.slots);
    expect(slots.length).toBeGreaterThan(1);
    const originalSlot = slots[0]!;
    const adjacentSlot = slots[1]!;
    expect(Date.parse(adjacentSlot.start) - Date.parse(originalSlot.end)).toBe(0);

    const created = await routeWorker.fetch(publicRequest(
      "/api/public/pages/route-owner/30min/bookings",
      {
        method: "POST",
        json: {
          schemaVersion: "tap.calendar.public-booking.v1",
          requestId: "30cf25a1-e97f-4c50-bc4b-6d86d12ed239",
          slotToken: originalSlot.token,
          guest: { name: "Route Guest", email: "route-guest@example.com" },
          turnstileToken: "create-turnstile-token",
        },
      },
    ), runtimeEnv);
    expect(created.status).toBe(201);
    const creation = await created.json<{
      readonly managementUrl: string;
      readonly bookingReference: string;
    }>();
    const managementToken = new URL(creation.managementUrl).hash.slice(1);
    expect(managementToken).toMatch(/^tapm_v1_[A-Za-z0-9_-]{43}$/u);

    const unavailable = {
      error: "management_link_unavailable",
      message: "This booking management link is unavailable.",
    };
    const invalidManagementRequests = [
      publicRequest("/api/public/manage"),
      publicRequest("/api/public/manage", {
        headers: { Authorization: "Bearer malformed" },
      }),
      publicRequest("/api/public/manage", {
        headers: { Authorization: `Bearer tapm_v1_${"A".repeat(43)}` },
      }),
      publicRequest(`/api/public/manage?token=${encodeURIComponent(managementToken)}`, {
        headers: { Authorization: `Bearer ${managementToken}` },
      }),
      publicRequest(`/api/public/manage/${encodeURIComponent(managementToken)}`, {
        headers: { Authorization: `Bearer ${managementToken}` },
      }),
    ];
    for (const invalidRequest of invalidManagementRequests) {
      const response = await routeWorker.fetch(invalidRequest, runtimeEnv);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual(unavailable);
    }

    const authorization = { Authorization: `Bearer ${managementToken}` };
    const read = await routeWorker.fetch(publicRequest("/api/public/manage", {
      headers: {
        ...authorization,
        "X-TAP-Workspace-Id": "spoofed-workspace",
        "X-TAP-Principal-Id": "spoofed-principal",
      },
    }), runtimeEnv);
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({
      schemaVersion: "tap.calendar.public-management.v1",
      bookingReference: creation.bookingReference,
      bookingVersion: 1,
      status: "confirmed",
      guest: { name: "Route Guest", email: "route-guest@example.com" },
      actions: { canCancel: true, canReschedule: true },
      reschedulePage: { profileSlug: "route-owner", eventTypeSlug: "30min" },
    });

    const strictBody = await routeWorker.fetch(publicRequest(
      "/api/public/manage/cancel",
      {
        method: "POST",
        headers: authorization,
        json: {
          schemaVersion: "tap.calendar.public-management-cancel.v1",
          requestId: "87b924b5-4fe0-4a37-997b-0bca64cb48ba",
          expectedVersion: 1,
          extra: true,
        },
      },
    ), runtimeEnv);
    expect(strictBody.status).toBe(400);
    expect(await strictBody.json()).toMatchObject({ error: "invalid_management_request" });
    expect(deleteCalls).toBe(0);

    const rescheduleBody = {
      schemaVersion: "tap.calendar.public-management-reschedule.v1",
      requestId: "8b485558-b3a7-4924-aaee-d1b18690ce10",
      expectedVersion: 1,
      slotToken: adjacentSlot.token,
      turnstileToken: "invalid-reschedule-turnstile",
    };
    const rejectedReschedule = await routeWorker.fetch(publicRequest(
      "/api/public/manage/reschedule",
      { method: "POST", headers: authorization, json: rescheduleBody },
    ), runtimeEnv);
    expect(rejectedReschedule.status).toBe(403);
    expect(await rejectedReschedule.json()).toMatchObject({ error: "turnstile_failed" });
    expect(patchCalls).toBe(0);

    const rescheduled = await routeWorker.fetch(publicRequest(
      "/api/public/manage/reschedule",
      {
        method: "POST",
        headers: {
          ...authorization,
          "X-TAP-Workspace-Id": "another-spoofed-workspace",
          "X-TAP-Principal-Id": "another-spoofed-principal",
        },
        json: {
          ...rescheduleBody,
          turnstileToken: "reschedule-valid-turnstile",
        },
      },
    ), runtimeEnv);
    const rescheduledBody = await rescheduled.json<Record<string, unknown>>();
    expect({ status: rescheduled.status, body: rescheduledBody }).toMatchObject({
      status: 200,
      body: {
        bookingVersion: 2,
        status: "confirmed",
        event: { startsAt: adjacentSlot.start, endsAt: adjacentSlot.end },
      },
    });
    expect(siteverifyTokens).toEqual([
      "create-turnstile-token",
      "invalid-reschedule-turnstile",
      "reschedule-valid-turnstile",
    ]);
    expect(patchCalls).toBe(1);
    expect(patchRequests).toEqual([{ sendUpdates: "all", ifMatch: expect.any(String) }]);

    const cancelled = await routeWorker.fetch(publicRequest(
      "/api/public/manage/cancel",
      {
        method: "POST",
        headers: authorization,
        json: {
          schemaVersion: "tap.calendar.public-management-cancel.v1",
          requestId: "4257a894-4bc6-48af-bf04-85f8ee303c0c",
          expectedVersion: 2,
        },
      },
    ), runtimeEnv);
    expect(cancelled.status).toBe(200);
    expect(await cancelled.json()).toMatchObject({
      bookingVersion: 3,
      status: "cancelled",
      actions: { canCancel: false, canReschedule: false },
    });
    expect(deleteCalls).toBe(1);
    expect(deleteRequests).toEqual([{ sendUpdates: "all", ifMatch: expect.any(String) }]);
    const lifecycleEmails = (await env.CALENDAR_DB.prepare(
      `SELECT kind FROM public_booking_email_outbox
        WHERE booking_reference = ? ORDER BY kind`,
    ).bind(creation.bookingReference).all<{ readonly kind: string }>()).results;
    expect(lifecycleEmails.map(row => row.kind)).toEqual([
      "booking-cancelled",
      "booking-confirmed",
      "booking-rescheduled",
    ]);
  });

  it("commits and resolves Google bookings idempotently at the provider boundary", async () => {
    const providerEvents = new Map<string, Record<string, unknown>>();
    const providerEventCalendars = new Map<string, string>();
    const insertedBodies: Record<string, unknown>[] = [];
    const patchedBodies: Record<string, unknown>[] = [];
    const patchRequests: { readonly sendUpdates: string | null; readonly ifMatch: string | null }[] = [];
    const deleteRequests: { readonly sendUpdates: string | null; readonly ifMatch: string | null }[] = [];
    const zoomCreatedBodies: Record<string, unknown>[] = [];
    const zoomUpdatedBodies: Record<string, unknown>[] = [];
    const zoomDeletedMeetingIds: string[] = [];
    const zoomMeetingSchedules = new Map<
      string,
      { readonly startTime: string; readonly durationMinutes: number }
    >();
    const googlePatchTransientFailures = new Set<string>();
    const googleDeletePreconditionFailures = new Set<string>();
    const goneProviderEvents = new Set<string>();
    let insertCalls = 0;
    let patchCalls = 0;
    let deleteCalls = 0;
    let liveProviderUnavailable = false;
    let unavailableLiveProviderCalendar: string | null = null;
    let failInsertAfterWrite = false;
    let deferMeetConference = false;
    const providerFetch: typeof fetch = async (input, init) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      const headers = new Headers(init?.headers);
      if (url.origin === "https://oauth2.googleapis.com" && url.pathname === "/token") {
        return Response.json({
          access_token: "booking-access-token",
          refresh_token: "booking-refresh-token",
          expires_in: 3600,
          token_type: "Bearer",
        });
      }
      if (url.origin === "https://zoom.us" && url.pathname === "/oauth/token") {
        expect(headers.get("Authorization")).toBe(
          `Basic ${btoa("zoom-client-id:zoom-client-secret")}`,
        );
        return Response.json({
          access_token: "zoom-booking-access-token",
          refresh_token: "zoom-booking-refresh-token",
          expires_in: 3600,
          token_type: "Bearer",
          scope: [
            "user:read:user",
            "meeting:write:meeting",
            "meeting:update:meeting",
            "meeting:delete:meeting",
          ].join(" "),
        });
      }
      if (url.origin === "https://api.zoom.us" && url.pathname === "/v2/users/me") {
        expect(headers.get("Authorization")).toBe("Bearer zoom-booking-access-token");
        return Response.json({
          id: "zoom-user-booking",
          account_id: "zoom-account-booking",
          email: "organizer@example.com",
          display_name: "Booking Organizer",
          status: "active",
          type: 2,
          timezone: "America/New_York",
        });
      }
      if (
        url.origin === "https://api.zoom.us" &&
        url.pathname === "/v2/users/me/meetings" &&
        init?.method === "POST"
      ) {
        expect(headers.get("Authorization")).toBe("Bearer zoom-booking-access-token");
        const body = JSON.parse(
          typeof init.body === "string" ? init.body : "{}",
        ) as Record<string, unknown>;
        zoomCreatedBodies.push(body);
        const meetingId = String(98_765_432_100 + zoomCreatedBodies.length);
        zoomMeetingSchedules.set(meetingId, {
          startTime: String(body.start_time),
          durationMinutes: Number(body.duration),
        });
        return Response.json({
          id: Number(meetingId),
          uuid: `zoom-booking-uuid-${meetingId}`,
          join_url: `https://us02web.zoom.us/j/${meetingId}?pwd=tap`,
          start_url: `https://us02web.zoom.us/s/${meetingId}?zak=sensitive`,
        }, { status: 201 });
      }
      const zoomMeetingMatch = url.origin === "https://api.zoom.us"
        ? url.pathname.match(/^\/v2\/meetings\/(\d{9,11})$/u)
        : null;
      if (zoomMeetingMatch?.[1] && init?.method === "PATCH") {
        expect(headers.get("Authorization")).toBe("Bearer zoom-booking-access-token");
        const body = JSON.parse(
          typeof init.body === "string" ? init.body : "{}",
        ) as Record<string, unknown>;
        zoomUpdatedBodies.push(body);
        const currentSchedule = zoomMeetingSchedules.get(zoomMeetingMatch[1]);
        if (currentSchedule) {
          zoomMeetingSchedules.set(zoomMeetingMatch[1], {
            startTime: typeof body.start_time === "string"
              ? body.start_time
              : currentSchedule.startTime,
            durationMinutes: typeof body.duration === "number"
              ? body.duration
              : currentSchedule.durationMinutes,
          });
        }
        return new Response(null, { status: 204 });
      }
      if (zoomMeetingMatch?.[1] && init?.method === "DELETE") {
        expect(headers.get("Authorization")).toBe("Bearer zoom-booking-access-token");
        zoomDeletedMeetingIds.push(zoomMeetingMatch[1]);
        zoomMeetingSchedules.delete(zoomMeetingMatch[1]);
        return new Response(null, { status: 204 });
      }
      if (url.pathname === "/calendar/v3/users/me/calendarList") {
        return Response.json({
          items: [{
            id: "booking-primary@example.com",
            summary: "Booking Primary",
            accessRole: "owner",
            primary: true,
            backgroundColor: "#4285f4",
          }, {
            id: "booking-secondary@example.com",
            summary: "Booking Secondary",
            accessRole: "owner",
            primary: false,
            backgroundColor: "#34a853",
          }],
        });
      }
      const calendarMatch = url.pathname.match(/\/calendar\/v3\/calendars\/([^/]+)\/events/u);
      const providerCalendarId = calendarMatch?.[1]
        ? decodeURIComponent(calendarMatch[1])
        : null;
      const eventMatch = url.pathname.match(/\/events\/([^/]+)$/u);
      if (eventMatch?.[1]) {
        expect(headers.get("Authorization")).toBe("Bearer booking-access-token");
        const eventId = decodeURIComponent(eventMatch[1]);
        const method = init?.method ?? "GET";
        if (method === "GET") {
          const event = providerEventCalendars.get(eventId) === providerCalendarId
            ? providerEvents.get(eventId)
            : undefined;
          return event
            ? Response.json(event)
            : Response.json(
                { error: { message: goneProviderEvents.has(eventId) ? "Gone" : "Not found" } },
                { status: goneProviderEvents.has(eventId) ? 410 : 404 },
              );
        }
        if (method === "PATCH") {
          patchCalls += 1;
          patchRequests.push({
            sendUpdates: url.searchParams.get("sendUpdates"),
            ifMatch: headers.get("If-Match"),
          });
          const existing = providerEvents.get(eventId);
          if (!existing) return Response.json({ error: { message: "Not found" } }, { status: 404 });
          const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<string, unknown>;
          patchedBodies.push(body);
          if (googlePatchTransientFailures.has(eventId)) {
            return Response.json({ error: { message: "Temporary provider failure" } }, {
              status: 503,
            });
          }
          const withConference = isRecordForTest(body.conferenceData) && !deferMeetConference
            ? {
              hangoutLink: `https://meet.google.com/${eventId.slice(-10)}`,
              conferenceData: {
                conferenceSolution: { key: { type: "hangoutsMeet" } },
                entryPoints: [{
                  entryPointType: "video",
                  uri: `https://meet.google.com/${eventId.slice(-10)}`,
                }],
              },
            }
            : {};
          const updated = {
            ...existing,
            ...body,
            ...withConference,
            id: eventId,
            etag: `"${eventId}-v${patchCalls + 1}"`,
            updated: "2026-08-15T16:10:00Z",
          };
          providerEvents.set(eventId, updated);
          providerEventCalendars.set(eventId, providerCalendarId!);
          return Response.json(updated);
        }
        if (method === "DELETE") {
          deleteCalls += 1;
          deleteRequests.push({
            sendUpdates: url.searchParams.get("sendUpdates"),
            ifMatch: headers.get("If-Match"),
          });
          if (googleDeletePreconditionFailures.has(eventId)) {
            return Response.json({ error: { message: "Event changed" } }, { status: 412 });
          }
          providerEvents.delete(eventId);
          providerEventCalendars.delete(eventId);
          goneProviderEvents.add(eventId);
          return new Response(null, { status: 204 });
        }
      }
      if (url.pathname.endsWith("/events")) {
        expect(headers.get("Authorization")).toBe("Bearer booking-access-token");
        if (init?.method === "POST") {
          insertCalls += 1;
          const body = JSON.parse(typeof init.body === "string" ? init.body : "{}") as Record<string, unknown>;
          insertedBodies.push(body);
          const eventId = String(body.id ?? "");
          if (providerEvents.has(eventId)) {
            return Response.json({ error: { message: "Duplicate" } }, { status: 409 });
          }
          const withConference = isRecordForTest(body.conferenceData) && !deferMeetConference
            ? {
              hangoutLink: `https://meet.google.com/${eventId.slice(-10)}`,
              conferenceData: {
                conferenceSolution: { key: { type: "hangoutsMeet" } },
                entryPoints: [{
                  entryPointType: "video",
                  uri: `https://meet.google.com/${eventId.slice(-10)}`,
                }],
              },
            }
            : {};
          const event = {
            ...body,
            ...withConference,
            id: eventId,
            etag: `"${eventId}-v1"`,
            updated: "2026-08-15T16:00:00Z",
            htmlLink: `https://calendar.google.com/event?eid=${eventId}`,
          };
          providerEvents.set(eventId, event);
          providerEventCalendars.set(eventId, providerCalendarId!);
          if (failInsertAfterWrite) {
            failInsertAfterWrite = false;
            return Response.json({ error: { message: "Ambiguous upstream failure" } }, {
              status: 503,
            });
          }
          return Response.json(event);
        }
        expect(url.searchParams.get("singleEvents")).toBe("true");
        if (url.searchParams.get("orderBy") === "startTime") {
          if (
            liveProviderUnavailable ||
            unavailableLiveProviderCalendar === providerCalendarId
          ) {
            return Response.json({ error: { message: "Provider unavailable" } }, { status: 503 });
          }
          const timeMin = Date.parse(url.searchParams.get("timeMin")!);
          const timeMax = Date.parse(url.searchParams.get("timeMax")!);
          const items = [...providerEvents.entries()].filter(([eventId, event]) => {
            if (providerEventCalendars.get(eventId) !== providerCalendarId) return false;
            const start = isRecordForTest(event.start) && typeof event.start.dateTime === "string"
              ? Date.parse(event.start.dateTime)
              : Number.NaN;
            const end = isRecordForTest(event.end) && typeof event.end.dateTime === "string"
              ? Date.parse(event.end.dateTime)
              : Number.NaN;
            return start < timeMax && end > timeMin;
          }).map(([, event]) => event);
          return Response.json({ items });
        }
        return Response.json({
          items: [],
          nextSyncToken: url.searchParams.get("syncToken") ? "booking-sync-2" : "booking-sync-1",
        });
      }
      return Response.json({ error: { message: `Unexpected request ${url.href}` } }, { status: 500 });
    };
    const oauthEnv = {
      ...env,
      TOKEN_ENCRYPTION_KEY: testEncryptionKey(),
      GOOGLE_CLIENT_ID: "google-client-id",
      GOOGLE_CLIENT_SECRET: "google-client-secret",
      ZOOM_CLIENT_ID: "zoom-client-id",
      ZOOM_CLIENT_SECRET: "zoom-client-secret",
      PUBLIC_BASE_URL: "",
    };
    const oauthWorker = createCalendarGatewayWorker(providerFetch);
    const started = await oauthWorker.fetch(
      request("/v1/oauth/google/start", {
        method: "POST",
        json: { id: "account-google-booking", label: "Google Booking" },
      }),
      oauthEnv,
    );
    const authorization = await started.json<{ readonly authorizationUrl: string }>();
    const state = new URL(authorization.authorizationUrl).searchParams.get("state");
    const completed = await oauthWorker.fetch(
      request(`/v1/oauth/google/callback?state=${encodeURIComponent(state!)}&code=booking-code`),
      oauthEnv,
    );
    expect(completed.status).toBe(200);
    const bookingCalendars = (await env.CALENDAR_DB.prepare(
      "SELECT id, provider_calendar_id FROM provider_calendars WHERE connection_id = ?",
    )
      .bind("account-google-booking")
      .all<{ readonly id: string; readonly provider_calendar_id: string }>()).results;
    const calendarId = bookingCalendars.find(calendar =>
      calendar.provider_calendar_id === "booking-primary@example.com"
    )?.id;
    const secondaryCalendarId = bookingCalendars.find(calendar =>
      calendar.provider_calendar_id === "booking-secondary@example.com"
    )?.id;
    expect(calendarId).toBeTruthy();
    expect(secondaryCalendarId).toBeTruthy();
    const bootstrapped = await oauthWorker.fetch(
      request("/v1/events/query", {
        method: "POST",
        json: {
          timeMin: "2026-08-19T00:00:00Z",
          timeMax: "2026-08-25T00:00:00Z",
          calendarIds: [calendarId],
        },
      }),
      oauthEnv,
    );
    expect(bootstrapped.status).toBe(200);

    const meetingPayload = {
      destinationCalendarId: calendarId,
      conflictCalendarIds: [calendarId],
      idempotencyKey: "booking-meeting-1",
      title: "Customer architecture call",
      start: "2026-08-20T18:00:00Z",
      end: "2026-08-20T18:30:00Z",
      bookingKind: "meeting",
      attendeeEmails: ["guest@example.com"],
      conferenceProvider: "google-meet",
    };
    const bufferedMeetingPayload = {
      ...meetingPayload,
      conflictTimeMin: "2026-08-20T17:45:00Z",
      conflictTimeMax: "2026-08-20T18:40:00Z",
    };
    const incompleteConflictRange = await oauthWorker.fetch(
      request("/v1/bookings/commit", {
        method: "POST",
        json: {
          ...bufferedMeetingPayload,
          idempotencyKey: "booking-incomplete-conflict-range",
          conflictTimeMax: undefined,
        },
      }),
      oauthEnv,
    );
    expect(incompleteConflictRange.status).toBe(400);
    expect(await incompleteConflictRange.json()).toMatchObject({
      error: "invalid_conflict_time_range",
    });
    const narrowConflictRange = await oauthWorker.fetch(
      request("/v1/bookings/commit", {
        method: "POST",
        json: {
          ...bufferedMeetingPayload,
          idempotencyKey: "booking-narrow-conflict-range",
          conflictTimeMin: "2026-08-20T18:05:00Z",
        },
      }),
      oauthEnv,
    );
    expect(narrowConflictRange.status).toBe(400);
    expect(await narrowConflictRange.json()).toMatchObject({
      error: "invalid_conflict_time_range",
    });
    const unboundedConflictRange = await oauthWorker.fetch(
      request("/v1/bookings/commit", {
        method: "POST",
        json: {
          ...bufferedMeetingPayload,
          idempotencyKey: "booking-unbounded-conflict-range",
          conflictTimeMin: "2026-05-01T00:00:00Z",
          conflictTimeMax: "2026-08-20T18:40:00Z",
        },
      }),
      oauthEnv,
    );
    expect(unboundedConflictRange.status).toBe(400);
    expect(await unboundedConflictRange.json()).toMatchObject({
      error: "event_range_too_large",
    });
    providerEvents.set("external-buffer-before", {
      id: "external-buffer-before",
      summary: "Adjacent provider event",
      status: "confirmed",
      start: { dateTime: "2026-08-20T17:30:00Z" },
      end: { dateTime: "2026-08-20T17:50:00Z" },
    });
    providerEventCalendars.set("external-buffer-before", "booking-primary@example.com");
    const liveBufferConflict = await oauthWorker.fetch(
      request("/v1/bookings/commit", {
        method: "POST",
        json: {
          ...bufferedMeetingPayload,
          idempotencyKey: "booking-live-buffer-conflict",
        },
      }),
      oauthEnv,
    );
    expect(liveBufferConflict.status).toBe(409);
    expect(await liveBufferConflict.json()).toEqual({
      error: "slot_conflict",
      message: "That time is no longer available.",
    });
    expect(insertCalls).toBe(0);
    providerEvents.delete("external-buffer-before");
    providerEventCalendars.delete("external-buffer-before");
    const committed = await oauthWorker.fetch(
      request("/v1/bookings/commit", { method: "POST", json: bufferedMeetingPayload }),
      oauthEnv,
    );
    expect(committed.status).toBe(201);
    const committedBody = await committed.json<{
      readonly booking: {
        readonly providerJoinUrl: string;
        readonly providerHtmlLink: string;
      };
    }>();
    expect(committedBody).toMatchObject({
      booking: {
        state: "committed",
        bookingKind: "meeting",
        provider: "google",
        providerJoinUrl: expect.stringMatching(/^https:\/\/meet\.google\.com\//u),
        conferenceStatus: "ready",
        event: { title: "Customer architecture call", location: "google-meet" },
      },
      idempotentReplay: false,
    });
    const recoveredReady = await oauthWorker.fetch(
      request("/v1/bookings/booking-meeting-1/status"),
      oauthEnv,
    );
    expect(recoveredReady.status).toBe(200);
    expect(await recoveredReady.json()).toMatchObject({
      commit: {
        booking: {
          bookingKind: "meeting",
          providerJoinUrl: committedBody.booking.providerJoinUrl,
          providerHtmlLink: committedBody.booking.providerHtmlLink,
          conferenceStatus: "ready",
        },
        idempotentReplay: true,
      },
      lifecycle: { state: "active", resolvedAt: null, providerEventRemoved: false },
      currentEvent: {
        kind: "meeting",
        status: "confirmed",
        providerJoinUrl: committedBody.booking.providerJoinUrl,
      },
    });
    const otherWorkspaceStatusRequest = request(
      "/v1/bookings/booking-meeting-1/status",
    );
    otherWorkspaceStatusRequest.headers.set("X-TAP-Workspace-Id", "workspace-other");
    const otherWorkspaceStatus = await oauthWorker.fetch(
      otherWorkspaceStatusRequest,
      oauthEnv,
    );
    expect(otherWorkspaceStatus.status).toBe(404);
    expect(await otherWorkspaceStatus.json()).toMatchObject({ error: "booking_not_found" });
    expect(insertCalls).toBe(1);
    expect(insertedBodies[0]).toMatchObject({
      start: { dateTime: "2026-08-20T18:00:00.000Z" },
      end: { dateTime: "2026-08-20T18:30:00.000Z" },
      attendees: [{ email: "guest@example.com" }],
      conferenceData: { createRequest: { conferenceSolutionKey: { type: "hangoutsMeet" } } },
    });
    expect(
      await env.CALENDAR_DB.prepare(
        "SELECT cache_revision FROM calendar_sync_state WHERE calendar_id = ?",
      )
        .bind(calendarId)
        .first<number>("cache_revision"),
    ).toBe(2);
    const background: Promise<unknown>[] = [];
    const cached = await oauthWorker.fetch(
      request("/v1/events/query", {
        method: "POST",
        json: {
          timeMin: "2026-08-20T17:00:00Z",
          timeMax: "2026-08-20T19:00:00Z",
          calendarIds: [calendarId],
          revalidate: "background",
        },
      }),
      oauthEnv,
      { waitUntil(promise: Promise<unknown>) { background.push(promise); } } as ExecutionContext,
    );
    expect(await cached.json()).toMatchObject({
      source: "cache",
      events: [{ title: "Customer architecture call", location: "google-meet" }],
      cache: { calendars: [{ cacheRevision: 2, freshness: "stale" }] },
    });
    await Promise.all(background);

    const replay = await oauthWorker.fetch(
      request("/v1/bookings/commit", { method: "POST", json: bufferedMeetingPayload }),
      oauthEnv,
    );
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({
      idempotentReplay: true,
      booking: {
        providerJoinUrl: committedBody.booking.providerJoinUrl,
        providerHtmlLink: committedBody.booking.providerHtmlLink,
      },
    });
    expect(insertCalls).toBe(1);
    const disconnectedZoomConference = await oauthWorker.fetch(
      request("/v1/bookings/commit", {
        method: "POST",
        json: {
          ...bufferedMeetingPayload,
          idempotencyKey: "booking-zoom-not-connected",
          title: "Zoom is not connected",
          start: "2026-08-25T18:00:00Z",
          end: "2026-08-25T18:30:00Z",
          conflictTimeMin: "2026-08-25T17:45:00Z",
          conflictTimeMax: "2026-08-25T18:40:00Z",
          conferenceProvider: "zoom",
        },
      }),
      oauthEnv,
    );
    expect(disconnectedZoomConference.status).toBe(409);
    expect(await disconnectedZoomConference.json()).toMatchObject({
      error: "zoom_not_connected",
    });
    const reused = await oauthWorker.fetch(
      request("/v1/bookings/commit", {
        method: "POST",
        json: { ...bufferedMeetingPayload, title: "Different title" },
      }),
      oauthEnv,
    );
    expect(reused.status).toBe(409);
    expect(await reused.json()).toMatchObject({ error: "idempotency_key_reused" });
    const overlap = await oauthWorker.fetch(
      request("/v1/bookings/commit", {
        method: "POST",
        json: {
          ...bufferedMeetingPayload,
          idempotencyKey: "booking-overlap-1",
          title: "Overlapping booking",
          conferenceProvider: "none",
        },
      }),
      oauthEnv,
    );
    expect(overlap.status).toBe(409);
    expect(await overlap.json()).toEqual({
      error: "slot_conflict",
      message: "That time is no longer available.",
    });

    deferMeetConference = true;
    const pendingConference = await oauthWorker.fetch(
      request("/v1/bookings/commit", {
        method: "POST",
        json: {
          ...meetingPayload,
          idempotencyKey: "booking-meeting-pending-conference",
          title: "Delayed conference provisioning",
          start: "2026-08-24T18:00:00Z",
          end: "2026-08-24T18:30:00Z",
        },
      }),
      oauthEnv,
    );
    deferMeetConference = false;
    expect(pendingConference.status).toBe(201);
    const pendingConferenceBody = await pendingConference.json<{
      readonly booking: {
        readonly providerEventId: string;
        readonly providerHtmlLink: string;
      };
    }>();
    expect(pendingConferenceBody).toMatchObject({
      booking: {
        conferenceStatus: "pending",
        providerJoinUrl: null,
        pendingAttendeeEmails: [],
        event: { location: null },
      },
    });
    const pendingProviderEvent = providerEvents.get(
      pendingConferenceBody.booking.providerEventId,
    );
    expect(pendingProviderEvent).toBeTruthy();
    const storedPendingResponse = await env.CALENDAR_DB.prepare(
      `SELECT response_json FROM provider_booking_commits
        WHERE workspace_id = ? AND idempotency_key = ?`,
    )
      .bind(workspace, "booking-meeting-pending-conference")
      .first<string>("response_json");
    const storedPendingStatus = await oauthWorker.fetch(
      request("/v1/bookings/booking-meeting-pending-conference/status"),
      oauthEnv,
    );
    expect(storedPendingStatus.status).toBe(200);
    expect(await storedPendingStatus.json()).toMatchObject({
      commit: {
        booking: { conferenceStatus: "pending", providerJoinUrl: null },
        idempotentReplay: true,
      },
      lifecycle: { state: "active" },
    });
    const delayedMeetJoinUrl = "https://meet.google.com/delayed-meet";
    providerEvents.set(pendingConferenceBody.booking.providerEventId, {
      ...pendingProviderEvent!,
      hangoutLink: delayedMeetJoinUrl,
      conferenceData: {
        conferenceSolution: { key: { type: "hangoutsMeet" } },
        entryPoints: [{ entryPointType: "video", uri: delayedMeetJoinUrl }],
      },
    });
    const storedReadyStatus = await oauthWorker.fetch(
      request("/v1/bookings/booking-meeting-pending-conference/status"),
      oauthEnv,
    );
    expect(storedReadyStatus.status).toBe(200);
    expect(await storedReadyStatus.json()).toMatchObject({
      commit: {
        booking: {
          conferenceStatus: "ready",
          providerJoinUrl: delayedMeetJoinUrl,
          event: { location: "google-meet" },
        },
        idempotentReplay: true,
      },
      currentEvent: { providerJoinUrl: delayedMeetJoinUrl },
    });
    expect(await env.CALENDAR_DB.prepare(
      `SELECT response_json FROM provider_booking_commits
        WHERE workspace_id = ? AND idempotency_key = ?`,
    )
      .bind(workspace, "booking-meeting-pending-conference")
      .first<string>("response_json")).toBe(storedPendingResponse);
    await env.CALENDAR_DB.prepare(
      `UPDATE provider_booking_commits
          SET state = 'pending', response_json = NULL
        WHERE workspace_id = ? AND idempotency_key = ?`,
    )
      .bind(workspace, "booking-meeting-pending-conference")
      .run();
    providerEvents.set(pendingConferenceBody.booking.providerEventId, {
      ...pendingProviderEvent,
      htmlLink: "https://attacker.example/calendar-event",
      hangoutLink: "https://attacker.example/join",
      conferenceData: {
        createRequest: { conferenceSolutionKey: { type: "hangoutsMeet" } },
        entryPoints: [{ entryPointType: "video", uri: "javascript:alert(1)" }],
      },
    });
    const pendingRecovered = await oauthWorker.fetch(
      request("/v1/bookings/booking-meeting-pending-conference/status"),
      oauthEnv,
    );
    expect(pendingRecovered.status).toBe(200);
    expect(await pendingRecovered.json()).toMatchObject({
      commit: {
        booking: {
          bookingKind: "meeting",
          providerHtmlLink: null,
          providerJoinUrl: null,
          conferenceStatus: "pending",
          event: { location: null },
        },
        idempotentReplay: true,
      },
      lifecycle: { state: "active", providerEventRemoved: false },
      currentEvent: { location: null },
    });
    expect(await env.CALENDAR_DB.prepare(
      `SELECT state, response_json FROM provider_booking_commits
        WHERE workspace_id = ? AND idempotency_key = ?`,
    )
      .bind(workspace, "booking-meeting-pending-conference")
      .first()).toEqual({ state: "pending", response_json: null });

    const delayedProviderEvent = providerEvents.get(
      pendingConferenceBody.booking.providerEventId,
    )!;
    providerEvents.set(pendingConferenceBody.booking.providerEventId, {
      ...delayedProviderEvent,
      htmlLink: pendingConferenceBody.booking.providerHtmlLink,
      hangoutLink: delayedMeetJoinUrl,
      conferenceData: {
        conferenceSolution: { key: { type: "hangoutsMeet" } },
        entryPoints: [{ entryPointType: "video", uri: delayedMeetJoinUrl }],
      },
    });
    const readyRecovered = await oauthWorker.fetch(
      request("/v1/bookings/booking-meeting-pending-conference/status"),
      oauthEnv,
    );
    expect(readyRecovered.status).toBe(200);
    expect(await readyRecovered.json()).toMatchObject({
      commit: {
        booking: {
          providerHtmlLink: pendingConferenceBody.booking.providerHtmlLink,
          providerJoinUrl: delayedMeetJoinUrl,
          conferenceStatus: "ready",
          event: { location: "google-meet" },
        },
        idempotentReplay: true,
      },
      lifecycle: { state: "active", providerEventRemoved: false },
      currentEvent: { location: "google-meet", providerJoinUrl: delayedMeetJoinUrl },
    });
    expect(await env.CALENDAR_DB.prepare(
      `SELECT state, response_json FROM provider_booking_commits
        WHERE workspace_id = ? AND idempotency_key = ?`,
    )
      .bind(workspace, "booking-meeting-pending-conference")
      .first()).toEqual({ state: "pending", response_json: null });

    const verifiedProviderEvent = providerEvents.get(
      pendingConferenceBody.booking.providerEventId,
    )!;
    const verifiedExtendedProperties = isRecordForTest(
      verifiedProviderEvent.extendedProperties,
    ) ? verifiedProviderEvent.extendedProperties : {};
    const verifiedPrivateProperties = isRecordForTest(
      verifiedExtendedProperties.private,
    ) ? verifiedExtendedProperties.private : {};
    providerEvents.set(pendingConferenceBody.booking.providerEventId, {
      ...verifiedProviderEvent,
      extendedProperties: {
        ...verifiedExtendedProperties,
        private: { ...verifiedPrivateProperties, tapCommitHash: "wrong-proof" },
      },
    });
    const unverifiedStatus = await oauthWorker.fetch(
      request("/v1/bookings/booking-meeting-pending-conference/status"),
      oauthEnv,
    );
    expect(unverifiedStatus.status).toBe(502);
    expect(await unverifiedStatus.json()).toMatchObject({
      error: "provider_commit_unverified",
    });
    providerEvents.set(
      pendingConferenceBody.booking.providerEventId,
      verifiedProviderEvent,
    );

    const workBlock = await oauthWorker.fetch(
      request("/v1/bookings/commit", {
        method: "POST",
        json: {
          destinationCalendarId: calendarId,
          conflictCalendarIds: [calendarId],
          idempotencyKey: "booking-work-block-1",
          title: "Prepare launch notes",
          start: "2026-08-20T19:00:00Z",
          end: "2026-08-20T19:30:00Z",
          bookingKind: "work-block",
        },
      }),
      oauthEnv,
    );
    expect(workBlock.status).toBe(201);
    expect(await workBlock.json()).toMatchObject({
      booking: { bookingKind: "work-block", event: { kind: "work-block" } },
    });
    expect(insertedBodies.at(-1)).toMatchObject({ visibility: "private" });
    expect(insertedBodies.at(-1)).not.toHaveProperty("attendees");

    const approvalExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const holdPayload = {
      destinationCalendarId: calendarId,
      conflictCalendarIds: [calendarId],
      idempotencyKey: "booking-hold-approve",
      title: "Partner review",
      start: "2026-08-20T20:00:00Z",
      end: "2026-08-20T20:30:00Z",
      bookingKind: "approval-hold",
      attendeeEmails: ["partner@example.com"],
      expiresAt: approvalExpiresAt,
    };
    const hold = await oauthWorker.fetch(
      request("/v1/bookings/commit", { method: "POST", json: holdPayload }),
      oauthEnv,
    );
    expect(hold.status).toBe(201);
    expect(await hold.json()).toMatchObject({
      booking: {
        approvalStatus: "pending",
        approvalExpiresAt,
        pendingAttendeeEmails: ["partner@example.com"],
        event: { kind: "hold", status: "pending", attendees: [] },
      },
    });
    expect(insertedBodies.at(-1)).not.toHaveProperty("attendees");
    const approvalPayload = {
      idempotencyKey: "resolution-approve-1",
      decision: "approve",
      title: "Partner review",
      conferenceProvider: "google-meet",
      conflictCalendarIds: [calendarId],
    };
    const approved = await oauthWorker.fetch(
      request("/v1/bookings/booking-hold-approve/resolve", {
        method: "POST",
        json: approvalPayload,
      }),
      oauthEnv,
    );
    expect(approved.status).toBe(200);
    expect(await approved.json()).toMatchObject({
      resolution: {
        state: "committed",
        decision: "approved",
        providerEventRemoved: false,
        providerJoinUrl: expect.stringMatching(/^https:\/\/meet\.google\.com\//u),
        event: { status: "confirmed", kind: "meeting" },
      },
      idempotentReplay: false,
    });
    const approvedCommitStatus = await oauthWorker.fetch(
      request("/v1/bookings/booking-hold-approve/status"),
      oauthEnv,
    );
    expect(approvedCommitStatus.status).toBe(200);
    expect(await approvedCommitStatus.json()).toMatchObject({
      commit: {
        booking: {
          bookingKind: "approval-hold",
          approvalStatus: "pending",
          pendingAttendeeEmails: ["partner@example.com"],
          conferenceStatus: "ready",
          providerJoinUrl: expect.stringMatching(/^https:\/\/meet\.google\.com\//u),
          event: {
            kind: "hold",
            status: "pending",
            location: null,
            attendees: [],
          },
        },
        idempotentReplay: true,
      },
      lifecycle: { state: "approved", providerEventRemoved: false },
      currentEvent: {
        kind: "meeting",
        status: "confirmed",
        location: "google-meet",
        providerJoinUrl: expect.stringMatching(/^https:\/\/meet\.google\.com\//u),
      },
    });
    const approvedProviderEventId = await env.CALENDAR_DB.prepare(
      `SELECT provider_event_id FROM provider_booking_commits
        WHERE workspace_id = ? AND idempotency_key = ?`,
    )
      .bind(workspace, "booking-hold-approve")
      .first<string>("provider_event_id");
    const approvedProviderEvent = providerEvents.get(approvedProviderEventId!);
    expect(approvedProviderEvent).toBeTruthy();
    const approvedExtendedProperties = isRecordForTest(
      approvedProviderEvent!.extendedProperties,
    ) ? approvedProviderEvent!.extendedProperties : {};
    const approvedPrivateProperties = isRecordForTest(
      approvedExtendedProperties.private,
    ) ? approvedExtendedProperties.private : {};
    providerEvents.set(approvedProviderEventId!, {
      ...approvedProviderEvent!,
      extendedProperties: {
        ...approvedExtendedProperties,
        private: { ...approvedPrivateProperties, tapResolutionHash: "wrong-approval-proof" },
      },
    });
    const unverifiedApprovalStatus = await oauthWorker.fetch(
      request("/v1/bookings/booking-hold-approve/status"),
      oauthEnv,
    );
    expect(unverifiedApprovalStatus.status).toBe(502);
    expect(await unverifiedApprovalStatus.json()).toMatchObject({
      error: "provider_resolution_unverified",
    });
    providerEvents.set(approvedProviderEventId!, approvedProviderEvent!);
    expect(patchCalls).toBe(1);
    expect(patchedBodies.at(-1)).toMatchObject({
      attendees: [{ email: "partner@example.com" }],
    });
    const immutableApprovedCommitReplay = await oauthWorker.fetch(
      request("/v1/bookings/commit", { method: "POST", json: holdPayload }),
      oauthEnv,
    );
    expect(await immutableApprovedCommitReplay.json()).toMatchObject({
      idempotentReplay: true,
      booking: {
        state: "committed",
        approvalStatus: "pending",
        pendingAttendeeEmails: ["partner@example.com"],
      },
    });
    const approvedReplay = await oauthWorker.fetch(
      request("/v1/bookings/booking-hold-approve/resolve", {
        method: "POST",
        json: approvalPayload,
      }),
      oauthEnv,
    );
    expect(approvedReplay.status).toBe(200);
    expect(await approvedReplay.json()).toMatchObject({ idempotentReplay: true });
    expect(patchCalls).toBe(1);
    const changedApprovalKey = await oauthWorker.fetch(
      request("/v1/bookings/booking-hold-approve/resolve", {
        method: "POST",
        json: { ...approvalPayload, idempotencyKey: "resolution-approve-different" },
      }),
      oauthEnv,
    );
    expect(changedApprovalKey.status).toBe(409);
    expect(await changedApprovalKey.json()).toMatchObject({ error: "approval_already_resolved" });

    const conflictHoldPayload = {
      ...holdPayload,
      // The secondary calendar is deliberately not part of the original hold. It is supplied
      // at resolution time to prove the final check uses the union with current configuration.
      conflictCalendarIds: [calendarId],
      idempotencyKey: "booking-hold-new-conflict",
      start: "2026-08-21T15:00:00Z",
      end: "2026-08-21T15:30:00Z",
      conflictTimeMin: "2026-08-21T14:45:00Z",
      conflictTimeMax: "2026-08-21T15:45:00Z",
    };
    expect((await oauthWorker.fetch(
      request("/v1/bookings/commit", { method: "POST", json: conflictHoldPayload }),
      oauthEnv,
    )).status).toBe(201);
    providerEvents.set("external-secondary-conflict", {
      id: "external-secondary-conflict",
      summary: "New provider conflict",
      status: "confirmed",
      // This touches the meeting boundary but overlaps only the stored buffer range.
      start: { dateTime: "2026-08-21T14:30:00Z" },
      end: { dateTime: conflictHoldPayload.start },
    });
    providerEventCalendars.set(
      "external-secondary-conflict",
      "booking-secondary@example.com",
    );
    const conflictResolutionPayload = {
      idempotencyKey: "resolution-new-conflict",
      decision: "approve",
      conflictCalendarIds: [calendarId, secondaryCalendarId],
    };
    const approvalConflict = await oauthWorker.fetch(
      request("/v1/bookings/booking-hold-new-conflict/resolve", {
        method: "POST",
        json: conflictResolutionPayload,
      }),
      oauthEnv,
    );
    expect(approvalConflict.status).toBe(409);
    expect(await approvalConflict.json()).toMatchObject({ error: "slot_conflict" });
    providerEvents.delete("external-secondary-conflict");
    providerEventCalendars.delete("external-secondary-conflict");
    const patchCallsBeforeSelfExclusion = patchCalls;
    const approvedAfterConflictClears = await oauthWorker.fetch(
      request("/v1/bookings/booking-hold-new-conflict/resolve", {
        method: "POST",
        json: conflictResolutionPayload,
      }),
      oauthEnv,
    );
    expect(approvedAfterConflictClears.status).toBe(200);
    expect(await approvedAfterConflictClears.json()).toMatchObject({
      resolution: { decision: "approved" },
    });
    // The original tentative destination hold is intentionally excluded from the final live
    // conflict check; otherwise every valid approval would conflict with its own reservation.
    expect(patchCalls).toBe(patchCallsBeforeSelfExclusion + 1);

    const conflictThenDeclineHold = {
      ...holdPayload,
      conflictCalendarIds: [calendarId, secondaryCalendarId],
      idempotencyKey: "booking-hold-conflict-then-decline",
      // Leave the previous booking’s stored 15-minute buffer intact.
      start: "2026-08-21T16:00:00Z",
      end: "2026-08-21T16:30:00Z",
    };
    expect((await oauthWorker.fetch(
      request("/v1/bookings/commit", { method: "POST", json: conflictThenDeclineHold }),
      oauthEnv,
    )).status).toBe(201);
    providerEvents.set("external-conflict-before-decline", {
      id: "external-conflict-before-decline",
      summary: "Conflict before decline",
      status: "confirmed",
      start: { dateTime: conflictThenDeclineHold.start },
      end: { dateTime: conflictThenDeclineHold.end },
    });
    providerEventCalendars.set(
      "external-conflict-before-decline",
      "booking-secondary@example.com",
    );
    const conflictBeforeDecline = await oauthWorker.fetch(
      request("/v1/bookings/booking-hold-conflict-then-decline/resolve", {
        method: "POST",
        json: {
          idempotencyKey: "resolution-conflict-before-decline",
          decision: "approve",
          conflictCalendarIds: [calendarId, secondaryCalendarId],
        },
      }),
      oauthEnv,
    );
    expect(conflictBeforeDecline.status).toBe(409);
    const declineAfterConflict = await oauthWorker.fetch(
      request("/v1/bookings/booking-hold-conflict-then-decline/resolve", {
        method: "POST",
        json: { idempotencyKey: "resolution-decline-after-conflict", decision: "decline" },
      }),
      oauthEnv,
    );
    expect(declineAfterConflict.status).toBe(200);
    providerEvents.delete("external-conflict-before-decline");
    providerEventCalendars.delete("external-conflict-before-decline");

    const partialFailureHoldPayload = {
      ...holdPayload,
      conflictCalendarIds: [calendarId, secondaryCalendarId],
      idempotencyKey: "booking-hold-partial-failure",
      start: "2026-08-21T16:00:00Z",
      end: "2026-08-21T16:30:00Z",
    };
    expect((await oauthWorker.fetch(
      request("/v1/bookings/commit", { method: "POST", json: partialFailureHoldPayload }),
      oauthEnv,
    )).status).toBe(201);
    unavailableLiveProviderCalendar = "booking-secondary@example.com";
    const partialFailureResolution = {
      idempotencyKey: "resolution-partial-failure",
      decision: "approve",
      conflictCalendarIds: [calendarId, secondaryCalendarId],
    };
    const partialFailure = await oauthWorker.fetch(
      request("/v1/bookings/booking-hold-partial-failure/resolve", {
        method: "POST",
        json: partialFailureResolution,
      }),
      oauthEnv,
    );
    expect(partialFailure.status).toBe(503);
    expect(await partialFailure.json()).toMatchObject({ error: "live_availability_unavailable" });
    unavailableLiveProviderCalendar = null;
    const declineAfterPartialFailure = await oauthWorker.fetch(
      request("/v1/bookings/booking-hold-partial-failure/resolve", {
        method: "POST",
        json: { idempotencyKey: "resolution-decline-after-partial", decision: "decline" },
      }),
      oauthEnv,
    );
    expect(declineAfterPartialFailure.status).toBe(200);

    const invalidConflictSetHoldPayload = {
      ...holdPayload,
      conflictCalendarIds: [calendarId, secondaryCalendarId],
      idempotencyKey: "booking-hold-invalid-conflict-set",
      start: "2026-08-21T17:00:00Z",
      end: "2026-08-21T17:30:00Z",
    };
    expect((await oauthWorker.fetch(
      request("/v1/bookings/commit", { method: "POST", json: invalidConflictSetHoldPayload }),
      oauthEnv,
    )).status).toBe(201);
    await env.CALENDAR_DB.prepare(
      `UPDATE provider_booking_commits SET conflict_calendar_ids_json = ?
        WHERE workspace_id = ? AND idempotency_key = ?`,
    )
      .bind(JSON.stringify([secondaryCalendarId]), workspace, "booking-hold-invalid-conflict-set")
      .run();
    const invalidConflictSet = await oauthWorker.fetch(
      request("/v1/bookings/booking-hold-invalid-conflict-set/resolve", {
        method: "POST",
        json: {
          idempotencyKey: "resolution-invalid-conflict-set",
          decision: "approve",
          conflictCalendarIds: [calendarId, secondaryCalendarId],
        },
      }),
      oauthEnv,
    );
    expect(invalidConflictSet.status).toBe(409);
    expect(await invalidConflictSet.json()).toMatchObject({
      error: "booking_conflict_set_invalid",
    });

    const legacyDeclineHoldPayload = {
      ...holdPayload,
      idempotencyKey: "booking-hold-legacy-decline",
      start: "2026-08-21T17:30:00Z",
      end: "2026-08-21T18:00:00Z",
    };
    expect((await oauthWorker.fetch(
      request("/v1/bookings/commit", { method: "POST", json: legacyDeclineHoldPayload }),
      oauthEnv,
    )).status).toBe(201);
    await env.CALENDAR_DB.prepare(
      `UPDATE provider_booking_commits SET conflict_calendar_ids_json = NULL
        WHERE workspace_id = ? AND idempotency_key = ?`,
    )
      .bind(workspace, "booking-hold-legacy-decline")
      .run();
    const legacyDeclined = await oauthWorker.fetch(
      request("/v1/bookings/booking-hold-legacy-decline/resolve", {
        method: "POST",
        json: { idempotencyKey: "resolution-legacy-decline", decision: "decline" },
      }),
      oauthEnv,
    );
    expect(legacyDeclined.status).toBe(200);

    const expiringHoldPayload = {
      ...holdPayload,
      idempotencyKey: "booking-hold-expiring",
      start: "2026-08-21T18:00:00Z",
      end: "2026-08-21T18:30:00Z",
    };
    expect((await oauthWorker.fetch(
      request("/v1/bookings/commit", { method: "POST", json: expiringHoldPayload }),
      oauthEnv,
    )).status).toBe(201);
    const expiringProviderEventId = await env.CALENDAR_DB.prepare(
      `SELECT provider_event_id FROM provider_booking_commits
        WHERE workspace_id = ? AND idempotency_key = ?`,
    )
      .bind(workspace, "booking-hold-expiring")
      .first<string>("provider_event_id");
    await env.CALENDAR_DB.prepare(
      `UPDATE provider_booking_commits SET hold_expires_at = ?
        WHERE workspace_id = ? AND idempotency_key = ?`,
    )
      .bind("2000-01-01T00:00:00.000Z", workspace, "booking-hold-expiring")
      .run();
    const scheduledExpiration: Promise<unknown>[] = [];
    oauthWorker.scheduled({
      cron: "*/5 * * * *",
      scheduledTime: Date.now(),
      noRetry() {},
    } as ScheduledController, oauthEnv, {
      waitUntil(promise: Promise<unknown>) { scheduledExpiration.push(promise); },
    } as ExecutionContext);
    await Promise.all(scheduledExpiration);
    expect(
      await env.CALENDAR_DB.prepare(
        `SELECT hold_expired_at FROM provider_booking_commits
          WHERE workspace_id = ? AND idempotency_key = ?`,
      )
        .bind(workspace, "booking-hold-expiring")
        .first<string>("hold_expired_at"),
    ).toBeTruthy();
    expect(providerEvents.has(expiringProviderEventId!)).toBe(false);
    const expiredStatus = await oauthWorker.fetch(
      request("/v1/bookings/booking-hold-expiring/status"),
      oauthEnv,
    );
    expect(expiredStatus.status).toBe(200);
    expect(await expiredStatus.json()).toMatchObject({
      commit: {
        booking: {
          bookingKind: "approval-hold",
          approvalStatus: "pending",
        },
        idempotentReplay: true,
      },
      lifecycle: {
        state: "expired",
        resolvedAt: expect.any(String),
        providerEventRemoved: true,
      },
      currentEvent: null,
    });
    const expiredApproval = await oauthWorker.fetch(
      request("/v1/bookings/booking-hold-expiring/resolve", {
        method: "POST",
        json: {
          idempotencyKey: "resolution-expired-approve",
          decision: "approve",
          conflictCalendarIds: [calendarId],
        },
      }),
      oauthEnv,
    );
    expect(expiredApproval.status).toBe(410);
    expect(await expiredApproval.json()).toMatchObject({ error: "approval_hold_expired" });
    const replacementAfterExpiration = await oauthWorker.fetch(
      request("/v1/bookings/commit", {
        method: "POST",
        json: {
          ...meetingPayload,
          idempotencyKey: "booking-after-expiration",
          title: "Replacement after expiration",
          start: expiringHoldPayload.start,
          end: expiringHoldPayload.end,
          conferenceProvider: "none",
        },
      }),
      oauthEnv,
    );
    expect(replacementAfterExpiration.status).toBe(201);

    const missingHoldPayload = {
      ...holdPayload,
      idempotencyKey: "booking-hold-missing",
      start: "2026-08-21T18:30:00Z",
      end: "2026-08-21T19:00:00Z",
    };
    expect((await oauthWorker.fetch(
      request("/v1/bookings/commit", { method: "POST", json: missingHoldPayload }),
      oauthEnv,
    )).status).toBe(201);
    const missingProviderEventId = await env.CALENDAR_DB.prepare(
      `SELECT provider_event_id FROM provider_booking_commits
        WHERE workspace_id = ? AND idempotency_key = ?`,
    )
      .bind(workspace, "booking-hold-missing")
      .first<string>("provider_event_id");
    expect(missingProviderEventId).toBeTruthy();
    providerEvents.delete(missingProviderEventId!);
    providerEventCalendars.delete(missingProviderEventId!);

    const missingApproval = await oauthWorker.fetch(
      request("/v1/bookings/booking-hold-missing/resolve", {
        method: "POST",
        json: {
          idempotencyKey: "resolution-missing-approve",
          decision: "approve",
          conflictCalendarIds: [calendarId],
        },
      }),
      oauthEnv,
    );
    expect(missingApproval.status).toBe(409);
    expect(await missingApproval.json()).toMatchObject({ error: "approval_hold_missing" });
    expect(
      await env.CALENDAR_DB.prepare(
        `SELECT hold_expired_at FROM provider_booking_commits
          WHERE workspace_id = ? AND idempotency_key = ?`,
      )
        .bind(workspace, "booking-hold-missing")
        .first<string>("hold_expired_at"),
    ).toBeTruthy();

    const missingStatus = await oauthWorker.fetch(
      request("/v1/bookings/booking-hold-missing/status"),
      oauthEnv,
    );
    expect(missingStatus.status).toBe(200);
    expect(await missingStatus.json()).toMatchObject({
      lifecycle: {
        state: "expired",
        resolvedAt: expect.any(String),
        providerEventRemoved: true,
      },
      currentEvent: null,
    });
    expect(
      await env.CALENDAR_DB.prepare(
        `SELECT calendar_event_cache.tombstoned
           FROM calendar_event_cache
           INNER JOIN calendar_sync_state
             ON calendar_sync_state.workspace_id = calendar_event_cache.workspace_id
            AND calendar_sync_state.connection_id = calendar_event_cache.connection_id
            AND calendar_sync_state.calendar_id = calendar_event_cache.calendar_id
            AND calendar_sync_state.active_generation = calendar_event_cache.sync_generation
          WHERE calendar_event_cache.workspace_id = ?
            AND calendar_event_cache.calendar_id = ?
            AND calendar_event_cache.provider_event_id = ?`,
      )
        .bind(workspace, calendarId, missingProviderEventId)
        .first<number>("tombstoned"),
    ).toBe(1);

    const replacementAfterMissing = await oauthWorker.fetch(
      request("/v1/bookings/commit", {
        method: "POST",
        json: {
          ...meetingPayload,
          idempotencyKey: "booking-after-missing-hold",
          title: "Replacement after missing hold",
          start: missingHoldPayload.start,
          end: missingHoldPayload.end,
          conferenceProvider: "none",
        },
      }),
      oauthEnv,
    );
    expect(replacementAfterMissing.status).toBe(201);

    const declineHoldPayload = {
      ...holdPayload,
      idempotencyKey: "booking-hold-decline",
      start: "2026-08-20T21:00:00Z",
      end: "2026-08-20T21:30:00Z",
    };
    expect((await oauthWorker.fetch(
      request("/v1/bookings/commit", { method: "POST", json: declineHoldPayload }),
      oauthEnv,
    )).status).toBe(201);
    const deletesBeforeMainDecline = deleteCalls;
    const declinePayload = { idempotencyKey: "resolution-decline-1", decision: "decline" };
    const declined = await oauthWorker.fetch(
      request("/v1/bookings/booking-hold-decline/resolve", {
        method: "POST",
        json: declinePayload,
      }),
      oauthEnv,
    );
    expect(declined.status).toBe(200);
    expect(await declined.json()).toMatchObject({
      resolution: { decision: "declined", providerEventRemoved: true, event: null },
    });
    const declinedStatus = await oauthWorker.fetch(
      request("/v1/bookings/booking-hold-decline/status"),
      oauthEnv,
    );
    expect(declinedStatus.status).toBe(200);
    expect(await declinedStatus.json()).toMatchObject({
      commit: {
        booking: {
          bookingKind: "approval-hold",
          approvalStatus: "pending",
        },
        idempotentReplay: true,
      },
      lifecycle: {
        state: "declined",
        resolvedAt: expect.any(String),
        providerEventRemoved: true,
      },
      currentEvent: null,
    });
    expect(deleteCalls).toBe(deletesBeforeMainDecline + 1);
    const immutableDeclinedCommitReplay = await oauthWorker.fetch(
      request("/v1/bookings/commit", { method: "POST", json: declineHoldPayload }),
      oauthEnv,
    );
    expect(await immutableDeclinedCommitReplay.json()).toMatchObject({
      idempotentReplay: true,
      booking: { state: "committed", approvalStatus: "pending" },
    });
    const declinedReplay = await oauthWorker.fetch(
      request("/v1/bookings/booking-hold-decline/resolve", {
        method: "POST",
        json: declinePayload,
      }),
      oauthEnv,
    );
    expect(declinedReplay.status).toBe(200);
    expect(await declinedReplay.json()).toMatchObject({ idempotentReplay: true });
    expect(deleteCalls).toBe(deletesBeforeMainDecline + 1);
    const replacementAfterDecline = await oauthWorker.fetch(
      request("/v1/bookings/commit", {
        method: "POST",
        json: {
          ...meetingPayload,
          idempotencyKey: "booking-after-decline",
          title: "Replacement after decline",
          start: declineHoldPayload.start,
          end: declineHoldPayload.end,
          conferenceProvider: "none",
        },
      }),
      oauthEnv,
    );
    expect(replacementAfterDecline.status).toBe(201);

    liveProviderUnavailable = true;
    const outagePayload = {
      ...meetingPayload,
      idempotencyKey: "booking-provider-outage",
      title: "Fail closed",
      start: "2026-08-20T22:00:00Z",
      end: "2026-08-20T22:30:00Z",
      conferenceProvider: "none",
    };
    const unavailable = await oauthWorker.fetch(
      request("/v1/bookings/commit", { method: "POST", json: outagePayload }),
      oauthEnv,
    );
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toMatchObject({ error: "live_availability_unavailable" });
    liveProviderUnavailable = false;
    expect((await oauthWorker.fetch(
      request("/v1/bookings/commit", { method: "POST", json: outagePayload }),
      oauthEnv,
    )).status).toBe(201);

    failInsertAfterWrite = true;
    const ambiguousPayload = {
      ...meetingPayload,
      idempotencyKey: "booking-ambiguous-insert",
      title: "Recover insert",
      start: "2026-08-20T23:00:00Z",
      end: "2026-08-20T23:30:00Z",
      conferenceProvider: "none",
    };
    const ambiguous = await oauthWorker.fetch(
      request("/v1/bookings/commit", { method: "POST", json: ambiguousPayload }),
      oauthEnv,
    );
    expect(ambiguous.status).toBe(502);
    const insertsAfterAmbiguousFailure = insertCalls;
    const recovered = await oauthWorker.fetch(
      request("/v1/bookings/commit", { method: "POST", json: ambiguousPayload }),
      oauthEnv,
    );
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toMatchObject({ idempotentReplay: true });
    expect(insertCalls).toBe(insertsAfterAmbiguousFailure);

    const publicProvider = createGatewayPublicBookingProvider(oauthEnv, providerFetch, {
      assertPublicationCurrent: async () => undefined,
    });
    const publicOperationId = await publicBookingProviderOperationId(
      { workspace, principal },
      calendarId!,
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    );
    const publicCommitProof = await sha256Base64Url("public booking commit proof");
    const publicCommit = await publicProvider.commit({
      scope: { workspace, principal },
      destinationCalendarId: calendarId!,
      operationId: publicOperationId,
      commitProof: publicCommitProof,
      startsAt: "2026-08-26T18:00:00.000Z",
      endsAt: "2026-08-26T18:30:00.000Z",
      conflictCalendarIds: [secondaryCalendarId!, calendarId!],
      conflictStart: "2026-08-26T17:45:00.000Z",
      conflictEnd: "2026-08-26T18:40:00.000Z",
      title: "Public architecture call",
      description: "Created from the public booking page.",
      location: "google-meet",
      guest: { name: "Public Guest", email: "public-guest@example.com" },
      bookingKind: "meeting",
      conferenceProvider: "google-meet",
      expiresAt: null,
    });
    expect(publicCommit).toEqual({
      status: "committed",
      receipt: {
        operationId: publicOperationId,
        commitProof: publicCommitProof,
        providerBookingId: publicOperationId,
        startsAt: "2026-08-26T18:00:00.000Z",
        endsAt: "2026-08-26T18:30:00.000Z",
        status: "confirmed",
      },
    });
    expect(insertedBodies.at(-1)).toMatchObject({
      id: publicOperationId,
      start: { dateTime: "2026-08-26T18:00:00.000Z" },
      end: { dateTime: "2026-08-26T18:30:00.000Z" },
      attendees: [{ email: "public-guest@example.com" }],
      extendedProperties: { private: { tapCommitHash: publicCommitProof } },
    });
    await expect(publicProvider.recover({
      scope: { workspace, principal },
      destinationCalendarId: calendarId!,
      operationId: publicOperationId,
      commitProof: publicCommitProof,
      startsAt: "2026-08-26T18:00:00.000Z",
      endsAt: "2026-08-26T18:30:00.000Z",
    })).resolves.toEqual(publicCommit);

    let rescheduleAuthorizationFences = 0;
    const managementProvider = createGatewayPublicBookingManagementProvider(
      oauthEnv,
      providerFetch,
      {
        assertRescheduleStillAuthorized: async () => {
          rescheduleAuthorizationFences += 1;
        },
      },
    );
    const managementConflictCalendarIds = [calendarId!, secondaryCalendarId!].sort();
    const rescheduleProof = await sha256Base64Url("public booking reschedule proof");
    const rescheduleCommand = {
      kind: "reschedule" as const,
      scope: { workspace, principal },
      destinationCalendarId: calendarId!,
      providerBookingId: publicOperationId,
      providerOperationId: publicOperationId,
      operationId: "tapmop_public_reschedule",
      providerCommitProof: publicCommitProof,
      mutationProof: rescheduleProof,
      bookingStatus: "confirmed" as const,
      startsAt: "2026-08-26T18:00:00.000Z",
      endsAt: "2026-08-26T18:30:00.000Z",
      newStartsAt: "2026-08-27T19:00:00.000Z",
      newEndsAt: "2026-08-27T19:30:00.000Z",
      conflictCalendarIds: managementConflictCalendarIds,
      conflictStart: "2026-08-27T18:45:00.000Z",
      conflictEnd: "2026-08-27T19:40:00.000Z",
    };
    await expect(managementProvider.recover(rescheduleCommand)).resolves.toEqual({
      status: "absent",
    });
    const patchesBeforePublicReschedule = patchCalls;
    await expect(managementProvider.reschedule(rescheduleCommand)).resolves.toEqual({
      status: "committed",
      receipt: {
        operationId: "tapmop_public_reschedule",
        providerBookingId: publicOperationId,
        startsAt: "2026-08-27T19:00:00.000Z",
        endsAt: "2026-08-27T19:30:00.000Z",
        status: "confirmed",
      },
    });
    expect(patchCalls).toBe(patchesBeforePublicReschedule + 1);
    expect(rescheduleAuthorizationFences).toBe(1);
    expect(patchRequests.at(-1)).toEqual({
      sendUpdates: "all",
      ifMatch: `"${publicOperationId}-v1"`,
    });
    expect(patchedBodies.at(-1)).toMatchObject({
      start: { dateTime: "2026-08-27T19:00:00.000Z" },
      end: { dateTime: "2026-08-27T19:30:00.000Z" },
      extendedProperties: {
        private: {
          tapCommitHash: publicCommitProof,
          tapBookingKind: "meeting",
          tapRescheduleHash: rescheduleProof,
        },
      },
    });
    await expect(managementProvider.recover(rescheduleCommand)).resolves.toEqual({
      status: "committed",
      receipt: {
        operationId: "tapmop_public_reschedule",
        providerBookingId: publicOperationId,
        startsAt: "2026-08-27T19:00:00.000Z",
        endsAt: "2026-08-27T19:30:00.000Z",
        status: "confirmed",
      },
    });

    providerEvents.set("external-public-management-conflict", {
      id: "external-public-management-conflict",
      etag: '"external-public-management-conflict-v1"',
      status: "confirmed",
      summary: "External conflict",
      start: { dateTime: "2026-08-28T20:00:00.000Z" },
      end: { dateTime: "2026-08-28T20:30:00.000Z" },
      transparency: "opaque",
    });
    providerEventCalendars.set(
      "external-public-management-conflict",
      "booking-secondary@example.com",
    );
    const conflictingReschedule = {
      ...rescheduleCommand,
      operationId: "tapmop_public_reschedule_conflict",
      mutationProof: await sha256Base64Url("public booking conflicting reschedule proof"),
      startsAt: "2026-08-27T19:00:00.000Z",
      endsAt: "2026-08-27T19:30:00.000Z",
      newStartsAt: "2026-08-28T20:00:00.000Z",
      newEndsAt: "2026-08-28T20:30:00.000Z",
      conflictStart: "2026-08-28T19:45:00.000Z",
      conflictEnd: "2026-08-28T20:40:00.000Z",
    };
    const patchesBeforeConflict = patchCalls;
    await expect(managementProvider.reschedule(conflictingReschedule)).resolves.toEqual({
      status: "conflict",
      reason: "slot-conflict",
    });
    expect(patchCalls).toBe(patchesBeforeConflict);
    expect(rescheduleAuthorizationFences).toBe(1);
    providerEvents.delete("external-public-management-conflict");
    providerEventCalendars.delete("external-public-management-conflict");

    const currentPublicEvent = providerEvents.get(publicOperationId)!;
    const currentExtended = isRecordForTest(currentPublicEvent.extendedProperties)
      ? currentPublicEvent.extendedProperties
      : {};
    const currentPrivate = isRecordForTest(currentExtended.private)
      ? currentExtended.private
      : {};
    providerEvents.set(publicOperationId, {
      ...currentPublicEvent,
      extendedProperties: {
        ...currentExtended,
        private: { ...currentPrivate, tapCommitHash: "x".repeat(43) },
      },
    });
    const cancellationProof = await sha256Base64Url("public booking cancellation proof");
    const cancelCommand = {
      kind: "cancel" as const,
      scope: { workspace, principal },
      destinationCalendarId: calendarId!,
      providerBookingId: publicOperationId,
      providerOperationId: publicOperationId,
      operationId: "tapmop_public_cancel",
      providerCommitProof: publicCommitProof,
      mutationProof: cancellationProof,
      bookingStatus: "confirmed" as const,
      startsAt: "2026-08-27T19:00:00.000Z",
      endsAt: "2026-08-27T19:30:00.000Z",
      newStartsAt: null,
      newEndsAt: null,
      conflictCalendarIds: [],
      conflictStart: null,
      conflictEnd: null,
    };
    const deletesBeforeMismatch = deleteCalls;
    await expect(managementProvider.cancel(cancelCommand)).resolves.toEqual({
      status: "conflict",
      reason: "provider-mismatch",
    });
    expect(deleteCalls).toBe(deletesBeforeMismatch);
    providerEvents.set(publicOperationId, currentPublicEvent);

    await expect(managementProvider.recover(cancelCommand)).resolves.toEqual({
      status: "absent",
    });
    await expect(managementProvider.cancel(cancelCommand)).resolves.toMatchObject({
      status: "committed",
      receipt: { status: "cancelled" },
    });
    expect(deleteRequests.at(-1)).toEqual({
      sendUpdates: "all",
      ifMatch: currentPublicEvent.etag,
    });
    // Google reports a previously removed event as 410. The durable original
    // commit proof makes that an authoritative cancellation recovery.
    await expect(managementProvider.recover(cancelCommand)).resolves.toMatchObject({
      status: "committed",
      receipt: { status: "cancelled" },
    });

    const zoomStarted = await oauthWorker.fetch(
      request("/v1/oauth/zoom/start", {
        method: "POST",
        json: { id: "account-zoom-booking", label: "Booking Zoom" },
      }),
      oauthEnv,
    );
    expect(zoomStarted.status).toBe(201);
    const zoomAuthorization = await zoomStarted.json<{
      readonly connectionId: string;
      readonly authorizationUrl: string;
    }>();
    const zoomAuthorizationUrl = new URL(zoomAuthorization.authorizationUrl);
    expect(zoomAuthorizationUrl.origin).toBe("https://zoom.us");
    expect(zoomAuthorizationUrl.pathname).toBe("/oauth/authorize");
    const zoomState = zoomAuthorizationUrl.searchParams.get("state");
    const zoomCompleted = await oauthWorker.fetch(
      request(
        `/v1/oauth/zoom/callback?state=${encodeURIComponent(zoomState!)}&code=zoom-booking-code`,
      ),
      oauthEnv,
    );
    expect(zoomCompleted.status).toBe(200);
    const zoomVerified = await oauthWorker.fetch(
      request(
        `/v1/meeting-providers/connections/${encodeURIComponent(zoomAuthorization.connectionId)}/verify`,
        { method: "POST", json: {} },
      ),
      oauthEnv,
    );
    expect(zoomVerified.status).toBe(200);
    expect(await zoomVerified.json()).toMatchObject({
      connection: {
        id: zoomAuthorization.connectionId,
        ownerPrincipalId: principal,
        provider: "zoom",
        status: "connected",
        providerEmail: "organizer@example.com",
      },
    });

    const zoomPublicOperationId = await publicBookingProviderOperationId(
      { workspace, principal },
      calendarId!,
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    );
    const zoomPublicCommitProof = await sha256Base64Url("public Zoom booking commit proof");
    await expect(publicProvider.commit({
      scope: { workspace, principal },
      destinationCalendarId: calendarId!,
      operationId: zoomPublicOperationId,
      commitProof: zoomPublicCommitProof,
      startsAt: "2026-09-01T18:00:00.000Z",
      endsAt: "2026-09-01T18:30:00.000Z",
      conflictCalendarIds: [calendarId!],
      conflictStart: "2026-09-01T17:45:00.000Z",
      conflictEnd: "2026-09-01T18:40:00.000Z",
      title: "Public Zoom call",
      description: "Created with a real Zoom meeting.",
      location: "zoom",
      guest: { name: "Zoom Guest", email: "zoom-guest@example.com" },
      bookingKind: "meeting",
      conferenceProvider: "zoom",
      expiresAt: null,
    })).resolves.toEqual({
      status: "committed",
      receipt: {
        operationId: zoomPublicOperationId,
        commitProof: zoomPublicCommitProof,
        providerBookingId: zoomPublicOperationId,
        startsAt: "2026-09-01T18:00:00.000Z",
        endsAt: "2026-09-01T18:30:00.000Z",
        status: "confirmed",
      },
    });
    expect(zoomCreatedBodies).toEqual([{
      topic: "Public Zoom call",
      type: 2,
      start_time: "2026-09-01T18:00:00.000Z",
      duration: 30,
      timezone: "UTC",
      default_password: true,
      agenda: "Created with a real Zoom meeting.",
      settings: { push_change_to_calendar: false },
    }]);
    expect(insertedBodies.at(-1)).toMatchObject({
      id: zoomPublicOperationId,
      location: "https://us02web.zoom.us/j/98765432101?pwd=tap",
      extendedProperties: {
        private: {
          tapCommitHash: zoomPublicCommitProof,
          tapBookingKind: "meeting",
          tapConferenceProvider: "zoom",
          tapZoomMeetingId: "98765432101",
        },
      },
    });
    expect(JSON.stringify(insertedBodies.at(-1))).not.toContain("start_url");
    await expect(publicProvider.recover({
      scope: { workspace, principal },
      destinationCalendarId: calendarId!,
      operationId: zoomPublicOperationId,
      commitProof: zoomPublicCommitProof,
      startsAt: "2026-09-01T18:00:00.000Z",
      endsAt: "2026-09-01T18:30:00.000Z",
    })).resolves.toMatchObject({ status: "committed" });
    expect(zoomCreatedBodies).toHaveLength(1);

    const zoomRescheduleProof = await sha256Base64Url("public Zoom reschedule proof");
    const zoomRescheduleCommand = {
      kind: "reschedule" as const,
      scope: { workspace, principal },
      destinationCalendarId: calendarId!,
      providerBookingId: zoomPublicOperationId,
      providerOperationId: zoomPublicOperationId,
      operationId: "tapmop_public_zoom_reschedule",
      providerCommitProof: zoomPublicCommitProof,
      mutationProof: zoomRescheduleProof,
      bookingStatus: "confirmed" as const,
      startsAt: "2026-09-01T18:00:00.000Z",
      endsAt: "2026-09-01T18:30:00.000Z",
      newStartsAt: "2026-09-02T19:00:00.000Z",
      newEndsAt: "2026-09-02T19:45:00.000Z",
      conflictCalendarIds: [calendarId!],
      conflictStart: "2026-09-02T18:45:00.000Z",
      conflictEnd: "2026-09-02T19:55:00.000Z",
    };
    await expect(managementProvider.reschedule(zoomRescheduleCommand)).resolves.toMatchObject({
      status: "committed",
      receipt: {
        startsAt: "2026-09-02T19:00:00.000Z",
        endsAt: "2026-09-02T19:45:00.000Z",
      },
    });
    expect(zoomUpdatedBodies).toEqual([{
      start_time: "2026-09-02T19:00:00.000Z",
      timezone: "UTC",
      duration: 45,
      settings: { push_change_to_calendar: false },
    }]);

    const zoomCancelProof = await sha256Base64Url("public Zoom cancellation proof");
    const zoomCancelCommand = {
      kind: "cancel" as const,
      scope: { workspace, principal },
      destinationCalendarId: calendarId!,
      providerBookingId: zoomPublicOperationId,
      providerOperationId: zoomPublicOperationId,
      operationId: "tapmop_public_zoom_cancel",
      providerCommitProof: zoomPublicCommitProof,
      mutationProof: zoomCancelProof,
      bookingStatus: "confirmed" as const,
      startsAt: "2026-09-02T19:00:00.000Z",
      endsAt: "2026-09-02T19:45:00.000Z",
      newStartsAt: null,
      newEndsAt: null,
      conflictCalendarIds: [],
      conflictStart: null,
      conflictEnd: null,
    };
    await expect(managementProvider.cancel(zoomCancelCommand)).resolves.toMatchObject({
      status: "committed",
      receipt: { status: "cancelled" },
    });
    expect(zoomDeletedMeetingIds).toEqual(["98765432101"]);
    await expect(managementProvider.recover(zoomCancelCommand)).resolves.toMatchObject({
      status: "committed",
      receipt: { status: "cancelled" },
    });
    expect(zoomDeletedMeetingIds).toEqual(["98765432101"]);

    const recoveredCancelOperationId = await publicBookingProviderOperationId(
      { workspace, principal },
      calendarId!,
      "ffffffff-ffff-4fff-8fff-ffffffffffff",
    );
    const recoveredCancelCommitProof = await sha256Base64Url(
      "public Zoom recovery cancellation commit proof",
    );
    await expect(publicProvider.commit({
      scope: { workspace, principal },
      destinationCalendarId: calendarId!,
      operationId: recoveredCancelOperationId,
      commitProof: recoveredCancelCommitProof,
      startsAt: "2026-09-03T18:00:00.000Z",
      endsAt: "2026-09-03T18:30:00.000Z",
      conflictCalendarIds: [calendarId!],
      conflictStart: "2026-09-03T18:00:00.000Z",
      conflictEnd: "2026-09-03T18:30:00.000Z",
      title: "Zoom cancellation recovery",
      description: "Reconcile a removed Google event with Zoom.",
      location: "zoom",
      guest: { name: "Recovery Guest", email: "recovery-guest@example.com" },
      bookingKind: "meeting",
      conferenceProvider: "zoom",
      expiresAt: null,
    })).resolves.toMatchObject({ status: "committed" });
    providerEvents.delete(recoveredCancelOperationId);
    providerEventCalendars.delete(recoveredCancelOperationId);
    goneProviderEvents.add(recoveredCancelOperationId);
    const recoveredCancelCommand = {
      kind: "cancel" as const,
      scope: { workspace, principal },
      destinationCalendarId: calendarId!,
      providerBookingId: recoveredCancelOperationId,
      providerOperationId: recoveredCancelOperationId,
      operationId: "tapmop_public_zoom_cancel_recovery",
      providerCommitProof: recoveredCancelCommitProof,
      mutationProof: await sha256Base64Url("public Zoom cancellation recovery proof"),
      bookingStatus: "confirmed" as const,
      startsAt: "2026-09-03T18:00:00.000Z",
      endsAt: "2026-09-03T18:30:00.000Z",
      newStartsAt: null,
      newEndsAt: null,
      conflictCalendarIds: [],
      conflictStart: null,
      conflictEnd: null,
    };
    await expect(managementProvider.recover(recoveredCancelCommand)).resolves.toMatchObject({
      status: "committed",
      receipt: { status: "cancelled" },
    });
    expect(zoomDeletedMeetingIds).toEqual(["98765432101", "98765432102"]);

    const recoveredRescheduleOperationId = await publicBookingProviderOperationId(
      { workspace, principal },
      calendarId!,
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
    const recoveredRescheduleCommitProof = await sha256Base64Url(
      "public Zoom recovery reschedule commit proof",
    );
    await expect(publicProvider.commit({
      scope: { workspace, principal },
      destinationCalendarId: calendarId!,
      operationId: recoveredRescheduleOperationId,
      commitProof: recoveredRescheduleCommitProof,
      startsAt: "2026-09-04T18:00:00.000Z",
      endsAt: "2026-09-04T18:30:00.000Z",
      conflictCalendarIds: [calendarId!],
      conflictStart: "2026-09-04T18:00:00.000Z",
      conflictEnd: "2026-09-04T18:30:00.000Z",
      title: "Zoom reschedule recovery",
      description: "Reconcile an updated Google event with Zoom.",
      location: "zoom",
      guest: { name: "Recovery Guest", email: "recovery-guest@example.com" },
      bookingKind: "meeting",
      conferenceProvider: "zoom",
      expiresAt: null,
    })).resolves.toMatchObject({ status: "committed" });
    const recoveredRescheduleProof = await sha256Base64Url(
      "public Zoom reschedule recovery proof",
    );
    const currentRecoveryEvent = providerEvents.get(recoveredRescheduleOperationId)!;
    const currentRecoveryExtended = isRecordForTest(currentRecoveryEvent.extendedProperties)
      ? currentRecoveryEvent.extendedProperties
      : {};
    const currentRecoveryPrivate = isRecordForTest(currentRecoveryExtended.private)
      ? currentRecoveryExtended.private
      : {};
    providerEvents.set(recoveredRescheduleOperationId, {
      ...currentRecoveryEvent,
      etag: `"${recoveredRescheduleOperationId}-recovered"`,
      start: { dateTime: "2026-09-05T20:00:00.000Z" },
      end: { dateTime: "2026-09-05T21:00:00.000Z" },
      extendedProperties: {
        ...currentRecoveryExtended,
        private: {
          ...currentRecoveryPrivate,
          tapRescheduleHash: recoveredRescheduleProof,
        },
      },
    });
    const zoomUpdatesBeforeRecovery = zoomUpdatedBodies.length;
    await expect(managementProvider.recover({
      kind: "reschedule",
      scope: { workspace, principal },
      destinationCalendarId: calendarId!,
      providerBookingId: recoveredRescheduleOperationId,
      providerOperationId: recoveredRescheduleOperationId,
      operationId: "tapmop_public_zoom_reschedule_recovery",
      providerCommitProof: recoveredRescheduleCommitProof,
      mutationProof: recoveredRescheduleProof,
      bookingStatus: "confirmed",
      startsAt: "2026-09-04T18:00:00.000Z",
      endsAt: "2026-09-04T18:30:00.000Z",
      newStartsAt: "2026-09-05T20:00:00.000Z",
      newEndsAt: "2026-09-05T21:00:00.000Z",
      conflictCalendarIds: [calendarId!],
      conflictStart: "2026-09-05T20:00:00.000Z",
      conflictEnd: "2026-09-05T21:00:00.000Z",
    })).resolves.toMatchObject({ status: "committed" });
    expect(zoomUpdatedBodies).toHaveLength(zoomUpdatesBeforeRecovery + 1);
    expect(zoomUpdatedBodies.at(-1)).toMatchObject({
      start_time: "2026-09-05T20:00:00.000Z",
      duration: 60,
    });

    const ambiguousRescheduleOperationId = await publicBookingProviderOperationId(
      { workspace, principal },
      calendarId!,
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    );
    const ambiguousRescheduleCommitProof = await sha256Base64Url(
      "public Zoom ambiguous reschedule commit proof",
    );
    await expect(publicProvider.commit({
      scope: { workspace, principal },
      destinationCalendarId: calendarId!,
      operationId: ambiguousRescheduleOperationId,
      commitProof: ambiguousRescheduleCommitProof,
      startsAt: "2026-09-06T18:00:00.000Z",
      endsAt: "2026-09-06T18:30:00.000Z",
      conflictCalendarIds: [calendarId!],
      conflictStart: "2026-09-06T18:00:00.000Z",
      conflictEnd: "2026-09-06T18:30:00.000Z",
      title: "Ambiguous Zoom reschedule",
      description: "Keep both providers aligned after an uncertain Google write.",
      location: "zoom",
      guest: { name: "Recovery Guest", email: "recovery-guest@example.com" },
      bookingKind: "meeting",
      conferenceProvider: "zoom",
      expiresAt: null,
    })).resolves.toMatchObject({ status: "committed" });
    const ambiguousRescheduleProof = await sha256Base64Url(
      "public Zoom ambiguous reschedule proof",
    );
    const ambiguousRescheduleCommand = {
      kind: "reschedule" as const,
      scope: { workspace, principal },
      destinationCalendarId: calendarId!,
      providerBookingId: ambiguousRescheduleOperationId,
      providerOperationId: ambiguousRescheduleOperationId,
      operationId: "tapmop_public_zoom_reschedule_ambiguous",
      providerCommitProof: ambiguousRescheduleCommitProof,
      mutationProof: ambiguousRescheduleProof,
      bookingStatus: "confirmed" as const,
      startsAt: "2026-09-06T18:00:00.000Z",
      endsAt: "2026-09-06T18:30:00.000Z",
      newStartsAt: "2026-09-07T20:00:00.000Z",
      newEndsAt: "2026-09-07T21:00:00.000Z",
      conflictCalendarIds: [calendarId!],
      conflictStart: "2026-09-07T20:00:00.000Z",
      conflictEnd: "2026-09-07T21:00:00.000Z",
    };
    googlePatchTransientFailures.add(ambiguousRescheduleOperationId);
    await expect(managementProvider.reschedule(ambiguousRescheduleCommand)).resolves.toEqual({
      status: "uncertain",
    });
    expect(zoomMeetingSchedules.get("98765432104")).toEqual({
      startTime: "2026-09-07T20:00:00.000Z",
      durationMinutes: 60,
    });
    googlePatchTransientFailures.delete(ambiguousRescheduleOperationId);
    await expect(managementProvider.recover(ambiguousRescheduleCommand)).resolves.toEqual({
      status: "absent",
    });
    expect(zoomMeetingSchedules.get("98765432104")).toEqual({
      startTime: "2026-09-06T18:00:00.000Z",
      durationMinutes: 30,
    });

    const changedCancelOperationId = await publicBookingProviderOperationId(
      { workspace, principal },
      calendarId!,
      "11111111-1111-4111-8111-111111111111",
    );
    const changedCancelCommitProof = await sha256Base64Url(
      "public Zoom changed cancellation commit proof",
    );
    await expect(publicProvider.commit({
      scope: { workspace, principal },
      destinationCalendarId: calendarId!,
      operationId: changedCancelOperationId,
      commitProof: changedCancelCommitProof,
      startsAt: "2026-09-08T18:00:00.000Z",
      endsAt: "2026-09-08T18:30:00.000Z",
      conflictCalendarIds: [calendarId!],
      conflictStart: "2026-09-08T18:00:00.000Z",
      conflictEnd: "2026-09-08T18:30:00.000Z",
      title: "Changed Zoom cancellation",
      description: "Do not remove Zoom when Google's event version changed.",
      location: "zoom",
      guest: { name: "Concurrent Guest", email: "concurrent-guest@example.com" },
      bookingKind: "meeting",
      conferenceProvider: "zoom",
      expiresAt: null,
    })).resolves.toMatchObject({ status: "committed" });
    const changedCancelCommand = {
      kind: "cancel" as const,
      scope: { workspace, principal },
      destinationCalendarId: calendarId!,
      providerBookingId: changedCancelOperationId,
      providerOperationId: changedCancelOperationId,
      operationId: "tapmop_public_zoom_cancel_changed",
      providerCommitProof: changedCancelCommitProof,
      mutationProof: await sha256Base64Url("public Zoom changed cancellation proof"),
      bookingStatus: "confirmed" as const,
      startsAt: "2026-09-08T18:00:00.000Z",
      endsAt: "2026-09-08T18:30:00.000Z",
      newStartsAt: null,
      newEndsAt: null,
      conflictCalendarIds: [],
      conflictStart: null,
      conflictEnd: null,
    };
    googleDeletePreconditionFailures.add(changedCancelOperationId);
    await expect(managementProvider.cancel(changedCancelCommand)).resolves.toEqual({
      status: "conflict",
      reason: "provider-mismatch",
    });
    expect(zoomMeetingSchedules.get("98765432105")).toEqual({
      startTime: "2026-09-08T18:00:00.000Z",
      durationMinutes: 30,
    });
    expect(zoomDeletedMeetingIds).not.toContain("98765432105");
    googleDeletePreconditionFailures.delete(changedCancelOperationId);
    await expect(managementProvider.cancel(changedCancelCommand)).resolves.toMatchObject({
      status: "committed",
      receipt: { status: "cancelled" },
    });
    expect(zoomDeletedMeetingIds).toContain("98765432105");

    const holdOperationId = await publicBookingProviderOperationId(
      { workspace, principal },
      calendarId!,
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    );
    const holdCommitProof = await sha256Base64Url("public approval hold commit proof");
    await expect(publicProvider.commit({
      scope: { workspace, principal },
      destinationCalendarId: calendarId!,
      operationId: holdOperationId,
      commitProof: holdCommitProof,
      startsAt: "2026-08-29T18:00:00.000Z",
      endsAt: "2026-08-29T18:30:00.000Z",
      conflictCalendarIds: managementConflictCalendarIds,
      conflictStart: "2026-08-29T18:00:00.000Z",
      conflictEnd: "2026-08-29T18:30:00.000Z",
      title: "Pending public call",
      description: "Awaiting organizer approval.",
      location: "",
      guest: { name: "Pending Guest", email: "pending@example.com" },
      bookingKind: "approval-hold",
      conferenceProvider: "none",
      expiresAt: "2026-08-30T18:00:00.000Z",
    })).resolves.toMatchObject({ status: "committed" });
    await expect(managementProvider.cancel({
      kind: "cancel",
      scope: { workspace, principal },
      destinationCalendarId: calendarId!,
      providerBookingId: holdOperationId,
      providerOperationId: holdOperationId,
      operationId: "tapmop_public_hold_cancel",
      providerCommitProof: holdCommitProof,
      mutationProof: await sha256Base64Url("public hold cancellation proof"),
      bookingStatus: "pending",
      startsAt: "2026-08-29T18:00:00.000Z",
      endsAt: "2026-08-29T18:30:00.000Z",
      newStartsAt: null,
      newEndsAt: null,
      conflictCalendarIds: [],
      conflictStart: null,
      conflictEnd: null,
    })).resolves.toMatchObject({ status: "committed" });
    expect(deleteRequests.at(-1)?.sendUpdates).toBe("none");
  }, 15_000);

  it("keeps workspaces isolated and deletes only the authorized connection", async () => {
    await worker.fetch(
      request("/v1/connections/local", {
        method: "POST",
        json: {
          id: "account-isolated",
          provider: "google",
          label: "Isolated",
          calendars: [calendar("calendar-primary")],
        },
      }),
      env,
    );
    const otherWorkspace = new Request(
      "https://calendar-gateway.test/v1/connections/account-isolated",
      {
        headers: {
          "X-TAP-Workspace-Id": "workspace-other",
          "X-TAP-Principal-Id": principal,
        },
      },
    );
    expect((await worker.fetch(otherWorkspace, env)).status).toBe(404);

    const crossWorkspaceRemoval = new Request(
      "https://calendar-gateway.test/v1/connections/account-isolated/calendars/remove",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: origin,
          "X-TAP-Workspace-Id": "workspace-other",
          "X-TAP-Principal-Id": principal,
        },
        body: JSON.stringify({ calendarIds: ["calendar-primary"] }),
      },
    );
    expect((await worker.fetch(crossWorkspaceRemoval, env)).status).toBe(404);
    expect(
      await env.CALENDAR_DB.prepare("SELECT COUNT(*) AS count FROM calendar_exclusions")
        .first<number>("count"),
    ).toBe(0);

    const deleted = await worker.fetch(
      request("/v1/connections/account-isolated", { method: "DELETE" }),
      env,
    );
    expect(deleted.status).toBe(204);
    expect(
      await env.CALENDAR_DB.prepare("SELECT COUNT(*) AS count FROM provider_calendars")
        .first<number>("count"),
    ).toBe(0);
    expect(
      await env.CALENDAR_DB.prepare("SELECT COUNT(*) AS count FROM calendar_exclusions")
        .first<number>("count"),
    ).toBe(0);
  });

  it("isolates principals and permits identical durable keys inside one workspace", async () => {
    const otherPrincipal = "user-other";
    const createConnection = (
      principalId: string,
      accountId: string,
      calendarId: string,
    ) => worker.fetch(
      requestForPrincipal(principalId, "/v1/connections/local", {
        method: "POST",
        json: {
          id: accountId,
          provider: "google",
          label: principalId,
          calendars: [calendar(calendarId)],
        },
      }),
      env,
    );
    expect((await createConnection(principal, "account-owner", "calendar-owner")).status)
      .toBe(201);
    expect(await (await worker.fetch(
      requestForPrincipal(otherPrincipal, "/v1/connections"),
      env,
    )).json()).toEqual({ connections: [] });
    expect((await worker.fetch(
      requestForPrincipal(otherPrincipal, "/v1/connections/account-owner"),
      env,
    )).status).toBe(404);
    const collidingCalendar = await createConnection(
      otherPrincipal,
      "account-collision",
      "calendar-owner",
    );
    expect(collidingCalendar.status).toBe(409);
    expect(await collidingCalendar.json()).toMatchObject({
      error: "connection_conflict",
    });
    expect((await worker.fetch(
      requestForPrincipal(otherPrincipal, "/v1/connections/account-collision"),
      env,
    )).status).toBe(404);
    expect((await worker.fetch(
      requestForPrincipal(principal, "/v1/connections/account-owner"),
      env,
    )).status).toBe(200);
    const hiddenEvents = await worker.fetch(
      requestForPrincipal(otherPrincipal, "/v1/events/query", {
        method: "POST",
        json: {
          timeMin: "2026-08-14T14:00:00Z",
          timeMax: "2026-08-14T14:30:00Z",
          calendarIds: ["calendar-owner"],
        },
      }),
      env,
    );
    expect(await hiddenEvents.json()).toMatchObject({
      events: [],
      errors: [{ calendarId: "calendar-owner", code: "calendar_not_found" }],
    });
    expect((await createConnection(
      otherPrincipal,
      "account-other",
      "calendar-other",
    )).status).toBe(201);

    const availabilityPayload = (calendarId: string) => ({
      timeMin: "2026-08-14T14:00:00.000Z",
      timeMax: "2026-08-14T14:30:00.000Z",
      calendarIds: [calendarId],
    });
    const ownerAvailabilityHash = await sha256Base64Url(
      JSON.stringify(availabilityPayload("calendar-owner")),
    );
    const otherAvailabilityHash = await sha256Base64Url(
      JSON.stringify(availabilityPayload("calendar-other")),
    );
    await env.CALENDAR_DB.batch([
      ...([
        [principal, ownerAvailabilityHash, "first"],
        [otherPrincipal, otherAvailabilityHash, "second"],
      ] as const).map(([owner, destination, marker]) =>
        env.CALENDAR_DB.prepare(
          `INSERT INTO availability_confirmations
            (workspace_id, principal_id, idempotency_key, request_hash,
             response_json, created_at)
           VALUES (?, ?, 'shared-key', ?, ?, ?)`,
        ).bind(
          workspace,
          owner,
          destination,
          JSON.stringify({ availabilityConfirmed: true, marker }),
          "2026-08-15T00:00:00.000Z",
        )
      ),
      ...([
        [principal, "calendar-owner", "event-owner", "first"],
        [otherPrincipal, "calendar-other", "event-other", "second"],
      ] as const).map(([owner, destination, eventId, marker]) =>
        env.CALENDAR_DB.prepare(
          `INSERT INTO provider_booking_commits
            (workspace_id, principal_id, idempotency_key, request_hash,
             destination_calendar_id, provider_event_id, booking_kind,
             start_at, end_at, state, response_json, last_error_code,
             created_at, updated_at)
           VALUES (?, ?, 'shared-booking-key', 'request-hash', ?, ?, 'meeting',
                   '2026-08-14T14:00:00.000Z', '2026-08-14T14:30:00.000Z',
                   'rejected', ?, 'fixture_rejected', ?, ?)`,
        ).bind(
          workspace,
          owner,
          destination,
          eventId,
          JSON.stringify({ error: "booking_rejected", marker }),
          "2026-08-15T00:00:00.000Z",
          "2026-08-15T00:00:00.000Z",
        )
      ),
    ]);
    expect(
      await env.CALENDAR_DB.prepare(
        "SELECT COUNT(*) AS count FROM availability_confirmations WHERE idempotency_key = 'shared-key'",
      ).first<number>("count"),
    ).toBe(2);
    expect(
      await env.CALENDAR_DB.prepare(
        "SELECT COUNT(*) AS count FROM provider_booking_commits WHERE idempotency_key = 'shared-booking-key'",
      ).first<number>("count"),
    ).toBe(2);

    for (const [owner, destination, marker] of [
      [principal, "calendar-owner", "first"],
      [otherPrincipal, "calendar-other", "second"],
    ] as const) {
      const replay = await worker.fetch(
        requestForPrincipal(owner, "/v1/availability/confirm", {
          method: "POST",
          json: {
            ...availabilityPayload(destination),
            idempotencyKey: "shared-key",
          },
        }),
        env,
      );
      expect(await replay.json()).toMatchObject({ marker });
      const booking = await worker.fetch(
        requestForPrincipal(owner, "/v1/bookings/shared-booking-key/status"),
        env,
      );
      expect(await booking.json()).toMatchObject({ marker });
    }
  });

  it("adopts legacy rows only for the explicitly configured local owner", async () => {
    const createdAt = "2026-08-15T00:00:00.000Z";
    await env.CALENDAR_DB.batch([
      env.CALENDAR_DB.prepare(
        `INSERT INTO calendar_connections
          (id, workspace_id, provider, mode, label, status,
           credential_ciphertext, token_expires_at, created_at, updated_at,
           last_synced_at, principal_id)
         VALUES ('legacy-account', ?, 'google', 'local', 'Legacy', 'connected',
                 NULL, NULL, ?, ?, NULL, NULL)`,
      ).bind(workspace, createdAt, createdAt),
      env.CALENDAR_DB.prepare(
        `INSERT INTO provider_calendars
          (id, connection_id, provider_calendar_id, name, color, role, writable,
           freshness, is_primary, raw_json, created_at, updated_at)
         VALUES ('legacy-calendar', 'legacy-account', 'legacy@provider.test',
                 'Legacy', '#4285f4', 'owner', 1, 'live', 1, '{}', ?, ?)`,
      ).bind(createdAt, createdAt),
      env.CALENDAR_DB.prepare(
        `INSERT INTO oauth_states
          (state_hash, connection_id, workspace_id, provider,
           verifier_ciphertext, expires_at, created_at, principal_id)
         VALUES ('legacy-state', 'legacy-account', ?, 'google', 'ciphertext',
                 '2099-01-01T00:00:00.000Z', ?, NULL)`,
      ).bind(workspace, createdAt),
      env.CALENDAR_DB.prepare(
        `INSERT INTO availability_confirmations
          (workspace_id, principal_id, idempotency_key, request_hash,
           response_json, created_at)
         VALUES (?, NULL, 'legacy-availability', 'request-hash', '{}', ?)`,
      ).bind(workspace, createdAt),
      env.CALENDAR_DB.prepare(
        `INSERT INTO provider_booking_commits
          (workspace_id, principal_id, idempotency_key, request_hash,
           destination_calendar_id, provider_event_id, booking_kind, start_at,
           end_at, state, response_json, last_error_code, created_at, updated_at)
         VALUES (?, NULL, 'legacy-booking', 'request-hash', 'legacy-calendar',
                 'legacy-event', 'approval-hold', ?, ?, 'rejected', '{}', NULL,
                 ?, ?)`,
      ).bind(
        workspace,
        "2026-08-15T14:00:00.000Z",
        "2026-08-15T14:30:00.000Z",
        createdAt,
        createdAt,
      ),
      env.CALENDAR_DB.prepare(
        `INSERT INTO provider_booking_commit_locks
          (workspace_id, principal_id, destination_calendar_id, lease_token,
           lease_until, updated_at)
         VALUES (?, NULL, 'legacy-calendar', NULL, NULL, ?)`,
      ).bind(workspace, createdAt),
      env.CALENDAR_DB.prepare(
        `INSERT INTO provider_booking_resolutions
          (workspace_id, principal_id, booking_idempotency_key,
           resolution_idempotency_key, request_hash, decision, state,
           response_json, last_error_code, created_at, updated_at)
         VALUES (?, NULL, 'legacy-booking', 'legacy-resolution', 'request-hash',
                 'decline', 'committed', '{}', NULL, ?, ?)`,
      ).bind(workspace, createdAt, createdAt),
    ]);

    const unconfigured = await worker.fetch(
      request("/v1/connections"),
      { ...env, LEGACY_OWNER_PRINCIPAL_ID: "" },
    );
    expect(unconfigured.status).toBe(409);
    expect(await unconfigured.json()).toMatchObject({
      error: "legacy_owner_unconfigured",
    });
    const wrongOwner = await worker.fetch(
      requestForPrincipal("user-other", "/v1/connections"),
      { ...env, LEGACY_OWNER_PRINCIPAL_ID: principal },
    );
    expect(wrongOwner.status).toBe(403);
    expect(await wrongOwner.json()).toMatchObject({ error: "legacy_owner_mismatch" });

    const adopted = await worker.fetch(
      request("/v1/connections"),
      { ...env, LEGACY_OWNER_PRINCIPAL_ID: principal },
    );
    expect(adopted.status).toBe(200);
    expect(await adopted.json()).toMatchObject({
      connections: [{ id: "legacy-account", ownerPrincipalId: principal }],
    });
    for (const table of [
      "calendar_connections",
      "oauth_states",
      "availability_confirmations",
      "provider_booking_commits",
      "provider_booking_commit_locks",
      "provider_booking_resolutions",
    ]) {
      expect(
        await env.CALENDAR_DB.prepare(
          `SELECT COUNT(*) AS count FROM ${table} WHERE principal_id = ?`,
        ).bind(principal).first<number>("count"),
      ).toBe(1);
    }
    expect(await (await worker.fetch(
      requestForPrincipal("user-other", "/v1/connections"),
      { ...env, LEGACY_OWNER_PRINCIPAL_ID: principal },
    )).json()).toEqual({ connections: [] });
  });

  it("fails closed when real OAuth credentials are not configured", async () => {
    const response = await worker.fetch(
      request("/v1/oauth/google/start", {
        method: "POST",
        json: { id: "account-oauth", label: "Google" },
      }),
      withoutOAuthSecrets(),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "provider_unconfigured",
      message: "Google OAuth credentials are not configured in .dev.vars.",
    });
  });

  it("rejects untrusted origins and inconsistent calendar roles", async () => {
    const untrusted = new Request("https://calendar-gateway.test/v1/providers", {
      headers: { Origin: "https://untrusted.example" },
    });
    const denied = await worker.fetch(untrusted, env);
    expect(denied.status).toBe(403);
    expect(denied.headers.get("Access-Control-Allow-Origin")).toBeNull();

    const invalid = await worker.fetch(
      request("/v1/connections/local", {
        method: "POST",
        json: {
          id: "account-invalid",
          provider: "google",
          label: "Invalid",
          calendars: [{ ...calendar("calendar-primary", "reader"), writable: true }],
        },
      }),
      env,
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: "invalid_calendars" });
  });

  it("names live slot checks as availability validation and fails closed when inconclusive", async () => {
    await worker.fetch(
      request("/v1/connections/local", {
        method: "POST",
        json: {
          id: "account-validation-local",
          provider: "google",
          label: "Local fixture",
          calendars: [calendar("calendar-primary")],
        },
      }),
      env,
    );
    const payload = {
      timeMin: "2026-08-14T14:00:00Z",
      timeMax: "2026-08-14T14:30:00Z",
      calendarIds: ["calendar-primary"],
    };
    const validated = await worker.fetch(
      request("/v1/availability/validate", { method: "POST", json: payload }),
      env,
    );
    expect(await validated.json()).toMatchObject({
      available: false,
      conclusive: false,
      source: "provider-live",
    });
    const confirmed = await worker.fetch(
      request("/v1/availability/confirm", {
        method: "POST",
        json: { ...payload, idempotencyKey: "validation-1" },
      }),
      env,
    );
    expect(confirmed.status).toBe(503);
    expect(await confirmed.json()).toMatchObject({ error: "live_availability_unavailable" });

    const replayHash = await sha256Base64Url(JSON.stringify({
      timeMin: "2026-08-14T14:00:00.000Z",
      timeMax: "2026-08-14T14:30:00.000Z",
      calendarIds: ["calendar-primary"],
    }));
    await env.CALENDAR_DB.prepare(
      `INSERT INTO availability_confirmations
        (workspace_id, principal_id, idempotency_key, request_hash, response_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        workspace,
        principal,
        "validation-replay",
        replayHash,
        JSON.stringify({
          availabilityConfirmed: true,
          confirmationId: "confirmation-recorded",
          idempotentReplay: false,
        }),
        "2026-08-15T00:00:00.000Z",
      )
      .run();
    const replayed = await worker.fetch(
      request("/v1/availability/confirm", {
        method: "POST",
        json: { ...payload, idempotencyKey: "validation-replay" },
      }),
      env,
    );
    expect(replayed.status).toBe(200);
    expect(await replayed.json()).toMatchObject({
      availabilityConfirmed: true,
      confirmationId: "confirmation-recorded",
      idempotentReplay: true,
    });
    await env.CALENDAR_DB.prepare(
      `INSERT INTO availability_confirmations
        (workspace_id, principal_id, idempotency_key, request_hash, response_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        workspace,
        principal,
        "validation-conflict-replay",
        replayHash,
        JSON.stringify({
          error: "slot_conflict",
          message: "That time is no longer available.",
        }),
        "2026-08-15T00:00:00.000Z",
      )
      .run();
    const replayedConflict = await worker.fetch(
      request("/v1/availability/confirm", {
        method: "POST",
        json: { ...payload, idempotencyKey: "validation-conflict-replay" },
      }),
      env,
    );
    expect(replayedConflict.status).toBe(409);
    expect(await replayedConflict.json()).toEqual({
      error: "slot_conflict",
      message: "That time is no longer available.",
    });
  });
});
