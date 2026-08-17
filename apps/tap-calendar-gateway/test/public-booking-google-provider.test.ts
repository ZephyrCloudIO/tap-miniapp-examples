import { describe, expect, it, vi } from "vitest";
import {
  createPublicGoogleBookingProvider,
  type ScopeFirstGoogleBookingService,
} from "../src/public-booking-google-provider";

const scope = {
  workspace: "workspace-public-provider",
  principal: "principal-public-provider",
};
const operationId = `tap${"a".repeat(52)}`;
const commitProof = "a".repeat(43);

describe("public Google booking provider adapter", () => {
  it("passes canonical scope, expanded conflicts, original event times, and hold expiry", async () => {
    const commit = vi.fn<ScopeFirstGoogleBookingService["commit"]>(async input => ({
      status: "committed",
      receipt: {
        operationId: input.providerEventId,
        commitProof: input.requestHash,
        providerBookingId: input.providerEventId,
        startsAt: input.timeMin,
        endsAt: input.timeMax,
        status: "tentative",
      },
    }));
    const service: ScopeFirstGoogleBookingService = {
      commit,
      recover: vi.fn(async () => ({ status: "absent" as const })),
    };
    const provider = createPublicGoogleBookingProvider(service);

    await provider.commit({
      scope,
      destinationCalendarId: "calendar-destination",
      operationId,
      commitProof,
      startsAt: "2026-08-20T18:00:00.000Z",
      endsAt: "2026-08-20T18:30:00.000Z",
      conflictCalendarIds: ["calendar-conflict", "calendar-destination"],
      conflictStart: "2026-08-20T17:45:00.000Z",
      conflictEnd: "2026-08-20T18:40:00.000Z",
      title: "Architecture call",
      description: "Discuss the deployment.",
      location: "google-meet",
      guest: { name: "Guest Person", email: "guest@example.com" },
      bookingKind: "approval-hold",
      conferenceProvider: "none",
      expiresAt: "2026-08-21T12:00:00.000Z",
    });

    expect(commit).toHaveBeenCalledWith({
      scope,
      idempotencyKey: operationId,
      providerEventId: operationId,
      requestHash: commitProof,
      destinationCalendarId: "calendar-destination",
      timeMin: "2026-08-20T18:00:00.000Z",
      timeMax: "2026-08-20T18:30:00.000Z",
      conflictTimeMin: "2026-08-20T17:45:00.000Z",
      conflictTimeMax: "2026-08-20T18:40:00.000Z",
      conflictCalendarIds: ["calendar-conflict", "calendar-destination"],
      title: "Architecture call",
      description: "Discuss the deployment.",
      location: "google-meet",
      bookingKind: "approval-hold",
      attendeeEmails: ["guest@example.com"],
      conferenceProvider: "none",
      expiresAt: "2026-08-21T12:00:00.000Z",
    });
  });

  it("recovers by the same deterministic provider operation and proof without a Request", async () => {
    const recover = vi.fn<ScopeFirstGoogleBookingService["recover"]>(async input => ({
      status: "committed",
      receipt: {
        operationId: input.providerEventId,
        commitProof: input.requestHash,
        providerBookingId: input.providerEventId,
        startsAt: input.timeMin,
        endsAt: input.timeMax,
        status: "confirmed",
      },
    }));
    const provider = createPublicGoogleBookingProvider({
      commit: vi.fn(async () => ({ status: "uncertain" as const })),
      recover,
    });

    await provider.recover({
      scope,
      destinationCalendarId: "calendar-destination",
      operationId,
      commitProof,
      startsAt: "2026-08-20T18:00:00.000Z",
      endsAt: "2026-08-20T18:30:00.000Z",
    });

    expect(recover).toHaveBeenCalledWith({
      scope,
      destinationCalendarId: "calendar-destination",
      providerEventId: operationId,
      requestHash: commitProof,
      timeMin: "2026-08-20T18:00:00.000Z",
      timeMax: "2026-08-20T18:30:00.000Z",
    });
    expect(Object.keys(recover.mock.calls[0]![0])).not.toContain("request");
  });
});
