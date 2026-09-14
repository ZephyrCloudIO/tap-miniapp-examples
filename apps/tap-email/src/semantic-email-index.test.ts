import { describe, expect, it } from '@rstest/core';
import type {
  MiniAppEmbeddingModel,
  MiniAppEmbeddingSpaceBinding,
  MiniAppEmbeddingsApi,
  MiniAppPrivateStorageAccess,
  MiniAppPrivateStorageApi,
  MiniAppPrivateStorageHandle,
  MiniAppPrivateZvecCollection,
  MiniAppZvecDocument,
  MiniAppZvecQuery,
  MiniAppZvecSchema,
  MiniAppZvecSearchResult,
} from '@theaiplatform/miniapp-sdk/sdk';
import type { EmailThread } from './domain';
import { openEmailSemanticIndex } from './semantic-email-index';

const binding: MiniAppEmbeddingSpaceBinding = {
  model: 'local/email-test',
  revision: 'revision-1',
  dimensions: 3,
  fingerprint: `sha256:${'a'.repeat(64)}`,
  provenance: 'custom-unverified',
};

const model: MiniAppEmbeddingModel = {
  id: binding.model,
  displayName: 'Email test model',
  description: 'Fixture',
  source: 'platform',
  revision: binding.revision,
  availability: 'installed',
  capabilities: {
    modalities: ['text'],
    dimensions: binding.dimensions,
    maxInputs: 2,
    maxInputTokens: 8_192,
    maxInputBytes: 32_768,
    roles: ['query', 'document'],
    normalization: 'l2',
    supportsBackground: true,
  },
  estimatedDownloadBytes: null,
  estimatedMemoryBytes: 1_024,
  license: null,
  licenseUrl: null,
  gated: false,
};

function thread(overrides: Partial<EmailThread> = {}): EmailThread {
  return {
    threadId: 'thread-1',
    accountId: 'account-1',
    providerRevision: 'revision-1',
    subject: 'Quarterly planning',
    participants: [{ name: 'Ada', address: 'ada@example.com' }],
    snippet: 'Please review the launch plan.',
    receivedAt: '2026-09-13T12:00:00.000Z',
    unread: true,
    starred: false,
    critical: true,
    needsResponse: true,
    waitingOnOthers: false,
    status: 'inbox',
    labels: ['INBOX', 'IMPORTANT'],
    messages: [{
      messageId: 'message-1',
      from: { name: 'Ada', address: 'ada@example.com' },
      to: [{ name: 'Zack', address: 'zack@example.com' }],
      sentAt: '2026-09-13T12:00:00.000Z',
      bodyText: 'Can you review the launch plan before Friday?',
    }],
    reminder: null,
    ...overrides,
  };
}

function indexFixture() {
  const documents = new Map<string, MiniAppZvecDocument>();
  const embedCalls: Array<{ role: 'query' | 'document'; texts: readonly string[] }> = [];
  let openAccess: MiniAppPrivateStorageAccess | undefined;
  let openedName = '';
  let openedSchema: MiniAppZvecSchema | undefined;
  let lastQuery: MiniAppZvecQuery | undefined;
  let flushes = 0;
  let collectionClosed = false;
  let storageClosed = false;

  const scalarFields = (document: MiniAppZvecDocument) => Object.fromEntries(
    Object.entries(document.fields).filter(([name]) => name !== 'embedding'),
  ) as MiniAppZvecSearchResult['fields'];
  const collection: MiniAppPrivateZvecCollection = {
    bindings: { embedding: binding },
    async insert(input) {
      return this.upsert(input);
    },
    async upsert(input) {
      for (const document of input) documents.set(document.pk, document);
      return {
        writeResults: input.map(document => ({ pk: document.pk, code: 0, message: '' })),
        affectedCount: input.length,
      };
    },
    async update(input) {
      return this.upsert(input);
    },
    async delete(options) {
      const pks = 'pks' in options && options.pks ? options.pks : [];
      let affectedCount = 0;
      for (const pk of pks) {
        if (documents.delete(pk)) affectedCount += 1;
      }
      return {
        writeResults: pks.map(pk => ({ pk, code: 0, message: '' })),
        affectedCount,
      };
    },
    async query(query) {
      lastQuery = query;
      const first = documents.values().next().value as MiniAppZvecDocument | undefined;
      return first ? [{ pk: first.pk, score: 0.91, fields: scalarFields(first) }] : [];
    },
    async fetch(pks) {
      return pks.flatMap(pk => {
        const document = documents.get(pk);
        return document ? [{ pk, score: 1, fields: scalarFields(document) }] : [];
      });
    },
    async stats() {
      return { docCount: documents.size, storedBytes: documents.size * 100, indexes: [] };
    },
    async flush() {
      flushes += 1;
      return this.stats();
    },
    async close() {
      collectionClosed = true;
    },
  };
  const storage: MiniAppPrivateStorageHandle = {
    quota: { defaultBytes: 1_000_000, effectiveBytes: 1_000_000 },
    files: {} as MiniAppPrivateStorageHandle['files'],
    sqlite: {} as MiniAppPrivateStorageHandle['sqlite'],
    zvec: {
      async open(name, schema) {
        openedName = name;
        openedSchema = schema;
        return collection;
      },
    },
    async usage() {
      return { usedBytes: 0, quotaBytes: 1_000_000, hostLimitBytes: 1_000_000 };
    },
    async close() {
      storageClosed = true;
    },
  };
  const profileStorage: MiniAppPrivateStorageApi = {
    async open(access) {
      openAccess = access;
      return storage;
    },
  };
  const embeddings: MiniAppEmbeddingsApi = {
    async listModels() {
      return [model];
    },
    async recommend() {
      return [{ model, score: 1, reasons: ['installed locally'] }];
    },
    async embed(options) {
      embedCalls.push({ role: options.role, texts: options.inputs.map(input => input.text) });
      return {
        binding,
        vectors: options.inputs.map((_, index) => ({
          values: [index + 1, 0, 0],
          binding,
        })),
      };
    },
  };

  return {
    profileStorage,
    embeddings,
    diagnostics: () => ({
      documents,
      embedCalls,
      openAccess,
      openedName,
      openedSchema,
      lastQuery,
      flushes,
      collectionClosed,
      storageClosed,
    }),
  };
}

describe('TAP Email semantic profile index', () => {
  it('opens only zvec storage and pins the exact embedding binding', async () => {
    const fixture = indexFixture();
    const index = await openEmailSemanticIndex(fixture.profileStorage, fixture.embeddings);
    const diagnostics = fixture.diagnostics();

    expect(diagnostics.openAccess).toEqual({
      filesRead: false,
      filesWrite: false,
      sqlite: false,
      zvec: true,
    });
    expect(diagnostics.openedName).toMatch(/^tap_email_semantic_v1_3_/);
    expect(diagnostics.openedSchema?.fields).toContainEqual(expect.objectContaining({
      name: 'embedding',
      dimension: 3,
      binding,
    }));
    expect(index.binding).toEqual(binding);
  });

  it('indexes changed threads in model-sized batches and skips unchanged content', async () => {
    const fixture = indexFixture();
    const index = await openEmailSemanticIndex(fixture.profileStorage, fixture.embeddings);
    const threads = [
      thread(),
      thread({ threadId: 'thread-2', providerRevision: 'revision-2' }),
      thread({ threadId: 'thread-3', providerRevision: 'revision-3' }),
    ];

    await expect(index.indexThreads(threads)).resolves.toMatchObject({
      indexedCount: 3,
      skippedCount: 0,
      stats: { docCount: 3 },
    });
    await expect(index.indexThreads(threads)).resolves.toMatchObject({
      indexedCount: 0,
      skippedCount: 3,
    });
    await expect(index.indexThreads([
      { ...threads[0]!, unread: false },
      threads[1]!,
      threads[2]!,
    ])).resolves.toMatchObject({
      indexedCount: 1,
      skippedCount: 2,
    });

    const diagnostics = fixture.diagnostics();
    expect(diagnostics.embedCalls.map(call => call.role)).toEqual([
      'document',
      'document',
      'document',
      'document',
    ]);
    expect(diagnostics.embedCalls[1]?.texts).toHaveLength(2);
    expect(diagnostics.embedCalls[2]?.texts).toHaveLength(1);
    expect(diagnostics.flushes).toBe(2);
  });

  it('uses query-role embeddings and typed account, unread, and status filters', async () => {
    const fixture = indexFixture();
    const index = await openEmailSemanticIndex(fixture.profileStorage, fixture.embeddings);
    await index.indexThreads([thread()]);

    const matches = await index.search('launch plan', {
      accountId: 'account-1',
      unreadOnly: true,
      status: 'inbox',
      topK: 7,
    });

    expect(matches).toEqual([expect.objectContaining({
      score: 0.91,
      threadKey: 'account-1\u0000thread-1',
      subject: 'Quarterly planning',
      unread: true,
      status: 'inbox',
    })]);
    expect(fixture.diagnostics().lastQuery).toMatchObject({
      fieldName: 'embedding',
      topK: 7,
      filter: {
        op: 'and',
        filters: [
          { op: 'eq', field: 'account_id', value: 'account-1' },
          { op: 'eq', field: 'unread', value: true },
          { op: 'eq', field: 'status', value: 'inbox' },
        ],
      },
    });
    expect(fixture.diagnostics().embedCalls.at(-1)?.role).toBe('query');
  });

  it('closes both native capabilities and rejects later operations', async () => {
    const fixture = indexFixture();
    const index = await openEmailSemanticIndex(fixture.profileStorage, fixture.embeddings);
    await index.close();
    await index.close();

    expect(fixture.diagnostics()).toMatchObject({
      collectionClosed: true,
      storageClosed: true,
    });
    await expect(index.search('anything')).rejects.toThrow('closed');
  });
});
