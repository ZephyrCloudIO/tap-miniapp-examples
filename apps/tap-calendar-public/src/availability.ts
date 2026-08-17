import type {
  PublicBookingAvailability,
  PublicBookingSlot,
} from "./contracts";

const REFRESH_LEAD_MAX_MS = 5_000;
const REFRESH_LEAD_MIN_MS = 250;
const EXPIRED_RETRY_MS = 1_000;
const MAX_TIMER_DELAY_MS = 2_147_000_000;

/**
 * Refresh shortly before the server proof expires. Very short-lived responses
 * refresh immediately; an already-expired response backs off to avoid a hot
 * retry loop while the service recovers.
 */
export function availabilityRefreshDelay(expiresAt: string, now = Date.now()): number {
  const expiration = Date.parse(expiresAt);
  if (!Number.isFinite(expiration)) throw new Error("Availability expiration is invalid.");
  const remaining = expiration - now;
  if (remaining <= 0) return EXPIRED_RETRY_MS;
  const lead = Math.min(
    REFRESH_LEAD_MAX_MS,
    Math.max(REFRESH_LEAD_MIN_MS, Math.floor(remaining / 10)),
  );
  return Math.min(MAX_TIMER_DELAY_MS, Math.max(0, remaining - lead));
}

export interface AvailabilitySelectionReconciliation {
  readonly dateAvailable: boolean;
  readonly slot: PublicBookingSlot | null;
}

/** Match by the stable interval because every availability refresh rotates its proof token. */
export function reconcileAvailabilitySelection(
  availability: PublicBookingAvailability,
  selectedDate: string | null,
  selectedSlot: PublicBookingSlot | null,
): AvailabilitySelectionReconciliation {
  if (!selectedDate) return { dateAvailable: false, slot: null };
  const date = availability.dates.find(candidate => candidate.date === selectedDate);
  if (!date) return { dateAvailable: false, slot: null };
  if (!selectedSlot) return { dateAvailable: true, slot: null };
  return {
    dateAvailable: true,
    slot: date.slots.find(candidate =>
      candidate.start === selectedSlot.start && candidate.end === selectedSlot.end
    ) ?? null,
  };
}
