/**
 * ============================================================================
 *  TAP-BACKED PERSISTENCE (packaged mode)
 * ============================================================================
 *  Installs the ControlPrefs backend that stores the record in TAP host
 *  storage instead of browser localStorage. The control-prefs contract is
 *  synchronous (`load()` must never block or throw — see ControlPrefs.ts), so
 *  the TAP document is hydrated BEFORE the game boots and the backend serves
 *  reads from memory, writing through asynchronously with CAS conflict
 *  handling.
 *
 *  Layout: one player-scoped document at
 *  `kart-royale:users/{userId}/control-prefs`.
 * ============================================================================
 */
import { installControlPrefsBackend } from '../core/ControlPrefs';
import { BridgeError, storageGet, storageSet } from './bridge';

export const TAP_STORAGE_NAMESPACE = 'kart-royale';

function controlPrefsKey(userId: string): string {
  return `users/${userId}/control-prefs`;
}

/**
 * Read the player's stored prefs from TAP storage and install the write-through
 * backend. On any failure the in-memory defaults remain live — a storage
 * outage must never cost the player their controls.
 */
export async function hydrateControlPrefs(userId: string): Promise<void> {
  const key = controlPrefsKey(userId);
  let cachedRaw: string | null = null;
  let revision: number | null = null;

  try {
    const stored = await storageGet<Record<string, unknown>>(TAP_STORAGE_NAMESPACE, key);
    revision = stored.revision;
    cachedRaw = stored.value === null ? null : JSON.stringify(stored.value);
  } catch {
    /* First run, or storage unavailable: defaults are a valid answer. */
  }

  installControlPrefsBackend({
    read: () => cachedRaw,
    write(raw) {
      cachedRaw = raw;
      void flush(raw);
    },
  });

  async function flush(raw: string): Promise<void> {
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return; // our own serializer produced this; unreachable in practice
    }
    try {
      revision = await storageSet(TAP_STORAGE_NAMESPACE, key, value, revision);
    } catch (error) {
      if (error instanceof BridgeError && error.kind === 'conflict') {
        // Another surface of the same player wrote concurrently. Re-read and
        // retry once with the fresh revision; last writer wins is the correct
        // semantic for one player's control preferences.
        try {
          const stored = await storageGet<Record<string, unknown>>(TAP_STORAGE_NAMESPACE, key);
          revision = stored.revision;
          cachedRaw = stored.value === null ? null : JSON.stringify(stored.value);
          revision = await storageSet(TAP_STORAGE_NAMESPACE, key, value, revision);
          cachedRaw = raw;
        } catch {
          /* keep the in-memory value; the next save retries */
        }
      }
      /* other failures: keep the in-memory value; the next save retries */
    }
  }
}
