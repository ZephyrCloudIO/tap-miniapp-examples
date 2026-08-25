/* ==========================================================================
   Model Arena — Runtime Configuration
   All host/workspace-specific values resolve here from the environment or
   the miniapp SDK context. Nothing in this file hardcodes model lists,
   workspace IDs, or user identity.
   ========================================================================== */

function env(key: string): string | undefined {
  return typeof process !== "undefined" && process.env[key]
    ? process.env[key]
    : undefined;
}

/** Workspace ID stamped on local TRR audit artifacts. Must be provided by the host
 *  (miniapp SDK context); falls back to env for the standalone preview. */
export function getWorkspaceId(): string {
  return env("TAP_WORKSPACE_ID") ?? "local-preview";
}

/** Identity recorded as session creator. */
export function getCreatorIdentity(): string {
  return env("TAP_USER_ID") ?? "local-user";
}

const STORAGE_KEY = "model-arena:sessions";

/** Storage key for the private local session ledger. Both dimensions are
 * explicit so a mounted host surface can never silently fall back to a shared
 * preview bucket. */
export function getSessionStorageKey(workspaceId: string, userId: string): string {
  return `${STORAGE_KEY}:${encodeURIComponent(workspaceId)}:${encodeURIComponent(userId)}`;
}
