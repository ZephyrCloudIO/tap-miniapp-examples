import type { CalendarEvent } from "./domain";

export type CalendarResponseStatus =
  | "needsAction"
  | "accepted"
  | "tentative"
  | "declined"
  | "unknown";

export const isCalendarResponseStatus = (value: unknown): value is CalendarResponseStatus =>
  value === "needsAction" || value === "accepted" || value === "tentative" ||
  value === "declined" || value === "unknown";

export const isAttendeeResponse = (value: {
  readonly responseStatus?: unknown;
  readonly isCurrentUser?: unknown;
}): boolean =>
  (value.responseStatus === undefined || isCalendarResponseStatus(value.responseStatus)) &&
  (value.isCurrentUser === undefined || typeof value.isCurrentUser === "boolean");

export const attendeeResponseLabels: Readonly<Record<CalendarResponseStatus, string>> = {
  needsAction: "Awaiting response",
  accepted: "Accepted",
  tentative: "Maybe",
  declined: "Declined",
  unknown: "Response unknown",
};

export const viewerResponseLabels: Readonly<Record<CalendarResponseStatus, string>> = {
  ...attendeeResponseLabels,
  needsAction: "Awaiting your response",
};

export function eventViewerResponse(event: Pick<CalendarEvent, "kind" | "attendees">): CalendarResponseStatus | undefined {
  const viewer = event.attendees.find(attendee => attendee.isCurrentUser === true);
  if (viewer) return viewer.responseStatus ?? "unknown";
  // Legacy projections and truncated attendee lists cannot prove acceptance.
  return event.kind === "meeting" && event.attendees.length > 0 ? "unknown" : undefined;
}
