import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from '@rstest/core';
import type {
  MiniAppPrivateFilesApi,
  MiniAppPrivateSqlDatabase,
  MiniAppPrivateStorageAccess,
  MiniAppPrivateStorageApi,
  MiniAppPrivateStorageHandle,
  MiniAppSqlQueryResult,
  MiniAppSqlResult,
} from '@theaiplatform/miniapp-sdk/sdk';
import type { MailCommandReceipt } from '@tap-examples/tap-email-protocol';
import {
  composeMessage,
  correctThreadAttention,
  previewMailState,
  projectedThreads,
  settleMailCommand,
} from './domain';
import {
  attachmentCacheTtlMs,
  createLocalMailStore,
  ProfileSqliteMailStore,
  remoteImageCacheTtlMs,
  type AttachmentCacheIdentity,
} from './local-store';

interface CacheRow {
  cacheKey: string;
  sourceUrl: string;
  mediaType: string;
  sizeBytes: number;
  expiresAt: number;
  lastAccessedAt: number;
}

interface AttachmentRow extends AttachmentCacheIdentity {
  cacheKey: string;
  contentHash: string;
  storageToken: string | null;
  expiresAt: number;
  lastAccessedAt: number;
}

const pngDataUrl = 'data:image/png;base64,iVBORw0KGgo=';
const jpegDataUrl = 'data:image/jpeg;base64,/9j/';

function profileStorageFixture() {
  const replicaSqlite = new DatabaseSync(':memory:');
  const appliedMigrations = new Set<number>();
  let stateJson: string | null = null;
  let stateUpdatedAt: string | null = null;
  let normalizedSourceUpdatedAt: string | null = null;
  let normalizedIndexedAt: string | null = null;
  let pageProgress: readonly [string, number, number, string] | null = null;
  let checkpoints = 0;
  let databaseClosed = false;
  let storageClosed = false;
  let rejectNextAttachmentInsert = false;
  let rejectNextAttachmentList = false;
  let attachmentListGate: {
    readonly entered: Promise<void>;
    readonly release: () => void;
  } | null = null;
  let openAccess: MiniAppPrivateStorageAccess | undefined;
  const cacheRows = new Map<string, CacheRow>();
  const attachmentRows = new Map<string, AttachmentRow>();
  const fileData = new Map<string, Uint8Array>();
  const directories = new Set<string>();
  const normalizedStatements: Array<{
    readonly sql: string;
    readonly params: readonly unknown[];
  }> = [];
  let migratedVersions: readonly number[] = [];
  const result: MiniAppSqlResult = { rowsAffected: 1, lastInsertRowId: 1 };

  const execute = async (sql: string, params: readonly unknown[] = []) => {
    if (sql.includes('local_mail_')) replicaSqlite.prepare(sql).run(...params as (string | number | null)[]);
    if (sql.includes('INSERT INTO mailbox_state')) {
      stateJson = typeof params[2] === 'string' ? params[2] : null;
      stateUpdatedAt = typeof params[3] === 'string' ? params[3] : null;
    } else if (sql.includes('DELETE FROM mailbox_state')) {
      stateJson = null;
      stateUpdatedAt = null;
    } else if (sql.includes('INSERT INTO local_mail_page_progress')) {
      const [, nextCursor, pagesLoaded, threadsLoaded, updatedAt] = params;
      if (
        typeof nextCursor !== 'string' ||
        typeof pagesLoaded !== 'number' ||
        typeof threadsLoaded !== 'number' ||
        typeof updatedAt !== 'string'
      ) {
        throw new Error('invalid mailbox page progress fixture insert');
      }
      pageProgress = [nextCursor, pagesLoaded, threadsLoaded, updatedAt];
    } else if (sql.includes('DELETE FROM local_mail_page_progress')) {
      pageProgress = null;
    } else if (sql.includes('INSERT INTO local_mail_replica_metadata')) {
      normalizedSourceUpdatedAt = typeof params[1] === 'string' ? params[1] : null;
      normalizedIndexedAt = typeof params[2] === 'string' ? params[2] : null;
      normalizedStatements.push({ sql, params });
    } else if (sql.includes('DELETE FROM local_mail_replica_metadata')) {
      normalizedSourceUpdatedAt = null;
      normalizedIndexedAt = null;
      normalizedStatements.push({ sql, params });
    } else if (sql.includes('local_mail_')) {
      normalizedStatements.push({ sql, params });
    } else if (sql.includes('INSERT INTO remote_image_cache')) {
      const [cacheKey, sourceUrl, mediaType, sizeBytes, expiresAt, lastAccessedAt] = params;
      if (
        typeof cacheKey !== 'string' ||
        typeof sourceUrl !== 'string' ||
        typeof mediaType !== 'string' ||
        typeof sizeBytes !== 'number' ||
        typeof expiresAt !== 'number' ||
        typeof lastAccessedAt !== 'number'
      ) {
        throw new Error('invalid cache fixture insert');
      }
      cacheRows.set(cacheKey, {
        cacheKey,
        sourceUrl,
        mediaType,
        sizeBytes,
        expiresAt,
        lastAccessedAt,
      });
    } else if (sql.includes('DELETE FROM remote_image_cache')) {
      if (sql.includes('WHERE cache_key') && typeof params[0] === 'string') {
        cacheRows.delete(params[0]);
      } else {
        cacheRows.clear();
      }
    } else if (sql.includes('UPDATE remote_image_cache SET last_accessed_at')) {
      const [lastAccessedAt, cacheKey] = params;
      const row = typeof cacheKey === 'string' ? cacheRows.get(cacheKey) : undefined;
      if (typeof cacheKey === 'string' && row && typeof lastAccessedAt === 'number') {
        cacheRows.set(cacheKey, { ...row, lastAccessedAt });
      }
    } else if (sql.includes('INSERT INTO attachment_cache')) {
      if (rejectNextAttachmentInsert) {
        rejectNextAttachmentInsert = false;
        throw new Error('attachment insert failed');
      }
      const [
        cacheKey,
        accountId,
        threadId,
        messageId,
        resourceId,
        sizeBytes,
        contentHash,
        storageToken,
        expiresAt,
        lastAccessedAt,
      ] = params;
      if (
        typeof cacheKey !== 'string' ||
        typeof accountId !== 'string' ||
        typeof threadId !== 'string' ||
        typeof messageId !== 'string' ||
        typeof resourceId !== 'string' ||
        typeof sizeBytes !== 'number' ||
        typeof contentHash !== 'string' ||
        typeof storageToken !== 'string' ||
        typeof expiresAt !== 'number' ||
        typeof lastAccessedAt !== 'number'
      ) {
        throw new Error('invalid attachment fixture insert');
      }
      attachmentRows.set(cacheKey, {
        cacheKey,
        accountId,
        threadId,
        messageId,
        resourceId,
        sizeBytes,
        contentHash,
        storageToken,
        expiresAt,
        lastAccessedAt,
      });
    } else if (sql.includes('DELETE FROM attachment_cache')) {
      if (sql.includes('WHERE account_id =') && typeof params[0] === 'string') {
        for (const [cacheKey, row] of attachmentRows) {
          if (row.accountId === params[0]) attachmentRows.delete(cacheKey);
        }
        return result;
      }
      if (!sql.includes('WHERE')) {
        attachmentRows.clear();
        return result;
      }
      const [cacheKey, contentHash, storageToken, expiresAt, lastAccessedAt] = params;
      const row = typeof cacheKey === 'string' ? attachmentRows.get(cacheKey) : undefined;
      const matchesSnapshot = Boolean(row) &&
        (!sql.includes('content_hash') || row?.contentHash === contentHash) &&
        (!sql.includes('storage_token') || row?.storageToken === storageToken) &&
        (!sql.includes('expires_at =') || row?.expiresAt === expiresAt) &&
        (!sql.includes('last_accessed_at =') || row?.lastAccessedAt === lastAccessedAt);
      if (!matchesSnapshot || typeof cacheKey !== 'string') {
        return { rowsAffected: 0, lastInsertRowId: 0 };
      }
      attachmentRows.delete(cacheKey);
    } else if (sql.includes('UPDATE attachment_cache') && sql.includes('last_accessed_at')) {
      const [lastAccessedAt, cacheKey, contentHash, storageToken] = params;
      const row = typeof cacheKey === 'string' ? attachmentRows.get(cacheKey) : undefined;
      if (
        typeof cacheKey === 'string' &&
        row &&
        typeof lastAccessedAt === 'number' &&
        (contentHash === undefined || row.contentHash === contentHash) &&
        (storageToken === undefined || row.storageToken === storageToken)
      ) {
        attachmentRows.set(cacheKey, { ...row, lastAccessedAt });
      }
    }
    return result;
  };

  const query = async (
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<MiniAppSqlQueryResult> => {
    if (sql.includes('local_mail_')) {
      const statement = replicaSqlite.prepare(sql);
      const columns = statement.columns().map(column => column.name);
      const rows = statement.all(...params as (string | number | null)[]).map(row => columns.map(column => row[column] as string | number | null));
      return { columns, rows };
    }
    if (sql.includes('FROM mailbox_state')) {
      return {
        columns: ['state_json', 'updated_at'],
        rows: stateJson === null ? [] : [[stateJson, stateUpdatedAt]],
      };
    }
    if (sql.includes('FROM local_mail_page_progress')) {
      return {
        columns: ['next_cursor', 'pages_loaded', 'threads_loaded', 'updated_at'],
        rows: pageProgress === null ? [] : [[...pageProgress]],
      };
    }
    if (sql.includes('FROM local_mail_replica_metadata')) {
      if (sql.includes('source_updated_at')) {
        return {
          columns: ['source_updated_at'],
          rows: normalizedSourceUpdatedAt === null
            ? []
            : [[normalizedSourceUpdatedAt]],
        };
      }
      return {
        columns: ['indexed_at'],
        rows: normalizedIndexedAt === null ? [] : [[normalizedIndexedAt]],
      };
    }
    if (sql.includes('FROM remote_image_cache')) {
      let rows = [...cacheRows.values()];
      if (sql.includes('WHERE cache_key IN')) {
        const requested = new Set(params.filter(value => typeof value === 'string'));
        rows = rows.filter(row => requested.has(row.cacheKey));
      }
      if (sql.includes('ORDER BY last_accessed_at')) {
        rows.sort((left, right) =>
          left.lastAccessedAt - right.lastAccessedAt ||
          left.cacheKey.localeCompare(right.cacheKey));
      }
      return {
        columns: [
          'cache_key',
          'source_url',
          'media_type',
          'size_bytes',
          'expires_at',
          'last_accessed_at',
        ],
        rows: rows.map(row => [
          row.cacheKey,
          row.sourceUrl,
          row.mediaType,
          row.sizeBytes,
          row.expiresAt,
          row.lastAccessedAt,
        ]),
      };
    }
    if (sql.includes('FROM attachment_cache')) {
      let rows = [...attachmentRows.values()];
      if (sql.includes('WHERE cache_key =')) {
        rows = rows.filter(row => row.cacheKey === params[0]);
      } else if (sql.includes('WHERE account_id =')) {
        rows = rows.filter(row => row.accountId === params[0]);
      }
      if (sql.includes('ORDER BY last_accessed_at')) {
        rows.sort((left, right) =>
          left.lastAccessedAt - right.lastAccessedAt ||
          left.cacheKey.localeCompare(right.cacheKey));
      }
      return {
        columns: [
          'cache_key',
          'account_id',
          'thread_id',
          'message_id',
          'resource_id',
          'size_bytes',
          'content_hash',
          'storage_token',
          'expires_at',
          'last_accessed_at',
        ],
        rows: rows.map(row => [
          row.cacheKey,
          row.accountId,
          row.threadId,
          row.messageId,
          row.resourceId,
          row.sizeBytes,
          row.contentHash,
          row.storageToken,
          row.expiresAt,
          row.lastAccessedAt,
        ]),
      };
    }
    return { columns: [], rows: [] };
  };

  const transaction = { execute, query };
  const database = {
    ...transaction,
    close: async () => { databaseClosed = true; },
    transaction: async <T>(callback: (value: typeof transaction) => T | Promise<T>) => {
      replicaSqlite.exec('BEGIN');
      try { const result = await callback(transaction); replicaSqlite.exec('COMMIT'); return result; }
      catch (error) { replicaSqlite.exec('ROLLBACK'); throw error; }
    },
    migrate: async migrations => {
      migratedVersions = migrations.map(migration => migration.version);
      for (const migration of migrations) {
        if (migration.version >= 5 && !appliedMigrations.has(migration.version)) {
          replicaSqlite.exec(migration.sql);
          appliedMigrations.add(migration.version);
        }
      }
      return { version: migrations.at(-1)?.version ?? 0 };
    },
    schemaVersion: async () => migratedVersions.at(-1) ?? 0,
    checkpoint: async () => { checkpoints += 1; },
    recover: async () => undefined,
  } satisfies MiniAppPrivateSqlDatabase;

  const files: MiniAppPrivateFilesApi = {
    async read(path) {
      const bytes = fileData.get(path);
      if (!bytes) throw new Error('file not found');
      return bytes.slice();
    },
    async write(path, data) {
      if (!directories.has(path.split('/')[0]!)) throw new Error('directory not found');
      fileData.set(path, data.slice());
    },
    async readRange(path, offset, length) {
      return (await files.read(path)).slice(offset, offset + length);
    },
    async writeRange(path, offset, data) {
      const current = fileData.get(path) ?? new Uint8Array();
      const next = new Uint8Array(Math.max(current.byteLength, offset + data.byteLength));
      next.set(current);
      next.set(data, offset);
      fileData.set(path, next);
    },
    async createDirectory(path) {
      if (directories.has(path)) throw new Error('directory exists');
      directories.add(path);
    },
    async list(path = '') {
      if (path === 'attachments' && rejectNextAttachmentList) {
        rejectNextAttachmentList = false;
        throw new Error('attachment list failed');
      }
      if (path === 'attachments' && attachmentListGate) {
        const gate = attachmentListGate;
        attachmentListGate = null;
        gate.release();
        await gate.entered;
      }
      const prefix = path ? `${path}/` : '';
      return {
        entries: [...fileData.entries()]
          .filter(([name]) => name.startsWith(prefix))
          .map(([name, bytes]) => ({
            name: name.slice(prefix.length),
            kind: 'file' as const,
            storedBytes: bytes.byteLength,
          })),
      };
    },
    async metadata(path) {
      if (directories.has(path)) return { kind: 'directory', size: 0 };
      const bytes = fileData.get(path);
      if (!bytes) throw new Error('file not found');
      return { kind: 'file', size: bytes.byteLength };
    },
    async rename(from, to) {
      const bytes = fileData.get(from);
      if (!bytes) throw new Error('file not found');
      fileData.set(to, bytes);
      fileData.delete(from);
    },
    async delete(path, options) {
      if (directories.has(path)) {
        if (!options?.recursive) throw new Error('directory is not empty');
        directories.delete(path);
        for (const name of [...fileData.keys()]) {
          if (name.startsWith(`${path}/`)) fileData.delete(name);
        }
        return;
      }
      if (!fileData.delete(path)) throw new Error('file not found');
    },
    createReadStream(path) {
      return new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(await files.read(path));
          controller.close();
        },
      });
    },
    createWriteStream(path) {
      const chunks: Uint8Array[] = [];
      return new WritableStream<Uint8Array>({
        write(chunk) { chunks.push(chunk.slice()); },
        async close() {
          const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
          }
          await files.write(path, bytes);
        },
      });
    },
  };

  const storage = {
    quota: { defaultBytes: 1_073_741_824, effectiveBytes: 1_073_741_824 },
    files,
    sqlite: { open: async () => database },
    zvec: {} as MiniAppPrivateStorageHandle['zvec'],
    usage: async () => ({
      usedBytes: (stateJson ? new TextEncoder().encode(stateJson).byteLength : 0) +
        [...fileData.values()].reduce((total, bytes) => total + bytes.byteLength, 0),
      quotaBytes: 1_073_741_824,
      hostLimitBytes: 1_073_741_824,
    }),
    close: async () => { storageClosed = true; },
  } satisfies MiniAppPrivateStorageHandle;
  const profile = {
    async open(access?: MiniAppPrivateStorageAccess) {
      openAccess = access;
      return storage;
    },
  } satisfies MiniAppPrivateStorageApi;
  return {
    profile,
    seedLegacyState(state: unknown, updatedAt: string) {
      stateJson = JSON.stringify(state);
      stateUpdatedAt = updatedAt;
      normalizedSourceUpdatedAt = null;
      normalizedIndexedAt = null;
    },
    rewriteFirstCacheSourceUrl(sourceUrl: string) {
      const first = cacheRows.values().next().value as CacheRow | undefined;
      if (first) cacheRows.set(first.cacheKey, { ...first, sourceUrl });
    },
    rewriteFirstAttachmentIdentity(identity: Partial<AttachmentCacheIdentity>) {
      const first = attachmentRows.values().next().value as AttachmentRow | undefined;
      if (first) attachmentRows.set(first.cacheKey, { ...first, ...identity });
    },
    corruptFirstAttachment() {
      const first = attachmentRows.values().next().value as AttachmentRow | undefined;
      if (!first) return;
      const path = `attachments/${first.cacheKey}.${first.contentHash}${
        first.storageToken === null ? '' : `.${first.storageToken}`
      }.bin`;
      const existing = fileData.get(path);
      fileData.set(path, new Uint8Array(existing?.byteLength ?? 1).fill(255));
    },
    expireAttachments(expiresAt: number) {
      for (const [cacheKey, row] of attachmentRows) {
        attachmentRows.set(cacheKey, { ...row, expiresAt });
      }
    },
    failNextAttachmentInsert() {
      rejectNextAttachmentInsert = true;
    },
    failNextAttachmentList() {
      rejectNextAttachmentList = true;
    },
    pauseNextAttachmentList() {
      let markEntered!: () => void;
      let releaseList!: () => void;
      const entered = new Promise<void>(resolve => { markEntered = resolve; });
      const released = new Promise<void>(resolve => { releaseList = resolve; });
      attachmentListGate = { entered: released, release: markEntered };
      return { entered, release: releaseList };
    },
    diagnostics: () => ({
      checkpoints,
      databaseClosed,
      storageClosed,
      openAccess,
      cacheRows: [...cacheRows.values()],
      attachmentRows: [...attachmentRows.values()],
      normalizedSourceUpdatedAt,
      normalizedIndexedAt,
      normalizedStatements: [...normalizedStatements],
      migratedVersions,
      files: [...fileData.entries()].map(([path, bytes]) => ({
        path,
        bytes: [...bytes],
      })),
    }),
  };
}

describe('TAP Email private profile cache', () => {
  it('persists and restores the mailbox in the package-scoped profile', async () => {
    const fixture = profileStorageFixture();
    const store = createLocalMailStore(false, fixture.profile);
    const pending = composeMessage(
      previewMailState(),
      'cmd_persisted_send',
      'google_work',
      null,
      'maya@example.com',
      'Persisted send',
      'Keep this original message available for recovery.',
      null,
      '2026-09-14T12:00:00.000Z',
      { draftKey: 'draft_persisted_send', draftRevision: 2 },
    );
    const command = pending.commands.at(-1)!;
    const failedReceipt: MailCommandReceipt = {
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey,
      accountId: command.accountId,
      state: 'failed',
      acceptedAt: '2026-09-14T12:00:00.000Z',
      providerAcknowledgedAt: null,
      errorCode: 'provider_rejected',
    };
    const state = settleMailCommand(
      pending,
      command,
      failedReceipt,
      '2026-09-14T12:00:01.000Z',
    );

    expect(store.capability).toBe('private-profile-sqlite');
    expect(await store.load()).toBeNull();
    await store.save(state);
    expect(await store.load()).toEqual({ ...state, accounts: [...state.accounts].sort((a, b) => a.accountId.localeCompare(b.accountId)), threads: [...state.threads].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)) });
    expect((await store.load())?.outbox?.[0]?.attempts[0]).toEqual({
      command,
      receipt: failedReceipt,
    });
    expect(fixture.diagnostics()).toMatchObject({
      checkpoints: 2,
      openAccess: {
        filesRead: true,
        filesWrite: true,
        sqlite: true,
        zvec: false,
      },
    });

    await store.close();
    expect(fixture.diagnostics()).toMatchObject({
      databaseClosed: true,
      storageClosed: true,
    });
  });

  it('persists and clears the last durable mailbox page checkpoint', async () => {
    const fixture = profileStorageFixture();
    const store = createLocalMailStore(false, fixture.profile);
    const progress = {
      nextCursor: 'older_page_cursor',
      pagesLoaded: 3,
      threadsLoaded: 300,
      updatedAt: '2026-09-17T12:00:00.000Z',
    };

    await expect(store.loadMailboxPageProgress()).resolves.toBeNull();
    await store.saveMailboxPageProgress(progress);
    await expect(store.loadMailboxPageProgress()).resolves.toEqual(progress);
    await store.clearMailboxPageProgress();
    await expect(store.loadMailboxPageProgress()).resolves.toBeNull();
  });

  it('backfills normalized metadata when opening a legacy JSON-only checkpoint', async () => {
    const fixture = profileStorageFixture();
    const state = previewMailState();
    const sourceUpdatedAt = '2026-09-14T12:00:00.000Z';
    fixture.seedLegacyState(state, sourceUpdatedAt);
    const store = new ProfileSqliteMailStore(
      fixture.profile,
      () => Date.parse('2026-09-14T12:00:01.000Z'),
    );

    await expect(store.load()).resolves.toEqual({ ...state, accounts: [...state.accounts].sort((a, b) => a.accountId.localeCompare(b.accountId)), threads: [...state.threads].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)) });

    const diagnostics = fixture.diagnostics();
    expect(diagnostics.migratedVersions).toEqual(
      Array.from({ length: 29 }, (_, index) => index + 1),
    );
    expect(diagnostics.normalizedSourceUpdatedAt).toBe('2026-09-14T12:00:01.000Z');
    expect(diagnostics.normalizedIndexedAt).toBe('2026-09-14T12:00:01.000Z');
    expect(diagnostics.normalizedStatements.some(statement =>
      statement.sql.includes('INTO local_mail_messages'))).toBe(true);
    expect(diagnostics.checkpoints).toBe(3);
    await store.close();
  });

  it('stores image bytes in private files and restores them after reopening', async () => {
    const fixture = profileStorageFixture();
    const url = 'https://images.example.test/campaign/hero.png';
    const firstStore = new ProfileSqliteMailStore(fixture.profile);

    await firstStore.saveRemoteImages({ [url]: pngDataUrl });
    await firstStore.close();

    const reopenedStore = new ProfileSqliteMailStore(fixture.profile);
    await expect(reopenedStore.loadRemoteImages([url])).resolves.toEqual({
      [url]: pngDataUrl,
    });
    await reopenedStore.close();

    const diagnostics = fixture.diagnostics();
    expect(diagnostics.files).toHaveLength(1);
    expect(diagnostics.files[0]).toMatchObject({
      path: 'remote-images/ab45343433ccc0136a6646e9b8106af40564cdb1bf531dca15b02311d8d4a2f6.bin',
      bytes: [137, 80, 78, 71, 13, 10, 26, 10],
    });
    expect(JSON.stringify(diagnostics.cacheRows)).not.toContain('base64');
  });

  it('requires an exact source URL match in addition to the SHA-256 key', async () => {
    const fixture = profileStorageFixture();
    const url = 'https://images.example.test/exact.png';
    const store = new ProfileSqliteMailStore(fixture.profile);
    await store.saveRemoteImages({ [url]: pngDataUrl });
    fixture.rewriteFirstCacheSourceUrl('https://images.example.test/different.png');

    await expect(store.loadRemoteImages([url])).resolves.toEqual({});
    await store.close();
  });

  it('expires cached images after 30 days', async () => {
    const fixture = profileStorageFixture();
    const url = 'https://images.example.test/expiring.png';
    let now = 1_000_000;
    const store = new ProfileSqliteMailStore(fixture.profile, () => now);
    await store.saveRemoteImages({ [url]: pngDataUrl });

    now += remoteImageCacheTtlMs;
    await expect(store.loadRemoteImages([url])).resolves.toEqual({});
    await store.close();
    expect(fixture.diagnostics()).toMatchObject({ cacheRows: [], files: [] });
  });

  it('evicts least-recently-used files when the local cache reaches its bound', async () => {
    const fixture = profileStorageFixture();
    let now = 1_000_000;
    const store = new ProfileSqliteMailStore(fixture.profile, () => now, 8);
    const olderUrl = 'https://images.example.test/older.png';
    const newerUrl = 'https://images.example.test/newer.jpg';
    await store.saveRemoteImages({ [olderUrl]: pngDataUrl });
    now += 1;
    await store.saveRemoteImages({ [newerUrl]: jpegDataUrl });

    await expect(store.loadRemoteImages([olderUrl, newerUrl])).resolves.toEqual({
      [newerUrl]: jpegDataUrl,
    });
    await store.close();
    expect(fixture.diagnostics().files).toHaveLength(1);
  });

  it('stores attachment bytes privately and restores only the exact message resource', async () => {
    const fixture = profileStorageFixture();
    const identity: AttachmentCacheIdentity = {
      accountId: 'google_work',
      threadId: 'thread_1',
      messageId: 'message_1',
      resourceId: 'part_2',
      sizeBytes: 4,
    };
    const firstStore = new ProfileSqliteMailStore(fixture.profile);
    await firstStore.saveAttachment(identity, new Uint8Array([1, 2, 3, 4]));
    await firstStore.close();

    const reopenedStore = new ProfileSqliteMailStore(fixture.profile);
    await expect(reopenedStore.loadAttachment(identity)).resolves.toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );
    await expect(reopenedStore.loadAttachment({
      ...identity,
      messageId: 'message_2',
    })).resolves.toBeNull();
    await reopenedStore.close();

    const diagnostics = fixture.diagnostics();
    expect(diagnostics.attachmentRows).toHaveLength(1);
    expect(diagnostics.files.some(file => file.path.startsWith('attachments/'))).toBe(true);
  });

  it('checks the full attachment tuple independently from its cache hash', async () => {
    const fixture = profileStorageFixture();
    const identity: AttachmentCacheIdentity = {
      accountId: 'google_work',
      threadId: 'thread_1',
      messageId: 'message_1',
      resourceId: 'part_2',
      sizeBytes: 2,
    };
    const store = new ProfileSqliteMailStore(fixture.profile);
    await store.saveAttachment(identity, new Uint8Array([1, 2]));
    fixture.rewriteFirstAttachmentIdentity({ messageId: 'message_other' });

    await expect(store.loadAttachment(identity)).resolves.toBeNull();
    await store.close();
  });

  it('rejects metadata mismatches and removes same-length content corruption', async () => {
    const fixture = profileStorageFixture();
    const identity: AttachmentCacheIdentity = {
      accountId: 'google_work',
      threadId: 'thread_1',
      messageId: 'message_1',
      resourceId: 'part_2',
      sizeBytes: 3,
    };
    const store = new ProfileSqliteMailStore(fixture.profile);
    await expect(store.saveAttachment(identity, new Uint8Array([1, 2])))
      .rejects.toThrow('do not match');
    await store.saveAttachment(identity, new Uint8Array([1, 2, 3]));
    fixture.corruptFirstAttachment();

    await expect(store.loadAttachment(identity)).resolves.toBeNull();
    await store.close();
    expect(fixture.diagnostics().attachmentRows).toEqual([]);
  });

  it('expires cached attachments after 30 days', async () => {
    const fixture = profileStorageFixture();
    let now = 1_000_000;
    const identity: AttachmentCacheIdentity = {
      accountId: 'google_work',
      threadId: 'thread_1',
      messageId: 'message_1',
      resourceId: 'part_2',
      sizeBytes: 1,
    };
    const store = new ProfileSqliteMailStore(fixture.profile, () => now);
    await store.saveAttachment(identity, new Uint8Array([7]));

    now += attachmentCacheTtlMs;
    await expect(store.loadAttachment(identity)).resolves.toBeNull();
    await store.close();
    expect(fixture.diagnostics()).toMatchObject({ attachmentRows: [] });
  });

  it('prunes expired attachment bytes when the private store reopens', async () => {
    const fixture = profileStorageFixture();
    const identity: AttachmentCacheIdentity = {
      accountId: 'google_work',
      threadId: 'thread_1',
      messageId: 'message_1',
      resourceId: 'part_2',
      sizeBytes: 1,
    };
    const firstStore = new ProfileSqliteMailStore(fixture.profile, () => 1_000_000);
    await firstStore.saveAttachment(identity, new Uint8Array([7]));
    await firstStore.close();
    fixture.expireAttachments(1_000_001);

    const reopenedStore = new ProfileSqliteMailStore(fixture.profile, () => 1_000_002);
    await reopenedStore.load();
    await reopenedStore.close();
    expect(fixture.diagnostics()).toMatchObject({ attachmentRows: [], files: [] });
  });

  it('keeps the previous content-addressed file when a metadata save fails', async () => {
    const fixture = profileStorageFixture();
    const identity: AttachmentCacheIdentity = {
      accountId: 'google_work',
      threadId: 'thread_1',
      messageId: 'message_1',
      resourceId: 'part_2',
      sizeBytes: 2,
    };
    const store = new ProfileSqliteMailStore(fixture.profile);
    await store.saveAttachment(identity, new Uint8Array([1, 2]));
    fixture.failNextAttachmentInsert();

    await expect(store.saveAttachment(identity, new Uint8Array([3, 4])))
      .rejects.toThrow('attachment insert failed');
    await expect(store.loadAttachment(identity)).resolves.toEqual(new Uint8Array([1, 2]));
    await store.close();
    expect(fixture.diagnostics().files).toHaveLength(1);
  });

  it('serializes an expired read behind a same-key refresh', async () => {
    const fixture = profileStorageFixture();
    let now = 1_000_000;
    const identity: AttachmentCacheIdentity = {
      accountId: 'google_work',
      threadId: 'thread_1',
      messageId: 'message_1',
      resourceId: 'part_2',
      sizeBytes: 2,
    };
    const store = new ProfileSqliteMailStore(fixture.profile, () => now);
    await store.saveAttachment(identity, new Uint8Array([1, 2]));
    now += attachmentCacheTtlMs;

    const refreshed = store.saveAttachment(identity, new Uint8Array([3, 4]));
    const loaded = store.loadAttachment(identity);
    await expect(refreshed).resolves.toBeUndefined();
    await expect(loaded).resolves.toEqual(new Uint8Array([3, 4]));
    await store.close();
    expect(fixture.diagnostics().attachmentRows).toHaveLength(1);
  });

  it('evicts the least-recently-used attachment after a read refreshes recency', async () => {
    const fixture = profileStorageFixture();
    let now = 1_000_000;
    const store = new ProfileSqliteMailStore(
      fixture.profile,
      () => now,
      256 * 1_024 * 1_024,
      4,
    );
    const first: AttachmentCacheIdentity = {
      accountId: 'google_work',
      threadId: 'thread_1',
      messageId: 'message_1',
      resourceId: 'part_1',
      sizeBytes: 2,
    };
    const second: AttachmentCacheIdentity = {
      ...first,
      resourceId: 'part_2',
    };
    const third: AttachmentCacheIdentity = {
      ...first,
      resourceId: 'part_3',
    };
    await store.saveAttachment(first, new Uint8Array([1, 2]));
    now += 1;
    await store.saveAttachment(second, new Uint8Array([3, 4]));
    now += 1;
    await expect(store.loadAttachment(first)).resolves.toEqual(new Uint8Array([1, 2]));
    now += 1;
    await store.saveAttachment(third, new Uint8Array([5, 6]));

    await expect(store.loadAttachment(first)).resolves.toEqual(new Uint8Array([1, 2]));
    await expect(store.loadAttachment(second)).resolves.toBeNull();
    await expect(store.loadAttachment(third)).resolves.toEqual(new Uint8Array([5, 6]));
    await store.close();
    expect(fixture.diagnostics().attachmentRows).toHaveLength(2);
  });

  it('does not let one store sweep a file another store is committing', async () => {
    const fixture = profileStorageFixture();
    const identity: AttachmentCacheIdentity = {
      accountId: 'google_work',
      threadId: 'thread_1',
      messageId: 'message_1',
      resourceId: 'part_1',
      sizeBytes: 2,
    };
    const firstStore = new ProfileSqliteMailStore(fixture.profile, () => 1_000_000);
    const secondStore = new ProfileSqliteMailStore(fixture.profile, () => 1_000_000);
    const gate = fixture.pauseNextAttachmentList();

    const firstOpening = firstStore.load();
    await gate.entered;
    await secondStore.saveAttachment(identity, new Uint8Array([1, 2]));
    gate.release();
    await expect(firstOpening).resolves.toBeNull();
    await expect(secondStore.loadAttachment(identity)).resolves.toEqual(
      new Uint8Array([1, 2]),
    );

    await firstStore.close();
    await secondStore.close();
    expect(fixture.diagnostics()).toMatchObject({
      attachmentRows: [{ resourceId: 'part_1' }],
    });
    expect(fixture.diagnostics().files).toHaveLength(1);
  });

  it('keeps mailbox state usable when attachment housekeeping fails', async () => {
    const fixture = profileStorageFixture();
    fixture.failNextAttachmentList();
    const store = new ProfileSqliteMailStore(fixture.profile);

    await expect(store.load()).resolves.toBeNull();
    await expect(store.save(previewMailState())).resolves.toBeUndefined();
    expect((await store.load())?.threads).toHaveLength(previewMailState().threads.length);
    await store.close();
  });

  it('persists TAP-owned triage corrections in private profile state', async () => {
    const fixture = profileStorageFixture();
    const store = new ProfileSqliteMailStore(fixture.profile);
    const state = previewMailState();
    const target = state.threads[0]!;
    const corrected = correctThreadAttention(
      state,
      target.accountId,
      target.threadId,
      { critical: false, responseState: 'waiting' },
      '2026-09-14T12:00:00.000Z',
    );

    await store.save(corrected);
    const loaded = await store.load();

    expect(loaded && projectedThreads(loaded).find(item =>
      item.accountId === target.accountId && item.threadId === target.threadId
    )).toMatchObject({
      critical: false,
      needsResponse: false,
      waitingOnOthers: true,
      attentionCorrection: {
        critical: false,
        responseState: 'waiting',
        correctedAt: '2026-09-14T12:00:00.000Z',
      },
    });
    await store.close();
  });

  it('reports coverage, logical metadata, physical cache bytes, and quota limits', async () => {
    const fixture = profileStorageFixture();
    const now = Date.parse('2026-09-14T12:30:00.000Z');
    const store = new ProfileSqliteMailStore(fixture.profile, () => now);
    const state = previewMailState();
    const attachment: AttachmentCacheIdentity = {
      accountId: 'google_work',
      threadId: 'thread_inventory',
      messageId: 'message_inventory',
      resourceId: 'part_inventory',
      sizeBytes: 4,
    };

    await store.save(state);
    await store.saveAttachment(attachment, new Uint8Array([1, 2, 3, 4]));
    await store.saveRemoteImages({
      'https://images.example.test/inventory.png': pngDataUrl,
    });

    const inventory = await store.inspectStorage();
    const classes = new Map(inventory.classes.map(entry => [entry.class, entry]));
    expect(inventory).toMatchObject({
      schemaVersion: 1,
      generatedAt: '2026-09-14T12:30:00.000Z',
      scope: 'private-profile',
      indexedAt: '2026-09-14T12:30:00.000Z',
      counts: { accounts: 2, threads: 5, messages: 7 },
      quota: {
        quotaBytes: 1_073_741_824,
        hostLimitBytes: 1_073_741_824,
        effectiveBytes: 1_073_741_824,
      },
    });
    expect(inventory.accounts).toHaveLength(2);
    expect(inventory.accounts.find(account => account.accountId === 'google_work'))
      .toMatchObject({
        state: 'backfilling',
        indexedThrough: '2025-11-01T00:00:00.000Z',
      });
    expect(classes.get('raw-mail')).toMatchObject({
      measurement: 'logical',
      itemCount: 1,
    });
    expect(classes.get('search-metadata')).toMatchObject({
      measurement: 'logical',
    });
    expect(classes.get('search-metadata')?.bytes).toBeGreaterThan(0);
    expect(classes.get('attachment')).toMatchObject({
      measurement: 'physical',
      itemCount: 1,
      bytes: 4,
    });
    expect(classes.get('remote-image')).toMatchObject({
      measurement: 'physical',
      itemCount: 1,
      bytes: 8,
    });
    expect(classes.get('semantic-vector')).toMatchObject({
      measurement: 'unavailable',
      bytes: null,
    });
    expect(classes.get('audit')).toMatchObject({
      measurement: 'unavailable',
      bytes: null,
    });
    expect(inventory.warnings).toContain(
      'One or more account replicas have partial or failed coverage.',
    );
    await store.close();
  });

  it('wipes one account without retaining unowned remote images or other account mail', async () => {
    const fixture = profileStorageFixture();
    const now = Date.parse('2026-09-14T13:00:00.000Z');
    const store = new ProfileSqliteMailStore(fixture.profile, () => now);
    await store.save(previewMailState());
    await store.saveAttachment({
      accountId: 'google_work',
      threadId: 'thread_work',
      messageId: 'message_work',
      resourceId: 'part_work',
      sizeBytes: 2,
    }, new Uint8Array([1, 2]));
    await store.saveAttachment({
      accountId: 'google_personal',
      threadId: 'thread_personal',
      messageId: 'message_personal',
      resourceId: 'part_personal',
      sizeBytes: 3,
    }, new Uint8Array([3, 4, 5]));
    await store.saveRemoteImages({
      'https://images.example.test/account-wipe.png': pngDataUrl,
    });

    const receipt = await store.wipeAccount('google_work');
    const remaining = await store.load();

    expect(receipt).toMatchObject({
      schemaVersion: 1,
      scope: 'account',
      accountId: 'google_work',
      complete: false,
      overRemovedClasses: ['remote-image'],
      remainingClasses: ['semantic-vector', 'audit'],
      removed: {
        accounts: 1,
        cachedAttachmentBytes: 2,
        cachedRemoteImageBytes: 8,
      },
    });
    expect(remaining?.accounts.map(account => account.accountId))
      .toEqual(['google_personal']);
    expect(remaining?.threads.every(thread => thread.accountId === 'google_personal'))
      .toBe(true);
    expect(remaining?.preferences.notificationAccountIds)
      .toEqual(['google_personal']);
    expect(fixture.diagnostics()).toMatchObject({
      cacheRows: [],
      attachmentRows: [{ accountId: 'google_personal' }],
    });
    expect(fixture.diagnostics().files).toHaveLength(1);
    await store.close();
  });

  it('wipes the mailbox replica and both file-backed caches with an honest receipt', async () => {
    const fixture = profileStorageFixture();
    const now = Date.parse('2026-09-14T13:30:00.000Z');
    const store = new ProfileSqliteMailStore(fixture.profile, () => now);
    await store.save(previewMailState());
    await store.saveAttachment({
      accountId: 'google_work',
      threadId: 'thread_device',
      messageId: 'message_device',
      resourceId: 'part_device',
      sizeBytes: 2,
    }, new Uint8Array([1, 2]));
    await store.saveRemoteImages({
      'https://images.example.test/device-wipe.png': pngDataUrl,
    });

    const receipt = await store.wipeDevice();

    expect(receipt).toMatchObject({
      schemaVersion: 1,
      scope: 'device',
      accountId: null,
      complete: false,
      removedClasses: [
        'raw-mail',
        'search-metadata',
        'attachment',
        'remote-image',
      ],
      remainingClasses: ['semantic-vector', 'audit'],
      removed: {
        accounts: 2,
        threads: 5,
        messages: 7,
        cachedAttachmentBytes: 2,
        cachedRemoteImageBytes: 8,
      },
    });
    await expect(store.load()).resolves.toBeNull();
    expect(fixture.diagnostics()).toMatchObject({
      cacheRows: [],
      attachmentRows: [],
      files: [],
      normalizedSourceUpdatedAt: null,
      normalizedIndexedAt: null,
    });
    await store.close();
  });

  it('rejects an untrusted account identifier before opening private storage', async () => {
    const fixture = profileStorageFixture();
    const store = new ProfileSqliteMailStore(fixture.profile);

    await expect(store.wipeAccount("google_work'; DELETE FROM mailbox_state; --"))
      .rejects.toThrow('valid TAP account ID');
    expect(fixture.diagnostics().openAccess).toBeUndefined();
  });

  it('fails closed when the host does not expose profile storage', async () => {
    const store = createLocalMailStore(false, null);
    expect(store.capability).toBe('unavailable');
    await expect(store.loadRemoteImages(['https://images.example.test/a.png']))
      .resolves.toEqual({});
    await expect(store.loadAttachment({
      accountId: 'google_work',
      threadId: 'thread_1',
      messageId: 'message_1',
      resourceId: 'part_1',
      sizeBytes: 1,
    })).resolves.toBeNull();
  });

  it('can retry after a transient profile-storage open failure', async () => {
    const fixture = profileStorageFixture();
    let attempts = 0;
    const retryingProfile: MiniAppPrivateStorageApi = {
      async open() {
        attempts += 1;
        if (attempts === 1) throw new Error('profile temporarily unavailable');
        return fixture.profile.open();
      },
    };
    const store = createLocalMailStore(false, retryingProfile);
    await expect(store.load()).rejects.toThrow('temporarily unavailable');
    await expect(store.load()).resolves.toBeNull();
    expect(attempts).toBe(2);
    await store.close();
  });
});
