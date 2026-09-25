import { describe, expect, it, rs } from '@rstest/core';
import { execFileSync } from 'node:child_process';
import { ProfileSqliteMailStore } from './local-store';
import { CommandPersistenceBarrier } from './command-persistence-barrier';
import { MailPersistenceQueue, persistCommandSnapshot, recoverMailJournal } from './mail-persistence';
import { boundMailWindow, diskBodyBudgetBytes, mailWindowSize, memoryBodyBudgetBytes, readRecord, writeRecord } from './bounded-mail-replica';
import { maximumRecordPartBytes, maximumSqlRequestBytes, recordParts, serializedBytes } from './bounded-sql';
import { composeMessage, emptyMailState, previewMailState, settleMailCommand, type EmailThread, type MailState } from './domain';
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

describe('bounded durable mail persistence', () => {
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

  it('does not overwrite a newer provider page with a delayed UI save', async () => {
    const fixture = sqliteStoreFixture();
    const store = new ProfileSqliteMailStore(fixture.profile);
    const old = thread(0);
    await store.save({ ...template, threads: [old] });
    const checkpoint = await store.beginMailboxSync();
    await store.commitMailboxPage(checkpoint, { schemaVersion: 1, accounts: template.accounts,
      threads: [{ ...old, providerRevision: 'new_revision', subject: 'Fresh subject' }] }, null);
    await store.saveCache({ ...template, threads: [{ ...old, messages: [{ ...old.messages[0]!, bodyText: 'Late detail' }] }] });
    expect((await store.queryThreads({})).threads[0]?.subject).toBe('Fresh subject');
    expect((await store.loadThread(old.accountId, old.threadId))?.providerRevision).toBe('new_revision');
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
