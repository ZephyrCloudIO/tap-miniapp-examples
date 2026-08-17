/** A guest-safe interval occupied by a server-owned TAP booking. */
export interface PublicBookingBusyInterval {
  readonly start: string;
  readonly end: string;
}

export interface LoadPublicBookingBusyIntervalsOptions {
  readonly database: Pick<D1Database, "prepare">;
  readonly workspace: string;
  readonly principal: string;
  readonly conflictCalendarIds: readonly string[];
  readonly timeMin: string;
  readonly timeMax: string;
}

interface ProviderBookingIntervalRow {
  readonly start_at: string;
  readonly end_at: string;
}

const canonicalInstant = (value: string, field: string): string => {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new TypeError(`${field} must be a valid timestamp.`);
  }
  return new Date(timestamp).toISOString();
};

/**
 * Load TAP-owned booking rows that must fail closed during public availability.
 *
 * The projection deliberately excludes booking identifiers, kind, state, calendar,
 * and organizer details. Intervals are clipped to the requested range and coalesced
 * so callers cannot infer duplicate or overlapping booking counts.
 */
export async function loadPublicBookingBusyIntervals(
  options: LoadPublicBookingBusyIntervalsOptions,
): Promise<readonly PublicBookingBusyInterval[]> {
  const timeMin = canonicalInstant(options.timeMin, "timeMin");
  const timeMax = canonicalInstant(options.timeMax, "timeMax");
  if (timeMax <= timeMin) {
    throw new RangeError("timeMax must be later than timeMin.");
  }

  const calendarIds = [...new Set(options.conflictCalendarIds)];
  if (calendarIds.length === 0) return [];

  const rows = (await options.database.prepare(
    `SELECT COALESCE(managed.start_at, commits.start_at) AS start_at,
            COALESCE(managed.end_at, commits.end_at) AS end_at
       FROM provider_booking_commits AS commits
       LEFT JOIN public_booking_management_credentials AS managed
         ON managed.workspace_id = commits.workspace_id
        AND managed.principal_id = commits.principal_id
        AND managed.provider_operation_id = commits.idempotency_key
      WHERE commits.workspace_id = ?
        AND commits.principal_id = ?
        AND commits.destination_calendar_id IN (${calendarIds.map(() => "?").join(", ")})
        AND commits.state IN ('pending', 'committed')
        AND (commits.booking_kind <> 'approval-hold' OR commits.resolution_status IS NULL OR commits.resolution_status <> 'declined')
        AND (commits.booking_kind <> 'approval-hold' OR commits.hold_expired_at IS NULL)
        AND (managed.booking_reference IS NULL OR managed.status = 'active')
        AND COALESCE(managed.start_at, commits.start_at) < ?
        AND COALESCE(managed.end_at, commits.end_at) > ?
      ORDER BY COALESCE(managed.start_at, commits.start_at),
               COALESCE(managed.end_at, commits.end_at)`,
  )
    .bind(
      options.workspace,
      options.principal,
      ...calendarIds,
      timeMax,
      timeMin,
    )
    .all<ProviderBookingIntervalRow>()).results;

  const intervals = rows.map(row => {
    const start = canonicalInstant(row.start_at, "Stored booking start");
    const end = canonicalInstant(row.end_at, "Stored booking end");
    if (end <= start) {
      throw new RangeError("A stored booking interval is invalid.");
    }
    return {
      start: start < timeMin ? timeMin : start,
      end: end > timeMax ? timeMax : end,
    };
  });

  const busy: PublicBookingBusyInterval[] = [];
  for (const interval of intervals) {
    const previous = busy.at(-1);
    if (!previous || previous.end < interval.start) {
      busy.push(interval);
      continue;
    }
    if (interval.end > previous.end) {
      busy[busy.length - 1] = { start: previous.start, end: interval.end };
    }
  }
  return busy;
}
