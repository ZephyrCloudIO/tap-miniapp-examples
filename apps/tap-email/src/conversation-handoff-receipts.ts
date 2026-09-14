import {
  sdk,
  type MiniAppJsonValue,
  type MiniAppStorageApi,
} from '@theaiplatform/miniapp-sdk/sdk';

export const conversationHandoffReceiptsAddress = {
  namespace: 'tap-email',
  key: 'conversation-handoff-receipts/v1',
} as const;

const maximumReceipts = 100;

export type ConversationHandoffReceiptStatus =
  | 'planned'
  | 'channel-created'
  | 'staged'
  | 'sent'
  | 'partial'
  | 'failed';

export interface ConversationHandoffReceipt {
  readonly schemaVersion: 1;
  readonly idempotencyKey: string;
  readonly accountId: string;
  readonly threadId: string;
  readonly selectedMessageIds: readonly string[];
  readonly contentMode: 'redacted-summary' | 'selected-messages';
  readonly referenceMode: 'snapshot' | 'live-link';
  readonly destinationKind: 'active-chat' | 'new-private' | 'existing-channel';
  readonly destinationId: string | null;
  readonly channelId: string | null;
  readonly messageId: string | null;
  readonly clientMessageId: string | null;
  readonly status: ConversationHandoffReceiptStatus;
  readonly occurredAt: string;
  readonly warning: string | null;
}

interface ConversationHandoffReceiptLedger {
  readonly schemaVersion: 1;
  readonly receipts: readonly ConversationHandoffReceipt[];
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

export function isConversationHandoffReceipt(
  value: unknown,
): value is ConversationHandoffReceipt {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ConversationHandoffReceipt>;
  return candidate.schemaVersion === 1 &&
    typeof candidate.idempotencyKey === 'string' &&
    typeof candidate.accountId === 'string' &&
    typeof candidate.threadId === 'string' &&
    isStringArray(candidate.selectedMessageIds) &&
    (candidate.contentMode === 'redacted-summary' || candidate.contentMode === 'selected-messages') &&
    (candidate.referenceMode === 'snapshot' || candidate.referenceMode === 'live-link') &&
    (
      candidate.destinationKind === 'active-chat' ||
      candidate.destinationKind === 'new-private' ||
      candidate.destinationKind === 'existing-channel'
    ) &&
    (candidate.destinationId === null || typeof candidate.destinationId === 'string') &&
    (candidate.channelId === null || typeof candidate.channelId === 'string') &&
    (candidate.messageId === null || typeof candidate.messageId === 'string') &&
    (candidate.clientMessageId === null || typeof candidate.clientMessageId === 'string') &&
    (
      candidate.status === 'planned' ||
      candidate.status === 'channel-created' ||
      candidate.status === 'staged' ||
      candidate.status === 'sent' ||
      candidate.status === 'partial' ||
      candidate.status === 'failed'
    ) &&
    typeof candidate.occurredAt === 'string' &&
    (candidate.warning === null || typeof candidate.warning === 'string');
}

function parseLedger(value: unknown): ConversationHandoffReceiptLedger {
  if (!value || typeof value !== 'object') {
    return { schemaVersion: 1, receipts: [] };
  }
  const candidate = value as Partial<ConversationHandoffReceiptLedger>;
  if (candidate.schemaVersion !== 1 || !Array.isArray(candidate.receipts)) {
    return { schemaVersion: 1, receipts: [] };
  }
  return {
    schemaVersion: 1,
    receipts: candidate.receipts.filter(isConversationHandoffReceipt),
  };
}

export async function loadConversationHandoffReceipts(
  storage: Pick<MiniAppStorageApi, 'get'> = sdk.storage,
): Promise<readonly ConversationHandoffReceipt[]> {
  const entry = await storage.get(conversationHandoffReceiptsAddress);
  return parseLedger(entry.value).receipts;
}

/**
 * Upserts one content-free receipt. The receipt retains only opaque mail IDs,
 * the reviewed disclosure choices, and host result IDs; it never persists a
 * subject, correspondent, summary, or message body.
 */
export async function persistConversationHandoffReceipt(
  receipt: ConversationHandoffReceipt,
  storage: Pick<MiniAppStorageApi, 'get' | 'set'> = sdk.storage,
): Promise<void> {
  if (!isConversationHandoffReceipt(receipt)) {
    throw new Error('TAP Email refused to persist a malformed handoff receipt.');
  }
  const entry = await storage.get(conversationHandoffReceiptsAddress);
  const current = parseLedger(entry.value).receipts;
  const receipts = [
    receipt,
    ...current.filter(item => item.idempotencyKey !== receipt.idempotencyKey),
  ].slice(0, maximumReceipts);
  await storage.set({
    ...conversationHandoffReceiptsAddress,
    expectedRevision: entry.revision,
    value: JSON.parse(JSON.stringify({
      schemaVersion: 1,
      receipts,
    })) as MiniAppJsonValue,
  });
}
