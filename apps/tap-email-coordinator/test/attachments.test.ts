import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sealSecret } from '../src/crypto';
import { maximumGoogleAttachmentBytes } from '../src/google';
import { createTapEmailCoordinator } from '../src/index';

const now = new Date('2026-09-13T01:00:00.000Z');
const route =
  'https://coordinator.example/v1/accounts/google_personal/threads/gmail_thread_1/messages/gmail_message_1/attachments/resource_1';

function encodedBytes(bytes: readonly number[]): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM mail_messages'),
    env.DB.prepare('DELETE FROM mail_threads'),
    env.DB.prepare('DELETE FROM google_credentials'),
    env.DB.prepare('DELETE FROM google_accounts'),
  ]);
  const bodyText = await sealSecret('Attachment', env.GOOGLE_TOKEN_ENCRYPTION_KEY);
  const bodyHtml = await sealSecret('', env.GOOGLE_TOKEN_ENCRYPTION_KEY);
  const refreshToken = await sealSecret('refresh-token', env.GOOGLE_TOKEN_ENCRYPTION_KEY);
  const accessToken = await sealSecret('access-token', env.GOOGLE_TOKEN_ENCRYPTION_KEY);
  const gmailAttachmentId = await sealSecret(
    'gmail_secret_locator',
    env.GOOGLE_TOKEN_ENCRYPTION_KEY,
  );
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO google_accounts
         (profile_id, account_id, google_subject, connection_state,
          coverage_state, unresolved_failures, created_at, updated_at)
       VALUES ('profile_1', 'google_personal', 'google_subject_1', 'active',
               'current', 0, ?, ?)`,
    ).bind(now.toISOString(), now.toISOString()),
    env.DB.prepare(
      `INSERT INTO google_credentials
         (profile_id, account_id, refresh_token_ciphertext,
          access_token_ciphertext, access_token_expires_at, granted_scopes,
          created_at, updated_at)
       VALUES ('profile_1', 'google_personal', ?, ?, ?, 'gmail.modify', ?, ?)`,
    ).bind(
      refreshToken,
      accessToken,
      '2026-09-13T03:00:00.000Z',
      now.toISOString(),
      now.toISOString(),
    ),
    env.DB.prepare(
      `INSERT INTO mail_threads
         (profile_id, account_id, thread_id, history_id, subject, snippet,
          participants_json, received_at, unread, starred, important,
          in_inbox, needs_response, waiting_on_others, label_ids_json, updated_at)
       VALUES ('profile_1', 'google_personal', 'gmail_thread_1', 'history_1',
               'Attachment', 'Attachment', '[]', ?,
               1, 0, 0, 1, 0, 0, '["INBOX"]', ?)`,
    ).bind(now.toISOString(), now.toISOString()),
    env.DB.prepare(
      `INSERT INTO mail_messages
         (profile_id, account_id, thread_id, message_id, internet_message_id,
          sender_json, recipients_json, sent_at, body_text_ciphertext,
          body_html_ciphertext, ordinal, updated_at)
       VALUES ('profile_1', 'google_personal', 'gmail_thread_1', 'gmail_message_1',
               NULL, '{"name":"Sender","address":"sender@example.com"}', '[]',
               ?, ?, ?, 0, ?)`,
    ).bind(now.toISOString(), bodyText, bodyHtml, now.toISOString()),
    env.DB.prepare(
      `INSERT INTO mail_attachments
         (profile_id, account_id, thread_id, message_id, resource_id,
          file_name, mime_type, size_bytes, disposition, content_id,
          gmail_part_path, gmail_attachment_id_ciphertext, updated_at)
       VALUES ('profile_1', 'google_personal', 'gmail_thread_1', 'gmail_message_1',
               'resource_1', 'Q3 "plan".pdf', 'application/pdf', 3,
               'attachment', NULL, 'id:2', ?, ?)`,
    ).bind(gmailAttachmentId, now.toISOString()),
  ]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('attachment content route', () => {
  it('binds stored attachment thread identity to its parent message', async () => {
    await expect(env.DB.prepare(
      `UPDATE mail_attachments
          SET thread_id = 'gmail_thread_other'
        WHERE profile_id = 'profile_1' AND resource_id = 'resource_1'`,
    ).run()).rejects.toThrow();
  });

  it('authorizes the tuple and returns bounded binary bytes with safe headers', async () => {
    const verifyAccess = vi.fn(async () => ({ profileId: 'profile_1' }));
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      expect(url.pathname).toBe(
        '/gmail/v1/users/me/messages/gmail_message_1/attachments/gmail_secret_locator',
      );
      return Response.json({ size: 3, data: encodedBytes([0x00, 0x80, 0xff]) });
    });
    const worker = createTapEmailCoordinator({ verifyAccess, now: () => now });
    const response = await worker.fetch(new Request(route, {
      headers: { Origin: 'http://localhost:3000' },
    }), env);

    expect(response.status).toBe(200);
    expect(verifyAccess).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      Uint8Array.from([0x00, 0x80, 0xff]),
    );
    expect(response.headers.get('Content-Type')).toBe('application/pdf');
    expect(response.headers.get('Content-Length')).toBe('3');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Content-Security-Policy')).toBe("sandbox; default-src 'none'");
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Content-Disposition')).toContain(
      'attachment; filename="Q3 _plan_.pdf"',
    );
    expect(response.headers.get('Content-Disposition')).toContain("filename*=UTF-8''Q3%20%22plan%22.pdf");
  });

  it('strips bidirectional and C1 filename controls from download headers', async () => {
    await env.DB.prepare(
      `UPDATE mail_attachments SET file_name = ?
        WHERE profile_id = 'profile_1' AND resource_id = 'resource_1'`,
    ).bind('report\u061C\u200E\u200F\u202Efdp\u0085.exe').run();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ size: 3, data: encodedBytes([1, 2, 3]) }),
    );
    const worker = createTapEmailCoordinator({
      verifyAccess: async () => ({ profileId: 'profile_1' }),
      now: () => now,
    });

    const response = await worker.fetch(new Request(route), env);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Disposition')).toContain('filename="reportfdp_.exe"');
    expect(response.headers.get('Content-Disposition')).not.toContain('%D8%9C');
    expect(response.headers.get('Content-Disposition')).not.toContain('%E2%80%8E');
    expect(response.headers.get('Content-Disposition')).not.toContain('%E2%80%8F');
    expect(response.headers.get('Content-Disposition')).not.toContain('%E2%80%AE');
    expect(response.headers.get('Content-Disposition')).not.toContain('%C2%85');
  });

  it('re-fetches a full message for an inline data locator', async () => {
    await env.DB.prepare(
      `UPDATE mail_attachments
          SET file_name = 'logo.png', mime_type = 'image/png', disposition = 'inline',
              content_id = 'logo@example', gmail_part_path = 'id:3',
              gmail_attachment_id_ciphertext = NULL
        WHERE profile_id = 'profile_1' AND resource_id = 'resource_1'`,
    ).run();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      expect(url.pathname).toBe('/gmail/v1/users/me/messages/gmail_message_1');
      return Response.json({
        payload: {
          mimeType: 'multipart/related',
          parts: [
            { partId: '1', mimeType: 'text/html', body: { data: encodedBytes([0x41]) } },
            {
              partId: '3',
              mimeType: 'image/png',
              body: { size: 3, data: encodedBytes([0x89, 0x50, 0x4e]) },
            },
          ],
        },
      });
    });
    const worker = createTapEmailCoordinator({
      verifyAccess: async () => ({ profileId: 'profile_1' }),
      now: () => now,
    });
    const response = await worker.fetch(new Request(route), env);

    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      Uint8Array.from([0x89, 0x50, 0x4e]),
    );
    expect(response.headers.get('Content-Disposition')).toContain('inline;');
  });

  it('does not expose locators across profile or tuple boundaries', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    for (const [requestedRoute, profileId] of [
      [route, 'profile_2'],
      [route.replace('gmail_thread_1', 'gmail_thread_2'), 'profile_1'],
      [route.replace('resource_1', 'resource_2'), 'profile_1'],
    ] as const) {
      const worker = createTapEmailCoordinator({
        verifyAccess: async () => ({ profileId }),
        now: () => now,
      });
      const response = await worker.fetch(new Request(requestedRoute), env);
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ error: 'attachment_not_found' });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects malformed identities and oversized metadata before contacting Gmail', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const worker = createTapEmailCoordinator({
      verifyAccess: async () => ({ profileId: 'profile_1' }),
      now: () => now,
    });
    const malformed = await worker.fetch(new Request(route.replace('resource_1', '%20')), env);
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: 'invalid_attachment' });
    const malformedEncoding = await worker.fetch(
      new Request(route.replace('resource_1', '%ZZ')),
      env,
    );
    expect(malformedEncoding.status).toBe(400);
    expect(await malformedEncoding.json()).toMatchObject({ error: 'invalid_attachment' });

    await env.DB.prepare(
      `UPDATE mail_attachments SET size_bytes = ?
        WHERE profile_id = 'profile_1' AND resource_id = 'resource_1'`,
    ).bind(maximumGoogleAttachmentBytes + 1).run();
    const oversized = await worker.fetch(new Request(route), env);
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toMatchObject({ error: 'attachment_too_large' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a structured error when provider bytes do not match stored metadata', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ size: 2, data: encodedBytes([0x01, 0x02]) }),
    );
    const worker = createTapEmailCoordinator({
      verifyAccess: async () => ({ profileId: 'profile_1' }),
      now: () => now,
    });
    const response = await worker.fetch(new Request(route), env);

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: 'attachment_content_invalid',
    });
  });

  it('does not expose a corrupt private provider locator as an internal error', async () => {
    await env.DB.prepare(
      `UPDATE mail_attachments SET gmail_attachment_id_ciphertext = 'not-ciphertext'
        WHERE profile_id = 'profile_1' AND resource_id = 'resource_1'`,
    ).run();
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const worker = createTapEmailCoordinator({
      verifyAccess: async () => ({ profileId: 'profile_1' }),
      now: () => now,
    });
    const response = await worker.fetch(new Request(route), env);

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: 'attachment_content_invalid',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
