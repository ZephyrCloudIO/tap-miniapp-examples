/**
 * ============================================================================
 *  IDENTITY SEAM
 * ============================================================================
 *  Every REST entry point resolves the caller to a TAP identity before
 *  anything is minted or mutated. Two paths exist:
 *
 *  1. **Platform session (target).** The miniapp calls these endpoints through
 *     host-mediated `tap.http.request` with `credentialRef: 'platform-session'`,
 *     so the TAP host attaches the active account's access token and the secret
 *     never enters miniapp JavaScript. The Worker verifies that JWT against the
 *     configured Auth0 issuer's JWKS and audience before trusting its subject.
 *
 *  2. **Dev identity (local/test only).** When `ALLOW_DEV_IDENTITY` is set the
 *     caller declares identity directly — this is how `wrangler dev`, the
 *     vitest-pool-workers suite, and the browser preview exercise the room
 *     without a TAP host. It is compiled out of production by configuration,
 *     never by convention.
 *
 *  Both paths fail closed. Production never accepts body-authored user IDs.
 * ============================================================================
 */

import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
} from 'jose';

export interface Identity {
  userId: string;
  channelId: string;
  displayName: string;
}

const MAX_ID_CHARS = 128;

function cleanId(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ID_CHARS) {
    return false;
  }
  return ![...value].some((c) => {
    const code = c.codePointAt(0) ?? 0;
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
  });
}

function cleanName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && [...value].length <= 48;
}

const remoteKeySets = new Map<string, JWTVerifyGetKey>();

function jwtIssuer(raw: string): string | null {
  try {
    const issuer = new URL(raw.trim());
    if (issuer.protocol !== 'https:' || issuer.username || issuer.password) return null;
    issuer.search = '';
    issuer.hash = '';
    if (!issuer.pathname.endsWith('/')) issuer.pathname += '/';
    return issuer.toString();
  } catch {
    return null;
  }
}

/** Verify one TAP access token and return only its authenticated account ID. */
export async function verifyPlatformSessionToken(
  sessionToken: string,
  issuer: string,
  audience: string,
  keySet: JWTVerifyGetKey,
): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(sessionToken, keySet, {
      issuer,
      audience,
      algorithms: ['RS256'],
    });
    return cleanId(payload.sub) ? payload.sub : null;
  } catch {
    return null;
  }
}

/**
 * Verify a platform session credential against the configured Auth0 tenant.
 * Fails closed on missing configuration, JWKS failures, or invalid claims.
 */
async function verifyPlatformSession(env: Env, sessionToken: string): Promise<string | null> {
  const issuer = jwtIssuer(env.TAP_JWT_ISSUER ?? '');
  const audience = env.TAP_JWT_AUDIENCE?.trim();
  if (!issuer || !audience) return null;

  let keySet = remoteKeySets.get(issuer);
  if (!keySet) {
    keySet = createRemoteJWKSet(new URL('.well-known/jwks.json', issuer), {
      timeoutDuration: 5000,
      cooldownDuration: 30_000,
      cacheMaxAge: 600_000,
    });
    remoteKeySets.set(issuer, keySet);
  }
  return verifyPlatformSessionToken(sessionToken, issuer, audience, keySet);
}

export interface ResolvedRequest {
  identity: Identity;
  /** 'platform' once JWT verification succeeds; 'dev' otherwise. */
  via: 'platform' | 'dev';
}

export type AuthenticatedRequest =
  | { via: 'platform'; userId: string }
  | { via: 'dev'; userId: null };

/**
 * Authenticate a request that does not carry identity fields in a JSON body.
 * Production requires a verified platform bearer. Local development may use
 * the explicit ALLOW_DEV_IDENTITY bypass, but a presented invalid credential
 * never downgrades to that bypass.
 */
export async function authenticateRequest(
  env: Env,
  request: Request,
): Promise<AuthenticatedRequest | null> {
  const auth = request.headers.get('authorization');
  if (auth !== null) {
    if (!auth.startsWith('Bearer ')) return null;
    const userId = await verifyPlatformSession(env, auth.slice('Bearer '.length));
    return userId ? { via: 'platform', userId } : null;
  }
  return env.ALLOW_DEV_IDENTITY === 'true' ? { via: 'dev', userId: null } : null;
}

/**
 * Resolve the caller's identity. `body` is the already-parsed JSON object of
 * POST endpoints (declared channel/displayName); platform sessions override
 * declared identity fields.
 */
export async function resolveIdentity(
  env: Env,
  request: Request,
  body: Record<string, unknown>,
): Promise<ResolvedRequest | null> {
  const channelId = cleanId(body.channelId) ? body.channelId : null;
  const displayName = cleanName(body.displayName) ? body.displayName.trim() : null;
  if (!channelId || !displayName) return null;

  const authenticated = await authenticateRequest(env, request);
  if (!authenticated) return null;
  if (authenticated.via === 'platform') {
    return {
      identity: {
        userId: authenticated.userId,
        channelId,
        displayName,
      },
      via: 'platform',
    };
  }

  const userId = cleanId(body.userId) ? body.userId : null;
  return userId ? { identity: { userId, channelId, displayName }, via: 'dev' } : null;
}
