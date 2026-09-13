import { DurableObject } from "cloudflare:workers";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function initialSession(upstreamSessionId) {
  const sequence = upstreamSessionId.slice("upstream-".length);
  return {
    upstreamSessionId,
    targetId: `target-${sequence}`,
    targetSessionId: `cdp-target-${sequence}`,
    commands: [],
    navigationSequence: 0,
    url: "about:blank",
    title: "",
    socket: null,
  };
}

function parseCommand(value) {
  if (typeof value !== "string") throw new Error("Expected a text CDP command");
  const command = JSON.parse(value);
  if (!command || typeof command !== "object" || Array.isArray(command)) {
    throw new Error("Expected a CDP command object");
  }
  if (!Number.isSafeInteger(command.id) || command.id < 1) {
    throw new Error("Expected a positive CDP command id");
  }
  if (typeof command.method !== "string") throw new Error("Expected a CDP method");
  return {
    id: command.id,
    method: command.method,
    params:
      command.params && typeof command.params === "object" &&
        !Array.isArray(command.params)
        ? command.params
        : {},
    sessionId: typeof command.sessionId === "string" ? command.sessionId : null,
  };
}

function send(session, value) {
  session.socket?.send(JSON.stringify(value));
}

function respond(session, command, result = {}) {
  send(session, {
    id: command.id,
    ...(command.sessionId === null ? {} : { sessionId: command.sessionId }),
    result,
  });
}

function axNodes() {
  const property = (name, value) => ({
    name,
    value: { type: "boolean", value },
  });
  const node = (backendDOMNodeId, role, name, options = {}) => ({
    nodeId: `ax-${backendDOMNodeId}`,
    backendDOMNodeId,
    ignored: false,
    role: { type: "role", value: role },
    name: { type: "computedString", value: name },
    ...(options.value === undefined
      ? {}
      : { value: { type: "string", value: options.value } }),
    properties: [
      property("focusable", role !== "heading"),
      property("editable", options.editable === true),
      property("disabled", false),
      property("focused", false),
    ],
  });
  return [
    node(101, "heading", "Remote Browser test page"),
    node(102, "button", "Submit search"),
    node(103, "textbox", "Search query", { editable: true }),
    node(104, "textbox", "Account password", { editable: true }),
    node(105, "button", "Broken action"),
  ];
}

function describedNode(backendNodeId) {
  if (backendNodeId === 104) {
    return {
      node: {
        backendNodeId,
        nodeName: "INPUT",
        attributes: [
          "type",
          "password",
          "name",
          "account-password",
          "autocomplete",
          "current-password",
        ],
      },
    };
  }
  if (backendNodeId === 103) {
    return {
      node: {
        backendNodeId,
        nodeName: "INPUT",
        attributes: ["type", "text", "name", "query", "aria-label", "Search query"],
      },
    };
  }
  return {
    node: { backendNodeId, nodeName: "BUTTON", attributes: ["type", "button"] },
  };
}

function emitNavigationTelemetry(session) {
  const timestamp = Date.now() / 1_000;
  const requestUrl =
    "https://network-user:network-pass@example.com/api/signed/signed-path-secret/AbCdEf0123456789AbCdEf0123456789?token=network-secret#private";
  send(session, {
    method: "Network.requestWillBeSent",
    sessionId: session.targetSessionId,
    params: {
      requestId: `request-${session.navigationSequence}`,
      timestamp,
      type: "Fetch",
      request: {
        method: "POST",
        url: requestUrl,
        headers: { Authorization: "Bearer header-secret" },
      },
    },
  });
  send(session, {
    method: "Network.responseReceived",
    sessionId: session.targetSessionId,
    params: {
      requestId: `request-${session.navigationSequence}`,
      timestamp: timestamp + 0.01,
      type: "Fetch",
      response: { url: requestUrl, status: 503 },
    },
  });
  send(session, {
    method: "Network.loadingFailed",
    sessionId: session.targetSessionId,
    params: {
      requestId: `request-${session.navigationSequence}`,
      timestamp: timestamp + 0.02,
      type: "Fetch",
      errorText: "Authorization: Bearer network-failure-secret token=network-error-secret",
    },
  });
  send(session, {
    method: "Runtime.exceptionThrown",
    sessionId: session.targetSessionId,
    params: {
      exceptionDetails: {
        text: "Unhandled specialist page error",
        url: "https://example.com/private/error?token=source-secret",
        exception: {
          value:
            "Authorization: Bearer exception-secret {\"cookie\":\"session=json-cookie-secret\",\"authorization\":\"Bearer json-auth-secret\"} token=exception-token-secret",
        },
      },
    },
  });
  send(session, {
    method: "Runtime.consoleAPICalled",
    sessionId: session.targetSessionId,
    params: {
      type: "error",
      args: [{ value: "Console failed token=console-secret" }],
    },
  });
  send(session, {
    method: "Page.frameNavigated",
    sessionId: session.targetSessionId,
    params: { frame: { id: "main-frame", url: session.url } },
  });
  send(session, {
    method: "DOM.documentUpdated",
    sessionId: session.targetSessionId,
    params: {},
  });
}

function handleCommand(session, command) {
  session.commands.push(command);
  if (command.method === "Target.attachToTarget") {
    respond(session, command, { sessionId: session.targetSessionId });
    return;
  }
  if (command.method.endsWith(".enable")) {
    respond(session, command);
    return;
  }
  if (command.method === "Page.getNavigationHistory") {
    respond(session, command, {
      currentIndex: 0,
      entries: [{ id: 1, url: session.url, title: session.title }],
    });
    return;
  }
  if (command.method === "Accessibility.getFullAXTree") {
    respond(session, command, { nodes: axNodes() });
    return;
  }
  if (command.method === "Page.captureScreenshot") {
    respond(session, command, { data: PNG_BASE64 });
    return;
  }
  if (command.method === "Page.getLayoutMetrics") {
    respond(session, command, {
      cssVisualViewport: { clientWidth: 1_200, clientHeight: 800 },
    });
    return;
  }
  if (command.method === "DOM.getNodeForLocation") {
    respond(session, command, { backendNodeId: 102 });
    return;
  }
  if (command.method === "Emulation.setDeviceMetricsOverride") {
    respond(session, command);
    return;
  }
  if (command.method === "Page.navigate") {
    session.navigationSequence += 1;
    session.url = String(command.params.url ?? session.url);
    session.title = "Navigated specialist target";
    respond(session, command, { frameId: "main-frame" });
    emitNavigationTelemetry(session);
    return;
  }
  if (command.method === "Runtime.evaluate") {
    respond(session, command, {
      result: { type: "string", value: "complete" },
    });
    return;
  }
  if (command.method === "DOM.scrollIntoViewIfNeeded") {
    respond(session, command);
    return;
  }
  if (command.method === "DOM.getBoxModel") {
    if (command.params.backendNodeId === 105) {
      send(session, {
        id: command.id,
        sessionId: command.sessionId,
        error: {
          code: -32_000,
          message:
            "Authorization: Bearer cdp-click-secret https://example.com/private/click?token=cdp-query-secret",
        },
      });
      return;
    }
    respond(session, command, {
      model: { content: [10, 20, 110, 20, 110, 60, 10, 60] },
    });
    return;
  }
  if (command.method === "DOM.describeNode") {
    respond(session, command, describedNode(Number(command.params.backendNodeId)));
    return;
  }
  if (command.method === "DOM.resolveNode") {
    respond(session, command, {
      object: {
        objectId: `object-${String(command.params.backendNodeId ?? "unknown")}`,
      },
    });
    return;
  }
  if (command.method === "Runtime.callFunctionOn") {
    const declaration = String(command.params.functionDeclaration ?? "");
    if (declaration.includes("stableAttributes") && declaration.includes("segments.unshift")) {
      respond(session, command, {
        result: {
          type: "string",
          value:
            "html:nth-of-type(1) > body:nth-of-type(1) > button[data-testid=\"submit\"]:nth-of-type(1)",
        },
      });
      return;
    }
    if (declaration.includes("blockedTags") && declaration.includes("escapeAttribute")) {
      respond(session, command, {
        result: {
          type: "object",
          value: {
            html:
              "<button data-testid=\"submit\">Authorization: Bearer selected-html-secret</button>",
            tooLarge: false,
          },
        },
      });
      return;
    }
    respond(session, command);
    return;
  }
  if (command.method === "Runtime.releaseObject") {
    respond(session, command);
    return;
  }
  if (
    command.method === "DOM.focus" ||
    command.method === "Input.dispatchMouseEvent"
  ) {
    respond(session, command);
    return;
  }
  send(session, {
    id: command.id,
    ...(command.sessionId === null ? {} : { sessionId: command.sessionId }),
    error: { code: -32_601, message: `Unhandled test CDP command ${command.method}` },
  });
}

function storedSession(session) {
  return {
    upstreamSessionId: session.upstreamSessionId,
    targetId: session.targetId,
    targetSessionId: session.targetSessionId,
    commands: session.commands,
    navigationSequence: session.navigationSequence,
    url: session.url,
    title: session.title,
  };
}

export class CdpSession extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.session = null;
    ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get("session");
      this.session = stored ? { ...stored, socket: null } : null;
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/reset" && request.method === "POST") {
      for (const socket of this.ctx.getWebSockets()) {
        socket.close(1000, "test reset");
      }
      this.session = null;
      await this.ctx.storage.deleteAll();
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/close" && request.method === "POST") {
      const sockets = this.ctx.getWebSockets();
      for (const socket of sockets) {
        socket.close(1000, "test-requested disconnect");
      }
      return new Response(null, {
        status: this.session === null && sockets.length === 0 ? 404 : 204,
      });
    }
    if (url.pathname === "/state") {
      return Response.json({
        session: this.session === null ? null : storedSession(this.session),
      });
    }
    const match = /\/devtools\/browser\/(upstream-\d+)$/u.exec(url.pathname);
    if (
      request.method === "GET" &&
      request.headers.get("Upgrade")?.toLowerCase() === "websocket" &&
      match?.[1]
    ) {
      if (this.session === null) {
        this.session = initialSession(match[1]);
        await this.ctx.storage.put("session", storedSession(this.session));
      }
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      this.ctx.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response(null, { status: 404 });
  }

  async webSocketMessage(socket, message) {
    if (this.session === null) {
      socket.close(1011, "CDP test session is unavailable");
      return;
    }
    this.session.socket = socket;
    try {
      handleCommand(this.session, parseCommand(message));
      await this.ctx.storage.put("session", storedSession(this.session));
    } finally {
      this.session.socket = null;
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/__test/reset" && request.method === "POST") {
      await Promise.all(
        Array.from({ length: 16 }, (_, index) =>
          env.CDP_SESSIONS.getByName(`upstream-${index + 1}`).fetch(
            "https://cdp.internal/reset",
            { method: "POST" },
          )
        ),
      );
      return env.HTTP_BROWSER_TEST.fetch(request);
    }
    if (url.pathname === "/__test/cdp-commands") {
      const states = await Promise.all(
        Array.from({ length: 16 }, async (_, index) => {
          const response = await env.CDP_SESSIONS
            .getByName(`upstream-${index + 1}`)
            .fetch("https://cdp.internal/state");
          return response.json();
        }),
      );
      return Response.json({
        sessions: states.flatMap(({ session }) => session === null ? [] : [session]),
      });
    }
    if (url.pathname === "/__test/close-cdp" && request.method === "POST") {
      const upstreamSessionId = url.searchParams.get("session") ?? "";
      if (!/^upstream-\d+$/u.test(upstreamSessionId)) {
        return new Response(null, { status: 404 });
      }
      return env.CDP_SESSIONS.getByName(upstreamSessionId).fetch(
        "https://cdp.internal/close",
        { method: "POST" },
      );
    }
    const match = /\/devtools\/browser\/(upstream-\d+)$/u.exec(url.pathname);
    if (
      request.method === "GET" &&
      request.headers.get("Upgrade")?.toLowerCase() === "websocket" &&
      match?.[1]
    ) {
      return env.CDP_SESSIONS.getByName(match[1]).fetch(request);
    }
    return env.HTTP_BROWSER_TEST.fetch(request);
  },
};
