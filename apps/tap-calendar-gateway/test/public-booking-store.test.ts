import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type {
  PublicBookingAttemptClaim,
  PublicBookingManagementTokenIssuer,
  PublicBookingResult,
} from "../src/public-booking-create";
import {
  D1PublicBookingAttemptStore,
  D1PublicBookingManagementTokenIssuer,
  D1PublicBookingSerializationBoundary,
  publicBookingManagementTokenHash,
} from "../src/public-booking-store";

const now = Date.parse("2026-08-16T18:00:00.000Z");
const scope = { workspace: "workspace-store-test", principal: "principal-store-test" };
const startsAt = "2026-08-17T13:00:00.000Z";
const endsAt = "2026-08-17T13:30:00.000Z";
const approvalExpiresAt = "2026-08-17T18:00:00.000Z";
const managementSecret = "management-secret-for-tests-32-bytes-minimum";

const claimFixture = (
  overrides: Partial<PublicBookingAttemptClaim> = {},
): PublicBookingAttemptClaim => ({
  scope,
  idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  requestHash: "request_hash_1234567890abcdef",
  slotProofFingerprint: "slot_proof_hash_1234567890abcdef",
  providerOperationId: "tap_provider_operation_1234567890",
  startsAt,
  endsAt,
  revisionId: "revision-store-123",
  guest: { name: "Guest Person", email: "guest@example.com" },
  approvalExpiresAt: null,
  ...overrides,
});

const responseFixture = (bookingReference: string, token: string): PublicBookingResult => ({
  schemaVersion: "tap.calendar.public-booking.v1",
  status: "confirmed",
  bookingReference,
  startsAt,
  endsAt,
  managementUrl: `https://cal.with-tap.ai/manage#${token}`,
});

const referenceFactory = (suffix: string): (() => string) =>
  () => `pb_${suffix.padEnd(32, "x")}`;

const store = (suffix = "attempt"): D1PublicBookingAttemptStore =>
  new D1PublicBookingAttemptStore(env.CALENDAR_DB, {
    managementSecret,
    managementOrigin: "https://cal.with-tap.ai",
    now: () => now,
    bookingReference: referenceFactory(suffix),
  });

const managementInput = (
  bookingReference: string,
  overrides: Partial<Parameters<PublicBookingManagementTokenIssuer["issue"]>[0]> = {},
): Parameters<PublicBookingManagementTokenIssuer["issue"]>[0] => ({
  scope,
  bookingReference,
  pageId: "page-store-123",
  revisionId: "revision-store-123",
  destinationCalendarId: "calendar-store-123",
  providerBookingId: "provider-booking-store-123",
  providerOperationId: "tap_provider_operation_1234567890",
  startsAt,
  endsAt,
  guest: { name: "Guest Person", email: "guest@example.com" },
  approvalExpiresAt: null,
  organizerName: "TAP Organizer",
  eventTitle: "30 Minute Meeting",
  location: "google-meet",
  locationLabel: "Google Meet",
  timeZone: "America/New_York",
  ...overrides,
});

beforeEach(async () => {
  await env.CALENDAR_DB.batch([
    env.CALENDAR_DB.prepare("DELETE FROM public_booking_management_credentials"),
    env.CALENDAR_DB.prepare("DELETE FROM public_booking_slot_proof_uses"),
    env.CALENDAR_DB.prepare("DELETE FROM public_booking_attempts"),
    env.CALENDAR_DB.prepare("DELETE FROM public_booking_owner_leases"),
  ]);
});

describe("D1 public booking attempt store", () => {
  it("claims once, captures guest policy, and attaches fresh proofs to an identical retry", async () => {
    const attempts = store();
    const claim = claimFixture({ approvalExpiresAt });
    const first = await attempts.claim(claim);
    expect(first).toMatchObject({
      kind: "claimed",
      attempt: {
        requestHash: claim.requestHash,
        providerOperationId: claim.providerOperationId,
        guest: claim.guest,
        approvalExpiresAt,
        state: "pending",
        response: null,
      },
    });
    if (first.kind !== "claimed") throw new Error("Expected the initial claim to succeed.");
    expect(first.attempt.bookingReference).toMatch(/^pb_[A-Za-z0-9_-]{32}$/u);

    const exactReplay = await attempts.claim(claim);
    expect(exactReplay).toEqual({ kind: "existing", attempt: first.attempt });
    const freshProofReplay = await attempts.claim({
      ...claim,
      slotProofFingerprint: "slot_proof_hash_fresh_1234567890",
      // An existing attempt returns its original stable approval expiry.
      approvalExpiresAt: "2026-08-17T19:00:00.000Z",
    });
    expect(freshProofReplay).toEqual({ kind: "existing", attempt: first.attempt });
    expect(await env.CALENDAR_DB.prepare(
      "SELECT COUNT(*) AS count FROM public_booking_attempts",
    ).first<number>("count")).toBe(1);
    expect(await env.CALENDAR_DB.prepare(
      "SELECT COUNT(*) AS count FROM public_booking_slot_proof_uses",
    ).first<number>("count")).toBe(2);
  });

  it("distinguishes request-ID conflicts and proof replays without orphan attempts", async () => {
    const attempts = store();
    const original = claimFixture();
    expect((await attempts.claim(original)).kind).toBe("claimed");
    expect(await attempts.claim({
      ...original,
      requestHash: "different_request_hash_1234567890",
      slotProofFingerprint: "different_slot_proof_hash_123456",
    })).toEqual({ kind: "idempotency-conflict" });
    expect(await attempts.claim({
      ...original,
      idempotencyKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      providerOperationId: "tap_provider_operation_abcdefghij",
    })).toEqual({ kind: "slot-proof-replayed" });
    expect(await env.CALENDAR_DB.prepare(
      "SELECT COUNT(*) AS count FROM public_booking_attempts",
    ).first<number>("count")).toBe(1);
    expect(await env.CALENDAR_DB.prepare(
      "SELECT COUNT(*) AS count FROM public_booking_slot_proof_uses",
    ).first<number>("count")).toBe(1);
  });

  it("serializes competing D1 batches so one proof can create only one attempt", async () => {
    const firstStore = store("first");
    const secondStore = store("second");
    const contenders = await Promise.all([
      firstStore.claim(claimFixture()),
      secondStore.claim(claimFixture({
        idempotencyKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        providerOperationId: "tap_provider_operation_abcdefghij",
      })),
    ]);
    expect(contenders.map(result => result.kind).sort()).toEqual([
      "claimed",
      "slot-proof-replayed",
    ]);
    expect(await env.CALENDAR_DB.prepare(
      "SELECT COUNT(*) AS count FROM public_booking_attempts",
    ).first<number>("count")).toBe(1);
  });

  it("uses compare-and-set terminal transitions and replays an identical commit", async () => {
    const attempts = store();
    const claimed = await attempts.claim(claimFixture());
    if (claimed.kind !== "claimed") throw new Error("Expected claim.");
    await attempts.markUncertain({
      scope,
      idempotencyKey: claimed.attempt.idempotencyKey,
      requestHash: claimed.attempt.requestHash,
      errorCode: "provider_response_ambiguous",
    });
    expect((await attempts.claim(claimFixture()))).toMatchObject({
      kind: "existing",
      attempt: { state: "uncertain" },
    });
    const issuer = new D1PublicBookingManagementTokenIssuer(env.CALENDAR_DB, {
      secret: managementSecret,
      now: () => now,
    });
    const credential = await issuer.issue(managementInput(claimed.attempt.bookingReference));
    const response = responseFixture(claimed.attempt.bookingReference, credential.token);
    await attempts.markCommitted({
      scope,
      idempotencyKey: claimed.attempt.idempotencyKey,
      requestHash: claimed.attempt.requestHash,
      response,
    });
    await attempts.markCommitted({
      scope,
      idempotencyKey: claimed.attempt.idempotencyKey,
      requestHash: claimed.attempt.requestHash,
      response,
    });
    expect((await attempts.claim(claimFixture()))).toMatchObject({
      kind: "existing",
      attempt: { state: "committed", response },
    });
    const responseJson = await env.CALENDAR_DB.prepare(
      "SELECT response_json FROM public_booking_attempts WHERE booking_reference = ?",
    ).bind(claimed.attempt.bookingReference).first<string>("response_json");
    expect(responseJson).not.toContain(credential.token);
    expect(JSON.parse(responseJson!)).not.toHaveProperty("managementUrl");
    await expect(attempts.markUncertain({
      scope,
      idempotencyKey: claimed.attempt.idempotencyKey,
      requestHash: claimed.attempt.requestHash,
      errorCode: "must_not_replace_commit",
    })).rejects.toMatchObject({ code: "booking_attempt_cas_failed" });
  });

  it("never commits a rejected claim or a mutation using the wrong request hash", async () => {
    const attempts = store();
    const claimed = await attempts.claim(claimFixture());
    if (claimed.kind !== "claimed") throw new Error("Expected claim.");
    const issuer = new D1PublicBookingManagementTokenIssuer(env.CALENDAR_DB, {
      secret: managementSecret,
      now: () => now,
    });
    const credential = await issuer.issue(managementInput(claimed.attempt.bookingReference));
    await expect(attempts.markRejected({
      scope,
      idempotencyKey: claimed.attempt.idempotencyKey,
      requestHash: "wrong_request_hash_1234567890",
      rejectionCode: "slot_conflict",
    })).rejects.toMatchObject({ code: "booking_attempt_cas_failed" });
    await attempts.markRejected({
      scope,
      idempotencyKey: claimed.attempt.idempotencyKey,
      requestHash: claimed.attempt.requestHash,
      rejectionCode: "slot_conflict",
    });
    await attempts.markRejected({
      scope,
      idempotencyKey: claimed.attempt.idempotencyKey,
      requestHash: claimed.attempt.requestHash,
      rejectionCode: "slot_conflict",
    });
    await expect(attempts.markCommitted({
      scope,
      idempotencyKey: claimed.attempt.idempotencyKey,
      requestHash: claimed.attempt.requestHash,
      response: responseFixture(claimed.attempt.bookingReference, credential.token),
    })).rejects.toMatchObject({ code: "booking_attempt_cas_failed" });
  });
});

describe("D1 public booking management tokens", () => {
  it("is idempotent and persists only the deterministic token hash", async () => {
    const attempts = store();
    const claimed = await attempts.claim(claimFixture({ approvalExpiresAt }));
    if (claimed.kind !== "claimed") throw new Error("Expected claim.");
    const issuer = new D1PublicBookingManagementTokenIssuer(env.CALENDAR_DB, {
      secret: managementSecret,
      now: () => now,
    });
    const input = managementInput(claimed.attempt.bookingReference, { approvalExpiresAt });
    const first = await issuer.issue(input);
    const replay = await issuer.issue(input);
    expect(replay).toEqual(first);
    expect(first.token).toMatch(/^tapm_v1_[A-Za-z0-9_-]{43}$/u);

    const row = await env.CALENDAR_DB.prepare(
      "SELECT * FROM public_booking_management_credentials WHERE booking_reference = ?",
    ).bind(claimed.attempt.bookingReference).first<Record<string, unknown>>();
    expect(row).toMatchObject({
      token_hash: await publicBookingManagementTokenHash(first.token),
      guest_name: "Guest Person",
      guest_email: "guest@example.com",
      approval_expires_at: approvalExpiresAt,
      status: "active",
    });
    expect(JSON.stringify(row)).not.toContain(first.token);
  });

  it("rejects a metadata or signing-secret conflict instead of rotating a link", async () => {
    const attempts = store();
    const claimed = await attempts.claim(claimFixture());
    if (claimed.kind !== "claimed") throw new Error("Expected claim.");
    const input = managementInput(claimed.attempt.bookingReference);
    const issuer = new D1PublicBookingManagementTokenIssuer(env.CALENDAR_DB, {
      secret: managementSecret,
      now: () => now,
    });
    await issuer.issue(input);
    await expect(issuer.issue({
      ...input,
      providerBookingId: "different-provider-booking",
    })).rejects.toMatchObject({ code: "management_credential_conflict" });
    const otherIssuer = new D1PublicBookingManagementTokenIssuer(env.CALENDAR_DB, {
      secret: "a-different-management-secret-at-least-32-bytes",
      now: () => now,
    });
    await expect(otherIssuer.issue(input)).rejects.toMatchObject({
      code: "management_credential_conflict",
    });
    expect(await env.CALENDAR_DB.prepare(
      "SELECT COUNT(*) AS count FROM public_booking_management_credentials",
    ).first<number>("count")).toBe(1);
  });
});

describe("D1 public booking owner lease", () => {
  it("excludes overlapping callbacks for one owner and releases for the waiter", async () => {
    const boundary = new D1PublicBookingSerializationBoundary(env.CALENDAR_DB, {
      leaseMilliseconds: 1_000,
      renewalMilliseconds: 200,
      acquisitionTimeoutMilliseconds: 1_000,
      retryMilliseconds: 10,
    });
    let releaseFirst: (() => void) | undefined;
    let signalEntered: (() => void) | undefined;
    const entered = new Promise<void>(resolve => {
      signalEntered = resolve;
    });
    const gate = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });
    const order: string[] = [];
    const first = boundary.runExclusive("owner_coordination_key_123456", async () => {
      order.push("first:start");
      signalEntered?.();
      await gate;
      order.push("first:end");
      return "first";
    });
    await entered;
    const second = boundary.runExclusive("owner_coordination_key_123456", async () => {
      order.push("second:start");
      return "second";
    });
    await new Promise(resolve => setTimeout(resolve, 40));
    expect(order).toEqual(["first:start"]);
    releaseFirst?.();
    await expect(Promise.all([first, second])).resolves.toEqual(["first", "second"]);
    expect(order).toEqual(["first:start", "first:end", "second:start"]);
  });

  it("takes over an expired lease but not a live one", async () => {
    await env.CALENDAR_DB.prepare(
      `INSERT INTO public_booking_owner_leases (
         coordination_key, lease_token, lease_until, updated_at
       ) VALUES (?, ?, ?, ?)`,
    ).bind(
      "expired_coordination_key_123",
      crypto.randomUUID(),
      "2026-08-15T18:00:00.000Z",
      "2026-08-15T17:59:00.000Z",
    ).run();
    const boundary = new D1PublicBookingSerializationBoundary(env.CALENDAR_DB, {
      now: () => now,
      leaseMilliseconds: 1_000,
      renewalMilliseconds: 200,
      acquisitionTimeoutMilliseconds: 0,
      retryMilliseconds: 10,
    });
    await expect(boundary.runExclusive(
      "expired_coordination_key_123",
      async () => "taken-over",
    )).resolves.toBe("taken-over");

    await env.CALENDAR_DB.prepare(
      `INSERT INTO public_booking_owner_leases (
         coordination_key, lease_token, lease_until, updated_at
       ) VALUES (?, ?, ?, ?)`,
    ).bind(
      "active_coordination_key_1234",
      crypto.randomUUID(),
      "2026-08-17T18:00:00.000Z",
      "2026-08-16T17:59:00.000Z",
    ).run();
    await expect(boundary.runExclusive(
      "active_coordination_key_1234",
      async () => "must-not-run",
    )).rejects.toMatchObject({ code: "owner_lease_unavailable" });
  });
});
