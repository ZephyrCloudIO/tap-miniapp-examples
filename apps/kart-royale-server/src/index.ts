/**
 * ============================================================================
 *  KART ROYALE SESSION SERVER (Worker entry)
 * ============================================================================
 *  REST for room lifecycle and tickets, then a ticket-verified WebSocket
 *  upgrade into the per-race RaceRoom Durable Object. Identity resolution
 *  lives in auth.ts; ticket mint/verify in ticket.ts.
 *
 *    POST /rooms                create a race room (host)        → raceId+ticket
 *    POST /rooms/:raceId/tickets join a race (player|spectator)  → ticket
 *    GET  /ws?raceId&ticket     upgrade into the room
 *    GET  /health               liveness
 * ============================================================================
 */
import { resolveIdentity, type Identity } from './auth';
import { mintTicket, verifyTicket } from './ticket';
import type { MemberRole } from '@tap-examples/kart-royale-protocol';
import { RaceRoom } from './RaceRoom';
import { ChannelRegistry } from './ChannelRegistry';

export { RaceRoom, ChannelRegistry };

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

/**
 * Browser-preview clients call the REST leg cross-origin (`rsbuild dev` →
 * `wrangler dev`). Dev mode is permissive; production answers CORS only for
 * origins listed in ALLOWED_ORIGINS (comma-separated). The packaged TAP
 * surface uses host-mediated http and never needs CORS.
 */
function corsHeaders(env: Env, origin: string | null): Record<string, string> {
  if (!origin) return {};
  if (env.ALLOW_DEV_IDENTITY === 'true') {
    return {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type, authorization',
      vary: 'Origin',
    };
  }
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim());
  if (!allowed.includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization',
    vary: 'Origin',
  };
}

function json(env: Env, request: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...corsHeaders(env, request.headers.get('origin')) },
  });
}

async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}

function ticketSecret(env: Env): string | null {
  if (typeof env.TICKET_SECRET === 'string' && env.TICKET_SECRET.length >= 16) {
    return env.TICKET_SECRET;
  }
  // Local development and the vitest-pool-workers suite run without secrets.
  return env.ALLOW_DEV_IDENTITY === 'true' ? 'dev-insecure-ticket-secret' : null;
}

function wsUrl(request: Request, raceId: string, ticket: string): string {
  const url = new URL(request.url);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/ws';
  url.search = `raceId=${encodeURIComponent(raceId)}&ticket=${encodeURIComponent(ticket)}`;
  return url.toString();
}

async function handleCreateRoom(env: Env, request: Request, identity: Identity): Promise<Response> {
  const raceId = crypto.randomUUID();
  const secret = ticketSecret(env);
  if (!secret) return json(env, request, { error: 'ticket signing is not configured' }, 503);

  // Initialise the room with its channel so it can report its own lifecycle,
  // then list it in the channel registry for discovery.
  const stub = env.RACE_ROOM.get(env.RACE_ROOM.idFromName(raceId));
  await stub.fetch(new Request('https://room/admin/init', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ channelId: identity.channelId, raceId }),
  }));
  const registry = env.RACE_REGISTRY.get(env.RACE_REGISTRY.idFromName(identity.channelId));
  await registry.fetch(new Request('https://registry/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ raceId, host: identity.displayName }),
  }));

  const ttlMs = (Number(env.TICKET_TTL_SECONDS) || 120) * 1000;
  const ticket = await mintTicket(secret, {
    userId: identity.userId,
    channelId: identity.channelId,
    raceId,
    role: 'player',
    displayName: identity.displayName,
    exp: Date.now() + ttlMs,
  });
  return json(env, request, { raceId, ticket, wsUrl: wsUrl(request, raceId, ticket) });
}

async function handleJoinTicket(
  env: Env,
  request: Request,
  identity: Identity,
  raceId: string,
  role: MemberRole,
): Promise<Response> {
  // The room must exist (its DO must answer /exists before we mint entry).
  const stub = env.RACE_ROOM.get(env.RACE_ROOM.idFromName(raceId));
  const probe = await stub.fetch(new Request('https://room/exists'));
  if (!probe.ok) return json(env, request, { error: 'unknown race room' }, 404);

  const secret = ticketSecret(env);
  if (!secret) return json(env, request, { error: 'ticket signing is not configured' }, 503);
  const ttlMs = (Number(env.TICKET_TTL_SECONDS) || 120) * 1000;
  const ticket = await mintTicket(secret, {
    userId: identity.userId,
    channelId: identity.channelId,
    raceId,
    role,
    displayName: identity.displayName,
    exp: Date.now() + ttlMs,
  });
  return json(env, request, { raceId, ticket, wsUrl: wsUrl(request, raceId, ticket) });
}

async function handleWebSocket(env: Env, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const raceId = url.searchParams.get('raceId');
  const ticket = url.searchParams.get('ticket');
  if (!raceId || !ticket) return json(env, request, { error: 'raceId and ticket are required' }, 400);

  const secret = ticketSecret(env);
  if (!secret) return json(env, request, { error: 'ticket signing is not configured' }, 503);
  const claims = await verifyTicket(secret, ticket, Date.now());
  if (!claims || claims.raceId !== raceId) {
    return json(env, request, { error: 'invalid or expired ticket' }, 401);
  }

  // The DO trusts identity only via these headers from its Worker sibling;
  // clients can never set them on the hop that matters.
  const headers = new Headers(request.headers);
  headers.set('x-kr-user', claims.userId);
  headers.set('x-kr-channel', claims.channelId);
  headers.set('x-kr-role', claims.role);
  headers.set('x-kr-name', encodeURIComponent(claims.displayName));
  const stub = env.RACE_ROOM.get(env.RACE_ROOM.idFromName(raceId));
  return stub.fetch(new Request(new URL('/ws', request.url).toString(), { headers }));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env, request.headers.get('origin')) });
    }

    if (url.pathname === '/health') {
      return json(env, request, { ok: true, service: 'kart-royale-server' });
    }

    if (url.pathname === '/ws' && request.method === 'GET') {
      return handleWebSocket(env, request);
    }

    const roomsMatch = url.pathname.match(/^\/channels\/([^/]{1,128})\/rooms$/);
    if (roomsMatch && request.method === 'GET') {
      const registry = env.RACE_REGISTRY.get(env.RACE_REGISTRY.idFromName(roomsMatch[1]!));
      const upstream = await registry.fetch(new Request('https://registry/list'));
      const headers = new Headers(upstream.headers);
      for (const [k, v] of Object.entries(corsHeaders(env, request.headers.get('origin')))) {
        headers.set(k, v);
      }
      return new Response(upstream.body, { status: upstream.status, headers });
    }

    if (url.pathname === '/rooms' && request.method === 'POST') {
      const body = await readJsonObject(request);
      if (!body) return json(env, request, { error: 'expected a JSON object body' }, 400);
      const resolved = await resolveIdentity(env, request, body);
      if (!resolved) return json(env, request, { error: 'unauthorized' }, 401);
      return handleCreateRoom(env, request, resolved.identity);
    }

    const ticketsMatch = url.pathname.match(/^\/rooms\/([0-9a-f-]{36})\/tickets$/);
    if (ticketsMatch && request.method === 'POST') {
      const body = await readJsonObject(request);
      if (!body) return json(env, request, { error: 'expected a JSON object body' }, 400);
      const role = body.role === 'spectator' ? 'spectator' : 'player';
      const resolved = await resolveIdentity(env, request, body);
      if (!resolved) return json(env, request, { error: 'unauthorized' }, 401);
      return handleJoinTicket(env, request, resolved.identity, ticketsMatch[1]!, role);
    }

    return json(env, request, { error: 'not found' }, 404);
  },
} satisfies ExportedHandler<Env>;
