import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sealSecret } from '../src/crypto';
import { createTapEmailCoordinator } from '../src/index';
import { enqueueScheduledSyncs, requestAccountSync, syncGoogleMailbox } from '../src/mailbox';
import { enqueueSyncEvent, type SyncQueueMessage } from '../src/sync-events';

const now = new Date('2026-10-02T12:00:00Z');
const scope = { profileId: 'recovery_profile', accountId: 'recovery_account' };
const failedAt = new Date(now.getTime() - 60_000).toISOString();

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM google_accounts').run();
  await env.DB.prepare(`INSERT INTO google_accounts
    (profile_id, account_id, google_subject, email_address, connection_state, coverage_state,
     newest_history_id, last_full_sync_completed_at, created_at, updated_at)
    VALUES (?, ?, 'recovery_subject', 'owner@example.com', 'active', 'current', '100', ?3, ?3, ?3)`)
    .bind(scope.profileId, scope.accountId, new Date(now.getTime() - 86_400_000).toISOString()).run();
  await env.DB.prepare(`INSERT INTO google_credentials
    (profile_id, account_id, refresh_token_ciphertext, access_token_ciphertext,
     access_token_expires_at, granted_scopes, created_at, updated_at)
    VALUES (?, ?, ?3, ?3, ?, 'gmail.modify', ?5, ?5)`)
    .bind(scope.profileId, scope.accountId,
      await sealSecret('test-token', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'),
      new Date(now.getTime() + 3_600_000).toISOString(), now.toISOString()).run();
});

afterEach(() => vi.restoreAllMocks());

async function fail(historyId = '100', mode = 'partial', timestamp = failedAt, accountId = scope.accountId) {
  await env.DB.prepare(`INSERT INTO provider_events
    (profile_id, account_id, event_id, history_id, state, error_code, payload_json, received_at, updated_at)
    VALUES (?, ?, ?, ?, 'dead_letter', 'google_temporarily_unavailable', ?, ?6, ?6)`)
    .bind(scope.profileId, accountId, crypto.randomUUID(), historyId, JSON.stringify({ mode }), timestamp).run();
  await env.DB.prepare('UPDATE google_accounts SET unresolved_failures = 1, coverage_state = ? WHERE profile_id = ? AND account_id = ?')
    .bind('stale', scope.profileId, accountId).run();
}

async function consume(body: SyncQueueMessage, worker = createTapEmailCoordinator({ now: () => now })) {
  const ack = vi.fn();
  const retry = vi.fn();
  await worker.queue({
    queue: 'tap-email-sync', messages: [{ id: body.eventId, timestamp: now, body, attempts: 1, ack, retry }],
    metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } }, ackAll() {}, retryAll() {},
  }, env);
  return { ack, retry };
}

describe('incremental sync recovery', () => {
  it.each(['scheduled', 'manual'])('keeps %s recovery incremental after a terminal failure', async trigger => {
    await fail();
    if (trigger === 'scheduled') await enqueueScheduledSyncs(env, now);
    else expect(await requestAccountSync(env, scope.profileId, scope.accountId, now)).toBe(true);
    const pending = (await env.DB.prepare("SELECT payload_json FROM provider_events WHERE state = 'received'")
      .all<{ payload_json: string }>()).results.map(row => JSON.parse(row.payload_json));
    expect(pending).toEqual([expect.objectContaining({ mode: 'partial', startHistoryId: '100' })]);
    expect(await env.DB.prepare('SELECT last_full_sync_completed_at, backfill_page_token FROM google_accounts').first())
      .toEqual({ last_full_sync_completed_at: new Date(now.getTime() - 86_400_000).toISOString(), backfill_page_token: null });
  });

  it('clears an exhausted failure only after every incremental page completes, preserving its audit record', async () => {
    const queued = await enqueueSyncEvent(env, { ...scope, mode: 'partial' }, new Date(failedAt));
    const requests: string[] = [];
    const failing = createTapEmailCoordinator({ now: () => new Date(failedAt), async syncMailbox(_env, request) {
      requests.push(request.startHistoryId!);
      throw new Error('temporary transport failure');
    } });
    await consume(queued, failing);
    // Another completed invocation must not change the failed event's starting cursor on retry.
    await env.DB.prepare("UPDATE google_accounts SET newest_history_id = '150'").run();
    await env.DB.prepare('UPDATE provider_events SET attempts = 4, next_attempt_at = NULL WHERE event_id = ?')
      .bind(queued.eventId).run();
    expect((await consume(queued, failing)).ack).toHaveBeenCalledOnce();
    expect(requests).toEqual(['100', '100']);
    await env.DB.prepare("UPDATE google_accounts SET newest_history_id = '100'").run();

    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = new URL(String(input));
      expect(url.pathname).toBe('/gmail/v1/users/me/history');
      expect(url.searchParams.get('startHistoryId')).toBe('100');
      return Response.json(url.searchParams.has('pageToken') ? { historyId: '200' }
        : { historyId: '200', nextPageToken: 'history-next' });
    });
    await enqueueScheduledSyncs(env, now);
    const root = JSON.parse((await env.DB.prepare("SELECT payload_json FROM provider_events WHERE state = 'received'")
      .first<{ payload_json: string }>())!.payload_json);
    await consume(root);
    expect(await env.DB.prepare('SELECT recovered_at FROM provider_events WHERE event_id = ?')
      .bind(queued.eventId).first('recovered_at')).toBeNull();
    const next = JSON.parse((await env.DB.prepare("SELECT payload_json FROM provider_events WHERE state = 'received'")
      .first<{ payload_json: string }>())!.payload_json);
    await consume(next);
    expect(await env.DB.prepare('SELECT state, error_code, recovered_at FROM provider_events WHERE event_id = ?')
      .bind(queued.eventId).first()).toEqual({ state: 'dead_letter', error_code: 'sync_failed', recovered_at: now.toISOString() });
    expect(await env.DB.prepare('SELECT coverage_state, unresolved_failures, backfill_page_token FROM google_accounts').first())
      .toEqual({ coverage_state: 'current', unresolved_failures: 0, backfill_page_token: null });
  });

  it.each([
    ['90', 'partial', false], ['100', 'partial', true], ['150', 'partial', true],
    ['200', 'partial', true], ['201', 'partial', false], ['bootstrap', 'partial', false],
    ['100', 'continue', false], ['100', 'newest', false],
  ])('only resolves a covered %s checkpoint in %s mode', async (historyId, mode, recovered) => {
    await fail(historyId, mode);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ historyId: '200' }));
    await syncGoogleMailbox(env, { ...scope, mode: 'partial', startHistoryId: '100' }, now);
    expect(await env.DB.prepare('SELECT recovered_at FROM provider_events').first('recovered_at'))
      .toBe(recovered ? now.toISOString() : null);
  });

  it('compares large Gmail IDs without signed-integer overflow and retains newer failures', async () => {
    await fail('18446744073709551614');
    await fail('18446744073709551616');
    await fail('18446744073709551614', 'partial', new Date(now.getTime() + 60_000).toISOString());
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ historyId: '18446744073709551615' }));
    await syncGoogleMailbox(env, { ...scope, mode: 'partial', startHistoryId: '18446744073709551613' }, now);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM provider_events WHERE recovered_at IS NOT NULL').first('n')).toBe(1);
  });

  it('does not resolve a different mailbox or discard an active backfill checkpoint', async () => {
    await env.DB.prepare(`INSERT INTO google_accounts
      (profile_id, account_id, google_subject, connection_state, coverage_state, created_at, updated_at)
      VALUES (?, 'other_account', 'other_subject', 'active', 'stale', ?2, ?2)`)
      .bind(scope.profileId, now.toISOString()).run();
    await fail('100', 'partial', failedAt, 'other_account');
    await fail();
    await env.DB.prepare("UPDATE google_accounts SET backfill_page_token = 'archive-next', sync_generation = 'archive' WHERE account_id = ?")
      .bind(scope.accountId).run();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ historyId: '200' }));
    await syncGoogleMailbox(env, { ...scope, mode: 'partial', startHistoryId: '100' }, now);
    expect(await env.DB.prepare("SELECT recovered_at FROM provider_events WHERE account_id = 'other_account'").first('recovered_at')).toBeNull();
    expect(await env.DB.prepare('SELECT coverage_state, backfill_page_token, sync_generation FROM google_accounts WHERE account_id = ?')
      .bind(scope.accountId).first()).toEqual({ coverage_state: 'backfilling', backfill_page_token: 'archive-next', sync_generation: 'archive' });
  });

  it.each(['missing', 'expired'])('retains full sync when the saved history cursor is %s', async reason => {
    if (reason === 'missing') await env.DB.prepare('UPDATE google_accounts SET newest_history_id = NULL').run();
    const paths: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = new URL(String(input));
      paths.push(url.pathname);
      if (url.pathname.endsWith('/history')) return Response.json({ error: {} }, { status: 404 });
      if (url.pathname.endsWith('/profile')) return Response.json({ historyId: '200' });
      expect(url.pathname).toBe('/gmail/v1/users/me/threads');
      return Response.json({ threads: [] });
    });
    await syncGoogleMailbox(env, { ...scope, mode: 'partial' }, now);
    expect(paths).toContain('/gmail/v1/users/me/threads');
    expect(await env.DB.prepare('SELECT last_full_sync_completed_at FROM google_accounts').first('last_full_sync_completed_at'))
      .toBe(now.toISOString());
  });
});
