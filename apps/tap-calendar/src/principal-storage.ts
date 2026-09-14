import type { MiniAppStorageAddress } from "@theaiplatform/miniapp-sdk/sdk";

declare const __TAP_CALENDAR_LEGACY_OWNER_PRINCIPAL_ID__: string | undefined;

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/u;
const MAX_PRINCIPAL_ID_LENGTH = 512;

export const legacyCalendarStorageAddresses = Object.freeze({
  state: Object.freeze({
    namespace: "tap-calendar",
    key: "calendar-state/v2",
  }),
  eventCache: Object.freeze({
    namespace: "tap-calendar",
    key: "provider-event-cache/v1",
  }),
  bookingOutbox: Object.freeze({
    namespace: "tap-calendar",
    key: "provider-booking-outbox/v1",
  }),
} satisfies Readonly<Record<string, MiniAppStorageAddress>>);

export interface CalendarPrincipalStorageAddresses {
  readonly state: MiniAppStorageAddress;
  readonly eventCache: MiniAppStorageAddress;
  readonly bookingOutbox: MiniAppStorageAddress;
}

export function canonicalCalendarPrincipalId(principalId: string): string {
  const normalized = principalId.trim();
  if (
    !normalized ||
    normalized !== principalId ||
    normalized.length > MAX_PRINCIPAL_ID_LENGTH ||
    CONTROL_CHARACTER.test(normalized)
  ) {
    throw new Error("TAP Calendar requires a valid canonical user identity.");
  }
  return normalized;
}

export function calendarPrincipalStorageAddresses(
  principalId: string,
): CalendarPrincipalStorageAddresses {
  const principal = canonicalCalendarPrincipalId(principalId);
  const prefix = `users/${principal}`;
  return {
    state: {
      namespace: "tap-calendar",
      key: `${prefix}/calendar-state/v2`,
    },
    eventCache: {
      namespace: "tap-calendar",
      key: `${prefix}/provider-event-cache/v1`,
    },
    bookingOutbox: {
      namespace: "tap-calendar",
      key: `${prefix}/provider-booking-outbox/v1`,
    },
  };
}

export function configuredCalendarLegacyOwnerPrincipalId(): string | null {
  const configured = typeof __TAP_CALENDAR_LEGACY_OWNER_PRINCIPAL_ID__ === "string"
    ? __TAP_CALENDAR_LEGACY_OWNER_PRINCIPAL_ID__.trim()
    : "";
  if (!configured) return null;
  try {
    return canonicalCalendarPrincipalId(configured);
  } catch {
    return null;
  }
}

export function mayAdoptLegacyCalendarStorage(principalId: string): boolean {
  const configured = configuredCalendarLegacyOwnerPrincipalId();
  return configured !== null && configured === canonicalCalendarPrincipalId(principalId);
}
