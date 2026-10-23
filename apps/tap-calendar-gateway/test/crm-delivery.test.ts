import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCalendarGatewayWorker } from "../src/index";
import {
  buildCrmBookingPayload,
  crmRetryDelayMs,
  parseRetryAfterMs,
  postCrmBooking,
  testCrmConnection,
} from "../src/crm-delivery";
import {
  deliverCrmBookings,
  readCrmConnection,
  reconcileCrmDeliveries,
  saveCrmConnection,
} from "../src/crm-store";

const connection = { apiUrl: "https://crm.test", botKey: "bot-key-secret-1234" };
const payload = buildCrmBookingPayload({
  bookingReference: "pb_reference_0123456789",
  status: "CONFIRMED",
  version: 1,
  title: "Intro call",
  startsAt: "2026-10-01T14:00:00.000Z",
  endsAt: "2026-10-01T14:30:00.000Z",
  guestName: "Ada Guest",
  guestEmail: "ada@example.com",
});

const respond = (status: number, body: unknown = {}, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), { status, headers });

describe("CRM booking message", () => {
  it("carries the contract fields and nothing about the management link", () => {
    const built = buildCrmBookingPayload({
      bookingReference: "pb_reference_0123456789",
      status: "CANCELLED",
      version: 3,
      title: "Intro call",
      startsAt: "2026-10-01T14:00:00.000Z",
      endsAt: "2026-10-01T14:30:00.000Z",
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      guestName: "Ada Guest",
      guestEmail: "ada@example.com",
      additionalGuestEmails: ["bob@example.com"],
      hosts: [{ email: "host@example.com", name: "Host" }],
      notes: "  Bring the roadmap.  ",
      bookingPage: "ada/intro-call",
    });
    expect(built).toEqual({
      sourceId: "external:tap-calendar:pb_reference_0123456789",
      status: "CANCELLED",
      version: 3,
      title: "Intro call",
      startsAt: "2026-10-01T14:00:00.000Z",
      endsAt: "2026-10-01T14:30:00.000Z",
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      guest: { email: "ada@example.com", name: "Ada Guest" },
      additionalGuests: [{ email: "bob@example.com" }],
      hosts: [{ email: "host@example.com", name: "Host" }],
      notes: "Bring the roadmap.",
      bookingPage: "ada/intro-call",
    });
    expect(JSON.stringify(built)).not.toMatch(/tapm_v1|manage/iu);
  });

  it("omits an empty or non-https meeting link and caps lists and notes", () => {
    const built = buildCrmBookingPayload({
      bookingReference: "pb_reference_0123456789", status: "CONFIRMED", version: 1, title: "t",
      startsAt: "2026-10-01T14:00:00.000Z", endsAt: "2026-10-01T14:30:00.000Z",
      meetingUrl: "javascript:alert(1)", guestName: "A", guestEmail: "a@example.com",
      additionalGuestEmails: Array.from({ length: 30 }, (_, index) => `g${index}@example.com`),
      notes: "x".repeat(3_000),
    });
    expect(built.meetingUrl).toBeUndefined();
    expect(built.additionalGuests).toHaveLength(20);
    expect(built.notes).toHaveLength(2_000);
  });
});

describe("posting to the CRM", () => {
  it("sends the key as a bearer token, refuses redirects, and treats 2xx as done", async () => {
    const fetchImpl = vi.fn(async () => respond(201, { action: "created" }, { "x-request-id": "req-1" }));
    const outcome = await postCrmBooking(fetchImpl as unknown as typeof fetch, connection, payload);
    expect(outcome).toEqual({ kind: "delivered", requestId: "req-1" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://crm.test/tap/v1/bot/bookings");
    expect(init.redirect).toBe("error");
    expect(init.headers).toMatchObject({
      authorization: "Bearer bot-key-secret-1234",
      "user-agent": expect.stringMatching(/^tap-calendar\//u),
    });
    expect(JSON.parse(init.body as string)).toEqual(payload);
  });

  it.each([
    [429, { "retry-after": "120" }, { kind: "retry", code: "CRM_HTTP_429", retryAfterMs: 120_000 }],
    [503, {}, { kind: "retry", code: "CRM_HTTP_503", retryAfterMs: null }],
    [401, {}, { kind: "invalid_key" }],
    [403, {}, { kind: "missing_scope" }],
    [400, {}, { kind: "rejected", code: "CRM_HTTP_400" }],
    [409, {}, { kind: "rejected", code: "CRM_HTTP_409" }],
  ])("maps %i to the documented outcome", async (status, headers, expected) => {
    const fetchImpl = async () => respond(status, { requestId: "req-body-1", message: "guest@example.com" }, headers);
    const outcome = await postCrmBooking(fetchImpl as unknown as typeof fetch, connection, payload);
    expect(outcome).toMatchObject({ ...expected, requestId: "req-body-1" });
    expect(JSON.stringify(outcome)).not.toContain("guest@example.com");
  });

  it("retries when the CRM cannot be reached", async () => {
    const fetchImpl = async () => { throw new TypeError("network"); };
    expect(await postCrmBooking(fetchImpl as unknown as typeof fetch, connection, payload))
      .toEqual({ kind: "retry", code: "CRM_UNREACHABLE", requestId: null, retryAfterMs: null });
  });

  it("reads Retry-After as seconds or a date, capped, and backs off with jitter", () => {
    expect(parseRetryAfterMs("30", 0)).toBe(30_000);
    expect(parseRetryAfterMs(new Date(60_000).toUTCString(), 0)).toBe(60_000);
    expect(parseRetryAfterMs("999999", 0)).toBe(3_600_000);
    expect(parseRetryAfterMs("soon", 0)).toBeNull();
    expect(crmRetryDelayMs(1, 0.5)).toBe(30_000);
    expect(crmRetryDelayMs(2, 0.5)).toBe(60_000);
    expect(crmRetryDelayMs(30, 0.5)).toBe(3_600_000);
  });

  it("tests with a dry run and names the reason it failed", async () => {
    const bodies: unknown[] = [];
    const reply = (status: number) => async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(init?.body as string));
      return respond(status);
    };
    expect(await testCrmConnection(reply(200) as unknown as typeof fetch, connection)).toEqual({ ok: true, reason: null });
    expect(bodies[0]).toMatchObject({ dryRun: true, status: "CONFIRMED" });
    expect((await testCrmConnection(reply(401) as unknown as typeof fetch, connection)).reason).toBe("invalid_key");
    expect((await testCrmConnection(reply(403) as unknown as typeof fetch, connection)).reason).toBe("missing_scope");
    expect((await testCrmConnection(reply(502) as unknown as typeof fetch, connection)).reason).toBe("unreachable");
    expect((await testCrmConnection(reply(400) as unknown as typeof fetch, connection)).reason).toBe("rejected");
  });
});

const db = env.CALENDAR_DB;
const run = (sql: string, ...values: (string | number | null)[]) => db.prepare(sql).bind(...values).run();
const start = "2026-10-01T14:00:00.000Z";
const end = "2026-10-01T14:30:00.000Z";
let workspace: string;
let principal: string;
let calendar: string;
let counter = 0;
const ids = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
const at = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

async function seedBooking(options: {
  readonly bookingStatus?: string;
  readonly status?: string;
  readonly version?: number;
  readonly updatedAt?: string;
  readonly hosts?: boolean;
} = {}): Promise<string> {
  const reference = `pb_${crypto.randomUUID().replaceAll("-", "")}`;
  const operation = `op_${crypto.randomUUID().replaceAll("-", "")}`;
  const stamp = options.updatedAt ?? at(1_000);
  await run(`INSERT INTO provider_booking_commits (workspace_id, principal_id, idempotency_key, request_hash,
      destination_calendar_id, provider_event_id, booking_kind, start_at, end_at, state, response_json, created_at, updated_at)
    VALUES (?, ?, ?, 'hash', ?, ?, 'meeting', ?, ?, 'committed', ?, ?, ?)`,
  workspace, principal, operation, calendar, `event-${reference}`, start, end,
  JSON.stringify({ booking: { providerJoinUrl: "https://meet.google.com/abc-defg-hij" } }), stamp, stamp);
  await run(`INSERT INTO public_booking_attempts (workspace_id, principal_id, idempotency_key, request_hash,
      provider_operation_id, booking_reference, revision_id, start_at, end_at, guest_name, guest_email,
      details_json, created_at, updated_at)
    VALUES (?, ?, ?, 'hash-0123456789012345', ?, ?, 'revision-crm', ?, ?, 'Ada Guest', 'ada@example.com', ?, ?, ?)`,
  workspace, principal, `key-${reference}-padding`, operation, reference, start, end,
  JSON.stringify({ notes: "Bring the roadmap.", additionalGuests: ["bob@example.com"] }), stamp, stamp);
  await run(`INSERT INTO public_booking_management_credentials (booking_reference, workspace_id, principal_id,
      token_hash, page_id, revision_id, provider_booking_id, provider_operation_id, start_at, end_at,
      guest_name, guest_email, status, booking_status, version, event_title, destination_calendar_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'page-crm-0001', 'revision-crm', ?, ?, ?, ?, 'Ada Guest', 'ada@example.com', ?, ?, ?, 'Intro call', ?, ?, ?)`,
  reference, workspace, principal, crypto.randomUUID().repeat(2), `event-${reference}`, operation, start, end,
  options.status ?? (options.bookingStatus === "cancelled" ? "cancelled" : "active"),
  options.bookingStatus ?? "confirmed", options.version ?? 1, calendar, stamp, stamp);
  if (options.hosts) {
    await run(`INSERT INTO calendar_host_reservations (workspace_id, organizer_principal_id, booking_operation_id,
        host_principal_id, start_ms, end_ms, host_snapshot_json) VALUES (?, ?, ?, 'host-principal', ?, ?, ?)`,
    workspace, principal, operation, Date.parse(start), Date.parse(end),
    JSON.stringify({ principalId: "host-principal", displayName: "Host Person", email: "host@example.com" }));
  }
  return reference;
}

async function setBooking(reference: string, columns: Record<string, string | number>): Promise<void> {
  const names = Object.keys(columns);
  await run(
    `UPDATE public_booking_management_credentials SET ${names.map(name => `${name} = ?`).join(", ")} WHERE booking_reference = ?`,
    ...names.map(name => columns[name]!), reference,
  );
}

const reconcile = () => reconcileCrmDeliveries(db, { now: at(0), limit: 100, id: ids });
const deliveries = (reference: string) => db.prepare(
  `SELECT event_key, booking_status, booking_version, state, attempt_count, payload_json, last_error_code
     FROM crm_booking_deliveries WHERE booking_reference = ? ORDER BY booking_version, booking_status`,
).bind(reference).all<{
  event_key: string; booking_status: string; booking_version: number; state: string;
  attempt_count: number; payload_json: string | null; last_error_code: string | null;
}>().then(result => result.results);

const connect = (when = at(-60_000)) => saveCrmConnection(db, {
  workspace, keyCiphertext: "ciphertext", connectedBy: principal, now: when,
});

beforeEach(async () => {
  // The delivery job is global, so rows from earlier tests would be sent too.
  await run("DELETE FROM crm_booking_deliveries");
  await run("DELETE FROM crm_connections");
  workspace = crypto.randomUUID();
  principal = crypto.randomUUID();
  const connectionId = crypto.randomUUID();
  calendar = crypto.randomUUID();
  await run(`INSERT INTO calendar_connections (id, workspace_id, principal_id, provider, mode, label, status, credential_ciphertext, created_at, updated_at)
    VALUES (?, ?, ?, 'google', 'oauth', 'organizer@example.com', 'connected', 'cipher', ?, ?)`, connectionId, workspace, principal, at(0), at(0));
  await run(`INSERT INTO provider_calendars (id, connection_id, provider_calendar_id, name, color, role, writable, freshness, is_primary, raw_json, created_at, updated_at)
    VALUES (?, ?, 'owner@example.com', 'Calendar', '#6758e8', 'owner', 1, 'live', 1, '{}', ?, ?)`, calendar, connectionId, at(0), at(0));
});

describe("CRM delivery queue", () => {
  it("queues nothing for a workspace that is not connected", async () => {
    const reference = await seedBooking();
    expect(await reconcile()).toBe(0);
    expect(await deliveries(reference)).toEqual([]);
  });

  it("sends a confirmed booking once, with the contract fields", async () => {
    await connect();
    const reference = await seedBooking({ hosts: true });
    expect(await reconcile()).toBe(1);
    expect(await reconcile()).toBe(0);
    const [row] = await deliveries(reference);
    expect(row).toMatchObject({ event_key: "CONFIRMED:v1", state: "queued" });
    expect(JSON.parse(row!.payload_json!)).toEqual({
      sourceId: `external:tap-calendar:${reference}`,
      status: "CONFIRMED",
      version: 1,
      title: "Intro call",
      startsAt: start,
      endsAt: end,
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      guest: { email: "ada@example.com", name: "Ada Guest" },
      additionalGuests: [{ email: "bob@example.com" }],
      hosts: [{ email: "host@example.com", name: "Host Person" }],
      notes: "Bring the roadmap.",
    });
  });

  it("sends an individual page's owner as the host", async () => {
    await connect();
    const reference = await seedBooking();
    await reconcile();
    const [row] = await deliveries(reference);
    expect(JSON.parse(row!.payload_json!).hosts).toEqual([{ email: "organizer@example.com" }]);
  });

  it("does not backfill bookings that last changed before the workspace connected", async () => {
    const reference = await seedBooking({ updatedAt: at(-3_600_000) });
    await connect();
    expect(await reconcile()).toBe(0);
    await setBooking(reference, { version: 2, updated_at: at(500) });
    expect(await reconcile()).toBe(1);
    expect((await deliveries(reference)).map(row => row.event_key)).toEqual(["CONFIRMED:v2"]);
  });

  it("never sends a pending booking, and sends it once approved", async () => {
    await connect();
    const reference = await seedBooking({ bookingStatus: "pending" });
    expect(await reconcile()).toBe(0);
    await setBooking(reference, { booking_status: "confirmed", version: 2 });
    expect(await reconcile()).toBe(1);
  });

  it("sends a reschedule as the new version and a cancellation as CANCELLED", async () => {
    await connect();
    const reference = await seedBooking();
    await reconcile();
    await setBooking(reference, { version: 2, start_at: "2026-10-02T14:00:00.000Z", end_at: "2026-10-02T14:30:00.000Z" });
    await reconcile();
    await setBooking(reference, { version: 3, status: "cancelled", booking_status: "cancelled" });
    await reconcile();
    expect((await deliveries(reference)).map(row => row.event_key))
      .toEqual(["CONFIRMED:v1", "CONFIRMED:v2", "CANCELLED:v3"]);
  });

  it("sends a cancellation of a booking the CRM never received as a new message", async () => {
    await connect();
    const reference = await seedBooking({ bookingStatus: "cancelled", version: 2 });
    expect(await reconcile()).toBe(1);
    expect((await deliveries(reference)).map(row => row.event_key)).toEqual(["CANCELLED:v2"]);
  });

  it("sends a decline or expiry only for a booking the CRM was told about", async () => {
    await connect();
    const declinedUnsent = await seedBooking({ bookingStatus: "declined", status: "active", version: 2 });
    expect(await reconcile()).toBe(0);
    expect(await deliveries(declinedUnsent)).toEqual([]);

    const sent = await seedBooking({ version: 1 });
    await reconcile();
    await setBooking(sent, { booking_status: "expired", version: 2 });
    expect(await reconcile()).toBe(1);
    expect((await deliveries(sent)).map(row => row.event_key)).toEqual(["CONFIRMED:v1", "CANCELLED:v2"]);
  });
});

describe("delivering from the queue", () => {
  const dependencies = (fetchImpl: (input: string, init?: RequestInit) => Response | Promise<Response>, now = Date.now()) => ({
    database: db,
    apiUrl: connection.apiUrl,
    fetch: fetchImpl as unknown as typeof fetch,
    decryptKey: async () => connection.botKey,
    now: () => now,
    random: () => 0.5,
    id: ids,
    log: vi.fn(),
  });

  it("marks a delivery done on 2xx and drops the guest snapshot", async () => {
    await connect();
    const reference = await seedBooking();
    await reconcile();
    const summary = await deliverCrmBookings(dependencies(() => respond(201, {}, { "x-request-id": "r1" })), 10);
    expect(summary).toMatchObject({ claimed: 1, delivered: 1 });
    expect(await deliveries(reference)).toEqual([expect.objectContaining({ state: "delivered", payload_json: null })]);
    expect((await readCrmConnection(db, workspace))?.last_delivered_at).not.toBeNull();
  });

  it("retries 5xx later, honouring Retry-After", async () => {
    await connect();
    const reference = await seedBooking();
    await reconcile();
    const now = Date.now();
    const summary = await deliverCrmBookings(
      dependencies(() => respond(503, {}, { "retry-after": "600" }), now), 10);
    expect(summary).toMatchObject({ claimed: 1, retried: 1 });
    const [row] = await deliveries(reference);
    expect(row).toMatchObject({ state: "queued", attempt_count: 1, last_error_code: "CRM_HTTP_503" });
    const next = await db.prepare("SELECT next_attempt_at FROM crm_booking_deliveries WHERE booking_reference = ?")
      .bind(reference).first<string>("next_attempt_at");
    expect(Date.parse(next!)).toBeGreaterThanOrEqual(now + 600_000);
    // Not due yet, so a second run sends nothing.
    expect((await deliverCrmBookings(dependencies(() => respond(201), now + 1_000), 10)).claimed).toBe(0);
  });

  it("stops on 400 and 409 and logs the request id, never the body", async () => {
    await connect();
    const reference = await seedBooking();
    await reconcile();
    const deps = dependencies(() => respond(409, { requestId: "req-409", detail: "ada@example.com" }));
    const summary = await deliverCrmBookings(deps, 10);
    expect(summary).toMatchObject({ stopped: 1 });
    expect(await deliveries(reference)).toEqual([
      expect.objectContaining({ state: "dead", payload_json: null, last_error_code: "CRM_HTTP_409" }),
    ]);
    const logged = JSON.stringify(deps.log.mock.calls);
    expect(logged).toContain("req-409");
    expect(logged).not.toContain("ada@example.com");
  });

  it("marks the connection broken on 401 and 403 and keeps the message for a reconnect", async () => {
    await connect();
    const reference = await seedBooking();
    await reconcile();
    const summary = await deliverCrmBookings(dependencies(() => respond(403)), 10);
    expect(summary).toMatchObject({ paused: 1, delivered: 0 });
    expect(await readCrmConnection(db, workspace)).toMatchObject({ status: "attention", status_reason: "missing_scope" });
    expect(await deliveries(reference)).toEqual([expect.objectContaining({ state: "queued", attempt_count: 0 })]);
    // Broken connection: nothing more is claimed.
    expect((await deliverCrmBookings(dependencies(() => respond(201)), 10)).claimed).toBe(0);
    // Reconnecting with a working key resumes it.
    await connect();
    expect(await deliverCrmBookings(dependencies(() => respond(201)), 10)).toMatchObject({ delivered: 1 });
  });

  it("gives up after the attempt budget", async () => {
    await connect();
    const reference = await seedBooking();
    await reconcile();
    let now = Date.now();
    for (let attempt = 0; attempt < 12; attempt += 1) {
      now += 2 * 60 * 60_000;
      await deliverCrmBookings(dependencies(() => respond(500), now), 10);
    }
    expect(await deliveries(reference)).toEqual([
      expect.objectContaining({ state: "dead", last_error_code: "CRM_ATTEMPTS_EXHAUSTED" }),
    ]);
  });
});

type GatewayEnv = Parameters<ReturnType<typeof createCalendarGatewayWorker>["fetch"]>[1];

describe("CRM connection routes", () => {
  const enabledEnv = {
    ...env,
    CRM_API_URL: "https://crm.test",
    TOKEN_ENCRYPTION_KEY: btoa("0123456789abcdef0123456789abcdef"),
  };
  const call = (method: string, path: string, body?: unknown, fetchImpl: typeof fetch = fetch, target: GatewayEnv = enabledEnv) =>
    createCalendarGatewayWorker(fetchImpl).fetch(new Request(`https://calendar.test${path}`, {
      method,
      headers: {
        Origin: "http://localhost:3000",
        "X-TAP-Workspace-Id": workspace,
        "X-TAP-Principal-Id": principal,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), target);
  const key = "bot-key-secret-1234";

  it("reports delivery off when the environment has no CRM_API_URL", async () => {
    const response = await call("GET", "/v1/crm/connection", undefined, fetch, env);
    expect(await response.json()).toMatchObject({ enabled: false, defaultApiUrl: null, connection: null });
    const connect = await call("POST", "/v1/crm/connection", { botKey: key }, fetch, env);
    expect(connect.status).toBe(409);
  });

  it("tests, connects, encrypts the key, and disconnects", async () => {
    const seen: RequestInit[] = [];
    const crm = (async (_url: string, init: RequestInit) => { seen.push(init); return respond(200); }) as unknown as typeof fetch;
    const tested = await call("POST", "/v1/crm/connection/test", { botKey: key }, crm);
    expect(await tested.json()).toEqual({ ok: true, reason: null });
    expect(await readCrmConnection(db, workspace)).toBeNull();

    const connected = await call("POST", "/v1/crm/connection", { botKey: key }, crm);
    const body = await connected.json<{ ok: boolean; connection: { apiUrl: string; status: string } }>();
    expect(body).toMatchObject({ ok: true, connection: { apiUrl: "https://crm.test", status: "connected" } });
    expect(JSON.stringify(body)).not.toContain(key);
    const stored = await readCrmConnection(db, workspace);
    expect(stored?.key_ciphertext).toMatch(/^v1\./u);
    expect(stored?.key_ciphertext).not.toContain(key);
    expect(seen.every(init => (init.headers as Record<string, string>).authorization === `Bearer ${key}`)).toBe(true);

    const view = await (await call("GET", "/v1/crm/connection")).json();
    expect(view).toMatchObject({ enabled: true, canManage: true, connection: { status: "connected", pendingDeliveries: 0 } });
    expect(JSON.stringify(view)).not.toContain(key);

    // Re-testing the stored key uses it without being sent again.
    expect(await (await call("POST", "/v1/crm/connection/test", {}, crm)).json()).toEqual({ ok: true, reason: null });
    expect((seen.at(-1)!.headers as Record<string, string>).authorization).toBe(`Bearer ${key}`);

    expect(await (await call("DELETE", "/v1/crm/connection")).json()).toEqual({ disconnected: true });
    expect(await readCrmConnection(db, workspace)).toBeNull();
  });

  it("does not store a key that failed its test and says why", async () => {
    const crm = (async () => respond(401)) as unknown as typeof fetch;
    const response = await call("POST", "/v1/crm/connection", { botKey: key }, crm);
    expect(await response.json()).toEqual({ ok: false, reason: "invalid_key", connection: null });
    expect(await readCrmConnection(db, workspace)).toBeNull();
  });

  it("flags a stored key that is later rejected", async () => {
    await call("POST", "/v1/crm/connection", { botKey: key }, (async () => respond(200)) as unknown as typeof fetch);
    const response = await call("POST", "/v1/crm/connection/test", {}, (async () => respond(403)) as unknown as typeof fetch);
    expect(await response.json()).toEqual({ ok: false, reason: "missing_scope" });
    expect(await readCrmConnection(db, workspace)).toMatchObject({ status: "attention", status_reason: "missing_scope" });
  });

  it("always writes to the environment's CRM, whatever address the caller sends", async () => {
    const urls: string[] = [];
    const crm = (async (url: string) => { urls.push(url); return respond(200); }) as unknown as typeof fetch;
    await call("POST", "/v1/crm/connection", { apiUrl: "https://elsewhere.example", botKey: key }, crm);
    expect(urls).toEqual(["https://crm.test/tap/v1/bot/bookings"]);
  });

  it("rejects a malformed key", async () => {
    expect((await call("POST", "/v1/crm/connection", { botKey: "short" })).status).toBe(400);
    expect((await call("POST", "/v1/crm/connection", {})).status).toBe(400);
  });

  it("discards queued deliveries when disconnecting", async () => {
    await call("POST", "/v1/crm/connection", { botKey: key }, (async () => respond(200)) as unknown as typeof fetch);
    const reference = await seedBooking({ updatedAt: at(10_000) });
    await reconcile();
    expect(await deliveries(reference)).toHaveLength(1);
    await call("DELETE", "/v1/crm/connection");
    expect(await deliveries(reference)).toEqual([]);
  });
});
