import type { CalendarEvent } from "./domain";

export function mergeProviderEvent(local: CalendarEvent, provider: CalendarEvent): CalendarEvent {
  // TAP owns pending/rejected approval holds. Active meetings follow provider
  // responses even when their status changed since the original booking.
  if ((local.status !== "confirmed" && local.status !== "pending") ||
      local.kind === "hold" || provider.kind !== local.kind) return local;
  const localAttendees = new Map(local.attendees.map(attendee => [attendee.email.toLowerCase(), attendee]));
  return {
    ...provider,
    attendees: provider.attendees.map(attendee => {
      const known = localAttendees.get(attendee.email.toLowerCase());
      return known ? { ...attendee, id: known.id, name: known.name, kind: known.kind } : attendee;
    }),
    ...(local.source ? { source: local.source } : {}),
    ...(provider.providerHtmlLink ?? local.providerHtmlLink
      ? { providerHtmlLink: provider.providerHtmlLink ?? local.providerHtmlLink } : {}),
    ...(provider.providerJoinUrl ?? local.providerJoinUrl
      ? { providerJoinUrl: provider.providerJoinUrl ?? local.providerJoinUrl } : {}),
  };
}
