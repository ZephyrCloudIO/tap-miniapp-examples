/**
 * One polling pass over the tracked repositories.
 *
 * The pass is deliberately a plain function over a store and a client: it holds
 * no timers and touches no host API, so the conflict, review, and pruning rules
 * are exercised directly by tests.
 *
 * Cost control is the point of the design. A repository is listed once per pass
 * with a single paginated `pulls?state=open` read, which shares GitHub's large
 * core budget instead of the 30-requests-per-minute search budget. Reviews and
 * comments are read only for pull requests whose `updated_at` moved, and only
 * for a bounded number of pull requests per pass.
 *
 * Adoption separates "already true when tracking started" from "happened since".
 * The first pass over a repository records where each of its open pull requests
 * already stands and reports none of it; a pull request opened afterwards is
 * reported together with whatever it already carries, because that activity
 * happened while this surface was not looking.
 */
import type { GithubClient, OpenPullRequest, PullRequestReview } from "./client";
import { GithubReadError, type GithubReadFailure } from "./client";
import type { GithubNotification, NotificationKind } from "./events";
import { boundSummary } from "./events";
import type { PrRadarSettings } from "./settings";
import type {
  PrRadarStore,
  OpenPullRequestSummary,
  PersistedPullRequest,
  PullRequestRelation,
} from "./store";
import {
  GithubAuthRequiredError,
  GithubNotConnectedError,
  GithubTransportUnavailableError,
} from "./transport";

/** Detail reads one pass may issue before deferring the rest to the next pass. */
export const DEFAULT_MAX_DETAIL_READS = 12;
/** Bounded write: a burst of activity is recorded over more than one pass. */
const MAX_NOTIFICATIONS_PER_PASS = 50;

export interface PollOutcome {
  readonly ok: boolean;
  readonly inserted: number;
  readonly unread: number;
  readonly failure: GithubReadFailure | null;
  readonly message: string | null;
  readonly retryAt: Date | null;
}

export interface GithubPollerOptions {
  readonly store: PrRadarStore;
  readonly client: GithubClient;
  readonly maxDetailReads?: number;
}

/** Operator-facing explanation for each class of read failure. */
export const failureMessage = (failure: GithubReadFailure): string => {
  switch (failure) {
    case "host-unsupported":
      return "This host does not provide host-mediated GitHub requests.";
    case "no-connection":
      return "TAP is not connected to GitHub. Connect GitHub in TAP Settings → Connections → Personal integrations → GitHub, then retry.";
    case "not-connected":
      return "GitHub rejected the selected access. Reconnect GitHub in TAP or choose another token, then retry.";
    case "rate-limited":
      return "GitHub rate-limited this account. Polling resumes after the reset.";
    case "not-found":
      return "GitHub refused a tracked repository. Check the repository list.";
    default:
      return "An unexpected GitHub read failure occurred.";
  }
};

const failureOf = (error: unknown): GithubReadFailure => {
  if (error instanceof GithubReadError) return error.failure;
  if (error instanceof GithubTransportUnavailableError) return "host-unsupported";
  if (error instanceof GithubAuthRequiredError) return "not-connected";
  if (error instanceof GithubNotConnectedError) return "no-connection";
  return "unexpected";
};

const pullRequestId = (repository: string, number: number): string =>
  `${repository}#${number}`;

/** Search returns GitHub's canonical casing, which a typed repository may not match. */
const searchKey = (repository: string, number: number): string =>
  `${repository.toLowerCase()}#${number}`;

/**
 * Persist an open pull request from the list read alone.
 *
 * `adopted` decides whether the next detail read reports what it finds.
 */
const adoptOpenPullRequest = (
  repository: string,
  pull: OpenPullRequest,
  adopted: boolean,
): PersistedPullRequest => ({
  id: pullRequestId(repository, pull.number),
  repository,
  number: pull.number,
  title: pull.title,
  url: pull.url,
  headSha: pull.headSha,
  updatedAt: pull.updatedAt,
  conflict: "unknown",
  requestedReviewers: [],
  adopted,
  reviewCursor: 0,
  commentCursor: 0,
  reviewCommentCursor: 0,
});

const notification = (input: {
  readonly eventId: string;
  readonly kind: NotificationKind;
  readonly repository: string;
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly occurredAt: string;
  readonly actor: string | null;
  readonly summary: string | null;
}): GithubNotification => ({
  eventId: input.eventId,
  pullRequestId: pullRequestId(input.repository, input.number),
  repository: input.repository,
  number: input.number,
  title: input.title,
  url: input.url,
  kind: input.kind,
  occurredAt: input.occurredAt,
  actor: input.actor,
  summary: input.summary,
});

const wants = (
  settings: PrRadarSettings,
  kind: NotificationKind,
): boolean => settings.kinds.includes(kind);

const maximumId = (ids: readonly number[], floor: number): number =>
  ids.reduce((highest, id) => Math.max(highest, id), floor);

const isBotLogin = (login: string | null): boolean =>
  login !== null && login.endsWith("[bot]");

const getReviewDecision = (
  reviews: readonly PullRequestReview[],
  headSha: string,
): "approved" | "changes-requested" | "pending" => {
  const latestDecision = new Map<string, PullRequestReview>();
  for (const review of reviews) {
    if (!review.login) continue;
    if (
      review.state === "APPROVED" ||
      review.state === "CHANGES_REQUESTED" ||
      review.state === "DISMISSED"
    ) {
      latestDecision.set(review.login.toLowerCase(), review);
    }
  }
  const decisions = [...latestDecision.values()];
  if (decisions.some((r) => r.state === "CHANGES_REQUESTED")) return "changes-requested";
  if (decisions.some((r) => r.state === "APPROVED" && r.commitId === headSha)) return "approved";
  return "pending";
};

/**
 * Run one pass. A failure is reported in the outcome rather than thrown, so a
 * transient GitHub or host failure never tears down the surface that is showing
 * the last good notification feed.
 */
export const pollGithub = async (
  options: GithubPollerOptions,
): Promise<PollOutcome> => {
  const { store, client } = options;
  const maxDetailReads = options.maxDetailReads ?? DEFAULT_MAX_DETAIL_READS;
  try {
    const settings = await store.readSettings();
    const viewer = await client.getViewer();
    const baselined = await store.listBaselinedRepositories();
    const tracked = new Map(
      (await store.listTracked()).map((entry) => [entry.id, entry]),
    );
    const previousOpenPulls = new Map(
      (await store.listOpenPullRequests()).map((entry) => [
        pullRequestId(entry.repository, entry.number),
        entry,
      ]),
    );
    const notifications: GithubNotification[] = [];
    let detailReads = 0;
    let statusReads = 0;
    let mergeabilityReads = 0;
    let botCommentReads = 0;

    await store.retainOpenPullRequests(settings.repositories);

    // Reviews and comments are invisible to the list read, so two bounded
    // searches find the pull requests the account reviewed or took part in.
    const [commented, reviewed] =
      settings.repositories.length === 0
        ? [[], []]
        : await Promise.all([
            client.searchOpenPullRequests("commenter", viewer.login, settings.repositories),
            client.searchOpenPullRequests("reviewed-by", viewer.login, settings.repositories),
          ]);
    const commentedIds = new Set(commented.map((hit) => searchKey(hit.repository, hit.number)));
    const reviewedIds = new Set(reviewed.map((hit) => searchKey(hit.repository, hit.number)));
    const isViewer = (login: string | null): boolean =>
      login !== null && login.toLowerCase() === viewer.login.toLowerCase();

    for (const repository of settings.repositories) {
      const allOpenPulls = await client.listOpenPullRequests(repository);
      const mergeQueueNumbers = await client.listMergeQueue(repository);
      const mine: OpenPullRequestSummary[] = [];
      for (const pull of allOpenPulls) {
        const key = searchKey(repository, pull.number);
        const relations: PullRequestRelation[] = [];
        if (isViewer(pull.author)) relations.push("author");
        if (pull.requestedReviewers.some(isViewer)) relations.push("review-requested");
        if (pull.assignees.some(isViewer)) relations.push("assigned");
        if (reviewedIds.has(key)) relations.push("reviewed");
        if (relations.length === 0 && commentedIds.has(key)) relations.push("involved");
        if (relations.length === 0) continue;
        const id = pullRequestId(repository, pull.number);
        const previous = previousOpenPulls.get(id);
        const prChanged =
          !previous ||
          previous.headSha !== pull.headSha ||
          previous.updatedAt !== pull.updatedAt;

        // Decide which reads to issue this pass within the per-poll budget.
        let conflict = pull.conflict;
        let ciStatus =
          previous?.headSha === pull.headSha ? (previous?.ciStatus ?? "unknown") : "unknown";
        let reviewDecision = previous?.reviewDecision ?? "pending";
        let hasBotComment = previous?.hasBotComment ?? false;

        const fetchConflict = conflict === "unknown" && mergeabilityReads < maxDetailReads;
        const fetchCI = statusReads < maxDetailReads;
        const fetchBotComments = !hasBotComment && botCommentReads < maxDetailReads;
        if (fetchConflict) mergeabilityReads += 1;
        if (fetchCI) statusReads += 1;
        if (fetchBotComments) botCommentReads += 1;

        // All independent reads run in parallel — four sequential awaits collapse
        // to one, cutting per-PR latency from ~3 round trips to ~1.
        const [conflictResult, ciResult, reviewsResult, botResult] = await Promise.allSettled([
          fetchConflict
            ? client.getPullRequest(repository, pull.number).then((d) => d.conflict)
            : Promise.resolve(conflict),
          fetchCI
            ? client.getCommitChecks(repository, pull.headSha)
            : Promise.resolve(ciStatus),
          prChanged
            ? client.listReviews(repository, pull.number)
            : Promise.resolve(null as readonly PullRequestReview[] | null),
          fetchBotComments
            ? Promise.all([
                client.listReviewComments(repository, pull.number),
                client.listIssueComments(repository, pull.number),
              ])
            : Promise.resolve(null),
        ]);

        if (conflictResult.status === "fulfilled") conflict = conflictResult.value;
        if (ciResult.status === "fulfilled") ciStatus = ciResult.value;

        const reviews = reviewsResult.status === "fulfilled" ? reviewsResult.value : null;
        if (reviews !== null) {
          reviewDecision = getReviewDecision(reviews, pull.headSha);
          hasBotComment = reviews.some((r) => r.state === "COMMENTED" && isBotLogin(r.login));
        }

        if (!hasBotComment && botResult.status === "fulfilled" && botResult.value !== null) {
          const [reviewComments, issueComments] = botResult.value;
          hasBotComment =
            reviewComments.some((c) => isBotLogin(c.login)) ||
            issueComments.some((c) => isBotLogin(c.login));
        }
        mine.push({
          repository,
          number: pull.number,
          title: pull.title,
          url: pull.url,
          author: pull.author,
          draft: pull.draft,
          createdAt: pull.createdAt,
          updatedAt: pull.updatedAt,
          headSha: pull.headSha,
          ciStatus,
          reviewDecision,
          conflict,
          inMergeQueue: pull.inMergeQueue || mergeQueueNumbers.has(pull.number),
          hasBotComment,
          relations,
          labels: pull.labels,
        });
      }
      await store.replaceOpenPullRequests(repository, mine);
      // Notifications stay scoped to the connected account's own pull requests.
      const openPulls = allOpenPulls.filter((pull) => pull.author === viewer.login);
      const openIds = new Set(
        openPulls.map((pull) => pullRequestId(repository, pull.number)),
      );
      const baselining = !baselined.has(repository);
      if (baselining) await store.markRepositoryBaselined(repository);

      // A merged or closed pull request is absent from the open list, so it
      // stops being tracked and every notification that referenced it is
      // dropped with it.
      for (const entry of [...tracked.values()]) {
        if (entry.repository !== repository || openIds.has(entry.id)) continue;
        tracked.delete(entry.id);
        await store.deleteTracked(entry.id);
      }

      for (const pull of openPulls) {
        const id = pullRequestId(repository, pull.number);
        let known = tracked.get(id);

        if (!known && !baselining && wants(settings, "opened")) {
          notifications.push(
            notification({
              eventId: `opened:${id}`,
              kind: "opened",
              repository,
              number: pull.number,
              title: pull.title,
              url: pull.url,
              occurredAt: pull.createdAt,
              actor: viewer.login,
              summary: null,
            }),
          );
        }
        if (!known) {
          known = adoptOpenPullRequest(repository, pull, !baselining);
          tracked.set(id, known);
          await store.upsertTracked(known);
        }

        const changed =
          known.updatedAt !== pull.updatedAt || known.conflict === "unknown";
        if (!changed) continue;
        // Deferred work stays eligible: the next pass sees the same difference.
        if (detailReads >= maxDetailReads) continue;
        detailReads += 1;

        const detail = await client.getPullRequest(repository, pull.number);
        if (detail.state !== "open") {
          tracked.delete(id);
          await store.deleteTracked(id);
          continue;
        }

        const [reviews, issueComments, reviewComments] = await Promise.all([
          client.listReviews(repository, pull.number),
          client.listIssueComments(repository, pull.number),
          client.listReviewComments(repository, pull.number),
        ]);

        const next: PersistedPullRequest = {
          ...known,
          title: detail.title,
          url: detail.url,
          headSha: detail.headSha,
          updatedAt: detail.updatedAt,
          conflict: detail.conflict,
          requestedReviewers: detail.requestedReviewers,
          adopted: true,
          reviewCursor: maximumId(
            reviews.map((review) => review.id),
            known.reviewCursor,
          ),
          commentCursor: maximumId(
            issueComments.map((comment) => comment.id),
            known.commentCursor,
          ),
          reviewCommentCursor: maximumId(
            reviewComments.map((comment) => comment.id),
            known.reviewCommentCursor,
          ),
        };

        if (!known.adopted) {
          // Adoption pass: record where this pull request already stands
          // without reporting any of it as a new event.
          tracked.set(id, next);
          await store.upsertTracked(next);
          continue;
        }

        if (
          detail.conflict === "conflicted" &&
          known.conflict !== "conflicted" &&
          wants(settings, "conflict")
        ) {
          notifications.push(
            notification({
              eventId: `conflict:${detail.headSha}`,
              kind: "conflict",
              repository,
              number: detail.number,
              title: detail.title,
              url: detail.url,
              occurredAt: detail.updatedAt,
              actor: null,
              summary: `Pull request ${id} no longer merges cleanly.`,
            }),
          );
        }

        if (wants(settings, "review-requested")) {
          for (const reviewer of detail.requestedReviewers) {
            if (known.requestedReviewers.includes(reviewer)) continue;
            notifications.push(
              notification({
                eventId: `review-requested:${reviewer}:${detail.updatedAt}`,
                kind: "review-requested",
                repository,
                number: detail.number,
                title: detail.title,
                url: detail.url,
                occurredAt: detail.updatedAt,
                actor: reviewer,
                summary: `${reviewer} was asked to review this pull request.`,
              }),
            );
          }
        }

        for (const review of reviews) {
          if (review.id <= known.reviewCursor) continue;
          if (!review.login || review.login === viewer.login) continue;
          const kind =
            review.state === "APPROVED"
              ? "approved"
              : review.state === "CHANGES_REQUESTED"
                ? "changes-requested"
                : null;
          if (!kind || !wants(settings, kind)) continue;
          notifications.push(
            notification({
              eventId: `review:${review.id}`,
              kind,
              repository,
              number: detail.number,
              title: detail.title,
              url: detail.url,
              occurredAt: review.submittedAt ?? detail.updatedAt,
              actor: review.login,
              summary: review.body ?? boundSummary(detail.title),
            }),
          );
        }

        if (wants(settings, "commented")) {
          const sources = [
            {
              prefix: "comment",
              cursor: known.commentCursor,
              items: issueComments,
            },
            {
              prefix: "review-comment",
              cursor: known.reviewCommentCursor,
              items: reviewComments,
            },
          ] as const;
          for (const source of sources) {
            for (const comment of source.items) {
              if (comment.id <= source.cursor) continue;
              if (!comment.login || comment.login === viewer.login) continue;
              notifications.push(
                notification({
                  eventId: `${source.prefix}:${comment.id}`,
                  kind: "commented",
                  repository,
                  number: detail.number,
                  title: detail.title,
                  url: detail.url,
                  occurredAt: comment.createdAt,
                  actor: comment.login,
                  summary: comment.body,
                }),
              );
            }
          }
        }

        tracked.set(id, next);
        await store.upsertTracked(next);
      }
    }

    const inserted = await store.recordNotifications(
      notifications.slice(0, MAX_NOTIFICATIONS_PER_PASS),
    );
    return {
      ok: true,
      inserted,
      unread: await store.countUnread(),
      failure: null,
      message: null,
      retryAt: null,
    };
  } catch (error) {
    let unread = 0;
    try {
      unread = await store.countUnread();
    } catch {
      unread = 0;
    }
    return {
      ok: false,
      inserted: 0,
      unread,
      failure: failureOf(error),
      message: error instanceof Error ? error.message : null,
      retryAt: error instanceof GithubReadError ? error.retryAt : null,
    };
  }
};
