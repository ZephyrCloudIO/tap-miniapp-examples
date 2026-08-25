import {
  isSafeMailIdentifier,
  type MailCommand,
} from '@tap-examples/tap-email-protocol';
import { decodeBase64Url, openSecret, sealSecret } from './crypto';
import {
  GoogleApiError,
  accessTokenFor,
  googleJson,
} from './google';
import type { ProviderExecutionResult, ProviderScope } from './provider';
import {
  enqueueSyncEvent,
  enqueueSyncEvents,
  type MailboxSyncRequest,
} from './sync-events';

interface AccountRow {
  readonly profile_id: string;
  readonly account_id: string;
  readonly email_address: string | null;
  readonly display_name: string | null;
  readonly accent: string | null;
  readonly coverage_state: string;
  readonly newest_history_id: string | null;
  readonly backfill_complete_through: string | null;
  readonly unresolved_failures: number;
  readonly updated_at: string;
  readonly backfill_page_token: string | null;
}

interface Participant {
  readonly name: string;
  readonly address: string;
}

interface ParsedMessage {
  readonly messageId: string;
  readonly internetMessageId: string | null;
  readonly from: Participant;
  readonly to: readonly Participant[];
  readonly sentAt: string;
  readonly bodyText: string;
  readonly labelIds: readonly string[];
  readonly snippet: string;
  readonly automated: boolean;
}

interface ParsedThread {
  readonly threadId: string;
  readonly historyId: string;
  readonly subject: string;
  readonly snippet: string;
  readonly participants: readonly Participant[];
  readonly receivedAt: string;
  readonly unread: boolean;
  readonly starred: boolean;
  readonly important: boolean;
  readonly inInbox: boolean;
  readonly needsResponse: boolean;
  readonly waitingOnOthers: boolean;
  readonly labelIds: readonly string[];
  readonly messages: readonly ParsedMessage[];
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function headerValue(
  payload: Readonly<Record<string, unknown>> | null,
  name: string,
): string {
  const headers = Array.isArray(payload?.headers) ? payload.headers : [];
  for (const item of headers) {
    const header = asRecord(item);
    if (
      typeof header?.name === 'string' &&
      header.name.toLowerCase() === name.toLowerCase() &&
      typeof header.value === 'string'
    ) {
      return header.value;
    }
  }
  return '';
}

function participants(value: string): readonly Participant[] {
  const result: Participant[] = [];
  const expression = /(?:"([^"]+)"\s*|([^,<]+?)\s*)?<([^>\s]+@[^>\s]+)>|([^,\s<>]+@[^,\s<>]+)/gu;
  for (const match of value.matchAll(expression)) {
    const address = (match[3] ?? match[4] ?? '').trim().toLowerCase();
    if (!address) continue;
    const name = (match[1] ?? match[2] ?? address.split('@')[0] ?? address).trim();
    if (!result.some(item => item.address === address)) result.push({ name, address });
  }
  return result.slice(0, 50);
}

function bodyPart(
  payload: Readonly<Record<string, unknown>> | null,
  preferredMime: string,
): string | null {
  if (!payload) return null;
  const mimeType = typeof payload.mimeType === 'string' ? payload.mimeType.toLowerCase() : '';
  const body = asRecord(payload.body);
  if (mimeType === preferredMime && typeof body?.data === 'string') {
    return decodeBase64Url(body.data, 100_000);
  }
  const parts = Array.isArray(payload.parts) ? payload.parts : [];
  for (const part of parts) {
    const resolved = bodyPart(asRecord(part), preferredMime);
    if (resolved !== null) return resolved;
  }
  return null;
}

function plainText(payload: Readonly<Record<string, unknown>> | null): string {
  const text = bodyPart(payload, 'text/plain');
  if (text !== null) return text.replaceAll('\r\n', '\n').trim();
  const html = bodyPart(payload, 'text/html');
  if (html === null) return '';
  return html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, ' ')
    .replace(/<br\s*\/?>/giu, '\n')
    .replace(/<\/p>/giu, '\n')
    .replace(/<[^>]+>/gu, ' ')
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
    .slice(0, 100_000);
}

function parseMessage(value: unknown, ordinal: number): ParsedMessage | null {
  const message = asRecord(value);
  if (!message || typeof message.id !== 'string') return null;
  const payload = asRecord(message.payload);
  const from = participants(headerValue(payload, 'From'))[0] ?? {
    name: 'Unknown sender',
    address: 'unknown@invalid.local',
  };
  const sentAtValue = typeof message.internalDate === 'string'
    ? Number(message.internalDate)
    : Number.NaN;
  const dateHeader = Date.parse(headerValue(payload, 'Date'));
  const sentAt = Number.isFinite(sentAtValue)
    ? new Date(sentAtValue).toISOString()
    : Number.isFinite(dateHeader)
      ? new Date(dateHeader).toISOString()
      : new Date(0).toISOString();
  const listUnsubscribe = headerValue(payload, 'List-Unsubscribe');
  return {
    messageId: message.id,
    internetMessageId: headerValue(payload, 'Message-ID') || null,
    from,
    to: participants(headerValue(payload, 'To')),
    sentAt,
    bodyText: plainText(payload),
    labelIds: stringArray(message.labelIds),
    snippet: typeof message.snippet === 'string' ? message.snippet.slice(0, 2_000) : '',
    automated:
      Boolean(listUnsubscribe) ||
      /(^|[._-])(no-?reply|notifications?|mailer-daemon)([._@+-]|$)/iu.test(from.address),
  };
}

function parseThread(value: unknown, accountAddress: string): ParsedThread | null {
  const thread = asRecord(value);
  if (!thread || typeof thread.id !== 'string') return null;
  const rawMessages = Array.isArray(thread.messages) ? thread.messages : [];
  const parsedMessages = rawMessages
    .map(parseMessage)
    .filter((item): item is ParsedMessage => item !== null)
    .toSorted((left, right) => left.sentAt.localeCompare(right.sentAt));
  const latest = parsedMessages.at(-1);
  if (!latest) return null;
  const firstPayload = asRecord(asRecord(rawMessages[0])?.payload);
  const allLabels = new Set(parsedMessages.flatMap(message => message.labelIds));
  const ownAddress = accountAddress.toLowerCase();
  const latestFromSelf = latest.from.address === ownAddress;
  const externalParticipants = parsedMessages
    .flatMap(message => [message.from, ...message.to])
    .filter(person => person.address !== ownAddress)
    .filter((person, index, items) => items.findIndex(item => item.address === person.address) === index)
    .slice(0, 50);
  return {
    threadId: thread.id,
    historyId: typeof thread.historyId === 'string' ? thread.historyId : '0',
    subject: headerValue(firstPayload, 'Subject') || '(no subject)',
    snippet: latest.snippet,
    participants: externalParticipants.length > 0 ? externalParticipants : [latest.from],
    receivedAt: latest.sentAt,
    unread: allLabels.has('UNREAD'),
    starred: allLabels.has('STARRED'),
    important: allLabels.has('IMPORTANT') || allLabels.has('STARRED'),
    inInbox: allLabels.has('INBOX'),
    needsResponse: allLabels.has('INBOX') && !latestFromSelf && !latest.automated,
    waitingOnOthers: allLabels.has('INBOX') && latestFromSelf,
    labelIds: [...allLabels].toSorted(),
    messages: parsedMessages.slice(-20),
  };
}

async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  task: (value: T) => Promise<R>,
): Promise<readonly R[]> {
  const results: R[] = [];
  for (let offset = 0; offset < values.length; offset += concurrency) {
    const group = values.slice(offset, offset + concurrency);
    results.push(...await Promise.all(group.map(task)));
  }
  return results;
}

async function persistThread(
  env: Env,
  scope: ProviderScope,
  thread: ParsedThread,
  accountAddress: string,
  now: string,
): Promise<void> {
  const sealedBodies = await Promise.all(
    thread.messages.map(message =>
      sealSecret(message.bodyText, env.GOOGLE_TOKEN_ENCRYPTION_KEY),
    ),
  );
  const statements = [
    env.DB.prepare(
      `INSERT INTO mail_threads
         (profile_id, account_id, thread_id, history_id, subject, snippet,
          participants_json, received_at, unread, starred, important,
          in_inbox, needs_response, waiting_on_others, label_ids_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(profile_id, account_id, thread_id) DO UPDATE SET
         history_id = excluded.history_id, subject = excluded.subject,
         snippet = excluded.snippet, participants_json = excluded.participants_json,
         received_at = excluded.received_at, unread = excluded.unread,
         starred = excluded.starred, important = excluded.important,
         in_inbox = excluded.in_inbox, needs_response = excluded.needs_response,
         waiting_on_others = excluded.waiting_on_others,
         label_ids_json = excluded.label_ids_json, updated_at = excluded.updated_at`,
    ).bind(
      scope.profileId,
      scope.accountId,
      thread.threadId,
      thread.historyId,
      thread.subject.slice(0, 998),
      thread.snippet,
      JSON.stringify(thread.participants),
      thread.receivedAt,
      Number(thread.unread),
      Number(thread.starred),
      Number(thread.important),
      Number(thread.inInbox),
      Number(thread.needsResponse),
      Number(thread.waitingOnOthers),
      JSON.stringify(thread.labelIds),
      now,
    ),
    env.DB.prepare(
      `DELETE FROM mail_messages
        WHERE profile_id = ? AND account_id = ? AND thread_id = ?`,
    ).bind(scope.profileId, scope.accountId, thread.threadId),
    ...thread.messages.map((message, ordinal) =>
      env.DB.prepare(
        `INSERT INTO mail_messages
           (profile_id, account_id, thread_id, message_id, internet_message_id,
            sender_json, recipients_json, sent_at, body_text_ciphertext, ordinal, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        scope.profileId,
        scope.accountId,
        thread.threadId,
        message.messageId,
        message.internetMessageId,
        JSON.stringify(message.from),
        JSON.stringify(message.to),
        message.sentAt,
        sealedBodies[ordinal]!,
        ordinal,
        now,
      ),
    ),
  ];
  await env.DB.batch(statements);
  const latest = thread.messages.at(-1);
  if (latest && latest.from.address !== accountAddress.toLowerCase()) {
    await env.DB.prepare(
      `UPDATE tap_reminders
          SET state = 'satisfied', updated_at = ?
        WHERE profile_id = ? AND account_id = ? AND thread_id = ?
          AND state IN ('pending', 'due') AND condition = 'if_no_reply'
          AND created_at < ?`,
    )
      .bind(now, scope.profileId, scope.accountId, thread.threadId, latest.sentAt)
      .run();
  }
}

async function fetchAndPersistThreads(
  env: Env,
  scope: ProviderScope,
  accessToken: string,
  accountAddress: string,
  threadIds: readonly string[],
  now: string,
): Promise<readonly ParsedThread[]> {
  const resolved = await mapConcurrent(threadIds, 5, async threadId => {
    try {
      const raw = await googleJson(
        accessToken,
        `/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?format=full`,
      );
      return parseThread(raw, accountAddress);
    } catch (error) {
      if (error instanceof GoogleApiError && error.status === 404) {
        await env.DB.prepare(
          `UPDATE mail_threads SET in_inbox = 0, updated_at = ?
            WHERE profile_id = ? AND account_id = ? AND thread_id = ?`,
        )
          .bind(now, scope.profileId, scope.accountId, threadId)
          .run();
        return null;
      }
      throw error;
    }
  });
  const parsed = resolved.filter((item): item is ParsedThread => item !== null);
  for (const thread of parsed) {
    await persistThread(env, scope, thread, accountAddress, now);
  }
  return parsed;
}

async function accountRow(env: Env, scope: ProviderScope): Promise<AccountRow> {
  const row = await env.DB.prepare(
    `SELECT profile_id, account_id, email_address, display_name, accent,
            coverage_state, newest_history_id, backfill_complete_through,
            unresolved_failures, updated_at, backfill_page_token
       FROM google_accounts
      WHERE profile_id = ? AND account_id = ? AND connection_state = 'active'`,
  )
    .bind(scope.profileId, scope.accountId)
    .first<AccountRow>();
  if (!row || !row.email_address) {
    throw new GoogleApiError(404, 'google_connection_required', 'The Google account is not connected.');
  }
  return row;
}

async function newestPage(
  env: Env,
  scope: ProviderScope,
  row: AccountRow,
  accessToken: string,
  pageToken: string | undefined,
  reset: boolean,
  now: Date,
): Promise<void> {
  const parameters = new URLSearchParams({ labelIds: 'INBOX', maxResults: '25' });
  if (pageToken) parameters.set('pageToken', pageToken);
  const [listed, profile] = await Promise.all([
    googleJson(accessToken, `/gmail/v1/users/me/threads?${parameters.toString()}`),
    pageToken ? Promise.resolve(null) : googleJson(accessToken, '/gmail/v1/users/me/profile'),
  ]);
  const threadIds = (Array.isArray(listed.threads) ? listed.threads : [])
    .map(item => asRecord(item)?.id)
    .filter((item): item is string => typeof item === 'string');
  const parsed = await fetchAndPersistThreads(
    env,
    scope,
    accessToken,
    row.email_address!,
    threadIds,
    now.toISOString(),
  );
  const nextPageToken = typeof listed.nextPageToken === 'string' ? listed.nextPageToken : null;
  // The first newest-first page is only an exhaustive Inbox view when Gmail
  // does not return a continuation token. Preserve older cached rows during a
  // paginated backfill so a fast refresh never makes known mail disappear.
  if (reset && !nextPageToken) {
    const currentThreadIds = parsed.map(thread => thread.threadId);
    const exclusions = currentThreadIds.length > 0
      ? ` AND thread_id NOT IN (${currentThreadIds.map(() => '?').join(', ')})`
      : '';
    await env.DB.prepare(
      `UPDATE mail_threads SET in_inbox = 0, updated_at = ?
        WHERE profile_id = ? AND account_id = ?${exclusions}`,
    )
      .bind(now.toISOString(), scope.profileId, scope.accountId, ...currentThreadIds)
      .run();
  }
  let oldest = row.backfill_complete_through;
  for (const thread of parsed) {
    if (!oldest || thread.receivedAt < oldest) oldest = thread.receivedAt;
  }
  const historyId =
    profile && typeof profile.historyId === 'string'
      ? profile.historyId
      : row.newest_history_id;
  await env.DB.prepare(
    `UPDATE google_accounts
        SET coverage_state = ?, newest_history_id = ?,
            backfill_complete_through = ?, backfill_page_token = ?,
            unresolved_failures = 0, updated_at = ?
      WHERE profile_id = ? AND account_id = ?`,
  )
    .bind(
      nextPageToken ? 'backfilling' : 'current',
      historyId,
      oldest,
      nextPageToken,
      now.toISOString(),
      scope.profileId,
      scope.accountId,
    )
    .run();
  if (nextPageToken) {
    await enqueueSyncEvent(env, {
      profileId: scope.profileId,
      accountId: scope.accountId,
      mode: 'continue',
      pageToken: nextPageToken,
    }, now, 1);
  }
}

function historyThreadIds(value: unknown): readonly string[] {
  const response = asRecord(value);
  const ids = new Set<string>();
  const history = Array.isArray(response?.history) ? response.history : [];
  for (const rawEntry of history) {
    const entry = asRecord(rawEntry);
    const changes = [
      ...(Array.isArray(entry?.messages)
        ? entry.messages.map(message => ({ message }))
        : []),
      ...(Array.isArray(entry?.messagesAdded) ? entry.messagesAdded : []),
      ...(Array.isArray(entry?.messagesDeleted) ? entry.messagesDeleted : []),
      ...(Array.isArray(entry?.labelsAdded) ? entry.labelsAdded : []),
      ...(Array.isArray(entry?.labelsRemoved) ? entry.labelsRemoved : []),
    ];
    for (const rawChange of changes) {
      const message = asRecord(asRecord(rawChange)?.message);
      if (typeof message?.threadId === 'string') ids.add(message.threadId);
    }
  }
  return [...ids];
}

async function partialPage(
  env: Env,
  scope: ProviderScope,
  row: AccountRow,
  accessToken: string,
  startHistoryId: string,
  pageToken: string | undefined,
  now: Date,
): Promise<void> {
  const parameters = new URLSearchParams({
    maxResults: '25',
    startHistoryId,
  });
  if (pageToken) parameters.set('pageToken', pageToken);
  let history: Readonly<Record<string, unknown>>;
  try {
    history = await googleJson(
      accessToken,
      `/gmail/v1/users/me/history?${parameters.toString()}`,
    );
  } catch (error) {
    if (error instanceof GoogleApiError && error.status === 404) {
      await newestPage(env, scope, row, accessToken, undefined, true, now);
      return;
    }
    throw error;
  }
  const threadIds = historyThreadIds(history);
  if (threadIds.length > 50) {
    await newestPage(env, scope, row, accessToken, undefined, true, now);
    return;
  }
  await fetchAndPersistThreads(
    env,
    scope,
    accessToken,
    row.email_address!,
    threadIds,
    now.toISOString(),
  );
  const nextPageToken = typeof history.nextPageToken === 'string' ? history.nextPageToken : null;
  if (nextPageToken) {
    await enqueueSyncEvent(env, {
      profileId: scope.profileId,
      accountId: scope.accountId,
      mode: 'partial',
      startHistoryId,
      pageToken: nextPageToken,
    }, now, 1);
    return;
  }
  await env.DB.prepare(
    `UPDATE google_accounts
        SET coverage_state = 'current', newest_history_id = ?,
            unresolved_failures = 0, updated_at = ?
      WHERE profile_id = ? AND account_id = ?`,
  )
    .bind(
      typeof history.historyId === 'string' ? history.historyId : startHistoryId,
      now.toISOString(),
      scope.profileId,
      scope.accountId,
    )
    .run();
}

export async function syncGoogleMailbox(
  env: Env,
  message: MailboxSyncRequest,
  now: Date,
): Promise<void> {
  const scope = { profileId: message.profileId, accountId: message.accountId };
  const row = await accountRow(env, scope);
  const accessToken = await accessTokenFor(env, scope, now);
  if (message.mode === 'newest') {
    await newestPage(env, scope, row, accessToken, undefined, true, now);
    return;
  }
  if (message.mode === 'continue') {
    const pageToken = message.pageToken ?? row.backfill_page_token;
    if (pageToken) await newestPage(env, scope, row, accessToken, pageToken, false, now);
    return;
  }
  const startHistoryId = message.startHistoryId ?? row.newest_history_id;
  if (!startHistoryId) {
    await newestPage(env, scope, row, accessToken, undefined, true, now);
    return;
  }
  await partialPage(env, scope, row, accessToken, startHistoryId, message.pageToken, now);
}

export async function requestAccountSync(
  env: Env,
  profileId: string,
  accountId: string,
  now: Date,
): Promise<boolean> {
  const threshold = new Date(now.getTime() - 30_000).toISOString();
  const updated = await env.DB.prepare(
    `UPDATE google_accounts
        SET last_sync_requested_at = ?
      WHERE profile_id = ? AND account_id = ? AND connection_state = 'active'
        AND coverage_state != 'backfilling'
        AND (last_sync_requested_at IS NULL OR last_sync_requested_at < ?)`,
  )
    .bind(now.toISOString(), profileId, accountId, threshold)
    .run();
  if (Number(updated.meta.changes ?? 0) !== 1) return false;
  await enqueueSyncEvent(env, {
    profileId,
    accountId,
    mode: 'partial',
  }, now);
  return true;
}

function safeJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export async function mailboxSnapshot(env: Env, profileId: string): Promise<Readonly<Record<string, unknown>>> {
  const accounts = await env.DB.prepare(
    `SELECT profile_id, account_id, email_address, display_name, accent,
            coverage_state, newest_history_id, backfill_complete_through,
            unresolved_failures, updated_at, backfill_page_token
       FROM google_accounts
      WHERE profile_id = ? AND connection_state != 'revoked'
      ORDER BY created_at`,
  )
    .bind(profileId)
    .all<AccountRow>();
  const threads = await env.DB.prepare(
    `SELECT t.profile_id, t.account_id, t.thread_id, t.history_id, t.subject,
            t.snippet, t.participants_json, t.received_at, t.unread, t.starred,
            t.important, t.in_inbox, t.needs_response, t.waiting_on_others,
            t.label_ids_json
       FROM mail_threads t
      WHERE t.profile_id = ?
        AND (t.in_inbox = 1 OR EXISTS (
          SELECT 1 FROM tap_reminders r
           WHERE r.profile_id = t.profile_id AND r.account_id = t.account_id
             AND r.thread_id = t.thread_id AND r.state IN ('pending', 'due')
        ))
      ORDER BY t.received_at DESC
      LIMIT 100`,
  )
    .bind(profileId)
    .all<{
      profile_id: string;
      account_id: string;
      thread_id: string;
      history_id: string;
      subject: string;
      snippet: string;
      participants_json: string;
      received_at: string;
      unread: number;
      starred: number;
      important: number;
      in_inbox: number;
      needs_response: number;
      waiting_on_others: number;
      label_ids_json: string;
    }>();
  const [messages, reminders] = await Promise.all([
    env.DB.prepare(
      `SELECT m.account_id, m.thread_id, m.message_id, m.internet_message_id,
              m.sender_json, m.recipients_json, m.sent_at,
              m.body_text_ciphertext, m.ordinal
         FROM mail_messages m
         JOIN mail_threads t
           ON t.profile_id = m.profile_id AND t.account_id = m.account_id
          AND t.thread_id = m.thread_id
        WHERE m.profile_id = ?
          AND (t.in_inbox = 1 OR EXISTS (
            SELECT 1 FROM tap_reminders r
             WHERE r.profile_id = t.profile_id AND r.account_id = t.account_id
               AND r.thread_id = t.thread_id AND r.state IN ('pending', 'due')
          ))
          AND m.ordinal = (
            SELECT MAX(last_message.ordinal) FROM mail_messages last_message
             WHERE last_message.profile_id = m.profile_id
               AND last_message.account_id = m.account_id
               AND last_message.thread_id = m.thread_id
          )
        ORDER BY m.thread_id, m.ordinal
        LIMIT 200`,
    ).bind(profileId).all<{
      account_id: string;
      thread_id: string;
      message_id: string;
      internet_message_id: string | null;
      sender_json: string;
      recipients_json: string;
      sent_at: string;
      body_text_ciphertext: string;
      ordinal: number;
    }>(),
    env.DB.prepare(
      `SELECT account_id, reminder_id, thread_id, due_at, condition, created_at
         FROM tap_reminders
        WHERE profile_id = ? AND state IN ('pending', 'due')`,
    ).bind(profileId).all<{
      account_id: string;
      reminder_id: string;
      thread_id: string;
      due_at: string;
      condition: 'if_no_reply' | 'regardless';
      created_at: string;
    }>(),
  ]);
  const messagePreviews = await Promise.all(
    messages.results.map(async message => ({
      message,
      bodyText: (await openSecret(
        message.body_text_ciphertext,
        env.GOOGLE_TOKEN_ENCRYPTION_KEY,
      )).slice(0, 8_000),
    })),
  );
  const messagesByThread = new Map<string, unknown[]>();
  for (const { message, bodyText } of messagePreviews) {
    const key = `${message.account_id}:${message.thread_id}`;
    const group = messagesByThread.get(key) ?? [];
    group.push({
      messageId: message.message_id,
      internetMessageId: message.internet_message_id,
      from: safeJson<Participant>(message.sender_json, { name: 'Unknown sender', address: 'unknown@invalid.local' }),
      to: safeJson<readonly Participant[]>(message.recipients_json, []),
      sentAt: message.sent_at,
      bodyText,
    });
    messagesByThread.set(key, group);
  }
  const reminderByThread = new Map(
    reminders.results.map(reminder => [
      `${reminder.account_id}:${reminder.thread_id}`,
      {
        reminderId: reminder.reminder_id,
        accountId: reminder.account_id,
        threadId: reminder.thread_id,
        dueAt: reminder.due_at,
        condition: reminder.condition,
        createdAt: reminder.created_at,
      },
    ]),
  );
  return {
    schemaVersion: 1,
    accounts: accounts.results.map(account => ({
      accountId: account.account_id,
      provider: 'google',
      address: account.email_address ?? '',
      displayName: account.email_address ?? account.display_name ?? 'Google',
      accent: account.accent ?? '#74a7a1',
      coverage: {
        accountId: account.account_id,
        state: account.coverage_state,
        newestHistoryId: account.newest_history_id,
        observedAt: account.updated_at,
        backfillCompleteThrough: account.backfill_complete_through,
        unresolvedFailures: account.unresolved_failures,
      },
    })),
    threads: threads.results.map(thread => {
      const key = `${thread.account_id}:${thread.thread_id}`;
      const reminder = reminderByThread.get(key) ?? null;
      return {
        threadId: thread.thread_id,
        accountId: thread.account_id,
        providerRevision: thread.history_id,
        subject: thread.subject,
        participants: safeJson<readonly Participant[]>(thread.participants_json, []),
        snippet: thread.snippet,
        receivedAt: thread.received_at,
        unread: thread.unread === 1,
        starred: thread.starred === 1,
        critical: thread.important === 1,
        needsResponse: thread.needs_response === 1,
        waitingOnOthers: thread.waiting_on_others === 1,
        status: reminder ? 'reminded' : thread.in_inbox === 1 ? 'inbox' : 'done',
        labels: safeJson<readonly string[]>(thread.label_ids_json, []),
        messages: messagesByThread.get(key) ?? [],
        reminder,
      };
    }),
  };
}

export async function threadSnapshot(
  env: Env,
  profileId: string,
  accountId: string,
  threadId: string,
): Promise<Readonly<Record<string, unknown>> | null> {
  const thread = await env.DB.prepare(
    `SELECT thread_id FROM mail_threads
      WHERE profile_id = ? AND account_id = ? AND thread_id = ?`,
  )
    .bind(profileId, accountId, threadId)
    .first<{ thread_id: string }>();
  if (!thread) return null;
  const messages = await env.DB.prepare(
    `SELECT message_id, internet_message_id, sender_json, recipients_json,
            sent_at, body_text_ciphertext
       FROM mail_messages
      WHERE profile_id = ? AND account_id = ? AND thread_id = ?
      ORDER BY ordinal
      LIMIT 20`,
  )
    .bind(profileId, accountId, threadId)
    .all<{
      message_id: string;
      internet_message_id: string | null;
      sender_json: string;
      recipients_json: string;
      sent_at: string;
      body_text_ciphertext: string;
    }>();
  const decryptedMessages = await Promise.all(messages.results.map(async message => ({
    messageId: message.message_id,
    internetMessageId: message.internet_message_id,
    from: safeJson<Participant>(message.sender_json, { name: 'Unknown sender', address: 'unknown@invalid.local' }),
    to: safeJson<readonly Participant[]>(message.recipients_json, []),
    sentAt: message.sent_at,
    bodyText: await openSecret(
      message.body_text_ciphertext,
      env.GOOGLE_TOKEN_ENCRYPTION_KEY,
    ),
  })));
  return {
    accountId,
    threadId,
    messages: decryptedMessages,
  };
}

export async function executeTapOwnedCommand(
  env: Env,
  scope: ProviderScope,
  command: MailCommand,
  now: string,
): Promise<ProviderExecutionResult | null> {
  if (command.kind !== 'create_reminder' && command.kind !== 'cancel_reminder') return null;
  if (!command.threadId) return { outcome: 'failed', errorCode: 'thread_required' };
  const payload = command.payload as Readonly<Record<string, unknown>>;
  if (!isSafeMailIdentifier(payload.reminderId)) {
    return { outcome: 'failed', errorCode: 'invalid_reminder' };
  }
  const thread = await env.DB.prepare(
    `SELECT thread_id FROM mail_threads
      WHERE profile_id = ? AND account_id = ? AND thread_id = ?`,
  )
    .bind(scope.profileId, scope.accountId, command.threadId)
    .first<{ readonly thread_id: string }>();
  if (!thread) return { outcome: 'failed', errorCode: 'thread_not_found' };
  if (command.kind === 'cancel_reminder') {
    await env.DB.prepare(
      `UPDATE tap_reminders SET state = 'cancelled', updated_at = ?
        WHERE profile_id = ? AND account_id = ? AND thread_id = ?
          AND reminder_id = ?`,
    )
      .bind(now, scope.profileId, scope.accountId, command.threadId, payload.reminderId)
      .run();
    return { outcome: 'acknowledged', providerRevision: command.expectedProviderRevision };
  }
  if (
    typeof payload.dueAt !== 'string' ||
    !Number.isFinite(Date.parse(payload.dueAt)) ||
    Date.parse(payload.dueAt) <= Date.parse(now) ||
    (payload.condition !== 'if_no_reply' && payload.condition !== 'regardless')
  ) {
    return { outcome: 'failed', errorCode: 'invalid_reminder' };
  }
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE tap_reminders SET state = 'cancelled', updated_at = ?
        WHERE profile_id = ? AND account_id = ? AND thread_id = ?
          AND state IN ('pending', 'due')`,
    ).bind(now, scope.profileId, scope.accountId, command.threadId),
    env.DB.prepare(
      `INSERT INTO tap_reminders
         (profile_id, account_id, reminder_id, thread_id, due_at,
          condition, state, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    ).bind(
      scope.profileId,
      scope.accountId,
      payload.reminderId,
      command.threadId,
      payload.dueAt,
      payload.condition,
      now,
      now,
    ),
  ]);
  return { outcome: 'acknowledged', providerRevision: command.expectedProviderRevision };
}

export async function markDueReminders(env: Env, now: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE tap_reminders SET state = 'due', updated_at = ?
      WHERE state = 'pending' AND due_at <= ?`,
  )
    .bind(now, now)
    .run();
}

export async function enqueueScheduledSyncs(env: Env, now: Date): Promise<void> {
  const staleBefore = new Date(now.getTime() - 4 * 60_000).toISOString();
  const accounts = await env.DB.prepare(
    `SELECT profile_id, account_id
      FROM google_accounts
      WHERE connection_state = 'active' AND coverage_state != 'backfilling'
        AND updated_at < ?
        AND NOT EXISTS (
          SELECT 1 FROM provider_events event
           WHERE event.profile_id = google_accounts.profile_id
             AND event.account_id = google_accounts.account_id
             AND event.state IN ('received', 'processing', 'retryable')
        )
      ORDER BY updated_at
      LIMIT 20`,
  )
    .bind(staleBefore)
    .all<{ profile_id: string; account_id: string }>();
  if (accounts.results.length === 0) return;
  await enqueueSyncEvents(
    env,
    accounts.results.map(account => ({
      profileId: account.profile_id,
      accountId: account.account_id,
      mode: 'partial' as const,
    })),
    now,
  );
}
