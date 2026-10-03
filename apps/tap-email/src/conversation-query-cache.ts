import { QueryClient, type Query } from '@tanstack/react-query';
import { memoryBodyBudgetBytes } from './bounded-mail-replica';
import { serializedBytes } from './bounded-sql';
import { CoordinatorError, type ThreadPage } from './coordinator-client';
import { isDownloadedThreadPage, type DownloadedThreadPage, type EmailMessage, type EmailThread } from './domain';

export interface CachedConversation {
  readonly messages: readonly EmailMessage[];
  readonly downloadedPage: DownloadedThreadPage;
}
const prefix = (accountId: string, threadId: string, revision: string) =>
  ['email-reader', accountId, threadId, revision] as const;

/** One instance per miniapp scope. Query owns completed pages and pending reads. */
export class ConversationQueryCache {
  readonly client = new QueryClient({ defaultOptions: { queries: {
    staleTime: Infinity, gcTime: 5 * 60_000, retry: false,
    refetchOnMount: false, refetchOnWindowFocus: false, refetchOnReconnect: false,
    structuralSharing: false,
  } } });

  private readonly completed = new Map<string, { query: Query; data: unknown; bytes: number }>();
  private completedBytes = 0;

  constructor(private readonly budgetBytes = memoryBodyBudgetBytes) {
    this.client.getQueryCache().subscribe(event => {
      const query = event.query;
      const previous = this.completed.get(query.queryHash);
      if (event.type === 'removed' || query.state.data === undefined) {
        if (previous) { this.completedBytes -= previous.bytes; this.completed.delete(query.queryHash); }
        return;
      }
      // The disk query is a temporary transport result. Its verified bodies go
      // into the snapshot; counting both would charge the same read twice.
      if (query.queryKey[4] === 'disk' || previous?.data === query.state.data) return;
      const bytes = serializedBytes(query.state.data);
      this.completedBytes += bytes - (previous?.bytes ?? 0);
      this.completed.delete(query.queryHash);
      this.completed.set(query.queryHash, { query, data: query.state.data, bytes });
    });
  }

  private touch(key: readonly unknown[]): void {
    const query = this.client.getQueryCache().find({ queryKey: key, exact: true });
    const entry = query && this.completed.get(query.queryHash);
    if (query && entry) {
      this.completed.delete(query.queryHash);
      this.completed.set(query.queryHash, entry);
    }
  }

  snapshot(accountId: string, threadId: string, revision: string): CachedConversation | undefined {
    const key = [...prefix(accountId, threadId, revision), 'snapshot'];
    this.touch(key);
    return this.client.getQueryData<CachedConversation>(key);
  }

  /** Planning background work must not make distant neighbors newer than the reader. */
  has(accountId: string, threadId: string, revision: string): boolean {
    const key = prefix(accountId, threadId, revision);
    return this.client.getQueryData([...key, 'snapshot']) !== undefined ||
      this.client.getQueryData([...key, 'page', null]) !== undefined;
  }

  /** Check unread entry coverage without promoting background neighbors in LRU order. */
  hasEntry(accountId: string, threadId: string, revision: string, messageId: string): boolean {
    const key = prefix(accountId, threadId, revision);
    const snapshot = this.client.getQueryData<CachedConversation>([...key, 'snapshot']);
    const page = this.client.getQueryData<ThreadPage>([...key, 'page', null]);
    const cached = snapshot ?? (page ? { messages: page.messages, downloadedPage: { complete: page.complete } } : undefined);
    return Boolean(cached && (cached.downloadedPage.complete || cached.messages.some(message => message.messageId === messageId)));
  }

  get(accountId: string, threadId: string, revision: string): CachedConversation | undefined {
    const key = prefix(accountId, threadId, revision);
    const snapshot = this.snapshot(accountId, threadId, revision);
    if (snapshot) return snapshot;
    // A superseded reader can still finish a useful first-page download.
    const pageKey = [...key, 'page', null];
    this.touch(pageKey);
    const page = this.client.getQueryData<ThreadPage>(pageKey);
    if (!page) return undefined;
    return { messages: page.messages, downloadedPage: { providerRevision: page.providerRevision,
      nextCursor: page.nextCursor, complete: page.complete, windowed: false,
      seenCursors: page.nextCursor ? [page.nextCursor] : [] } };
  }

  remember(accountId: string, threadId: string, value: CachedConversation): void {
    if (!isDownloadedThreadPage(value.downloadedPage)) return;
    const key = [...prefix(accountId, threadId, value.downloadedPage.providerRevision), 'snapshot'];
    const previous = this.client.getQueryData<CachedConversation>(key);
    if (previous?.messages === value.messages && previous.downloadedPage === value.downloadedPage) return;
    this.client.setQueryData(key, value);
    this.prune();
  }

  async page(accountId: string, threadId: string, revision: string, cursor: string | null,
    fetch: () => Promise<ThreadPage>): Promise<ThreadPage> {
    const page = await this.client.fetchQuery({
      queryKey: [...prefix(accountId, threadId, revision), 'page', cursor],
      queryFn: async () => {
        const result = await fetch();
        if (result.providerRevision !== revision) {
          throw new CoordinatorError(409, 'thread_changed', 'The conversation changed. Retry to load its latest messages.');
        }
        return result;
      },
    });
    this.touch([...prefix(accountId, threadId, revision), 'page', cursor]);
    this.prune();
    return page;
  }

  /** Share pending disk I/O without retaining a second durable-body snapshot. */
  localThread(accountId: string, threadId: string, revision: string,
    read: (signal: AbortSignal) => Promise<EmailThread | null>): Promise<EmailThread | null> {
    return this.client.fetchQuery({
      queryKey: [...prefix(accountId, threadId, revision), 'disk'],
      staleTime: 0, gcTime: 0, networkMode: 'always',
      queryFn: async ({ signal }) => {
        const thread = await read(signal);
        if (!signal.aborted && thread?.accountId === accountId && thread.threadId === threadId &&
            thread.providerRevision === revision && isDownloadedThreadPage(thread.downloadedPage) &&
            thread.downloadedPage.providerRevision === revision && !this.snapshot(accountId, threadId, revision)) {
          // Preserve useful completed disk work even if its original reader left.
          this.remember(accountId, threadId, { messages: thread.messages, downloadedPage: thread.downloadedPage });
        }
        return thread;
      },
    });
  }

  retainRevision(accountId: string, threadId: string, revision: string): void {
    this.client.removeQueries({ predicate: query => query.queryKey[1] === accountId &&
      query.queryKey[2] === threadId && query.queryKey[3] !== revision });
  }

  discardPage(accountId: string, threadId: string, revision: string, cursor: string | null): void {
    this.client.removeQueries({ queryKey: [...prefix(accountId, threadId, revision), 'page', cursor], exact: true });
  }

  discardRevision(accountId: string, threadId: string, revision: string): void {
    this.client.removeQueries({ queryKey: prefix(accountId, threadId, revision) });
  }

  retainAccounts(accounts: ReadonlySet<string>): void {
    this.client.removeQueries({ predicate: query => !accounts.has(String(query.queryKey[1])) });
  }

  clear(): void { this.client.clear(); }

  prune(): void {
    for (const { query } of this.completed.values()) {
      if (this.completedBytes <= this.budgetBytes) break;
      if (query.state.fetchStatus !== 'idle' || query.getObserversCount() > 0) continue;
      // The removal subscription updates the byte ledger, including GC, account
      // removal, and scope disposal. No body serialization on warm navigation.
      this.client.removeQueries({ queryKey: query.queryKey, exact: true });
    }
  }
}
