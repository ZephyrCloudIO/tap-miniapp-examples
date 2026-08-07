/**
 * Guards the Track → TrackMath adapter: the THREE-facing methods must keep
 * returning exactly what the pure math produces (the session server runs the
 * same math to validate the client's claims).
 */
import { describe, expect, it } from '@rstest/core';
import * as THREE from 'three';
import { Track } from './Track';
import { TrackMath } from './TrackMath';

describe('Track adapter consistency with TrackMath', () => {
  const track = new Track();
  const math = new TrackMath();

  it('sample/checkpoint/probe/collide delegate exactly', () => {
    for (let k = 0; k < 120; k++) {
      const t = k / 120;
      const s = track.sample(t);
      const m = math.sample(t);
      expect([s.pos.x, s.pos.y, s.pos.z]).toEqual([...m.pos]);
      expect([s.tangent.x, s.tangent.y, s.tangent.z]).toEqual([...m.tangent]);
      expect([s.normal.x, s.normal.y, s.normal.z]).toEqual([...m.normal]);
      expect([s.binormal.x, s.binormal.y, s.binormal.z]).toEqual([...m.binormal]);
      expect(s.halfWidth).toBe(m.halfWidth);
      expect(s.bank).toBe(m.bank);
      expect(track.checkpointAt(t)).toBe(math.checkpointAt(t));

      const i = Math.floor(t * math.cl.count) % math.cl.count;
      for (const lat of [-9, 0, 9]) {
        const p3: [number, number, number] = [0, 0, 0];
        math.crossPointInto(i, lat, p3);
        const v = new THREE.Vector3(p3[0], p3[1] + 0.4, p3[2]);
        const pu = track.probe(v, -1);
        const pm = math.probe(p3[0], p3[1] + 0.4, p3[2], -1);
        expect(pu.y).toBe(pm.y);
        expect(pu.t).toBe(pm.t);
        expect(pu.lateral).toBe(pm.lateral);
        expect(pu.surface).toBe(pm.surface);
        expect([pu.normal.x, pu.normal.y, pu.normal.z]).toEqual([pm.nx, pm.ny, pm.nz]);

        const hu = track.collideWalls(v, 1.6, -1);
        const hm = math.collideWalls(p3[0], p3[1] + 0.4, p3[2], 1.6, -1);
        expect(hu === null).toBe(hm === null);
        if (hu && hm) {
          expect([hu.push.x, hu.push.y, hu.push.z]).toEqual([...hm.push]);
          expect([hu.normal.x, hu.normal.y, hu.normal.z]).toEqual([...hm.normal]);
        }
      }
    }
  });

  it('start grid and bounds delegate exactly', () => {
    const plain = math.startGridPlain();
    expect(track.startGrid.length).toBe(plain.length);
    for (let s = 0; s < plain.length; s++) {
      expect([track.startGrid[s].pos.x, track.startGrid[s].pos.y, track.startGrid[s].pos.z])
        .toEqual([...plain[s].pos]);
      expect(track.startGrid[s].yaw).toBe(plain[s].yaw);
    }
    const { min, max } = math.boundsPlain();
    expect([track.bounds.min.x, track.bounds.min.y, track.bounds.min.z]).toEqual([...min]);
    expect([track.bounds.max.x, track.bounds.max.y, track.bounds.max.z]).toEqual([...max]);
  });
});
