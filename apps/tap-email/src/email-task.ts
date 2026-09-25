import {
  sdk,
  type MiniAppActionReceipt,
  type MiniAppJsonValue,
  type MiniAppPlatformApi,
  type MiniAppStorageApi,
  type MiniAppTask,
  type MiniAppTaskPriority,
} from '@theaiplatform/miniapp-sdk/sdk';
import { isSafeMailIdentifier } from '@tap-examples/tap-email-protocol';

const MAXIMUM_TITLE_CHARACTERS = 160;
const MAXIMUM_METADATA_CHARACTERS = 2_048;
const MAXIMUM_RECEIPTS = 100;

export const EMAIL_TASK_WRITE_ACTION = 'task.write';
export const emailTaskReceiptsAddress = {
  namespace: 'tap-email',
  key: 'email-task-receipts/v1',
} as const;

export interface EmailTaskSource {
  readonly accountId: string;
  readonly threadId: string;
  readonly subject: string;
  readonly sender: string;
  readonly receivedAt: string;
  readonly backlink: string;
  readonly critical: boolean;
  readonly needsResponse: boolean;
  readonly reminderDueAt: string | null;
}

export interface EmailTaskReceiptRecord {
  readonly schemaVersion: 1;
  readonly workspaceId: string;
  readonly accountId: string;
  readonly threadId: string;
  readonly idempotencyKey: string;
  readonly receiptId: string;
  readonly receiptStatus: MiniAppActionReceipt['status'];
  readonly configurationStatus: 'not-applicable' | 'applied' | 'failed';
  readonly taskId: string | null;
  readonly error: string | null;
  readonly updatedAt: string;
}

interface EmailTaskReceiptLedger {
  readonly schemaVersion: 1;
  readonly receipts: readonly EmailTaskReceiptRecord[];
}

export type EmailTaskCreationOutcome =
  | Readonly<{
      status: 'completed' | 'duplicate-suppressed';
      receipt: MiniAppActionReceipt;
      task: MiniAppTask;
    }>
  | Readonly<{
      status: 'pending' | 'failed';
      receipt: MiniAppActionReceipt;
      task: null;
    }>;

type EmailTaskPlatform = Pick<MiniAppPlatformApi, 'tasks'>;
type ReceiptWriter = (receipt: EmailTaskReceiptRecord) => Promise<void>;

export class EmailTaskCapabilityUnavailableError extends Error {
  readonly code = 'email_task_capability_unavailable' as const;

  constructor() {
    super('This TAP host does not expose receipt-backed Tasks.');
    this.name = 'EmailTaskCapabilityUnavailableError';
  }
}

export class InvalidEmailTaskSourceError extends Error {
  readonly code = 'invalid_email_task_source' as const;

  constructor() {
    super('TAP Email refused to create a Task from an invalid email source locator.');
    this.name = 'InvalidEmailTaskSourceError';
  }
}

export class EmailTaskConfigurationError extends Error {
  readonly code = 'email_task_configuration_failed' as const;

  constructor(
    readonly receipt: MiniAppActionReceipt,
    readonly taskId: string,
    options?: ErrorOptions,
  ) {
    super('The task exists, but TAP Email could not apply its due date and priority.', options);
    this.name = 'EmailTaskConfigurationError';
  }
}

export class EmailTaskReceiptPersistenceError extends Error {
  readonly code = 'email_task_receipt_persistence_failed' as const;

  constructor(
    readonly receipt: MiniAppActionReceipt,
    readonly task: MiniAppTask | null,
    options?: ErrorOptions,
  ) {
    super('TAP returned a task receipt, but TAP Email could not cache its local receipt state.', options);
    this.name = 'EmailTaskReceiptPersistenceError';
  }
}

function truncate(value: string, maximum: number, suffix = '…'): string {
  if (value.length <= maximum) return value;
  let end = Math.max(0, maximum - suffix.length);
  const finalCodeUnit = value.charCodeAt(end - 1);
  if (finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) end -= 1;
  return `${value.slice(0, end)}${suffix}`;
}

function oneLine(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function finiteTimestamp(value: string | null): number | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function defaultPriority(source: EmailTaskSource): MiniAppTaskPriority {
  if (source.critical) return 'urgent';
  if (source.needsResponse) return 'high';
  return 'medium';
}

function assertEmailTaskSource(source: EmailTaskSource, workspaceId: string): void {
  if (
    !workspaceId.trim() ||
    !isSafeMailIdentifier(source.accountId) ||
    !isSafeMailIdentifier(source.threadId) ||
    !Number.isFinite(Date.parse(source.receivedAt))
  ) {
    throw new InvalidEmailTaskSourceError();
  }
  if (!source.backlink.startsWith('#')) throw new InvalidEmailTaskSourceError();
  const parameters = new URLSearchParams(source.backlink.slice(1));
  if (
    parameters.get('account') !== source.accountId ||
    parameters.get('threadAccount') !== source.accountId ||
    parameters.get('thread') !== source.threadId
  ) {
    throw new InvalidEmailTaskSourceError();
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function taskIdFromReceipt(receipt: MiniAppActionReceipt): string | null {
  if (!isRecord(receipt.result)) return null;
  const taskId = receipt.result.taskId;
  return typeof taskId === 'string' && taskId.length > 0 ? taskId : null;
}

function isReceiptStatus(value: unknown): value is MiniAppActionReceipt['status'] {
  return value === 'completed' ||
    value === 'duplicate-suppressed' ||
    value === 'pending' ||
    value === 'failed';
}

export function isEmailTaskReceiptRecord(value: unknown): value is EmailTaskReceiptRecord {
  if (!isRecord(value)) return false;
  return value.schemaVersion === 1 &&
    typeof value.workspaceId === 'string' &&
    typeof value.accountId === 'string' &&
    typeof value.threadId === 'string' &&
    typeof value.idempotencyKey === 'string' &&
    typeof value.receiptId === 'string' &&
    isReceiptStatus(value.receiptStatus) &&
    (
      value.configurationStatus === 'not-applicable' ||
      value.configurationStatus === 'applied' ||
      value.configurationStatus === 'failed'
    ) &&
    (value.taskId === null || typeof value.taskId === 'string') &&
    (value.error === null || typeof value.error === 'string') &&
    typeof value.updatedAt === 'string';
}

function parseReceiptLedger(value: unknown): EmailTaskReceiptLedger {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.receipts)) {
    return { schemaVersion: 1, receipts: [] };
  }
  return {
    schemaVersion: 1,
    receipts: value.receipts.filter(isEmailTaskReceiptRecord),
  };
}

export async function persistEmailTaskReceipt(
  receipt: EmailTaskReceiptRecord,
  storage: Pick<MiniAppStorageApi, 'get' | 'set'> = sdk.storage,
): Promise<void> {
  if (!isEmailTaskReceiptRecord(receipt)) {
    throw new Error('TAP Email refused to persist a malformed task receipt.');
  }
  const entry = await storage.get(emailTaskReceiptsAddress);
  const current = parseReceiptLedger(entry.value).receipts;
  const receipts = [
    receipt,
    ...current.filter(item => item.idempotencyKey !== receipt.idempotencyKey),
  ].slice(0, MAXIMUM_RECEIPTS);
  await storage.set({
    ...emailTaskReceiptsAddress,
    expectedRevision: entry.revision,
    value: JSON.parse(JSON.stringify({ schemaVersion: 1, receipts })) as MiniAppJsonValue,
  });
}

export async function loadEmailTaskReceipts(
  storage: Pick<MiniAppStorageApi, 'get'> = sdk.storage,
): Promise<readonly EmailTaskReceiptRecord[]> {
  const entry = await storage.get(emailTaskReceiptsAddress);
  return parseReceiptLedger(entry.value).receipts;
}

export async function emailTaskIdempotencyKey(
  source: Pick<EmailTaskSource, 'accountId' | 'threadId'>,
  workspaceId: string,
): Promise<string> {
  const material = new TextEncoder().encode(
    JSON.stringify(['tap-email-task-v1', workspaceId, source.accountId, source.threadId]),
  );
  const bytes = new Uint8Array(material);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes.buffer);
  const hex = [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
  return `tap-email:task:v1:${hex}`;
}

export function emailTaskMetadata(source: EmailTaskSource): string {
  const subject = truncate(oneLine(source.subject) || 'Untitled email', 320);
  const sender = truncate(oneLine(source.sender) || 'Unknown sender', 240);
  const backlink = truncate(oneLine(source.backlink), 768);
  const lines = [
    `Email: ${subject}`,
    `From: ${sender}`,
    `Received: ${source.receivedAt}`,
    `Source account ID: ${source.accountId}`,
    `Source thread ID: ${source.threadId}`,
    `Backlink: ${backlink}`,
    '',
    'Open the source email in TAP Email before acting. Message bodies and snippets are intentionally not copied into this task.',
  ];
  return truncate(lines.join('\n'), MAXIMUM_METADATA_CHARACTERS, '\n[Metadata truncated by TAP Email.]');
}

export function emailTaskTitle(source: Pick<EmailTaskSource, 'subject'>): string {
  const subject = oneLine(source.subject) || 'Untitled email';
  return truncate(`Follow up: ${subject}`, MAXIMUM_TITLE_CHARACTERS);
}

export async function createEmailTask({
  platform,
  workspaceId,
  source,
  priority = defaultPriority(source),
  dueDate = finiteTimestamp(source.reminderDueAt),
  persistReceipt = persistEmailTaskReceipt,
  now = () => new Date().toISOString(),
}: {
  readonly platform: EmailTaskPlatform;
  readonly workspaceId: string;
  readonly source: EmailTaskSource;
  readonly priority?: MiniAppTaskPriority;
  readonly dueDate?: number;
  readonly persistReceipt?: ReceiptWriter;
  readonly now?: () => string;
}): Promise<EmailTaskCreationOutcome> {
  const tasks = platform.tasks;
  if (!tasks) throw new EmailTaskCapabilityUnavailableError();
  assertEmailTaskSource(source, workspaceId);
  if (dueDate !== undefined && !Number.isFinite(dueDate)) {
    throw new InvalidEmailTaskSourceError();
  }
  const idempotencyKey = await emailTaskIdempotencyKey(source, workspaceId);
  const { receipt } = await tasks.createWithReceipt({
    workspaceId,
    title: emailTaskTitle(source),
    description: emailTaskMetadata(source),
    initialPhase: 'inbox',
    idempotencyKey,
  });

  if (receipt.status === 'pending' || receipt.status === 'failed') {
    try {
      await persistReceipt({
        schemaVersion: 1,
        workspaceId,
        accountId: source.accountId,
        threadId: source.threadId,
        idempotencyKey,
        receiptId: receipt.receiptId,
        receiptStatus: receipt.status,
        configurationStatus: 'not-applicable',
        taskId: null,
        error: receipt.error,
        updatedAt: now(),
      });
    } catch (error) {
      throw new EmailTaskReceiptPersistenceError(receipt, null, { cause: error });
    }
    return { status: receipt.status, receipt, task: null };
  }

  const taskId = taskIdFromReceipt(receipt);
  if (!taskId) {
    const error = `Task receipt ${receipt.receiptId} did not include a task ID.`;
    await persistReceipt({
      schemaVersion: 1,
      workspaceId,
      accountId: source.accountId,
      threadId: source.threadId,
      idempotencyKey,
      receiptId: receipt.receiptId,
      receiptStatus: receipt.status,
      configurationStatus: 'failed',
      taskId: null,
      error,
      updatedAt: now(),
    }).catch(() => undefined);
    throw new Error(error);
  }

  let task: MiniAppTask;
  try {
    const update = {
      workspaceId,
      taskId,
      priority,
      ...(dueDate === undefined ? {} : { dueAt: dueDate }),
    } satisfies Parameters<typeof tasks.update>[0];
    ({ task } = await tasks.update(update));
  } catch (error) {
    await persistReceipt({
      schemaVersion: 1,
      workspaceId,
      accountId: source.accountId,
      threadId: source.threadId,
      idempotencyKey,
      receiptId: receipt.receiptId,
      receiptStatus: receipt.status,
      configurationStatus: 'failed',
      taskId,
      error: error instanceof Error ? truncate(error.message, 240) : 'Task configuration failed.',
      updatedAt: now(),
    }).catch(() => undefined);
    throw new EmailTaskConfigurationError(receipt, taskId, { cause: error });
  }
  try {
    await persistReceipt({
      schemaVersion: 1,
      workspaceId,
      accountId: source.accountId,
      threadId: source.threadId,
      idempotencyKey,
      receiptId: receipt.receiptId,
      receiptStatus: receipt.status,
      configurationStatus: 'applied',
      taskId,
      error: null,
      updatedAt: now(),
    });
    return { status: receipt.status, receipt, task };
  } catch (error) {
    throw new EmailTaskReceiptPersistenceError(receipt, task, { cause: error });
  }
}
