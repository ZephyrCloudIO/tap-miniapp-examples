const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;

export function parseCalendarDate(value: string): Date {
  const match = CALENDAR_DATE.exec(value);
  if (!match) throw new Error("Calendar date must use YYYY-MM-DD.");
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

export function calendarDateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function addCalendarDays(value: string, days: number): string {
  const next = parseCalendarDate(value);
  next.setUTCDate(next.getUTCDate() + days);
  return calendarDateKey(next);
}

export function addCalendarMonths(value: string, months: number): string {
  const current = parseCalendarDate(value);
  current.setUTCDate(1);
  current.setUTCMonth(current.getUTCMonth() + months);
  return calendarDateKey(current);
}

export function calendarDateInTimeZone(value: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const year = parts.find(part => part.type === "year")?.value;
  const month = parts.find(part => part.type === "month")?.value;
  const day = parts.find(part => part.type === "day")?.value;
  if (!year || !month || !day) throw new Error("Viewer time zone could not be resolved.");
  return `${year}-${month}-${day}`;
}

export function detectedTimeZone(): string {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function monthStartForDate(value: string): string {
  return `${value.slice(0, 7)}-01`;
}

/**
 * Published booking-window dates are host-local. A valid host slot can land in
 * the adjacent month for a viewer across the International Date Line, so the
 * guest calendar deliberately permits one month of safe edge navigation.
 */
export function viewerBookingMonthBounds(firstHostDate: string, lastHostDate: string): {
  readonly firstMonth: string;
  readonly lastMonth: string;
} {
  return {
    firstMonth: addCalendarMonths(monthStartForDate(firstHostDate), -1),
    lastMonth: addCalendarMonths(monthStartForDate(lastHostDate), 1),
  };
}
