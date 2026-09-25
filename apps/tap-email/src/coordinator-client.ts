import {
  sdk,
  type MiniAppHttpRequestInput,
  type MiniAppHttpRequestOptions,
  type MiniAppHttpResponse,
  type MiniAppMaybePromise,
} from '@theaiplatform/miniapp-sdk/sdk';
import type {
  AccountCoverage,
  MailCommand,
  MailCommandReceipt,
  MailDraftAttachment,
  MailDraftPayload,
  ScheduledSendSummary,
} from '@tap-examples/tap-email-protocol';
import {
  MAXIMUM_THREAD_RESPONSE_BYTES,
  MAXIMUM_THREAD_PAGE_MESSAGES,
  MAXIMUM_THREAD_CURSOR_LENGTH,
  serializedUtf8Bytes,
  isAccountCoverage,
  isMailCommandReceipt,
  isMailDraftPayload,
  isMailDraftAttachment,
  isScheduledSendSummary,
  isSafeMailIdentifier,
  MAXIMUM_DRAFT_ATTACHMENT_BYTES,
} from '@tap-examples/tap-email-protocol';
import {
  isEmailAttachment,
  isEmailMessage,
  isMailboxSnapshot,
  type EmailAttachment,
  type EmailMessage,
  type MailboxSnapshot,
} from './domain';

const productionCoordinatorOrigin = 'https://tap-email-coordinator.theaiplatform.app';
const localDevelopmentProfile = 'tap-email-local-dev';
const maximumRemoteImageBatchSize = 32;
const maximumRemoteImageBytes = 2 * 1_024 * 1_024;
const maximumRemoteImageResponseBytes = 9_000_000;
export const maximumAttachmentDownloadBytes = 8 * 1_024 * 1_024;
const maximumMailboxPageThreads = 100;
const maximumMailboxCursorLength = 4_096;
const maximumOutboundAttachmentChunkBytes = 256 * 1_024;
const safeRemoteImageData = /^data:image\/(?:avif|gif|jpe?g|png|webp);base64,([a-z0-9+/]+={0,2})$/iu;

declare const __TAP_EMAIL_COORDINATOR_ORIGIN__: string | undefined;

function normalizeCoordinatorOrigin(value: string): string {
  const parsed = new URL(value);
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.origin !== value ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error('TAP Email coordinator origin must be an exact HTTP(S) origin.');
  }
  return parsed.origin;
}

const configuredCoordinatorOrigin =
  typeof __TAP_EMAIL_COORDINATOR_ORIGIN__ === 'string'
    ? __TAP_EMAIL_COORDINATOR_ORIGIN__.trim()
    : '';

export const coordinatorOrigin = normalizeCoordinatorOrigin(
  configuredCoordinatorOrigin || productionCoordinatorOrigin,
);

function isLoopbackCoordinator(origin: string): boolean {
  const host = new URL(origin).hostname.toLowerCase();
  return (
    host === 'localhost' ||
    host === '::1' ||
    host === '[::1]' ||
    /^127(?:\.\d{1,3}){3}$/u.test(host)
  );
}

export interface CoordinatorTransport {
  request(
    input: MiniAppHttpRequestInput,
    options?: MiniAppHttpRequestOptions,
  ): MiniAppMaybePromise<MiniAppHttpResponse>;
}

export interface CommandAcceptance {
  readonly accepted: true;
  readonly duplicate: boolean;
  readonly receipt: MailCommandReceipt;
}

export interface RemoteImageMessageContext {
  readonly accountId: string;
  readonly threadId: string;
  readonly messageId: string;
}

export interface AttachmentMessageContext extends RemoteImageMessageContext {}

export interface StageOutboundAttachmentInput {
  readonly accountId: string;
  readonly draftKey: string;
  readonly idempotencyKey: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}

export interface ThreadPage {
  readonly messages: readonly EmailMessage[];
  readonly providerRevision: string;
  readonly nextCursor: string | null;
  readonly complete: boolean;
}

/** Pages arrive newest first, while each page is in conversation order. */
export function mergeConversationPage(
  current: readonly EmailMessage[], older: readonly EmailMessage[],
): readonly EmailMessage[] {
  const seen = new Set(current.map(message => message.messageId));
  return [...older.filter(message => !seen.has(message.messageId)), ...current];
}

export class CoordinatorError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function parseResponse(response: MiniAppHttpResponse): unknown {
  if (response.bodyTruncated || response.bodyKind !== 'text' || !response.bodyText) {
    throw new CoordinatorError(
      response.status,
      'invalid_response',
      'The TAP Email coordinator returned an unreadable response.',
    );
  }
  try {
    return JSON.parse(response.bodyText);
  } catch {
    throw new CoordinatorError(
      response.status,
      'invalid_response',
      'The TAP Email coordinator returned invalid JSON.',
    );
  }
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CoordinatorError(502, 'invalid_response', 'Coordinator response is malformed.');
  }
  return value as Readonly<Record<string, unknown>>;
}

interface OutboundAttachmentStageReceipt {
  readonly attachment: MailDraftAttachment;
  readonly chunkSize: number;
  readonly expectedChunks: number;
  readonly receivedChunks: number;
  readonly state: 'staging' | 'ready' | 'consumed';
  readonly expiresAt: string;
}

function outboundAttachmentStage(value: unknown): OutboundAttachmentStageReceipt {
  const body = asRecord(value);
  const stage = asRecord(body.stage);
  if (
    !isMailDraftAttachment(stage.attachment) ||
    !Number.isSafeInteger(stage.chunkSize) ||
    Number(stage.chunkSize) <= 0 ||
    Number(stage.chunkSize) > maximumOutboundAttachmentChunkBytes ||
    !Number.isSafeInteger(stage.expectedChunks) ||
    Number(stage.expectedChunks) <= 0 ||
    !Number.isSafeInteger(stage.receivedChunks) ||
    Number(stage.receivedChunks) < 0 ||
    Number(stage.receivedChunks) > Number(stage.expectedChunks) ||
    (stage.state !== 'staging' && stage.state !== 'ready' && stage.state !== 'consumed') ||
    typeof stage.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(stage.expiresAt))
  ) {
    throw new CoordinatorError(502, 'invalid_response', 'Attachment upload response is malformed.');
  }
  return {
    attachment: stage.attachment,
    chunkSize: Number(stage.chunkSize),
    expectedChunks: Number(stage.expectedChunks),
    receivedChunks: Number(stage.receivedChunks),
    state: stage.state,
    expiresAt: stage.expiresAt,
  };
}

function encodeBase64(bytes: Uint8Array): string {
  const segments: string[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += 32_768) {
    segments.push(String.fromCharCode(...bytes.subarray(offset, offset + 32_768)));
  }
  return btoa(segments.join(''));
}

async function sha256Base64Url(bytes: Uint8Array): Promise<string> {
  const stableBytes = new Uint8Array(bytes.byteLength);
  stableBytes.set(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', stableBytes));
  return encodeBase64(digest).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/gu, '');
}

function sameDraftAttachment(
  left: MailDraftAttachment,
  right: MailDraftAttachment,
): boolean {
  return (
    left.stageId === right.stageId &&
    left.fileName === right.fileName &&
    left.mimeType === right.mimeType &&
    left.sizeBytes === right.sizeBytes &&
    left.sha256Base64Url === right.sha256Base64Url
  );
}

async function call(
  transport: CoordinatorTransport,
  input: MiniAppHttpRequestInput,
  responseBodyLimitBytes = 262_144,
  origin = coordinatorOrigin,
  expectedContext?: MailDraftPayload['expectedContext'],
): Promise<unknown> {
  const localDevelopment = isLoopbackCoordinator(origin);
  const response = await transport.request(
    {
      ...input,
      ...(localDevelopment
        ? {
            headers: [
              ...(input.headers ?? []),
              { name: 'X-TAP-Dev-Profile', value: localDevelopmentProfile },
            ],
          }
        : {}),
      responseBodyLimitBytes,
      timeoutMs: 30_000,
    },
    localDevelopment ? undefined : { credentialRef: 'platform-session', ...(expectedContext ? { expectedContext } : {}) },
  );
  const body = asRecord(parseResponse(response));
  if (response.status < 200 || response.status >= 300) {
    throw new CoordinatorError(
      response.status,
      typeof body.error === 'string' ? body.error : 'coordinator_error',
      typeof body.message === 'string' ? body.message : 'Coordinator request failed.',
    );
  }
  return body;
}

export interface MailboxPage {
  readonly mailbox: MailboxSnapshot;
  readonly nextCursor: string | null;
  /** Absent only on older coordinators; never use an unversioned page to reconcile. */
  readonly revision?: number;
}

export interface MailboxChanges extends MailboxPage {
  readonly revision: number;
  readonly nextRevision: number;
  readonly hasMore: boolean;
  readonly deletedThreads: readonly { readonly accountId: string; readonly threadId: string }[];
}

export interface MailboxLoadProgress extends MailboxPage {
  readonly loadedThreadCount: number;
  readonly pageCount: number;
  readonly complete: boolean;
}

export interface MailboxLoadOptions {
  /** Streaming consumers persist each page and do not retain a second mailbox. */
  readonly collect?: boolean;
  readonly signal?: AbortSignal;
  /** Resume after the last page that was durably merged into the device replica. */
  readonly startCursor?: string | null;
  /** Called once for every bounded page, before the following request begins. */
  readonly onPage?: (progress: MailboxLoadProgress) => void | Promise<void>;
}

function mailboxPage(value: unknown): MailboxPage {
  const body = asRecord(value);
  const mailbox = asRecord(body.mailbox);
  if (
    !isMailboxSnapshot(mailbox) ||
    mailbox.threads.length > maximumMailboxPageThreads
  ) {
    throw new CoordinatorError(502, 'invalid_response', 'Mailbox response is malformed.');
  }
  if (body.pageInfo === undefined) return { mailbox, nextCursor: null };
  const pageInfo = asRecord(body.pageInfo);
  const nextCursor = pageInfo.nextCursor;
  if (
    nextCursor !== null &&
    (typeof nextCursor !== 'string' ||
      nextCursor.length === 0 ||
      nextCursor.length > maximumMailboxCursorLength)
  ) {
    throw new CoordinatorError(502, 'invalid_response', 'Mailbox page cursor is malformed.');
  }
  const revision = pageInfo.revision;
  if (revision !== undefined && (!Number.isSafeInteger(revision) || Number(revision) < 0)) {
    throw new CoordinatorError(502, 'invalid_response', 'Mailbox revision is malformed.');
  }
  return { mailbox, nextCursor, ...(revision === undefined ? {} : { revision: Number(revision) }) };
}

function remoteImages(value: unknown, requestedUrls: ReadonlySet<string>): Readonly<Record<string, string>> {
  const body = asRecord(value);
  if (!Array.isArray(body.images) || !Array.isArray(body.blocked)) {
    throw new CoordinatorError(502, 'invalid_response', 'Remote image response is malformed.');
  }
  const loaded: Record<string, string> = {};
  for (const candidate of body.images) {
    const image = asRecord(candidate);
    const dataUrl = typeof image.dataUrl === 'string' ? image.dataUrl : null;
    const match = dataUrl
      ? safeRemoteImageData.exec(dataUrl)
      : null;
    if (
      typeof image.url !== 'string' ||
      !requestedUrls.has(image.url) ||
      dataUrl === null ||
      !match ||
      !Number.isSafeInteger(image.sizeBytes) ||
      Number(image.sizeBytes) < 0 ||
      Number(image.sizeBytes) > maximumRemoteImageBytes
    ) {
      throw new CoordinatorError(502, 'invalid_response', 'Remote image response is malformed.');
    }
    const padding = match[1]!.endsWith('==') ? 2 : match[1]!.endsWith('=') ? 1 : 0;
    const decodedSize = Math.floor(match[1]!.length * 3 / 4) - padding;
    if (decodedSize !== image.sizeBytes) {
      throw new CoordinatorError(502, 'invalid_response', 'Remote image response size is invalid.');
    }
    loaded[image.url] = dataUrl;
  }
  for (const candidate of body.blocked) {
    const blocked = asRecord(candidate);
    if (typeof blocked.url !== 'string' || !requestedUrls.has(blocked.url)) {
      throw new CoordinatorError(502, 'invalid_response', 'Remote image response is malformed.');
    }
  }
  return loaded;
}

const safeBase64 = /^(?:[a-z0-9+/]{4})*(?:[a-z0-9+/]{2}==|[a-z0-9+/]{3}=)?$/iu;

function decodeAttachmentBody(response: MiniAppHttpResponse, attachment: EmailAttachment): Uint8Array {
  const expectedMimeType = attachment.mimeType.split(';', 1)[0]!.trim().toLowerCase();
  const responseMimeType = response.contentType?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (
    response.bodyTruncated ||
    response.bodyKind !== 'binary' ||
    response.bodyText !== null ||
    response.bodyBase64 === null ||
    !safeBase64.test(response.bodyBase64) ||
    !Number.isSafeInteger(response.sizeBytes) ||
    response.sizeBytes !== attachment.sizeBytes ||
    responseMimeType !== expectedMimeType
  ) {
    throw new CoordinatorError(
      502,
      'invalid_response',
      'The attachment response did not match its metadata.',
    );
  }

  let decoded: string;
  try {
    decoded = atob(response.bodyBase64);
  } catch {
    throw new CoordinatorError(502, 'invalid_response', 'The attachment response was malformed.');
  }
  if (
    decoded.length !== attachment.sizeBytes ||
    decoded.length > maximumAttachmentDownloadBytes
  ) {
    throw new CoordinatorError(
      502,
      'invalid_response',
      'The attachment response did not match its declared size.',
    );
  }
  return Uint8Array.from(decoded, character => character.charCodeAt(0));
}

export function createCoordinatorClient(
  transport?: CoordinatorTransport,
  origin = coordinatorOrigin,
) {
  const resolved = transport ?? sdk.http;
  if (!resolved) {
    throw new CoordinatorError(
      0,
      'host_http_unavailable',
      'This TAP host does not provide the coordinator transport.',
    );
  }
  return {
    async beginGoogleConnection(): Promise<string> {
      const body = asRecord(
        await call(
          resolved,
          {
            method: 'POST',
            url: `${origin}/v1/accounts/google/connect`,
          },
          262_144,
          origin,
        ),
      );
      if (typeof body.authorizationUrl !== 'string') {
        throw new CoordinatorError(502, 'invalid_response', 'Google connection response is malformed.');
      }
      return body.authorizationUrl;
    },
    async getMailboxPage(cursor: string | null = null): Promise<MailboxPage> {
      if (
        cursor !== null &&
        (cursor.length === 0 || cursor.length > maximumMailboxCursorLength)
      ) {
        throw new CoordinatorError(400, 'invalid_mailbox_cursor', 'Mailbox page cursor is malformed.');
      }
      return mailboxPage(
        await call(
          resolved,
          {
            method: 'GET',
            url: cursor
              ? `${origin}/v1/mailbox?cursor=${encodeURIComponent(cursor)}`
              : `${origin}/v1/mailbox`,
          },
          2_097_152,
          origin,
        ),
      );
    },
    async getMailboxChanges(afterRevision: number): Promise<MailboxChanges> {
      if (!Number.isSafeInteger(afterRevision) || afterRevision < 0) {
        throw new CoordinatorError(400, 'invalid_mailbox_cursor', 'Mailbox revision is malformed.');
      }
      const body = asRecord(await call(resolved, {
        method: 'GET', url: `${origin}/v1/mailbox/changes?after=${afterRevision}`,
      }, 2_097_152, origin));
      const page = mailboxPage(body);
      const changes = asRecord(body.changes);
      if (
        page.revision === undefined || page.nextCursor !== null ||
        !Number.isSafeInteger(changes.nextRevision) || Number(changes.nextRevision) < afterRevision ||
        Number(changes.nextRevision) > page.revision ||
        typeof changes.hasMore !== 'boolean' ||
        (changes.hasMore && Number(changes.nextRevision) <= afterRevision) ||
        (!changes.hasMore && changes.nextRevision !== page.revision) ||
        !Array.isArray(changes.deletedThreads) ||
        changes.deletedThreads.length + page.mailbox.threads.length > maximumMailboxPageThreads ||
        !changes.deletedThreads.every((item: unknown) => {
          const row = asRecord(item);
          return isSafeMailIdentifier(row.accountId) && isSafeMailIdentifier(row.threadId);
        })
      ) {
        throw new CoordinatorError(502, 'invalid_response', 'Mailbox changes are malformed.');
      }
      const deletedThreads = changes.deletedThreads as MailboxChanges['deletedThreads'];
      const deletedKeys = new Set(deletedThreads.map(item => `${item.accountId}\u0000${item.threadId}`));
      if (page.mailbox.threads.some(item => deletedKeys.has(`${item.accountId}\u0000${item.threadId}`))) {
        throw new CoordinatorError(502, 'invalid_response', 'Mailbox change identities conflict.');
      }
      return { ...page, revision: page.revision, nextRevision: Number(changes.nextRevision),
        hasMore: changes.hasMore, deletedThreads };
    },
    async getMailbox(options: MailboxLoadOptions = {}): Promise<MailboxSnapshot> {
      const threads: MailboxSnapshot['threads'][number][] = [];
      const seenThreadKeys = new Set<string>();
      const seenCursors = new Set<string>();
      let accounts: MailboxSnapshot['accounts'] = [];
      let cursor: string | null = options.startCursor ?? null;
      let pageCount = 0;
      let loadedThreadCount = 0;

      while (true) {
        options.signal?.throwIfAborted();
        const page = await this.getMailboxPage(cursor);
        options.signal?.throwIfAborted();
        pageCount += 1;
        if (accounts.length === 0) accounts = page.mailbox.accounts;
        let addedThreads = 0;
        for (const thread of page.mailbox.threads) {
          const key = `${thread.accountId}\u0000${thread.threadId}`;
          if (seenThreadKeys.has(key)) continue;
          seenThreadKeys.add(key);
          if (options.collect !== false) threads.push(thread);
          addedThreads += 1;
        }

        loadedThreadCount += addedThreads;
        const complete = page.nextCursor === null;
        await options.onPage?.({
          ...page,
          loadedThreadCount,
          pageCount,
          complete,
        });

        options.signal?.throwIfAborted();
        if (complete) {
          return { schemaVersion: 1, accounts, threads };
        }
        if (
          page.mailbox.threads.length === 0 ||
          addedThreads === 0 ||
          seenCursors.has(page.nextCursor)
        ) {
          throw new CoordinatorError(
            502,
            'invalid_response',
            'Mailbox pagination did not advance.',
          );
        }
        seenCursors.add(page.nextCursor);
        if (options.collect === false) {
          // Keep only the prior page's identities and a bounded cycle detector.
          seenThreadKeys.clear();
          for (const thread of page.mailbox.threads) seenThreadKeys.add(`${thread.accountId}\u0000${thread.threadId}`);
          if (seenCursors.size > 32) seenCursors.delete(seenCursors.values().next().value!);
        }
        cursor = page.nextCursor;
      }
    },
    async getThreadPage(accountId: string, threadId: string, cursor: string | null = null): Promise<ThreadPage> {
      if (!isSafeMailIdentifier(accountId) || !isSafeMailIdentifier(threadId) ||
          (cursor !== null && (!cursor || cursor.length > MAXIMUM_THREAD_CURSOR_LENGTH))) {
        throw new CoordinatorError(400, 'invalid_thread_cursor', 'Conversation identity or cursor is invalid.');
      }
      const body = asRecord(await call(resolved, {
        method: 'GET',
        url: `${origin}/v1/accounts/${encodeURIComponent(accountId)}/threads/${encodeURIComponent(threadId)}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
      }, MAXIMUM_THREAD_RESPONSE_BYTES, origin));
      const thread = asRecord(body.thread);
      const pageInfo = asRecord(thread.pageInfo);
      const nextCursor = pageInfo.nextCursor;
      if (serializedUtf8Bytes(body) > MAXIMUM_THREAD_RESPONSE_BYTES ||
          thread.accountId !== accountId || thread.threadId !== threadId ||
          typeof thread.providerRevision !== 'string' || !thread.providerRevision ||
          !Array.isArray(thread.messages) || thread.messages.length > MAXIMUM_THREAD_PAGE_MESSAGES ||
          !thread.messages.every(isEmailMessage) ||
          new Set(thread.messages.map(message => message.messageId)).size !== thread.messages.length ||
          (nextCursor !== null && (typeof nextCursor !== 'string' || !nextCursor ||
            nextCursor.length > MAXIMUM_THREAD_CURSOR_LENGTH || nextCursor === cursor || thread.messages.length === 0)) ||
          pageInfo.complete !== (nextCursor === null)) {
        throw new CoordinatorError(502, 'invalid_response', 'Conversation page is malformed.');
      }
      return { messages: thread.messages, providerRevision: thread.providerRevision,
        nextCursor: nextCursor as string | null, complete: pageInfo.complete as boolean };
    },
    async getThread(accountId: string, threadId: string): Promise<readonly EmailMessage[]> {
      let messages: readonly EmailMessage[] = [];
      let cursor: string | null = null;
      let revision: string | null = null;
      const seen = new Set<string>();
      do {
        const page = await this.getThreadPage(accountId, threadId, cursor);
        if ((revision !== null && page.providerRevision !== revision) ||
            (page.nextCursor !== null && seen.has(page.nextCursor))) {
          throw new CoordinatorError(409, 'thread_changed', 'Reload this conversation to continue.');
        }
        revision = page.providerRevision;
        const merged = mergeConversationPage(messages, page.messages);
        if (cursor !== null && merged.length === messages.length) {
          throw new CoordinatorError(502, 'invalid_response', 'Conversation pagination did not advance.');
        }
        messages = merged;
        cursor = page.nextCursor;
        if (cursor !== null) seen.add(cursor);
      } while (cursor !== null);
      return messages;
    },
    async getScheduledSends(): Promise<readonly ScheduledSendSummary[]> {
      const body = asRecord(
        await call(
          resolved,
          { method: 'GET', url: `${origin}/v1/scheduled-sends` },
          524_288,
          origin,
        ),
      );
      if (
        !Array.isArray(body.scheduledSends) ||
        body.scheduledSends.length > 500 ||
        !body.scheduledSends.every(isScheduledSendSummary)
      ) {
        throw new CoordinatorError(
          502,
          'invalid_response',
          'Scheduled-send response is malformed.',
        );
      }
      return body.scheduledSends;
    },
    async stageAttachment(
      input: StageOutboundAttachmentInput,
    ): Promise<MailDraftAttachment> {
      const digest = await sha256Base64Url(input.bytes);
      const validationDescriptor: MailDraftAttachment = {
        stageId: 'stage_validation',
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.bytes.byteLength,
        sha256Base64Url: digest,
      };
      if (
        !isSafeMailIdentifier(input.accountId) ||
        !isSafeMailIdentifier(input.draftKey) ||
        !isSafeMailIdentifier(input.idempotencyKey) ||
        input.bytes.byteLength > MAXIMUM_DRAFT_ATTACHMENT_BYTES ||
        !isMailDraftAttachment(validationDescriptor)
      ) {
        throw new CoordinatorError(
          input.bytes.byteLength > MAXIMUM_DRAFT_ATTACHMENT_BYTES ? 413 : 400,
          input.bytes.byteLength > MAXIMUM_DRAFT_ATTACHMENT_BYTES
            ? 'attachment_too_large'
            : 'invalid_attachment_stage',
          input.bytes.byteLength > MAXIMUM_DRAFT_ATTACHMENT_BYTES
            ? 'This attachment is larger than the 8 MiB upload limit.'
            : 'The selected attachment metadata is invalid.',
        );
      }

      const scope = `${origin}/v1/accounts/${encodeURIComponent(input.accountId)}/drafts/${encodeURIComponent(input.draftKey)}/attachments`;
      let stage = outboundAttachmentStage(await call(
        resolved,
        {
          method: 'POST',
          url: scope,
          headers: [{ name: 'Content-Type', value: 'application/json' }],
          body: JSON.stringify({
            idempotencyKey: input.idempotencyKey,
            fileName: input.fileName,
            mimeType: input.mimeType,
            sizeBytes: input.bytes.byteLength,
            sha256Base64Url: digest,
          }),
        },
        262_144,
        origin,
      ));
      if (
        stage.attachment.fileName !== input.fileName ||
        stage.attachment.mimeType !== input.mimeType ||
        stage.attachment.sizeBytes !== input.bytes.byteLength ||
        stage.attachment.sha256Base64Url !== digest
      ) {
        throw new CoordinatorError(502, 'invalid_response', 'Attachment upload identity changed.');
      }
      if (stage.state === 'consumed') {
        throw new CoordinatorError(410, 'attachment_stage_expired', 'This attachment upload was already consumed.');
      }

      if (stage.state === 'staging') {
        for (let index = 0; index < stage.expectedChunks; index += 1) {
          const chunk = input.bytes.subarray(
            index * stage.chunkSize,
            Math.min(input.bytes.byteLength, (index + 1) * stage.chunkSize),
          );
          stage = outboundAttachmentStage(await call(
            resolved,
            {
              method: 'POST',
              url: `${scope}/${encodeURIComponent(stage.attachment.stageId)}/chunks/${index}`,
              headers: [{ name: 'Content-Type', value: 'application/json' }],
              body: JSON.stringify({ dataBase64: encodeBase64(chunk) }),
            },
            262_144,
            origin,
          ));
        }
        stage = outboundAttachmentStage(await call(
          resolved,
          {
            method: 'POST',
            url: `${scope}/${encodeURIComponent(stage.attachment.stageId)}/complete`,
          },
          262_144,
          origin,
        ));
      }
      if (stage.state !== 'ready' || !sameDraftAttachment(stage.attachment, {
        ...validationDescriptor,
        stageId: stage.attachment.stageId,
      })) {
        throw new CoordinatorError(502, 'invalid_response', 'Attachment upload did not complete safely.');
      }
      return stage.attachment;
    },
    async downloadAttachment(
      context: AttachmentMessageContext,
      attachment: EmailAttachment,
    ): Promise<Uint8Array> {
      if (
        !isSafeMailIdentifier(context.accountId) ||
        !isSafeMailIdentifier(context.threadId) ||
        !isSafeMailIdentifier(context.messageId) ||
        !isEmailAttachment(attachment)
      ) {
        throw new CoordinatorError(
          400,
          'invalid_attachment',
          'Supply a valid message and attachment identity.',
        );
      }
      if (attachment.sizeBytes > maximumAttachmentDownloadBytes) {
        throw new CoordinatorError(
          413,
          'attachment_too_large',
          'This attachment is larger than the 8 MB download limit.',
        );
      }

      const url = `${origin}/v1/accounts/${encodeURIComponent(context.accountId)}/threads/${encodeURIComponent(context.threadId)}/messages/${encodeURIComponent(context.messageId)}/attachments/${encodeURIComponent(attachment.resourceId)}`;
      const localDevelopment = isLoopbackCoordinator(origin);
      const response = await resolved.request(
        {
          method: 'GET',
          url,
          ...(localDevelopment
            ? { headers: [{ name: 'X-TAP-Dev-Profile', value: localDevelopmentProfile }] }
            : {}),
          responseBodyLimitBytes: maximumAttachmentDownloadBytes,
          timeoutMs: 30_000,
        },
        localDevelopment ? undefined : { credentialRef: 'platform-session' },
      );
      if (response.status < 200 || response.status >= 300) {
        const body = asRecord(parseResponse(response));
        throw new CoordinatorError(
          response.status,
          typeof body.error === 'string' ? body.error : 'coordinator_error',
          typeof body.message === 'string' ? body.message : 'Attachment download failed.',
        );
      }
      if (response.finalUrl !== url) {
        throw new CoordinatorError(502, 'invalid_response', 'The attachment response was redirected.');
      }
      return decodeAttachmentBody(response, attachment);
    },
    async loadRemoteImages(
      context: RemoteImageMessageContext,
      urls: readonly string[],
    ): Promise<Readonly<Record<string, string>>> {
      const uniqueUrls = [...new Set(urls)];
      if (
        !context.accountId ||
        !context.threadId ||
        !context.messageId ||
        uniqueUrls.length === 0 ||
        uniqueUrls.some(url => typeof url !== 'string' || url.length > 4_096)
      ) {
        throw new CoordinatorError(
          400,
          'invalid_remote_images',
          'Supply one or more valid remote image URLs.',
        );
      }
      const loaded: Record<string, string> = {};
      let successfulBatches = 0;
      let firstFailure: unknown = null;
      for (
        let offset = 0;
        offset < uniqueUrls.length;
        offset += maximumRemoteImageBatchSize
      ) {
        const batch = uniqueUrls.slice(offset, offset + maximumRemoteImageBatchSize);
        try {
          const body = await call(
            resolved,
            {
              method: 'POST',
              url: `${origin}/v1/accounts/${encodeURIComponent(context.accountId)}/threads/${encodeURIComponent(context.threadId)}/messages/${encodeURIComponent(context.messageId)}/remote-images`,
              headers: [{ name: 'Content-Type', value: 'application/json' }],
              body: JSON.stringify({ urls: batch }),
            },
            maximumRemoteImageResponseBytes,
            origin,
          );
          Object.assign(loaded, remoteImages(body, new Set(batch)));
          successfulBatches += 1;
        } catch (error) {
          firstFailure ??= error;
        }
      }
      // Preserve successfully validated batches. RichMessageBody compares this
      // map with the complete requested URL set and exposes an explicit partial
      // status. If no request succeeded, retain the existing hard-error path.
      if (successfulBatches === 0 && firstFailure) throw firstFailure;
      return loaded;
    },
    async requestSync(accountId: string): Promise<boolean> {
      const body = asRecord(
        await call(
          resolved,
          {
            method: 'POST',
            url: `${origin}/v1/accounts/${encodeURIComponent(accountId)}/sync`,
          },
          262_144,
          origin,
        ),
      );
      return body.queued === true;
    },
    async submitCommand(command: MailCommand): Promise<CommandAcceptance> {
      const body = asRecord(
        await call(
          resolved,
          {
            method: 'POST',
            url: `${origin}/v1/commands`,
            headers: [{ name: 'Content-Type', value: 'application/json' }],
            body: JSON.stringify(command),
          },
          262_144,
          origin,
          isMailDraftPayload(command.payload) ? command.payload.expectedContext : undefined,
        ),
      );
      if (
        body.accepted !== true ||
        typeof body.duplicate !== 'boolean' ||
        !isMailCommandReceipt(body.receipt)
      ) {
        throw new CoordinatorError(502, 'invalid_response', 'Command receipt is malformed.');
      }
      return {
        accepted: true,
        duplicate: body.duplicate,
        receipt: body.receipt,
      };
    },
    async getCommand(commandId: string): Promise<MailCommandReceipt> {
      const body = asRecord(
        await call(
          resolved,
          {
            method: 'GET',
            url: `${origin}/v1/commands/${encodeURIComponent(commandId)}`,
          },
          262_144,
          origin,
        ),
      );
      if (!isMailCommandReceipt(body.receipt)) {
        throw new CoordinatorError(502, 'invalid_response', 'Command receipt is malformed.');
      }
      return body.receipt;
    },
    async reconcileCommand(commandId: string, expectedContext?: MailDraftPayload['expectedContext']): Promise<MailCommandReceipt> {
      const body = asRecord(
        await call(
          resolved,
          {
            method: 'POST',
            url: `${origin}/v1/commands/${encodeURIComponent(commandId)}/reconcile`,
          },
          262_144,
          origin,
          expectedContext,
        ),
      );
      if (!isMailCommandReceipt(body.receipt) || body.receipt.commandId !== commandId) {
        throw new CoordinatorError(502, 'invalid_response', 'Reconciliation receipt is malformed.');
      }
      return body.receipt;
    },
    async getCoverage(): Promise<readonly AccountCoverage[]> {
      const body = asRecord(
        await call(
          resolved,
          { method: 'GET', url: `${origin}/v1/accounts/coverage` },
          262_144,
          origin,
        ),
      );
      if (!Array.isArray(body.accounts) || !body.accounts.every(isAccountCoverage)) {
        throw new CoordinatorError(502, 'invalid_response', 'Coverage response is malformed.');
      }
      return body.accounts;
    },
  };
}
