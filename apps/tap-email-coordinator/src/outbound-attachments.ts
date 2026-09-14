import {
  isMailDraftAttachment,
  isSafeMailIdentifier,
  MAXIMUM_DRAFT_ATTACHMENT_BYTES,
  type MailDraftAttachment,
} from '@tap-examples/tap-email-protocol';
import {
  openBytes,
  sealBytes,
  secureRandomToken,
  sha256Base64Url,
  sha256BytesBase64Url,
} from './crypto';

export const outboundAttachmentChunkBytes = 192 * 1_024;
const maximumChunkRequestBytes = Math.ceil(outboundAttachmentChunkBytes * 4 / 3) + 2_048;
const attachmentStageTtlMilliseconds = 7 * 24 * 60 * 60 * 1_000;
const sha256Base64UrlPattern = /^[A-Za-z0-9_-]{43}$/u;
const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

export class OutboundAttachmentError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 410 | 413 | 500,
    readonly code:
      | 'invalid_attachment_stage'
      | 'attachment_stage_conflict'
      | 'attachment_stage_not_found'
      | 'attachment_stage_expired'
      | 'attachment_stage_incomplete'
      | 'attachment_stage_corrupt'
      | 'attachment_too_large'
      | 'attachment_storage_failed',
    message: string,
  ) {
    super(message);
    this.name = 'OutboundAttachmentError';
  }
}

export interface CreateOutboundAttachmentStageInput {
  readonly idempotencyKey: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sha256Base64Url: string;
}

export interface OutboundAttachmentStageReceipt {
  readonly attachment: MailDraftAttachment;
  readonly chunkSize: number;
  readonly expectedChunks: number;
  readonly receivedChunks: number;
  readonly state: 'staging' | 'ready' | 'consumed';
  readonly expiresAt: string;
}

interface AttachmentStageRow {
  readonly profile_id: string;
  readonly account_id: string;
  readonly stage_id: string;
  readonly idempotency_key: string;
  readonly draft_key: string;
  readonly file_name: string;
  readonly mime_type: string;
  readonly size_bytes: number;
  readonly sha256_base64url: string;
  readonly chunk_size: number;
  readonly expected_chunks: number;
  readonly received_chunks: number;
  readonly received_bytes: number;
  readonly state: 'staging' | 'ready' | 'consumed' | 'revoked';
  readonly expires_at: string;
}

interface AttachmentChunkRow {
  readonly chunk_index: number;
  readonly size_bytes: number;
  readonly sha256_base64url: string;
  readonly object_key: string;
}

function stageDescriptor(row: AttachmentStageRow): MailDraftAttachment {
  return {
    stageId: row.stage_id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    sha256Base64Url: row.sha256_base64url,
  };
}

function stageReceipt(row: AttachmentStageRow): OutboundAttachmentStageReceipt {
  return {
    attachment: stageDescriptor(row),
    chunkSize: row.chunk_size,
    expectedChunks: row.expected_chunks,
    receivedChunks: row.received_chunks,
    state: row.state === 'revoked' ? 'staging' : row.state,
    expiresAt: row.expires_at,
  };
}

function stageExpiry(now: Date): string {
  return new Date(now.getTime() + attachmentStageTtlMilliseconds).toISOString();
}

function validateCreateInput(input: CreateOutboundAttachmentStageInput): void {
  const descriptor: MailDraftAttachment = {
    stageId: 'stage_validation',
    fileName: input.fileName,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    sha256Base64Url: input.sha256Base64Url,
  };
  if (
    !isSafeMailIdentifier(input.idempotencyKey) ||
    !isMailDraftAttachment(descriptor)
  ) {
    throw new OutboundAttachmentError(
      input.sizeBytes > MAXIMUM_DRAFT_ATTACHMENT_BYTES ? 413 : 400,
      input.sizeBytes > MAXIMUM_DRAFT_ATTACHMENT_BYTES
        ? 'attachment_too_large'
        : 'invalid_attachment_stage',
      input.sizeBytes > MAXIMUM_DRAFT_ATTACHMENT_BYTES
        ? 'This attachment is larger than the 8 MiB upload limit.'
        : 'The attachment stage metadata is invalid.',
    );
  }
}

async function stageRow(
  env: Env,
  profileId: string,
  stageId: string,
): Promise<AttachmentStageRow | null> {
  return env.DB.prepare(
    `SELECT profile_id, account_id, stage_id, idempotency_key, draft_key,
            file_name, mime_type, size_bytes, sha256_base64url, chunk_size,
            expected_chunks, received_chunks, received_bytes, state, expires_at
       FROM outbound_attachment_stages
      WHERE profile_id = ? AND stage_id = ?`,
  ).bind(profileId, stageId).first<AttachmentStageRow>();
}

export async function createOutboundAttachmentStage(
  env: Env,
  profileId: string,
  accountId: string,
  draftKey: string,
  input: CreateOutboundAttachmentStageInput,
  now: Date,
): Promise<OutboundAttachmentStageReceipt> {
  if (!isSafeMailIdentifier(accountId) || !isSafeMailIdentifier(draftKey)) {
    throw new OutboundAttachmentError(
      400,
      'invalid_attachment_stage',
      'The attachment stage scope is invalid.',
    );
  }
  validateCreateInput(input);
  const account = await env.DB.prepare(
    `SELECT 1 AS connected FROM google_accounts
      WHERE profile_id = ? AND account_id = ? AND connection_state = 'active'`,
  ).bind(profileId, accountId).first<{ readonly connected: number }>();
  if (!account) {
    throw new OutboundAttachmentError(
      404,
      'attachment_stage_not_found',
      'The selected mail account is not connected.',
    );
  }

  const existing = await env.DB.prepare(
    `SELECT profile_id, account_id, stage_id, idempotency_key, draft_key,
            file_name, mime_type, size_bytes, sha256_base64url, chunk_size,
            expected_chunks, received_chunks, received_bytes, state, expires_at
       FROM outbound_attachment_stages
      WHERE profile_id = ? AND account_id = ? AND idempotency_key = ?`,
  ).bind(profileId, accountId, input.idempotencyKey).first<AttachmentStageRow>();
  if (existing) {
    if (
      existing.draft_key !== draftKey ||
      existing.file_name !== input.fileName ||
      existing.mime_type !== input.mimeType ||
      existing.size_bytes !== input.sizeBytes ||
      existing.sha256_base64url !== input.sha256Base64Url
    ) {
      throw new OutboundAttachmentError(
        409,
        'attachment_stage_conflict',
        'The attachment upload identity is already bound to different content.',
      );
    }
    if (existing.state === 'revoked') {
      throw new OutboundAttachmentError(
        410,
        'attachment_stage_expired',
        'This attachment upload is no longer available.',
      );
    }
    return stageReceipt(existing);
  }

  const stageId = `stage_${secureRandomToken(18)}`;
  const expectedChunks = Math.ceil(input.sizeBytes / outboundAttachmentChunkBytes);
  const expiresAt = stageExpiry(now);
  await env.DB.prepare(
    `INSERT INTO outbound_attachment_stages
       (profile_id, account_id, stage_id, idempotency_key, draft_key,
        file_name, mime_type, size_bytes, sha256_base64url, chunk_size,
        expected_chunks, expires_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    profileId,
    accountId,
    stageId,
    input.idempotencyKey,
    draftKey,
    input.fileName,
    input.mimeType,
    input.sizeBytes,
    input.sha256Base64Url,
    outboundAttachmentChunkBytes,
    expectedChunks,
    expiresAt,
    now.toISOString(),
    now.toISOString(),
  ).run();
  const created = await stageRow(env, profileId, stageId);
  if (!created) {
    throw new OutboundAttachmentError(
      500,
      'attachment_storage_failed',
      'The attachment upload could not be created.',
    );
  }
  return stageReceipt(created);
}

export function decodeOutboundAttachmentChunk(value: unknown): Uint8Array {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OutboundAttachmentError(400, 'invalid_attachment_stage', 'The upload chunk is invalid.');
  }
  const input = value as Readonly<Record<string, unknown>>;
  if (
    typeof input.dataBase64 !== 'string' ||
    input.dataBase64.length > maximumChunkRequestBytes ||
    !base64Pattern.test(input.dataBase64)
  ) {
    throw new OutboundAttachmentError(400, 'invalid_attachment_stage', 'The upload chunk is invalid.');
  }
  try {
    const binary = atob(input.dataBase64);
    if (binary.length === 0 || binary.length > outboundAttachmentChunkBytes) {
      throw new Error('invalid chunk size');
    }
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  } catch {
    throw new OutboundAttachmentError(400, 'invalid_attachment_stage', 'The upload chunk is invalid.');
  }
}

function chunkAssociatedData(row: AttachmentStageRow, index: number, digest: string): string {
  return [
    'tap-email-outbound-attachment',
    'v1',
    row.profile_id,
    row.account_id,
    row.draft_key,
    row.stage_id,
    String(index),
    digest,
  ].join('\u0000');
}

function expectedChunkSize(row: AttachmentStageRow, index: number): number {
  if (index < row.expected_chunks - 1) return row.chunk_size;
  return row.size_bytes - row.chunk_size * (row.expected_chunks - 1);
}

export async function uploadOutboundAttachmentChunk(
  env: Env,
  profileId: string,
  accountId: string,
  draftKey: string,
  stageId: string,
  index: number,
  bytes: Uint8Array,
  now: Date,
): Promise<OutboundAttachmentStageReceipt> {
  if (!Number.isSafeInteger(index) || index < 0 || !isSafeMailIdentifier(stageId)) {
    throw new OutboundAttachmentError(400, 'invalid_attachment_stage', 'The upload chunk identity is invalid.');
  }
  const row = await stageRow(env, profileId, stageId);
  if (!row || row.account_id !== accountId || row.draft_key !== draftKey) {
    throw new OutboundAttachmentError(404, 'attachment_stage_not_found', 'The attachment upload was not found.');
  }
  if (row.state !== 'staging' || Date.parse(row.expires_at) <= now.getTime()) {
    throw new OutboundAttachmentError(410, 'attachment_stage_expired', 'This attachment upload is no longer writable.');
  }
  if (index >= row.expected_chunks || bytes.byteLength !== expectedChunkSize(row, index)) {
    throw new OutboundAttachmentError(400, 'invalid_attachment_stage', 'The upload chunk size is invalid.');
  }

  const digest = await sha256BytesBase64Url(bytes);
  let storedChunk = await env.DB.prepare(
    `SELECT chunk_index, size_bytes, sha256_base64url, object_key
       FROM outbound_attachment_chunks
      WHERE profile_id = ? AND stage_id = ? AND chunk_index = ?`,
  ).bind(profileId, stageId, index).first<AttachmentChunkRow>();
  if (storedChunk) {
    if (storedChunk.size_bytes !== bytes.byteLength || storedChunk.sha256_base64url !== digest) {
      throw new OutboundAttachmentError(
        409,
        'attachment_stage_conflict',
        'This attachment chunk was already uploaded with different content.',
      );
    }
  } else {
    const scopeDigest = await sha256Base64Url(
      `${profileId}\u0000${accountId}\u0000${draftKey}\u0000${stageId}`,
    );
    const objectKey = `v1/${scopeDigest}/${index}/${digest}`;
    // Reserve the canonical object key before writing R2. If the worker stops
    // between these operations, the retry rewrites the same bounded object;
    // expiry cleanup can always discover it from D1.
    await env.DB.prepare(
      `INSERT OR IGNORE INTO outbound_attachment_chunks
         (profile_id, stage_id, chunk_index, size_bytes, sha256_base64url,
          object_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      profileId,
      stageId,
      index,
      bytes.byteLength,
      digest,
      objectKey,
      now.toISOString(),
    ).run();
    storedChunk = await env.DB.prepare(
      `SELECT chunk_index, size_bytes, sha256_base64url, object_key
         FROM outbound_attachment_chunks
        WHERE profile_id = ? AND stage_id = ? AND chunk_index = ?`,
    ).bind(profileId, stageId, index).first<AttachmentChunkRow>();
    if (
      !storedChunk ||
      storedChunk.size_bytes !== bytes.byteLength ||
      storedChunk.sha256_base64url !== digest
    ) {
      throw new OutboundAttachmentError(
        409,
        'attachment_stage_conflict',
        'This attachment chunk was already uploaded with different content.',
      );
    }
  }

  const encrypted = await sealBytes(
    bytes,
    env.ATTACHMENT_STAGING_ENCRYPTION_KEY,
    chunkAssociatedData(row, index, digest),
  );
  await env.ATTACHMENT_STAGING.put(storedChunk.object_key, encrypted, {
    httpMetadata: { contentType: 'application/octet-stream' },
    customMetadata: { version: '1' },
  });
  const aggregate = await env.DB.prepare(
    `SELECT COUNT(*) AS chunk_count, COALESCE(SUM(size_bytes), 0) AS byte_count
       FROM outbound_attachment_chunks
      WHERE profile_id = ? AND stage_id = ?`,
  ).bind(profileId, stageId).first<{ readonly chunk_count: number; readonly byte_count: number }>();
  await env.DB.prepare(
    `UPDATE outbound_attachment_stages
        SET received_chunks = ?, received_bytes = ?, updated_at = ?
      WHERE profile_id = ? AND stage_id = ? AND state = 'staging'`,
  ).bind(
    aggregate?.chunk_count ?? 0,
    aggregate?.byte_count ?? 0,
    now.toISOString(),
    profileId,
    stageId,
  ).run();
  const updated = await stageRow(env, profileId, stageId);
  if (!updated) throw new OutboundAttachmentError(404, 'attachment_stage_not_found', 'The attachment upload was not found.');
  return stageReceipt(updated);
}

async function storedChunkBytes(
  env: Env,
  row: AttachmentStageRow,
  chunk: AttachmentChunkRow,
): Promise<Uint8Array> {
  const object = await env.ATTACHMENT_STAGING.get(chunk.object_key);
  if (!object || object.size > outboundAttachmentChunkBytes + 64) {
    throw new OutboundAttachmentError(409, 'attachment_stage_corrupt', 'The staged attachment is incomplete.');
  }
  let plaintext: Uint8Array;
  try {
    plaintext = await openBytes(
      new Uint8Array(await object.arrayBuffer()),
      env.ATTACHMENT_STAGING_ENCRYPTION_KEY,
      chunkAssociatedData(row, chunk.chunk_index, chunk.sha256_base64url),
    );
  } catch {
    throw new OutboundAttachmentError(409, 'attachment_stage_corrupt', 'The staged attachment failed integrity verification.');
  }
  if (
    plaintext.byteLength !== chunk.size_bytes ||
    await sha256BytesBase64Url(plaintext) !== chunk.sha256_base64url
  ) {
    throw new OutboundAttachmentError(409, 'attachment_stage_corrupt', 'The staged attachment failed integrity verification.');
  }
  return plaintext;
}

async function completeBytes(env: Env, row: AttachmentStageRow): Promise<Uint8Array> {
  const chunks = await env.DB.prepare(
    `SELECT chunk_index, size_bytes, sha256_base64url, object_key
       FROM outbound_attachment_chunks
      WHERE profile_id = ? AND stage_id = ?
      ORDER BY chunk_index`,
  ).bind(row.profile_id, row.stage_id).all<AttachmentChunkRow>();
  if (
    chunks.results.length !== row.expected_chunks ||
    chunks.results.some((chunk, index) => chunk.chunk_index !== index)
  ) {
    throw new OutboundAttachmentError(409, 'attachment_stage_incomplete', 'Upload every attachment chunk before completing it.');
  }
  const target = new Uint8Array(row.size_bytes);
  let offset = 0;
  for (const chunk of chunks.results) {
    const bytes = await storedChunkBytes(env, row, chunk);
    target.set(bytes, offset);
    offset += bytes.byteLength;
  }
  if (offset !== row.size_bytes || await sha256BytesBase64Url(target) !== row.sha256_base64url) {
    throw new OutboundAttachmentError(409, 'attachment_stage_corrupt', 'The staged attachment does not match the selected file.');
  }
  return target;
}

export async function completeOutboundAttachmentStage(
  env: Env,
  profileId: string,
  accountId: string,
  draftKey: string,
  stageId: string,
  now: Date,
): Promise<OutboundAttachmentStageReceipt> {
  const row = await stageRow(env, profileId, stageId);
  if (!row || row.account_id !== accountId || row.draft_key !== draftKey) {
    throw new OutboundAttachmentError(404, 'attachment_stage_not_found', 'The attachment upload was not found.');
  }
  if (row.state === 'ready' || row.state === 'consumed') return stageReceipt(row);
  if (row.state === 'revoked' || Date.parse(row.expires_at) <= now.getTime()) {
    throw new OutboundAttachmentError(410, 'attachment_stage_expired', 'This attachment upload is no longer available.');
  }
  await completeBytes(env, row);
  await env.DB.prepare(
    `UPDATE outbound_attachment_stages
        SET state = 'ready', expires_at = ?, updated_at = ?
      WHERE profile_id = ? AND stage_id = ? AND state = 'staging'`,
  ).bind(stageExpiry(now), now.toISOString(), profileId, stageId).run();
  const updated = await stageRow(env, profileId, stageId);
  if (!updated) throw new OutboundAttachmentError(404, 'attachment_stage_not_found', 'The attachment upload was not found.');
  return stageReceipt(updated);
}

/** Resolve only a ready stage bound to the immutable command scope. */
export async function resolveOutboundAttachment(
  env: Env,
  profileId: string,
  accountId: string,
  draftKey: string,
  descriptor: MailDraftAttachment,
  now: Date,
): Promise<Uint8Array> {
  if (!isMailDraftAttachment(descriptor)) {
    throw new OutboundAttachmentError(400, 'invalid_attachment_stage', 'The attachment reference is invalid.');
  }
  const row = await stageRow(env, profileId, descriptor.stageId);
  if (
    !row ||
    row.account_id !== accountId ||
    row.draft_key !== draftKey ||
    row.file_name !== descriptor.fileName ||
    row.mime_type !== descriptor.mimeType ||
    row.size_bytes !== descriptor.sizeBytes ||
    row.sha256_base64url !== descriptor.sha256Base64Url
  ) {
    throw new OutboundAttachmentError(404, 'attachment_stage_not_found', 'The draft attachment was not found.');
  }
  if (row.state !== 'ready' || Date.parse(row.expires_at) <= now.getTime()) {
    throw new OutboundAttachmentError(
      row.state === 'staging' ? 409 : 410,
      row.state === 'staging' ? 'attachment_stage_incomplete' : 'attachment_stage_expired',
      row.state === 'staging'
        ? 'The draft attachment is still uploading.'
        : 'The draft attachment is no longer available.',
    );
  }
  const bytes = await completeBytes(env, row);
  await env.DB.prepare(
    `UPDATE outbound_attachment_stages SET expires_at = ?, updated_at = ?
      WHERE profile_id = ? AND stage_id = ? AND state = 'ready'`,
  ).bind(stageExpiry(now), now.toISOString(), profileId, descriptor.stageId).run();
  return bytes;
}

export async function consumeOutboundAttachments(
  env: Env,
  profileId: string,
  attachments: readonly MailDraftAttachment[],
  _now: Date,
): Promise<void> {
  for (const attachment of attachments) {
    const chunks = await env.DB.prepare(
      `SELECT object_key FROM outbound_attachment_chunks
        WHERE profile_id = ? AND stage_id = ?`,
    ).bind(profileId, attachment.stageId).all<{ readonly object_key: string }>();
    await Promise.all(chunks.results.map(chunk => env.ATTACHMENT_STAGING.delete(chunk.object_key)));
    await env.DB.batch([
      env.DB.prepare(
        `DELETE FROM outbound_attachment_chunks WHERE profile_id = ? AND stage_id = ?`,
      ).bind(profileId, attachment.stageId),
      env.DB.prepare(
        `DELETE FROM outbound_attachment_stages
          WHERE profile_id = ? AND stage_id = ? AND state = 'ready'`,
      ).bind(profileId, attachment.stageId),
    ]);
  }
}

export async function deleteExpiredOutboundAttachments(env: Env, now: Date): Promise<void> {
  // Bound work by whole stages rather than joined chunk rows. A row limit on the
  // join can split one stage, delete only some R2 objects, and then discard the
  // remaining object keys when its D1 chunk rows are removed.
  const stages = await env.DB.prepare(
    `SELECT profile_id, stage_id
       FROM outbound_attachment_stages
      WHERE state IN ('staging', 'ready', 'revoked') AND expires_at <= ?
      ORDER BY expires_at, profile_id, stage_id
      LIMIT 20`,
  ).bind(now.toISOString()).all<{
    readonly profile_id: string;
    readonly stage_id: string;
  }>();

  for (const stage of stages.results) {
    const revoked = await env.DB.prepare(
      `UPDATE outbound_attachment_stages
          SET state = 'revoked', updated_at = ?
        WHERE profile_id = ? AND stage_id = ?
          AND state IN ('staging', 'ready', 'revoked') AND expires_at <= ?`,
    ).bind(
      now.toISOString(),
      stage.profile_id,
      stage.stage_id,
      now.toISOString(),
    ).run();
    if ((revoked.meta.changes ?? 0) === 0) continue;

    const chunks = await env.DB.prepare(
      `SELECT object_key FROM outbound_attachment_chunks
        WHERE profile_id = ? AND stage_id = ?`,
    ).bind(stage.profile_id, stage.stage_id).all<{ readonly object_key: string }>();
    await Promise.all(chunks.results.map(chunk => env.ATTACHMENT_STAGING.delete(chunk.object_key)));
    await env.DB.prepare(
      `DELETE FROM outbound_attachment_chunks WHERE profile_id = ? AND stage_id = ?`,
    ).bind(stage.profile_id, stage.stage_id).run();
  }
}
