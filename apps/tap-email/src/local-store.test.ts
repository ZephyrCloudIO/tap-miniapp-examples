import { describe, expect, it } from '@rstest/core';
import type {
  MiniAppProfileSqlDatabase,
  MiniAppProfileStorageApi,
  MiniAppProfileStorageHandle,
  MiniAppSqlQueryResult,
  MiniAppSqlResult,
} from '@theaiplatform/miniapp-sdk/sdk';
import { previewMailState } from './domain';
import { createLocalMailStore } from './local-store';

function profileStorageFixture() {
  let stateJson: string | null = null;
  let checkpoints = 0;
  let databaseClosed = false;
  let storageClosed = false;
  const result: MiniAppSqlResult = { rowsAffected: 1, lastInsertRowId: 1 };
  const transaction = {
    execute: async (_sql: string, params: readonly unknown[] = []) => {
      stateJson = typeof params[2] === 'string' ? params[2] : null;
      return result;
    },
    query: async (): Promise<MiniAppSqlQueryResult> => ({ columns: [], rows: [] }),
  };
  const database = {
    ...transaction,
    close: async () => { databaseClosed = true; },
    transaction: async <T>(callback: (value: typeof transaction) => T | Promise<T>) =>
      callback(transaction),
    migrate: async () => ({ version: 1 }),
    schemaVersion: async () => 1,
    checkpoint: async () => { checkpoints += 1; },
    recover: async () => undefined,
    query: async (): Promise<MiniAppSqlQueryResult> => ({
      columns: ['state_json'],
      rows: stateJson === null ? [] : [[stateJson]],
    }),
  } satisfies MiniAppProfileSqlDatabase;
  const storage = {
    quota: { defaultBytes: 1_073_741_824, effectiveBytes: 1_073_741_824 },
    files: {} as MiniAppProfileStorageHandle['files'],
    sqlite: { open: async () => database },
    zvec: {} as MiniAppProfileStorageHandle['zvec'],
    usage: async () => ({ usedBytes: stateJson?.length ?? 0, quotaBytes: 1_073_741_824 }),
    close: async () => { storageClosed = true; },
  } satisfies MiniAppProfileStorageHandle;
  const profile = { open: async () => storage } satisfies MiniAppProfileStorageApi;
  return {
    profile,
    diagnostics: () => ({ checkpoints, databaseClosed, storageClosed }),
  };
}

describe('TAP Email profile SQLite cache', () => {
  it('persists and restores the mailbox in the package-scoped profile', async () => {
    const fixture = profileStorageFixture();
    const store = createLocalMailStore(false, fixture.profile);
    const state = previewMailState();

    expect(store.capability).toBe('private-profile-sqlite');
    expect(await store.load()).toBeNull();
    await store.save(state);
    expect(await store.load()).toEqual(state);
    expect(fixture.diagnostics().checkpoints).toBe(1);

    await store.close();
    expect(fixture.diagnostics()).toMatchObject({
      databaseClosed: true,
      storageClosed: true,
    });
  });

  it('fails closed when the host does not expose profile storage', () => {
    expect(createLocalMailStore(false, null).capability).toBe('unavailable');
  });

  it('can retry after a transient profile-storage open failure', async () => {
    const fixture = profileStorageFixture();
    let attempts = 0;
    const retryingProfile: MiniAppProfileStorageApi = {
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
