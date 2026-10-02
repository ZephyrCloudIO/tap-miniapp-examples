/**
 * Read-only GitHub REST reads.
 *
 * Every request is a GET against `https://api.github.com`, the only origin the
 * manifest declares. Pull requests are discovered by listing the tracked
 * repository's open pull requests rather than by the search API, because
 * search is limited to 30 requests per minute while ordinary REST reads share
 * the much larger core budget. Secondary reads (reviews, comments) are issued
 * only for pull requests whose `updated_at` moved, and are further bounded by
 * an id cursor. The search API is used only for the few pull requests the
 * account reviewed or commented on, which the list read cannot reveal: two
 * bounded queries per pass, scoped to the tracked repositories.
 */
import {
  boundSummary,
  type ConflictState,
  type TrackedPullRequest,
} from "./events";
import type { GithubTransport } from "./transport";

export const GITHUB_API_ORIGIN = "https://api.github.com";

const GITHUB_API_VERSION = "2022-11-28";
const PAGE_SIZE = 100;
const MAX_PAGES = 5;
const MAX_SEARCH_PAGES = 2;

export type GithubReadFailure =
  | "host-unsupported"
  | "no-connection"
  | "not-connected"
  | "rate-limited"
  | "not-found"
  | "unexpected";

export class GithubReadError extends Error {
  readonly failure: GithubReadFailure;
  readonly status: number | null;
  readonly retryAt: Date | null;

  constructor(
    failure: GithubReadFailure,
    message: string,
    options: { status?: number | null; retryAt?: Date | null } = {},
  ) {
    super(message);
    this.name = "GithubReadError";
    this.failure = failure;
    this.status = options.status ?? null;
    this.retryAt = options.retryAt ?? null;
  }
}

export interface RepositorySummary {
  readonly fullName: string;
  readonly private: boolean;
  readonly archived: boolean;
  readonly pushedAt: string | null;
}

export interface ViewerIdentity {
  readonly login: string;
}

/** One open pull request, from any author. */
export interface OpenPullRequest {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly author: string | null;
  readonly requestedReviewers: readonly string[];
  readonly assignees: readonly string[];
  readonly headSha: string;
  readonly updatedAt: string;
  readonly createdAt: string;
  readonly draft: boolean;
  readonly conflict: ConflictState;
  /** True when auto-merge is enabled or the PR has been added to the merge queue. */
  readonly inMergeQueue: boolean;
  readonly labels: readonly string[];
}

export interface PullRequestDetail {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly headSha: string;
  readonly updatedAt: string;
  readonly state: string;
  readonly draft: boolean;
  readonly conflict: ConflictState;
  readonly requestedReviewers: readonly string[];
}

export interface PullRequestReview {
  readonly id: number;
  readonly state: string;
  readonly login: string | null;
  readonly submittedAt: string | null;
  readonly body: string | null;
  readonly commitId: string | null;
}

export type CommitChecksState = "success" | "failure" | "pending" | "unknown";

export interface PullRequestComment {
  readonly id: number;
  readonly login: string | null;
  readonly createdAt: string;
  readonly body: string | null;
}

/** One open pull request returned by the search API: enough to match the list read. */
export interface SearchedPullRequest {
  readonly repository: string;
  readonly number: number;
}

export type PullRequestSearch = "commenter" | "reviewed-by";

export interface GithubClient {
  getViewer(): Promise<ViewerIdentity>;
  listViewerRepositories(): Promise<readonly RepositorySummary[]>;
  getRepository(repository: string): Promise<RepositorySummary>;
  /** Every open pull request, most recently updated first; merged and closed ones are excluded. */
  listOpenPullRequests(repository: string): Promise<readonly OpenPullRequest[]>;
  /**
   * Open pull requests in these repositories that match one `login` qualifier.
   * `commenter` finds pull requests where the account actually commented,
   * without treating a mention in generated release notes as involvement.
   */
  searchOpenPullRequests(
    search: PullRequestSearch,
    login: string,
    repositories: readonly string[],
  ): Promise<readonly SearchedPullRequest[]>;
  getPullRequest(repository: string, number: number): Promise<PullRequestDetail>;
  listReviews(repository: string, number: number): Promise<readonly PullRequestReview[]>;
  getCommitChecks(repository: string, ref: string): Promise<CommitChecksState>;
  /** Returns the set of PR numbers currently in the repository's merge queue. */
  listMergeQueue(repository: string): Promise<ReadonlySet<number>>;
  listIssueComments(
    repository: string,
    number: number,
  ): Promise<readonly PullRequestComment[]>;
  listReviewComments(
    repository: string,
    number: number,
  ): Promise<readonly PullRequestComment[]>;
}

export const splitRepository = (
  repository: string,
): { owner: string; name: string } => {
  const [owner, name, ...rest] = repository.split("/");
  if (!owner || !name || rest.length > 0) {
    throw new GithubReadError(
      "unexpected",
      `${repository} is not an owner/repository pair.`,
    );
  }
  return { owner, name };
};

const headerValue = (
  headers: readonly { name: string; value: string }[],
  name: string,
): string | null => {
  const target = name.toLowerCase();
  for (const header of headers) {
    if (header.name.toLowerCase() === target) return header.value;
  }
  return null;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asArray = (value: unknown): readonly unknown[] =>
  Array.isArray(value) ? value : [];

const asString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const asNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/**
 * GitHub computes mergeability asynchronously, so `mergeable` is null on the
 * first read of a pull request that has just changed. Only an explicit
 * `false` is a conflict; an unknown result must not be reported as one.
 */
export const conflictFromMergeable = (
  value: unknown,
  mergeableState?: unknown,
): ConflictState => {
  if (value === true) return "clean";
  if (value === false) return "conflicted";
  if (mergeableState === "dirty") return "conflicted";
  if (mergeableState === "clean" || mergeableState === "unstable") return "clean";
  return "unknown";
};

const loginsOf = (value: unknown): string[] => {
  const logins: string[] = [];
  for (const candidate of asArray(value)) {
    const user = asRecord(candidate);
    const login = user ? asString(user.login) : null;
    if (login) logins.push(login);
  }
  return logins;
};

/** `https://api.github.com/repos/owner/name` -> `owner/name`. */
const repositoryFromApiUrl = (value: unknown): string | null => {
  const url = asString(value);
  const prefix = `${GITHUB_API_ORIGIN}/repos/`;
  if (!url || !url.startsWith(prefix)) return null;
  const repository = url.slice(prefix.length);
  return repository.split("/").length === 2 ? repository : null;
};

const readRetryAt = (
  headers: readonly { name: string; value: string }[],
): Date | null => {
  const retryAfter = headerValue(headers, "retry-after");
  if (retryAfter) {
    const seconds = Number.parseInt(retryAfter, 10);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return new Date(Date.now() + seconds * 1_000);
    }
  }
  const reset = headerValue(headers, "x-ratelimit-reset");
  if (reset) {
    const epochSeconds = Number.parseInt(reset, 10);
    if (Number.isFinite(epochSeconds) && epochSeconds > 0) {
      return new Date(epochSeconds * 1_000);
    }
  }
  return null;
};

const classifyFailure = (
  status: number,
  headers: readonly { name: string; value: string }[],
): GithubReadFailure => {
  if (status === 401) return "not-connected";
  if (status === 404) return "not-found";
  if (status === 403 || status === 429) {
    const remaining = headerValue(headers, "x-ratelimit-remaining");
    return remaining === "0" ? "rate-limited" : "not-connected";
  }
  return "unexpected";
};

const buildUrl = (
  path: string,
  query: Readonly<Record<string, string | number>> = {},
): string => {
  const url = new URL(path, GITHUB_API_ORIGIN);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, String(value));
  }
  return url.toString();
};

export const createGithubClient = (transport: GithubTransport): GithubClient => {
  const read = async (
    path: string,
    query: Readonly<Record<string, string | number>> = {},
  ): Promise<unknown> => {
    const response = await transport.request({
      method: "GET",
      url: buildUrl(path, query),
      headers: [
        { name: "Accept", value: "application/vnd.github+json" },
        { name: "X-GitHub-Api-Version", value: GITHUB_API_VERSION },
      ],
      timeoutMs: 20_000,
      responseBodyLimitBytes: 4 * 1024 * 1024,
      followRedirects: false,
    });
    if (response.status < 200 || response.status >= 300) {
      const failure = classifyFailure(response.status, response.headers);
      throw new GithubReadError(
        failure,
        `GitHub read ${path} failed with status ${response.status}.`,
        { status: response.status, retryAt: readRetryAt(response.headers) },
      );
    }
    const text = response.bodyText ?? "";
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new GithubReadError(
        "unexpected",
        `GitHub read ${path} did not return JSON.`,
      );
    }
  };

  const readPages = async (
    path: string,
    makeQuery: (page: number) => Readonly<Record<string, string | number>>,
  ): Promise<readonly unknown[]> => {
    const collected: unknown[] = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const payload = await read(path, makeQuery(page));
      const items = asArray(payload);
      collected.push(...items);
      if (items.length < PAGE_SIZE) break;
    }
    return collected;
  };

  return {
    async getViewer() {
      const payload = asRecord(await read("/user"));
      const login = payload ? asString(payload.login) : null;
      if (!login) {
        throw new GithubReadError(
          "not-connected",
          "GitHub did not report the connected account login.",
        );
      }
      return { login };
    },

    async listViewerRepositories() {
      const items = await readPages("/user/repos", (page) => ({
        per_page: PAGE_SIZE,
        page,
        sort: "updated",
        direction: "desc",
      }));
      const repositories: RepositorySummary[] = [];
      for (const item of items) {
        const record = asRecord(item);
        const fullName = record ? asString(record.full_name) : null;
        if (!fullName) continue;
        repositories.push({
          fullName,
          private: record?.private === true,
          archived: record?.archived === true,
          pushedAt: record ? asString(record.pushed_at) : null,
        });
      }
      return repositories;
    },

    async getRepository(repository) {
      const { owner, name } = splitRepository(repository);
      const payload = asRecord(await read(`/repos/${owner}/${name}`));
      const fullName = payload ? asString(payload.full_name) : null;
      if (!payload || !fullName) {
        throw new GithubReadError(
          "not-found",
          `GitHub did not return metadata for ${repository}.`,
        );
      }
      return {
        fullName,
        private: payload.private === true,
        archived: payload.archived === true,
        pushedAt: asString(payload.pushed_at),
      };
    },

    async listOpenPullRequests(repository) {
      const { owner, name } = splitRepository(repository);
      const items = await readPages(`/repos/${owner}/${name}/pulls`, (page) => ({
        state: "open",
        sort: "updated",
        direction: "desc",
        per_page: PAGE_SIZE,
        page,
      }));
      const pullRequests: OpenPullRequest[] = [];
      for (const item of items) {
        const record = asRecord(item);
        if (!record) continue;
        const user = asRecord(record.user);
        const number = asNumber(record.number);
        const head = asRecord(record.head);
        const headSha = head ? asString(head.sha) : null;
        const url = asString(record.html_url);
        const title = asString(record.title);
        const updatedAt = asString(record.updated_at);
        if (number === null || !headSha || !url || title === null || !updatedAt) {
          continue;
        }
        pullRequests.push({
          number,
          title,
          url,
          author: user ? asString(user.login) : null,
          requestedReviewers: loginsOf(record.requested_reviewers),
          assignees: loginsOf(record.assignees),
          headSha,
          updatedAt,
          createdAt: asString(record.created_at) ?? updatedAt,
          draft: record.draft === true,
          conflict: conflictFromMergeable(record.mergeable, record.mergeable_state),
          inMergeQueue: record.auto_merge !== null && record.auto_merge !== undefined,
          labels: asArray(record.labels)
            .map((l) => asString(asRecord(l)?.name))
            .filter((n): n is string => n !== null && n.length > 0),
        });
      }
      return pullRequests;
    },

    async searchOpenPullRequests(search, login, repositories) {
      if (repositories.length === 0) return [];
      // Qualifiers do not count toward search's query-length limit, and
      // repeated repo: qualifiers match any of them.
      const q = [
        "is:pr",
        "is:open",
        `${search}:${login}`,
        ...repositories.map((repository) => `repo:${repository}`),
      ].join(" ");
      const found: SearchedPullRequest[] = [];
      for (let page = 1; page <= MAX_SEARCH_PAGES; page += 1) {
        const payload = asRecord(
          await read("/search/issues", { q, per_page: PAGE_SIZE, page }),
        );
        const items = payload ? asArray(payload.items) : [];
        for (const item of items) {
          const record = asRecord(item);
          if (!record || !asRecord(record.pull_request)) continue;
          const repository = repositoryFromApiUrl(record.repository_url);
          const number = asNumber(record.number);
          if (repository && number !== null) found.push({ repository, number });
        }
        if (items.length < PAGE_SIZE) break;
      }
      return found;
    },

    async getPullRequest(repository, number) {
      const { owner, name } = splitRepository(repository);
      const record = asRecord(
        await read(`/repos/${owner}/${name}/pulls/${number}`),
      );
      if (!record) {
        throw new GithubReadError(
          "not-found",
          `GitHub did not return pull request ${repository}#${number}.`,
        );
      }
      const head = asRecord(record.head);
      const reviewers = loginsOf(record.requested_reviewers);
      return {
        number,
        title: asString(record.title) ?? `#${number}`,
        url: asString(record.html_url) ?? "",
        headSha: head ? (asString(head.sha) ?? "") : "",
        updatedAt: asString(record.updated_at) ?? "",
        state: asString(record.state) ?? "unknown",
        draft: record.draft === true,
        conflict: conflictFromMergeable(record.mergeable, record.mergeable_state),
        requestedReviewers: reviewers,
      };
    },

    async getCommitChecks(repository, ref) {
      const { owner, name } = splitRepository(repository);
      const payload = asRecord(
        await read(`/repos/${owner}/${name}/commits/${encodeURIComponent(ref)}/check-runs`, {
          per_page: PAGE_SIZE,
        }),
      );
      const checks = asArray(payload?.check_runs);
      if (checks.length === 0) return "unknown";
      // The endpoint returns all runs including re-runs. Keep only the latest
      // run per check name so a successful re-run supersedes an earlier failure.
      const latest = new Map<string, { id: number; status: unknown; conclusion: unknown }>();
      for (const candidate of checks) {
        const check = asRecord(candidate);
        if (!check) continue;
        const checkName = asString(check.name) ?? "";
        const id = typeof check.id === "number" ? check.id : 0;
        if ((latest.get(checkName)?.id ?? -1) < id) {
          latest.set(checkName, { id, status: check.status, conclusion: check.conclusion });
        }
      }
      let hasFailed = false;
      for (const { status, conclusion } of latest.values()) {
        if (asString(status) !== "completed") return "pending";
        const c = asString(conclusion);
        if (
          c === "failure" ||
          c === "cancelled" ||
          c === "timed_out" ||
          c === "action_required" ||
          c === "startup_failure" ||
          c === "stale"
        ) {
          hasFailed = true;
        }
      }
      return hasFailed ? "failure" : "success";
    },

    async listReviews(repository, number) {
      const { owner, name } = splitRepository(repository);
      const items = await readPages(
        `/repos/${owner}/${name}/pulls/${number}/reviews`,
        (page) => ({
          per_page: PAGE_SIZE,
          page,
          sort: "created",
          direction: "asc",
        }),
      );
      const reviews: PullRequestReview[] = [];
      for (const item of items) {
        const record = asRecord(item);
        if (!record) continue;
        const id = asNumber(record.id);
        const state = asString(record.state);
        if (id === null || !state) continue;
        const user = asRecord(record.user);
        reviews.push({
          id,
          state,
          login: user ? asString(user.login) : null,
          submittedAt: asString(record.submitted_at),
          body: boundSummary(record.body),
          commitId: asString(record.commit_id),
        });
      }
      return reviews;
    },

    async listIssueComments(repository, number) {
      const { owner, name } = splitRepository(repository);
      const items = await readPages(
        `/repos/${owner}/${name}/issues/${number}/comments`,
        (page) => ({
          per_page: PAGE_SIZE,
          page,
          sort: "created",
          direction: "asc",
        }),
      );
      return mapComments(items);
    },

    async listReviewComments(repository, number) {
      const { owner, name } = splitRepository(repository);
      const items = await readPages(
        `/repos/${owner}/${name}/pulls/${number}/comments`,
        (page) => ({
          per_page: PAGE_SIZE,
          page,
          sort: "created",
          direction: "asc",
        }),
      );
      return mapComments(items);
    },

    async listMergeQueue(repository) {
      const { owner, name } = splitRepository(repository);
      const numbers = new Set<number>();

      // Primary: merge queue REST API (requires merge_queues App permission or repo OAuth scope).
      // Return immediately on success so we don't make an unnecessary second call.
      try {
        const response = await read(`/repos/${owner}/${name}/merges/queue`);
        const entries: unknown[] = Array.isArray(response)
          ? response
          : Array.isArray((response as Record<string, unknown>)?.entries)
            ? ((response as Record<string, unknown>).entries as unknown[])
            : [];
        for (const entry of entries) {
          const record = asRecord(entry);
          if (!record) continue;
          const pr = asRecord(record.pull_request);
          if (!pr) continue;
          const num = typeof pr.number === "number" ? pr.number : null;
          if (num !== null) numbers.add(num);
        }
        return numbers;
      } catch {
        // Fall through to ref-based detection.
      }

      // Fallback: the merge queue creates temporary branches named
      // `gh-readonly-queue/{base}/pr-{number}-{sha}`. Listing these refs only
      // needs the standard `contents: read` permission that the transport already has.
      try {
        const refs = asArray(
          await read(`/repos/${owner}/${name}/git/refs/heads/gh-readonly-queue`, {
            per_page: 100,
          }),
        );
        for (const ref of refs) {
          const record = asRecord(ref);
          const refName = record ? asString(record.ref) : null;
          if (!refName) continue;
          const match = refName.match(/\/pr-(\d+)-/);
          if (match) numbers.add(Number(match[1]));
        }
      } catch {
        // No merge queue refs, or transport error — return whatever we have.
      }

      return numbers;
    },
  };
};

const mapComments = (
  items: readonly unknown[],
): readonly PullRequestComment[] => {
  const comments: PullRequestComment[] = [];
  for (const item of items) {
    const record = asRecord(item);
    if (!record) continue;
    const id = asNumber(record.id);
    const createdAt = asString(record.created_at);
    if (id === null || !createdAt) continue;
    const user = asRecord(record.user);
    comments.push({
      id,
      login: user ? asString(user.login) : null,
      createdAt,
      body: boundSummary(record.body),
    });
  }
  return comments;
};

/** Project one detail read into the persisted tracked shape. */
export const toTrackedPullRequest = (
  repository: string,
  detail: PullRequestDetail,
): TrackedPullRequest => ({
  id: `${repository}#${detail.number}`,
  repository,
  number: detail.number,
  title: detail.title,
  url: detail.url,
  headSha: detail.headSha,
  updatedAt: detail.updatedAt,
  conflict: detail.conflict,
  requestedReviewers: detail.requestedReviewers,
});
