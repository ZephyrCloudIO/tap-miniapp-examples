import { env } from "cloudflare:workers";
import { reset, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { encodeRemoteBrowserRoomCode } from "../../agent-browser-prototype/src/room-code";
import { BROWSER_ROOM_PARTICIPANT_TTL_MS } from "../src/control-plane";
import { createRemoteBrowserMcpHandler } from "../src/mcp";
import type { RemoteBrowserMcpProps } from "../src/oauth";
import { REMOTE_BROWSER_PARTICIPANT_META_KEY } from "../src/participant";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const authProps: RemoteBrowserMcpProps = {
  userId: "zack@zephyr-cloud.io",
  scopes: ["remote-browser"],
  owner: {
    actorId: "zack@zephyr-cloud.io",
    workspaceId: "kitesurf-test",
    packageId: "tap_pkg_examples_agent_browser_prototype_0001",
    installationId: "local-custom-miniapp",
    contributionId: "remote-browser-tools",
  },
};

const AGENT_PARTICIPANT = {
  version: 1,
  workspaceId: "kitesurf-test",
  requestingUserId: "zack@zephyr-cloud.io",
  participant: {
    kind: "agent",
    principalId: "chloe",
    instanceId: "a".repeat(64),
  },
  consumer: { kind: "specialist", specialistId: "chloe" },
} as const;

const CHANNEL_CHAT_PARTICIPANT = {
  version: 1,
  workspaceId: "kitesurf-test",
  requestingUserId: "zack@zephyr-cloud.io",
  participant: {
    kind: "agent",
    principalId: "channel-assistant",
    instanceId: "f".repeat(64),
  },
  consumer: { kind: "chat", surfaceId: "channel-main" },
} as const;

function authPropsFor(
  userId: string,
  workspaceId = "kitesurf-test",
  ownerOverrides: Partial<RemoteBrowserMcpProps["owner"]> = {},
): RemoteBrowserMcpProps {
  return {
    userId,
    scopes: ["remote-browser"],
    owner: {
      actorId: userId,
      workspaceId,
      packageId: authProps.owner.packageId,
      installationId: authProps.owner.installationId,
      contributionId: authProps.owner.contributionId,
      ...ownerOverrides,
    },
  };
}

function humanParticipant(
  userId: string,
  instanceByte: string,
  workspaceId = "kitesurf-test",
  installationId = "local-custom-miniapp",
): JsonObject {
  return {
    version: 1,
    workspaceId,
    requestingUserId: userId,
    participant: {
      kind: "human",
      principalId: userId,
      instanceId: instanceByte.repeat(64),
    },
    consumer: {
      kind: "package-contribution",
      installationId,
      // This is deliberately the UI surface, not the OAuth server contribution.
      contributionId: "agent-browser-prototype",
      consumerClass: "miniapp",
    },
  };
}

function agentParticipant(principalId: string, instanceByte: string): JsonObject {
  return {
    version: 1,
    workspaceId: "kitesurf-test",
    requestingUserId: "zack@zephyr-cloud.io",
    participant: {
      kind: "agent",
      principalId,
      instanceId: instanceByte.repeat(64),
    },
    consumer: { kind: "specialist", specialistId: principalId },
  };
}

type JsonObject = Readonly<Record<string, unknown>>;

interface RecordedCdpCommand {
  readonly method: string;
  readonly params: JsonObject;
}

interface CdpCommandState {
  readonly sessions: readonly {
    readonly upstreamSessionId: string;
    readonly commands: readonly RecordedCdpCommand[];
  }[];
}

function record(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected ${label} to be an object.`);
  }
  return value as JsonObject;
}

function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`Expected ${label} to be an array.`);
  return value;
}

function textContent(result: JsonObject): string {
  const content = array(result.content, "tool content");
  const item = content
    .map((value) => record(value, "content item"))
    .find((value) => value.type === "text");
  if (!item || typeof item.text !== "string") {
    throw new Error("Tool result omitted text content.");
  }
  return item.text;
}

function structured(result: JsonObject): JsonObject {
  return record(result.structuredContent, "structured tool output");
}

function namedElements(output: JsonObject): ReadonlyMap<string, string> {
  const elements = array(output.elements, "snapshot elements");
  return new Map(
    elements.flatMap((value): readonly [string, string][] => {
      const element = record(value, "snapshot element");
      return typeof element.name === "string" && typeof element.ref === "string"
        ? [[element.name, element.ref]]
        : [];
    }),
  );
}

function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value)) throw new Error(`Expected ${label} to be an integer.`);
  return Number(value);
}

function control(output: JsonObject): {
  readonly epoch: number;
  readonly participantId: string | null;
} {
  const value = record(output.control, "control lease");
  const participantId = value.participantId;
  if (participantId !== null && typeof participantId !== "string") {
    throw new Error("Control lease has an invalid participant ID.");
  }
  return { epoch: integer(value.epoch, "control epoch"), participantId };
}

function imageData(result: JsonObject): string {
  const item = array(result.content, "image content")
    .map((value) => record(value, "image content item"))
    .find((value) => value.type === "image");
  if (!item || typeof item.data !== "string") throw new Error("Image data was omitted.");
  return item.data;
}

function errorCode(result: JsonObject): string {
  const payload = record(JSON.parse(textContent(result)), "tool error payload");
  const error = record(payload.error, "tool error");
  if (typeof error.code !== "string") throw new Error("Tool error omitted its code.");
  return error.code;
}

function mcpRequest(body: JsonObject): Request {
  return new Request("http://127.0.0.1:8787/mcp", {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      Host: "127.0.0.1:8787",
    },
    body: JSON.stringify(body),
  });
}

async function mcpCall(
  body: JsonObject,
  props: RemoteBrowserMcpProps = authProps,
): Promise<JsonObject> {
  const handler = createRemoteBrowserMcpHandler(env, props);
  const response = await handler.fetch(mcpRequest(body));
  const responseText = await response.text();
  expect(response.status, responseText).toBe(200);
  if (response.headers.get("Content-Type")?.includes("text/event-stream")) {
    const data = responseText
      .split("\n")
      .find((line) => line.startsWith("data: "))
      ?.slice("data: ".length);
    if (!data) throw new Error("MCP response omitted an SSE data record.");
    return record(JSON.parse(data), "MCP response");
  }
  return record(JSON.parse(responseText), "MCP response");
}

let callSequence = 100;

async function callTool(
  name: string,
  args: JsonObject,
  metadata: JsonObject = AGENT_PARTICIPANT,
  props: RemoteBrowserMcpProps = authProps,
): Promise<JsonObject> {
  callSequence += 1;
  const response = await mcpCall({
    jsonrpc: "2.0",
    id: callSequence,
    method: "tools/call",
    params: {
      name,
      arguments: args,
      _meta: { [REMOTE_BROWSER_PARTICIPANT_META_KEY]: metadata },
    },
  }, props);
  return record(response.result, `${name} result`);
}

async function cdpCommands(): Promise<CdpCommandState> {
  const response = await env.BROWSER.fetch(
    "https://browser.internal/__test/cdp-commands",
  );
  expect(response.status).toBe(200);
  return response.json() as Promise<CdpCommandState>;
}

async function ageParticipants(
  sessionHandle: string,
  participantIds: readonly string[],
): Promise<number> {
  const staleAt = Date.now() - BROWSER_ROOM_PARTICIPANT_TTL_MS - 1;
  await runInDurableObject(
    env.BROWSER_SESSIONS.getByName(sessionHandle),
    (_instance, state) => {
      for (const participantId of participantIds) {
        state.storage.sql.exec(
          `UPDATE browser_room_participant
              SET last_seen_at = ?
            WHERE participant_id = ?`,
          staleAt,
          participantId,
        );
      }
    },
  );
  return staleAt;
}

async function participantPresence(
  sessionHandle: string,
  participantId: string,
): Promise<{ readonly status: string; readonly lastSeenAt: number }> {
  return runInDurableObject(
    env.BROWSER_SESSIONS.getByName(sessionHandle),
    (_instance, state) => {
      const row = state.storage.sql
        .exec<{ status: string; last_seen_at: number }>(
          `SELECT status, last_seen_at
             FROM browser_room_participant
            WHERE participant_id = ?`,
          participantId,
        )
        .one();
      return { status: row.status, lastSeenAt: row.last_seen_at };
    },
  );
}

async function setMutationLease(
  sessionHandle: string,
  expiresAt: number | null,
): Promise<void> {
  await runInDurableObject(
    env.BROWSER_SESSIONS.getByName(sessionHandle),
    (_instance, state) => {
      state.storage.sql.exec("DELETE FROM browser_mutation");
      if (expiresAt === null) return;
      const row = state.storage.sql
        .exec<{ control_epoch: number; document_revision: number }>(
          `SELECT control_epoch, document_revision
             FROM browser_session
            WHERE singleton = 1`,
        )
        .one();
      state.storage.sql.exec(
        `INSERT INTO browser_mutation (
           singleton, operation_nonce, control_epoch, document_revision,
           started_at, expires_at
         ) VALUES (1, ?, ?, ?, ?, ?)`,
        "clock-controlled-in-flight-operation",
        row.control_epoch,
        row.document_revision,
        Date.now(),
        expiresAt,
      );
    },
  );
}

afterEach(async () => {
  await env.BROWSER.fetch("https://browser.internal/__test/reset", {
    method: "POST",
  });
  await reset();
  callSequence = 100;
});

describe("Remote Browser hosted MCP tools", () => {
  it("rejects a mixed canonical and legacy join payload", async () => {
    const sessionHandle = "8f508329-5217-4be2-a605-b80bc12350c6";
    const invitationToken = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdef";
    const roomCode = encodeRemoteBrowserRoomCode({
      sessionHandle,
      invitationToken,
    });
    const response = await mcpCall({
      jsonrpc: "2.0",
      id: 101,
      method: "tools/call",
      params: {
        name: "remote_browser_join_session",
        arguments: { roomCode, sessionHandle, invitationToken },
        _meta: { [REMOTE_BROWSER_PARTICIPANT_META_KEY]: AGENT_PARTICIPANT },
      },
    });

    const invalidResult = record(response.result, "ambiguous join result");
    expect(invalidResult.isError).toBe(true);
    expect(textContent(invalidResult)).toMatch(/invalid|unrecognized|union/iu);
  });

  it("accepts a host-attested channel chat as a governed browser participant", async () => {
    const startResult = await callTool(
      "remote_browser_start",
      { url: "https://example.com/channel", keepAliveMs: 600_000 },
      CHANNEL_CHAT_PARTICIPANT,
    );
    expect(startResult.isError).not.toBe(true);
    const started = structured(startResult);
    const sessionHandle = started.sessionHandle;
    if (typeof sessionHandle !== "string") {
      throw new Error("Channel chat start omitted session handle.");
    }
    expect(started.control).toMatchObject({ holder: "agent" });

    const closeResult = await callTool(
      "remote_browser_close",
      { sessionHandle },
      CHANNEL_CHAT_PARTICIPANT,
    );
    expect(closeResult.isError).not.toBe(true);
  });

  it("drives and observes a fenced Kitesurf session through semantic tool calls", async () => {
    const startResult = await callTool("remote_browser_start", {
      url: "https://example.com/initial?token=start-secret#private",
      keepAliveMs: 600_000,
      viewport: {
        width: 390,
        height: 844,
        deviceScaleFactor: 2,
        mobile: true,
      },
    });
    expect(startResult.isError).not.toBe(true);
    const started = structured(startResult);
    const sessionHandle = started.sessionHandle;
    expect(sessionHandle).toMatch(/^[0-9a-f-]{36}$/u);
    if (typeof sessionHandle !== "string") throw new Error("Start omitted session handle.");
    expect(started).toMatchObject({
      url: "https://example.com/initial",
      control: { holder: "agent", epoch: 1, expiresAt: null },
    });
    expect(started.telemetryCoverageStartedAt).toEqual(expect.any(String));
    const initialRevision = integer(started.documentRevision, "initial revision");

    const snapshotResult = await callTool("remote_browser_snapshot", {
      sessionHandle,
    });
    expect(snapshotResult.isError).not.toBe(true);
    const initialSnapshot = structured(snapshotResult);
    const initialElements = namedElements(initialSnapshot);
    expect([...initialElements.keys()]).toEqual([
      "Remote Browser test page",
      "Submit search",
      "Search query",
      "Account password",
      "Broken action",
    ]);
    const snapshotRevision = integer(
      initialSnapshot.documentRevision,
      "snapshot revision",
    );
    expect(snapshotRevision).toBe(initialRevision);

    const screenshotResult = await callTool("remote_browser_screenshot", {
      sessionHandle,
    });
    expect(screenshotResult.isError).not.toBe(true);
    const screenshotContent = array(screenshotResult.content, "screenshot content")
      .map((value) => record(value, "screenshot content item"));
    expect(screenshotContent[0]).toEqual({
      type: "image",
      data: PNG_BASE64,
      mimeType: "image/png",
    });
    const screenshotMetadata = structured(screenshotResult);
    expect(screenshotMetadata).toMatchObject({
      sessionHandle,
      documentRevision: snapshotRevision,
      mediaType: "image/png",
      byteLength: 68,
    });
    expect(screenshotMetadata).not.toHaveProperty("data");

    const staleControl = await callTool("remote_browser_navigate", {
      sessionHandle,
      url: "https://example.com/blocked-control",
      expectedControlEpoch: control(initialSnapshot).epoch + 1,
      expectedDocumentRevision: snapshotRevision,
    });
    expect(staleControl.isError).toBe(true);
    expect(errorCode(staleControl)).toBe("stale_control_epoch");

    const staleDocument = await callTool("remote_browser_navigate", {
      sessionHandle,
      url: "https://example.com/blocked-document",
      expectedControlEpoch: control(initialSnapshot).epoch,
      expectedDocumentRevision:
        snapshotRevision === 1 ? snapshotRevision + 1 : snapshotRevision - 1,
    });
    expect(staleDocument.isError).toBe(true);
    expect(errorCode(staleDocument)).toBe("stale_document_revision");

    const navigateResult = await callTool("remote_browser_navigate", {
      sessionHandle,
      url: "https://example.com/after?query=navigation-secret#private",
      expectedControlEpoch: control(initialSnapshot).epoch,
      expectedDocumentRevision: snapshotRevision,
    });
    expect(navigateResult.isError).not.toBe(true);
    const navigated = structured(navigateResult);
    expect(navigated.url).toBe("https://example.com/after");
    const navigatedRevision = integer(
      navigated.documentRevision,
      "navigated revision",
    );
    expect(navigatedRevision).toBeGreaterThan(snapshotRevision);

    const networkResult = await callTool("remote_browser_network", {
      sessionHandle,
      cursor: 0,
      limit: 100,
    });
    expect(networkResult.isError).not.toBe(true);
    const network = structured(networkResult);
    expect(network).toMatchObject({ telemetryGap: false, hasMore: false });
    const networkText = JSON.stringify(network);
    expect(networkText).toContain("https://example.com/api/[REDACTED]/[REDACTED]/[REDACTED]");
    expect(networkText).toContain('"status":503');
    expect(networkText).toContain('"failed":true');
    for (const secret of [
      "network-user",
      "network-pass",
      "network-secret",
      "private",
      "signed-path-secret",
      "AbCdEf0123456789AbCdEf0123456789",
      "header-secret",
      "network-failure-secret",
      "network-error-secret",
    ]) {
      expect(networkText).not.toContain(secret);
    }
    expect(networkText).not.toContain("?token=");
    expect(networkText).not.toContain("#private");
    expect(networkText).not.toContain("headers");
    expect(networkText).not.toContain("responseBody");

    const diagnosticsResult = await callTool("remote_browser_diagnostics", {
      sessionHandle,
      cursor: 0,
      limit: 100,
    });
    expect(diagnosticsResult.isError).not.toBe(true);
    const diagnostics = structured(diagnosticsResult);
    expect(diagnostics).toMatchObject({ telemetryGap: false, hasMore: false });
    const diagnosticItems = array(diagnostics.items, "diagnostic items")
      .map((value) => record(value, "diagnostic item"));
    expect(new Set(diagnosticItems.map((item) => item.kind))).toEqual(
      new Set(["network", "http", "exception", "console"]),
    );
    const diagnosticsText = JSON.stringify(diagnostics);
    expect(diagnosticsText).toContain("[REDACTED]");
    for (const secret of [
      "exception-secret",
      "exception-token-secret",
      "json-cookie-secret",
      "json-auth-secret",
      "source-secret",
      "console-secret",
      "network-failure-secret",
      "network-error-secret",
      "signed-path-secret",
    ]) {
      expect(diagnosticsText).not.toContain(secret);
    }

    const refreshedSnapshotResult = await callTool("remote_browser_snapshot", {
      sessionHandle,
    });
    const refreshedSnapshot = structured(refreshedSnapshotResult);
    const refreshedElements = namedElements(refreshedSnapshot);
    const currentRevision = integer(
      refreshedSnapshot.documentRevision,
      "current revision",
    );
    const currentEpoch = control(refreshedSnapshot).epoch;
    const headingRef = refreshedElements.get("Remote Browser test page");
    const submitRef = refreshedElements.get("Submit search");
    const searchRef = refreshedElements.get("Search query");
    const passwordRef = refreshedElements.get("Account password");
    const brokenRef = refreshedElements.get("Broken action");
    const oldSubmitRef = initialElements.get("Submit search");
    for (const ref of [headingRef, submitRef, searchRef, passwordRef, brokenRef, oldSubmitRef]) {
      expect(ref).toMatch(/^el_[0-9a-f]{32}$/u);
    }
    if (
      !headingRef ||
      !submitRef ||
      !searchRef ||
      !passwordRef ||
      !brokenRef ||
      !oldSubmitRef
    ) {
      throw new Error("Snapshot omitted a semantic element reference.");
    }

    const ambiguousSelection = await callTool("remote_browser_select_element", {
      sessionHandle,
      elementRef: submitRef,
      xRatio: 0.5,
      yRatio: 0.25,
      representation: "selector",
      expectedControlEpoch: currentEpoch,
      expectedDocumentRevision: currentRevision,
    });
    expect(ambiguousSelection.isError).toBe(true);

    const staleSelection = await callTool("remote_browser_select_element", {
      sessionHandle,
      elementRef: submitRef,
      representation: "selector",
      expectedControlEpoch: currentEpoch + 1,
      expectedDocumentRevision: currentRevision,
    });
    expect(staleSelection.isError).toBe(true);
    expect(errorCode(staleSelection)).toBe("stale_control_epoch");

    const selectorResult = await callTool("remote_browser_select_element", {
      sessionHandle,
      elementRef: submitRef,
      representation: "selector",
      expectedControlEpoch: currentEpoch,
      expectedDocumentRevision: currentRevision,
    });
    expect(selectorResult.isError).not.toBe(true);
    expect(structured(selectorResult)).toMatchObject({
      sessionHandle,
      elementRef: submitRef,
      documentRevision: currentRevision,
      representation: "selector",
      selector:
        "html:nth-of-type(1) > body:nth-of-type(1) > button[data-testid=\"submit\"]:nth-of-type(1)",
      html: null,
      mediaType: null,
      byteLength: null,
    });

    const htmlResult = await callTool("remote_browser_select_element", {
      sessionHandle,
      elementRef: headingRef,
      representation: "html",
      expectedControlEpoch: currentEpoch,
      expectedDocumentRevision: currentRevision,
    });
    expect(htmlResult.isError).not.toBe(true);
    const htmlSelection = structured(htmlResult);
    expect(htmlSelection).toMatchObject({
      sessionHandle,
      elementRef: headingRef,
      representation: "html",
      selector: null,
      mediaType: null,
      byteLength: null,
    });
    expect(htmlSelection.html).toBe(
      "<button data-testid=\"submit\">Authorization: [REDACTED] [REDACTED]</button>",
    );
    expect(JSON.stringify(htmlResult)).not.toContain("selected-html-secret");

    const elementPngResult = await callTool("remote_browser_select_element", {
      sessionHandle,
      xRatio: 0.5,
      yRatio: 0.25,
      representation: "png",
      expectedControlEpoch: currentEpoch,
      expectedDocumentRevision: currentRevision,
    });
    expect(elementPngResult.isError).not.toBe(true);
    const elementPngContent = array(elementPngResult.content, "element PNG content")
      .map((value) => record(value, "element PNG content item"));
    expect(elementPngContent[0]).toEqual({
      type: "image",
      data: PNG_BASE64,
      mimeType: "image/png",
    });
    const elementPng = structured(elementPngResult);
    expect(elementPng).toMatchObject({
      sessionHandle,
      elementRef: submitRef,
      documentRevision: currentRevision,
      representation: "png",
      selector: null,
      html: null,
      mediaType: "image/png",
      byteLength: 68,
    });
    expect(elementPng).not.toHaveProperty("base64");

    const staleRevisionClick = await callTool("remote_browser_click", {
      sessionHandle,
      elementRef: submitRef,
      expectedControlEpoch: currentEpoch,
      expectedDocumentRevision: snapshotRevision,
    });
    expect(staleRevisionClick.isError).toBe(true);
    expect(errorCode(staleRevisionClick)).toBe("stale_document_revision");

    const staleControlClick = await callTool("remote_browser_click", {
      sessionHandle,
      elementRef: submitRef,
      expectedControlEpoch: currentEpoch + 1,
      expectedDocumentRevision: currentRevision,
    });
    expect(staleControlClick.isError).toBe(true);
    expect(errorCode(staleControlClick)).toBe("stale_control_epoch");

    const staleRefClick = await callTool("remote_browser_click", {
      sessionHandle,
      elementRef: oldSubmitRef,
      expectedControlEpoch: currentEpoch,
      expectedDocumentRevision: currentRevision,
    });
    expect(staleRefClick.isError).toBe(true);
    expect(errorCode(staleRefClick)).toBe("stale_element_ref");

    const clickResult = await callTool("remote_browser_click", {
      sessionHandle,
      elementRef: submitRef,
      expectedControlEpoch: currentEpoch,
      expectedDocumentRevision: currentRevision,
    });
    expect(clickResult.isError).not.toBe(true);
    const clicked = structured(clickResult);

    const coordinateClickResult = await callTool("remote_browser_click", {
      sessionHandle,
      xRatio: 0.25,
      yRatio: 0.5,
      expectedControlEpoch: control(clicked).epoch,
      expectedDocumentRevision: integer(
        clicked.documentRevision,
        "clicked revision",
      ),
    });
    expect(coordinateClickResult.isError).not.toBe(true);
    const coordinateClicked = structured(coordinateClickResult);

    const brokenClickResult = await callTool("remote_browser_click", {
      sessionHandle,
      elementRef: brokenRef,
      expectedControlEpoch: control(coordinateClicked).epoch,
      expectedDocumentRevision: integer(
        coordinateClicked.documentRevision,
        "clicked revision",
      ),
    });
    expect(brokenClickResult.isError).toBe(true);
    expect(errorCode(brokenClickResult)).toBe("cdp_command_failed");
    const brokenClickText = textContent(brokenClickResult);
    expect(brokenClickText).toContain("[REDACTED]");
    expect(brokenClickText).not.toContain("cdp-click-secret");
    expect(brokenClickText).not.toContain("cdp-query-secret");

    const diagnosticCursor = integer(
      diagnostics.nextCursor,
      "diagnostic cursor",
    );
    const cdpDiagnosticsResult = await callTool("remote_browser_diagnostics", {
      sessionHandle,
      cursor: diagnosticCursor,
      limit: 100,
    });
    const cdpDiagnostics = structured(cdpDiagnosticsResult);
    expect(array(cdpDiagnostics.items, "CDP diagnostic items")
      .map((value) => record(value, "CDP diagnostic")))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: "cdp",
          severity: "error",
          source: "DOM.getBoxModel",
        }),
      ]));
    const cdpDiagnosticsText = JSON.stringify(cdpDiagnostics);
    expect(cdpDiagnosticsText).toContain("[REDACTED]");
    expect(cdpDiagnosticsText).not.toContain("cdp-click-secret");
    expect(cdpDiagnosticsText).not.toContain("cdp-query-secret");

    const fillValue = "specialist-entered-text";
    const fillResult = await callTool("remote_browser_fill", {
      sessionHandle,
      elementRef: searchRef,
      value: fillValue,
      expectedControlEpoch: control(clicked).epoch,
      expectedDocumentRevision: integer(
        clicked.documentRevision,
        "fill revision",
      ),
    });
    expect(fillResult.isError).not.toBe(true);
    expect(JSON.stringify(fillResult)).not.toContain(fillValue);

    const scrollResult = await callTool("remote_browser_scroll", {
      sessionHandle,
      xRatio: 0.5,
      yRatio: 0.75,
      deltaX: 0,
      deltaY: 480,
      expectedControlEpoch: control(clicked).epoch,
      expectedDocumentRevision: integer(
        clicked.documentRevision,
        "scroll revision",
      ),
    });
    expect(scrollResult.isError).not.toBe(true);

    const credentialValue = "credential-value-must-never-echo";
    const credentialFillResult = await callTool("remote_browser_fill", {
      sessionHandle,
      elementRef: passwordRef,
      value: credentialValue,
      expectedControlEpoch: control(clicked).epoch,
      expectedDocumentRevision: integer(
        clicked.documentRevision,
        "credential refusal revision",
      ),
    });
    expect(credentialFillResult.isError).toBe(true);
    expect(errorCode(credentialFillResult)).toBe("credential_input_denied");
    expect(JSON.stringify(credentialFillResult)).not.toContain(credentialValue);

    const recorded = await cdpCommands();
    expect(recorded.sessions).toHaveLength(1);
    const commands = recorded.sessions[0]?.commands ?? [];
    const emulationIndex = commands.findIndex(
      ({ method }) => method === "Emulation.setDeviceMetricsOverride",
    );
    const navigationIndex = commands.findIndex(
      ({ method }) => method === "Page.navigate",
    );
    expect(emulationIndex).toBeGreaterThanOrEqual(0);
    expect(emulationIndex).toBeLessThan(navigationIndex);
    expect(commands[emulationIndex]).toMatchObject({
      method: "Emulation.setDeviceMetricsOverride",
      params: {
        width: 390,
        height: 844,
        deviceScaleFactor: 2,
        mobile: true,
        screenWidth: 390,
        screenHeight: 844,
      },
    });
    expect(commands.filter(({ method }) => method === "Input.dispatchMouseEvent"))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ params: expect.objectContaining({ type: "mouseMoved" }) }),
        expect.objectContaining({ params: expect.objectContaining({ type: "mousePressed" }) }),
        expect.objectContaining({ params: expect.objectContaining({ type: "mouseReleased" }) }),
        expect.objectContaining({
          params: expect.objectContaining({
            type: "mousePressed",
            x: 300,
            y: 400,
          }),
        }),
        expect.objectContaining({
          params: expect.objectContaining({
            type: "mouseWheel",
            x: 600,
            y: 600,
            deltaX: 0,
            deltaY: 480,
          }),
        }),
      ]));
    const fillCommand = commands.find(
      ({ method, params }) =>
        method === "Runtime.callFunctionOn" && params.userGesture === true,
    );
    expect(fillCommand?.params).toMatchObject({
      arguments: [{ value: fillValue }, { value: false }],
      awaitPromise: false,
      returnByValue: true,
      userGesture: true,
    });
    expect(JSON.stringify(commands)).not.toContain(credentialValue);

    const closeResult = await callTool("remote_browser_close", {
      sessionHandle,
    });
    expect(closeResult.isError).not.toBe(true);
    expect(structured(closeResult)).toEqual({ sessionHandle, state: "closed" });
  }, 15_000);

  it("shares one real browser among an agent and two human workspace members", async () => {
    callSequence += 1;
    const missingMetadataResponse = await mcpCall({
      jsonrpc: "2.0",
      id: callSequence,
      method: "tools/call",
      params: {
        name: "remote_browser_start",
        arguments: {
          url: "https://example.com/room",
          keepAliveMs: 600_000,
        },
      },
    });
    const missingMetadata = record(
      missingMetadataResponse.result,
      "missing metadata result",
    );
    expect(errorCode(missingMetadata)).toBe("participant_attestation_invalid");

    const startedResult = await callTool("remote_browser_start", {
      url: "https://example.com/shared-room",
      keepAliveMs: 600_000,
    });
    expect(startedResult.isError).not.toBe(true);
    const started = structured(startedResult);
    const sessionHandle = started.sessionHandle;
    if (typeof sessionHandle !== "string") throw new Error("Start omitted session handle.");
    const initialControl = control(started);
    expect(initialControl.participantId).toMatch(/^rp_[0-9a-f]{64}$/u);
    const documentRevision = integer(started.documentRevision, "shared document revision");

    const sharedResult = await callTool("remote_browser_share_session", {
      sessionHandle,
    });
    expect(sharedResult.isError).not.toBe(true);
    const shared = structured(sharedResult);
    const invitationToken = shared.invitationToken;
    if (typeof invitationToken !== "string") throw new Error("Share omitted invitation.");
    expect(invitationToken).toMatch(/^[0-9A-Za-z_-]{43}$/u);
    expect(shared.remainingUses).toBe(2);

    const humanBProps = authPropsFor("member-b@zephyr-cloud.io");
    const humanCProps = authPropsFor("member-c@zephyr-cloud.io");
    const humanB = humanParticipant("member-b@zephyr-cloud.io", "b");
    const humanC = humanParticipant("member-c@zephyr-cloud.io", "c");
    const joinedBResult = await callTool(
      "remote_browser_join_session",
      { sessionHandle, invitationToken },
      humanB,
      humanBProps,
    );
    expect(joinedBResult.isError).not.toBe(true);
    const joinedCResult = await callTool(
      "remote_browser_join_session",
      { sessionHandle, invitationToken },
      humanC,
      humanCProps,
    );
    expect(joinedCResult.isError).not.toBe(true);
    const joinedC = structured(joinedCResult);
    const participants = array(joinedC.participants, "room participants")
      .map((value) => record(value, "room participant"));
    expect(participants).toHaveLength(3);
    expect(new Set(participants.map((participant) => participant.kind))).toEqual(
      new Set(["agent", "human"]),
    );
    expect(participants.filter((participant) => participant.kind === "human"))
      .toHaveLength(2);
    expect(participants.find((participant) => participant.self === true))
      .toMatchObject({
        principalId: "member-c@zephyr-cloud.io",
        consumerKind: "package-contribution",
        status: "connected",
      });

    const agentScreenshot = await callTool("remote_browser_screenshot", {
      sessionHandle,
    });
    const humanBScreenshot = await callTool(
      "remote_browser_screenshot",
      { sessionHandle },
      humanB,
      humanBProps,
    );
    const humanCScreenshot = await callTool(
      "remote_browser_screenshot",
      { sessionHandle },
      humanC,
      humanCProps,
    );
    expect(imageData(agentScreenshot)).toBe(PNG_BASE64);
    expect(imageData(humanBScreenshot)).toBe(imageData(agentScreenshot));
    expect(imageData(humanCScreenshot)).toBe(imageData(agentScreenshot));
    expect([
      structured(agentScreenshot).documentRevision,
      structured(humanBScreenshot).documentRevision,
      structured(humanCScreenshot).documentRevision,
    ]).toEqual([documentRevision, documentRevision, documentRevision]);

    const claimBResult = await callTool(
      "remote_browser_claim_control",
      {
        sessionHandle,
        expectedControlEpoch: initialControl.epoch,
        leaseMs: 120_000,
      },
      humanB,
      humanBProps,
    );
    expect(claimBResult.isError).not.toBe(true);
    const claimedB = structured(claimBResult);
    const humanBControl = control(claimedB);
    expect(humanBControl.participantId).toBe(
      participants.find((participant) =>
        participant.principalId === "member-b@zephyr-cloud.io"
      )?.participantId,
    );

    const staleClaimC = await callTool(
      "remote_browser_claim_control",
      {
        sessionHandle,
        expectedControlEpoch: initialControl.epoch,
        leaseMs: 120_000,
      },
      humanC,
      humanCProps,
    );
    expect(errorCode(staleClaimC)).toBe("stale_control_epoch");
    const contendedClaimC = await callTool(
      "remote_browser_claim_control",
      {
        sessionHandle,
        expectedControlEpoch: humanBControl.epoch,
        leaseMs: 120_000,
      },
      humanC,
      humanCProps,
    );
    expect(errorCode(contendedClaimC)).toBe("control_contended");

    const fencedAgent = await callTool("remote_browser_navigate", {
      sessionHandle,
      url: "https://example.com/agent-fenced",
      expectedControlEpoch: humanBControl.epoch,
      expectedDocumentRevision: documentRevision,
    });
    expect(errorCode(fencedAgent)).toBe("control_lease_not_held");

    const releasedBResult = await callTool(
      "remote_browser_release_control",
      { sessionHandle, expectedControlEpoch: humanBControl.epoch },
      humanB,
      humanBProps,
    );
    expect(releasedBResult.isError).not.toBe(true);
    const released = control(structured(releasedBResult));
    expect(released.participantId).toBeNull();
    const claimedAgentResult = await callTool("remote_browser_claim_control", {
      sessionHandle,
      expectedControlEpoch: released.epoch,
      leaseMs: 120_000,
    });
    expect(claimedAgentResult.isError).not.toBe(true);
    const claimedAgent = control(structured(claimedAgentResult));
    expect(claimedAgent.participantId).toBe(initialControl.participantId);

    const navigatedResult = await callTool("remote_browser_navigate", {
      sessionHandle,
      url: "https://example.com/chloe-driving",
      expectedControlEpoch: claimedAgent.epoch,
      expectedDocumentRevision: documentRevision,
    });
    expect(navigatedResult.isError).not.toBe(true);

    const leftCResult = await callTool(
      "remote_browser_leave_session",
      { sessionHandle },
      humanC,
      humanCProps,
    );
    expect(structured(leftCResult)).toMatchObject({
      sessionHandle,
      status: "disconnected",
    });
    const rejoinedCResult = await callTool(
      "remote_browser_join_session",
      { sessionHandle, invitationToken },
      humanC,
      humanCProps,
    );
    expect(rejoinedCResult.isError).not.toBe(true);
    expect(array(structured(rejoinedCResult).participants, "rejoined participants"))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({
          principalId: "member-c@zephyr-cloud.io",
          status: "connected",
          self: true,
        }),
      ]));

    await callTool(
      "remote_browser_leave_session",
      { sessionHandle },
      humanC,
      humanCProps,
    );
    const reloadShare = structured(
      await callTool("remote_browser_share_session", { sessionHandle }),
    );
    const reloadInvitation = reloadShare.invitationToken;
    if (typeof reloadInvitation !== "string") throw new Error("Reshare omitted invitation.");
    const reloadedHumanC = humanParticipant("member-c@zephyr-cloud.io", "f");
    const replacementResult = await callTool(
      "remote_browser_join_session",
      { sessionHandle, invitationToken: reloadInvitation },
      reloadedHumanC,
      humanCProps,
    );
    expect(replacementResult.isError).not.toBe(true);
    const replacementParticipants = array(
      structured(replacementResult).participants,
      "replacement participants",
    ).map((value) => record(value, "replacement participant"));
    expect(replacementParticipants).toHaveLength(4);
    expect(replacementParticipants.filter((participant) =>
      participant.principalId === "member-c@zephyr-cloud.io"
    )).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "disconnected", self: false }),
      expect.objectContaining({ status: "connected", self: true }),
    ]));
    const displacedRejoin = await callTool(
      "remote_browser_join_session",
      { sessionHandle, invitationToken },
      humanC,
      humanCProps,
    );
    expect(errorCode(displacedRejoin)).toBe("participant_capacity_reached");

    const capacityShare = structured(
      await callTool("remote_browser_share_session", { sessionHandle }),
    );
    const nextInvitation = capacityShare.invitationToken;
    if (typeof nextInvitation !== "string") throw new Error("Reshare omitted invitation.");
    const humanDProps = authPropsFor("member-d@zephyr-cloud.io");
    const capacityResult = await callTool(
      "remote_browser_join_session",
      { sessionHandle, invitationToken: nextInvitation },
      humanParticipant("member-d@zephyr-cloud.io", "d"),
      humanDProps,
    );
    expect(errorCode(capacityResult)).toBe("participant_capacity_reached");

    const outsideProps = authPropsFor("outside@zephyr-cloud.io", "other-workspace");
    const outsideRoom = await callTool(
      "remote_browser_room",
      { sessionHandle },
      humanParticipant("outside@zephyr-cloud.io", "e", "other-workspace"),
      outsideProps,
    );
    expect(errorCode(outsideRoom)).toBe("session_not_found");

    const joinedCannotClose = await callTool(
      "remote_browser_close",
      { sessionHandle },
      humanB,
      humanBProps,
    );
    expect(errorCode(joinedCannotClose)).toBe("close_not_allowed");
    const roomStillActive = structured(
      await callTool("remote_browser_room", { sessionHandle }),
    );
    expect(roomStillActive.state).toBe("active");
    expect((await cdpCommands()).sessions).toHaveLength(1);

    const closed = await callTool("remote_browser_close", { sessionHandle });
    expect(structured(closed)).toEqual({ sessionHandle, state: "closed" });
  }, 20_000);

  it("lets Chloe join a human-created room and claim its soft initial control", async () => {
    const humanA = humanParticipant("zack@zephyr-cloud.io", "1");
    const startedResult = await callTool(
      "remote_browser_start",
      {
        url: "https://example.com/human-created",
        keepAliveMs: 600_000,
      },
      humanA,
      authProps,
    );
    expect(startedResult.isError).not.toBe(true);
    const started = structured(startedResult);
    const sessionHandle = started.sessionHandle;
    if (typeof sessionHandle !== "string") throw new Error("Start omitted session handle.");
    const humanControl = control(started);
    const originalRevision = integer(started.documentRevision, "human-created revision");
    expect(record(started.control, "initial human control")).toMatchObject({
      holder: "human",
      expiresAt: null,
    });

    const shared = structured(
      await callTool(
        "remote_browser_share_session",
        { sessionHandle },
        humanA,
        authProps,
      ),
    );
    const invitationToken = shared.invitationToken;
    if (typeof invitationToken !== "string") throw new Error("Share omitted invitation.");
    const roomCode = encodeRemoteBrowserRoomCode({
      sessionHandle,
      invitationToken,
    });
    const joinedAgent = await callTool(
      "remote_browser_join_session",
      { roomCode },
      AGENT_PARTICIPANT,
      authProps,
    );
    expect(joinedAgent.isError).not.toBe(true);
    // A second desktop session can use the same signed-in account while the
    // host-owned app-session identity keeps it distinct from the creator.
    const secondInstallationId = "local-custom-miniapp-app-2";
    const humanBProps = authPropsFor("zack@zephyr-cloud.io", "kitesurf-test", {
      installationId: secondInstallationId,
    });
    const humanB = humanParticipant(
      "zack@zephyr-cloud.io",
      "2",
      "kitesurf-test",
      secondInstallationId,
    );
    const joinedHuman = await callTool(
      "remote_browser_join_session",
      { sessionHandle, invitationToken },
      humanB,
      humanBProps,
    );
    expect(joinedHuman.isError).not.toBe(true);
    const humanCreatedParticipants = array(
      structured(joinedHuman).participants,
      "human-created participants",
    ).map((value) => record(value, "human-created participant"));
    expect(humanCreatedParticipants).toHaveLength(3);
    const sameAccountHumans = humanCreatedParticipants.filter(
      (participant) =>
        participant.kind === "human" &&
        participant.principalId === "zack@zephyr-cloud.io",
    );
    expect(sameAccountHumans).toHaveLength(2);
    expect(new Set(sameAccountHumans.map((participant) => participant.participantId)).size)
      .toBe(2);
    expect(sameAccountHumans.filter((participant) => participant.self === true))
      .toHaveLength(1);

    const wrongPackageJoin = await callTool(
      "remote_browser_join_session",
      { sessionHandle, invitationToken },
      humanParticipant(
        "zack@zephyr-cloud.io",
        "3",
        "kitesurf-test",
        "local-custom-miniapp-wrong-package",
      ),
      authPropsFor("zack@zephyr-cloud.io", "kitesurf-test", {
        packageId: "tap_pkg_other_remote_browser",
        installationId: "local-custom-miniapp-wrong-package",
      }),
    );
    expect(errorCode(wrongPackageJoin)).toBe("session_not_found");

    const wrongServerJoin = await callTool(
      "remote_browser_join_session",
      { sessionHandle, invitationToken },
      humanParticipant(
        "zack@zephyr-cloud.io",
        "4",
        "kitesurf-test",
        "local-custom-miniapp-wrong-server",
      ),
      authPropsFor("zack@zephyr-cloud.io", "kitesurf-test", {
        contributionId: "other-browser-tools",
        installationId: "local-custom-miniapp-wrong-server",
      }),
    );
    expect(errorCode(wrongServerJoin)).toBe("session_not_found");

    const claimedResult = await callTool(
      "remote_browser_claim_control",
      {
        sessionHandle,
        expectedControlEpoch: humanControl.epoch,
        leaseMs: 120_000,
      },
      AGENT_PARTICIPANT,
      authProps,
    );
    expect(claimedResult.isError).not.toBe(true);
    const agentControl = control(structured(claimedResult));
    expect(record(structured(claimedResult).control, "agent control")).toMatchObject({
      holder: "agent",
      participantId: expect.stringMatching(/^rp_[0-9a-f]{64}$/u),
      expiresAt: null,
    });

    const navigationResult = await callTool(
      "remote_browser_navigate",
      {
        sessionHandle,
        url: "https://example.com/chloe-from-human-room",
        expectedControlEpoch: agentControl.epoch,
        expectedDocumentRevision: originalRevision,
      },
      AGENT_PARTICIPANT,
      authProps,
    );
    expect(navigationResult.isError).not.toBe(true);
    const navigatedRevision = integer(
      structured(navigationResult).documentRevision,
      "Chloe navigation revision",
    );

    const humanAScreenshot = await callTool(
      "remote_browser_screenshot",
      { sessionHandle },
      humanA,
      authProps,
    );
    const humanBScreenshot = await callTool(
      "remote_browser_screenshot",
      { sessionHandle },
      humanB,
      humanBProps,
    );
    expect(imageData(humanAScreenshot)).toBe(imageData(humanBScreenshot));
    expect(structured(humanAScreenshot).documentRevision).toBe(navigatedRevision);
    expect(structured(humanBScreenshot).documentRevision).toBe(navigatedRevision);
    expect((await cdpCommands()).sessions).toHaveLength(1);

    const idempotentResume = await callTool(
      "remote_browser_join_session",
      { sessionHandle },
      humanA,
      authProps,
    );
    expect(idempotentResume.isError).not.toBe(true);
    expect(array(structured(idempotentResume).participants, "idempotent participants"))
      .toHaveLength(3);

    const leftCreator = await callTool(
      "remote_browser_leave_session",
      { sessionHandle },
      humanA,
      authProps,
    );
    expect(structured(leftCreator)).toMatchObject({
      sessionHandle,
      status: "disconnected",
    });
    const resumedCreator = await callTool(
      "remote_browser_join_session",
      { sessionHandle },
      humanA,
      authProps,
    );
    expect(resumedCreator.isError).not.toBe(true);
    expect(array(structured(resumedCreator).participants, "resumed participants"))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({
          principalId: "zack@zephyr-cloud.io",
          status: "connected",
          creator: true,
          self: true,
        }),
      ]));

    const changedAppSession = await callTool(
      "remote_browser_join_session",
      { sessionHandle },
      humanParticipant("zack@zephyr-cloud.io", "9"),
      authProps,
    );
    expect(errorCode(changedAppSession)).toBe("invitation_invalid");
    const wrongWorkspaceProps = authPropsFor(
      "zack@zephyr-cloud.io",
      "another-workspace",
    );
    const wrongWorkspaceResume = await callTool(
      "remote_browser_join_session",
      { sessionHandle },
      humanParticipant("zack@zephyr-cloud.io", "1", "another-workspace"),
      wrongWorkspaceProps,
    );
    expect(errorCode(wrongWorkspaceResume)).toBe("session_not_found");

    const reshared = await callTool(
      "remote_browser_share_session",
      { sessionHandle },
      humanA,
      authProps,
    );
    expect(reshared.isError).not.toBe(true);
    expect(structured(reshared).remainingUses).toBe(2);

    const closed = await callTool(
      "remote_browser_close",
      { sessionHandle },
      humanA,
      authProps,
    );
    expect(structured(closed)).toEqual({ sessionHandle, state: "closed" });
  }, 20_000);

  it("prunes force-killed participants and recovers human and agent capacity", async () => {
    const creator = humanParticipant("zack@zephyr-cloud.io", "1");
    const startedResult = await callTool(
      "remote_browser_start",
      { url: "https://example.com/presence-recovery", keepAliveMs: 600_000 },
      creator,
      authProps,
    );
    expect(startedResult.isError).not.toBe(true);
    const started = structured(startedResult);
    const sessionHandle = started.sessionHandle;
    if (typeof sessionHandle !== "string") throw new Error("Start omitted session handle.");

    const shared = structured(await callTool(
      "remote_browser_share_session",
      { sessionHandle },
      creator,
      authProps,
    ));
    const invitationToken = shared.invitationToken;
    if (typeof invitationToken !== "string") throw new Error("Share omitted invitation.");
    const joinedAgent = await callTool(
      "remote_browser_join_session",
      { sessionHandle, invitationToken },
      AGENT_PARTICIPANT,
      authProps,
    );
    expect(joinedAgent.isError).not.toBe(true);

    const secondInstallationId = "local-custom-miniapp-app-2";
    const secondHumanProps = authPropsFor("zack@zephyr-cloud.io", "kitesurf-test", {
      installationId: secondInstallationId,
    });
    const secondHuman = humanParticipant(
      "zack@zephyr-cloud.io",
      "2",
      "kitesurf-test",
      secondInstallationId,
    );
    const joinedSecondHuman = await callTool(
      "remote_browser_join_session",
      { sessionHandle, invitationToken },
      secondHuman,
      secondHumanProps,
    );
    expect(joinedSecondHuman.isError).not.toBe(true);
    const initialParticipants = array(
      structured(joinedSecondHuman).participants,
      "presence participants",
    ).map((value) => record(value, "presence participant"));
    const agentId = initialParticipants.find((participant) => participant.kind === "agent")
      ?.participantId;
    const secondHumanId = initialParticipants.find((participant) => participant.self === true)
      ?.participantId;
    if (typeof agentId !== "string" || typeof secondHumanId !== "string") {
      throw new Error("Joined room omitted participant IDs.");
    }

    const claimedResult = await callTool(
      "remote_browser_claim_control",
      {
        sessionHandle,
        expectedControlEpoch: control(started).epoch,
        leaseMs: 120_000,
      },
      AGENT_PARTICIPANT,
      authProps,
    );
    expect(claimedResult.isError).not.toBe(true);
    const claimed = control(structured(claimedResult));
    expect(claimed.participantId).toBe(agentId);

    await ageParticipants(sessionHandle, [agentId, secondHumanId]);
    const recoveredRoom = structured(await callTool(
      "remote_browser_room",
      { sessionHandle },
      creator,
      authProps,
    ));
    const recoveredParticipants = array(
      recoveredRoom.participants,
      "recovered participants",
    ).map((value) => record(value, "recovered participant"));
    expect(recoveredParticipants).toEqual(expect.arrayContaining([
      expect.objectContaining({ participantId: agentId, status: "disconnected" }),
      expect.objectContaining({ participantId: secondHumanId, status: "disconnected" }),
    ]));
    expect(control(recoveredRoom)).toEqual({
      epoch: claimed.epoch + 1,
      participantId: null,
    });

    const replacementShare = structured(await callTool(
      "remote_browser_share_session",
      { sessionHandle },
      creator,
      authProps,
    ));
    const replacementInvitation = replacementShare.invitationToken;
    if (typeof replacementInvitation !== "string") {
      throw new Error("Replacement share omitted invitation.");
    }
    const replacementAgent = agentParticipant("researcher", "b");
    const replacementAgentResult = await callTool(
      "remote_browser_join_session",
      { sessionHandle, invitationToken: replacementInvitation },
      replacementAgent,
      authProps,
    );
    expect(replacementAgentResult.isError).not.toBe(true);

    const thirdInstallationId = "local-custom-miniapp-app-3";
    const thirdHumanProps = authPropsFor("zack@zephyr-cloud.io", "kitesurf-test", {
      installationId: thirdInstallationId,
    });
    const replacementHumanResult = await callTool(
      "remote_browser_join_session",
      { sessionHandle, invitationToken: replacementInvitation },
      humanParticipant(
        "zack@zephyr-cloud.io",
        "3",
        "kitesurf-test",
        thirdInstallationId,
      ),
      thirdHumanProps,
    );
    expect(replacementHumanResult.isError).not.toBe(true);
    const replacementParticipants = array(
      structured(replacementHumanResult).participants,
      "replacement participants",
    ).map((value) => record(value, "replacement participant"));
    const connected = replacementParticipants.filter(
      (participant) => participant.status === "connected",
    );
    expect(connected.filter((participant) => participant.kind === "agent")).toHaveLength(1);
    expect(connected.filter((participant) => participant.kind === "human")).toHaveLength(2);
    expect((await cdpCommands()).sessions).toHaveLength(1);

    const closed = await callTool(
      "remote_browser_close",
      { sessionHandle },
      creator,
      authProps,
    );
    expect(structured(closed)).toEqual({ sessionHandle, state: "closed" });
  }, 20_000);

  it("expires creator presence while preserving tokenless creator authority", async () => {
    const creator = humanParticipant("zack@zephyr-cloud.io", "1");
    const startedResult = await callTool(
      "remote_browser_start",
      { url: "https://example.com/creator-presence", keepAliveMs: 600_000 },
      creator,
      authProps,
    );
    expect(startedResult.isError).not.toBe(true);
    const started = structured(startedResult);
    const sessionHandle = started.sessionHandle;
    if (typeof sessionHandle !== "string") throw new Error("Start omitted session handle.");

    const shared = structured(await callTool(
      "remote_browser_share_session",
      { sessionHandle },
      creator,
      authProps,
    ));
    const invitationToken = shared.invitationToken;
    if (typeof invitationToken !== "string") throw new Error("Share omitted invitation.");
    const creatorRoom = structured(await callTool(
      "remote_browser_room",
      { sessionHandle },
      creator,
      authProps,
    ));
    const creatorParticipant = array(creatorRoom.participants, "creator participants")
      .map((value) => record(value, "creator participant"))
      .find((participant) => participant.self === true);
    if (typeof creatorParticipant?.participantId !== "string") {
      throw new Error("Started room omitted the creator participant ID.");
    }
    const creatorId = creatorParticipant.participantId;
    await ageParticipants(sessionHandle, [creatorId]);

    const secondInstallationId = "local-custom-miniapp-app-2";
    const secondHuman = humanParticipant(
      "zack@zephyr-cloud.io",
      "2",
      "kitesurf-test",
      secondInstallationId,
    );
    const secondHumanProps = authPropsFor("zack@zephyr-cloud.io", "kitesurf-test", {
      installationId: secondInstallationId,
    });
    const joinedSecond = await callTool(
      "remote_browser_join_session",
      { sessionHandle, invitationToken },
      secondHuman,
      secondHumanProps,
    );
    expect(joinedSecond.isError).not.toBe(true);

    const thirdInstallationId = "local-custom-miniapp-app-3";
    const thirdHuman = humanParticipant(
      "zack@zephyr-cloud.io",
      "3",
      "kitesurf-test",
      thirdInstallationId,
    );
    const thirdHumanProps = authPropsFor("zack@zephyr-cloud.io", "kitesurf-test", {
      installationId: thirdInstallationId,
    });
    const joinedThird = await callTool(
      "remote_browser_join_session",
      { sessionHandle, invitationToken },
      thirdHuman,
      thirdHumanProps,
    );
    expect(joinedThird.isError).not.toBe(true);
    const occupiedRoom = array(
      structured(joinedThird).participants,
      "creator replacement participants",
    ).map((value) => record(value, "creator replacement participant"));
    expect(occupiedRoom).toEqual(expect.arrayContaining([
      expect.objectContaining({
        participantId: creatorId,
        creator: true,
        status: "disconnected",
      }),
    ]));
    expect(occupiedRoom.filter((participant) =>
      participant.kind === "human" && participant.status === "connected"
    )).toHaveLength(2);

    const blockedCreator = await callTool(
      "remote_browser_join_session",
      { sessionHandle },
      creator,
      authProps,
    );
    expect(errorCode(blockedCreator)).toBe("participant_capacity_reached");

    const leftSecond = await callTool(
      "remote_browser_leave_session",
      { sessionHandle },
      secondHuman,
      secondHumanProps,
    );
    expect(leftSecond.isError).not.toBe(true);
    const resumedCreator = await callTool(
      "remote_browser_join_session",
      { sessionHandle },
      creator,
      authProps,
    );
    expect(resumedCreator.isError).not.toBe(true);
    expect(array(structured(resumedCreator).participants, "resumed creator participants"))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({
          participantId: creatorId,
          creator: true,
          self: true,
          status: "connected",
        }),
      ]));

    const creatorShare = await callTool(
      "remote_browser_share_session",
      { sessionHandle },
      creator,
      authProps,
    );
    expect(creatorShare.isError).not.toBe(true);
    expect(structured(creatorShare).remainingUses).toBe(2);
    const closed = await callTool(
      "remote_browser_close",
      { sessionHandle },
      creator,
      authProps,
    );
    expect(structured(closed)).toEqual({ sessionHandle, state: "closed" });
  }, 20_000);

  it("renews active presence and retains a stale controller during a mutation", async () => {
    const creator = humanParticipant("zack@zephyr-cloud.io", "1");
    const startedResult = await callTool(
      "remote_browser_start",
      { url: "https://example.com/presence-renewal", keepAliveMs: 600_000 },
      creator,
      authProps,
    );
    expect(startedResult.isError).not.toBe(true);
    const started = structured(startedResult);
    const sessionHandle = started.sessionHandle;
    if (typeof sessionHandle !== "string") throw new Error("Start omitted session handle.");

    const shared = structured(await callTool(
      "remote_browser_share_session",
      { sessionHandle },
      creator,
      authProps,
    ));
    const invitationToken = shared.invitationToken;
    if (typeof invitationToken !== "string") throw new Error("Share omitted invitation.");
    const joinedAgent = structured(await callTool(
      "remote_browser_join_session",
      { sessionHandle, invitationToken },
      AGENT_PARTICIPANT,
      authProps,
    ));
    const agent = array(joinedAgent.participants, "renewal participants")
      .map((value) => record(value, "renewal participant"))
      .find((participant) => participant.kind === "agent");
    if (typeof agent?.participantId !== "string") {
      throw new Error("Joined room omitted the agent participant ID.");
    }
    const agentId = agent.participantId;
    const claimedResult = await callTool(
      "remote_browser_claim_control",
      {
        sessionHandle,
        expectedControlEpoch: control(started).epoch,
        leaseMs: 120_000,
      },
      AGENT_PARTICIPANT,
      authProps,
    );
    expect(claimedResult.isError).not.toBe(true);
    const claimed = control(structured(claimedResult));

    const staleAt = await ageParticipants(sessionHandle, [agentId]);
    const heartbeatStartedAt = Date.now();
    const heartbeat = await callTool(
      "remote_browser_room",
      { sessionHandle },
      AGENT_PARTICIPANT,
      authProps,
    );
    expect(heartbeat.isError).not.toBe(true);
    const renewed = await participantPresence(sessionHandle, agentId);
    expect(renewed).toMatchObject({ status: "connected" });
    expect(renewed.lastSeenAt).toBeGreaterThan(staleAt);
    expect(renewed.lastSeenAt).toBeGreaterThanOrEqual(heartbeatStartedAt);

    await ageParticipants(sessionHandle, [agentId]);
    await setMutationLease(sessionHandle, Date.now() + 30_000);
    const protectedRoom = structured(await callTool(
      "remote_browser_room",
      { sessionHandle },
      creator,
      authProps,
    ));
    expect(array(protectedRoom.participants, "protected participants")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ participantId: agentId, status: "connected" }),
      ]),
    );
    expect(control(protectedRoom)).toEqual(claimed);

    await setMutationLease(sessionHandle, null);
    const fencedRoom = structured(await callTool(
      "remote_browser_room",
      { sessionHandle },
      creator,
      authProps,
    ));
    expect(array(fencedRoom.participants, "fenced participants")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ participantId: agentId, status: "disconnected" }),
      ]),
    );
    expect(control(fencedRoom)).toEqual({
      epoch: claimed.epoch + 1,
      participantId: null,
    });

    const closed = await callTool(
      "remote_browser_close",
      { sessionHandle },
      creator,
      authProps,
    );
    expect(structured(closed)).toEqual({ sessionHandle, state: "closed" });
  }, 20_000);
});
