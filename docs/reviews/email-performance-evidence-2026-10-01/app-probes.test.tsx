/** @rstest-environment jsdom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, rs } from '@rstest/core';
import { PagedThreadMessages } from './paged-thread-messages';
import { previewMailState, emailThreadKey, markDone, selectedThread } from './domain';
import { ProfileSqliteMailStore } from './local-store';
import { sqliteStoreFixture } from './sqlite-store-fixture';
import type { ThreadPage } from './coordinator-client';
import { RichMessageBody } from './rich-message';
import { appendFileSync } from 'node:fs';
import { ProfileSqliteEmailActivityLedger } from './activity-ledger';
import { publishEmailActivityProjection } from './storage';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const seed = previewMailState();
const source = seed.threads[0]!;
const hydrated = { ...source, messages: [{ ...source.messages[0]!, bodyText: 'Complete body', bodyHtml: '<p>Complete body</p>' }] };
const defaults = {
  accountId: source.accountId, threadId: source.threadId, providerRevision: source.providerRevision,
  appTheme: 'dark' as const, attachmentExportSupported: false, imagesEnabled: false,
  trackingPixelsEnabled: false, htmlEnabled: false, scriptsEnabled: false,
  loadAttachment: null, loadRemoteImages: async () => ({}), onKeyDown: () => {},
  saveAttachment: async () => 'saved' as const,
};
const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

describe('temporary performance review probes', () => {
  it('requests the server on every cached A B A revisit', async () => {
    const result: ThreadPage = { messages: hydrated.messages, providerRevision: source.providerRevision, nextCursor: null, complete: true };
    const client = { getThreadPage: rs.fn(async () => result) };
    const root = createRoot(document.createElement('div'));
    try {
      for (const threadId of ['A', 'B', 'A']) await act(async () => root.render(
        <PagedThreadMessages {...defaults} key={threadId} threadId={threadId} client={client}
          messages={hydrated.messages} onMessages={() => {}} />));
      expect(client.getThreadPage).toHaveBeenCalledTimes(3);
      console.log('REVIEW: cached A B A = 3 server requests');
    } finally { await act(async () => root.unmount()); }
  });

  it('leaves superseded server requests running', async () => {
    const resolves: ((page: ThreadPage) => void)[] = [];
    const client = { getThreadPage: rs.fn(() => new Promise<ThreadPage>(resolve => resolves.push(resolve))) };
    const onMessages = rs.fn();
    const root = createRoot(document.createElement('div'));
    try {
      for (const threadId of ['A', 'B', 'C']) await act(async () => root.render(
        <PagedThreadMessages {...defaults} key={threadId} threadId={threadId} client={client}
          messages={[]} onMessages={onMessages} />));
      expect(client.getThreadPage).toHaveBeenCalledTimes(3);
      expect(onMessages).not.toHaveBeenCalled();
      await act(async () => resolves.forEach(resolve => resolve({ messages: hydrated.messages,
        providerRevision: source.providerRevision, nextCursor: null, complete: true })));
      expect(onMessages).toHaveBeenCalledTimes(1);
      console.log('REVIEW: rapid A B C = 3 outstanding requests, only C publishes');
    } finally { await act(async () => root.unmount()); }
  });

  it('blocks a disk body cache hit on its timestamp write', async () => {
    const fixture = sqliteStoreFixture();
    const store = new ProfileSqliteMailStore(fixture.profile);
    await store.save({ ...seed, threads: [hydrated] });
    fixture.statements.length = 0;
    const gate = fixture.pauseOnce(sql => sql.startsWith('UPDATE local_mail_bodies SET last_accessed_at'));
    let returned = false;
    const read = store.loadThread(source.accountId, source.threadId).then(value => { returned = true; return value; });
    await gate.entered;
    try {
      await tick();
      expect(returned).toBe(false);
      expect(fixture.statements).toHaveLength(4);
      console.log(`REVIEW: disk body hit = ${fixture.statements.length} SQL operations; waits for timestamp UPDATE`);
    } finally { gate.release(); }
    expect((await read)?.messages[0]?.bodyHtml).toBe('<p>Complete body</p>');
    await store.close(); fixture.sqlite.close();
  });

  it('does not let a body read interrupt an active 100 row refresh', async () => {
    const fixture = sqliteStoreFixture();
    const store = new ProfileSqliteMailStore(fixture.profile);
    const threads = Array.from({ length: 130 }, (_, index) => ({ ...hydrated,
      threadId: `review_${index}`, receivedAt: new Date(Date.UTC(2026, 0, 1) - index * 60_000).toISOString() }));
    await store.save({ ...seed, threads });
    fixture.statements.length = 0;
    let read: ReturnType<typeof store.loadThread> | undefined;
    let returned = false;
    let gate: ReturnType<typeof fixture.pauseOnce> | undefined;
    const windowRead = store.queryThreads({ journal: { commands: [], undo: null }, onProgress: rows => {
      if (rows.length !== 20 || read) return;
      read = store.loadThread(threads[0]!.accountId, threads[0]!.threadId).then(value => { returned = true; return value; });
      gate = fixture.pauseOnce(sql => sql.includes("kind IN ('thread', 'message')"));
    } });
    while (!gate) await tick();
    await gate.entered;
    try { await tick(); expect(returned).toBe(false); }
    finally { gate.release(); }
    await windowRead; await read;
    expect(fixture.statements).toHaveLength(12);
    console.log(`REVIEW: body request after first 20 rows starts only after full window read; ${fixture.statements.length} total operations`);
    await store.close(); fixture.sqlite.close();
  });

  it('loses a body cache hit when only label revision changes', async () => {
    const fixture = sqliteStoreFixture();
    const store = new ProfileSqliteMailStore(fixture.profile);
    await store.save({ ...seed, threads: [hydrated] });
    expect((await store.loadThread(source.accountId, source.threadId))?.messages[0]?.bodyHtml).toBe('<p>Complete body</p>');
    await store.commitMailboxRefresh({ schemaVersion: 1, accounts: seed.accounts, threads: [{ ...hydrated,
      unread: false, providerRevision: 'label_revision_only', messages: hydrated.messages.map(({ bodyHtml: _html, ...message }) => ({ ...message, bodyText: '' })) }] });
    const after = await store.loadThread(source.accountId, source.threadId);
    expect(after?.messages[0]?.bodyHtml).toBeUndefined();
    expect(after?.messages[0]?.bodyText).toBe('');
    console.log('REVIEW: unchanged message identity + changed label revision = disk body miss');
    await store.close(); fixture.sqlite.close();
  });

  it('advances Done synchronously while the next body is absent', () => {
    const threads = [0, 1].map(index => ({ ...source, threadId: `done_${index}`,
      receivedAt: new Date(Date.UTC(2026, 0, 1) - index * 60_000).toISOString(),
      messages: [{ ...source.messages[0]!, messageId: `done_message_${index}`, bodyText: '', bodyHtml: undefined }] }));
    const before = { ...seed, selectedAccountId: 'all', selectedSplit: 'inbox' as const,
      threads, selectedThreadKey: emailThreadKey(threads[0]!) };
    const after = markDone(before, 'review_done', '2026-10-01T12:00:00Z');
    expect(selectedThread(after)?.threadId).toBe('done_1');
    expect(selectedThread(after)?.messages[0]?.bodyText).toBe('');
    console.log('REVIEW: Done immediately selects next metadata; next body is still empty');
  });

  it('records repeated HTML parsing even with images and scripts disabled', async () => {
    const html = '<p>A synthetic cached HTML message.</p>';
    const parse = rs.spyOn(DOMParser.prototype, 'parseFromString');
    const root = createRoot(document.createElement('div'));
    try {
      await act(async () => root.render(<RichMessageBody html={html} imagesEnabled={false}
        scriptsEnabled={false} title="Synthetic review" />));
      const directParses = parse.mock.calls.filter(call => call[0] === html).length;
      expect(directParses).toBeGreaterThanOrEqual(5);
      appendFileSync('/tmp/tap-email-review-metrics.jsonl', JSON.stringify({
        probe: 'html_mount_without_images_or_scripts', directParses,
        totalDOMParserCalls: parse.mock.calls.length,
      }) + '\n');
    } finally { parse.mockRestore(); await act(async () => root.unmount()); }
  });

  it('publishes a newer first page using the older metadata revision', async () => {
    const client = { getThreadPage: rs.fn(async () => ({ messages: hydrated.messages,
      providerRevision: 'newer_revision', nextCursor: null, complete: true })) };
    const onMessages = rs.fn();
    const root = createRoot(document.createElement('div'));
    try {
      await act(async () => root.render(<PagedThreadMessages {...defaults} client={client}
        messages={[]} onMessages={onMessages} />));
      expect(onMessages).toHaveBeenCalledWith(source.accountId, source.threadId,
        hydrated.messages, source.providerRevision);
      expect(source.providerRevision).not.toBe('newer_revision');
    } finally { await act(async () => root.unmount()); }
  });

  it('measures 100 genuine SQLite cached reads without host IPC', async () => {
    const fixture = sqliteStoreFixture();
    const store = new ProfileSqliteMailStore(fixture.profile);
    const large = { ...hydrated, messages: [{ ...hydrated.messages[0]!, bodyHtml: '<p>' + 'x'.repeat(32768) + '</p>' }] };
    await store.save({ ...seed, threads: [large] });
    await store.loadThread(source.accountId, source.threadId);
    fixture.statements.length = 0;
    const samples: number[] = [];
    for (let index=0; index<100; index++) {
      const start=performance.now();
      const result=await store.loadThread(source.accountId, source.threadId);
      samples.push(performance.now()-start);
      expect(result?.messages[0]?.bodyHtml?.length).toBe(32775);
    }
    appendFileSync('/tmp/tap-email-six-pass-2026-10-01/local-sqlite.jsonl',JSON.stringify({scope:'Node SQLite :memory:, source store, 32KiB HTML, no host IPC',samples,sqlStatements:fixture.statements.length})+'\n');
    await store.close(); fixture.sqlite.close();
  });

  it('counts background activity work for ten selected-thread changes', async () => {
    const fixture=sqliteStoreFixture();
    const ledger=new ProfileSqliteEmailActivityLedger(fixture.profile);
    await ledger.snapshot();
    fixture.statements.length=0;
    let gets=0,sets=0;
    const storage={get:async()=>{gets++;return {revision:null,value:null};},set:async()=>{sets++;return {revision:sets};}};
    for(let i=0;i<10;i++) {
      const projection=await ledger.recordView('view_'+i,new Date(Date.now()+i).toISOString());
      await publishEmailActivityProjection(projection,'synthetic_user',storage);
    }
    expect(gets).toBe(10);expect(sets).toBe(10);expect(fixture.statements).toHaveLength(60);
    appendFileSync('/tmp/tap-email-six-pass-2026-10-01/activity-counts.json',JSON.stringify({selectedThreadChanges:10,localSqlStatements:fixture.statements.length,sharedStorageGets:gets,sharedStorageSets:sets}));
    await ledger.close();fixture.sqlite.close();
  });

  it('records the actual account-scoped list query plan', async () => {
    const fixture=sqliteStoreFixture();
    const store=new ProfileSqliteMailStore(fixture.profile);
    await store.save({...seed,threads:[hydrated]});
    const query=fixture.database.query.bind(fixture.database);
    const plans: unknown[]=[];
    fixture.database.query=async(sql,params=[])=>{
      if(sql.startsWith('WITH candidates')) plans.push(fixture.sqlite.prepare('EXPLAIN QUERY PLAN '+sql).all(...params));
      return query(sql,params);
    };
    await store.queryThreads({accountId:source.accountId,split:'inbox',journal:{commands:[],undo:null}});
    expect(plans.length).toBeGreaterThan(0);
    appendFileSync('/tmp/tap-email-six-pass-2026-10-01/sqlite-query-plan.json',JSON.stringify(plans));
    await store.close();fixture.sqlite.close();
  });

  it('counts ten backend body requests for ten already hydrated mounts',async()=>{
    const client={getThreadPage:rs.fn(async()=>({messages:hydrated.messages,providerRevision:source.providerRevision,nextCursor:null,complete:true}))};
    const root=createRoot(document.createElement('div'));
    try{
      for(let i=0;i<10;i++)await act(async()=>root.render(<PagedThreadMessages {...defaults} key={i} threadId={i%2?'B':'A'} client={client} messages={hydrated.messages} onMessages={()=>{}}/>));
      expect(client.getThreadPage).toHaveBeenCalledTimes(10);
      appendFileSync('/tmp/tap-email-six-pass-2026-10-01/reader-request-count.json',JSON.stringify({hydratedConversationMounts:10,backendBodyRequests:client.getThreadPage.mock.calls.length}));
    }finally{await act(async()=>root.unmount());}
  });
});
