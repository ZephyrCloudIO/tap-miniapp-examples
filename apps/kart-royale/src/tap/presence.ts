/**
 * TAP presence bridge for the packaged surface: announces this member's lobby
 * state to the channel. Presence is informative, never authoritative — the
 * race room owns the roster — and every call fails soft: presence must never
 * break the game.
 */
import { sdk } from '@theaiplatform/miniapp-sdk/sdk';

export const PRESENCE_NAMESPACE = 'kart-royale';

export interface KartPresenceState {
  role: 'idle' | 'player' | 'spectator';
  raceId: string | null;
  ready: boolean;
  hosting: boolean;
}

function presenceAvailable(): boolean {
  try {
    return sdk.presence !== undefined;
  } catch {
    return false;
  }
}

export async function joinPresence(room: string, state: KartPresenceState): Promise<void> {
  if (!presenceAvailable()) return;
  try {
    await sdk.presence.join({ namespace: PRESENCE_NAMESPACE, room, state: state as never });
  } catch {
    /* informative only */
  }
}

export async function updatePresence(room: string, state: KartPresenceState): Promise<void> {
  if (!presenceAvailable()) return;
  try {
    await sdk.presence.update({ namespace: PRESENCE_NAMESPACE, room, state: state as never });
  } catch {
    /* informative only */
  }
}

export async function leavePresence(room: string): Promise<void> {
  if (!presenceAvailable()) return;
  try {
    await sdk.presence.leave({ namespace: PRESENCE_NAMESPACE, room });
  } catch {
    /* informative only */
  }
}
