import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeBase64Url, openSecret, sealSecret } from '../src/crypto';
import { listBodyCoverage, setBodyBackfill, processBodyBackfill, enqueueBodyBackfills } from '../src/body-backfill';
import { createTapEmailCoordinator } from '../src/index';
import { getEmailThread, readEmailMessages } from '../src/mcp-mail';

const now = new Date('2026-09-27T12:00:00Z');
const profileId = 'body_profile', accountId = 'body_account', threadId = 'body_thread';
const refs = { accountId, threadId };
async function credential() {
  const token = await sealSecret('access-test', env.GOOGLE_TOKEN_ENCRYPTION_KEY);
  await env.DB.prepare(`INSERT INTO google_credentials(profile_id,account_id,refresh_token_ciphertext,access_token_ciphertext,access_token_expires_at,granted_scopes,created_at,updated_at)
    VALUES (?,?,?,?,?,'gmail.modify',?,?)`).bind(profileId, accountId, token, token, '2026-09-28T00:00:00Z', now.toISOString(), now.toISOString()).run();
}
async function addMessages(count: number, state = 'metadata') {
  const empty = await sealSecret('', env.GOOGLE_TOKEN_ENCRYPTION_KEY);
  await env.DB.batch(Array.from({ length: count }, (_, n) => env.DB.prepare(`INSERT INTO mail_messages
    (profile_id,account_id,thread_id,message_id,sender_json,recipients_json,sent_at,body_text_ciphertext,body_html_ciphertext,ordinal,updated_at,body_state)
    VALUES (?,?,?,?,'{"address":"sender@example.com","name":"Sender"}','[]',?,?,?, ?,?,?)`)
    .bind(profileId, accountId, threadId, `msg_${n}`, now.toISOString(), empty, empty, n, now.toISOString(), state)));
}
function rawMessage(id: string, text = `History body ${id}`) {
  return { id, threadId, historyId: 'revision_1', internalDate: String(now.getTime()), labelIds: ['INBOX'],
    payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: 'sender@example.com' }, { name: 'Subject', value: 'History' }], body: { data: encodeBase64Url(text) } } };
}
function googleBodies(handler?: (id: string) => Response | Promise<Response>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const id = url.pathname.split('/').at(-1)!;
    if (url.pathname.includes('/messages/')) return handler ? handler(id) : Response.json(rawMessage(id));
    if (url.pathname.endsWith(`/threads/${threadId}`)) return Response.json({ id: threadId, historyId: 'revision_1', messages: [rawMessage('msg_0')] });
    throw new Error(`Unexpected fixture request: ${url.pathname}`);
  });
}
async function generation() {
  return (await env.DB.prepare('SELECT generation FROM mail_body_backfills WHERE profile_id = ? AND account_id = ?').bind(profileId, accountId).first<string>('generation'))!;
}
const run = async (g?: string) => processBodyBackfill(env, { profileId, accountId, mode: 'bodies', syncGeneration: g ?? await generation() }, now);

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM provider_events').run();
  await env.DB.prepare('DELETE FROM google_accounts').run();
  await env.DB.prepare(`INSERT INTO google_accounts(profile_id,account_id,google_subject,email_address,connection_state,coverage_state,unresolved_failures,created_at,updated_at)
    VALUES (?,?,?,'owner@example.com','active','current',0,?,?)`).bind(profileId, accountId, accountId, now.toISOString(), now.toISOString()).run();
  await env.DB.prepare(`INSERT INTO mail_threads(profile_id,account_id,thread_id,history_id,subject,snippet,participants_json,received_at,unread,starred,important,in_inbox,needs_response,waiting_on_others,label_ids_json,updated_at,content_state)
    VALUES (?,?,?,'revision_1','History','','[]',?,0,0,0,1,0,0,'[]',?,'full')`).bind(profileId, accountId, threadId, now.toISOString(), now.toISOString()).run();
  await credential();
});
afterEach(() => vi.restoreAllMocks());

describe('historical body access and backfill', () => {
  it('hydrates a never-opened exact message and distinguishes real empty bodies from unavailable ones', async () => {
    await addMessages(3);
    const fetch = googleBodies(id => id === 'msg_2'
      ? new Response('{}', { status: 404 }) : Response.json(rawMessage(id, id === 'msg_1' ? '' : 'Deadline changed to Monday.')));
    const result = await readEmailMessages(env, profileId, { ...refs, messageIds: ['msg_0', 'msg_1', 'msg_2'], maximumCharactersPerMessage: 1000 }, now);
    expect(result.messages.map(message => [message.bodyState, message.bodyText])).toEqual([
      ['available', 'Deadline changed to Monday.'], ['available', ''], ['unavailable', ''],
    ]);
    expect(result.coverage.warnings.join(' ')).toContain('do not interpret it as empty');
    expect(fetch).toHaveBeenCalledTimes(3);
    await readEmailMessages(env, profileId, { ...refs, messageIds: ['msg_0'], maximumCharactersPerMessage: 1000 }, now);
    expect(fetch).toHaveBeenCalledTimes(3);
    await expect(readEmailMessages(env, 'other_profile', { ...refs, messageIds: ['msg_0'], maximumCharactersPerMessage: 100 }, now)).rejects.toThrow('unavailable');
    await expect(readEmailMessages(env, profileId, { ...refs, messageIds: ['msg_0', 'missing'], maximumCharactersPerMessage: 100 }, now)).rejects.toThrow('not found');
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('enumerates all 120 message references and fences cursors by scope and source revision', async () => {
    await addMessages(120, 'ready');
    const ids: string[] = [];
    let cursor: string | null = null;
    let firstCursor = '';
    do {
      const result = await getEmailThread(env, profileId, { ...refs, cursor, limit: 50 }, now);
      ids.push(...result.messages.map(message => message.messageId));
      cursor = result.coverage.nextCursor;
      firstCursor ||= cursor ?? '';
    } while (cursor);
    expect(ids).toEqual(Array.from({ length: 120 }, (_, n) => `msg_${n}`));
    expect(new Set(ids).size).toBe(120);
    await expect(getEmailThread(env, profileId, { ...refs, cursor: firstCursor + 'tampered' }, now)).rejects.toThrow('cursor');
    await env.DB.prepare("UPDATE mail_threads SET history_id = 'revision_2' WHERE profile_id = ?").bind(profileId).run();
    await expect(getEmailThread(env, profileId, { ...refs, cursor: firstCursor }, now)).rejects.toThrow('changed');
  });

  it('preserves an actionable provider error when historical inventory cannot be read', async () => {
    await addMessages(1);
    await env.DB.prepare("UPDATE mail_threads SET content_state = 'metadata' WHERE profile_id = ?").bind(profileId).run();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 503 }));
    await expect(getEmailThread(env, profileId, refs, now)).rejects.toMatchObject({ code: 'google_temporarily_unavailable' });
  });

  it('bounds batches, resumes persisted work, excludes paused generations, and recovers lost jobs', async () => {
    await addMessages(20);
    const fetch = googleBodies();
    await setBodyBackfill(env, profileId, accountId, true, now);
    const first = await generation();
    await run(first);
    expect(fetch).toHaveBeenCalledTimes(8);
    expect((await listBodyCoverage(env, profileId))[0]).toMatchObject({ total: 20, downloaded: 8, pending: 12, unavailable: 0 });
    await setBodyBackfill(env, profileId, accountId, false, now);
    await run(first);
    expect(fetch).toHaveBeenCalledTimes(8);
    await setBodyBackfill(env, profileId, accountId, true, now);
    await env.DB.prepare('DELETE FROM provider_events').run();
    await enqueueBodyBackfills(env, now);
    await enqueueBodyBackfills(env, now);
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM provider_events').first('count')).toBe(1);
    await run(); await run();
    expect((await listBodyCoverage(env, profileId))[0]).toMatchObject({ downloaded: 20, pending: 0 });
    expect(fetch).toHaveBeenCalledTimes(20);
  });

  it('hydrates the full inventory of a metadata-only historical thread', async () => {
    await addMessages(1);
    await env.DB.prepare("UPDATE mail_threads SET content_state = 'metadata' WHERE profile_id = ?").bind(profileId).run();
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      expect(url.searchParams.get('format')).toBe('full');
      return Response.json({ id: threadId, historyId: 'revision_1', messages: Array.from({ length: 5 }, (_, n) => rawMessage(`msg_${n}`)) });
    });
    await setBodyBackfill(env, profileId, accountId, true, now);
    await run();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await listBodyCoverage(env, profileId))[0]).toMatchObject({ total: 5, downloaded: 5, pending: 0, metadataThreads: 0 });
  });

  it('finishes an in-flight message without starting more work after pause', async () => {
    await addMessages(8);
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const fetch = googleBodies(async id => { entered(); await gate; return Response.json(rawMessage(id)); });
    await setBodyBackfill(env, profileId, accountId, true, now);
    const running = run();
    await started;
    await setBodyBackfill(env, profileId, accountId, false, now);
    release(); await running;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await listBodyCoverage(env, profileId))[0]).toMatchObject({ enabled: false, downloaded: 1, pending: 7 });
  });

  it('records unsupported bodies without blocking other messages and retries them explicitly', async () => {
    await addMessages(2);
    let oversized = true;
    googleBodies(id => id === 'msg_1' && oversized
      ? new Response('', { headers: { 'Content-Length': '3000000' } }) : Response.json(rawMessage(id)));
    await setBodyBackfill(env, profileId, accountId, true, now);
    await run();
    expect((await listBodyCoverage(env, profileId))[0]).toMatchObject({ downloaded: 1, unavailable: 1, pending: 0 });
    oversized = false;
    await setBodyBackfill(env, profileId, accountId, true, now);
    await run();
    expect((await listBodyCoverage(env, profileId))[0]).toMatchObject({ downloaded: 2, unavailable: 0 });
  });

  it('backs off transient provider errors without treating them as empty bodies', async () => {
    await addMessages(1);
    googleBodies(() => new Response('{}', { status: 503 }));
    await setBodyBackfill(env, profileId, accountId, true, now);
    await run();
    expect((await listBodyCoverage(env, profileId))[0]).toMatchObject({ downloaded: 0, pending: 1, errorCode: 'google_temporarily_unavailable' });
    await env.DB.prepare('DELETE FROM provider_events').run();
    await enqueueBodyBackfills(env, now);
    expect(await env.DB.prepare('SELECT COUNT(*) FROM provider_events').first('COUNT(*)')).toBe(0);
    await enqueueBodyBackfills(env, new Date(now.getTime() + 6 * 60_000));
    expect(await env.DB.prepare('SELECT COUNT(*) FROM provider_events').first('COUNT(*)')).toBe(1);
  });

  it('preserves hydrated content across same-revision metadata replay', async () => {
    await addMessages(1);
    googleBodies();
    await readEmailMessages(env, profileId, { ...refs, messageIds: ['msg_0'], maximumCharactersPerMessage: 100 }, now);
    await env.DB.prepare("UPDATE mail_threads SET content_state = 'metadata' WHERE profile_id = ?").bind(profileId).run();
    await getEmailThread(env, profileId, refs, now);
    const row = await env.DB.prepare('SELECT body_state, body_text_ciphertext FROM mail_messages WHERE profile_id = ?').bind(profileId).first<{ body_state: string; body_text_ciphertext: string }>();
    expect(row?.body_state).toBe('ready');
    expect(await openSecret(row!.body_text_ciphertext, env.GOOGLE_TOKEN_ENCRYPTION_KEY)).toBe('History body msg_0');
  });

  it('rejects a body fetched after the thread revision changes', async () => {
    await addMessages(1);
    googleBodies(async id => {
      await env.DB.prepare("UPDATE mail_threads SET history_id = 'revision_2' WHERE profile_id = ?").bind(profileId).run();
      return Response.json(rawMessage(id));
    });
    await expect(readEmailMessages(env, profileId, { ...refs, messageIds: ['msg_0'], maximumCharactersPerMessage: 100 }, now)).rejects.toThrow('changed');
    expect(await env.DB.prepare('SELECT body_state FROM mail_messages WHERE profile_id = ?').bind(profileId).first('body_state')).toBe('metadata');
  });

  it('scopes the HTTP controls to the authenticated profile', async () => {
    await addMessages(1);
    const worker = createTapEmailCoordinator({ verifyAccess: async () => ({ profileId }), now: () => now });
    const other = await worker.fetch(new Request('https://coordinator.example/v1/accounts/other_account/body-backfill', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"enabled":true}',
    }), env);
    expect(other.status).toBe(404);
    const own = await worker.fetch(new Request(`https://coordinator.example/v1/accounts/${accountId}/body-backfill`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"enabled":true}',
    }), env);
    expect(own.status).toBe(200);
    expect(await own.json()).toMatchObject({ accounts: [{ accountId, enabled: true, pending: 1 }] });
  });
});
