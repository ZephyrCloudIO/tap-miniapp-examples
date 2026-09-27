import type { MailboxChanges, MailboxPage } from './coordinator-client';
import { emailThreadKey, mergeMailboxPage, mergeMailboxSnapshot, type MailState } from './domain';
import type { MailboxSyncCheckpoint } from './bounded-mail-replica';
import type { LocalMailStore } from './local-store';

interface Source {
  getMailboxPage(cursor?: string | null): Promise<MailboxPage>;
  getMailboxChanges(afterRevision: number): Promise<MailboxChanges>;
}

/** Production sync keeps only cursors and one page; all identity guards live in SQLite. */
export class DurableMailboxSync {
  private active = true;
  private bootstrap: string | undefined = crypto.randomUUID();
  private changeRevision = 0;
  private changesInFlight: Promise<void> | null = null;

  constructor(private readonly source: Source, private readonly store: LocalMailStore,
    private readonly update: (apply: (state: MailState) => MailState) => void,
    private readonly committed: () => void, private readonly connected: () => void) {}

  dispose(): void { this.active = false; }

  async applyPage(page: MailboxPage, changes?: MailboxChanges, checkpoint?: MailboxSyncCheckpoint) {
    if (!this.active) return;
    this.connected();
    let applied;
    try {
      applied = await this.store.commitMailboxUpdate!(page, { changes, bootstrap: changes ? this.bootstrap : undefined, checkpoint });
    } catch (error) {
      // Keep the live first page usable if device storage fails. Traversal and its
      // cursor stop here; journal durability still independently controls dispatch.
      if (this.active && !changes) this.update(state => mergeMailboxPage(state, page.mailbox));
      throw error;
    }
    if (!this.active) return;
    const deleted = new Set(applied.deleted.map(emailThreadKey));
    this.update(state => {
      const merged = mergeMailboxPage(state, applied.mailbox);
      return mergeMailboxSnapshot(merged, { ...applied.mailbox,
        threads: merged.threads.filter(thread => !deleted.has(emailThreadKey(thread))) });
    });
    this.committed();
    return applied.checkpoint;
  }

  async refreshHead(): Promise<MailboxPage> {
    const page = await this.source.getMailboxPage();
    await this.applyPage(page);
    return page;
  }

  async loadHistory(head: MailboxPage): Promise<void> {
    let checkpoint = await this.store.beginMailboxSync!();
    if (!this.active) return;
    if (checkpoint.pagesLoaded === 0) {
      checkpoint = (await this.applyPage(head, undefined, checkpoint)) ?? checkpoint;
    }
    const seen = new Set<string>();
    while (this.active && !checkpoint.complete) {
      const cursor = checkpoint.nextCursor;
      if (cursor === null || seen.has(cursor)) throw new Error('Mailbox pagination did not advance.');
      seen.add(cursor);
      if (seen.size > 32) seen.delete(seen.values().next().value!);
      const page = await this.source.getMailboxPage(cursor);
      if (!this.active) return;
      checkpoint = (await this.applyPage(page, undefined, checkpoint)) ?? checkpoint;
    }
  }

  reconcile(): Promise<void> {
    if (this.changesInFlight) return this.changesInFlight;
    const run = async () => {
      while (this.active) {
        const page = await this.source.getMailboxChanges(this.changeRevision);
        if (!this.active) return;
        if (page.hasMore && page.nextRevision <= this.changeRevision) throw new Error('Mailbox changes did not advance.');
        await this.applyPage(page, page);
        if (!this.active) return;
        // A failed page never advances this cursor. Restart safely replays from zero.
        this.changeRevision = page.nextRevision;
        if (!page.hasMore) { this.bootstrap = undefined; return; }
      }
    };
    const pending = run().finally(() => { this.changesInFlight = null; });
    this.changesInFlight = pending;
    return pending;
  }
}
