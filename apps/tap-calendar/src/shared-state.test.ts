import { expect, it } from '@rstest/core';
import { createEmptyCalendarState } from './domain';
import { restoreCalendarConnections, calendarDocument, applyCalendarDocument, updateCalendarDocument, validCalendarDocument } from './shared-state';
import type { CalendarGatewayConnection } from './gateway';

const connection: CalendarGatewayConnection = {
  id: 'google', workspaceId: 'workspace', ownerPrincipalId: 'alice', provider: 'google', mode: 'oauth',
  label: 'Existing Google account', status: 'connected', createdAt: '2026-09-27T00:00:00Z', updatedAt: '2026-09-27T00:00:00Z', lastSyncedAt: null,
  calendars: [{ id: 'primary', providerCalendarId: 'primary', name: 'Work', color: '#123456', role: 'owner', writable: true, freshness: 'live', primary: true }],
};
it('a fresh device discovers an already connected calendar without OAuth or local accounts', () => {
  const state = restoreCalendarConnections(createEmptyCalendarState(), [connection]);
  expect(state.accounts[0]?.calendars[0]).toMatchObject({ id: 'primary', visible: true, conflicts: true, destination: true });
});
it('restores shared choices while taking connection status and permissions from the server', () => {
  const original = restoreCalendarConnections(createEmptyCalendarState(), [connection]);
  const changed = { ...original, accounts: original.accounts.map(account => ({ ...account, calendars: account.calendars.map(calendar => ({ ...calendar, visible: false, conflicts: false })) })) };
  const restored = applyCalendarDocument(createEmptyCalendarState(), calendarDocument(changed));
  const next = restoreCalendarConnections(restored, [{ ...connection, status: 'read-only', calendars: connection.calendars.map(calendar => ({ ...calendar, writable: false })) }]);
  expect(next.accounts[0]?.calendars[0]).toMatchObject({ visible: false, conflicts: false, writable: false, destination: false });
  expect(restoreCalendarConnections(next, []).accounts).toEqual([]);
});
it('device view and activity stay local while empty defaults do not overwrite a desktop migration', () => {
  expect(calendarDocument(createEmptyCalendarState(), true)).toEqual({});
  const local = { ...createEmptyCalendarState(), activeView: 'day' as const };
  expect(applyCalendarDocument(local, {}).activeView).toBe('day');
});

it('the first edit to a discovered account saves a complete account without seeding unrelated defaults', () => {
  const before = restoreCalendarConnections(createEmptyCalendarState(), [connection]);
  const after = { ...before, accounts: before.accounts.map(account => ({ ...account,
    calendars: account.calendars.map(calendar => ({ ...calendar, visible: false })) })) };
  const document = updateCalendarDocument(before, after, {});
  expect(validCalendarDocument(document)).toBe(true);
  expect(Object.keys(document)).toEqual(['accounts']);
  expect(applyCalendarDocument(createEmptyCalendarState(), document).accounts[0]?.calendars[0]).toMatchObject({ id: 'primary', visible: false });
});
