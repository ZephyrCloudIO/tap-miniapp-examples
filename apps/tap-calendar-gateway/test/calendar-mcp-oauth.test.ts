import { env } from "cloudflare:workers";
import { SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createCalendarGatewayWorker } from "../src/index";
import { approveCalendarMcpAuthorization, reviewCalendarMcpAuthorization } from "../src/calendar-mcp-oauth";
import { listMcpGrants, requireMcpGrant, saveMcpConfiguration } from "../src/calendar-mcp-store";

const base = "https://calendar-gateway.test";
const owner = { workspace: "oauth-workspace", principal: "oauth-user" };
const digest = async (text: string) => btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
const json = (value: unknown) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
const organizer = (path: string, value?: unknown, principal = owner.principal) => new Request(`${base}${path}`, {
  ...(value === undefined ? {} : json(value)), headers: { "Content-Type": "application/json", "X-TAP-Workspace-Id": owner.workspace, "X-TAP-Principal-Id": principal },
});
async function start(scopes = "calendar.read calendar.analytics calendar.write") {
  const clientResponse = await SELF.fetch(`${base}/oauth/register`, json({ client_name: "Chloe", redirect_uris: ["http://localhost:24680/callback"], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" }));
  expect(clientResponse.status).toBe(201);
  const client = await clientResponse.json<{ client_id: string }>();
  const verifier = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
  const params = new URLSearchParams({ response_type: "code", client_id: client.client_id, redirect_uri: "http://localhost:24680/callback", scope: scopes, state: "client-state", code_challenge: await digest(verifier), code_challenge_method: "S256", resource: `${base}/mcp/live` });
  const response = await SELF.fetch(`${base}/oauth/authorize?${params}`);
  expect(response.status).toBe(200);
  const html = await response.text();
  const code = /<code>([a-f0-9-]+)<\/code>/u.exec(html)?.[1];
  expect(code).toBeTruthy();
  const cookie = response.headers.get("Set-Cookie")!.split(";")[0]!;
  expect(response.headers.get("Set-Cookie")).toContain("HttpOnly");
  return { code: code!, cookie, client, verifier, params };
}
async function finish(connection: Awaited<ReturnType<typeof start>>, scopes = ["calendar.read", "calendar.analytics", "calendar.write"]) {
  const approval = await SELF.fetch(organizer("/v1/mcp/authorizations/approve", { code: connection.code, scopes }));
  expect(approval.status).toBe(200);
  const complete = await SELF.fetch(`${base}/oauth/complete`, { headers: { Cookie: connection.cookie }, redirect: "manual" });
  expect(complete.status).toBe(302);
  const redirect = new URL(complete.headers.get("Location")!);
  expect(redirect.searchParams.get("state")).toBe("client-state");
  const token = await SELF.fetch(`${base}/oauth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", client_id: connection.client.client_id, code: redirect.searchParams.get("code")!, redirect_uri: "http://localhost:24680/callback", code_verifier: connection.verifier, resource: `${base}/mcp/live` }) });
  expect(token.status).toBe(200);
  return token.json<{ access_token: string; refresh_token: string }>();
}
async function rpc(token: string, method: string, params: unknown = {}) {
  return SELF.fetch(`${base}/mcp/live`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
}
async function body(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (response.headers.get("Content-Type")?.includes("text/event-stream")) return JSON.parse(text.split("\n").find(line => line.startsWith("data: "))!.slice(6));
  return JSON.parse(text);
}
beforeEach(async () => {
  await env.CALENDAR_DB.batch([
    env.CALENDAR_DB.prepare("DELETE FROM calendar_mcp_authorizations"),
    env.CALENDAR_DB.prepare("DELETE FROM calendar_mcp_grants"),
    env.CALENDAR_DB.prepare("DELETE FROM calendar_mcp_configuration"),
  ]);
  await saveMcpConfiguration(env.CALENDAR_DB, owner, { sourceRevision: 1, configuration: { conflictCalendarIds: [], eventTypes: [] } });
});

describe("Calendar OAuth transport and consent", () => {
  it("completes account consent and PKCE, lists real tools, then revokes an already issued token", async () => {
    const connection = await start();
    const review = await SELF.fetch(organizer("/v1/mcp/authorizations/review", { code: connection.code }));
    expect(await review.json()).toMatchObject({ clientName: "Chloe", redirectOrigin: "http://localhost:24680", scopes: ["calendar.read", "calendar.analytics", "calendar.write"] });
    const tokens = await finish(connection);
    const initialized = await rpc(tokens.access_token, "initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(initialized.status).toBe(200);
    expect(await body(initialized)).toHaveProperty("result");
    const listed = await body(await rpc(tokens.access_token, "tools/list"));
    expect(JSON.stringify(listed)).toContain('"create_event"');
    expect(JSON.stringify(listed)).toContain('"calendar_analytics"');
    const calendars = await body(await rpc(tokens.access_token, "tools/call", { name: "list_calendars", arguments: {} }));
    expect(calendars).toMatchObject({ result: { structuredContent: { calendars: [] } } });
    const { grants } = await listMcpGrants(env.CALENDAR_DB, owner);
    const revoke = organizer(`/v1/mcp/grants/${grants[0]!.id}`);
    expect((await SELF.fetch(new Request(revoke, { method: "DELETE" }))).status).toBe(200);
    expect((await rpc(tokens.access_token, "tools/list")).status).toBe(403);
    expect((await SELF.fetch(`${base}/oauth/complete`, { headers: { Cookie: connection.cookie }, redirect: "manual" })).status).toBe(404);
  });
  it("supports narrower consent and refresh scopes without reintroducing write authority", async () => {
    const connection = await start();
    const tokens = await finish(connection, ["calendar.read", "calendar.analytics"]);
    expect(JSON.stringify(await body(await rpc(tokens.access_token, "tools/list")))).not.toContain('"create_event"');
    const refreshed = await SELF.fetch(`${base}/oauth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", client_id: connection.client.client_id, refresh_token: tokens.refresh_token, scope: "calendar.analytics", resource: `${base}/mcp/live` }) });
    expect(refreshed.status).toBe(200);
    const token = await refreshed.json<{ access_token: string }>();
    const tools = JSON.stringify(await body(await rpc(token.access_token, "tools/list")));
    expect(tools).toContain('"calendar_analytics"');
    expect(tools).toContain('"list_calendars"');
    expect(tools).not.toContain('"get_event"');
    const denied = await body(await rpc(token.access_token, "tools/call", { name: "create_event", arguments: {} }));
    expect(denied).toHaveProperty("error");
  });
  it("requires the browser session, explicit pending consent, and correct owner when revoking", async () => {
    const connection = await start("calendar.read");
    expect((await SELF.fetch(`${base}/oauth/complete`)).status).toBe(404);
    const pending = await SELF.fetch(`${base}/oauth/complete`, { headers: { Cookie: connection.cookie } });
    expect(await pending.text()).toContain("Approval pending");
    await expect(approveCalendarMcpAuthorization(env, owner, { code: connection.code, scopes: ["calendar.write"] })).rejects.toMatchObject({ code: "invalid_scopes" });
    await approveCalendarMcpAuthorization(env, owner, { code: connection.code, scopes: ["calendar.read"] });
    await expect(approveCalendarMcpAuthorization(env, { ...owner, principal: "other" }, { code: connection.code, scopes: ["calendar.read"] })).rejects.toMatchObject({ code: "authorization_unavailable" });
    const { grants } = await listMcpGrants(env.CALENDAR_DB, owner);
    const foreignRevoke = organizer(`/v1/mcp/grants/${grants[0]!.id}`, undefined, "other");
    await SELF.fetch(new Request(foreignRevoke, { method: "DELETE" }));
    await expect(requireMcpGrant(env.CALENDAR_DB, { ...owner, grantId: grants[0]!.id, scopes: ["calendar.read"] }, "calendar.read")).resolves.toHaveProperty("grantId");
  });
  it("expires pending codes and refuses spoofed principal headers outside local development", async () => {
    const connection = await start("calendar.read");
    await env.CALENDAR_DB.prepare("UPDATE calendar_mcp_authorizations SET expires_at = '2000-01-01T00:00:00Z'").run();
    await expect(reviewCalendarMcpAuthorization(env, connection.code)).rejects.toMatchObject({ code: "authorization_unavailable" });
    const response = await createCalendarGatewayWorker().fetch(organizer("/v1/mcp/authorizations/approve", { code: connection.code, scopes: ["calendar.read"] }), { ...env, LOCAL_DEVELOPMENT: "false" });
    expect(response.status).toBe(401);
    expect((await SELF.fetch(`${base}/mcp/live`)).status).toBe(401);
  });
  it("rejects a different OAuth resource or a downgraded PKCE request before account consent", async () => {
    const connection = await start("calendar.read");
    const wrongResource = new URLSearchParams(connection.params);
    wrongResource.set("resource", "https://another-service.example/mcp");
    expect((await SELF.fetch(`${base}/oauth/authorize?${wrongResource}`, { redirect: "manual" })).status).toBe(400);
    const weakPkce = new URLSearchParams(connection.params);
    weakPkce.set("code_challenge_method", "plain");
    expect((await SELF.fetch(`${base}/oauth/authorize?${weakPkce}`, { redirect: "manual" })).status).toBe(400);
    const { grants } = await listMcpGrants(env.CALENDAR_DB, owner);
    expect(grants).toHaveLength(0);
  });
});
