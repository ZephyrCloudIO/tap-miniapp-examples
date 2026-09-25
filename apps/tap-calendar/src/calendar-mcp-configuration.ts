import type { CalendarState } from "./domain";
import type { CalendarMcpConfiguration } from "./mcp-contract";

// Configuration only; no events, invitees, credentials, or mirrored analytics.
export function calendarMcpConfiguration(state: CalendarState): CalendarMcpConfiguration {
  return {
    conflictCalendarIds: state.accounts.flatMap(account => account.calendars)
      .filter(calendar => calendar.conflicts).map(calendar => calendar.id).sort(),
    eventTypes: state.bookingProfiles.flatMap(profile => profile.eventTypes.map(type => ({
      profileId: profile.id, id: type.id, title: type.title, description: type.description,
      durationMinutes: type.durationMinutes, active: type.active, approvalRequired: type.approvalRequired,
    }))),
  };
}
