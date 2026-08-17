import {
  AuthorizationError,
  type AuthRequest,
  type OAuthHelpers,
} from "@cloudflare/workers-oauth-provider";
import {
  BROWSER_SNAPSHOT_CAPTURE_SCOPE,
  type BrowserOwner,
} from "./security";

export const REMOTE_BROWSER_MCP_SCOPE = "remote-browser" as const;
export const REMOTE_BROWSER_OAUTH_SCOPES = [
  REMOTE_BROWSER_MCP_SCOPE,
  BROWSER_SNAPSHOT_CAPTURE_SCOPE,
] as const;

export interface RemoteBrowserMcpProps {
  readonly [key: string]: unknown;
  readonly userId: string;
  readonly owner: BrowserOwner;
  readonly scopes: readonly string[];
}

type AuthorizationEnv = Env & { readonly OAUTH_PROVIDER: OAuthHelpers };

const CONSENT_COOKIE = "RemoteBrowserConsent";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const OWNER_ID = /^[0-9A-Za-z][0-9A-Za-z._:@-]{0,127}$/u;
const CLIENT_ATTESTATION_PROTOCOL =
  "tap.remote-browser.oauth-installation-attestation.v1";
const CLIENT_ATTESTATION_VERSION = 1;
const CLIENT_ATTESTATION_MAX_LENGTH = 4_096;
const CLIENT_ATTESTATION_MAX_LIFETIME_SECONDS = 10 * 60;
const CLIENT_ATTESTATION_CLOCK_SKEW_SECONDS = 60;
const CLIENT_ATTESTATION_SECRET_MIN_BYTES = 32;
const CLIENT_DISPLAY_NAME = "Zephyr";

interface InstallationAttestationClaims {
  readonly version: 1;
  readonly iss: string;
  readonly aud: string;
  readonly sub: string;
  readonly workspace_id: string;
  readonly package_id: string;
  readonly installation_id: string;
  readonly contribution_id: string;
  readonly iat: number;
  readonly exp: number;
}

class ClientAttestationError extends Error {
  constructor(
    readonly status: 400 | 503,
    message: string,
  ) {
    super(message);
    this.name = "ClientAttestationError";
  }
}

function hasOAuthHelpers(env: Env): env is AuthorizationEnv {
  const candidate = Reflect.get(env, "OAUTH_PROVIDER");
  return (
    candidate !== null &&
    typeof candidate === "object" &&
    typeof Reflect.get(candidate, "parseAuthRequest") === "function" &&
    typeof Reflect.get(candidate, "lookupClient") === "function" &&
    typeof Reflect.get(candidate, "completeAuthorization") === "function"
  );
}

function authorizationErrorResponse(error: AuthorizationError): Response {
  if (!error.redirectUri) {
    return new Response(error.description, {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  const redirect = new URL(error.redirectUri);
  redirect.searchParams.set("error", error.code);
  redirect.searchParams.set("error_description", error.description);
  if (error.state) redirect.searchParams.set("state", error.state);
  if (error.issuer) redirect.searchParams.set("iss", error.issuer);
  return Response.redirect(redirect, 302);
}

async function parseAuthorizationRequest(
  request: Request,
  env: AuthorizationEnv,
): Promise<AuthRequest | Response> {
  try {
    return await env.OAUTH_PROVIDER.parseAuthRequest(request);
  } catch (error) {
    if (error instanceof AuthorizationError) return authorizationErrorResponse(error);
    throw error;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#039;");
}

function formActionSource(redirectUri: string): string {
  const redirect = new URL(redirectUri);
  return redirect.protocol === "http:" || redirect.protocol === "https:"
    ? redirect.origin
    : redirect.protocol;
}

function securityHeaders(
  cookie: string | null = null,
  callbackSource: string | null = null,
): Headers {
  const formActions = ["'self'", ...(callbackSource ? [callbackSource] : [])];
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Security-Policy": [
      "default-src 'none'",
      "style-src 'unsafe-inline'",
      `form-action ${formActions.join(" ")}`,
      "frame-ancestors 'none'",
      "base-uri 'none'",
    ].join("; "),
    "Content-Type": "text/html; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  });
  if (cookie) headers.set("Set-Cookie", cookie);
  return headers;
}

function consentCookie(token: string, maxAge: number, secure: boolean): string {
  return `${CONSENT_COOKIE}=${token}; HttpOnly;${secure ? " Secure;" : ""} Path=/; SameSite=Strict; Max-Age=${maxAge}`;
}

function cookieValue(request: Request, name: string): string | null {
  const cookie = request.headers.get("Cookie") ?? "";
  for (const item of cookie.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() === name) {
      return item.slice(separator + 1).trim();
    }
  }
  return null;
}

async function tokensMatch(left: string | null, right: FormDataEntryValue | null): Promise<boolean> {
  if (!left || typeof right !== "string" || !right || left.length !== right.length) {
    return false;
  }
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

function base64UrlBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new ClientAttestationError(400, "OAuth client installation attestation is invalid.");
  }
  const padded = value.replace(/-/gu, "+").replace(/_/gu, "/") + "===".slice((value.length + 3) % 4);
  let decoded: string;
  try {
    decoded = atob(padded);
  } catch {
    throw new ClientAttestationError(400, "OAuth client installation attestation is invalid.");
  }
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function installationClaims(encoded: string): InstallationAttestationClaims {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(base64UrlBytes(encoded)));
  } catch (error) {
    if (error instanceof ClientAttestationError) throw error;
    throw new ClientAttestationError(400, "OAuth client installation attestation is invalid.");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ClientAttestationError(400, "OAuth client installation attestation is invalid.");
  }
  const claims = parsed as Readonly<Record<string, unknown>>;
  const expectedKeys = [
    "version",
    "iss",
    "aud",
    "sub",
    "workspace_id",
    "package_id",
    "installation_id",
    "contribution_id",
    "iat",
    "exp",
  ];
  if (
    Object.keys(claims).length !== expectedKeys.length ||
    !Object.keys(claims).every((key) => expectedKeys.includes(key)) ||
    claims.version !== CLIENT_ATTESTATION_VERSION ||
    typeof claims.iss !== "string" ||
    typeof claims.aud !== "string" ||
    typeof claims.sub !== "string" ||
    typeof claims.workspace_id !== "string" ||
    typeof claims.package_id !== "string" ||
    typeof claims.installation_id !== "string" ||
    typeof claims.contribution_id !== "string" ||
    !Number.isSafeInteger(claims.iat) ||
    !Number.isSafeInteger(claims.exp)
  ) {
    throw new ClientAttestationError(400, "OAuth client installation attestation is invalid.");
  }
  return claims as unknown as InstallationAttestationClaims;
}

function ownedBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function attestedOwner(
  env: Env,
  clientName: string | undefined,
  nowMs = Date.now(),
): Promise<RemoteBrowserMcpProps> {
  const entries = [
    ["MCP_LOCAL_WORKSPACE_ID", env.MCP_LOCAL_WORKSPACE_ID],
    ["MCP_LOCAL_PACKAGE_ID", env.MCP_LOCAL_PACKAGE_ID],
    ["MCP_LOCAL_CONTRIBUTION_ID", env.MCP_LOCAL_CONTRIBUTION_ID],
  ] as const;
  for (const [name, value] of entries) {
    if (!OWNER_ID.test(value)) {
      throw new ClientAttestationError(503, `${name} must be configured for local MCP authorization.`);
    }
  }
  const sharedSecret = env.MCP_LOCAL_INSTALLATION_ATTESTATION_SECRET;
  if (
    typeof sharedSecret !== "string" ||
    sharedSecret.trim() !== sharedSecret ||
    new TextEncoder().encode(sharedSecret).byteLength < CLIENT_ATTESTATION_SECRET_MIN_BYTES
  ) {
    throw new ClientAttestationError(
      503,
      "Remote Browser OAuth installation attestation is not configured.",
    );
  }
  if (
    typeof clientName !== "string" ||
    clientName.length > CLIENT_ATTESTATION_MAX_LENGTH ||
    !clientName.startsWith(`${CLIENT_ATTESTATION_PROTOCOL}.`)
  ) {
    throw new ClientAttestationError(400, "OAuth client installation attestation is required.");
  }
  const serialized = clientName.slice(CLIENT_ATTESTATION_PROTOCOL.length + 1);
  const separator = serialized.indexOf(".");
  if (separator <= 0 || separator !== serialized.lastIndexOf(".")) {
    throw new ClientAttestationError(400, "OAuth client installation attestation is invalid.");
  }
  const encodedClaims = serialized.slice(0, separator);
  const signature = base64UrlBytes(serialized.slice(separator + 1));
  if (signature.byteLength !== 32) {
    throw new ClientAttestationError(400, "OAuth client installation attestation is invalid.");
  }
  const signingInput = `${CLIENT_ATTESTATION_PROTOCOL}.${encodedClaims}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(sharedSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  if (
    !(await crypto.subtle.verify(
      "HMAC",
      key,
      ownedBuffer(signature),
      new TextEncoder().encode(signingInput),
    ))
  ) {
    throw new ClientAttestationError(400, "OAuth client installation attestation is invalid.");
  }

  const claims = installationClaims(encodedClaims);
  const now = Math.floor(nowMs / 1_000);
  const ownerValues = [
    claims.sub,
    claims.workspace_id,
    claims.package_id,
    claims.installation_id,
    claims.contribution_id,
  ];
  if (
    !ownerValues.every((value) => OWNER_ID.test(value)) ||
    claims.iss !== env.TAP_BROWSER_ASSERTION_ISSUER ||
    claims.aud !== env.TAP_BROWSER_ASSERTION_AUDIENCE ||
    claims.workspace_id !== env.MCP_LOCAL_WORKSPACE_ID ||
    claims.package_id !== env.MCP_LOCAL_PACKAGE_ID ||
    claims.contribution_id !== env.MCP_LOCAL_CONTRIBUTION_ID ||
    claims.iat > now + CLIENT_ATTESTATION_CLOCK_SKEW_SECONDS ||
    claims.exp < now - CLIENT_ATTESTATION_CLOCK_SKEW_SECONDS ||
    claims.exp <= claims.iat ||
    claims.exp - claims.iat > CLIENT_ATTESTATION_MAX_LIFETIME_SECONDS
  ) {
    throw new ClientAttestationError(400, "OAuth client installation attestation is invalid.");
  }
  return {
    userId: claims.sub,
    scopes: [],
    owner: {
      actorId: claims.sub,
      workspaceId: claims.workspace_id,
      packageId: claims.package_id,
      installationId: claims.installation_id,
      contributionId: claims.contribution_id,
    },
  };
}

function consentPage(
  request: Request,
  clientName: string,
  requestedScopes: readonly string[],
  csrfToken: string,
  redirectUri: string,
): Response {
  const url = new URL(request.url);
  const action = `${url.pathname}${url.search}`;
  const scopes = requestedScopes.map((scope) => `<li>${escapeHtml(scope)}</li>`).join("");
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Authorize Remote Browser</title>
    <style>
      :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, sans-serif; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #080a0f; color: #f5f7ff; }
      main { width: min(32rem, calc(100vw - 2rem)); border: 1px solid #34394b; border-radius: 1rem; padding: 1.5rem; background: #11141d; box-shadow: 0 1.5rem 4rem #0008; }
      h1 { margin: 0 0 .75rem; font-size: 1.35rem; }
      p, li { color: #b8bfd2; line-height: 1.5; }
      code { color: #d8ccff; }
      .actions { display: flex; justify-content: flex-end; gap: .75rem; margin-top: 1.5rem; }
      button { border: 1px solid #42495e; border-radius: .65rem; padding: .7rem 1rem; background: #1b2030; color: inherit; font: inherit; cursor: pointer; }
      button[value="approve"] { border-color: #7c5cff; background: #7047eb; font-weight: 700; }
    </style>
  </head>
  <body>
    <main>
      <h1>Authorize Remote Browser</h1>
      <p><strong>${escapeHtml(clientName)}</strong> is requesting local access to Cloudflare Kitesurf browser tools.</p>
      <p>This local authorization permits approved channel chat, selected specialists, and workflows in TAP to:</p>
      <ul>${scopes}</ul>
      <p>No browser session token, raw CDP connection, cookies, request headers, or response bodies are exposed to approved consumers.</p>
      <form method="post" action="${escapeHtml(action)}">
        <input type="hidden" name="csrf_token" value="${escapeHtml(csrfToken)}">
        <div class="actions">
          <button type="submit" name="decision" value="deny">Deny</button>
          <button type="submit" name="decision" value="approve">Accept</button>
        </div>
      </form>
    </main>
  </body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: securityHeaders(
      consentCookie(csrfToken, 600, new URL(request.url).protocol === "https:"),
      formActionSource(redirectUri),
    ),
  });
}

function deniedRedirect(oauthRequest: AuthRequest): Response {
  const redirect = new URL(oauthRequest.redirectUri);
  redirect.searchParams.set("error", "access_denied");
  redirect.searchParams.set("error_description", "Remote Browser access was not approved.");
  redirect.searchParams.set("state", oauthRequest.state);
  if (oauthRequest.issuer) redirect.searchParams.set("iss", oauthRequest.issuer);
  return Response.redirect(redirect, 302);
}

export function createLocalAuthorizationHandler(
  fallback: ExportedHandler<Env>,
): ExportedHandler<Env> {
  return {
    async fetch(request, env, ctx): Promise<Response> {
      const url = new URL(request.url);
      if (url.pathname !== "/authorize") {
        if (!fallback.fetch) return new Response("Not found", { status: 404 });
        return fallback.fetch(request, env, ctx);
      }
      if (!LOCAL_HOSTS.has(url.hostname)) {
        return new Response("Remote Browser local authorization is available only on loopback.", {
          status: 403,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
      if (request.method !== "GET" && request.method !== "POST") {
        return new Response("Method not allowed", {
          status: 405,
          headers: { Allow: "GET, POST" },
        });
      }
      if (!hasOAuthHelpers(env)) {
        return new Response("OAuth authorization is unavailable.", { status: 503 });
      }
      const parsed = await parseAuthorizationRequest(request, env);
      if (parsed instanceof Response) return parsed;
      const client = await env.OAUTH_PROVIDER.lookupClient(parsed.clientId);
      if (!client) return new Response("Unknown OAuth client", { status: 400 });
      let props: RemoteBrowserMcpProps;
      try {
        props = await attestedOwner(env, client.clientName);
      } catch (error) {
        if (error instanceof ClientAttestationError) {
          return new Response(error.message, {
            status: error.status,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        }
        throw error;
      }
      if (request.method === "GET") {
        return consentPage(
          request,
          CLIENT_DISPLAY_NAME,
          parsed.scope,
          crypto.randomUUID(),
          parsed.redirectUri,
        );
      }

      const form = await request.formData();
      const validCsrf = await tokensMatch(
        cookieValue(request, CONSENT_COOKIE),
        form.get("csrf_token"),
      );
      if (!validCsrf) {
        return new Response("Consent validation failed", {
          status: 403,
          headers: securityHeaders(
            consentCookie("", 0, url.protocol === "https:"),
          ),
        });
      }
      if (form.get("decision") !== "approve") return deniedRedirect(parsed);

      const grantedScopes = parsed.scope.filter((scope) =>
        REMOTE_BROWSER_OAUTH_SCOPES.some(
          (supportedScope) => scope === supportedScope,
        ),
      );
      const grantedProps: RemoteBrowserMcpProps = {
        ...props,
        scopes: grantedScopes,
      };
      const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
        request: parsed,
        userId: props.userId,
        metadata: { clientName: CLIENT_DISPLAY_NAME },
        scope: grantedScopes,
        props: grantedProps,
      });
      const redirected = Response.redirect(redirectTo, 302);
      const headers = new Headers(redirected.headers);
      headers.set(
        "Set-Cookie",
        consentCookie("", 0, url.protocol === "https:"),
      );
      return new Response(null, { status: 302, headers });
    },
  };
}
