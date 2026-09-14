import type {
  PublicApiErrorBody,
  PublicBookingAvailability,
  PublicBookingManagement,
  PublicBookingManagementCancelRequest,
  PublicBookingManagementRescheduleRequest,
  PublicBookingPage,
  PublicBookingRequest,
  PublicBookingResult,
} from "./contracts";
import {
  isPublicApiErrorBody,
  isPublicBookingAvailability,
  isPublicBookingManagement,
  isPublicBookingPage,
  isPublicBookingResult,
  publicManagementTokenFromHash,
} from "./contracts";

export class PublicCalendarApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;

  constructor(message: string, options: { code: string; status: number; retryable?: boolean }) {
    super(message);
    this.name = "PublicCalendarApiError";
    this.code = options.code;
    this.status = options.status;
    this.retryable = options.retryable ?? false;
  }
}

function apiUrl(path: string): string {
  const configured = typeof __TAP_CALENDAR_PUBLIC_API_URL__ === "string"
    ? __TAP_CALENDAR_PUBLIC_API_URL__
    : "";
  const base = configured.trim().replace(/\/$/u, "");
  return base.length > 0 ? `${base}${path}` : path;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), {
    ...init,
    credentials: "omit",
    headers: {
      accept: "application/json",
      ...(init?.body === undefined ? {} : { "content-type": "application/json" }),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    let body: PublicApiErrorBody | null = null;
    try {
      const candidate: unknown = await response.json();
      body = isPublicApiErrorBody(candidate) ? candidate : null;
    } catch {
      // A reverse proxy may return a non-JSON body; keep the public error generic.
    }
    throw new PublicCalendarApiError(
      body?.message ?? (response.status === 404
        ? "This booking page is unavailable."
        : "TAP Calendar could not complete the request."),
      {
        code: body?.error ?? `http_${response.status}`,
        status: response.status,
        retryable: body?.retryable ?? response.status >= 500,
      },
    );
  }
  return response.json() as Promise<T>;
}

export function publicPagePath(profileSlug: string, eventTypeSlug: string): string {
  return `/api/public/pages/${encodeURIComponent(profileSlug)}/${encodeURIComponent(eventTypeSlug)}`;
}

export function loadPublicBookingPage(
  profileSlug: string,
  eventTypeSlug: string,
  signal?: AbortSignal,
): Promise<PublicBookingPage> {
  return requestJson<unknown>(
    publicPagePath(profileSlug, eventTypeSlug),
    signal ? { signal } : undefined,
  ).then(value => {
    if (isPublicBookingPage(value, profileSlug, eventTypeSlug)) return value;
    throw new PublicCalendarApiError("TAP Calendar returned an invalid booking page.", {
      code: "public_response_invalid",
      status: 502,
      retryable: true,
    });
  });
}

export function loadPublicAvailability(options: {
  profileSlug: string;
  eventTypeSlug: string;
  month: string;
  viewerTimeZone: string;
  pageRevision: string;
  signal?: AbortSignal;
}): Promise<PublicBookingAvailability> {
  const query = new URLSearchParams({
    month: options.month,
    timeZone: options.viewerTimeZone,
    pageRevision: options.pageRevision,
  });
  return requestJson<unknown>(
    `${publicPagePath(options.profileSlug, options.eventTypeSlug)}/availability?${query}`,
    options.signal ? { signal: options.signal } : undefined,
  ).then(value => {
    if (isPublicBookingAvailability(value, options.month, options.viewerTimeZone)) return value;
    throw new PublicCalendarApiError("TAP Calendar returned invalid availability.", {
      code: "public_response_invalid",
      status: 502,
      retryable: true,
    });
  });
}

export function createPublicBooking(options: {
  profileSlug: string;
  eventTypeSlug: string;
  request: PublicBookingRequest;
  signal?: AbortSignal;
}): Promise<PublicBookingResult> {
  return requestJson<unknown>(
    `${publicPagePath(options.profileSlug, options.eventTypeSlug)}/bookings`,
    {
      method: "POST",
      body: JSON.stringify(options.request),
      ...(options.signal ? { signal: options.signal } : {}),
    },
  ).then(value => {
    if (isPublicBookingResult(value)) return value;
    throw new PublicCalendarApiError("TAP Calendar returned an invalid booking confirmation.", {
      code: "public_response_invalid",
      status: 502,
      retryable: true,
    });
  });
}

const managementAuthorization = (token: string): HeadersInit => {
  if (!publicManagementTokenFromHash(token)) {
    throw new PublicCalendarApiError("This management link is invalid.", {
      code: "invalid_management_link",
      status: 400,
    });
  }
  return { Authorization: `Bearer ${token}` };
};

export function loadPublicBookingManagement(
  token: string,
  signal?: AbortSignal,
): Promise<PublicBookingManagement> {
  return requestJson<unknown>("/api/public/manage", {
    headers: managementAuthorization(token),
    ...(signal ? { signal } : {}),
  }).then(value => {
    if (isPublicBookingManagement(value)) return value;
    throw new PublicCalendarApiError("TAP Calendar returned an invalid booking.", {
      code: "public_response_invalid",
      status: 502,
      retryable: true,
    });
  });
}

export function cancelPublicBookingManagement(options: {
  token: string;
  request: PublicBookingManagementCancelRequest;
  signal?: AbortSignal;
}): Promise<PublicBookingManagement> {
  return requestJson<unknown>("/api/public/manage/cancel", {
    method: "POST",
    headers: managementAuthorization(options.token),
    body: JSON.stringify(options.request),
    ...(options.signal ? { signal: options.signal } : {}),
  }).then(value => {
    if (isPublicBookingManagement(value)) return value;
    throw new PublicCalendarApiError("TAP Calendar returned an invalid cancellation result.", {
      code: "public_response_invalid",
      status: 502,
      retryable: true,
    });
  });
}

export function reschedulePublicBookingManagement(options: {
  token: string;
  request: PublicBookingManagementRescheduleRequest;
  signal?: AbortSignal;
}): Promise<PublicBookingManagement> {
  return requestJson<unknown>("/api/public/manage/reschedule", {
    method: "POST",
    headers: managementAuthorization(options.token),
    body: JSON.stringify(options.request),
    ...(options.signal ? { signal: options.signal } : {}),
  }).then(value => {
    if (isPublicBookingManagement(value)) return value;
    throw new PublicCalendarApiError("TAP Calendar returned an invalid reschedule result.", {
      code: "public_response_invalid",
      status: 502,
      retryable: true,
    });
  });
}
