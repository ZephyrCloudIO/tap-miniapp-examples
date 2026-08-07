import { describe, expect, it } from '@rstest/core';
import * as THREE from 'three';
import { Projectiles } from './Projectiles';
import { ItemKind, type IKart } from '../types';

interface ProjectileStub {
  index: number;
  kind: ItemKind;
  state: number;
  owner: number;
  ownerLock: number;
  remote: boolean;
  vel: THREE.Vector3;
  mesh: THREE.Mesh;
}

function projectile(index: number, kind: ItemKind, remote = true): ProjectileStub {
  const mesh = new THREE.Mesh();
  mesh.visible = true;
  return {
    index,
    kind,
    state: 1, // PState.Carried
    owner: 2,
    ownerLock: 0,
    remote,
    vel: new THREE.Vector3(1, 2, 3),
    mesh,
  };
}

describe('Projectiles carried reconciliation', () => {
  it('deduplicates a tow and changes it from remote to local ownership', () => {
    const projectiles = new Projectiles();
    const first = projectile(0, ItemKind.GreenShell);
    const duplicate = projectile(1, ItemKind.GreenShell);
    (projectiles as unknown as { pool: ProjectileStub[] }).pool = [first, duplicate];
    const owner = { id: 2 } as IKart;

    expect(projectiles.ensureCarried(ItemKind.GreenShell, owner, false)).toBe(0);
    expect(projectiles.ensureCarried(ItemKind.GreenShell, owner, false)).toBe(0);
    expect(first.remote).toBe(false);
    expect(first.state).toBe(1);
    expect(duplicate.state).toBe(0);
    expect(duplicate.mesh.visible).toBe(false);
  });

  it('applies dropped and destroyed dispositions idempotently', () => {
    const projectiles = new Projectiles();
    const dropped = projectile(0, ItemKind.Banana);
    (projectiles as unknown as { pool: ProjectileStub[] }).pool = [dropped];

    expect(projectiles.applyCarryConsumed(2, ItemKind.Banana, 'dropped')).toBe(true);
    expect(dropped.state).toBe(2); // PState.Live
    expect(dropped.ownerLock).toBe(0.55);
    expect(dropped.vel.lengthSq()).toBe(0);
    expect(projectiles.applyCarryConsumed(2, ItemKind.Banana, 'dropped')).toBe(false);

    const destroyed = projectile(1, ItemKind.RedShell);
    (projectiles as unknown as { pool: ProjectileStub[] }).pool.push(destroyed);
    expect(projectiles.applyCarryConsumed(2, ItemKind.RedShell, 'destroyed')).toBe(true);
    expect(destroyed.state).toBe(0);
    expect(destroyed.mesh.visible).toBe(false);
    expect(projectiles.applyCarryConsumed(2, ItemKind.RedShell, 'destroyed')).toBe(false);
  });
});
