import type { CalendarState } from "./domain";
import { CALENDAR_ACTIVITY_RETENTION_MS, type CalendarActivityJournal } from "./activity-contract";

/** Stable policy serialization excludes display names and UI selection. */
export function availabilityActivityFingerprint(state: CalendarState): string {
  return JSON.stringify({ schedules: state.availability.map(({ name: _name, ...schedule }) => ({
    ...schedule,
    windows: [...schedule.windows].sort((a, b) => a.day - b.day || a.start.localeCompare(b.start) || a.end.localeCompare(b.end)),
    overrides: (schedule.overrides ?? []).map(({ label: _label, ...override }) => override).sort((a, b) => a.date.localeCompare(b.date)),
  })).sort((a, b) => a.id.localeCompare(b.id)),
  eventPolicies: state.bookingProfiles.flatMap(profile => profile.eventTypes.map(event => ({
    profileId: profile.id, id: event.id, durationMinutes: event.durationMinutes,
    approvalRequired: event.approvalRequired, destinationCalendarId: event.destinationCalendarId,
    availabilityScheduleId: event.availabilityScheduleId ?? state.activeAvailabilityId,
  }))).sort((a, b) => a.profileId.localeCompare(b.profileId) || a.id.localeCompare(b.id)) });
}

export function appendAvailabilityActivity(previous: CalendarState, next: CalendarState, workspaceId: string,
  now = new Date().toISOString(), id = crypto.randomUUID()): CalendarState {
  if (!workspaceId) throw new Error("Calendar activity requires a workspace.");
  const journal: CalendarActivityJournal = previous.activityJournal ?? { startedAt: now, droppedBefore: null, entries: [] };
  if (availabilityActivityFingerprint(previous) === availabilityActivityFingerprint(next)) {
    return { ...next, activityJournal: journal };
  }
  const cutoff = new Date(Date.parse(now) - CALENDAR_ACTIVITY_RETENTION_MS).toISOString();
  const entries = [...journal.entries.filter(entry => entry.occurredAt >= cutoff), { id, workspaceId, occurredAt: now }];
  const removed = entries.length > 512 ? entries.slice(0, -512) : [];
  const droppedBefore = removed.reduce((boundary, entry) => {
    const nextBoundary = new Date(Date.parse(entry.occurredAt) + 1).toISOString();
    return !boundary || nextBoundary > boundary ? nextBoundary : boundary;
  }, journal.droppedBefore);
  return { ...next, activityJournal: { ...journal, droppedBefore, entries: entries.slice(-512) } };
}
