import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useCreateStore, useSelector } from '@tanstack/react-store';
import { ConversationQueryCache } from './conversation-query-cache';
import {
  CoordinatorError,
  mergeConversationPage,
  type createCoordinatorClient,
  type ThreadPage,
} from './coordinator-client';
import { memoryBodyBudgetBytes } from './bounded-mail-replica';
import { serializedBytes } from './bounded-sql';
import { isDownloadedThreadPage, type DownloadedThreadPage, type EmailMessage, type EmailThread } from './domain';
import { ThreadMessageList, type ThreadMessageListProps } from './thread-messages';

interface Props extends ThreadMessageListProps {
  readonly client: Pick<ReturnType<typeof createCoordinatorClient>, 'getThreadPage'> | null;
  readonly providerRevision: string;
  readonly downloadedPage?: DownloadedThreadPage;
  readonly cache?: ConversationQueryCache;
  readonly loadCachedThread?: (accountId: string, threadId: string, signal: AbortSignal) => Promise<EmailThread | null>;
  readonly onMessages: (accountId: string, threadId: string, messages: readonly EmailMessage[], expectedRevision: string, downloadedPage?: DownloadedThreadPage) => void;
}

export function PagedThreadMessages({ client, providerRevision, downloadedPage, loadCachedThread, cache, onMessages, ...props }: Props) {
  // The parent owns these bodies and their download marker. A preview's message
  // IDs alone never establish that its bodies or remaining pages are downloaded.
  const resident = useRef({ messages: props.messages, downloadedPage });
  const callbacks = useRef({ onMessages, loadCachedThread });
  useEffect(() => {
    resident.current = { messages: props.messages, downloadedPage };
    callbacks.current = { onMessages, loadCachedThread };
  }, [props.messages, downloadedPage, onMessages, loadCachedThread]);
  const { accountId, threadId } = props;
  const [initial] = useState(() => {
    const cached = cache?.get(accountId, threadId, providerRevision) ?? resident.current;
    const marker = cached.downloadedPage;
    return isDownloadedThreadPage(marker) && marker.providerRevision === providerRevision ? {
      page: { messages: cached.messages, providerRevision, nextCursor: marker.nextCursor, complete: marker.complete },
      windowed: marker.windowed,
    } : { page: null as ThreadPage | null, windowed: false };
  });
  const activeRef = useRef(props.active !== false);
  useLayoutEffect(() => { activeRef.current = props.active !== false; }, [props.active]);
  const reader = useCreateStore({ ...initial,
    loading: false, error: null as string | null });
  const { page, windowed, loading, error } = useSelector(reader);
  const updateReader = useCallback((patch: Partial<typeof reader.state>) => {
    reader.setState(current => Object.entries(patch).every(([key, value]) =>
      current[key as keyof typeof current] === value) ? current : { ...current, ...patch });
  }, [reader]);
  const session = useRef({ active: true, busy: false, cursor: null as string | null,
    revision: null as string | null, windowed: false, messages: [] as readonly EmailMessage[], seen: new Set<string>() });

  const load = useCallback(async () => {
    const request = session.current;
    if (!client || request.busy || !request.active) return;
    request.busy = true;
    const cursor = request.cursor;
    updateReader({ loading: true, error: null });
    try {
      const result = cache
        ? await cache.page(accountId, threadId, providerRevision, cursor,
          () => client.getThreadPage(accountId, threadId, cursor))
        : await client.getThreadPage(accountId, threadId, cursor);
      if (!request.active) return;
      if (providerRevision !== result.providerRevision ||
          (request.revision !== null && request.revision !== result.providerRevision) ||
          (result.nextCursor !== null && request.seen.has(result.nextCursor))) {
        throw new CoordinatorError(409, 'thread_changed', 'The conversation changed. Retry to load its latest messages.');
      }
      let messages = mergeConversationPage(request.messages, result.messages);
      if (request.cursor !== null && messages.length === request.messages.length) {
        throw new Error('Conversation pagination did not advance. Retry loading messages.');
      }
      if (serializedBytes(messages) > memoryBodyBudgetBytes) {
        // Keep the requested page readable without accumulating all conversation bodies.
        messages = result.messages;
        request.windowed = true;
      }
      request.messages = messages;
      request.revision = result.providerRevision;
      request.cursor = result.nextCursor;
      if (result.nextCursor !== null) request.seen.add(result.nextCursor);
      if (request.seen.size > 32) request.seen.delete(request.seen.values().next().value!);
      const marker: DownloadedThreadPage = { providerRevision: result.providerRevision,
        nextCursor: result.nextCursor, complete: result.complete, windowed: request.windowed,
        seenCursors: [...request.seen] };
      cache?.remember(accountId, threadId, { messages, downloadedPage: marker });
      updateReader({ page: { ...result, messages }, windowed: request.windowed });
      if (activeRef.current) callbacks.current.onMessages(accountId, threadId, messages, providerRevision, marker);
    } catch (failure) {
      if (!request.active) return;
      // Validation also depends on the accumulated reader state. A successful
      // transport result can still be unusable and must not poison retries.
      cache?.discardPage(accountId, threadId, providerRevision, cursor);
      if (failure instanceof CoordinatorError && failure.code === 'thread_changed') {
        cache?.discardRevision(accountId, threadId, providerRevision);
        request.cursor = null;
        request.revision = null;
        request.messages = [];
        request.windowed = false;
        request.seen.clear();
      }
      updateReader({ error: failure instanceof Error ? failure.message : 'The message bodies could not be loaded.' });
    } finally {
      request.busy = false;
      if (request.active) updateReader({ loading: false });
    }
  }, [accountId, cache, client, providerRevision, updateReader, threadId]);

  useEffect(() => {
    session.current = { active: true, busy: false, cursor: null, revision: null, windowed: false, messages: [], seen: new Set() };
    const request = session.current;
    updateReader({ page: null, windowed: false, error: null, loading: false });
    const abort = new AbortController();
    cache?.retainRevision(accountId, threadId, providerRevision);
    const restore = (cached: { messages: readonly EmailMessage[]; downloadedPage?: DownloadedThreadPage }, publish = true) => {
      const marker = cached.downloadedPage;
      if (!isDownloadedThreadPage(marker) || marker.providerRevision !== providerRevision) return false;
      cache?.remember(accountId, threadId, { messages: cached.messages, downloadedPage: marker });
      request.messages = cached.messages;
      request.revision = marker.providerRevision;
      request.cursor = marker.nextCursor;
      request.windowed = marker.windowed;
      request.seen = new Set(marker.seenCursors);
      updateReader({ page: { messages: cached.messages, providerRevision, nextCursor: marker.nextCursor, complete: marker.complete }, windowed: marker.windowed });
      if (publish && activeRef.current) callbacks.current.onMessages(accountId, threadId, cached.messages, providerRevision, marker);
      return true;
    };
    const snapshot = cache?.snapshot(accountId, threadId, providerRevision);
    const queried = snapshot ?? cache?.get(accountId, threadId, providerRevision);
    // An accumulated snapshot can be ahead of the parent's persisted projection.
    // A raw first-page query must never displace an accumulated resident page.
    if (!(snapshot && restore(snapshot)) && !restore(resident.current, false) && !(queried && restore(queried))) {
      const open = async () => {
        const readDisk = callbacks.current.loadCachedThread;
        if (readDisk) {
          updateReader({ loading: true });
          try {
            const cached = cache
              ? await cache.localThread(accountId, threadId, providerRevision, signal => readDisk(accountId, threadId, signal))
              : await readDisk(accountId, threadId, abort.signal);
            if (!request.active) return;
            if (cached?.accountId === accountId && cached.threadId === threadId &&
                cached.providerRevision === providerRevision) {
              if (restore(cached)) {
                updateReader({ loading: false });
                return;
              }
              // Old cache records are still useful offline, but cannot prove
              // which pages were downloaded, so an online open refreshes them.
              updateReader({ page: { messages: cached.messages, providerRevision, nextCursor: null, complete: false } });
              if (activeRef.current) callbacks.current.onMessages(accountId, threadId, cached.messages, providerRevision);
            }
          } catch { /* A cache read failure falls back to the coordinator. */ }
          if (!request.active) return;
          updateReader({ loading: false });
        }
        await load();
      };
      void open();
    }
    return () => { request.active = false; abort.abort(); };
  }, [accountId, cache, load, providerRevision, updateReader, threadId]);

  const wasActive = useRef(props.active !== false);
  useEffect(() => {
    const activated = !wasActive.current && props.active !== false;
    wasActive.current = props.active !== false;
    // Prefetching does not write React/mailbox state. Opening a warmed reader
    // publishes its verified snapshot once so normal SDK persistence saves it.
    const snapshot = activated ? cache?.snapshot(accountId, threadId, providerRevision) : undefined;
    if (snapshot) callbacks.current.onMessages(accountId, threadId, snapshot.messages, providerRevision, snapshot.downloadedPage);
  }, [props.active, accountId, threadId, providerRevision, cache]);

  return <>
    <div className="thread-page-controls" aria-busy={loading}>
      {loading ? <p role="status">Loading conversation messages…</p> : null}
      {error ? <div role="alert">
        <p>Could not load conversation messages: {error}</p>
        <button type="button" disabled={loading} onClick={() => void load()}>Retry loading messages</button>
      </div> : null}
      {page?.nextCursor && !error ? <button type="button" disabled={loading} onClick={() => void load()}>
        Load older messages
      </button> : null}
      {windowed ? <button type="button" disabled={loading} onClick={() => {
        session.current.cursor = null;
        session.current.revision = null;
        session.current.messages = [];
        session.current.windowed = false;
        session.current.seen.clear();
        updateReader({ windowed: false });
        void load();
      }}>Load newest messages</button> : null}
      {page?.complete ? <p className="thread-page-complete" role="status">{windowed ? 'End of conversation' : 'All conversation messages loaded'}</p> : null}
    </div>
    <ThreadMessageList {...props} providerRevision={providerRevision} messages={page?.messages ?? props.messages} />
  </>;
}
