export const PUBLIC_PAGE_SCHEMA_VERSION = "tap.calendar.public-page.v1" as const;
export const PUBLIC_AVAILABILITY_SCHEMA_VERSION = "tap.calendar.public-availability.v1" as const;
export const PUBLIC_BOOKING_SCHEMA_VERSION = "tap.calendar.public-booking.v1" as const;
export const PUBLIC_MANAGEMENT_SCHEMA_VERSION = "tap.calendar.public-management.v1" as const;
export const PUBLIC_MANAGEMENT_CANCEL_SCHEMA_VERSION =
  "tap.calendar.public-management-cancel.v1" as const;
export const PUBLIC_MANAGEMENT_RESCHEDULE_SCHEMA_VERSION =
  "tap.calendar.public-management-reschedule.v1" as const;

export type PublicMeetingLocation = "google-meet" | "phone" | "in-person" | "custom";

export interface PublicBookingPage {
  readonly schemaVersion: typeof PUBLIC_PAGE_SCHEMA_VERSION;
  readonly pageRevision: string;
  readonly canonicalUrl: string;
  readonly profile: {
    readonly displayName: string;
    readonly initials: string;
  };
  readonly eventType: {
    readonly title: string;
    readonly description?: string;
    readonly durationMinutes: number;
    readonly location: PublicMeetingLocation;
    readonly locationLabel: string;
    readonly approvalRequired: boolean;
  };
  readonly bookingWindow: {
    readonly firstDate: string;
    readonly lastDate: string;
  };
  readonly turnstile: {
    readonly siteKey: string;
  };
}

export interface PublicBookingSlot {
  readonly start: string;
  readonly end: string;
  /** Opaque, short-lived server proof binding this slot to the page revision. */
  readonly token: string;
}

export interface PublicBookingDate {
  readonly date: string;
  readonly slots: readonly PublicBookingSlot[];
}

export interface PublicBookingAvailability {
  readonly schemaVersion: typeof PUBLIC_AVAILABILITY_SCHEMA_VERSION;
  readonly pageRevision: string;
  readonly viewerTimeZone: string;
  readonly month: string;
  readonly generatedAt: string;
  readonly expiresAt: string;
  readonly dates: readonly PublicBookingDate[];
}

export interface PublicBookingRequest {
  readonly schemaVersion: typeof PUBLIC_BOOKING_SCHEMA_VERSION;
  readonly requestId: string;
  readonly slotToken: string;
  readonly guest: {
    readonly name: string;
    readonly email: string;
  };
  readonly turnstileToken: string;
}

export interface PublicBookingResult {
  readonly schemaVersion: typeof PUBLIC_BOOKING_SCHEMA_VERSION;
  readonly status: "confirmed" | "pending";
  readonly bookingReference: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly managementUrl: string;
}

export type PublicManagedBookingStatus =
  | "pending"
  | "confirmed"
  | "cancelled"
  | "declined"
  | "expired";

export interface PublicBookingManagement {
  readonly schemaVersion: typeof PUBLIC_MANAGEMENT_SCHEMA_VERSION;
  readonly bookingVersion: number;
  readonly bookingReference: string;
  readonly status: PublicManagedBookingStatus;
  readonly guest: {
    readonly name: string;
    readonly email: string;
  };
  readonly host: {
    readonly displayName: string;
  };
  readonly event: {
    readonly title: string;
    readonly startsAt: string;
    readonly endsAt: string;
    readonly durationMinutes: number;
    readonly location: PublicMeetingLocation;
    readonly locationLabel: string;
    readonly joinUrl?: string;
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

export interface PublicBookingManagementCancelRequest {
  readonly schemaVersion: typeof PUBLIC_MANAGEMENT_CANCEL_SCHEMA_VERSION;
  readonly requestId: string;
  readonly expectedVersion: number;
}

export interface PublicBookingManagementRescheduleRequest {
  readonly schemaVersion: typeof PUBLIC_MANAGEMENT_RESCHEDULE_SCHEMA_VERSION;
  readonly requestId: string;
  readonly expectedVersion: number;
  readonly slotToken: string;
  readonly turnstileToken: string;
}

export interface PublicApiErrorBody {
  readonly error: string;
  readonly message: string;
  readonly retryable?: boolean;
}

const PUBLIC_BOOKING_ORIGIN = "https://cal.with-tap.ai";
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const MANAGEMENT_TOKEN = /^tapm_v1_[A-Za-z0-9_-]{32,128}$/u;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const boundedText = (value: unknown, maximum = 4096): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= maximum;
const validInstant = (value: unknown): value is string =>
  boundedText(value, 64) && Number.isFinite(Date.parse(value));
const validCalendarDate = (value: unknown): value is string => {
  if (!boundedText(value, 10) || !CALENDAR_DATE.test(value)) return false;
  const instant = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(instant) && new Date(instant).toISOString().slice(0, 10) === value;
};
const exactPublicUrl = (value: unknown, pathname: string): boolean => {
  if (!boundedText(value, 2048)) return false;
  try {
    const url = new URL(value);
    return url.origin === PUBLIC_BOOKING_ORIGIN &&
      url.pathname === pathname && !url.search && !url.hash &&
      !url.username && !url.password;
  } catch {
    return false;
  }
};

export function isPublicApiErrorBody(value: unknown): value is PublicApiErrorBody {
  return isRecord(value) &&
    boundedText(value.error, 128) &&
    boundedText(value.message, 1000) &&
    (value.retryable === undefined || typeof value.retryable === "boolean");
}

export function isPublicBookingPage(
  value: unknown,
  profileSlug: string,
  eventTypeSlug: string,
): value is PublicBookingPage {
  if (!isRecord(value) || value.schemaVersion !== PUBLIC_PAGE_SCHEMA_VERSION ||
    !boundedText(value.pageRevision, 255) || !isRecord(value.profile) ||
    !boundedText(value.profile.displayName, 160) ||
    !boundedText(value.profile.initials, 12) || !isRecord(value.eventType) ||
    !boundedText(value.eventType.title, 160) ||
    !(value.eventType.description === undefined || typeof value.eventType.description === "string") ||
    !Number.isInteger(value.eventType.durationMinutes) ||
    Number(value.eventType.durationMinutes) < 5 || Number(value.eventType.durationMinutes) > 1440 ||
    !["google-meet", "phone", "in-person", "custom"].includes(String(value.eventType.location)) ||
    !boundedText(value.eventType.locationLabel, 160) ||
    typeof value.eventType.approvalRequired !== "boolean" ||
    !isRecord(value.bookingWindow) ||
    !validCalendarDate(value.bookingWindow.firstDate) ||
    !validCalendarDate(value.bookingWindow.lastDate) ||
    value.bookingWindow.firstDate > value.bookingWindow.lastDate ||
    !isRecord(value.turnstile) || !boundedText(value.turnstile.siteKey, 2048)) {
    return false;
  }
  return exactPublicUrl(
    value.canonicalUrl,
    `/${encodeURIComponent(profileSlug)}/${encodeURIComponent(eventTypeSlug)}`,
  );
}

export function isPublicBookingAvailability(
  value: unknown,
  month: string,
  viewerTimeZone: string,
): value is PublicBookingAvailability {
  if (!isRecord(value) || value.schemaVersion !== PUBLIC_AVAILABILITY_SCHEMA_VERSION ||
    !boundedText(value.pageRevision, 255) || value.viewerTimeZone !== viewerTimeZone ||
    value.month !== month || !validCalendarDate(value.month) || !value.month.endsWith("-01") ||
    !validInstant(value.generatedAt) || !validInstant(value.expiresAt) ||
    Date.parse(value.expiresAt) <= Date.parse(value.generatedAt) ||
    !Array.isArray(value.dates) || value.dates.length > 31) return false;
  const dates = new Set<string>();
  const tokens = new Set<string>();
  const intervals = new Set<string>();
  for (const candidate of value.dates) {
    if (!isRecord(candidate) || !validCalendarDate(candidate.date) ||
      candidate.date.slice(0, 7) !== month.slice(0, 7) || dates.has(candidate.date) ||
      !Array.isArray(candidate.slots) || candidate.slots.length > 288) return false;
    dates.add(candidate.date);
    for (const slot of candidate.slots) {
      if (!isRecord(slot) || !validInstant(slot.start) || !validInstant(slot.end) ||
        Date.parse(slot.end) <= Date.parse(slot.start) ||
        !boundedText(slot.token, 4096) || slot.token.length < 16 || tokens.has(slot.token)) {
        return false;
      }
      const interval = `${slot.start}\u0000${slot.end}`;
      if (intervals.has(interval)) return false;
      tokens.add(slot.token);
      intervals.add(interval);
    }
  }
  return true;
}

export function isPublicBookingResult(value: unknown): value is PublicBookingResult {
  if (!isRecord(value) || value.schemaVersion !== PUBLIC_BOOKING_SCHEMA_VERSION ||
    (value.status !== "confirmed" && value.status !== "pending") ||
    !boundedText(value.bookingReference, 255) ||
    !validInstant(value.startsAt) || !validInstant(value.endsAt) ||
    Date.parse(value.endsAt) <= Date.parse(value.startsAt)) return false;
  if (!boundedText(value.managementUrl, 2048)) return false;
  try {
    const url = new URL(value.managementUrl);
    return url.origin === PUBLIC_BOOKING_ORIGIN && url.pathname === "/manage" &&
      !url.search && MANAGEMENT_TOKEN.test(url.hash.slice(1)) &&
      !url.username && !url.password;
  } catch {
    return false;
  }
}

export function publicManagementTokenFromHash(hash: string): string | null {
  const value = hash.startsWith("#") ? hash.slice(1) : hash;
  return MANAGEMENT_TOKEN.test(value) ? value : null;
}

const validJoinUrl = (value: unknown, location: unknown): boolean => {
  if (value === undefined) return true;
  if (location !== "google-meet" || !boundedText(value, 2048)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "meet.google.com" &&
      url.pathname.length > 1 && !url.username && !url.password;
  } catch {
    return false;
  }
};

export function isPublicBookingManagement(value: unknown): value is PublicBookingManagement {
  if (
    !isRecord(value) || value.schemaVersion !== PUBLIC_MANAGEMENT_SCHEMA_VERSION ||
    !Number.isInteger(value.bookingVersion) || Number(value.bookingVersion) < 1 ||
    !boundedText(value.bookingReference, 128) ||
    !["pending", "confirmed", "cancelled", "declined", "expired"].includes(String(value.status)) ||
    !isRecord(value.guest) || !boundedText(value.guest.name, 160) ||
    !boundedText(value.guest.email, 320) || !isRecord(value.host) ||
    !boundedText(value.host.displayName, 160) || !isRecord(value.event) ||
    !boundedText(value.event.title, 160) || !validInstant(value.event.startsAt) ||
    !validInstant(value.event.endsAt) || Date.parse(value.event.endsAt) <= Date.parse(value.event.startsAt) ||
    !Number.isInteger(value.event.durationMinutes) || Number(value.event.durationMinutes) < 5 ||
    Number(value.event.durationMinutes) > 1_440 ||
    Date.parse(value.event.endsAt) - Date.parse(value.event.startsAt) !==
      Number(value.event.durationMinutes) * 60_000 ||
    !["google-meet", "phone", "in-person", "custom"].includes(String(value.event.location)) ||
    !boundedText(value.event.locationLabel, 160) ||
    !validJoinUrl(value.event.joinUrl, value.event.location) ||
    !(value.event.approvalExpiresAt === null || validInstant(value.event.approvalExpiresAt)) ||
    !isRecord(value.actions) || typeof value.actions.canCancel !== "boolean" ||
    typeof value.actions.canReschedule !== "boolean"
  ) return false;

  const terminal = ["cancelled", "declined", "expired"].includes(String(value.status));
  if (terminal && (value.actions.canCancel || value.actions.canReschedule)) return false;
  if (value.status !== "confirmed" && value.actions.canReschedule) return false;
  if (value.reschedulePage === null) return !value.actions.canReschedule;
  if (!isRecord(value.reschedulePage)) return false;
  const page = value.reschedulePage;
  return boundedText(page.profileSlug, 64) && SLUG.test(page.profileSlug) &&
    boundedText(page.eventTypeSlug, 64) && SLUG.test(page.eventTypeSlug) &&
    boundedText(page.pageRevision, 255) && isRecord(page.bookingWindow) &&
    validCalendarDate(page.bookingWindow.firstDate) && validCalendarDate(page.bookingWindow.lastDate) &&
    page.bookingWindow.firstDate <= page.bookingWindow.lastDate &&
    boundedText(page.turnstileSiteKey, 2048);
}
