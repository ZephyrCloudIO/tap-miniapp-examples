/**
 * ============================================================================
 *  SUNSET BAY CIRCUIT — ITrack implementation
 * ============================================================================
 *  The centreline is a uniform arc-length station table baked by TrackLayout,
 *  so `t` is arc length over total length by construction and needs no
 *  reparameterisation LUT bolted on afterwards.
 *
 *  Lateral offsets are measured along the *banked* binormal, so `edgeRatio`
 *  means the same thing on the 20° coastal curve as on the flat start
 *  straight. Terrain beyond the kerb unbanks back to horizontal, which is what
 *  stops the shoulder flying off into the sky on the banked section.
 *
 *  All of the mathematics lives in `TrackMath.ts` — this class is the
 *  THREE-facing adapter (pooled Vector3 returns, scene graph, geometry
 *  ownership) so the exact same numbers also run on the session server.
 * ============================================================================
 */
import * as THREE from 'three';
import type { Ctx, ITrack, SurfaceProbe, TrackSample } from '../types';
import { Surface } from '../types';
import { CHECKPOINTS, KERB_W, ZONES, type Centerline, type Corner } from './TrackLayout';
import { TrackMath } from './TrackMath';
import { buildTrackGeometry } from './TrackGeometry';

function makeSample(): TrackSample {
  return {
    pos: new THREE.Vector3(), tangent: new THREE.Vector3(),
    normal: new THREE.Vector3(), binormal: new THREE.Vector3(),
    halfWidth: 0, bank: 0, distance: 0, t: 0,
  };
}
function makeProbe(): SurfaceProbe {
  return { y: 0, normal: new THREE.Vector3(), surface: Surface.Road, lateral: 0, t: 0, edgeRatio: 0 };
}

export class Track implements ITrack {
  readonly group = new THREE.Group();
  readonly startGrid: { pos: THREE.Vector3; yaw: number }[] = [];
  readonly checkpointCount = CHECKPOINTS;
  readonly bounds = new THREE.Box3();
  length = 0;

  /** The pure-math half of the track; also the session server's authority. */
  readonly math: TrackMath;

  /** baked station table — TrackGeometry reads this directly */
  get cl(): Centerline { return this.math.cl; }

  /**
   * Every corner on the lap, apex-first, with its turn direction and strength.
   *
   * Published rather than kept private because it is the answer to the round-1
   * read-ahead note and *only the track can compute it*. Scenery is asked to put
   * a tall landmark on the outside of every blind corner exit; it currently has
   * three of them (banner arch, windmill, lighthouse) pinned to hand-typed `t`
   * values that do not coincide with any corner. `landmarkAnchor()` below turns
   * an entry here into the world point where that landmark belongs.
   */
  get corners(): readonly Corner[] { return this.math.corners; }

  // --- macro heightfield of the surrounding land (built by TrackMath) -----
  get hmX0() { return this.math.hmX0; }
  get hmZ0() { return this.math.hmZ0; }
  get hmCell() { return this.math.hmCell; }
  get hmW() { return this.math.hmW; }
  get hmH() { return this.math.hmH; }
  get hm() { return this.math.hm; }

  // --- pooled returns ----------------------------------------------------
  private probePool: SurfaceProbe[] = [];
  private probeAt = 0;
  private wallPool: { push: THREE.Vector3; normal: THREE.Vector3 }[] = [];
  private wallAt = 0;
  private seaMesh: THREE.Mesh | null = null;
  private seaChecked = false;

  // --- materials the geometry pass cloned out of the shared library --------
  // Those clones are invisible to `Materials.update()`, which is what hands
  // every road surface its environment map once the sky has been rendered.
  // Without this the tarmac would silently lose its env term the moment we
  // started cloning to enable vertex colours.
  private envClones: THREE.MeshStandardMaterial[] = [];
  private lastEnv: THREE.Texture | null | undefined;

  constructor() {
    this.math = new TrackMath();
    this.length = this.math.length;
    for (let i = 0; i < 16; i++) this.probePool.push(makeProbe());
    for (let i = 0; i < 8; i++) {
      this.wallPool.push({ push: new THREE.Vector3(), normal: new THREE.Vector3() });
    }
    this.buildStartGrid();
    this.computeBounds();
  }

  init(ctx: Ctx) {
    buildTrackGeometry(this, ctx);
    ctx.scene.add(this.group);
  }

  update(ctx: Ctx) {
    if (ctx.envMap !== this.lastEnv && this.envClones.length) {
      this.lastEnv = ctx.envMap;
      for (const m of this.envClones) { m.envMap = ctx.envMap; m.needsUpdate = true; }
    }
    if (this.seaChecked || !this.seaMesh) return;
    this.seaChecked = true;
    // The circuit needs a sea to sit in whether or not the scenery pass
    // shipped one. If somebody else added an ocean, stand down rather than
    // fight them for the z-buffer at y = 0.
    let foreign = false;
    ctx.scene.traverse((o) => {
      if (o !== this.seaMesh && /sea|ocean|water/i.test(o.name)) foreign = true;
    });
    if (foreign) {
      this.seaMesh.parent?.remove(this.seaMesh);
      this.seaMesh = null;
    }
  }

  dispose() {
    this.group.traverse((o: any) => {
      o.geometry?.dispose?.();
      const m = o.material;
      if (Array.isArray(m)) m.forEach((x: any) => x.dispose?.());
      else m?.dispose?.();
    });
  }

  // =======================================================================
  //  Sampling
  // =======================================================================

  /** `out` is a non-interface convenience: pass a scratch to avoid garbage. */
  sample(t: number, out?: TrackSample): TrackSample {
    const s = out || makeSample();
    const m = this.math.sample(t);
    s.pos.set(m.pos[0], m.pos[1], m.pos[2]);
    s.tangent.set(m.tangent[0], m.tangent[1], m.tangent[2]);
    s.normal.set(m.normal[0], m.normal[1], m.normal[2]);
    s.binormal.set(m.binormal[0], m.binormal[1], m.binormal[2]);
    s.halfWidth = m.halfWidth;
    s.bank = m.bank;
    s.distance = m.distance;
    s.t = m.t;
    return s;
  }

  sampleByDistance(d: number, out?: TrackSample): TrackSample {
    return this.sample(d / this.length, out);
  }

  checkpointAt(t: number): number {
    return this.math.checkpointAt(t);
  }

  minimapPath(samples: number): { x: number; z: number }[] {
    return this.math.minimapPath(samples);
  }

  // =======================================================================
  //  Cross-section — delegated to TrackMath, the single source of truth.
  // =======================================================================

  /** d(crossOffset)/dL on the roadway, i.e. the extra lateral slope the surface
   *  carries on top of the banked plane. See TrackMath for the full note. */
  roadSlope(i: number, L: number): number {
    return this.math.roadSlope(i, L);
  }

  /** Vertical offset of the ground from the banked road plane, at lateral L. */
  crossOffset(i: number, L: number): number {
    return this.math.crossOffset(i, L);
  }

  /** Raised kerb, evaluated straight off the shared `KERB_QS`/`KERB_HS` table. */
  kerbProfile(q0: number, i: number): number {
    return this.math.kerbProfile(q0, i);
  }

  /** World point of the drivable/terrain surface at station i, lateral L. */
  crossPoint(i: number, L: number, out: THREE.Vector3): THREE.Vector3 {
    const p = this.math.crossPointInto(i, L, _cp);
    return out.set(p[0], p[1], p[2]);
  }

  /** Rock/soil detail displacement at a surface point, shared with probe(). */
  detailAt(i: number, L: number, x: number, z: number): number {
    return this.math.detailAt(i, L, x, z);
  }

  // =======================================================================
  //  Station lookup
  // =======================================================================

  /** Nearest station to (x,z) — global, grid accelerated. */
  nearestStation(x: number, z: number): number {
    return this.math.nearestStation(x, z);
  }

  // =======================================================================
  //  probe — called for every wheel of every kart, every frame
  // =======================================================================

  probe(p: THREE.Vector3, hintT: number): SurfaceProbe {
    this.probeAt = (this.probeAt + 1) & 15;
    const out = this.probePool[this.probeAt];
    const m = this.math.probe(p.x, p.y, p.z, hintT);
    out.t = m.t;
    out.lateral = m.lateral;
    out.edgeRatio = m.edgeRatio;
    out.normal.set(m.nx, m.ny, m.nz);
    out.y = m.y;
    out.surface = m.surface;
    return out;
  }

  // =======================================================================
  //  Walls
  // =======================================================================

  collideWalls(p: THREE.Vector3, radius: number, hintT: number) {
    const hit = this.math.collideWalls(p.x, p.y, p.z, radius, hintT);
    if (!hit) return null;
    this.wallAt = (this.wallAt + 1) & 7;
    const r = this.wallPool[this.wallAt];
    r.normal.set(hit.normal[0], hit.normal[1], hit.normal[2]);
    r.push.set(hit.push[0], hit.push[1], hit.push[2]);
    return r;
  }

  // =======================================================================
  //  Macro heightfield
  // =======================================================================

  /** Bilinear macro height (no detail noise) at a world XZ. */
  sampleHeightfield(x: number, z: number): number {
    return this.math.sampleHeightfield(x, z);
  }

  /**
   * Full ground height at an arbitrary world XZ, used by the terrain mesh.
   * Identical maths to probe()'s off-road branch — the two are not allowed to
   * disagree, or terrain pokes through the road.
   */
  groundAt(x: number, z: number): number {
    return this.math.groundAt(x, z);
  }

  /** Signed lateral offset (horizontal) of a world XZ from the centreline. */
  lateralAt(x: number, z: number): number {
    return this.math.lateralAt(x, z);
  }

  /** Rockiness 0..1 at a world XZ, for terrain vertex colouring. */
  rockAt(x: number, z: number): number {
    return this.math.rockAt(x, z);
  }

  // =======================================================================
  //  Start grid + bounds
  // =======================================================================

  private buildStartGrid() {
    for (const slot of this.math.startGridPlain()) {
      this.startGrid.push({
        pos: new THREE.Vector3(slot.pos[0], slot.pos[1], slot.pos[2]),
        yaw: slot.yaw,
      });
    }
  }

  private computeBounds() {
    const { min, max } = this.math.boundsPlain();
    this.bounds.set(new THREE.Vector3(...min), new THREE.Vector3(...max));
  }

  /**
   * Where a read-ahead landmark for corner `c` belongs, in world space.
   *
   * `out` lands on the ground `off` metres outside the kerb, `ahead` metres past
   * the mark point — i.e. on the *exit* of the corner, on the *outside*, which
   * is the sightline a driver on the entry is already looking down. That is the
   * position a Nintendo course puts its arch, its windmill or its lighthouse,
   * and the reason those read as navigation rather than as decoration.
   *
   * Returns the outward horizontal direction as well, so a caller can face the
   * landmark back at the road without recomputing the frame.
   */
  landmarkAnchor(c: Corner, out: THREE.Vector3, outward?: THREE.Vector3,
    ahead = 55, off = 9): THREE.Vector3 {
    const cl = this.cl;
    const d = ((c.d + ahead) % cl.length + cl.length) % cl.length;
    const i = Math.floor(d / cl.ds) % cl.count;
    const side = -c.sign;   // the outside of the turn
    const lat = side * (cl.half[i] + KERB_W + off);
    this.crossPoint(i, lat, out);
    out.y = this.groundAt(out.x, out.z);
    if (outward) outward.set(cl.hx[i] * side, 0, cl.hz[i] * side).normalize();
    return out;
  }

  /** Zone id at a normalised progress — used by the geometry builder. */
  zoneAt(t: number): number {
    return this.math.zoneAt(t);
  }

  /** Called by TrackGeometry so update() can stand down if scenery has a sea. */
  registerSea(m: THREE.Mesh) { this.seaMesh = m; }

  /** Materials TrackGeometry cloned; we keep their env map in step. */
  registerEnvClones(mats: THREE.MeshStandardMaterial[]) {
    this.envClones = mats;
    this.lastEnv = undefined;
  }
}

/** Scratch for crossPoint adaptation; nothing in the hot path allocates. */
const _cp: [number, number, number] = [0, 0, 0];

export { ZONES };
