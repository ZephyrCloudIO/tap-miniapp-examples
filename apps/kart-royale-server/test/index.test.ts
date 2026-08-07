import { describe, expect, it } from 'vitest';
import {
  SELF,
  env,
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
} from 'cloudflare:test';
import { trackMath } from '../src/trackAuthority';
import type { ServerMessage } from '@tap-examples/kart-royale-protocol';
import worker from '../src/index';

// vitest-pool-workers 0.18.6 declares eviction against an untyped DO stub even
// though the runtime supports generated, RPC-typed namespaces. Add the missing
// typed overload locally until the package declaration catches up.
declare module 'cloudflare:test' {
  export function evictDurableObject<T extends Rpc.DurableObjectBranded>(
    stub: DurableObjectStub<T>,
    options?: DurableObjectEvictionOptions,
  ): Promise<void>;
  export function runDurableObjectAlarm<T extends Rpc.DurableObjectBranded>(
    stub: DurableObjectStub<T>,
  ): Promise<boolean>;
}

const BASE = 'http://localhost';

interface CreatedRoom {
  raceId: string;
  ticket: string;
  wsUrl: string;
}

async function createRoom(user: string, name = user, channelId = 'chan-1'): Promise<CreatedRoom> {
  const res = await SELF.fetch(`${BASE}/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ channelId, userId: user, displayName: name }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as CreatedRoom;
}

async function joinRoom(
  raceId: string,
  user: string,
  role = 'player',
  name = user,
  channelId = 'chan-1',
): Promise<CreatedRoom> {
  const res = await SELF.fetch(`${BASE}/rooms/${raceId}/tickets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ channelId, userId: user, displayName: name, role }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as CreatedRoom;
}

class TestSocket {
  readonly messages: ServerMessage[] = [];
  private waiters: { match: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = [];

  private constructor(private readonly ws: WebSocket) {
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data)) as ServerMessage;
      this.messages.push(msg);
      this.waiters = this.waiters.filter((w) => {
        if (w.match(msg)) {
          w.resolve(msg);
          return false;
        }
        return true;
      });
    });
  }

  static async open(wsUrl: string): Promise<TestSocket> {
    const res = await SELF.fetch(wsUrl.replace('ws://', 'http://').replace('wss://', 'https://'), {
      headers: { Upgrade: 'websocket' },
    });
    expect(res.status).toBe(101);
    const ws = res.webSocket!;
    ws.accept();
    return new TestSocket(ws);
  }

  send(message: unknown): void {
    this.ws.send(JSON.stringify(message));
  }

  close(): void {
    this.ws.close();
  }

  async waitFor(
    match: (m: ServerMessage) => boolean,
    timeoutMs = 3000,
    afterIndex = 0,
  ): Promise<ServerMessage> {
    const existing = this.messages.slice(afterIndex).find(match);
    if (existing) return existing;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for message')), timeoutMs);
      this.waiters.push({
        match,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
      });
    });
  }
}

function validStateAt(t: number, seq = 1) {
  const math = trackMath();
  const sample = math.sample(t);
  return {
    t,
    pos: [sample.pos[0], sample.pos[1], sample.pos[2]] as [number, number, number],
    quat: [0, 0, 0, 1] as [number, number, number, number],
    vel: [0, 0, 10] as [number, number, number],
    driftDir: 0,
    driftCharge: 0,
    stun: 0,
    star: 0,
    boost: 0,
    seq,
  };
}

const env1 = { v: 1 };

describe('kart-royale-server', () => {
  it('answers liveness', async () => {
    const res = await SELF.fetch(`${BASE}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it('rejects room creation without an identity', async () => {
    const res = await SELF.fetch(`${BASE}/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channelId: 'chan-1' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects a websocket upgrade with a tampered ticket', async () => {
    const room = await createRoom('user-a');
    const bad = `${room.wsUrl.slice(0, -2)}xx`;
    const res = await SELF.fetch(bad.replace('ws://', 'http://'), {
      headers: { Upgrade: 'websocket' },
    });
    expect(res.status).toBe(401);
  });

  it('rejects a websocket upgrade with a malformed ticket signature', async () => {
    const room = await createRoom('user-malformed-ticket');
    const bad = new URL(room.wsUrl);
    const ticket = bad.searchParams.get('ticket');
    expect(ticket).not.toBeNull();
    const payload = ticket!.slice(0, ticket!.lastIndexOf('.'));
    bad.searchParams.set('ticket', `${payload}.%%%`);

    const res = await SELF.fetch(
      bad.toString().replace('ws://', 'http://').replace('wss://', 'https://'),
      { headers: { Upgrade: 'websocket' } },
    );

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'invalid or expired ticket' });
  });

  it('reserves slot zero and host authority for the verified room creator', async () => {
    const creator = await createRoom('user-reserved-creator', 'Creator');
    const guest = await joinRoom(creator.raceId, 'user-racing-guest', 'player', 'Guest');

    // The guest deliberately upgrades first; creation order, not socket order,
    // determines host authority and grid slot ownership.
    const guestSocket = await TestSocket.open(guest.wsUrl);
    const guestWelcome = (await guestSocket.waitFor(
      (message) => message.type === 'welcome',
    )) as Extract<ServerMessage, { type: 'welcome' }>;
    expect(guestWelcome).toMatchObject({ userId: 'user-racing-guest', slot: 1 });
    expect(guestWelcome.roster).toEqual(expect.arrayContaining([
      expect.objectContaining({
        userId: 'user-reserved-creator',
        slot: 0,
        host: true,
        connected: false,
      }),
      expect.objectContaining({
        userId: 'user-racing-guest',
        slot: 1,
        host: false,
        connected: true,
      }),
    ]));

    const creatorSocket = await TestSocket.open(creator.wsUrl);
    const creatorWelcome = (await creatorSocket.waitFor(
      (message) => message.type === 'welcome',
    )) as Extract<ServerMessage, { type: 'welcome' }>;
    expect(creatorWelcome).toMatchObject({ userId: 'user-reserved-creator', slot: 0 });
    expect(creatorWelcome.roster).toContainEqual(expect.objectContaining({
      userId: 'user-reserved-creator',
      host: true,
      connected: true,
    }));

    guestSocket.close();
    creatorSocket.close();
  });

  it('removes a reserved creator who never upgrades after disconnect grace', async () => {
    const room = await createRoom('user-abandoned-creator', 'Abandoned');
    const stub = env.RACE_ROOM.get(env.RACE_ROOM.idFromName(room.raceId));

    await new Promise((resolve) => setTimeout(resolve, 1100));
    await runDurableObjectAlarm(stub);

    const ticket = await SELF.fetch(`${BASE}/rooms/${room.raceId}/tickets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        channelId: 'chan-1',
        userId: 'user-after-abandonment',
        displayName: 'Too Late',
        role: 'player',
      }),
    });
    expect(ticket.status).toBe(404);

    const listed = await SELF.fetch(`${BASE}/channels/chan-1/rooms`);
    const body = (await listed.json()) as { rooms: { raceId: string }[] };
    expect(body.rooms).not.toContainEqual(expect.objectContaining({ raceId: room.raceId }));
  });

  it('requires platform authentication for channel discovery in production', async () => {
    const productionEnv = {
      ALLOW_DEV_IDENTITY: 'false',
      TAP_JWT_ISSUER: '',
      TAP_JWT_AUDIENCE: '',
    } as Env;

    const missing = await worker.fetch(
      new Request(`${BASE}/channels/chan-private/rooms`),
      productionEnv,
    );
    expect(missing.status).toBe(401);

    const invalid = await worker.fetch(
      new Request(`${BASE}/channels/chan-private/rooms`, {
        headers: { authorization: 'Bearer invalid-platform-session' },
      }),
      productionEnv,
    );
    expect(invalid.status).toBe(401);
  });

  it('rejects ticket minting for uninitialised rooms and channel mismatches', async () => {
    const missing = await SELF.fetch(`${BASE}/rooms/${crypto.randomUUID()}/tickets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        channelId: 'chan-1',
        userId: 'user-missing-room',
        displayName: 'Missing',
        role: 'player',
      }),
    });
    expect(missing.status).toBe(404);

    const room = await createRoom('user-channel-host', 'ChannelHost', 'chan-private');
    const mismatch = await SELF.fetch(`${BASE}/rooms/${room.raceId}/tickets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        channelId: 'chan-other',
        userId: 'user-channel-guest',
        displayName: 'WrongChannel',
        role: 'player',
      }),
    });
    expect(mismatch.status).toBe(403);
  });

  it('blocks new players after the lobby while allowing reconnects and spectators', async () => {
    const host = await createRoom('user-late-host');
    // Mint while the room is still open, then hold the ticket until after start.
    const heldTicket = await joinRoom(host.raceId, 'user-held-ticket');
    const hostSocket = await TestSocket.open(host.wsUrl);
    await hostSocket.waitFor((m) => m.type === 'welcome');
    hostSocket.send({ v: 1, type: 'ready', ready: true });
    hostSocket.send({ v: 1, type: 'start' });
    await hostSocket.waitFor((m) => m.type === 'race_start', 5000);

    const latePlayer = await SELF.fetch(`${BASE}/rooms/${host.raceId}/tickets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        channelId: 'chan-1',
        userId: 'user-late-player',
        displayName: 'LatePlayer',
        role: 'player',
      }),
    });
    expect(latePlayer.status).toBe(409);

    // Admission is checked again at upgrade time so a lobby-era ticket cannot
    // be held and used to become a new racer once the countdown has started.
    const heldUpgrade = await SELF.fetch(
      heldTicket.wsUrl.replace('ws://', 'http://').replace('wss://', 'https://'),
      { headers: { Upgrade: 'websocket' } },
    );
    expect(heldUpgrade.status).toBe(409);

    // A known player may still reconnect to the same slot mid-race.
    const reconnectedHost = await TestSocket.open(host.wsUrl);
    const reconnectWelcome = (await reconnectedHost.waitFor(
      (m) => m.type === 'welcome',
    )) as Extract<ServerMessage, { type: 'welcome' }>;
    expect(reconnectWelcome).toMatchObject({ phase: 'running', slot: 0 });

    const spectator = await joinRoom(host.raceId, 'user-late-spectator', 'spectator');
    const spectatorSocket = await TestSocket.open(spectator.wsUrl);
    const spectatorWelcome = (await spectatorSocket.waitFor(
      (m) => m.type === 'welcome',
    )) as Extract<ServerMessage, { type: 'welcome' }>;
    expect(spectatorWelcome).toMatchObject({ phase: 'running', slot: null });
    expect(spectatorWelcome.roster).toContainEqual(
      expect.objectContaining({ userId: 'user-late-spectator', role: 'spectator', slot: null }),
    );

    hostSocket.close();
    reconnectedHost.close();
    spectatorSocket.close();
  });

  it('restores the roster after hibernation and handles a hibernated close once', async () => {
    const host = await createRoom('user-hibernate-host');
    const guest = await joinRoom(host.raceId, 'user-hibernate-guest');
    const a = await TestSocket.open(host.wsUrl);
    const b = await TestSocket.open(guest.wsUrl);
    await b.waitFor((m) => m.type === 'welcome');
    a.send({ v: 1, type: 'ready', ready: true });
    b.send({ v: 1, type: 'ready', ready: true });
    await b.waitFor((m) => m.type === 'roster' && m.roster.every((member) => member.ready));

    const stub = env.RACE_ROOM.get(env.RACE_ROOM.idFromName(host.raceId));
    await evictDurableObject(stub);

    const afterEviction = b.messages.length;
    b.send({ v: 1, type: 'hello', displayName: 'Guest', role: 'player' });
    const restored = (await b.waitFor(
      (m) => m.type === 'roster' && m.roster.length === 2 && m.roster.every((member) => member.connected),
      3000,
      afterEviction,
    )) as Extract<ServerMessage, { type: 'roster' }>;
    expect(restored.roster).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: 'user-hibernate-host', slot: 0, host: true, ready: true }),
        expect.objectContaining({ userId: 'user-hibernate-guest', slot: 1, ready: true }),
      ]),
    );

    const beforeClose = b.messages.length;
    a.close();
    const disconnected = (await b.waitFor(
      (m) => m.type === 'roster' && m.roster.some(
        (member) => member.userId === 'user-hibernate-host' && !member.connected && member.slot === 0,
      ),
      3000,
      beforeClose,
    )) as Extract<ServerMessage, { type: 'roster' }>;
    expect(disconnected.roster.find((member) => member.userId === 'user-hibernate-guest')?.connected).toBe(true);
    b.close();
  });

  it('does not let a superseded socket disconnect its replacement', async () => {
    const host = await createRoom('user-duplicate-host');
    const original = await TestSocket.open(host.wsUrl);
    await original.waitFor((m) => m.type === 'welcome');

    const replacement = await TestSocket.open(host.wsUrl);
    await replacement.waitFor((m) => m.type === 'welcome');
    const afterReplacement = replacement.messages.length;

    original.close();
    replacement.send({ v: 1, type: 'hello', displayName: 'Host', role: 'player' });
    const roster = (await replacement.waitFor(
      (m) => m.type === 'roster' && m.roster.some(
        (member) => member.userId === 'user-duplicate-host' && member.connected,
      ),
      3000,
      afterReplacement,
    )) as Extract<ServerMessage, { type: 'roster' }>;
    expect(roster.roster).toContainEqual(
      expect.objectContaining({ userId: 'user-duplicate-host', connected: true, slot: 0, host: true }),
    );
    replacement.close();
  });

  it('does not start while a slotted player is disconnected', async () => {
    const host = await createRoom('user-start-host');
    const guest = await joinRoom(host.raceId, 'user-start-guest');
    const a = await TestSocket.open(host.wsUrl);
    const b = await TestSocket.open(guest.wsUrl);
    await b.waitFor((m) => m.type === 'welcome');
    a.send({ v: 1, type: 'ready', ready: true });
    b.send({ v: 1, type: 'ready', ready: true });
    await a.waitFor((m) => m.type === 'roster' && m.roster.every((member) => member.ready));

    b.close();
    await a.waitFor(
      (m) =>
        m.type === 'roster' &&
        m.roster.some(
          (member) =>
            member.userId === 'user-start-guest' &&
            !member.connected &&
            member.slot === 1,
        ),
    );
    const afterDisconnect = a.messages.length;

    a.send({ v: 1, type: 'start' });
    await a.waitFor((m) => m.type === 'error' && m.code === 'not_ready');

    // Once the lease expires the vacated slot becomes AI backfill, so the
    // remaining ready host can start without locking a frozen remote kart.
    await a.waitFor(
      (m) =>
        m.type === 'roster' &&
        !m.roster.some((member) => member.userId === 'user-start-guest'),
      8000,
      afterDisconnect,
    );
    const beforeSecondStart = a.messages.length;
    a.send({ v: 1, type: 'start' });
    const secondStart = await a.waitFor(
      (m) => m.type === 'countdown' || m.type === 'error',
      3000,
      beforeSecondStart,
    );
    expect(secondStart).toMatchObject({ type: 'countdown' });
    await a.waitFor((m) => m.type === 'race_start', 5000);
    a.close();
  }, 10_000);

  it('lists created rooms in the channel registry', async () => {
    const room = await createRoom('user-list-host', 'ListHost');
    const res = await SELF.fetch(`${BASE}/channels/chan-1/rooms`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rooms: { raceId: string; host: string; phase: string }[] };
    expect(body.rooms.some((r) => r.raceId === room.raceId && r.host === 'ListHost' && r.phase === 'lobby')).toBe(true);
  });

  it('keeps a disconnected slot reserved in discovery until its lease expires', async () => {
    const host = await createRoom('user-capacity-0', 'CapacityHost');
    const tickets = await Promise.all(
      Array.from({ length: 7 }, (_, index) =>
        joinRoom(host.raceId, `user-capacity-${index + 1}`),
      ),
    );
    const sockets: TestSocket[] = [];
    for (const joined of [host, ...tickets]) {
      const socket = await TestSocket.open(joined.wsUrl);
      await socket.waitFor((m) => m.type === 'welcome');
      sockets.push(socket);
    }

    const listedPlayers = async (): Promise<number | undefined> => {
      const response = await SELF.fetch(`${BASE}/channels/chan-1/rooms`);
      const body = (await response.json()) as {
        rooms: { raceId: string; players: number }[];
      };
      return body.rooms.find((room) => room.raceId === host.raceId)?.players;
    };
    const waitForListedPlayers = async (expected: number): Promise<void> => {
      for (let attempt = 0; attempt < 40; attempt++) {
        if (await listedPlayers() === expected) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(await listedPlayers()).toBe(expected);
    };

    await waitForListedPlayers(8);
    const observer = sockets[0]!;
    sockets[7]!.close();
    await observer.waitFor(
      (m) =>
        m.type === 'roster' &&
        m.roster.some(
          (member) =>
            member.userId === 'user-capacity-7' &&
            !member.connected &&
            member.slot === 7,
        ),
    );
    const afterDisconnect = observer.messages.length;
    expect(await listedPlayers()).toBe(8);

    await observer.waitFor(
      (m) =>
        m.type === 'roster' &&
        !m.roster.some((member) => member.userId === 'user-capacity-7'),
      8000,
      afterDisconnect,
    );
    await waitForListedPlayers(7);
    for (const socket of sockets.slice(0, 7)) socket.close();
  }, 15_000);

  it('relays AI backfill kart states under their kartKey', async () => {
    const host = await createRoom('user-ai-host');
    const guest = await joinRoom(host.raceId, 'user-ai-guest');
    const a = await TestSocket.open(host.wsUrl);
    const b = await TestSocket.open(guest.wsUrl);
    await b.waitFor((m) => m.type === 'welcome');
    a.send({ v: 1, type: 'ready', ready: true });
    b.send({ v: 1, type: 'ready', ready: true });
    await b.waitFor((m) => m.type === 'roster' && m.roster.every((r) => r.ready));
    a.send({ v: 1, type: 'start' });
    await b.waitFor((m) => m.type === 'race_start', 5000);

    const aiState = validStateAt(0.4, 7);
    a.send({ v: 1, type: 'state', state: aiState, lap: 0, cp: -1, raceDistance: 55, kartKey: 'ai:2' });
    const relay = (await b.waitFor((m) => m.type === 'peer_state')) as Extract<
      ServerMessage,
      { type: 'peer_state' }
    >;
    expect(relay.userId).toBe('user-ai-host');
    expect(relay.kartKey).toBe('ai:2');
    expect(relay.raceDistance).toBe(55);
    expect(relay.state.seq).toBe(7);

    a.close();
    b.close();
  });

  it('arbitrates item draws, spends, hits and box respawns', async () => {
    const host = await createRoom('user-item-host');
    const guest = await joinRoom(host.raceId, 'user-item-guest');
    const a = await TestSocket.open(host.wsUrl);
    const b = await TestSocket.open(guest.wsUrl);
    await b.waitFor((m) => m.type === 'welcome');
    a.send({ v: 1, type: 'ready', ready: true });
    b.send({ v: 1, type: 'ready', ready: true });
    a.send({ v: 1, type: 'start' });
    await b.waitFor((m) => m.type === 'race_start', 5000);

    // A draws from box 0: granted to A only, box_down broadcast to both.
    a.send({ v: 1, type: 'item_draw', box: 0, place: 8 });
    const grant = (await a.waitFor((m) => m.type === 'item_granted')) as Extract<
      ServerMessage,
      { type: 'item_granted' }
    >;
    expect(grant.userId).toBe('user-item-host');
    expect(grant.kind).toBeGreaterThan(0);
    await b.waitFor((m) => m.type === 'box_down' && m.box === 0);
    const afterBoxDown = b.messages.length;

    // The box is down: a second draw from it is refused.
    b.send({ v: 1, type: 'item_draw', box: 0, place: 7 });
    await b.waitFor((m) => m.type === 'item_denied' && m.reason === 'box_down');

    // Spend before the roulette arms is refused; after, it broadcasts.
    a.send({ v: 1, type: 'item_use', kind: grant.kind, backwards: false, carry: false, target: -1 });
    await a.waitFor((m) => m.type === 'item_denied' && m.reason === 'still_arming');
    await new Promise((r) => setTimeout(r, 1200));
    a.send({ v: 1, type: 'item_use', kind: grant.kind, backwards: false, carry: false, target: -1 });
    const used = (await b.waitFor((m) => m.type === 'item_used')) as Extract<
      ServerMessage,
      { type: 'item_used' }
    >;
    expect(used.userId).toBe('user-item-host');
    expect(used.kind).toBe(grant.kind);

    // Empty hands now: a second identical spend is refused.
    if (grant.kind !== 2) {
      a.send({ v: 1, type: 'item_use', kind: grant.kind, backwards: false, carry: false, target: -1 });
      await a.waitFor((m) => m.type === 'item_denied' && m.reason === 'empty_hands');
    }

    // A hit claim against B reaches only B.
    a.send({ v: 1, type: 'hit_claim', targetUserId: 'user-item-guest', kind: 3 });
    await b.waitFor((m) => m.type === 'hit' && m.fromUserId === 'user-item-host');

    // A hit against a host-owned AI kart routes to the host and preserves the
    // victim kart key used by the client to select that local AI instance.
    b.send({
      v: 1,
      type: 'hit_claim',
      targetUserId: 'user-item-host',
      targetKartKey: 'ai:2',
      kind: 4,
    });
    await a.waitFor(
      (m) =>
        m.type === 'hit' &&
        m.fromUserId === 'user-item-guest' &&
        m.fromKartKey === 'ai:2',
    );

    // Non-hosts may not draw for AI karts.
    b.send({ v: 1, type: 'item_draw', box: 3, place: 7, kartKey: 'ai:2' });
    await b.waitFor((m) => m.type === 'item_denied' && m.reason === 'not_your_kart');

    // The host may only operate valid, unoccupied AI backfill slots.
    a.send({ v: 1, type: 'item_draw', box: 3, place: 7, kartKey: 'ai:1' });
    await a.waitFor(
      (m) => m.type === 'item_denied' && m.kartKey === 'ai:1' && m.reason === 'not_your_kart',
    );
    a.send({ v: 1, type: 'item_draw', box: 3, place: 7, kartKey: 'ai:8' });
    await a.waitFor(
      (m) => m.type === 'item_denied' && m.kartKey === 'ai:8' && m.reason === 'not_your_kart',
    );

    // The host CAN draw for an AI kart.
    a.send({ v: 1, type: 'item_draw', box: 3, place: 7, kartKey: 'ai:2' });
    await a.waitFor((m) => m.type === 'item_granted' && m.kartKey === 'ai:2');

    // Server alarms return boxes to every client even when nobody disconnects
    // and no other room lifecycle alarm happens to be pending.
    await b.waitFor(
      (m) => m.type === 'box_up' && m.box === 0,
      4000,
      afterBoxDown,
    );

    a.close();
    b.close();
  });

  it('keeps a trailed shell in inventory until its release', async () => {
    const host = await createRoom('user-carried-shell');
    const socket = await TestSocket.open(host.wsUrl);
    await socket.waitFor((m) => m.type === 'welcome');
    socket.send({ v: 1, type: 'ready', ready: true });
    socket.send({ v: 1, type: 'start' });
    await socket.waitFor((m) => m.type === 'race_start', 5000);

    const stub = env.RACE_ROOM.get(env.RACE_ROOM.idFromName(host.raceId));
    await runInDurableObject(stub, (instance) => {
      const room = instance as unknown as {
        inventory: Map<string, { kind: number; count: number; armUntil: number; carried?: boolean }>;
      };
      room.inventory.set('user:user-carried-shell', { kind: 3, count: 1, armUntil: 0 });
    });

    const beforeDeploy = socket.messages.length;
    socket.send({ v: 1, type: 'item_use', kind: 3, backwards: true, carry: true, target: -1 });
    await socket.waitFor(
      (m) => m.type === 'item_used' && m.kind === 3 && m.carry,
      3000,
      beforeDeploy,
    );
    const deployed = await runInDurableObject(stub, (instance) => {
      const room = instance as unknown as {
        inventory: Map<string, { count: number; carried?: boolean }>;
      };
      return room.inventory.get('user:user-carried-shell');
    });
    expect(deployed).toMatchObject({ count: 1, carried: true });

    const beforeRelease = socket.messages.length;
    socket.send({ v: 1, type: 'item_use', kind: 3, backwards: false, carry: false, target: -1 });
    await socket.waitFor(
      (m) => m.type === 'item_used' && m.kind === 3 && !m.carry,
      3000,
      beforeRelease,
    );
    const released = await runInDurableObject(stub, (instance) => {
      const room = instance as unknown as { inventory: Map<string, unknown> };
      return room.inventory.get('user:user-carried-shell');
    });
    expect(released).toBeUndefined();

    const beforeEmpty = socket.messages.length;
    socket.send({ v: 1, type: 'item_use', kind: 3, backwards: false, carry: false, target: -1 });
    await socket.waitFor(
      (m) => m.type === 'item_denied' && m.reason === 'empty_hands',
      3000,
      beforeEmpty,
    );
    socket.close();
  });

  it('consumes a destroyed carried item exactly once', async () => {
    const host = await createRoom('user-carry-destroy-host');
    const guest = await joinRoom(host.raceId, 'user-carry-destroy-guest');
    const a = await TestSocket.open(host.wsUrl);
    const b = await TestSocket.open(guest.wsUrl);
    await b.waitFor((m) => m.type === 'welcome');
    a.send({ v: 1, type: 'ready', ready: true });
    b.send({ v: 1, type: 'ready', ready: true });
    await a.waitFor((m) => m.type === 'roster' && m.roster.every((member) => member.ready));
    a.send({ v: 1, type: 'start' });
    await a.waitFor((m) => m.type === 'race_start', 5000);

    const stub = env.RACE_ROOM.get(env.RACE_ROOM.idFromName(host.raceId));
    await runInDurableObject(stub, (instance) => {
      const room = instance as unknown as {
        inventory: Map<string, { kind: number; count: number; armUntil: number; carried?: boolean }>;
      };
      room.inventory.set('user:user-carry-destroy-host', {
        kind: 3,
        count: 1,
        armUntil: 0,
        carried: true,
      });
    });

    const beforeConsumed = b.messages.length;
    a.send({
      v: 1,
      type: 'item_carry_consumed',
      kind: 3,
      disposition: 'destroyed',
    });
    await b.waitFor(
      (message) =>
        message.type === 'item_carry_consumed' &&
        message.userId === 'user-carry-destroy-host' &&
        message.kartKey === 'self' &&
        message.kind === 3 &&
        message.disposition === 'destroyed',
      3000,
      beforeConsumed,
    );
    const afterConsumed = await runInDurableObject(stub, (instance) => {
      const room = instance as unknown as { inventory: Map<string, unknown> };
      return room.inventory.get('user:user-carry-destroy-host');
    });
    expect(afterConsumed).toBeUndefined();

    const beforeDuplicate = b.messages.length;
    a.send({
      v: 1,
      type: 'item_carry_consumed',
      kind: 3,
      disposition: 'destroyed',
    });
    await a.waitFor(
      (message) =>
        message.type === 'item_denied' &&
        message.kartKey === 'self' &&
        message.reason === 'invalid_carry',
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(
      b.messages.slice(beforeDuplicate).filter((message) => message.type === 'item_carry_consumed'),
    ).toHaveLength(0);

    a.close();
    b.close();
  });

  it('sends authoritative held and carried inventory to reconnects and late spectators', async () => {
    const host = await createRoom('user-item-sync-host');
    const original = await TestSocket.open(host.wsUrl);
    await original.waitFor((message) => message.type === 'welcome');
    original.send({ v: 1, type: 'ready', ready: true });
    original.send({ v: 1, type: 'start' });
    await original.waitFor((message) => message.type === 'race_start', 5000);

    const stub = env.RACE_ROOM.get(env.RACE_ROOM.idFromName(host.raceId));
    await runInDurableObject(stub, (instance) => {
      const room = instance as unknown as {
        inventory: Map<string, { kind: number; count: number; armUntil: number; carried?: boolean }>;
      };
      room.inventory.set('user:user-item-sync-host', {
        kind: 3,
        count: 1,
        carried: true,
        armUntil: 101,
      });
      room.inventory.set('ai:2', {
        kind: 6,
        count: 2,
        armUntil: 202,
      });
    });

    const reconnected = await TestSocket.open(host.wsUrl);
    await reconnected.waitFor((message) => message.type === 'welcome');
    const reconnectSync = (await reconnected.waitFor(
      (message) => message.type === 'item_sync',
    )) as Extract<ServerMessage, { type: 'item_sync' }>;
    expect(reconnectSync.items).toEqual([
      {
        userId: 'user-item-sync-host',
        kartKey: 'ai:2',
        kind: 6,
        count: 2,
        carried: false,
        armUntil: 202,
      },
      {
        userId: 'user-item-sync-host',
        kartKey: 'self',
        kind: 3,
        count: 1,
        carried: true,
        armUntil: 101,
      },
    ]);
    expect(
      reconnected.messages.findIndex((message) => message.type === 'item_sync'),
    ).toBeGreaterThan(
      reconnected.messages.findIndex((message) => message.type === 'welcome'),
    );

    const spectator = await joinRoom(host.raceId, 'user-item-sync-spectator', 'spectator');
    const spectatorSocket = await TestSocket.open(spectator.wsUrl);
    await spectatorSocket.waitFor((message) => message.type === 'welcome');
    const spectatorSync = (await spectatorSocket.waitFor(
      (message) => message.type === 'item_sync',
    )) as Extract<ServerMessage, { type: 'item_sync' }>;
    expect(spectatorSync.items).toEqual(reconnectSync.items);

    reconnected.close();
    spectatorSocket.close();
  });

  it('keeps AI inventory stable and remaps its owner after host migration', async () => {
    const host = await createRoom('user-ai-migration-host');
    const guest = await joinRoom(host.raceId, 'user-ai-migration-guest');
    const a = await TestSocket.open(host.wsUrl);
    const b = await TestSocket.open(guest.wsUrl);
    await b.waitFor((message) => message.type === 'welcome');
    a.send({ v: 1, type: 'ready', ready: true });
    b.send({ v: 1, type: 'ready', ready: true });
    await a.waitFor((message) => message.type === 'roster' && message.roster.every((m) => m.ready));
    a.send({ v: 1, type: 'start' });
    await a.waitFor((message) => message.type === 'race_start', 5000);

    const stub = env.RACE_ROOM.get(env.RACE_ROOM.idFromName(host.raceId));
    await runInDurableObject(stub, (instance) => {
      const room = instance as unknown as {
        inventory: Map<string, { kind: number; count: number; armUntil: number; carried?: boolean }>;
      };
      room.inventory.set('ai:2', {
        kind: 3,
        count: 1,
        armUntil: 0,
        carried: true,
      });
    });

    const afterDisconnect = b.messages.length;
    a.close();
    const migratedSync = (await b.waitFor(
      (message) =>
        message.type === 'item_sync' &&
        message.items.some((item) =>
          item.userId === 'user-ai-migration-guest' &&
          item.kartKey === 'ai:2' &&
          item.carried
        ),
      8000,
      afterDisconnect,
    )) as Extract<ServerMessage, { type: 'item_sync' }>;
    expect(migratedSync.items).toContainEqual({
      userId: 'user-ai-migration-guest',
      kartKey: 'ai:2',
      kind: 3,
      count: 1,
      carried: true,
      armUntil: 0,
    });
    const stableInventory = await runInDurableObject(stub, (instance) => {
      const room = instance as unknown as { inventory: Map<string, unknown> };
      return [...room.inventory.keys()];
    });
    expect(stableInventory).toContain('ai:2');
    expect(stableInventory.some((key) => key.includes('/ai:'))).toBe(false);

    const beforeDropped = b.messages.length;
    b.send({
      v: 1,
      type: 'item_carry_consumed',
      kartKey: 'ai:2',
      kind: 3,
      disposition: 'dropped',
    });
    await b.waitFor(
      (message) =>
        message.type === 'item_carry_consumed' &&
        message.userId === 'user-ai-migration-guest' &&
        message.kartKey === 'ai:2' &&
        message.disposition === 'dropped',
      3000,
      beforeDropped,
    );
    const consumed = await runInDurableObject(stub, (instance) => {
      const room = instance as unknown as { inventory: Map<string, unknown> };
      return room.inventory.get('ai:2');
    });
    expect(consumed).toBeUndefined();
    b.close();
  }, 12_000);

  it('migrates legacy human and host-scoped AI inventory keys during hydration', async () => {
    const userId = 'user-legacy-inventory-host';
    const host = await createRoom(userId);
    const socket = await TestSocket.open(host.wsUrl);
    await socket.waitFor((message) => message.type === 'welcome');
    const stub = env.RACE_ROOM.get(env.RACE_ROOM.idFromName(host.raceId));

    await runInDurableObject(stub, async (_instance, state) => {
      const stored = await state.storage.get<{
        inventory: [string, { kind: number; count: number; armUntil: number; carried?: boolean }][];
      }>('room');
      expect(stored).toBeDefined();
      stored!.inventory = [
        [userId, { kind: 3, count: 1, armUntil: 11, carried: true }],
        [`${userId}/ai:2`, { kind: 6, count: 2, armUntil: 22 }],
        [`${userId}/ai:8`, { kind: 4, count: 1, armUntil: 33 }],
      ];
      await state.storage.put('room', stored);
    });
    await evictDurableObject(stub);

    const migrated = await runInDurableObject(stub, (instance) => {
      const room = instance as unknown as {
        inventory: Map<string, { kind: number; count: number; armUntil: number; carried?: boolean }>;
      };
      return [...room.inventory.entries()];
    });
    expect(migrated).toEqual([
      ['user:user-legacy-inventory-host', { kind: 3, count: 1, armUntil: 11, carried: true }],
      ['ai:2', { kind: 6, count: 2, armUntil: 22 }],
    ]);

    socket.close();
  });

  it('runs a two-player race end to end', async () => {
    const host = await createRoom('user-host', 'Hosty');
    const guest = await joinRoom(host.raceId, 'user-guest', 'player', 'Guesty');

    const a = await TestSocket.open(host.wsUrl);
    const welcomeA = (await a.waitFor((m) => m.type === 'welcome')) as Extract<
      ServerMessage,
      { type: 'welcome' }
    >;
    expect(welcomeA.slot).toBe(0);
    expect(welcomeA.phase).toBe('lobby');
    expect(welcomeA.roster).toHaveLength(1);
    expect(welcomeA.roster[0]).toMatchObject({ userId: 'user-host', host: true, displayName: 'Hosty' });

    const b = await TestSocket.open(guest.wsUrl);
    const welcomeB = (await b.waitFor((m) => m.type === 'welcome')) as Extract<
      ServerMessage,
      { type: 'welcome' }
    >;
    expect(welcomeB.slot).toBe(1);
    await a.waitFor(
      (m) => m.type === 'roster' && m.roster.length === 2 && m.roster[1]?.userId === 'user-guest',
    );

    // Non-host cannot start.
    b.send({ ...env1, type: 'ready', ready: true });
    a.send({ ...env1, type: 'ready', ready: true });
    await a.waitFor((m) => m.type === 'roster' && m.roster.every((r) => r.ready));
    b.send({ ...env1, type: 'start' });
    await b.waitFor((m) => m.type === 'error' && m.code === 'not_host');

    // Host starts; both see countdown, then the running phase after the clock.
    a.send({ ...env1, type: 'start' });
    await b.waitFor((m) => m.type === 'countdown');
    await a.waitFor((m) => m.type === 'race_start', 5000);

    // State relay: A's kart state arrives at B, stamped with A's identity.
    const state = validStateAt(0.02);
    a.send({ ...env1, type: 'state', state, lap: 0, cp: -1, raceDistance: 12 });
    const relay = (await b.waitFor((m) => m.type === 'peer_state')) as Extract<
      ServerMessage,
      { type: 'peer_state' }
    >;
    expect(relay.userId).toBe('user-host');
    expect(relay.state.pos[0]).toBeCloseTo(state.pos[0], 6);

    // Checkpoint validation: a geometrically consistent claim is accepted.
    const cpZone = trackMath().checkpointAt(0.02);
    a.send({ ...env1, type: 'checkpoint', lap: 0, cp: cpZone, raceDistance: 30 });
    await b.waitFor(
      (m) => m.type === 'checkpoint_ok' && m.userId === 'user-host' && m.cp === cpZone,
    );

    // An out-of-order, geometrically impossible claim is rejected.
    const bogusCp = (cpZone + 3) % trackMath().checkpointCount;
    a.send({ ...env1, type: 'checkpoint', lap: 0, cp: bogusCp, raceDistance: 30 });
    await a.waitFor((m) => m.type === 'checkpoint_reject' && m.cp === bogusCp);

    // Drive A through every checkpoint with matching positions, then finish.
    const math = trackMath();
    const count = math.checkpointCount;
    for (let cp = cpZone + 1; ; cp++) {
      const zone = cp % count;
      if (zone === cpZone) break;
      const t = (zone + 0.5) / count;
      const s = validStateAt(t, 10 + zone);
      a.send({ ...env1, type: 'state', state: s, lap: 0, cp: zone - 1, raceDistance: 100 + zone });
      a.send({ ...env1, type: 'checkpoint', lap: 0, cp: zone, raceDistance: 100 + zone });
      await a.waitFor((m) => m.type === 'checkpoint_ok' && m.cp === zone);
    }
    a.send({ ...env1, type: 'finish', raceTime: 95.4 });
    await b.waitFor((m) => m.type === 'finish_ok' && m.userId === 'user-host' && m.place === 1);

    // B finishes second → results broadcast with the full standings.
    b.send({ ...env1, type: 'finish', raceTime: 102.7 });
    // B has not crossed checkpoints — must be rejected with 'incomplete'.
    await b.waitFor((m) => m.type === 'error' && m.code === 'incomplete');

    a.close();
    b.close();
  });

  it('stops sweeping a freed mid-race slot until finished cleanup is needed', async () => {
    const host = await createRoom('user-alarm-host');
    const guest = await joinRoom(host.raceId, 'user-alarm-guest');
    const a = await TestSocket.open(host.wsUrl);
    const b = await TestSocket.open(guest.wsUrl);
    await b.waitFor((m) => m.type === 'welcome');

    a.send({ ...env1, type: 'ready', ready: true });
    b.send({ ...env1, type: 'ready', ready: true });
    await a.waitFor((m) => m.type === 'roster' && m.roster.every((member) => member.ready));
    a.send({ ...env1, type: 'start' });
    await a.waitFor((m) => m.type === 'race_start', 5000);

    b.close();
    await a.waitFor(
      (m) =>
        m.type === 'roster' &&
        m.roster.some((member) =>
          member.userId === 'user-alarm-guest' && !member.connected && member.slot === 1
        ),
    );

    const stub = env.RACE_ROOM.get(env.RACE_ROOM.idFromName(host.raceId));
    await a.waitFor(
      (m) =>
        m.type === 'roster' &&
        m.roster.some((member) =>
          member.userId === 'user-alarm-guest' &&
          !member.connected &&
          member.role === 'spectator' &&
          member.slot === null
        ),
      8000,
    );

    const runningAlarm = await runInDurableObject(
      stub,
      (_instance, state) => state.storage.getAlarm(),
    );
    expect(runningAlarm).toBeNull();

    const math = trackMath();
    for (let cp = 0; cp < math.checkpointCount; cp++) {
      const state = validStateAt((cp + 0.5) / math.checkpointCount, 100 + cp);
      a.send({ ...env1, type: 'state', state, lap: 0, cp: cp - 1, raceDistance: cp + 1 });
      a.send({ ...env1, type: 'checkpoint', lap: 0, cp, raceDistance: cp + 1 });
      await a.waitFor((m) => m.type === 'checkpoint_ok' && m.cp === cp);
    }
    const beforeFinishedCleanup = a.messages.length;
    a.send({ ...env1, type: 'finish', raceTime: 80 });
    await a.waitFor((m) => m.type === 'race_results');

    // Run the finished-phase cleanup immediately if Miniflare has not already
    // fired the overdue alarm on its own.
    await runDurableObjectAlarm(stub);

    // Deleting the expired slotless spectator is still a roster change. The
    // remaining client must hear it immediately rather than retain a ghost
    // until some unrelated roster event occurs.
    const roster = (await a.waitFor(
      (m) =>
        m.type === 'roster' &&
        !m.roster.some((member) => member.userId === 'user-alarm-guest'),
      3000,
      beforeFinishedCleanup,
    )) as Extract<ServerMessage, { type: 'roster' }>;
    expect(roster.roster).not.toContainEqual(
      expect.objectContaining({ userId: 'user-alarm-guest' }),
    );
    a.close();
  });

  it('retires a running room after every racer exhausts the reconnect lease', async () => {
    const host = await createRoom('user-abandon-host');
    const socket = await TestSocket.open(host.wsUrl);
    await socket.waitFor((m) => m.type === 'welcome');
    socket.send({ ...env1, type: 'ready', ready: true });
    socket.send({ ...env1, type: 'start' });
    await socket.waitFor((m) => m.type === 'race_start', 5000);

    const stub = env.RACE_ROOM.get(env.RACE_ROOM.idFromName(host.raceId));
    socket.close();
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await runDurableObjectAlarm(stub);

    const stored = await runInDurableObject(
      stub,
      (_instance, state) => state.storage.get('room'),
    );
    expect(stored).toBeUndefined();
    const listed = await SELF.fetch(`${BASE}/channels/chan-1/rooms`);
    const body = (await listed.json()) as { rooms: { raceId: string }[] };
    expect(body.rooms).not.toContainEqual(
      expect.objectContaining({ raceId: host.raceId }),
    );
  }, 10_000);

  it('holds a disconnected player slot for the grace period and migrates the host', async () => {
    const host = await createRoom('user-host2');
    const guest = await joinRoom(host.raceId, 'user-guest2');
    const a = await TestSocket.open(host.wsUrl);
    const b = await TestSocket.open(guest.wsUrl);
    await b.waitFor((m) => m.type === 'welcome');

    a.close();
    // Roster marks the host disconnected but keeps the slot.
    await b.waitFor(
      (m) =>
        m.type === 'roster' &&
        m.roster.some((r) => r.userId === 'user-host2' && !r.connected && r.slot === 0),
    );
    // After the (1 s test) grace period the slot is freed and the host migrates.
    await b.waitFor(
      (m) =>
        m.type === 'roster' &&
        m.roster.every((r) => r.userId !== 'user-host2') &&
        m.roster.some((r) => r.userId === 'user-guest2' && r.host),
      8000,
    );
    b.close();
  });
});
