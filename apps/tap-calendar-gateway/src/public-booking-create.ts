import {
  publicSlotSatisfiesPublishedSchedule,
  type PublicSlotTokenClaims,
  type ResolvedPublishedPublicBookingPage,
} from "./public-booking-read";

const PUBLIC_BOOKING_SCHEMA_VERSION = "tap.calendar.public-booking.v1" as const;
const TURNSTILE_MAX_AGE_MS = 5 * 60 * 1_000;
const TURNSTILE_FUTURE_SKEW_MS = 60 * 1_000;
const MILLISECONDS_PER_MINUTE = 60_000;
const PUBLIC_APPROVAL_HOLD_TTL_MS = 24 * 60 * MILLISECONDS_PER_MINUTE;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MANAGEMENT_TOKEN_PATTERN = /^tapm_v1_[A-Za-z0-9_-]{16,512}$/u;
const BOOKING_REFERENCE_PATTERN = /^[A-Za-z0-9_-]{12,255}$/u;

export interface ParsedPublicBookingRequest {
  readonly schemaVersion: typeof PUBLIC_BOOKING_SCHEMA_VERSION;
  readonly requestId: string;
  readonly slotToken: string;
  readonly guest: PublicBookingGuestInput;
  readonly turnstileToken: string;
}

export interface VerifiedPublicSlotProof {
  /** The signed token whose signature has already been verified by the gateway. */
  readonly token: string;
  readonly claims: PublicSlotTokenClaims;
}

/**
 * A normalized result returned only after the gateway called Turnstile Siteverify.
 * The caller is responsible for using one stable Siteverify idempotency_key while
 * retrying the same verification network request.
 */
export interface VerifiedTurnstileResult {
  readonly success: boolean;
  readonly action: string | null;
  readonly hostname: string | null;
  readonly challengeTimestamp: string | null;
}

export interface PublicBookingGuestInput {
  readonly name: string;
  readonly email: string;
}

export interface PublicBookingCreateInput {
  readonly requestId: string;
  readonly guest: PublicBookingGuestInput;
  readonly slotProof: VerifiedPublicSlotProof;
  readonly turnstile: VerifiedTurnstileResult;
}

export interface PublicBookingResult {
  readonly schemaVersion: typeof PUBLIC_BOOKING_SCHEMA_VERSION;
  readonly status: "confirmed" | "pending";
  readonly bookingReference: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly managementUrl: string;
}

export interface PublicBookingCoordinationScope {
  readonly workspace: string;
  readonly principal: string;
}

/**
 * Production must implement this with a server-owned boundary that excludes
 * concurrent operations for the complete callback, including external I/O.
 * A Durable Object per returned coordination key is the intended adapter.
 */
export interface PublicBookingSerializationBoundary {
  runExclusive<T>(coordinationKey: string, operation: () => Promise<T>): Promise<T>;
}

export interface PublicBookingAttempt {
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly providerOperationId: string;
  readonly bookingReference: string;
  /** Normalized guest data durably captured by the first successful claim. */
  readonly guest: PublicBookingGuestInput;
  /** Stable across retries; null for bookings that do not require approval. */
  readonly approvalExpiresAt: string | null;
  readonly state: "pending" | "uncertain" | "committed" | "rejected";
  readonly response: PublicBookingResult | null;
  readonly rejectionCode: "slot_conflict" | null;
}

export interface PublicBookingAttemptClaim {
  readonly scope: PublicBookingCoordinationScope;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly slotProofFingerprint: string;
  readonly providerOperationId: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly revisionId: string;
  /** The adapter must persist this normalized value atomically with the claim. */
  readonly guest: PublicBookingGuestInput;
  /** The proposed first-claim expiry; an existing attempt returns its stored value. */
  readonly approvalExpiresAt: string | null;
}

export type PublicBookingAttemptClaimResult =
  | { readonly kind: "claimed"; readonly attempt: PublicBookingAttempt }
  | { readonly kind: "existing"; readonly attempt: PublicBookingAttempt }
  | { readonly kind: "idempotency-conflict" }
  | { readonly kind: "slot-proof-replayed" };

/**
 * claim() must atomically enforce both uniqueness constraints:
 *
 * - (owner scope, idempotency key) maps to exactly one request hash.
 * - a slot-proof fingerprint may only be assigned to that one idempotency key.
 *
 * Reusing the same idempotency key and hash with a fresh proof is allowed and
 * attaches that proof to the existing attempt. This is needed after an
 * ambiguous provider response outlives the original short-lived proof.
 */
export interface PublicBookingAttemptStore {
  /** The claimed bookingReference must be cryptographically unguessable in production. */
  claim(input: PublicBookingAttemptClaim): Promise<PublicBookingAttemptClaimResult>;
  markUncertain(input: {
    readonly scope: PublicBookingCoordinationScope;
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly errorCode: string;
  }): Promise<void>;
  markRejected(input: {
    readonly scope: PublicBookingCoordinationScope;
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly rejectionCode: "slot_conflict";
  }): Promise<void>;
  markCommitted(input: {
    readonly scope: PublicBookingCoordinationScope;
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly response: PublicBookingResult;
  }): Promise<void>;
}

export interface PublicBookingPublicationReader {
  /** Must read the primary/authoritative publication state, never a cache. */
  currentPage(pageId: string): Promise<ResolvedPublishedPublicBookingPage | null>;
}

export interface AuthoritativePublicAvailabilityCheck {
  readonly revisionId: string;
  readonly eventStart: string;
  readonly eventEnd: string;
  readonly conflictStart: string;
  readonly conflictEnd: string;
  readonly checkedCalendarIds: readonly string[];
  readonly status: "available" | "conflict" | "uncertain";
}

export interface PublicBookingAvailabilityAuthority {
  /**
   * Must validate the exact slot against the immutable schedule and query every
   * supplied conflict calendar live. Cached or partial provider data is not an
   * authoritative "available" response.
   */
  revalidate(input: {
    readonly page: ResolvedPublishedPublicBookingPage;
    readonly eventStart: string;
    readonly eventEnd: string;
    readonly conflictStart: string;
    readonly conflictEnd: string;
    readonly conflictCalendarIds: readonly string[];
  }): Promise<AuthoritativePublicAvailabilityCheck>;
}

export interface PublicProviderBookingReceipt {
  readonly operationId: string;
  readonly commitProof: string;
  readonly providerBookingId: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly status: "confirmed" | "tentative";
}

export type PublicProviderBookingRecovery =
  | { readonly status: "absent" }
  | { readonly status: "uncertain" }
  | { readonly status: "committed"; readonly receipt: PublicProviderBookingReceipt };

export type PublicProviderBookingCommit =
  | { readonly status: "committed"; readonly receipt: PublicProviderBookingReceipt }
  | { readonly status: "conflict"; readonly reason: "slot-conflict" | "operation-collision" }
  | { readonly status: "uncertain" };

export interface PublicBookingProvider {
  /**
   * The production adapter must call a scope-first internal provider service.
   * It must never synthesize anonymous X-TAP-* headers or loop back through the
   * organizer HTTP route to obtain owner authority.
   */
  /** A conclusive lookup by the deterministic operation ID. */
  recover(input: {
    readonly scope: PublicBookingCoordinationScope;
    readonly destinationCalendarId: string;
    readonly operationId: string;
    readonly commitProof: string;
    readonly startsAt: string;
    readonly endsAt: string;
  }): Promise<PublicProviderBookingRecovery>;
  commit(input: {
    readonly scope: PublicBookingCoordinationScope;
    readonly destinationCalendarId: string;
    readonly operationId: string;
    readonly commitProof: string;
    /** These are the unbuffered event times written to the provider. */
    readonly startsAt: string;
    readonly endsAt: string;
    /** Every canonical conflict calendar, including the destination calendar. */
    readonly conflictCalendarIds: readonly string[];
    /** The buffer-expanded interval that must be rechecked inside provider locks. */
    readonly conflictStart: string;
    readonly conflictEnd: string;
    readonly title: string;
    readonly description: string;
    readonly location: string;
    readonly guest: PublicBookingGuestInput;
    readonly bookingKind: "meeting" | "approval-hold";
    readonly conferenceProvider: "none" | "google-meet" | "zoom";
    /** Required and stable for approval holds; null for ordinary meetings. */
    readonly expiresAt: string | null;
  }): Promise<PublicProviderBookingCommit>;
}

export interface PublicBookingManagementTokenIssuer {
  /** Must be idempotent for one booking reference and persist only a token hash. */
  issue(input: {
    readonly scope: PublicBookingCoordinationScope;
    readonly bookingReference: string;
    readonly pageId: string;
    readonly revisionId: string;
    readonly destinationCalendarId: string;
    readonly providerBookingId: string;
    readonly providerOperationId: string;
    readonly startsAt: string;
    readonly endsAt: string;
    /** Persisted with the management credential for notices and guest recovery. */
    readonly guest: PublicBookingGuestInput;
    readonly approvalExpiresAt: string | null;
    /** Immutable guest-safe details used when the publication is later removed. */
    readonly organizerName: string;
    readonly eventTitle: string;
    readonly location: "google-meet" | "zoom" | "phone" | "in-person" | "custom";
    readonly locationLabel: string;
    readonly timeZone: string;
  }): Promise<{ readonly token: string }>;
}

export interface PublicBookingCreateDependencies {
  readonly serialization: PublicBookingSerializationBoundary;
  readonly publications: PublicBookingPublicationReader;
  readonly attempts: PublicBookingAttemptStore;
  readonly availability: PublicBookingAvailabilityAuthority;
  readonly provider: PublicBookingProvider;
  readonly managementTokens: PublicBookingManagementTokenIssuer;
  readonly now: () => number;
  readonly expectedTurnstileAction: string;
  readonly allowedTurnstileHostnames: readonly string[];
  readonly managementOrigin: string;
}

export class PublicBookingCreateError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;

  constructor(status: number, code: string, message: string, retryable = false) {
    super(message);
    this.name = "PublicBookingCreateError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const exactKeys = (value: Readonly<Record<string, unknown>>, expected: readonly string[]): boolean => {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
};

/** Strict parser for the anonymous POST body. It never accepts owner scope. */
export function parsePublicBookingRequest(value: unknown): ParsedPublicBookingRequest {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["schemaVersion", "requestId", "slotToken", "guest", "turnstileToken"]) ||
    value.schemaVersion !== PUBLIC_BOOKING_SCHEMA_VERSION ||
    typeof value.requestId !== "string" ||
    !UUID_PATTERN.test(value.requestId) ||
    typeof value.slotToken !== "string" ||
    value.slotToken.length < 16 || value.slotToken.length > 4_096 ||
    typeof value.turnstileToken !== "string" ||
    value.turnstileToken.length === 0 || value.turnstileToken.length > 2_048 ||
    !isRecord(value.guest) ||
    !exactKeys(value.guest, ["name", "email"]) ||
    typeof value.guest.name !== "string" ||
    typeof value.guest.email !== "string"
  ) {
    throw new PublicBookingCreateError(
      400,
      "invalid_booking_request",
      "The booking request is invalid.",
    );
  }
  return {
    schemaVersion: PUBLIC_BOOKING_SCHEMA_VERSION,
    requestId: value.requestId,
    slotToken: value.slotToken,
    guest: normalizedGuest({ name: value.guest.name, email: value.guest.email }),
    turnstileToken: value.turnstileToken,
  };
}

const canonicalInstant = (value: string, field: string): string => {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new PublicBookingCreateError(400, "slot_token_invalid", `${field} is invalid.`);
  }
  const canonical = new Date(parsed).toISOString();
  if (canonical !== value) {
    throw new PublicBookingCreateError(400, "slot_token_invalid", `${field} is invalid.`);
  }
  return canonical;
};

const sha256 = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
};

const base32Hex = (bytes: Uint8Array): string => {
  const alphabet = "0123456789abcdefghijklmnopqrstuv";
  let accumulator = 0;
  let bits = 0;
  let output = "";
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += alphabet[(accumulator >>> bits) & 31];
      accumulator &= (1 << bits) - 1;
    }
  }
  if (bits > 0) output += alphabet[(accumulator << (5 - bits)) & 31];
  return output;
};

const digestBytes = async (value: string): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));

/** One globally unique Durable Object per public-booking owner, not one global singleton. */
export async function publicBookingCoordinationKey(
  scope: PublicBookingCoordinationScope,
): Promise<string> {
  return `tap-public-booking-v1-${base32Hex(await digestBytes(
    `${scope.workspace}\u0000${scope.principal}`,
  ))}`;
}

/** Stable across retries, and valid as a Google Calendar client-supplied event ID. */
export async function publicBookingProviderOperationId(
  scope: PublicBookingCoordinationScope,
  destinationCalendarId: string,
  idempotencyKey: string,
): Promise<string> {
  // This is intentionally the same derivation used by the organizer booking
  // path so both routes can share the existing provider commit service.
  return `tap${base32Hex(await digestBytes(
    `${scope.workspace}\u0000${scope.principal}\u0000${destinationCalendarId}\u0000${idempotencyKey}`,
  ))}`;
}

const normalizedGuest = (value: PublicBookingGuestInput): PublicBookingGuestInput => {
  const name = value.name.trim();
  const email = value.email.trim().toLowerCase();
  if (name.length === 0 || name.length > 160) {
    throw new PublicBookingCreateError(400, "invalid_booking_request", "Enter your name.");
  }
  if (
    email.length < 3 || email.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)
  ) {
    throw new PublicBookingCreateError(400, "invalid_booking_request", "Enter a valid email address.");
  }
  return { name, email };
};

/**
 * Canonical business-request hash. Short-lived proof and Turnstile tokens are
 * deliberately excluded so the same request ID can safely recover with fresh
 * security tokens after an ambiguous network result.
 */
export async function publicBookingRequestHash(input: {
  readonly page: ResolvedPublishedPublicBookingPage;
  readonly slotClaims: PublicSlotTokenClaims;
  readonly guest: PublicBookingGuestInput;
}): Promise<string> {
  const guest = normalizedGuest(input.guest);
  const conflictCalendarIds = [...new Set(input.page.privateSnapshot.conflictCalendarIds)].sort();
  return sha256(JSON.stringify({
    v: 1,
    pageId: input.page.pageId,
    revisionId: input.slotClaims.revisionId,
    startsAt: canonicalInstant(input.slotClaims.start, "The selected start time"),
    endsAt: canonicalInstant(input.slotClaims.end, "The selected end time"),
    guest,
    destinationCalendarId: input.page.privateSnapshot.destinationCalendarId,
    conflictCalendarIds,
    approvalRequired: input.page.publicSnapshot.approvalRequired,
  }));
}

const validateTurnstile = (
  result: VerifiedTurnstileResult,
  dependencies: PublicBookingCreateDependencies,
  now: number,
): void => {
  const allowedHostnames = new Set(
    dependencies.allowedTurnstileHostnames.map(hostname => hostname.trim().toLowerCase()).filter(Boolean),
  );
  const challengeAt = result.challengeTimestamp ? Date.parse(result.challengeTimestamp) : Number.NaN;
  if (
    !result.success ||
    result.action !== dependencies.expectedTurnstileAction ||
    !result.hostname ||
    !allowedHostnames.has(result.hostname.toLowerCase()) ||
    !Number.isFinite(challengeAt) ||
    challengeAt > now + TURNSTILE_FUTURE_SKEW_MS ||
    challengeAt <= now - TURNSTILE_MAX_AGE_MS
  ) {
    throw new PublicBookingCreateError(
      403,
      "turnstile_verification_failed",
      "Security verification expired or could not be confirmed. Try again.",
    );
  }
};

const sameStrings = (left: readonly string[], right: readonly string[]): boolean => {
  const leftSorted = [...new Set(left)].sort();
  const rightSorted = [...new Set(right)].sort();
  return leftSorted.length === rightSorted.length &&
    leftSorted.every((value, index) => value === rightSorted[index]);
};

const currentRevisionMatches = (
  initiallyResolved: ResolvedPublishedPublicBookingPage,
  current: ResolvedPublishedPublicBookingPage | null,
): current is ResolvedPublishedPublicBookingPage => {
  if (!current) return false;
  return current.pageId === initiallyResolved.pageId &&
    current.profileId === initiallyResolved.profileId &&
    current.revisionId === initiallyResolved.revisionId &&
    current.privateSnapshot.workspaceId === initiallyResolved.privateSnapshot.workspaceId &&
    current.privateSnapshot.principalId === initiallyResolved.privateSnapshot.principalId;
};

const isCanonicalInstant = (value: string): boolean => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
};

const validAttempt = (
  attempt: PublicBookingAttempt,
  claim: PublicBookingAttemptClaim,
  claimKind: "claimed" | "existing",
  approvalRequired: boolean,
): boolean => {
  const validApprovalExpiry = approvalRequired
    ? typeof attempt.approvalExpiresAt === "string" &&
      isCanonicalInstant(attempt.approvalExpiresAt) &&
      (claimKind === "existing" || attempt.approvalExpiresAt === claim.approvalExpiresAt)
    : attempt.approvalExpiresAt === null && claim.approvalExpiresAt === null;
  return attempt.idempotencyKey === claim.idempotencyKey &&
    attempt.requestHash === claim.requestHash &&
    attempt.providerOperationId === claim.providerOperationId &&
    attempt.guest.name === claim.guest.name &&
    attempt.guest.email === claim.guest.email &&
    validApprovalExpiry &&
    BOOKING_REFERENCE_PATTERN.test(attempt.bookingReference);
};

const validateStoredResponse = (
  response: PublicBookingResult | null,
  attempt: PublicBookingAttempt,
  startsAt: string,
  endsAt: string,
  expectedManagementOrigin: string,
): PublicBookingResult => {
  let safeManagementUrl = false;
  if (response) {
    try {
      const base = managementBase(expectedManagementOrigin);
      const url = new URL(response.managementUrl);
      safeManagementUrl = url.origin === base.origin &&
        url.pathname === "/manage" && !url.search &&
        /^#tapm_v1_[A-Za-z0-9_-]{16,512}$/u.test(url.hash) &&
        !url.username && !url.password;
    } catch {
      safeManagementUrl = false;
    }
  }
  if (
    !response ||
    response.schemaVersion !== PUBLIC_BOOKING_SCHEMA_VERSION ||
    response.bookingReference !== attempt.bookingReference ||
    response.startsAt !== startsAt ||
    response.endsAt !== endsAt ||
    (response.status !== "confirmed" && response.status !== "pending") ||
    !safeManagementUrl
  ) {
    throw new PublicBookingCreateError(
      503,
      "booking_state_uncertain",
      "This booking could not be confirmed. Retry with the same request.",
      true,
    );
  }
  return response;
};

const assertReceipt = (
  receipt: PublicProviderBookingReceipt,
  attempt: PublicBookingAttempt,
  startsAt: string,
  endsAt: string,
  approvalRequired: boolean,
): void => {
  if (
    receipt.operationId !== attempt.providerOperationId ||
    receipt.commitProof !== attempt.requestHash ||
    receipt.startsAt !== startsAt ||
    receipt.endsAt !== endsAt ||
    receipt.providerBookingId.length === 0 ||
    receipt.providerBookingId.length > 2_048 ||
    receipt.status !== (approvalRequired ? "tentative" : "confirmed")
  ) {
    throw new PublicBookingCreateError(
      503,
      "provider_commit_uncertain",
      "The calendar provider did not conclusively confirm this booking. Retry with the same request.",
      true,
    );
  }
};

const managementBase = (value: string): URL => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PublicBookingCreateError(503, "public_booking_unconfigured", "Public booking is not configured.");
  }
  if (
    url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new PublicBookingCreateError(503, "public_booking_unconfigured", "Public booking is not configured.");
  }
  return url;
};

const slotConflict = (): PublicBookingCreateError => new PublicBookingCreateError(
  409,
  "slot_conflict",
  "That time is no longer available.",
);

const uncertainProvider = (): PublicBookingCreateError => new PublicBookingCreateError(
  503,
  "provider_commit_uncertain",
  "The calendar provider did not conclusively confirm this booking. Retry with the same request.",
  true,
);

async function rememberUncertain(
  dependencies: PublicBookingCreateDependencies,
  scope: PublicBookingCoordinationScope,
  attempt: PublicBookingAttempt,
  errorCode: string,
): Promise<never> {
  try {
    await dependencies.attempts.markUncertain({
      scope,
      idempotencyKey: attempt.idempotencyKey,
      requestHash: attempt.requestHash,
      errorCode,
    });
  } catch {
    // The provider outcome already is ambiguous. Never replace it with an
    // apparently definitive error if recording the diagnostic also failed.
  }
  throw uncertainProvider();
}

async function finalizeReceipt(
  dependencies: PublicBookingCreateDependencies,
  scope: PublicBookingCoordinationScope,
  page: ResolvedPublishedPublicBookingPage,
  attempt: PublicBookingAttempt,
  receipt: PublicProviderBookingReceipt,
  startsAt: string,
  endsAt: string,
): Promise<PublicBookingResult> {
  try {
    assertReceipt(receipt, attempt, startsAt, endsAt, page.publicSnapshot.approvalRequired);
    const credential = await dependencies.managementTokens.issue({
      scope,
      bookingReference: attempt.bookingReference,
      pageId: page.pageId,
      revisionId: page.revisionId,
      destinationCalendarId: page.privateSnapshot.destinationCalendarId,
      providerBookingId: receipt.providerBookingId,
      providerOperationId: attempt.providerOperationId,
      startsAt,
      endsAt,
      guest: attempt.guest,
      approvalExpiresAt: attempt.approvalExpiresAt,
      organizerName: page.publicSnapshot.displayName,
      eventTitle: page.publicSnapshot.title,
      location: page.publicSnapshot.location,
      locationLabel: page.publicSnapshot.locationLabel,
      timeZone: page.privateSnapshot.schedule.timeZone,
    });
    if (!MANAGEMENT_TOKEN_PATTERN.test(credential.token)) {
      throw new Error("The management token issuer returned an invalid token.");
    }
    const managementUrl = new URL(
      `/manage#${credential.token}`,
      managementBase(dependencies.managementOrigin),
    ).toString();
    const response: PublicBookingResult = {
      schemaVersion: PUBLIC_BOOKING_SCHEMA_VERSION,
      status: page.publicSnapshot.approvalRequired ? "pending" : "confirmed",
      bookingReference: attempt.bookingReference,
      startsAt,
      endsAt,
      managementUrl,
    };
    await dependencies.attempts.markCommitted({
      scope,
      idempotencyKey: attempt.idempotencyKey,
      requestHash: attempt.requestHash,
      response,
    });
    return response;
  } catch (error) {
    if (error instanceof PublicBookingCreateError && error.code === "provider_commit_uncertain") {
      return rememberUncertain(dependencies, scope, attempt, error.code);
    }
    return rememberUncertain(dependencies, scope, attempt, "booking_finalize_uncertain");
  }
}

/**
 * The public booking critical section. Token signature verification and the
 * Siteverify network call happen before this helper; all authoritative state,
 * live availability, idempotency, provider recovery, and provider writes happen
 * inside the server-owned serialization boundary.
 */
export async function createPublicBooking(
  initiallyResolved: ResolvedPublishedPublicBookingPage,
  input: PublicBookingCreateInput,
  dependencies: PublicBookingCreateDependencies,
): Promise<PublicBookingResult> {
  const scope: PublicBookingCoordinationScope = {
    workspace: initiallyResolved.privateSnapshot.workspaceId,
    principal: initiallyResolved.privateSnapshot.principalId,
  };
  const coordinationKey = await publicBookingCoordinationKey(scope);
  try {
    return await dependencies.serialization.runExclusive(coordinationKey, async () => {
    const now = dependencies.now();
    if (!Number.isFinite(now)) {
      throw new PublicBookingCreateError(503, "public_booking_unconfigured", "Public booking is not configured.");
    }
    if (!UUID_PATTERN.test(input.requestId)) {
      throw new PublicBookingCreateError(400, "invalid_booking_request", "The booking request ID is invalid.");
    }
    const configuredHostnames = dependencies.allowedTurnstileHostnames
      .map(hostname => hostname.trim())
      .filter(Boolean);
    if (
      dependencies.expectedTurnstileAction.trim().length === 0 ||
      configuredHostnames.length === 0
    ) {
      throw new PublicBookingCreateError(
        503,
        "public_booking_unconfigured",
        "Public booking is not configured.",
      );
    }
    managementBase(dependencies.managementOrigin);
    const guest = normalizedGuest(input.guest);
    validateTurnstile(input.turnstile, dependencies, now);

    const startsAt = canonicalInstant(input.slotProof.claims.start, "The selected start time");
    const endsAt = canonicalInstant(input.slotProof.claims.end, "The selected end time");
    const nowSeconds = Math.floor(now / 1_000);
    if (input.slotProof.claims.exp <= nowSeconds) {
      throw new PublicBookingCreateError(
        409,
        "slot_token_expired",
        "This selected time expired. Choose it again.",
      );
    }
    if (
      input.slotProof.claims.iat > nowSeconds + 60 ||
      input.slotProof.claims.exp <= input.slotProof.claims.iat ||
      input.slotProof.claims.exp - input.slotProof.claims.iat > 15 * 60 ||
      input.slotProof.token.length < 16 || input.slotProof.token.length > 4_096
    ) {
      throw new PublicBookingCreateError(400, "slot_token_invalid", "This selected time is invalid. Choose it again.");
    }

    let current: ResolvedPublishedPublicBookingPage | null;
    try {
      current = await dependencies.publications.currentPage(initiallyResolved.pageId);
    } catch {
      throw new PublicBookingCreateError(
        503,
        "public_booking_unavailable",
        "This booking page is temporarily unavailable.",
        true,
      );
    }
    if (
      !currentRevisionMatches(initiallyResolved, current) ||
      input.slotProof.claims.revisionId !== current.revisionId
    ) {
      throw new PublicBookingCreateError(
        409,
        "public_page_changed",
        "This booking page changed. Reload it before choosing a time.",
      );
    }
    if (
      Date.parse(endsAt) - Date.parse(startsAt) !==
        current.publicSnapshot.durationMinutes * MILLISECONDS_PER_MINUTE
    ) {
      throw new PublicBookingCreateError(400, "slot_token_invalid", "This selected time is invalid. Choose it again.");
    }
    if (!publicSlotSatisfiesPublishedSchedule({
      resolved: current,
      start: startsAt,
      end: endsAt,
      now,
    })) {
      throw slotConflict();
    }

    const conflictStart = new Date(
      Date.parse(startsAt) - current.privateSnapshot.schedule.bufferBeforeMinutes * MILLISECONDS_PER_MINUTE,
    ).toISOString();
    const conflictEnd = new Date(
      Date.parse(endsAt) + current.privateSnapshot.schedule.bufferAfterMinutes * MILLISECONDS_PER_MINUTE,
    ).toISOString();
    const conflictCalendarIds = [...new Set(current.privateSnapshot.conflictCalendarIds)].sort();
    if (
      conflictCalendarIds.length === 0 ||
      !conflictCalendarIds.includes(current.privateSnapshot.destinationCalendarId)
    ) {
      throw new PublicBookingCreateError(
        503,
        "published_page_invalid",
        "This booking page is temporarily unavailable.",
        true,
      );
    }

    const requestHash = await publicBookingRequestHash({
      page: current,
      slotClaims: input.slotProof.claims,
      guest,
    });
    const providerOperationId = await publicBookingProviderOperationId(
      scope,
      current.privateSnapshot.destinationCalendarId,
      input.requestId,
    );
    const approvalExpiresAt = current.publicSnapshot.approvalRequired
      ? new Date(now + PUBLIC_APPROVAL_HOLD_TTL_MS).toISOString()
      : null;
    const claimInput: PublicBookingAttemptClaim = {
      scope,
      idempotencyKey: input.requestId,
      requestHash,
      slotProofFingerprint: await sha256(input.slotProof.token),
      providerOperationId,
      startsAt,
      endsAt,
      revisionId: current.revisionId,
      guest,
      approvalExpiresAt,
    };
    let claimed: PublicBookingAttemptClaimResult;
    try {
      claimed = await dependencies.attempts.claim(claimInput);
    } catch {
      throw new PublicBookingCreateError(
        503,
        "booking_state_uncertain",
        "This booking could not be confirmed. Retry with the same request.",
        true,
      );
    }
    if (claimed.kind === "idempotency-conflict") {
      throw new PublicBookingCreateError(
        409,
        "idempotency_key_reused",
        "This request ID was already used for a different booking.",
      );
    }
    if (claimed.kind === "slot-proof-replayed") {
      throw new PublicBookingCreateError(
        409,
        "slot_proof_replayed",
        "This selected time proof was already used. Choose the time again.",
      );
    }
    const attempt = claimed.attempt;
    if (!validAttempt(
      attempt,
      claimInput,
      claimed.kind,
      current.publicSnapshot.approvalRequired,
    )) {
      throw new PublicBookingCreateError(
        503,
        "booking_state_uncertain",
        "This booking could not be confirmed. Retry with the same request.",
        true,
      );
    }
    if (attempt.state === "committed") {
      return validateStoredResponse(
        attempt.response,
        attempt,
        startsAt,
        endsAt,
        dependencies.managementOrigin,
      );
    }
    if (attempt.state === "rejected") {
      if (attempt.rejectionCode === "slot_conflict") throw slotConflict();
      throw new PublicBookingCreateError(
        503,
        "booking_state_uncertain",
        "This booking could not be confirmed. Retry with the same request.",
        true,
      );
    }

    if (claimed.kind === "existing") {
      let recovery: PublicProviderBookingRecovery;
      try {
        recovery = await dependencies.provider.recover({
          scope,
          destinationCalendarId: current.privateSnapshot.destinationCalendarId,
          operationId: attempt.providerOperationId,
          commitProof: attempt.requestHash,
          startsAt,
          endsAt,
        });
      } catch {
        return rememberUncertain(dependencies, scope, attempt, "provider_recovery_uncertain");
      }
      if (recovery.status === "uncertain") {
        return rememberUncertain(dependencies, scope, attempt, "provider_recovery_uncertain");
      }
      if (recovery.status === "committed") {
        return finalizeReceipt(
          dependencies,
          scope,
          current,
          attempt,
          recovery.receipt,
          startsAt,
          endsAt,
        );
      }
    }

    let live: AuthoritativePublicAvailabilityCheck;
    try {
      live = await dependencies.availability.revalidate({
        page: current,
        eventStart: startsAt,
        eventEnd: endsAt,
        conflictStart,
        conflictEnd,
        conflictCalendarIds,
      });
    } catch {
      throw new PublicBookingCreateError(
        503,
        "live_availability_unavailable",
        "Availability could not be checked. Try again shortly.",
        true,
      );
    }
    const completeAttestation = live.revisionId === current.revisionId &&
      live.eventStart === startsAt && live.eventEnd === endsAt &&
      live.conflictStart === conflictStart && live.conflictEnd === conflictEnd &&
      sameStrings(live.checkedCalendarIds, conflictCalendarIds);
    if (!completeAttestation || live.status === "uncertain") {
      throw new PublicBookingCreateError(
        503,
        "live_availability_unavailable",
        "Availability could not be checked. Try again shortly.",
        true,
      );
    }
    if (live.status === "conflict") {
      try {
        await dependencies.attempts.markRejected({
          scope,
          idempotencyKey: attempt.idempotencyKey,
          requestHash: attempt.requestHash,
          rejectionCode: "slot_conflict",
        });
      } catch {
        throw new PublicBookingCreateError(
          503,
          "booking_state_uncertain",
          "This booking could not be confirmed. Retry with the same request.",
          true,
        );
      }
      throw slotConflict();
    }

    let committed: PublicProviderBookingCommit;
    try {
      committed = await dependencies.provider.commit({
        scope,
        destinationCalendarId: current.privateSnapshot.destinationCalendarId,
        operationId: attempt.providerOperationId,
        commitProof: attempt.requestHash,
        startsAt,
        endsAt,
        conflictCalendarIds,
        conflictStart,
        conflictEnd,
        title: current.publicSnapshot.title,
        description: current.publicSnapshot.description,
        location: current.privateSnapshot.location,
        guest: attempt.guest,
        bookingKind: current.publicSnapshot.approvalRequired ? "approval-hold" : "meeting",
        conferenceProvider: current.publicSnapshot.location === "google-meet"
          ? "google-meet"
          : current.publicSnapshot.location === "zoom"
            ? "zoom"
            : "none",
        expiresAt: attempt.approvalExpiresAt,
      });
    } catch {
      return rememberUncertain(dependencies, scope, attempt, "provider_commit_uncertain");
    }
    if (committed.status === "uncertain") {
      return rememberUncertain(dependencies, scope, attempt, "provider_commit_uncertain");
    }
    if (committed.status === "conflict") {
      if (committed.reason === "operation-collision") {
        return rememberUncertain(dependencies, scope, attempt, "provider_operation_collision");
      }
      try {
        await dependencies.attempts.markRejected({
          scope,
          idempotencyKey: attempt.idempotencyKey,
          requestHash: attempt.requestHash,
          rejectionCode: "slot_conflict",
        });
      } catch {
        throw new PublicBookingCreateError(
          503,
          "booking_state_uncertain",
          "This booking could not be confirmed. Retry with the same request.",
          true,
        );
      }
      throw slotConflict();
    }
    return finalizeReceipt(
      dependencies,
      scope,
      current,
      attempt,
      committed.receipt,
      startsAt,
      endsAt,
    );
    });
  } catch (error) {
    if (error instanceof PublicBookingCreateError) throw error;
    throw new PublicBookingCreateError(
      503,
      "public_booking_unavailable",
      "This booking could not be completed. Try again shortly.",
      true,
    );
  }
}
