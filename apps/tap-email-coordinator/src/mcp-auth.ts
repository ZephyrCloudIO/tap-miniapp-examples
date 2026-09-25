import { AccessError, type ProfileIdentity } from './auth';
import { sha256Base64Url } from './crypto';
import type { EmailMcpPrincipal, EmailMcpScope } from './mcp';
import { isMailSenderContext, type MailSenderContext } from '@tap-examples/tap-email-protocol';

const readScopes: readonly EmailMcpScope[] = ['email.metadata.read', 'email.content.read'];
const tokenLifetimeMs = 30 * 24 * 60 * 60_000;

export async function createEmailMcpCredential(env: Env, identity: ProfileIdentity, allowWrites: boolean, now: Date, sender?: MailSenderContext) {
  if (allowWrites && !isMailSenderContext(sender)) throw new AccessError(403, 'sender_context_required', 'Verify a sending workspace before enabling Email writes.');
  const token = `temcp_${Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('')}`;
  const scopes: readonly EmailMcpScope[] = allowWrites ? [...readScopes, 'email.write'] : readScopes;
  const expiresAt = new Date(now.getTime() + tokenLifetimeMs).toISOString();
  await env.DB.prepare(`INSERT INTO email_mcp_credentials (profile_id, token_hash, scopes_json, created_at, expires_at, sender_user_id, sender_workspace_id)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(profile_id) DO UPDATE SET
    token_hash = excluded.token_hash, scopes_json = excluded.scopes_json,
    created_at = excluded.created_at, expires_at = excluded.expires_at,
    sender_user_id = excluded.sender_user_id, sender_workspace_id = excluded.sender_workspace_id`)
    .bind(identity.profileId, await sha256Base64Url(token), JSON.stringify(scopes), now.toISOString(), expiresAt, sender?.userId ?? null, sender?.workspaceId ?? null).run();
  return { token, scopes, expiresAt };
}

export async function emailMcpCredentialStatus(env: Env, identity: ProfileIdentity, now: Date) {
  const row = await env.DB.prepare('SELECT scopes_json, expires_at FROM email_mcp_credentials WHERE profile_id = ? AND expires_at > ?')
    .bind(identity.profileId, now.toISOString()).first<{ scopes_json: string; expires_at: string }>();
  return row ? { connected: true, scopes: JSON.parse(row.scopes_json) as string[], expiresAt: row.expires_at } : { connected: false, scopes: [], expiresAt: null };
}

export async function revokeEmailMcpCredential(env: Env, identity: ProfileIdentity) {
  await env.DB.prepare('DELETE FROM email_mcp_credentials WHERE profile_id = ?').bind(identity.profileId).run();
}

export async function verifyEmailMcpCredential(request: Request, env: Env, now: Date): Promise<EmailMcpPrincipal> {
  const token = request.headers.get('X-TAP-Email-MCP-Token') ?? '';
  if (!/^temcp_[a-f0-9]{64}$/u.test(token)) throw new AccessError(401, 'mcp_credential_required', 'Connect Email tools in TAP Email settings.');
  const row = await env.DB.prepare('SELECT profile_id, scopes_json, sender_user_id, sender_workspace_id FROM email_mcp_credentials WHERE token_hash = ? AND expires_at > ?')
    .bind(await sha256Base64Url(token), now.toISOString()).first<{ profile_id: string; scopes_json: string; sender_user_id: string | null; sender_workspace_id: string | null }>();
  if (!row) throw new AccessError(401, 'mcp_credential_expired', 'Email tool access expired or was revoked. Reconnect in TAP Email settings.');
  const scopes: unknown = JSON.parse(row.scopes_json);
  if (!Array.isArray(scopes) || !scopes.every(s => [...readScopes, 'email.write'].includes(s))) {
    throw new AccessError(403, 'mcp_scope_invalid', 'Email tool access has invalid scopes.');
  }
  const sender = { userId: row.sender_user_id, workspaceId: row.sender_workspace_id };
  if (scopes.includes('email.write') && !isMailSenderContext(sender)) {
    throw new AccessError(403, 'sender_context_required', 'Reconnect Email tools from a verified workspace.');
  }
  return { profileId: row.profile_id, audience: 'tap-email-mcp', scopes,
    ...(isMailSenderContext(sender) ? { senderContext: sender } : {}) };
}
