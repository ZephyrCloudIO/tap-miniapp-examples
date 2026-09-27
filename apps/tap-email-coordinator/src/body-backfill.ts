import type { MailBodyCoverage } from '@tap-examples/tap-email-protocol';
import { GoogleApiError } from './google';
import { ensureThreadInventory, readExactMessageBody, ThreadPageError } from './mailbox';
import { enqueueSyncEvent, type MailboxSyncRequest } from './sync-events';

const batchSize = 8;
const continuationDelaySeconds = 30;
const workClause = `(t.content_state = 'metadata' OR EXISTS (
  SELECT 1 FROM mail_messages m WHERE m.profile_id = t.profile_id AND m.account_id = t.account_id
    AND m.thread_id = t.thread_id AND m.body_state = 'metadata'
    AND NOT EXISTS (SELECT 1 FROM mail_body_failures f WHERE f.profile_id = m.profile_id
      AND f.account_id = m.account_id AND f.message_id = m.message_id AND f.revision = t.history_id)))`;

export async function listBodyCoverage(env: Env, profileId: string): Promise<readonly MailBodyCoverage[]> {
  const rows = (await env.DB.prepare(`SELECT a.account_id, a.connection_state, a.coverage_state, a.unresolved_failures,
    b.enabled, b.updated_at, b.last_error_code,
    (SELECT COUNT(*) FROM mail_messages m WHERE m.profile_id = a.profile_id AND m.account_id = a.account_id) AS total,
    (SELECT COUNT(*) FROM mail_messages m WHERE m.profile_id = a.profile_id AND m.account_id = a.account_id AND m.body_state = 'ready') AS downloaded,
    (SELECT COUNT(*) FROM mail_threads t WHERE t.profile_id = a.profile_id AND t.account_id = a.account_id AND t.content_state = 'metadata') AS metadata_threads,
    (SELECT COUNT(*) FROM mail_body_failures f JOIN mail_messages m USING (profile_id, account_id, message_id)
      JOIN mail_threads t ON t.profile_id = m.profile_id AND t.account_id = m.account_id AND t.thread_id = m.thread_id
      WHERE f.profile_id = a.profile_id AND f.account_id = a.account_id AND m.body_state = 'metadata' AND f.revision = t.history_id) AS unavailable
    FROM google_accounts a LEFT JOIN mail_body_backfills b USING (profile_id, account_id)
    WHERE a.profile_id = ? AND a.connection_state != 'revoked' ORDER BY a.account_id`).bind(profileId).all<{
      account_id: string; connection_state: string; coverage_state: string; unresolved_failures: number;
      enabled: number | null; updated_at: string | null; last_error_code: string | null;
      total: number; downloaded: number; unavailable: number; metadata_threads: number;
    }>()).results;
  return rows.map(row => ({ accountId: row.account_id, enabled: row.enabled === 1,
    total: row.total, downloaded: row.downloaded, unavailable: row.unavailable,
    pending: Math.max(0, row.total - row.downloaded - row.unavailable),
    metadataThreads: row.metadata_threads, updatedAt: row.updated_at, errorCode: row.last_error_code,
    providerHistoryComplete: row.connection_state === 'active' && row.coverage_state === 'current' && row.unresolved_failures === 0,
  }));
}

export async function setBodyBackfill(env: Env, profileId: string, accountId: string, enabled: boolean, now: Date) {
  const account = await env.DB.prepare("SELECT account_id FROM google_accounts WHERE profile_id = ? AND account_id = ? AND connection_state != 'revoked' AND (? = 0 OR connection_state = 'active')")
    .bind(profileId, accountId, Number(enabled)).first();
  if (!account) throw new GoogleApiError(404, 'google_connection_required', 'Connect this Google account before downloading its history.');
  const generation = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO mail_body_backfills(profile_id, account_id, generation, enabled, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(profile_id, account_id) DO UPDATE SET generation = excluded.generation, enabled = excluded.enabled,
        updated_at = excluded.updated_at, lease_expires_at = NULL, retry_after = NULL, last_error_code = NULL`)
      .bind(profileId, accountId, generation, Number(enabled), now.toISOString()),
    // Resume is also the explicit retry of previously unavailable messages.
    ...(enabled ? [env.DB.prepare('DELETE FROM mail_body_failures WHERE profile_id = ? AND account_id = ?').bind(profileId, accountId)] : []),
  ]);
  if (enabled) await enqueueSyncEvent(env, { profileId, accountId, mode: 'bodies', syncGeneration: generation }, now);
  return listBodyCoverage(env, profileId);
}

export async function enqueueBodyBackfills(env: Env, now: Date): Promise<void> {
  const rows = (await env.DB.prepare(`SELECT b.profile_id, b.account_id, b.generation FROM mail_body_backfills b
    JOIN google_accounts a USING (profile_id, account_id)
    WHERE b.enabled = 1 AND a.connection_state = 'active'
      AND (b.retry_after IS NULL OR b.retry_after <= ?) AND (b.lease_expires_at IS NULL OR b.lease_expires_at <= ?)
      AND EXISTS (SELECT 1 FROM mail_threads t WHERE t.profile_id = b.profile_id AND t.account_id = b.account_id AND ${workClause})
      AND NOT EXISTS (SELECT 1 FROM provider_events e WHERE e.profile_id = b.profile_id AND e.account_id = b.account_id
        AND e.state IN ('received', 'processing', 'retryable') AND json_extract(e.payload_json, '$.mode') = 'bodies'
        AND json_extract(e.payload_json, '$.syncGeneration') = b.generation)
    ORDER BY b.updated_at LIMIT 20`).bind(now.toISOString(), now.toISOString()).all<{ profile_id: string; account_id: string; generation: string }>()).results;
  for (const row of rows) await enqueueSyncEvent(env, { profileId: row.profile_id, accountId: row.account_id,
    mode: 'bodies', syncGeneration: row.generation }, now, continuationDelaySeconds);
}

export async function processBodyBackfill(env: Env, request: MailboxSyncRequest, now: Date): Promise<void> {
  if (!request.syncGeneration) return;
  const { profileId, accountId, syncGeneration: generation } = request;
  const scope = [profileId, accountId, generation];
  const current = () => env.DB.prepare('SELECT 1 FROM mail_body_backfills WHERE profile_id = ? AND account_id = ? AND generation = ? AND enabled = 1').bind(...scope).first();
  const claimed = await env.DB.prepare(`UPDATE mail_body_backfills SET lease_expires_at = ?
    WHERE profile_id = ? AND account_id = ? AND generation = ? AND enabled = 1
      AND (retry_after IS NULL OR retry_after <= ?) AND (lease_expires_at IS NULL OR lease_expires_at <= ?)`)
    .bind(new Date(now.getTime() + 5 * 60_000).toISOString(), ...scope, now.toISOString(), now.toISOString()).run();
  if (claimed.meta.changes !== 1) return;
  try {
    const selected = await env.DB.prepare(`SELECT t.thread_id FROM mail_threads t
      WHERE t.profile_id = ? AND t.account_id = ? AND ${workClause} ORDER BY t.received_at DESC, t.thread_id LIMIT 1`)
      .bind(profileId, accountId).first<{ thread_id: string }>();
    if (selected && await current()) {
      const threadId = selected.thread_id;
      // The full-thread path enumerates legacy truncated inventories and uses
      // bounded individual-message recovery for oversized conversations.
      await ensureThreadInventory(env, profileId, accountId, threadId, now, 'full');
      const revision = await env.DB.prepare('SELECT history_id FROM mail_threads WHERE profile_id = ? AND account_id = ? AND thread_id = ?')
        .bind(profileId, accountId, threadId).first<string>('history_id');
      if (revision) {
        const pending = (await env.DB.prepare(`SELECT m.message_id FROM mail_messages m WHERE m.profile_id = ? AND m.account_id = ?
          AND m.thread_id = ? AND m.body_state = 'metadata' AND NOT EXISTS (SELECT 1 FROM mail_body_failures f
            WHERE f.profile_id = m.profile_id AND f.account_id = m.account_id AND f.message_id = m.message_id AND f.revision = ?)
          ORDER BY m.ordinal DESC LIMIT ?`).bind(profileId, accountId, threadId, revision, batchSize).all<{ message_id: string }>()).results;
        for (const message of pending) {
          if (!await current()) break;
          try { await readExactMessageBody(env, profileId, accountId, threadId, message.message_id, revision, now); }
          catch (error) {
            if (!(error instanceof GoogleApiError) || !(error.status === 404 && error.code !== 'google_connection_required') && !['message_body_unavailable', 'google_response_too_large', 'message_not_found', 'invalid_message'].includes(error.code)) throw error;
            await env.DB.prepare(`INSERT INTO mail_body_failures(profile_id, account_id, message_id, revision, error_code, updated_at)
              SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE EXISTS (SELECT 1 FROM mail_body_backfills WHERE profile_id = ?1 AND account_id = ?2 AND generation = ?7 AND enabled = 1)
                AND EXISTS (SELECT 1 FROM mail_messages WHERE profile_id = ?1 AND account_id = ?2 AND message_id = ?3)
              ON CONFLICT(profile_id, account_id, message_id) DO UPDATE SET revision = excluded.revision, error_code = excluded.error_code, updated_at = excluded.updated_at`)
              .bind(profileId, accountId, message.message_id, revision, error.code, now.toISOString(), generation).run();
          }
        }
      }
    }
    await env.DB.prepare(`UPDATE mail_body_backfills SET lease_expires_at = NULL, retry_after = NULL, last_error_code = NULL, updated_at = ?
      WHERE profile_id = ? AND account_id = ? AND generation = ?`).bind(now.toISOString(), ...scope).run();
    const remains = await env.DB.prepare(`SELECT 1 FROM mail_threads t WHERE t.profile_id = ? AND t.account_id = ? AND ${workClause} LIMIT 1`)
      .bind(profileId, accountId).first();
    if (remains && await current()) await enqueueSyncEvent(env, { profileId, accountId, mode: 'bodies', syncGeneration: generation }, now, continuationDelaySeconds);
  } catch (error) {
    const code = error instanceof GoogleApiError || error instanceof ThreadPageError ? error.code : 'body_backfill_failed';
    const blocked = error instanceof GoogleApiError && ['google_connection_required', 'google_reauthorization_required'].includes(code);
    await env.DB.prepare(`UPDATE mail_body_backfills SET lease_expires_at = NULL, retry_after = ?, last_error_code = ?,
      enabled = CASE WHEN ? THEN 0 ELSE enabled END, updated_at = ? WHERE profile_id = ? AND account_id = ? AND generation = ?`)
      .bind(new Date(now.getTime() + 5 * 60_000).toISOString(), code, Number(blocked), now.toISOString(), ...scope).run();
    // Cron resumes transient failures from durable per-message states. Content
    // failures do not become provider metadata-sync dead letters.
  }
}
