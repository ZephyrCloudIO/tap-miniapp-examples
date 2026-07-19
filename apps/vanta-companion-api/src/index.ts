import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import {
  verifyVantaWebhookSignature,
  WebhookVerificationError,
} from './webhook';

const MAX_WEBHOOK_BYTES = 1_048_576;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

interface StoredEventRow {
  readonly message_id: string;
  readonly event_type: string;
  readonly occurred_at: string | null;
  readonly received_at: string;
}

interface Cursor {
  readonly receivedAt: string;
  readonly messageId: string;
}

class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

function json(
  body: Readonly<Record<string, unknown>>,
  status = 200,
  headers: HeadersInit = {},
): Response {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      ...headers,
    },
  });
}

function allowedOrigins(env: Env): ReadonlySet<string> {
  return new Set(
    env.ALLOWED_ORIGINS.split(',')
      .map(origin => origin.trim())
      .filter(Boolean),
  );
}

function corsHeaders(request: Request, env: Env): HeadersInit {
  const origin = request.headers.get('Origin');
  if (!origin) return {};
  if (!allowedOrigins(env).has(origin)) {
    throw new ApiError(403, 'This origin is not allowed.', 'origin_denied');
  }
  return {
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
  };
}

async function readBoundedText(request: Request): Promise<string> {
  const declaredLength = Number(request.headers.get('Content-Length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BYTES) {
    throw new ApiError(413, 'Webhook payload is too large.', 'payload_too_large');
  }
  if (!request.body) return '';

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let body = '';
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > MAX_WEBHOOK_BYTES) {
      await reader.cancel('payload too large');
      throw new ApiError(413, 'Webhook payload is too large.', 'payload_too_large');
    }
    body += decoder.decode(chunk.value, { stream: true });
  }
  return body + decoder.decode();
}

function asObject(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(400, 'Webhook body must be a JSON object.', 'invalid_json');
  }
  return value as Readonly<Record<string, unknown>>;
}

function firstString(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return null;
}

function validIso(value: string | null): string | null {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

async function receiveWebhook(request: Request, env: Env): Promise<Response> {
  if (!request.headers.get('Content-Type')?.toLowerCase().includes('application/json')) {
    throw new ApiError(
      415,
      'Webhook Content-Type must be application/json.',
      'unsupported_media_type',
    );
  }
  const messageId = request.headers.get('svix-id')?.trim() ?? '';
  const timestamp = request.headers.get('svix-timestamp')?.trim() ?? '';
  const signature = request.headers.get('svix-signature')?.trim() ?? '';
  if (!messageId || !timestamp || !signature) {
    throw new ApiError(
      400,
      'Required Svix signature headers are missing.',
      'missing_signature_headers',
    );
  }
  if (messageId.length > 255) {
    throw new ApiError(400, 'Svix message ID is too long.', 'invalid_message_id');
  }

  const body = await readBoundedText(request);
  try {
    await verifyVantaWebhookSignature({
      body,
      messageId,
      timestamp,
      signature,
      secret: env.VANTA_WEBHOOK_SECRET,
    });
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      throw new ApiError(400, error.message, 'invalid_signature');
    }
    throw error;
  }

  let payload: Readonly<Record<string, unknown>>;
  try {
    payload = asObject(JSON.parse(body));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, 'Webhook body is not valid JSON.', 'invalid_json');
  }
  const eventType =
    firstString(payload, ['type', 'eventType', 'event_type']) ?? 'unclassified';
  if (eventType.length > 255) {
    throw new ApiError(400, 'Webhook event type is too long.', 'invalid_event_type');
  }
  const occurredAt = validIso(
    firstString(payload, ['createdAt', 'created_at', 'timestamp', 'occurredAt']),
  );
  const receivedAt = new Date().toISOString();
  const result = await env.EVENTS.prepare(
    `INSERT OR IGNORE INTO webhook_events
      (message_id, workspace_id, event_type, occurred_at, received_at, payload_json)
      VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(messageId, env.WORKSPACE_ID, eventType, occurredAt, receivedAt, body)
    .run();
  const duplicate = Number(result.meta.changes ?? 0) === 0;

  console.log(
    JSON.stringify({
      message: duplicate ? 'webhook replay acknowledged' : 'webhook stored',
      messageId,
      eventType,
      workspaceId: env.WORKSPACE_ID,
    }),
  );
  return json(
    { accepted: true, duplicate, messageId },
    duplicate ? 200 : 202,
  );
}

async function verifyAccess(request: Request, env: Env): Promise<JWTPayload> {
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) {
    throw new ApiError(
      401,
      'Sign in through Cloudflare Access, then retry.',
      'access_login_required',
    );
  }
  const issuer = env.ACCESS_TEAM_DOMAIN.replace(/\/$/u, '');
  try {
    const jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    const result = await jwtVerify(token, jwks, {
      issuer,
      audience: env.ACCESS_AUD,
    });
    if (typeof result.payload.sub !== 'string' || !result.payload.sub) {
      throw new Error('Access token has no subject.');
    }
    return result.payload;
  } catch {
    throw new ApiError(
      403,
      'Cloudflare Access could not authorize this request.',
      'access_denied',
    );
  }
}

function encodeCursor(cursor: Cursor): string {
  const bytes = new TextEncoder().encode(JSON.stringify(cursor));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function decodeCursor(value: string): Cursor {
  try {
    const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const bytes = Uint8Array.from(atob(padded), character => character.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== 'object') throw new Error('invalid cursor');
    const item = parsed as Readonly<Record<string, unknown>>;
    if (
      typeof item.receivedAt !== 'string' ||
      !Number.isFinite(Date.parse(item.receivedAt)) ||
      typeof item.messageId !== 'string' ||
      !item.messageId
    ) {
      throw new Error('invalid cursor');
    }
    return { receivedAt: item.receivedAt, messageId: item.messageId };
  } catch {
    throw new ApiError(400, 'Event cursor is invalid.', 'invalid_cursor');
  }
}

function pageSize(url: URL): number {
  const value = Number(url.searchParams.get('limit') ?? DEFAULT_PAGE_SIZE);
  if (!Number.isInteger(value) || value < 1 || value > MAX_PAGE_SIZE) {
    throw new ApiError(
      400,
      `limit must be an integer from 1 to ${MAX_PAGE_SIZE}.`,
      'invalid_limit',
    );
  }
  return value;
}

async function listEvents(request: Request, env: Env): Promise<Response> {
  const identity = await verifyAccess(request, env);
  const url = new URL(request.url);
  const limit = pageSize(url);
  const cursorValue = url.searchParams.get('cursor');
  const cursor = cursorValue ? decodeCursor(cursorValue) : null;
  const statement = cursor
    ? env.EVENTS.prepare(
        `SELECT message_id, event_type, occurred_at, received_at
           FROM webhook_events
          WHERE workspace_id = ?
            AND (received_at > ? OR (received_at = ? AND message_id > ?))
          ORDER BY received_at ASC, message_id ASC
          LIMIT ?`,
      ).bind(
        env.WORKSPACE_ID,
        cursor.receivedAt,
        cursor.receivedAt,
        cursor.messageId,
        limit + 1,
      )
    : env.EVENTS.prepare(
        `SELECT message_id, event_type, occurred_at, received_at
           FROM webhook_events
          WHERE workspace_id = ?
          ORDER BY received_at ASC, message_id ASC
          LIMIT ?`,
      ).bind(env.WORKSPACE_ID, limit + 1);
  const result = await statement.all<StoredEventRow>();
  const hasMore = result.results.length > limit;
  const selected = result.results.slice(0, limit);
  const ordered = selected;
  const last = ordered.at(-1);
  const nextCursor = last
    ? encodeCursor({ receivedAt: last.received_at, messageId: last.message_id })
    : cursorValue;
  return json(
    {
      workspaceId: env.WORKSPACE_ID,
      subject: identity.sub,
      events: ordered.map(item => ({
        id: item.message_id,
        eventType: item.event_type,
        occurredAt: item.occurred_at,
        receivedAt: item.received_at,
      })),
      nextCursor: nextCursor ?? null,
      hasMore,
    },
    200,
    corsHeaders(request, env),
  );
}

async function session(request: Request, env: Env): Promise<Response> {
  const identity = await verifyAccess(request, env);
  return json(
    {
      authenticated: true,
      subject: identity.sub,
      workspaceId: env.WORKSPACE_ID,
      webhookReceiver: true,
    },
    200,
    corsHeaders(request, env),
  );
}

export async function deleteExpiredEvents(env: Env, now = new Date()): Promise<number> {
  const retentionDays = Number(env.EVENT_RETENTION_DAYS);
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
    throw new Error('EVENT_RETENTION_DAYS must be an integer from 1 to 3650.');
  }
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000).toISOString();
  const result = await env.EVENTS.prepare(
    'DELETE FROM webhook_events WHERE received_at < ?',
  )
    .bind(cutoff)
    .run();
  return Number(result.meta.changes ?? 0);
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/health') {
    return json({ ok: true, service: 'vanta-companion-api' });
  }
  if (request.method === 'POST' && url.pathname === '/v1/webhooks/vanta') {
    return receiveWebhook(request, env);
  }
  if (request.method === 'OPTIONS' && url.pathname.startsWith('/v1/')) {
    return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  }
  if (request.method === 'GET' && url.pathname === '/v1/session') {
    return session(request, env);
  }
  if (request.method === 'GET' && url.pathname === '/v1/events') {
    return listEvents(request, env);
  }
  if (
    ['/health', '/v1/webhooks/vanta', '/v1/session', '/v1/events'].includes(
      url.pathname,
    )
  ) {
    throw new ApiError(405, 'Method not allowed.', 'method_not_allowed');
  }
  throw new ApiError(404, 'Route not found.', 'not_found');
}

function errorResponseHeaders(request: Request, env: Env): HeadersInit {
  const path = new URL(request.url).pathname;
  if (!['/v1/session', '/v1/events'].includes(path)) return {};
  try {
    return corsHeaders(request, env);
  } catch {
    return {};
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await route(request, env);
    } catch (error) {
      const path = new URL(request.url).pathname;
      if (error instanceof ApiError) {
        return json(
          { error: error.code, message: error.message },
          error.status,
          errorResponseHeaders(request, env),
        );
      }
      console.error(
        JSON.stringify({
          message: 'unhandled request failure',
          path,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return json(
        {
          error: 'internal_error',
          message: 'The service could not complete the request. Retry shortly.',
        },
        500,
        errorResponseHeaders(request, env),
      );
    }
  },
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(
      deleteExpiredEvents(env).then(deleted => {
        console.log(
          JSON.stringify({ message: 'event retention completed', deleted }),
        );
      }),
    );
  },
} satisfies ExportedHandler<Env>;
