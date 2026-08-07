/**
 * Registry shared by the two federation exposes of this remote.
 *
 * `./ui/desktop` (surface.ts) and `./tap/lifecycle` (lifecycle.ts) are separate
 * exposes of the SAME remote container, so they share one module scope — the
 * same way the brainrot example's WASM instance carries state across its
 * exposes. The surface registers its running game handle here; the lifecycle
 * expose drives pause/resume through it.
 */
import type { KartRoyaleHandle } from '../main';

let active: KartRoyaleHandle | null = null;

export function registerActiveGame(handle: KartRoyaleHandle): void {
  active = handle;
}

export function unregisterActiveGame(handle: KartRoyaleHandle): void {
  if (active === handle) active = null;
}

export function activeGame(): KartRoyaleHandle | null {
  return active;
}
