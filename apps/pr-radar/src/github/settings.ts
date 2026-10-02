/**
 * Installation settings, stored in this package's workspace-private database.
 *
 * Stored values are re-validated on read: a persisted blob is written by an
 * older release of this package, not by the host, so it is treated as
 * untrusted input rather than as a known shape.
 */
import {
  DEFAULT_NOTIFICATION_KINDS,
  isNotificationKind,
  type NotificationKind,
} from "./events";
import { splitRepository } from "./client";

export const MIN_POLL_INTERVAL_SECONDS = 30;
export const MAX_POLL_INTERVAL_SECONDS = 900;
export const DEFAULT_POLL_INTERVAL_SECONDS = 60;
export const MAX_TRACKED_REPOSITORIES = 25;
const MAX_CREDENTIAL_ID_LENGTH = 512;
const MAX_CREDENTIAL_NAME_LENGTH = 200;
/** Reserved credentialRef that attaches the TAP account session, never a GitHub token. */
const PLATFORM_SESSION_CREDENTIAL_REF = "platform-session";

/**
 * How the user approved GitHub access. `null` means no approval yet, and the
 * package sends no GitHub request until the user picks one.
 */
export type GithubAuthChoice =
  | { readonly mode: "tap" }
  | {
      readonly mode: "credential";
      readonly credentialId: string;
      readonly displayName: string;
    };

export interface PrRadarSettings {
  readonly version: 1;
  /** Owner-qualified repositories, exactly as GitHub spells them. */
  readonly repositories: readonly string[];
  readonly kinds: readonly NotificationKind[];
  readonly pollIntervalSeconds: number;
  readonly auth: GithubAuthChoice | null;
}

export const DEFAULT_SETTINGS: PrRadarSettings = Object.freeze({
  version: 1,
  repositories: [],
  kinds: DEFAULT_NOTIFICATION_KINDS,
  pollIntervalSeconds: DEFAULT_POLL_INTERVAL_SECONDS,
  auth: null,
});

export const isUsableCredentialId = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= MAX_CREDENTIAL_ID_LENGTH &&
  value.trim() === value &&
  value !== PLATFORM_SESSION_CREDENTIAL_REF;

const normalizeAuth = (value: unknown): GithubAuthChoice | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.mode === "tap") return { mode: "tap" };
  if (record.mode === "credential" && isUsableCredentialId(record.credentialId)) {
    const displayName =
      typeof record.displayName === "string" && record.displayName.trim()
        ? record.displayName.trim().slice(0, MAX_CREDENTIAL_NAME_LENGTH)
        : record.credentialId;
    return { mode: "credential", credentialId: record.credentialId, displayName };
  }
  return null;
};

export const normalizeRepository = (value: string): string | null => {
  const trimmed = value.trim().replace(/^https?:\/\/github\.com\//iu, "");
  const withoutSuffix = trimmed.replace(/\.git$/iu, "").replace(/\/+$/u, "");
  try {
    const { owner, name } = splitRepository(withoutSuffix);
    return `${owner}/${name}`;
  } catch {
    return null;
  }
};

const clampPollInterval = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_POLL_INTERVAL_SECONDS;
  }
  const rounded = Math.round(value);
  if (rounded < MIN_POLL_INTERVAL_SECONDS) return MIN_POLL_INTERVAL_SECONDS;
  if (rounded > MAX_POLL_INTERVAL_SECONDS) return MAX_POLL_INTERVAL_SECONDS;
  return rounded;
};

/** Coerce one persisted value into the current settings contract. */
export const normalizeSettings = (value: unknown): PrRadarSettings => {
  const record =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  const repositories: string[] = [];
  for (const candidate of Array.isArray(record.repositories)
    ? record.repositories
    : []) {
    if (typeof candidate !== "string") continue;
    const normalized = normalizeRepository(candidate);
    if (!normalized || repositories.includes(normalized)) continue;
    repositories.push(normalized);
    if (repositories.length >= MAX_TRACKED_REPOSITORIES) break;
  }

  const kinds: NotificationKind[] = [];
  for (const candidate of Array.isArray(record.kinds) ? record.kinds : []) {
    if (!isNotificationKind(candidate) || kinds.includes(candidate)) continue;
    kinds.push(candidate);
  }

  return {
    version: 1,
    repositories,
    kinds: kinds.length > 0 ? kinds : DEFAULT_NOTIFICATION_KINDS,
    pollIntervalSeconds: clampPollInterval(record.pollIntervalSeconds),
    auth: normalizeAuth(record.auth),
  };
};
