import type { CalendarEvent } from "./domain";

type DailyTimeEvent = Pick<
  CalendarEvent,
  "allDay" | "busy" | "end" | "kind" | "start" | "status"
>;

interface TimeInterval {
  readonly start: number;
  readonly end: number;
}

export interface DailyTimeTotals {
  /** Confirmed meetings and appointments. Overlapping meetings count once. */
  readonly meetingMinutes: number;
  /** Confirmed Work Blocks and focus events, excluding time overlapped by meetings. */
  readonly focusedWorkMinutes: number;
  /** Time where focused work and a meeting were scheduled concurrently. */
  readonly overlapMinutes: number;
  /** Union of meeting and focused-work time. */
  readonly totalMinutes: number;
}

export interface DailyTimeAllocation {
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly asOf: string;
  /** Full local-day schedule. */
  readonly scheduled: DailyTimeTotals;
  /** Scheduled time that had elapsed by `asOf`; this does not prove attendance. */
  readonly elapsed: DailyTimeTotals;
  readonly eventCounts: {
    readonly meetings: number;
    readonly workBlocks: number;
    readonly focusBlocks: number;
  };
}

export interface DailyTimeAllocationInput {
  readonly events: readonly DailyTimeEvent[];
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly asOf: number;
}

function mergeIntervals(intervals: readonly TimeInterval[]): readonly TimeInterval[] {
  const ordered = [...intervals].sort(
    (left, right) => left.start - right.start || left.end - right.end,
  );
  const merged: TimeInterval[] = [];
  for (const interval of ordered) {
    const previous = merged[merged.length - 1];
    if (!previous || interval.start > previous.end) {
      merged.push(interval);
      continue;
    }
    if (interval.end > previous.end) {
      merged[merged.length - 1] = { start: previous.start, end: interval.end };
    }
  }
  return merged;
}

const duration = (intervals: readonly TimeInterval[]): number =>
  intervals.reduce((total, interval) => total + interval.end - interval.start, 0);

function intersectionDuration(
  left: readonly TimeInterval[],
  right: readonly TimeInterval[],
): number {
  let leftIndex = 0;
  let rightIndex = 0;
  let total = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftInterval = left[leftIndex]!;
    const rightInterval = right[rightIndex]!;
    total += Math.max(
      0,
      Math.min(leftInterval.end, rightInterval.end) -
        Math.max(leftInterval.start, rightInterval.start),
    );
    if (leftInterval.end <= rightInterval.end) leftIndex += 1;
    else rightIndex += 1;
  }
  return total;
}

const minutes = (milliseconds: number): number =>
  Math.round(milliseconds / 60_000);

function totals(
  meetingIntervals: readonly TimeInterval[],
  workIntervals: readonly TimeInterval[],
): DailyTimeTotals {
  const meetings = mergeIntervals(meetingIntervals);
  const work = mergeIntervals(workIntervals);
  const meetingDuration = duration(meetings);
  const rawWorkDuration = duration(work);
  const overlapDuration = intersectionDuration(meetings, work);
  const focusedWorkDuration = Math.max(0, rawWorkDuration - overlapDuration);
  return {
    meetingMinutes: minutes(meetingDuration),
    focusedWorkMinutes: minutes(focusedWorkDuration),
    overlapMinutes: minutes(overlapDuration),
    totalMinutes: minutes(meetingDuration + focusedWorkDuration),
  };
}

function clippedInterval(
  event: DailyTimeEvent,
  periodStart: number,
  periodEnd: number,
): TimeInterval | null {
  const start = Date.parse(event.start);
  const end = Date.parse(event.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  const clippedStart = Math.max(start, periodStart);
  const clippedEnd = Math.min(end, periodEnd);
  return clippedEnd > clippedStart
    ? { start: clippedStart, end: clippedEnd }
    : null;
}

/**
 * Aggregate calendar-derived time without exposing event details. Meeting time
 * wins when a meeting overlaps focused work, so headline totals never double
 * count the same instant.
 */
export function calculateDailyTimeAllocation(
  input: DailyTimeAllocationInput,
): DailyTimeAllocation {
  const periodStart = Date.parse(input.periodStart);
  const periodEnd = Date.parse(input.periodEnd);
  if (
    !Number.isFinite(periodStart) ||
    !Number.isFinite(periodEnd) ||
    periodEnd <= periodStart ||
    !Number.isFinite(input.asOf)
  ) {
    throw new Error("Daily time allocation requires a valid period and as-of instant.");
  }

  const scheduledMeetings: TimeInterval[] = [];
  const scheduledWork: TimeInterval[] = [];
  const elapsedMeetings: TimeInterval[] = [];
  const elapsedWork: TimeInterval[] = [];
  let meetings = 0;
  let workBlocks = 0;
  let focusBlocks = 0;
  const elapsedEnd = Math.min(periodEnd, Math.max(periodStart, input.asOf));

  for (const event of input.events) {
    if (
      event.status !== "confirmed" ||
      event.busy === false ||
      event.allDay === true ||
      event.kind === "hold"
    ) {
      continue;
    }
    const interval = clippedInterval(event, periodStart, periodEnd);
    if (!interval) continue;
    const isMeeting = event.kind === "meeting";
    if (isMeeting) {
      meetings += 1;
      scheduledMeetings.push(interval);
    } else if (event.kind === "work-block" || event.kind === "focus") {
      if (event.kind === "work-block") workBlocks += 1;
      else focusBlocks += 1;
      scheduledWork.push(interval);
    } else {
      continue;
    }

    const elapsedInterval = interval.start < elapsedEnd
      ? { start: interval.start, end: Math.min(interval.end, elapsedEnd) }
      : null;
    if (elapsedInterval && elapsedInterval.end > elapsedInterval.start) {
      (isMeeting ? elapsedMeetings : elapsedWork).push(elapsedInterval);
    }
  }

  return {
    periodStart: new Date(periodStart).toISOString(),
    periodEnd: new Date(periodEnd).toISOString(),
    asOf: new Date(input.asOf).toISOString(),
    scheduled: totals(scheduledMeetings, scheduledWork),
    elapsed: totals(elapsedMeetings, elapsedWork),
    eventCounts: { meetings, workBlocks, focusBlocks },
  };
}
