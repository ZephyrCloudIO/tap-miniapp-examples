import { describe, expect, it } from '@rstest/core';
import {
  groupThreadsByDay,
  threadDayLabel,
  threadListTimestamp,
} from './thread-list-dates';

const now = new Date(2026, 8, 13, 16, 30);

function localIso(
  year: number,
  monthIndex: number,
  day: number,
  hour: number,
  minute: number,
): string {
  return new Date(year, monthIndex, day, hour, minute).toISOString();
}

describe('thread list dates', () => {
  it('uses semantic labels for the current and previous local calendar days', () => {
    expect(threadDayLabel(localIso(2026, 8, 13, 9, 5), now, 'en-US')).toBe('Today');
    expect(threadDayLabel(localIso(2026, 8, 12, 23, 45), now, 'en-US')).toBe('Yesterday');
    expect(threadDayLabel(localIso(2026, 8, 8, 12, 0), now, 'en-US'))
      .toBe('Tuesday, September 8');
    expect(threadDayLabel(localIso(2025, 11, 31, 12, 0), now, 'en-US'))
      .toBe('Wednesday, December 31, 2025');
  });

  it('shows only the time today and both date and time on every older row', () => {
    expect(threadListTimestamp(localIso(2026, 8, 13, 9, 5), now, 'en-US'))
      .toBe('9:05 AM');
    expect(threadListTimestamp(localIso(2026, 8, 12, 21, 7), now, 'en-US'))
      .toBe('Sep 12, 9:07 PM');
    expect(threadListTimestamp(localIso(2025, 11, 31, 21, 7), now, 'en-US'))
      .toBe('Dec 31, 2025, 9:07 PM');
  });

  it('creates a labelled group whenever the local day changes', () => {
    const today = { id: 'today', receivedAt: localIso(2026, 8, 13, 10, 0) };
    const yesterdayLate = { id: 'yesterday-late', receivedAt: localIso(2026, 8, 12, 23, 0) };
    const yesterdayEarly = { id: 'yesterday-early', receivedAt: localIso(2026, 8, 12, 8, 0) };
    const older = { id: 'older', receivedAt: localIso(2026, 8, 8, 17, 0) };

    const groups = groupThreadsByDay(
      [today, yesterdayLate, yesterdayEarly, older],
      now,
      'en-US',
    );

    expect(groups.map(group => ({
      label: group.label,
      ids: group.items.map(item => item.id),
    }))).toEqual([
      { label: 'Today', ids: ['today'] },
      { label: 'Yesterday', ids: ['yesterday-late', 'yesterday-early'] },
      { label: 'Tuesday, September 8', ids: ['older'] },
    ]);
  });
});
