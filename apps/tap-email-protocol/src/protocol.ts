export const TAP_EMAIL_PROTOCOL_VERSION = 1 as const;

/**
 * Stable provider key resolved by the coordinator for an account.
 *
 * This is intentionally extensible: platform consumers scope work by TAP's
 * `accountId`, not by branching on a closed list of provider implementations.
 */
export type EmailProvider = string;
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

/** Provider-neutral coverage returned by platform mail capabilities. */
export interface MailAccountCoverage {
  readonly accountId: string;
  readonly state: AccountCoverageState;
  readonly newestProviderRevision: string | null;
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

export const MAXIMUM_DRAFT_ATTACHMENT_BYTES = 8 * 1_024 * 1_024;
export const MAXIMUM_DRAFT_ATTACHMENTS = 20;
export const MAXIMUM_DRAFT_ATTACHMENT_TOTAL_BYTES = 20 * 1_024 * 1_024;

/**
 * Immutable reference to bytes uploaded through the coordinator's private
 * attachment-staging route. The stage is bound to one profile, account, and
 * `draftKey`; neither provider locators nor file bytes enter a mail command.
 */
export interface MailDraftAttachment {
  readonly stageId: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sha256Base64Url: string;
}

/** Captured identity intent, never an authorization claim. */
export interface MailSenderContext {
  readonly userId: string;
  readonly workspaceId: string;
}

export function isMailSenderContext(value: unknown): value is MailSenderContext {
  return isRecord(value) && isSafeMailIdentifier(value.userId) &&
    isSafeMailIdentifier(value.workspaceId);
}

/**
 * Reviewable text authored by UI and workflow callers; the provider renders
 * HTML for delivery. `draftKey` stays stable across autosave revisions.
 * Provider draft identifiers never cross this boundary.
 */
export interface MailDraftPayload extends Readonly<Record<string, unknown>> {
  readonly draftKey: string;
  readonly draftRevision: number;
  readonly to: string;
  readonly cc?: string;
  readonly bcc?: string;
  readonly subject: string;
  readonly bodyText: string;
  /** Captured send intent; independently verified by the coordinator. */
  readonly expectedContext?: MailSenderContext;
  readonly replyToMessageId?: string;
  readonly attachments?: readonly MailDraftAttachment[];
  /** Client-held undo-send deadline. This is not a scheduled-send policy. */
  readonly sendAfter?: string;
}

/**
 * A reviewable provider draft plus the coordinator-owned delivery policy.
 * `scheduledFor` is an absolute instant; clients are responsible for showing
 * the user's timezone before creating the immutable command.
 */
export interface MailSchedulePayload extends MailDraftPayload {
  readonly scheduledFor: string;
  readonly cancelIfReply: boolean;
}

/** Cancels one previously accepted schedule without discarding its draft. */
export interface CancelScheduledSendPayload extends Readonly<Record<string, unknown>> {
  readonly scheduledCommandId: string;
}

export type ScheduledSendState =
  | 'pending'
  | 'enqueued'
  | 'cancelled'
  | 'sent'
  | 'failed'
  | 'uncertain';

/** Content-minimized row for the account-scoped Scheduled mailbox resource. */
export interface ScheduledSendSummary {
  readonly scheduleCommandId: string;
  readonly accountId: string;
  readonly threadId: string | null;
  readonly draftKey: string;
  readonly to: string;
  readonly subject: string;
  readonly dueAt: string;
  readonly cancelIfReply: boolean;
  readonly state: ScheduledSendState;
  readonly dispatchCommandId: string | null;
  readonly errorCode: string | null;
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

/** Canonical provider-neutral identities used at every platform boundary. */
export interface EmailThreadRef {
  readonly accountId: string;
  readonly threadId: string;
}

export interface VersionedEmailThreadRef extends EmailThreadRef {
  readonly expectedRevision: string;
}

export interface EmailMessageRef extends EmailThreadRef {
  readonly messageId: string;
}

export type MailResource =
  | 'account-metadata'
  | 'thread-metadata'
  | 'message-metadata'
  | 'message-content'
  | 'command-receipt';

export type MailCoverageCompleteness = 'complete' | 'partial' | 'unknown';
export type MailCoverageSource =
  | 'local-replica'
  | 'coordinator-replica'
  | 'provider-fallback';
export type MailCoverageFallback =
  | 'not-needed'
  | 'used'
  | 'unavailable'
  | 'failed';

export interface MailCoverageRequest {
  readonly accountIds: readonly string[];
  readonly resources: readonly MailResource[];
  readonly threadRefs: readonly EmailThreadRef[];
  readonly messageRefs: readonly EmailMessageRef[];
  readonly afterInclusive: string | null;
  readonly beforeExclusive: string | null;
}

export interface MailCoverageReceipt {
  readonly version: 1;
  readonly observedAt: string;
  readonly request: MailCoverageRequest;
  readonly accounts: readonly MailAccountCoverage[];
  readonly completeness: MailCoverageCompleteness;
  readonly source: MailCoverageSource;
  readonly fallback: MailCoverageFallback;
  readonly resultTruncated: boolean;
  readonly nextCursor: string | null;
  readonly warnings: readonly string[];
}

export interface StructuredMailSearchRequest {
  /** Explicit account partitions. `all` and email-address selectors are invalid. */
  readonly accountIds: readonly string[];
  readonly text: string | null;
  readonly afterInclusive: string | null;
  readonly beforeExclusive: string | null;
  readonly unread: boolean | null;
  readonly starred: boolean | null;
  readonly needsResponse: boolean | null;
  readonly waitingOnOthers: boolean | null;
  readonly inInbox: boolean | null;
  readonly labels: readonly string[];
  readonly cursor: string | null;
  readonly limit: number;
}

export interface MailAccountDescriptor extends EmailAccountRef {
  readonly connectionState: 'active' | 'reauthorization_required';
  readonly coverage: MailAccountCoverage;
}

export interface MailParticipant {
  readonly name: string;
  readonly address: string;
}

export interface MailAttachmentDescriptor {
  readonly resourceId: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly disposition: 'attachment' | 'inline';
  readonly contentId: string | null;
}

export interface MailMessageMetadata extends EmailMessageRef {
  readonly internetMessageId: string | null;
  readonly from: MailParticipant;
  readonly to: readonly MailParticipant[];
  readonly sentAt: string;
  readonly attachments: readonly MailAttachmentDescriptor[];
}

export interface MailThreadDescriptor extends EmailThreadRef {
  readonly providerRevision: string;
  readonly subject: string;
  readonly participants: readonly MailParticipant[];
  readonly receivedAt: string;
  readonly unread: boolean;
  readonly starred: boolean;
  readonly critical: boolean;
  readonly needsResponse: boolean;
  readonly waitingOnOthers: boolean;
  readonly inInbox: boolean;
  readonly labels: readonly string[];
  readonly latestMessageRef: EmailMessageRef | null;
}

export interface BoundedMailMessage extends MailMessageMetadata {
  readonly bodyText: string;
  readonly bodyTextTruncated: boolean;
}

export interface ExactMailThreadRequest extends EmailThreadRef {}

export interface ExactMailMessageReadRequest extends EmailThreadRef {
  readonly messageIds: readonly string[];
  readonly maximumCharactersPerMessage: number;
}

export interface MailCommandReceiptRequest {
  readonly accountId: string;
  readonly commandId: string;
}

export interface MailAccountListResult {
  readonly untrustedContent: true;
  readonly accounts: readonly MailAccountDescriptor[];
  readonly coverage: MailCoverageReceipt;
}

export interface MailThreadSearchResult {
  readonly untrustedContent: true;
  readonly matchingMode: 'deterministic-metadata-substring-and-structured-filters';
  readonly threads: readonly MailThreadDescriptor[];
  readonly coverage: MailCoverageReceipt;
}

export interface MailThreadReadResult {
  readonly untrustedContent: true;
  readonly thread: MailThreadDescriptor;
  readonly messages: readonly MailMessageMetadata[];
  readonly coverage: MailCoverageReceipt;
}

export interface MailMessageContentPolicy {
  readonly rawHtmlIncluded: false;
  readonly remoteImagesIncluded: false;
  readonly attachmentBytesIncluded: false;
  readonly maximumCharactersPerMessage: number;
}

export interface MailMessageReadResult {
  readonly untrustedContent: true;
  readonly contentPolicy: MailMessageContentPolicy;
  readonly messages: readonly BoundedMailMessage[];
  readonly coverage: MailCoverageReceipt;
}

export interface MailCommandReceiptResult {
  readonly receipt: MailCommandReceipt;
  readonly coverage: MailCoverageReceipt;
}

/**
 * Profile-bound provider-neutral mail reads.
 *
 * An adapter captures the authenticated profile when it constructs this port;
 * callers can narrow account scope but cannot substitute another profile ID.
 */
export interface MailReadPort {
  listAccounts(): Promise<MailAccountListResult>;
  searchThreads(request: StructuredMailSearchRequest): Promise<MailThreadSearchResult>;
  getThread(request: ExactMailThreadRequest): Promise<MailThreadReadResult>;
  readMessages(request: ExactMailMessageReadRequest): Promise<MailMessageReadResult>;
  getCommandReceipt(request: MailCommandReceiptRequest): Promise<MailCommandReceiptResult>;
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
const scheduledSendStates = new Set<ScheduledSendState>([
  'pending',
  'enqueued',
  'cancelled',
  'sent',
  'failed',
  'uncertain',
]);
const mailResources = new Set<MailResource>([
  'account-metadata',
  'thread-metadata',
  'message-metadata',
  'message-content',
  'command-receipt',
]);
const coverageCompleteness = new Set<MailCoverageCompleteness>([
  'complete',
  'partial',
  'unknown',
]);
const coverageSources = new Set<MailCoverageSource>([
  'local-replica',
  'coordinator-replica',
  'provider-fallback',
]);
const coverageFallbacks = new Set<MailCoverageFallback>([
  'not-needed',
  'used',
  'unavailable',
  'failed',
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

function isOptionalIsoDate(value: unknown): value is string | null {
  return value === null || isIsoDate(value);
}

function isBoundedString(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length <= maximum;
}

function isSafeHeaderString(
  value: unknown,
  maximum: number,
  allowEmpty = true,
): value is string {
  return (
    isBoundedString(value, maximum) &&
    (allowEmpty || value.length > 0) &&
    !/[\r\n]/u.test(value)
  );
}

const sha256Base64UrlPattern = /^[A-Za-z0-9_-]{43}$/u;
const mimeTypePattern = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u;

export function isMailDraftAttachment(value: unknown): value is MailDraftAttachment {
  if (!isRecord(value)) return false;
  return (
    isSafeMailIdentifier(value.stageId) &&
    isSafeHeaderString(value.fileName, 1_024, false) &&
    !/[\\/\u0000-\u001f\u007f-\u009f]/u.test(value.fileName) &&
    typeof value.mimeType === 'string' &&
    value.mimeType.length <= 255 &&
    mimeTypePattern.test(value.mimeType) &&
    typeof value.sizeBytes === 'number' &&
    Number.isSafeInteger(value.sizeBytes) &&
    value.sizeBytes > 0 &&
    value.sizeBytes <= MAXIMUM_DRAFT_ATTACHMENT_BYTES &&
    typeof value.sha256Base64Url === 'string' &&
    sha256Base64UrlPattern.test(value.sha256Base64Url)
  );
}

export function isMailDraftPayload(value: unknown): value is MailDraftPayload {
  if (!isRecord(value)) return false;
  const attachments = value.attachments;
  const validatedAttachments = attachments === undefined || (
    Array.isArray(attachments) &&
    attachments.length <= MAXIMUM_DRAFT_ATTACHMENTS &&
    attachments.every(isMailDraftAttachment) &&
    new Set(attachments.map(attachment => attachment.stageId)).size === attachments.length &&
    attachments.reduce((total, attachment) => total + attachment.sizeBytes, 0) <=
      MAXIMUM_DRAFT_ATTACHMENT_TOTAL_BYTES
  );
  return (
    isSafeMailIdentifier(value.draftKey) &&
    typeof value.draftRevision === 'number' &&
    Number.isSafeInteger(value.draftRevision) &&
    value.draftRevision > 0 &&
    isSafeHeaderString(value.to, 2_000, false) &&
    (value.cc === undefined || isSafeHeaderString(value.cc, 2_000)) &&
    (value.bcc === undefined || isSafeHeaderString(value.bcc, 2_000)) &&
    isSafeHeaderString(value.subject, 998) &&
    isBoundedString(value.bodyText, 500_000) &&
    (value.expectedContext === undefined || isMailSenderContext(value.expectedContext)) &&
    (value.replyToMessageId === undefined ||
      isSafeHeaderString(value.replyToMessageId, 998, false)) &&
    (value.sendAfter === undefined || isIsoDate(value.sendAfter)) &&
    validatedAttachments
  );
}

export function isMailSchedulePayload(value: unknown): value is MailSchedulePayload {
  return (
    isMailDraftPayload(value) &&
    isIsoDate(value.scheduledFor) &&
    typeof value.cancelIfReply === 'boolean'
  );
}

export function isCancelScheduledSendPayload(
  value: unknown,
): value is CancelScheduledSendPayload {
  return isRecord(value) && isSafeMailIdentifier(value.scheduledCommandId);
}

export function isScheduledSendSummary(value: unknown): value is ScheduledSendSummary {
  if (!isRecord(value)) return false;
  return (
    isSafeMailIdentifier(value.scheduleCommandId) &&
    isSafeMailIdentifier(value.accountId) &&
    (value.threadId === null || isSafeMailIdentifier(value.threadId)) &&
    isSafeMailIdentifier(value.draftKey) &&
    isSafeHeaderString(value.to, 2_000, false) &&
    isSafeHeaderString(value.subject, 998) &&
    isIsoDate(value.dueAt) &&
    typeof value.cancelIfReply === 'boolean' &&
    scheduledSendStates.has(value.state as ScheduledSendState) &&
    (value.dispatchCommandId === null || isSafeMailIdentifier(value.dispatchCommandId)) &&
    (value.errorCode === null || isSafeMailIdentifier(value.errorCode))
  );
}

export function isEmailThreadRef(value: unknown): value is EmailThreadRef {
  return isRecord(value) &&
    isSafeMailIdentifier(value.accountId) &&
    isSafeMailIdentifier(value.threadId);
}

export function isEmailMessageRef(value: unknown): value is EmailMessageRef {
  return isRecord(value) &&
    isEmailThreadRef(value) &&
    isSafeMailIdentifier(value.messageId);
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

export function isMailAccountCoverage(value: unknown): value is MailAccountCoverage {
  if (!isRecord(value)) return false;
  return (
    isSafeMailIdentifier(value.accountId) &&
    coverageStates.has(value.state as AccountCoverageState) &&
    (value.newestProviderRevision === null ||
      isBoundedString(value.newestProviderRevision, 4_096)) &&
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

export function isMailCoverageReceipt(value: unknown): value is MailCoverageReceipt {
  if (!isRecord(value) || !isRecord(value.request)) return false;
  const request = value.request;
  if (!(
    value.version === 1 &&
    isIsoDate(value.observedAt) &&
    Array.isArray(request.accountIds) &&
    request.accountIds.length <= 100 &&
    request.accountIds.every(isSafeMailIdentifier) &&
    Array.isArray(request.resources) &&
    request.resources.length > 0 &&
    request.resources.length <= mailResources.size &&
    request.resources.every(resource => mailResources.has(resource as MailResource)) &&
    Array.isArray(request.threadRefs) &&
    request.threadRefs.length <= 100 &&
    request.threadRefs.every(isEmailThreadRef) &&
    Array.isArray(request.messageRefs) &&
    request.messageRefs.length <= 100 &&
    request.messageRefs.every(isEmailMessageRef) &&
    isOptionalIsoDate(request.afterInclusive) &&
    isOptionalIsoDate(request.beforeExclusive) &&
    Array.isArray(value.accounts) &&
    value.accounts.length <= 100 &&
    value.accounts.every(isMailAccountCoverage) &&
    coverageCompleteness.has(value.completeness as MailCoverageCompleteness) &&
    coverageSources.has(value.source as MailCoverageSource) &&
    coverageFallbacks.has(value.fallback as MailCoverageFallback) &&
    typeof value.resultTruncated === 'boolean' &&
    (value.nextCursor === null || isBoundedString(value.nextCursor, 4_096)) &&
    Array.isArray(value.warnings) &&
    value.warnings.length <= 32 &&
    value.warnings.every(warning => isBoundedString(warning, 1_024))
  )) return false;

  const accountIds = request.accountIds as readonly string[];
  const accountIdSet = new Set(accountIds);
  if (accountIdSet.size !== accountIds.length) return false;

  const resources = request.resources as readonly MailResource[];
  if (new Set(resources).size !== resources.length) return false;

  const threadRefs = request.threadRefs as readonly EmailThreadRef[];
  const threadKeys = threadRefs.map(ref => `${ref.accountId}\u0000${ref.threadId}`);
  if (
    new Set(threadKeys).size !== threadKeys.length ||
    threadRefs.some(ref => !accountIdSet.has(ref.accountId))
  ) return false;

  const messageRefs = request.messageRefs as readonly EmailMessageRef[];
  const messageKeys = messageRefs.map(
    ref => `${ref.accountId}\u0000${ref.threadId}\u0000${ref.messageId}`,
  );
  if (
    new Set(messageKeys).size !== messageKeys.length ||
    messageRefs.some(ref => !accountIdSet.has(ref.accountId))
  ) return false;

  if (
    request.afterInclusive !== null &&
    request.beforeExclusive !== null &&
    Date.parse(request.afterInclusive) >= Date.parse(request.beforeExclusive)
  ) return false;

  const accounts = value.accounts as readonly MailAccountCoverage[];
  const coverageIds = accounts.map(item => item.accountId);
  return new Set(coverageIds).size === coverageIds.length &&
    coverageIds.length === accountIds.length &&
    coverageIds.every(accountId => accountIdSet.has(accountId));
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
      (isBoundedString(candidate.expectedProviderRevision, 4_096) &&
        candidate.expectedProviderRevision.length > 0)) &&
    Boolean(candidate.payload) &&
    typeof candidate.payload === 'object' &&
    !Array.isArray(candidate.payload) &&
    ((candidate.kind !== 'save_draft' && candidate.kind !== 'send_draft') ||
      isMailDraftPayload(candidate.payload)) &&
    (candidate.kind !== 'schedule_send' ||
      (isMailSchedulePayload(candidate.payload) &&
        Date.parse(candidate.payload.scheduledFor) > Date.parse(candidate.createdAt as string))) &&
    (candidate.kind !== 'cancel_scheduled_send' ||
      isCancelScheduledSendPayload(candidate.payload))
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

// A valid message can expand to 6 MB when both 500k-character alternatives
// contain JSON-escaped control characters. Pages normally target 2 MiB, but
// allow one such message up to the shared transport ceiling without truncation.
export const MAXIMUM_THREAD_RESPONSE_BYTES = 8 * 1_024 * 1_024;
export const TARGET_THREAD_PAGE_BYTES = 2 * 1_024 * 1_024;
export const MAXIMUM_THREAD_PAGE_MESSAGES = 20;
export const MAXIMUM_THREAD_CURSOR_LENGTH = 4_096;

export function serializedUtf8Bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
