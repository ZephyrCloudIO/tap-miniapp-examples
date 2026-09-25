// Real SQLite adapter for persistence tests. Files stay in memory; SQL transactions
// and rollback use SQLite rather than a SQL-string mock.
import { DatabaseSync } from 'node:sqlite';
import type { MiniAppPrivateSqlDatabase, MiniAppPrivateStorageApi, MiniAppPrivateStorageHandle, MiniAppSqlValue } from '@theaiplatform/miniapp-sdk/sdk';
import { serializedBytes } from './bounded-sql';

export function sqliteStoreFixture() {
  const sqlite = new DatabaseSync(':memory:');
  const applied = new Set<number>();
  const statements: string[] = [];
  let largestRequest = 0;
  let largestValue = 0;
  let fail: ((sql: string) => boolean) | null = null;
  let gate: { matches: (sql: string) => boolean; entered: () => void; released: Promise<void> } | null = null;
  async function before(sql: string, params: readonly MiniAppSqlValue[]) {
    const bytes = serializedBytes({ sql, params }) + 4096;
    largestRequest = Math.max(largestRequest, bytes);
    if (bytes > 24 * 1024 * 1024) throw new Error('The miniapp profile-storage request exceeds the allowed size.');
    for (const value of params) {
      const size = typeof value === 'string' ? new TextEncoder().encode(value).byteLength : 0;
      largestValue = Math.max(largestValue, size);
      if (size > 16 * 1024 * 1024) throw new Error('string or blob too big');
    }
    statements.push(sql);
    if (gate?.matches(sql)) {
      const paused = gate; gate = null; paused.entered(); await paused.released;
    }
    if (fail?.(sql)) { fail = null; throw new Error('injected storage failure'); }
  }
  const transaction = {
    async execute(sql: string, params: readonly MiniAppSqlValue[] = []) {
      await before(sql, params);
      const result = sqlite.prepare(sql).run(...params);
      return { rowsAffected: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
    },
    async query(sql: string, params: readonly MiniAppSqlValue[] = []) {
      await before(sql, params);
      const statement = sqlite.prepare(sql);
      const columns = statement.columns().map(column => column.name);
      const rows = statement.all(...params).map(row => columns.map(column => row[column] as MiniAppSqlValue));
      if (serializedBytes(rows) > 24 * 1024 * 1024) throw new Error('Host response exceeds limit.');
      return { columns, rows };
    },
  };
  const database: MiniAppPrivateSqlDatabase = {
    ...transaction,
    async transaction(callback) {
      sqlite.exec('BEGIN');
      try { const value = await callback(transaction); sqlite.exec('COMMIT'); return value; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
    async migrate(migrations) {
      for (const migration of migrations) {
        if (!applied.has(migration.version)) { sqlite.exec(migration.sql); applied.add(migration.version); }
      }
      return { version: Math.max(...applied) };
    },
    async checkpoint() {}, async close() {}, async recover() {},
    async schemaVersion() { return Math.max(0, ...applied); },
  };
  const storage = {
    quota: { defaultBytes: 1024 * 1024 * 1024, effectiveBytes: 1024 * 1024 * 1024 },
    sqlite: { open: async () => database },
    files: { async createDirectory() {}, async list() { return []; }, async metadata() { return { kind: 'directory' }; }, async delete() {} },
    async close() {}, async usage() { return null; },
  } as unknown as MiniAppPrivateStorageHandle;
  const profile: MiniAppPrivateStorageApi = { async open() { return storage; } };
  return {
    profile, sqlite, database, statements,
    metrics: () => ({ largestRequest, largestValue }),
    failOnce(matches: (sql: string) => boolean) { fail = matches; },
    pauseOnce(matches: (sql: string) => boolean) {
      let entered!: () => void;
      let release!: () => void;
      const paused = new Promise<void>(resolve => { entered = resolve; });
      const released = new Promise<void>(resolve => { release = resolve; });
      gate = { matches, entered, released };
      return { entered: paused, release };
    },
  };
}
