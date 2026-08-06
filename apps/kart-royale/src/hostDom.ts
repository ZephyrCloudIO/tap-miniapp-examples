/**
 * ============================================================================
 *  GAME HOST FACTORY
 * ============================================================================
 *  The game expects three elements — `#app` (renderer parent), `#ui` (HUD /
 *  menu overlay) and `#boot` (the boot curtain) — which upstream lived in
 *  index.html as `position: fixed` page elements. A TAP miniapp is not a page:
 *  it mounts into a container handed over by the host, so this factory builds
 *  the same structure scoped to that container with `absolute` positioning,
 *  and scopes the accompanying CSS under `.kart-host` so nothing leaks global
 *  selectors into the surrounding document.
 *
 *  Both entry points use it:
 *  - `preview.ts` (standalone dev/preview page) mounts it on `document.body`;
 *  - `surface.ts` (TAP federated surface) mounts it inside the host-provided
 *    container.
 * ============================================================================
 */

const HOST_CSS = `
.kart-host {
  position: absolute; inset: 0; overflow: hidden; background: #05070d;
  touch-action: none; overscroll-behavior: none;
  -webkit-user-select: none; user-select: none;
  -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  -webkit-font-smoothing: antialiased;
}
.kart-host, .kart-host * { margin: 0; padding: 0; box-sizing: border-box; }
.kart-host #app { position: absolute; inset: 0; }
.kart-host canvas { display: block; width: 100%; height: 100%; touch-action: none; }
.kart-host #ui { position: absolute; inset: 0; pointer-events: none; z-index: 10; }
.kart-host #boot {
  position: absolute; inset: 0; z-index: 100; display: grid; place-items: center;
  background:
    radial-gradient(120% 90% at 50% 8%, #2c3560 0%, #141a33 42%, #080b16 100%);
  color: #f3f6fb; transition: opacity .55s ease;
}
.kart-host #boot.done { opacity: 0; pointer-events: none; }
.kart-host .boot-in { display: flex; flex-direction: column; align-items: center; gap: 3.4vmin; }
.kart-host .boot-mark {
  font-size: 8.2vmin; font-weight: 900; letter-spacing: .1em; line-height: .96;
  display: flex; flex-direction: column; align-items: center;
  background: linear-gradient(180deg, #fff 12%, #ffd27a 58%, #f0a23c 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 3px 10px rgba(0,0,0,.55));
}
.kart-host .boot-mark span { font-size: .52em; letter-spacing: .38em; margin-left: .38em; }
.kart-host .boot-bar {
  width: 42vmin; max-width: 380px; height: 5px; border-radius: 999px;
  background: rgba(255,255,255,.13); overflow: hidden;
}
.kart-host .boot-bar i {
  display: block; width: 0%; height: 100%; border-radius: 999px;
  background: linear-gradient(90deg, #6ad2ff, #ffd27a);
  transition: width .3s ease; box-shadow: 0 0 12px rgba(255,200,120,.7);
}
.kart-host .boot-step {
  font-size: 2.5vmin; letter-spacing: .22em; text-transform: uppercase;
  color: rgba(233,240,250,.62); min-height: 1.2em;
}
@media (prefers-reduced-motion: reduce) {
  .kart-host #boot, .kart-host .boot-bar i { transition: none; }
}
`;

export interface KartGameHost {
  /** The element to hand to `startKartRoyale()`. */
  readonly host: HTMLElement;
  /** Remove the host element and its scoped stylesheet from the document. */
  dispose(): void;
}

/**
 * Build the game's DOM scaffold inside `container` and return it. The caller
 * keeps ownership of `container` itself; `dispose()` removes only what this
 * factory created.
 */
export function createGameHost(container: HTMLElement): KartGameHost {
  const style = document.createElement('style');
  style.textContent = HOST_CSS;

  const host = document.createElement('div');
  host.className = 'kart-host';
  host.innerHTML = `
    <div id="app"></div>
    <div id="ui"></div>
    <div id="boot">
      <div class="boot-in">
        <div class="boot-mark">KART<span>ROYALE</span></div>
        <div class="boot-bar"><i></i></div>
        <div class="boot-step">starting up</div>
      </div>
    </div>`;

  host.prepend(style);
  container.appendChild(host);

  return {
    host,
    dispose() {
      host.remove();
    },
  };
}
