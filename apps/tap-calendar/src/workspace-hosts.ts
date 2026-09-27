import type { MiniAppWorkspaceMember } from "@theaiplatform/miniapp-sdk/sdk";
import type { CalendarState } from "./domain";
import type { SharedHostInput, WorkspaceBookings, WorkspaceHost } from "./workspace-bookings";

/** Membership supplies the roster; Calendar supplies connection and availability readiness. */
export function workspaceHosts(members: readonly MiniAppWorkspaceMember[], configured: readonly WorkspaceHost[]): readonly WorkspaceHost[] {
  const byId = new Map(configured.map(host => [host.principalId, host]));
  return members.map(member => ({
    principalId: member.userId, version: 0, email: "",
    calendarConnected: false, availabilityReady: false, zoomConnected: false,
    ...byId.get(member.userId),
    // The workspace directory owns the member's display identity.
    displayName: member.displayName,
  }));
}

export function sharedHostInput(state: CalendarState, own: WorkspaceBookings["self"], displayName: string): Extract<SharedHostInput, { enabled: true }> | null {
  const calendars = state.accounts.filter(account => account.provider === "google" && account.status === "connected").flatMap(account => account.calendars);
  const destination = own ? calendars.find(calendar => calendar.id === own.host.destinationCalendarId && calendar.writable)
    : calendars.find(calendar => calendar.destination && calendar.writable) ?? calendars.find(calendar => calendar.writable);
  const schedule = own ? state.availability.find(item => item.id === own.host.sourceAvailabilityScheduleId) : state.availability[0];
  if (!destination || !schedule || !displayName.trim()) return null;
  return {
    expectedVersion: own?.host.version ?? 0, enabled: true, displayName,
    destinationCalendarId: destination.id,
    conflictCalendarIds: [...new Set(calendars.filter(calendar => calendar.conflicts || calendar.id === destination.id).map(calendar => calendar.id))].sort(),
    sourceAvailabilityScheduleId: schedule.id,
    schedule: { timeZone: schedule.timezone, preferredStart: schedule.preferredStart, preferredEnd: schedule.preferredEnd,
      bufferBeforeMinutes: schedule.bufferBeforeMinutes, bufferAfterMinutes: schedule.bufferAfterMinutes,
      minimumNoticeMinutes: schedule.minimumNoticeMinutes, bookingHorizonDays: schedule.bookingHorizonDays,
      windows: schedule.windows.map(({ day, enabled, start, end }) => ({ day, enabled, start, end })),
      overrides: (schedule.overrides ?? []).map(override => ({ date: override.date, label: override.label, available: override.available,
        timeZone: override.timezone ?? schedule.timezone, ...(override.available ? { start: override.start!, end: override.end! } : {}) })),
    },
  };
}

const canonical = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) =>
  item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const normalizedSchedule = (schedule: Extract<SharedHostInput, { enabled: true }>["schedule"]) => ({
  ...schedule,
  windows: [...schedule.windows].sort((a, b) => a.day - b.day || a.start.localeCompare(b.start)),
  overrides: [...(schedule.overrides ?? [])].sort((a, b) => a.date.localeCompare(b.date)),
});

export function hostPolicyMatches(own: WorkspaceBookings["self"], input: Extract<SharedHostInput, { enabled: true }>): boolean {
  if (!own?.enabled) return false;
  const host = own.host;
  return host.displayName === input.displayName && host.destinationCalendarId === input.destinationCalendarId &&
    host.sourceAvailabilityScheduleId === input.sourceAvailabilityScheduleId &&
    JSON.stringify([...host.conflictCalendarIds].sort()) === JSON.stringify(input.conflictCalendarIds) &&
    canonical(normalizedSchedule(host.schedule)) === canonical(normalizedSchedule(input.schedule));
}
