import { sdk } from '@theaiplatform/miniapp-sdk/sdk';
import type { TapFederatedSurfaceMountContext } from '@theaiplatform/miniapp-sdk/surface';
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  NativeSelect,
  NativeSelectOption,
  Textarea,
} from '@theaiplatform/miniapp-sdk/ui';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type Ref,
} from 'react';
import type { ReminderCondition } from '@tap-examples/tap-email-protocol';
import { Check, Clock3, MailOpen, Search, Star } from 'lucide-react';
import {
  defaultPreferences,
  emptyMailState,
  emailThreadKey,
  composeMessage,
  mailboxSummary,
  markDone,
  mergeMailboxSnapshot,
  mergeThreadMessages,
  moveSelection,
  notificationsEnabledForAccount,
  previewMailState,
  remindThread,
  resolveReminderInput,
  selectAccount,
  selectSplit,
  selectedThread,
  toggleStar,
  undoLastAction,
  visibleThreads,
  type EmailAccount,
  type EmailThread,
  type MailPreferences,
  type MailSplit,
  type MailState,
} from './domain';
import {
  isTextEntryTarget,
  resolveShortcut,
  SHORTCUTS,
  type EmailKeyCommand,
} from './keybindings';
import { createCoordinatorClient } from './coordinator-client';
import { createLocalMailStore } from './local-store';
import {
  loadPreferences,
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
  readonly preview?: boolean;
  readonly surfaceContext?: TapFederatedSurfaceMountContext;
}

type Overlay = 'none' | 'remind' | 'compose' | 'palette' | 'shortcuts' | 'settings';

const splitItems: readonly { id: MailSplit; label: string; key: string }[] = [
  { id: 'inbox', label: 'Inbox', key: 'G I' },
  { id: 'critical', label: 'Critical', key: 'G C' },
  { id: 'needs-response', label: 'Needs response', key: 'G N' },
  { id: 'waiting', label: 'Waiting', key: 'G W' },
  { id: 'reminders', label: 'Reminders', key: 'G R' },
];

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  hour: 'numeric',
  minute: '2-digit',
});
const listTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});
const reminderPresetFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

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

function unreadCount(state: MailState, split: MailSplit): number {
  return state.threads.filter(thread => {
    if (state.selectedAccountId !== 'all' && thread.accountId !== state.selectedAccountId) {
      return false;
    }
    if (split === 'reminders') return thread.status === 'reminded';
    if (thread.status !== 'inbox') return false;
    if (split === 'critical') return thread.critical;
    if (split === 'needs-response') return thread.needsResponse;
    if (split === 'waiting') return thread.waitingOnOthers;
    return true;
  }).length;
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
  selected,
  selectedRef,
  onSelect,
}: {
  readonly thread: EmailThread;
  readonly account: EmailAccount | null;
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
            {listTimeFormatter.format(new Date(thread.receivedAt))}
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

function ReminderDialog({
  thread,
  onClose,
  onConfirm,
}: {
  readonly thread: EmailThread;
  readonly onClose: () => void;
  readonly onConfirm: (input: string, condition: ReminderCondition) => void;
}) {
  const [input, setInput] = useState('tomorrow');
  const [condition, setCondition] = useState<ReminderCondition>('if_no_reply');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onConfirm(input, condition);
  };
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="reminder-dialog" hideCloseButton>
        <form
          onSubmit={submit}
          onKeyDown={event => {
            if (event.key === 'Tab' && !event.shiftKey) {
              event.preventDefault();
              setCondition(value =>
                value === 'if_no_reply' ? 'regardless' : 'if_no_reply',
              );
            }
          }}
        >
          <div className="dialog-title-row">
            <span className="clock-glyph" aria-hidden="true"><Clock3 /></span>
            <div>
              <DialogTitle>Remind Me</DialogTitle>
              <DialogDescription>{thread.subject}</DialogDescription>
            </div>
            <Button className="condition-toggle" variant="ghost" size="compact" type="button" onClick={() => setCondition(value => value === 'if_no_reply' ? 'regardless' : 'if_no_reply')}>
              {condition === 'if_no_reply' ? 'if no reply' : 'regardless'} <kbd>Tab</kbd>
            </Button>
          </div>
          <Input
            autoFocus
            autoComplete="off"
            className="reminder-input"
            name="reminder-time"
            value={input}
            onChange={event => setInput(event.target.value)}
            aria-label="Reminder date and time"
            placeholder="Try: 8 am, 3 days, Aug 7…"
          />
          <div className="reminder-presets">
            {[
              ['tomorrow', 'Tomorrow'],
              ['next week', 'Next Week'],
              ['next weekend', 'Next Weekend'],
              ['3 days', 'In 3 Days'],
            ].map(([value, label]) => (
              <Button key={value} variant="ghost" type="button" onClick={() => onConfirm(value, condition)}>
                <span>{label}</span>
                <span>{reminderPresetFormatter.format(resolveReminderInput(value, new Date()) ?? new Date())}</span>
              </Button>
            ))}
          </div>
          <div className="dialog-footer">
            <span><kbd>Enter</kbd> set reminder</span>
            <Button className="primary-button" type="submit">Remind Me</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ComposeDialog({
  accounts,
  initialAccountId,
  initialTo,
  initialSubject,
  onClose,
  onSend,
}: {
  readonly accounts: readonly EmailAccount[];
  readonly initialAccountId: string;
  readonly initialTo: string;
  readonly initialSubject: string;
  readonly onClose: () => void;
  readonly onSend: (message: {
    readonly accountId: string;
    readonly to: string;
    readonly subject: string;
    readonly bodyText: string;
  }) => void;
}) {
  const [from, setFrom] = useState(initialAccountId || accounts[0]?.accountId || '');
  const [to, setTo] = useState(initialTo);
  const [subject, setSubject] = useState(initialSubject);
  const [bodyText, setBodyText] = useState('');
  const canSend = Boolean(from && to.trim() && subject.trim() && bodyText.trim());
  const send = () => {
    if (!canSend) return;
    onSend({ accountId: from, to: to.trim(), subject: subject.trim(), bodyText });
  };
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent
        className="compose-dialog"
        hideCloseButton
        onKeyDown={event => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            send();
          }
        }}
      >
        <header>
          <DialogTitle>New Message</DialogTitle>
          <DialogDescription className="sr-only">Write and send an email through the selected Google account.</DialogDescription>
          <Button variant="ghost" size="icon-sm" type="button" onClick={onClose} aria-label="Close compose">×</Button>
        </header>
        <label className="compose-line">
          <span>From</span>
          <NativeSelect name="from-account" value={from} onChange={event => setFrom(event.target.value)}>
            {accounts.map(account => (
              <NativeSelectOption key={account.accountId} value={account.accountId}>
                {account.displayName} · {account.address}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        <label className="compose-line">
          <span>To</span>
          <Input autoFocus autoComplete="off" name="recipients" spellCheck={false} type="email" value={to} onChange={event => setTo(event.target.value)} />
        </label>
        <label className="compose-line">
          <span>Subject</span>
          <Input autoComplete="off" name="subject" value={subject} onChange={event => setSubject(event.target.value)} />
        </label>
        <Textarea autoComplete="off" className="compose-body" name="message-body" aria-label="Message body" placeholder="Write your message…" value={bodyText} onChange={event => setBodyText(event.target.value)} />
        <footer>
          <span>Sent through the selected Google account.</span>
          <Button className="primary-button" type="button" disabled={!canSend} onClick={send}>
            Send <kbd>⌘ Enter</kbd>
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

function CommandPalette({ onClose, onRun }: { readonly onClose: () => void; readonly onRun: (command: EmailKeyCommand) => void }) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const matches = SHORTCUTS.filter(item =>
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
        {(['Triage', 'Write', 'Navigate', 'TAP'] as const).map(group => (
          <div className="shortcut-group" key={group}>
            <h3>{group}</h3>
            {SHORTCUTS.filter(item => item.group === group).map(item => (
              <div key={item.command}><span>{item.label}</span><kbd>{item.keys}</kbd></div>
            ))}
          </div>
        ))}
      </DialogContent>
    </Dialog>
  );
}

function SettingsDialog({ accounts, preferences, onChange, onClose }: { readonly accounts: readonly EmailAccount[]; readonly preferences: MailPreferences; readonly onChange: (preferences: MailPreferences) => void; readonly onClose: () => void }) {
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
          <span><strong>Remote images</strong><small>Show externally hosted images in messages.</small></span>
          <Checkbox checked={preferences.imagesEnabled} onCheckedChange={checked => onChange({ ...preferences, imagesEnabled: checked === true })} />
        </label>
        <label className="setting-row">
          <span><strong>Tracking pixels</strong><small>Allow known open-tracking pixels. Enabled by default.</small></span>
          <Checkbox checked={preferences.trackingPixelsEnabled} onCheckedChange={checked => onChange({ ...preferences, trackingPixelsEnabled: checked === true })} />
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
        <div className="settings-note">TAP Email v0 renders provider plain text only. These preferences are saved now and will apply when the isolated rich-message renderer lands.</div>
        <div className="settings-note">Shortcut remapping will move to the host keybinding registry when the SDK capability lands.</div>
      </DialogContent>
    </Dialog>
  );
}

export function TapEmailApp({ preview = false, surfaceContext }: TapEmailAppProps) {
  const store = useMemo(() => createLocalMailStore(preview), [preview]);
  const [state, setState] = useState<MailState>(() => preview ? previewMailState() : emptyMailState());
  const [hydrated, setHydrated] = useState(false);
  const [initialLoadSettled, setInitialLoadSettled] = useState(false);
  const [locationReady, setLocationReady] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [overlay, setOverlay] = useState<Overlay>('none');
  const [replyMode, setReplyMode] = useState(false);
  const [query, setQuery] = useState('');
  const [toast, setToast] = useState('');
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [dispatchTick, setDispatchTick] = useState(0);
  const [chord, setChord] = useState<'g' | null>(null);
  const chordTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const selectedRowRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const coordinatorRef = useRef<CoordinatorClient | null>(null);
  const stateRef = useRef(state);
  const submittedCommands = useRef(new Set<string>());
  const loadedThreads = useRef(new Set<string>());
  const observedNotifications = useRef(new Set<string>());
  const notificationsPrimed = useRef(false);
  const idFactory = useCallback(
    () => surfaceContext?.entropy.randomUUID() ?? crypto.randomUUID(),
    [surfaceContext],
  );

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        if (preview) {
          const [mail, preferences] = await Promise.all([
            store.load(),
            loadPreferences(true).catch(() => defaultPreferences),
          ]);
          if (!active) return;
          setState(current => ({
            ...(mail ?? current),
            preferences: mail?.preferences ?? preferences,
          }));
          setHydrated(true);
          requestAnimationFrame(() => rootRef.current?.focus());
        } else {
          const client = createCoordinatorClient();
          coordinatorRef.current = client;
          const mailboxRequest = client.getMailbox().then(
            mailbox => ({ mailbox, error: null }),
            error => ({ mailbox: null, error }),
          );
          const cacheRequest = store.load().then(
            mail => ({ mail, error: null }),
            error => ({ mail: null, error }),
          );
          const [cached, preferences] = await Promise.all([
            cacheRequest,
            loadPreferences(false).catch(() => defaultPreferences),
          ]);
          if (!active) return;
          setState(current => ({
            ...(cached.mail ?? current),
            preferences: cached.mail?.preferences ?? preferences,
          }));
          setHydrated(true);
          requestAnimationFrame(() => rootRef.current?.focus());

          const remote = await mailboxRequest;
          if (!active) return;
          if (remote.error || !remote.mailbox) {
            setLoadError(
              cached.mail
                ? `Using the device cache because cloud refresh failed: ${String(remote.error)}`
                : `TAP Email could not open the cloud mailbox: ${String(remote.error)}`,
            );
            return;
          }
          setState(current => ({
            ...mergeMailboxSnapshot(current, remote.mailbox),
            preferences: current.preferences,
          }));
          setLoadError(
            cached.error
              ? `Mail is live, but the device cache could not open: ${String(cached.error)}`
              : '',
          );
        }
      } catch (error) {
        if (!active) return;
        setLoadError(`TAP Email could not open the cloud mailbox: ${String(error)}`);
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
    };
  }, [preview, store]);

  useEffect(() => {
    if (
      !hydrated ||
      (store.capability !== 'preview-fixture' &&
        store.capability !== 'private-profile-sqlite')
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      void store.save(state).catch(error => {
        if (store.capability === 'private-profile-sqlite') {
          setLoadError(`Mail is live, but the device cache could not save: ${String(error)}`);
        }
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [hydrated, state, store]);

  useEffect(
    () => () => {
      void store.close().catch(() => undefined);
    },
    [store],
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

  const thread = selectedThread(state);
  const rows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const candidates = visibleThreads(state);
    return normalized
      ? candidates.filter(item =>
          `${item.subject} ${item.snippet} ${displayParticipant(item)}`
            .toLowerCase()
            .includes(normalized),
        )
      : candidates;
  }, [query, state]);

  useEffect(() => {
    if (!query.trim() || rows.length === 0) return;
    setState(current =>
      rows.some(item => emailThreadKey(item) === current.selectedThreadKey)
        ? current
        : { ...current, selectedThreadKey: emailThreadKey(rows[0]!) },
    );
  }, [query, rows]);
  const summary = useMemo(
    () => mailboxSummary(state, new Date().toISOString()),
    [state],
  );

  useEffect(() => {
    const row = selectedRowRef.current;
    if (row && typeof row.scrollIntoView === 'function') {
      row.scrollIntoView({ block: 'nearest' });
    }
  }, [query, state.selectedThreadKey]);

  useEffect(() => {
    if (!locationReady || !globalThis.location?.href) return;
    globalThis.history.replaceState(
      null,
      '',
      withMailViewHash(
        globalThis.location.href,
        mailViewLocation(state.selectedAccountId, state.selectedSplit, thread),
      ),
    );
  }, [locationReady, state.selectedAccountId, state.selectedSplit, thread]);

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
      const critical = state.threads.filter(item => item.status === 'inbox' && item.critical);
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
    for (const item of state.threads) {
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
  }, [hydrated, initialLoadSettled, notify, preview, state.preferences, state.threads]);

  const refreshMailbox = useCallback(async () => {
    const client = coordinatorRef.current;
    if (!client || stateRef.current.commands.length > 0) return;
    const mailbox = await client.getMailbox();
    loadedThreads.current.clear();
    setState(current =>
      current.commands.length > 0 ? current : mergeMailboxSnapshot(current, mailbox),
    );
    setLoadError('');
  }, []);

  const requestFreshMail = useCallback(async () => {
    const client = coordinatorRef.current;
    if (!client) return;
    setSyncing(true);
    try {
      await Promise.all(
        stateRef.current.accounts.map(account => client.requestSync(account.accountId)),
      );
      await wait(1_200);
      await refreshMailbox();
    } finally {
      setSyncing(false);
    }
  }, [refreshMailbox]);

  const connectGoogle = useCallback(() => {
    if (preview || connectionBusy) return;
    const popup = window.open(
      '',
      'tap-email-google-connect',
      'popup,width=520,height=720',
    );
    if (!popup) {
      flash('Allow the Google connection window and try again');
      return;
    }
    popup.opener = null;
    setConnectionBusy(true);
    void (async () => {
      try {
        const client = coordinatorRef.current ?? createCoordinatorClient();
        coordinatorRef.current = client;
        const existing = new Set(stateRef.current.accounts.map(account => account.accountId));
        const authorizationUrl = await client.beginGoogleConnection();
        popup.location.replace(authorizationUrl);
        flash('Finish connecting Google in the new window');
        for (let attempt = 0; attempt < 45; attempt += 1) {
          await wait(2_000);
          const mailbox = await client.getMailbox();
          if (mailbox.accounts.some(account => !existing.has(account.accountId))) {
            setState(current => mergeMailboxSnapshot(current, mailbox));
            flash('Google connected · newest mail is arriving');
            return;
          }
        }
        flash('Google is still connecting; refresh TAP Email in a moment');
      } catch (error) {
        popup.close();
        flash(`Google connection failed: ${String(error)}`);
      } finally {
        setConnectionBusy(false);
      }
    })();
  }, [connectionBusy, flash, preview]);

  useEffect(() => {
    if (!hydrated || preview || state.accounts.length === 0) return;
    void requestFreshMail().catch(error =>
      setLoadError(`Mailbox synchronization failed: ${String(error)}`),
    );
    const interval = window.setInterval(() => {
      if (stateRef.current.commands.length > 0) return;
      void requestFreshMail().catch(() => undefined);
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [hydrated, preview, requestFreshMail, state.accounts.length]);

  useEffect(() => {
    if (preview || !thread) return;
    const key = `${thread.accountId}:${thread.threadId}`;
    if (loadedThreads.current.has(key)) return;
    loadedThreads.current.add(key);
    const client = coordinatorRef.current;
    if (!client) return;
    void client.getThread(thread.accountId, thread.threadId)
      .then(messages => {
        setState(current =>
          mergeThreadMessages(current, thread.accountId, thread.threadId, messages),
        );
      })
      .catch(() => loadedThreads.current.delete(key));
  }, [preview, thread]);

  useEffect(() => {
    if (preview || !hydrated) return;
    const currentTime = Date.now();
    let wakeAt: number | null = null;
    for (const command of state.commands) {
      if (submittedCommands.current.has(command.commandId)) continue;
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
      void (async () => {
        try {
          await client.submitCommand(command);
          for (let attempt = 0; attempt < 120; attempt += 1) {
            const receipt = await client.getCommand(command.commandId);
            if (['applied', 'failed', 'uncertain', 'cancelled'].includes(receipt.state)) {
              setState(current => ({
                ...current,
                commands: current.commands.filter(item => item.commandId !== command.commandId),
                undo: current.undo?.commandId === command.commandId ? null : current.undo,
              }));
              if (receipt.state !== 'applied') {
                flash(`Email action needs attention: ${receipt.errorCode ?? receipt.state}`);
                if (
                  (command.kind === 'send_draft' || command.kind === 'schedule_send') &&
                  notificationsEnabledForAccount(stateRef.current.preferences, command.accountId)
                ) {
                  notify('An email send needs attention. Review it before retrying.');
                }
              }
              await client.requestSync(command.accountId).catch(() => false);
              await wait(1_200);
              await refreshMailbox().catch(() => undefined);
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
      })();
    }
    if (wakeAt !== null) {
      const timer = window.setTimeout(
        () => setDispatchTick(value => value + 1),
        Math.max(0, wakeAt - Date.now()) + 10,
      );
      return () => window.clearTimeout(timer);
    }
  }, [dispatchTick, flash, hydrated, notify, preview, refreshMailbox, state.commands, state.undo]);

  const runCommand = useCallback((command: EmailKeyCommand) => {
    const now = new Date().toISOString();
    if (command === 'next') {
      setState(current => query.trim()
        ? moveWithinThreads(current, rows, 1)
        : moveSelection(current, 1));
    }
    if (command === 'previous') {
      setState(current => query.trim()
        ? moveWithinThreads(current, rows, -1)
        : moveSelection(current, -1));
    }
    if (command === 'done') {
      setState(current => markDone(current, `cmd_${idFactory()}`, now));
      flash('Marked done · Z to undo');
    }
    if (command === 'undo') {
      setState(current => undoLastAction(current, now));
      flash('Last action undone');
    }
    if (command === 'toggle-star') setState(current => toggleStar(current, `cmd_${idFactory()}`, now));
    if (command === 'remind' && thread) setOverlay('remind');
    if (command === 'compose') {
      setReplyMode(false);
      setOverlay('compose');
    }
    if (command === 'reply' && thread) {
      setReplyMode(true);
      setOverlay('compose');
    }
    if (command === 'search') searchRef.current?.focus();
    if (command === 'palette') setOverlay('palette');
    if (command === 'show-shortcuts') setOverlay('shortcuts');
    if (command === 'unified-account') setState(current => selectAccount(current, 'all'));
    if (command === 'account-1') setState(current => selectAccount(current, current.accounts[0]?.accountId ?? 'all'));
    if (command === 'account-2') setState(current => selectAccount(current, current.accounts[1]?.accountId ?? 'all'));
    const splitCommands: Partial<Record<EmailKeyCommand, MailSplit>> = {
      'inbox-split': 'inbox',
      'critical-split': 'critical',
      'needs-response-split': 'needs-response',
      'waiting-split': 'waiting',
      'reminders-split': 'reminders',
    };
    const split = splitCommands[command];
    if (split) setState(current => selectSplit(current, split));
    if (command === 'bring-to-conversation') {
      if (!thread) return;
      if (preview || !surfaceContext?.workspaceId) {
        flash('Conversation handoff needs a mounted TAP workspace');
        return;
      }
      void (async () => {
        const channel = await sdk.channels.create({
          workspaceId: surfaceContext.workspaceId,
          name: `Email: ${thread.subject}`,
          description: 'Private TAP conversation created from an email.',
          visibility: 'private',
        });
        await sdk.channels.sendMessage({
          workspaceId: surfaceContext.workspaceId,
          channelId: channel.roomId,
          name: 'Email context',
          content: thread.messages.at(-1)?.bodyText ?? thread.snippet,
          body: `Email from ${displayParticipant(thread)}\n\n${thread.subject}\n\n${thread.messages.at(-1)?.bodyText ?? thread.snippet}`,
          messageContent: {
            tapEmail: {
              accountId: thread.accountId,
              threadId: thread.threadId,
              provider: 'google',
            },
          },
        });
        flash('Private conversation created');
      })().catch(error => flash(`Conversation handoff failed: ${String(error)}`));
    }
    setOverlay(current => command === 'palette' || command === 'show-shortcuts' || command === 'remind' || command === 'compose' || command === 'reply' ? current : 'none');
  }, [flash, idFactory, preview, query, rows, surfaceContext, thread]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (overlay !== 'none' || isTextEntryTarget(event.target)) return;
    const result = resolveShortcut(event, chord);
    if (result.preventDefault) event.preventDefault();
    if (chordTimer.current) clearTimeout(chordTimer.current);
    setChord(result.nextChord);
    if (result.nextChord) {
      chordTimer.current = setTimeout(() => setChord(null), 900);
    }
    if (result.command) runCommand(result.command);
  };

  const confirmReminder = (input: string, condition: ReminderCondition) => {
    const now = new Date();
    const due = resolveReminderInput(input, now);
    if (!due) {
      flash('Choose a future reminder time');
      return;
    }
    setState(current => remindThread(current, `cmd_${idFactory()}`, `reminder_${idFactory()}`, due.toISOString(), condition, now.toISOString()));
    setOverlay('none');
    flash(`Reminder set ${condition === 'if_no_reply' ? 'if no reply' : 'regardless'} · Z to undo`);
  };

  const updatePreferences = (preferences: MailPreferences) => {
    setState(current => ({ ...current, preferences }));
    if (!preview) void savePreferences(preferences).catch(error => flash(`Settings were not saved: ${String(error)}`));
  };

  const queueMessage = (message: {
    readonly accountId: string;
    readonly to: string;
    readonly subject: string;
    readonly bodyText: string;
  }) => {
    const now = new Date().toISOString();
    const replyThread = replyMode ? thread : null;
    setState(current => composeMessage(
      current,
      `cmd_${idFactory()}`,
      message.accountId,
      replyThread?.threadId ?? null,
      message.to,
      message.subject,
      message.bodyText,
      replyThread?.messages.at(-1)?.internetMessageId ?? null,
      now,
    ));
    setOverlay('none');
    flash('Message queued for secure delivery');
  };

  if (!hydrated) {
    return <div className="tap-email-loading">Opening TAP Email…</div>;
  }

  return (
    <div className="tap-email" ref={rootRef} tabIndex={-1} onKeyDown={handleKeyDown}>
      <a className="skip-link" href="#tap-email-main">Skip to Mailbox</a>
      <header className="app-bar">
        <div className="brand"><span className="brand-mark">T</span><span>TAP Email</span></div>
        <div className="account-switcher" aria-label="Account view">
          <button className={state.selectedAccountId === 'all' ? 'is-active' : ''} onClick={() => setState(current => selectAccount(current, 'all'))} type="button">All accounts <kbd>G A</kbd></button>
          {state.accounts.map((account, index) => (
            <button key={account.accountId} className={state.selectedAccountId === account.accountId ? 'is-active' : ''} onClick={() => setState(current => selectAccount(current, account.accountId))} type="button">
              <span className="account-dot" style={{ backgroundColor: account.accent }} aria-hidden="true" />{account.displayName}<kbd>G {index + 1}</kbd>
            </button>
          ))}
        </div>
        <div className="app-actions">
          {!preview ? <button type="button" onClick={connectGoogle} disabled={connectionBusy}>{connectionBusy ? 'Connecting…' : 'Add Google'}</button> : null}
          {!preview && state.accounts.length > 0 ? <button type="button" onClick={() => void requestFreshMail()} disabled={syncing}>{syncing ? 'Syncing…' : 'Sync'}</button> : null}
          <button type="button" onClick={() => setOverlay('settings')} aria-label="TAP Email settings">Settings</button>
          <button type="button" onClick={() => setOverlay('shortcuts')}>Shortcuts <kbd>?</kbd></button>
          <button className="compose-button" type="button" onClick={() => runCommand('compose')} disabled={state.accounts.length === 0}>Compose <kbd>C</kbd></button>
        </div>
      </header>

      {preview || loadError || store.capability === 'unavailable' ? (
        <div className={`capability-banner ${preview ? 'is-preview' : loadError ? '' : 'is-cloud'}`} role={loadError ? 'alert' : 'status'} aria-live="polite">
          <strong>{loadError ? state.accounts.length > 0 ? 'Cached mailbox' : 'Mailbox unavailable' : preview ? 'Fixture mailbox' : state.accounts.length > 0 ? 'Cloud mailbox active' : 'Google account required'}</strong>
          <span>{loadError || (preview ? 'Disposable sample data; no Gmail account is connected.' : state.accounts.length > 0 ? 'Mail is live, but this host does not expose the private profile SQLite cache.' : 'Connect Google to start a private, account-scoped mailbox.')}</span>
          {loadError && !preview ? <button type="button" onClick={() => void refreshMailbox()}>Retry</button> : null}
        </div>
      ) : null}

      <main className="mail-shell" id="tap-email-main" tabIndex={-1}>
        <aside className="split-sidebar" aria-label="Email views">
          <div className="zero-card">
            <div className="zero-orbit"><span>{summary.critical}</span></div>
            <div><strong>{summary.operationalZero ? 'Operational Zero' : `${summary.needsResponse} decisions`}</strong><small>{summary.coverageComplete ? 'Coverage current' : 'Coverage incomplete'}</small></div>
          </div>
          <nav>
            {splitItems.map(item => (
              <button key={item.id} className={state.selectedSplit === item.id ? 'is-active' : ''} type="button" onClick={() => setState(current => selectSplit(current, item.id))}>
                <span>{item.label}</span><span className="nav-count">{unreadCount(state, item.id)}</span><kbd>{item.key}</kbd>
              </button>
            ))}
          </nav>
          <div className="coverage-card">
            <span className="eyebrow">Account coverage</span>
            {state.accounts.map(account => (
              <div key={account.accountId}><span className={`coverage-dot is-${account.coverage.state}`} /> <span>{account.displayName}</span><small>{account.coverage.state}</small></div>
            ))}
            {state.accounts.length === 0 ? <button type="button" onClick={connectGoogle}>Connect Google</button> : null}
          </div>
          <div className="flow-card"><span>Focus session</span><strong>{summary.needsResponse} decisions</strong><small>Keep the loop moving</small></div>
        </aside>

        <section className="thread-column" aria-label="Thread list">
          <div className="thread-toolbar">
            <div><span className="eyebrow">{state.selectedAccountId === 'all' ? 'Unified' : accountFor(state.accounts, state.selectedAccountId)?.displayName}</span><h1>{splitItems.find(item => item.id === state.selectedSplit)?.label}</h1></div>
            <label className="mail-search"><Search aria-hidden="true" /><input ref={searchRef} autoComplete="off" name="mail-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search…" aria-label="Search visible mail" /><kbd>/</kbd></label>
          </div>
          <div className="thread-list" role="listbox" aria-label="Email threads">
            {rows.map(item => (
              <ThreadListRow key={emailThreadKey(item)} thread={item} account={accountFor(state.accounts, item.accountId)} selected={emailThreadKey(item) === state.selectedThreadKey} selectedRef={selectedRowRef} onSelect={() => setState(current => ({ ...current, selectedThreadKey: emailThreadKey(item) }))} />
            ))}
            {rows.length === 0 ? (
              <div className="zero-state"><span className="zero-check">{state.accounts.length === 0 ? <MailOpen aria-hidden="true" /> : <Check aria-hidden="true" />}</span><h2>{state.accounts.length === 0 ? 'Bring Google into TAP' : summary.coverageComplete ? 'This queue is clear' : 'Newest mail is arriving'}</h2><p>{state.accounts.length === 0 ? 'Connect one or more accounts. TAP Email keeps them unified while preserving account context on every action.' : summary.coverageComplete ? 'A small win. Take the momentum with you.' : 'TAP Email will not claim zero until every selected account is current.'}</p>{state.accounts.length === 0 && !preview ? <button className="primary-button" type="button" onClick={connectGoogle}>Connect Google</button> : null}</div>
            ) : null}
          </div>
        </section>

        <article className="message-pane" aria-label="Selected email">
          {thread ? (
            <>
              <header className="message-header">
                <div className="message-account"><span className="account-dot" style={{ backgroundColor: accountFor(state.accounts, thread.accountId)?.accent }} aria-hidden="true" />{accountFor(state.accounts, thread.accountId)?.address}</div>
                <h2>{thread.subject}</h2>
                <div className="message-meta"><strong>{displayParticipant(thread)}</strong><span>{thread.participants[0]?.address}</span><time dateTime={thread.receivedAt}>{dateTimeFormatter.format(new Date(thread.receivedAt))}</time></div>
                <div className="message-actions">
                  <button type="button" onClick={() => runCommand('done')}>Done <kbd>E</kbd></button>
                  <button type="button" onClick={() => runCommand('remind')}>Remind <kbd>H</kbd></button>
                  <button type="button" onClick={() => runCommand('reply')}>Reply <kbd>R</kbd></button>
                  <button type="button" onClick={() => runCommand('bring-to-conversation')}>Conversation <kbd>B</kbd></button>
                  <button className={thread.starred ? 'is-starred' : ''} type="button" onClick={() => runCommand('toggle-star')} aria-label={thread.starred ? 'Unstar thread' : 'Star thread'}><Star aria-hidden="true" fill={thread.starred ? 'currentColor' : 'none'} /></button>
                </div>
              </header>
              <div className="message-body">
                {thread.messages.map(item => (
                  <section className="message-card" key={item.messageId}>
                    <div className="avatar" aria-hidden="true">{item.from.name.slice(0, 1)}</div>
                    <div><div className="message-from"><strong>{item.from.name}</strong><span>to {item.to.map(recipient => recipient.name).join(', ')}</span></div><p>{item.bodyText}</p></div>
                  </section>
                ))}
              </div>
              <footer className="triage-bar">
                <span><kbd>J</kbd> next</span><span><kbd>K</kbd> previous</span><span><kbd>H</kbd> remind</span><span><kbd>E</kbd> done</span><span><kbd>Z</kbd> undo</span>
              </footer>
            </>
          ) : (
            <div className="empty-reader"><MailOpen aria-hidden="true" /><h2>{state.accounts.length === 0 ? 'Your focused inbox starts here' : 'Select a thread'}</h2><p>{state.accounts.length === 0 ? 'Connect Google, then use J, K, H, and E to drive toward Operational Zero.' : 'Use J and K to move through the queue.'}</p></div>
          )}
        </article>
      </main>

      {chord ? <div className="chord-hint"><kbd>G</kbd> then a view key…</div> : null}
      {toast ? <div className="toast" role="status" aria-live="polite">{toast}</div> : null}
      {overlay === 'remind' && thread ? <ReminderDialog thread={thread} onClose={() => setOverlay('none')} onConfirm={confirmReminder} /> : null}
      {overlay === 'compose' ? <ComposeDialog accounts={state.accounts} initialAccountId={thread?.accountId ?? state.accounts[0]?.accountId ?? ''} initialTo={replyMode ? thread?.participants[0]?.address ?? '' : ''} initialSubject={replyMode ? `Re: ${thread?.subject ?? ''}` : ''} onClose={() => setOverlay('none')} onSend={queueMessage} /> : null}
      {overlay === 'palette' ? <CommandPalette onClose={() => setOverlay('none')} onRun={command => { setOverlay('none'); runCommand(command); }} /> : null}
      {overlay === 'shortcuts' ? <ShortcutDialog onClose={() => setOverlay('none')} /> : null}
      {overlay === 'settings' ? <SettingsDialog accounts={state.accounts} preferences={state.preferences} onChange={updatePreferences} onClose={() => setOverlay('none')} /> : null}
    </div>
  );
}
