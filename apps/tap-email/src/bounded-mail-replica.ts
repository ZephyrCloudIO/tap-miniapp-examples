import { semanticSourceRevision } from './semantic-email-index';
import type { MiniAppPrivateSqlTransaction, MiniAppSqlMigration, MiniAppSqlValue } from '@theaiplatform/miniapp-sdk/sdk';
import {
  emptyMailState, emailThreadKey, isMailState, projectedThreads, mailboxSummary,
  threadMatchesSplit, type EmailThread, type MailboxSnapshot, type MailState,
} from './domain';
import { filterMailThreads, type MailSearchContext } from './mail-search';
import { insertBoundedRows, recordParts, serializedBytes } from './bounded-sql';
import { replaceNormalizedLocalReplica, type LocalReplicaStatistics } from './local-replica';
import type { MailboxSummary } from '@tap-examples/tap-email-protocol';
import { queueSemanticChanges } from './semantic-index-queue';

export const mailWindowSize = 100;
export const memoryBodyBudgetBytes = 8 * 1024 * 1024;
export const diskBodyBudgetBytes = 32 * 1024 * 1024;
const recordColumns = ['kind', 'account_id', 'thread_id', 'entity_id', 'part', 'payload'] as const;
type Table = 'local_mail_records' | 'local_mail_journal';
type Sql = Pick<MiniAppPrivateSqlTransaction, 'query' | 'execute'>;

export const boundedReplicaMigrations = [
  ...(['local_mail_records', 'local_mail_journal'] as const).map((table, index) => ({
    version: 22 + index,
    sql: `CREATE TABLE IF NOT EXISTS ${table} (
      kind TEXT NOT NULL, account_id TEXT NOT NULL, thread_id TEXT NOT NULL,
      entity_id TEXT NOT NULL, part INTEGER NOT NULL, payload TEXT NOT NULL,
      PRIMARY KEY (kind, account_id, thread_id, entity_id, part)
    )`,
  })),
  { version: 24, sql: `CREATE TABLE IF NOT EXISTS local_mail_bodies (
    account_id TEXT NOT NULL, thread_id TEXT NOT NULL, provider_revision TEXT NOT NULL,
    bytes INTEGER NOT NULL, last_accessed_at INTEGER NOT NULL,
    PRIMARY KEY (account_id, thread_id)
  )` },
  { version: 25, sql: `CREATE TABLE IF NOT EXISTS local_mail_sync (
    id INTEGER PRIMARY KEY CHECK (id = 1), generation TEXT NOT NULL,
    next_cursor TEXT, pages_loaded INTEGER NOT NULL, threads_loaded INTEGER NOT NULL,
    complete INTEGER NOT NULL, updated_at TEXT NOT NULL
  )` },
  { version: 26, sql: `CREATE INDEX IF NOT EXISTS local_mail_window_idx
    ON local_mail_threads(received_at DESC, account_id, thread_id)` },
  { version: 27, sql: `CREATE INDEX IF NOT EXISTS local_mail_bodies_lru_idx
    ON local_mail_bodies(last_accessed_at, account_id, thread_id)` },
  { version: 28, sql: 'ALTER TABLE local_mail_threads ADD COLUMN reminder_due_at TEXT' },
  { version: 29, sql: `CREATE TABLE IF NOT EXISTS local_mail_versions (
    account_id TEXT NOT NULL, thread_id TEXT NOT NULL, revision INTEGER NOT NULL,
    present INTEGER NOT NULL, bootstrap TEXT, PRIMARY KEY (account_id, thread_id)
  )` },
  { version: 30, sql: `CREATE TABLE IF NOT EXISTS local_mail_semantic_changes (
    account_id TEXT NOT NULL, thread_id TEXT NOT NULL, token TEXT NOT NULL,
    PRIMARY KEY (account_id, thread_id)
  )` },
] satisfies readonly MiniAppSqlMigration[];

interface RecordWrite { readonly kind: string; readonly accountId: string; readonly threadId: string; readonly entityId: string; readonly value: unknown }

async function writeRecords(tx: MiniAppPrivateSqlTransaction, table: Table, records: readonly RecordWrite[]): Promise<void> {
  for (let offset = 0; offset < records.length; offset += 100) {
    const batch = records.slice(offset, offset + 100);
    // A flat row-value set avoids an OR tree deeper than TAP's SQLite limit.
    await tx.execute(`DELETE FROM ${table} WHERE (kind, account_id, thread_id, entity_id) IN (VALUES ${batch.map(() => '(?, ?, ?, ?)').join(', ')})`,
      batch.flatMap(record => [record.kind, record.accountId, record.threadId, record.entityId]));
  }
  function* rows() {
    for (const record of records) {
      let part = 0;
      for (const payload of recordParts(record.value)) yield [record.kind, record.accountId, record.threadId, record.entityId, part++, payload];
    }
  }
  await insertBoundedRows(tx, table, recordColumns, rows());
}

export async function writeRecord(tx: MiniAppPrivateSqlTransaction, table: Table, kind: string,
  accountId: string, threadId: string, entityId: string, value: unknown): Promise<void> {
  await writeRecords(tx, table, [{ kind, accountId, threadId, entityId, value }]);
}

export async function readRecord<T>(sql: Sql, table: Table, kind: string,
  accountId = '', threadId = '', entityId = ''): Promise<T | null> {
  let value = '';
  let part = 0;
  // Bound responses too: a large draft/body must not return as a single SQLite row or host response.
  while (true) {
    const result = await sql.query(`SELECT part, payload FROM ${table}
      WHERE kind = ? AND account_id = ? AND thread_id = ? AND entity_id = ? AND part >= ? ORDER BY part LIMIT 4`,
    [kind, accountId, threadId, entityId, part]);
    for (const row of result.rows) {
      if (row[0] !== part || typeof row[1] !== 'string') throw new Error('Incomplete local mail record.');
      value += row[1];
      part += 1;
    }
    if (result.rows.length < 4) break;
  }
  return part ? JSON.parse(value) as T : null;
}

export type MailJournal = Pick<MailState, 'commands' | 'pendingThreadIntents' | 'outbox' | 'undo'>;
export const journalOf = (state: MailJournal): MailJournal => ({
  commands: state.commands, pendingThreadIntents: state.pendingThreadIntents, outbox: state.outbox,
  undo: state.undo && state.undo.kind !== 'send'
    ? { ...state.undo, thread: withoutBodies(state.undo.thread) } : state.undo,
});

export async function writeJournal(tx: MiniAppPrivateSqlTransaction, state: MailJournal): Promise<void> {
  // One transaction owns the command set and its recovery/receipt data. Chunking is
  // transport-only: no partial command is visible if any request or commit fails.
  await tx.execute('DELETE FROM local_mail_journal');
  for (const command of state.commands) {
    await writeRecord(tx, 'local_mail_journal', 'command', command.accountId, '', command.commandId, command);
  }
  for (const item of state.outbox ?? []) {
    const origin = item.attempts[0]!.command;
    await writeRecord(tx, 'local_mail_journal', 'outbox', origin.accountId, '', origin.commandId, item);
  }
  for (const intent of state.pendingThreadIntents ?? []) {
    await writeRecord(tx, 'local_mail_journal', 'intent', intent.accountId, '', intent.commandId, intent);
  }
  await writeRecord(tx, 'local_mail_journal', 'control', '', '', '', {
    undo: state.undo,
    hasOutbox: state.outbox !== undefined,
    hasIntents: state.pendingThreadIntents !== undefined,
    // Ordering is part of replay semantics and must survive SQLite key ordering.
    commands: state.commands.map(item => [item.accountId, item.commandId]),
    outbox: (state.outbox ?? []).map(item => [item.attempts[0]!.command.accountId, item.attempts[0]!.command.commandId]),
    intents: (state.pendingThreadIntents ?? []).map(item => [item.accountId, item.commandId]),
  });
}

export async function readJournal(sql: Sql): Promise<MailJournal | null> {
  const control = await readRecord<{
    undo: MailState['undo']; hasOutbox: boolean; hasIntents: boolean;
    commands: string[][]; outbox: string[][]; intents: string[][];
  }>(sql, 'local_mail_journal', 'control');
  if (!control) return null;
  async function records<T>(kind: string, ids: string[][]): Promise<T[]> {
    const result: T[] = [];
    for (const [accountId, id] of ids) {
      const item = await readRecord<T>(sql, 'local_mail_journal', kind, accountId, '', id);
      if (!item) throw new Error('The local command journal is incomplete.');
      result.push(item);
    }
    return result;
  }
  return {
    commands: await records('command', control.commands),
    ...(control.hasOutbox ? { outbox: await records<NonNullable<MailState['outbox']>[number]>('outbox', control.outbox) } : {}),
    ...(control.hasIntents ? { pendingThreadIntents: await records<NonNullable<MailState['pendingThreadIntents']>[number]>('intent', control.intents) } : {}),
    undo: control.undo,
  };
}

export function withoutBodies(thread: EmailThread): EmailThread {
  return { ...thread, messages: thread.messages.map(({ bodyHtml: _html, ...message }) => ({ ...message, bodyText: '' })) };
}

export function boundMailWindow(state: MailState, limit = mailWindowSize): MailState {
  let bytes = 0;
  const selected = state.threads.find(thread => emailThreadKey(thread) === state.selectedThreadKey);
  // Visit the selected body first, so reading a thread touches its memory LRU.
  const recent = selected ? [selected, ...state.threads.filter(thread => thread !== selected)] : state.threads;
  const retained = new Map<string, EmailThread>();
  for (const thread of recent.slice(0, limit + (selected ? 1 : 0))) {
    const size = serializedBytes(thread.messages);
    const keep = bytes + size <= memoryBodyBudgetBytes;
    if (keep) bytes += size;
    retained.set(emailThreadKey(thread), keep ? thread : withoutBodies(thread));
  }
  return { ...state, threads: state.threads.flatMap(thread => {
    const value = retained.get(emailThreadKey(thread));
    return value ? [value] : [];
  }) };
}

export async function writeReplicaThreads(tx: MiniAppPrivateSqlTransaction, state: MailboxSnapshot,
  updatedAt: string, rememberBodies = true, localChangesOnly = false): Promise<void> {
  const accounts = localChangesOnly && await readRecord(tx, 'local_mail_records', 'revision') ? [] : state.accounts;
  const records: RecordWrite[] = accounts.map(account => ({ kind: 'account', accountId: account.accountId,
    threadId: '', entityId: '', value: account }));
  const threads: EmailThread[] = [];
  const bodies: (string | number)[][] = [];
  const previousThreads = await readThreads(tx, state.threads);
  for (const incoming of state.threads) {
    const previous = previousThreads.get(emailThreadKey(incoming));
    if (localChangesOnly && !previous) {
      const version = await tx.query('SELECT present FROM local_mail_versions WHERE account_id = ? AND thread_id = ?',
        [incoming.accountId, incoming.threadId]);
      if (version.rows[0]?.[0] === 0) continue;
    }
    // A delayed UI save cannot replace a newer provider page with an older revision.
    const stale = localChangesOnly && previous && (previous.providerRevision !== incoming.providerRevision ||
      (previous as EmailThread & { localReplicaRevision?: number }).localReplicaRevision !==
      (incoming as EmailThread & { localReplicaRevision?: number }).localReplicaRevision);
    const source = stale ? previous : incoming;
    const messageMap = new Map(previous?.messages.map(message => [message.messageId, message]));
    for (const message of source.messages) {
      const cached = messageMap.get(message.messageId);
      // A metadata page cannot demote content already read at this revision.
      // A changed provider revision may intentionally invalidate that content.
      const preservePreview = previous?.providerRevision === source.providerRevision &&
        !message.bodyText && !message.bodyHtml && cached?.bodyText;
      messageMap.set(message.messageId, preservePreview
        ? { ...message, bodyText: cached.bodyText }
        : message);
    }
    const correction = !previous?.attentionCorrection ||
      (incoming.attentionCorrection && incoming.attentionCorrection.correctedAt > previous.attentionCorrection.correctedAt)
      ? incoming.attentionCorrection : previous.attentionCorrection;
    const thread: EmailThread = { ...source, ...(correction ? { attentionCorrection: correction } : {}),
      messages: [...messageMap.values()].sort((a, b) => a.sentAt.localeCompare(b.sentAt)) };
    threads.push(thread);
    const { messages, ...metadata } = thread;
    records.push({ kind: 'thread', accountId: thread.accountId, threadId: thread.threadId, entityId: '',
      value: { ...metadata, messageIds: messages.map(message => message.messageId) } });
    for (const message of messages) {
      const { bodyHtml: _html, ...rest } = message;
      records.push({ kind: 'message', accountId: thread.accountId, threadId: thread.threadId, entityId: message.messageId,
        // Keep the searchable provider preview independently of hydrated bodies.
        value: { ...rest, bodyText: message.bodyText.slice(0, 8000) } });
    }
    if (rememberBodies && !stale && incoming.messages.some(message => message.bodyText || message.bodyHtml)) {
      const bytes = serializedBytes(incoming.messages);
      if (bytes <= memoryBodyBudgetBytes) {
        records.push({ kind: 'body', accountId: thread.accountId, threadId: thread.threadId, entityId: '', value: incoming.messages });
        bodies.push([thread.accountId, thread.threadId, thread.providerRevision, bytes, Date.parse(updatedAt)]);
      }
    }
  }
  await writeRecords(tx, 'local_mail_records', records);
  await insertBoundedRows(tx, 'local_mail_bodies',
    ['account_id', 'thread_id', 'provider_revision', 'bytes', 'last_accessed_at'], bodies);
  await replaceNormalizedLocalReplica(tx, { ...emptyMailState(), accounts,
    threads: projectedThreads({ ...emptyMailState(), threads }) }, updatedAt, updatedAt, true);
  await queueSemanticChanges(tx, threads.filter(thread => {
    const previous = previousThreads.get(emailThreadKey(thread));
    const stored = { ...thread, messages: thread.messages.map(message => ({ ...message, bodyText: message.bodyText.slice(0, 8000) })) };
    return !previous || semanticSourceRevision(previous) !== semanticSourceRevision(stored);
  }));
  await evictBodies(tx);
}

async function evictBodies(tx: MiniAppPrivateSqlTransaction): Promise<void> {
  const total = await tx.query('SELECT COALESCE(SUM(bytes), 0) FROM local_mail_bodies');
  let bytes = Number(total.rows[0]?.[0] ?? 0);
  while (bytes > diskBodyBudgetBytes) {
    const oldest = await tx.query('SELECT account_id, thread_id, bytes FROM local_mail_bodies ORDER BY last_accessed_at, account_id, thread_id LIMIT 1');
    if (!oldest.rows.length) break;
    const [accountId, threadId, size] = oldest.rows[0]!;
    await tx.execute("DELETE FROM local_mail_records WHERE kind = 'body' AND account_id = ? AND thread_id = ?", [accountId!, threadId!]);
    await tx.execute('DELETE FROM local_mail_bodies WHERE account_id = ? AND thread_id = ?', [accountId!, threadId!]);
    bytes -= Number(size);
  }
}

/** Read metadata in bounded batches instead of one host round trip per message.
 * 64 parts are at most 4 MiB of escaped payload, below the host response limit.
 * The caller holds the store queue, so record parts cannot change mid-read.
 */
export async function readThreads(sql: Sql, identities: readonly { accountId: string; threadId: string }[],
  signal?: AbortSignal): Promise<Map<string, EmailThread>> {
  const threads = new Map<string, EmailThread>();
  for (let offset = 0; offset < identities.length; offset += 100) {
    const batch = identities.slice(offset, offset + 100);
    const records = new Map<string, { kind: string; accountId: string; threadId: string; entityId: string; parts: string[] }>();
    let after: MiniAppSqlValue[] | null = null;
    while (true) {
      signal?.throwIfAborted();
      const result = await sql.query(`SELECT kind, account_id, thread_id, entity_id, part, payload
        FROM local_mail_records WHERE kind IN ('thread', 'message')
        AND (account_id, thread_id) IN (VALUES ${batch.map(() => '(?, ?)').join(', ')})
        ${after ? 'AND (kind, account_id, thread_id, entity_id, part) > (?, ?, ?, ?, ?)' : ''}
        ORDER BY kind, account_id, thread_id, entity_id, part LIMIT 64`,
      [...batch.flatMap(item => [item.accountId, item.threadId]), ...(after ?? [])]);
      for (const [kind, accountId, threadId, entityId, part, payload] of result.rows) {
        const key = JSON.stringify([kind, accountId, threadId, entityId]);
        let record = records.get(key);
        if (!record) {
          record = { kind: String(kind), accountId: String(accountId), threadId: String(threadId), entityId: String(entityId), parts: [] };
          records.set(key, record);
        }
        if (part !== record.parts.length || typeof payload !== 'string') throw new Error('Incomplete local mail record.');
        record.parts.push(payload);
      }
      if (result.rows.length < 64) break;
      after = result.rows.at(-1)!.slice(0, 5);
    }
    const messages = new Map<string, EmailThread['messages'][number]>();
    for (const record of records.values()) if (record.kind === 'message') {
      messages.set(JSON.stringify([record.accountId, record.threadId, record.entityId]), JSON.parse(record.parts.join('')));
    }
    for (const record of records.values()) if (record.kind === 'thread') {
      const { messageIds, ...metadata } = JSON.parse(record.parts.join('')) as Omit<EmailThread, 'messages'> & { messageIds: string[] };
      threads.set(emailThreadKey(metadata), { ...metadata, messages: messageIds.map(id => {
        const message = messages.get(JSON.stringify([record.accountId, record.threadId, id]));
        if (!message) throw new Error('The local mail message record is incomplete.');
        return message;
      }) });
    }
  }
  return threads;
}

export async function readThread(sql: Sql, accountId: string, threadId: string, bodies: boolean, signal?: AbortSignal): Promise<EmailThread | null> {
  const thread = (await readThreads(sql, [{ accountId, threadId }], signal)).get(emailThreadKey({ accountId, threadId }));
  if (!thread) return null;
  const { messages, ...metadata } = thread;
  if (bodies) {
    const cached = await sql.query('SELECT provider_revision FROM local_mail_bodies WHERE account_id = ? AND thread_id = ?', [accountId, threadId]);
    if (cached.rows[0]?.[0] === metadata.providerRevision) {
      const hydrated = await readRecord<EmailThread['messages']>(sql, 'local_mail_records', 'body', accountId, threadId);
      if (hydrated) {
        signal?.throwIfAborted();
        await sql.execute('UPDATE local_mail_bodies SET last_accessed_at = ? WHERE account_id = ? AND thread_id = ?', [Date.now(), accountId, threadId]);
        return { ...metadata, messages: hydrated };
      }
    }
  }
  return { ...metadata, messages };
}

export interface MailWindowCursor { readonly receivedAt: string; readonly accountId: string; readonly threadId: string }
export interface MailWindowQuery {
  readonly accountId?: string;
  readonly split?: MailState['selectedSplit'];
  readonly query?: string;
  readonly context?: MailSearchContext;
  readonly after?: MailWindowCursor | null;
  readonly signal?: AbortSignal;
  readonly bodies?: boolean;
  readonly limit?: number;
  /** Cumulative rows, delivered before the rest of the page or lookahead finishes. */
  readonly onProgress?: (threads: readonly EmailThread[]) => void;
  /** Current UI overlays need not wait for their durable journal write to display. */
  readonly journal?: MailJournal;
  readonly localThreads?: readonly EmailThread[];
}
export interface MailWindow { readonly threads: readonly EmailThread[]; readonly next: MailWindowCursor | null }

export async function queryMailWindow(sql: Sql, options: MailWindowQuery, journal?: MailJournal | null): Promise<MailWindow> {
  let cursor = options.after ?? null;
  const threads: EmailThread[] = [];
  let bodyBytes = 0;
  const limit = Math.max(1, Math.min(mailWindowSize, options.limit ?? mailWindowSize));
  const split = options.query?.trim() ? undefined : options.split;
  const resource = split === 'sent' || split === 'drafts' || split === 'spam' || split === 'inbox' || split === 'starred' || split === 'trash' ? split : null;
  const localThreads = new Map(options.localThreads?.map(thread => [emailThreadKey(thread), thread]));
  const resourceOverrides = new Set([...localThreads.keys(), ...(journal?.pendingThreadIntents ?? [])
    .filter(intent => !options.accountId || options.accountId === 'all' || intent.accountId === options.accountId)
    .map(emailThreadKey)]);
  const resourceExists = `EXISTS (SELECT 1 FROM local_mail_thread_resources AS resource
    WHERE resource.account_id = thread.account_id AND resource.thread_id = thread.thread_id
      AND resource.resource_kind = ?)`;
  // These are conservative candidates; projected threadMatchesSplit remains the
  // authority (including legacy threads without provider resources and overlays).
  const resourceMatch = resource
    ? `(${resourceExists}${split === 'inbox' ? " OR status = 'inbox'" : split === 'starred' ? ' OR starred = 1' : split === 'trash' ? " OR status = 'trashed'" : ''})`
    : split === 'done' ? "status = 'done'"
    : split === 'reminders' ? "status = 'reminded'"
    : split === 'critical' ? "status = 'inbox' AND critical = 1"
    : split === 'needs-response' ? "status = 'inbox' AND needs_response = 1"
    : split === 'waiting' ? "status = 'inbox' AND waiting_on_others = 1"
    : split ? '0' : '1';
  const overrides = split ? [...resourceOverrides].map(key => key.split('\0')) : [];
  const overrideBatches = Array.from({ length: Math.max(1, Math.ceil(overrides.length / 400)) }, (_, index) => overrides.slice(index * 400, index * 400 + 400));
  while (true) {
    options.signal?.throwIfAborted();
    const candidatesByKey = new Map<string, readonly MiniAppSqlValue[]>();
    for (const batch of overrideBatches) {
      options.signal?.throwIfAborted();
      const result = await sql.query(`WITH candidates AS (
        SELECT account_id, thread_id, received_at, ${resourceMatch} AS resource_match
        FROM local_mail_threads AS thread
        WHERE (? = 'all' OR account_id = ?) AND (? IS NULL OR received_at < ? OR
          (received_at = ? AND (account_id > ? OR (account_id = ? AND thread_id > ?)))))
        SELECT account_id, thread_id, received_at, resource_match FROM candidates
        WHERE resource_match = 1 ${batch.length ? `OR (account_id, thread_id) IN (VALUES ${batch.map(() => '(?, ?)').join(', ')})` : ''}
        ORDER BY received_at DESC, account_id, thread_id LIMIT 100`,
      [...(resource ? [resource] : []), options.accountId ?? 'all', options.accountId ?? 'all', cursor?.receivedAt ?? null,
        cursor?.receivedAt ?? null, cursor?.receivedAt ?? null, cursor?.accountId ?? null, cursor?.accountId ?? null, cursor?.threadId ?? null,
        ...batch.flat()]);
      for (const row of result.rows) candidatesByKey.set(emailThreadKey({ accountId: String(row[0]), threadId: String(row[1]) }), row);
    }
    // Each bounded override query contains the same provider matches plus its
    // own local edits. Merge their top 100 with SQLite's binary key ordering.
    const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
    const result = { rows: [...candidatesByKey.values()].sort((a, b) =>
      compare(String(b[2]), String(a[2])) || compare(String(a[0]), String(b[0])) || compare(String(a[1]), String(b[1]))).slice(0, 100) };
    for (let offset = 0; offset < result.rows.length; offset += 20) {
      const previousCount = threads.length;
      const batch = result.rows.slice(offset, offset + 20);
      const candidates = batch.filter(([accountId, threadId, , matchesResource]) =>
        Number(matchesResource) === 1 || resourceOverrides.has(emailThreadKey({ accountId: String(accountId), threadId: String(threadId) })));
      const records = await readThreads(sql, candidates.map(([accountId, threadId]) => ({ accountId: String(accountId), threadId: String(threadId) })), options.signal);
      for (const [accountId, threadId, receivedAt] of batch) {
        options.signal?.throwIfAborted();
        const next = { accountId: String(accountId), threadId: String(threadId), receivedAt: String(receivedAt) };
        let thread = records.get(emailThreadKey(next));
        if (!thread) {
          if (candidates.some(row => row[0] === accountId && row[1] === threadId)) throw new Error('The local mail thread record is incomplete.');
          cursor = next;
          continue;
        }
        const local = localThreads.get(emailThreadKey(thread));
        if (local?.providerRevision === thread.providerRevision &&
          (local as EmailThread & { localReplicaRevision?: number }).localReplicaRevision ===
          (thread as EmailThread & { localReplicaRevision?: number }).localReplicaRevision) thread = local;
        else if (local?.attentionCorrection && (!thread.attentionCorrection ||
          local.attentionCorrection.correctedAt > thread.attentionCorrection.correctedAt)) {
          thread = { ...thread, attentionCorrection: local.attentionCorrection };
        }
        const projected = journal ? projectedThreads({ ...emptyMailState(), ...journal, threads: [thread] })[0]! : thread;
        const matches = (options.query?.trim() || !options.split || threadMatchesSplit(projected, options.split)) &&
          filterMailThreads([projected], options.query ?? '', options.context ?? { now: new Date(), timeZone: 'UTC' }).length > 0;
        if (matches) {
          if (threads.length === limit) return { threads, next: cursor };
          if (options.bodies && bodyBytes < memoryBodyBudgetBytes) {
            const hydrated = await readThread(sql, next.accountId, next.threadId, true);
            if (hydrated && bodyBytes + serializedBytes(hydrated.messages) <= memoryBodyBudgetBytes) thread = hydrated;
          }
          const bytes = serializedBytes(thread.messages);
          if (bodyBytes + bytes <= memoryBodyBudgetBytes) bodyBytes += bytes;
          else thread = withoutBodies(thread);
          threads.push(thread);
        }
        cursor = next;
      }
      if (threads.length > previousCount) options.onProgress?.([...threads]);
    }
    if (result.rows.length < 100) return { threads, next: null };
  }
}

export interface MailboxSyncCheckpoint {
  readonly generation: string;
  readonly nextCursor: string | null;
  readonly pagesLoaded: number;
  readonly threadsLoaded: number;
  readonly complete: boolean;
  readonly updatedAt: string;
}
export async function readSync(sql: Sql): Promise<MailboxSyncCheckpoint | null> {
  const result = await sql.query('SELECT generation, next_cursor, pages_loaded, threads_loaded, complete, updated_at FROM local_mail_sync WHERE id = 1');
  const row = result.rows[0];
  return row ? { generation: String(row[0]), nextCursor: row[1] as string | null, pagesLoaded: Number(row[2]),
    threadsLoaded: Number(row[3]), complete: Boolean(row[4]), updatedAt: String(row[5]) } : null;
}
export async function writeSync(tx: MiniAppPrivateSqlTransaction, checkpoint: MailboxSyncCheckpoint): Promise<void> {
  await insertBoundedRows(tx, 'local_mail_sync', ['id', 'generation', 'next_cursor', 'pages_loaded', 'threads_loaded', 'complete', 'updated_at'],
    [[1, checkpoint.generation, checkpoint.nextCursor, checkpoint.pagesLoaded, checkpoint.threadsLoaded, Number(checkpoint.complete), checkpoint.updatedAt]]);
}

export async function readReplicaState(sql: Sql, initialWindow = false): Promise<MailState | null> {
  const ui = await readRecord<Omit<MailState, 'threads' | 'accounts' | keyof MailJournal>>(sql, 'local_mail_records', 'ui');
  const journal = await readJournal(sql);
  if (!ui && !journal) return null;
  const accounts = await readReplicaAccounts(sql);
  const { pendingThreadIntents: _intents, outbox: _outbox, ...base } = emptyMailState();
  const state = { ...base, ...ui, ...journal, accounts,
    threads: (await queryMailWindow(sql, initialWindow
      ? { accountId: ui?.selectedAccountId, split: ui?.selectedSplit, limit: 20 } : { bodies: true }, journal)).threads };
  if (!isMailState(state)) throw new Error('The local mail replica is malformed.');
  return state;
}

export async function writeReplicaUi(tx: MiniAppPrivateSqlTransaction, state: MailState): Promise<void> {
  const { accounts: _accounts, threads: _threads, commands: _commands, pendingThreadIntents: _intents,
    outbox: _outbox, undo: _undo, ...ui } = state;
  await writeRecord(tx, 'local_mail_records', 'ui', '', '', '', ui);
}

export async function readReplicaAccounts(sql: Sql): Promise<MailState['accounts']> {
  const accounts: MailState['accounts'][number][] = [];
  const ids = await sql.query("SELECT DISTINCT account_id FROM local_mail_records WHERE kind = 'account' ORDER BY account_id");
  for (const row of ids.rows) {
    const account = await readRecord<MailState['accounts'][number]>(sql, 'local_mail_records', 'account', String(row[0]));
    if (account) accounts.push(account);
  }
  return accounts;
}

export async function replicaStatistics(sql: Sql, accountId?: string): Promise<LocalReplicaStatistics> {
  const accounts = (await readReplicaAccounts(sql)).filter(account => !accountId || account.accountId === accountId);
  async function count(table: string, id?: string): Promise<number> {
    const result = await sql.query(`SELECT COUNT(*) FROM ${table}${id ? ' WHERE account_id = ?' : ''}`, id ? [id] : []);
    return Number(result.rows[0]?.[0] ?? 0);
  }
  const counts = {
    accounts: accounts.length,
    threads: await count('local_mail_threads', accountId),
    messages: await count('local_mail_messages', accountId),
    participants: await count('local_mail_thread_participants', accountId) + await count('local_mail_message_participants', accountId),
    resources: await count('local_mail_thread_resources', accountId),
    labels: await count('local_mail_thread_labels', accountId),
    attachmentMetadata: await count('local_mail_attachment_metadata', accountId),
  };
  const bytes = await sql.query(`SELECT COALESCE(SUM(length(CAST(payload AS BLOB))), 0) FROM local_mail_records WHERE kind IN ('account', 'thread', 'message')${accountId ? ' AND account_id = ?' : ''}`, accountId ? [accountId] : []);
  const coverage: LocalReplicaStatistics['accounts'][number][] = [];
  for (const account of accounts) {
    const resources = await sql.query('SELECT DISTINCT resource_kind FROM local_mail_thread_resources WHERE account_id = ? ORDER BY resource_kind', [account.accountId]);
    coverage.push({ accountId: account.accountId, provider: account.provider, state: account.coverage.state,
      observedAt: account.coverage.observedAt, indexedThrough: account.coverage.backfillCompleteThrough,
      unresolvedFailures: account.coverage.unresolvedFailures,
      resourceKinds: resources.rows.map(row => row[0] as NonNullable<EmailThread['providerResources']>[number]),
      counts: { threads: await count('local_mail_threads', account.accountId), messages: await count('local_mail_messages', account.accountId),
        attachmentMetadata: await count('local_mail_attachment_metadata', account.accountId) } });
  }
  return { counts, logicalBytes: Number(bytes.rows[0]?.[0] ?? 0), accounts: coverage };
}

export async function summarizeReplica(sql: Sql, now: string, accountId = 'all', liveJournal?: MailJournal): Promise<MailboxSummary> {
  const journal = liveJournal ?? await readJournal(sql);
  const base = { ...emptyMailState(), accounts: (await readReplicaAccounts(sql)).filter(account => accountId === 'all' || account.accountId === accountId) };
  const summary = mailboxSummary({ ...base, ...journal }, now);
  const totals = await sql.query(`SELECT
    COALESCE(SUM(status = 'inbox'), 0),
    COALESCE(SUM(status = 'inbox' AND critical = 1), 0),
    COALESCE(SUM(status = 'inbox' AND needs_response = 1), 0),
    COALESCE(SUM(status = 'inbox' AND waiting_on_others = 1), 0),
    COALESCE(SUM(status = 'reminded' AND reminder_due_at <= ?), 0)
    FROM local_mail_threads WHERE (? = 'all' OR account_id = ?)`, [now, accountId, accountId]);
  const counts = totals.rows[0]?.map(Number) ?? [0, 0, 0, 0, 0];
  const seen = new Set<string>();
  for (const intent of journal?.pendingThreadIntents ?? []) {
    if (accountId !== 'all' && intent.accountId !== accountId) continue;
    const key = emailThreadKey(intent);
    if (seen.has(key)) continue;
    seen.add(key);
    const thread = await readThread(sql, intent.accountId, intent.threadId, false);
    if (!thread) continue;
    const before = mailboxSummary({ ...base, threads: [thread] }, now);
    const after = mailboxSummary({ ...base, ...journal, threads: [thread] }, now);
    (['inbox', 'critical', 'needsResponse', 'waiting', 'dueReminders'] as const).forEach((field, i) => {
      counts[i] = counts[i]! + after[field] - before[field];
    });
  }
  const [inbox, critical, needsResponse, waiting, dueReminders] = counts as [number, number, number, number, number];
  const sync = await readSync(sql);
  const coverageComplete = summary.coverageComplete && (!sync || sync.complete);
  return { ...summary, inbox, critical, needsResponse, waiting, dueReminders, coverageComplete,
    operationalZero: coverageComplete && critical === 0 && needsResponse === 0 && dueReminders === 0 && summary.failedCommands === 0 };
}
