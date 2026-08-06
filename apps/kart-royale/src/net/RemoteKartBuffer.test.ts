import { describe, expect, it } from '@rstest/core';
import { RemoteKartBuffer } from './RemoteKartBuffer';
import type { KartStateWire } from '@tap-examples/kart-royale-server/protocol';

function state(seq: number, x: number, vx = 0): KartStateWire {
  return {
    t: 0.1,
    pos: [x, 1, 2],
    quat: [0, 0, 0, 1],
    vel: [vx, 0, 0],
    driftDir: 0,
    driftCharge: 0,
    stun: 0,
    star: 0,
    boost: 0,
    seq,
  };
}

describe('RemoteKartBuffer', () => {
  it('returns null before any sample', () => {
    expect(new RemoteKartBuffer().sample(1000)).toBeNull();
  });

  it('clamps to the oldest sample before the buffer window', () => {
    const b = new RemoteKartBuffer();
    b.push(state(1, 10), 1000);
    b.push(state(2, 20), 2000);
    // Render time (now - 150ms) is before the oldest sample.
    expect(b.sample(1050)!.pos[0]).toBe(10);
  });

  it('interpolates between straddling samples', () => {
    const b = new RemoteKartBuffer();
    b.push(state(1, 0), 1000);
    b.push(state(2, 100), 1100);
    // renderAt = 1050 → halfway.
    expect(b.sample(1200)!.pos[0]).toBeCloseTo(50, 6);
  });

  it('extrapolates briefly past the newest sample using velocity', () => {
    const b = new RemoteKartBuffer();
    b.push(state(1, 0, 10), 1000); // moving +10 m/s along x
    // renderAt = 1000+100 (past newest, within the extrapolation window).
    const s = b.sample(1250)!;
    expect(s.pos[0]).toBeCloseTo(1, 6); // 100ms × 10 m/s
  });

  it('holds the newest sample after the extrapolation window', () => {
    const b = new RemoteKartBuffer();
    b.push(state(1, 5, 20), 1000);
    expect(b.sample(1000 + 150 + 120 + 500)!.pos[0]).toBe(5);
  });

  it('drops replayed and out-of-order samples', () => {
    const b = new RemoteKartBuffer();
    b.push(state(2, 20), 1000);
    b.push(state(2, 99), 1001); // replay: same seq
    b.push(state(1, 99), 1002); // out of order
    expect(b.sample(5000)!.pos[0]).toBe(20);
  });
});
