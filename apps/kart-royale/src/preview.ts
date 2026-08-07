/**
 * Standalone dev/preview entry. In packaged mode the TAP host calls the
 * federated surface's `mount()` instead — this file is the browser-preview
 * equivalent: build the host scaffold on the page body, start the game, and
 * wire the multiplayer session against the session server (`?server=` to
 * override the default local `wrangler dev` origin).
 *
 * Preview identity: `?user=` pins a pilot id (use two browser profiles, or two
 * different values, to race two clients); otherwise one is generated and kept
 * for the tab session. `?channel=` selects the lobby channel.
 */
import { createGameHost } from './hostDom';
import { startKartRoyale } from './main';
import { MultiplayerSession } from './net/MultiplayerSession';
import { serverUrl } from './net/config';
import type { Race } from './game/Race';

const { host } = createGameHost(document.body);
const handle = startKartRoyale(host);

function previewIdentity(): { userId: string; channelId: string; displayName: string } {
  const params = new URLSearchParams(window.location.search);
  let userId = params.get('user');
  if (!userId) {
    userId = sessionStorage.getItem('kr.preview.user') ??
      `pilot-${Math.random().toString(36).slice(2, 8)}`;
    sessionStorage.setItem('kr.preview.user', userId);
  }
  return {
    userId,
    channelId: params.get('channel') ?? 'preview-lobby',
    displayName: params.get('name') ?? userId,
  };
}

const mp = serverUrl(false);
if (mp) {
  const session = new MultiplayerSession({
    host,
    ctx: handle.ctx,
    serverUrl: mp,
    identity: previewIdentity(),
  });
  // Harnesses drive and inspect multiplayer through this handle, like __ctx.
  (window as any).__mp = session;
}
