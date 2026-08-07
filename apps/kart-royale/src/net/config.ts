/**
 * Session-server configuration. The browser preview takes `?server=` (default:
 * the local `wrangler dev` origin); the packaged surface uses the deployed
 * Worker origin, overridable at build time via the KART_ROYALE_SERVER_URL env.
 */
export const DEFAULT_SERVER_URL =
  'https://tap-kart-royale-server-production.zephyr-cloud-app-dev.workers.dev';
export const DEV_SERVER_URL = 'http://localhost:8787';

declare const __KART_ROYALE_SERVER_URL__: string | undefined;

/** null when multiplayer is not configured for this runtime (solo stays on). */
export function serverUrl(packaged: boolean): string | null {
  if (packaged) {
    const defined = typeof __KART_ROYALE_SERVER_URL__ === 'string' ? __KART_ROYALE_SERVER_URL__ : '';
    return defined || DEFAULT_SERVER_URL;
  }
  const params = new URLSearchParams(window.location.search);
  const explicit = params.get('server');
  if (explicit) return explicit.replace(/\/$/, '');
  // A dev preview with no flag gets the local server if one is running —
  // checked lazily by the lobby (it lists rooms and fails soft).
  return DEV_SERVER_URL;
}
