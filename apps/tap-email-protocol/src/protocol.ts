export const TAP_EMAIL_PROTOCOL_VERSION = 1 as const;

export type EmailProvider = 'google';
export type AccountCoverageState =
  | 'current'
  | 'backfilling'
  | 'stale'
  | 'repairing'
  | 'blocked';

export interface EmailAccountRef {
  readonly accountId: string;
  readonly provider: EmailProvider;
  readonly address: string;
  readonly displayName: string;
}

export interface AccountCoverage {
  readonly accountId: string;
  readonly state: AccountCoverageState;
  readonly newestHistoryId: string | null;
  readonly observedAt: string;
  readonly backfillCompleteThrough: string | null;
  readonly unresolvedFailures: number;
}

export type ReminderCondition = 'if_no_reply' | 'regardless';

export interface TapEmailReminder {
  readonly reminderId: string;
  readonly accountId: string;
  readonly threadId: string;
  readonly dueAt: string;
  readonly condition: ReminderCondition;
  readonly createdAt: string;
}

export type MailCommandKind =
  | 'archive'
  | 'mark_read'
  | 'mark_unread'
  | 'star'
  | 'unstar'
  | 'trash'
  | 'apply_labels'
  | 'save_draft'
  | 'send_draft'
  | 'schedule_send'
  | 'cancel_scheduled_send'
  | 'create_reminder'
  | 'cancel_reminder';

export type MailCommandState =
  | 'local_pending'
  | 'accepted'
  | 'leased'
  | 'provider_acknowledged'
  | 'applied'
  | 'retryable'
  | 'uncertain'
  | 'failed'
  | 'cancelled';

export interface MailCommand<TPayload = Readonly<Record<string, unknown>>> {
  readonly v: typeof TAP_EMAIL_PROTOCOL_VERSION;
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly accountId: string;
  readonly threadId: string | null;
  readonly kind: MailCommandKind;
  readonly createdAt: string;
  readonly expectedProviderRevision: string | null;
  readonly payload: TPayload;
}

export interface MailCommandReceipt {
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly accountId: string;
  readonly state: MailCommandState;
  readonly acceptedAt: string;
  readonly providerAcknowledgedAt: string | null;
  readonly errorCode: string | null;
}

export interface MailboxSummary {
  readonly generatedAt: string;
  readonly accountIds: readonly string[];
  readonly inbox: number;
  readonly critical: number;
  readonly needsResponse: number;
  readonly waiting: number;
  readonly dueReminders: number;
  readonly failedCommands: number;
  readonly operationalZero: boolean;
  readonly coverageComplete: boolean;
}

export interface ActiveEmailContext {
  readonly accountId: string | null;
  readonly threadId: string | null;
  readonly route: string;
  readonly view: 'unified' | 'account';
}

export function operationalZeroAllowed(
  coverages: readonly AccountCoverage[],
): boolean {
  return (
    coverages.length > 0 &&
    coverages.every(
      coverage =>
        coverage.state === 'current' && coverage.unresolvedFailures === 0,
    )
  );
}

const identifierPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,255}$/u;
const coverageStates = new Set<AccountCoverageState>([
  'current',
  'backfilling',
  'stale',
  'repairing',
  'blocked',
]);
const commandStates = new Set<MailCommandState>([
  'local_pending',
  'accepted',
  'leased',
  'provider_acknowledged',
  'applied',
  'retryable',
  'uncertain',
  'failed',
  'cancelled',
]);

export function isSafeMailIdentifier(value: unknown): value is string {
  return typeof value === 'string' && identifierPattern.test(value);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

export function isAccountCoverage(value: unknown): value is AccountCoverage {
  if (!isRecord(value)) return false;
  return (
    isSafeMailIdentifier(value.accountId) &&
    coverageStates.has(value.state as AccountCoverageState) &&
    (value.newestHistoryId === null || isSafeMailIdentifier(value.newestHistoryId)) &&
    isIsoDate(value.observedAt) &&
    (value.backfillCompleteThrough === null || isIsoDate(value.backfillCompleteThrough)) &&
    typeof value.unresolvedFailures === 'number' &&
    Number.isSafeInteger(value.unresolvedFailures) &&
    value.unresolvedFailures >= 0
  );
}

export function isMailCommandReceipt(value: unknown): value is MailCommandReceipt {
  if (!isRecord(value)) return false;
  return (
    isSafeMailIdentifier(value.commandId) &&
    isSafeMailIdentifier(value.idempotencyKey) &&
    isSafeMailIdentifier(value.accountId) &&
    commandStates.has(value.state as MailCommandState) &&
    isIsoDate(value.acceptedAt) &&
    (value.providerAcknowledgedAt === null || isIsoDate(value.providerAcknowledgedAt)) &&
    (value.errorCode === null || isSafeMailIdentifier(value.errorCode))
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function isMailboxSummary(value: unknown): value is MailboxSummary {
  if (!isRecord(value)) return false;
  return (
    isIsoDate(value.generatedAt) &&
    Array.isArray(value.accountIds) &&
    value.accountIds.length <= 100 &&
    value.accountIds.every(isSafeMailIdentifier) &&
    isNonNegativeInteger(value.inbox) &&
    isNonNegativeInteger(value.critical) &&
    isNonNegativeInteger(value.needsResponse) &&
    isNonNegativeInteger(value.waiting) &&
    isNonNegativeInteger(value.dueReminders) &&
    isNonNegativeInteger(value.failedCommands) &&
    typeof value.operationalZero === 'boolean' &&
    typeof value.coverageComplete === 'boolean'
  );
}

export function isActiveEmailContext(value: unknown): value is ActiveEmailContext {
  if (!isRecord(value)) return false;
  return (
    (value.accountId === null || isSafeMailIdentifier(value.accountId)) &&
    (value.threadId === null || isSafeMailIdentifier(value.threadId)) &&
    typeof value.route === 'string' &&
    value.route.startsWith('/') &&
    value.route.length <= 1_024 &&
    (value.view === 'unified' || value.view === 'account')
  );
}

export function isMailCommand(value: unknown): value is MailCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Readonly<Record<string, unknown>>;
  return (
    candidate.v === TAP_EMAIL_PROTOCOL_VERSION &&
    isSafeMailIdentifier(candidate.commandId) &&
    isSafeMailIdentifier(candidate.idempotencyKey) &&
    isSafeMailIdentifier(candidate.accountId) &&
    (candidate.threadId === null || isSafeMailIdentifier(candidate.threadId)) &&
    typeof candidate.kind === 'string' &&
    commandKinds.has(candidate.kind as MailCommandKind) &&
    typeof candidate.createdAt === 'string' &&
    Number.isFinite(Date.parse(candidate.createdAt)) &&
    (candidate.expectedProviderRevision === null ||
      isSafeMailIdentifier(candidate.expectedProviderRevision)) &&
    Boolean(candidate.payload) &&
    typeof candidate.payload === 'object' &&
    !Array.isArray(candidate.payload)
  );
}

const commandKinds = new Set<MailCommandKind>([
  'archive',
  'mark_read',
  'mark_unread',
  'star',
  'unstar',
  'trash',
  'apply_labels',
  'save_draft',
  'send_draft',
  'schedule_send',
  'cancel_scheduled_send',
  'create_reminder',
  'cancel_reminder',
]);
