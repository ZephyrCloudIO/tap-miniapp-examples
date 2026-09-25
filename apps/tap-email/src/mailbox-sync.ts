import { CoordinatorError, type MailboxChanges, type MailboxPage } from './coordinator-client';
import { emailThreadKey, mergeMailboxPage, mergeMailboxSnapshot, type MailState } from './domain';
import type { LocalMailStore, MailboxPageProgress } from './local-store';

type StateUpdate = (state: MailState) => MailState;
interface MailboxSource {
  getMailboxPage(cursor?: string | null): Promise<MailboxPage>;
  getMailboxChanges(afterRevision: number): Promise<MailboxChanges>;
}

/** One lifecycle per mounted mailbox. Network lanes share revision guards, not locks. */
export class MailboxSync {
  private readonly versions = new Map<string, number>();
  private readonly bootstrapMembers = new Set<string>();
  private bootstrapComplete = false;
  private completeRevision = -1;
  private accountRevision = -1;
  private changeRevision = 0;
  private changesInFlight: Promise<void> | null = null;
  private active = true;

  constructor(
    private readonly source: MailboxSource,
    private readonly update: (update: StateUpdate) => void,
  ) {}

  dispose(): void { this.active = false; }

  applyPage(page: MailboxPage, changes?: MailboxChanges): void {
    if (!this.active) return;
    const revision = page.revision;
    if (revision === undefined) {
      throw new CoordinatorError(502, 'mailbox_upgrade_required', 'The coordinator must support revisioned mailbox synchronization.');
    }
    const accept = (key: string) => revision >= Math.max(
      this.versions.get(key) ?? this.completeRevision + 1, this.completeRevision,
    );
    const threads = page.mailbox.threads.filter(thread => accept(emailThreadKey(thread)));
    const deleted = new Set(changes?.deletedThreads.map(emailThreadKey).filter(accept));
    for (const thread of threads) this.versions.set(emailThreadKey(thread), revision);
    for (const key of deleted) this.versions.set(key, revision);
    const accounts = revision >= this.accountRevision ? page.mailbox.accounts : null;
    this.accountRevision = Math.max(this.accountRevision, revision);

    let members: ReadonlySet<string> | null = null;
    let newer: ReadonlySet<string> = new Set();
    if (changes && !this.bootstrapComplete) {
      for (const thread of changes.mailbox.threads) this.bootstrapMembers.add(emailThreadKey(thread));
      for (const thread of changes.deletedThreads) this.bootstrapMembers.delete(emailThreadKey(thread));
      if (!changes.hasMore) {
        // Revision ordering visits every identity as of this final watermark,
        // including identities that moved forward while we traversed the stream.
        this.bootstrapComplete = true;
        this.completeRevision = revision;
        members = new Set(this.bootstrapMembers);
        newer = new Set([...this.versions].filter(([, seen]) => seen > revision).map(([key]) => key));
        this.bootstrapMembers.clear();
      }
    }
    // Capture immutable inputs outside React's updater (which may run twice).
    this.update(state => {
      const merged = mergeMailboxPage(state, { ...page.mailbox, accounts: accounts ?? state.accounts, threads });
      const retained = merged.threads.filter(thread => {
        const key = emailThreadKey(thread);
        return !deleted.has(key) && (!members || members.has(key) || newer.has(key));
      });
      return mergeMailboxSnapshot(merged, {
        schemaVersion: 1, accounts: accounts ?? merged.accounts, threads: retained,
      });
    });
  }

  async refreshHead(): Promise<MailboxPage> {
    const page = await this.source.getMailboxPage();
    this.applyPage(page);
    return page;
  }

  async loadHistory(cursor: string | null, onPage: (progress: MailboxPageProgress | null) => void): Promise<void> {
    const seen = new Set<string>();
    let pagesLoaded = 0;
    let threadsLoaded = 0;
    while (this.active && cursor !== null) {
      if (seen.has(cursor)) throw new Error('Mailbox pagination did not advance.');
      seen.add(cursor);
      const page = await this.source.getMailboxPage(cursor);
      if (!this.active) return;
      this.applyPage(page);
      pagesLoaded += 1;
      threadsLoaded += page.mailbox.threads.length;
      cursor = page.nextCursor;
      onPage(cursor ? { nextCursor: cursor, pagesLoaded, threadsLoaded, updatedAt: new Date().toISOString() } : null);
    }
  }

  reconcile(): Promise<void> {
    if (this.changesInFlight) return this.changesInFlight;
    const run = async () => {
      while (this.active) {
        const page = await this.source.getMailboxChanges(this.changeRevision);
        if (!this.active) return;
        this.applyPage(page, page);
        // This cursor is intentionally session-only. Restart replays from zero,
        // so no durable cursor can get ahead of the persisted mailbox rows.
        this.changeRevision = page.nextRevision;
        if (!page.hasMore) return;
      }
    };
    const request = run().finally(() => { this.changesInFlight = null; });
    this.changesInFlight = request;
    return request;
  }
}

/** Serialize row saves and their captured historical cursors as one ordered job. */
export class MailboxCheckpointWriter {
  private pending: Promise<void> = Promise.resolve();

  save(
    store: Pick<LocalMailStore, 'save' | 'clearMailboxPageProgress' | 'saveMailboxPageProgress'>,
    state: MailState,
    progress: MailboxPageProgress | null | undefined,
    onStateSaved?: () => void,
  ): Promise<void> {
    const save = this.pending.then(async () => {
      await store.save(state);
      // A later cursor-write failure must not roll back a durable command.
      onStateSaved?.();
      if (progress === null) await store.clearMailboxPageProgress();
      else if (progress !== undefined) await store.saveMailboxPageProgress(progress);
    });
    this.pending = save.catch(() => undefined);
    return save;
  }
}
