/**
 * ============================================================================
 *  RACE ↔ NETWORK HOOKS
 * ============================================================================
 *  The seam between the race director and the multiplayer adapter. `Race`
 *  consults these hooks when a session is attached; `NetAdapter` implements
 *  them. Kept as a tiny standalone module so `Race.ts` (game) and
 *  `NetAdapter.ts` (network) never import each other.
 * ============================================================================
 */
import type { Ctx, IKart } from '../types';

export interface RaceNetHooks {
  /**
   * True when this kart's pose is owned by the network (a remote human, or an
   * AI backfill kart simulated by the lobby host). Remote karts skip local
   * physics, AI driving, progress validation and watchdogs.
   */
  isRemote(kart: IKart): boolean;

  /** Apply the latest buffered network pose to a remote kart (once per frame). */
  applyRemote(ctx: Ctx, kart: IKart, dt: number): void;

  /**
   * The local player's freshest state, ready to uplink. The adapter throttles
   * and, when it is the lobby host, also streams AI backfill karts.
   */
  onLocalFrame(ctx: Ctx, kart: IKart, lap: number, cp: number, raceDistance: number): void;

  /** The local player validated a checkpoint crossing (in-order, per the director). */
  onCheckpointClaim(lap: number, cp: number, raceDistance: number): void;

  /** The local player completed the final lap. */
  onFinish(raceTime: number): void;
}
