import type {
  AvailabilityOverride,
  AvailabilitySchedule,
  AvailabilityWindow,
} from "./domain";

export interface AvailabilityForDate {
  readonly override: AvailabilityOverride | null;
  readonly timeZone: string;
  readonly windows: readonly Pick<AvailabilityWindow, "enabled" | "start" | "end">[];
}

/** Resolve the authoritative hours and wall-clock zone for one calendar date. */
export function availabilityForDate(
  schedule: AvailabilitySchedule,
  date: string,
): AvailabilityForDate {
  const override = schedule.overrides?.find(candidate => candidate.date === date) ?? null;
  if (override) {
    return {
      override,
      timeZone: override.timezone ?? schedule.timezone,
      windows: override.available && override.start && override.end
        ? [{ enabled: true, start: override.start, end: override.end }]
        : [],
    };
  }

  const parsedDate = new Date(`${date}T00:00:00.000Z`);
  const day = Number.isNaN(parsedDate.getTime()) ? -1 : parsedDate.getUTCDay();
  return {
    override: null,
    timeZone: schedule.timezone,
    windows: schedule.windows
      .filter(window => window.day === day && window.enabled)
      .map(window => ({ enabled: true, start: window.start, end: window.end })),
  };
}
