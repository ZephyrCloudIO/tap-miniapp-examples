import { describe, expect, it, vi } from "vitest";
import {
  createPublicGoogleBookingManagementProvider,
  type ScopeFirstGoogleManagementService,
} from "../src/public-booking-google-management";
import type { PublicBookingManagementProviderCommand } from "../src/public-booking-management";

const scope = {
  workspace: "workspace-public-management",
  principal: "principal-public-management",
};
const providerBookingId = `tap${"b".repeat(52)}`;
const providerCommitProof = "a".repeat(43);
const mutationProof = "b".repeat(43);

const cancelInput: PublicBookingManagementProviderCommand = {
  kind: "cancel",
  scope,
  destinationCalendarId: "calendar-destination",
  providerBookingId,
  providerOperationId: providerBookingId,
  operationId: "tapmop_cancel",
  providerCommitProof,
  mutationProof,
  bookingStatus: "confirmed",
  startsAt: "2026-08-20T18:00:00.000Z",
  endsAt: "2026-08-20T18:30:00.000Z",
  newStartsAt: null,
  newEndsAt: null,
  conflictCalendarIds: [],
  conflictStart: null,
  conflictEnd: null,
};

const rescheduleInput: PublicBookingManagementProviderCommand = {
  ...cancelInput,
  kind: "reschedule",
  operationId: "tapmop_reschedule",
  newStartsAt: "2026-08-21T19:00:00.000Z",
  newEndsAt: "2026-08-21T19:30:00.000Z",
  conflictCalendarIds: ["calendar-conflict", "calendar-destination"],
  conflictStart: "2026-08-21T18:45:00.000Z",
  conflictEnd: "2026-08-21T19:40:00.000Z",
};

const committed = (
  input: { readonly operationId: string; readonly providerEventId: string; readonly timeMin: string; readonly timeMax: string },
  status: "cancelled" | "confirmed",
) => ({
  status: "committed" as const,
  receipt: {
    operationId: input.operationId,
    providerBookingId: input.providerEventId,
    startsAt: input.timeMin,
    endsAt: input.timeMax,
    status,
  },
});

const service = (): ScopeFirstGoogleManagementService => ({
  cancel: vi.fn(async input => committed(input, "cancelled")),
  recoverCancellation: vi.fn(async () => ({ status: "absent" as const })),
  reschedule: vi.fn(async input => committed(input, "confirmed")),
  recoverReschedule: vi.fn(async input => committed(input, "confirmed")),
});

describe("public Google guest-management adapter", () => {
  it("cancels using only canonical scope and separate provider/mutation proofs", async () => {
    const google = service();
    const provider = createPublicGoogleBookingManagementProvider(google);

    await provider.cancel(cancelInput);

    expect(google.cancel).toHaveBeenCalledWith({
      scope,
      destinationCalendarId: "calendar-destination",
      providerEventId: providerBookingId,
      providerOperationId: providerBookingId,
      operationId: "tapmop_cancel",
      originalCommitHash: providerCommitProof,
      cancellationHash: mutationProof,
      timeMin: "2026-08-20T18:00:00.000Z",
      timeMax: "2026-08-20T18:30:00.000Z",
      bookingStatus: "confirmed",
    });
    expect(Object.keys(vi.mocked(google.cancel).mock.calls[0]![0])).not.toContain("request");
  });

  it("dispatches cancellation recovery without constructing identity headers", async () => {
    const google = service();
    const provider = createPublicGoogleBookingManagementProvider(google);

    await expect(provider.recover(cancelInput)).resolves.toEqual({ status: "absent" });

    expect(google.recoverCancellation).toHaveBeenCalledOnce();
    expect(google.recoverReschedule).not.toHaveBeenCalled();
    expect(Object.keys(vi.mocked(google.recoverCancellation).mock.calls[0]![0]))
      .not.toContain("request");
  });

  it("passes unbuffered target times separately from the full conflict interval", async () => {
    const google = service();
    const provider = createPublicGoogleBookingManagementProvider(google);

    await provider.reschedule(rescheduleInput);

    expect(google.reschedule).toHaveBeenCalledWith({
      scope,
      destinationCalendarId: "calendar-destination",
      providerEventId: providerBookingId,
      providerOperationId: providerBookingId,
      operationId: "tapmop_reschedule",
      originalCommitHash: providerCommitProof,
      rescheduleHash: mutationProof,
      originalTimeMin: "2026-08-20T18:00:00.000Z",
      originalTimeMax: "2026-08-20T18:30:00.000Z",
      timeMin: "2026-08-21T19:00:00.000Z",
      timeMax: "2026-08-21T19:30:00.000Z",
      conflictCalendarIds: ["calendar-conflict", "calendar-destination"],
      conflictTimeMin: "2026-08-21T18:45:00.000Z",
      conflictTimeMax: "2026-08-21T19:40:00.000Z",
      bookingStatus: "confirmed",
    });
  });

  it("recovers against the exact target and deterministic reschedule hash", async () => {
    const google = service();
    const provider = createPublicGoogleBookingManagementProvider(google);

    await provider.recover(rescheduleInput);

    expect(google.recoverReschedule).toHaveBeenCalledWith(expect.objectContaining({
      providerEventId: providerBookingId,
      rescheduleHash: mutationProof,
      timeMin: "2026-08-21T19:00:00.000Z",
      timeMax: "2026-08-21T19:30:00.000Z",
    }));
    expect(google.recoverCancellation).not.toHaveBeenCalled();
  });

  it("fails closed instead of partially adapting malformed mutation shapes", async () => {
    const google = service();
    const provider = createPublicGoogleBookingManagementProvider(google);

    await expect(provider.reschedule({
      ...rescheduleInput,
      conflictStart: null,
    })).resolves.toEqual({ status: "uncertain" });
    expect(google.reschedule).not.toHaveBeenCalled();
  });
});
