import { describe, expect, it, rs } from '@rstest/core';
import type {
  MiniAppPrivateStorageAccess,
  MiniAppPrivateStorageApi,
  MiniAppPrivateSqlDatabase,
  MiniAppPrivateSqlTransaction,
  MiniAppSqlQueryResult,
} from '@theaiplatform/miniapp-sdk/sdk';
import type {
  MailCommand,
  MailCommandReceipt,
} from '@tap-examples/tap-email-protocol';
import { ProfileSqliteEmailActivityLedger } from './activity-ledger';
import { publishEmailActivityProjection } from './storage';

function profileStorageFixture() {
  const events = new Map<string, {
    action: string;
    outcome: string;
    occurredAt: string;
    timeSource: string;
  }>();
  let trackingStartedAt: string | null = null;
  let access: MiniAppPrivateStorageAccess | undefined;

  const execute = rs.fn(async (sql: string, params: readonly unknown[] = []) => {
    if (sql.includes('INSERT OR IGNORE INTO email_activity_metadata')) {
      trackingStartedAt ??= String(params[1]);
    } else if (sql.includes('INSERT INTO email_activity_events')) {
      const [key, action, outcome, occurredAt, timeSource] = params.map(String);
      const existing = events.get(key!);
      if (!existing) {
        events.set(key!, {
          action: action!,
          outcome: outcome!,
          occurredAt: occurredAt!,
          timeSource: timeSource!,
        });
      } else if (
        existing.action === action &&
        existing.outcome === 'uncertain' &&
        ['applied', 'failed', 'cancelled'].includes(outcome!)
      ) {
        events.set(key!, {
          action: action!,
          outcome: outcome!,
          occurredAt: occurredAt!,
          timeSource: timeSource!,
        });
      }
    } else if (
      sql.includes('DELETE FROM email_activity_events WHERE occurred_at <')
    ) {
      const cutoff = String(params[0]);
      for (const [key, event] of events) {
        if (event.occurredAt < cutoff) events.delete(key);
      }
    }
    return { rowsAffected: 1, lastInsertRowId: 1 };
  });

  const query = rs.fn(async (
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<MiniAppSqlQueryResult> => {
    if (sql.includes('FROM email_activity_metadata')) {
      return {
        columns: ['tracking_started_at'],
        rows: trackingStartedAt ? [[trackingStartedAt]] : [],
      };
    }
    if (sql.includes('COUNT(*)')) {
      return { columns: ['record_count'], rows: [[events.size]] };
    }
    if (sql.includes('FROM email_activity_events')) {
      const limit = typeof params[0] === 'number' ? params[0] : events.size;
      const rows = [...events.entries()]
        .sort((left, right) =>
          right[1].occurredAt.localeCompare(left[1].occurredAt) ||
          right[0].localeCompare(left[0]))
        .slice(0, limit)
        .map(([, event]) => [
          event.action,
          event.outcome,
          event.occurredAt,
          event.timeSource,
        ]);
      return {
        columns: ['action_kind', 'outcome', 'occurred_at', 'time_source'],
        rows,
      };
    }
    return { columns: [], rows: [] };
  });

  const database: MiniAppPrivateSqlDatabase = {
    execute,
    query,
    transaction: async <T>(callback: (
      transaction: MiniAppPrivateSqlTransaction,
    ) => Promise<T> | T) => callback(database),
    migrate: rs.fn(async () => ({ version: 2 })),
    schemaVersion: rs.fn(async () => 2),
    checkpoint: rs.fn(async () => undefined),
    recover: rs.fn(async () => undefined),
    close: rs.fn(async () => undefined),
  };
  const storage = {
    quota: { defaultBytes: 1_024, effectiveBytes: 1_024 },
    sqlite: { open: rs.fn(async () => database) },
    close: rs.fn(async () => undefined),
  };
  const profileStorage = {
    open: rs.fn(async (requested?: MiniAppPrivateStorageAccess) => {
      access = requested;
      return storage as never;
    }),
  } as MiniAppPrivateStorageApi;

  return { profileStorage, events, database, storage, get access() { return access; } };
}

const command: MailCommand = {
  v: 1,
  commandId: 'cmd_1',
  idempotencyKey: 'tap-email:account-private:cmd_1',
  accountId: 'account-private',
  threadId: 'thread-private',
  kind: 'archive',
  createdAt: '2026-09-13T11:59:00.000Z',
  expectedProviderRevision: 'revision-private',
  payload: { subject: 'must not escape' },
};
const receipt: MailCommandReceipt = {
  commandId: command.commandId,
  idempotencyKey: command.idempotencyKey,
  accountId: command.accountId,
  state: 'applied',
  acceptedAt: '2026-09-13T12:00:00.000Z',
  providerAcknowledgedAt: '2026-09-13T12:00:01.000Z',
  errorCode: null,
};

describe('private email activity ledger', () => {
  it('deduplicates receipt replay and publishes only content-free entries', async () => {
    const fixture = profileStorageFixture();
    const ledger = new ProfileSqliteEmailActivityLedger(
      fixture.profileStorage,
      () => Date.parse('2026-09-14T00:00:00.000Z'),
    );
    const sharedGet = rs.fn(async () => ({ value: null, revision: 7 }));
    const sharedSet = rs.fn(async () => ({ revision: 8 }));

    await ledger.record(command, receipt);
    const projection = await ledger.record(command, receipt);
    await publishEmailActivityProjection(
      projection,
      { get: sharedGet, set: sharedSet } as never,
    );

    expect(fixture.events.size).toBe(1);
    expect(projection.entries).toEqual([{
      action: 'thread_archived',
      outcome: 'applied',
      occurredAt: receipt.providerAcknowledgedAt,
      timeSource: 'provider_acknowledged_at',
    }]);
    expect(fixture.access).toEqual({
      filesRead: false,
      filesWrite: false,
      sqlite: true,
      zvec: false,
    });
    expect(sharedGet).toHaveBeenCalledTimes(1);
    expect(sharedSet).toHaveBeenCalledTimes(1);
    const serialized = JSON.stringify(projection);
    for (const privateValue of [
      command.idempotencyKey,
      command.accountId,
      command.threadId,
      command.expectedProviderRevision,
      'must not escape',
    ]) {
      expect(serialized).not.toContain(privateValue);
    }

    await ledger.close();
    expect(fixture.database.close).toHaveBeenCalledTimes(1);
    expect(fixture.storage.close).toHaveBeenCalledTimes(1);
  });

  it('omits corrupt enum values at the private-to-public boundary', async () => {
    const fixture = profileStorageFixture();
    fixture.events.set('corrupt-private-key', {
      action: 'invented_action',
      outcome: 'applied',
      occurredAt: '2026-09-13T12:00:00.000Z',
      timeSource: 'provider_acknowledged_at',
    });
    const ledger = new ProfileSqliteEmailActivityLedger(
      fixture.profileStorage,
      () => Date.parse('2026-09-14T00:00:00.000Z'),
    );

    const projection = await ledger.snapshot();

    expect(projection.entries).toEqual([]);
    expect(projection.coverage.warnings).toContain(
      'One or more malformed local activity records were omitted.',
    );
    expect(JSON.stringify(projection)).not.toContain('invented_action');
    expect(JSON.stringify(projection)).not.toContain('corrupt-private-key');

    await ledger.close();
  });

  it('refines delivery-unknown activity without duplicating or downgrading it', async () => {
    const fixture = profileStorageFixture();
    const ledger = new ProfileSqliteEmailActivityLedger(
      fixture.profileStorage,
      () => Date.parse('2026-09-14T00:00:00.000Z'),
    );
    const uncertain: MailCommandReceipt = {
      ...receipt,
      state: 'uncertain',
      providerAcknowledgedAt: null,
      errorCode: 'provider_transport_error',
    };
    const applied: MailCommandReceipt = {
      ...receipt,
      providerAcknowledgedAt: '2026-09-13T12:05:00.000Z',
    };

    expect((await ledger.record(command, uncertain)).entries).toEqual([{
      action: 'thread_archived',
      outcome: 'uncertain',
      occurredAt: uncertain.acceptedAt,
      timeSource: 'coordinator_accepted_at',
    }]);
    expect((await ledger.record(command, applied)).entries).toEqual([{
      action: 'thread_archived',
      outcome: 'applied',
      occurredAt: applied.providerAcknowledgedAt,
      timeSource: 'provider_acknowledged_at',
    }]);
    expect((await ledger.record(command, uncertain)).entries).toEqual([{
      action: 'thread_archived',
      outcome: 'applied',
      occurredAt: applied.providerAcknowledgedAt,
      timeSource: 'provider_acknowledged_at',
    }]);
    expect(fixture.events.size).toBe(1);

    await ledger.close();
  });

  it('makes autosave receipts a private-ledger and public-projection no-op', async () => {
    const fixture = profileStorageFixture();
    const ledger = new ProfileSqliteEmailActivityLedger(
      fixture.profileStorage,
      () => Date.parse('2026-09-14T00:00:00.000Z'),
    );
    const sharedGet = rs.fn(async () => {
      throw new Error('Autosave must not read shared projection storage.');
    });
    const sharedSet = rs.fn(async () => {
      throw new Error('Autosave must not write shared projection storage.');
    });

    const projection = await ledger.record({
      ...command,
      kind: 'save_draft',
      payload: {
        draftKey: 'draft_1',
        draftRevision: 3,
        to: 'recipient@example.test',
        subject: 'Private subject',
        bodyText: 'Private body',
      },
    }, receipt);
    await publishEmailActivityProjection(
      projection,
      { get: sharedGet, set: sharedSet } as never,
    );

    expect(fixture.events.size).toBe(0);
    expect(projection.entries).toEqual([]);
    expect(fixture.profileStorage.open).not.toHaveBeenCalled();
    expect(fixture.storage.sqlite.open).not.toHaveBeenCalled();
    expect(fixture.database.migrate).not.toHaveBeenCalled();
    expect(fixture.database.execute).not.toHaveBeenCalled();
    expect(fixture.database.query).not.toHaveBeenCalled();
    expect(fixture.database.checkpoint).not.toHaveBeenCalled();
    expect(sharedGet).not.toHaveBeenCalled();
    expect(sharedSet).not.toHaveBeenCalled();
    await ledger.close();
    expect(fixture.database.close).not.toHaveBeenCalled();
    expect(fixture.storage.close).not.toHaveBeenCalled();
  });
});
