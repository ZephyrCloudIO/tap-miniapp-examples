/**
 * ============================================================================
 *  MCP RACE PROJECTION (writer)
 * ============================================================================
 *  The packaged surface keeps a compact, bounded snapshot of the player's
 *  current race in TAP storage so the package-runtime MCP tool (Chloe's
 *  read-only window: "who's winning?", "which game can I join?") can read it
 *  without touching the game loop. Written by the multiplayer session on
 *  roster/phase changes and throttled to ~1 Hz while racing.
 *
 *  Storage: `kart-royale:mcp/users/{userId}/channels/{channelId}/current`.
 * ============================================================================
 */
import { BridgeError, storageGet, storageSet } from './bridge';
import type { RosterMemberWire, RacePhase } from '@tap-examples/kart-royale-server/protocol';

export const PROJECTION_NAMESPACE = 'kart-royale';
export const PROJECTION_SCHEMA = 'kart-royale.mcp.current';
export const PROJECTION_VERSION = 1;
export const MAX_PROJECTED_MEMBERS = 16;
export const MAX_PROJECTED_STANDINGS = 8;

export interface RaceProjection {
  projectionSchema: string;
  projectionVersion: number;
  schemaVersion: number;
  source: 'tap-channel-projection';
  projectionTruncated: boolean;
  raceId: string | null;
  channelId: string;
  phase: RacePhase | 'idle';
  members: {
    userId: string;
    displayName: string;
    role: 'player' | 'spectator';
    slot: number | null;
    ready: boolean;
    connected: boolean;
  }[];
  standings: {
    slot: number;
    displayName: string;
    lap: number;
    place: number;
    finished: boolean;
  }[];
  totalMemberCount: number;
  updatedAtMs: number;
}

function projectionKey(userId: string, channelId: string): string {
  return `mcp/users/${userId}/channels/${channelId}/current`;
}

/** CAS write with one re-read retry; failures are swallowed (read-only aid). */
export async function writeRaceProjection(
  userId: string,
  channelId: string,
  input: {
    raceId: string | null;
    phase: RacePhase | 'idle';
    roster: RosterMemberWire[];
    standings: RaceProjection['standings'];
    nowMs: number;
  },
): Promise<void> {
  const truncated = input.roster.length > MAX_PROJECTED_MEMBERS ||
    input.standings.length > MAX_PROJECTED_STANDINGS;
  const projection: RaceProjection = {
    projectionSchema: PROJECTION_SCHEMA,
    projectionVersion: PROJECTION_VERSION,
    schemaVersion: 1,
    source: 'tap-channel-projection',
    projectionTruncated: truncated,
    raceId: input.raceId,
    channelId,
    phase: input.phase,
    members: input.roster.slice(0, MAX_PROJECTED_MEMBERS).map((m) => ({
      userId: m.userId,
      displayName: m.displayName,
      role: m.role,
      slot: m.slot,
      ready: m.ready,
      connected: m.connected,
    })),
    standings: input.standings.slice(0, MAX_PROJECTED_STANDINGS),
    totalMemberCount: input.roster.length,
    updatedAtMs: input.nowMs,
  };
  const key = projectionKey(userId, channelId);
  try {
    const stored = await storageGet<Record<string, unknown>>(PROJECTION_NAMESPACE, key);
    await storageSet(PROJECTION_NAMESPACE, key, projection as never, stored.revision);
  } catch (error) {
    if (error instanceof BridgeError && error.kind === 'conflict') {
      try {
        const stored = await storageGet<Record<string, unknown>>(PROJECTION_NAMESPACE, key);
        await storageSet(PROJECTION_NAMESPACE, key, projection as never, stored.revision);
      } catch {
        /* best effort */
      }
    }
  }
}
