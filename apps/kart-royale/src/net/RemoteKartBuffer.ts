/**
 * ============================================================================
 *  REMOTE KART INTERPOLATION BUFFER
 * ============================================================================
 *  Each network-owned kart renders in the past by RENDER_DELAY_MS, sampling
 *  between the two snapshots straddling that render time. Short gaps (one or
 *  two missed 20 Hz frames) are interpolated across; longer gaps extrapolate
 *  for up to EXTRAPOLATE_MS using the last velocity, then hold. This is the
 *  classic Source-engine shape, sized for a kart racer's 20 Hz stream.
 * ============================================================================
 */
import type { KartStateWire } from '@tap-examples/kart-royale-server/protocol';

export interface BufferedSample {
  at: number;
  state: KartStateWire;
}

const RENDER_DELAY_MS = 150;
const EXTRAPOLATE_MS = 120;
const MAX_BUFFER = 32;

export class RemoteKartBuffer {
  private samples: BufferedSample[] = [];
  private lastSeq = -1;

  /** Push a sample; out-of-order or replayed samples are dropped. */
  push(state: KartStateWire, at: number): void {
    if (state.seq <= this.lastSeq) return;
    this.lastSeq = state.seq;
    this.samples.push({ at, state });
    if (this.samples.length > MAX_BUFFER) this.samples.shift();
  }

  /**
   * The pose to render at local time `now`: interpolated between the samples
   * straddling `now - RENDER_DELAY_MS`, extrapolated briefly past the newest
   * sample, or the newest sample held when the buffer is sparse.
   */
  sample(now: number): KartStateWire | null {
    const buf = this.samples;
    if (buf.length === 0) return null;
    const renderAt = now - RENDER_DELAY_MS;

    // Before the oldest sample: clamp to it.
    if (renderAt <= buf[0].at) return buf[0].state;

    // Between two samples: lerp.
    for (let i = buf.length - 2; i >= 0; i--) {
      const a = buf[i];
      const b = buf[i + 1];
      if (renderAt >= a.at && renderAt <= b.at) {
        const span = b.at - a.at;
        const f = span > 0 ? (renderAt - a.at) / span : 1;
        return lerpState(a.state, b.state, f);
      }
    }

    // Past the newest sample: brief velocity extrapolation, then hold. The
    // extrapolation targets the render point, not the arrival staleness.
    const newest = buf[buf.length - 1];
    const overMs = renderAt - newest.at;
    if (overMs <= EXTRAPOLATE_MS) {
      const dt = Math.max(0, overMs) / 1000;
      const s = newest.state;
      return {
        ...s,
        pos: [s.pos[0] + s.vel[0] * dt, s.pos[1] + s.vel[1] * dt, s.pos[2] + s.vel[2] * dt],
      };
    }
    return newest.state;
  }

  /** Reset for a new race. */
  clear(): void {
    this.samples.length = 0;
    this.lastSeq = -1;
  }
}

function lerpState(a: KartStateWire, b: KartStateWire, f: number): KartStateWire {
  const lerp = (x: number, y: number) => x + (y - x) * f;
  return {
    t: b.t,
    seq: b.seq,
    driftDir: b.driftDir,
    driftCharge: b.driftCharge,
    stun: b.stun,
    star: b.star,
    boost: b.boost,
    pos: [lerp(a.pos[0], b.pos[0]), lerp(a.pos[1], b.pos[1]), lerp(a.pos[2], b.pos[2])],
    vel: [lerp(a.vel[0], b.vel[0]), lerp(a.vel[1], b.vel[1]), lerp(a.vel[2], b.vel[2])],
    quat: nlerpQuat(a.quat, b.quat, f),
  };
}

/** Normalised lerp on quaternions, with hemisphere correction. */
function nlerpQuat(
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number],
  f: number,
): [number, number, number, number] {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const sign = dot < 0 ? -1 : 1;
  const x = a[0] + (b[0] * sign - a[0]) * f;
  const y = a[1] + (b[1] * sign - a[1]) * f;
  const z = a[2] + (b[2] * sign - a[2]) * f;
  const w = a[3] + (b[3] * sign - a[3]) * f;
  const il = 1 / Math.sqrt(x * x + y * y + z * z + w * w || 1);
  return [x * il, y * il, z * il, w * il];
}
