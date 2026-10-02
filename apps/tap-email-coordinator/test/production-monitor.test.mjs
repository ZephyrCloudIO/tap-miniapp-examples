import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { runTapEmailProductionMonitor } from '../../../scripts/tap-email-production-monitor.mjs';

const now = new Date('2026-09-27T12:00:00Z');
const ago = minutes => new Date(now.getTime() - minutes * 60_000).toISOString();
const queues = ['commands', 'sync'].flatMap(role => [
  { queue_id: role, queue_name: `tap-email-${role}-production`, settings: { delivery_paused: false },
    producers: [{ type: 'worker', script: 'tap-email-coordinator-production' }],
    consumers: [{ type: 'worker', script_name: 'tap-email-coordinator-production', dead_letter_queue: `tap-email-${role}-dead-letter-production` }] },
  { queue_id: `${role}_dlq`, queue_name: `tap-email-${role}-dead-letter-production` },
]);

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM provider_events').run();
  await env.DB.prepare('DELETE FROM google_accounts').run();
  await env.DB.prepare(`INSERT INTO google_accounts(profile_id, account_id, google_subject, connection_state,
    coverage_state, created_at, updated_at, last_sync_requested_at, last_full_sync_completed_at)
    VALUES ('monitor_profile', 'monitor_account', 'subject', 'active', 'current', ?1, ?1, ?1, ?2)`)
    .bind(now.toISOString(), ago(60)).run();
});

async function event(state, minutes, nextAttempt = null, leaseExpiry = null, payload = {}, profileId = 'monitor_profile', accountId = 'monitor_account') {
  await env.DB.prepare(`INSERT INTO provider_events(profile_id, account_id, event_id, history_id, state,
    attempts, received_at, updated_at, next_attempt_at, lease_expires_at, payload_json)
    VALUES (?, ?, ?, 'revision', ?, ?, ?, ?, ?, ?, ?)`)
    .bind(profileId, accountId, crypto.randomUUID(), state, state === 'received' ? 0 : 1, ago(minutes), ago(minutes), nextAttempt, leaseExpiry, JSON.stringify(payload)).run();
}

async function inspect() {
  return runTapEmailProductionMonitor({ now, sleep: async () => {}, accountId: 'account', apiToken: 'test', databaseId: 'database',
    fetchImpl: async (input, init = {}) => {
      const url = new URL(input);
      if (url.pathname.endsWith('/queues')) return Response.json({ success: true, result: queues, result_info: { total_pages: 1 } });
      if (url.pathname.endsWith('/metrics')) return Response.json({ success: true, result: {
        backlog_count: url.pathname.endsWith('/sync/metrics') ? 1 : 0, backlog_bytes: 303, oldest_message_timestamp_ms: 0,
      } });
      if (url.pathname.endsWith('/query')) {
        const { sql, params } = JSON.parse(init.body);
        const result = await env.DB.prepare(sql).bind(...params).all();
        return Response.json({ success: true, result: [result] });
      }
      return Response.json({ ok: true, service: 'tap-email-coordinator' });
    },
  });
}

describe('production monitor durable evidence in D1', () => {
  it('allows an unknown-age warning for recent work without declaring a verified queue age', async () => {
    await event('received', 1);
    const result = await inspect();
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(result.warnings.map(value => value.code)).toEqual(['sync_queue_backlog_age_unknown']);
  });

  it.each([
    ['received', 6, null, null, 'received_event_not_leased'],
    ['retryable', 10, ago(6), null, 'retryable_event_overdue'],
    ['processing', 10, null, ago(3), 'processing_lease_expired'],
    ['dead_letter', 10, null, null, 'unresolved_sync_dead_letters'],
  ])('keeps %s failures visible even when the Cloudflare DLQ is empty', async (state, minutes, nextAttempt, expiry, expected) => {
    await event(state, minutes, nextAttempt, expiry);
    const result = await inspect();
    expect(result.ok).toBe(false);
    expect(result.warnings).toEqual([]);
    expect(result.issues.map(value => value.code)).toEqual(['sync_queue_backlog_age_unknown', expected]);
  });

  it('does not resurrect a failure superseded by a full sync', async () => {
    await event('dead_letter', 61);
    expect((await inspect()).ok).toBe(true);
  });

  it('ignores an incrementally recovered failure while retaining its terminal audit record', async () => {
    await event('dead_letter', 10, null, null, { mode: 'partial' });
    await env.DB.prepare('UPDATE provider_events SET recovered_at = ?').bind(ago(5)).run();
    expect((await inspect()).ok).toBe(true);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM provider_events WHERE state = 'dead_letter'").first('n')).toBe(1);
  });

  it('reports terminal failures when no full sync has ever completed', async () => {
    await env.DB.prepare('UPDATE google_accounts SET last_full_sync_completed_at = NULL').run();
    await event('dead_letter', 61);
    expect((await inspect()).issues.map(value => value.code)).toContain('unresolved_sync_dead_letters');
  });

  it('ignores historical terminal failures for revoked accounts', async () => {
    await event('dead_letter', 10);
    await env.DB.prepare("UPDATE google_accounts SET connection_state = 'revoked'").run();
    expect((await inspect()).ok).toBe(true);
  });

  const continuation = { mode: 'continue', syncGeneration: 'generation', pageToken: 'failed_page' };

  it('recognizes a recovered continuation only after the same page applied and the checkpoint advanced', async () => {
    await env.DB.prepare("UPDATE google_accounts SET sync_generation = 'generation', backfill_page_token = 'next_page', sync_generation_started_at = ?")
      .bind(ago(60)).run();
    await event('dead_letter', 10, null, null, continuation);
    await event('applied', 5, null, null, continuation);
    const result = await inspect();
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(result.warnings.map(value => value.code)).toEqual(['sync_queue_backlog_age_unknown']);
    // The monitor must retain the audit record, not rewrite a failure to success.
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM provider_events WHERE state = 'dead_letter'").first('n')).toBe(1);
  });

  it.each(['profile', 'account', 'page', 'generation', 'mode', 'older', 'still_current', 'new_traversal', 'missing_generation', 'not_applied', 'later_reset', 'unknown_start'])
    ('does not treat a %s mismatch as proof of recovery', async mismatch => {
      await env.DB.prepare('UPDATE google_accounts SET sync_generation = ?, backfill_page_token = ?, sync_generation_started_at = ?')
        .bind(mismatch === 'new_traversal' ? 'other_generation' : 'generation',
          mismatch === 'still_current' ? 'failed_page' : 'next_page',
          mismatch === 'unknown_start' ? null : ago(mismatch === 'later_reset' ? 8 : 60)).run();
      const failedPayload = mismatch === 'missing_generation' ? { mode: 'continue', pageToken: 'failed_page' } : continuation;
      await event('dead_letter', 10, null, null, failedPayload);
      const recoveredPayload = { ...failedPayload,
        ...(mismatch === 'page' ? { pageToken: 'other_page' } : {}),
        ...(mismatch === 'generation' ? { syncGeneration: 'other_generation' } : {}),
        ...(mismatch === 'mode' ? { mode: 'partial' } : {}),
      };
      if (mismatch === 'profile' || mismatch === 'account') {
        await env.DB.prepare(`INSERT INTO google_accounts(profile_id, account_id, google_subject,
          connection_state, coverage_state, created_at, updated_at, last_sync_requested_at)
          VALUES (?, ?, 'other_subject', 'active', 'current', ?3, ?3, ?3)`)
          .bind(mismatch === 'profile' ? 'other_profile' : 'monitor_profile',
            mismatch === 'account' ? 'other_account' : 'monitor_account', now.toISOString()).run();
      }
      await event(mismatch === 'not_applied' ? 'processing' : 'applied', mismatch === 'older' ? 11 : 5,
        null, ago(-1), recoveredPayload,
        mismatch === 'profile' ? 'other_profile' : 'monitor_profile',
        mismatch === 'account' ? 'other_account' : 'monitor_account');
      const result = await inspect();
      expect(result.ok).toBe(false);
      expect(result.issues.map(value => value.code)).toContain('unresolved_sync_dead_letters');
    });

  it.each([
    ['updated_at', 'active_account_not_advanced'],
    ['last_sync_requested_at', 'recent_sync_not_requested'],
  ])('retains the %s account-progress check after splitting the D1 compound query', async (field, code) => {
    await env.DB.prepare(`UPDATE google_accounts SET ${field} = ?`).bind(ago(26)).run();
    const result = await inspect();
    expect(result.issues.map(value => value.code)).toEqual(['sync_queue_backlog_age_unknown', code]);
    expect(result.warnings).toEqual([]);
  });
});
