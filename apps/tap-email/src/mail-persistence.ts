import type { MailState } from './domain';
import type { LocalMailStore } from './local-store';
import { journalOf } from './bounded-mail-replica';
import type { CommandPersistenceBarrier } from './command-persistence-barrier';

/** Release only the immutable command set that this particular await committed. */
export async function persistCommandSnapshot(
  store: LocalMailStore, barrier: CommandPersistenceBarrier, snapshot: MailState,
): Promise<boolean> {
  if (store.saveJournal) await store.saveJournal(journalOf(snapshot));
  else await store.save(snapshot);
  return barrier.releaseAfterSuccessfulSave(snapshot, store.capability);
}

/** One active state and one replaceable latest state; a fixed timer cannot be starved by renders. */
export class MailPersistenceQueue {
  private latest: MailState | null = null;
  private running: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(private readonly write: (state: MailState) => Promise<void>, private readonly delayMs = 250) {}

  request(state: MailState): void {
    this.latest = state;
    if (!this.running && this.timer === null) {
      this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, this.delayMs);
    }
  }

  async flush(): Promise<void> {
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
    if (this.running) return this.running;
    const run = async () => {
      while (this.latest) {
        const snapshot = this.latest;
        this.latest = null;
        await this.write(snapshot);
      }
    };
    this.running = run().finally(() => { this.running = null; });
    return this.running;
  }
}

/** Merge recovery data before enabling writes after a failed cache/migration open. */
export function recoverMailJournal(current: MailState, recovered: MailState | null): MailState {
  if (!recovered) return current;
  const commands = new Map(recovered.commands.map(command => [command.commandId, command]));
  for (const command of current.commands) commands.set(command.commandId, command);
  const intents = new Map((recovered.pendingThreadIntents ?? []).map(intent => [intent.commandId, intent]));
  for (const intent of current.pendingThreadIntents ?? []) intents.set(intent.commandId, intent);
  const outbox = new Map((recovered.outbox ?? []).map(item => [item.attempts[0]!.command.commandId, item]));
  for (const item of current.outbox ?? []) outbox.set(item.attempts[0]!.command.commandId, item);
  const accounts = new Map(recovered.accounts.map(account => [account.accountId, account]));
  for (const account of current.accounts) accounts.set(account.accountId, account);
  return { ...current, accounts: [...accounts.values()], commands: [...commands.values()],
    pendingThreadIntents: [...intents.values()], outbox: [...outbox.values()], undo: current.undo ?? recovered.undo };
}
