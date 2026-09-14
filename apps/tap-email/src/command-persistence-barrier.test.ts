import { describe, expect, it } from '@rstest/core';
import type { MailCommand, MailDraftPayload } from '@tap-examples/tap-email-protocol';
import { CommandPersistenceBarrier } from './command-persistence-barrier';

function sendCommand(commandId: string): MailCommand<MailDraftPayload> {
  return {
    v: 1,
    commandId,
    idempotencyKey: `idem-${commandId}`,
    accountId: 'acct-main',
    threadId: `thread-${commandId}`,
    expectedProviderRevision: null,
    kind: 'send_draft',
    payload: {
      draftKey: `draft-${commandId}`,
      draftRevision: 1,
      to: 'avery@example.com',
      subject: 'Crash-safe send',
      bodyText: 'Hello',
      clientMessageId: `<${commandId}@tap.invalid>`,
    },
    createdAt: '2026-09-14T12:00:00.000Z',
  };
}

describe('CommandPersistenceBarrier', () => {
  it('blocks a provider mutation until a capable store saves its pending command', () => {
    const barrier = new CommandPersistenceBarrier();
    const command = sendCommand('cmd-new');

    expect(barrier.readiness(command, 'private-profile-sqlite')).toEqual({
      ready: false,
      durable: false,
      reason: 'awaiting-persistence',
    });

    expect(barrier.releaseAfterSuccessfulSave(
      { commands: [command] },
      'private-profile-sqlite',
    )).toBe(true);
    expect(barrier.releaseAfterSuccessfulSave(
      { commands: [command] },
      'private-profile-sqlite',
    )).toBe(false);

    expect(barrier.readiness(command, 'private-profile-sqlite')).toEqual({
      ready: true,
      durable: true,
      reason: 'persisted',
    });
  });

  it('releases cached pending commands after a restart so settlement is reconstructable', () => {
    const persistedState = { commands: [sendCommand('cmd-before-crash')] };
    const restartedBarrier = new CommandPersistenceBarrier();

    restartedBarrier.seedFromCache(
      persistedState,
      'private-profile-sqlite',
    );

    expect(restartedBarrier.readiness(
      persistedState.commands[0]!,
      'private-profile-sqlite',
    )).toEqual({
      ready: true,
      durable: true,
      reason: 'persisted',
    });
  });

  it('does not release an unsaved command or changed payload with a reused ID', () => {
    const barrier = new CommandPersistenceBarrier();
    const persisted = sendCommand('cmd-persisted');
    const unsaved = sendCommand('cmd-unsaved');
    const changed = {
      ...persisted,
      payload: { ...persisted.payload, subject: 'Unsaved subject change' },
    };

    barrier.releaseAfterSuccessfulSave(
      { commands: [persisted] },
      'private-profile-sqlite',
    );

    expect(barrier.readiness(unsaved, 'private-profile-sqlite')).toEqual({
      ready: false,
      durable: false,
      reason: 'awaiting-persistence',
    });
    expect(barrier.readiness(changed, 'private-profile-sqlite')).toEqual({
      ready: false,
      durable: false,
      reason: 'awaiting-persistence',
    });
  });

  it('allows only the explicitly unavailable-storage fallback without durability', () => {
    const barrier = new CommandPersistenceBarrier();
    const command = sendCommand('cmd-no-store');

    expect(barrier.readiness(command, 'unavailable')).toEqual({
      ready: true,
      durable: false,
      reason: 'storage-unavailable',
    });
    expect(barrier.readiness(command, 'preview-fixture').ready).toBe(false);
    expect(barrier.readiness(command, 'private-profile-sqlite').ready).toBe(false);
  });
});
