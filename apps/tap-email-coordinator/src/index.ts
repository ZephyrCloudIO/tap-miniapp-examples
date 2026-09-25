import {
  isCancelScheduledSendPayload,
  isMailDraftPayload,
  isMailSchedulePayload,
  isSafeMailIdentifier,
  isMailCommand,
  type MailCommand,
  type MailDraftPayload,
  type MailCommandReceipt,
  type MailCommandState,
  type ScheduledSendState,
  type ScheduledSendSummary,
} from '@tap-examples/tap-email-protocol';
import {
  AccessError,
  verifyPlatformSession,
  type AccessVerifier,
  type ProfileIdentity,
  type TapEmailAction,
} from './auth';
import {
  type GoogleProviderPort,
  type ProviderExecutionResult,
  type ProviderScope,
} from './provider';
import { createGoogleProvider, GoogleApiError } from './google';
import {
  attachmentContent,
  AttachmentContentError,
  enqueueScheduledSyncs,
  executeTapOwnedCommand,
  freshGoogleThreadHasExternalReplyAfter,
  MailboxPageError,
  mailboxPage,
  markDueReminders,
  requestAccountSync,
  storedMessageRichBody,
  syncGoogleMailbox,
  threadSnapshot,
  ThreadPageError,
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
import {
  bindSenderProfile,
  referralPublisher,
  senderAttributionStatement,
  assertSenderAttribution,
  copyScheduledAttribution,
  referralForSend,
  verifySenderContext,
  type SenderVerifier,
  type WebsiteReferralPublisher,
} from './sender-attribution';
import {
  proxyRemoteImages,
  remoteImageUrlsAllowedByHtml,
  remoteImageUrlsFromRequest,
  RemoteImageProxyError,
  type RemoteImageBatchLoader,
} from './remote-images';
import {
  completeOutboundAttachmentStage,
  createOutboundAttachmentStage,
  decodeOutboundAttachmentChunk,
  deleteExpiredOutboundAttachments,
  OutboundAttachmentError,
  uploadOutboundAttachmentChunk,
  type CreateOutboundAttachmentStageInput,
} from './outbound-attachments';
import {
  openBoundSecret,
  openSecret,
  sealBoundSecret,
} from './crypto';

// The protocol permits 500,000 JavaScript code units plus bounded addressing
// and attachment descriptors. Four MiB leaves room for multibyte JSON text and
// escaping while keeping request buffering explicitly bounded.
const maxCommandBytes = 4 * 1_024 * 1_024;
// Every Google request is bounded to 15 seconds. Five minutes covers the
// bounded reconciliation/write sequence while still permitting crash recovery.
const providerMutationLeaseMilliseconds = 5 * 60 * 1_000;
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
  readonly payload_ciphertext: string | null;
  readonly state: MailCommandState;
  readonly dispatch_pending: number;
  readonly attempts: number;
  readonly client_created_at: string;
  readonly created_at: string;
  readonly provider_acknowledged_at: string | null;
  readonly error_code: string | null;
}

interface CoordinatorDependencies {
  readonly verifyAccess?: AccessVerifier;
  readonly provider?: GoogleProviderPort;
  readonly verifySender?: SenderVerifier;
  readonly referralPublisher?: WebsiteReferralPublisher;
  readonly loadRemoteImages?: RemoteImageBatchLoader;
  readonly syncMailbox?: (
    env: Env,
    request: MailboxSyncRequest,
    now: Date,
  ) => Promise<void>;
  readonly checkFreshReply?: (
    env: Env,
    profileId: string,
    accountId: string,
    threadId: string,
    after: string,
    now: Date,
  ) => Promise<boolean>;
  readonly now?: () => Date;
}

interface ProviderEventRow {
  readonly profile_id: string;
  readonly account_id: string;
  readonly event_id: string;
  readonly state: 'received' | 'processing' | 'applied' | 'retryable' | 'dead_letter';
  readonly attempts: number;
}

// A Queue consumer invocation can run for at most 15 minutes. Keep the durable
// event lease beyond that ceiling so an at-least-once duplicate cannot take
// over while the original invocation can still mutate the mailbox.
const syncEventLeaseMilliseconds = 16 * 60_000;

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

function contentDisposition(
  disposition: 'attachment' | 'inline',
  fileName: string,
): string {
  const safeName = Array.from(fileName.normalize('NFC'), character => {
    const codePoint = character.codePointAt(0)!;
    if (
      codePoint === 0x061c ||
      codePoint === 0x200e ||
      codePoint === 0x200f ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069)
    ) {
      return '';
    }
    if ((codePoint >= 0 && codePoint <= 0x1f) || (codePoint >= 0x7f && codePoint <= 0x9f)) {
      return '_';
    }
    return codePoint >= 0xd800 && codePoint <= 0xdfff ? '\ufffd' : character;
  }).join('') || 'attachment';
  const asciiName = safeName
    .replace(/[^\x20-\x7E]/gu, '_')
    .replace(/["\\]/gu, '_')
    .slice(0, 180) || 'attachment';
  const encodedName = encodeURIComponent(safeName)
    .replaceAll("'", '%27')
    .replaceAll('(', '%28')
    .replaceAll(')', '%29')
    .replaceAll('*', '%2A');
  return `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodedName}`;
}

function decodedAttachmentSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new ApiError(400, 'invalid_attachment', 'The attachment identity is invalid.');
  }
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

async function readBoundedJson(
  request: Request,
  maximumBytes = maxCommandBytes,
): Promise<unknown> {
  if (!request.headers.get('Content-Type')?.toLowerCase().includes('application/json')) {
    throw new ApiError(415, 'unsupported_media_type', 'Use application/json.');
  }
  const declared = Number(request.headers.get('Content-Length') ?? '0');
  if (Number.isFinite(declared) && declared > maximumBytes) {
    throw new ApiError(413, 'request_too_large', 'The request is too large.');
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
    if (size > maximumBytes) {
      await reader.cancel('command too large');
      throw new ApiError(413, 'request_too_large', 'The request is too large.');
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  try {
    return JSON.parse(text + decoder.decode());
  } catch {
    throw new ApiError(400, 'invalid_json', 'The command body is not valid JSON.');
  }
}

function outboundAttachmentStageInput(value: unknown): CreateOutboundAttachmentStageInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(400, 'invalid_attachment_stage', 'The attachment stage metadata is invalid.');
  }
  const input = value as Readonly<Record<string, unknown>>;
  return {
    idempotencyKey: typeof input.idempotencyKey === 'string' ? input.idempotencyKey : '',
    fileName: typeof input.fileName === 'string' ? input.fileName : '',
    mimeType: typeof input.mimeType === 'string' ? input.mimeType : '',
    sizeBytes: typeof input.sizeBytes === 'number' ? input.sizeBytes : Number.NaN,
    sha256Base64Url: typeof input.sha256Base64Url === 'string'
      ? input.sha256Base64Url
      : '',
  };
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

async function openStoredPayload(
  env: Env,
  ciphertext: string | null,
  legacyJson: string,
  binding: StoredPayloadBinding,
): Promise<unknown> {
  const serialized = ciphertext
    ? ciphertext.startsWith('v2.')
      ? await openBoundSecret(
        ciphertext,
        env.GOOGLE_TOKEN_ENCRYPTION_KEY,
        storedPayloadAssociatedData(binding),
      )
      : await openSecret(ciphertext, env.GOOGLE_TOKEN_ENCRYPTION_KEY)
    : legacyJson;
  return JSON.parse(serialized);
}

interface StoredPayloadBinding {
  readonly table: 'mail_commands' | 'scheduled_sends';
  readonly profileId: string;
  readonly accountId: string;
  readonly id: string;
  readonly kind: string;
}

function storedPayloadAssociatedData(binding: StoredPayloadBinding): string {
  return [
    'tap-email-outbound-payload-v2',
    binding.table,
    binding.profileId,
    binding.accountId,
    binding.id,
    binding.kind,
  ].join('\u0000');
}

function commandPayloadBinding(row: Pick<
  CommandRow,
  'profile_id' | 'account_id' | 'command_id' | 'kind'
>): StoredPayloadBinding {
  return {
    table: 'mail_commands',
    profileId: row.profile_id,
    accountId: row.account_id,
    id: row.command_id,
    kind: row.kind,
  };
}

function schedulePayloadBinding(
  profileId: string,
  accountId: string,
  scheduleCommandId: string,
): StoredPayloadBinding {
  return {
    table: 'scheduled_sends',
    profileId,
    accountId,
    id: scheduleCommandId,
    kind: 'scheduled_send',
  };
}

function storedPayloadNeedsReseal(ciphertext: string | null, legacyJson: string): boolean {
  return (ciphertext !== null && !ciphertext.startsWith('v2.')) ||
    (ciphertext === null && legacyJson !== '{}');
}

async function sealStoredPayload(
  env: Env,
  value: unknown,
  binding: StoredPayloadBinding,
): Promise<string> {
  return sealBoundSecret(
    JSON.stringify(value),
    env.GOOGLE_TOKEN_ENCRYPTION_KEY,
    storedPayloadAssociatedData(binding),
  );
}

async function decodeCommand(env: Env, row: CommandRow): Promise<MailCommand> {
  let payload: unknown;
  try {
    payload = await openStoredPayload(
      env,
      row.payload_ciphertext,
      row.payload_json,
      commandPayloadBinding(row),
    );
  } catch {
    throw new ApiError(500, 'stored_command_invalid', 'Stored command validation failed.');
  }
  const value: unknown = {
    v: 1,
    commandId: row.command_id,
    idempotencyKey: row.idempotency_key,
    accountId: row.account_id,
    threadId: row.thread_id,
    kind: row.kind,
    createdAt: row.client_created_at,
    expectedProviderRevision: row.expected_provider_revision,
    payload,
  };
  if (!isMailCommand(value)) {
    throw new ApiError(500, 'stored_command_invalid', 'Stored command validation failed.');
  }
  if (storedPayloadNeedsReseal(row.payload_ciphertext, row.payload_json)) {
    const ciphertext = await sealStoredPayload(env, payload, commandPayloadBinding(row));
    await env.DB.prepare(
    `UPDATE mail_commands
          SET payload_ciphertext = ?, payload_json = '{}'
        WHERE profile_id = ? AND command_id = ?
          AND COALESCE(payload_ciphertext, '') = COALESCE(?, '')
          AND payload_json = ?`,
    ).bind(
      ciphertext,
      row.profile_id,
      row.command_id,
      row.payload_ciphertext,
      row.payload_json,
    ).run();
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
            thread_id, expected_provider_revision, payload_json, payload_ciphertext, state,
            dispatch_pending, attempts, client_created_at, created_at,
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
            thread_id, expected_provider_revision, payload_json, payload_ciphertext, state,
            dispatch_pending, attempts, client_created_at, created_at,
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

function fencedAuditStatement(
  env: Env,
  row: CommandRow,
  leaseToken: string,
  outcome: MailCommandState,
  operation: string,
  now: string,
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO coordinator_audit
       (audit_id, profile_id, account_id, operation, object_id, outcome, occurred_at)
     SELECT ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM mail_commands
         WHERE profile_id = ? AND command_id = ?
           AND state = ? AND lease_token = ?
      )`,
  ).bind(
    crypto.randomUUID(),
    row.profile_id,
    row.account_id,
    operation,
    row.command_id,
    outcome,
    now,
    row.profile_id,
    row.command_id,
    outcome,
    leaseToken,
  );
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
  verifySender: SenderVerifier,
): Promise<Response> {
  const value = await readBoundedJson(request);
  if (!isMailCommand(value)) {
    throw new ApiError(400, 'invalid_command', 'The mail command is malformed.');
  }
  const command = value;
  if (
    command.kind === 'send_draft' &&
    isMailDraftPayload(command.payload) &&
    command.payload.sendAfter !== undefined &&
    Date.parse(command.payload.sendAfter) > Date.parse(now)
  ) {
    throw new ApiError(
      409,
      'send_not_ready',
      'This undo-send window has not expired yet.',
    );
  }
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

  const expected = isMailDraftPayload(command.payload) ? command.payload.expectedContext : undefined;
  const sender = expected ? await verifySender(request, env, identity, expected) : null;
  if (sender) await bindSenderProfile(env, identity, sender, now);
  // New sends must carry their captured identity; accepted legacy commands can
  // still reconcile under their original durable intent.
  const developmentIdentity = env.ALLOW_DEV_IDENTITY === 'true' && !env.TAP_INTROSPECTION_URL;
  if ((command.kind === 'send_draft' || command.kind === 'schedule_send') && !expected && !developmentIdentity) {
    throw new ApiError(400, 'sender_context_required', 'Update TAP Email and send from an active workspace.');
  }

  const payloadJson = JSON.stringify(command.payload);
  const payloadCiphertext = await sealStoredPayload(env, command.payload, {
    table: 'mail_commands',
    profileId: identity.profileId,
    accountId: command.accountId,
    id: command.commandId,
    kind: command.kind,
  });
  const insertCommand = env.DB.prepare(
    `INSERT OR IGNORE INTO mail_commands
       (profile_id, account_id, command_id, idempotency_key, kind, thread_id,
        expected_provider_revision, payload_json, payload_ciphertext, state, dispatch_pending,
        client_created_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, '{}', ?, 'accepted', 1, ?, ?, ?)`,
  )
    .bind(
      identity.profileId,
      command.accountId,
      command.commandId,
      command.idempotencyKey,
      command.kind,
      command.threadId,
      command.expectedProviderRevision,
      payloadCiphertext,
      command.createdAt,
      now,
      now,
    );
  // Queue scanners must never observe an accepted command without its verified
  // attribution. Match the new ciphertext so a conflicting replay cannot bind
  // attribution to a previously accepted command.
  const [result] = await env.DB.batch([
    insertCommand,
    ...(sender ? [senderAttributionStatement(env, identity, command.commandId, sender, now, payloadCiphertext)] : []),
  ]);
  const stored =
    (await commandRow(env, identity, command.commandId)) ??
    (await commandRowByIdempotencyKey(env, identity, command.idempotencyKey));
  if (!stored) throw new ApiError(500, 'command_store_failed', 'Command was not stored.');

  const inserted = Number(result?.meta.changes ?? 0) === 1;
  let storedPayloadJson = '';
  try {
    storedPayloadJson = JSON.stringify(await openStoredPayload(
      env,
      stored.payload_ciphertext,
      stored.payload_json,
      commandPayloadBinding(stored),
    ));
  } catch {
    throw new ApiError(500, 'stored_command_invalid', 'Stored command validation failed.');
  }
  if (
    !inserted &&
    (stored.command_id !== command.commandId ||
      stored.idempotency_key !== command.idempotencyKey ||
      stored.account_id !== command.accountId ||
      stored.kind !== command.kind ||
      stored.thread_id !== command.threadId ||
      stored.expected_provider_revision !== command.expectedProviderRevision ||
      stored.client_created_at !== command.createdAt ||
      storedPayloadJson !== payloadJson)
  ) {
    throw new ApiError(
      409,
      'idempotency_conflict',
      'The command identity is already bound to different intent.',
    );
  }
  if (sender) await assertSenderAttribution(env, identity, command.commandId, sender);
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
  }
  if (inserted || (stored.state === 'accepted' && stored.dispatch_pending === 1)) {
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

async function listScheduledSends(
  env: Env,
  identity: ProfileIdentity,
): Promise<readonly ScheduledSendSummary[]> {
  const rows = await env.DB.prepare(
    `SELECT account_id, schedule_command_id, thread_id, draft_key,
            draft_payload_json, draft_payload_ciphertext,
            due_at, cancel_if_reply, state, dispatch_command_id, error_code
       FROM scheduled_sends
      WHERE profile_id = ? AND state IN ('pending', 'enqueued', 'failed', 'uncertain')
      ORDER BY due_at, schedule_command_id
      LIMIT 500`,
  )
    .bind(identity.profileId)
    .all<{
      account_id: string;
      schedule_command_id: string;
      thread_id: string | null;
      draft_key: string;
      draft_payload_json: string;
      draft_payload_ciphertext: string | null;
      due_at: string;
      cancel_if_reply: number;
      state: ScheduledSendState;
      dispatch_command_id: string | null;
      error_code: string | null;
    }>();
  return Promise.all(rows.results.map(async row => {
    let payload: unknown;
    try {
      payload = await openStoredPayload(
        env,
        row.draft_payload_ciphertext,
        row.draft_payload_json,
        schedulePayloadBinding(
          identity.profileId,
          row.account_id,
          row.schedule_command_id,
        ),
      );
    } catch {
      throw new ApiError(500, 'stored_schedule_invalid', 'Stored schedule validation failed.');
    }
    if (!isMailDraftPayload(payload)) {
      throw new ApiError(500, 'stored_schedule_invalid', 'Stored schedule validation failed.');
    }
    if (storedPayloadNeedsReseal(row.draft_payload_ciphertext, row.draft_payload_json)) {
      const ciphertext = await sealStoredPayload(
        env,
        payload,
        schedulePayloadBinding(
          identity.profileId,
          row.account_id,
          row.schedule_command_id,
        ),
      );
      await env.DB.prepare(
        `UPDATE scheduled_sends
            SET draft_payload_ciphertext = ?, draft_payload_json = '{}'
          WHERE profile_id = ? AND schedule_command_id = ?
            AND COALESCE(draft_payload_ciphertext, '') = COALESCE(?, '')
            AND draft_payload_json = ?`,
      ).bind(
        ciphertext,
        identity.profileId,
        row.schedule_command_id,
        row.draft_payload_ciphertext,
        row.draft_payload_json,
      ).run();
    }
    return {
      scheduleCommandId: row.schedule_command_id,
      accountId: row.account_id,
      threadId: row.thread_id,
      draftKey: row.draft_key,
      to: payload.to,
      subject: payload.subject,
      dueAt: row.due_at,
      cancelIfReply: row.cancel_if_reply === 1,
      state: row.state,
      dispatchCommandId: row.dispatch_command_id,
      errorCode: row.error_code,
    };
  }));
}

function acknowledgedThreadStateProjection(
  env: Env,
  row: CommandRow,
  providerRevision: string | null,
  now: string,
  leaseToken: string,
): D1PreparedStatement | null {
  // Gmail applies thread label mutations synchronously. Mirror the acknowledged
  // state now; the scheduled history sync remains the eventual reconciliation.
  if (!row.thread_id) return null;
  if (row.kind === 'archive') {
    return env.DB.prepare(
      `UPDATE mail_threads
          SET in_inbox = 0,
              needs_response = 0,
              waiting_on_others = 0,
              label_ids_json = (
                SELECT json_group_array(label.value)
                  FROM json_each(mail_threads.label_ids_json) AS label
                 WHERE label.value != 'INBOX'
              ),
              history_id = COALESCE(?, history_id), updated_at = ?
        WHERE profile_id = ? AND account_id = ? AND thread_id = ?
          AND EXISTS (
            SELECT 1 FROM mail_commands result_command
             WHERE result_command.profile_id = ?
               AND result_command.command_id = ?
               AND result_command.state = 'applied'
               AND result_command.lease_token = ?
          )`,
    ).bind(
      providerRevision,
      now,
      row.profile_id,
      row.account_id,
      row.thread_id,
      row.profile_id,
      row.command_id,
      leaseToken,
    );
  }
  if (row.kind === 'mark_read') {
    return env.DB.prepare(
      `UPDATE mail_threads
          SET unread = 0,
              label_ids_json = (
                SELECT json_group_array(label.value)
                  FROM json_each(mail_threads.label_ids_json) AS label
                 WHERE label.value != 'UNREAD'
              ),
              history_id = COALESCE(?, history_id), updated_at = ?
        WHERE profile_id = ? AND account_id = ? AND thread_id = ?
          AND EXISTS (
            SELECT 1 FROM mail_commands result_command
             WHERE result_command.profile_id = ?
               AND result_command.command_id = ?
               AND result_command.state = 'applied'
               AND result_command.lease_token = ?
          )`,
    ).bind(
      providerRevision,
      now,
      row.profile_id,
      row.account_id,
      row.thread_id,
      row.profile_id,
      row.command_id,
      leaseToken,
    );
  }
  if (row.kind === 'mark_unread') {
    return env.DB.prepare(
      `UPDATE mail_threads
          SET unread = 1,
              label_ids_json = CASE
                WHEN EXISTS (
                  SELECT 1 FROM json_each(mail_threads.label_ids_json)
                   WHERE value = 'UNREAD'
                ) THEN label_ids_json
                ELSE json_insert(label_ids_json, '$[#]', 'UNREAD')
              END,
              history_id = COALESCE(?, history_id), updated_at = ?
        WHERE profile_id = ? AND account_id = ? AND thread_id = ?
          AND EXISTS (
            SELECT 1 FROM mail_commands result_command
             WHERE result_command.profile_id = ?
               AND result_command.command_id = ?
               AND result_command.state = 'applied'
               AND result_command.lease_token = ?
          )`,
    ).bind(
      providerRevision,
      now,
      row.profile_id,
      row.account_id,
      row.thread_id,
      row.profile_id,
      row.command_id,
      leaseToken,
    );
  }
  return null;
}

async function applyProviderResult(
  env: Env,
  row: CommandRow,
  result: ProviderExecutionResult,
  now: string,
  leaseToken: string,
): Promise<{ retry: boolean; delaySeconds: number; leaseApplied: boolean }> {
  if (result.outcome === 'acknowledged') {
    const statements = [
      env.DB.prepare(
        `UPDATE mail_commands
            SET state = 'applied', provider_acknowledged_at = ?,
                provider_revision = ?, error_code = NULL,
                lease_expires_at = NULL, dispatch_pending = 0, updated_at = ?
          WHERE profile_id = ? AND command_id = ?
            AND state = 'leased' AND lease_token = ?`,
      ).bind(
        now,
        result.providerRevision,
        now,
        row.profile_id,
        row.command_id,
        leaseToken,
      ),
    ];
    if (row.kind === 'schedule_send') {
      let payload: unknown;
      try {
        payload = await openStoredPayload(
          env,
          row.payload_ciphertext,
          row.payload_json,
          commandPayloadBinding(row),
        );
      } catch {
        throw new ApiError(500, 'stored_schedule_invalid', 'Stored schedule validation failed.');
      }
      if (!isMailSchedulePayload(payload)) {
        throw new ApiError(500, 'stored_schedule_invalid', 'Stored schedule validation failed.');
      }
      const draftPayload: MailDraftPayload = {
        draftKey: payload.draftKey,
        draftRevision: payload.draftRevision,
        to: payload.to,
        ...(payload.cc === undefined ? {} : { cc: payload.cc }),
        ...(payload.bcc === undefined ? {} : { bcc: payload.bcc }),
        subject: payload.subject,
        bodyText: payload.bodyText,
        ...(payload.expectedContext ? { expectedContext: payload.expectedContext } : {}),
        ...(payload.replyToMessageId === undefined
          ? {}
          : { replyToMessageId: payload.replyToMessageId }),
        ...(payload.attachments === undefined
          ? {}
          : { attachments: payload.attachments }),
      };
      const draftPayloadCiphertext = await sealStoredPayload(
        env,
        draftPayload,
        schedulePayloadBinding(row.profile_id, row.account_id, row.command_id),
      );
      statements.push(env.DB.prepare(
        `INSERT INTO scheduled_sends
           (profile_id, account_id, schedule_command_id, thread_id, draft_key,
            draft_payload_json, draft_payload_ciphertext, due_at, cancel_if_reply,
            state, created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, '{}', ?, ?, ?, 'pending', ?, ?
          WHERE EXISTS (
            SELECT 1 FROM mail_commands
             WHERE profile_id = ? AND command_id = ?
               AND state = 'applied' AND lease_token = ?
          )
         ON CONFLICT(profile_id, schedule_command_id) DO UPDATE SET
           updated_at = excluded.updated_at`,
      ).bind(
        row.profile_id,
        row.account_id,
        row.command_id,
        row.thread_id,
        payload.draftKey,
        draftPayloadCiphertext,
        payload.scheduledFor,
        payload.cancelIfReply ? 1 : 0,
        now,
        now,
        row.profile_id,
        row.command_id,
        leaseToken,
      ));
    }
    if (row.kind === 'send_draft') {
      statements.push(env.DB.prepare(
        `UPDATE scheduled_sends
            SET state = 'sent', error_code = NULL, updated_at = ?
          WHERE profile_id = ? AND dispatch_command_id = ? AND state = 'enqueued'
            AND EXISTS (
              SELECT 1 FROM mail_commands
               WHERE profile_id = ? AND command_id = ?
                 AND state = 'applied' AND lease_token = ?
            )`,
      ).bind(
        now,
        row.profile_id,
        row.command_id,
        row.profile_id,
        row.command_id,
        leaseToken,
      ));
    }
    const projection = acknowledgedThreadStateProjection(
      env,
      row,
      result.providerRevision,
      now,
      leaseToken,
    );
    if (projection) statements.push(projection);
    statements.push(fencedAuditStatement(
      env,
      row,
      leaseToken,
      'applied',
      'command.applied',
      now,
    ));
    const applied = await env.DB.batch(statements);
    const leaseApplied = Number(applied[0]?.meta.changes ?? 0) === 1;
    if (leaseApplied) {
      await env.DB.prepare(
        `UPDATE mail_commands SET lease_token = NULL
          WHERE profile_id = ? AND command_id = ?
            AND state = 'applied' AND lease_token = ?`,
      ).bind(row.profile_id, row.command_id, leaseToken).run();
    }
    return { retry: false, delaySeconds: 0, leaseApplied };
  }
  if (result.outcome === 'uncertain') {
    const statements = [env.DB.prepare(
      `UPDATE mail_commands
          SET state = 'uncertain', error_code = ?,
              lease_expires_at = NULL, dispatch_pending = 0, updated_at = ?
        WHERE profile_id = ? AND command_id = ?
          AND state = 'leased' AND lease_token = ?`,
    )
      .bind(result.errorCode, now, row.profile_id, row.command_id, leaseToken)];
    if (row.kind === 'send_draft') {
      statements.push(env.DB.prepare(
        `UPDATE scheduled_sends
            SET state = 'uncertain', error_code = ?, updated_at = ?
          WHERE profile_id = ? AND dispatch_command_id = ? AND state = 'enqueued'
            AND EXISTS (
              SELECT 1 FROM mail_commands
               WHERE profile_id = ? AND command_id = ?
                 AND state = 'uncertain' AND lease_token = ?
            )`,
      ).bind(
        result.errorCode,
        now,
        row.profile_id,
        row.command_id,
        row.profile_id,
        row.command_id,
        leaseToken,
      ));
    }
    const applied = await env.DB.batch(statements);
    const leaseApplied = Number(applied[0]?.meta.changes ?? 0) === 1;
    if (leaseApplied) {
      await env.DB.prepare(
        `UPDATE mail_commands SET lease_token = NULL
          WHERE profile_id = ? AND command_id = ?
            AND state = 'uncertain' AND lease_token = ?`,
      ).bind(row.profile_id, row.command_id, leaseToken).run();
    }
    return { retry: false, delaySeconds: 0, leaseApplied };
  }
  if (result.outcome === 'failed') {
    const statements = [env.DB.prepare(
      `UPDATE mail_commands
          SET state = 'failed', error_code = ?,
              lease_expires_at = NULL, dispatch_pending = 0, updated_at = ?
        WHERE profile_id = ? AND command_id = ?
          AND state = 'leased' AND lease_token = ?`,
    )
      .bind(result.errorCode, now, row.profile_id, row.command_id, leaseToken)];
    if (row.kind === 'send_draft') {
      statements.push(env.DB.prepare(
        `UPDATE scheduled_sends
            SET state = 'failed', error_code = ?, updated_at = ?
          WHERE profile_id = ? AND dispatch_command_id = ? AND state = 'enqueued'
            AND EXISTS (
              SELECT 1 FROM mail_commands
               WHERE profile_id = ? AND command_id = ?
                 AND state = 'failed' AND lease_token = ?
            )`,
      ).bind(
        result.errorCode,
        now,
        row.profile_id,
        row.command_id,
        row.profile_id,
        row.command_id,
        leaseToken,
      ));
    }
    const applied = await env.DB.batch(statements);
    const leaseApplied = Number(applied[0]?.meta.changes ?? 0) === 1;
    if (leaseApplied) {
      await env.DB.prepare(
        `UPDATE mail_commands SET lease_token = NULL
          WHERE profile_id = ? AND command_id = ?
            AND state = 'failed' AND lease_token = ?`,
      ).bind(row.profile_id, row.command_id, leaseToken).run();
    }
    return { retry: false, delaySeconds: 0, leaseApplied };
  }
  const delaySeconds = Math.min(300, 2 ** Math.min(8, row.attempts + 1));
  const nextAttempt = new Date(Date.parse(now) + delaySeconds * 1_000).toISOString();
  const retryable = await env.DB.prepare(
      `UPDATE mail_commands
        SET state = 'retryable', error_code = ?, lease_token = NULL,
            lease_expires_at = NULL, dispatch_pending = 1, next_attempt_at = ?,
            updated_at = ?
      WHERE profile_id = ? AND command_id = ?
        AND state = 'leased' AND lease_token = ?`,
  )
    .bind(
      result.errorCode,
      nextAttempt,
      now,
      row.profile_id,
      row.command_id,
      leaseToken,
    )
    .run();
  const leaseApplied = Number(retryable.meta.changes ?? 0) === 1;
  return { retry: leaseApplied, delaySeconds, leaseApplied };
}

async function executeCancelScheduledSend(
  env: Env,
  row: CommandRow,
  command: MailCommand,
  now: string,
): Promise<ProviderExecutionResult | null> {
  if (command.kind !== 'cancel_scheduled_send') return null;
  if (!isCancelScheduledSendPayload(command.payload)) {
    return { outcome: 'failed', errorCode: 'schedule_cancel_invalid' };
  }
  const scheduled = await env.DB.prepare(
    `SELECT state, dispatch_command_id
       FROM scheduled_sends
      WHERE profile_id = ? AND account_id = ? AND schedule_command_id = ?`,
  )
    .bind(row.profile_id, row.account_id, command.payload.scheduledCommandId)
    .first<{ state: string; dispatch_command_id: string | null }>();
  if (!scheduled) return { outcome: 'failed', errorCode: 'schedule_not_found' };
  if (scheduled.state === 'cancelled') {
    return { outcome: 'acknowledged', providerRevision: null };
  }
  if (scheduled.state === 'sent') {
    return { outcome: 'failed', errorCode: 'schedule_already_sent' };
  }
  if (scheduled.state === 'failed' || scheduled.state === 'uncertain') {
    return { outcome: 'failed', errorCode: `schedule_${scheduled.state}` };
  }
  if (scheduled.state === 'pending') {
    const pendingCancellation = await env.DB.prepare(
      `UPDATE scheduled_sends
          SET state = 'cancelled', error_code = 'cancelled_by_user', updated_at = ?
        WHERE profile_id = ? AND account_id = ? AND schedule_command_id = ?
          AND state = 'pending'`,
    )
      .bind(now, row.profile_id, row.account_id, command.payload.scheduledCommandId)
      .run();
    if (Number(pendingCancellation.meta.changes ?? 0) === 1) {
      return { outcome: 'acknowledged', providerRevision: null };
    }
    const raced = await env.DB.prepare(
      `SELECT state, dispatch_command_id
         FROM scheduled_sends
        WHERE profile_id = ? AND account_id = ? AND schedule_command_id = ?`,
    ).bind(
      row.profile_id,
      row.account_id,
      command.payload.scheduledCommandId,
    ).first<{ state: string; dispatch_command_id: string | null }>();
    if (raced?.state === 'cancelled') {
      return { outcome: 'acknowledged', providerRevision: null };
    }
    if (raced?.state !== 'enqueued' || !raced.dispatch_command_id) {
      return { outcome: 'uncertain', errorCode: 'schedule_cancel_raced' };
    }
    scheduled.state = raced.state;
    scheduled.dispatch_command_id = raced.dispatch_command_id;
  }
  if (!scheduled.dispatch_command_id) {
    return { outcome: 'uncertain', errorCode: 'schedule_dispatch_identity_missing' };
  }
  const cancelled = await env.DB.batch([
    env.DB.prepare(
      `UPDATE mail_commands
          SET state = 'cancelled', dispatch_pending = 0, error_code = 'cancelled_by_user',
              lease_token = NULL, lease_expires_at = NULL, updated_at = ?
        WHERE profile_id = ? AND account_id = ? AND command_id = ?
          AND state IN ('accepted', 'retryable')`,
    ).bind(now, row.profile_id, row.account_id, scheduled.dispatch_command_id),
    env.DB.prepare(
      `UPDATE scheduled_sends
          SET state = 'cancelled', error_code = 'cancelled_by_user', updated_at = ?
        WHERE profile_id = ? AND account_id = ? AND schedule_command_id = ?
          AND state = 'enqueued'
          AND EXISTS (
            SELECT 1 FROM mail_commands
             WHERE profile_id = ? AND command_id = ? AND state = 'cancelled'
          )`,
    ).bind(
      now,
      row.profile_id,
      row.account_id,
      command.payload.scheduledCommandId,
      row.profile_id,
      scheduled.dispatch_command_id,
    ),
  ]);
  if (Number(cancelled[1]?.meta.changes ?? 0) === 1) {
    return { outcome: 'acknowledged', providerRevision: null };
  }
  return { outcome: 'uncertain', errorCode: 'schedule_already_dispatching' };
}

function providerDraftMutationKey(command: MailCommand): string | null {
  if (
    command.kind !== 'save_draft' &&
    command.kind !== 'send_draft' &&
    command.kind !== 'schedule_send'
  ) {
    return null;
  }
  return isMailDraftPayload(command.payload) ? command.payload.draftKey : null;
}

async function acquireProviderDraftLease(
  env: Env,
  row: CommandRow,
  draftKey: string,
  leaseToken: string,
  now: string,
): Promise<boolean> {
  const leaseExpiresAt = new Date(
    Date.parse(now) + providerMutationLeaseMilliseconds,
  ).toISOString();
  const acquired = await env.DB.prepare(
    `INSERT INTO mail_draft_leases
       (profile_id, account_id, draft_key, lease_token, lease_expires_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(profile_id, account_id, draft_key) DO UPDATE SET
       lease_token = excluded.lease_token,
       lease_expires_at = excluded.lease_expires_at,
       updated_at = excluded.updated_at
     WHERE mail_draft_leases.lease_expires_at <= ?`,
  ).bind(
    row.profile_id,
    row.account_id,
    draftKey,
    leaseToken,
    leaseExpiresAt,
    now,
    now,
  ).run();
  return Number(acquired.meta.changes ?? 0) === 1;
}

async function releaseProviderDraftLease(
  env: Env,
  row: CommandRow,
  draftKey: string,
  leaseToken: string,
): Promise<void> {
  await env.DB.prepare(
    `DELETE FROM mail_draft_leases
      WHERE profile_id = ? AND account_id = ? AND draft_key = ? AND lease_token = ?`,
  ).bind(row.profile_id, row.account_id, draftKey, leaseToken).run();
}

async function processQueueMessage(
  message: Message<CommandQueueMessage>,
  env: Env,
  provider: GoogleProviderPort,
  now: string,
  publisher: WebsiteReferralPublisher | undefined,
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
  const leaseExpiresAt = new Date(
    Date.parse(now) + providerMutationLeaseMilliseconds,
  ).toISOString();
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
  let heldDraftKey: string | null = null;
  try {
    let scope: ProviderScope = { profileId: leased.profile_id, accountId: leased.account_id };
    const command = await decodeCommand(env, leased);
    const draftKey = providerDraftMutationKey(command);
    if (draftKey) {
      const acquired = await acquireProviderDraftLease(
        env,
        leased,
        draftKey,
        leaseToken,
        now,
      );
      if (!acquired) {
        const disposition = await applyProviderResult(
          env,
          leased,
          { outcome: 'retryable', errorCode: 'provider_draft_busy' },
          now,
          leaseToken,
        );
        if (disposition.retry) message.retry({ delaySeconds: disposition.delaySeconds });
        else message.ack();
        return;
      }
      heldDraftKey = draftKey;
    }
    if (command.kind === 'send_draft' && isMailDraftPayload(command.payload) && command.payload.expectedContext) {
      if (!publisher) throw new AccessError(503, 'referral_unavailable', 'The website referral service is unavailable.');
      scope = { ...scope, referralUrl: await referralForSend(env, publisher, leased.profile_id, leased.command_id, command.payload.expectedContext) };
    }
    const result =
      (await executeCancelScheduledSend(env, leased, command, now)) ??
      (await executeTapOwnedCommand(env, scope, command, now)) ??
      (await provider.execute(scope, command));
    const disposition = await applyProviderResult(
      env,
      leased,
      result,
      now,
      leaseToken,
    );
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
      error instanceof AccessError
        ? { outcome: error.status >= 500 ? 'retryable' : 'failed', errorCode: error.code }
        : { outcome: 'retryable', errorCode: 'provider_transport_error' },
      now,
      leaseToken,
    );
    if (disposition.retry) message.retry({ delaySeconds: disposition.delaySeconds });
    else message.ack();
  } finally {
    if (heldDraftKey) {
      await releaseProviderDraftLease(env, leased, heldDraftKey, leaseToken).catch(error => {
        console.error(JSON.stringify({
          message: 'provider draft lease release deferred',
          profileId: leased.profile_id,
          accountId: leased.account_id,
          draftKey: heldDraftKey,
          error: error instanceof Error ? error.message : String(error),
        }));
      });
    }
  }
}

async function reconcileUncertainSend(
  env: Env,
  identity: ProfileIdentity,
  commandId: string,
  provider: GoogleProviderPort,
  now: string,
  publisher: WebsiteReferralPublisher | undefined,
): Promise<MailCommandReceipt> {
  const existing = await commandRow(env, identity, commandId);
  if (!existing) {
    throw new ApiError(404, 'command_not_found', 'Command was not found.');
  }
  if (existing.kind !== 'send_draft') {
    throw new ApiError(
      409,
      'command_not_reconcilable',
      'Only a delivery-unknown send can be reconciled.',
    );
  }
  if (existing.state === 'applied' || existing.state === 'failed') {
    return receipt(existing);
  }
  if (existing.state !== 'uncertain') {
    throw new ApiError(
      409,
      'command_not_reconcilable',
      'This send does not currently have an unknown delivery outcome.',
    );
  }

  const leaseToken = `reconcile:${crypto.randomUUID()}`;
  const leaseExpiresAt = new Date(
    Date.parse(now) + providerMutationLeaseMilliseconds,
  ).toISOString();
  const claimed = await env.DB.prepare(
    `UPDATE mail_commands
        SET state = 'leased', lease_token = ?, lease_expires_at = ?,
            attempts = attempts + 1, dispatch_pending = 0, updated_at = ?
      WHERE profile_id = ? AND command_id = ?
        AND kind = 'send_draft' AND state = 'uncertain'`,
  ).bind(
    leaseToken,
    leaseExpiresAt,
    now,
    existing.profile_id,
    existing.command_id,
  ).run();
  if (Number(claimed.meta.changes ?? 0) !== 1) {
    throw new ApiError(
      409,
      'command_reconciliation_in_progress',
      'This send is already being reconciled.',
    );
  }

  const leased = await commandRow(env, identity, commandId);
  if (!leased) {
    throw new ApiError(409, 'command_reconciliation_in_progress', 'Reconciliation did not start.');
  }
  let heldDraftKey: string | null = null;
  try {
    let command: MailCommand;
    try {
      command = await decodeCommand(env, leased);
    } catch {
      await applyProviderResult(
        env,
        leased,
        { outcome: 'failed', errorCode: 'stored_command_invalid' },
        now,
        leaseToken,
      );
      const invalid = await commandRow(env, identity, commandId);
      if (!invalid) throw new ApiError(500, 'command_store_failed', 'Command was not stored.');
      return receipt(invalid);
    }
    const draftKey = providerDraftMutationKey(command);
    if (!draftKey) {
      await applyProviderResult(
        env,
        leased,
        { outcome: 'failed', errorCode: 'stored_command_invalid' },
        now,
        leaseToken,
      );
      const invalid = await commandRow(env, identity, commandId);
      if (!invalid) throw new ApiError(500, 'command_store_failed', 'Command was not stored.');
      return receipt(invalid);
    }
    const acquired = await acquireProviderDraftLease(
      env,
      leased,
      draftKey,
      leaseToken,
      now,
    );
    if (!acquired) {
      await env.DB.prepare(
        `UPDATE mail_commands
            SET state = 'uncertain', lease_token = NULL, lease_expires_at = NULL,
                error_code = 'provider_draft_busy', updated_at = ?
          WHERE profile_id = ? AND command_id = ?
            AND state = 'leased' AND lease_token = ?`,
      ).bind(now, leased.profile_id, leased.command_id, leaseToken).run();
      throw new ApiError(
        409,
        'command_reconciliation_in_progress',
        'The provider draft is currently being updated.',
      );
    }
    heldDraftKey = draftKey;
    let result: ProviderExecutionResult;
    try {
      const expected = isMailDraftPayload(command.payload) ? command.payload.expectedContext : undefined;
      if (expected && !publisher) throw new AccessError(503, 'referral_unavailable', 'The website referral service is unavailable.');
      const referralUrl = expected && publisher
        ? await referralForSend(env, publisher, leased.profile_id, leased.command_id, expected)
        : undefined;
      result = await provider.execute(
        { profileId: leased.profile_id, accountId: leased.account_id, ...(referralUrl ? { referralUrl } : {}) },
        command,
      );
    } catch {
      result = { outcome: 'uncertain', errorCode: 'reconciliation_unavailable' };
    }
    // A transient provider failure cannot prove that the original request was
    // not applied. Keep it terminal-uncertain instead of scheduling a blind
    // background retry; only another explicit managed reconciliation may run.
    if (result.outcome === 'retryable') {
      result = { outcome: 'uncertain', errorCode: result.errorCode };
    }
    await applyProviderResult(env, leased, result, now, leaseToken);
    const resolved = await commandRow(env, identity, commandId);
    if (!resolved) throw new ApiError(500, 'command_store_failed', 'Command was not stored.');
    return receipt(resolved);
  } finally {
    if (heldDraftKey) {
      await releaseProviderDraftLease(env, leased, heldDraftKey, leaseToken).catch(error => {
        console.error(JSON.stringify({
          message: 'provider draft reconciliation lease release deferred',
          profileId: leased.profile_id,
          accountId: leased.account_id,
          draftKey: heldDraftKey,
          error: error instanceof Error ? error.message : String(error),
        }));
      });
    }
  }
}

async function redispatchCommands(env: Env, now: string): Promise<void> {
  // An interrupted user-launched reconciliation must not become an automatic
  // resend. Return its expired lease to terminal-uncertain; another explicit
  // managed POST may then inspect the same immutable provider identity.
  await env.DB.prepare(
    `UPDATE mail_commands
        SET state = 'uncertain', error_code = 'reconciliation_interrupted',
            lease_token = NULL, lease_expires_at = NULL,
            dispatch_pending = 0, updated_at = ?
      WHERE state = 'leased' AND lease_expires_at <= ?
        AND lease_token LIKE 'reconcile:%'`,
  ).bind(now, now).run();
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

async function scheduledDispatchIdentity(
  profileId: string,
  scheduleCommandId: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(`${profileId}\u0000${scheduleCommandId}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(digest)]
    .map(value => value.toString(16).padStart(2, '0'))
    .join('');
  return `scheduled_send_${hex}`;
}

/**
 * Encrypts a bounded batch of pre-0010 outbound payloads and scrubs their
 * plaintext JSON in the same compare-and-swap update. New writes are already
 * encrypted; this is an eventual migration path for queued historical rows.
 */
async function encryptLegacyOutboundPayloads(env: Env): Promise<void> {
  const commands = await env.DB.prepare(
    `SELECT profile_id, account_id, command_id, kind,
            payload_json, payload_ciphertext
       FROM mail_commands
      WHERE (payload_ciphertext IS NULL AND payload_json != '{}')
         OR (payload_ciphertext IS NOT NULL AND payload_ciphertext NOT LIKE 'v2.%')
      ORDER BY created_at
      LIMIT 50`,
  ).all<{
    profile_id: string;
    account_id: string;
    command_id: string;
    kind: string;
    payload_json: string;
    payload_ciphertext: string | null;
  }>();
  const schedules = await env.DB.prepare(
    `SELECT profile_id, account_id, schedule_command_id,
            draft_payload_json, draft_payload_ciphertext
       FROM scheduled_sends
      WHERE (draft_payload_ciphertext IS NULL AND draft_payload_json != '{}')
         OR (draft_payload_ciphertext IS NOT NULL AND draft_payload_ciphertext NOT LIKE 'v2.%')
      ORDER BY created_at
      LIMIT 50`,
  ).all<{
    profile_id: string;
    account_id: string;
    schedule_command_id: string;
    draft_payload_json: string;
    draft_payload_ciphertext: string | null;
  }>();
  const statements: D1PreparedStatement[] = [];
  for (const row of commands.results) {
    const payload = await openStoredPayload(
      env,
      row.payload_ciphertext,
      row.payload_json,
      {
        table: 'mail_commands',
        profileId: row.profile_id,
        accountId: row.account_id,
        id: row.command_id,
        kind: row.kind,
      },
    );
    statements.push(env.DB.prepare(
      `UPDATE mail_commands
          SET payload_ciphertext = ?, payload_json = '{}'
        WHERE profile_id = ? AND command_id = ?
          AND COALESCE(payload_ciphertext, '') = COALESCE(?, '')
          AND payload_json = ?`,
    ).bind(
      await sealStoredPayload(env, payload, {
        table: 'mail_commands',
        profileId: row.profile_id,
        accountId: row.account_id,
        id: row.command_id,
        kind: row.kind,
      }),
      row.profile_id,
      row.command_id,
      row.payload_ciphertext,
      row.payload_json,
    ));
  }
  for (const row of schedules.results) {
    const binding = schedulePayloadBinding(
      row.profile_id,
      row.account_id,
      row.schedule_command_id,
    );
    const payload = await openStoredPayload(
      env,
      row.draft_payload_ciphertext,
      row.draft_payload_json,
      binding,
    );
    statements.push(env.DB.prepare(
      `UPDATE scheduled_sends
          SET draft_payload_ciphertext = ?, draft_payload_json = '{}'
        WHERE profile_id = ? AND schedule_command_id = ?
          AND COALESCE(draft_payload_ciphertext, '') = COALESCE(?, '')
          AND draft_payload_json = ?`,
    ).bind(
      await sealStoredPayload(env, payload, binding),
      row.profile_id,
      row.schedule_command_id,
      row.draft_payload_ciphertext,
      row.draft_payload_json,
    ));
  }
  if (statements.length > 0) await env.DB.batch(statements);
}

async function dispatchScheduledSends(
  env: Env,
  now: string,
  checkFreshReply: NonNullable<CoordinatorDependencies['checkFreshReply']>,
): Promise<void> {
  const due = await env.DB.prepare(
    `SELECT scheduled.profile_id, scheduled.account_id,
            scheduled.schedule_command_id, scheduled.thread_id,
            scheduled.draft_payload_json, scheduled.draft_payload_ciphertext,
            scheduled.due_at, scheduled.cancel_if_reply,
            original.client_created_at
       FROM scheduled_sends scheduled
       JOIN mail_commands original
         ON original.profile_id = scheduled.profile_id
        AND original.command_id = scheduled.schedule_command_id
      WHERE scheduled.state = 'pending' AND scheduled.due_at <= ?
      ORDER BY scheduled.due_at, scheduled.schedule_command_id
      LIMIT 50`,
  )
    .bind(now)
    .all<{
      profile_id: string;
      account_id: string;
      schedule_command_id: string;
      thread_id: string | null;
      draft_payload_json: string;
      draft_payload_ciphertext: string | null;
      due_at: string;
      cancel_if_reply: number;
      client_created_at: string;
    }>();
  for (const row of due.results) {
    if (row.cancel_if_reply === 1 && row.thread_id) {
      let hasReply: boolean;
      try {
        hasReply = await checkFreshReply(
          env,
          row.profile_id,
          row.account_id,
          row.thread_id,
          row.client_created_at,
          new Date(now),
        );
      } catch (error) {
        await env.DB.prepare(
          `UPDATE scheduled_sends
              SET error_code = 'reply_check_unavailable', updated_at = ?
            WHERE profile_id = ? AND schedule_command_id = ? AND state = 'pending'`,
        ).bind(now, row.profile_id, row.schedule_command_id).run();
        console.error(JSON.stringify({
          message: 'scheduled send reply barrier failed; send remains pending',
          profileId: row.profile_id,
          accountId: row.account_id,
          scheduleCommandId: row.schedule_command_id,
          error: error instanceof Error ? error.message : String(error),
        }));
        continue;
      }
      if (hasReply) {
        await env.DB.prepare(
          `UPDATE scheduled_sends
              SET state = 'cancelled', error_code = 'reply_received', updated_at = ?
            WHERE profile_id = ? AND schedule_command_id = ? AND state = 'pending'`,
        ).bind(now, row.profile_id, row.schedule_command_id).run();
        continue;
      }
    }
    let draftPayload: unknown;
    try {
      draftPayload = await openStoredPayload(
        env,
        row.draft_payload_ciphertext,
        row.draft_payload_json,
        schedulePayloadBinding(
          row.profile_id,
          row.account_id,
          row.schedule_command_id,
        ),
      );
    } catch {
      draftPayload = null;
    }
    if (!isMailDraftPayload(draftPayload)) {
      await env.DB.prepare(
        `UPDATE scheduled_sends
            SET state = 'failed', error_code = 'stored_schedule_invalid', updated_at = ?
          WHERE profile_id = ? AND schedule_command_id = ? AND state = 'pending'`,
      ).bind(now, row.profile_id, row.schedule_command_id).run();
      continue;
    }
    const dispatchCommandId = await scheduledDispatchIdentity(
      row.profile_id,
      row.schedule_command_id,
    );
    const idempotencyKey = `tap-email:scheduled:${dispatchCommandId}`;
    const payloadCiphertext = await sealStoredPayload(env, draftPayload, {
      table: 'mail_commands',
      profileId: row.profile_id,
      accountId: row.account_id,
      id: dispatchCommandId,
      kind: 'send_draft',
    });
    const inserted = await env.DB.batch([
      env.DB.prepare(
        `INSERT OR IGNORE INTO mail_commands
           (profile_id, account_id, command_id, idempotency_key, kind, thread_id,
            expected_provider_revision, payload_json, payload_ciphertext, state, dispatch_pending,
            client_created_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'send_draft', ?, NULL, '{}', ?, 'accepted', 1, ?, ?, ?)`,
      ).bind(
        row.profile_id,
        row.account_id,
        dispatchCommandId,
        idempotencyKey,
        row.thread_id,
        payloadCiphertext,
        now,
        now,
        now,
      ),
      env.DB.prepare(
        `UPDATE scheduled_sends
            SET state = 'enqueued', dispatch_command_id = ?,
                error_code = NULL, updated_at = ?
          WHERE profile_id = ? AND schedule_command_id = ? AND state = 'pending'`,
      ).bind(dispatchCommandId, now, row.profile_id, row.schedule_command_id),
      copyScheduledAttribution(env, row.profile_id, row.schedule_command_id, dispatchCommandId),
    ]);
    if (Number(inserted[1]?.meta.changes ?? 0) !== 1) continue;
    try {
      await env.COMMAND_QUEUE.send({
        kind: 'command',
        profileId: row.profile_id,
        accountId: row.account_id,
        commandId: dispatchCommandId,
      } satisfies CommandQueueMessage);
      await env.DB.prepare(
        `UPDATE mail_commands SET dispatch_pending = 0, updated_at = ?
          WHERE profile_id = ? AND command_id = ?`,
      ).bind(now, row.profile_id, dispatchCommandId).run();
    } catch (error) {
      console.error(JSON.stringify({
        message: 'scheduled send queue dispatch deferred',
        profileId: row.profile_id,
        accountId: row.account_id,
        scheduleCommandId: row.schedule_command_id,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
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

function refreshAccountCoverageStatement(
  env: Env,
  profileId: string,
  accountId: string,
  now: string,
): D1PreparedStatement {
  return env.DB.prepare(
    `UPDATE google_accounts
        SET unresolved_failures = (
              SELECT COUNT(*) FROM provider_events
               WHERE profile_id = ? AND account_id = ?
                 AND state IN ('retryable', 'dead_letter')
                 AND (
                   google_accounts.last_full_sync_completed_at IS NULL OR
                   updated_at > google_accounts.last_full_sync_completed_at
                 )
            ),
            coverage_state = CASE
              WHEN connection_state != 'active' THEN 'blocked'
              WHEN backfill_page_token IS NOT NULL THEN 'backfilling'
              WHEN EXISTS (
                SELECT 1 FROM provider_events
                 WHERE profile_id = ? AND account_id = ?
                   AND state IN ('retryable', 'dead_letter')
                   AND (
                     google_accounts.last_full_sync_completed_at IS NULL OR
                     updated_at > google_accounts.last_full_sync_completed_at
                   )
              ) THEN 'stale'
              ELSE 'current'
            END,
            updated_at = ?
      WHERE profile_id = ? AND account_id = ?`,
  ).bind(
    profileId,
    accountId,
    profileId,
    accountId,
    now,
    profileId,
    accountId,
  );
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
  const leaseExpiresAt = new Date(now.getTime() + syncEventLeaseMilliseconds).toISOString();
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
    // The durable event is either owned by another invocation or is not due
    // yet. Acknowledge this Queue copy instead of letting it outlive the active
    // lease and take over concurrently; the cron redispatcher owns recovery.
    message.ack();
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
      refreshAccountCoverageStatement(
        env,
        leased.profile_id,
        leased.account_id,
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
      refreshAccountCoverageStatement(
        env,
        leased.profile_id,
        leased.account_id,
        timestamp,
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
      ...(error instanceof GoogleApiError && error.providerReason
        ? { providerReason: error.providerReason }
        : {}),
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
        const requiredAction: TapEmailAction = request.method === 'GET'
          ? 'tap-email.view'
          : 'tap-email.manage';
        const identity = await verifyAccess(request, env, requiredAction);
        if (request.method === 'POST' && url.pathname === '/v1/accounts/google/connect') {
          return json(await beginGoogleOAuth(env, identity, now()), 200, cors);
        }
        if (request.method === 'GET' && (url.pathname === '/v1/mailbox' || url.pathname === '/v1/mailbox/changes')) {
          const afterValues = url.searchParams.getAll('after');
          const changes = url.pathname === '/v1/mailbox/changes';
          if (changes && (afterValues.length !== 1 || !/^(0|[1-9]\d*)$/u.test(afterValues[0]!) || url.searchParams.has('cursor'))) {
            throw new ApiError(400, 'invalid_mailbox_cursor', 'A change revision is required.');
          }
          const limitValues = url.searchParams.getAll('limit');
          const cursorValues = url.searchParams.getAll('cursor');
          if (limitValues.length > 1 || cursorValues.length > 1) {
            throw new ApiError(
              400,
              'invalid_mailbox_page',
              'Mailbox pagination parameters may only be supplied once.',
            );
          }
          const rawLimit = limitValues[0];
          if (rawLimit !== undefined && !/^[1-9]\d*$/u.test(rawLimit)) {
            throw new ApiError(
              400,
              'invalid_mailbox_limit',
              'Mailbox page size must be a positive integer.',
            );
          }
          const page = await mailboxPage(env, identity.profileId, {
            ...(changes ? { afterRevision: Number(afterValues[0]) } : {}),
            ...(rawLimit === undefined ? {} : { limit: Number(rawLimit) }),
            ...(cursorValues[0] === undefined ? {} : { cursor: cursorValues[0] }),
          });
          return json(page, 200, cors);
        }
        const createOutboundAttachmentMatch =
          /^\/v1\/accounts\/([^/]+)\/drafts\/([^/]+)\/attachments$/u.exec(url.pathname);
        if (
          request.method === 'POST' &&
          createOutboundAttachmentMatch?.[1] &&
          createOutboundAttachmentMatch[2]
        ) {
          const accountId = decodedAttachmentSegment(createOutboundAttachmentMatch[1]);
          const draftKey = decodedAttachmentSegment(createOutboundAttachmentMatch[2]);
          const stage = await createOutboundAttachmentStage(
            env,
            identity.profileId,
            accountId,
            draftKey,
            outboundAttachmentStageInput(await readBoundedJson(request)),
            now(),
          );
          return json({ stage }, 201, cors);
        }
        const uploadOutboundAttachmentMatch =
          /^\/v1\/accounts\/([^/]+)\/drafts\/([^/]+)\/attachments\/([^/]+)\/chunks\/(\d+)$/u.exec(url.pathname);
        if (
          request.method === 'POST' &&
          uploadOutboundAttachmentMatch?.[1] &&
          uploadOutboundAttachmentMatch[2] &&
          uploadOutboundAttachmentMatch[3] &&
          uploadOutboundAttachmentMatch[4]
        ) {
          const accountId = decodedAttachmentSegment(uploadOutboundAttachmentMatch[1]);
          const draftKey = decodedAttachmentSegment(uploadOutboundAttachmentMatch[2]);
          const stageId = decodedAttachmentSegment(uploadOutboundAttachmentMatch[3]);
          const index = Number(uploadOutboundAttachmentMatch[4]);
          const bytes = decodeOutboundAttachmentChunk(
            await readBoundedJson(request, 300_000),
          );
          const stage = await uploadOutboundAttachmentChunk(
            env,
            identity.profileId,
            accountId,
            draftKey,
            stageId,
            index,
            bytes,
            now(),
          );
          return json({ stage }, 200, cors);
        }
        const completeOutboundAttachmentMatch =
          /^\/v1\/accounts\/([^/]+)\/drafts\/([^/]+)\/attachments\/([^/]+)\/complete$/u.exec(url.pathname);
        if (
          request.method === 'POST' &&
          completeOutboundAttachmentMatch?.[1] &&
          completeOutboundAttachmentMatch[2] &&
          completeOutboundAttachmentMatch[3]
        ) {
          const accountId = decodedAttachmentSegment(completeOutboundAttachmentMatch[1]);
          const draftKey = decodedAttachmentSegment(completeOutboundAttachmentMatch[2]);
          const stageId = decodedAttachmentSegment(completeOutboundAttachmentMatch[3]);
          const stage = await completeOutboundAttachmentStage(
            env,
            identity.profileId,
            accountId,
            draftKey,
            stageId,
            now(),
          );
          return json({ stage }, 200, cors);
        }
        const attachmentMatch = /^\/v1\/accounts\/([^/]+)\/threads\/([^/]+)\/messages\/([^/]+)\/attachments\/([^/]+)$/u.exec(url.pathname);
        if (
          request.method === 'GET' &&
          attachmentMatch?.[1] &&
          attachmentMatch[2] &&
          attachmentMatch[3] &&
          attachmentMatch[4]
        ) {
          const accountId = decodedAttachmentSegment(attachmentMatch[1]);
          const threadId = decodedAttachmentSegment(attachmentMatch[2]);
          const messageId = decodedAttachmentSegment(attachmentMatch[3]);
          const resourceId = decodedAttachmentSegment(attachmentMatch[4]);
          if (
            !isSafeMailIdentifier(accountId) ||
            !isSafeMailIdentifier(threadId) ||
            !isSafeMailIdentifier(messageId) ||
            !isSafeMailIdentifier(resourceId)
          ) {
            throw new ApiError(
              400,
              'invalid_attachment',
              'The attachment identity is invalid.',
            );
          }
          const attachment = await attachmentContent(
            env,
            identity.profileId,
            accountId,
            threadId,
            messageId,
            resourceId,
            now(),
          );
          const headers = new Headers(cors);
          headers.set('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length');
          headers.set('Cache-Control', 'private, no-store');
          headers.set('Content-Security-Policy', "sandbox; default-src 'none'");
          headers.set('Content-Disposition', contentDisposition(
            attachment.disposition,
            attachment.fileName,
          ));
          headers.set('Content-Length', String(attachment.bytes.byteLength));
          headers.set('Content-Type', attachment.mimeType);
          headers.set('X-Content-Type-Options', 'nosniff');
          return new Response(attachment.bytes, { status: 200, headers });
        }
        const remoteImagesMatch = /^\/v1\/accounts\/([^/]+)\/threads\/([^/]+)\/messages\/([^/]+)\/remote-images$/u.exec(url.pathname);
        if (
          request.method === 'POST' &&
          remoteImagesMatch?.[1] &&
          remoteImagesMatch[2] &&
          remoteImagesMatch[3]
        ) {
          const accountId = decodeURIComponent(remoteImagesMatch[1]);
          const threadId = decodeURIComponent(remoteImagesMatch[2]);
          const messageId = decodeURIComponent(remoteImagesMatch[3]);
          if (
            !isSafeMailIdentifier(accountId) ||
            !isSafeMailIdentifier(threadId) ||
            !isSafeMailIdentifier(messageId)
          ) {
            throw new ApiError(400, 'invalid_message', 'The Gmail message identity is invalid.');
          }
          const urls = remoteImageUrlsFromRequest(await readBoundedJson(request));
          const bodyHtml = await storedMessageRichBody(
            env,
            identity.profileId,
            accountId,
            threadId,
            messageId,
          );
          if (bodyHtml === undefined) {
            throw new ApiError(404, 'message_not_found', 'The Gmail message was not found.');
          }
          if (bodyHtml === null) {
            throw new ApiError(409, 'rich_body_unavailable', 'The Gmail message has no cached rich body.');
          }
          const allowedUrls = await remoteImageUrlsAllowedByHtml(bodyHtml, urls);
          if (allowedUrls.length !== urls.length) {
            throw new ApiError(
              403,
              'unbound_remote_image',
              'Every requested image must belong to the selected Gmail message.',
            );
          }
          const result = await (dependencies.loadRemoteImages ?? proxyRemoteImages)(allowedUrls);
          return json({ images: result.images, blocked: result.blocked }, 200, cors);
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
          const snapshot = await threadSnapshot(env, identity.profileId, accountId, threadId, now(), url.searchParams.get('cursor') ?? undefined);
          if (!snapshot) throw new ApiError(404, 'thread_not_found', 'The Gmail thread was not found.');
          return json({ thread: snapshot }, 200, cors);
        }
        if (request.method === 'POST' && url.pathname === '/v1/commands') {
          const response = await submitCommand(request, env, identity, now().toISOString(), dependencies.verifySender ?? verifySenderContext);
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
        if (request.method === 'GET' && url.pathname === '/v1/scheduled-sends') {
          return json({ scheduledSends: await listScheduledSends(env, identity) }, 200, cors);
        }
        const reconcileCommandMatch = /^\/v1\/commands\/([^/]+)\/reconcile$/u.exec(url.pathname);
        if (request.method === 'POST' && reconcileCommandMatch?.[1]) {
          const commandId = decodeURIComponent(reconcileCommandMatch[1]);
          if (!isSafeMailIdentifier(commandId)) {
            throw new ApiError(400, 'invalid_command', 'The command identity is invalid.');
          }
          const original = await commandRow(env, identity, commandId);
          if (original) {
            const decoded = await decodeCommand(env, original);
            if (isMailDraftPayload(decoded.payload) && decoded.payload.expectedContext) {
              await (dependencies.verifySender ?? verifySenderContext)(request, env, identity, decoded.payload.expectedContext);
            }
          }
          const provider = dependencies.provider ?? createGoogleProvider(env, now);
          const reconciled = await reconcileUncertainSend(
            env,
            identity,
            commandId,
            provider,
            now().toISOString(),
            dependencies.referralPublisher ?? referralPublisher(env.WEBSITE_REFERRALS),
          );
          return json({ receipt: reconciled }, 200, cors);
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
          error instanceof GoogleApiError ||
          error instanceof AttachmentContentError ||
          error instanceof MailboxPageError ||
          error instanceof ThreadPageError ||
          error instanceof RemoteImageProxyError ||
          error instanceof OutboundAttachmentError
            ? error
            : new ApiError(500, 'internal_error', 'The coordinator could not complete the request.');
        if (
          !(error instanceof ApiError) &&
          !(error instanceof AccessError) &&
          !(error instanceof GoogleOAuthError) &&
          !(error instanceof GoogleApiError) &&
          !(error instanceof AttachmentContentError) &&
          !(error instanceof MailboxPageError) &&
          !(error instanceof ThreadPageError) &&
          !(error instanceof RemoteImageProxyError) &&
          !(error instanceof OutboundAttachmentError)
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
            dependencies.referralPublisher ?? referralPublisher(env.WEBSITE_REFERRALS),
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
      await encryptLegacyOutboundPayloads(env);
      await Promise.all([
        redispatchCommands(env, current.toISOString()),
        dispatchScheduledSends(
          env,
          current.toISOString(),
          dependencies.checkFreshReply ?? freshGoogleThreadHasExternalReplyAfter,
        ),
        redispatchSyncEvents(env, current),
        markDueReminders(env, current.toISOString()),
        enqueueScheduledSyncs(env, current),
        deleteExpiredOutboundAttachments(env, current),
        env.DB.prepare('DELETE FROM google_oauth_states WHERE expires_at <= ?')
          .bind(current.toISOString())
          .run(),
      ]);
    },
  } satisfies ExportedHandler<Env, CoordinatorQueueMessage>;
}

export default createTapEmailCoordinator();
