import { isSafeMailIdentifier } from '@tap-examples/tap-email-protocol';

export type MailboxSyncMode = 'newest' | 'continue' | 'partial';

export interface MailboxSyncRequest {
  readonly profileId: string;
  readonly accountId: string;
  readonly mode: MailboxSyncMode;
  readonly pageToken?: string;
  readonly startHistoryId?: string;
}

export interface SyncQueueMessage extends MailboxSyncRequest {
  readonly kind: 'sync-account';
  readonly eventId: string;
}

interface ProviderEventDispatchRow {
  readonly profile_id: string;
  readonly account_id: string;
  readonly event_id: string;
  readonly payload_json: string;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

function optionalBoundedString(value: unknown, maximum: number): value is string | undefined {
  return value === undefined || (typeof value === 'string' && value.length <= maximum);
}

export function isSyncQueueMessage(value: unknown): value is SyncQueueMessage {
  const candidate = asRecord(value);
  return (
    candidate?.kind === 'sync-account' &&
    isSafeMailIdentifier(candidate.eventId) &&
    isSafeMailIdentifier(candidate.profileId) &&
    isSafeMailIdentifier(candidate.accountId) &&
    (candidate.mode === 'newest' ||
      candidate.mode === 'continue' ||
      candidate.mode === 'partial') &&
    optionalBoundedString(candidate.pageToken, 4_096) &&
    optionalBoundedString(candidate.startHistoryId, 512)
  );
}

function queueMessage(request: MailboxSyncRequest): SyncQueueMessage {
  const message: SyncQueueMessage = {
    kind: 'sync-account',
    eventId: `sync_${crypto.randomUUID()}`,
    ...request,
  };
  if (!isSyncQueueMessage(message)) {
    throw new Error('TAP Email attempted to enqueue an invalid mailbox sync event.');
  }
  return message;
}

async function markDispatched(
  env: Env,
  messages: readonly SyncQueueMessage[],
  now: string,
): Promise<void> {
  if (messages.length === 0) return;
  await env.DB.batch(messages.map(message => env.DB.prepare(
    `UPDATE provider_events SET dispatch_pending = 0, updated_at = ?
      WHERE profile_id = ? AND account_id = ? AND event_id = ?
        AND state IN ('received', 'retryable')`,
  ).bind(now, message.profileId, message.accountId, message.eventId)));
}

async function dispatch(
  env: Env,
  messages: readonly SyncQueueMessage[],
  now: string,
  delaySeconds?: number,
): Promise<void> {
  if (messages.length === 0) return;
  try {
    await env.SYNC_QUEUE.sendBatch(messages.map(message => ({
      body: message,
      contentType: 'json' as const,
      ...(delaySeconds === undefined ? {} : { delaySeconds }),
    })));
    await markDispatched(env, messages, now);
  } catch (error) {
    console.error(JSON.stringify({
      message: 'sync queue dispatch deferred',
      eventCount: messages.length,
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

export async function enqueueSyncEvents(
  env: Env,
  requests: readonly MailboxSyncRequest[],
  now: Date,
  delaySeconds?: number,
): Promise<readonly SyncQueueMessage[]> {
  if (requests.length === 0) return [];
  if (requests.length > 50) {
    throw new Error('TAP Email cannot enqueue more than 50 sync events at once.');
  }
  const createdAt = now.toISOString();
  const messages = requests.map(queueMessage);
  await env.DB.batch(messages.map(message => env.DB.prepare(
    `INSERT INTO provider_events
       (profile_id, account_id, event_id, history_id, state, payload_json,
        dispatch_pending, received_at, updated_at)
     VALUES (?, ?, ?, ?, 'received', ?, 1, ?, ?)`,
  ).bind(
    message.profileId,
    message.accountId,
    message.eventId,
    message.startHistoryId ?? 'bootstrap',
    JSON.stringify(message),
    createdAt,
    createdAt,
  )));
  await dispatch(env, messages, createdAt, delaySeconds);
  return messages;
}

export async function enqueueSyncEvent(
  env: Env,
  request: MailboxSyncRequest,
  now: Date,
  delaySeconds?: number,
): Promise<SyncQueueMessage> {
  const messages = await enqueueSyncEvents(env, [request], now, delaySeconds);
  const message = messages[0];
  if (!message) throw new Error('TAP Email did not create a mailbox sync event.');
  return message;
}

export async function redispatchSyncEvents(env: Env, now: Date): Promise<void> {
  const timestamp = now.toISOString();
  const due = await env.DB.prepare(
    `SELECT profile_id, account_id, event_id, payload_json
       FROM provider_events
      WHERE (
          dispatch_pending = 1
          AND state IN ('received', 'retryable')
          AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
        )
        OR (state = 'processing' AND lease_expires_at <= ?)
      ORDER BY updated_at
      LIMIT 50`,
  )
    .bind(timestamp, timestamp)
    .all<ProviderEventDispatchRow>();
  const messages: SyncQueueMessage[] = [];
  const invalid: ProviderEventDispatchRow[] = [];
  for (const row of due.results) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.payload_json);
    } catch {
      parsed = null;
    }
    if (
      !isSyncQueueMessage(parsed) ||
      parsed.profileId !== row.profile_id ||
      parsed.accountId !== row.account_id ||
      parsed.eventId !== row.event_id
    ) {
      invalid.push(row);
    } else {
      messages.push(parsed);
    }
  }
  if (invalid.length > 0) {
    await env.DB.batch(invalid.map(row => env.DB.prepare(
      `UPDATE provider_events
          SET state = 'dead_letter', dispatch_pending = 0,
              error_code = 'invalid_event_payload', updated_at = ?
        WHERE profile_id = ? AND account_id = ? AND event_id = ?`,
    ).bind(timestamp, row.profile_id, row.account_id, row.event_id)));
  }
  await dispatch(env, messages, timestamp);
}
