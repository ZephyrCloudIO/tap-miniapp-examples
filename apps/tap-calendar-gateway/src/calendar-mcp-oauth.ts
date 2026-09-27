import { AuthorizationError, type AuthRequest, type OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { z } from "zod";
import { CALENDAR_MCP_SCOPES } from "../../tap-calendar/src/mcp-contract";
import { CalendarMcpError, mcpScopes, type McpOwner } from "./calendar-mcp-store";

export interface CalendarOAuthEnv { readonly CALENDAR_DB: D1Database; readonly OAUTH_PROVIDER?: OAuthHelpers }
interface PendingAuthorization {
  readonly request_json: string;
  readonly client_name: string;
  readonly expires_at: string;
  readonly grant_id: string | null;
}
const digest = async (text: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map(byte => byte.toString(16).padStart(2, "0")).join("");
const random = (length: number) => [...crypto.getRandomValues(new Uint8Array(length))].map(byte => byte.toString(16).padStart(2, "0")).join("");
const escapeHtml = (text: string) => text.replace(/[&<>"']/gu, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const page = (title: string, body: string, cookie?: string, status = 200) => new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><body><main><h1>${escapeHtml(title)}</h1>${body}</main></body></html>`, { status, headers: {
  "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff", ...(cookie ? { "Set-Cookie": cookie } : {}),
} });
const unavailable = () => new CalendarMcpError(404, "authorization_unavailable", "This connection code is expired, already used, or invalid. Restart the specialist connection.");
const canonicalCode = (value: unknown) => {
  if (typeof value !== "string" || !/^[0-9a-f]{4}(?:-?[0-9a-f]{4}){3}$/iu.test(value.trim())) throw unavailable();
  return value.trim().replaceAll("-", "").toLowerCase();
};

export async function reviewCalendarMcpAuthorization(env: CalendarOAuthEnv, value: unknown) {
  const codeHash = await digest(canonicalCode(value));
  const row = await env.CALENDAR_DB.prepare(`SELECT request_json, client_name, expires_at, grant_id FROM calendar_mcp_authorizations
    WHERE code_hash = ? AND expires_at > ? AND consumed_at IS NULL AND grant_id IS NULL`)
    .bind(codeHash, new Date().toISOString()).first<PendingAuthorization>();
  if (!row) throw unavailable();
  const request = JSON.parse(row.request_json) as AuthRequest;
  return { clientName: row.client_name, redirectOrigin: new URL(request.redirectUri).origin, scopes: mcpScopes.parse(request.scope), expiresAt: row.expires_at };
}

export async function approveCalendarMcpAuthorization(env: CalendarOAuthEnv, owner: McpOwner, value: unknown) {
  const parsed = z.strictObject({ code: z.string(), scopes: mcpScopes }).safeParse(value);
  if (!parsed.success) throw new CalendarMcpError(400, "invalid_consent", "Choose at least one requested Calendar permission.");
  const review = await reviewCalendarMcpAuthorization(env, parsed.data.code);
  if (parsed.data.scopes.some(scope => !review.scopes.includes(scope))) throw new CalendarMcpError(400, "invalid_scopes", "Only requested Calendar permissions can be granted.");
  const codeHash = await digest(canonicalCode(parsed.data.code));
  const grantId = crypto.randomUUID();
  const now = new Date().toISOString();
  // Claim + grant creation happen in the same transaction. The losing consent
  // request cannot substitute its identity or leave an active orphan grant.
  await env.CALENDAR_DB.batch([
    env.CALENDAR_DB.prepare(`INSERT INTO calendar_mcp_grants (id, workspace_id, principal_id, client_name, scopes_json, created_at)
      SELECT ?, ?, ?, client_name, ?, ? FROM calendar_mcp_authorizations
      WHERE code_hash = ? AND expires_at > ? AND grant_id IS NULL AND consumed_at IS NULL`)
      .bind(grantId, owner.workspace, owner.principal, JSON.stringify(parsed.data.scopes), now, codeHash, now),
    env.CALENDAR_DB.prepare(`UPDATE calendar_mcp_authorizations SET grant_id = ? WHERE code_hash = ?
      AND grant_id IS NULL AND consumed_at IS NULL AND expires_at > ?
      AND EXISTS (SELECT 1 FROM calendar_mcp_grants WHERE id = ?)`)
      .bind(grantId, codeHash, now, grantId),
  ]);
  const claimed = await env.CALENDAR_DB.prepare("SELECT grant_id FROM calendar_mcp_authorizations WHERE code_hash = ?")
    .bind(codeHash).first<{ grant_id: string | null }>();
  if (claimed?.grant_id !== grantId) throw unavailable();
  return { approved: true };
}

export async function calendarMcpOAuthRoute(request: Request, env: CalendarOAuthEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/oauth/authorize" && url.pathname !== "/oauth/complete") return null;
  if (request.method !== "GET") return page("Method not allowed", "", undefined, 405);
  if (!env.OAUTH_PROVIDER) throw new CalendarMcpError(503, "oauth_unavailable", "Specialist connections are not configured.");
  if (url.pathname === "/oauth/authorize") {
    let auth: AuthRequest;
    try { auth = await env.OAUTH_PROVIDER.parseAuthRequest(request); }
    catch (error) {
      if (error instanceof AuthorizationError) throw new CalendarMcpError(400, error.code, "The Calendar authorization request is invalid. Restart the connection from TAP.");
      throw error;
    }
    const client = await env.OAUTH_PROVIDER.lookupClient(auth.clientId);
    if (!client || auth.responseType !== "code" || auth.codeChallengeMethod !== "S256" || !auth.codeChallenge ||
      auth.scope.length === 0 || auth.scope.some(scope => !CALENDAR_MCP_SCOPES.includes(scope as typeof CALENDAR_MCP_SCOPES[number]))) {
      throw new CalendarMcpError(400, "invalid_authorization", "A registered client, PKCE S256, and Calendar scopes are required.");
    }
    const session = random(32);
    const code = random(8);
    const name = (client.clientName || "Calendar specialist").slice(0, 160);
    await env.CALENDAR_DB.prepare(`INSERT INTO calendar_mcp_authorizations
      (session_hash, code_hash, request_json, client_name, expires_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(await digest(session), await digest(code), JSON.stringify(auth), name, new Date(Date.now() + 600_000).toISOString()).run();
    const cookie = `calendar_mcp_session=${session}; Path=/oauth/complete; Max-Age=600; HttpOnly; SameSite=Strict${url.protocol === "https:" ? "; Secure" : ""}`;
    return page("Connect TAP Calendar", `<p><strong>${escapeHtml(name)}</strong> requests Calendar access.</p><p>Open TAP Calendar → Automations. Enter this code in Connection code and review the requested permissions:</p><p><code>${code.match(/.{4}/gu)!.join("-")}</code></p><p>This code expires in 10 minutes. Enter it only if you started this connection.</p><form action="/oauth/complete" method="get"><button type="submit">I approved this connection in TAP Calendar</button></form>`, cookie);
  }
  const session = /(?:^|;\s*)calendar_mcp_session=([0-9a-f]{64})(?:;|$)/u.exec(request.headers.get("Cookie") ?? "")?.[1];
  if (!session) throw unavailable();
  const sessionHash = await digest(session);
  const now = new Date().toISOString();
  const row = await env.CALENDAR_DB.prepare(`SELECT request_json, client_name, expires_at, grant_id FROM calendar_mcp_authorizations
    WHERE session_hash = ? AND expires_at > ? AND consumed_at IS NULL`).bind(sessionHash, now).first<PendingAuthorization>();
  if (!row) throw unavailable();
  if (!row.grant_id) return page("Approval pending", '<p>Review and approve the code in TAP Calendar first.</p><form action="/oauth/complete" method="get"><button type="submit">Check approval</button></form>');
  const grant = await env.CALENDAR_DB.prepare("SELECT workspace_id, principal_id, scopes_json FROM calendar_mcp_grants WHERE id = ? AND revoked_at IS NULL")
    .bind(row.grant_id).first<{ workspace_id: string; principal_id: string; scopes_json: string }>();
  if (!grant) throw unavailable();
  const claim = await env.CALENDAR_DB.prepare("UPDATE calendar_mcp_authorizations SET consumed_at = ? WHERE session_hash = ? AND consumed_at IS NULL AND expires_at > ?")
    .bind(now, sessionHash, now).run();
  if (claim.meta.changes !== 1) throw unavailable();
  const scopes = mcpScopes.parse(JSON.parse(grant.scopes_json));
  const result = await env.OAUTH_PROVIDER.completeAuthorization({
    request: JSON.parse(row.request_json) as AuthRequest,
    userId: JSON.stringify([grant.workspace_id, grant.principal_id]), scope: scopes,
    metadata: { label: row.client_name },
    props: { workspace: grant.workspace_id, principal: grant.principal_id, grantId: row.grant_id, scopes },
  });
  return new Response(null, { status: 302, headers: { Location: result.redirectTo, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "Set-Cookie": `calendar_mcp_session=; Path=/oauth/complete; Max-Age=0; HttpOnly; SameSite=Strict${url.protocol === "https:" ? "; Secure" : ""}` } });
}
