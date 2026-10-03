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
  private latest: { state: MailState; version: number } | null = null;
  private requestedVersion = 0;
  private persistedVersion = 0;
  private failure: { error: unknown } | null = null;
  private waiters: { version: number; resolve: () => void; reject: (error: unknown) => void }[] = [];
  private running: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(private readonly write: (state: MailState) => Promise<void>, private readonly delayMs = 250) {}

  request(state: MailState): void {
    this.latest = { state, version: ++this.requestedVersion };
    this.schedule();
  }

  private schedule(): void {
    if (this.latest && !this.running && this.timer === null) {
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.flush().catch(() => undefined);
      }, this.delayMs);
    }
  }

  /** Reads wait for existing writes, without waiting for future sync updates. */
  flushCurrent(): Promise<void> {
    if (this.persistedVersion >= this.requestedVersion) return Promise.resolve();
    if (!this.latest && this.failure) return Promise.reject(this.failure.error);
    let failed!: (error: unknown) => void;
    const result = new Promise<void>((resolve, reject) => {
      const waiter = { version: this.requestedVersion, resolve, reject };
      this.waiters.push(waiter);
      failed = error => {
        this.waiters = this.waiters.filter(item => item !== waiter);
        reject(error);
      };
    });
    // The drain reports failures to the waiters as well as callers of flush().
    void this.flush().catch(failed);
    return result;
  }

  /** Shutdown still waits until every queued write has finished. */
  async flush(): Promise<void> {
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
    if (this.running) return this.running;
    const run = async () => {
      try {
        while (this.latest) {
          const snapshot = this.latest;
          this.latest = null;
          await this.write(snapshot.state);
          this.persistedVersion = snapshot.version;
          this.failure = null;
          this.waiters = this.waiters.filter(waiter => {
            if (waiter.version > this.persistedVersion) return true;
            waiter.resolve();
            return false;
          });
        }
      } catch (error) {
        this.failure = { error };
        for (const waiter of this.waiters.splice(0)) waiter.reject(error);
        throw error;
      }
    };
    this.running = run().finally(() => {
      this.running = null;
      // A read waiter may request another snapshot before this finalizer runs.
      this.schedule();
    });
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
  const calendarResponses = new Map((recovered.calendarResponses ?? []).map(record => [record.command.commandId, record]));
  for (const record of current.calendarResponses ?? []) calendarResponses.set(record.command.commandId, record);
  const accounts = new Map(recovered.accounts.map(account => [account.accountId, account]));
  for (const account of current.accounts) accounts.set(account.accountId, account);
  return { ...current, accounts: [...accounts.values()], commands: [...commands.values()],
    calendarResponses: [...calendarResponses.values()].slice(-500),
    pendingThreadIntents: [...intents.values()], outbox: [...outbox.values()], undo: current.undo ?? recovered.undo };
}
