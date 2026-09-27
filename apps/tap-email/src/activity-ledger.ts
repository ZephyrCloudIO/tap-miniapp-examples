import {
  sdk,
  type MiniAppPrivateSqlDatabase,
  type MiniAppPrivateStorageApi,
  type MiniAppPrivateStorageHandle,
} from '@theaiplatform/miniapp-sdk/sdk';
import type {
  MailCommand,
  MailCommandReceipt,
} from '@tap-examples/tap-email-protocol';
import {
  EMAIL_ACTIVITY_PROJECTION_LIMIT,
  EMAIL_ACTIVITY_RETENTION_DAYS,
  EMAIL_ACTIVITY_SCHEMA_VERSION,
  isEmailActivityAction,
  isEmailActivityOutcome,
  isEmailActivityTimeSource,
  localActivityRecordFromReceipt,
  noOpEmailActivityProjection,
  unavailableEmailActivityProjection,
  type LocalEmailActivityRecord,
  type EmailActivityProjection,
  type EmailActivityProjectionEntry,
} from './activity';

export type LocalEmailActivityLedgerCapability =
  | 'private-profile-sqlite'
  | 'unavailable';

export interface LocalEmailActivityLedger {
  readonly capability: LocalEmailActivityLedgerCapability;
  record(
    command: MailCommand,
    receipt: MailCommandReceipt,
  ): Promise<EmailActivityProjection>;
  recordView(viewId: string, occurredAt: string, timeSource?: 'ui_observed_at' | 'mcp_observed_at'): Promise<EmailActivityProjection>;
  snapshot(): Promise<EmailActivityProjection>;
  close(): Promise<void>;
}

const databaseName = 'tap-email-activity-v1.sqlite';
const maximumLedgerRecords = 10_000;
const activityEventMigration = {
  version: 1,
  sql: `CREATE TABLE IF NOT EXISTS email_activity_events (
    idempotency_key TEXT PRIMARY KEY,
    action_kind TEXT NOT NULL,
    outcome TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    time_source TEXT NOT NULL
  )`,
} as const;
const activityMetadataMigration = {
  version: 2,
  sql: `CREATE TABLE IF NOT EXISTS email_activity_metadata (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    tracking_started_at TEXT NOT NULL
  )`,
} as const;

const activityCoverageMigration = {
  version: 3,
  sql: 'ALTER TABLE email_activity_metadata ADD COLUMN activity_schema_version INTEGER NOT NULL DEFAULT 1',
} as const;

interface ProfileConnection {
  readonly storage: MiniAppPrivateStorageHandle;
  readonly database: MiniAppPrivateSqlDatabase;
}

function valueAt(
  columns: readonly string[],
  row: readonly unknown[],
  column: string,
): unknown {
  const index = columns.indexOf(column);
  return index >= 0 ? row[index] : undefined;
}

function projectionEntry(
  columns: readonly string[],
  row: readonly unknown[],
): EmailActivityProjectionEntry | null {
  const action = valueAt(columns, row, 'action_kind');
  const outcome = valueAt(columns, row, 'outcome');
  const occurredAt = valueAt(columns, row, 'occurred_at');
  const timeSource = valueAt(columns, row, 'time_source');
  if (
    !isEmailActivityAction(action) ||
    !isEmailActivityOutcome(outcome) ||
    typeof occurredAt !== 'string' ||
    !isEmailActivityTimeSource(timeSource) ||
    !Number.isFinite(Date.parse(occurredAt))
  ) {
    return null;
  }
  return {
    action,
    outcome,
    occurredAt,
    timeSource,
  };
}

export class ProfileSqliteEmailActivityLedger
  implements LocalEmailActivityLedger {
  readonly capability = 'private-profile-sqlite' as const;
  private connection: Promise<ProfileConnection> | null = null;
  private pendingWrite: Promise<void> = Promise.resolve();

  constructor(
    private readonly profileStorage: MiniAppPrivateStorageApi,
    private readonly now: () => number = Date.now,
  ) {}

  private async connect(): Promise<ProfileConnection> {
    const attempt = this.connection ??= (async () => {
      let storage: MiniAppPrivateStorageHandle | null = null;
      let database: MiniAppPrivateSqlDatabase | null = null;
      try {
        storage = await this.profileStorage.open({
          filesRead: false,
          filesWrite: false,
          sqlite: true,
          zvec: false,
        });
        database = await storage.sqlite.open(databaseName);
        await database.migrate([
          activityEventMigration,
          activityMetadataMigration,
          activityCoverageMigration,
        ]);
        await database.execute(
          `INSERT OR IGNORE INTO email_activity_metadata (
             id, tracking_started_at
           ) VALUES (?, ?)`,
          [1, new Date(this.now()).toISOString()],
        );
        // Views and first-draft counts were introduced in activity schema 2.
        // Retain old actions, but do not claim complete coverage for these new types before upgrade.
        await database.execute(
          'UPDATE email_activity_metadata SET tracking_started_at = ?, activity_schema_version = 2 WHERE activity_schema_version < 2',
          [new Date(this.now()).toISOString()],
        );
        await database.checkpoint();
        return { storage, database };
      } catch (error) {
        await Promise.resolve(database?.close()).catch(() => undefined);
        await Promise.resolve(storage?.close()).catch(() => undefined);
        throw error;
      }
    })();
    try {
      return await attempt;
    } catch (error) {
      if (this.connection === attempt) this.connection = null;
      throw error;
    }
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.pendingWrite.catch(() => undefined).then(task);
    this.pendingWrite = result.then(() => undefined, () => undefined);
    return result;
  }

  record(
    command: MailCommand,
    receipt: MailCommandReceipt,
  ): Promise<EmailActivityProjection> {
    const record = localActivityRecordFromReceipt(command, receipt);
    if (record === null) {
      return Promise.resolve(
        noOpEmailActivityProjection(new Date(this.now()).toISOString()),
      );
    }
    return this.recordEvent(record);
  }

  recordView(viewId: string, occurredAt: string, timeSource: 'ui_observed_at' | 'mcp_observed_at' = 'ui_observed_at'): Promise<EmailActivityProjection> {
    if (!viewId || !Number.isFinite(Date.parse(occurredAt))) {
      return Promise.reject(new Error('Invalid email view activity.'));
    }
    return this.recordEvent({
      idempotencyKey: `view:${viewId}`,
      action: 'thread_viewed', outcome: 'applied', occurredAt,
      timeSource,
    });
  }

  private recordEvent(record: LocalEmailActivityRecord): Promise<EmailActivityProjection> {
    return this.enqueue(async () => {
      const { database } = await this.connect();
      await database.transaction(async transaction => {
        // Coordinator redelivery and UI retries are idempotent. An explicit
        // provider reconciliation may refine an earlier delivery-unknown
        // receipt, but it must never downgrade an already-known outcome or
        // reuse the key for a different action. The key itself remains only in
        // this private local database.
        await transaction.execute(
          `INSERT INTO email_activity_events (
             idempotency_key, action_kind, outcome, occurred_at, time_source
           ) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(idempotency_key) DO UPDATE SET
             outcome = excluded.outcome,
             occurred_at = excluded.occurred_at,
             time_source = excluded.time_source
           WHERE email_activity_events.action_kind = excluded.action_kind
             AND ((email_activity_events.outcome = 'uncertain'
               AND excluded.outcome IN ('applied', 'failed', 'cancelled'))
               OR (excluded.action_kind = 'draft_created'
                 AND excluded.occurred_at < email_activity_events.occurred_at))`,
          [
            record.idempotencyKey,
            record.action,
            record.outcome,
            record.occurredAt,
            record.timeSource,
          ],
        );
        await this.prune(transaction);
      });
      await database.checkpoint();
      return this.readProjection(database);
    });
  }

  snapshot(): Promise<EmailActivityProjection> {
    return this.enqueue(async () => {
      const { database } = await this.connect();
      await database.transaction(transaction => this.prune(transaction));
      await database.checkpoint();
      return this.readProjection(database);
    });
  }

  private async prune(database: Pick<MiniAppPrivateSqlDatabase, 'execute'>) {
    const retainedAfter = new Date(
      this.now() - EMAIL_ACTIVITY_RETENTION_DAYS * 24 * 60 * 60 * 1_000,
    ).toISOString();
    await database.execute(
      'DELETE FROM email_activity_events WHERE occurred_at < ?',
      [retainedAfter],
    );
    await database.execute(
      `DELETE FROM email_activity_events
        WHERE idempotency_key IN (
          SELECT idempotency_key
            FROM email_activity_events
           ORDER BY occurred_at DESC, idempotency_key DESC
           LIMIT -1 OFFSET ?
        )`,
      [maximumLedgerRecords],
    );
  }

  private async readProjection(
    database: MiniAppPrivateSqlDatabase,
  ): Promise<EmailActivityProjection> {
    const generatedAt = new Date(this.now()).toISOString();
    const retainedCutoff = new Date(
      this.now() - EMAIL_ACTIVITY_RETENTION_DAYS * 24 * 60 * 60 * 1_000,
    ).toISOString();
    const [metadata, count, events] = await Promise.all([
      database.query(
        'SELECT tracking_started_at FROM email_activity_metadata WHERE id = ?',
        [1],
      ),
      database.query('SELECT COUNT(*) AS record_count FROM email_activity_events'),
      database.query(
        `SELECT action_kind, outcome, occurred_at, time_source
           FROM email_activity_events
          ORDER BY occurred_at DESC, idempotency_key DESC
          LIMIT ?`,
        [EMAIL_ACTIVITY_PROJECTION_LIMIT],
      ),
    ]);
    const rawTrackingStartedAt = valueAt(
      metadata.columns,
      metadata.rows[0] ?? [],
      'tracking_started_at',
    );
    const trackingStartedAt =
      typeof rawTrackingStartedAt === 'string' &&
      Number.isFinite(Date.parse(rawTrackingStartedAt))
        ? new Date(Date.parse(rawTrackingStartedAt)).toISOString()
        : generatedAt;
    const rawCount = valueAt(
      count.columns,
      count.rows[0] ?? [],
      'record_count',
    );
    const recordCount =
      typeof rawCount === 'number' && Number.isSafeInteger(rawCount) && rawCount >= 0
        ? rawCount
        : events.rows.length;
    const parsedEntries = events.rows
      .map(row => projectionEntry(events.columns, row))
      .filter(entry => entry !== null)
      .reverse();
    const truncated = recordCount > EMAIL_ACTIVITY_PROJECTION_LIMIT;
    const retainedAfter =
      Date.parse(trackingStartedAt) > Date.parse(retainedCutoff)
        ? trackingStartedAt
        : retainedCutoff;
    const availableFrom = truncated
      ? parsedEntries[0]?.occurredAt ?? generatedAt
      : retainedAfter;
    const warnings: string[] = [];
    if (truncated) {
      warnings.push(
        'The rolling activity projection contains only the newest 2048 committed actions.',
      );
    }
    if (parsedEntries.length !== events.rows.length) {
      warnings.push('One or more malformed local activity records were omitted.');
    }

    return {
      schemaVersion: EMAIL_ACTIVITY_SCHEMA_VERSION,
      generatedAt,
      entries: parsedEntries,
      coverage: {
        scope: 'installation',
        source: 'private-profile-sqlite',
        trackingStartedAt,
        retainedAfter,
        availableFrom,
        truncated,
        warnings,
      },
    };
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

export class UnavailableEmailActivityLedger
  implements LocalEmailActivityLedger {
  readonly capability = 'unavailable' as const;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly warning?: string,
  ) {}

  async record(
    command: MailCommand,
    receipt: MailCommandReceipt,
  ): Promise<EmailActivityProjection> {
    if (localActivityRecordFromReceipt(command, receipt) === null) {
      return noOpEmailActivityProjection(new Date(this.now()).toISOString());
    }
    return this.snapshot();
  }

  async recordView(_viewId: string, _occurredAt: string): Promise<EmailActivityProjection> {
    return this.snapshot();
  }

  async snapshot(): Promise<EmailActivityProjection> {
    return unavailableEmailActivityProjection(
      new Date(this.now()).toISOString(),
      this.warning,
    );
  }

  async close(): Promise<void> {}
}

export function createLocalEmailActivityLedger(
  preview: boolean,
  profileStorage: MiniAppPrivateStorageApi | null | undefined = undefined,
): LocalEmailActivityLedger {
  if (preview) {
    return new UnavailableEmailActivityLedger(
      Date.now,
      'Preview fixtures do not publish email activity.',
    );
  }
  const availableProfile = profileStorage === null
    ? undefined
    : profileStorage ?? sdk.storage.profile;
  return availableProfile
    ? new ProfileSqliteEmailActivityLedger(availableProfile)
    : new UnavailableEmailActivityLedger();
}
