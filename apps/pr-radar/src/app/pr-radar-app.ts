/**
 * Surface controller: owns the poll timer and the settings form.
 *
 * The controller never polls on its own schedule while the realm is paused. The
 * lifecycle export stops the timer when TAP hides the surface and starts it
 * again -- with an immediate catch-up pass -- when the surface becomes active.
 */
import { sdk } from "@theaiplatform/miniapp-sdk/sdk";
import {
  createGithubClient,
  GithubReadError,
  type RepositorySummary,
} from "../github/client";
import { failureMessage, pollGithub } from "../github/poller";
import {
  MAX_TRACKED_REPOSITORIES,
  normalizeRepository,
  normalizeSettings,
  type GithubAuthChoice,
  type PrRadarSettings,
} from "../github/settings";
import {
  openPrRadarStore,
  type OpenPullRequestSummary,
  type PullRequestRelation,
} from "../github/store";
import {
  createHostGithubTransport,
  GithubNotConnectedError,
  listGithubTokenCredentials,
  type GithubTokenCredential,
} from "../github/transport";
import type { JsonValue } from "../lifecycle-state";

export interface PrRadarController {
  /** Snapshot the rendered state that a paused realm would otherwise lose. */
  capture(): JsonValue;
  restore(value: JsonValue): void;
  pause(): void;
  resume(): void;
  destroy(): void;
}


/** The saved-token option is unfinished; flip to true to offer it again. */
const TOKEN_ACCESS_ENABLED = false;

const POLL_INTERVAL_CHOICES = [30, 60, 120, 300, 900] as const;
/** Ceiling on a rate-limit backoff, so a bad reset header cannot stall polling. */
const MAX_BACKOFF_MS = 15 * 60 * 1_000;
const MIN_BACKOFF_MS = 30 * 1_000;

const RELATION_LABELS: Record<PullRequestRelation, string> = {
  author: "yours",
  "review-requested": "review requested",
  assigned: "assigned",
  reviewed: "reviewed",
  involved: "commented",
};

const STATE_LABELS: Record<string, string> = {
  conflict: "Merge conflict",
  failed: "CI failed",
  "changes-requested": "Changes requested",
  comment: "Comment",
  queued: "Queued",
  "ci-passed": "CI passed",
  approved: "Approved",
  ready: "Ready to merge",
};
const STATE_ORDER = [
  "conflict",
  "failed",
  "changes-requested",
  "comment",
  "queued",
  "ci-passed",
  "approved",
  "ready",
] as const;

const getPullStates = (pull: OpenPullRequestSummary): string[] => {
  const states: string[] = [];
  if (pull.conflict === "conflicted") states.push("conflict");
  if (pull.ciStatus === "failure") states.push("failed");
  if (pull.reviewDecision === "changes-requested") states.push("changes-requested");
  if (pull.hasBotComment) states.push("comment");
  if (pull.inMergeQueue) states.push("queued");
  const readyToMerge =
    pull.conflict !== "conflicted" &&
    pull.ciStatus === "success" &&
    pull.reviewDecision === "approved";
  if (readyToMerge) {
    states.push("ready");
  } else {
    if (pull.ciStatus === "success") states.push("ci-passed");
    if (pull.reviewDecision === "approved") states.push("approved");
  }
  return states;
};

const TAP_GITHUB_SETTINGS = "TAP Settings → Connections → Personal integrations → GitHub";

/** Why checking TAP's GitHub connection failed, phrased as what to do next. */
const tapAccessFailureMessage = (error: unknown): string => {
  if (error instanceof GithubNotConnectedError) {
    return `TAP isn't connected to GitHub yet. Connect your GitHub account in ${TAP_GITHUB_SETTINGS}, then click Allow again.`;
  }
  if (error instanceof GithubReadError && error.failure === "not-connected") {
    return `GitHub rejected TAP's GitHub connection; the token may be expired or revoked. Reconnect it in ${TAP_GITHUB_SETTINGS}, then click Allow again.`;
  }
  if (error instanceof GithubReadError && error.failure === "rate-limited") {
    return "GitHub rate-limited TAP's GitHub connection. Try again in a few minutes.";
  }
  return error instanceof Error
    ? `TAP's GitHub connection could not be checked: ${error.message}`
    : "TAP's GitHub connection could not be checked.";
};

const intervalLabel = (seconds: number): string =>
  seconds < 60
    ? `${seconds} seconds`
    : seconds === 60
      ? "1 minute"
      : `${seconds / 60} minutes`;

const safeGithubUrl = (value: string): string | null => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com" ? url.href : null;
  } catch {
    return null;
  }
};

const relativeTime = (iso: string, now: number): string => {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return "";
  const elapsedSeconds = Math.max(0, Math.round((now - timestamp) / 1_000));
  if (elapsedSeconds < 60) return "just now";
  const elapsedMinutes = Math.round(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  const elapsedHours = Math.round(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;
  return `${Math.round(elapsedHours / 24)}d ago`;
};

const requireElement = <T extends HTMLElement>(
  root: HTMLElement,
  id: string,
): T => {
  const element = root.querySelector<T>(`#${id}`);
  if (!element) throw new Error(`PR Radar is missing #${id}.`);
  return element;
};

const createElement = <K extends keyof HTMLElementTagNameMap>(
  root: HTMLElement,
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const element = root.ownerDocument.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

export function mountPrRadarApp(
  root: HTMLElement,
): PrRadarController {
  const store = openPrRadarStore();
  let settings: PrRadarSettings | null = null;
  const client = createGithubClient(
    createHostGithubTransport(() => settings?.auth ?? null),
  );
  const tapConnectionProbe = createGithubClient(
    createHostGithubTransport(() => ({ mode: "tap" })),
  );
  const controller = new AbortController();
  const { signal } = controller;

  const elements = {
    accessBtn: requireElement<HTMLButtonElement>(root, "ghn-access-btn"),
    accessModal: requireElement<HTMLDivElement>(root, "ghn-access-modal"),
    modalClose: requireElement<HTMLButtonElement>(root, "ghn-modal-close"),
    accessSummary: requireElement<HTMLParagraphElement>(root, "ghn-access-summary"),
    modalError: requireElement<HTMLParagraphElement>(root, "ghn-modal-error"),
    accessChoices: requireElement<HTMLDivElement>(root, "ghn-access-choices"),
    credentialSelect: requireElement<HTMLSelectElement>(root, "ghn-credential-select"),
    useCredential: requireElement<HTMLButtonElement>(root, "ghn-use-credential"),
    reloadCredentials: requireElement<HTMLButtonElement>(root, "ghn-reload-credentials"),
    useTap: requireElement<HTMLButtonElement>(root, "ghn-use-tap"),
    revokeForm: requireElement<HTMLDivElement>(root, "ghn-revoke-form"),
    revokeAccess: requireElement<HTMLButtonElement>(root, "ghn-revoke-access"),
    tokenOption: requireElement<HTMLDivElement>(root, "ghn-token-option"),
    actions: requireElement<HTMLDivElement>(root, "ghn-actions"),
    tracking: requireElement<HTMLElement>(root, "ghn-tracking"),
    status: requireElement<HTMLParagraphElement>(root, "ghn-status"),
    error: requireElement<HTMLParagraphElement>(root, "ghn-error"),
    refresh: requireElement<HTMLButtonElement>(root, "ghn-refresh"),
    markRead: requireElement<HTMLButtonElement>(root, "ghn-mark-read"),
    form: requireElement<HTMLFormElement>(root, "ghn-repository-form"),
    input: requireElement<HTMLInputElement>(root, "ghn-repository-input"),
    browse: requireElement<HTMLButtonElement>(root, "ghn-browse"),
    repositories: requireElement<HTMLUListElement>(root, "ghn-repositories"),
    trackedCount: requireElement<HTMLSpanElement>(root, "ghn-tracked-count"),
    clearAll: requireElement<HTMLButtonElement>(root, "ghn-clear-all"),
    suggestions: requireElement<HTMLUListElement>(root, "ghn-suggestions"),
    picker: requireElement<HTMLDivElement>(root, "ghn-picker"),
    pickerFilter: requireElement<HTMLInputElement>(root, "ghn-picker-filter"),
    pickerDone: requireElement<HTMLButtonElement>(root, "ghn-picker-done"),
    pickerCount: requireElement<HTMLParagraphElement>(root, "ghn-picker-count"),
    pulls: requireElement<HTMLElement>(root, "ghn-pulls"),
    pullsList: requireElement<HTMLDivElement>(root, "ghn-pulls-list"),
    pullsCount: requireElement<HTMLSpanElement>(root, "ghn-pulls-count"),
    pullsEmpty: requireElement<HTMLParagraphElement>(root, "ghn-pulls-empty"),
    pillFilterBar: requireElement<HTMLDivElement>(root, "ghn-pill-filter-bar"),
    pullSearch: requireElement<HTMLInputElement>(root, "ghn-pull-search"),
    pullRepository: requireElement<HTMLSelectElement>(root, "ghn-pull-repository"),
    pollInterval: requireElement<HTMLSelectElement>(root, "ghn-poll-interval"),
  };

  let openPulls: readonly OpenPullRequestSummary[] = [];
  let viewerRepositories: readonly RepositorySummary[] = [];
  let tokenCredentials: readonly GithubTokenCredential[] = [];
  let tapConnectionStatus: "unknown" | "checking" | "available" | "unavailable" = "unknown";
  let activeStateFilter: string | null = null;
  let running = false;
  let inFlight = false;
  let destroyed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastCheckedAt: number | null = null;
  let cycleGeneration = 0;

  const hostCanRequest = sdk.http !== undefined && sdk.hasHostHttpRequest === true;

  const setError = (message: string | null): void => {
    elements.error.textContent = message;
    elements.error.hidden = message === null;
  };

  const setModalError = (message: string | null): void => {
    elements.modalError.textContent = message;
    elements.modalError.hidden = message === null;
  };

  const openModal = (): void => {
    elements.accessModal.hidden = false;
    elements.accessBtn.setAttribute("aria-expanded", "true");
  };

  const closeModal = (): void => {
    elements.accessModal.hidden = true;
    elements.accessBtn.setAttribute("aria-expanded", "false");
    setModalError(null);
    // Reset so next open always re-probes in case the user connected GitHub in between.
    if (tapConnectionStatus !== "unknown") {
      tapConnectionStatus = "unknown";
      renderAccess();
    }
  };

  const setStatus = (message: string): void => {
    elements.status.textContent = message;
  };

  const describeStatus = (): void => {
    if (!hostCanRequest) {
      setStatus(
        "This host cannot make host-mediated GitHub requests, so polling is unavailable. Repository and event choices are still saved.",
      );
      return;
    }
    if (settings && !settings.auth) {
      setStatus("Choose how PR Radar may access GitHub. Nothing is read until you do.");
      return;
    }
    const tracked = settings?.repositories.length ?? 0;
    if (tracked === 0) {
      setStatus("Add a repository to start tracking your open pull requests.");
      return;
    }
    const checked =
      lastCheckedAt === null
        ? "not checked yet"
        : `checked ${relativeTime(new Date(lastCheckedAt).toISOString(), Date.now())}`;
    setStatus(
      `Tracking ${tracked} ${tracked === 1 ? "repository" : "repositories"} · every ${intervalLabel(
        settings?.pollIntervalSeconds ?? 60,
      )} · ${checked}`,
    );
  };

  if (!store) {
    setStatus(
      "This host does not provide package storage, so PR Radar cannot remember repositories or activity.",
    );
    elements.refresh.disabled = true;
    elements.browse.disabled = true;
    elements.input.disabled = true;
    elements.accessBtn.disabled = true;
    return {
      capture: () => ({}),
      restore: () => {},
      pause: () => {},
      resume: () => {},
      destroy: () => controller.abort(),
    };
  }

  // ====...==== settings rendering ====...====

  const renderRepositories = (): void => {
    const repos = settings?.repositories ?? [];
    elements.trackedCount.textContent = repos.length > 0 ? `(${repos.length})` : "";
    elements.clearAll.hidden = repos.length === 0;
    elements.repositories.replaceChildren();
    for (const repository of repos) {
      const item = createElement(root, "li", "ghn-chip");
      item.dataset.repository = repository;
      item.append(createElement(root, "span", "ghn-chip-name", repository));
      const remove = createElement(root, "button", "", "×");
      remove.type = "button";
      remove.dataset.removeRepository = repository;
      remove.setAttribute("aria-label", `Stop tracking ${repository}`);
      remove.setAttribute("data-testid", "pr-radar-remove-repository");
      item.append(remove);
      elements.repositories.append(item);
    }
  };

  const renderPollInterval = (): void => {
    const current = settings?.pollIntervalSeconds ?? 60;
    elements.pollInterval.replaceChildren();
    const choices = new Set<number>([...POLL_INTERVAL_CHOICES, current]);
    for (const seconds of [...choices].sort((left, right) => left - right)) {
      const option = createElement(root, "option", "", intervalLabel(seconds));
      option.value = String(seconds);
      option.selected = seconds === current;
      elements.pollInterval.append(option);
    }
  };

  const renderCredentialOptions = (): void => {
    elements.credentialSelect.replaceChildren();
    const selectedId =
      settings?.auth?.mode === "credential" ? settings.auth.credentialId : null;
    if (tokenCredentials.length === 0) {
      const placeholder = createElement(
        root,
        "option",
        "",
        sdk.credentials ? "No GitHub tokens saved yet" : "This host cannot list saved tokens",
      );
      placeholder.value = "";
      elements.credentialSelect.append(placeholder);
    }
    for (const credential of tokenCredentials) {
      const option = createElement(root, "option", "", credential.displayName);
      option.value = credential.id;
      option.selected = credential.id === selectedId;
      elements.credentialSelect.append(option);
    }
    elements.credentialSelect.disabled = tokenCredentials.length === 0;
    elements.useCredential.disabled = tokenCredentials.length === 0;
    elements.reloadCredentials.disabled = !sdk.credentials;
  };

  const renderAccess = (): void => {
    const auth = settings?.auth ?? null;
    const connected = auth !== null;

    // Access button (top-right): amber = not connected, green = connected
    elements.accessBtn.textContent = connected ? "GitHub ✓" : "Connect GitHub";
    elements.accessBtn.dataset.connected = String(connected);

    // Modal: show choices when no auth, revoke button when auth is set
    elements.accessChoices.hidden = connected;
    elements.tokenOption.hidden = !TOKEN_ACCESS_ENABLED;
    elements.revokeForm.hidden = !connected;

    // Summary inside modal
    elements.accessSummary.textContent =
      auth === null
        ? TOKEN_ACCESS_ENABLED
          ? "PR Radar has no access to GitHub yet. Choose one option below."
          : "PR Radar has no access to GitHub yet. Allow it below to start."
        : auth.mode === "tap"
          ? "Using TAP's GitHub connection (read requests only)."
          : `Using the GitHub token "${auth.displayName}" (read requests only).`;

    // App body — all locked until auth is set
    elements.actions.hidden = !connected;
    elements.tracking.hidden = !connected;
    elements.pulls.hidden = !connected;
    if (!connected) elements.picker.hidden = true;
    elements.browse.disabled = !connected || !hostCanRequest;
    const tapBlocked = !hostCanRequest || tapConnectionStatus === "checking" || tapConnectionStatus === "unavailable";
    elements.useTap.disabled = tapBlocked;
    if (tapConnectionStatus === "checking") {
      elements.useTap.textContent = "Checking TAP’s GitHub connection…";
    } else {
      elements.useTap.textContent = "Allow TAP’s GitHub connection";
    }
    renderCredentialOptions();
  };

  const loadCredentials = async (): Promise<void> => {
    if (!TOKEN_ACCESS_ENABLED) return;
    try {
      tokenCredentials = (await listGithubTokenCredentials()) ?? [];
    } catch (error) {
      tokenCredentials = [];
      setError(
        error instanceof Error
          ? `Saved tokens could not be listed: ${error.message}`
          : "Saved tokens could not be listed.",
      );
    }
    renderCredentialOptions();
  };

  const probeTapConnection = async (): Promise<void> => {
    if (tapConnectionStatus === "checking") return;
    tapConnectionStatus = "checking";
    setModalError(null);
    renderAccess();
    try {
      await tapConnectionProbe.getViewer();
      tapConnectionStatus = "available";
    } catch (error) {
      if (error instanceof GithubNotConnectedError) {
        tapConnectionStatus = "unavailable";
        setModalError(
          `TAP isn't connected to GitHub yet. Connect your GitHub account in ${TAP_GITHUB_SETTINGS}, then click Allow again.`,
        );
      } else {
        // Rate limit, network error, etc. — let the user try; the on-click probe will explain.
        tapConnectionStatus = "unknown";
      }
    }
    renderAccess();
  };

  const renderPicker = (): void => {
    const tracked = new Set(settings?.repositories ?? []);
    const query = elements.pickerFilter.value.trim().toLowerCase();
    const atLimit = tracked.size >= MAX_TRACKED_REPOSITORIES;
    const visible = viewerRepositories.filter(
      (repository) => !query || repository.fullName.toLowerCase().includes(query),
    );
    elements.suggestions.replaceChildren();
    for (const repository of visible) {
      const item = createElement(root, "li", "");
      const label = createElement(root, "label", "");
      const input = createElement(root, "input", "");
      input.type = "checkbox";
      input.checked = tracked.has(repository.fullName);
      input.disabled = !input.checked && atLimit;
      input.dataset.pickRepository = repository.fullName;
      input.setAttribute("data-testid", "pr-radar-pick-repository");
      label.append(input, createElement(root, "span", "ghn-chip-name", repository.fullName));
      if (repository.private) label.append(createElement(root, "span", "ghn-tag", "private"));
      if (repository.archived) label.append(createElement(root, "span", "ghn-tag", "archived"));
      item.append(label);
      elements.suggestions.append(item);
    }
    elements.pickerCount.textContent =
      viewerRepositories.length === 0
        ? "GitHub returned no repositories for this account."
        : `${tracked.size} of ${MAX_TRACKED_REPOSITORIES} tracked · showing ${visible.length} of ${viewerRepositories.length}${
            atLimit ? " · limit reached" : ""
          }`;
  };

  const renderPull = (pull: OpenPullRequestSummary): HTMLDivElement => {
    const item = createElement(root, "div", "ghn-pull");
    item.setAttribute("data-testid", "pr-radar-pull");
    const repository = pull.repository.split("/").at(-1) ?? pull.repository;
    const repositoryCell = createElement(root, "p", "ghn-pull-repository", repository);
    repositoryCell.append(createElement(root, "span", "", `#${pull.number}`));
    item.append(repositoryCell);

    const main = createElement(root, "div", "ghn-pull-main");
    const title = createElement(root, "p", "ghn-pull-title");
    title.append(createElement(root, "span", "", pull.title));
    if (pull.draft) title.append(createElement(root, "span", "ghn-tag", "draft"));
    main.append(title);
    const updated = relativeTime(pull.updatedAt, Date.now());
    main.append(
      createElement(
        root,
        "p",
        "ghn-pull-meta",
        `${pull.author ?? "unknown author"}${updated ? ` · updated ${updated}` : ""}`,
      ),
    );
    if (pull.labels.length > 0) {
      const labelsRow = createElement(root, "div", "ghn-pull-labels");
      for (const label of pull.labels.slice(0, 6)) {
        labelsRow.append(createElement(root, "span", "ghn-pull-label", label));
      }
      main.append(labelsRow);
    }
    item.append(main);

    const relations = createElement(root, "div", "ghn-pull-relations");
    if (pull.conflict === "conflicted") {
      const status = createElement(root, "span", "ghn-review-state", "Merge conflict");
      status.dataset.state = "conflict";
      relations.append(status);
    }
    if (pull.ciStatus === "failure") {
      const status = createElement(root, "span", "ghn-review-state", "CI failed");
      status.dataset.state = "failed";
      relations.append(status);
    }
    if (pull.reviewDecision === "changes-requested") {
      const status = createElement(root, "span", "ghn-review-state", "Changes requested");
      status.dataset.state = "changes-requested";
      relations.append(status);
    }
    if (pull.hasBotComment) {
      const status = createElement(root, "span", "ghn-review-state", "Comment");
      status.dataset.state = "comment";
      relations.append(status);
    }
    if (pull.inMergeQueue) {
      const status = createElement(root, "span", "ghn-review-state", "Queued");
      status.dataset.state = "queued";
      relations.append(status);
    } else {
      const readyToMerge =
        pull.conflict !== "conflicted" &&
        pull.ciStatus === "success" &&
        pull.reviewDecision === "approved";
      if (readyToMerge) {
        const status = createElement(root, "span", "ghn-review-state", "Ready to merge");
        status.dataset.state = "ready";
        relations.append(status);
      } else {
        if (pull.ciStatus === "success") {
          const status = createElement(root, "span", "ghn-review-state", "CI passed");
          status.dataset.state = "ci-passed";
          relations.append(status);
        }
        if (pull.reviewDecision === "approved") {
          const status = createElement(root, "span", "ghn-review-state", "Approved");
          status.dataset.state = "approved";
          relations.append(status);
        }
      }
    }
    for (const relation of pull.relations) {
      if (relation === "author") continue;
      const tag = createElement(root, "span", "ghn-tag", RELATION_LABELS[relation]);
      tag.dataset.relation = relation;
      relations.append(tag);
    }
    item.append(relations);

    const actions = createElement(root, "div", "ghn-pull-actions");
    const githubUrl = safeGithubUrl(pull.url);
    if (githubUrl) {
      const link = createElement(root, "button", "ghn-pr-link", "↗");
      link.type = "button";
      link.dataset.externalUrl = githubUrl;
      link.title = "Open pull request on GitHub";
      link.setAttribute(
        "aria-label",
        `Open ${pull.repository} pull request ${pull.number} on GitHub`,
      );
      actions.append(link);
    }
    item.append(actions);
    return item;
  };

  const renderPulls = (): void => {
    const repositories = settings?.repositories ?? [];
    const selectedRepository = repositories.includes(elements.pullRepository.value)
      ? elements.pullRepository.value
      : "";
    elements.pullRepository.replaceChildren(
      createElement(root, "option", "", "All repositories"),
    );
    elements.pullRepository.firstElementChild?.setAttribute("value", "");
    for (const repository of repositories) {
      const option = createElement(root, "option", "", repository);
      option.value = repository;
      option.selected = repository === selectedRepository;
      elements.pullRepository.append(option);
    }
    const query = elements.pullSearch.value.trim().toLowerCase();

    // Base filter: search text + repository selection (no state filter yet).
    const basePulls = openPulls.filter(
      (pull) =>
        (!selectedRepository || pull.repository === selectedRepository) &&
        (!query ||
          pull.title.toLowerCase().includes(query) ||
          String(pull.number).includes(query) ||
          (pull.author ?? "").toLowerCase().includes(query)),
    );

    // Build the pill filter bar from states that exist in the base set.
    const presentStates = new Set<string>();
    for (const pull of basePulls) {
      for (const s of getPullStates(pull)) presentStates.add(s);
    }
    // Drop active filter if its state is no longer present.
    if (activeStateFilter !== null && !presentStates.has(activeStateFilter)) {
      activeStateFilter = null;
    }
    elements.pillFilterBar.replaceChildren();
    const filtersToShow = STATE_ORDER.filter((s) => presentStates.has(s));
    elements.pillFilterBar.hidden = filtersToShow.length === 0;
    if (filtersToShow.length > 0) {
      const stateCount = new Map<string, number>();
      for (const pull of basePulls) {
        for (const s of getPullStates(pull)) stateCount.set(s, (stateCount.get(s) ?? 0) + 1);
      }
      const allBtn = createElement(root, "button", "ghn-filter-pill", "All");
      allBtn.dataset.state = "all";
      allBtn.setAttribute("aria-pressed", activeStateFilter === null ? "true" : "false");
      allBtn.append(createElement(root, "span", "ghn-pill-count", String(basePulls.length)));
      allBtn.addEventListener("click", () => { activeStateFilter = null; renderPulls(); });
      elements.pillFilterBar.append(allBtn);
      for (const state of filtersToShow) {
        const btn = createElement(root, "button", "ghn-filter-pill", "");
        btn.dataset.state = state;
        const dot = createElement(root, "span", "ghn-pill-dot", "");
        dot.dataset.state = state;
        btn.append(dot);
        btn.append(root.ownerDocument.createTextNode(STATE_LABELS[state] ?? state));
        btn.append(createElement(root, "span", "ghn-pill-count", String(stateCount.get(state) ?? 0)));
        btn.setAttribute("aria-pressed", activeStateFilter === state ? "true" : "false");
        btn.addEventListener("click", () => {
          activeStateFilter = activeStateFilter === state ? null : state;
          renderPulls();
        });
        elements.pillFilterBar.append(btn);
      }
    }

    elements.pullsList.replaceChildren();
    let total = 0;
    for (const repository of repositories) {
      if (selectedRepository && repository !== selectedRepository) continue;
      const pulls = basePulls
        .filter(
          (pull) =>
            pull.repository === repository &&
            (activeStateFilter === null || getPullStates(pull).includes(activeStateFilter)),
        )
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      if (pulls.length === 0) continue;
      total += pulls.length;
      const group = createElement(root, "div", "ghn-pulls-group");
      group.dataset.repository = repository;
      group.append(createElement(root, "h3", "", `${repository} (${pulls.length})`));
      for (const pull of pulls) group.append(renderPull(pull));
      elements.pullsList.append(group);
    }
    elements.pullsCount.textContent = total > 0 ? `(${total})` : "";
    elements.pullsEmpty.hidden = total > 0;
    elements.pullsEmpty.textContent =
      repositories.length === 0
        ? "Track a repository to see its open pull requests."
        : lastCheckedAt === null
          ? "Loading open pull requests…"
          : "No open pull requests involve you in the tracked repositories.";
  };

  const renderSettings = (): void => {
    renderAccess();
    if (!elements.picker.hidden) renderPicker();
    renderPulls();
    renderRepositories();
    renderPollInterval();
    describeStatus();
  };

  // ====...==== polling ====...====

  const releaseTimer = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const scheduleNext = (delayMs: number, gen: number): void => {
    releaseTimer();
    if (destroyed || !running || gen !== cycleGeneration) return;
    timer = setTimeout(() => {
      timer = null;
      void cycle(gen);
    }, delayMs);
  };

  const currentIntervalMs = (): number =>
    (settings?.pollIntervalSeconds ?? 60) * 1_000;

  const runPoll = async (): Promise<number> => {
    if (
      inFlight ||
      !hostCanRequest ||
      !settings?.auth ||
      settings.repositories.length === 0
    ) {
      return currentIntervalMs();
    }
    inFlight = true;
    setStatus("Checking GitHub…");
    try {
      const outcome = await pollGithub({ store, client });
      openPulls = await store.listOpenPullRequests();
      lastCheckedAt = Date.now();
      setError(
        outcome.ok
          ? null
          : `${failureMessage(outcome.failure ?? "unexpected")}${
              outcome.message ? ` (${outcome.message})` : ""
            }`,
      );
      if (!outcome.ok && outcome.failure === "rate-limited" && outcome.retryAt) {
        return Math.min(
          MAX_BACKOFF_MS,
          Math.max(MIN_BACKOFF_MS, outcome.retryAt.getTime() - Date.now()),
        );
      }
      return currentIntervalMs();
    } catch (error) {
      setError(
        error instanceof Error
          ? `PR Radar could not read its stored state: ${error.message}`
          : "PR Radar could not read its stored state.",
      );
      return currentIntervalMs();
    } finally {
      inFlight = false;
      renderPulls();
      describeStatus();
    }
  };

  async function cycle(gen: number): Promise<void> {
    if (destroyed || !running || gen !== cycleGeneration) return;
    const delay = await runPoll();
    if (gen !== cycleGeneration) return;
    if (pendingRefresh) {
      pendingRefresh = false;
      scheduleNext(0, gen);
    } else {
      scheduleNext(delay, gen);
    }
  }

  const start = (): void => {
    running = true;
    void cycle(++cycleGeneration);
  };

  const stop = (): void => {
    running = false;
    releaseTimer();
  };

  const restart = (): void => {
    stop();
    start();
  };

  // If a poll is already running when the user clicks Refresh, queue one more
  // to run immediately after it finishes rather than silently skipping.
  let pendingRefresh = false;

  const forceRefresh = (): void => {
    if (inFlight) {
      pendingRefresh = true;
    } else {
      restart();
    }
  };

  // ====...==== settings mutations ====...====

  const commitSettings = async (
    next: PrRadarSettings,
  ): Promise<void> => {
    const normalized = normalizeSettings({ ...next, kinds: [] });
    // Persist first, so a rejected write never leaves the UI showing unsaved settings.
    await store.writeSettings(normalized);
    settings = normalized;
    renderSettings();
    restart();
  };

  const addRepository = async (candidate: string): Promise<void> => {
    const current = settings;
    if (!current?.auth) return;
    const repository = normalizeRepository(candidate);
    if (!repository) {
      setError("Enter a repository as owner/repository.");
      return;
    }
    if (current.repositories.includes(repository)) {
      setError(`${repository} is already tracked.`);
      return;
    }
    if (current.repositories.length >= MAX_TRACKED_REPOSITORIES) {
      setError(`At most ${MAX_TRACKED_REPOSITORIES} repositories can be tracked.`);
      return;
    }
    setError(null);
    elements.input.value = "";
    await commitSettings({
      ...current,
      repositories: [...current.repositories, repository],
    });
  };

  const setAuth = async (auth: GithubAuthChoice | null): Promise<void> => {
    const current = settings;
    if (!current) return;
    setError(null);
    elements.picker.hidden = true;
    await commitSettings({ ...current, auth });
  };

  // ====...==== events ====...====

  elements.useTap.addEventListener(
    "click",
    () => {
      void (async () => {
        elements.useTap.disabled = true;
        elements.useTap.textContent = "Checking TAP’s GitHub connection…";
        setModalError(null);
        try {
          // Approve only a connection that works, so a missing one is explained now rather than on the first poll.
          await tapConnectionProbe.getViewer();
          tapConnectionStatus = "available";
        } catch (error) {
          if (error instanceof GithubNotConnectedError) tapConnectionStatus = "unavailable";
          setModalError(tapAccessFailureMessage(error));
          renderAccess(); // restores button text and disabled state from tapConnectionStatus
          return;
        }
        try {
          await setAuth({ mode: "tap" });
          closeModal();
        } catch (error) {
          setModalError(
            error instanceof Error
              ? `PR Radar could not save GitHub access: ${error.message}`
              : "PR Radar could not save GitHub access.",
          );
          renderAccess();
        }
      })();
    },
    { signal },
  );

  elements.useCredential.addEventListener(
    "click",
    () => {
      const credential = tokenCredentials.find(
        (entry) => entry.id === elements.credentialSelect.value,
      );
      if (!credential) {
        setModalError("Choose a saved token first.");
        return;
      }
      void setAuth({
        mode: "credential",
        credentialId: credential.id,
        displayName: credential.displayName,
      }).then(() => closeModal());
    },
    { signal },
  );

  elements.reloadCredentials.addEventListener(
    "click",
    () => void loadCredentials(),
    { signal },
  );

  elements.revokeAccess.addEventListener(
    "click",
    () => void setAuth(null),
    { signal },
  );

  elements.accessBtn.addEventListener(
    "click",
    () => {
      if (elements.accessModal.hidden) {
        openModal();
        if (!settings?.auth) {
          void loadCredentials();
          void probeTapConnection();
        }
      } else {
        closeModal();
      }
    },
    { signal },
  );

  elements.modalClose.addEventListener("click", () => closeModal(), { signal });

  root.ownerDocument.addEventListener(
    "click",
    (event) => {
      if (
        !elements.accessModal.hidden &&
        event.target instanceof Node &&
        !elements.accessModal.contains(event.target) &&
        !elements.accessBtn.contains(event.target)
      ) {
        closeModal();
      }
    },
    { signal },
  );

  root.ownerDocument.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && !elements.accessModal.hidden) {
        closeModal();
        elements.accessBtn.focus();
      }
    },
    { signal },
  );

  elements.form.addEventListener(
    "submit",
    (event) => {
      event.preventDefault();
      void addRepository(elements.input.value);
    },
    { signal },
  );

  elements.clearAll.addEventListener(
    "click",
    () => {
      const current = settings;
      if (!current?.auth) return;
      void commitSettings({ ...current, repositories: [] });
    },
    { signal },
  );

  elements.repositories.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const repository = target.dataset.removeRepository;
      const current = settings;
      if (!repository || !current?.auth) return;
      void commitSettings({
        ...current,
        repositories: current.repositories.filter((entry) => entry !== repository),
      });
    },
    { signal },
  );

  elements.pollInterval.addEventListener(
    "change",
    () => {
      const current = settings;
      const seconds = Number.parseInt(elements.pollInterval.value, 10);
      if (!current?.auth || !Number.isFinite(seconds)) return;
      void commitSettings({ ...current, pollIntervalSeconds: seconds });
    },
    { signal },
  );

  elements.pullSearch.addEventListener("input", () => renderPulls(), { signal });
  elements.pullRepository.addEventListener("change", () => renderPulls(), { signal });
  elements.pullsList.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const trigger = target.closest<HTMLButtonElement>(".ghn-pr-link");
      const url = trigger?.dataset.externalUrl;
      if (!trigger || !url) return;
      event.preventDefault();
      event.stopPropagation();
      const openExternal = (
        sdk.navigation as typeof sdk.navigation & {
          openExternal?: (options: { url: string }) => void | Promise<void>;
        }
      ).openExternal;
      if (typeof openExternal !== "function") {
        setError("This version of TAP cannot open external links from mini-apps.");
        return;
      }
      setError(null);
      void Promise.resolve(openExternal({ url })).catch((error: unknown) => {
        setError(
          error instanceof Error
            ? `The pull request could not be opened: ${error.message}`
            : "The pull request could not be opened.",
        );
      });
    },
    { signal },
  );

  elements.refresh.addEventListener(
    "click",
    () => {
      if (settings?.auth) forceRefresh();
    },
    { signal },
  );

  elements.browse.addEventListener(
    "click",
    () => {
      if (!settings?.auth) return;
      void (async () => {
        elements.browse.disabled = true;
        setError(null);
        try {
          viewerRepositories = await client.listViewerRepositories();
          elements.picker.hidden = false;
          renderPicker();
          elements.pickerFilter.focus();
        } catch (error) {
          setError(
            error instanceof Error
              ? `GitHub repositories could not be listed: ${error.message}`
              : "GitHub repositories could not be listed.",
          );
        } finally {
          elements.browse.disabled = !settings?.auth;
        }
      })();
    },
    { signal },
  );

  elements.pickerFilter.addEventListener("input", () => renderPicker(), { signal });

  elements.pickerDone.addEventListener(
    "click",
    () => {
      elements.picker.hidden = true;
      elements.pickerFilter.value = "";
    },
    { signal },
  );

  elements.suggestions.addEventListener(
    "change",
    (event) => {
      const target = event.target;
      const current = settings;
      if (!(target instanceof HTMLInputElement) || !current?.auth) return;
      const repository = target.dataset.pickRepository;
      if (!repository) return;
      if (!target.checked) {
        void commitSettings({
          ...current,
          repositories: current.repositories.filter((entry) => entry !== repository),
        });
        return;
      }
      if (current.repositories.includes(repository)) return;
      if (current.repositories.length >= MAX_TRACKED_REPOSITORIES) {
        target.checked = false;
        setError(`At most ${MAX_TRACKED_REPOSITORIES} repositories can be tracked.`);
        return;
      }
      setError(null);
      void commitSettings({
        ...current,
        repositories: [...current.repositories, repository],
      });
    },
    { signal },
  );

  // ====...==== start ====...====

  const destroy = (): void => {
    destroyed = true;
    stop();
    controller.abort();
  };

  void (async () => {
    try {
      settings = await store.readSettings();
      openPulls = await store.listOpenPullRequests();
      renderSettings();
      if (!settings.auth) {
        void loadCredentials();
        openModal();
        void probeTapConnection();
      }
      start();
    } catch (error) {
      setError(
        error instanceof Error
          ? `PR Radar could not load its stored state: ${error.message}`
          : "PR Radar could not load its stored state.",
      );
    }
  })();

  return {
    capture: () => ({}),
    restore: () => {},
    pause: stop,
    resume: () => {
      if (!destroyed) start();
    },
    destroy,
  };
}
