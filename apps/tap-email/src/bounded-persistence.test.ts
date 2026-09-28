import { describe, expect, it, rs } from '@rstest/core';
import { execFileSync } from 'node:child_process';
import { ProfileSqliteMailStore } from './local-store';
import { CommandPersistenceBarrier } from './command-persistence-barrier';
import { MailPersistenceQueue, persistCommandSnapshot, recoverMailJournal } from './mail-persistence';
import { boundMailWindow, diskBodyBudgetBytes, mailWindowSize, memoryBodyBudgetBytes, queryMailWindow, readRecord, writeRecord } from './bounded-mail-replica';
import { maximumRecordPartBytes, maximumSqlRequestBytes, recordParts, serializedBytes } from './bounded-sql';
import { composeMessage, emptyMailState, outboxImmediateSends, previewMailState, settleMailCommand, type EmailThread, type MailState } from './domain';
import { sqliteStoreFixture } from './sqlite-store-fixture';

const template = previewMailState();
function thread(index: number, bodySize = 0): EmailThread {
  const source = template.threads[0]!;
  return { ...source, threadId: `thread_${String(index).padStart(6, '0')}`, subject: `History ${index}`,
    receivedAt: new Date(Date.UTC(2026, 0, 1) - index * 60_000).toISOString(),
    messages: [{ ...source.messages[0]!, messageId: `message_${index}`, bodyText: 'a'.repeat(bodySize), bodyHtml: 'b'.repeat(bodySize) }] };
}
function withCommand(state: MailState, id: string): MailState {
  return composeMessage(state, id, template.accounts[0]!.accountId, null, 'test@example.com', 'Subject', 'Recover me', null,
    '2026-09-24T00:00:00.000Z', { draftKey: `draft_${id}`, draftRevision: 1 });
}

async function commitProviderThreads(store: ProfileSqliteMailStore, threads: EmailThread[], mode: 'page' | 'refresh') {
  const mailbox = { schemaVersion: 1 as const, accounts: template.accounts, threads };
  if (mode === 'refresh') await store.commitMailboxRefresh(mailbox);
  else await store.commitMailboxPage(await store.beginMailboxSync(), mailbox, null);
}

describe('bounded durable mail persistence', () => {
  it('opens a bounded first screen without reading message records or attachment housekeeping', async () => {
    const fixture = sqliteStoreFixture();
    const store = new ProfileSqliteMailStore(fixture.profile);
    const threads = Array.from({ length: 200 }, (_, index) => thread(index, 100));
    await store.save({ ...template, selectedAccountId: 'all', selectedSplit: 'inbox', threads });
    fixture.statements.length = 0;
    const restored = await new ProfileSqliteMailStore(fixture.profile).load({ initialWindow: true });
    expect(restored?.threads).toHaveLength(20);
    expect(fixture.statements.some(sql => sql.includes("kind IN ('thread', 'message')"))).toBe(false);
    expect(fixture.statements.some(sql => sql.includes('FROM attachment_cache'))).toBe(false);
    expect(fixture.statements.length).toBeLessThanOrEqual(10);
  });

  it('does not restore deleted or superseded rows from the startup snapshot', async () => {
    const fixture = sqliteStoreFixture();
    const store = new ProfileSqliteMailStore(fixture.profile);
    const original = thread(0);
    const unchanged = thread(1);
    const mailbox = { schemaVersion: 1 as const, accounts: template.accounts, threads: [original, unchanged] };
    const committed = await store.commitMailboxUpdate({ mailbox, revision: 1, nextCursor: null });
    await store.saveCache({ ...template, ...committed.mailbox, schemaVersion: 2, selectedThreadKey: null });
    await store.commitMailboxUpdate({ mailbox: { ...mailbox, threads: [] }, revision: 2, nextCursor: null }, {
      changes: { mailbox: { ...mailbox, threads: [] }, revision: 2, nextRevision: 2, nextCursor: null, hasMore: false,
        deletedThreads: [{ accountId: original.accountId, threadId: original.threadId }] },
    });
    const restored = await new ProfileSqliteMailStore(fixture.profile).load({ initialWindow: true });
    expect(restored?.threads.map(item => item.threadId)).toEqual([unchanged.threadId]);
  });

  it.each(['page', 'refresh'] as const)('preserves searchable body enrichment only at the same provider revision during %s', async mode => {
    const fixture = sqliteStoreFixture();
    const store = new ProfileSqliteMailStore(fixture.profile);
    const metadata = thread(0);
    const hydrated = { ...metadata, messages: [{ ...metadata.messages[0]!, bodyText: 'saffron contract' }] };
    await store.save({ ...template, threads: [hydrated] });
    await commitProviderThreads(store, [metadata], mode);

    const restarted = new ProfileSqliteMailStore(fixture.profile);
    expect((await restarted.queryThreads({ query: 'saffron contract' })).threads.map(item => item.threadId))
      .toEqual([metadata.threadId]);
    expect((await restarted.loadThread(metadata.accountId, metadata.threadId))?.messages[0]?.bodyText)
      .toBe('saffron contract');

    // New source revisions can invalidate old content; this is not indefinite retention.
    await commitProviderThreads(restarted, [{ ...metadata, providerRevision: 'new_content_revision' }], mode);
    expect((await restarted.queryThreads({ query: 'saffron contract' })).threads).toEqual([]);
    expect((await restarted.loadThread(metadata.accountId, metadata.threadId))?.messages[0]?.bodyText).toBe('');
  });

  it('includes due reminders outside the UI window in Operational Zero', async () => {
    const fixture = sqliteStoreFixture();
    let now = Date.parse('2026-09-27T12:00:00.000Z');
    const store = new ProfileSqliteMailStore(fixture.profile, () => now);
    const records = Array.from({ length: 150 }, (_, index) => ({ ...thread(index),
      status: 'done' as const, critical: false, needsResponse: false }));
    const source = records.at(-1)!;
    const due = { ...source, status: 'reminded' as const,
      reminder: { reminderId: 'reminder_outside_window', accountId: source.accountId, threadId: source.threadId,
        condition: 'regardless' as const, createdAt: new Date(now).toISOString(), dueAt: '2026-09-27T13:00:00.000Z' } };
    await store.save({ ...template,
      selectedThreadKey: null,
      accounts: template.accounts.map(account => ({ ...account,
        coverage: { ...account.coverage, state: 'current' as const } })),
      threads: [...records.slice(0, -1), due] });
    expect((await store.load())?.threads.some(item => item.threadId === due.threadId)).toBe(false);
    expect(await store.summarize()).toMatchObject({ dueReminders: 0, operationalZero: true });
    now = Date.parse(due.reminder.dueAt);
    expect(await store.summarize()).toMatchObject({ dueReminders: 1, operationalZero: false, coverageComplete: true });
  });

  it('restores cached mail and the exact queued send with a canonical TAP sender identity', async () => {
    const fixture = sqliteStoreFixture();
    const store = new ProfileSqliteMailStore(fixture.profile);
    const state = composeMessage(template, 'cmd_auth0', template.accounts[0]!.accountId, null,
      'test@example.com', 'Subject', 'Preserve this draft', null, '2026-09-26T00:00:00.000Z', {
        draftKey: 'draft_auth0', draftRevision: 1,
        sendAfter: '2026-09-26T00:00:05.000Z',
        expectedContext: { userId: 'google-oauth2|123456789', workspaceId: 'org_workspace' },
      });
    await store.save(state);

    const restored = await new ProfileSqliteMailStore(fixture.profile).load();
    expect(restored?.accounts).toEqual(state.accounts);
    expect(restored?.threads).toHaveLength(state.threads.length);
    expect(restored?.commands).toEqual(state.commands);
    expect(restored?.undo).toEqual(state.undo);
    expect(outboxImmediateSends(restored!)).toEqual(outboxImmediateSends(state));
    expect(outboxImmediateSends(restored!)[0]?.attempts[0]?.command.payload.bodyText).toBe('Preserve this draft');
    expect(await new ProfileSqliteMailStore(fixture.profile).loadJournal()).toMatchObject({ commands: state.commands });
  });

  it('replaces full mailbox batches within native SQL limits without deleting unrelated threads', async () => {
    const fixture = sqliteStoreFixture();
    const store = new ProfileSqliteMailStore(fixture.profile);
    const threads = Array.from({ length: 130 }, (_, index) => thread(index));
    const otherAccount = template.accounts.find(account => account.accountId !== threads[0]!.accountId)!;
    const otherThread = { ...threads[0]!, accountId: otherAccount.accountId, subject: 'Other mailbox' };
    await store.save({ ...template, threads: [...threads, otherThread] });
    fixture.statements.length = 0;
    await store.saveCache({ ...template, threads: threads.slice(0, 100).map(item => ({ ...item, subject: 'Updated' })) });

    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS n FROM local_mail_threads').get()?.n).toBe(131);
    expect(fixture.sqlite.prepare("SELECT COUNT(*) AS n FROM local_mail_threads WHERE subject = 'Updated'").get()?.n).toBe(100);
    expect(fixture.sqlite.prepare('SELECT subject FROM local_mail_threads WHERE account_id = ? AND thread_id = ?')
      .get(otherThread.accountId, otherThread.threadId)?.subject).toBe('Other mailbox');
    const deletes = fixture.statements.filter(sql => sql.startsWith('DELETE FROM local_mail_') && sql.includes('?'));
    expect(deletes.some(sql => sql.startsWith('DELETE FROM local_mail_records'))).toBe(true);
    expect(deletes.some(sql => sql.startsWith('DELETE FROM local_mail_threads'))).toBe(true);
    const schema = fixture.sqlite.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type = 'table' DESC").all();
    // Node's SQLite uses a deeper default expression limit than TAP. Compile the
    // actual generated statements against the host's native SQLite limits too.
    const result = execFileSync('python3', ['-c', `
import json, sqlite3, sys
data = json.load(sys.stdin)
c = sqlite3.connect(':memory:')
c.setlimit(sqlite3.SQLITE_LIMIT_EXPR_DEPTH, 100)
c.setlimit(sqlite3.SQLITE_LIMIT_VARIABLE_NUMBER, 999)
c.setlimit(sqlite3.SQLITE_LIMIT_SQL_LENGTH, 1024 * 1024)
c.setlimit(sqlite3.SQLITE_LIMIT_COLUMN, 256)
for entry in data['schema']: c.execute(entry['sql'])
for sql in data['statements']:
 c.execute('EXPLAIN ' + sql, [None] * sql.count('?')).fetchall()
print('native SQL limits passed')
`], { encoding: 'utf8', input: JSON.stringify({ schema, statements: deletes }) });
    expect(result.trim()).toBe('native SQL limits passed');
  });

  it('splits escaped UTF-8 at byte boundaries and round-trips surrogate pairs', () => {
    for (const value of ['a'.repeat(maximumRecordPartBytes), '😀"\\\n'.repeat(40_000), '\ud800'.repeat(30_000)]) {
      const parts = [...recordParts(value)];
      expect(parts.every(part => serializedBytes(part) <= maximumRecordPartBytes)).toBe(true);
      expect(JSON.parse(parts.join(''))).toBe(value);
    }
  });

  it('persists a mailbox over the host limit without blocking its small command journal', async () => {
    const fixture = sqliteStoreFixture();
    const store = new ProfileSqliteMailStore(fixture.profile);
    const state = withCommand({ ...template, threads: Array.from({ length: 26 }, (_, index) => thread(index, 500_000)) }, 'cmd_large_cache');
    expect(serializedBytes(state)).toBeGreaterThan(24 * 1024 * 1024);
    const barrier = new CommandPersistenceBarrier();
    await persistCommandSnapshot(store, barrier, state);
    await store.saveCache(state);
    expect(barrier.readiness(state.commands[0]!, store.capability).durable).toBe(true);
    expect(fixture.metrics().largestRequest).toBeLessThanOrEqual(maximumSqlRequestBytes);
    expect(fixture.metrics().largestValue).toBeLessThanOrEqual(maximumRecordPartBytes);
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS n FROM mailbox_state').get()?.n).toBe(0);
    const restored = await new ProfileSqliteMailStore(fixture.profile).load();
    expect(restored?.commands).toEqual(state.commands);
    expect(restored?.threads).toHaveLength(26);
    expect(serializedBytes(restored?.threads.map(item => item.messages))).toBeLessThan(memoryBodyBudgetBytes + 50_000);
    expect((await store.loadThread(state.threads[25]!.accountId, state.threads[25]!.threadId))?.messages[0]?.bodyText).toHaveLength(500_000);
  });

  it('commits page records with their generation/cursor and rolls both back on failure', async () => {
    const fixture = sqliteStoreFixture();
    const store = new ProfileSqliteMailStore(fixture.profile);
    await store.save({ ...template, threads: [] });
    const generation = await store.beginMailboxSync();
    const a = await store.commitMailboxPage(generation, { schemaVersion: 1, accounts: template.accounts, threads: [thread(0)] }, 'after-a');
    fixture.failOnce(sql => sql.startsWith('INSERT OR REPLACE INTO local_mail_sync'));
    await expect(store.commitMailboxPage(a, { schemaVersion: 1, accounts: template.accounts, threads: [thread(1)] }, 'after-b')).rejects.toThrow('injected');
    const restarted = new ProfileSqliteMailStore(fixture.profile);
    expect(await restarted.beginMailboxSync()).toEqual(a);
    expect((await restarted.queryThreads({})).threads.map(item => item.threadId)).toEqual([thread(0).threadId]);
    const complete = await restarted.commitMailboxPage(a, { schemaVersion: 1, accounts: template.accounts, threads: [thread(1)] }, null);
    expect(complete.complete).toBe(true);
    const next = await restarted.beginMailboxSync();
    expect(next.generation).not.toBe(a.generation);
    await expect(store.commitMailboxPage(a, { schemaVersion: 1, accounts: [], threads: [thread(2)] }, null)).rejects.toThrow('superseded');
    expect((await restarted.queryThreads({})).threads).toHaveLength(2);
  });

  it('does not release a command created while retry awaits a different snapshot', async () => {
    const fixture = sqliteStoreFixture();
    const store = new ProfileSqliteMailStore(fixture.profile);
    const barrier = new CommandPersistenceBarrier();
    let live = template;
    const gate = fixture.pauseOnce(sql => sql === 'DELETE FROM local_mail_journal');
    const retry = persistCommandSnapshot(store, barrier, live);
    await gate.entered;
    live = withCommand(live, 'cmd_during_retry');
    gate.release();
    await retry;
    expect(barrier.readiness(live.commands[0]!, store.capability).ready).toBe(false);
    expect((await new ProfileSqliteMailStore(fixture.profile).load())?.commands).toEqual([]);
    await persistCommandSnapshot(store, barrier, live);
    expect(barrier.readiness(live.commands[0]!, store.capability).durable).toBe(true);
  });

  it('keeps exact commands and drafts recoverable when a cache write fails', async () => {
    const fixture = sqliteStoreFixture();
    const store = new ProfileSqliteMailStore(fixture.profile);
    const state = withCommand(template, 'cmd_cache_failure');
    fixture.failOnce(sql => sql.includes('INTO local_mail_threads'));
    await expect(store.save(state)).rejects.toThrow('injected');
    const restored = await new ProfileSqliteMailStore(fixture.profile).load();
    expect(restored?.commands).toEqual(state.commands);
  });

  it('resumes interrupted migration without losing newer commands or receipt identity', async () => {
    const fixture = sqliteStoreFixture();
    const store = new ProfileSqliteMailStore(fixture.profile);
    await store.load();
    const pending = withCommand({ ...template, threads: Array.from({ length: 30 }, (_, index) => thread(index)) }, 'cmd_migrated');
    const command = pending.commands[0]!;
    const legacy = settleMailCommand(pending, command, { commandId: command.commandId, idempotencyKey: command.idempotencyKey,
      accountId: command.accountId, state: 'uncertain', acceptedAt: command.createdAt, providerAcknowledgedAt: null, errorCode: 'timeout' }, command.createdAt);
    fixture.sqlite.prepare('INSERT INTO mailbox_state VALUES (1, 2, ?, ?)').run(JSON.stringify(legacy), command.createdAt);
    let inserts = 0;
    fixture.failOnce(sql => sql.includes('INTO local_mail_threads') && ++inserts === 2);
    await expect(store.load()).rejects.toThrow('injected');
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS n FROM mailbox_state').get()?.n).toBe(1);
    const newer = withCommand(legacy, 'cmd_after_interruption');
    await store.saveJournal(newer);
    const restored = await new ProfileSqliteMailStore(fixture.profile).load();
    expect(restored?.commands).toEqual(newer.commands);
    expect(restored?.outbox).toEqual(legacy.outbox);
    expect(restored?.threads).toHaveLength(30);
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS n FROM mailbox_state').get()?.n).toBe(0);
  });

  it('writes no mailbox rows for selection changes', async () => {
    const fixture = sqliteStoreFixture();
    const store = new ProfileSqliteMailStore(fixture.profile);
    await store.save(template);
    fixture.statements.length = 0;
    await store.save({ ...template, selectedThreadKey: null });
    expect(fixture.statements.some(sql => /(?:INSERT|DELETE|UPDATE).*local_mail_(?:threads|messages|accounts|bodies)/u.test(sql))).toBe(false);
    expect(fixture.statements.some(sql => sql === 'DELETE FROM local_mail_journal')).toBe(false);
  });

  it('keeps the full searchable history on disk through sustained paging with bounded UI/body retention', async () => {
    const fixture = sqliteStoreFixture();
    const store = new ProfileSqliteMailStore(fixture.profile);
    await store.save({ ...template, threads: [] });
    let checkpoint = await store.beginMailboxSync();
    let ui: MailState = { ...template, threads: [] };
    for (let page = 0; page < 12; page++) {
      const threads = Array.from({ length: 25 }, (_, index) => thread(page * 25 + index));
      checkpoint = await store.commitMailboxPage(checkpoint, { schemaVersion: 1, accounts: template.accounts, threads }, page === 11 ? null : `page_${page + 1}`);
      ui = boundMailWindow({ ...ui, threads: [...ui.threads, ...threads] });
      expect(ui.threads.length).toBeLessThanOrEqual(mailWindowSize + 1);
    }
    const all: string[] = [];
    let after = null;
    do {
      const window = await store.queryThreads({ after });
      expect(window.threads.length).toBeLessThanOrEqual(mailWindowSize);
      all.push(...window.threads.map(item => item.threadId));
      after = window.next;
    } while (after);
    expect(new Set(all).size).toBe(300);
    expect((await store.summarize()).inbox).toBe(300);
    expect((await store.inspectStorage()).counts.threads).toBe(300);
    expect((await store.queryThreads({ query: 'History 299' })).threads.map(item => item.threadId)).toEqual([thread(299).threadId]);
    for (let index = 0; index < 40; index++) {
      const hydrated = thread(index, 500_000);
      await store.saveCache({ ...template, threads: [hydrated] });
      ui = boundMailWindow({ ...ui, threads: [hydrated, ...ui.threads.filter(item => item.threadId !== hydrated.threadId)] });
    }
    expect(fixture.sqlite.prepare('SELECT SUM(bytes) AS n FROM local_mail_bodies').get()?.n).toBeLessThanOrEqual(diskBodyBudgetBytes);
    expect(serializedBytes(ui.threads.map(item => item.messages))).toBeLessThan(memoryBodyBudgetBytes + 100_000);
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS n FROM local_mail_threads').get()?.n).toBe(300);
  });

  it('opens only the first 20 rows of the saved account and folder without reading bodies', async () => {
    const fixture = sqliteStoreFixture();
    const store = new ProfileSqliteMailStore(fixture.profile);
    const threads = Array.from({ length: 130 }, (_, index) => ({ ...thread(index, 1000), providerResources: ['sent'] as const }));
    await store.save({ ...template, selectedAccountId: threads[0]!.accountId, selectedSplit: 'sent', threads });
    fixture.statements.length = 0;
    const state = await new ProfileSqliteMailStore(fixture.profile).load({ initialWindow: true });
    expect(state!.threads.map(item => item.threadId)).toEqual(threads.slice(0, 20).map(item => item.threadId));
    expect(fixture.statements.some(sql => /local_mail_bodies/.test(sql))).toBe(false);
  });

  it('keeps local corrections after navigation drops the edited thread before a coalesced save', async () => {
    const fixture = sqliteStoreFixture();
    const store = new ProfileSqliteMailStore(fixture.profile);
    await store.save({ ...template, threads: [thread(0), thread(1)] });
    const loaded = (await store.queryThreads({})).threads;
    const edited = { ...loaded[0]!, attentionCorrection: { critical: false, correctedAt: '2026-09-27T00:00:00.000Z' } };
    store.stageCache({ ...template, threads: [edited] });
    expect((await store.queryThreads({ split: 'critical' })).threads.some(item => item.threadId === edited.threadId)).toBe(false);
    await store.saveCache({ ...template, threads: [loaded[1]!] });
    expect((await store.loadThread(edited.accountId, edited.threadId))!.attentionCorrection).toEqual(edited.attentionCorrection);
    fixture.statements.length = 0;
    const page = await store.queryThreads({ onProgress: threads => store.stageCache({ ...template, threads }) });
    await store.saveCache({ ...template, threads: page.threads });
    expect(fixture.statements.some(sql => /INSERT OR REPLACE INTO local_mail_threads/.test(sql))).toBe(false);
  });

  it('reassembles metadata that crosses a response batch and rejects missing parts', async () => {
    const fixture = sqliteStoreFixture();
    const store = new ProfileSqliteMailStore(fixture.profile);
    const item = { ...thread(0), messages: Array.from({ length: 70 }, (_, index) => ({ ...thread(0).messages[0]!, messageId: `long_message_${index}`, bodyText: 'x'.repeat(8000) })) };
    await store.save({ ...template, threads: [item] });
    expect((await store.queryThreads({})).threads[0]!.messages).toHaveLength(70);
    fixture.sqlite.exec("DELETE FROM local_mail_records WHERE kind = 'message' AND entity_id = 'long_message_20'");
    await expect(store.queryThreads({})).rejects.toThrow('incomplete');
  });

  it('shows 20 cached rows in two bridge calls and adds rows before pagination finishes, without touching bodies', async () => {
    const fixture = sqliteStoreFixture();
    const store = new ProfileSqliteMailStore(fixture.profile);
    const threads = Array.from({ length: 130 }, (_, index) => thread(index, 1000));
    await store.save({ ...template, threads });
    fixture.statements.length = 0;
    const progress: { count: number; calls: number }[] = [];
    const page = await store.queryThreads({ journal: { commands: [], undo: null }, onProgress: rows => {
      progress.push({ count: rows.length, calls: fixture.statements.length });
    } });
    expect(progress[0]).toEqual({ count: 20, calls: 2 });
    expect(progress.map(item => item.count)).toEqual([20, 40, 60, 80, 100]);
    expect(fixture.statements.length).toBeLessThanOrEqual(8);
    expect(fixture.statements.some(sql => /local_mail_bodies|UPDATE|INSERT|DELETE/.test(sql))).toBe(false);
    expect(page.threads).toHaveLength(100);
    expect(page.next).not.toBeNull();
    expect(page.threads[0]!.messages[0]!.bodyHtml).toBeUndefined();
    expect((await store.loadThread(threads[0]!.accountId, threads[0]!.threadId))!.messages[0]!.bodyHtml).toHaveLength(1000);
  });

  it('does not rerender unchanged search results while scanning later history', async () => {
    const fixture = sqliteStoreFixture();
    const store = new ProfileSqliteMailStore(fixture.profile);
    await store.save({ ...template, threads: Array.from({ length: 120 }, (_, index) => ({ ...thread(index), subject: index === 0 ? 'Only match' : 'Unrelated' })) });
    const progress: number[] = [];
    const result = await store.queryThreads({ query: 'Only match', onProgress: threads => progress.push(threads.length) });
    expect(result.threads).toHaveLength(1);
    expect(progress).toEqual([1]);
  });

  it('cancels after the first visible batch without reading the rest of history', async () => {
    const fixture = sqliteStoreFixture();
    const store = new ProfileSqliteMailStore(fixture.profile);
    await store.save({ ...template, threads: Array.from({ length: 130 }, (_, index) => thread(index)) });
    const abort = new AbortController();
    fixture.statements.length = 0;
    await expect(store.queryThreads({ signal: abort.signal, journal: { commands: [], undo: null },
      onProgress: () => abort.abort(),
    })).rejects.toThrow();
    expect(fixture.statements).toHaveLength(2);
  });

  it('serves navigation after the active transaction, ahead of queued history writes', async () => {
    const fixture = sqliteStoreFixture();
    const store = new ProfileSqliteMailStore(fixture.profile);
    await store.save({ ...template, threads: [thread(0)] });
    const firstGate = fixture.pauseOnce(sql => sql.startsWith('INSERT OR REPLACE INTO local_mail_threads'));
    const first = store.saveCache({ ...template, threads: [thread(1)] });
    await firstGate.entered;
    const secondGate = fixture.pauseOnce(sql => sql.startsWith('INSERT OR REPLACE INTO local_mail_threads'));
    const second = store.saveCache({ ...template, threads: [thread(2)] });
    const read = store.queryThreads({});
    firstGate.release();
    try {
      const winner = await Promise.race([read.then(() => 'navigation'), secondGate.entered.then(() => 'background')]);
      expect(winner).toBe('navigation');
      expect((await read).threads.map(item => item.threadId)).toEqual([thread(0).threadId, thread(1).threadId]);
    } finally { secondGate.release(); await Promise.all([first, second, read]); }
  });

  it('projects unsaved folder actions without waiting for a journal save', async () => {
    const fixture = sqliteStoreFixture();
    const store = new ProfileSqliteMailStore(fixture.profile);
    const inbox = { ...thread(0), providerResources: ['inbox'] as const };
    await store.save({ ...template, threads: [inbox] });
    const journal = { commands: [], undo: null, pendingThreadIntents: [{ commandId: 'local', accountId: inbox.accountId,
      threadId: inbox.threadId, patch: { status: 'done' as const, providerResources: [] as const } }] };
    const page = await store.queryThreads({ split: 'done', journal });
    expect(page.threads.map(item => item.threadId)).toEqual([inbox.threadId]);
    expect((await store.queryThreads({ split: 'inbox', journal })).threads).toEqual([]);
    expect((await store.loadJournal())!.pendingThreadIntents).toEqual(template.pendingThreadIntents);
  });

  it('batches sync revision guards and prior metadata instead of reading every thread separately', async () => {
    const fixture = sqliteStoreFixture();
    const store = new ProfileSqliteMailStore(fixture.profile);
    await store.save({ ...template, threads: [] });
    const threads = Array.from({ length: 100 }, (_, index) => thread(index));
    const page = { mailbox: { schemaVersion: 1 as const, accounts: template.accounts, threads }, nextCursor: 'older', revision: 10 };
    await store.commitMailboxUpdate(page);
    fixture.statements.length = 0;
    await store.commitMailboxUpdate({ ...page, revision: 11 });
    expect(fixture.statements.length).toBeLessThan(50);
    expect((await store.queryThreads({})).threads).toHaveLength(100);
  });

  it('retains only one pending state while a write is paused', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const written: MailState[] = [];
    const queue = new MailPersistenceQueue(async state => { written.push(state); if (written.length === 1) await gate; });
    queue.request(template);
    const flushing = queue.flush();
    let latest = template;
    for (let index = 0; index < 1_000; index++) { latest = { ...template, selectedThreadKey: `thread_${index}` }; queue.request(latest); }
    release();
    await flushing;
    expect(written).toEqual([template, latest]);
  });

  it.each(['sent', 'drafts', 'spam'] as const)('loads a sparse %s view without reading unrelated message records', async split => {
    const fixture = sqliteStoreFixture();
    const store = new ProfileSqliteMailStore(fixture.profile);
    const threads = Array.from({ length: 240 }, (_, index) => ({ ...thread(index),
      providerResources: [index === 237 ? split : 'inbox'] as EmailThread['providerResources'] }));
    await store.save({ ...template, threads });
    fixture.statements.length = 0;
    const page = await store.queryThreads({ accountId: threads[0]!.accountId, split });
    expect(page.threads.map(item => item.threadId)).toEqual([threads[237]!.threadId]);
    expect(page.next).toBeNull();
    expect(fixture.statements.length).toBeLessThan(12);
  });

  it('pages sent threads within the selected account without overlaps or omissions', async () => {
    const fixture = sqliteStoreFixture();
    const store = new ProfileSqliteMailStore(fixture.profile);
    const threads = Array.from({ length: 220 }, (_, index) => ({ ...thread(index),
      providerResources: [index % 2 === 0 ? 'sent' : 'inbox'] as EmailThread['providerResources'] }));
    const otherAccount = template.accounts.find(account => account.accountId !== threads[0]!.accountId)!;
    await store.save({ ...template, threads: [...threads, { ...threads[0]!, accountId: otherAccount.accountId }] });
    const first = await store.queryThreads({ accountId: threads[0]!.accountId, split: 'sent' });
    const second = await store.queryThreads({ accountId: threads[0]!.accountId, split: 'sent', after: first.next });
    expect(first.threads).toHaveLength(100);
    expect(second.threads).toHaveLength(10);
    expect(second.next).toBeNull();
    expect([...first.threads, ...second.threads].map(item => item.threadId))
      .toEqual(threads.filter(item => item.providerResources?.includes('sent')).map(item => item.threadId));
    expect([...first.threads, ...second.threads].every(item => item.accountId === threads[0]!.accountId)).toBe(true);
  });

  it('preserves pending resource changes and cross-folder searches in sent views', async () => {
    const fixture = sqliteStoreFixture();
    const store = new ProfileSqliteMailStore(fixture.profile);
    const inbox = { ...thread(0), providerResources: ['inbox'] as const };
    const sent = { ...thread(1), providerResources: ['sent'] as const };
    await store.save({ ...template, threads: [inbox, sent] });
    const page = await queryMailWindow(fixture.database, { accountId: inbox.accountId, split: 'sent' }, {
      commands: [], undo: null, pendingThreadIntents: [
        { commandId: 'add', accountId: inbox.accountId, threadId: inbox.threadId, patch: { providerResources: ['sent'] } },
        { commandId: 'remove', accountId: sent.accountId, threadId: sent.threadId, patch: { providerResources: ['inbox'] } },
      ],
    });
    expect(page.threads.map(item => item.threadId)).toEqual([inbox.threadId]);
    const search = await store.queryThreads({ accountId: inbox.accountId, split: 'sent', query: 'History 0' });
    expect(search.threads.map(item => item.threadId)).toEqual([inbox.threadId]);
  });

  it('bounds SQL parameters and avoids unrelated history scans with hundreds of local folder overrides', async () => {
    const fixture = sqliteStoreFixture();
    const store = new ProfileSqliteMailStore(fixture.profile);
    const threads = Array.from({ length: 450 }, (_, index) => ({ ...thread(index), providerResources: ['inbox'] as const }));
    await store.save({ ...template, threads });
    fixture.statements.length = 0;
    const journal = { commands: [], undo: null, pendingThreadIntents: threads.slice(0, 420).map(item => ({
      accountId: item.accountId, threadId: item.threadId, commandId: `local_${item.threadId}`, patch: { providerResources: ['sent'] as const },
    })) };
    const first = await store.queryThreads({ split: 'sent', journal });
    const second = await store.queryThreads({ split: 'sent', journal, after: first.next });
    expect([...first.threads, ...second.threads].map(item => item.threadId)).toEqual(threads.slice(0, 200).map(item => item.threadId));
    expect(fixture.statements.length).toBeLessThanOrEqual(20);
    expect(fixture.statements.every(sql => (sql.match(/\?/g) ?? []).length <= 900)).toBe(true);
  });

  it('lets navigation read once its snapshot is saved while later history writes continue', async () => {
    rs.useFakeTimers();
    let releaseFirst!: () => void;
    let releaseLater!: () => void;
    const first = new Promise<void>(resolve => { releaseFirst = resolve; });
    const later = new Promise<void>(resolve => { releaseLater = resolve; });
    const written: string[] = [];
    const queue = new MailPersistenceQueue(async state => {
      written.push(state.selectedThreadKey!);
      await (written.length === 1 ? first : later);
    });
    try {
      queue.request({ ...template, selectedThreadKey: 'navigation' });
      let ready = false;
      const navigation = queue.flushCurrent().then(() => { ready = true; });
      queue.request({ ...template, selectedThreadKey: 'later_history' });
      let drained = false;
      const shutdown = queue.flush().then(() => { drained = true; });
      releaseFirst();
      await rs.advanceTimersByTimeAsync(0);
      expect(written).toEqual(['navigation', 'later_history']);
      expect(ready).toBe(true);
      expect(drained).toBe(false);
      await navigation;
      releaseLater();
      await shutdown;
      expect(drained).toBe(true);
    } finally {
      releaseFirst();
      releaseLater();
      await queue.flush();
      rs.useRealTimers();
    }
  });

  it('includes the pending navigation snapshot when another write is already running', async () => {
    rs.useFakeTimers();
    const releases: (() => void)[] = [];
    const written: string[] = [];
    const queue = new MailPersistenceQueue(async state => {
      written.push(state.selectedThreadKey!);
      await new Promise<void>(resolve => { releases.push(resolve); });
    });
    try {
      queue.request({ ...template, selectedThreadKey: 'first' });
      const first = queue.flushCurrent();
      queue.request({ ...template, selectedThreadKey: 'navigation' });
      let ready = false;
      const navigation = queue.flushCurrent().then(() => { ready = true; });
      queue.request({ ...template, selectedThreadKey: 'coalesced_navigation' });
      releases[0]!();
      await rs.advanceTimersByTimeAsync(0);
      await first;
      expect(ready).toBe(false);
      expect(written).toEqual(['first', 'coalesced_navigation']);
      queue.request({ ...template, selectedThreadKey: 'future_history' });
      releases[1]!();
      await rs.advanceTimersByTimeAsync(0);
      expect(ready).toBe(true);
      expect(written).toEqual(['first', 'coalesced_navigation', 'future_history']);
      await navigation;
    } finally {
      for (const release of releases) release();
      await queue.flush();
      rs.useRealTimers();
    }
  });

  it('rejects waiting reads on a write failure and permits a later retry', async () => {
    const write = rs.fn<(state: MailState) => Promise<void>>()
      .mockRejectedValueOnce(new Error('device unavailable'))
      .mockResolvedValue(undefined);
    const queue = new MailPersistenceQueue(write);
    queue.request(template);
    await expect(queue.flushCurrent()).rejects.toThrow('device unavailable');
    await queue.flush().catch(() => undefined);
    await expect(queue.flushCurrent()).rejects.toThrow('device unavailable');
    queue.request(template);
    await queue.flushCurrent();
    await queue.flush();
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('persists an update requested as a read barrier completes', async () => {
    rs.useFakeTimers();
    const written: string[] = [];
    const queue = new MailPersistenceQueue(async state => { written.push(state.selectedThreadKey!); });
    try {
      queue.request({ ...template, selectedThreadKey: 'first' });
      await queue.flushCurrent();
      queue.request({ ...template, selectedThreadKey: 'after_read' });
      await rs.advanceTimersByTimeAsync(250);
      expect(written).toEqual(['first', 'after_read']);
    } finally {
      await queue.flush();
      rs.useRealTimers();
    }
  });

  it('recovers a single record larger than the native SQLite row limit using bounded parts', async () => {
    // Exercise the real SQLite 16 MiB limit, not only a transport-size mock.
    const result = execFileSync('python3', ['-c', `
import sqlite3
c = sqlite3.connect(':memory:')
c.setlimit(sqlite3.SQLITE_LIMIT_LENGTH, 16 * 1024 * 1024)
c.execute('CREATE TABLE chunks (part INTEGER PRIMARY KEY, value TEXT)')
s = 'x' * (18 * 1024 * 1024)
try:
 c.execute('INSERT INTO chunks VALUES (0, ?)', (s,))
 raise AssertionError('oversize row accepted')
except sqlite3.DataError:
 pass
for i in range(0, len(s), 65536): c.execute('INSERT INTO chunks VALUES (?, ?)', (i, s[i:i+65536]))
assert ''.join(r[0] for r in c.execute('SELECT value FROM chunks ORDER BY part')) == s
print('bounded rows recovered')
`], { encoding: 'utf8' });
    expect(result.trim()).toBe('bounded rows recovered');
    const fixture = sqliteStoreFixture();
    await new ProfileSqliteMailStore(fixture.profile).load();
    const draft = { text: '😀'.repeat(4_500_000) };
    await fixture.database.transaction(tx => writeRecord(tx, 'local_mail_journal', 'draft', '', '', 'large', draft));
    const restored = await readRecord<typeof draft>(fixture.database, 'local_mail_journal', 'draft', '', '', 'large');
    expect(restored?.text === draft.text).toBe(true);
  });
  it('prevents continuous updates from starving journal persistence', async () => {
    rs.useFakeTimers();
    const written: string[] = [];
    const queue = new MailPersistenceQueue(async state => { written.push(state.selectedThreadKey!); });
    try {
      for (let index = 0; index < 10; index++) {
        queue.request({ ...template, selectedThreadKey: `state_${index}` });
        await rs.advanceTimersByTimeAsync(50);
      }
      expect(written).toEqual(['state_4', 'state_9']);
      await queue.flush();
    } finally { rs.useRealTimers(); }
  });

  it.each([
    ['page', false], ['page', true], ['refresh', false], ['refresh', true],
  ] as const)('preserves newer provider data through delayed UI saves (%s, shared settings: %s)', async (mode, shared) => {
    const fixture = sqliteStoreFixture();
    const store = new ProfileSqliteMailStore(fixture.profile);
    const old = { ...thread(0), attentionCorrection: { critical: true, correctedAt: '2030-01-01T00:00:00Z' } };
    const correction = { critical: false, correctedAt: '2026-09-27T00:00:00Z' };
    await store.save({ ...template, threads: [old] });
    if (shared) await store.applySharedState({ corrections: { [JSON.stringify([old.accountId, old.threadId])]: correction } });
    await commitProviderThreads(store, [{ ...old, providerRevision: 'new_revision', subject: 'Fresh subject' }], mode);
    await store.saveCache({ ...template, threads: [{ ...old, messages: [{ ...old.messages[0]!, bodyText: 'Late detail' }] }] });
    expect((await store.queryThreads({})).threads[0]?.subject).toBe('Fresh subject');
    const loaded = await store.loadThread(old.accountId, old.threadId);
    expect(loaded?.providerRevision).toBe('new_revision');
    expect(loaded?.attentionCorrection).toEqual(shared ? correction : old.attentionCorrection);
    expect(loaded?.messages[0]?.bodyText).toBe('');
  });

  it('merges recovered commands and receipt history with actions created while opening failed', () => {
    const saved = withCommand(template, 'saved');
    const current = withCommand(template, 'new');
    const recovered = recoverMailJournal(current, saved);
    expect(recovered.commands.map(command => command.commandId)).toEqual(['saved', 'new']);
    expect(recoverMailJournal(recovered, saved).commands).toEqual(recovered.commands);
  });

  it('wipes every historical record, even those outside the loaded window', async () => {
    const fixture = sqliteStoreFixture();
    const store = new ProfileSqliteMailStore(fixture.profile);
    await store.save({ ...template, threads: Array.from({ length: 201 }, (_, index) => thread(index)) });
    expect((await store.load())?.threads).toHaveLength(100);
    const receipt = await store.wipeAccount(thread(0).accountId);
    expect(receipt.removed.threads).toBe(201);
    expect((await store.queryThreads({})).threads).toEqual([]);
    expect(fixture.sqlite.prepare("SELECT COUNT(*) AS n FROM local_mail_records WHERE kind = 'thread'").get()?.n).toBe(0);
  });

});
