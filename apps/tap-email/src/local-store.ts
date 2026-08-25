import {
  sdk,
  type MiniAppProfileSqlDatabase,
  type MiniAppProfileStorageApi,
  type MiniAppProfileStorageHandle,
} from '@theaiplatform/miniapp-sdk/sdk';
import { isMailState, type MailState } from './domain';

export type LocalMailStoreCapability =
  | 'private-profile-sqlite'
  | 'preview-fixture'
  | 'unavailable';

export interface LocalMailStore {
  readonly capability: LocalMailStoreCapability;
  load(): Promise<MailState | null>;
  save(state: MailState): Promise<void>;
  close(): Promise<void>;
}

const previewKey = 'tap-example.tap-email.preview-mailbox.v1';
const databaseName = 'tap-email-mailbox-v1.sqlite';
const mailboxMigration = {
  version: 1,
  sql: `CREATE TABLE IF NOT EXISTS mailbox_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    schema_version INTEGER NOT NULL,
    state_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
} as const;

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

  async close(): Promise<void> {}
}

interface ProfileConnection {
  readonly storage: MiniAppProfileStorageHandle;
  readonly database: MiniAppProfileSqlDatabase;
}

export class ProfileSqliteMailStore implements LocalMailStore {
  readonly capability = 'private-profile-sqlite' as const;
  private connection: Promise<ProfileConnection> | null = null;
  private pendingWrite: Promise<void> = Promise.resolve();

  constructor(private readonly profileStorage: MiniAppProfileStorageApi) {}

  private async connect(): Promise<ProfileConnection> {
    const attempt = this.connection ??= (async () => {
      const storage = await this.profileStorage.open({
        filesRead: false,
        filesWrite: false,
        sqlite: true,
        zvec: false,
      });
      const database = await storage.sqlite.open(databaseName);
      await database.migrate([mailboxMigration]);
      return { storage, database };
    })();
    try {
      return await attempt;
    } catch (error) {
      if (this.connection === attempt) this.connection = null;
      throw error;
    }
  }

  async load(): Promise<MailState | null> {
    const { database } = await this.connect();
    const result = await database.query(
      'SELECT state_json FROM mailbox_state WHERE id = ?',
      [1],
    );
    const stateIndex = result.columns.indexOf('state_json');
    const raw = stateIndex >= 0 ? result.rows[0]?.[stateIndex] : null;
    if (typeof raw !== 'string') return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      return isMailState(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  save(state: MailState): Promise<void> {
    const serialized = JSON.stringify(state);
    this.pendingWrite = this.pendingWrite
      .catch(() => undefined)
      .then(async () => {
        const { database } = await this.connect();
        await database.transaction(async transaction => {
          await transaction.execute(
            `INSERT INTO mailbox_state (id, schema_version, state_json, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               schema_version = excluded.schema_version,
               state_json = excluded.state_json,
               updated_at = excluded.updated_at`,
            [1, state.schemaVersion, serialized, new Date().toISOString()],
          );
        });
        await database.checkpoint();
      });
    return this.pendingWrite;
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
      'TAP Email needs SDK profile SQLite before it can persist mailbox content on this device.',
    );
  }

  async close(): Promise<void> {}
}

export function createLocalMailStore(
  preview: boolean,
  profileStorage: MiniAppProfileStorageApi | null | undefined = undefined,
): LocalMailStore {
  if (preview) return new PreviewFixtureMailStore();
  const availableProfile = profileStorage === null
    ? undefined
    : profileStorage ?? sdk.storage.profile;
  return availableProfile
    ? new ProfileSqliteMailStore(availableProfile)
    : new UnavailableLocalProfileMailStore();
}
