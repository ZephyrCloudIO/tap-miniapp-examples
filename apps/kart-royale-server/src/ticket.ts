/**
 * ============================================================================
 *  RACE TICKETS
 * ============================================================================
 *  A ticket is a short-lived HMAC-SHA256 bearer token binding
 *  `userId | channelId | raceId | role | expiry`. The Worker mints it after
 *  authenticating the caller (see auth.ts); the Durable Object re-verifies it
 *  at the WebSocket upgrade, so identity on the socket is stamped by the
 *  server, never asserted by the client.
 *
 *  Tickets are NOT single-use on purpose: a player reconnecting after a
 *  transient drop presents the same ticket within its TTL and the room
 *  recognises the identity and keeps their slot.
 * ============================================================================
 */

import type { MemberRole } from '@tap-examples/kart-royale-protocol';

export interface TicketClaims {
  userId: string;
  channelId: string;
  raceId: string;
  role: MemberRole;
  displayName: string;
  /** Unix milliseconds after which the ticket is rejected. */
  exp: number;
}

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unbase64url(text: string): Uint8Array {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function encodeClaims(claims: TicketClaims): string {
  // Length-delimited so a field value can never impersonate another field.
  return [
    claims.userId,
    claims.channelId,
    claims.raceId,
    claims.role,
    claims.displayName,
    String(claims.exp),
  ]
    .map((field) => `${field.length}:${field}`)
    .join('|');
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function mintTicket(secret: string, claims: TicketClaims): Promise<string> {
  const payload = base64url(new TextEncoder().encode(JSON.stringify(claims)));
  const sig = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(secret),
    new TextEncoder().encode(`${payload}.${encodeClaims(claims)}`),
  );
  return `${payload}.${base64url(sig)}`;
}

export async function verifyTicket(
  secret: string,
  token: string,
  now: number,
): Promise<TicketClaims | null> {
  const dot = token.lastIndexOf('.');
  if (dot <= 0 || token.length > 4096) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let claims: unknown;
  try {
    claims = JSON.parse(new TextDecoder().decode(unbase64url(payload)));
  } catch {
    return null;
  }
  if (
    typeof claims !== 'object' || claims === null ||
    typeof (claims as TicketClaims).userId !== 'string' ||
    typeof (claims as TicketClaims).channelId !== 'string' ||
    typeof (claims as TicketClaims).raceId !== 'string' ||
    typeof (claims as TicketClaims).displayName !== 'string' ||
    ((claims as TicketClaims).role !== 'player' && (claims as TicketClaims).role !== 'spectator') ||
    typeof (claims as TicketClaims).exp !== 'number'
  ) {
    return null;
  }
  const parsed = claims as TicketClaims;
  const expected = `${payload}.${encodeClaims(parsed)}`;
  const valid = await crypto.subtle.verify(
    'HMAC',
    await hmacKey(secret),
    unbase64url(sig) as BufferSource,
    new TextEncoder().encode(expected),
  );
  if (!valid) return null;
  if (parsed.exp <= now) return null;
  return parsed;
}
