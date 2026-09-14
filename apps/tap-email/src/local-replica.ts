import type {
  MiniAppPrivateSqlTransaction,
  MiniAppSqlMigration,
  MiniAppSqlValue,
} from '@theaiplatform/miniapp-sdk/sdk';
import type {
  AccountCoverageState,
  MailCommand,
} from '@tap-examples/tap-email-protocol';
import {
  emailThreadKey,
  type EmailThread,
  type MailState,
  type ProviderMailboxResource,
} from './domain';

export const localReplicaMigrations = [
  {
    version: 5,
    sql: `CREATE TABLE IF NOT EXISTS local_mail_accounts (
      account_id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      address TEXT NOT NULL,
      display_name TEXT NOT NULL,
      coverage_state TEXT NOT NULL,
      newest_provider_revision TEXT,
      coverage_observed_at TEXT NOT NULL,
      backfill_complete_through TEXT,
      unresolved_failures INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  },
  {
    version: 6,
    sql: `CREATE TABLE IF NOT EXISTS local_mail_threads (
      account_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      provider_revision TEXT NOT NULL,
      subject TEXT NOT NULL,
      snippet TEXT NOT NULL,
      received_at TEXT NOT NULL,
      unread INTEGER NOT NULL,
      starred INTEGER NOT NULL,
      critical INTEGER NOT NULL,
      needs_response INTEGER NOT NULL,
      waiting_on_others INTEGER NOT NULL,
      status TEXT NOT NULL,
      message_count INTEGER NOT NULL,
      PRIMARY KEY (account_id, thread_id)
    )`,
  },
  {
    version: 7,
    sql: `CREATE TABLE IF NOT EXISTS local_mail_thread_participants (
      account_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      display_name TEXT NOT NULL,
      address TEXT NOT NULL,
      PRIMARY KEY (account_id, thread_id, ordinal)
    )`,
  },
  {
    version: 8,
    sql: `CREATE TABLE IF NOT EXISTS local_mail_messages (
      account_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      internet_message_id TEXT,
      sent_at TEXT NOT NULL,
      body_text_bytes INTEGER NOT NULL,
      body_html_bytes INTEGER NOT NULL,
      attachment_count INTEGER NOT NULL,
      PRIMARY KEY (account_id, thread_id, message_id)
    )`,
  },
  {
    version: 9,
    sql: `CREATE TABLE IF NOT EXISTS local_mail_message_participants (
      account_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      role TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      display_name TEXT NOT NULL,
      address TEXT NOT NULL,
      PRIMARY KEY (account_id, thread_id, message_id, role, ordinal)
    )`,
  },
  {
    version: 10,
    sql: `CREATE TABLE IF NOT EXISTS local_mail_thread_resources (
      account_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      resource_kind TEXT NOT NULL,
      PRIMARY KEY (account_id, thread_id, resource_kind)
    )`,
  },
  {
    version: 11,
    sql: `CREATE TABLE IF NOT EXISTS local_mail_thread_labels (
      account_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      label TEXT NOT NULL,
      PRIMARY KEY (account_id, thread_id, label)
    )`,
  },
  {
    version: 12,
    sql: `CREATE TABLE IF NOT EXISTS local_mail_attachment_metadata (
      account_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      disposition TEXT NOT NULL,
      content_id TEXT,
      PRIMARY KEY (account_id, thread_id, message_id, resource_id)
    )`,
  },
  {
    version: 13,
    sql: `CREATE TABLE IF NOT EXISTS local_mail_replica_metadata (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      source_updated_at TEXT NOT NULL,
      indexed_at TEXT NOT NULL
    )`,
  },
  {
    version: 14,
    sql: `CREATE INDEX IF NOT EXISTS local_mail_threads_received_idx
      ON local_mail_threads (account_id, received_at DESC, thread_id)`,
  },
  {
    version: 15,
    sql: `CREATE INDEX IF NOT EXISTS local_mail_messages_sent_idx
      ON local_mail_messages (account_id, sent_at DESC, thread_id, message_id)`,
  },
  {
    version: 16,
    sql: `CREATE INDEX IF NOT EXISTS local_mail_participants_address_idx
      ON local_mail_message_participants (
        account_id, address, role, thread_id, message_id
      )`,
  },
  {
    version: 17,
    sql: `CREATE INDEX IF NOT EXISTS local_mail_attachments_name_idx
      ON local_mail_attachment_metadata (account_id, file_name, mime_type)`,
  },
  {
    version: 18,
    sql: `CREATE INDEX IF NOT EXISTS local_mail_resources_kind_idx
      ON local_mail_thread_resources (account_id, resource_kind, thread_id)`,
  },
  {
    version: 19,
    sql: `CREATE INDEX IF NOT EXISTS local_mail_labels_label_idx
      ON local_mail_thread_labels (account_id, label, thread_id)`,
  },
  {
    version: 20,
    sql: `CREATE INDEX IF NOT EXISTS local_mail_threads_state_idx
      ON local_mail_threads (
        account_id, status, unread, starred, received_at DESC, thread_id
      )`,
  },
] as const satisfies readonly MiniAppSqlMigration[];

const normalizedTablesInDeleteOrder = [
  'local_mail_attachment_metadata',
  'local_mail_message_participants',
  'local_mail_messages',
  'local_mail_thread_labels',
  'local_mail_thread_resources',
  'local_mail_thread_participants',
  'local_mail_threads',
  'local_mail_accounts',
] as const;

// Keep each host action comfortably below both SQLite's conservative variable
// ceiling and the SDK's 10,000-value transport limit. A normalized mailbox can
// contain thousands of rows, so issuing one action per row makes otherwise
// healthy cache writes expire before the transaction can commit.
const maximumSqlParametersPerInsert = 900;

async function insertRows(
  transaction: MiniAppPrivateSqlTransaction,
  table: string,
  columns: readonly string[],
  rows: readonly (readonly MiniAppSqlValue[])[],
): Promise<void> {
  if (rows.length === 0) return;
  if (
    columns.length === 0 ||
    rows.some(row => row.length !== columns.length)
  ) {
    throw new Error(`Invalid normalized replica row shape for ${table}.`);
  }
  const rowsPerInsert = Math.max(
    1,
    Math.floor(maximumSqlParametersPerInsert / columns.length),
  );
  const rowPlaceholders = `(${columns.map(() => '?').join(', ')})`;

  for (let start = 0; start < rows.length; start += rowsPerInsert) {
    const batch = rows.slice(start, start + rowsPerInsert);
    await transaction.execute(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${batch
        .map(() => rowPlaceholders)
        .join(', ')}`,
      batch.flat(),
    );
  }
}

export interface LocalReplicaEntityCounts {
  readonly accounts: number;
  readonly threads: number;
  readonly messages: number;
  readonly participants: number;
  readonly resources: number;
  readonly labels: number;
  readonly attachmentMetadata: number;
}

export interface LocalReplicaAccountCoverage {
  readonly accountId: string;
  readonly provider: string;
  readonly state: AccountCoverageState;
  readonly observedAt: string;
  readonly indexedThrough: string | null;
  readonly unresolvedFailures: number;
  readonly resourceKinds: readonly ProviderMailboxResource[];
  readonly counts: Pick<LocalReplicaEntityCounts, 'threads' | 'messages' | 'attachmentMetadata'>;
}

export interface LocalReplicaStatistics {
  readonly counts: LocalReplicaEntityCounts;
  /** UTF-8 bytes in normalized metadata values, excluding raw message bodies. */
  readonly logicalBytes: number;
  readonly accounts: readonly LocalReplicaAccountCoverage[];
}

function utf8Bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function messageParticipants(thread: EmailThread) {
  return thread.messages.flatMap(message => [
    {
      accountId: thread.accountId,
      threadId: thread.threadId,
      messageId: message.messageId,
      role: 'from' as const,
      ordinal: 0,
      displayName: message.from.name,
      address: message.from.address,
    },
    ...message.to.map((participant, ordinal) => ({
      accountId: thread.accountId,
      threadId: thread.threadId,
      messageId: message.messageId,
      role: 'to' as const,
      ordinal,
      displayName: participant.name,
      address: participant.address,
    })),
  ]);
}

export function localReplicaStatistics(state: MailState): LocalReplicaStatistics {
  let messages = 0;
  let participants = 0;
  let resources = 0;
  let labels = 0;
  let attachmentMetadata = 0;
  let logicalBytes = 0;

  for (const account of state.accounts) {
    logicalBytes += utf8Bytes({
      accountId: account.accountId,
      provider: account.provider,
      address: account.address,
      displayName: account.displayName,
      coverage: account.coverage,
    });
  }
  for (const thread of state.threads) {
    logicalBytes += utf8Bytes({
      accountId: thread.accountId,
      threadId: thread.threadId,
      providerRevision: thread.providerRevision,
      subject: thread.subject,
      snippet: thread.snippet,
      receivedAt: thread.receivedAt,
      unread: thread.unread,
      starred: thread.starred,
      critical: thread.critical,
      needsResponse: thread.needsResponse,
      waitingOnOthers: thread.waitingOnOthers,
      status: thread.status,
      messageCount: thread.messages.length,
    });
    participants += thread.participants.length;
    logicalBytes += utf8Bytes(thread.participants);
    resources += thread.providerResources?.length ?? 0;
    logicalBytes += utf8Bytes(thread.providerResources ?? []);
    labels += thread.labels.length;
    logicalBytes += utf8Bytes(thread.labels);
    for (const message of thread.messages) {
      messages += 1;
      logicalBytes += utf8Bytes({
        accountId: thread.accountId,
        threadId: thread.threadId,
        messageId: message.messageId,
        internetMessageId: message.internetMessageId ?? null,
        sentAt: message.sentAt,
        bodyTextBytes: new TextEncoder().encode(message.bodyText).byteLength,
        bodyHtmlBytes: message.bodyHtml
          ? new TextEncoder().encode(message.bodyHtml).byteLength
          : 0,
        attachmentCount: message.attachments?.length ?? 0,
      });
      const messagePeople = 1 + message.to.length;
      participants += messagePeople;
      logicalBytes += utf8Bytes([message.from, ...message.to]);
      attachmentMetadata += message.attachments?.length ?? 0;
      logicalBytes += utf8Bytes(message.attachments ?? []);
    }
  }

  const accountCoverage = state.accounts.map(account => {
    const accountThreads = state.threads.filter(
      thread => thread.accountId === account.accountId,
    );
    const resourceKinds = [...new Set(accountThreads.flatMap(
      thread => thread.providerResources ?? [],
    ))].sort();
    return {
      accountId: account.accountId,
      provider: account.provider,
      state: account.coverage.state,
      observedAt: account.coverage.observedAt,
      indexedThrough: account.coverage.backfillCompleteThrough,
      unresolvedFailures: account.coverage.unresolvedFailures,
      resourceKinds,
      counts: {
        threads: accountThreads.length,
        messages: accountThreads.reduce(
          (total, thread) => total + thread.messages.length,
          0,
        ),
        attachmentMetadata: accountThreads.reduce(
          (total, thread) => total + thread.messages.reduce(
            (messageTotal, message) =>
              messageTotal + (message.attachments?.length ?? 0),
            0,
          ),
          0,
        ),
      },
    } satisfies LocalReplicaAccountCoverage;
  });

  return {
    counts: {
      accounts: state.accounts.length,
      threads: state.threads.length,
      messages,
      participants,
      resources,
      labels,
      attachmentMetadata,
    },
    logicalBytes,
    accounts: accountCoverage,
  };
}

export async function replaceNormalizedLocalReplica(
  transaction: MiniAppPrivateSqlTransaction,
  state: MailState,
  sourceUpdatedAt: string,
  indexedAt: string,
): Promise<void> {
  for (const table of normalizedTablesInDeleteOrder) {
    await transaction.execute(`DELETE FROM ${table}`);
  }

  await insertRows(
    transaction,
    'local_mail_accounts',
    [
      'account_id',
      'provider',
      'address',
      'display_name',
      'coverage_state',
      'newest_provider_revision',
      'coverage_observed_at',
      'backfill_complete_through',
      'unresolved_failures',
      'updated_at',
    ],
    state.accounts.map(account => [
      account.accountId,
      account.provider,
      account.address,
      account.displayName,
      account.coverage.state,
      account.coverage.newestHistoryId,
      account.coverage.observedAt,
      account.coverage.backfillCompleteThrough,
      account.coverage.unresolvedFailures,
      indexedAt,
    ]),
  );

  await insertRows(
    transaction,
    'local_mail_threads',
    [
      'account_id',
      'thread_id',
      'provider_revision',
      'subject',
      'snippet',
      'received_at',
      'unread',
      'starred',
      'critical',
      'needs_response',
      'waiting_on_others',
      'status',
      'message_count',
    ],
    state.threads.map(thread => [
      thread.accountId,
      thread.threadId,
      thread.providerRevision,
      thread.subject,
      thread.snippet,
      thread.receivedAt,
      Number(thread.unread),
      Number(thread.starred),
      Number(thread.critical),
      Number(thread.needsResponse),
      Number(thread.waitingOnOthers),
      thread.status,
      thread.messages.length,
    ]),
  );

  await insertRows(
    transaction,
    'local_mail_thread_participants',
    ['account_id', 'thread_id', 'ordinal', 'display_name', 'address'],
    state.threads.flatMap(thread => thread.participants.map(
      (participant, ordinal) => [
        thread.accountId,
        thread.threadId,
        ordinal,
        participant.name,
        participant.address,
      ],
    )),
  );

  await insertRows(
    transaction,
    'local_mail_thread_resources',
    ['account_id', 'thread_id', 'resource_kind'],
    state.threads.flatMap(thread => (thread.providerResources ?? []).map(
      resource => [thread.accountId, thread.threadId, resource],
    )),
  );

  await insertRows(
    transaction,
    'local_mail_thread_labels',
    ['account_id', 'thread_id', 'label'],
    state.threads.flatMap(thread => thread.labels.map(
      label => [thread.accountId, thread.threadId, label],
    )),
  );

  await insertRows(
    transaction,
    'local_mail_messages',
    [
      'account_id',
      'thread_id',
      'message_id',
      'internet_message_id',
      'sent_at',
      'body_text_bytes',
      'body_html_bytes',
      'attachment_count',
    ],
    state.threads.flatMap(thread => thread.messages.map(message => [
      thread.accountId,
      thread.threadId,
      message.messageId,
      message.internetMessageId ?? null,
      message.sentAt,
      new TextEncoder().encode(message.bodyText).byteLength,
      message.bodyHtml
        ? new TextEncoder().encode(message.bodyHtml).byteLength
        : 0,
      message.attachments?.length ?? 0,
    ])),
  );

  await insertRows(
    transaction,
    'local_mail_message_participants',
    [
      'account_id',
      'thread_id',
      'message_id',
      'role',
      'ordinal',
      'display_name',
      'address',
    ],
    state.threads.flatMap(thread => thread.messages.flatMap(message =>
      messageParticipants({
        ...thread,
        messages: [message],
      }).map(participant => [
        participant.accountId,
        participant.threadId,
        participant.messageId,
        participant.role,
        participant.ordinal,
        participant.displayName,
        participant.address,
      ]),
    )),
  );

  await insertRows(
    transaction,
    'local_mail_attachment_metadata',
    [
      'account_id',
      'thread_id',
      'message_id',
      'resource_id',
      'file_name',
      'mime_type',
      'size_bytes',
      'disposition',
      'content_id',
    ],
    state.threads.flatMap(thread => thread.messages.flatMap(message =>
      (message.attachments ?? []).map(attachment => [
        thread.accountId,
        thread.threadId,
        message.messageId,
        attachment.resourceId,
        attachment.fileName,
        attachment.mimeType,
        attachment.sizeBytes,
        attachment.disposition,
        attachment.contentId,
      ]),
    )),
  );

  await transaction.execute(
    `INSERT INTO local_mail_replica_metadata (
       id, source_updated_at, indexed_at
     ) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       source_updated_at = excluded.source_updated_at,
       indexed_at = excluded.indexed_at`,
    [1, sourceUpdatedAt, indexedAt],
  );
}

export async function deleteNormalizedLocalAccount(
  transaction: MiniAppPrivateSqlTransaction,
  accountId: string,
): Promise<void> {
  for (const table of normalizedTablesInDeleteOrder) {
    await transaction.execute(`DELETE FROM ${table} WHERE account_id = ?`, [accountId]);
  }
}

export async function deleteNormalizedLocalReplica(
  transaction: MiniAppPrivateSqlTransaction,
): Promise<void> {
  for (const table of normalizedTablesInDeleteOrder) {
    await transaction.execute(`DELETE FROM ${table}`);
  }
  await transaction.execute('DELETE FROM local_mail_replica_metadata WHERE id = ?', [1]);
}

function commandForOtherAccount(command: MailCommand, accountId: string): boolean {
  return command.accountId !== accountId;
}

export function mailStateWithoutAccount(
  state: MailState,
  accountId: string,
): MailState {
  const removedThreadKeys = new Set(
    state.threads
      .filter(thread => thread.accountId === accountId)
      .map(emailThreadKey),
  );
  const undo = state.undo && (
    state.undo.kind === 'send'
      ? state.undo.accountId === accountId
      : state.undo.thread.accountId === accountId
  ) ? null : state.undo;
  return {
    ...state,
    accounts: state.accounts.filter(account => account.accountId !== accountId),
    threads: state.threads.filter(thread => thread.accountId !== accountId),
    selectedAccountId:
      state.selectedAccountId === accountId ? 'all' : state.selectedAccountId,
    selectedThreadKey:
      state.selectedThreadKey && removedThreadKeys.has(state.selectedThreadKey)
        ? null
        : state.selectedThreadKey,
    commands: state.commands.filter(command => commandForOtherAccount(command, accountId)),
    outbox: state.outbox?.filter(item =>
      item.attempts[0]?.command.accountId !== accountId
    ),
    preferences: {
      ...state.preferences,
      notificationAccountIds: state.preferences.notificationAccountIds.filter(
        candidate => candidate !== accountId,
      ),
    },
    undo,
  };
}
