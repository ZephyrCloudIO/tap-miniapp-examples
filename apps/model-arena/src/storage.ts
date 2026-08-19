/* ==========================================================================
   Model Arena — Local Session Ledger Storage
   Persists sessions in localStorage keyed by workspace. In the TAP runtime
   this is the seam where VFS-backed artifacts would be swapped in.
   ========================================================================== */

import type { ModelComparisonSession } from "./domain";
import { getSessionStorageKey } from "./config";

function safeStorage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

/** Load all persisted sessions, newest first. */
export function loadSessions(): ModelComparisonSession[] {
  const storage = safeStorage();
  if (!storage) return [];
  const raw = storage.getItem(getSessionStorageKey());
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as ModelComparisonSession[];
    if (!Array.isArray(parsed)) return [];
    return parsed.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

function persist(sessions: ModelComparisonSession[]): void {
  const storage = safeStorage();
  if (!storage) return;
  storage.setItem(getSessionStorageKey(), JSON.stringify(sessions));
}

/** Insert or replace a session in the ledger. */
export function saveSession(session: ModelComparisonSession): ModelComparisonSession[] {
  const sessions = loadSessions().filter((s) => s.id !== session.id);
  sessions.unshift(session);
  persist(sessions);
  return sessions;
}

/** Remove a session from the ledger. */
export function deleteSession(sessionId: string): ModelComparisonSession[] {
  const sessions = loadSessions().filter((s) => s.id !== sessionId);
  persist(sessions);
  return sessions;
}
