import { describe, expect, it } from '@rstest/core';
import { countLabel, countThreadSplits, projectMailboxCounts, rememberCountThreads, type MailboxCountSnapshot } from './mailbox-counts';
import { mailboxSummary, previewMailState, type MailState } from './domain';
import { boundedReplicaMigrations, journalOf } from './bounded-mail-replica';
import { ProfileSqliteMailStore } from './local-store';
import { sqliteStoreFixture } from './sqlite-store-fixture';

describe('full-replica mailbox counts', () => {
  it('recovers explicit empty resources from a multipart legacy metadata record', async () => {
    const fixture = sqliteStoreFixture();
    const store = new ProfileSqliteMailStore(fixture.profile);
    const base = previewMailState();
    const source = { ...base.threads[0]!, providerResources: [], status: 'inbox' as const, starred: true };
    try {
      await store.save({ ...base, threads: [source] });
      fixture.sqlite.exec('UPDATE local_mail_threads SET provider_resources_known = 0');
      fixture.sqlite.prepare("DELETE FROM local_mail_records WHERE kind = 'thread'").run();
      const document = JSON.stringify({ ...source, messages: [], subject: 'x'.repeat(150_000) });
      const insert = fixture.sqlite.prepare("INSERT INTO local_mail_records (kind, account_id, thread_id, entity_id, part, payload) VALUES ('thread', ?, ?, '', ?, ?)");
      for (let offset = 0; offset < document.length; offset += 60_000) insert.run(source.accountId, source.threadId, offset / 60_000, document.slice(offset, offset + 60_000));
      fixture.sqlite.exec(boundedReplicaMigrations.find(migration => migration.version === 32)!.sql);
      expect((await store.summarize()).mailboxCounts).toMatchObject({ inbox: 0, starred: 0 });
    } finally { await store.close(); }
  });
  it('counts beyond the loaded window and applies pending archive/star overlays once', async () => {
    const fixture = sqliteStoreFixture();
    const store = new ProfileSqliteMailStore(fixture.profile);
    const base = previewMailState();
    const source = base.threads[0]!;
    const threads = Array.from({ length: 240 }, (_, i) => ({ ...source, threadId: `count_${i}`, status: 'inbox' as const,
      providerResources: ['inbox', ...(i % 3 === 0 ? ['starred'] as const : []), ...(i % 4 === 0 ? ['sent'] as const : [])] as const,
      starred: i % 3 === 0, critical: i % 2 === 0, needsResponse: true, messages: [] }));
    try {
      await store.save({ ...base, threads });
      const window = await store.queryThreads({ limit: 10, bodies: false });
      expect(window.threads).toHaveLength(10);
      const summary = await store.summarize(source.accountId);
      expect(summary.mailboxCounts).toMatchObject({ inbox: 240, starred: 80, sent: 60, critical: 120, 'needs-response': 240 });
      const intents = [{ commandId: 'archive', accountId: source.accountId, threadId: 'count_0', patch: { status: 'done' as const, providerResources: ['starred', 'sent'] as const } },
        { commandId: 'star', accountId: source.accountId, threadId: 'count_1', patch: { starred: true, providerResources: ['inbox', 'starred'] as const } }];
      const projected = await store.summarize(source.accountId, { ...journalOf(base), pendingThreadIntents: intents });
      expect(projected.mailboxCounts).toMatchObject({ inbox: 239, done: 1, starred: 81, sent: 60, critical: 119, 'needs-response': 239 });
      const other = await store.summarize(base.accounts.find(account => account.accountId !== source.accountId)!.accountId, { ...journalOf(base), pendingThreadIntents: intents });
      expect(other.mailboxCounts.inbox).toBe(0);
    } finally { await store.close(); }
  });

  it('matches selectors for provider resources, empty known resources and legacy fallbacks', async () => {
    const fixture = sqliteStoreFixture();
    const store = new ProfileSqliteMailStore(fixture.profile);
    const base = previewMailState();
    const source = base.threads[0]!;
    const threads = [
      { ...source, threadId: 'known-empty', providerResources: [], status: 'inbox' as const, starred: true },
      { ...source, threadId: 'legacy', providerResources: undefined, status: 'inbox' as const, starred: true },
      { ...source, threadId: 'spam-trash', providerResources: ['spam', 'trash', 'drafts'] as const, status: 'trashed' as const },
      { ...source, threadId: 'reminded', providerResources: ['inbox'] as const, status: 'reminded' as const },
    ];
    try {
      await store.save({ ...base, threads });
      expect((await store.summarize()).mailboxCounts).toEqual(countThreadSplits(threads));
    } finally { await store.close(); }
  });

  it('keeps optimistic totals through acknowledgement and rollback without loading bodies', () => {
    const state = previewMailState();
    const thread = { ...state.threads[0]!, status: 'inbox' as const, critical: true, needsResponse: true, providerResources: ['inbox'] as const };
    const baseline = { ...state, threads: [thread], selectedAccountId: thread.accountId };
    const value = { ...mailboxSummary(baseline, '2026-10-03T00:00:00Z'), inbox: 240, critical: 120, needsResponse: 200,
      mailboxCounts: { ...countThreadSplits([thread]), inbox: 240, critical: 120, 'needs-response': 200 } };
    const snapshot: MailboxCountSnapshot = { accountId: thread.accountId, value, intents: [], threads: new Map() };
    rememberCountThreads(snapshot, [thread]);
    expect(snapshot.threads.values().next().value?.messages).toEqual([]);
    const pending: MailState = { ...baseline, pendingThreadIntents: [{ commandId: 'archive', accountId: thread.accountId, threadId: thread.threadId,
      patch: { status: 'done', providerResources: [] } }] };
    expect(projectMailboxCounts(snapshot, pending, '2026-10-03T00:00:00Z')).toMatchObject({ inbox: 239, critical: 119, needsResponse: 199 });
    const acknowledged = { ...baseline, threads: [{ ...thread, status: 'done' as const, providerResources: [] }] };
    expect(projectMailboxCounts(snapshot, acknowledged, '2026-10-03T00:00:00Z')).toMatchObject({ inbox: 239, critical: 119, needsResponse: 199 });
    expect(projectMailboxCounts(snapshot, baseline, '2026-10-03T00:00:00Z')).toMatchObject({ inbox: 240, critical: 120, needsResponse: 200 });
  });

  it('marks partial and unknown counts without claiming a complete total', () => {
    expect(countLabel(452, false)).toBe('≈452');
    expect(countLabel(452, true)).toBe('452');
    expect(countLabel(undefined, true)).toBe('—');
  });
});
