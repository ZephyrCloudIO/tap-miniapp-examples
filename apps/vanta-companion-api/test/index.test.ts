import { env } from 'cloudflare:workers';
import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker, { createVantaCompanionWorker } from '../src/index';

const secret = 'whsec_dGVzdC13ZWJob29rLXNlY3JldC0zMi1ieXRlcy1sb25n';
const authorizedWorker = createVantaCompanionWorker({
  verifyAccess: async () => ({ sub: 'fixture-user' }),
});

async function signature(
  body: string,
  messageId: string,
  timestamp: string,
): Promise<string> {
  const keyBytes = Uint8Array.from(atob(secret.slice(6)), character =>
    character.charCodeAt(0),
  );
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(`${messageId}.${timestamp}.${body}`),
    ),
  );
  let binary = '';
  for (const byte of digest) binary += String.fromCharCode(byte);
  return `v1,${btoa(binary)}`;
}

async function webhookRequest(
  body: string,
  messageId: string,
  timestamp = String(Math.floor(Date.now() / 1000)),
): Promise<Response> {
  const request = new Request('https://api.example/v1/webhooks/vanta', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'svix-id': messageId,
      'svix-timestamp': timestamp,
      'svix-signature': await signature(body, messageId, timestamp),
    },
    body,
  });
  const response = await worker.fetch(request, env);
  return response;
}

beforeEach(async () => {
  await env.EVENTS.prepare('DELETE FROM webhook_events').run();
});

describe('Vanta webhook receiver', () => {
  it('verifies and durably stores a real request body', async () => {
    const body = JSON.stringify({ type: 'control.updated', createdAt: new Date().toISOString() });
    const response = await webhookRequest(body, 'msg-runtime-1');

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      accepted: true,
      duplicate: false,
      messageId: 'msg-runtime-1',
    });
    const row = await env.EVENTS.prepare(
      'SELECT message_id, event_type, payload_json FROM webhook_events',
    ).first<{ message_id: string; event_type: string; payload_json: string }>();
    expect(row).toEqual({
      message_id: 'msg-runtime-1',
      event_type: 'control.updated',
      payload_json: body,
    });
  });

  it('acknowledges a replay without inserting a duplicate', async () => {
    const body = JSON.stringify({ type: 'test.updated' });
    expect((await webhookRequest(body, 'msg-replay')).status).toBe(202);
    const replay = await webhookRequest(body, 'msg-replay');

    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ duplicate: true });
    const count = await env.EVENTS.prepare(
      'SELECT COUNT(*) AS count FROM webhook_events WHERE message_id = ?',
    )
      .bind('msg-replay')
      .first<number>('count');
    expect(count).toBe(1);
  });

  it('rejects an invalid signature and stores nothing', async () => {
    const response = await worker.fetch(
      new Request('https://api.example/v1/webhooks/vanta', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'svix-id': 'msg-invalid',
          'svix-timestamp': String(Math.floor(Date.now() / 1000)),
          'svix-signature': 'v1,aW52YWxpZA==',
        },
        body: JSON.stringify({ type: 'test.updated' }),
      }),
      env,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_signature' });
  });

  it('rejects a correctly signed stale delivery', async () => {
    const stale = String(Math.floor(Date.now() / 1000) - 301);
    const response = await webhookRequest(
      JSON.stringify({ type: 'test.updated' }),
      'msg-stale',
      stale,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_signature' });
  });

  it('requires Cloudflare Access for the event feed', async () => {
    const response = await worker.fetch(
      new Request('https://api.example/v1/events', {
        headers: { Origin: 'http://localhost:3000' },
      }),
      env,
    );
    expect(response.status).toBe(401);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      'http://localhost:3000',
    );
    expect(await response.json()).toMatchObject({
      error: 'access_login_required',
    });
  });

  it('returns a successful Access session with exact-origin CORS', async () => {
    const response = await authorizedWorker.fetch(
      new Request('https://api.example/v1/session', {
        headers: { Origin: 'http://localhost:3000' },
      }),
      env,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      'http://localhost:3000',
    );
    expect(await response.json()).toEqual({
      authenticated: true,
      subject: 'fixture-user',
      workspaceId: env.WORKSPACE_ID,
      webhookReceiver: true,
    });
  });

  it('paginates the authorized event feed without losing a boundary row', async () => {
    for (const row of [
      ['msg-page-1', 'control.updated', '2026-07-24T12:00:00.000Z'],
      ['msg-page-2', 'test.updated', '2026-07-24T12:00:01.000Z'],
    ] as const) {
      await env.EVENTS.prepare(
        `INSERT INTO webhook_events
          (message_id, workspace_id, event_type, occurred_at, received_at, payload_json)
          VALUES (?, ?, ?, ?, ?, ?)`,
      )
        .bind(row[0], env.WORKSPACE_ID, row[1], null, row[2], '{}')
        .run();
    }

    const first = await authorizedWorker.fetch(
      new Request('https://api.example/v1/events?limit=1', {
        headers: { Origin: 'http://localhost:3000' },
      }),
      env,
    );
    const firstPage = await first.json<{
      events: Array<{ id: string }>;
      nextCursor: string;
      hasMore: boolean;
    }>();
    expect(firstPage.events.map(event => event.id)).toEqual(['msg-page-1']);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.nextCursor).toMatch(/\S/u);

    const second = await authorizedWorker.fetch(
      new Request(
        `https://api.example/v1/events?limit=1&cursor=${encodeURIComponent(firstPage.nextCursor)}`,
        { headers: { Origin: 'http://localhost:3000' } },
      ),
      env,
    );
    const secondPage = await second.json<{
      events: Array<{ id: string }>;
      hasMore: boolean;
    }>();
    expect(secondPage.events.map(event => event.id)).toEqual(['msg-page-2']);
    expect(secondPage.hasMore).toBe(false);
  });

  it('denies an authenticated request from an unconfigured origin', async () => {
    const response = await authorizedWorker.fetch(
      new Request('https://api.example/v1/events', {
        headers: { Origin: 'https://untrusted.example' },
      }),
      env,
    );
    expect(response.status).toBe(403);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(await response.json()).toMatchObject({ error: 'origin_denied' });
  });

  it('rejects oversized message IDs before persistence', async () => {
    const body = JSON.stringify({ type: 'test.updated' });
    const response = await webhookRequest(body, `msg-${'x'.repeat(252)}`);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_message_id' });
  });

  it('removes events beyond the configured retention window', async () => {
    await env.EVENTS.prepare(
      `INSERT INTO webhook_events
        (message_id, workspace_id, event_type, occurred_at, received_at, payload_json)
        VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        'msg-old',
        env.WORKSPACE_ID,
        'old.event',
        null,
        '2020-01-01T00:00:00.000Z',
        '{}',
      )
      .run();
    const ctx = createExecutionContext();
    await worker.scheduled(
      createScheduledController({ cron: '17 3 * * *' }),
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(
      await env.EVENTS.prepare(
        'SELECT message_id FROM webhook_events WHERE message_id = ?',
      )
        .bind('msg-old')
        .first(),
    ).toBeNull();
  });
});
