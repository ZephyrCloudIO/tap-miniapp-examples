import { equal, rebase, type Document } from '@tap-examples/tap-shared-state';
import { calendarDocument } from './shared-state-contract';
export { calendarDocument, validCalendarDocument, applyCalendarDocument } from './shared-state-contract';
import type { CalendarState } from './domain';
import type { CalendarGatewayConnection } from './gateway';

/** Provider facts always come from the authenticated gateway; user choices come
 * from shared settings. Deleted/revoked connections cannot survive in a cache. */
export function restoreCalendarConnections(state: CalendarState, connections: readonly CalendarGatewayConnection[]): CalendarState {
  return { ...state, accounts: connections.filter(connection => connection.status !== 'pending').map(connection => {
    const previous = state.accounts.find(account => account.id === connection.id);
    const destination = previous?.calendars.find(calendar => calendar.destination)?.id ??
      connection.calendars.find(calendar => calendar.primary && calendar.writable)?.id;
    return { id: connection.id, provider: connection.provider, label: connection.label,
      status: connection.status === 'pending' ? 'attention' : connection.status,
      calendars: connection.calendars.map(calendar => {
        const choice = previous?.calendars.find(item => item.id === calendar.id);
        return { ...calendar, accountId: connection.id, color: choice?.color ?? calendar.color,
          visible: choice?.visible ?? true, conflicts: choice?.conflicts ?? calendar.freshness !== 'stale',
          destination: calendar.writable && calendar.id === destination };
      }) };
  }) };
}

/** Provider-discovered accounts have no shared baseline until the first edit.
 * Seed only the edited field so a partial edit preserves its required facts
 * without publishing untouched defaults over a later desktop migration. */
export function updateCalendarDocument(before: CalendarState, after: CalendarState, remote: Document): Document {
  const base = calendarDocument(before); const local = calendarDocument(after);
  const seeded = { ...remote };
  for (const key of Object.keys(local)) {
    if (seeded[key] === undefined && !equal(base[key], local[key])) seeded[key] = base[key]!;
  }
  return rebase(base, local, seeded);
}
