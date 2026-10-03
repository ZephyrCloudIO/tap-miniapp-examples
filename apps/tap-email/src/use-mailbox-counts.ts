import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { journalOf } from './bounded-mail-replica';
import { countThreadSplits, projectMailboxCounts, rememberCountThreads, type MailboxCountSnapshot } from './mailbox-counts';
import { mailboxSummary, projectedThreads, type MailState } from './domain';
import type { LocalMailStore } from './local-store';

export function useMailboxCounts(state: MailState, store: LocalMailStore, hydrated: boolean, replicaVersion: number, now: number) {
  const [snapshot, setSnapshot] = useState<(MailboxCountSnapshot & { store: LocalMailStore; replicaVersion: number }) | null>(null);
  const stateRef = useRef(state);
  const request = useRef<{ store: LocalMailStore; state: MailState; now: number; replicaVersion: number; key: string } | null>(null);
  const running = useRef(false);
  useLayoutEffect(() => {
    stateRef.current = state;
    if (snapshot?.store === store && snapshot.accountId === state.selectedAccountId) rememberCountThreads(snapshot, state.threads);
  });
  // Reader navigation/mark-read changes do not affect membership counts.
  const membership = JSON.stringify((state.pendingThreadIntents ?? []).flatMap(intent => {
    const { unread: _unread, ...patch } = intent.patch;
    return Object.keys(patch).length ? [{ ...intent, patch }] : [];
  }));
  const scope = state.selectedAccountId;
  useEffect(() => {
    if (!hydrated || !store.summarize) return;
    const next = { store, state: stateRef.current, now, replicaVersion, key: JSON.stringify([scope, replicaVersion, membership, stateRef.current.outbox, now]) };
    request.current = next;
    const pump = () => {
      const pending = request.current;
      if (running.current || !pending) return;
      running.current = true;
      const baseline: MailboxCountSnapshot = { accountId: pending.state.selectedAccountId, value: mailboxSummary(pending.state, new Date(pending.now).toISOString()),
        intents: pending.state.pendingThreadIntents, threads: new Map() };
      rememberCountThreads(baseline, pending.state.threads);
      void pending.store.summarize!(baseline.accountId, journalOf(pending.state)).then(value => {
        if (request.current?.store === pending.store && request.current.key === pending.key) {
          setSnapshot({ ...baseline, store: pending.store, replicaVersion: pending.replicaVersion, value });
        }
      }).catch(() => {
        if (request.current?.key === pending.key && request.current.store === pending.store) setSnapshot(current =>
          current?.store === pending.store ? { ...current, value: { ...current.value, coverageComplete: false, operationalZero: false } } : current);
      }).finally(() => {
        running.current = false;
        if (request.current && (request.current.store !== pending.store || request.current.key !== pending.key)) pump();
      });
    };
    pump();
    return () => { if (request.current === next) request.current = null; };
  }, [hydrated, store, scope, replicaVersion, membership, state.outbox, now]);

  return useMemo(() => {
    if (snapshot?.store === store && snapshot.accountId === scope) {
      const projected = projectMailboxCounts(snapshot, state, new Date(now).toISOString());
      return snapshot.replicaVersion === replicaVersion ? projected : { ...projected, coverageComplete: false, operationalZero: false };
    }
    const accounts = state.accounts.filter(account => scope === 'all' || account.accountId === scope);
    const threads = projectedThreads(state).filter(thread => scope === 'all' || thread.accountId === scope);
    const summary = mailboxSummary({ ...state, accounts }, new Date(now).toISOString(), threads);
    return { ...summary, mailboxCounts: countThreadSplits(threads), ...(store.summarize ? { coverageComplete: false, operationalZero: false } : {}) };
  }, [snapshot, state.accounts, state.threads, state.pendingThreadIntents, state.outbox, scope, store, now, replicaVersion]);
}
