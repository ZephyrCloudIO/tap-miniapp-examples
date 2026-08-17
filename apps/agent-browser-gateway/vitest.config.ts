import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

let sessionSequence = 0;
let lastSessionMethods: string[] = [];
let malformedNextTarget = false;

type SnapshotAction =
  | "screenshot"
  | "markdown"
  | "accessibilityTree"
  | "content";

interface SnapshotActionCall {
  readonly action: SnapshotAction;
  readonly method: string;
  readonly pathname: string;
  readonly browser: string | null;
  readonly cacheTTL: string | null;
  readonly authorization: string | null;
  readonly body: Readonly<Record<string, unknown>>;
}

const snapshotActionCalls = new Map<string, SnapshotActionCall[]>();
let inFlightSnapshotActions = 0;
let peakInFlightSnapshotActions = 0;

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const ACTION_BROWSER_MS: Readonly<Record<SnapshotAction, number>> = {
  screenshot: 101,
  markdown: 202,
  accessibilityTree: 303,
  content: 404,
};
const SNAPSHOT_ACTION_PATH =
  /\/(screenshot|markdown|accessibilityTree|content)$/u;
const SCREENSHOT_ACTION_RESPONSE_LIMIT = 6 * 1024 * 1024;
const CONTENT_ACTION_RESPONSE_LIMIT = 4 * 1024 * 1024;
const ACCESSIBILITY_ACTION_RESPONSE_LIMIT = 2 * 1024 * 1024;

function responseBody(value: Uint8Array): ArrayBuffer {
  const body = new ArrayBuffer(value.byteLength);
  new Uint8Array(body).set(value);
  return body;
}

function decodeBase64(value: string): ArrayBuffer {
  const binary = atob(value);
  return responseBody(
    Uint8Array.from(binary, (character) => character.charCodeAt(0)),
  );
}

function exactSizedPng(byteLength: number): ArrayBuffer {
  const bytes = new Uint8Array(byteLength);
  bytes.set(new Uint8Array(decodeBase64(PNG_BASE64)).subarray(0, 8));
  return responseBody(bytes);
}

function exactSizedJson(
  byteLength: number,
  build: (padding: string) => Readonly<Record<string, unknown>>,
): string {
  const empty = JSON.stringify(build(""));
  const paddingLength = byteLength - new TextEncoder().encode(empty).byteLength;
  if (paddingLength < 0) throw new Error("JSON fixture exceeds its target size");
  const body = JSON.stringify(build("x".repeat(paddingLength)));
  if (new TextEncoder().encode(body).byteLength !== byteLength) {
    throw new Error("JSON fixture did not reach its exact target size");
  }
  return body;
}

async function holdSnapshotAction(): Promise<void> {
  inFlightSnapshotActions += 1;
  peakInFlightSnapshotActions = Math.max(
    peakInFlightSnapshotActions,
    inFlightSnapshotActions,
  );
  try {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 40);
    });
  } finally {
    inFlightSnapshotActions -= 1;
  }
}

function snapshotAction(pathname: string): SnapshotAction | null {
  const match = SNAPSHOT_ACTION_PATH.exec(pathname);
  return (match?.[1] as SnapshotAction | undefined) ?? null;
}

function actionHeaders(action: SnapshotAction): Headers {
  return new Headers({
    "X-Browser-Ms-Used": String(ACTION_BROWSER_MS[action]),
    "X-Upstream-Internal": "must-not-cross-boundary",
    "Set-Cookie": "upstream-cookie=must-not-cross-boundary",
  });
}

function resetBrowserRunTestState(): void {
  sessionSequence = 0;
  lastSessionMethods = [];
  malformedNextTarget = false;
  snapshotActionCalls.clear();
  inFlightSnapshotActions = 0;
  peakInFlightSnapshotActions = 0;
}

async function browserRunTestService(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/__test/reset" && request.method === "POST") {
    resetBrowserRunTestState();
    return new Response(null, { status: 204 });
  }
  if (url.pathname === "/__test/snapshot-action-calls") {
    return Response.json({
      calls: snapshotActionCalls.get(url.searchParams.get("url") ?? "") ?? [],
    });
  }
  if (url.pathname === "/__test/snapshot-action-concurrency") {
    return Response.json({
      inFlight: inFlightSnapshotActions,
      peakInFlight: peakInFlightSnapshotActions,
    });
  }
  if (url.pathname === "/__test/last-session-methods") {
    return Response.json({ methods: lastSessionMethods });
  }
  if (url.pathname === "/__test/malformed-next-target" && request.method === "POST") {
    malformedNextTarget = true;
    return new Response(null, { status: 204 });
  }
  const action = snapshotAction(url.pathname);
  if (request.method === "POST" && action !== null) {
    const body = await request.clone().json<Record<string, unknown>>();
    const targetUrl = String(body.url ?? "");
    const calls = snapshotActionCalls.get(targetUrl) ?? [];
    calls.push({
      action,
      method: request.method,
      pathname: url.pathname,
      browser: url.searchParams.get("browser"),
      cacheTTL: url.searchParams.get("cacheTTL"),
      authorization: request.headers.get("Authorization"),
      body,
    });
    snapshotActionCalls.set(targetUrl, calls);
    const scenario = new URL(targetUrl).searchParams.get("browserTest");
    if (scenario === "fanout-concurrency") await holdSnapshotAction();
    if (scenario === "first-wave-failure" && action === "content") {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 40);
      });
    }
    if (scenario === "first-wave-failure" && action === "markdown") {
      return Response.json(
        { success: false, errors: [{ code: 9877, message: "first wave failed" }] },
        { status: 503 },
      );
    }
    if (scenario === "upstream-error" && action === "markdown") {
      return Response.json(
        {
          success: false,
          errors: [{ code: 9876, message: "sensitive upstream diagnostic" }],
        },
        {
          status: 403,
          headers: {
            "Set-Cookie": "upstream-cookie=secret",
            "X-Browser-Ms-Used": String(ACTION_BROWSER_MS[action]),
          },
        },
      );
    }
    if (scenario === "transport-error" && action === "markdown") {
      throw new Error(`Fetch failed for ${targetUrl}`);
    }

    const headers = actionHeaders(action);
    if (action === "screenshot") {
      headers.set(
        "Content-Type",
        scenario === "invalid-screenshot-media-type"
          ? "application/octet-stream"
          : "image/png",
      );
      return new Response(
        scenario === "invalid-screenshot-png"
          ? responseBody(new TextEncoder().encode("not a png"))
          : scenario === "screenshot-at-limit"
            ? exactSizedPng(SCREENSHOT_ACTION_RESPONSE_LIMIT)
            : scenario === "screenshot-over-limit"
              ? exactSizedPng(SCREENSHOT_ACTION_RESPONSE_LIMIT + 1)
              : scenario === "combined-oversized"
                ? (() => {
                    const bytes = new Uint8Array(5_900_000);
                    bytes.set(
                      new Uint8Array(decodeBase64(PNG_BASE64)).subarray(0, 8),
                    );
                    return responseBody(bytes);
                  })()
                : decodeBase64(PNG_BASE64),
        { headers },
      );
    }

    headers.set("Content-Type", "application/json");
    if (action === "markdown") {
      return Response.json(
        {
          success: true,
          result:
            scenario === "action-oversized"
              ? "x".repeat(8_500_000)
              : scenario === "combined-oversized"
                ? "x".repeat(5_500_000)
                : "# Example",
        },
        { headers },
      );
    }
    if (action === "content") {
      const contentLimitDelta = scenario === "content-at-limit"
        ? 0
        : scenario === "content-over-limit"
          ? 1
          : null;
      if (contentLimitDelta !== null) {
        return new Response(
          exactSizedJson(
            CONTENT_ACTION_RESPONSE_LIMIT + contentLimitDelta,
            (padding) => ({
              success: true,
              result: padding,
              meta: { status: 200, title: "Example" },
            }),
          ),
          { headers },
        );
      }
      return Response.json(
        {
          success: true,
          result:
            scenario === "combined-oversized"
              ? "x".repeat(3_000_000)
              : "<html><body><h1>Example</h1></body></html>",
          meta: { status: 200, title: "Example" },
        },
        { headers },
      );
    }
    const accessibilityLimitDelta = scenario === "accessibility-at-limit"
      ? 0
      : scenario === "accessibility-over-limit"
        ? 1
        : null;
    if (accessibilityLimitDelta !== null) {
      return new Response(
        exactSizedJson(
          ACCESSIBILITY_ACTION_RESPONSE_LIMIT + accessibilityLimitDelta,
          (padding) => ({
            success: true,
            result: {
              accessibilityTree: { role: "RootWebArea", name: padding },
            },
            meta: { status: 200, title: "Example" },
          }),
        ),
        { headers },
      );
    }
    const accessibilityMeta = scenario === "inconsistent-title"
      ? { status: 200, title: "Changed" }
      : scenario === "inconsistent-status"
        ? { status: 204, title: "Example" }
        : { status: 200, title: "Example" };
    return Response.json(
      {
        success: true,
        result: {
          accessibilityTree: {
            role: "RootWebArea",
            name: "Example",
            children: [{ role: "heading", name: "Example", level: 1 }],
          },
        },
        meta: accessibilityMeta,
      },
      { headers },
    );
  }
  if (request.method === "POST" && url.pathname.endsWith("/devtools/browser")) {
    sessionSequence += 1;
    lastSessionMethods = ["POST"];
    return Response.json({ sessionId: `upstream-${sessionSequence}` });
  }
  const targetCreate =
    /\/devtools\/browser\/(upstream-\d+)\/json\/new$/u.exec(url.pathname);
  if (request.method === "PUT" && targetCreate?.[1]) {
    lastSessionMethods.push("PUT");
    const sequence = targetCreate[1].slice("upstream-".length);
    const targetUrl = url.searchParams.get("url");
    if (malformedNextTarget) {
      malformedNextTarget = false;
      return Response.json({
        id: `target-${sequence}`,
        url: targetUrl,
      });
    }
    return Response.json({
      id: `target-${sequence}`,
      url: targetUrl,
      devtoolsFrontendUrl:
        `https://live.browser.run/ui/view?wss=socket-${sequence}&jwt=current`,
    });
  }
  const targetList =
    /\/devtools\/browser\/(upstream-\d+)\/json\/list$/u.exec(url.pathname);
  if (request.method === "GET" && targetList?.[1]) {
    const sequence = targetList[1].slice("upstream-".length);
    return Response.json([
      {
        id: `target-${sequence}`,
        url: "https://example.com/",
        devtoolsFrontendUrl:
          `https://live.browser.run/ui/view?wss=socket-${sequence}&jwt=renewed`,
      },
    ]);
  }
  if (
    request.method === "DELETE" &&
    /\/devtools\/browser\/upstream-\d+$/u.test(url.pathname)
  ) {
    lastSessionMethods.push("DELETE");
    return Response.json({ status: "closing" });
  }
  if (
    request.method === "GET" &&
    /\/devtools\/session\/upstream-\d+$/u.test(url.pathname)
  ) {
    return Response.json({
      sessionId: url.pathname.split("/").at(-1),
      endTime: Date.now(),
      closeReason: "requested",
    });
  }
  return Response.json(
    { success: false, errors: [{ message: "Unexpected test Browser Run request" }] },
    { status: 500 },
  );
}

export default defineConfig({
  // All files exercise the same stateful Browser service binding. Keep files
  // serial so one file's explicit reset cannot erase another file's assertions.
  test: { fileParallelism: false },
  plugins: [
    cloudflareTest(() => ({
      wrangler: { configPath: "./wrangler.test.jsonc" },
      miniflare: {
        compatibilityDate: "2026-07-21",
        serviceBindings: { BROWSER: "browser-run-cdp-test" },
        workers: [
          {
            name: "browser-run-cdp-test",
            compatibilityDate: "2026-07-21",
            scriptPath: new URL(
              "./test/browser-run-cdp-service.mjs",
              import.meta.url,
            ).pathname,
            modules: true,
            durableObjects: { CDP_SESSIONS: "CdpSession" },
            serviceBindings: { HTTP_BROWSER_TEST: browserRunTestService },
          },
        ],
        kvNamespaces: ["OAUTH_KV"],
        bindings: {
          TAP_BROWSER_ASSERTION_PUBLIC_JWK:
            '{"kty":"OKP","crv":"Ed25519","kid":"tap-browser-v1","x":"11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo"}',
          TAP_BROWSER_ASSERTION_ISSUER: "tap-desktop-host",
          TAP_BROWSER_ASSERTION_AUDIENCE: "tap-agent-browser-gateway",
          MCP_LOCAL_INSTALLATION_ATTESTATION_SECRET:
            "0123456789abcdef0123456789abcdef",
          WORKFLOW_SERVICE_TOKEN: "fixture-workflow-token",
          WORKFLOW_SERVICE_ACTOR_ID: "ze-workflows",
          WORKFLOW_SERVICE_WORKSPACE_ID: "fixture-workspace",
          WORKFLOW_SERVICE_PACKAGE_ID: "ze-workflows",
          WORKFLOW_SERVICE_INSTALLATION_ID: "fixture-installation",
          WORKFLOW_SERVICE_CONTRIBUTION_ID: "agent-browser-snapshot",
          MAX_ACTIVE_SESSIONS_PER_WORKSPACE: "8",
          MAX_ACTIVE_SESSIONS_PER_ACTOR: "3",
          MAX_SESSION_CREATES_PER_MINUTE: "6",
          MAX_SNAPSHOTS_PER_MINUTE: "30",
          BROWSER_RUN_INACTIVITY_TIMEOUT_MS: "600000",
          MAX_SESSION_LIFETIME_MS: "3600000",
          ALLOWED_ORIGINS: "http://localhost:3000",
          ALLOWED_HOSTS: "example.com,blog.cloudflare.com",
          MCP_LOCAL_WORKSPACE_ID: "kitesurf-test",
          MCP_LOCAL_PACKAGE_ID: "tap_pkg_examples_agent_browser_prototype_0001",
          MCP_LOCAL_CONTRIBUTION_ID: "remote-browser-tools",
        },
      },
    })),
  ],
});
