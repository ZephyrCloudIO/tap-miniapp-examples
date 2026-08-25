import { env } from 'cloudflare:workers';
import { TAP_EMAIL_PROTOCOL_VERSION, type MailCommand } from '@tap-examples/tap-email-protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeBase64Url, sealSecret } from '../src/crypto';
import { createGoogleProvider } from '../src/google';

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

describe('Google provider writes', () => {
  it('maps Done to an idempotent INBOX label removal', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
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

  it('checkpoints send as a draft and reconciles replay by Message-ID', async () => {
    let sent = false;
    let draftCreates = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === '/gmail/v1/users/me/messages') {
        expect(url.searchParams.get('q')).toBe('rfc822msgid:cmd_send@tap-email.local');
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
        expect(mime).toContain('Message-ID: <cmd_send@tap-email.local>');
        expect(mime).toContain('To: maya@example.com');
        expect(mime).toContain('Ship it.');
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
      providerRevision: 'history_12',
    });
    expect(draftCreates).toBe(1);
  });

  it('marks an interrupted final send as uncertain instead of retrying blindly', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === '/gmail/v1/users/me/messages') return Response.json({});
      if (url.pathname === '/gmail/v1/users/me/drafts' && init?.method !== 'POST') {
        return Response.json({});
      }
      if (url.pathname === '/gmail/v1/users/me/drafts' && init?.method === 'POST') {
        return Response.json({ id: 'draft_uncertain' });
      }
      if (url.pathname === '/gmail/v1/users/me/drafts/send') {
        throw new TypeError('connection reset after request write');
      }
      throw new Error(`Unexpected Google request: ${url}`);
    });
    const provider = createGoogleProvider(env, () => now);
    await expect(provider.execute(scope, command({
      commandId: 'cmd_uncertain',
      idempotencyKey: 'tap-email:google_1:cmd_uncertain',
      threadId: null,
      kind: 'send_draft',
      payload: {
        to: 'maya@example.com',
        subject: 'Launch decision',
        bodyText: 'Ship it.',
      },
    }))).resolves.toEqual({
      outcome: 'uncertain',
      errorCode: 'gmail_send_outcome_unknown',
    });
  });
});
