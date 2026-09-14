import { describe, expect, it } from '@rstest/core';
import type { MailCommand, MailCommandReceipt } from '@tap-examples/tap-email-protocol';
import {
  composeMessage,
  isMailState,
  mailboxSummary,
  previewMailState,
  recoverableImmediateSends,
  retryRecoverableImmediateSend,
  settleMailCommand,
} from './domain';

const now = '2026-09-14T14:00:00.000Z';

function pendingSend(commandId = 'cmd_send_1') {
  const state = composeMessage(
    previewMailState(),
    commandId,
    'google_work',
    null,
    'maya@example.com',
    'Launch follow-up',
    'The complete original body.',
    null,
    now,
    { draftKey: 'draft_stable_1', draftRevision: 4 },
  );
  return { state, command: state.commands.at(-1)! };
}

function receipt(
  command: MailCommand,
  state: MailCommandReceipt['state'],
): MailCommandReceipt {
  return {
    commandId: command.commandId,
    idempotencyKey: command.idempotencyKey,
    accountId: command.accountId,
    state,
    acceptedAt: now,
    providerAcknowledgedAt: null,
    errorCode: state === 'failed' ? 'provider_rejected' : state === 'uncertain' ? 'outcome_unknown' : null,
  };
}

describe('recoverable immediate-send Outbox', () => {
  it('atomically preserves a failed send command and receipt before removing it from dispatch', () => {
    const { state, command } = pendingSend();
    const failed = settleMailCommand(state, command, receipt(command, 'failed'), now);

    expect(failed.commands).toHaveLength(0);
    expect(failed.undo).toBeNull();
    expect(recoverableImmediateSends(failed)[0]).toMatchObject({
      attempts: [{ command, receipt: { state: 'failed', errorCode: 'provider_rejected' } }],
    });
    expect(mailboxSummary(failed, now).failedCommands).toBe(1);
    expect(isMailState(failed)).toBe(true);
  });

  it('never retries an uncertain outcome and only reconciles its original identity', () => {
    const { state, command } = pendingSend();
    const uncertain = settleMailCommand(state, command, receipt(command, 'uncertain'), now);

    expect(retryRecoverableImmediateSend(
      uncertain,
      command.commandId,
      'cmd_retry_forbidden',
      '2026-09-14T14:01:00.000Z',
    )).toBe(uncertain);
    const applied = settleMailCommand(
      uncertain,
      command,
      receipt(command, 'applied'),
      '2026-09-14T14:02:00.000Z',
    );
    expect(recoverableImmediateSends(applied)).toEqual([]);
  });

  it('retries a definite failure with new attempt identity and the exact original draft identity', () => {
    const { state, command } = pendingSend();
    const failed = settleMailCommand(state, command, receipt(command, 'failed'), now);
    const retried = retryRecoverableImmediateSend(
      failed,
      command.commandId,
      'cmd_retry_2',
      '2026-09-14T14:01:00.000Z',
    );
    const retry = retried.commands[0]!;

    expect(retry.commandId).toBe('cmd_retry_2');
    expect(retry.idempotencyKey).toBe('tap-email:google_work:cmd_retry_2');
    expect(retry.payload).toBe(command.payload);
    expect(retry.threadId).toBe(command.threadId);
    expect(recoverableImmediateSends(retried)[0]?.attempts.map(attempt => attempt.command.commandId)).toEqual([
      command.commandId,
      'cmd_retry_2',
    ]);

    const retryUncertain = settleMailCommand(
      retried,
      retry,
      receipt(retry, 'uncertain'),
      '2026-09-14T14:02:00.000Z',
    );
    expect(retryRecoverableImmediateSend(
      retryUncertain,
      command.commandId,
      'cmd_retry_3',
      '2026-09-14T14:03:00.000Z',
    )).toBe(retryUncertain);
    expect(isMailState(retryUncertain)).toBe(true);
  });

  it('ignores a receipt that does not belong to the immutable command', () => {
    const { state, command } = pendingSend();
    const mismatch = { ...receipt(command, 'failed'), commandId: 'cmd_other' };
    expect(settleMailCommand(state, command, mismatch, now)).toBe(state);
  });
});
