/* ==========================================================================
   Model Arena — Local Session Ledger Storage
   Persists sessions in localStorage keyed by workspace and user. In the TAP runtime
   this is the seam where VFS-backed artifacts would be swapped in.
   ========================================================================== */

import type { ModelComparisonSession } from "./domain";
import { getSessionStorageKey } from "./config";

const MAX_LOCAL_LEDGER_BYTES = 3_500_000;
const MAX_LOCAL_LEDGER_SESSIONS = 20;
const encoder = new TextEncoder();

export type SessionSaveFailure = "storage-unavailable" | "session-too-large" | "quota";

export interface SessionSaveResult {
  sessions: ModelComparisonSession[];
  persisted: boolean;
  droppedSessions: number;
  failure?: SessionSaveFailure | undefined;
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

/** Load all persisted sessions, newest first. */
export function loadSessions(workspaceId: string, userId: string): ModelComparisonSession[] {
  const storage = safeStorage();
  if (!storage) return [];
  const raw = storage.getItem(getSessionStorageKey(workspaceId, userId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as ModelComparisonSession[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, MAX_LOCAL_LEDGER_SESSIONS);
  } catch {
    return [];
  }
}

function persistSerialized(
  serialized: string,
  workspaceId: string,
  userId: string,
): boolean {
  const storage = safeStorage();
  if (!storage) return false;
  try {
    storage.setItem(getSessionStorageKey(workspaceId, userId), serialized);
    return true;
  } catch {
    return false;
  }
}

/** Insert or replace a session in a bounded, best-effort browser ledger. */
export function saveSession(
  session: ModelComparisonSession,
  workspaceId: string,
  userId: string,
): SessionSaveResult {
  if (!safeStorage()) {
    return { sessions: [session], persisted: false, droppedSessions: 0, failure: "storage-unavailable" };
  }

  const sessions = loadSessions(workspaceId, userId).filter((s) => s.id !== session.id);
  sessions.unshift(session);
  let droppedSessions = Math.max(0, sessions.length - MAX_LOCAL_LEDGER_SESSIONS);
  sessions.splice(MAX_LOCAL_LEDGER_SESSIONS);

  while (sessions.length > 0) {
    const serialized = JSON.stringify(sessions);
    if (encoder.encode(serialized).byteLength <= MAX_LOCAL_LEDGER_BYTES) {
      if (persistSerialized(serialized, workspaceId, userId)) {
        return { sessions, persisted: true, droppedSessions };
      }
    }

    if (sessions.length === 1) {
      return {
        sessions,
        persisted: false,
        droppedSessions,
        failure:
          encoder.encode(serialized).byteLength > MAX_LOCAL_LEDGER_BYTES
            ? "session-too-large"
            : "quota",
      };
    }
    sessions.pop();
    droppedSessions += 1;
  }

  return { sessions: [session], persisted: false, droppedSessions, failure: "quota" };
}

/** Remove a session from the ledger. */
export function deleteSession(
  sessionId: string,
  workspaceId: string,
  userId: string,
): ModelComparisonSession[] {
  const sessions = loadSessions(workspaceId, userId).filter((s) => s.id !== sessionId);
  persistSerialized(JSON.stringify(sessions), workspaceId, userId);
  return sessions;
}
