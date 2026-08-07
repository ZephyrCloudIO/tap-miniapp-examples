import { describe, expect, it } from 'vitest';
import { SELF } from 'cloudflare:test';
import { trackMath } from '../src/trackAuthority';
import type { ServerMessage } from '@tap-examples/kart-royale-protocol';

const BASE = 'http://localhost';

interface CreatedRoom {
  raceId: string;
  ticket: string;
  wsUrl: string;
}

async function createRoom(user: string, name = user): Promise<CreatedRoom> {
  const res = await SELF.fetch(`${BASE}/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ channelId: 'chan-1', userId: user, displayName: name }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as CreatedRoom;
}

async function joinRoom(raceId: string, user: string, role = 'player', name = user): Promise<CreatedRoom> {
  const res = await SELF.fetch(`${BASE}/rooms/${raceId}/tickets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ channelId: 'chan-1', userId: user, displayName: name, role }),
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

  async waitFor(match: (m: ServerMessage) => boolean, timeoutMs = 3000): Promise<ServerMessage> {
    const existing = this.messages.find(match);
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

  it('lists created rooms in the channel registry', async () => {
    const room = await createRoom('user-list-host', 'ListHost');
    const res = await SELF.fetch(`${BASE}/channels/chan-1/rooms`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rooms: { raceId: string; host: string; phase: string }[] };
    expect(body.rooms.some((r) => r.raceId === room.raceId && r.host === 'ListHost' && r.phase === 'lobby')).toBe(true);
  });

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

    // Non-hosts may not draw for AI karts.
    b.send({ v: 1, type: 'item_draw', box: 3, place: 7, kartKey: 'ai:2' });
    await b.waitFor((m) => m.type === 'item_denied' && m.reason === 'not_your_kart');

    // The host CAN draw for an AI kart.
    a.send({ v: 1, type: 'item_draw', box: 3, place: 7, kartKey: 'ai:2' });
    await a.waitFor((m) => m.type === 'item_granted' && m.kartKey === 'ai:2');

    a.close();
    b.close();
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
