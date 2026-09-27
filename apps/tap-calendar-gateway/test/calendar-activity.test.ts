import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { readCalendarActivity, syncAvailabilityActivity } from "../src/calendar-activity";
import { createCalendarGatewayWorker } from "../src/index";
import { isCalendarActivityProjection } from "../../tap-calendar/src/activity-contract";

const db = env.CALENDAR_DB;
let owner: { workspace: string; principal: string };
let calendar: string;
const date = () => new Date().toISOString();
const start = "2026-10-01T14:00:00.000Z", end = "2026-10-01T14:30:00.000Z";
const run = (sql: string, ...values: (string | number | null)[]) => db.prepare(sql).bind(...values).run();
const events = () => db.prepare("SELECT activity_id, status_id FROM calendar_activity_events WHERE workspace_id = ? AND principal_id = ? ORDER BY activity_id, status_id")
  .bind(owner.workspace, owner.principal).all<{activity_id: string; status_id: string}>().then(result => result.results);
beforeEach(async () => {
  owner = { workspace: crypto.randomUUID(), principal: crypto.randomUUID() };
  const connection = crypto.randomUUID(); calendar = crypto.randomUUID();
  await run(`INSERT INTO calendar_connections (id, workspace_id, principal_id, provider, mode, label, status, credential_ciphertext, created_at, updated_at)
    VALUES (?, ?, ?, 'google', 'oauth', 'Private owner', 'connected', 'cipher', ?, ?)`, connection, owner.workspace, owner.principal, date(), date());
  await run(`INSERT INTO provider_calendars (id, connection_id, provider_calendar_id, name, color, role, writable, freshness, is_primary, raw_json, created_at, updated_at)
    VALUES (?, ?, 'private@example.com', 'Private calendar', '#6758e8', 'owner', 1, 'live', 1, '{}', ?, ?)`, calendar, connection, date(), date());
});
async function provider(kind = "meeting", key = crypto.randomUUID()) {
  await run(`INSERT INTO provider_booking_commits (workspace_id, principal_id, idempotency_key, request_hash, destination_calendar_id, provider_event_id,
    booking_kind, start_at, end_at, state, created_at, updated_at) VALUES (?, ?, ?, 'hash', ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    owner.workspace, owner.principal, key, calendar, `event-${key}`, kind, start, end, date(), date());
  return key;
}
async function commit(key: string) {
  await run("UPDATE provider_booking_commits SET state = 'committed', updated_at = ? WHERE workspace_id = ? AND principal_id = ? AND idempotency_key = ?",
    date(), owner.workspace, owner.principal, key);
}
async function guest(key: string) {
  const reference = crypto.randomUUID();
  await run(`INSERT INTO public_booking_attempts (workspace_id, principal_id, idempotency_key, request_hash, provider_operation_id, booking_reference,
    revision_id, start_at, end_at, guest_name, guest_email, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'revision-activity', ?, ?, 'Private guest', 'private@example.com', ?, ?)`,
    owner.workspace, owner.principal, crypto.randomUUID(), 'hash-0123456789012345', key, reference, start, end, date(), date());
  return reference;
}
async function received(reference: string, status: string) {
  await run("UPDATE public_booking_attempts SET state = 'committed', response_json = ?, updated_at = ? WHERE booking_reference = ?", JSON.stringify({ status }), date(), reference);
}
async function decision(key: string, outcome: "approve" | "decline") {
  await run(`INSERT INTO provider_booking_resolutions (workspace_id, principal_id, booking_idempotency_key, resolution_idempotency_key, request_hash, decision, state, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'hash', ?, 'pending', ?, ?)`, owner.workspace, owner.principal, key, crypto.randomUUID(), outcome, date(), date());
  await run("UPDATE provider_booking_resolutions SET state = 'committed', updated_at = ? WHERE workspace_id = ? AND principal_id = ? AND booking_idempotency_key = ?", date(), owner.workspace, owner.principal, key);
}
async function credential(reference: string, key: string) {
  await run(`INSERT INTO public_booking_management_credentials (booking_reference, workspace_id, principal_id, token_hash, page_id, revision_id, provider_booking_id,
    provider_operation_id, start_at, end_at, guest_name, guest_email, created_at, updated_at) VALUES (?, ?, ?, ?, 'page-activity', 'revision-activity', ?, ?, ?, ?, 'Private guest', 'private@example.com', ?, ?)`,
    reference, owner.workspace, owner.principal, crypto.randomUUID(), `event-${key}`, key, start, end, date(), date());
}
async function management(reference: string, kind: "cancel" | "reschedule", changed = true, state = "committed") {
  const operation = crypto.randomUUID();
  const toStart = changed ? "2026-10-02T14:00:00.000Z" : start;
  const toEnd = changed ? "2026-10-02T14:30:00.000Z" : end;
  await run(`INSERT INTO public_booking_management_mutations (booking_reference, request_id, request_hash, operation_id, kind, expected_version, page_revision_id,
    from_start_at, from_end_at, to_start_at, to_end_at, conflict_calendar_ids_json, conflict_start_at, conflict_end_at, state, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`, reference, crypto.randomUUID(), 'hash-0123456789012345', operation, kind,
    kind === "cancel" ? null : "revision-activity", start, end, kind === "cancel" ? null : toStart, kind === "cancel" ? null : toEnd,
    kind === "cancel" ? null : "[]", kind === "cancel" ? null : toStart, kind === "cancel" ? null : toEnd, date(), date());
  await run("UPDATE public_booking_management_mutations SET state = ?, updated_at = ? WHERE operation_id = ?", state, date(), operation);
  return operation;
}

describe("durable Calendar activity", () => {
  it("records provider-confirmed meetings and work blocks once, excluding pending, rejected and rolled-back writes", async () => {
    const meeting = await provider(); const block = await provider("work-block");
    await provider("approval-hold");
    const rejected = await provider();
    await run("UPDATE provider_booking_commits SET state = 'rejected' WHERE idempotency_key = ?", rejected);
    expect(await events()).toEqual([]);
    await commit(meeting); await commit(meeting); await commit(block);
    const rolledBack = await provider();
    await expect(db.batch([
      db.prepare("UPDATE provider_booking_commits SET state = 'committed' WHERE idempotency_key = ?").bind(rolledBack),
      db.prepare("INSERT INTO calendar_activity_coverage VALUES (1, 'duplicate')"),
    ])).rejects.toThrow();
    expect(await events()).toEqual([{ activity_id: "meeting-scheduled", status_id: "confirmed" }, { activity_id: "work-block-created", status_id: "confirmed" }]);
  });
  it("separates guest confirmation and approval outcomes without counting a guest booking twice as a scheduled meeting", async () => {
    const confirmed = await provider(); const reference = await guest(confirmed);
    await commit(confirmed); await received(reference, "confirmed"); await received(reference, "confirmed");
    for (const outcome of ["approve", "decline"] as const) {
      const hold = await provider("approval-hold"); const pending = await guest(hold);
      await commit(hold); await received(pending, "pending"); await decision(hold, outcome);
      await run("UPDATE provider_booking_resolutions SET state = 'committed' WHERE booking_idempotency_key = ?", hold);
    }
    expect(await events()).toEqual([
      { activity_id: "booking-decision", status_id: "approved" }, { activity_id: "booking-decision", status_id: "declined" },
      { activity_id: "booking-received", status_id: "confirmed" }, { activity_id: "booking-received", status_id: "pending" }, { activity_id: "booking-received", status_id: "pending" },
    ]);
    const hold = await provider("approval-hold"); await commit(hold); await decision(hold, "approve");
    expect((await events()).filter(event => event.activity_id === "meeting-scheduled")).toHaveLength(1);
  });
  it("records committed rescheduling and cancellation while excluding rejected changes, unchanged times, and replay", async () => {
    const key = await provider(); const reference = await guest(key); await credential(reference, key);
    await management(reference, "reschedule", true, "rejected");
    await management(reference, "reschedule", false);
    const operation = await management(reference, "reschedule");
    await run("UPDATE public_booking_management_mutations SET state = 'committed' WHERE operation_id = ?", operation);
    await management(reference, "cancel");
    expect(await events()).toEqual([{ activity_id: "meeting-cancelled", status_id: "completed" }, { activity_id: "meeting-rescheduled", status_id: "completed" }]);
  });
  it("records shared host policy changes and excludes display-name or version-only changes", async () => {
    const policy = { version: 1, displayName: "Owner", schedule: { minimumNoticeMinutes: 120 } };
    await run("INSERT INTO calendar_booking_hosts VALUES (?, ?, 1, 1, ?, ?)", owner.workspace, owner.principal, JSON.stringify(policy), date());
    await run("UPDATE calendar_booking_hosts SET version = 2, policy_json = ? WHERE workspace_id = ?", JSON.stringify({ ...policy, version: 2, displayName: "Renamed" }), owner.workspace);
    expect(await events()).toHaveLength(1);
    await run("UPDATE calendar_booking_hosts SET version = 3, policy_json = ? WHERE workspace_id = ?", JSON.stringify({ ...policy, version: 3, schedule: { minimumNoticeMinutes: 60 } }), owner.workspace);
    expect(await events()).toHaveLength(2);
  });
  it("deduplicates availability receipts, enforces owner isolation and rejects arbitrary activity payloads", async () => {
    const input = { entries: [{ id: crypto.randomUUID(), occurredAt: date() }] };
    await syncAvailabilityActivity(db, owner, input); await syncAvailabilityActivity(db, owner, input);
    const peer = { ...owner, principal: "peer" };
    await syncAvailabilityActivity(db, peer, input);
    expect(await events()).toEqual([{ activity_id: "availability-updated", status_id: "saved" }]);
    await expect(syncAvailabilityActivity(db, owner, { entries: [{ ...input.entries[0], activityId: "meeting-scheduled" }] })).rejects.toThrow();
    await expect(syncAvailabilityActivity(db, owner, { entries: [{ id: "bad", occurredAt: date() }] })).rejects.toThrow();
    const projection = await readCalendarActivity(db, owner);
    expect(isCalendarActivityProjection(projection)).toBe(true);
    expect(projection.entries).toHaveLength(1);
    expect(Object.keys(projection.entries[0]!)).toEqual(["activityId", "statusId", "occurredAt"]);
    expect((await readCalendarActivity(db, { ...owner, workspace: "other" })).entries).toEqual([]);
    expect(projection.availableFrom > "2026-09-01T00:00:00.000Z").toBe(true);
  });
  it("bounds returned history and marks the truncated boundary millisecond incomplete", async () => {
    const old = new Date(Date.now() - 120 * 86_400_000).toISOString();
    const boundary = new Date(Date.now() - 1000).toISOString();
    await db.batch(Array.from({ length: 2049 }, (_, index) => db.prepare("INSERT INTO calendar_activity_events VALUES (?, ?, ?, 'availability-updated', 'saved', ?)")
      .bind(owner.workspace, owner.principal, `receipt-${index}`, boundary)));
    await run("INSERT INTO calendar_activity_events VALUES (?, ?, 'old', 'availability-updated', 'saved', ?)", owner.workspace, owner.principal, old);
    const projection = await readCalendarActivity(db, owner);
    expect(projection.entries).toHaveLength(2048);
    expect(projection.availableFrom > boundary).toBe(true);
    expect(projection.entries.some(entry => entry.occurredAt === old)).toBe(false);
  });
  it("requires authenticated ownership for projection reads and receipt writes", async () => {
    const worker = createCalendarGatewayWorker();
    for (const [path, method] of [["/v1/activity", "GET"], ["/v1/activity/availability", "POST"]] as const) {
      const response = await worker.fetch(new Request(`https://calendar-api.theaiplatform.app${path}`, { method,
        headers: { "Content-Type": "application/json" }, ...(method === "POST" ? { body: '{"entries":[]}' } : {}) }), { ...env, LOCAL_DEVELOPMENT: "false" });
      expect([401, 403]).toContain(response.status);
    }
    const response = await worker.fetch(new Request("https://calendar-api.theaiplatform.app/v1/activity", {
      headers: { "X-TAP-Principal-Id": owner.principal, "X-TAP-Workspace-Id": owner.workspace },
    }), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ userId: owner.principal, workspaceId: owner.workspace, entries: [] });
  });
});
