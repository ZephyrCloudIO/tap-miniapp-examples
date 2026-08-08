import { describe, expect, it } from "@rstest/core";
import type { BrowserSnapshot } from "./browser-gateway";
import { availableEvidenceChannels } from "./evidence-data";
import type { WorkflowBrowserSnapshot } from "./workflow-snapshot";

function snapshot(
  overrides: Partial<BrowserSnapshot> = {},
): BrowserSnapshot {
  return {
    engine: "kitesurf",
    requestedUrl: "https://example.com/",
    finalUrl: "https://example.com/",
    formats: [],
    title: "Example",
    status: 200,
    browserMs: 12,
    runDurationMs: null,
    screenshotDataUrl: null,
    markdown: null,
    content: null,
    accessibilityTree: null,
    receivedAt: "2026-08-07T00:00:00.000Z",
    ...overrides,
  };
}

describe("available evidence channels", () => {
  it("shows only fields returned by Kitesurf", () => {
    expect(
      availableEvidenceChannels(
        snapshot({
          formats: ["markdown", "accessibilityTree"],
          markdown: "# Example",
          accessibilityTree: { role: "document" },
        }),
      ),
    ).toEqual([
      { id: "markdown", label: "Markdown" },
      { id: "accessibility", label: "Accessibility" },
    ]);
  });

  it("includes actual inline content and screenshots", () => {
    expect(
      availableEvidenceChannels(
        snapshot({
          screenshotDataUrl: "data:image/png;base64,AA==",
          formats: ["screenshot", "markdown", "content"],
          markdown: "# Example",
          content: "<main>Example</main>",
        }),
      ).map(({ id }) => id),
    ).toEqual(["visual", "markdown", "content"]);
  });

  it("exposes a durable screenshot artifact as visual evidence", () => {
    const durable: WorkflowBrowserSnapshot = {
      ...snapshot({ formats: ["screenshot"] }),
      workflowRunId: "run-1",
      screenshotArtifact: {
        kind: "screenshot",
        artifactRef: `sha256:${"a".repeat(64)}`,
        mediaType: "image/png",
        byteLength: 128,
        sha256: "a".repeat(64),
      },
    };
    expect(availableEvidenceChannels(durable)).toEqual([
      { id: "visual", label: "Visual" },
    ]);
  });

  it("has no channels before a real capture returns", () => {
    expect(availableEvidenceChannels(null)).toEqual([]);
    expect(availableEvidenceChannels(snapshot())).toEqual([]);
  });

  it("does not expose undeclared extra fields", () => {
    expect(
      availableEvidenceChannels(
        snapshot({ formats: ["markdown"], markdown: "# Example", content: "extra" }),
      ),
    ).toEqual([{ id: "markdown", label: "Markdown" }]);
  });

  it("exposes declared empty text as actual evidence", () => {
    expect(
      availableEvidenceChannels(
        snapshot({
          formats: ["markdown", "content"],
          markdown: "",
          content: "",
        }),
      ),
    ).toEqual([
      { id: "markdown", label: "Markdown" },
      { id: "content", label: "Content" },
    ]);
  });
});
