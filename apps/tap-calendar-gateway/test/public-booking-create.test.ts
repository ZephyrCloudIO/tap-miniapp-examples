import { describe, expect, it, vi } from "vitest";
import {
  createPublicBooking,
  parsePublicBookingRequest,
  publicBookingCoordinationKey,
  publicBookingProviderOperationId,
  publicBookingRequestHash,
  type PublicBookingAttempt,
  type PublicBookingAttemptClaim,
  type PublicBookingAttemptClaimResult,
  type PublicBookingAttemptStore,
  type PublicBookingCreateDependencies,
  type PublicBookingCreateInput,
  type PublicBookingProvider,
  type PublicBookingResult,
  type PublicBookingSerializationBoundary,
} from "../src/public-booking-create";
import type {
  PrivatePageSnapshot,
  PublicPageSnapshot,
  ResolvedPublishedPublicBookingPage,
} from "../src/public-booking-read";
import {
  buildPublicAvailability,
  verifyPublicSlotToken,
} from "../src/public-booking-read";

const now = Date.parse("2026-08-16T12:00:00.000Z");
const MILLISECONDS_PER_MINUTE = 60_000;
const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const secondRequestId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const revisionId = "public-create-revision-1";
const startsAt = "2026-08-17T13:00:00.000Z";
const endsAt = "2026-08-17T13:30:00.000Z";

const publicSnapshot: PublicPageSnapshot = {
  schemaVersion: "tap.calendar.public-page-snapshot.v1",
  displayName: "Zackary Chapple",
  title: "30 minute meeting",
  description: "Pick a time that works for you.",
  durationMinutes: 30,
  location: "google-meet",
  locationLabel: "Google Meet",
  approvalRequired: false,
};

const privateSnapshot: PrivatePageSnapshot = {
  schemaVersion: "tap.calendar.private-page-snapshot.v1",
  workspaceId: "workspace-public-create",
  principalId: "principal-public-create",
  destinationCalendarId: "calendar-destination-create",
  conflictCalendarIds: ["calendar-conflict-create", "calendar-destination-create"],
  sourceAvailabilityScheduleId: "availability-public-create",
  location: "google-meet",
  schedule: {
    timeZone: "America/New_York",
    preferredStart: "09:00",
    preferredEnd: "17:00",
    bufferBeforeMinutes: 5,
    bufferAfterMinutes: 10,
    minimumNoticeMinutes: 0,
    bookingHorizonDays: 60,
    windows: [{ day: 1, enabled: true, start: "09:00", end: "17:00" }],
    overrides: [],
  },
};

const pageFixture = (
  overrides: Partial<ResolvedPublishedPublicBookingPage> = {},
): ResolvedPublishedPublicBookingPage => ({
  profileId: "profile-public-create",
  pageId: "page-public-create",
  revisionId,
  profileSlug: "zackary-chapple",
  eventTypeSlug: "30min",
  publishedAt: "2026-08-16T11:00:00.000Z",
  publicSnapshot,
  privateSnapshot,
  ...overrides,
});

const inputFixture = (overrides: Partial<PublicBookingCreateInput> = {}): PublicBookingCreateInput => ({
  requestId,
  guest: { name: "Guest Person", email: "guest@example.com" },
  slotProof: {
    token: "signed-slot-token-for-public-create-1",
    claims: {
      v: 1,
      revisionId,
      start: startsAt,
      end: endsAt,
      iat: Math.floor(now / 1_000),
      exp: Math.floor(now / 1_000) + 300,
    },
  },
  turnstile: {
    success: true,
    action: "public-booking",
    hostname: "cal.with-tap.ai",
    challengeTimestamp: new Date(now - 1_000).toISOString(),
  },
  ...overrides,
});

const scopeKey = (scope: { readonly workspace: string; readonly principal: string }): string =>
  `${scope.workspace}\u0000${scope.principal}`;

class MemoryAttemptStore implements PublicBookingAttemptStore {
  readonly attempts = new Map<string, PublicBookingAttempt>();
  readonly proofOwners = new Map<string, string>();
  readonly uncertainCodes: string[] = [];
  referenceSequence = 0;

  async claim(input: PublicBookingAttemptClaim): Promise<PublicBookingAttemptClaimResult> {
    const key = `${scopeKey(input.scope)}\u0000${input.idempotencyKey}`;
    const existing = this.attempts.get(key);
    if (existing && existing.requestHash !== input.requestHash) {
      return { kind: "idempotency-conflict" };
    }
    const proofOwner = this.proofOwners.get(`${scopeKey(input.scope)}\u0000${input.slotProofFingerprint}`);
    if (proofOwner && proofOwner !== input.idempotencyKey) {
      return { kind: "slot-proof-replayed" };
    }
    this.proofOwners.set(
      `${scopeKey(input.scope)}\u0000${input.slotProofFingerprint}`,
      input.idempotencyKey,
    );
    if (existing) return { kind: "existing", attempt: existing };
    this.referenceSequence += 1;
    const attempt: PublicBookingAttempt = {
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      providerOperationId: input.providerOperationId,
      bookingReference: `booking_ref_${String(this.referenceSequence).padStart(8, "0")}`,
      guest: input.guest,
      approvalExpiresAt: input.approvalExpiresAt,
      state: "pending",
      response: null,
      rejectionCode: null,
    };
    this.attempts.set(key, attempt);
    return { kind: "claimed", attempt };
  }

  async markUncertain(input: {
    readonly scope: { readonly workspace: string; readonly principal: string };
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly errorCode: string;
  }): Promise<void> {
    const key = `${scopeKey(input.scope)}\u0000${input.idempotencyKey}`;
    const attempt = this.attempts.get(key);
    if (!attempt || attempt.requestHash !== input.requestHash) throw new Error("CAS failed");
    this.uncertainCodes.push(input.errorCode);
    this.attempts.set(key, { ...attempt, state: "uncertain" });
  }

  async markRejected(input: {
    readonly scope: { readonly workspace: string; readonly principal: string };
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly rejectionCode: "slot_conflict";
  }): Promise<void> {
    const key = `${scopeKey(input.scope)}\u0000${input.idempotencyKey}`;
    const attempt = this.attempts.get(key);
    if (!attempt || attempt.requestHash !== input.requestHash) throw new Error("CAS failed");
    this.attempts.set(key, {
      ...attempt,
      state: "rejected",
      rejectionCode: input.rejectionCode,
    });
  }

  async markCommitted(input: {
    readonly scope: { readonly workspace: string; readonly principal: string };
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly response: PublicBookingResult;
  }): Promise<void> {
    const key = `${scopeKey(input.scope)}\u0000${input.idempotencyKey}`;
    const attempt = this.attempts.get(key);
    if (!attempt || attempt.requestHash !== input.requestHash) throw new Error("CAS failed");
    this.attempts.set(key, {
      ...attempt,
      state: "committed",
      response: input.response,
      rejectionCode: null,
    });
  }
}

function harness(options: {
  readonly page?: ResolvedPublishedPublicBookingPage;
  readonly currentPage?: ResolvedPublishedPublicBookingPage | null;
  readonly store?: MemoryAttemptStore;
  readonly provider?: PublicBookingProvider;
  readonly availabilityStatus?: "available" | "conflict" | "uncertain";
  readonly checkedCalendarIds?: readonly string[];
  readonly managementIssue?: PublicBookingCreateDependencies["managementTokens"]["issue"];
  readonly nowMs?: () => number;
} = {}) {
  const page = options.page ?? pageFixture();
  const store = options.store ?? new MemoryAttemptStore();
  const serializedKeys: string[] = [];
  const serialization: PublicBookingSerializationBoundary = {
    async runExclusive(key, operation) {
      serializedKeys.push(key);
      return operation();
    },
  };
  const availability = vi.fn(async (request: Parameters<PublicBookingCreateDependencies["availability"]["revalidate"]>[0]) => ({
    revisionId: request.page.revisionId,
    eventStart: request.eventStart,
    eventEnd: request.eventEnd,
    conflictStart: request.conflictStart,
    conflictEnd: request.conflictEnd,
    checkedCalendarIds: options.checkedCalendarIds ?? request.conflictCalendarIds,
    status: options.availabilityStatus ?? "available" as const,
  }));
  const commit = vi.fn(async (request: Parameters<PublicBookingProvider["commit"]>[0]) => ({
    status: "committed" as const,
    receipt: {
      operationId: request.operationId,
      commitProof: request.commitProof,
      providerBookingId: "google-provider-event-1",
      startsAt: request.startsAt,
      endsAt: request.endsAt,
      status: request.bookingKind === "approval-hold" ? "tentative" as const : "confirmed" as const,
    },
  }));
  const recover = vi.fn(async () => ({ status: "absent" as const }));
  const provider: PublicBookingProvider = options.provider ?? { commit, recover };
  const managementIssue = vi.fn(options.managementIssue ?? (async () => ({
    token: "tapm_v1_management_token_1234567890",
  })));
  const dependencies: PublicBookingCreateDependencies = {
    serialization,
    publications: { currentPage: vi.fn(async () => options.currentPage === undefined ? page : options.currentPage) },
    attempts: store,
    availability: { revalidate: availability },
    provider,
    managementTokens: { issue: managementIssue },
    now: options.nowMs ?? (() => now),
    expectedTurnstileAction: "public-booking",
    allowedTurnstileHostnames: ["cal.with-tap.ai"],
    managementOrigin: "https://cal.with-tap.ai",
  };
  return {
    page,
    store,
    dependencies,
    serializedKeys,
    availability,
    commit,
    recover,
    managementIssue,
  };
}

describe("public booking request boundary", () => {
  it("strictly parses and normalizes only the public schema", () => {
    expect(parsePublicBookingRequest({
      schemaVersion: "tap.calendar.public-booking.v1",
      requestId,
      slotToken: "signed-slot-token-for-public-create-1",
      guest: { name: "  Guest Person  ", email: " GUEST@Example.com " },
      turnstileToken: "turnstile-token",
    })).toEqual({
      schemaVersion: "tap.calendar.public-booking.v1",
      requestId,
      slotToken: "signed-slot-token-for-public-create-1",
      guest: { name: "Guest Person", email: "guest@example.com" },
      turnstileToken: "turnstile-token",
    });
    expect(() => parsePublicBookingRequest({
      schemaVersion: "tap.calendar.public-booking.v1",
      requestId,
      slotToken: "signed-slot-token-for-public-create-1",
      guest: { name: "Guest Person", email: "guest@example.com" },
      turnstileToken: "turnstile-token",
      workspaceId: "spoofed-owner",
    })).toThrowError(expect.objectContaining({ code: "invalid_booking_request" }));
  });

  it("hashes the business request but not replaceable security tokens", async () => {
    const page = pageFixture();
    const first = await publicBookingRequestHash({
      page,
      slotClaims: inputFixture().slotProof.claims,
      guest: { name: " Guest Person ", email: "GUEST@example.com" },
    });
    const second = await publicBookingRequestHash({
      page,
      slotClaims: { ...inputFixture().slotProof.claims },
      guest: { name: "Guest Person", email: "guest@example.com" },
    });
    const changed = await publicBookingRequestHash({
      page,
      slotClaims: inputFixture().slotProof.claims,
      guest: { name: "Another Guest", email: "guest@example.com" },
    });
    expect(first).toBe(second);
    expect(changed).not.toBe(first);

    const reorderedConflictPage = pageFixture({
      privateSnapshot: {
        ...privateSnapshot,
        conflictCalendarIds: [
          "calendar-destination-create",
          "calendar-conflict-create",
          "calendar-conflict-create",
        ],
      },
    });
    expect(await publicBookingRequestHash({
      page: reorderedConflictPage,
      slotClaims: inputFixture().slotProof.claims,
      guest: { name: "Guest Person", email: "guest@example.com" },
    })).toBe(first);
  });

  it("uses the existing Google deterministic ID derivation including destination calendar", async () => {
    const scope = { workspace: "workspace", principal: "principal" };
    expect(await publicBookingCoordinationKey(scope)).toBe(await publicBookingCoordinationKey(scope));
    expect(await publicBookingCoordinationKey(scope)).not.toBe(await publicBookingCoordinationKey({
      workspace: "workspace",
      principal: "another-principal",
    }));
    const operation = await publicBookingProviderOperationId(scope, "calendar-destination", requestId);
    expect(operation).toBe(
      "tapdgmef96cclk4adg5qqdcf6dj7h17cj5a4mc84o6mr3dufqa6cbeg",
    );
    expect(operation).toBe(await publicBookingProviderOperationId(
      scope,
      "calendar-destination",
      requestId,
    ));
    expect(operation).not.toBe(await publicBookingProviderOperationId(
      scope,
      "different-destination",
      requestId,
    ));
  });
});

describe("public booking commit core", () => {
  it("checks the buffer-expanded range but writes the original event interval", async () => {
    const setup = harness();
    const result = await createPublicBooking(setup.page, inputFixture(), setup.dependencies);
    expect(result).toEqual({
      schemaVersion: "tap.calendar.public-booking.v1",
      status: "confirmed",
      bookingReference: "booking_ref_00000001",
      startsAt,
      endsAt,
      managementUrl: "https://cal.with-tap.ai/manage#tapm_v1_management_token_1234567890",
    });
    expect(setup.availability).toHaveBeenCalledWith(expect.objectContaining({
      eventStart: startsAt,
      eventEnd: endsAt,
      conflictStart: "2026-08-17T12:55:00.000Z",
      conflictEnd: "2026-08-17T13:40:00.000Z",
      conflictCalendarIds: ["calendar-conflict-create", "calendar-destination-create"],
    }));
    expect(setup.commit).toHaveBeenCalledWith(expect.objectContaining({
      scope: {
        workspace: "workspace-public-create",
        principal: "principal-public-create",
      },
      startsAt,
      endsAt,
      conflictCalendarIds: ["calendar-conflict-create", "calendar-destination-create"],
      conflictStart: "2026-08-17T12:55:00.000Z",
      conflictEnd: "2026-08-17T13:40:00.000Z",
      bookingKind: "meeting",
      conferenceProvider: "google-meet",
      expiresAt: null,
      guest: { name: "Guest Person", email: "guest@example.com" },
    }));
    expect(setup.managementIssue).toHaveBeenCalledWith(expect.objectContaining({
      guest: { name: "Guest Person", email: "guest@example.com" },
      approvalExpiresAt: null,
    }));
    expect(JSON.stringify(result)).not.toMatch(
      /workspace-public-create|principal-public-create|calendar-|google-provider-event/u,
    );
    expect(setup.serializedKeys).toHaveLength(1);
  });

  it("returns the stored response for an identical replay without another provider write", async () => {
    const setup = harness();
    const first = await createPublicBooking(setup.page, inputFixture(), setup.dependencies);
    const second = await createPublicBooking(setup.page, inputFixture(), setup.dependencies);
    expect(second).toEqual(first);
    expect(setup.commit).toHaveBeenCalledTimes(1);
    expect(setup.availability).toHaveBeenCalledTimes(1);
    expect(setup.managementIssue).toHaveBeenCalledTimes(1);
  });

  it("rejects a reused idempotency key whose business request changed", async () => {
    const setup = harness();
    await createPublicBooking(setup.page, inputFixture(), setup.dependencies);
    await expect(createPublicBooking(setup.page, inputFixture({
      guest: { name: "Different Guest", email: "guest@example.com" },
    }), setup.dependencies)).rejects.toMatchObject({
      status: 409,
      code: "idempotency_key_reused",
    });
    expect(setup.commit).toHaveBeenCalledTimes(1);
  });

  it("rejects a slot proof replayed under another idempotency key", async () => {
    const setup = harness();
    await createPublicBooking(setup.page, inputFixture(), setup.dependencies);
    await expect(createPublicBooking(setup.page, inputFixture({
      requestId: secondRequestId,
    }), setup.dependencies)).rejects.toMatchObject({
      status: 409,
      code: "slot_proof_replayed",
    });
    expect(setup.commit).toHaveBeenCalledTimes(1);
  });

  it("fails before durable or provider mutation when the publication changed", async () => {
    const current = pageFixture({ revisionId: "public-create-revision-2" });
    const setup = harness({ currentPage: current });
    await expect(createPublicBooking(setup.page, inputFixture(), setup.dependencies)).rejects.toMatchObject({
      status: 409,
      code: "public_page_changed",
    });
    expect(setup.store.attempts.size).toBe(0);
    expect(setup.commit).not.toHaveBeenCalled();
  });

  it("rejects a still-signed slot when minimum notice becomes unsatisfied before commit", async () => {
    const noticePage = pageFixture({
      privateSnapshot: {
        ...privateSnapshot,
        schedule: {
          ...privateSnapshot.schedule,
          minimumNoticeMinutes: 1_500,
        },
      },
    });
    const signingKey = "test-only-create-slot-signing-key-1234567890";
    const issued = await buildPublicAvailability(
      noticePage,
      { month: "2026-08-01", timeZone: "UTC", pageRevision: revisionId },
      [],
      signingKey,
      now,
    );
    const issuedSlot = issued.dates.flatMap(date => date.slots)
      .find(slot => slot.start === startsAt);
    expect(issuedSlot).toBeDefined();
    const commitTime = now + MILLISECONDS_PER_MINUTE;
    const claims = await verifyPublicSlotToken(signingKey, issuedSlot!.token, { now: commitTime });
    const setup = harness({ page: noticePage, nowMs: () => commitTime });

    await expect(createPublicBooking(noticePage, inputFixture({
      slotProof: { token: issuedSlot!.token, claims },
    }), setup.dependencies)).rejects.toMatchObject({
      status: 409,
      code: "slot_conflict",
    });
    expect(setup.store.attempts.size).toBe(0);
    expect(setup.availability).not.toHaveBeenCalled();
    expect(setup.commit).not.toHaveBeenCalled();
  });

  it("fails closed for expired slot proofs and invalid Turnstile attestations", async () => {
    const expired = harness();
    await expect(createPublicBooking(expired.page, inputFixture({
      slotProof: {
        ...inputFixture().slotProof,
        claims: { ...inputFixture().slotProof.claims, exp: Math.floor(now / 1_000) },
      },
    }), expired.dependencies)).rejects.toMatchObject({ code: "slot_token_expired" });

    for (const turnstile of [
      { ...inputFixture().turnstile, success: false },
      { ...inputFixture().turnstile, action: "different-action" },
      { ...inputFixture().turnstile, hostname: "attacker.example" },
      {
        ...inputFixture().turnstile,
        challengeTimestamp: new Date(now - 5 * 60 * 1_000).toISOString(),
      },
    ]) {
      const setup = harness();
      await expect(createPublicBooking(setup.page, inputFixture({ turnstile }), setup.dependencies))
        .rejects.toMatchObject({ status: 403, code: "turnstile_verification_failed" });
      expect(setup.store.attempts.size).toBe(0);
    }
  });

  it("requires a complete live attestation for every conflict calendar", async () => {
    const setup = harness({ checkedCalendarIds: ["calendar-destination-create"] });
    await expect(createPublicBooking(setup.page, inputFixture(), setup.dependencies)).rejects.toMatchObject({
      status: 503,
      code: "live_availability_unavailable",
      retryable: true,
    });
    expect(setup.commit).not.toHaveBeenCalled();
  });

  it("persists a live conflict as a stable idempotent rejection", async () => {
    const setup = harness({ availabilityStatus: "conflict" });
    await expect(createPublicBooking(setup.page, inputFixture(), setup.dependencies)).rejects.toMatchObject({
      status: 409,
      code: "slot_conflict",
    });
    await expect(createPublicBooking(setup.page, inputFixture(), setup.dependencies)).rejects.toMatchObject({
      status: 409,
      code: "slot_conflict",
    });
    expect(setup.availability).toHaveBeenCalledTimes(1);
    expect(setup.commit).not.toHaveBeenCalled();
  });

  it("recovers an ambiguous provider commit with the same operation ID", async () => {
    let recoverCalls = 0;
    const provider: PublicBookingProvider = {
      commit: vi.fn(async () => ({ status: "uncertain" as const })),
      recover: vi.fn(async request => {
        recoverCalls += 1;
        return {
          status: "committed" as const,
          receipt: {
            operationId: request.operationId,
            commitProof: request.commitProof,
            providerBookingId: "recovered-provider-event",
            startsAt: request.startsAt,
            endsAt: request.endsAt,
            status: "confirmed" as const,
          },
        };
      }),
    };
    const setup = harness({ provider });
    await expect(createPublicBooking(setup.page, inputFixture(), setup.dependencies)).rejects.toMatchObject({
      code: "provider_commit_uncertain",
      retryable: true,
    });
    const recovered = await createPublicBooking(setup.page, inputFixture(), setup.dependencies);
    expect(recovered.status).toBe("confirmed");
    expect(provider.commit).toHaveBeenCalledTimes(1);
    expect(recoverCalls).toBe(1);
    expect(setup.store.uncertainCodes).toContain("provider_commit_uncertain");
  });

  it("does not issue another provider write when recovery itself is uncertain", async () => {
    const provider: PublicBookingProvider = {
      commit: vi.fn(async () => ({ status: "uncertain" as const })),
      recover: vi.fn(async () => ({ status: "uncertain" as const })),
    };
    const setup = harness({ provider });
    await expect(createPublicBooking(setup.page, inputFixture(), setup.dependencies)).rejects.toMatchObject({
      code: "provider_commit_uncertain",
    });
    await expect(createPublicBooking(setup.page, inputFixture(), setup.dependencies)).rejects.toMatchObject({
      code: "provider_commit_uncertain",
    });
    expect(provider.commit).toHaveBeenCalledTimes(1);
    expect(provider.recover).toHaveBeenCalledTimes(1);
  });

  it("revalidates and safely retries when deterministic recovery is conclusively absent", async () => {
    let commitCalls = 0;
    const provider: PublicBookingProvider = {
      recover: vi.fn(async () => ({ status: "absent" as const })),
      commit: vi.fn(async request => {
        commitCalls += 1;
        if (commitCalls === 1) return { status: "uncertain" as const };
        return {
          status: "committed" as const,
          receipt: {
            operationId: request.operationId,
            commitProof: request.commitProof,
            providerBookingId: "provider-event-after-absent",
            startsAt: request.startsAt,
            endsAt: request.endsAt,
            status: "confirmed" as const,
          },
        };
      }),
    };
    const setup = harness({ provider });
    await expect(createPublicBooking(setup.page, inputFixture(), setup.dependencies)).rejects.toMatchObject({
      code: "provider_commit_uncertain",
    });
    await expect(createPublicBooking(setup.page, inputFixture(), setup.dependencies))
      .resolves.toMatchObject({ status: "confirmed" });
    expect(provider.commit).toHaveBeenCalledTimes(2);
    expect(setup.availability).toHaveBeenCalledTimes(2);
  });

  it("treats an invalid provider commit receipt as ambiguous", async () => {
    const provider: PublicBookingProvider = {
      recover: vi.fn(async () => ({ status: "absent" as const })),
      commit: vi.fn(async request => ({
        status: "committed" as const,
        receipt: {
          operationId: request.operationId,
          commitProof: request.commitProof,
          providerBookingId: "provider-event-invalid",
          startsAt: request.startsAt,
          endsAt: "2026-08-17T14:00:00.000Z",
          status: "confirmed" as const,
        },
      })),
    };
    const setup = harness({ provider });
    await expect(createPublicBooking(setup.page, inputFixture(), setup.dependencies)).rejects.toMatchObject({
      status: 503,
      code: "provider_commit_uncertain",
    });
    expect(setup.store.uncertainCodes).toContain("provider_commit_uncertain");
  });

  it("recovers when management-token finalization failed after provider commit", async () => {
    let commitRequest: Parameters<PublicBookingProvider["commit"]>[0] | null = null;
    const provider: PublicBookingProvider = {
      commit: vi.fn(async request => {
        commitRequest = request;
        return {
          status: "committed" as const,
          receipt: {
            operationId: request.operationId,
            commitProof: request.commitProof,
            providerBookingId: "provider-event-management-recovery",
            startsAt: request.startsAt,
            endsAt: request.endsAt,
            status: "confirmed" as const,
          },
        };
      }),
      recover: vi.fn(async request => ({
        status: "committed" as const,
        receipt: {
          operationId: request.operationId,
          commitProof: request.commitProof,
          providerBookingId: "provider-event-management-recovery",
          startsAt: request.startsAt,
          endsAt: request.endsAt,
          status: "confirmed" as const,
        },
      })),
    };
    let issueCalls = 0;
    const setup = harness({
      provider,
      managementIssue: async () => {
        issueCalls += 1;
        if (issueCalls === 1) throw new Error("storage timeout");
        return { token: "tapm_v1_management_token_recovered_123" };
      },
    });
    await expect(createPublicBooking(setup.page, inputFixture(), setup.dependencies)).rejects.toMatchObject({
      code: "provider_commit_uncertain",
    });
    expect(commitRequest).not.toBeNull();
    await expect(createPublicBooking(setup.page, inputFixture(), setup.dependencies))
      .resolves.toMatchObject({
        managementUrl: "https://cal.with-tap.ai/manage#tapm_v1_management_token_recovered_123",
      });
    expect(provider.commit).toHaveBeenCalledTimes(1);
    expect(provider.recover).toHaveBeenCalledTimes(1);
  });

  it("creates a tentative provider hold and returns a pending public result", async () => {
    const approvalPage = pageFixture({
      publicSnapshot: { ...publicSnapshot, approvalRequired: true },
    });
    const setup = harness({ page: approvalPage });
    const result = await createPublicBooking(approvalPage, inputFixture(), setup.dependencies);
    expect(result.status).toBe("pending");
    expect(setup.commit).toHaveBeenCalledWith(expect.objectContaining({
      bookingKind: "approval-hold",
      expiresAt: "2026-08-17T12:00:00.000Z",
    }));
    expect(setup.managementIssue).toHaveBeenCalledWith(expect.objectContaining({
      guest: { name: "Guest Person", email: "guest@example.com" },
      approvalExpiresAt: "2026-08-17T12:00:00.000Z",
    }));
    expect([...setup.store.attempts.values()][0]).toMatchObject({
      guest: { name: "Guest Person", email: "guest@example.com" },
      approvalExpiresAt: "2026-08-17T12:00:00.000Z",
    });
  });

  it("reuses the first durable approval expiry when a fresh proof retries an absent commit", async () => {
    let clock = now;
    let commitCalls = 0;
    const provider: PublicBookingProvider = {
      recover: vi.fn(async () => ({ status: "absent" as const })),
      commit: vi.fn(async request => {
        commitCalls += 1;
        if (commitCalls === 1) return { status: "uncertain" as const };
        return {
          status: "committed" as const,
          receipt: {
            operationId: request.operationId,
            commitProof: request.commitProof,
            providerBookingId: "provider-approval-after-absent",
            startsAt: request.startsAt,
            endsAt: request.endsAt,
            status: "tentative" as const,
          },
        };
      }),
    };
    const approvalPage = pageFixture({
      publicSnapshot: { ...publicSnapshot, approvalRequired: true },
    });
    const setup = harness({ page: approvalPage, provider, nowMs: () => clock });
    await expect(createPublicBooking(approvalPage, inputFixture(), setup.dependencies))
      .rejects.toMatchObject({ code: "provider_commit_uncertain" });

    clock += 60_000;
    const refreshedInput = inputFixture({
      slotProof: {
        token: "fresh-signed-slot-token-for-public-create-2",
        claims: {
          ...inputFixture().slotProof.claims,
          iat: Math.floor(clock / 1_000),
          exp: Math.floor(clock / 1_000) + 300,
        },
      },
      turnstile: {
        ...inputFixture().turnstile,
        challengeTimestamp: new Date(clock - 1_000).toISOString(),
      },
    });
    await expect(createPublicBooking(approvalPage, refreshedInput, setup.dependencies))
      .resolves.toMatchObject({ status: "pending" });

    expect(provider.commit).toHaveBeenCalledTimes(2);
    expect(provider.commit).toHaveBeenNthCalledWith(1, expect.objectContaining({
      expiresAt: "2026-08-17T12:00:00.000Z",
    }));
    expect(provider.commit).toHaveBeenNthCalledWith(2, expect.objectContaining({
      expiresAt: "2026-08-17T12:00:00.000Z",
    }));
  });

  it("fails closed on a provider operation-ID collision", async () => {
    const provider: PublicBookingProvider = {
      recover: vi.fn(async () => ({ status: "absent" as const })),
      commit: vi.fn(async () => ({
        status: "conflict" as const,
        reason: "operation-collision" as const,
      })),
    };
    const setup = harness({ provider });
    await expect(createPublicBooking(setup.page, inputFixture(), setup.dependencies)).rejects.toMatchObject({
      status: 503,
      code: "provider_commit_uncertain",
    });
    expect(setup.store.uncertainCodes).toContain("provider_operation_collision");
  });
});
