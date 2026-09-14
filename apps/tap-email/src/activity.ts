import type {
  MailCommand,
  MailCommandKind,
  MailCommandReceipt,
} from '@tap-examples/tap-email-protocol';

export const EMAIL_ACTIVITY_SCHEMA_VERSION = 1 as const;
export const EMAIL_ACTIVITY_RETENTION_DAYS = 90;
export const EMAIL_ACTIVITY_PROJECTION_LIMIT = 2_048;

export const emailActivityActions = [
  'thread_archived',
  'thread_read',
  'thread_marked_unread',
  'thread_starred',
  'thread_unstarred',
  'thread_trashed',
  'labels_applied',
  'draft_saved',
  'message_sent',
  'reply_sent',
  'send_scheduled',
  'scheduled_send_cancelled',
  'reminder_created',
  'reminder_cancelled',
] as const;

export type EmailActivityAction = (typeof emailActivityActions)[number];
export type EmailActivityOutcome =
  | 'applied'
  | 'failed'
  | 'uncertain'
  | 'cancelled';
export type EmailActivityTimeSource =
  | 'provider_acknowledged_at'
  | 'coordinator_accepted_at';

/**
 * Private, installation-local deduplication record. The command idempotency
 * key stays in private SQLite and never enters the shared/MCP projection; no
 * mailbox content or explicit account/thread columns are retained.
 */
export interface LocalEmailActivityRecord {
  readonly idempotencyKey: string;
  readonly action: EmailActivityAction;
  readonly outcome: EmailActivityOutcome;
  readonly occurredAt: string;
  readonly timeSource: EmailActivityTimeSource;
}

/** Content-free event material used only to compute bounded aggregates. */
export interface EmailActivityProjectionEntry {
  readonly action: EmailActivityAction;
  readonly outcome: EmailActivityOutcome;
  readonly occurredAt: string;
  readonly timeSource: EmailActivityTimeSource;
}

export interface EmailActivityProjection {
  readonly schemaVersion: typeof EMAIL_ACTIVITY_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly entries: readonly EmailActivityProjectionEntry[];
  readonly coverage: {
    readonly scope: 'installation';
    readonly source: 'private-profile-sqlite' | 'unavailable';
    readonly trackingStartedAt: string | null;
    readonly retainedAfter: string | null;
    readonly availableFrom: string | null;
    readonly truncated: boolean;
    readonly warnings: readonly string[];
  };
}

// Background draft saves still flow through the command pipeline so provider
// durability and receipt handling remain unchanged. This process-local marker
// lets that pipeline return its usual projection-shaped result without opening
// the private ledger or publishing a synthetic public projection. A WeakSet is
// deliberate: the marker cannot leak into JSON or the shared storage value.
const noOpEmailActivityProjections = new WeakSet<EmailActivityProjection>();

export interface EmailActivitySummaryRequest {
  readonly startAt: string;
  readonly endAtExclusive: string;
  readonly timeZone: string;
}

export interface EmailActivityActionCount {
  readonly total: number;
  readonly applied: number;
  readonly failed: number;
  readonly uncertain: number;
  readonly cancelled: number;
}

export interface EmailActivitySummary {
  readonly schemaVersion: typeof EMAIL_ACTIVITY_SCHEMA_VERSION;
  readonly kind: 'email-activity-summary';
  readonly generatedAt: string;
  readonly range: {
    readonly startAt: string;
    readonly endAtExclusive: string;
    readonly timeZone: string;
  };
  readonly counts: {
    readonly total: number;
    readonly applied: number;
    readonly byAction: Readonly<Record<EmailActivityAction, EmailActivityActionCount>>;
  };
  readonly failures: {
    readonly total: number;
    readonly failed: number;
    readonly uncertain: number;
    readonly cancelled: number;
  };
  readonly coverage: {
    readonly complete: boolean;
    readonly scope: 'installation';
    readonly source: EmailActivityProjection['coverage']['source'];
    readonly trackingStartedAt: string | null;
    readonly availableFrom: string | null;
    readonly availableThrough: string;
    readonly retainedAfter: string | null;
    readonly projectionTruncated: boolean;
    readonly warnings: readonly string[];
  };
}

const emailActivityActionSet = new Set<string>(emailActivityActions);
const terminalOutcomeSet = new Set<string>([
  'applied',
  'failed',
  'uncertain',
  'cancelled',
]);
const timeSourceSet = new Set<string>([
  'provider_acknowledged_at',
  'coordinator_accepted_at',
]);
const projectionKeys = new Set(['schemaVersion', 'generatedAt', 'entries', 'coverage']);
const projectionEntryKeys = new Set([
  'action',
  'outcome',
  'occurredAt',
  'timeSource',
]);
const projectionCoverageKeys = new Set([
  'scope',
  'source',
  'trackingStartedAt',
  'retainedAfter',
  'availableFrom',
  'truncated',
  'warnings',
]);
const rfc3339Pattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;
const timeZonePattern = /^[A-Za-z0-9_+.-]+(?:\/[A-Za-z0-9_+.-]+)*$/u;

function validIanaTimeZone(value: string): boolean {
  if (!timeZonePattern.test(value)) return false;
  try {
    // Syntax alone accepts invented zones such as "Mars/Olympus_Mons". Let
    // the platform's timezone database validate the identifier before it can
    // enter a coverage receipt or a Chloe summary.
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function isEmailActivityAction(
  value: unknown,
): value is EmailActivityAction {
  return typeof value === 'string' && emailActivityActionSet.has(value);
}

export function isEmailActivityOutcome(
  value: unknown,
): value is EmailActivityOutcome {
  return typeof value === 'string' && terminalOutcomeSet.has(value);
}

export function isEmailActivityTimeSource(
  value: unknown,
): value is EmailActivityTimeSource {
  return typeof value === 'string' && timeSourceSet.has(value);
}

function validTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 64 &&
    rfc3339Pattern.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function normalizedTimestamp(value: string): string {
  return new Date(Date.parse(value)).toISOString();
}

function hasOnlyKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
): boolean {
  return Object.keys(value).every(key => allowed.has(key));
}

function actionForCommand(command: MailCommand): EmailActivityAction | null {
  if (command.kind === 'send_draft') {
    return command.threadId !== null &&
      typeof command.payload.replyToMessageId === 'string'
      ? 'reply_sent'
      : 'message_sent';
  }
  if (command.kind === 'save_draft') {
    // Provider-draft autosave is a background durability mechanism, not a
    // user-authored activity. Counting every revision would turn typing pauses
    // into dozens of fake actions in Chloe's daily summary.
    return null;
  }
  const actions: Readonly<Record<Exclude<MailCommandKind, 'send_draft' | 'save_draft'>, EmailActivityAction>> = {
    archive: 'thread_archived',
    mark_read: 'thread_read',
    mark_unread: 'thread_marked_unread',
    star: 'thread_starred',
    unstar: 'thread_unstarred',
    trash: 'thread_trashed',
    apply_labels: 'labels_applied',
    schedule_send: 'send_scheduled',
    cancel_scheduled_send: 'scheduled_send_cancelled',
    create_reminder: 'reminder_created',
    cancel_reminder: 'reminder_cancelled',
  };
  return actions[command.kind];
}

export function localActivityRecordFromReceipt(
  command: MailCommand,
  receipt: MailCommandReceipt,
): LocalEmailActivityRecord | null {
  if (
    receipt.commandId !== command.commandId ||
    receipt.idempotencyKey !== command.idempotencyKey ||
    receipt.accountId !== command.accountId
  ) {
    throw new Error('The activity receipt does not match its mail command.');
  }
  if (!terminalOutcomeSet.has(receipt.state)) {
    throw new Error('Only terminal mail command receipts may become activity.');
  }
  if (!validTimestamp(receipt.acceptedAt)) {
    throw new Error('The activity receipt has an invalid coordinator timestamp.');
  }
  if (
    receipt.providerAcknowledgedAt !== null &&
    !validTimestamp(receipt.providerAcknowledgedAt)
  ) {
    throw new Error('The activity receipt has an invalid provider timestamp.');
  }
  if (receipt.state === 'applied' && receipt.providerAcknowledgedAt === null) {
    throw new Error('An applied command requires provider acknowledgement.');
  }

  const action = actionForCommand(command);
  if (action === null) return null;

  return {
    idempotencyKey: receipt.idempotencyKey,
    action,
    outcome: receipt.state as EmailActivityOutcome,
    occurredAt: normalizedTimestamp(
      receipt.providerAcknowledgedAt ?? receipt.acceptedAt,
    ),
    timeSource: receipt.providerAcknowledgedAt
      ? 'provider_acknowledged_at'
      : 'coordinator_accepted_at',
  };
}

export function unavailableEmailActivityProjection(
  generatedAt: string,
  warning = 'Private profile storage is unavailable, so email activity is not being recorded.',
): EmailActivityProjection {
  if (!validTimestamp(generatedAt)) {
    throw new Error('The activity projection timestamp is invalid.');
  }
  return {
    schemaVersion: EMAIL_ACTIVITY_SCHEMA_VERSION,
    generatedAt: normalizedTimestamp(generatedAt),
    entries: [],
    coverage: {
      scope: 'installation',
      source: 'unavailable',
      trackingStartedAt: null,
      retainedAfter: null,
      availableFrom: null,
      truncated: false,
      warnings: [warning],
    },
  };
}

export function incompleteEmailActivityProjection(
  projection: EmailActivityProjection,
  generatedAt: string,
  warning = 'One or more committed email actions are awaiting private activity reconciliation.',
): EmailActivityProjection {
  if (!isEmailActivityProjection(projection) || !validTimestamp(generatedAt)) {
    throw new Error('Incomplete email activity coverage requires a valid projection timestamp.');
  }
  return {
    ...projection,
    generatedAt: normalizedTimestamp(generatedAt),
    coverage: {
      ...projection.coverage,
      source: 'unavailable',
      warnings: [...new Set([...projection.coverage.warnings, warning])].slice(0, 16),
    },
  };
}

export function noOpEmailActivityProjection(
  generatedAt: string,
): EmailActivityProjection {
  const projection = unavailableEmailActivityProjection(
    generatedAt,
    'Provider draft autosave is intentionally excluded from email activity.',
  );
  noOpEmailActivityProjections.add(projection);
  return projection;
}

export function isNoOpEmailActivityProjection(
  projection: EmailActivityProjection,
): boolean {
  return noOpEmailActivityProjections.has(projection);
}

function isProjectionEntry(value: unknown): value is EmailActivityProjectionEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Readonly<Record<string, unknown>>;
  return (
    hasOnlyKeys(candidate, projectionEntryKeys) &&
    isEmailActivityAction(candidate.action) &&
    isEmailActivityOutcome(candidate.outcome) &&
    validTimestamp(candidate.occurredAt) &&
    isEmailActivityTimeSource(candidate.timeSource)
  );
}

export function isEmailActivityProjection(
  value: unknown,
): value is EmailActivityProjection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Readonly<Record<string, unknown>>;
  const coverage = candidate.coverage;
  if (!coverage || typeof coverage !== 'object' || Array.isArray(coverage)) {
    return false;
  }
  const boundedCoverage = coverage as Readonly<Record<string, unknown>>;
  return (
    hasOnlyKeys(candidate, projectionKeys) &&
    hasOnlyKeys(boundedCoverage, projectionCoverageKeys) &&
    candidate.schemaVersion === EMAIL_ACTIVITY_SCHEMA_VERSION &&
    validTimestamp(candidate.generatedAt) &&
    Array.isArray(candidate.entries) &&
    candidate.entries.length <= EMAIL_ACTIVITY_PROJECTION_LIMIT &&
    candidate.entries.every(isProjectionEntry) &&
    boundedCoverage.scope === 'installation' &&
    (boundedCoverage.source === 'private-profile-sqlite' ||
      boundedCoverage.source === 'unavailable') &&
    (boundedCoverage.trackingStartedAt === null ||
      validTimestamp(boundedCoverage.trackingStartedAt)) &&
    (boundedCoverage.retainedAfter === null ||
      validTimestamp(boundedCoverage.retainedAfter)) &&
    (boundedCoverage.availableFrom === null ||
      validTimestamp(boundedCoverage.availableFrom)) &&
    typeof boundedCoverage.truncated === 'boolean' &&
    Array.isArray(boundedCoverage.warnings) &&
    boundedCoverage.warnings.length <= 16 &&
    boundedCoverage.warnings.every(
      warning => typeof warning === 'string' && warning.length <= 512,
    )
  );
}

export function parseEmailActivitySummaryRequest(
  value: unknown,
): EmailActivitySummaryRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Email activity requires an exact time range and timezone.');
  }
  const input = value as Readonly<Record<string, unknown>>;
  if (
    Object.keys(input).some(
      key => !['start_at', 'end_at_exclusive', 'timezone'].includes(key),
    ) ||
    !validTimestamp(input.start_at) ||
    !validTimestamp(input.end_at_exclusive) ||
    typeof input.timezone !== 'string' ||
    input.timezone.length === 0 ||
    input.timezone.length > 64 ||
    !validIanaTimeZone(input.timezone)
  ) {
    throw new Error('Email activity requires valid RFC3339 bounds and an IANA timezone.');
  }
  const startAt = normalizedTimestamp(input.start_at);
  const endAtExclusive = normalizedTimestamp(input.end_at_exclusive);
  if (Date.parse(startAt) >= Date.parse(endAtExclusive)) {
    throw new Error('Email activity end_at_exclusive must be after start_at.');
  }
  return { startAt, endAtExclusive, timeZone: input.timezone };
}

function emptyActionCounts(): Record<EmailActivityAction, EmailActivityActionCount> {
  return Object.fromEntries(
    emailActivityActions.map(action => [
      action,
      { total: 0, applied: 0, failed: 0, uncertain: 0, cancelled: 0 },
    ]),
  ) as Record<EmailActivityAction, EmailActivityActionCount>;
}

export function summarizeEmailActivity(
  projection: EmailActivityProjection,
  request: EmailActivitySummaryRequest,
): EmailActivitySummary {
  const start = Date.parse(request.startAt);
  const end = Date.parse(request.endAtExclusive);
  const byAction = emptyActionCounts();
  const outcomes: Record<EmailActivityOutcome, number> = {
    applied: 0,
    failed: 0,
    uncertain: 0,
    cancelled: 0,
  };
  let total = 0;
  let includesCoordinatorAcceptanceTime = false;
  for (const entry of projection.entries) {
    const occurredAt = Date.parse(entry.occurredAt);
    if (occurredAt < start || occurredAt >= end) continue;
    total += 1;
    if (entry.timeSource === 'coordinator_accepted_at') {
      includesCoordinatorAcceptanceTime = true;
    }
    outcomes[entry.outcome] += 1;
    const current = byAction[entry.action];
    byAction[entry.action] = {
      ...current,
      total: current.total + 1,
      [entry.outcome]: current[entry.outcome] + 1,
    };
  }

  const warnings = [...projection.coverage.warnings];
  const availableFrom = projection.coverage.availableFrom;
  if (projection.coverage.source === 'unavailable') {
    if (!warnings.some(warning => warning.includes('unavailable'))) {
      warnings.push('Email activity storage is unavailable for this installation.');
    }
  } else if (availableFrom && start < Date.parse(availableFrom)) {
    warnings.push('The requested range begins before retained email activity coverage.');
  }
  if (end > Date.parse(projection.generatedAt)) {
    warnings.push('The requested range extends beyond the latest activity projection.');
  }
  if (projection.coverage.truncated) {
    warnings.push('The rolling MCP projection reached its event limit.');
  }
  if (includesCoordinatorAcceptanceTime) {
    warnings.push(
      'Some included non-applied outcomes use coordinator acceptance time because the current receipt contract has no terminal outcome timestamp.',
    );
  }
  const deduplicatedWarnings = [...new Set(warnings)];
  const complete =
    projection.coverage.source === 'private-profile-sqlite' &&
    !projection.coverage.truncated &&
    projection.coverage.warnings.length === 0 &&
    availableFrom !== null &&
    start >= Date.parse(availableFrom) &&
    end <= Date.parse(projection.generatedAt);

  return {
    schemaVersion: EMAIL_ACTIVITY_SCHEMA_VERSION,
    kind: 'email-activity-summary',
    generatedAt: projection.generatedAt,
    range: request,
    counts: {
      total,
      applied: outcomes.applied,
      byAction,
    },
    failures: {
      total: outcomes.failed + outcomes.uncertain,
      failed: outcomes.failed,
      uncertain: outcomes.uncertain,
      cancelled: outcomes.cancelled,
    },
    coverage: {
      complete,
      scope: 'installation',
      source: projection.coverage.source,
      trackingStartedAt: projection.coverage.trackingStartedAt,
      availableFrom,
      availableThrough: projection.generatedAt,
      retainedAfter: projection.coverage.retainedAfter,
      projectionTruncated: projection.coverage.truncated,
      warnings: deduplicatedWarnings,
    },
  };
}
