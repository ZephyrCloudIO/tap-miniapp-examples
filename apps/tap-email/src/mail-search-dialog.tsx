import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@theaiplatform/miniapp-sdk/ui';
import { Search } from 'lucide-react';
import { journalOf, type MailWindowCursor } from './bounded-mail-replica';
import { emailThreadKey, projectedThreads, type EmailThread, type MailState } from './domain';
import type { LocalMailStore } from './local-store';
import { filterMailThreads } from './mail-search';
import { useDelayedStatus } from './use-delayed-status';

const pageSize = 50;
const filters = ['from:', 'to:', 'has:attachment', 'is:unread', 'in:sent'];

export function MailSearchDialog({ state, store, initialQuery, onClose, onSelect, onRestoreFocus }: {
  readonly state: MailState;
  readonly store: LocalMailStore;
  readonly initialQuery: string;
  readonly onClose: () => void;
  readonly onSelect: (thread: EmailThread) => void;
  readonly onRestoreFocus: (opened: boolean) => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [accountId, setAccountId] = useState(state.selectedAccountId);
  const [cursor, setCursor] = useState<MailWindowCursor | null>(null);
  const [history, setHistory] = useState<(MailWindowCursor | null)[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [read, setRead] = useState<{
    scope: string; threads: readonly EmailThread[]; pending: boolean; failed: boolean; next: MailWindowCursor | null;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const opened = useRef(false);
  const id = useId();
  const [context] = useState(() => ({ now: new Date(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }));
  const scope = JSON.stringify([accountId, query, cursor]);
  const knownAccounts = useMemo(() => new Set(state.accounts.map(account => account.accountId)), [state.accounts]);
  const resident = useMemo(() => cursor ? [] : filterMailThreads(projectedThreads(state)
    .filter(thread => knownAccounts.has(thread.accountId) && (accountId === 'all' || thread.accountId === accountId))
    .sort((left, right) => right.receivedAt.localeCompare(left.receivedAt)), query, context).slice(0, pageSize),
  [state, knownAccounts, accountId, query, context, cursor]);
  const current = read?.scope === scope ? read : null;
  const rows = current?.threads ?? resident;
  const pending = Boolean(store.queryThreads && (!current || current.pending));
  const showPending = useDelayedStatus(pending, 800);
  const showFailure = useDelayedStatus(Boolean(current?.failed), 8_000);
  const active = rows[Math.min(activeIndex, Math.max(0, rows.length - 1))];

  useEffect(() => {
    if (!store.queryThreads) return;
    const abort = new AbortController();
    const show = (threads: readonly EmailThread[], pending: boolean, next: MailWindowCursor | null = null) => {
      if (abort.signal.aborted) return;
      setRead({ scope, threads: threads.filter(thread => knownAccounts.has(thread.accountId)), pending, failed: false, next });
    };
    show(resident, true);
    // Paint resident matches immediately and coalesce fast typing before reading history.
    const timer = setTimeout(() => {
      void store.queryThreads!({ accountId, query, after: cursor, limit: pageSize,
        signal: abort.signal, context, journal: journalOf(state),
        onProgress: threads => {
          const seen = new Set(threads.map(emailThreadKey));
          show([...threads, ...resident.filter(thread => !seen.has(emailThreadKey(thread)))].slice(0, pageSize), true);
        },
      }).then(page => show(page.threads, false, page.next)).catch(() => {
        if (!abort.signal.aborted) setRead(previous => ({ scope,
          threads: previous?.scope === scope ? previous.threads : resident, pending: false, failed: true, next: null }));
      });
    }, query.trim() ? 120 : 0);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [accountId, attempt, context, cursor, knownAccounts, query, resident, scope, state, store]);

  useEffect(() => { setActiveIndex(0); }, [scope]);
  useEffect(() => {
    results.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, active]);
  const changeQuery = (value: string) => { setQuery(value); setCursor(null); setHistory([]); setActiveIndex(0); };
  const choose = (thread: EmailThread) => { opened.current = true; onSelect(thread); };

  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="mail-search-dialog" hideCloseButton
      onOpenAutoFocus={event => { event.preventDefault(); input.current?.focus(); input.current?.select(); }}
      onCloseAutoFocus={event => { event.preventDefault(); onRestoreFocus(opened.current); }}>
      <DialogTitle className="sr-only">Search mail</DialogTitle>
      <DialogDescription className="sr-only">Search senders, subjects, and messages. Use up and down arrows to choose a result, Enter to open, and Escape to close.</DialogDescription>
      <div className="search-dialog-input">
        <Search aria-hidden="true" />
        <input ref={input} autoComplete="off" name="mail-search-dialog" aria-label="Search mail"
          placeholder="Search your mail…" value={query} onChange={event => changeQuery(event.target.value)}
          role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls={`${id}-results`}
          aria-activedescendant={active ? `${id}-result-${Math.min(activeIndex, rows.length - 1)}` : undefined}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey) return;
            if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && rows.length) {
              event.preventDefault();
              const offset = event.key === 'ArrowDown' ? 1 : -1;
              setActiveIndex(index => (Math.min(index, rows.length - 1) + offset + rows.length) % rows.length);
            } else if (event.key === 'Enter' && active) { event.preventDefault(); choose(active); }
          }} />
        <button type="button" className="search-dialog-close" onClick={onClose} aria-label="Close search"><kbd>esc</kbd><span className="mobile-search-cancel">Cancel</span></button>
      </div>
      <div className="search-dialog-filters">
        <select aria-label="Search account" value={accountId} onChange={event => {
          setAccountId(event.target.value); setCursor(null); setHistory([]); setActiveIndex(0);
        }}>
          <option value="all">All accounts</option>
          {state.accounts.map(account => <option key={account.accountId} value={account.accountId}>{account.displayName}</option>)}
        </select>
        <span>All folders</span>
      </div>
      {!query.trim() ? <div className="search-dialog-hints" aria-label="Search filters">
        {filters.map(filter => <button key={filter} type="button" onClick={() => {
          changeQuery(filter.endsWith(':') ? filter : `${filter} `); input.current?.focus();
        }}>{filter}</button>)}
      </div> : null}
      <div className="search-dialog-label" aria-live="polite">
        {showFailure ? <>Could not search all saved mail. <button type="button" onClick={() => setAttempt(value => value + 1)}>Retry</button></>
          : showPending ? 'Searching saved mail…' : query.trim() ? 'Search results' : 'Recent conversations'}
      </div>
      <div className="search-dialog-results" id={`${id}-results`} ref={results} role="listbox" aria-label="Search results" aria-busy={pending}>
        {rows.map((thread, index) => <button key={emailThreadKey(thread)} id={`${id}-result-${index}`}
          className="search-dialog-result" type="button" role="option" tabIndex={-1}
          aria-selected={thread === active} onMouseEnter={() => setActiveIndex(index)}
          onMouseDown={event => event.preventDefault()} onClick={() => choose(thread)}>
          <span className="search-result-heading"><strong>{thread.participants[0]?.name || thread.participants[0]?.address || 'Unknown sender'}</strong>
            <time dateTime={thread.receivedAt}>{new Date(thread.receivedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</time></span>
          <span className="search-result-subject">{thread.subject || '(No subject)'}</span>
          <span className="search-result-snippet">{thread.snippet}</span>
          {accountId === 'all' ? <span className="search-result-account">{state.accounts.find(account => account.accountId === thread.accountId)?.displayName}</span> : null}
        </button>)}
        {!rows.length && !pending && !current?.failed ? <p className="search-dialog-empty">{query.trim() ? 'No matching mail. Try another name, phrase, or filter.' : 'No saved conversations yet.'}</p> : null}
      </div>
      <footer className="search-dialog-footer">
        <span><kbd>↑</kbd><kbd>↓</kbd> navigate <kbd>↵</kbd> open</span>
        {history.length ? <button type="button" onClick={() => { setCursor(history.at(-1)!); setHistory(items => items.slice(0, -1)); }}>Previous results</button> : null}
        {current?.next && !pending ? <button type="button" onClick={() => { setHistory(items => [...items, cursor]); setCursor(current.next); }}>Next results</button> : null}
      </footer>
    </DialogContent>
  </Dialog>;
}
