/**
 * ============================================================================
 *  SUNSET BAY CIRCUIT — pure track mathematics, host-agnostic
 * ============================================================================
 *  Every number the game trusts about the circuit, with zero rendering
 *  dependencies: the centreline station table, the road/kerb/shoulder
 *  cross-section, station lookup, surface probing, wall collision, the macro
 *  heightfield, and checkpoint zoning.
 *
 *  This module is the single source of truth consumed by BOTH:
 *    - `Track.ts` in the game, which adapts these results to THREE types and
 *      builds the meshes from exactly the same numbers (the road, the kerbs,
 *      the skirt and the physics surface cannot disagree); and
 *    - the Cloudflare session server, which validates reported kart positions
 *      and checkpoint claims authoritatively inside a Durable Object.
 *
 *  Because the server runs the same code against the same baked layout, a
 *  client cannot invent a line the geometry would not have produced.
 *
 *  Outputs are plain number arrays and pooled objects: nothing in the hot
 *  path allocates, and nothing here imports three.js.
 * ============================================================================
 */
import {
  buildCenterline, findCorners, terrainDetail, smoothstep as ss, gridSlot, BOOST_PADS, CHECKPOINTS,
  CROWN, GRID_LAT, KERB_CROWN0, KERB_CROWN1, KERB_END, KERB_HS, KERB_QS,
  KERB_RIPPLE_A, KERB_RIPPLE_K, KERB_W, SEA_Y,
  SKIRT_W, WALL_HEIGHT, WALL_NONE,
  type Centerline, type Corner,
} from './TrackLayout';
import { Surface } from '../types';

/** fraction of half-width over which the banked outer apron eases off */
const APRON_T0 = 0.60;
/** fraction of the outer lip's rise the apron gives back */
const APRON_FRAC = 0.20;

/** Flat probe result, adapted into THREE.SurfaceProbe by Track.ts. */
export interface MathProbe {
  y: number;
  nx: number;
  ny: number;
  nz: number;
  surface: Surface;
  lateral: number;
  t: number;
  edgeRatio: number;
}

/** Flat wall-collision result. */
export interface MathWallHit {
  push: [number, number, number];
  normal: [number, number, number];
}

/** Flat centreline-frame result, adapted into THREE TrackSample by Track.ts. */
export interface MathSample {
  pos: [number, number, number];
  tangent: [number, number, number];
  normal: [number, number, number];
  binormal: [number, number, number];
  halfWidth: number;
  bank: number;
  distance: number;
  t: number;
}

function makeMathProbe(): MathProbe {
  return { y: 0, nx: 0, ny: 1, nz: 0, surface: Surface.Road, lateral: 0, t: 0, edgeRatio: 0 };
}
function makeMathSample(): MathSample {
  return {
    pos: [0, 0, 0], tangent: [0, 0, 1], normal: [0, 1, 0], binormal: [1, 0, 0],
    halfWidth: 0, bank: 0, distance: 0, t: 0,
  };
}

export class TrackMath {
  /** baked station table — TrackGeometry reads this directly */
  readonly cl: Centerline;
  /** Every corner on the lap, apex-first, with turn direction and strength. */
  readonly corners: readonly Corner[];
  readonly length: number;
  readonly checkpointCount = CHECKPOINTS;

  // --- macro heightfield of the surrounding land -------------------------
  hmX0 = 0; hmZ0 = 0; hmCell = 6; hmW = 0; hmH = 0;
  hm: Float32Array = null!;
  /** distance-beyond-shoulder per heightfield cell, drives the far-field blur */
  private hmQ: Float32Array = null!;

  // --- station lookup acceleration ---------------------------------------
  private gCell = 22;
  private gX0 = 0; private gZ0 = 0; private gW = 0; private gH = 0;
  private buckets: Int32Array[] = [];

  // --- pooled returns ----------------------------------------------------
  private probePool: MathProbe[] = [];
  private probeAt = 0;
  private samplePool: MathSample[] = [];
  private sampleAt = 0;
  private wallPool: MathWallHit[] = [];
  private wallAt = 0;

  constructor() {
    this.cl = buildCenterline();
    this.corners = findCorners(this.cl);
    this.length = this.cl.length;
    for (let i = 0; i < 16; i++) this.probePool.push(makeMathProbe());
    for (let i = 0; i < 4; i++) this.samplePool.push(makeMathSample());
    for (let i = 0; i < 8; i++) {
      this.wallPool.push({ push: [0, 0, 0], normal: [0, 1, 0] });
    }
    this.buildAccel();
    this.buildHeightfield();
  }

  // =======================================================================
  //  Sampling
  // =======================================================================

  /** `out` is a non-interface convenience: pass a scratch to avoid garbage. */
  sample(t: number, out?: MathSample): MathSample {
    const cl = this.cl, n = cl.count;
    t = t - Math.floor(t);
    const f = t * n;
    let i = Math.floor(f);
    if (i >= n) i = n - 1;
    const u = f - i;
    const j = (i + 1) % n;
    const s = out ?? this.nextSample();

    const px = cl.px[i] + (cl.px[j] - cl.px[i]) * u;
    const py = cl.py[i] + (cl.py[j] - cl.py[i]) * u;
    const pz = cl.pz[i] + (cl.pz[j] - cl.pz[i]) * u;
    s.pos[0] = px; s.pos[1] = py; s.pos[2] = pz;

    let tx = cl.tx[i] + (cl.tx[j] - cl.tx[i]) * u;
    let ty = cl.ty[i] + (cl.ty[j] - cl.ty[i]) * u;
    let tz = cl.tz[i] + (cl.tz[j] - cl.tz[i]) * u;
    let il = 1 / Math.sqrt(tx * tx + ty * ty + tz * tz);
    tx *= il; ty *= il; tz *= il;

    let nx = cl.nx[i] + (cl.nx[j] - cl.nx[i]) * u;
    let ny = cl.ny[i] + (cl.ny[j] - cl.ny[i]) * u;
    let nz = cl.nz[i] + (cl.nz[j] - cl.nz[i]) * u;
    il = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
    nx *= il; ny *= il; nz *= il;

    // re-orthogonalise rather than lerping a third vector, so the frame stays
    // exactly right-handed after interpolation
    let bx = ty * nz - tz * ny;
    let by = tz * nx - tx * nz;
    let bz = tx * ny - ty * nx;
    il = 1 / Math.sqrt(bx * bx + by * by + bz * bz);
    bx *= il; by *= il; bz *= il;
    nx = by * tz - bz * ty;
    ny = bz * tx - bx * tz;
    nz = bx * ty - by * tx;
    il = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
    nx *= il; ny *= il; nz *= il;

    s.tangent[0] = tx; s.tangent[1] = ty; s.tangent[2] = tz;
    s.normal[0] = nx; s.normal[1] = ny; s.normal[2] = nz;
    s.binormal[0] = bx; s.binormal[1] = by; s.binormal[2] = bz;
    s.halfWidth = cl.half[i] + (cl.half[j] - cl.half[i]) * u;
    s.bank = cl.bank[i] + (cl.bank[j] - cl.bank[i]) * u;
    s.distance = t * cl.length;
    s.t = t;
    return s;
  }

  sampleByDistance(d: number, out?: MathSample): MathSample {
    return this.sample(d / this.cl.length, out);
  }

  private nextSample(): MathSample {
    this.sampleAt = (this.sampleAt + 1) & 3;
    return this.samplePool[this.sampleAt];
  }

  checkpointAt(t: number): number {
    t = t - Math.floor(t);
    const c = Math.floor(t * CHECKPOINTS);
    return c >= CHECKPOINTS ? CHECKPOINTS - 1 : c;
  }

  minimapPath(samples: number): { x: number; z: number }[] {
    const out: { x: number; z: number }[] = [];
    const cl = this.cl;
    for (let k = 0; k < samples; k++) {
      const f = (k / samples) * cl.count;
      const i = Math.floor(f) % cl.count;
      const j = (i + 1) % cl.count;
      const u = f - Math.floor(f);
      out.push({
        x: cl.px[i] + (cl.px[j] - cl.px[i]) * u,
        z: cl.pz[i] + (cl.pz[j] - cl.pz[i]) * u,
      });
    }
    return out;
  }

  // =======================================================================
  //  Cross-section — the single source of truth for road/kerb/shoulder shape.
  //  TrackGeometry builds meshes from exactly these numbers, which is why the
  //  road, the kerbs, the skirt and the physics surface cannot disagree.
  // =======================================================================

  /**
   * Flattened outer apron on the steeply banked corners, in metres of drop.
   *
   * A 20° banked 180 with an 8.8 m half-width puts its outer lip 3.0 m above the
   * centreline, and a chase camera on the inside line sits *below* that lip — so
   * everything outboard of the corner (the bay, the coast band, the sky under the
   * horizon) is occluded by the road's own outer edge. That is a property of
   * banking and not a bug; no amount of shoulder-lowering will let a camera at
   * 2.2 m see over a lip 4.3 m above the inside line.
   *
   * What a real banked oval does have, and this one did not, is a *flattened
   * apron*: the outer fifth of the roadway eases off the full cross-slope. It
   * buys about 0.6 m of lip height back, it makes the outer lane a genuinely
   * different surface from the racing line rather than more of the same plane,
   * and it gives the outside of the corner somewhere to run wide onto.
   *
   * Gated at 12° so it fires on the banked coastal 180 (t 0.735–0.848) and on
   * nothing else on this layout — the next-steepest section is 9.5°. Both ends
   * of the ramp are `smoothstep`, so the surface stays C1: there is no crease for
   * the physics to catch on and no slope break for the gloss strip to kink over.
   *
   * `t` clamps at 1, so the kerb and the shoulder inherit the full lip drop and
   * ride down with the road edge instead of leaving a 0.6 m step at the joint.
   */
  private apronDrop(i: number, L: number): number {
    const cl = this.cl;
    const bank = cl.bank[i];
    const amt = ss(0.209, 0.314, Math.abs(bank));      // 12° … 18°
    if (amt <= 0) return 0;
    const hw = cl.half[i];
    // the raised side is the one the bank sign points at
    const t = Math.min(1, (bank >= 0 ? L : -L) / hw);
    if (t <= APRON_T0) return 0;
    const f = ss(APRON_T0, 1, t);
    return amt * f * f * hw * Math.abs(Math.sin(bank)) * APRON_FRAC;
  }

  /**
   * d(crossOffset)/dL on the roadway, i.e. the extra lateral slope the surface
   * carries on top of the banked plane.
   *
   * TrackGeometry used to compute this analytically as the derivative of the
   * crown parabola, which was exact while the crown was the only thing in
   * `crossOffset` inside the edges. It no longer is: the banked apron adds up to
   * 14° of its own over the outer fifth of the coastal 180, and a mesh that
   * *bends* while its shading normal does not is a flat-looking dent. Taking it
   * off the same function the vertices come from is the only way the two cannot
   * drift apart again.
   *
   * Clamped to the roadway at both ends so the difference never straddles the
   * kerb junction and reports the kerb's 31° face as road slope.
   */
  roadSlope(i: number, L: number): number {
    const hw = this.cl.half[i];
    const h = 0.2;
    const a = Math.max(-hw, Math.min(hw, L - h));
    const b = Math.max(-hw, Math.min(hw, L + h));
    if (b - a < 1e-6) return 0;
    return (this.crossOffset(i, b) - this.crossOffset(i, a)) / (b - a);
  }

  /** Vertical offset of the ground from the banked road plane, at lateral L. */
  crossOffset(i: number, L: number): number {
    const cl = this.cl;
    const a = Math.abs(L);
    const hw = cl.half[i];
    const apron = this.apronDrop(i, L);
    if (a <= hw) {
      const r = a / hw;
      return -CROWN * r * r - apron;
    }
    const kerbAmt = cl.kerb[i];
    const q0 = a - hw;
    if (q0 <= KERB_W) return -CROWN - apron + this.kerbProfile(q0, i) * kerbAmt;
    return -CROWN - apron + KERB_END * kerbAmt + this.shoulderOffset(i, L < 0, q0 - KERB_W);
  }

  /**
   * Raised kerb, evaluated straight off the shared `KERB_QS`/`KERB_HS` table:
   * a flush joint strip, a steep inner face, a shallow bevel, a flat crown with
   * the rumble ripple, then the outer chamfers down to the shoulder.
   *
   * Piecewise-linear on purpose — see the table's note. It also means the flat
   * facet normals `TrackGeometry` derives from consecutive breakpoints are
   * exact rather than a finite-difference approximation smeared across creases.
   */
  kerbProfile(q0: number, i: number): number {
    const q = q0 < 0 ? 0 : q0 > KERB_W ? KERB_W : q0;
    let k = 1;
    while (k < KERB_QS.length - 1 && q > KERB_QS[k]) k++;
    const a = KERB_QS[k - 1], bq = KERB_QS[k];
    const h = KERB_HS[k - 1] + (KERB_HS[k] - KERB_HS[k - 1]) * ((q - a) / (bq - a));
    // Confined to the crown so it never disturbs the face or the bevel angle —
    // those two facets are the whole point of the profile. Bounded by the named
    // crown constants, not by positions in the breakpoint table: the table gains
    // and loses chamfers, and the ripple must not move when it does.
    //
    // Amplitude and wavelength both live in TrackLayout now, because the mesh
    // has to sample this at better than half the wavelength and the two numbers
    // cannot be allowed to drift apart. See KERB_RIPPLE_A.
    const crown = ss(KERB_CROWN0 - 0.10, KERB_CROWN0, q) * (1 - ss(KERB_CROWN1, KERB_CROWN1 + 0.14, q));
    return h + KERB_RIPPLE_A * Math.sin(i * this.cl.ds * KERB_RIPPLE_K) * crown;
  }

  /** Ground height beyond the kerb, relative to the shoulder edge. */
  private shoulderOffset(i: number, left: boolean, q: number): number {
    const cl = this.cl;
    const n0 = left ? cl.nearL0[i] : cl.nearR0[i];
    const n1 = left ? cl.nearL1[i] : cl.nearR1[i];
    const n2 = left ? cl.nearL2[i] : cl.nearR2[i];
    let near: number;
    if (q < 1.5) near = n0 * ss(0, 1.5, q);
    else if (q < 4) near = n0 + (n1 - n0) * ss(1.5, 4, q);
    else near = n1 + (n2 - n1) * ss(4, 12, q);
    const farY = left ? cl.farL[i] : cl.farR[i];
    const farD = left ? cl.farDL[i] : cl.farDR[i];
    const fb = ss(12, farD, q);
    if (fb <= 0) return near;
    // shoulder-edge height in world space, so the far target can be absolute
    const edge = cl.half[i] + KERB_W;
    const edgeY = cl.py[i] + (left ? -edge : edge) * cl.by[i] - CROWN + KERB_END * cl.kerb[i];
    return near + (farY - edgeY - near) * fb;
  }

  /**
   * Ground height at station `i`, lateral `L`, `sOff` metres further along.
   * The banking contribution is clamped at the kerb edge: past the corridor
   * the land is horizontal, so extrapolating a 20° plane out to the headland
   * (which would put the cliff top 40 m in the air) is exactly wrong.
   */
  surfaceY(i: number, L: number, sOff: number): number {
    const cl = this.cl;
    const edge = cl.half[i] + KERB_W;
    const Lc = Math.max(-edge, Math.min(edge, L));
    return cl.py[i] + cl.ty[i] * sOff + cl.by[i] * Lc + this.crossOffset(i, L);
  }

  /** World point of the drivable/terrain surface at station i, lateral L. */
  crossPointInto(i: number, L: number, out: [number, number, number]): [number, number, number] {
    const cl = this.cl;
    const edge = cl.half[i] + KERB_W;
    const Lc = Math.max(-edge, Math.min(edge, L));
    const ex = L - Lc;
    out[0] = cl.px[i] + cl.bx[i] * Lc + cl.hx[i] * ex;
    out[1] = cl.py[i] + cl.by[i] * Lc + cl.hy[i] * ex + this.crossOffset(i, L);
    out[2] = cl.pz[i] + cl.bz[i] * Lc + cl.hz[i] * ex;
    return out;
  }

  /** Rock/soil detail displacement at a surface point, shared with probe(). */
  detailAt(i: number, L: number, x: number, z: number): number {
    const cl = this.cl;
    const q = Math.abs(L) - cl.half[i] - KERB_W;
    if (q <= 3) return 0;
    const rock = L < 0 ? cl.rockL[i] : cl.rockR[i];
    return terrainDetail(x, z, q, rock);
  }

  // =======================================================================
  //  Station lookup
  // =======================================================================

  private buildAccel() {
    const cl = this.cl;
    let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
    for (let i = 0; i < cl.count; i++) {
      if (cl.px[i] < minx) minx = cl.px[i];
      if (cl.px[i] > maxx) maxx = cl.px[i];
      if (cl.pz[i] < minz) minz = cl.pz[i];
      if (cl.pz[i] > maxz) maxz = cl.pz[i];
    }
    this.gX0 = minx - this.gCell;
    this.gZ0 = minz - this.gCell;
    this.gW = Math.ceil((maxx - minx) / this.gCell) + 3;
    this.gH = Math.ceil((maxz - minz) / this.gCell) + 3;
    const tmp: number[][] = new Array(this.gW * this.gH);
    // one candidate per metre is ample: the bucket only nominates a seed,
    // the refine pass does the rest
    const step = Math.max(1, Math.round(1 / cl.ds));
    for (let i = 0; i < cl.count; i += step) {
      const cx = Math.floor((cl.px[i] - this.gX0) / this.gCell);
      const cz = Math.floor((cl.pz[i] - this.gZ0) / this.gCell);
      const k = cz * this.gW + cx;
      (tmp[k] || (tmp[k] = [])).push(i);
    }
    this.buckets = new Array(this.gW * this.gH);
    for (let k = 0; k < tmp.length; k++) if (tmp[k]) this.buckets[k] = Int32Array.from(tmp[k]);
  }

  /** Nearest station to (x,z) — global, grid accelerated. */
  nearestStation(x: number, z: number): number {
    const cl = this.cl;
    let best = -1, bestD = Infinity;
    const cx = Math.floor((x - this.gX0) / this.gCell);
    const cz = Math.floor((z - this.gZ0) / this.gCell);
    for (let r = 1; r <= 3 && best < 0; r++) {
      for (let dz = -r; dz <= r; dz++) {
        const zz = cz + dz;
        if (zz < 0 || zz >= this.gH) continue;
        for (let dx = -r; dx <= r; dx++) {
          const xx = cx + dx;
          if (xx < 0 || xx >= this.gW) continue;
          const b = this.buckets[zz * this.gW + xx];
          if (!b) continue;
          for (let n = 0; n < b.length; n++) {
            const i = b[n];
            const ex = cl.px[i] - x, ez = cl.pz[i] - z;
            const d = ex * ex + ez * ez;
            if (d < bestD) { bestD = d; best = i; }
          }
        }
      }
    }
    if (best < 0) {
      // far outside the circuit (open sea, distant headland): strided sweep
      for (let i = 0; i < cl.count; i += 8) {
        const ex = cl.px[i] - x, ez = cl.pz[i] - z;
        const d = ex * ex + ez * ez;
        if (d < bestD) { bestD = d; best = i; }
      }
    }
    return this.refineStation(x, z, best, 12);
  }

  private refineStation(x: number, z: number, seed: number, span: number): number {
    const cl = this.cl, n = cl.count;
    let best = seed, bestD = Infinity;
    for (let k = -span; k <= span; k++) {
      const i = (seed + k + n) % n;
      const ex = cl.px[i] - x, ez = cl.pz[i] - z;
      const d = ex * ex + ez * ez;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  /**
   * Hot path. With a hint we sweep a ±45 m window of *progress*, coarse then
   * fine; without one we fall back to the grid. A hint that has gone stale
   * (respawn, or a shell launching somebody into the bay) is caught by the
   * distance sanity check and retried globally.
   */
  private findStation(x: number, z: number, hintT: number): number {
    const cl = this.cl, n = cl.count;
    if (hintT >= 0) {
      const centre = Math.floor((hintT - Math.floor(hintT)) * n) % n;
      const half = Math.min(n >> 1, Math.round(45 / cl.ds));
      let best = centre, bestD = Infinity;
      const stride = 8;
      for (let k = -half; k <= half; k += stride) {
        const i = (centre + k + n) % n;
        const ex = cl.px[i] - x, ez = cl.pz[i] - z;
        const d = ex * ex + ez * ez;
        if (d < bestD) { bestD = d; best = i; }
      }
      best = this.refineStation(x, z, best, stride);
      const ex = cl.px[best] - x, ez = cl.pz[best] - z;
      if (ex * ex + ez * ez < 160 * 160) return best;
    }
    return this.nearestStation(x, z);
  }

  // =======================================================================
  //  probe — called for every wheel of every kart, every frame
  // =======================================================================

  probeInto(out: MathProbe, x: number, y: number, z: number, hintT: number): MathProbe {
    const cl = this.cl;
    let i = this.findStation(x, z, hintT);

    let dx = x - cl.px[i], dy = y - cl.py[i], dz = z - cl.pz[i];
    // The arc projection has to be the full 3D dot: on a 20° banked corner the
    // road edge sits 4 m below the centreline, and dropping the vertical term
    // mis-places the point by most of a metre along the track.
    let sOff = dx * cl.tx[i] + dy * cl.ty[i] + dz * cl.tz[i];
    // findStation minimises horizontal distance, which is not quite the foot
    // of the perpendicular; one integer re-centring makes it exact.
    const shift = Math.round(sOff / cl.ds);
    if (shift !== 0) {
      i = (i + shift + cl.count) % cl.count;
      dx = x - cl.px[i]; dy = y - cl.py[i]; dz = z - cl.pz[i];
      sOff = dx * cl.tx[i] + dy * cl.ty[i] + dz * cl.tz[i];
    }
    const hw = cl.half[i];
    const edge = hw + KERB_W;

    // lateral runs along the banked binormal inside the corridor and along the
    // horizontal right outside it, matching how the surface is actually built
    let L = dx * cl.bx[i] + dy * cl.by[i] + dz * cl.bz[i];
    if (Math.abs(L) > edge) {
      const lh = dx * cl.hx[i] + dy * cl.hy[i] + dz * cl.hz[i];
      if (Math.abs(lh) > edge) L = lh;
    }

    let t = (i * cl.ds + sOff) / cl.length;
    t -= Math.floor(t);
    out.t = t;
    out.lateral = L;
    out.edgeRatio = Math.abs(L) / hw;

    const a = Math.abs(L);
    // Blend the two straddling stations. Without this, the frame is quantised
    // to half a station, which on the 20° banked entry is a 15 cm step at the
    // road edge — visible as wheels sinking into the apex kerb.
    const fi = i + sOff / cl.ds;
    const i0 = Math.floor(fi), fr = fi - i0;
    const s0 = ((i0 % cl.count) + cl.count) % cl.count;
    const s1 = (s0 + 1) % cl.count;
    const yA = this.surfaceY(s0, L, fr * cl.ds);
    let yy = yA + (this.surfaceY(s1, L, (fr - 1) * cl.ds) - yA) * fr;

    let surf: Surface;
    if (a <= hw) {
      surf = Surface.Road;
      for (let b = 0; b < BOOST_PADS.length; b++) {
        const pad = BOOST_PADS[b];
        if (t >= pad.t0 && t <= pad.t1 && Math.abs(L - pad.lat) <= pad.hw) { surf = Surface.Boost; break; }
      }
      out.nx = cl.nx[i]; out.ny = cl.ny[i]; out.nz = cl.nz[i];
    } else if (a <= edge) {
      surf = Surface.Road; // kerb: grippy, but the raised profile rattles you
      const sgn = L < 0 ? -1 : 1;
      const slope = (this.crossOffset(i, L + 0.12 * sgn) - this.crossOffset(i, L)) / (0.12 * sgn);
      this.slopeNormalInto(i, slope, out);
    } else {
      const q = a - edge;
      const left = L < 0;
      const shoulder = left ? cl.shoulderL[i] : cl.shoulderR[i];
      surf = q <= shoulder ? (left ? cl.surfL[i] : cl.surfR[i]) as Surface : Surface.OffTrack;
      // far field: hand over to the smoothed macro heightfield so the ridge
      // where two opposite sides of the circuit meet reads as landscape
      // rather than as a seam between two cross-sections
      const blend = ss(26, 34, q);
      if (blend > 0) yy += (this.sampleHeightfield(x, z) - yy) * blend;
      yy += this.detailAt(i, L, x, z);
      const sgn = left ? -1 : 1;
      const s2 = (this.crossOffset(i, L + 0.9 * sgn) - this.crossOffset(i, L)) / (0.9 * sgn);
      this.slopeNormalInto(i, s2, out);
    }

    if (yy < SEA_Y) {
      yy = SEA_Y;
      surf = Surface.Water;
      out.nx = 0; out.ny = 1; out.nz = 0;
    }
    out.y = yy;
    out.surface = surf;
    return out;
  }

  /** Convenience pooled probe (server side does not pool per-wheel callers). */
  probe(x: number, y: number, z: number, hintT: number): MathProbe {
    this.probeAt = (this.probeAt + 1) & 15;
    return this.probeInto(this.probePool[this.probeAt], x, y, z, hintT);
  }

  /** Ground normal for a surface tilted by `slope` (dy/dLateral) at station i. */
  private slopeNormalInto(i: number, slope: number, out: MathProbe) {
    const cl = this.cl;
    // _v = (hx, hy + slope, hz) normalized, crossed with the station tangent
    let vx = cl.hx[i], vy = cl.hy[i] + slope, vz = cl.hz[i];
    const il = 1 / Math.sqrt(vx * vx + vy * vy + vz * vz);
    vx *= il; vy *= il; vz *= il;
    const tx = cl.tx[i], ty = cl.ty[i], tz = cl.tz[i];
    let nx = vy * tz - vz * ty;
    let ny = vz * tx - vx * tz;
    let nz = vx * ty - vy * tx;
    const inl = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
    nx *= inl; ny *= inl; nz *= inl;
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
    out.nx = nx; out.ny = ny; out.nz = nz;
  }

  // =======================================================================
  //  Walls
  // =======================================================================

  collideWalls(x: number, y: number, z: number, radius: number, hintT: number): MathWallHit | null {
    const cl = this.cl;
    const i = this.findStation(x, z, hintT);
    const dx = x - cl.px[i], dy = y - cl.py[i], dz = z - cl.pz[i];
    const L = dx * cl.hx[i] + dy * cl.hy[i] + dz * cl.hz[i];
    const hw = cl.half[i];

    for (let s = 0; s < 2; s++) {
      const left = s === 0;
      const type = left ? cl.wallL[i] : cl.wallR[i];
      if (type === WALL_NONE) continue;
      const off = left ? cl.wallOffL[i] : cl.wallOffR[i];
      const wallL = hw + off;
      const side = left ? -1 : 1;
      const pen = radius - (wallL - side * L);
      if (pen <= 0) continue;
      // a kart that has cleared the top of the barrier is not colliding.
      // Take the foot height through crossPoint so banked sections, where the
      // surface has already unbanked past the kerb, agree with the geometry.
      const foot: [number, number, number] = [0, 0, 0];
      this.crossPointInto(i, side * wallL, foot);
      if (y > foot[1] + WALL_HEIGHT[type]) continue;
      this.wallAt = (this.wallAt + 1) & 7;
      const r = this.wallPool[this.wallAt];
      const il = 1 / Math.sqrt(cl.hx[i] * cl.hx[i] + cl.hz[i] * cl.hz[i]);
      const nx = cl.hx[i] * il * -side;
      const nz = cl.hz[i] * il * -side;
      r.normal[0] = nx; r.normal[1] = 0 * -side; r.normal[2] = nz;
      r.push[0] = nx * pen; r.push[1] = r.normal[1] * pen; r.push[2] = nz * pen;
      return r;
    }
    return null;
  }

  // =======================================================================
  //  Macro heightfield
  // =======================================================================

  private buildHeightfield() {
    const cl = this.cl;
    let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
    for (let i = 0; i < cl.count; i++) {
      if (cl.px[i] < minx) minx = cl.px[i];
      if (cl.px[i] > maxx) maxx = cl.px[i];
      if (cl.pz[i] < minz) minz = cl.pz[i];
      if (cl.pz[i] > maxz) maxz = cl.pz[i];
    }
    const pad = 330;
    this.hmX0 = minx - pad; this.hmZ0 = minz - pad;
    this.hmW = Math.ceil((maxx - minx + pad * 2) / this.hmCell) + 1;
    this.hmH = Math.ceil((maxz - minz + pad * 2) / this.hmCell) + 1;
    const w = this.hmW, h = this.hmH;
    const hm = this.hm = new Float32Array(w * h);
    const q = this.hmQ = new Float32Array(w * h);

    for (let jz = 0; jz < h; jz++) {
      const z = this.hmZ0 + jz * this.hmCell;
      for (let ix = 0; ix < w; ix++) {
        const x = this.hmX0 + ix * this.hmCell;
        const i = this.nearestStation(x, z);
        const dx = x - cl.px[i], dz = z - cl.pz[i];
        const L = dx * cl.hx[i] + dz * cl.hz[i];
        const k = jz * w + ix;
        q[k] = Math.max(0, Math.abs(L) - cl.half[i] - KERB_W);
        hm[k] = this.surfaceY(i, L, dx * cl.tx[i] + dz * cl.tz[i]);
      }
    }

    // Blur the far field only. Near the road the authored profile is law; far
    // out, the crease where two opposite sides of the circuit meet has to
    // relax into a hillside instead of a knife edge.
    const tmp = new Float32Array(w * h);
    for (let pass = 0; pass < 4; pass++) {
      for (let jz = 0; jz < h; jz++) {
        for (let ix = 0; ix < w; ix++) {
          const k = jz * w + ix;
          let acc = 0, n = 0;
          for (let dz = -1; dz <= 1; dz++) {
            const zz = jz + dz; if (zz < 0 || zz >= h) continue;
            for (let dx = -1; dx <= 1; dx++) {
              const xx = ix + dx; if (xx < 0 || xx >= w) continue;
              acc += hm[zz * w + xx]; n++;
            }
          }
          tmp[k] = hm[k] + (acc / n - hm[k]) * ss(30, 70, q[k]);
        }
      }
      hm.set(tmp);
    }
  }

  /** Bilinear macro height (no detail noise) at a world XZ. */
  sampleHeightfield(x: number, z: number): number {
    const w = this.hmW, h = this.hmH;
    const fx = (x - this.hmX0) / this.hmCell;
    const fz = (z - this.hmZ0) / this.hmCell;
    let ix = Math.floor(fx), iz = Math.floor(fz);
    if (ix < 0) ix = 0; else if (ix > w - 2) ix = w - 2;
    if (iz < 0) iz = 0; else if (iz > h - 2) iz = h - 2;
    const u = Math.min(1, Math.max(0, fx - ix)), v = Math.min(1, Math.max(0, fz - iz));
    const hm = this.hm;
    const top = hm[iz * w + ix] + (hm[iz * w + ix + 1] - hm[iz * w + ix]) * u;
    const bot = hm[(iz + 1) * w + ix] + (hm[(iz + 1) * w + ix + 1] - hm[(iz + 1) * w + ix]) * u;
    return top + (bot - top) * v;
  }

  /**
   * Full ground height at an arbitrary world XZ, used by the terrain mesh.
   * Identical maths to probe()'s off-road branch — the two are not allowed to
   * disagree, or terrain pokes through the road.
   */
  groundAt(x: number, z: number): number {
    const cl = this.cl;
    const i = this.nearestStation(x, z);
    const dx = x - cl.px[i], dz = z - cl.pz[i];
    const L = dx * cl.hx[i] + dz * cl.hz[i];
    let y = this.surfaceY(i, L, dx * cl.tx[i] + dz * cl.tz[i]);
    const q = Math.abs(L) - cl.half[i] - KERB_W;
    const blend = ss(26, 34, q);
    if (blend > 0) y += (this.sampleHeightfield(x, z) - y) * blend;
    return y + this.detailAt(i, L, x, z);
  }

  /** Signed lateral offset (horizontal) of a world XZ from the centreline. */
  lateralAt(x: number, z: number): number {
    const cl = this.cl;
    const i = this.nearestStation(x, z);
    return (x - cl.px[i]) * cl.hx[i] + (z - cl.pz[i]) * cl.hz[i];
  }

  /** Rockiness 0..1 at a world XZ, for terrain vertex colouring. */
  rockAt(x: number, z: number): number {
    const cl = this.cl;
    const i = this.nearestStation(x, z);
    const L = (x - cl.px[i]) * cl.hx[i] + (z - cl.pz[i]) * cl.hz[i];
    return L < 0 ? cl.rockL[i] : cl.rockR[i];
  }

  /** Zone id at a normalised progress — used by the geometry builder. */
  zoneAt(t: number): number {
    const i = Math.floor((t - Math.floor(t)) * this.cl.count) % this.cl.count;
    return this.cl.zone[i];
  }

  // =======================================================================
  //  Start grid + bounds (plain data; Track adapts to THREE types)
  // =======================================================================

  /**
   * Two abreast with the outside car of each row set back — the classic
   * staggered arcade grid. Pole sits on the inside of turn one (a left).
   *
   * The slot geometry comes from `gridSlot()` rather than being written out
   * here, because `buildMarkings` paints the boxes these karts stand in and the
   * start-line checker scrubs its paint thin in the corridors they launch down.
   * Three copies of `11 + row * 8.5 + col * 4.2` is how round 3 ended up with
   * karts standing beside their boxes rather than on them.
   *
   * The lateral offset is now a fixed 3.2 m instead of `min(5.4, half * 0.46)`.
   * Scaling it with the road width was the wrong instinct twice over: it made
   * the grid as wide as whatever the road happened to be — 5.4 m apart on the
   * old 26 m road, which is why the field never read as a pack — and it meant
   * the painted boxes (which used a hard-coded 5.0) and the karts drifted apart
   * the moment the width schedule moved. A grid slot is a fixed physical thing.
   * All we owe the road is a check that it fits.
   */
  startGridPlain(): { pos: [number, number, number]; yaw: number }[] {
    const cl = this.cl;
    const scratch = makeMathSample();
    const p: [number, number, number] = [0, 0, 0];
    const grid: { pos: [number, number, number]; yaw: number }[] = [];
    for (let k = 0; k < 8; k++) {
      const { back, lat: rawLat } = gridSlot(k);
      const d = ((-back % cl.length) + cl.length) % cl.length;
      const s = this.sampleByDistance(d, scratch);
      const i = Math.round((d / cl.length) * cl.count) % cl.count;
      // 1.6 m of kart half-width plus a metre of margin has to fit inside the
      // road proper; the start straight carries 8.8 m so this never bites, but
      // it is the guard that stops a future width edit clipping karts into kerbs
      const room = Math.max(1.2, cl.half[i] - 2.6);
      const lat = Math.sign(rawLat) * Math.min(GRID_LAT, room);
      this.crossPointInto(i, lat, p);
      grid.push({
        pos: [p[0], p[1] + 0.45, p[2]],
        yaw: Math.atan2(s.tangent[0], s.tangent[2]),
      });
    }
    return grid;
  }

  /** World-space AABB of the whole track as plain min/max triplets. */
  boundsPlain(): { min: [number, number, number]; max: [number, number, number] } {
    const cl = this.cl;
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    const p: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < cl.count; i += 4) {
      for (let s = -1; s <= 1; s += 2) {
        this.crossPointInto(i, s * (cl.half[i] + KERB_W + SKIRT_W), p);
        for (let a = 0; a < 3; a++) {
          if (p[a] < min[a]) min[a] = p[a];
          if (p[a] > max[a]) max[a] = p[a];
        }
      }
    }
    min[1] = Math.min(min[1], SEA_Y - 2);
    max[1] += 60; // the headland and cliff mass sit well above the road
    return { min, max };
  }
}
