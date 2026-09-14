import {
  parsePublicBookingProfilePublication,
  parsePublicBookingProfileUnpublication,
  publishPublicBookingProfile,
  PublicBookingPublicationError,
  unpublishPublicBookingProfile,
} from "./public-booking-publication";
import { loadPublicBookingBusyIntervals } from "./public-booking-busy";
import {
  enforcePublicBookingRateLimit,
  PublicBookingRateLimitError,
} from "./public-booking-rate-limit";
import {
  assertPublicPageStillCurrent,
  availabilityQueryWindow,
  buildPublicAvailability,
  parsePublicBookingPagePath,
  preparePublicSlotSigningKey,
  projectPublicBookingPage,
  publicAvailabilityQuery,
  PublicBookingReadError,
  resolvePublishedPublicBookingPage,
  verifyPublicSlotToken,
} from "./public-booking-read";
import {
  OrganizerAuthError,
  resolveOrganizerScope,
  type OrganizerAuthEnv,
} from "./organizer-auth";
import {
  createPublicGoogleBookingProvider,
  type ScopeFirstGoogleBookingCommitInput,
  type ScopeFirstGoogleBookingRecoveryInput,
} from "./public-booking-google-provider";
import {
  createPublicGoogleBookingManagementProvider,
  type ScopeFirstGoogleCancellationInput,
  type ScopeFirstGoogleRescheduleInput,
} from "./public-booking-google-management";
import {
  cancelPublicBooking,
  parsePublicBookingCancelRequest,
  parsePublicBookingManagementToken,
  parsePublicBookingRescheduleRequest,
  PublicBookingManagementError,
  readPublicBookingManagement,
  reschedulePublicBooking,
  type PublicBookingManagementDependencies,
  type PublicBookingManagementProvider,
  type PublicBookingManagementRecord,
  type PublicBookingManagementProviderReceipt,
  type PublicBookingManagementProviderRecovery,
  type PublicBookingManagementProviderResult,
} from "./public-booking-management";
import {
  D1PublicBookingManagementStore,
  PublicBookingManagementStoreError,
} from "./public-booking-management-store";
import {
  createPublicBookingManagementEmailPort,
  deliverPublicBookingEmailOutboxSafely,
  D1PublicBookingEmailOutbox,
  PublicBookingEmailError,
  type PublicBookingEmailEnqueueInput,
} from "./public-booking-email";
import {
  createPublicBooking,
  parsePublicBookingRequest,
  PublicBookingCreateError,
  publicBookingProviderOperationId,
  type PublicBookingProvider,
  type PublicProviderBookingCommit,
  type PublicProviderBookingReceipt,
  type PublicProviderBookingRecovery,
} from "./public-booking-create";
import {
  D1PublicBookingAttemptStore,
  D1PublicBookingManagementTokenIssuer,
  D1PublicBookingSerializationBoundary,
  PublicBookingStoreError,
} from "./public-booking-store";
import {
  publicClientIp,
  publicTurnstileVerificationId,
  PublicTurnstileError,
  verifyPublicBookingTurnstile,
} from "./public-booking-turnstile";

type CalendarProvider =
  | "google"
  | "microsoft"
  | "icloud"
  | "caldav"
  | "exchange"
  | "ics";

type CalendarRole = "owner" | "writer" | "reader" | "free-busy";
type ConnectionStatus = "pending" | "connected" | "attention" | "read-only";

interface CalendarGatewayEnv extends Env {
  readonly LOCAL_DEVELOPMENT?: string;
  readonly LEGACY_OWNER_PRINCIPAL_ID?: string;
  readonly TOKEN_ENCRYPTION_KEY?: string;
  readonly GOOGLE_CLIENT_ID?: string;
  readonly GOOGLE_CLIENT_SECRET?: string;
  readonly MICROSOFT_CLIENT_ID?: string;
  readonly MICROSOFT_CLIENT_SECRET?: string;
  readonly PUBLIC_TURNSTILE_SITE_KEY?: string;
  readonly TURNSTILE_SECRET_KEY?: string;
  readonly PUBLIC_BOOKING_SLOT_SIGNING_KEY?: string;
  readonly PUBLIC_BOOKING_MANAGEMENT_SECRET?: string;
  readonly PUBLIC_BOOKING_EMAIL_FROM?: string;
  readonly PUBLIC_BOOKING_EMAIL_FROM_NAME?: string;
}

interface ConnectionRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly principal_id: string | null;
  readonly provider: CalendarProvider;
  readonly mode: "local" | "oauth" | "credentials" | "subscription";
  readonly label: string;
  readonly status: ConnectionStatus;
  readonly credential_ciphertext: string | null;
  readonly token_expires_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly last_synced_at: string | null;
}

interface CalendarRow {
  readonly id: string;
  readonly connection_id: string;
  readonly provider_calendar_id: string;
  readonly name: string;
  readonly color: string;
  readonly role: CalendarRole;
  readonly writable: number;
  readonly freshness: "live" | "delayed" | "stale";
  readonly is_primary: number;
}

interface CalendarExclusionRow {
  readonly calendar_id: string;
  readonly provider_calendar_id: string;
}

interface OAuthStateRow {
  readonly connection_id: string;
  readonly workspace_id: string;
  readonly principal_id: string | null;
  readonly provider: "google" | "microsoft";
  readonly verifier_ciphertext: string;
  readonly expires_at: string;
}

interface TokenSecret {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly expiresAt: string;
  readonly tokenType: string;
  readonly scope?: string;
}

interface DiscoveredCalendar {
  readonly providerCalendarId: string;
  readonly name: string;
  readonly color: string;
  readonly role: CalendarRole;
  readonly writable: boolean;
  readonly freshness: "live" | "delayed" | "stale";
  readonly primary: boolean;
  readonly raw: Readonly<Record<string, unknown>>;
}

interface DiscoveryResult {
  readonly label: string;
  readonly calendars: readonly DiscoveredCalendar[];
}

interface OAuthProviderConfig {
  readonly id: "google" | "microsoft";
  readonly clientId: string;
  readonly clientSecret: string;
  readonly authorizeUrl: string;
  readonly tokenUrl: string;
  readonly scopes: readonly string[];
}

type ProviderFetch = typeof fetch;

interface GatewayCalendarEvent {
  readonly id: string;
  readonly calendarId: string;
  readonly title: string;
  readonly start: string;
  readonly end: string;
  readonly kind: "meeting" | "work-block" | "hold" | "focus";
  readonly status: "pending" | "confirmed" | "declined" | "cancelled";
  readonly location:
    | "tap-room"
    | "tap-huddle"
    | "google-meet"
    | "microsoft-teams"
    | "zoom"
    | "webex"
    | "goto"
    | "phone"
    | "physical"
    | "custom"
    | null;
  readonly attendees: readonly {
    readonly id: string;
    readonly name: string;
    readonly email: string;
    readonly kind: "tap" | "external";
    readonly required: boolean;
  }[];
  readonly busy: boolean;
  readonly allDay: boolean;
}

interface EventQueryError {
  readonly calendarId: string;
  readonly code: string;
  readonly message: string;
}

interface EventQueryInput {
  readonly timeMin: string;
  readonly timeMax: string;
  readonly calendarIds: readonly string[];
}

interface EventQueryBudget {
  remaining: number;
  truncated: boolean;
}

interface CalendarEventQueryResult {
  readonly calendarId: string;
  readonly events: readonly GatewayCalendarEvent[];
  readonly synced: boolean;
  readonly errors: readonly EventQueryError[];
}

interface CalendarSyncStateRow {
  readonly workspace_id: string;
  readonly connection_id: string;
  readonly calendar_id: string;
  readonly active_generation: string;
  readonly cache_revision: number;
  readonly sync_token: string | null;
  readonly cache_time_min: string | null;
  readonly cache_time_max: string | null;
  readonly freshness: "pending" | "fresh" | "stale" | "error";
  readonly last_attempt_at: string | null;
  readonly last_success_at: string | null;
  readonly next_sync_at: string;
  readonly error_code: string | null;
  readonly error_message: string | null;
  readonly consecutive_failures: number;
  readonly lease_until: string | null;
  readonly current_watch_channel_id: string | null;
  readonly watch_expiration_at: string | null;
  readonly last_notification_at: string | null;
}

interface CachedEventRow {
  readonly calendar_id: string;
  readonly payload_json: string;
}

interface AvailabilityConfirmationRow {
  readonly request_hash: string;
  readonly response_json: string;
}

interface ProviderBookingCommitRow {
  readonly principal_id?: string | null;
  readonly request_hash: string;
  readonly request_json?: string | null;
  readonly destination_calendar_id: string;
  readonly provider_event_id: string;
  readonly booking_kind: "meeting" | "approval-hold" | "work-block";
  readonly start_at?: string;
  readonly end_at?: string;
  readonly state: "pending" | "committed" | "rejected";
  readonly response_json: string | null;
  readonly resolution_status?: "approved" | "declined" | null;
  readonly conflict_calendar_ids_json?: string | null;
  readonly hold_expires_at?: string | null;
  readonly hold_expired_at?: string | null;
  readonly resolution_request_hash?: string | null;
  readonly resolution_response_json?: string | null;
  readonly resolution_updated_at?: string | null;
  readonly updated_at?: string;
}

interface ProviderBookingCommitInput extends EventQueryInput {
  readonly destinationCalendarId: string;
  /**
   * Provider and TAP-conflict validation use this possibly-expanded range.
   * The provider event itself is still written with timeMin/timeMax.
   */
  readonly conflictTimeMin: string;
  readonly conflictTimeMax: string;
  readonly idempotencyKey: string;
  readonly title: string;
  readonly description: string | null;
  readonly location: string | null;
  readonly bookingKind: "meeting" | "approval-hold" | "work-block";
  readonly attendeeEmails: readonly string[];
  readonly conferenceProvider: "none" | "google-meet";
  readonly expiresAt: string | null;
}

interface ProviderBookingResolutionRow {
  readonly principal_id?: string | null;
  readonly request_hash: string;
  readonly decision: "approve" | "decline";
  readonly state: "pending" | "committed";
  readonly response_json: string | null;
  readonly created_at: string;
}

interface ExpiringApprovalHoldRow extends ProviderBookingCommitRow {
  readonly workspace_id: string;
  readonly principal_id: string;
  readonly idempotency_key: string;
}

interface ProviderBookingResolutionInput {
  readonly idempotencyKey: string;
  readonly decision: "approve" | "decline";
  readonly title: string | null;
  readonly description: string | null;
  readonly location: string | null;
  readonly attendeeEmails: readonly string[];
  readonly attendeeEmailsProvided: boolean;
  readonly conferenceProvider: "none" | "google-meet";
  readonly currentConflictCalendarIds: readonly string[];
}

interface CalendarWatchChannelRow {
  readonly channel_id: string;
  readonly workspace_id: string;
  readonly connection_id: string;
  readonly calendar_id: string;
  readonly token_hash: string;
  readonly resource_id: string;
  readonly expiration_at: string;
  readonly principal_id: string;
}

interface CalendarSyncTarget extends CalendarRow {
  readonly workspace_id: string;
  readonly principal_id: string;
  readonly provider: CalendarProvider;
  readonly mode: ConnectionRow["mode"];
  readonly credential_ciphertext: string | null;
  readonly token_expires_at: string | null;
  readonly connection_label: string;
  readonly connection_status: ConnectionStatus;
  readonly connection_created_at: string;
  readonly connection_updated_at: string;
  readonly connection_last_synced_at: string | null;
}

interface CacheSyncOutcome {
  readonly calendarId: string;
  readonly synced: boolean;
  readonly skipped: boolean;
  readonly fullSync: boolean;
  readonly resyncedAfterTokenExpiry: boolean;
  readonly changedEvents: number;
  readonly error?: EventQueryError;
}

const MAX_BODY_BYTES = 256 * 1024;
const MAX_PROVIDER_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_PROVIDER_PAGES = 100;
const MAX_EVENT_PROVIDER_PAGES = 20;
const MAX_EVENT_QUERY_CALENDARS = 100;
const MAX_EVENT_QUERY_EVENTS = 5_000;
const MAX_EVENT_ATTENDEES = 10;
const MAX_EVENT_QUERY_RANGE_MS = 93 * 24 * 60 * 60 * 1000;
const EVENT_PAGE_SIZE = 250;
const CACHE_EVENT_PAGE_SIZE = 500;
const MAX_CACHE_SYNC_EVENTS = 10_000;
const EVENT_QUERY_CONCURRENCY = 4;
const CACHE_INITIAL_HISTORY_MS = 31 * 24 * 60 * 60 * 1000;
const CACHE_ROLLING_FUTURE_MS = 180 * 24 * 60 * 60 * 1000;
const CACHE_ROLLING_REBUILD_MARGIN_MS = 14 * 24 * 60 * 60 * 1000;
const CACHE_BOOTSTRAP_FUTURE_WINDOWS_MS = [
  CACHE_ROLLING_FUTURE_MS,
  90 * 24 * 60 * 60 * 1000,
  30 * 24 * 60 * 60 * 1000,
] as const;
const CACHE_FRESH_MS = 2 * 60 * 1000;
const CACHE_REPAIR_INTERVAL_MS = 5 * 60 * 1000;
const CACHE_ERROR_RETRY_BASE_MS = 5 * 60 * 1000;
const CACHE_SYNC_LEASE_MS = 2 * 60 * 1000;
const CACHE_LEASE_WAIT_ATTEMPTS = 20;
const CACHE_LEASE_WAIT_MS = 250;
const BOOKING_COMMIT_LEASE_MS = 2 * 60 * 1000;
const MAX_BOOKING_ATTENDEES = 100;
const CACHE_WRITE_BATCH_SIZE = 75;
const CACHE_REPAIR_BATCH_SIZE = 20;
const WATCH_RENEWAL_WINDOW_MS = 24 * 60 * 60 * 1000;
const WATCH_TTL_SECONDS = 7 * 24 * 60 * 60;
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const TOKEN_REFRESH_SKEW_MS = 60 * 1000;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,254}$/u;
const COLOR = /^#[0-9a-fA-F]{6}$/u;
const RFC3339_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;
const PROVIDERS = [
  "google",
  "microsoft",
  "icloud",
  "caldav",
  "exchange",
  "ics",
] as const;

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
  }
}

class ProviderHttpError extends ApiError {
  constructor(
    readonly providerStatus: number,
    message: string,
  ) {
    super(502, "provider_request_failed", message);
  }
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const normalizedTrustedHttpsUrl = (
  value: unknown,
  allowed: (url: URL) => boolean,
): string | null => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 4_096 ||
    value.trim() !== value
  ) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !allowed(url)
    ) return null;
    return url.href;
  } catch {
    return null;
  }
};

export const normalizeGoogleCalendarHtmlUrl = (value: unknown): string | null =>
  normalizedTrustedHttpsUrl(value, url =>
    (url.hostname === "calendar.google.com" &&
      (url.pathname.startsWith("/calendar/") ||
        url.pathname === "/event" ||
        url.pathname.startsWith("/event/"))) ||
    (url.hostname === "www.google.com" && url.pathname.startsWith("/calendar/"))
  );

export const normalizeGoogleMeetJoinUrl = (value: unknown): string | null =>
  normalizedTrustedHttpsUrl(value, url =>
    url.hostname === "meet.google.com" && url.pathname !== "/"
  );

const googleMeetJoinUrl = (value: Readonly<Record<string, unknown>>): string | null => {
  const hangoutLink = normalizeGoogleMeetJoinUrl(value.hangoutLink);
  if (hangoutLink) return hangoutLink;
  const conferenceData = isRecord(value.conferenceData) ? value.conferenceData : null;
  const entryPoints = conferenceData && Array.isArray(conferenceData.entryPoints)
    ? conferenceData.entryPoints
    : [];
  for (const candidate of entryPoints) {
    if (isRecord(candidate) && candidate.entryPointType === "video") {
      const joinUrl = normalizeGoogleMeetJoinUrl(candidate.uri);
      if (joinUrl) return joinUrl;
    }
  }
  return null;
};

const googleMeetConferenceRequested = (
  value: Readonly<Record<string, unknown>>,
): boolean => {
  if (googleMeetJoinUrl(value)) return true;
  const conferenceData = isRecord(value.conferenceData) ? value.conferenceData : null;
  const createRequest = conferenceData && isRecord(conferenceData.createRequest)
    ? conferenceData.createRequest
    : null;
  const solutionKey = createRequest && isRecord(createRequest.conferenceSolutionKey)
    ? createRequest.conferenceSolutionKey
    : null;
  return solutionKey?.type === "hangoutsMeet";
};

const requiredText = (
  value: unknown,
  field: string,
  maximumLength = 255,
): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApiError(400, "invalid_request", `${field} is required.`);
  }
  const normalized = value.trim();
  if (normalized.length > maximumLength) {
    throw new ApiError(400, "invalid_request", `${field} is too long.`);
  }
  return normalized;
};

const identifier = (value: unknown, field: string): string => {
  const normalized = requiredText(value, field);
  if (!IDENTIFIER.test(normalized)) {
    throw new ApiError(400, "invalid_request", `${field} is invalid.`);
  }
  return normalized;
};

const provider = (value: unknown): CalendarProvider => {
  if (typeof value !== "string" || !PROVIDERS.includes(value as CalendarProvider)) {
    throw new ApiError(400, "invalid_provider", "The calendar provider is invalid.");
  }
  return value as CalendarProvider;
};

const json = (body: unknown, status = 200, headers: HeadersInit = {}): Response =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    },
  });

const allowedOrigins = (env: CalendarGatewayEnv): ReadonlySet<string> =>
  new Set(
    env.ALLOWED_ORIGINS.split(",")
      .map(item => item.trim())
      .filter(Boolean),
  );

function corsHeaders(request: Request, env: CalendarGatewayEnv): HeadersInit {
  const origin = request.headers.get("Origin");
  if (!origin) return {};
  if (!allowedOrigins(env).has(origin)) {
    throw new ApiError(403, "origin_denied", "This origin is not allowed.");
  }
  return {
    "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version, X-TAP-Principal-Id, X-TAP-Workspace-Id",
    "Access-Control-Allow-Methods": "DELETE, GET, OPTIONS, POST",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

async function readJson(request: Request): Promise<Readonly<Record<string, unknown>>> {
  if (!request.headers.get("Content-Type")?.toLowerCase().includes("application/json")) {
    throw new ApiError(415, "unsupported_media_type", "Use application/json.");
  }
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new ApiError(413, "payload_too_large", "The request body is too large.");
  }
  if (!request.body) {
    throw new ApiError(400, "invalid_json", "A JSON body is required.");
  }
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > MAX_BODY_BYTES) {
      await reader.cancel("request body too large");
      throw new ApiError(413, "payload_too_large", "The request body is too large.");
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  text += decoder.decode();
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) throw new Error("not an object");
    return parsed;
  } catch {
    throw new ApiError(400, "invalid_json", "The request body must be a JSON object.");
  }
}

function eventQueryInput(body: Readonly<Record<string, unknown>>): EventQueryInput {
  const parseInstant = (value: unknown, field: string): string => {
    const text = requiredText(value, field, 64);
    const timestamp = Date.parse(text);
    if (!RFC3339_INSTANT.test(text) || !Number.isFinite(timestamp)) {
      throw new ApiError(
        400,
        "invalid_time_range",
        `${field} must be an RFC 3339 timestamp with a time-zone offset.`,
      );
    }
    return new Date(timestamp).toISOString();
  };
  const timeMin = parseInstant(body.timeMin, "timeMin");
  const timeMax = parseInstant(body.timeMax, "timeMax");
  const minimum = Date.parse(timeMin);
  const maximum = Date.parse(timeMax);
  if (maximum <= minimum) {
    throw new ApiError(400, "invalid_time_range", "timeMax must be later than timeMin.");
  }
  if (maximum - minimum > MAX_EVENT_QUERY_RANGE_MS) {
    throw new ApiError(
      400,
      "event_range_too_large",
      "Event queries may span at most 93 days.",
    );
  }
  if (
    !Array.isArray(body.calendarIds) ||
    body.calendarIds.length === 0 ||
    body.calendarIds.length > MAX_EVENT_QUERY_CALENDARS
  ) {
    throw new ApiError(
      400,
      "invalid_calendar_ids",
      `Choose between 1 and ${MAX_EVENT_QUERY_CALENDARS} calendars.`,
    );
  }
  const calendarIds = body.calendarIds.map((value, index) =>
    identifier(value, `calendarIds[${index}]`)
  );
  if (new Set(calendarIds).size !== calendarIds.length) {
    throw new ApiError(400, "invalid_calendar_ids", "Calendar identifiers must be unique.");
  }
  return { timeMin, timeMax, calendarIds };
}

interface CalendarPrincipalScope {
  readonly workspace: string;
  readonly principal: string;
}

function requireLocalDevelopment(env: CalendarGatewayEnv): void {
  if (env.LOCAL_DEVELOPMENT !== "true") {
    throw new ApiError(
      404,
      "local_connector_unavailable",
      "The local Calendar connector is unavailable.",
    );
  }
}

async function bindLegacyLocalOwner(
  env: CalendarGatewayEnv,
  scope: CalendarPrincipalScope,
): Promise<void> {
  const legacy = await env.CALENDAR_DB.prepare(
    `SELECT (
       EXISTS(
         SELECT 1 FROM calendar_connections
          WHERE workspace_id = ? AND principal_id IS NULL
       ) OR EXISTS(
         SELECT 1 FROM oauth_states
          WHERE workspace_id = ? AND principal_id IS NULL
       ) OR EXISTS(
         SELECT 1 FROM availability_confirmations
          WHERE workspace_id = ? AND principal_id IS NULL
       ) OR EXISTS(
         SELECT 1 FROM provider_booking_commits
          WHERE workspace_id = ? AND principal_id IS NULL
       ) OR EXISTS(
         SELECT 1 FROM provider_booking_commit_locks
          WHERE workspace_id = ? AND principal_id IS NULL
       ) OR EXISTS(
         SELECT 1 FROM provider_booking_resolutions
          WHERE workspace_id = ? AND principal_id IS NULL
       )
     ) AS present`,
  )
    .bind(
      scope.workspace,
      scope.workspace,
      scope.workspace,
      scope.workspace,
      scope.workspace,
      scope.workspace,
    )
    .first<number>("present");
  if (!legacy) return;

  const configuredOwner = env.LEGACY_OWNER_PRINCIPAL_ID?.trim() ?? "";
  if (!configuredOwner) {
    throw new ApiError(
      409,
      "legacy_owner_unconfigured",
      "Existing local Calendar data has no TAP owner. Set LEGACY_OWNER_PRINCIPAL_ID to the original owner's canonical TAP user id before opening Calendar.",
    );
  }
  if (configuredOwner !== scope.principal) {
    throw new ApiError(
      403,
      "legacy_owner_mismatch",
      "Existing local Calendar data is reserved for its configured TAP owner.",
    );
  }

  await env.CALENDAR_DB.batch([
    env.CALENDAR_DB.prepare(
      `UPDATE calendar_connections SET principal_id = ?
        WHERE workspace_id = ? AND principal_id IS NULL`,
    ).bind(scope.principal, scope.workspace),
    env.CALENDAR_DB.prepare(
      `UPDATE oauth_states SET principal_id = ?
        WHERE workspace_id = ? AND principal_id IS NULL
          AND EXISTS (
            SELECT 1 FROM calendar_connections
             WHERE calendar_connections.id = oauth_states.connection_id
               AND calendar_connections.workspace_id = oauth_states.workspace_id
               AND calendar_connections.principal_id = ?
          )`,
    ).bind(scope.principal, scope.workspace, scope.principal),
    env.CALENDAR_DB.prepare(
      `UPDATE availability_confirmations SET principal_id = ?
        WHERE workspace_id = ? AND principal_id IS NULL`,
    ).bind(scope.principal, scope.workspace),
    env.CALENDAR_DB.prepare(
      `UPDATE provider_booking_commits SET principal_id = ?
        WHERE workspace_id = ? AND principal_id IS NULL
          AND EXISTS (
            SELECT 1 FROM provider_calendars
            INNER JOIN calendar_connections
              ON calendar_connections.id = provider_calendars.connection_id
             WHERE provider_calendars.id = provider_booking_commits.destination_calendar_id
               AND calendar_connections.workspace_id = provider_booking_commits.workspace_id
               AND calendar_connections.principal_id = ?
          )`,
    ).bind(scope.principal, scope.workspace, scope.principal),
    env.CALENDAR_DB.prepare(
      `UPDATE provider_booking_commit_locks SET principal_id = ?
        WHERE workspace_id = ? AND principal_id IS NULL
          AND EXISTS (
            SELECT 1 FROM provider_calendars
            INNER JOIN calendar_connections
              ON calendar_connections.id = provider_calendars.connection_id
             WHERE provider_calendars.id = provider_booking_commit_locks.destination_calendar_id
               AND calendar_connections.workspace_id = provider_booking_commit_locks.workspace_id
               AND calendar_connections.principal_id = ?
          )`,
    ).bind(scope.principal, scope.workspace, scope.principal),
    env.CALENDAR_DB.prepare(
      `UPDATE provider_booking_resolutions SET principal_id = ?
        WHERE workspace_id = ? AND principal_id IS NULL
          AND EXISTS (
            SELECT 1 FROM provider_booking_commits
             WHERE provider_booking_commits.workspace_id = provider_booking_resolutions.workspace_id
               AND provider_booking_commits.principal_id = ?
               AND provider_booking_commits.idempotency_key =
                   provider_booking_resolutions.booking_idempotency_key
          )`,
    ).bind(scope.principal, scope.workspace, scope.principal),
  ]);
}

async function principalScope(
  request: Request,
  env: CalendarGatewayEnv,
): Promise<CalendarPrincipalScope> {
  let scope: CalendarPrincipalScope;
  try {
    // Wrangler exposes entrypoint service bindings as the generic `Service`
    // type. At runtime this binding is the declared AuthzRpc entrypoint whose
    // typed method is described by OrganizerAuthEnv.
    const resolved = await resolveOrganizerScope(
      request,
      env as unknown as OrganizerAuthEnv,
    );
    scope = {
      workspace: resolved.workspaceId,
      principal: resolved.principalId,
    };
  } catch (error) {
    if (error instanceof OrganizerAuthError) {
      throw new ApiError(error.status, error.code, error.message);
    }
    throw error;
  }
  await bindLegacyLocalOwner(env, scope);
  return scope;
}

function publicBookingBaseUrl(env: CalendarGatewayEnv): string {
  const configured = env.PUBLIC_BOOKING_BASE_URL?.trim() ?? "";
  if (!configured) {
    throw new ApiError(
      503,
      "public_booking_unconfigured",
      "PUBLIC_BOOKING_BASE_URL is required before booking pages can be published.",
    );
  }
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new ApiError(
      503,
      "public_booking_unconfigured",
      "PUBLIC_BOOKING_BASE_URL must be an exact HTTPS origin.",
    );
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new ApiError(
      503,
      "public_booking_unconfigured",
      "PUBLIC_BOOKING_BASE_URL must be an exact HTTPS origin.",
    );
  }
  return url.origin;
}

function publicationApiError(error: unknown): never {
  if (error instanceof PublicBookingPublicationError) {
    throw new ApiError(
      error.status,
      error.code,
      error.message,
      error.currentGeneration === undefined
        ? undefined
        : { currentGeneration: error.currentGeneration },
    );
  }
  throw error;
}

async function publishBookingProfile(
  request: Request,
  env: CalendarGatewayEnv,
): Promise<Response> {
  const scope = await principalScope(request, env);
  const body = await readJson(request);
  try {
    const publication = parsePublicBookingProfilePublication(body);
    const result = await publishPublicBookingProfile({
      database: env.CALENDAR_DB,
      scope,
      input: publication,
      publicBaseUrl: publicBookingBaseUrl(env),
    });
    return json({ publication: result });
  } catch (error) {
    return publicationApiError(error);
  }
}

async function unpublishBookingProfile(
  request: Request,
  env: CalendarGatewayEnv,
): Promise<Response> {
  const scope = await principalScope(request, env);
  const body = await readJson(request);
  try {
    const publication = parsePublicBookingProfileUnpublication(body);
    const result = await unpublishPublicBookingProfile({
      database: env.CALENDAR_DB,
      scope,
      input: publication,
    });
    return json({ publication: result });
  } catch (error) {
    return publicationApiError(error);
  }
}

function publicBookingReadApiError(error: unknown): never {
  if (error instanceof PublicBookingRateLimitError) {
    throw new ApiError(error.status, error.code, error.message, {
      retryable: error.retryable,
    });
  }
  if (error instanceof PublicBookingReadError) {
    throw new ApiError(
      error.status,
      error.code,
      error.message,
      error.status === 409 || error.status >= 500
        ? { retryable: true }
        : undefined,
    );
  }
  throw error;
}

const requiredPublicBookingConfiguration = (
  value: string | undefined,
): string => {
  const configured = value?.trim() ?? "";
  if (!configured) {
    throw new ApiError(
      503,
      "public_booking_unconfigured",
      "Public booking is not configured.",
      { retryable: true },
    );
  }
  return configured;
};

const publicBookingEmailOutbox = (
  env: CalendarGatewayEnv,
): D1PublicBookingEmailOutbox => new D1PublicBookingEmailOutbox(
  env.CALENDAR_DB,
  {
    // Web Crypto methods require their receiver in Workers.
    id: () => crypto.randomUUID(),
  },
);

async function enqueuePublicBookingNotice(
  env: CalendarGatewayEnv,
  input: PublicBookingEmailEnqueueInput,
): Promise<void> {
  try {
    await publicBookingEmailOutbox(env).enqueue(input);
  } catch {
    throw new ApiError(
      503,
      "booking_notice_pending",
      "The booking changed, but its confirmation is still being prepared. Retry the same request.",
      { retryable: true },
    );
  }
}

async function reconcilePublicApprovalResolution(
  env: CalendarGatewayEnv,
  scope: CalendarPrincipalScope,
  providerOperationId: string,
  targetStatus: "confirmed" | "declined" | "expired",
  transitionAt: number,
): Promise<void> {
  const store = new D1PublicBookingManagementStore(env.CALENDAR_DB, {
    now: () => transitionAt,
  });
  const result = await store.transitionApproval({
    scope,
    providerOperationId,
    targetStatus,
  });
  // Organizer-created approval holds do not have an anonymous guest-management
  // credential and intentionally bypass this public lifecycle projection.
  if (result.kind === "not-found") return;
  if (result.kind === "transitioned" || result.kind === "existing") {
    await enqueuePublicBookingNotice(env, result.notice);
    return;
  }
  throw new ApiError(
    503,
    "public_approval_state_pending",
    "The approval changed, but its guest status is still being reconciled. Retry the same request.",
    { retryable: true },
  );
}

async function getPublishedPublicBookingPage(
  route: NonNullable<ReturnType<typeof parsePublicBookingPagePath>>,
  env: CalendarGatewayEnv,
): Promise<Response> {
  try {
    const resolved = await resolvePublishedPublicBookingPage(
      env.CALENDAR_DB.withSession("first-primary"),
      route.profileSlug,
      route.eventTypeSlug,
    );
    return json(projectPublicBookingPage(resolved, {
      baseUrl: publicBookingBaseUrl(env),
      turnstileSiteKey: requiredPublicBookingConfiguration(
        env.PUBLIC_TURNSTILE_SITE_KEY,
      ),
      now: Date.now(),
    }));
  } catch (error) {
    return publicBookingReadApiError(error);
  }
}

async function getPublishedPublicBookingAvailability(
  request: Request,
  route: NonNullable<ReturnType<typeof parsePublicBookingPagePath>>,
  url: URL,
  env: CalendarGatewayEnv,
  providerFetch: ProviderFetch,
): Promise<Response> {
  try {
    const requestNow = Date.now();
    await enforcePublicBookingRateLimit({
      limiter: env.PUBLIC_AVAILABILITY_RATE_LIMITER,
      localDevelopment: env.LOCAL_DEVELOPMENT === "true",
      request,
      resource: `availability:${route.profileSlug}/${route.eventTypeSlug}`,
    });
    const query = publicAvailabilityQuery(url.searchParams);
    const signingKey = await preparePublicSlotSigningKey(
      requiredPublicBookingConfiguration(env.PUBLIC_BOOKING_SLOT_SIGNING_KEY),
    );
    const resolved = await resolvePublishedPublicBookingPage(
      env.CALENDAR_DB.withSession("first-primary"),
      route.profileSlug,
      route.eventTypeSlug,
    );
    const window = availabilityQueryWindow(resolved, query, requestNow);
    let busyIntervals: readonly PublicBusyInterval[] = [];
    if (window) {
      const input: EventQueryInput = {
        ...window,
        calendarIds: resolved.privateSnapshot.conflictCalendarIds,
      };
      try {
        const [providerBusy, committedBusy] = await Promise.all([
          queryPublicGoogleBusyIntervals(env, {
            workspace: resolved.privateSnapshot.workspaceId,
            principal: resolved.privateSnapshot.principalId,
          }, input, providerFetch),
          loadPublicBookingBusyIntervals({
            database: env.CALENDAR_DB.withSession("first-primary"),
            workspace: resolved.privateSnapshot.workspaceId,
            principal: resolved.privateSnapshot.principalId,
            conflictCalendarIds: resolved.privateSnapshot.conflictCalendarIds,
            timeMin: window.timeMin,
            timeMax: window.timeMax,
          }),
        ]);
        busyIntervals = [...providerBusy, ...committedBusy];
      } catch (error) {
        if (error instanceof ApiError && error.code === "public_availability_unavailable") {
          throw new ApiError(
            error.status,
            error.code,
            error.message,
            { retryable: true },
          );
        }
        throw new ApiError(
          503,
          "public_availability_unavailable",
          "Availability could not be checked. Try again shortly.",
          { retryable: true },
        );
      }
    }
    // Use a new primary-anchored session after provider I/O so a republish or
    // unpublish that happened while checking calendars invalidates this read.
    await assertPublicPageStillCurrent(
      env.CALENDAR_DB.withSession("first-primary"),
      resolved,
    );
    return json(await buildPublicAvailability(
      resolved,
      query,
      busyIntervals,
      signingKey,
      requestNow,
    ));
  } catch (error) {
    return publicBookingReadApiError(error);
  }
}

function publicBookingMutationApiError(error: unknown): never {
  if (error instanceof PublicBookingCreateError || error instanceof PublicTurnstileError) {
    throw new ApiError(
      error.status,
      error.code,
      error.message,
      error.retryable ? { retryable: true } : undefined,
    );
  }
  if (error instanceof PublicBookingStoreError) {
    throw new ApiError(
      503,
      "public_booking_unavailable",
      "This booking could not be completed. Try again shortly.",
      { retryable: true },
    );
  }
  return publicBookingReadApiError(error);
}

const intervalsOverlap = (
  start: string,
  end: string,
  intervals: readonly PublicBusyInterval[],
): boolean => {
  const minimum = Date.parse(start);
  const maximum = Date.parse(end);
  return intervals.some(interval =>
    Date.parse(interval.start) < maximum && Date.parse(interval.end) > minimum
  );
};

async function createPublishedPublicBooking(
  request: Request,
  route: NonNullable<ReturnType<typeof parsePublicBookingPagePath>>,
  env: CalendarGatewayEnv,
  providerFetch: ProviderFetch,
): Promise<Response> {
  try {
    const requestNow = Date.now();
    await enforcePublicBookingRateLimit({
      limiter: env.PUBLIC_BOOKING_RATE_LIMITER,
      localDevelopment: env.LOCAL_DEVELOPMENT === "true",
      request,
      resource: `booking:${route.profileSlug}/${route.eventTypeSlug}`,
    });
    const parsed = parsePublicBookingRequest(await readJson(request));
    const resolved = await resolvePublishedPublicBookingPage(
      env.CALENDAR_DB.withSession("first-primary"),
      route.profileSlug,
      route.eventTypeSlug,
    );
    const signingSecret = requiredPublicBookingConfiguration(
      env.PUBLIC_BOOKING_SLOT_SIGNING_KEY,
    );
    const claims = await verifyPublicSlotToken(signingSecret, parsed.slotToken, {
      now: requestNow,
    });
    const publicOrigin = publicBookingBaseUrl(env);
    const managementSecret = requiredPublicBookingConfiguration(
      env.PUBLIC_BOOKING_MANAGEMENT_SECRET,
    );
    const turnstile = await verifyPublicBookingTurnstile({
      secret: env.TURNSTILE_SECRET_KEY,
      token: parsed.turnstileToken,
      verificationId: await publicTurnstileVerificationId(
        parsed.requestId,
        parsed.turnstileToken,
      ),
      remoteIp: publicClientIp(request),
      expectedHostname: new URL(publicOrigin).hostname,
      expectedAction: "public_booking",
      now: requestNow,
      providerFetch,
    });
    const scope = {
      workspace: resolved.privateSnapshot.workspaceId,
      principal: resolved.privateSnapshot.principalId,
    };
    const result = await createPublicBooking(resolved, {
      requestId: parsed.requestId,
      guest: parsed.guest,
      slotProof: { token: parsed.slotToken, claims },
      turnstile,
    }, {
      serialization: new D1PublicBookingSerializationBoundary(env.CALENDAR_DB),
      publications: {
        currentPage: async pageId => {
          try {
            const current = await resolvePublishedPublicBookingPage(
              env.CALENDAR_DB.withSession("first-primary"),
              route.profileSlug,
              route.eventTypeSlug,
            );
            return current.pageId === pageId ? current : null;
          } catch (error) {
            if (error instanceof PublicBookingReadError && error.status === 404) return null;
            throw error;
          }
        },
      },
      attempts: new D1PublicBookingAttemptStore(env.CALENDAR_DB, {
        managementSecret,
        managementOrigin: publicOrigin,
      }),
      availability: {
        revalidate: async input => {
          const busy = await queryPublicGoogleBusyIntervals(env, scope, {
            timeMin: input.conflictStart,
            timeMax: input.conflictEnd,
            calendarIds: input.conflictCalendarIds,
          }, providerFetch);
          // Fence an unpublish/republish that happened during provider I/O.
          await assertPublicPageStillCurrent(
            env.CALENDAR_DB.withSession("first-primary"),
            input.page,
          );
          return {
            revisionId: input.page.revisionId,
            eventStart: input.eventStart,
            eventEnd: input.eventEnd,
            conflictStart: input.conflictStart,
            conflictEnd: input.conflictEnd,
            checkedCalendarIds: input.conflictCalendarIds,
            status: intervalsOverlap(input.conflictStart, input.conflictEnd, busy)
              ? "conflict"
              : "available",
          };
        },
      },
      provider: createGatewayPublicBookingProvider(env, providerFetch, {
        assertPublicationCurrent: () => assertPublicPageStillCurrent(
          env.CALENDAR_DB.withSession("first-primary"),
          resolved,
        ),
      }),
      managementTokens: new D1PublicBookingManagementTokenIssuer(env.CALENDAR_DB, {
        secret: managementSecret,
      }),
      now: Date.now,
      expectedTurnstileAction: "public_booking",
      allowedTurnstileHostnames: [new URL(publicOrigin).hostname],
      managementOrigin: publicOrigin,
    });
    const noticeKind = result.status === "pending"
      ? "approval-requested"
      : "booking-confirmed";
    await enqueuePublicBookingNotice(env, {
      eventKey: `${noticeKind}:${result.bookingReference}`,
      bookingReference: result.bookingReference,
      scope,
      kind: noticeKind,
      recipient: parsed.guest,
      organizerName: resolved.publicSnapshot.displayName,
      eventTitle: resolved.publicSnapshot.title,
      startsAt: result.startsAt,
      endsAt: result.endsAt,
      timeZone: resolved.privateSnapshot.schedule.timeZone,
    });
    return json(result, 201);
  } catch (error) {
    return publicBookingMutationApiError(error);
  }
}

const publicBookingManagementUnavailable = (): ApiError => new ApiError(
  404,
  "management_link_unavailable",
  "This booking management link is unavailable.",
);

function publicBookingManagementApiError(error: unknown): never {
  if (error instanceof ApiError) throw error;
  if (
    error instanceof PublicBookingManagementError ||
    error instanceof PublicTurnstileError ||
    error instanceof PublicBookingRateLimitError
  ) {
    throw new ApiError(
      error.status,
      error.code,
      error.message,
      error.retryable ? { retryable: true } : undefined,
    );
  }
  if (
    error instanceof PublicBookingManagementStoreError ||
    error instanceof PublicBookingEmailError ||
    error instanceof PublicBookingStoreError
  ) {
    throw new ApiError(
      503,
      "public_management_unavailable",
      "This booking could not be updated. Try again shortly.",
      { retryable: true },
    );
  }
  return publicBookingReadApiError(error);
}

interface PublicBookingPageRouteRow extends Record<string, unknown> {
  readonly profile_slug: string;
  readonly event_type_slug: string;
}

async function currentPublishedPublicBookingPageById(
  env: CalendarGatewayEnv,
  pageId: string,
) {
  const database = env.CALENDAR_DB.withSession("first-primary");
  const row = await database.prepare(
    `SELECT profile_slugs.slug AS profile_slug,
            page_slugs.slug AS event_type_slug
       FROM public_booking_pages AS pages
       INNER JOIN public_booking_profiles AS profiles
         ON profiles.id = pages.profile_id
       INNER JOIN public_booking_profile_slugs AS profile_slugs
         ON profile_slugs.profile_id = profiles.id
        AND profile_slugs.active = 1
       INNER JOIN public_booking_page_slugs AS page_slugs
         ON page_slugs.page_id = pages.id
        AND page_slugs.profile_id = profiles.id
        AND page_slugs.active = 1
      WHERE pages.id = ?
        AND profiles.status = 'published'
        AND pages.status = 'published'
        AND profiles.current_slug = profile_slugs.slug COLLATE NOCASE
        AND pages.current_slug = page_slugs.slug COLLATE NOCASE
      LIMIT 1`,
  ).bind(pageId).first<PublicBookingPageRouteRow>();
  if (!row || typeof row.profile_slug !== "string" || typeof row.event_type_slug !== "string") {
    return null;
  }
  try {
    const page = await resolvePublishedPublicBookingPage(
      database,
      row.profile_slug,
      row.event_type_slug,
    );
    return page.pageId === pageId ? page : null;
  } catch (error) {
    if (error instanceof PublicBookingReadError && error.status === 404) return null;
    throw error;
  }
}

async function hasPublicBookingManagementOverlap(
  env: CalendarGatewayEnv,
  booking: PublicBookingManagementRecord,
  input: {
    readonly conflictCalendarIds: readonly string[];
    readonly conflictStart: string;
    readonly conflictEnd: string;
  },
): Promise<boolean> {
  if (input.conflictCalendarIds.length === 0) return true;
  const row = await env.CALENDAR_DB.prepare(
    `SELECT idempotency_key
       FROM provider_booking_commits
      WHERE workspace_id = ? AND principal_id = ?
        AND destination_calendar_id IN (${input.conflictCalendarIds.map(() => "?").join(", ")})
        AND state IN ('pending', 'committed')
        AND (booking_kind <> 'approval-hold' OR resolution_status IS NULL OR resolution_status <> 'declined')
        AND (booking_kind <> 'approval-hold' OR hold_expired_at IS NULL)
        AND provider_event_id <> ?
        AND start_at < ? AND end_at > ?
      LIMIT 1`,
  ).bind(
    booking.scope.workspace,
    booking.scope.principal,
    ...input.conflictCalendarIds,
    booking.providerBookingId,
    input.conflictEnd,
    input.conflictStart,
  ).first<{ readonly idempotency_key: string }>();
  return Boolean(row);
}

interface PublicBookingManagementFenceRow extends Record<string, unknown> {
  readonly page_revision_id: string | null;
  readonly to_start_at: string | null;
  readonly to_end_at: string | null;
  readonly conflict_calendar_ids_json: string | null;
  readonly conflict_start_at: string | null;
  readonly conflict_end_at: string | null;
  readonly state: string;
}

const exactStringSequence = (
  left: readonly string[],
  right: readonly string[],
): boolean => left.length === right.length && left.every((value, index) => value === right[index]);

async function assertPublicManagementRescheduleStillAuthorized(
  env: CalendarGatewayEnv,
  booking: PublicBookingManagementRecord,
  input: ScopeFirstGoogleRescheduleInput,
): Promise<void> {
  const mutation = await env.CALENDAR_DB.prepare(
    `SELECT page_revision_id, to_start_at, to_end_at,
            conflict_calendar_ids_json, conflict_start_at, conflict_end_at, state
       FROM public_booking_management_mutations
      WHERE booking_reference = ? AND operation_id = ? AND kind = 'reschedule'
      LIMIT 1`,
  ).bind(booking.bookingReference, input.operationId).first<PublicBookingManagementFenceRow>();
  let conflictCalendarIds: readonly string[] = [];
  try {
    const parsed = mutation?.conflict_calendar_ids_json
      ? JSON.parse(mutation.conflict_calendar_ids_json) as unknown
      : null;
    if (Array.isArray(parsed) && parsed.every(value => typeof value === "string")) {
      conflictCalendarIds = parsed;
    }
  } catch {
    conflictCalendarIds = [];
  }
  const page = await currentPublishedPublicBookingPageById(env, booking.pageId);
  if (
    !mutation || !page || !["pending", "uncertain"].includes(mutation.state) ||
    mutation.page_revision_id === null || mutation.page_revision_id !== page.revisionId ||
    mutation.to_start_at !== input.timeMin || mutation.to_end_at !== input.timeMax ||
    mutation.conflict_start_at !== input.conflictTimeMin ||
    mutation.conflict_end_at !== input.conflictTimeMax ||
    !exactStringSequence(conflictCalendarIds, input.conflictCalendarIds) ||
    input.scope.workspace !== booking.scope.workspace ||
    input.scope.principal !== booking.scope.principal ||
    input.destinationCalendarId !== booking.destinationCalendarId ||
    page.privateSnapshot.workspaceId !== booking.scope.workspace ||
    page.privateSnapshot.principalId !== booking.scope.principal ||
    page.privateSnapshot.destinationCalendarId !== booking.destinationCalendarId
  ) {
    throw new Error("The public booking publication changed before the provider write.");
  }
}

function publicBookingManagementDependencies(
  env: CalendarGatewayEnv,
  providerFetch: ProviderFetch,
  booking: PublicBookingManagementRecord,
  store: D1PublicBookingManagementStore,
): PublicBookingManagementDependencies {
  const slotSigningSecret = requiredPublicBookingConfiguration(
    env.PUBLIC_BOOKING_SLOT_SIGNING_KEY,
  );
  return {
    serialization: new D1PublicBookingSerializationBoundary(env.CALENDAR_DB),
    store,
    publications: {
      currentPage: pageId => currentPublishedPublicBookingPageById(env, pageId),
    },
    slotVerifier: {
      verify: async input => ({
        token: input.token,
        claims: await verifyPublicSlotToken(slotSigningSecret, input.token, {
          now: Date.now(),
        }),
      }),
    },
    availability: {
      revalidate: async input => {
        const [committedOverlap, live] = await Promise.all([
          hasPublicBookingManagementOverlap(env, booking, input),
          strictLiveAvailabilityForScope(
            booking.scope,
            env,
            {
              timeMin: input.conflictStart,
              timeMax: input.conflictEnd,
              calendarIds: input.conflictCalendarIds,
            },
            providerFetch,
            new Set([googleEventId(
              "event",
              booking.destinationCalendarId,
              booking.providerBookingId,
            )]),
          ),
        ]);
        await assertPublicPageStillCurrent(
          env.CALENDAR_DB.withSession("first-primary"),
          input.page,
        );
        return {
          revisionId: input.page.revisionId,
          eventStart: input.eventStart,
          eventEnd: input.eventEnd,
          conflictStart: input.conflictStart,
          conflictEnd: input.conflictEnd,
          checkedCalendarIds: input.conflictCalendarIds,
          status: !live.conclusive
            ? "uncertain"
            : committedOverlap || !live.available
              ? "conflict"
              : "available",
        };
      },
    },
    provider: createGatewayPublicBookingManagementProvider(env, providerFetch, {
      assertRescheduleStillAuthorized: input =>
        assertPublicManagementRescheduleStillAuthorized(env, booking, input),
    }),
    email: createPublicBookingManagementEmailPort(
      publicBookingEmailOutbox(env),
    ),
    now: Date.now,
    turnstileSiteKey: requiredPublicBookingConfiguration(
      env.PUBLIC_TURNSTILE_SITE_KEY,
    ),
  };
}

async function resolvePublicBookingManagementRequest(
  request: Request,
  url: URL,
  env: CalendarGatewayEnv,
  resource: "read" | "cancel" | "reschedule",
): Promise<{
  readonly token: string;
  readonly booking: PublicBookingManagementRecord;
  readonly store: D1PublicBookingManagementStore;
}> {
  const authorization = request.headers.get("Authorization");
  const match = authorization?.match(/^Bearer ([^\s,]+)$/iu);
  let token: string | null = null;
  try {
    token = parsePublicBookingManagementToken(match?.[1]);
  } catch {
    token = null;
  }
  await enforcePublicBookingRateLimit({
    limiter: env.PUBLIC_MANAGEMENT_RATE_LIMITER,
    localDevelopment: env.LOCAL_DEVELOPMENT === "true",
    request,
    resource: `management:${resource}`,
  });
  const store = new D1PublicBookingManagementStore(env.CALENDAR_DB);
  let booking: PublicBookingManagementRecord | null = null;
  try {
    booking = await store.resolve(token ?? "");
  } catch {
    booking = null;
  }
  if (url.search || !token || !booking) throw publicBookingManagementUnavailable();
  return { token, booking, store };
}

async function getPublicBookingManagement(
  request: Request,
  url: URL,
  env: CalendarGatewayEnv,
  providerFetch: ProviderFetch,
): Promise<Response> {
  try {
    const context = await resolvePublicBookingManagementRequest(
      request,
      url,
      env,
      "read",
    );
    return json(await readPublicBookingManagement(
      context.token,
      publicBookingManagementDependencies(env, providerFetch, context.booking, context.store),
    ));
  } catch (error) {
    return publicBookingManagementApiError(error);
  }
}

async function cancelManagedPublicBooking(
  request: Request,
  url: URL,
  env: CalendarGatewayEnv,
  providerFetch: ProviderFetch,
): Promise<Response> {
  try {
    const context = await resolvePublicBookingManagementRequest(
      request,
      url,
      env,
      "cancel",
    );
    const parsed = parsePublicBookingCancelRequest(await readJson(request));
    return json(await cancelPublicBooking(
      context.token,
      parsed,
      publicBookingManagementDependencies(env, providerFetch, context.booking, context.store),
    ));
  } catch (error) {
    return publicBookingManagementApiError(error);
  }
}

async function rescheduleManagedPublicBooking(
  request: Request,
  url: URL,
  env: CalendarGatewayEnv,
  providerFetch: ProviderFetch,
): Promise<Response> {
  try {
    const context = await resolvePublicBookingManagementRequest(
      request,
      url,
      env,
      "reschedule",
    );
    const parsed = parsePublicBookingRescheduleRequest(await readJson(request));
    const publicOrigin = publicBookingBaseUrl(env);
    await verifyPublicBookingTurnstile({
      secret: env.TURNSTILE_SECRET_KEY,
      token: parsed.turnstileToken,
      verificationId: await publicTurnstileVerificationId(
        parsed.requestId,
        parsed.turnstileToken,
      ),
      remoteIp: publicClientIp(request),
      expectedHostname: new URL(publicOrigin).hostname,
      expectedAction: "public_booking_reschedule",
      now: Date.now(),
      providerFetch,
    });
    return json(await reschedulePublicBooking(
      context.token,
      parsed,
      publicBookingManagementDependencies(env, providerFetch, context.booking, context.store),
    ));
  } catch (error) {
    return publicBookingManagementApiError(error);
  }
}

const base64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
};

const fromBase64 = (value: string): Uint8Array => {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), character => character.charCodeAt(0));
};

const randomValue = (bytes: number): string => {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return base64Url(value);
};

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

async function encryptionKey(env: CalendarGatewayEnv): Promise<CryptoKey> {
  const encoded = env.TOKEN_ENCRYPTION_KEY;
  if (!encoded) {
    throw new ApiError(
      503,
      "token_encryption_unconfigured",
      "TOKEN_ENCRYPTION_KEY is required for provider authorization.",
    );
  }
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(encoded);
  } catch {
    throw new ApiError(503, "token_encryption_invalid", "TOKEN_ENCRYPTION_KEY is invalid.");
  }
  if (bytes.byteLength !== 32) {
    throw new ApiError(
      503,
      "token_encryption_invalid",
      "TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes.",
    );
  }
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptSecret(env: CalendarGatewayEnv, value: unknown): Promise<string> {
  const key = await encryptionKey(env);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return `v1.${base64Url(iv)}.${base64Url(new Uint8Array(ciphertext))}`;
}

async function decryptSecret<T>(env: CalendarGatewayEnv, value: string): Promise<T> {
  const [version, ivValue, ciphertextValue, ...extra] = value.split(".");
  if (version !== "v1" || !ivValue || !ciphertextValue || extra.length > 0) {
    throw new ApiError(500, "credential_corrupt", "Stored provider credentials are invalid.");
  }
  try {
    const key = await encryptionKey(env);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(ivValue) },
      key,
      fromBase64(ciphertextValue),
    );
    return JSON.parse(new TextDecoder().decode(plaintext)) as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, "credential_corrupt", "Stored provider credentials could not be decrypted.");
  }
}

function oauthProviderConfig(
  env: CalendarGatewayEnv,
  value: "google" | "microsoft",
): OAuthProviderConfig | null {
  if (value === "google") {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.TOKEN_ENCRYPTION_KEY) {
      return null;
    }
    return {
      id: "google",
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scopes: [
        "openid",
        "email",
        "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/calendar.freebusy",
      ],
    };
  }
  if (!env.MICROSOFT_CLIENT_ID || !env.MICROSOFT_CLIENT_SECRET || !env.TOKEN_ENCRYPTION_KEY) {
    return null;
  }
  return {
    id: "microsoft",
    clientId: env.MICROSOFT_CLIENT_ID,
    clientSecret: env.MICROSOFT_CLIENT_SECRET,
    authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scopes: [
      "openid",
      "profile",
      "email",
      "offline_access",
      "User.Read",
      "Calendars.ReadWrite",
      "Calendars.ReadWrite.Shared",
    ],
  };
}

const providerCatalog = (env: CalendarGatewayEnv) => ({
  providers: [
    {
      id: "google",
      authorization: "oauth",
      configured: oauthProviderConfig(env, "google") !== null,
    },
    {
      id: "microsoft",
      authorization: "oauth",
      configured: oauthProviderConfig(env, "microsoft") !== null,
    },
    {
      id: "icloud",
      authorization: "app-specific-password",
      configured: Boolean(env.TOKEN_ENCRYPTION_KEY),
      note: "CalDAV credential discovery is the next provider adapter.",
    },
    {
      id: "caldav",
      authorization: "credentials",
      configured: false,
      note: "The local gateway contract reserves credential-backed CalDAV discovery.",
    },
    {
      id: "exchange",
      authorization: "enterprise",
      configured: false,
      note: "Exchange Server requires an organization-specific EWS adapter.",
    },
    {
      id: "ics",
      authorization: "subscription-url",
      configured: false,
      note: "ICS subscription ingestion is not enabled in this local gateway build.",
    },
  ],
  localConnector: env.LOCAL_DEVELOPMENT === "true",
});

const calendarProjection = (row: CalendarRow) => ({
  id: row.id,
  providerCalendarId: row.provider_calendar_id,
  name: row.name,
  color: row.color,
  role: row.role,
  writable: row.writable === 1,
  freshness: row.freshness,
  primary: row.is_primary === 1,
});

const connectionProjection = (
  row: ConnectionRow,
  calendars: readonly CalendarRow[],
) => ({
  id: row.id,
  workspaceId: row.workspace_id,
  ownerPrincipalId: row.principal_id,
  provider: row.provider,
  mode: row.mode,
  label: row.label,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  lastSyncedAt: row.last_synced_at,
  calendars: calendars.map(calendarProjection),
});

async function connectionById(
  env: CalendarGatewayEnv,
  workspace: string,
  principal: string,
  connectionId: string,
): Promise<{ readonly row: ConnectionRow; readonly calendars: readonly CalendarRow[] }> {
  const row = await env.CALENDAR_DB.prepare(
    `SELECT * FROM calendar_connections
      WHERE workspace_id = ? AND principal_id = ? AND id = ?`,
  )
    .bind(workspace, principal, connectionId)
    .first<ConnectionRow>();
  if (!row) {
    throw new ApiError(404, "connection_not_found", "The calendar connection was not found.");
  }
  const calendars = await env.CALENDAR_DB.prepare(
    "SELECT * FROM provider_calendars WHERE connection_id = ? ORDER BY name, id",
  )
    .bind(connectionId)
    .all<CalendarRow>();
  return { row, calendars: calendars.results };
}

async function listConnections(
  request: Request,
  env: CalendarGatewayEnv,
): Promise<Response> {
  const { workspace, principal } = await principalScope(request, env);
  const connections = await env.CALENDAR_DB.prepare(
    `SELECT * FROM calendar_connections
      WHERE workspace_id = ? AND principal_id = ?
      ORDER BY updated_at DESC, id`,
  )
    .bind(workspace, principal)
    .all<ConnectionRow>();
  const calendars = await env.CALENDAR_DB.prepare(
    `SELECT provider_calendars.* FROM provider_calendars
       INNER JOIN calendar_connections ON calendar_connections.id = provider_calendars.connection_id
      WHERE calendar_connections.workspace_id = ?
        AND calendar_connections.principal_id = ?
      ORDER BY provider_calendars.name, provider_calendars.id`,
  )
    .bind(workspace, principal)
    .all<CalendarRow>();
  const grouped = new Map<string, CalendarRow[]>();
  for (const calendar of calendars.results) {
    const current = grouped.get(calendar.connection_id) ?? [];
    current.push(calendar);
    grouped.set(calendar.connection_id, current);
  }
  return json({
    connections: connections.results.map(row =>
      connectionProjection(row, grouped.get(row.id) ?? []),
    ),
  });
}

interface LocalCalendarInput {
  readonly id: string;
  readonly providerCalendarId: string;
  readonly name: string;
  readonly color: string;
  readonly role: CalendarRole;
  readonly writable: boolean;
  readonly freshness: "live" | "delayed" | "stale";
  readonly primary: boolean;
}

function localCalendarInputs(value: unknown): readonly LocalCalendarInput[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 250) {
    throw new ApiError(400, "invalid_calendars", "Add between 1 and 250 calendars.");
  }
  const ids = new Set<string>();
  const providerIds = new Set<string>();
  return value.map((candidate, index) => {
    if (!isRecord(candidate)) {
      throw new ApiError(400, "invalid_calendars", `calendars[${index}] is invalid.`);
    }
    const id = identifier(candidate.id, `calendars[${index}].id`);
    const providerCalendarId = requiredText(
      candidate.providerCalendarId ?? candidate.id,
      `calendars[${index}].providerCalendarId`,
      2048,
    );
    const name = requiredText(candidate.name, `calendars[${index}].name`);
    const role = candidate.role;
    if (role !== "owner" && role !== "writer" && role !== "reader" && role !== "free-busy") {
      throw new ApiError(400, "invalid_calendars", `calendars[${index}].role is invalid.`);
    }
    const writable = candidate.writable;
    if (typeof writable !== "boolean" || writable !== (role === "owner" || role === "writer")) {
      throw new ApiError(
        400,
        "invalid_calendars",
        `calendars[${index}].writable must match its access role.`,
      );
    }
    const color = typeof candidate.color === "string" && COLOR.test(candidate.color)
      ? candidate.color.toLowerCase()
      : "#4f7cff";
    const freshness = candidate.freshness;
    if (freshness !== "live" && freshness !== "delayed" && freshness !== "stale") {
      throw new ApiError(400, "invalid_calendars", `calendars[${index}].freshness is invalid.`);
    }
    if (ids.has(id) || providerIds.has(providerCalendarId)) {
      throw new ApiError(409, "duplicate_calendar", "Calendar identifiers must be unique.");
    }
    ids.add(id);
    providerIds.add(providerCalendarId);
    return {
      id,
      providerCalendarId,
      name,
      color,
      role,
      writable,
      freshness,
      primary: candidate.primary === true,
    };
  });
}

function localCalendarIds(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 250) {
    throw new ApiError(400, "invalid_calendars", "Remove between 1 and 250 calendars.");
  }
  const ids = value.map((candidate, index) => identifier(candidate, `calendarIds[${index}]`));
  if (new Set(ids).size !== ids.length) {
    throw new ApiError(400, "invalid_calendars", "Calendar identifiers must be unique.");
  }
  return ids;
}

const calendarInsert = (
  env: CalendarGatewayEnv,
  connectionId: string,
  calendar: LocalCalendarInput,
  timestamp: string,
): D1PreparedStatement =>
  env.CALENDAR_DB.prepare(
    `INSERT INTO provider_calendars
      (id, connection_id, provider_calendar_id, name, color, role, writable, freshness,
       is_primary, raw_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    calendar.id,
    connectionId,
    calendar.providerCalendarId,
    calendar.name,
    calendar.color,
    calendar.role,
    calendar.writable ? 1 : 0,
    calendar.freshness,
    calendar.primary ? 1 : 0,
    JSON.stringify({ source: "local-connector" }),
    timestamp,
    timestamp,
  );

async function createLocalConnection(
  request: Request,
  env: CalendarGatewayEnv,
): Promise<Response> {
  requireLocalDevelopment(env);
  const { workspace, principal } = await principalScope(request, env);
  const body = await readJson(request);
  const connectionId = identifier(body.id, "id");
  const selectedProvider = provider(body.provider);
  const label = requiredText(body.label, "label");
  const calendars = localCalendarInputs(body.calendars);
  const now = new Date().toISOString();
  const status: ConnectionStatus = calendars.some(calendar => calendar.writable)
    ? "connected"
    : "read-only";
  const statements = [
    env.CALENDAR_DB.prepare(
      `INSERT INTO calendar_connections
        (id, workspace_id, principal_id, provider, mode, label, status, credential_ciphertext,
         token_expires_at, created_at, updated_at, last_synced_at)
       VALUES (?, ?, ?, ?, 'local', ?, ?, NULL, NULL, ?, ?, ?)`,
    ).bind(
      connectionId,
      workspace,
      principal,
      selectedProvider,
      label,
      status,
      now,
      now,
      now,
    ),
    ...calendars.map(calendar => calendarInsert(env, connectionId, calendar, now)),
  ];
  try {
    await env.CALENDAR_DB.batch(statements);
  } catch (error) {
    console.warn(JSON.stringify({ message: "local connection rejected", connectionId }));
    throw new ApiError(
      409,
      "connection_conflict",
      error instanceof Error && error.message.includes("provider_calendars")
        ? "A calendar identifier is already connected."
        : "This calendar connection already exists.",
    );
  }
  const created = await connectionById(env, workspace, principal, connectionId);
  return json({ connection: connectionProjection(created.row, created.calendars) }, 201);
}

async function addLocalCalendars(
  request: Request,
  env: CalendarGatewayEnv,
  connectionId: string,
): Promise<Response> {
  requireLocalDevelopment(env);
  const { workspace, principal } = await principalScope(request, env);
  const connection = await connectionById(env, workspace, principal, connectionId);
  if (connection.row.mode !== "local") {
    throw new ApiError(
      409,
      "provider_managed_connection",
      "Refresh provider-managed connections instead of adding invented calendars.",
    );
  }
  const body = await readJson(request);
  const calendars = localCalendarInputs(body.calendars);
  const now = new Date().toISOString();
  try {
    await env.CALENDAR_DB.batch([
      ...calendars.map(calendar => calendarInsert(env, connectionId, calendar, now)),
      env.CALENDAR_DB.prepare(
        `UPDATE calendar_connections
            SET status = ?, updated_at = ?, last_synced_at = ?
          WHERE workspace_id = ? AND principal_id = ? AND id = ?`,
      ).bind(
        [...connection.calendars, ...calendars].some(calendar =>
          "writable" in calendar ? Boolean(calendar.writable) : false,
        )
          ? "connected"
          : "read-only",
        now,
        now,
        workspace,
        principal,
        connectionId,
      ),
    ]);
  } catch {
    throw new ApiError(409, "calendar_conflict", "One or more calendars are already connected.");
  }
  const updated = await connectionById(env, workspace, principal, connectionId);
  return json({ connection: connectionProjection(updated.row, updated.calendars) });
}

async function removeLocalCalendars(
  request: Request,
  env: CalendarGatewayEnv,
  connectionId: string,
): Promise<Response> {
  requireLocalDevelopment(env);
  const { workspace, principal } = await principalScope(request, env);
  const connection = await connectionById(env, workspace, principal, connectionId);
  if (connection.row.mode !== "local") {
    throw new ApiError(
      409,
      "provider_managed_connection",
      "Provider-managed calendars can only change through provider discovery.",
    );
  }
  const body = await readJson(request);
  const calendarIds = localCalendarIds(body.calendarIds);
  const now = new Date().toISOString();
  const placeholders = calendarIds.map(() => "?").join(", ");
  await env.CALENDAR_DB.batch([
    env.CALENDAR_DB.prepare(
      `DELETE FROM provider_calendars
        WHERE connection_id = ? AND id IN (${placeholders})`,
    ).bind(connectionId, ...calendarIds),
    env.CALENDAR_DB.prepare(
      `UPDATE calendar_connections
          SET status = CASE
                WHEN EXISTS (
                  SELECT 1 FROM provider_calendars
                   WHERE connection_id = ? AND writable = 1
                ) THEN 'connected'
                ELSE 'read-only'
              END,
              updated_at = ?, last_synced_at = ?
        WHERE workspace_id = ? AND principal_id = ? AND id = ?`,
    ).bind(connectionId, now, now, workspace, principal, connectionId),
  ]);
  const updated = await connectionById(env, workspace, principal, connectionId);
  return json({ connection: connectionProjection(updated.row, updated.calendars) });
}

async function removeCalendars(
  request: Request,
  env: CalendarGatewayEnv,
  connectionId: string,
): Promise<Response> {
  const { workspace, principal } = await principalScope(request, env);
  const connection = await connectionById(env, workspace, principal, connectionId);
  const body = await readJson(request);
  const calendarIds = localCalendarIds(body.calendarIds);
  const requestedIds = new Set(calendarIds);
  const activeById = new Map(
    connection.calendars
      .filter(calendar => requestedIds.has(calendar.id))
      .map(calendar => [calendar.id, calendar] as const),
  );
  const placeholders = calendarIds.map(() => "?").join(", ");
  const excluded = await env.CALENDAR_DB.prepare(
    `SELECT calendar_id, provider_calendar_id FROM calendar_exclusions
      WHERE workspace_id = ? AND connection_id = ?
        AND calendar_id IN (${placeholders})`,
  )
    .bind(workspace, connectionId, ...calendarIds)
    .all<CalendarExclusionRow>();
  const knownIds = new Set([
    ...activeById.keys(),
    ...excluded.results.map(calendar => calendar.calendar_id),
  ]);
  if (calendarIds.some(calendarId => !knownIds.has(calendarId))) {
    throw new ApiError(
      404,
      "calendar_not_found",
      "One or more calendars were not found in this connection.",
    );
  }
  const active = calendarIds.flatMap(calendarId => {
    const calendar = activeById.get(calendarId);
    return calendar ? [calendar] : [];
  });
  if (active.length === 0) {
    return json({ connection: connectionProjection(connection.row, connection.calendars) });
  }
  const now = new Date().toISOString();
  const activeIds = active.map(calendar => calendar.id);
  await env.CALENDAR_DB.batch([
    ...active.map(calendar =>
      env.CALENDAR_DB.prepare(
        `INSERT INTO calendar_exclusions
          (workspace_id, connection_id, calendar_id, provider_calendar_id, excluded_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (workspace_id, connection_id, provider_calendar_id)
         DO UPDATE SET calendar_id = excluded.calendar_id, excluded_at = excluded.excluded_at`,
      ).bind(
        workspace,
        connectionId,
        calendar.id,
        calendar.provider_calendar_id,
        now,
      )
    ),
    env.CALENDAR_DB.prepare(
      `DELETE FROM provider_calendars
        WHERE connection_id = ? AND id IN (${activeIds.map(() => "?").join(", ")})`,
    ).bind(connectionId, ...activeIds),
    env.CALENDAR_DB.prepare(
      `UPDATE calendar_connections
          SET status = CASE
                WHEN EXISTS (
                  SELECT 1 FROM provider_calendars
                   WHERE connection_id = ? AND writable = 1
                ) THEN 'connected'
                ELSE 'read-only'
              END,
              updated_at = ?, last_synced_at = ?
        WHERE workspace_id = ? AND principal_id = ? AND id = ?`,
    ).bind(connectionId, now, now, workspace, principal, connectionId),
  ]);
  const updated = await connectionById(env, workspace, principal, connectionId);
  return json({ connection: connectionProjection(updated.row, updated.calendars) });
}

async function deleteConnection(
  request: Request,
  env: CalendarGatewayEnv,
  connectionId: string,
): Promise<Response> {
  const { workspace, principal } = await principalScope(request, env);
  const result = await env.CALENDAR_DB.prepare(
    `DELETE FROM calendar_connections
      WHERE workspace_id = ? AND principal_id = ? AND id = ?`,
  )
    .bind(workspace, principal, connectionId)
    .run();
  if (Number(result.meta.changes ?? 0) === 0) {
    throw new ApiError(404, "connection_not_found", "The calendar connection was not found.");
  }
  return new Response(null, { status: 204 });
}

async function externalJson(
  url: string,
  init: RequestInit,
  providerFetch: ProviderFetch = fetch,
): Promise<Readonly<Record<string, unknown>>> {
  const response = await providerFetch(url, init);
  const declared = Number(response.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_PROVIDER_RESPONSE_BYTES) {
    throw new ApiError(
      502,
      "provider_response_too_large",
      "The provider response exceeded the safe response limit.",
    );
  }
  if (!response.body) {
    throw new ApiError(502, "provider_response_invalid", "The provider returned an empty response.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > MAX_PROVIDER_RESPONSE_BYTES) {
      await reader.cancel("provider response too large");
      throw new ApiError(
        502,
        "provider_response_too_large",
        "The provider response exceeded the safe response limit.",
      );
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  text += decoder.decode();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!response.ok) {
    const record = isRecord(parsed) ? parsed : {};
    const nestedError = isRecord(record.error) ? record.error : {};
    const message =
      (typeof nestedError.message === "string" && nestedError.message) ||
      (typeof record.error_description === "string" && record.error_description) ||
      `Provider request failed with HTTP ${response.status}.`;
    throw new ProviderHttpError(response.status, message.slice(0, 500));
  }
  if (!isRecord(parsed)) {
    throw new ApiError(502, "provider_response_invalid", "The provider returned invalid JSON.");
  }
  return parsed;
}

function tokenSecret(value: Readonly<Record<string, unknown>>): TokenSecret {
  const accessToken = requiredText(value.access_token, "provider access token", 16_384);
  const expiresIn = typeof value.expires_in === "number" && Number.isFinite(value.expires_in)
    ? Math.max(60, value.expires_in)
    : 3600;
  const refreshToken = typeof value.refresh_token === "string" && value.refresh_token
    ? value.refresh_token
    : undefined;
  const scope = typeof value.scope === "string" ? value.scope : undefined;
  return {
    accessToken,
    ...(refreshToken ? { refreshToken } : {}),
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    tokenType: typeof value.token_type === "string" ? value.token_type : "Bearer",
    ...(scope ? { scope } : {}),
  };
}

async function beginOAuth(
  request: Request,
  env: CalendarGatewayEnv,
  selectedProvider: "google" | "microsoft",
): Promise<Response> {
  const { workspace, principal } = await principalScope(request, env);
  const config = oauthProviderConfig(env, selectedProvider);
  if (!config) {
    throw new ApiError(
      503,
      "provider_unconfigured",
      `${selectedProvider === "google" ? "Google" : "Microsoft"} OAuth credentials are not configured in .dev.vars.`,
    );
  }
  const body = await readJson(request);
  const connectionId = identifier(body.id, "id");
  const labelHint = typeof body.label === "string" && body.label.trim()
    ? requiredText(body.label, "label")
    : `${selectedProvider} account`;
  const state = randomValue(32);
  const stateHash = await sha256(state);
  const verifier = randomValue(64);
  const challenge = await sha256(verifier);
  const verifierCiphertext = await encryptSecret(env, { verifier });
  const now = new Date();
  const expiresAt = new Date(now.valueOf() + OAUTH_STATE_TTL_MS).toISOString();
  const redirectUri = `${new URL(request.url).origin}/v1/oauth/${selectedProvider}/callback`;
  try {
    await env.CALENDAR_DB.batch([
      env.CALENDAR_DB.prepare(
        `INSERT INTO calendar_connections
          (id, workspace_id, principal_id, provider, mode, label, status, credential_ciphertext,
           token_expires_at, created_at, updated_at, last_synced_at)
         VALUES (?, ?, ?, ?, 'oauth', ?, 'pending', NULL, NULL, ?, ?, NULL)`,
      ).bind(
        connectionId,
        workspace,
        principal,
        selectedProvider,
        labelHint,
        now.toISOString(),
        now.toISOString(),
      ),
      env.CALENDAR_DB.prepare(
        `INSERT INTO oauth_states
          (state_hash, connection_id, workspace_id, principal_id, provider, verifier_ciphertext,
           expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        stateHash,
        connectionId,
        workspace,
        principal,
        selectedProvider,
        verifierCiphertext,
        expiresAt,
        now.toISOString(),
      ),
    ]);
  } catch {
    throw new ApiError(409, "connection_conflict", "This calendar connection already exists.");
  }
  const authorizationUrl = new URL(config.authorizeUrl);
  authorizationUrl.searchParams.set("client_id", config.clientId);
  authorizationUrl.searchParams.set("redirect_uri", redirectUri);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", config.scopes.join(" "));
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("code_challenge", challenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");
  if (selectedProvider === "google") {
    authorizationUrl.searchParams.set("access_type", "offline");
    authorizationUrl.searchParams.set("include_granted_scopes", "true");
    authorizationUrl.searchParams.set("prompt", "consent");
  } else {
    authorizationUrl.searchParams.set("response_mode", "query");
    authorizationUrl.searchParams.set("prompt", "select_account");
  }
  return json(
    {
      connectionId,
      authorizationUrl: authorizationUrl.href,
      expiresAt,
    },
    201,
  );
}

async function discoverGoogle(
  accessToken: string,
  providerFetch: ProviderFetch = fetch,
): Promise<DiscoveryResult> {
  const calendars: DiscoveredCalendar[] = [];
  let pageToken: string | null = null;
  let pageCount = 0;
  do {
    pageCount += 1;
    if (pageCount > MAX_PROVIDER_PAGES) {
      throw new ApiError(502, "provider_pagination_invalid", "Google Calendar returned too many pages.");
    }
    const url = new URL("https://www.googleapis.com/calendar/v3/users/me/calendarList");
    url.searchParams.set("maxResults", "250");
    url.searchParams.set("showDeleted", "false");
    url.searchParams.set("showHidden", "true");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const page = await externalJson(
      url.href,
      { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } },
      providerFetch,
    );
    const items = Array.isArray(page.items) ? page.items : [];
    for (const item of items) {
      if (!isRecord(item) || typeof item.id !== "string") continue;
      const accessRole = item.accessRole;
      const role: CalendarRole = accessRole === "owner"
        ? "owner"
        : accessRole === "writer"
          ? "writer"
          : accessRole === "freeBusyReader"
            ? "free-busy"
            : "reader";
      calendars.push({
        providerCalendarId: item.id,
        name: typeof item.summaryOverride === "string"
          ? item.summaryOverride
          : typeof item.summary === "string"
            ? item.summary
            : item.id,
        color: typeof item.backgroundColor === "string" && COLOR.test(item.backgroundColor)
          ? item.backgroundColor.toLowerCase()
          : "#4285f4",
        role,
        writable: role === "owner" || role === "writer",
        freshness: "live",
        primary: item.primary === true,
        raw: item,
      });
    }
    pageToken = typeof page.nextPageToken === "string" ? page.nextPageToken : null;
  } while (pageToken);
  const primary = calendars.find(calendar => calendar.primary);
  return {
    label: primary?.providerCalendarId ?? primary?.name ?? "Google Calendar",
    calendars,
  };
}

const microsoftColors: Readonly<Record<string, string>> = {
  auto: "#0078d4",
  lightBlue: "#3a96dd",
  lightGreen: "#13a10e",
  lightOrange: "#ff8c00",
  lightGray: "#7a7574",
  lightYellow: "#fce100",
  lightTeal: "#00b7c3",
  lightPink: "#e43ba6",
  lightBrown: "#a4262c",
  lightRed: "#d13438",
  maxColor: "#8764b8",
};

export function normalizeMicrosoftCalendarPageUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError(502, "provider_pagination_invalid", "Microsoft returned an invalid calendar page URL.");
  }
  if (
    url.origin !== "https://graph.microsoft.com" ||
    url.pathname !== "/v1.0/me/calendars" ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new ApiError(502, "provider_pagination_invalid", "Microsoft returned an untrusted calendar page URL.");
  }
  return url.href;
}

async function discoverMicrosoft(
  accessToken: string,
  providerFetch: ProviderFetch = fetch,
): Promise<DiscoveryResult> {
  const headers = { Authorization: `Bearer ${accessToken}`, Accept: "application/json" };
  const identity = await externalJson(
    "https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName",
    { headers },
    providerFetch,
  );
  const accountAddress =
    (typeof identity.mail === "string" && identity.mail) ||
    (typeof identity.userPrincipalName === "string" && identity.userPrincipalName) ||
    "";
  const calendars: DiscoveredCalendar[] = [];
  let nextUrl: string | null =
    "https://graph.microsoft.com/v1.0/me/calendars?$top=100&$select=id,name,color,hexColor,canEdit,canViewPrivateItems,isDefaultCalendar,owner";
  let pageCount = 0;
  while (nextUrl) {
    pageCount += 1;
    if (pageCount > MAX_PROVIDER_PAGES) {
      throw new ApiError(502, "provider_pagination_invalid", "Microsoft returned too many calendar pages.");
    }
    const page = await externalJson(
      normalizeMicrosoftCalendarPageUrl(nextUrl),
      { headers },
      providerFetch,
    );
    const items = Array.isArray(page.value) ? page.value : [];
    for (const item of items) {
      if (!isRecord(item) || typeof item.id !== "string") continue;
      const owner = isRecord(item.owner) ? item.owner : {};
      const ownerAddress = typeof owner.address === "string" ? owner.address : "";
      const owns = Boolean(accountAddress) && ownerAddress.toLowerCase() === accountAddress.toLowerCase();
      const role: CalendarRole = owns ? "owner" : item.canEdit === true ? "writer" : "reader";
      const hexColor = typeof item.hexColor === "string" && COLOR.test(item.hexColor)
        ? item.hexColor.toLowerCase()
        : microsoftColors[typeof item.color === "string" ? item.color : "auto"] ?? "#0078d4";
      calendars.push({
        providerCalendarId: item.id,
        name: typeof item.name === "string" && item.name ? item.name : "Calendar",
        color: hexColor,
        role,
        writable: role === "owner" || role === "writer",
        freshness: "live",
        primary: item.isDefaultCalendar === true,
        raw: item,
      });
    }
    nextUrl = typeof page["@odata.nextLink"] === "string"
      ? normalizeMicrosoftCalendarPageUrl(page["@odata.nextLink"])
      : null;
  }
  return {
    label:
      accountAddress ||
      (typeof identity.displayName === "string" && identity.displayName
        ? identity.displayName
        : "Microsoft 365"),
    calendars,
  };
}

const discoverProvider = (
  selectedProvider: "google" | "microsoft",
  accessToken: string,
  providerFetch: ProviderFetch = fetch,
): Promise<DiscoveryResult> =>
  selectedProvider === "google"
    ? discoverGoogle(accessToken, providerFetch)
    : discoverMicrosoft(accessToken, providerFetch);

async function persistDiscovery(
  env: CalendarGatewayEnv,
  connection: ConnectionRow,
  discovery: DiscoveryResult,
  secret: TokenSecret,
): Promise<void> {
  if (discovery.calendars.length === 0) {
    throw new ApiError(502, "no_calendars", "The provider returned no calendars.");
  }
  const existing = await env.CALENDAR_DB.prepare(
    "SELECT * FROM provider_calendars WHERE connection_id = ?",
  )
    .bind(connection.id)
    .all<CalendarRow>();
  const exclusions = await env.CALENDAR_DB.prepare(
    `SELECT calendar_id, provider_calendar_id FROM calendar_exclusions
      WHERE workspace_id = ? AND connection_id = ?`,
  )
    .bind(connection.workspace_id, connection.id)
    .all<CalendarExclusionRow>();
  const excludedProviderIds = new Set(
    exclusions.results.map(calendar => calendar.provider_calendar_id),
  );
  const includedCalendars = discovery.calendars.filter(
    calendar => !excludedProviderIds.has(calendar.providerCalendarId),
  );
  const idsByProviderId = new Map(
    existing.results.map(calendar => [calendar.provider_calendar_id, calendar.id] as const),
  );
  const now = new Date().toISOString();
  const ciphertext = await encryptSecret(env, secret);
  const status: ConnectionStatus = includedCalendars.some(calendar => calendar.writable)
    ? "connected"
    : "read-only";
  const statements: D1PreparedStatement[] = [
    env.CALENDAR_DB.prepare(
      `UPDATE calendar_connections
          SET label = ?, status = ?, credential_ciphertext = ?, token_expires_at = ?,
              updated_at = ?, last_synced_at = ?
        WHERE id = ? AND workspace_id = ? AND principal_id = ?`,
    ).bind(
      discovery.label,
      status,
      ciphertext,
      secret.expiresAt,
      now,
      now,
      connection.id,
      connection.workspace_id,
      connection.principal_id,
    ),
  ];
  for (const calendar of includedCalendars) {
    const calendarId = idsByProviderId.get(calendar.providerCalendarId) ??
      `calendar-${crypto.randomUUID()}`;
    statements.push(
      env.CALENDAR_DB.prepare(
        `INSERT INTO provider_calendars
          (id, connection_id, provider_calendar_id, name, color, role, writable,
           freshness, is_primary, raw_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (connection_id, provider_calendar_id) DO UPDATE SET
           name = excluded.name,
           color = excluded.color,
           role = excluded.role,
           writable = excluded.writable,
           freshness = excluded.freshness,
           is_primary = excluded.is_primary,
           raw_json = excluded.raw_json,
           updated_at = excluded.updated_at`,
      ).bind(
        calendarId,
        connection.id,
        calendar.providerCalendarId,
        calendar.name.slice(0, 255),
        calendar.color,
        calendar.role,
        calendar.writable ? 1 : 0,
        calendar.freshness,
        calendar.primary ? 1 : 0,
        JSON.stringify(calendar.raw),
        now,
        now,
      ),
    );
    if (connection.provider === "google" && calendar.role !== "free-busy") {
      statements.push(
        env.CALENDAR_DB.prepare(
          `INSERT OR IGNORE INTO calendar_sync_state
            (workspace_id, connection_id, calendar_id, active_generation, cache_revision, sync_token,
             cache_time_min, freshness, last_attempt_at, last_success_at, next_sync_at,
             error_code, error_message, consecutive_failures, lease_until,
             current_watch_channel_id, watch_expiration_at, last_notification_at)
           VALUES (?, ?, ?, ?, 0, NULL, NULL, 'pending', NULL, NULL, ?, NULL, NULL, 0,
                   NULL, NULL, NULL, NULL)`,
        ).bind(
          connection.workspace_id,
          connection.id,
          calendarId,
          `initial-${crypto.randomUUID()}`,
          now,
        ),
      );
    } else if (calendar.role === "free-busy") {
      // A provider role downgrade is a privacy boundary: discard previously cached event
      // details and push-channel metadata before this calendar becomes live free/busy-only.
      statements.push(
        env.CALENDAR_DB.prepare(
          "DELETE FROM calendar_event_cache WHERE workspace_id = ? AND calendar_id = ?",
        ).bind(connection.workspace_id, calendarId),
        env.CALENDAR_DB.prepare(
          "DELETE FROM calendar_watch_channels WHERE workspace_id = ? AND calendar_id = ?",
        ).bind(connection.workspace_id, calendarId),
        env.CALENDAR_DB.prepare(
          "DELETE FROM calendar_sync_state WHERE workspace_id = ? AND calendar_id = ?",
        ).bind(connection.workspace_id, calendarId),
      );
    }
  }
  statements.push(
    includedCalendars.length === 0
      ? env.CALENDAR_DB.prepare(
        "DELETE FROM provider_calendars WHERE connection_id = ?",
      ).bind(connection.id)
      : env.CALENDAR_DB.prepare(
        `DELETE FROM provider_calendars
          WHERE connection_id = ?
            AND provider_calendar_id NOT IN (${includedCalendars.map(() => "?").join(", ")})`,
      ).bind(connection.id, ...includedCalendars.map(calendar => calendar.providerCalendarId)),
  );
  await env.CALENDAR_DB.batch(statements);
}

async function exchangeAuthorizationCode(
  config: OAuthProviderConfig,
  code: string,
  verifier: string,
  redirectUri: string,
  providerFetch: ProviderFetch = fetch,
): Promise<TokenSecret> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    code_verifier: verifier,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
  if (config.id === "microsoft") body.set("scope", config.scopes.join(" "));
  return tokenSecret(
    await externalJson(
      config.tokenUrl,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      },
      providerFetch,
    ),
  );
}

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const oauthPage = (title: string, message: string, status = 200): Response =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{font:16px/1.5 system-ui;background:#111;color:#f5f5f5;display:grid;min-height:100vh;place-items:center;margin:0}.card{max-width:34rem;padding:2rem;border:1px solid #444;border-radius:1rem;background:#1d1d1f}h1{margin-top:0}</style></head><body><main class="card"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><p>You can close this window and return to TAP Calendar.</p></main></body></html>`,
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
        "Content-Type": "text/html; charset=utf-8",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );

async function completeOAuth(
  request: Request,
  env: CalendarGatewayEnv,
  selectedProvider: "google" | "microsoft",
  providerFetch: ProviderFetch = fetch,
): Promise<Response> {
  const url = new URL(request.url);
  const providerError = url.searchParams.get("error");
  if (providerError) {
    return oauthPage("Authorization cancelled", `The provider returned ${providerError}.`, 400);
  }
  const state = requiredText(url.searchParams.get("state"), "state", 1024);
  const code = requiredText(url.searchParams.get("code"), "code", 16_384);
  const row = await env.CALENDAR_DB.prepare(
    `SELECT connection_id, workspace_id, principal_id, provider, verifier_ciphertext, expires_at
       FROM oauth_states WHERE state_hash = ? AND provider = ?`,
  )
    .bind(await sha256(state), selectedProvider)
    .first<OAuthStateRow>();
  if (!row || Date.parse(row.expires_at) <= Date.now()) {
    throw new ApiError(400, "oauth_state_invalid", "The provider authorization has expired.");
  }
  if (!row.principal_id) {
    throw new ApiError(
      409,
      "oauth_state_principal_unbound",
      "This authorization was started before TAP principal ownership was enabled. Start authorization again from Calendar.",
    );
  }
  await env.CALENDAR_DB.prepare("DELETE FROM oauth_states WHERE state_hash = ?")
    .bind(await sha256(state))
    .run();
  const connection = await connectionById(
    env,
    row.workspace_id,
    row.principal_id,
    row.connection_id,
  );
  const config = oauthProviderConfig(env, selectedProvider);
  if (!config) {
    throw new ApiError(503, "provider_unconfigured", "Provider OAuth is no longer configured.");
  }
  const verifierSecret = await decryptSecret<{ readonly verifier: string }>(
    env,
    row.verifier_ciphertext,
  );
  const redirectUri = `${url.origin}/v1/oauth/${selectedProvider}/callback`;
  const token = await exchangeAuthorizationCode(
    config,
    code,
    verifierSecret.verifier,
    redirectUri,
    providerFetch,
  );
  const discovery = await discoverProvider(selectedProvider, token.accessToken, providerFetch);
  await persistDiscovery(env, connection.row, discovery, token);
  return oauthPage("Calendar connected", `${discovery.label} is ready in TAP Calendar.`);
}

async function refreshToken(
  config: OAuthProviderConfig,
  secret: TokenSecret,
  providerFetch: ProviderFetch = fetch,
): Promise<TokenSecret> {
  if (!secret.refreshToken) {
    throw new ApiError(
      409,
      "reauthorization_required",
      "The provider did not issue a refresh token. Authorize the account again.",
    );
  }
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
    refresh_token: secret.refreshToken,
  });
  if (config.id === "microsoft") body.set("scope", config.scopes.join(" "));
  const next = tokenSecret(
    await externalJson(
      config.tokenUrl,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      },
      providerFetch,
    ),
  );
  return {
    ...next,
    refreshToken: next.refreshToken ?? secret.refreshToken,
  };
}

function storedTokenSecret(value: unknown): TokenSecret {
  if (!isRecord(value)) {
    throw new ApiError(500, "credential_corrupt", "Stored provider credentials are invalid.");
  }
  const accessToken = value.accessToken;
  const refreshToken = value.refreshToken;
  const expiresAt = value.expiresAt;
  const tokenType = value.tokenType;
  const scope = value.scope;
  if (
    typeof accessToken !== "string" ||
    accessToken.length === 0 ||
    accessToken.length > 16_384 ||
    (refreshToken !== undefined &&
      (typeof refreshToken !== "string" || refreshToken.length === 0 || refreshToken.length > 16_384)) ||
    typeof expiresAt !== "string" ||
    !Number.isFinite(Date.parse(expiresAt)) ||
    typeof tokenType !== "string" ||
    tokenType.length === 0 ||
    tokenType.length > 64 ||
    (scope !== undefined && (typeof scope !== "string" || scope.length > 16_384))
  ) {
    throw new ApiError(500, "credential_corrupt", "Stored provider credentials are invalid.");
  }
  return {
    accessToken,
    ...(typeof refreshToken === "string" ? { refreshToken } : {}),
    expiresAt,
    tokenType,
    ...(typeof scope === "string" ? { scope } : {}),
  };
}

async function persistTokenSecret(
  env: CalendarGatewayEnv,
  connection: ConnectionRow,
  secret: TokenSecret,
): Promise<void> {
  const ciphertext = await encryptSecret(env, secret);
  await env.CALENDAR_DB.prepare(
    `UPDATE calendar_connections
        SET credential_ciphertext = ?, token_expires_at = ?, updated_at = ?
      WHERE workspace_id = ? AND principal_id = ? AND id = ?`,
  )
    .bind(
      ciphertext,
      secret.expiresAt,
      new Date().toISOString(),
      connection.workspace_id,
      connection.principal_id,
      connection.id,
    )
    .run();
}

async function authorizedToken(
  env: CalendarGatewayEnv,
  connection: ConnectionRow,
  providerFetch: ProviderFetch = fetch,
): Promise<{ readonly config: OAuthProviderConfig; readonly secret: TokenSecret }> {
  if (
    connection.mode !== "oauth" ||
    (connection.provider !== "google" && connection.provider !== "microsoft")
  ) {
    throw new ApiError(501, "provider_adapter_unavailable", "This provider adapter is not enabled.");
  }
  if (!connection.credential_ciphertext) {
    throw new ApiError(409, "authorization_pending", "Provider authorization is not complete.");
  }
  const config = oauthProviderConfig(env, connection.provider);
  if (!config) {
    throw new ApiError(503, "provider_unconfigured", "Provider OAuth is not configured.");
  }
  let secret = storedTokenSecret(
    await decryptSecret<unknown>(env, connection.credential_ciphertext),
  );
  if (Date.parse(secret.expiresAt) <= Date.now() + TOKEN_REFRESH_SKEW_MS) {
    secret = await refreshToken(config, secret, providerFetch);
    await persistTokenSecret(env, connection, secret);
  }
  return { config, secret };
}

async function syncConnection(
  request: Request,
  env: CalendarGatewayEnv,
  connectionId: string,
  providerFetch: ProviderFetch = fetch,
): Promise<Response> {
  const { workspace, principal } = await principalScope(request, env);
  const connection = await connectionById(env, workspace, principal, connectionId);
  if (connection.row.mode === "local") {
    const now = new Date().toISOString();
    await env.CALENDAR_DB.prepare(
      `UPDATE calendar_connections SET updated_at = ?, last_synced_at = ?
        WHERE workspace_id = ? AND principal_id = ? AND id = ?`,
    )
      .bind(now, now, workspace, principal, connectionId)
      .run();
    const updated = await connectionById(env, workspace, principal, connectionId);
    return json({ connection: connectionProjection(updated.row, updated.calendars) });
  }
  const { secret } = await authorizedToken(env, connection.row, providerFetch);
  const discovery = await discoverProvider(
    connection.row.provider as "google" | "microsoft",
    secret.accessToken,
    providerFetch,
  );
  await persistDiscovery(env, connection.row, discovery, secret);
  const updated = await connectionById(env, workspace, principal, connectionId);
  return json({ connection: connectionProjection(updated.row, updated.calendars) });
}

const GOOGLE_EVENT_FIELDS = [
  "nextPageToken",
  "items(id,status,summary,start,end,eventType,transparency,location,hangoutLink,conferenceData,attendees(id,email,displayName,responseStatus,optional,self),extendedProperties(private))",
].join(",");

const googleEventId = (
  kind: "event" | "freebusy",
  calendarId: string,
  providerIdentity: string,
): string =>
  `google-${kind}.${base64Url(
    new TextEncoder().encode(JSON.stringify([calendarId, providerIdentity])),
  )}`;

const eventInstant = (
  value: unknown,
): { readonly instant: string; readonly allDay: boolean } | null => {
  if (!isRecord(value)) return null;
  if (typeof value.dateTime === "string" && Number.isFinite(Date.parse(value.dateTime))) {
    return { instant: new Date(value.dateTime).toISOString(), allDay: false };
  }
  if (
    typeof value.date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/u.test(value.date) &&
    Number.isFinite(Date.parse(`${value.date}T00:00:00.000Z`))
  ) {
    return { instant: `${value.date}T00:00:00.000Z`, allDay: true };
  }
  return null;
};

export function normalizeGoogleCalendarEvent(
  value: unknown,
  calendarId: string,
): GatewayCalendarEvent | null {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.length === 0) return null;
  const start = eventInstant(value.start);
  const end = eventInstant(value.end);
  if (!start || !end || start.allDay !== end.allDay || Date.parse(end.instant) <= Date.parse(start.instant)) {
    return null;
  }
  const rawAttendees = Array.isArray(value.attendees) ? value.attendees : [];
  const attendees = rawAttendees.flatMap((candidate, index) => {
    if (!isRecord(candidate)) return [];
    const email = typeof candidate.email === "string" ? candidate.email.trim().slice(0, 320) : "";
    const displayName = typeof candidate.displayName === "string"
      ? candidate.displayName.trim().slice(0, 255)
      : "";
    const name = displayName || email || "Attendee";
    const providerId = typeof candidate.id === "string" && candidate.id
      ? candidate.id
      : email || String(index);
    return [{
      id: googleEventId("event", calendarId, `${value.id}:attendee:${providerId}`),
      name,
      email,
      kind: "external" as const,
      required: candidate.optional !== true,
    }];
  });
  const selfAttendee = rawAttendees.find(candidate => isRecord(candidate) && candidate.self === true);
  const selfResponse = isRecord(selfAttendee) ? selfAttendee.responseStatus : undefined;
  const status: GatewayCalendarEvent["status"] = value.status === "cancelled"
    ? "cancelled"
    : selfResponse === "declined"
      ? "declined"
      : value.status === "tentative" || selfResponse === "tentative" || selfResponse === "needsAction"
        ? "pending"
        : "confirmed";
  const extendedProperties = isRecord(value.extendedProperties) ? value.extendedProperties : {};
  const privateProperties = isRecord(extendedProperties.private)
    ? extendedProperties.private
    : {};
  const tapBookingKind = privateProperties.tapBookingKind;
  const kind: GatewayCalendarEvent["kind"] = tapBookingKind === "work-block"
    ? "work-block"
    : tapBookingKind === "approval-hold"
      ? "hold"
      : value.eventType === "focusTime"
        ? "focus"
        : value.eventType === "outOfOffice" || value.eventType === "workingLocation"
          ? "hold"
          : "meeting";
  const conferenceData = isRecord(value.conferenceData) ? value.conferenceData : {};
  const conferenceSolution = isRecord(conferenceData.conferenceSolution)
    ? conferenceData.conferenceSolution
    : {};
  const conferenceKey = isRecord(conferenceSolution.key) ? conferenceSolution.key : {};
  const hasGoogleMeetJoinUrl = googleMeetJoinUrl(value) !== null;
  const location: GatewayCalendarEvent["location"] =
    hasGoogleMeetJoinUrl &&
        (conferenceKey.type === "hangoutsMeet" ||
          normalizeGoogleMeetJoinUrl(value.hangoutLink) !== null)
      ? "google-meet"
      : typeof value.location === "string" && value.location.trim().length > 0
        ? "physical"
        : null;
  const summary = typeof value.summary === "string" ? value.summary.trim().slice(0, 255) : "";
  return {
    id: googleEventId("event", calendarId, value.id),
    calendarId,
    title: summary || "Busy",
    start: start.instant,
    end: end.instant,
    kind,
    status,
    location,
    attendees,
    busy: value.transparency !== "transparent",
    allDay: start.allDay,
  };
}

function normalizeGoogleFreeBusy(
  calendarId: string,
  value: unknown,
): GatewayCalendarEvent | null {
  if (!isRecord(value) || typeof value.start !== "string" || typeof value.end !== "string") {
    return null;
  }
  const start = Date.parse(value.start);
  const end = Date.parse(value.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  const startIso = new Date(start).toISOString();
  const endIso = new Date(end).toISOString();
  return {
    id: googleEventId("freebusy", calendarId, `${startIso}/${endIso}`),
    calendarId,
    title: "Busy",
    start: startIso,
    end: endIso,
    kind: "hold",
    status: "confirmed",
    location: null,
    attendees: [],
    busy: true,
    allDay: false,
  };
}

const providerQueryError = (calendarId: string, cause: unknown): EventQueryError => {
  if (cause instanceof ProviderHttpError) {
    const code = cause.providerStatus === 401
      ? "reauthorization_required"
      : cause.providerStatus === 403
        ? "provider_access_denied"
        : cause.providerStatus === 404
          ? "provider_calendar_unavailable"
          : cause.providerStatus === 429
            ? "provider_rate_limited"
            : "provider_request_failed";
    return {
      calendarId,
      code,
      message: cause.providerStatus === 401
        ? "Reconnect this provider account to resume event sync."
        : "Google Calendar could not return events for this calendar.",
    };
  }
  if (cause instanceof ApiError) {
    return { calendarId, code: cause.code, message: cause.message };
  }
  return {
    calendarId,
    code: "provider_request_failed",
    message: "Google Calendar could not return events for this calendar.",
  };
};

const GOOGLE_SYNC_EVENT_FIELDS = [
  "nextPageToken",
  "nextSyncToken",
  "items(id,status,updated,summary,start,end,eventType,transparency,location,hangoutLink,conferenceData,attendees(id,email,displayName,responseStatus,optional,self),extendedProperties(private))",
].join(",");

const logCalendarSync = (
  level: "info" | "warn" | "error",
  message: string,
  fields: Readonly<Record<string, unknown>>,
): void => {
  console[level](JSON.stringify({ message, ...fields }));
};

const connectionFromSyncTarget = (target: CalendarSyncTarget): ConnectionRow => ({
  id: target.connection_id,
  workspace_id: target.workspace_id,
  principal_id: target.principal_id,
  provider: target.provider,
  mode: target.mode,
  label: target.connection_label,
  status: target.connection_status,
  credential_ciphertext: target.credential_ciphertext,
  token_expires_at: target.token_expires_at,
  created_at: target.connection_created_at,
  updated_at: target.connection_updated_at,
  last_synced_at: target.connection_last_synced_at,
});

type AuthorizedTokenResult = Awaited<ReturnType<typeof authorizedToken>>;

interface CacheSyncInvocation {
  readonly authorizationByConnection: Map<string, Promise<AuthorizedTokenResult>>;
}

const cacheSyncInvocation = (): CacheSyncInvocation => ({
  authorizationByConnection: new Map(),
});

const authorizedTokenForCacheSync = (
  env: CalendarGatewayEnv,
  target: CalendarSyncTarget,
  providerFetch: ProviderFetch,
  invocation: CacheSyncInvocation,
): Promise<AuthorizedTokenResult> => {
  const key = `${target.workspace_id}\u0000${target.connection_id}`;
  const existing = invocation.authorizationByConnection.get(key);
  if (existing) return existing;
  const authorization = authorizedToken(
    env,
    connectionFromSyncTarget(target),
    providerFetch,
  );
  invocation.authorizationByConnection.set(key, authorization);
  return authorization;
};

async function loadCalendarSyncTargets(
  env: CalendarGatewayEnv,
  workspace: string,
  principal: string,
  calendarIds: readonly string[],
): Promise<readonly CalendarSyncTarget[]> {
  if (calendarIds.length === 0) return [];
  return (await env.CALENDAR_DB.prepare(
    `SELECT
       provider_calendars.*,
       calendar_connections.workspace_id,
       calendar_connections.principal_id,
       calendar_connections.provider,
       calendar_connections.mode,
       calendar_connections.credential_ciphertext,
       calendar_connections.token_expires_at,
       calendar_connections.label AS connection_label,
       calendar_connections.status AS connection_status,
       calendar_connections.created_at AS connection_created_at,
       calendar_connections.updated_at AS connection_updated_at,
       calendar_connections.last_synced_at AS connection_last_synced_at
     FROM provider_calendars
     INNER JOIN calendar_connections
       ON calendar_connections.id = provider_calendars.connection_id
     WHERE calendar_connections.workspace_id = ?
       AND calendar_connections.principal_id = ?
       AND provider_calendars.id IN (${calendarIds.map(() => "?").join(", ")})`,
  )
    .bind(workspace, principal, ...calendarIds)
    .all<CalendarSyncTarget>()).results;
}

async function ensureCalendarSyncState(
  env: CalendarGatewayEnv,
  target: CalendarSyncTarget,
): Promise<CalendarSyncStateRow> {
  const now = new Date().toISOString();
  await env.CALENDAR_DB.prepare(
    `INSERT OR IGNORE INTO calendar_sync_state
      (workspace_id, connection_id, calendar_id, active_generation, cache_revision, sync_token,
       cache_time_min, freshness, last_attempt_at, last_success_at, next_sync_at,
       error_code, error_message, consecutive_failures, lease_until,
       current_watch_channel_id, watch_expiration_at, last_notification_at)
     VALUES (?, ?, ?, ?, 0, NULL, NULL, 'pending', NULL, NULL, ?, NULL, NULL, 0,
             NULL, NULL, NULL, NULL)`,
  )
    .bind(
      target.workspace_id,
      target.connection_id,
      target.id,
      `initial-${crypto.randomUUID()}`,
      now,
    )
    .run();
  const state = await env.CALENDAR_DB.prepare(
    `SELECT * FROM calendar_sync_state
      WHERE workspace_id = ? AND connection_id = ? AND calendar_id = ?`,
  )
    .bind(target.workspace_id, target.connection_id, target.id)
    .first<CalendarSyncStateRow>();
  if (!state) {
    throw new ApiError(500, "cache_state_unavailable", "Calendar cache state is unavailable.");
  }
  return state;
}

const cacheFailureDelay = (consecutiveFailures: number): number =>
  Math.min(
    60 * 60 * 1000,
    CACHE_ERROR_RETRY_BASE_MS * 2 ** Math.min(consecutiveFailures, 4),
  );

async function recordCacheSyncFailure(
  env: CalendarGatewayEnv,
  state: CalendarSyncStateRow,
  error: EventQueryError,
  leaseUntil: string,
): Promise<void> {
  const nextSyncAt = new Date(
    Date.now() + cacheFailureDelay(state.consecutive_failures),
  ).toISOString();
  await env.CALENDAR_DB.prepare(
    `UPDATE calendar_sync_state
        SET freshness = CASE WHEN last_success_at IS NULL THEN 'error' ELSE 'stale' END,
            error_code = ?, error_message = ?, consecutive_failures = consecutive_failures + 1,
            next_sync_at = ?, lease_until = NULL
      WHERE workspace_id = ? AND connection_id = ? AND calendar_id = ?
        AND lease_until = ?`,
  )
    .bind(
      error.code,
      error.message.slice(0, 500),
      nextSyncAt,
      state.workspace_id,
      state.connection_id,
      state.calendar_id,
      leaseUntil,
    )
    .run();
}

interface GoogleCacheMutation {
  readonly providerEventId: string;
  readonly eventId: string;
  readonly start: string | null;
  readonly end: string | null;
  readonly tombstoned: boolean;
  readonly payload: Readonly<Record<string, unknown>> | GatewayCalendarEvent;
  readonly providerUpdatedAt: string | null;
}

interface GoogleSyncCollection {
  readonly mutations: readonly GoogleCacheMutation[];
  readonly nextSyncToken: string;
  readonly fullSync: boolean;
  readonly cacheTimeMin: string | null;
  readonly cacheTimeMax: string | null;
}

const googleCacheMutation = (
  value: unknown,
  calendarId: string,
): GoogleCacheMutation | null => {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.length === 0) return null;
  const providerEventId = value.id.slice(0, 2048);
  const providerUpdatedAt = typeof value.updated === "string" &&
      Number.isFinite(Date.parse(value.updated))
    ? new Date(value.updated).toISOString()
    : null;
  const cancelled = value.status === "cancelled";
  const event = cancelled ? null : normalizeGoogleCalendarEvent(value, calendarId);
  if (!event) {
    return {
      providerEventId,
      eventId: googleEventId("event", calendarId, providerEventId),
      start: null,
      end: null,
      tombstoned: true,
      payload: { id: providerEventId, status: "cancelled" },
      providerUpdatedAt,
    };
  }
  return {
    providerEventId,
    eventId: event.id,
    start: event.start,
    end: event.end,
    tombstoned: false,
    payload: event,
    providerUpdatedAt,
  };
};

async function collectGoogleCalendarChanges(
  target: CalendarSyncTarget,
  accessToken: string,
  syncToken: string | null,
  providerFetch: ProviderFetch,
  fullSyncFutureMs = CACHE_ROLLING_FUTURE_MS,
): Promise<GoogleSyncCollection> {
  const mutations: GoogleCacheMutation[] = [];
  const fullSync = !syncToken;
  const cacheTimeMin = fullSync
    ? new Date(Date.now() - CACHE_INITIAL_HISTORY_MS).toISOString()
    : null;
  const cacheTimeMax = fullSync
    ? new Date(Date.now() + fullSyncFutureMs).toISOString()
    : null;
  let pageToken: string | null = null;
  let nextSyncToken: string | null = null;
  let pageCount = 0;
  do {
    pageCount += 1;
    if (pageCount > MAX_EVENT_PROVIDER_PAGES) {
      throw new ApiError(
        502,
        "provider_pagination_limit",
        "Google Calendar initial synchronization exceeded its safe page limit.",
      );
    }
    const url = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(target.provider_calendar_id)}/events`,
    );
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("showDeleted", "true");
    url.searchParams.set("maxResults", String(CACHE_EVENT_PAGE_SIZE));
    url.searchParams.set("maxAttendees", String(MAX_EVENT_ATTENDEES));
    url.searchParams.set("fields", GOOGLE_SYNC_EVENT_FIELDS);
    if (syncToken) url.searchParams.set("syncToken", syncToken);
    else {
      url.searchParams.set("timeMin", cacheTimeMin!);
      url.searchParams.set("timeMax", cacheTimeMax!);
    }
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const page = await externalJson(
      url.href,
      { headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` } },
      providerFetch,
    );
    if (page.items !== undefined && !Array.isArray(page.items)) {
      throw new ApiError(502, "provider_response_invalid", "Google returned an invalid event list.");
    }
    for (const item of Array.isArray(page.items) ? page.items : []) {
      const mutation = googleCacheMutation(item, target.id);
      if (mutation) mutations.push(mutation);
      if (mutations.length > MAX_CACHE_SYNC_EVENTS) {
        throw new ApiError(
          502,
          "event_limit_reached",
          "Google Calendar synchronization exceeded its safe event limit.",
        );
      }
    }
    if (page.nextPageToken !== undefined && typeof page.nextPageToken !== "string") {
      throw new ApiError(502, "provider_response_invalid", "Google returned an invalid page token.");
    }
    if (page.nextSyncToken !== undefined && typeof page.nextSyncToken !== "string") {
      throw new ApiError(502, "provider_response_invalid", "Google returned an invalid sync token.");
    }
    pageToken = typeof page.nextPageToken === "string" ? page.nextPageToken : null;
    nextSyncToken = typeof page.nextSyncToken === "string" ? page.nextSyncToken : nextSyncToken;
  } while (pageToken);
  if (!nextSyncToken) {
    throw new ApiError(502, "provider_sync_token_missing", "Google did not return a sync token.");
  }
  return { mutations, nextSyncToken, fullSync, cacheTimeMin, cacheTimeMax };
}

async function collectGoogleRollingSnapshot(
  target: CalendarSyncTarget,
  accessToken: string,
  providerFetch: ProviderFetch,
): Promise<GoogleSyncCollection> {
  let lastError: unknown;
  for (const futureWindowMs of CACHE_BOOTSTRAP_FUTURE_WINDOWS_MS) {
    try {
      return await collectGoogleCalendarChanges(
        target,
        accessToken,
        null,
        providerFetch,
        futureWindowMs,
      );
    } catch (error) {
      lastError = error;
      if (
        !(error instanceof ApiError) ||
        !["provider_pagination_limit", "event_limit_reached"].includes(error.code)
      ) throw error;
      logCalendarSync("warn", "calendar rolling bootstrap window reduced", {
        workspace_id: target.workspace_id,
        connection_id: target.connection_id,
        calendar_id: target.id,
        attempted_future_days: Math.round(futureWindowMs / (24 * 60 * 60 * 1000)),
        error_code: error.code,
      });
    }
  }
  throw lastError;
}

async function writeGoogleCacheMutations(
  env: CalendarGatewayEnv,
  state: CalendarSyncStateRow,
  generation: string,
  mutations: readonly GoogleCacheMutation[],
): Promise<void> {
  const cachedAt = new Date().toISOString();
  for (let offset = 0; offset < mutations.length; offset += CACHE_WRITE_BATCH_SIZE) {
    const chunk = mutations.slice(offset, offset + CACHE_WRITE_BATCH_SIZE);
    await env.CALENDAR_DB.batch(chunk.map(mutation =>
      env.CALENDAR_DB.prepare(
        `INSERT INTO calendar_event_cache
          (workspace_id, connection_id, calendar_id, provider_event_id, sync_generation,
           event_id, start_at, end_at, tombstoned, payload_json, provider_updated_at, cached_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT
          (workspace_id, connection_id, calendar_id, provider_event_id, sync_generation)
         DO UPDATE SET
          event_id = excluded.event_id,
          start_at = excluded.start_at,
          end_at = excluded.end_at,
          tombstoned = excluded.tombstoned,
          payload_json = excluded.payload_json,
          provider_updated_at = excluded.provider_updated_at,
          cached_at = excluded.cached_at`,
      ).bind(
        state.workspace_id,
        state.connection_id,
        state.calendar_id,
        mutation.providerEventId,
        generation,
        mutation.eventId,
        mutation.start,
        mutation.end,
        mutation.tombstoned ? 1 : 0,
        JSON.stringify(mutation.payload),
        mutation.providerUpdatedAt,
        cachedAt,
      )
    ));
  }
}

const configuredWebhookBase = (env: CalendarGatewayEnv): URL | null => {
  if (!env.PUBLIC_BASE_URL?.trim()) return null;
  try {
    const value = new URL(env.PUBLIC_BASE_URL);
    if (value.protocol !== "https:" || value.username || value.password) return null;
    return value;
  } catch {
    return null;
  }
};

const secureTokenMatches = async (provided: string, expectedHash: string): Promise<boolean> => {
  const providedHash = await sha256(provided);
  return crypto.subtle.timingSafeEqual(fromBase64(providedHash), fromBase64(expectedHash));
};

async function ensureGoogleWatch(
  env: CalendarGatewayEnv,
  target: CalendarSyncTarget,
  state: CalendarSyncStateRow,
  accessToken: string,
  providerFetch: ProviderFetch,
): Promise<void> {
  const base = configuredWebhookBase(env);
  if (!base) return;
  if (
    state.watch_expiration_at &&
    Date.parse(state.watch_expiration_at) > Date.now() + WATCH_RENEWAL_WINDOW_MS
  ) return;
  const channelId = crypto.randomUUID();
  const channelToken = randomValue(32);
  const tokenHash = await sha256(channelToken);
  const address = new URL("/v1/webhooks/google/calendar", base).href;
  const response = await externalJson(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(target.provider_calendar_id)}/events/watch`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: channelId,
        type: "web_hook",
        address,
        token: channelToken,
        params: { ttl: String(WATCH_TTL_SECONDS) },
      }),
    },
    providerFetch,
  );
  if (response.id !== channelId || typeof response.resourceId !== "string") {
    throw new ApiError(502, "provider_watch_invalid", "Google returned an invalid watch channel.");
  }
  const expirationValue = typeof response.expiration === "number"
    ? response.expiration
    : typeof response.expiration === "string"
      ? Number(response.expiration)
      : Number.NaN;
  const expirationAt = Number.isFinite(expirationValue)
    ? new Date(expirationValue).toISOString()
    : new Date(Date.now() + WATCH_TTL_SECONDS * 1000).toISOString();
  const now = new Date().toISOString();
  await env.CALENDAR_DB.batch([
    env.CALENDAR_DB.prepare(
      `INSERT INTO calendar_watch_channels
        (channel_id, workspace_id, connection_id, calendar_id, token_hash, resource_id,
         expiration_at, created_at, last_notification_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).bind(
      channelId,
      target.workspace_id,
      target.connection_id,
      target.id,
      tokenHash,
      response.resourceId,
      expirationAt,
      now,
    ),
    env.CALENDAR_DB.prepare(
      `UPDATE calendar_sync_state
          SET current_watch_channel_id = ?, watch_expiration_at = ?
        WHERE workspace_id = ? AND connection_id = ? AND calendar_id = ?`,
    ).bind(
      channelId,
      expirationAt,
      target.workspace_id,
      target.connection_id,
      target.id,
    ),
    env.CALENDAR_DB.prepare(
      "DELETE FROM calendar_watch_channels WHERE expiration_at <= ?",
    ).bind(now),
  ]);
}

async function syncGoogleCalendarCache(
  env: CalendarGatewayEnv,
  target: CalendarSyncTarget,
  providerFetch: ProviderFetch = fetch,
  invocation: CacheSyncInvocation = cacheSyncInvocation(),
  forceFullSync = false,
): Promise<CacheSyncOutcome> {
  let state = await ensureCalendarSyncState(env, target);
  const now = new Date();
  const leaseUntil = new Date(now.valueOf() + CACHE_SYNC_LEASE_MS).toISOString();
  const lease = await env.CALENDAR_DB.prepare(
    `UPDATE calendar_sync_state
        SET lease_until = ?, last_attempt_at = ?
      WHERE workspace_id = ? AND connection_id = ? AND calendar_id = ?
        AND (lease_until IS NULL OR lease_until <= ?)`,
  )
    .bind(
      leaseUntil,
      now.toISOString(),
      state.workspace_id,
      state.connection_id,
      state.calendar_id,
      now.toISOString(),
    )
    .run();
  if (Number(lease.meta.changes ?? 0) === 0) {
    return {
      calendarId: target.id,
      synced: false,
      skipped: true,
      fullSync: false,
      resyncedAfterTokenExpiry: false,
      changedEvents: 0,
    };
  }
  // State may have advanced between the pre-lease read and this lease acquisition. Reload it
  // so an incremental generation always clones the latest committed snapshot and sync token.
  state = await ensureCalendarSyncState(env, target);
  try {
    const { secret } = await authorizedTokenForCacheSync(
      env,
      target,
      providerFetch,
      invocation,
    );
    const rollingCoverageRefreshDue = !state.cache_time_max ||
      Date.parse(state.cache_time_max) <= Date.now() + CACHE_ROLLING_REBUILD_MARGIN_MS;
    const requestedSyncToken = forceFullSync || rollingCoverageRefreshDue
      ? null
      : state.sync_token;
    let resyncedAfterTokenExpiry = false;
    let collection: GoogleSyncCollection;
    try {
      collection = requestedSyncToken
        ? await collectGoogleCalendarChanges(
          target,
          secret.accessToken,
          requestedSyncToken,
          providerFetch,
        )
        : await collectGoogleRollingSnapshot(target, secret.accessToken, providerFetch);
    } catch (error) {
      if (!(error instanceof ProviderHttpError) || error.providerStatus !== 410 || !requestedSyncToken) {
        throw error;
      }
      resyncedAfterTokenExpiry = true;
      collection = await collectGoogleRollingSnapshot(
        target,
        secret.accessToken,
        providerFetch,
      );
    }
    // Every sync stages a new immutable generation. The active pointer and revision change
    // together only after every page has been written, so readers never observe a partial
    // incremental update with an old proof revision.
    const generation = `sync-${crypto.randomUUID()}`;
    if (!collection.fullSync) {
      await env.CALENDAR_DB.prepare(
        `INSERT INTO calendar_event_cache
          (workspace_id, connection_id, calendar_id, provider_event_id, sync_generation,
           event_id, start_at, end_at, tombstoned, payload_json, provider_updated_at, cached_at)
         SELECT workspace_id, connection_id, calendar_id, provider_event_id, ?,
                event_id, start_at, end_at, tombstoned, payload_json, provider_updated_at, cached_at
           FROM calendar_event_cache
          WHERE workspace_id = ? AND connection_id = ? AND calendar_id = ?
            AND sync_generation = ?`,
      )
        .bind(
          generation,
          state.workspace_id,
          state.connection_id,
          state.calendar_id,
          state.active_generation,
        )
        .run();
    }
    await writeGoogleCacheMutations(env, state, generation, collection.mutations);
    const completedAt = new Date().toISOString();
    const nextSyncAt = new Date(Date.now() + CACHE_REPAIR_INTERVAL_MS).toISOString();
    const commit = await env.CALENDAR_DB.prepare(
      `UPDATE calendar_sync_state
          SET active_generation = ?, cache_revision = cache_revision + 1, sync_token = ?,
              cache_time_min = COALESCE(?, cache_time_min),
              cache_time_max = COALESCE(?, cache_time_max), freshness = 'fresh',
              last_success_at = ?, next_sync_at = ?, error_code = NULL,
              error_message = NULL, consecutive_failures = 0, lease_until = NULL
        WHERE workspace_id = ? AND connection_id = ? AND calendar_id = ?
          AND lease_until = ? AND active_generation = ? AND cache_revision = ?`,
    ).bind(
      generation,
      collection.nextSyncToken,
      collection.cacheTimeMin,
      collection.cacheTimeMax,
      completedAt,
      nextSyncAt,
      state.workspace_id,
      state.connection_id,
      state.calendar_id,
      leaseUntil,
      state.active_generation,
      state.cache_revision,
    ).run();
    if (Number(commit.meta.changes ?? 0) === 0) {
      await env.CALENDAR_DB.prepare(
        `DELETE FROM calendar_event_cache
          WHERE workspace_id = ? AND connection_id = ? AND calendar_id = ?
            AND sync_generation = ?`,
      )
        .bind(state.workspace_id, state.connection_id, state.calendar_id, generation)
        .run();
      return {
        calendarId: target.id,
        synced: false,
        skipped: true,
        fullSync: collection.fullSync,
        resyncedAfterTokenExpiry,
        changedEvents: 0,
      };
    }
    try {
      await env.CALENDAR_DB.prepare(
        `DELETE FROM calendar_event_cache
          WHERE workspace_id = ? AND connection_id = ? AND calendar_id = ?
            AND sync_generation <> ?`,
      )
        .bind(state.workspace_id, state.connection_id, state.calendar_id, generation)
        .run();
    } catch (error) {
      logCalendarSync("warn", "calendar cache generation cleanup failed", {
        workspace_id: target.workspace_id,
        connection_id: target.connection_id,
        calendar_id: target.id,
        error: error instanceof Error ? error.message : "unknown error",
      });
    }
    state = (await ensureCalendarSyncState(env, target));
    try {
      await ensureGoogleWatch(env, target, state, secret.accessToken, providerFetch);
    } catch (error) {
      logCalendarSync("warn", "calendar watch registration failed", {
        workspace_id: target.workspace_id,
        connection_id: target.connection_id,
        calendar_id: target.id,
        error: error instanceof Error ? error.message : "unknown error",
      });
    }
    logCalendarSync("info", "calendar cache synchronized", {
      workspace_id: target.workspace_id,
      connection_id: target.connection_id,
      calendar_id: target.id,
      full_sync: collection.fullSync,
      resynced_after_token_expiry: resyncedAfterTokenExpiry,
      changed_events: collection.mutations.length,
      cache_time_min: collection.cacheTimeMin ?? state.cache_time_min,
      cache_time_max: collection.cacheTimeMax ?? state.cache_time_max,
    });
    return {
      calendarId: target.id,
      synced: true,
      skipped: false,
      fullSync: collection.fullSync,
      resyncedAfterTokenExpiry,
      changedEvents: collection.mutations.length,
    };
  } catch (cause) {
    const error = providerQueryError(target.id, cause);
    await recordCacheSyncFailure(env, state, error, leaseUntil);
    logCalendarSync("error", "calendar cache synchronization failed", {
      workspace_id: target.workspace_id,
      connection_id: target.connection_id,
      calendar_id: target.id,
      error_code: error.code,
    });
    return {
      calendarId: target.id,
      synced: false,
      skipped: false,
      fullSync: state.sync_token === null,
      resyncedAfterTokenExpiry: false,
      changedEvents: 0,
      error,
    };
  }
}

async function listGoogleCalendarEvents(
  calendar: CalendarRow,
  accessToken: string,
  input: EventQueryInput,
  budget: EventQueryBudget,
  providerFetch: ProviderFetch,
): Promise<CalendarEventQueryResult> {
  const events: GatewayCalendarEvent[] = [];
  const errors: EventQueryError[] = [];
  const seen = new Set<string>();
  let pageToken: string | null = null;
  let pageCount = 0;
  let complete = true;
  do {
    if (budget.remaining <= 0) {
      budget.truncated = true;
      complete = false;
      errors.push({
        calendarId: calendar.id,
        code: "event_limit_reached",
        message: "The event result limit was reached. Query a narrower time range.",
      });
      break;
    }
    pageCount += 1;
    if (pageCount > MAX_EVENT_PROVIDER_PAGES) {
      budget.truncated = true;
      complete = false;
      errors.push({
        calendarId: calendar.id,
        code: "provider_pagination_limit",
        message: "Google Calendar returned too many event pages. Query a narrower time range.",
      });
      break;
    }
    const url = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.provider_calendar_id)}/events`,
    );
    url.searchParams.set("timeMin", input.timeMin);
    url.searchParams.set("timeMax", input.timeMax);
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("showDeleted", "false");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("timeZone", "UTC");
    url.searchParams.set("maxResults", String(EVENT_PAGE_SIZE));
    // A range view needs enough attendee context for recognition, not a full
    // directory export. Keeping this bounded also stays below TAP's governed
    // host-action envelope for calendars with large recurring meetings.
    url.searchParams.set("maxAttendees", String(MAX_EVENT_ATTENDEES));
    url.searchParams.set("fields", GOOGLE_EVENT_FIELDS);
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const page = await externalJson(
      url.href,
      { headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` } },
      providerFetch,
    );
    if (page.items !== undefined && !Array.isArray(page.items)) {
      throw new ApiError(502, "provider_response_invalid", "Google returned an invalid event list.");
    }
    let invalidItems = 0;
    for (const item of Array.isArray(page.items) ? page.items : []) {
      const event = normalizeGoogleCalendarEvent(item, calendar.id);
      if (!event) {
        invalidItems += 1;
        continue;
      }
      if (seen.has(event.id)) continue;
      seen.add(event.id);
      if (budget.remaining <= 0) {
        budget.truncated = true;
        complete = false;
        break;
      }
      events.push(event);
      budget.remaining -= 1;
    }
    if (invalidItems > 0) {
      complete = false;
      errors.push({
        calendarId: calendar.id,
        code: "provider_event_invalid",
        message: `${invalidItems} Google event${invalidItems === 1 ? " was" : "s were"} skipped because required fields were invalid.`,
      });
    }
    if (budget.remaining <= 0 && typeof page.nextPageToken === "string") {
      budget.truncated = true;
      complete = false;
    }
    if (page.nextPageToken !== undefined && typeof page.nextPageToken !== "string") {
      throw new ApiError(502, "provider_response_invalid", "Google returned an invalid page token.");
    }
    pageToken = budget.remaining > 0 && typeof page.nextPageToken === "string"
      ? page.nextPageToken
      : null;
  } while (pageToken);
  return { calendarId: calendar.id, events, synced: complete, errors };
}

async function mapWithConcurrency<Input, Output>(
  values: readonly Input[],
  concurrency: number,
  mapper: (value: Input) => Promise<Output>,
): Promise<readonly Output[]> {
  const results: Output[] = new Array(values.length);
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= values.length) return;
      results[index] = await mapper(values[index]!);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker()),
  );
  return results;
}

async function queryGoogleFreeBusy(
  calendars: readonly CalendarRow[],
  accessToken: string,
  input: EventQueryInput,
  budget: EventQueryBudget,
  providerFetch: ProviderFetch,
): Promise<readonly CalendarEventQueryResult[]> {
  if (calendars.length === 0) return [];
  let page: Readonly<Record<string, unknown>>;
  try {
    page = await externalJson(
      "https://www.googleapis.com/calendar/v3/freeBusy",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          timeMin: input.timeMin,
          timeMax: input.timeMax,
          items: calendars.map(calendar => ({ id: calendar.provider_calendar_id })),
        }),
      },
      providerFetch,
    );
  } catch (cause) {
    return calendars.map(calendar => ({
      calendarId: calendar.id,
      events: [],
      synced: false,
      errors: [providerQueryError(calendar.id, cause)],
    }));
  }
  const providerCalendars = page.calendars;
  const responseTimeMin = typeof page.timeMin === "string" ? Date.parse(page.timeMin) : NaN;
  const responseTimeMax = typeof page.timeMax === "string" ? Date.parse(page.timeMax) : NaN;
  if (
    !isRecord(providerCalendars) ||
    !Number.isFinite(responseTimeMin) ||
    !Number.isFinite(responseTimeMax) ||
    responseTimeMin !== Date.parse(input.timeMin) ||
    responseTimeMax !== Date.parse(input.timeMax)
  ) {
    return calendars.map(calendar => ({
      calendarId: calendar.id,
      events: [],
      synced: false,
      errors: [{
        calendarId: calendar.id,
        code: "provider_response_invalid",
        message: "Google returned an invalid free/busy response.",
      }],
    }));
  }
  return calendars.map(calendar => {
    const providerCalendar = providerCalendars[calendar.provider_calendar_id];
    if (
      !isRecord(providerCalendar) ||
      !Array.isArray(providerCalendar.busy) ||
      (providerCalendar.errors !== undefined && !Array.isArray(providerCalendar.errors))
    ) {
      return {
        calendarId: calendar.id,
        events: [],
        synced: false,
        errors: [{
          calendarId: calendar.id,
          code: "provider_response_invalid",
          message: "Google returned invalid free/busy data for this calendar.",
        }],
      };
    }
    if (Array.isArray(providerCalendar.errors) && providerCalendar.errors.length > 0) {
      return {
        calendarId: calendar.id,
        events: [],
        synced: false,
        errors: [{
          calendarId: calendar.id,
          code: "provider_access_denied",
          message: "Google Calendar could not return free/busy data for this calendar.",
        }],
      };
    }
    const events: GatewayCalendarEvent[] = [];
    let invalidItems = 0;
    let complete = true;
    for (const value of Array.isArray(providerCalendar.busy) ? providerCalendar.busy : []) {
      const event = normalizeGoogleFreeBusy(calendar.id, value);
      if (!event) {
        invalidItems += 1;
        continue;
      }
      if (budget.remaining <= 0) {
        budget.truncated = true;
        complete = false;
        break;
      }
      events.push(event);
      budget.remaining -= 1;
    }
    const errors: EventQueryError[] = [];
    if (invalidItems > 0) {
      complete = false;
      errors.push({
        calendarId: calendar.id,
        code: "provider_event_invalid",
        message: `${invalidItems} free/busy interval${invalidItems === 1 ? " was" : "s were"} skipped because it was invalid.`,
      });
    }
    if (!complete && budget.remaining <= 0) {
      errors.push({
        calendarId: calendar.id,
        code: "event_limit_reached",
        message: "The event result limit was reached. Query a narrower time range.",
      });
    }
    return { calendarId: calendar.id, events, synced: complete, errors };
  });
}

export interface PublicBusyInterval {
  readonly start: string;
  readonly end: string;
}

/**
 * Reads privacy-minimal live availability for an already server-resolved
 * public page. Every configured calendar must be reachable through the
 * published owner scope and answer conclusively; public callers never receive
 * provider/calendar diagnostics.
 */
export async function queryPublicGoogleBusyIntervals(
  env: CalendarGatewayEnv,
  scope: CalendarPrincipalScope,
  input: EventQueryInput,
  providerFetch: ProviderFetch = fetch,
): Promise<readonly PublicBusyInterval[]> {
  const targets = await loadCalendarSyncTargets(
    env,
    scope.workspace,
    scope.principal,
    input.calendarIds,
  );
  if (
    targets.length !== input.calendarIds.length ||
    targets.some(target =>
      target.provider !== "google" || target.mode !== "oauth" ||
      target.connection_status !== "connected"
    )
  ) {
    throw new ApiError(
      503,
      "public_availability_unavailable",
      "Availability could not be checked. Try again shortly.",
    );
  }

  const byConnection = new Map<string, CalendarSyncTarget[]>();
  for (const target of targets) {
    const group = byConnection.get(target.connection_id) ?? [];
    group.push(target);
    byConnection.set(target.connection_id, group);
  }
  const invocation = cacheSyncInvocation();
  const budget: EventQueryBudget = {
    remaining: MAX_EVENT_QUERY_EVENTS,
    truncated: false,
  };
  const intervals: PublicBusyInterval[] = [];
  try {
    for (const group of byConnection.values()) {
      const authorization = await authorizedTokenForCacheSync(
        env,
        group[0]!,
        providerFetch,
        invocation,
      );
      const results = await queryGoogleFreeBusy(
        group,
        authorization.secret.accessToken,
        input,
        budget,
        providerFetch,
      );
      if (
        results.length !== group.length ||
        results.some(result => !result.synced || result.errors.length > 0)
      ) {
        throw new Error("inconclusive provider response");
      }
      for (const result of results) {
        for (const event of result.events) {
          intervals.push({ start: event.start, end: event.end });
        }
      }
    }
  } catch {
    throw new ApiError(
      503,
      "public_availability_unavailable",
      "Availability could not be checked. Try again shortly.",
    );
  }
  if (budget.truncated) {
    throw new ApiError(
      503,
      "public_availability_unavailable",
      "Availability could not be checked. Try again shortly.",
    );
  }
  return intervals.sort((left, right) =>
    left.start.localeCompare(right.start) || left.end.localeCompare(right.end)
  );
}

async function queryLiveEventsForScope(
  scope: CalendarPrincipalScope,
  input: EventQueryInput,
  env: CalendarGatewayEnv,
  providerFetch: ProviderFetch = fetch,
): Promise<EventQueryPayload> {
  const { workspace, principal } = scope;
  const placeholders = input.calendarIds.map(() => "?").join(", ");
  const calendarRows = await env.CALENDAR_DB.prepare(
    `SELECT provider_calendars.* FROM provider_calendars
       INNER JOIN calendar_connections ON calendar_connections.id = provider_calendars.connection_id
      WHERE calendar_connections.workspace_id = ?
        AND calendar_connections.principal_id = ?
        AND provider_calendars.id IN (${placeholders})`,
  )
    .bind(workspace, principal, ...input.calendarIds)
    .all<CalendarRow>();
  const calendarsById = new Map(calendarRows.results.map(calendar => [calendar.id, calendar] as const));
  const errors: EventQueryError[] = input.calendarIds
    .filter(calendarId => !calendarsById.has(calendarId))
    .map(calendarId => ({
      calendarId,
      code: "calendar_not_found",
      message: "The calendar was not found in this workspace.",
    }));
  const connectionIds = [...new Set(calendarRows.results.map(calendar => calendar.connection_id))];
  const connections = connectionIds.length === 0
    ? []
    : (await env.CALENDAR_DB.prepare(
        `SELECT * FROM calendar_connections
          WHERE workspace_id = ? AND principal_id = ?
            AND id IN (${connectionIds.map(() => "?").join(", ")})`,
      )
        .bind(workspace, principal, ...connectionIds)
        .all<ConnectionRow>()).results;
  const connectionsById = new Map(connections.map(connection => [connection.id, connection] as const));
  const budget: EventQueryBudget = { remaining: MAX_EVENT_QUERY_EVENTS, truncated: false };
  const eventMap = new Map<string, GatewayCalendarEvent>();
  const synced = new Set<string>();

  for (const connectionId of connectionIds) {
    const connection = connectionsById.get(connectionId);
    const calendars = calendarRows.results.filter(calendar => calendar.connection_id === connectionId);
    if (!connection) {
      errors.push(...calendars.map(calendar => ({
        calendarId: calendar.id,
        code: "connection_not_found",
        message: "The calendar connection was not found in this workspace.",
      })));
      continue;
    }
    if (connection.provider !== "google" || connection.mode !== "oauth") {
      errors.push(...calendars.map(calendar => ({
        calendarId: calendar.id,
        code: "provider_adapter_unavailable",
        message: "Live event queries are not available for this calendar connection.",
      })));
      continue;
    }
    let accessToken: string;
    try {
      accessToken = (await authorizedToken(env, connection, providerFetch)).secret.accessToken;
    } catch (cause) {
      errors.push(...calendars.map(calendar => providerQueryError(calendar.id, cause)));
      continue;
    }
    const readable = calendars.filter(calendar => calendar.role !== "free-busy");
    const freeBusy = calendars.filter(calendar => calendar.role === "free-busy");
    const readableResults = await mapWithConcurrency(
      readable,
      EVENT_QUERY_CONCURRENCY,
      async calendar => {
        try {
          return await listGoogleCalendarEvents(
            calendar,
            accessToken,
            input,
            budget,
            providerFetch,
          );
        } catch (cause) {
          return {
            calendarId: calendar.id,
            events: [],
            synced: false,
            errors: [providerQueryError(calendar.id, cause)],
          };
        }
      },
    );
    const freeBusyResults = await queryGoogleFreeBusy(
      freeBusy,
      accessToken,
      input,
      budget,
      providerFetch,
    );
    for (const result of [...readableResults, ...freeBusyResults]) {
      for (const event of result.events) eventMap.set(event.id, event);
      if (result.synced) synced.add(result.calendarId);
      errors.push(...result.errors);
    }
  }

  const events = [...eventMap.values()].sort((left, right) =>
    left.start.localeCompare(right.start) || left.id.localeCompare(right.id)
  );
  return {
    timeMin: input.timeMin,
    timeMax: input.timeMax,
    syncedAt: new Date().toISOString(),
    events,
    syncedCalendarIds: input.calendarIds.filter(calendarId => synced.has(calendarId)),
    errors,
    truncated: budget.truncated,
  };
}

async function queryLiveEvents(
  request: Request,
  env: CalendarGatewayEnv,
  providerFetch: ProviderFetch = fetch,
): Promise<Response> {
  const scope = await principalScope(request, env);
  const input = eventQueryInput(await readJson(request));
  return json(await queryLiveEventsForScope(scope, input, env, providerFetch));
}

interface EventQueryPayload {
  readonly timeMin: string;
  readonly timeMax: string;
  readonly syncedAt: string;
  readonly events: readonly GatewayCalendarEvent[];
  readonly syncedCalendarIds: readonly string[];
  readonly errors: readonly EventQueryError[];
  readonly truncated: boolean;
}

interface CacheCalendarProof {
  readonly calendarId: string;
  readonly cacheRevision: number;
  readonly freshness: CalendarSyncStateRow["freshness"];
  readonly lastSuccessAt: string | null;
  readonly nextSyncAt: string;
  readonly coverageTimeMin: string | null;
  readonly coverageTimeMax: string | null;
  readonly coversRequestedRange: boolean;
  readonly error: { readonly code: string; readonly message: string } | null;
}

const parseCachedEvent = (row: CachedEventRow): GatewayCalendarEvent | null => {
  try {
    const value: unknown = JSON.parse(row.payload_json);
    if (
      !isRecord(value) ||
      typeof value.id !== "string" ||
      value.calendarId !== row.calendar_id ||
      typeof value.title !== "string" ||
      typeof value.start !== "string" ||
      typeof value.end !== "string" ||
      !Array.isArray(value.attendees)
    ) return null;
    return value as unknown as GatewayCalendarEvent;
  } catch {
    return null;
  }
};

async function loadCalendarSyncStates(
  env: CalendarGatewayEnv,
  workspace: string,
  calendarIds: readonly string[],
): Promise<readonly CalendarSyncStateRow[]> {
  if (calendarIds.length === 0) return [];
  return (await env.CALENDAR_DB.prepare(
    `SELECT * FROM calendar_sync_state
      WHERE workspace_id = ?
        AND calendar_id IN (${calendarIds.map(() => "?").join(", ")})`,
  )
    .bind(workspace, ...calendarIds)
    .all<CalendarSyncStateRow>()).results;
}

async function waitForLeasedCacheSyncs(
  env: CalendarGatewayEnv,
  workspace: string,
  calendarIds: readonly string[],
  priorRevisions: ReadonlyMap<string, number>,
): Promise<void> {
  if (calendarIds.length === 0) return;
  for (let attempt = 0; attempt < CACHE_LEASE_WAIT_ATTEMPTS; attempt += 1) {
    await scheduler.wait(CACHE_LEASE_WAIT_MS);
    const states = await loadCalendarSyncStates(env, workspace, calendarIds);
    const pending = states.some(state =>
      state.cache_revision <= (priorRevisions.get(state.calendar_id) ?? -1) &&
      state.lease_until !== null &&
      Date.parse(state.lease_until) > Date.now()
    );
    if (!pending) return;
  }
}

async function loadCachedEvents(
  env: CalendarGatewayEnv,
  workspace: string,
  input: EventQueryInput,
  calendarIds: readonly string[],
): Promise<{ readonly events: readonly GatewayCalendarEvent[]; readonly truncated: boolean }> {
  if (calendarIds.length === 0) return { events: [], truncated: false };
  const rows = (await env.CALENDAR_DB.prepare(
    `SELECT calendar_event_cache.calendar_id, calendar_event_cache.payload_json
       FROM calendar_event_cache
       INNER JOIN calendar_sync_state
         ON calendar_sync_state.workspace_id = calendar_event_cache.workspace_id
        AND calendar_sync_state.connection_id = calendar_event_cache.connection_id
        AND calendar_sync_state.calendar_id = calendar_event_cache.calendar_id
        AND calendar_sync_state.active_generation = calendar_event_cache.sync_generation
      WHERE calendar_event_cache.workspace_id = ?
        AND calendar_event_cache.calendar_id IN (${calendarIds.map(() => "?").join(", ")})
        AND calendar_event_cache.tombstoned = 0
        AND calendar_event_cache.start_at < ?
        AND calendar_event_cache.end_at > ?
      ORDER BY calendar_event_cache.start_at, calendar_event_cache.event_id
      LIMIT ?`,
  )
    .bind(
      workspace,
      ...calendarIds,
      input.timeMax,
      input.timeMin,
      MAX_EVENT_QUERY_EVENTS + 1,
    )
    .all<CachedEventRow>()).results;
  const truncated = rows.length > MAX_EVENT_QUERY_EVENTS;
  const events = rows
    .slice(0, MAX_EVENT_QUERY_EVENTS)
    .map(parseCachedEvent)
    .filter((event): event is GatewayCalendarEvent => event !== null);
  return { events, truncated };
}

const stateUsableForQuery = (
  state: CalendarSyncStateRow | undefined,
  input: EventQueryInput,
): state is CalendarSyncStateRow => Boolean(
  state?.last_success_at &&
  state.cache_time_min &&
  state.cache_time_max &&
  Date.parse(state.cache_time_min) <= Date.parse(input.timeMin) &&
  Date.parse(state.cache_time_max) >= Date.parse(input.timeMax),
);

const inputFitsRollingCoverage = (input: EventQueryInput): boolean =>
  Date.parse(input.timeMin) >= Date.now() - CACHE_INITIAL_HISTORY_MS &&
  Date.parse(input.timeMax) <= Date.now() + CACHE_ROLLING_FUTURE_MS;

const stateNeedsRevalidation = (state: CalendarSyncStateRow): boolean =>
  state.freshness !== "fresh" ||
  Date.parse(state.next_sync_at) <= Date.now() ||
  !state.last_success_at ||
  Date.parse(state.last_success_at) + CACHE_FRESH_MS <= Date.now();

const cacheProof = (
  state: CalendarSyncStateRow,
  input: EventQueryInput,
): CacheCalendarProof => ({
  calendarId: state.calendar_id,
  cacheRevision: state.cache_revision,
  freshness: state.freshness === "fresh" && stateNeedsRevalidation(state)
    ? "stale"
    : state.freshness,
  lastSuccessAt: state.last_success_at,
  nextSyncAt: state.next_sync_at,
  coverageTimeMin: state.cache_time_min,
  coverageTimeMax: state.cache_time_max,
  coversRequestedRange: stateUsableForQuery(state, input),
  error: state.error_code
    ? { code: state.error_code, message: state.error_message ?? "Calendar cache sync failed." }
    : null,
});

const internalEventQueryRequest = (
  request: Request,
  input: EventQueryInput,
  calendarIds: readonly string[],
): Request => {
  const headers = new Headers(request.headers);
  headers.set("Content-Type", "application/json");
  headers.delete("Content-Length");
  return new Request(request.url, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...input, calendarIds }),
  });
};

async function queryEvents(
  request: Request,
  env: CalendarGatewayEnv,
  executionContext: ExecutionContext | undefined,
  providerFetch: ProviderFetch = fetch,
): Promise<Response> {
  const { workspace, principal } = await principalScope(request, env);
  const body = await readJson(request);
  const input = eventQueryInput(body);
  if (body.revalidate !== undefined && !["wait", "background"].includes(String(body.revalidate))) {
    throw new ApiError(400, "invalid_revalidate_mode", "revalidate must be wait or background.");
  }
  const revalidateMode = body.revalidate === "background" ? "background" : "wait";
  const targets = await loadCalendarSyncTargets(
    env,
    workspace,
    principal,
    input.calendarIds,
  );
  const syncInvocation = cacheSyncInvocation();
  const cacheTargets = targets.filter(target =>
    target.provider === "google" && target.mode === "oauth" && target.role !== "free-busy"
  );
  await Promise.all(cacheTargets.map(target => ensureCalendarSyncState(env, target)));
  let states = await loadCalendarSyncStates(env, workspace, cacheTargets.map(target => target.id));
  let statesByCalendar = new Map(states.map(state => [state.calendar_id, state] as const));
  const coldTargets = cacheTargets.filter(target =>
    !stateUsableForQuery(statesByCalendar.get(target.id), input)
  );
  const freshlySynced = new Set<string>();
  if (coldTargets.length > 0) {
    const priorRevisions = new Map(states.map(state => [state.calendar_id, state.cache_revision]));
    const outcomes = await mapWithConcurrency(
      coldTargets,
      EVENT_QUERY_CONCURRENCY,
      target => syncGoogleCalendarCache(
        env,
        target,
        providerFetch,
        syncInvocation,
        inputFitsRollingCoverage(input),
      ),
    );
    for (const outcome of outcomes) if (outcome.synced) freshlySynced.add(outcome.calendarId);
    await waitForLeasedCacheSyncs(
      env,
      workspace,
      outcomes.filter(outcome => outcome.skipped).map(outcome => outcome.calendarId),
      priorRevisions,
    );
    states = await loadCalendarSyncStates(env, workspace, cacheTargets.map(target => target.id));
    statesByCalendar = new Map(states.map(state => [state.calendar_id, state] as const));
  }
  const usableTargets = cacheTargets.filter(target =>
    stateUsableForQuery(statesByCalendar.get(target.id), input)
  );
  const usableIds = new Set(usableTargets.map(target => target.id));
  const staleTargets = usableTargets.filter(target => {
    const state = statesByCalendar.get(target.id);
    return state ? stateNeedsRevalidation(state) : false;
  });
  if (staleTargets.length > 0) {
    const priorRevisions = new Map(states.map(state => [state.calendar_id, state.cache_revision]));
    const revalidation = mapWithConcurrency(
      staleTargets,
      EVENT_QUERY_CONCURRENCY,
      target => syncGoogleCalendarCache(env, target, providerFetch, syncInvocation),
    );
    if (revalidateMode === "background" && executionContext) {
      executionContext.waitUntil(revalidation.then(() => undefined));
    } else {
      const outcomes = await revalidation;
      for (const outcome of outcomes) if (outcome.synced) freshlySynced.add(outcome.calendarId);
      await waitForLeasedCacheSyncs(
        env,
        workspace,
        outcomes.filter(outcome => outcome.skipped).map(outcome => outcome.calendarId),
        priorRevisions,
      );
      states = await loadCalendarSyncStates(env, workspace, cacheTargets.map(target => target.id));
      statesByCalendar = new Map(states.map(state => [state.calendar_id, state] as const));
    }
  }
  const cached = await loadCachedEvents(env, workspace, input, [...usableIds]);
  const fallbackIds = input.calendarIds.filter(calendarId => !usableIds.has(calendarId));
  let live: EventQueryPayload | null = null;
  if (fallbackIds.length > 0) {
    const response = await queryLiveEvents(
      internalEventQueryRequest(request, input, fallbackIds),
      env,
      providerFetch,
    );
    live = await response.json<EventQueryPayload>();
  }
  const eventMap = new Map<string, GatewayCalendarEvent>();
  for (const event of cached.events) eventMap.set(event.id, event);
  for (const event of live?.events ?? []) eventMap.set(event.id, event);
  const events = [...eventMap.values()].sort((left, right) =>
    left.start.localeCompare(right.start) || left.id.localeCompare(right.id)
  );
  const syncedIds = new Set<string>(freshlySynced);
  for (const calendarId of live?.syncedCalendarIds ?? []) syncedIds.add(calendarId);
  const servedIds = new Set<string>(usableIds);
  for (const calendarId of live?.syncedCalendarIds ?? []) servedIds.add(calendarId);
  const servedCalendarIds = input.calendarIds.filter(calendarId => servedIds.has(calendarId));
  const cacheErrors = usableTargets.flatMap(target => {
    const state = statesByCalendar.get(target.id);
    return state?.error_code
      ? [{
        calendarId: target.id,
        code: state.error_code,
        message: state.error_message ?? "The last background cache refresh failed.",
      }]
      : [];
  });
  return json({
    timeMin: input.timeMin,
    timeMax: input.timeMax,
    syncedAt: new Date().toISOString(),
    events,
    syncedCalendarIds: input.calendarIds.filter(calendarId => syncedIds.has(calendarId)),
    servedCalendarIds,
    errors: [...cacheErrors, ...(live?.errors ?? [])],
    truncated: cached.truncated || Boolean(live?.truncated),
    source: usableIds.size === 0 ? "live" : fallbackIds.length === 0 ? "cache" : "cache+live",
    cache: {
      servedAt: new Date().toISOString(),
      calendars: input.calendarIds
        .map(calendarId => statesByCalendar.get(calendarId))
        .filter((state): state is CalendarSyncStateRow => Boolean(state))
        .map(state => cacheProof(state, input)),
    },
  });
}

interface LiveAvailabilityResult {
  readonly available: boolean;
  readonly conclusive: boolean;
  readonly validatedAt: string;
  readonly source: "provider-live";
  readonly conflicts: readonly GatewayCalendarEvent[];
  readonly syncedCalendarIds: readonly string[];
  readonly errors: readonly EventQueryError[];
}

async function strictLiveAvailabilityForScope(
  scope: CalendarPrincipalScope,
  env: CalendarGatewayEnv,
  input: EventQueryInput,
  providerFetch: ProviderFetch,
  excludedEventIds: ReadonlySet<string> = new Set(),
): Promise<LiveAvailabilityResult> {
  const live = await queryLiveEventsForScope(scope, input, env, providerFetch);
  const synced = new Set(live.syncedCalendarIds);
  const conclusive = input.calendarIds.every(calendarId => synced.has(calendarId)) &&
    live.errors.length === 0 && !live.truncated;
  const conflicts = live.events.filter(event =>
    !excludedEventIds.has(event.id) && event.busy &&
    event.status !== "cancelled" && event.status !== "declined"
  );
  return {
    available: conclusive && conflicts.length === 0,
    conclusive,
    validatedAt: new Date().toISOString(),
    source: "provider-live",
    conflicts,
    syncedCalendarIds: live.syncedCalendarIds,
    errors: live.errors,
  };
}

async function strictLiveAvailability(
  request: Request,
  env: CalendarGatewayEnv,
  input: EventQueryInput,
  providerFetch: ProviderFetch,
  excludedEventIds: ReadonlySet<string> = new Set(),
): Promise<LiveAvailabilityResult> {
  const scope = await principalScope(request, env);
  return strictLiveAvailabilityForScope(
    scope,
    env,
    input,
    providerFetch,
    excludedEventIds,
  );
}

async function validateLiveAvailability(
  request: Request,
  env: CalendarGatewayEnv,
  providerFetch: ProviderFetch,
): Promise<Response> {
  await principalScope(request, env);
  const input = eventQueryInput(await readJson(request));
  const result = await strictLiveAvailability(request, env, input, providerFetch);
  return json({ ...result, timeMin: input.timeMin, timeMax: input.timeMax });
}

async function confirmLiveAvailability(
  request: Request,
  env: CalendarGatewayEnv,
  providerFetch: ProviderFetch,
): Promise<Response> {
  const { workspace, principal } = await principalScope(request, env);
  const body = await readJson(request);
  const input = eventQueryInput(body);
  const idempotencyKey = identifier(body.idempotencyKey, "idempotencyKey");
  const requestHash = await sha256(JSON.stringify({
    timeMin: input.timeMin,
    timeMax: input.timeMax,
    calendarIds: [...input.calendarIds].sort(),
  }));
  const existing = await env.CALENDAR_DB.prepare(
    `SELECT request_hash, response_json
       FROM availability_confirmations
      WHERE workspace_id = ? AND principal_id = ? AND idempotency_key = ?`,
  )
    .bind(workspace, principal, idempotencyKey)
    .first<AvailabilityConfirmationRow>();
  if (existing) {
    if (existing.request_hash !== requestHash) {
      throw new ApiError(
        409,
        "idempotency_key_reused",
        "This idempotency key was already used for a different availability request.",
      );
    }
    const stored: unknown = JSON.parse(existing.response_json);
    const storedRecord = isRecord(stored) ? stored : {};
    if (storedRecord.error === "slot_conflict") return json(storedRecord, 409);
    return json(
      { ...storedRecord, idempotentReplay: true },
      200,
    );
  }
  const cacheTargets = (await loadCalendarSyncTargets(
    env,
    workspace,
    principal,
    input.calendarIds,
  ))
    .filter(target =>
      target.provider === "google" && target.mode === "oauth" && target.role !== "free-busy"
    );
  const syncInvocation = cacheSyncInvocation();
  await Promise.all(cacheTargets.map(target => ensureCalendarSyncState(env, target)));
  let cacheStates = await loadCalendarSyncStates(env, workspace, cacheTargets.map(target => target.id));
  let cacheStatesById = new Map(cacheStates.map(state => [state.calendar_id, state] as const));
  const refreshTargets = cacheTargets.filter(target => {
    const state = cacheStatesById.get(target.id);
    return !stateUsableForQuery(state, input) || (state ? stateNeedsRevalidation(state) : true);
  });
  if (refreshTargets.length > 0) {
    const outcomes = await mapWithConcurrency(
      refreshTargets,
      EVENT_QUERY_CONCURRENCY,
      target => syncGoogleCalendarCache(
        env,
        target,
        providerFetch,
        syncInvocation,
        inputFitsRollingCoverage(input) &&
          !stateUsableForQuery(cacheStatesById.get(target.id), input),
      ),
    );
    if (outcomes.some(outcome => !outcome.synced && !outcome.skipped)) {
      throw new ApiError(
        503,
        "calendar_cache_refresh_failed",
        "The calendar cache could not be refreshed before live availability validation.",
      );
    }
    cacheStates = await loadCalendarSyncStates(env, workspace, cacheTargets.map(target => target.id));
    cacheStatesById = new Map(cacheStates.map(state => [state.calendar_id, state] as const));
  }
  if (cacheTargets.some(target => {
    const state = cacheStatesById.get(target.id);
    return !stateUsableForQuery(state, input) || (state ? stateNeedsRevalidation(state) : true);
  })) {
    throw new ApiError(
      503,
      "calendar_cache_not_authoritative",
      "The calendar cache is incomplete or stale; availability was not confirmed.",
    );
  }
  // Confirmation always revalidates providers. Client-observed cache revisions are proof only,
  // never an authority for a new availability decision. An identical idempotency replay above
  // returns the already committed decision without depending on provider availability.
  const validation = await strictLiveAvailability(request, env, input, providerFetch);
  if (!validation.conclusive) {
    throw new ApiError(
      503,
      "live_availability_unavailable",
      "Every conflict calendar must be checked live before this slot can be confirmed.",
    );
  }
  const responseBody = validation.available
    ? {
      ...validation,
      timeMin: input.timeMin,
      timeMax: input.timeMax,
      confirmationId: crypto.randomUUID(),
      availabilityConfirmed: true,
      idempotentReplay: false,
    }
    : {
      error: "slot_conflict",
      message: "That time is no longer available.",
    };
  await env.CALENDAR_DB.prepare(
    `INSERT INTO availability_confirmations
      (workspace_id, principal_id, idempotency_key, request_hash, response_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (workspace_id, principal_id, idempotency_key) DO NOTHING`,
  )
    .bind(
      workspace,
      principal,
      idempotencyKey,
      requestHash,
      JSON.stringify(responseBody),
      new Date().toISOString(),
    )
    .run();
  const committed = await env.CALENDAR_DB.prepare(
    `SELECT request_hash, response_json
       FROM availability_confirmations
      WHERE workspace_id = ? AND principal_id = ? AND idempotency_key = ?`,
  )
    .bind(workspace, principal, idempotencyKey)
    .first<AvailabilityConfirmationRow>();
  if (!committed || committed.request_hash !== requestHash) {
    throw new ApiError(
      409,
      "idempotency_key_reused",
      "This idempotency key was already used for a different availability request.",
    );
  }
  return json(JSON.parse(committed.response_json), validation.available ? 200 : 409);
}

const optionalCommitText = (
  value: unknown,
  field: string,
  maximumLength: number,
): string | null => {
  if (value === undefined || value === null || value === "") return null;
  return requiredText(value, field, maximumLength);
};

function providerBookingCommitInput(
  body: Readonly<Record<string, unknown>>,
): ProviderBookingCommitInput {
  const destinationCalendarId = identifier(
    body.destinationCalendarId,
    "destinationCalendarId",
  );
  const range = eventQueryInput({
    timeMin: body.start,
    timeMax: body.end,
    calendarIds: body.conflictCalendarIds,
  });
  const hasConflictTimeMin = body.conflictTimeMin !== undefined;
  const hasConflictTimeMax = body.conflictTimeMax !== undefined;
  if (hasConflictTimeMin !== hasConflictTimeMax) {
    throw new ApiError(
      400,
      "invalid_conflict_time_range",
      "conflictTimeMin and conflictTimeMax must be supplied together.",
    );
  }
  const conflictRange = hasConflictTimeMin
    ? eventQueryInput({
        timeMin: body.conflictTimeMin,
        timeMax: body.conflictTimeMax,
        calendarIds: range.calendarIds,
      })
    : range;
  if (
    Date.parse(conflictRange.timeMin) > Date.parse(range.timeMin) ||
    Date.parse(conflictRange.timeMax) < Date.parse(range.timeMax)
  ) {
    throw new ApiError(
      400,
      "invalid_conflict_time_range",
      "The conflict validation range must contain the complete booking range.",
    );
  }
  if (!range.calendarIds.includes(destinationCalendarId)) {
    throw new ApiError(
      400,
      "destination_not_checked",
      "conflictCalendarIds must include destinationCalendarId.",
    );
  }
  if (
    body.bookingKind !== "meeting" &&
    body.bookingKind !== "approval-hold" &&
    body.bookingKind !== "work-block"
  ) {
    throw new ApiError(
      400,
      "invalid_booking_kind",
      "bookingKind must be meeting, approval-hold, or work-block.",
    );
  }
  if (!Array.isArray(body.attendeeEmails ?? [])) {
    throw new ApiError(400, "invalid_attendees", "attendeeEmails must be an array.");
  }
  const attendeeValues = (body.attendeeEmails ?? []) as readonly unknown[];
  if (attendeeValues.length > MAX_BOOKING_ATTENDEES) {
    throw new ApiError(
      400,
      "invalid_attendees",
      `Choose at most ${MAX_BOOKING_ATTENDEES} attendees.`,
    );
  }
  const attendeeEmails = attendeeValues.map((value, index) => {
    const email = requiredText(value, `attendeeEmails[${index}]`, 320).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
      throw new ApiError(400, "invalid_attendees", `attendeeEmails[${index}] is invalid.`);
    }
    return email;
  });
  if (new Set(attendeeEmails).size !== attendeeEmails.length) {
    throw new ApiError(400, "invalid_attendees", "Attendee emails must be unique.");
  }
  if (body.bookingKind === "work-block" && attendeeEmails.length > 0) {
    throw new ApiError(
      400,
      "invalid_attendees",
      "Work blocks do not invite attendees.",
    );
  }
  const conferenceProvider = body.conferenceProvider ?? "none";
  if (conferenceProvider !== "none" && conferenceProvider !== "google-meet") {
    throw new ApiError(
      400,
      "unsupported_conference_provider",
      "conferenceProvider must be none or google-meet for a Google destination.",
    );
  }
  if (body.bookingKind !== "meeting" && conferenceProvider !== "none") {
    throw new ApiError(
      400,
      "unsupported_conference_provider",
      "Approval holds and work blocks cannot create a conference.",
    );
  }
  let expiresAt: string | null = null;
  if (body.bookingKind === "approval-hold") {
    const rawExpiration = requiredText(body.expiresAt, "expiresAt", 64);
    const expiration = Date.parse(rawExpiration);
    if (!RFC3339_INSTANT.test(rawExpiration) || !Number.isFinite(expiration)) {
      throw new ApiError(
        400,
        "invalid_hold_expiration",
        "expiresAt must be an RFC 3339 timestamp with a time-zone offset.",
      );
    }
    if (expiration <= Date.now() || expiration > Date.now() + 30 * 24 * 60 * 60 * 1000) {
      throw new ApiError(
        400,
        "invalid_hold_expiration",
        "expiresAt must be in the future and no more than 30 days away.",
      );
    }
    expiresAt = new Date(expiration).toISOString();
  } else if (body.expiresAt !== undefined && body.expiresAt !== null) {
    throw new ApiError(
      400,
      "invalid_hold_expiration",
      "expiresAt is only valid for an approval hold.",
    );
  }
  return {
    ...range,
    conflictTimeMin: conflictRange.timeMin,
    conflictTimeMax: conflictRange.timeMax,
    destinationCalendarId,
    idempotencyKey: identifier(body.idempotencyKey, "idempotencyKey"),
    title: requiredText(body.title, "title", 255),
    description: optionalCommitText(body.description, "description", 4_000),
    location: optionalCommitText(body.location, "location", 1_024),
    bookingKind: body.bookingKind,
    attendeeEmails,
    conferenceProvider,
    expiresAt,
  };
}

async function deterministicGoogleEventId(
  workspace: string,
  principal: string,
  input: ProviderBookingCommitInput,
): Promise<string> {
  return publicBookingProviderOperationId(
    { workspace, principal },
    input.destinationCalendarId,
    input.idempotencyKey,
  );
}

async function acquireBookingCommitLock(
  env: CalendarGatewayEnv,
  workspace: string,
  principal: string,
  destinationCalendarId: string,
  leaseToken: string,
): Promise<boolean> {
  const now = new Date().toISOString();
  const leaseUntil = new Date(Date.now() + BOOKING_COMMIT_LEASE_MS).toISOString();
  const result = await env.CALENDAR_DB.prepare(
    `INSERT INTO provider_booking_commit_locks
      (workspace_id, principal_id, destination_calendar_id, lease_token, lease_until, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (workspace_id, principal_id, destination_calendar_id) DO UPDATE SET
       lease_token = excluded.lease_token,
       lease_until = excluded.lease_until,
       updated_at = excluded.updated_at
     WHERE provider_booking_commit_locks.lease_until IS NULL
        OR provider_booking_commit_locks.lease_until <= ?`,
  )
    .bind(workspace, principal, destinationCalendarId, leaseToken, leaseUntil, now, now)
    .run();
  return Number(result.meta.changes ?? 0) === 1;
}

async function releaseBookingCommitLock(
  env: CalendarGatewayEnv,
  workspace: string,
  principal: string,
  destinationCalendarId: string,
  leaseToken: string,
): Promise<void> {
  await env.CALENDAR_DB.prepare(
    `UPDATE provider_booking_commit_locks
        SET lease_token = NULL, lease_until = NULL, updated_at = ?
      WHERE workspace_id = ? AND principal_id = ?
        AND destination_calendar_id = ? AND lease_token = ?`,
  )
    .bind(
      new Date().toISOString(),
      workspace,
      principal,
      destinationCalendarId,
      leaseToken,
    )
    .run();
}

const GOOGLE_COMMITTED_EVENT_FIELDS = [
  "id",
  "etag",
  "status",
  "updated",
  "summary",
  "description",
  "start",
  "end",
  "eventType",
  "transparency",
  "visibility",
  "location",
  "htmlLink",
  "hangoutLink",
  "conferenceData",
  "attendees(id,email,displayName,responseStatus,optional,self)",
  "extendedProperties(private)",
].join(",");

async function getGoogleCommittedEvent(
  target: CalendarSyncTarget,
  providerEventId: string,
  accessToken: string,
  providerFetch: ProviderFetch,
): Promise<Readonly<Record<string, unknown>> | null> {
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(target.provider_calendar_id)}/events/${encodeURIComponent(providerEventId)}`,
  );
  url.searchParams.set("maxAttendees", String(MAX_EVENT_ATTENDEES));
  url.searchParams.set("fields", GOOGLE_COMMITTED_EVENT_FIELDS);
  try {
    return await externalJson(
      url.href,
      { headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` } },
      providerFetch,
    );
  } catch (error) {
    if (error instanceof ProviderHttpError && error.providerStatus === 404) return null;
    throw error;
  }
}

const googleCommitEventBody = (
  input: ProviderBookingCommitInput,
  providerEventId: string,
  requestHash: string,
): Readonly<Record<string, unknown>> => ({
  id: providerEventId,
  summary: input.bookingKind === "approval-hold"
    ? `Pending approval: ${input.title}`.slice(0, 255)
    : input.title,
  ...(input.description ? { description: input.description } : {}),
  ...(input.location ? { location: input.location } : {}),
  start: { dateTime: input.timeMin },
  end: { dateTime: input.timeMax },
  transparency: "opaque",
  status: input.bookingKind === "approval-hold" ? "tentative" : "confirmed",
  ...(input.bookingKind === "meeting" && input.attendeeEmails.length > 0
    ? { attendees: input.attendeeEmails.map(email => ({ email })) }
    : {}),
  ...(input.bookingKind === "meeting" && input.conferenceProvider === "google-meet"
    ? {
      conferenceData: {
        createRequest: {
          requestId: `${providerEventId}m`,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
    }
    : {}),
  ...(input.bookingKind === "meeting" ? {} : { visibility: "private" }),
  extendedProperties: {
    private: {
      tapCommitHash: requestHash,
      tapBookingKind: input.bookingKind,
    },
  },
});

async function insertGoogleCommittedEvent(
  target: CalendarSyncTarget,
  input: ProviderBookingCommitInput,
  providerEventId: string,
  requestHash: string,
  accessToken: string,
  providerFetch: ProviderFetch,
): Promise<Readonly<Record<string, unknown>>> {
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(target.provider_calendar_id)}/events`,
  );
  url.searchParams.set(
    "sendUpdates",
    input.bookingKind === "meeting" && input.attendeeEmails.length > 0 ? "all" : "none",
  );
  url.searchParams.set("maxAttendees", String(MAX_EVENT_ATTENDEES));
  if (input.conferenceProvider === "google-meet") {
    url.searchParams.set("conferenceDataVersion", "1");
  }
  url.searchParams.set("fields", GOOGLE_COMMITTED_EVENT_FIELDS);
  return externalJson(
    url.href,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(googleCommitEventBody(input, providerEventId, requestHash)),
    },
    providerFetch,
  );
}

const googleCommitHash = (value: Readonly<Record<string, unknown>>): string | null => {
  const extended = isRecord(value.extendedProperties) ? value.extendedProperties : null;
  const privateValues = extended && isRecord(extended.private) ? extended.private : null;
  return privateValues && typeof privateValues.tapCommitHash === "string"
    ? privateValues.tapCommitHash
    : null;
};

function committedBookingEvent(
  input: ProviderBookingCommitInput,
  providerEvent: Readonly<Record<string, unknown>>,
): GatewayCalendarEvent {
  const normalized = normalizeGoogleCalendarEvent(providerEvent, input.destinationCalendarId);
  if (!normalized) {
    throw new ApiError(
      502,
      "provider_event_invalid",
      "Google created the event but returned an invalid event projection.",
    );
  }
  return {
    ...normalized,
    kind: input.bookingKind === "work-block"
      ? "work-block"
      : input.bookingKind === "approval-hold"
        ? "hold"
        : "meeting",
    status: input.bookingKind === "approval-hold" ? "pending" : normalized.status,
  };
}

function committedBookingProjection(
  input: ProviderBookingCommitInput,
  providerEvent: Readonly<Record<string, unknown>>,
  providerEventId: string,
): Readonly<Record<string, unknown>> {
  const event = committedBookingEvent(input, providerEvent);
  return {
    booking: {
      state: "committed",
      provider: "google",
      providerEventId,
      destinationCalendarId: input.destinationCalendarId,
      bookingKind: input.bookingKind,
      approvalStatus: input.bookingKind === "approval-hold" ? "pending" : null,
      pendingAttendeeEmails: input.bookingKind === "approval-hold"
        ? input.attendeeEmails
        : [],
      approvalExpiresAt: input.expiresAt,
      providerHtmlLink: normalizeGoogleCalendarHtmlUrl(providerEvent.htmlLink),
      providerJoinUrl: googleMeetJoinUrl(providerEvent),
      conferenceStatus: input.conferenceProvider === "google-meet"
        ? googleMeetJoinUrl(providerEvent) ? "ready" : "pending"
        : "none",
      event,
    },
    committedAt: new Date().toISOString(),
    idempotentReplay: false,
    concurrencyBoundary: "tap-conflict-calendar-set-serialized",
  };
}

const parsedRecord = (value: string | null | undefined): Readonly<Record<string, unknown>> | null => {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const boundedStringArray = (value: unknown, maximum: number): readonly string[] =>
  Array.isArray(value) && value.length <= maximum &&
      value.every(item => typeof item === "string")
    ? value
    : [];

function recoveredCommittedBookingProjection(
  row: ProviderBookingCommitRow,
  providerEvent: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const normalized = normalizeGoogleCalendarEvent(
    providerEvent,
    row.destination_calendar_id,
  );
  if (!normalized) {
    throw new ApiError(
      502,
      "provider_event_invalid",
      "Google returned an invalid committed event projection.",
    );
  }
  const storedResponse = parsedRecord(row.response_json);
  const storedBooking = storedResponse && isRecord(storedResponse.booking)
    ? storedResponse.booking
    : null;
  const storedRequest = parsedRecord(row.request_json);
  const pendingAttendeeEmails = row.booking_kind === "approval-hold"
    ? boundedStringArray(
      storedBooking?.pendingAttendeeEmails ?? storedRequest?.attendeeEmails,
      MAX_BOOKING_ATTENDEES,
    )
    : [];
  const storedConferenceStatus = storedBooking?.conferenceStatus;
  const providerJoinUrl = googleMeetJoinUrl(providerEvent);
  const conferenceRequested =
    storedConferenceStatus === "pending" ||
    storedConferenceStatus === "ready" ||
    storedRequest?.conferenceProvider === "google-meet" ||
    googleMeetConferenceRequested(providerEvent);
  const committedAt = typeof storedResponse?.committedAt === "string" &&
      Number.isFinite(Date.parse(storedResponse.committedAt))
    ? storedResponse.committedAt
    : typeof row.updated_at === "string" && Number.isFinite(Date.parse(row.updated_at))
      ? row.updated_at
      : new Date().toISOString();
  const storedApprovalExpiration = storedBooking?.approvalExpiresAt;
  const approvalExpiresAt = row.booking_kind === "approval-hold"
    ? typeof storedApprovalExpiration === "string" &&
        Number.isFinite(Date.parse(storedApprovalExpiration))
      ? storedApprovalExpiration
      : row.hold_expires_at ?? null
    : null;
  return {
    booking: {
      state: "committed",
      provider: "google",
      providerEventId: row.provider_event_id,
      destinationCalendarId: row.destination_calendar_id,
      bookingKind: row.booking_kind,
      approvalStatus: row.booking_kind === "approval-hold" ? "pending" : null,
      pendingAttendeeEmails,
      approvalExpiresAt,
      providerHtmlLink: normalizeGoogleCalendarHtmlUrl(providerEvent.htmlLink),
      providerJoinUrl,
      conferenceStatus: providerJoinUrl ? "ready" : conferenceRequested ? "pending" : "none",
      event: {
        ...normalized,
        kind: row.booking_kind === "work-block"
          ? "work-block"
          : row.booking_kind === "approval-hold"
            ? "hold"
            : "meeting",
        status: row.booking_kind === "approval-hold" ? "pending" : normalized.status,
      },
    },
    committedAt,
    idempotentReplay: true,
    concurrencyBoundary: "tap-conflict-calendar-set-serialized",
  };
}

function storedCommittedBookingProjection(
  row: ProviderBookingCommitRow,
): Readonly<Record<string, unknown>> {
  const storedResponse = parsedRecord(row.response_json);
  const storedBooking = storedResponse && isRecord(storedResponse.booking)
    ? storedResponse.booking
    : null;
  const storedEvent = storedBooking && isRecord(storedBooking.event)
    ? storedBooking.event
    : null;
  if (!storedResponse || !storedBooking || !storedEvent) {
    throw new ApiError(
      409,
      "booking_projection_invalid",
      "The durable booking projection is unavailable.",
    );
  }
  const {
    providerHtmlLink: storedEventHtmlLink,
    providerJoinUrl: storedEventJoinUrl,
    ...eventWithoutLinks
  } = storedEvent;
  const providerHtmlLink = normalizeGoogleCalendarHtmlUrl(storedBooking.providerHtmlLink);
  const providerJoinUrl = normalizeGoogleMeetJoinUrl(storedBooking.providerJoinUrl);
  const eventProviderHtmlLink = normalizeGoogleCalendarHtmlUrl(storedEventHtmlLink);
  const eventProviderJoinUrl = normalizeGoogleMeetJoinUrl(storedEventJoinUrl);
  const storedConferenceStatus = storedBooking.conferenceStatus;
  return {
    booking: {
      ...storedBooking,
      state: "committed",
      provider: "google",
      providerEventId: row.provider_event_id,
      destinationCalendarId: row.destination_calendar_id,
      bookingKind: row.booking_kind,
      approvalStatus: row.booking_kind === "approval-hold" ? "pending" : null,
      providerHtmlLink,
      providerJoinUrl,
      conferenceStatus: providerJoinUrl
        ? "ready"
        : storedConferenceStatus === "pending"
          ? "pending"
          : "none",
      event: {
        ...eventWithoutLinks,
        ...(eventProviderHtmlLink ? { providerHtmlLink: eventProviderHtmlLink } : {}),
        ...(eventProviderJoinUrl ? { providerJoinUrl: eventProviderJoinUrl } : {}),
      },
    },
    committedAt: typeof storedResponse.committedAt === "string" &&
        Number.isFinite(Date.parse(storedResponse.committedAt))
      ? storedResponse.committedAt
      : row.updated_at ?? new Date().toISOString(),
    idempotentReplay: true,
    concurrencyBoundary: "tap-conflict-calendar-set-serialized",
  };
}

function enrichedStoredBookingProjection(
  row: ProviderBookingCommitRow,
  providerEvent: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const stored = storedCommittedBookingProjection(row);
  const booking = isRecord(stored.booking) ? stored.booking : null;
  const event = booking && isRecord(booking.event) ? booking.event : null;
  if (!booking || !event) {
    throw new ApiError(
      409,
      "booking_projection_invalid",
      "The durable booking projection is unavailable.",
    );
  }
  const storedRequest = parsedRecord(row.request_json);
  const providerJoinUrl = googleMeetJoinUrl(providerEvent);
  const storedConferenceStatus = booking.conferenceStatus;
  const conferenceRequested =
    storedConferenceStatus === "pending" ||
    storedConferenceStatus === "ready" ||
    storedRequest?.conferenceProvider === "google-meet" ||
    googleMeetConferenceRequested(providerEvent);
  const meetingRequestedGoogleMeet = row.booking_kind === "meeting" &&
    (storedRequest?.conferenceProvider === "google-meet" ||
      storedConferenceStatus === "pending" ||
      storedConferenceStatus === "ready");
  return {
    ...stored,
    booking: {
      ...booking,
      providerHtmlLink: normalizeGoogleCalendarHtmlUrl(providerEvent.htmlLink),
      providerJoinUrl,
      conferenceStatus: providerJoinUrl ? "ready" : conferenceRequested ? "pending" : "none",
      event: meetingRequestedGoogleMeet
        ? { ...event, location: providerJoinUrl ? "google-meet" : null }
        : event,
    },
  };
}

type BookingLifecycleState = "active" | "approved" | "declined" | "expired";

function bookingLifecycle(row: ProviderBookingCommitRow): Readonly<{
  state: BookingLifecycleState;
  resolvedAt: string | null;
  providerEventRemoved: boolean;
}> {
  const state: BookingLifecycleState = row.resolution_status === "approved"
    ? "approved"
    : row.resolution_status === "declined"
      ? "declined"
      : row.hold_expired_at
        ? "expired"
        : "active";
  const resolution = parsedRecord(row.resolution_response_json);
  const storedResolvedAt = typeof resolution?.resolvedAt === "string" &&
      Number.isFinite(Date.parse(resolution.resolvedAt))
    ? resolution.resolvedAt
    : null;
  const fallbackResolvedAt = typeof row.resolution_updated_at === "string" &&
      Number.isFinite(Date.parse(row.resolution_updated_at))
    ? row.resolution_updated_at
    : null;
  const expiredAt = typeof row.hold_expired_at === "string" &&
      Number.isFinite(Date.parse(row.hold_expired_at))
    ? row.hold_expired_at
    : null;
  return {
    state,
    resolvedAt: state === "active"
      ? null
      : state === "expired"
        ? expiredAt
        : storedResolvedAt ?? fallbackResolvedAt,
    providerEventRemoved: state === "declined" || state === "expired",
  };
}

async function getGoogleBookingStatus(
  request: Request,
  env: CalendarGatewayEnv,
  bookingIdempotencyKey: string,
  providerFetch: ProviderFetch,
): Promise<Response> {
  const { workspace, principal } = await principalScope(request, env);
  const row = await env.CALENDAR_DB.prepare(
    `SELECT provider_booking_commits.request_hash,
            provider_booking_commits.request_json,
            provider_booking_commits.destination_calendar_id,
            provider_booking_commits.provider_event_id,
            provider_booking_commits.booking_kind,
            provider_booking_commits.start_at,
            provider_booking_commits.end_at,
            provider_booking_commits.state,
            provider_booking_commits.response_json,
            provider_booking_commits.resolution_status,
            provider_booking_commits.conflict_calendar_ids_json,
            provider_booking_commits.hold_expires_at,
            provider_booking_commits.hold_expired_at,
            provider_booking_commits.updated_at,
            provider_booking_resolutions.request_hash AS resolution_request_hash,
            provider_booking_resolutions.response_json AS resolution_response_json,
            provider_booking_resolutions.updated_at AS resolution_updated_at
       FROM provider_booking_commits
       LEFT JOIN provider_booking_resolutions
         ON provider_booking_resolutions.workspace_id = provider_booking_commits.workspace_id
        AND provider_booking_resolutions.principal_id = provider_booking_commits.principal_id
        AND provider_booking_resolutions.booking_idempotency_key =
            provider_booking_commits.idempotency_key
      WHERE provider_booking_commits.workspace_id = ?
        AND provider_booking_commits.principal_id = ?
        AND provider_booking_commits.idempotency_key = ?`,
  )
    .bind(workspace, principal, bookingIdempotencyKey)
    .first<ProviderBookingCommitRow>();
  if (!row) {
    throw new ApiError(404, "booking_not_found", "The booking was not found.");
  }
  if (row.state === "rejected") {
    const rejected = parsedRecord(row.response_json);
    return json(rejected ?? {
      error: "booking_rejected",
      message: "The booking was rejected.",
    }, 409);
  }
  const lifecycle = bookingLifecycle(row);
  if (lifecycle.providerEventRemoved) {
    return json({
      commit: storedCommittedBookingProjection(row),
      lifecycle,
      currentEvent: null,
    });
  }
  const target = (await loadCalendarSyncTargets(
    env,
    workspace,
    principal,
    [row.destination_calendar_id],
  ))[0];
  if (!target || target.provider !== "google" || target.mode !== "oauth") {
    throw new ApiError(
      409,
      "booking_provider_unavailable",
      "The booking's Google Calendar connection is unavailable.",
    );
  }
  const { secret } = await authorizedToken(
    env,
    connectionFromSyncTarget(target),
    providerFetch,
  );
  const providerEvent = await getGoogleCommittedEvent(
    target,
    row.provider_event_id,
    secret.accessToken,
    providerFetch,
  );
  if (!providerEvent) {
    if (row.state === "pending") {
      throw new ApiError(
        409,
        "booking_commit_pending",
        "Google has not confirmed this booking yet. Retry the original commit key.",
      );
    }
    throw new ApiError(
      502,
      "provider_commit_unverified",
      "The committed Google event could not be verified.",
    );
  }
  if (googleCommitHash(providerEvent) !== row.request_hash) {
    throw new ApiError(
      502,
      "provider_commit_unverified",
      "The Google event does not contain TAP's booking proof.",
    );
  }
  if (
    lifecycle.state === "approved" &&
    (!row.resolution_request_hash ||
      googleResolutionHash(providerEvent) !== row.resolution_request_hash)
  ) {
    throw new ApiError(
      502,
      "provider_resolution_unverified",
      "The Google event does not contain TAP's approval proof.",
    );
  }
  const currentEvent = normalizeGoogleCalendarEvent(providerEvent, row.destination_calendar_id);
  if (!currentEvent) {
    throw new ApiError(
      502,
      "provider_event_invalid",
      "Google returned an invalid committed event projection.",
    );
  }
  const providerHtmlLink = normalizeGoogleCalendarHtmlUrl(providerEvent.htmlLink);
  const providerJoinUrl = googleMeetJoinUrl(providerEvent);
  const currentEventProjection = {
    ...currentEvent,
    ...(providerHtmlLink ? { providerHtmlLink } : {}),
    ...(providerJoinUrl ? { providerJoinUrl } : {}),
  };
  return json({
    commit: row.response_json
      ? enrichedStoredBookingProjection(row, providerEvent)
      : recoveredCommittedBookingProjection(row, providerEvent),
    lifecycle,
    currentEvent: lifecycle.state === "approved"
      ? { ...currentEventProjection, kind: "meeting", status: "confirmed" }
      : currentEventProjection,
  });
}

async function stageBookingCacheMutation(
  env: CalendarGatewayEnv,
  target: CalendarSyncTarget,
  mutation: GoogleCacheMutation,
): Promise<void> {
  const state = await ensureCalendarSyncState(env, target);
  const generation = `booking-${crypto.randomUUID()}`;
  await env.CALENDAR_DB.prepare(
    `INSERT INTO calendar_event_cache
      (workspace_id, connection_id, calendar_id, provider_event_id, sync_generation,
       event_id, start_at, end_at, tombstoned, payload_json, provider_updated_at, cached_at)
     SELECT workspace_id, connection_id, calendar_id, provider_event_id, ?,
            event_id, start_at, end_at, tombstoned, payload_json, provider_updated_at, cached_at
       FROM calendar_event_cache
      WHERE workspace_id = ? AND connection_id = ? AND calendar_id = ?
        AND sync_generation = ?`,
  )
    .bind(
      generation,
      state.workspace_id,
      state.connection_id,
      state.calendar_id,
      state.active_generation,
    )
    .run();
  await writeGoogleCacheMutations(env, state, generation, [mutation]);
  const now = new Date().toISOString();
  const committed = await env.CALENDAR_DB.prepare(
    `UPDATE calendar_sync_state
        SET active_generation = ?, cache_revision = cache_revision + 1,
            freshness = CASE WHEN last_success_at IS NULL THEN 'pending' ELSE 'stale' END,
            next_sync_at = ?
      WHERE workspace_id = ? AND connection_id = ? AND calendar_id = ?
        AND active_generation = ? AND cache_revision = ?`,
  )
    .bind(
      generation,
      now,
      state.workspace_id,
      state.connection_id,
      state.calendar_id,
      state.active_generation,
      state.cache_revision,
    )
    .run();
  if (Number(committed.meta.changes ?? 0) === 0) {
    await env.CALENDAR_DB.prepare(
      `DELETE FROM calendar_event_cache
        WHERE workspace_id = ? AND connection_id = ? AND calendar_id = ?
          AND sync_generation = ?`,
    )
      .bind(state.workspace_id, state.connection_id, state.calendar_id, generation)
      .run();
    await env.CALENDAR_DB.prepare(
      `UPDATE calendar_sync_state SET next_sync_at = ?
        WHERE workspace_id = ? AND connection_id = ? AND calendar_id = ?`,
    )
      .bind(now, state.workspace_id, state.connection_id, state.calendar_id)
      .run();
    return;
  }
  try {
    await env.CALENDAR_DB.prepare(
      `DELETE FROM calendar_event_cache
        WHERE workspace_id = ? AND connection_id = ? AND calendar_id = ?
          AND sync_generation <> ?`,
    )
      .bind(state.workspace_id, state.connection_id, state.calendar_id, generation)
      .run();
  } catch (error) {
    logCalendarSync("warn", "booking cache generation cleanup failed", {
      workspace_id: state.workspace_id,
      connection_id: state.connection_id,
      calendar_id: state.calendar_id,
      error: error instanceof Error ? error.message : "unknown error",
    });
  }
}

async function stageCommittedBookingInCache(
  env: CalendarGatewayEnv,
  target: CalendarSyncTarget,
  input: ProviderBookingCommitInput,
  providerEvent: Readonly<Record<string, unknown>>,
): Promise<void> {
  const event = committedBookingEvent(input, providerEvent);
  await stageBookingCacheMutation(env, target, {
    providerEventId: requiredText(providerEvent.id, "provider event id", 2048),
    eventId: event.id,
    start: event.start,
    end: event.end,
    tombstoned: false,
    payload: event,
    providerUpdatedAt: typeof providerEvent.updated === "string" &&
        Number.isFinite(Date.parse(providerEvent.updated))
      ? new Date(providerEvent.updated).toISOString()
      : null,
  });
}

async function finalizeCommittedBooking(
  env: CalendarGatewayEnv,
  workspace: string,
  principal: string,
  target: CalendarSyncTarget,
  input: ProviderBookingCommitInput,
  providerEvent: Readonly<Record<string, unknown>>,
  response: Readonly<Record<string, unknown>>,
): Promise<void> {
  await persistCommittedBooking(env, workspace, principal, input, response);
  try {
    await stageCommittedBookingInCache(env, target, input, providerEvent);
  } catch (error) {
    // The provider event and idempotency record are already durable. Cache repair is made due
    // on the happy path; a cache-write failure must not turn a committed provider write into an
    // ambiguous API failure that could prompt callers to invent a new idempotency key.
    logCalendarSync("warn", "committed booking cache staging failed", {
      workspace_id: workspace,
      connection_id: target.connection_id,
      calendar_id: target.id,
      provider_event_id: typeof providerEvent.id === "string" ? providerEvent.id : null,
      error: error instanceof Error ? error.message : "unknown error",
    });
    try {
      await env.CALENDAR_DB.prepare(
        `UPDATE calendar_sync_state SET next_sync_at = ?
          WHERE workspace_id = ? AND connection_id = ? AND calendar_id = ?`,
      )
        .bind(new Date().toISOString(), workspace, target.connection_id, target.id)
        .run();
    } catch {
      // Cron/webhook repair remains the final fallback if even the due marker cannot be stored.
    }
  }
}

async function persistCommittedBooking(
  env: CalendarGatewayEnv,
  workspace: string,
  principal: string,
  input: ProviderBookingCommitInput,
  response: Readonly<Record<string, unknown>>,
): Promise<void> {
  await env.CALENDAR_DB.prepare(
    `UPDATE provider_booking_commits
        SET state = 'committed', response_json = ?, last_error_code = NULL, updated_at = ?
      WHERE workspace_id = ? AND principal_id = ? AND idempotency_key = ?`,
  )
    .bind(
      JSON.stringify(response),
      new Date().toISOString(),
      workspace,
      principal,
      input.idempotencyKey,
    )
    .run();
}

interface ProviderBookingCommitIdentity {
  readonly requestHash: string;
  readonly providerEventId: string;
}

const canonicalProviderBookingCommit = (
  input: ProviderBookingCommitInput,
): Readonly<Record<string, unknown>> => {
  const hasExpandedConflictRange =
    input.conflictTimeMin !== input.timeMin || input.conflictTimeMax !== input.timeMax;
  return {
    destinationCalendarId: input.destinationCalendarId,
    conflictCalendarIds: [...input.calendarIds].sort(),
    start: input.timeMin,
    end: input.timeMax,
    ...(hasExpandedConflictRange
      ? {
          conflictTimeMin: input.conflictTimeMin,
          conflictTimeMax: input.conflictTimeMax,
        }
      : {}),
    bookingKind: input.bookingKind,
    title: input.title,
    description: input.description,
    location: input.location,
    attendeeEmails: [...input.attendeeEmails].sort(),
    conferenceProvider: input.conferenceProvider,
    expiresAt: input.expiresAt,
  };
};

async function organizerProviderBookingIdentity(
  scope: CalendarPrincipalScope,
  input: ProviderBookingCommitInput,
): Promise<ProviderBookingCommitIdentity> {
  return {
    requestHash: await sha256(JSON.stringify(canonicalProviderBookingCommit(input))),
    providerEventId: await deterministicGoogleEventId(
      scope.workspace,
      scope.principal,
      input,
    ),
  };
}

async function commitGoogleBookingForScope(
  scope: CalendarPrincipalScope,
  input: ProviderBookingCommitInput,
  identity: ProviderBookingCommitIdentity,
  env: CalendarGatewayEnv,
  providerFetch: ProviderFetch,
  assertWriteStillAuthorized?: () => Promise<void>,
): Promise<Response> {
  const { workspace, principal } = scope;
  const canonical = canonicalProviderBookingCommit(input);
  const { requestHash, providerEventId } = identity;
  const now = new Date().toISOString();
  await env.CALENDAR_DB.prepare(
    `INSERT OR IGNORE INTO provider_booking_commits
      (workspace_id, principal_id, idempotency_key, request_hash, destination_calendar_id,
       provider_event_id, booking_kind, start_at, end_at, state, response_json,
       last_error_code, created_at, updated_at, conflict_calendar_ids_json,
       hold_expires_at, hold_expired_at, request_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, ?, ?, ?, NULL, ?)`,
  )
    .bind(
      workspace,
      principal,
      input.idempotencyKey,
      requestHash,
      input.destinationCalendarId,
      providerEventId,
      input.bookingKind,
      input.timeMin,
      input.timeMax,
      now,
      now,
      JSON.stringify([...input.calendarIds].sort()),
      input.expiresAt,
      JSON.stringify(canonical),
    )
    .run();
  const existing = await env.CALENDAR_DB.prepare(
    `SELECT request_hash, destination_calendar_id, provider_event_id, booking_kind,
            state, response_json
       FROM provider_booking_commits
      WHERE workspace_id = ? AND principal_id = ? AND idempotency_key = ?`,
  )
    .bind(workspace, principal, input.idempotencyKey)
    .first<ProviderBookingCommitRow>();
  if (!existing) {
    throw new ApiError(500, "booking_commit_unavailable", "Booking commit state is unavailable.");
  }
  if (existing.request_hash !== requestHash) {
    throw new ApiError(
      409,
      "idempotency_key_reused",
      "This idempotency key was already used for a different booking request.",
    );
  }
  if (existing.state === "committed" && existing.response_json) {
    const stored: unknown = JSON.parse(existing.response_json);
    return json({ ...(isRecord(stored) ? stored : {}), idempotentReplay: true });
  }
  if (existing.state === "rejected" && existing.response_json) {
    return json(JSON.parse(existing.response_json), 409);
  }
  const targets = await loadCalendarSyncTargets(
    env,
    workspace,
    principal,
    input.calendarIds,
  );
  if (targets.length !== input.calendarIds.length) {
    throw new ApiError(404, "calendar_not_found", "A conflict calendar was not found.");
  }
  const target = targets.find(candidate => candidate.id === input.destinationCalendarId);
  if (
    !target ||
    target.provider !== "google" ||
    target.mode !== "oauth" ||
    target.writable !== 1 ||
    target.role === "free-busy"
  ) {
    throw new ApiError(
      409,
      "destination_not_writable",
      "Choose a writable Google destination calendar.",
    );
  }
  const leaseToken = crypto.randomUUID();
  const acquiredCalendarIds: string[] = [];
  for (const calendarId of [...input.calendarIds].sort()) {
    if (await acquireBookingCommitLock(
      env,
      workspace,
      principal,
      calendarId,
      leaseToken,
    )) {
      acquiredCalendarIds.push(calendarId);
      continue;
    }
    await Promise.all(acquiredCalendarIds.map(acquiredCalendarId =>
      releaseBookingCommitLock(env, workspace, principal, acquiredCalendarId, leaseToken)
    ));
    throw new ApiError(
      409,
      "booking_commit_in_progress",
      "Another overlapping TAP booking is being committed. Retry shortly.",
    );
  }
  try {
    const { secret } = await authorizedToken(env, connectionFromSyncTarget(target), providerFetch);
    let providerEvent = await getGoogleCommittedEvent(
      target,
      providerEventId,
      secret.accessToken,
      providerFetch,
    );
    if (providerEvent) {
      if (googleCommitHash(providerEvent) !== requestHash) {
        throw new ApiError(
          409,
          "provider_event_id_collision",
          "The deterministic Google event identifier is already in use.",
        );
      }
      const response = committedBookingProjection(input, providerEvent, providerEventId);
      await finalizeCommittedBooking(
        env,
        workspace,
        principal,
        target,
        input,
        providerEvent,
        response,
      );
      return json({ ...response, idempotentReplay: true });
    }

    const overlap = await env.CALENDAR_DB.prepare(
      `SELECT idempotency_key
         FROM provider_booking_commits
        WHERE workspace_id = ? AND principal_id = ?
          AND destination_calendar_id IN (${input.calendarIds.map(() => "?").join(", ")})
          AND state IN ('pending', 'committed')
          AND (booking_kind <> 'approval-hold' OR resolution_status IS NULL OR resolution_status <> 'declined')
          AND (booking_kind <> 'approval-hold' OR hold_expired_at IS NULL)
          AND idempotency_key <> ?
          AND start_at < ? AND end_at > ?
        LIMIT 1`,
    )
      .bind(
        workspace,
        principal,
        ...input.calendarIds,
        input.idempotencyKey,
        input.conflictTimeMax,
        input.conflictTimeMin,
      )
      .first<{ readonly idempotency_key: string }>();
    if (overlap) {
      const conflict = {
        error: "slot_conflict",
        message: "That time is no longer available.",
      };
      await env.CALENDAR_DB.prepare(
        `UPDATE provider_booking_commits
            SET state = 'rejected', response_json = ?, last_error_code = 'slot_conflict',
                updated_at = ?
          WHERE workspace_id = ? AND principal_id = ? AND idempotency_key = ?`,
      )
        .bind(
          JSON.stringify(conflict),
          new Date().toISOString(),
          workspace,
          principal,
          input.idempotencyKey,
        )
        .run();
      return json(conflict, 409);
    }

    const validation = await strictLiveAvailabilityForScope(scope, env, {
      timeMin: input.conflictTimeMin,
      timeMax: input.conflictTimeMax,
      calendarIds: input.calendarIds,
    }, providerFetch);
    if (!validation.conclusive) {
      throw new ApiError(
        503,
        "live_availability_unavailable",
        "Every conflict calendar must be checked live before committing this booking.",
      );
    }
    if (!validation.available) {
      const conflict = {
        error: "slot_conflict",
        message: "That time is no longer available.",
      };
      await env.CALENDAR_DB.prepare(
        `UPDATE provider_booking_commits
            SET state = 'rejected', response_json = ?, last_error_code = 'slot_conflict',
                updated_at = ?
          WHERE workspace_id = ? AND principal_id = ? AND idempotency_key = ?`,
      )
        .bind(
          JSON.stringify(conflict),
          new Date().toISOString(),
          workspace,
          principal,
          input.idempotencyKey,
        )
        .run();
      return json(conflict, 409);
    }
    // This is the public booking's write-authorization linearization point.
    // It deliberately runs after provider I/O and while every conflict-calendar
    // lock is still held, immediately before Google can receive a new event.
    if (assertWriteStillAuthorized) {
      try {
        await assertWriteStillAuthorized();
      } catch {
        const invalidated = {
          error: "public_page_changed",
          message: "This booking page changed before the booking was created.",
        };
        await env.CALENDAR_DB.prepare(
          `UPDATE provider_booking_commits
              SET state = 'rejected', response_json = ?,
                  last_error_code = 'public_page_changed', updated_at = ?
            WHERE workspace_id = ? AND principal_id = ?
              AND idempotency_key = ? AND state = 'pending'`,
        )
          .bind(
            JSON.stringify(invalidated),
            new Date().toISOString(),
            workspace,
            principal,
            input.idempotencyKey,
          )
          .run();
        throw new ApiError(
          409,
          "public_page_changed",
          "This booking page changed before the booking was created.",
        );
      }
    }
    try {
      providerEvent = await insertGoogleCommittedEvent(
        target,
        input,
        providerEventId,
        requestHash,
        secret.accessToken,
        providerFetch,
      );
    } catch (error) {
      if (!(error instanceof ProviderHttpError) || error.providerStatus !== 409) throw error;
      providerEvent = await getGoogleCommittedEvent(
        target,
        providerEventId,
        secret.accessToken,
        providerFetch,
      );
      if (!providerEvent || googleCommitHash(providerEvent) !== requestHash) {
        throw new ApiError(
          409,
          "provider_event_id_collision",
          "Google reported a duplicate event identifier that TAP could not recover.",
        );
      }
    }
    if (googleCommitHash(providerEvent) !== requestHash) {
      throw new ApiError(
        502,
        "provider_commit_unverified",
        "Google created the event without TAP's commit proof.",
      );
    }
    const response = committedBookingProjection(input, providerEvent, providerEventId);
    await finalizeCommittedBooking(
      env,
      workspace,
      principal,
      target,
      input,
      providerEvent,
      response,
    );
    return json(response, 201);
  } catch (error) {
    if (error instanceof ApiError && [400, 409].includes(error.status)) throw error;
    await env.CALENDAR_DB.prepare(
      `UPDATE provider_booking_commits
          SET last_error_code = ?, updated_at = ?
        WHERE workspace_id = ? AND principal_id = ?
          AND idempotency_key = ? AND state = 'pending'`,
    )
      .bind(
        error instanceof ApiError ? error.code : "provider_commit_uncertain",
        new Date().toISOString(),
        workspace,
        principal,
        input.idempotencyKey,
      )
      .run();
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      502,
      "provider_commit_uncertain",
      "Google did not confirm whether the booking was committed. Retry with the same idempotency key.",
    );
  } finally {
    const releases = await Promise.allSettled(acquiredCalendarIds.map(calendarId =>
      releaseBookingCommitLock(env, workspace, principal, calendarId, leaseToken)
    ));
    releases.forEach((release, index) => {
      if (release.status !== "rejected") return;
      logCalendarSync("warn", "booking commit lock release failed", {
        workspace_id: workspace,
        calendar_id: acquiredCalendarIds[index],
        error: release.reason instanceof Error ? release.reason.message : "unknown error",
      });
    });
  }
}

async function commitGoogleBooking(
  request: Request,
  env: CalendarGatewayEnv,
  providerFetch: ProviderFetch,
): Promise<Response> {
  const scope = await principalScope(request, env);
  const input = providerBookingCommitInput(await readJson(request));
  return commitGoogleBookingForScope(
    scope,
    input,
    await organizerProviderBookingIdentity(scope, input),
    env,
    providerFetch,
  );
}

const PUBLIC_GOOGLE_OPERATION_ID = /^tap[0-9a-v]{52}$/u;
const SHA256_BASE64URL = /^[A-Za-z0-9_-]{43}$/u;

function publicGoogleCommitInput(
  command: ScopeFirstGoogleBookingCommitInput,
): ProviderBookingCommitInput {
  if (
    command.idempotencyKey !== command.providerEventId ||
    !PUBLIC_GOOGLE_OPERATION_ID.test(command.providerEventId) ||
    !SHA256_BASE64URL.test(command.requestHash)
  ) {
    throw new ApiError(
      500,
      "public_provider_identity_invalid",
      "The public provider identity is invalid.",
    );
  }
  return providerBookingCommitInput({
    destinationCalendarId: command.destinationCalendarId,
    conflictCalendarIds: command.conflictCalendarIds,
    start: command.timeMin,
    end: command.timeMax,
    conflictTimeMin: command.conflictTimeMin,
    conflictTimeMax: command.conflictTimeMax,
    idempotencyKey: command.idempotencyKey,
    title: command.title,
    description: command.description,
    location: command.location,
    bookingKind: command.bookingKind,
    attendeeEmails: command.attendeeEmails,
    conferenceProvider: command.conferenceProvider,
    expiresAt: command.expiresAt,
  });
}

const publicProviderReceipt = (
  command: Pick<
    ScopeFirstGoogleBookingCommitInput,
    "providerEventId" | "requestHash" | "timeMin" | "timeMax" | "bookingKind"
  >,
): PublicProviderBookingReceipt => ({
  operationId: command.providerEventId,
  commitProof: command.requestHash,
  providerBookingId: command.providerEventId,
  startsAt: command.timeMin,
  endsAt: command.timeMax,
  status: command.bookingKind === "approval-hold" ? "tentative" : "confirmed",
});

const publicCommitResponseMatches = (
  response: unknown,
  command: ScopeFirstGoogleBookingCommitInput,
): boolean => {
  if (!isRecord(response) || !isRecord(response.booking)) return false;
  const event = isRecord(response.booking.event) ? response.booking.event : null;
  return response.booking.state === "committed" &&
    response.booking.provider === "google" &&
    response.booking.providerEventId === command.providerEventId &&
    response.booking.destinationCalendarId === command.destinationCalendarId &&
    response.booking.bookingKind === command.bookingKind &&
    event?.start === command.timeMin && event.end === command.timeMax;
};

async function commitPublicGoogleBookingForScope(
  command: ScopeFirstGoogleBookingCommitInput,
  env: CalendarGatewayEnv,
  providerFetch: ProviderFetch,
  assertPublicationCurrent: () => Promise<void>,
): Promise<PublicProviderBookingCommit> {
  try {
    const input = publicGoogleCommitInput(command);
    const response = await commitGoogleBookingForScope(
      command.scope,
      input,
      {
        requestHash: command.requestHash,
        providerEventId: command.providerEventId,
      },
      env,
      providerFetch,
      assertPublicationCurrent,
    );
    const body: unknown = await response.json();
    if (response.status === 409 && isRecord(body) && body.error === "slot_conflict") {
      return { status: "conflict", reason: "slot-conflict" };
    }
    if (!response.ok || !publicCommitResponseMatches(body, command)) {
      return { status: "uncertain" };
    }
    return { status: "committed", receipt: publicProviderReceipt(command) };
  } catch (error) {
    if (
      error instanceof ApiError &&
      ["provider_event_id_collision", "idempotency_key_reused"].includes(error.code)
    ) {
      return { status: "conflict", reason: "operation-collision" };
    }
    if (error instanceof ApiError && error.code === "slot_conflict") {
      return { status: "conflict", reason: "slot-conflict" };
    }
    return { status: "uncertain" };
  }
}

interface PublicProviderRecoveryRow {
  readonly request_hash: string;
  readonly state: "pending" | "committed" | "rejected";
}

const recoveredGoogleBookingKind = (
  providerEvent: Readonly<Record<string, unknown>>,
): "meeting" | "approval-hold" | null => {
  const extended = isRecord(providerEvent.extendedProperties)
    ? providerEvent.extendedProperties
    : null;
  const privateValues = extended && isRecord(extended.private) ? extended.private : null;
  return privateValues?.tapBookingKind === "meeting" ||
      privateValues?.tapBookingKind === "approval-hold"
    ? privateValues.tapBookingKind
    : null;
};

async function recoverPublicGoogleBookingForScope(
  command: ScopeFirstGoogleBookingRecoveryInput,
  env: CalendarGatewayEnv,
  providerFetch: ProviderFetch,
): Promise<PublicProviderBookingRecovery> {
  if (
    !PUBLIC_GOOGLE_OPERATION_ID.test(command.providerEventId) ||
    !SHA256_BASE64URL.test(command.requestHash)
  ) return { status: "uncertain" };
  try {
    const stored = await env.CALENDAR_DB.prepare(
      `SELECT request_hash, state
         FROM provider_booking_commits
        WHERE workspace_id = ? AND principal_id = ?
          AND idempotency_key = ? AND destination_calendar_id = ?
          AND provider_event_id = ?`,
    )
      .bind(
        command.scope.workspace,
        command.scope.principal,
        command.providerEventId,
        command.destinationCalendarId,
        command.providerEventId,
      )
      .first<PublicProviderRecoveryRow>();
    if (stored && stored.request_hash !== command.requestHash) {
      return { status: "uncertain" };
    }
    const targets = await loadCalendarSyncTargets(
      env,
      command.scope.workspace,
      command.scope.principal,
      [command.destinationCalendarId],
    );
    const target = targets[0];
    if (
      targets.length !== 1 || !target || target.provider !== "google" ||
      target.mode !== "oauth" || target.writable !== 1 || target.role === "free-busy"
    ) return { status: "uncertain" };
    const { secret } = await authorizedToken(
      env,
      connectionFromSyncTarget(target),
      providerFetch,
    );
    const providerEvent = await getGoogleCommittedEvent(
      target,
      command.providerEventId,
      secret.accessToken,
      providerFetch,
    );
    if (!providerEvent) {
      return stored?.state === "committed" ? { status: "uncertain" } : { status: "absent" };
    }
    if (googleCommitHash(providerEvent) !== command.requestHash) {
      return { status: "uncertain" };
    }
    const normalized = normalizeGoogleCalendarEvent(
      providerEvent,
      command.destinationCalendarId,
    );
    const bookingKind = recoveredGoogleBookingKind(providerEvent);
    if (
      !normalized || !bookingKind || normalized.start !== command.timeMin ||
      normalized.end !== command.timeMax || normalized.status === "cancelled" ||
      normalized.status === "declined"
    ) return { status: "uncertain" };
    return {
      status: "committed",
      receipt: publicProviderReceipt({
        ...command,
        bookingKind,
      }),
    };
  } catch {
    return { status: "uncertain" };
  }
}

/**
 * Production public-booking provider backed by the organizer's existing
 * Google commit engine. The caller supplies an already resolved owner scope;
 * this factory never constructs a Request or accepts TAP identity headers.
 */
export function createGatewayPublicBookingProvider(
  env: CalendarGatewayEnv,
  providerFetch: ProviderFetch,
  options: {
    readonly assertPublicationCurrent: () => Promise<void>;
  },
): PublicBookingProvider {
  return createPublicGoogleBookingProvider({
    commit: command => commitPublicGoogleBookingForScope(
      command,
      env,
      providerFetch,
      options.assertPublicationCurrent,
    ),
    recover: command => recoverPublicGoogleBookingForScope(command, env, providerFetch),
  });
}

interface PublicGoogleManagementCommitRow {
  readonly request_hash: string;
  readonly booking_kind: "meeting" | "approval-hold" | "work-block";
  readonly state: "pending" | "committed" | "rejected";
  readonly resolution_status: "approved" | "declined" | null;
  readonly hold_expired_at: string | null;
}

type ManagedGoogleEventLookup =
  | { readonly status: "present"; readonly event: Readonly<Record<string, unknown>> }
  | { readonly status: "absent" };

const publicGoogleManagementReceipt = (
  input: Pick<
    ScopeFirstGoogleCancellationInput,
    "operationId" | "cancellationHash" | "providerEventId" | "timeMin" | "timeMax"
  >,
): PublicBookingManagementProviderReceipt => ({
  operationId: input.operationId,
  providerBookingId: input.providerEventId,
  startsAt: input.timeMin,
  endsAt: input.timeMax,
  status: "cancelled",
});

const publicGoogleRescheduleReceipt = (
  input: ScopeFirstGoogleRescheduleInput,
): PublicBookingManagementProviderReceipt => ({
  operationId: input.operationId,
  providerBookingId: input.providerEventId,
  startsAt: input.timeMin,
  endsAt: input.timeMax,
  status: "confirmed",
});

const publicGoogleManagementInstant = (value: string): boolean => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
};

const validPublicGoogleCancellationCommand = (
  input: ScopeFirstGoogleCancellationInput,
): boolean =>
  PUBLIC_GOOGLE_OPERATION_ID.test(input.providerEventId) &&
  input.providerOperationId === input.providerEventId &&
  IDENTIFIER.test(input.destinationCalendarId) &&
  IDENTIFIER.test(input.operationId) &&
  SHA256_BASE64URL.test(input.originalCommitHash) &&
  SHA256_BASE64URL.test(input.cancellationHash) &&
  publicGoogleManagementInstant(input.timeMin) &&
  publicGoogleManagementInstant(input.timeMax) &&
  Date.parse(input.timeMax) > Date.parse(input.timeMin);

const validPublicGoogleRescheduleCommand = (
  input: ScopeFirstGoogleRescheduleInput,
): boolean => {
  if (
    !PUBLIC_GOOGLE_OPERATION_ID.test(input.providerEventId) ||
    input.providerOperationId !== input.providerEventId ||
    !IDENTIFIER.test(input.destinationCalendarId) ||
    !IDENTIFIER.test(input.operationId) ||
    !SHA256_BASE64URL.test(input.originalCommitHash) ||
    !SHA256_BASE64URL.test(input.rescheduleHash) ||
    !publicGoogleManagementInstant(input.originalTimeMin) ||
    !publicGoogleManagementInstant(input.originalTimeMax) ||
    !publicGoogleManagementInstant(input.timeMin) ||
    !publicGoogleManagementInstant(input.timeMax) ||
    !publicGoogleManagementInstant(input.conflictTimeMin) ||
    !publicGoogleManagementInstant(input.conflictTimeMax) ||
    Date.parse(input.originalTimeMax) <= Date.parse(input.originalTimeMin) ||
    Date.parse(input.timeMax) <= Date.parse(input.timeMin) ||
    Date.parse(input.conflictTimeMax) <= Date.parse(input.conflictTimeMin) ||
    Date.parse(input.conflictTimeMin) > Date.parse(input.timeMin) ||
    Date.parse(input.conflictTimeMax) < Date.parse(input.timeMax) ||
    input.conflictCalendarIds.length === 0 ||
    input.conflictCalendarIds.length > MAX_EVENT_QUERY_CALENDARS ||
    !input.conflictCalendarIds.every(calendarId => IDENTIFIER.test(calendarId)) ||
    new Set(input.conflictCalendarIds).size !== input.conflictCalendarIds.length ||
    !input.conflictCalendarIds.includes(input.destinationCalendarId)
  ) return false;
  const sorted = [...input.conflictCalendarIds].sort();
  return input.conflictCalendarIds.every((calendarId, index) => calendarId === sorted[index]);
};

async function verifiedPublicGoogleManagementCommit(
  env: CalendarGatewayEnv,
  input: Pick<
    ScopeFirstGoogleCancellationInput,
    | "scope"
    | "destinationCalendarId"
    | "providerEventId"
    | "providerOperationId"
    | "originalCommitHash"
    | "bookingStatus"
  >,
): Promise<boolean> {
  const stored = await env.CALENDAR_DB.prepare(
    `SELECT request_hash, booking_kind, state, resolution_status, hold_expired_at
      FROM provider_booking_commits
      WHERE workspace_id = ? AND principal_id = ?
        AND destination_calendar_id = ? AND provider_event_id = ?
        AND idempotency_key = ?`,
  )
    .bind(
      input.scope.workspace,
      input.scope.principal,
      input.destinationCalendarId,
      input.providerEventId,
      input.providerOperationId,
    )
    .first<PublicGoogleManagementCommitRow>();
  if (
    !stored || stored.state !== "committed" ||
    stored.request_hash !== input.originalCommitHash ||
    stored.booking_kind === "work-block" ||
    stored.resolution_status === "declined" ||
    stored.hold_expired_at
  ) return false;
  return input.bookingStatus === "pending"
    ? stored.booking_kind === "approval-hold" && stored.resolution_status === null
    : stored.booking_kind === "meeting" || stored.resolution_status === "approved";
}

async function publicGoogleManagementTarget(
  env: CalendarGatewayEnv,
  input: Pick<
    ScopeFirstGoogleCancellationInput,
    "scope" | "destinationCalendarId"
  >,
): Promise<CalendarSyncTarget | null> {
  const targets = await loadCalendarSyncTargets(
    env,
    input.scope.workspace,
    input.scope.principal,
    [input.destinationCalendarId],
  );
  const target = targets[0];
  return targets.length === 1 && target && target.provider === "google" &&
      target.mode === "oauth" && target.connection_status === "connected" &&
      target.writable === 1 && target.role !== "free-busy"
    ? target
    : null;
}

async function getGoogleManagedEvent(
  target: CalendarSyncTarget,
  providerEventId: string,
  accessToken: string,
  providerFetch: ProviderFetch,
): Promise<ManagedGoogleEventLookup> {
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(target.provider_calendar_id)}/events/${encodeURIComponent(providerEventId)}`,
  );
  url.searchParams.set("maxAttendees", String(MAX_EVENT_ATTENDEES));
  url.searchParams.set("fields", GOOGLE_COMMITTED_EVENT_FIELDS);
  try {
    return {
      status: "present",
      event: await externalJson(
        url.href,
        { headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` } },
        providerFetch,
      ),
    };
  } catch (error) {
    if (
      error instanceof ProviderHttpError &&
      (error.providerStatus === 404 || error.providerStatus === 410)
    ) return { status: "absent" };
    throw error;
  }
}

const googleRescheduleHash = (
  event: Readonly<Record<string, unknown>>,
): string | null => {
  const extended = isRecord(event.extendedProperties) ? event.extendedProperties : null;
  const privateValues = extended && isRecord(extended.private) ? extended.private : null;
  return privateValues && typeof privateValues.tapRescheduleHash === "string"
    ? privateValues.tapRescheduleHash
    : null;
};

const verifiedManagedGoogleEvent = (
  event: Readonly<Record<string, unknown>>,
  input: Pick<
    ScopeFirstGoogleCancellationInput,
    "providerEventId" | "originalCommitHash" | "timeMin" | "timeMax"
  >,
  destinationCalendarId: string,
): GatewayCalendarEvent | null => {
  if (
    event.id !== input.providerEventId ||
    googleCommitHash(event) !== input.originalCommitHash ||
    event.status === "cancelled"
  ) return null;
  const normalized = normalizeGoogleCalendarEvent(event, destinationCalendarId);
  return normalized && normalized.start === input.timeMin && normalized.end === input.timeMax
    ? normalized
    : null;
};

async function releasePublicGoogleManagementLocks(
  env: CalendarGatewayEnv,
  scope: CalendarPrincipalScope,
  calendarIds: readonly string[],
  leaseToken: string,
): Promise<void> {
  const releases = await Promise.allSettled(calendarIds.map(calendarId =>
    releaseBookingCommitLock(env, scope.workspace, scope.principal, calendarId, leaseToken)
  ));
  releases.forEach((release, index) => {
    if (release.status !== "rejected") return;
    logCalendarSync("warn", "public booking management lock release failed", {
      workspace_id: scope.workspace,
      calendar_id: calendarIds[index],
      error: release.reason instanceof Error ? release.reason.message : "unknown error",
    });
  });
}

async function acquirePublicGoogleManagementLocks(
  env: CalendarGatewayEnv,
  scope: CalendarPrincipalScope,
  calendarIds: readonly string[],
  leaseToken: string,
): Promise<readonly string[] | null> {
  const acquired: string[] = [];
  for (const calendarId of [...calendarIds].sort()) {
    if (await acquireBookingCommitLock(
      env,
      scope.workspace,
      scope.principal,
      calendarId,
      leaseToken,
    )) {
      acquired.push(calendarId);
      continue;
    }
    await releasePublicGoogleManagementLocks(env, scope, acquired, leaseToken);
    return null;
  }
  return acquired;
}

async function stageCancelledPublicGoogleBooking(
  env: CalendarGatewayEnv,
  target: CalendarSyncTarget,
  providerEventId: string,
): Promise<void> {
  const cancelledAt = new Date().toISOString();
  try {
    await stageBookingCacheMutation(env, target, {
      providerEventId,
      eventId: googleEventId("event", target.id, providerEventId),
      start: null,
      end: null,
      tombstoned: true,
      payload: { id: providerEventId, status: "cancelled" },
      providerUpdatedAt: cancelledAt,
    });
  } catch (error) {
    logCalendarSync("warn", "public booking cancellation cache staging failed", {
      workspace_id: target.workspace_id,
      connection_id: target.connection_id,
      calendar_id: target.id,
      provider_event_id: providerEventId,
      error: error instanceof Error ? error.message : "unknown error",
    });
  }
}

type GoogleDeleteResult = "deleted" | "absent" | "changed" | "failed";

async function deleteVerifiedPublicGoogleBooking(
  target: CalendarSyncTarget,
  event: Readonly<Record<string, unknown>>,
  input: ScopeFirstGoogleCancellationInput,
  accessToken: string,
  providerFetch: ProviderFetch,
): Promise<GoogleDeleteResult> {
  if (typeof event.etag !== "string" || event.etag.length === 0) return "failed";
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(target.provider_calendar_id)}/events/${encodeURIComponent(input.providerEventId)}`,
  );
  url.searchParams.set("sendUpdates", input.bookingStatus === "confirmed" ? "all" : "none");
  let response: Response;
  try {
    response = await providerFetch(url.href, {
      method: "DELETE",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "If-Match": event.etag,
      },
    });
  } catch {
    return "failed";
  }
  try {
    await response.body?.cancel();
  } catch {
    // The status is authoritative; a discarded DELETE response body is irrelevant.
  }
  if (response.ok) return "deleted";
  if (response.status === 404 || response.status === 410) return "absent";
  if (response.status === 412) return "changed";
  return "failed";
}

async function cancelPublicGoogleBookingForScope(
  input: ScopeFirstGoogleCancellationInput,
  env: CalendarGatewayEnv,
  providerFetch: ProviderFetch,
): Promise<PublicBookingManagementProviderResult> {
  if (!validPublicGoogleCancellationCommand(input)) return { status: "uncertain" };
  try {
    if (!await verifiedPublicGoogleManagementCommit(env, input)) {
      return { status: "conflict", reason: "provider-mismatch" };
    }
    const target = await publicGoogleManagementTarget(env, input);
    if (!target) return { status: "uncertain" };
    const leaseToken = crypto.randomUUID();
    const acquired = await acquirePublicGoogleManagementLocks(
      env,
      input.scope,
      [input.destinationCalendarId],
      leaseToken,
    );
    if (!acquired) return { status: "uncertain" };
    try {
      const { secret } = await authorizedToken(
        env,
        connectionFromSyncTarget(target),
        providerFetch,
      );
      const lookup = await getGoogleManagedEvent(
        target,
        input.providerEventId,
        secret.accessToken,
        providerFetch,
      );
      if (lookup.status === "absent") {
        await stageCancelledPublicGoogleBooking(env, target, input.providerEventId);
        return { status: "committed", receipt: publicGoogleManagementReceipt(input) };
      }
      if (lookup.event.status === "cancelled") {
        if (
          lookup.event.id !== input.providerEventId ||
          googleCommitHash(lookup.event) !== input.originalCommitHash
        ) return { status: "conflict", reason: "provider-mismatch" };
        await stageCancelledPublicGoogleBooking(env, target, input.providerEventId);
        return { status: "committed", receipt: publicGoogleManagementReceipt(input) };
      }
      if (!verifiedManagedGoogleEvent(
        lookup.event,
        input,
        input.destinationCalendarId,
      )) return { status: "conflict", reason: "provider-mismatch" };
      const deletion = await deleteVerifiedPublicGoogleBooking(
        target,
        lookup.event,
        input,
        secret.accessToken,
        providerFetch,
      );
      if (deletion === "changed") {
        return { status: "conflict", reason: "provider-mismatch" };
      }
      if (deletion === "failed") return { status: "uncertain" };
      await stageCancelledPublicGoogleBooking(env, target, input.providerEventId);
      return { status: "committed", receipt: publicGoogleManagementReceipt(input) };
    } finally {
      await releasePublicGoogleManagementLocks(env, input.scope, acquired, leaseToken);
    }
  } catch {
    return { status: "uncertain" };
  }
}

const rescheduleAlreadyCommitted = (
  event: Readonly<Record<string, unknown>>,
  input: ScopeFirstGoogleRescheduleInput,
): boolean => {
  const normalized = normalizeGoogleCalendarEvent(event, input.destinationCalendarId);
  return event.id === input.providerEventId &&
    googleCommitHash(event) === input.originalCommitHash &&
    googleRescheduleHash(event) === input.rescheduleHash &&
    Boolean(normalized) && normalized?.start === input.timeMin && normalized.end === input.timeMax &&
    normalized.status !== "cancelled" && normalized.status !== "declined";
};

async function hasPublicGoogleRescheduleOverlap(
  env: CalendarGatewayEnv,
  input: ScopeFirstGoogleRescheduleInput,
): Promise<boolean> {
  const overlap = await env.CALENDAR_DB.prepare(
    `SELECT idempotency_key
       FROM provider_booking_commits
      WHERE workspace_id = ? AND principal_id = ?
        AND destination_calendar_id IN (${input.conflictCalendarIds.map(() => "?").join(", ")})
        AND state IN ('pending', 'committed')
        AND (booking_kind <> 'approval-hold' OR resolution_status IS NULL OR resolution_status <> 'declined')
        AND (booking_kind <> 'approval-hold' OR hold_expired_at IS NULL)
        AND provider_event_id <> ?
        AND start_at < ? AND end_at > ?
      LIMIT 1`,
  )
    .bind(
      input.scope.workspace,
      input.scope.principal,
      ...input.conflictCalendarIds,
      input.providerEventId,
      input.conflictTimeMax,
      input.conflictTimeMin,
    )
    .first<{ readonly idempotency_key: string }>();
  return Boolean(overlap);
}

async function patchVerifiedPublicGoogleBooking(
  target: CalendarSyncTarget,
  event: Readonly<Record<string, unknown>>,
  input: ScopeFirstGoogleRescheduleInput,
  accessToken: string,
  providerFetch: ProviderFetch,
): Promise<Readonly<Record<string, unknown>>> {
  if (typeof event.etag !== "string" || event.etag.length === 0) {
    throw new ApiError(502, "provider_event_invalid", "Google did not return an event version.");
  }
  const extended = isRecord(event.extendedProperties) ? event.extendedProperties : {};
  const privateValues = isRecord(extended.private) ? extended.private : {};
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(target.provider_calendar_id)}/events/${encodeURIComponent(input.providerEventId)}`,
  );
  url.searchParams.set("sendUpdates", input.bookingStatus === "confirmed" ? "all" : "none");
  url.searchParams.set("maxAttendees", String(MAX_EVENT_ATTENDEES));
  url.searchParams.set("fields", GOOGLE_COMMITTED_EVENT_FIELDS);
  return externalJson(
    url.href,
    {
      method: "PATCH",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "If-Match": event.etag,
      },
      body: JSON.stringify({
        start: { dateTime: input.timeMin },
        end: { dateTime: input.timeMax },
        extendedProperties: {
          ...extended,
          private: {
            ...privateValues,
            tapCommitHash: input.originalCommitHash,
            tapRescheduleHash: input.rescheduleHash,
          },
        },
      }),
    },
    providerFetch,
  );
}

async function stageRescheduledPublicGoogleBooking(
  env: CalendarGatewayEnv,
  target: CalendarSyncTarget,
  event: Readonly<Record<string, unknown>>,
): Promise<void> {
  const normalized = normalizeGoogleCalendarEvent(event, target.id);
  if (!normalized) return;
  try {
    await stageBookingCacheMutation(env, target, {
      providerEventId: requiredText(event.id, "provider event id", 2048),
      eventId: normalized.id,
      start: normalized.start,
      end: normalized.end,
      tombstoned: false,
      payload: normalized,
      providerUpdatedAt: typeof event.updated === "string" &&
          Number.isFinite(Date.parse(event.updated))
        ? new Date(event.updated).toISOString()
        : null,
    });
  } catch (error) {
    logCalendarSync("warn", "public booking reschedule cache staging failed", {
      workspace_id: target.workspace_id,
      connection_id: target.connection_id,
      calendar_id: target.id,
      provider_event_id: typeof event.id === "string" ? event.id : null,
      error: error instanceof Error ? error.message : "unknown error",
    });
  }
}

async function reschedulePublicGoogleBookingForScope(
  input: ScopeFirstGoogleRescheduleInput,
  env: CalendarGatewayEnv,
  providerFetch: ProviderFetch,
  assertWriteStillAuthorized: (input: ScopeFirstGoogleRescheduleInput) => Promise<void>,
): Promise<PublicBookingManagementProviderResult> {
  if (!validPublicGoogleRescheduleCommand(input) || input.bookingStatus !== "confirmed") {
    return { status: "uncertain" };
  }
  try {
    if (!await verifiedPublicGoogleManagementCommit(env, {
      scope: input.scope,
      destinationCalendarId: input.destinationCalendarId,
      providerEventId: input.providerEventId,
      providerOperationId: input.providerOperationId,
      originalCommitHash: input.originalCommitHash,
      bookingStatus: input.bookingStatus,
    })) return { status: "conflict", reason: "provider-mismatch" };
    const targets = await loadCalendarSyncTargets(
      env,
      input.scope.workspace,
      input.scope.principal,
      input.conflictCalendarIds,
    );
    if (
      targets.length !== input.conflictCalendarIds.length ||
      targets.some(target =>
        target.provider !== "google" || target.mode !== "oauth" ||
        target.connection_status !== "connected"
      )
    ) return { status: "uncertain" };
    const target = targets.find(candidate => candidate.id === input.destinationCalendarId);
    if (!target || target.writable !== 1 || target.role === "free-busy") {
      return { status: "uncertain" };
    }
    const leaseToken = crypto.randomUUID();
    const acquired = await acquirePublicGoogleManagementLocks(
      env,
      input.scope,
      input.conflictCalendarIds,
      leaseToken,
    );
    if (!acquired) return { status: "uncertain" };
    try {
      const { secret } = await authorizedToken(
        env,
        connectionFromSyncTarget(target),
        providerFetch,
      );
      let lookup = await getGoogleManagedEvent(
        target,
        input.providerEventId,
        secret.accessToken,
        providerFetch,
      );
      if (lookup.status === "absent") return { status: "uncertain" };
      if (rescheduleAlreadyCommitted(lookup.event, input)) {
        await stageRescheduledPublicGoogleBooking(env, target, lookup.event);
        return { status: "committed", receipt: publicGoogleRescheduleReceipt(input) };
      }
      if (
        googleRescheduleHash(lookup.event) === input.rescheduleHash ||
        !verifiedManagedGoogleEvent(
          lookup.event,
          {
            providerEventId: input.providerEventId,
            originalCommitHash: input.originalCommitHash,
            timeMin: input.originalTimeMin,
            timeMax: input.originalTimeMax,
          },
          input.destinationCalendarId,
        )
      ) return { status: "conflict", reason: "provider-mismatch" };
      if (await hasPublicGoogleRescheduleOverlap(env, input)) {
        return { status: "conflict", reason: "slot-conflict" };
      }
      const validation = await strictLiveAvailabilityForScope(
        input.scope,
        env,
        {
          timeMin: input.conflictTimeMin,
          timeMax: input.conflictTimeMax,
          calendarIds: input.conflictCalendarIds,
        },
        providerFetch,
        new Set([googleEventId("event", target.id, input.providerEventId)]),
      );
      if (!validation.conclusive) return { status: "uncertain" };
      if (!validation.available) return { status: "conflict", reason: "slot-conflict" };
      await assertWriteStillAuthorized(input);
      lookup = {
        status: "present",
        event: await patchVerifiedPublicGoogleBooking(
          target,
          lookup.event,
          input,
          secret.accessToken,
          providerFetch,
        ),
      };
      if (!rescheduleAlreadyCommitted(lookup.event, input)) return { status: "uncertain" };
      await stageRescheduledPublicGoogleBooking(env, target, lookup.event);
      return { status: "committed", receipt: publicGoogleRescheduleReceipt(input) };
    } finally {
      await releasePublicGoogleManagementLocks(env, input.scope, acquired, leaseToken);
    }
  } catch (error) {
    if (
      error instanceof ProviderHttpError &&
      (error.providerStatus === 409 || error.providerStatus === 412)
    ) return { status: "conflict", reason: "provider-mismatch" };
    return { status: "uncertain" };
  }
}

async function recoverPublicGoogleCancellationForScope(
  input: ScopeFirstGoogleCancellationInput,
  env: CalendarGatewayEnv,
  providerFetch: ProviderFetch,
): Promise<PublicBookingManagementProviderRecovery> {
  if (!validPublicGoogleCancellationCommand(input)) return { status: "uncertain" };
  try {
    if (!await verifiedPublicGoogleManagementCommit(env, input)) return { status: "uncertain" };
    const target = await publicGoogleManagementTarget(env, input);
    if (!target) return { status: "uncertain" };
    const leaseToken = crypto.randomUUID();
    const acquired = await acquirePublicGoogleManagementLocks(
      env,
      input.scope,
      [input.destinationCalendarId],
      leaseToken,
    );
    if (!acquired) return { status: "uncertain" };
    try {
      const { secret } = await authorizedToken(
        env,
        connectionFromSyncTarget(target),
        providerFetch,
      );
      const lookup = await getGoogleManagedEvent(
        target,
        input.providerEventId,
        secret.accessToken,
        providerFetch,
      );
      if (lookup.status === "absent") {
        await stageCancelledPublicGoogleBooking(env, target, input.providerEventId);
        return { status: "committed", receipt: publicGoogleManagementReceipt(input) };
      }
      if (lookup.event.status === "cancelled") {
        if (
          lookup.event.id !== input.providerEventId ||
          googleCommitHash(lookup.event) !== input.originalCommitHash
        ) return { status: "uncertain" };
        await stageCancelledPublicGoogleBooking(env, target, input.providerEventId);
        return { status: "committed", receipt: publicGoogleManagementReceipt(input) };
      }
      return verifiedManagedGoogleEvent(lookup.event, input, input.destinationCalendarId)
        ? { status: "absent" }
        : { status: "uncertain" };
    } finally {
      await releasePublicGoogleManagementLocks(env, input.scope, acquired, leaseToken);
    }
  } catch {
    return { status: "uncertain" };
  }
}

async function recoverPublicGoogleRescheduleForScope(
  input: ScopeFirstGoogleRescheduleInput,
  env: CalendarGatewayEnv,
  providerFetch: ProviderFetch,
): Promise<PublicBookingManagementProviderRecovery> {
  if (!validPublicGoogleRescheduleCommand(input) || input.bookingStatus !== "confirmed") {
    return { status: "uncertain" };
  }
  try {
    if (!await verifiedPublicGoogleManagementCommit(env, {
      scope: input.scope,
      destinationCalendarId: input.destinationCalendarId,
      providerEventId: input.providerEventId,
      providerOperationId: input.providerOperationId,
      originalCommitHash: input.originalCommitHash,
      bookingStatus: input.bookingStatus,
    })) return { status: "uncertain" };
    const target = await publicGoogleManagementTarget(env, input);
    if (!target) return { status: "uncertain" };
    const leaseToken = crypto.randomUUID();
    const acquired = await acquirePublicGoogleManagementLocks(
      env,
      input.scope,
      input.conflictCalendarIds,
      leaseToken,
    );
    if (!acquired) return { status: "uncertain" };
    try {
      const { secret } = await authorizedToken(
        env,
        connectionFromSyncTarget(target),
        providerFetch,
      );
      const lookup = await getGoogleManagedEvent(
        target,
        input.providerEventId,
        secret.accessToken,
        providerFetch,
      );
      if (lookup.status === "absent") return { status: "uncertain" };
      if (rescheduleAlreadyCommitted(lookup.event, input)) {
        await stageRescheduledPublicGoogleBooking(env, target, lookup.event);
        return { status: "committed", receipt: publicGoogleRescheduleReceipt(input) };
      }
      if (googleRescheduleHash(lookup.event) === input.rescheduleHash) {
        return { status: "uncertain" };
      }
      return verifiedManagedGoogleEvent(
        lookup.event,
        {
          providerEventId: input.providerEventId,
          originalCommitHash: input.originalCommitHash,
          timeMin: input.originalTimeMin,
          timeMax: input.originalTimeMax,
        },
        input.destinationCalendarId,
      )
        ? { status: "absent" }
        : { status: "uncertain" };
    } finally {
      await releasePublicGoogleManagementLocks(env, input.scope, acquired, leaseToken);
    }
  } catch {
    return { status: "uncertain" };
  }
}

/**
 * Scope-first guest-management provider backed by the organizer's canonical
 * Google connection. It never accepts a Request or caller-supplied TAP headers.
 */
export function createGatewayPublicBookingManagementProvider(
  env: CalendarGatewayEnv,
  providerFetch: ProviderFetch,
  options: {
    readonly assertRescheduleStillAuthorized: (
      input: ScopeFirstGoogleRescheduleInput,
    ) => Promise<void>;
  },
): PublicBookingManagementProvider {
  return createPublicGoogleBookingManagementProvider({
    cancel: command => cancelPublicGoogleBookingForScope(command, env, providerFetch),
    recoverCancellation: command =>
      recoverPublicGoogleCancellationForScope(command, env, providerFetch),
    reschedule: command => reschedulePublicGoogleBookingForScope(
      command,
      env,
      providerFetch,
      options.assertRescheduleStillAuthorized,
    ),
    recoverReschedule: command =>
      recoverPublicGoogleRescheduleForScope(command, env, providerFetch),
  });
}

function providerBookingResolutionInput(
  body: Readonly<Record<string, unknown>>,
): ProviderBookingResolutionInput {
  if (body.decision !== "approve" && body.decision !== "decline") {
    throw new ApiError(400, "invalid_resolution", "decision must be approve or decline.");
  }
  if (!Array.isArray(body.attendeeEmails ?? [])) {
    throw new ApiError(400, "invalid_attendees", "attendeeEmails must be an array.");
  }
  const attendeeValues = (body.attendeeEmails ?? []) as readonly unknown[];
  if (attendeeValues.length > MAX_BOOKING_ATTENDEES) {
    throw new ApiError(
      400,
      "invalid_attendees",
      `Choose at most ${MAX_BOOKING_ATTENDEES} attendees.`,
    );
  }
  const attendeeEmails = attendeeValues.map((value, index) => {
    const email = requiredText(value, `attendeeEmails[${index}]`, 320).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
      throw new ApiError(400, "invalid_attendees", `attendeeEmails[${index}] is invalid.`);
    }
    return email;
  });
  if (new Set(attendeeEmails).size !== attendeeEmails.length) {
    throw new ApiError(400, "invalid_attendees", "Attendee emails must be unique.");
  }
  const conferenceProvider = body.conferenceProvider ?? "none";
  if (conferenceProvider !== "none" && conferenceProvider !== "google-meet") {
    throw new ApiError(
      400,
      "unsupported_conference_provider",
      "conferenceProvider must be none or google-meet for a Google destination.",
    );
  }
  if (
    body.decision === "decline" &&
    (attendeeEmails.length > 0 || conferenceProvider !== "none")
  ) {
    throw new ApiError(
      400,
      "invalid_resolution",
      "A declined hold cannot invite attendees or create a conference.",
    );
  }
  const currentConflictValues = body.conflictCalendarIds ?? [];
  if (
    !Array.isArray(currentConflictValues) ||
    currentConflictValues.length > MAX_EVENT_QUERY_CALENDARS ||
    (body.decision === "approve" && currentConflictValues.length === 0)
  ) {
    throw new ApiError(
      400,
      "invalid_calendar_ids",
      `Approve with between 1 and ${MAX_EVENT_QUERY_CALENDARS} current conflict calendars.`,
    );
  }
  const currentConflictCalendarIds = currentConflictValues.map((value, index) =>
    identifier(value, `conflictCalendarIds[${index}]`)
  );
  if (new Set(currentConflictCalendarIds).size !== currentConflictCalendarIds.length) {
    throw new ApiError(400, "invalid_calendar_ids", "Conflict calendar identifiers must be unique.");
  }
  return {
    idempotencyKey: identifier(body.idempotencyKey, "idempotencyKey"),
    decision: body.decision,
    title: optionalCommitText(body.title, "title", 255),
    description: optionalCommitText(body.description, "description", 4_000),
    location: optionalCommitText(body.location, "location", 1_024),
    attendeeEmails,
    attendeeEmailsProvided: body.attendeeEmails !== undefined,
    conferenceProvider,
    currentConflictCalendarIds,
  };
}

const googleResolutionHash = (value: Readonly<Record<string, unknown>>): string | null => {
  const extended = isRecord(value.extendedProperties) ? value.extendedProperties : null;
  const privateValues = extended && isRecord(extended.private) ? extended.private : null;
  return privateValues && typeof privateValues.tapResolutionHash === "string"
    ? privateValues.tapResolutionHash
    : null;
};

async function patchGoogleApprovedHold(
  target: CalendarSyncTarget,
  original: ProviderBookingCommitRow,
  current: Readonly<Record<string, unknown>>,
  input: ProviderBookingResolutionInput,
  requestHash: string,
  accessToken: string,
  providerFetch: ProviderFetch,
): Promise<Readonly<Record<string, unknown>>> {
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(target.provider_calendar_id)}/events/${encodeURIComponent(original.provider_event_id)}`,
  );
  url.searchParams.set("sendUpdates", input.attendeeEmails.length > 0 ? "all" : "none");
  url.searchParams.set("maxAttendees", String(MAX_EVENT_ATTENDEES));
  url.searchParams.set("fields", GOOGLE_COMMITTED_EVENT_FIELDS);
  if (input.conferenceProvider === "google-meet") {
    url.searchParams.set("conferenceDataVersion", "1");
  }
  const currentTitle = typeof current.summary === "string"
    ? current.summary.replace(/^Pending approval:\s*/u, "").trim()
    : "Approved meeting";
  const body: Record<string, unknown> = {
    summary: input.title ?? (currentTitle || "Approved meeting"),
    status: "confirmed",
    transparency: "opaque",
    attendees: input.attendeeEmails.map(email => ({ email })),
    extendedProperties: {
      private: {
        tapCommitHash: original.request_hash,
        tapBookingKind: "meeting",
        tapResolutionHash: requestHash,
      },
    },
  };
  if (input.description !== null) body.description = input.description;
  if (input.location !== null) body.location = input.location;
  if (input.conferenceProvider === "google-meet") {
    body.conferenceData = {
      createRequest: {
        requestId: `${original.provider_event_id}a`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }
  return externalJson(
    url.href,
    {
      method: "PATCH",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    providerFetch,
  );
}

async function deleteGoogleApprovalHold(
  target: CalendarSyncTarget,
  providerEventId: string,
  accessToken: string,
  providerFetch: ProviderFetch,
): Promise<void> {
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(target.provider_calendar_id)}/events/${encodeURIComponent(providerEventId)}`,
  );
  url.searchParams.set("sendUpdates", "none");
  const response = await providerFetch(url.href, {
    method: "DELETE",
    headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
  });
  if (response.ok || response.status === 404 || response.status === 410) return;
  let message = `Provider request failed with HTTP ${response.status}.`;
  try {
    const value: unknown = await response.json();
    if (isRecord(value) && isRecord(value.error) && typeof value.error.message === "string") {
      message = value.error.message;
    }
  } catch {
    // Keep the bounded status-only provider message.
  }
  throw new ProviderHttpError(response.status, message.slice(0, 500));
}

function storedBookingConflictRange(original: ProviderBookingCommitRow): EventQueryInput {
  if (!original.conflict_calendar_ids_json || !original.start_at || !original.end_at) {
    throw new ApiError(
      409,
      "booking_conflict_set_missing",
      "This approval hold predates stored conflict-set validation and cannot be approved safely.",
    );
  }
  let calendarIds: unknown;
  try {
    calendarIds = JSON.parse(original.conflict_calendar_ids_json);
  } catch {
    throw new ApiError(409, "booking_conflict_set_invalid", "The stored conflict set is invalid.");
  }
  const range = eventQueryInput({
    timeMin: original.start_at,
    timeMax: original.end_at,
    calendarIds,
  });
  if (!range.calendarIds.includes(original.destination_calendar_id)) {
    throw new ApiError(
      409,
      "booking_conflict_set_invalid",
      "The stored conflict set does not include the destination calendar.",
    );
  }
  const sorted = [...range.calendarIds].sort();
  if (!range.calendarIds.every((calendarId, index) => calendarId === sorted[index])) {
    throw new ApiError(
      409,
      "booking_conflict_set_invalid",
      "The stored conflict set is not in canonical order.",
    );
  }
  if (!original.request_json) return range;
  const request = parsedRecord(original.request_json);
  if (!request) {
    throw new ApiError(
      409,
      "booking_conflict_set_invalid",
      "The stored booking request is invalid.",
    );
  }
  const hasConflictTimeMin = request.conflictTimeMin !== undefined;
  const hasConflictTimeMax = request.conflictTimeMax !== undefined;
  if (!hasConflictTimeMin && !hasConflictTimeMax) return range;
  if (hasConflictTimeMin !== hasConflictTimeMax) {
    throw new ApiError(
      409,
      "booking_conflict_set_invalid",
      "The stored conflict validation range is incomplete.",
    );
  }
  let conflictRange: EventQueryInput;
  try {
    conflictRange = eventQueryInput({
      timeMin: request.conflictTimeMin,
      timeMax: request.conflictTimeMax,
      calendarIds: range.calendarIds,
    });
  } catch {
    throw new ApiError(
      409,
      "booking_conflict_set_invalid",
      "The stored conflict validation range is invalid.",
    );
  }
  if (
    Date.parse(conflictRange.timeMin) > Date.parse(range.timeMin) ||
    Date.parse(conflictRange.timeMax) < Date.parse(range.timeMax)
  ) {
    throw new ApiError(
      409,
      "booking_conflict_set_invalid",
      "The stored conflict validation range does not contain the booking.",
    );
  }
  return conflictRange;
}

function storedPendingAttendeeEmails(responseJson: string): readonly string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseJson);
  } catch {
    throw new ApiError(409, "booking_projection_invalid", "The stored booking projection is invalid.");
  }
  const booking = isRecord(parsed) && isRecord(parsed.booking) ? parsed.booking : null;
  const values = booking?.pendingAttendeeEmails ?? [];
  if (!Array.isArray(values) || values.length > MAX_BOOKING_ATTENDEES) {
    throw new ApiError(
      409,
      "booking_projection_invalid",
      "The stored pending attendee set is invalid.",
    );
  }
  const emails = values.map((value, index) => {
    if (
      typeof value !== "string" || value.length > 320 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)
    ) {
      throw new ApiError(
        409,
        "booking_projection_invalid",
        `Stored pending attendee ${index + 1} is invalid.`,
      );
    }
    return value.toLowerCase();
  });
  if (new Set(emails).size !== emails.length) {
    throw new ApiError(
      409,
      "booking_projection_invalid",
      "The stored pending attendee set contains duplicates.",
    );
  }
  return emails;
}

async function resolveGoogleApprovalHold(
  request: Request,
  env: CalendarGatewayEnv,
  bookingIdempotencyKey: string,
  providerFetch: ProviderFetch,
): Promise<Response> {
  const { workspace, principal } = await principalScope(request, env);
  let resolutionLifecycleAt = Date.now();
  let input = providerBookingResolutionInput(await readJson(request));
  const original = await env.CALENDAR_DB.prepare(
    `SELECT request_hash, destination_calendar_id, provider_event_id, booking_kind,
            start_at, end_at, state, response_json, resolution_status,
            conflict_calendar_ids_json, hold_expires_at, hold_expired_at, request_json
       FROM provider_booking_commits
      WHERE workspace_id = ? AND principal_id = ? AND idempotency_key = ?`,
  )
    .bind(workspace, principal, bookingIdempotencyKey)
    .first<ProviderBookingCommitRow>();
  if (!original || original.state !== "committed" || !original.response_json) {
    throw new ApiError(404, "booking_not_found", "The committed booking was not found.");
  }
  if (original.booking_kind !== "approval-hold") {
    throw new ApiError(409, "booking_not_approval_hold", "Only an approval hold can be resolved.");
  }
  if (!input.attendeeEmailsProvided && input.decision === "approve") {
    input = {
      ...input,
      attendeeEmails: storedPendingAttendeeEmails(original.response_json),
    };
  }
  const approvalConflictRange: EventQueryInput | null = input.decision === "approve"
    ? (() => {
      const storedConflictRange = storedBookingConflictRange(original);
      const calendarIds = [...new Set([
        ...storedConflictRange.calendarIds,
        ...input.currentConflictCalendarIds,
      ])].sort();
      if (calendarIds.length > MAX_EVENT_QUERY_CALENDARS) {
        throw new ApiError(
          400,
          "invalid_calendar_ids",
          `The stored/current conflict union may contain at most ${MAX_EVENT_QUERY_CALENDARS} calendars.`,
        );
      }
      return {
        ...storedConflictRange,
        calendarIds,
      };
    })()
    : null;
  const canonical = {
    bookingIdempotencyKey,
    resolutionIdempotencyKey: input.idempotencyKey,
    decision: input.decision,
    title: input.title,
    description: input.description,
    location: input.location,
    attendeeEmails: [...input.attendeeEmails].sort(),
    conferenceProvider: input.conferenceProvider,
    currentConflictCalendarIds: [...input.currentConflictCalendarIds].sort(),
  };
  const requestHash = await sha256(JSON.stringify(canonical));
  const resolution = await env.CALENDAR_DB.prepare(
    `SELECT request_hash, decision, state, response_json, created_at
       FROM provider_booking_resolutions
      WHERE workspace_id = ? AND principal_id = ? AND booking_idempotency_key = ?`,
  )
    .bind(workspace, principal, bookingIdempotencyKey)
    .first<ProviderBookingResolutionRow>();
  if (resolution) {
    const createdAt = Date.parse(resolution.created_at);
    if (Number.isFinite(createdAt)) resolutionLifecycleAt = createdAt;
  }
  if (resolution && resolution.request_hash !== requestHash) {
    throw new ApiError(
      409,
      "approval_already_resolved",
      "This approval hold already has a different resolution.",
    );
  }
  if (resolution?.state === "committed" && resolution.response_json) {
    const stored: unknown = JSON.parse(resolution.response_json);
    await reconcilePublicApprovalResolution(
      env,
      { workspace, principal },
      bookingIdempotencyKey,
      resolution.decision === "approve" ? "confirmed" : "declined",
      resolutionLifecycleAt,
    );
    return json({ ...(isRecord(stored) ? stored : {}), idempotentReplay: true });
  }
  if (!resolution) {
    const reusedKey = await env.CALENDAR_DB.prepare(
      `SELECT booking_idempotency_key
         FROM provider_booking_resolutions
        WHERE workspace_id = ? AND principal_id = ? AND resolution_idempotency_key = ?`,
    )
      .bind(workspace, principal, input.idempotencyKey)
      .first<string>("booking_idempotency_key");
    if (reusedKey) {
      throw new ApiError(
        409,
        "resolution_idempotency_key_reused",
        "This resolution idempotency key was already used for another booking.",
      );
    }
  }
  if (
    !resolution && input.decision === "approve" &&
    (original.hold_expired_at || !original.hold_expires_at ||
      Date.parse(original.hold_expires_at) <= Date.now())
  ) {
    throw new ApiError(410, "approval_hold_expired", "This approval hold has expired.");
  }
  const resolutionCalendarIds = input.decision === "approve"
    ? approvalConflictRange!.calendarIds
    : [original.destination_calendar_id];
  const targets = await loadCalendarSyncTargets(
    env,
    workspace,
    principal,
    resolutionCalendarIds,
  );
  if (targets.length !== resolutionCalendarIds.length) {
    throw new ApiError(
      409,
      "booking_conflict_set_invalid",
      "A stored conflict calendar is no longer connected.",
    );
  }
  const target = targets.find(candidate => candidate.id === original.destination_calendar_id);
  if (
    !target || target.provider !== "google" || target.mode !== "oauth" ||
    target.writable !== 1 || target.role === "free-busy"
  ) {
    throw new ApiError(409, "destination_not_writable", "The Google destination is not writable.");
  }
  const leaseToken = crypto.randomUUID();
  const resolutionLockIds = input.decision === "approve"
    ? [...approvalConflictRange!.calendarIds]
    : [target.id];
  const acquiredCalendarIds: string[] = [];
  for (const calendarId of resolutionLockIds) {
    if (await acquireBookingCommitLock(
      env,
      workspace,
      principal,
      calendarId,
      leaseToken,
    )) {
      acquiredCalendarIds.push(calendarId);
      continue;
    }
    await Promise.allSettled(acquiredCalendarIds.map(acquiredCalendarId =>
      releaseBookingCommitLock(env, workspace, principal, acquiredCalendarId, leaseToken)
    ));
    throw new ApiError(
      409,
      "booking_commit_in_progress",
      "A conflict calendar has another TAP booking commit in progress. Retry shortly.",
    );
  }
  let pendingCreatedThisAttempt = false;
  let providerMutationMayHaveOccurred = false;
  const ensurePendingResolution = async (): Promise<void> => {
    if (resolution) return;
    const createdAt = new Date().toISOString();
    resolutionLifecycleAt = Date.parse(createdAt);
    const inserted = await env.CALENDAR_DB.prepare(
      `INSERT OR IGNORE INTO provider_booking_resolutions
        (workspace_id, principal_id, booking_idempotency_key, resolution_idempotency_key, request_hash,
         decision, state, response_json, last_error_code, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, ?)`,
    )
      .bind(
        workspace,
        principal,
        bookingIdempotencyKey,
        input.idempotencyKey,
        requestHash,
        input.decision,
        createdAt,
        createdAt,
      )
      .run();
    pendingCreatedThisAttempt = Number(inserted.meta.changes ?? 0) === 1;
    if (!pendingCreatedThisAttempt) {
      throw new ApiError(
        409,
        "approval_already_resolved",
        "This approval hold acquired another resolution while waiting for its lock.",
      );
    }
  };
  try {
    const { secret } = await authorizedToken(env, connectionFromSyncTarget(target), providerFetch);
    let providerEvent = await getGoogleCommittedEvent(
      target,
      original.provider_event_id,
      secret.accessToken,
      providerFetch,
    );
    if (providerEvent && googleCommitHash(providerEvent) !== original.request_hash) {
      throw new ApiError(
        409,
        "provider_event_id_collision",
        "The Google event no longer has TAP's original commit proof.",
      );
    }
    if (input.decision === "approve") {
      if (!providerEvent) {
        const removedAt = new Date().toISOString();
        const expired = await env.CALENDAR_DB.prepare(
          `UPDATE provider_booking_commits
              SET hold_expired_at = ?, updated_at = ?
            WHERE workspace_id = ? AND principal_id = ? AND idempotency_key = ?
              AND request_hash = ? AND provider_event_id = ?
              AND booking_kind = 'approval-hold' AND state = 'committed'
              AND resolution_status IS NULL AND hold_expired_at IS NULL`,
        )
          .bind(
            removedAt,
            removedAt,
            workspace,
            principal,
            bookingIdempotencyKey,
            original.request_hash,
            original.provider_event_id,
          )
          .run();
        if (Number(expired.meta.changes ?? 0) === 0) {
          const current = await env.CALENDAR_DB.prepare(
            `SELECT resolution_status, hold_expired_at
               FROM provider_booking_commits
              WHERE workspace_id = ? AND principal_id = ? AND idempotency_key = ?`,
          )
            .bind(workspace, principal, bookingIdempotencyKey)
            .first<Pick<ProviderBookingCommitRow, "resolution_status" | "hold_expired_at">>();
          if (current?.resolution_status) {
            throw new ApiError(
              409,
              "approval_already_resolved",
              "This approval hold was resolved while its provider state was checked.",
            );
          }
          if (current?.hold_expired_at) {
            throw new ApiError(
              410,
              "approval_hold_expired",
              "This approval hold has expired.",
            );
          }
          throw new ApiError(
            502,
            "provider_resolution_uncertain",
            "The missing Google approval hold could not be recorded durably. Retry with the same idempotency key.",
          );
        }
        try {
          await stageBookingCacheMutation(env, target, {
            providerEventId: original.provider_event_id,
            eventId: googleEventId("event", target.id, original.provider_event_id),
            start: null,
            end: null,
            tombstoned: true,
            payload: { id: original.provider_event_id, status: "cancelled" },
            providerUpdatedAt: removedAt,
          });
        } catch (error) {
          logCalendarSync("warn", "missing approval hold cache tombstone failed", {
            workspace_id: workspace,
            connection_id: target.connection_id,
            calendar_id: target.id,
            booking_idempotency_key: bookingIdempotencyKey,
            provider_event_id: original.provider_event_id,
            error: error instanceof Error ? error.message : "unknown error",
          });
          try {
            await env.CALENDAR_DB.prepare(
              `UPDATE calendar_sync_state SET next_sync_at = ?
                WHERE workspace_id = ? AND connection_id = ? AND calendar_id = ?`,
            )
              .bind(removedAt, workspace, target.connection_id, target.id)
              .run();
          } catch {
            // Cron/webhook repair remains the fallback when the due marker cannot be stored.
          }
        }
        throw new ApiError(409, "approval_hold_missing", "The Google approval hold no longer exists.");
      }
      if (googleResolutionHash(providerEvent) !== requestHash) {
        const tapOverlap = await env.CALENDAR_DB.prepare(
          `SELECT idempotency_key
             FROM provider_booking_commits
            WHERE workspace_id = ? AND principal_id = ?
              AND destination_calendar_id IN (${approvalConflictRange!.calendarIds.map(() => "?").join(", ")})
              AND state IN ('pending', 'committed')
              AND (booking_kind <> 'approval-hold' OR resolution_status IS NULL OR resolution_status <> 'declined')
              AND (booking_kind <> 'approval-hold' OR hold_expired_at IS NULL)
              AND idempotency_key <> ?
              AND start_at < ? AND end_at > ?
            LIMIT 1`,
        )
          .bind(
            workspace,
            principal,
            ...approvalConflictRange!.calendarIds,
            bookingIdempotencyKey,
            approvalConflictRange!.timeMax,
            approvalConflictRange!.timeMin,
          )
          .first<{ readonly idempotency_key: string }>();
        if (tapOverlap) {
          throw new ApiError(409, "slot_conflict", "That time is no longer available.");
        }
        const validation = await strictLiveAvailability(
          request,
          env,
          approvalConflictRange!,
          providerFetch,
          new Set([googleEventId("event", target.id, original.provider_event_id)]),
        );
        if (!validation.conclusive) {
          throw new ApiError(
            503,
            "live_availability_unavailable",
            "Every stored conflict calendar must be checked live before approving this hold.",
          );
        }
        if (!validation.available) {
          throw new ApiError(409, "slot_conflict", "That time is no longer available.");
        }
        await ensurePendingResolution();
        providerMutationMayHaveOccurred = true;
        providerEvent = await patchGoogleApprovedHold(
          target,
          original,
          providerEvent,
          input,
          requestHash,
          secret.accessToken,
          providerFetch,
        );
      } else {
        await ensurePendingResolution();
      }
      if (
        googleCommitHash(providerEvent) !== original.request_hash ||
        googleResolutionHash(providerEvent) !== requestHash
      ) {
        throw new ApiError(
          502,
          "provider_resolution_unverified",
          "Google did not return TAP's approval proof.",
        );
      }
    } else {
      await ensurePendingResolution();
      if (providerEvent) {
        providerMutationMayHaveOccurred = true;
        await deleteGoogleApprovalHold(
          target,
          original.provider_event_id,
          secret.accessToken,
          providerFetch,
        );
        providerEvent = null;
      }
    }
    const resolvedEvent = providerEvent
      ? normalizeGoogleCalendarEvent(providerEvent, target.id)
      : null;
    if (providerEvent && !resolvedEvent) {
      throw new ApiError(502, "provider_event_invalid", "Google returned an invalid approved event.");
    }
    const response = {
      resolution: {
        state: "committed",
        decision: input.decision === "approve" ? "approved" : "declined",
        bookingIdempotencyKey,
        providerEventId: original.provider_event_id,
        providerEventRemoved: input.decision === "decline",
        providerJoinUrl: providerEvent ? googleMeetJoinUrl(providerEvent) : null,
        event: resolvedEvent
          ? { ...resolvedEvent, kind: "meeting", status: "confirmed" }
          : null,
      },
      resolvedAt: new Date().toISOString(),
      idempotentReplay: false,
    };
    await env.CALENDAR_DB.batch([
      env.CALENDAR_DB.prepare(
        `UPDATE provider_booking_resolutions
            SET state = 'committed', response_json = ?, last_error_code = NULL, updated_at = ?
          WHERE workspace_id = ? AND principal_id = ? AND booking_idempotency_key = ?`,
      ).bind(
        JSON.stringify(response),
        new Date().toISOString(),
        workspace,
        principal,
        bookingIdempotencyKey,
      ),
      env.CALENDAR_DB.prepare(
        `UPDATE provider_booking_commits
            SET resolution_status = ?, updated_at = ?
          WHERE workspace_id = ? AND principal_id = ? AND idempotency_key = ?`,
      ).bind(
        input.decision === "approve" ? "approved" : "declined",
        new Date().toISOString(),
        workspace,
        principal,
        bookingIdempotencyKey,
      ),
    ]);
    await reconcilePublicApprovalResolution(
      env,
      { workspace, principal },
      bookingIdempotencyKey,
      input.decision === "approve" ? "confirmed" : "declined",
      resolutionLifecycleAt,
    );
    try {
      if (providerEvent) {
        const event = resolvedEvent;
        if (!event) throw new Error("approved provider event is invalid");
        await stageBookingCacheMutation(env, target, {
          providerEventId: original.provider_event_id,
          eventId: event.id,
          start: event.start,
          end: event.end,
          tombstoned: false,
          payload: { ...event, kind: "meeting", status: "confirmed" },
          providerUpdatedAt: typeof providerEvent.updated === "string"
            ? new Date(providerEvent.updated).toISOString()
            : null,
        });
      } else {
        await stageBookingCacheMutation(env, target, {
          providerEventId: original.provider_event_id,
          eventId: googleEventId("event", target.id, original.provider_event_id),
          start: null,
          end: null,
          tombstoned: true,
          payload: { id: original.provider_event_id, status: "cancelled" },
          providerUpdatedAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      logCalendarSync("warn", "resolved booking cache staging failed", {
        workspace_id: workspace,
        connection_id: target.connection_id,
        calendar_id: target.id,
        provider_event_id: original.provider_event_id,
        error: error instanceof Error ? error.message : "unknown error",
      });
      try {
        await env.CALENDAR_DB.prepare(
          `UPDATE calendar_sync_state SET next_sync_at = ?
            WHERE workspace_id = ? AND connection_id = ? AND calendar_id = ?`,
        )
          .bind(new Date().toISOString(), workspace, target.connection_id, target.id)
          .run();
      } catch {
        // Cron/webhook repair remains the final fallback if even the due marker cannot be stored.
      }
    }
    return json(response);
  } catch (error) {
    if (pendingCreatedThisAttempt && !providerMutationMayHaveOccurred) {
      await env.CALENDAR_DB.prepare(
        `DELETE FROM provider_booking_resolutions
          WHERE workspace_id = ? AND principal_id = ? AND booking_idempotency_key = ?
            AND request_hash = ? AND state = 'pending'`,
      )
        .bind(workspace, principal, bookingIdempotencyKey, requestHash)
        .run();
    }
    if (!(error instanceof ApiError && [400, 409].includes(error.status))) {
      await env.CALENDAR_DB.prepare(
        `UPDATE provider_booking_resolutions
            SET last_error_code = ?, updated_at = ?
          WHERE workspace_id = ? AND principal_id = ?
            AND booking_idempotency_key = ? AND state = 'pending'`,
      )
        .bind(
          error instanceof ApiError ? error.code : "provider_resolution_uncertain",
          new Date().toISOString(),
          workspace,
          principal,
          bookingIdempotencyKey,
        )
        .run();
    }
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      502,
      "provider_resolution_uncertain",
      "Google did not confirm the approval resolution. Retry with the same idempotency key.",
    );
  } finally {
    const releases = await Promise.allSettled(acquiredCalendarIds.map(calendarId =>
      releaseBookingCommitLock(env, workspace, principal, calendarId, leaseToken)
    ));
    releases.forEach((release, index) => {
      if (release.status !== "rejected") return;
      logCalendarSync("warn", "approval resolution lock release failed", {
        workspace_id: workspace,
        calendar_id: acquiredCalendarIds[index],
        error: release.reason instanceof Error ? release.reason.message : "unknown error",
      });
    });
  }
}

async function handleGoogleCalendarWebhook(
  request: Request,
  env: CalendarGatewayEnv,
  executionContext: ExecutionContext | undefined,
  providerFetch: ProviderFetch,
): Promise<Response> {
  const channelId = requiredText(request.headers.get("X-Goog-Channel-ID"), "channel id", 64);
  const channelToken = requiredText(
    request.headers.get("X-Goog-Channel-Token"),
    "channel token",
    512,
  );
  const resourceId = requiredText(
    request.headers.get("X-Goog-Resource-ID"),
    "resource id",
    2048,
  );
  const resourceState = requiredText(
    request.headers.get("X-Goog-Resource-State"),
    "resource state",
    32,
  );
  if (!["sync", "exists", "not_exists"].includes(resourceState)) {
    throw new ApiError(400, "invalid_webhook", "The Google notification state is invalid.");
  }
  const channel = await env.CALENDAR_DB.prepare(
    `SELECT calendar_watch_channels.channel_id,
            calendar_watch_channels.workspace_id,
            calendar_watch_channels.connection_id,
            calendar_watch_channels.calendar_id,
            calendar_watch_channels.token_hash,
            calendar_watch_channels.resource_id,
            calendar_watch_channels.expiration_at,
            calendar_connections.principal_id
       FROM calendar_watch_channels
       INNER JOIN calendar_connections
         ON calendar_connections.id = calendar_watch_channels.connection_id
      WHERE calendar_watch_channels.channel_id = ?
        AND calendar_watch_channels.expiration_at > ?
        AND calendar_connections.principal_id IS NOT NULL`,
  )
    .bind(channelId, new Date().toISOString())
    .first<CalendarWatchChannelRow>();
  let tokenMatches = false;
  try {
    tokenMatches = Boolean(channel) &&
      channel!.resource_id === resourceId &&
      await secureTokenMatches(channelToken, channel!.token_hash);
  } catch {
    tokenMatches = false;
  }
  if (!channel || !tokenMatches) {
    throw new ApiError(403, "webhook_denied", "The Google notification channel is invalid.");
  }
  const notifiedAt = new Date().toISOString();
  await env.CALENDAR_DB.batch([
    env.CALENDAR_DB.prepare(
      "UPDATE calendar_watch_channels SET last_notification_at = ? WHERE channel_id = ?",
    ).bind(notifiedAt, channelId),
    env.CALENDAR_DB.prepare(
      `UPDATE calendar_sync_state
          SET last_notification_at = ?, next_sync_at = ?
        WHERE workspace_id = ? AND connection_id = ? AND calendar_id = ?`,
    ).bind(
      notifiedAt,
      notifiedAt,
      channel.workspace_id,
      channel.connection_id,
      channel.calendar_id,
    ),
  ]);
  const target = (await loadCalendarSyncTargets(
    env,
    channel.workspace_id,
    channel.principal_id,
    [channel.calendar_id],
  ))[0];
  if (!target) {
    throw new ApiError(410, "calendar_removed", "The watched calendar no longer exists.");
  }
  const synchronization = syncGoogleCalendarCache(
    env,
    target,
    providerFetch,
    cacheSyncInvocation(),
  ).then(() => undefined);
  if (executionContext) executionContext.waitUntil(synchronization);
  else await synchronization;
  return new Response(null, { status: 202 });
}

async function repairCalendarCaches(
  env: CalendarGatewayEnv,
  providerFetch: ProviderFetch,
): Promise<void> {
  const now = new Date().toISOString();
  const renewBefore = new Date(Date.now() + WATCH_RENEWAL_WINDOW_MS).toISOString();
  const due = (await env.CALENDAR_DB.prepare(
    `SELECT calendar_sync_state.workspace_id, calendar_sync_state.calendar_id,
            calendar_connections.principal_id
       FROM calendar_sync_state
       INNER JOIN provider_calendars
         ON provider_calendars.id = calendar_sync_state.calendar_id
       INNER JOIN calendar_connections
         ON calendar_connections.id = calendar_sync_state.connection_id
      WHERE calendar_connections.provider = 'google'
        AND calendar_connections.mode = 'oauth'
        AND calendar_connections.principal_id IS NOT NULL
        AND provider_calendars.role <> 'free-busy'
        AND (calendar_sync_state.lease_until IS NULL OR calendar_sync_state.lease_until <= ?)
        AND (
          calendar_sync_state.last_success_at IS NULL
          OR calendar_sync_state.next_sync_at <= ?
          OR (calendar_sync_state.watch_expiration_at IS NOT NULL
              AND calendar_sync_state.watch_expiration_at <= ?)
        )
      ORDER BY calendar_sync_state.next_sync_at,
               COALESCE(calendar_sync_state.last_attempt_at, ''),
               calendar_sync_state.calendar_id
      LIMIT ?`,
  )
    .bind(now, now, renewBefore, CACHE_REPAIR_BATCH_SIZE)
    .all<{
      readonly workspace_id: string;
      readonly calendar_id: string;
      readonly principal_id: string;
    }>()).results;
  let succeeded = 0;
  const syncInvocation = cacheSyncInvocation();
  for (const item of due) {
    const target = (await loadCalendarSyncTargets(
      env,
      item.workspace_id,
      item.principal_id,
      [item.calendar_id],
    ))[0];
    if (!target) continue;
    const outcome = await syncGoogleCalendarCache(env, target, providerFetch, syncInvocation);
    if (outcome.synced) succeeded += 1;
  }
  logCalendarSync("info", "calendar cache repair completed", {
    selected: due.length,
    succeeded,
    batch_limit: CACHE_REPAIR_BATCH_SIZE,
  });
}

async function expireApprovalHolds(
  env: CalendarGatewayEnv,
  providerFetch: ProviderFetch,
): Promise<void> {
  const now = new Date().toISOString();
  const holds = (await env.CALENDAR_DB.prepare(
    `SELECT workspace_id, principal_id, idempotency_key, request_hash, destination_calendar_id,
            provider_event_id, booking_kind, start_at, end_at, state, response_json,
            resolution_status, conflict_calendar_ids_json, hold_expires_at, hold_expired_at
       FROM provider_booking_commits
      WHERE booking_kind = 'approval-hold'
        AND principal_id IS NOT NULL
        AND state = 'committed'
        AND resolution_status IS NULL
        AND hold_expired_at IS NULL
        AND hold_expires_at IS NOT NULL
        AND hold_expires_at <= ?
        AND NOT EXISTS (
          SELECT 1 FROM provider_booking_resolutions
           WHERE provider_booking_resolutions.workspace_id = provider_booking_commits.workspace_id
             AND provider_booking_resolutions.principal_id = provider_booking_commits.principal_id
             AND provider_booking_resolutions.booking_idempotency_key =
                 provider_booking_commits.idempotency_key
             AND provider_booking_resolutions.state = 'pending'
        )
      ORDER BY hold_expires_at, workspace_id, idempotency_key
      LIMIT ?`,
  )
    .bind(now, CACHE_REPAIR_BATCH_SIZE)
    .all<ExpiringApprovalHoldRow>()).results;
  const authorization = cacheSyncInvocation();
  let expired = 0;
  for (const hold of holds) {
    const target = (await loadCalendarSyncTargets(
      env,
      hold.workspace_id,
      hold.principal_id,
      [hold.destination_calendar_id],
    ))[0];
    if (!target || target.provider !== "google" || target.mode !== "oauth") continue;
    const leaseToken = crypto.randomUUID();
    if (!await acquireBookingCommitLock(
      env,
      hold.workspace_id,
      hold.principal_id,
      target.id,
      leaseToken,
    )) continue;
    try {
      const { secret } = await authorizedTokenForCacheSync(
        env,
        target,
        providerFetch,
        authorization,
      );
      const providerEvent = await getGoogleCommittedEvent(
        target,
        hold.provider_event_id,
        secret.accessToken,
        providerFetch,
      );
      if (providerEvent) {
        const extended = isRecord(providerEvent.extendedProperties)
          ? providerEvent.extendedProperties
          : {};
        const privateValues = isRecord(extended.private) ? extended.private : {};
        if (
          googleCommitHash(providerEvent) !== hold.request_hash ||
          privateValues.tapBookingKind !== "approval-hold" ||
          googleResolutionHash(providerEvent)
        ) {
          logCalendarSync("warn", "expired approval hold provider proof changed", {
            workspace_id: hold.workspace_id,
            calendar_id: target.id,
            booking_idempotency_key: hold.idempotency_key,
          });
          continue;
        }
        await deleteGoogleApprovalHold(
          target,
          hold.provider_event_id,
          secret.accessToken,
          providerFetch,
        );
      }
      const updated = await env.CALENDAR_DB.prepare(
        `UPDATE provider_booking_commits
            SET hold_expired_at = ?, updated_at = ?
          WHERE workspace_id = ? AND principal_id = ? AND idempotency_key = ?
            AND resolution_status IS NULL AND hold_expired_at IS NULL
            AND hold_expires_at <= ?`,
      )
        .bind(
          now,
          now,
          hold.workspace_id,
          hold.principal_id,
          hold.idempotency_key,
          now,
        )
        .run();
      if (Number(updated.meta.changes ?? 0) === 0) continue;
      expired += 1;
      try {
        await stageBookingCacheMutation(env, target, {
          providerEventId: hold.provider_event_id,
          eventId: googleEventId("event", target.id, hold.provider_event_id),
          start: null,
          end: null,
          tombstoned: true,
          payload: { id: hold.provider_event_id, status: "cancelled" },
          providerUpdatedAt: now,
        });
      } catch (error) {
        logCalendarSync("warn", "expired approval hold cache tombstone failed", {
          workspace_id: hold.workspace_id,
          calendar_id: target.id,
          booking_idempotency_key: hold.idempotency_key,
          error: error instanceof Error ? error.message : "unknown error",
        });
      }
    } catch (error) {
      logCalendarSync("warn", "approval hold expiration failed", {
        workspace_id: hold.workspace_id,
        calendar_id: target.id,
        booking_idempotency_key: hold.idempotency_key,
        error: error instanceof Error ? error.message : "unknown error",
      });
    } finally {
      try {
        await releaseBookingCommitLock(
          env,
          hold.workspace_id,
          hold.principal_id,
          target.id,
          leaseToken,
        );
      } catch {
        // The bounded lease expires even when cleanup cannot release it immediately.
      }
    }
  }
  logCalendarSync("info", "approval hold expiration completed", {
    selected: holds.length,
    expired,
    batch_limit: CACHE_REPAIR_BATCH_SIZE,
  });
}

interface PublicBookingNoticeRow extends Record<string, unknown> {
  readonly booking_reference: string;
  readonly workspace_id: string;
  readonly principal_id: string;
  readonly provider_operation_id: string;
  readonly booking_status: "confirmed" | "pending" | "declined" | "expired" | "cancelled";
  readonly approval_expires_at: string | null;
  readonly guest_name: string;
  readonly guest_email: string;
  readonly organizer_name: string;
  readonly event_title: string;
  readonly start_at: string;
  readonly end_at: string;
  readonly time_zone: string;
}

const publicBookingNoticeInput = (
  row: PublicBookingNoticeRow,
  kind: PublicBookingEmailEnqueueInput["kind"],
): PublicBookingEmailEnqueueInput => ({
  eventKey: `${kind}:${row.booking_reference}`,
  bookingReference: row.booking_reference,
  scope: {
    workspace: row.workspace_id,
    principal: row.principal_id,
  },
  kind,
  recipient: {
    name: row.guest_name,
    email: row.guest_email,
  },
  organizerName: row.organizer_name,
  eventTitle: row.event_title,
  startsAt: row.start_at,
  endsAt: row.end_at,
  timeZone: row.time_zone,
});

async function expirePublicBookingManagementApprovals(
  env: CalendarGatewayEnv,
): Promise<void> {
  const now = new Date().toISOString();
  const due = (await env.CALENDAR_DB.prepare(
    `SELECT booking_reference, workspace_id, principal_id, provider_operation_id,
            booking_status, approval_expires_at, guest_name, guest_email,
            organizer_name, event_title, start_at, end_at, time_zone
       FROM public_booking_management_credentials
      WHERE status = 'active' AND booking_status = 'pending'
        AND approval_expires_at IS NOT NULL AND approval_expires_at <= ?
      ORDER BY approval_expires_at, booking_reference
      LIMIT ?`,
  ).bind(now, CACHE_REPAIR_BATCH_SIZE).all<PublicBookingNoticeRow>()).results;
  const store = new D1PublicBookingManagementStore(env.CALENDAR_DB);
  const outbox = publicBookingEmailOutbox(env);
  let transitioned = 0;
  for (const row of due) {
    try {
      const result = await store.transitionApproval({
        scope: { workspace: row.workspace_id, principal: row.principal_id },
        providerOperationId: row.provider_operation_id,
        targetStatus: "expired",
      });
      if (result.kind !== "transitioned" && result.kind !== "existing") continue;
      await outbox.enqueue(result.notice);
      transitioned += result.kind === "transitioned" ? 1 : 0;
    } catch (error) {
      logCalendarSync("warn", "public approval lifecycle expiration failed", {
        workspace_id: row.workspace_id,
        booking_reference: row.booking_reference,
        error: error instanceof Error ? error.name : "unknown",
      });
    }
  }
  logCalendarSync("info", "public approval lifecycle expiration completed", {
    selected: due.length,
    transitioned,
    batch_limit: CACHE_REPAIR_BATCH_SIZE,
  });
}

async function reconcilePublicBookingEmailNotices(
  env: CalendarGatewayEnv,
): Promise<void> {
  const initial = (await env.CALENDAR_DB.prepare(
    `SELECT booking_reference, workspace_id, principal_id, provider_operation_id,
            booking_status, approval_expires_at, guest_name, guest_email,
            organizer_name, event_title, start_at, end_at, time_zone
       FROM public_booking_management_credentials AS credentials
      WHERE NOT EXISTS (
        SELECT 1 FROM public_booking_email_outbox AS notices
         WHERE notices.booking_reference = credentials.booking_reference
           AND notices.event_key =
             (CASE WHEN credentials.approval_expires_at IS NULL
               THEN 'booking-confirmed:' ELSE 'approval-requested:' END) ||
             credentials.booking_reference
      )
      ORDER BY credentials.created_at, credentials.booking_reference
      LIMIT ?`,
  ).bind(CACHE_REPAIR_BATCH_SIZE).all<PublicBookingNoticeRow>()).results;
  const terminal = (await env.CALENDAR_DB.prepare(
    `SELECT booking_reference, workspace_id, principal_id, provider_operation_id,
            booking_status, approval_expires_at, guest_name, guest_email,
            organizer_name, event_title, start_at, end_at, time_zone
       FROM public_booking_management_credentials AS credentials
      WHERE credentials.approval_expires_at IS NOT NULL
        AND credentials.booking_status IN ('confirmed', 'declined', 'expired')
        AND NOT EXISTS (
          SELECT 1 FROM public_booking_email_outbox AS notices
           WHERE notices.booking_reference = credentials.booking_reference
             AND notices.event_key =
               (CASE credentials.booking_status
                 WHEN 'confirmed' THEN 'approval-approved:'
                 WHEN 'declined' THEN 'approval-declined:'
                 ELSE 'approval-expired:' END) || credentials.booking_reference
        )
      ORDER BY credentials.updated_at, credentials.booking_reference
      LIMIT ?`,
  ).bind(CACHE_REPAIR_BATCH_SIZE).all<PublicBookingNoticeRow>()).results;
  const outbox = publicBookingEmailOutbox(env);
  for (const row of initial) {
    const kind = row.approval_expires_at === null
      ? "booking-confirmed"
      : "approval-requested";
    await outbox.enqueue(publicBookingNoticeInput(row, kind)).catch(() => undefined);
  }
  for (const row of terminal) {
    const kind = row.booking_status === "confirmed"
      ? "approval-approved"
      : row.booking_status === "declined"
        ? "approval-declined"
        : "approval-expired";
    await outbox.enqueue(publicBookingNoticeInput(row, kind)).catch(() => undefined);
  }
}

async function deliverPublicBookingEmails(env: CalendarGatewayEnv): Promise<void> {
  const sender = env.EMAIL;
  const fromEmail = env.PUBLIC_BOOKING_EMAIL_FROM?.trim() ?? "";
  const fromName = env.PUBLIC_BOOKING_EMAIL_FROM_NAME?.trim() ?? "";
  const managementSecret = env.PUBLIC_BOOKING_MANAGEMENT_SECRET?.trim() ?? "";
  if (!sender || !fromEmail || !fromName || !managementSecret) {
    logCalendarSync("warn", "public booking email delivery is not configured", {});
    return;
  }
  const summary = await deliverPublicBookingEmailOutboxSafely(
    publicBookingEmailOutbox(env),
    sender,
    {
      managementSecret,
      managementOrigin: publicBookingBaseUrl(env),
      from: { name: fromName, email: fromEmail },
      limit: CACHE_REPAIR_BATCH_SIZE,
    },
  );
  logCalendarSync("info", "public booking email delivery completed", {
    claimed: summary.claimed,
    delivered: summary.delivered,
    retried: summary.retried,
    dead_lettered: summary.deadLettered,
    infrastructure_failed: summary.infrastructureFailed,
  });
}

const MCP_PROTOCOL_VERSION = "2025-11-25";
const MCP_MAX_EVENTS = 200;
const MCP_MAX_CONFLICTS = 50;

const mcpTools = [
  {
    name: "list_events",
    description: "List events from TAP Calendar's durable cache for a bounded time range.",
    inputSchema: {
      type: "object",
      properties: {
        timeMin: { type: "string", format: "date-time" },
        timeMax: { type: "string", format: "date-time" },
        calendarIds: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 100 },
      },
      required: ["timeMin", "timeMax", "calendarIds"],
      additionalProperties: false,
    },
  },
  {
    name: "find_available_slots",
    description: "Find candidate free slots using the same revisioned TAP Calendar cache.",
    inputSchema: {
      type: "object",
      properties: {
        timeMin: { type: "string", format: "date-time" },
        timeMax: { type: "string", format: "date-time" },
        calendarIds: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 100 },
        durationMinutes: { type: "integer", minimum: 5, maximum: 480 },
      },
      required: ["timeMin", "timeMax", "calendarIds", "durationMinutes"],
      additionalProperties: false,
    },
  },
  {
    name: "draft_meeting",
    description: "Draft, but do not create, a meeting and report cached conflicts.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", minLength: 1, maxLength: 255 },
        start: { type: "string", format: "date-time" },
        end: { type: "string", format: "date-time" },
        calendarIds: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 100 },
        attendeeEmails: { type: "array", items: { type: "string" }, maxItems: 100 },
      },
      required: ["title", "start", "end", "calendarIds"],
      additionalProperties: false,
    },
  },
] as const;

const redactedMcpEvent = (event: GatewayCalendarEvent): GatewayCalendarEvent => ({
  ...event,
  title: event.busy ? "Busy" : "Available",
  attendees: [],
  location: null,
});

const mcpEventRequest = (
  request: Request,
  input: EventQueryInput,
  revalidate: "wait" | "background",
): Request => {
  const headers = new Headers(request.headers);
  headers.set("Content-Type", "application/json");
  headers.delete("Content-Length");
  return new Request(new URL("/v1/events/query", request.url), {
    method: "POST",
    headers,
    body: JSON.stringify({ ...input, revalidate }),
  });
};

async function mcpCachedQuery(
  request: Request,
  env: CalendarGatewayEnv,
  executionContext: ExecutionContext | undefined,
  providerFetch: ProviderFetch,
  input: EventQueryInput,
  revalidate: "wait" | "background",
): Promise<Readonly<Record<string, unknown>>> {
  const response = await queryEvents(
    mcpEventRequest(request, input, revalidate),
    env,
    executionContext,
    providerFetch,
  );
  const value: unknown = await response.json();
  if (!isRecord(value)) throw new ApiError(500, "cache_response_invalid", "Cache response invalid.");
  return value;
}

const mcpToolResult = (value: Readonly<Record<string, unknown>>) => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
  structuredContent: value,
});

const requireAuthoritativeMcpCache = (
  result: Readonly<Record<string, unknown>>,
  input: EventQueryInput,
): void => {
  const served = new Set(Array.isArray(result.servedCalendarIds)
    ? result.servedCalendarIds.filter((value): value is string => typeof value === "string")
    : []);
  const cache = isRecord(result.cache) ? result.cache : null;
  const proofs = new Map<string, Readonly<Record<string, unknown>>>();
  if (cache && Array.isArray(cache.calendars)) {
    for (const proof of cache.calendars) {
      if (isRecord(proof) && typeof proof.calendarId === "string") {
        proofs.set(proof.calendarId, proof);
      }
    }
  }
  const incomplete = result.truncated === true ||
    (Array.isArray(result.errors) && result.errors.length > 0) ||
    input.calendarIds.some(calendarId => {
      const proof = proofs.get(calendarId);
      return !served.has(calendarId) ||
        !proof ||
        proof.freshness !== "fresh" ||
        proof.coversRequestedRange !== true ||
        proof.error !== null;
    });
  if (incomplete) {
    throw new ApiError(
      503,
      "calendar_cache_not_authoritative",
      "Every requested calendar must have a complete fresh cache before proposing a time.",
    );
  }
};

async function callMcpTool(
  name: string,
  args: Readonly<Record<string, unknown>>,
  request: Request,
  env: CalendarGatewayEnv,
  executionContext: ExecutionContext | undefined,
  providerFetch: ProviderFetch,
): Promise<Readonly<Record<string, unknown>>> {
  if (name === "list_events") {
    const input = eventQueryInput(args);
    const result = await mcpCachedQuery(
      request,
      env,
      executionContext,
      providerFetch,
      input,
      "background",
    );
    const sourceEvents = Array.isArray(result.events) ? result.events : [];
    const events = sourceEvents
      .slice(0, MCP_MAX_EVENTS)
      .map(event => redactedMcpEvent(event as GatewayCalendarEvent));
    return {
      ...result,
      events,
      truncated: result.truncated === true || sourceEvents.length > MCP_MAX_EVENTS,
      detailsIncluded: false,
    };
  }
  if (name === "find_available_slots") {
    const input = eventQueryInput(args);
    if (
      typeof args.durationMinutes !== "number" ||
      !Number.isInteger(args.durationMinutes) ||
      args.durationMinutes < 5 ||
      args.durationMinutes > 480
    ) throw new ApiError(400, "invalid_duration", "durationMinutes must be 5 through 480.");
    const result = await mcpCachedQuery(
      request,
      env,
      executionContext,
      providerFetch,
      input,
      "wait",
    );
    requireAuthoritativeMcpCache(result, input);
    const busy = (Array.isArray(result.events) ? result.events : [])
      .filter((event): event is GatewayCalendarEvent => isRecord(event) && event.busy === true)
      .map(event => ({ start: Date.parse(event.start), end: Date.parse(event.end) }))
      .filter(interval => Number.isFinite(interval.start) && Number.isFinite(interval.end));
    const durationMs = args.durationMinutes * 60 * 1000;
    const stepMs = 15 * 60 * 1000;
    const slots: { readonly start: string; readonly end: string }[] = [];
    for (
      let start = Date.parse(input.timeMin);
      start + durationMs <= Date.parse(input.timeMax) && slots.length < 50;
      start += stepMs
    ) {
      const end = start + durationMs;
      if (!busy.some(interval => interval.start < end && interval.end > start)) {
        slots.push({ start: new Date(start).toISOString(), end: new Date(end).toISOString() });
      }
    }
    return {
      timeMin: input.timeMin,
      timeMax: input.timeMax,
      durationMinutes: args.durationMinutes,
      slots,
      cache: result.cache,
      source: result.source,
      truncated: result.truncated,
    };
  }
  if (name === "draft_meeting") {
    const title = requiredText(args.title, "title");
    const input = eventQueryInput({
      timeMin: args.start,
      timeMax: args.end,
      calendarIds: args.calendarIds,
    });
    if (!Array.isArray(args.attendeeEmails ?? [])) {
      throw new ApiError(400, "invalid_attendees", "attendeeEmails must be an array.");
    }
    const attendeeEmails = (args.attendeeEmails ?? []) as readonly unknown[];
    if (attendeeEmails.length > 100) {
      throw new ApiError(400, "invalid_attendees", "Choose at most 100 attendees.");
    }
    const normalizedAttendees = attendeeEmails.map((value, index) => {
      const email = requiredText(value, `attendeeEmails[${index}]`, 320).toLowerCase();
      if (!email.includes("@")) {
        throw new ApiError(400, "invalid_attendees", `attendeeEmails[${index}] is invalid.`);
      }
      return email;
    });
    const result = await mcpCachedQuery(
      request,
      env,
      executionContext,
      providerFetch,
      input,
      "wait",
    );
    requireAuthoritativeMcpCache(result, input);
    const allConflicts = (Array.isArray(result.events) ? result.events : [])
      .filter((event): event is GatewayCalendarEvent => isRecord(event) && event.busy === true)
      .map(redactedMcpEvent);
    const conflicts = allConflicts.slice(0, MCP_MAX_CONFLICTS);
    return {
      draft: {
        id: `draft-${crypto.randomUUID()}`,
        title,
        start: input.timeMin,
        end: input.timeMax,
        calendarIds: input.calendarIds,
        attendeeEmails: normalizedAttendees,
        persisted: false,
      },
      conflicts,
      conflictsTruncated: allConflicts.length > MCP_MAX_CONFLICTS,
      cache: result.cache,
      source: result.source,
    };
  }
  throw new ApiError(404, "mcp_tool_not_found", "The requested MCP tool does not exist.");
}

async function handleMcp(
  request: Request,
  env: CalendarGatewayEnv,
  executionContext: ExecutionContext | undefined,
  providerFetch: ProviderFetch,
): Promise<Response> {
  // Until TAP session verification is wired, MCP is deliberately local-only. Workspace and
  // principal headers are accepted only behind that local runtime boundary.
  await principalScope(request, env);
  const body = await readJson(request);
  const id = body.id ?? null;
  const method = requiredText(body.method, "method", 128);
  const success = (result: unknown): Response => json({ jsonrpc: "2.0", id, result });
  try {
    if (method === "initialize") {
      return success({
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "tap-calendar-gateway", version: "0.1.0" },
      });
    }
    if (method === "notifications/initialized") return new Response(null, { status: 202 });
    if (method === "tools/list") return success({ tools: mcpTools });
    if (method === "tools/call") {
      if (!isRecord(body.params)) {
        throw new ApiError(400, "invalid_mcp_params", "tools/call params are required.");
      }
      const name = requiredText(body.params.name, "tool name", 128);
      const args = body.params.arguments === undefined
        ? {}
        : isRecord(body.params.arguments)
          ? body.params.arguments
          : (() => {
            throw new ApiError(400, "invalid_mcp_params", "Tool arguments must be an object.");
          })();
      return success(mcpToolResult(await callMcpTool(
        name,
        args,
        request,
        env,
        executionContext,
        providerFetch,
      )));
    }
    return json({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: "Method not found" },
    });
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    return json({
      jsonrpc: "2.0",
      id,
      error: { code: error.status === 404 ? -32601 : -32602, message: error.message },
    });
  }
}

async function route(
  request: Request,
  env: CalendarGatewayEnv,
  executionContext: ExecutionContext | undefined,
  providerFetch: ProviderFetch = fetch,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/u, "") || "/";
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  }
  if (request.method === "GET" && path === "/health") {
    return json({
      ok: true,
      service: "tap-calendar-gateway",
      runtime: "cloudflare-workers",
      localDevelopment: env.LOCAL_DEVELOPMENT === "true",
    });
  }
  if (request.method === "GET" && path === "/api/public/manage") {
    return getPublicBookingManagement(request, url, env, providerFetch);
  }
  if (request.method === "POST" && path === "/api/public/manage/cancel") {
    return cancelManagedPublicBooking(request, url, env, providerFetch);
  }
  if (request.method === "POST" && path === "/api/public/manage/reschedule") {
    return rescheduleManagedPublicBooking(request, url, env, providerFetch);
  }
  if (path.startsWith("/api/public/manage")) {
    throw publicBookingManagementUnavailable();
  }
  const publicBookingRoute = parsePublicBookingPagePath(path);
  if (request.method === "GET" && publicBookingRoute?.resource === "page") {
    if (url.search) {
      throw new ApiError(
        400,
        "invalid_public_request",
        "This public booking request is invalid.",
      );
    }
    return getPublishedPublicBookingPage(publicBookingRoute, env);
  }
  if (request.method === "GET" && publicBookingRoute?.resource === "availability") {
    return getPublishedPublicBookingAvailability(
      request,
      publicBookingRoute,
      url,
      env,
      providerFetch,
    );
  }
  if (request.method === "POST" && publicBookingRoute?.resource === "bookings") {
    if (url.search) {
      throw new ApiError(
        400,
        "invalid_public_request",
        "This public booking request is invalid.",
      );
    }
    return createPublishedPublicBooking(request, publicBookingRoute, env, providerFetch);
  }
  if (path.startsWith("/api/public/pages/")) {
    throw new ApiError(
      404,
      "public_page_unavailable",
      "This booking page is unavailable.",
    );
  }
  if (request.method === "GET" && path === "/v1/providers") {
    return json(providerCatalog(env));
  }
  if (request.method === "POST" && path === "/v1/publications/profiles") {
    return publishBookingProfile(request, env);
  }
  if (request.method === "POST" && path === "/v1/publications/profiles/unpublish") {
    return unpublishBookingProfile(request, env);
  }
  if (request.method === "POST" && path === "/v1/webhooks/google/calendar") {
    return handleGoogleCalendarWebhook(request, env, executionContext, providerFetch);
  }
  if (request.method === "POST" && path === "/mcp") {
    return handleMcp(request, env, executionContext, providerFetch);
  }
  const callbackMatch = path.match(/^\/v1\/oauth\/(google|microsoft)\/callback$/u);
  if (request.method === "GET" && callbackMatch) {
    return completeOAuth(
      request,
      env,
      callbackMatch[1] as "google" | "microsoft",
      providerFetch,
    );
  }
  if (request.method === "GET" && path === "/v1/connections") {
    return listConnections(request, env);
  }
  if (request.method === "POST" && path === "/v1/connections/local") {
    return createLocalConnection(request, env);
  }
  if (request.method === "POST" && path === "/v1/events/query") {
    return queryEvents(request, env, executionContext, providerFetch);
  }
  if (request.method === "POST" && path === "/v1/availability/validate") {
    return validateLiveAvailability(request, env, providerFetch);
  }
  if (request.method === "POST" && path === "/v1/bookings/commit") {
    return commitGoogleBooking(request, env, providerFetch);
  }
  const bookingStatusMatch = path.match(/^\/v1\/bookings\/([^/]+)\/status$/u);
  if (request.method === "GET" && bookingStatusMatch?.[1]) {
    return getGoogleBookingStatus(
      request,
      env,
      identifier(decodeURIComponent(bookingStatusMatch[1]), "booking idempotency key"),
      providerFetch,
    );
  }
  const bookingResolutionMatch = path.match(/^\/v1\/bookings\/([^/]+)\/resolve$/u);
  if (request.method === "POST" && bookingResolutionMatch?.[1]) {
    return resolveGoogleApprovalHold(
      request,
      env,
      identifier(decodeURIComponent(bookingResolutionMatch[1]), "booking idempotency key"),
      providerFetch,
    );
  }
  if (request.method === "POST" && path === "/v1/availability/confirm") {
    return confirmLiveAvailability(request, env, providerFetch);
  }
  const oauthStartMatch = path.match(/^\/v1\/oauth\/(google|microsoft)\/start$/u);
  if (request.method === "POST" && oauthStartMatch) {
    return beginOAuth(request, env, oauthStartMatch[1] as "google" | "microsoft");
  }
  const addCalendarsMatch = path.match(/^\/v1\/connections\/([^/]+)\/calendars\/local$/u);
  if (request.method === "POST" && addCalendarsMatch?.[1]) {
    return addLocalCalendars(request, env, decodeURIComponent(addCalendarsMatch[1]));
  }
  const removeCalendarsMatch = path.match(
    /^\/v1\/connections\/([^/]+)\/calendars\/local\/remove$/u,
  );
  if (request.method === "POST" && removeCalendarsMatch?.[1]) {
    return removeLocalCalendars(
      request,
      env,
      decodeURIComponent(removeCalendarsMatch[1]),
    );
  }
  const removeManagedCalendarsMatch = path.match(
    /^\/v1\/connections\/([^/]+)\/calendars\/remove$/u,
  );
  if (request.method === "POST" && removeManagedCalendarsMatch?.[1]) {
    return removeCalendars(
      request,
      env,
      identifier(decodeURIComponent(removeManagedCalendarsMatch[1]), "connectionId"),
    );
  }
  const syncMatch = path.match(/^\/v1\/connections\/([^/]+)\/sync$/u);
  if (request.method === "POST" && syncMatch?.[1]) {
    return syncConnection(request, env, decodeURIComponent(syncMatch[1]), providerFetch);
  }
  const connectionMatch = path.match(/^\/v1\/connections\/([^/]+)$/u);
  if (connectionMatch?.[1]) {
    const connectionId = identifier(decodeURIComponent(connectionMatch[1]), "connectionId");
    if (request.method === "GET") {
      const { workspace, principal } = await principalScope(request, env);
      const connection = await connectionById(
        env,
        workspace,
        principal,
        connectionId,
      );
      return json({ connection: connectionProjection(connection.row, connection.calendars) });
    }
    if (request.method === "DELETE") {
      return deleteConnection(request, env, connectionId);
    }
  }
  throw new ApiError(404, "not_found", "The Calendar gateway route was not found.");
}

export function createCalendarGatewayWorker(providerFetch: ProviderFetch = fetch) {
  return {
    async fetch(
      request: Request,
      env: CalendarGatewayEnv,
      executionContext?: ExecutionContext,
    ): Promise<Response> {
      let headers: HeadersInit = {};
      try {
        headers = corsHeaders(request, env);
        const response = await route(request, env, executionContext, providerFetch);
        const merged = new Headers(response.headers);
        for (const [name, value] of new Headers(headers)) merged.set(name, value);
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: merged,
        });
      } catch (error) {
        const apiError = error instanceof ApiError
          ? error
          : new ApiError(500, "internal_error", "The Calendar gateway could not complete the request.");
        if (!(error instanceof ApiError)) console.error(error);
        return json(
          { error: apiError.code, message: apiError.message, ...apiError.details },
          apiError.status,
          headers,
        );
      }
    },
    scheduled(
      _controller: ScheduledController,
      env: CalendarGatewayEnv,
      executionContext: ExecutionContext,
    ): void {
      const jobs: readonly [name: string, operation: Promise<void>][] = [
        ["approval hold expiration", expireApprovalHolds(env, providerFetch)],
        ["public approval lifecycle expiration", expirePublicBookingManagementApprovals(env)],
        ["public booking email reconciliation", reconcilePublicBookingEmailNotices(env)],
        ["public booking email delivery", deliverPublicBookingEmails(env)],
        ["calendar cache repair", repairCalendarCaches(env, providerFetch)],
      ];
      for (const [name, operation] of jobs) {
        executionContext.waitUntil(operation.catch(error => {
          logCalendarSync("error", `${name} failed`, {
            error: error instanceof Error ? error.name : "unknown",
          });
        }));
      }
    },
  } satisfies ExportedHandler<CalendarGatewayEnv>;
}

export default createCalendarGatewayWorker();
