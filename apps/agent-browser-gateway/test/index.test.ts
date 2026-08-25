import { env } from "cloudflare:workers";
import {
  evictDurableObject,
  reset,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserSession } from "../src/cloudflare-browser";
import { createAgentBrowserGateway } from "../src/index";
import { DEFAULT_BROWSER_VIEWPORT } from "../src/policy";
import {
  SESSION_TOKEN_HEADER,
  type BrowserAssertionScope,
} from "../src/security";

const ownerClaims = {
  sub: "actor-a",
  workspace_id: "workspace-a",
  package_id: "package-a",
  installation_id: "installation-a",
  contribution_id: "contribution-a",
} as const;

const signingJwk: JsonWebKey = {
  kty: "OKP",
  crv: "Ed25519",
  x: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo",
  d: "nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A",
};

interface CreatedSessionResponse {
  readonly session: {
    readonly sessionId: string;
    readonly sessionToken: string;
    readonly targetId: string;
    readonly liveViewUrl: string | null;
    readonly expiresAt: string;
    readonly hardExpiresAt: string;
    readonly state: string;
    readonly control: {
      readonly holder: string;
      readonly epoch: number;
    };
  };
}

interface SessionResponse {
  readonly session: {
    readonly sessionId: string;
    readonly liveViewUrl: string | null;
    readonly state: string;
    readonly control: {
      readonly holder: string;
      readonly epoch: number;
      readonly expiresAt: string | null;
    };
  };
}

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
  readonly authorization: string | null;
  readonly body: Readonly<Record<string, unknown>>;
}

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function base64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/gu, "");
}

function encodeJson(value: Readonly<Record<string, unknown>>): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

async function signedAssertion(
  scope: BrowserAssertionScope,
  overrides: Readonly<Record<string, unknown>> = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1_000);
  const header = encodeJson({ alg: "EdDSA", typ: "JWT", kid: "tap-browser-v1" });
  const payload = encodeJson({
    iss: "tap-desktop-host",
    aud: "tap-agent-browser-gateway",
    ...ownerClaims,
    jti: `assertion-${crypto.randomUUID()}`,
    iat: now,
    nbf: now,
    exp: now + 60,
    scope: [scope],
    ...overrides,
  });
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

function request(
  path: string,
  authorization: string | null,
  init: RequestInit = {},
): Request {
  const headers = new Headers(init.headers);
  headers.set("Origin", "http://localhost:3000");
  if (authorization) headers.set("Authorization", `Bearer ${authorization}`);
  return new Request(`https://gateway.example${path}`, { ...init, headers });
}

function jsonRequest(
  path: string,
  authorization: string,
  body: Readonly<Record<string, unknown>>,
  headers: HeadersInit = {},
): Request {
  return request(path, authorization, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function json<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

async function browserRunTestState<T>(path: string): Promise<T> {
  const response = await env.BROWSER.fetch(`https://browser.internal${path}`);
  return response.json() as Promise<T>;
}

async function snapshotActionCalls(
  targetUrl: string,
): Promise<readonly SnapshotActionCall[]> {
  const state = await browserRunTestState<{
    readonly calls: readonly SnapshotActionCall[];
  }>(
    `/__test/snapshot-action-calls?url=${encodeURIComponent(targetUrl)}`,
  );
  return state.calls;
}

async function snapshotActionConcurrency(): Promise<{
  readonly inFlight: number;
  readonly peakInFlight: number;
}> {
  return browserRunTestState("/__test/snapshot-action-concurrency");
}

afterEach(async () => {
  await env.BROWSER.fetch("https://browser.internal/__test/reset", {
    method: "POST",
  });
  await reset();
  vi.restoreAllMocks();
});

describe("Remote Browser gateway", () => {
  it("serves liveness without exposing configuration", async () => {
    const worker = createAgentBrowserGateway();
    const response = await worker.fetch(
      new Request("https://gateway.example/health"),
      env,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      service: "tap-agent-browser-gateway",
      engine: "kitesurf",
      controlPlane: "durable-objects",
    });
  });

  it("rejects any browser engine other than Kitesurf", async () => {
    const worker = createAgentBrowserGateway();
    const targetUrl = "https://example.com/?browserTest=engine-policy";
    const snapshot = await worker.fetch(
      jsonRequest("/v1/snapshot", "fixture-workflow-token", {
        url: targetUrl,
        engine: "chromium",
        formats: ["screenshot", "markdown"],
      }),
      env,
    );

    expect(snapshot.status).toBe(400);
    expect(await snapshot.json()).toMatchObject({
      error: {
        code: "invalid_engine",
        message: "engine must be kitesurf.",
      },
    });
    expect(await snapshotActionCalls(targetUrl)).toEqual([]);

    const session = await worker.fetch(
      jsonRequest(
        "/v1/sessions",
        await signedAssertion("browser.session.create"),
        {
          url: "https://example.com/",
          engine: "chromium",
          keepAliveMs: 300_000,
        },
      ),
      env,
    );

    expect(session.status).toBe(400);
    expect(await session.json()).toMatchObject({
      error: { code: "invalid_engine" },
    });
  });

  it("rejects browser viewport dimensions outside the gateway bounds", async () => {
    const worker = createAgentBrowserGateway();
    const response = await worker.fetch(
      jsonRequest(
        "/v1/sessions",
        await signedAssertion("browser.session.create"),
        {
          url: "https://example.com/",
          engine: "kitesurf",
          keepAliveMs: 300_000,
          viewport: {
            width: 319,
            height: 844,
            deviceScaleFactor: 2,
            mobile: true,
          },
        },
      ),
      env,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "invalid_viewport_width" },
    });
  });

  it("keeps the workflow credential snapshot-only and enforces redirect egress", async () => {
    const worker = createAgentBrowserGateway();
    const targetUrl = "https://example.com/";
    const response = await worker.fetch(
      jsonRequest(
        "/v1/snapshot",
        "fixture-workflow-token",
        {
          url: targetUrl,
          engine: "kitesurf",
          formats: [
            "screenshot",
            "markdown",
            "accessibilityTree",
            "content",
          ],
          waitUntil: "networkidle0",
          timeoutMs: 45_000,
        },
        { "X-Tap-Actor-Id": "attacker-controlled" },
      ),
      env,
    );

    expect(response.status).toBe(200);
    const responseText = await response.text();
    const responsePayload = JSON.parse(responseText) as {
      readonly success: boolean;
      readonly result: {
        readonly screenshot: string;
        readonly markdown: string;
        readonly accessibilityTree: unknown;
        readonly content: string;
      };
      readonly meta: {
        readonly formats: readonly SnapshotAction[];
        readonly status: number;
        readonly title: string;
      };
    };
    expect(responsePayload).toEqual({
      success: true,
      result: {
        screenshot: PNG_BASE64,
        markdown: "# Example",
        accessibilityTree: {
          role: "RootWebArea",
          name: "Example",
          children: [{ role: "heading", name: "Example", level: 1 }],
        },
        content: "<html><body><h1>Example</h1></body></html>",
      },
      meta: {
        formats: [
          "screenshot",
          "markdown",
          "accessibilityTree",
          "content",
        ],
        status: 200,
        title: "Example",
      },
    });
    expect(response.headers.get("X-Agent-Browser-Engine")).toBe("kitesurf");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:3000",
    );
    expect(response.headers.get("Access-Control-Expose-Headers")).toContain(
      "X-Browser-Ms-Used",
    );
    const calls = await snapshotActionCalls(targetUrl);
    expect(calls.map(({ action }) => action).sort()).toEqual([
      "accessibilityTree",
      "content",
      "markdown",
      "screenshot",
    ]);
    for (const call of calls) {
      expect(call).toMatchObject({
        method: "POST",
        pathname: `/v1/${call.action}`,
        browser: "kitesurf",
        cacheTTL: "0",
        authorization: null,
        body: {
          url: targetUrl,
          gotoOptions: { waitUntil: "networkidle0", timeout: 45_000 },
          actionTimeout: 60_000,
          allowRequestPattern: [
            "^https?:\\/\\/example\\.com(?::\\d+)?(?:[/?#]|$)",
            "^https?:\\/\\/blog\\.cloudflare\\.com(?::\\d+)?(?:[/?#]|$)",
          ],
        },
      });
      expect(call.body).not.toHaveProperty("formats");
      expect(call.body).not.toHaveProperty("cacheTTL");
      expect(call.pathname).not.toContain("snapshot");
      expect(JSON.stringify(call)).not.toContain("chromium");
    }
    expect(calls.find(({ action }) => action === "screenshot")?.body).toMatchObject({
      screenshotOptions: { type: "png", encoding: "binary" },
    });
    for (const call of calls.filter(({ action }) => action !== "screenshot")) {
      expect(call.body).not.toHaveProperty("screenshotOptions");
    }
    expect(responseText).not.toContain("fixture-browser-token");
    expect(responseText).not.toContain("fixture-workflow-token");
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    expect(response.headers.get("X-Upstream-Internal")).toBeNull();
    expect(response.headers.get("X-Browser-Ms-Used")).toBe("1010");

    const sessionAttempt = await worker.fetch(
      jsonRequest("/v1/sessions", "fixture-workflow-token", {
        url: "https://example.com/",
        engine: "kitesurf",
        keepAliveMs: 300_000,
      }),
      env,
    );
    expect(sessionAttempt.status).toBe(401);
  });

  it("runs at most two Kitesurf evidence actions concurrently", async () => {
    const targetUrl = "https://example.com/?browserTest=fanout-concurrency";
    const worker = createAgentBrowserGateway();
    const response = await worker.fetch(
      jsonRequest("/v1/snapshot", "fixture-workflow-token", {
        url: targetUrl,
        engine: "kitesurf",
        formats: [
          "screenshot",
          "markdown",
          "accessibilityTree",
          "content",
        ],
      }),
      env,
    );

    expect(response.status).toBe(200);
    await response.body?.cancel();
    expect(await snapshotActionConcurrency()).toEqual({
      inFlight: 0,
      peakInFlight: 2,
    });
    expect(
      (await snapshotActionCalls(targetUrl)).map(({ action }) => action),
    ).toHaveLength(4);
  });

  it("does not schedule queued evidence actions after a first-wave failure", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const targetUrl = "https://example.com/?browserTest=first-wave-failure";
    const worker = createAgentBrowserGateway();
    const response = await worker.fetch(
      jsonRequest("/v1/snapshot", "fixture-workflow-token", {
        url: targetUrl,
        engine: "kitesurf",
        formats: [
          "markdown",
          "content",
          "screenshot",
          "accessibilityTree",
        ],
      }),
      env,
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: "browser_run_failed" },
    });
    expect(
      (await snapshotActionCalls(targetUrl))
        .map(({ action }) => action)
        .sort(),
    ).toEqual(["content", "markdown"]);
    expect(errorLog).toHaveBeenCalled();
  });

  it.each([
    ["title", "inconsistent-title"],
    ["status", "inconsistent-status"],
  ] as const)(
    "rejects inconsistent %s metadata across Kitesurf actions",
    async (_field, scenario) => {
      const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
      const targetUrl = `https://example.com/?browserTest=${scenario}`;
      const worker = createAgentBrowserGateway();
      const response = await worker.fetch(
        jsonRequest("/v1/snapshot", "fixture-workflow-token", {
          url: targetUrl,
          engine: "kitesurf",
          formats: ["content", "accessibilityTree"],
        }),
        env,
      );

      expect(response.status).toBe(502);
      const payload = await response.json();
      expect(payload).toMatchObject({
        ok: false,
        error: { code: "inconsistent_upstream" },
      });
      expect(payload).not.toHaveProperty("result");
      expect(
        (await snapshotActionCalls(targetUrl))
          .map(({ action }) => action)
          .sort(),
      ).toEqual(["accessibilityTree", "content"]);
      expect(errorLog).toHaveBeenCalled();
    },
  );

  it.each([
    ["screenshot", "screenshot", ["screenshot", "markdown"]],
    ["content", "content", ["content", "markdown"]],
    ["accessibility tree", "accessibility", ["accessibilityTree", "markdown"]],
  ] as const)(
    "accepts an individual %s action response at its exact byte limit",
    async (_label, scenario, formats) => {
      const targetUrl = `https://example.com/?browserTest=${scenario}-at-limit`;
      const worker = createAgentBrowserGateway();
      const response = await worker.fetch(
        jsonRequest("/v1/snapshot", "fixture-workflow-token", {
          url: targetUrl,
          engine: "kitesurf",
          formats,
        }),
        env,
      );

      expect(response.status).toBe(200);
      await response.body?.cancel();
    },
  );

  it.each([
    ["screenshot", "screenshot", ["screenshot", "markdown"]],
    ["content", "content", ["content", "markdown"]],
    ["accessibility tree", "accessibility", ["accessibilityTree", "markdown"]],
  ] as const)(
    "rejects an individual %s action response at its byte limit plus one",
    async (_label, scenario, formats) => {
      const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
      const targetUrl = `https://example.com/?browserTest=${scenario}-over-limit`;
      const worker = createAgentBrowserGateway();
      const response = await worker.fetch(
        jsonRequest("/v1/snapshot", "fixture-workflow-token", {
          url: targetUrl,
          engine: "kitesurf",
          formats,
        }),
        env,
      );

      expect(response.status).toBe(502);
      expect(await response.json()).toMatchObject({
        ok: false,
        error: { code: "upstream_too_large" },
      });
      expect(errorLog).toHaveBeenCalled();
    },
  );

  it("verifies host assertions and rejects assertion replay", async () => {
    const worker = createAgentBrowserGateway();
    const targetUrl = "https://example.com/?browserTest=replay";
    const assertion = await signedAssertion("browser.snapshot.capture");
    const body = {
      url: targetUrl,
      engine: "kitesurf",
      formats: ["screenshot", "markdown"],
    };

    const first = await worker.fetch(
      jsonRequest("/v1/snapshot", assertion, body),
      env,
    );
    expect(first.status).toBe(200);
    await first.text();

    const replay = await worker.fetch(
      jsonRequest("/v1/snapshot", assertion, body),
      env,
    );
    expect(replay.status).toBe(409);
    expect(await replay.json()).toMatchObject({
      error: { code: "assertion_replayed" },
    });
    expect(
      (await snapshotActionCalls(targetUrl)).map(({ action }) => action).sort(),
    ).toEqual(["markdown", "screenshot"]);

    const wrongScope = await signedAssertion("browser.session.read");
    const denied = await worker.fetch(
      jsonRequest("/v1/snapshot", wrongScope, body),
      env,
    );
    expect(denied.status).toBe(403);
  });

  it("retains replay state throughout the accepted expiry-skew window", async () => {
    const worker = createAgentBrowserGateway();
    const targetUrl = "https://example.com/?browserTest=expiry-replay";
    const now = Math.floor(Date.now() / 1_000);
    const assertion = await signedAssertion("browser.snapshot.capture", {
      jti: "assertion-expiry-skew-window",
      iat: now - 60,
      nbf: now - 60,
      exp: now - 1,
    });
    const body = {
      url: targetUrl,
      engine: "kitesurf",
      formats: ["screenshot", "markdown"],
    };

    const first = await worker.fetch(
      jsonRequest("/v1/snapshot", assertion, body),
      env,
    );
    expect(first.status).toBe(200);
    await first.text();
    const replay = await worker.fetch(
      jsonRequest("/v1/snapshot", assertion, body),
      env,
    );
    expect(replay.status).toBe(409);
    expect(await replay.json()).toMatchObject({
      error: { code: "assertion_replayed" },
    });
    expect(
      (await snapshotActionCalls(targetUrl)).map(({ action }) => action).sort(),
    ).toEqual(["markdown", "screenshot"]);
  });

  it("normalizes Browser Run failures without forwarding vendor details", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const worker = createAgentBrowserGateway();
    const response = await worker.fetch(
      jsonRequest("/v1/snapshot", "fixture-workflow-token", {
        url: "https://example.com/?browserTest=upstream-error",
        engine: "kitesurf",
        formats: ["screenshot", "markdown"],
      }),
      env,
    );

    expect(response.status).toBe(502);
    const body = await response.text();
    expect(body).toContain("Browser Run could not complete the request.");
    expect(body).not.toContain("sensitive upstream diagnostic");
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(response.headers.get("X-Browser-Ms-Used")).toBeNull();
    expect(
      (
        await snapshotActionCalls(
          "https://example.com/?browserTest=upstream-error",
        )
      )
        .map(({ action }) => action)
        .sort(),
    ).toEqual(["markdown", "screenshot"]);
    expect(errorLog).toHaveBeenCalled();
  });

  it.each([
    ["invalid-screenshot-media-type", "invalid_upstream"],
    ["invalid-screenshot-png", "invalid_upstream"],
  ] as const)(
    "rejects %s evidence instead of composing an invalid capture",
    async (scenario, expectedCode) => {
      const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
      const targetUrl = `https://example.com/?browserTest=${scenario}`;
      const worker = createAgentBrowserGateway();
      const response = await worker.fetch(
        jsonRequest("/v1/snapshot", "fixture-workflow-token", {
          url: targetUrl,
          engine: "kitesurf",
          formats: ["screenshot", "markdown"],
        }),
        env,
      );

      expect(response.status).toBe(502);
      expect(await response.json()).toMatchObject({
        ok: false,
        error: { code: expectedCode },
      });
      expect(response.headers.get("X-Browser-Ms-Used")).toBeNull();
      expect(
        (await snapshotActionCalls(targetUrl))
          .map(({ action }) => action)
          .sort(),
      ).toEqual(["markdown", "screenshot"]);
      expect(errorLog).toHaveBeenCalled();
    },
  );

  it("bounds each individual action response before composition", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const targetUrl = "https://example.com/?browserTest=action-oversized";
    const worker = createAgentBrowserGateway();
    const response = await worker.fetch(
      jsonRequest("/v1/snapshot", "fixture-workflow-token", {
        url: targetUrl,
        engine: "kitesurf",
        formats: ["markdown", "content"],
      }),
      env,
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: "upstream_too_large" },
    });
    expect(response.headers.get("X-Browser-Ms-Used")).toBeNull();
    expect(
      (await snapshotActionCalls(targetUrl))
        .map(({ action }) => action)
        .sort(),
    ).toEqual(["content", "markdown"]);
    expect(errorLog).toHaveBeenCalled();
  });

  it("bounds the composed response across individually valid action payloads", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const targetUrl =
      "https://example.com/?browserTest=combined-oversized";
    const worker = createAgentBrowserGateway();
    const response = await worker.fetch(
      jsonRequest("/v1/snapshot", "fixture-workflow-token", {
        url: targetUrl,
        engine: "kitesurf",
        formats: ["screenshot", "content"],
      }),
      env,
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: "upstream_too_large" },
    });
    expect(response.headers.get("X-Browser-Ms-Used")).toBeNull();
    expect(
      (await snapshotActionCalls(targetUrl))
        .map(({ action }) => action)
        .sort(),
    ).toEqual(["content", "screenshot"]);
    expect(errorLog).toHaveBeenCalled();
  });

  it("does not log a sensitive target URL from a Browser Run transport error", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const sensitiveMarker = "must-not-appear-in-gateway-logs";
    const worker = createAgentBrowserGateway();
    const response = await worker.fetch(
      jsonRequest("/v1/snapshot", "fixture-workflow-token", {
        url:
          `https://example.com/?browserTest=transport-error&token=${sensitiveMarker}`,
        engine: "kitesurf",
        formats: ["screenshot", "markdown"],
      }),
      env,
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: {
        code: "browser_run_failed",
        message: "Browser Run could not complete the request.",
      },
    });
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(sensitiveMarker);
  });

  it("persists an owner-bound session and coordinates renew, handoff, and close", async () => {
    const worker = createAgentBrowserGateway();
    const createAssertion = await signedAssertion("browser.session.create");
    const created = await worker.fetch(
      jsonRequest("/v1/sessions", createAssertion, {
        url: "https://example.com/",
        engine: "kitesurf",
        keepAliveMs: 300_000,
      }),
      env,
    );
    expect(created.status).toBe(201);
    const createdBody = await json<CreatedSessionResponse>(created);
    const { sessionId, sessionToken } = createdBody.session;
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(sessionId).not.toBe("upstream-1");
    expect(sessionToken).toMatch(/^[0-9A-Za-z_-]{43}$/u);
    expect(createdBody.session).toMatchObject({
      targetId: "target-1",
      state: "active",
      control: { holder: "agent", epoch: 1 },
    });

    const coordinator = env.BROWSER_SESSIONS.getByName(sessionId);
    await env.BROWSER.fetch(
      "https://browser.internal/__test/close-cdp?session=upstream-1",
      { method: "POST" },
    );
    await evictDurableObject(coordinator, { webSockets: "close" });

    const readAssertion = await signedAssertion("browser.session.read");
    const status = await worker.fetch(
      request(`/v1/sessions/${sessionId}`, readAssertion, {
        headers: { [SESSION_TOKEN_HEADER]: sessionToken },
      }),
      env,
    );
    expect(status.status).toBe(200);
    expect(await json<SessionResponse>(status)).toMatchObject({
      session: { sessionId, state: "active", control: { epoch: 1 } },
    });

    const wrongOwner = await signedAssertion("browser.session.read", {
      workspace_id: "workspace-b",
    });
    const hidden = await worker.fetch(
      request(`/v1/sessions/${sessionId}`, wrongOwner, {
        headers: { [SESSION_TOKEN_HEADER]: sessionToken },
      }),
      env,
    );
    expect(hidden.status).toBe(404);

    const wrongCapability = await worker.fetch(
      request(`/v1/sessions/${sessionId}`, readAssertion, {
        headers: { [SESSION_TOKEN_HEADER]: "wrong-session-capability" },
      }),
      env,
    );
    expect(wrongCapability.status).toBe(401);

    const handoff = await worker.fetch(
      jsonRequest(
        `/v1/sessions/${sessionId}/control/handoff`,
        await signedAssertion("browser.session.control"),
        { expectedEpoch: 1, to: "human", leaseMs: 60_000 },
        { [SESSION_TOKEN_HEADER]: sessionToken },
      ),
      env,
    );
    expect(handoff.status).toBe(200);
    expect(await json<SessionResponse>(handoff)).toMatchObject({
      session: { control: { holder: "human", epoch: 2 } },
    });

    const staleHandoff = await worker.fetch(
      jsonRequest(
        `/v1/sessions/${sessionId}/control/handoff`,
        await signedAssertion("browser.session.control"),
        { expectedEpoch: 1, to: "agent" },
        { [SESSION_TOKEN_HEADER]: sessionToken },
      ),
      env,
    );
    expect(staleHandoff.status).toBe(409);
    expect(await staleHandoff.json()).toMatchObject({
      error: { code: "stale_control_epoch" },
    });

    const controlAssertion = await signedAssertion("browser.session.control");
    const held = await worker.fetch(
      jsonRequest(
        `/v1/sessions/${sessionId}/control/assert`,
        controlAssertion,
        { holder: "human", epoch: 2 },
        { [SESSION_TOKEN_HEADER]: sessionToken },
      ),
      env,
    );
    expect(held.status).toBe(200);

    await runInDurableObject(coordinator, (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE browser_session SET control_expires_at = ? WHERE singleton = 1",
        Date.now() - 1,
      );
    });
    const afterControlExpiry = await worker.fetch(
      request(`/v1/sessions/${sessionId}`, readAssertion, {
        headers: { [SESSION_TOKEN_HEADER]: sessionToken },
      }),
      env,
    );
    expect(await json<SessionResponse>(afterControlExpiry)).toMatchObject({
      session: { control: { holder: "agent", epoch: 3, expiresAt: null } },
    });

    const reservations = await runInDurableObject(
      env.BROWSER_OWNER_QUOTAS.getByName("workspace-a"),
      (_instance, state) =>
        state.storage.sql
          .exec<{ session_id: string; expires_at: number }>(
            "SELECT session_id, expires_at FROM quota_reservations",
          )
          .toArray(),
    );
    expect(reservations).toEqual([
      expect.objectContaining({ session_id: sessionId }),
    ]);
    expect(reservations[0]?.expires_at).toBe(
      Date.parse(createdBody.session.hardExpiresAt) + 600_000,
    );

    const renewed = await worker.fetch(
      jsonRequest(
        `/v1/sessions/${sessionId}/renew`,
        await signedAssertion("browser.session.renew"),
        { leaseMs: 600_000 },
        { [SESSION_TOKEN_HEADER]: sessionToken },
      ),
      env,
    );
    const renewedBody = await json<SessionResponse>(renewed);
    expect({ status: renewed.status, body: renewedBody }).toMatchObject({
      status: 200,
      body: {
        session: {
          state: "active",
          liveViewUrl:
            "https://live.browser.run/ui/view?wss=socket-1&jwt=renewed",
        },
      },
    });

    const closed = await worker.fetch(
      request(`/v1/sessions/${sessionId}?waitMs=1000`, await signedAssertion("browser.session.close"), {
        method: "DELETE",
        headers: { [SESSION_TOKEN_HEADER]: sessionToken },
      }),
      env,
    );
    expect(closed.status).toBe(200);
    expect(await json<SessionResponse>(closed)).toMatchObject({
      session: { sessionId, state: "closed", liveViewUrl: null },
    });
  });

  it("expires a session by alarm after upstream close confirmation", async () => {
    const worker = createAgentBrowserGateway();
    const created = await worker.fetch(
      jsonRequest(
        "/v1/sessions",
        await signedAssertion("browser.session.create"),
        {
          url: "https://example.com/",
          engine: "kitesurf",
          keepAliveMs: 60_000,
        },
      ),
      env,
    );
    const createdBody = await json<CreatedSessionResponse>(created);
    const { sessionId, sessionToken } = createdBody.session;
    const coordinator = env.BROWSER_SESSIONS.getByName(sessionId);
    await runInDurableObject(coordinator, (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE browser_session SET lease_expires_at = ? WHERE singleton = 1",
        Date.now() - 1,
      );
    });

    expect(await runDurableObjectAlarm(coordinator)).toBe(true);
    const status = await worker.fetch(
      request(
        `/v1/sessions/${sessionId}`,
        await signedAssertion("browser.session.read"),
        { headers: { [SESSION_TOKEN_HEADER]: sessionToken } },
      ),
      env,
    );
    expect(await json<SessionResponse>(status)).toMatchObject({
      session: { state: "closed", liveViewUrl: null },
    });
  });

  it("does not let status polling postpone an upstream close retry", async () => {
    const worker = createAgentBrowserGateway();
    const created = await worker.fetch(
      jsonRequest(
        "/v1/sessions",
        await signedAssertion("browser.session.create"),
        {
          url: "https://example.com/",
          engine: "kitesurf",
          keepAliveMs: 300_000,
          viewport: DEFAULT_BROWSER_VIEWPORT,
        },
      ),
      env,
    );
    const createdBody = await json<CreatedSessionResponse>(created);
    const { sessionId, sessionToken } = createdBody.session;
    const closed = await worker.fetch(
      request(
        `/v1/sessions/${sessionId}?waitMs=0`,
        await signedAssertion("browser.session.close"),
        {
          method: "DELETE",
          headers: { [SESSION_TOKEN_HEADER]: sessionToken },
        },
      ),
      env,
    );
    expect(closed.status).toBe(202);
    await closed.text();

    const coordinator = env.BROWSER_SESSIONS.getByName(sessionId);
    const before = await runInDurableObject(coordinator, (_instance, state) =>
      state.storage.getAlarm(),
    );
    expect(before).not.toBeNull();
    const status = await worker.fetch(
      request(
        `/v1/sessions/${sessionId}`,
        await signedAssertion("browser.session.read"),
        { headers: { [SESSION_TOKEN_HEADER]: sessionToken } },
      ),
      env,
    );
    expect(await json<SessionResponse>(status)).toMatchObject({
      session: { state: "closing", liveViewUrl: null },
    });
    const after = await runInDurableObject(coordinator, (_instance, state) =>
      state.storage.getAlarm(),
    );
    expect(after).toBe(before);
  });

  it("enforces the per-actor active session quota", async () => {
    const worker = createAgentBrowserGateway();
    for (let index = 0; index < 3; index += 1) {
      const response = await worker.fetch(
        jsonRequest(
          "/v1/sessions",
          await signedAssertion("browser.session.create"),
          {
            url: "https://example.com/",
            engine: "kitesurf",
            keepAliveMs: 300_000,
          },
        ),
        env,
      );
      expect(response.status).toBe(201);
      await response.text();
    }
    const limited = await worker.fetch(
      jsonRequest(
        "/v1/sessions",
        await signedAssertion("browser.session.create"),
        {
          url: "https://example.com/",
          engine: "kitesurf",
          keepAliveMs: 300_000,
        },
      ),
      env,
    );
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({
      error: { code: "actor_session_quota_exceeded" },
    });
  });

  it("releases an allocated upstream session when its target is malformed", async () => {
    await env.BROWSER.fetch(
      "https://browser.internal/__test/malformed-next-target",
      { method: "POST" },
    );
    await expect(
      createBrowserSession(
        {
          url: "https://example.com/",
          engine: "kitesurf",
          keepAliveMs: 300_000,
          viewport: DEFAULT_BROWSER_VIEWPORT,
        },
        ["example.com"],
        "example.com",
        600_000,
        env,
      ),
    ).rejects.toMatchObject({ status: 502, code: "invalid_upstream" });
    expect(
      await browserRunTestState<{ readonly methods: readonly string[] }>(
        "/__test/last-session-methods",
      ),
    ).toEqual({ methods: ["POST", "PUT", "DELETE"] });
  });

  it("rejects missing auth, private targets, and excessive navigation timeouts", async () => {
    const worker = createAgentBrowserGateway();
    const unauthorized = await worker.fetch(
      request("/v1/snapshot", null, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }),
      env,
    );
    expect(unauthorized.status).toBe(401);

    const privateTarget = await worker.fetch(
      jsonRequest("/v1/snapshot", "fixture-workflow-token", {
        url: "http://127.0.0.1/admin",
        engine: "kitesurf",
        formats: ["screenshot", "markdown"],
      }),
      env,
    );
    expect(privateTarget.status).toBe(403);
    expect(await privateTarget.json()).toMatchObject({
      error: { code: "private_target_denied" },
    });

    const excessiveNavigationTimeout = await worker.fetch(
      jsonRequest("/v1/snapshot", "fixture-workflow-token", {
        url: "https://example.com/",
        engine: "kitesurf",
        formats: ["screenshot", "markdown"],
        timeoutMs: 60_001,
      }),
      env,
    );
    expect(excessiveNavigationTimeout.status).toBe(400);
    expect(await excessiveNavigationTimeout.json()).toMatchObject({
      error: { code: "invalid_timeout" },
    });
    expect(await snapshotActionCalls("https://example.com/")).toEqual([]);
  });
});
