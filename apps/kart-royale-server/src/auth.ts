/**
 * ============================================================================
 *  IDENTITY SEAM
 * ============================================================================
 *  Every REST entry point resolves the caller to a TAP identity before
 *  anything is minted or mutated. Two paths exist:
 *
 *  1. **Platform session (target).** The miniapp calls these endpoints through
 *     host-mediated `tap.http.request` with `credentialRef: 'platform-session'`,
 *     so the TAP host attaches the active account's session credential and the
 *     secret never enters miniapp JavaScript. The Worker then introspects the
 *     session server-to-server (`TAP_INTROSPECTION_URL`) and trusts the
 *     userId/channelId the platform returns.
 *
 *  2. **Dev identity (local/test only).** When `ALLOW_DEV_IDENTITY` is set the
 *     caller declares identity directly — this is how `wrangler dev`, the
 *     vitest-pool-workers suite, and the browser preview exercise the room
 *     without a TAP host. It is compiled out of production by configuration,
 *     never by convention.
 *
 *  The introspection endpoint contract is a Phase 0 verification item with
 *  the TAP platform team; until it lands, path 1 fails closed.
 * ============================================================================
 */

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

/**
 * Introspect a platform session credential against the TAP platform.
 * Fails closed: any error, timeout, or malformed answer is not-an-identity.
 */
async function introspectPlatformSession(
  env: Env,
  sessionToken: string,
): Promise<{ userId: string; channelId?: string } | null> {
  const url = env.TAP_INTROSPECTION_URL;
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${sessionToken}`,
      },
      body: '{}',
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (typeof body !== 'object' || body === null) return null;
    const userId = (body as { userId?: unknown }).userId;
    const channelId = (body as { channelId?: unknown }).channelId;
    if (!cleanId(userId)) return null;
    if (cleanId(channelId)) return { userId, channelId };
    return { userId };
  } catch {
    return null;
  }
}

export interface ResolvedRequest {
  identity: Identity;
  /** 'platform' once introspection verified the session; 'dev' otherwise. */
  via: 'platform' | 'dev';
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

  const auth = request.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) {
    const session = await introspectPlatformSession(env, auth.slice('Bearer '.length));
    if (session) {
      return {
        identity: {
          userId: session.userId,
          channelId: session.channelId ?? channelId,
          displayName,
        },
        via: 'platform',
      };
    }
    // A presented platform session that fails introspection must NOT fall
    // through to dev identity — that would be an auth downgrade.
    return null;
  }

  if (env.ALLOW_DEV_IDENTITY === 'true') {
    const userId = cleanId(body.userId) ? body.userId : null;
    if (userId) return { identity: { userId, channelId, displayName }, via: 'dev' };
  }
  return null;
}
