import type {
  PublicBookingAttempt,
  PublicBookingAttemptClaim,
  PublicBookingAttemptClaimResult,
  PublicBookingAttemptStore,
  PublicBookingManagementTokenIssuer,
  PublicBookingResult,
  PublicBookingSerializationBoundary,
} from "./public-booking-create";

const MANAGEMENT_TOKEN_DOMAIN = "tap.calendar.public-management.v1";
const MANAGEMENT_TOKEN_PREFIX = "tapm_v1_";
const TEXT_ENCODER = new TextEncoder();
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const BOOKING_REFERENCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;
const ISO_INSTANT_MIN_LENGTH = 20;
const ISO_INSTANT_MAX_LENGTH = 40;

type Clock = () => number;

interface AttemptRow extends Record<string, unknown> {
  readonly idempotency_key: string;
  readonly request_hash: string;
  readonly provider_operation_id: string;
  readonly booking_reference: string;
  readonly revision_id: string;
  readonly start_at: string;
  readonly end_at: string;
  readonly guest_name: string;
  readonly guest_email: string;
  readonly approval_expires_at: string | null;
  readonly state: string;
  readonly response_json: string | null;
  readonly rejection_code: string | null;
}

interface ProofUseRow extends Record<string, unknown> {
  readonly idempotency_key: string;
}

interface StoredPublicBookingResult {
  readonly schemaVersion: "tap.calendar.public-booking.v1";
  readonly status: "confirmed" | "pending";
  readonly bookingReference: string;
  readonly startsAt: string;
  readonly endsAt: string;
}

interface ManagementCredentialRow extends Record<string, unknown> {
  readonly booking_reference: string;
  readonly workspace_id: string;
  readonly principal_id: string;
  readonly token_version: number;
  readonly token_hash: string;
  readonly page_id: string;
  readonly revision_id: string;
  readonly provider_booking_id: string;
  readonly provider_operation_id: string;
  readonly start_at: string;
  readonly end_at: string;
  readonly guest_name: string;
  readonly guest_email: string;
  readonly approval_expires_at: string | null;
  readonly status: string;
  readonly destination_calendar_id: string;
  readonly organizer_name: string;
  readonly event_title: string;
  readonly location_kind: string;
  readonly location_label: string;
  readonly time_zone: string;
  readonly booking_status: string;
  readonly version: number;
}

export class PublicBookingStoreError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PublicBookingStoreError";
    this.code = code;
  }
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const requiredText = (
  value: string,
  field: string,
  minimum: number,
  maximum: number,
): string => {
  if (value.length < minimum || value.length > maximum) {
    throw new PublicBookingStoreError("invalid_store_input", `${field} is invalid.`);
  }
  return value;
};

const canonicalInstant = (value: string, field: string): string => {
  requiredText(value, field, ISO_INSTANT_MIN_LENGTH, ISO_INSTANT_MAX_LENGTH);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new PublicBookingStoreError("invalid_store_input", `${field} is invalid.`);
  }
  return value;
};

const canonicalNow = (clock: Clock): string => {
  const now = clock();
  if (!Number.isFinite(now)) {
    throw new PublicBookingStoreError("invalid_store_clock", "The booking store clock is invalid.");
  }
  return new Date(now).toISOString();
};

const base64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
};

const sha256 = async (value: string): Promise<string> =>
  base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", TEXT_ENCODER.encode(value))));

const validateManagementSecret = (secret: string): void => {
  if (TEXT_ENCODER.encode(secret).byteLength < 32) {
    throw new PublicBookingStoreError(
      "management_secret_invalid",
      "The public booking management secret must contain at least 32 bytes.",
    );
  }
};

const canonicalManagementOrigin = (value: string): string => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PublicBookingStoreError("management_origin_invalid", "The management origin is invalid.");
  }
  if (
    url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new PublicBookingStoreError("management_origin_invalid", "The management origin is invalid.");
  }
  return url.origin;
};

const importManagementKey = (secret: string): Promise<CryptoKey> => crypto.subtle.importKey(
  "raw",
  TEXT_ENCODER.encode(secret),
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["sign"],
);

const deriveManagementToken = async (
  key: Promise<CryptoKey>,
  workspace: string,
  principal: string,
  bookingReference: string,
): Promise<string> => {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await key,
    TEXT_ENCODER.encode(
      `${MANAGEMENT_TOKEN_DOMAIN}\u0000${workspace}\u0000${principal}\u0000${bookingReference}`,
    ),
  );
  return `${MANAGEMENT_TOKEN_PREFIX}${base64Url(new Uint8Array(signature))}`;
};

const randomBookingReference = (): string => {
  const entropy = new Uint8Array(24);
  crypto.getRandomValues(entropy);
  return `pb_${base64Url(entropy)}`;
};

const claimScope = (input: PublicBookingAttemptClaim): void => {
  requiredText(input.scope.workspace, "workspace", 1, 255);
  requiredText(input.scope.principal, "principal", 1, 255);
  requiredText(input.idempotencyKey, "idempotencyKey", 16, 255);
  requiredText(input.requestHash, "requestHash", 16, 128);
  requiredText(input.slotProofFingerprint, "slotProofFingerprint", 16, 128);
  requiredText(input.providerOperationId, "providerOperationId", 16, 255);
  requiredText(input.revisionId, "revisionId", 8, 255);
  canonicalInstant(input.startsAt, "startsAt");
  canonicalInstant(input.endsAt, "endsAt");
  requiredText(input.guest.name, "guest.name", 1, 160);
  requiredText(input.guest.email, "guest.email", 3, 320);
  if (input.approvalExpiresAt !== null) {
    canonicalInstant(input.approvalExpiresAt, "approvalExpiresAt");
  }
  if (
    !BASE64URL_PATTERN.test(input.requestHash) ||
    !BASE64URL_PATTERN.test(input.slotProofFingerprint) ||
    Date.parse(input.endsAt) <= Date.parse(input.startsAt) ||
    input.guest.name.trim() !== input.guest.name ||
    input.guest.email.trim().toLowerCase() !== input.guest.email ||
    !input.guest.email.includes("@")
  ) {
    throw new PublicBookingStoreError("invalid_store_input", "The booking claim is invalid.");
  }
};

const attemptRow = (value: unknown): AttemptRow | null => {
  if (
    !isRecord(value) ||
    typeof value.idempotency_key !== "string" ||
    typeof value.request_hash !== "string" ||
    typeof value.provider_operation_id !== "string" ||
    typeof value.booking_reference !== "string" ||
    typeof value.revision_id !== "string" ||
    typeof value.start_at !== "string" ||
    typeof value.end_at !== "string" ||
    typeof value.guest_name !== "string" ||
    typeof value.guest_email !== "string" ||
    (value.approval_expires_at !== null && typeof value.approval_expires_at !== "string") ||
    typeof value.state !== "string" ||
    (value.response_json !== null && typeof value.response_json !== "string") ||
    (value.rejection_code !== null && typeof value.rejection_code !== "string")
  ) {
    return null;
  }
  return {
    ...value,
    idempotency_key: value.idempotency_key,
    request_hash: value.request_hash,
    provider_operation_id: value.provider_operation_id,
    booking_reference: value.booking_reference,
    revision_id: value.revision_id,
    start_at: value.start_at,
    end_at: value.end_at,
    guest_name: value.guest_name,
    guest_email: value.guest_email,
    approval_expires_at: value.approval_expires_at,
    state: value.state,
    response_json: value.response_json,
    rejection_code: value.rejection_code,
  };
};

const proofUseRow = (value: unknown): ProofUseRow | null => {
  if (!isRecord(value) || typeof value.idempotency_key !== "string") return null;
  return { ...value, idempotency_key: value.idempotency_key };
};

const publicBookingResult = (value: unknown): PublicBookingResult | null => {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 6 ||
    value.schemaVersion !== "tap.calendar.public-booking.v1" ||
    (value.status !== "confirmed" && value.status !== "pending") ||
    typeof value.bookingReference !== "string" ||
    typeof value.startsAt !== "string" ||
    typeof value.endsAt !== "string" ||
    typeof value.managementUrl !== "string"
  ) {
    return null;
  }
  return {
    schemaVersion: "tap.calendar.public-booking.v1",
    status: value.status,
    bookingReference: value.bookingReference,
    startsAt: value.startsAt,
    endsAt: value.endsAt,
    managementUrl: value.managementUrl,
  };
};

const parseStoredResponse = (value: string | null): StoredPublicBookingResult | null => {
  if (value === null) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !isRecord(parsed) ||
      Object.keys(parsed).length !== 5 ||
      parsed.schemaVersion !== "tap.calendar.public-booking.v1" ||
      (parsed.status !== "confirmed" && parsed.status !== "pending") ||
      typeof parsed.bookingReference !== "string" ||
      typeof parsed.startsAt !== "string" ||
      typeof parsed.endsAt !== "string"
    ) {
      throw new Error("Invalid public booking response.");
    }
    return {
      schemaVersion: "tap.calendar.public-booking.v1",
      status: parsed.status,
      bookingReference: parsed.bookingReference,
      startsAt: parsed.startsAt,
      endsAt: parsed.endsAt,
    };
  } catch {
    throw new PublicBookingStoreError(
      "corrupt_booking_attempt",
      "The stored public booking response is invalid.",
    );
  }
};

const toAttempt = (row: AttemptRow, managementUrl: string | null): PublicBookingAttempt => {
  if (
    !BOOKING_REFERENCE_PATTERN.test(row.booking_reference) ||
    !["pending", "uncertain", "committed", "rejected"].includes(row.state) ||
    (row.rejection_code !== null && row.rejection_code !== "slot_conflict") ||
    row.guest_name.length < 1 || row.guest_name.length > 160 ||
    row.guest_email.length < 3 || row.guest_email.length > 320 ||
    row.guest_name.trim() !== row.guest_name ||
    row.guest_email.trim().toLowerCase() !== row.guest_email ||
    !row.guest_email.includes("@") ||
    (row.approval_expires_at !== null && (
      !Number.isFinite(Date.parse(row.approval_expires_at)) ||
      new Date(Date.parse(row.approval_expires_at)).toISOString() !== row.approval_expires_at
    ))
  ) {
    throw new PublicBookingStoreError("corrupt_booking_attempt", "The stored booking attempt is invalid.");
  }
  const response = parseStoredResponse(row.response_json);
  if (
    (row.state === "committed") !== (response !== null) ||
    (row.state === "rejected") !== (row.rejection_code === "slot_conflict") ||
    (response !== null && (
      managementUrl === null ||
      response.bookingReference !== row.booking_reference ||
      response.startsAt !== row.start_at ||
      response.endsAt !== row.end_at ||
      response.status !== (row.approval_expires_at === null ? "confirmed" : "pending")
    ))
  ) {
    throw new PublicBookingStoreError("corrupt_booking_attempt", "The stored booking attempt is incomplete.");
  }
  return {
    idempotencyKey: row.idempotency_key,
    requestHash: row.request_hash,
    providerOperationId: row.provider_operation_id,
    bookingReference: row.booking_reference,
    guest: { name: row.guest_name, email: row.guest_email },
    approvalExpiresAt: row.approval_expires_at,
    state: row.state as PublicBookingAttempt["state"],
    response: response === null || managementUrl === null
      ? null
      : { ...response, managementUrl },
    rejectionCode: row.rejection_code,
  };
};

const sameClaim = (row: AttemptRow, input: PublicBookingAttemptClaim): boolean =>
  row.request_hash === input.requestHash &&
  row.provider_operation_id === input.providerOperationId &&
  row.revision_id === input.revisionId &&
  row.start_at === input.startsAt &&
  row.end_at === input.endsAt &&
  row.guest_name === input.guest.name &&
  row.guest_email === input.guest.email;

export interface D1PublicBookingAttemptStoreOptions {
  readonly managementSecret: string;
  readonly managementOrigin: string;
  readonly now?: Clock;
  readonly bookingReference?: () => string;
}

/** D1 implementation of the anonymous booking attempt/idempotency ledger. */
export class D1PublicBookingAttemptStore implements PublicBookingAttemptStore {
  readonly #database: D1Database;
  readonly #now: Clock;
  readonly #bookingReference: () => string;
  readonly #managementOrigin: string;
  readonly #managementKey: Promise<CryptoKey>;

  constructor(database: D1Database, options: D1PublicBookingAttemptStoreOptions) {
    validateManagementSecret(options.managementSecret);
    this.#database = database;
    this.#now = options.now ?? Date.now;
    this.#bookingReference = options.bookingReference ?? randomBookingReference;
    this.#managementOrigin = canonicalManagementOrigin(options.managementOrigin);
    this.#managementKey = importManagementKey(options.managementSecret);
  }

  async claim(input: PublicBookingAttemptClaim): Promise<PublicBookingAttemptClaimResult> {
    claimScope(input);
    const now = canonicalNow(this.#now);
    const bookingReference = this.#bookingReference();
    if (!BOOKING_REFERENCE_PATTERN.test(bookingReference)) {
      throw new PublicBookingStoreError(
        "invalid_booking_reference",
        "The booking reference generator returned an invalid value.",
      );
    }

    // D1 batches are SQLite transactions. The first conditional INSERT refuses
    // to create an orphan attempt when the proof already belongs to another
    // request; the second attaches the proof only to an exactly matching row.
    const results = await this.#database.batch<Record<string, unknown>>([
      this.#database.prepare(
        `INSERT OR IGNORE INTO public_booking_attempts (
           workspace_id, principal_id, idempotency_key, request_hash,
           provider_operation_id, booking_reference, revision_id, start_at,
           end_at, guest_name, guest_email, approval_expires_at, state,
           response_json, rejection_code, last_error_code,
           created_at, updated_at
         )
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                'pending', NULL, NULL, NULL, ?, ?
          WHERE NOT EXISTS (
            SELECT 1
              FROM public_booking_slot_proof_uses
             WHERE workspace_id = ? AND principal_id = ?
               AND slot_proof_fingerprint = ? AND idempotency_key <> ?
          )`,
      ).bind(
        input.scope.workspace,
        input.scope.principal,
        input.idempotencyKey,
        input.requestHash,
        input.providerOperationId,
        bookingReference,
        input.revisionId,
        input.startsAt,
        input.endsAt,
        input.guest.name,
        input.guest.email,
        input.approvalExpiresAt,
        now,
        now,
        input.scope.workspace,
        input.scope.principal,
        input.slotProofFingerprint,
        input.idempotencyKey,
      ),
      this.#database.prepare(
        `INSERT OR IGNORE INTO public_booking_slot_proof_uses (
           workspace_id, principal_id, slot_proof_fingerprint,
           idempotency_key, created_at
         )
         SELECT ?, ?, ?, ?, ?
          WHERE EXISTS (
            SELECT 1
              FROM public_booking_attempts
             WHERE workspace_id = ? AND principal_id = ? AND idempotency_key = ?
               AND request_hash = ? AND provider_operation_id = ?
               AND revision_id = ? AND start_at = ? AND end_at = ?
               AND guest_name = ? AND guest_email = ?
          )`,
      ).bind(
        input.scope.workspace,
        input.scope.principal,
        input.slotProofFingerprint,
        input.idempotencyKey,
        now,
        input.scope.workspace,
        input.scope.principal,
        input.idempotencyKey,
        input.requestHash,
        input.providerOperationId,
        input.revisionId,
        input.startsAt,
        input.endsAt,
        input.guest.name,
        input.guest.email,
      ),
      this.#database.prepare(
        `SELECT idempotency_key, request_hash, provider_operation_id,
                booking_reference, revision_id, start_at, end_at,
                guest_name, guest_email, approval_expires_at, state,
                response_json, rejection_code
           FROM public_booking_attempts
          WHERE workspace_id = ? AND principal_id = ? AND idempotency_key = ?`,
      ).bind(input.scope.workspace, input.scope.principal, input.idempotencyKey),
      this.#database.prepare(
        `SELECT idempotency_key
           FROM public_booking_slot_proof_uses
          WHERE workspace_id = ? AND principal_id = ?
            AND slot_proof_fingerprint = ?`,
      ).bind(input.scope.workspace, input.scope.principal, input.slotProofFingerprint),
    ]);

    const persisted = attemptRow(results[2]?.results[0]);
    const proof = proofUseRow(results[3]?.results[0]);
    if (persisted && persisted.request_hash !== input.requestHash) {
      return { kind: "idempotency-conflict" };
    }
    if (proof && proof.idempotency_key !== input.idempotencyKey) {
      return { kind: "slot-proof-replayed" };
    }
    if (!persisted || !proof || !sameClaim(persisted, input)) {
      throw new PublicBookingStoreError(
        "booking_claim_invariant_failed",
        "The public booking claim could not be persisted conclusively.",
      );
    }
    const attempt = await this.#hydrateAttempt(
      persisted,
      input.scope.workspace,
      input.scope.principal,
    );
    return Number(results[0]?.meta.changes ?? 0) === 1
      ? { kind: "claimed", attempt }
      : { kind: "existing", attempt };
  }

  async markUncertain(input: Parameters<PublicBookingAttemptStore["markUncertain"]>[0]): Promise<void> {
    requiredText(input.errorCode, "errorCode", 1, 128);
    const now = canonicalNow(this.#now);
    const results = await this.#database.batch<Record<string, unknown>>([
      this.#database.prepare(
        `UPDATE public_booking_attempts
            SET state = 'uncertain', last_error_code = ?, updated_at = ?
          WHERE workspace_id = ? AND principal_id = ? AND idempotency_key = ?
            AND request_hash = ? AND state IN ('pending', 'uncertain')`,
      ).bind(
        input.errorCode,
        now,
        input.scope.workspace,
        input.scope.principal,
        input.idempotencyKey,
        input.requestHash,
      ),
      this.#attemptSelect(input.scope.workspace, input.scope.principal, input.idempotencyKey),
    ]);
    const row = attemptRow(results[1]?.results[0]);
    if (!row || row.request_hash !== input.requestHash || row.state !== "uncertain") {
      throw new PublicBookingStoreError(
        "booking_attempt_cas_failed",
        "The booking attempt could not be marked uncertain.",
      );
    }
  }

  async markRejected(input: Parameters<PublicBookingAttemptStore["markRejected"]>[0]): Promise<void> {
    const now = canonicalNow(this.#now);
    const results = await this.#database.batch<Record<string, unknown>>([
      this.#database.prepare(
        `UPDATE public_booking_attempts
            SET state = 'rejected', response_json = NULL, rejection_code = ?,
                last_error_code = NULL, updated_at = ?
          WHERE workspace_id = ? AND principal_id = ? AND idempotency_key = ?
            AND request_hash = ? AND state IN ('pending', 'uncertain')`,
      ).bind(
        input.rejectionCode,
        now,
        input.scope.workspace,
        input.scope.principal,
        input.idempotencyKey,
        input.requestHash,
      ),
      this.#attemptSelect(input.scope.workspace, input.scope.principal, input.idempotencyKey),
    ]);
    const row = attemptRow(results[1]?.results[0]);
    if (
      !row || row.request_hash !== input.requestHash ||
      row.state !== "rejected" || row.rejection_code !== input.rejectionCode
    ) {
      throw new PublicBookingStoreError(
        "booking_attempt_cas_failed",
        "The booking attempt could not be rejected.",
      );
    }
  }

  async markCommitted(input: Parameters<PublicBookingAttemptStore["markCommitted"]>[0]): Promise<void> {
    const response = publicBookingResult(input.response);
    if (!response) {
      throw new PublicBookingStoreError("invalid_store_input", "The booking response is invalid.");
    }
    const token = await deriveManagementToken(
      this.#managementKey,
      input.scope.workspace,
      input.scope.principal,
      response.bookingReference,
    );
    const expectedManagementUrl = new URL(
      `/manage#${token}`,
      this.#managementOrigin,
    ).toString();
    if (response.managementUrl !== expectedManagementUrl) {
      throw new PublicBookingStoreError(
        "invalid_store_input",
        "The booking response management URL is invalid.",
      );
    }
    // Deliberately omit managementUrl: it contains the bearer token. The URL is
    // rehydrated from the HMAC secret when an idempotent replay reads this row.
    const responseJson = JSON.stringify({
      schemaVersion: response.schemaVersion,
      status: response.status,
      bookingReference: response.bookingReference,
      startsAt: response.startsAt,
      endsAt: response.endsAt,
    } satisfies StoredPublicBookingResult);
    const now = canonicalNow(this.#now);
    const results = await this.#database.batch<Record<string, unknown>>([
      this.#database.prepare(
        `UPDATE public_booking_attempts
            SET state = 'committed', response_json = ?, rejection_code = NULL,
                last_error_code = NULL, updated_at = ?
          WHERE workspace_id = ? AND principal_id = ? AND idempotency_key = ?
            AND request_hash = ? AND booking_reference = ?
            AND start_at = ? AND end_at = ?
            AND state IN ('pending', 'uncertain')`,
      ).bind(
        responseJson,
        now,
        input.scope.workspace,
        input.scope.principal,
        input.idempotencyKey,
        input.requestHash,
        response.bookingReference,
        response.startsAt,
        response.endsAt,
      ),
      this.#attemptSelect(input.scope.workspace, input.scope.principal, input.idempotencyKey),
    ]);
    const row = attemptRow(results[1]?.results[0]);
    const stored = row
      ? await this.#hydrateAttempt(row, input.scope.workspace, input.scope.principal)
      : null;
    if (
      !stored || stored.requestHash !== input.requestHash || stored.state !== "committed" ||
      JSON.stringify(stored.response) !== JSON.stringify(response)
    ) {
      throw new PublicBookingStoreError(
        "booking_attempt_cas_failed",
        "The booking attempt could not be committed.",
      );
    }
  }

  async #hydrateAttempt(
    row: AttemptRow,
    workspace: string,
    principal: string,
  ): Promise<PublicBookingAttempt> {
    if (row.response_json === null) return toAttempt(row, null);
    const token = await deriveManagementToken(
      this.#managementKey,
      workspace,
      principal,
      row.booking_reference,
    );
    const managementUrl = new URL(
      `/manage#${token}`,
      this.#managementOrigin,
    ).toString();
    return toAttempt(row, managementUrl);
  }

  #attemptSelect(workspace: string, principal: string, idempotencyKey: string): D1PreparedStatement {
    return this.#database.prepare(
      `SELECT idempotency_key, request_hash, provider_operation_id,
              booking_reference, revision_id, start_at, end_at,
              guest_name, guest_email, approval_expires_at, state,
              response_json, rejection_code
         FROM public_booking_attempts
        WHERE workspace_id = ? AND principal_id = ? AND idempotency_key = ?`,
    ).bind(workspace, principal, idempotencyKey);
  }
}

export interface D1PublicBookingManagementTokenIssuerOptions {
  readonly secret: string;
  readonly now?: Clock;
}

const credentialRow = (value: unknown): ManagementCredentialRow | null => {
  if (
    !isRecord(value) ||
    typeof value.booking_reference !== "string" ||
    typeof value.workspace_id !== "string" ||
    typeof value.principal_id !== "string" ||
    typeof value.token_version !== "number" ||
    typeof value.token_hash !== "string" ||
    typeof value.page_id !== "string" ||
    typeof value.revision_id !== "string" ||
    typeof value.provider_booking_id !== "string" ||
    typeof value.provider_operation_id !== "string" ||
    typeof value.start_at !== "string" ||
    typeof value.end_at !== "string" ||
    typeof value.guest_name !== "string" ||
    typeof value.guest_email !== "string" ||
    (value.approval_expires_at !== null && typeof value.approval_expires_at !== "string") ||
    typeof value.status !== "string" ||
    typeof value.destination_calendar_id !== "string" ||
    typeof value.organizer_name !== "string" ||
    typeof value.event_title !== "string" ||
    typeof value.location_kind !== "string" ||
    typeof value.location_label !== "string" ||
    typeof value.time_zone !== "string" ||
    typeof value.booking_status !== "string" ||
    typeof value.version !== "number"
  ) {
    return null;
  }
  return {
    ...value,
    booking_reference: value.booking_reference,
    workspace_id: value.workspace_id,
    principal_id: value.principal_id,
    token_version: value.token_version,
    token_hash: value.token_hash,
    page_id: value.page_id,
    revision_id: value.revision_id,
    provider_booking_id: value.provider_booking_id,
    provider_operation_id: value.provider_operation_id,
    start_at: value.start_at,
    end_at: value.end_at,
    guest_name: value.guest_name,
    guest_email: value.guest_email,
    approval_expires_at: value.approval_expires_at,
    status: value.status,
    destination_calendar_id: value.destination_calendar_id,
    organizer_name: value.organizer_name,
    event_title: value.event_title,
    location_kind: value.location_kind,
    location_label: value.location_label,
    time_zone: value.time_zone,
    booking_status: value.booking_status,
    version: value.version,
  };
};

export async function publicBookingManagementTokenHash(token: string): Promise<string> {
  requiredText(token, "managementToken", 16, 512);
  if (!BASE64URL_PATTERN.test(token)) {
    throw new PublicBookingStoreError("invalid_management_token", "The management token is invalid.");
  }
  return sha256(token);
}

/** Idempotent HMAC issuer. D1 persists the token hash, never the bearer token. */
export class D1PublicBookingManagementTokenIssuer implements PublicBookingManagementTokenIssuer {
  readonly #database: D1Database;
  readonly #secret: string;
  readonly #now: Clock;
  #key: Promise<CryptoKey> | null = null;

  constructor(database: D1Database, options: D1PublicBookingManagementTokenIssuerOptions) {
    validateManagementSecret(options.secret);
    this.#database = database;
    this.#secret = options.secret;
    this.#now = options.now ?? Date.now;
  }

  async issue(
    input: Parameters<PublicBookingManagementTokenIssuer["issue"]>[0],
  ): Promise<{ readonly token: string }> {
    requiredText(input.scope.workspace, "workspace", 1, 255);
    requiredText(input.scope.principal, "principal", 1, 255);
    if (!BOOKING_REFERENCE_PATTERN.test(input.bookingReference)) {
      throw new PublicBookingStoreError("invalid_store_input", "bookingReference is invalid.");
    }
    requiredText(input.pageId, "pageId", 8, 255);
    requiredText(input.revisionId, "revisionId", 8, 255);
    requiredText(input.destinationCalendarId, "destinationCalendarId", 1, 255);
    requiredText(input.providerBookingId, "providerBookingId", 1, 2_048);
    requiredText(input.providerOperationId, "providerOperationId", 16, 255);
    canonicalInstant(input.startsAt, "startsAt");
    canonicalInstant(input.endsAt, "endsAt");
    const guestName = input.guest.name.trim();
    const guestEmail = input.guest.email.trim().toLowerCase();
    requiredText(guestName, "guest.name", 1, 160);
    requiredText(guestEmail, "guestEmail", 3, 320);
    requiredText(input.organizerName, "organizerName", 1, 160);
    requiredText(input.eventTitle, "eventTitle", 1, 160);
    if (!["google-meet", "phone", "in-person", "custom"].includes(input.location)) {
      throw new PublicBookingStoreError("invalid_store_input", "location is invalid.");
    }
    requiredText(input.locationLabel, "locationLabel", 1, 160);
    requiredText(input.timeZone, "timeZone", 1, 255);
    if (input.approvalExpiresAt !== null) {
      canonicalInstant(input.approvalExpiresAt, "approvalExpiresAt");
    }
    if (
      Date.parse(input.endsAt) <= Date.parse(input.startsAt) ||
      !guestEmail.includes("@") ||
      guestName !== input.guest.name ||
      guestEmail !== input.guest.email
    ) {
      throw new PublicBookingStoreError("invalid_store_input", "The management credential is invalid.");
    }

    const token = await this.#token(input.scope.workspace, input.scope.principal, input.bookingReference);
    const tokenHash = await publicBookingManagementTokenHash(token);
    const now = canonicalNow(this.#now);
    const results = await this.#database.batch<Record<string, unknown>>([
      this.#database.prepare(
        `INSERT OR IGNORE INTO public_booking_management_credentials (
           booking_reference, workspace_id, principal_id, token_version,
           token_hash, page_id, revision_id, provider_booking_id,
           provider_operation_id, start_at, end_at, guest_name, guest_email,
           approval_expires_at, status,
           destination_calendar_id, organizer_name, event_title,
           location_kind, location_label, time_zone, booking_status, version,
           created_at, updated_at, revoked_at
         )
         SELECT ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                'active', ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, NULL
          WHERE EXISTS (
            SELECT 1
              FROM public_booking_attempts
             WHERE booking_reference = ? AND workspace_id = ? AND principal_id = ?
               AND provider_operation_id = ? AND revision_id = ?
               AND start_at = ? AND end_at = ?
               AND guest_name = ? AND guest_email = ?
               AND approval_expires_at IS ?
               AND state IN ('pending', 'uncertain', 'committed')
          )`,
      ).bind(
        input.bookingReference,
        input.scope.workspace,
        input.scope.principal,
        tokenHash,
        input.pageId,
        input.revisionId,
        input.providerBookingId,
        input.providerOperationId,
        input.startsAt,
        input.endsAt,
        guestName,
        guestEmail,
        input.approvalExpiresAt,
        input.destinationCalendarId,
        input.organizerName,
        input.eventTitle,
        input.location,
        input.locationLabel,
        input.timeZone,
        input.approvalExpiresAt === null ? "confirmed" : "pending",
        now,
        now,
        input.bookingReference,
        input.scope.workspace,
        input.scope.principal,
        input.providerOperationId,
        input.revisionId,
        input.startsAt,
        input.endsAt,
        guestName,
        guestEmail,
        input.approvalExpiresAt,
      ),
      this.#database.prepare(
        `SELECT booking_reference, workspace_id, principal_id, token_version,
                token_hash, page_id, revision_id, provider_booking_id,
                provider_operation_id, start_at, end_at, guest_name,
                guest_email, approval_expires_at, status,
                destination_calendar_id, organizer_name, event_title,
                location_kind, location_label, time_zone, booking_status, version
           FROM public_booking_management_credentials
          WHERE booking_reference = ?`,
      ).bind(input.bookingReference),
    ]);
    const stored = credentialRow(results[1]?.results[0]);
    if (
      !stored ||
      stored.workspace_id !== input.scope.workspace ||
      stored.principal_id !== input.scope.principal ||
      stored.token_version !== 1 ||
      stored.token_hash !== tokenHash ||
      stored.page_id !== input.pageId ||
      stored.revision_id !== input.revisionId ||
      stored.provider_booking_id !== input.providerBookingId ||
      stored.provider_operation_id !== input.providerOperationId ||
      stored.start_at !== input.startsAt ||
      stored.end_at !== input.endsAt ||
      stored.guest_name !== guestName ||
      stored.guest_email !== guestEmail ||
      stored.approval_expires_at !== input.approvalExpiresAt ||
      stored.status !== "active" ||
      stored.destination_calendar_id !== input.destinationCalendarId ||
      stored.organizer_name !== input.organizerName ||
      stored.event_title !== input.eventTitle ||
      stored.location_kind !== input.location ||
      stored.location_label !== input.locationLabel ||
      stored.time_zone !== input.timeZone ||
      stored.booking_status !== (input.approvalExpiresAt === null ? "confirmed" : "pending") ||
      stored.version !== 1
    ) {
      throw new PublicBookingStoreError(
        "management_credential_conflict",
        "The management credential could not be persisted conclusively.",
      );
    }
    return { token };
  }

  async #token(workspace: string, principal: string, bookingReference: string): Promise<string> {
    this.#key ??= importManagementKey(this.#secret);
    return deriveManagementToken(this.#key, workspace, principal, bookingReference);
  }
}

export interface D1PublicBookingSerializationBoundaryOptions {
  readonly now?: Clock;
  readonly leaseMilliseconds?: number;
  readonly renewalMilliseconds?: number;
  readonly acquisitionTimeoutMilliseconds?: number;
  readonly retryMilliseconds?: number;
}

const delay = (milliseconds: number, signal: AbortSignal): Promise<void> => new Promise(resolve => {
  if (signal.aborted) {
    resolve();
    return;
  }
  const onAbort = (): void => {
    clearTimeout(timer);
    resolve();
  };
  const timer = setTimeout(() => {
    signal.removeEventListener("abort", onAbort);
    resolve();
  }, milliseconds);
  signal.addEventListener("abort", onAbort, { once: true });
});

/**
 * D1 owner lease used as the public core's Worker-level serialization boundary.
 * Existing D1 uniqueness and provider-calendar locks remain the final fences if
 * a lease is lost during an ambiguous upstream operation.
 */
export class D1PublicBookingSerializationBoundary implements PublicBookingSerializationBoundary {
  readonly #database: D1Database;
  readonly #now: Clock;
  readonly #leaseMilliseconds: number;
  readonly #renewalMilliseconds: number;
  readonly #acquisitionTimeoutMilliseconds: number;
  readonly #retryMilliseconds: number;

  constructor(database: D1Database, options: D1PublicBookingSerializationBoundaryOptions = {}) {
    this.#database = database;
    this.#now = options.now ?? Date.now;
    this.#leaseMilliseconds = options.leaseMilliseconds ?? 30_000;
    this.#renewalMilliseconds = options.renewalMilliseconds ?? 10_000;
    this.#acquisitionTimeoutMilliseconds = options.acquisitionTimeoutMilliseconds ?? 15_000;
    this.#retryMilliseconds = options.retryMilliseconds ?? 50;
    if (
      this.#leaseMilliseconds < 1_000 ||
      this.#renewalMilliseconds < 100 ||
      this.#renewalMilliseconds * 2 >= this.#leaseMilliseconds ||
      this.#acquisitionTimeoutMilliseconds < 0 ||
      this.#retryMilliseconds < 10
    ) {
      throw new PublicBookingStoreError("owner_lease_invalid", "The owner lease configuration is invalid.");
    }
  }

  async runExclusive<T>(coordinationKey: string, operation: () => Promise<T>): Promise<T> {
    requiredText(coordinationKey, "coordinationKey", 16, 255);
    const leaseToken = crypto.randomUUID();
    await this.#acquire(coordinationKey, leaseToken);
    const renewalController = new AbortController();
    let leaseFailure: unknown = null;
    const renewal = this.#renew(coordinationKey, leaseToken, renewalController.signal)
      .catch(error => {
        leaseFailure = error;
      });
    let outcome: { readonly value: T } | null = null;
    let operationFailure: unknown = null;
    try {
      outcome = { value: await operation() };
    } catch (error) {
      operationFailure = error;
    } finally {
      renewalController.abort();
      await renewal;
      try {
        const released = await this.#database.prepare(
          `UPDATE public_booking_owner_leases
              SET lease_token = NULL, lease_until = NULL, updated_at = ?
            WHERE coordination_key = ? AND lease_token = ?`,
        ).bind(canonicalNow(this.#now), coordinationKey, leaseToken).run();
        if (Number(released.meta.changes ?? 0) !== 1 && !operationFailure && !leaseFailure) {
          leaseFailure = new PublicBookingStoreError(
            "owner_lease_lost",
            "The public booking owner lease was lost before release.",
          );
        }
      } catch (error) {
        if (!operationFailure && !leaseFailure) leaseFailure = error;
      }
    }
    if (operationFailure) throw operationFailure;
    if (leaseFailure || !outcome) {
      throw new PublicBookingStoreError(
        "owner_lease_lost",
        "The public booking owner lease was lost during the operation.",
      );
    }
    return outcome.value;
  }

  async #acquire(coordinationKey: string, leaseToken: string): Promise<void> {
    const startedAt = Date.now();
    do {
      const now = canonicalNow(this.#now);
      const leaseUntil = new Date(Date.parse(now) + this.#leaseMilliseconds).toISOString();
      const claimed = await this.#database.prepare(
        `INSERT INTO public_booking_owner_leases (
           coordination_key, lease_token, lease_until, updated_at
         ) VALUES (?, ?, ?, ?)
         ON CONFLICT (coordination_key) DO UPDATE SET
           lease_token = excluded.lease_token,
           lease_until = excluded.lease_until,
           updated_at = excluded.updated_at
         WHERE public_booking_owner_leases.lease_token IS NULL
            OR public_booking_owner_leases.lease_until <= excluded.updated_at`,
      ).bind(coordinationKey, leaseToken, leaseUntil, now).run();
      if (Number(claimed.meta.changes ?? 0) === 1) return;
      if (Date.now() - startedAt >= this.#acquisitionTimeoutMilliseconds) break;
      await delay(this.#retryMilliseconds, new AbortController().signal);
    } while (Date.now() - startedAt <= this.#acquisitionTimeoutMilliseconds);
    throw new PublicBookingStoreError(
      "owner_lease_unavailable",
      "The public booking owner is already processing another booking.",
    );
  }

  async #renew(coordinationKey: string, leaseToken: string, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      await delay(this.#renewalMilliseconds, signal);
      if (signal.aborted) return;
      const now = canonicalNow(this.#now);
      const leaseUntil = new Date(Date.parse(now) + this.#leaseMilliseconds).toISOString();
      const renewed = await this.#database.prepare(
        `UPDATE public_booking_owner_leases
            SET lease_until = ?, updated_at = ?
          WHERE coordination_key = ? AND lease_token = ? AND lease_until > ?`,
      ).bind(leaseUntil, now, coordinationKey, leaseToken, now).run();
      if (Number(renewed.meta.changes ?? 0) !== 1) {
        throw new PublicBookingStoreError(
          "owner_lease_lost",
          "The public booking owner lease expired during the operation.",
        );
      }
    }
  }
}
