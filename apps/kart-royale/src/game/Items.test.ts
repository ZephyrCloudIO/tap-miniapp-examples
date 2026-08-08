import { describe, expect, it } from '@rstest/core';
import * as THREE from 'three';
import { Items, type ItemsNetDriver } from './Items';
import { ItemKind, type IKart, type KartStats } from '../types';

function kart(id = 0): IKart {
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
    stats,
    object: new THREE.Object3D(),
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    velocity: new THREE.Vector3(),
    forward: new THREE.Vector3(0, 0, 1),
    stunTime: 0,
    starTime: 0,
    finished: false,
    squash() { this.stunTime += 1; },
  } as unknown as IKart;
}

function slot(kind: ItemKind, handle = 4) {
  return {
    kind: ItemKind.None,
    count: 0,
    arm: 0,
    carried: handle,
    carriedKind: kind,
    shrink: 0,
    starHit: 0,
  };
}

function driver(calls: unknown[]): ItemsNetDriver {
  return {
    requestDraw: () => true,
    requestUse: () => true,
    requestCarryConsumed(k, kind, disposition) {
      calls.push({ kart: k, kind, disposition });
    },
  };
}

describe('Items authoritative carried lifecycle', () => {
  it('reports a projectile-side carry death exactly once', () => {
    const items = new Items();
    const owner = kart();
    const calls: unknown[] = [];
    items.netDriver = driver(calls);
    const internals = items as unknown as {
      slots: Map<number, ReturnType<typeof slot>>;
      proj: { isCarried(handle: number, ownerId: number): boolean };
      reapConsumedCarries(karts: readonly IKart[]): void;
    };
    internals.slots.set(owner.id, slot(ItemKind.GreenShell));
    internals.proj = { isCarried: () => false };

    internals.reapConsumedCarries([owner]);
    internals.reapConsumedCarries([owner]);

    expect(calls).toEqual([{
      kart: owner,
      kind: ItemKind.GreenShell,
      disposition: 'destroyed',
    }]);
  });

  it('reports a bolt-dropped carry once and never echoes a server consume', () => {
    const items = new Items();
    const owner = kart();
    const calls: unknown[] = [];
    const applied: unknown[] = [];
    items.netDriver = driver(calls);
    const internals = items as unknown as {
      slots: Map<number, ReturnType<typeof slot>>;
      ctx: { bus: { emit(event: unknown): void } };
      proj: {
        drop(handle: number): boolean;
        applyCarryConsumed(ownerId: number, kind: ItemKind, disposition: 'destroyed' | 'dropped'): boolean;
      };
    };
    internals.slots.set(owner.id, slot(ItemKind.Banana));
    internals.ctx = { bus: { emit() {} } };
    internals.proj = {
      drop: () => true,
      applyCarryConsumed(ownerId, kind, disposition) {
        applied.push({ ownerId, kind, disposition });
        return false;
      },
    };

    items.boltHit(owner);
    items.boltHit(owner);
    expect(calls).toEqual([{
      kart: owner,
      kind: ItemKind.Banana,
      disposition: 'dropped',
    }]);

    items.confirmCarryConsumed(owner, ItemKind.Banana, 'dropped');
    items.confirmCarryConsumed(owner, ItemKind.Banana, 'dropped');
    expect(calls).toHaveLength(1);
    expect(applied).toHaveLength(2);
  });
});
