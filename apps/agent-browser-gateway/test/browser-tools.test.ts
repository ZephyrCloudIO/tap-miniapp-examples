import { describe, expect, it } from "vitest";
import {
  backendNodeAtViewportRatio,
  capturePageScreenshot,
  capturePageSnapshot,
  clickElement,
  clickViewport,
  diagnosticFromCdpEvent,
  fillElement,
  networkUpdateFromCdpEvent,
  scrollViewport,
  selectElementRepresentation,
  sanitizedNetworkUrl,
  type BrowserToolCdpClient,
} from "../src/browser-tools";

interface CommandCall {
  readonly method: string;
  readonly params: Readonly<Record<string, unknown>> | undefined;
}

class CommandRecorder implements BrowserToolCdpClient {
  readonly calls: CommandCall[] = [];

  constructor(
    private readonly responses: Readonly<Record<string, unknown>>,
  ) {}

  async send<Result = unknown>(
    method: string,
    params?: Readonly<Record<string, unknown>>,
  ): Promise<Result> {
    this.calls.push({ method, params });
    return this.responses[method] as Result;
  }
}

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe("semantic Remote Browser operations", () => {
  it("turns the live accessibility tree into bounded page state and opaque refs", async () => {
    const cdp = new CommandRecorder({
      "Page.getNavigationHistory": {
        currentIndex: 0,
        entries: [
          {
            id: 1,
            url: "https://example.com/current?private=yes",
            title: "Current page",
          },
        ],
      },
      "Accessibility.getFullAXTree": {
        nodes: [
          {
            backendDOMNodeId: 11,
            role: { value: "heading" },
            name: { value: "Account settings" },
            properties: [],
          },
          {
            backendDOMNodeId: 12,
            role: { value: "button" },
            name: { value: "Save" },
            properties: [
              { name: "focusable", value: { value: true } },
              { name: "focused", value: { value: true } },
            ],
          },
          {
            backendDOMNodeId: 13,
            ignored: true,
            role: { value: "generic" },
          },
        ],
      },
    });
    const registered: number[] = [];

    const snapshot = await capturePageSnapshot(
      cdp,
      7,
      async (candidate, revision) => {
        registered.push(candidate.backendNodeId);
        return `element-${revision}-${candidate.backendNodeId}`;
      },
    );

    expect(snapshot).toEqual({
      url: "https://example.com/current?private=yes",
      title: "Current page",
      documentRevision: 7,
      truncated: false,
      elements: [
        {
          ref: "element-7-11",
          role: "heading",
          name: "Account settings",
          description: null,
          value: null,
          disabled: false,
          focused: false,
        },
        {
          ref: "element-7-12",
          role: "button",
          name: "Save",
          description: null,
          value: null,
          disabled: false,
          focused: true,
        },
      ],
    });
    expect(registered).toEqual([11, 12]);
    expect(cdp.calls.map(({ method }) => method)).toEqual([
      "Page.getNavigationHistory",
      "Accessibility.getFullAXTree",
    ]);
  });

  it("returns an actual bounded PNG screenshot", async () => {
    const cdp = new CommandRecorder({
      "Page.captureScreenshot": { data: PNG_BASE64 },
    });

    await expect(capturePageScreenshot(cdp)).resolves.toEqual({
      mediaType: "image/png",
      base64: PNG_BASE64,
      byteLength: 68,
    });
    expect(cdp.calls).toEqual([
      {
        method: "Page.captureScreenshot",
        params: {
          format: "png",
          fromSurface: true,
          captureBeyondViewport: false,
        },
      },
    ]);
  });

  it("resolves normalized viewport coordinates without accepting an inbound selector", async () => {
    const cdp = new CommandRecorder({
      "Page.getLayoutMetrics": {
        cssVisualViewport: { clientWidth: 1_200, clientHeight: 800 },
      },
      "DOM.getNodeForLocation": { backendNodeId: 91 },
    });

    await expect(backendNodeAtViewportRatio(cdp, 1, 0.25)).resolves.toBe(91);
    expect(cdp.calls).toEqual([
      { method: "Page.getLayoutMetrics", params: undefined },
      {
        method: "DOM.getNodeForLocation",
        params: {
          x: 1_199,
          y: 200,
          includeUserAgentShadowDOM: false,
          ignorePointerEventsNone: false,
        },
      },
    ]);
  });

  it("returns a bounded safe structural selector for an opaque element", async () => {
    const selector =
      "html:nth-of-type(1) > body:nth-of-type(1) > button[data-testid=\"save\"]:nth-of-type(2)";
    const cdp = new CommandRecorder({
      "DOM.resolveNode": { object: { objectId: "element-91" } },
      "Runtime.callFunctionOn": { result: { type: "string", value: selector } },
    });

    await expect(
      selectElementRepresentation(cdp, 91, "selector"),
    ).resolves.toEqual({
      representation: "selector",
      selector,
      html: null,
      mediaType: null,
      base64: null,
      byteLength: null,
    });
    expect(cdp.calls.map(({ method }) => method)).toEqual([
      "DOM.resolveNode",
      "Runtime.callFunctionOn",
      "Runtime.releaseObject",
    ]);
  });

  it("returns sanitized outer HTML with active content and secrets absent", async () => {
    const cdp = new CommandRecorder({
      "DOM.resolveNode": { object: { objectId: "element-92" } },
      "Runtime.callFunctionOn": {
        result: {
          type: "object",
          value: {
            html:
              "<a href=\"https://example.com/path?token=url-secret\">Authorization: Bearer html-secret</a>",
            tooLarge: false,
          },
        },
      },
    });

    const selected = await selectElementRepresentation(cdp, 92, "html");
    expect(selected).toMatchObject({
      representation: "html",
      selector: null,
      mediaType: null,
      byteLength: null,
    });
    expect(selected.html).toBe(
      "<a href=\"https://example.com/path\">Authorization: [REDACTED] [REDACTED]</a>",
    );
    expect(JSON.stringify(selected)).not.toContain("url-secret");
    expect(JSON.stringify(selected)).not.toContain("html-secret");
    const functionDeclaration = cdp.calls.find(
      ({ method }) => method === "Runtime.callFunctionOn",
    )?.params?.functionDeclaration;
    expect(typeof functionDeclaration).toBe("string");
    expect(
      String(functionDeclaration).match(
        /if \(!this \|\| this\.nodeType !== 1 \|\| typeof this\.tagName !== "string"\)/gu,
      ),
    ).toHaveLength(1);
    expect(functionDeclaration).toMatch(
      /^function\(\) \{\n  if \(!this \|\| this\.nodeType !== 1 \|\| typeof this\.tagName !== "string"\) \{\n    return \{ html: null, tooLarge: false \};\n  \}/u,
    );
  });

  it("captures only the selected element bounds as native PNG evidence", async () => {
    const cdp = new CommandRecorder({
      "DOM.getBoxModel": {
        model: { border: [10, 20, 110, 20, 110, 60, 10, 60] },
      },
      "Page.captureScreenshot": { data: PNG_BASE64 },
    });

    await expect(selectElementRepresentation(cdp, 93, "png")).resolves.toEqual({
      representation: "png",
      selector: null,
      html: null,
      mediaType: "image/png",
      base64: PNG_BASE64,
      byteLength: 68,
    });
    expect(cdp.calls).toEqual([
      { method: "DOM.getBoxModel", params: { backendNodeId: 93 } },
      {
        method: "Page.captureScreenshot",
        params: {
          format: "png",
          fromSurface: true,
          captureBeyondViewport: true,
          clip: { x: 10, y: 20, width: 100, height: 40, scale: 1 },
        },
      },
    ]);
  });

  it("drives a click with browser-native pointer events", async () => {
    const cdp = new CommandRecorder({
      "DOM.scrollIntoViewIfNeeded": {},
      "DOM.getBoxModel": {
        model: { content: [10, 20, 30, 20, 30, 40, 10, 40] },
      },
      "Input.dispatchMouseEvent": {},
    });

    await clickElement(cdp, 77);

    expect(cdp.calls).toEqual([
      { method: "DOM.scrollIntoViewIfNeeded", params: { backendNodeId: 77 } },
      { method: "DOM.getBoxModel", params: { backendNodeId: 77 } },
      {
        method: "Input.dispatchMouseEvent",
        params: { type: "mouseMoved", x: 20, y: 30 },
      },
      {
        method: "Input.dispatchMouseEvent",
        params: {
          type: "mousePressed",
          button: "left",
          clickCount: 1,
          x: 20,
          y: 30,
        },
      },
      {
        method: "Input.dispatchMouseEvent",
        params: {
          type: "mouseReleased",
          button: "left",
          clickCount: 1,
          x: 20,
          y: 30,
        },
      },
    ]);
  });

  it("drives an exact viewport click from normalized coordinates", async () => {
    const cdp = new CommandRecorder({
      "Page.getLayoutMetrics": {
        cssVisualViewport: { clientWidth: 1_200, clientHeight: 800 },
      },
      "Input.dispatchMouseEvent": {},
    });

    await clickViewport(cdp, 0.25, 0.75);

    expect(cdp.calls).toEqual([
      { method: "Page.getLayoutMetrics", params: undefined },
      {
        method: "Input.dispatchMouseEvent",
        params: { type: "mouseMoved", x: 300, y: 600 },
      },
      {
        method: "Input.dispatchMouseEvent",
        params: {
          type: "mousePressed",
          button: "left",
          clickCount: 1,
          x: 300,
          y: 600,
        },
      },
      {
        method: "Input.dispatchMouseEvent",
        params: {
          type: "mouseReleased",
          button: "left",
          clickCount: 1,
          x: 300,
          y: 600,
        },
      },
    ]);
  });

  it("dispatches a bounded native wheel gesture at viewport coordinates", async () => {
    const cdp = new CommandRecorder({
      "Page.getLayoutMetrics": {
        cssVisualViewport: { clientWidth: 1_200, clientHeight: 800 },
      },
      "Input.dispatchMouseEvent": {},
    });

    await scrollViewport(cdp, 0.25, 0.75, 12, 480);

    expect(cdp.calls).toEqual([
      { method: "Page.getLayoutMetrics", params: undefined },
      {
        method: "Input.dispatchMouseEvent",
        params: {
          type: "mouseWheel",
          x: 300,
          y: 600,
          deltaX: 12,
          deltaY: 480,
        },
      },
    ]);
    await expect(scrollViewport(cdp, 0.5, 0.5, 0, 0)).rejects.toMatchObject({
      code: "invalid_scroll_delta",
    });
  });

  it("fills an ordinary input through its native setter without echoing the value", async () => {
    const cdp = new CommandRecorder({
      "DOM.describeNode": {
        node: {
          nodeName: "INPUT",
          attributes: ["type", "text", "name", "search"],
        },
      },
      "DOM.resolveNode": { object: { objectId: "resolved-44" } },
      "DOM.focus": {},
      "Runtime.callFunctionOn": { result: { type: "undefined" } },
    });

    await fillElement(cdp, 44, "Cloudflare Kitesurf");

    expect(cdp.calls.map(({ method }) => method)).toEqual([
      "DOM.describeNode",
      "DOM.resolveNode",
      "DOM.focus",
      "Runtime.callFunctionOn",
    ]);
    expect(cdp.calls.at(-1)?.params).toMatchObject({
      objectId: "resolved-44",
      arguments: [
        { value: "Cloudflare Kitesurf" },
        { value: false },
      ],
      userGesture: true,
    });
  });

  it("refuses password and credential-shaped inputs before sending a value", async () => {
    const cdp = new CommandRecorder({
      "DOM.describeNode": {
        node: {
          nodeName: "INPUT",
          attributes: ["type", "password", "name", "password"],
        },
      },
      "DOM.resolveNode": { object: { objectId: "resolved-password" } },
    });

    await expect(fillElement(cdp, 45, "must-not-be-sent")).rejects.toMatchObject({
      code: "credential_input_denied",
      status: 403,
    });
    expect(cdp.calls.map(({ method }) => method)).toEqual([
      "DOM.describeNode",
      "DOM.resolveNode",
    ]);
  });
});

describe("CDP telemetry normalization", () => {
  it("removes credentials, queries, and fragments from network URLs", () => {
    expect(
      sanitizedNetworkUrl(
        "https://user:password@example.com/api/items?token=secret#details",
      ),
    ).toBe("https://example.com/api/items");
  });

  it("normalizes request, response, completion, and failure events", () => {
    expect(
      networkUpdateFromCdpEvent(
        "Network.requestWillBeSent",
        {
          requestId: "request-1",
          type: "Fetch",
          timestamp: 12.5,
          request: {
            method: "POST",
            url: "https://example.com/api?authorization=secret",
          },
        },
        20_000,
      ),
    ).toEqual({
      requestId: "request-1",
      method: "POST",
      url: "https://example.com/api",
      resourceType: "Fetch",
      status: null,
      failed: false,
      errorText: null,
      startedAt: 12_500,
      finishedAt: null,
    });
    expect(
      networkUpdateFromCdpEvent(
        "Network.responseReceived",
        {
          requestId: "request-1",
          type: "Fetch",
          response: { status: 503, url: "https://example.com/api?secret=yes" },
        },
        20_100,
      ),
    ).toMatchObject({ requestId: "request-1", status: 503, url: "https://example.com/api" });
    expect(
      networkUpdateFromCdpEvent(
        "Network.loadingFinished",
        { requestId: "request-1", timestamp: 12.75 },
        20_200,
      ),
    ).toMatchObject({ requestId: "request-1", failed: false, finishedAt: 12_750 });
    expect(
      networkUpdateFromCdpEvent(
        "Network.loadingFailed",
        {
          requestId: "request-2",
          type: "Document",
          timestamp: 13,
          errorText: "net::ERR_NAME_NOT_RESOLVED",
        },
        20_300,
      ),
    ).toMatchObject({
      requestId: "request-2",
      failed: true,
      errorText: "net::ERR_NAME_NOT_RESOLVED",
      finishedAt: 13_000,
    });
  });

  it("turns console, exception, HTTP, and network failures into readable diagnostics", () => {
    expect(
      diagnosticFromCdpEvent(
        "Runtime.consoleAPICalled",
        {
          type: "error",
          args: [{ value: "Uncaught" }, { description: "TypeError: broken" }],
        },
        1,
      ),
    ).toEqual({
      kind: "console",
      severity: "error",
      message: "Uncaught TypeError: broken",
      source: null,
      occurredAt: 1,
    });
    expect(
      diagnosticFromCdpEvent(
        "Runtime.exceptionThrown",
        {
          exceptionDetails: {
            text: "Uncaught",
            url: "https://example.com/app.js",
            exception: { description: "TypeError: broken" },
          },
        },
        2,
      ),
    ).toMatchObject({ kind: "exception", message: "TypeError: broken" });
    expect(
      diagnosticFromCdpEvent(
        "Network.responseReceived",
        {
          requestId: "request-3",
          type: "XHR",
          response: {
            status: 500,
            url: "https://example.com/private?token=secret",
          },
        },
        3,
      ),
    ).toMatchObject({
      kind: "http",
      message: "HTTP 500 from https://example.com/private",
    });
    expect(
      diagnosticFromCdpEvent(
        "Network.loadingFailed",
        { requestId: "request-4", type: "Document", errorText: "blocked" },
        4,
      ),
    ).toMatchObject({ kind: "network", message: "blocked" });
  });
});
