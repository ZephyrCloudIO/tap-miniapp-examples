import type {
  BoundedMailMessage,
  EmailProvider,
  EmailMessageRef,
  EmailThreadRef,
  ExactMailMessageReadRequest,
  ExactMailThreadRequest,
  MailAccountDescriptor,
  MailAccountCoverage,
  MailAccountListResult,
  MailAttachmentDescriptor,
  MailCommandReceiptRequest,
  MailCommandReceiptResult,
  MailCommandReceipt,
  MailCoverageCompleteness,
  MailCoverageReceipt,
  MailMessageReadResult,
  MailMessageMetadata,
  MailParticipant,
  MailReadPort,
  MailResource,
  MailThreadReadResult,
  MailThreadDescriptor,
  MailThreadSearchResult,
  StructuredMailSearchRequest,
} from '@tap-examples/tap-email-protocol';
import { isSafeMailIdentifier } from '@tap-examples/tap-email-protocol';
import { openSecret, sealSecret, sha256Base64Url } from './crypto';

const maximumThreadPageSize = 50;
const maximumThreadMessages = 50;
const maximumThreadAttachments = 1_000;
const maximumMessageReadCount = 10;
const maximumMessageCharacters = 20_000;
const maximumCursorCharacters = 4_096;

export class McpMailError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

interface AccountRow {
  readonly provider: EmailProvider;
  readonly account_id: string;
  readonly email_address: string | null;
  readonly display_name: string | null;
  readonly connection_state: 'active' | 'reauthorization_required' | 'revoked';
  readonly coverage_state: MailAccountCoverage['state'];
  readonly newest_history_id: string | null;
  readonly backfill_complete_through: string | null;
  readonly unresolved_failures: number;
  readonly updated_at: string;
}

interface ThreadRow {
  readonly account_id: string;
  readonly thread_id: string;
  readonly history_id: string;
  readonly subject: string;
  readonly participants_json: string;
  readonly received_at: string;
  readonly unread: number;
  readonly starred: number;
  readonly important: number;
  readonly in_inbox: number;
  readonly needs_response: number;
  readonly waiting_on_others: number;
  readonly label_ids_json: string;
  readonly latest_message_id: string | null;
}

interface MessageRow {
  readonly message_id: string;
  readonly internet_message_id: string | null;
  readonly sender_json: string;
  readonly recipients_json: string;
  readonly sent_at: string;
  readonly body_text_ciphertext?: string;
}

interface AttachmentRow {
  readonly message_id: string;
  readonly resource_id: string;
  readonly file_name: string;
  readonly mime_type: string;
  readonly size_bytes: number;
  readonly disposition: 'attachment' | 'inline';
  readonly content_id: string | null;
}

interface SearchCursor {
  readonly v: 2;
  readonly queryHash: string;
  readonly receivedAt: string;
  readonly accountId: string;
  readonly threadId: string;
}

function bounded(value: unknown, maximum: number): string {
  return typeof value === 'string' ? value.slice(0, maximum) : '';
}

function validInstant(value: string | null): boolean {
  return value === null || Number.isFinite(Date.parse(value));
}

function assertExactThreadScope(request: EmailThreadRef): void {
  if (
    !isSafeMailIdentifier(request.accountId) ||
    !isSafeMailIdentifier(request.threadId)
  ) {
    throw new McpMailError(
      'invalid_thread_scope',
      'The read requires one exact account ID and thread ID.',
    );
  }
}

function participants(value: string): readonly MailParticipant[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, 100).flatMap(candidate => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
      const record = candidate as Readonly<Record<string, unknown>>;
      return [{
        name: bounded(record.name, 500),
        address: bounded(record.address, 2_000),
      }];
    });
  } catch {
    return [];
  }
}

function labels(value: string): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((label): label is string => typeof label === 'string')
        .slice(0, 100)
        .map(label => label.slice(0, 256))
      : [];
  } catch {
    return [];
  }
}

function coverage(row: AccountRow): MailAccountCoverage {
  return {
    accountId: row.account_id,
    state: row.coverage_state,
    newestProviderRevision: row.newest_history_id,
    observedAt: row.updated_at,
    backfillCompleteThrough: row.backfill_complete_through,
    unresolvedFailures: row.unresolved_failures,
  };
}

function account(row: AccountRow): MailAccountDescriptor {
  return {
    accountId: row.account_id,
    provider: row.provider,
    address: bounded(row.email_address, 2_000),
    displayName: bounded(row.display_name ?? row.email_address ?? 'Email account', 500),
    connectionState: row.connection_state === 'active'
      ? 'active'
      : 'reauthorization_required',
    coverage: coverage(row),
  };
}

async function accountRows(
  env: Env,
  profileId: string,
  requestedAccountIds?: readonly string[],
): Promise<readonly AccountRow[]> {
  const where = requestedAccountIds
    ? `AND account_id IN (${requestedAccountIds.map(() => '?').join(', ')})`
    : '';
  const result = await env.DB.prepare(
    `SELECT 'google' AS provider, account_id, email_address, display_name, connection_state,
            coverage_state, newest_history_id, backfill_complete_through,
            unresolved_failures, updated_at
       FROM google_accounts
      WHERE profile_id = ? AND connection_state != 'revoked' ${where}
      ORDER BY created_at, account_id`,
  ).bind(profileId, ...(requestedAccountIds ?? [])).all<AccountRow>();
  if (requestedAccountIds) {
    const found = new Set(result.results.map(row => row.account_id));
    if (requestedAccountIds.some(accountId => !found.has(accountId))) {
      throw new McpMailError(
        'account_not_found',
        'One or more selected email account IDs are unavailable.',
      );
    }
  }
  return result.results;
}

function coverageCompleteness(
  accounts: readonly AccountRow[],
  resources: readonly MailResource[],
  afterInclusive: string | null,
  hasExactScope: boolean,
  broadReplicaCanCover: boolean,
): MailCoverageCompleteness {
  if (resources.every(resource => resource === 'account-metadata' || resource === 'command-receipt')) {
    return 'complete';
  }
  if (accounts.length === 0) return 'unknown';
  // The current replica does not persist provider counts or per-message MIME
  // loss flags, so exact thread/content completeness cannot yet be proven.
  if (hasExactScope || !broadReplicaCanCover) return 'partial';
  const queryStart = afterInclusive === null ? null : Date.parse(afterInclusive);
  return accounts.every(row => {
    if (row.coverage_state !== 'current' || row.unresolved_failures !== 0) return false;
    if (queryStart === null) return false;
    const backfillThrough = row.backfill_complete_through === null
      ? Number.NaN
      : Date.parse(row.backfill_complete_through);
    return Number.isFinite(backfillThrough) && backfillThrough <= queryStart;
  }) ? 'complete' : 'partial';
}

function coverageWarnings(
  accounts: readonly AccountRow[],
  resources: readonly MailResource[],
  afterInclusive: string | null,
  contentTruncated: boolean,
  hasExactScope: boolean,
  broadReplicaCanCover: boolean,
): readonly string[] {
  const warnings: string[] = [];
  if (
    !hasExactScope &&
    !broadReplicaCanCover &&
    resources.some(resource => resource === 'thread-metadata' || resource === 'message-metadata')
  ) {
    warnings.push(
      'Coordinator coverage currently describes synchronized inbox history; Sent, Drafts, Spam, and provider-wide archives may be incomplete.',
    );
  }
  if (
    hasExactScope &&
    resources.some(resource =>
      resource === 'thread-metadata' ||
      resource === 'message-metadata' ||
      resource === 'message-content')
  ) {
    warnings.push(
      'Exact replica reads cannot yet prove that older provider messages, oversized MIME bodies, or attachment metadata were fully ingested.',
    );
  }
  if (
    !hasExactScope &&
    afterInclusive === null &&
    resources.some(resource => resource !== 'account-metadata' && resource !== 'command-receipt')
  ) {
    warnings.push(
      'No lower date bound was supplied, so completeness before each account backfill horizon is unknown.',
    );
  }
  for (const row of accounts) {
    if (row.coverage_state !== 'current' || row.unresolved_failures !== 0) {
      warnings.push(
        `Account ${row.account_id} coverage is ${row.coverage_state} with ${row.unresolved_failures} unresolved failure(s).`,
      );
    }
  }
  if (contentTruncated) {
    warnings.push('One or more results were truncated to the requested safety limit.');
  }
  return warnings.slice(0, 32);
}

function receipt(input: {
  readonly now: Date;
  readonly accounts: readonly AccountRow[];
  readonly resources: readonly MailResource[];
  readonly threadRefs?: readonly EmailThreadRef[];
  readonly messageRefs?: readonly EmailMessageRef[];
  readonly afterInclusive?: string | null;
  readonly beforeExclusive?: string | null;
  readonly resultTruncated?: boolean;
  readonly nextCursor?: string | null;
  readonly broadReplicaCanCover?: boolean;
}): MailCoverageReceipt {
  const afterInclusive = input.afterInclusive ?? null;
  const resultTruncated = input.resultTruncated ?? false;
  const threadRefs = input.threadRefs ?? [];
  const messageRefs = input.messageRefs ?? [];
  const hasExactScope = threadRefs.length > 0 || messageRefs.length > 0;
  const broadReplicaCanCover = input.broadReplicaCanCover ?? false;
  const baseCompleteness = coverageCompleteness(
    input.accounts,
    input.resources,
    afterInclusive,
    hasExactScope,
    broadReplicaCanCover,
  );
  return {
    version: 1,
    observedAt: input.now.toISOString(),
    request: {
      accountIds: input.accounts.map(row => row.account_id),
      resources: input.resources,
      threadRefs,
      messageRefs,
      afterInclusive,
      beforeExclusive: input.beforeExclusive ?? null,
    },
    accounts: input.accounts.map(coverage),
    completeness: resultTruncated ? 'partial' : baseCompleteness,
    source: 'coordinator-replica',
    fallback: baseCompleteness === 'complete' ? 'not-needed' : 'unavailable',
    resultTruncated,
    nextCursor: input.nextCursor ?? null,
    warnings: coverageWarnings(
      input.accounts,
      input.resources,
      afterInclusive,
      resultTruncated,
      hasExactScope,
      broadReplicaCanCover,
    ),
  };
}

function thread(row: ThreadRow): MailThreadDescriptor {
  return {
    accountId: row.account_id,
    threadId: row.thread_id,
    providerRevision: row.history_id,
    subject: bounded(row.subject, 998),
    participants: participants(row.participants_json),
    receivedAt: row.received_at,
    unread: row.unread === 1,
    starred: row.starred === 1,
    critical: row.important === 1,
    needsResponse: row.needs_response === 1,
    waitingOnOthers: row.waiting_on_others === 1,
    inInbox: row.in_inbox === 1,
    labels: labels(row.label_ids_json),
    latestMessageRef: row.latest_message_id === null ? null : {
      accountId: row.account_id,
      threadId: row.thread_id,
      messageId: row.latest_message_id,
    },
  };
}

function attachment(row: AttachmentRow): MailAttachmentDescriptor {
  return {
    resourceId: row.resource_id,
    fileName: bounded(row.file_name, 1_024),
    mimeType: bounded(row.mime_type, 255),
    sizeBytes: row.size_bytes,
    disposition: row.disposition,
    contentId: row.content_id === null ? null : bounded(row.content_id, 2_000),
  };
}

function messageMetadata(
  row: MessageRow,
  accountId: string,
  threadId: string,
  attachments: readonly MailAttachmentDescriptor[],
): MailMessageMetadata {
  return {
    accountId,
    threadId,
    messageId: row.message_id,
    internetMessageId: row.internet_message_id === null
      ? null
      : bounded(row.internet_message_id, 2_000),
    from: participants(`[${row.sender_json}]`)[0] ?? {
      name: 'Unknown sender',
      address: 'unknown@invalid.local',
    },
    to: participants(row.recipients_json),
    sentAt: row.sent_at,
    attachments,
  };
}

async function searchQueryHash(
  profileId: string,
  request: StructuredMailSearchRequest,
  normalizedText: string | null,
  afterInclusive: string | null,
  beforeExclusive: string | null,
): Promise<string> {
  return sha256Base64Url(JSON.stringify({
    v: 1,
    profileId,
    accountIds: [...request.accountIds].toSorted(),
    text: normalizedText,
    afterInclusive,
    beforeExclusive,
    unread: request.unread,
    starred: request.starred,
    needsResponse: request.needsResponse,
    waitingOnOthers: request.waitingOnOthers,
    inInbox: request.inInbox,
    labels: [...request.labels].toSorted(),
  }));
}

async function cursor(
  value: string | null,
  secret: string,
  expectedQueryHash: string,
): Promise<SearchCursor | null> {
  if (value === null) return null;
  try {
    if (value.length > maximumCursorCharacters) throw new Error();
    const parsed: unknown = JSON.parse(await openSecret(value, secret));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    const candidate = parsed as Readonly<Record<string, unknown>>;
    if (
      candidate.v !== 2 ||
      candidate.queryHash !== expectedQueryHash ||
      typeof candidate.receivedAt !== 'string' ||
      !Number.isFinite(Date.parse(candidate.receivedAt)) ||
      !isSafeMailIdentifier(candidate.accountId) ||
      !isSafeMailIdentifier(candidate.threadId)
    ) {
      throw new Error();
    }
    return {
      v: 2,
      queryHash: expectedQueryHash,
      receivedAt: candidate.receivedAt,
      accountId: candidate.accountId,
      threadId: candidate.threadId,
    };
  } catch {
    throw new McpMailError('invalid_cursor', 'The email search cursor is invalid.');
  }
}

function nextCursor(
  row: ThreadRow,
  secret: string,
  queryHash: string,
): Promise<string> {
  return sealSecret(JSON.stringify({
    v: 2,
    queryHash,
    receivedAt: row.received_at,
    accountId: row.account_id,
    threadId: row.thread_id,
  } satisfies SearchCursor), secret);
}

export async function listEmailAccounts(
  env: Env,
  profileId: string,
  now = new Date(),
): Promise<MailAccountListResult> {
  const rows = await accountRows(env, profileId);
  return {
    untrustedContent: true as const,
    accounts: rows.map(account),
    coverage: receipt({
      now,
      accounts: rows,
      resources: ['account-metadata'],
    }),
  };
}

export async function searchEmailThreads(
  env: Env,
  profileId: string,
  request: StructuredMailSearchRequest,
  now = new Date(),
): Promise<MailThreadSearchResult> {
  if (
    request.accountIds.length === 0 ||
    request.accountIds.length > 20 ||
    new Set(request.accountIds).size !== request.accountIds.length ||
    request.accountIds.some(accountId => !isSafeMailIdentifier(accountId))
  ) {
    throw new McpMailError(
      'invalid_account_scope',
      'Search requires one to twenty distinct exact account IDs.',
    );
  }
  if (
    !Number.isInteger(request.limit) ||
    request.limit < 1 ||
    request.limit > maximumThreadPageSize
  ) {
    throw new McpMailError('invalid_limit', 'Search limit is out of range.');
  }
  if (
    !validInstant(request.afterInclusive) ||
    !validInstant(request.beforeExclusive)
  ) {
    throw new McpMailError('invalid_date_range', 'Search dates must be ISO instants.');
  }
  if (
    request.afterInclusive !== null &&
    request.beforeExclusive !== null &&
    Date.parse(request.afterInclusive) >= Date.parse(request.beforeExclusive)
  ) {
    throw new McpMailError('invalid_date_range', 'Search start must precede its end.');
  }
  if (request.text !== null && request.text.length > 512) {
    throw new McpMailError('invalid_text_query', 'Search text is too long.');
  }
  if (
    request.labels.length > 20 ||
    request.labels.some(label => label.length === 0 || label.length > 256)
  ) {
    throw new McpMailError('invalid_label_filter', 'Search label filters are invalid.');
  }
  const normalizedText = request.text?.trim() || null;
  const afterInclusive = request.afterInclusive === null
    ? null
    : new Date(request.afterInclusive).toISOString();
  const beforeExclusive = request.beforeExclusive === null
    ? null
    : new Date(request.beforeExclusive).toISOString();
  const queryHash = await searchQueryHash(
    profileId,
    request,
    normalizedText,
    afterInclusive,
    beforeExclusive,
  );
  const accounts = await accountRows(env, profileId, request.accountIds);
  const searchCursor = await cursor(
    request.cursor,
    env.GOOGLE_TOKEN_ENCRYPTION_KEY,
    queryHash,
  );
  const clauses = [
    't.profile_id = ?',
    `t.account_id IN (${request.accountIds.map(() => '?').join(', ')})`,
  ];
  const bindings: unknown[] = [profileId, ...request.accountIds];
  if (normalizedText !== null) {
    clauses.push(
      '(instr(lower(t.subject), lower(?)) > 0 OR instr(lower(t.participants_json), lower(?)) > 0)',
    );
    bindings.push(normalizedText, normalizedText);
  }
  if (afterInclusive !== null) {
    clauses.push('t.received_at >= ?');
    bindings.push(afterInclusive);
  }
  if (beforeExclusive !== null) {
    clauses.push('t.received_at < ?');
    bindings.push(beforeExclusive);
  }
  for (const [column, value] of [
    ['t.unread', request.unread],
    ['t.starred', request.starred],
    ['t.needs_response', request.needsResponse],
    ['t.waiting_on_others', request.waitingOnOthers],
    ['t.in_inbox', request.inInbox],
  ] as const) {
    if (value !== null) {
      clauses.push(`${column} = ?`);
      bindings.push(value ? 1 : 0);
    }
  }
  for (const label of request.labels) {
    clauses.push(
      'EXISTS (SELECT 1 FROM json_each(t.label_ids_json) label WHERE label.value = ?)',
    );
    bindings.push(label);
  }
  if (searchCursor) {
    clauses.push(
      '(t.received_at < ? OR (t.received_at = ? AND (t.account_id > ? OR (t.account_id = ? AND t.thread_id > ?))))',
    );
    bindings.push(
      searchCursor.receivedAt,
      searchCursor.receivedAt,
      searchCursor.accountId,
      searchCursor.accountId,
      searchCursor.threadId,
    );
  }
  bindings.push(request.limit + 1);
  const result = await env.DB.prepare(
    `SELECT t.account_id, t.thread_id, t.history_id, t.subject,
            t.participants_json, t.received_at, t.unread, t.starred,
            t.important, t.in_inbox, t.needs_response, t.waiting_on_others,
            t.label_ids_json,
            (SELECT m.message_id FROM mail_messages m
              WHERE m.profile_id = t.profile_id AND m.account_id = t.account_id
                AND m.thread_id = t.thread_id
              ORDER BY m.ordinal DESC LIMIT 1) AS latest_message_id
       FROM mail_threads t
      WHERE ${clauses.join(' AND ')}
      ORDER BY t.received_at DESC, t.account_id, t.thread_id
      LIMIT ?`,
  ).bind(...bindings).all<ThreadRow>();
  const rows = result.results.slice(0, request.limit);
  const hasMore = result.results.length > request.limit;
  const continuation = hasMore && rows.length > 0
    ? await nextCursor(
      rows[rows.length - 1]!,
      env.GOOGLE_TOKEN_ENCRYPTION_KEY,
      queryHash,
    )
    : null;
  return {
    untrustedContent: true as const,
    matchingMode: 'deterministic-metadata-substring-and-structured-filters' as const,
    threads: rows.map(thread),
    coverage: receipt({
      now,
      accounts,
      resources: ['thread-metadata'],
      afterInclusive,
      beforeExclusive,
      resultTruncated: hasMore || searchCursor !== null,
      nextCursor: continuation,
      broadReplicaCanCover: request.inInbox === true,
    }),
  };
}

async function exactThreadRow(
  env: Env,
  profileId: string,
  request: ExactMailThreadRequest,
): Promise<ThreadRow> {
  const row = await env.DB.prepare(
    `SELECT t.account_id, t.thread_id, t.history_id, t.subject,
            t.participants_json, t.received_at, t.unread, t.starred,
            t.important, t.in_inbox, t.needs_response, t.waiting_on_others,
            t.label_ids_json,
            (SELECT m.message_id FROM mail_messages m
              WHERE m.profile_id = t.profile_id AND m.account_id = t.account_id
                AND m.thread_id = t.thread_id
              ORDER BY m.ordinal DESC LIMIT 1) AS latest_message_id
       FROM mail_threads t
      WHERE t.profile_id = ? AND t.account_id = ? AND t.thread_id = ?`,
  ).bind(profileId, request.accountId, request.threadId).first<ThreadRow>();
  if (!row) {
    throw new McpMailError('thread_not_found', 'The exact email thread was not found.');
  }
  return row;
}

async function messageAttachments(
  env: Env,
  profileId: string,
  accountId: string,
  threadId: string,
  messageIds: readonly string[],
): Promise<{
  readonly byMessage: ReadonlyMap<string, readonly MailAttachmentDescriptor[]>;
  readonly truncated: boolean;
}> {
  if (messageIds.length === 0) return { byMessage: new Map(), truncated: false };
  const result = await env.DB.prepare(
    `SELECT message_id, resource_id, file_name, mime_type, size_bytes,
            disposition, content_id
       FROM mail_attachments
      WHERE profile_id = ? AND account_id = ? AND thread_id = ?
        AND message_id IN (${messageIds.map(() => '?').join(', ')})
      ORDER BY message_id, gmail_part_path
      LIMIT ?`,
  ).bind(
    profileId,
    accountId,
    threadId,
    ...messageIds,
    maximumThreadAttachments + 1,
  ).all<AttachmentRow>();
  const selected = result.results.slice(0, maximumThreadAttachments);
  const grouped = new Map<string, MailAttachmentDescriptor[]>();
  for (const row of selected) {
    const current = grouped.get(row.message_id) ?? [];
    current.push(attachment(row));
    grouped.set(row.message_id, current);
  }
  return {
    byMessage: grouped,
    truncated: result.results.length > maximumThreadAttachments,
  };
}

export async function getEmailThread(
  env: Env,
  profileId: string,
  request: ExactMailThreadRequest,
  now = new Date(),
): Promise<MailThreadReadResult> {
  assertExactThreadScope(request);
  const accounts = await accountRows(env, profileId, [request.accountId]);
  const selectedThread = await exactThreadRow(env, profileId, request);
  const messageResult = await env.DB.prepare(
    `SELECT message_id, internet_message_id, sender_json, recipients_json, sent_at
       FROM mail_messages
      WHERE profile_id = ? AND account_id = ? AND thread_id = ?
      ORDER BY ordinal
      LIMIT ?`,
  ).bind(
    profileId,
    request.accountId,
    request.threadId,
    maximumThreadMessages + 1,
  ).all<MessageRow>();
  const messageRows = messageResult.results.slice(0, maximumThreadMessages);
  const attachmentResult = await messageAttachments(
    env,
    profileId,
    request.accountId,
    request.threadId,
    messageRows.map(row => row.message_id),
  );
  const truncated = messageResult.results.length > maximumThreadMessages ||
    attachmentResult.truncated;
  const threadRef = { accountId: request.accountId, threadId: request.threadId };
  return {
    untrustedContent: true as const,
    thread: thread(selectedThread),
    messages: messageRows.map(row => messageMetadata(
      row,
      request.accountId,
      request.threadId,
      attachmentResult.byMessage.get(row.message_id) ?? [],
    )),
    coverage: receipt({
      now,
      accounts,
      resources: ['thread-metadata', 'message-metadata'],
      threadRefs: [threadRef],
      resultTruncated: truncated,
    }),
  };
}

export async function readEmailMessages(
  env: Env,
  profileId: string,
  request: ExactMailMessageReadRequest,
  now = new Date(),
): Promise<MailMessageReadResult> {
  assertExactThreadScope(request);
  if (
    request.messageIds.length === 0 ||
    request.messageIds.length > maximumMessageReadCount ||
    new Set(request.messageIds).size !== request.messageIds.length ||
    request.messageIds.some(messageId => !isSafeMailIdentifier(messageId))
  ) {
    throw new McpMailError(
      'invalid_message_scope',
      `Read requires one to ${maximumMessageReadCount} distinct exact message IDs.`,
    );
  }
  if (
    !Number.isInteger(request.maximumCharactersPerMessage) ||
    request.maximumCharactersPerMessage < 1 ||
    request.maximumCharactersPerMessage > maximumMessageCharacters
  ) {
    throw new McpMailError('invalid_content_limit', 'Message character limit is out of range.');
  }
  const accounts = await accountRows(env, profileId, [request.accountId]);
  await exactThreadRow(env, profileId, request);
  const result = await env.DB.prepare(
    `SELECT message_id, internet_message_id, sender_json, recipients_json,
            sent_at, body_text_ciphertext
       FROM mail_messages
      WHERE profile_id = ? AND account_id = ? AND thread_id = ?
        AND message_id IN (${request.messageIds.map(() => '?').join(', ')})`,
  ).bind(
    profileId,
    request.accountId,
    request.threadId,
    ...request.messageIds,
  ).all<MessageRow>();
  const byId = new Map(result.results.map(row => [row.message_id, row] as const));
  if (request.messageIds.some(messageId => !byId.has(messageId))) {
    throw new McpMailError(
      'message_not_found',
      'One or more exact messages were not found in the selected thread.',
    );
  }
  const attachmentResult = await messageAttachments(
    env,
    profileId,
    request.accountId,
    request.threadId,
    request.messageIds,
  );
  const messages: BoundedMailMessage[] = [];
  for (const messageId of request.messageIds) {
    const row = byId.get(messageId)!;
    const plaintext = await openSecret(
      row.body_text_ciphertext!,
      env.GOOGLE_TOKEN_ENCRYPTION_KEY,
    );
    messages.push({
      ...messageMetadata(
        row,
        request.accountId,
        request.threadId,
        attachmentResult.byMessage.get(messageId) ?? [],
      ),
      bodyText: plaintext.slice(0, request.maximumCharactersPerMessage),
      bodyTextTruncated: plaintext.length > request.maximumCharactersPerMessage,
    });
  }
  const truncated = attachmentResult.truncated ||
    messages.some(message => message.bodyTextTruncated);
  const threadRef = { accountId: request.accountId, threadId: request.threadId };
  const messageRefs = request.messageIds.map(messageId => ({ ...threadRef, messageId }));
  return {
    untrustedContent: true as const,
    contentPolicy: {
      rawHtmlIncluded: false,
      remoteImagesIncluded: false,
      attachmentBytesIncluded: false,
      maximumCharactersPerMessage: request.maximumCharactersPerMessage,
    },
    messages,
    coverage: receipt({
      now,
      accounts,
      resources: ['message-content'],
      threadRefs: [threadRef],
      messageRefs,
      resultTruncated: truncated,
    }),
  };
}

export async function getEmailCommandReceipt(
  env: Env,
  profileId: string,
  accountId: string,
  commandId: string,
  now = new Date(),
): Promise<MailCommandReceiptResult> {
  if (!isSafeMailIdentifier(accountId) || !isSafeMailIdentifier(commandId)) {
    throw new McpMailError(
      'invalid_command_scope',
      'The receipt lookup requires one exact account ID and command ID.',
    );
  }
  const accounts = await accountRows(env, profileId, [accountId]);
  const row = await env.DB.prepare(
    `SELECT command_id, idempotency_key, account_id, state, created_at,
            provider_acknowledged_at, error_code
       FROM mail_commands
      WHERE profile_id = ? AND account_id = ? AND command_id = ?`,
  ).bind(profileId, accountId, commandId).first<{
    readonly command_id: string;
    readonly idempotency_key: string;
    readonly account_id: string;
    readonly state: MailCommandReceipt['state'];
    readonly created_at: string;
    readonly provider_acknowledged_at: string | null;
    readonly error_code: string | null;
  }>();
  if (!row) {
    throw new McpMailError('command_not_found', 'The account-scoped command was not found.');
  }
  const commandReceipt: MailCommandReceipt = {
    commandId: row.command_id,
    idempotencyKey: row.idempotency_key,
    accountId: row.account_id,
    state: row.state,
    acceptedAt: row.created_at,
    providerAcknowledgedAt: row.provider_acknowledged_at,
    errorCode: row.error_code,
  };
  return {
    receipt: commandReceipt,
    coverage: receipt({
      now,
      accounts,
      resources: ['command-receipt'],
    }),
  };
}

/** D1 adapter for the profile-bound provider-neutral read port. */
export function createCoordinatorMailReadPort(
  env: Env,
  profileId: string,
  now: () => Date = () => new Date(),
): MailReadPort {
  return {
    listAccounts: () => listEmailAccounts(env, profileId, now()),
    searchThreads: request => searchEmailThreads(env, profileId, request, now()),
    getThread: request => getEmailThread(env, profileId, request, now()),
    readMessages: request => readEmailMessages(env, profileId, request, now()),
    getCommandReceipt: (request: MailCommandReceiptRequest) =>
      getEmailCommandReceipt(
        env,
        profileId,
        request.accountId,
        request.commandId,
        now(),
      ),
  };
}
