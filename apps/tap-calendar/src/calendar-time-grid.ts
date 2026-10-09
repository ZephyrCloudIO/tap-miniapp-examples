import type { CalendarEvent } from "./domain";

export const CALENDAR_DAY_MINUTES = 24 * 60;
export const CALENDAR_HOUR_HEIGHT_PX = 60;
export const DEFAULT_CALENDAR_SCROLL_HOUR = 7;
const MINIMUM_CALENDAR_EVENT_HEIGHT_MINUTES = 30;

export const calendarLocalMinutes = (iso: string): number => {
  const date = new Date(iso);
  return date.getHours() * 60 + date.getMinutes();
};

export const calendarLocalDate = (iso: string): string => {
  const date = new Date(iso);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
};

export const calendarGridHourLabel = (hour: number): string => {
  const normalized = ((hour % 24) + 24) % 24;
  const displayHour = normalized === 0 ? 12 : normalized > 12 ? normalized - 12 : normalized;
  return `${displayHour}:00 ${normalized >= 12 ? "PM" : "AM"}`;
};

export interface TimeGridEventLayout {
  readonly heightPercentage: number;
  readonly topPercentage: number;
}

export interface TimeGridEventPlacement extends TimeGridEventLayout {
  /** Zero-based column the event starts in within its overlap cluster. */
  readonly column: number;
  /** Columns the event spans, widened into neighbours it does not overlap. */
  readonly columnSpan: number;
  /** Columns in the event's overlap cluster. */
  readonly columnCount: number;
  /** Too short for stacked title and time lines. */
  readonly compact: boolean;
}

interface TimeGridEventMinutes {
  readonly start: number;
  readonly end: number;
}

const visibleEventMinutes = (
  event: Pick<CalendarEvent, "start" | "end">,
): TimeGridEventMinutes => {
  const startDate = new Date(event.start);
  const endDate = new Date(event.end);
  if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime())) {
    return { start: 0, end: 0 };
  }

  const startMinute = Math.min(
    CALENDAR_DAY_MINUTES,
    Math.max(0, calendarLocalMinutes(event.start)),
  );
  const localEndMinute = calendarLocalDate(event.end) === calendarLocalDate(event.start)
    ? calendarLocalMinutes(event.end)
    : CALENDAR_DAY_MINUTES;
  const elapsedMinutes = Math.max(0, (endDate.getTime() - startDate.getTime()) / 60_000);
  const endMinute = Math.min(
    CALENDAR_DAY_MINUTES,
    Math.max(
      startMinute,
      localEndMinute > startMinute
        ? localEndMinute
        : startMinute + elapsedMinutes,
    ),
  );

  const visualDuration = Math.min(
    CALENDAR_DAY_MINUTES,
    Math.max(endMinute - startMinute, MINIMUM_CALENDAR_EVENT_HEIGHT_MINUTES),
  );
  const visualStart = Math.min(
    startMinute,
    CALENDAR_DAY_MINUTES - visualDuration,
  );
  return { start: visualStart, end: visualStart + visualDuration };
};

const layoutFromMinutes = ({ start, end }: TimeGridEventMinutes): TimeGridEventLayout => ({
  topPercentage: (start / CALENDAR_DAY_MINUTES) * 100,
  heightPercentage: ((end - start) / CALENDAR_DAY_MINUTES) * 100,
});

/** Clamp a timed event to the 24-hour wall-clock grid for its starting day. */
export function timeGridEventLayout(
  event: Pick<CalendarEvent, "start" | "end">,
): TimeGridEventLayout {
  return layoutFromMinutes(visibleEventMinutes(event));
}

/**
 * Place one day's timed events side by side. Events whose rendered boxes
 * overlap, directly or through a chain, form a cluster that shares its width:
 * each event takes the first free column, then widens to the right across
 * columns it does not collide with.
 */
export function timeGridDayPlacements(
  events: readonly Pick<CalendarEvent, "id" | "start" | "end">[],
): ReadonlyMap<string, TimeGridEventPlacement> {
  const items = events
    .map(event => ({ id: event.id, ...visibleEventMinutes(event), column: 0 }))
    .sort((left, right) => left.start - right.start || right.end - left.end || left.id.localeCompare(right.id));
  const placements = new Map<string, TimeGridEventPlacement>();
  const overlaps = (left: TimeGridEventMinutes, right: TimeGridEventMinutes) =>
    left.start < right.end && right.start < left.end;
  let cluster: typeof items = [];
  let columnEnds: number[] = [];
  let clusterEnd = -Infinity;
  const placeCluster = () => {
    for (const item of cluster) {
      let columnSpan = 1;
      while (
        item.column + columnSpan < columnEnds.length &&
        !cluster.some(other => other.column === item.column + columnSpan && overlaps(item, other))
      ) columnSpan += 1;
      placements.set(item.id, {
        ...layoutFromMinutes(item),
        column: item.column,
        columnSpan,
        columnCount: columnEnds.length,
        compact: item.end - item.start <= MINIMUM_CALENDAR_EVENT_HEIGHT_MINUTES,
      });
    }
    cluster = [];
    columnEnds = [];
  };
  for (const item of items) {
    if (item.start >= clusterEnd) placeCluster();
    const freeColumn = columnEnds.findIndex(end => end <= item.start);
    item.column = freeColumn === -1 ? columnEnds.length : freeColumn;
    columnEnds[item.column] = item.end;
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  placeCluster();
  return placements;
}

export const timeGridNowPercentage = (now: Date): number =>
  ((now.getHours() * 60 + now.getMinutes()) / CALENDAR_DAY_MINUTES) * 100;
