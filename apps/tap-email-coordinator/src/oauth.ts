import type { ProfileIdentity } from './auth';
import {
  openSecret,
  sealSecret,
  secureRandomToken,
  sha256Base64Url,
} from './crypto';
import { googleJson, readBoundedJson } from './google';
import { enqueueSyncEvent } from './sync-events';

const authorizationEndpoint = 'https://accounts.google.com/o/oauth2/v2/auth';
const tokenEndpoint = 'https://oauth2.googleapis.com/token';
const userInfoEndpoint = 'https://openidconnect.googleapis.com/v1/userinfo';
const gmailScope = 'https://www.googleapis.com/auth/gmail.modify';

interface OAuthStateRow {
  readonly profile_id: string;
  readonly code_verifier_ciphertext: string;
  readonly expires_at: string;
}

export class GoogleOAuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function configured(env: Env): void {
  if (!env.GOOGLE_CLIENT_ID.trim() || !env.GOOGLE_REDIRECT_URI.trim()) {
    throw new GoogleOAuthError(
      503,
      'google_oauth_not_configured',
      'Google OAuth has not been configured for TAP Email.',
    );
  }
  let redirect: URL;
  try {
    redirect = new URL(env.GOOGLE_REDIRECT_URI);
  } catch {
    throw new GoogleOAuthError(503, 'google_oauth_not_configured', 'The Google redirect URL is invalid.');
  }
  const loopback = redirect.hostname === 'localhost' || redirect.hostname === '127.0.0.1';
  if (redirect.protocol !== 'https:' && !(loopback && redirect.protocol === 'http:')) {
    throw new GoogleOAuthError(503, 'google_oauth_not_configured', 'The Google redirect URL must use HTTPS.');
  }
}

export async function beginGoogleOAuth(
  env: Env,
  identity: ProfileIdentity,
  now: Date,
): Promise<{ readonly authorizationUrl: string }> {
  configured(env);
  const state = secureRandomToken(32);
  const verifier = secureRandomToken(48);
  const [stateHash, challenge, encryptedVerifier] = await Promise.all([
    sha256Base64Url(state),
    sha256Base64Url(verifier),
    sealSecret(verifier, env.GOOGLE_TOKEN_ENCRYPTION_KEY),
  ]);
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + 10 * 60_000).toISOString();
  await env.DB.prepare(
    `INSERT INTO google_oauth_states
       (state_hash, profile_id, code_verifier_ciphertext, return_to, expires_at, created_at)
     VALUES (?, ?, ?, NULL, ?, ?)`,
  )
    .bind(stateHash, identity.profileId, encryptedVerifier, expiresAt, createdAt)
    .run();

  const authorizationUrl = new URL(authorizationEndpoint);
  authorizationUrl.search = new URLSearchParams({
    access_type: 'offline',
    client_id: env.GOOGLE_CLIENT_ID,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    include_granted_scopes: 'true',
    prompt: 'consent',
    redirect_uri: env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: `openid email profile ${gmailScope}`,
    state,
  }).toString();
  return { authorizationUrl: authorizationUrl.toString() };
}

function accentFor(subject: string): string {
  const accents = ['#e56f4c', '#74a7a1', '#8f7cc3', '#cf9a46', '#5f8fc8'];
  let hash = 0;
  for (const character of subject) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return accents[hash % accents.length] ?? accents[0]!;
}

function completionHtml(address: string): Response {
  const escaped = address
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Google connected</title><style>body{background:#17191d;color:#f3f0e8;font:16px system-ui;display:grid;place-items:center;min-height:100vh;margin:0}.card{max-width:420px;padding:32px;border:1px solid #343840;border-radius:18px;background:#22252b;text-align:center}h1{font-size:24px}p{color:#b9bec8}</style></head><body><main class="card"><h1>Google connected</h1><p>${escaped} is syncing into TAP Email. You can close this window.</p></main><script>window.setTimeout(()=>window.close(),900)</script></body></html>`,
    {
      status: 200,
      headers: {
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'",
        'Content-Type': 'text/html; charset=utf-8',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      },
    },
  );
}

export async function finishGoogleOAuth(
  request: Request,
  env: Env,
  now: Date,
): Promise<Response> {
  configured(env);
  const url = new URL(request.url);
  const state = url.searchParams.get('state') ?? '';
  const code = url.searchParams.get('code') ?? '';
  if (!state || state.length > 512 || !code || code.length > 8_192) {
    throw new GoogleOAuthError(400, 'google_oauth_invalid_callback', 'Google did not return a valid authorization result.');
  }
  const stateHash = await sha256Base64Url(state);
  const stateRow = await env.DB.prepare(
    `SELECT profile_id, code_verifier_ciphertext, expires_at
       FROM google_oauth_states WHERE state_hash = ?`,
  )
    .bind(stateHash)
    .first<OAuthStateRow>();
  await env.DB.prepare('DELETE FROM google_oauth_states WHERE state_hash = ?')
    .bind(stateHash)
    .run();
  if (!stateRow || Date.parse(stateRow.expires_at) <= now.getTime()) {
    throw new GoogleOAuthError(400, 'google_oauth_state_expired', 'This Google connection request expired.');
  }
  const verifier = await openSecret(
    stateRow.code_verifier_ciphertext,
    env.GOOGLE_TOKEN_ENCRYPTION_KEY,
  );
  const tokenResponse = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: env.GOOGLE_REDIRECT_URI,
    }),
  });
  const tokenPayload = await readBoundedJson(tokenResponse, 65_536);
  if (!tokenPayload || typeof tokenPayload !== 'object' || Array.isArray(tokenPayload)) {
    throw new GoogleOAuthError(502, 'google_token_invalid', 'Google returned an invalid token response.');
  }
  const tokens = tokenPayload as Readonly<Record<string, unknown>>;
  if (!tokenResponse.ok || typeof tokens.access_token !== 'string') {
    throw new GoogleOAuthError(400, 'google_code_exchange_failed', 'Google authorization could not be completed.');
  }

  const [userInfoResponse, gmailProfile] = await Promise.all([
    fetch(userInfoEndpoint, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${tokens.access_token}` },
    }),
    googleJson(tokens.access_token, '/gmail/v1/users/me/profile'),
  ]);
  const userInfoPayload = await readBoundedJson(userInfoResponse, 65_536);
  if (!userInfoResponse.ok || !userInfoPayload || typeof userInfoPayload !== 'object' || Array.isArray(userInfoPayload)) {
    throw new GoogleOAuthError(502, 'google_identity_invalid', 'Google identity could not be verified.');
  }
  const userInfo = userInfoPayload as Readonly<Record<string, unknown>>;
  if (
    typeof userInfo.sub !== 'string' ||
    typeof userInfo.email !== 'string' ||
    userInfo.email_verified !== true
  ) {
    throw new GoogleOAuthError(502, 'google_identity_invalid', 'Google did not return a verified account identity.');
  }
  const existing = await env.DB.prepare(
    `SELECT account_id FROM google_accounts
      WHERE profile_id = ? AND google_subject = ?`,
  )
    .bind(stateRow.profile_id, userInfo.sub)
    .first<{ account_id: string }>();
  const accountId = existing?.account_id ?? `google_${userInfo.sub}`;
  const address =
    typeof gmailProfile.emailAddress === 'string'
      ? gmailProfile.emailAddress
      : userInfo.email;
  const displayName =
    typeof userInfo.name === 'string' && userInfo.name.trim()
      ? userInfo.name.trim()
      : address.split('@')[0] ?? address;
  const createdAt = now.toISOString();
  const expiresIn =
    typeof tokens.expires_in === 'number' && Number.isFinite(tokens.expires_in)
      ? Math.max(60, tokens.expires_in)
      : 3_600;
  const accessExpiresAt = new Date(now.getTime() + expiresIn * 1_000).toISOString();
  const previousCredential = await env.DB.prepare(
    `SELECT refresh_token_ciphertext FROM google_credentials
      WHERE profile_id = ? AND account_id = ?`,
  )
    .bind(stateRow.profile_id, accountId)
    .first<{ refresh_token_ciphertext: string }>();
  const refreshCiphertext =
    typeof tokens.refresh_token === 'string'
      ? await sealSecret(tokens.refresh_token, env.GOOGLE_TOKEN_ENCRYPTION_KEY)
      : previousCredential?.refresh_token_ciphertext;
  if (!refreshCiphertext) {
    throw new GoogleOAuthError(400, 'google_refresh_token_missing', 'Google did not return offline access. Connect the account again.');
  }
  const accessCiphertext = await sealSecret(
    tokens.access_token,
    env.GOOGLE_TOKEN_ENCRYPTION_KEY,
  );
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO google_accounts
         (profile_id, account_id, google_subject, connection_state,
          coverage_state, newest_history_id, backfill_complete_through,
          unresolved_failures, email_address, display_name, accent,
          created_at, updated_at)
       VALUES (?, ?, ?, 'active', 'backfilling', ?, NULL, 0, ?, ?, ?, ?, ?)
       ON CONFLICT(profile_id, google_subject) DO UPDATE SET
         connection_state = 'active', coverage_state = 'backfilling',
         newest_history_id = COALESCE(google_accounts.newest_history_id, excluded.newest_history_id),
         email_address = excluded.email_address, display_name = excluded.display_name,
         accent = excluded.accent, unresolved_failures = 0,
         updated_at = excluded.updated_at`,
    ).bind(
      stateRow.profile_id,
      accountId,
      userInfo.sub,
      typeof gmailProfile.historyId === 'string' ? gmailProfile.historyId : null,
      address,
      displayName,
      accentFor(userInfo.sub),
      createdAt,
      createdAt,
    ),
    env.DB.prepare(
      `INSERT INTO google_credentials
         (profile_id, account_id, refresh_token_ciphertext,
          access_token_ciphertext, access_token_expires_at, granted_scopes,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(profile_id, account_id) DO UPDATE SET
         refresh_token_ciphertext = excluded.refresh_token_ciphertext,
         access_token_ciphertext = excluded.access_token_ciphertext,
         access_token_expires_at = excluded.access_token_expires_at,
         granted_scopes = excluded.granted_scopes,
         updated_at = excluded.updated_at`,
    ).bind(
      stateRow.profile_id,
      accountId,
      refreshCiphertext,
      accessCiphertext,
      accessExpiresAt,
      typeof tokens.scope === 'string' ? tokens.scope : gmailScope,
      createdAt,
      createdAt,
    ),
  ]);
  await enqueueSyncEvent(env, {
    profileId: stateRow.profile_id,
    accountId,
    mode: 'newest',
  }, now);
  return completionHtml(address);
}
