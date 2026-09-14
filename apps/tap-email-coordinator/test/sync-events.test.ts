import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { GoogleApiError } from '../src/google';
import { createTapEmailCoordinator } from '../src/index';
import {
  enqueueSyncEvent,
  isSyncQueueMessage,
  redispatchSyncEvents,
  type SyncQueueMessage,
} from '../src/sync-events';

const now = new Date('2026-08-18T15:30:00.000Z');

function fakeMessage(body: SyncQueueMessage) {
  let disposition: 'none' | 'ack' | 'retry' = 'none';
  let delaySeconds = 0;
  const message = {
    id: 'sync_queue_message_1',
    timestamp: now,
    body,
    attempts: 1,
    ack() {
      disposition = 'ack';
    },
    retry(options?: QueueRetryOptions) {
      disposition = 'retry';
      delaySeconds = options?.delaySeconds ?? 0;
    },
  } satisfies Message<SyncQueueMessage>;
  return {
    message,
    result: () => ({ disposition, delaySeconds }),
  };
}

function batch(message: Message<SyncQueueMessage>) {
  return {
    queue: 'tap-email-sync',
    messages: [message],
    metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
    ackAll() {},
    retryAll() {},
  } satisfies MessageBatch<SyncQueueMessage>;
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM coordinator_audit'),
    env.DB.prepare('DELETE FROM provider_events'),
    env.DB.prepare('DELETE FROM google_credentials'),
    env.DB.prepare('DELETE FROM google_accounts'),
    env.DB.prepare(
      `INSERT INTO google_accounts
        (profile_id, account_id, google_subject, connection_state,
         coverage_state, newest_history_id, unresolved_failures,
         email_address, created_at, updated_at)
       VALUES ('profile_sync', 'google_sync', 'subject_sync', 'active',
               'current', 'history_10', 0, 'sync@example.com', ?, ?)`,
    ).bind(now.toISOString(), now.toISOString()),
  ]);
});

describe('durable mailbox sync events', () => {
  it('validates the queue trust boundary', () => {
    expect(isSyncQueueMessage({
      kind: 'sync-account',
      eventId: 'sync_1',
      profileId: 'profile_sync',
      accountId: 'google_sync',
      mode: 'partial',
    })).toBe(true);
    expect(isSyncQueueMessage({
      kind: 'sync-account',
      eventId: '../unsafe',
      profileId: 'profile_sync',
      accountId: 'google_sync',
      mode: 'partial',
    })).toBe(false);
  });

  it('persists an event before dispatch and applies it through a lease', async () => {
    const queued = await enqueueSyncEvent(env, {
      profileId: 'profile_sync',
      accountId: 'google_sync',
      mode: 'partial',
      startHistoryId: 'history_10',
    }, now);
    expect(await env.DB.prepare(
      `SELECT state, dispatch_pending, attempts, history_id
         FROM provider_events
        WHERE profile_id = ? AND account_id = ? AND event_id = ?`,
    ).bind(queued.profileId, queued.accountId, queued.eventId).first()).toEqual({
      state: 'received',
      dispatch_pending: 0,
      attempts: 0,
      history_id: 'history_10',
    });

    let syncCalls = 0;
    const worker = createTapEmailCoordinator({
      now: () => now,
      async syncMailbox(workerEnv, request) {
        syncCalls += 1;
        await workerEnv.DB.prepare(
          `UPDATE google_accounts SET newest_history_id = 'history_11', updated_at = ?
            WHERE profile_id = ? AND account_id = ?`,
        ).bind(now.toISOString(), request.profileId, request.accountId).run();
      },
    });
    const message = fakeMessage(queued);
    await worker.queue(batch(message.message), env);

    expect(syncCalls).toBe(1);
    expect(message.result()).toEqual({ disposition: 'ack', delaySeconds: 0 });
    expect(await env.DB.prepare(
      `SELECT state, attempts, resulting_history_id, error_code
         FROM provider_events
        WHERE profile_id = ? AND account_id = ? AND event_id = ?`,
    ).bind(queued.profileId, queued.accountId, queued.eventId).first()).toEqual({
      state: 'applied',
      attempts: 1,
      resulting_history_id: 'history_11',
      error_code: null,
    });
  });

  it('retries transient failures and dead-letters an exhausted event', async () => {
    const queued = await enqueueSyncEvent(env, {
      profileId: 'profile_sync',
      accountId: 'google_sync',
      mode: 'partial',
    }, now);
    const worker = createTapEmailCoordinator({
      now: () => now,
      async syncMailbox() {
        throw new GoogleApiError(
          503,
          'google_temporarily_unavailable',
          'Google is temporarily unavailable.',
        );
      },
    });
    const first = fakeMessage(queued);
    await worker.queue(batch(first.message), env);
    expect(first.result().disposition).toBe('retry');
    expect(await env.DB.prepare(
      `SELECT state, dispatch_pending, attempts, error_code
         FROM provider_events WHERE event_id = ?`,
    ).bind(queued.eventId).first()).toEqual({
      state: 'retryable',
      dispatch_pending: 1,
      attempts: 1,
      error_code: 'google_temporarily_unavailable',
    });

    await env.DB.prepare(
      `UPDATE provider_events
          SET state = 'retryable', attempts = 4, next_attempt_at = NULL
        WHERE event_id = ?`,
    ).bind(queued.eventId).run();
    const exhausted = fakeMessage(queued);
    await worker.queue(batch(exhausted.message), env);
    expect(exhausted.result().disposition).toBe('ack');
    expect(await env.DB.prepare(
      `SELECT state, dispatch_pending, attempts, error_code
         FROM provider_events WHERE event_id = ?`,
    ).bind(queued.eventId).first()).toEqual({
      state: 'dead_letter',
      dispatch_pending: 0,
      attempts: 5,
      error_code: 'google_temporarily_unavailable',
    });
  });

  it('fails a malformed persisted event closed instead of dispatching it', async () => {
    await env.DB.prepare(
      `INSERT INTO provider_events
         (profile_id, account_id, event_id, history_id, state, payload_json,
          dispatch_pending, received_at, updated_at)
       VALUES ('profile_sync', 'google_sync', 'sync_invalid', 'bootstrap',
               'received', '{}', 1, ?, ?)`,
    ).bind(now.toISOString(), now.toISOString()).run();

    await redispatchSyncEvents(env, now);

    expect(await env.DB.prepare(
      `SELECT state, dispatch_pending, error_code
         FROM provider_events WHERE event_id = 'sync_invalid'`,
    ).first()).toEqual({
      state: 'dead_letter',
      dispatch_pending: 0,
      error_code: 'invalid_event_payload',
    });
  });
});
