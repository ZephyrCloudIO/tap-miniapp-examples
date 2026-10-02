/**
 * Workspace-private durable state: which pull requests are tracked, which
 * notifications have been recorded, and how far each pull request has been
 * read.
 *
 * The host binds the storage namespace to the authenticated workspace and to
 * this exact package, so package code cannot choose the scope and two
 * workspaces never observe each other's tracked pull requests. Every write is a
 * read-modify-write against the host's optimistic revision, so a stale snapshot
 * is re-read and re-applied instead of overwriting a newer value.
 *
 * Persisted documents are written by an older release of this package rather
 * than by the host, so they are treated as untrusted input and re-validated on
 * every read.
 */
import { sdk } from "@theaiplatform/miniapp-sdk/sdk";
import type {
  MiniAppJsonValue,
  MiniAppStorageApi,
} from "@theaiplatform/miniapp-sdk/sdk";
import type { ConflictState, GithubNotification, TrackedPullRequest } from "./events";
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  type PrRadarSettings,
} from "./settings";

/** Storage namespace declared as a `storage` effect in the package manifest. */
export const STORAGE_NAMESPACE = "github-notify";

const SETTINGS_KEY = "settings";
const TRACKED_KEY = "tracked";
const NOTIFICATIONS_KEY = "notifications";
const REPOSITORIES_KEY = "repositories";
const OPEN_PULLS_KEY = "open-pulls";
const DOCUMENT_VERSION = 1;
const MAX_WRITE_ATTEMPTS = 3;

/**
 * Notifications are a bounded feed. The oldest entry is dropped first, so a
 * long-running installation can never grow its stored state without limit.
 */
export const MAX_NOTIFICATIONS = 200;

/** Most recently updated open pull requests kept per repository, bounding the stored snapshot. */
export const MAX_OPEN_PULLS_PER_REPOSITORY = 100;

/** How the connected account relates to an open pull request. */
export const PULL_REQUEST_RELATIONS = [
  "author",
  "review-requested",
  "assigned",
  "reviewed",
  "involved",
] as const;
export type PullRequestRelation = (typeof PULL_REQUEST_RELATIONS)[number];

const isPullRequestRelation = (value: unknown): value is PullRequestRelation =>
  typeof value === "string" &&
  (PULL_REQUEST_RELATIONS as readonly string[]).includes(value);

/** One open pull request in a tracked repository that involves the connected account. */
export interface OpenPullRequestSummary {
  readonly repository: string;
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly author: string | null;
  readonly draft: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly headSha: string;
  readonly ciStatus: "success" | "failure" | "pending" | "unknown";
  readonly reviewDecision: "approved" | "changes-requested" | "pending";
  readonly conflict: ConflictState;
  readonly inMergeQueue: boolean;
  /** True when any bot account left a COMMENTED review or review comment. Approximation for unresolved threads (REST API does not expose resolution status). */
  readonly hasBotComment: boolean;
  /** Never empty: a pull request with no relation to the account is not kept. */
  readonly relations: readonly PullRequestRelation[];
  readonly labels: readonly string[];
}

/** A tracked pull request plus everything needed to resume its read cursors. */
export interface PersistedPullRequest extends TrackedPullRequest {
  /**
   * False until the first secondary read has adopted the pull request's
   * current reviews and comments. Adoption advances the cursors without
   * reporting pre-existing conversation as new activity.
   */
  readonly adopted: boolean;
  readonly reviewCursor: number;
  /** Cursor over issue comments; review comments use a separate id sequence. */
  readonly commentCursor: number;
  readonly reviewCommentCursor: number;
}

export interface PersistedNotification extends GithubNotification {
  readonly read: boolean;
}

export interface PrRadarStore {
  readSettings(): Promise<PrRadarSettings>;
  writeSettings(settings: PrRadarSettings): Promise<void>;
  listTracked(): Promise<readonly PersistedPullRequest[]>;
  upsertTracked(pullRequest: PersistedPullRequest): Promise<void>;
  /** Drop a pull request and every notification that referenced it. */
  deleteTracked(id: string): Promise<void>;
  /** Insert only unseen notifications; returns how many were new. */
  recordNotifications(items: readonly GithubNotification[]): Promise<number>;
  listNotifications(): Promise<readonly PersistedNotification[]>;
  countUnread(): Promise<number>;
  markAllRead(): Promise<void>;
  setCursors(
    id: string,
    cursors: {
      readonly review: number;
      readonly comment: number;
      readonly reviewComment: number;
    },
  ): Promise<void>;
  /**
   * Repositories whose existing open pull requests have already been adopted
   * silently. The first successful poll of a repository must not report every
   * pre-existing pull request as newly opened.
   */
  listBaselinedRepositories(): Promise<ReadonlySet<string>>;
  markRepositoryBaselined(repository: string): Promise<void>;
  listOpenPullRequests(): Promise<readonly OpenPullRequestSummary[]>;
  /** Replace one repository's open pull requests with the latest read. */
  replaceOpenPullRequests(
    repository: string,
    items: readonly OpenPullRequestSummary[],
  ): Promise<void>;
  /** Drop the open pull requests of repositories that are no longer tracked. */
  retainOpenPullRequests(repositories: readonly string[]): Promise<void>;
  clear(): Promise<void>;
}

// ====...==== untrusted-value decoding ====...====

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asText = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const asCount = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;

const asTextList = (value: unknown): readonly string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];

/** Read the `items` array of one stored document. */
const asItems = (value: MiniAppJsonValue | null): readonly unknown[] => {
  const record = asRecord(value);
  const items = record ? record.items : null;
  return Array.isArray(items) ? items : [];
};

const decodeTracked = (
  value: MiniAppJsonValue | null,
): PersistedPullRequest[] => {
  const tracked: PersistedPullRequest[] = [];
  for (const entry of asItems(value)) {
    const record = asRecord(entry);
    if (!record) continue;
    const id = asText(record.id);
    const repository = asText(record.repository);
    const number =
      typeof record.number === "number" &&
      Number.isInteger(record.number) &&
      record.number > 0
        ? record.number
        : null;
    if (!id || !repository || number === null) continue;
    tracked.push({
      id,
      repository,
      number,
      title: asText(record.title) ?? `#${number}`,
      url: asText(record.url) ?? "",
      headSha: asText(record.headSha) ?? "",
      updatedAt: asText(record.updatedAt) ?? "",
      conflict:
        record.conflict === "conflicted"
          ? "conflicted"
          : record.conflict === "clean"
            ? "clean"
            : "unknown",
      requestedReviewers: asTextList(record.requestedReviewers),
      adopted: record.adopted === true,
      reviewCursor: asCount(record.reviewCursor),
      commentCursor: asCount(record.commentCursor),
      reviewCommentCursor: asCount(record.reviewCommentCursor),
    });
  }
  return tracked;
};

const encodeTracked = (
  items: readonly PersistedPullRequest[],
): MiniAppJsonValue => ({
  version: DOCUMENT_VERSION,
  items: items.map((item) => ({
    id: item.id,
    repository: item.repository,
    number: item.number,
    title: item.title,
    url: item.url,
    headSha: item.headSha,
    updatedAt: item.updatedAt,
    conflict: item.conflict,
    requestedReviewers: [...item.requestedReviewers],
    adopted: item.adopted,
    reviewCursor: item.reviewCursor,
    commentCursor: item.commentCursor,
    reviewCommentCursor: item.reviewCommentCursor,
  })),
});

const decodeNotifications = (
  value: MiniAppJsonValue | null,
): PersistedNotification[] => {
  const notifications: PersistedNotification[] = [];
  for (const entry of asItems(value)) {
    const record = asRecord(entry);
    if (!record) continue;
    const eventId = asText(record.eventId);
    const kind = asText(record.kind);
    const occurredAt = asText(record.occurredAt);
    if (!eventId || !occurredAt || !isStoredKind(kind)) continue;
    const number =
      typeof record.number === "number" && Number.isInteger(record.number)
        ? record.number
        : 0;
    notifications.push({
      eventId,
      pullRequestId: asText(record.pullRequestId) ?? "",
      repository: asText(record.repository) ?? "",
      number,
      title: asText(record.title) ?? `#${number}`,
      url: asText(record.url) ?? "",
      kind,
      occurredAt,
      actor: asText(record.actor),
      summary: asText(record.summary),
      read: record.read === true,
    });
  }
  return notifications;
};

const isStoredKind = (value: string | null): value is GithubNotification["kind"] =>
  value === "opened" ||
  value === "conflict" ||
  value === "approved" ||
  value === "changes-requested" ||
  value === "commented" ||
  value === "review-requested";

const encodeNotifications = (
  items: readonly PersistedNotification[],
): MiniAppJsonValue => ({
  version: DOCUMENT_VERSION,
  items: items.map((item) => ({
    eventId: item.eventId,
    pullRequestId: item.pullRequestId,
    repository: item.repository,
    number: item.number,
    title: item.title,
    url: item.url,
    kind: item.kind,
    occurredAt: item.occurredAt,
    actor: item.actor,
    summary: item.summary,
    read: item.read,
  })),
});

const decodeRepositories = (value: MiniAppJsonValue | null): string[] => {
  const record = asRecord(value);
  if (!record) return [];
  return asTextList(record.baselined).filter((entry) => entry.includes("/"));
};

const encodeRepositories = (items: readonly string[]): MiniAppJsonValue => ({
  version: DOCUMENT_VERSION,
  baselined: [...items],
});

const decodeOpenPulls = (
  value: MiniAppJsonValue | null,
): OpenPullRequestSummary[] => {
  const decoded: OpenPullRequestSummary[] = [];
  for (const item of asItems(value)) {
    const record = asRecord(item);
    if (!record) continue;
    const repository = asText(record.repository);
    const number = asCount(record.number);
    const title = typeof record.title === "string" ? record.title : null;
    const url = asText(record.url);
    const updatedAt = asText(record.updatedAt);
    const relations = Array.isArray(record.relations)
      ? PULL_REQUEST_RELATIONS.filter((relation) =>
          (record.relations as unknown[]).some(
            (entry) => isPullRequestRelation(entry) && entry === relation,
          ),
        )
      : [];
    if (!repository || number === 0 || title === null || !url || !updatedAt) continue;
    if (relations.length === 0) continue;
    decoded.push({
      repository,
      number,
      title,
      url,
      author: asText(record.author),
      draft: record.draft === true,
      createdAt: asText(record.createdAt) ?? updatedAt,
      updatedAt,
      headSha: asText(record.headSha) ?? "",
      ciStatus:
        record.ciStatus === "success" ||
        record.ciStatus === "failure" ||
        record.ciStatus === "pending"
          ? record.ciStatus
          : "unknown",
      reviewDecision:
        record.reviewDecision === "approved" ||
        record.reviewDecision === "changes-requested" ||
        record.reviewDecision === "pending"
          ? record.reviewDecision
          : record.approved === true
            ? "approved"
            : "pending",
      conflict:
        record.conflict === "conflicted"
          ? "conflicted"
          : record.conflict === "clean"
            ? "clean"
            : "unknown",
      inMergeQueue: record.inMergeQueue === true,
      hasBotComment: record.hasBotComment === true,
      relations,
      labels: Array.isArray(record.labels)
        ? (record.labels as unknown[]).filter((l): l is string => typeof l === "string")
        : [],
    });
  }
  return decoded;
};

const encodeOpenPulls = (
  items: readonly OpenPullRequestSummary[],
): MiniAppJsonValue => ({
  version: DOCUMENT_VERSION,
  items: items.map((item) => ({ ...item, relations: [...item.relations], labels: [...item.labels] })),
});

const decodeSettings = (
  value: MiniAppJsonValue | null,
): PrRadarSettings =>
  value === null ? DEFAULT_SETTINGS : normalizeSettings(value);

const encodeSettings = (settings: PrRadarSettings): MiniAppJsonValue => ({
  version: settings.version,
  repositories: [...settings.repositories],
  kinds: [...settings.kinds],
  pollIntervalSeconds: settings.pollIntervalSeconds,
  auth: settings.auth ? { ...settings.auth } : null,
});

// ====...==== host storage adapters ====...====

const address = (key: string): { namespace: string; key: string } => ({
  namespace: STORAGE_NAMESPACE,
  key,
});

const readDocument = async <T>(
  storage: MiniAppStorageApi,
  key: string,
  decode: (value: MiniAppJsonValue | null) => T,
): Promise<T> => decode((await storage.get(address(key))).value);

/**
 * Apply one read-modify-write against the host's optimistic revision, retrying
 * only when the revision moved under us because another realm wrote first.
 */
const mutateDocument = async <T>(
  storage: MiniAppStorageApi,
  key: string,
  decode: (value: MiniAppJsonValue | null) => T,
  encode: (value: T) => MiniAppJsonValue,
  mutate: (current: T) => T | null,
): Promise<T> => {
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    const before = await storage.get(address(key));
    const current = decode(before.value);
    const next = mutate(current);
    if (next === null) return current;
    try {
      await storage.set({
        ...address(key),
        expectedRevision: before.revision,
        value: encode(next),
      });
      return next;
    } catch (error) {
      const after = await storage.get(address(key));
      if (after.revision === before.revision) throw error;
    }
  }
  throw new Error(`PR Radar could not persist ${key}.`);
};

/** Build the store over the host's namespaced JSON storage. */
export const createStoragePrRadarStore = (
  storage: MiniAppStorageApi,
): PrRadarStore => {
  const readTracked = () =>
    readDocument(storage, TRACKED_KEY, decodeTracked);
  const readNotifications = () =>
    readDocument(storage, NOTIFICATIONS_KEY, decodeNotifications);
  const readRepositories = () =>
    readDocument(storage, REPOSITORIES_KEY, decodeRepositories);

  const mutateTracked = (mutate: (current: PersistedPullRequest[]) => PersistedPullRequest[] | null) =>
    mutateDocument(storage, TRACKED_KEY, decodeTracked, encodeTracked, mutate);

  return {
    readSettings: () => readDocument(storage, SETTINGS_KEY, decodeSettings),

    async writeSettings(settings) {
      // A settings write replaces the whole document, so the mutator ignores
      // the value it reads and returns the caller's settings.
      await mutateDocument(
        storage,
        SETTINGS_KEY,
        decodeSettings,
        encodeSettings,
        () => settings,
      );
    },

    listTracked: readTracked,

    async upsertTracked(pullRequest) {
      await mutateTracked((current) => [
        ...current.filter((entry) => entry.id !== pullRequest.id),
        pullRequest,
      ]);
    },

    async deleteTracked(id) {
      // Notifications are pruned first: a failed follow-up write leaves no
      // notification that points at a pull request this app no longer tracks.
      await mutateDocument(
        storage,
        NOTIFICATIONS_KEY,
        decodeNotifications,
        encodeNotifications,
        (current) => {
          const kept = current.filter((entry) => entry.pullRequestId !== id);
          return kept.length === current.length ? null : kept;
        },
      );
      await mutateTracked((current) => {
        const kept = current.filter((entry) => entry.id !== id);
        return kept.length === current.length ? null : kept;
      });
    },

    async recordNotifications(items) {
      let inserted = 0;
      await mutateDocument(
        storage,
        NOTIFICATIONS_KEY,
        decodeNotifications,
        encodeNotifications,
        (current) => {
          const seen = new Set(current.map((entry) => entry.eventId));
          const fresh: PersistedNotification[] = [];
          for (const item of items) {
            if (seen.has(item.eventId)) continue;
            seen.add(item.eventId);
            fresh.push({ ...item, read: false });
          }
          inserted = fresh.length;
          if (fresh.length === 0) return null;
          return [...fresh, ...current]
            .sort((left, right) =>
              right.occurredAt.localeCompare(left.occurredAt),
            )
            .slice(0, MAX_NOTIFICATIONS);
        },
      );
      return inserted;
    },

    listNotifications: readNotifications,

    async countUnread() {
      const notifications = await readNotifications();
      return notifications.filter((entry) => !entry.read).length;
    },

    async markAllRead() {
      await mutateDocument(
        storage,
        NOTIFICATIONS_KEY,
        decodeNotifications,
        encodeNotifications,
        (current) =>
          current.some((entry) => !entry.read)
            ? current.map((entry) => ({ ...entry, read: true }))
            : null,
      );
    },

    async setCursors(id, cursors) {
      await mutateTracked((current) => {
        const index = current.findIndex((entry) => entry.id === id);
        if (index < 0) return null;
        const next = [...current];
        next[index] = {
          ...next[index],
          adopted: true,
          reviewCursor: Math.max(next[index].reviewCursor, cursors.review),
          commentCursor: Math.max(next[index].commentCursor, cursors.comment),
          reviewCommentCursor: Math.max(
            next[index].reviewCommentCursor,
            cursors.reviewComment,
          ),
        };
        return next;
      });
    },

    async listBaselinedRepositories() {
      return new Set(await readRepositories());
    },

    async markRepositoryBaselined(repository) {
      await mutateDocument(
        storage,
        REPOSITORIES_KEY,
        decodeRepositories,
        encodeRepositories,
        (current) =>
          current.includes(repository) ? null : [...current, repository],
      );
    },

    listOpenPullRequests: () =>
      readDocument(storage, OPEN_PULLS_KEY, decodeOpenPulls),

    async replaceOpenPullRequests(repository, items) {
      const latest = items
        .filter((item) => item.repository === repository)
        .slice(0, MAX_OPEN_PULLS_PER_REPOSITORY);
      await mutateDocument(
        storage,
        OPEN_PULLS_KEY,
        decodeOpenPulls,
        encodeOpenPulls,
        (current) => [
          ...current.filter((entry) => entry.repository !== repository),
          ...latest,
        ],
      );
    },

    async retainOpenPullRequests(repositories) {
      const kept = new Set(repositories);
      await mutateDocument(
        storage,
        OPEN_PULLS_KEY,
        decodeOpenPulls,
        encodeOpenPulls,
        (current) => {
          const next = current.filter((entry) => kept.has(entry.repository));
          return next.length === current.length ? null : next;
        },
      );
    },

    async clear() {
      await mutateDocument(
        storage,
        OPEN_PULLS_KEY,
        decodeOpenPulls,
        encodeOpenPulls,
        () => [],
      );
      await mutateDocument(
        storage,
        TRACKED_KEY,
        decodeTracked,
        encodeTracked,
        () => [],
      );
      await mutateDocument(
        storage,
        NOTIFICATIONS_KEY,
        decodeNotifications,
        encodeNotifications,
        () => [],
      );
      await mutateDocument(
        storage,
        REPOSITORIES_KEY,
        decodeRepositories,
        encodeRepositories,
        () => [],
      );
      await mutateDocument(
        storage,
        SETTINGS_KEY,
        decodeSettings,
        encodeSettings,
        () => DEFAULT_SETTINGS,
      );
    },
  };
};

/**
 * Open this package's durable store.
 *
 * Returns null when the host does not provide namespaced storage, so the
 * surface can explain the gap instead of failing during a mount.
 */
export const openPrRadarStore = (): PrRadarStore | null => {
  const storage = sdk.storage;
  return storage ? createStoragePrRadarStore(storage) : null;
};
