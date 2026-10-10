import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCalendarGatewayWorker } from "../src/index";

const origin = "http://localhost:3000";
const workspace = "workspace-cache-sync";
const principal = "user-cache-sync";
const connectionId = "account-cache-sync";
const testNow = Date.parse("2026-08-16T12:00:00.000Z");
const range = { timeMin: "2026-08-10T00:00:00Z", timeMax: "2026-08-17T00:00:00Z" };
const DAY_MS = 24 * 60 * 60 * 1000;

const testEncryptionKey = (): string => {
  let binary = "";
  for (let index = 0; index < 32; index += 1) binary += String.fromCharCode(index + 1);
  return btoa(binary);
};

const request = (
  path: string,
  init: RequestInit & { readonly json?: unknown } = {},
): Request => {
  const headers = new Headers(init.headers);
  headers.set("Origin", origin);
  headers.set("X-TAP-Workspace-Id", workspace);
  headers.set("X-TAP-Principal-Id", principal);
  if (init.json !== undefined) headers.set("Content-Type", "application/json");
  return new Request(`https://calendar-gateway.test${path}`, {
    ...init,
    headers,
    ...(init.json === undefined ? {} : { body: JSON.stringify(init.json) }),
  });
};

const googleEvent = (id: string, title: string, start: string, end: string) => ({
  id,
  summary: title,
  status: "confirmed",
  updated: "2026-08-15T12:00:00Z",
  start: { dateTime: start },
  end: { dateTime: end },
});

const snapshotEvents = [
  googleEvent("planning", "Planning", "2026-08-12T15:00:00Z", "2026-08-12T16:00:00Z"),
  googleEvent("review", "Review", "2026-08-13T15:00:00Z", "2026-08-13T16:00:00Z"),
];

type ProviderHandler = (url: URL) => Response | Promise<Response>;

interface QueryResult {
  readonly events: readonly { readonly title: string; readonly calendarId: string }[];
  readonly syncedCalendarIds: readonly string[];
  readonly servedCalendarIds: readonly string[];
  readonly errors: readonly { readonly calendarId: string; readonly code: string }[];
  readonly source: string;
  readonly cache: {
    readonly calendars: readonly {
      readonly calendarId: string;
      readonly cacheRevision: number;
      readonly freshness: string;
      readonly error: { readonly code: string } | null;
    }[];
  };
}

interface SyncStateRow {
  readonly active_generation: string;
  readonly cache_revision: number;
  readonly sync_token: string | null;
  readonly freshness: string;
  readonly last_success_at: string | null;
  readonly next_sync_at: string;
  readonly error_code: string | null;
  readonly consecutive_failures: number;
  readonly lease_until: string | null;
  readonly cache_time_max: string | null;
  readonly rebuild_queued_at: string | null;
}

const backgroundContext = () => {
  const work: Promise<unknown>[] = [];
  const ctx = {
    waitUntil(promise: Promise<unknown>) {
      work.push(promise);
    },
    passThroughOnException() {},
  } as unknown as ExecutionContext;
  return { work, ctx };
};

const syncState = (calendarId: string) =>
  env.CALENDAR_DB.prepare("SELECT * FROM calendar_sync_state WHERE calendar_id = ?")
    .bind(calendarId)
    .first<SyncStateRow>();

const cacheRows = async (calendarId: string) =>
  (await env.CALENDAR_DB.prepare(
    `SELECT provider_event_id, sync_generation, cached_at, tombstoned
       FROM calendar_event_cache WHERE calendar_id = ?
      ORDER BY provider_event_id, sync_generation`,
  )
    .bind(calendarId)
    .all<{
      readonly provider_event_id: string;
      readonly sync_generation: string;
      readonly cached_at: string;
      readonly tombstoned: number;
    }>()).results;

const updateState = (calendarId: string, assignments: string, ...values: unknown[]) =>
  env.CALENDAR_DB.prepare(`UPDATE calendar_sync_state SET ${assignments} WHERE calendar_id = ?`)
    .bind(...values, calendarId)
    .run();

const makeDue = (calendarId: string) =>
  updateState(calendarId, "next_sync_at = ?", "2000-01-01T00:00:00.000Z");

const pagesForever = (url: URL) => {
  const page = Number(url.searchParams.get("pageToken")?.replace("page-", "") ?? "0");
  return Response.json({ items: [], nextPageToken: `page-${page + 1}` });
};

async function connectGoogle(calendars: readonly string[] = ["primary@example.com"]) {
  const calls: URL[] = [];
  const provider = {
    calendarList: calendars.map((id, index) => ({
      id,
      summary: id,
      accessRole: "owner",
      primary: index === 0,
      backgroundColor: "#4285f4",
    })),
    snapshot: ((_url: URL) =>
      Response.json({ items: snapshotEvents, nextSyncToken: "token-1" })) as ProviderHandler,
    incremental: ((_url: URL) =>
      Response.json({ items: [], nextSyncToken: "token-2" })) as ProviderHandler,
    live: ((_url: URL) => Response.json({ items: [] })) as ProviderHandler,
  };
  const providerFetch: typeof fetch = async input => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    calls.push(url);
    if (url.origin === "https://oauth2.googleapis.com" && url.pathname === "/token") {
      return Response.json({
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_in: 3600,
        token_type: "Bearer",
      });
    }
    if (url.pathname === "/calendar/v3/users/me/calendarList") {
      return Response.json({ items: provider.calendarList });
    }
    if (url.pathname.endsWith("/events")) {
      if (url.searchParams.get("orderBy") === "startTime") return provider.live(url);
      return url.searchParams.has("syncToken")
        ? provider.incremental(url)
        : provider.snapshot(url);
    }
    return Response.json(
      { error: { message: `Unexpected provider request: ${url.href}` } },
      { status: 500 },
    );
  };
  const rebuildQueue = {
    messages: [] as unknown[],
    failSends: false,
  };
  const oauthEnv = {
    ...env,
    TOKEN_ENCRYPTION_KEY: testEncryptionKey(),
    GOOGLE_CLIENT_ID: "google-client-id",
    GOOGLE_CLIENT_SECRET: "google-client-secret",
    PUBLIC_BASE_URL: "",
    CALENDAR_REBUILD_QUEUE: {
      async send(body: unknown) {
        if (rebuildQueue.failSends) throw new Error("Queue unavailable");
        rebuildQueue.messages.push(body);
      },
    } as unknown as Queue,
  };
  const worker = createCalendarGatewayWorker(providerFetch);
  const started = await worker.fetch(
    request("/v1/oauth/google/start", {
      method: "POST",
      json: { id: connectionId, label: "Google" },
    }),
    oauthEnv,
  );
  const { authorizationUrl } = await started.json<{ readonly authorizationUrl: string }>();
  const state = new URL(authorizationUrl).searchParams.get("state")!;
  const completed = await worker.fetch(
    request(`/v1/oauth/google/callback?state=${encodeURIComponent(state)}&code=code`),
    oauthEnv,
  );
  expect(completed.status).toBe(200);
  const rows = (await env.CALENDAR_DB.prepare(
    "SELECT id, provider_calendar_id FROM provider_calendars WHERE connection_id = ?",
  )
    .bind(connectionId)
    .all<{ readonly id: string; readonly provider_calendar_id: string }>()).results;
  const calendarIds = calendars.map(providerId =>
    rows.find(row => row.provider_calendar_id === providerId)!.id
  );
  const query = async (
    body: Readonly<Record<string, unknown>> = {},
    ctx?: ExecutionContext,
  ): Promise<QueryResult> => {
    const response = await worker.fetch(
      request("/v1/events/query", {
        method: "POST",
        json: { ...range, calendarIds, ...body },
      }),
      oauthEnv,
      ctx,
    );
    expect(response.status).toBe(200);
    return response.json<QueryResult>();
  };
  const eventCalls = () => calls.filter(url => url.pathname.endsWith("/events"));
  const syncCalls = () => eventCalls().filter(url => url.searchParams.has("syncToken"));
  const calendarListCalls = () =>
    calls.filter(url => url.pathname === "/calendar/v3/users/me/calendarList");
  /** Delivers every queued rebuild to the Worker's queue consumer and drains the queue. */
  const deliverRebuilds = async () => {
    const outcomes: string[] = [];
    const messages = rebuildQueue.messages.splice(0);
    await worker.queue({
      queue: "tap-calendar-cache-rebuilds",
      messages: messages.map((body, index) => ({
        id: `rebuild-${index}`,
        timestamp: new Date(),
        attempts: 1,
        body,
        ack() {
          outcomes.push("ack");
        },
        retry() {
          outcomes.push("retry");
        },
      })),
      ackAll() {},
      retryAll() {},
    } as unknown as MessageBatch<unknown>, oauthEnv);
    return outcomes;
  };
  return {
    calendarId: calendarIds[0]!,
    calendarIds,
    provider,
    rebuildQueue,
    deliverRebuilds,
    query,
    worker,
    oauthEnv,
    eventCalls,
    syncCalls,
    calendarListCalls,
  };
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(testNow);
  // Connections cascade to calendars, sync state, cached events, and watch channels.
  await env.CALENDAR_DB.prepare("DELETE FROM calendar_connections WHERE workspace_id = ?")
    .bind(workspace)
    .run();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("calendar cache reads and sync", () => {
  it("serves cached events within the wait budget and revalidates in the background", async () => {
    const google = await connectGoogle();
    const warm = await google.query();
    expect(warm.events.map(event => event.title)).toEqual(["Planning", "Review"]);
    expect(warm.syncedCalendarIds).toEqual([google.calendarId]);

    // Google hangs on the incremental sync. A `wait` read still answers from D1 once
    // its budget runs out, and the sync finishes under waitUntil.
    await makeDue(google.calendarId);
    let releaseSync!: () => void;
    const syncGate = new Promise<void>(resolve => {
      releaseSync = resolve;
    });
    let syncStarted = false;
    let syncFinished = false;
    google.provider.incremental = async () => {
      syncStarted = true;
      await syncGate;
      syncFinished = true;
      return Response.json({
        items: [googleEvent("added", "Added later", "2026-08-14T15:00:00Z", "2026-08-14T16:00:00Z")],
        nextSyncToken: "token-2",
      });
    };
    const waited = backgroundContext();
    const budgeted = await google.query({ revalidate: "wait" }, waited.ctx);
    expect(syncStarted).toBe(true);
    expect(syncFinished).toBe(false);
    expect(budgeted).toMatchObject({
      source: "cache",
      syncedCalendarIds: [],
      servedCalendarIds: [google.calendarId],
      events: [{ title: "Planning" }, { title: "Review" }],
      cache: { calendars: [{ cacheRevision: 1, freshness: "stale" }] },
    });
    releaseSync();
    await Promise.all(waited.work);
    expect(await syncState(google.calendarId)).toMatchObject({
      cache_revision: 2,
      sync_token: "token-2",
      lease_until: null,
    });
    expect((await google.query()).events.map(event => event.title)).toEqual([
      "Planning",
      "Review",
      "Added later",
    ]);

    // `background` never waits: the response is built before Google answers.
    await makeDue(google.calendarId);
    let releaseBackground!: () => void;
    const backgroundGate = new Promise<void>(resolve => {
      releaseBackground = resolve;
    });
    google.provider.incremental = async () => {
      await backgroundGate;
      return Response.json({ items: [], nextSyncToken: "token-3" });
    };
    const background = backgroundContext();
    const immediate = await google.query({ revalidate: "background" }, background.ctx);
    expect(immediate).toMatchObject({ source: "cache", syncedCalendarIds: [] });
    expect(immediate.events).toHaveLength(3);
    releaseBackground();
    await Promise.all(background.work);
    expect(await syncState(google.calendarId)).toMatchObject({ sync_token: "token-3" });
  });

  it("never waits on another request's sync lease", async () => {
    const google = await connectGoogle();
    await google.query();
    await updateState(
      google.calendarId,
      "next_sync_at = ?, lease_until = ?",
      "2000-01-01T00:00:00.000Z",
      new Date(testNow + 60_000).toISOString(),
    );
    const callsBefore = google.eventCalls().length;
    const { work, ctx } = backgroundContext();
    const result = await google.query({ revalidate: "wait" }, ctx);
    await Promise.all(work);
    expect(result).toMatchObject({
      source: "cache",
      syncedCalendarIds: [],
      events: [{ title: "Planning" }, { title: "Review" }],
    });
    expect(google.eventCalls()).toHaveLength(callsBefore);
  });

  it("writes no cached events on a zero-change sync and applies changes in place", async () => {
    const google = await connectGoogle();
    await google.query();
    const rowsBefore = await cacheRows(google.calendarId);
    const stateBefore = (await syncState(google.calendarId))!;
    expect(rowsBefore).toHaveLength(2);

    vi.setSystemTime(testNow + 3 * 60_000);
    google.provider.incremental = () => Response.json({ items: [], nextSyncToken: "token-2" });
    const unchanged = await google.query();
    expect(unchanged).toMatchObject({
      syncedCalendarIds: [google.calendarId],
      cache: { calendars: [{ cacheRevision: stateBefore.cache_revision, freshness: "fresh" }] },
    });
    expect(await cacheRows(google.calendarId)).toEqual(rowsBefore);
    expect(await syncState(google.calendarId)).toMatchObject({
      active_generation: stateBefore.active_generation,
      cache_revision: stateBefore.cache_revision,
      sync_token: "token-2",
      last_success_at: new Date(testNow + 3 * 60_000).toISOString(),
      lease_until: null,
    });

    // Changes land in the active generation; untouched rows keep their original write.
    vi.setSystemTime(testNow + 6 * 60_000);
    google.provider.incremental = () => Response.json({
      items: [
        { id: "review", status: "cancelled", updated: "2026-08-16T12:05:00Z" },
        googleEvent("added", "Added", "2026-08-14T15:00:00Z", "2026-08-14T16:00:00Z"),
      ],
      nextSyncToken: "token-3",
    });
    const changed = await google.query();
    expect(changed.events.map(event => event.title)).toEqual(["Planning", "Added"]);
    const rowsAfter = await cacheRows(google.calendarId);
    expect(rowsAfter.every(row => row.sync_generation === stateBefore.active_generation)).toBe(true);
    expect(rowsAfter.find(row => row.provider_event_id === "planning"))
      .toEqual(rowsBefore.find(row => row.provider_event_id === "planning"));
    expect(rowsAfter.find(row => row.provider_event_id === "review")).toMatchObject({ tombstoned: 1 });
    expect(await syncState(google.calendarId)).toMatchObject({
      active_generation: stateBefore.active_generation,
      cache_revision: stateBefore.cache_revision + 1,
      sync_token: "token-3",
    });

    // A change set larger than one batch is staged, then merged and committed atomically.
    vi.setSystemTime(testNow + 9 * 60_000);
    google.provider.incremental = () => Response.json({
      items: Array.from({ length: 90 }, (_, index) =>
        googleEvent(
          `bulk-${String(index).padStart(2, "0")}`,
          `Bulk ${index}`,
          "2026-08-11T09:00:00Z",
          "2026-08-11T09:30:00Z",
        )
      ),
      nextSyncToken: "token-4",
    });
    const bulk = await google.query();
    expect(bulk.events).toHaveLength(92);
    const bulkRows = await cacheRows(google.calendarId);
    expect(bulkRows).toHaveLength(93);
    expect(bulkRows.every(row => row.sync_generation === stateBefore.active_generation)).toBe(true);
    expect(await syncState(google.calendarId)).toMatchObject({
      cache_revision: stateBefore.cache_revision + 2,
      sync_token: "token-4",
    });
  });

  it("drops a sync token that fails permanently and rebuilds with a reduced window", async () => {
    const google = await connectGoogle();
    await google.query();
    expect((await syncState(google.calendarId))!.sync_token).toBe("token-1");

    // The token's change feed never ends, and so does a 180-day rebuild; 90 days fits.
    google.provider.incremental = pagesForever;
    google.provider.snapshot = url => {
      const futureDays = (Date.parse(url.searchParams.get("timeMax")!) - Date.now()) / DAY_MS;
      return futureDays > 100
        ? pagesForever(url)
        : Response.json({ items: snapshotEvents, nextSyncToken: "token-rebuilt" });
    };
    await makeDue(google.calendarId);
    const rebuilt = await google.query();
    expect(rebuilt).toMatchObject({ syncedCalendarIds: [google.calendarId], errors: [] });
    const rebuiltState = (await syncState(google.calendarId))!;
    expect(rebuiltState).toMatchObject({ sync_token: "token-rebuilt", error_code: null });
    expect(Date.parse(rebuiltState.cache_time_max!)).toBe(testNow + 90 * DAY_MS);

    // A range past the reduced window is read live instead of forcing the same rebuild
    // again, until the rebuild cooldown passes.
    const farRange = {
      timeMin: new Date(testNow + 100 * DAY_MS).toISOString(),
      timeMax: new Date(testNow + 107 * DAY_MS).toISOString(),
    };
    const snapshotCalls = () => google.eventCalls().filter(url =>
      !url.searchParams.has("syncToken") && url.searchParams.get("orderBy") !== "startTime"
    ).length;
    const snapshotsBefore = snapshotCalls();
    expect(await google.query(farRange)).toMatchObject({
      source: "live",
      servedCalendarIds: [google.calendarId],
    });
    expect(snapshotCalls()).toBe(snapshotsBefore);
    await updateState(
      google.calendarId,
      "cache_time_min = ?",
      new Date(testNow - 31 * DAY_MS - 7 * 60 * 60 * 1000).toISOString(),
    );
    await google.query(farRange);
    expect(snapshotCalls()).toBeGreaterThan(snapshotsBefore);

    // If the rebuild fails too, the bad token is still cleared for the next attempt.
    google.provider.snapshot = () =>
      Response.json({ error: { message: "Backend Error" } }, { status: 503 });
    await makeDue(google.calendarId);
    await google.query();
    expect(await syncState(google.calendarId)).toMatchObject({
      sync_token: null,
      error_code: "provider_request_failed",
      freshness: "stale",
      lease_until: null,
    });
    google.provider.snapshot = () =>
      Response.json({ items: snapshotEvents, nextSyncToken: "token-recovered" });
    await makeDue(google.calendarId);
    const syncCallsBefore = google.syncCalls().length;
    await google.query();
    expect(google.syncCalls()).toHaveLength(syncCallsBefore);
    expect(await syncState(google.calendarId)).toMatchObject({
      sync_token: "token-recovered",
      error_code: null,
    });

    // An oversized page resets the token too, and the rebuild retries with smaller pages.
    const oversized = () => new Response(`{"items":"${"x".repeat(4 * 1024 * 1024)}"}`, {
      headers: { "Content-Type": "application/json" },
    });
    google.provider.incremental = oversized;
    google.provider.snapshot = url => url.searchParams.get("maxResults") === "500"
      ? oversized()
      : Response.json({ items: snapshotEvents, nextSyncToken: "token-small-pages" });
    await makeDue(google.calendarId);
    await google.query();
    expect(await syncState(google.calendarId)).toMatchObject({
      sync_token: "token-small-pages",
      error_code: null,
    });
    expect(google.eventCalls().at(-1)!.searchParams.get("maxResults")).toBe("100");
  });

  it("treats Google 403 rate limits as retryable and rediscovers calendars after lost access", async () => {
    const google = await connectGoogle(["primary@example.com", "shared@example.com"]);
    const [primaryId, sharedId] = google.calendarIds as [string, string];
    await google.query();
    expect(google.calendarListCalls()).toHaveLength(1);

    const isShared = (url: URL) => url.pathname.includes(encodeURIComponent("shared@example.com"));
    google.provider.incremental = url => isShared(url)
      ? Response.json({
        error: {
          code: 403,
          message: "Rate Limit Exceeded",
          errors: [{ domain: "usageLimits", reason: "rateLimitExceeded", message: "Rate Limit Exceeded" }],
        },
      }, { status: 403 })
      : Response.json({ items: [], nextSyncToken: "token-2" });
    await makeDue(primaryId);
    await makeDue(sharedId);
    const limited = await google.query();
    expect(await syncState(sharedId)).toMatchObject({
      error_code: "provider_rate_limited",
      consecutive_failures: 1,
      lease_until: null,
    });
    expect(limited.errors).toContainEqual(expect.objectContaining({
      calendarId: sharedId,
      code: "provider_rate_limited",
    }));
    expect(google.calendarListCalls()).toHaveLength(1);

    // A plain 403 means access was lost: the calendar list is re-read and the
    // unshared calendar drops out with its cache.
    google.provider.calendarList = google.provider.calendarList.slice(0, 1);
    google.provider.incremental = url => isShared(url)
      ? Response.json({
        error: { code: 403, message: "Forbidden", errors: [{ reason: "forbidden" }] },
      }, { status: 403 })
      : Response.json({ items: [], nextSyncToken: "token-3" });
    await makeDue(sharedId);
    await google.query();
    expect(google.calendarListCalls()).toHaveLength(2);
    expect(await env.CALENDAR_DB.prepare("SELECT COUNT(*) AS count FROM provider_calendars WHERE id = ?")
      .bind(sharedId).first<number>("count")).toBe(0);
    expect(await syncState(sharedId)).toBeNull();
    expect(await cacheRows(sharedId)).toEqual([]);
    expect(await syncState(primaryId)).toMatchObject({ error_code: null });

    // A calendar the gateway no longer knows triggers rediscovery too, throttled per connection.
    const unknown = await google.query();
    expect(unknown.errors).toContainEqual(expect.objectContaining({
      calendarId: sharedId,
      code: "calendar_not_found",
    }));
    expect(google.calendarListCalls()).toHaveLength(2);
    vi.setSystemTime(testNow + 11 * 60_000);
    await google.query();
    expect(google.calendarListCalls()).toHaveLength(3);
  });

  it("honors retry backoff on reads and stops serving caches past the max age", async () => {
    const google = await connectGoogle();
    await google.query();

    // A failing calendar inside its backoff is served from cache with its error; reads
    // do not retry it.
    await updateState(
      google.calendarId,
      `freshness = 'stale', error_code = 'provider_request_failed',
       error_message = 'Google Calendar could not return events for this calendar.',
       consecutive_failures = 2, next_sync_at = ?`,
      new Date(testNow + 20 * 60_000).toISOString(),
    );
    const callsBefore = google.eventCalls().length;
    const backedOff = await google.query();
    expect(google.eventCalls()).toHaveLength(callsBefore);
    expect(backedOff).toMatchObject({
      source: "cache",
      events: [{ title: "Planning" }, { title: "Review" }],
      errors: [{ calendarId: google.calendarId, code: "provider_request_failed" }],
      cache: { calendars: [{ freshness: "stale", error: { code: "provider_request_failed" } }] },
    });

    // Once the backoff elapses, the next read retries and recovers.
    await makeDue(google.calendarId);
    const recovered = await google.query();
    expect(google.syncCalls()).toHaveLength(1);
    expect(recovered).toMatchObject({ errors: [], syncedCalendarIds: [google.calendarId] });

    // A day-old cache whose calendar keeps failing is not served as current data: the
    // read goes live and surfaces that calendar's error instead.
    vi.setSystemTime(testNow + 25 * 60 * 60 * 1000);
    await updateState(
      google.calendarId,
      "freshness = 'stale', error_code = 'provider_request_failed', next_sync_at = ?",
      new Date(testNow + 26 * 60 * 60 * 1000).toISOString(),
    );
    google.provider.live = () =>
      Response.json({ error: { message: "Backend Error" } }, { status: 503 });
    const syncCallsBefore = google.syncCalls().length;
    const expired = await google.query();
    expect(google.syncCalls()).toHaveLength(syncCallsBefore);
    expect(expired).toMatchObject({
      source: "live",
      events: [],
      servedCalendarIds: [],
      errors: [{ calendarId: google.calendarId, code: "provider_request_failed" }],
    });

    // A calendar that never synced and is in backoff is read live, not re-bootstrapped.
    await updateState(
      google.calendarId,
      "last_success_at = NULL, freshness = 'error', next_sync_at = ?",
      new Date(testNow + 26 * 60 * 60 * 1000).toISOString(),
    );
    google.provider.live = () => Response.json({ items: [snapshotEvents[0]] });
    const snapshotCallsBefore = google.eventCalls().length;
    const cold = await google.query();
    expect(cold).toMatchObject({
      source: "live",
      servedCalendarIds: [google.calendarId],
      events: [{ title: "Planning" }],
    });
    expect(google.eventCalls()).toHaveLength(snapshotCallsBefore + 1);
  });

  it("trusts calendars with a healthy push watch for hours", async () => {
    const google = await connectGoogle();
    await google.query();
    const watched = (lastSuccessMsAgo: number) => updateState(
      google.calendarId,
      `freshness = 'fresh', current_watch_channel_id = 'channel-1', watch_expiration_at = ?,
       last_success_at = ?, next_sync_at = ?`,
      new Date(testNow + 3 * DAY_MS).toISOString(),
      new Date(testNow - lastSuccessMsAgo).toISOString(),
      new Date(testNow + 60 * 60 * 1000).toISOString(),
    );
    await watched(60 * 60 * 1000);
    const callsBefore = google.eventCalls().length;
    expect(await google.query()).toMatchObject({
      syncedCalendarIds: [],
      cache: { calendars: [{ freshness: "fresh" }] },
    });
    expect(google.eventCalls()).toHaveLength(callsBefore);

    // A watched calendar's safety-net sync comes due every 6–12 hours.
    await makeDue(google.calendarId);
    await google.query();
    const nextSyncAt = Date.parse((await syncState(google.calendarId))!.next_sync_at);
    expect(nextSyncAt).toBeGreaterThanOrEqual(testNow + 6 * 60 * 60 * 1000);
    expect(nextSyncAt).toBeLessThanOrEqual(testNow + 12 * 60 * 60 * 1000);

    // A notification that lands while a sync holds the lease keeps the calendar due.
    await makeDue(google.calendarId);
    google.provider.incremental = async () => {
      await updateState(
        google.calendarId,
        "last_notification_at = ?",
        new Date(testNow + 1_000).toISOString(),
      );
      return Response.json({ items: [], nextSyncToken: "token-notified" });
    };
    await google.query();
    expect(await syncState(google.calendarId)).toMatchObject({
      sync_token: "token-notified",
      next_sync_at: new Date(testNow).toISOString(),
    });

    // Without a watch, an hour-old cache is stale and revalidates.
    await watched(60 * 60 * 1000);
    await updateState(
      google.calendarId,
      "current_watch_channel_id = NULL, watch_expiration_at = NULL",
    );
    const unwatchedCalls = google.eventCalls().length;
    expect(await google.query()).toMatchObject({ syncedCalendarIds: [google.calendarId] });
    expect(google.eventCalls()).toHaveLength(unwatchedCalls + 1);
  });

  it("releases the sync lease on every commit failure", async () => {
    const google = await connectGoogle();
    await google.query();
    const original = (await syncState(google.calendarId))!;

    // Another writer moves the snapshot while Google is read: the guarded commit is lost.
    google.provider.incremental = async () => {
      await env.CALENDAR_DB.prepare(
        "UPDATE calendar_sync_state SET cache_revision = cache_revision + 1 WHERE calendar_id = ?",
      ).bind(google.calendarId).run();
      return Response.json({
        items: [googleEvent("added", "Added", "2026-08-14T15:00:00Z", "2026-08-14T16:00:00Z")],
        nextSyncToken: "token-lost",
      });
    };
    await makeDue(google.calendarId);
    await google.query();
    expect(await syncState(google.calendarId)).toMatchObject({
      lease_until: null,
      sync_token: "token-1",
      cache_revision: original.cache_revision + 1,
    });
    expect((await cacheRows(google.calendarId)).map(row => row.provider_event_id))
      .toEqual(["planning", "review"]);

    // The commit batch itself throws: nothing is applied, the failure is recorded,
    // and the lease is released.
    await env.CALENDAR_DB.prepare(
      `CREATE TRIGGER test_fail_cache_commit BEFORE UPDATE OF cache_revision ON calendar_sync_state
       BEGIN SELECT RAISE(ABORT, 'simulated commit failure'); END`,
    ).run();
    try {
      google.provider.incremental = () => Response.json({
        items: [googleEvent("added", "Added", "2026-08-14T15:00:00Z", "2026-08-14T16:00:00Z")],
        nextSyncToken: "token-thrown",
      });
      await makeDue(google.calendarId);
      await google.query();
      expect(await syncState(google.calendarId)).toMatchObject({
        lease_until: null,
        sync_token: "token-1",
        error_code: "provider_request_failed",
      });
      expect((await cacheRows(google.calendarId)).map(row => row.provider_event_id))
        .toEqual(["planning", "review"]);
    } finally {
      await env.CALENDAR_DB.prepare("DROP TRIGGER IF EXISTS test_fail_cache_commit").run();
    }

    // A full rebuild that loses its commit removes its staged generation and the lease.
    await updateState(google.calendarId, "sync_token = NULL, next_sync_at = ?", "2000-01-01T00:00:00.000Z");
    google.provider.snapshot = async () => {
      await env.CALENDAR_DB.prepare(
        "UPDATE calendar_sync_state SET cache_revision = cache_revision + 1 WHERE calendar_id = ?",
      ).bind(google.calendarId).run();
      return Response.json({ items: snapshotEvents, nextSyncToken: "token-rebuild-lost" });
    };
    await google.query();
    const afterRebuild = (await syncState(google.calendarId))!;
    expect(afterRebuild).toMatchObject({ lease_until: null, active_generation: original.active_generation });
    expect((await cacheRows(google.calendarId)).every(row =>
      row.sync_generation === original.active_generation
    )).toBe(true);
  });

  it("queues background full rebuilds once and runs them in the queue consumer", async () => {
    const google = await connectGoogle();
    const snapshotCalls = () => google.eventCalls().filter(url =>
      !url.searchParams.has("syncToken") && url.searchParams.get("orderBy") !== "startTime"
    ).length;
    google.provider.live = () => Response.json({ items: [snapshotEvents[0]] });

    // A cold calendar read in the background is served live while its bootstrap is queued.
    const first = backgroundContext();
    expect(await google.query({}, first.ctx)).toMatchObject({
      source: "live",
      servedCalendarIds: [google.calendarId],
      events: [{ title: "Planning" }],
    });
    await Promise.all(first.work);
    expect(google.rebuildQueue.messages).toEqual([{
      kind: "calendar-cache-rebuild",
      workspaceId: workspace,
      principalId: principal,
      calendarId: google.calendarId,
    }]);
    expect(snapshotCalls()).toBe(0);
    expect(await syncState(google.calendarId)).toMatchObject({
      cache_revision: 0,
      lease_until: null,
      rebuild_queued_at: new Date(testNow).toISOString(),
    });

    // While it is queued, reads neither queue it again nor rebuild it themselves.
    const second = backgroundContext();
    await google.query({}, second.ctx);
    await Promise.all(second.work);
    expect(google.rebuildQueue.messages).toHaveLength(1);
    expect(snapshotCalls()).toBe(0);

    const queued = [...google.rebuildQueue.messages];
    expect(await google.deliverRebuilds()).toEqual(["ack"]);
    expect(snapshotCalls()).toBeGreaterThan(0);
    expect(await syncState(google.calendarId)).toMatchObject({
      cache_revision: 1,
      rebuild_queued_at: null,
      sync_token: "token-1",
    });
    const cached = backgroundContext();
    expect(await google.query({}, cached.ctx)).toMatchObject({
      source: "cache",
      events: [{ title: "Planning" }, { title: "Review" }],
    });
    await Promise.all(cached.work);

    // A redelivered message for a calendar that was already rebuilt does no work.
    const callsBeforeRedelivery = google.eventCalls().length;
    google.rebuildQueue.messages.push(...queued);
    expect(await google.deliverRebuilds()).toEqual(["ack"]);
    expect(google.eventCalls()).toHaveLength(callsBeforeRedelivery);

    // An expired token found by a background refresh is cleared and its rebuild queued;
    // the old cache keeps serving until the consumer replaces it.
    google.provider.incremental = () =>
      Response.json({ error: { message: "Sync token is no longer valid" } }, { status: 410 });
    google.provider.snapshot = () =>
      Response.json({ items: [snapshotEvents[1]!], nextSyncToken: "token-after-410" });
    await makeDue(google.calendarId);
    const expired = backgroundContext();
    expect(await google.query({}, expired.ctx)).toMatchObject({
      source: "cache",
      events: [{ title: "Planning" }, { title: "Review" }],
    });
    await Promise.all(expired.work);
    expect(google.rebuildQueue.messages).toHaveLength(1);
    expect(await syncState(google.calendarId)).toMatchObject({ sync_token: null });
    expect(await google.deliverRebuilds()).toEqual(["ack"]);
    expect(await syncState(google.calendarId)).toMatchObject({
      sync_token: "token-after-410",
      rebuild_queued_at: null,
      cache_revision: 2,
    });
  });

  it("rebuilds inline when the rebuild queue refuses a message", async () => {
    const google = await connectGoogle();
    google.rebuildQueue.failSends = true;
    const { work, ctx } = backgroundContext();
    const result = await google.query({ revalidate: "wait" }, ctx);
    await Promise.all(work);
    expect(result).toMatchObject({
      source: "cache",
      syncedCalendarIds: [google.calendarId],
      events: [{ title: "Planning" }, { title: "Review" }],
    });
    expect(await syncState(google.calendarId)).toMatchObject({
      cache_revision: 1,
      rebuild_queued_at: null,
    });
  });

  it("stamps the owner as active once per interval for cache-repair priority", async () => {
    const google = await connectGoogle();
    const { work, ctx } = backgroundContext();
    await google.query({}, ctx);
    await Promise.all(work);
    const lastRead = () => env.CALENDAR_DB.prepare(
      "SELECT last_read_at FROM calendar_connections WHERE id = ?",
    ).bind(connectionId).first<string | null>("last_read_at");
    expect(await lastRead()).toBe(new Date(testNow).toISOString());
    vi.setSystemTime(testNow + 60_000);
    await google.query();
    expect(await lastRead()).toBe(new Date(testNow).toISOString());
    vi.setSystemTime(testNow + 11 * 60_000);
    await google.query();
    expect(await lastRead()).toBe(new Date(testNow + 11 * 60_000).toISOString());
  });
});
