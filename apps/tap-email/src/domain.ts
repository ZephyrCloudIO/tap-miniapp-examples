import {
  isAccountCoverage,
  isMailCommand,
  isMailCommandReceipt,
  isMailDraftPayload,
  isSafeMailIdentifier,
  operationalZeroAllowed,
  TAP_EMAIL_PROTOCOL_VERSION,
  type AccountCoverage,
  type EmailProvider,
  type MailCommand,
  type MailCommandReceipt,
  type MailDraftAttachment,
  type MailDraftPayload,
  type MailSenderContext,
  type MailSchedulePayload,
  type MailboxSummary,
  type ReminderCondition,
  type TapEmailReminder,
} from '@tap-examples/tap-email-protocol';

export type MailboxCategory =
  | 'inbox'
  | 'starred'
  | 'drafts'
  | 'sent'
  | 'done'
  | 'auto-archived'
  | 'scheduled'
  | 'outbox'
  | 'reminders'
  | 'snippets'
  | 'spam'
  | 'trash';
export type TapMailView = 'critical' | 'needs-response' | 'waiting';
export type MailSplit = MailboxCategory | TapMailView;
export type ProviderMailboxResource =
  | 'inbox'
  | 'starred'
  | 'drafts'
  | 'sent'
  | 'spam'
  | 'trash';

const mailSplits: readonly MailSplit[] = [
  'inbox',
  'starred',
  'drafts',
  'sent',
  'done',
  'auto-archived',
  'scheduled',
  'outbox',
  'reminders',
  'snippets',
  'spam',
  'trash',
  'critical',
  'needs-response',
  'waiting',
];
const providerMailboxResources = new Set<ProviderMailboxResource>([
  'inbox',
  'starred',
  'drafts',
  'sent',
  'spam',
  'trash',
]);
export type AccountSelection = 'all' | string;
export type ThreadStatus = 'inbox' | 'done' | 'reminded' | 'trashed';
const threadStatuses = new Set<ThreadStatus>(['inbox', 'done', 'reminded', 'trashed']);

export interface EmailAccount {
  readonly accountId: string;
  readonly provider: EmailProvider;
  readonly address: string;
  readonly displayName: string;
  readonly accent: string;
  readonly coverage: AccountCoverage;
}

export interface EmailParticipant {
  readonly name: string;
  readonly address: string;
}

export interface EmailAttachment {
  /** Coordinator-issued public resource ID; attachment bytes never travel in snapshots. */
  readonly resourceId: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly disposition: 'attachment' | 'inline';
  readonly contentId: string | null;
}

export interface EmailMessage {
  readonly messageId: string;
  readonly internetMessageId?: string | null;
  readonly from: EmailParticipant;
  readonly to: readonly EmailParticipant[];
  readonly sentAt: string;
  readonly bodyText: string;
  readonly bodyHtml?: string | null;
  readonly attachments?: readonly EmailAttachment[];
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
  /** Provider-neutral membership supplied by the account adapter. */
  readonly providerResources?: readonly ProviderMailboxResource[];
  readonly status: ThreadStatus;
  readonly labels: readonly string[];
  readonly messages: readonly EmailMessage[];
  readonly reminder: TapEmailReminder | null;
  /** TAP-owned correction; provider synchronization must not overwrite it. */
  readonly attentionCorrection?: ThreadAttentionCorrectionRecord;
}

export interface ThreadAttentionCorrectionRecord {
  readonly critical?: boolean;
  readonly responseState?: 'needs-response' | 'none' | 'waiting';
  readonly correctedAt: string;
}

export interface MailPreferences {
  readonly imagePolicyVersion?: 1;
  readonly imagesEnabled: boolean;
  readonly trackingPixelsEnabled: boolean;
  readonly notificationsConfigured: boolean;
  readonly notificationAccountIds: readonly string[];
  readonly shortcutOverrides: Readonly<Record<string, string>>;
}

export interface ThreadUndoEntry {
  readonly kind?: 'thread';
  readonly label: string;
  readonly thread: EmailThread;
  readonly commandId: string;
  readonly previousSelectedThreadKey: string | null;
  readonly expiresAt: string;
}

export interface SendUndoEntry {
  readonly kind: 'send';
  readonly label: string;
  readonly accountId: string;
  readonly draftKey: string;
  readonly commandId: string;
  readonly expiresAt: string;
}

export type UndoEntry = ThreadUndoEntry | SendUndoEntry;

export interface RecoverableImmediateSendAttempt {
  /** Immutable command identity submitted for this delivery attempt. */
  readonly command: MailCommand<MailDraftPayload>;
  /** Null only while an explicitly requested retry is still in flight. */
  readonly receipt: MailCommandReceipt | null;
}

export interface RecoverableImmediateSend {
  /** The first attempt is the immutable origin for every later retry. */
  readonly attempts: readonly RecoverableImmediateSendAttempt[];
  readonly recordedAt: string;
  readonly updatedAt: string;
}

export interface PendingThreadIntent {
  readonly commandId: string;
  readonly accountId: string;
  readonly threadId: string;
  /** A view overlay. Provider projection rows are changed only after acknowledgement. */
  readonly patch: Readonly<{
    unread?: boolean;
    starred?: boolean;
    status?: ThreadStatus;
    providerResources?: readonly ProviderMailboxResource[];
    reminder?: TapEmailReminder | null;
  }>;
}

export interface MailState {
  readonly schemaVersion: 2;
  readonly accounts: readonly EmailAccount[];
  readonly threads: readonly EmailThread[];
  readonly selectedAccountId: AccountSelection;
  readonly selectedSplit: MailSplit;
  readonly selectedThreadKey: string | null;
  readonly commands: readonly MailCommand[];
  readonly pendingThreadIntents?: readonly PendingThreadIntent[];
  /** Recoverable immediate-send outcomes; optional for schema-v2 cache compatibility. */
  readonly outbox?: readonly RecoverableImmediateSend[];
  readonly preferences: MailPreferences;
  readonly undo: UndoEntry | null;
}

export const defaultPreferences: MailPreferences = {
  imagePolicyVersion: 1,
  imagesEnabled: true,
  trackingPixelsEnabled: false,
  notificationsConfigured: false,
  notificationAccountIds: [],
  shortcutOverrides: {},
};

export function normalizeMailPreferences(
  preferences: MailPreferences,
): MailPreferences {
  if (preferences.imagePolicyVersion === 1) return preferences;
  return {
    ...preferences,
    imagePolicyVersion: 1,
    imagesEnabled: true,
    trackingPixelsEnabled: false,
  };
}

export function emptyMailState(): MailState {
  return {
    schemaVersion: 2,
    accounts: [],
    threads: [],
    selectedAccountId: 'all',
    selectedSplit: 'inbox',
    selectedThreadKey: null,
    commands: [],
    pendingThreadIntents: [],
    outbox: [],
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
  bodyHtml?: string,
): EmailMessage {
  return { messageId, from, to: [to], sentAt, bodyText, bodyHtml };
}

// Synthetic rich mail for the standalone preview. It deliberately uses the
// table attributes and fixed-width image patterns found in real newsletters so
// local visual QA covers centering, responsive scaling, and long-reader scroll
// without committing anyone's mailbox content.
const previewRichNewsletterHtml = `
  <!doctype html>
  <html>
    <head><title>Northstar Launch Brief</title></head>
    <body bgcolor="#f1ecdf" style="margin:0;padding:0;font-family:Arial,sans-serif;color:#172b35">
      <table align="center" bgcolor="#f1ecdf" border="0" cellpadding="0" cellspacing="0" width="100%">
        <tbody><tr><td align="center" style="padding:28px 0 36px" valign="top">
          <table align="center" border="0" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;width:100%">
            <tbody>
              <tr><td align="center" style="padding:0 24px 14px;font-size:12px;letter-spacing:.12em;text-transform:uppercase">Northstar product brief</td></tr>
              <tr><td align="center" style="padding:0 24px 28px;font:500 46px/1.05 Georgia,serif">The Tuesday Launch</td></tr>
              <tr><td align="center">
                <table align="center" bgcolor="#ffffff" border="0" cellpadding="0" cellspacing="0" width="550" style="max-width:550px;width:100%">
                  <tbody><tr><td style="padding:30px 26px 38px">
                    <h1 style="margin:0 0 22px;font:500 30px/1.15 Georgia,serif">Production is ready for your final call</h1>
                    <p style="margin:0 0 24px;font-size:17px;line-height:1.45">The fallback is enabled and the rollback drill passed. Here is the final launch brief for review.</p>
                    <img alt="Abstract launch horizon" height="220" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABkAAAAKCAYAAABBq/VWAAAAQklEQVR4AeyRsQkAIAwEwy+hgziGC1haupYz2scubRICqfJw3cPDPdqYHOHdzRqghNSISzL6WRTBslafWCxJJ0XXBwAA//9zPPD0AAAABklEQVQDAL87QbtunCuTAAAAAElFTkSuQmCC" style="display:block;height:auto;max-width:550px;width:100%" width="550">
                    <p style="margin:26px 0 16px;font-size:17px;line-height:1.55">The production migration completed with no data loss. All account projections now match the source revision, and the backfill warning is limited to accounts still catching up.</p>
                    <p style="margin:0 0 16px;font-size:17px;line-height:1.55">Operations ran the rollback procedure from end to end. The drill restored service inside the agreed window and retained every queued command.</p>
                    <p style="margin:0 0 16px;font-size:17px;line-height:1.55">Support has the launch notes, escalation path, and customer language. Monitoring is configured for the first two hours after release.</p>
                    <h2 style="margin:30px 0 12px;font:500 24px/1.2 Georgia,serif">Decision requested</h2>
                    <p style="margin:0 0 16px;font-size:17px;line-height:1.55">Reply with go or no-go before 4:00 PM. A go keeps the Tuesday slot; a no-go moves the release to the next staffed window.</p>
                    <p style="margin:0;font-size:17px;line-height:1.55">Thanks for taking the final pass.<br><strong>Maya</strong></p>
                  </td></tr></tbody>
                </table>
              </td></tr>
            </tbody>
          </table>
        </td></tr></tbody>
      </table>
    </body>
  </html>
`;

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
      participants: [participant('Maya Chen', 'maya@northstar.dev'), work],
      snippet: 'That works. Production still needs your final go/no-go before 4pm today.',
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
          '2026-08-18T14:35:00.000Z',
          'Hi Zackary,\n\nWe can hold the Tuesday launch slot, but the production team needs a go/no-go before 4pm today. The remaining question is whether the migration warning should block launch.\n\nCan you take a look?\n\nMaya',
        ),
        message(
          'gmail_message_launch_review_2',
          work,
          participant('Maya Chen', 'maya@northstar.dev'),
          '2026-08-18T15:02:00.000Z',
          'I reviewed the warning. It only affects accounts that have not finished the backfill, so it should not block Tuesday. I am comfortable proceeding if production confirms the fallback is enabled.',
        ),
        message(
          'gmail_message_launch_review_3',
          participant('Maya Chen', 'maya@northstar.dev'),
          work,
          '2026-08-18T15:24:00.000Z',
          'That works. Production confirmed the fallback is enabled and the rollback drill passed. I just need your final go/no-go before 4pm and I will lock the Tuesday slot.\n\nMaya',
          previewRichNewsletterHtml,
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
    outbox: [],
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

const emailAttachmentKeys = new Set([
  'resourceId',
  'fileName',
  'mimeType',
  'sizeBytes',
  'disposition',
  'contentId',
]);

export function isEmailAttachment(value: unknown): value is EmailAttachment {
  if (!isRecord(value)) return false;
  return (
    Object.keys(value).every(key => emailAttachmentKeys.has(key)) &&
    isSafeMailIdentifier(value.resourceId) &&
    isBoundedString(value.fileName, 1_024) &&
    isBoundedString(value.mimeType, 255) &&
    value.mimeType.length > 0 &&
    Number.isSafeInteger(value.sizeBytes) &&
    Number(value.sizeBytes) >= 0 &&
    (value.disposition === 'attachment' || value.disposition === 'inline') &&
    (value.contentId === null || isBoundedString(value.contentId, 2_000))
  );
}

export function isEmailMessage(value: unknown): value is EmailMessage {
  if (!isRecord(value)) return false;
  const attachments = value.attachments;
  const attachmentIds = Array.isArray(attachments)
    ? attachments.map(attachment => isRecord(attachment) ? attachment.resourceId : null)
    : [];
  return (
    isSafeMailIdentifier(value.messageId) &&
    (value.internetMessageId === undefined || value.internetMessageId === null ||
      isBoundedString(value.internetMessageId, 2_000)) &&
    isParticipant(value.from) &&
    Array.isArray(value.to) &&
    value.to.length <= 100 &&
    value.to.every(isParticipant) &&
    isDateString(value.sentAt) &&
    isBoundedString(value.bodyText, 500_000) &&
    (value.bodyHtml === undefined ||
      value.bodyHtml === null ||
      isBoundedString(value.bodyHtml, 500_000)) &&
    (attachments === undefined || (
      Array.isArray(attachments) &&
      attachments.length <= 100 &&
      attachments.every(isEmailAttachment) &&
      new Set(attachmentIds).size === attachmentIds.length
    ))
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

function isThreadAttentionCorrection(
  value: unknown,
): value is ThreadAttentionCorrectionRecord | undefined {
  if (value === undefined) return true;
  if (!isRecord(value) || !isDateString(value.correctedAt)) return false;
  return (
    (value.critical === undefined || typeof value.critical === 'boolean') &&
    (value.responseState === undefined ||
      value.responseState === 'needs-response' ||
      value.responseState === 'none' ||
      value.responseState === 'waiting') &&
    (value.critical !== undefined || value.responseState !== undefined)
  );
}

export function isEmailThread(value: unknown): value is EmailThread {
  if (!isRecord(value)) return false;
  const resources = value.providerResources;
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
    (resources === undefined || (
      Array.isArray(resources) &&
      resources.length <= providerMailboxResources.size &&
      resources.every(resource =>
        providerMailboxResources.has(resource as ProviderMailboxResource)) &&
      new Set(resources).size === resources.length
    )) &&
    ['inbox', 'done', 'reminded', 'trashed'].includes(String(value.status)) &&
    Array.isArray(value.labels) &&
    value.labels.length <= 100 &&
    value.labels.every(label => isBoundedString(label, 256)) &&
    Array.isArray(value.messages) &&
    value.messages.length <= 1_000 &&
    value.messages.every(isEmailMessage) &&
    isReminder(value.reminder) &&
    isThreadAttentionCorrection(value.attentionCorrection)
  );
}

function isEmailAccount(value: unknown): value is EmailAccount {
  if (!isRecord(value)) return false;
  return (
    isSafeMailIdentifier(value.accountId) &&
    isSafeMailIdentifier(value.provider) &&
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
    value.threads.every(isEmailThread)
  );
}

export function isMailPreferences(value: unknown): value is MailPreferences {
  if (!isRecord(value)) return false;
  return (
    (value.imagePolicyVersion === undefined || value.imagePolicyVersion === 1) &&
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

function isImmediateSendCommand(
  value: unknown,
): value is MailCommand<MailDraftPayload> {
  return isMailCommand(value) &&
    value.kind === 'send_draft' &&
    isMailDraftPayload(value.payload);
}

function hasSameImmediateSendIdentity(
  command: MailCommand<MailDraftPayload>,
  origin: MailCommand<MailDraftPayload>,
): boolean {
  return command.accountId === origin.accountId &&
    command.threadId === origin.threadId &&
    command.expectedProviderRevision === origin.expectedProviderRevision &&
    JSON.stringify(command.payload) === JSON.stringify(origin.payload);
}

export function isRecoverableImmediateSend(
  value: unknown,
): value is RecoverableImmediateSend {
  if (!isRecord(value) ||
    !Array.isArray(value.attempts) ||
    value.attempts.length === 0 ||
    value.attempts.length > 100 ||
    !isDateString(value.recordedAt) ||
    !isDateString(value.updatedAt)) {
    return false;
  }
  const attempts = value.attempts;
  const originValue = attempts[0];
  if (!isRecord(originValue) ||
    !isImmediateSendCommand(originValue.command) ||
    originValue.receipt === null) return false;
  const origin = originValue.command;
  const commandIds = new Set<string>();
  return attempts.every((attemptValue, index) => {
    if (!isRecord(attemptValue) || !isImmediateSendCommand(attemptValue.command)) return false;
    if (commandIds.has(attemptValue.command.commandId)) return false;
    commandIds.add(attemptValue.command.commandId);
    if (!hasSameImmediateSendIdentity(attemptValue.command, origin)) return false;
    if (attemptValue.receipt === null) return index === attempts.length - 1;
    if (!isMailCommandReceipt(attemptValue.receipt) ||
      attemptValue.receipt.commandId !== attemptValue.command.commandId ||
      attemptValue.receipt.idempotencyKey !== attemptValue.command.idempotencyKey ||
      attemptValue.receipt.accountId !== attemptValue.command.accountId) {
      return false;
    }
    if (index < attempts.length - 1) return attemptValue.receipt.state === 'failed';
    return attemptValue.receipt.state === 'failed' || attemptValue.receipt.state === 'uncertain';
  });
}

export function recoverableImmediateSends(
  state: MailState,
): readonly RecoverableImmediateSend[] {
  return state.outbox ?? [];
}

export function isMailState(value: unknown): value is MailState {
  if (!isRecord(value)) return false;
  const commands = Array.isArray(value.commands) ? value.commands : null;
  const pendingThreadIntents = value.pendingThreadIntents === undefined
    ? []
    : Array.isArray(value.pendingThreadIntents)
      ? value.pendingThreadIntents
      : null;
  const validAccountSelection = value.selectedAccountId === 'all' ||
    isSafeMailIdentifier(value.selectedAccountId);
  const undo = isRecord(value.undo) ? value.undo : null;
  const validUndo = value.undo === null || Boolean(undo) &&
    isBoundedString(undo?.label, 500) &&
    isSafeMailIdentifier(undo?.commandId) &&
    isDateString(undo?.expiresAt) && (
      undo?.kind === 'send'
        ? isSafeMailIdentifier(undo.accountId) && isSafeMailIdentifier(undo.draftKey)
        : (undo?.kind === undefined || undo.kind === 'thread') &&
          isEmailThread(undo?.thread) &&
          (undo?.previousSelectedThreadKey === null ||
            isBoundedString(undo?.previousSelectedThreadKey, 513))
    );
  return (
    value.schemaVersion === 2 &&
    isMailboxSnapshot({
      schemaVersion: 1,
      accounts: value.accounts,
      threads: value.threads,
    }) &&
    validAccountSelection &&
    mailSplits.includes(value.selectedSplit as MailSplit) &&
    (value.selectedThreadKey === null || isBoundedString(value.selectedThreadKey, 513)) &&
    commands !== null &&
    commands.length <= 10_000 &&
    commands.every(isMailCommand) &&
    pendingThreadIntents !== null &&
    pendingThreadIntents.length <= 10_000 &&
    pendingThreadIntents.every(item => {
      if (!isRecord(item) || !isRecord(item.patch)) return false;
      const patch = item.patch;
      return isSafeMailIdentifier(item.commandId) &&
        isSafeMailIdentifier(item.accountId) &&
        isSafeMailIdentifier(item.threadId) &&
        (patch.unread === undefined || typeof patch.unread === 'boolean') &&
        (patch.starred === undefined || typeof patch.starred === 'boolean') &&
        (patch.status === undefined || threadStatuses.has(patch.status as ThreadStatus)) &&
        (patch.providerResources === undefined || (
          Array.isArray(patch.providerResources) &&
          patch.providerResources.every(resource =>
            providerMailboxResources.has(resource as ProviderMailboxResource))
        )) &&
        (patch.reminder === undefined || isReminder(patch.reminder));
    }) &&
    (value.outbox === undefined || (
      Array.isArray(value.outbox) &&
      value.outbox.length <= 1_000 &&
      value.outbox.every(isRecoverableImmediateSend) &&
      value.outbox.every(item => {
        const current = item.attempts[item.attempts.length - 1];
        return current?.receipt !== null || commands.some(command =>
          isMailCommand(command) && command.commandId === current.command.commandId
        );
      })
    )) &&
    isMailPreferences(value.preferences) &&
    validUndo
  );
}

export function threadMatchesSplit(
  thread: EmailThread,
  split: MailSplit,
): boolean {
  const resources = thread.providerResources;
  if (split === 'starred') {
    return resources
      ? resources.includes('starred')
      : thread.starred && thread.status !== 'trashed';
  }
  if (
    split === 'drafts' ||
    split === 'sent' ||
    split === 'spam'
  ) {
    return resources?.includes(split) ?? false;
  }
  if (split === 'done') return thread.status === 'done';
  if (split === 'reminders') return thread.status === 'reminded';
  if (split === 'trash') {
    return resources
      ? resources.includes('trash')
      : thread.status === 'trashed';
  }
  if (split === 'critical') return thread.status === 'inbox' && thread.critical;
  if (split === 'needs-response') {
    return thread.status === 'inbox' && thread.needsResponse;
  }
  if (split === 'waiting') {
    return thread.status === 'inbox' && thread.waitingOnOthers;
  }
  if (split === 'inbox') {
    return resources
      ? resources.includes('inbox') && thread.status !== 'reminded'
      : thread.status === 'inbox';
  }

  // Auto Archived, Scheduled, Outbox, and Snippets are TAP-owned resources. Their
  // adapters can populate them later without coupling this selector to a
  // provider's label vocabulary.
  return false;
}

export function mailSplitThreadCount(state: MailState, split: MailSplit): number {
  if (split === 'outbox') {
    return recoverableImmediateSends(state).filter(item => {
      const origin = item.attempts[0]?.command;
      return origin && (
        state.selectedAccountId === 'all' || origin.accountId === state.selectedAccountId
      );
    }).length;
  }
  return projectedThreads(state).filter(thread =>
    (state.selectedAccountId === 'all' || thread.accountId === state.selectedAccountId) &&
    threadMatchesSplit(thread, split)
  ).length;
}

function receiptMatchesCommand(
  receipt: MailCommandReceipt,
  command: MailCommand,
): boolean {
  return receipt.commandId === command.commandId &&
    receipt.idempotencyKey === command.idempotencyKey &&
    receipt.accountId === command.accountId;
}

/**
 * Settles one immutable command attempt. Failed/uncertain immediate sends move
 * into the recoverable Outbox before the pending command is removed.
 */
export function settleMailCommand(
  state: MailState,
  command: MailCommand,
  receipt: MailCommandReceipt,
  now: string,
): MailState {
  if (!receiptMatchesCommand(receipt, command) || !isDateString(now)) return state;
  const terminal = ['applied', 'failed', 'uncertain', 'cancelled'].includes(receipt.state);
  if (!terminal) return state;
  const existingOutbox = recoverableImmediateSends(state);
  const existingIndex = existingOutbox.findIndex(item =>
    item.attempts.some(attempt => attempt.command.commandId === command.commandId)
  );
  let outbox = existingOutbox;
  if (command.kind === 'send_draft' && isMailDraftPayload(command.payload)) {
    if (receipt.state === 'applied' || receipt.state === 'cancelled') {
      if (existingIndex >= 0) {
        outbox = existingOutbox.filter((_, index) => index !== existingIndex);
      }
    } else if (receipt.state === 'failed' || receipt.state === 'uncertain') {
      const typedCommand = command as MailCommand<MailDraftPayload>;
      if (existingIndex >= 0) {
        outbox = existingOutbox.map((item, index) => index === existingIndex
          ? {
              ...item,
              attempts: item.attempts.map(attempt =>
                attempt.command.commandId === command.commandId
                  ? { ...attempt, receipt }
                  : attempt
              ),
              updatedAt: now,
            }
          : item);
      } else {
        outbox = [
          ...existingOutbox,
          {
            attempts: [{ command: typedCommand, receipt }],
            recordedAt: now,
            updatedAt: now,
          },
        ];
      }
    }
  }
  const pendingIntent = (state.pendingThreadIntents ?? []).find(
    intent => intent.commandId === command.commandId,
  );
  const acknowledgedPatch = pendingIntent && command.kind === 'create_reminder'
    ? { reminder: pendingIntent.patch.reminder }
    : pendingIntent?.patch;
  const threads = receipt.state === 'applied' && pendingIntent && acknowledgedPatch
    ? state.threads.map(thread =>
        thread.accountId === pendingIntent.accountId &&
        thread.threadId === pendingIntent.threadId
          ? { ...thread, ...acknowledgedPatch }
          : thread)
    : state.threads;
  const settled = {
    ...state,
    threads,
    commands: state.commands.filter(item => item.commandId !== command.commandId),
    pendingThreadIntents: (state.pendingThreadIntents ?? []).filter(
      intent => intent.commandId !== command.commandId,
    ),
    outbox,
    undo: state.undo?.commandId === command.commandId ? null : state.undo,
    selectedThreadKey:
      receipt.state !== 'applied' &&
      state.undo?.kind !== 'send' &&
      state.undo?.commandId === command.commandId
        ? state.undo.previousSelectedThreadKey
        : state.selectedThreadKey,
  };
  return settled;
}

function restoreOptimisticArchive(
  state: MailState,
  command: MailCommand,
  undo: UndoEntry | null = state.undo,
): MailState {
  if (command.kind !== 'archive' || !command.threadId) return state;
  const restored = undo?.kind !== 'send' && undo?.commandId === command.commandId
    ? undo.thread
    : null;
  return {
    ...state,
    pendingThreadIntents: (state.pendingThreadIntents ?? []).filter(
      intent => intent.commandId !== command.commandId,
    ),
    ...(restored ? { selectedThreadKey: emailThreadKey(restored) } : {}),
  };
}

/**
 * Rejects a Done transition that never crossed the local durability barrier.
 * This keeps provider truth visible when private profile storage is revoked
 * after the mailbox has opened.
 */
export function rollbackUnpersistedMailCommand(
  state: MailState,
  commandId: string,
): MailState {
  const command = state.commands.find(item => item.commandId === commandId);
  if (!command || command.kind !== 'archive') return state;
  const rolledBack = restoreOptimisticArchive(state, command);
  return {
    ...rolledBack,
    commands: rolledBack.commands.filter(item => item.commandId !== commandId),
    undo: rolledBack.undo?.commandId === commandId ? null : rolledBack.undo,
  };
}

/**
 * Queues an explicit retry only for a definite failure. It creates a new
 * attempt identity while preserving the exact original draft payload/draftKey
 * used to derive the provider Message-ID.
 */
export function retryRecoverableImmediateSend(
  state: MailState,
  originalCommandId: string,
  commandId: string,
  now: string,
): MailState {
  if (!isSafeMailIdentifier(commandId) || !isDateString(now) ||
    state.commands.some(command => command.commandId === commandId) ||
    recoverableImmediateSends(state).some(item => item.attempts.some(attempt =>
      attempt.command.commandId === commandId
    ))) {
    return state;
  }
  const index = recoverableImmediateSends(state).findIndex(item =>
    item.attempts[0]?.command.commandId === originalCommandId
  );
  if (index < 0) return state;
  const item = recoverableImmediateSends(state)[index]!;
  const current = item.attempts[item.attempts.length - 1]!;
  if (current.receipt?.state !== 'failed') return state;
  const origin = item.attempts[0]!.command;
  const retry: MailCommand<MailDraftPayload> = {
    ...origin,
    commandId,
    idempotencyKey: `tap-email:${origin.accountId}:${commandId}`,
    createdAt: now,
    payload: origin.payload,
  };
  const outbox = recoverableImmediateSends(state).map((candidate, candidateIndex) =>
    candidateIndex === index
      ? {
          ...candidate,
          attempts: [...candidate.attempts, { command: retry, receipt: null }],
          updatedAt: now,
        }
      : candidate
  );
  return {
    ...state,
    commands: [...state.commands, retry],
    outbox,
  };
}

export function visibleThreads(state: MailState): readonly EmailThread[] {
  return projectedThreads(state)
    .filter(thread =>
      state.selectedAccountId === 'all'
        ? true
        : thread.accountId === state.selectedAccountId,
    )
    .filter(thread => threadMatchesSplit(thread, state.selectedSplit))
    .toSorted((left, right) => right.receivedAt.localeCompare(left.receivedAt));
}

export function projectedThreads(state: MailState): readonly EmailThread[] {
  const intents = state.pendingThreadIntents ?? [];
  const byThread = new Map<string, PendingThreadIntent[]>();
  for (const intent of intents) {
    const key = `${intent.accountId}\u0000${intent.threadId}`;
    const group = byThread.get(key) ?? [];
    group.push(intent);
    byThread.set(key, group);
  }
  return state.threads.map(thread => {
    const providerWithReminder = thread.reminder
      ? { ...thread, status: 'reminded' as const }
      : thread;
    const withTapOverlay = thread.attentionCorrection
      ? applyAttentionCorrectionToThread(providerWithReminder, thread.attentionCorrection)
      : providerWithReminder;
    const group = byThread.get(emailThreadKey(thread));
    return group
      ? group.reduce<EmailThread>(
          (projected, intent) => ({ ...projected, ...intent.patch }),
          withTapOverlay,
        )
      : withTapOverlay;
  });
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
  const patch: PendingThreadIntent['patch'] = {
    ...(changed.unread === thread.unread ? {} : { unread: changed.unread }),
    ...(changed.starred === thread.starred ? {} : { starred: changed.starred }),
    ...(changed.status === thread.status ? {} : { status: changed.status }),
    ...(changed.providerResources === thread.providerResources
      ? {}
      : { providerResources: changed.providerResources ?? [] }),
    ...(changed.reminder === thread.reminder ? {} : { reminder: changed.reminder }),
  };
  const nextCommand = command(thread);
  const provisional = {
    ...state,
    pendingThreadIntents: [
      ...(state.pendingThreadIntents ?? []),
      {
        commandId,
        accountId: thread.accountId,
        threadId: thread.threadId,
        patch,
      },
    ],
  };
  const after = visibleThreads(provisional);
  const nextThread = after[Math.min(Math.max(0, currentIndex), after.length - 1)];
  return {
    ...provisional,
    selectedThreadKey: nextThread ? emailThreadKey(nextThread) : null,
    commands: [...state.commands, nextCommand],
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
  const thread = selectedThread(state);
  if (!thread || !threadMatchesSplit(thread, 'inbox')) return state;
  return withThreadAction(
    state,
    commandId,
    now,
    thread => ({
      ...thread,
      status: 'done',
      ...(thread.providerResources
        ? { providerResources: thread.providerResources.filter(resource => resource !== 'inbox') }
        : {}),
    }),
    thread => commandFor(thread, commandId, 'archive', now, {}),
    'Marked done',
  );
}

export function markThreadRead(
  state: MailState,
  accountId: string,
  threadId: string,
  commandId: string,
  now: string,
): MailState {
  const thread = projectedThreads(state).find(
    item => item.accountId === accountId && item.threadId === threadId,
  );
  if (!thread?.unread) return state;
  const command = commandFor(thread, commandId, 'mark_read', now, {});
  return {
    ...state,
    pendingThreadIntents: [
      ...(state.pendingThreadIntents ?? []),
      { commandId, accountId, threadId, patch: { unread: false } },
    ],
    commands: [...state.commands, command],
  };
}

export function toggleThreadRead(
  state: MailState,
  commandId: string,
  now: string,
): MailState {
  const thread = selectedThread(state);
  if (!thread) return state;
  const unread = !thread.unread;
  const command = commandFor(thread, commandId, unread ? 'mark_unread' : 'mark_read', now, {});
  return {
    ...state,
    pendingThreadIntents: [
      ...(state.pendingThreadIntents ?? []),
      {
        commandId,
        accountId: thread.accountId,
        threadId: thread.threadId,
        patch: { unread },
      },
    ],
    commands: [...state.commands, command],
  };
}

export function trashThread(
  state: MailState,
  commandId: string,
  now: string,
): MailState {
  if (selectedThread(state)?.status === 'trashed') return state;
  return withThreadAction(
    state,
    commandId,
    now,
    thread => ({
      ...thread,
      status: 'trashed',
      providerResources: [
        ...(thread.providerResources ?? []).filter(resource => resource !== 'inbox'),
        ...((thread.providerResources ?? []).includes('trash') ? [] : ['trash' as const]),
      ],
    }),
    thread => commandFor(thread, commandId, 'trash', now, {}),
    'Moved to trash',
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
  if (state.undo.kind === 'send') {
    const pendingSend = state.commands.find(command =>
      command.commandId === state.undo?.commandId &&
      command.kind === 'send_draft' &&
      isMailDraftPayload(command.payload)
    );
    const replacement = pendingSend && isMailDraftPayload(pendingSend.payload)
      ? (() => {
          const { sendAfter: _sendAfter, ...draftPayload } = pendingSend.payload;
          return {
            ...pendingSend,
            kind: 'save_draft' as const,
            payload: draftPayload,
          };
        })()
      : null;
    return {
      ...state,
      commands: state.commands.flatMap(command =>
        command.commandId !== state.undo?.commandId
          ? [command]
          : replacement
            ? [replacement]
            : []
      ),
      undo: null,
    };
  }
  const restored = state.undo.thread;
  return {
    ...state,
    pendingThreadIntents: (state.pendingThreadIntents ?? []).filter(
      intent => intent.commandId !== state.undo?.commandId,
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
  const providerResources = thread.providerResources
    ? starred
      ? [...new Set([...thread.providerResources, 'starred' as const])]
      : thread.providerResources.filter(resource => resource !== 'starred')
    : undefined;
  const command = commandFor(thread, commandId, starred ? 'star' : 'unstar', now, {});
  return {
    ...state,
    pendingThreadIntents: [
      ...(state.pendingThreadIntents ?? []),
      {
        commandId,
        accountId: thread.accountId,
        threadId: thread.threadId,
        patch: { starred, ...(providerResources ? { providerResources } : {}) },
      },
    ],
    commands: [...state.commands, command],
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
  draftIdentity?: {
    readonly draftKey: string;
    readonly draftRevision: number;
    readonly cc?: string;
    readonly bcc?: string;
    readonly attachments?: readonly MailDraftAttachment[];
    readonly sendAfter?: string;
    readonly expectedContext?: MailSenderContext;
  },
): MailState {
  if (!state.accounts.some(account => account.accountId === accountId)) return state;
  const draftKey = draftIdentity?.draftKey ?? `draft_${commandId}`;
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
      draftKey,
      draftRevision: draftIdentity?.draftRevision ?? 1,
      to,
      ...(draftIdentity?.cc ? { cc: draftIdentity.cc } : {}),
      ...(draftIdentity?.bcc ? { bcc: draftIdentity.bcc } : {}),
      subject,
      bodyText,
      ...(replyToMessageId ? { replyToMessageId } : {}),
      ...(draftIdentity?.attachments?.length
        ? { attachments: draftIdentity.attachments }
        : {}),
      ...(draftIdentity?.sendAfter ? { sendAfter: draftIdentity.sendAfter } : {}),
      ...(draftIdentity?.expectedContext ? { expectedContext: draftIdentity.expectedContext } : {}),
    },
  };
  return {
    ...state,
    commands: [
      ...state.commands.filter(existing =>
        existing.kind !== 'save_draft' ||
        (existing.payload as Readonly<Record<string, unknown>>).draftKey !== draftKey
      ),
      command,
    ],
    ...(draftIdentity?.sendAfter && Date.parse(draftIdentity.sendAfter) > Date.parse(now)
      ? {
          undo: {
            kind: 'send' as const,
            label: 'Message queued',
            accountId,
            draftKey,
            commandId,
            expiresAt: draftIdentity.sendAfter,
          },
        }
      : {}),
  };
}

export function saveMessageDraft(
  state: MailState,
  commandId: string,
  accountId: string,
  threadId: string | null,
  payload: MailDraftPayload,
  now: string,
): MailState {
  if (!state.accounts.some(account => account.accountId === accountId)) return state;
  const expectedProviderRevision = threadId
    ? state.threads.find(thread =>
        thread.accountId === accountId && thread.threadId === threadId)?.providerRevision ?? null
    : null;
  const command: MailCommand<MailDraftPayload> = {
    v: TAP_EMAIL_PROTOCOL_VERSION,
    commandId,
    idempotencyKey: `tap-email:${accountId}:${commandId}`,
    accountId,
    threadId,
    kind: 'save_draft',
    createdAt: now,
    expectedProviderRevision,
    payload,
  };
  const supersededPendingSaves = new Set(
    state.commands.flatMap(existing =>
      existing.kind === 'save_draft' &&
      (existing.payload as Readonly<Record<string, unknown>>).draftKey === payload.draftKey
        ? [existing.commandId]
        : []),
  );
  return {
    ...state,
    commands: [
      ...state.commands.filter(existing => !supersededPendingSaves.has(existing.commandId)),
      command,
    ],
  };
}

export function scheduleMessageDraft(
  state: MailState,
  commandId: string,
  accountId: string,
  threadId: string | null,
  payload: MailSchedulePayload,
  now: string,
): MailState {
  if (
    !state.accounts.some(account => account.accountId === accountId) ||
    !Number.isFinite(Date.parse(now)) ||
    Date.parse(payload.scheduledFor) <= Date.parse(now)
  ) return state;
  const expectedProviderRevision = threadId
    ? state.threads.find(thread =>
        thread.accountId === accountId && thread.threadId === threadId)?.providerRevision ?? null
    : null;
  const command: MailCommand<MailSchedulePayload> = {
    v: TAP_EMAIL_PROTOCOL_VERSION,
    commandId,
    idempotencyKey: `tap-email:${accountId}:${commandId}`,
    accountId,
    threadId,
    kind: 'schedule_send',
    createdAt: now,
    expectedProviderRevision,
    payload,
  };
  return {
    ...state,
    commands: [
      ...state.commands.filter(existing =>
        existing.kind !== 'save_draft' ||
        (existing.payload as Readonly<Record<string, unknown>>).draftKey !== payload.draftKey),
      command,
    ],
  };
}

export function cancelScheduledMessage(
  state: MailState,
  commandId: string,
  accountId: string,
  threadId: string | null,
  scheduledCommandId: string,
  now: string,
): MailState {
  if (
    !state.accounts.some(account => account.accountId === accountId) ||
    !isSafeMailIdentifier(scheduledCommandId)
  ) return state;
  const command: MailCommand = {
    v: TAP_EMAIL_PROTOCOL_VERSION,
    commandId,
    idempotencyKey: `tap-email:${accountId}:${commandId}`,
    accountId,
    threadId,
    kind: 'cancel_scheduled_send',
    createdAt: now,
    expectedProviderRevision: null,
    payload: { scheduledCommandId },
  };
  return { ...state, commands: [...state.commands, command] };
}

export function mergeMailboxSnapshot(
  state: MailState,
  snapshot: MailboxSnapshot,
): MailState {
  const previousAccounts = new Map(
    state.accounts.map(account => [account.accountId, account] as const),
  );
  const nextAccounts = snapshot.accounts.map(account => {
    const previous = previousAccounts.get(account.accountId);
    return previous && emailAccountsEqual(previous, account) ? previous : account;
  });
  const accounts = arraysReferenceEqual(state.accounts, nextAccounts)
    ? state.accounts
    : nextAccounts;

  const previousThreads = new Map(
    state.threads.map(thread => [emailThreadKey(thread), thread] as const),
  );
  const nextThreads = snapshot.threads.map(incoming => {
    const previous = previousThreads.get(emailThreadKey(incoming));
    if (!previous) return incoming;

    const correctedIncoming = previous.attentionCorrection
      ? { ...incoming, attentionCorrection: previous.attentionCorrection }
      : incoming;

    // `/v1/mailbox` intentionally carries only the latest plaintext preview.
    // Retain already-hydrated messages (and their rich HTML) while adding any
    // newly observed preview. The selected-thread hydration effect replaces
    // this stale-while-revalidate view when providerRevision advances.
    const messages = mergeMailboxPreviewMessages(previous.messages, correctedIncoming.messages);
    return emailThreadProjectionEqual(previous, correctedIncoming) && messages === previous.messages
      ? previous
      : { ...correctedIncoming, messages };
  });
  const threads = arraysReferenceEqual(state.threads, nextThreads)
    ? state.threads
    : nextThreads;

  const accountStillExists =
    state.selectedAccountId === 'all' ||
    accounts.some(account => account.accountId === state.selectedAccountId);
  const selectedAccountId = accountStillExists ? state.selectedAccountId : 'all';
  const merged = {
    ...state,
    accounts,
    threads,
    selectedAccountId,
  };
  const visible = visibleThreads(merged);
  const selectedThreadKey =
    visible.some(thread => emailThreadKey(thread) === state.selectedThreadKey)
      ? state.selectedThreadKey
      : visible[0] ? emailThreadKey(visible[0]) : null;
  if (
    accounts === state.accounts &&
    threads === state.threads &&
    selectedAccountId === state.selectedAccountId &&
    selectedThreadKey === state.selectedThreadKey
  ) {
    return state;
  }
  return { ...merged, selectedThreadKey };
}

/**
 * Merges one bounded provider page without interpreting absence from that page
 * as provider deletion. Only a completed traversal may replace the full
 * provider projection through `mergeMailboxSnapshot`.
 */
export function mergeMailboxPage(
  state: MailState,
  page: MailboxSnapshot,
): MailState {
  const threads = new Map(
    state.threads.map(thread => [emailThreadKey(thread), thread] as const),
  );
  for (const thread of page.threads) threads.set(emailThreadKey(thread), thread);
  return mergeMailboxSnapshot(state, {
    schemaVersion: 1,
    accounts: page.accounts.length > 0 ? page.accounts : state.accounts,
    threads: [...threads.values()].toSorted((left, right) =>
      right.receivedAt.localeCompare(left.receivedAt) ||
      left.accountId.localeCompare(right.accountId) ||
      left.threadId.localeCompare(right.threadId)),
  });
}

function arraysReferenceEqual<T>(
  left: readonly T[],
  right: readonly T[],
): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function stringArraysEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function optionalStringArraysEqual(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return stringArraysEqual(left, right);
}

function participantsEqual(
  left: readonly EmailParticipant[],
  right: readonly EmailParticipant[],
): boolean {
  return left.length === right.length && left.every((participant, index) => {
    const other = right[index];
    return Boolean(
      other &&
      participant.name === other.name &&
      participant.address === other.address,
    );
  });
}

function remindersEqual(
  left: TapEmailReminder | null,
  right: TapEmailReminder | null,
): boolean {
  if (left === right) return true;
  return Boolean(
    left &&
    right &&
    left.reminderId === right.reminderId &&
    left.accountId === right.accountId &&
    left.threadId === right.threadId &&
    left.dueAt === right.dueAt &&
    left.condition === right.condition &&
    left.createdAt === right.createdAt,
  );
}

function correctionsEqual(
  left: ThreadAttentionCorrectionRecord | undefined,
  right: ThreadAttentionCorrectionRecord | undefined,
): boolean {
  if (left === right) return true;
  return Boolean(
    left &&
    right &&
    left.critical === right.critical &&
    left.responseState === right.responseState &&
    left.correctedAt === right.correctedAt,
  );
}

function emailAccountsEqual(left: EmailAccount, right: EmailAccount): boolean {
  return (
    left.accountId === right.accountId &&
    left.provider === right.provider &&
    left.address === right.address &&
    left.displayName === right.displayName &&
    left.accent === right.accent &&
    left.coverage.accountId === right.coverage.accountId &&
    left.coverage.state === right.coverage.state &&
    left.coverage.newestHistoryId === right.coverage.newestHistoryId &&
    left.coverage.observedAt === right.coverage.observedAt &&
    left.coverage.backfillCompleteThrough === right.coverage.backfillCompleteThrough &&
    left.coverage.unresolvedFailures === right.coverage.unresolvedFailures
  );
}

function emailThreadProjectionEqual(
  left: EmailThread,
  right: EmailThread,
): boolean {
  return (
    left.threadId === right.threadId &&
    left.accountId === right.accountId &&
    left.providerRevision === right.providerRevision &&
    left.subject === right.subject &&
    participantsEqual(left.participants, right.participants) &&
    left.snippet === right.snippet &&
    left.receivedAt === right.receivedAt &&
    left.unread === right.unread &&
    left.starred === right.starred &&
    left.critical === right.critical &&
    left.needsResponse === right.needsResponse &&
    left.waitingOnOthers === right.waitingOnOthers &&
    optionalStringArraysEqual(left.providerResources, right.providerResources) &&
    left.status === right.status &&
    stringArraysEqual(left.labels, right.labels) &&
    remindersEqual(left.reminder, right.reminder) &&
    correctionsEqual(left.attentionCorrection, right.attentionCorrection)
  );
}

function applyAttentionCorrectionToThread(
  thread: EmailThread,
  correction: ThreadAttentionCorrectionRecord,
): EmailThread {
  return {
    ...thread,
    critical: correction.critical ?? thread.critical,
    ...(correction.responseState === undefined
      ? {}
      : {
          needsResponse: correction.responseState === 'needs-response',
          waitingOnOthers: correction.responseState === 'waiting',
        }),
    attentionCorrection: correction,
  };
}

export function correctThreadAttention(
  state: MailState,
  accountId: string,
  threadId: string,
  correction: Omit<ThreadAttentionCorrectionRecord, 'correctedAt'>,
  correctedAt: string,
): MailState {
  if (!isDateString(correctedAt)) return state;
  const candidate: ThreadAttentionCorrectionRecord = { ...correction, correctedAt };
  if (!isThreadAttentionCorrection(candidate)) return state;
  let changed = false;
  const threads = state.threads.map(thread => {
    if (thread.accountId !== accountId || thread.threadId !== threadId) return thread;
    const record: ThreadAttentionCorrectionRecord = {
      ...thread.attentionCorrection,
      ...correction,
      correctedAt,
    };
    changed = true;
    return { ...thread, attentionCorrection: record };
  });
  return changed ? { ...state, threads } : state;
}

function mergeMailboxPreviewMessages(
  previous: readonly EmailMessage[],
  previews: readonly EmailMessage[],
): readonly EmailMessage[] {
  if (previews.length === 0) return previous;
  if (previous.length === 0) return previews;

  const knownMessageIds = new Set(previous.map(message => message.messageId));
  const newlyObserved = previews.filter(message => !knownMessageIds.has(message.messageId));
  if (newlyObserved.length === 0) return previous;

  return [...previous, ...newlyObserved].sort(
    (left, right) => Date.parse(left.sentAt) - Date.parse(right.sentAt),
  );
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
  const threads = projectedThreads(state);
  const active = threads.filter(thread => thread.status === 'inbox');
  const coverageComplete = operationalZeroAllowed(
    state.accounts.map(account => account.coverage),
  );
  const actionable = active.filter(
    thread => thread.critical || thread.needsResponse,
  );
  const failedCommands = recoverableImmediateSends(state).length;
  return {
    generatedAt: now,
    accountIds: state.accounts.map(account => account.accountId),
    inbox: active.length,
    critical: active.filter(thread => thread.critical).length,
    needsResponse: active.filter(thread => thread.needsResponse).length,
    waiting: active.filter(thread => thread.waitingOnOthers).length,
    dueReminders: threads.filter(
      thread =>
        thread.status === 'reminded' &&
        thread.reminder &&
        Date.parse(thread.reminder.dueAt) <= Date.parse(now),
    ).length,
    failedCommands,
    operationalZero: coverageComplete && actionable.length === 0 && failedCommands === 0,
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
  const relative = /^(?:in\s+)?(\d{1,3}|a|an|one)\s+(minutes?|hours?|days?|weeks?)$/u.exec(normalized);
  if (relative) {
    const amount = /^\d+$/u.test(relative[1]!) ? Number(relative[1]) : 1;
    if (amount < 1) return null;
    const unit = relative[2]!;
    if (unit.startsWith('minute')) {
      result.setMinutes(result.getMinutes() + amount, 0, 0);
    } else if (unit.startsWith('hour')) {
      result.setHours(result.getHours() + amount);
      result.setSeconds(0, 0);
    } else {
      result.setDate(result.getDate() + amount * (unit.startsWith('week') ? 7 : 1));
      result.setHours(8, 0, 0, 0);
    }
    return result;
  }
  const parsed = new Date(input);
  return Number.isFinite(parsed.getTime()) && parsed > now ? parsed : null;
}
