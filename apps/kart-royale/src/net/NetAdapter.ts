/**
 * ============================================================================
 *  NET ADAPTER — the RaceNetHooks implementation
 * ============================================================================
 *  Maps the room's roster onto the race grid: each human member drives the
 *  kart at their assigned slot; the lobby host additionally simulates the AI
 *  backfill slots locally and streams them under `ai:<slot>` keys. Every other
 *  kart on this client is remote: posed from interpolation buffers and stepped
 *  through `Kart.stepRemote` (visuals only, no physics).
 *
 *  Items are server-arbitrated (Phase 4): pickups and spends by local karts
 *  are requests to the room; grants, box state, spends and hits land back as
 *  broadcasts. This class implements the `ItemsNetDriver` half of that too.
 * ============================================================================
 */
import type { Ctx, IKart } from '../types';
import { ItemKind } from '../types';
import type { Race } from '../game/Race';
import type { Kart } from '../kart/Kart';
import type { Items, ItemsNetDriver } from '../game/Items';
import type {
  KartStateWire,
  RosterMemberWire,
  ServerMessage,
} from '@tap-examples/kart-royale-server/protocol';
import { PROTOCOL_VERSION } from '@tap-examples/kart-royale-server/protocol';
import type { RaceClient } from './RaceClient';
import { RemoteKartBuffer } from './RemoteKartBuffer';
import { setRemoteKarts, clearRemoteKarts } from './remoteKarts';
import type { RaceNetHooks } from './netHooks';

/** 20 Hz uplink — one state sample every third 60 fps frame. */
const UPLINK_MS = 50;

export interface NetAdapterCallbacks {
  /** The host started the countdown; `endsAt` is on the server clock. */
  onCountdown(endsAt: number): void;
  /** The room's roster changed (joins, readies, disconnects). */
  onRoster(roster: RosterMemberWire[], self: RosterMemberWire | null): void;
  /** A peer's race finished; `place` is server-assigned. */
  onPeerFinish(userId: string, place: number): void;
  /** The room's clock reached GO. */
  onRaceStart(): void;
  /** Final standings from the room (all connected players home). */
  onRaceResults(standings: { userId: string; displayName: string; place: number; raceTime: number | null }[]): void;
  /** The room closed (socket dropped). */
  onClose(): void;
}

export class NetAdapter implements RaceNetHooks, ItemsNetDriver {
  private readonly client: RaceClient;
  private readonly race: Race;
  private readonly items: Items;
  private readonly cb: NetAdapterCallbacks;

  /** userId → roster member (server-stamped). */
  private members = new Map<string, RosterMemberWire>();
  private selfId: string | null = null;
  private mySlot: number | null = null;
  private hostUserId: string | null = null;

  /** kartId → interpolation buffer, for every network-owned kart. */
  private buffers = new Map<number, RemoteKartBuffer>();
  /** userId/kartKey → kartId. */
  private streamToKart = new Map<string, number>();
  private remoteIds = new Set<number>();
  private aiSlots = new Set<number>();
  private started = false;
  private lastUplink = 0;
  private selfSeq = 0;
  private aiSeq = 0;

  constructor(client: RaceClient, race: Race, items: Items, cb: NetAdapterCallbacks) {
    this.client = client;
    this.race = race;
    this.items = items;
    this.cb = cb;
  }

  get slot(): number | null {
    return this.mySlot;
  }

  /** The roster entry for this client's own identity, once welcomed. */
  get self(): RosterMemberWire | null {
    return this.selfId ? this.members.get(this.selfId) ?? null : null;
  }

  get isHost(): boolean {
    return this.selfId !== null && this.selfId === this.hostUserId;
  }

  /** The roster's current human-slot assignments, for the lobby UI. */
  get roster(): RosterMemberWire[] {
    return [...this.members.values()];
  }

  /** Attach to the socket's message stream, the race director, and Items. */
  attach(): void {
    this.client.onMessage = (msg) => this.onServer(msg);
    this.client.onClose = () => this.cb.onClose();
    this.race.net = this;
    this.items.netDriver = this;
    this.items.remoteHitHandler = (kart, kind) => this.onRemoteHit(kart, kind);
  }

  detach(): void {
    this.client.onMessage = null;
    this.client.onClose = null;
    if (this.race.net === this) this.race.net = null;
    if (this.items.netDriver === this) this.items.netDriver = null;
    this.items.remoteHitHandler = null;
    clearRemoteKarts();
    this.buffers.clear();
    this.streamToKart.clear();
    this.remoteIds.clear();
  }

  // --------------------------------------------------------------- messages

  private onServer(msg: ServerMessage): void {
    switch (msg.type) {
      case 'welcome': {
        this.selfId = msg.userId;
        this.mySlot = msg.slot;
        this.applyRoster(msg.roster);
        break;
      }
      case 'roster':
        this.applyRoster(msg.roster);
        break;
      case 'countdown': {
        this.lockField();
        this.cb.onCountdown(msg.endsAt);
        break;
      }
      case 'race_start':
        this.started = true;
        this.cb.onRaceStart();
        break;
      case 'peer_state': {
        const kartId = this.streamToKart.get(`${msg.userId}/${msg.kartKey}`);
        if (kartId === undefined) break;
        let buffer = this.buffers.get(kartId);
        if (!buffer) {
          buffer = new RemoteKartBuffer();
          this.buffers.set(kartId, buffer);
        }
        buffer.push(msg.state, msg.at);
        const kart = this.race.karts[kartId];
        if (kart) {
          kart.lap = msg.lap;
          kart.raceDistance = msg.raceDistance;
        }
        break;
      }
      case 'peer_leave':
        break;
      case 'finish_ok': {
        const member = this.members.get(msg.userId);
        if (member?.slot !== null && member?.slot !== undefined) {
          this.race.markRemoteFinished(member.slot, msg.place);
          this.cb.onPeerFinish(msg.userId, msg.place);
        }
        break;
      }
      case 'item_granted': {
        const kart = this.kartForStream(msg.userId, msg.kartKey);
        if (msg.userId === this.selfId && kart) {
          this.items.grantItem(kart, msg.kind as ItemKind, msg.count);
        }
        break;
      }
      case 'item_denied':
        break; // the roulette settles empty; no toast in v1
      case 'item_used':
        this.onItemUsed(msg.userId, msg.kartKey, msg.kind, msg.backwards, msg.carry, msg.target);
        break;
      case 'hit': {
        // My kart (or my AI, as host) was struck by a remote projectile.
        const kart = this.kartForStream(this.selfId ?? '', msg.fromKartKey);
        if (kart) this.applyHit(kart, msg.kind as ItemKind);
        break;
      }
      case 'box_down':
        this.items.setBoxDown(msg.box, true, Math.max(0.05, (msg.until - this.client.serverNow()) / 1000));
        break;
      case 'box_up':
        this.items.setBoxDown(msg.box, false);
        break;
      case 'box_sync':
        for (const b of msg.down) {
          this.items.setBoxDown(b.box, true, Math.max(0.05, (b.until - this.client.serverNow()) / 1000));
        }
        break;
      case 'checkpoint_ok':
      case 'checkpoint_reject':
        break; // validated progress is already local; HUD stays quiet in v1
      case 'race_results':
        this.cb.onRaceResults(msg.standings);
        break; // the local results screen already reflects the same ordering
      case 'pong':
      case 'error':
        break;
    }
  }

  /** kart for a stream identity: userId/self → their slot; userId/ai:n → slot n. */
  private kartForStream(userId: string, kartKey: string): IKart | null {
    if (kartKey === 'self') {
      const member = this.members.get(userId);
      if (member?.slot === null || member === undefined || member.slot === undefined) return null;
      return this.race.karts[member.slot] ?? null;
    }
    const m = /^ai:(\d+)$/.exec(kartKey);
    if (!m) return null;
    return this.race.karts[Number(m[1])] ?? null;
  }

  /** The kart's stream identity on this client: 'self', 'ai:<slot>', or null. */
  private kartKeyFor(kart: IKart): string | null {
    if (kart.id === this.mySlot) return 'self';
    if (this.isHost && this.aiSlots.has(kart.id)) return `ai:${kart.id}`;
    return null;
  }

  private applyRoster(roster: RosterMemberWire[]): void {
    this.members.clear();
    for (const m of roster) this.members.set(m.userId, m);
    this.hostUserId = roster.find((m) => m.host)?.userId ?? this.hostUserId;
    this.cb.onRoster(roster, this.self);
  }

  /**
   * Lock the roster into the grid at countdown: humans at their slots, AI
   * backfill elsewhere, remote markings from this client's point of view.
   */
  private lockField(): void {
    const humans = [...this.members.values()].filter((m) => m.role === 'player' && m.slot !== null);
    const field: { slot: number; kind: 'human' | 'ai'; displayName: string }[] = [];
    this.aiSlots.clear();
    for (let slot = 0; slot < this.race.karts.length; slot++) {
      const human = humans.find((m) => m.slot === slot);
      if (human) {
        field.push({ slot, kind: 'human', displayName: human.displayName });
      } else {
        field.push({ slot, kind: 'ai', displayName: '' });
        this.aiSlots.add(slot);
      }
    }
    this.race.setNetworkRoster(field, this.mySlot);

    // Remote = every kart except mine, and except the AI karts I simulate as host.
    this.remoteIds.clear();
    this.streamToKart.clear();
    for (let slot = 0; slot < this.race.karts.length; slot++) {
      const isMine = slot === this.mySlot;
      const isMyAi = this.isHost && this.aiSlots.has(slot);
      if (isMine || isMyAi) continue;
      this.remoteIds.add(slot);
      const human = humans.find((m) => m.slot === slot);
      if (human) {
        this.streamToKart.set(`${human.userId}/self`, slot);
      } else if (this.hostUserId) {
        this.streamToKart.set(`${this.hostUserId}/ai:${slot}`, slot);
      }
    }
    setRemoteKarts(this.remoteIds);
    this.buffers.clear();
    this.started = false;
  }

  // --------------------------------------------------------------- RaceNetHooks

  isRemote(kart: IKart): boolean {
    return this.remoteIds.has(kart.id);
  }

  applyRemote(ctx: Ctx, kart: IKart, dt: number): void {
    const buffer = this.buffers.get(kart.id);
    const pose = buffer?.sample(this.client.serverNow());
    if (pose) {
      kart.position.set(pose.pos[0], pose.pos[1], pose.pos[2]);
      kart.quaternion.set(pose.quat[0], pose.quat[1], pose.quat[2], pose.quat[3]);
      kart.velocity.set(pose.vel[0], pose.vel[1], pose.vel[2]);
      kart.t = pose.t;
      kart.driftDir = pose.driftDir;
      kart.driftCharge = pose.driftCharge;
      // Reported effect timers, ticked locally between reports.
      kart.stunTime = pose.stun;
      kart.starTime = pose.star;
      kart.boostTime = pose.boost;
    }
    (kart as Kart).stepRemote?.(ctx, dt);
  }

  onLocalFrame(_ctx: Ctx, kart: IKart, lap: number, cp: number, raceDistance: number): void {
    if (!this.client.connected) return;
    if (this.mySlot === null) return; // spectators have no kart to uplink
    const now = performance.now();
    if (now - this.lastUplink < UPLINK_MS) return;
    this.lastUplink = now;

    this.client.send({
      v: PROTOCOL_VERSION,
      type: 'state',
      state: wireState(kart, ++this.selfSeq),
      lap,
      cp,
      raceDistance,
    });

    // The lobby host streams the AI backfill karts it simulates.
    if (this.isHost) {
      for (const slot of this.aiSlots) {
        const aiKart = this.race.karts[slot];
        if (!aiKart) continue;
        this.client.send({
          v: PROTOCOL_VERSION,
          type: 'state',
          state: wireState(aiKart, ++this.aiSeq),
          lap: aiKart.lap,
          cp: -1,
          raceDistance: aiKart.raceDistance,
          kartKey: `ai:${slot}`,
        });
      }
    }
  }

  onCheckpointClaim(lap: number, cp: number, raceDistance: number): void {
    this.client.send({ v: PROTOCOL_VERSION, type: 'checkpoint', lap, cp, raceDistance });
  }

  onFinish(raceTime: number): void {
    this.client.send({ v: PROTOCOL_VERSION, type: 'finish', raceTime });
  }

  // ------------------------------------------------------------------ lobby

  setReady(ready: boolean): void {
    this.client.send({ v: PROTOCOL_VERSION, type: 'ready', ready });
  }

  requestStart(): void {
    this.client.send({ v: PROTOCOL_VERSION, type: 'start' });
  }

  get serverNow(): number {
    return this.client.serverNow();
  }

  // ------------------------------------------------------------------ ItemsNetDriver

  /** A local kart touched a box: the room rolls, we wait for the grant. */
  requestDraw(kart: IKart, boxIndex: number): boolean {
    if (!this.client.connected || boxIndex < 0) return false;
    const kartKey = this.kartKeyFor(kart);
    if (!kartKey) return false;
    this.client.send({
      v: PROTOCOL_VERSION,
      type: 'item_draw',
      kartKey: kartKey === 'self' ? undefined : kartKey,
      box: boxIndex,
      place: kart.place || this.race.karts.length,
    });
    return true;
  }

  /** A local kart spent its held item: the room validates and broadcasts. */
  requestUse(kart: IKart, backwards: boolean): boolean {
    if (!this.client.connected) return false;
    const kartKey = this.kartKeyFor(kart);
    if (!kartKey) return false;
    const held = this.items.held(kart);
    if (held.kind === ItemKind.None || held.count <= 0) return false;
    this.client.send({
      v: PROTOCOL_VERSION,
      type: 'item_use',
      kartKey: kartKey === 'self' ? undefined : kartKey,
      kind: held.kind,
      backwards,
      carry: false,
      target: held.kind === ItemKind.RedShell ? this.shellTarget(kart) : -1,
    });
    return true;
  }

  /** The kart one place ahead — mirrors Items.targetAhead for the uplink. */
  private shellTarget(kart: IKart): number {
    const standings = this.race.standings;
    if (!standings?.length) return -1;
    const idx = standings.indexOf(kart);
    for (let i = idx - 1; i >= 0; i--) {
      const o = standings[i];
      if (o && !o.finished) return o.id;
    }
    return -1;
  }

  /** A spend broadcast: owner applies the effect; others render it. */
  private onItemUsed(
    userId: string,
    kartKey: string,
    kind: number,
    backwards: boolean,
    carry: boolean,
    target: number,
  ): void {
    const kart = this.kartForStream(userId, kartKey);
    if (!kart) return;
    const itemKind = kind as ItemKind;
    if (userId === this.selfId) {
      this.items.confirmUse(kart, itemKind, backwards);
    } else {
      this.items.confirmUseRemote(kart, itemKind, backwards, carry, target);
    }
    // The bolt shrinks everyone but its user — applied where each kart lives.
    if (itemKind === ItemKind.Bolt && userId !== this.selfId) {
      for (const k of this.race.karts) {
        if (this.isRemote(k) || k === kart || k.finished) continue;
        this.items.boltHit(k);
      }
    }
  }

  /** My projectile made contact with a network-owned kart: claim the hit. */
  private onRemoteHit(kart: IKart, kind: ItemKind): void {
    if (!this.client.connected) return;
    // The victim's owner: the human at that slot, or the host for AI karts.
    const human = [...this.members.values()].find((m) => m.slot === kart.id);
    const targetUserId = human?.userId ?? this.hostUserId;
    if (!targetUserId) return;
    this.client.send({
      v: PROTOCOL_VERSION,
      type: 'hit_claim',
      targetUserId,
      targetKartKey: human ? undefined : `ai:${kart.id}`,
      kind,
    });
  }

  /** A hit the server relayed to me: apply it to my kart (guards live there). */
  private applyHit(kart: IKart, kind: ItemKind): void {
    switch (kind) {
      case ItemKind.Banana:
        kart.spinOut(1.15);
        break;
      case ItemKind.Bomb:
        kart.spinOut(1.45);
        break;
      default:
        kart.spinOut(1.5);
        break;
    }
  }
}

function wireState(k: IKart, seq: number): KartStateWire {
  return {
    t: k.t,
    pos: [k.position.x, k.position.y, k.position.z],
    quat: [k.quaternion.x, k.quaternion.y, k.quaternion.z, k.quaternion.w],
    vel: [k.velocity.x, k.velocity.y, k.velocity.z],
    driftDir: k.driftDir,
    driftCharge: k.driftCharge,
    stun: k.stunTime,
    star: k.starTime,
    boost: k.boostTime,
    seq,
  };
}
