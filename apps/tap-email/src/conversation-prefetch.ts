import { ConversationQueryCache } from './conversation-query-cache';
import { isDownloadedThreadPage, type EmailThread } from './domain';
import type { createCoordinatorClient } from './coordinator-client';

/** Neighbors use the same query owner as the foreground reader; no second body hook. */
export async function prepareConversation(cache: ConversationQueryCache, thread: EmailThread,
  read: (accountId: string, threadId: string, signal: AbortSignal) => Promise<EmailThread | null>,
  client: Pick<ReturnType<typeof createCoordinatorClient>, 'getThreadPage'> | null,
  signal: AbortSignal,
): Promise<boolean> {
  const { accountId, threadId, providerRevision } = thread;
  if (cache.get(accountId, threadId, providerRevision)) return true;
  if (isDownloadedThreadPage(thread.downloadedPage) && thread.downloadedPage.providerRevision === providerRevision) {
    cache.remember(accountId, threadId, { messages: thread.messages, downloadedPage: thread.downloadedPage });
    return true;
  }
  const local = await cache.localThread(accountId, threadId, providerRevision,
    abort => read(accountId, threadId, abort)).catch(() => null);
  if (signal.aborted) return false;
  if (local?.accountId === accountId && local.threadId === threadId && local.providerRevision === providerRevision &&
      isDownloadedThreadPage(local.downloadedPage) && local.downloadedPage.providerRevision === providerRevision) return true;
  if (!client) return false;
  const page = await cache.page(accountId, threadId, providerRevision, null,
    () => client.getThreadPage(accountId, threadId));
  if (signal.aborted) return false;
  cache.remember(accountId, threadId, { messages: page.messages, downloadedPage: {
    providerRevision, nextCursor: page.nextCursor, complete: page.complete, windowed: false,
    seenCursors: page.nextCursor ? [page.nextCursor] : [],
  } });
  return true;
}
