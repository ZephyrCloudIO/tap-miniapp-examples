import type { MailCommand } from '@tap-examples/tap-email-protocol';
import { encodeBase64, encodeBase64Url, openSecret, sealSecret } from './crypto';
import type {
  GoogleProviderPort,
  ProviderExecutionResult,
  ProviderScope,
} from './provider';

const gmailOrigin = 'https://gmail.googleapis.com';
const tokenEndpoint = 'https://oauth2.googleapis.com/token';
const maximumGoogleResponseBytes = 2_097_152;

export class GoogleApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function readBoundedJson(
  response: Response,
  maximum = maximumGoogleResponseBytes,
): Promise<unknown> {
  const declared = Number(response.headers.get('Content-Length') ?? '0');
  if (Number.isFinite(declared) && declared > maximum) {
    throw new GoogleApiError(502, 'google_response_too_large', 'Google returned an oversized response.');
  }
  if (!response.body) return {};
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > maximum) {
      await reader.cancel('response too large');
      throw new GoogleApiError(502, 'google_response_too_large', 'Google returned an oversized response.');
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  try {
    return JSON.parse(text + decoder.decode());
  } catch {
    throw new GoogleApiError(502, 'google_response_invalid', 'Google returned invalid JSON.');
  }
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GoogleApiError(502, 'google_response_invalid', 'Google returned an invalid response.');
  }
  return value as Readonly<Record<string, unknown>>;
}

function googleFailure(status: number): GoogleApiError {
  if (status === 401 || status === 403) {
    return new GoogleApiError(status, 'google_reauthorization_required', 'Google authorization must be renewed.');
  }
  if (status === 404) {
    return new GoogleApiError(status, 'google_object_not_found', 'The Gmail object no longer exists.');
  }
  if (status === 429 || status >= 500) {
    return new GoogleApiError(status, 'google_temporarily_unavailable', 'Google is temporarily unavailable.');
  }
  return new GoogleApiError(status, 'google_request_rejected', 'Google rejected the mailbox request.');
}

interface CredentialRow {
  readonly refresh_token_ciphertext: string;
  readonly access_token_ciphertext: string | null;
  readonly access_token_expires_at: string | null;
}

export async function accessTokenFor(
  env: Env,
  scope: ProviderScope,
  now: Date,
): Promise<string> {
  const row = await env.DB.prepare(
    `SELECT refresh_token_ciphertext, access_token_ciphertext,
            access_token_expires_at
       FROM google_credentials
      WHERE profile_id = ? AND account_id = ?`,
  )
    .bind(scope.profileId, scope.accountId)
    .first<CredentialRow>();
  if (!row) {
    throw new GoogleApiError(401, 'google_connection_required', 'Connect this Google account again.');
  }
  if (
    row.access_token_ciphertext &&
    row.access_token_expires_at &&
    Date.parse(row.access_token_expires_at) > now.getTime() + 60_000
  ) {
    return openSecret(row.access_token_ciphertext, env.GOOGLE_TOKEN_ENCRYPTION_KEY);
  }

  const refreshToken = await openSecret(
    row.refresh_token_ciphertext,
    env.GOOGLE_TOKEN_ENCRYPTION_KEY,
  );
  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  const payload = record(await readBoundedJson(response, 65_536));
  if (!response.ok || typeof payload.access_token !== 'string') {
    if (payload.error === 'invalid_grant') {
      await env.DB.prepare(
        `UPDATE google_accounts
            SET connection_state = 'reauthorization_required',
                coverage_state = 'blocked', updated_at = ?
          WHERE profile_id = ? AND account_id = ?`,
      )
        .bind(now.toISOString(), scope.profileId, scope.accountId)
        .run();
    }
    throw googleFailure(response.status);
  }
  const expiresIn =
    typeof payload.expires_in === 'number' && Number.isFinite(payload.expires_in)
      ? Math.max(60, payload.expires_in)
      : 3_600;
  const expiresAt = new Date(now.getTime() + expiresIn * 1_000).toISOString();
  await env.DB.prepare(
    `UPDATE google_credentials
        SET access_token_ciphertext = ?, access_token_expires_at = ?, updated_at = ?
      WHERE profile_id = ? AND account_id = ?`,
  )
    .bind(
      await sealSecret(payload.access_token, env.GOOGLE_TOKEN_ENCRYPTION_KEY),
      expiresAt,
      now.toISOString(),
      scope.profileId,
      scope.accountId,
    )
    .run();
  return payload.access_token;
}

export async function googleJson(
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<Readonly<Record<string, unknown>>> {
  const url = new URL(path, gmailOrigin);
  if (url.origin !== gmailOrigin) {
    throw new GoogleApiError(500, 'google_url_invalid', 'The Google API URL is invalid.');
  }
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new GoogleApiError(503, 'google_transport_error', 'The Google request did not complete.');
  }
  const payload = record(await readBoundedJson(response));
  if (!response.ok) throw googleFailure(response.status);
  return payload;
}

function stringArray(value: unknown, maximum = 100): readonly string[] | null {
  if (!Array.isArray(value) || value.length > maximum) return null;
  if (!value.every(item => typeof item === 'string' && item.length <= 256)) return null;
  return value;
}

function labelsFor(command: MailCommand): {
  readonly addLabelIds: readonly string[];
  readonly removeLabelIds: readonly string[];
} | null {
  if (command.kind === 'archive') return { addLabelIds: [], removeLabelIds: ['INBOX'] };
  if (command.kind === 'mark_read') return { addLabelIds: [], removeLabelIds: ['UNREAD'] };
  if (command.kind === 'mark_unread') return { addLabelIds: ['UNREAD'], removeLabelIds: [] };
  if (command.kind === 'star') return { addLabelIds: ['STARRED'], removeLabelIds: [] };
  if (command.kind === 'unstar') return { addLabelIds: [], removeLabelIds: ['STARRED'] };
  if (command.kind !== 'apply_labels') return null;
  const payload = command.payload as Readonly<Record<string, unknown>>;
  const addLabelIds = stringArray(payload.addLabelIds);
  const removeLabelIds = stringArray(payload.removeLabelIds);
  return addLabelIds && removeLabelIds ? { addLabelIds, removeLabelIds } : null;
}

function safeHeader(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) return null;
  if (/\r|\n/u.test(value)) return null;
  return value;
}

function encodedSubject(value: string): string {
  if (/^[\x20-\x7E]*$/u.test(value)) return value;
  return `=?UTF-8?B?${encodeBase64(value)}?=`;
}

function mimeFor(command: MailCommand): { readonly raw: string; readonly threadId?: string } | null {
  const payload = command.payload as Readonly<Record<string, unknown>>;
  const to = safeHeader(payload.to, 2_000);
  const subject = safeHeader(payload.subject, 998);
  const bodyText = typeof payload.bodyText === 'string' && payload.bodyText.length <= 500_000
    ? payload.bodyText
    : null;
  if (!to || !subject || bodyText === null) return null;
  const messageIdentity = `${command.commandId}@tap-email.local`;
  const headers = [
    `To: ${to}`,
    `Subject: ${encodedSubject(subject)}`,
    `Message-ID: <${messageIdentity}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    `X-TAP-Command-ID: ${command.commandId}`,
  ];
  const replyTo = safeHeader(payload.replyToMessageId, 998);
  if (replyTo) headers.splice(3, 0, `In-Reply-To: ${replyTo}`, `References: ${replyTo}`);
  return {
    raw: encodeBase64Url(`${headers.join('\r\n')}\r\n\r\n${bodyText.replaceAll('\n', '\r\n')}`),
    ...(command.threadId ? { threadId: command.threadId } : {}),
  };
}

async function executeSend(
  accessToken: string,
  command: MailCommand,
): Promise<ProviderExecutionResult> {
  const mime = mimeFor(command);
  if (!mime) return { outcome: 'failed', errorCode: 'invalid_message' };
  const identity = `${command.commandId}@tap-email.local`;
  const search = await googleJson(
    accessToken,
    `/gmail/v1/users/me/messages?maxResults=10&includeSpamTrash=true&q=${encodeURIComponent(`rfc822msgid:${identity}`)}`,
  );
  const messages = Array.isArray(search.messages) ? search.messages : [];
  for (const item of messages) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const listed = item as Readonly<Record<string, unknown>>;
    if (typeof listed.id !== 'string') continue;
    const message = await googleJson(
      accessToken,
      `/gmail/v1/users/me/messages/${encodeURIComponent(listed.id)}?format=minimal`,
    );
    if (Array.isArray(message.labelIds) && message.labelIds.includes('SENT')) {
      return {
        outcome: 'acknowledged',
        providerRevision: typeof message.historyId === 'string' ? message.historyId : null,
      };
    }
  }

  const drafts = await googleJson(
    accessToken,
    `/gmail/v1/users/me/drafts?maxResults=10&q=${encodeURIComponent(`rfc822msgid:${identity}`)}`,
  );
  const firstDraft = Array.isArray(drafts.drafts) ? drafts.drafts[0] : null;
  let draftId =
    firstDraft && typeof firstDraft === 'object' && !Array.isArray(firstDraft) &&
    typeof (firstDraft as Readonly<Record<string, unknown>>).id === 'string'
      ? (firstDraft as Readonly<Record<string, string>>).id
      : null;
  if (!draftId) {
    const created = await googleJson(accessToken, '/gmail/v1/users/me/drafts', {
      method: 'POST',
      body: JSON.stringify({ message: mime }),
    });
    draftId = typeof created.id === 'string' ? created.id : null;
  }
  if (!draftId) return { outcome: 'retryable', errorCode: 'gmail_draft_checkpoint_missing' };
  let sent: Readonly<Record<string, unknown>>;
  try {
    sent = await googleJson(accessToken, '/gmail/v1/users/me/drafts/send', {
      method: 'POST',
      body: JSON.stringify({ id: draftId }),
    });
  } catch (error) {
    if (
      error instanceof GoogleApiError &&
      (error.code === 'google_transport_error' ||
        error.code === 'google_temporarily_unavailable')
    ) {
      return { outcome: 'uncertain', errorCode: 'gmail_send_outcome_unknown' };
    }
    throw error;
  }
  return {
    outcome: 'acknowledged',
    providerRevision: typeof sent.historyId === 'string' ? sent.historyId : null,
  };
}

function providerError(error: unknown): ProviderExecutionResult {
  if (!(error instanceof GoogleApiError)) {
    return { outcome: 'retryable', errorCode: 'google_provider_error' };
  }
  if (
    error.code === 'google_transport_error' ||
    error.code === 'google_temporarily_unavailable'
  ) {
    return { outcome: 'retryable', errorCode: error.code };
  }
  return { outcome: 'failed', errorCode: error.code };
}

export function createGoogleProvider(env: Env, now: () => Date): GoogleProviderPort {
  return {
    async execute(scope, command) {
      try {
        const accessToken = await accessTokenFor(env, scope, now());
        if (command.kind === 'send_draft') return executeSend(accessToken, command);
        if (!command.threadId) {
          return { outcome: 'failed', errorCode: 'thread_required' };
        }
        if (command.kind === 'trash') {
          const result = await googleJson(
            accessToken,
            `/gmail/v1/users/me/threads/${encodeURIComponent(command.threadId)}/trash`,
            { method: 'POST', body: '{}' },
          );
          return {
            outcome: 'acknowledged',
            providerRevision: typeof result.historyId === 'string' ? result.historyId : null,
          };
        }
        const labels = labelsFor(command);
        if (!labels) return { outcome: 'failed', errorCode: 'command_not_implemented' };
        const result = await googleJson(
          accessToken,
          `/gmail/v1/users/me/threads/${encodeURIComponent(command.threadId)}/modify`,
          { method: 'POST', body: JSON.stringify(labels) },
        );
        return {
          outcome: 'acknowledged',
          providerRevision: typeof result.historyId === 'string' ? result.historyId : null,
        };
      } catch (error) {
        return providerError(error);
      }
    },
  };
}
