/**
 * The GitHub activity this miniapp can turn into in-app notifications.
 *
 * The set is closed and user-selectable. Terminal pull-request states are
 * deliberately absent: a merged or closed pull request is pruned rather than
 * notified, so the tracked set can never accumulate finished work.
 */
export const NOTIFICATION_KINDS = [
  "opened",
  "conflict",
  "approved",
  "changes-requested",
  "commented",
  "review-requested",
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** Kinds selected for a newly configured installation. */
export const DEFAULT_NOTIFICATION_KINDS: readonly NotificationKind[] = [
  "opened",
  "conflict",
  "approved",
  "commented",
];

const KIND_LABELS: Readonly<Record<NotificationKind, string>> = {
  opened: "Pull request opened",
  conflict: "Merge conflict",
  approved: "Approved",
  "changes-requested": "Changes requested",
  commented: "New comment",
  "review-requested": "Review requested",
};

export const notificationKindLabel = (kind: NotificationKind): string =>
  KIND_LABELS[kind];

export const isNotificationKind = (value: unknown): value is NotificationKind =>
  typeof value === "string" &&
  (NOTIFICATION_KINDS as readonly string[]).includes(value);

/** One notification row, as persisted and rendered. */
export interface GithubNotification {
  /** Stable de-duplication identity, for example `review:4123`. */
  readonly eventId: string;
  /** Owner-qualified pull request identity, `owner/repo#12`. */
  readonly pullRequestId: string;
  readonly repository: string;
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly kind: NotificationKind;
  /** ISO-8601 instant the activity happened. */
  readonly occurredAt: string;
  /** GitHub login that caused the activity, when GitHub reports one. */
  readonly actor: string | null;
  /** Bounded one-line excerpt, already truncated by the caller. */
  readonly summary: string | null;
}

/** Mergeability as far as one poll can prove it. */
export type ConflictState = "unknown" | "clean" | "conflicted";

/** One open pull request authored by the connected account. */
export interface TrackedPullRequest {
  /** `owner/repo#12`, stable across polls. */
  readonly id: string;
  readonly repository: string;
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly headSha: string;
  /** GitHub `updated_at`; drives which secondary reads are worth issuing. */
  readonly updatedAt: string;
  readonly conflict: ConflictState;
  readonly requestedReviewers: readonly string[];
}

/** Truncate untrusted provider text to a bounded single line. */
export const boundSummary = (value: unknown, limit = 160): string | null => {
  if (typeof value !== "string") return null;
  const flattened = value.replace(/\s+/gu, " ").trim();
  if (!flattened) return null;
  return flattened.length > limit ? `${flattened.slice(0, limit - 1)}…` : flattened;
};
