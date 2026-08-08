import { DurableObject } from "cloudflare:workers";
import {
  browserSessionIsClosed,
  createBrowserSession,
  refreshBrowserTarget,
  releaseBrowserSession,
} from "./cloudflare-browser";
import {
  backendNodeAtViewportRatio,
  capturePageScreenshot,
  capturePageSnapshot,
  clickElement,
  diagnosticFromCdpEvent,
  fillElement,
  networkUpdateFromCdpEvent,
  scrollViewport,
  selectElementRepresentation,
  sanitizedNetworkUrl,
  type BrowserDiagnosticCandidate,
  type BrowserElementCandidate,
  type BrowserElementRepresentation,
  type BrowserElementSelection,
  type BrowserPageSnapshot,
  type BrowserScreenshot,
  type NetworkRequestUpdate,
} from "./browser-tools";
import {
  BrowserRunCdpClient,
  CdpClientError,
  connectBrowserRunCdp,
  type CdpDebugError,
  type CdpDisconnectEvent,
  type CdpEvent,
} from "./cdp-client";
import {
  ApiError,
  type BrowserControlHolder,
  type BrowserEngine,
  type SessionControlAssertionInput,
  type SessionHandoffInput,
  type SessionInput,
  validateTargetUrl,
} from "./policy";
import {
  type BrowserOwner,
  hashSecret,
  randomSessionToken,
  secretMatchesHash,
} from "./security";

export interface RpcError {
  readonly status: number;
  readonly code: string;
  readonly message: string;
}

export type RpcResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: RpcError };

export type BrowserSessionState =
  | "allocating"
  | "active"
  | "closing"
  | "closed"
  | "failed";

export interface BrowserControlLease {
  readonly holder: BrowserControlHolder;
  readonly participantId: string | null;
  readonly epoch: number;
  readonly expiresAt: string | null;
}

export interface BrowserParticipant {
  readonly participantId: string;
  readonly owner: BrowserOwner;
  readonly requestingUserId: string;
  readonly kind: BrowserControlHolder;
  readonly principalId: string;
  readonly instanceId: string;
  readonly consumerKind: string;
  readonly consumerKey: string;
}

export type BrowserParticipantStatus = "connected" | "disconnected";

export interface BrowserRoomParticipantView {
  readonly participantId: string;
  readonly kind: BrowserControlHolder;
  readonly principalId: string;
  readonly consumerKind: string;
  readonly status: BrowserParticipantStatus;
  readonly creator: boolean;
  readonly self: boolean;
  readonly joinedAt: string;
  readonly lastSeenAt: string;
  readonly disconnectedAt: string | null;
}

export interface BrowserRoomView {
  readonly sessionId: string;
  readonly state: BrowserSessionState;
  readonly documentRevision: number;
  readonly control: BrowserControlLease;
  readonly participants: readonly BrowserRoomParticipantView[];
}

export interface BrowserShareInvitation {
  readonly sessionId: string;
  readonly invitationToken: string;
  readonly invitationExpiresAt: string;
  readonly remainingUses: number;
}

export interface BrowserControlClaimInput {
  readonly expectedEpoch: number;
  readonly leaseMs: number;
}

export interface BrowserParticipantLeaveResult {
  readonly sessionId: string;
  readonly participantId: string;
  readonly status: "disconnected";
  readonly control: BrowserControlLease;
}

export interface BrowserSessionView {
  readonly sessionId: string;
  readonly engine: BrowserEngine;
  readonly requestedUrl: string;
  readonly targetId: string;
  readonly liveViewUrl: string | null;
  readonly expiresAt: string;
  readonly hardExpiresAt: string;
  readonly state: BrowserSessionState;
  readonly documentRevision: number;
  readonly control: BrowserControlLease;
}

export interface CreatedBrowserSession extends BrowserSessionView {
  readonly sessionToken: string;
}

export interface SessionRpcAuth {
  readonly owner: BrowserOwner;
  readonly sessionToken: string;
}

export interface CreateSessionRpcInput {
  readonly sessionId: string;
  readonly sessionToken: string;
  readonly owner: BrowserOwner;
  /** Trusted MCP callers provide their host-attested participant identity. */
  readonly participant?: BrowserParticipant;
  readonly input: SessionInput;
  readonly allowedDomains: readonly string[];
  readonly allowedHosts: string;
  readonly browserRunInactivityTimeoutMs: number;
  readonly maxSessionLifetimeMs: number;
  readonly now: number;
}

export interface QuotaReservationInput {
  readonly sessionId: string;
  readonly actorId: string;
  readonly expiresAt: number;
  readonly now: number;
}

export interface BrowserToolMutationGuard {
  readonly expectedControlEpoch: number;
  readonly expectedDocumentRevision: number;
}

export interface BrowserToolNavigateInput extends BrowserToolMutationGuard {
  readonly url: string;
}

export interface BrowserToolElementInput extends BrowserToolMutationGuard {
  readonly ref: string;
}

export interface BrowserToolFillInput extends BrowserToolElementInput {
  readonly value: string;
}

export interface BrowserToolScrollInput extends BrowserToolMutationGuard {
  readonly xRatio: number;
  readonly yRatio: number;
  readonly deltaX: number;
  readonly deltaY: number;
}

export type BrowserToolSelectElementInput = BrowserToolMutationGuard &
  { readonly representation: BrowserElementRepresentation } & (
    | {
      readonly ref: string;
      readonly xRatio?: never;
      readonly yRatio?: never;
    }
    | {
      readonly ref?: never;
      readonly xRatio: number;
      readonly yRatio: number;
    }
  );

export interface BrowserToolSessionView {
  readonly sessionId: string;
  readonly url: string;
  readonly title: string;
  readonly documentRevision: number;
  readonly control: BrowserControlLease;
  /** Null until a semantic tool first attaches to the target's CDP stream. */
  readonly telemetryCoverageStartedAt: string | null;
}

export type BrowserToolPageView = BrowserToolSessionView;

export interface BrowserToolSnapshot extends BrowserPageSnapshot {
  readonly sessionId: string;
  readonly control: BrowserControlLease;
  readonly telemetryCoverageStartedAt: string | null;
}

export interface BrowserToolScreenshot extends BrowserScreenshot {
  readonly sessionId: string;
  readonly documentRevision: number;
  readonly control: BrowserControlLease;
  readonly telemetryCoverageStartedAt: string | null;
}

export interface BrowserToolSelectedElement extends BrowserElementSelection {
  readonly sessionId: string;
  readonly elementRef: string;
  readonly documentRevision: number;
  readonly control: BrowserControlLease;
  readonly telemetryCoverageStartedAt: string | null;
}

export interface BrowserToolNetworkRequest {
  readonly method: string | null;
  readonly url: string | null;
  readonly resourceType: string | null;
  readonly status: number | null;
  readonly failed: boolean | null;
  readonly errorText: string | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
}

export interface BrowserToolDiagnostic {
  readonly kind: BrowserDiagnosticCandidate["kind"];
  readonly severity: BrowserDiagnosticCandidate["severity"];
  readonly message: string;
  readonly source: string | null;
  readonly occurredAt: string;
}

export interface BrowserToolPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: number;
  readonly hasMore: boolean;
  readonly telemetryGap: boolean;
  readonly telemetryCoverageStartedAt: string | null;
}

export interface BrowserToolPageInput {
  readonly cursor?: number;
  readonly limit?: number;
}

interface SessionRow {
  readonly [key: string]: SqlStorageValue;
  readonly gateway_session_id: string;
  readonly upstream_session_id: string | null;
  readonly actor_id: string;
  readonly workspace_id: string;
  readonly package_id: string;
  readonly installation_id: string;
  readonly contribution_id: string;
  readonly token_hash: string;
  readonly engine: BrowserEngine;
  readonly requested_url: string;
  readonly target_id: string | null;
  readonly live_view_url: string | null;
  readonly state: BrowserSessionState;
  readonly document_revision: number;
  readonly control_holder: BrowserControlHolder;
  readonly control_participant_id: string | null;
  readonly control_epoch: number;
  readonly control_expires_at: number | null;
  readonly lease_expires_at: number;
  readonly hard_expires_at: number;
  readonly close_reason: string | null;
  readonly created_at: number;
  readonly updated_at: number;
}

interface ParticipantRow {
  readonly [key: string]: SqlStorageValue;
  readonly participant_id: string;
  readonly actor_id: string;
  readonly workspace_id: string;
  readonly package_id: string;
  readonly installation_id: string;
  readonly contribution_id: string;
  readonly requesting_user_id: string;
  readonly kind: BrowserControlHolder;
  readonly principal_id: string;
  readonly instance_id: string;
  readonly consumer_kind: string;
  readonly consumer_key: string;
  readonly status: BrowserParticipantStatus;
  readonly is_creator: number;
  readonly joined_at: number;
  readonly last_seen_at: number;
  readonly disconnected_at: number | null;
}

interface InvitationRow {
  readonly [key: string]: SqlStorageValue;
  readonly token_hash: string;
  readonly created_by_participant_id: string;
  readonly workspace_id: string;
  readonly expires_at: number;
  readonly remaining_uses: number;
  readonly created_at: number;
}

interface ElementRefRow {
  readonly [key: string]: SqlStorageValue;
  readonly ref: string;
  readonly backend_node_id: number;
  readonly document_revision: number;
}

interface NetworkRow {
  readonly [key: string]: SqlStorageValue;
  readonly cursor: number;
  readonly method: string | null;
  readonly url: string | null;
  readonly resource_type: string | null;
  readonly status: number | null;
  readonly failed: number | null;
  readonly error_text: string | null;
  readonly started_at: number | null;
  readonly finished_at: number | null;
}

interface DiagnosticRow {
  readonly [key: string]: SqlStorageValue;
  readonly id: number;
  readonly kind: BrowserDiagnosticCandidate["kind"];
  readonly severity: BrowserDiagnosticCandidate["severity"];
  readonly message: string;
  readonly source: string | null;
  readonly occurred_at: number;
}

interface MutationRow {
  readonly [key: string]: SqlStorageValue;
  readonly operation_nonce: string;
  readonly expires_at: number;
}

interface ToolStateRow {
  readonly [key: string]: SqlStorageValue;
  readonly network_cursor: number;
  readonly telemetry_coverage_started_at: number | null;
  readonly telemetry_gap: number;
}

interface QuotaLimits {
  readonly activePerWorkspace: number;
  readonly activePerActor: number;
  readonly sessionCreatesPerMinute: number;
  readonly snapshotsPerMinute: number;
}

const MAX_ELEMENT_REFS = 500;
const MAX_NETWORK_REQUESTS = 1_000;
const MAX_DIAGNOSTICS = 500;
const MAX_TOOL_PAGE_SIZE = 100;
const DEFAULT_TOOL_PAGE_SIZE = 50;
const MUTATION_LEASE_MS = 120_000;
const NAVIGATION_READY_TIMEOUT_MS = 15_000;
const MAX_STORED_DIAGNOSTIC_TEXT = 2_000;
const ROOM_INVITATION_TTL_MS = 5 * 60_000;
const ROOM_INVITATION_USES = 2;
const MAX_AGENT_PARTICIPANTS = 1;
const MAX_HUMAN_PARTICIPANTS = 2;
const MAX_PARTICIPANT_HISTORY = 64;
// The miniapp renews presence every 1.5 seconds. Ninety seconds tolerates a
// suspended renderer and the gateway's normal 60-second tool timeout without
// allowing a force-killed app or agent to hold room capacity indefinitely.
// Creator authority remains durable even when its presence expires.
export const BROWSER_ROOM_PARTICIPANT_TTL_MS = 90_000;
const SENSITIVE_ELEMENT_HINT = /(?:pass(?:word)?|secret|token|otp|one[-_ ]?time|credit[-_ ]?card|card[-_ ]?number|cvv|cvc)/iu;

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

function boundedPageInput(input: BrowserToolPageInput): {
  readonly cursor: number;
  readonly limit: number;
} {
  const cursor = input.cursor ?? 0;
  const limit = input.limit ?? DEFAULT_TOOL_PAGE_SIZE;
  if (!Number.isSafeInteger(cursor) || cursor < 0) {
    throw new ApiError(400, "invalid_cursor", "Browser event cursor must be a non-negative integer.");
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_TOOL_PAGE_SIZE) {
    throw new ApiError(
      400,
      "invalid_limit",
      `Browser event limit must be an integer from 1 to ${MAX_TOOL_PAGE_SIZE}.`,
    );
  }
  return { cursor, limit };
}

function redactStoredText(value: string, limit = MAX_STORED_DIAGNOSTIC_TEXT): string {
  const redactedCredentials = value.replace(
    /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/giu,
    "$1 [REDACTED]",
  ).replace(
    /(["']?)(authorization|proxy-authorization|cookie|set-cookie|password|passwd|secret|token|api[_-]?key|credential)(["']?)(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}\]]+)/giu,
    "$1$2$3$4[REDACTED]",
  ).replace(
    /\b(?:eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|(?:sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{12,})\b/gu,
    "[REDACTED TOKEN]",
  );
  const redactedUrls = redactedCredentials.replace(
    /\bhttps?:\/\/[^\s<>"']+/giu,
    (candidate) => {
      const sanitized = sanitizedNetworkUrl(candidate);
      if (sanitized === null) return "[REDACTED URL]";
      return `${new URL(sanitized).origin}/[REDACTED]`;
    },
  );
  return redactedUrls.replace(/\s+/gu, " ").trim().slice(0, limit);
}

function dateOrNull(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function success<T>(value: T): RpcResult<T> {
  return { ok: true, value };
}

function failure(error: ApiError): RpcResult<never> {
  return {
    ok: false,
    error: { status: error.status, code: error.code, message: error.message },
  };
}

function internalFailure(): RpcResult<never> {
  return failure(
    new ApiError(
      500,
      "internal_error",
      "The browser control plane could not complete the request.",
    ),
  );
}

function logFailure(
  message: string,
  error: unknown,
  details: Readonly<Record<string, unknown>> = {},
): void {
  console.error(
    JSON.stringify({
      message,
      error: error instanceof Error ? error.message : String(error),
      ...details,
    }),
  );
}

function integerSetting(
  value: string,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new ApiError(
      503,
      "gateway_not_configured",
      `${name} is not configured with a valid integer.`,
    );
  }
  return parsed;
}

export function quotaLimits(env: Env): QuotaLimits {
  return {
    activePerWorkspace: integerSetting(
      env.MAX_ACTIVE_SESSIONS_PER_WORKSPACE,
      "MAX_ACTIVE_SESSIONS_PER_WORKSPACE",
      1,
      100,
    ),
    activePerActor: integerSetting(
      env.MAX_ACTIVE_SESSIONS_PER_ACTOR,
      "MAX_ACTIVE_SESSIONS_PER_ACTOR",
      1,
      50,
    ),
    sessionCreatesPerMinute: integerSetting(
      env.MAX_SESSION_CREATES_PER_MINUTE,
      "MAX_SESSION_CREATES_PER_MINUTE",
      1,
      1_000,
    ),
    snapshotsPerMinute: integerSetting(
      env.MAX_SNAPSHOTS_PER_MINUTE,
      "MAX_SNAPSHOTS_PER_MINUTE",
      1,
      10_000,
    ),
  };
}

export interface BrowserRuntimeLimits {
  readonly browserRunInactivityTimeoutMs: number;
  readonly maxSessionLifetimeMs: number;
}

export function browserRuntimeLimits(env: Env): BrowserRuntimeLimits {
  return {
    browserRunInactivityTimeoutMs: integerSetting(
      env.BROWSER_RUN_INACTIVITY_TIMEOUT_MS,
      "BROWSER_RUN_INACTIVITY_TIMEOUT_MS",
      10_000,
      600_000,
    ),
    maxSessionLifetimeMs: integerSetting(
      env.MAX_SESSION_LIFETIME_MS,
      "MAX_SESSION_LIFETIME_MS",
      60_000,
      86_400_000,
    ),
  };
}

function sameOwner(row: SessionRow, owner: BrowserOwner): boolean {
  return (
    row.actor_id === owner.actorId &&
    row.workspace_id === owner.workspaceId &&
    row.package_id === owner.packageId &&
    row.installation_id === owner.installationId &&
    row.contribution_id === owner.contributionId
  );
}

function sameParticipantOwner(
  row: ParticipantRow,
  owner: BrowserOwner,
): boolean {
  return (
    row.actor_id === owner.actorId &&
    row.workspace_id === owner.workspaceId &&
    row.package_id === owner.packageId &&
    row.installation_id === owner.installationId &&
    row.contribution_id === owner.contributionId
  );
}

function sameSessionAudience(
  row: SessionRow,
  owner: BrowserOwner,
): boolean {
  return row.workspace_id === owner.workspaceId &&
    row.package_id === owner.packageId &&
    row.contribution_id === owner.contributionId;
}

function legacyParticipant(
  sessionId: string,
  owner: BrowserOwner,
): BrowserParticipant {
  return {
    participantId: `rp_legacy_${sessionId.replaceAll("-", "")}`,
    owner,
    requestingUserId: owner.actorId,
    kind: "agent",
    principalId: owner.actorId,
    instanceId: sessionId,
    consumerKind: "legacy-http",
    consumerKey: "legacy-http-owner",
  };
}

function participantView(
  row: ParticipantRow,
  selfParticipantId: string,
): BrowserRoomParticipantView {
  return {
    participantId: row.participant_id,
    kind: row.kind,
    principalId: row.principal_id,
    consumerKind: row.consumer_kind,
    status: row.status,
    creator: row.is_creator === 1,
    self: row.participant_id === selfParticipantId,
    joinedAt: new Date(row.joined_at).toISOString(),
    lastSeenAt: new Date(row.last_seen_at).toISOString(),
    disconnectedAt: dateOrNull(row.disconnected_at),
  };
}

function view(row: SessionRow): BrowserSessionView {
  return {
    sessionId: row.gateway_session_id,
    engine: row.engine,
    requestedUrl: row.requested_url,
    targetId: row.target_id ?? "",
    liveViewUrl: row.state === "active" ? row.live_view_url : null,
    expiresAt: new Date(row.lease_expires_at).toISOString(),
    hardExpiresAt: new Date(row.hard_expires_at).toISOString(),
    state: row.state,
    documentRevision: row.document_revision,
    control: {
      holder: row.control_holder,
      participantId: row.control_participant_id,
      epoch: row.control_epoch,
      expiresAt:
        row.control_expires_at === null
          ? null
          : new Date(row.control_expires_at).toISOString(),
    },
  };
}

export class BrowserOwnerQuota extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.migrate();
    });
  }

  private migrate(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS _sql_schema_migrations (
        id INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
    `);
    const version = this.ctx.storage.sql
      .exec<{ version: number }>(
        "SELECT COALESCE(MAX(id), 0) AS version FROM _sql_schema_migrations",
      )
      .one().version;
    if (version < 1) {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS quota_reservations (
          session_id TEXT PRIMARY KEY,
          actor_id TEXT NOT NULL,
          expires_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS quota_reservations_actor_idx
          ON quota_reservations(actor_id, expires_at);
        CREATE TABLE IF NOT EXISTS quota_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          actor_id TEXT NOT NULL,
          kind TEXT NOT NULL CHECK(kind IN ('session_create', 'snapshot')),
          occurred_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS quota_events_window_idx
          ON quota_events(kind, actor_id, occurred_at);
        CREATE TABLE IF NOT EXISTS assertion_nonces (
          assertion_id TEXT PRIMARY KEY,
          expires_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS assertion_nonces_expiry_idx
          ON assertion_nonces(expires_at);
      `);
      this.ctx.storage.sql.exec(
        "INSERT INTO _sql_schema_migrations (id, applied_at) VALUES (1, ?)",
        Date.now(),
      );
    }
  }

  private cleanup(now: number): void {
    this.ctx.storage.sql.exec(
      "DELETE FROM quota_reservations WHERE expires_at <= ?",
      now,
    );
    this.ctx.storage.sql.exec(
      "DELETE FROM quota_events WHERE occurred_at <= ?",
      now - 60_000,
    );
    this.ctx.storage.sql.exec(
      "DELETE FROM assertion_nonces WHERE expires_at <= ?",
      now,
    );
  }

  private async scheduleCleanup(): Promise<void> {
    const reservation = this.ctx.storage.sql
      .exec<{ due_at: number | null }>(
        "SELECT MIN(expires_at) AS due_at FROM quota_reservations",
      )
      .one().due_at;
    const event = this.ctx.storage.sql
      .exec<{ due_at: number | null }>(
        "SELECT MIN(occurred_at + 60000) AS due_at FROM quota_events",
      )
      .one().due_at;
    const nonce = this.ctx.storage.sql
      .exec<{ due_at: number | null }>(
        "SELECT MIN(expires_at) AS due_at FROM assertion_nonces",
      )
      .one().due_at;
    const candidates = [reservation, event, nonce].filter(
      (candidate): candidate is number => typeof candidate === "number",
    );
    if (candidates.length === 0) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    await this.ctx.storage.setAlarm(Math.max(Date.now() + 1, Math.min(...candidates)));
  }

  async consumeAssertion(
    assertionId: string,
    expiresAt: number,
    now: number,
  ): Promise<RpcResult<null>> {
    try {
      const replayed = this.ctx.storage.transactionSync(() => {
        this.cleanup(now);
        const existing = this.ctx.storage.sql
          .exec<{ found: number }>(
            "SELECT COUNT(*) AS found FROM assertion_nonces WHERE assertion_id = ?",
            assertionId,
          )
          .one().found;
        if (existing > 0) return true;
        this.ctx.storage.sql.exec(
          "INSERT INTO assertion_nonces (assertion_id, expires_at) VALUES (?, ?)",
          assertionId,
          expiresAt,
        );
        return false;
      });
      await this.scheduleCleanup();
      return replayed
        ? failure(
            new ApiError(
              409,
              "assertion_replayed",
              "This browser assertion has already been used.",
            ),
          )
        : success(null);
    } catch (error) {
      logFailure("browser assertion nonce check failed", error);
      return internalFailure();
    }
  }

  async consumeSnapshot(actorId: string, now: number): Promise<RpcResult<null>> {
    try {
      const limits = quotaLimits(this.env);
      const limited = this.ctx.storage.transactionSync(() => {
        this.cleanup(now);
        const count = this.ctx.storage.sql
          .exec<{ count: number }>(
            `SELECT COUNT(*) AS count
               FROM quota_events
              WHERE kind = 'snapshot' AND actor_id = ? AND occurred_at > ?`,
            actorId,
            now - 60_000,
          )
          .one().count;
        if (count >= limits.snapshotsPerMinute) return true;
        this.ctx.storage.sql.exec(
          "INSERT INTO quota_events (actor_id, kind, occurred_at) VALUES (?, 'snapshot', ?)",
          actorId,
          now,
        );
        return false;
      });
      await this.scheduleCleanup();
      return limited
        ? failure(
            new ApiError(
              429,
              "snapshot_quota_exceeded",
              "The actor snapshot quota has been exceeded.",
            ),
          )
        : success(null);
    } catch (error) {
      logFailure("browser snapshot quota check failed", error);
      return internalFailure();
    }
  }

  async reserveSession(input: QuotaReservationInput): Promise<RpcResult<null>> {
    try {
      const limits = quotaLimits(this.env);
      const quotaError = this.ctx.storage.transactionSync<ApiError | null>(() => {
        this.cleanup(input.now);
        const existing = this.ctx.storage.sql
          .exec<{ found: number }>(
            "SELECT COUNT(*) AS found FROM quota_reservations WHERE session_id = ?",
            input.sessionId,
          )
          .one().found;
        if (existing > 0) return null;
        const workspaceCount = this.ctx.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM quota_reservations",
          )
          .one().count;
        if (workspaceCount >= limits.activePerWorkspace) {
          return new ApiError(
            429,
            "workspace_session_quota_exceeded",
            "The workspace active-browser quota has been exceeded.",
          );
        }
        const actorCount = this.ctx.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM quota_reservations WHERE actor_id = ?",
            input.actorId,
          )
          .one().count;
        if (actorCount >= limits.activePerActor) {
          return new ApiError(
            429,
            "actor_session_quota_exceeded",
            "The actor active-browser quota has been exceeded.",
          );
        }
        const recentCreates = this.ctx.storage.sql
          .exec<{ count: number }>(
            `SELECT COUNT(*) AS count
               FROM quota_events
              WHERE kind = 'session_create' AND actor_id = ? AND occurred_at > ?`,
            input.actorId,
            input.now - 60_000,
          )
          .one().count;
        if (recentCreates >= limits.sessionCreatesPerMinute) {
          return new ApiError(
            429,
            "session_create_quota_exceeded",
            "The actor browser-session creation quota has been exceeded.",
          );
        }
        this.ctx.storage.sql.exec(
          "INSERT INTO quota_reservations (session_id, actor_id, expires_at) VALUES (?, ?, ?)",
          input.sessionId,
          input.actorId,
          input.expiresAt,
        );
        this.ctx.storage.sql.exec(
          "INSERT INTO quota_events (actor_id, kind, occurred_at) VALUES (?, 'session_create', ?)",
          input.actorId,
          input.now,
        );
        return null;
      });
      await this.scheduleCleanup();
      return quotaError ? failure(quotaError) : success(null);
    } catch (error) {
      logFailure("browser session quota reservation failed", error);
      return internalFailure();
    }
  }

  async extendSession(
    sessionId: string,
    actorId: string,
    expiresAt: number,
  ): Promise<RpcResult<null>> {
    try {
      const found = this.ctx.storage.transactionSync(() => {
        const existing = this.ctx.storage.sql
          .exec<{ found: number }>(
            `SELECT COUNT(*) AS found
               FROM quota_reservations
              WHERE session_id = ? AND actor_id = ?`,
            sessionId,
            actorId,
          )
          .one().found;
        if (existing !== 1) return false;
        this.ctx.storage.sql.exec(
          `UPDATE quota_reservations
              SET expires_at = MAX(expires_at, ?)
            WHERE session_id = ? AND actor_id = ?`,
          expiresAt,
          sessionId,
          actorId,
        );
        return true;
      });
      if (!found) {
        return failure(
          new ApiError(
            409,
            "quota_reservation_missing",
            "The browser quota reservation is no longer active.",
          ),
        );
      }
      await this.scheduleCleanup();
      return success(null);
    } catch (error) {
      logFailure("browser session quota extension failed", error);
      return internalFailure();
    }
  }

  async releaseSession(sessionId: string, actorId: string): Promise<void> {
    this.ctx.storage.sql.exec(
      "DELETE FROM quota_reservations WHERE session_id = ? AND actor_id = ?",
      sessionId,
      actorId,
    );
    await this.scheduleCleanup();
  }

  async alarm(): Promise<void> {
    try {
      this.cleanup(Date.now());
      await this.scheduleCleanup();
    } catch (error) {
      logFailure("browser quota cleanup alarm failed", error);
      await this.ctx.storage.setAlarm(Date.now() + 30_000);
    }
  }
}

export class BrowserSessionCoordinator extends DurableObject<Env> {
  private cdpClient: BrowserRunCdpClient | null = null;
  private cdpIdentity: string | null = null;
  private cdpConnecting: Promise<BrowserRunCdpClient> | null = null;
  private persistedCdpDebugSequence = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.migrate();
    });
  }

  private migrate(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS _sql_schema_migrations (
        id INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
    `);
    const version = this.ctx.storage.sql
      .exec<{ version: number }>(
        "SELECT COALESCE(MAX(id), 0) AS version FROM _sql_schema_migrations",
      )
      .one().version;
    if (version < 1) {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS browser_session (
          singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
          gateway_session_id TEXT NOT NULL UNIQUE,
          upstream_session_id TEXT,
          actor_id TEXT NOT NULL,
          workspace_id TEXT NOT NULL,
          package_id TEXT NOT NULL,
          installation_id TEXT NOT NULL,
          contribution_id TEXT NOT NULL,
          token_hash TEXT NOT NULL,
          engine TEXT NOT NULL CHECK(engine = 'kitesurf'),
          requested_url TEXT NOT NULL,
          target_id TEXT,
          live_view_url TEXT,
          state TEXT NOT NULL CHECK(state IN ('allocating', 'active', 'closing', 'closed', 'failed')),
          control_holder TEXT NOT NULL CHECK(control_holder IN ('agent', 'human')),
          control_epoch INTEGER NOT NULL,
          control_expires_at INTEGER,
          lease_expires_at INTEGER NOT NULL,
          hard_expires_at INTEGER NOT NULL,
          close_reason TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `);
      this.ctx.storage.sql.exec(
        "INSERT INTO _sql_schema_migrations (id, applied_at) VALUES (1, ?)",
        Date.now(),
      );
    }
    if (version < 2) {
      this.ctx.storage.sql.exec(`
        ALTER TABLE browser_session
          ADD COLUMN document_revision INTEGER NOT NULL DEFAULT 1;
        CREATE TABLE IF NOT EXISTS browser_element_ref (
          ref TEXT PRIMARY KEY,
          backend_node_id INTEGER NOT NULL,
          document_revision INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          UNIQUE(document_revision, backend_node_id)
        );
        CREATE INDEX IF NOT EXISTS browser_element_ref_revision_idx
          ON browser_element_ref(document_revision, created_at);
        CREATE TABLE IF NOT EXISTS browser_network_request (
          request_key TEXT PRIMARY KEY,
          cursor INTEGER NOT NULL UNIQUE,
          method TEXT,
          url TEXT,
          resource_type TEXT,
          status REAL,
          failed INTEGER CHECK(failed IS NULL OR failed IN (0, 1)),
          error_text TEXT,
          started_at INTEGER,
          finished_at INTEGER,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS browser_network_request_cursor_idx
          ON browser_network_request(cursor);
        CREATE TABLE IF NOT EXISTS browser_diagnostic (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          kind TEXT NOT NULL CHECK(kind IN ('console', 'exception', 'network', 'http', 'cdp', 'telemetry')),
          severity TEXT NOT NULL CHECK(severity IN ('info', 'warning', 'error')),
          message TEXT NOT NULL,
          source TEXT,
          occurred_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS browser_diagnostic_time_idx
          ON browser_diagnostic(occurred_at, id);
        CREATE TABLE IF NOT EXISTS browser_mutation (
          singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
          operation_nonce TEXT NOT NULL UNIQUE,
          control_epoch INTEGER NOT NULL,
          document_revision INTEGER NOT NULL,
          started_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS browser_tool_state (
          singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
          network_cursor INTEGER NOT NULL,
          telemetry_coverage_started_at INTEGER,
          telemetry_gap INTEGER NOT NULL CHECK(telemetry_gap IN (0, 1))
        );
        INSERT OR IGNORE INTO browser_tool_state (
          singleton, network_cursor, telemetry_coverage_started_at, telemetry_gap
        ) VALUES (1, 0, NULL, 0);
      `);
      this.ctx.storage.sql.exec(
        "INSERT INTO _sql_schema_migrations (id, applied_at) VALUES (2, ?)",
        Date.now(),
      );
    }
    if (version < 3) {
      this.ctx.storage.sql.exec(`
        ALTER TABLE browser_session
          ADD COLUMN control_participant_id TEXT;
        CREATE TABLE IF NOT EXISTS browser_room_participant (
          participant_id TEXT PRIMARY KEY,
          actor_id TEXT NOT NULL,
          workspace_id TEXT NOT NULL,
          package_id TEXT NOT NULL,
          installation_id TEXT NOT NULL,
          contribution_id TEXT NOT NULL,
          requesting_user_id TEXT NOT NULL,
          kind TEXT NOT NULL CHECK(kind IN ('agent', 'human')),
          principal_id TEXT NOT NULL,
          instance_id TEXT NOT NULL,
          consumer_kind TEXT NOT NULL,
          consumer_key TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('connected', 'disconnected')),
          is_creator INTEGER NOT NULL CHECK(is_creator IN (0, 1)),
          joined_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL,
          disconnected_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS browser_room_participant_presence_idx
          ON browser_room_participant(status, kind, joined_at);
        CREATE TABLE IF NOT EXISTS browser_room_invitation (
          token_hash TEXT PRIMARY KEY,
          created_by_participant_id TEXT NOT NULL,
          workspace_id TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          remaining_uses INTEGER NOT NULL CHECK(remaining_uses >= 0 AND remaining_uses <= 2),
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS browser_room_invitation_expiry_idx
          ON browser_room_invitation(expires_at);
        INSERT OR IGNORE INTO browser_room_participant (
          participant_id, actor_id, workspace_id, package_id, installation_id,
          contribution_id, requesting_user_id, kind, principal_id, instance_id,
          consumer_kind, consumer_key, status, is_creator, joined_at,
          last_seen_at, disconnected_at
        )
        SELECT
          'rp_legacy_' || replace(gateway_session_id, '-', ''), actor_id,
          workspace_id, package_id, installation_id, contribution_id, actor_id,
          'agent', actor_id, gateway_session_id, 'legacy-http',
          'legacy-http-owner', 'connected', 1, created_at, updated_at, NULL
        FROM browser_session
        WHERE singleton = 1;
        UPDATE browser_session
           SET control_participant_id =
             'rp_legacy_' || replace(gateway_session_id, '-', '')
         WHERE singleton = 1 AND control_participant_id IS NULL;
      `);
      this.ctx.storage.sql.exec(
        "INSERT INTO _sql_schema_migrations (id, applied_at) VALUES (3, ?)",
        Date.now(),
      );
    }
  }

  private row(): SessionRow | null {
    return (
      this.ctx.storage.sql
        .exec<SessionRow>("SELECT * FROM browser_session WHERE singleton = 1")
        .toArray()[0] ?? null
    );
  }

  private participantRow(participantId: string): ParticipantRow | null {
    return this.ctx.storage.sql
      .exec<ParticipantRow>(
        "SELECT * FROM browser_room_participant WHERE participant_id = ?",
        participantId,
      )
      .toArray()[0] ?? null;
  }

  private participants(): readonly ParticipantRow[] {
    return this.ctx.storage.sql
      .exec<ParticipantRow>(
        `SELECT * FROM browser_room_participant
          ORDER BY joined_at ASC, participant_id ASC`,
      )
      .toArray();
  }

  private roomView(
    row: SessionRow,
    selfParticipantId: string,
  ): BrowserRoomView {
    return {
      sessionId: row.gateway_session_id,
      state: row.state,
      documentRevision: row.document_revision,
      control: view(row).control,
      participants: this.participants().map((participant) =>
        participantView(participant, selfParticipantId)
      ),
    };
  }

  private insertParticipant(
    participant: BrowserParticipant,
    creator: boolean,
    now: number,
  ): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO browser_room_participant (
         participant_id, actor_id, workspace_id, package_id, installation_id,
         contribution_id, requesting_user_id, kind, principal_id, instance_id,
         consumer_kind, consumer_key, status, is_creator, joined_at,
         last_seen_at, disconnected_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'connected', ?, ?, ?, NULL)`,
      participant.participantId,
      participant.owner.actorId,
      participant.owner.workspaceId,
      participant.owner.packageId,
      participant.owner.installationId,
      participant.owner.contributionId,
      participant.requestingUserId,
      participant.kind,
      participant.principalId,
      participant.instanceId,
      participant.consumerKind,
      participant.consumerKey,
      creator ? 1 : 0,
      now,
      now,
    );
  }

  private toolState(): ToolStateRow {
    return this.ctx.storage.sql
      .exec<ToolStateRow>(
        `SELECT network_cursor, telemetry_coverage_started_at, telemetry_gap
           FROM browser_tool_state
          WHERE singleton = 1`,
      )
      .one();
  }

  private coverageStartedAt(): string | null {
    return dateOrNull(this.toolState().telemetry_coverage_started_at);
  }

  private recordDiagnostic(candidate: BrowserDiagnosticCandidate): void {
    const message = redactStoredText(candidate.message);
    if (!message) return;
    const source = candidate.source === null
      ? null
      : redactStoredText(candidate.source, 500) || null;
    this.ctx.storage.sql.exec(
      `INSERT INTO browser_diagnostic (
         kind, severity, message, source, occurred_at
       ) VALUES (?, ?, ?, ?, ?)`,
      candidate.kind,
      candidate.severity,
      message,
      source,
      candidate.occurredAt,
    );
    const pruned = this.ctx.storage.sql.exec(
      `DELETE FROM browser_diagnostic
        WHERE id IN (
          SELECT id FROM browser_diagnostic
           ORDER BY id DESC
           LIMIT -1 OFFSET ?
        )`,
      MAX_DIAGNOSTICS,
    ).rowsWritten;
    if (pruned > 0) {
      this.ctx.storage.sql.exec(
        "UPDATE browser_tool_state SET telemetry_gap = 1 WHERE singleton = 1",
      );
    }
  }

  private recordNetworkUpdate(update: NetworkRequestUpdate, now: number): void {
    const current = this.ctx.storage.sql
      .exec<{ network_cursor: number }>(
        `UPDATE browser_tool_state
            SET network_cursor = network_cursor + 1
          WHERE singleton = 1
          RETURNING network_cursor`,
      )
      .one().network_cursor;
    const failed = update.failed === null ? null : update.failed ? 1 : 0;
    const errorText = update.errorText === null
      ? null
      : redactStoredText(update.errorText, 500) || null;
    this.ctx.storage.sql.exec(
      `INSERT INTO browser_network_request (
         request_key, cursor, method, url, resource_type, status, failed,
         error_text, started_at, finished_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(request_key) DO UPDATE SET
         cursor = excluded.cursor,
         method = COALESCE(excluded.method, browser_network_request.method),
         url = COALESCE(excluded.url, browser_network_request.url),
         resource_type = COALESCE(excluded.resource_type, browser_network_request.resource_type),
         status = COALESCE(excluded.status, browser_network_request.status),
         failed = COALESCE(excluded.failed, browser_network_request.failed),
         error_text = COALESCE(excluded.error_text, browser_network_request.error_text),
         started_at = COALESCE(excluded.started_at, browser_network_request.started_at),
         finished_at = COALESCE(excluded.finished_at, browser_network_request.finished_at),
         updated_at = excluded.updated_at`,
      update.requestId,
      current,
      update.method,
      update.url,
      update.resourceType,
      update.status,
      failed,
      errorText,
      update.startedAt === null
        ? null
        : update.startedAt < 946_684_800_000 ? now : update.startedAt,
      update.finishedAt === null
        ? null
        : update.finishedAt < 946_684_800_000 ? now : update.finishedAt,
      now,
    );
    const pruned = this.ctx.storage.sql.exec(
      `DELETE FROM browser_network_request
        WHERE request_key IN (
          SELECT request_key FROM browser_network_request
           ORDER BY cursor DESC
           LIMIT -1 OFFSET ?
        )`,
      MAX_NETWORK_REQUESTS,
    ).rowsWritten;
    if (pruned > 0) {
      this.ctx.storage.sql.exec(
        "UPDATE browser_tool_state SET telemetry_gap = 1 WHERE singleton = 1",
      );
    }
  }

  private advanceDocumentRevision(url: string | null = null): number {
    const now = Date.now();
    const updated = this.ctx.storage.sql
      .exec<{ document_revision: number }>(
        `UPDATE browser_session
            SET document_revision = document_revision + 1,
                requested_url = COALESCE(?, requested_url),
                updated_at = ?
          WHERE singleton = 1 AND state = 'active'
          RETURNING document_revision`,
        url,
        now,
      )
      .toArray()[0];
    if (!updated) return this.row()?.document_revision ?? 0;
    this.ctx.storage.sql.exec("DELETE FROM browser_element_ref");
    return updated.document_revision;
  }

  private mainFrameUrl(event: CdpEvent): string | null {
    if (event.method !== "Page.frameNavigated") return null;
    const frame = record(record(event.params)?.frame);
    if (!frame || typeof frame.parentId === "string") return null;
    const url = sanitizedNetworkUrl(frame.url);
    return url === null ? null : url;
  }

  private handleCdpEvent(event: CdpEvent): void {
    const row = this.row();
    if (!row || row.state !== "active") return;
    if (event.method === "DOM.documentUpdated") {
      this.advanceDocumentRevision();
    } else if (event.method === "Page.frameNavigated") {
      const frame = record(record(event.params)?.frame);
      if (frame && typeof frame.parentId !== "string") {
        this.advanceDocumentRevision(this.mainFrameUrl(event));
      }
    }
    const network = networkUpdateFromCdpEvent(
      event.method,
      event.params,
      event.receivedAt,
    );
    if (network) this.recordNetworkUpdate(network, event.receivedAt);
    const diagnostic = diagnosticFromCdpEvent(
      event.method,
      event.params,
      event.receivedAt,
    );
    if (diagnostic) this.recordDiagnostic(diagnostic);
  }

  private handleCdpDisconnect(event: CdpDisconnectEvent): void {
    this.ctx.storage.sql.exec(
      "UPDATE browser_tool_state SET telemetry_gap = 1 WHERE singleton = 1",
    );
    this.recordDiagnostic({
      kind: "telemetry",
      severity: "warning",
      message: `CDP telemetry disconnected: ${event.reason || `socket code ${event.code}`}`,
      source: "cdp",
      occurredAt: event.receivedAt,
    });
  }

  private recordCdpDebugError(error: CdpDebugError): void {
    this.recordDiagnostic({
      kind: "cdp",
      severity: "error",
      message: `${error.code}: ${error.message}`,
      source: error.method ?? "cdp",
      occurredAt: error.occurredAt,
    });
  }

  private drainCdpDebugErrors(client: BrowserRunCdpClient): void {
    const errors = client.getDebugErrors();
    const first = errors[0];
    if (
      first &&
      first.sequence > this.persistedCdpDebugSequence + 1
    ) {
      this.ctx.storage.sql.exec(
        "UPDATE browser_tool_state SET telemetry_gap = 1 WHERE singleton = 1",
      );
      this.recordDiagnostic({
        kind: "telemetry",
        severity: "warning",
        message: "Some bounded CDP diagnostics were evicted before they could be persisted.",
        source: "cdp",
        occurredAt: Date.now(),
      });
    }
    for (const error of errors) {
      if (error.sequence <= this.persistedCdpDebugSequence) continue;
      this.recordCdpDebugError(error);
      this.persistedCdpDebugSequence = error.sequence;
    }
  }

  private async ensureCdp(
    row: SessionRow,
    initialCoverageComplete = false,
  ): Promise<BrowserRunCdpClient> {
    const upstreamSessionId = row.upstream_session_id;
    const targetId = row.target_id;
    if (
      row.state !== "active" ||
      !upstreamSessionId ||
      !targetId
    ) {
      throw new ApiError(409, "session_not_active", "The browser session is not active.");
    }
    const identity = `${upstreamSessionId}:${targetId}`;
    if (this.cdpIdentity === identity && this.cdpClient?.state === "open") {
      return this.cdpClient;
    }
    if (this.cdpConnecting && this.cdpIdentity === identity) {
      return this.cdpConnecting;
    }

    const prior = this.cdpClient;
    if (prior && this.cdpIdentity === identity && prior.state === "disconnected") {
      const reconnecting = (async (): Promise<BrowserRunCdpClient> => {
        await prior.reconnect();
        const current = this.row();
        if (
          !current ||
          current.state !== "active" ||
          current.upstream_session_id !== upstreamSessionId ||
          current.target_id !== targetId
        ) {
          await prior.close();
          throw new ApiError(409, "session_not_active", "The browser session is not active.");
        }
        this.ctx.storage.sql.exec(
          `UPDATE browser_tool_state
              SET telemetry_gap = 1,
                  telemetry_coverage_started_at = COALESCE(telemetry_coverage_started_at, ?)
            WHERE singleton = 1`,
          Date.now(),
        );
        this.recordDiagnostic({
          kind: "telemetry",
          severity: "warning",
          message: "CDP telemetry reconnected; events during the connection gap may be missing.",
          source: "cdp",
          occurredAt: Date.now(),
        });
        return prior;
      })();
      this.cdpConnecting = reconnecting;
      try {
        return await reconnecting;
      } finally {
        if (this.cdpConnecting === reconnecting) this.cdpConnecting = null;
      }
    }

    if (prior) await prior.close();
    this.cdpClient = null;
    this.cdpIdentity = identity;
    this.persistedCdpDebugSequence = 0;
    const connecting = (async (): Promise<BrowserRunCdpClient> => {
      const client = await connectBrowserRunCdp({
        browser: this.env.BROWSER,
        upstreamSessionId,
        targetId,
        onEvent: (event) => this.handleCdpEvent(event),
        onDisconnect: (event) => this.handleCdpDisconnect(event),
      });
      const current = this.row();
      if (
        !current ||
        current.state !== "active" ||
        current.upstream_session_id !== upstreamSessionId ||
        current.target_id !== targetId
      ) {
        await client.close();
        throw new ApiError(409, "session_not_active", "The browser session is not active.");
      }
      this.cdpClient = client;
      const startedAt = Date.now();
      const state = this.toolState();
      this.ctx.storage.sql.exec(
        `UPDATE browser_tool_state
            SET telemetry_coverage_started_at = COALESCE(telemetry_coverage_started_at, ?),
                telemetry_gap = CASE
                  WHEN telemetry_coverage_started_at IS NULL AND ? = 1 THEN 0
                  ELSE 1
                END
          WHERE singleton = 1`,
        startedAt,
        initialCoverageComplete ? 1 : 0,
      );
      if (state.telemetry_coverage_started_at !== null) {
        this.recordDiagnostic({
          kind: "telemetry",
          severity: "warning",
          message: "CDP telemetry resumed after Durable Object eviction; events during the gap may be missing.",
          source: "cdp",
          occurredAt: startedAt,
        });
      } else if (!initialCoverageComplete) {
        this.recordDiagnostic({
          kind: "telemetry",
          severity: "info",
          message: "CDP telemetry coverage began after browser allocation; earlier page events are unavailable.",
          source: "cdp",
          occurredAt: startedAt,
        });
      }
      return client;
    })();
    this.cdpConnecting = connecting;
    try {
      return await connecting;
    } finally {
      if (this.cdpConnecting === connecting) this.cdpConnecting = null;
    }
  }

  private async waitForDocumentReady(
    client: BrowserRunCdpClient,
  ): Promise<void> {
    const deadline = Date.now() + NAVIGATION_READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const evaluated = record(await client.send("Runtime.evaluate", {
        expression: "document.readyState",
        returnByValue: true,
        awaitPromise: false,
        userGesture: false,
      }));
      const readyState = record(evaluated?.result)?.value;
      if (readyState === "interactive" || readyState === "complete") return;
      await scheduler.wait(Math.min(100, deadline - Date.now()));
    }
    throw new ApiError(
      504,
      "navigation_timeout",
      "The remote page did not become ready before the navigation timeout.",
    );
  }

  private async closeCdp(): Promise<void> {
    const client = this.cdpClient;
    const connecting = this.cdpConnecting;
    this.cdpClient = null;
    this.cdpConnecting = null;
    this.cdpIdentity = null;
    this.persistedCdpDebugSequence = 0;
    if (client) await client.close();
    if (connecting) {
      await connecting.then((pending) => pending.close()).catch(() => undefined);
    }
  }

  private connectedParticipant(
    participant: BrowserParticipant,
    touch = true,
  ): RpcResult<ParticipantRow> {
    const existing = this.row();
    if (!existing || !sameSessionAudience(existing, participant.owner)) {
      return failure(new ApiError(404, "session_not_found", "Browser session not found."));
    }
    const joined = this.participantRow(participant.participantId);
    if (
      !joined ||
      !this.participantIdentityMatches(joined, participant)
    ) {
      return failure(
        new ApiError(404, "participant_not_joined", "Browser room participant not found."),
      );
    }
    if (joined.status !== "connected") {
      return failure(
        new ApiError(
          409,
          "participant_disconnected",
          "The browser room participant must rejoin before using this session.",
        ),
      );
    }
    if (touch) {
      const now = Date.now();
      this.ctx.storage.sql.exec(
        `UPDATE browser_room_participant
            SET last_seen_at = ?
          WHERE participant_id = ? AND status = 'connected'`,
        now,
        participant.participantId,
      );
      this.expireStaleParticipants(now, participant.participantId);
    }
    return success(this.participantRow(participant.participantId) ?? joined);
  }

  private participantIdentityMatches(
    row: ParticipantRow,
    participant: BrowserParticipant,
  ): boolean {
    return sameParticipantOwner(row, participant.owner) &&
      row.requesting_user_id === participant.requestingUserId &&
      row.kind === participant.kind &&
      row.principal_id === participant.principalId &&
      row.instance_id === participant.instanceId &&
      row.consumer_kind === participant.consumerKind &&
      row.consumer_key === participant.consumerKey;
  }

  private async activeToolRow(
    participant: BrowserParticipant,
  ): Promise<RpcResult<SessionRow>> {
    const authenticated = this.connectedParticipant(participant);
    if (!authenticated.ok) return authenticated;
    const existing = this.row();
    if (!existing) {
      return failure(new ApiError(404, "session_not_found", "Browser session not found."));
    }
    const row = this.refreshExpiredControl(existing, Date.now());
    if (row.state !== "active" || row.lease_expires_at <= Date.now()) {
      if (row.state === "active") await this.closeInternal(row, 0, "expired");
      return failure(new ApiError(409, "session_not_active", "The browser session is not active."));
    }
    if (!row.upstream_session_id || !row.target_id) {
      return failure(new ApiError(409, "session_not_active", "The browser session is not active."));
    }
    await this.schedule(row);
    return success(row);
  }

  private clearStaleMutation(now: number): boolean {
    const mutation = this.ctx.storage.sql
      .exec<MutationRow>(
        "SELECT operation_nonce, expires_at FROM browser_mutation WHERE singleton = 1",
      )
      .toArray()[0];
    if (!mutation || mutation.expires_at > now) return false;
    this.ctx.storage.sql.exec(
      "DELETE FROM browser_mutation WHERE singleton = 1 AND expires_at <= ?",
      now,
    );
    this.recordDiagnostic({
      kind: "telemetry",
      severity: "warning",
      message: "A stale browser mutation lease was recovered after its bounded timeout.",
      source: "control-plane",
      occurredAt: now,
    });
    return true;
  }

  private mutationInFlight(now = Date.now()): boolean {
    this.clearStaleMutation(now);
    return this.ctx.storage.sql
      .exec<{ found: number }>(
        "SELECT COUNT(*) AS found FROM browser_mutation WHERE singleton = 1",
      )
      .one().found === 1;
  }

  /**
   * Presence is renewed by every authenticated room/tool call. Pruning is
   * intentionally demand-driven: active viewers poll the room, and a new join
   * runs this before capacity is counted. An in-flight operation protects the
   * current controller until its independently bounded mutation lease ends.
   */
  private expireStaleParticipants(
    now: number,
    preserveParticipantId: string | null = null,
  ): SessionRow | null {
    const row = this.row();
    if (!row) return null;
    const cutoff = now - BROWSER_ROOM_PARTICIPANT_TTL_MS;
    const mutationInFlight = this.mutationInFlight(now);
    const stale = this.ctx.storage.sql
      .exec<ParticipantRow>(
        `SELECT * FROM browser_room_participant
          WHERE status = 'connected'
            AND last_seen_at <= ?
            AND (? IS NULL OR participant_id <> ?)
          ORDER BY joined_at ASC, participant_id ASC`,
        cutoff,
        preserveParticipantId,
        preserveParticipantId,
      )
      .toArray()
      .filter((candidate) =>
        !(mutationInFlight && candidate.participant_id === row.control_participant_id)
      );
    if (stale.length === 0) return row;

    const staleIds = new Set(stale.map((candidate) => candidate.participant_id));
    this.ctx.storage.transactionSync(() => {
      for (const participantId of staleIds) {
        this.ctx.storage.sql.exec(
          `UPDATE browser_room_participant
              SET status = 'disconnected', disconnected_at = ?
            WHERE participant_id = ?
              AND status = 'connected'
              AND last_seen_at <= ?`,
          now,
          participantId,
          cutoff,
        );
      }
      if (
        row.control_participant_id !== null &&
        staleIds.has(row.control_participant_id)
      ) {
        const agent = this.connectedController("agent", row.control_participant_id);
        this.ctx.storage.sql.exec(
          `UPDATE browser_session
              SET control_holder = 'agent', control_participant_id = ?,
                  control_epoch = control_epoch + 1, control_expires_at = NULL,
                  updated_at = ?
            WHERE singleton = 1 AND control_participant_id = ?`,
          agent?.participant_id ?? null,
          now,
          row.control_participant_id,
        );
      }
    });
    return this.row() ?? row;
  }

  private acquireMutation(
    row: SessionRow,
    participantId: string,
    guard: BrowserToolMutationGuard,
  ): string {
    const now = Date.now();
    this.clearStaleMutation(now);
    const current = this.row();
    if (!current || current.state !== "active" || current.lease_expires_at <= now) {
      throw new ApiError(409, "session_not_active", "The browser session is not active.");
    }
    if (current.control_participant_id !== participantId) {
      throw new ApiError(
        409,
        "control_lease_not_held",
        "This browser participant does not hold the current control lease.",
      );
    }
    if (
      current.control_epoch !== guard.expectedControlEpoch ||
      row.control_epoch !== guard.expectedControlEpoch
    ) {
      throw new ApiError(
        409,
        "stale_control_epoch",
        "Browser control changed before this mutation could be applied.",
      );
    }
    if (
      current.document_revision !== guard.expectedDocumentRevision ||
      row.document_revision !== guard.expectedDocumentRevision
    ) {
      throw new ApiError(
        409,
        "stale_document_revision",
        "The page changed before this mutation could be applied. Take a new snapshot.",
      );
    }
    if (this.mutationInFlight(now)) {
      throw new ApiError(
        409,
        "browser_mutation_in_flight",
        "Another browser mutation is already in flight.",
      );
    }
    const nonce = crypto.randomUUID();
    const expiresAt = Math.min(
      now + MUTATION_LEASE_MS,
      current.lease_expires_at,
      current.hard_expires_at,
    );
    this.ctx.storage.sql.exec(
      `INSERT INTO browser_mutation (
         singleton, operation_nonce, control_epoch, document_revision,
         started_at, expires_at
       ) VALUES (1, ?, ?, ?, ?, ?)`,
      nonce,
      current.control_epoch,
      current.document_revision,
      now,
      expiresAt,
    );
    return nonce;
  }

  private assertToolReadGuard(
    row: SessionRow,
    guard: BrowserToolMutationGuard,
    operationNonce: string | null = null,
  ): SessionRow {
    const now = Date.now();
    const current = this.row();
    if (!current || current.state !== "active" || current.lease_expires_at <= now) {
      throw new ApiError(409, "session_not_active", "The browser session is not active.");
    }
    if (
      current.control_epoch !== guard.expectedControlEpoch ||
      row.control_epoch !== guard.expectedControlEpoch
    ) {
      throw new ApiError(
        409,
        "stale_control_epoch",
        "Browser control changed before the selected element could be read.",
      );
    }
    if (
      current.document_revision !== guard.expectedDocumentRevision ||
      row.document_revision !== guard.expectedDocumentRevision
    ) {
      throw new ApiError(
        409,
        "stale_document_revision",
        "The page changed before the selected element could be read. Take a new snapshot.",
      );
    }
    this.clearStaleMutation(now);
    const mutation = this.ctx.storage.sql
      .exec<MutationRow>(
        "SELECT operation_nonce, expires_at FROM browser_mutation WHERE singleton = 1",
      )
      .toArray()[0];
    if (mutation && mutation.operation_nonce !== operationNonce) {
      throw new ApiError(
        409,
        "browser_mutation_in_flight",
        "The selected element cannot be read while a browser mutation is in flight.",
      );
    }
    return current;
  }

  private acquireReadOperation(
    row: SessionRow,
    guard: BrowserToolMutationGuard,
  ): string {
    const current = this.assertToolReadGuard(row, guard);
    const now = Date.now();
    const nonce = crypto.randomUUID();
    const expiresAt = Math.min(
      now + MUTATION_LEASE_MS,
      current.lease_expires_at,
      current.hard_expires_at,
    );
    this.ctx.storage.sql.exec(
      `INSERT INTO browser_mutation (
         singleton, operation_nonce, control_epoch, document_revision,
         started_at, expires_at
       ) VALUES (1, ?, ?, ?, ?, ?)`,
      nonce,
      current.control_epoch,
      current.document_revision,
      now,
      expiresAt,
    );
    return nonce;
  }

  private releaseMutation(nonce: string, participantId: string): void {
    const now = Date.now();
    this.ctx.storage.sql.exec(
      "DELETE FROM browser_mutation WHERE singleton = 1 AND operation_nonce = ?",
      nonce,
    );
    // A browser operation may legitimately last longer than the ordinary
    // polling interval. Renew at completion so another viewer cannot prune the
    // controller in the handoff between the tool response and its next poll.
    this.ctx.storage.sql.exec(
      `UPDATE browser_room_participant
          SET last_seen_at = ?
        WHERE participant_id = ? AND status = 'connected'`,
      now,
      participantId,
    );
  }

  private registerElement(
    candidate: BrowserElementCandidate,
    documentRevision: number,
  ): Promise<string> {
    return this.registerBackendNodeId(candidate.backendNodeId, documentRevision);
  }

  private registerBackendNodeId(
    backendNodeId: number,
    documentRevision: number,
  ): Promise<string> {
    if (!Number.isSafeInteger(backendNodeId) || backendNodeId <= 0) {
      return Promise.reject(new ApiError(
        502,
        "invalid_cdp_result",
        "The browser returned an invalid selected element.",
      ));
    }
    const row = this.row();
    if (
      !row ||
      row.state !== "active" ||
      row.document_revision !== documentRevision
    ) {
      return Promise.reject(new ApiError(
        409,
        "document_changed",
        "The page changed while Remote Browser captured it. Take another snapshot.",
      ));
    }
    const existing = this.ctx.storage.sql
      .exec<{ ref: string }>(
        `SELECT ref FROM browser_element_ref
          WHERE document_revision = ? AND backend_node_id = ?`,
        documentRevision,
        backendNodeId,
      )
      .toArray()[0];
    if (existing) return Promise.resolve(existing.ref);
    const ref = `el_${crypto.randomUUID().replaceAll("-", "")}`;
    this.ctx.storage.sql.exec(
      `INSERT INTO browser_element_ref (
         ref, backend_node_id, document_revision, created_at
       ) VALUES (?, ?, ?, ?)`,
      ref,
      backendNodeId,
      documentRevision,
      Date.now(),
    );
    this.ctx.storage.sql.exec(
      `DELETE FROM browser_element_ref
        WHERE ref IN (
          SELECT ref FROM browser_element_ref
           ORDER BY created_at DESC, ref DESC
           LIMIT -1 OFFSET ?
        )`,
      MAX_ELEMENT_REFS,
    );
    return Promise.resolve(ref);
  }

  private elementBackendNodeId(ref: string, documentRevision: number): number {
    if (!/^el_[0-9a-f]{32}$/u.test(ref)) {
      throw new ApiError(400, "invalid_element_ref", "Element reference is invalid.");
    }
    const element = this.ctx.storage.sql
      .exec<ElementRefRow>(
        `SELECT ref, backend_node_id, document_revision
           FROM browser_element_ref
          WHERE ref = ? AND document_revision = ?`,
        ref,
        documentRevision,
      )
      .toArray()[0];
    if (!element) {
      throw new ApiError(
        409,
        "stale_element_ref",
        "The element reference is stale or unknown. Take a new snapshot.",
      );
    }
    return element.backend_node_id;
  }

  private async currentPageView(
    row: SessionRow,
    client: BrowserRunCdpClient,
  ): Promise<BrowserToolSessionView> {
    const result = record(await client.send("Page.getNavigationHistory"));
    const entries = result?.entries;
    const currentIndex = result?.currentIndex;
    const current = Array.isArray(entries) && Number.isSafeInteger(currentIndex)
      ? record(entries[Number(currentIndex)])
      : null;
    if (!current || typeof current.url !== "string") {
      throw new ApiError(502, "invalid_cdp_result", "The browser omitted the current page URL.");
    }
    const url = sanitizedNetworkUrl(current.url);
    if (url === null) {
      throw new ApiError(502, "invalid_cdp_result", "The browser returned an invalid page URL.");
    }
    const latest = this.row() ?? row;
    return {
      sessionId: latest.gateway_session_id,
      url,
      title: typeof current.title === "string"
        ? redactStoredText(current.title, 1_000)
        : "",
      documentRevision: latest.document_revision,
      control: view(latest).control,
      telemetryCoverageStartedAt: this.coverageStartedAt(),
    };
  }

  private toolFailure(error: unknown, operation: string): RpcResult<never> {
    if (error instanceof ApiError) return failure(error);
    if (error instanceof CdpClientError) {
      if (this.cdpClient) this.drainCdpDebugErrors(this.cdpClient);
      this.recordDiagnostic({
        kind: "cdp",
        severity: "error",
        message: `${error.code}: ${error.message}`,
        source: error.method ?? operation,
        occurredAt: Date.now(),
      });
      return failure(new ApiError(502, error.code, error.message));
    }
    logFailure(`browser tool ${operation} failed`, error);
    return internalFailure();
  }

  private async authenticatedRow(
    auth: SessionRpcAuth,
  ): Promise<RpcResult<SessionRow>> {
    const row = this.row();
    if (!row || !sameOwner(row, auth.owner)) {
      return failure(new ApiError(404, "session_not_found", "Browser session not found."));
    }
    if (!(await secretMatchesHash(auth.sessionToken, row.token_hash))) {
      return failure(
        new ApiError(
          401,
          "session_unauthorized",
          "The session-scoped browser capability is invalid.",
        ),
      );
    }
    // Hash verification yields to the runtime. Return current durable state,
    // not the pre-verification snapshot, so a concurrent close/handoff cannot
    // surface a stale Live View or control lease.
    const current = this.row();
    if (!current || !sameOwner(current, auth.owner)) {
      return failure(new ApiError(404, "session_not_found", "Browser session not found."));
    }
    if (current.token_hash !== row.token_hash) {
      return failure(
        new ApiError(
          401,
          "session_unauthorized",
          "The session-scoped browser capability is invalid.",
        ),
      );
    }
    return success(current);
  }

  private async schedule(row: SessionRow): Promise<void> {
    if (row.state === "closed" || row.state === "failed") {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    const now = Date.now();
    if (row.state === "closing") {
      const due = now + 30_000;
      const scheduled = await this.ctx.storage.getAlarm();
      // Status polling must not continually push an already-scheduled close
      // retry into the future.
      if (scheduled === null || scheduled > due) {
        await this.ctx.storage.setAlarm(due);
      }
      return;
    }
    const due = Math.min(
      row.lease_expires_at,
      row.control_expires_at ?? row.lease_expires_at,
    );
    await this.ctx.storage.setAlarm(Math.max(now + 1, due));
  }

  private connectedController(
    preferredKind: BrowserControlHolder = "agent",
    excludingParticipantId: string | null = null,
  ): ParticipantRow | null {
    return this.ctx.storage.sql
      .exec<ParticipantRow>(
        `SELECT * FROM browser_room_participant
          WHERE status = 'connected'
            AND kind = ?
            AND (? IS NULL OR participant_id <> ?)
          ORDER BY is_creator DESC, joined_at ASC, participant_id ASC
          LIMIT 1`,
        preferredKind,
        excludingParticipantId,
        excludingParticipantId,
      )
      .toArray()[0] ?? null;
  }

  private refreshExpiredControl(row: SessionRow, now: number): SessionRow {
    if (
      row.state !== "active" ||
      row.control_holder !== "human" ||
      row.control_expires_at === null ||
      row.control_expires_at > now
    ) {
      return row;
    }
    this.ctx.storage.sql.exec(
      `UPDATE browser_session
          SET control_holder = 'agent',
              control_participant_id = ?,
              control_epoch = control_epoch + 1,
              control_expires_at = NULL,
              updated_at = ?
        WHERE singleton = 1 AND control_epoch = ?`,
      this.connectedController("agent")?.participant_id ?? null,
      now,
      row.control_epoch,
    );
    return this.row() ?? row;
  }

  private quotaCoordinator(workspaceId: string) {
    return this.env.BROWSER_OWNER_QUOTAS.getByName(workspaceId);
  }

  private async releaseQuota(row: SessionRow): Promise<void> {
    try {
      await this.quotaCoordinator(row.workspace_id).releaseSession(
        row.gateway_session_id,
        row.actor_id,
      );
    } catch (error) {
      logFailure("browser quota release failed", error, {
        sessionId: row.gateway_session_id,
      });
    }
  }

  private async markClosed(row: SessionRow, reason: string): Promise<SessionRow> {
    await this.closeCdp();
    const finalReason = row.close_reason ?? reason;
    this.ctx.storage.sql.exec(
      `UPDATE browser_session
          SET state = 'closed',
              live_view_url = NULL,
              control_holder = 'agent',
              control_participant_id = NULL,
              control_expires_at = NULL,
              close_reason = ?,
              updated_at = ?
        WHERE singleton = 1`,
      finalReason,
      Date.now(),
    );
    this.ctx.storage.sql.exec("DELETE FROM browser_element_ref");
    this.ctx.storage.sql.exec("DELETE FROM browser_mutation");
    this.ctx.storage.sql.exec(
      `UPDATE browser_room_participant
          SET status = 'disconnected', disconnected_at = COALESCE(disconnected_at, ?),
              last_seen_at = ?
        WHERE status = 'connected'`,
      Date.now(),
      Date.now(),
    );
    this.ctx.storage.sql.exec("DELETE FROM browser_room_invitation");
    await this.ctx.storage.deleteAlarm();
    await this.releaseQuota(row);
    return this.row() ?? row;
  }

  private async closeInternal(
    original: SessionRow,
    waitMs: number,
    reason: string,
  ): Promise<SessionRow> {
    if (original.state === "closed" || original.state === "failed") return original;
    if (!original.upstream_session_id) return this.markClosed(original, reason);

    if (original.state !== "closing") {
      this.ctx.storage.sql.exec(
        `UPDATE browser_session
            SET state = 'closing',
                live_view_url = NULL,
                control_holder = 'agent',
                control_participant_id = NULL,
                control_epoch = control_epoch + 1,
                control_expires_at = NULL,
                close_reason = ?,
                updated_at = ?
          WHERE singleton = 1 AND state IN ('allocating', 'active')`,
        reason,
        Date.now(),
      );
    }
    const closing = this.row() ?? original;
    await this.closeCdp();
    const upstreamSessionId = closing.upstream_session_id;
    if (!upstreamSessionId) return this.markClosed(closing, reason);
    try {
      const closeStatus = await releaseBrowserSession(
        upstreamSessionId,
        this.env,
      );
      if (closeStatus === "closed") return this.markClosed(closing, reason);

      const deadline = Date.now() + waitMs;
      while (Date.now() < deadline) {
        await scheduler.wait(Math.min(250, deadline - Date.now()));
        if (
          await browserSessionIsClosed(upstreamSessionId, this.env)
        ) {
          return this.markClosed(closing, reason);
        }
      }
      const latest = this.row() ?? closing;
      await this.schedule(latest);
      return latest;
    } catch (error) {
      const latest = this.row();
      if (latest && latest.state !== "closed" && latest.state !== "failed") {
        await this.schedule(latest);
      }
      throw error;
    }
  }

  async create(input: CreateSessionRpcInput): Promise<RpcResult<CreatedBrowserSession>> {
    if (this.row()) {
      return failure(
        new ApiError(409, "session_already_initialized", "Browser session already exists."),
      );
    }
    const leaseExpiresAt = Math.min(
      input.now + input.input.keepAliveMs,
      input.now + input.maxSessionLifetimeMs,
    );
    const hardExpiresAt = input.now + input.maxSessionLifetimeMs;
    let initialized = false;
    try {
      const tokenHash = await hashSecret(input.sessionToken);
      const creator = input.participant ?? legacyParticipant(input.sessionId, input.owner);
      if (
        creator.owner.actorId !== input.owner.actorId ||
        creator.owner.workspaceId !== input.owner.workspaceId ||
        creator.owner.packageId !== input.owner.packageId ||
        creator.owner.installationId !== input.owner.installationId ||
        creator.owner.contributionId !== input.owner.contributionId
      ) {
        throw new ApiError(
          401,
          "participant_attestation_invalid",
          "The browser session participant does not match its authenticated owner.",
        );
      }
      if (this.row()) {
        return failure(
          new ApiError(409, "session_already_initialized", "Browser session already exists."),
        );
      }
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(
          `INSERT INTO browser_session (
             singleton, gateway_session_id, upstream_session_id,
             actor_id, workspace_id, package_id, installation_id, contribution_id,
             token_hash, engine, requested_url, target_id, live_view_url, state,
             control_holder, control_participant_id, control_epoch,
             control_expires_at, lease_expires_at, hard_expires_at, close_reason,
             created_at, updated_at
           ) VALUES (
             1, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'allocating',
             ?, ?, 1, NULL, ?, ?, NULL, ?, ?
           )`,
          input.sessionId,
          input.owner.actorId,
          input.owner.workspaceId,
          input.owner.packageId,
          input.owner.installationId,
          input.owner.contributionId,
          tokenHash,
          input.input.engine,
          input.input.url,
          creator.kind,
          creator.participantId,
          leaseExpiresAt,
          hardExpiresAt,
          input.now,
          input.now,
        );
        this.insertParticipant(creator, true, input.now);
      });
      initialized = true;
      const allocating = this.row();
      if (!allocating) throw new Error("session row was not persisted");
      await this.schedule(allocating);

      const upstream = await createBrowserSession(
        input.input,
        input.allowedDomains,
        input.allowedHosts,
        input.browserRunInactivityTimeoutMs,
        this.env,
      );
      this.ctx.storage.sql.exec(
        `UPDATE browser_session
            SET upstream_session_id = ?,
                target_id = ?,
                live_view_url = ?,
                state = 'active',
                updated_at = ?
          WHERE singleton = 1 AND state = 'allocating'`,
        upstream.upstreamSessionId,
        upstream.targetId,
        upstream.liveViewUrl,
        Date.now(),
      );
      const active = this.row();
      if (!active || active.state !== "active") {
        await releaseBrowserSession(upstream.upstreamSessionId, this.env);
        throw new Error("session activation lost its allocation state");
      }
      const client = await this.ensureCdp(active, true);
      await client.send("Emulation.setDeviceMetricsOverride", {
        width: input.input.viewport.width,
        height: input.input.viewport.height,
        deviceScaleFactor: input.input.viewport.deviceScaleFactor,
        mobile: input.input.viewport.mobile,
        screenWidth: input.input.viewport.width,
        screenHeight: input.input.viewport.height,
      });
      const navigation = record(
        await client.send("Page.navigate", { url: input.input.url }),
      );
      if (typeof navigation?.errorText === "string" && navigation.errorText) {
        throw new ApiError(
          502,
          "navigation_failed",
          `The remote browser could not navigate: ${redactStoredText(navigation.errorText, 500)}`,
        );
      }
      await this.waitForDocumentReady(client);
      const afterNavigation = this.row();
      if (
        afterNavigation &&
        afterNavigation.state === "active" &&
        afterNavigation.document_revision === active.document_revision
      ) {
        this.advanceDocumentRevision(input.input.url);
      }
      this.drainCdpDebugErrors(client);
      return success({
        ...view(this.row() ?? active),
        sessionToken: input.sessionToken,
      });
    } catch (error) {
      if (initialized) {
        const current = this.row();
        await this.closeCdp();
        if (current?.upstream_session_id) {
          await releaseBrowserSession(current.upstream_session_id, this.env)
            .catch(() => undefined);
        }
        this.ctx.storage.sql.exec(
          `UPDATE browser_session
              SET state = 'failed', live_view_url = NULL, updated_at = ?
            WHERE singleton = 1 AND state IN ('allocating', 'active')`,
          Date.now(),
        );
        await this.ctx.storage.deleteAlarm();
        const failed = this.row();
        if (failed) await this.releaseQuota(failed);
      }
      if (error instanceof ApiError) return failure(error);
      logFailure("browser session allocation failed", error, {
        sessionId: input.sessionId,
      });
      return internalFailure();
    }
  }

  async get(auth: SessionRpcAuth): Promise<RpcResult<BrowserSessionView>> {
    try {
      const authenticated = await this.authenticatedRow(auth);
      if (!authenticated.ok) return authenticated;
      let row = this.refreshExpiredControl(authenticated.value, Date.now());
      if (row.state === "active" && row.lease_expires_at <= Date.now()) {
        row = await this.closeInternal(row, 0, "expired");
      } else {
        await this.schedule(row);
      }
      return success(view(row));
    } catch (error) {
      if (error instanceof ApiError) return failure(error);
      logFailure("browser session status failed", error);
      return internalFailure();
    }
  }

  async renew(
    auth: SessionRpcAuth,
    leaseMs: number,
    allowedHosts: string,
  ): Promise<RpcResult<BrowserSessionView>> {
    try {
      const authenticated = await this.authenticatedRow(auth);
      if (!authenticated.ok) return authenticated;
      const before = this.refreshExpiredControl(authenticated.value, Date.now());
      const now = Date.now();
      if (before.state !== "active" || before.lease_expires_at <= now) {
        if (before.state === "active") await this.closeInternal(before, 0, "expired");
        return failure(
          new ApiError(409, "session_not_active", "The browser session is not active."),
        );
      }
      const expiresAt = Math.min(
        Math.max(before.lease_expires_at, now + leaseMs),
        before.hard_expires_at,
      );
      if (expiresAt <= now) {
        await this.closeInternal(before, 0, "hard_expiry");
        return failure(
          new ApiError(
            409,
            "session_hard_expired",
            "The gateway policy does not allow this session to renew beyond its hard expiry.",
          ),
        );
      }
      if (!before.upstream_session_id || !before.target_id) {
        return failure(
          new ApiError(409, "session_not_active", "The browser session is not active."),
        );
      }
      const refreshed = await refreshBrowserTarget(
        before.upstream_session_id,
        before.target_id,
        expiresAt - now,
        allowedHosts,
        this.env,
      );
      const quota = await this.quotaCoordinator(before.workspace_id).extendSession(
        before.gateway_session_id,
        before.actor_id,
        expiresAt,
      );
      if (!quota.ok) return quota;

      const current = this.row();
      if (!current || current.state !== "active") {
        return failure(
          new ApiError(409, "session_not_active", "The browser session is not active."),
        );
      }
      if (current.lease_expires_at <= expiresAt) {
        this.ctx.storage.sql.exec(
          `UPDATE browser_session
              SET live_view_url = ?, lease_expires_at = ?, updated_at = ?
            WHERE singleton = 1 AND state = 'active' AND lease_expires_at <= ?`,
          refreshed.liveViewUrl,
          expiresAt,
          Date.now(),
          expiresAt,
        );
      }
      const renewed = this.row() ?? current;
      await this.schedule(renewed);
      return success(view(renewed));
    } catch (error) {
      if (error instanceof ApiError) return failure(error);
      logFailure("browser session renewal failed", error);
      return internalFailure();
    }
  }

  async handoff(
    auth: SessionRpcAuth,
    input: SessionHandoffInput,
  ): Promise<RpcResult<BrowserSessionView>> {
    try {
      const authenticated = await this.authenticatedRow(auth);
      if (!authenticated.ok) return authenticated;
      let row = this.refreshExpiredControl(authenticated.value, Date.now());
      const now = Date.now();
      if (row.state !== "active" || row.lease_expires_at <= now) {
        if (row.state === "active") await this.closeInternal(row, 0, "expired");
        return failure(
          new ApiError(409, "session_not_active", "The browser session is not active."),
        );
      }
      if (row.control_epoch !== input.expectedEpoch) {
        return failure(
          new ApiError(
            409,
            "stale_control_epoch",
            "Control changed before this handoff could be applied.",
          ),
        );
      }
      if (this.mutationInFlight(now)) {
        return failure(
          new ApiError(
            409,
            "browser_mutation_in_flight",
            "Browser control cannot be handed off while a mutation is in flight.",
          ),
        );
      }
      const controlExpiresAt =
        input.to === "human" && input.leaseMs !== null
          ? Math.min(now + input.leaseMs, row.lease_expires_at)
          : null;
      const controller = this.connectedController(input.to);
      const updated = this.ctx.storage.sql.exec(
        `UPDATE browser_session
            SET control_holder = ?,
                control_participant_id = ?,
                control_epoch = control_epoch + 1,
                control_expires_at = ?,
                updated_at = ?
          WHERE singleton = 1 AND state = 'active' AND control_epoch = ?`,
        input.to,
        controller?.participant_id ?? null,
        controlExpiresAt,
        now,
        input.expectedEpoch,
      ).rowsWritten;
      if (updated !== 1) {
        return failure(
          new ApiError(
            409,
            "stale_control_epoch",
            "Control changed before this handoff could be applied.",
          ),
        );
      }
      row = this.row() ?? row;
      await this.schedule(row);
      return success(view(row));
    } catch (error) {
      if (error instanceof ApiError) return failure(error);
      logFailure("browser control handoff failed", error);
      return internalFailure();
    }
  }

  async assertControl(
    auth: SessionRpcAuth,
    input: SessionControlAssertionInput,
  ): Promise<RpcResult<BrowserControlLease>> {
    try {
      const authenticated = await this.authenticatedRow(auth);
      if (!authenticated.ok) return authenticated;
      const row = this.refreshExpiredControl(authenticated.value, Date.now());
      if (
        row.state !== "active" ||
        row.lease_expires_at <= Date.now() ||
        row.control_holder !== input.holder ||
        row.control_epoch !== input.epoch
      ) {
        return failure(
          new ApiError(
            409,
            "control_lease_not_held",
            "The requested browser control lease is not current.",
          ),
        );
      }
      return success(view(row).control);
    } catch (error) {
      if (error instanceof ApiError) return failure(error);
      logFailure("browser control assertion failed", error);
      return internalFailure();
    }
  }

  async shareSession(
    participant: BrowserParticipant,
  ): Promise<RpcResult<BrowserShareInvitation>> {
    try {
      const active = await this.activeToolRow(participant);
      if (!active.ok) return active;
      const joined = this.participantRow(participant.participantId);
      if (!joined || joined.is_creator !== 1) {
        return failure(
          new ApiError(
            403,
            "share_not_allowed",
            "Only the room creator can share this browser session.",
          ),
        );
      }
      const invitationToken = randomSessionToken();
      const tokenHash = await hashSecret(invitationToken);
      const authenticated = this.connectedParticipant(participant);
      if (!authenticated.ok) return authenticated;
      const current = this.row();
      const now = Date.now();
      if (
        !current ||
        current.state !== "active" ||
        current.lease_expires_at <= now
      ) {
        return failure(
          new ApiError(409, "session_not_active", "The browser session is not active."),
        );
      }
      const expiresAt = Math.min(now + ROOM_INVITATION_TTL_MS, current.lease_expires_at);
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(
          `DELETE FROM browser_room_invitation
            WHERE expires_at <= ? OR created_by_participant_id = ?`,
          now,
          participant.participantId,
        );
        this.ctx.storage.sql.exec(
          `INSERT INTO browser_room_invitation (
             token_hash, created_by_participant_id, workspace_id, expires_at,
             remaining_uses, created_at
           ) VALUES (?, ?, ?, ?, ?, ?)`,
          tokenHash,
          participant.participantId,
          current.workspace_id,
          expiresAt,
          ROOM_INVITATION_USES,
          now,
        );
      });
      return success({
        sessionId: current.gateway_session_id,
        invitationToken,
        invitationExpiresAt: new Date(expiresAt).toISOString(),
        remainingUses: ROOM_INVITATION_USES,
      });
    } catch (error) {
      if (error instanceof ApiError) return failure(error);
      logFailure("browser room share failed", error);
      return internalFailure();
    }
  }

  async joinSession(
    participant: BrowserParticipant,
    invitationToken: string | undefined,
  ): Promise<RpcResult<BrowserRoomView>> {
    try {
      const existingSession = this.row();
      if (!existingSession || !sameSessionAudience(existingSession, participant.owner)) {
        return failure(new ApiError(404, "session_not_found", "Browser session not found."));
      }
      const now = Date.now();
      let row = this.refreshExpiredControl(existingSession, now);
      if (row.state !== "active" || row.lease_expires_at <= now) {
        if (row.state === "active") await this.closeInternal(row, 0, "expired");
        return failure(
          new ApiError(409, "session_not_active", "The browser session is not active."),
        );
      }

      const prior = this.participantRow(participant.participantId);
      if (prior) {
        if (!this.participantIdentityMatches(prior, participant)) {
          return failure(
            new ApiError(404, "participant_not_joined", "Browser room participant not found."),
          );
        }
        row = this.expireStaleParticipants(
          now,
          prior.status === "connected" ? participant.participantId : null,
        ) ?? row;
        if (prior.status === "disconnected") {
          const maximum = participant.kind === "agent"
            ? MAX_AGENT_PARTICIPANTS
            : MAX_HUMAN_PARTICIPANTS;
          const connected = this.ctx.storage.sql
            .exec<{ count: number }>(
              `SELECT COUNT(*) AS count FROM browser_room_participant
                WHERE kind = ? AND status = 'connected'`,
              participant.kind,
            )
            .one().count;
          if (connected >= maximum) {
            return failure(
              new ApiError(
                409,
                "participant_capacity_reached",
                `This browser room already has its maximum connected ${participant.kind} participants.`,
              ),
            );
          }
        }
        this.ctx.storage.sql.exec(
          `UPDATE browser_room_participant
              SET status = 'connected', last_seen_at = ?, disconnected_at = NULL
            WHERE participant_id = ?`,
          now,
          participant.participantId,
        );
        row = this.row() ?? row;
        await this.schedule(row);
        return success(this.roomView(row, participant.participantId));
      }

      if (
        typeof invitationToken !== "string" ||
        !/^[0-9A-Za-z_-]{43}$/u.test(invitationToken)
      ) {
        return failure(
          new ApiError(401, "invitation_invalid", "The browser room invitation is invalid."),
        );
      }
      const tokenHash = await hashSecret(invitationToken);
      let current = this.row();
      const joinedAt = Date.now();
      if (
        !current ||
        !sameSessionAudience(current, participant.owner) ||
        current.state !== "active" ||
        current.lease_expires_at <= joinedAt
      ) {
        return failure(new ApiError(404, "session_not_found", "Browser session not found."));
      }
      current = this.expireStaleParticipants(joinedAt) ?? current;
      current = this.refreshExpiredControl(current, joinedAt);

      this.ctx.storage.transactionSync(() => {
        const invitation = this.ctx.storage.sql
          .exec<InvitationRow>(
            "SELECT * FROM browser_room_invitation WHERE token_hash = ?",
            tokenHash,
          )
          .toArray()[0];
        if (
          !invitation ||
          invitation.workspace_id !== current.workspace_id ||
          invitation.expires_at <= joinedAt ||
          invitation.remaining_uses < 1
        ) {
          throw new ApiError(
            401,
            "invitation_invalid",
            "The browser room invitation is invalid or expired.",
          );
        }
        const maximum = participant.kind === "agent"
          ? MAX_AGENT_PARTICIPANTS
          : MAX_HUMAN_PARTICIPANTS;
        const count = this.ctx.storage.sql
          .exec<{ count: number }>(
            `SELECT COUNT(*) AS count FROM browser_room_participant
              WHERE kind = ? AND status = 'connected'`,
            participant.kind,
          )
          .one().count;
        if (count >= maximum) {
          throw new ApiError(
            409,
            "participant_capacity_reached",
            `This browser room already has its maximum connected ${participant.kind} participants.`,
          );
        }
        const consumed = this.ctx.storage.sql.exec(
          `UPDATE browser_room_invitation
              SET remaining_uses = remaining_uses - 1
            WHERE token_hash = ? AND remaining_uses > 0 AND expires_at > ?`,
          tokenHash,
          joinedAt,
        ).rowsWritten;
        if (consumed !== 1) {
          throw new ApiError(
            401,
            "invitation_invalid",
            "The browser room invitation is invalid or expired.",
          );
        }
        const historyCount = this.ctx.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM browser_room_participant",
          )
          .one().count;
        if (historyCount >= MAX_PARTICIPANT_HISTORY) {
          const pruneCount = historyCount - MAX_PARTICIPANT_HISTORY + 1;
          this.ctx.storage.sql.exec(
            `DELETE FROM browser_room_participant
              WHERE participant_id IN (
                SELECT participant_id FROM browser_room_participant
                 WHERE status = 'disconnected' AND is_creator = 0
                 ORDER BY disconnected_at ASC, participant_id ASC
                 LIMIT ?
              )`,
            pruneCount,
          );
          const afterPrune = this.ctx.storage.sql
            .exec<{ count: number }>(
              "SELECT COUNT(*) AS count FROM browser_room_participant",
            )
            .one().count;
          if (afterPrune >= MAX_PARTICIPANT_HISTORY) {
            throw new ApiError(
              409,
              "participant_history_full",
              "The browser room participant history is full.",
            );
          }
        }
        this.insertParticipant(participant, false, joinedAt);
        this.ctx.storage.sql.exec(
          "DELETE FROM browser_room_invitation WHERE token_hash = ? AND remaining_uses = 0",
          tokenHash,
        );
      });
      row = this.row() ?? current;
      await this.schedule(row);
      return success(this.roomView(row, participant.participantId));
    } catch (error) {
      if (error instanceof ApiError) return failure(error);
      logFailure("browser room join failed", error);
      return internalFailure();
    }
  }

  async room(participant: BrowserParticipant): Promise<RpcResult<BrowserRoomView>> {
    try {
      const active = await this.activeToolRow(participant);
      if (!active.ok) return active;
      return success(this.roomView(active.value, participant.participantId));
    } catch (error) {
      if (error instanceof ApiError) return failure(error);
      logFailure("browser room status failed", error);
      return internalFailure();
    }
  }

  async claimControl(
    participant: BrowserParticipant,
    input: BrowserControlClaimInput,
  ): Promise<RpcResult<BrowserControlLease>> {
    try {
      if (
        !Number.isSafeInteger(input.expectedEpoch) ||
        input.expectedEpoch < 1 ||
        !Number.isSafeInteger(input.leaseMs) ||
        input.leaseMs < 60_000 ||
        input.leaseMs > 600_000
      ) {
        return failure(
          new ApiError(400, "invalid_control_claim", "Control claim bounds are invalid."),
        );
      }
      const active = await this.activeToolRow(participant);
      if (!active.ok) return active;
      const now = Date.now();
      const row = this.refreshExpiredControl(active.value, now);
      if (row.control_epoch !== input.expectedEpoch) {
        return failure(
          new ApiError(
            409,
            "stale_control_epoch",
            "Control changed before this claim could be applied.",
          ),
        );
      }
      if (this.mutationInFlight(now)) {
        return failure(
          new ApiError(
            409,
            "browser_mutation_in_flight",
            "Browser control cannot change while a mutation is in flight.",
          ),
        );
      }
      const controller = row.control_participant_id === null
        ? null
        : this.participantRow(row.control_participant_id);
      const sameController = row.control_participant_id === participant.participantId;
      const unowned = row.control_participant_id === null || controller?.status !== "connected";
      const humanTakingAgent = participant.kind === "human" && controller?.kind === "agent";
      const agentTakingSoftHuman = participant.kind === "agent" &&
        controller?.kind === "human" && row.control_expires_at === null;
      if (!sameController && !unowned && !humanTakingAgent && !agentTakingSoftHuman) {
        return failure(
          new ApiError(
            409,
            "control_contended",
            "Another browser participant currently holds control.",
          ),
        );
      }
      const expiresAt = participant.kind === "human"
        ? Math.min(now + input.leaseMs, row.lease_expires_at)
        : null;
      const updated = this.ctx.storage.sql.exec(
        `UPDATE browser_session
            SET control_holder = ?, control_participant_id = ?,
                control_epoch = control_epoch + 1, control_expires_at = ?,
                updated_at = ?
          WHERE singleton = 1 AND state = 'active' AND control_epoch = ?`,
        participant.kind,
        participant.participantId,
        expiresAt,
        now,
        input.expectedEpoch,
      ).rowsWritten;
      if (updated !== 1) {
        return failure(
          new ApiError(
            409,
            "stale_control_epoch",
            "Control changed before this claim could be applied.",
          ),
        );
      }
      const claimed = this.row() ?? row;
      await this.schedule(claimed);
      return success(view(claimed).control);
    } catch (error) {
      if (error instanceof ApiError) return failure(error);
      logFailure("browser room control claim failed", error);
      return internalFailure();
    }
  }

  async releaseControl(
    participant: BrowserParticipant,
    expectedEpoch: number,
  ): Promise<RpcResult<BrowserControlLease>> {
    try {
      const active = await this.activeToolRow(participant);
      if (!active.ok) return active;
      const now = Date.now();
      const row = this.refreshExpiredControl(active.value, now);
      if (
        row.control_epoch !== expectedEpoch ||
        row.control_participant_id !== participant.participantId
      ) {
        return failure(
          new ApiError(
            row.control_epoch !== expectedEpoch ? 409 : 403,
            row.control_epoch !== expectedEpoch
              ? "stale_control_epoch"
              : "control_lease_not_held",
            "This participant does not hold the requested control epoch.",
          ),
        );
      }
      if (this.mutationInFlight(now)) {
        return failure(
          new ApiError(
            409,
            "browser_mutation_in_flight",
            "Browser control cannot be released while a mutation is in flight.",
          ),
        );
      }
      this.ctx.storage.sql.exec(
        `UPDATE browser_session
            SET control_holder = 'agent', control_participant_id = NULL,
                control_epoch = control_epoch + 1, control_expires_at = NULL,
                updated_at = ?
          WHERE singleton = 1 AND state = 'active' AND control_epoch = ?
            AND control_participant_id = ?`,
        now,
        expectedEpoch,
        participant.participantId,
      );
      const released = this.row() ?? row;
      await this.schedule(released);
      return success(view(released).control);
    } catch (error) {
      if (error instanceof ApiError) return failure(error);
      logFailure("browser room control release failed", error);
      return internalFailure();
    }
  }

  async leaveSession(
    participant: BrowserParticipant,
  ): Promise<RpcResult<BrowserParticipantLeaveResult>> {
    try {
      const authenticated = this.connectedParticipant(participant, false);
      if (!authenticated.ok) return authenticated;
      const now = Date.now();
      let row = this.row();
      if (!row) {
        return failure(new ApiError(404, "session_not_found", "Browser session not found."));
      }
      if (
        row.control_participant_id === participant.participantId &&
        this.mutationInFlight(now)
      ) {
        return failure(
          new ApiError(
            409,
            "browser_mutation_in_flight",
            "The controlling participant cannot leave while a mutation is in flight.",
          ),
        );
      }
      this.ctx.storage.sql.exec(
        `UPDATE browser_room_participant
            SET status = 'disconnected', last_seen_at = ?, disconnected_at = ?
          WHERE participant_id = ? AND status = 'connected'`,
        now,
        now,
        participant.participantId,
      );
      this.ctx.storage.sql.exec(
        "DELETE FROM browser_room_invitation WHERE created_by_participant_id = ?",
        participant.participantId,
      );
      if (row.control_participant_id === participant.participantId) {
        const agent = this.connectedController("agent", participant.participantId);
        this.ctx.storage.sql.exec(
          `UPDATE browser_session
              SET control_holder = 'agent', control_participant_id = ?,
                  control_epoch = control_epoch + 1, control_expires_at = NULL,
                  updated_at = ?
            WHERE singleton = 1 AND control_participant_id = ?`,
          agent?.participant_id ?? null,
          now,
          participant.participantId,
        );
        row = this.row() ?? row;
      }
      await this.schedule(row);
      return success({
        sessionId: row.gateway_session_id,
        participantId: participant.participantId,
        status: "disconnected",
        control: view(row).control,
      });
    } catch (error) {
      if (error instanceof ApiError) return failure(error);
      logFailure("browser room leave failed", error);
      return internalFailure();
    }
  }

  async toolGet(
    participant: BrowserParticipant,
  ): Promise<RpcResult<BrowserToolSessionView>> {
    try {
      const active = await this.activeToolRow(participant);
      if (!active.ok) return active;
      const client = await this.ensureCdp(active.value);
      this.drainCdpDebugErrors(client);
      return success(await this.currentPageView(active.value, client));
    } catch (error) {
      return this.toolFailure(error, "status");
    }
  }

  async toolNavigate(
    participant: BrowserParticipant,
    input: BrowserToolNavigateInput,
  ): Promise<RpcResult<BrowserToolSessionView>> {
    let nonce: string | null = null;
    try {
      const url = validateTargetUrl(input.url, this.env.ALLOWED_HOSTS);
      const active = await this.activeToolRow(participant);
      if (!active.ok) return active;
      const client = await this.ensureCdp(active.value);
      const ready = this.row();
      if (!ready) {
        throw new ApiError(404, "session_not_found", "Browser session not found.");
      }
      nonce = this.acquireMutation(ready, participant.participantId, input);
      const navigation = record(await client.send("Page.navigate", { url }));
      if (typeof navigation?.errorText === "string" && navigation.errorText) {
        throw new ApiError(
          502,
          "navigation_failed",
          `The remote browser could not navigate: ${redactStoredText(navigation.errorText, 500)}`,
        );
      }
      await this.waitForDocumentReady(client);
      const afterNavigation = this.row();
      if (
        afterNavigation &&
        afterNavigation.state === "active" &&
        afterNavigation.document_revision === input.expectedDocumentRevision
      ) {
        this.advanceDocumentRevision(url);
      } else if (afterNavigation?.state === "active") {
        this.ctx.storage.sql.exec(
          "UPDATE browser_session SET requested_url = ?, updated_at = ? WHERE singleton = 1",
          url,
          Date.now(),
        );
      }
      this.drainCdpDebugErrors(client);
      return success(await this.currentPageView(ready, client));
    } catch (error) {
      return this.toolFailure(error, "navigate");
    } finally {
      if (nonce !== null) this.releaseMutation(nonce, participant.participantId);
    }
  }

  async toolSnapshot(
    participant: BrowserParticipant,
  ): Promise<RpcResult<BrowserToolSnapshot>> {
    try {
      const active = await this.activeToolRow(participant);
      if (!active.ok) return active;
      const client = await this.ensureCdp(active.value);
      const before = this.row() ?? active.value;
      const revision = before.document_revision;
      this.ctx.storage.sql.exec(
        "DELETE FROM browser_element_ref WHERE document_revision = ?",
        revision,
      );
      const snapshot = await capturePageSnapshot(
        client,
        revision,
        (candidate, documentRevision) =>
          this.registerElement(candidate, documentRevision),
      );
      const latest = this.row();
      if (!latest || latest.state !== "active" || latest.document_revision !== revision) {
        throw new ApiError(
          409,
          "document_changed",
          "The page changed while Remote Browser captured it. Take another snapshot.",
        );
      }
      this.drainCdpDebugErrors(client);
      const url =
        sanitizedNetworkUrl(snapshot.url) ??
        sanitizedNetworkUrl(latest.requested_url);
      if (url === null) {
        throw new ApiError(502, "invalid_cdp_result", "The browser returned an invalid page URL.");
      }
      return success({
        ...snapshot,
        url,
        title: redactStoredText(snapshot.title, 1_000),
        elements: snapshot.elements.map((element) => {
          const hint = `${element.name} ${element.description ?? ""}`;
          return {
            ...element,
            name: redactStoredText(element.name, 1_000),
            description: element.description === null
              ? null
              : redactStoredText(element.description, 1_000) || null,
            value:
              element.value === null || SENSITIVE_ELEMENT_HINT.test(hint)
                ? null
                : redactStoredText(element.value, 1_000) || null,
          };
        }),
        sessionId: latest.gateway_session_id,
        control: view(latest).control,
        telemetryCoverageStartedAt: this.coverageStartedAt(),
      });
    } catch (error) {
      return this.toolFailure(error, "snapshot");
    }
  }

  async toolScreenshot(
    participant: BrowserParticipant,
  ): Promise<RpcResult<BrowserToolScreenshot>> {
    try {
      const active = await this.activeToolRow(participant);
      if (!active.ok) return active;
      const client = await this.ensureCdp(active.value);
      const revision = (this.row() ?? active.value).document_revision;
      const screenshot = await capturePageScreenshot(client);
      const latest = this.row();
      if (!latest || latest.state !== "active" || latest.document_revision !== revision) {
        throw new ApiError(
          409,
          "document_changed",
          "The page changed while Remote Browser captured the screenshot. Try again.",
        );
      }
      this.drainCdpDebugErrors(client);
      return success({
        ...screenshot,
        sessionId: latest.gateway_session_id,
        documentRevision: revision,
        control: view(latest).control,
        telemetryCoverageStartedAt: this.coverageStartedAt(),
      });
    } catch (error) {
      return this.toolFailure(error, "screenshot");
    }
  }

  async toolSelectElement(
    participant: BrowserParticipant,
    input: BrowserToolSelectElementInput,
  ): Promise<RpcResult<BrowserToolSelectedElement>> {
    let nonce: string | null = null;
    try {
      const active = await this.activeToolRow(participant);
      if (!active.ok) return active;
      const client = await this.ensureCdp(active.value);
      const ready = this.row() ?? active.value;
      nonce = this.acquireReadOperation(ready, input);
      let backendNodeId: number;
      let elementRef: string;
      if ("ref" in input && typeof input.ref === "string") {
        elementRef = input.ref;
        backendNodeId = this.elementBackendNodeId(
          input.ref,
          input.expectedDocumentRevision,
        );
      } else {
        backendNodeId = await backendNodeAtViewportRatio(
          client,
          input.xRatio,
          input.yRatio,
        );
        elementRef = await this.registerBackendNodeId(
          backendNodeId,
          input.expectedDocumentRevision,
        );
      }
      const selection = await selectElementRepresentation(
        client,
        backendNodeId,
        input.representation,
      );
      const latest = this.assertToolReadGuard(ready, input, nonce);
      this.drainCdpDebugErrors(client);
      return success({
        ...selection,
        sessionId: latest.gateway_session_id,
        elementRef,
        documentRevision: latest.document_revision,
        control: view(latest).control,
        telemetryCoverageStartedAt: this.coverageStartedAt(),
      });
    } catch (error) {
      return this.toolFailure(error, "select_element");
    } finally {
      if (nonce !== null) this.releaseMutation(nonce, participant.participantId);
    }
  }

  async toolNetwork(
    participant: BrowserParticipant,
    input: BrowserToolPageInput = {},
  ): Promise<RpcResult<BrowserToolPage<BrowserToolNetworkRequest>>> {
    try {
      const page = boundedPageInput(input);
      const active = await this.activeToolRow(participant);
      if (!active.ok) return active;
      const client = await this.ensureCdp(active.value);
      this.drainCdpDebugErrors(client);
      const rows = this.ctx.storage.sql
        .exec<NetworkRow>(
          `SELECT cursor, method, url, resource_type, status, failed,
                  error_text, started_at, finished_at
             FROM browser_network_request
            WHERE cursor > ?
            ORDER BY cursor ASC
            LIMIT ?`,
          page.cursor,
          page.limit + 1,
        )
        .toArray();
      const selected = rows.slice(0, page.limit);
      const state = this.toolState();
      return success({
        items: selected.map((row) => ({
          method: row.method,
          url: row.url,
          resourceType: row.resource_type,
          status: row.status,
          failed: row.failed === null ? null : row.failed === 1,
          errorText: row.error_text,
          startedAt: dateOrNull(row.started_at),
          finishedAt: dateOrNull(row.finished_at),
        })),
        nextCursor: selected.at(-1)?.cursor ?? page.cursor,
        hasMore: rows.length > page.limit,
        telemetryGap: state.telemetry_gap === 1,
        telemetryCoverageStartedAt: dateOrNull(state.telemetry_coverage_started_at),
      });
    } catch (error) {
      return this.toolFailure(error, "network");
    }
  }

  async toolDiagnostics(
    participant: BrowserParticipant,
    input: BrowserToolPageInput = {},
  ): Promise<RpcResult<BrowserToolPage<BrowserToolDiagnostic>>> {
    try {
      const page = boundedPageInput(input);
      const active = await this.activeToolRow(participant);
      if (!active.ok) return active;
      const client = await this.ensureCdp(active.value);
      this.drainCdpDebugErrors(client);
      const rows = this.ctx.storage.sql
        .exec<DiagnosticRow>(
          `SELECT id, kind, severity, message, source, occurred_at
             FROM browser_diagnostic
            WHERE id > ?
            ORDER BY id ASC
            LIMIT ?`,
          page.cursor,
          page.limit + 1,
        )
        .toArray();
      const selected = rows.slice(0, page.limit);
      const state = this.toolState();
      return success({
        items: selected.map((row) => ({
          kind: row.kind,
          severity: row.severity,
          message: row.message,
          source: row.source,
          occurredAt: new Date(row.occurred_at).toISOString(),
        })),
        nextCursor: selected.at(-1)?.id ?? page.cursor,
        hasMore: rows.length > page.limit,
        telemetryGap: state.telemetry_gap === 1,
        telemetryCoverageStartedAt: dateOrNull(state.telemetry_coverage_started_at),
      });
    } catch (error) {
      return this.toolFailure(error, "diagnostics");
    }
  }

  async toolClick(
    participant: BrowserParticipant,
    input: BrowserToolElementInput,
  ): Promise<RpcResult<BrowserToolSessionView>> {
    let nonce: string | null = null;
    try {
      const active = await this.activeToolRow(participant);
      if (!active.ok) return active;
      const client = await this.ensureCdp(active.value);
      const ready = this.row();
      if (!ready) {
        throw new ApiError(404, "session_not_found", "Browser session not found.");
      }
      nonce = this.acquireMutation(ready, participant.participantId, input);
      const backendNodeId = this.elementBackendNodeId(
        input.ref,
        input.expectedDocumentRevision,
      );
      await clickElement(client, backendNodeId);
      this.drainCdpDebugErrors(client);
      return success(await this.currentPageView(ready, client));
    } catch (error) {
      return this.toolFailure(error, "click");
    } finally {
      if (nonce !== null) this.releaseMutation(nonce, participant.participantId);
    }
  }

  async toolFill(
    participant: BrowserParticipant,
    input: BrowserToolFillInput,
  ): Promise<RpcResult<BrowserToolSessionView>> {
    let nonce: string | null = null;
    try {
      const active = await this.activeToolRow(participant);
      if (!active.ok) return active;
      const client = await this.ensureCdp(active.value);
      const ready = this.row();
      if (!ready) {
        throw new ApiError(404, "session_not_found", "Browser session not found.");
      }
      nonce = this.acquireMutation(ready, participant.participantId, input);
      const backendNodeId = this.elementBackendNodeId(
        input.ref,
        input.expectedDocumentRevision,
      );
      // The value is handed directly to CDP and is never stored, logged, or returned.
      await fillElement(client, backendNodeId, input.value);
      this.drainCdpDebugErrors(client);
      return success(await this.currentPageView(ready, client));
    } catch (error) {
      return this.toolFailure(error, "fill");
    } finally {
      if (nonce !== null) this.releaseMutation(nonce, participant.participantId);
    }
  }

  async toolScroll(
    participant: BrowserParticipant,
    input: BrowserToolScrollInput,
  ): Promise<RpcResult<BrowserToolSessionView>> {
    let nonce: string | null = null;
    try {
      const active = await this.activeToolRow(participant);
      if (!active.ok) return active;
      const client = await this.ensureCdp(active.value);
      const ready = this.row();
      if (!ready) {
        throw new ApiError(404, "session_not_found", "Browser session not found.");
      }
      nonce = this.acquireMutation(ready, participant.participantId, input);
      await scrollViewport(
        client,
        input.xRatio,
        input.yRatio,
        input.deltaX,
        input.deltaY,
      );
      this.drainCdpDebugErrors(client);
      return success(await this.currentPageView(ready, client));
    } catch (error) {
      return this.toolFailure(error, "scroll");
    } finally {
      if (nonce !== null) this.releaseMutation(nonce, participant.participantId);
    }
  }

  async toolClose(
    participant: BrowserParticipant,
    waitMs: number,
  ): Promise<RpcResult<BrowserSessionView>> {
    try {
      const active = await this.activeToolRow(participant);
      if (!active.ok) return active;
      const joined = this.participantRow(participant.participantId);
      if (!joined || joined.is_creator !== 1) {
        return failure(
          new ApiError(403, "close_not_allowed", "Only the room creator can close it."),
        );
      }
      if (this.mutationInFlight()) {
        return failure(new ApiError(
          409,
          "browser_mutation_in_flight",
          "The browser session cannot close while a mutation is in flight.",
        ));
      }
      return success(view(await this.closeInternal(active.value, waitMs, "requested")));
    } catch (error) {
      return this.toolFailure(error, "close");
    }
  }

  async close(
    auth: SessionRpcAuth,
    waitMs: number,
  ): Promise<RpcResult<BrowserSessionView>> {
    try {
      const authenticated = await this.authenticatedRow(auth);
      if (!authenticated.ok) return authenticated;
      if (this.mutationInFlight()) {
        return failure(
          new ApiError(
            409,
            "browser_mutation_in_flight",
            "The browser session cannot close while a mutation is in flight.",
          ),
        );
      }
      const closed = await this.closeInternal(
        authenticated.value,
        waitMs,
        "requested",
      );
      return success(view(closed));
    } catch (error) {
      if (error instanceof ApiError) return failure(error);
      logFailure("browser session close failed", error);
      return internalFailure();
    }
  }

  async alarm(): Promise<void> {
    try {
      const existing = this.row();
      if (!existing) {
        await this.ctx.storage.deleteAlarm();
        return;
      }
      const row = this.refreshExpiredControl(existing, Date.now());
      if (row.state === "closing" || row.lease_expires_at <= Date.now()) {
        await this.closeInternal(row, 5_000, "expired");
        return;
      }
      await this.schedule(row);
    } catch (error) {
      logFailure("browser session expiry alarm failed", error);
      await this.ctx.storage.setAlarm(Date.now() + 30_000);
    }
  }
}
