import type {
  MiniAppEmbeddingModel,
  MiniAppEmbeddingSpaceBinding,
  MiniAppEmbeddingVector,
  MiniAppEmbeddingsApi,
  MiniAppPrivateStorageApi,
  MiniAppPrivateStorageHandle,
  MiniAppPrivateZvecCollection,
  MiniAppZvecFilter,
  MiniAppZvecSchema,
  MiniAppZvecStats,
} from '@theaiplatform/miniapp-sdk/sdk';
import { emailThreadKey, type EmailThread, type ThreadStatus } from './domain';

const DEFAULT_COLLECTION_PREFIX = 'tap_email_semantic_v1';
const EMBEDDING_FIELD = 'embedding';
const MAX_EMBEDDING_TEXT_BYTES = 24 * 1024;
const FETCH_BATCH_SIZE = 1_000;

export interface EmailSemanticIndexOptions {
  /** Override model selection, primarily for a user-selected installed model. */
  readonly model?: MiniAppEmbeddingModel;
  /** Logical zvec collection prefix. The binding fingerprint is appended. */
  readonly collectionPrefix?: string;
  /** A lower application-level bound than the model's byte limit. */
  readonly maxTextBytes?: number;
}

export interface EmailSemanticSearchOptions {
  readonly topK?: number;
  readonly accountId?: string;
  readonly unreadOnly?: boolean;
  readonly status?: ThreadStatus;
}

export interface EmailSemanticMatch {
  readonly score: number;
  readonly threadKey: string;
  readonly accountId: string;
  readonly threadId: string;
  readonly subject: string;
  readonly snippet: string;
  readonly receivedAt: string;
  readonly unread: boolean;
  readonly starred: boolean;
  readonly critical: boolean;
  readonly needsResponse: boolean;
  readonly waitingOnOthers: boolean;
  readonly status: ThreadStatus;
  readonly labels: readonly string[];
}

export interface EmailSemanticIndexResult {
  readonly indexedCount: number;
  readonly skippedCount: number;
  readonly stats: MiniAppZvecStats;
}

export interface EmailSemanticIndex {
  readonly capability: 'private-profile-zvec';
  readonly collectionName: string;
  readonly binding: MiniAppEmbeddingSpaceBinding;
  indexThreads(threads: readonly EmailThread[]): Promise<EmailSemanticIndexResult>;
  deleteThreads(threads: readonly Pick<EmailThread, 'accountId' | 'threadId'>[]): Promise<number>;
  search(query: string, options?: EmailSemanticSearchOptions): Promise<readonly EmailSemanticMatch[]>;
  stats(): Promise<MiniAppZvecStats>;
  close(): Promise<void>;
}

function assertUsableModel(model: MiniAppEmbeddingModel): void {
  if (model.availability !== 'installed') {
    throw new Error(`Embedding model ${model.id} is not installed.`);
  }
  if (!model.capabilities.modalities.includes('text')) {
    throw new Error(`Embedding model ${model.id} does not support text.`);
  }
  if (!model.capabilities.roles.includes('document') ||
      !model.capabilities.roles.includes('query')) {
    throw new Error(`Embedding model ${model.id} must support document and query roles.`);
  }
}

async function chooseModel(
  embeddings: MiniAppEmbeddingsApi,
  override: MiniAppEmbeddingModel | undefined,
): Promise<MiniAppEmbeddingModel> {
  if (override) {
    assertUsableModel(override);
    return override;
  }
  const recommendations = await embeddings.recommend({
    modality: 'text',
    locality: 'local-only',
    background: true,
  });
  const model = recommendations
    .map(recommendation => recommendation.model)
    .find(candidate =>
      candidate.availability === 'installed' &&
      candidate.capabilities.modalities.includes('text') &&
      candidate.capabilities.roles.includes('document') &&
      candidate.capabilities.roles.includes('query'));
  if (!model) {
    throw new Error('TAP Email semantic search requires an installed local text embedding model.');
  }
  return model;
}

function sameBinding(
  left: MiniAppEmbeddingSpaceBinding,
  right: MiniAppEmbeddingSpaceBinding,
): boolean {
  return left.model === right.model &&
    left.revision === right.revision &&
    left.dimensions === right.dimensions &&
    left.fingerprint === right.fingerprint &&
    left.provenance === right.provenance;
}

function collectionNameFor(
  prefix: string,
  binding: MiniAppEmbeddingSpaceBinding,
): string {
  if (!/^[A-Za-z_][A-Za-z0-9_-]{0,127}$/u.test(prefix)) {
    throw new Error('Semantic email collectionPrefix must be a canonical logical name.');
  }
  const fingerprint = binding.fingerprint.replaceAll(/[^A-Za-z0-9_-]/gu, '');
  if (fingerprint.length === 0) {
    throw new Error('The embedding model returned an invalid binding fingerprint.');
  }
  return `${prefix}_${binding.dimensions}_${fingerprint.slice(-64)}`;
}

function schemaFor(binding: MiniAppEmbeddingSpaceBinding): MiniAppZvecSchema {
  return {
    fields: [
      { name: 'account_id', dataType: 'STRING', index: { type: 'INVERT' } },
      { name: 'thread_id', dataType: 'STRING', index: { type: 'INVERT' } },
      { name: 'source_revision', dataType: 'STRING' },
      { name: 'subject', dataType: 'STRING' },
      { name: 'snippet', dataType: 'STRING' },
      { name: 'received_at', dataType: 'STRING' },
      { name: 'unread', dataType: 'BOOL', index: { type: 'INVERT' } },
      { name: 'starred', dataType: 'BOOL', index: { type: 'INVERT' } },
      { name: 'critical', dataType: 'BOOL', index: { type: 'INVERT' } },
      { name: 'needs_response', dataType: 'BOOL', index: { type: 'INVERT' } },
      { name: 'waiting_on_others', dataType: 'BOOL', index: { type: 'INVERT' } },
      { name: 'status', dataType: 'STRING', index: { type: 'INVERT' } },
      { name: 'labels', dataType: 'ARRAY_STRING' },
      {
        name: EMBEDDING_FIELD,
        dataType: 'VECTOR_FP32',
        dimension: binding.dimensions,
        index: { type: 'HNSW', metric: 'COSINE' },
        binding,
      },
    ],
  };
}

function documentKey(thread: Pick<EmailThread, 'accountId' | 'threadId'>): string {
  // JSON escaping keeps the zvec primary key free of the NUL separator used by
  // emailThreadKey while remaining deterministic for arbitrary provider IDs.
  return JSON.stringify([thread.accountId, thread.threadId]);
}

function hashSource(thread: EmailThread): string {
  let hash = 0x811c9dc5;
  const add = (value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
  };
  add(thread.providerRevision);
  add(semanticText(thread));
  add(thread.receivedAt);
  add(thread.labels.join('\u0000'));
  add([
    thread.unread,
    thread.starred,
    thread.critical,
    thread.needsResponse,
    thread.waitingOnOthers,
    thread.status,
  ].join(':'));
  return `${thread.providerRevision}:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function semanticText(thread: EmailThread): string {
  const participants = thread.participants
    .map(participant => participant.name
      ? `${participant.name} <${participant.address}>`
      : participant.address)
    .join(', ');
  const messages = thread.messages.map(message => {
    const sender = message.from.name
      ? `${message.from.name} <${message.from.address}>`
      : message.from.address;
    const recipients = message.to.map(recipient => recipient.address).join(', ');
    return `From: ${sender}\nTo: ${recipients}\nDate: ${message.sentAt}\n${message.bodyText}`;
  });
  return [
    `Subject: ${thread.subject}`,
    `Participants: ${participants}`,
    `Labels: ${thread.labels.join(', ')}`,
    thread.snippet,
    ...messages,
  ].filter(Boolean).join('\n\n');
}

function truncateUtf8(value: string, maximumBytes: number): string {
  const encoded = new TextEncoder().encode(value);
  if (encoded.byteLength <= maximumBytes) return value;
  return new TextDecoder().decode(encoded.slice(0, maximumBytes));
}

function assertVector(
  vector: MiniAppEmbeddingVector | undefined,
  binding: MiniAppEmbeddingSpaceBinding,
): asserts vector is MiniAppEmbeddingVector {
  if (!vector || !sameBinding(vector.binding, binding)) {
    throw new Error('The embedding provider returned a vector from a different embedding space.');
  }
}

function mutationFailures(
  operation: string,
  expectedCount: number,
  writeResults: readonly { readonly pk: string; readonly code: number; readonly message: string }[],
): void {
  const failed = writeResults.filter(result => result.code !== 0);
  if (failed.length > 0) {
    const detail = failed.slice(0, 3)
      .map(result => `${result.pk}: ${result.message || `code ${result.code}`}`)
      .join('; ');
    throw new Error(`Semantic email ${operation} failed for ${failed.length} item(s): ${detail}`);
  }
  if (writeResults.length !== expectedCount) {
    throw new Error(`Semantic email ${operation} returned ${writeResults.length} results for ${expectedCount} item(s).`);
  }
}

function filterFor(options: EmailSemanticSearchOptions): MiniAppZvecFilter | undefined {
  const filters: MiniAppZvecFilter[] = [];
  if (options.accountId) {
    filters.push({ op: 'eq', field: 'account_id', value: options.accountId });
  }
  if (options.unreadOnly) {
    filters.push({ op: 'eq', field: 'unread', value: true });
  }
  if (options.status) {
    filters.push({ op: 'eq', field: 'status', value: options.status });
  }
  if (filters.length === 0) return undefined;
  return filters.length === 1 ? filters[0] : { op: 'and', filters };
}

function stringField(fields: Readonly<Record<string, unknown>>, name: string): string {
  const value = fields[name];
  return typeof value === 'string' ? value : '';
}

function booleanField(fields: Readonly<Record<string, unknown>>, name: string): boolean {
  return fields[name] === true;
}

function labelsField(fields: Readonly<Record<string, unknown>>): readonly string[] {
  const labels = fields.labels;
  return Array.isArray(labels) ? labels.filter((value): value is string => typeof value === 'string') : [];
}

async function closeBoth(
  collection: MiniAppPrivateZvecCollection,
  storage: MiniAppPrivateStorageHandle,
): Promise<void> {
  let failure: unknown;
  try {
    await collection.close();
  } catch (error) {
    failure = error;
  }
  try {
    await storage.close();
  } catch (error) {
    failure ??= error;
  }
  if (failure) throw failure;
}

/**
 * Opens a package-private, profile-local semantic thread index.
 *
 * This deliberately requests zvec only. Callers must feature-detect
 * `sdk.storage.profile` and `sdk.embeddings` before invoking it.
 */
export async function openEmailSemanticIndex(
  profileStorage: MiniAppPrivateStorageApi,
  embeddings: MiniAppEmbeddingsApi,
  options: EmailSemanticIndexOptions = {},
): Promise<EmailSemanticIndex> {
  const model = await chooseModel(embeddings, options.model);
  const maximumBytes = Math.min(
    options.maxTextBytes ?? MAX_EMBEDDING_TEXT_BYTES,
    model.capabilities.maxInputBytes ?? Number.POSITIVE_INFINITY,
  );
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 256) {
    throw new Error('Semantic email maxTextBytes must be an integer of at least 256 bytes.');
  }

  const calibration = await embeddings.embed({
    model: model.id,
    revision: model.revision,
    inputs: [{ kind: 'text', text: 'TAP Email semantic thread index' }],
    role: 'document',
  });
  const calibrationVector = calibration.vectors[0];
  assertVector(calibrationVector, calibration.binding);
  if (calibration.vectors.length !== 1) {
    throw new Error('The embedding provider returned an invalid calibration result.');
  }

  const collectionName = collectionNameFor(
    options.collectionPrefix ?? DEFAULT_COLLECTION_PREFIX,
    calibration.binding,
  );
  const storage = await profileStorage.open({
    filesRead: false,
    filesWrite: false,
    sqlite: false,
    zvec: true,
  });
  let collection: MiniAppPrivateZvecCollection;
  try {
    collection = await storage.zvec.open(collectionName, schemaFor(calibration.binding));
  } catch (error) {
    await storage.close();
    throw error;
  }
  const storedBinding = collection.bindings[EMBEDDING_FIELD];
  if (!storedBinding || !sameBinding(storedBinding, calibration.binding)) {
    await closeBoth(collection, storage);
    throw new Error('The semantic email collection is bound to a different embedding space.');
  }

  let closed = false;
  const ensureOpen = () => {
    if (closed) throw new Error('The semantic email index is closed.');
  };
  const embed = async (texts: readonly string[], role: 'query' | 'document') => {
    const result = await embeddings.embed({
      model: model.id,
      revision: model.revision,
      inputs: texts.map(text => ({ kind: 'text' as const, text: truncateUtf8(text, maximumBytes) })),
      role,
    });
    if (!sameBinding(result.binding, calibration.binding) || result.vectors.length !== texts.length) {
      throw new Error('The embedding provider changed embedding space or returned the wrong vector count.');
    }
    for (const vector of result.vectors) assertVector(vector, calibration.binding);
    return result.vectors;
  };

  return {
    capability: 'private-profile-zvec',
    collectionName,
    binding: calibration.binding,

    async indexThreads(inputThreads) {
      ensureOpen();
      const unique = [...new Map(inputThreads.map(thread => [documentKey(thread), thread])).values()];
      const existingRevision = new Map<string, string>();
      for (let offset = 0; offset < unique.length; offset += FETCH_BATCH_SIZE) {
        const keys = unique.slice(offset, offset + FETCH_BATCH_SIZE).map(documentKey);
        if (keys.length === 0) continue;
        for (const result of await collection.fetch(keys)) {
          const revision = result.fields.source_revision;
          if (typeof revision === 'string') existingRevision.set(result.pk, revision);
        }
      }
      const changed = unique.filter(thread =>
        existingRevision.get(documentKey(thread)) !== hashSource(thread));
      const batchSize = Math.max(1, model.capabilities.maxInputs);
      for (let offset = 0; offset < changed.length; offset += batchSize) {
        const batch = changed.slice(offset, offset + batchSize);
        const vectors = await embed(batch.map(semanticText), 'document');
        const result = await collection.upsert(batch.map((thread, index) => ({
          pk: documentKey(thread),
          fields: {
            account_id: thread.accountId,
            thread_id: thread.threadId,
            source_revision: hashSource(thread),
            subject: thread.subject,
            snippet: thread.snippet,
            received_at: thread.receivedAt,
            unread: thread.unread,
            starred: thread.starred,
            critical: thread.critical,
            needs_response: thread.needsResponse,
            waiting_on_others: thread.waitingOnOthers,
            status: thread.status,
            labels: [...thread.labels],
            embedding: vectors[index]!,
          },
        })));
        mutationFailures('upsert', batch.length, result.writeResults);
      }
      const stats = changed.length > 0 ? await collection.flush() : await collection.stats();
      return {
        indexedCount: changed.length,
        skippedCount: unique.length - changed.length,
        stats,
      };
    },

    async deleteThreads(threads) {
      ensureOpen();
      const keys = [...new Set(threads.map(documentKey))];
      if (keys.length === 0) return 0;
      let deleted = 0;
      for (let offset = 0; offset < keys.length; offset += FETCH_BATCH_SIZE) {
        const batch = keys.slice(offset, offset + FETCH_BATCH_SIZE);
        const result = await collection.delete({ pks: batch });
        mutationFailures('delete', batch.length, result.writeResults);
        deleted += result.affectedCount ?? batch.length;
      }
      await collection.flush();
      return deleted;
    },

    async search(rawQuery, searchOptions = {}) {
      ensureOpen();
      const query = rawQuery.trim();
      if (!query) return [];
      const topK = searchOptions.topK ?? 20;
      if (!Number.isInteger(topK) || topK < 1 || topK > 1_000) {
        throw new Error('Semantic email topK must be an integer from 1 to 1000.');
      }
      const [vector] = await embed([query], 'query');
      assertVector(vector, calibration.binding);
      const results = await collection.query({
        fieldName: EMBEDDING_FIELD,
        vector,
        topK,
        filter: filterFor(searchOptions),
        outputFields: [
          'account_id',
          'thread_id',
          'subject',
          'snippet',
          'received_at',
          'unread',
          'starred',
          'critical',
          'needs_response',
          'waiting_on_others',
          'status',
          'labels',
        ],
      });
      return results.flatMap(result => {
        const fields = result.fields as Readonly<Record<string, unknown>>;
        const accountId = stringField(fields, 'account_id');
        const threadId = stringField(fields, 'thread_id');
        const status = stringField(fields, 'status');
        if (!accountId || !threadId ||
            !['inbox', 'done', 'reminded', 'trashed'].includes(status)) return [];
        return [{
          score: result.score,
          threadKey: emailThreadKey({ accountId, threadId }),
          accountId,
          threadId,
          subject: stringField(fields, 'subject'),
          snippet: stringField(fields, 'snippet'),
          receivedAt: stringField(fields, 'received_at'),
          unread: booleanField(fields, 'unread'),
          starred: booleanField(fields, 'starred'),
          critical: booleanField(fields, 'critical'),
          needsResponse: booleanField(fields, 'needs_response'),
          waitingOnOthers: booleanField(fields, 'waiting_on_others'),
          status: status as ThreadStatus,
          labels: labelsField(fields),
        }];
      });
    },

    async stats() {
      ensureOpen();
      return collection.stats();
    },

    async close() {
      if (closed) return;
      closed = true;
      await closeBoth(collection, storage);
    },
  };
}
