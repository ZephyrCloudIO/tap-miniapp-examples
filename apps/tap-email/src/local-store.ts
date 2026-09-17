import {
  sdk,
  type MiniAppPrivateSqlDatabase,
  type MiniAppPrivateSqlTransaction,
  type MiniAppPrivateStorageApi,
  type MiniAppPrivateStorageHandle,
} from '@theaiplatform/miniapp-sdk/sdk';
import { isSafeMailIdentifier } from '@tap-examples/tap-email-protocol';
import { isMailState, type MailState } from './domain';
import {
  deleteNormalizedLocalAccount,
  deleteNormalizedLocalReplica,
  localReplicaMigrations,
  localReplicaStatistics,
  mailStateWithoutAccount,
  replaceNormalizedLocalReplica,
  type LocalReplicaAccountCoverage,
  type LocalReplicaEntityCounts,
} from './local-replica';

export type LocalMailStoreCapability =
  | 'private-profile-sqlite'
  | 'preview-fixture'
  | 'unavailable';

export interface LocalMailStore {
  readonly capability: LocalMailStoreCapability;
  load(): Promise<MailState | null>;
  save(state: MailState): Promise<void>;
  loadMailboxPageProgress(): Promise<MailboxPageProgress | null>;
  saveMailboxPageProgress(progress: MailboxPageProgress): Promise<void>;
  clearMailboxPageProgress(): Promise<void>;
  loadRemoteImages(urls: readonly string[]): Promise<Readonly<Record<string, string>>>;
  saveRemoteImages(images: Readonly<Record<string, string>>): Promise<void>;
  loadAttachment(identity: AttachmentCacheIdentity): Promise<Uint8Array | null>;
  saveAttachment(identity: AttachmentCacheIdentity, bytes: Uint8Array): Promise<void>;
  inspectStorage(): Promise<LocalStorageInventory>;
  wipeAccount(accountId: string): Promise<LocalDataWipeReceipt>;
  wipeDevice(): Promise<LocalDataWipeReceipt>;
  close(): Promise<void>;
}

export interface MailboxPageProgress {
  readonly nextCursor: string;
  readonly pagesLoaded: number;
  readonly threadsLoaded: number;
  readonly updatedAt: string;
}

export type LocalStorageClass =
  | 'raw-mail'
  | 'search-metadata'
  | 'semantic-vector'
  | 'attachment'
  | 'remote-image'
  | 'audit';

export interface LocalStorageClassInventory {
  readonly class: LocalStorageClass;
  readonly measurement: 'logical' | 'physical' | 'unavailable';
  readonly itemCount: number | null;
  readonly bytes: number | null;
  readonly note: string | null;
}

export interface LocalStorageInventory {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly capability: LocalMailStoreCapability;
  readonly scope: 'private-profile' | 'preview' | 'unavailable';
  readonly indexedAt: string | null;
  readonly accounts: readonly LocalReplicaAccountCoverage[];
  readonly counts: LocalReplicaEntityCounts;
  readonly classes: readonly LocalStorageClassInventory[];
  readonly quota: {
    readonly usedBytes: number | null;
    readonly quotaBytes: number | null;
    readonly hostLimitBytes: number | null;
    readonly effectiveBytes: number | null;
  };
  readonly warnings: readonly string[];
}

export interface LocalDataWipeReceipt {
  readonly schemaVersion: 1;
  readonly scope: 'account' | 'device';
  readonly accountId: string | null;
  readonly completedAt: string;
  /** False while another local component or in-memory copy remains. */
  readonly complete: boolean;
  readonly removedClasses: readonly LocalStorageClass[];
  readonly overRemovedClasses: readonly LocalStorageClass[];
  readonly remainingClasses: readonly LocalStorageClass[];
  readonly removed: {
    readonly accounts: number;
    readonly threads: number;
    readonly messages: number;
    readonly attachmentMetadata: number;
    readonly cachedAttachmentBytes: number;
    readonly cachedRemoteImageBytes: number;
  };
  readonly warnings: readonly string[];
}

export interface AttachmentCacheIdentity {
  readonly accountId: string;
  readonly threadId: string;
  readonly messageId: string;
  readonly resourceId: string;
  readonly sizeBytes: number;
}

const previewKey = 'tap-example.tap-email.preview-mailbox.v1';
const previewMailboxPageProgressKey = 'tap-example.tap-email.preview-mailbox-page-progress.v1';
const databaseName = 'tap-email-mailbox-v1.sqlite';
const remoteImageDirectory = 'remote-images';
const attachmentDirectory = 'attachments';
const maximumRemoteImageBytes = 2 * 1_024 * 1_024;
const maximumAttachmentBytes = 8 * 1_024 * 1_024;
const defaultRemoteImageCacheBytes = 256 * 1_024 * 1_024;
const defaultAttachmentCacheBytes = 512 * 1_024 * 1_024;
export const remoteImageCacheTtlMs = 30 * 24 * 60 * 60 * 1_000;
export const attachmentCacheTtlMs = 30 * 24 * 60 * 60 * 1_000;
const attachmentOrphanGraceMs = 24 * 60 * 60 * 1_000;
const supportedRemoteImageTypes = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const remoteImageDataUrl = /^data:(image\/(?:avif|gif|jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/u;
const cacheKeyPattern = /^[a-f0-9]{64}$/u;
const attachmentStorageTokenPattern = /^(\d{1,16})-([a-f0-9]{32})$/u;
const attachmentFilePattern = /^([a-f0-9]{64})\.([a-f0-9]{64})\.(\d{1,16}-[a-f0-9]{32})\.bin$/u;
const mailboxMigration = {
  version: 1,
  sql: `CREATE TABLE IF NOT EXISTS mailbox_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    schema_version INTEGER NOT NULL,
    state_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
} as const;
const remoteImageMigration = {
  version: 2,
  sql: `CREATE TABLE IF NOT EXISTS remote_image_cache (
    cache_key TEXT PRIMARY KEY,
    source_url TEXT NOT NULL,
    media_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    last_accessed_at INTEGER NOT NULL
  )`,
} as const;
const attachmentMigration = {
  version: 3,
  sql: `CREATE TABLE IF NOT EXISTS attachment_cache (
    cache_key TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    last_accessed_at INTEGER NOT NULL
  )`,
} as const;
const attachmentStorageTokenMigration = {
  version: 4,
  sql: 'ALTER TABLE attachment_cache ADD COLUMN storage_token TEXT',
} as const;

const zeroEntityCounts: LocalReplicaEntityCounts = {
  accounts: 0,
  threads: 0,
  messages: 0,
  participants: 0,
  resources: 0,
  labels: 0,
  attachmentMetadata: 0,
};

interface CachedRemoteImageRow {
  readonly cacheKey: string;
  readonly sourceUrl: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly expiresAt: number;
  readonly lastAccessedAt: number;
}

interface CachedAttachmentRow extends AttachmentCacheIdentity {
  readonly cacheKey: string;
  readonly contentHash: string;
  readonly storageToken: string | null;
  readonly expiresAt: number;
  readonly lastAccessedAt: number;
}

function base64DecodedSize(value: string): number {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return Math.floor(value.length * 3 / 4) - padding;
}

function decodeCachedImage(value: string): { mediaType: string; bytes: Uint8Array } | null {
  const match = remoteImageDataUrl.exec(value);
  if (!match || !supportedRemoteImageTypes.has(match[1]!)) return null;
  const encoded = match[2]!;
  const decodedSize = base64DecodedSize(encoded);
  if (decodedSize <= 0 || decodedSize > maximumRemoteImageBytes) return null;
  try {
    const binary = atob(encoded);
    if (binary.length !== decodedSize) return null;
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return { mediaType: match[1]!, bytes };
  } catch {
    return null;
  }
}

function encodeCachedImage(mediaType: string, bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  }
  return `data:${mediaType};base64,${btoa(chunks.join(''))}`;
}

async function remoteImageCacheKey(sourceUrl: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(sourceUrl),
  );
  return Array.from(new Uint8Array(digest), byte =>
    byte.toString(16).padStart(2, '0')).join('');
}

function validAttachmentIdentity(identity: AttachmentCacheIdentity): boolean {
  return (
    identity.accountId.length > 0 && identity.accountId.length <= 512 &&
    identity.threadId.length > 0 && identity.threadId.length <= 512 &&
    identity.messageId.length > 0 && identity.messageId.length <= 512 &&
    identity.resourceId.length > 0 && identity.resourceId.length <= 512 &&
    Number.isSafeInteger(identity.sizeBytes) &&
    identity.sizeBytes >= 0 &&
    identity.sizeBytes <= maximumAttachmentBytes
  );
}

async function attachmentCacheKey(identity: AttachmentCacheIdentity): Promise<string> {
  if (!validAttachmentIdentity(identity)) {
    throw new Error('Attachment cache identity is malformed.');
  }
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify([
      identity.accountId,
      identity.threadId,
      identity.messageId,
      identity.resourceId,
      identity.sizeBytes,
    ])),
  );
  return Array.from(new Uint8Array(digest), byte =>
    byte.toString(16).padStart(2, '0')).join('');
}

async function attachmentContentHash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
  return Array.from(new Uint8Array(digest), byte =>
    byte.toString(16).padStart(2, '0')).join('');
}

function remoteImagePath(cacheKey: string): string {
  if (!cacheKeyPattern.test(cacheKey)) {
    throw new Error('Remote image cache key is malformed.');
  }
  return `${remoteImageDirectory}/${cacheKey}.bin`;
}

function attachmentPath(
  cacheKey: string,
  contentHash: string,
  storageToken: string | null,
): string {
  if (
    !cacheKeyPattern.test(cacheKey) ||
    !cacheKeyPattern.test(contentHash) ||
    (storageToken !== null && !attachmentStorageTokenPattern.test(storageToken))
  ) {
    throw new Error('Attachment cache identity is malformed.');
  }
  return `${attachmentDirectory}/${cacheKey}.${contentHash}${
    storageToken === null ? '' : `.${storageToken}`
  }.bin`;
}

function attachmentStorageToken(observedAt: number): string {
  return `${Math.max(0, Math.floor(observedAt))}-${crypto.randomUUID().replaceAll('-', '')}`;
}

function valueAt(
  columns: readonly string[],
  row: readonly unknown[],
  column: string,
): unknown {
  const index = columns.indexOf(column);
  return index >= 0 ? row[index] : undefined;
}

function cachedRemoteImageRow(
  columns: readonly string[],
  row: readonly unknown[],
): CachedRemoteImageRow | null {
  const cacheKey = valueAt(columns, row, 'cache_key');
  const sourceUrl = valueAt(columns, row, 'source_url');
  const mediaType = valueAt(columns, row, 'media_type');
  const sizeBytes = valueAt(columns, row, 'size_bytes');
  const expiresAt = valueAt(columns, row, 'expires_at');
  const lastAccessedAt = valueAt(columns, row, 'last_accessed_at');
  if (
    typeof cacheKey !== 'string' ||
    !cacheKeyPattern.test(cacheKey) ||
    typeof sourceUrl !== 'string' ||
    typeof mediaType !== 'string' ||
    !supportedRemoteImageTypes.has(mediaType) ||
    typeof sizeBytes !== 'number' ||
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes <= 0 ||
    sizeBytes > maximumRemoteImageBytes ||
    typeof expiresAt !== 'number' ||
    !Number.isSafeInteger(expiresAt) ||
    typeof lastAccessedAt !== 'number' ||
    !Number.isSafeInteger(lastAccessedAt)
  ) {
    return null;
  }
  return { cacheKey, sourceUrl, mediaType, sizeBytes, expiresAt, lastAccessedAt };
}

function cachedAttachmentRow(
  columns: readonly string[],
  row: readonly unknown[],
): CachedAttachmentRow | null {
  const cacheKey = valueAt(columns, row, 'cache_key');
  const identity = {
    accountId: valueAt(columns, row, 'account_id'),
    threadId: valueAt(columns, row, 'thread_id'),
    messageId: valueAt(columns, row, 'message_id'),
    resourceId: valueAt(columns, row, 'resource_id'),
    sizeBytes: valueAt(columns, row, 'size_bytes'),
  };
  const contentHash = valueAt(columns, row, 'content_hash');
  const storageToken = valueAt(columns, row, 'storage_token');
  const expiresAt = valueAt(columns, row, 'expires_at');
  const lastAccessedAt = valueAt(columns, row, 'last_accessed_at');
  if (
    typeof cacheKey !== 'string' ||
    !cacheKeyPattern.test(cacheKey) ||
    typeof identity.accountId !== 'string' ||
    typeof identity.threadId !== 'string' ||
    typeof identity.messageId !== 'string' ||
    typeof identity.resourceId !== 'string' ||
    typeof identity.sizeBytes !== 'number' ||
    !validAttachmentIdentity(identity as AttachmentCacheIdentity) ||
    typeof contentHash !== 'string' ||
    !cacheKeyPattern.test(contentHash) ||
    (storageToken !== null && (
      typeof storageToken !== 'string' ||
      !attachmentStorageTokenPattern.test(storageToken)
    )) ||
    typeof expiresAt !== 'number' ||
    !Number.isSafeInteger(expiresAt) ||
    typeof lastAccessedAt !== 'number' ||
    !Number.isSafeInteger(lastAccessedAt)
  ) {
    return null;
  }
  return {
    cacheKey,
    accountId: identity.accountId,
    threadId: identity.threadId,
    messageId: identity.messageId,
    resourceId: identity.resourceId,
    sizeBytes: identity.sizeBytes,
    contentHash,
    storageToken,
    expiresAt,
    lastAccessedAt,
  };
}

function sameAttachmentIdentity(
  left: AttachmentCacheIdentity,
  right: AttachmentCacheIdentity,
): boolean {
  return left.accountId === right.accountId &&
    left.threadId === right.threadId &&
    left.messageId === right.messageId &&
    left.resourceId === right.resourceId &&
    left.sizeBytes === right.sizeBytes;
}

interface StoredMailboxState {
  readonly state: MailState;
  readonly serialized: string;
  readonly updatedAt: string;
}

function mailboxPageProgress(value: unknown): MailboxPageProgress | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Readonly<Record<string, unknown>>;
  if (
    typeof candidate.nextCursor !== 'string' ||
    candidate.nextCursor.length === 0 ||
    candidate.nextCursor.length > 4_096 ||
    !Number.isSafeInteger(candidate.pagesLoaded) ||
    Number(candidate.pagesLoaded) < 0 ||
    !Number.isSafeInteger(candidate.threadsLoaded) ||
    Number(candidate.threadsLoaded) < 0 ||
    typeof candidate.updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(candidate.updatedAt))
  ) return null;
  return {
    nextCursor: candidate.nextCursor,
    pagesLoaded: Number(candidate.pagesLoaded),
    threadsLoaded: Number(candidate.threadsLoaded),
    updatedAt: new Date(Date.parse(candidate.updatedAt)).toISOString(),
  };
}

function parseStoredMailboxState(
  columns: readonly string[],
  row: readonly unknown[] | undefined,
): StoredMailboxState | null {
  if (!row) return null;
  const serialized = valueAt(columns, row, 'state_json');
  const updatedAt = valueAt(columns, row, 'updated_at');
  if (
    typeof serialized !== 'string' ||
    typeof updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(updatedAt))
  ) {
    return null;
  }
  try {
    const state: unknown = JSON.parse(serialized);
    return isMailState(state) ? { state, serialized, updatedAt } : null;
  } catch {
    return null;
  }
}

function sumCacheBytes<T extends { readonly sizeBytes: number }>(
  rows: readonly T[],
): number {
  return rows.reduce((total, row) => total + row.sizeBytes, 0);
}

interface PrivateDirectoryUsage {
  readonly itemCount: number;
  readonly storedBytes: number;
}

async function privateDirectoryUsage(
  storage: MiniAppPrivateStorageHandle,
  directory: string,
): Promise<PrivateDirectoryUsage | null> {
  try {
    const listing = await storage.files.list(directory);
    let itemCount = 0;
    let storedBytes = 0;
    for (const entry of listing.entries) {
      if (entry.kind !== 'file') continue;
      if (!Number.isSafeInteger(entry.storedBytes) || entry.storedBytes < 0) {
        return null;
      }
      itemCount += 1;
      storedBytes += entry.storedBytes;
      if (!Number.isSafeInteger(storedBytes)) return null;
    }
    return { itemCount, storedBytes };
  } catch {
    return null;
  }
}

function emptyInventory(
  capability: LocalMailStoreCapability,
  scope: LocalStorageInventory['scope'],
  generatedAt: string,
  warning: string,
): LocalStorageInventory {
  return {
    schemaVersion: 1,
    generatedAt,
    capability,
    scope,
    indexedAt: null,
    accounts: [],
    counts: zeroEntityCounts,
    classes: [
      'raw-mail',
      'search-metadata',
      'semantic-vector',
      'attachment',
      'remote-image',
      'audit',
    ].map(dataClass => ({
      class: dataClass as LocalStorageClass,
      measurement: 'unavailable' as const,
      itemCount: null,
      bytes: null,
      note: warning,
    })),
    quota: {
      usedBytes: null,
      quotaBytes: null,
      hostLimitBytes: null,
      effectiveBytes: null,
    },
    warnings: [warning],
  };
}

function incompleteWipeReceipt(
  scope: LocalDataWipeReceipt['scope'],
  accountId: string | null,
  completedAt: string,
  warning: string,
): LocalDataWipeReceipt {
  return {
    schemaVersion: 1,
    scope,
    accountId,
    completedAt,
    complete: false,
    removedClasses: [],
    overRemovedClasses: [],
    remainingClasses: [
      'raw-mail',
      'search-metadata',
      'semantic-vector',
      'attachment',
      'remote-image',
      'audit',
    ],
    removed: {
      accounts: 0,
      threads: 0,
      messages: 0,
      attachmentMetadata: 0,
      cachedAttachmentBytes: 0,
      cachedRemoteImageBytes: 0,
    },
    warnings: [warning],
  };
}

export class PreviewFixtureMailStore implements LocalMailStore {
  readonly capability = 'preview-fixture' as const;

  async load(): Promise<MailState | null> {
    const raw = globalThis.localStorage?.getItem(previewKey);
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      return isMailState(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  async save(state: MailState): Promise<void> {
    globalThis.localStorage?.setItem(previewKey, JSON.stringify(state));
  }

  async loadMailboxPageProgress(): Promise<MailboxPageProgress | null> {
    const raw = globalThis.localStorage?.getItem(previewMailboxPageProgressKey);
    if (!raw) return null;
    try {
      return mailboxPageProgress(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async saveMailboxPageProgress(progress: MailboxPageProgress): Promise<void> {
    const valid = mailboxPageProgress(progress);
    if (!valid) throw new Error('Mailbox page progress is malformed.');
    globalThis.localStorage?.setItem(previewMailboxPageProgressKey, JSON.stringify(valid));
  }

  async clearMailboxPageProgress(): Promise<void> {
    globalThis.localStorage?.removeItem(previewMailboxPageProgressKey);
  }

  async loadRemoteImages(): Promise<Readonly<Record<string, string>>> {
    return {};
  }

  async saveRemoteImages(): Promise<void> {}

  async loadAttachment(): Promise<Uint8Array | null> {
    return null;
  }

  async saveAttachment(): Promise<void> {}

  async inspectStorage(): Promise<LocalStorageInventory> {
    const generatedAt = new Date().toISOString();
    const state = await this.load();
    if (!state) {
      return emptyInventory(
        this.capability,
        'preview',
        generatedAt,
        'The preview mailbox has no persisted fixture state.',
      );
    }
    const serialized = JSON.stringify(state);
    const statistics = localReplicaStatistics(state);
    return {
      schemaVersion: 1,
      generatedAt,
      capability: this.capability,
      scope: 'preview',
      indexedAt: generatedAt,
      accounts: statistics.accounts,
      counts: statistics.counts,
      classes: [
        {
          class: 'raw-mail',
          measurement: 'logical',
          itemCount: 1,
          bytes: new TextEncoder().encode(serialized).byteLength,
          note: 'Preview localStorage fixture; not private profile storage.',
        },
        {
          class: 'search-metadata',
          measurement: 'logical',
          itemCount: Object.values(statistics.counts).reduce((sum, count) => sum + count, 0),
          bytes: statistics.logicalBytes,
          note: 'Calculated from the preview fixture; no SQLite replica is opened.',
        },
        ...(['semantic-vector', 'attachment', 'remote-image', 'audit'] as const)
          .map(dataClass => ({
            class: dataClass,
            measurement: 'unavailable' as const,
            itemCount: null,
            bytes: null,
            note: 'This storage class is not persisted by the preview fixture.',
          })),
      ],
      quota: {
        usedBytes: new TextEncoder().encode(serialized).byteLength,
        quotaBytes: null,
        hostLimitBytes: null,
        effectiveBytes: null,
      },
      warnings: ['Preview storage is not representative of private profile retention.'],
    };
  }

  async wipeAccount(accountId: string): Promise<LocalDataWipeReceipt> {
    if (!isSafeMailIdentifier(accountId)) {
      throw new Error('Local account wipe requires a valid TAP account ID.');
    }
    const completedAt = new Date().toISOString();
    const state = await this.load();
    if (state) await this.save(mailStateWithoutAccount(state, accountId));
    return incompleteWipeReceipt(
      'account',
      accountId,
      completedAt,
      'Preview wipe changed only persisted fixture state; a mounted preview may still hold an in-memory copy.',
    );
  }

  async wipeDevice(): Promise<LocalDataWipeReceipt> {
    globalThis.localStorage?.removeItem(previewKey);
    globalThis.localStorage?.removeItem(previewMailboxPageProgressKey);
    return incompleteWipeReceipt(
      'device',
      null,
      new Date().toISOString(),
      'Preview wipe removed only persisted fixture state; a mounted preview may still hold an in-memory copy.',
    );
  }

  async close(): Promise<void> {}
}

interface ProfileConnection {
  readonly storage: MiniAppPrivateStorageHandle;
  readonly database: MiniAppPrivateSqlDatabase;
}

export class ProfileSqliteMailStore implements LocalMailStore {
  readonly capability = 'private-profile-sqlite' as const;
  private connection: Promise<ProfileConnection> | null = null;
  private pendingWrite: Promise<void> = Promise.resolve();

  constructor(
    private readonly profileStorage: MiniAppPrivateStorageApi,
    private readonly now: () => number = Date.now,
    private readonly maximumRemoteImageCacheBytes = defaultRemoteImageCacheBytes,
    private readonly maximumAttachmentCacheBytes = defaultAttachmentCacheBytes,
  ) {}

  private async connect(): Promise<ProfileConnection> {
    const attempt = this.connection ??= (async () => {
      let storage: MiniAppPrivateStorageHandle | null = null;
      let database: MiniAppPrivateSqlDatabase | null = null;
      try {
        storage = await this.profileStorage.open({
          filesRead: true,
          filesWrite: true,
          sqlite: true,
          zvec: false,
        });
        database = await storage.sqlite.open(databaseName);
        await database.migrate([
          mailboxMigration,
          remoteImageMigration,
          attachmentMigration,
          attachmentStorageTokenMigration,
          ...localReplicaMigrations,
        ]);
        for (const directory of [remoteImageDirectory, attachmentDirectory]) {
          try {
            await storage.files.createDirectory(directory);
          } catch (error) {
            const metadata = await Promise.resolve(
              storage.files.metadata(directory),
            ).catch(() => null);
            if (metadata?.kind !== 'directory') throw error;
          }
        }
      } catch (error) {
        await Promise.resolve(database?.close()).catch(() => undefined);
        await Promise.resolve(storage?.close()).catch(() => undefined);
        throw error;
      }

      // Cache cleanup is housekeeping, not a prerequisite for reading mail.
      // A transient file-list or delete failure must not take down the mailbox.
      try {
        if (await this.evictAttachments(database, storage, this.now())) {
          await database.checkpoint();
        }
      } catch {
        // The next open or cache write retries bounded cleanup.
      }
      return { storage, database };
    })();
    try {
      return await attempt;
    } catch (error) {
      if (this.connection === attempt) this.connection = null;
      throw error;
    }
  }

  private async readStoredMailbox(
    database: MiniAppPrivateSqlDatabase,
  ): Promise<StoredMailboxState | null> {
    const result = await database.query(
      'SELECT state_json, updated_at FROM mailbox_state WHERE id = ?',
      [1],
    );
    return parseStoredMailboxState(result.columns, result.rows[0]);
  }

  private async normalizedSourceUpdatedAt(
    database: MiniAppPrivateSqlDatabase,
  ): Promise<string | null> {
    const result = await database.query(
      `SELECT source_updated_at
         FROM local_mail_replica_metadata
        WHERE id = ?`,
      [1],
    );
    const value = valueAt(
      result.columns,
      result.rows[0] ?? [],
      'source_updated_at',
    );
    return typeof value === 'string' ? value : null;
  }

  private async normalizedIndexedAt(
    database: MiniAppPrivateSqlDatabase,
  ): Promise<string | null> {
    const result = await database.query(
      `SELECT indexed_at
         FROM local_mail_replica_metadata
        WHERE id = ?`,
      [1],
    );
    const value = valueAt(result.columns, result.rows[0] ?? [], 'indexed_at');
    return typeof value === 'string' && Number.isFinite(Date.parse(value))
      ? new Date(Date.parse(value)).toISOString()
      : null;
  }

  private async writeStoredMailbox(
    transaction: MiniAppPrivateSqlTransaction,
    state: MailState,
    updatedAt: string,
  ): Promise<void> {
    const serialized = JSON.stringify(state);
    await transaction.execute(
      `INSERT INTO mailbox_state (id, schema_version, state_json, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         schema_version = excluded.schema_version,
         state_json = excluded.state_json,
         updated_at = excluded.updated_at`,
      [1, state.schemaVersion, serialized, updatedAt],
    );
    await replaceNormalizedLocalReplica(
      transaction,
      state,
      updatedAt,
      updatedAt,
    );
  }

  async load(): Promise<MailState | null> {
    const task = this.pendingWrite
      .catch(() => undefined)
      .then(async () => {
        const { database } = await this.connect();
        const stored = await this.readStoredMailbox(database);
        if (!stored) return null;
        if (await this.normalizedSourceUpdatedAt(database) !== stored.updatedAt) {
          await database.transaction(transaction => replaceNormalizedLocalReplica(
            transaction,
            stored.state,
            stored.updatedAt,
            new Date(this.now()).toISOString(),
          ));
          await database.checkpoint();
        }
        return stored.state;
      });
    this.pendingWrite = task.then(() => undefined, () => undefined);
    return task;
  }

  save(state: MailState): Promise<void> {
    this.pendingWrite = this.pendingWrite
      .catch(() => undefined)
      .then(async () => {
        const { database } = await this.connect();
        const updatedAt = new Date(this.now()).toISOString();
        await database.transaction(transaction =>
          this.writeStoredMailbox(transaction, state, updatedAt));
        await database.checkpoint();
      });
    return this.pendingWrite;
  }

  async loadMailboxPageProgress(): Promise<MailboxPageProgress | null> {
    await this.pendingWrite.catch(() => undefined);
    const { database } = await this.connect();
    const result = await database.query(
      `SELECT next_cursor, pages_loaded, threads_loaded, updated_at
         FROM local_mail_page_progress WHERE id = ?`,
      [1],
    );
    if (!result.rows[0]) return null;
    return mailboxPageProgress({
      nextCursor: valueAt(result.columns, result.rows[0], 'next_cursor'),
      pagesLoaded: valueAt(result.columns, result.rows[0], 'pages_loaded'),
      threadsLoaded: valueAt(result.columns, result.rows[0], 'threads_loaded'),
      updatedAt: valueAt(result.columns, result.rows[0], 'updated_at'),
    });
  }

  saveMailboxPageProgress(progress: MailboxPageProgress): Promise<void> {
    const valid = mailboxPageProgress(progress);
    if (!valid) return Promise.reject(new Error('Mailbox page progress is malformed.'));
    this.pendingWrite = this.pendingWrite.catch(() => undefined).then(async () => {
      const { database } = await this.connect();
      await database.execute(
        `INSERT INTO local_mail_page_progress
           (id, next_cursor, pages_loaded, threads_loaded, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           next_cursor = excluded.next_cursor,
           pages_loaded = excluded.pages_loaded,
           threads_loaded = excluded.threads_loaded,
           updated_at = excluded.updated_at`,
        [1, valid.nextCursor, valid.pagesLoaded, valid.threadsLoaded, valid.updatedAt],
      );
      await database.checkpoint();
    });
    return this.pendingWrite;
  }

  clearMailboxPageProgress(): Promise<void> {
    this.pendingWrite = this.pendingWrite.catch(() => undefined).then(async () => {
      const { database } = await this.connect();
      await database.execute('DELETE FROM local_mail_page_progress WHERE id = ?', [1]);
      await database.checkpoint();
    });
    return this.pendingWrite;
  }

  async loadRemoteImages(
    urls: readonly string[],
  ): Promise<Readonly<Record<string, string>>> {
    const uniqueUrls = [...new Set(urls)];
    if (uniqueUrls.length === 0) return {};
    const keyedUrls = await Promise.all(
      uniqueUrls.map(async sourceUrl => ({
        cacheKey: await remoteImageCacheKey(sourceUrl),
        sourceUrl,
      })),
    );
    const requestedByKey = new Map(
      keyedUrls.map(item => [item.cacheKey, item.sourceUrl] as const),
    );
    const { database, storage } = await this.connect();
    const placeholders = keyedUrls.map(() => '?').join(', ');
    const result = await database.query(
      `SELECT cache_key, source_url, media_type, size_bytes, expires_at, last_accessed_at
       FROM remote_image_cache
       WHERE cache_key IN (${placeholders})`,
      keyedUrls.map(item => item.cacheKey),
    );
    const loaded: Record<string, string> = {};
    const staleKeys: string[] = [];
    const touchedKeys: string[] = [];
    const observedAt = this.now();
    for (const resultRow of result.rows) {
      const row = cachedRemoteImageRow(result.columns, resultRow);
      if (!row) continue;
      const requestedUrl = requestedByKey.get(row.cacheKey);
      // The URL check is deliberately independent from the hash. Even though a
      // SHA-256 collision is vanishingly unlikely, a cache hit never crosses
      // source identities.
      if (!requestedUrl || requestedUrl !== row.sourceUrl) continue;
      if (row.expiresAt <= observedAt) {
        staleKeys.push(row.cacheKey);
        continue;
      }
      try {
        const bytes = await storage.files.read(remoteImagePath(row.cacheKey));
        if (bytes.byteLength !== row.sizeBytes || bytes.byteLength === 0) {
          staleKeys.push(row.cacheKey);
          continue;
        }
        loaded[row.sourceUrl] = encodeCachedImage(row.mediaType, bytes);
        touchedKeys.push(row.cacheKey);
      } catch {
        staleKeys.push(row.cacheKey);
      }
    }
    if (staleKeys.length > 0 || touchedKeys.length > 0) {
      this.enqueueCacheMaintenance(staleKeys, touchedKeys, observedAt);
    }
    return loaded;
  }

  saveRemoteImages(images: Readonly<Record<string, string>>): Promise<void> {
    const entries = Object.entries(images);
    if (entries.length === 0) return Promise.resolve();
    this.pendingWrite = this.pendingWrite
      .catch(() => undefined)
      .then(async () => {
        const prepared = (await Promise.all(entries.map(async ([sourceUrl, dataUrl]) => {
          const decoded = decodeCachedImage(dataUrl);
          if (!decoded) return null;
          return {
            sourceUrl,
            cacheKey: await remoteImageCacheKey(sourceUrl),
            mediaType: decoded.mediaType,
            bytes: decoded.bytes,
          };
        }))).filter(item => item !== null);
        if (prepared.length === 0) return;
        const { database, storage } = await this.connect();
        const observedAt = this.now();
        const expiresAt = observedAt + remoteImageCacheTtlMs;
        for (const image of prepared) {
          await storage.files.write(remoteImagePath(image.cacheKey), image.bytes);
        }
        await database.transaction(async transaction => {
          for (const image of prepared) {
            await transaction.execute(
              `INSERT INTO remote_image_cache (
                 cache_key, source_url, media_type, size_bytes, expires_at, last_accessed_at
               ) VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(cache_key) DO UPDATE SET
                 source_url = excluded.source_url,
                 media_type = excluded.media_type,
                 size_bytes = excluded.size_bytes,
                 expires_at = excluded.expires_at,
                 last_accessed_at = excluded.last_accessed_at`,
              [
                image.cacheKey,
                image.sourceUrl,
                image.mediaType,
                image.bytes.byteLength,
                expiresAt,
                observedAt,
              ],
            );
          }
        });
        await this.evictRemoteImages(database, storage, observedAt);
        await database.checkpoint();
      });
    return this.pendingWrite;
  }

  async loadAttachment(
    identity: AttachmentCacheIdentity,
  ): Promise<Uint8Array | null> {
    const requestedIdentity = { ...identity };
    const task = this.pendingWrite
      .catch(() => undefined)
      .then(async () => {
        const cacheKey = await attachmentCacheKey(requestedIdentity);
        const { database, storage } = await this.connect();
        const result = await database.query(
          `SELECT cache_key, account_id, thread_id, message_id, resource_id,
                  size_bytes, content_hash, storage_token, expires_at, last_accessed_at
           FROM attachment_cache
           WHERE cache_key = ?`,
          [cacheKey],
        );
        const rawRow = result.rows[0];
        if (!rawRow) return null;
        const row = cachedAttachmentRow(result.columns, rawRow);
        const rawContentHash = valueAt(result.columns, rawRow, 'content_hash');
        const rawStorageToken = valueAt(result.columns, rawRow, 'storage_token');
        if (!row || !sameAttachmentIdentity(row, requestedIdentity)) {
          await this.removeAttachmentEntry(
            database,
            storage,
            cacheKey,
            typeof rawContentHash === 'string' ? rawContentHash : null,
            typeof rawStorageToken === 'string' ? rawStorageToken : null,
          );
          await database.checkpoint();
          return null;
        }
        const observedAt = this.now();
        if (row.expiresAt <= observedAt) {
          await this.removeAttachmentEntry(
            database,
            storage,
            cacheKey,
            row.contentHash,
            row.storageToken,
          );
          await database.checkpoint();
          return null;
        }
        let bytes: Uint8Array;
        try {
          bytes = await storage.files.read(
            attachmentPath(cacheKey, row.contentHash, row.storageToken),
          );
        } catch {
          await this.removeAttachmentEntry(
            database,
            storage,
            cacheKey,
            row.contentHash,
            row.storageToken,
          );
          await database.checkpoint();
          return null;
        }
        if (
          bytes.byteLength !== row.sizeBytes ||
          await attachmentContentHash(bytes) !== row.contentHash
        ) {
          await this.removeAttachmentEntry(
            database,
            storage,
            cacheKey,
            row.contentHash,
            row.storageToken,
          );
          await database.checkpoint();
          return null;
        }
        await database.execute(
          `UPDATE attachment_cache
              SET last_accessed_at = MAX(last_accessed_at, ?)
            WHERE cache_key = ? AND content_hash = ? AND storage_token IS ?`,
          [observedAt, cacheKey, row.contentHash, row.storageToken],
        );
        await database.checkpoint();
        return bytes;
      });
    this.pendingWrite = task.then(() => undefined, () => undefined);
    return task;
  }

  saveAttachment(
    identity: AttachmentCacheIdentity,
    bytes: Uint8Array,
  ): Promise<void> {
    if (!validAttachmentIdentity(identity) || bytes.byteLength !== identity.sizeBytes) {
      return Promise.reject(new Error('Attachment bytes do not match their cache identity.'));
    }
    const storedIdentity = { ...identity };
    const storedBytes = bytes.slice();
    const task = this.pendingWrite
      .catch(() => undefined)
      .then(async () => {
        const cacheKey = await attachmentCacheKey(storedIdentity);
        const contentHash = await attachmentContentHash(storedBytes);
        const { database, storage } = await this.connect();
        const observedAt = this.now();
        const storageToken = attachmentStorageToken(observedAt);
        const previous = await database.query(
          'SELECT content_hash, storage_token FROM attachment_cache WHERE cache_key = ?',
          [cacheKey],
        );
        const previousContentHash = valueAt(
          previous.columns,
          previous.rows[0] ?? [],
          'content_hash',
        );
        const previousHash = typeof previousContentHash === 'string' &&
            cacheKeyPattern.test(previousContentHash)
          ? previousContentHash
          : null;
        const previousStorageToken = valueAt(
          previous.columns,
          previous.rows[0] ?? [],
          'storage_token',
        );
        const previousToken = previousStorageToken === null || (
          typeof previousStorageToken === 'string' &&
          attachmentStorageTokenPattern.test(previousStorageToken)
        ) ? previousStorageToken : undefined;
        const nextPath = attachmentPath(cacheKey, contentHash, storageToken);
        await storage.files.write(nextPath, storedBytes);
        try {
          await database.transaction(async transaction => {
            await transaction.execute(
              `INSERT INTO attachment_cache (
                 cache_key, account_id, thread_id, message_id, resource_id,
                 size_bytes, content_hash, storage_token, expires_at, last_accessed_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(cache_key) DO UPDATE SET
                 account_id = excluded.account_id,
                 thread_id = excluded.thread_id,
                 message_id = excluded.message_id,
                 resource_id = excluded.resource_id,
                 size_bytes = excluded.size_bytes,
                 content_hash = excluded.content_hash,
                 storage_token = excluded.storage_token,
                 expires_at = excluded.expires_at,
                 last_accessed_at = excluded.last_accessed_at`,
              [
                cacheKey,
                storedIdentity.accountId,
                storedIdentity.threadId,
                storedIdentity.messageId,
                storedIdentity.resourceId,
                storedBytes.byteLength,
                contentHash,
                storageToken,
                observedAt + attachmentCacheTtlMs,
                observedAt,
              ],
            );
          });
        } catch (error) {
          await Promise.resolve(storage.files.delete(nextPath)).catch(() => undefined);
          throw error;
        }
        if (previousHash && previousToken !== undefined) {
          await Promise.resolve(
            storage.files.delete(attachmentPath(cacheKey, previousHash, previousToken)),
          ).catch(() => undefined);
        }
        await this.evictAttachments(database, storage, observedAt).catch(() => false);
        await database.checkpoint();
      });
    this.pendingWrite = task.then(() => undefined, () => undefined);
    return task;
  }

  private enqueueCacheMaintenance(
    staleKeys: readonly string[],
    touchedKeys: readonly string[],
    observedAt: number,
  ): void {
    this.pendingWrite = this.pendingWrite
      .catch(() => undefined)
      .then(async () => {
        const { database, storage } = await this.connect();
        for (const cacheKey of staleKeys) {
          await Promise.resolve(
            storage.files.delete(remoteImagePath(cacheKey)),
          ).catch(() => undefined);
        }
        await database.transaction(async transaction => {
          for (const cacheKey of staleKeys) {
            await transaction.execute(
              'DELETE FROM remote_image_cache WHERE cache_key = ?',
              [cacheKey],
            );
          }
          for (const cacheKey of touchedKeys) {
            await transaction.execute(
              'UPDATE remote_image_cache SET last_accessed_at = ? WHERE cache_key = ?',
              [observedAt, cacheKey],
            );
          }
        });
        await database.checkpoint();
      });
    void this.pendingWrite.catch(() => undefined);
  }

  private async removeAttachmentEntry(
    database: MiniAppPrivateSqlDatabase,
    storage: MiniAppPrivateStorageHandle,
    cacheKey: string,
    contentHash: string | null,
    storageToken: string | null,
  ): Promise<void> {
    const removed = await database.execute(
      `DELETE FROM attachment_cache
        WHERE cache_key = ? AND content_hash IS ? AND storage_token IS ?`,
      [cacheKey, contentHash, storageToken],
    );
    if (
      removed.rowsAffected > 0 &&
      contentHash !== null &&
      cacheKeyPattern.test(contentHash) &&
      (storageToken === null || attachmentStorageTokenPattern.test(storageToken))
    ) {
      await Promise.resolve(
        storage.files.delete(attachmentPath(cacheKey, contentHash, storageToken)),
      ).catch(() => undefined);
    }
  }

  private async evictRemoteImages(
    database: MiniAppPrivateSqlDatabase,
    storage: MiniAppPrivateStorageHandle,
    observedAt: number,
  ): Promise<void> {
    const result = await database.query(
      `SELECT cache_key, source_url, media_type, size_bytes, expires_at, last_accessed_at
       FROM remote_image_cache
       ORDER BY last_accessed_at ASC, cache_key ASC`,
    );
    const rows = result.rows
      .map(row => cachedRemoteImageRow(result.columns, row))
      .filter(row => row !== null);
    let retainedBytes = rows.reduce(
      (total, row) => row.expiresAt > observedAt ? total + row.sizeBytes : total,
      0,
    );
    const evictedKeys: string[] = [];
    for (const row of rows) {
      if (row.expiresAt <= observedAt) {
        evictedKeys.push(row.cacheKey);
      } else if (retainedBytes > this.maximumRemoteImageCacheBytes) {
        evictedKeys.push(row.cacheKey);
        retainedBytes -= row.sizeBytes;
      }
    }
    if (evictedKeys.length === 0) return;
    for (const cacheKey of evictedKeys) {
      await Promise.resolve(
        storage.files.delete(remoteImagePath(cacheKey)),
      ).catch(() => undefined);
    }
    await database.transaction(async transaction => {
      for (const cacheKey of evictedKeys) {
        await transaction.execute(
          'DELETE FROM remote_image_cache WHERE cache_key = ?',
          [cacheKey],
        );
      }
    });
  }

  private async evictAttachments(
    database: MiniAppPrivateSqlDatabase,
    storage: MiniAppPrivateStorageHandle,
    observedAt: number,
  ): Promise<boolean> {
    const result = await database.query(
      `SELECT cache_key, account_id, thread_id, message_id, resource_id,
              size_bytes, content_hash, storage_token, expires_at, last_accessed_at
       FROM attachment_cache
       ORDER BY last_accessed_at ASC, cache_key ASC`,
    );
    const rows: CachedAttachmentRow[] = [];
    const invalidRows: Array<{
      readonly cacheKey: string;
      readonly contentHash: string | null;
      readonly storageToken: string | null;
    }> = [];
    for (const rawRow of result.rows) {
      const row = cachedAttachmentRow(result.columns, rawRow);
      if (row) {
        rows.push(row);
        continue;
      }
      const rawCacheKey = valueAt(result.columns, rawRow, 'cache_key');
      if (typeof rawCacheKey === 'string') {
        const rawContentHash = valueAt(result.columns, rawRow, 'content_hash');
        const rawStorageToken = valueAt(result.columns, rawRow, 'storage_token');
        invalidRows.push({
          cacheKey: rawCacheKey,
          contentHash: typeof rawContentHash === 'string' ? rawContentHash : null,
          storageToken: typeof rawStorageToken === 'string' ? rawStorageToken : null,
        });
      }
    }
    let retainedBytes = rows.reduce(
      (total, row) => row.expiresAt > observedAt ? total + row.sizeBytes : total,
      0,
    );
    const evictedRows: CachedAttachmentRow[] = [];
    for (const row of rows) {
      if (row.expiresAt <= observedAt) {
        evictedRows.push(row);
      } else if (retainedBytes > this.maximumAttachmentCacheBytes) {
        evictedRows.push(row);
        retainedBytes -= row.sizeBytes;
      }
    }
    const removedPaths: string[] = [];
    let removedRow = false;
    if (invalidRows.length > 0 || evictedRows.length > 0) {
      await database.transaction(async transaction => {
        for (const row of invalidRows) {
          const result = await transaction.execute(
            `DELETE FROM attachment_cache
              WHERE cache_key = ? AND content_hash IS ? AND storage_token IS ?`,
            [row.cacheKey, row.contentHash, row.storageToken],
          );
          removedRow ||= result.rowsAffected > 0;
          if (
            result.rowsAffected > 0 &&
            cacheKeyPattern.test(row.cacheKey) &&
            row.contentHash !== null &&
            cacheKeyPattern.test(row.contentHash) &&
            (row.storageToken === null || attachmentStorageTokenPattern.test(row.storageToken))
          ) {
            removedPaths.push(attachmentPath(
              row.cacheKey,
              row.contentHash,
              row.storageToken,
            ));
          }
        }
        for (const row of evictedRows) {
          const result = await transaction.execute(
            `DELETE FROM attachment_cache
              WHERE cache_key = ? AND content_hash = ? AND storage_token IS ?
                AND expires_at = ? AND last_accessed_at = ?`,
            [
              row.cacheKey,
              row.contentHash,
              row.storageToken,
              row.expiresAt,
              row.lastAccessedAt,
            ],
          );
          removedRow ||= result.rowsAffected > 0;
          if (result.rowsAffected > 0) {
            removedPaths.push(attachmentPath(
              row.cacheKey,
              row.contentHash,
              row.storageToken,
            ));
          }
        }
      });
    }
    for (const path of removedPaths) {
      await Promise.resolve(storage.files.delete(path)).catch(() => undefined);
    }

    const retainedPaths = new Set(
      rows
        .map(row => attachmentPath(row.cacheKey, row.contentHash, row.storageToken)),
    );
    const listed = await storage.files.list(attachmentDirectory);
    let removedFile = false;
    for (const entry of listed.entries) {
      if (entry.kind !== 'file') continue;
      const path = `${attachmentDirectory}/${entry.name}`;
      if (retainedPaths.has(path)) continue;
      const candidate = attachmentFilePattern.exec(entry.name);
      const createdAt = candidate ? Number(candidate[3]!.split('-', 1)[0]) : Number.NaN;
      // New writes use a unique, timestamped storage token. A grace window
      // protects files another app instance has written but not committed yet.
      // Legacy unversioned paths are never swept without a matching DB row.
      if (!Number.isSafeInteger(createdAt) || createdAt > observedAt - attachmentOrphanGraceMs) {
        continue;
      }
      await Promise.resolve(storage.files.delete(path)).catch(() => undefined);
      removedFile = true;
    }
    return removedRow || removedFile;
  }

  async inspectStorage(): Promise<LocalStorageInventory> {
    const task = this.pendingWrite
      .catch(() => undefined)
      .then(async () => {
        const { database, storage } = await this.connect();
        const stored = await this.readStoredMailbox(database);
        if (
          stored &&
          await this.normalizedSourceUpdatedAt(database) !== stored.updatedAt
        ) {
          await database.transaction(transaction => replaceNormalizedLocalReplica(
            transaction,
            stored.state,
            stored.updatedAt,
            new Date(this.now()).toISOString(),
          ));
          await database.checkpoint();
        }
        const [remoteImageFiles, attachmentFiles, usage] = await Promise.all([
          privateDirectoryUsage(storage, remoteImageDirectory),
          privateDirectoryUsage(storage, attachmentDirectory),
          Promise.resolve(storage.usage()).catch(() => null),
        ]);
        const statistics = stored
          ? localReplicaStatistics(stored.state)
          : { counts: zeroEntityCounts, logicalBytes: 0, accounts: [] };
        const indexedAt = await this.normalizedIndexedAt(database);
        const rawBytes = stored
          ? new TextEncoder().encode(stored.serialized).byteLength
          : 0;
        const warnings = [
          'Private profile storage is shared across workspaces for this package; workspace-level byte attribution is unavailable.',
          'The SDK reports physical bytes only for the whole private scope, so raw-mail and search-metadata bytes are logical UTF-8 measurements.',
          'Semantic-vector and audit storage are owned by separate local components and are not measurable through the mailbox store.',
        ];
        if (statistics.accounts.some(account =>
          account.state !== 'current' ||
          account.indexedThrough === null ||
          account.unresolvedFailures > 0)) {
          warnings.push('One or more account replicas have partial or failed coverage.');
        }
        if (!usage) {
          warnings.push('The host did not return private-scope usage totals.');
        }
        if (!attachmentFiles) {
          warnings.push('The attachment directory could not be inventoried.');
        }
        if (!remoteImageFiles) {
          warnings.push('The remote-image directory could not be inventoried.');
        }
        const derivedItemCount = Object.values(statistics.counts)
          .reduce((sum, count) => sum + count, 0);
        return {
          schemaVersion: 1,
          generatedAt: new Date(this.now()).toISOString(),
          capability: this.capability,
          scope: 'private-profile',
          indexedAt,
          accounts: statistics.accounts,
          counts: statistics.counts,
          classes: [
            {
              class: 'raw-mail',
              measurement: 'logical',
              itemCount: stored ? 1 : 0,
              bytes: rawBytes,
              note: 'Serialized compatibility snapshot; provider coverage is reported per account.',
            },
            {
              class: 'search-metadata',
              measurement: 'logical',
              itemCount: derivedItemCount,
              bytes: statistics.logicalBytes,
              note: 'Normalized account/thread/message/resource/label/attachment metadata; message bodies are excluded.',
            },
            {
              class: 'semantic-vector',
              measurement: 'unavailable',
              itemCount: null,
              bytes: null,
              note: 'The SDK has no profile-wide zvec collection enumeration or per-collection byte API.',
            },
            {
              class: 'attachment',
              measurement: attachmentFiles ? 'physical' : 'unavailable',
              itemCount: attachmentFiles?.itemCount ?? null,
              bytes: attachmentFiles?.storedBytes ?? null,
              note: attachmentFiles
                ? 'Physical files charged to quota, including any recoverable orphan awaiting cleanup.'
                : 'The host did not return a readable attachment-directory inventory.',
            },
            {
              class: 'remote-image',
              measurement: remoteImageFiles ? 'physical' : 'unavailable',
              itemCount: remoteImageFiles?.itemCount ?? null,
              bytes: remoteImageFiles?.storedBytes ?? null,
              note: remoteImageFiles
                ? 'Physical privacy-proxied files charged to quota, including any recoverable orphan awaiting cleanup.'
                : 'The host did not return a readable remote-image-directory inventory.',
            },
            {
              class: 'audit',
              measurement: 'unavailable',
              itemCount: null,
              bytes: null,
              note: 'The committed-action ledger uses a separate private SQLite database.',
            },
          ],
          quota: {
            usedBytes: usage?.usedBytes ?? null,
            quotaBytes: usage?.quotaBytes ?? null,
            hostLimitBytes: usage?.hostLimitBytes ?? null,
            effectiveBytes: storage.quota.effectiveBytes,
          },
          warnings,
        } satisfies LocalStorageInventory;
      });
    this.pendingWrite = task.then(() => undefined, () => undefined);
    return task;
  }

  private async resetCacheDirectory(
    storage: MiniAppPrivateStorageHandle,
    directory: string,
  ): Promise<boolean> {
    try {
      await storage.files.delete(directory, { recursive: true });
      await storage.files.createDirectory(directory);
      return true;
    } catch {
      return false;
    }
  }

  wipeAccount(accountId: string): Promise<LocalDataWipeReceipt> {
    if (!isSafeMailIdentifier(accountId)) {
      return Promise.reject(
        new Error('Local account wipe requires a valid TAP account ID.'),
      );
    }
    const task = this.pendingWrite
      .catch(() => undefined)
      .then(async () => {
        const { database, storage } = await this.connect();
        const stored = await this.readStoredMailbox(database);
        const targetState = stored
          ? {
              ...stored.state,
              accounts: stored.state.accounts.filter(
                account => account.accountId === accountId,
              ),
              threads: stored.state.threads.filter(
                thread => thread.accountId === accountId,
              ),
            }
          : null;
        const removedStatistics = targetState
          ? localReplicaStatistics(targetState)
          : { counts: zeroEntityCounts };
        const attachmentResult = await database.query(
          `SELECT cache_key, account_id, thread_id, message_id, resource_id,
                  size_bytes, content_hash, storage_token, expires_at,
                  last_accessed_at
             FROM attachment_cache
            WHERE account_id = ?`,
          [accountId],
        );
        const attachments = attachmentResult.rows
          .map(row => cachedAttachmentRow(attachmentResult.columns, row))
          .filter(row => row !== null);
        const remoteImageResult = await database.query(
          `SELECT cache_key, source_url, media_type, size_bytes,
                  expires_at, last_accessed_at
             FROM remote_image_cache`,
        );
        const remoteImages = remoteImageResult.rows
          .map(row => cachedRemoteImageRow(remoteImageResult.columns, row))
          .filter(row => row !== null);

        let attachmentFilesRemoved = true;
        for (const row of attachments) {
          try {
            await storage.files.delete(attachmentPath(
              row.cacheKey,
              row.contentHash,
              row.storageToken,
            ));
          } catch {
            attachmentFilesRemoved = false;
          }
        }
        // Remote-image rows do not yet carry an account identity. A privacy
        // wipe therefore over-removes the whole image cache instead of risking
        // retention from the target account.
        const remoteImagesRemoved = await this.resetCacheDirectory(
          storage,
          remoteImageDirectory,
        );
        const updatedAt = new Date(this.now()).toISOString();
        await database.transaction(async transaction => {
          if (stored) {
            await this.writeStoredMailbox(
              transaction,
              mailStateWithoutAccount(stored.state, accountId),
              updatedAt,
            );
          } else {
            await deleteNormalizedLocalAccount(transaction, accountId);
          }
          await transaction.execute(
            'DELETE FROM attachment_cache WHERE account_id = ?',
            [accountId],
          );
          await transaction.execute('DELETE FROM remote_image_cache');
        });
        await database.checkpoint();

        const remainingClasses: LocalStorageClass[] = [
          'semantic-vector',
          'audit',
        ];
        if (!attachmentFilesRemoved) remainingClasses.push('attachment');
        if (!remoteImagesRemoved) remainingClasses.push('remote-image');
        const warnings = [
          'Semantic vectors and the committed-action ledger are separate local components and require their own account-scoped wipe receipts.',
          'A mounted surface may retain an in-memory copy until it applies the wipe receipt or reloads.',
          'Remote images are not account-attributed, so the entire persistent remote-image cache was cleared.',
        ];
        if (!attachmentFilesRemoved) {
          warnings.push('One or more target-account attachment files could not be deleted.');
        }
        if (!remoteImagesRemoved) {
          warnings.push('The persistent remote-image directory could not be fully reset.');
        }
        return {
          schemaVersion: 1,
          scope: 'account',
          accountId,
          completedAt: updatedAt,
          complete: false,
          removedClasses: [
            'raw-mail',
            'search-metadata',
            ...(attachmentFilesRemoved ? ['attachment' as const] : []),
            ...(remoteImagesRemoved ? ['remote-image' as const] : []),
          ],
          overRemovedClasses: remoteImages.length > 0 ? ['remote-image'] : [],
          remainingClasses,
          removed: {
            accounts: removedStatistics.counts.accounts,
            threads: removedStatistics.counts.threads,
            messages: removedStatistics.counts.messages,
            attachmentMetadata: removedStatistics.counts.attachmentMetadata,
            cachedAttachmentBytes: sumCacheBytes(attachments),
            cachedRemoteImageBytes: remoteImagesRemoved
              ? sumCacheBytes(remoteImages)
              : 0,
          },
          warnings,
        } satisfies LocalDataWipeReceipt;
      });
    this.pendingWrite = task.then(() => undefined, () => undefined);
    return task;
  }

  wipeDevice(): Promise<LocalDataWipeReceipt> {
    const task = this.pendingWrite
      .catch(() => undefined)
      .then(async () => {
        const { database, storage } = await this.connect();
        const stored = await this.readStoredMailbox(database);
        const removedStatistics = stored
          ? localReplicaStatistics(stored.state)
          : { counts: zeroEntityCounts };
        const [attachmentResult, remoteImageResult] = await Promise.all([
          database.query(
            `SELECT cache_key, account_id, thread_id, message_id, resource_id,
                    size_bytes, content_hash, storage_token, expires_at,
                    last_accessed_at
               FROM attachment_cache`,
          ),
          database.query(
            `SELECT cache_key, source_url, media_type, size_bytes,
                    expires_at, last_accessed_at
               FROM remote_image_cache`,
          ),
        ]);
        const attachments = attachmentResult.rows
          .map(row => cachedAttachmentRow(attachmentResult.columns, row))
          .filter(row => row !== null);
        const remoteImages = remoteImageResult.rows
          .map(row => cachedRemoteImageRow(remoteImageResult.columns, row))
          .filter(row => row !== null);
        const [attachmentFilesRemoved, remoteImagesRemoved] = await Promise.all([
          this.resetCacheDirectory(storage, attachmentDirectory),
          this.resetCacheDirectory(storage, remoteImageDirectory),
        ]);
        await database.transaction(async transaction => {
          await transaction.execute('DELETE FROM mailbox_state WHERE id = ?', [1]);
          await deleteNormalizedLocalReplica(transaction);
          await transaction.execute('DELETE FROM local_mail_page_progress WHERE id = ?', [1]);
          await transaction.execute('DELETE FROM attachment_cache');
          await transaction.execute('DELETE FROM remote_image_cache');
        });
        await database.checkpoint();
        const completedAt = new Date(this.now()).toISOString();
        const remainingClasses: LocalStorageClass[] = [
          'semantic-vector',
          'audit',
        ];
        if (!attachmentFilesRemoved) remainingClasses.push('attachment');
        if (!remoteImagesRemoved) remainingClasses.push('remote-image');
        const warnings = [
          'This mailbox-store primitive cannot enumerate or erase semantic zvec collections or the separate committed-action ledger.',
          'The caller must close/wipe those components and clear mounted in-memory state before presenting a complete device wipe receipt.',
        ];
        if (!attachmentFilesRemoved) {
          warnings.push('The persistent attachment directory could not be fully reset.');
        }
        if (!remoteImagesRemoved) {
          warnings.push('The persistent remote-image directory could not be fully reset.');
        }
        return {
          schemaVersion: 1,
          scope: 'device',
          accountId: null,
          completedAt,
          complete: false,
          removedClasses: [
            'raw-mail',
            'search-metadata',
            ...(attachmentFilesRemoved ? ['attachment' as const] : []),
            ...(remoteImagesRemoved ? ['remote-image' as const] : []),
          ],
          overRemovedClasses: [],
          remainingClasses,
          removed: {
            accounts: removedStatistics.counts.accounts,
            threads: removedStatistics.counts.threads,
            messages: removedStatistics.counts.messages,
            attachmentMetadata: removedStatistics.counts.attachmentMetadata,
            cachedAttachmentBytes: attachmentFilesRemoved
              ? sumCacheBytes(attachments)
              : 0,
            cachedRemoteImageBytes: remoteImagesRemoved
              ? sumCacheBytes(remoteImages)
              : 0,
          },
          warnings,
        } satisfies LocalDataWipeReceipt;
      });
    this.pendingWrite = task.then(() => undefined, () => undefined);
    return task;
  }

  async close(): Promise<void> {
    await this.pendingWrite.catch(() => undefined);
    if (!this.connection) return;
    const { database, storage } = await this.connection;
    await database.close();
    await storage.close();
    this.connection = null;
  }
}

export class UnavailableLocalProfileMailStore implements LocalMailStore {
  readonly capability = 'unavailable' as const;

  async load(): Promise<MailState | null> {
    return null;
  }

  async save(): Promise<void> {
    throw new Error(
      'TAP Email needs SDK private profile storage before it can persist mailbox content on this device.',
    );
  }

  async loadMailboxPageProgress(): Promise<MailboxPageProgress | null> {
    return null;
  }

  async saveMailboxPageProgress(): Promise<void> {}

  async clearMailboxPageProgress(): Promise<void> {}

  async loadRemoteImages(): Promise<Readonly<Record<string, string>>> {
    return {};
  }

  async saveRemoteImages(): Promise<void> {}

  async loadAttachment(): Promise<Uint8Array | null> {
    return null;
  }

  async saveAttachment(): Promise<void> {}

  async inspectStorage(): Promise<LocalStorageInventory> {
    return emptyInventory(
      this.capability,
      'unavailable',
      new Date().toISOString(),
      'Private profile storage is unavailable, so local retention cannot be inspected.',
    );
  }

  async wipeAccount(accountId: string): Promise<LocalDataWipeReceipt> {
    if (!isSafeMailIdentifier(accountId)) {
      throw new Error('Local account wipe requires a valid TAP account ID.');
    }
    return incompleteWipeReceipt(
      'account',
      accountId,
      new Date().toISOString(),
      'Private profile storage is unavailable, so the account wipe could not be verified.',
    );
  }

  async wipeDevice(): Promise<LocalDataWipeReceipt> {
    return incompleteWipeReceipt(
      'device',
      null,
      new Date().toISOString(),
      'Private profile storage is unavailable, so the device wipe could not be verified.',
    );
  }

  async close(): Promise<void> {}
}

export function createLocalMailStore(
  preview: boolean,
  profileStorage: MiniAppPrivateStorageApi | null | undefined = undefined,
): LocalMailStore {
  if (preview) return new PreviewFixtureMailStore();
  const availableProfile = profileStorage === null
    ? undefined
    : profileStorage ?? sdk.storage.profile;
  return availableProfile
    ? new ProfileSqliteMailStore(availableProfile)
    : new UnavailableLocalProfileMailStore();
}
