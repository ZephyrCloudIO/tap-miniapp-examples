import { describe, expect, it, vi } from "vitest";
import {
  CdpClientError,
  connectBrowserRunCdp,
  type CdpBrowserBinding,
  type CdpCommandOptions,
  type CdpEvent,
} from "../src/cdp-client";

interface RecordedCommand {
  readonly id: number;
  readonly method: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly sessionId: string | null;
}

interface TestConnection {
  readonly socket: WebSocket;
  readonly clientSocket: WebSocket;
  readonly commands: RecordedCommand[];
  readonly targetSessionId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseCommand(value: unknown): RecordedCommand {
  if (typeof value !== "string") throw new Error("Expected a text CDP command");
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed)) throw new Error("Expected a CDP command object");
  if (!Number.isSafeInteger(parsed.id) || Number(parsed.id) < 1) {
    throw new Error("Expected a positive command id");
  }
  if (typeof parsed.method !== "string") throw new Error("Expected a method");
  const params = isRecord(parsed.params) ? parsed.params : {};
  return {
    id: Number(parsed.id),
    method: parsed.method,
    params,
    sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId : null,
  };
}

class CdpBindingHarness implements CdpBrowserBinding {
  readonly requests: Array<{
    readonly url: string;
    readonly upgrade: string | null;
    readonly client: string | null;
  }> = [];

  readonly connections: TestConnection[] = [];

  async fetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const requestUrl = input instanceof Request ? input.url : String(input);
    const headers = new Headers(init?.headers);
    this.requests.push({
      url: requestUrl,
      upgrade: headers.get("Upgrade"),
      client: headers.get("cf-brapi-client"),
    });

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const targetSessionId = `target-session-${this.connections.length + 1}`;
    const connection: TestConnection = {
      socket: server,
      clientSocket: client,
      commands: [],
      targetSessionId,
    };
    this.connections.push(connection);
    server.accept();
    server.addEventListener("message", (event) => {
      const command = parseCommand(event.data);
      connection.commands.push(command);
      if (command.method === "Target.attachToTarget") {
        this.respond(connection, command, { sessionId: targetSessionId });
        return;
      }
      if (command.method.endsWith(".enable")) {
        this.respond(connection, command, {});
        return;
      }
      if (command.params.defer === true) return;
      if (command.params.protocolError === true) {
        server.send(JSON.stringify({
          id: command.id,
          sessionId: command.sessionId,
          error: {
            code: -32_000,
            message:
              "Authorization: Bearer top-secret https://example.com/signed/path-secret?token=query-secret password=pass-secret {\"cookie\":\"session=json-secret\"}",
          },
        }));
        return;
      }
      this.respond(connection, command, {
        marker: command.params.marker ?? null,
      });
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  respond(
    connection: TestConnection,
    command: RecordedCommand,
    result: Readonly<Record<string, unknown>>,
  ): void {
    connection.socket.send(JSON.stringify({
      id: command.id,
      sessionId: command.sessionId,
      result,
    }));
  }

  emit(
    connection: TestConnection,
    event: Readonly<Record<string, unknown>>,
  ): void {
    connection.socket.send(JSON.stringify(event));
  }
}

async function waitForCommandCount(
  connection: TestConnection,
  count: number,
): Promise<void> {
  await vi.waitFor(() => {
    expect(connection.commands).toHaveLength(count);
  });
}

async function connect(
  binding: CdpBindingHarness,
  onEvent: (event: CdpEvent) => void | Promise<void> = () => undefined,
  overrides: Readonly<{
    commandTimeoutMs?: number;
    maxDebugErrors?: number;
    maxDebugBytes?: number;
    onDisconnect?: (event: {
      readonly code: number;
      readonly reason: string;
      readonly wasClean: boolean;
    }) => void | Promise<void>;
  }> = {},
) {
  return connectBrowserRunCdp({
    browser: binding,
    upstreamSessionId: "upstream-1",
    targetId: "target-1",
    onEvent,
    ...overrides,
  });
}

describe("Browser Run CDP client", () => {
  it("upgrades the existing session, attaches the target, enables observability domains, and surfaces events", async () => {
    const binding = new CdpBindingHarness();
    const events: CdpEvent[] = [];
    const client = await connect(binding, (event) => {
      events.push(event);
    });

    expect(binding.requests).toEqual([{
      url: "https://browser.internal/v1/devtools/browser/upstream-1",
      upgrade: "websocket",
      client: "@tap-examples/agent-browser-gateway@0.2.0",
    }]);
    const connection = binding.connections[0];
    expect(connection).toBeDefined();
    expect(connection?.commands.map(({ method }) => method)).toEqual([
      "Target.attachToTarget",
      "Page.enable",
      "DOM.enable",
      "Runtime.enable",
      "Log.enable",
      "Network.enable",
      "Accessibility.enable",
    ]);
    expect(connection?.commands[0]).toMatchObject({
      params: { targetId: "target-1", flatten: true },
      sessionId: null,
    });
    expect(
      connection?.commands.slice(1).every(
        ({ sessionId }) => sessionId === connection.targetSessionId,
      ),
    ).toBe(true);
    expect(client.state).toBe("open");
    expect(client.targetSessionId).toBe(connection?.targetSessionId);

    binding.emit(connection!, {
      method: "Network.responseReceived",
      sessionId: connection?.targetSessionId,
      params: {
        requestId: "request-1",
        response: { status: 200, url: "https://example.com/" },
      },
    });
    binding.emit(connection!, {
      method: "Runtime.consoleAPICalled",
      sessionId: connection?.targetSessionId,
      params: { type: "error", args: [{ value: "boom" }] },
    });
    await vi.waitFor(() => expect(events).toHaveLength(2));
    expect(events[0]).toMatchObject({
      method: "Network.responseReceived",
      sessionId: connection?.targetSessionId,
      params: { requestId: "request-1" },
    });
    expect(events[0]?.receivedAt).toEqual(expect.any(Number));
    expect(events[1]?.method).toBe("Runtime.consoleAPICalled");

    await client.close();
  });

  it("correlates out-of-order command responses and times commands out", async () => {
    const binding = new CdpBindingHarness();
    const client = await connect(binding, undefined, { commandTimeoutMs: 50 });
    const connection = binding.connections[0]!;
    const initialCount = connection.commands.length;
    const options: CdpCommandOptions = { timeoutMs: 1_000 };

    const first = client.send<{ readonly marker: string }>(
      "Runtime.evaluate",
      { marker: "first", defer: true },
      options,
    );
    const second = client.send<{ readonly marker: string }>(
      "Runtime.evaluate",
      { marker: "second", defer: true },
      options,
    );
    await waitForCommandCount(connection, initialCount + 2);
    const firstCommand = connection.commands.at(-2)!;
    const secondCommand = connection.commands.at(-1)!;
    binding.respond(connection, secondCommand, { marker: "second" });
    binding.respond(connection, firstCommand, { marker: "first" });

    await expect(first).resolves.toEqual({ marker: "first" });
    await expect(second).resolves.toEqual({ marker: "second" });
    expect(firstCommand.sessionId).toBe(connection.targetSessionId);
    expect(secondCommand.sessionId).toBe(connection.targetSessionId);

    await expect(client.send(
      "Runtime.evaluate",
      { defer: true },
      { timeoutMs: 15 },
    )).rejects.toMatchObject({
      code: "cdp_command_timeout",
      method: "Runtime.evaluate",
    });
    expect(client.getDebugErrors().at(-1)).toMatchObject({
      code: "cdp_command_timeout",
      method: "Runtime.evaluate",
    });

    await client.close();
  });

  it("bounds and redacts protocol diagnostics", async () => {
    const binding = new CdpBindingHarness();
    const client = await connect(binding, undefined, {
      maxDebugErrors: 2,
      maxDebugBytes: 1_024,
    });

    for (let index = 0; index < 4; index += 1) {
      await expect(client.send(
        "Runtime.evaluate",
        { protocolError: true, marker: index },
      )).rejects.toBeInstanceOf(CdpClientError);
    }

    const diagnostics = client.getDebugErrors();
    const serialized = JSON.stringify(diagnostics);
    expect(diagnostics.length).toBeLessThanOrEqual(2);
    expect(diagnostics.map(({ sequence }) => sequence)).toEqual([3, 4]);
    expect(new TextEncoder().encode(serialized).byteLength).toBeLessThanOrEqual(
      1_024,
    );
    expect(serialized).toContain("[REDACTED]");
    expect(serialized).not.toContain("top-secret");
    expect(serialized).not.toContain("query-secret");
    expect(serialized).not.toContain("pass-secret");
    expect(serialized).not.toContain("path-secret");
    expect(serialized).not.toContain("json-secret");
    expect(serialized).not.toContain("?token=");

    await client.close();
  });

  it("rejects pending work on reconnect, reattaches cleanly, and closes idempotently", async () => {
    const binding = new CdpBindingHarness();
    const disconnected: Array<{
      readonly code: number;
      readonly reason: string;
      readonly wasClean: boolean;
    }> = [];
    const client = await connect(binding, undefined, {
      onDisconnect: (event) => {
        disconnected.push(event);
      },
    });
    const firstConnection = binding.connections[0]!;
    await client.start();
    expect(binding.connections).toHaveLength(1);
    const pending = client.send("Runtime.evaluate", { defer: true });
    const pendingRejection = expect(pending).rejects.toMatchObject({
      code: "cdp_connection_replaced",
    });
    await waitForCommandCount(firstConnection, 8);

    await client.reconnect();
    await pendingRejection;
    expect(binding.connections).toHaveLength(2);
    expect(client.state).toBe("open");
    expect(client.targetSessionId).toBe("target-session-2");
    expect(binding.connections[1]?.commands.map(({ method }) => method)).toEqual(
      firstConnection.commands.slice(0, 7).map(({ method }) => method),
    );
    await expect(client.send("Runtime.evaluate", { marker: "new" })).resolves
      .toEqual({ marker: "new" });

    const errorPending = client.send("Runtime.evaluate", { defer: true });
    const errorPendingRejection = expect(errorPending).rejects.toMatchObject({
      code: "cdp_disconnected",
    });
    await waitForCommandCount(binding.connections[1]!, 9);
    binding.connections[1]?.clientSocket.dispatchEvent(new ErrorEvent(
      "error",
      { message: "Authorization: Bearer disconnect-secret" },
    ));
    await vi.waitFor(() => expect(client.state).toBe("disconnected"));
    await errorPendingRejection;
    expect(disconnected).toHaveLength(1);
    expect(disconnected[0]?.reason).not.toContain("disconnect-secret");

    await client.reconnect();
    binding.connections[2]?.socket.close(
      1011,
      "Authorization: Bearer disconnect-secret",
    );
    await vi.waitFor(() => expect(client.state).toBe("disconnected"));
    expect(disconnected).toHaveLength(2);
    expect(disconnected[1]?.reason).not.toContain("disconnect-secret");

    await client.reconnect();
    expect(client.state).toBe("open");
    await client.close();
    await client.close();
    expect(client.state).toBe("closed");
    await expect(client.send("Runtime.evaluate")).rejects.toMatchObject({
      code: "cdp_closed",
    });
    await expect(client.reconnect()).rejects.toMatchObject({
      code: "cdp_closed",
    });
  });

  it("captures rejected asynchronous event delivery without leaking its error", async () => {
    const binding = new CdpBindingHarness();
    const client = await connect(binding, async (event) => {
      if (event.method === "Runtime.exceptionThrown") {
        throw new Error(
          "Authorization: Bearer callback-secret https://example.com/signed/event-secret",
        );
      }
    });
    const connection = binding.connections[0]!;

    binding.emit(connection, {
      method: "Runtime.exceptionThrown",
      sessionId: connection.targetSessionId,
      params: { exceptionDetails: { text: "page failure" } },
    });
    await vi.waitFor(() => {
      expect(client.getDebugErrors().some(
        ({ code }) => code === "cdp_event_callback_failed",
      )).toBe(true);
    });
    const serialized = JSON.stringify(client.getDebugErrors());
    expect(serialized).not.toContain("callback-secret");
    expect(serialized).not.toContain("event-secret");

    await client.close();
  });

  it("does not expose an unsuccessful upgrade body", async () => {
    const browser: CdpBrowserBinding = {
      async fetch(): Promise<Response> {
        return new Response(
          "Authorization: Bearer response-secret https://example.com/?token=secret",
          { status: 502 },
        );
      },
    };

    let failure: unknown;
    try {
      await connectBrowserRunCdp({
        browser,
        upstreamSessionId: "upstream-1",
        targetId: "target-1",
        onEvent: () => undefined,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(CdpClientError);
    expect(JSON.stringify(failure)).not.toContain("response-secret");
    expect((failure as CdpClientError).message).toBe(
      "Browser Run did not provide a CDP WebSocket.",
    );
  });
});
