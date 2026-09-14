import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { PublicBookingManagementTokenIssuer } from "../src/public-booking-create";
import {
  projectPublicBookingManagement,
  type PublicBookingManagementRecord,
} from "../src/public-booking-management";
import { D1PublicBookingManagementStore } from "../src/public-booking-management-store";
import {
  D1PublicBookingAttemptStore,
  D1PublicBookingManagementTokenIssuer,
  publicBookingManagementTokenHash,
} from "../src/public-booking-store";

const now = Date.parse("2026-08-16T18:00:00.000Z");
const scope = { workspace: "workspace-management-store", principal: "principal-management-store" };
const originalStart = "2026-08-18T13:00:00.000Z";
const originalEnd = "2026-08-18T13:30:00.000Z";
const newStart = "2026-08-19T15:00:00.000Z";
const newEnd = "2026-08-19T15:30:00.000Z";
const managementSecret = "management-store-secret-at-least-32-bytes";

const issuerInput = (
  bookingReference: string,
): Parameters<PublicBookingManagementTokenIssuer["issue"]>[0] => ({
  scope,
  bookingReference,
  pageId: "page-management-store",
  revisionId: "revision-management-store-1",
  destinationCalendarId: "calendar-management-store",
  providerBookingId: "provider-event-management-store",
  providerOperationId: "tap_provider_management_store_operation",
  startsAt: originalStart,
  endsAt: originalEnd,
  guest: { name: "Guest Person", email: "guest@example.com" },
  approvalExpiresAt: null,
  organizerName: "TAP Organizer",
  eventTitle: "30 Minute Meeting",
  location: "google-meet",
  locationLabel: "Google Meet",
  timeZone: "America/New_York",
});

async function seedCredential(): Promise<{
  readonly token: string;
  readonly booking: PublicBookingManagementRecord;
  readonly store: D1PublicBookingManagementStore;
}> {
  const attempts = new D1PublicBookingAttemptStore(env.CALENDAR_DB, {
    managementSecret,
    managementOrigin: "https://cal.with-tap.ai",
    now: () => now,
    bookingReference: () => "pb_management_store_reference_12345",
  });
  const claimed = await attempts.claim({
    scope,
    idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    requestHash: "provider_commit_proof_management_store",
    slotProofFingerprint: "slot_proof_management_store_123456",
    providerOperationId: "tap_provider_management_store_operation",
    startsAt: originalStart,
    endsAt: originalEnd,
    revisionId: "revision-management-store-1",
    guest: { name: "Guest Person", email: "guest@example.com" },
    approvalExpiresAt: null,
  });
  if (claimed.kind !== "claimed") throw new Error("Expected a booking claim.");
  const issuer = new D1PublicBookingManagementTokenIssuer(env.CALENDAR_DB, {
    secret: managementSecret,
    now: () => now,
  });
  const { token } = await issuer.issue(issuerInput(claimed.attempt.bookingReference));
  const store = new D1PublicBookingManagementStore(env.CALENDAR_DB, { now: () => now });
  const booking = await store.resolve(token);
  if (!booking) throw new Error("Expected the management credential to resolve.");
  return { token, booking, store };
}

beforeEach(async () => {
  await env.CALENDAR_DB.batch([
    env.CALENDAR_DB.prepare("DELETE FROM public_booking_management_mutations"),
    env.CALENDAR_DB.prepare("DELETE FROM public_booking_management_credentials"),
    env.CALENDAR_DB.prepare("DELETE FROM public_booking_slot_proof_uses"),
    env.CALENDAR_DB.prepare("DELETE FROM public_booking_attempts"),
  ]);
});

describe("D1 public booking management store", () => {
  it("resolves only the token hash and gives malformed and unknown bearers the same null result", async () => {
    const { token, booking, store } = await seedCredential();
    expect(booking).toMatchObject({
      bookingReference: "pb_management_store_reference_12345",
      scope,
      version: 1,
      status: "confirmed",
      destinationCalendarId: "calendar-management-store",
      providerCommitProof: "provider_commit_proof_management_store",
      guest: { name: "Guest Person", email: "guest@example.com" },
      organizerName: "TAP Organizer",
      eventTitle: "30 Minute Meeting",
      timeZone: "America/New_York",
    });
    await expect(store.resolve("not-a-token")).resolves.toBeNull();
    await expect(store.resolve(`tapm_v1_${"z".repeat(43)}`)).resolves.toBeNull();
    const row = await env.CALENDAR_DB.prepare(
      "SELECT token_hash FROM public_booking_management_credentials",
    ).first<Record<string, unknown>>();
    expect(row?.token_hash).toBe(await publicBookingManagementTokenHash(token));
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it("claims one open mutation, attaches exact retries, and rejects competing or conflicting requests", async () => {
    const { booking, store } = await seedCredential();
    const input = {
      booking,
      requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      requestHash: "cancel_request_hash_1234567890",
      operationId: "tapmop_cancel_operation_1234567890",
      kind: "cancel" as const,
      expectedVersion: 1,
      pageRevisionId: null,
      toStartsAt: null,
      toEndsAt: null,
      conflictCalendarIds: [] as const,
      conflictStart: null,
      conflictEnd: null,
    };
    const first = await store.claimMutation(input);
    expect(first).toMatchObject({ kind: "claimed", mutation: { state: "pending", kind: "cancel" } });
    await expect(store.claimMutation(input)).resolves.toMatchObject({ kind: "existing" });
    await expect(store.claimMutation({
      ...input,
      requestHash: "different_cancel_request_hash_1234",
    })).resolves.toEqual({ kind: "idempotency-conflict" });
    await expect(store.claimMutation({
      ...input,
      requestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      operationId: "tapmop_other_operation_1234567890",
    })).resolves.toEqual({ kind: "mutation-in-progress" });
    await store.markUncertain({
      bookingReference: booking.bookingReference,
      requestId: input.requestId,
      requestHash: input.requestHash,
      errorCode: "provider_timeout",
    });
    await expect(store.findMutation({
      bookingReference: booking.bookingReference,
      requestId: input.requestId,
    })).resolves.toMatchObject({ state: "uncertain" });
  });

  it("commits cancellation with an expected-version CAS and preserves a terminal replay", async () => {
    const { token, booking, store } = await seedCredential();
    const claimed = await store.claimMutation({
      booking,
      requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      requestHash: "cancel_request_hash_1234567890",
      operationId: "tapmop_cancel_operation_1234567890",
      kind: "cancel",
      expectedVersion: 1,
      pageRevisionId: null,
      toStartsAt: null,
      toEndsAt: null,
      conflictCalendarIds: [],
      conflictStart: null,
      conflictEnd: null,
    });
    if (claimed.kind !== "claimed") throw new Error("Expected the cancellation claim.");
    const response = projectPublicBookingManagement({
      ...booking,
      version: 2,
      status: "cancelled",
      cancelledAt: "2026-08-16T18:00:00.000Z",
    });
    const cancelled = await store.commitCancellation({ booking, mutation: claimed.mutation, response });
    expect(cancelled).toMatchObject({ version: 2, status: "cancelled", cancelledAt: "2026-08-16T18:00:00.000Z" });
    await expect(store.resolve(token)).resolves.toEqual(cancelled);
    await expect(store.findMutation({
      bookingReference: booking.bookingReference,
      requestId: claimed.mutation.requestId,
    })).resolves.toMatchObject({ state: "committed", response });
    await expect(store.claimMutation({
      booking: cancelled,
      requestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      requestHash: "another_cancel_hash_12345678901",
      operationId: "tapmop_another_cancel_12345678901",
      kind: "cancel",
      expectedVersion: 1,
      pageRevisionId: null,
      toStartsAt: null,
      toEndsAt: null,
      conflictCalendarIds: [],
      conflictStart: null,
      conflictEnd: null,
    })).rejects.toMatchObject({ code: "invalid_store_input" });
  });

  it("moves a confirmed booking while retaining destination/provider ownership", async () => {
    const { token, booking, store } = await seedCredential();
    const claimed = await store.claimMutation({
      booking,
      requestId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      requestHash: "reschedule_request_hash_123456789",
      operationId: "tapmop_reschedule_operation_123456",
      kind: "reschedule",
      expectedVersion: 1,
      pageRevisionId: "revision-management-store-2",
      toStartsAt: newStart,
      toEndsAt: newEnd,
      conflictCalendarIds: ["calendar-management-store", "calendar-conflict-store"],
      conflictStart: "2026-08-19T14:45:00.000Z",
      conflictEnd: "2026-08-19T15:45:00.000Z",
    });
    if (claimed.kind !== "claimed") throw new Error("Expected the reschedule claim.");
    const response = projectPublicBookingManagement({
      ...booking,
      version: 2,
      revisionId: "revision-management-store-2",
      startsAt: newStart,
      endsAt: newEnd,
    });
    const rescheduled = await store.commitReschedule({
      booking,
      mutation: claimed.mutation,
      currentPageRevisionId: "revision-management-store-2",
      response,
    });
    expect(rescheduled).toMatchObject({
      version: 2,
      status: "confirmed",
      revisionId: "revision-management-store-2",
      startsAt: newStart,
      endsAt: newEnd,
      destinationCalendarId: booking.destinationCalendarId,
      providerBookingId: booking.providerBookingId,
      providerOperationId: booking.providerOperationId,
    });
    await expect(store.resolve(token)).resolves.toEqual(rescheduled);
  });

  it("persists a terminal provider rejection without changing the booking version", async () => {
    const { booking, store } = await seedCredential();
    const claimed = await store.claimMutation({
      booking,
      requestId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      requestHash: "rejected_reschedule_hash_1234567",
      operationId: "tapmop_rejected_reschedule_123456",
      kind: "reschedule",
      expectedVersion: 1,
      pageRevisionId: "revision-management-store-2",
      toStartsAt: newStart,
      toEndsAt: newEnd,
      conflictCalendarIds: ["calendar-management-store"],
      conflictStart: newStart,
      conflictEnd: newEnd,
    });
    if (claimed.kind !== "claimed") throw new Error("Expected claim.");
    await store.markRejected({
      bookingReference: booking.bookingReference,
      requestId: claimed.mutation.requestId,
      requestHash: claimed.mutation.requestHash,
      rejectionCode: "slot_conflict",
    });
    await expect(store.findMutation({
      bookingReference: booking.bookingReference,
      requestId: claimed.mutation.requestId,
    })).resolves.toMatchObject({ state: "rejected", rejectionCode: "slot_conflict" });
    const version = await env.CALENDAR_DB.prepare(
      "SELECT version FROM public_booking_management_credentials WHERE booking_reference = ?",
    ).bind(booking.bookingReference).first<number>("version");
    expect(version).toBe(1);
  });
});
