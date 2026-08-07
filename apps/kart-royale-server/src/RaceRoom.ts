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
  type ClientItemCarryConsumed,
  type ClientItemDraw,
  type ClientItemUse,
  type ClientHitClaim,
  type ItemInventoryWire,
  type KartStateWire,
  type MemberRole,
  type RacePhase,
  type RosterMemberWire,
  type ServerMessage,
} from '@tap-examples/kart-royale-protocol';
import { checkpointClaimConsistent, positionPlausible } from './trackAuthority';
import { trackMath } from './trackAuthority';
import {
  ARM_TIME_S,
  BOX_RESPAWN_S,
  TRIPLE_COUNT,
  TRIPLE_MUSHROOM_KIND,
  isCarryableItemKind,
  rollItem,
} from '@tap-examples/kart-royale/item-tables';
import { raceFieldSize } from './config';

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
  /** Current per-member state, refreshed after every socket event. */
  member?: Member;
}

interface StoredRoom {
  phase: RacePhase;
  countdownEndsAt: number | null;
  finishOrder: string[];
  channelId: string | null;
  raceId: string | null;
  rngState: number;
  boxes: [number, number][];
  inventory: [string, InventoryEntry][];
  /** Disconnected members have no socket attachment, so keep a durable copy. */
  members?: Member[];
}

interface InventoryEntry {
  kind: number;
  count: number;
  armUntil: number;
  /** True after a shell/banana is deployed behind the kart but before release. */
  carried?: boolean;
}

/** Matches the game director's COUNTDOWN (4.4 s, 0.4 s lead-in + 3-2-1-GO). */
const COUNTDOWN_MS_DEFAULT = 4400;
const MAX_SPECTATORS = 64;
const USER_INVENTORY_PREFIX = 'user:';
const AI_INVENTORY_PREFIX = 'ai:';

function aiKartSlot(kartKey: string, maxPlayers: number): number | null {
  const match = /^ai:(0|[1-9]\d*)$/.exec(kartKey);
  if (!match) return null;
  const slot = Number(match[1]);
  return Number.isSafeInteger(slot) && slot >= 0 && slot < maxPlayers ? slot : null;
}

function inventoryKeyPriority(key: string, maxPlayers: number): number {
  if (key.startsWith(USER_INVENTORY_PREFIX) && key.length > USER_INVENTORY_PREFIX.length) {
    return 0;
  }
  if (aiKartSlot(key, maxPlayers) !== null) return 0;
  if (/\/ai:(?:0|[1-9]\d*)$/.test(key)) return 1;
  return 2;
}

function migrateInventoryKeys(
  entries: [string, InventoryEntry][],
  maxPlayers: number,
): Map<string, InventoryEntry> {
  const migrated = new Map<string, { entry: InventoryEntry; priority: number }>();
  for (const [legacyKey, entry] of entries) {
    let key: string | null;
    if (
      legacyKey.startsWith(USER_INVENTORY_PREFIX) &&
      legacyKey.length > USER_INVENTORY_PREFIX.length
    ) {
      key = legacyKey;
    } else if (legacyKey.startsWith(AI_INVENTORY_PREFIX)) {
      const slot = aiKartSlot(legacyKey, maxPlayers);
      key = slot === null ? null : `${AI_INVENTORY_PREFIX}${slot}`;
    } else {
      const legacyAi = /\/((?:ai:)(?:0|[1-9]\d*))$/.exec(legacyKey);
      if (legacyAi) {
        const slot = aiKartSlot(legacyAi[1], maxPlayers);
        key = slot === null ? null : `${AI_INVENTORY_PREFIX}${slot}`;
      } else {
        key = legacyKey ? `${USER_INVENTORY_PREFIX}${legacyKey}` : null;
      }
    }
    if (!key) continue;

    // A current-format record wins over a legacy alias if storage happens to
    // contain both during an interrupted migration.
    const priority = inventoryKeyPriority(legacyKey, maxPlayers);
    const current = migrated.get(key);
    if (!current || priority < current.priority) {
      migrated.set(key, { entry: { ...entry }, priority });
    }
  }
  return new Map([...migrated].map(([key, value]) => [key, value.entry]));
}

function isRole(value: unknown): value is MemberRole {
  return value === 'player' || value === 'spectator';
}

function isMember(value: unknown): value is Member {
  if (typeof value !== 'object' || value === null) return false;
  const member = value as Partial<Member>;
  return (
    typeof member.userId === 'string' &&
    typeof member.displayName === 'string' &&
    isRole(member.role) &&
    (member.slot === null || (
      typeof member.slot === 'number' && Number.isInteger(member.slot) && member.slot >= 0
    )) &&
    typeof member.ready === 'boolean' &&
    typeof member.host === 'boolean' &&
    typeof member.connected === 'boolean' &&
    typeof member.lastSeen === 'number' && Number.isFinite(member.lastSeen) &&
    (member.kartState === null || typeof member.kartState === 'object') &&
    typeof member.lap === 'number' && Number.isFinite(member.lap) &&
    typeof member.cp === 'number' && Number.isFinite(member.cp) &&
    typeof member.raceDistance === 'number' && Number.isFinite(member.raceDistance) &&
    typeof member.finished === 'boolean' &&
    (member.finishTime === null || (typeof member.finishTime === 'number' && Number.isFinite(member.finishTime))) &&
    (member.place === null || (typeof member.place === 'number' && Number.isFinite(member.place)))
  );
}

function readAttachment(ws: WebSocket): RoomAttachment | null {
  const value: unknown = ws.deserializeAttachment();
  if (typeof value !== 'object' || value === null) return null;
  const attachment = value as Partial<RoomAttachment>;
  if (
    typeof attachment.userId !== 'string' ||
    typeof attachment.displayName !== 'string' ||
    !isRole(attachment.role)
  ) {
    return null;
  }
  return {
    userId: attachment.userId,
    displayName: attachment.displayName,
    role: attachment.role,
    member: isMember(attachment.member) && attachment.member.userId === attachment.userId
      ? attachment.member
      : undefined,
  };
}

export class RaceRoom extends DurableObject<Env> {
  private phase: RacePhase = 'lobby';
  private members = new Map<string, Member>();
  private sockets = new Map<WebSocket, string>(); // ws -> userId
  private countdownEndsAt: number | null = null;
  private finishOrder: string[] = [];
  private channelId: string | null = null;
  /** box index → server-clock ms until it pops back up */
  private boxes = new Map<number, number>();
  /** `user:${userId}` or stable `ai:${slot}` → the kart's authoritative item. */
  private inventory = new Map<string, InventoryEntry>();
  /** seeded draw generator state (mulberry32), so room entropy is per-room */
  private rngState = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.ctx.storage.get<StoredRoom>('room');
      if (stored) {
        this.phase = stored.phase;
        this.countdownEndsAt = stored.countdownEndsAt;
        this.finishOrder = stored.finishOrder;
        this.channelId = stored.channelId ?? null;
        this.raceId = stored.raceId ?? null;
        this.rngState = stored.rngState ?? 0;
        this.boxes = new Map(stored.boxes ?? []);
        this.inventory = migrateInventoryKeys(
          stored.inventory ?? [],
          raceFieldSize(this.env.MAX_PLAYERS),
        );
        this.members = new Map(
          (stored.members ?? []).filter(isMember).map((member) => [member.userId, { ...member }]),
        );
      }

      // Storage is a fallback for members without a live connection. The
      // socket attachment is the freshest snapshot for connected members and
      // survives hibernation with the WebSocket.
      for (const member of this.members.values()) {
        member.connected = false;
        member.ready = false;
      }
      const restored: { ws: WebSocket; attachment: RoomAttachment }[] = [];
      for (const ws of this.ctx.getWebSockets()) {
        // getWebSockets() may include sockets whose close handshake has begun.
        // Those must not make a stored member look connected after wake-up.
        if (ws.readyState !== WebSocket.OPEN) continue;
        const attachment = readAttachment(ws);
        if (!attachment) {
          ws.close(4000, 'invalid socket attachment');
          continue;
        }
        restored.push({ ws, attachment });
        this.sockets.set(ws, attachment.userId);
        if (attachment.member) {
          const current = this.members.get(attachment.userId);
          if (!current || attachment.member.lastSeen >= current.lastSeen) {
            this.members.set(attachment.userId, { ...attachment.member });
          }
        }
      }
      for (const { attachment } of restored) {
        if (!this.members.has(attachment.userId)) {
          this.members.set(attachment.userId, this.restoredLegacyMember(attachment));
        }
        this.members.get(attachment.userId)!.connected = true;
      }
      this.syncMemberAttachments();
      if (stored || restored.length > 0) {
        await this.persist();
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
      const attachment: RoomAttachment = {
        userId,
        displayName: decodeURIComponent(displayName),
        role,
      };
      const admission = this.admissionProblem(channelId, attachment);
      if (admission) return new Response(admission.message, { status: admission.status });

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      await this.join(attachment, server);
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === '/exists') {
      if (!this.initialized()) return new Response('unknown room', { status: 404 });
      const channelId = request.headers.get('x-kr-channel');
      const userId = request.headers.get('x-kr-user');
      const role = request.headers.get('x-kr-role');
      if (channelId && userId && isRole(role)) {
        const admission = this.admissionProblem(channelId, {
          userId,
          displayName: '',
          role,
        });
        if (admission) return new Response(admission.message, { status: admission.status });
      } else if (channelId && channelId !== this.channelId) {
        return new Response('channel mismatch', { status: 403 });
      }
      return Response.json({ ok: true, channelId: this.channelId, phase: this.phase });
    }

    // The Worker initialises a freshly created room with its channel, so the
    // room can keep the channel registry listing current as it changes phase.
    if (url.pathname === '/admin/init' && request.method === 'POST') {
      if (this.initialized()) return new Response('room already initialized', { status: 409 });
      const body: unknown = await request.json().catch(() => null);
      if (typeof body !== 'object' || body === null) return new Response('expected JSON object', { status: 400 });
      const channelId = (body as { channelId?: unknown }).channelId;
      const raceId = (body as { raceId?: unknown }).raceId;
      const creator = (body as { creator?: unknown }).creator;
      if (typeof channelId !== 'string' || !channelId) return new Response('channelId required', { status: 400 });
      if (typeof raceId !== 'string' || !raceId) return new Response('raceId required', { status: 400 });
      if (typeof creator !== 'object' || creator === null) {
        return new Response('creator required', { status: 400 });
      }
      const creatorUserId = (creator as { userId?: unknown }).userId;
      const creatorDisplayName = (creator as { displayName?: unknown }).displayName;
      if (typeof creatorUserId !== 'string' || !creatorUserId) {
        return new Response('creator userId required', { status: 400 });
      }
      if (typeof creatorDisplayName !== 'string' || !creatorDisplayName) {
        return new Response('creator displayName required', { status: 400 });
      }
      this.channelId = channelId;
      this.raceId = raceId;
      this.members.set(creatorUserId, {
        userId: creatorUserId,
        displayName: creatorDisplayName,
        role: 'player',
        slot: 0,
        ready: false,
        host: true,
        connected: false,
        lastSeen: Date.now(),
        kartState: null,
        lap: 0,
        cp: -1,
        raceDistance: 0,
        finished: false,
        finishTime: null,
        place: null,
      });
      // Seed the room's draw generator once, at creation.
      this.rngState = new Uint32Array(crypto.getRandomValues(new Uint8Array(4)).buffer)[0] || 1;
      await this.persist();
      await this.scheduleNextAlarm();
      return new Response('ok');
    }
    return new Response('not found', { status: 404 });
  }

  // -------------------------------------------------------------------------
  //  Membership
  // -------------------------------------------------------------------------

  private initialized(): boolean {
    return this.channelId !== null && this.raceId !== null;
  }

  private admissionProblem(
    channelId: string,
    attachment: RoomAttachment,
  ): { status: number; message: string } | null {
    if (!this.initialized()) return { status: 404, message: 'unknown room' };
    if (channelId !== this.channelId) return { status: 403, message: 'channel mismatch' };
    const existing = this.members.get(attachment.userId);
    if (existing && existing.role !== attachment.role) {
      return { status: 409, message: 'member role does not match' };
    }
    if (attachment.role === 'player' && this.phase !== 'lobby' && !existing) {
      return { status: 409, message: 'race already started' };
    }
    return null;
  }

  private restoredLegacyMember(attachment: RoomAttachment): Member {
    const now = Date.now();
    const taken = new Set(
      [...this.members.values()].filter((member) => member.slot !== null).map((member) => member.slot),
    );
    let slot: number | null = null;
    if (attachment.role === 'player') {
      const maxPlayers = raceFieldSize(this.env.MAX_PLAYERS);
      for (let candidate = 0; candidate < maxPlayers; candidate++) {
        if (!taken.has(candidate)) {
          slot = candidate;
          break;
        }
      }
    }
    return {
      userId: attachment.userId,
      displayName: attachment.displayName,
      role: slot === null && attachment.role === 'player' ? 'spectator' : attachment.role,
      slot,
      ready: false,
      host: slot !== null && ![...this.members.values()].some((member) => member.host),
      connected: true,
      lastSeen: now,
      kartState: null,
      lap: 0,
      cp: -1,
      raceDistance: 0,
      finished: false,
      finishTime: null,
      place: null,
    };
  }

  private async join(attachment: RoomAttachment, ws: WebSocket): Promise<void> {
    const now = Date.now();
    const existing = this.members.get(attachment.userId);
    const maxPlayers = raceFieldSize(this.env.MAX_PLAYERS);

    // A reconnect supersedes every older connection for the same identity.
    // Delete first so a later close/error callback from the old socket cannot
    // mark the replacement connection as disconnected.
    for (const [other, userId] of this.sockets) {
      if (other === ws || userId !== attachment.userId) continue;
      this.sockets.delete(other);
      try {
        other.close(4002, 'replaced by reconnect');
      } catch {
        /* socket already gone */
      }
    }
    this.sockets.set(ws, attachment.userId);

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
        this.sockets.delete(ws);
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
        this.sockets.delete(ws);
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
    this.writeMemberAttachment(ws, member);
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
    this.sendItemSync(ws);
    this.broadcast({
      v: PROTOCOL_VERSION,
      type: 'roster',
      roster: this.roster(),
    });
    this.reportRegistry('update');
    // Late joiners need the current box state to render an honest course.
    const down = [...this.boxes.entries()].map(([box, until]) => ({ box, until }));
    if (down.length) this.send(ws, { v: PROTOCOL_VERSION, type: 'box_sync', down });
    await Promise.all([this.persist(), this.scheduleNextAlarm()]);
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

  private writeMemberAttachment(ws: WebSocket, member: Member): void {
    ws.serializeAttachment({
      userId: member.userId,
      displayName: member.displayName,
      role: member.role,
      member: { ...member },
    } satisfies RoomAttachment);
  }

  private syncMemberAttachments(userId?: string): void {
    for (const [ws, socketUserId] of this.sockets) {
      if (userId && socketUserId !== userId) continue;
      const member = this.members.get(socketUserId);
      if (member) this.writeMemberAttachment(ws, member);
    }
  }

  private hasSocketFor(userId: string): boolean {
    for (const [ws, socketUserId] of this.sockets) {
      if (socketUserId === userId && ws.readyState === WebSocket.OPEN) return true;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  //  Socket handlers (hibernatable)
  // -------------------------------------------------------------------------

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    let userId = this.sockets.get(ws);
    if (!userId) {
      userId = readAttachment(ws)?.userId;
      if (userId) this.sockets.set(ws, userId);
    }
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
    try {
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
        case 'item_carry_consumed':
          await this.onItemCarryConsumed(ws, member, parsed);
          return;
        case 'hit_claim':
          this.onHitClaim(member, parsed);
          return;
        case 'ping':
          this.send(ws, { v: PROTOCOL_VERSION, type: 'pong', at: parsed.at, serverTime: Date.now() });
          return;
      }
    } finally {
      this.syncMemberAttachments(userId);
    }
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    const userId = this.sockets.get(ws) ?? readAttachment(ws)?.userId;
    this.sockets.delete(ws);
    if (!userId) return;
    // A replaced connection can close after its successor is already active.
    if (this.hasSocketFor(userId)) return;
    const member = this.members.get(userId);
    if (!member || !member.connected) return;
    member.connected = false;
    member.ready = false;
    member.lastSeen = Date.now();
    await this.persist();
    this.broadcast({ v: PROTOCOL_VERSION, type: 'peer_leave', userId });
    this.broadcast({ v: PROTOCOL_VERSION, type: 'roster', roster: this.roster() });
    // Hold the slot for the grace period, then free it.
    await this.scheduleNextAlarm();
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
    const players = [...this.members.values()].filter(
      (m) => m.role === 'player' && m.slot !== null,
    );
    if (players.length === 0 || players.some((m) => !m.connected || !m.ready)) {
      this.send(ws, { v: PROTOCOL_VERSION, type: 'error', code: 'not_ready', message: 'Every slotted player must be connected and ready.' });
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
    this.syncMemberAttachments();
    this.broadcast({ v: PROTOCOL_VERSION, type: 'countdown', endsAt: this.countdownEndsAt });
    this.ctx.waitUntil(
      Promise.all([this.persist(), this.scheduleNextAlarm()]).then(
        () => undefined,
      ),
    );
    this.reportRegistry('update');
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
      this.ctx.waitUntil(
        Promise.all([this.persist(), this.scheduleNextAlarm()]).then(
          () => undefined,
        ),
      );
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
    if (!kartKey || kartKey === 'self') {
      return member.role === 'player' && member.slot !== null
        ? `${USER_INVENTORY_PREFIX}${member.userId}`
        : null;
    }

    const slot = aiKartSlot(kartKey, raceFieldSize(this.env.MAX_PLAYERS));
    if (slot === null || !member.host || member.role !== 'player' || member.slot === null) {
      return null;
    }
    // A networked player owns their assigned grid slot. Only empty field slots
    // are host-simulated AI backfill and therefore eligible for AI inventory.
    if ([...this.members.values()].some((candidate) =>
      candidate.role === 'player' && candidate.slot === slot
    )) {
      return null;
    }
    return `${AI_INVENTORY_PREFIX}${slot}`;
  }

  private inventorySync(): ItemInventoryWire[] {
    const host = [...this.members.values()].find((member) => member.host);
    const maxPlayers = raceFieldSize(this.env.MAX_PLAYERS);
    const items: ItemInventoryWire[] = [];
    for (const [key, entry] of this.inventory) {
      if (entry.count <= 0) continue;
      if (key.startsWith(USER_INVENTORY_PREFIX)) {
        const userId = key.slice(USER_INVENTORY_PREFIX.length);
        if (!userId) continue;
        items.push({
          userId,
          kartKey: 'self',
          kind: entry.kind,
          count: entry.count,
          carried: entry.carried === true,
          armUntil: entry.armUntil,
        });
        continue;
      }
      const slot = aiKartSlot(key, maxPlayers);
      if (slot === null || !host) continue;
      items.push({
        userId: host.userId,
        kartKey: `${AI_INVENTORY_PREFIX}${slot}`,
        kind: entry.kind,
        count: entry.count,
        carried: entry.carried === true,
        armUntil: entry.armUntil,
      });
    }
    return items.sort((a, b) =>
      a.userId.localeCompare(b.userId) || a.kartKey.localeCompare(b.kartKey)
    );
  }

  private sendItemSync(ws: WebSocket): void {
    this.send(ws, {
      v: PROTOCOL_VERSION,
      type: 'item_sync',
      items: this.inventorySync(),
    });
  }

  private broadcastItemSync(): void {
    this.broadcast({
      v: PROTOCOL_VERSION,
      type: 'item_sync',
      items: this.inventorySync(),
    });
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

    // Placement is against the complete race field, not connected room
    // members: AI backfill occupies every remaining grid slot.
    const kind = rollItem(
      () => this.nextRandom(),
      msg.place,
      raceFieldSize(this.env.MAX_PLAYERS),
    );
    const count = kind === TRIPLE_MUSHROOM_KIND ? TRIPLE_COUNT : 1;
    this.inventory.set(key, {
      kind,
      count,
      armUntil: now + ARM_TIME_S * 1000,
    });
    const respawnAt = now + BOX_RESPAWN_S * 1000;
    this.boxes.set(msg.box, respawnAt);
    this.ctx.waitUntil(
      Promise.all([this.persist(), this.scheduleNextAlarm()]).then(
        () => undefined,
      ),
    );

    this.send(ws, {
      v: PROTOCOL_VERSION,
      type: 'item_granted',
      userId: member.userId,
      kartKey: msg.kartKey ?? 'self',
      kind,
      count,
    });
    this.broadcast({ v: PROTOCOL_VERSION, type: 'box_down', box: msg.box, until: respawnAt });
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

    if (held.carried) {
      // A second use releases the already-deployed shield. It consumes the
      // inventory exactly once and must never ask peers to spawn another tow.
      if (msg.carry) {
        this.send(ws, { v: PROTOCOL_VERSION, type: 'item_denied', userId: member.userId, kartKey, reason: 'invalid_use' });
        return;
      }
    } else {
      // Carry is derived from the item contract, not trusted client input.
      // Reject contradictory flags because the owner would otherwise create a
      // tow while peers rendered a throw (or vice versa).
      const shouldCarry = msg.backwards && isCarryableItemKind(held.kind);
      if (msg.carry !== shouldCarry) {
        this.send(ws, { v: PROTOCOL_VERSION, type: 'item_denied', userId: member.userId, kartKey, reason: 'invalid_use' });
        return;
      }
      if (shouldCarry) {
        held.carried = true;
        this.ctx.waitUntil(this.persist());
        this.broadcast({
          v: PROTOCOL_VERSION,
          type: 'item_used',
          userId: member.userId,
          kartKey,
          kind: msg.kind,
          backwards: msg.backwards,
          carry: true,
          target: msg.target,
        });
        return;
      }
    }

    held.count--;
    if (held.count <= 0) this.inventory.delete(key);
    this.ctx.waitUntil(this.persist());
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

  private async onItemCarryConsumed(
    ws: WebSocket,
    member: Member,
    msg: ClientItemCarryConsumed,
  ): Promise<void> {
    if (this.phase !== 'running' && this.phase !== 'countdown') return;
    const kartKey = msg.kartKey ?? 'self';
    const key = this.inventoryKey(member, msg.kartKey);
    if (!key) {
      this.send(ws, {
        v: PROTOCOL_VERSION,
        type: 'item_denied',
        userId: member.userId,
        kartKey,
        reason: 'not_your_kart',
      });
      return;
    }
    const held = this.inventory.get(key);
    if (!held || held.kind !== msg.kind || held.count <= 0 || held.carried !== true) {
      this.send(ws, {
        v: PROTOCOL_VERSION,
        type: 'item_denied',
        userId: member.userId,
        kartKey,
        reason: 'invalid_carry',
      });
      return;
    }

    this.inventory.delete(key);
    // Persist before announcing consumption so an eviction cannot resurrect a
    // shield that every live client has already destroyed or dropped.
    await this.persist();
    this.broadcast({
      v: PROTOCOL_VERSION,
      type: 'item_carry_consumed',
      userId: member.userId,
      kartKey,
      kind: msg.kind,
      disposition: msg.disposition,
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
      this.reportRegistry('update');
    }
    this.sweepBoxes();
    const graceMs = (Number(this.env.DISCONNECT_GRACE_SECONDS) || 45) * 1000;
    const now = Date.now();
    let rosterChanged = false;
    for (const member of this.members.values()) {
      if (!member.connected && now - member.lastSeen > graceMs) {
        if (this.phase === 'lobby' || this.phase === 'finished') {
          this.members.delete(member.userId);
          rosterChanged = true;
        } else {
          // Mid-race: free the slot but keep the result-eligible record.
          if (member.slot !== null || member.role !== 'spectator') {
            rosterChanged = true;
          }
          member.slot = null;
          member.role = 'spectator';
        }
      }
    }
    if (rosterChanged || [...this.members.values()].some((m) => !m.connected)) {
      this.broadcast({ v: PROTOCOL_VERSION, type: 'roster', roster: this.roster() });
    }
    // Host migration: the earliest connected player becomes host.
    const players = [...this.members.values()].filter((m) => m.role === 'player' && m.connected);
    if (players.length && !players.some((m) => m.host)) {
      players.sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99));
      players[0].host = true;
      for (const m of this.members.values()) if (!players.includes(m)) m.host = false;
      rosterChanged = true;
      this.broadcast({ v: PROTOCOL_VERSION, type: 'roster', roster: this.roster() });
      this.broadcastItemSync();
    }
    this.syncMemberAttachments();
    const abandoned =
      (this.phase === 'countdown' || this.phase === 'running') &&
      ![...this.members.values()].some(
        (member) => member.role === 'player' && member.slot !== null,
      );
    if (abandoned) {
      // Everyone who could drive has exhausted their reconnect lease. Retire
      // the room instead of preserving a running DO forever for spectators.
      for (const ws of this.sockets.keys()) {
        try {
          ws.close(1001, 'race abandoned');
        } catch {
          /* socket already gone */
        }
      }
      this.sockets.clear();
      this.members.clear();
    }
    if (this.members.size === 0) {
      this.reportRegistry('remove');
      await this.ctx.storage.delete('room');
      await this.ctx.storage.deleteAlarm();
      this.phase = 'lobby';
      this.countdownEndsAt = null;
      this.finishOrder = [];
      this.boxes.clear();
      this.inventory.clear();
      this.channelId = null;
      this.raceId = null;
      return;
    }
    if (rosterChanged) this.reportRegistry('update');
    await this.persist();
    await this.scheduleNextAlarm();
  }

  /** Schedule the earliest countdown, box respawn, or disconnect expiry. */
  private async scheduleNextAlarm(): Promise<void> {
    const candidates: number[] = [];
    if (this.phase === 'countdown' && this.countdownEndsAt !== null) {
      candidates.push(this.countdownEndsAt);
    }
    for (const until of this.boxes.values()) candidates.push(until);
    const graceMs = (Number(this.env.DISCONNECT_GRACE_SECONDS) || 45) * 1000;
    const shouldRemove = this.phase === 'lobby' || this.phase === 'finished';
    for (const member of this.members.values()) {
      if (!member.connected && (member.slot !== null || shouldRemove)) {
        candidates.push(member.lastSeen + graceMs + 1);
      }
    }

    const current = await this.ctx.storage.getAlarm();
    if (candidates.length === 0) {
      if (current !== null) await this.ctx.storage.deleteAlarm();
      return;
    }

    const scheduledAt = Math.max(Date.now() + 1, Math.min(...candidates));
    if (current === null || current <= Date.now() || current > scheduledAt) {
      await this.ctx.storage.setAlarm(scheduledAt);
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
      members: [...this.members.values()],
    } satisfies StoredRoom);
  }

  /** Keep the channel registry's listing in step with this room's lifecycle. */
  private reportRegistry(action: 'update' | 'remove'): void {
    if (!this.channelId || !this.raceId) return;
    const stub = this.env.RACE_REGISTRY.get(this.env.RACE_REGISTRY.idFromName(this.channelId));
    const players = [...this.members.values()].filter(
      // A disconnected player's slot remains occupied during the grace lease;
      // discovery must not advertise capacity that the room cannot admit.
      (m) => m.role === 'player' && m.slot !== null,
    ).length;
    const host = [...this.members.values()].find((m) => m.host)?.displayName;
    this.ctx.waitUntil(
      stub.fetch(new Request(`https://registry/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          raceId: this.raceId,
          phase: this.phase,
          players,
          ...(host ? { host } : {}),
        }),
      })).catch(() => {}),
    );
  }

  private raceId: string | null = null;
}
