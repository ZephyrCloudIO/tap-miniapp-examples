import { applyPublicBookingProfilePublicationReceipt, deriveBookingProfilePublicationState, validateSlug, type BookingProfile, type CalendarState } from "./domain";
import type { CalendarGatewayClient } from "./gateway";

export async function changeBookingProfileAddress(profile: BookingProfile, slug: string, adapter: {
  readonly gateway: Pick<CalendarGatewayClient, "renamePublicBookingProfile">;
  readonly readState: () => CalendarState | null;
  readonly persist: (mutation: (state: CalendarState) => CalendarState) => Promise<boolean>;
}): Promise<BookingProfile> {
  const invalid = validateSlug(slug);
  if (invalid) throw new Error(invalid);
  const current = adapter.readState()?.bookingProfiles.find(item => item.id === profile.id);
  if (!current?.publication || current.slug !== profile.slug || current.publication.generation !== profile.publication?.generation) {
    throw new Error("This profile changed. Reopen its settings before changing the address.");
  }
  if (deriveBookingProfilePublicationState(current).pending) {
    throw new Error("Finish the pending profile update before changing its address.");
  }
  const receipt = await adapter.gateway.renamePublicBookingProfile({
    schemaVersion: "tap.calendar.profile-rename.v1", sourceProfileId: current.id,
    previousSlug: current.slug, profileSlug: slug, expectedGeneration: current.publication.generation,
  });
  // null acknowledges no pending publication: an edit made during this request must survive.
  const saved = await adapter.persist(state => applyPublicBookingProfilePublicationReceipt(state, receipt, null));
  if (!saved) throw new Error("The address changed, but Calendar could not save the result. Retry the same address to finish syncing.");
  const updated = adapter.readState()?.bookingProfiles.find(item => item.id === current.id);
  if (!updated || updated.slug !== slug) throw new Error("The profile changed while saving. Reopen its settings to see the latest address.");
  return updated;
}
