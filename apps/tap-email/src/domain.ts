import {
  isAccountCoverage,
  isMailCommand,
  isSafeMailIdentifier,
  operationalZeroAllowed,
  TAP_EMAIL_PROTOCOL_VERSION,
  type AccountCoverage,
  type MailCommand,
  type MailboxSummary,
  type ReminderCondition,
  type TapEmailReminder,
} from '@tap-examples/tap-email-protocol';

export type MailSplit =
  | 'inbox'
  | 'critical'
  | 'needs-response'
  | 'waiting'
  | 'reminders';
export type AccountSelection = 'all' | string;
export type ThreadStatus = 'inbox' | 'done' | 'reminded' | 'trashed';

export interface EmailAccount {
  readonly accountId: string;
  readonly provider: 'google';
  readonly address: string;
  readonly displayName: string;
  readonly accent: string;
  readonly coverage: AccountCoverage;
}

export interface EmailParticipant {
  readonly name: string;
  readonly address: string;
}

export interface EmailMessage {
  readonly messageId: string;
  readonly internetMessageId?: string | null;
  readonly from: EmailParticipant;
  readonly to: readonly EmailParticipant[];
  readonly sentAt: string;
  readonly bodyText: string;
}

export interface MailboxSnapshot {
  readonly schemaVersion: 1;
  readonly accounts: readonly EmailAccount[];
  readonly threads: readonly EmailThread[];
}

export interface EmailThread {
  readonly threadId: string;
  readonly accountId: string;
  readonly providerRevision: string;
  readonly subject: string;
  readonly participants: readonly EmailParticipant[];
  readonly snippet: string;
  readonly receivedAt: string;
  readonly unread: boolean;
  readonly starred: boolean;
  readonly critical: boolean;
  readonly needsResponse: boolean;
  readonly waitingOnOthers: boolean;
  readonly status: ThreadStatus;
  readonly labels: readonly string[];
  readonly messages: readonly EmailMessage[];
  readonly reminder: TapEmailReminder | null;
}

export interface MailPreferences {
  readonly imagesEnabled: boolean;
  readonly trackingPixelsEnabled: boolean;
  readonly notificationsConfigured: boolean;
  readonly notificationAccountIds: readonly string[];
  readonly shortcutOverrides: Readonly<Record<string, string>>;
}

export interface UndoEntry {
  readonly label: string;
  readonly thread: EmailThread;
  readonly commandId: string;
  readonly previousSelectedThreadKey: string | null;
  readonly expiresAt: string;
}

export interface MailState {
  readonly schemaVersion: 2;
  readonly accounts: readonly EmailAccount[];
  readonly threads: readonly EmailThread[];
  readonly selectedAccountId: AccountSelection;
  readonly selectedSplit: MailSplit;
  readonly selectedThreadKey: string | null;
  readonly commands: readonly MailCommand[];
  readonly preferences: MailPreferences;
  readonly undo: UndoEntry | null;
}

export const defaultPreferences: MailPreferences = {
  imagesEnabled: true,
  trackingPixelsEnabled: true,
  notificationsConfigured: false,
  notificationAccountIds: [],
  shortcutOverrides: {},
};

export function emptyMailState(): MailState {
  return {
    schemaVersion: 2,
    accounts: [],
    threads: [],
    selectedAccountId: 'all',
    selectedSplit: 'inbox',
    selectedThreadKey: null,
    commands: [],
    preferences: defaultPreferences,
    undo: null,
  };
}

function coverage(
  accountId: string,
  state: AccountCoverage['state'] = 'current',
): AccountCoverage {
  return {
    accountId,
    state,
    newestHistoryId: `history_${accountId}_1832`,
    observedAt: '2026-08-18T15:29:00.000Z',
    backfillCompleteThrough:
      state === 'backfilling' ? '2025-11-01T00:00:00.000Z' : '2021-01-01T00:00:00.000Z',
    unresolvedFailures: 0,
  };
}

function participant(name: string, address: string): EmailParticipant {
  return { name, address };
}

function message(
  messageId: string,
  from: EmailParticipant,
  to: EmailParticipant,
  sentAt: string,
  bodyText: string,
): EmailMessage {
  return { messageId, from, to: [to], sentAt, bodyText };
}

export function previewMailState(): MailState {
  const personal = participant('Zackary Chapple', 'zack@tap.email');
  const work = participant('Zackary Chapple', 'zack@theaiplatform.app');
  const accounts: readonly EmailAccount[] = [
    {
      accountId: 'google_personal',
      provider: 'google',
      address: personal.address,
      displayName: 'Personal',
      accent: '#e56f4c',
      coverage: coverage('google_personal'),
    },
    {
      accountId: 'google_work',
      provider: 'google',
      address: work.address,
      displayName: 'TAP',
      accent: '#74a7a1',
      coverage: coverage('google_work', 'backfilling'),
    },
  ];
  const threads: readonly EmailThread[] = [
    {
      threadId: 'gmail_thread_launch_review',
      accountId: 'google_work',
      providerRevision: 'history_google_work_1829',
      subject: 'Launch review needs your call',
      participants: [participant('Maya Chen', 'maya@northstar.dev')],
      snippet: 'We can hold the Tuesday slot, but need a go/no-go before 4pm today.',
      receivedAt: '2026-08-18T15:24:00.000Z',
      unread: true,
      starred: true,
      critical: true,
      needsResponse: true,
      waitingOnOthers: false,
      status: 'inbox',
      labels: ['Inbox', 'Launch'],
      messages: [
        message(
          'gmail_message_launch_review_1',
          participant('Maya Chen', 'maya@northstar.dev'),
          work,
          '2026-08-18T15:24:00.000Z',
          'Hi Zackary,\n\nWe can hold the Tuesday launch slot, but the production team needs a go/no-go before 4pm today. The remaining question is whether the migration warning should block launch.\n\nCan you make the call?\n\nMaya',
        ),
      ],
      reminder: null,
    },
    {
      threadId: 'gmail_thread_contract',
      accountId: 'google_personal',
      providerRevision: 'history_google_personal_1830',
      subject: 'Re: Studio contract — final language',
      participants: [participant('Nora Alvarez', 'nora@alvarez.legal')],
      snippet: 'I incorporated the liability language. Two comments remain for your review.',
      receivedAt: '2026-08-18T14:51:00.000Z',
      unread: true,
      starred: false,
      critical: false,
      needsResponse: true,
      waitingOnOthers: false,
      status: 'inbox',
      labels: ['Inbox'],
      messages: [
        message(
          'gmail_message_contract_1',
          participant('Nora Alvarez', 'nora@alvarez.legal'),
          personal,
          '2026-08-18T14:51:00.000Z',
          'Hi Zackary,\n\nI incorporated the liability language from Friday. Two comments remain for your review in sections 8 and 11. If those look right, the agreement is ready to sign.\n\nNora',
        ),
      ],
      reminder: null,
    },
    {
      threadId: 'gmail_thread_design_notes',
      accountId: 'google_work',
      providerRevision: 'history_google_work_1827',
      subject: 'TAP Home review notes',
      participants: [participant('Eli Torres', 'eli@theaiplatform.app')],
      snippet: 'The deep-link behavior feels solid. I left three polish notes in the file.',
      receivedAt: '2026-08-18T13:36:00.000Z',
      unread: false,
      starred: false,
      critical: false,
      needsResponse: false,
      waitingOnOthers: false,
      status: 'inbox',
      labels: ['Inbox', 'Design'],
      messages: [
        message(
          'gmail_message_design_notes_1',
          participant('Eli Torres', 'eli@theaiplatform.app'),
          work,
          '2026-08-18T13:36:00.000Z',
          'The deep-link behavior feels solid. I left three polish notes in the file; none of them should block the build. Nice work on the focus restoration.',
        ),
      ],
      reminder: null,
    },
    {
      threadId: 'gmail_thread_invoice',
      accountId: 'google_personal',
      providerRevision: 'history_google_personal_1826',
      subject: 'Invoice 4418 paid',
      participants: [participant('Fieldwork Billing', 'receipts@fieldwork.co')],
      snippet: 'Your payment was received. No action is needed.',
      receivedAt: '2026-08-18T12:10:00.000Z',
      unread: false,
      starred: false,
      critical: false,
      needsResponse: false,
      waitingOnOthers: false,
      status: 'inbox',
      labels: ['Inbox', 'Receipts'],
      messages: [
        message(
          'gmail_message_invoice_1',
          participant('Fieldwork Billing', 'receipts@fieldwork.co'),
          personal,
          '2026-08-18T12:10:00.000Z',
          'Your payment for invoice 4418 was received. No action is needed.',
        ),
      ],
      reminder: null,
    },
    {
      threadId: 'gmail_thread_partner_followup',
      accountId: 'google_work',
      providerRevision: 'history_google_work_1810',
      subject: 'Partnership follow-up',
      participants: [participant('Arun Mehta', 'arun@cascade.ai')],
      snippet: 'Thanks for the proposal. We will circle back after the board meeting.',
      receivedAt: '2026-08-17T19:42:00.000Z',
      unread: false,
      starred: false,
      critical: false,
      needsResponse: false,
      waitingOnOthers: true,
      status: 'inbox',
      labels: ['Inbox', 'Partnerships'],
      messages: [
        message(
          'gmail_message_partner_followup_1',
          participant('Arun Mehta', 'arun@cascade.ai'),
          work,
          '2026-08-17T19:42:00.000Z',
          'Thanks for the thoughtful proposal. We will circle back after the board meeting on Thursday.',
        ),
      ],
      reminder: null,
    },
  ];
  return {
    schemaVersion: 2,
    accounts,
    threads,
    selectedAccountId: 'all',
    selectedSplit: 'inbox',
    selectedThreadKey: threads[0] ? emailThreadKey(threads[0]) : null,
    commands: [],
    preferences: {
      ...defaultPreferences,
      notificationsConfigured: true,
      notificationAccountIds: accounts.map(account => account.accountId),
    },
    undo: null,
  };
}

export function emailThreadKey(
  thread: Pick<EmailThread, 'accountId' | 'threadId'>,
): string {
  return `${thread.accountId}\u0000${thread.threadId}`;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isBoundedString(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length <= maximum;
}

function isDateString(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isParticipant(value: unknown): value is EmailParticipant {
  return isRecord(value) &&
    isBoundedString(value.name, 500) &&
    isBoundedString(value.address, 2_000);
}

export function isEmailMessage(value: unknown): value is EmailMessage {
  if (!isRecord(value)) return false;
  return (
    isSafeMailIdentifier(value.messageId) &&
    (value.internetMessageId === undefined || value.internetMessageId === null ||
      isBoundedString(value.internetMessageId, 2_000)) &&
    isParticipant(value.from) &&
    Array.isArray(value.to) &&
    value.to.length <= 100 &&
    value.to.every(isParticipant) &&
    isDateString(value.sentAt) &&
    isBoundedString(value.bodyText, 500_000)
  );
}

function isReminder(value: unknown): value is TapEmailReminder | null {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  return (
    isSafeMailIdentifier(value.reminderId) &&
    isSafeMailIdentifier(value.accountId) &&
    isSafeMailIdentifier(value.threadId) &&
    isDateString(value.dueAt) &&
    (value.condition === 'if_no_reply' || value.condition === 'regardless') &&
    isDateString(value.createdAt)
  );
}

export function isEmailThread(value: unknown): value is EmailThread {
  if (!isRecord(value)) return false;
  return (
    isSafeMailIdentifier(value.threadId) &&
    isSafeMailIdentifier(value.accountId) &&
    isSafeMailIdentifier(value.providerRevision) &&
    isBoundedString(value.subject, 998) &&
    Array.isArray(value.participants) &&
    value.participants.length <= 100 &&
    value.participants.every(isParticipant) &&
    isBoundedString(value.snippet, 10_000) &&
    isDateString(value.receivedAt) &&
    typeof value.unread === 'boolean' &&
    typeof value.starred === 'boolean' &&
    typeof value.critical === 'boolean' &&
    typeof value.needsResponse === 'boolean' &&
    typeof value.waitingOnOthers === 'boolean' &&
    ['inbox', 'done', 'reminded', 'trashed'].includes(String(value.status)) &&
    Array.isArray(value.labels) &&
    value.labels.length <= 100 &&
    value.labels.every(label => isBoundedString(label, 256)) &&
    Array.isArray(value.messages) &&
    value.messages.length <= 1_000 &&
    value.messages.every(isEmailMessage) &&
    isReminder(value.reminder)
  );
}

function isEmailAccount(value: unknown): value is EmailAccount {
  if (!isRecord(value)) return false;
  return (
    isSafeMailIdentifier(value.accountId) &&
    value.provider === 'google' &&
    isBoundedString(value.address, 2_000) &&
    isBoundedString(value.displayName, 500) &&
    isBoundedString(value.accent, 100) &&
    isAccountCoverage(value.coverage) &&
    value.coverage.accountId === value.accountId
  );
}

export function isMailboxSnapshot(value: unknown): value is MailboxSnapshot {
  if (!isRecord(value)) return false;
  return (
    value.schemaVersion === 1 &&
    Array.isArray(value.accounts) &&
    value.accounts.length <= 100 &&
    value.accounts.every(isEmailAccount) &&
    Array.isArray(value.threads) &&
    value.threads.length <= 10_000 &&
    value.threads.every(isEmailThread)
  );
}

export function isMailPreferences(value: unknown): value is MailPreferences {
  if (!isRecord(value)) return false;
  return (
    typeof value.imagesEnabled === 'boolean' &&
    typeof value.trackingPixelsEnabled === 'boolean' &&
    typeof value.notificationsConfigured === 'boolean' &&
    Array.isArray(value.notificationAccountIds) &&
    value.notificationAccountIds.length <= 100 &&
    value.notificationAccountIds.every(isSafeMailIdentifier) &&
    isRecord(value.shortcutOverrides) &&
    Object.entries(value.shortcutOverrides).every(
      ([command, shortcut]) =>
        isBoundedString(command, 100) && isBoundedString(shortcut, 100),
    )
  );
}

export function notificationsEnabledForAccount(
  preferences: MailPreferences,
  accountId: string,
): boolean {
  return (
    !preferences.notificationsConfigured ||
    preferences.notificationAccountIds.includes(accountId)
  );
}

export function isMailState(value: unknown): value is MailState {
  if (!isRecord(value)) return false;
  const validAccountSelection = value.selectedAccountId === 'all' ||
    isSafeMailIdentifier(value.selectedAccountId);
  const undo = isRecord(value.undo) ? value.undo : null;
  return (
    value.schemaVersion === 2 &&
    isMailboxSnapshot({
      schemaVersion: 1,
      accounts: value.accounts,
      threads: value.threads,
    }) &&
    validAccountSelection &&
    ['inbox', 'critical', 'needs-response', 'waiting', 'reminders'].includes(
      String(value.selectedSplit),
    ) &&
    (value.selectedThreadKey === null || isBoundedString(value.selectedThreadKey, 513)) &&
    Array.isArray(value.commands) &&
    value.commands.length <= 10_000 &&
    value.commands.every(isMailCommand) &&
    isMailPreferences(value.preferences) &&
    (value.undo === null || Boolean(undo) &&
      isBoundedString(undo?.label, 500) &&
      isEmailThread(undo?.thread) &&
      isSafeMailIdentifier(undo?.commandId) &&
      (undo?.previousSelectedThreadKey === null ||
        isBoundedString(undo?.previousSelectedThreadKey, 513)) &&
      isDateString(undo?.expiresAt))
  );
}

export function visibleThreads(state: MailState): readonly EmailThread[] {
  return state.threads
    .filter(thread =>
      state.selectedAccountId === 'all'
        ? true
        : thread.accountId === state.selectedAccountId,
    )
    .filter(thread => {
      if (state.selectedSplit === 'reminders') return thread.status === 'reminded';
      if (thread.status !== 'inbox') return false;
      if (state.selectedSplit === 'critical') return thread.critical;
      if (state.selectedSplit === 'needs-response') return thread.needsResponse;
      if (state.selectedSplit === 'waiting') return thread.waitingOnOthers;
      return true;
    })
    .toSorted((left, right) => right.receivedAt.localeCompare(left.receivedAt));
}

export function selectedThread(state: MailState): EmailThread | null {
  const visible = visibleThreads(state);
  return (
    visible.find(thread => emailThreadKey(thread) === state.selectedThreadKey) ??
    visible[0] ??
    null
  );
}

export function selectAccount(
  state: MailState,
  accountId: AccountSelection,
): MailState {
  if (
    accountId !== 'all' &&
    !state.accounts.some(account => account.accountId === accountId)
  ) {
    return state;
  }
  const next = { ...state, selectedAccountId: accountId };
  const first = visibleThreads(next)[0];
  return { ...next, selectedThreadKey: first ? emailThreadKey(first) : null };
}

export function selectSplit(state: MailState, split: MailSplit): MailState {
  const next = { ...state, selectedSplit: split };
  const first = visibleThreads(next)[0];
  return { ...next, selectedThreadKey: first ? emailThreadKey(first) : null };
}

export function moveSelection(state: MailState, delta: -1 | 1): MailState {
  const threads = visibleThreads(state);
  if (threads.length === 0) return { ...state, selectedThreadKey: null };
  const current = Math.max(
    0,
    threads.findIndex(thread => emailThreadKey(thread) === state.selectedThreadKey),
  );
  const next = Math.min(threads.length - 1, Math.max(0, current + delta));
  const selected = threads[next];
  return { ...state, selectedThreadKey: selected ? emailThreadKey(selected) : null };
}

function commandFor(
  thread: EmailThread,
  commandId: string,
  kind: MailCommand['kind'],
  now: string,
  payload: Readonly<Record<string, unknown>>,
): MailCommand {
  return {
    v: TAP_EMAIL_PROTOCOL_VERSION,
    commandId,
    idempotencyKey: `tap-email:${thread.accountId}:${commandId}`,
    accountId: thread.accountId,
    threadId: thread.threadId,
    kind,
    createdAt: now,
    expectedProviderRevision: thread.providerRevision,
    payload,
  };
}

function withThreadAction(
  state: MailState,
  commandId: string,
  now: string,
  update: (thread: EmailThread) => EmailThread,
  command: (thread: EmailThread) => MailCommand,
  label: string,
): MailState {
  const thread = selectedThread(state);
  if (!thread) return state;
  const before = visibleThreads(state);
  const currentKey = emailThreadKey(thread);
  const currentIndex = before.findIndex(item => emailThreadKey(item) === currentKey);
  const changed = update(thread);
  const threads = state.threads.map(item =>
    emailThreadKey(item) === currentKey ? changed : item,
  );
  const provisional = { ...state, threads };
  const after = visibleThreads(provisional);
  const nextThread = after[Math.min(Math.max(0, currentIndex), after.length - 1)];
  return {
    ...provisional,
    selectedThreadKey: nextThread ? emailThreadKey(nextThread) : null,
    commands: [...state.commands, command(thread)],
    undo: {
      label,
      thread,
      commandId,
      previousSelectedThreadKey: state.selectedThreadKey,
      expiresAt: new Date(Date.parse(now) + 5_000).toISOString(),
    },
  };
}

export function markDone(
  state: MailState,
  commandId: string,
  now: string,
): MailState {
  return withThreadAction(
    state,
    commandId,
    now,
    thread => ({ ...thread, status: 'done' }),
    thread => commandFor(thread, commandId, 'archive', now, {}),
    'Marked done',
  );
}

export function remindThread(
  state: MailState,
  commandId: string,
  reminderId: string,
  dueAt: string,
  condition: ReminderCondition,
  now: string,
): MailState {
  if (!Number.isFinite(Date.parse(dueAt)) || Date.parse(dueAt) <= Date.parse(now)) {
    return state;
  }
  return withThreadAction(
    state,
    commandId,
    now,
    thread => ({
      ...thread,
      status: 'reminded',
      reminder: {
        reminderId,
        accountId: thread.accountId,
        threadId: thread.threadId,
        dueAt,
        condition,
        createdAt: now,
      },
    }),
    thread =>
      commandFor(thread, commandId, 'create_reminder', now, {
        reminderId,
        dueAt,
        condition,
      }),
    'Reminder set',
  );
}

export function undoLastAction(state: MailState, now: string): MailState {
  if (!state.undo || Date.parse(state.undo.expiresAt) < Date.parse(now)) {
    return { ...state, undo: null };
  }
  const restored = state.undo.thread;
  return {
    ...state,
    threads: state.threads.map(thread =>
      emailThreadKey(thread) === emailThreadKey(restored) ? restored : thread,
    ),
    commands: state.commands.filter(
      command => command.commandId !== state.undo?.commandId,
    ),
    selectedThreadKey: emailThreadKey(restored),
    undo: null,
  };
}

export function toggleStar(
  state: MailState,
  commandId: string,
  now: string,
): MailState {
  const thread = selectedThread(state);
  if (!thread) return state;
  const starred = !thread.starred;
  return {
    ...state,
    threads: state.threads.map(item =>
      emailThreadKey(item) === emailThreadKey(thread) ? { ...item, starred } : item,
    ),
    commands: [
      ...state.commands,
      commandFor(thread, commandId, starred ? 'star' : 'unstar', now, {}),
    ],
  };
}

export function composeMessage(
  state: MailState,
  commandId: string,
  accountId: string,
  threadId: string | null,
  to: string,
  subject: string,
  bodyText: string,
  replyToMessageId: string | null,
  now: string,
): MailState {
  if (!state.accounts.some(account => account.accountId === accountId)) return state;
  const command: MailCommand = {
    v: TAP_EMAIL_PROTOCOL_VERSION,
    commandId,
    idempotencyKey: `tap-email:${accountId}:${commandId}`,
    accountId,
    threadId,
    kind: 'send_draft',
    createdAt: now,
    expectedProviderRevision:
      threadId
        ? state.threads.find(
            thread => thread.accountId === accountId && thread.threadId === threadId,
          )?.providerRevision ?? null
        : null,
    payload: {
      to,
      subject,
      bodyText,
      ...(replyToMessageId ? { replyToMessageId } : {}),
    },
  };
  return { ...state, commands: [...state.commands, command] };
}

export function mergeMailboxSnapshot(
  state: MailState,
  snapshot: MailboxSnapshot,
): MailState {
  const accountStillExists =
    state.selectedAccountId === 'all' ||
    snapshot.accounts.some(account => account.accountId === state.selectedAccountId);
  const selectedAccountId = accountStillExists ? state.selectedAccountId : 'all';
  const merged = {
    ...state,
    accounts: snapshot.accounts,
    threads: snapshot.threads,
    selectedAccountId,
  };
  const visible = visibleThreads(merged);
  return {
    ...merged,
    selectedThreadKey:
      visible.some(thread => emailThreadKey(thread) === state.selectedThreadKey)
        ? state.selectedThreadKey
        : visible[0] ? emailThreadKey(visible[0]) : null,
  };
}

export function mergeThreadMessages(
  state: MailState,
  accountId: string,
  threadId: string,
  messages: readonly EmailMessage[],
): MailState {
  return {
    ...state,
    threads: state.threads.map(thread =>
      thread.accountId === accountId && thread.threadId === threadId
        ? { ...thread, messages }
        : thread,
    ),
  };
}

export function mailboxSummary(state: MailState, now: string): MailboxSummary {
  const active = state.threads.filter(thread => thread.status === 'inbox');
  const coverageComplete = operationalZeroAllowed(
    state.accounts.map(account => account.coverage),
  );
  const actionable = active.filter(
    thread => thread.critical || thread.needsResponse,
  );
  return {
    generatedAt: now,
    accountIds: state.accounts.map(account => account.accountId),
    inbox: active.length,
    critical: active.filter(thread => thread.critical).length,
    needsResponse: active.filter(thread => thread.needsResponse).length,
    waiting: active.filter(thread => thread.waitingOnOthers).length,
    dueReminders: state.threads.filter(
      thread =>
        thread.status === 'reminded' &&
        thread.reminder &&
        Date.parse(thread.reminder.dueAt) <= Date.parse(now),
    ).length,
    failedCommands: 0,
    operationalZero: coverageComplete && actionable.length === 0,
    coverageComplete,
  };
}

export function resolveReminderInput(input: string, now: Date): Date | null {
  const normalized = input.trim().toLowerCase();
  const result = new Date(now);
  if (normalized === 'tomorrow') {
    result.setDate(result.getDate() + 1);
    result.setHours(8, 0, 0, 0);
    return result;
  }
  if (normalized === 'next week') {
    result.setDate(result.getDate() + 7);
    result.setHours(8, 0, 0, 0);
    return result;
  }
  if (normalized === 'next weekend') {
    const daysUntilSaturday = (6 - result.getDay() + 7) % 7 || 7;
    result.setDate(result.getDate() + daysUntilSaturday);
    result.setHours(8, 0, 0, 0);
    return result;
  }
  const days = /^(\d{1,3})\s+days?$/u.exec(normalized);
  if (days) {
    result.setDate(result.getDate() + Number(days[1]));
    result.setHours(8, 0, 0, 0);
    return result;
  }
  const parsed = new Date(input);
  return Number.isFinite(parsed.getTime()) && parsed > now ? parsed : null;
}
