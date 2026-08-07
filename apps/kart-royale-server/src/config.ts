/** Kart Royale always renders this many grid slots, including AI backfill. */
export const DEFAULT_RACE_FIELD_SIZE = 8;

/**
 * Resolve the shared room/game field size. Invalid or oversized configuration
 * falls back to the eight karts the client can actually simulate.
 */
export function raceFieldSize(raw: unknown): number {
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= DEFAULT_RACE_FIELD_SIZE
    ? parsed
    : DEFAULT_RACE_FIELD_SIZE;
}
