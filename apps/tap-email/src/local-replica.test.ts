import { describe, expect, it } from '@rstest/core';
import type {
  MiniAppPrivateSqlTransaction,
  MiniAppSqlResult,
} from '@theaiplatform/miniapp-sdk/sdk';
import {
  composeMessage,
  previewMailState,
  settleMailCommand,
  type MailState,
} from './domain';
import {
  localReplicaMigrations,
  localReplicaStatistics,
  mailStateWithoutAccount,
  replaceNormalizedLocalReplica,
} from './local-replica';

function stateWithResources(): MailState {
  const state = previewMailState();
  const firstThread = state.threads[0]!;
  const firstMessage = firstThread.messages[0]!;
  const withResources: MailState = {
    ...state,
    threads: [
      {
        ...firstThread,
        providerResources: ['inbox', 'starred'],
        messages: [
          {
            ...firstMessage,
            internetMessageId: '<message@example.test>',
            attachments: [
              {
                resourceId: 'attachment_1',
                fileName: 'brief.pdf',
                mimeType: 'application/pdf',
                sizeBytes: 4_096,
                disposition: 'attachment',
                contentId: null,
              },
            ],
          },
          ...firstThread.messages.slice(1),
        ],
      },
      ...state.threads.slice(1),
    ],
  };
  const pending = composeMessage(
    withResources,
    'cmd_account_outbox',
    firstThread.accountId,
    null,
    'maya@example.com',
    'Account-owned send',
    'Recoverable body',
    null,
    '2026-09-14T12:00:00.000Z',
    { draftKey: 'draft_account_outbox', draftRevision: 2 },
  );
  const command = pending.commands.at(-1)!;
  return settleMailCommand(pending, command, {
    commandId: command.commandId,
    idempotencyKey: command.idempotencyKey,
    accountId: command.accountId,
    state: 'failed',
    acceptedAt: '2026-09-14T12:00:00.000Z',
    providerAcknowledgedAt: null,
    errorCode: 'provider_rejected',
  }, '2026-09-14T12:00:01.000Z');
}

describe('normalized local mail replica', () => {
  it('uses additive migrations with deterministic search indexes', () => {
    expect(localReplicaMigrations.map(migration => migration.version)).toEqual(
      Array.from({ length: 17 }, (_, index) => index + 5),
    );
    expect(localReplicaMigrations.map(migration => migration.sql).join('\n'))
      .toContain('local_mail_attachment_metadata');
    expect(localReplicaMigrations.map(migration => migration.sql).join('\n'))
      .toContain('local_mail_participants_address_idx');
    expect(localReplicaMigrations.map(migration => migration.sql).join('\n'))
      .toContain('local_mail_resources_kind_idx');
    expect(localReplicaMigrations.map(migration => migration.sql).join('\n'))
      .toContain('local_mail_labels_label_idx');
  });

  it('normalizes account-scoped metadata without duplicating message bodies', async () => {
    const executed: Array<{
      readonly sql: string;
      readonly params: readonly unknown[];
    }> = [];
    const result: MiniAppSqlResult = { rowsAffected: 1, lastInsertRowId: 1 };
    const transaction: MiniAppPrivateSqlTransaction = {
      async execute(sql, params = []) {
        executed.push({ sql, params });
        return result;
      },
      async query() {
        return { columns: [], rows: [] };
      },
    };
    const state = stateWithResources();

    await replaceNormalizedLocalReplica(
      transaction,
      state,
      '2026-09-14T10:00:00.000Z',
      '2026-09-14T10:00:01.000Z',
    );

    const sql = executed.map(entry => entry.sql).join('\n');
    expect(sql).toContain('INSERT INTO local_mail_accounts');
    expect(sql).toContain('INSERT INTO local_mail_threads');
    expect(sql).toContain('INSERT INTO local_mail_messages');
    expect(sql).toContain('INSERT INTO local_mail_message_participants');
    expect(sql).toContain('INSERT INTO local_mail_thread_resources');
    expect(sql).toContain('INSERT INTO local_mail_thread_labels');
    expect(sql).toContain('INSERT INTO local_mail_attachment_metadata');
    const parameters = executed.flatMap(entry => entry.params);
    expect(parameters).toContain('brief.pdf');
    expect(parameters).toContain('attachment_1');
    expect(parameters).not.toContain(firstBody(state));
    expect(parameters).not.toContain(state.threads[0]!.messages[0]!.bodyHtml);
  });

  it('batches a large mailbox below the host transaction action budget', async () => {
    const executed: Array<{
      readonly sql: string;
      readonly params: readonly unknown[];
    }> = [];
    const result: MiniAppSqlResult = { rowsAffected: 1, lastInsertRowId: 1 };
    const transaction: MiniAppPrivateSqlTransaction = {
      async execute(sql, params = []) {
        executed.push({ sql, params });
        return result;
      },
      async query() {
        return { columns: [], rows: [] };
      },
    };
    const source = stateWithResources();
    const template = source.threads[0]!;
    const templateMessage = template.messages[0]!;
    const state: MailState = {
      ...source,
      threads: Array.from({ length: 900 }, (_, index) => ({
        ...template,
        threadId: `large_thread_${index}`,
        providerRevision: `large_revision_${index}`,
        participants: template.participants.slice(0, 1),
        providerResources: [],
        labels: [],
        messages: [{
          ...templateMessage,
          messageId: `large_message_${index}`,
          to: templateMessage.to.slice(0, 1),
          attachments: [],
        }],
      })),
    };

    await replaceNormalizedLocalReplica(
      transaction,
      state,
      '2026-09-14T10:00:00.000Z',
      '2026-09-14T10:00:01.000Z',
    );

    expect(executed.length).toBeLessThan(100);
    expect(Math.max(...executed.map(entry => entry.params.length)))
      .toBeLessThanOrEqual(900);
    expect(executed.filter(entry =>
      entry.sql.includes('INSERT INTO local_mail_threads'))).toHaveLength(14);
  });

  it('reports exact per-account coverage and removes every account-owned reference', () => {
    const state = stateWithResources();
    const targetAccountId = state.accounts[0]!.accountId;
    const statistics = localReplicaStatistics(state);
    const target = statistics.accounts.find(
      account => account.accountId === targetAccountId,
    );

    expect(statistics.counts).toMatchObject({
      accounts: 2,
      threads: 5,
      messages: 7,
      resources: 2,
      attachmentMetadata: 1,
    });
    expect(statistics.logicalBytes).toBeGreaterThan(0);
    expect(target).toMatchObject({
      accountId: targetAccountId,
      indexedThrough: '2021-01-01T00:00:00.000Z',
      resourceKinds: [],
    });

    const withoutAccount = mailStateWithoutAccount(state, targetAccountId);
    expect(withoutAccount.accounts.some(account =>
      account.accountId === targetAccountId)).toBe(false);
    expect(withoutAccount.threads.some(thread =>
      thread.accountId === targetAccountId)).toBe(false);
    expect(withoutAccount.commands.some(command =>
      command.accountId === targetAccountId)).toBe(false);
    expect(withoutAccount.outbox?.some(item =>
      item.attempts[0]?.command.accountId === targetAccountId)).toBe(false);
    expect(withoutAccount.preferences.notificationAccountIds)
      .not.toContain(targetAccountId);
  });
});

function firstBody(state: MailState): string {
  return state.threads[0]!.messages[0]!.bodyText;
}
