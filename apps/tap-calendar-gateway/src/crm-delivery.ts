// HTTP side of Connect to CRM: the booking message, one POST to the CRM, and how a
// response decides between done, retry, broken connection, and stop.
// Contract: ZephyrCloudIO/tap-crm docs/forms-and-bookings.md → "Handoff".

import packageJson from "../package.json";

const CRM_BOOKINGS_PATH = "/tap/v1/bot/bookings";
// Release Please bumps this package version with every release.
const CRM_USER_AGENT = `tap-calendar/${packageJson.version}`;
const CRM_TIMEOUT_MS = 10_000;
const MAX_NOTES_LENGTH = 2_000;
const MAX_LIST_LENGTH = 20;
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 60 * 60_000;
const RETRY_AFTER_MAX_MS = 60 * 60_000;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;

export const CRM_MAX_DELIVERY_ATTEMPTS = 12;

export type CrmBookingStatus = "CONFIRMED" | "CANCELLED";

export interface CrmPerson {
  readonly email: string;
  readonly name?: string;
}

export interface CrmBookingPayload {
  readonly sourceId: string;
  readonly status: CrmBookingStatus;
  readonly version: number;
  readonly title: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly meetingUrl?: string;
  readonly guest: CrmPerson;
  readonly additionalGuests?: readonly CrmPerson[];
  readonly hosts?: readonly CrmPerson[];
  readonly notes?: string;
  readonly bookingPage?: string;
  readonly dryRun?: true;
}

export interface CrmBookingInput {
  readonly bookingReference: string;
  readonly status: CrmBookingStatus;
  readonly version: number;
  readonly title: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly meetingUrl?: string | null;
  readonly guestName: string;
  readonly guestEmail: string;
  readonly additionalGuestEmails?: readonly string[];
  readonly hosts?: readonly CrmPerson[];
  readonly notes?: string | null;
  readonly bookingPage?: string | null;
}

export const crmSourceId = (bookingReference: string): string =>
  `external:tap-calendar:${bookingReference}`;

const isHttpsUrl = (value: string | null | undefined): value is string => {
  if (!value) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};

/**
 * Never takes the management link or token: the only booking-derived text it
 * accepts is what the CRM contract lists.
 */
export const buildCrmBookingPayload = (input: CrmBookingInput): CrmBookingPayload => {
  const additionalGuests = (input.additionalGuestEmails ?? []).slice(0, MAX_LIST_LENGTH)
    .map(email => ({ email }));
  const hosts = (input.hosts ?? []).slice(0, MAX_LIST_LENGTH);
  const notes = input.notes?.trim().slice(0, MAX_NOTES_LENGTH);
  return {
    sourceId: crmSourceId(input.bookingReference),
    status: input.status,
    version: input.version,
    title: input.title,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    ...(isHttpsUrl(input.meetingUrl) ? { meetingUrl: input.meetingUrl } : {}),
    guest: { email: input.guestEmail, name: input.guestName },
    ...(additionalGuests.length ? { additionalGuests } : {}),
    ...(hosts.length ? { hosts } : {}),
    ...(notes ? { notes } : {}),
    ...(input.bookingPage ? { bookingPage: input.bookingPage } : {}),
  };
};

export type CrmOutcome =
  /** 2xx, including `unchanged` and a stale-version answer. */
  | { readonly kind: "delivered"; readonly requestId: string | null }
  /** 429, 5xx, or the CRM could not be reached. */
  | { readonly kind: "retry"; readonly code: string; readonly requestId: string | null; readonly retryAfterMs: number | null }
  /** 401: the key was revoked or is wrong. */
  | { readonly kind: "invalid_key"; readonly requestId: string | null }
  /** 403: the key lost `contacts.write`. */
  | { readonly kind: "missing_scope"; readonly requestId: string | null }
  /** 400, 409, or any other 4xx: a payload bug; stop and log the request id. */
  | { readonly kind: "rejected"; readonly code: string; readonly requestId: string | null };

/** Seconds or an HTTP date, capped so one header cannot park a delivery for days. */
export const parseRetryAfterMs = (value: string | null, nowMs: number): number | null => {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const seconds = /^\d+$/u.test(trimmed) ? Number(trimmed) : null;
  const delay = seconds !== null ? seconds * 1_000 : Date.parse(trimmed) - nowMs;
  if (!Number.isFinite(delay)) return null;
  return Math.min(Math.max(delay, 0), RETRY_AFTER_MAX_MS);
};

export const crmRetryDelayMs = (attemptCount: number, random: number): number => {
  const exponential = Math.min(RETRY_BASE_MS * 2 ** Math.min(attemptCount - 1, 30), RETRY_MAX_MS);
  return Math.max(1_000, Math.round(exponential * (0.75 + random * 0.5)));
};

/** Only an id field is read from the body; the body itself is never kept or logged. */
const responseRequestId = async (response: Response): Promise<string | null> => {
  const header = response.headers.get("x-request-id");
  if (header && REQUEST_ID_PATTERN.test(header)) return header;
  try {
    const body: unknown = JSON.parse((await response.text()).slice(0, 16_384));
    const id = body && typeof body === "object"
      ? (body as { requestId?: unknown }).requestId
      : undefined;
    return typeof id === "string" && REQUEST_ID_PATTERN.test(id) ? id : null;
  } catch {
    return null;
  }
};

export async function postCrmBooking(
  fetchImpl: typeof fetch,
  connection: { readonly apiUrl: string; readonly botKey: string },
  payload: CrmBookingPayload,
  nowMs: number = Date.now(),
): Promise<CrmOutcome> {
  let response: Response;
  try {
    response = await fetchImpl(`${connection.apiUrl}${CRM_BOOKINGS_PATH}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${connection.botKey}`,
        "content-type": "application/json",
        "user-agent": CRM_USER_AGENT,
      },
      body: JSON.stringify(payload),
      // A redirect would forward the bearer key to another host.
      redirect: "error",
      signal: AbortSignal.timeout(CRM_TIMEOUT_MS),
    });
  } catch {
    return { kind: "retry", code: "CRM_UNREACHABLE", requestId: null, retryAfterMs: null };
  }
  if (response.ok) {
    await response.body?.cancel();
    return { kind: "delivered", requestId: response.headers.get("x-request-id") };
  }
  const requestId = await responseRequestId(response);
  if (response.status === 401) return { kind: "invalid_key", requestId };
  if (response.status === 403) return { kind: "missing_scope", requestId };
  if (response.status === 429 || response.status >= 500) {
    return {
      kind: "retry",
      code: `CRM_HTTP_${response.status}`,
      requestId,
      retryAfterMs: parseRetryAfterMs(response.headers.get("retry-after"), nowMs),
    };
  }
  return { kind: "rejected", code: `CRM_HTTP_${response.status}`, requestId };
}

export type CrmTestReason = "invalid_key" | "missing_scope" | "unreachable" | "rejected";

export interface CrmTestResult {
  readonly ok: boolean;
  readonly reason: CrmTestReason | null;
}

/** A request the CRM won't save: `dryRun` runs the route and rolls back. */
export async function testCrmConnection(
  fetchImpl: typeof fetch,
  connection: { readonly apiUrl: string; readonly botKey: string },
  nowMs: number = Date.now(),
): Promise<CrmTestResult> {
  const startsAt = new Date(nowMs + 24 * 60 * 60_000);
  const payload: CrmBookingPayload = {
    ...buildCrmBookingPayload({
      bookingReference: "connection-test",
      status: "CONFIRMED",
      version: 1,
      title: "TAP Calendar connection test",
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + 30 * 60_000).toISOString(),
      guestName: "Connection Test",
      guestEmail: "connection-test@example.com",
    }),
    dryRun: true,
  };
  const outcome = await postCrmBooking(fetchImpl, connection, payload, nowMs);
  switch (outcome.kind) {
    case "delivered": return { ok: true, reason: null };
    case "invalid_key": return { ok: false, reason: "invalid_key" };
    case "missing_scope": return { ok: false, reason: "missing_scope" };
    case "retry": return { ok: false, reason: "unreachable" };
    case "rejected": return { ok: false, reason: "rejected" };
  }
}
