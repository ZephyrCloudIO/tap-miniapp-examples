import { describe, expect, it, rs } from '@rstest/core';
import {
  conversationHandoffReceiptsAddress,
  loadConversationHandoffReceipts,
  persistConversationHandoffReceipt,
  type ConversationHandoffReceipt,
} from './conversation-handoff-receipts';

function receipt(
  overrides: Partial<ConversationHandoffReceipt> = {},
): ConversationHandoffReceipt {
  return {
    schemaVersion: 1,
    idempotencyKey: 'tap-email:handoff:review-1',
    accountId: 'account-1',
    threadId: 'thread-1',
    selectedMessageIds: ['message-1'],
    contentMode: 'redacted-summary',
    referenceMode: 'live-link',
    destinationKind: 'active-chat',
    destinationId: null,
    channelId: null,
    messageId: null,
    clientMessageId: null,
    status: 'planned',
    occurredAt: '2026-09-14T14:00:00.000Z',
    warning: null,
    ...overrides,
  };
}

function storage(initial: unknown = null) {
  let value = initial;
  let revision: number | null = initial === null ? null : 1;
  const get = rs.fn(async () => ({ value, revision }));
  const set = rs.fn(async (options: {
    readonly expectedRevision: number | null;
    readonly value: unknown;
  }) => {
    expect(options.expectedRevision).toBe(revision);
    value = options.value;
    revision = (revision ?? 0) + 1;
    return { revision };
  });
  return { value: { get, set }, get, set };
}

describe('conversation handoff receipts', () => {
  it('persists only the content-free receipt envelope', async () => {
    const target = storage();

    await persistConversationHandoffReceipt(receipt(), target.value as never);

    expect(target.set).toHaveBeenCalledWith(expect.objectContaining({
      ...conversationHandoffReceiptsAddress,
      expectedRevision: null,
    }));
    const serialized = JSON.stringify(target.set.mock.calls[0]?.[0]);
    expect(serialized).not.toContain('A useful email');
    expect(serialized).not.toContain('Sender Person');
    expect(serialized).not.toContain('The email body');
    await expect(loadConversationHandoffReceipts(target.value as never))
      .resolves.toEqual([receipt()]);
  });

  it('replaces retries by stable idempotency key instead of growing duplicates', async () => {
    const target = storage();
    await persistConversationHandoffReceipt(receipt(), target.value as never);
    await persistConversationHandoffReceipt(receipt({
      status: 'sent',
      channelId: 'room-1',
      messageId: 'message-host-1',
      clientMessageId: 'tap-email:handoff:review-1',
      occurredAt: '2026-09-14T14:01:00.000Z',
    }), target.value as never);

    const loaded = await loadConversationHandoffReceipts(target.value as never);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toEqual(expect.objectContaining({
      status: 'sent',
      channelId: 'room-1',
    }));
  });

  it('ignores malformed legacy entries while loading', async () => {
    const target = storage({
      schemaVersion: 1,
      receipts: [receipt(), { schemaVersion: 1, bodyText: 'must not survive' }],
    });
    await expect(loadConversationHandoffReceipts(target.value as never))
      .resolves.toEqual([receipt()]);
  });
});
