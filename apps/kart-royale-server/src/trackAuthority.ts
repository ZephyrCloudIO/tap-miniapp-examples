/**
 * ============================================================================
 *  TRACK AUTHORITY
 * ============================================================================
 *  The server's view of the circuit: the exact same TrackMath the game runs,
 *  so a claimed checkpoint is validated against the geometry the client was
 *  actually driving on. The centreline table is baked once per isolate and
 *  shared by every RaceRoom instance.
 *
 *  Validation is deliberately a *consistency* check, not a simulation: the
 *  hybrid model lets clients own their kart motion, and the server rejects
 *  claims the shared math proves impossible (wrong zone, wrong order,
 *  teleporting progress).
 * ============================================================================
 */
import { TrackMath } from '@tap-examples/kart-royale/track-math';

let cached: TrackMath | null = null;

/** Shared, immutable-after-construction track math for this isolate. */
export function trackMath(): TrackMath {
  cached ??= new TrackMath();
  return cached;
}

/** Fraction of a checkpoint zone on either side of a boundary where the probe
 *  may legitimately quantise into the neighbouring zone. */
const ZONE_EDGE_FRACTION = 0.1;

/**
 * Validate a checkpoint claim against the kart's latest reported position.
 * `claimedCp` must equal the checkpoint zone the position probes to, with a
 * small tolerance band at zone edges (the client reports after crossing,
 * network delay means the probe can land just past the boundary).
 */
export function checkpointClaimConsistent(
  claimedCp: number,
  pos: [number, number, number],
): boolean {
  const math = trackMath();
  const probe = math.probe(pos[0], pos[1], pos[2], -1);
  const zone = math.checkpointAt(probe.t);
  if (zone === claimedCp) return true;
  const frac = probe.t * math.checkpointCount;
  const nearest = Math.round(frac);
  if (Math.abs(frac - nearest) > ZONE_EDGE_FRACTION) return false;
  const lower = (((nearest - 1) % math.checkpointCount) + math.checkpointCount) % math.checkpointCount;
  const upper = nearest % math.checkpointCount;
  return claimedCp === lower || claimedCp === upper;
}

/** Plain world bounds, padded — coarse plausibility clamp for kart states. */
export function positionPlausible(pos: [number, number, number], pad = 40): boolean {
  const { min, max } = trackMath().boundsPlain();
  return (
    pos[0] >= min[0] - pad && pos[0] <= max[0] + pad &&
    pos[1] >= min[1] - pad && pos[1] <= max[1] + pad &&
    pos[2] >= min[2] - pad && pos[2] <= max[2] + pad
  );
}
