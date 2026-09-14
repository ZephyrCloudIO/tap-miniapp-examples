import type {
  AccountCoverage,
  MailCommand,
  MailCommandReceipt,
  MailDraftPayload,
} from '@tap-examples/tap-email-protocol';
import {
  isMailCommand,
  isSafeMailIdentifier,
} from '@tap-examples/tap-email-protocol';
import type {
  MiniAppJsonValue,
  MiniAppPlatformApi,
  MiniAppWorkflow,
  MiniAppWorkflowRun,
} from '@theaiplatform/miniapp-sdk/sdk';
import {
  summarizeEmailActivity,
  type EmailActivityProjection,
  type EmailActivitySummary,
  type EmailActivitySummaryRequest,
} from './activity';
import {
  threadMatchesSplit,
  type EmailAccount,
  type EmailThread,
  type MailSplit,
  type MailState,
} from './domain';

export const MAXIMUM_WORKFLOW_RANGE_DAYS = 90;
export const MAXIMUM_ROLLUP_ITEMS = 250;
export const MAXIMUM_MAIL_MERGE_RECIPIENTS = 25;
export const MAXIMUM_MAIL_MERGE_TEMPLATE_BYTES = 100_000;
export const MAIL_MERGE_REVIEW_GRANT_TTL_MS = 30 * 60 * 1_000;

/**
 * Mailbox views whose rows are backed by the normalized thread table and whose
 * history can therefore be described by an account coverage receipt.
 *
 * Keep this allowlist narrower than the navigation contract. Auto Archived,
 * Scheduled, Outbox, and Snippets have dedicated/TAP-owned models (or no model
 * yet), so an empty thread match must not be reported as complete coverage.
 */
export const MAILBOX_ROLLUP_RESOURCES = [
  'inbox',
  'starred',
  'drafts',
  'sent',
  'done',
  'reminders',
  'spam',
  'trash',
  'critical',
  'needs-response',
  'waiting',
] as const satisfies readonly MailSplit[];

export type MailboxRollupResource = (typeof MAILBOX_ROLLUP_RESOURCES)[number];

export const UNAVAILABLE_MAILBOX_ROLLUP_RESOURCES = [
  'auto-archived',
  'scheduled',
  'outbox',
  'snippets',
] as const satisfies readonly MailSplit[];

const MAILBOX_ROLLUP_RESOURCE_IDS: ReadonlySet<string> = new Set(
  MAILBOX_ROLLUP_RESOURCES,
);

export function isMailboxRollupResource(
  value: string,
): value is MailboxRollupResource {
  return MAILBOX_ROLLUP_RESOURCE_IDS.has(value);
}

export const emailWorkflowDefinitions = [
  {
    kind: 'morning-brief',
    name: 'Morning Brief',
    description: 'Review new, critical, and reply-needed mail in the selected scope.',
    source: 'saved-workflow',
  },
  {
    kind: 'eod-wrap',
    name: 'EOD Wrap',
    description: 'Close the day with unresolved replies, reminders, and waiting threads.',
    source: 'saved-workflow',
  },
  {
    kind: 'daily-rollup',
    name: 'Daily Rollup',
    description: 'Summarize covered mail activity for an exact account, resource, and time scope.',
    source: 'saved-workflow',
  },
  {
    kind: 'missed-mail-audit',
    name: 'Missed Mail Audit',
    description: 'Audit unread and unresolved mail without claiming coverage beyond the receipt.',
    source: 'saved-workflow',
  },
  {
    kind: 'prepare-follow-up-drafts',
    name: 'Prepare Follow-up Drafts',
    description: 'Prepare review-only follow-up suggestions for waiting conversations.',
    source: 'saved-workflow',
  },
  {
    kind: 'mail-merge',
    name: 'Mail Merge',
    description: 'Create reviewed, personalized provider drafts. This workflow never sends them.',
    source: 'provider-drafts',
  },
  {
    kind: 'email-activity-summary',
    name: 'Email Activity Summary',
    description: 'Summarize committed actions without email content or correspondent identities.',
    source: 'saved-workflow',
  },
] as const;

export type EmailWorkflowDefinition = (typeof emailWorkflowDefinitions)[number];
export type EmailWorkflowKind = EmailWorkflowDefinition['kind'];
export type MailboxRollupWorkflowKind = Exclude<
  EmailWorkflowKind,
  'mail-merge' | 'email-activity-summary'
>;
export type EmailWorkflowRunPhase =
  | 'accepted'
  | 'running'
  | 'succeeded'
  | 'failed';

export interface EmailWorkflowRunState {
  readonly kind: EmailWorkflowKind;
  readonly phase: EmailWorkflowRunPhase;
  readonly message: string;
  readonly runId: string | null;
  readonly hostStatus: string | null;
  readonly result: MiniAppJsonValue | null;
}

export interface MailboxRollupRequest {
  readonly accountIds: readonly string[];
  readonly resources: readonly MailboxRollupResource[];
  readonly startAt: string;
  readonly endAtExclusive: string;
  readonly timeZone: string;
}

export interface MailboxRollupCoverageReceipt {
  readonly version: 1;
  readonly requested: MailboxRollupRequest;
  readonly observedAt: string;
  readonly availableThrough: string | null;
  readonly complete: boolean;
  readonly accounts: readonly AccountCoverage[];
  readonly warnings: readonly string[];
}

export interface MailboxRollupItem {
  readonly accountId: string;
  readonly threadId: string;
  readonly receivedAt: string;
  readonly subject: string;
  readonly sender: string;
  readonly snippet: string;
  readonly unread: boolean;
  readonly critical: boolean;
  readonly needsResponse: boolean;
  readonly waitingOnOthers: boolean;
  readonly reminderDueAt: string | null;
}

export interface MailboxRollupPayload {
  readonly schemaVersion: 1;
  readonly source: 'tap-email';
  readonly kind: MailboxRollupWorkflowKind;
  readonly generatedAt: string;
  readonly scope: MailboxRollupRequest;
  readonly coverageReceipt: MailboxRollupCoverageReceipt;
  readonly counts: {
    readonly total: number;
    readonly unread: number;
    readonly critical: number;
    readonly needsResponse: number;
    readonly waitingOnOthers: number;
    readonly dueReminders: number;
  };
  readonly items: readonly MailboxRollupItem[];
  readonly resultTruncated: boolean;
}

export interface EmailActivityWorkflowPayload {
  readonly schemaVersion: 1;
  readonly source: 'tap-email';
  readonly kind: 'email-activity-summary';
  readonly summary: EmailActivitySummary;
}

type WorkflowPlatform = Pick<MiniAppPlatformApi, 'workflows'>;

function parsedInstant(value: string, field: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${field} must be a valid date and time.`);
  return parsed;
}

function uniqueNonEmpty(values: readonly string[], field: string): readonly string[] {
  const normalized = [...new Set(values.map(value => value.trim()).filter(Boolean))];
  if (normalized.length === 0) throw new Error(`${field} cannot be empty.`);
  return normalized;
}

function validateTimeZone(value: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
    return value;
  } catch {
    throw new Error('Choose a valid IANA timezone for this workflow.');
  }
}

export function validateMailboxRollupRequest(
  request: MailboxRollupRequest,
  availableAccountIds: ReadonlySet<string>,
): MailboxRollupRequest {
  const accountIds = uniqueNonEmpty(request.accountIds, 'At least one mail account');
  if (accountIds.length > 100 || accountIds.some(id => !availableAccountIds.has(id))) {
    throw new Error('The rollup contains an unavailable mail account.');
  }
  const resources = uniqueNonEmpty(request.resources, 'At least one mailbox resource');
  if (
    resources.length > 16 ||
    resources.some(resource => !isMailboxRollupResource(resource))
  ) {
    throw new Error(
      'The rollup contains an unavailable mailbox resource. Auto Archived, Scheduled, Outbox, and Snippets cannot produce mailbox coverage receipts yet.',
    );
  }
  const start = parsedInstant(request.startAt, 'The rollup start');
  const end = parsedInstant(request.endAtExclusive, 'The rollup end');
  if (start >= end) throw new Error('The rollup end must be after its start.');
  if (end - start > MAXIMUM_WORKFLOW_RANGE_DAYS * 24 * 60 * 60 * 1_000) {
    throw new Error(`A mailbox workflow may cover at most ${MAXIMUM_WORKFLOW_RANGE_DAYS} days.`);
  }
  return {
    accountIds,
    resources: resources as readonly MailboxRollupResource[],
    startAt: new Date(start).toISOString(),
    endAtExclusive: new Date(end).toISOString(),
    timeZone: validateTimeZone(request.timeZone),
  };
}

function coverageReceipt(
  accounts: readonly EmailAccount[],
  request: MailboxRollupRequest,
  observedAt: string,
): MailboxRollupCoverageReceipt {
  const selected = request.accountIds.map(accountId => {
    const account = accounts.find(item => item.accountId === accountId);
    if (!account) throw new Error('The rollup contains an unavailable mail account.');
    return account.coverage;
  });
  const requestedStart = Date.parse(request.startAt);
  const requestedEnd = Date.parse(request.endAtExclusive);
  const warnings: string[] = [];
  for (const item of selected) {
    if (item.state !== 'current') {
      warnings.push(`${item.accountId} coverage is ${item.state}.`);
    }
    if (item.unresolvedFailures > 0) {
      warnings.push(`${item.accountId} has ${item.unresolvedFailures} unresolved sync failure${item.unresolvedFailures === 1 ? '' : 's'}.`);
    }
    if (
      item.backfillCompleteThrough === null ||
      Date.parse(item.backfillCompleteThrough) > requestedStart
    ) {
      warnings.push(`${item.accountId} is not backfilled through the requested start.`);
    }
    if (Date.parse(item.observedAt) < requestedEnd) {
      warnings.push(`${item.accountId} is observed only through ${item.observedAt}.`);
    }
  }
  const availableThrough = selected
    .map(item => item.observedAt)
    .toSorted()
    .at(0) ?? null;
  return {
    version: 1,
    requested: request,
    observedAt,
    availableThrough,
    complete: warnings.length === 0,
    accounts: selected,
    warnings,
  };
}

function boundedText(value: string, maximum: number): string {
  const compact = value.replace(/\s+/gu, ' ').trim();
  return compact.length <= maximum ? compact : `${compact.slice(0, maximum - 1)}…`;
}

function senderFor(thread: EmailThread): string {
  const sender = thread.messages.at(-1)?.from ?? thread.participants[0];
  return boundedText(sender?.name || sender?.address || 'Unknown sender', 160);
}

export function createMailboxRollupPayload(
  state: Pick<MailState, 'accounts' | 'threads'>,
  kind: MailboxRollupWorkflowKind,
  requestedScope: MailboxRollupRequest,
  generatedAt: string,
): MailboxRollupPayload {
  const scope = validateMailboxRollupRequest(
    requestedScope,
    new Set(state.accounts.map(account => account.accountId)),
  );
  const generatedAtMs = parsedInstant(generatedAt, 'The rollup generation time');
  const start = Date.parse(scope.startAt);
  const end = Date.parse(scope.endAtExclusive);
  const accountIds = new Set(scope.accountIds);
  const matching = state.threads
    .filter(thread => {
      const receivedAt = Date.parse(thread.receivedAt);
      return accountIds.has(thread.accountId) &&
        receivedAt >= start &&
        receivedAt < end &&
        scope.resources.some(resource => threadMatchesSplit(thread, resource));
    })
    .toSorted((left, right) => Date.parse(right.receivedAt) - Date.parse(left.receivedAt));
  const resultTruncated = matching.length > MAXIMUM_ROLLUP_ITEMS;
  const included = matching.slice(0, MAXIMUM_ROLLUP_ITEMS);
  const dueReference = Math.min(generatedAtMs, end);
  return {
    schemaVersion: 1,
    source: 'tap-email',
    kind,
    generatedAt: new Date(generatedAtMs).toISOString(),
    scope,
    coverageReceipt: coverageReceipt(
      state.accounts,
      scope,
      new Date(generatedAtMs).toISOString(),
    ),
    counts: {
      total: matching.length,
      unread: matching.filter(item => item.unread).length,
      critical: matching.filter(item => item.critical).length,
      needsResponse: matching.filter(item => item.needsResponse).length,
      waitingOnOthers: matching.filter(item => item.waitingOnOthers).length,
      dueReminders: matching.filter(item =>
        item.reminder && Date.parse(item.reminder.dueAt) <= dueReference).length,
    },
    items: included.map(thread => ({
      accountId: thread.accountId,
      threadId: thread.threadId,
      receivedAt: thread.receivedAt,
      subject: boundedText(thread.subject, 998),
      sender: senderFor(thread),
      snippet: boundedText(thread.snippet, 280),
      unread: thread.unread,
      critical: thread.critical,
      needsResponse: thread.needsResponse,
      waitingOnOthers: thread.waitingOnOthers,
      reminderDueAt: thread.reminder?.dueAt ?? null,
    })),
    resultTruncated,
  };
}

export function createEmailActivityWorkflowPayload(
  projection: EmailActivityProjection,
  request: EmailActivitySummaryRequest,
): EmailActivityWorkflowPayload {
  return {
    schemaVersion: 1,
    source: 'tap-email',
    kind: 'email-activity-summary',
    summary: summarizeEmailActivity(projection, request),
  };
}

function workflowFor(
  workflows: readonly MiniAppWorkflow[],
  definition: EmailWorkflowDefinition,
): MiniAppWorkflow | null {
  const expectedId = `tap-email.${definition.kind}`;
  const expectedName = definition.name.toLocaleLowerCase('en-US');
  return workflows.find(workflow => workflow.id === expectedId) ??
    workflows.find(workflow => workflow.type === expectedId) ??
    workflows.find(workflow => workflow.name.trim().toLocaleLowerCase('en-US') === expectedName) ??
    null;
}

function jsonValue(value: unknown): MiniAppJsonValue {
  return JSON.parse(JSON.stringify(value)) as MiniAppJsonValue;
}

function normalizedHostStatus(value: string): string {
  return value.trim().toLocaleLowerCase('en-US').replace(/[\s-]+/gu, '_');
}

export function workflowPhaseForHostStatus(status: string): EmailWorkflowRunPhase {
  const normalized = normalizedHostStatus(status);
  if (['completed', 'complete', 'succeeded', 'success'].includes(normalized)) {
    return 'succeeded';
  }
  if (['failed', 'error', 'cancelled', 'canceled', 'timed_out'].includes(normalized)) {
    return 'failed';
  }
  if (['running', 'started', 'executing', 'in_progress'].includes(normalized)) {
    return 'running';
  }
  return 'accepted';
}

function stateFromObservedRun(
  kind: EmailWorkflowKind,
  run: MiniAppWorkflowRun,
): EmailWorkflowRunState {
  const phase = workflowPhaseForHostStatus(run.status);
  return {
    kind,
    phase,
    message: phase === 'failed'
      ? run.failure?.message || `The workflow ended with ${run.status}.`
      : phase === 'succeeded'
        ? 'The workflow completed.'
        : phase === 'running'
          ? 'The workflow is running in TAP.'
          : `TAP reported ${run.status || 'an accepted run'}.`,
    runId: run.runId,
    hostStatus: run.status,
    result: run.result,
  };
}

/**
 * Starts one user-saved TAP workflow and observes it when the host exposes run
 * observation. The SDK has no workflow-creation or scheduling API, so a
 * missing saved workflow is a visible failure rather than a local imitation.
 */
export async function invokeSavedEmailWorkflow(options: {
  readonly platform: WorkflowPlatform;
  readonly workspaceId: string;
  readonly definition: EmailWorkflowDefinition;
  readonly payload: unknown;
  readonly onState: (state: EmailWorkflowRunState) => void;
}): Promise<() => void> {
  const { definition, onState, platform, workspaceId } = options;
  try {
    const available = await platform.workflows.list({ workspaceId });
    const workflow = workflowFor(available.workflows, definition);
    if (!workflow) {
      throw new Error(
        `No saved “${definition.name}” workflow exists in this workspace. TAP Email cannot create or schedule saved workflows through SDK 0.15.`,
      );
    }
    const invocation = await platform.workflows.invokeSaved({
      workflowId: workflow.id,
      payload: jsonValue(options.payload),
    });
    if (!invocation.success) {
      throw new Error(invocation.error || invocation.message || 'TAP rejected the workflow run.');
    }
    const runId = invocation.runId ?? null;
    const initialPhase = workflowPhaseForHostStatus(invocation.status);
    onState({
      kind: definition.kind,
      phase: initialPhase,
      message: runId
        ? invocation.message || 'TAP accepted the workflow run.'
        : `${invocation.message || 'TAP accepted the workflow run.'} This host did not return a run ID, so completion cannot be observed.`,
      runId,
      hostStatus: invocation.status,
      result: null,
    });
    if (!runId || initialPhase === 'succeeded' || initialPhase === 'failed') {
      return () => undefined;
    }

    if (platform.workflows.subscribeRun) {
      let unsubscribe: (() => void) | null = null;
      let unsubscribed = false;
      let terminalBeforeSubscriptionReady = false;
      const stop = () => {
        if (unsubscribed || !unsubscribe) return;
        unsubscribed = true;
        unsubscribe();
      };
      let observed: () => void;
      try {
        observed = await platform.workflows.subscribeRun(
          { workspaceId, runId },
          event => {
            const next = stateFromObservedRun(definition.kind, event.run);
            onState(next);
            if (next.phase === 'succeeded' || next.phase === 'failed') {
              if (unsubscribe) stop();
              else terminalBeforeSubscriptionReady = true;
            }
          },
        );
      } catch {
        onState({
          kind: definition.kind,
          phase: initialPhase,
          message: `TAP reported ${invocation.status}; live run observation is unavailable.`,
          runId,
          hostStatus: invocation.status,
          result: null,
        });
        return () => undefined;
      }
      unsubscribe = observed;
      if (terminalBeforeSubscriptionReady) stop();
      return stop;
    }

    if (platform.workflows.getRun) {
      try {
        const observed = await platform.workflows.getRun({ workspaceId, runId });
        if (observed.run) onState(stateFromObservedRun(definition.kind, observed.run));
      } catch {
        onState({
          kind: definition.kind,
          phase: initialPhase,
          message: `TAP reported ${invocation.status}; run status could not be refreshed.`,
          runId,
          hostStatus: invocation.status,
          result: null,
        });
      }
      return () => undefined;
    }

    onState({
      kind: definition.kind,
      phase: initialPhase,
      message: `TAP reported ${invocation.status || 'an accepted run'}, but this host does not expose further workflow run observation.`,
      runId,
      hostStatus: invocation.status,
      result: null,
    });
    return () => undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The workflow could not start.';
    onState({
      kind: definition.kind,
      phase: 'failed',
      message,
      runId: null,
      hostStatus: null,
      result: null,
    });
    return () => undefined;
  }
}

export interface MailMergeRecipientInput {
  readonly name: string;
  readonly email: string;
}

export interface MailMergeDraftPlan {
  readonly recipientId: string;
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly payload: MailDraftPayload;
  readonly digest: string;
}

export interface MailMergePlan {
  readonly schemaVersion: 1;
  readonly planId: string;
  readonly accountId: string;
  readonly createdAt: string;
  readonly recipients: readonly MailMergeRecipientInput[];
  readonly drafts: readonly MailMergeDraftPlan[];
  readonly digest: string;
}

export interface MailMergeReviewGrant {
  readonly schemaVersion: 1;
  readonly grantId: string;
  readonly planId: string;
  readonly planDigest: string;
  readonly reviewedDraftDigests: readonly string[];
  readonly grantedAt: string;
  readonly expiresAt: string;
}

const placeholderPattern = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/gu;
const emailPattern = /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/u;

function safeGeneratedIdentifier(prefix: string, raw: string): string {
  const safe = raw.replace(/[^a-zA-Z0-9._:@/-]/gu, '-').slice(0, 180);
  if (!safe) throw new Error('TAP Email could not create a stable workflow identity.');
  return `${prefix}_${safe}`;
}

function utf8Size(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function validateTemplate(value: string, field: string, allowEmpty: boolean): string {
  if (!allowEmpty && !value.trim()) throw new Error(`${field} cannot be empty.`);
  if (field === 'The subject template' && /[\r\n]/u.test(value)) {
    throw new Error('The subject template cannot contain a line break.');
  }
  if (utf8Size(value) > MAXIMUM_MAIL_MERGE_TEMPLATE_BYTES) {
    throw new Error(`${field} exceeds the ${MAXIMUM_MAIL_MERGE_TEMPLATE_BYTES.toLocaleString()} byte limit.`);
  }
  const placeholders = [...value.matchAll(placeholderPattern)].map(match => match[1]!);
  const unsupported = placeholders.find(name => name !== 'name' && name !== 'email');
  if (unsupported) throw new Error(`Unsupported mail merge placeholder: {{${unsupported}}}.`);
  return value;
}

function normalizeRecipients(
  recipients: readonly MailMergeRecipientInput[],
): readonly MailMergeRecipientInput[] {
  if (recipients.length === 0) throw new Error('Add at least one mail merge recipient.');
  if (recipients.length > MAXIMUM_MAIL_MERGE_RECIPIENTS) {
    throw new Error(`Mail merge is limited to ${MAXIMUM_MAIL_MERGE_RECIPIENTS} recipients per reviewed run.`);
  }
  const normalized = recipients.map(recipient => {
    const email = recipient.email.trim().toLocaleLowerCase('en-US');
    const name = recipient.name.replace(/\s+/gu, ' ').trim();
    if (email.length > 254 || !emailPattern.test(email)) {
      throw new Error(`Invalid mail merge recipient: ${recipient.email || '(blank)'}.`);
    }
    if (name.length > 160 || /[\r\n]/u.test(name)) {
      throw new Error(`Invalid recipient name for ${email}.`);
    }
    return { name, email };
  });
  const emails = normalized.map(recipient => recipient.email);
  if (new Set(emails).size !== emails.length) {
    throw new Error('Each mail merge recipient must be unique.');
  }
  return normalized;
}

function renderTemplate(template: string, recipient: MailMergeRecipientInput): string {
  return template.replace(placeholderPattern, (_match, name: string) =>
    name === 'name' ? recipient.name : recipient.email);
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record).toSorted().map(key =>
    `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
}

async function sha256(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonical(value)),
  );
  const bytes = new Uint8Array(digest);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Readonly<Record<string, unknown>>)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}

export async function createMailMergePlan(options: {
  readonly accountId: string;
  readonly recipients: readonly MailMergeRecipientInput[];
  readonly subjectTemplate: string;
  readonly bodyTemplate: string;
  readonly now: string;
  readonly idFactory: () => string;
}): Promise<MailMergePlan> {
  if (!isSafeMailIdentifier(options.accountId)) {
    throw new Error('Choose a valid, explicit From account.');
  }
  const createdAt = new Date(parsedInstant(options.now, 'The plan creation time')).toISOString();
  const recipients = normalizeRecipients(options.recipients);
  const subjectTemplate = validateTemplate(options.subjectTemplate, 'The subject template', false);
  const bodyTemplate = validateTemplate(options.bodyTemplate, 'The body template', false);
  const planId = safeGeneratedIdentifier('merge', options.idFactory());
  const draftsWithoutDigest = recipients.map((recipient, index) => {
    const recipientId = `recipient_${index + 1}`;
    const commandId = `${planId}_${recipientId}`;
    const draftKey = `draft_${commandId}`;
    const subject = renderTemplate(subjectTemplate, recipient);
    const bodyText = renderTemplate(bodyTemplate, recipient);
    if (subject.length > 998 || /[\r\n]/u.test(subject)) {
      throw new Error(`The rendered subject for ${recipient.email} is invalid.`);
    }
    if (bodyText.length > 500_000) {
      throw new Error(`The rendered message for ${recipient.email} is too large.`);
    }
    return {
      recipientId,
      commandId,
      idempotencyKey: `tap-email:${commandId}`,
      payload: {
        draftKey,
        draftRevision: 1,
        to: recipient.email,
        subject,
        bodyText,
      },
    };
  });
  const drafts = await Promise.all(draftsWithoutDigest.map(async draft => ({
    ...draft,
    digest: await sha256(draft),
  })));
  const unsigned = {
    schemaVersion: 1 as const,
    planId,
    accountId: options.accountId,
    createdAt,
    recipients,
    drafts,
  };
  return deepFreeze({ ...unsigned, digest: await sha256(unsigned) });
}

export function grantMailMergeReview(
  plan: MailMergePlan,
  options: {
    readonly reviewedDraftDigests: readonly string[];
    readonly grantedAt: string;
    readonly grantId: string;
  },
): MailMergeReviewGrant {
  const grantedAt = parsedInstant(options.grantedAt, 'The review time');
  if (grantedAt < Date.parse(plan.createdAt)) {
    throw new Error('The review grant predates this mail merge plan.');
  }
  const expected = plan.drafts.map(draft => draft.digest).toSorted();
  const reviewed = [...new Set(options.reviewedDraftDigests)].toSorted();
  if (canonical(expected) !== canonical(reviewed)) {
    throw new Error('Review every recipient-level draft before creating provider drafts.');
  }
  return deepFreeze({
    schemaVersion: 1,
    grantId: safeGeneratedIdentifier('grant', options.grantId),
    planId: plan.planId,
    planDigest: plan.digest,
    reviewedDraftDigests: reviewed,
    grantedAt: new Date(grantedAt).toISOString(),
    expiresAt: new Date(grantedAt + MAIL_MERGE_REVIEW_GRANT_TTL_MS).toISOString(),
  });
}

export function commandsForReviewedMailMerge(
  plan: MailMergePlan,
  grant: MailMergeReviewGrant,
  now: string,
): readonly MailCommand<MailDraftPayload>[] {
  const nowMs = parsedInstant(now, 'The draft creation time');
  if (
    grant.planId !== plan.planId ||
    grant.planDigest !== plan.digest ||
    nowMs < Date.parse(grant.grantedAt) ||
    nowMs > Date.parse(grant.expiresAt)
  ) {
    throw new Error('The mail merge review grant is missing, expired, or belongs to another plan.');
  }
  const reviewed = new Set(grant.reviewedDraftDigests);
  if (plan.drafts.some(draft => !reviewed.has(draft.digest))) {
    throw new Error('The review grant does not cover every recipient-level draft.');
  }
  return deepFreeze(plan.drafts.map(draft => ({
    v: 1 as const,
    commandId: draft.commandId,
    idempotencyKey: draft.idempotencyKey,
    accountId: plan.accountId,
    threadId: null,
    kind: 'save_draft' as const,
    createdAt: new Date(nowMs).toISOString(),
    expectedProviderRevision: null,
    payload: draft.payload,
  })));
}

export interface MailMergeCommandClient {
  submitCommand(command: MailCommand): Promise<{
    readonly accepted: true;
    readonly duplicate: boolean;
    readonly receipt: MailCommandReceipt;
  }>;
  getCommand(commandId: string): Promise<MailCommandReceipt>;
}

export class MailMergeDraftPersistenceError extends Error {
  constructor(
    message: string,
    readonly receipts: readonly MailCommandReceipt[],
  ) {
    super(message);
    this.name = 'MailMergeDraftPersistenceError';
  }
}

function terminalReceipt(receipt: MailCommandReceipt): boolean {
  return ['applied', 'failed', 'uncertain', 'cancelled'].includes(receipt.state);
}

/** Persists only save_draft commands, sequentially, and never sends mail. */
export async function persistProviderVisibleMailMergeDrafts(options: {
  readonly client: MailMergeCommandClient;
  readonly commands: readonly MailCommand<MailDraftPayload>[];
  readonly wait?: (milliseconds: number) => Promise<void>;
  readonly maximumPollAttempts?: number;
  readonly onReceipt?: (command: MailCommand, receipt: MailCommandReceipt) => Promise<void> | void;
}): Promise<readonly MailCommandReceipt[]> {
  if (
    options.commands.length === 0 ||
    options.commands.length > MAXIMUM_MAIL_MERGE_RECIPIENTS ||
    options.commands.some(command => !isMailCommand(command) || command.kind !== 'save_draft')
  ) {
    throw new Error('Mail merge may persist only a bounded set of valid provider draft commands.');
  }
  const commandIds = options.commands.map(command => command.commandId);
  const idempotencyKeys = options.commands.map(command => command.idempotencyKey);
  if (
    new Set(commandIds).size !== commandIds.length ||
    new Set(idempotencyKeys).size !== idempotencyKeys.length
  ) {
    throw new Error('Every mail merge recipient requires a unique command and idempotency key.');
  }
  const wait = options.wait ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  const maximumPollAttempts = options.maximumPollAttempts ?? 120;
  const receipts: MailCommandReceipt[] = [];
  for (const command of options.commands) {
    const accepted = await options.client.submitCommand(command);
    let receipt = accepted.receipt;
    for (let attempt = 0; !terminalReceipt(receipt) && attempt < maximumPollAttempts; attempt += 1) {
      await wait(500);
      receipt = await options.client.getCommand(command.commandId);
    }
    receipts.push(receipt);
    if (terminalReceipt(receipt)) await options.onReceipt?.(command, receipt);
    if (receipt.state !== 'applied') {
      throw new MailMergeDraftPersistenceError(
        terminalReceipt(receipt)
          ? `Provider draft creation stopped with ${receipt.state}. No messages were sent.`
          : 'Provider draft creation is still pending. No messages were sent; check the outbox before retrying.',
        receipts,
      );
    }
  }
  return receipts;
}
