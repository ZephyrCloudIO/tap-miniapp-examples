import { afterEach, describe, expect, it, rs } from "@rstest/core";
import type { MiniAppJsonValue } from "@theaiplatform/miniapp-sdk/sdk";
import type {
  CalendarGatewayBookingCommit,
  CalendarGatewayBookingResolution,
} from "./gateway";
import {
  createProviderBookingOutbox,
  createProviderBookingOutboxWithPort,
  isProviderBookingOutboxSnapshot,
  parseProviderBookingOutboxSnapshot,
  previewProviderBookingOutboxStorageKey,
  ProviderBookingOutboxDataError,
  ProviderBookingOutboxInvariantError,
  providerBookingOutboxStorageAddress,
  type ProviderBookingOutboxPreparation,
  type ProviderBookingOutboxStoragePort,
  type ProviderApprovalResolutionOutboxPreparation,
} from "./provider-booking-outbox";
import { calendarPrincipalStorageAddresses } from "./principal-storage";

const SDK_SLOT = Symbol.for("tap.internal.v1");

const preparation = (
  idempotencyKey = "booking-1",
): ProviderBookingOutboxPreparation => ({
  request: {
    destinationCalendarId: "calendar-primary",
    conflictCalendarIds: ["calendar-shared", "calendar-primary"],
    idempotencyKey,
    title: "Design review",
    start: "2026-08-20T14:00:00.000Z",
    end: "2026-08-20T14:30:00.000Z",
    bookingKind: "meeting",
    attendeeEmails: ["guest@example.com"],
    conferenceProvider: "google-meet",
  },
  reconciliation: {
    kind: "schedule-meeting",
    title: "Design review",
    calendarId: "calendar-primary",
    start: "2026-08-20T14:00:00.000Z",
    end: "2026-08-20T14:30:00.000Z",
    location: "google-meet",
    attendees: [
      {
        id: "guest-1",
        name: "Guest",
        email: "guest@example.com",
        kind: "external",
        required: true,
      },
    ],
    approvalRequired: false,
    requestedAt: "2026-08-15T12:00:00.000Z",
  },
});

const commit = (
  rawProviderEventId = "google-raw-event-1",
  idempotentReplay = false,
): CalendarGatewayBookingCommit => ({
  booking: {
    state: "committed",
    provider: "google",
    providerEventId: rawProviderEventId,
    destinationCalendarId: "calendar-primary",
    bookingKind: "meeting",
    approvalStatus: null,
    pendingAttendeeEmails: [],
    approvalExpiresAt: null,
    providerHtmlLink: "https://calendar.google.com/event?eid=one",
    providerJoinUrl: "https://meet.google.com/abc-defg-hij",
    conferenceStatus: "ready",
    event: {
      id: `tap-normalized:${rawProviderEventId}`,
      calendarId: "calendar-primary",
      title: "Design review",
      start: "2026-08-20T14:00:00.000Z",
      end: "2026-08-20T14:30:00.000Z",
      kind: "meeting",
      status: "confirmed",
      location: "google-meet",
      attendees: [
        {
          id: "guest@example.com",
          name: "guest@example.com",
          email: "guest@example.com",
          kind: "external",
          required: true,
        },
      ],
      providerHtmlLink: "https://calendar.google.com/event?eid=one",
      providerJoinUrl: "https://meet.google.com/abc-defg-hij",
    },
  },
  committedAt: "2026-08-15T12:00:01.000Z",
  idempotentReplay,
  concurrencyBoundary: "tap-conflict-calendar-set-serialized",
});

const holdPreparation = (): ProviderBookingOutboxPreparation => ({
  request: {
    destinationCalendarId: "calendar-primary",
    conflictCalendarIds: ["calendar-primary"],
    idempotencyKey: "booking-hold-1",
    title: "Partner review",
    start: "2026-08-20T20:00:00Z",
    end: "2026-08-20T20:30:00Z",
    bookingKind: "approval-hold",
    location: "Google Meet",
    attendeeEmails: ["partner@example.com"],
    conferenceProvider: "none",
    expiresAt: "2026-08-16T20:00:00Z",
  },
  reconciliation: {
    kind: "schedule-meeting",
    title: "Partner review",
    calendarId: "calendar-primary",
    start: "2026-08-20T20:00:00Z",
    end: "2026-08-20T20:30:00Z",
    location: "google-meet",
    attendees: [{
      id: "partner-1",
      name: "Partner",
      email: "partner@example.com",
      kind: "external",
      required: true,
    }],
    approvalRequired: true,
    requestedAt: "2026-08-15T20:00:00Z",
  },
});

const holdCommit = (): CalendarGatewayBookingCommit => ({
  booking: {
    state: "committed",
    provider: "google",
    providerEventId: "google-raw-hold-1",
    destinationCalendarId: "calendar-primary",
    bookingKind: "approval-hold",
    approvalStatus: "pending",
    pendingAttendeeEmails: ["partner@example.com"],
    approvalExpiresAt: "2026-08-16T20:00:00.000Z",
    providerHtmlLink: "https://calendar.google.com/event?eid=hold",
    providerJoinUrl: null,
    conferenceStatus: "none",
    event: {
      id: "tap-normalized:google-raw-hold-1",
      calendarId: "calendar-primary",
      title: "Pending approval: Partner review",
      start: "2026-08-20T20:00:00.000Z",
      end: "2026-08-20T20:30:00.000Z",
      kind: "hold",
      status: "pending",
      location: "physical",
      attendees: [],
      providerHtmlLink: "https://calendar.google.com/event?eid=hold",
    },
  },
  committedAt: "2026-08-15T12:00:01.000Z",
  idempotentReplay: false,
  concurrencyBoundary: "tap-conflict-calendar-set-serialized",
});

const approvalPreparation = (
  decision: "approve" | "decline" = "approve",
): ProviderApprovalResolutionOutboxPreparation => ({
  bookingIdempotencyKey: "booking-hold-1",
  request: {
    idempotencyKey: `resolution-${decision}-1`,
    decision,
    ...(decision === "approve"
      ? {
          title: "Partner review",
          attendeeEmails: ["partner@example.com"],
          conferenceProvider: "google-meet" as const,
          conflictCalendarIds: ["calendar-primary"],
        }
      : {}),
  },
  reconciliation: {
    bookingRequestId: "booking-hold-1",
    decision,
    expectedEvent: {
      id: "tap-normalized:google-raw-hold-1",
      title: "Partner review",
      calendarId: "calendar-primary",
      start: "2026-08-20T20:00:00.000Z",
      end: "2026-08-20T20:30:00.000Z",
      kind: "hold",
      status: "pending",
      location: "google-meet",
      attendees: [{
        id: "partner-1",
        name: "Partner",
        email: "partner@example.com",
        kind: "external",
        required: true,
      }],
    },
  },
});

const resolution = (
  decision: "approve" | "decline" = "approve",
  idempotentReplay = false,
): CalendarGatewayBookingResolution => ({
  resolution: {
    state: "committed",
    decision: decision === "approve" ? "approved" : "declined",
    bookingIdempotencyKey: "booking-hold-1",
    providerEventId: "google-raw-hold-1",
    providerEventRemoved: decision === "decline",
    providerJoinUrl: decision === "approve"
      ? "https://meet.google.com/abc-defg-hij"
      : null,
    event: decision === "approve"
      ? {
          id: "tap-normalized:google-raw-hold-1",
          calendarId: "calendar-primary",
          title: "Partner review",
          start: "2026-08-20T20:00:00.000Z",
          end: "2026-08-20T20:30:00.000Z",
          kind: "meeting",
          status: "confirmed",
          location: "google-meet",
          attendees: [{
            id: "partner@example.com",
            name: "partner@example.com",
            email: "partner@example.com",
            kind: "external",
            required: true,
          }],
          providerJoinUrl: "https://meet.google.com/abc-defg-hij",
        }
      : null,
  },
  resolvedAt: "2026-08-15T13:00:00.000Z",
  idempotentReplay,
});

class MemoryPort implements ProviderBookingOutboxStoragePort {
  value: MiniAppJsonValue | null = null;
  revision: number | null = null;
  readonly writes: Array<{
    readonly expectedRevision: number | null;
    readonly value: MiniAppJsonValue;
  }> = [];

  async get(_address?: typeof providerBookingOutboxStorageAddress) {
    return { value: this.value, revision: this.revision };
  }

  async set(input: {
    readonly value: MiniAppJsonValue;
    readonly expectedRevision: number | null;
  }) {
    if (input.expectedRevision !== this.revision) {
      throw new Error("expected revision conflict");
    }
    this.revision = (this.revision ?? 0) + 1;
    this.value = JSON.parse(JSON.stringify(input.value)) as MiniAppJsonValue;
    this.writes.push({
      expectedRevision: input.expectedRevision,
      value: input.value,
    });
    return { revision: this.revision };
  }
}

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, SDK_SLOT);
  Reflect.deleteProperty(globalThis, "localStorage");
  Reflect.deleteProperty(
    globalThis,
    "__TAP_CALENDAR_LEGACY_OWNER_PRINCIPAL_ID__",
  );
});

describe("provider booking outbox", () => {
  it("preserves RSVP and viewer identity through durable provider recovery", async () => {
    const port = new MemoryPort();
    const outbox = createProviderBookingOutboxWithPort(port);
    await outbox.putBeforeProviderCall(preparation());
    const receipt = commit();
    const attendees = receipt.booking.event.attendees.map(attendee => ({
      ...attendee, responseStatus: "needsAction" as const, isCurrentUser: true,
    }));
    await outbox.markProviderCommitted("booking-1", {
      ...receipt, booking: { ...receipt.booking, event: { ...receipt.booking.event, attendees } },
    });
    const [reloaded] = await createProviderBookingOutboxWithPort(port).listPendingReconciliation();
    expect(reloaded?.providerCommit.booking.event.attendees).toEqual(attendees);
  });

  it("persists and recovers a personal event without guests or conferencing", async () => {
    const port = new MemoryPort();
    const outbox = createProviderBookingOutboxWithPort(port);
    const base = preparation("personal-event");
    if (base.reconciliation.kind === "work-block") throw new Error("Expected a meeting fixture.");
    const personal: ProviderBookingOutboxPreparation = {
      request: { ...base.request, attendeeEmails: [], conferenceProvider: "none" },
      reconciliation: { ...base.reconciliation, kind: "schedule-meeting", location: null, attendees: [] },
    };
    const prepared = await outbox.putBeforeProviderCall(personal);
    const reloaded = createProviderBookingOutboxWithPort(port);
    expect(await reloaded.listAwaitingProvider()).toEqual([prepared]);

    const provider = commit();
    const { providerJoinUrl: _joinUrl, ...event } = provider.booking.event;
    const committed = await reloaded.markProviderCommitted("personal-event", {
      ...provider,
      booking: {
        ...provider.booking,
        conferenceStatus: "none",
        providerJoinUrl: null,
        event: { ...event, location: null, attendees: [], busy: true },
      },
    });
    expect(await createProviderBookingOutboxWithPort(port).listPendingReconciliation()).toEqual([committed]);
    await expect(outbox.putBeforeProviderCall({
      ...personal,
      request: { ...personal.request, idempotencyKey: "invalid-conference", conferenceProvider: "google-meet" },
    })).rejects.toThrow("The provider location does not match local reconciliation.");
  });

  it("durably prepares before a provider call, commits, lists, and removes", async () => {
    const port = new MemoryPort();
    let tick = 0;
    const outbox = createProviderBookingOutboxWithPort(
      port,
      () => `2026-08-15T12:00:0${tick++}.000Z`,
    );

    const prepared = await outbox.putBeforeProviderCall(preparation());
    expect(prepared.phase).toBe("prepared");
    expect(port.writes).toHaveLength(1);
    expect(port.writes[0]?.expectedRevision).toBeNull();
    expect(await outbox.listAwaitingProvider()).toEqual([prepared]);
    expect(await outbox.listPendingReconciliation()).toEqual([]);

    const committed = await outbox.markProviderCommitted("booking-1", commit());
    expect(committed.phase).toBe("provider-committed");
    expect(committed.providerCommit.booking.providerEventId).toBe("google-raw-event-1");
    expect(committed.providerCommit.booking.event.id).toBe(
      "tap-normalized:google-raw-event-1",
    );
    expect(await outbox.listAwaitingProvider()).toEqual([]);
    expect(await outbox.listPendingReconciliation()).toEqual([committed]);

    await expect(
      outbox.removeAfterLocalReconciliation("booking-1", "google-raw-event-1"),
    ).rejects.toBeInstanceOf(ProviderBookingOutboxInvariantError);
    await expect(
      outbox.removeAfterLocalReconciliation(
        "booking-1",
        "tap-normalized:google-raw-event-1",
      ),
    ).resolves.toBe(true);
    await expect(
      outbox.removeAfterLocalReconciliation(
        "booking-1",
        "tap-normalized:google-raw-event-1",
      ),
    ).resolves.toBe(false);
    expect((await outbox.load()).records).toEqual([]);
  });

  it("uses the exact TAP storage address and returns an existing durable preparation", async () => {
    let value: MiniAppJsonValue | null = null;
    let revision: number | null = null;
    const get = rs.fn(async () => ({ value, revision }));
    const set = rs.fn(async (input: {
      readonly value: MiniAppJsonValue;
      readonly expectedRevision: number | null;
    }) => {
      value = input.value;
      revision = (revision ?? 0) + 1;
      return { revision };
    });
    Reflect.set(globalThis, SDK_SLOT, { storage: { get, set } });
    const outbox = createProviderBookingOutbox(false, "user-alex");

    const first = await outbox.putBeforeProviderCall(preparation());
    const replay = await outbox.putBeforeProviderCall(preparation());

    expect(replay).toEqual(first);
    const address = calendarPrincipalStorageAddresses("user-alex").bookingOutbox;
    expect(get).toHaveBeenCalledWith(address);
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      ...address,
      expectedRevision: null,
    }));
  });

  it("CAS-copies the legacy outbox into the configured owner's personal storage", async () => {
    const principalId = "legacy-owner";
    const personalAddress = calendarPrincipalStorageAddresses(principalId).bookingOutbox;
    const legacySnapshot = {
      schemaVersion: 1,
      records: [],
      resolutions: [],
    } satisfies MiniAppJsonValue;
    let personalValue: MiniAppJsonValue | null = null;
    let personalRevision: number | null = null;
    const get = rs.fn(async (address: typeof providerBookingOutboxStorageAddress) => {
      if (address.key === providerBookingOutboxStorageAddress.key) {
        return { value: legacySnapshot, revision: 7 };
      }
      return { value: personalValue, revision: personalRevision };
    });
    const set = rs.fn(async (input: {
      readonly key: string;
      readonly value: MiniAppJsonValue;
      readonly expectedRevision: number | null;
    }) => {
      expect(input.key).toBe(personalAddress.key);
      expect(input.expectedRevision).toBeNull();
      personalValue = input.value;
      personalRevision = 1;
      return { revision: 1 };
    });
    Reflect.set(globalThis, SDK_SLOT, { storage: { get, set } });
    Reflect.set(
      globalThis,
      "__TAP_CALENDAR_LEGACY_OWNER_PRINCIPAL_ID__",
      principalId,
    );

    const outbox = createProviderBookingOutbox(false, principalId);
    await expect(outbox.load()).resolves.toEqual(legacySnapshot);
    await expect(outbox.load()).resolves.toEqual(legacySnapshot);

    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith({
      ...personalAddress,
      expectedRevision: null,
      value: legacySnapshot,
    });
  });

  it("replays a mutation against fresh state after a CAS conflict", async () => {
    const port = new MemoryPort();
    const first = createProviderBookingOutboxWithPort(
      port,
      () => "2026-08-15T12:00:00.000Z",
    );
    await first.putBeforeProviderCall(preparation("external-booking"));

    let conflictInjected = false;
    const conflictingPort: ProviderBookingOutboxStoragePort = {
      get: address => port.get(address),
      async set(input) {
        if (!conflictInjected) {
          conflictInjected = true;
          await first.putBeforeProviderCall(preparation("concurrent-booking"));
        }
        return await port.set(input);
      },
    };
    const outbox = createProviderBookingOutboxWithPort(
      conflictingPort,
      () => "2026-08-15T12:00:01.000Z",
    );

    await outbox.putBeforeProviderCall(preparation("our-booking"));

    expect(
      (await outbox.load()).records
        .map(record => record.idempotencyKey)
        .sort(),
    ).toEqual(["concurrent-booking", "external-booking", "our-booking"]);
  });

  it("keeps a committed record while accepting an idempotent provider replay", async () => {
    const port = new MemoryPort();
    let tick = 0;
    const outbox = createProviderBookingOutboxWithPort(
      port,
      () => `2026-08-15T12:00:0${tick++}.000Z`,
    );
    await outbox.putBeforeProviderCall(preparation());
    await outbox.markProviderCommitted("booking-1", commit());

    const replay = await outbox.markProviderCommitted(
      "booking-1",
      commit("google-raw-event-1", true),
    );

    expect(replay.providerCommit.idempotentReplay).toBe(true);
    expect((await outbox.listPendingReconciliation())).toHaveLength(1);
    await expect(
      outbox.markProviderCommitted("booking-1", commit("google-raw-event-2")),
    ).rejects.toBeInstanceOf(ProviderBookingOutboxInvariantError);
  });

  it("does not discard a committed provider booking as a failed request", async () => {
    const port = new MemoryPort();
    const outbox = createProviderBookingOutboxWithPort(
      port,
      () => "2026-08-15T12:00:00.000Z",
    );
    await outbox.putBeforeProviderCall(preparation());
    await expect(
      outbox.discardPreparedAfterDefinitiveProviderFailure("booking-1"),
    ).resolves.toBe(true);

    await outbox.putBeforeProviderCall(preparation());
    await outbox.markProviderCommitted("booking-1", commit());
    await expect(
      outbox.discardPreparedAfterDefinitiveProviderFailure("booking-1"),
    ).rejects.toBeInstanceOf(ProviderBookingOutboxInvariantError);
  });

  it("rejects mismatched preparations and provider responses", async () => {
    const outbox = createProviderBookingOutboxWithPort(
      new MemoryPort(),
      () => "2026-08-15T12:00:00.000Z",
    );
    const mismatched = preparation();
    await expect(outbox.putBeforeProviderCall({
      ...mismatched,
      reconciliation: {
        ...mismatched.reconciliation,
        title: "Different meeting",
      },
    })).rejects.toBeInstanceOf(ProviderBookingOutboxInvariantError);

    await outbox.putBeforeProviderCall(preparation());
    await expect(outbox.markProviderCommitted("booking-1", {
      ...commit(),
      booking: {
        ...commit().booking,
        destinationCalendarId: "another-calendar",
      },
    })).rejects.toBeInstanceOf(ProviderBookingOutboxInvariantError);
  });

  it("persists a bounded conflict-check range containing the booking", async () => {
    const outbox = createProviderBookingOutboxWithPort(
      new MemoryPort(),
      () => "2026-08-15T12:00:00.000Z",
    );
    const expanded = preparation("booking-with-buffers");
    const prepared = await outbox.putBeforeProviderCall({
      ...expanded,
      request: {
        ...expanded.request,
        conflictTimeMin: "2026-08-20T13:45:00.000Z",
        conflictTimeMax: "2026-08-20T14:45:00.000Z",
      },
    });
    expect(prepared.request).toMatchObject({
      conflictTimeMin: "2026-08-20T13:45:00.000Z",
      conflictTimeMax: "2026-08-20T14:45:00.000Z",
    });

    const invalid = preparation("booking-with-invalid-buffers");
    await expect(outbox.putBeforeProviderCall({
      ...invalid,
      request: {
        ...invalid.request,
        conflictTimeMin: "2026-08-20T14:15:00.000Z",
        conflictTimeMax: "2026-08-20T14:45:00.000Z",
      },
    })).rejects.toBeInstanceOf(ProviderBookingOutboxInvariantError);
  });

  it("accepts the gateway's raw/normalized IDs, prefixed hold title, and early approval deadline", async () => {
    const outbox = createProviderBookingOutboxWithPort(
      new MemoryPort(),
      () => "2026-08-15T12:00:00.000Z",
    );

    const prepared = await outbox.putBeforeProviderCall(holdPreparation());
    expect(prepared.request.expiresAt).toBe("2026-08-16T20:00:00.000Z");
    expect(Date.parse(prepared.request.expiresAt!)).toBeLessThan(
      Date.parse(prepared.request.start),
    );

    const committed = await outbox.markProviderCommitted(
      "booking-hold-1",
      holdCommit(),
    );
    expect(committed.providerCommit.booking.providerEventId).toBe(
      "google-raw-hold-1",
    );
    expect(committed.providerCommit.booking.event.id).toBe(
      "tap-normalized:google-raw-hold-1",
    );
    await expect(
      outbox.removeAfterLocalReconciliation(
        "booking-hold-1",
        "tap-normalized:google-raw-hold-1",
      ),
    ).resolves.toBe(true);
  });

  it("binds recovery location and approval metadata to the prepared provider request", async () => {
    const create = () => createProviderBookingOutboxWithPort(
      new MemoryPort(),
      () => "2026-08-15T12:00:00.000Z",
    );
    const mismatchedConference = preparation();
    await expect(create().putBeforeProviderCall({
      ...mismatchedConference,
      request: {
        ...mismatchedConference.request,
        conferenceProvider: "none",
        location: "Physical location",
      },
    })).rejects.toBeInstanceOf(ProviderBookingOutboxInvariantError);

    const expired = holdPreparation();
    await expect(create().putBeforeProviderCall({
      ...expired,
      request: { ...expired.request, expiresAt: "2026-08-15T11:59:59Z" },
    })).rejects.toBeInstanceOf(ProviderBookingOutboxInvariantError);

    const wrongLocalDeadline = holdPreparation();
    await expect(create().putBeforeProviderCall({
      ...wrongLocalDeadline,
      request: {
        ...wrongLocalDeadline.request,
        expiresAt: "2026-08-16T21:00:00Z",
      },
    })).rejects.toBeInstanceOf(ProviderBookingOutboxInvariantError);

    const attendeeMismatch = create();
    await attendeeMismatch.putBeforeProviderCall(holdPreparation());
    const mismatchedCommit = holdCommit();
    await expect(attendeeMismatch.markProviderCommitted("booking-hold-1", {
      ...mismatchedCommit,
      booking: {
        ...mismatchedCommit.booking,
        pendingAttendeeEmails: ["someone-else@example.com"],
      },
    })).rejects.toBeInstanceOf(ProviderBookingOutboxInvariantError);

    await expect(attendeeMismatch.markProviderCommitted("booking-hold-1", {
      ...mismatchedCommit,
      booking: {
        ...mismatchedCommit.booking,
        approvalExpiresAt: "2026-08-17T20:00:00.000Z",
      },
    })).rejects.toBeInstanceOf(ProviderBookingOutboxInvariantError);
  });

  it("rejects provider booking attendee, location, conference, and link drift", async () => {
    const prepareOutbox = async () => {
      const outbox = createProviderBookingOutboxWithPort(
        new MemoryPort(),
        () => "2026-08-15T12:00:00.000Z",
      );
      await outbox.putBeforeProviderCall(preparation());
      return outbox;
    };
    const attendeeDrift = commit();
    await expect((await prepareOutbox()).markProviderCommitted("booking-1", {
      ...attendeeDrift,
      booking: {
        ...attendeeDrift.booking,
        event: { ...attendeeDrift.booking.event, attendees: [] },
      },
    })).rejects.toBeInstanceOf(ProviderBookingOutboxInvariantError);

    const locationDrift = commit();
    await expect((await prepareOutbox()).markProviderCommitted("booking-1", {
      ...locationDrift,
      booking: {
        ...locationDrift.booking,
        event: { ...locationDrift.booking.event, location: "physical" },
      },
    })).rejects.toBeInstanceOf(ProviderBookingOutboxInvariantError);

    const linkDrift = commit();
    await expect((await prepareOutbox()).markProviderCommitted("booking-1", {
      ...linkDrift,
      booking: {
        ...linkDrift.booking,
        event: {
          ...linkDrift.booking.event,
          providerJoinUrl: "https://meet.google.com/different-room",
        },
      },
    })).rejects.toBeInstanceOf(ProviderBookingOutboxInvariantError);

    const holdWithAttendee = holdCommit();
    const holdOutbox = createProviderBookingOutboxWithPort(
      new MemoryPort(),
      () => "2026-08-15T12:00:00.000Z",
    );
    await holdOutbox.putBeforeProviderCall(holdPreparation());
    await expect(holdOutbox.markProviderCommitted("booking-hold-1", {
      ...holdWithAttendee,
      booking: {
        ...holdWithAttendee.booking,
        event: {
          ...holdWithAttendee.booking.event,
          attendees: [{
            id: "partner@example.com",
            name: "partner@example.com",
            email: "partner@example.com",
            kind: "external",
            required: true,
          }],
        },
      },
    })).rejects.toBeInstanceOf(ProviderBookingOutboxInvariantError);
  });

  it("durably reconciles an approved provider hold resolution", async () => {
    const port = new MemoryPort();
    let tick = 0;
    const outbox = createProviderBookingOutboxWithPort(
      port,
      () => `2026-08-15T13:00:0${tick++}.000Z`,
    );

    const prepared = await outbox.putApprovalResolutionBeforeProviderCall(
      approvalPreparation(),
    );
    expect(prepared.phase).toBe("prepared");
    expect(await outbox.listApprovalResolutionsAwaitingProvider()).toEqual([
      prepared,
    ]);

    const committed = await outbox.markApprovalResolutionCommitted(
      "resolution-approve-1",
      resolution(),
    );
    expect(committed.providerResolution.resolution.providerEventId).toBe(
      "google-raw-hold-1",
    );
    expect(committed.providerResolution.resolution.event?.id).toBe(
      "tap-normalized:google-raw-hold-1",
    );
    expect(await outbox.listPendingApprovalResolutionReconciliation()).toEqual([
      committed,
    ]);

    await expect(
      outbox.removeApprovalResolutionAfterLocalReconciliation(
        "resolution-approve-1",
        "google-raw-hold-1",
      ),
    ).rejects.toBeInstanceOf(ProviderBookingOutboxInvariantError);
    await expect(
      outbox.removeApprovalResolutionAfterLocalReconciliation(
        "resolution-approve-1",
        "tap-normalized:google-raw-hold-1",
      ),
    ).resolves.toBe(true);
    expect((await outbox.load()).resolutions).toEqual([]);
  });

  it("supports durable decline resolution and rejects a different local decision", async () => {
    const outbox = createProviderBookingOutboxWithPort(
      new MemoryPort(),
      () => "2026-08-15T13:00:00.000Z",
    );
    await outbox.putApprovalResolutionBeforeProviderCall(
      approvalPreparation("decline"),
    );
    await expect(outbox.markApprovalResolutionCommitted(
      "resolution-decline-1",
      resolution("approve"),
    )).rejects.toBeInstanceOf(ProviderBookingOutboxInvariantError);

    const declineWithJoin = resolution("decline");
    await expect(outbox.markApprovalResolutionCommitted(
      "resolution-decline-1",
      {
        ...declineWithJoin,
        resolution: {
          ...declineWithJoin.resolution,
          providerJoinUrl: "https://meet.google.com/should-not-exist",
        },
      },
    )).rejects.toBeInstanceOf(ProviderBookingOutboxInvariantError);

    const declined = await outbox.markApprovalResolutionCommitted(
      "resolution-decline-1",
      resolution("decline"),
    );
    expect(declined.providerResolution.resolution).toMatchObject({
      providerEventId: "google-raw-hold-1",
      providerEventRemoved: true,
      event: null,
    });
  });

  it("validates the approved Event fingerprint but permits pending Google Meet provisioning", async () => {
    const create = async () => {
      const outbox = createProviderBookingOutboxWithPort(
        new MemoryPort(),
        () => "2026-08-15T13:00:00.000Z",
      );
      await outbox.putApprovalResolutionBeforeProviderCall(
        approvalPreparation(),
      );
      return outbox;
    };

    const wrongTitle = resolution();
    await expect((await create()).markApprovalResolutionCommitted(
      "resolution-approve-1",
      {
        ...wrongTitle,
        resolution: {
          ...wrongTitle.resolution,
          event: { ...wrongTitle.resolution.event!, title: "Different meeting" },
        },
      },
    )).rejects.toBeInstanceOf(ProviderBookingOutboxInvariantError);

    const wrongAttendee = resolution();
    await expect((await create()).markApprovalResolutionCommitted(
      "resolution-approve-1",
      {
        ...wrongAttendee,
        resolution: {
          ...wrongAttendee.resolution,
          event: { ...wrongAttendee.resolution.event!, attendees: [] },
        },
      },
    )).rejects.toBeInstanceOf(ProviderBookingOutboxInvariantError);

    const ready = resolution();
    const { providerJoinUrl: _providerJoinUrl, ...eventWithoutJoin } =
      ready.resolution.event!;
    const pendingMeet: CalendarGatewayBookingResolution = {
      ...ready,
      resolution: {
        ...ready.resolution,
        providerJoinUrl: null,
        event: { ...eventWithoutJoin, location: null },
      },
    };
    const pending = await (await create()).markApprovalResolutionCommitted(
      "resolution-approve-1",
      pendingMeet,
    );
    expect(pending.providerResolution.resolution).toMatchObject({
      providerJoinUrl: null,
      event: { location: null },
    });

    const pendingWithLiteralLocation = await (
      await create()
    ).markApprovalResolutionCommitted(
      "resolution-approve-1",
      {
        ...pendingMeet,
        resolution: {
          ...pendingMeet.resolution,
          event: { ...pendingMeet.resolution.event!, location: "physical" },
        },
      },
    );
    expect(pendingWithLiteralLocation.providerResolution.resolution.event?.location)
      .toBe("physical");
  });

  it("fails closed on invalid or oversized stored state", () => {
    expect(isProviderBookingOutboxSnapshot({ schemaVersion: 2, records: [] })).toBe(false);
    expect(() => parseProviderBookingOutboxSnapshot({
      schemaVersion: 1,
      records: Array.from({ length: 49 }, () => ({})),
    })).toThrow(ProviderBookingOutboxDataError);
    expect(() => parseProviderBookingOutboxSnapshot({
      schemaVersion: 1,
      records: [{
        phase: "prepared",
        idempotencyKey: "bad",
        request: { ...preparation().request, idempotencyKey: "different" },
        reconciliation: preparation().reconciliation,
        createdAt: "2026-08-15T12:00:00.000Z",
        updatedAt: "2026-08-15T12:00:00.000Z",
      }],
    })).toThrow(ProviderBookingOutboxDataError);
  });

  it("uses a revisioned localStorage envelope in preview", async () => {
    const storage = new MemoryStorage();
    Reflect.set(globalThis, "localStorage", storage);
    const outbox = createProviderBookingOutbox(true, "user-alex");

    await outbox.putBeforeProviderCall(preparation());
    const raw = storage.getItem(
      `${previewProviderBookingOutboxStorageKey}:user-alex`,
    );

    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toMatchObject({
      revision: 1,
      value: { schemaVersion: 1 },
    });
    expect(
      (await createProviderBookingOutbox(true, "user-alex").load()).records,
    ).toHaveLength(1);
  });
});
