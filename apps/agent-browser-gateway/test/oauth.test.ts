import type {
  AuthRequest,
  CompleteAuthorizationOptions,
  OAuthHelpers,
} from "@cloudflare/workers-oauth-provider";
import { describe, expect, it, vi } from "vitest";
import { createLocalAuthorizationHandler } from "../src/oauth";

const PROTOCOL = "tap.remote-browser.oauth-installation-attestation.v1";
const SHARED_SECRET = "0123456789abcdef0123456789abcdef";

interface AttestationOwner {
  readonly actorId: string;
  readonly workspaceId: string;
  readonly packageId: string;
  readonly installationId: string;
  readonly contributionId: string;
}

function base64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/gu, "");
}

async function attestedClientName(
  owner: AttestationOwner,
  now = Math.floor(Date.now() / 1_000),
): Promise<string> {
  const encodedClaims = base64Url(
    new TextEncoder().encode(JSON.stringify({
      version: 1,
      iss: "tap-desktop-host",
      aud: "tap-agent-browser-gateway",
      sub: owner.actorId,
      workspace_id: owner.workspaceId,
      package_id: owner.packageId,
      installation_id: owner.installationId,
      contribution_id: owner.contributionId,
      iat: now,
      exp: now + 600,
    })),
  );
  const signingInput = `${PROTOCOL}.${encodedClaims}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SHARED_SECRET),
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

function authRequest(clientId: string): AuthRequest {
  return {
    responseType: "code",
    clientId,
    redirectUri: "http://127.0.0.1:1420/mcp-callback",
    scope: ["remote-browser"],
    state: `state-${clientId}`,
    codeChallenge: "challenge",
    codeChallengeMethod: "S256",
    issuer: "http://127.0.0.1:8787",
  };
}

function authorizationEnv(
  clients: ReadonlyMap<string, string>,
  completeAuthorization: (
    options: CompleteAuthorizationOptions,
  ) => Promise<{ redirectTo: string }>,
): Env {
  const helpers = {
    parseAuthRequest: vi.fn(async (request: Request) => {
      const clientId = new URL(request.url).searchParams.get("client_id");
      if (!clientId) throw new Error("fixture client_id is required");
      return authRequest(clientId);
    }),
    lookupClient: vi.fn(async (clientId: string) => {
      const clientName = clients.get(clientId);
      return clientName
        ? {
            clientId,
            clientName,
            redirectUris: ["http://127.0.0.1:1420/mcp-callback"],
            tokenEndpointAuthMethod: "none",
          }
        : null;
    }),
    completeAuthorization,
  } satisfies Partial<OAuthHelpers>;
  return {
    OAUTH_PROVIDER: helpers,
    MCP_LOCAL_INSTALLATION_ATTESTATION_SECRET: SHARED_SECRET,
    MCP_LOCAL_WORKSPACE_ID: "workspace-a",
    MCP_LOCAL_PACKAGE_ID: "package-a",
    MCP_LOCAL_CONTRIBUTION_ID: "remote-browser-tools",
    TAP_BROWSER_ASSERTION_ISSUER: "tap-desktop-host",
    TAP_BROWSER_ASSERTION_AUDIENCE: "tap-agent-browser-gateway",
  } as unknown as Env;
}

async function fetchHandler(
  handler: ExportedHandler<Env>,
  request: Request,
  env: Env,
): Promise<Response> {
  if (!handler.fetch) throw new Error("authorization handler has no fetch implementation");
  const fetch = handler.fetch as unknown as (
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ) => Promise<Response>;
  return fetch(request, env, {} as ExecutionContext);
}

async function approve(
  handler: ExportedHandler<Env>,
  env: Env,
  clientId: string,
): Promise<Response> {
  const url = `http://127.0.0.1:8787/authorize?client_id=${encodeURIComponent(clientId)}`;
  const consent = await fetchHandler(handler, new Request(url), env);
  expect(consent.status).toBe(200);
  const cookie = consent.headers.get("Set-Cookie")?.split(";", 1)[0];
  const csrfToken = (await consent.text()).match(/name="csrf_token" value="([^"]+)"/u)?.[1];
  expect(cookie).toBeTruthy();
  expect(csrfToken).toBeTruthy();
  return fetchHandler(handler, new Request(url, {
    method: "POST",
    headers: {
      Cookie: cookie ?? "",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      csrf_token: csrfToken ?? "",
      decision: "approve",
    }),
  }), env);
}

describe("local OAuth installation attestation", () => {
  it("allows the exact validated loopback callback through the consent form CSP", async () => {
    const clientName = await attestedClientName({
      actorId: "alice@example.com",
      workspaceId: "workspace-a",
      packageId: "package-a",
      installationId: "installation-a",
      contributionId: "remote-browser-tools",
    });
    const env = authorizationEnv(
      new Map([["client-a", clientName]]),
      vi.fn(async (_options: CompleteAuthorizationOptions) => ({
        redirectTo: "http://127.0.0.1:1420/mcp-callback?code=fixture",
      })),
    );
    const handler = createLocalAuthorizationHandler({
      fetch: () => Promise.resolve(new Response("not found", { status: 404 })),
    });

    const response = await fetchHandler(
      handler,
      new Request("http://127.0.0.1:8787/authorize?client_id=client-a"),
      env,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "form-action 'self' http://127.0.0.1:1420",
    );
    expect(response.headers.get("Content-Security-Policy")).not.toContain(
      "http://127.0.0.1:*",
    );
  });

  it("binds two app profiles for one human to their distinct verified installations", async () => {
    const first = {
      actorId: "alice@example.com",
      workspaceId: "workspace-a",
      packageId: "package-a",
      installationId: "installation-a",
      contributionId: "remote-browser-tools",
    } as const;
    const second = {
      actorId: "alice@example.com",
      workspaceId: "workspace-a",
      packageId: "package-a",
      installationId: "installation-b",
      contributionId: "remote-browser-tools",
    } as const;
    const clients = new Map([
      ["client-a", await attestedClientName(first)],
      ["client-b", await attestedClientName(second)],
    ]);
    const completeAuthorization = vi.fn(
      async (_options: CompleteAuthorizationOptions) => ({
        redirectTo: "http://127.0.0.1:1420/mcp-callback?code=fixture",
      }),
    );
    const env = authorizationEnv(clients, completeAuthorization);
    const handler = createLocalAuthorizationHandler({
      fetch: () => Promise.resolve(new Response("not found", { status: 404 })),
    });

    expect((await approve(handler, env, "client-a")).status).toBe(302);
    expect((await approve(handler, env, "client-b")).status).toBe(302);
    expect(completeAuthorization).toHaveBeenCalledTimes(2);
    expect(completeAuthorization.mock.calls[0]?.[0]).toMatchObject({
      userId: first.actorId,
      props: {
        userId: first.actorId,
        owner: {
          actorId: first.actorId,
          workspaceId: first.workspaceId,
          packageId: first.packageId,
          installationId: first.installationId,
          contributionId: first.contributionId,
        },
      },
    });
    expect(completeAuthorization.mock.calls[1]?.[0]).toMatchObject({
      userId: second.actorId,
      props: {
        userId: second.actorId,
        owner: {
          actorId: second.actorId,
          workspaceId: second.workspaceId,
          packageId: second.packageId,
          installationId: second.installationId,
          contributionId: second.contributionId,
        },
      },
    });
  });

  it("rejects a client that changes its installation after the host signature", async () => {
    const clientName = await attestedClientName({
      actorId: "alice@example.com",
      workspaceId: "workspace-a",
      packageId: "package-a",
      installationId: "installation-a",
      contributionId: "remote-browser-tools",
    });
    const [signature] = clientName.split(".").slice(-1);
    const encodedClaims = clientName.slice(PROTOCOL.length + 1, -(signature?.length ?? 0) - 1);
    const rawClaims = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(
          atob(encodedClaims.replace(/-/gu, "+").replace(/_/gu, "/") + "=".repeat((4 - encodedClaims.length % 4) % 4)),
          (character) => character.charCodeAt(0),
        ),
      ),
    ) as Record<string, unknown>;
    rawClaims.installation_id = "installation-attacker";
    const tamperedPayload = base64Url(
      new TextEncoder().encode(JSON.stringify(rawClaims)),
    );
    const tampered = `${PROTOCOL}.${tamperedPayload}.${signature}`;
    const completeAuthorization = vi.fn(
      async (_options: CompleteAuthorizationOptions) => ({
        redirectTo: "http://127.0.0.1:1420/mcp-callback?code=unused",
      }),
    );
    const env = authorizationEnv(new Map([["client-a", tampered]]), completeAuthorization);
    const handler = createLocalAuthorizationHandler({
      fetch: () => Promise.resolve(new Response("not found", { status: 404 })),
    });

    const response = await fetchHandler(
      handler,
      new Request("http://127.0.0.1:8787/authorize?client_id=client-a"),
      env,
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("OAuth client installation attestation is invalid.");
    expect(completeAuthorization).not.toHaveBeenCalled();
  });
});
