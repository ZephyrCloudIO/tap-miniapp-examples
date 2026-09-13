import { env } from "cloudflare:workers";
import { reset, SELF } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import type { BrowserAssertionScope } from "../src/security";

const INSTALLATION_ATTESTATION_PROTOCOL =
  "tap.remote-browser.oauth-installation-attestation.v1";
const INSTALLATION_ATTESTATION_SECRET =
  "0123456789abcdef0123456789abcdef";
const SNAPSHOT_SCOPE = "browser.snapshot.capture";
const REDIRECT_URI = "http://127.0.0.1:1420/mcp-callback";
const OAUTH_ORIGIN = "http://127.0.0.1:8787";
const MCP_RESOURCE = `${OAUTH_ORIGIN}/mcp`;
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const signingJwk: JsonWebKey = {
  kty: "OKP",
  crv: "Ed25519",
  x: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo",
  d: "nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A",
};

interface OAuthTokenResponse {
  readonly access_token: string;
  readonly scope: string;
  readonly token_type: string;
}

function base64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/gu, "");
}

async function installationAttestation(): Promise<string> {
  const now = Math.floor(Date.now() / 1_000);
  const encodedClaims = base64Url(
    new TextEncoder().encode(JSON.stringify({
      version: 1,
      iss: "tap-desktop-host",
      aud: "tap-agent-browser-gateway",
      sub: "zack@zephyr-cloud.io",
      workspace_id: "kitesurf-test",
      package_id: "tap_pkg_examples_agent_browser_prototype_0001",
      installation_id: `oauth-workflow-${crypto.randomUUID()}`,
      contribution_id: "remote-browser-tools",
      iat: now,
      exp: now + 600,
    })),
  );
  const signingInput = `${INSTALLATION_ATTESTATION_PROTOCOL}.${encodedClaims}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(INSTALLATION_ATTESTATION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64Url(new Uint8Array(signature))}`;
}

async function packageAccessToken(
  scopes: readonly string[],
  tokenScopes?: readonly string[],
): Promise<OAuthTokenResponse> {
  const registration = await SELF.fetch(`${OAUTH_ORIGIN}/oauth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: await installationAttestation(),
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
    }),
  });
  expect(registration.status, await registration.clone().text()).toBe(201);
  const { client_id: clientId } = await registration.json<{ client_id: string }>();

  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64Url(new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  ));
  const state = crypto.randomUUID();
  const authorizeUrl = new URL("/authorize", OAUTH_ORIGIN);
  authorizeUrl.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope: scopes.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: MCP_RESOURCE,
  }).toString();

  const consent = await SELF.fetch(new Request(authorizeUrl, {
    redirect: "manual",
  }));
  expect(consent.status, await consent.clone().text()).toBe(200);
  const consentHtml = await consent.text();
  const csrfToken = consentHtml.match(
    /name="csrf_token" value="([^"]+)"/u,
  )?.[1];
  const cookie = consent.headers.get("Set-Cookie")?.split(";", 1)[0];
  expect(csrfToken).toBeTruthy();
  expect(cookie).toBeTruthy();

  const approval = await SELF.fetch(new Request(authorizeUrl, {
    method: "POST",
    redirect: "manual",
    headers: {
      Cookie: cookie ?? "",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      csrf_token: csrfToken ?? "",
      decision: "approve",
    }),
  }));
  expect(approval.status, await approval.clone().text()).toBe(302);
  const redirect = new URL(approval.headers.get("Location") ?? "");
  expect(redirect.searchParams.get("state")).toBe(state);
  const code = redirect.searchParams.get("code");
  expect(code).toBeTruthy();

  const tokenRequest = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    code: code ?? "",
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
    resource: MCP_RESOURCE,
  });
  if (tokenScopes) tokenRequest.set("scope", tokenScopes.join(" "));
  const exchange = await SELF.fetch(`${OAUTH_ORIGIN}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenRequest,
  });
  expect(exchange.status, await exchange.clone().text()).toBe(200);
  return exchange.json<OAuthTokenResponse>();
}

async function signedAssertion(scope: BrowserAssertionScope): Promise<string> {
  const now = Math.floor(Date.now() / 1_000);
  const header = base64Url(new TextEncoder().encode(JSON.stringify({
    alg: "EdDSA",
    typ: "JWT",
    kid: "tap-browser-v1",
  })));
  const payload = base64Url(new TextEncoder().encode(JSON.stringify({
    iss: "tap-desktop-host",
    aud: "tap-agent-browser-gateway",
    sub: "actor-a",
    workspace_id: "workspace-a",
    package_id: "package-a",
    installation_id: "installation-a",
    contribution_id: "contribution-a",
    jti: `assertion-${crypto.randomUUID()}`,
    iat: now,
    nbf: now,
    exp: now + 60,
    scope: [scope],
  })));
  const key = await crypto.subtle.importKey(
    "jwk",
    signingJwk,
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { name: "Ed25519" },
    key,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${base64Url(new Uint8Array(signature))}`;
}

function snapshotRequest(
  token: string,
  target = "oauth-snapshot",
  pathname = "/mcp/v1/snapshot",
): Request {
  return new Request(`${OAUTH_ORIGIN}${pathname}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url: `https://example.com/?browserTest=${target}`,
      engine: "kitesurf",
      formats: ["screenshot", "markdown"],
    }),
  });
}

function mcpRequest(token: string): Request {
  return new Request(`${OAUTH_ORIGIN}/mcp`, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Host: "127.0.0.1:8787",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "workflow-token-test", version: "1.0.0" },
      },
    }),
  });
}

afterEach(async () => {
  await env.BROWSER.fetch("https://browser.internal/__test/reset", {
    method: "POST",
  });
  await reset();
});

describe("package OAuth snapshot authorization", () => {
  it("uses one installation-bound access token for MCP and workflow snapshots", async () => {
    const token = await packageAccessToken(["remote-browser", SNAPSHOT_SCOPE]);
    expect(token.scope.split(" ").sort()).toEqual([
      SNAPSHOT_SCOPE,
      "remote-browser",
    ].sort());

    const mcp = await SELF.fetch(mcpRequest(token.access_token));
    expect(mcp.status, await mcp.clone().text()).toBe(200);

    const snapshot = await SELF.fetch(snapshotRequest(token.access_token));
    expect(snapshot.status, await snapshot.clone().text()).toBe(200);
    expect(snapshot.headers.get("X-Agent-Browser-Engine")).toBe("kitesurf");
    expect(await snapshot.json()).toMatchObject({
      success: true,
      result: { screenshot: PNG_BASE64, markdown: "# Example" },
    });

    const outsideAudience = await SELF.fetch(
      snapshotRequest(token.access_token, "outside-audience", "/v1/snapshot"),
    );
    expect(outsideAudience.status).toBe(401);
    expect(await outsideAudience.json()).toMatchObject({
      error: "invalid_token",
    });
  });

  it("requires the exact snapshot scope on a package access token", async () => {
    const token = await packageAccessToken(
      ["remote-browser", SNAPSHOT_SCOPE],
      ["remote-browser"],
    );
    expect(token.scope).toBe("remote-browser");
    const response = await SELF.fetch(snapshotRequest(token.access_token));

    expect(response.status).toBe(403);
    expect(response.headers.get("WWW-Authenticate")).toContain(
      `scope="${SNAPSHOT_SCOPE}"`,
    );
    expect(await response.json()).toMatchObject({
      error: "insufficient_scope",
    });
  });

  it("preserves production-owned snapshot credentials without granting MCP access", async () => {
    const hostAssertion = await signedAssertion("browser.snapshot.capture");
    const [serviceSnapshot, hostSnapshot, legacyServiceSnapshot] =
      await Promise.all([
        SELF.fetch(snapshotRequest("fixture-workflow-token", "service-snapshot")),
        SELF.fetch(snapshotRequest(hostAssertion, "host-snapshot")),
        SELF.fetch(
          snapshotRequest(
            "fixture-workflow-token",
            "legacy-service-snapshot",
            "/v1/snapshot",
          ),
        ),
      ]);
    expect(
      serviceSnapshot.status,
      await serviceSnapshot.clone().text(),
    ).toBe(200);
    expect(hostSnapshot.status, await hostSnapshot.clone().text()).toBe(200);
    expect(
      legacyServiceSnapshot.status,
      await legacyServiceSnapshot.clone().text(),
    ).toBe(200);

    const replay = await SELF.fetch(
      snapshotRequest(hostAssertion, "host-replay"),
    );
    expect(replay.status).toBe(409);
    expect(await replay.json()).toMatchObject({
      error: { code: "assertion_replayed" },
    });

    const wrongHostScope = await SELF.fetch(
      snapshotRequest(
        await signedAssertion("browser.session.create"),
        "wrong-host-scope",
      ),
    );
    expect(wrongHostScope.status).toBe(403);
    expect(wrongHostScope.headers.get("WWW-Authenticate")).toContain(
      `scope="${SNAPSHOT_SCOPE}"`,
    );
    expect(await wrongHostScope.json()).toMatchObject({
      error: "insufficient_scope",
    });

    const [serviceMcp, hostMcp] = await Promise.all([
      SELF.fetch(mcpRequest("fixture-workflow-token")),
      SELF.fetch(mcpRequest(await signedAssertion("browser.snapshot.capture"))),
    ]);
    expect(serviceMcp.status).toBe(401);
    expect(hostMcp.status).toBe(401);
  });
});
