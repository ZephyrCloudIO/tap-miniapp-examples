const MANAGEMENT_TOKEN_DOMAIN = "tap.calendar.public-management.v1";
const MANAGEMENT_TOKEN_PREFIX = "tapm_v1_";
const TEXT_ENCODER = new TextEncoder();
const BOOKING_REFERENCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/u;
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;

const PUBLIC_BOOKING_EMAIL_KINDS = [
  "booking-confirmed",
  "approval-requested",
  "approval-approved",
  "approval-declined",
  "approval-expired",
  "booking-cancelled",
  "booking-rescheduled",
] as const;

export type PublicBookingEmailKind = typeof PUBLIC_BOOKING_EMAIL_KINDS[number];

export interface PublicBookingEmailEnqueueInput {
  /** Stable per lifecycle event; retries must reuse the same key. */
  readonly eventKey: string;
  readonly bookingReference: string;
  readonly scope: {
    readonly workspace: string;
    readonly principal: string;
  };
  readonly kind: PublicBookingEmailKind;
  readonly recipient: {
    readonly name: string;
    readonly email: string;
  };
  readonly organizerName: string;
  readonly eventTitle: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly timeZone: string;
  readonly previousStartsAt?: string;
  readonly previousEndsAt?: string;
}

export type PublicBookingEmailMessage = EmailMessageBuilder & {
  readonly to: EmailAddress;
  readonly from: EmailAddress;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
};

/** Structurally compatible with a Cloudflare `send_email` / `SendEmail` binding. */
export interface PublicBookingEmailSendPort {
  send(message: PublicBookingEmailMessage): Promise<unknown>;
}

export interface PublicBookingEmailRenderOptions {
  readonly managementSecret: string;
  readonly managementOrigin: string;
  readonly from: EmailAddress;
  readonly brandName?: string;
}

export interface PublicBookingEmailDeliveryOptions extends PublicBookingEmailRenderOptions {
  readonly limit?: number;
}

export interface PublicBookingEmailDeliverySummary {
  readonly claimed: number;
  readonly delivered: number;
  readonly retried: number;
  readonly deadLettered: number;
  readonly infrastructureFailed: boolean;
}

export interface PublicBookingEmailPreparedEnqueue {
  readonly outboxId: string;
  /** Include this statement in the same D1 `batch()` as the owning state change. */
  readonly statement: D1PreparedStatement;
}

export interface PublicBookingEmailEnqueueResult {
  readonly kind: "enqueued" | "existing";
  readonly outboxId: string;
}

/** Structural adapter contract used by the management core without importing it here. */
export interface PublicBookingManagementEmailPortAdapter {
  enqueue(input: {
    readonly eventKey: string;
    readonly bookingReference: string;
    readonly scope: { readonly workspace: string; readonly principal: string };
    readonly kind: "cancelled" | "rescheduled";
    readonly recipient: { readonly name: string; readonly email: string };
    readonly organizerName: string;
    readonly eventTitle: string;
    readonly startsAt: string;
    readonly endsAt: string;
    readonly timeZone: string;
    readonly previousStartsAt?: string;
    readonly previousEndsAt?: string;
  }): Promise<void>;
}

export interface D1PublicBookingEmailOutboxOptions {
  readonly now?: () => number;
  readonly id?: () => string;
  readonly leaseMilliseconds?: number;
  readonly maxAttempts?: number;
  readonly baseRetryMilliseconds?: number;
  readonly maxRetryMilliseconds?: number;
  readonly random?: () => number;
}

export class PublicBookingEmailError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PublicBookingEmailError";
    this.code = code;
  }
}

interface NormalizedEmailEvent {
  readonly eventKey: string;
  readonly bookingReference: string;
  readonly workspace: string;
  readonly principal: string;
  readonly kind: PublicBookingEmailKind;
  readonly recipientName: string;
  readonly recipientEmail: string;
  readonly organizerName: string;
  readonly eventTitle: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly timeZone: string;
  readonly previousStartsAt: string | null;
  readonly previousEndsAt: string | null;
}

interface EmailOutboxRow extends Record<string, unknown> {
  readonly outbox_id: string;
  readonly event_key: string;
  readonly booking_reference: string;
  readonly workspace_id: string;
  readonly principal_id: string;
  readonly kind: string;
  readonly recipient_name: string;
  readonly recipient_email: string;
  readonly organizer_name: string;
  readonly event_title: string;
  readonly start_at: string;
  readonly end_at: string;
  readonly time_zone: string;
  readonly previous_start_at: string | null;
  readonly previous_end_at: string | null;
  readonly state: string;
  readonly attempt_count: number;
  readonly next_attempt_at: string;
  readonly lease_token: string | null;
  readonly lease_until: string | null;
}

interface LeasedEmailEvent extends NormalizedEmailEvent {
  readonly outboxId: string;
  readonly attemptCount: number;
  readonly leaseToken: string;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const boundedText = (
  value: string,
  field: string,
  minimum: number,
  maximum: number,
): string => {
  if (
    value.length < minimum || value.length > maximum ||
    value.trim() !== value || CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    throw new PublicBookingEmailError("invalid_email_event", `${field} is invalid.`);
  }
  return value;
};

const canonicalInstant = (value: string, field: string): string => {
  boundedText(value, field, 20, 40);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new PublicBookingEmailError("invalid_email_event", `${field} is invalid.`);
  }
  return value;
};

const canonicalNow = (clock: () => number): string => {
  const value = clock();
  if (!Number.isFinite(value)) {
    throw new PublicBookingEmailError("invalid_email_clock", "The email outbox clock is invalid.");
  }
  return new Date(value).toISOString();
};

const canonicalOrigin = (value: string): string => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PublicBookingEmailError("invalid_management_origin", "The management origin is invalid.");
  }
  if (
    url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new PublicBookingEmailError("invalid_management_origin", "The management origin is invalid.");
  }
  return url.origin;
};

const canonicalAddress = (value: EmailAddress, field: string): EmailAddress => {
  const name = boundedText(value.name, `${field}.name`, 1, 160);
  const email = boundedText(value.email, `${field}.email`, 3, 320).toLowerCase();
  if (!EMAIL_PATTERN.test(email) || email !== value.email) {
    throw new PublicBookingEmailError("invalid_email_address", `${field}.email is invalid.`);
  }
  return { name, email };
};

const validTimeZone = (value: string): string => {
  boundedText(value, "timeZone", 1, 255);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
  } catch {
    throw new PublicBookingEmailError("invalid_email_event", "timeZone is invalid.");
  }
  return value;
};

const normalizeEvent = (input: PublicBookingEmailEnqueueInput): NormalizedEmailEvent => {
  if (!PUBLIC_BOOKING_EMAIL_KINDS.includes(input.kind)) {
    throw new PublicBookingEmailError("invalid_email_event", "kind is invalid.");
  }
  const startsAt = canonicalInstant(input.startsAt, "startsAt");
  const endsAt = canonicalInstant(input.endsAt, "endsAt");
  if (Date.parse(endsAt) <= Date.parse(startsAt)) {
    throw new PublicBookingEmailError("invalid_email_event", "The email event interval is invalid.");
  }
  const previousStartsAt = input.previousStartsAt === undefined
    ? null
    : canonicalInstant(input.previousStartsAt, "previousStartsAt");
  const previousEndsAt = input.previousEndsAt === undefined
    ? null
    : canonicalInstant(input.previousEndsAt, "previousEndsAt");
  if (
    (input.kind === "booking-rescheduled") !==
      (previousStartsAt !== null && previousEndsAt !== null) ||
    (previousStartsAt !== null && previousEndsAt !== null &&
      Date.parse(previousEndsAt) <= Date.parse(previousStartsAt))
  ) {
    throw new PublicBookingEmailError(
      "invalid_email_event",
      "Only a rescheduled event may include a valid previous interval.",
    );
  }
  const recipient = canonicalAddress({
    name: input.recipient.name,
    email: input.recipient.email,
  }, "recipient");
  const bookingReference = boundedText(input.bookingReference, "bookingReference", 16, 128);
  if (!BOOKING_REFERENCE_PATTERN.test(bookingReference)) {
    throw new PublicBookingEmailError("invalid_email_event", "bookingReference is invalid.");
  }
  return {
    eventKey: boundedText(input.eventKey, "eventKey", 8, 255),
    bookingReference,
    workspace: boundedText(input.scope.workspace, "scope.workspace", 1, 255),
    principal: boundedText(input.scope.principal, "scope.principal", 1, 255),
    kind: input.kind,
    recipientName: recipient.name,
    recipientEmail: recipient.email,
    organizerName: boundedText(input.organizerName, "organizerName", 1, 160),
    eventTitle: boundedText(input.eventTitle, "eventTitle", 1, 200),
    startsAt,
    endsAt,
    timeZone: validTimeZone(input.timeZone),
    previousStartsAt,
    previousEndsAt,
  };
};

const eventFromRow = (row: EmailOutboxRow): NormalizedEmailEvent => normalizeEvent({
  eventKey: row.event_key,
  bookingReference: row.booking_reference,
  scope: { workspace: row.workspace_id, principal: row.principal_id },
  kind: row.kind as PublicBookingEmailKind,
  recipient: { name: row.recipient_name, email: row.recipient_email },
  organizerName: row.organizer_name,
  eventTitle: row.event_title,
  startsAt: row.start_at,
  endsAt: row.end_at,
  timeZone: row.time_zone,
  ...(row.previous_start_at === null ? {} : { previousStartsAt: row.previous_start_at }),
  ...(row.previous_end_at === null ? {} : { previousEndsAt: row.previous_end_at }),
});

const rowValue = (value: unknown): EmailOutboxRow | null => {
  if (
    !isRecord(value) ||
    typeof value.outbox_id !== "string" ||
    typeof value.event_key !== "string" ||
    typeof value.booking_reference !== "string" ||
    typeof value.workspace_id !== "string" ||
    typeof value.principal_id !== "string" ||
    typeof value.kind !== "string" ||
    typeof value.recipient_name !== "string" ||
    typeof value.recipient_email !== "string" ||
    typeof value.organizer_name !== "string" ||
    typeof value.event_title !== "string" ||
    typeof value.start_at !== "string" ||
    typeof value.end_at !== "string" ||
    typeof value.time_zone !== "string" ||
    (value.previous_start_at !== null && typeof value.previous_start_at !== "string") ||
    (value.previous_end_at !== null && typeof value.previous_end_at !== "string") ||
    typeof value.state !== "string" ||
    typeof value.attempt_count !== "number" ||
    typeof value.next_attempt_at !== "string" ||
    (value.lease_token !== null && typeof value.lease_token !== "string") ||
    (value.lease_until !== null && typeof value.lease_until !== "string")
  ) return null;
  return {
    ...value,
    outbox_id: value.outbox_id,
    event_key: value.event_key,
    booking_reference: value.booking_reference,
    workspace_id: value.workspace_id,
    principal_id: value.principal_id,
    kind: value.kind,
    recipient_name: value.recipient_name,
    recipient_email: value.recipient_email,
    organizer_name: value.organizer_name,
    event_title: value.event_title,
    start_at: value.start_at,
    end_at: value.end_at,
    time_zone: value.time_zone,
    previous_start_at: value.previous_start_at,
    previous_end_at: value.previous_end_at,
    state: value.state,
    attempt_count: value.attempt_count,
    next_attempt_at: value.next_attempt_at,
    lease_token: value.lease_token,
    lease_until: value.lease_until,
  };
};

const sameEvent = (row: EmailOutboxRow, event: NormalizedEmailEvent): boolean =>
  row.event_key === event.eventKey &&
  row.booking_reference === event.bookingReference &&
  row.workspace_id === event.workspace &&
  row.principal_id === event.principal &&
  row.kind === event.kind &&
  row.recipient_name === event.recipientName &&
  row.recipient_email === event.recipientEmail &&
  row.organizer_name === event.organizerName &&
  row.event_title === event.eventTitle &&
  row.start_at === event.startsAt &&
  row.end_at === event.endsAt &&
  row.time_zone === event.timeZone &&
  row.previous_start_at === event.previousStartsAt &&
  row.previous_end_at === event.previousEndsAt;

const base64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
};

const managementToken = async (
  secret: string,
  workspace: string,
  principal: string,
  bookingReference: string,
): Promise<string> => {
  if (TEXT_ENCODER.encode(secret).byteLength < 32) {
    throw new PublicBookingEmailError(
      "invalid_management_secret",
      "The management secret must contain at least 32 bytes.",
    );
  }
  const key = await crypto.subtle.importKey(
    "raw",
    TEXT_ENCODER.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    TEXT_ENCODER.encode(
      `${MANAGEMENT_TOKEN_DOMAIN}\u0000${workspace}\u0000${principal}\u0000${bookingReference}`,
    ),
  );
  return `${MANAGEMENT_TOKEN_PREFIX}${base64Url(new Uint8Array(signature))}`;
};

/** The fragment keeps the bearer credential out of HTTP request paths and server logs. */
export async function publicBookingEmailManagementUrl(
  input: Pick<NormalizedEmailEvent, "workspace" | "principal" | "bookingReference">,
  options: Pick<PublicBookingEmailRenderOptions, "managementSecret" | "managementOrigin">,
): Promise<string> {
  const origin = canonicalOrigin(options.managementOrigin);
  const token = await managementToken(
    options.managementSecret,
    input.workspace,
    input.principal,
    input.bookingReference,
  );
  const url = new URL("/manage", origin);
  url.hash = token;
  return url.toString();
}

export const escapePublicBookingEmailHtml = (value: string): string => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const zonedInterval = (startsAt: string, endsAt: string, timeZone: string): string => {
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(startsAt));
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  return `${date}, ${time.format(new Date(startsAt))}–${time.format(new Date(endsAt))}`;
};

const copyFor = (
  event: NormalizedEmailEvent,
): { readonly subject: string; readonly heading: string; readonly body: string } => {
  switch (event.kind) {
    case "booking-confirmed":
      return {
        subject: `Confirmed: ${event.eventTitle}`,
        heading: "Your booking is confirmed",
        body: `${event.organizerName} has you on the calendar.`,
      };
    case "approval-requested":
      return {
        subject: `Request received: ${event.eventTitle}`,
        heading: "Your booking request was sent",
        body: `${event.organizerName} will review your requested time.`,
      };
    case "approval-approved":
      return {
        subject: `Approved: ${event.eventTitle}`,
        heading: "Your booking request was approved",
        body: `${event.organizerName} approved your requested time.`,
      };
    case "approval-declined":
      return {
        subject: `Request declined: ${event.eventTitle}`,
        heading: "Your booking request was declined",
        body: `${event.organizerName} was unable to accept this requested time.`,
      };
    case "approval-expired":
      return {
        subject: `Request expired: ${event.eventTitle}`,
        heading: "Your booking request expired",
        body: "The request was not approved before its hold expired.",
      };
    case "booking-cancelled":
      return {
        subject: `Cancelled: ${event.eventTitle}`,
        heading: "Your booking was cancelled",
        body: `This booking with ${event.organizerName} is no longer scheduled.`,
      };
    case "booking-rescheduled":
      return {
        subject: `Rescheduled: ${event.eventTitle}`,
        heading: "Your booking was rescheduled",
        body: `${event.organizerName} has you on the calendar at the new time below.`,
      };
  }
};

/** Renders bounded event data only after a row is leased; no bearer URL is persisted. */
export async function renderPublicBookingEmail(
  input: PublicBookingEmailEnqueueInput,
  options: PublicBookingEmailRenderOptions,
): Promise<PublicBookingEmailMessage> {
  const event = normalizeEvent(input);
  const from = canonicalAddress(options.from, "from");
  const brandName = boundedText(options.brandName ?? "TAP", "brandName", 1, 80);
  const manageUrl = await publicBookingEmailManagementUrl(event, options);
  const copy = copyFor(event);
  const schedule = zonedInterval(event.startsAt, event.endsAt, event.timeZone);
  const previous = event.previousStartsAt === null || event.previousEndsAt === null
    ? null
    : zonedInterval(event.previousStartsAt, event.previousEndsAt, event.timeZone);
  const previousText = previous === null ? "" : `\nPrevious time: ${previous}`;
  const previousHtml = previous === null
    ? ""
    : `<p style="margin:8px 0 0;color:#6b6878"><strong>Previous time:</strong> ${
      escapePublicBookingEmailHtml(previous)
    }</p>`;
  const text = `${copy.heading}\n\n${copy.body}\n\n${event.eventTitle}\n${schedule}${previousText}\n\nManage booking: ${manageUrl}\n\nPowered by ${brandName}`;
  const html = `<!doctype html><html><body style="margin:0;background:#f7f6fb;color:#242230;font-family:Arial,sans-serif"><div style="max-width:600px;margin:0 auto;padding:32px 20px"><div style="background:#ffffff;border:1px solid #dedbe8;border-radius:16px;padding:28px"><p style="margin:0 0 8px;color:#6b6878;font-size:14px">${escapePublicBookingEmailHtml(brandName)} Calendar</p><h1 style="margin:0 0 20px;font-size:24px">${escapePublicBookingEmailHtml(copy.heading)}</h1><p style="margin:0 0 20px">${escapePublicBookingEmailHtml(copy.body)}</p><h2 style="margin:0 0 8px;font-size:18px">${escapePublicBookingEmailHtml(event.eventTitle)}</h2><p style="margin:0;color:#454150">${escapePublicBookingEmailHtml(schedule)}</p>${previousHtml}<p style="margin:24px 0 0"><a href="${escapePublicBookingEmailHtml(manageUrl)}" style="display:inline-block;background:#6c55f7;color:#ffffff;text-decoration:none;border-radius:10px;padding:12px 18px;font-weight:700">Manage booking</a></p></div><p style="margin:16px 0 0;text-align:center;color:#777382;font-size:13px">Powered by ${escapePublicBookingEmailHtml(brandName)}</p></div></body></html>`;
  return {
    to: { name: event.recipientName, email: event.recipientEmail },
    from,
    subject: copy.subject,
    text,
    html,
    headers: { "X-TAP-Booking-Event": event.kind },
  };
}

const SELECT_COLUMNS = `outbox_id, event_key, booking_reference, workspace_id,
  principal_id, kind, recipient_name, recipient_email, organizer_name,
  event_title, start_at, end_at, time_zone, previous_start_at,
  previous_end_at, state, attempt_count, next_attempt_at, lease_token,
  lease_until`;

const inputFromEvent = (event: NormalizedEmailEvent): PublicBookingEmailEnqueueInput => ({
  eventKey: event.eventKey,
  bookingReference: event.bookingReference,
  scope: { workspace: event.workspace, principal: event.principal },
  kind: event.kind,
  recipient: { name: event.recipientName, email: event.recipientEmail },
  organizerName: event.organizerName,
  eventTitle: event.eventTitle,
  startsAt: event.startsAt,
  endsAt: event.endsAt,
  timeZone: event.timeZone,
  ...(event.previousStartsAt === null ? {} : { previousStartsAt: event.previousStartsAt }),
  ...(event.previousEndsAt === null ? {} : { previousEndsAt: event.previousEndsAt }),
});

const errorDisposition = (
  error: unknown,
): { readonly code: string; readonly permanent: boolean } => {
  const rawCode = isRecord(error) && typeof error.code === "string"
    ? error.code.toUpperCase()
    : "EMAIL_SEND_FAILED";
  const code = ERROR_CODE_PATTERN.test(rawCode) ? rawCode : "EMAIL_SEND_FAILED";
  const permanent = new Set([
    "E_VALIDATION_ERROR",
    "E_FIELD_MISSING",
    "E_SENDER_NOT_VERIFIED",
    "E_RECIPIENT_NOT_ALLOWED",
    "E_RECIPIENT_SUPPRESSED",
    "E_SENDER_DOMAIN_NOT_AVAILABLE",
    "E_CONTENT_TOO_LARGE",
    "E_HEADER_NOT_ALLOWED",
    "E_HEADER_USE_API_FIELD",
    "E_HEADER_VALUE_INVALID",
    "E_HEADER_VALUE_TOO_LONG",
    "E_HEADER_NAME_INVALID",
    "E_HEADERS_TOO_LARGE",
    "E_HEADERS_TOO_MANY",
  ]).has(code);
  return { code, permanent };
};

/** D1-backed durable outbox. Provider sends happen only after the enqueue transaction commits. */
export class D1PublicBookingEmailOutbox {
  readonly #database: D1Database;
  readonly #now: () => number;
  readonly #id: () => string;
  readonly #leaseMilliseconds: number;
  readonly #maxAttempts: number;
  readonly #baseRetryMilliseconds: number;
  readonly #maxRetryMilliseconds: number;
  readonly #random: () => number;

  constructor(database: D1Database, options: D1PublicBookingEmailOutboxOptions = {}) {
    this.#database = database;
    this.#now = options.now ?? Date.now;
    this.#id = options.id ?? crypto.randomUUID;
    this.#leaseMilliseconds = options.leaseMilliseconds ?? 60_000;
    this.#maxAttempts = options.maxAttempts ?? 8;
    this.#baseRetryMilliseconds = options.baseRetryMilliseconds ?? 60_000;
    this.#maxRetryMilliseconds = options.maxRetryMilliseconds ?? 86_400_000;
    this.#random = options.random ?? Math.random;
    if (
      this.#leaseMilliseconds < 1_000 ||
      !Number.isInteger(this.#maxAttempts) || this.#maxAttempts < 1 || this.#maxAttempts > 16 ||
      this.#baseRetryMilliseconds < 1_000 ||
      this.#maxRetryMilliseconds < this.#baseRetryMilliseconds
    ) {
      throw new PublicBookingEmailError("invalid_outbox_options", "Email outbox options are invalid.");
    }
  }

  prepareEnqueue(input: PublicBookingEmailEnqueueInput): PublicBookingEmailPreparedEnqueue {
    const event = normalizeEvent(input);
    const outboxId = this.#id();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(outboxId)) {
      throw new PublicBookingEmailError("invalid_outbox_id", "The email outbox ID is invalid.");
    }
    const now = canonicalNow(this.#now);
    return {
      outboxId,
      statement: this.#database.prepare(
        `INSERT OR IGNORE INTO public_booking_email_outbox (
           outbox_id, event_key, booking_reference, workspace_id, principal_id,
           kind, recipient_name, recipient_email, organizer_name, event_title,
           start_at, end_at, time_zone, previous_start_at, previous_end_at,
           state, attempt_count, next_attempt_at, lease_token, lease_until,
           last_error_code, created_at, updated_at, delivered_at, dead_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                   'queued', 0, ?, NULL, NULL, NULL, ?, ?, NULL, NULL)`,
      ).bind(
        outboxId,
        event.eventKey,
        event.bookingReference,
        event.workspace,
        event.principal,
        event.kind,
        event.recipientName,
        event.recipientEmail,
        event.organizerName,
        event.eventTitle,
        event.startsAt,
        event.endsAt,
        event.timeZone,
        event.previousStartsAt,
        event.previousEndsAt,
        now,
        now,
        now,
      ),
    };
  }

  async enqueue(input: PublicBookingEmailEnqueueInput): Promise<PublicBookingEmailEnqueueResult> {
    const event = normalizeEvent(input);
    const prepared = this.prepareEnqueue(input);
    const results = await this.#database.batch<Record<string, unknown>>([
      prepared.statement,
      this.#database.prepare(
        `SELECT ${SELECT_COLUMNS}
           FROM public_booking_email_outbox
          WHERE booking_reference = ? AND event_key = ?`,
      ).bind(event.bookingReference, event.eventKey),
    ]);
    const row = rowValue(results[1]?.results[0]);
    if (!row || !sameEvent(row, event)) {
      throw new PublicBookingEmailError(
        "email_event_conflict",
        "The email event key is already associated with different content.",
      );
    }
    return {
      kind: Number(results[0]?.meta.changes ?? 0) === 1 ? "enqueued" : "existing",
      outboxId: row.outbox_id,
    };
  }

  async deliverDue(
    sender: PublicBookingEmailSendPort,
    options: PublicBookingEmailDeliveryOptions,
  ): Promise<PublicBookingEmailDeliverySummary> {
    const limit = options.limit ?? 10;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new PublicBookingEmailError("invalid_delivery_limit", "The delivery limit is invalid.");
    }
    // Validate global configuration before leasing a row. A bad deployment
    // must not consume attempts or dead-letter otherwise valid messages.
    canonicalOrigin(options.managementOrigin);
    canonicalAddress(options.from, "from");
    boundedText(options.brandName ?? "TAP", "brandName", 1, 80);
    if (TEXT_ENCODER.encode(options.managementSecret).byteLength < 32) {
      throw new PublicBookingEmailError(
        "invalid_management_secret",
        "The management secret must contain at least 32 bytes.",
      );
    }

    const summary = { claimed: 0, delivered: 0, retried: 0, deadLettered: 0 };
    await this.#deadLetterExhaustedLeases();
    for (let index = 0; index < limit; index += 1) {
      const leased = await this.#leaseNext();
      if (!leased) break;
      summary.claimed += 1;
      try {
        const message = await renderPublicBookingEmail(inputFromEvent(leased), options);
        await sender.send(message);
        await this.#markDelivered(leased);
        summary.delivered += 1;
      } catch (error) {
        const disposition = error instanceof PublicBookingEmailError
          ? { code: error.code.toUpperCase(), permanent: true }
          : errorDisposition(error);
        const state = await this.#markFailed(leased, disposition);
        if (state === "dead") summary.deadLettered += 1;
        else summary.retried += 1;
      }
    }
    return { ...summary, infrastructureFailed: false };
  }

  async #deadLetterExhaustedLeases(): Promise<void> {
    const now = canonicalNow(this.#now);
    await this.#database.prepare(
      `UPDATE public_booking_email_outbox
          SET state = 'dead', lease_token = NULL, lease_until = NULL,
              last_error_code = COALESCE(last_error_code, 'EMAIL_ATTEMPTS_EXHAUSTED'),
              updated_at = ?, dead_at = ?
        WHERE state = 'leased' AND lease_until <= ? AND attempt_count >= ?`,
    ).bind(now, now, now, this.#maxAttempts).run();
  }

  async #leaseNext(): Promise<LeasedEmailEvent | null> {
    const now = canonicalNow(this.#now);
    const leaseToken = crypto.randomUUID();
    const leaseUntil = new Date(Date.parse(now) + this.#leaseMilliseconds).toISOString();
    const row = rowValue(await this.#database.prepare(
      `UPDATE public_booking_email_outbox
          SET state = 'leased', attempt_count = attempt_count + 1,
              lease_token = ?, lease_until = ?, updated_at = ?
        WHERE outbox_id = (
          SELECT outbox_id
            FROM public_booking_email_outbox
           WHERE attempt_count < ? AND (
             (state = 'queued' AND next_attempt_at <= ?) OR
             (state = 'leased' AND lease_until <= ?)
           )
           ORDER BY next_attempt_at ASC, created_at ASC, outbox_id ASC
           LIMIT 1
        )
          AND attempt_count < ? AND (
            (state = 'queued' AND next_attempt_at <= ?) OR
            (state = 'leased' AND lease_until <= ?)
          )
      RETURNING ${SELECT_COLUMNS}`,
    ).bind(
      leaseToken,
      leaseUntil,
      now,
      this.#maxAttempts,
      now,
      now,
      this.#maxAttempts,
      now,
      now,
    ).first());
    if (!row) return null;
    if (
      row.state !== "leased" || row.lease_token !== leaseToken ||
      row.attempt_count < 1 || row.attempt_count > this.#maxAttempts
    ) {
      throw new PublicBookingEmailError("corrupt_email_outbox", "The leased email row is invalid.");
    }
    return {
      ...eventFromRow(row),
      outboxId: row.outbox_id,
      attemptCount: row.attempt_count,
      leaseToken,
    };
  }

  async #markDelivered(event: LeasedEmailEvent): Promise<void> {
    const now = canonicalNow(this.#now);
    const result = await this.#database.prepare(
      `UPDATE public_booking_email_outbox
          SET state = 'delivered', lease_token = NULL, lease_until = NULL,
              last_error_code = NULL, updated_at = ?, delivered_at = ?
        WHERE outbox_id = ? AND state = 'leased' AND lease_token = ?`,
    ).bind(now, now, event.outboxId, event.leaseToken).run();
    if (Number(result.meta.changes ?? 0) !== 1) {
      throw new PublicBookingEmailError("email_lease_lost", "The email lease was lost after delivery.");
    }
  }

  async #markFailed(
    event: LeasedEmailEvent,
    failure: { readonly code: string; readonly permanent: boolean },
  ): Promise<"queued" | "dead"> {
    const now = canonicalNow(this.#now);
    const dead = failure.permanent || event.attemptCount >= this.#maxAttempts;
    let result: D1Result;
    if (dead) {
      result = await this.#database.prepare(
        `UPDATE public_booking_email_outbox
            SET state = 'dead', lease_token = NULL, lease_until = NULL,
                last_error_code = ?, updated_at = ?, dead_at = ?
          WHERE outbox_id = ? AND state = 'leased' AND lease_token = ?`,
      ).bind(failure.code, now, now, event.outboxId, event.leaseToken).run();
    } else {
      const delay = this.#retryDelay(event.attemptCount);
      const nextAttemptAt = new Date(Date.parse(now) + delay).toISOString();
      result = await this.#database.prepare(
        `UPDATE public_booking_email_outbox
            SET state = 'queued', lease_token = NULL, lease_until = NULL,
                last_error_code = ?, next_attempt_at = ?, updated_at = ?
          WHERE outbox_id = ? AND state = 'leased' AND lease_token = ?`,
      ).bind(failure.code, nextAttemptAt, now, event.outboxId, event.leaseToken).run();
    }
    if (Number(result.meta.changes ?? 0) !== 1) {
      throw new PublicBookingEmailError("email_lease_lost", "The email lease was lost after failure.");
    }
    return dead ? "dead" : "queued";
  }

  #retryDelay(attemptCount: number): number {
    const random = this.#random();
    if (!Number.isFinite(random) || random < 0 || random >= 1) {
      throw new PublicBookingEmailError("invalid_retry_random", "The retry random source is invalid.");
    }
    const exponential = Math.min(
      this.#baseRetryMilliseconds * (2 ** Math.min(attemptCount - 1, 30)),
      this.#maxRetryMilliseconds,
    );
    return Math.max(1_000, Math.round(exponential * (0.75 + (random * 0.5))));
  }
}

/** Use after a booking commit when enqueue cannot share the owning D1 batch. */
export async function enqueuePublicBookingEmailAfterCommitSafely(
  outbox: D1PublicBookingEmailOutbox,
  input: PublicBookingEmailEnqueueInput,
): Promise<PublicBookingEmailEnqueueResult | { readonly kind: "unavailable" }> {
  try {
    return await outbox.enqueue(input);
  } catch {
    return { kind: "unavailable" };
  }
}

/**
 * Bridges the management core's concise lifecycle names to durable outbox
 * events. Persistence failures remain retryable to the core; provider email
 * delivery is never performed in this call.
 */
export function createPublicBookingManagementEmailPort(
  outbox: D1PublicBookingEmailOutbox,
): PublicBookingManagementEmailPortAdapter {
  return {
    async enqueue(input): Promise<void> {
      await outbox.enqueue({
        ...input,
        kind: input.kind === "cancelled" ? "booking-cancelled" : "booking-rescheduled",
      });
    },
  };
}

/** Suitable for `ctx.waitUntil()` and scheduled drains; it never rejects the caller. */
export async function deliverPublicBookingEmailOutboxSafely(
  outbox: D1PublicBookingEmailOutbox,
  sender: PublicBookingEmailSendPort,
  options: PublicBookingEmailDeliveryOptions,
): Promise<PublicBookingEmailDeliverySummary> {
  try {
    return await outbox.deliverDue(sender, options);
  } catch {
    return {
      claimed: 0,
      delivered: 0,
      retried: 0,
      deadLettered: 0,
      infrastructureFailed: true,
    };
  }
}
