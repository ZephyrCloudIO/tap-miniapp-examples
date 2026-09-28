import { describe, expect, it } from '@rstest/core';
import type { MailCommandReceipt } from '@tap-examples/tap-email-protocol';
import { composeMessage, outboxImmediateSends, previewMailState, retryRecoverableImmediateSend, settleMailCommand, undoLastAction } from './domain';
import { outgoingThreadMessages } from './outgoing-messages';

const now = '2026-09-28T18:00:00.000Z';
const seed = previewMailState();
const thread = seed.threads[0]!;
function pendingReply() {
  return composeMessage(seed, 'cmd_reply', thread.accountId, thread.threadId, 'Maya <maya@example.com>',
    `Re: ${thread.subject}`, 'The entire reply\n\nincluding its signature.', null, now, {
      draftKey: 'draft_reply', draftRevision: 1, cc: 'team@example.com', bcc: 'private@example.com',
      sendAfter: '2026-09-28T18:00:05.000Z',
    });
}
function receipt(state: MailCommandReceipt['state']): MailCommandReceipt {
  const command = pendingReply().commands.at(-1)!;
  return { commandId: command.commandId, idempotencyKey: command.idempotencyKey, accountId: command.accountId,
    state, acceptedAt: now, providerAcknowledgedAt: state === 'applied' ? now : null, errorCode: null };
}

describe('optimistic outgoing replies', () => {
  it('projects the complete pending reply only into its original account and thread', () => {
    const state = pendingReply();
    const messages = outgoingThreadMessages(state, thread);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ status: 'sending', cc: 'team@example.com', bcc: 'private@example.com',
      message: { messageId: 'outgoing:draft_reply', to: [{ address: 'Maya <maya@example.com>' }],
        from: { address: seed.accounts.find(account => account.accountId === thread.accountId)!.address },
        bodyText: 'The entire reply\n\nincluding its signature.' } });
    expect(state.threads).toBe(seed.threads);
    expect(outgoingThreadMessages(state, { ...thread, accountId: 'other' })).toEqual([]);
    expect(outgoingThreadMessages(state, { ...thread, threadId: 'other' })).toEqual([]);
    expect(outgoingThreadMessages(undoLastAction(state, now), thread)).toEqual([]);
  });

  it('keeps delayed and failed replies visible and reuses one message for a retry', () => {
    const state = pendingReply();
    const command = state.commands.at(-1)!;
    expect(outgoingThreadMessages(state, thread, [], { cmd_reply: 'Network unavailable' })[0]?.status).toBe('delayed');
    for (const outcome of ['failed', 'uncertain'] as const) {
      const settled = settleMailCommand(state, command, receipt(outcome), now);
      expect(outgoingThreadMessages(settled, thread)[0]?.status).toBe(outcome);
    }
    const failed = settleMailCommand(state, command, receipt('failed'), now);
    const retry = retryRecoverableImmediateSend(failed, 'cmd_reply', 'cmd_retry', now);
    expect(outgoingThreadMessages(retry, thread)).toHaveLength(1);
    expect(outgoingThreadMessages(retry, thread)[0]).toMatchObject({ status: 'sending', message: { messageId: 'outgoing:draft_reply' } });
  });

  it('keeps the confirmed reply until the matching provider message arrives, without duplication', () => {
    const state = pendingReply();
    const pending = outboxImmediateSends(state)[0]!;
    const applied = receipt('applied');
    const confirmed = { ...pending, attempts: [{ command: pending.attempts[0]!.command, receipt: applied }] };
    const settled = settleMailCommand(state, pending.attempts[0]!.command, applied, now);
    expect(outgoingThreadMessages(state, thread, [confirmed])[0]?.status).toBe('sent');
    expect(outgoingThreadMessages(settled, thread, [confirmed])).toHaveLength(1);
    const received = { ...thread, messages: [...thread.messages, {
      ...outgoingThreadMessages(settled, thread, [confirmed])[0]!.message,
      messageId: 'gmail_provider_message', internetMessageId: '<draft_reply@tap-email.local>',
    }] };
    expect(outgoingThreadMessages(state, received, [confirmed])).toEqual([]);
    // A refresh with only older provider messages must not erase the local reply.
    expect(outgoingThreadMessages(settled, { ...thread, messages: thread.messages.slice(0, 1) }, [confirmed])).toHaveLength(1);
  });
});
