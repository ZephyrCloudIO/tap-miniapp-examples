import { startTransition, useEffect, useRef, useState } from 'react';
import type { createCoordinatorClient } from './coordinator-client';
import { ConversationQueryCache } from './conversation-query-cache';
import { conversationEntryReady, prepareConversation } from './conversation-prefetch';
import { ConversationWarmWindow } from './conversation-warm-window';
import { isDownloadedThreadPage, type EmailThread } from './domain';

export function useConversationWarmWindow({ cache, rows, activeKey, enabled, preview, read, client }: {
  readonly cache: ConversationQueryCache;
  readonly rows: readonly EmailThread[];
  readonly activeKey: string;
  readonly enabled: boolean;
  readonly preview: boolean;
  readonly read: (accountId: string, threadId: string, signal: AbortSignal) => Promise<EmailThread | null>;
  readonly client: Pick<ReturnType<typeof createCoordinatorClient>, 'getThreadPage'> | null;
}) {
  const [keys, setKeys] = useState<readonly string[]>([]);
  const scheduler = useRef<ConversationWarmWindow | null>(null);
  useEffect(() => {
    if (!enabled) { setKeys(previous => previous.length ? [] : previous); return; }
    const warmer = new ConversationWarmWindow(
      thread => conversationEntryReady(cache, thread),
      (thread, signal) => {
        const candidate = preview && !isDownloadedThreadPage(thread.downloadedPage) ? { ...thread, downloadedPage: {
          providerRevision: thread.providerRevision, nextCursor: null, complete: true, windowed: false, seenCursors: [],
        } } : thread;
        return prepareConversation(cache, candidate, read, client, signal);
      },
      next => startTransition(() => setKeys(previous => next.length === previous.length &&
        next.every((key, index) => key === previous[index]) ? previous : next)),
      2,
      // Queue all local restores together. A real SDK store serializes bridge
      // calls, so twenty separate multi-call reads cannot keep up with navigation.
      preview ? undefined : threads => Promise.allSettled(threads.filter(thread =>
        !isDownloadedThreadPage(thread.downloadedPage) || thread.downloadedPage.providerRevision !== thread.providerRevision)
        .map(thread => cache.localThread(thread.accountId, thread.threadId, thread.providerRevision,
          signal => read(thread.accountId, thread.threadId, signal)))),
    );
    scheduler.current = warmer;
    return () => { warmer.dispose(); scheduler.current = null; };
  }, [cache, enabled, preview, read, client]);
  useEffect(() => { scheduler.current?.update(rows, activeKey); },
    [rows, activeKey, cache, enabled, preview, read, client]);
  return keys;
}
