import { equal, isDocument, type Document } from '@tap-examples/tap-shared-state';
import { createEmptyCalendarState, isCalendarState, type CalendarState } from './domain';

const fields = ['accounts', 'events', 'availability', 'activeAvailabilityId', 'bookingProfiles',
  'bookingRequests', 'notificationPreferences', 'notificationChannels', 'workflowNodes'] as const;
export function calendarDocument(state: CalendarState, migration = false): Document {
  const defaults = createEmptyCalendarState();
  return JSON.parse(JSON.stringify(Object.fromEntries(fields
    .filter(key => !migration || !equal(state[key], defaults[key]))
    .map(key => [key, state[key]]))));
}
export function validCalendarDocument(value: unknown): value is Document {
  return isDocument(value) && Object.keys(value).every(key => fields.some(field => field === key)) &&
    isCalendarState({ ...createEmptyCalendarState(), ...value });
}
export function applyCalendarDocument(local: CalendarState, value: Document): CalendarState {
  const merged: unknown = { ...createEmptyCalendarState(), ...value,
    activeView: local.activeView, ...(local.activityJournal ? { activityJournal: local.activityJournal } : {}) };
  if (!validCalendarDocument(value) || !isCalendarState(merged)) throw new Error('Shared Calendar settings are invalid.');
  return merged;
}
