import { ConversationQueryCache } from './conversation-query-cache';
import { isDownloadedThreadPage, type EmailThread } from './domain';
import { mergeConversationPage, type createCoordinatorClient } from './coordinator-client';
import { memoryBodyBudgetBytes } from './bounded-mail-replica';
import { serializedBytes } from './bounded-sql';

export function conversationEntryReady(cache: ConversationQueryCache, thread: EmailThread): boolean {
  return thread.unread && thread.firstUnreadMessageId
    ? cache.hasEntry(thread.accountId, thread.threadId, thread.providerRevision, thread.firstUnreadMessageId)
    : cache.has(thread.accountId, thread.threadId, thread.providerRevision);
}

/** Neighbors use the same query owner as the foreground reader; no second body hook. */
export async function prepareConversation(cache: ConversationQueryCache, thread: EmailThread,
  read: (accountId: string, threadId: string, signal: AbortSignal) => Promise<EmailThread | null>,
  client: Pick<ReturnType<typeof createCoordinatorClient>, 'getThreadPage'> | null,
  signal: AbortSignal,
): Promise<boolean> {
  const { accountId, threadId, providerRevision } = thread;
  let local = cache.get(accountId, threadId, providerRevision);
  if (!local && isDownloadedThreadPage(thread.downloadedPage) && thread.downloadedPage.providerRevision === providerRevision) {
    cache.remember(accountId, threadId, { messages: thread.messages, downloadedPage: thread.downloadedPage });
    local = cache.get(accountId, threadId, providerRevision);
  }
  if (!local) {
    const disk = await cache.localThread(accountId, threadId, providerRevision,
      abort => read(accountId, threadId, abort)).catch(() => null);
    if (signal.aborted) return false;
    if (disk?.accountId === accountId && disk.threadId === threadId && disk.providerRevision === providerRevision &&
        isDownloadedThreadPage(disk.downloadedPage) && disk.downloadedPage.providerRevision === providerRevision) {
      cache.remember(accountId, threadId, { messages: disk.messages, downloadedPage: disk.downloadedPage });
      local = cache.get(accountId, threadId, providerRevision);
    }
  }
  if (conversationEntryReady(cache, thread)) return true;
  if (!client) return Boolean(local);
  let messages = local?.messages ?? [];
  let cursor = local?.downloadedPage?.nextCursor ?? null;
  let windowed = local?.downloadedPage?.windowed ?? false;
  const seen = new Set(local?.downloadedPage?.seenCursors ?? []);
  for (let count = 0; count < 32; count++) {
    const requestedCursor = cursor;
    const page = await cache.page(accountId, threadId, providerRevision, requestedCursor,
      () => client.getThreadPage(accountId, threadId, requestedCursor));
    if (signal.aborted) return false;
    const merged = mergeConversationPage(messages, page.messages);
    if (page.providerRevision !== providerRevision || page.nextCursor !== null && seen.has(page.nextCursor) ||
        cursor !== null && merged.length === messages.length) {
      cache.discardPage(accountId, threadId, providerRevision, cursor);
      throw new Error('Conversation warming did not advance within its revision.');
    }
    messages = merged;
    if (serializedBytes(messages) > memoryBodyBudgetBytes) { messages = page.messages; windowed = true; }
    cursor = page.nextCursor;
    if (cursor) seen.add(cursor);
    if (seen.size > 32) seen.delete(seen.values().next().value!);
    cache.remember(accountId, threadId, { messages, downloadedPage: {
      providerRevision, nextCursor: cursor, complete: page.complete, windowed, seenCursors: [...seen],
    } });
    if (!thread.unread || !thread.firstUnreadMessageId || messages.some(message => message.messageId === thread.firstUnreadMessageId) || page.complete) return true;
  }
  return false;
}
