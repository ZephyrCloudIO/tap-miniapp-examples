/**
 * Two layers of evidence for the GitHub Notifications surface.
 *
 * The polling rules are exercised directly against a scripted GitHub fake and a
 * fake host storage, because the interesting behaviour is the diff between two
 * reads rather than the rendered pixels. The surface layer then proves that the
 * real mounted TAP surface renders its shell, its controls, and its exact
 * provenance.
 */
import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import type {
  MiniAppJsonValue,
  MiniAppStorageApi,
} from "@theaiplatform/miniapp-sdk/sdk";
import { createGithubClient } from "../../src/github/client";
import { failureMessage, pollGithub } from "../../src/github/poller";
import { normalizeSettings } from "../../src/github/settings";
import {
  createStoragePrRadarStore,
  type PrRadarStore,
} from "../../src/github/store";
import {
  GithubNotConnectedError,
  GithubTransportUnavailableError,
  type GithubHttpHeader,
  type GithubHttpResponse,
  type GithubTransport,
} from "../../src/github/transport";

const PACKAGE_ID = "github-notify";
const SURFACE_ID = "github-notify-dashboard";
const REPOSITORY = "zephyrcloudio/tap-miniapps";

// ====...==== host fakes ====...====

/** Revision-checked in-memory stand-in for the host's namespaced JSON storage. */
const createFakeStorage = (): MiniAppStorageApi => {
  const entries = new Map<
    string,
    { value: MiniAppJsonValue; revision: number }
  >();
  const address = (options: { namespace: string; key: string }): string =>
    `${options.namespace}/${options.key}`;
  let revision = 0;
  return {
    get(options) {
      const entry = entries.get(address(options));
      return entry
        ? { value: entry.value, revision: entry.revision }
        : { value: null, revision: null };
    },
    set(options) {
      const entry = entries.get(address(options));
      if ((entry?.revision ?? null) !== options.expectedRevision) {
        throw new Error("stale_state");
      }
      revision += 1;
      entries.set(address(options), { value: options.value, revision });
      return { revision };
    },
    delete(options) {
      const entry = entries.get(address(options));
      if ((entry?.revision ?? null) !== options.expectedRevision) {
        throw new Error("stale_state");
      }
      entries.delete(address(options));
    },
  };
};

interface ReviewFixture {
  readonly id: number;
  readonly state: string;
  readonly login: string;
  readonly submittedAt: string;
  readonly body: string | null;
}

interface CommentFixture {
  readonly id: number;
  readonly login: string;
  readonly createdAt: string;
  readonly body: string | null;
}

interface World {
  login: string;
  pulls: {
    number: number;
    title: string;
    author?: string;
    state?: string;
    mergeable?: boolean | null;
    headSha?: string;
    updatedAt: string;
    createdAt?: string;
    requestedReviewers?: readonly string[];
    assignees?: readonly string[];
    /** The account reviewed it (search `reviewed-by`). */
    reviewedByViewer?: boolean;
    /** The account commented on or was mentioned in it (search `involves`). */
    involvesViewer?: boolean;
  }[];
  reviews: Record<number, readonly ReviewFixture[]>;
  issueComments: Record<number, readonly CommentFixture[]>;
  reviewComments: Record<number, readonly CommentFixture[]>;
}

const createWorld = (login = "sveta"): World => ({
  login,
  pulls: [],
  reviews: {},
  issueComments: {},
  reviewComments: {},
});

const header = (name: string, value: string): GithubHttpHeader => ({
  name,
  value,
});

const json = (
  body: unknown,
  status = 200,
  headers: readonly GithubHttpHeader[] = [],
): GithubHttpResponse => ({
  status,
  headers,
  bodyText: JSON.stringify(body),
});

const reviewBody = (reviews: readonly ReviewFixture[]): unknown[] =>
  reviews.map((review) => ({
    id: review.id,
    state: review.state,
    submitted_at: review.submittedAt,
    body: review.body,
    user: { login: review.login },
  }));

const commentBody = (comments: readonly CommentFixture[]): unknown[] =>
  comments.map((comment) => ({
    id: comment.id,
    created_at: comment.createdAt,
    body: comment.body,
    user: { login: comment.login },
  }));

const transportFor = (world: World): GithubTransport => ({
  async request(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === "/user") return json({ login: world.login });

    if (path === "/search/issues") {
      const q = url.searchParams.get("q") ?? "";
      const open = world.pulls.filter((pull) => (pull.state ?? "open") === "open");
      const hits = q.includes(`reviewed-by:${world.login}`)
        ? open.filter((pull) => pull.reviewedByViewer)
        : q.includes(`commenter:${world.login}`)
          ? open.filter(
              (pull) =>
                pull.involvesViewer ||
                (pull.author ?? world.login) === world.login ||
                (pull.assignees ?? []).includes(world.login),
            )
          : [];
      return json({
        total_count: hits.length,
        items: hits.map((pull) => ({
          number: pull.number,
          repository_url: `https://api.github.com/repos/${REPOSITORY}`,
          pull_request: { url: `https://api.github.com/repos/${REPOSITORY}/pulls/${pull.number}` },
        })),
      });
    }

    const detail = /^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)$/u.exec(path);
    if (detail) {
      const number = Number.parseInt(detail[3], 10);
      const pull = world.pulls.find((entry) => entry.number === number);
      if (!pull) return json({ message: "Not Found" }, 404);
      return json({
        number: pull.number,
        title: pull.title,
        html_url: `https://github.com/${REPOSITORY}/pull/${pull.number}`,
        state: pull.state ?? "open",
        draft: false,
        mergeable: pull.mergeable ?? null,
        updated_at: pull.updatedAt,
        head: { sha: pull.headSha ?? `sha-${pull.number}` },
        requested_reviewers: (pull.requestedReviewers ?? []).map((login) => ({
          login,
        })),
      });
    }

    const list = /^\/repos\/([^/]+)\/([^/]+)\/pulls$/u.exec(path);
    if (list) {
      return json(
        world.pulls
          .filter((pull) => (pull.state ?? "open") === "open")
          .map((pull) => ({
            number: pull.number,
            title: pull.title,
            html_url: `https://github.com/${REPOSITORY}/pull/${pull.number}`,
            draft: false,
            created_at: pull.createdAt ?? pull.updatedAt,
            updated_at: pull.updatedAt,
            head: { sha: pull.headSha ?? `sha-${pull.number}` },
            user: { login: pull.author ?? world.login },
            requested_reviewers: (pull.requestedReviewers ?? []).map((login) => ({ login })),
            assignees: (pull.assignees ?? []).map((login) => ({ login })),
          })),
      );
    }

    const reviews = /^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)\/reviews$/u.exec(
      path,
    );
    if (reviews) {
      return json(reviewBody(world.reviews[Number(reviews[3])] ?? []));
    }

    const issueComments =
      /^\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)\/comments$/u.exec(path);
    if (issueComments) {
      return json(commentBody(world.issueComments[Number(issueComments[3])] ?? []));
    }

    const reviewComments =
      /^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)\/comments$/u.exec(path);
    if (reviewComments) {
      return json(commentBody(world.reviewComments[Number(reviewComments[3])] ?? []));
    }

    throw new Error(`Unexpected GitHub read ${path}.`);
  },
});

const createHarness = (world: World) => {
  const store: PrRadarStore = createStoragePrRadarStore(
    createFakeStorage(),
  );
  const client = createGithubClient(transportFor(world));
  return {
    store,
    world,
    poll: () => pollGithub({ store, client }),
    track: async () => {
      await store.writeSettings({
        version: 1,
        repositories: [REPOSITORY],
        kinds: [
          "opened",
          "conflict",
          "approved",
          "changes-requested",
          "commented",
          "review-requested",
        ],
        pollIntervalSeconds: 60,
        auth: { mode: "tap" },
      });
    },
  };
};

test("adopts the pull requests that are already open without reporting them", async () => {
  const harness = createHarness(createWorld());
  harness.world.pulls.push({ number: 1, title: "Existing work", updatedAt: "2026-09-01T10:00:00Z" });
  await harness.track();

  const outcome = await harness.poll();

  expect(outcome.ok).toBe(true);
  expect(outcome.inserted).toBe(0);
  expect(outcome.unread).toBe(0);
  expect(await harness.store.listTracked()).toHaveLength(1);
  expect([...(await harness.store.listBaselinedRepositories())]).toEqual([
    REPOSITORY,
  ]);
});

test("reports a pull request opened after the repository baseline", async () => {
  const harness = createHarness(createWorld());
  harness.world.pulls.push({ number: 1, title: "Existing work", updatedAt: "2026-09-01T10:00:00Z" });
  await harness.track();
  await harness.poll();

  harness.world.pulls.push({
    number: 2,
    title: "Fresh work",
    updatedAt: "2026-09-02T10:00:00Z",
    createdAt: "2026-09-02T09:00:00Z",
  });
  const outcome = await harness.poll();

  expect(outcome.inserted).toBe(1);
  expect(outcome.unread).toBe(1);
  const [notification] = await harness.store.listNotifications();
  expect(notification.kind).toBe("opened");
  expect(notification.number).toBe(2);
  expect(notification.eventId).toBe(`opened:${REPOSITORY}#2`);
});

test("reports a conflict only for an explicit mergeable false", async () => {
  const harness = createHarness(createWorld());
  harness.world.pulls.push({
    number: 1,
    title: "Conflicting work",
    updatedAt: "2026-09-01T10:00:00Z",
  });
  await harness.track();
  await harness.poll();

  // GitHub computes mergeability asynchronously: null is not a conflict.
  harness.world.pulls[0].updatedAt = "2026-09-02T10:00:00Z";
  harness.world.pulls[0].mergeable = null;
  expect((await harness.poll()).inserted).toBe(0);

  harness.world.pulls[0].updatedAt = "2026-09-03T10:00:00Z";
  harness.world.pulls[0].mergeable = false;
  const outcome = await harness.poll();

  expect(outcome.inserted).toBe(1);
  const [notification] = await harness.store.listNotifications();
  expect(notification.kind).toBe("conflict");
  expect(notification.eventId).toBe("conflict:sha-1");
});

test("reports reviews and comments from other people once", async () => {
  const harness = createHarness(createWorld());
  harness.world.pulls.push({
    number: 1,
    title: "Reviewable work",
    updatedAt: "2026-09-01T10:00:00Z",
    mergeable: true,
  });
  await harness.track();
  await harness.poll();

  harness.world.pulls[0].updatedAt = "2026-09-02T10:00:00Z";
  harness.world.reviews[1] = [
    { id: 11, state: "APPROVED", login: "teammate", submittedAt: "2026-09-02T10:00:00Z", body: "Looks good" },
    { id: 12, state: "CHANGES_REQUESTED", login: "reviewer", submittedAt: "2026-09-02T10:01:00Z", body: "Please adjust" },
    { id: 13, state: "APPROVED", login: "sveta", submittedAt: "2026-09-02T10:02:00Z", body: "Self" },
  ];
  harness.world.issueComments[1] = [
    { id: 21, login: "teammate", createdAt: "2026-09-02T10:03:00Z", body: "A thought" },
    { id: 22, login: "sveta", createdAt: "2026-09-02T10:04:00Z", body: "My own reply" },
  ];
  harness.world.reviewComments[1] = [
    { id: 31, login: "reviewer", createdAt: "2026-09-02T10:05:00Z", body: "Inline note" },
  ];

  const first = await harness.poll();
  expect(first.inserted).toBe(4);
  expect(
    (await harness.store.listNotifications()).map((entry) => entry.kind).sort(),
  ).toEqual(["approved", "changes-requested", "commented", "commented"]);

  // A second pass over unchanged data must not duplicate anything.
  expect((await harness.poll()).inserted).toBe(0);
});

test("drops a merged pull request and the notifications that referenced it", async () => {
  const harness = createHarness(createWorld());
  harness.world.pulls.push({
    number: 1,
    title: "Soon merged",
    updatedAt: "2026-09-01T10:00:00Z",
    mergeable: true,
  });
  await harness.track();
  await harness.poll();
  harness.world.pulls[0].updatedAt = "2026-09-02T10:00:00Z";
  harness.world.reviews[1] = [
    { id: 11, state: "APPROVED", login: "teammate", submittedAt: "2026-09-02T10:00:00Z", body: null },
  ];
  await harness.poll();
  expect(await harness.store.countUnread()).toBe(1);

  harness.world.pulls = [];
  const outcome = await harness.poll();

  expect(outcome.ok).toBe(true);
  expect(await harness.store.listTracked()).toHaveLength(0);
  expect(await harness.store.listNotifications()).toHaveLength(0);
  expect(await harness.store.countUnread()).toBe(0);
});

test("keeps tracking only the pull requests authored by the connected account", async () => {
  const harness = createHarness(createWorld());
  harness.world.pulls.push({
    number: 7,
    title: "Someone else's work",
    author: "teammate",
    updatedAt: "2026-09-01T10:00:00Z",
  });
  await harness.track();

  await harness.poll();

  expect(await harness.store.listTracked()).toHaveLength(0);
});

test("lists only the open pull requests that involve the account", async () => {
  const harness = createHarness(createWorld());
  harness.world.pulls.push(
    { number: 1, title: "My work", updatedAt: "2026-09-06T10:00:00Z" },
    { number: 2, title: "Asked to review", author: "teammate", requestedReviewers: ["sveta"], updatedAt: "2026-09-05T10:00:00Z" },
    { number: 3, title: "Assigned to me", author: "teammate", assignees: ["sveta"], updatedAt: "2026-09-04T10:00:00Z" },
    { number: 4, title: "Reviewed earlier", author: "teammate", reviewedByViewer: true, involvesViewer: true, updatedAt: "2026-09-03T10:00:00Z" },
    { number: 5, title: "Commented on", author: "teammate", involvesViewer: true, updatedAt: "2026-09-02T10:00:00Z" },
    { number: 6, title: "Unrelated", author: "teammate", updatedAt: "2026-09-01T10:00:00Z" },
  );
  await harness.track();
  await harness.poll();

  const open = await harness.store.listOpenPullRequests();
  expect(
    open
      .map((pull) => [pull.number, pull.relations] as const)
      .sort((left, right) => left[0] - right[0]),
  ).toEqual([
    [1, ["author"]],
    [2, ["review-requested"]],
    [3, ["assigned"]],
    [4, ["reviewed"]],
    [5, ["involved"]],
  ]);

  harness.world.pulls[1].state = "closed";
  await harness.poll();

  expect(
    (await harness.store.listOpenPullRequests()).map((pull) => pull.number).sort(),
  ).toEqual([1, 3, 4, 5]);
});

test("forgets the open pull requests of a repository that is no longer tracked", async () => {
  const harness = createHarness(createWorld());
  harness.world.pulls.push({ number: 1, title: "My work", updatedAt: "2026-09-01T10:00:00Z" });
  await harness.track();
  await harness.poll();
  expect(await harness.store.listOpenPullRequests()).toHaveLength(1);

  const settings = await harness.store.readSettings();
  await harness.store.writeSettings({ ...settings, repositories: [] });
  await harness.poll();

  expect(await harness.store.listOpenPullRequests()).toHaveLength(0);
});

test("persists the GitHub access approval", async () => {
  const harness = createHarness(createWorld());
  await harness.track();

  expect((await harness.store.readSettings()).auth).toEqual({ mode: "tap" });
});

test("marks everything read and reports unread counts", async () => {
  const harness = createHarness(createWorld());
  harness.world.pulls.push({ number: 1, title: "Existing work", updatedAt: "2026-09-01T10:00:00Z" });
  await harness.track();
  await harness.poll();
  harness.world.pulls.push({
    number: 2,
    title: "Fresh work",
    updatedAt: "2026-09-02T10:00:00Z",
    createdAt: "2026-09-02T09:00:00Z",
  });

  expect((await harness.poll()).unread).toBe(1);
  await harness.store.markAllRead();

  expect(await harness.store.countUnread()).toBe(0);
  expect((await harness.store.listNotifications())[0].read).toBe(true);
});

test("reports a rate limit with the reset instant", async () => {
  const store = createStoragePrRadarStore(createFakeStorage());
  await store.writeSettings({
    version: 1,
    repositories: [REPOSITORY],
    kinds: ["opened"],
    pollIntervalSeconds: 60,
    auth: { mode: "tap" },
  });
  const resetAt = Math.floor(Date.now() / 1_000) + 600;
  const outcome = await pollGithub({
    store,
    client: createGithubClient({
      async request() {
        return json({ message: "API rate limit exceeded" }, 403, [
          header("x-ratelimit-remaining", "0"),
          header("x-ratelimit-reset", String(resetAt)),
        ]);
      },
    }),
  });

  expect(outcome.ok).toBe(false);
  expect(outcome.failure).toBe("rate-limited");
  expect(outcome.retryAt?.getTime()).toBe(resetAt * 1_000);
});

test("reports a host without host-mediated GitHub requests", async () => {
  const store = createStoragePrRadarStore(createFakeStorage());
  const outcome = await pollGithub({
    store,
    client: createGithubClient({
      async request() {
        throw new GithubTransportUnavailableError("no host HTTP");
      },
    }),
  });

  expect(outcome.ok).toBe(false);
  expect(outcome.failure).toBe("host-unsupported");
});

test("reports a missing TAP GitHub connection instead of an unexpected failure", async () => {
  const store = createStoragePrRadarStore(createFakeStorage());
  const outcome = await pollGithub({
    store,
    client: createGithubClient({
      async request() {
        throw new GithubNotConnectedError();
      },
    }),
  });

  expect(outcome.ok).toBe(false);
  expect(outcome.failure).toBe("no-connection");
  expect(failureMessage("no-connection")).toMatch(/Personal integrations → GitHub/u);
});

test("clamps stored settings instead of trusting an older release", () => {
  expect(
    normalizeSettings({
      version: 1,
      repositories: ["https://github.com/zephyrcloudio/tap-miniapps.git", "nonsense", "a/b"],
      kinds: ["not-a-kind", "conflict"],
      pollIntervalSeconds: 5,
    }),
  ).toEqual({
    version: 1,
    repositories: ["zephyrcloudio/tap-miniapps", "a/b"],
    kinds: ["conflict"],
    pollIntervalSeconds: 30,
    auth: null,
  });
});

test("keeps only a valid stored GitHub access approval", () => {
  const authOf = (auth: unknown) => normalizeSettings({ auth }).auth;

  expect(authOf(undefined)).toBeNull();
  expect(authOf({ mode: "tap" })).toEqual({ mode: "tap" });
  expect(
    authOf({ mode: "credential", credentialId: "cred_1", displayName: " GitHub read " }),
  ).toEqual({ mode: "credential", credentialId: "cred_1", displayName: "GitHub read" });
  expect(authOf({ mode: "credential", credentialId: "cred_1" })).toEqual({
    mode: "credential",
    credentialId: "cred_1",
    displayName: "cred_1",
  });
  expect(authOf({ mode: "credential", credentialId: "platform-session" })).toBeNull();
  expect(authOf({ mode: "credential", credentialId: "" })).toBeNull();
  expect(authOf({ mode: "admin" })).toBeNull();
});

test("blocks every feature until GitHub access is set up", async ({ surface }) => {
  await expect(surface.getByTestId("pr-radar-access-choices")).toBeVisible();
  await expect(surface.getByTestId("pr-radar-use-tap")).toBeVisible();
  await expect(surface.getByTestId("pr-radar-credential-select")).toBeAttached();
  await expect(surface.getByTestId("pr-radar-revoke-access")).toBeHidden();
  await expect(surface.getByTestId("pr-radar-tracking")).toBeHidden();
  await expect(surface.getByTestId("pr-radar-pulls")).toBeHidden();
  await expect(surface.getByTestId("pr-radar-picker")).toBeHidden();
  await expect(surface.getByTestId("pr-radar-actions")).toBeHidden();
  await expect(surface.getByTestId("pr-radar-browse")).toBeDisabled();
});

// ====...==== mounted surface ====...====

test("renders the GitHub Notifications surface shell", async ({ surface }) => {
  const shell = surface.getByTestId("pr-radar-shell");

  await expect(shell).toBeVisible();
  await expect(shell).toHaveAttribute("data-surface-target", "desktop");
  await expect(surface.getByTestId("pr-radar-access")).toBeVisible();
  await expect(surface.getByTestId("pr-radar-repository-input")).toBeAttached();
  await expect(surface.getByTestId("pr-radar-add-repository")).toBeAttached();
  await expect(surface.getByTestId("pr-radar-status")).toHaveText(/\S/u);
});

test("uses the exact TAP surface provenance and default permission scenario", async ({ tap }) => {
  expect(tap.packageId).toBe(PACKAGE_ID);
  expect(tap.surfaceId).toBe(SURFACE_ID);
  expect(tap.mode).toBe("surface");
  expect(tap.permissionScenario).toBe("default");
});

test("remounts the surface through the bounded host reset", async ({ surface, tap }) => {
  await expect(surface.getByTestId("pr-radar-shell")).toBeVisible();

  await tap.control.reset();

  await expect(surface.getByTestId("pr-radar-shell")).toBeVisible();
  await expect(surface.getByTestId("pr-radar-access-choices")).toBeVisible();
});
