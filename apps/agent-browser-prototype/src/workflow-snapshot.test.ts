import { describe, expect, it, rs } from "@rstest/core";
import {
  cancelSavedBrowserSnapshotRun,
  hasWorkflowRunsV1,
  normalizeWorkflowBrowserSnapshot,
  readWorkflowRunArtifact,
  runSavedBrowserSnapshot,
  type SavedWorkflowsApi,
  type WorkflowRunProjection,
} from "./workflow-snapshot";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function bytesFromBase64(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(globalThis.atob(value), (character) =>
    character.charCodeAt(0));
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(
    await globalThis.crypto.subtle.digest("SHA-256", bytes),
  );
  return [...digest]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function completedRun(
  overrides: Partial<WorkflowRunProjection> = {},
): WorkflowRunProjection {
  return {
    runId: "run-browser-1",
    workflowId: "workflow-browser-1",
    status: "completed",
    lane: "unknown",
    createdAt: "2026-08-06T16:00:00.000Z",
    startedAt: "2026-08-06T16:00:00.000Z",
    finishedAt: "2026-08-06T16:00:01.000Z",
    error: null,
    hasDeclaredInput: true,
    hasFinalOutput: true,
    hasFinalState: false,
    ...overrides,
  };
}

describe("saved browser workflow lifecycle", () => {
  it("feature-detects the complete workflows.runs.v1 contract", () => {
    const workflows: SavedWorkflowsApi = {
      list: async () => ({ workflows: [] }),
      invokeSaved: async () => ({
        success: true,
        status: "started",
        message: "accepted",
        runId: "run-browser-1",
      }),
      runs: {
        v1: {
          get: async () => completedRun(),
          wait: async () => completedRun(),
          cancel: async () => completedRun({ status: "cancelled" }),
          output: async () => null,
        },
      },
    };

    expect(hasWorkflowRunsV1(workflows)).toBe(true);
    expect(
      hasWorkflowRunsV1({
        ...workflows,
        runs: { v1: { ...workflows.runs!.v1!, cancel: undefined as never } },
      }),
    ).toBe(false);
  });

  it("invokes the selected workflow with portable node inputs, waits, and normalizes its output", async () => {
    const invokeSaved = rs.fn(async () => ({
      success: true,
      status: "started",
      message: "accepted",
      runId: "run-browser-1",
    }));
    const wait = rs.fn(async () => completedRun());
    const output = rs.fn(async () => ({
      nodeOutputs: {
        "capture-page": {
          outcome: "done",
          outputs: {
            url: "https://example.com/docs",
            finalUrl: "https://example.com/docs/",
            engine: "kitesurf",
            formats: ["screenshot", "markdown", "accessibilityTree"],
            status: 200,
            title: "Example docs",
            markdown: "# Example docs",
            content: "<h1>Example docs</h1>",
            accessibilityTree: { role: "RootWebArea", name: "Example docs" },
            browserMs: 41,
            durationMs: 87,
            artifacts: [
              {
                kind: "screenshot",
                artifactRef: `sha256:${"a".repeat(64)}`,
                mediaType: "image/png",
                byteLength: 4,
                sha256: "a".repeat(64),
              },
            ],
          },
        },
      },
    }));
    const onRunStarted = rs.fn();
    const workflows: SavedWorkflowsApi = {
      list: async () => ({ workflows: [] }),
      invokeSaved,
      runs: {
        v1: {
          get: async () => completedRun(),
          wait,
          cancel: async () => completedRun({ status: "cancelled" }),
          output,
        },
      },
    };

    const snapshot = await runSavedBrowserSnapshot(
      {
        workflowId: "workflow-browser-1",
        url: "https://example.com/docs",
        formats: ["screenshot", "markdown", "accessibilityTree"],
        waitUntil: "domcontentloaded",
        timeoutMs: 30_000,
        waitTimeoutMs: 90_000,
        onRunStarted,
      },
      workflows,
    );

    expect(invokeSaved).toHaveBeenCalledWith({
      workflowId: "workflow-browser-1",
      payload: {
        url: "https://example.com/docs",
        engine: "kitesurf",
        formats: ["screenshot", "markdown", "accessibilityTree"],
        waitUntil: "domcontentloaded",
        timeoutMs: 30_000,
      },
    });
    expect(onRunStarted).toHaveBeenCalledWith("run-browser-1");
    expect(wait).toHaveBeenCalledWith({
      runId: "run-browser-1",
      timeoutMs: 30_000,
    });
    expect(output).toHaveBeenCalledWith({
      runId: "run-browser-1",
      kind: "final-output",
    });
    expect(snapshot).toMatchObject({
      workflowRunId: "run-browser-1",
      requestedUrl: "https://example.com/docs",
      finalUrl: "https://example.com/docs/",
      formats: ["screenshot", "markdown", "accessibilityTree"],
      engine: "kitesurf",
      title: "Example docs",
      browserMs: 41,
      runDurationMs: 87,
      markdown: "# Example docs",
      screenshotArtifact: {
        artifactRef: `sha256:${"a".repeat(64)}`,
        mediaType: "image/png",
      },
    });
  });

  it("rejects outputs that do not expose universal.browser.snapshot evidence", () => {
    expect(() =>
      normalizeWorkflowBrowserSnapshot(
        { nodeOutputs: { unrelated: { answer: 42 } } },
        {
          runId: "run-browser-1",
          requestedUrl: "https://example.com",
          requestedFormats: ["markdown", "content"],
        },
      ),
    ).toThrow(/universal\.browser\.snapshot/u);
  });

  it("rejects workflow output from an engine other than Kitesurf", () => {
    expect(() =>
      normalizeWorkflowBrowserSnapshot(
        {
          url: "https://example.com/",
          engine: "chromium",
          formats: ["markdown", "content"],
          markdown: "# Example",
          content: "<h1>Example</h1>",
        },
        {
          runId: "run-browser-1",
          requestedUrl: "https://example.com/",
          requestedFormats: ["markdown", "content"],
        },
      ),
    ).toThrow(/returned chromium; kitesurf was required/u);
  });

  it("preserves empty requested text evidence as an actual returned value", () => {
    for (const [format, value] of [
      ["markdown", { markdown: "" }],
      ["content", { content: "" }],
    ] as const) {
      expect(
        normalizeWorkflowBrowserSnapshot(
          {
            url: "https://example.com/",
            engine: "kitesurf",
            formats: [format],
            ...value,
          },
          {
            runId: "run-browser-1",
            requestedUrl: "https://example.com/",
            requestedFormats: [format],
          },
        )[format],
      ).toBe("");
    }
  });

  it("preserves an explicitly empty page title", () => {
    const snapshot = normalizeWorkflowBrowserSnapshot(
      {
        url: "https://example.com/",
        engine: "kitesurf",
        formats: ["markdown"],
        title: "",
        markdown: "# Example",
      },
      {
        runId: "run-browser-1",
        requestedUrl: "https://example.com/",
        requestedFormats: ["markdown"],
      },
    );

    expect(snapshot.title).toBe("");
  });

  it("rejects a non-object accessibility tree", () => {
    expect(() =>
      normalizeWorkflowBrowserSnapshot(
        {
          url: "https://example.com/",
          engine: "kitesurf",
          formats: ["accessibilityTree"],
          accessibilityTree: "not a tree",
        },
        {
          runId: "run-browser-1",
          requestedUrl: "https://example.com/",
          requestedFormats: ["accessibilityTree"],
        },
      ),
    ).toThrow(/omitted requested accessibilityTree evidence/u);
  });

  it("rejects malformed optional status and timing metadata", () => {
    for (const [field, value, message] of [
      ["status", "200", /invalid page status/u],
      ["browserMs", -1, /invalid browser time/u],
      ["durationMs", "87", /invalid workflow run time/u],
    ] as const) {
      expect(() =>
        normalizeWorkflowBrowserSnapshot(
          {
            url: "https://example.com/",
            engine: "kitesurf",
            formats: ["markdown"],
            markdown: "# Example",
            [field]: value,
          },
          {
            runId: "run-browser-1",
            requestedUrl: "https://example.com/",
            requestedFormats: ["markdown"],
          },
        ),
      ).toThrow(message);
    }
  });

  it("rejects a credential-bearing final URL", () => {
    expect(() =>
      normalizeWorkflowBrowserSnapshot(
        {
          url: "https://example.com/",
          finalUrl: "https://user:secret@example.com/account",
          engine: "kitesurf",
          formats: ["markdown"],
          markdown: "# Account",
        },
        {
          runId: "run-browser-1",
          requestedUrl: "https://example.com/",
          requestedFormats: ["markdown"],
        },
      ),
    ).toThrow(/invalid final URL/u);
  });

  it("rejects invalid or extra evidence formats without filtering them", () => {
    expect(() =>
      normalizeWorkflowBrowserSnapshot(
        {
          url: "https://example.com/",
          engine: "kitesurf",
          formats: ["markdown", "content", "invented-evidence"],
          markdown: "# Example",
          content: "<h1>Example</h1>",
        },
        {
          runId: "run-browser-1",
          requestedUrl: "https://example.com/",
          requestedFormats: ["markdown", "content"],
        },
      ),
    ).toThrow(/invalid evidence formats/u);
  });

  it("rejects every malformed artifact instead of discarding it", () => {
    expect(() =>
      normalizeWorkflowBrowserSnapshot(
        {
          url: "https://example.com/",
          engine: "kitesurf",
          formats: ["markdown", "content"],
          markdown: "# Example",
          content: "<h1>Example</h1>",
          artifacts: [{ kind: "screenshot", artifactRef: "not-content-addressed" }],
        },
        {
          runId: "run-browser-1",
          requestedUrl: "https://example.com/",
          requestedFormats: ["markdown", "content"],
        },
      ),
    ).toThrow(/invalid browser evidence artifact/u);
  });

  it("rejects an oversized inline screenshot before display", () => {
    const oversized = `iVBORw0KGgoA${"A".repeat(13_981_008)}`;
    expect(() =>
      normalizeWorkflowBrowserSnapshot(
        {
          url: "https://example.com/",
          engine: "kitesurf",
          formats: ["screenshot", "markdown"],
          screenshot: oversized,
          markdown: "# Example",
        },
        {
          runId: "run-browser-1",
          requestedUrl: "https://example.com/",
          requestedFormats: ["screenshot", "markdown"],
        },
      ),
    ).toThrow(/10 MiB inline screenshot limit/u);
  });

  it("polls active runs in host-bounded slices until a terminal output is available", async () => {
    const wait = rs
      .fn()
      .mockResolvedValueOnce(
        completedRun({
          status: "running",
          finishedAt: null,
          hasFinalOutput: true,
        }),
      )
      .mockResolvedValueOnce(completedRun());
    const output = rs.fn(async () => ({
      arbitraryNodeId: {
        outcome: "done",
        outputs: {
          url: "https://example.com",
          engine: "kitesurf",
          formats: ["markdown", "content"],
          markdown: "# Example",
          content: "<h1>Example</h1>",
          artifacts: [],
        },
      },
    }));
    const workflows: SavedWorkflowsApi = {
      list: async () => ({ workflows: [] }),
      invokeSaved: async () => ({
        success: true,
        status: "started",
        message: "accepted",
        runId: "run-browser-1",
      }),
      runs: {
        v1: {
          get: async () => completedRun(),
          wait,
          cancel: async () => completedRun({ status: "cancelled" }),
          output,
        },
      },
    };

    await expect(
      runSavedBrowserSnapshot(
        {
          workflowId: "workflow-browser-1",
          url: "https://example.com",
          formats: ["markdown", "content"],
          waitUntil: "load",
          timeoutMs: 30_000,
          waitTimeoutMs: 60_000,
        },
        workflows,
      ),
    ).resolves.toMatchObject({ title: null, markdown: "# Example" });
    expect(wait).toHaveBeenCalledTimes(2);
    expect(output).toHaveBeenCalledTimes(1);
    for (const [options] of wait.mock.calls) {
      expect(options.timeoutMs).toBeLessThanOrEqual(30_000);
    }
  });

  it("delegates cancellation to the call-bound workflow run action", async () => {
    const cancel = rs.fn(async () => completedRun({ status: "cancelled" }));
    const workflows: SavedWorkflowsApi = {
      list: async () => ({ workflows: [] }),
      invokeSaved: async () => ({
        success: true,
        status: "started",
        message: "accepted",
        runId: "run-browser-1",
      }),
      runs: {
        v1: {
          get: async () => completedRun(),
          wait: async () => completedRun(),
          cancel,
          output: async () => null,
        },
      },
    };

    await expect(
      cancelSavedBrowserSnapshotRun("run-browser-1", workflows),
    ).resolves.toMatchObject({ status: "cancelled" });
    expect(cancel).toHaveBeenCalledWith({ runId: "run-browser-1" });
  });

  it("surfaces a denied call-bound cancellation without mutating the run", async () => {
    const workflows: SavedWorkflowsApi = {
      list: async () => ({ workflows: [] }),
      invokeSaved: async () => ({
        success: true,
        status: "started",
        message: "accepted",
        runId: "run-browser-1",
      }),
      runs: {
        v1: {
          get: async () => completedRun({ status: "running" }),
          wait: async () => completedRun({ status: "running" }),
          cancel: async () => {
            throw new Error("The workflow cancellation requires a fresh host decision.");
          },
          output: async () => null,
        },
      },
    };

    await expect(
      cancelSavedBrowserSnapshotRun("run-browser-1", workflows),
    ).rejects.toThrow(/fresh host decision/u);
  });

  it("streams a bounded workflow-owned artifact and closes the reader", async () => {
    const pngBytes = bytesFromBase64(PNG_BASE64);
    const sha256 = await sha256Hex(pngBytes);
    const close = rs.fn(async () => undefined);
    const openArtifact = rs.fn(async () => ({
      descriptor: {
        artifactRef: `sha256:${sha256}`,
        mediaType: "image/png",
        sizeBytes: pngBytes.byteLength,
        sha256,
      },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(pngBytes);
          controller.close();
        },
      }),
      close,
    }));
    const workflows: SavedWorkflowsApi = {
      list: async () => ({ workflows: [] }),
      invokeSaved: async () => ({
        success: true,
        status: "started",
        message: "accepted",
        runId: "run-browser-1",
      }),
      runs: {
        v1: {
          get: async () => completedRun(),
          wait: async () => completedRun(),
          cancel: async () => completedRun(),
          output: async () => null,
          openArtifact,
        },
      },
    };

    const dataUrl = await readWorkflowRunArtifact(
      "run-browser-1",
      {
        kind: "screenshot",
        artifactRef: `sha256:${sha256}`,
        mediaType: "image/png",
        byteLength: pngBytes.byteLength,
        sha256,
      },
      workflows,
    );

    expect(openArtifact).toHaveBeenCalledWith({
      runId: "run-browser-1",
      artifactRef: `sha256:${sha256}`,
    });
    expect(dataUrl).toBe(`data:image/png;base64,${PNG_BASE64}`);
    expect(dataUrl).not.toMatch(/^blob:/u);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("rejects streamed artifact bytes that do not match the declared digest", async () => {
    const pngBytes = bytesFromBase64(PNG_BASE64);
    const declaredSha256 = "b".repeat(64);
    const close = rs.fn(async () => undefined);
    const workflows: SavedWorkflowsApi = {
      list: async () => ({ workflows: [] }),
      invokeSaved: async () => ({
        success: true,
        status: "started",
        message: "accepted",
        runId: "run-browser-1",
      }),
      runs: {
        v1: {
          get: async () => completedRun(),
          wait: async () => completedRun(),
          cancel: async () => completedRun(),
          output: async () => null,
          openArtifact: async () => ({
            descriptor: {
              artifactRef: `sha256:${declaredSha256}`,
              mediaType: "image/png",
              sizeBytes: pngBytes.byteLength,
              sha256: declaredSha256,
            },
            body: new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(pngBytes);
                controller.close();
              },
            }),
            close,
          }),
        },
      },
    };

    await expect(
      readWorkflowRunArtifact(
        "run-browser-1",
        {
          kind: "screenshot",
          artifactRef: `sha256:${declaredSha256}`,
          mediaType: "image/png",
          byteLength: pngBytes.byteLength,
          sha256: declaredSha256,
        },
        workflows,
      ),
    ).rejects.toThrow(/SHA-256 verification/u);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
