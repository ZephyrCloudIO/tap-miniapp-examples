/** Shared, content-free contract. Safe to bundle in the storage-only QuickJS source. */
export const CALENDAR_ACTIVITY_SOURCE_ID = "tap-calendar-committed-actions";
export const CALENDAR_ACTIVITY_LIMIT = 2048;
export const CALENDAR_ACTIVITY_RETENTION_MS = 90 * 86_400_000;
export const calendarActivityTypes = [
  { id: "meeting-scheduled", name: "Meetings scheduled", statuses: ["confirmed"] },
  { id: "meeting-rescheduled", name: "Meetings rescheduled", statuses: ["completed"] },
  { id: "meeting-cancelled", name: "Meetings cancelled", statuses: ["completed"] },
  { id: "work-block-created", name: "Work blocks created", statuses: ["confirmed"] },
  { id: "booking-received", name: "Bookings received", statuses: ["confirmed", "pending"] },
  { id: "booking-decision", name: "Booking decisions", statuses: ["approved", "declined"] },
  { id: "booking-page", name: "Booking page changes", statuses: ["published", "updated", "unpublished"] },
  { id: "availability-updated", name: "Availability updates", statuses: ["saved"] },
] as const;
export type CalendarActivityId = typeof calendarActivityTypes[number]["id"];
export interface CalendarActivityEntry {
  readonly activityId: CalendarActivityId;
  readonly statusId: string;
  readonly occurredAt: string;
}
export interface CalendarActivityProjection {
  readonly schemaVersion: 1;
  readonly workspaceId: string;
  readonly userId: string;
  readonly availableFrom: string;
  readonly availableThrough: string;
  readonly entries: readonly CalendarActivityEntry[];
}
export interface AvailabilityActivityReceipt {
  readonly id: string;
  readonly workspaceId: string;
  readonly occurredAt: string;
}
export interface CalendarActivityJournal {
  readonly startedAt: string;
  readonly droppedBefore: string | null;
  readonly entries: readonly AvailabilityActivityReceipt[];
}
export function isActivityTimestamp(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function isCalendarActivityProjection(value: unknown): value is CalendarActivityProjection {
  return record(value) && Object.keys(value).length === 6 && value.schemaVersion === 1
    && typeof value.workspaceId === "string" && typeof value.userId === "string"
    && isActivityTimestamp(value.availableFrom) && isActivityTimestamp(value.availableThrough)
    && value.availableFrom <= value.availableThrough
    && Array.isArray(value.entries) && value.entries.length <= CALENDAR_ACTIVITY_LIMIT
    && value.entries.every(entry => record(entry) && Object.keys(entry).length === 3
      && isActivityTimestamp(entry.occurredAt) && entry.occurredAt <= value.availableThrough!
      && calendarActivityTypes.some(type => type.id === entry.activityId && (type.statuses as readonly unknown[]).includes(entry.statusId)));
}
export function isCalendarActivityJournal(value: unknown): value is CalendarActivityJournal {
  return record(value) && Object.keys(value).length === 3 && isActivityTimestamp(value.startedAt)
    && (value.droppedBefore === null || isActivityTimestamp(value.droppedBefore))
    && Array.isArray(value.entries) && value.entries.length <= 512
    && value.entries.every(entry => record(entry) && Object.keys(entry).length === 3
      && typeof entry.id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(entry.id)
      && typeof entry.workspaceId === "string" && entry.workspaceId.length > 0 && entry.workspaceId.length <= 255
      && isActivityTimestamp(entry.occurredAt));
}
export function calendarActivityAddress(userId: string, workspaceId: string) {
  if (![userId, workspaceId].every(id => id && id === id.trim() && id.length <= 255 && !/[\u0000-\u001f\u007f]/u.test(id))) {
    throw new Error("Calendar activity requires a trusted user and workspace.");
  }
  return { namespace: "tap-calendar", key: `users/${userId}/activity/v1` } as const;
}
