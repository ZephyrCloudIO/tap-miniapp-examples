import { describe, expect, it } from '@rstest/core';
import * as THREE from 'three';
import { NetAdapter, type NetAdapterCallbacks } from './NetAdapter';
import type { Items } from '../game/Items';
import type { RaceClient } from './RaceClient';
import type { Race } from '../game/Race';
import type { Ctx, IKart, KartStats } from '../types';
import { isRemoteKart } from './remoteKarts';

/** A kart-shaped stand-in with the writable fields the adapter touches. */
function fakeKart(id: number): IKart {
  const stats: KartStats = {
    name: `Kart ${id}`,
    color: new THREE.Color(0xffffff),
    accelMul: 1,
    topSpeedMul: 1,
    weightMul: 1,
    handlingMul: 1,
  };
  return {
    id,
    isPlayer: false,
    stats,
    object: new THREE.Object3D(),
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    velocity: new THREE.Vector3(),
    forwardSpeed: 0,
    forward: new THREE.Vector3(0, 0, 1),
    t: 0,
    lap: 0,
    place: id + 1,
    finished: false,
    raceDistance: 0,
    driftDir: 0,
    driftCharge: 0,
    driftTier: 0,
    boostTime: 0,
    airborne: false,
    stunTime: 0,
    starTime: 0,
    surface: 0,
    wheels: [],
    applyBoost() {},
    spinOut() {},
    squash() {},
    launch() {},
    respawn() {},
  } as IKart;
}

function fakeRace(kartCount: number) {
  const karts = Array.from({ length: kartCount }, (_, i) => fakeKart(i));
  const rosterCalls: unknown[] = [];
  const race = {
    karts,
    net: null as unknown,
    setNetworkRoster(field: unknown, mySlot: unknown) {
      rosterCalls.push({ field, mySlot });
    },
    markRemoteFinished() {},
    beginNetworkRace() {},
  };
  return { race, rosterCalls };
}

function fakeClient() {
  const sent: unknown[] = [];
  const client = {
    sent,
    connected: true,
    onMessage: null as unknown,
    onClose: null as unknown,
    send(msg: unknown) {
      sent.push(msg);
    },
    serverNow() {
      return 5000;
    },
  };
  return client;
}

function fakeItems(): Items {
  return {
    netDriver: null,
    remoteHitHandler: null,
    grantItem() {},
    confirmUse() {},
    confirmUseRemote() {},
    boltHit() {},
    setBoxDown() {},
    held() {
      return { kind: 0, count: 0 };
    },
  } as unknown as Items;
}

const CB: NetAdapterCallbacks = {
  onCountdown() {},
  onRoster() {},
  onPeerFinish() {},
  onRaceStart() {},
  onRaceResults() {},
  onClose() {},
};

function welcome(adapter: NetAdapter, client: ReturnType<typeof fakeClient>, self: string, host: string, slots: Record<string, number>) {
  (client.onMessage as (m: unknown) => void)({
    v: 1,
    type: 'welcome',
    userId: self,
    slot: slots[self] ?? null,
    phase: 'lobby',
    roster: Object.entries(slots).map(([userId, slot]) => ({
      userId,
      displayName: userId,
      role: 'player',
      slot,
      ready: false,
      host: userId === host,
      connected: true,
    })),
    serverTime: 5000,
    countdownEndsAt: null,
  });
}

describe('NetAdapter field mapping', () => {
  it('locks the field: humans at their slots, AI elsewhere, remote marks relative to self', () => {
    const { race, rosterCalls } = fakeRace(8);
    const client = fakeClient();
    const adapter = new NetAdapter(client as unknown as RaceClient, race as unknown as Race, fakeItems(), CB);
    adapter.attach();
    welcome(adapter, client, 'me', 'me', { me: 0, rival: 1 });

    // I am the host (slot 0): every non-human slot is my simulated AI.
    (client.onMessage as (m: unknown) => void)({ v: 1, type: 'countdown', endsAt: 9000 });

    const lock = rosterCalls[0] as { field: { slot: number; kind: string; displayName: string }[]; mySlot: number };
    expect(lock.mySlot).toBe(0);
    expect(lock.field[0]).toMatchObject({ kind: 'human', displayName: 'me' });
    expect(lock.field[1]).toMatchObject({ kind: 'human', displayName: 'rival' });
    expect(lock.field[2]?.kind).toBe('ai');
    expect(lock.field[7]?.kind).toBe('ai');

    expect(adapter.isRemote(race.karts[0])).toBe(false); // me
    expect(adapter.isRemote(race.karts[1])).toBe(true); // rival
    expect(adapter.isRemote(race.karts[2])).toBe(false); // my AI
    expect(isRemoteKart(race.karts[1])).toBe(true);
  });

  it('non-host clients treat host-simulated AI slots as remote', () => {
    const { race } = fakeRace(8);
    const client = fakeClient();
    const adapter = new NetAdapter(client as unknown as RaceClient, race as unknown as Race, fakeItems(), CB);
    adapter.attach();
    welcome(adapter, client, 'me', 'host', { me: 1, host: 0 });
    (client.onMessage as (m: unknown) => void)({ v: 1, type: 'countdown', endsAt: 9000 });

    expect(adapter.isHost).toBe(false);
    expect(adapter.isRemote(race.karts[0])).toBe(true); // host human
    expect(adapter.isRemote(race.karts[1])).toBe(false); // me
    expect(adapter.isRemote(race.karts[3])).toBe(true); // host-simulated AI
  });

  it('routes peer_state into the mapped kart and buffers', () => {
    const { race } = fakeRace(8);
    const client = fakeClient();
    const adapter = new NetAdapter(client as unknown as RaceClient, race as unknown as Race, fakeItems(), CB);
    adapter.attach();
    welcome(adapter, client, 'me', 'me', { me: 0, rival: 1 });
    (client.onMessage as (m: unknown) => void)({ v: 1, type: 'countdown', endsAt: 9000 });

    (client.onMessage as (m: unknown) => void)({
      v: 1,
      type: 'peer_state',
      userId: 'rival',
      kartKey: 'self',
      state: {
        t: 0.25, pos: [3, 1, 2], quat: [0, 0, 0, 1], vel: [1, 0, 0],
        driftDir: 1, driftCharge: 0.5, seq: 1,
      },
      lap: 2,
      cp: 4,
      raceDistance: 1234,
      at: 5000,
    });
    expect(race.karts[1].lap).toBe(2);
    expect(race.karts[1].raceDistance).toBe(1234);
    expect(race.karts[1].driftDir).toBe(0); // not applied until a rendered frame
  });

  it('host streams AI backfill under ai:<slot> keys at the uplink cadence', () => {
    const { race } = fakeRace(8);
    const client = fakeClient();
    const adapter = new NetAdapter(client as unknown as RaceClient, race as unknown as Race, fakeItems(), CB);
    adapter.attach();
    welcome(adapter, client, 'me', 'me', { me: 0 });
    (client.onMessage as (m: unknown) => void)({ v: 1, type: 'countdown', endsAt: 9000 });

    adapter.onLocalFrame({} as Ctx, race.karts[0], 0, 0, 10);
    const sent = client.sent as { type: string; kartKey?: string }[];
    expect(sent[0]).toMatchObject({ type: 'state' });
    expect(sent.filter((m) => m.kartKey === 'ai:1')).toHaveLength(1);
    expect(sent.filter((m) => m.kartKey === 'ai:7')).toHaveLength(1);
    expect(sent).toHaveLength(8); // me + 7 AI slots

    // Throttled: an immediate second frame sends nothing.
    adapter.onLocalFrame({} as Ctx, race.karts[0], 0, 0, 11);
    expect(client.sent).toHaveLength(8);
  });

  it('spectators mark every kart remote and uplink nothing', () => {
    const { race } = fakeRace(8);
    const client = fakeClient();
    const adapter = new NetAdapter(client as unknown as RaceClient, race as unknown as Race, fakeItems(), CB);
    adapter.attach();
    (client.onMessage as (m: unknown) => void)({
      v: 1,
      type: 'welcome',
      userId: 'watcher',
      slot: null,
      phase: 'lobby',
      roster: [
        { userId: 'host', displayName: 'host', role: 'player', slot: 0, ready: false, host: true, connected: true },
        { userId: 'watcher', displayName: 'watcher', role: 'spectator', slot: null, ready: false, host: false, connected: true },
      ],
      serverTime: 5000,
      countdownEndsAt: null,
    });
    (client.onMessage as (m: unknown) => void)({ v: 1, type: 'countdown', endsAt: 9000 });

    for (const kart of race.karts) expect(adapter.isRemote(kart)).toBe(true);
    adapter.onLocalFrame({} as Ctx, race.karts[0], 0, 0, 10);
    expect(client.sent).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Phase 4: server-arbitrated items
// ---------------------------------------------------------------------------

function recordingItems(heldKind = 0, heldCount = 0) {
  const calls = { granted: [] as unknown[], confirmed: [] as unknown[], remote: [] as unknown[], bolted: [] as unknown[], boxes: [] as unknown[] };
  const items = {
    netDriver: null as unknown,
    remoteHitHandler: null as unknown,
    grantItem(kart: unknown, kind: unknown, count: unknown) { calls.granted.push({ kart, kind, count }); },
    confirmUse(kart: unknown, kind: unknown, backwards: unknown) { calls.confirmed.push({ kart, kind, backwards }); },
    confirmUseRemote(kart: unknown, kind: unknown, backwards: unknown, carry: unknown, target: unknown) {
      calls.remote.push({ kart, kind, backwards, carry, target });
    },
    boltHit(kart: unknown) { calls.bolted.push(kart); },
    setBoxDown(box: unknown, down: unknown, respawnInS: unknown) { calls.boxes.push({ box, down, respawnInS }); },
    held() { return { kind: heldKind, count: heldCount }; },
  } as unknown as Items;
  return { items, calls };
}

describe('NetAdapter item authority', () => {
  it('requests draws with kart identity and placement, and grants to my kart', () => {
    const { race } = fakeRace(8);
    const client = fakeClient();
    const { items, calls } = recordingItems();
    const adapter = new NetAdapter(client as unknown as RaceClient, race as unknown as Race, items, CB);
    adapter.attach();
    welcome(adapter, client, 'me', 'me', { me: 0, rival: 1 });
    (client.onMessage as (m: unknown) => void)({ v: 1, type: 'countdown', endsAt: 9000 });

    expect(adapter.requestDraw(race.karts[0], 4)).toBe(true);
    const sent = client.sent as { type: string; box?: number; place?: number }[];
    expect(sent[0]).toMatchObject({ type: 'item_draw', box: 4 });

    (client.onMessage as (m: unknown) => void)({
      v: 1, type: 'item_granted', userId: 'me', kartKey: 'self', kind: 4, count: 1,
    });
    expect(calls.granted).toHaveLength(1);
    expect((calls.granted[0] as { kind: number }).kind).toBe(4);
    // A grant for someone else's kart never touches my inventory.
    (client.onMessage as (m: unknown) => void)({
      v: 1, type: 'item_granted', userId: 'rival', kartKey: 'self', kind: 5, count: 1,
    });
    expect(calls.granted).toHaveLength(1);
  });

  it('routes spends: mine execute locally, remote owners render visually, bolt hits local karts', () => {
    const { race } = fakeRace(8);
    const client = fakeClient();
    const { items, calls } = recordingItems(4, 1); // holding a red shell
    const adapter = new NetAdapter(client as unknown as RaceClient, race as unknown as Race, items, CB);
    adapter.attach();
    welcome(adapter, client, 'me', 'me', { me: 0, rival: 1 });
    (client.onMessage as (m: unknown) => void)({ v: 1, type: 'countdown', endsAt: 9000 });

    expect(adapter.requestUse(race.karts[0], false)).toBe(true);
    expect((client.sent as { type: string }[]).some((m) => m.type === 'item_use')).toBe(true);

    (client.onMessage as (m: unknown) => void)({
      v: 1, type: 'item_used', userId: 'me', kartKey: 'self', kind: 4, backwards: false, carry: false, target: -1,
    });
    expect(calls.confirmed).toHaveLength(1);

    (client.onMessage as (m: unknown) => void)({
      v: 1, type: 'item_used', userId: 'rival', kartKey: 'self', kind: 3, backwards: false, carry: false, target: -1,
    });
    expect(calls.remote).toHaveLength(1);

    (client.onMessage as (m: unknown) => void)({
      v: 1, type: 'item_used', userId: 'rival', kartKey: 'self', kind: 7, backwards: false, carry: false, target: -1,
    });
    // Bolt: every kart THIS client simulates takes the hit except the
    // shooter's. I am the host: my kart (slot 0) plus the seven host-simulated
    // AI slots are local here; the rival's kart is remote and excluded.
    expect(calls.bolted).toHaveLength(7);
  });

  it('claims projectile contact with remote karts to the victim owner', () => {
    const { race } = fakeRace(8);
    const client = fakeClient();
    const { items } = recordingItems();
    const adapter = new NetAdapter(client as unknown as RaceClient, race as unknown as Race, items, CB);
    adapter.attach();
    welcome(adapter, client, 'me', 'me', { me: 0, rival: 1 });
    (client.onMessage as (m: unknown) => void)({ v: 1, type: 'countdown', endsAt: 9000 });

    const handler = (items as unknown as { remoteHitHandler: (k: unknown, kind: number) => void }).remoteHitHandler;
    handler(race.karts[1], 3);
    const claims = (client.sent as unknown[]).filter(
      (m) => (m as { type: string }).type === 'hit_claim',
    ) as { targetUserId: string; kind: number }[];
    expect(claims).toHaveLength(1);
    expect(claims[0].targetUserId).toBe('rival');
    expect(claims[0].kind).toBe(3);
  });

  it('mirrors server box state into the course', () => {
    const { race } = fakeRace(8);
    const client = fakeClient();
    const { items, calls } = recordingItems();
    new NetAdapter(client as unknown as RaceClient, race as unknown as Race, items, CB).attach();
    (client.onMessage as (m: unknown) => void)({ v: 1, type: 'box_down', box: 2, until: 6500 });
    expect(calls.boxes[0]).toMatchObject({ box: 2, down: true });
    (client.onMessage as (m: unknown) => void)({ v: 1, type: 'box_up', box: 2 });
    expect(calls.boxes[1]).toMatchObject({ box: 2, down: false });
  });
});
