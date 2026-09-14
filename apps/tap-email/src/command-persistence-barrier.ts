import type { MailCommand } from '@tap-examples/tap-email-protocol';
import type { MailState } from './domain';
import type { LocalMailStoreCapability } from './local-store';

export type CommandPersistenceReadiness =
  | {
      readonly ready: true;
      readonly durable: true;
      readonly reason: 'persisted';
    }
  | {
      readonly ready: true;
      readonly durable: false;
      readonly reason: 'storage-unavailable';
    }
  | {
      readonly ready: false;
      readonly durable: false;
      readonly reason: 'awaiting-persistence';
    };

type CommandState = Pick<MailState, 'commands'>;

/**
 * Gates provider mutations on a successful local snapshot containing the exact
 * command ID. A terminal receipt can then be replayed against that cached
 * pending command if the app exits before its settled Outbox state is saved.
 */
export class CommandPersistenceBarrier {
  readonly #persistedCommands = new Map<string, string>();

  seedFromCache(
    state: CommandState,
    capability: LocalMailStoreCapability,
  ): void {
    this.#persistedCommands.clear();
    if (capability === 'unavailable') return;
    this.#remember(state.commands);
  }

  releaseAfterSuccessfulSave(
    state: CommandState,
    capability: LocalMailStoreCapability,
  ): boolean {
    if (capability === 'unavailable') return false;
    return this.#remember(state.commands);
  }

  readiness(
    command: MailCommand,
    capability: LocalMailStoreCapability,
  ): CommandPersistenceReadiness {
    if (capability === 'unavailable') {
      return {
        ready: true,
        durable: false,
        reason: 'storage-unavailable',
      };
    }
    const persisted = this.#persistedCommands.get(command.commandId);
    if (persisted === JSON.stringify(command)) {
      return { ready: true, durable: true, reason: 'persisted' };
    }
    return {
      ready: false,
      durable: false,
      reason: 'awaiting-persistence',
    };
  }

  #remember(commands: readonly MailCommand[]): boolean {
    let released = false;
    for (const command of commands) {
      const serialized = JSON.stringify(command);
      if (this.#persistedCommands.get(command.commandId) !== serialized) {
        released = true;
      }
      this.#persistedCommands.set(command.commandId, serialized);
    }
    return released;
  }
}
