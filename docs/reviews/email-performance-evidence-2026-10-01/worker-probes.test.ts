import { env } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';
import { sealSecret } from '../src/crypto';
import { threadSnapshot } from '../src/mailbox';

describe('temporary coordinator performance review probes', () => {
  it('runs 43 D1 preparations for a cached 20 message conversation', async () => {
    const now = new Date('2026-10-01T12:00:00Z');
    const scope = ['review_profile', 'review_account'];
    await env.DB.prepare(`INSERT INTO google_accounts
      (profile_id, account_id, google_subject, connection_state, coverage_state,
       unresolved_failures, email_address, created_at, updated_at)
      VALUES (?, ?, 'review_subject', 'active', 'current', 0, 'synthetic@example.com', ?, ?)`)
      .bind(...scope, now.toISOString(), now.toISOString()).run();
    await env.DB.prepare(`INSERT INTO mail_threads
      (profile_id, account_id, thread_id, history_id, subject, snippet, participants_json, received_at,
       unread, starred, important, in_inbox, needs_response, waiting_on_others, label_ids_json, updated_at, content_state)
      VALUES (?, ?, 'review_thread', 'h1', 'Synthetic', '', '[]', ?, 0, 0, 0, 1, 0, 0, '[]', ?, 'full')`)
      .bind(...scope, now.toISOString(), now.toISOString()).run();
    const text = await sealSecret('Cached synthetic text', env.GOOGLE_TOKEN_ENCRYPTION_KEY);
    const html = await sealSecret('<p>Cached synthetic HTML</p>', env.GOOGLE_TOKEN_ENCRYPTION_KEY);
    for (let ordinal = 0; ordinal < 20; ordinal++) await env.DB.prepare(`INSERT INTO mail_messages
      (profile_id, account_id, thread_id, message_id, sender_json, recipients_json, sent_at,
       body_text_ciphertext, body_html_ciphertext, ordinal, updated_at, body_state)
      VALUES (?, ?, 'review_thread', ?, '{"name":"Synthetic","address":"sender@example.com"}', '[]', ?, ?, ?, ?, ?, 'ready')`)
      .bind(...scope, `review_message_${ordinal}`, now.toISOString(), text, html, ordinal, now.toISOString()).run();
    const calls: string[] = [];
    const database = new Proxy(env.DB, { get(target, property) {
      if (property === 'prepare') return (sql: string) => { calls.push(sql); return target.prepare(sql); };
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No provider reads expected'));
    try {
      const page = await threadSnapshot({ ...env, DB: database }, scope[0]!, scope[1]!, 'review_thread', now);
      expect(page?.messages).toHaveLength(20);
      expect(fetch).not.toHaveBeenCalled();
      expect(calls).toHaveLength(43);
      calls.length = 0;
      const samples: number[] = [];
      for (let index=0; index<30; index++) {
        const start=performance.now();
        const repeat=await threadSnapshot({ ...env, DB: database },scope[0]!,scope[1]!, 'review_thread', now);
        samples.push(performance.now()-start);
        expect(repeat?.messages.length).toBe(20);
      }
      expect(samples).toHaveLength(30);
      expect(calls).toHaveLength(1290);
      expect(calls.filter(sql => sql.includes('FROM mail_attachments'))).toHaveLength(600);
      console.log('REVIEW: cached 20 messages = 43 D1 queries, 20 separate attachment queries, 0 provider fetches');
    } finally { fetch.mockRestore(); }
  });
});
