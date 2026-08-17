import {
  markBookingProfilePublicationPending,
  type BookingProfile,
  type CalendarState,
} from "./domain";
import { publicBookingProfilePublicationFingerprint } from "./public-booking-publication";

const shouldTrackPublication = (
  previous: BookingProfile | undefined,
  next: BookingProfile,
): boolean =>
  next.published ||
  previous?.published === true ||
  next.publication !== undefined ||
  previous?.publication !== undefined ||
  next.pendingPublication !== undefined ||
  previous?.pendingPublication !== undefined;

/**
 * Marks only profiles whose guest-visible or availability snapshot changed.
 * Funnel analytics and other local-only mutations do not churn publication
 * generations. The caller supplies one timestamp for the entire atomic local
 * state mutation.
 */
export function markChangedPublicBookingProfilesPending(
  current: CalendarState,
  next: CalendarState,
  requestedAt: string,
): CalendarState {
  const previousById = new Map(current.bookingProfiles.map(profile => [profile.id, profile]));
  let changed = false;
  const bookingProfiles = next.bookingProfiles.map(profile => {
    const previous = previousById.get(profile.id);
    if (!shouldTrackPublication(previous, profile)) return profile;
    const previousFingerprint = previous === undefined
      ? null
      : publicBookingProfilePublicationFingerprint(current, previous);
    const nextFingerprint = publicBookingProfilePublicationFingerprint(next, profile);
    if (previousFingerprint === nextFingerprint) return profile;
    changed = true;
    return markBookingProfilePublicationPending(profile, requestedAt);
  });
  return changed ? { ...next, bookingProfiles } : next;
}
