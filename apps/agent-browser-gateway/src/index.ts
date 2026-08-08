import {
  ExternalTokenError,
  OAuthProvider,
  type ResolveExternalTokenInput,
  type ResolveExternalTokenResult,
  type TokenExchangeCallbackOptions,
  type TokenExchangeCallbackResult,
} from "@cloudflare/workers-oauth-provider";
import { WorkerEntrypoint } from "cloudflare:workers";
import {
  BrowserOwnerQuota,
  BrowserSessionCoordinator,
  browserRuntimeLimits,
  type RpcResult,
  type SessionRpcAuth,
} from "./control-plane";
import { captureBrowserSnapshot } from "./cloudflare-browser";
import {
  ApiError,
  KITESURF_ENGINE,
  configuredAllowedDomains,
  parseCloseWaitMs,
  parseSessionControlAssertionInput,
  parseSessionHandoffInput,
  parseSessionInput,
  parseSessionRenewInput,
  parseSnapshotInput,
  validateSessionId,
} from "./policy";
import {
  BROWSER_SNAPSHOT_CAPTURE_SCOPE,
  SESSION_TOKEN_HEADER,
  authenticateSnapshotRequest,
  randomSessionToken,
  sessionTokenFromRequest,
  verifyBrowserAssertion,
  type BrowserAssertionScope,
  type VerifiedBrowserAssertion,
} from "./security";
import { RemoteBrowserMcpEntrypoint } from "./mcp";
import {
  REMOTE_BROWSER_OAUTH_SCOPES,
  createLocalAuthorizationHandler,
  type RemoteBrowserMcpProps,
} from "./oauth";

export { BrowserOwnerQuota, BrowserSessionCoordinator };

const MAX_REQUEST_BYTES = 32 * 1024;
const OAUTH_OWNER_ID = /^[0-9A-Za-z][0-9A-Za-z._:@-]{0,127}$/u;
const OAUTH_ASSERTION_ID = /^[0-9A-Za-z_-]{16,192}$/u;

interface RemoteBrowserSnapshotProps extends RemoteBrowserMcpProps {
  readonly snapshotAssertion?: {
    readonly assertionId: string;
    readonly expiresAt: number;
  };
}

export interface AgentBrowserGateway {
  fetch(request: Request, env: Env): Promise<Response>;
}

function json(
  body: Readonly<Record<string, unknown>>,
  status = 200,
  headers: HeadersInit = {},
): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

function originSet(env: Env): ReadonlySet<string> {
  return new Set(
    env.ALLOWED_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

function corsHeaders(request: Request, env: Env): HeadersInit {
  const origin = request.headers.get("Origin");
  if (!origin) return {};
  if (!originSet(env).has(origin)) {
    throw new ApiError(403, "origin_denied", "This browser origin is not allowed.");
  }
  return {
    "Access-Control-Allow-Headers": `Authorization, Content-Type, ${SESSION_TOKEN_HEADER}`,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Expose-Headers":
      "X-Agent-Browser-Engine, X-Browser-Ms-Used",
    Vary: "Origin",
  };
}

async function readBoundedJson(request: Request): Promise<unknown> {
  if (!request.headers.get("Content-Type")?.toLowerCase().includes("application/json")) {
    throw new ApiError(415, "unsupported_media_type", "Content-Type must be application/json.");
  }
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) {
    throw new ApiError(413, "payload_too_large", "Request body is too large.");
  }
  if (!request.body) {
    throw new ApiError(400, "missing_body", "Request body is required.");
  }
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > MAX_REQUEST_BYTES) {
      await reader.cancel("request body too large");
      throw new ApiError(413, "payload_too_large", "Request body is too large.");
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  text += decoder.decode();
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, "invalid_json", "Request body is not valid JSON.");
  }
}

function withCors(response: Response, request: Request, env: Env): Response {
  const headers = new Headers(response.headers);
  const cors = corsHeaders(request, env);
  for (const [name, value] of Object.entries(cors)) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function safeSnapshotHeaders(upstream: Response): Headers {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "X-Agent-Browser-Engine": KITESURF_ENGINE,
    "X-Content-Type-Options": "nosniff",
  });
  for (const name of ["Content-Type", "X-Browser-Ms-Used"] as const) {
    const value = upstream.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return headers;
}

function logRequest(
  request: Request,
  status: number,
  details: Readonly<Record<string, unknown>> = {},
): void {
  console.log(
    JSON.stringify({
      message: "agent browser gateway request",
      method: request.method,
      path: new URL(request.url).pathname,
      status,
      ...details,
    }),
  );
}

function gatewayErrorResponse(
  request: Request,
  env: Env,
  error: unknown,
): Response {
  const apiError =
    error instanceof ApiError
      ? error
      : new ApiError(
          500,
          "internal_error",
          "The gateway could not complete the request.",
        );
  if (apiError.status >= 500) {
    console.error(
      JSON.stringify({
        message: "agent browser gateway failure",
        code: apiError.code,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
  let headers: HeadersInit = {};
  try {
    headers = corsHeaders(request, env);
  } catch {
    // Do not grant CORS when the origin itself was rejected.
  }
  if (
    new URL(request.url).pathname === "/v1/snapshot" &&
    apiError.status === 403 &&
    apiError.code === "insufficient_scope"
  ) {
    const url = new URL(request.url);
    headers = {
      ...headers,
      "WWW-Authenticate": [
        "Bearer",
        `resource_metadata="${url.origin}/.well-known/oauth-protected-resource/v1/snapshot"`,
        'error="insufficient_scope"',
        `scope="${BROWSER_SNAPSHOT_CAPTURE_SCOPE}"`,
      ].join(", "),
    };
  }
  return json(
    {
      ok: false,
      error: { code: apiError.code, message: apiError.message },
    },
    apiError.status,
    headers,
  );
}

function valueOrThrow<T>(result: RpcResult<T>): T {
  if (result.ok) return result.value;
  throw new ApiError(
    result.error.status,
    result.error.code,
    result.error.message,
  );
}

function decodedSessionId(value: string): string {
  try {
    return validateSessionId(decodeURIComponent(value));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "invalid_session_id", "Session ID is invalid.");
  }
}

function quotaCoordinator(env: Env, workspaceId: string) {
  return env.BROWSER_OWNER_QUOTAS.getByName(workspaceId);
}

async function consumeAssertionOnce(
  assertion: VerifiedBrowserAssertion,
  env: Env,
): Promise<void> {
  if (assertion.assertionId === null) return;
  valueOrThrow(
    await quotaCoordinator(env, assertion.owner.workspaceId).consumeAssertion(
      assertion.assertionId,
      assertion.expiresAt,
      Date.now(),
    ),
  );
}

function snapshotAssertionFromProps(
  value: unknown,
): VerifiedBrowserAssertion {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(401, "invalid_token", "The access token is invalid.");
  }
  const props = value as Readonly<Record<string, unknown>>;
  const ownerValue = props.owner;
  if (
    typeof props.userId !== "string" ||
    ownerValue === null ||
    typeof ownerValue !== "object" ||
    Array.isArray(ownerValue) ||
    !Array.isArray(props.scopes) ||
    props.scopes.length > 16 ||
    !props.scopes.every((scope) => typeof scope === "string")
  ) {
    throw new ApiError(401, "invalid_token", "The access token is invalid.");
  }
  const owner = ownerValue as Readonly<Record<string, unknown>>;
  const ownerFields = [
    owner.actorId,
    owner.workspaceId,
    owner.packageId,
    owner.installationId,
    owner.contributionId,
  ];
  if (
    !ownerFields.every(
      (field) => typeof field === "string" && OAUTH_OWNER_ID.test(field),
    ) ||
    props.userId !== owner.actorId
  ) {
    throw new ApiError(401, "invalid_token", "The access token is invalid.");
  }
  if (!props.scopes.includes(BROWSER_SNAPSHOT_CAPTURE_SCOPE)) {
    throw new ApiError(
      403,
      "insufficient_scope",
      "The access token does not grant browser snapshots.",
    );
  }

  const replayValue = props.snapshotAssertion;
  if (replayValue === undefined) {
    return {
      owner: {
        actorId: owner.actorId as string,
        workspaceId: owner.workspaceId as string,
        packageId: owner.packageId as string,
        installationId: owner.installationId as string,
        contributionId: owner.contributionId as string,
      },
      assertionId: null,
      expiresAt: Date.now() + 60_000,
    };
  }
  if (
    replayValue === null ||
    typeof replayValue !== "object" ||
    Array.isArray(replayValue)
  ) {
    throw new ApiError(401, "invalid_token", "The access token is invalid.");
  }
  const replay = replayValue as Readonly<Record<string, unknown>>;
  if (
    Object.keys(replay).length !== 2 ||
    typeof replay.assertionId !== "string" ||
    !OAUTH_ASSERTION_ID.test(replay.assertionId) ||
    !Number.isSafeInteger(replay.expiresAt) ||
    Number(replay.expiresAt) <= 0
  ) {
    throw new ApiError(401, "invalid_token", "The access token is invalid.");
  }
  return {
    owner: {
      actorId: owner.actorId as string,
      workspaceId: owner.workspaceId as string,
      packageId: owner.packageId as string,
      installationId: owner.installationId as string,
      contributionId: owner.contributionId as string,
    },
    assertionId: replay.assertionId,
    expiresAt: Number(replay.expiresAt),
  };
}

function snapshotPropsFromAssertion(
  assertion: VerifiedBrowserAssertion,
): RemoteBrowserSnapshotProps {
  return {
    userId: assertion.owner.actorId,
    owner: assertion.owner,
    scopes: [BROWSER_SNAPSHOT_CAPTURE_SCOPE],
    ...(assertion.assertionId === null
      ? {}
      : {
          snapshotAssertion: {
            assertionId: assertion.assertionId,
            expiresAt: assertion.expiresAt,
          },
        }),
  };
}

async function resolveExternalSnapshotToken(
  { request, env }: ResolveExternalTokenInput<Env>,
): Promise<ResolveExternalTokenResult | null> {
  const url = new URL(request.url);
  if (request.method !== "POST" || url.pathname !== "/v1/snapshot") {
    return null;
  }
  try {
    const assertion = await authenticateSnapshotRequest(request, env);
    return {
      props: snapshotPropsFromAssertion(assertion),
      audience: `${url.origin}${url.pathname}${url.search}`,
    };
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    if (error.status === 401) return null;
    if (error.status === 403 && error.code === "insufficient_scope") {
      throw new ExternalTokenError("insufficient_scope", {
        description: "The browser credential does not grant snapshots.",
        statusCode: 403,
        requiredScopes: [BROWSER_SNAPSHOT_CAPTURE_SCOPE],
      });
    }
    if (error.status === 503) {
      throw new ExternalTokenError("temporarily_unavailable", {
        description: "Browser credential validation is unavailable.",
        statusCode: 503,
      });
    }
    throw error;
  }
}

function accessTokenPropsForRequestedScopes(
  options: TokenExchangeCallbackOptions,
): TokenExchangeCallbackResult {
  if (
    options.props === null ||
    typeof options.props !== "object" ||
    Array.isArray(options.props)
  ) {
    throw new Error("Remote Browser OAuth grant props are invalid.");
  }
  return {
    // The provider can downscope an authorization-code or refresh exchange.
    // Token-specific props must follow that effective scope instead of the
    // broader grant props, because protected handlers receive ctx.props.
    accessTokenProps: {
      ...(options.props as Readonly<Record<string, unknown>>),
      scopes: options.requestedScope,
    },
  };
}

async function captureAuthenticatedSnapshot(
  request: Request,
  env: Env,
  assertion: VerifiedBrowserAssertion,
): Promise<Response> {
  // Validate the browser origin before consuming quota or browser time. The
  // OAuth provider performs token validation, but origin policy remains owned
  // by this protected resource.
  corsHeaders(request, env);
  const input = parseSnapshotInput(
    await readBoundedJson(request),
    env.ALLOWED_HOSTS,
  );
  await consumeAssertionOnce(assertion, env);
  valueOrThrow(
    await quotaCoordinator(env, assertion.owner.workspaceId).consumeSnapshot(
      assertion.owner.actorId,
      Date.now(),
    ),
  );
  const upstream = await captureBrowserSnapshot(input, env.ALLOWED_HOSTS, env);
  const response = withCors(
    new Response(upstream.body, {
      status: upstream.status,
      headers: safeSnapshotHeaders(upstream),
    }),
    request,
    env,
  );
  logRequest(request, response.status, {
    engine: input.engine,
    workspaceId: assertion.owner.workspaceId,
  });
  return response;
}

async function sessionAuthorization(
  request: Request,
  env: Env,
  scope: BrowserAssertionScope,
  consume: boolean,
): Promise<SessionRpcAuth> {
  const assertion = await verifyBrowserAssertion(request, env, scope);
  if (consume) await consumeAssertionOnce(assertion, env);
  return {
    owner: assertion.owner,
    sessionToken: sessionTokenFromRequest(request),
  };
}

function sessionCoordinator(env: Env, sessionId: string) {
  return env.BROWSER_SESSIONS.getByName(sessionId);
}

export function createAgentBrowserGateway(): AgentBrowserGateway {
  return {
    async fetch(request, env): Promise<Response> {
      try {
        const url = new URL(request.url);
        const cors = corsHeaders(request, env);

        if (request.method === "OPTIONS") {
          return new Response(null, { status: 204, headers: cors });
        }
        if (request.method === "GET" && url.pathname === "/health") {
          return json(
            {
              ok: true,
              service: "tap-agent-browser-gateway",
              engine: KITESURF_ENGINE,
              controlPlane: "durable-objects",
            },
            200,
            cors,
          );
        }

        if (request.method === "POST" && url.pathname === "/v1/snapshot") {
          const assertion = await authenticateSnapshotRequest(request, env);
          return await captureAuthenticatedSnapshot(request, env, assertion);
        }

        if (request.method === "POST" && url.pathname === "/v1/sessions") {
          const assertion = await verifyBrowserAssertion(
            request,
            env,
            "browser.session.create",
          );
          const input = parseSessionInput(
            await readBoundedJson(request),
            env.ALLOWED_HOSTS,
          );
          const allowedDomains = configuredAllowedDomains(env.ALLOWED_HOSTS);
          const runtimeLimits = browserRuntimeLimits(env);
          await consumeAssertionOnce(assertion, env);
          const sessionId = crypto.randomUUID();
          const sessionToken = randomSessionToken();
          const now = Date.now();
          const quota = quotaCoordinator(env, assertion.owner.workspaceId);
          valueOrThrow(
            await quota.reserveSession({
              sessionId,
              actorId: assertion.owner.actorId,
              // Keep the quota reservation until explicit close, with a
              // conservative fallback after the hard TTL plus Browser Run's
              // inactivity window. A delayed alarm must not undercount an
              // upstream browser that is still consuming concurrency.
              expiresAt:
                now + runtimeLimits.maxSessionLifetimeMs +
                runtimeLimits.browserRunInactivityTimeoutMs,
              now,
            }),
          );
          const created = await sessionCoordinator(env, sessionId).create({
            sessionId,
            sessionToken,
            owner: assertion.owner,
            input,
            allowedDomains,
            allowedHosts: env.ALLOWED_HOSTS,
            browserRunInactivityTimeoutMs:
              runtimeLimits.browserRunInactivityTimeoutMs,
            maxSessionLifetimeMs: runtimeLimits.maxSessionLifetimeMs,
            now,
          });
          if (!created.ok && created.error.code !== "session_already_initialized") {
            await quota.releaseSession(sessionId, assertion.owner.actorId);
          }
          const session = valueOrThrow(created);
          const response = json({ ok: true, session }, 201, cors);
          logRequest(request, response.status, {
            engine: input.engine,
            sessionId,
            workspaceId: assertion.owner.workspaceId,
          });
          return response;
        }

        const statusMatch = /^\/v1\/sessions\/([^/]+)$/u.exec(url.pathname);
        if (request.method === "GET" && statusMatch?.[1]) {
          const sessionId = decodedSessionId(statusMatch[1]);
          const auth = await sessionAuthorization(
            request,
            env,
            "browser.session.read",
            false,
          );
          const session = valueOrThrow(
            await sessionCoordinator(env, sessionId).get(auth),
          );
          const response = json({ ok: true, session }, 200, cors);
          logRequest(request, response.status, { sessionId });
          return response;
        }

        const renewMatch = /^\/v1\/sessions\/([^/]+)\/renew$/u.exec(url.pathname);
        if (request.method === "POST" && renewMatch?.[1]) {
          const sessionId = decodedSessionId(renewMatch[1]);
          const input = parseSessionRenewInput(await readBoundedJson(request));
          const auth = await sessionAuthorization(
            request,
            env,
            "browser.session.renew",
            true,
          );
          const session = valueOrThrow(
            await sessionCoordinator(env, sessionId).renew(
              auth,
              input.leaseMs,
              env.ALLOWED_HOSTS,
            ),
          );
          const response = json({ ok: true, session }, 200, cors);
          logRequest(request, response.status, { sessionId });
          return response;
        }

        const handoffMatch = /^\/v1\/sessions\/([^/]+)\/control\/handoff$/u.exec(
          url.pathname,
        );
        if (request.method === "POST" && handoffMatch?.[1]) {
          const sessionId = decodedSessionId(handoffMatch[1]);
          const input = parseSessionHandoffInput(await readBoundedJson(request));
          const auth = await sessionAuthorization(
            request,
            env,
            "browser.session.control",
            true,
          );
          const session = valueOrThrow(
            await sessionCoordinator(env, sessionId).handoff(auth, input),
          );
          const response = json({ ok: true, session }, 200, cors);
          logRequest(request, response.status, {
            sessionId,
            holder: session.control.holder,
            epoch: session.control.epoch,
          });
          return response;
        }

        const controlAssertionMatch =
          /^\/v1\/sessions\/([^/]+)\/control\/assert$/u.exec(url.pathname);
        if (request.method === "POST" && controlAssertionMatch?.[1]) {
          const sessionId = decodedSessionId(controlAssertionMatch[1]);
          const input = parseSessionControlAssertionInput(
            await readBoundedJson(request),
          );
          const auth = await sessionAuthorization(
            request,
            env,
            "browser.session.control",
            false,
          );
          const control = valueOrThrow(
            await sessionCoordinator(env, sessionId).assertControl(auth, input),
          );
          const response = json({ ok: true, control }, 200, cors);
          logRequest(request, response.status, {
            sessionId,
            holder: control.holder,
            epoch: control.epoch,
          });
          return response;
        }

        if (request.method === "DELETE" && statusMatch?.[1]) {
          const sessionId = decodedSessionId(statusMatch[1]);
          const waitMs = parseCloseWaitMs(url.searchParams.get("waitMs"));
          const auth = await sessionAuthorization(
            request,
            env,
            "browser.session.close",
            true,
          );
          const session = valueOrThrow(
            await sessionCoordinator(env, sessionId).close(auth, waitMs),
          );
          const status = session.state === "closed" ? 200 : 202;
          const response = json({ ok: true, session }, status, cors);
          logRequest(request, response.status, { sessionId, state: session.state });
          return response;
        }

        throw new ApiError(404, "not_found", "Route not found.");
      } catch (error) {
        return gatewayErrorResponse(request, env, error);
      }
    },
  };
}

export class RemoteBrowserSnapshotEntrypoint extends WorkerEntrypoint<
  Env,
  RemoteBrowserSnapshotProps
> {
  override async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.pathname !== "/v1/snapshot") {
        throw new ApiError(404, "not_found", "Route not found.");
      }
      if (request.method !== "POST") {
        throw new ApiError(405, "method_not_allowed", "Method not allowed.");
      }
      const assertion = snapshotAssertionFromProps(this.ctx.props);
      return await captureAuthenticatedSnapshot(request, this.env, assertion);
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status === 403 &&
        error.code === "insufficient_scope"
      ) {
        const url = new URL(request.url);
        return Response.json(
          {
            error: "insufficient_scope",
            error_description: error.message,
          },
          {
            status: 403,
            headers: {
              "Cache-Control": "no-store",
              "WWW-Authenticate": [
                "Bearer",
                `resource_metadata="${url.origin}/.well-known/oauth-protected-resource/v1/snapshot"`,
                'error="insufficient_scope"',
                `scope="${BROWSER_SNAPSHOT_CAPTURE_SCOPE}"`,
              ].join(", "),
            },
          },
        );
      }
      return gatewayErrorResponse(request, this.env, error);
    }
  }
}

const gateway = createAgentBrowserGateway();
const gatewayHandler: ExportedHandler<Env> = {
  fetch(request, env): Promise<Response> {
    return gateway.fetch(request, env);
  },
};

export default new OAuthProvider<Env>({
  apiHandlers: {
    "/mcp": RemoteBrowserMcpEntrypoint,
    "/v1/snapshot": RemoteBrowserSnapshotEntrypoint,
  },
  defaultHandler: createLocalAuthorizationHandler(gatewayHandler),
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/oauth/token",
  clientRegistrationEndpoint: "/oauth/register",
  clientIdMetadataDocumentEnabled: true,
  scopesSupported: [...REMOTE_BROWSER_OAUTH_SCOPES],
  resourceMetadata: {
    scopes_supported: [...REMOTE_BROWSER_OAUTH_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "TAP Remote Browser",
  },
  resolveExternalToken: resolveExternalSnapshotToken,
  tokenExchangeCallback: accessTokenPropsForRequestedScopes,
  accessTokenTTL: 3_600,
  refreshTokenTTL: 2_592_000,
});
