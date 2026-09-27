import { describe, expect, it } from "@rstest/core";
import { changeBookingProfileAddress } from "./profile-address";
import { createInitialCalendarState } from "./test-fixtures";
import { markChangedPublicBookingProfilesPending } from "./publication-state";
import { markBookingProfilePublicationPending, type BookingProfileServerPublicationReceipt } from "./domain";
import { createCalendarGatewayClient, type PublicBookingProfileRenameInput } from "./gateway";

const now = "2026-09-27T20:30:00.000Z";
function fixture() {
  const initial = createInitialCalendarState();
  const profile = initial.bookingProfiles[0]!;
  return { ...initial, bookingProfiles: [{ ...profile, slug: "alex", publication: { status: "published" as const, generation: 1, reservedSlug: "alex", updatedAt: now },
    eventTypes: profile.eventTypes.map(event => ({ ...event, destinationCalendarId: "cal-google-main", location: "google-meet" as const,
      publication: { reservedSlug: event.slug, generation: 1, revisionId: `revision-${event.id}` } })),
  }] };
}
const receiptFor = (state: ReturnType<typeof fixture>): BookingProfileServerPublicationReceipt => ({ sourceProfileId: state.bookingProfiles[0]!.id,
  status: "published", generation: 2, reservedSlug: "alex-new", updatedAt: now,
  eventTypes: state.bookingProfiles[0]!.eventTypes.map(event => ({ sourceEventTypeId: event.id, reservedSlug: event.slug, revisionId: event.publication.revisionId })),
});

describe("confirmed booking address changes", () => {
  it("applies a confirmed rename without republishing, losing analytics, or changing bookings", async () => {
    let state = fixture(); const original = state; const expected = receiptFor(state);
    const updated = await changeBookingProfileAddress(state.bookingProfiles[0]!, "alex-new", {
      gateway: { renamePublicBookingProfile: async () => expected }, readState: () => state,
      persist: async mutation => { state = markChangedPublicBookingProfilesPending(state, mutation(state), now) as typeof state; return true; },
    });
    expect(updated.slug).toBe("alex-new"); expect(updated.pendingPublication).toBeUndefined();
    expect(updated.eventTypes[0]?.publication?.generation).toBe(2);
    expect(updated.eventTypes[0]?.analytics).toEqual(original.bookingProfiles[0]!.eventTypes[0]!.analytics);
    expect(state.events).toBe(original.events);
  });
  it("retries the identical rename after local persistence fails", async () => {
    let state = fixture(); const original = state; const expected = receiptFor(state); let fail = true;
    const inputs: PublicBookingProfileRenameInput[] = [];
    const adapter = { gateway: { renamePublicBookingProfile: async (input: PublicBookingProfileRenameInput) => { inputs.push(input); return expected; } },
      readState: () => state, persist: async (mutation: (value: typeof state) => unknown) => { if (fail) return false; state = mutation(state) as typeof state; return true; } };
    await expect(changeBookingProfileAddress(original.bookingProfiles[0]!, "alex-new", adapter)).rejects.toThrow("Retry the same address");
    expect(state).toBe(original); fail = false;
    await changeBookingProfileAddress(original.bookingProfiles[0]!, "alex-new", adapter);
    expect(inputs[1]).toEqual(inputs[0]); expect(state.bookingProfiles[0]?.slug).toBe("alex-new");
  });
  it("retains a newer offline intent while the address request is in flight", async () => {
    let state = fixture(); const original = state.bookingProfiles[0]!; const expected = receiptFor(state);
    await changeBookingProfileAddress(original, "alex-new", {
      gateway: { renamePublicBookingProfile: async () => {
        state = { ...state, bookingProfiles: [markBookingProfilePublicationPending({ ...original, published: false }, "2026-09-27T20:31:00.000Z")] } as typeof state;
        return expected;
      } }, readState: () => state,
      persist: async mutation => { state = mutation(state) as typeof state; return true; },
    });
    expect(state.bookingProfiles[0]).toMatchObject({ slug: "alex-new", published: false,
      pendingPublication: { desiredStatus: "unpublished", expectedGeneration: 2, requestedAt: "2026-09-27T20:31:00.000Z" } });
  });
  it("validates the gateway receipt before changing local identity", async () => {
    const state = fixture(); let response = receiptFor(state); const bodies: unknown[] = [];
    const gateway = createCalendarGatewayClient({ baseUrl: "https://calendar-api.theaiplatform.app", workspaceId: "workspace", principalId: "alex",
      transport: async (url, request) => { expect(url).toContain("/v1/publications/profiles/rename"); bodies.push(request.body); return { status: 200, bodyText: JSON.stringify({ publication: response }) }; },
    });
    const input: PublicBookingProfileRenameInput = { schemaVersion: "tap.calendar.profile-rename.v1", sourceProfileId: state.bookingProfiles[0]!.id, previousSlug: "alex", profileSlug: "alex-new", expectedGeneration: 1 };
    await expect(gateway.renamePublicBookingProfile(input)).resolves.toEqual(response);
    response = { ...response, reservedSlug: "unexpected" };
    await expect(gateway.renamePublicBookingProfile(input)).rejects.toMatchObject({ code: "gateway_response_invalid" });
    expect(bodies).toHaveLength(2);
  });
});
