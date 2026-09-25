import type {
  PublicBookingApprovalLifecycleStore,
  PublicBookingApprovalLifecycleTarget,
  PublicBookingApprovalLifecycleTransitionResult,
  PublicBookingManagementDto,
  PublicBookingManagementMutation,
  PublicBookingManagementMutationClaimResult,
  PublicBookingManagementRecord,
  PublicBookingManagementStore,
} from "./public-booking-management";
import { publicBookingManagementTokenHash } from "./public-booking-store";

const TOKEN_PATTERN = /^tapm_v1_[A-Za-z0-9_-]{43}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const UNMATCHABLE_TOKEN = `tapm_v1_${"0".repeat(43)}`;

type Clock = () => number;

interface CredentialRow extends Record<string, unknown> {
  readonly booking_reference: string;
  readonly workspace_id: string;
  readonly principal_id: string;
  readonly token_version: number;
  readonly page_id: string;
  readonly revision_id: string;
  readonly destination_calendar_id: string;
  readonly provider_booking_id: string;
  readonly provider_operation_id: string;
  readonly provider_commit_proof: string;
  readonly version: number;
  readonly booking_status: string;
  readonly start_at: string;
  readonly end_at: string;
  readonly guest_name: string;
  readonly guest_email: string;
  readonly approval_expires_at: string | null;
  readonly organizer_name: string;
  readonly event_title: string;
  readonly location_kind: string;
  readonly location_label: string;
  readonly time_zone: string;
  readonly status: string;
  readonly cancelled_at: string | null;
}

interface MutationRow extends Record<string, unknown> {
  readonly booking_reference: string;
  readonly request_id: string;
  readonly request_hash: string;
  readonly operation_id: string;
  readonly kind: string;
  readonly expected_version: number;
  readonly page_revision_id: string | null;
  readonly from_start_at: string;
  readonly from_end_at: string;
  readonly to_start_at: string | null;
  readonly to_end_at: string | null;
  readonly conflict_calendar_ids_json: string | null;
  readonly conflict_start_at: string | null;
  readonly conflict_end_at: string | null;
  readonly state: string;
  readonly response_json: string | null;
  readonly rejection_code: string | null;
}

interface AggregateStateRow extends Record<string, unknown> {
  readonly version: number;
  readonly status: string;
  readonly booking_status: string;
}

interface OpenMutationRow extends Record<string, unknown> {
  readonly request_id: string;
}

export class PublicBookingManagementStoreError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PublicBookingManagementStoreError";
    this.code = code;
  }
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const requiredText = (value: string, field: string, minimum: number, maximum: number): string => {
  if (value.length < minimum || value.length > maximum || value.trim() !== value) {
    throw new PublicBookingManagementStoreError("invalid_store_input", `${field} is invalid.`);
  }
  return value;
};

const canonicalInstant = (value: string, field: string): string => {
  requiredText(value, field, 20, 40);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new PublicBookingManagementStoreError("invalid_store_input", `${field} is invalid.`);
  }
  return value;
};

const canonicalNow = (clock: Clock): string => {
  const now = clock();
  if (!Number.isFinite(now)) {
    throw new PublicBookingManagementStoreError("invalid_store_clock", "The management clock is invalid.");
  }
  return new Date(now).toISOString();
};

const validTimeZone = (value: string): boolean => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
};

const credentialRow = (value: unknown): CredentialRow | null => {
  if (
    !isRecord(value) ||
    typeof value.booking_reference !== "string" ||
    typeof value.workspace_id !== "string" ||
    typeof value.principal_id !== "string" ||
    typeof value.token_version !== "number" ||
    typeof value.page_id !== "string" ||
    typeof value.revision_id !== "string" ||
    typeof value.destination_calendar_id !== "string" ||
    typeof value.provider_booking_id !== "string" ||
    typeof value.provider_operation_id !== "string" ||
    typeof value.provider_commit_proof !== "string" ||
    typeof value.version !== "number" ||
    typeof value.booking_status !== "string" ||
    typeof value.start_at !== "string" ||
    typeof value.end_at !== "string" ||
    typeof value.guest_name !== "string" ||
    typeof value.guest_email !== "string" ||
    (value.approval_expires_at !== null && typeof value.approval_expires_at !== "string") ||
    typeof value.organizer_name !== "string" ||
    typeof value.event_title !== "string" ||
    typeof value.location_kind !== "string" ||
    typeof value.location_label !== "string" ||
    typeof value.time_zone !== "string" ||
    typeof value.status !== "string" ||
    (value.cancelled_at !== null && typeof value.cancelled_at !== "string")
  ) return null;
  return {
    ...value,
    booking_reference: value.booking_reference,
    workspace_id: value.workspace_id,
    principal_id: value.principal_id,
    token_version: value.token_version,
    page_id: value.page_id,
    revision_id: value.revision_id,
    destination_calendar_id: value.destination_calendar_id,
    provider_booking_id: value.provider_booking_id,
    provider_operation_id: value.provider_operation_id,
    provider_commit_proof: value.provider_commit_proof,
    version: value.version,
    booking_status: value.booking_status,
    start_at: value.start_at,
    end_at: value.end_at,
    guest_name: value.guest_name,
    guest_email: value.guest_email,
    approval_expires_at: value.approval_expires_at,
    organizer_name: value.organizer_name,
    event_title: value.event_title,
    location_kind: value.location_kind,
    location_label: value.location_label,
    time_zone: value.time_zone,
    status: value.status,
    cancelled_at: value.cancelled_at,
  };
};

const toRecord = (row: CredentialRow): PublicBookingManagementRecord => {
  const expectedStatus = row.status === "cancelled" ? "cancelled" : row.booking_status;
  if (
    row.token_version !== 1 ||
    !["active", "cancelled"].includes(row.status) ||
    !["confirmed", "pending", "declined", "expired", "cancelled"].includes(expectedStatus) ||
    !Number.isSafeInteger(row.version) || row.version < 1 ||
    row.booking_reference.length < 16 || row.booking_reference.length > 128 ||
    row.workspace_id.length < 1 || row.workspace_id.length > 255 ||
    row.principal_id.length < 1 || row.principal_id.length > 255 ||
    row.page_id.length < 8 || row.page_id.length > 255 ||
    row.revision_id.length < 8 || row.revision_id.length > 255 ||
    row.destination_calendar_id.length < 1 || row.destination_calendar_id.length > 255 ||
    row.provider_booking_id.length < 1 || row.provider_booking_id.length > 2_048 ||
    row.provider_operation_id.length < 16 || row.provider_operation_id.length > 255 ||
    row.provider_commit_proof.length < 16 || row.provider_commit_proof.length > 128 ||
    row.guest_name.length < 1 || row.guest_name.length > 160 ||
    row.guest_email.length < 3 || row.guest_email.length > 320 ||
    row.guest_email.trim().toLowerCase() !== row.guest_email || !row.guest_email.includes("@") ||
    row.organizer_name.length < 1 || row.organizer_name.length > 160 ||
    row.event_title.length < 1 || row.event_title.length > 160 ||
    !["google-meet", "zoom", "phone", "in-person", "custom"].includes(row.location_kind) ||
    row.location_label.length < 1 || row.location_label.length > 160 ||
    !validTimeZone(row.time_zone) ||
    (row.status === "cancelled") !== (row.cancelled_at !== null) ||
    (row.status === "cancelled") !== (row.booking_status === "cancelled") ||
    (["pending", "declined", "expired"].includes(row.booking_status) &&
      row.approval_expires_at === null)
  ) {
    throw new PublicBookingManagementStoreError("corrupt_management_record", "The management record is invalid.");
  }
  canonicalInstant(row.start_at, "start_at");
  canonicalInstant(row.end_at, "end_at");
  if (Date.parse(row.end_at) <= Date.parse(row.start_at)) {
    throw new PublicBookingManagementStoreError("corrupt_management_record", "The management interval is invalid.");
  }
  if (row.approval_expires_at !== null) canonicalInstant(row.approval_expires_at, "approval_expires_at");
  if (row.cancelled_at !== null) canonicalInstant(row.cancelled_at, "cancelled_at");
  return {
    bookingReference: row.booking_reference,
    scope: { workspace: row.workspace_id, principal: row.principal_id },
    tokenVersion: 1,
    pageId: row.page_id,
    revisionId: row.revision_id,
    destinationCalendarId: row.destination_calendar_id,
    providerBookingId: row.provider_booking_id,
    providerOperationId: row.provider_operation_id,
    providerCommitProof: row.provider_commit_proof,
    version: row.version,
    status: expectedStatus as PublicBookingManagementRecord["status"],
    startsAt: row.start_at,
    endsAt: row.end_at,
    guest: { name: row.guest_name, email: row.guest_email },
    approvalExpiresAt: row.approval_expires_at,
    organizerName: row.organizer_name,
    eventTitle: row.event_title,
    location: row.location_kind as PublicBookingManagementRecord["location"],
    locationLabel: row.location_label,
    timeZone: row.time_zone,
    cancelledAt: row.cancelled_at,
  };
};

const parseDto = (value: string | null): PublicBookingManagementDto | null => {
  if (value === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new PublicBookingManagementStoreError("corrupt_management_mutation", "The mutation response is invalid.");
  }
  if (
    !isRecord(parsed) ||
    parsed.schemaVersion !== "tap.calendar.public-management.v1" ||
    typeof parsed.bookingReference !== "string" ||
    typeof parsed.bookingVersion !== "number" ||
    !["confirmed", "pending", "declined", "expired", "cancelled"].includes(String(parsed.status)) ||
    !isRecord(parsed.guest) || typeof parsed.guest.name !== "string" || typeof parsed.guest.email !== "string" ||
    !isRecord(parsed.host) || typeof parsed.host.displayName !== "string" ||
    !isRecord(parsed.event) || typeof parsed.event.title !== "string" ||
    typeof parsed.event.startsAt !== "string" || typeof parsed.event.endsAt !== "string" ||
    typeof parsed.event.durationMinutes !== "number" ||
    !["google-meet", "zoom", "phone", "in-person", "custom"].includes(String(parsed.event.location)) ||
    typeof parsed.event.locationLabel !== "string" ||
    !(parsed.event.approvalExpiresAt === null || typeof parsed.event.approvalExpiresAt === "string") ||
    !isRecord(parsed.actions) || typeof parsed.actions.canCancel !== "boolean" ||
    typeof parsed.actions.canReschedule !== "boolean" ||
    !(parsed.reschedulePage === null || isRecord(parsed.reschedulePage))
  ) {
    throw new PublicBookingManagementStoreError("corrupt_management_mutation", "The mutation response is invalid.");
  }
  const guest = parsed.guest;
  const host = parsed.host;
  const event = parsed.event;
  const actions = parsed.actions;
  let reschedulePage: PublicBookingManagementDto["reschedulePage"] = null;
  if (isRecord(parsed.reschedulePage)) {
    const page = parsed.reschedulePage;
    if (
      typeof page.profileSlug !== "string" || typeof page.eventTypeSlug !== "string" ||
      typeof page.pageRevision !== "string" || typeof page.turnstileSiteKey !== "string" ||
      !isRecord(page.bookingWindow) || typeof page.bookingWindow.firstDate !== "string" ||
      typeof page.bookingWindow.lastDate !== "string"
    ) {
      throw new PublicBookingManagementStoreError("corrupt_management_mutation", "The mutation response is invalid.");
    }
    reschedulePage = {
      profileSlug: page.profileSlug,
      eventTypeSlug: page.eventTypeSlug,
      pageRevision: page.pageRevision,
      bookingWindow: {
        firstDate: page.bookingWindow.firstDate,
        lastDate: page.bookingWindow.lastDate,
      },
      turnstileSiteKey: page.turnstileSiteKey,
    };
  }
  return {
    schemaVersion: "tap.calendar.public-management.v1",
    bookingReference: parsed.bookingReference,
    bookingVersion: parsed.bookingVersion,
    status: parsed.status as PublicBookingManagementDto["status"],
    guest: { name: String(guest.name), email: String(guest.email) },
    host: { displayName: String(host.displayName) },
    event: {
      title: String(event.title),
      startsAt: String(event.startsAt),
      endsAt: String(event.endsAt),
      durationMinutes: Number(event.durationMinutes),
      location: event.location as PublicBookingManagementDto["event"]["location"],
      locationLabel: String(event.locationLabel),
      approvalExpiresAt: event.approvalExpiresAt === null ? null : String(event.approvalExpiresAt),
    },
    actions: {
      canCancel: Boolean(actions.canCancel),
      canReschedule: Boolean(actions.canReschedule),
    },
    reschedulePage,
  };
};

const mutationRow = (value: unknown): MutationRow | null => {
  if (
    !isRecord(value) ||
    typeof value.booking_reference !== "string" ||
    typeof value.request_id !== "string" ||
    typeof value.request_hash !== "string" ||
    typeof value.operation_id !== "string" ||
    typeof value.kind !== "string" ||
    typeof value.expected_version !== "number" ||
    (value.page_revision_id !== null && typeof value.page_revision_id !== "string") ||
    typeof value.from_start_at !== "string" || typeof value.from_end_at !== "string" ||
    (value.to_start_at !== null && typeof value.to_start_at !== "string") ||
    (value.to_end_at !== null && typeof value.to_end_at !== "string") ||
    (value.conflict_calendar_ids_json !== null && typeof value.conflict_calendar_ids_json !== "string") ||
    (value.conflict_start_at !== null && typeof value.conflict_start_at !== "string") ||
    (value.conflict_end_at !== null && typeof value.conflict_end_at !== "string") ||
    typeof value.state !== "string" ||
    (value.response_json !== null && typeof value.response_json !== "string") ||
    (value.rejection_code !== null && typeof value.rejection_code !== "string")
  ) return null;
  return {
    ...value,
    booking_reference: value.booking_reference,
    request_id: value.request_id,
    request_hash: value.request_hash,
    operation_id: value.operation_id,
    kind: value.kind,
    expected_version: value.expected_version,
    page_revision_id: value.page_revision_id,
    from_start_at: value.from_start_at,
    from_end_at: value.from_end_at,
    to_start_at: value.to_start_at,
    to_end_at: value.to_end_at,
    conflict_calendar_ids_json: value.conflict_calendar_ids_json,
    conflict_start_at: value.conflict_start_at,
    conflict_end_at: value.conflict_end_at,
    state: value.state,
    response_json: value.response_json,
    rejection_code: value.rejection_code,
  };
};

const parseCalendarIds = (value: string | null): readonly string[] => {
  if (value === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new PublicBookingManagementStoreError("corrupt_management_mutation", "The conflict set is invalid.");
  }
  if (
    !Array.isArray(parsed) || parsed.length === 0 || parsed.length > 50 ||
    parsed.some(item => typeof item !== "string" || item.length < 1 || item.length > 255) ||
    new Set(parsed).size !== parsed.length
  ) {
    throw new PublicBookingManagementStoreError("corrupt_management_mutation", "The conflict set is invalid.");
  }
  return parsed as string[];
};

const toMutation = (row: MutationRow): PublicBookingManagementMutation => {
  if (
    !UUID_PATTERN.test(row.request_id) ||
    !BASE64URL_PATTERN.test(row.request_hash) || row.request_hash.length < 16 || row.request_hash.length > 128 ||
    !BASE64URL_PATTERN.test(row.operation_id) || row.operation_id.length < 16 || row.operation_id.length > 128 ||
    !["cancel", "reschedule"].includes(row.kind) ||
    !["pending", "uncertain", "committed", "rejected"].includes(row.state) ||
    !Number.isSafeInteger(row.expected_version) || row.expected_version < 1 ||
    (row.rejection_code !== null && !["slot_conflict", "provider_mismatch"].includes(row.rejection_code))
  ) {
    throw new PublicBookingManagementStoreError("corrupt_management_mutation", "The mutation record is invalid.");
  }
  canonicalInstant(row.from_start_at, "from_start_at");
  canonicalInstant(row.from_end_at, "from_end_at");
  if (row.to_start_at !== null) canonicalInstant(row.to_start_at, "to_start_at");
  if (row.to_end_at !== null) canonicalInstant(row.to_end_at, "to_end_at");
  if (row.conflict_start_at !== null) canonicalInstant(row.conflict_start_at, "conflict_start_at");
  if (row.conflict_end_at !== null) canonicalInstant(row.conflict_end_at, "conflict_end_at");
  const conflictCalendarIds = parseCalendarIds(row.conflict_calendar_ids_json);
  if (
    (row.kind === "cancel" && (
      row.page_revision_id !== null || row.to_start_at !== null || row.to_end_at !== null ||
      conflictCalendarIds.length > 0 || row.conflict_start_at !== null || row.conflict_end_at !== null
    )) ||
    (row.kind === "reschedule" && (
      row.page_revision_id === null || row.to_start_at === null || row.to_end_at === null ||
      conflictCalendarIds.length === 0 || row.conflict_start_at === null || row.conflict_end_at === null
    )) ||
    (row.state === "committed") !== (row.response_json !== null) ||
    (row.state === "rejected") !== (row.rejection_code !== null)
  ) {
    throw new PublicBookingManagementStoreError("corrupt_management_mutation", "The mutation record is incomplete.");
  }
  return {
    bookingReference: row.booking_reference,
    requestId: row.request_id,
    requestHash: row.request_hash,
    operationId: row.operation_id,
    kind: row.kind as PublicBookingManagementMutation["kind"],
    expectedVersion: row.expected_version,
    pageRevisionId: row.page_revision_id,
    fromStartsAt: row.from_start_at,
    fromEndsAt: row.from_end_at,
    toStartsAt: row.to_start_at,
    toEndsAt: row.to_end_at,
    conflictCalendarIds,
    conflictStart: row.conflict_start_at,
    conflictEnd: row.conflict_end_at,
    state: row.state as PublicBookingManagementMutation["state"],
    response: parseDto(row.response_json),
    rejectionCode: row.rejection_code as PublicBookingManagementMutation["rejectionCode"],
  };
};

const credentialSelect = `SELECT credentials.booking_reference,
       credentials.workspace_id, credentials.principal_id,
       credentials.token_version, credentials.page_id, credentials.revision_id,
       credentials.destination_calendar_id, credentials.provider_booking_id,
       credentials.provider_operation_id,
       attempts.request_hash AS provider_commit_proof,
       credentials.version, credentials.booking_status,
       credentials.start_at, credentials.end_at,
       credentials.guest_name, credentials.guest_email,
       credentials.approval_expires_at, credentials.organizer_name,
       credentials.event_title, credentials.location_label,
       credentials.location_kind,
       credentials.time_zone, credentials.status, credentials.cancelled_at
  FROM public_booking_management_credentials AS credentials
  INNER JOIN public_booking_attempts AS attempts
    ON attempts.booking_reference = credentials.booking_reference`;

const mutationSelect = `SELECT booking_reference, request_id, request_hash,
       operation_id, kind, expected_version, page_revision_id,
       from_start_at, from_end_at, to_start_at, to_end_at,
       conflict_calendar_ids_json, conflict_start_at, conflict_end_at,
       state, response_json, rejection_code
  FROM public_booking_management_mutations`;

const approvalEmailKind = (
  status: PublicBookingApprovalLifecycleTarget,
): "approval-approved" | "approval-declined" | "approval-expired" => {
  if (status === "confirmed") return "approval-approved";
  return status === "declined" ? "approval-declined" : "approval-expired";
};

const approvalTransitionSuccess = (
  kind: "transitioned" | "existing",
  record: PublicBookingManagementRecord,
  status: PublicBookingApprovalLifecycleTarget,
): PublicBookingApprovalLifecycleTransitionResult => {
  const emailKind = approvalEmailKind(status);
  return {
    kind,
    status,
    bookingVersion: record.version,
    notice: {
      eventKey: `${emailKind}:${record.bookingReference}`,
      bookingReference: record.bookingReference,
      scope: record.scope,
      kind: emailKind,
      recipient: record.guest,
      organizerName: record.organizerName,
      eventTitle: record.eventTitle,
      startsAt: record.startsAt,
      endsAt: record.endsAt,
      timeZone: record.timeZone,
    },
  };
};

export interface D1PublicBookingManagementStoreOptions {
  readonly now?: Clock;
}

/** D1-backed hash lookup and versioned public-booking management ledger. */
export class D1PublicBookingManagementStore implements
  PublicBookingManagementStore,
  PublicBookingApprovalLifecycleStore {
  readonly #database: D1Database;
  readonly #now: Clock;

  constructor(database: D1Database, options: D1PublicBookingManagementStoreOptions = {}) {
    this.#database = database;
    this.#now = options.now ?? Date.now;
  }

  async resolve(token: string): Promise<PublicBookingManagementRecord | null> {
    // Always perform one hash and one indexed query. Malformed and unknown
    // bearer values therefore share the same null result and public error path.
    const plausible = TOKEN_PATTERN.test(token);
    const hash = await publicBookingManagementTokenHash(plausible ? token : UNMATCHABLE_TOKEN);
    const row = credentialRow(await this.#database.prepare(
      `${credentialSelect}
        WHERE credentials.token_hash = ?
          AND credentials.status <> 'revoked'
        LIMIT 1`,
    ).bind(hash).first<Record<string, unknown>>());
    if (!plausible || !row) return null;
    return toRecord(row);
  }

  async transitionApproval(
    input: Parameters<PublicBookingApprovalLifecycleStore["transitionApproval"]>[0],
  ): Promise<PublicBookingApprovalLifecycleTransitionResult> {
    requiredText(input.scope.workspace, "scope.workspace", 1, 255);
    requiredText(input.scope.principal, "scope.principal", 1, 255);
    requiredText(input.providerOperationId, "providerOperationId", 16, 255);
    if (!(["confirmed", "declined", "expired"] as const).includes(input.targetStatus)) {
      throw new PublicBookingManagementStoreError("invalid_store_input", "targetStatus is invalid.");
    }
    const now = canonicalNow(this.#now);
    const results = await this.#database.batch<Record<string, unknown>>([
      this.#database.prepare(
        `UPDATE public_booking_management_credentials
            SET booking_status = ?, version = version + 1, updated_at = ?
          WHERE workspace_id = ? AND principal_id = ?
            AND provider_operation_id = ?
            AND status = 'active' AND booking_status = 'pending'
            AND approval_expires_at IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM public_booking_management_mutations AS open_mutation
               WHERE open_mutation.booking_reference = public_booking_management_credentials.booking_reference
                 AND open_mutation.state IN ('pending', 'uncertain')
            )
            AND (
              (? = 'expired' AND approval_expires_at <= ?) OR
              (? <> 'expired' AND approval_expires_at > ?)
            )`,
      ).bind(
        input.targetStatus,
        now,
        input.scope.workspace,
        input.scope.principal,
        input.providerOperationId,
        input.targetStatus,
        now,
        input.targetStatus,
        now,
      ),
      this.#database.prepare(
        `${credentialSelect}
          WHERE credentials.workspace_id = ? AND credentials.principal_id = ?
            AND credentials.provider_operation_id = ?
          LIMIT 1`,
      ).bind(input.scope.workspace, input.scope.principal, input.providerOperationId),
      this.#database.prepare(
        `SELECT mutations.request_id
           FROM public_booking_management_mutations AS mutations
           INNER JOIN public_booking_management_credentials AS credentials
             ON credentials.booking_reference = mutations.booking_reference
          WHERE credentials.workspace_id = ? AND credentials.principal_id = ?
            AND credentials.provider_operation_id = ?
            AND mutations.state IN ('pending', 'uncertain')
          LIMIT 1`,
      ).bind(input.scope.workspace, input.scope.principal, input.providerOperationId),
    ]);
    const row = credentialRow(results[1]?.results[0]);
    if (!row) return { kind: "not-found" };
    // D1 includes confirmation-history trigger writes in meta.changes.
    // The unique owner/operation predicate still targets at most one credential.
    const changed = Number(results[0]?.meta.changes ?? 0) > 0;
    const currentStatus = row.status === "cancelled"
      ? "cancelled"
      : row.status === "active" && [
        "confirmed",
        "pending",
        "declined",
        "expired",
        "cancelled",
      ].includes(row.booking_status)
        ? row.booking_status as PublicBookingManagementRecord["status"]
        : "unavailable";
    if (row.status === "active" && currentStatus === input.targetStatus) {
      return approvalTransitionSuccess(
        changed ? "transitioned" : "existing",
        toRecord(row),
        input.targetStatus,
      );
    }
    if (row.status === "active" && currentStatus === "pending" && row.approval_expires_at !== null) {
      canonicalInstant(row.approval_expires_at, "approval_expires_at");
      const deadlineAllows = input.targetStatus === "expired"
        ? row.approval_expires_at <= now
        : row.approval_expires_at > now;
      const openMutation = results[2]?.results[0] as OpenMutationRow | undefined;
      if (deadlineAllows && openMutation?.request_id) return { kind: "mutation-conflict" };
      if (!deadlineAllows) {
        return { kind: "deadline-conflict", approvalExpiresAt: row.approval_expires_at };
      }
      throw new PublicBookingManagementStoreError(
        "approval_transition_invariant_failed",
        "The approval lifecycle transition could not be persisted conclusively.",
      );
    }
    return { kind: "status-conflict", currentStatus };
  }

  async findMutation(input: {
    readonly bookingReference: string;
    readonly requestId: string;
  }): Promise<PublicBookingManagementMutation | null> {
    requiredText(input.bookingReference, "bookingReference", 16, 128);
    if (!UUID_PATTERN.test(input.requestId)) {
      throw new PublicBookingManagementStoreError("invalid_store_input", "requestId is invalid.");
    }
    const row = mutationRow(await this.#database.prepare(
      `${mutationSelect} WHERE booking_reference = ? AND request_id = ? LIMIT 1`,
    ).bind(input.bookingReference, input.requestId).first<Record<string, unknown>>());
    return row ? toMutation(row) : null;
  }

  async claimMutation(
    input: Parameters<PublicBookingManagementStore["claimMutation"]>[0],
  ): Promise<PublicBookingManagementMutationClaimResult> {
    this.#validateClaim(input);
    const now = canonicalNow(this.#now);
    const calendarIdsJson = input.kind === "reschedule"
      ? JSON.stringify(input.conflictCalendarIds)
      : null;
    const results = await this.#database.batch<Record<string, unknown>>([
      this.#database.prepare(
        `INSERT OR IGNORE INTO public_booking_management_mutations (
           booking_reference, request_id, request_hash, operation_id, kind,
           expected_version, page_revision_id, from_start_at, from_end_at,
           to_start_at, to_end_at, conflict_calendar_ids_json,
           conflict_start_at, conflict_end_at, state, response_json,
           rejection_code, last_error_code, created_at, updated_at
         )
         SELECT credentials.booking_reference, ?, ?, ?, ?, ?, ?,
                credentials.start_at, credentials.end_at, ?, ?, ?, ?, ?,
                'pending', NULL, NULL, NULL, ?, ?
           FROM public_booking_management_credentials AS credentials
          WHERE credentials.booking_reference = ?
            AND credentials.version = ?
            AND credentials.status = 'active'
            AND (
              (? = 'cancel' AND credentials.booking_status IN ('confirmed', 'pending')) OR
              (? = 'reschedule' AND credentials.booking_status = 'confirmed')
            )
            AND NOT EXISTS (
              SELECT 1 FROM public_booking_management_mutations AS open_mutation
               WHERE open_mutation.booking_reference = credentials.booking_reference
                 AND open_mutation.state IN ('pending', 'uncertain')
            )`,
      ).bind(
        input.requestId,
        input.requestHash,
        input.operationId,
        input.kind,
        input.expectedVersion,
        input.pageRevisionId,
        input.toStartsAt,
        input.toEndsAt,
        calendarIdsJson,
        input.conflictStart,
        input.conflictEnd,
        now,
        now,
        input.booking.bookingReference,
        input.expectedVersion,
        input.kind,
        input.kind,
      ),
      this.#database.prepare(
        `${mutationSelect} WHERE booking_reference = ? AND request_id = ? LIMIT 1`,
      ).bind(input.booking.bookingReference, input.requestId),
      this.#database.prepare(
        `SELECT version, status, booking_status
           FROM public_booking_management_credentials
          WHERE booking_reference = ?`,
      ).bind(input.booking.bookingReference),
      this.#database.prepare(
        `SELECT request_id
           FROM public_booking_management_mutations
          WHERE booking_reference = ? AND state IN ('pending', 'uncertain')
          LIMIT 1`,
      ).bind(input.booking.bookingReference),
    ]);
    const persistedRow = mutationRow(results[1]?.results[0]);
    if (persistedRow) {
      const persisted = toMutation(persistedRow);
      if (
        persisted.requestHash !== input.requestHash ||
        persisted.operationId !== input.operationId ||
        persisted.kind !== input.kind ||
        persisted.expectedVersion !== input.expectedVersion
      ) return { kind: "idempotency-conflict" };
      return Number(results[0]?.meta.changes ?? 0) === 1
        ? { kind: "claimed", mutation: persisted }
        : { kind: "existing", mutation: persisted };
    }
    const aggregate = results[2]?.results[0] as AggregateStateRow | undefined;
    if (
      !aggregate || aggregate.version !== input.expectedVersion || aggregate.status !== "active" ||
      (input.kind === "reschedule" && aggregate.booking_status !== "confirmed") ||
      (input.kind === "cancel" && !["confirmed", "pending"].includes(aggregate.booking_status))
    ) return { kind: "version-conflict" };
    const open = results[3]?.results[0] as OpenMutationRow | undefined;
    if (open?.request_id) return { kind: "mutation-in-progress" };
    throw new PublicBookingManagementStoreError(
      "management_claim_invariant_failed",
      "The management mutation could not be claimed conclusively.",
    );
  }

  async markUncertain(input: Parameters<PublicBookingManagementStore["markUncertain"]>[0]): Promise<void> {
    requiredText(input.errorCode, "errorCode", 1, 128);
    const now = canonicalNow(this.#now);
    const results = await this.#database.batch<Record<string, unknown>>([
      this.#database.prepare(
        `UPDATE public_booking_management_mutations
            SET state = 'uncertain', last_error_code = ?, updated_at = ?
          WHERE booking_reference = ? AND request_id = ? AND request_hash = ?
            AND state IN ('pending', 'uncertain')`,
      ).bind(input.errorCode, now, input.bookingReference, input.requestId, input.requestHash),
      this.#database.prepare(
        `${mutationSelect} WHERE booking_reference = ? AND request_id = ? LIMIT 1`,
      ).bind(input.bookingReference, input.requestId),
    ]);
    const row = mutationRow(results[1]?.results[0]);
    if (!row || row.request_hash !== input.requestHash || row.state !== "uncertain") {
      throw new PublicBookingManagementStoreError("management_mutation_cas_failed", "The mutation could not be marked uncertain.");
    }
  }

  async markRejected(input: Parameters<PublicBookingManagementStore["markRejected"]>[0]): Promise<void> {
    const now = canonicalNow(this.#now);
    const results = await this.#database.batch<Record<string, unknown>>([
      this.#database.prepare(
        `UPDATE public_booking_management_mutations
            SET state = 'rejected', rejection_code = ?, response_json = NULL,
                last_error_code = NULL, updated_at = ?
          WHERE booking_reference = ? AND request_id = ? AND request_hash = ?
            AND state IN ('pending', 'uncertain', 'rejected')`,
      ).bind(input.rejectionCode, now, input.bookingReference, input.requestId, input.requestHash),
      this.#database.prepare(
        `${mutationSelect} WHERE booking_reference = ? AND request_id = ? LIMIT 1`,
      ).bind(input.bookingReference, input.requestId),
    ]);
    const row = mutationRow(results[1]?.results[0]);
    if (
      !row || row.request_hash !== input.requestHash || row.state !== "rejected" ||
      row.rejection_code !== input.rejectionCode
    ) {
      throw new PublicBookingManagementStoreError("management_mutation_cas_failed", "The mutation could not be rejected.");
    }
  }

  async commitCancellation(
    input: Parameters<PublicBookingManagementStore["commitCancellation"]>[0],
  ): Promise<PublicBookingManagementRecord> {
    this.#validateCommit(input.booking, input.mutation, input.response, "cancel");
    const now = canonicalNow(this.#now);
    const responseJson = JSON.stringify(input.response);
    const results = await this.#database.batch<Record<string, unknown>>([
      this.#database.prepare(
        `UPDATE public_booking_management_credentials
            SET version = version + 1, status = 'cancelled',
                booking_status = 'cancelled', cancelled_at = ?, updated_at = ?
          WHERE booking_reference = ? AND version = ? AND status = 'active'
            AND provider_booking_id = ? AND provider_operation_id = ?
            AND start_at = ? AND end_at = ?`,
      ).bind(
        now,
        now,
        input.booking.bookingReference,
        input.booking.version,
        input.booking.providerBookingId,
        input.booking.providerOperationId,
        input.booking.startsAt,
        input.booking.endsAt,
      ),
      this.#database.prepare(
        `UPDATE public_booking_management_mutations
            SET state = 'committed', response_json = ?, rejection_code = NULL,
                last_error_code = NULL, updated_at = ?
          WHERE booking_reference = ? AND request_id = ? AND request_hash = ?
            AND expected_version = ? AND state IN ('pending', 'uncertain')
            AND EXISTS (
              SELECT 1 FROM public_booking_management_credentials AS credentials
               WHERE credentials.booking_reference = public_booking_management_mutations.booking_reference
                 AND credentials.version = ? AND credentials.status = 'cancelled'
            )`,
      ).bind(
        responseJson,
        now,
        input.booking.bookingReference,
        input.mutation.requestId,
        input.mutation.requestHash,
        input.booking.version,
        input.booking.version + 1,
      ),
      this.#credentialByReference(input.booking.bookingReference),
      this.#database.prepare(
        `${mutationSelect} WHERE booking_reference = ? AND request_id = ? LIMIT 1`,
      ).bind(input.booking.bookingReference, input.mutation.requestId),
    ]);
    return this.#validateCommittedResults(results, input, "cancel");
  }

  async commitReschedule(
    input: Parameters<PublicBookingManagementStore["commitReschedule"]>[0],
  ): Promise<PublicBookingManagementRecord> {
    this.#validateCommit(input.booking, input.mutation, input.response, "reschedule");
    requiredText(input.currentPageRevisionId, "currentPageRevisionId", 8, 255);
    const newStart = input.mutation.toStartsAt!;
    const newEnd = input.mutation.toEndsAt!;
    const now = canonicalNow(this.#now);
    const responseJson = JSON.stringify(input.response);
    const results = await this.#database.batch<Record<string, unknown>>([
      this.#database.prepare(
        `UPDATE public_booking_management_credentials
            SET version = version + 1, revision_id = ?, start_at = ?, end_at = ?,
                updated_at = ?
          WHERE booking_reference = ? AND version = ? AND status = 'active'
            AND booking_status = 'confirmed' AND destination_calendar_id = ?
            AND provider_booking_id = ? AND provider_operation_id = ?
            AND start_at = ? AND end_at = ?`,
      ).bind(
        input.currentPageRevisionId,
        newStart,
        newEnd,
        now,
        input.booking.bookingReference,
        input.booking.version,
        input.booking.destinationCalendarId,
        input.booking.providerBookingId,
        input.booking.providerOperationId,
        input.booking.startsAt,
        input.booking.endsAt,
      ),
      this.#database.prepare(
        `UPDATE public_booking_management_mutations
            SET state = 'committed', response_json = ?, rejection_code = NULL,
                last_error_code = NULL, updated_at = ?
          WHERE booking_reference = ? AND request_id = ? AND request_hash = ?
            AND expected_version = ? AND page_revision_id = ?
            AND state IN ('pending', 'uncertain')
            AND EXISTS (
              SELECT 1 FROM public_booking_management_credentials AS credentials
               WHERE credentials.booking_reference = public_booking_management_mutations.booking_reference
                 AND credentials.version = ? AND credentials.status = 'active'
                 AND credentials.start_at = ? AND credentials.end_at = ?
            )`,
      ).bind(
        responseJson,
        now,
        input.booking.bookingReference,
        input.mutation.requestId,
        input.mutation.requestHash,
        input.booking.version,
        input.currentPageRevisionId,
        input.booking.version + 1,
        newStart,
        newEnd,
      ),
      this.#credentialByReference(input.booking.bookingReference),
      this.#database.prepare(
        `${mutationSelect} WHERE booking_reference = ? AND request_id = ? LIMIT 1`,
      ).bind(input.booking.bookingReference, input.mutation.requestId),
    ]);
    return this.#validateCommittedResults(results, input, "reschedule");
  }

  #credentialByReference(bookingReference: string): D1PreparedStatement {
    return this.#database.prepare(
      `${credentialSelect} WHERE credentials.booking_reference = ? LIMIT 1`,
    ).bind(bookingReference);
  }

  #validateClaim(input: Parameters<PublicBookingManagementStore["claimMutation"]>[0]): void {
    requiredText(input.booking.bookingReference, "bookingReference", 16, 128);
    if (!UUID_PATTERN.test(input.requestId)) {
      throw new PublicBookingManagementStoreError("invalid_store_input", "requestId is invalid.");
    }
    requiredText(input.requestHash, "requestHash", 16, 128);
    requiredText(input.operationId, "operationId", 16, 128);
    if (!BASE64URL_PATTERN.test(input.requestHash) || !BASE64URL_PATTERN.test(input.operationId)) {
      throw new PublicBookingManagementStoreError("invalid_store_input", "The mutation hashes are invalid.");
    }
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw new PublicBookingManagementStoreError("invalid_store_input", "expectedVersion is invalid.");
    }
    if (input.expectedVersion !== input.booking.version) {
      throw new PublicBookingManagementStoreError("invalid_store_input", "The mutation version is inconsistent.");
    }
    if (input.kind === "cancel") {
      if (
        input.pageRevisionId !== null || input.toStartsAt !== null || input.toEndsAt !== null ||
        input.conflictCalendarIds.length > 0 || input.conflictStart !== null || input.conflictEnd !== null
      ) throw new PublicBookingManagementStoreError("invalid_store_input", "The cancellation claim is invalid.");
      return;
    }
    if (
      !input.pageRevisionId || !input.toStartsAt || !input.toEndsAt ||
      input.conflictCalendarIds.length === 0 || !input.conflictStart || !input.conflictEnd ||
      new Set(input.conflictCalendarIds).size !== input.conflictCalendarIds.length ||
      !input.conflictCalendarIds.includes(input.booking.destinationCalendarId)
    ) throw new PublicBookingManagementStoreError("invalid_store_input", "The reschedule claim is invalid.");
    requiredText(input.pageRevisionId, "pageRevisionId", 8, 255);
    canonicalInstant(input.toStartsAt, "toStartsAt");
    canonicalInstant(input.toEndsAt, "toEndsAt");
    canonicalInstant(input.conflictStart, "conflictStart");
    canonicalInstant(input.conflictEnd, "conflictEnd");
    for (const id of input.conflictCalendarIds) requiredText(id, "conflictCalendarId", 1, 255);
    if (
      Date.parse(input.toEndsAt) <= Date.parse(input.toStartsAt) ||
      Date.parse(input.conflictStart) > Date.parse(input.toStartsAt) ||
      Date.parse(input.conflictEnd) < Date.parse(input.toEndsAt)
    ) throw new PublicBookingManagementStoreError("invalid_store_input", "The reschedule interval is invalid.");
  }

  #validateCommit(
    booking: PublicBookingManagementRecord,
    mutation: PublicBookingManagementMutation,
    response: PublicBookingManagementDto,
    kind: "cancel" | "reschedule",
  ): void {
    if (
      mutation.bookingReference !== booking.bookingReference ||
      mutation.kind !== kind || mutation.expectedVersion !== booking.version ||
      !["pending", "uncertain"].includes(mutation.state) ||
      response.bookingReference !== booking.bookingReference ||
      response.bookingVersion !== booking.version + 1 ||
      response.status !== (kind === "cancel" ? "cancelled" : "confirmed") ||
      response.event.startsAt !== (kind === "cancel" ? booking.startsAt : mutation.toStartsAt) ||
      response.event.endsAt !== (kind === "cancel" ? booking.endsAt : mutation.toEndsAt)
    ) {
      throw new PublicBookingManagementStoreError("invalid_store_input", "The mutation commit is invalid.");
    }
  }

  #validateCommittedResults(
    results: readonly D1Result<Record<string, unknown>>[],
    input: {
      readonly booking: PublicBookingManagementRecord;
      readonly mutation: PublicBookingManagementMutation;
      readonly response: PublicBookingManagementDto;
    },
    kind: "cancel" | "reschedule",
  ): PublicBookingManagementRecord {
    const recordRow = credentialRow(results[2]?.results[0]);
    const mutation = mutationRow(results[3]?.results[0]);
    const record = recordRow ? toRecord(recordRow) : null;
    const persisted = mutation ? toMutation(mutation) : null;
    if (
      !record || !persisted ||
      record.version !== input.booking.version + 1 ||
      record.status !== (kind === "cancel" ? "cancelled" : "confirmed") ||
      persisted.state !== "committed" ||
      persisted.requestHash !== input.mutation.requestHash ||
      JSON.stringify(persisted.response) !== JSON.stringify(input.response)
    ) {
      throw new PublicBookingManagementStoreError(
        "management_mutation_cas_failed",
        "The management mutation could not be committed conclusively.",
      );
    }
    return record;
  }
}
