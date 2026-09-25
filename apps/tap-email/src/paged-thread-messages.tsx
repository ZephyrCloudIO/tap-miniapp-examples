import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  CoordinatorError,
  mergeConversationPage,
  type createCoordinatorClient,
  type ThreadPage,
} from './coordinator-client';
import { memoryBodyBudgetBytes } from './bounded-mail-replica';
import { serializedBytes } from './bounded-sql';
import type { EmailMessage } from './domain';
import { ThreadMessageList, type ThreadMessageListProps } from './thread-messages';

interface Props extends ThreadMessageListProps {
  readonly client: Pick<ReturnType<typeof createCoordinatorClient>, 'getThreadPage'> | null;
  readonly providerRevision: string;
  readonly onMessages: (accountId: string, threadId: string, messages: readonly EmailMessage[], expectedRevision: string) => void;
}

export function PagedThreadMessages({ client, providerRevision, onMessages, ...props }: Props) {
  const { accountId, threadId } = props;
  const [page, setPage] = useState<ThreadPage | null>(null);
  const [windowed, setWindowed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const session = useRef({ active: true, busy: false, cursor: null as string | null,
    revision: null as string | null, messages: [] as readonly EmailMessage[], seen: new Set<string>() });

  const load = useCallback(async () => {
    const request = session.current;
    if (!client || request.busy || !request.active) return;
    request.busy = true;
    setLoading(true);
    setError(null);
    try {
      const result = await client.getThreadPage(accountId, threadId, request.cursor);
      if (!request.active) return;
      if ((request.revision !== null && request.revision !== result.providerRevision) ||
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
        setWindowed(true);
      }
      request.messages = messages;
      request.revision = result.providerRevision;
      request.cursor = result.nextCursor;
      if (result.nextCursor !== null) request.seen.add(result.nextCursor);
      if (request.seen.size > 32) request.seen.delete(request.seen.values().next().value!);
      setPage(result);
      onMessages(accountId, threadId, messages, providerRevision);
    } catch (failure) {
      if (!request.active) return;
      if (failure instanceof CoordinatorError && failure.code === 'thread_changed') {
        request.cursor = null;
        request.revision = null;
        request.messages = [];
        request.seen.clear();
      }
      setError(failure instanceof Error ? failure.message : 'The message bodies could not be loaded.');
    } finally {
      request.busy = false;
      if (request.active) setLoading(false);
    }
  }, [accountId, client, onMessages, providerRevision, threadId]);

  useEffect(() => {
    session.current = { active: true, busy: false, cursor: null, revision: null, messages: [], seen: new Set() };
    const request = session.current;
    setPage(null);
    setWindowed(false);
    setError(null);
    setLoading(false);
    void load();
    return () => { request.active = false; };
  }, [load, providerRevision]);

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
        session.current.seen.clear();
        setWindowed(false);
        void load();
      }}>Load newest messages</button> : null}
      {page?.complete ? <p role="status">{windowed ? 'End of conversation' : 'All conversation messages loaded'}</p> : null}
    </div>
    <ThreadMessageList {...props} />
  </>;
}
