/**
 * ============================================================================
 *  ITEM TABLES — the shared draw contract
 * ============================================================================
 *  The box-respawn clock, the roulette arm time and the placement-weighted
 *  item draw, shared verbatim between the game (`Items.ts`) and the session
 *  server. In multiplayer the Durable Object rolls from THIS table so a draw
 *  is the same answer no matter which side asked the question.
 * ============================================================================
 */
import { ItemKind } from '../types';

/** seconds a collected box stays down (matches the prop's pop-back animation) */
export const BOX_RESPAWN_S = 2.5;
/** seconds between the grant and the first legal spend — the roulette is not decoration */
export const ARM_TIME_S = 1.05;
/** items in a TripleMushroom grant */
export const TRIPLE_COUNT = 3;

/** ItemKind.TripleMushroom as a plain number, for hosts that treat kinds opaquely. */
export const TRIPLE_MUSHROOM_KIND: number = ItemKind.TripleMushroom;

/** Items that can be deployed as a shield and released by a later use. */
export function isCarryableItemKind(kind: number): boolean {
  return kind === ItemKind.GreenShell || kind === ItemKind.RedShell || kind === ItemKind.Banana;
}

/** placement curve: [front, midfield, back] weights per kind */
export const ITEM_WEIGHTS: Record<number, [number, number, number]> = {
  [ItemKind.Mushroom]:       [10, 26, 16],
  [ItemKind.TripleMushroom]: [0, 10, 21],
  [ItemKind.GreenShell]:     [33, 19, 6],
  [ItemKind.RedShell]:       [4, 21, 17],
  [ItemKind.Banana]:         [38, 13, 4],
  [ItemKind.Star]:           [0, 4, 17],
  [ItemKind.Bolt]:           [0, 2, 10],
  [ItemKind.Bomb]:           [15, 11, 5],
};

export const ITEM_KINDS = Object.keys(ITEM_WEIGHTS).map(Number);

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Roll an item appropriate to `place` (1 = leading). `rand` is the entropy
 * source — `Math.random` solo, the room's seeded generator on the server.
 */
export function rollItem(rand: () => number, place: number, racers: number): number {
  const p = racers > 1 ? clamp((place - 1) / (racers - 1), 0, 1) : 0;
  let total = 0;
  let pick = ItemKind.Mushroom;
  for (const kind of ITEM_KINDS) {
    const w = ITEM_WEIGHTS[kind];
    // two-segment lerp through the midfield column
    const v = p < 0.5 ? w[0] + (w[1] - w[0]) * (p * 2) : w[1] + (w[2] - w[1]) * ((p - 0.5) * 2);
    if (v <= 0) continue;
    total += v;
    if (rand() * total < v) pick = kind;
  }
  return total > 0 ? pick : ItemKind.Mushroom;
}
