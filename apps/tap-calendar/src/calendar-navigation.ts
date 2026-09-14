import type { CalendarView } from "./domain";

export type CalendarRangeDirection = -1 | 1;

export interface CalendarWheelSample {
  readonly ctrlKey: boolean;
  readonly deltaMode: number;
  readonly deltaX: number;
  readonly deltaY: number;
  readonly shiftKey: boolean;
}

const calendarDateKey = (date: Date): string => date.toISOString().slice(0, 10);

const parseCalendarDate = (value: string): Date =>
  new Date(`${value}T12:00:00.000Z`);

const addCalendarDays = (value: string, amount: number): string => {
  const date = parseCalendarDate(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return calendarDateKey(date);
};

const addCalendarMonths = (value: string, amount: number): string => {
  const date = parseCalendarDate(value);
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + amount);
  return calendarDateKey(date);
};

export function shiftCalendarAnchor(
  view: CalendarView,
  anchorDate: string,
  direction: CalendarRangeDirection,
): string {
  if (view === "month") {
    return addCalendarMonths(anchorDate, direction);
  }
  const days = view === "day" || view === "team" ? 1 : view === "agenda" ? 30 : 7;
  return addCalendarDays(anchorDate, days * direction);
}

export function horizontalCalendarWheelDelta(
  sample: CalendarWheelSample,
  pageWidth: number,
): number | null {
  if (sample.ctrlKey) return null;

  const directHorizontal = Math.abs(sample.deltaX) > Math.abs(sample.deltaY);
  const shiftedVertical =
    sample.shiftKey && Math.abs(sample.deltaY) > Math.abs(sample.deltaX);
  const delta = directHorizontal
    ? sample.deltaX
    : shiftedVertical
      ? sample.deltaY
      : 0;
  if (delta === 0) return null;

  const multiplier =
    sample.deltaMode === 1
      ? 16
      : sample.deltaMode === 2
        ? Math.max(1, pageWidth)
        : 1;
  return delta * multiplier;
}
