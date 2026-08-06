/**
 * ============================================================================
 *  RACE ROOM (Durable Object)
 * ============================================================================
 *  One instance per race. Authoritative for the *race rules*:
 *  roster and grid slots, the countdown clock, checkpoint order, placement,
 *  and finish — kart motion is client-simulated and relayed (hybrid model).
 *
 *  Hibernation: connections carry a serialized attachment with their member
 *  snapshot, so the room survives eviction mid-race; durable storage keeps
 *  the phase and results for reconnect snapshots.
 * ============================================================================
 */
import { DurableObject } from 'cloudflare:workers';
import {
  PROTOCOL_VERSION,
  parseClientMessage,
  type ClientItemDraw,
  type ClientItemUse,
  type ClientHitClaim,
  type KartStateWire,
  type MemberRole,
  type RacePhase,
  type RosterMemberWire,
  type ServerMessage,
} from './protocol';
import { checkpointClaimConsistent, positionPlausible } from './trackAuthority';
import { trackMath } from './trackAuthority';
import { ARM_TIME_S, BOX_RESPAWN_S, TRIPLE_COUNT, TRIPLE_MUSHROOM_KIND, rollItem } from '@tap-examples/kart-royale/item-tables';

interface Member {
  userId: string;
  displayName: string;
  role: MemberRole;
  slot: number | null;
  ready: boolean;
  host: boolean;
  connected: boolean;
  lastSeen: number;
  kartState: KartStateWire | null;
  lap: number;
  cp: number;
  raceDistance: number;
  finished: boolean;
  finishTime: number | null;
  place: number | null;
}

interface RoomAttachment {
  userId: string;
  displayName: string;
  role: MemberRole;
}

/** Matches the game director's COUNTDOWN (4.4 s, 0.4 s lead-in + 3-2-1-GO). */
const COUNTDOWN_MS_DEFAULT = 4400;
const MAX_SPECTATORS = 64;

export class RaceRoom extends DurableObject<Env> {
  private phase: RacePhase = 'lobby';
  private members = new Map<string, Member>();
  private sockets = new Map<WebSocket, string>(); // ws -> userId
  private countdownEndsAt: number | null = null;
  private finishOrder: string[] = [];
  private channelId: string | null = null;
  /** box index → server-clock ms until it pops back up */
  private boxes = new Map<number, number>();
  /** `${userId}` or `${userId}/${kartKey}` → the kart's held item */
  private inventory = new Map<string, { kind: number; count: number; armUntil: number }>();
  /** seeded draw generator state (mulberry32), so room entropy is per-room */
  private rngState = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.ctx.storage.get<{
        phase: RacePhase;
        countdownEndsAt: number | null;
        finishOrder: string[];
        channelId: string | null;
        raceId: string | null;
        rngState: number;
        boxes: [number, number][];
        inventory: [string, { kind: number; count: number; armUntil: number }][];
      }>('room');
      if (stored) {
        this.phase = stored.phase;
        this.countdownEndsAt = stored.countdownEndsAt;
        this.finishOrder = stored.finishOrder;
        this.channelId = stored.channelId ?? null;
        this.raceId = stored.raceId ?? null;
        this.rngState = stored.rngState ?? 0;
        this.boxes = new Map(stored.boxes ?? []);
        this.inventory = new Map(stored.inventory ?? []);
      }
      for (const ws of this.ctx.getWebSockets()) {
        const attachment = ws.deserializeAttachment() as RoomAttachment | null;
        if (attachment?.userId) this.sockets.set(ws, attachment.userId);
      }
    });
  }

  // -------------------------------------------------------------------------
  //  HTTP entry (from the Worker)
  // -------------------------------------------------------------------------

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/ws') {
      const userId = request.headers.get('x-kr-user');
      const channelId = request.headers.get('x-kr-channel');
      const role = request.headers.get('x-kr-role');
      const displayName = request.headers.get('x-kr-name');
      if (
        !userId || !channelId || !displayName ||
        (role !== 'player' && role !== 'spectator')
      ) {
        return new Response('missing stamped identity', { status: 400 });
      }
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('expected websocket upgrade', { status: 426 });
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      const attachment: RoomAttachment = {
        userId,
        displayName: decodeURIComponent(displayName),
        role,
      };
      server.serializeAttachment(attachment);
      this.sockets.set(server, userId);
      this.join(attachment, server);
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === '/exists') return new Response('ok');

    // The Worker initialises a freshly created room with its channel, so the
    // room can keep the channel registry listing current as it changes phase.
    if (url.pathname === '/admin/init' && request.method === 'POST') {
      const body: unknown = await request.json().catch(() => null);
      if (typeof body !== 'object' || body === null) return new Response('expected JSON object', { status: 400 });
      const channelId = (body as { channelId?: unknown }).channelId;
      const raceId = (body as { raceId?: unknown }).raceId;
      if (typeof channelId !== 'string' || !channelId) return new Response('channelId required', { status: 400 });
      if (typeof raceId !== 'string' || !raceId) return new Response('raceId required', { status: 400 });
      this.channelId = channelId;
      this.raceId = raceId;
      // Seed the room's draw generator once, at creation.
      this.rngState = new Uint32Array(crypto.getRandomValues(new Uint8Array(4)).buffer)[0] || 1;
      await this.persist();
      return new Response('ok');
    }
    return new Response('not found', { status: 404 });
  }

  // -------------------------------------------------------------------------
  //  Membership
  // -------------------------------------------------------------------------

  private join(attachment: RoomAttachment, ws: WebSocket): void {
    const now = Date.now();
    const existing = this.members.get(attachment.userId);
    const maxPlayers = Number(this.env.MAX_PLAYERS) || 8;

    if (existing) {
      // Reconnect: reclaim the same slot; identity came from a verified ticket.
      existing.connected = true;
      existing.lastSeen = now;
      existing.displayName = attachment.displayName;
    } else if (attachment.role === 'player') {
      const taken = new Set(
        [...this.members.values()].filter((m) => m.slot !== null).map((m) => m.slot),
      );
      let slot: number | null = null;
      for (let s = 0; s < maxPlayers; s++) {
        if (!taken.has(s)) {
          slot = s;
          break;
        }
      }
      if (slot === null) {
        this.send(ws, { v: PROTOCOL_VERSION, type: 'error', code: 'room_full', message: 'All player slots are taken; join as a spectator.' });
        ws.close(4001, 'room full');
        return;
      }
      this.members.set(attachment.userId, {
        userId: attachment.userId,
        displayName: attachment.displayName,
        role: 'player',
        slot,
        ready: false,
        host: ![...this.members.values()].some((m) => m.role === 'player' && m.host),
        connected: true,
        lastSeen: now,
        kartState: null,
        lap: 0,
        cp: -1,
        raceDistance: 0,
        finished: false,
        finishTime: null,
        place: null,
      });
    } else {
      const spectators = [...this.members.values()].filter((m) => m.role === 'spectator');
      if (spectators.length >= MAX_SPECTATORS) {
        this.send(ws, { v: PROTOCOL_VERSION, type: 'error', code: 'spectators_full', message: 'Spectator limit reached.' });
        ws.close(4001, 'spectators full');
        return;
      }
      this.members.set(attachment.userId, {
        userId: attachment.userId,
        displayName: attachment.displayName,
        role: 'spectator',
        slot: null,
        ready: false,
        host: false,
        connected: true,
        lastSeen: now,
        kartState: null,
        lap: 0,
        cp: -1,
        raceDistance: 0,
        finished: false,
        finishTime: null,
        place: null,
      });
    }

    const member = this.members.get(attachment.userId)!;
    this.send(ws, {
      v: PROTOCOL_VERSION,
      type: 'welcome',
      userId: member.userId,
      slot: member.slot,
      phase: this.phase,
      roster: this.roster(),
      serverTime: now,
      countdownEndsAt: this.countdownEndsAt,
    });
    this.broadcast({
      v: PROTOCOL_VERSION,
      type: 'roster',
      roster: this.roster(),
    });
    this.reportRegistry('update');
    // Late joiners need the current box state to render an honest course.
    const down = [...this.boxes.entries()].map(([box, until]) => ({ box, until }));
    if (down.length) this.send(ws, { v: PROTOCOL_VERSION, type: 'box_sync', down });
  }

  private roster(): RosterMemberWire[] {
    return [...this.members.values()]
      .sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99))
      .map((m) => ({
        userId: m.userId,
        displayName: m.displayName,
        role: m.role,
        slot: m.slot,
        ready: m.ready,
        host: m.host,
        connected: m.connected,
      }));
  }

  // -------------------------------------------------------------------------
  //  Socket handlers (hibernatable)
  // -------------------------------------------------------------------------

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const userId = this.sockets.get(ws);
    if (!userId) {
      ws.close(4000, 'unbound socket');
      return;
    }
    if (typeof message !== 'string') {
      this.send(ws, { v: PROTOCOL_VERSION, type: 'error', code: 'bad_frame', message: 'Binary frames are not part of the protocol.' });
      return;
    }
    const parsed = parseClientMessage(message);
    if (!parsed) {
      this.send(ws, { v: PROTOCOL_VERSION, type: 'error', code: 'bad_message', message: 'Malformed protocol envelope.' });
      return;
    }
    const member = this.members.get(userId);
    if (!member) {
      ws.close(4000, 'unknown member');
      return;
    }
    member.lastSeen = Date.now();
    switch (parsed.type) {
      case 'hello':
        // Identity already stamped by the Worker ticket; nothing to do beyond
        // confirming the roster so late joiners settle.
        this.send(ws, { v: PROTOCOL_VERSION, type: 'roster', roster: this.roster() });
        return;
      case 'ready':
        member.ready = parsed.ready && member.role === 'player';
        this.broadcast({ v: PROTOCOL_VERSION, type: 'roster', roster: this.roster() });
        return;
      case 'start':
        this.onStart(ws, member);
        return;
      case 'state':
        this.onState(member, parsed.state, parsed.lap, parsed.cp, parsed.raceDistance, parsed.kartKey ?? 'self');
        return;
      case 'checkpoint':
        this.onCheckpoint(member, parsed.lap, parsed.cp, parsed.raceDistance);
        return;
      case 'finish':
        this.onFinish(member, parsed.raceTime);
        return;
      case 'item_draw':
        this.onItemDraw(ws, member, parsed);
        return;
      case 'item_use':
        this.onItemUse(ws, member, parsed);
        return;
      case 'hit_claim':
        this.onHitClaim(member, parsed);
        return;
      case 'ping':
        this.send(ws, { v: PROTOCOL_VERSION, type: 'pong', at: parsed.at, serverTime: Date.now() });
        return;
    }
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    const userId = this.sockets.get(ws);
    this.sockets.delete(ws);
    if (!userId) return;
    const member = this.members.get(userId);
    if (!member) return;
    member.connected = false;
    member.ready = false;
    member.lastSeen = Date.now();
    this.broadcast({ v: PROTOCOL_VERSION, type: 'peer_leave', userId });
    this.broadcast({ v: PROTOCOL_VERSION, type: 'roster', roster: this.roster() });
    // Hold the slot for the grace period, then free it.
    await this.scheduleSweep();
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  // -------------------------------------------------------------------------
  //  Race rules
  // -------------------------------------------------------------------------

  private onStart(ws: WebSocket, member: Member): void {
    if (this.phase !== 'lobby') {
      this.send(ws, { v: PROTOCOL_VERSION, type: 'error', code: 'bad_phase', message: `Cannot start while the race is ${this.phase}.` });
      return;
    }
    if (!member.host) {
      this.send(ws, { v: PROTOCOL_VERSION, type: 'error', code: 'not_host', message: 'Only the lobby host starts the race.' });
      return;
    }
    const players = [...this.members.values()].filter((m) => m.role === 'player' && m.connected);
    if (players.length === 0 || players.some((m) => !m.ready)) {
      this.send(ws, { v: PROTOCOL_VERSION, type: 'error', code: 'not_ready', message: 'Every connected player must be ready.' });
      return;
    }
    this.phase = 'countdown';
    const countdownMs = Number(this.env.COUNTDOWN_MS) || COUNTDOWN_MS_DEFAULT;
    this.countdownEndsAt = Date.now() + countdownMs;
    for (const m of this.members.values()) {
      m.lap = 0;
      m.cp = -1;
      m.raceDistance = 0;
      m.finished = false;
      m.finishTime = null;
      m.place = null;
    }
    this.finishOrder = [];
    this.broadcast({ v: PROTOCOL_VERSION, type: 'countdown', endsAt: this.countdownEndsAt });
    void this.persist();
    this.reportRegistry('update');
    this.ctx.storage.setAlarm(this.countdownEndsAt);
  }

  private onState(member: Member, state: KartStateWire, lap: number, cp: number, raceDistance: number, kartKey: string): void {
    if (this.phase !== 'running' && this.phase !== 'countdown') return;
    if (!positionPlausible(state.pos)) return; // impossible position: drop, don't relay
    if (kartKey === 'self') {
      member.kartState = state;
      // lap/raceDistance are presentation counters; cp advances only through
      // validated checkpoint claims, never through state samples.
      member.lap = lap;
      member.raceDistance = Math.max(member.raceDistance, raceDistance);
    }
    // AI backfill states (kartKey ai:<slot>) are relayed but never stored —
    // only a member's own kart feeds checkpoint validation.
    this.broadcastExcept(member.userId, {
      v: PROTOCOL_VERSION,
      type: 'peer_state',
      userId: member.userId,
      kartKey,
      state,
      lap,
      cp: kartKey === 'self' ? member.cp : cp,
      raceDistance: kartKey === 'self' ? member.raceDistance : raceDistance,
      at: Date.now(),
    });
  }

  private onCheckpoint(member: Member, lap: number, cp: number, raceDistance: number): void {
    if (this.phase !== 'running' || member.role !== 'player' || member.finished) return;
    const checkpointCount = trackMath().checkpointCount;
    const expectedNext = (member.cp + 1) % checkpointCount;
    const plausible = cp === expectedNext &&
      (!member.kartState || checkpointClaimConsistent(cp, member.kartState.pos));
    if (!plausible) {
      this.broadcast({
        v: PROTOCOL_VERSION,
        type: 'checkpoint_reject',
        userId: member.userId,
        cp,
        reason: cp !== expectedNext ? `expected checkpoint ${expectedNext}` : 'position inconsistent with checkpoint',
      });
      return;
    }
    member.cp = cp;
    member.lap = lap;
    member.raceDistance = Math.max(member.raceDistance, raceDistance);
    this.broadcast({
      v: PROTOCOL_VERSION,
      type: 'checkpoint_ok',
      userId: member.userId,
      lap,
      cp,
    });
  }

  private onFinish(member: Member, raceTime: number): void {
    if (this.phase !== 'running' || member.role !== 'player' || member.finished) return;
    const checkpointCount = trackMath().checkpointCount;
    if (member.cp < checkpointCount - 1) {
      this.send(
        this.socketFor(member.userId)!,
        { v: PROTOCOL_VERSION, type: 'error', code: 'incomplete', message: 'Finish claimed before the final checkpoint.' },
      );
      return;
    }
    member.finished = true;
    member.finishTime = raceTime;
    member.place = this.finishOrder.length + 1;
    this.finishOrder.push(member.userId);
    this.broadcast({
      v: PROTOCOL_VERSION,
      type: 'finish_ok',
      userId: member.userId,
      place: member.place,
    });
    const players = [...this.members.values()].filter((m) => m.role === 'player' && m.connected);
    if (players.length > 0 && players.every((m) => m.finished)) {
      this.phase = 'finished';
      const standings = players
        .map((m) => ({
          userId: m.userId,
          displayName: m.displayName,
          place: m.place ?? players.length,
          raceTime: m.finishTime,
        }))
        .sort((a, b) => a.place - b.place);
      this.broadcast({ v: PROTOCOL_VERSION, type: 'race_results', standings });
      void this.persist();
      this.reportRegistry('update');
    }
  }

  // ----------------------------------------------------------------- items

  /** The room's seeded draw stream (mulberry32): same table, per-room entropy. */
  private nextRandom(): number {
    // mulberry32
    this.rngState = (this.rngState + 0x6d2b79f5) | 0;
    let t = this.rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Inventory key: a member's own kart, or a host-owned AI backfill kart. */
  private inventoryKey(member: Member, kartKey: string | undefined): string | null {
    if (!kartKey || kartKey === 'self') return member.userId;
    if (!kartKey.startsWith('ai:')) return null;
    // AI karts belong to the lobby host's simulation.
    if (!member.host) return null;
    return `${member.userId}/${kartKey}`;
  }

  private onItemDraw(ws: WebSocket, member: Member, msg: ClientItemDraw): void {
    if (this.phase !== 'running' && this.phase !== 'countdown') return;
    const key = this.inventoryKey(member, msg.kartKey);
    if (!key) {
      this.send(ws, { v: PROTOCOL_VERSION, type: 'item_denied', userId: member.userId, kartKey: msg.kartKey ?? 'self', reason: 'not_your_kart' });
      return;
    }

    // Empty hands only — the slot contract from the game (held or trailed
    // items both block a new draw).
    const held = this.inventory.get(key);
    if (held && held.count > 0) {
      this.send(ws, { v: PROTOCOL_VERSION, type: 'item_denied', userId: member.userId, kartKey: msg.kartKey ?? 'self', reason: 'hands_full' });
      return;
    }

    const now = Date.now();
    const downUntil = this.boxes.get(msg.box);
    if (downUntil !== undefined && downUntil > now) {
      this.send(ws, { v: PROTOCOL_VERSION, type: 'item_denied', userId: member.userId, kartKey: msg.kartKey ?? 'self', reason: 'box_down' });
      return;
    }

    const kind = rollItem(() => this.nextRandom(), msg.place, Math.max(1, this.members.size));
    const count = kind === TRIPLE_MUSHROOM_KIND ? TRIPLE_COUNT : 1;
    this.inventory.set(key, {
      kind,
      count,
      armUntil: now + ARM_TIME_S * 1000,
    });
    this.boxes.set(msg.box, now + BOX_RESPAWN_S * 1000);
    void this.persist();

    this.send(ws, {
      v: PROTOCOL_VERSION,
      type: 'item_granted',
      userId: member.userId,
      kartKey: msg.kartKey ?? 'self',
      kind,
      count,
    });
    this.broadcast({ v: PROTOCOL_VERSION, type: 'box_down', box: msg.box, until: now + BOX_RESPAWN_S * 1000 });
  }

  private onItemUse(ws: WebSocket, member: Member, msg: ClientItemUse): void {
    if (this.phase !== 'running' && this.phase !== 'countdown') return;
    const key = this.inventoryKey(member, msg.kartKey);
    const held = key ? this.inventory.get(key) : undefined;
    const kartKey = msg.kartKey ?? 'self';
    if (!key || !held || held.kind !== msg.kind || held.count <= 0) {
      this.send(ws, { v: PROTOCOL_VERSION, type: 'item_denied', userId: member.userId, kartKey, reason: 'empty_hands' });
      return;
    }
    if (Date.now() < held.armUntil) {
      this.send(ws, { v: PROTOCOL_VERSION, type: 'item_denied', userId: member.userId, kartKey, reason: 'still_arming' });
      return;
    }

    held.count--;
    if (held.count <= 0) this.inventory.delete(key);
    void this.persist();
    this.broadcast({
      v: PROTOCOL_VERSION,
      type: 'item_used',
      userId: member.userId,
      kartKey,
      kind: msg.kind,
      backwards: msg.backwards,
      carry: msg.carry,
      target: msg.target,
    });
  }

  /**
   * A shooter's projectile says it hit a network-owned kart. The claim is
   * relayed to the victim's client, which owns and applies the effect.
   */
  private onHitClaim(member: Member, msg: ClientHitClaim): void {
    if (this.phase !== 'running') return;
    const target = this.members.get(msg.targetUserId);
    if (!target) return;
    const ws = this.socketFor(target.userId);
    if (!ws) return;
    this.send(ws, {
      v: PROTOCOL_VERSION,
      type: 'hit',
      fromUserId: member.userId,
      fromKartKey: msg.targetKartKey ?? 'self',
      kind: msg.kind,
    });
  }

  /** Boxes whose down time has passed pop back up; called from the alarm. */
  private sweepBoxes(): void {
    const now = Date.now();
    for (const [box, until] of this.boxes) {
      if (until <= now) {
        this.boxes.delete(box);
        this.broadcast({ v: PROTOCOL_VERSION, type: 'box_up', box });
      }
    }
  }

  // -------------------------------------------------------------------------
  //  Alarms: countdown expiry + disconnect sweeps
  // -------------------------------------------------------------------------

  override async alarm(): Promise<void> {
    if (this.phase === 'countdown' && this.countdownEndsAt !== null && Date.now() >= this.countdownEndsAt) {
      this.phase = 'running';
      this.countdownEndsAt = null;
      this.broadcast({ v: PROTOCOL_VERSION, type: 'race_start', at: Date.now() });
      void this.persist();
      this.reportRegistry('update');
    }
    this.sweepBoxes();
    const graceMs = (Number(this.env.DISCONNECT_GRACE_SECONDS) || 45) * 1000;
    const now = Date.now();
    let freed = false;
    for (const member of this.members.values()) {
      if (!member.connected && now - member.lastSeen > graceMs) {
        if (member.slot !== null) freed = true;
        if (this.phase === 'lobby' || this.phase === 'finished') {
          this.members.delete(member.userId);
        } else {
          // Mid-race: free the slot but keep the result-eligible record.
          member.slot = null;
          member.role = 'spectator';
        }
      }
    }
    if (freed || [...this.members.values()].some((m) => !m.connected)) {
      this.broadcast({ v: PROTOCOL_VERSION, type: 'roster', roster: this.roster() });
    }
    // Host migration: the earliest connected player becomes host.
    const players = [...this.members.values()].filter((m) => m.role === 'player' && m.connected);
    if (players.length && !players.some((m) => m.host)) {
      players.sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99));
      players[0].host = true;
      for (const m of this.members.values()) if (!players.includes(m)) m.host = false;
      this.broadcast({ v: PROTOCOL_VERSION, type: 'roster', roster: this.roster() });
    }
    if (this.members.size === 0) {
      await this.ctx.storage.delete('room');
      this.phase = 'lobby';
      this.finishOrder = [];
      this.reportRegistry('remove');
    }
    await this.scheduleSweep();
  }

  private async scheduleSweep(): Promise<void> {
    const graceMs = (Number(this.env.DISCONNECT_GRACE_SECONDS) || 45) * 1000;
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > Date.now() + graceMs) {
      this.ctx.storage.setAlarm(Date.now() + graceMs);
    }
  }

  // -------------------------------------------------------------------------
  //  Plumbing
  // -------------------------------------------------------------------------

  private socketFor(userId: string): WebSocket | null {
    for (const [ws, id] of this.sockets) if (id === userId) return ws;
    return null;
  }

  private send(ws: WebSocket | null, message: ServerMessage): void {
    if (!ws) return;
    try {
      ws.send(JSON.stringify(message));
    } catch {
      /* socket already gone */
    }
  }

  private broadcast(message: ServerMessage): void {
    this.broadcastExcept(null, message);
  }

  private broadcastExcept(exceptUserId: string | null, message: ServerMessage): void {
    const raw = JSON.stringify(message);
    for (const [ws, userId] of this.sockets) {
      if (userId === exceptUserId) continue;
      try {
        ws.send(raw);
      } catch {
        /* socket already gone */
      }
    }
  }

  private async persist(): Promise<void> {
    await this.ctx.storage.put('room', {
      phase: this.phase,
      countdownEndsAt: this.countdownEndsAt,
      finishOrder: this.finishOrder,
      channelId: this.channelId,
      raceId: this.raceId,
      rngState: this.rngState,
      boxes: [...this.boxes],
      inventory: [...this.inventory],
    });
  }

  /** Keep the channel registry's listing in step with this room's lifecycle. */
  private reportRegistry(action: 'update' | 'remove'): void {
    if (!this.channelId || !this.raceId) return;
    const stub = this.env.RACE_REGISTRY.get(this.env.RACE_REGISTRY.idFromName(this.channelId));
    const players = [...this.members.values()].filter(
      (m) => m.role === 'player' && m.connected,
    ).length;
    this.ctx.waitUntil(
      stub.fetch(new Request(`https://registry/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          raceId: this.raceId,
          phase: this.phase,
          players,
        }),
      })).catch(() => {}),
    );
  }

  private raceId: string | null = null;
}
