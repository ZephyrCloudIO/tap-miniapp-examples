import {
  isSafeMailIdentifier,
  type MailCommand,
} from '@tap-examples/tap-email-protocol';
import {
  decodeBase64Url,
  encodeBase64Url,
  openSecret,
  sealSecret,
  sha256Base64Url,
} from './crypto';
import {
  GoogleApiError,
  accessTokenFor,
  googleAttachmentBytes,
  googleJson,
  maximumGoogleAttachmentBytes,
} from './google';
import type { ProviderExecutionResult, ProviderScope } from './provider';
import {
  enqueueSyncEvent,
  enqueueSyncEvents,
  type MailboxSyncRequest,
} from './sync-events';

interface AccountRow {
  readonly profile_id: string;
  readonly account_id: string;
  readonly email_address: string | null;
  readonly display_name: string | null;
  readonly accent: string | null;
  readonly coverage_state: string;
  readonly newest_history_id: string | null;
  readonly backfill_complete_through: string | null;
  readonly unresolved_failures: number;
  readonly updated_at: string;
  readonly backfill_page_token: string | null;
  readonly sync_generation: string | null;
  readonly sync_generation_started_at: string | null;
}

export interface MailboxPageOptions {
  readonly cursor?: string;
  readonly limit?: number;
  readonly afterRevision?: number;
}

export type MailboxPageResult = Readonly<Record<string, unknown>> & {
  readonly mailbox: Readonly<Record<string, unknown>>;
  readonly pageInfo: {
    readonly nextCursor: string | null;
    readonly revision: number;
  };
  readonly changes?: {
    readonly nextRevision: number;
    readonly hasMore: boolean;
    readonly deletedThreads: readonly { readonly accountId: string; readonly threadId: string }[];
  };
};

interface MailboxCursor {
  readonly v: 1;
  readonly receivedAt: string;
  readonly accountId: string;
  readonly threadId: string;
}

export class MailboxPageError extends Error {
  readonly status = 400;

  constructor(
    readonly code: 'invalid_mailbox_cursor' | 'invalid_mailbox_limit',
    message: string,
  ) {
    super(message);
  }
}

export class AttachmentContentError extends Error {
  constructor(
    readonly status: 404 | 413 | 502,
    readonly code:
      | 'attachment_not_found'
      | 'attachment_too_large'
      | 'attachment_content_invalid',
    message: string,
  ) {
    super(message);
  }
}

const defaultMailboxPageSize = 100;
const maximumMailboxPageSize = 100;
const maximumMailboxCursorBytes = 1_024;
const maximumMailboxCursorLength = 1_400;
const gmailThreadPageSize = 25;

type ProviderMailboxResource =
  | 'inbox'
  | 'starred'
  | 'drafts'
  | 'sent'
  | 'spam'
  | 'trash';
const gmailMailboxResourceLabels = [
  ['INBOX', 'inbox'],
  ['STARRED', 'starred'],
  ['DRAFT', 'drafts'],
  ['SENT', 'sent'],
  ['SPAM', 'spam'],
  ['TRASH', 'trash'],
] as const satisfies readonly (readonly [string, ProviderMailboxResource])[];

// Gmail charges 40 quota units per threads.get and currently allows 6,000
// units per user per minute. Four 25-thread backfill pages per minute consume
// about 4,040 units, leaving headroom for foreground reads and commands.
const backfillContinuationDelaySeconds = 15;
// A history page can identify up to 50 distinct threads in our bounded path,
// so incremental continuation pages need more spacing than bootstrap pages.
const historyContinuationDelaySeconds = 30;

interface Participant {
  readonly name: string;
  readonly address: string;
}

export interface EmailAttachmentMetadata {
  readonly resourceId: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly disposition: 'attachment' | 'inline';
  readonly contentId: string | null;
}

interface ParsedAttachment extends EmailAttachmentMetadata {
  readonly gmailPartPath: string;
  readonly gmailAttachmentId: string | null;
}

interface ParsedMessage {
  readonly messageId: string;
  readonly internetMessageId: string | null;
  readonly from: Participant;
  readonly to: readonly Participant[];
  readonly sentAt: string;
  readonly bodyText: string;
  readonly bodyHtml: string | null;
  readonly attachments: readonly ParsedAttachment[];
  readonly labelIds: readonly string[];
  readonly snippet: string;
  readonly automated: boolean;
}

interface ParsedThread {
  readonly threadId: string;
  readonly historyId: string;
  readonly subject: string;
  readonly snippet: string;
  readonly participants: readonly Participant[];
  readonly receivedAt: string;
  readonly unread: boolean;
  readonly starred: boolean;
  readonly important: boolean;
  readonly inInbox: boolean;
  readonly needsResponse: boolean;
  readonly waitingOnOthers: boolean;
  readonly labelIds: readonly string[];
  readonly messages: readonly ParsedMessage[];
}

const maximumMessageBodyBytes = 500_000;
const maximumAttachmentsPerMessage = 100;
const maximumAttachmentsPerThread = 100;
// D1 currently limits a single bound TEXT/BLOB value to 2 MB and a statement
// to 100 bound parameters. Keep JSON payloads below that ceiling and reserve
// the first four parameters for the attachment/message tuple plus updated_at.
const maximumD1JsonParameterBytes = 1_750_000;
const maximumD1JsonChunkParameters = 96;
const utf8Encoder = new TextEncoder();

function bulkJsonChunks(
  rows: readonly Readonly<Record<string, unknown>>[],
): readonly string[] {
  if (rows.length === 0) return [];
  const chunks: string[] = [];
  let serializedRows: string[] = [];
  let chunkBytes = 2; // Opening and closing array brackets.

  const flush = (): void => {
    if (serializedRows.length === 0) return;
    chunks.push(`[${serializedRows.join(',')}]`);
    serializedRows = [];
    chunkBytes = 2;
  };

  for (const row of rows) {
    const serialized = JSON.stringify(row);
    const serializedBytes = utf8Encoder.encode(serialized).byteLength;
    if (serializedBytes + 2 > maximumD1JsonParameterBytes) {
      throw new Error('mailbox persistence row exceeds the D1 parameter limit');
    }
    const separatorBytes = serializedRows.length === 0 ? 0 : 1;
    if (
      serializedRows.length > 0 &&
      chunkBytes + separatorBytes + serializedBytes > maximumD1JsonParameterBytes
    ) {
      flush();
    }
    serializedRows.push(serialized);
    chunkBytes += (serializedRows.length === 1 ? 0 : 1) + serializedBytes;
  }
  flush();

  if (chunks.length > maximumD1JsonChunkParameters) {
    throw new Error('mailbox persistence requires too many D1 parameters');
  }
  return chunks;
}

function jsonEachRows(chunks: readonly string[]): string {
  return chunks
    .map((_, index) => `SELECT value FROM json_each(?${index + 5})`)
    .join('\n         UNION ALL\n         ');
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/** Gmail-specific adapter into the provider-neutral mailbox resource model. */
function gmailProviderResources(
  labelIds: readonly string[],
): readonly ProviderMailboxResource[] {
  const labels = new Set(labelIds);
  return gmailMailboxResourceLabels
    .filter(([labelId]) => labels.has(labelId))
    .map(([, resource]) => resource);
}

function headerValue(
  payload: Readonly<Record<string, unknown>> | null,
  name: string,
): string {
  const headers = Array.isArray(payload?.headers) ? payload.headers : [];
  for (const item of headers) {
    const header = asRecord(item);
    if (
      typeof header?.name === 'string' &&
      header.name.toLowerCase() === name.toLowerCase() &&
      typeof header.value === 'string'
    ) {
      return header.value;
    }
  }
  return '';
}

function participants(value: string): readonly Participant[] {
  const result: Participant[] = [];
  const expression = /(?:"([^"]+)"\s*|([^,<]+?)\s*)?<([^>\s]+@[^>\s]+)>|([^,\s<>]+@[^,\s<>]+)/gu;
  for (const match of value.matchAll(expression)) {
    const address = (match[3] ?? match[4] ?? '').trim().toLowerCase();
    if (!address) continue;
    const name = (match[1] ?? match[2] ?? address.split('@')[0] ?? address).trim();
    if (!result.some(item => item.address === address)) result.push({ name, address });
  }
  return result.slice(0, 50);
}

function normalizedContentId(value: string): string | null {
  const trimmed = value.trim().replace(/^<|>$/gu, '').trim();
  return trimmed.length > 0 ? trimmed.slice(0, 2_000) : null;
}

function dispositionValue(payload: Readonly<Record<string, unknown>>): string {
  return headerValue(payload, 'Content-Disposition').trim();
}

function decodedDispositionFileName(value: string): string {
  const encoded = /(?:^|;)\s*filename\*\s*=\s*UTF-8''([^;]+)/iu.exec(value)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded.trim().replace(/^"|"$/gu, ''));
    } catch {
      // Fall through to the ordinary filename parameter.
    }
  }
  const ordinary = /(?:^|;)\s*filename\s*=\s*(?:"([^"]*)"|([^;]*))/iu.exec(value);
  return (ordinary?.[1] ?? ordinary?.[2] ?? '').trim();
}

function safeAttachmentFileName(value: string): string {
  const encoder = new TextEncoder();
  let normalized = '';
  let encodedBytes = 0;
  for (const sourceCharacter of value.normalize('NFC')) {
    const codePoint = sourceCharacter.codePointAt(0)!;
    if (
      codePoint === 0x061c ||
      codePoint === 0x200e ||
      codePoint === 0x200f ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069)
    ) {
      continue;
    }
    const character = codePoint >= 0xd800 && codePoint <= 0xdfff
      ? '\ufffd'
      : /[\u0000-\u001F\u007F-\u009F/\\]/u.test(sourceCharacter)
        ? '_'
        : sourceCharacter;
    const characterBytes = encoder.encode(character).byteLength;
    if (encodedBytes + characterBytes > 512) break;
    normalized += character;
    encodedBytes += characterBytes;
  }
  return normalized.trim() || 'attachment';
}

function safeAttachmentMimeType(value: unknown): string {
  if (typeof value !== 'string') return 'application/octet-stream';
  const normalized = value.trim().toLowerCase();
  return normalized.length <= 255 &&
      /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u.test(normalized)
    ? normalized
    : 'application/octet-stream';
}

function inlineDataSize(value: string): number | null {
  if (!/^[A-Za-z0-9_-]*={0,2}$/u.test(value)) return null;
  const unpadded = value.replace(/=+$/u, '');
  if (unpadded.length % 4 === 1) return null;
  return Math.floor(unpadded.length * 3 / 4);
}

function attachmentSize(body: Readonly<Record<string, unknown>> | null): number {
  if (
    typeof body?.size === 'number' &&
    Number.isSafeInteger(body.size) &&
    body.size >= 0
  ) {
    return body.size;
  }
  return typeof body?.data === 'string'
    ? inlineDataSize(body.data) ?? 0
    : 0;
}

function isAttachmentMimePart(payload: Readonly<Record<string, unknown>>): boolean {
  const body = asRecord(payload.body);
  const disposition = dispositionValue(payload).split(';', 1)[0]?.trim().toLowerCase();
  const mimeType = typeof payload.mimeType === 'string'
    ? payload.mimeType.trim().toLowerCase()
    : '';
  // Multipart nodes are containers, not downloadable byte resources. Gmail
  // puts the retrievable locator on a leaf; stopping at a decorated wrapper
  // would hide both the real message body and its child attachments.
  if (mimeType.startsWith('multipart/')) return false;
  const isMessageBodyAlternative = mimeType === 'text/plain' || mimeType === 'text/html';
  const hasFileName = typeof payload.filename === 'string' && payload.filename.trim().length > 0;
  if (hasFileName || disposition === 'attachment') return true;
  // A related HTML root may itself have a Content-ID or inline disposition.
  // Preserve unnamed text/plain and text/html parts as message bodies; other
  // addressable MIME entities are resources even when Gmail omits a filename.
  return (
    !isMessageBodyAlternative && (
      (typeof body?.attachmentId === 'string' && body.attachmentId.length > 0) ||
      disposition === 'inline' ||
      normalizedContentId(headerValue(payload, 'Content-ID')) !== null
    )
  );
}

interface AttachmentPart {
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly disposition: 'attachment' | 'inline';
  readonly contentId: string | null;
  readonly gmailPartPath: string;
  readonly gmailAttachmentId: string | null;
}

function attachmentParts(
  payload: Readonly<Record<string, unknown>> | null,
  partPath = 'root',
  collected: AttachmentPart[] = [],
  maximum = maximumAttachmentsPerMessage,
): readonly AttachmentPart[] {
  if (!payload || collected.length >= maximum) return collected;
  if (isAttachmentMimePart(payload)) {
    const body = asRecord(payload.body);
    const contentId = normalizedContentId(headerValue(payload, 'Content-ID'));
    const disposition = dispositionValue(payload);
    const declaredFileName = typeof payload.filename === 'string' ? payload.filename : '';
    const gmailAttachmentId =
      typeof body?.attachmentId === 'string' && body.attachmentId.length <= 16_384
        ? body.attachmentId
        : null;
    const gmailPartId =
      typeof payload.partId === 'string' &&
        payload.partId.length > 0 &&
        payload.partId.length <= 512 &&
        !/[\u0000-\u001F\u007F]/u.test(payload.partId)
        ? payload.partId
        : null;
    collected.push({
      fileName: safeAttachmentFileName(
        declaredFileName || decodedDispositionFileName(disposition) || contentId || 'attachment',
      ),
      mimeType: safeAttachmentMimeType(payload.mimeType),
      sizeBytes: attachmentSize(body),
      disposition: disposition.split(';', 1)[0]?.trim().toLowerCase() === 'inline' || contentId !== null
        ? 'inline'
        : 'attachment',
      contentId,
      gmailPartPath: gmailPartId ? `id:${gmailPartId}` : `path:${partPath}`,
      gmailAttachmentId,
    });
    return collected;
  }
  const parts = Array.isArray(payload.parts) ? payload.parts : [];
  for (let index = 0; index < parts.length; index += 1) {
    attachmentParts(
      asRecord(parts[index]),
      partPath === 'root' ? String(index) : `${partPath}.${index}`,
      collected,
      maximum,
    );
    if (collected.length >= maximum) break;
  }
  return collected;
}

async function messageAttachments(
  messageId: string,
  payload: Readonly<Record<string, unknown>> | null,
  maximum: number,
): Promise<readonly ParsedAttachment[]> {
  const parts = attachmentParts(
    payload,
    'root',
    [],
    Math.max(0, Math.min(maximumAttachmentsPerMessage, maximum)),
  );
  return Promise.all(parts.map(async part => ({
    resourceId: `att_${await sha256Base64Url(
      JSON.stringify(['tap-email-attachment', 1, messageId, part.gmailPartPath]),
    )}`,
    ...part,
  })));
}

function bodyPart(
  payload: Readonly<Record<string, unknown>> | null,
  preferredMime: string,
): string | null {
  if (!payload) return null;
  if (isAttachmentMimePart(payload)) return null;
  const mimeType = typeof payload.mimeType === 'string' ? payload.mimeType.toLowerCase() : '';
  const body = asRecord(payload.body);
  if (mimeType === preferredMime && typeof body?.data === 'string') {
    try {
      return decodeBase64Url(body.data, maximumMessageBodyBytes);
    } catch {
      // Never return a syntactically corrupted partial MIME body. A bounded
      // client can fall back to the other alternative or metadata instead.
      return null;
    }
  }
  const parts = Array.isArray(payload.parts) ? payload.parts : [];
  for (const part of parts) {
    const resolved = bodyPart(asRecord(part), preferredMime);
    if (resolved !== null) return resolved;
  }
  return null;
}

function textFromHtml(html: string): string {
  return html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, ' ')
    .replace(/<br\s*\/?>/giu, '\n')
    .replace(/<\/p>/giu, '\n')
    .replace(/<[^>]+>/gu, ' ')
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
    .slice(0, 100_000);
}

function messageBody(
  payload: Readonly<Record<string, unknown>> | null,
): { readonly bodyText: string; readonly bodyHtml: string | null } {
  const text = bodyPart(payload, 'text/plain');
  const html = bodyPart(payload, 'text/html');
  return {
    bodyText: text !== null
      ? text.replaceAll('\r\n', '\n').trim()
      : html === null
        ? ''
        : textFromHtml(html),
    bodyHtml: html !== null && html.trim().length > 0 ? html : null,
  };
}

async function parseMessage(
  value: unknown,
  maximumAttachments: number,
): Promise<ParsedMessage | null> {
  const message = asRecord(value);
  if (!message || typeof message.id !== 'string') return null;
  const payload = asRecord(message.payload);
  const from = participants(headerValue(payload, 'From'))[0] ?? {
    name: 'Unknown sender',
    address: 'unknown@invalid.local',
  };
  const sentAtValue = typeof message.internalDate === 'string'
    ? Number(message.internalDate)
    : Number.NaN;
  const dateHeader = Date.parse(headerValue(payload, 'Date'));
  const sentAt = Number.isFinite(sentAtValue)
    ? new Date(sentAtValue).toISOString()
    : Number.isFinite(dateHeader)
      ? new Date(dateHeader).toISOString()
      : new Date(0).toISOString();
  const listUnsubscribe = headerValue(payload, 'List-Unsubscribe');
  const body = messageBody(payload);
  const attachments = await messageAttachments(message.id, payload, maximumAttachments);
  return {
    messageId: message.id,
    internetMessageId: headerValue(payload, 'Message-ID') || null,
    from,
    to: participants(headerValue(payload, 'To')),
    sentAt,
    bodyText: body.bodyText,
    bodyHtml: body.bodyHtml,
    attachments,
    labelIds: stringArray(message.labelIds),
    snippet: typeof message.snippet === 'string' ? message.snippet.slice(0, 2_000) : '',
    automated:
      Boolean(listUnsubscribe) ||
      /(^|[._-])(no-?reply|notifications?|mailer-daemon)([._@+-]|$)/iu.test(from.address),
  };
}

async function parseThread(value: unknown, accountAddress: string): Promise<ParsedThread | null> {
  const thread = asRecord(value);
  if (!thread || typeof thread.id !== 'string') return null;
  const rawMessages = Array.isArray(thread.messages) ? thread.messages : [];
  const retainedRawMessages = rawMessages
    .map((message, index) => {
      const internalDate = Number(asRecord(message)?.internalDate);
      return {
        message,
        index,
        sortTime: Number.isFinite(internalDate) ? internalDate : Number.NEGATIVE_INFINITY,
      };
    })
    .toSorted((left, right) => left.sortTime - right.sortTime || left.index - right.index)
    .slice(-20);
  let remainingAttachments = maximumAttachmentsPerThread;
  const parsedNewestFirst: ParsedMessage[] = [];
  for (const raw of retainedRawMessages.toReversed()) {
    const parsed = await parseMessage(raw.message, remainingAttachments);
    if (!parsed) continue;
    remainingAttachments -= parsed.attachments.length;
    parsedNewestFirst.push(parsed);
  }
  const parsedMessages = parsedNewestFirst
    .toReversed()
    .toSorted((left, right) => left.sentAt.localeCompare(right.sentAt));
  const latest = parsedMessages.at(-1);
  if (!latest) return null;
  const firstPayload = asRecord(asRecord(rawMessages[0])?.payload);
  const allLabels = new Set(rawMessages.flatMap(message =>
    stringArray(asRecord(message)?.labelIds)));
  const ownAddress = accountAddress.toLowerCase();
  const latestFromSelf = latest.from.address === ownAddress;
  const externalParticipants = parsedMessages
    .flatMap(message => [message.from, ...message.to])
    .filter(person => person.address !== ownAddress)
    .filter((person, index, items) => items.findIndex(item => item.address === person.address) === index)
    .slice(0, 50);
  return {
    threadId: thread.id,
    historyId: typeof thread.historyId === 'string' ? thread.historyId : '0',
    subject: headerValue(firstPayload, 'Subject') || '(no subject)',
    snippet: latest.snippet,
    participants: externalParticipants.length > 0 ? externalParticipants : [latest.from],
    receivedAt: latest.sentAt,
    unread: allLabels.has('UNREAD'),
    starred: allLabels.has('STARRED'),
    important: allLabels.has('IMPORTANT') || allLabels.has('STARRED'),
    inInbox: allLabels.has('INBOX'),
    needsResponse: allLabels.has('INBOX') && !latestFromSelf && !latest.automated,
    waitingOnOthers: allLabels.has('INBOX') && latestFromSelf,
    labelIds: [...allLabels].toSorted(),
    messages: parsedMessages,
  };
}

async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  task: (value: T) => Promise<R>,
): Promise<readonly R[]> {
  const results: R[] = [];
  for (let offset = 0; offset < values.length; offset += concurrency) {
    const group = values.slice(offset, offset + concurrency);
    results.push(...await Promise.all(group.map(task)));
  }
  return results;
}

const fallbackMessageLimit = 20;
const fallbackMetadataHeaders = [
  'From',
  'To',
  'Date',
  'Subject',
  'Message-ID',
  'List-Unsubscribe',
] as const;

function isOversizedGoogleResponse(error: unknown): error is GoogleApiError {
  return error instanceof GoogleApiError && error.code === 'google_response_too_large';
}

function metadataThreadPath(threadId: string): string {
  const parameters = new URLSearchParams({
    format: 'metadata',
    fields: 'id,historyId,messages(id,threadId,labelIds,internalDate,snippet,payload/headers)',
  });
  for (const header of fallbackMetadataHeaders) {
    parameters.append('metadataHeaders', header);
  }
  return `/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?${parameters.toString()}`;
}

function fullMessagePath(messageId: string): string {
  const parameters = new URLSearchParams({
    format: 'full',
    fields: 'id,threadId,labelIds,internalDate,snippet,historyId,payload',
  });
  return `/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?${parameters.toString()}`;
}

function logOversizedResponse(
  scope: ProviderScope,
  threadId: string,
  messageId?: string,
): void {
  console.warn(JSON.stringify({
    message: messageId
      ? 'gmail message body exceeded the sync limit; retaining metadata only'
      : 'gmail thread exceeded the sync limit; retrying its newest messages individually',
    profileId: scope.profileId,
    accountId: scope.accountId,
    threadId,
    ...(messageId ? { messageId } : {}),
    code: 'google_response_too_large',
  }));
}

async function recoverOversizedThread(
  scope: ProviderScope,
  accessToken: string,
  threadId: string,
): Promise<Readonly<Record<string, unknown>>> {
  logOversizedResponse(scope, threadId);
  const metadata = await googleJson(accessToken, metadataThreadPath(threadId));
  const messages = Array.isArray(metadata.messages)
    ? metadata.messages.slice(-fallbackMessageLimit)
    : [];
  const hydrated = await mapConcurrent(messages, 5, async value => {
    const message = asRecord(value);
    const messageId = typeof message?.id === 'string' ? message.id : null;
    if (!messageId) return value;
    try {
      return await googleJson(accessToken, fullMessagePath(messageId));
    } catch (error) {
      if (isOversizedGoogleResponse(error)) {
        logOversizedResponse(scope, threadId, messageId);
        return value;
      }
      if (error instanceof GoogleApiError && error.status === 404) return null;
      throw error;
    }
  });
  return {
    ...metadata,
    messages: hydrated.filter(message => message !== null),
  };
}

async function persistThread(
  env: Env,
  scope: ProviderScope,
  thread: ParsedThread,
  accountAddress: string,
  now: string,
  syncGeneration: string | null = null,
  contentState: 'metadata' | 'full' = 'full',
): Promise<void> {
  const sealedBodies = await Promise.all(
    thread.messages.map(message =>
      sealSecret(message.bodyText, env.GOOGLE_TOKEN_ENCRYPTION_KEY),
    ),
  );
  // An encrypted empty string is the post-sync sentinel for a message that has
  // no HTML alternative. A database NULL is reserved for pre-migration rows so
  // the selected-thread endpoint can lazily hydrate them from Gmail.
  const sealedHtmlBodies = await Promise.all(
    thread.messages.map(message =>
      sealSecret(message.bodyHtml ?? '', env.GOOGLE_TOKEN_ENCRYPTION_KEY),
    ),
  );
  const attachments = (await Promise.all(thread.messages.flatMap(message =>
    message.attachments.map(async attachment => ({
      messageId: message.messageId,
      attachment,
      gmailAttachmentIdCiphertext: attachment.gmailAttachmentId
        ? await sealSecret(attachment.gmailAttachmentId, env.GOOGLE_TOKEN_ENCRYPTION_KEY)
        : null,
    })),
  )));
  const messageChunks = bulkJsonChunks(thread.messages.map((message, ordinal) => ({
    messageId: message.messageId,
    internetMessageId: message.internetMessageId,
    senderJson: JSON.stringify(message.from),
    recipientsJson: JSON.stringify(message.to),
    sentAt: message.sentAt,
    bodyTextCiphertext: sealedBodies[ordinal]!,
    bodyHtmlCiphertext: sealedHtmlBodies[ordinal]!,
    ordinal,
  })));
  const attachmentChunks = bulkJsonChunks(attachments.map(({
    messageId,
    attachment,
    gmailAttachmentIdCiphertext,
  }) => ({
    messageId,
    resourceId: attachment.resourceId,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    disposition: attachment.disposition,
    contentId: attachment.contentId,
    gmailPartPath: attachment.gmailPartPath,
    gmailAttachmentIdCiphertext,
  })));
  const statements = [
    env.DB.prepare(
      `INSERT INTO mail_threads
         (profile_id, account_id, thread_id, history_id, subject, snippet,
          participants_json, received_at, unread, starred, important,
          in_inbox, needs_response, waiting_on_others, label_ids_json, updated_at,
          seen_sync_generation, content_state)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(profile_id, account_id, thread_id) DO UPDATE SET
         history_id = excluded.history_id, subject = excluded.subject,
         snippet = excluded.snippet, participants_json = excluded.participants_json,
         received_at = excluded.received_at, unread = excluded.unread,
         starred = excluded.starred, important = excluded.important,
         in_inbox = excluded.in_inbox, needs_response = excluded.needs_response,
         waiting_on_others = excluded.waiting_on_others,
         label_ids_json = excluded.label_ids_json, updated_at = excluded.updated_at,
         seen_sync_generation = COALESCE(
           excluded.seen_sync_generation,
           mail_threads.seen_sync_generation
         ),
         content_state = excluded.content_state`,
    ).bind(
      scope.profileId,
      scope.accountId,
      thread.threadId,
      thread.historyId,
      thread.subject.slice(0, 998),
      thread.snippet,
      JSON.stringify(thread.participants),
      thread.receivedAt,
      Number(thread.unread),
      Number(thread.starred),
      Number(thread.important),
      Number(thread.inInbox),
      Number(thread.needsResponse),
      Number(thread.waitingOnOthers),
      JSON.stringify(thread.labelIds),
      now,
      syncGeneration,
      contentState,
    ),
    env.DB.prepare(
      `DELETE FROM mail_messages
        WHERE profile_id = ? AND account_id = ? AND thread_id = ?`,
    ).bind(scope.profileId, scope.accountId, thread.threadId),
    ...(messageChunks.length === 0 ? [] : [
      env.DB.prepare(
        `WITH input(value) AS (
           ${jsonEachRows(messageChunks)}
         )
         INSERT INTO mail_messages
           (profile_id, account_id, thread_id, message_id, internet_message_id,
            sender_json, recipients_json, sent_at, body_text_ciphertext,
            body_html_ciphertext, ordinal, updated_at)
         SELECT ?1, ?2, ?3,
                json_extract(value, '$.messageId'),
                json_extract(value, '$.internetMessageId'),
                json_extract(value, '$.senderJson'),
                json_extract(value, '$.recipientsJson'),
                json_extract(value, '$.sentAt'),
                json_extract(value, '$.bodyTextCiphertext'),
                json_extract(value, '$.bodyHtmlCiphertext'),
                CAST(json_extract(value, '$.ordinal') AS INTEGER),
                ?4
           FROM input`,
      ).bind(
        scope.profileId,
        scope.accountId,
        thread.threadId,
        now,
        ...messageChunks,
      ),
    ]),
    ...(attachmentChunks.length === 0 ? [] : [
      env.DB.prepare(
        `WITH input(value) AS (
           ${jsonEachRows(attachmentChunks)}
         )
         INSERT INTO mail_attachments
           (profile_id, account_id, thread_id, message_id, resource_id,
            file_name, mime_type, size_bytes, disposition, content_id,
            gmail_part_path, gmail_attachment_id_ciphertext, updated_at)
         SELECT ?1, ?2, ?3,
                json_extract(value, '$.messageId'),
                json_extract(value, '$.resourceId'),
                json_extract(value, '$.fileName'),
                json_extract(value, '$.mimeType'),
                CAST(json_extract(value, '$.sizeBytes') AS INTEGER),
                json_extract(value, '$.disposition'),
                json_extract(value, '$.contentId'),
                json_extract(value, '$.gmailPartPath'),
                json_extract(value, '$.gmailAttachmentIdCiphertext'),
                ?4
           FROM input`,
      ).bind(
        scope.profileId,
        scope.accountId,
        thread.threadId,
        now,
        ...attachmentChunks,
      ),
    ]),
  ];
  await env.DB.batch(statements);
  const latest = thread.messages.at(-1);
  if (latest && latest.from.address !== accountAddress.toLowerCase()) {
    await env.DB.prepare(
      `UPDATE tap_reminders
          SET state = 'satisfied', updated_at = ?
        WHERE profile_id = ? AND account_id = ? AND thread_id = ?
          AND state IN ('pending', 'due') AND condition = 'if_no_reply'
          AND created_at < ?`,
    )
      .bind(now, scope.profileId, scope.accountId, thread.threadId, latest.sentAt)
      .run();
  }
}

async function fetchAndPersistThreads(
  env: Env,
  scope: ProviderScope,
  accessToken: string,
  accountAddress: string,
  threadIds: readonly string[],
  now: string,
  syncGeneration: string | null = null,
  contentState: 'metadata' | 'full' = 'full',
): Promise<readonly ParsedThread[]> {
  const resolved = await mapConcurrent(threadIds, 5, async threadId => {
    try {
      const raw = await googleJson(accessToken, contentState === 'metadata'
        ? metadataThreadPath(threadId)
        : `/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?format=full`);
      return parseThread(raw, accountAddress);
    } catch (error) {
      if (isOversizedGoogleResponse(error)) {
        const recovered = await recoverOversizedThread(scope, accessToken, threadId);
        return parseThread(recovered, accountAddress);
      }
      if (error instanceof GoogleApiError && error.status === 404) {
        await env.DB.batch([
          env.DB.prepare(
            `UPDATE tap_reminders SET state = 'cancelled', updated_at = ?
              WHERE profile_id = ? AND account_id = ? AND thread_id = ?
                AND state IN ('pending', 'due')`,
          ).bind(now, scope.profileId, scope.accountId, threadId),
          env.DB.prepare(
            `DELETE FROM mail_threads
              WHERE profile_id = ? AND account_id = ? AND thread_id = ?`,
          ).bind(scope.profileId, scope.accountId, threadId),
        ]);
        return null;
      }
      throw error;
    }
  });
  const parsed = resolved.filter((item): item is ParsedThread => item !== null);
  for (const thread of parsed) {
    await persistThread(
      env,
      scope,
      thread,
      accountAddress,
      now,
      syncGeneration,
      contentState,
    );
  }
  return parsed;
}

async function accountRow(env: Env, scope: ProviderScope): Promise<AccountRow> {
  const row = await env.DB.prepare(
    `SELECT profile_id, account_id, email_address, display_name, accent,
            coverage_state, newest_history_id, backfill_complete_through,
            unresolved_failures, updated_at, backfill_page_token,
            sync_generation, sync_generation_started_at
       FROM google_accounts
      WHERE profile_id = ? AND account_id = ? AND connection_state = 'active'`,
  )
    .bind(scope.profileId, scope.accountId)
    .first<AccountRow>();
  if (!row || !row.email_address) {
    throw new GoogleApiError(404, 'google_connection_required', 'The Google account is not connected.');
  }
  return row;
}

async function newestPage(
  env: Env,
  scope: ProviderScope,
  row: AccountRow,
  accessToken: string,
  pageToken: string | undefined,
  reset: boolean,
  now: Date,
  requestedSyncGeneration?: string,
): Promise<void> {
  const syncGeneration = reset
    ? requestedSyncGeneration ?? `mailbox_${crypto.randomUUID()}`
    : requestedSyncGeneration ?? row.sync_generation;
  if (
    !reset &&
    requestedSyncGeneration &&
    row.sync_generation &&
    requestedSyncGeneration !== row.sync_generation
  ) {
    return;
  }
  const parameters = new URLSearchParams({
    includeSpamTrash: 'true',
    maxResults: String(gmailThreadPageSize),
  });
  if (pageToken) parameters.set('pageToken', pageToken);
  const [listed, profile] = await Promise.all([
    googleJson(accessToken, `/gmail/v1/users/me/threads?${parameters.toString()}`),
    pageToken ? Promise.resolve(null) : googleJson(accessToken, '/gmail/v1/users/me/profile'),
  ]);
  const threadIds = (Array.isArray(listed.threads) ? listed.threads : [])
    .map(item => asRecord(item)?.id)
    .filter((item): item is string => typeof item === 'string');
  const parsed = await fetchAndPersistThreads(
    env,
    scope,
    accessToken,
    row.email_address!,
    threadIds,
    now.toISOString(),
    syncGeneration,
    pageToken ? 'metadata' : 'full',
  );
  const nextPageToken = typeof listed.nextPageToken === 'string' ? listed.nextPageToken : null;
  let oldest = reset ? null : row.backfill_complete_through;
  for (const thread of parsed) {
    if (!oldest || thread.receivedAt < oldest) oldest = thread.receivedAt;
  }
  const historyId =
    profile && typeof profile.historyId === 'string'
      ? profile.historyId
      : row.newest_history_id;
  const timestamp = now.toISOString();
  const accountUpdate = env.DB.prepare(
    `UPDATE google_accounts
        SET coverage_state = ?, newest_history_id = ?,
            backfill_complete_through = ?, backfill_page_token = ?,
            sync_generation = ?,
            sync_generation_started_at = CASE
              WHEN ? THEN ? ELSE sync_generation_started_at
            END,
            last_full_sync_completed_at = CASE
              WHEN ? THEN ? ELSE last_full_sync_completed_at
            END,
            updated_at = ?
      WHERE profile_id = ? AND account_id = ?
        AND (? OR sync_generation IS NULL OR sync_generation = ?)`,
  ).bind(
    nextPageToken ? 'backfilling' : 'current',
    historyId,
    oldest,
    nextPageToken,
    syncGeneration,
    Number(reset),
    timestamp,
    Number(nextPageToken === null),
    timestamp,
    timestamp,
    scope.profileId,
    scope.accountId,
    Number(reset),
    syncGeneration,
  );
  if (nextPageToken || !syncGeneration) {
    await accountUpdate.run();
  } else {
    await env.DB.batch([
      accountUpdate,
      env.DB.prepare(
        `UPDATE tap_reminders SET state = 'cancelled', updated_at = ?
          WHERE profile_id = ? AND account_id = ?
            AND state IN ('pending', 'due')
            AND thread_id IN (
              SELECT thread_id FROM mail_threads
               WHERE profile_id = ? AND account_id = ?
                 AND COALESCE(seen_sync_generation, '') != ?
                 AND updated_at <= COALESCE(
                   (SELECT sync_generation_started_at FROM google_accounts
                     WHERE profile_id = ? AND account_id = ?),
                   ?
                 )
            )`,
      ).bind(
        timestamp,
        scope.profileId,
        scope.accountId,
        scope.profileId,
        scope.accountId,
        syncGeneration,
        scope.profileId,
        scope.accountId,
        timestamp,
      ),
      env.DB.prepare(
        `DELETE FROM mail_threads
          WHERE profile_id = ? AND account_id = ?
            AND COALESCE(seen_sync_generation, '') != ?
            AND updated_at <= COALESCE(
              (SELECT sync_generation_started_at FROM google_accounts
                WHERE profile_id = ? AND account_id = ?),
              ?
            )
            AND EXISTS (
              SELECT 1 FROM google_accounts
               WHERE profile_id = ? AND account_id = ? AND sync_generation = ?
            )`,
      ).bind(
        scope.profileId,
        scope.accountId,
        syncGeneration,
        scope.profileId,
        scope.accountId,
        timestamp,
        scope.profileId,
        scope.accountId,
        syncGeneration,
      ),
    ]);
  }
  if (nextPageToken) {
    await enqueueSyncEvent(env, {
      profileId: scope.profileId,
      accountId: scope.accountId,
      mode: 'continue',
      pageToken: nextPageToken,
      ...(syncGeneration ? { syncGeneration } : {}),
    }, now, backfillContinuationDelaySeconds);
  }
}

function historyThreadIds(value: unknown): readonly string[] {
  const response = asRecord(value);
  const ids = new Set<string>();
  const history = Array.isArray(response?.history) ? response.history : [];
  for (const rawEntry of history) {
    const entry = asRecord(rawEntry);
    const changes = [
      ...(Array.isArray(entry?.messages)
        ? entry.messages.map(message => ({ message }))
        : []),
      ...(Array.isArray(entry?.messagesAdded) ? entry.messagesAdded : []),
      ...(Array.isArray(entry?.messagesDeleted) ? entry.messagesDeleted : []),
      ...(Array.isArray(entry?.labelsAdded) ? entry.labelsAdded : []),
      ...(Array.isArray(entry?.labelsRemoved) ? entry.labelsRemoved : []),
    ];
    for (const rawChange of changes) {
      const message = asRecord(asRecord(rawChange)?.message);
      if (typeof message?.threadId === 'string') ids.add(message.threadId);
    }
  }
  return [...ids];
}

async function partialPage(
  env: Env,
  scope: ProviderScope,
  row: AccountRow,
  accessToken: string,
  startHistoryId: string,
  pageToken: string | undefined,
  now: Date,
): Promise<void> {
  const parameters = new URLSearchParams({
    maxResults: String(gmailThreadPageSize),
    startHistoryId,
  });
  if (pageToken) parameters.set('pageToken', pageToken);
  let history: Readonly<Record<string, unknown>>;
  try {
    history = await googleJson(
      accessToken,
      `/gmail/v1/users/me/history?${parameters.toString()}`,
    );
  } catch (error) {
    if (error instanceof GoogleApiError && error.status === 404) {
      await newestPage(env, scope, row, accessToken, undefined, true, now);
      return;
    }
    throw error;
  }
  const threadIds = historyThreadIds(history);
  if (threadIds.length > 50) {
    await newestPage(env, scope, row, accessToken, undefined, true, now);
    return;
  }
  await fetchAndPersistThreads(
    env,
    scope,
    accessToken,
    row.email_address!,
    threadIds,
    now.toISOString(),
  );
  const nextPageToken = typeof history.nextPageToken === 'string' ? history.nextPageToken : null;
  if (nextPageToken) {
    await enqueueSyncEvent(env, {
      profileId: scope.profileId,
      accountId: scope.accountId,
      mode: 'partial',
      startHistoryId,
      pageToken: nextPageToken,
    }, now, historyContinuationDelaySeconds);
    return;
  }
  await env.DB.prepare(
    `UPDATE google_accounts
        SET coverage_state = 'current', newest_history_id = ?,
            updated_at = ?
      WHERE profile_id = ? AND account_id = ?`,
  )
    .bind(
      typeof history.historyId === 'string' ? history.historyId : startHistoryId,
      now.toISOString(),
      scope.profileId,
      scope.accountId,
    )
    .run();
}

export async function syncGoogleMailbox(
  env: Env,
  message: MailboxSyncRequest,
  now: Date,
): Promise<void> {
  const scope = { profileId: message.profileId, accountId: message.accountId };
  const row = await accountRow(env, scope);
  const accessToken = await accessTokenFor(env, scope, now);
  if (message.mode === 'newest') {
    await newestPage(
      env,
      scope,
      row,
      accessToken,
      undefined,
      true,
      now,
      message.syncGeneration,
    );
    return;
  }
  if (message.mode === 'continue') {
    const pageToken = message.pageToken ?? row.backfill_page_token;
    if (pageToken) {
      await newestPage(
        env,
        scope,
        row,
        accessToken,
        pageToken,
        false,
        now,
        message.syncGeneration,
      );
    }
    return;
  }
  const startHistoryId = message.startHistoryId ?? row.newest_history_id;
  if (!startHistoryId) {
    await newestPage(env, scope, row, accessToken, undefined, true, now);
    return;
  }
  await partialPage(env, scope, row, accessToken, startHistoryId, message.pageToken, now);
}

/**
 * Provider-fresh barrier used immediately before a conditional scheduled send.
 * It reads the exact Gmail thread rather than trusting the asynchronously
 * synchronized mailbox projection, and persists the observation as a side
 * effect so subsequent UI reads see the same state.
 */
export async function freshGoogleThreadHasExternalReplyAfter(
  env: Env,
  profileId: string,
  accountId: string,
  threadId: string,
  after: string,
  now: Date,
): Promise<boolean> {
  const scope = { profileId, accountId };
  const row = await accountRow(env, scope);
  const accountAddress = row.email_address!.toLowerCase();
  const accessToken = await accessTokenFor(env, scope, now);
  const threads = await fetchAndPersistThreads(
    env,
    scope,
    accessToken,
    accountAddress,
    [threadId],
    now.toISOString(),
  );
  const threshold = Date.parse(after);
  return threads.some(thread => thread.messages.some(message =>
    message.from.address !== accountAddress && Date.parse(message.sentAt) > threshold,
  ));
}

export async function requestAccountSync(
  env: Env,
  profileId: string,
  accountId: string,
  now: Date,
): Promise<boolean> {
  const account = await env.DB.prepare(
    `SELECT backfill_page_token, unresolved_failures
       FROM google_accounts
      WHERE profile_id = ? AND account_id = ? AND connection_state = 'active'`,
  )
    .bind(profileId, accountId)
    .first<{
      backfill_page_token: string | null;
      unresolved_failures: number;
    }>();
  if (!account) return false;

  const threshold = new Date(now.getTime() - 30_000).toISOString();
  const timestamp = now.toISOString();
  const updated = await env.DB.prepare(
    `UPDATE google_accounts
        SET last_sync_requested_at = ?
      WHERE profile_id = ? AND account_id = ? AND connection_state = 'active'
        AND (last_sync_requested_at IS NULL OR last_sync_requested_at < ?)
        AND NOT EXISTS (
          SELECT 1 FROM provider_events event
           WHERE event.profile_id = google_accounts.profile_id
             AND event.account_id = google_accounts.account_id
             AND event.state IN ('received', 'processing', 'retryable')
             AND COALESCE(json_extract(event.payload_json, '$.mode'), '') != 'continue'
        )`,
  )
    .bind(timestamp, profileId, accountId, threshold)
    .run();
  if (Number(updated.meta.changes ?? 0) !== 1) return false;
  await enqueueSyncEvent(
    env,
    account.backfill_page_token === null
      ? account.unresolved_failures > 0
        ? { profileId, accountId, mode: 'newest' }
        : { profileId, accountId, mode: 'partial' }
      : { profileId, accountId, mode: 'partial' },
    now,
  );
  return true;
}

function safeJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

interface StoredMessageRow {
  readonly message_id: string;
  readonly internet_message_id: string | null;
  readonly sender_json: string;
  readonly recipients_json: string;
  readonly sent_at: string;
  readonly body_text_ciphertext: string;
  readonly body_html_ciphertext: string | null;
}

interface StoredAttachmentRow {
  readonly account_id: string;
  readonly thread_id: string;
  readonly message_id: string;
  readonly resource_id: string;
  readonly file_name: string;
  readonly mime_type: string;
  readonly size_bytes: number;
  readonly disposition: 'attachment' | 'inline';
  readonly content_id: string | null;
  readonly gmail_part_path: string;
  readonly gmail_attachment_id_ciphertext: string | null;
}

function attachmentMetadata(row: StoredAttachmentRow): EmailAttachmentMetadata {
  return {
    resourceId: row.resource_id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    disposition: row.disposition,
    contentId: row.content_id,
  };
}

async function storedThreadMessages(
  env: Env,
  profileId: string,
  accountId: string,
  threadId: string,
): Promise<readonly StoredMessageRow[]> {
  const messages = await env.DB.prepare(
    `SELECT message_id, internet_message_id, sender_json, recipients_json,
            sent_at, body_text_ciphertext, body_html_ciphertext
       FROM mail_messages
      WHERE profile_id = ? AND account_id = ? AND thread_id = ?
      ORDER BY ordinal
      LIMIT 20`,
  )
    .bind(profileId, accountId, threadId)
    .all<StoredMessageRow>();
  return messages.results;
}

async function storedThreadAttachments(
  env: Env,
  profileId: string,
  accountId: string,
  threadId: string,
): Promise<readonly StoredAttachmentRow[]> {
  const attachments = await env.DB.prepare(
    `SELECT account_id, thread_id, message_id, resource_id, file_name,
            mime_type, size_bytes, disposition, content_id, gmail_part_path,
            gmail_attachment_id_ciphertext
       FROM mail_attachments
      WHERE profile_id = ? AND account_id = ? AND thread_id = ?
      ORDER BY message_id, gmail_part_path`,
  )
    .bind(profileId, accountId, threadId)
    .all<StoredAttachmentRow>();
  return attachments.results;
}

async function hydrateLegacyThreadHtml(
  env: Env,
  profileId: string,
  accountId: string,
  threadId: string,
  now: Date,
): Promise<void> {
  const scope = { profileId, accountId };
  try {
    const row = await accountRow(env, scope);
    const accessToken = await accessTokenFor(env, scope, now);
    await fetchAndPersistThreads(
      env,
      scope,
      accessToken,
      row.email_address!,
      [threadId],
      now.toISOString(),
    );
  } catch (error) {
    if (!(error instanceof GoogleApiError)) throw error;
    console.warn(JSON.stringify({
      message: 'gmail rich body hydration failed; returning cached plain text',
      profileId,
      accountId,
      threadId,
      code: error.code,
      ...(error.providerReason ? { providerReason: error.providerReason } : {}),
    }));
  }
}

function mailboxPageSize(value: number | undefined): number {
  if (value === undefined) return defaultMailboxPageSize;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximumMailboxPageSize) {
    throw new MailboxPageError(
      'invalid_mailbox_limit',
      `Mailbox page size must be between 1 and ${maximumMailboxPageSize}.`,
    );
  }
  return value;
}

function mailboxCursor(value: string | undefined): MailboxCursor | null {
  if (value === undefined) return null;
  if (
    value.length === 0 ||
    value.length > maximumMailboxCursorLength ||
    !/^[a-zA-Z0-9_-]+$/u.test(value)
  ) {
    throw new MailboxPageError('invalid_mailbox_cursor', 'The mailbox cursor is malformed.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeBase64Url(value, maximumMailboxCursorBytes));
  } catch {
    throw new MailboxPageError('invalid_mailbox_cursor', 'The mailbox cursor is malformed.');
  }
  const cursor = asRecord(parsed);
  const parsedReceivedAt = typeof cursor?.receivedAt === 'string'
    ? Date.parse(cursor.receivedAt)
    : Number.NaN;
  if (
    cursor?.v !== 1 ||
    typeof cursor.receivedAt !== 'string' ||
    !Number.isFinite(parsedReceivedAt) ||
    new Date(parsedReceivedAt).toISOString() !== cursor.receivedAt ||
    !isSafeMailIdentifier(cursor.accountId) ||
    !isSafeMailIdentifier(cursor.threadId)
  ) {
    throw new MailboxPageError('invalid_mailbox_cursor', 'The mailbox cursor is malformed.');
  }
  return {
    v: 1,
    receivedAt: cursor.receivedAt,
    accountId: cursor.accountId,
    threadId: cursor.threadId,
  };
}

function encodedMailboxCursor(cursor: MailboxCursor): string {
  return encodeBase64Url(JSON.stringify(cursor));
}

function mailboxPageClause(cursor: MailboxCursor | null): string {
  return cursor
    ? `AND (
          t.received_at < ? OR (
            t.received_at = ? AND (
              t.account_id > ? OR (t.account_id = ? AND t.thread_id > ?)
            )
          )
        )`
    : '';
}

function mailboxPageBindings(
  profileId: string,
  cursor: MailboxCursor | null,
  limit: number,
): readonly (string | number)[] {
  return cursor
    ? [
        profileId,
        cursor.receivedAt,
        cursor.receivedAt,
        cursor.accountId,
        cursor.accountId,
        cursor.threadId,
        limit,
      ]
    : [profileId, limit];
}

interface MailboxThreadRow {
  readonly profile_id: string;
  readonly account_id: string;
  readonly thread_id: string;
  readonly history_id: string;
  readonly subject: string;
  readonly snippet: string;
  readonly participants_json: string;
  readonly received_at: string;
  readonly unread: number;
  readonly starred: number;
  readonly important: number;
  readonly in_inbox: number;
  readonly needs_response: number;
  readonly waiting_on_others: number;
  readonly label_ids_json: string;
}

export async function mailboxPage(
  env: Env,
  profileId: string,
  options: MailboxPageOptions = {},
): Promise<MailboxPageResult> {
  const pageSize = mailboxPageSize(options.limit);
  const cursor = mailboxCursor(options.cursor);
  const pageClause = mailboxPageClause(cursor);
  const after = options.afterRevision;
  if (after !== undefined && (!Number.isSafeInteger(after) || after < 0 || options.cursor !== undefined)) {
    throw new MailboxPageError('invalid_mailbox_cursor', 'The change revision is malformed.');
  }
  const changeSelection = `SELECT * FROM mailbox_changes
    WHERE profile_id = ? AND revision > ? ORDER BY revision LIMIT ?`;
  const selection = after === undefined
    ? `SELECT t.* FROM mail_threads t WHERE t.profile_id = ? ${pageClause}
       ORDER BY t.received_at DESC, t.account_id, t.thread_id LIMIT ?`
    : `SELECT t.* FROM mail_threads t JOIN (${changeSelection}) c
         ON c.profile_id = t.profile_id AND c.account_id = t.account_id
        AND c.thread_id = t.thread_id WHERE c.deleted = 0`;
  const bindings = (limit: number) => after === undefined
    ? mailboxPageBindings(profileId, cursor, limit)
    : [profileId, after, limit];
  // D1 batch is a transaction: keys, previews, tombstones and the watermark
  // describe the same committed database state, even during provider writes.
  const results = await env.DB.batch([
    env.DB.prepare("SELECT COALESCE(MAX(seq), 0) AS revision FROM sqlite_sequence WHERE name = 'mailbox_changes'"),
    env.DB.prepare(`SELECT profile_id, account_id, email_address, display_name, accent,
            coverage_state, newest_history_id, backfill_complete_through,
            unresolved_failures, updated_at, backfill_page_token
       FROM google_accounts
      WHERE profile_id = ? AND connection_state != 'revoked'
      ORDER BY created_at`).bind(profileId),
    env.DB.prepare(`WITH selected_threads AS (${selection}) SELECT t.*
      FROM selected_threads t`).bind(...bindings(after === undefined ? pageSize + 1 : pageSize)),
    env.DB.prepare(
      `WITH selected_threads AS (
         ${selection}
       )
       SELECT m.account_id, m.thread_id, m.message_id, m.internet_message_id,
              m.sender_json, m.recipients_json, m.sent_at, m.ordinal
         FROM mail_messages m
         JOIN selected_threads t
           ON t.profile_id = m.profile_id AND t.account_id = m.account_id
          AND t.thread_id = m.thread_id
        WHERE m.ordinal = (
            SELECT MAX(last_message.ordinal) FROM mail_messages last_message
             WHERE last_message.profile_id = m.profile_id
               AND last_message.account_id = m.account_id
               AND last_message.thread_id = m.thread_id
          )
        ORDER BY m.account_id, m.thread_id, m.ordinal`,
    ).bind(...bindings(pageSize)),
    env.DB.prepare(
      `WITH selected_threads AS (
         ${selection}
       ), latest_messages AS (
         SELECT m.profile_id, m.account_id, m.thread_id, m.message_id
           FROM mail_messages m
           JOIN selected_threads t
             ON t.profile_id = m.profile_id AND t.account_id = m.account_id
            AND t.thread_id = m.thread_id
          WHERE m.ordinal = (
            SELECT MAX(last_message.ordinal) FROM mail_messages last_message
             WHERE last_message.profile_id = m.profile_id
               AND last_message.account_id = m.account_id
               AND last_message.thread_id = m.thread_id
          )
       )
       SELECT a.account_id, a.thread_id, a.message_id, a.resource_id,
              a.file_name, a.mime_type, a.size_bytes, a.disposition,
              a.content_id, a.gmail_part_path, NULL AS gmail_attachment_id_ciphertext
         FROM mail_attachments a
         JOIN latest_messages m
           ON m.profile_id = a.profile_id AND m.account_id = a.account_id
          AND m.thread_id = a.thread_id AND m.message_id = a.message_id
        ORDER BY a.account_id, a.thread_id, a.message_id, a.gmail_part_path`,
    ).bind(...bindings(pageSize)),
    env.DB.prepare(
      `WITH selected_threads AS (${selection})
       SELECT r.account_id, r.reminder_id, r.thread_id, r.due_at, r.condition, r.created_at
         FROM tap_reminders r JOIN selected_threads t
           ON t.profile_id = r.profile_id AND t.account_id = r.account_id AND t.thread_id = r.thread_id
        WHERE r.state IN ('pending', 'due')`,
    ).bind(...bindings(pageSize)),
    env.DB.prepare(changeSelection).bind(profileId, after ?? 0, after === undefined ? 0 : pageSize + 1),
  ]);
  const watermark = results[0]! as D1Result<{ revision: number }>;
  const revision = watermark.results[0]!.revision;
  if (after !== undefined && after > revision) {
    throw new MailboxPageError('invalid_mailbox_cursor', 'The change revision is ahead of the mailbox.');
  }
  const accounts = results[1]! as D1Result<AccountRow>;
  const threadResults = results[2]! as D1Result<MailboxThreadRow>;
  const messages = results[3]! as D1Result<{
    account_id: string; thread_id: string; message_id: string; internet_message_id: string | null;
    sender_json: string; recipients_json: string; sent_at: string; ordinal: number;
  }>;
  const attachments = results[4]! as D1Result<StoredAttachmentRow>;
  const reminders = results[5]! as D1Result<{
    account_id: string; reminder_id: string; thread_id: string; due_at: string;
    condition: 'if_no_reply' | 'regardless'; created_at: string;
  }>;
  const changes = results[6]!.results as Array<{
    revision: number; account_id: string; thread_id: string; deleted: number;
  }>;
  const threads = threadResults.results.slice(0, pageSize);
  const lastThread = threads.at(-1);
  const nextCursor = after === undefined && threadResults.results.length > pageSize && lastThread
    ? encodedMailboxCursor({ v: 1, receivedAt: lastThread.received_at,
        accountId: lastThread.account_id, threadId: lastThread.thread_id })
    : null;
  const hasMore = changes.length > pageSize;
  const changePage = changes.slice(0, pageSize);
  // Mailbox pages carry metadata only. Message bodies are fetched through the
  // exact account/thread endpoint when the user opens a conversation.
  const messagePreviews = messages.results.map(message => ({
    message,
    bodyText: '',
  }));
  const attachmentsByMessage = new Map<string, EmailAttachmentMetadata[]>();
  for (const attachment of attachments.results) {
    const key = `${attachment.account_id}:${attachment.thread_id}:${attachment.message_id}`;
    const group = attachmentsByMessage.get(key) ?? [];
    group.push(attachmentMetadata(attachment));
    attachmentsByMessage.set(key, group);
  }
  const messagesByThread = new Map<string, unknown[]>();
  for (const { message, bodyText } of messagePreviews) {
    const key = `${message.account_id}:${message.thread_id}`;
    const group = messagesByThread.get(key) ?? [];
    group.push({
      messageId: message.message_id,
      internetMessageId: message.internet_message_id,
      from: safeJson<Participant>(message.sender_json, { name: 'Unknown sender', address: 'unknown@invalid.local' }),
      to: safeJson<readonly Participant[]>(message.recipients_json, []),
      sentAt: message.sent_at,
      bodyText,
      attachments: attachmentsByMessage.get(
        `${message.account_id}:${message.thread_id}:${message.message_id}`,
      ) ?? [],
    });
    messagesByThread.set(key, group);
  }
  const reminderByThread = new Map(
    reminders.results.map(reminder => [
      `${reminder.account_id}:${reminder.thread_id}`,
      {
        reminderId: reminder.reminder_id,
        accountId: reminder.account_id,
        threadId: reminder.thread_id,
        dueAt: reminder.due_at,
        condition: reminder.condition,
        createdAt: reminder.created_at,
      },
    ]),
  );
  return {
    mailbox: {
      schemaVersion: 1,
      accounts: accounts.results.map(account => ({
        accountId: account.account_id,
        provider: 'google',
        address: account.email_address ?? '',
        displayName: account.email_address ?? account.display_name ?? 'Google',
        accent: account.accent ?? '#74a7a1',
        coverage: {
          accountId: account.account_id,
          state: account.coverage_state,
          newestHistoryId: account.newest_history_id,
          observedAt: account.updated_at,
          backfillCompleteThrough: account.backfill_complete_through,
          unresolvedFailures: account.unresolved_failures,
        },
      })),
      threads: threads.map(thread => {
        const key = `${thread.account_id}:${thread.thread_id}`;
        const reminder = reminderByThread.get(key) ?? null;
        const labels = stringArray(safeJson<unknown>(thread.label_ids_json, []));
        const providerResources = gmailProviderResources(labels);
        return {
          threadId: thread.thread_id,
          accountId: thread.account_id,
          providerRevision: thread.history_id,
          subject: thread.subject,
          participants: safeJson<readonly Participant[]>(thread.participants_json, []),
          snippet: thread.snippet,
          receivedAt: thread.received_at,
          unread: thread.unread === 1,
          starred: thread.starred === 1,
          critical: thread.important === 1,
          needsResponse: thread.needs_response === 1,
          waitingOnOthers: thread.waiting_on_others === 1,
          providerResources,
          status: providerResources.includes('trash')
            ? 'trashed'
            : thread.in_inbox === 1
              ? 'inbox'
              : 'done',
          labels,
          messages: messagesByThread.get(key) ?? [],
          reminder,
        };
      }),
    },
    pageInfo: { nextCursor, revision },
    ...(after === undefined ? {} : {
      changes: {
        nextRevision: hasMore ? changePage.at(-1)!.revision : revision,
        hasMore,
        deletedThreads: changePage.filter(change => change.deleted === 1 && change.thread_id !== '')
          .map(change => ({ accountId: change.account_id, threadId: change.thread_id })),
      },
    }),
  };
}

export async function mailboxSnapshot(
  env: Env,
  profileId: string,
): Promise<Readonly<Record<string, unknown>>> {
  return (await mailboxPage(env, profileId)).mailbox;
}

export async function threadSnapshot(
  env: Env,
  profileId: string,
  accountId: string,
  threadId: string,
  now = new Date(),
): Promise<Readonly<Record<string, unknown>> | null> {
  const thread = await env.DB.prepare(
    `SELECT thread_id, content_state FROM mail_threads
      WHERE profile_id = ? AND account_id = ? AND thread_id = ?`,
  )
    .bind(profileId, accountId, threadId)
    .first<{ thread_id: string; content_state: 'metadata' | 'full' }>();
  if (!thread) return null;
  if (thread.content_state === 'metadata') {
    const scope = { profileId, accountId };
    const account = await accountRow(env, scope);
    const accessToken = await accessTokenFor(env, scope, now);
    const hydrated = await fetchAndPersistThreads(
      env,
      scope,
      accessToken,
      account.email_address!,
      [threadId],
      now.toISOString(),
      null,
      'full',
    );
    if (hydrated.length === 0) return null;
  }
  let messages = await storedThreadMessages(env, profileId, accountId, threadId);
  if (messages.some(message => message.body_html_ciphertext === null)) {
    await hydrateLegacyThreadHtml(env, profileId, accountId, threadId, now);
    messages = await storedThreadMessages(env, profileId, accountId, threadId);
  }
  const attachments = await storedThreadAttachments(env, profileId, accountId, threadId);
  const attachmentsByMessage = new Map<string, EmailAttachmentMetadata[]>();
  for (const attachment of attachments) {
    const group = attachmentsByMessage.get(attachment.message_id) ?? [];
    group.push(attachmentMetadata(attachment));
    attachmentsByMessage.set(attachment.message_id, group);
  }
  const decryptedMessages = await Promise.all(messages.map(async message => {
    const bodyHtml = message.body_html_ciphertext === null
      ? null
      : await openSecret(
        message.body_html_ciphertext,
        env.GOOGLE_TOKEN_ENCRYPTION_KEY,
      );
    return {
      messageId: message.message_id,
      internetMessageId: message.internet_message_id,
      from: safeJson<Participant>(message.sender_json, { name: 'Unknown sender', address: 'unknown@invalid.local' }),
      to: safeJson<readonly Participant[]>(message.recipients_json, []),
      sentAt: message.sent_at,
      bodyText: await openSecret(
        message.body_text_ciphertext,
        env.GOOGLE_TOKEN_ENCRYPTION_KEY,
      ),
      bodyHtml: bodyHtml || null,
      attachments: attachmentsByMessage.get(message.message_id) ?? [],
    };
  }));
  return {
    accountId,
    threadId,
    messages: decryptedMessages,
  };
}

/**
 * Returns the rich body for one message only when it belongs to the authenticated
 * profile/account/thread tuple. Remote-image hydration uses this to bind every
 * upstream fetch to mail the caller can already read instead of accepting an
 * arbitrary public URL.
 */
export async function storedMessageRichBody(
  env: Env,
  profileId: string,
  accountId: string,
  threadId: string,
  messageId: string,
): Promise<string | null | undefined> {
  const message = await env.DB.prepare(
    `SELECT body_html_ciphertext
       FROM mail_messages
      WHERE profile_id = ? AND account_id = ? AND thread_id = ? AND message_id = ?`,
  )
    .bind(profileId, accountId, threadId, messageId)
    .first<{ readonly body_html_ciphertext: string | null }>();
  if (!message) return undefined;
  if (message.body_html_ciphertext === null) return null;
  return openSecret(
    message.body_html_ciphertext,
    env.GOOGLE_TOKEN_ENCRYPTION_KEY,
  );
}

export interface AttachmentContent extends EmailAttachmentMetadata {
  readonly bytes: Uint8Array;
}

/**
 * Resolves one attachment only after a profile/account/thread/message/resource
 * tuple matches a stored row. Gmail attachment IDs and MIME part paths remain
 * coordinator-private and cannot be selected directly by callers.
 */
export async function attachmentContent(
  env: Env,
  profileId: string,
  accountId: string,
  threadId: string,
  messageId: string,
  resourceId: string,
  now = new Date(),
): Promise<AttachmentContent> {
  const attachment = await env.DB.prepare(
    `SELECT account_id, thread_id, message_id, resource_id, file_name,
            mime_type, size_bytes, disposition, content_id, gmail_part_path,
            gmail_attachment_id_ciphertext
       FROM mail_attachments
      WHERE profile_id = ? AND account_id = ? AND thread_id = ?
        AND message_id = ? AND resource_id = ?`,
  )
    .bind(profileId, accountId, threadId, messageId, resourceId)
    .first<StoredAttachmentRow>();
  if (!attachment) {
    throw new AttachmentContentError(
      404,
      'attachment_not_found',
      'The attachment was not found.',
    );
  }
  if (attachment.size_bytes > maximumGoogleAttachmentBytes) {
    throw new AttachmentContentError(
      413,
      'attachment_too_large',
      'The attachment exceeds the 8 MiB download limit.',
    );
  }
  let gmailAttachmentId: string | null = null;
  if (attachment.gmail_attachment_id_ciphertext) {
    try {
      gmailAttachmentId = await openSecret(
        attachment.gmail_attachment_id_ciphertext,
        env.GOOGLE_TOKEN_ENCRYPTION_KEY,
      );
    } catch {
      throw new AttachmentContentError(
        502,
        'attachment_content_invalid',
        'The stored attachment locator is invalid.',
      );
    }
  }
  const accessToken = await accessTokenFor(env, { profileId, accountId }, now);
  let bytes: Uint8Array | null;
  try {
    bytes = await googleAttachmentBytes(accessToken, messageId, {
      attachmentId: gmailAttachmentId,
      partPath: attachment.gmail_part_path,
    });
  } catch (error) {
    if (error instanceof GoogleApiError && error.status === 404) {
      throw new AttachmentContentError(
        404,
        'attachment_not_found',
        'The attachment no longer exists in Gmail.',
      );
    }
    throw error;
  }
  if (!bytes) {
    throw new AttachmentContentError(
      404,
      'attachment_not_found',
      'The attachment no longer exists in Gmail.',
    );
  }
  if (bytes.byteLength !== attachment.size_bytes) {
    throw new AttachmentContentError(
      bytes.byteLength > maximumGoogleAttachmentBytes ? 413 : 502,
      bytes.byteLength > maximumGoogleAttachmentBytes
        ? 'attachment_too_large'
        : 'attachment_content_invalid',
      bytes.byteLength > maximumGoogleAttachmentBytes
        ? 'The attachment exceeds the 8 MiB download limit.'
        : 'The attachment bytes do not match their stored metadata.',
    );
  }
  return { ...attachmentMetadata(attachment), bytes };
}

export async function executeTapOwnedCommand(
  env: Env,
  scope: ProviderScope,
  command: MailCommand,
  now: string,
): Promise<ProviderExecutionResult | null> {
  if (command.kind !== 'create_reminder' && command.kind !== 'cancel_reminder') return null;
  if (!command.threadId) return { outcome: 'failed', errorCode: 'thread_required' };
  const payload = command.payload as Readonly<Record<string, unknown>>;
  if (!isSafeMailIdentifier(payload.reminderId)) {
    return { outcome: 'failed', errorCode: 'invalid_reminder' };
  }
  const thread = await env.DB.prepare(
    `SELECT thread_id FROM mail_threads
      WHERE profile_id = ? AND account_id = ? AND thread_id = ?`,
  )
    .bind(scope.profileId, scope.accountId, command.threadId)
    .first<{ readonly thread_id: string }>();
  if (!thread) return { outcome: 'failed', errorCode: 'thread_not_found' };
  if (command.kind === 'cancel_reminder') {
    await env.DB.prepare(
      `UPDATE tap_reminders SET state = 'cancelled', updated_at = ?
        WHERE profile_id = ? AND account_id = ? AND thread_id = ?
          AND reminder_id = ?`,
    )
      .bind(now, scope.profileId, scope.accountId, command.threadId, payload.reminderId)
      .run();
    return { outcome: 'acknowledged', providerRevision: command.expectedProviderRevision };
  }
  if (
    typeof payload.dueAt !== 'string' ||
    !Number.isFinite(Date.parse(payload.dueAt)) ||
    Date.parse(payload.dueAt) <= Date.parse(now) ||
    (payload.condition !== 'if_no_reply' && payload.condition !== 'regardless')
  ) {
    return { outcome: 'failed', errorCode: 'invalid_reminder' };
  }
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE tap_reminders SET state = 'cancelled', updated_at = ?
        WHERE profile_id = ? AND account_id = ? AND thread_id = ?
          AND state IN ('pending', 'due')`,
    ).bind(now, scope.profileId, scope.accountId, command.threadId),
    env.DB.prepare(
      `INSERT INTO tap_reminders
         (profile_id, account_id, reminder_id, thread_id, due_at,
          condition, state, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    ).bind(
      scope.profileId,
      scope.accountId,
      payload.reminderId,
      command.threadId,
      payload.dueAt,
      payload.condition,
      now,
      now,
    ),
  ]);
  return { outcome: 'acknowledged', providerRevision: command.expectedProviderRevision };
}

export async function markDueReminders(env: Env, now: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE tap_reminders SET state = 'due', updated_at = ?
      WHERE state = 'pending' AND due_at <= ?`,
  )
    .bind(now, now)
    .run();
}

export async function enqueueScheduledSyncs(env: Env, now: Date): Promise<void> {
  const staleBefore = new Date(now.getTime() - 4 * 60_000).toISOString();
  const accounts = await env.DB.prepare(
    `SELECT profile_id, account_id, backfill_page_token, unresolved_failures
      FROM google_accounts
      WHERE connection_state = 'active'
        AND (last_sync_requested_at IS NULL OR last_sync_requested_at < ?)
        AND NOT EXISTS (
          SELECT 1 FROM provider_events event
           WHERE event.profile_id = google_accounts.profile_id
             AND event.account_id = google_accounts.account_id
             AND event.state IN ('received', 'processing', 'retryable')
             AND COALESCE(json_extract(event.payload_json, '$.mode'), '') != 'continue'
        )
      ORDER BY COALESCE(last_sync_requested_at, created_at)
      LIMIT 20`,
  )
    .bind(staleBefore)
    .all<{
      profile_id: string;
      account_id: string;
      backfill_page_token: string | null;
      unresolved_failures: number;
    }>();
  if (accounts.results.length === 0) return;

  const timestamp = now.toISOString();
  const claimed: typeof accounts.results = [];
  for (const account of accounts.results) {
    const updated = await env.DB.prepare(
      `UPDATE google_accounts
          SET last_sync_requested_at = ?
        WHERE profile_id = ? AND account_id = ? AND connection_state = 'active'
          AND (last_sync_requested_at IS NULL OR last_sync_requested_at < ?)
          AND NOT EXISTS (
            SELECT 1 FROM provider_events event
             WHERE event.profile_id = google_accounts.profile_id
               AND event.account_id = google_accounts.account_id
               AND event.state IN ('received', 'processing', 'retryable')
               AND COALESCE(json_extract(event.payload_json, '$.mode'), '') != 'continue'
          )`,
    )
      .bind(timestamp, account.profile_id, account.account_id, staleBefore)
      .run();
    if (Number(updated.meta.changes ?? 0) === 1) claimed.push(account);
  }
  if (claimed.length === 0) return;

  await enqueueSyncEvents(
    env,
    claimed.map(account => account.backfill_page_token === null && account.unresolved_failures > 0
      ? {
          profileId: account.profile_id,
          accountId: account.account_id,
          mode: 'newest' as const,
        }
      : {
          profileId: account.profile_id,
          accountId: account.account_id,
          mode: 'partial' as const,
        }),
    now,
  );
}
