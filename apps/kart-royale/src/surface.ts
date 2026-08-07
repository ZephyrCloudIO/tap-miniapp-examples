/**
 * TAP federated desktop surface. The host mounts this expose inside its
 * isolated webview; it builds the game's DOM scaffold, hydrates player
 * persistence from TAP storage, checks the declared play permission, and
 * starts the game. Everything TAP-specific lives behind small adapters so the
 * game code itself stays host-agnostic.
 */
import type {
  TapFederatedSurfaceMount,
  TapFederatedSurfaceMountContext,
} from '@theaiplatform/miniapp-sdk/surface';
import { installMiniAppAppearanceSync } from '@theaiplatform/miniapp-sdk/web';
import { sdk } from '@theaiplatform/miniapp-sdk/sdk';
import { createGameHost, type KartGameHost } from './hostDom';
import { startKartRoyale, type KartRoyaleHandle } from './main';
import { registerActiveGame, unregisterActiveGame } from './tap/activeSurface';
import { canPlay } from './tap/authority';
import { hydrateControlPrefs } from './tap/persistence';
import { tapRest } from './tap/http';
import { hostWebSocketFactory } from './tap/websocket';
import { MultiplayerSession } from './net/MultiplayerSession';
import { serverUrl } from './net/config';
import type { Race } from './game/Race';

export const surfaceTarget = 'desktop' as const;

/** Best available display name: the OAuth profile's, else the canonical user id. */
async function displayNameFor(userId: string): Promise<string> {
  try {
    const profile = await sdk.auth?.getUserProfile();
    const name = profile?.preferredUsername ?? profile?.name ?? profile?.nickname;
    if (typeof name === 'string' && name.trim()) return name.trim();
  } catch {
    /* profile is optional; the user id is a fine name */
  }
  return userId;
}

/** Fail-closed notice shown when the channel has not granted kart-royale.play. */
function renderPlayDenied(container: HTMLElement): void {
  const notice = document.createElement('div');
  notice.setAttribute('role', 'alert');
  notice.style.cssText =
    'position:absolute;inset:0;display:grid;place-items:center;' +
    'background:#080b16;color:#f3f6fb;font:15px system-ui,sans-serif;' +
    'text-align:center;padding:24px;';
  notice.textContent =
    'Kart Royale needs the kart-royale.play permission in this channel before the race can start.';
  container.appendChild(notice);
}

export function mount(
  container: HTMLElement,
  context: TapFederatedSurfaceMountContext,
): TapFederatedSurfaceMount {
  const stopAppearanceSync = installMiniAppAppearanceSync();

  let mounted = true;
  let gameHost: KartGameHost | null = null;
  let handle: KartRoyaleHandle | null = null;
  let session: MultiplayerSession | null = null;

  // Boot is async either way (shader pre-warm), so hydrating the player's
  // control prefs first adds no visible delay — and it keeps ControlPrefs'
  // synchronous load() contract intact.
  const ready = (async () => {
    if (context.userId) {
      try {
        await hydrateControlPrefs(context.userId);
      } catch {
        /* storage unavailable: in-memory defaults are a valid answer */
      }
    }
    if (!mounted || container.isConnected === false) return;

    if (!(await canPlay(context, false))) {
      renderPlayDenied(container);
      return;
    }

    gameHost = createGameHost(container);
    handle = startKartRoyale(gameHost.host);
    registerActiveGame(handle);

    // Multiplayer is additive: the surface works fully offline, and the lobby
    // reports the server unreachable rather than blocking solo play. The REST
    // leg is host-mediated (platform-session); the live race leg is a
    // ticket-authenticated WebSocket owned by the trusted host broker.
    const mp = serverUrl(true);
    if (mp && context.userId && context.channelId) {
      const displayName = await displayNameFor(context.userId);
      if (!mounted || !handle) return;
      session = new MultiplayerSession({
        host: gameHost.host,
        ctx: handle.ctx,
        serverUrl: mp,
        identity: {
          userId: context.userId,
          channelId: context.channelId,
          displayName,
        },
        rest: tapRest(mp),
        socketFactory: hostWebSocketFactory,
        tap: { events: context.events },
      });
    }
  })();

  return {
    async unmount() {
      if (!mounted) return;
      mounted = false;
      // A boot in flight must finish (or observe the flag) before disposal,
      // or it would keep booting into a detached container.
      await ready.catch(() => {});
      session?.dispose();
      session = null;
      if (handle) {
        unregisterActiveGame(handle);
        handle.dispose();
        handle = null;
      }
      gameHost?.dispose();
      gameHost = null;
      container.replaceChildren();
      stopAppearanceSync();
    },
  };
}

export default Object.freeze({ mount, surfaceTarget });
