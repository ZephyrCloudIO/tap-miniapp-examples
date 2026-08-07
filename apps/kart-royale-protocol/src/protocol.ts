/**
 * ============================================================================
 *  WIRE PROTOCOL (v1)
 * ============================================================================
 *  JSON envelopes between the miniapp surface and the RaceRoom Durable
 *  Object. Every message carries `v` so the protocol can evolve without the
 *  packaged miniapp and the Worker drifting apart across releases.
 *
 *  The server is the authority for the *race rules* (roster, countdown,
 *  checkpoint order, placement, finish). Kart motion is client-simulated and
 *  relayed — see `state`/`peer_state` — which is the hybrid model the
 *  product brief fixes for this phase.
 * ============================================================================
 */

export const PROTOCOL_VERSION = 1 as const;

/** Client-declared role at join. Spectators never occupy grid slots. */
export type MemberRole = 'player' | 'spectator';

/** One compact kart state sample, streamed by each client for its own kart. */
export interface KartStateWire {
  /** Normalised lap progress [0,1) as computed client-side. */
  t: number;
  pos: [number, number, number];
  /** Quaternion x,y,z,w — remote rendering only, never validated. */
  quat: [number, number, number, number];
  vel: [number, number, number];
  /** 0 = not drifting, otherwise -1 | 1. Presentation-only. */
  driftDir: number;
  /** 0..1 mini-turbo charge. Presentation-only. */
  driftCharge: number;
  /** seconds of spin-out remaining — remote clients render the hit */
  stun: number;
  /** seconds of star power remaining */
  star: number;
  /** seconds of boost remaining */
  boost: number;
  /** Client monotonic sample counter for interpolation ordering. */
  seq: number;
}

// ---------------------------------------------------------------------------
//  Client → server
// ---------------------------------------------------------------------------

export interface ClientHello {
  v: number;
  type: 'hello';
  displayName: string;
  role: MemberRole;
}

export interface ClientReady {
  v: number;
  type: 'ready';
  ready: boolean;
}

/** Host-only request to start the countdown. */
export interface ClientStart {
  v: number;
  type: 'start';
}

export interface ClientState {
  v: number;
  type: 'state';
  state: KartStateWire;
  /** Progress counters as computed by the client's local Race director. */
  lap: number;
  cp: number;
  raceDistance: number;
  /**
   * 'self' (default) is the member's own kart. The lobby host additionally
   * streams AI backfill karts as `ai:<slot>` — relayed, never authoritative.
   */
  kartKey?: string;
}

/** Authoritative progress claim, validated against the shared track math. */
export interface ClientCheckpoint {
  v: number;
  type: 'checkpoint';
  lap: number;
  cp: number;
  raceDistance: number;
}

export interface ClientFinish {
  v: number;
  type: 'finish';
  raceTime: number;
}

export interface ClientPing {
  v: number;
  type: 'ping';
  at: number;
}

/** Request an item draw for a box the client's own kart collected. */
export interface ClientItemDraw {
  v: number;
  type: 'item_draw';
  /** 'self' (default) or ai:<slot> when the lobby host draws for a backfill kart. */
  kartKey?: string;
  /** Shared box identity: the deterministic box index in the track layout. */
  box: number;
  /** 1-based placement at draw time, so the server rolls from the same table. */
  place: number;
}

/** Spend a held item. The server validates possession before broadcasting. */
export interface ClientItemUse {
  v: number;
  type: 'item_use';
  kartKey?: string;
  kind: number;
  backwards: boolean;
  carry: boolean;
  target: number;
}

/** Why a deployed shield left the kart without an explicit item-use release. */
export type ItemCarryDisposition = 'destroyed' | 'dropped';

/**
 * A locally simulated carried item was consumed by the race world. The room
 * removes it from authoritative inventory and relays the visual disposition.
 */
export interface ClientItemCarryConsumed {
  v: number;
  type: 'item_carry_consumed';
  kartKey?: string;
  kind: number;
  disposition: ItemCarryDisposition;
}

/**
 * A projectile hit claim against a NETWORK-owned kart. The shooter's client
 * simulates its projectile and reports the contact; the victim's client owns
 * and applies the effect to its own kart.
 */
export interface ClientHitClaim {
  v: number;
  type: 'hit_claim';
  targetUserId: string;
  targetKartKey?: string;
  kind: number;
}

export type ClientMessage =
  | ClientHello
  | ClientReady
  | ClientStart
  | ClientState
  | ClientCheckpoint
  | ClientFinish
  | ClientPing
  | ClientItemDraw
  | ClientItemUse
  | ClientItemCarryConsumed
  | ClientHitClaim;

// ---------------------------------------------------------------------------
//  Server → client
// ---------------------------------------------------------------------------

export interface RosterMemberWire {
  userId: string;
  displayName: string;
  role: MemberRole;
  slot: number | null;
  ready: boolean;
  host: boolean;
  connected: boolean;
}

export type RacePhase = 'lobby' | 'countdown' | 'running' | 'finished';

export interface ServerWelcome {
  v: number;
  type: 'welcome';
  userId: string;
  slot: number | null;
  phase: RacePhase;
  roster: RosterMemberWire[];
  serverTime: number;
  countdownEndsAt: number | null;
}

export interface ServerRoster {
  v: number;
  type: 'roster';
  roster: RosterMemberWire[];
}

export interface ServerCountdown {
  v: number;
  type: 'countdown';
  endsAt: number;
}

export interface ServerRaceStart {
  v: number;
  type: 'race_start';
  at: number;
}

export interface ServerPeerState {
  v: number;
  type: 'peer_state';
  userId: string;
  kartKey: string;
  state: KartStateWire;
  lap: number;
  cp: number;
  raceDistance: number;
  at: number;
}

export interface ServerPeerLeave {
  v: number;
  type: 'peer_leave';
  userId: string;
}

export interface ServerCheckpointOk {
  v: number;
  type: 'checkpoint_ok';
  userId: string;
  lap: number;
  cp: number;
}

export interface ServerCheckpointReject {
  v: number;
  type: 'checkpoint_reject';
  userId: string;
  cp: number;
  reason: string;
}

export interface ServerFinishOk {
  v: number;
  type: 'finish_ok';
  userId: string;
  place: number;
}

export interface ServerRaceResults {
  v: number;
  type: 'race_results';
  standings: { userId: string; displayName: string; place: number; raceTime: number | null }[];
}

export interface ServerError {
  v: number;
  type: 'error';
  code: string;
  message: string;
}

export interface ServerPong {
  v: number;
  type: 'pong';
  at: number;
  serverTime: number;
}

/** A box went down; everyone drops the prop until `until` (server clock). */
export interface ServerBoxDown {
  v: number;
  type: 'box_down';
  box: number;
  until: number;
}

export interface ServerBoxUp {
  v: number;
  type: 'box_up';
  box: number;
}

/** The room granted an item to the drawing kart's owner. */
export interface ServerItemGranted {
  v: number;
  type: 'item_granted';
  userId: string;
  kartKey: string;
  kind: number;
  count: number;
}

/** A draw or spend was refused (box down, empty hands, or still arming). */
export interface ServerItemDenied {
  v: number;
  type: 'item_denied';
  userId: string;
  kartKey: string;
  reason: string;
}

/** A validated item spend; clients apply the effect/spawn the projectile. */
export interface ServerItemUsed {
  v: number;
  type: 'item_used';
  userId: string;
  kartKey: string;
  kind: number;
  backwards: boolean;
  carry: boolean;
  target: number;
}

/** A carried item was authoritatively destroyed or dropped into the race. */
export interface ServerItemCarryConsumed {
  v: number;
  type: 'item_carry_consumed';
  userId: string;
  kartKey: string;
  kind: number;
  disposition: ItemCarryDisposition;
}

/** One authoritative per-kart item-inventory snapshot entry. */
export interface ItemInventoryWire {
  userId: string;
  kartKey: string;
  kind: number;
  count: number;
  carried: boolean;
  /** Epoch milliseconds on the room's server clock. */
  armUntil: number;
}

/** Complete inventory state, sent on connection and ownership changes. */
export interface ServerItemSync {
  v: number;
  type: 'item_sync';
  items: ItemInventoryWire[];
}

/** A shooter's hit claim, relayed to the victim's client only. */
export interface ServerHit {
  v: number;
  type: 'hit';
  fromUserId: string;
  fromKartKey: string;
  kind: number;
}

/** Boxes currently down, for late joiners and reconnects. */
export interface ServerBoxSync {
  v: number;
  type: 'box_sync';
  down: { box: number; until: number }[];
}

export type ServerMessage =
  | ServerWelcome
  | ServerRoster
  | ServerCountdown
  | ServerRaceStart
  | ServerPeerState
  | ServerPeerLeave
  | ServerCheckpointOk
  | ServerCheckpointReject
  | ServerFinishOk
  | ServerRaceResults
  | ServerError
  | ServerPong
  | ServerBoxDown
  | ServerBoxUp
  | ServerItemGranted
  | ServerItemDenied
  | ServerItemUsed
  | ServerItemCarryConsumed
  | ServerItemSync
  | ServerHit
  | ServerBoxSync;

// ---------------------------------------------------------------------------
//  Validation
// ---------------------------------------------------------------------------

const MAX_NAME_CHARS = 48;
const MAX_ABS_COORD = 100_000;

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, max = MAX_ABS_COORD): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= max;
}

function numberTuple(value: unknown, length: number, max = MAX_ABS_COORD): value is number[] {
  return Array.isArray(value) && value.length === length && value.every((n) => finiteNumber(n, max));
}

function shortString(value: unknown, maxChars: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    [...value].length <= maxChars &&
    ![...value].some((c) => {
      const code = c.codePointAt(0) ?? 0;
      return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
    })
  );
}

export function isKartStateWire(value: unknown): value is KartStateWire {
  if (!isObj(value)) return false;
  return (
    finiteNumber(value.t, 10) &&
    numberTuple(value.pos, 3) &&
    numberTuple(value.quat, 4, 10) &&
    numberTuple(value.vel, 3, 10_000) &&
    finiteNumber(value.driftDir, 10) &&
    finiteNumber(value.driftCharge, 10) &&
    finiteNumber(value.stun, 1e4) &&
    finiteNumber(value.star, 1e4) &&
    finiteNumber(value.boost, 1e4) &&
    Number.isSafeInteger(value.seq) && (value.seq as number) >= 0
  );
}

/** Parse and validate a client envelope; returns null for anything malformed. */
export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (typeof raw !== 'string' || raw.length > 16 * 1024) return null;
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(msg) || msg.v !== PROTOCOL_VERSION || typeof msg.type !== 'string') return null;
  switch (msg.type) {
    case 'hello':
      return msg.role === 'player' || msg.role === 'spectator'
        ? shortString(msg.displayName, MAX_NAME_CHARS)
          ? (msg as unknown as ClientHello)
          : null
        : null;
    case 'ready':
      return typeof msg.ready === 'boolean' ? (msg as unknown as ClientReady) : null;
    case 'start':
      return msg as unknown as ClientStart;
    case 'state':
      return isKartStateWire(msg.state) &&
        Number.isSafeInteger(msg.lap) &&
        Number.isSafeInteger(msg.cp) &&
        finiteNumber(msg.raceDistance, 10_000_000) &&
        (msg.kartKey === undefined || shortString(msg.kartKey, 32))
        ? (msg as unknown as ClientState)
        : null;
    case 'checkpoint':
      return Number.isSafeInteger(msg.lap) &&
        Number.isSafeInteger(msg.cp) &&
        finiteNumber(msg.raceDistance, 10_000_000)
        ? (msg as unknown as ClientCheckpoint)
        : null;
    case 'finish':
      return finiteNumber(msg.raceTime, 10_000) ? (msg as unknown as ClientFinish) : null;
    case 'ping':
      return finiteNumber(msg.at, 1e15) ? (msg as unknown as ClientPing) : null;
    case 'item_draw':
      return Number.isSafeInteger(msg.box) && (msg.box as number) >= 0 &&
        Number.isSafeInteger(msg.place) &&
        (msg.kartKey === undefined || shortString(msg.kartKey, 32))
        ? (msg as unknown as ClientItemDraw)
        : null;
    case 'item_use':
      return Number.isSafeInteger(msg.kind) &&
        typeof msg.backwards === 'boolean' &&
        typeof msg.carry === 'boolean' &&
        Number.isSafeInteger(msg.target) &&
        (msg.kartKey === undefined || shortString(msg.kartKey, 32))
        ? (msg as unknown as ClientItemUse)
        : null;
    case 'item_carry_consumed':
      return Number.isSafeInteger(msg.kind) &&
        (msg.disposition === 'destroyed' || msg.disposition === 'dropped') &&
        (msg.kartKey === undefined || shortString(msg.kartKey, 32))
        ? (msg as unknown as ClientItemCarryConsumed)
        : null;
    case 'hit_claim':
      return shortString(msg.targetUserId, 128) &&
        Number.isSafeInteger(msg.kind) &&
        (msg.targetKartKey === undefined || shortString(msg.targetKartKey, 32))
        ? (msg as unknown as ClientHitClaim)
        : null;
    default:
      return null;
  }
}
