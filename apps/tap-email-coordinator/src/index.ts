import {
  isSafeMailIdentifier,
  isMailCommand,
  type MailCommand,
  type MailCommandReceipt,
  type MailCommandState,
} from '@tap-examples/tap-email-protocol';
import {
  AccessError,
  verifyPlatformSession,
  type AccessVerifier,
  type ProfileIdentity,
} from './auth';
import {
  type GoogleProviderPort,
  type ProviderExecutionResult,
} from './provider';
import { createGoogleProvider, GoogleApiError } from './google';
import {
  enqueueScheduledSyncs,
  executeTapOwnedCommand,
  mailboxSnapshot,
  markDueReminders,
  requestAccountSync,
  syncGoogleMailbox,
  threadSnapshot,
} from './mailbox';
import {
  beginGoogleOAuth,
  finishGoogleOAuth,
  GoogleOAuthError,
} from './oauth';
import {
  isSyncQueueMessage,
  redispatchSyncEvents,
  type MailboxSyncRequest,
  type SyncQueueMessage,
} from './sync-events';
import { coordinatorReadiness } from './readiness';

const maxCommandBytes = 65_536;
const terminalStates = new Set<MailCommandState>([
  'applied',
  'uncertain',
  'failed',
  'cancelled',
]);

interface CommandQueueMessage {
  readonly kind: 'command';
  readonly profileId: string;
  readonly accountId: string;
  readonly commandId: string;
}

type CoordinatorQueueMessage = CommandQueueMessage | SyncQueueMessage;

interface CommandRow {
  readonly profile_id: string;
  readonly account_id: string;
  readonly command_id: string;
  readonly idempotency_key: string;
  readonly kind: string;
  readonly thread_id: string | null;
  readonly expected_provider_revision: string | null;
  readonly payload_json: string;
  readonly state: MailCommandState;
  readonly attempts: number;
  readonly client_created_at: string;
  readonly created_at: string;
  readonly provider_acknowledged_at: string | null;
  readonly error_code: string | null;
}

interface CoordinatorDependencies {
  readonly verifyAccess?: AccessVerifier;
  readonly provider?: GoogleProviderPort;
  readonly syncMailbox?: (
    env: Env,
    request: MailboxSyncRequest,
    now: Date,
  ) => Promise<void>;
  readonly now?: () => Date;
}

interface ProviderEventRow {
  readonly profile_id: string;
  readonly account_id: string;
  readonly event_id: string;
  readonly state: 'received' | 'processing' | 'applied' | 'retryable' | 'dead_letter';
  readonly attempts: number;
}

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function json(
  body: Readonly<Record<string, unknown>>,
  status = 200,
  headers: HeadersInit = {},
): Response {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      ...headers,
    },
  });
}

function allowedOrigins(env: Env): ReadonlySet<string> {
  return new Set(
    env.ALLOWED_ORIGINS.split(',')
      .map(origin => origin.trim())
      .filter(Boolean),
  );
}

function corsHeaders(request: Request, env: Env): HeadersInit {
  const origin = request.headers.get('Origin');
  if (!origin) return {};
  if (!allowedOrigins(env).has(origin)) {
    throw new ApiError(403, 'origin_denied', 'This origin is not allowed.');
  }
  return {
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers':
      'Authorization, Content-Type, X-TAP-Dev-Profile',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
  };
}

async function readBoundedJson(request: Request): Promise<unknown> {
  if (!request.headers.get('Content-Type')?.toLowerCase().includes('application/json')) {
    throw new ApiError(415, 'unsupported_media_type', 'Use application/json.');
  }
  const declared = Number(request.headers.get('Content-Length') ?? '0');
  if (Number.isFinite(declared) && declared > maxCommandBytes) {
    throw new ApiError(413, 'command_too_large', 'The command is too large.');
  }
  if (!request.body) throw new ApiError(400, 'invalid_command', 'A command is required.');
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > maxCommandBytes) {
      await reader.cancel('command too large');
      throw new ApiError(413, 'command_too_large', 'The command is too large.');
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  try {
    return JSON.parse(text + decoder.decode());
  } catch {
    throw new ApiError(400, 'invalid_json', 'The command body is not valid JSON.');
  }
}

function receipt(row: CommandRow): MailCommandReceipt {
  return {
    commandId: row.command_id,
    idempotencyKey: row.idempotency_key,
    accountId: row.account_id,
    state: row.state,
    acceptedAt: row.created_at,
    providerAcknowledgedAt: row.provider_acknowledged_at,
    errorCode: row.error_code,
  };
}

function decodeCommand(row: CommandRow): MailCommand {
  const value: unknown = {
    v: 1,
    commandId: row.command_id,
    idempotencyKey: row.idempotency_key,
    accountId: row.account_id,
    threadId: row.thread_id,
    kind: row.kind,
    createdAt: row.client_created_at,
    expectedProviderRevision: row.expected_provider_revision,
    payload: JSON.parse(row.payload_json),
  };
  if (!isMailCommand(value)) {
    throw new ApiError(500, 'stored_command_invalid', 'Stored command validation failed.');
  }
  return value;
}

async function commandRow(
  env: Env,
  identity: ProfileIdentity,
  commandId: string,
): Promise<CommandRow | null> {
  return env.DB.prepare(
    `SELECT profile_id, account_id, command_id, idempotency_key, kind,
            thread_id, expected_provider_revision, payload_json, state,
            attempts, client_created_at, created_at,
            provider_acknowledged_at, error_code
       FROM mail_commands
      WHERE profile_id = ? AND command_id = ?`,
  )
    .bind(identity.profileId, commandId)
    .first<CommandRow>();
}

async function commandRowByIdempotencyKey(
  env: Env,
  identity: ProfileIdentity,
  idempotencyKey: string,
): Promise<CommandRow | null> {
  return env.DB.prepare(
    `SELECT profile_id, account_id, command_id, idempotency_key, kind,
            thread_id, expected_provider_revision, payload_json, state,
            attempts, client_created_at, created_at,
            provider_acknowledged_at, error_code
       FROM mail_commands
      WHERE profile_id = ? AND idempotency_key = ?`,
  )
    .bind(identity.profileId, idempotencyKey)
    .first<CommandRow>();
}

function auditStatement(
  env: Env,
  profileId: string,
  accountId: string | null,
  operation: string,
  objectId: string,
  outcome: string,
  now: string,
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO coordinator_audit
       (audit_id, profile_id, account_id, operation, object_id, outcome, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), profileId, accountId, operation, objectId, outcome, now);
}

async function recordAudit(
  env: Env,
  profileId: string,
  accountId: string | null,
  operation: string,
  objectId: string,
  outcome: string,
  now: string,
): Promise<void> {
  await auditStatement(
    env,
    profileId,
    accountId,
    operation,
    objectId,
    outcome,
    now,
  ).run();
}

async function submitCommand(
  request: Request,
  env: Env,
  identity: ProfileIdentity,
  now: string,
): Promise<Response> {
  const value = await readBoundedJson(request);
  if (!isMailCommand(value)) {
    throw new ApiError(400, 'invalid_command', 'The mail command is malformed.');
  }
  const command = value;
  const account = await env.DB.prepare(
    `SELECT connection_state
       FROM google_accounts
      WHERE profile_id = ? AND account_id = ?`,
  )
    .bind(identity.profileId, command.accountId)
    .first<{ connection_state: string }>();
  if (!account || account.connection_state !== 'active') {
    throw new ApiError(
      404,
      'account_not_connected',
      'The selected Google account is not connected.',
    );
  }

  const payloadJson = JSON.stringify(command.payload);
  const result = await env.DB.prepare(
    `INSERT OR IGNORE INTO mail_commands
       (profile_id, account_id, command_id, idempotency_key, kind, thread_id,
        expected_provider_revision, payload_json, state, dispatch_pending,
        client_created_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'accepted', 1, ?, ?, ?)`,
  )
    .bind(
      identity.profileId,
      command.accountId,
      command.commandId,
      command.idempotencyKey,
      command.kind,
      command.threadId,
      command.expectedProviderRevision,
      payloadJson,
      command.createdAt,
      now,
      now,
    )
    .run();
  const stored =
    (await commandRow(env, identity, command.commandId)) ??
    (await commandRowByIdempotencyKey(env, identity, command.idempotencyKey));
  if (!stored) throw new ApiError(500, 'command_store_failed', 'Command was not stored.');

  const inserted = Number(result.meta.changes ?? 0) === 1;
  if (
    !inserted &&
    (stored.command_id !== command.commandId ||
      stored.idempotency_key !== command.idempotencyKey ||
      stored.account_id !== command.accountId ||
      stored.kind !== command.kind ||
      stored.thread_id !== command.threadId ||
      stored.expected_provider_revision !== command.expectedProviderRevision ||
      stored.client_created_at !== command.createdAt ||
      stored.payload_json !== payloadJson)
  ) {
    throw new ApiError(
      409,
      'idempotency_conflict',
      'The command identity is already bound to different intent.',
    );
  }
  if (inserted) {
    await recordAudit(
      env,
      identity.profileId,
      command.accountId,
      'command.accepted',
      command.commandId,
      'accepted',
      now,
    );
    try {
      await env.COMMAND_QUEUE.send({
        kind: 'command',
        profileId: identity.profileId,
        accountId: command.accountId,
        commandId: command.commandId,
      } satisfies CommandQueueMessage);
      await env.DB.prepare(
        `UPDATE mail_commands SET dispatch_pending = 0, updated_at = ?
          WHERE profile_id = ? AND command_id = ?`,
      )
        .bind(now, identity.profileId, command.commandId)
        .run();
    } catch (error) {
      console.error(
        JSON.stringify({
          message: 'command queue dispatch deferred',
          profileId: identity.profileId,
          accountId: command.accountId,
          commandId: command.commandId,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
  return json(
    { accepted: true, duplicate: !inserted, receipt: receipt(stored) },
    inserted ? 202 : 200,
  );
}

async function listCoverage(
  env: Env,
  identity: ProfileIdentity,
): Promise<Response> {
  const result = await env.DB.prepare(
    `SELECT account_id, coverage_state, newest_history_id,
            backfill_complete_through, unresolved_failures, updated_at
       FROM google_accounts
      WHERE profile_id = ?
      ORDER BY account_id`,
  )
    .bind(identity.profileId)
    .all<{
      account_id: string;
      coverage_state: string;
      newest_history_id: string | null;
      backfill_complete_through: string | null;
      unresolved_failures: number;
      updated_at: string;
    }>();
  return json({
    accounts: result.results.map(row => ({
      accountId: row.account_id,
      state: row.coverage_state,
      newestHistoryId: row.newest_history_id,
      backfillCompleteThrough: row.backfill_complete_through,
      unresolvedFailures: row.unresolved_failures,
      observedAt: row.updated_at,
    })),
  });
}

async function applyProviderResult(
  env: Env,
  row: CommandRow,
  result: ProviderExecutionResult,
  now: string,
): Promise<{ retry: boolean; delaySeconds: number }> {
  if (result.outcome === 'acknowledged') {
    await env.DB.prepare(
      `UPDATE mail_commands
          SET state = 'applied', provider_acknowledged_at = ?,
              provider_revision = ?, error_code = NULL, lease_token = NULL,
              lease_expires_at = NULL, dispatch_pending = 0, updated_at = ?
        WHERE profile_id = ? AND command_id = ?`,
    )
      .bind(
        now,
        result.providerRevision,
        now,
        row.profile_id,
        row.command_id,
      )
      .run();
    await recordAudit(
      env,
      row.profile_id,
      row.account_id,
      'command.applied',
      row.command_id,
      'applied',
      now,
    );
    return { retry: false, delaySeconds: 0 };
  }
  if (result.outcome === 'uncertain') {
    await env.DB.prepare(
      `UPDATE mail_commands
          SET state = 'uncertain', error_code = ?, lease_token = NULL,
              lease_expires_at = NULL, dispatch_pending = 0, updated_at = ?
        WHERE profile_id = ? AND command_id = ?`,
    )
      .bind(result.errorCode, now, row.profile_id, row.command_id)
      .run();
    return { retry: false, delaySeconds: 0 };
  }
  if (result.outcome === 'failed') {
    await env.DB.prepare(
      `UPDATE mail_commands
          SET state = 'failed', error_code = ?, lease_token = NULL,
              lease_expires_at = NULL, dispatch_pending = 0, updated_at = ?
        WHERE profile_id = ? AND command_id = ?`,
    )
      .bind(result.errorCode, now, row.profile_id, row.command_id)
      .run();
    return { retry: false, delaySeconds: 0 };
  }
  const delaySeconds = Math.min(300, 2 ** Math.min(8, row.attempts + 1));
  const nextAttempt = new Date(Date.parse(now) + delaySeconds * 1_000).toISOString();
  await env.DB.prepare(
    `UPDATE mail_commands
        SET state = 'retryable', error_code = ?, lease_token = NULL,
            lease_expires_at = NULL, dispatch_pending = 1, next_attempt_at = ?,
            updated_at = ?
      WHERE profile_id = ? AND command_id = ?`,
  )
    .bind(result.errorCode, nextAttempt, now, row.profile_id, row.command_id)
    .run();
  return { retry: true, delaySeconds };
}

async function processQueueMessage(
  message: Message<CommandQueueMessage>,
  env: Env,
  provider: GoogleProviderPort,
  now: string,
): Promise<void> {
  const identity = { profileId: message.body.profileId };
  const existing = await commandRow(env, identity, message.body.commandId);
  if (!existing || existing.account_id !== message.body.accountId) {
    message.ack();
    return;
  }
  if (terminalStates.has(existing.state)) {
    message.ack();
    return;
  }
  const leaseToken = crypto.randomUUID();
  const leaseExpiresAt = new Date(Date.parse(now) + 60_000).toISOString();
  const claimed = await env.DB.prepare(
    `UPDATE mail_commands
        SET state = 'leased', lease_token = ?, lease_expires_at = ?,
            attempts = attempts + 1, dispatch_pending = 0, updated_at = ?
      WHERE profile_id = ? AND command_id = ?
        AND (
          (state IN ('accepted', 'retryable')
            AND (next_attempt_at IS NULL OR next_attempt_at <= ?))
          OR (state = 'leased' AND lease_expires_at <= ?)
        )`,
  )
    .bind(
      leaseToken,
      leaseExpiresAt,
      now,
      existing.profile_id,
      existing.command_id,
      now,
      now,
    )
    .run();
  if (Number(claimed.meta.changes ?? 0) !== 1) {
    message.retry({ delaySeconds: 5 });
    return;
  }
  const leased = await commandRow(env, identity, existing.command_id);
  if (!leased) {
    message.retry({ delaySeconds: 5 });
    return;
  }
  try {
    const scope = { profileId: leased.profile_id, accountId: leased.account_id };
    const command = decodeCommand(leased);
    const result =
      (await executeTapOwnedCommand(env, scope, command, now)) ??
      (await provider.execute(scope, command));
    const disposition = await applyProviderResult(env, leased, result, now);
    if (disposition.retry) message.retry({ delaySeconds: disposition.delaySeconds });
    else message.ack();
  } catch (error) {
    console.error(
      JSON.stringify({
        message: 'provider execution failed before outcome classification',
        profileId: leased.profile_id,
        accountId: leased.account_id,
        commandId: leased.command_id,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    const disposition = await applyProviderResult(
      env,
      leased,
      { outcome: 'retryable', errorCode: 'provider_transport_error' },
      now,
    );
    message.retry({ delaySeconds: disposition.delaySeconds });
  }
}

async function redispatchCommands(env: Env, now: string): Promise<void> {
  const due = await env.DB.prepare(
    `SELECT profile_id, account_id, command_id
       FROM mail_commands
      WHERE (
          dispatch_pending = 1
          AND state IN ('accepted', 'retryable')
          AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
        )
        OR (state = 'leased' AND lease_expires_at <= ?)
      ORDER BY updated_at
      LIMIT 50`,
  )
    .bind(now, now)
    .all<{
      profile_id: string;
      account_id: string;
      command_id: string;
    }>();
  if (due.results.length === 0) return;
  await env.COMMAND_QUEUE.sendBatch(
    due.results.map(row => ({
      body: {
        kind: 'command',
        profileId: row.profile_id,
        accountId: row.account_id,
        commandId: row.command_id,
      } satisfies CommandQueueMessage,
      contentType: 'json' as const,
    })),
  );
  for (const row of due.results) {
    await env.DB.prepare(
      `UPDATE mail_commands SET dispatch_pending = 0, updated_at = ?
        WHERE profile_id = ? AND command_id = ?`,
    )
      .bind(now, row.profile_id, row.command_id)
      .run();
  }
}

function isCommandQueueMessage(value: unknown): value is CommandQueueMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Readonly<Record<string, unknown>>;
  return (
    candidate.kind === 'command' &&
    isSafeMailIdentifier(candidate.profileId) &&
    isSafeMailIdentifier(candidate.accountId) &&
    isSafeMailIdentifier(candidate.commandId)
  );
}

async function providerEventRow(
  env: Env,
  message: SyncQueueMessage,
): Promise<ProviderEventRow | null> {
  return env.DB.prepare(
    `SELECT profile_id, account_id, event_id, state, attempts
       FROM provider_events
      WHERE profile_id = ? AND account_id = ? AND event_id = ?`,
  )
    .bind(message.profileId, message.accountId, message.eventId)
    .first<ProviderEventRow>();
}

async function processSyncMessage(
  message: Message<SyncQueueMessage>,
  env: Env,
  syncMailbox: (
    env: Env,
    request: MailboxSyncRequest,
    now: Date,
  ) => Promise<void>,
  now: Date,
): Promise<void> {
  const existing = await providerEventRow(env, message.body);
  if (!existing) {
    message.ack();
    return;
  }
  if (existing.state === 'applied' || existing.state === 'dead_letter') {
    message.ack();
    return;
  }
  const timestamp = now.toISOString();
  const leaseToken = crypto.randomUUID();
  const leaseExpiresAt = new Date(now.getTime() + 60_000).toISOString();
  const claimed = await env.DB.prepare(
    `UPDATE provider_events
        SET state = 'processing', lease_token = ?, lease_expires_at = ?,
            attempts = attempts + 1, dispatch_pending = 0, updated_at = ?
      WHERE profile_id = ? AND account_id = ? AND event_id = ?
        AND (
          (state IN ('received', 'retryable')
            AND (next_attempt_at IS NULL OR next_attempt_at <= ?))
          OR (state = 'processing' AND lease_expires_at <= ?)
        )`,
  )
    .bind(
      leaseToken,
      leaseExpiresAt,
      timestamp,
      existing.profile_id,
      existing.account_id,
      existing.event_id,
      timestamp,
      timestamp,
    )
    .run();
  if (Number(claimed.meta.changes ?? 0) !== 1) {
    message.retry({ delaySeconds: 5 });
    return;
  }
  const leased = await providerEventRow(env, message.body);
  if (!leased) {
    message.retry({ delaySeconds: 5 });
    return;
  }
  try {
    await syncMailbox(env, message.body, now);
    const account = await env.DB.prepare(
      `SELECT newest_history_id FROM google_accounts
        WHERE profile_id = ? AND account_id = ?`,
    )
      .bind(leased.profile_id, leased.account_id)
      .first<{ newest_history_id: string | null }>();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE provider_events
          SET state = 'applied', resulting_history_id = ?, error_code = NULL,
              lease_token = NULL, lease_expires_at = NULL,
              dispatch_pending = 0, updated_at = ?
        WHERE profile_id = ? AND account_id = ? AND event_id = ?
          AND lease_token = ?`,
      ).bind(
        account?.newest_history_id ?? null,
        timestamp,
        leased.profile_id,
        leased.account_id,
        leased.event_id,
        leaseToken,
      ),
      auditStatement(
        env,
        leased.profile_id,
        leased.account_id,
        'sync.applied',
        leased.event_id,
        'applied',
        timestamp,
      ),
    ]);
    message.ack();
  } catch (error) {
    const retryable =
      !(error instanceof GoogleApiError) ||
      error.code === 'google_transport_error' ||
      error.code === 'google_temporarily_unavailable';
    const exhausted = leased.attempts >= 5;
    const willRetry = retryable && !exhausted;
    const errorCode = error instanceof GoogleApiError ? error.code : 'sync_failed';
    const delaySeconds = Math.min(300, 2 ** Math.min(8, leased.attempts + 4));
    const nextAttemptAt = new Date(now.getTime() + delaySeconds * 1_000).toISOString();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE google_accounts
          SET coverage_state = ?, unresolved_failures = unresolved_failures + 1,
              updated_at = ?
        WHERE profile_id = ? AND account_id = ?`,
      ).bind(
        error instanceof GoogleApiError && error.code === 'google_reauthorization_required'
          ? 'blocked'
          : 'stale',
        timestamp,
        leased.profile_id,
        leased.account_id,
      ),
      env.DB.prepare(
        `UPDATE provider_events
          SET state = ?, error_code = ?, lease_token = NULL,
              lease_expires_at = NULL, dispatch_pending = ?,
              next_attempt_at = ?, updated_at = ?
        WHERE profile_id = ? AND account_id = ? AND event_id = ?
          AND lease_token = ?`,
      ).bind(
        willRetry ? 'retryable' : 'dead_letter',
        errorCode,
        willRetry ? 1 : 0,
        willRetry ? nextAttemptAt : null,
        timestamp,
        leased.profile_id,
        leased.account_id,
        leased.event_id,
        leaseToken,
      ),
      auditStatement(
        env,
        leased.profile_id,
        leased.account_id,
        willRetry ? 'sync.retryable' : 'sync.dead_letter',
        leased.event_id,
        willRetry ? 'retryable' : 'dead_letter',
        timestamp,
      ),
    ]);
    console.error(JSON.stringify({
      message: 'mailbox synchronization failed',
      profileId: leased.profile_id,
      accountId: leased.account_id,
      eventId: leased.event_id,
      code: errorCode,
      willRetry,
    }));
    if (willRetry) message.retry({ delaySeconds });
    else message.ack();
  }
}

export function createTapEmailCoordinator(
  dependencies: CoordinatorDependencies = {},
) {
  const verifyAccess = dependencies.verifyAccess ?? verifyPlatformSession;
  const now = dependencies.now ?? (() => new Date());

  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      let cors: HeadersInit = {};
      try {
        cors = corsHeaders(request, env);
        const url = new URL(request.url);
        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        if (request.method === 'GET' && url.pathname === '/health') {
          return json({ ok: true, service: 'tap-email-coordinator' }, 200, cors);
        }
        if (request.method === 'GET' && url.pathname === '/ready') {
          const readiness = await coordinatorReadiness(env);
          if (!readiness.ready) {
            console.error(JSON.stringify({
              message: 'coordinator readiness check failed',
              issueCodes: readiness.issueCodes,
            }));
          }
          return json({
            ok: readiness.ready,
            service: 'tap-email-coordinator',
            checks: {
              configuration: readiness.configuration,
              database: readiness.database,
            },
          }, readiness.ready ? 200 : 503, cors);
        }
        if (request.method === 'GET' && url.pathname === '/v1/oauth/google/callback') {
          return await finishGoogleOAuth(request, env, now());
        }
        const identity = await verifyAccess(request, env);
        if (request.method === 'POST' && url.pathname === '/v1/accounts/google/connect') {
          return json(await beginGoogleOAuth(env, identity, now()), 200, cors);
        }
        if (request.method === 'GET' && url.pathname === '/v1/mailbox') {
          return json({ mailbox: await mailboxSnapshot(env, identity.profileId) }, 200, cors);
        }
        const syncMatch = /^\/v1\/accounts\/([^/]+)\/sync$/u.exec(url.pathname);
        if (request.method === 'POST' && syncMatch?.[1]) {
          const accountId = decodeURIComponent(syncMatch[1]);
          if (!isSafeMailIdentifier(accountId)) {
            throw new ApiError(400, 'invalid_account', 'The Google account ID is invalid.');
          }
          const queued = await requestAccountSync(env, identity.profileId, accountId, now());
          return json({ queued }, queued ? 202 : 200, cors);
        }
        const threadMatch = /^\/v1\/accounts\/([^/]+)\/threads\/([^/]+)$/u.exec(url.pathname);
        if (request.method === 'GET' && threadMatch?.[1] && threadMatch[2]) {
          const accountId = decodeURIComponent(threadMatch[1]);
          const threadId = decodeURIComponent(threadMatch[2]);
          if (!isSafeMailIdentifier(accountId) || !isSafeMailIdentifier(threadId)) {
            throw new ApiError(400, 'invalid_thread', 'The Gmail thread identity is invalid.');
          }
          const snapshot = await threadSnapshot(env, identity.profileId, accountId, threadId);
          if (!snapshot) throw new ApiError(404, 'thread_not_found', 'The Gmail thread was not found.');
          return json({ thread: snapshot }, 200, cors);
        }
        if (request.method === 'POST' && url.pathname === '/v1/commands') {
          const response = await submitCommand(request, env, identity, now().toISOString());
          const headers = new Headers(response.headers);
          for (const [key, value] of Object.entries(cors)) headers.set(key, String(value));
          return new Response(response.body, { status: response.status, headers });
        }
        if (request.method === 'GET' && url.pathname === '/v1/accounts/coverage') {
          const response = await listCoverage(env, identity);
          const headers = new Headers(response.headers);
          for (const [key, value] of Object.entries(cors)) headers.set(key, String(value));
          return new Response(response.body, { status: response.status, headers });
        }
        const commandMatch = /^\/v1\/commands\/([^/]+)$/u.exec(url.pathname);
        if (request.method === 'GET' && commandMatch?.[1]) {
          const row = await commandRow(env, identity, decodeURIComponent(commandMatch[1]));
          if (!row) throw new ApiError(404, 'command_not_found', 'Command was not found.');
          return json({ receipt: receipt(row) }, 200, cors);
        }
        throw new ApiError(404, 'not_found', 'Route not found.');
      } catch (error) {
        const mapped =
          error instanceof ApiError ||
          error instanceof AccessError ||
          error instanceof GoogleOAuthError ||
          error instanceof GoogleApiError
            ? error
            : new ApiError(500, 'internal_error', 'The coordinator could not complete the request.');
        if (
          !(error instanceof ApiError) &&
          !(error instanceof AccessError) &&
          !(error instanceof GoogleOAuthError) &&
          !(error instanceof GoogleApiError)
        ) {
          console.error(
            JSON.stringify({
              message: 'request failed',
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        }
        return json({ error: mapped.code, message: mapped.message }, mapped.status, cors);
      }
    },
    async queue(
      batch: MessageBatch<CoordinatorQueueMessage>,
      env: Env,
    ): Promise<void> {
      for (const message of batch.messages) {
        if (isSyncQueueMessage(message.body)) {
          await processSyncMessage(
            message as Message<SyncQueueMessage>,
            env,
            dependencies.syncMailbox ?? syncGoogleMailbox,
            now(),
          );
        } else if (isCommandQueueMessage(message.body)) {
          const provider = dependencies.provider ?? createGoogleProvider(env, now);
          await processQueueMessage(
            message as Message<CommandQueueMessage>,
            env,
            provider,
            now().toISOString(),
          );
        } else {
          console.error(JSON.stringify({ message: 'invalid coordinator queue message discarded' }));
          message.ack();
        }
      }
    },
    async scheduled(
      _controller: ScheduledController,
      env: Env,
    ): Promise<void> {
      const current = now();
      await Promise.all([
        redispatchCommands(env, current.toISOString()),
        redispatchSyncEvents(env, current),
        markDueReminders(env, current.toISOString()),
        enqueueScheduledSyncs(env, current),
        env.DB.prepare('DELETE FROM google_oauth_states WHERE expires_at <= ?')
          .bind(current.toISOString())
          .run(),
      ]);
    },
  } satisfies ExportedHandler<Env, CoordinatorQueueMessage>;
}

export default createTapEmailCoordinator();
