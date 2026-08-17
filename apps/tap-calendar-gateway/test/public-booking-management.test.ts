import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PublicBookingManagementTokenIssuer,
} from "../src/public-booking-create";
import {
  cancelPublicBooking,
  parsePublicBookingCancelRequest,
  parsePublicBookingManagementToken,
  parsePublicBookingRescheduleRequest,
  readPublicBookingManagement,
  reschedulePublicBooking,
  type PublicBookingManagementDependencies,
  type PublicBookingManagementProvider,
} from "../src/public-booking-management";
import { D1PublicBookingManagementStore } from "../src/public-booking-management-store";
import type { ResolvedPublishedPublicBookingPage } from "../src/public-booking-read";
import {
  D1PublicBookingAttemptStore,
  D1PublicBookingManagementTokenIssuer,
} from "../src/public-booking-store";

const now = Date.parse("2026-08-16T18:00:00.000Z");
const scope = { workspace: "workspace-management-core", principal: "principal-management-core" };
const originalStart = "2026-08-18T13:00:00.000Z";
const originalEnd = "2026-08-18T13:30:00.000Z";
const newStart = "2026-08-19T15:00:00.000Z";
const newEnd = "2026-08-19T15:30:00.000Z";
const managementSecret = "management-core-secret-at-least-32-bytes";
const cancelRequest = parsePublicBookingCancelRequest({
  schemaVersion: "tap.calendar.public-management-cancel.v1",
  requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  expectedVersion: 1,
});
const rescheduleRequest = parsePublicBookingRescheduleRequest({
  schemaVersion: "tap.calendar.public-management-reschedule.v1",
  requestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  expectedVersion: 1,
  slotToken: "signed_slot_token_for_management_core",
  turnstileToken: "turnstile_token_for_management_core",
});

const pageFixture = (
  overrides: Partial<ResolvedPublishedPublicBookingPage> = {},
): ResolvedPublishedPublicBookingPage => ({
  profileId: "profile-management-core",
  pageId: "page-management-core",
  revisionId: "revision-management-core-2",
  profileSlug: "tap-organizer",
  eventTypeSlug: "thirty-minutes",
  publishedAt: "2026-08-16T12:00:00.000Z",
  publicSnapshot: {
    schemaVersion: "tap.calendar.public-page-snapshot.v1",
    displayName: "TAP Organizer",
    title: "30 Minute Meeting",
    description: "A focused conversation.",
    durationMinutes: 30,
    location: "google-meet",
    locationLabel: "Google Meet",
    approvalRequired: false,
  },
  privateSnapshot: {
    schemaVersion: "tap.calendar.private-page-snapshot.v1",
    workspaceId: scope.workspace,
    principalId: scope.principal,
    destinationCalendarId: "calendar-management-core",
    conflictCalendarIds: ["calendar-management-core", "calendar-management-conflict"],
    sourceAvailabilityScheduleId: "schedule-management-core",
    location: "google-meet",
    schedule: {
      timeZone: "America/New_York",
      preferredStart: "09:00",
      preferredEnd: "17:00",
      bufferBeforeMinutes: 15,
      bufferAfterMinutes: 15,
      minimumNoticeMinutes: 0,
      bookingHorizonDays: 60,
      windows: [{ day: 3, enabled: true, start: "09:00", end: "17:00" }],
      overrides: [],
    },
  },
  ...overrides,
});

async function seedCredential(options: { readonly pending?: boolean } = {}): Promise<{
  readonly token: string;
  readonly store: D1PublicBookingManagementStore;
}> {
  const attempts = new D1PublicBookingAttemptStore(env.CALENDAR_DB, {
    managementSecret,
    managementOrigin: "https://cal.with-tap.ai",
    now: () => now,
    bookingReference: () => "pb_management_core_reference_123456",
  });
  const approvalExpiresAt = options.pending ? "2026-08-17T18:00:00.000Z" : null;
  const claimed = await attempts.claim({
    scope,
    idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    requestHash: "provider_commit_proof_management_core",
    slotProofFingerprint: "slot_proof_management_core_1234567",
    providerOperationId: "tap_provider_management_core_operation",
    startsAt: originalStart,
    endsAt: originalEnd,
    revisionId: "revision-management-core-1",
    guest: { name: "Guest Person", email: "guest@example.com" },
    approvalExpiresAt,
  });
  if (claimed.kind !== "claimed") throw new Error("Expected a booking claim.");
  const input: Parameters<PublicBookingManagementTokenIssuer["issue"]>[0] = {
    scope,
    bookingReference: claimed.attempt.bookingReference,
    pageId: "page-management-core",
    revisionId: "revision-management-core-1",
    destinationCalendarId: "calendar-management-core",
    providerBookingId: "provider-event-management-core",
    providerOperationId: "tap_provider_management_core_operation",
    startsAt: originalStart,
    endsAt: originalEnd,
    guest: { name: "Guest Person", email: "guest@example.com" },
    approvalExpiresAt,
    organizerName: "TAP Organizer",
    eventTitle: "30 Minute Meeting",
    location: "google-meet",
    locationLabel: "Google Meet",
    timeZone: "America/New_York",
  };
  const issuer = new D1PublicBookingManagementTokenIssuer(env.CALENDAR_DB, {
    secret: managementSecret,
    now: () => now,
  });
  const { token } = await issuer.issue(input);
  return {
    token,
    store: new D1PublicBookingManagementStore(env.CALENDAR_DB, { now: () => now }),
  };
}

const harness = (
  store: D1PublicBookingManagementStore,
  options: {
    readonly page?: ResolvedPublishedPublicBookingPage | null;
    readonly provider?: PublicBookingManagementProvider;
  } = {},
) => {
  const page = options.page === undefined ? pageFixture() : options.page;
  const currentPage = vi.fn(async () => page);
  const verify = vi.fn(async () => ({
    token: rescheduleRequest.slotToken,
    claims: {
      v: 1 as const,
      revisionId: pageFixture().revisionId,
      start: newStart,
      end: newEnd,
      iat: Math.floor(now / 1_000),
      exp: Math.floor(now / 1_000) + 300,
    },
  }));
  const revalidate = vi.fn(async (
    input: Parameters<PublicBookingManagementDependencies["availability"]["revalidate"]>[0],
  ) => ({
    revisionId: input.page.revisionId,
    eventStart: input.eventStart,
    eventEnd: input.eventEnd,
    conflictStart: input.conflictStart,
    conflictEnd: input.conflictEnd,
    checkedCalendarIds: input.conflictCalendarIds,
    status: "available" as const,
  }));
  const recover = vi.fn(async () => ({ status: "absent" as const }));
  const cancel = vi.fn(async (
    command: Parameters<PublicBookingManagementProvider["cancel"]>[0],
  ) => ({
    status: "committed" as const,
    receipt: {
      operationId: command.operationId,
      providerBookingId: command.providerBookingId,
      startsAt: command.startsAt,
      endsAt: command.endsAt,
      status: "cancelled" as const,
    },
  }));
  const reschedule = vi.fn(async (
    command: Parameters<PublicBookingManagementProvider["reschedule"]>[0],
  ) => ({
    status: "committed" as const,
    receipt: {
      operationId: command.operationId,
      providerBookingId: command.providerBookingId,
      startsAt: command.newStartsAt!,
      endsAt: command.newEndsAt!,
      status: "confirmed" as const,
    },
  }));
  const provider = options.provider ?? { recover, cancel, reschedule };
  const enqueue = vi.fn(async () => undefined);
  const dependencies: PublicBookingManagementDependencies = {
    serialization: { runExclusive: async (_key, operation) => operation() },
    store,
    publications: { currentPage },
    slotVerifier: { verify },
    availability: { revalidate },
    provider,
    email: { enqueue },
    now: () => now,
    turnstileSiteKey: "turnstile-site-key-management-core",
  };
  return { dependencies, currentPage, verify, revalidate, recover, cancel, reschedule, enqueue };
};

beforeEach(async () => {
  await env.CALENDAR_DB.batch([
    env.CALENDAR_DB.prepare("DELETE FROM public_booking_email_outbox"),
    env.CALENDAR_DB.prepare("DELETE FROM public_booking_management_mutations"),
    env.CALENDAR_DB.prepare("DELETE FROM public_booking_management_credentials"),
    env.CALENDAR_DB.prepare("DELETE FROM public_booking_slot_proof_uses"),
    env.CALENDAR_DB.prepare("DELETE FROM public_booking_attempts"),
  ]);
});

describe("public booking management contracts", () => {
  it("strictly parses fragment bearers and versioned cancel/reschedule bodies", () => {
    expect(parsePublicBookingManagementToken(`tapm_v1_${"a".repeat(43)}`)).toBe(`tapm_v1_${"a".repeat(43)}`);
    expect(() => parsePublicBookingManagementToken(`https://cal.with-tap.ai/manage#tapm_v1_${"a".repeat(43)}`))
      .toThrow(expect.objectContaining({ code: "management_link_unavailable" }));
    expect(cancelRequest).toEqual({
      schemaVersion: "tap.calendar.public-management-cancel.v1",
      requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      expectedVersion: 1,
    });
    expect(rescheduleRequest.slotToken).toBe("signed_slot_token_for_management_core");
    expect(() => parsePublicBookingCancelRequest({ ...cancelRequest, extra: true }))
      .toThrow(expect.objectContaining({ code: "invalid_management_request" }));
    expect(() => parsePublicBookingRescheduleRequest({ ...rescheduleRequest, expectedVersion: 0 }))
      .toThrow(expect.objectContaining({ code: "invalid_management_request" }));
  });

  it("returns a guest-safe DTO and a uniform missing-link error", async () => {
    const { token, store } = await seedCredential();
    const setup = harness(store);
    await expect(readPublicBookingManagement(token, setup.dependencies)).resolves.toEqual({
      schemaVersion: "tap.calendar.public-management.v1",
      bookingReference: "pb_management_core_reference_123456",
      bookingVersion: 1,
      status: "confirmed",
      guest: { name: "Guest Person", email: "guest@example.com" },
      host: { displayName: "TAP Organizer" },
      event: {
        title: "30 Minute Meeting",
        startsAt: originalStart,
        endsAt: originalEnd,
        durationMinutes: 30,
        location: "google-meet",
        locationLabel: "Google Meet",
        approvalExpiresAt: null,
      },
      actions: { canCancel: true, canReschedule: true },
      reschedulePage: {
        profileSlug: "tap-organizer",
        eventTypeSlug: "thirty-minutes",
        pageRevision: "revision-management-core-2",
        bookingWindow: { firstDate: "2026-08-16", lastDate: "2026-10-14" },
        turnstileSiteKey: "turnstile-site-key-management-core",
      },
    });
    for (const unknown of ["bad", `tapm_v1_${"z".repeat(43)}`]) {
      await expect(readPublicBookingManagement(unknown, setup.dependencies)).rejects.toMatchObject({
        status: 404,
        code: "management_link_unavailable",
      });
    }
  });

  it("cancels after unpublication, increments the version once, and replays without another provider write", async () => {
    const { token, store } = await seedCredential();
    const setup = harness(store, { page: null });
    const first = await cancelPublicBooking(token, cancelRequest, setup.dependencies);
    expect(first).toMatchObject({ bookingVersion: 2, status: "cancelled", actions: { canCancel: false, canReschedule: false } });
    expect(setup.currentPage).not.toHaveBeenCalled();
    expect(setup.recover).toHaveBeenCalledTimes(1);
    expect(setup.cancel).toHaveBeenCalledTimes(1);
    expect(setup.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      kind: "cancelled",
      recipient: { name: "Guest Person", email: "guest@example.com" },
    }));
    await expect(cancelPublicBooking(token, cancelRequest, setup.dependencies)).resolves.toEqual(first);
    expect(setup.recover).toHaveBeenCalledTimes(1);
    expect(setup.cancel).toHaveBeenCalledTimes(1);
    expect(setup.enqueue).toHaveBeenCalledTimes(2);
  });

  it("reschedules only through the current page and preserves the destination/provider identity", async () => {
    const { token, store } = await seedCredential();
    const setup = harness(store);
    const result = await reschedulePublicBooking(token, rescheduleRequest, setup.dependencies);
    expect(result).toMatchObject({
      bookingVersion: 2,
      status: "confirmed",
      event: { startsAt: newStart, endsAt: newEnd },
    });
    expect(setup.currentPage).toHaveBeenCalledWith("page-management-core");
    expect(setup.verify).toHaveBeenCalledTimes(1);
    expect(setup.revalidate).toHaveBeenCalledWith(expect.objectContaining({
      conflictStart: "2026-08-19T14:45:00.000Z",
      conflictEnd: "2026-08-19T15:45:00.000Z",
      conflictCalendarIds: ["calendar-management-conflict", "calendar-management-core"],
    }));
    expect(setup.reschedule).toHaveBeenCalledWith(expect.objectContaining({
      destinationCalendarId: "calendar-management-core",
      providerBookingId: "provider-event-management-core",
      providerOperationId: "tap_provider_management_core_operation",
      providerCommitProof: "provider_commit_proof_management_core",
      newStartsAt: newStart,
      newEndsAt: newEnd,
    }));
    expect(setup.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      kind: "rescheduled",
      previousStartsAt: originalStart,
      previousEndsAt: originalEnd,
      startsAt: newStart,
      endsAt: newEnd,
    }));
  });

  it("rejects a pending booking, an unpublished page, and a destination change before provider mutation", async () => {
    const pending = await seedCredential({ pending: true });
    const pendingSetup = harness(pending.store);
    await expect(reschedulePublicBooking(pending.token, rescheduleRequest, pendingSetup.dependencies))
      .rejects.toMatchObject({ code: "reschedule_unavailable" });
    expect(pendingSetup.recover).not.toHaveBeenCalled();
    expect(pendingSetup.reschedule).not.toHaveBeenCalled();

    await env.CALENDAR_DB.batch([
      env.CALENDAR_DB.prepare("DELETE FROM public_booking_management_mutations"),
      env.CALENDAR_DB.prepare("DELETE FROM public_booking_management_credentials"),
      env.CALENDAR_DB.prepare("DELETE FROM public_booking_slot_proof_uses"),
      env.CALENDAR_DB.prepare("DELETE FROM public_booking_attempts"),
    ]);
    const confirmed = await seedCredential();
    const unpublished = harness(confirmed.store, { page: null });
    await expect(reschedulePublicBooking(confirmed.token, rescheduleRequest, unpublished.dependencies))
      .rejects.toMatchObject({ code: "reschedule_unavailable" });
    expect(unpublished.reschedule).not.toHaveBeenCalled();

    const wrongDestination = harness(confirmed.store, {
      page: pageFixture({
        privateSnapshot: {
          ...pageFixture().privateSnapshot,
          destinationCalendarId: "calendar-other",
          conflictCalendarIds: ["calendar-other"],
        },
      }),
    });
    await expect(reschedulePublicBooking(confirmed.token, rescheduleRequest, wrongDestination.dependencies))
      .rejects.toMatchObject({ code: "reschedule_unavailable" });
    expect(wrongDestination.reschedule).not.toHaveBeenCalled();
  });

  it("recovers an uncertain reschedule after the page is unpublished", async () => {
    const { token, store } = await seedCredential();
    let recoveryAttempt = 0;
    const provider: PublicBookingManagementProvider = {
      recover: vi.fn(async command => {
        recoveryAttempt += 1;
        if (recoveryAttempt === 1) return { status: "absent" as const };
        return {
          status: "committed" as const,
          receipt: {
            operationId: command.operationId,
            providerBookingId: command.providerBookingId,
            startsAt: command.newStartsAt!,
            endsAt: command.newEndsAt!,
            status: "confirmed" as const,
          },
        };
      }),
      cancel: vi.fn(async () => ({ status: "uncertain" as const })),
      reschedule: vi.fn(async () => ({ status: "uncertain" as const })),
    };
    const setup = harness(store, { provider });
    await expect(reschedulePublicBooking(token, rescheduleRequest, setup.dependencies))
      .rejects.toMatchObject({ code: "provider_management_uncertain", retryable: true });
    setup.currentPage.mockImplementation(async () => null);
    await expect(reschedulePublicBooking(token, rescheduleRequest, setup.dependencies)).resolves.toMatchObject({
      bookingVersion: 2,
      event: { startsAt: newStart, endsAt: newEnd },
    });
    expect(setup.verify).toHaveBeenCalledTimes(1);
    expect(setup.revalidate).toHaveBeenCalledTimes(1);
    expect(provider.reschedule).toHaveBeenCalledTimes(1);
    expect(provider.recover).toHaveBeenCalledTimes(2);
  });

  it("owner-scopes and idempotently confirms a pending approval for later email enqueue", async () => {
    const { token, store } = await seedCredential({ pending: true });
    const transition = {
      scope,
      providerOperationId: "tap_provider_management_core_operation",
      targetStatus: "confirmed" as const,
    };
    await expect(store.transitionApproval({
      ...transition,
      scope: { ...scope, principal: "another-principal" },
    })).resolves.toEqual({ kind: "not-found" });

    const contenders = await Promise.all([
      store.transitionApproval(transition),
      store.transitionApproval(transition),
    ]);
    expect(contenders.map(result => result.kind).sort()).toEqual(["existing", "transitioned"]);
    const successful = contenders[0]?.kind === "transitioned" ? contenders[0] : contenders[1];
    expect(successful).toEqual({
      kind: "transitioned",
      status: "confirmed",
      bookingVersion: 2,
      notice: {
        eventKey: "approval-approved:pb_management_core_reference_123456",
        bookingReference: "pb_management_core_reference_123456",
        scope,
        kind: "approval-approved",
        recipient: { name: "Guest Person", email: "guest@example.com" },
        organizerName: "TAP Organizer",
        eventTitle: "30 Minute Meeting",
        startsAt: originalStart,
        endsAt: originalEnd,
        timeZone: "America/New_York",
      },
    });
    expect(JSON.stringify(successful)).not.toContain(token);
    expect(JSON.stringify(successful)).not.toContain("provider-event-management-core");
    await expect(store.transitionApproval({
      ...transition,
      targetStatus: "declined",
    })).resolves.toEqual({ kind: "status-conflict", currentStatus: "confirmed" });

    const setup = harness(store);
    await expect(readPublicBookingManagement(token, setup.dependencies)).resolves.toMatchObject({
      bookingVersion: 2,
      status: "confirmed",
      actions: { canCancel: true, canReschedule: true },
    });
  });

  it("does not resolve approval while a guest management mutation is open", async () => {
    const { token, store } = await seedCredential({ pending: true });
    const booking = await store.resolve(token);
    if (!booking) throw new Error("Expected the pending management record.");
    await expect(store.claimMutation({
      booking,
      requestId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      requestHash: "open_cancel_hash_1234567890",
      operationId: "open_cancel_operation_123456",
      kind: "cancel",
      expectedVersion: 1,
      pageRevisionId: null,
      toStartsAt: null,
      toEndsAt: null,
      conflictCalendarIds: [],
      conflictStart: null,
      conflictEnd: null,
    })).resolves.toMatchObject({ kind: "claimed" });
    await expect(store.transitionApproval({
      scope,
      providerOperationId: "tap_provider_management_core_operation",
      targetStatus: "confirmed",
    })).resolves.toEqual({ kind: "mutation-conflict" });
    await expect(store.resolve(token)).resolves.toMatchObject({ status: "pending", version: 1 });
  });

  it("keeps declined approvals guest-readable but terminal and non-cancellable", async () => {
    const { token, store } = await seedCredential({ pending: true });
    await expect(store.transitionApproval({
      scope,
      providerOperationId: "tap_provider_management_core_operation",
      targetStatus: "declined",
    })).resolves.toMatchObject({
      kind: "transitioned",
      status: "declined",
      bookingVersion: 2,
      notice: { kind: "approval-declined" },
    });
    const setup = harness(store);
    await expect(readPublicBookingManagement(token, setup.dependencies)).resolves.toMatchObject({
      status: "declined",
      actions: { canCancel: false, canReschedule: false },
      reschedulePage: null,
    });
    await expect(cancelPublicBooking(token, {
      ...cancelRequest,
      expectedVersion: 2,
    }, setup.dependencies)).rejects.toMatchObject({ code: "booking_not_cancellable" });
    await expect(reschedulePublicBooking(token, {
      ...rescheduleRequest,
      expectedVersion: 2,
    }, setup.dependencies)).rejects.toMatchObject({ code: "reschedule_unavailable" });
    expect(setup.cancel).not.toHaveBeenCalled();
    expect(setup.reschedule).not.toHaveBeenCalled();
  });

  it("time-gates expiry and rejects a late approval without changing the pending version", async () => {
    const { token } = await seedCredential({ pending: true });
    const beforeExpiry = new D1PublicBookingManagementStore(env.CALENDAR_DB, { now: () => now });
    const expirationInput = {
      scope,
      providerOperationId: "tap_provider_management_core_operation",
      targetStatus: "expired" as const,
    };
    await expect(beforeExpiry.transitionApproval(expirationInput)).resolves.toEqual({
      kind: "deadline-conflict",
      approvalExpiresAt: "2026-08-17T18:00:00.000Z",
    });
    expect(await env.CALENDAR_DB.prepare(
      "SELECT version FROM public_booking_management_credentials",
    ).first<number>("version")).toBe(1);

    const atExpiry = new D1PublicBookingManagementStore(env.CALENDAR_DB, {
      now: () => Date.parse("2026-08-17T18:00:00.000Z"),
    });
    await expect(atExpiry.transitionApproval({
      ...expirationInput,
      targetStatus: "confirmed",
    })).resolves.toEqual({
      kind: "deadline-conflict",
      approvalExpiresAt: "2026-08-17T18:00:00.000Z",
    });
    const expired = await atExpiry.transitionApproval(expirationInput);
    expect(expired).toMatchObject({
      kind: "transitioned",
      status: "expired",
      bookingVersion: 2,
      notice: { kind: "approval-expired" },
    });
    await expect(atExpiry.transitionApproval(expirationInput)).resolves.toMatchObject({
      kind: "existing",
      status: "expired",
      bookingVersion: 2,
      notice: { kind: "approval-expired" },
    });
    const setup = harness(atExpiry);
    await expect(readPublicBookingManagement(token, setup.dependencies)).resolves.toMatchObject({
      status: "expired",
      actions: { canCancel: false, canReschedule: false },
      reschedulePage: null,
    });
  });
});
