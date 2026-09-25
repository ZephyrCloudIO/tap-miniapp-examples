import PostalMime from 'postal-mime';
import { env } from 'cloudflare:workers';
import { TAP_EMAIL_PROTOCOL_VERSION, type MailCommand } from '@tap-examples/tap-email-protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeBase64Url, sealSecret, sha256BytesBase64Url } from '../src/crypto';
import {
  accessTokenFor,
  createGoogleProvider,
  googleAttachmentBytes,
  googleJson,
  maximumGoogleAttachmentBytes,
} from '../src/google';
import {
  completeOutboundAttachmentStage,
  createOutboundAttachmentStage,
  uploadOutboundAttachmentChunk,
} from '../src/outbound-attachments';

const now = new Date('2026-08-18T15:30:00.000Z');
const encryptionKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const scope = { profileId: 'profile_1', accountId: 'google_1' };

function command(overrides: Partial<MailCommand> = {}): MailCommand {
  return {
    v: TAP_EMAIL_PROTOCOL_VERSION,
    commandId: 'cmd_1',
    idempotencyKey: 'tap-email:google_1:cmd_1',
    accountId: 'google_1',
    threadId: 'thread_1',
    kind: 'archive',
    createdAt: now.toISOString(),
    expectedProviderRevision: 'history_9',
    payload: {},
    ...overrides,
  };
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM google_credentials'),
    env.DB.prepare('DELETE FROM google_accounts'),
  ]);
  const accessToken = await sealSecret('access-token', encryptionKey);
  const refreshToken = await sealSecret('refresh-token', encryptionKey);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO google_accounts
         (profile_id, account_id, google_subject, connection_state,
          coverage_state, unresolved_failures, email_address, created_at, updated_at)
       VALUES ('profile_1', 'google_1', 'subject_1', 'active', 'current', 0,
               'zack@example.com', ?, ?)`,
    ).bind(now.toISOString(), now.toISOString()),
    env.DB.prepare(
      `INSERT INTO google_credentials
         (profile_id, account_id, refresh_token_ciphertext,
          access_token_ciphertext, access_token_expires_at, granted_scopes,
          created_at, updated_at)
       VALUES ('profile_1', 'google_1', ?, ?, ?, 'gmail.modify', ?, ?)`,
    ).bind(
      refreshToken,
      accessToken,
      '2026-08-18T17:30:00.000Z',
      now.toISOString(),
      now.toISOString(),
    ),
  ]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function encodedBytes(bytes: readonly number[]): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

describe('Google API failures', () => {
  it.each([
    {
      name: 'legacy per-user rate limit reason',
      payload: {
        error: {
          errors: [{ domain: 'usageLimits', reason: 'userRateLimitExceeded' }],
        },
      },
      providerReason: 'userRateLimitExceeded',
    },
    {
      name: 'structured resource-exhausted status',
      payload: {
        error: {
          status: 'RESOURCE_EXHAUSTED',
          details: [{ reason: 'RATE_LIMIT_EXCEEDED' }],
        },
      },
      providerReason: 'RATE_LIMIT_EXCEEDED',
    },
  ])('treats a 403 $name as temporary', async ({ payload, providerReason }) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(payload, { status: 403 }));

    await expect(googleJson('access-token', '/gmail/v1/users/me/profile')).rejects.toMatchObject({
      status: 403,
      code: 'google_temporarily_unavailable',
      providerReason,
    });
  });

  it('does not turn a non-quota 403 into an authorization failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({
      error: {
        errors: [{ reason: 'domainPolicy' }],
        status: 'PERMISSION_DENIED',
      },
    }, { status: 403 }));

    await expect(googleJson('access-token', '/gmail/v1/users/me/profile')).rejects.toMatchObject({
      status: 403,
      code: 'google_request_rejected',
      providerReason: 'domainPolicy',
    });
  });

  it.each([429, 500, 503])('treats HTTP %i as temporary', async status => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ error: {} }, { status }));

    await expect(googleJson('access-token', '/gmail/v1/users/me/profile')).rejects.toMatchObject({
      status,
      code: 'google_temporarily_unavailable',
    });
  });

  it('requires reauthorization for a 401', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({
      error: { errors: [{ reason: 'authError' }] },
    }, { status: 401 }));

    await expect(googleJson('access-token', '/gmail/v1/users/me/profile')).rejects.toMatchObject({
      status: 401,
      code: 'google_reauthorization_required',
      providerReason: 'authError',
    });
  });

  it('marks invalid refresh grants as reauthorization-required before throwing', async () => {
    await env.DB.prepare(
      `UPDATE google_credentials
          SET access_token_ciphertext = NULL, access_token_expires_at = NULL
        WHERE profile_id = ? AND account_id = ?`,
    ).bind(scope.profileId, scope.accountId).run();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(
      { error: 'invalid_grant' },
      { status: 400 },
    ));

    await expect(accessTokenFor(env, scope, now)).rejects.toMatchObject({
      status: 401,
      code: 'google_reauthorization_required',
      providerReason: 'invalid_grant',
    });
    const account = await env.DB.prepare(
      `SELECT connection_state, coverage_state
         FROM google_accounts
        WHERE profile_id = ? AND account_id = ?`,
    ).bind(scope.profileId, scope.accountId).first<{
      connection_state: string;
      coverage_state: string;
    }>();
    expect(account).toEqual({
      connection_state: 'reauthorization_required',
      coverage_state: 'blocked',
    });
  });
});

describe('Google attachment reads', () => {
  it('decodes attachment bytes without passing them through UTF-8 text', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      expect(url.pathname).toBe(
        '/gmail/v1/users/me/messages/message_1/attachments/provider_attachment_1',
      );
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-token');
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return Response.json({ size: 3, data: encodedBytes([0x00, 0x80, 0xff]) });
    });

    await expect(googleAttachmentBytes('access-token', 'message_1', {
      attachmentId: 'provider_attachment_1',
      partPath: 'id:1',
    })).resolves.toEqual(Uint8Array.from([0x00, 0x80, 0xff]));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('re-fetches a full message and resolves inline body data by MIME part path', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      expect(url.pathname).toBe('/gmail/v1/users/me/messages/message_1');
      expect(url.searchParams.get('format')).toBe('full');
      expect(url.searchParams.get('fields')).toBe('payload');
      return Response.json({
        payload: {
          mimeType: 'multipart/mixed',
          parts: [
            { mimeType: 'text/plain', body: { data: encodedBytes([0x41]) } },
            {
              mimeType: 'multipart/related',
              parts: [
                { mimeType: 'text/html', body: { data: encodedBytes([0x42]) } },
                { mimeType: 'image/png', body: { size: 3, data: encodedBytes([0x00, 0x80, 0xff]) } },
              ],
            },
          ],
        },
      });
    });

    await expect(googleAttachmentBytes('access-token', 'message_1', {
      attachmentId: null,
      partPath: 'path:1.1',
    })).resolves.toEqual(Uint8Array.from([0x00, 0x80, 0xff]));
  });

  it('rejects malformed or oversized provider bodies with attachment-specific errors', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ size: 2, data: encodedBytes([0x01]) }))
      .mockResolvedValueOnce(Response.json({
        size: maximumGoogleAttachmentBytes + 1,
        data: '',
      }));

    await expect(googleAttachmentBytes('access-token', 'message_1', {
      attachmentId: 'bad_size',
      partPath: 'id:0',
    })).rejects.toMatchObject({
      status: 502,
      code: 'attachment_content_invalid',
    });
    await expect(googleAttachmentBytes('access-token', 'message_1', {
      attachmentId: 'too_large',
      partPath: 'id:0',
    })).rejects.toMatchObject({
      status: 413,
      code: 'attachment_too_large',
    });
  });

  it('does not mislabel an oversized containing message as an oversized attachment', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', {
      headers: { 'Content-Length': String(20 * 1_024 * 1_024) },
    }));

    await expect(googleAttachmentBytes('access-token', 'message_1', {
      attachmentId: null,
      partPath: 'path:1.1',
    })).rejects.toMatchObject({
      status: 502,
      code: 'attachment_content_invalid',
      message: 'The containing Gmail message is too large to resolve this inline attachment safely.',
    });
  });
});

describe('Google provider writes', () => {
  it('decorates authoritative Gmail draft edits only in the final send request', async () => {
    const url = `https://theaiplatform.app/refer/${'c'.repeat(32)}?utm_source=tap_email&utm_medium=email&utm_campaign=sent_with&utm_content=signature`;
    let savedRaw = '';
    let finalRaw = '';
    let sent = false;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const target = new URL(String(input));
      if (target.pathname.endsWith('/messages')) return Response.json({});
      if (target.pathname.endsWith('/drafts') && init?.method !== 'POST') return Response.json({});
      if (target.pathname.endsWith('/drafts') && init?.method === 'POST') {
        savedRaw = JSON.parse(String(init.body)).message.raw;
        expect((await PostalMime.parse(decodeBase64Url(savedRaw, 100_000))).html).not.toContain('Sent with TAP Email');
        return Response.json({ id: 'edited_draft' });
      }
      if (target.pathname.endsWith('/drafts/edited_draft')) {
        expect(target.searchParams.get('format')).toBe('raw');
        const mime = [
          'To: edited@example.com', 'Subject: Edited in Gmail',
          'Message-ID: <draft_edited@tap-email.local>', 'In-Reply-To: <original@example.com>',
          'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="edited"', '',
          '--edited', 'Content-Type: text/html; charset=UTF-8', '', '<p>Gmail edit</p><p>My signature</p>',
          '--edited', 'Content-Type: application/octet-stream',
          'Content-Disposition: attachment; filename="binary.dat"', 'Content-Transfer-Encoding: base64', '', 'AID/',
          '--edited--', '',
        ].join('\r\n');
        return Response.json({ id: 'edited_draft', message: { raw: btoa(mime).replaceAll('+', '-').replaceAll('/', '_'), threadId: 'authoritative_thread' } });
      }
      if (target.pathname.endsWith('/drafts/send')) {
        const body = JSON.parse(String(init?.body));
        expect(body.id).toBe('edited_draft');
        expect(body.message.threadId).toBe('authoritative_thread');
        finalRaw = body.message.raw;
        sent = true;
        return Response.json({ id: 'sent_edited', historyId: 'history_edited' });
      }
      throw new Error(`Unexpected Google request: ${target}`);
    });
    const provider = createGoogleProvider(env, () => now);
    const payload = { draftKey: 'draft_edited', draftRevision: 1, to: 'old@example.com', subject: 'Old', bodyText: 'Local body' };
    await expect(provider.execute(scope, command({ kind: 'save_draft', payload }))).resolves.toMatchObject({ outcome: 'acknowledged' });
    await expect(provider.execute({ ...scope, referralUrl: url }, command({ kind: 'send_draft', commandId: 'send_edited', payload })))
      .resolves.toMatchObject({ outcome: 'acknowledged' });
    expect(sent).toBe(true);
    const parsed = await PostalMime.parse(decodeBase64Url(finalRaw, 100_000));
    expect(parsed.subject).toBe('Edited in Gmail');
    expect(parsed.inReplyTo).toBe('<original@example.com>');
    expect(parsed.html).toContain('My signature</p><div data-tap-sent-with');
    expect(parsed.html).toContain('The AI Platform</a>');
    expect(parsed.html).not.toContain('Local body');
    expect(new Uint8Array(parsed.attachments[0]!.content as ArrayBuffer)).toEqual(Uint8Array.from([0, 128, 255]));
  });

  it('maps Done to an idempotent INBOX label removal', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (init?.method !== 'POST') {
        expect(url.pathname).toBe('/gmail/v1/users/me/threads/thread_1');
        expect(url.searchParams.get('format')).toBe('minimal');
        return Response.json({ id: 'thread_1', historyId: 'history_9' });
      }
      expect(url.pathname).toBe('/gmail/v1/users/me/threads/thread_1/modify');
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body))).toEqual({
        addLabelIds: [],
        removeLabelIds: ['INBOX'],
      });
      return Response.json({ id: 'thread_1', historyId: 'history_10' });
    });
    const provider = createGoogleProvider(env, () => now);
    await expect(provider.execute(scope, command())).resolves.toEqual({
      outcome: 'acknowledged',
      providerRevision: 'history_10',
    });
  });

  it('does not archive a thread that changed after the reviewed projection', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({
      id: 'thread_1',
      historyId: 'history_new_reply',
    }));
    const provider = createGoogleProvider(env, () => now);

    await expect(provider.execute(scope, command())).resolves.toEqual({
      outcome: 'failed',
      errorCode: 'provider_revision_conflict',
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      kind: 'mark_read' as const,
      labels: { addLabelIds: [], removeLabelIds: ['UNREAD'] },
    },
    {
      kind: 'mark_unread' as const,
      labels: { addLabelIds: ['UNREAD'], removeLabelIds: [] },
    },
  ])('maps $kind to the Gmail UNREAD label mutation', async ({ kind, labels }) => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      expect(url.pathname).toBe('/gmail/v1/users/me/threads/thread_1/modify');
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body))).toEqual(labels);
      return Response.json({ id: 'thread_1', historyId: 'history_10' });
    });
    const provider = createGoogleProvider(env, () => now);
    await expect(provider.execute(scope, command({ kind }))).resolves.toEqual({
      outcome: 'acknowledged',
      providerRevision: 'history_10',
    });
  });

  it('creates and updates one provider-visible draft while ignoring stale autosaves', async () => {
    let writes = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === '/gmail/v1/users/me/drafts' && init?.method !== 'POST') {
        expect(url.searchParams.get('q')).toBe(
          'rfc822msgid:draft_reply_1@tap-email.local',
        );
        return Response.json({});
      }
      if (
        (url.pathname === '/gmail/v1/users/me/drafts' && init?.method === 'POST') ||
        (url.pathname === '/gmail/v1/users/me/drafts/draft_1' && init?.method === 'PUT')
      ) {
        writes += 1;
        const body = JSON.parse(String(init.body)) as { message: { raw: string } };
        const mime = decodeBase64Url(body.message.raw, 100_000);
        expect(mime).toContain('Message-ID: <draft_reply_1@tap-email.local>');
        expect(mime).toContain(`X-TAP-Draft-Revision: ${writes}`);
        const parsed = await PostalMime.parse(mime);
        expect(parsed.text).toContain(writes === 1 ? 'First version' : 'Second version');
        expect(parsed.html).toContain(writes === 1 ? 'First version' : 'Second version');
        expect(parsed.html).not.toContain('Sent with TAP Email');
        return Response.json({
          id: 'draft_1',
          message: { historyId: `history_${writes}` },
        });
      }
      throw new Error(`Unexpected Google request: ${url}`);
    });

    const provider = createGoogleProvider(env, () => now);
    const save = (revision: number, bodyText: string) => command({
      commandId: `cmd_save_${revision}_${bodyText.startsWith('First') ? 'a' : 'b'}`,
      idempotencyKey: `tap-email:google_1:save:${revision}:${bodyText.length}`,
      kind: 'save_draft',
      payload: {
        draftKey: 'draft_reply_1',
        draftRevision: revision,
        to: 'maya@example.com',
        subject: 'Re: Launch review',
        bodyText,
        replyToMessageId: '<message-1@example.com>',
      },
    });

    await expect(provider.execute(scope, save(1, 'First version'))).resolves.toEqual({
      outcome: 'acknowledged',
      providerRevision: 'history_1',
    });
    await expect(provider.execute(scope, save(2, 'Second version'))).resolves.toEqual({
      outcome: 'acknowledged',
      providerRevision: 'history_2',
    });
    await expect(provider.execute(scope, save(1, 'Stale version'))).resolves.toEqual({
      outcome: 'acknowledged',
      providerRevision: null,
    });
    expect(writes).toBe(2);
    await expect(env.DB.prepare(
      `SELECT provider_draft_id, latest_revision, state
         FROM provider_drafts
        WHERE profile_id = 'profile_1' AND account_id = 'google_1'
          AND draft_key = 'draft_reply_1'`,
    ).first()).resolves.toEqual({
      provider_draft_id: 'draft_1',
      latest_revision: 2,
      state: 'active',
    });
  });

  it('does not recreate a provider draft deleted outside TAP Email', async () => {
    let creates = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === '/gmail/v1/users/me/drafts' && init?.method !== 'POST') {
        return Response.json({});
      }
      if (url.pathname === '/gmail/v1/users/me/drafts' && init?.method === 'POST') {
        creates += 1;
        return Response.json({ id: 'draft_deleted_elsewhere', message: { historyId: 'history_1' } });
      }
      if (url.pathname === '/gmail/v1/users/me/drafts/draft_deleted_elsewhere') {
        return Response.json({ error: { message: 'not found' } }, { status: 404 });
      }
      throw new Error(`Unexpected Google request: ${url}`);
    });
    const provider = createGoogleProvider(env, () => now);
    const save = (revision: number) => command({
      commandId: `cmd_deleted_${revision}`,
      idempotencyKey: `tap-email:google_1:deleted:${revision}`,
      kind: 'save_draft',
      payload: {
        draftKey: 'draft_deleted',
        draftRevision: revision,
        to: 'maya@example.com',
        subject: 'Deleted elsewhere',
        bodyText: `Revision ${revision}`,
      },
    });

    await expect(provider.execute(scope, save(1))).resolves.toMatchObject({
      outcome: 'acknowledged',
    });
    await expect(provider.execute(scope, save(2))).resolves.toEqual({
      outcome: 'failed',
      errorCode: 'provider_draft_deleted',
    });
    expect(creates).toBe(1);
    await expect(env.DB.prepare(
      `SELECT provider_draft_id, latest_revision, state
         FROM provider_drafts
        WHERE profile_id = 'profile_1' AND account_id = 'google_1'
          AND draft_key = 'draft_deleted'`,
    ).first()).resolves.toEqual({
      provider_draft_id: null,
      latest_revision: 2,
      state: 'discarded',
    });
  });

  it('adds only ready draft-bound attachment stages to provider MIME', async () => {
    const attachmentBytes = Uint8Array.from([0, 128, 255]);
    const staged = await createOutboundAttachmentStage(
      env,
      scope.profileId,
      scope.accountId,
      'draft_attachment',
      {
        idempotencyKey: 'attachment_contract',
        fileName: 'Q3 contract.pdf',
        mimeType: 'application/pdf',
        sizeBytes: attachmentBytes.byteLength,
        sha256Base64Url: await sha256BytesBase64Url(attachmentBytes),
      },
      now,
    );
    await uploadOutboundAttachmentChunk(
      env,
      scope.profileId,
      scope.accountId,
      'draft_attachment',
      staged.attachment.stageId,
      0,
      attachmentBytes,
      now,
    );
    const ready = await completeOutboundAttachmentStage(
      env,
      scope.profileId,
      scope.accountId,
      'draft_attachment',
      staged.attachment.stageId,
      now,
    );
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === '/gmail/v1/users/me/drafts' && init?.method !== 'POST') {
        return Response.json({});
      }
      if (url.pathname === '/gmail/v1/users/me/drafts' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { message: { raw: string } };
        const mime = decodeBase64Url(body.message.raw, 1_000_000);
        expect(mime).toContain('Content-Type: multipart/mixed;');
        expect(mime).toContain('Content-Disposition: attachment; filename="Q3 contract.pdf"');
        expect(mime).toContain('Content-Transfer-Encoding: base64\r\n\r\nAID/');
        expect(mime).not.toContain(staged.attachment.stageId);
        return Response.json({ id: 'draft_attachment_1' });
      }
      throw new Error(`Unexpected Google request: ${url}`);
    });

    const provider = createGoogleProvider(env, () => now);
    await expect(provider.execute(scope, command({
      commandId: 'cmd_attachment_save',
      idempotencyKey: 'tap-email:google_1:cmd_attachment_save',
      threadId: null,
      kind: 'save_draft',
      payload: {
        draftKey: 'draft_attachment',
        draftRevision: 1,
        to: 'maya@example.com',
        subject: 'Contract',
        bodyText: 'Attached.',
        attachments: [ready.attachment],
      },
    }))).resolves.toEqual({ outcome: 'acknowledged', providerRevision: null });
  });

  it('fails closed before contacting Gmail when an attachment stage is missing', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const provider = createGoogleProvider(env, () => now);
    await expect(provider.execute(scope, command({
      commandId: 'cmd_missing_attachment',
      idempotencyKey: 'tap-email:google_1:cmd_missing_attachment',
      threadId: null,
      kind: 'save_draft',
      payload: {
        draftKey: 'draft_missing_attachment',
        draftRevision: 1,
        to: 'maya@example.com',
        subject: 'Contract',
        bodyText: 'Attached.',
        attachments: [{
          stageId: 'stage_missing',
          fileName: 'contract.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 3,
          sha256Base64Url: 'A'.repeat(43),
        }],
      },
    }))).resolves.toEqual({
      outcome: 'failed',
      errorCode: 'attachment_stage_not_found',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('checkpoints send as a draft and reconciles replay by Message-ID', async () => {
    let sent = false;
    let draftCreates = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === '/gmail/v1/users/me/messages') {
        expect(url.searchParams.get('q')).toBe('rfc822msgid:draft_send@tap-email.local');
        return Response.json(sent ? { messages: [{ id: 'sent_1' }] } : {});
      }
      if (url.pathname === '/gmail/v1/users/me/messages/sent_1') {
        return Response.json({
          id: 'sent_1',
          historyId: 'history_12',
          labelIds: ['SENT'],
        });
      }
      if (url.pathname === '/gmail/v1/users/me/drafts' && init?.method !== 'POST') {
        return Response.json({});
      }
      if (url.pathname === '/gmail/v1/users/me/drafts' && init?.method === 'POST') {
        draftCreates += 1;
        const body = JSON.parse(String(init.body)) as { message: { raw: string } };
        const mime = decodeBase64Url(body.message.raw, 100_000);
        expect(mime).toContain('Message-ID: <draft_send@tap-email.local>');
        expect(mime).toContain('To: maya@example.com');
        expect((await PostalMime.parse(mime)).html).toContain('Ship it.');
        return Response.json({ id: 'draft_1' });
      }
      if (url.pathname === '/gmail/v1/users/me/drafts/send') {
        sent = true;
        return Response.json({ id: 'sent_1', historyId: 'history_11' });
      }
      throw new Error(`Unexpected Google request: ${url}`);
    });

    const provider = createGoogleProvider(env, () => now);
    const send = command({
      commandId: 'cmd_send',
      idempotencyKey: 'tap-email:google_1:cmd_send',
      threadId: null,
      kind: 'send_draft',
      payload: {
        draftKey: 'draft_send',
        draftRevision: 1,
        to: 'maya@example.com',
        subject: 'Launch decision',
        bodyText: 'Ship it.',
      },
    });
    await expect(provider.execute(scope, send)).resolves.toEqual({
      outcome: 'acknowledged',
      providerRevision: 'history_11',
    });
    await expect(provider.execute(scope, send)).resolves.toEqual({
      outcome: 'acknowledged',
      providerRevision: null,
    });
    expect(draftCreates).toBe(1);
    await expect(env.DB.prepare(
      `SELECT provider_draft_id, latest_revision, state
         FROM provider_drafts
        WHERE profile_id = 'profile_1' AND account_id = 'google_1'
          AND draft_key = 'draft_send'`,
    ).first()).resolves.toEqual({
      provider_draft_id: null,
      latest_revision: 1,
      state: 'sent',
    });
  });

  it('keeps staged attachment bytes through an uncertain send and reuses the provider draft on retry', async () => {
    const attachmentBytes = new TextEncoder().encode('private attachment');
    const staged = await createOutboundAttachmentStage(
      env,
      scope.profileId,
      scope.accountId,
      'draft_uncertain',
      {
        idempotencyKey: 'attachment_uncertain',
        fileName: 'notes.txt',
        mimeType: 'text/plain',
        sizeBytes: attachmentBytes.byteLength,
        sha256Base64Url: await sha256BytesBase64Url(attachmentBytes),
      },
      now,
    );
    await uploadOutboundAttachmentChunk(
      env,
      scope.profileId,
      scope.accountId,
      'draft_uncertain',
      staged.attachment.stageId,
      0,
      attachmentBytes,
      now,
    );
    const ready = await completeOutboundAttachmentStage(
      env,
      scope.profileId,
      scope.accountId,
      'draft_uncertain',
      staged.attachment.stageId,
      now,
    );
    let draftCreates = 0;
    let draftLists = 0;
    let sendAttempts = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === '/gmail/v1/users/me/messages') return Response.json({});
      if (url.pathname === '/gmail/v1/users/me/drafts' && init?.method !== 'POST') {
        draftLists += 1;
        return Response.json({});
      }
      if (url.pathname === '/gmail/v1/users/me/drafts' && init?.method === 'POST') {
        draftCreates += 1;
        const body = JSON.parse(String(init.body)) as { message: { raw: string } };
        expect(decodeBase64Url(body.message.raw, 100_000)).toContain(
          btoa('private attachment'),
        );
        return Response.json({ id: 'draft_uncertain' });
      }
      if (url.pathname === '/gmail/v1/users/me/drafts/send') {
        sendAttempts += 1;
        if (sendAttempts === 1) throw new TypeError('connection reset after request write');
        return Response.json({ id: 'sent_uncertain', historyId: 'history_uncertain' });
      }
      throw new Error(`Unexpected Google request: ${url}`);
    });
    const provider = createGoogleProvider(env, () => now);
    const send = command({
      commandId: 'cmd_uncertain',
      idempotencyKey: 'tap-email:google_1:cmd_uncertain',
      threadId: null,
      kind: 'send_draft',
      payload: {
        draftKey: 'draft_uncertain',
        draftRevision: 1,
        to: 'maya@example.com',
        subject: 'Launch decision',
        bodyText: 'Ship it.',
        attachments: [ready.attachment],
      },
    });
    await expect(provider.execute(scope, send)).resolves.toEqual({
      outcome: 'uncertain',
      errorCode: 'gmail_send_outcome_unknown',
    });
    await expect(env.DB.prepare(
      `SELECT state FROM outbound_attachment_stages
        WHERE profile_id = ? AND stage_id = ?`,
    ).bind(scope.profileId, ready.attachment.stageId).first()).resolves.toEqual({
      state: 'ready',
    });

    await expect(provider.execute(scope, send)).resolves.toEqual({
      outcome: 'acknowledged',
      providerRevision: 'history_uncertain',
    });
    expect({ draftCreates, draftLists, sendAttempts }).toEqual({
      draftCreates: 1,
      draftLists: 1,
      sendAttempts: 2,
    });
    await expect(env.DB.prepare(
      `SELECT state FROM outbound_attachment_stages
        WHERE profile_id = ? AND stage_id = ?`,
    ).bind(scope.profileId, ready.attachment.stageId).first()).resolves.toBeNull();
    await expect(env.DB.prepare(
      `SELECT COUNT(*) AS count FROM outbound_attachment_chunks
        WHERE profile_id = ? AND stage_id = ?`,
    ).bind(scope.profileId, ready.attachment.stageId).first()).resolves.toEqual({
      count: 0,
    });
  });
});
