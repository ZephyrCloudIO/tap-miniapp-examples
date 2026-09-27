import {
  publicBookingCoordinationKey,
  type PublicBookingAvailabilityAuthority,
  type PublicBookingCoordinationScope,
  type PublicBookingGuestInput,
  type PublicBookingSerializationBoundary,
  type VerifiedPublicSlotProof,
} from "./public-booking-create";
import {
  projectPublicBookingPage,
  publicSlotSatisfiesPublishedSchedule,
  type ResolvedPublishedPublicBookingPage,
} from "./public-booking-read";

const MANAGEMENT_SCHEMA_VERSION = "tap.calendar.public-management.v1" as const;
const CANCEL_SCHEMA_VERSION = "tap.calendar.public-management-cancel.v1" as const;
const RESCHEDULE_SCHEMA_VERSION = "tap.calendar.public-management-reschedule.v1" as const;
const TOKEN_PATTERN = /^tapm_v1_[A-Za-z0-9_-]{43}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MILLISECONDS_PER_MINUTE = 60_000;

export type PublicBookingManagementStatus =
  | "confirmed"
  | "pending"
  | "declined"
  | "expired"
  | "cancelled";
export type PublicBookingManagementMutationKind = "cancel" | "reschedule";
export type PublicBookingManagementMutationState = "pending" | "uncertain" | "committed" | "rejected";

export type PublicBookingApprovalLifecycleTarget = "confirmed" | "declined" | "expired";

export interface PublicBookingApprovalLifecycleNotice {
  readonly eventKey: string;
  readonly bookingReference: string;
  readonly scope: PublicBookingCoordinationScope;
  readonly kind: "approval-approved" | "approval-declined" | "approval-expired";
  readonly recipient: PublicBookingGuestInput;
  readonly organizerName: string;
  readonly eventTitle: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly timeZone: string;
}

export type PublicBookingApprovalLifecycleTransitionResult =
  | {
    readonly kind: "transitioned" | "existing";
    readonly status: PublicBookingApprovalLifecycleTarget;
    readonly bookingVersion: number;
    readonly notice: PublicBookingApprovalLifecycleNotice;
  }
  | { readonly kind: "not-found" }
  | {
    readonly kind: "deadline-conflict";
    readonly approvalExpiresAt: string;
  }
  | { readonly kind: "mutation-conflict" }
  | {
    readonly kind: "status-conflict";
    readonly currentStatus: PublicBookingManagementStatus | "unavailable";
  };

export interface PublicBookingApprovalLifecycleStore {
  /**
   * Owner-scoped compare-and-set. A matching terminal replay is idempotent;
   * a different terminal decision never overwrites the first result.
   */
  transitionApproval(input: {
    readonly scope: PublicBookingCoordinationScope;
    readonly providerOperationId: string;
    readonly targetStatus: PublicBookingApprovalLifecycleTarget;
  }): Promise<PublicBookingApprovalLifecycleTransitionResult>;
}

export interface PublicBookingManagementRecord {
  readonly bookingReference: string;
  readonly scope: PublicBookingCoordinationScope;
  readonly tokenVersion: 1;
  readonly pageId: string;
  readonly revisionId: string;
  readonly destinationCalendarId: string;
  readonly providerBookingId: string;
  readonly providerOperationId: string;
  /** Original public create request hash stored on the provider event. */
  readonly providerCommitProof: string;
  readonly version: number;
  readonly status: PublicBookingManagementStatus;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly guest: PublicBookingGuestInput;
  readonly approvalExpiresAt: string | null;
  readonly organizerName: string;
  readonly eventTitle: string;
  readonly location: "google-meet" | "zoom" | "phone" | "in-person" | "custom";
  readonly locationLabel: string;
  readonly timeZone: string;
  readonly cancelledAt: string | null;
}

export interface PublicBookingManagementDto {
  readonly schemaVersion: typeof MANAGEMENT_SCHEMA_VERSION;
  readonly bookingReference: string;
  readonly bookingVersion: number;
  readonly status: PublicBookingManagementStatus;
  readonly guest: PublicBookingGuestInput;
  readonly host: { readonly displayName: string };
  readonly event: {
    readonly title: string;
    readonly startsAt: string;
    readonly endsAt: string;
    readonly durationMinutes: number;
    readonly location: PublicBookingManagementRecord["location"];
    readonly locationLabel: string;
    readonly approvalExpiresAt: string | null;
  };
  readonly actions: {
    readonly canCancel: boolean;
    readonly canReschedule: boolean;
  };
  readonly reschedulePage: null | {
    readonly profileSlug: string;
    readonly eventTypeSlug: string;
    readonly pageRevision: string;
    readonly bookingWindow: {
      readonly firstDate: string;
      readonly lastDate: string;
    };
    readonly turnstileSiteKey: string;
  };
}

export interface ParsedPublicBookingCancelRequest {
  readonly schemaVersion: typeof CANCEL_SCHEMA_VERSION;
  readonly requestId: string;
  readonly expectedVersion: number;
}

export interface ParsedPublicBookingRescheduleRequest {
  readonly schemaVersion: typeof RESCHEDULE_SCHEMA_VERSION;
  readonly requestId: string;
  readonly expectedVersion: number;
  readonly slotToken: string;
  readonly turnstileToken: string;
}

export interface PublicBookingManagementMutation {
  readonly bookingReference: string;
  readonly requestId: string;
  readonly requestHash: string;
  readonly operationId: string;
  readonly kind: PublicBookingManagementMutationKind;
  readonly expectedVersion: number;
  readonly pageRevisionId: string | null;
  readonly fromStartsAt: string;
  readonly fromEndsAt: string;
  readonly toStartsAt: string | null;
  readonly toEndsAt: string | null;
  readonly conflictCalendarIds: readonly string[];
  readonly conflictStart: string | null;
  readonly conflictEnd: string | null;
  readonly state: PublicBookingManagementMutationState;
  readonly response: PublicBookingManagementDto | null;
  readonly rejectionCode: "slot_conflict" | "provider_mismatch" | null;
}

export type PublicBookingManagementMutationClaimResult =
  | { readonly kind: "claimed"; readonly mutation: PublicBookingManagementMutation }
  | { readonly kind: "existing"; readonly mutation: PublicBookingManagementMutation }
  | { readonly kind: "idempotency-conflict" }
  | { readonly kind: "version-conflict" }
  | { readonly kind: "mutation-in-progress" };

export interface PublicBookingManagementStore {
  /** Hash-based lookup. Invalid, missing, and revoked tokens all return null. */
  resolve(token: string): Promise<PublicBookingManagementRecord | null>;
  findMutation(input: {
    readonly bookingReference: string;
    readonly requestId: string;
  }): Promise<PublicBookingManagementMutation | null>;
  claimMutation(input: {
    readonly booking: PublicBookingManagementRecord;
    readonly requestId: string;
    readonly requestHash: string;
    readonly operationId: string;
    readonly kind: PublicBookingManagementMutationKind;
    readonly expectedVersion: number;
    readonly pageRevisionId: string | null;
    readonly toStartsAt: string | null;
    readonly toEndsAt: string | null;
    readonly conflictCalendarIds: readonly string[];
    readonly conflictStart: string | null;
    readonly conflictEnd: string | null;
  }): Promise<PublicBookingManagementMutationClaimResult>;
  markUncertain(input: {
    readonly bookingReference: string;
    readonly requestId: string;
    readonly requestHash: string;
    readonly errorCode: string;
  }): Promise<void>;
  markRejected(input: {
    readonly bookingReference: string;
    readonly requestId: string;
    readonly requestHash: string;
    readonly rejectionCode: "slot_conflict" | "provider_mismatch";
  }): Promise<void>;
  commitCancellation(input: {
    readonly booking: PublicBookingManagementRecord;
    readonly mutation: PublicBookingManagementMutation;
    readonly response: PublicBookingManagementDto;
  }): Promise<PublicBookingManagementRecord>;
  commitReschedule(input: {
    readonly booking: PublicBookingManagementRecord;
    readonly mutation: PublicBookingManagementMutation;
    readonly currentPageRevisionId: string;
    readonly response: PublicBookingManagementDto;
  }): Promise<PublicBookingManagementRecord>;
}

export interface PublicBookingManagementPublicationReader {
  /** Returns only a currently published page from the primary store. */
  currentPage(pageId: string): Promise<ResolvedPublishedPublicBookingPage | null>;
}

export interface PublicBookingManagementSlotVerifier {
  verify(input: {
    readonly page: ResolvedPublishedPublicBookingPage;
    readonly token: string;
  }): Promise<VerifiedPublicSlotProof>;
}

export interface PublicBookingManagementProviderCommand {
  readonly kind: PublicBookingManagementMutationKind;
  readonly scope: PublicBookingCoordinationScope;
  readonly destinationCalendarId: string;
  readonly providerBookingId: string;
  readonly providerOperationId: string;
  readonly providerCommitProof: string;
  readonly operationId: string;
  readonly mutationProof: string;
  readonly bookingStatus: "confirmed" | "pending";
  readonly startsAt: string;
  readonly endsAt: string;
  readonly newStartsAt: string | null;
  readonly newEndsAt: string | null;
  readonly conflictCalendarIds: readonly string[];
  readonly conflictStart: string | null;
  readonly conflictEnd: string | null;
}

export interface PublicBookingManagementProviderReceipt {
  readonly operationId: string;
  readonly providerBookingId: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly status: "cancelled" | "confirmed";
}

export type PublicBookingManagementProviderRecovery =
  | { readonly status: "absent" }
  | { readonly status: "uncertain" }
  | { readonly status: "committed"; readonly receipt: PublicBookingManagementProviderReceipt };

export type PublicBookingManagementProviderResult =
  | { readonly status: "committed"; readonly receipt: PublicBookingManagementProviderReceipt }
  | { readonly status: "conflict"; readonly reason: "slot-conflict" | "provider-mismatch" }
  | { readonly status: "uncertain" };

export interface PublicBookingManagementProvider {
  recover(input: PublicBookingManagementProviderCommand): Promise<PublicBookingManagementProviderRecovery>;
  cancel(input: PublicBookingManagementProviderCommand): Promise<PublicBookingManagementProviderResult>;
  reschedule(input: PublicBookingManagementProviderCommand): Promise<PublicBookingManagementProviderResult>;
}

export interface PublicBookingManagementEmailPort {
  enqueue(input: {
    readonly eventKey: string;
    readonly bookingReference: string;
    readonly scope: PublicBookingCoordinationScope;
    readonly kind: "cancelled" | "rescheduled";
    readonly recipient: PublicBookingGuestInput;
    readonly organizerName: string;
    readonly eventTitle: string;
    readonly startsAt: string;
    readonly endsAt: string;
    readonly timeZone: string;
    readonly previousStartsAt?: string;
    readonly previousEndsAt?: string;
  }): Promise<void>;
}

export interface PublicBookingManagementDependencies {
  readonly serialization: PublicBookingSerializationBoundary;
  readonly store: PublicBookingManagementStore;
  readonly publications: PublicBookingManagementPublicationReader;
  readonly slotVerifier: PublicBookingManagementSlotVerifier;
  readonly availability: PublicBookingAvailabilityAuthority;
  readonly provider: PublicBookingManagementProvider;
  readonly email: PublicBookingManagementEmailPort;
  readonly now: () => number;
  readonly turnstileSiteKey: string;
}

export class PublicBookingManagementError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;

  constructor(status: number, code: string, message: string, retryable = false) {
    super(message);
    this.name = "PublicBookingManagementError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const exactKeys = (value: Readonly<Record<string, unknown>>, expected: readonly string[]): boolean => {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
};

const unavailable = (): PublicBookingManagementError => new PublicBookingManagementError(
  404,
  "management_link_unavailable",
  "This booking management link is unavailable.",
);

export function parsePublicBookingManagementToken(value: unknown): string {
  if (typeof value !== "string" || !TOKEN_PATTERN.test(value)) throw unavailable();
  return value;
}

const parseMutationBase = (
  value: unknown,
  expectedKeys: readonly string[],
  schemaVersion: typeof CANCEL_SCHEMA_VERSION | typeof RESCHEDULE_SCHEMA_VERSION,
): Readonly<Record<string, unknown>> & { readonly requestId: string; readonly expectedVersion: number } => {
  if (
    !isRecord(value) ||
    !exactKeys(value, expectedKeys) ||
    value.schemaVersion !== schemaVersion ||
    typeof value.requestId !== "string" ||
    !UUID_PATTERN.test(value.requestId) ||
    typeof value.expectedVersion !== "number" ||
    !Number.isSafeInteger(value.expectedVersion) ||
    value.expectedVersion < 1
  ) {
    throw new PublicBookingManagementError(400, "invalid_management_request", "The request is invalid.");
  }
  return {
    ...value,
    requestId: value.requestId,
    expectedVersion: value.expectedVersion,
  };
};

export function parsePublicBookingCancelRequest(value: unknown): ParsedPublicBookingCancelRequest {
  const parsed = parseMutationBase(
    value,
    ["schemaVersion", "requestId", "expectedVersion"],
    CANCEL_SCHEMA_VERSION,
  );
  return {
    schemaVersion: CANCEL_SCHEMA_VERSION,
    requestId: parsed.requestId,
    expectedVersion: parsed.expectedVersion,
  };
}

export function parsePublicBookingRescheduleRequest(value: unknown): ParsedPublicBookingRescheduleRequest {
  const parsed = parseMutationBase(
    value,
    ["schemaVersion", "requestId", "expectedVersion", "slotToken", "turnstileToken"],
    RESCHEDULE_SCHEMA_VERSION,
  );
  if (
    typeof parsed.slotToken !== "string" || parsed.slotToken.length < 16 || parsed.slotToken.length > 4_096 ||
    typeof parsed.turnstileToken !== "string" || parsed.turnstileToken.length < 1 || parsed.turnstileToken.length > 2_048
  ) {
    throw new PublicBookingManagementError(400, "invalid_management_request", "The request is invalid.");
  }
  return {
    schemaVersion: RESCHEDULE_SCHEMA_VERSION,
    requestId: parsed.requestId,
    expectedVersion: parsed.expectedVersion,
    slotToken: parsed.slotToken,
    turnstileToken: parsed.turnstileToken,
  };
}

export const projectPublicBookingManagement = (
  booking: PublicBookingManagementRecord,
  reschedulePage: PublicBookingManagementDto["reschedulePage"] = null,
): PublicBookingManagementDto => ({
  schemaVersion: MANAGEMENT_SCHEMA_VERSION,
  bookingReference: booking.bookingReference,
  bookingVersion: booking.version,
  status: booking.status,
  guest: booking.guest,
  host: { displayName: booking.organizerName },
  event: {
    title: booking.eventTitle,
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
    durationMinutes: Math.round((Date.parse(booking.endsAt) - Date.parse(booking.startsAt)) / MILLISECONDS_PER_MINUTE),
    location: booking.location,
    locationLabel: booking.locationLabel,
    approvalExpiresAt: booking.approvalExpiresAt,
  },
  actions: {
    canCancel: booking.status === "confirmed" || booking.status === "pending",
    canReschedule: booking.status === "confirmed" && reschedulePage !== null,
  },
  reschedulePage: booking.status === "confirmed" ? reschedulePage : null,
});

const textEncoder = new TextEncoder();
const base64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
};
const digest = async (value: string): Promise<string> => base64Url(new Uint8Array(
  await crypto.subtle.digest("SHA-256", textEncoder.encode(value)),
));

const mutationHash = (
  booking: PublicBookingManagementRecord,
  request: ParsedPublicBookingCancelRequest | ParsedPublicBookingRescheduleRequest,
  kind: PublicBookingManagementMutationKind,
): Promise<string> => digest(JSON.stringify({
  v: 1,
  kind,
  bookingReference: booking.bookingReference,
  expectedVersion: request.expectedVersion,
  ...(kind === "reschedule" && "slotToken" in request ? { slotToken: request.slotToken } : {}),
}));

const mutationOperationId = (
  bookingReference: string,
  requestId: string,
  kind: PublicBookingManagementMutationKind,
): Promise<string> => digest(`tap.calendar.public-management-operation.v1\0${bookingReference}\0${requestId}\0${kind}`)
  .then(value => `tapmop_${value}`);

const sameStrings = (left: readonly string[], right: readonly string[]): boolean => {
  const first = [...new Set(left)].sort();
  const second = [...new Set(right)].sort();
  return first.length === second.length && first.every((value, index) => value === second[index]);
};

const mutationError = (mutation: PublicBookingManagementMutation): PublicBookingManagementError => {
  const code = mutation.rejectionCode === "provider_mismatch" ? "provider_mismatch" : "slot_conflict";
  return new PublicBookingManagementError(
    409,
    code,
    code === "slot_conflict"
      ? "That time is no longer available."
      : "This booking could not be matched with the calendar provider.",
  );
};

const claimError = (kind: PublicBookingManagementMutationClaimResult["kind"]): never => {
  if (kind === "idempotency-conflict") {
    throw new PublicBookingManagementError(409, "idempotency_key_reused", "This request ID was already used.");
  }
  if (kind === "version-conflict") {
    throw new PublicBookingManagementError(409, "booking_version_changed", "This booking changed. Refresh and try again.");
  }
  throw new PublicBookingManagementError(
    409,
    "management_mutation_in_progress",
    "Another change to this booking is still being confirmed. Retry shortly.",
    true,
  );
};

async function resolvedBooking(
  token: string,
  store: PublicBookingManagementStore,
): Promise<PublicBookingManagementRecord> {
  let booking: PublicBookingManagementRecord | null = null;
  try {
    booking = await store.resolve(token);
  } catch {
    throw unavailable();
  }
  if (!booking) throw unavailable();
  return booking;
}

const reschedulePageProjection = (
  page: ResolvedPublishedPublicBookingPage,
  dependencies: Pick<PublicBookingManagementDependencies, "now" | "turnstileSiteKey">,
): NonNullable<PublicBookingManagementDto["reschedulePage"]> => {
  const projected = projectPublicBookingPage(page, {
    baseUrl: "https://cal.with-tap.ai",
    turnstileSiteKey: dependencies.turnstileSiteKey,
    now: dependencies.now(),
  });
  return {
    profileSlug: page.profileSlug,
    eventTypeSlug: page.eventTypeSlug,
    pageRevision: page.revisionId,
    bookingWindow: projected.bookingWindow,
    turnstileSiteKey: projected.turnstile.siteKey,
  };
};

const providerCommand = (
  booking: PublicBookingManagementRecord,
  mutation: PublicBookingManagementMutation,
  conflict: {
    readonly calendarIds: readonly string[];
    readonly start: string | null;
    readonly end: string | null;
  },
): PublicBookingManagementProviderCommand => ({
  kind: mutation.kind,
  scope: booking.scope,
  destinationCalendarId: booking.destinationCalendarId,
  providerBookingId: booking.providerBookingId,
  providerOperationId: booking.providerOperationId,
  providerCommitProof: booking.providerCommitProof,
  operationId: mutation.operationId,
  mutationProof: mutation.requestHash,
  bookingStatus: booking.status === "pending" ? "pending" : "confirmed",
  startsAt: booking.startsAt,
  endsAt: booking.endsAt,
  newStartsAt: mutation.toStartsAt,
  newEndsAt: mutation.toEndsAt,
  conflictCalendarIds: conflict.calendarIds,
  conflictStart: conflict.start,
  conflictEnd: conflict.end,
});

const validateReceipt = (
  booking: PublicBookingManagementRecord,
  mutation: PublicBookingManagementMutation,
  receipt: PublicBookingManagementProviderReceipt,
): void => {
  const startsAt = mutation.kind === "cancel" ? mutation.fromStartsAt : mutation.toStartsAt;
  const endsAt = mutation.kind === "cancel" ? mutation.fromEndsAt : mutation.toEndsAt;
  if (
    receipt.operationId !== mutation.operationId ||
    receipt.providerBookingId !== booking.providerBookingId ||
    receipt.startsAt !== startsAt || receipt.endsAt !== endsAt ||
    receipt.status !== (mutation.kind === "cancel" ? "cancelled" : "confirmed")
  ) {
    throw new PublicBookingManagementError(
      503,
      "provider_management_uncertain",
      "The calendar provider did not conclusively confirm this change. Retry the same request.",
      true,
    );
  }
};

async function providerOutcome(
  booking: PublicBookingManagementRecord,
  mutation: PublicBookingManagementMutation,
  dependencies: PublicBookingManagementDependencies,
  conflict: { readonly calendarIds: readonly string[]; readonly start: string | null; readonly end: string | null },
): Promise<PublicBookingManagementProviderReceipt> {
  const command = providerCommand(booking, mutation, conflict);
  let outcome: PublicBookingManagementProviderResult | PublicBookingManagementProviderRecovery;
  try {
    if (mutation.state === "uncertain" || mutation.state === "pending") {
      const recovered = await dependencies.provider.recover(command);
      if (recovered.status !== "absent") outcome = recovered;
      else outcome = mutation.kind === "cancel"
        ? await dependencies.provider.cancel(command)
        : await dependencies.provider.reschedule(command);
    } else {
      throw new Error("Only open mutations reach the provider.");
    }
  } catch {
    outcome = { status: "uncertain" };
  }
  if (outcome.status === "committed") {
    try {
      validateReceipt(booking, mutation, outcome.receipt);
      return outcome.receipt;
    } catch (error) {
      await dependencies.store.markUncertain({
        bookingReference: mutation.bookingReference,
        requestId: mutation.requestId,
        requestHash: mutation.requestHash,
        errorCode: "provider_receipt_invalid",
      }).catch(() => undefined);
      throw error;
    }
  }
  if (outcome.status === "conflict") {
    const rejectionCode = outcome.reason === "provider-mismatch" ? "provider_mismatch" : "slot_conflict";
    await dependencies.store.markRejected({
      bookingReference: mutation.bookingReference,
      requestId: mutation.requestId,
      requestHash: mutation.requestHash,
      rejectionCode,
    });
    throw mutationError({ ...mutation, state: "rejected", rejectionCode });
  }
  await dependencies.store.markUncertain({
    bookingReference: mutation.bookingReference,
    requestId: mutation.requestId,
    requestHash: mutation.requestHash,
    errorCode: "provider_management_uncertain",
  }).catch(() => undefined);
  throw new PublicBookingManagementError(
    503,
    "provider_management_uncertain",
    "The calendar provider did not conclusively confirm this change. Retry the same request.",
    true,
  );
}

async function sendNotice(
  booking: PublicBookingManagementRecord,
  mutation: PublicBookingManagementMutation,
  dependencies: PublicBookingManagementDependencies,
): Promise<void> {
  const rescheduled = mutation.kind === "reschedule";
  try {
    await dependencies.email.enqueue({
      eventKey: mutation.operationId,
      bookingReference: booking.bookingReference,
      scope: booking.scope,
      kind: rescheduled ? "rescheduled" : "cancelled",
      recipient: booking.guest,
      organizerName: booking.organizerName,
      eventTitle: booking.eventTitle,
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
      timeZone: booking.timeZone,
      ...(rescheduled ? {
        previousStartsAt: mutation.fromStartsAt,
        previousEndsAt: mutation.fromEndsAt,
      } : {}),
    });
  } catch {
    throw new PublicBookingManagementError(
      503,
      "management_notice_pending",
      "The booking changed, but its notification is still being prepared. Retry the same request.",
      true,
    );
  }
}

const terminalReplay = async (
  booking: PublicBookingManagementRecord,
  mutation: PublicBookingManagementMutation,
  dependencies: PublicBookingManagementDependencies,
): Promise<PublicBookingManagementDto | null> => {
  if (mutation.state === "rejected") throw mutationError(mutation);
  if (mutation.state !== "committed") return null;
  if (!mutation.response) {
    throw new PublicBookingManagementError(503, "management_state_uncertain", "This booking is temporarily unavailable.", true);
  }
  await sendNotice(booking, mutation, dependencies);
  const page = booking.status === "confirmed"
    ? await optionalReschedulePage(booking, dependencies)
    : null;
  return projectPublicBookingManagement(
    booking,
    page ? reschedulePageProjection(page, dependencies) : null,
  );
};

export async function cancelPublicBooking(
  token: string,
  request: ParsedPublicBookingCancelRequest,
  dependencies: PublicBookingManagementDependencies,
): Promise<PublicBookingManagementDto> {
  const initiallyResolved = await resolvedBooking(token, dependencies.store);
  const coordinationKey = await publicBookingCoordinationKey(initiallyResolved.scope);
  return dependencies.serialization.runExclusive(coordinationKey, async () => {
    const booking = await resolvedBooking(token, dependencies.store);
    const requestHash = await mutationHash(booking, request, "cancel");
    const existing = await dependencies.store.findMutation({
      bookingReference: booking.bookingReference,
      requestId: request.requestId,
    });
    if (existing) {
      if (existing.requestHash !== requestHash || existing.kind !== "cancel") claimError("idempotency-conflict");
      const replay = await terminalReplay(booking, existing, dependencies);
      if (replay) return replay;
    }
    if (booking.status === "cancelled") {
      throw new PublicBookingManagementError(409, "booking_already_cancelled", "This booking is already cancelled.");
    }
    if (booking.status !== "confirmed" && booking.status !== "pending") {
      throw new PublicBookingManagementError(
        409,
        "booking_not_cancellable",
        "This booking request can no longer be cancelled.",
      );
    }
    if (booking.version !== request.expectedVersion) claimError("version-conflict");
    const claimed = existing ? { kind: "existing" as const, mutation: existing } : await dependencies.store.claimMutation({
      booking,
      requestId: request.requestId,
      requestHash,
      operationId: await mutationOperationId(booking.bookingReference, request.requestId, "cancel"),
      kind: "cancel",
      expectedVersion: request.expectedVersion,
      pageRevisionId: null,
      toStartsAt: null,
      toEndsAt: null,
      conflictCalendarIds: [],
      conflictStart: null,
      conflictEnd: null,
    });
    const mutation = "mutation" in claimed ? claimed.mutation : claimError(claimed.kind);
    await providerOutcome(booking, mutation, dependencies, { calendarIds: [], start: null, end: null });
    const target: PublicBookingManagementRecord = {
      ...booking,
      version: booking.version + 1,
      status: "cancelled",
      cancelledAt: new Date(dependencies.now()).toISOString(),
    };
    const response = projectPublicBookingManagement(target);
    const committed = await dependencies.store.commitCancellation({ booking, mutation, response });
    await sendNotice(committed, { ...mutation, state: "committed", response }, dependencies);
    return response;
  });
}

async function currentReschedulePage(
  booking: PublicBookingManagementRecord,
  dependencies: PublicBookingManagementDependencies,
): Promise<ResolvedPublishedPublicBookingPage> {
  let page: ResolvedPublishedPublicBookingPage | null;
  try {
    page = await dependencies.publications.currentPage(booking.pageId);
  } catch {
    page = null;
  }
  if (
    !page ||
    page.privateSnapshot.workspaceId !== booking.scope.workspace ||
    page.privateSnapshot.principalId !== booking.scope.principal ||
    page.privateSnapshot.destinationCalendarId !== booking.destinationCalendarId
  ) {
    throw new PublicBookingManagementError(
      409,
      "reschedule_unavailable",
      "This booking cannot be rescheduled from its current booking page.",
    );
  }
  return page;
}

async function optionalReschedulePage(
  booking: PublicBookingManagementRecord,
  dependencies: PublicBookingManagementDependencies,
): Promise<ResolvedPublishedPublicBookingPage | null> {
  if (booking.status !== "confirmed") return null;
  try {
    return await currentReschedulePage(booking, dependencies);
  } catch {
    return null;
  }
}

export async function readPublicBookingManagement(
  token: string,
  dependencies: PublicBookingManagementDependencies,
): Promise<PublicBookingManagementDto> {
  const booking = await resolvedBooking(token, dependencies.store);
  const page = await optionalReschedulePage(booking, dependencies);
  return projectPublicBookingManagement(
    booking,
    page ? reschedulePageProjection(page, dependencies) : null,
  );
}

export async function reschedulePublicBooking(
  token: string,
  request: ParsedPublicBookingRescheduleRequest,
  dependencies: PublicBookingManagementDependencies,
): Promise<PublicBookingManagementDto> {
  const initiallyResolved = await resolvedBooking(token, dependencies.store);
  const coordinationKey = await publicBookingCoordinationKey(initiallyResolved.scope);
  return dependencies.serialization.runExclusive(coordinationKey, async () => {
    const booking = await resolvedBooking(token, dependencies.store);
    const requestHash = await mutationHash(booking, request, "reschedule");
    const existing = await dependencies.store.findMutation({
      bookingReference: booking.bookingReference,
      requestId: request.requestId,
    });
    if (existing) {
      if (existing.requestHash !== requestHash || existing.kind !== "reschedule") claimError("idempotency-conflict");
      const replay = await terminalReplay(booking, existing, dependencies);
      if (replay) return replay;
    }
    if (booking.status !== "confirmed") {
      throw new PublicBookingManagementError(
        409,
        "reschedule_unavailable",
        "Only a confirmed booking can be rescheduled.",
      );
    }
    if (booking.version !== request.expectedVersion) claimError("version-conflict");

    let page: ResolvedPublishedPublicBookingPage | null = null;
    let slot: VerifiedPublicSlotProof | null = null;
    let newStartsAt: string | null = null;
    let newEndsAt: string | null = null;
    let conflictCalendarIds: readonly string[] = [];
    let conflictStart: string | null = null;
    let conflictEnd: string | null = null;
    if (!existing) {
      page = await currentReschedulePage(booking, dependencies);
      try {
        slot = await dependencies.slotVerifier.verify({ page, token: request.slotToken });
      } catch {
        throw new PublicBookingManagementError(409, "slot_token_invalid", "Choose the time again.");
      }
      newStartsAt = slot.claims.start;
      newEndsAt = slot.claims.end;
      if (
        slot.claims.revisionId !== page.revisionId ||
        Date.parse(newEndsAt) - Date.parse(newStartsAt) !== page.publicSnapshot.durationMinutes * MILLISECONDS_PER_MINUTE ||
        !publicSlotSatisfiesPublishedSchedule({
          resolved: page,
          start: newStartsAt,
          end: newEndsAt,
          now: dependencies.now(),
        })
      ) {
        throw new PublicBookingManagementError(409, "slot_conflict", "That time is no longer available.");
      }
      conflictCalendarIds = [...new Set(page.privateSnapshot.conflictCalendarIds)].sort();
      if (!conflictCalendarIds.includes(booking.destinationCalendarId)) {
        throw new PublicBookingManagementError(409, "reschedule_unavailable", "This booking cannot be rescheduled.");
      }
      conflictStart = new Date(
        Date.parse(newStartsAt) - page.privateSnapshot.schedule.bufferBeforeMinutes * MILLISECONDS_PER_MINUTE,
      ).toISOString();
      conflictEnd = new Date(
        Date.parse(newEndsAt) + page.privateSnapshot.schedule.bufferAfterMinutes * MILLISECONDS_PER_MINUTE,
      ).toISOString();
      let availability;
      try {
        availability = await dependencies.availability.revalidate({
          page,
          eventStart: newStartsAt,
          eventEnd: newEndsAt,
          conflictStart,
          conflictEnd,
          conflictCalendarIds,
        });
      } catch {
        throw new PublicBookingManagementError(503, "availability_uncertain", "Availability could not be confirmed.", true);
      }
      if (
        availability.status !== "available" ||
        availability.revisionId !== page.revisionId ||
        availability.eventStart !== newStartsAt || availability.eventEnd !== newEndsAt ||
        availability.conflictStart !== conflictStart || availability.conflictEnd !== conflictEnd ||
        !sameStrings(availability.checkedCalendarIds, conflictCalendarIds)
      ) {
        throw new PublicBookingManagementError(
          availability.status === "conflict" ? 409 : 503,
          availability.status === "conflict" ? "slot_conflict" : "availability_uncertain",
          availability.status === "conflict" ? "That time is no longer available." : "Availability could not be confirmed.",
          availability.status !== "conflict",
        );
      }
    } else {
      newStartsAt = existing.toStartsAt;
      newEndsAt = existing.toEndsAt;
      if (!newStartsAt || !newEndsAt || !existing.pageRevisionId) {
        throw new PublicBookingManagementError(503, "management_state_uncertain", "This booking is temporarily unavailable.", true);
      }
      // An open retry is allowed to recover after unpublication. The provider
      // already received the fully validated target captured by the first claim.
      conflictCalendarIds = existing.conflictCalendarIds;
      conflictStart = existing.conflictStart;
      conflictEnd = existing.conflictEnd;
      if (
        conflictCalendarIds.length === 0 ||
        !conflictCalendarIds.includes(booking.destinationCalendarId) ||
        !conflictStart || !conflictEnd
      ) {
        throw new PublicBookingManagementError(503, "management_state_uncertain", "This booking is temporarily unavailable.", true);
      }
    }

    const claimed = existing ? { kind: "existing" as const, mutation: existing } : await dependencies.store.claimMutation({
      booking,
      requestId: request.requestId,
      requestHash,
      operationId: await mutationOperationId(booking.bookingReference, request.requestId, "reschedule"),
      kind: "reschedule",
      expectedVersion: request.expectedVersion,
      pageRevisionId: page!.revisionId,
      toStartsAt: newStartsAt,
      toEndsAt: newEndsAt,
      conflictCalendarIds,
      conflictStart,
      conflictEnd,
    });
    const mutation = "mutation" in claimed ? claimed.mutation : claimError(claimed.kind);
    await providerOutcome(booking, mutation, dependencies, {
      calendarIds: conflictCalendarIds,
      start: conflictStart,
      end: conflictEnd,
    });
    const target: PublicBookingManagementRecord = {
      ...booking,
      version: booking.version + 1,
      revisionId: mutation.pageRevisionId!,
      startsAt: mutation.toStartsAt!,
      endsAt: mutation.toEndsAt!,
    };
    const projectedPage = page ?? await optionalReschedulePage(target, dependencies);
    const response = projectPublicBookingManagement(
      target,
      projectedPage ? reschedulePageProjection(projectedPage, dependencies) : null,
    );
    const committed = await dependencies.store.commitReschedule({
      booking,
      mutation,
      currentPageRevisionId: mutation.pageRevisionId!,
      response,
    });
    await sendNotice(committed, { ...mutation, state: "committed", response }, dependencies);
    return response;
  });
}
