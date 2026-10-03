import { calendarEventKey, calendarReply, maximumCalendarBytes, parseCalendarInvitations } from '@tap-examples/tap-email-protocol/calendar';
import { attachmentContent, AttachmentContentError } from './mailbox';
import { sentFollowUpStatements, type SentMessageIdentity } from './follow-up';
import {
  isMailDraftPayload,
  isCalendarRsvpPayload,
  type MailCommand,
  type MailDraftAttachment,
  type MailDraftPayload,
} from '@tap-examples/tap-email-protocol';
import { encodeBase64, encodeBase64Url, openSecret, sealSecret, sha256Base64Url } from './crypto';
import {
  consumeOutboundAttachments,
  OutboundAttachmentError,
  resolveOutboundAttachment,
} from './outbound-attachments';
import { addSentWithFooter, alternativeBody, OutboundMimeError } from './outbound-mime';
import type {
  GoogleProviderPort,
  ProviderExecutionResult,
  ProviderScope,
} from './provider';

const gmailOrigin = 'https://gmail.googleapis.com';
const tokenEndpoint = 'https://oauth2.googleapis.com/token';
const googleRequestTimeoutMilliseconds = 15_000;

async function boundedGoogleFetch(
  input: RequestInfo | URL,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), googleRequestTimeoutMilliseconds);
  const signal = init.signal
    ? AbortSignal.any([init.signal, controller.signal])
    : controller.signal;
  try {
    return await fetch(input, { ...init, signal });
  } finally {
    clearTimeout(timeout);
  }
}
const maximumGoogleResponseBytes = 2_097_152;
export const maximumGoogleAttachmentBytes = 8 * 1_024 * 1_024;
const maximumGoogleAttachmentResponseBytes =
  Math.ceil(maximumGoogleAttachmentBytes * 4 / 3) + 65_536;
const maximumGoogleMessageAttachmentResponseBytes =
  maximumGoogleAttachmentResponseBytes + maximumGoogleResponseBytes;

export class GoogleApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly providerReason?: string,
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

const temporaryGoogleReasons = new Set([
  'dailyLimitExceeded',
  'quotaExceeded',
  'rateLimitExceeded',
  'resourceExhausted',
  'userRateLimitExceeded',
  'DAILY_LIMIT_EXCEEDED',
  'QUOTA_EXCEEDED',
  'RATE_LIMIT_EXCEEDED',
  'RESOURCE_EXHAUSTED',
  'USER_RATE_LIMIT_EXCEEDED',
]);

function safeGoogleIdentifier(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 128 ||
    !/^[A-Za-z][A-Za-z0-9_.-]*$/u.test(value)
  ) {
    return null;
  }
  return value;
}

function googleFailureDetails(
  payload: Readonly<Record<string, unknown>>,
): { readonly reasons: readonly string[]; readonly providerStatus: string | null } {
  if (!payload.error || typeof payload.error !== 'object' || Array.isArray(payload.error)) {
    return { reasons: [], providerStatus: null };
  }
  const error = payload.error as Readonly<Record<string, unknown>>;
  const reasons: string[] = [];
  const appendReason = (candidate: unknown): void => {
    const reason = safeGoogleIdentifier(candidate);
    if (reason && !reasons.includes(reason)) reasons.push(reason);
  };
  appendReason(error.reason);
  for (const collection of [error.errors, error.details]) {
    if (!Array.isArray(collection)) continue;
    for (const item of collection) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      appendReason((item as Readonly<Record<string, unknown>>).reason);
    }
  }
  return {
    reasons,
    providerStatus: safeGoogleIdentifier(error.status),
  };
}

function googleFailure(
  status: number,
  payload: Readonly<Record<string, unknown>>,
): GoogleApiError {
  const details = googleFailureDetails(payload);
  const providerReason = details.reasons[0] ?? details.providerStatus ?? undefined;
  if (status === 401) {
    return new GoogleApiError(
      status,
      'google_reauthorization_required',
      'Google authorization must be renewed.',
      providerReason,
    );
  }
  if (status === 404) {
    return new GoogleApiError(
      status,
      'google_object_not_found',
      'The Gmail object no longer exists.',
      providerReason,
    );
  }
  if (
    status === 429 ||
    status >= 500 ||
    (status === 403 && (
      details.providerStatus === 'RESOURCE_EXHAUSTED' ||
      details.reasons.some(reason => temporaryGoogleReasons.has(reason))
    ))
  ) {
    return new GoogleApiError(
      status,
      'google_temporarily_unavailable',
      'Google is temporarily unavailable.',
      providerReason,
    );
  }
  return new GoogleApiError(
    status,
    'google_request_rejected',
    'Google rejected the mailbox request.',
    providerReason,
  );
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
       FROM google_credentials AS credentials
       JOIN google_accounts AS accounts USING (profile_id, account_id)
      WHERE credentials.profile_id = ? AND credentials.account_id = ?
        AND accounts.connection_state = 'active'`,
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
  const response = await boundedGoogleFetch(tokenEndpoint, {
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
      throw new GoogleApiError(
        401,
        'google_reauthorization_required',
        'Google authorization must be renewed.',
        'invalid_grant',
      );
    }
    throw googleFailure(response.status, payload);
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

async function googleJsonBounded(
  accessToken: string,
  path: string,
  init: RequestInit,
  maximumResponseBytes: number,
): Promise<Readonly<Record<string, unknown>>> {
  const url = new URL(path, gmailOrigin);
  if (url.origin !== gmailOrigin) {
    throw new GoogleApiError(500, 'google_url_invalid', 'The Google API URL is invalid.');
  }
  let response: Response;
  try {
    response = await boundedGoogleFetch(url, {
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
  const payload = record(await readBoundedJson(response, maximumResponseBytes));
  if (!response.ok) throw googleFailure(response.status, payload);
  return payload;
}

export async function googleJson(
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<Readonly<Record<string, unknown>>> {
  return googleJsonBounded(accessToken, path, init, maximumGoogleResponseBytes);
}

export interface GoogleAttachmentLocator {
  readonly attachmentId: string | null;
  readonly partPath: string;
}

function optionalRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

function attachmentFailure(
  status: 413 | 502,
  code: 'attachment_too_large' | 'attachment_content_invalid',
  message: string,
): GoogleApiError {
  return new GoogleApiError(status, code, message);
}

function decodedAttachmentBytes(
  payload: Readonly<Record<string, unknown>>,
): Uint8Array {
  const declaredSize = payload.size;
  if (
    typeof declaredSize === 'number' &&
    (!Number.isSafeInteger(declaredSize) || declaredSize < 0)
  ) {
    throw attachmentFailure(
      502,
      'attachment_content_invalid',
      'Google returned invalid attachment metadata.',
    );
  }
  if (typeof declaredSize === 'number' && declaredSize > maximumGoogleAttachmentBytes) {
    throw attachmentFailure(
      413,
      'attachment_too_large',
      'The attachment exceeds the 8 MiB download limit.',
    );
  }
  if (typeof payload.data !== 'string') {
    throw attachmentFailure(
      502,
      'attachment_content_invalid',
      'Google returned an attachment without bytes.',
    );
  }
  const unpadded = payload.data.replace(/=+$/u, '');
  const estimatedSize = Math.floor(unpadded.length * 3 / 4);
  if (
    !/^[A-Za-z0-9_-]*={0,2}$/u.test(payload.data) ||
    unpadded.length % 4 === 1 ||
    estimatedSize > maximumGoogleAttachmentBytes
  ) {
    throw attachmentFailure(
      estimatedSize > maximumGoogleAttachmentBytes ? 413 : 502,
      estimatedSize > maximumGoogleAttachmentBytes
        ? 'attachment_too_large'
        : 'attachment_content_invalid',
      estimatedSize > maximumGoogleAttachmentBytes
        ? 'The attachment exceeds the 8 MiB download limit.'
        : 'Google returned invalid attachment bytes.',
    );
  }
  let binary: string;
  try {
    const normalized = unpadded.replaceAll('-', '+').replaceAll('_', '/');
    binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  } catch {
    throw attachmentFailure(
      502,
      'attachment_content_invalid',
      'Google returned invalid attachment bytes.',
    );
  }
  if (binary.length > maximumGoogleAttachmentBytes) {
    throw attachmentFailure(
      413,
      'attachment_too_large',
      'The attachment exceeds the 8 MiB download limit.',
    );
  }
  if (typeof declaredSize === 'number' && declaredSize !== binary.length) {
    throw attachmentFailure(
      502,
      'attachment_content_invalid',
      'Google returned attachment bytes that do not match their metadata.',
    );
  }
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function messagePartAtPath(
  payload: Readonly<Record<string, unknown>>,
  partPath: string,
): Readonly<Record<string, unknown>> | null {
  if (partPath.startsWith('id:')) {
    const partId = partPath.slice(3);
    if (!partId) return null;
    const pending: Readonly<Record<string, unknown>>[] = [payload];
    while (pending.length > 0) {
      const candidate = pending.shift()!;
      if (candidate.partId === partId) return candidate;
      for (const child of Array.isArray(candidate.parts) ? candidate.parts : []) {
        const part = optionalRecord(child);
        if (part) pending.push(part);
      }
    }
    return null;
  }
  if (!partPath.startsWith('path:')) return null;
  const indexPath = partPath.slice(5);
  if (indexPath === 'root') return payload;
  if (!/^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*))*$/u.test(indexPath)) return null;
  let current: Readonly<Record<string, unknown>> | null = payload;
  for (const segment of indexPath.split('.')) {
    const parts = Array.isArray(current?.parts) ? current.parts : [];
    current = optionalRecord(parts[Number(segment)]);
    if (!current) return null;
  }
  return current;
}

async function attachedBody(
  accessToken: string,
  messageId: string,
  attachmentId: string,
): Promise<Uint8Array> {
  try {
    const payload = await googleJsonBounded(
      accessToken,
      `/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
      {},
      maximumGoogleAttachmentResponseBytes,
    );
    return decodedAttachmentBytes(payload);
  } catch (error) {
    if (error instanceof GoogleApiError) {
      if (error.code === 'google_response_too_large') {
        throw attachmentFailure(
          413,
          'attachment_too_large',
          'The attachment exceeds the 8 MiB download limit.',
        );
      }
      if (error.code === 'google_response_invalid') {
        throw attachmentFailure(
          502,
          'attachment_content_invalid',
          'Google returned invalid attachment content.',
        );
      }
    }
    throw error;
  }
}

/**
 * Resolves one Gmail attachment from a server-owned locator. A null result means
 * the saved MIME part path no longer exists; raw provider identifiers never need
 * to cross the coordinator boundary.
 */
export async function googleAttachmentBytes(
  accessToken: string,
  messageId: string,
  locator: GoogleAttachmentLocator,
): Promise<Uint8Array | null> {
  if (locator.attachmentId) {
    return attachedBody(accessToken, messageId, locator.attachmentId);
  }
  let message: Readonly<Record<string, unknown>>;
  try {
    message = await googleJsonBounded(
      accessToken,
      `/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=full&fields=payload`,
      {},
      maximumGoogleMessageAttachmentResponseBytes,
    );
  } catch (error) {
    if (error instanceof GoogleApiError) {
      if (error.code === 'google_response_too_large') {
        throw attachmentFailure(
          502,
          'attachment_content_invalid',
          'The containing Gmail message is too large to resolve this inline attachment safely.',
        );
      }
      if (error.code === 'google_response_invalid') {
        throw attachmentFailure(
          502,
          'attachment_content_invalid',
          'Google returned invalid attachment content.',
        );
      }
    }
    throw error;
  }
  const payload = optionalRecord(message.payload);
  const part = payload ? messagePartAtPath(payload, locator.partPath) : null;
  if (!part) return null;
  const body = optionalRecord(part.body);
  if (!body) return null;
  if (typeof body.data === 'string') return decodedAttachmentBytes(body);
  if (typeof body.attachmentId === 'string' && body.attachmentId.length > 0) {
    return attachedBody(accessToken, messageId, body.attachmentId);
  }
  return null;
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

function base64MimeBody(bytes: Uint8Array): string {
  const pieces: string[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += 32_768) {
    pieces.push(String.fromCharCode(...bytes.subarray(offset, offset + 32_768)));
  }
  return btoa(pieces.join('')).replace(/.{1,76}/gu, '$&\r\n').trimEnd();
}

function attachmentFileName(value: string): { readonly ascii: string; readonly encoded: string } {
  const ascii = value.replace(/[^\x20-\x7e]/gu, '_').replace(/["\\]/gu, '_') || 'attachment';
  const encoded = encodeURIComponent(value)
    .replaceAll("'", '%27')
    .replaceAll('(', '%28')
    .replaceAll(')', '%29')
    .replaceAll('*', '%2A');
  return { ascii, encoded };
}

async function attachmentMimeParts(
  env: Env,
  scope: ProviderScope,
  payload: MailDraftPayload,
  attachments: readonly MailDraftAttachment[],
  boundary: string,
  now: Date,
): Promise<string[]> {
  const parts: string[] = [];
  for (const attachment of attachments) {
    const bytes = await resolveOutboundAttachment(
      env,
      scope.profileId,
      scope.accountId,
      payload.draftKey,
      attachment,
      now,
    );
    const fileName = attachmentFileName(attachment.fileName);
    parts.push(
      `--${boundary}`,
      `Content-Type: ${attachment.mimeType}; name="${fileName.ascii}"`,
      `Content-Disposition: attachment; filename="${fileName.ascii}"; filename*=UTF-8''${fileName.encoded}`,
      'Content-Transfer-Encoding: base64',
      '',
      base64MimeBody(bytes),
    );
  }
  return parts;
}

async function mimeFor(
  env: Env,
  scope: ProviderScope,
  command: MailCommand,
  payload: MailDraftPayload,
  now: Date,
  calendar?: string,
): Promise<{ readonly raw: string; readonly threadId?: string } | null> {
  const to = payload.to === '' ? '' : safeHeader(payload.to, 2_000);
  const cc = payload.cc === undefined ? null : safeHeader(payload.cc, 2_000);
  const bcc = payload.bcc === undefined ? null : safeHeader(payload.bcc, 2_000);
  const subject = payload.subject === '' ? '' : safeHeader(payload.subject, 998);
  const bodyText = payload.bodyText.length <= 500_000 ? payload.bodyText : null;
  if (to === null || subject === null || bodyText === null) return null;
  if ((payload.cc !== undefined && !cc) || (payload.bcc !== undefined && !bcc)) {
    return null;
  }
  const messageIdentity = `${payload.draftKey}@tap-email.local`;
  const attachments = payload.attachments ?? [];
  const boundary = `tap_email_${payload.draftKey.replace(/[^A-Za-z0-9_-]/gu, '_').slice(0, 80)}`;
  const alternativeBoundary = `${boundary}_alternative`;
  const headers = [
    ...(to ? [`To: ${to}`] : []),
    ...(cc ? [`Cc: ${cc}`] : []),
    ...(bcc ? [`Bcc: ${bcc}`] : []),
    `Subject: ${encodedSubject(subject)}`,
    `Message-ID: <${messageIdentity}>`,
    'MIME-Version: 1.0',
    ...(attachments.length > 0
      ? [`Content-Type: multipart/mixed; boundary="${boundary}"`]
      : [`Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`]),
    `X-TAP-Draft-Key: ${payload.draftKey}`,
    `X-TAP-Draft-Revision: ${payload.draftRevision}`,
    `X-TAP-Command-ID: ${command.commandId}`,
  ];
  const replyTo = safeHeader(payload.replyToMessageId, 998);
  if (replyTo) headers.splice(3, 0, `In-Reply-To: ${replyTo}`, `References: ${replyTo}`);
  const messageBody = calendar
    ? [alternativeBody(bodyText, alternativeBoundary).replace(`--${alternativeBoundary}--`, ''),
        `--${alternativeBoundary}`, 'Content-Type: text/calendar; charset=UTF-8; method=REPLY',
        'Content-Transfer-Encoding: base64', '', base64MimeBody(new TextEncoder().encode(calendar)),
        `--${alternativeBoundary}--`, ''].join('\r\n')
    : alternativeBody(bodyText, alternativeBoundary);
  const body = attachments.length === 0
    ? messageBody
    : [
        `--${boundary}`,
        `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
        '',
        messageBody,
        ...await attachmentMimeParts(env, scope, payload, attachments, boundary, now),
        `--${boundary}--`,
        '',
      ].join('\r\n');
  return {
    raw: encodeBase64Url(`${headers.join('\r\n')}\r\n\r\n${body}`),
    ...(command.threadId ? { threadId: command.threadId } : {}),
  };
}

interface ProviderDraftRow {
  readonly provider_draft_id: string | null;
  readonly latest_revision: number;
  readonly state: 'active' | 'sent' | 'discarded';
  readonly thread_id: string | null;
  readonly sent_message_id: string | null;
  readonly sent_at: string | null;
}

async function providerDraftRow(
  env: Env,
  scope: ProviderScope,
  draftKey: string,
): Promise<ProviderDraftRow | null> {
  return env.DB.prepare(
    `SELECT provider_draft_id, latest_revision, state, thread_id, sent_message_id, sent_at
       FROM provider_drafts
      WHERE profile_id = ? AND account_id = ? AND draft_key = ?`,
  )
    .bind(scope.profileId, scope.accountId, draftKey)
    .first<ProviderDraftRow>();
}

async function recordProviderDraft(
  env: Env,
  scope: ProviderScope,
  command: MailCommand,
  payload: MailDraftPayload,
  providerDraftId: string | null,
  state: ProviderDraftRow['state'],
  now: string,
  sent?: SentMessageIdentity | null,
): Promise<void> {
  const checkpoint = env.DB.prepare(
    `INSERT INTO provider_drafts
       (profile_id, account_id, draft_key, provider_draft_id, thread_id,
        latest_revision, state, updated_at, sent_message_id, sent_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(profile_id, account_id, draft_key) DO UPDATE SET
       provider_draft_id = CASE
         WHEN excluded.state IN ('sent', 'discarded')
           THEN excluded.provider_draft_id
         WHEN provider_drafts.state IN ('sent', 'discarded')
           THEN provider_drafts.provider_draft_id
         ELSE COALESCE(excluded.provider_draft_id, provider_drafts.provider_draft_id)
       END,
       thread_id = CASE WHEN provider_drafts.state = 'sent' AND provider_drafts.sent_message_id IS NOT NULL
         THEN provider_drafts.thread_id ELSE COALESCE(excluded.thread_id, provider_drafts.thread_id) END,
       sent_message_id = COALESCE(provider_drafts.sent_message_id, excluded.sent_message_id),
       sent_at = COALESCE(provider_drafts.sent_at, excluded.sent_at),
       latest_revision = MAX(provider_drafts.latest_revision, excluded.latest_revision),
       state = CASE
         WHEN provider_drafts.state IN ('sent', 'discarded')
           THEN provider_drafts.state
         ELSE excluded.state
       END,
       updated_at = excluded.updated_at`,
  )
    .bind(
      scope.profileId,
      scope.accountId,
      payload.draftKey,
      providerDraftId,
      sent?.threadId ?? command.threadId,
      payload.draftRevision,
      state,
      now,
      sent?.messageId ?? null,
      sent?.sentAt ?? null,
    );
  const reminders = state === 'sent' && sent && payload.followUp
    ? await sentFollowUpStatements(env, scope, payload.draftKey, payload.followUp, sent, now)
    : [];
  await env.DB.batch([checkpoint, ...reminders]);
}

async function listedProviderDraftId(
  accessToken: string,
  draftIdentity: string,
): Promise<string | null> {
  const drafts = await googleJson(
    accessToken,
    `/gmail/v1/users/me/drafts?maxResults=10&q=${encodeURIComponent(`rfc822msgid:${draftIdentity}`)}`,
  );
  const firstDraft = Array.isArray(drafts.drafts) ? drafts.drafts[0] : null;
  return firstDraft && typeof firstDraft === 'object' && !Array.isArray(firstDraft) &&
    typeof (firstDraft as Readonly<Record<string, unknown>>).id === 'string'
    ? (firstDraft as { readonly id: string }).id
    : null;
}

function sentMessageIdentity(message: Readonly<Record<string, unknown>>, fallbackTime?: string): SentMessageIdentity | null {
  const millis = typeof message.internalDate === 'string' && /^\d+$/u.test(message.internalDate)
    ? Number(message.internalDate) : NaN;
  const sentAt = Number.isFinite(millis) && millis > 0 && millis <= 8.64e15
    ? new Date(millis).toISOString() : fallbackTime;
  return typeof message.id === 'string' && typeof message.threadId === 'string' && sentAt
    ? { messageId: message.id, threadId: message.threadId, sentAt } : null;
}

async function acknowledgedSentMessage(
  accessToken: string,
  draftIdentity: string,
): Promise<{ revision: string | null; identity: SentMessageIdentity | null } | undefined> {
  const search = await googleJson(
    accessToken,
    `/gmail/v1/users/me/messages?maxResults=10&includeSpamTrash=true&q=${encodeURIComponent(`rfc822msgid:${draftIdentity}`)}`,
  );
  const messages = Array.isArray(search.messages) ? search.messages : [];
  for (const item of messages) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const listed = item as Readonly<Record<string, unknown>>;
    if (typeof listed.id !== 'string') continue;
    const message = await googleJson(
      accessToken,
      `/gmail/v1/users/me/messages/${encodeURIComponent(listed.id)}?format=full&fields=id,threadId,labelIds,internalDate,historyId`,
    );
    if (Array.isArray(message.labelIds) && message.labelIds.includes('SENT')) {
      return { revision: typeof message.historyId === 'string' ? message.historyId : null, identity: sentMessageIdentity(message) };
    }
  }
  return undefined;
}

async function writeProviderDraft(
  accessToken: string,
  providerDraftId: string | null,
  mime: { readonly raw: string; readonly threadId?: string },
): Promise<Readonly<Record<string, unknown>>> {
  if (providerDraftId) {
    return googleJson(
      accessToken,
      `/gmail/v1/users/me/drafts/${encodeURIComponent(providerDraftId)}`,
      { method: 'PUT', body: JSON.stringify({ message: mime }) },
    );
  }
  return googleJson(accessToken, '/gmail/v1/users/me/drafts', {
    method: 'POST',
    body: JSON.stringify({ message: mime }),
  });
}

async function executeSaveDraft(
  env: Env,
  scope: ProviderScope,
  accessToken: string,
  command: MailCommand,
  now: string,
): Promise<ProviderExecutionResult> {
  if (!isMailDraftPayload(command.payload)) {
    return { outcome: 'failed', errorCode: 'invalid_message' };
  }
  const payload = command.payload;
  const recorded = await providerDraftRow(env, scope, payload.draftKey);
  if (recorded?.state === 'sent' || recorded?.state === 'discarded') {
    return { outcome: 'acknowledged', providerRevision: null };
  }
  if (recorded && recorded.latest_revision > payload.draftRevision) {
    return { outcome: 'acknowledged', providerRevision: null };
  }
  const current = new Date(now);
  const mime = await mimeFor(env, scope, command, payload, current);
  if (!mime) return { outcome: 'failed', errorCode: 'invalid_message' };
  const identity = `${payload.draftKey}@tap-email.local`;
  const providerDraftId = recorded?.provider_draft_id ??
    await listedProviderDraftId(accessToken, identity);
  let saved: Readonly<Record<string, unknown>>;
  try {
    saved = await writeProviderDraft(accessToken, providerDraftId, mime);
  } catch (error) {
    if (providerDraftId && error instanceof GoogleApiError && error.status === 404) {
      await recordProviderDraft(env, scope, command, payload, null, 'discarded', now);
      return { outcome: 'failed', errorCode: 'provider_draft_deleted' };
    }
    throw error;
  }
  const savedId = typeof saved.id === 'string' ? saved.id : providerDraftId;
  if (!savedId) {
    return { outcome: 'retryable', errorCode: 'gmail_draft_checkpoint_missing' };
  }
  await recordProviderDraft(
    env,
    scope,
    command,
    payload,
    savedId,
    'active',
    now,
  );
  const message = saved.message && typeof saved.message === 'object' && !Array.isArray(saved.message)
    ? saved.message as Readonly<Record<string, unknown>>
    : null;
  return {
    outcome: 'acknowledged',
    providerRevision: typeof message?.historyId === 'string' ? message.historyId : null,
  };
}

async function executeSend(
  env: Env,
  scope: ProviderScope,
  accessToken: string,
  command: MailCommand,
  now: string,
  calendar?: string,
): Promise<ProviderExecutionResult> {
  if (!isMailDraftPayload(command.payload) || !command.payload.to.trim()) {
    return { outcome: 'failed', errorCode: 'invalid_message' };
  }
  const payload = command.payload;
  const identity = `${payload.draftKey}@tap-email.local`;
  const recorded = await providerDraftRow(env, scope, payload.draftKey);
  const current = new Date(now);
  const consumeConfirmedAttachments = async (): Promise<void> => {
    if (!payload.attachments?.length) return;
    try {
      await consumeOutboundAttachments(env, scope.profileId, payload.attachments, current);
    } catch (error) {
      console.error(JSON.stringify({
        message: 'sent attachment cleanup deferred',
        profileId: scope.profileId,
        accountId: scope.accountId,
        draftKey: payload.draftKey,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  };
  if (recorded?.state === 'sent') {
    if (payload.followUp) {
      const sent = recorded.sent_message_id && recorded.thread_id && recorded.sent_at
        ? { messageId: recorded.sent_message_id, threadId: recorded.thread_id, sentAt: recorded.sent_at }
        : (await acknowledgedSentMessage(accessToken, identity))?.identity;
      // Delivery is known: retry only its missing checkpoint, never send again.
      if (!sent) return { outcome: 'retryable', errorCode: 'sent_follow_up_identity_pending' };
      await recordProviderDraft(env, scope, command, payload, null, 'sent', now, sent);
    }
    await consumeConfirmedAttachments();
    return { outcome: 'acknowledged', providerRevision: null };
  }
  const sentMessage = await acknowledgedSentMessage(accessToken, identity);
  if (sentMessage !== undefined) {
    await recordProviderDraft(
      env,
      scope,
      command,
      payload,
      null,
      'sent',
      now,
      sentMessage.identity,
    );
    if (payload.followUp && !sentMessage.identity) return { outcome: 'retryable', errorCode: 'sent_follow_up_identity_pending' };
    await consumeConfirmedAttachments();
    return { outcome: 'acknowledged', providerRevision: sentMessage.revision };
  }
  const listedDraftId = recorded?.provider_draft_id
    ? null
    : await listedProviderDraftId(accessToken, identity);
  let draftId = recorded?.provider_draft_id ?? listedDraftId;
  const canReuseCheckpoint = Boolean(
    draftId && (!recorded || recorded.latest_revision >= payload.draftRevision),
  );
  let finalMime: { readonly raw: string; readonly threadId?: string } | null = null;
  if (!canReuseCheckpoint) {
    const mime = await mimeFor(env, scope, command, payload, current, calendar);
    if (!mime) return { outcome: 'failed', errorCode: 'invalid_message' };
    finalMime = mime;
    let saved: Readonly<Record<string, unknown>>;
    try {
      saved = await writeProviderDraft(accessToken, draftId, mime);
    } catch (error) {
      if (draftId && error instanceof GoogleApiError && error.status === 404) {
        await recordProviderDraft(env, scope, command, payload, null, 'discarded', now);
        return { outcome: 'failed', errorCode: 'provider_draft_deleted' };
      }
      throw error;
    }
    draftId = typeof saved.id === 'string' ? saved.id : draftId;
    if (!draftId) return { outcome: 'retryable', errorCode: 'gmail_draft_checkpoint_missing' };
    await recordProviderDraft(
      env,
      scope,
      command,
      payload,
      draftId,
      'active',
      now,
    );
  }
  if (!draftId) return { outcome: 'retryable', errorCode: 'gmail_draft_checkpoint_missing' };
  if (scope.referralUrl) {
    if (!finalMime) {
      const draft = await googleJsonBounded(
        accessToken,
        `/gmail/v1/users/me/drafts/${encodeURIComponent(draftId)}?format=raw`,
        {},
        45 * 1_024 * 1_024,
      );
      const message = record(draft.message);
      if (typeof message.raw !== 'string') {
        return { outcome: 'failed', errorCode: 'provider_draft_content_unsupported' };
      }
      finalMime = {
        raw: message.raw,
        ...(typeof message.threadId === 'string' ? { threadId: message.threadId } : {}),
      };
    }
    finalMime = { ...finalMime, raw: addSentWithFooter(finalMime.raw, scope.referralUrl) };
  }
  let sent: Readonly<Record<string, unknown>>;
  try {
    sent = await googleJson(accessToken, '/gmail/v1/users/me/drafts/send', {
      method: 'POST',
      body: JSON.stringify({ id: draftId, ...(scope.referralUrl && finalMime ? { message: finalMime } : {}) }),
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
  await recordProviderDraft(
    env,
    scope,
    command,
    payload,
    null,
    'sent',
    now,
    sentMessageIdentity(sent, now),
  );
  if (payload.followUp && !sentMessageIdentity(sent, now)) return { outcome: 'retryable', errorCode: 'sent_follow_up_identity_pending' };
  await consumeConfirmedAttachments();
  return {
    outcome: 'acknowledged',
    providerRevision: typeof sent.historyId === 'string' ? sent.historyId : null,
  };
}

export async function calendarDraftKey(commandId: string): Promise<string> {
  return `calendar_${await sha256Base64Url(commandId)}`;
}

/** Only server-resolved attachment bytes and the connected account can address an RSVP. */
async function executeCalendarRsvp(
  env: Env,
  scope: ProviderScope,
  token: string,
  command: MailCommand,
  now: Date,
): Promise<ProviderExecutionResult> {
  if (
    !isCalendarRsvpPayload(command.payload) ||
    !command.threadId ||
    !command.expectedProviderRevision
  ) {
    return { outcome: 'failed', errorCode: 'invalid_calendar_response' };
  }
  const payload = command.payload;
  const draftKey = await calendarDraftKey(command.commandId);
  const checkpoint = await providerDraftRow(env, scope, draftKey);
  // A completed send always wins over later changes to the source conversation.
  if (checkpoint?.state === 'sent')
    return { outcome: 'acknowledged', providerRevision: null };
  const sent = await acknowledgedSentMessage(
    token,
    `${draftKey}@tap-email.local`,
  );
  if (sent !== undefined)
    return { outcome: 'acknowledged', providerRevision: sent.revision };
  const thread = await googleJson(
    token,
    `/gmail/v1/users/me/threads/${encodeURIComponent(command.threadId)}?format=metadata&fields=id,historyId,messages(id)`,
  );
  if (thread.historyId !== command.expectedProviderRevision) {
    // Gmail message bodies are immutable. Label-only changes (including the
    // automatic mark-read) can advance history without changing the invitation.
    const stored = await env.DB.prepare(
      'SELECT message_id FROM mail_messages WHERE profile_id = ? AND account_id = ? AND thread_id = ? ORDER BY message_id',
    )
      .bind(scope.profileId, scope.accountId, command.threadId)
      .all<{ message_id: string }>();
    const live = Array.isArray(thread.messages)
      ? thread.messages.map((message) => record(message).id).sort()
      : [];
    if (
      !stored.results.length ||
      JSON.stringify(live) !==
        JSON.stringify(stored.results.map((message) => message.message_id))
    ) {
      return { outcome: 'failed', errorCode: 'provider_revision_conflict' };
    }
  }
  const newerCalendar = await env.DB.prepare(
    `SELECT 1 AS found FROM mail_messages newer
    JOIN mail_messages source ON source.profile_id = newer.profile_id AND source.account_id = newer.account_id AND source.thread_id = newer.thread_id
    JOIN mail_attachments attachment ON attachment.profile_id = newer.profile_id AND attachment.account_id = newer.account_id AND attachment.message_id = newer.message_id
    WHERE source.profile_id = ? AND source.account_id = ? AND source.thread_id = ? AND source.message_id = ?
      AND newer.ordinal > source.ordinal AND (lower(attachment.mime_type) LIKE 'text/calendar%' OR lower(attachment.mime_type) IN ('application/ics', 'application/icalendar') OR lower(attachment.file_name) LIKE '%.ics') LIMIT 1`,
  )
    .bind(scope.profileId, scope.accountId, command.threadId, payload.messageId)
    .first();
  if (newerCalendar)
    return { outcome: 'failed', errorCode: 'calendar_invitation_superseded' };
  const account = await env.DB.prepare(
    "SELECT email_address FROM google_accounts WHERE profile_id = ? AND account_id = ? AND connection_state = 'active'",
  )
    .bind(scope.profileId, scope.accountId)
    .first<{ email_address: string | null }>();
  const resource = await env.DB.prepare(
    'SELECT size_bytes FROM mail_attachments WHERE profile_id = ? AND account_id = ? AND thread_id = ? AND message_id = ? AND resource_id = ?',
  )
    .bind(
      scope.profileId,
      scope.accountId,
      command.threadId,
      payload.messageId,
      payload.resourceId,
    )
    .first<{ size_bytes: number }>();
  if (!account?.email_address || !resource || resource.size_bytes > maximumCalendarBytes)
    return { outcome: 'failed', errorCode: 'calendar_invitation_unavailable' };
  const attachment = await attachmentContent(
    env,
    scope.profileId,
    scope.accountId,
    command.threadId,
    payload.messageId,
    payload.resourceId,
    now,
  );
  let event;
  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(
      attachment.bytes,
    );
    event = parseCalendarInvitations(source).find(
      (event) => calendarEventKey(event) === payload.eventKey,
    );
  } catch {
    return { outcome: 'failed', errorCode: 'invalid_calendar_invitation' };
  }
  const accountAddress = account.email_address.toLowerCase();
  const attendee = event?.attendees.find(person => person.address === accountAddress);
  if (
    !event ||
    event.cancelled ||
    event.method !== 'REQUEST' ||
    !attendee ||
    !event.organizer ||
    event.organizer.address === attendee.address
  )
    return { outcome: 'failed', errorCode: 'calendar_response_not_allowed' };
  const reply = calendarReply(source, event, attendee, payload.response, now);
  return executeSend(
    env,
    scope,
    token,
    {
      ...command,
      kind: 'send_draft',
      payload: {
        draftKey,
        draftRevision: 1,
        to: event.organizer.address,
        subject: `${payload.response === 'accepted' ? 'Accepted' : payload.response === 'declined' ? 'Declined' : 'Tentative'}: ${Array.from(event.title.replace(/[\r\n]/gu, ' ')).slice(0, 160).join('')}`,
        bodyText: `${account.email_address} has ${payload.response === 'tentative' ? 'tentatively accepted' : payload.response} ${event.title}.`,
        expectedContext: payload.expectedContext,
      },
    },
    now.toISOString(),
    reply,
  );
}

function providerError(error: unknown): ProviderExecutionResult {
  if (error instanceof OutboundAttachmentError || error instanceof OutboundMimeError || error instanceof AttachmentContentError) {
    return { outcome: 'failed', errorCode: error.code };
  }
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

async function providerThreadMatchesReview(
  accessToken: string,
  command: MailCommand,
): Promise<boolean> {
  const parameters = new URLSearchParams({
    format: 'metadata',
    fields: 'id,historyId,messages(id,internalDate)',
  });
  const thread = await googleJson(
    accessToken,
    `/gmail/v1/users/me/threads/${encodeURIComponent(command.threadId!)}?${parameters.toString()}`,
  );
  if (typeof thread.historyId === 'string' && thread.historyId === command.expectedProviderRevision) return true;
  // Done removes an INBOX label. An intervening mark-read/star must not reject
  // it, but a newer message still needs review. Trash keeps its strict guard.
  if (command.kind !== 'archive') return false;
  const reviewedAt = typeof command.payload.expectedLatestMessageAt === 'string'
    ? Date.parse(command.payload.expectedLatestMessageAt) : Number.NaN;
  const reviewedId = command.payload.expectedLatestMessageId;
  if (!Number.isFinite(reviewedAt) || !Array.isArray(thread.messages) || thread.messages.length === 0) return false;
  let latestAt = Number.NEGATIVE_INFINITY;
  let latestId: unknown;
  for (const value of thread.messages) {
    const message = optionalRecord(value);
    const sentAt = typeof message?.internalDate === 'string' && /^\d+$/u.test(message.internalDate)
      ? Number(message.internalDate) : Number.NaN;
    if (!Number.isFinite(sentAt) || sentAt > reviewedAt) return false;
    if (sentAt >= latestAt) {
      latestAt = sentAt;
      latestId = message?.id;
    }
  }
  return latestAt === reviewedAt && (reviewedId === null || latestId === reviewedId);
}

export function createGoogleProvider(env: Env, now: () => Date): GoogleProviderPort {
  return {
    async execute(scope, command) {
      try {
        const current = now();
        const accessToken = await accessTokenFor(env, scope, current);
        if (command.kind === 'calendar_rsvp') return await executeCalendarRsvp(env, scope, accessToken, command, current);
        if (command.kind === 'save_draft' || command.kind === 'schedule_send') {
          return await executeSaveDraft(
            env,
            scope,
            accessToken,
            command,
            current.toISOString(),
          );
        }
        if (command.kind === 'send_draft') {
          return await executeSend(
            env,
            scope,
            accessToken,
            command,
            current.toISOString(),
          );
        }
        if (!command.threadId) {
          return { outcome: 'failed', errorCode: 'thread_required' };
        }
        if (
          (command.kind === 'archive' || command.kind === 'trash') &&
          command.expectedProviderRevision !== null
        ) {
          if (!await providerThreadMatchesReview(accessToken, command)) {
            return { outcome: 'failed', errorCode: 'provider_revision_conflict' };
          }
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
