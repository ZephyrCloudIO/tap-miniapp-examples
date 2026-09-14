import { describe, expect, it, rs } from '@rstest/core';
import {
  ConversationHandoffPartialError,
  ConversationHandoffPermissionError,
  buildConversationHandoffText,
  conversationHandoffErrorMessage,
  defaultRedactedConversationSummary,
  handoffEmailToConversation,
  listConversationHandoffChannels,
  parseConversationHandoffDeepLink,
  type ConversationHandoffPhase,
  type ConversationHandoffPlan,
} from './conversation-handoff';
import type { ConversationHandoffReceipt } from './conversation-handoff-receipts';

function platform(options: {
  readonly deniedAction?: string;
  readonly sendError?: Error;
  readonly chatError?: Error;
} = {}) {
  const check = rs.fn(async ({ actionId }: { actionId: string }) => ({
    allowed: actionId !== options.deniedAction,
  }));
  const create = rs.fn(async (_options: unknown) => ({ roomId: 'room-1' }));
  const list = rs.fn(async (_options: unknown) => ({
    rooms: [
      { roomId: 'room-z', title: 'Zephyr', visibility: 'private', archived: false, createdAt: 1, updatedAt: 1 },
      { roomId: 'room-a', title: 'Alpha', visibility: 'private', archived: false, createdAt: 1, updatedAt: 1 },
      { roomId: 'room-old', title: 'Archived', visibility: 'private', archived: true, createdAt: 1, updatedAt: 1 },
    ],
    readMode: 'full',
  }));
  const sendMessage = options.sendError
    ? rs.fn(async (_options: unknown) => { throw options.sendError; })
    : rs.fn(async (input: { clientMessageId?: string }) => ({
        messageId: 'message-host-1',
        clientMessageId: input.clientMessageId ?? 'host-generated',
      }));
  const sendTextToChat = options.chatError
    ? rs.fn(async (_text: string) => { throw options.chatError; })
    : rs.fn(async (_text: string) => undefined);
  const stageDeepLinkWithRollback = rs.fn(async (_options: unknown) => ({ id: 'staged-1' }));
  const unstageDeepLink = rs.fn(async (_staged: unknown) => undefined);
  return {
    value: {
      authorization: { check },
      channels: { create, list, sendMessage },
      chat: { sendTextToChat, stageDeepLinkWithRollback, unstageDeepLink },
    },
    check,
    create,
    list,
    sendMessage,
    sendTextToChat,
    stageDeepLinkWithRollback,
    unstageDeepLink,
  };
}

const source = {
  accountId: 'account-1',
  threadId: 'thread-1',
  subject: 'A useful email',
  receivedAt: '2026-09-14T12:00:00.000Z',
  unread: true,
  critical: false,
  needsResponse: true,
  waitingOnOthers: false,
  messages: [
    {
      messageId: 'message-1',
      from: { name: 'Sender Person', address: 'sender@example.com' },
      to: [{ name: 'Zack', address: 'zack@example.com' }],
      sentAt: '2026-09-14T12:00:00.000Z',
      bodyText: 'The first email body.',
    },
    {
      messageId: 'message-2',
      from: { name: 'Other Person', address: 'other@example.com' },
      to: [{ name: 'Zack', address: 'zack@example.com' }],
      sentAt: '2026-09-14T13:00:00.000Z',
      bodyText: 'The latest email body.',
    },
  ],
} as const;

function plan(overrides: Partial<ConversationHandoffPlan> = {}): ConversationHandoffPlan {
  return {
    idempotencyKey: 'tap-email:handoff:review-1',
    workspaceId: 'workspace-1',
    source,
    contentMode: 'redacted-summary',
    referenceMode: 'live-link',
    selectedMessageIds: ['message-2'],
    redactedSummary: defaultRedactedConversationSummary(source),
    destination: { kind: 'active-chat' },
    ...overrides,
  };
}

describe('email conversation handoff', () => {
  it('builds a useful default summary without raw mail content', () => {
    const summary = defaultRedactedConversationSummary(source);
    expect(summary).toContain('2 messages');
    expect(summary).toContain('needs a response');
    expect(summary).not.toContain(source.subject);
    expect(summary).not.toContain('Sender Person');
    expect(summary).not.toContain('The latest email body');
  });

  it('lists only active TAP destinations after a read permission check', async () => {
    const host = platform();
    await expect(listConversationHandoffChannels(host.value as never, 'workspace-1'))
      .resolves.toEqual([
        expect.objectContaining({ roomId: 'room-a' }),
        expect.objectContaining({ roomId: 'room-z' }),
      ]);
    expect(host.check).toHaveBeenCalledWith({
      actionId: 'channels.list',
      autonomy: 'listen',
    });
    expect(host.list).toHaveBeenCalledWith({ workspaceId: 'workspace-1' });
  });

  it('accepts only bounded package-owned Email locators', () => {
    expect(parseConversationHandoffDeepLink({
      kind: 'tap-email.thread',
      accountId: 'account-1',
      threadId: 'thread-1',
      messageIds: ['message-2', 'bad id with spaces'],
    })).toEqual({
      accountId: 'account-1',
      threadId: 'thread-1',
      messageIds: ['message-2'],
    });
    expect(parseConversationHandoffDeepLink({
      kind: 'another-package.thread',
      accountId: 'account-1',
      threadId: 'thread-1',
    })).toBeNull();
  });

  it('stages a redacted live link in the editable TAP Chat composer', async () => {
    const host = platform();
    const receipts: ConversationHandoffReceipt[] = [];
    const phases: ConversationHandoffPhase[] = [];

    await expect(handoffEmailToConversation({
      platform: host.value as never,
      plan: plan(),
      recordReceipt: item => { receipts.push(item); },
      now: () => '2026-09-14T14:00:00.000Z',
      onPhase: phase => phases.push(phase),
    })).resolves.toEqual({
      status: 'staged',
      channelId: null,
      messageId: null,
      clientMessageId: null,
    });

    expect(phases).toEqual(['checking', 'staging']);
    expect(host.stageDeepLinkWithRollback).toHaveBeenCalledWith({
      label: 'Open selected email in TAP Email',
      target: {
        kind: 'tap-email.thread',
        accountId: 'account-1',
        threadId: 'thread-1',
        messageIds: [],
      },
    });
    const stagedText = host.sendTextToChat.mock.calls[0]?.[0] as string;
    expect(stagedText).toContain('Redacted summary');
    expect(stagedText).not.toContain(source.subject);
    expect(stagedText).not.toContain('Sender Person');
    expect(stagedText).not.toContain('The latest email body');
    expect(receipts.map(item => item.status)).toEqual(['planned', 'staged']);
  });

  it('shares only explicitly selected message snapshots with a stable client id', async () => {
    const host = platform();
    const receipts: ConversationHandoffReceipt[] = [];

    await handoffEmailToConversation({
      platform: host.value as never,
      plan: plan({
        contentMode: 'selected-messages',
        referenceMode: 'snapshot',
        destination: { kind: 'new-private', name: 'Email discussion' },
      }),
      recordReceipt: item => { receipts.push(item); },
      now: () => '2026-09-14T14:00:00.000Z',
    });

    expect(host.create).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      name: 'Email discussion',
      description: 'Private TAP conversation created from a reviewed email handoff.',
      visibility: 'private',
    });
    expect(host.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'workspace-1',
      channelId: 'room-1',
      clientMessageId: 'tap-email:handoff:review-1',
    }));
    const sent = host.sendMessage.mock.calls[0]?.[0] as {
      body: string;
      messageContent?: unknown;
    };
    expect(sent.body).toContain('The latest email body.');
    expect(sent.body).not.toContain('The first email body.');
    expect(sent.messageContent).toBeUndefined();
    expect(receipts.map(item => item.status)).toEqual([
      'planned',
      'channel-created',
      'sent',
    ]);
    expect(receipts.at(-1)?.selectedMessageIds).toEqual(['message-2']);
  });

  it('attaches only opaque source ids to a direct-channel live link', async () => {
    const host = platform();
    await handoffEmailToConversation({
      platform: host.value as never,
      plan: plan({
        contentMode: 'selected-messages',
        referenceMode: 'live-link',
        destination: {
          kind: 'existing-channel',
          channelId: 'room-a',
          label: 'Alpha',
        },
      }),
      recordReceipt: () => undefined,
    });

    expect(host.create).not.toHaveBeenCalled();
    const sent = host.sendMessage.mock.calls[0]?.[0] as {
      body: string;
      messageContent: unknown;
    };
    expect(sent.body).not.toContain(source.subject);
    expect(sent.body).not.toContain('The latest email body.');
    expect(sent.messageContent).toEqual({
      tapEmail: {
        kind: 'tap-email.thread',
        accountId: 'account-1',
        threadId: 'thread-1',
        messageIds: ['message-2'],
        referenceMode: 'live-link',
      },
    });
  });

  it('fails before a host write when required destination access is denied', async () => {
    const host = platform({ deniedAction: 'channels.send-message' });
    await expect(handoffEmailToConversation({
      platform: host.value as never,
      plan: plan({ destination: { kind: 'new-private', name: 'Email discussion' } }),
      recordReceipt: () => undefined,
    })).rejects.toBeInstanceOf(ConversationHandoffPermissionError);
    expect(host.create).not.toHaveBeenCalled();
    expect(host.sendMessage).not.toHaveBeenCalled();
  });

  it('records a partial result when a new channel exists but delivery fails', async () => {
    const host = platform({ sendError: new Error('offline') });
    const receipts: ConversationHandoffReceipt[] = [];
    await expect(handoffEmailToConversation({
      platform: host.value as never,
      plan: plan({ destination: { kind: 'new-private', name: 'Email discussion' } }),
      recordReceipt: item => { receipts.push(item); },
    })).rejects.toEqual(expect.objectContaining({
      channelId: 'room-1',
    } satisfies Partial<ConversationHandoffPartialError>));
    expect(receipts.at(-1)?.status).toBe('partial');
    expect(receipts.at(-1)?.channelId).toBe('room-1');
  });

  it('removes a staged link when Chat text staging fails', async () => {
    const host = platform({ chatError: new Error('offline') });
    await expect(handoffEmailToConversation({
      platform: host.value as never,
      plan: plan(),
      recordReceipt: () => undefined,
    })).rejects.toThrow('offline');
    expect(host.unstageDeepLink).toHaveBeenCalledWith({ id: 'staged-1' });
  });

  it('bounds selected snapshots to the channel contract', () => {
    const text = buildConversationHandoffText(plan({
      source: {
        ...source,
        messages: [{ ...source.messages[1], bodyText: 'B'.repeat(300_000) }],
      },
      contentMode: 'selected-messages',
      referenceMode: 'snapshot',
      selectedMessageIds: ['message-2'],
    }));
    expect(text.length).toBe(256 * 1_024);
    expect(text).toContain('[Email context truncated by TAP Email.]');
  });

  it('maps host failures to stable UI copy without leaking details', () => {
    expect(conversationHandoffErrorMessage(
      new ConversationHandoffPermissionError(),
    )).toContain('not permitted');
    expect(conversationHandoffErrorMessage(
      new ConversationHandoffPartialError('room-1'),
    )).toContain('Retry');
    expect(conversationHandoffErrorMessage(new Error('The mini app host action timed out.')))
      .toContain('same reviewed plan');
    expect(conversationHandoffErrorMessage(new Error('private detail')))
      .not.toContain('private detail');
  });
});
