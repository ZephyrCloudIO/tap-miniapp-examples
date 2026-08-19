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

const API_KEY_STORAGE_KEY = "model-arena:openrouter-api-key";

function safeStorage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

/** Resolve the OpenRouter API key: user-entered key (stored locally) first,
 *  then the environment / credential system. */
export function getApiKey(): string {
  return safeStorage()?.getItem(API_KEY_STORAGE_KEY) ?? env("OPENROUTER_API_KEY") ?? "";
}

/** Persist a user-entered OpenRouter API key locally. */
export function setApiKey(key: string): void {
  const storage = safeStorage();
  if (!storage) return;
  const trimmed = key.trim();
  if (trimmed) storage.setItem(API_KEY_STORAGE_KEY, trimmed);
  else storage.removeItem(API_KEY_STORAGE_KEY);
}

/** True when any API key source is configured. */
export function hasApiKey(): boolean {
  return getApiKey() !== "";
}

/** Optional attribution headers for OpenRouter. Omitted entirely when unset. */
export function getAttributionHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const referer = env("OPENROUTER_HTTP_REFERER");
  const appTitle = env("OPENROUTER_APP_TITLE");
  if (referer) headers["HTTP-Referer"] = referer;
  if (appTitle) headers["X-Title"] = appTitle;
  return headers;
}

/** Workspace ID stamped on TRR events. Must be provided by the host
 *  (miniapp SDK context); falls back to env for the standalone preview. */
export function getWorkspaceId(): string {
  return env("TAP_WORKSPACE_ID") ?? "local-preview";
}

/** Identity recorded as session creator. */
export function getCreatorIdentity(): string {
  return env("TAP_USER_ID") ?? "local-user";
}

const STORAGE_KEY = "model-arena:sessions";

/** Storage key for the local session ledger. */
export function getSessionStorageKey(): string {
  return `${STORAGE_KEY}:${getWorkspaceId()}`;
}
