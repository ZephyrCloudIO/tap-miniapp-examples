import { sdk, type MiniAppFilesApi } from '@theaiplatform/miniapp-sdk/sdk';
import type {
  MailCommand,
  MailCommandReceipt,
  MailDraftAttachment,
  MailDraftPayload,
  ScheduledSendSummary,
} from '@tap-examples/tap-email-protocol';
import type { TapFederatedSurfaceMountContext } from '@theaiplatform/miniapp-sdk/surface';
import type { MiniAppTheme } from '@theaiplatform/miniapp-sdk/web';
import * as React from 'react';
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  TooltipProvider,
} from '@theaiplatform/miniapp-sdk/ui';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Ref,
} from 'react';
import {
  Check,
  Clock3,
  Keyboard,
  MailOpen,
  Plus,
  Rows3,
  Search,
  Settings,
} from 'lucide-react';
import {
  defaultPreferences,
  emptyMailState,
  emailThreadKey,
  composeMessage,
  cancelScheduledMessage,
  correctThreadAttention,
  mailboxSummary,
  mailSplitThreadCount,
  markDone,
  markThreadRead,
  mergeMailboxPage,
  mergeMailboxSnapshot,
  mergeThreadMessages,
  moveSelection,
  normalizeMailPreferences,
  notificationsEnabledForAccount,
  previewMailState,
  projectedThreads,
  recoverableImmediateSends,
  remindThread,
  resolveReminderInput,
  rollbackUnpersistedMailCommand,
  retryRecoverableImmediateSend,
  saveMessageDraft,
  scheduleMessageDraft,
  selectAccount,
  selectSplit,
  selectedThread,
  settleMailCommand,
  toggleThreadRead,
  toggleStar,
  threadMatchesSplit,
  trashThread,
  undoLastAction,
  visibleThreads,
  type EmailAccount,
  type EmailAttachment,
  type EmailThread,
  type MailPreferences,
  type RecoverableImmediateSend,
  type MailSplit,
  type MailState,
} from './domain';
import {
  FIXED_MAILBOX_CATEGORIES,
  TAP_MAIL_VIEWS,
  mailViewDefinition,
  type MailViewDefinition,
} from './mail-navigation';
import {
  filterMailThreads,
  parseMailSearchQuery,
  threadMatchesMailSearchConstraints,
} from './mail-search';
import { fuseMailSearchRanks } from './hybrid-mail-search';
import {
  createMailSearchCoverageReceipt,
  mailSearchCoverageLabel,
} from './mail-search-coverage';
import {
  accountIndexForCommand,
  COMPOSE_SHORTCUTS,
  isTextEntryTarget,
  listenForScopedDocumentKeyDown,
  REPLY_SHORTCUTS,
  resolveShortcut,
  shouldEnterOpenReply,
  shouldEnterPromptReply,
  SHORTCUTS,
  type EmailKeyCommand,
} from './keybindings';
import {
  stageChloeEmailPrompt,
  type ChloeEmailIntent,
} from './chloe-email';
import {
  createCoordinatorClient,
  type AttachmentMessageContext,
  type RemoteImageMessageContext,
} from './coordinator-client';
import {
  AttachmentExportError,
  exportAttachment,
  type AttachmentExportPhase,
} from './attachment-export';
import { launchGoogleAuthorization } from './google-authorization';
import { GoogleConnectButton } from './google-connect-button';
import { AccountSwitcher } from './account-switcher';
import {
  EMAIL_NETWORK_ACTION,
  EMAIL_OPEN_EXTERNAL_ACTION,
  hasEmailAuthority,
  waitForHostAuthority,
} from './authority';
import {
  createLocalEmailActivityLedger,
} from './activity-ledger';
import { commitActivityBeforeSettlement } from './activity-commit';
import { CommandPersistenceBarrier } from './command-persistence-barrier';
import {
  incompleteEmailActivityProjection,
  unavailableEmailActivityProjection,
  type EmailActivityProjection,
} from './activity';
import {
  createLocalMailStore,
  type AttachmentCacheIdentity,
  type LocalDataWipeReceipt,
  type LocalMailStore,
  type MailboxPageProgress,
} from './local-store';
import { mailStateWithoutAccount } from './local-replica';
import { StoragePrivacyPanel } from './storage-privacy-panel';
import { persistProviderVisibleMailMergeDrafts } from './email-workflows';
import { WorkflowCenter } from './workflow-center';
import {
  EMAIL_TASK_WRITE_ACTION,
  EmailTaskConfigurationError,
  EmailTaskReceiptPersistenceError,
  createEmailTask,
} from './email-task';
import {
  subscribeToArtifactEmailLaunches,
  type ArtifactEmailDraft,
} from './artifact-email-draft';
import { ReminderDialog } from './reminder-dialog';
import { ComposeDialog, type ComposeDraftMessage } from './compose-dialog';
import { ReaderActions } from './reader-actions';
import {
  ThreadAttentionPanel,
  type ThreadAttentionCorrectionInput,
} from './thread-attention-panel';
import {
  ReplyComposer,
  type ReplyPlacement,
} from './reply-composer';
import {
  groupThreadsByDay,
  threadListTimestamp,
} from './thread-list-dates';
import { THREAD_LIST_PANE_ID, ThreadListToggle } from './thread-list-toggle';
import {
  INITIAL_MAILBOX_PENDING_MESSAGE,
  watchForDelayedPendingRequest,
  type DelayedPendingRequest,
} from './pending-request';
import {
  parseConversationHandoffDeepLink,
  type ConversationHandoffPhase,
} from './conversation-handoff';
import { ConversationHandoffDialog } from './conversation-handoff-dialog';
import {
  openEmailSemanticIndex,
  type EmailSemanticIndex,
} from './semantic-email-index';

const sessionAttachmentCache = new Map<string, Uint8Array>();
let sessionAttachmentCacheBytes = 0;
const maximumSessionAttachmentCacheBytes = 32 * 1_024 * 1_024;
function attachmentCacheIdentityKey(identity: AttachmentCacheIdentity): string {
  return JSON.stringify([identity.accountId, identity.threadId, identity.messageId, identity.resourceId, identity.sizeBytes]);
}
function loadSessionAttachment(identity: AttachmentCacheIdentity): Uint8Array | null {
  const key = attachmentCacheIdentityKey(identity);
  const bytes = sessionAttachmentCache.get(key);
  if (!bytes) return null;
  sessionAttachmentCache.delete(key); sessionAttachmentCache.set(key, bytes);
  return bytes;
}
function saveSessionAttachment(identity: AttachmentCacheIdentity, bytes: Uint8Array): void {
  if (bytes.byteLength > maximumSessionAttachmentCacheBytes) return;
  const key = attachmentCacheIdentityKey(identity);
  const previous = sessionAttachmentCache.get(key);
  if (previous) sessionAttachmentCacheBytes -= previous.byteLength;
  sessionAttachmentCache.delete(key);
  const copy = new Uint8Array(bytes);
  sessionAttachmentCache.set(key, copy); sessionAttachmentCacheBytes += copy.byteLength;
  while (sessionAttachmentCacheBytes > maximumSessionAttachmentCacheBytes) {
    const oldest = sessionAttachmentCache.keys().next().value as string | undefined;
    if (!oldest) break;
    sessionAttachmentCacheBytes -= sessionAttachmentCache.get(oldest)?.byteLength ?? 0;
    sessionAttachmentCache.delete(oldest);
  }
}
import {
  ThreadMessageList,
  type ContextualAttachmentLoader,
  type ContextualAttachmentSaver,
  type ContextualRemoteImageLoader,
  type MessageExpansionRequest,
} from './thread-messages';
import { MailSyncButton } from './sync-button';
import { ScheduledSendList } from './scheduled-send-list';
import { OutboxList } from './outbox-list';
import {
  selectAndStageAttachments,
  type SelectAndStageAttachmentsResult,
} from './outbound-attachment';
import {
  loadPreferences,
  publishEmailActivityProjection,
  publishOperationalProjection,
  savePreferences,
} from './storage';
import {
  mailViewDeepLink,
  mailViewLocation,
  parseMailViewHash,
  withMailViewHash,
  type MailViewLocation,
} from './view-location';

interface TapEmailAppProps {
  readonly appTheme?: MiniAppTheme;
  readonly preview?: boolean;
  readonly surfaceContext?: TapFederatedSurfaceMountContext;
}

type Overlay = 'none' | 'remind' | 'compose' | 'palette' | 'shortcuts' | 'settings' | 'handoff' | 'workflows';

interface ReplyDraft {
  readonly accountId: string;
  readonly attachmentBusy: boolean;
  readonly attachmentError: string;
  readonly attachments: readonly MailDraftAttachment[];
  readonly bcc: string;
  readonly bodyText: string;
  readonly cc: string;
  readonly draftKey: string;
  readonly draftRevision: number;
  readonly focusRequestId: number;
  readonly inReplyToMessageId: string | null;
  readonly placement: ReplyPlacement;
  readonly recipientLabel: string;
  readonly subject: string;
  readonly threadId: string;
  readonly threadKey: string;
  readonly to: string;
}

type ConversationHandoffUiState = Readonly<{
  threadKey: string;
  status: ConversationHandoffPhase | 'created' | 'partial' | 'error';
  message: string;
}>;

type EmailTaskUiState = Readonly<{
  threadKey: string;
  status: 'creating' | 'completed' | 'duplicate-suppressed' | 'pending' | 'failed' | 'partial' | 'error';
  message: string;
}>;

type ComposeSeed = Pick<ArtifactEmailDraft, 'requestId' | 'subject' | 'bodyText'>;

type SemanticSearchState = Readonly<{
  query: string;
  threadKeys: readonly string[];
}>;

interface RemoteImageMemoryEntry {
  readonly dataUrl: string;
  readonly sizeBytes: number;
}

interface RemoteImageMemoryCache {
  readonly entries: Map<string, RemoteImageMemoryEntry>;
  sizeBytes: number;
}

const maximumRemoteImageMemoryCacheBytes = 24 * 1_024 * 1_024;
const memoryRemoteImageDataUrl = /^data:image\/(?:avif|gif|jpe?g|png|webp);base64,([a-z0-9+/]+={0,2})$/iu;

function remoteImageDataUrlSize(dataUrl: string): number | null {
  const encoded = memoryRemoteImageDataUrl.exec(dataUrl)?.[1];
  if (!encoded) return null;
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  const size = Math.floor(encoded.length * 3 / 4) - padding;
  return size > 0 ? size : null;
}

function rememberRemoteImage(
  cache: RemoteImageMemoryCache,
  url: string,
  dataUrl: string,
): void {
  const sizeBytes = remoteImageDataUrlSize(dataUrl);
  if (sizeBytes === null || sizeBytes > maximumRemoteImageMemoryCacheBytes) return;
  const previous = cache.entries.get(url);
  if (previous) cache.sizeBytes -= previous.sizeBytes;
  cache.entries.delete(url);
  cache.entries.set(url, { dataUrl, sizeBytes });
  cache.sizeBytes += sizeBytes;
  while (cache.sizeBytes > maximumRemoteImageMemoryCacheBytes) {
    const oldestUrl = cache.entries.keys().next().value as string | undefined;
    if (!oldestUrl) break;
    const evicted = cache.entries.get(oldestUrl);
    cache.entries.delete(oldestUrl);
    cache.sizeBytes -= evicted?.sizeBytes ?? 0;
  }
}

function recallRemoteImage(
  cache: RemoteImageMemoryCache,
  url: string,
): string | null {
  const entry = cache.entries.get(url);
  if (!entry) return null;
  cache.entries.delete(url);
  cache.entries.set(url, entry);
  return entry.dataUrl;
}

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  hour: 'numeric',
  minute: '2-digit',
});
const mailSearchTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
function wait(milliseconds: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, milliseconds));
}

type CoordinatorClient = ReturnType<typeof createCoordinatorClient>;

function displayParticipant(thread: EmailThread): string {
  return thread.participants[0]?.name || thread.participants[0]?.address || 'Unknown sender';
}

function accountFor(
  accounts: readonly EmailAccount[],
  accountId: string,
): EmailAccount | null {
  return accounts.find(account => account.accountId === accountId) ?? null;
}

function MailViewButtons({
  views,
  state,
  showCounts,
  onSelect,
}: {
  readonly views: readonly MailViewDefinition[];
  readonly state: MailState;
  readonly showCounts: boolean;
  readonly onSelect: (split: MailSplit) => void;
}) {
  return views.map(view => {
    const count = showCounts || view.id === 'outbox'
      ? mailSplitThreadCount(state, view.id)
      : null;
    const selected = state.selectedSplit === view.id;
    return (
      <button
        key={view.id}
        aria-current={selected ? 'page' : undefined}
        aria-label={count === null ? view.label : `${view.label}, ${count} threads`}
        className={selected ? 'is-active' : ''}
        type="button"
        onClick={() => onSelect(view.id)}
      >
        <span className="nav-label">{view.label}</span>
        {count === null ? null : <span className="nav-count">{count}</span>}
        {view.shortcut ? (
          <kbd aria-hidden="true" className="nav-shortcut">{view.shortcut}</kbd>
        ) : null}
      </button>
    );
  });
}

function CompactMailViewSelect({
  selected,
  onSelect,
}: {
  readonly selected: MailSplit;
  readonly onSelect: (split: MailSplit) => void;
}) {
  return (
    <label className="compact-mail-view-select">
      <span className="sr-only">Email view</span>
      <select
        aria-label="Email view"
        value={selected}
        onChange={event => onSelect(event.target.value as MailSplit)}
      >
        <optgroup label="Mailboxes">
          {FIXED_MAILBOX_CATEGORIES.map(view => (
            <option key={view.id} value={view.id}>{view.label}</option>
          ))}
        </optgroup>
        <optgroup label="TAP Views">
          {TAP_MAIL_VIEWS.map(view => (
            <option key={view.id} value={view.id}>{view.label}</option>
          ))}
        </optgroup>
      </select>
    </label>
  );
}

function applyMailViewLocation(state: MailState, location: MailViewLocation): MailState {
  const account = location.accountId === 'all' ||
    state.accounts.some(item => item.accountId === location.accountId)
    ? location.accountId
    : 'all';
  let next = selectSplit(selectAccount(state, account), location.split);
  if (!location.threadId) return next;
  const threadAccountId = location.threadAccountId ?? (account === 'all' ? null : account);
  if (!threadAccountId) return next;
  const target = next.threads.find(
    item => item.accountId === threadAccountId && item.threadId === location.threadId,
  );
  if (target && visibleThreads(next).some(item => emailThreadKey(item) === emailThreadKey(target))) {
    next = { ...next, selectedThreadKey: emailThreadKey(target) };
  }
  return next;
}

function accountScopedThreads(state: MailState): readonly EmailThread[] {
  return projectedThreads(state).filter(thread =>
    state.selectedAccountId === 'all' || thread.accountId === state.selectedAccountId);
}

function preferredMailboxSplit(thread: EmailThread): MailSplit {
  const preference: readonly MailSplit[] = [
    'inbox',
    'drafts',
    'sent',
    'done',
    'reminders',
    'spam',
    'trash',
    'starred',
  ];
  return preference.find(split => threadMatchesSplit(thread, split)) ?? 'inbox';
}

function moveWithinThreads(
  state: MailState,
  threads: readonly EmailThread[],
  delta: -1 | 1,
): MailState {
  if (threads.length === 0) return state;
  const current = Math.max(
    0,
    threads.findIndex(item => emailThreadKey(item) === state.selectedThreadKey),
  );
  const index = Math.min(threads.length - 1, Math.max(0, current + delta));
  const selected = threads[index];
  return selected ? { ...state, selectedThreadKey: emailThreadKey(selected) } : state;
}

function ThreadListRow({
  thread,
  account,
  displayTimestamp,
  selected,
  selectedRef,
  onSelect,
}: {
  readonly thread: EmailThread;
  readonly account: EmailAccount | null;
  readonly displayTimestamp: string;
  readonly selected: boolean;
  readonly selectedRef?: Ref<HTMLButtonElement>;
  readonly onSelect: () => void;
}) {
  return (
    <button
      className={`mail-row${selected ? ' is-selected' : ''}${thread.unread ? ' is-unread' : ''}`}
      ref={selected ? selectedRef : undefined}
      onClick={onSelect}
      type="button"
      role="option"
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
    >
      <span
        className="account-dot"
        style={{ backgroundColor: account?.accent ?? '#777' }}
        title={account?.address}
        aria-hidden="true"
      />
      <span className="mail-row-copy">
        <span className="mail-row-topline">
          <span className="mail-sender">{displayParticipant(thread)}</span>
          <time dateTime={thread.receivedAt}>
            {displayTimestamp}
          </time>
        </span>
        <span className="mail-subject">
          {thread.critical ? <span className="critical-mark">!</span> : null}
          {thread.subject}
        </span>
        <span className="mail-snippet">{thread.snippet}</span>
      </span>
      <span className="mail-row-flags" aria-hidden="true">
        {thread.starred ? '★' : ''}
      </span>
    </button>
  );
}

function CommandPalette({ onClose, onRun }: { readonly onClose: () => void; readonly onRun: (command: EmailKeyCommand) => void }) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const matches = SHORTCUTS.filter(item =>
    item.runnable !== false &&
    `${item.label} ${item.keys}`.toLowerCase().includes(query.toLowerCase()),
  );
  useEffect(() => setActiveIndex(0), [query]);
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent
        className="palette"
        hideCloseButton
        onKeyDown={event => {
          if (event.key === 'ArrowDown' && matches.length > 0) {
            event.preventDefault();
            setActiveIndex(index => (index + 1) % matches.length);
          }
          if (event.key === 'ArrowUp' && matches.length > 0) {
            event.preventDefault();
            setActiveIndex(index => (index - 1 + matches.length) % matches.length);
          }
          if (event.key === 'Enter' && matches[activeIndex]) {
            event.preventDefault();
            onRun(matches[activeIndex].command);
          }
        }}
      >
        <DialogTitle className="sr-only">Command Palette</DialogTitle>
        <DialogDescription className="sr-only">Search TAP Email actions and keyboard shortcuts.</DialogDescription>
        <Input autoFocus autoComplete="off" name="command-query" value={query} onChange={event => setQuery(event.target.value)} placeholder="Type a command…" role="combobox" aria-expanded="true" aria-controls="tap-email-command-results" aria-activedescendant={matches[activeIndex] ? `tap-email-command-${matches[activeIndex].command}` : undefined} />
        <div className="palette-results" id="tap-email-command-results" role="listbox">
          {matches.map((item, index) => (
            <Button key={item.command} id={`tap-email-command-${item.command}`} className={index === activeIndex ? 'is-active' : ''} variant="ghost" type="button" role="option" aria-selected={index === activeIndex} onMouseEnter={() => setActiveIndex(index)} onClick={() => onRun(item.command)}>
              <span>{item.label}</span><kbd>{item.keys}</kbd>
            </Button>
          ))}
          {matches.length === 0 ? <p className="palette-empty">No matching commands</p> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ShortcutDialog({ onClose }: { readonly onClose: () => void }) {
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="shortcut-dialog" hideCloseButton>
        <header><div><span className="eyebrow">Keyboard Map</span><DialogTitle>Move at Thought Speed</DialogTitle><DialogDescription className="sr-only">TAP Email keyboard shortcuts grouped by task.</DialogDescription></div><Button variant="ghost" size="icon-sm" type="button" onClick={onClose} aria-label="Close keyboard shortcuts">×</Button></header>
        {(['Triage', 'Read', 'Write', 'Navigate', 'TAP'] as const).map(group => (
          <div className="shortcut-group" key={group}>
            <h3>{group}</h3>
            {SHORTCUTS.filter(item => item.group === group).map(item => (
              <div key={item.command}><span>{item.label}</span><kbd>{item.keys}</kbd></div>
            ))}
          </div>
        ))}
        <div className="shortcut-group">
          <h3>While composing</h3>
          {COMPOSE_SHORTCUTS.map(item => (
            <div key={item.label}><span>{item.label}</span><kbd>{item.keys}</kbd></div>
          ))}
        </div>
        <div className="shortcut-group">
          <h3>While replying</h3>
          {REPLY_SHORTCUTS.map(item => (
            <div key={item.label}><span>{item.label}</span><kbd>{item.keys}</kbd></div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SettingsDialog({ accounts, preferences, store, onChange, onClose, onWipe }: {
  readonly accounts: readonly EmailAccount[];
  readonly preferences: MailPreferences;
  readonly store: LocalMailStore;
  readonly onChange: (preferences: MailPreferences) => void;
  readonly onClose: () => void;
  readonly onWipe: (receipt: LocalDataWipeReceipt) => void;
}) {
  const enabledNotificationAccounts = new Set(
    preferences.notificationsConfigured
      ? preferences.notificationAccountIds
      : accounts.map(account => account.accountId),
  );
  const setAccountNotifications = (accountId: string, enabled: boolean) => {
    const next = new Set(enabledNotificationAccounts);
    if (enabled) next.add(accountId);
    else next.delete(accountId);
    onChange({
      ...preferences,
      notificationsConfigured: true,
      notificationAccountIds: accounts
        .map(account => account.accountId)
        .filter(id => next.has(id)),
    });
  };
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="settings-dialog" hideCloseButton>
        <header><div><span className="eyebrow">Miniapp Settings</span><DialogTitle>Reading, Privacy & Alerts</DialogTitle><DialogDescription className="sr-only">Choose how TAP Email displays remote message content and which accounts may notify you.</DialogDescription></div><Button variant="ghost" size="icon-sm" type="button" onClick={onClose} aria-label="Close settings">×</Button></header>
        <label className="setting-row">
          <span><strong>Remote images</strong><small>Loaded through TAP Email so senders do not receive your IP address, cookies, or referrer.</small></span>
          <Checkbox
            checked={preferences.imagesEnabled}
            onCheckedChange={checked => onChange({
              ...preferences,
              imagePolicyVersion: 1,
              imagesEnabled: checked === true,
              trackingPixelsEnabled: checked === true
                ? preferences.trackingPixelsEnabled
                : false,
            })}
          />
        </label>
        <label className="setting-row">
          <span><strong>Tracking pixels</strong><small>Keep off to suppress hidden and tiny images commonly used to record opens.</small></span>
          <Checkbox
            checked={preferences.trackingPixelsEnabled}
            disabled={!preferences.imagesEnabled}
            onCheckedChange={checked => onChange({
              ...preferences,
              imagePolicyVersion: 1,
              trackingPixelsEnabled: checked === true,
            })}
          />
        </label>
        <h3 className="settings-section-title">Notifications</h3>
        {accounts.map(account => (
          <label className="setting-row" key={account.accountId}>
            <span><strong>{account.displayName}</strong><small>Critical mail, failed sends, and due reminders.</small></span>
            <Checkbox
              checked={enabledNotificationAccounts.has(account.accountId)}
              onCheckedChange={checked => setAccountNotifications(account.accountId, checked === true)}
            />
          </label>
        ))}
        {accounts.length === 0 ? <div className="settings-empty">Connect Google to configure account notifications.</div> : null}
        <div className="settings-note">Rich HTML stays in an isolated frame. Images are validated through the coordinator, then cached privately on this device for repeat opens; links, scripts, forms, and direct sender requests remain blocked.</div>
        <div className="settings-note">Meaning search embeds and indexes mail with an installed local model in private profile zvec storage. Email content is not sent to a remote embedding service.</div>
        <StoragePrivacyPanel accounts={accounts} onWipe={onWipe} store={store} />
        <div className="settings-note">Shortcut remapping will move to the host keybinding registry when the SDK capability lands.</div>
      </DialogContent>
    </Dialog>
  );
}

export function TapEmailApp({ appTheme = 'light', preview = false, surfaceContext }: TapEmailAppProps) {
  const store = useMemo(() => createLocalMailStore(preview), [preview]);
  const activityLedger = useMemo(
    () => createLocalEmailActivityLedger(preview),
    [preview],
  );
  const attachmentFiles = useMemo<MiniAppFilesApi | null>(() => {
    if (preview) return null;
    try {
      return sdk.files ?? null;
    } catch {
      return null;
    }
  }, [preview]);
  const [state, setState] = useState<MailState>(() => preview ? previewMailState() : emptyMailState());
  const [hydrated, setHydrated] = useState(false);
  const [initialLoadSettled, setInitialLoadSettled] = useState(false);
  const [coordinatorNetworkReady, setCoordinatorNetworkReady] = useState(false);
  const [locationReady, setLocationReady] = useState(false);
  const [mailboxError, setMailboxError] = useState('');
  const [cacheError, setCacheError] = useState('');
  const [activityError, setActivityError] = useState('');
  const [initialMailboxRequestPending, setInitialMailboxRequestPending] = useState(false);
  const [overlay, setOverlay] = useState<Overlay>('none');
  const [replyDrafts, setReplyDrafts] = useState<Readonly<Record<string, ReplyDraft>>>({});
  const [poppedReplyKey, setPoppedReplyKey] = useState<string | null>(null);
  const [threadListCollapsed, setThreadListCollapsed] = useState(false);
  const [messageExpansionRequest, setMessageExpansionRequest] =
    useState<MessageExpansionRequest | null>(null);
  const [query, setQuery] = useState('');
  const [semanticSearch, setSemanticSearch] = useState<SemanticSearchState | null>(null);
  const [semanticSearchBusy, setSemanticSearchBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [conversationHandoff, setConversationHandoff] =
    useState<ConversationHandoffUiState | null>(null);
  const [emailTask, setEmailTask] = useState<EmailTaskUiState | null>(null);
  const [composeSeed, setComposeSeed] = useState<ComposeSeed | null>(null);
  const [composeDraftKey, setComposeDraftKey] = useState<string | null>(null);
  const [scheduledSends, setScheduledSends] = useState<readonly ScheduledSendSummary[]>([]);
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [googleAuthorizationUrl, setGoogleAuthorizationUrl] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [dispatchTick, setDispatchTick] = useState(0);
  const [hydrationRetryTick, setHydrationRetryTick] = useState(0);
  const [chord, setChord] = useState<'g' | null>(null);
  const chordRef = useRef<'g' | null>(null);
  const chordTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const selectedRowRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<Overlay>('none');
  const emailTasksInFlight = useRef(new Set<string>());
  const threadListCollapsedBeforeSidecarRef = useRef(false);
  const shortcutHandlerRef = useRef<(event: globalThis.KeyboardEvent) => void>(() => undefined);
  const coordinatorRef = useRef<CoordinatorClient | null>(null);
  const stateRef = useRef(state);
  const commandPersistenceBarrier = useRef(new CommandPersistenceBarrier());
  const submittedCommands = useRef(new Set<string>());
  const commandDispatchQueues = useRef(new Map<string, Promise<void>>());
  const loadedThreadRevisions = useRef(new Map<string, string>());
  const threadHydrationInFlight = useRef(new Map<string, string>());
  const threadHydrationFailures = useRef(new Map<
    string,
    { readonly attempts: number; readonly revision: string }
  >());
  const hydrationRetryTimer = useRef<number | null>(null);
  const initialMailboxLoadInFlight = useRef(false);
  const refreshMailboxInFlight = useRef<Promise<void> | null>(null);
  const syncInFlight = useRef<Promise<void> | null>(null);
  const observedNotifications = useRef(new Set<string>());
  const notificationsPrimed = useRef(false);
  const remoteImageCache = useRef<RemoteImageMemoryCache>({
    entries: new Map(),
    sizeBytes: 0,
  });
  const remoteImageLoadQueue = useRef<Promise<unknown>>(Promise.resolve());
  const activityCommitQueue = useRef<Promise<void>>(Promise.resolve());
  const activitySettlementActive = useRef(true);
  const activityReconciliationsPending = useRef(new Set<string>());
  const queuedDraftRevisions = useRef(new Map<string, number>());
  const mailboxPageProgressPending = useRef<MailboxPageProgress | null | undefined>(undefined);
  const semanticIndexRef = useRef<Promise<EmailSemanticIndex> | null>(null);
  const idFactory = useCallback(
    () => surfaceContext?.entropy.randomUUID() ?? crypto.randomUUID(),
    [surfaceContext],
  );

  const enqueueActivityProjection = useCallback((
    operation: () => Promise<EmailActivityProjection>,
    propagateOperationFailure = false,
  ): Promise<void> => {
    const task = activityCommitQueue.current
      .catch(() => undefined)
      .then(async () => {
        let projection: EmailActivityProjection;
        let operationFailure: unknown;
        try {
          projection = await operation();
        } catch (error) {
          operationFailure = error;
          projection = unavailableEmailActivityProjection(
            new Date().toISOString(),
            'One or more committed email actions are awaiting private activity reconciliation.',
          );
        }
        await publishEmailActivityProjection(projection);
        if (operationFailure && propagateOperationFailure) {
          throw operationFailure;
        }
      });
    activityCommitQueue.current = task.then(() => undefined, () => undefined);
    return task;
  }, []);

  const recordCommittedEmailActivity = useCallback((
    command: MailCommand,
    receipt: MailCommandReceipt,
  ): Promise<void> => {
    const reconciliationKey = `${command.accountId}\u0000${command.commandId}`;
    activityReconciliationsPending.current.add(reconciliationKey);
    return enqueueActivityProjection(
    async () => {
      const projection = await activityLedger.record(command, receipt);
      activityReconciliationsPending.current.delete(reconciliationKey);
      return activityReconciliationsPending.current.size > 0
        ? incompleteEmailActivityProjection(projection, new Date().toISOString())
        : projection;
    },
    true,
  ).then(
    () => {
      if (activityReconciliationsPending.current.size === 0) {
        setActivityError('');
      }
    },
    error => {
      activityReconciliationsPending.current.add(reconciliationKey);
      setActivityError(
        'An email action is safe, but its activity receipt is still being reconciled. Activity coverage remains incomplete while TAP Email retries.',
      );
      throw error;
    },
    );
  }, [activityLedger, enqueueActivityProjection]);

  const loadRemoteImages = useCallback((
    context: RemoteImageMessageContext,
    urls: readonly string[],
  ) => {
    const task = remoteImageLoadQueue.current.then(async () => {
      if (preview) return {};
      const uniqueUrls = [...new Set(urls)];
      const missingFromMemory = uniqueUrls.filter(url =>
        recallRemoteImage(remoteImageCache.current, url) === null);
      if (missingFromMemory.length > 0) {
        const locallyCached = await store.loadRemoteImages(missingFromMemory)
          .catch(() => ({}));
        for (const [url, dataUrl] of Object.entries(locallyCached)) {
          rememberRemoteImage(remoteImageCache.current, url, dataUrl);
        }
      }
      const missing = uniqueUrls.filter(url =>
        recallRemoteImage(remoteImageCache.current, url) === null);
      if (missing.length > 0 && coordinatorNetworkReady) {
        try {
          const client = coordinatorRef.current ?? createCoordinatorClient();
          coordinatorRef.current = client;
          const loaded = await client.loadRemoteImages(context, missing);
          for (const [url, dataUrl] of Object.entries(loaded)) {
            rememberRemoteImage(remoteImageCache.current, url, dataUrl);
          }
          void store.saveRemoteImages(loaded).catch(() => undefined);
        } catch {
          // A coordinator or cache failure leaves the isolated message usable;
          // text and any already-cached images still render.
        }
      }
      return Object.fromEntries(
        uniqueUrls.flatMap(url => {
          const dataUrl = recallRemoteImage(remoteImageCache.current, url);
          return dataUrl ? [[url, dataUrl] as const] : [];
        }),
      );
    });
    remoteImageLoadQueue.current = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }, [coordinatorNetworkReady, preview, store]);

  const loadMessageAttachment = useCallback<ContextualAttachmentLoader>(async (
    context: AttachmentMessageContext,
    attachment: EmailAttachment,
    options,
  ) => {
    const identity: AttachmentCacheIdentity = {
      accountId: context.accountId,
      threadId: context.threadId,
      messageId: context.messageId,
      resourceId: attachment.resourceId,
      sizeBytes: attachment.sizeBytes,
    };
    if (options.cacheMode !== 'bypass') {
      const cached = loadSessionAttachment(identity) ?? await store.loadAttachment(identity).catch(() => null);
      if (cached) return cached;
    }
    if (!coordinatorNetworkReady) {
      throw new AttachmentExportError(
        'offline',
        'Attachment download is unavailable until the mailbox connection is ready.',
      );
    }

    const client = coordinatorRef.current ?? createCoordinatorClient();
    coordinatorRef.current = client;
    const downloaded = await client.downloadAttachment(context, attachment);
    if (options.cacheMode === 'read-only' || options.cacheMode === 'read-write') {
      saveSessionAttachment(identity, downloaded);
      await store.saveAttachment(identity, downloaded).catch(() => undefined);
    }
    return downloaded;
  }, [coordinatorNetworkReady, store]);

  const saveMessageAttachment = useCallback<ContextualAttachmentSaver>(async (
    context: AttachmentMessageContext,
    attachment: EmailAttachment,
    onPhase: (phase: AttachmentExportPhase) => void,
  ) => exportAttachment({
    attachment,
    files: attachmentFiles,
    idempotencyKey: `tap-email:attachment-export:${idFactory()}`,
    onPhase,
    loadAttachment: () => loadMessageAttachment(
      context,
      attachment,
      { cacheMode: 'read-write' },
    ),
  }), [attachmentFiles, idFactory, loadMessageAttachment]);

  const stageDraftAttachments = useCallback(async (
    accountId: string,
    draftKey: string,
    existingAttachments: readonly MailDraftAttachment[],
  ): Promise<SelectAndStageAttachmentsResult> => {
    if (preview || !coordinatorNetworkReady) {
      return {
        attachments: [],
        cancelled: false,
        failures: ['Attachments are unavailable until the mailbox connection is ready.'],
      };
    }
    const client = coordinatorRef.current ?? createCoordinatorClient();
    coordinatorRef.current = client;
    return selectAndStageAttachments({
      accountId,
      draftKey,
      existingAttachments,
      files: attachmentFiles,
      idFactory,
      stageAttachment: input => client.stageAttachment(input),
    });
  }, [attachmentFiles, coordinatorNetworkReady, idFactory, preview]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    let active = true;
    let cachedMailAvailable = false;
    let pendingMailboxRequest: DelayedPendingRequest<void> | null = null;
    setCoordinatorNetworkReady(false);
    setInitialMailboxRequestPending(false);
    void (async () => {
      try {
        if (preview) {
          const [mail, preferences] = await Promise.all([
            store.load(),
            loadPreferences(true).catch(() => defaultPreferences),
          ]);
          if (!active) return;
          commandPersistenceBarrier.current.seedFromCache(
            mail ?? { commands: [] },
            store.capability,
          );
          setState(current => ({
            ...(mail ?? current),
            preferences: normalizeMailPreferences(mail?.preferences ?? preferences),
          }));
          setHydrated(true);
          requestAnimationFrame(() => rootRef.current?.focus());
        } else {
          await waitForHostAuthority(surfaceContext);
          const cacheRequest = store.load().then(
            mail => ({ mail, error: null }),
            error => ({ mail: null, error }),
          );
          const [cached, preferences, savedProgress] = await Promise.all([
            cacheRequest,
            loadPreferences(false).catch(() => defaultPreferences),
            store.loadMailboxPageProgress().catch(() => null),
          ]);
          if (!active) return;
          cachedMailAvailable = cached.mail !== null;
          commandPersistenceBarrier.current.seedFromCache(
            cached.mail ?? { commands: [] },
            store.capability,
          );
          setState(current => ({
            ...(cached.mail ?? current),
            preferences: normalizeMailPreferences(
              cached.mail?.preferences ?? preferences,
            ),
          }));
          setHydrated(true);
          requestAnimationFrame(() => rootRef.current?.focus());
          const client = createCoordinatorClient();
          coordinatorRef.current = client;
          const startCursor = cached.mail ? savedProgress?.nextCursor ?? null : null;
          let firstPageSettled = false;
          let resolveFirstPage!: () => void;
          let rejectFirstPage!: (error: unknown) => void;
          const firstPage = new Promise<void>((resolve, reject) => {
            resolveFirstPage = resolve;
            rejectFirstPage = reject;
          });
          pendingMailboxRequest = watchForDelayedPendingRequest(
            firstPage,
            pending => {
              if (active) setInitialMailboxRequestPending(pending);
            },
          );
          initialMailboxLoadInFlight.current = true;
          const remoteRequest = client.getMailbox({
            startCursor,
            onPage: progress => {
              if (!active) return;
              setCoordinatorNetworkReady(true);
              mailboxPageProgressPending.current = progress.nextCursor
                ? {
                    nextCursor: progress.nextCursor,
                    pagesLoaded: (savedProgress?.pagesLoaded ?? 0) + progress.pageCount,
                    threadsLoaded: (savedProgress?.threadsLoaded ?? 0) + progress.loadedThreadCount,
                    updatedAt: new Date().toISOString(),
                  }
                : null;
              setState(current => ({
                ...mergeMailboxPage(current, progress.mailbox),
                preferences: current.preferences,
              }));
              setMailboxError('');
              if (!firstPageSettled) {
                firstPageSettled = true;
                resolveFirstPage();
              }
            },
          });
          void remoteRequest.then(
            mailbox => {
              initialMailboxLoadInFlight.current = false;
              if (!active) return;
              if (startCursor === null) {
                setState(current => ({
                  ...mergeMailboxSnapshot(current, mailbox),
                  preferences: current.preferences,
                }));
              }
              mailboxPageProgressPending.current = null;
              setMailboxError('');
            },
            error => {
              initialMailboxLoadInFlight.current = false;
              if (!firstPageSettled) {
                firstPageSettled = true;
                rejectFirstPage(error);
              } else if (active) {
                setMailboxError(
                  `Loaded recent mail; older cloud history will resume from the device checkpoint: ${String(error)}`,
                );
              }
            },
          );
          await pendingMailboxRequest.result;
          if (!active) return;
          setCacheError(
            cached.error
              ? `Mail is live, but the device cache could not open: ${String(cached.error)}`
              : '',
          );
        }
      } catch (error) {
        if (!active) return;
        setMailboxError(
          cachedMailAvailable
            ? `Using the device cache because cloud refresh failed: ${String(error)}`
            : `TAP Email could not open the cloud mailbox: ${String(error)}`,
        );
      } finally {
        if (active) {
          setHydrated(true);
          setInitialLoadSettled(true);
          requestAnimationFrame(() => rootRef.current?.focus());
        }
      }
    })();
    return () => {
      active = false;
      pendingMailboxRequest?.cancel();
    };
  }, [preview, store, surfaceContext]);

  useEffect(() => {
    if (
      !hydrated ||
      (store.capability !== 'preview-fixture' &&
        store.capability !== 'private-profile-sqlite')
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      void store.save(state).then(
        async () => {
          const released = commandPersistenceBarrier.current
            .releaseAfterSuccessfulSave(state, store.capability);
          const progress = mailboxPageProgressPending.current;
          if (progress === null) {
            await store.clearMailboxPageProgress();
            mailboxPageProgressPending.current = undefined;
          } else if (progress !== undefined) {
            await store.saveMailboxPageProgress(progress);
            if (mailboxPageProgressPending.current === progress) {
              mailboxPageProgressPending.current = undefined;
            }
          }
          setCacheError('');
          if (released) setDispatchTick(value => value + 1);
        },
        error => {
          if (store.capability === 'private-profile-sqlite') {
            const rejectedArchiveIds = state.commands
              .filter(command =>
                command.kind === 'archive' &&
                !commandPersistenceBarrier.current.readiness(
                  command,
                  store.capability,
                ).ready
              )
              .map(command => command.commandId);
            if (rejectedArchiveIds.length > 0) {
              setState(current => rejectedArchiveIds.reduce(
                (next, commandId) => rollbackUnpersistedMailCommand(next, commandId),
                current,
              ));
              flash('Done was not applied because the device command could not be saved.');
            }
            setCacheError(
              `Mail is live, but the device cache could not save. Unsaved Done actions were restored; other email actions remain queued and have not been submitted: ${String(error)}`,
            );
          }
        },
      );
    }, 250);
    return () => window.clearTimeout(timer);
  }, [hydrated, state, store]);

  useEffect(() => {
    activitySettlementActive.current = true;
    return () => {
      activitySettlementActive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!hydrated || preview) return;
    void enqueueActivityProjection(() => activityLedger.snapshot()).catch(
      () => undefined,
    );
  }, [activityLedger, enqueueActivityProjection, hydrated, preview]);

  useEffect(
    () => () => {
      if (hydrationRetryTimer.current !== null) {
        window.clearTimeout(hydrationRetryTimer.current);
      }
      void store.close().catch(() => undefined);
      const pendingActivity = activityCommitQueue.current;
      void pendingActivity
        .catch(() => undefined)
        .then(() => activityLedger.close())
        .catch(() => undefined);
      const semanticIndex = semanticIndexRef.current;
      semanticIndexRef.current = null;
      if (semanticIndex) {
        void semanticIndex.then(index => index.close()).catch(() => undefined);
      }
    },
    [activityLedger, store],
  );

  useEffect(() => {
    if (!hydrated) return;
    const applyLocation = () => {
      const location = parseMailViewHash(globalThis.location?.hash ?? '');
      if (location) setState(current => applyMailViewLocation(current, location));
    };
    applyLocation();
    if (initialLoadSettled) setLocationReady(true);
    globalThis.addEventListener('hashchange', applyLocation);
    return () => globalThis.removeEventListener('hashchange', applyLocation);
  }, [hydrated, initialLoadSettled]);

  useEffect(() => {
    if (!hydrated || preview || !sdk.navigation.subscribeDeepLinks) return;
    return sdk.navigation.subscribeDeepLinks(request => {
      const link = parseConversationHandoffDeepLink(request.target);
      if (!link) return;
      setOverlay('none');
      setState(current => {
        const target = current.threads.find(item =>
          item.accountId === link.accountId && item.threadId === link.threadId);
        if (!target) return current;
        const selected = selectSplit(
          selectAccount(current, link.accountId),
          preferredMailboxSplit(target),
        );
        return {
          ...selected,
          selectedThreadKey: emailThreadKey(target),
        };
      });
    });
  }, [hydrated, preview]);

  const runSemanticSearch = useCallback(async () => {
    const searchQuery = query.trim();
    if (!searchQuery || semanticSearchBusy) return;
    setSemanticSearchBusy(true);
    try {
      const searchContext = { now: new Date(), timeZone: mailSearchTimeZone };
      const parsedSearch = parseMailSearchQuery(searchQuery, searchContext);
      const current = stateRef.current;
      const candidates = accountScopedThreads(current);
      if (!parsedSearch.textQuery) {
        const threadKeys = filterMailThreads(
          candidates,
          searchQuery,
          searchContext,
        ).map(emailThreadKey);
        setSemanticSearch({ query: searchQuery, threadKeys });
        setToast(threadKeys.length === 1
          ? '1 exact local match.'
          : `${threadKeys.length} exact local matches.`);
        return;
      }
      const profileStorage = sdk.storage.profile;
      const embeddings = sdk.embeddings;
      if (!profileStorage || !embeddings) {
        throw new Error('Local semantic search is unavailable on this TAP host.');
      }
      let pendingIndex = semanticIndexRef.current;
      if (!pendingIndex) {
        pendingIndex = openEmailSemanticIndex(profileStorage, embeddings);
        semanticIndexRef.current = pendingIndex;
      }
      let index: EmailSemanticIndex;
      try {
        index = await pendingIndex;
      } catch (error) {
        if (semanticIndexRef.current === pendingIndex) semanticIndexRef.current = null;
        throw error;
      }
      await index.indexThreads(current.threads);
      const matches = await index.search(parsedSearch.textQuery || searchQuery, {
        topK: 100,
        ...(current.selectedAccountId === 'all'
          ? {}
          : { accountId: current.selectedAccountId }),
      });
      const candidatesByKey = new Map(
        candidates.map(item => [emailThreadKey(item), item] as const),
      );
      const semanticThreadKeys = matches
        .map(match => match.threadKey)
        .filter(threadKey => {
          const item = candidatesByKey.get(threadKey);
          return item && threadMatchesMailSearchConstraints(
            item,
            parsedSearch,
            searchContext.timeZone,
          );
        });
      const deterministicThreadKeys = filterMailThreads(
        candidates,
        searchQuery,
        searchContext,
      ).map(emailThreadKey);
      const threadKeys = fuseMailSearchRanks(
        deterministicThreadKeys,
        semanticThreadKeys,
      );
      setSemanticSearch({ query: searchQuery, threadKeys });
      setToast(threadKeys.length === 1
        ? '1 meaning match from the local index.'
        : `${threadKeys.length} meaning matches from the local index.`);
    } catch {
      setSemanticSearch(null);
      setToast('Meaning search needs an installed local embedding model and private vector storage.');
    } finally {
      setSemanticSearchBusy(false);
    }
  }, [query, semanticSearchBusy]);
  const rows = useMemo(() => {
    const candidates = query.trim()
      ? accountScopedThreads(state)
      : visibleThreads(state);
    const searchContext = { now: new Date(), timeZone: mailSearchTimeZone };
    const parsedSearch = parseMailSearchQuery(query, searchContext);
    if (semanticSearch && semanticSearch.query === query.trim()) {
      const candidatesByKey = new Map(
        candidates.map(item => [emailThreadKey(item), item] as const),
      );
      return semanticSearch.threadKeys.flatMap(threadKey => {
        const item = candidatesByKey.get(threadKey);
        return item && threadMatchesMailSearchConstraints(
          item,
          parsedSearch,
          searchContext.timeZone,
        ) ? [item] : [];
      });
    }
    return filterMailThreads(candidates, query, searchContext);
  }, [query, semanticSearch, state]);

  useEffect(() => {
    if (!query.trim() || rows.length === 0) return;
    setState(current =>
      rows.some(item => emailThreadKey(item) === current.selectedThreadKey)
        ? current
        : {
            ...current,
            selectedThreadKey: emailThreadKey(rows[0]!),
            selectedSplit: preferredMailboxSplit(rows[0]!),
          },
    );
  }, [query, rows]);
  const thread = query.trim()
    ? rows.find(item => emailThreadKey(item) === state.selectedThreadKey) ?? rows[0] ?? null
    : selectedThread(state);
  const currentThreadKey = thread ? emailThreadKey(thread) : null;
  const activeReplyDraft = currentThreadKey ? replyDrafts[currentThreadKey] ?? null : null;
  const poppedReplyDraft = poppedReplyKey ? replyDrafts[poppedReplyKey] ?? null : null;
  const selectedThreadAccountId = thread?.accountId ?? null;
  const selectedThreadId = thread?.threadId ?? null;
  const activeConversationHandoff = thread &&
    conversationHandoff?.threadKey === emailThreadKey(thread)
    ? conversationHandoff
    : null;
  const conversationHandoffBusy = activeConversationHandoff?.status === 'checking' ||
    activeConversationHandoff?.status === 'creating' ||
    activeConversationHandoff?.status === 'sending';
  const conversationHandoffFinished = activeConversationHandoff?.status === 'created' ||
    activeConversationHandoff?.status === 'partial';
  const activeEmailTask = thread && emailTask?.threadKey === emailThreadKey(thread)
    ? emailTask
    : null;
  const emailTaskBusy = activeEmailTask?.status === 'creating';
  const emailTaskFinished = activeEmailTask?.status === 'completed' ||
    activeEmailTask?.status === 'duplicate-suppressed';
  const summary = useMemo(
    () => mailboxSummary(state, new Date().toISOString()),
    [state],
  );
  const outboxItems = useMemo(() => recoverableImmediateSends(state)
    .filter(item => {
      const accountId = item.attempts[0]?.command.accountId;
      return accountId && (
        state.selectedAccountId === 'all' || accountId === state.selectedAccountId
      );
    })
    .slice()
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)), [
      state,
    ]);
  const searchCoverage = useMemo(() => {
    if (!query.trim()) return null;
    const selectedCoverage = state.accounts
      .filter(account =>
        state.selectedAccountId === 'all' || account.accountId === state.selectedAccountId)
      .map(account => account.coverage);
    return createMailSearchCoverageReceipt(selectedCoverage, {
      parsedQuery: parseMailSearchQuery(query, {
        now: new Date(),
        timeZone: mailSearchTimeZone,
      }),
      timeZone: mailSearchTimeZone,
    });
  }, [query, state.accounts, state.selectedAccountId]);
  const activeMailView = mailViewDefinition(state.selectedSplit);
  const listReferenceNow = new Date();
  const rowGroups = groupThreadsByDay(rows, listReferenceNow);

  useEffect(() => {
    const row = selectedRowRef.current;
    if (row && typeof row.scrollIntoView === 'function') {
      row.scrollIntoView({ block: 'nearest' });
    }
  }, [query, state.selectedThreadKey]);

  useEffect(() => {
    if (!locationReady || !globalThis.location?.href) return;
    const locationThread = selectedThreadAccountId && selectedThreadId
      ? { accountId: selectedThreadAccountId, threadId: selectedThreadId }
      : null;
    globalThis.history.replaceState(
      null,
      '',
      withMailViewHash(
        globalThis.location.href,
        mailViewLocation(state.selectedAccountId, state.selectedSplit, locationThread),
      ),
    );
  }, [
    locationReady,
    selectedThreadAccountId,
    selectedThreadId,
    state.selectedAccountId,
    state.selectedSplit,
  ]);

  useEffect(() => {
    if (!hydrated || preview) return;
    const activeContext = {
      accountId: thread?.accountId ?? null,
      threadId: thread?.threadId ?? null,
      route: thread ? `/${thread.accountId}/${state.selectedSplit}/${thread.threadId}` : `/${state.selectedSplit}`,
      view: state.selectedAccountId === 'all' ? 'unified' as const : 'account' as const,
    };
    void publishOperationalProjection({
      schemaVersion: 1,
      summary,
      activeContext,
    }).catch(() => undefined);
    void Promise.resolve(
      surfaceContext?.events.publish('tap-email.context.changed', activeContext),
    ).catch(() => undefined);
    if (sdk.home) {
      const critical = projectedThreads(state).filter(
        item => item.status === 'inbox' && item.critical,
      );
      void Promise.resolve(
        sdk.home.publishAttention({
          sourceId: 'tap-email-operational',
          sourceRevision: summary.generatedAt,
          items: critical.slice(0, 10).map(item => ({
            id: `critical:${item.accountId}:${item.threadId}`,
            kind: 'reassessment' as const,
            title: 'Critical email needs attention',
            summary: 'Open TAP Email to review it in account context.',
            deepLink: mailViewDeepLink(item.accountId, 'critical', item.threadId),
          })),
        }),
      ).catch(() => undefined);
    }
  }, [hydrated, preview, state, summary, surfaceContext, thread]);

  const flash = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(current => current === message ? '' : current), 2400);
  }, []);

  const correctSelectedThreadAttention = useCallback((
    correction: ThreadAttentionCorrectionInput,
  ) => {
    if (!selectedThreadAccountId || !selectedThreadId) return;
    setState(current => correctThreadAttention(
      current,
      selectedThreadAccountId,
      selectedThreadId,
      correction,
      new Date().toISOString(),
    ));
    flash('Triage correction saved in TAP Email.');
  }, [flash, selectedThreadAccountId, selectedThreadId]);

  overlayRef.current = overlay;

  useEffect(() => {
    if (!surfaceContext || preview) return;
    let artifacts;
    try {
      artifacts = sdk.artifacts;
    } catch {
      artifacts = undefined;
    }
    return subscribeToArtifactEmailLaunches({
      context: surfaceContext,
      artifacts,
      onDraft: draft => {
        if (overlayRef.current === 'compose') {
          flash('Finish or close the current draft, then choose Email this again.');
          return;
        }
        setComposeSeed({
          requestId: draft.requestId,
          subject: draft.subject,
          bodyText: draft.bodyText,
        });
        setComposeDraftKey(`draft_${idFactory()}`);
        setOverlay('compose');
        flash('TAP context added to a reviewable email draft.');
      },
      onError: () => {
        flash('TAP Email could not resolve that item. Open it and try Email this again.');
      },
    });
  }, [flash, idFactory, preview, surfaceContext]);

  const notify = useCallback((message: string) => {
    if (preview || !sdk.notifications) return;
    void Promise.resolve(sdk.notifications.show({ message })).catch(() => undefined);
  }, [preview]);

  useEffect(() => {
    if (!hydrated || !initialLoadSettled || preview) return;
    const candidates: Array<{
      readonly accountId: string;
      readonly key: string;
      readonly message: string;
    }> = [];
    const currentTime = Date.now();
    for (const item of projectedThreads(state)) {
      if (item.status === 'inbox' && item.critical && item.unread) {
        candidates.push({
          accountId: item.accountId,
          key: `critical:${emailThreadKey(item)}:${item.messages.at(-1)?.messageId ?? item.providerRevision}`,
          message: 'Critical email needs attention.',
        });
      }
      if (
        item.status === 'reminded' &&
        item.reminder &&
        Date.parse(item.reminder.dueAt) <= currentTime
      ) {
        candidates.push({
          accountId: item.accountId,
          key: `reminder:${item.reminder.reminderId}:${item.reminder.dueAt}`,
          message: 'An email reminder is due.',
        });
      }
    }
    if (!notificationsPrimed.current) {
      for (const candidate of candidates) observedNotifications.current.add(candidate.key);
      notificationsPrimed.current = true;
      return;
    }
    for (const candidate of candidates) {
      if (observedNotifications.current.has(candidate.key)) continue;
      observedNotifications.current.add(candidate.key);
      if (notificationsEnabledForAccount(state.preferences, candidate.accountId)) {
        notify(candidate.message);
      }
    }
  }, [
    hydrated,
    initialLoadSettled,
    notify,
    preview,
    state.pendingThreadIntents,
    state.preferences,
    state.threads,
  ]);

  const refreshMailbox = useCallback((): Promise<void> => {
    const existingRefresh = refreshMailboxInFlight.current;
    if (existingRefresh) return existingRefresh;

    const refresh = (async () => {
      await waitForHostAuthority(surfaceContext);
      const client = coordinatorRef.current ?? createCoordinatorClient();
      coordinatorRef.current = client;
      const { mailbox } = await client.getMailboxPage();
      setCoordinatorNetworkReady(true);
      setState(current => mergeMailboxPage(current, mailbox));
      setMailboxError('');
    })();

    refreshMailboxInFlight.current = refresh;
    void refresh.then(
      () => {
        if (refreshMailboxInFlight.current === refresh) {
          refreshMailboxInFlight.current = null;
        }
      },
      () => {
        if (refreshMailboxInFlight.current === refresh) {
          refreshMailboxInFlight.current = null;
        }
      },
    );
    return refresh;
  }, [surfaceContext]);

  const requestFreshMail = useCallback((): Promise<void> => {
    const existingSync = syncInFlight.current;
    if (existingSync) return existingSync;

    const sync = (async () => {
      const client = coordinatorRef.current;
      if (!client) return;
      setSyncing(true);
      try {
        const queued = await Promise.all(
          stateRef.current.accounts.map(account => client.requestSync(account.accountId)),
        );
        // A throttled request means there is no new queue work to wait for.
        // The lightweight refresh remains useful and is now non-destructive.
        if (queued.some(Boolean)) await wait(1_200);
        if (initialMailboxLoadInFlight.current) return;
        await refreshMailbox();
      } finally {
        setSyncing(false);
      }
    })();

    syncInFlight.current = sync;
    void sync.then(
      () => {
        if (syncInFlight.current === sync) syncInFlight.current = null;
      },
      () => {
        if (syncInFlight.current === sync) syncInFlight.current = null;
      },
    );
    return sync;
  }, [refreshMailbox]);

  const retryDeviceCache = useCallback(async (): Promise<void> => {
    try {
      await store.load();
      await store.save(stateRef.current);
      const released = commandPersistenceBarrier.current.releaseAfterSuccessfulSave(
        stateRef.current,
        store.capability,
      );
      setCacheError('');
      if (released) setDispatchTick(value => value + 1);
      flash('Device cache is ready.');
    } catch (error) {
      setCacheError(`Mail is live, but the device cache is still unavailable: ${String(error)}`);
    }
  }, [flash, store]);

  const createMailMergeDrafts = useCallback(async (
    commands: readonly MailCommand<MailDraftPayload>[],
  ): Promise<readonly MailCommandReceipt[]> => {
    if (preview || !coordinatorNetworkReady) {
      throw new Error('Provider draft creation requires a live, connected mailbox.');
    }
    await waitForHostAuthority(surfaceContext);
    const client = coordinatorRef.current ?? createCoordinatorClient();
    coordinatorRef.current = client;
    return persistProviderVisibleMailMergeDrafts({
      client,
      commands,
      onReceipt: async (command, receipt) => {
        await recordCommittedEmailActivity(command, receipt);
      },
    });
  }, [
    coordinatorNetworkReady,
    preview,
    recordCommittedEmailActivity,
    surfaceContext,
  ]);

  const refreshScheduledSends = useCallback(async (): Promise<void> => {
    if (preview || !coordinatorNetworkReady) {
      setScheduledSends([]);
      return;
    }
    const client = coordinatorRef.current ?? createCoordinatorClient();
    coordinatorRef.current = client;
    setScheduledSends(await client.getScheduledSends());
  }, [coordinatorNetworkReady, preview]);

  useEffect(() => {
    if (state.selectedSplit !== 'scheduled' || state.commands.length > 0) return;
    void refreshScheduledSends().catch(() => {
      flash('Scheduled messages could not be refreshed.');
    });
  }, [flash, refreshScheduledSends, state.commands.length, state.selectedSplit]);

  const prepareGoogleConnection = useCallback(() => {
    if (preview || connectionBusy || googleAuthorizationUrl) return;
    setConnectionBusy(true);
    void (async () => {
      try {
        if (!(await hasEmailAuthority(surfaceContext, EMAIL_NETWORK_ACTION))) {
          flash('TAP did not grant TAP Email network access yet.');
          return;
        }
        if (
          !(await hasEmailAuthority(surfaceContext, EMAIL_OPEN_EXTERNAL_ACTION))
        ) {
          flash('TAP did not grant external navigation for Google sign-in.');
          return;
        }
        const client = coordinatorRef.current ?? createCoordinatorClient();
        coordinatorRef.current = client;
        const authorizationUrl = await client.beginGoogleConnection();
        setGoogleAuthorizationUrl(authorizationUrl);
        flash('Google sign-in is ready · select Add account to continue');
      } catch (error) {
        flash(`Google connection failed: ${String(error)}`);
      } finally {
        setConnectionBusy(false);
      }
    })();
  }, [connectionBusy, flash, googleAuthorizationUrl, preview, surfaceContext]);

  const continueGoogleConnection = useCallback(() => {
    if (preview || connectionBusy || !googleAuthorizationUrl) return;

    let launch;
    try {
      // The helper invokes TAP navigation before this trusted click handler yields.
      launch = launchGoogleAuthorization(
        googleAuthorizationUrl,
        sdk.navigation.openExternal,
        (url, target, features) => window.open(url, target, features),
      );
      if (!launch) {
        flash('Allow the Google connection window and try again');
        return;
      }
    } catch (error) {
      flash(`Google connection failed: ${String(error)}`);
      return;
    }

    setConnectionBusy(true);
    void (async () => {
      try {
        await launch.completion;
        flash(
          launch.openedExternally
            ? 'Finish connecting Google in the browser window'
            : 'Finish connecting Google in the new window',
        );
        const client = coordinatorRef.current ?? createCoordinatorClient();
        coordinatorRef.current = client;
        const existing = new Set(stateRef.current.accounts.map(account => account.accountId));
        for (let attempt = 0; attempt < 45; attempt += 1) {
          await wait(2_000);
          const mailbox = (await client.getMailboxPage()).mailbox;
          if (mailbox.accounts.some(account => !existing.has(account.accountId))) {
            setGoogleAuthorizationUrl(null);
            setState(current => mergeMailboxSnapshot(current, mailbox));
            flash('Google connected · newest mail is arriving');
            return;
          }
        }
        flash('Google is still connecting; refresh TAP Email in a moment');
      } catch (error) {
        launch.popup?.close();
        flash(`Google connection failed: ${String(error)}`);
      } finally {
        setConnectionBusy(false);
      }
    })();
  }, [connectionBusy, flash, googleAuthorizationUrl, preview]);

  useEffect(() => {
    if (
      !hydrated ||
      !initialLoadSettled ||
      !coordinatorNetworkReady ||
      preview ||
      state.accounts.length === 0
    ) return;
    void requestFreshMail().catch(error =>
      setMailboxError(`Mailbox synchronization failed: ${String(error)}`),
    );
    const interval = window.setInterval(() => {
      void requestFreshMail().catch(() => undefined);
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [coordinatorNetworkReady, hydrated, initialLoadSettled, preview, requestFreshMail, state.accounts.length]);

  useEffect(() => {
    if (preview || !initialLoadSettled || !coordinatorNetworkReady || !thread) return;
    const key = emailThreadKey(thread);
    const requestedRevision = thread.providerRevision;
    if (loadedThreadRevisions.current.get(key) === requestedRevision) return;
    if (threadHydrationInFlight.current.get(key) === requestedRevision) return;
    const client = coordinatorRef.current;
    if (!client) return;
    threadHydrationInFlight.current.set(key, requestedRevision);
    void client.getThread(thread.accountId, thread.threadId)
      .then(messages => {
        if (threadHydrationInFlight.current.get(key) !== requestedRevision) return;
        threadHydrationInFlight.current.delete(key);
        threadHydrationFailures.current.delete(key);
        loadedThreadRevisions.current.set(key, requestedRevision);
        setState(current => {
          const currentThread = current.threads.find(item =>
            item.accountId === thread.accountId && item.threadId === thread.threadId
          );
          // Ignore detail returned for a revision that was superseded while
          // this request was in flight. The effect will fetch the new revision.
          return currentThread?.providerRevision === requestedRevision
            ? mergeThreadMessages(current, thread.accountId, thread.threadId, messages)
            : current;
        });
      })
      .catch(() => {
        if (threadHydrationInFlight.current.get(key) !== requestedRevision) return;
        threadHydrationInFlight.current.delete(key);
        if (loadedThreadRevisions.current.get(key) === requestedRevision) {
          loadedThreadRevisions.current.delete(key);
        }
        const previousFailure = threadHydrationFailures.current.get(key);
        const attempts = previousFailure?.revision === requestedRevision
          ? previousFailure.attempts + 1
          : 1;
        threadHydrationFailures.current.set(key, {
          attempts,
          revision: requestedRevision,
        });
        if (attempts <= 2 && hydrationRetryTimer.current === null) {
          hydrationRetryTimer.current = window.setTimeout(() => {
            hydrationRetryTimer.current = null;
            setHydrationRetryTick(value => value + 1);
          }, attempts * 750);
        }
      });
  }, [
    coordinatorNetworkReady,
    hydrationRetryTick,
    initialLoadSettled,
    preview,
    thread,
  ]);

  useEffect(() => {
    if (preview || !hydrated || !initialLoadSettled || !coordinatorNetworkReady) return;
    const currentTime = Date.now();
    let wakeAt: number | null = null;
    for (const command of state.commands) {
      if (submittedCommands.current.has(command.commandId)) continue;
      const persistence = commandPersistenceBarrier.current.readiness(
        command,
        store.capability,
      );
      if (!persistence.ready) continue;
      const undoExpiry = state.undo?.commandId === command.commandId
        ? Date.parse(state.undo.expiresAt)
        : null;
      if (undoExpiry && undoExpiry > currentTime) {
        wakeAt = wakeAt === null ? undoExpiry : Math.min(wakeAt, undoExpiry);
        continue;
      }
      const client = coordinatorRef.current;
      if (!client) continue;
      submittedCommands.current.add(command.commandId);
      const preceding = commandDispatchQueues.current.get(command.accountId) ?? Promise.resolve();
      const queued = preceding.catch(() => undefined).then(async () => {
        try {
          await client.submitCommand(command);
          for (let attempt = 0; attempt < 120; attempt += 1) {
            const receipt = await client.getCommand(command.commandId);
            if (['applied', 'failed', 'uncertain', 'cancelled'].includes(receipt.state)) {
              const activitySettlement = await commitActivityBeforeSettlement({
                commit: () => recordCommittedEmailActivity(command, receipt),
                settle: () => setState(current => settleMailCommand(
                  current,
                  command,
                  receipt,
                  new Date().toISOString(),
                )),
                canSettle: () => activitySettlementActive.current &&
                  stateRef.current.commands.some(item =>
                    item.commandId === command.commandId
                  ),
                waitForRetry: async (_error, failedAttempts) => {
                  if (failedAttempts === 1 || failedAttempts % 10 === 0) {
                    flash('Activity history is catching up; the email action remains safely queued.');
                  }
                  await wait(Math.min(1_000 * 2 ** (failedAttempts - 1), 10_000));
                  return activitySettlementActive.current;
                },
              });
              if (activitySettlement === 'deferred') return;
              if (receipt.state !== 'applied') {
                flash(`Email action needs attention: ${receipt.errorCode ?? receipt.state}`);
                if (
                  (command.kind === 'send_draft' || command.kind === 'schedule_send') &&
                  notificationsEnabledForAccount(stateRef.current.preferences, command.accountId)
                ) {
                  notify('An email send needs attention. Review it before retrying.');
                }
              }
              if (command.kind !== 'save_draft') {
                await client.requestSync(command.accountId).catch(() => false);
                await wait(1_200);
                await refreshMailbox().catch(() => undefined);
              }
              return;
            }
            await wait(500);
          }
          submittedCommands.current.delete(command.commandId);
          setDispatchTick(value => value + 1);
        } catch (error) {
          submittedCommands.current.delete(command.commandId);
          flash(`Email action failed: ${String(error)}`);
          window.setTimeout(() => setDispatchTick(value => value + 1), 2_000);
        }
      });
      commandDispatchQueues.current.set(command.accountId, queued);
      void queued.then(() => {
        if (commandDispatchQueues.current.get(command.accountId) === queued) {
          commandDispatchQueues.current.delete(command.accountId);
        }
      });
    }
    if (wakeAt !== null) {
      const timer = window.setTimeout(
        () => setDispatchTick(value => value + 1),
        Math.max(0, wakeAt - Date.now()) + 10,
      );
      return () => window.clearTimeout(timer);
    }
  }, [coordinatorNetworkReady, dispatchTick, flash, hydrated, initialLoadSettled, notify, preview, recordCommittedEmailActivity, refreshMailbox, state.commands, state.undo, store.capability]);

  const openThread = useCallback((target: EmailThread) => {
    const commandId = `cmd_${idFactory()}`;
    const now = new Date().toISOString();
    setState(current => {
      const selected = {
        ...current,
        selectedThreadKey: emailThreadKey(target),
        ...(query.trim() ? { selectedSplit: preferredMailboxSplit(target) } : {}),
      };
      return markThreadRead(
        selected,
        target.accountId,
        target.threadId,
        commandId,
        now,
      );
    });
  }, [idFactory, query]);

  const askChloe = useCallback((intent: ChloeEmailIntent) => {
    if (!thread) return;
    if (preview) {
      flash('Chloe prompts open in the TAP chat panel outside preview.');
      return;
    }
    try {
      const stagedPrompt = stageChloeEmailPrompt(sdk.chat, thread, intent);
      void Promise.resolve(stagedPrompt).then(
        () => flash('Editable Chloe prompt ready in Chat.'),
        () => flash('Chloe could not open. Check Chat composer access and try again.'),
      );
    } catch {
      flash('Chloe could not open. Check Chat composer access and try again.');
    }
  }, [flash, preview, thread]);

  const beginReply = useCallback((target: EmailThread) => {
    const threadKey = emailThreadKey(target);
    const draftKey = `draft_${idFactory()}`;
    const recipient = target.participants[0];
    const recipientLabel = recipient?.name || recipient?.address || 'recipient';
    const to = recipient?.address ?? '';
    const subject = /^re:/iu.test(target.subject.trim())
      ? target.subject
      : `Re: ${target.subject}`;
    setReplyDrafts(current => {
      const previousPopped = poppedReplyKey && poppedReplyKey !== threadKey
        ? current[poppedReplyKey]
        : null;
      const withPreviousPoppedInline = previousPopped
        ? {
            ...current,
            [poppedReplyKey!]: { ...previousPopped, placement: 'inline' as const },
          }
        : current;
      const existing = withPreviousPoppedInline[threadKey];
      return {
        ...withPreviousPoppedInline,
        [threadKey]: existing
          ? { ...existing, focusRequestId: existing.focusRequestId + 1 }
          : {
              accountId: target.accountId,
              attachmentBusy: false,
              attachmentError: '',
              attachments: [],
              bcc: '',
              bodyText: '',
              cc: '',
              draftKey,
              draftRevision: 1,
              focusRequestId: 1,
              inReplyToMessageId: target.messages.at(-1)?.internetMessageId ?? null,
              placement: 'inline',
              recipientLabel,
              subject,
              threadId: target.threadId,
              threadKey,
              to,
            },
      };
    });
    if (poppedReplyKey && poppedReplyKey !== threadKey) {
      setPoppedReplyKey(null);
      setThreadListCollapsed(threadListCollapsedBeforeSidecarRef.current);
    }
    setOverlay('none');
  }, [idFactory, poppedReplyKey]);

  const createTaskFromEmail = useCallback(() => {
    if (!thread) return;
    const target = thread;
    const threadKey = emailThreadKey(target);
    const workspaceId = surfaceContext?.workspaceId;
    if (preview || !workspaceId) {
      const message = 'Creating a TAP Task requires a mounted workspace.';
      setEmailTask({ threadKey, status: 'error', message });
      flash(message);
      return;
    }
    if (emailTasksInFlight.current.has(threadKey)) return;
    emailTasksInFlight.current.add(threadKey);
    setEmailTask({
      threadKey,
      status: 'creating',
      message: 'Creating the canonical TAP Task…',
    });
    void (async () => {
      if (!(await hasEmailAuthority(surfaceContext, EMAIL_TASK_WRITE_ACTION))) {
        throw new Error('task-write-denied');
      }
      const outcome = await createEmailTask({
        platform: sdk,
        workspaceId,
        destination: {
          ...(surfaceContext?.channelId
            ? { channelIds: [surfaceContext.channelId] }
            : {}),
          ...(surfaceContext?.userId
            ? { assigneeUserIds: [surfaceContext.userId] }
            : {}),
        },
        source: {
          accountId: target.accountId,
          threadId: target.threadId,
          subject: target.subject,
          sender: displayParticipant(target),
          receivedAt: target.receivedAt,
          backlink: mailViewDeepLink(
            target.accountId,
            preferredMailboxSplit(target),
            target.threadId,
          ),
          critical: target.critical,
          needsResponse: target.needsResponse,
          reminderDueAt: target.reminder?.dueAt ?? null,
        },
      });
      const message = outcome.status === 'completed'
        ? 'Task created with the email source attached.'
        : outcome.status === 'duplicate-suppressed'
          ? 'This email already has its canonical TAP Task.'
          : outcome.status === 'pending'
            ? 'Task creation is pending in TAP. Its receipt was saved.'
            : 'TAP rejected task creation. Its failed receipt was saved.';
      setEmailTask({ threadKey, status: outcome.status, message });
      flash(message);
    })().catch(error => {
      const partial = error instanceof EmailTaskConfigurationError;
      const receiptCacheFailed = error instanceof EmailTaskReceiptPersistenceError;
      const message = partial
        ? 'Task created, but its due date or priority could not be applied. Retry to reconcile it.'
        : receiptCacheFailed && error.task
          ? 'Task created, but its local receipt state could not be saved. Replay remains protected by TAP.'
          : receiptCacheFailed && error.receipt.status === 'pending'
            ? 'Task creation is pending, but its local receipt state could not be saved.'
        : error instanceof Error && error.message === 'task-write-denied'
          ? 'TAP Email is not allowed to create Tasks in this workspace.'
          : 'TAP Email could not create the Task. Try again.';
      setEmailTask({
        threadKey,
        status: partial || receiptCacheFailed ? 'partial' : 'error',
        message,
      });
      flash(message);
    }).finally(() => {
      emailTasksInFlight.current.delete(threadKey);
    });
  }, [flash, preview, surfaceContext, thread]);

  const runCommand = useCallback((command: EmailKeyCommand) => {
    const now = new Date().toISOString();
    if (command === 'next') {
      const commandId = `cmd_${idFactory()}`;
      setState(current => {
        const moved = query.trim()
          ? moveWithinThreads(current, rows, 1)
          : moveSelection(current, 1);
        const opened = query.trim()
          ? rows.find(item => emailThreadKey(item) === moved.selectedThreadKey) ?? null
          : selectedThread(moved);
        const selected = opened && query.trim()
          ? { ...moved, selectedSplit: preferredMailboxSplit(opened) }
          : moved;
        return opened
          ? markThreadRead(
              selected,
              opened.accountId,
              opened.threadId,
              commandId,
              now,
            )
          : moved;
      });
    }
    if (command === 'previous') {
      const commandId = `cmd_${idFactory()}`;
      setState(current => {
        const moved = query.trim()
          ? moveWithinThreads(current, rows, -1)
          : moveSelection(current, -1);
        const opened = query.trim()
          ? rows.find(item => emailThreadKey(item) === moved.selectedThreadKey) ?? null
          : selectedThread(moved);
        const selected = opened && query.trim()
          ? { ...moved, selectedSplit: preferredMailboxSplit(opened) }
          : moved;
        return opened
          ? markThreadRead(
              selected,
              opened.accountId,
              opened.threadId,
              commandId,
              now,
            )
          : moved;
      });
    }
    if (command === 'done') {
      if (
        !preview &&
        store.capability === 'private-profile-sqlite' &&
        cacheError
      ) {
        flash('Done was not applied. Restore device-cache permission, then retry.');
        return;
      }
      if (!thread || !threadMatchesSplit(thread, 'inbox')) {
        flash('This conversation is already outside Inbox.');
        return;
      }
      setState(current => markDone(current, `cmd_${idFactory()}`, now));
      flash('Marked done · Z to undo');
    }
    if (command === 'undo') {
      setState(current => undoLastAction(current, now));
      flash('Last action undone');
    }
    if (command === 'toggle-star') setState(current => toggleStar(current, `cmd_${idFactory()}`, now));
    if (command === 'toggle-read' && thread) {
      setState(current => toggleThreadRead(current, `cmd_${idFactory()}`, now));
      flash(thread?.unread ? 'Marked read' : 'Marked unread');
    }
    if (command === 'trash' && thread) {
      setState(current => trashThread(current, `cmd_${idFactory()}`, now));
      flash('Moved to trash · Z to undo');
    }
    if (
      (command === 'toggle-message-expansion' || command === 'expand-all-messages') &&
      thread
    ) {
      setMessageExpansionRequest({
        accountId: thread.accountId,
        threadId: thread.threadId,
        action: command === 'expand-all-messages' ? 'expand-all' : 'toggle-active',
        requestId: idFactory(),
      });
    }
    if (command === 'remind' && thread) setOverlay('remind');
    if (command === 'compose') {
      setComposeSeed(null);
      setComposeDraftKey(`draft_${idFactory()}`);
      setOverlay('compose');
    }
    if (command === 'reply' && thread) beginReply(thread);
    if (command === 'prompt-reply' && thread) askChloe('draft-reply');
    if (command === 'search') {
      setThreadListCollapsed(false);
      window.setTimeout(() => searchRef.current?.focus(), 0);
    }
    if (command === 'palette') setOverlay('palette');
    if (command === 'show-shortcuts') setOverlay('shortcuts');
    if (command === 'unified-account') setState(current => selectAccount(current, 'all'));
    const accountIndex = accountIndexForCommand(command);
    if (accountIndex !== null) {
      setState(current => {
        const account = current.accounts[accountIndex];
        return account ? selectAccount(current, account.accountId) : current;
      });
    }
    const splitCommands: Partial<Record<EmailKeyCommand, MailSplit>> = {
      'inbox-split': 'inbox',
      'starred-split': 'starred',
      'drafts-split': 'drafts',
      'sent-split': 'sent',
      'done-split': 'done',
      'snippets-split': 'snippets',
      'spam-split': 'spam',
      'trash-split': 'trash',
      'critical-split': 'critical',
      'needs-response-split': 'needs-response',
      'waiting-split': 'waiting',
      'reminders-split': 'reminders',
    };
    const split = splitCommands[command];
    if (split) setState(current => selectSplit(current, split));
    if (command === 'bring-to-conversation') {
      if (!thread) return;
      const threadKey = emailThreadKey(thread);
      if (preview || !surfaceContext?.workspaceId) {
        setConversationHandoff({
          threadKey,
          status: 'error',
          message: 'Conversation handoff needs a mounted TAP workspace.',
        });
        return;
      }
      setConversationHandoff(null);
      setOverlay('handoff');
      return;
    }
    setOverlay(current => command === 'palette' || command === 'show-shortcuts' || command === 'remind' || command === 'compose' ? current : 'none');
  }, [askChloe, beginReply, cacheError, flash, idFactory, preview, query, rows, store.capability, surfaceContext, thread]);

  const handleKeyDown = (event: globalThis.KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.keyCode === 229 ||
      event.repeat ||
      overlay !== 'none' ||
      isTextEntryTarget(event.target)
    ) return;
    if (
      event.key === 'Enter' &&
      !shouldEnterOpenReply(event, event.target, Boolean(thread)) &&
      !shouldEnterPromptReply(event, event.target, Boolean(thread))
    ) return;
    const result = resolveShortcut(event, chordRef.current);
    if (result.preventDefault) event.preventDefault();
    if (chordTimer.current) clearTimeout(chordTimer.current);
    chordRef.current = result.nextChord;
    setChord(result.nextChord);
    if (result.nextChord) {
      chordTimer.current = setTimeout(() => {
        chordRef.current = null;
        setChord(null);
      }, 1_500);
    }
    if (result.command) runCommand(result.command);
  };
  shortcutHandlerRef.current = handleKeyDown;

  useEffect(() => {
    if (overlay === 'none') return;
    chordRef.current = null;
    setChord(null);
    if (chordTimer.current) {
      clearTimeout(chordTimer.current);
      chordTimer.current = null;
    }
  }, [overlay]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const stopListening = listenForScopedDocumentKeyDown(
      document,
      root,
      event => shortcutHandlerRef.current(event),
    );
    return () => {
      stopListening();
      if (chordTimer.current) clearTimeout(chordTimer.current);
    };
  }, [hydrated]);

  const confirmReminder = (input: string) => {
    const now = new Date();
    const due = resolveReminderInput(input, now);
    if (!due) {
      flash('Choose a future reminder time');
      return;
    }
    setState(current => remindThread(current, `cmd_${idFactory()}`, `reminder_${idFactory()}`, due.toISOString(), 'if_no_reply', now.toISOString()));
    setOverlay('none');
    flash('Reminder set · Z to undo');
  };

  const updatePreferences = (preferences: MailPreferences) => {
    const normalized = normalizeMailPreferences(preferences);
    setState(current => ({ ...current, preferences: normalized }));
    if (!preview) void savePreferences(normalized).catch(error => flash(`Settings were not saved: ${String(error)}`));
  };

  const queueComposeDraftAutosave = useCallback((message: ComposeDraftMessage) => {
    if ((queuedDraftRevisions.current.get(message.draftKey) ?? 0) >= message.draftRevision) return;
    queuedDraftRevisions.current.set(message.draftKey, message.draftRevision);
    setState(current => saveMessageDraft(
      current,
      `cmd_${idFactory()}`,
      message.accountId,
      null,
      {
        draftKey: message.draftKey,
        draftRevision: message.draftRevision,
        to: message.to,
        ...(message.cc ? { cc: message.cc } : {}),
        ...(message.bcc ? { bcc: message.bcc } : {}),
        subject: message.subject,
        bodyText: message.bodyText,
        ...(message.attachments.length ? { attachments: message.attachments } : {}),
      },
      new Date().toISOString(),
    ));
  }, [idFactory]);

  const queueMessage = (message: ComposeDraftMessage) => {
    const now = new Date().toISOString();
    const sendAfter = new Date(Date.parse(now) + 5_000).toISOString();
    setState(current => composeMessage(
      current,
      `cmd_${idFactory()}`,
      message.accountId,
      null,
      message.to,
      message.subject,
      message.bodyText,
      null,
      now,
      {
        draftKey: message.draftKey,
        draftRevision: message.draftRevision,
        ...(message.cc ? { cc: message.cc } : {}),
        ...(message.bcc ? { bcc: message.bcc } : {}),
        ...(message.attachments.length ? { attachments: message.attachments } : {}),
        sendAfter,
      },
    ));
    setComposeDraftKey(null);
    setOverlay('none');
    flash('Message queued · Undo is available for 5 seconds');
  };

  const scheduleComposeMessage = (
    message: ComposeDraftMessage,
    scheduledFor: string,
    cancelIfReply: boolean,
  ) => {
    const now = new Date().toISOString();
    setState(current => scheduleMessageDraft(
      current,
      `cmd_${idFactory()}`,
      message.accountId,
      null,
      {
        draftKey: message.draftKey,
        draftRevision: message.draftRevision,
        to: message.to,
        ...(message.cc ? { cc: message.cc } : {}),
        ...(message.bcc ? { bcc: message.bcc } : {}),
        subject: message.subject,
        bodyText: message.bodyText,
        ...(message.attachments.length ? { attachments: message.attachments } : {}),
        scheduledFor,
        cancelIfReply,
      },
      now,
    ));
    setComposeDraftKey(null);
    setOverlay('none');
    flash('Message scheduled');
  };

  const cancelScheduledSend = (item: ScheduledSendSummary) => {
    setState(current => cancelScheduledMessage(
      current,
      `cmd_${idFactory()}`,
      item.accountId,
      item.threadId,
      item.scheduleCommandId,
      new Date().toISOString(),
    ));
    setScheduledSends(current => current.filter(
      candidate => candidate.scheduleCommandId !== item.scheduleCommandId,
    ));
    flash('Scheduled send cancelled; the provider draft was preserved.');
  };

  const retryOutboxSend = (item: RecoverableImmediateSend) => {
    const originalCommandId = item.attempts[0]?.command.commandId;
    if (!originalCommandId) return;
    setState(current => retryRecoverableImmediateSend(
      current,
      originalCommandId,
      `cmd_${idFactory()}`,
      new Date().toISOString(),
    ));
    flash('Retry queued with the original draft and Message-ID.');
  };

  const reconcileOutboxSend = async (item: RecoverableImmediateSend) => {
    const current = item.attempts[item.attempts.length - 1];
    const client = coordinatorRef.current;
    if (!current || !client) {
      flash('The original send cannot be rechecked while mail is offline.');
      return;
    }
    try {
      const receipt = await client.reconcileCommand(current.command.commandId);
      // The Outbox entry remains durable until the refined provider outcome is
      // reflected in both the private activity ledger and its bounded shared
      // projection. Repeating this managed reconciliation is safe: the
      // coordinator returns the immutable command's stored terminal receipt,
      // and activity recording is idempotent.
      await recordCommittedEmailActivity(current.command, receipt);
      setState(state => settleMailCommand(
        state,
        current.command,
        receipt,
        new Date().toISOString(),
      ));
      if (receipt.state === 'applied') {
        flash('The provider confirms this message was sent.');
      } else if (receipt.state === 'failed') {
        flash('The provider confirms this send failed; it is now safe to retry.');
      } else {
        flash('Delivery is still unknown. Do not resend yet.');
      }
    } catch (error) {
      flash(`Could not recheck the original send: ${String(error)}`);
    }
  };

  const updateReplyDraft = (
    threadKey: string,
    updates: Partial<Pick<
      ReplyDraft,
      | 'attachmentBusy'
      | 'attachmentError'
      | 'attachments'
      | 'bcc'
      | 'bodyText'
      | 'cc'
      | 'focusRequestId'
      | 'placement'
      | 'to'
    >>,
  ) => {
    setReplyDrafts(current => {
      const draft = current[threadKey];
      if (!draft) return current;
      const contentChanged = (
        (updates.bodyText !== undefined && updates.bodyText !== draft.bodyText) ||
        (updates.to !== undefined && updates.to !== draft.to) ||
        (updates.cc !== undefined && updates.cc !== draft.cc) ||
        (updates.bcc !== undefined && updates.bcc !== draft.bcc) ||
        (updates.attachments !== undefined && updates.attachments !== draft.attachments)
      );
      return {
        ...current,
        [threadKey]: {
          ...draft,
          ...updates,
          draftRevision: contentChanged ? draft.draftRevision + 1 : draft.draftRevision,
        },
      };
    });
  };

  const queueReplyDraftAutosave = useCallback((draft: ReplyDraft) => {
    if (preview || !hydrated || !initialLoadSettled || !coordinatorNetworkReady ||
      draft.draftRevision <= 1 ||
      (queuedDraftRevisions.current.get(draft.draftKey) ?? 0) >= draft.draftRevision) {
      return;
    }
    queuedDraftRevisions.current.set(draft.draftKey, draft.draftRevision);
    setState(current => saveMessageDraft(
      current,
      `cmd_${idFactory()}`,
      draft.accountId,
      draft.threadId,
      {
        draftKey: draft.draftKey,
        draftRevision: draft.draftRevision,
        to: draft.to,
        ...(draft.cc ? { cc: draft.cc } : {}),
        ...(draft.bcc ? { bcc: draft.bcc } : {}),
        subject: draft.subject,
        bodyText: draft.bodyText,
        ...(draft.inReplyToMessageId
          ? { replyToMessageId: draft.inReplyToMessageId }
          : {}),
        ...(draft.attachments.length ? { attachments: draft.attachments } : {}),
      },
      new Date().toISOString(),
    ));
  }, [coordinatorNetworkReady, hydrated, idFactory, initialLoadSettled, preview]);

  useEffect(() => {
    if (preview || !hydrated || !initialLoadSettled || !coordinatorNetworkReady) return;
    const draftsToSave = Object.values(replyDrafts).filter(draft =>
      draft.draftRevision > 1 &&
      (queuedDraftRevisions.current.get(draft.draftKey) ?? 0) < draft.draftRevision
    );
    if (draftsToSave.length === 0) return;
    const timer = window.setTimeout(() => {
      for (const draft of draftsToSave) queueReplyDraftAutosave(draft);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [
    queueReplyDraftAutosave,
    replyDrafts,
  ]);

  const removeReplyDraft = (threadKey: string) => {
    setReplyDrafts(current => Object.fromEntries(
      Object.entries(current).filter(([key]) => key !== threadKey),
    ));
    if (poppedReplyKey === threadKey) {
      setPoppedReplyKey(null);
      setThreadListCollapsed(threadListCollapsedBeforeSidecarRef.current);
    }
  };

  const closeReplyDraft = (draft: ReplyDraft) => {
    queueReplyDraftAutosave(draft);
    removeReplyDraft(draft.threadKey);
  };

  const sendReplyDraft = (draft: ReplyDraft) => {
    const now = new Date().toISOString();
    const sendAfter = new Date(Date.parse(now) + 5_000).toISOString();
    setState(current => composeMessage(
      current,
      `cmd_${idFactory()}`,
      draft.accountId,
      draft.threadId,
      draft.to,
      draft.subject,
      draft.bodyText,
      draft.inReplyToMessageId,
      now,
      {
        draftKey: draft.draftKey,
        draftRevision: draft.draftRevision,
        ...(draft.cc ? { cc: draft.cc } : {}),
        ...(draft.bcc ? { bcc: draft.bcc } : {}),
        ...(draft.attachments.length ? { attachments: draft.attachments } : {}),
        sendAfter,
      },
    ));
    removeReplyDraft(draft.threadKey);
    flash('Reply queued · Undo is available for 5 seconds');
  };

  const scheduleReplyDraft = (
    draft: ReplyDraft,
    scheduledFor: string,
    cancelIfReply: boolean,
  ) => {
    const now = new Date().toISOString();
    setState(current => scheduleMessageDraft(
      current,
      `cmd_${idFactory()}`,
      draft.accountId,
      draft.threadId,
      {
        draftKey: draft.draftKey,
        draftRevision: draft.draftRevision,
        to: draft.to,
        ...(draft.cc ? { cc: draft.cc } : {}),
        ...(draft.bcc ? { bcc: draft.bcc } : {}),
        subject: draft.subject,
        bodyText: draft.bodyText,
        ...(draft.inReplyToMessageId ? { replyToMessageId: draft.inReplyToMessageId } : {}),
        ...(draft.attachments.length ? { attachments: draft.attachments } : {}),
        scheduledFor,
        cancelIfReply,
      },
      now,
    ));
    removeReplyDraft(draft.threadKey);
    flash('Reply scheduled');
  };

  const attachToReplyDraft = async (draft: ReplyDraft) => {
    if (draft.attachmentBusy) return;
    updateReplyDraft(draft.threadKey, { attachmentBusy: true, attachmentError: '' });
    const result = await stageDraftAttachments(
      draft.accountId,
      draft.draftKey,
      draft.attachments,
    );
    setReplyDrafts(current => {
      const latest = current[draft.threadKey];
      if (!latest || latest.draftKey !== draft.draftKey) return current;
      const nextAttachments = result.attachments.length
        ? [...latest.attachments, ...result.attachments]
        : latest.attachments;
      return {
        ...current,
        [draft.threadKey]: {
          ...latest,
          attachmentBusy: false,
          attachmentError: result.failures.join(' '),
          attachments: nextAttachments,
          draftRevision: result.attachments.length
            ? latest.draftRevision + 1
            : latest.draftRevision,
        },
      };
    });
  };

  const toggleReplyPlacement = (draft: ReplyDraft) => {
    if (draft.placement === 'inline') {
      const previousPoppedKey = poppedReplyKey;
      if (!previousPoppedKey) {
        threadListCollapsedBeforeSidecarRef.current = threadListCollapsed;
      }
      setReplyDrafts(current => {
        const previousPopped = previousPoppedKey && previousPoppedKey !== draft.threadKey
          ? current[previousPoppedKey]
          : null;
        const next = previousPopped
          ? {
              ...current,
              [previousPoppedKey!]: { ...previousPopped, placement: 'inline' as const },
            }
          : current;
        const currentDraft = next[draft.threadKey];
        return currentDraft
          ? {
              ...next,
              [draft.threadKey]: {
                ...currentDraft,
                focusRequestId: currentDraft.focusRequestId + 1,
                placement: 'sidecar',
              },
            }
          : next;
      });
      setPoppedReplyKey(draft.threadKey);
      setThreadListCollapsed(true);
      return;
    }
    updateReplyDraft(draft.threadKey, {
      focusRequestId: draft.focusRequestId + 1,
      placement: 'inline',
    });
    setPoppedReplyKey(null);
    setThreadListCollapsed(threadListCollapsedBeforeSidecarRef.current);
  };

  const toggleThreadList = useCallback(() => {
    setThreadListCollapsed(collapsed => !collapsed);
  }, []);

  if (!hydrated) {
    return <div className="tap-email-loading">Opening TAP Email…</div>;
  }

  const loadError = mailboxError || cacheError || activityError;
  const showCapabilityBanner =
    preview ||
    Boolean(loadError) ||
    initialMailboxRequestPending ||
    store.capability === 'unavailable';
  const capabilityBannerTitle = mailboxError
    ? state.accounts.length > 0
      ? 'Cached mailbox'
      : 'Mailbox unavailable'
    : cacheError
      ? 'Device cache unavailable'
      : activityError
        ? 'Activity history catching up'
      : initialMailboxRequestPending
        ? 'Connecting to mail service'
        : preview
          ? 'Fixture mailbox'
          : state.accounts.length > 0
            ? 'Cloud mailbox active'
            : 'Google account required';
  const capabilityBannerMessage = loadError || (
    initialMailboxRequestPending
      ? INITIAL_MAILBOX_PENDING_MESSAGE
      : preview
        ? 'Disposable sample data; no Gmail account is connected.'
        : state.accounts.length > 0
          ? 'Mail is live, but this host does not expose private profile storage. Actions can still run, but failed or uncertain sends cannot be recovered after this app closes.'
          : 'Connect Google to start a private, account-scoped mailbox.'
  );
  const capabilityBannerClass = preview
    ? 'is-preview'
    : initialMailboxRequestPending
      ? 'is-pending'
      : loadError
        ? ''
        : 'is-cloud';

  return (
    <TooltipProvider delayDuration={250} skipDelayDuration={75}>
    <div className="tap-email" ref={rootRef} tabIndex={-1}>
      <a className="skip-link" href="#tap-email-main">Skip to Mailbox</a>
      <header className="app-bar">
        <div className="brand"><span className="brand-mark">T</span><span>TAP Email</span></div>
        <AccountSwitcher
          accounts={state.accounts}
          onSelect={accountId => setState(current => selectAccount(current, accountId))}
          selectedAccountId={state.selectedAccountId}
        />
        <div className="app-actions">
          {!preview ? (
            <GoogleConnectButton
              busy={connectionBusy}
              onLaunch={continueGoogleConnection}
              onPrepare={prepareGoogleConnection}
              prepared={googleAuthorizationUrl !== null}
            >
              <Plus aria-hidden="true" className="app-action-icon" />
              <span className="app-action-label">Add account</span>
            </GoogleConnectButton>
          ) : null}
          {!preview && state.accounts.length > 0 ? (
            <MailSyncButton
              onSync={() => {
                void requestFreshMail().catch(error => {
                  const message = `Mailbox synchronization failed: ${String(error)}`;
                  setMailboxError(message);
                  flash(message);
                });
              }}
              syncing={syncing}
            />
          ) : null}
          <button
            aria-label="Open Email Workflows"
            disabled={state.accounts.length === 0}
            onClick={() => setOverlay('workflows')}
            title="Email Workflows"
            type="button"
          >
            <Rows3 aria-hidden="true" className="app-action-icon" />
            <span className="app-action-label">Workflows</span>
          </button>
          <button aria-label="TAP Email settings" onClick={() => setOverlay('settings')} title="Settings" type="button">
            <Settings aria-hidden="true" className="app-action-icon" />
            <span className="app-action-label">Settings</span>
          </button>
          <button aria-label="Keyboard shortcuts" onClick={() => setOverlay('shortcuts')} title="Keyboard shortcuts" type="button">
            <Keyboard aria-hidden="true" className="app-action-icon" />
            <span className="app-action-label">Shortcuts</span>
            <kbd>?</kbd>
          </button>
          <button className="compose-button" type="button" onClick={() => runCommand('compose')} disabled={state.accounts.length === 0}>Compose <kbd>C</kbd></button>
        </div>
      </header>

      {showCapabilityBanner ? (
        <div className={`capability-banner ${capabilityBannerClass}`} role={loadError ? 'alert' : 'status'} aria-live="polite">
          <strong>{capabilityBannerTitle}</strong>
          <span>{capabilityBannerMessage}</span>
          {mailboxError && !preview ? <button type="button" onClick={() => void refreshMailbox().catch(error => setMailboxError(`TAP Email could not open the cloud mailbox: ${String(error)}`))}>Retry</button> : null}
          {cacheError && !preview ? <button type="button" onClick={() => void retryDeviceCache()}>Retry device cache</button> : null}
        </div>
      ) : null}

      <main className={`mail-shell${threadListCollapsed ? ' is-thread-list-collapsed' : ''}`} id="tap-email-main" tabIndex={-1}>
        <aside className="split-sidebar" aria-label="Email views">
          <div className="zero-card">
            <div className="zero-orbit" title="Critical conversations"><span>{summary.critical}</span></div>
            <div>
              <strong>{summary.operationalZero ? 'Inbox clear' : `${summary.critical} critical`}</strong>
              <small>{summary.needsResponse} need a reply · {summary.coverageComplete ? 'all selected accounts synced' : 'mail history still loading'}</small>
            </div>
          </div>
          <div className="split-nav-scroll">
            <nav aria-label="Mailbox categories">
              <MailViewButtons
                views={FIXED_MAILBOX_CATEGORIES}
                state={state}
                showCounts={false}
                onSelect={split => setState(current => selectSplit(current, split))}
              />
            </nav>
            <div className="nav-section-label" aria-hidden="true">TAP Views</div>
            <nav aria-label="TAP email views">
              <MailViewButtons
                views={TAP_MAIL_VIEWS}
                state={state}
                showCounts
                onSelect={split => setState(current => selectSplit(current, split))}
              />
            </nav>
          </div>
          <div className="flow-card"><span>Needs reply</span><strong>{summary.needsResponse} conversations</strong><small>{summary.waiting} waiting on others</small></div>
        </aside>

        <section
          aria-label="Thread list"
          className="thread-column"
          hidden={threadListCollapsed}
          id={THREAD_LIST_PANE_ID}
        >
          <div className="thread-toolbar">
            <div className="thread-view-heading">
              <CompactMailViewSelect
                selected={state.selectedSplit}
                onSelect={split => setState(current => selectSplit(current, split))}
              />
              <span className="eyebrow">{state.selectedAccountId === 'all' ? 'Unified' : accountFor(state.accounts, state.selectedAccountId)?.displayName}</span>
              <h1>{activeMailView.label}</h1>
            </div>
            <div className="mail-search-stack">
              <div className="mail-search"><Search aria-hidden="true" /><input ref={searchRef} autoComplete="off" name="mail-search" type="search" value={query} onChange={event => { setQuery(event.target.value); setSemanticSearch(null); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void runSemanticSearch(); } }} placeholder="Search…" aria-label="Search mail" /><button className={semanticSearch?.query === query.trim() ? 'is-active' : ''} type="button" disabled={!query.trim() || semanticSearchBusy} onClick={() => { void runSemanticSearch(); }} aria-label="Search by meaning using the local semantic index">{semanticSearchBusy ? 'Indexing…' : 'Meaning'}</button><kbd>/</kbd></div>
              {searchCoverage ? (
                <span
                  className={`mail-search-coverage${searchCoverage.complete ? '' : ' is-partial'}`}
                  role="status"
                  title={searchCoverage.warnings.join(' ') || 'All selected account coverage receipts are current.'}
                >
                  {mailSearchCoverageLabel(searchCoverage)}
                </span>
              ) : null}
            </div>
          </div>
          <div className="thread-list" role={state.selectedSplit === 'scheduled' || state.selectedSplit === 'outbox' ? undefined : 'listbox'} aria-label={state.selectedSplit === 'scheduled' ? 'Scheduled messages' : state.selectedSplit === 'outbox' ? 'Outbox items needing attention' : 'Email threads'}>
            {state.selectedSplit === 'scheduled' ? (
              <ScheduledSendList
                accounts={state.accounts}
                items={scheduledSends.filter(item =>
                  state.selectedAccountId === 'all' || item.accountId === state.selectedAccountId)}
                onCancel={cancelScheduledSend}
              />
            ) : state.selectedSplit === 'outbox' ? (
              <OutboxList
                accounts={state.accounts}
                items={outboxItems}
                onReconcile={reconcileOutboxSend}
                onRetry={retryOutboxSend}
              />
            ) : rowGroups.map((group, groupIndex) => (
              <div
                aria-label={group.label}
                className="thread-day-group"
                key={`${group.dateKey}:${groupIndex}`}
                role="group"
              >
                <div aria-hidden="true" className="thread-day-separator">
                  <span>{group.label}</span>
                </div>
                {group.items.map(item => (
                  <ThreadListRow
                    key={emailThreadKey(item)}
                    thread={item}
                    account={accountFor(state.accounts, item.accountId)}
                    displayTimestamp={threadListTimestamp(item.receivedAt, listReferenceNow)}
                    selected={emailThreadKey(item) === state.selectedThreadKey}
                    selectedRef={selectedRowRef}
                    onSelect={() => openThread(item)}
                  />
                ))}
              </div>
            ))}
            {state.selectedSplit !== 'scheduled' && state.selectedSplit !== 'outbox' && rows.length === 0 ? (
              <div className="zero-state"><span className="zero-check">{state.accounts.length === 0 ? <MailOpen aria-hidden="true" /> : <Check aria-hidden="true" />}</span><h2>{state.accounts.length === 0 ? 'Bring Google into TAP' : state.selectedSplit === 'inbox' && !summary.coverageComplete ? 'Newest mail is arriving' : activeMailView.emptyTitle}</h2><p>{state.accounts.length === 0 ? 'Connect one or more accounts. TAP Email keeps them unified while preserving account context on every action.' : state.selectedSplit === 'inbox' && !summary.coverageComplete ? 'TAP Email will not claim zero until every selected account is current.' : `There are no items in ${activeMailView.label} for the selected account view.`}</p>{state.accounts.length === 0 && !preview ? <GoogleConnectButton busy={connectionBusy} className="primary-button" onLaunch={continueGoogleConnection} onPrepare={prepareGoogleConnection} prepared={googleAuthorizationUrl !== null} /> : null}</div>
            ) : null}
          </div>
        </section>

        <article
          className={`message-pane${poppedReplyDraft?.placement === 'sidecar' ? ' has-reply-sidecar' : ''}`}
          aria-label="Selected email"
        >
          {state.selectedSplit === 'scheduled' ? (
            <div className="empty-reader scheduled-reader">
              <ThreadListToggle collapsed={threadListCollapsed} onToggle={toggleThreadList} />
              <Clock3 aria-hidden="true" />
              <h2>Scheduled delivery</h2>
              <p>Choose Cancel send in the list to preserve its provider draft without delivery.</p>
            </div>
          ) : state.selectedSplit === 'outbox' ? (
            <div className="empty-reader outbox-reader">
              <ThreadListToggle collapsed={threadListCollapsed} onToggle={toggleThreadList} />
              <MailOpen aria-hidden="true" />
              <h2>Recover sends safely</h2>
              <p>Retry only definite failures. Recheck delivery-unknown sends without creating another send identity.</p>
            </div>
          ) : thread ? (
            <>
              <header className="message-header">
                <div className="message-title-row">
                  <ThreadListToggle collapsed={threadListCollapsed} onToggle={toggleThreadList} />
                  <h2>{thread.subject}</h2>
                  <ReaderActions
                    conversationBusy={conversationHandoffBusy}
                    conversationFinished={conversationHandoffFinished}
                    conversationStatusId={activeConversationHandoff ? 'conversation-handoff-status' : undefined}
                    onAskChloe={askChloe}
                    onAction={runCommand}
                    onCreateTask={createTaskFromEmail}
                    starred={thread.starred}
                    taskBusy={emailTaskBusy}
                    taskFinished={emailTaskFinished}
                    taskStatusId={activeEmailTask ? 'email-task-status' : undefined}
                  />
                </div>
                {activeConversationHandoff ? (
                  <div
                    className={`conversation-handoff-status is-${activeConversationHandoff.status}`}
                    id="conversation-handoff-status"
                    role={activeConversationHandoff.status === 'error' || activeConversationHandoff.status === 'partial' ? 'alert' : 'status'}
                    aria-live="polite"
                  >
                    {activeConversationHandoff.message}
                  </div>
                ) : null}
                {activeEmailTask ? (
                  <div
                    aria-live="polite"
                    className={`conversation-handoff-status is-${activeEmailTask.status}`}
                    id="email-task-status"
                    role={activeEmailTask.status === 'failed' || activeEmailTask.status === 'partial' || activeEmailTask.status === 'error' ? 'alert' : 'status'}
                  >
                    {activeEmailTask.message}
                  </div>
                ) : null}
                <ThreadAttentionPanel
                  account={accountFor(state.accounts, thread.accountId)}
                  now={listReferenceNow}
                  onCorrect={correctSelectedThreadAttention}
                  thread={thread}
                  timeZone={mailSearchTimeZone}
                />
              </header>
              <div className="reader-workspace">
                <div className="message-body">
                  <ThreadMessageList
                    accountId={thread.accountId}
                    appTheme={appTheme}
                    attachmentExportSupported={attachmentFiles !== null}
                    expansionRequest={messageExpansionRequest}
                    imagesEnabled={state.preferences.imagesEnabled}
                    key={emailThreadKey(thread)}
                    loadAttachment={preview ? null : loadMessageAttachment}
                    loadRemoteImages={loadRemoteImages}
                    messages={thread.messages}
                    onKeyDown={handleKeyDown}
                    saveAttachment={saveMessageAttachment}
                    threadId={thread.threadId}
                    trackingPixelsEnabled={state.preferences.trackingPixelsEnabled}
                  />
                  {activeReplyDraft?.placement === 'inline' ? (
                    <ReplyComposer
                      attachmentBusy={activeReplyDraft.attachmentBusy}
                      attachmentError={activeReplyDraft.attachmentError}
                      attachments={activeReplyDraft.attachments}
                      bcc={activeReplyDraft.bcc}
                      bodyText={activeReplyDraft.bodyText}
                      cc={activeReplyDraft.cc}
                      focusRequestId={activeReplyDraft.focusRequestId}
                      onAddressChange={(field, value) => updateReplyDraft(activeReplyDraft.threadKey, { [field]: value })}
                      onAttach={() => attachToReplyDraft(activeReplyDraft)}
                      onBodyTextChange={bodyText => updateReplyDraft(activeReplyDraft.threadKey, { bodyText })}
                      onClose={() => closeReplyDraft(activeReplyDraft)}
                      onRemoveAttachment={stageId => updateReplyDraft(activeReplyDraft.threadKey, {
                        attachments: activeReplyDraft.attachments.filter(attachment => attachment.stageId !== stageId),
                      })}
                      onPromptReply={() => askChloe('draft-reply')}
                      onSchedule={(scheduledFor, cancelIfReply) => scheduleReplyDraft(activeReplyDraft, scheduledFor, cancelIfReply)}
                      onSend={() => sendReplyDraft(activeReplyDraft)}
                      onTogglePlacement={() => toggleReplyPlacement(activeReplyDraft)}
                      placement="inline"
                      recipientLabel={activeReplyDraft.recipientLabel}
                      to={activeReplyDraft.to}
                    />
                  ) : activeReplyDraft?.placement === 'sidecar' ? (
                    <button
                      className="reply-inline-anchor"
                      onClick={() => toggleReplyPlacement(activeReplyDraft)}
                      type="button"
                    >
                      <span><strong>Draft</strong> to {activeReplyDraft.recipientLabel}</span>
                      <small>Open inline</small>
                    </button>
                  ) : null}
                </div>
                {poppedReplyDraft?.placement === 'sidecar' ? (
                  <aside className="reply-sidecar" aria-label={`Popped out reply to ${poppedReplyDraft.recipientLabel}`}>
                    <ReplyComposer
                      attachmentBusy={poppedReplyDraft.attachmentBusy}
                      attachmentError={poppedReplyDraft.attachmentError}
                      attachments={poppedReplyDraft.attachments}
                      bcc={poppedReplyDraft.bcc}
                      bodyText={poppedReplyDraft.bodyText}
                      cc={poppedReplyDraft.cc}
                      focusRequestId={poppedReplyDraft.focusRequestId}
                      onAddressChange={(field, value) => updateReplyDraft(poppedReplyDraft.threadKey, { [field]: value })}
                      onAttach={() => attachToReplyDraft(poppedReplyDraft)}
                      onBodyTextChange={bodyText => updateReplyDraft(poppedReplyDraft.threadKey, { bodyText })}
                      onClose={() => closeReplyDraft(poppedReplyDraft)}
                      onRemoveAttachment={stageId => updateReplyDraft(poppedReplyDraft.threadKey, {
                        attachments: poppedReplyDraft.attachments.filter(attachment => attachment.stageId !== stageId),
                      })}
                      onPromptReply={() => askChloe('draft-reply')}
                      onSchedule={(scheduledFor, cancelIfReply) => scheduleReplyDraft(poppedReplyDraft, scheduledFor, cancelIfReply)}
                      onSend={() => sendReplyDraft(poppedReplyDraft)}
                      onTogglePlacement={() => toggleReplyPlacement(poppedReplyDraft)}
                      placement="sidecar"
                      recipientLabel={poppedReplyDraft.recipientLabel}
                      to={poppedReplyDraft.to}
                    />
                  </aside>
                ) : null}
              </div>
            </>
          ) : (
            <div className="empty-reader"><ThreadListToggle collapsed={threadListCollapsed} onToggle={toggleThreadList} /><MailOpen aria-hidden="true" /><h2>{state.accounts.length === 0 ? 'Your focused inbox starts here' : 'Select a thread'}</h2><p>{state.accounts.length === 0 ? 'Connect Google, then use J, K, H, and E to drive toward Operational Zero.' : 'Use J and K to move through the queue.'}</p></div>
          )}
        </article>
      </main>

      {chord ? <div className="chord-hint"><kbd>G</kbd> then a view key…</div> : null}
      {toast || (state.undo && Date.parse(state.undo.expiresAt) > Date.now()) ? (
        <div className="toast" role="status" aria-live="polite">
          <span>{toast || state.undo?.label}</span>
          {state.undo && Date.parse(state.undo.expiresAt) > Date.now() ? (
            <button
              onClick={() => {
                setState(current => undoLastAction(current, new Date().toISOString()));
                flash(state.undo?.kind === 'send' ? 'Send cancelled; draft preserved' : 'Last action undone');
              }}
              type="button"
            >
              Undo
            </button>
          ) : null}
        </div>
      ) : null}
      {overlay === 'remind' && thread ? <ReminderDialog thread={thread} onClose={() => setOverlay('none')} onConfirm={confirmReminder} /> : null}
      {overlay === 'compose' && composeDraftKey ? (
        <ComposeDialog
          accounts={state.accounts}
          draftKey={composeDraftKey}
          initialAccountId={thread?.accountId ?? state.accounts[0]?.accountId ?? ''}
          initialTo=""
          initialSubject={composeSeed?.subject ?? ''}
          initialBodyText={composeSeed?.bodyText ?? ''}
          key={composeSeed?.requestId ?? composeDraftKey}
          onAttach={stageDraftAttachments}
          onAutosave={queueComposeDraftAutosave}
          onClose={() => {
            setComposeDraftKey(null);
            setComposeSeed(null);
            setOverlay('none');
          }}
          onSchedule={(message, scheduledFor, cancelIfReply) => {
            setComposeSeed(null);
            scheduleComposeMessage(message, scheduledFor, cancelIfReply);
          }}
          onSend={message => {
            setComposeSeed(null);
            queueMessage(message);
          }}
        />
      ) : null}
      {overlay === 'palette' ? <CommandPalette onClose={() => setOverlay('none')} onRun={command => { setOverlay('none'); runCommand(command); }} /> : null}
      {overlay === 'shortcuts' ? <ShortcutDialog onClose={() => setOverlay('none')} /> : null}
      {overlay === 'workflows' ? (
        <WorkflowCenter
          idFactory={idFactory}
          loadActivityProjection={() => activityLedger.snapshot()}
          mailState={state}
          onClose={() => setOverlay('none')}
          persistMailMergeDrafts={createMailMergeDrafts}
          workspaceId={preview ? null : surfaceContext?.workspaceId ?? null}
        />
      ) : null}
      {overlay === 'settings' ? (
        <SettingsDialog
          accounts={state.accounts}
          preferences={state.preferences}
          store={store}
          onChange={updatePreferences}
          onClose={() => setOverlay('none')}
          onWipe={receipt => {
            remoteImageCache.current = { entries: new Map(), sizeBytes: 0 };
            setState(current => receipt.scope === 'device'
              ? emptyMailState()
              : receipt.accountId
                ? mailStateWithoutAccount(current, receipt.accountId)
                : current);
          }}
        />
      ) : null}
      {overlay === 'handoff' && thread && surfaceContext?.workspaceId ? (
        <ConversationHandoffDialog
          idFactory={idFactory}
          onClose={() => setOverlay('none')}
          onCompleted={result => setConversationHandoff({
            threadKey: emailThreadKey(thread),
            status: 'created',
            message: result.status === 'staged'
              ? 'Editable handoff staged in TAP Chat. Review it there before sending.'
              : 'Reviewed email context shared in TAP.',
          })}
          onPhase={phase => setConversationHandoff({
            threadKey: emailThreadKey(thread),
            status: phase,
            message: phase === 'checking'
              ? 'Checking destination access…'
              : phase === 'creating'
                ? 'Creating the reviewed private conversation…'
                : phase === 'staging'
                  ? 'Staging the editable TAP Chat handoff…'
                  : 'Sharing the reviewed email context…',
          })}
          thread={thread}
          workspaceId={surfaceContext.workspaceId}
        />
      ) : null}
    </div>
    </TooltipProvider>
  );
}
