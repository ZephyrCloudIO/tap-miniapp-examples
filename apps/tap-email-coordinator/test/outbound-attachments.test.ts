import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { sha256BytesBase64Url } from '../src/crypto';
import {
  completeOutboundAttachmentStage,
  consumeOutboundAttachments,
  createOutboundAttachmentStage,
  deleteExpiredOutboundAttachments,
  outboundAttachmentChunkBytes,
  OutboundAttachmentError,
  resolveOutboundAttachment,
  uploadOutboundAttachmentChunk,
} from '../src/outbound-attachments';

const now = new Date('2026-09-14T12:00:00.000Z');
const profileId = 'profile_attachments';
const accountId = 'google_attachments';
const draftKey = 'draft_attachments';

async function clearBucket(): Promise<void> {
  let cursor: string | undefined;
  do {
    const listed = await env.ATTACHMENT_STAGING.list({ cursor });
    await Promise.all(listed.objects.map(object => env.ATTACHMENT_STAGING.delete(object.key)));
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM outbound_attachment_chunks'),
    env.DB.prepare('DELETE FROM outbound_attachment_stages'),
    env.DB.prepare('DELETE FROM google_accounts'),
  ]);
  await clearBucket();
  await env.DB.prepare(
    `INSERT INTO google_accounts
       (profile_id, account_id, google_subject, connection_state,
        coverage_state, unresolved_failures, created_at, updated_at)
     VALUES (?, ?, 'google_subject_attachments', 'active', 'current', 0, ?, ?)`,
  ).bind(profileId, accountId, now.toISOString(), now.toISOString()).run();
});

async function createStage(bytes: Uint8Array) {
  return createOutboundAttachmentStage(
    env,
    profileId,
    accountId,
    draftKey,
    {
      idempotencyKey: 'attach_contract_pdf',
      fileName: 'contract.pdf',
      mimeType: 'application/pdf',
      sizeBytes: bytes.byteLength,
      sha256Base64Url: await sha256BytesBase64Url(bytes),
    },
    now,
  );
}

describe('outbound attachment staging', () => {
  it('encrypts chunks at rest and resolves only a completed draft-bound stage', async () => {
    const bytes = new Uint8Array(outboundAttachmentChunkBytes + 3);
    bytes.fill(0x61);
    bytes.set([0, 128, 255], outboundAttachmentChunkBytes);
    const created = await createStage(bytes);
    expect(created).toMatchObject({
      expectedChunks: 2,
      receivedChunks: 0,
      state: 'staging',
      attachment: {
        fileName: 'contract.pdf',
        mimeType: 'application/pdf',
        sizeBytes: bytes.byteLength,
      },
    });

    await uploadOutboundAttachmentChunk(
      env,
      profileId,
      accountId,
      draftKey,
      created.attachment.stageId,
      0,
      bytes.subarray(0, outboundAttachmentChunkBytes),
      now,
    );
    const uploaded = await uploadOutboundAttachmentChunk(
      env,
      profileId,
      accountId,
      draftKey,
      created.attachment.stageId,
      1,
      bytes.subarray(outboundAttachmentChunkBytes),
      now,
    );
    expect(uploaded.receivedChunks).toBe(2);

    const objectKey = await env.DB.prepare(
      `SELECT object_key FROM outbound_attachment_chunks
        WHERE profile_id = ? AND stage_id = ? AND chunk_index = 1`,
    ).bind(profileId, created.attachment.stageId).first<{ readonly object_key: string }>();
    expect(objectKey).not.toBeNull();
    const stored = await env.ATTACHMENT_STAGING.get(objectKey!.object_key);
    const ciphertext = new Uint8Array(await stored!.arrayBuffer());
    expect(ciphertext).not.toEqual(bytes.subarray(outboundAttachmentChunkBytes));

    const completed = await completeOutboundAttachmentStage(
      env,
      profileId,
      accountId,
      draftKey,
      created.attachment.stageId,
      now,
    );
    expect(completed.state).toBe('ready');
    await expect(resolveOutboundAttachment(
      env,
      profileId,
      accountId,
      draftKey,
      completed.attachment,
      now,
    )).resolves.toEqual(bytes);
  });

  it('replays one creation/chunk identity and rejects changed content', async () => {
    const bytes = Uint8Array.from([1, 2, 3]);
    const first = await createStage(bytes);
    const duplicate = await createStage(bytes);
    expect(duplicate.attachment.stageId).toBe(first.attachment.stageId);

    await expect(Promise.all([
      uploadOutboundAttachmentChunk(
        env,
        profileId,
        accountId,
        draftKey,
        first.attachment.stageId,
        0,
        bytes,
        now,
      ),
      uploadOutboundAttachmentChunk(
        env,
        profileId,
        accountId,
        draftKey,
        first.attachment.stageId,
        0,
        bytes,
        now,
      ),
    ])).resolves.toEqual([
      expect.objectContaining({ receivedChunks: 1 }),
      expect.objectContaining({ receivedChunks: 1 }),
    ]);
    const storedObjects = await env.ATTACHMENT_STAGING.list({ prefix: 'v1/' });
    expect(storedObjects.objects).toHaveLength(1);
    await expect(uploadOutboundAttachmentChunk(
      env,
      profileId,
      accountId,
      draftKey,
      first.attachment.stageId,
      0,
      Uint8Array.from([1, 2, 4]),
      now,
    )).rejects.toMatchObject({ code: 'attachment_stage_conflict' });
  });

  it('fails closed for incomplete, cross-scope, expired, and tampered stages', async () => {
    const bytes = Uint8Array.from([10, 20, 30]);
    const created = await createStage(bytes);
    await expect(completeOutboundAttachmentStage(
      env,
      profileId,
      accountId,
      draftKey,
      created.attachment.stageId,
      now,
    )).rejects.toMatchObject({ code: 'attachment_stage_incomplete' });
    await expect(uploadOutboundAttachmentChunk(
      env,
      profileId,
      accountId,
      'draft_other',
      created.attachment.stageId,
      0,
      bytes,
      now,
    )).rejects.toMatchObject({ code: 'attachment_stage_not_found' });

    await uploadOutboundAttachmentChunk(
      env,
      profileId,
      accountId,
      draftKey,
      created.attachment.stageId,
      0,
      bytes,
      now,
    );
    const completed = await completeOutboundAttachmentStage(
      env,
      profileId,
      accountId,
      draftKey,
      created.attachment.stageId,
      now,
    );
    const chunk = await env.DB.prepare(
      `SELECT object_key FROM outbound_attachment_chunks
        WHERE profile_id = ? AND stage_id = ? AND chunk_index = 0`,
    ).bind(profileId, created.attachment.stageId).first<{ readonly object_key: string }>();
    await env.ATTACHMENT_STAGING.put(chunk!.object_key, Uint8Array.from([1, 2, 3]));
    await expect(resolveOutboundAttachment(
      env,
      profileId,
      accountId,
      draftKey,
      completed.attachment,
      now,
    )).rejects.toBeInstanceOf(OutboundAttachmentError);

    await env.DB.prepare(
      `UPDATE outbound_attachment_stages SET expires_at = '2026-09-13T00:00:00.000Z'
        WHERE profile_id = ? AND stage_id = ?`,
    ).bind(profileId, created.attachment.stageId).run();
    await expect(resolveOutboundAttachment(
      env,
      profileId,
      accountId,
      draftKey,
      completed.attachment,
      now,
    )).rejects.toMatchObject({ code: 'attachment_stage_expired' });
  });

  it('removes staged ciphertext after a successful send consumes it', async () => {
    const bytes = Uint8Array.from([4, 5, 6]);
    const created = await createStage(bytes);
    await uploadOutboundAttachmentChunk(
      env,
      profileId,
      accountId,
      draftKey,
      created.attachment.stageId,
      0,
      bytes,
      now,
    );
    const completed = await completeOutboundAttachmentStage(
      env,
      profileId,
      accountId,
      draftKey,
      created.attachment.stageId,
      now,
    );
    await consumeOutboundAttachments(env, profileId, [completed.attachment], now);
    const stage = await env.DB.prepare(
      `SELECT file_name, mime_type, size_bytes, sha256_base64url, draft_key
         FROM outbound_attachment_stages
        WHERE profile_id = ? AND stage_id = ?`,
    ).bind(profileId, completed.attachment.stageId).first();
    const chunks = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM outbound_attachment_chunks
        WHERE profile_id = ? AND stage_id = ?`,
    ).bind(profileId, completed.attachment.stageId).first<{ readonly count: number }>();
    // A confirmed send removes the whole staging tombstone so file names,
    // content types, sizes, digests, and draft linkage do not linger in D1.
    expect(stage).toBeNull();
    expect(chunks?.count).toBe(0);
  });

  it('expires a bounded set of whole stages without orphaning chunk objects', async () => {
    const expiredAt = '2026-09-13T00:00:00.000Z';
    const statements: D1PreparedStatement[] = [];
    for (let stageIndex = 0; stageIndex < 21; stageIndex += 1) {
      const stageId = `stage_expired_${stageIndex.toString().padStart(2, '0')}`;
      statements.push(env.DB.prepare(
        `INSERT INTO outbound_attachment_stages
           (profile_id, account_id, stage_id, idempotency_key, draft_key,
            file_name, mime_type, size_bytes, sha256_base64url, chunk_size,
            expected_chunks, received_chunks, received_bytes, state,
            expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'old.txt', 'text/plain', 2,
                 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 1,
                 2, 2, 2, 'ready', ?, ?, ?)`,
      ).bind(
        profileId,
        accountId,
        stageId,
        `expired_${stageIndex}`,
        draftKey,
        expiredAt,
        expiredAt,
        expiredAt,
      ));
      for (let chunkIndex = 0; chunkIndex < 2; chunkIndex += 1) {
        const objectKey = `test-expiry/${stageId}/${chunkIndex}`;
        await env.ATTACHMENT_STAGING.put(objectKey, Uint8Array.from([stageIndex, chunkIndex]));
        statements.push(env.DB.prepare(
          `INSERT INTO outbound_attachment_chunks
             (profile_id, stage_id, chunk_index, size_bytes, sha256_base64url,
              object_key, created_at)
           VALUES (?, ?, ?, 1, 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', ?, ?)`,
        ).bind(profileId, stageId, chunkIndex, objectKey, expiredAt));
      }
    }
    await env.DB.batch(statements);

    await deleteExpiredOutboundAttachments(env, now);

    const remaining = await env.DB.prepare(
      `SELECT s.stage_id, COUNT(c.object_key) AS chunks
         FROM outbound_attachment_stages s
         LEFT JOIN outbound_attachment_chunks c
           ON c.profile_id = s.profile_id AND c.stage_id = s.stage_id
        WHERE s.profile_id = ? AND s.state = 'ready'
        GROUP BY s.stage_id`,
    ).bind(profileId).all<{ readonly stage_id: string; readonly chunks: number }>();
    expect(remaining.results).toEqual([{ stage_id: 'stage_expired_20', chunks: 2 }]);
    const bucket = await env.ATTACHMENT_STAGING.list({ prefix: 'test-expiry/' });
    expect(bucket.objects.map(object => object.key).sort()).toEqual([
      'test-expiry/stage_expired_20/0',
      'test-expiry/stage_expired_20/1',
    ]);
  });
});
