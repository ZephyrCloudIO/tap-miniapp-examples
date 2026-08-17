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

/** Clamp a timed event to the 24-hour wall-clock grid for its starting day. */
export function timeGridEventLayout(
  event: Pick<CalendarEvent, "start" | "end">,
): TimeGridEventLayout {
  const startDate = new Date(event.start);
  const endDate = new Date(event.end);
  if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime())) {
    return { topPercentage: 0, heightPercentage: 0 };
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
  return {
    topPercentage: (visualStart / CALENDAR_DAY_MINUTES) * 100,
    heightPercentage: (visualDuration / CALENDAR_DAY_MINUTES) * 100,
  };
}

export const timeGridNowPercentage = (now: Date): number =>
  ((now.getHours() * 60 + now.getMinutes()) / CALENDAR_DAY_MINUTES) * 100;
