import type { BrowserSnapshot } from "./browser-gateway";
import type { WorkflowBrowserSnapshot } from "./workflow-snapshot";

export type EvidenceTab = "visual" | "markdown" | "accessibility" | "content";

export interface EvidenceChannel {
  readonly id: EvidenceTab;
  readonly label: string;
}

const VISUAL = { id: "visual", label: "Visual" } as const;
const MARKDOWN = { id: "markdown", label: "Markdown" } as const;
const ACCESSIBILITY = { id: "accessibility", label: "Accessibility" } as const;
const CONTENT = { id: "content", label: "Content" } as const;

function hasScreenshotArtifact(
  snapshot: BrowserSnapshot,
): snapshot is WorkflowBrowserSnapshot {
  return "screenshotArtifact" in snapshot && snapshot.screenshotArtifact !== null;
}

export function availableEvidenceChannels(
  snapshot: BrowserSnapshot | null,
): readonly EvidenceChannel[] {
  if (!snapshot) return [];

  const channels: EvidenceChannel[] = [];
  const formats = new Set(snapshot.formats);
  const unavailable = new Set(
    "unavailableFormats" in snapshot && Array.isArray(snapshot.unavailableFormats)
      ? snapshot.unavailableFormats
      : [],
  );
  if (
    formats.has("screenshot") &&
    (snapshot.screenshotDataUrl !== null || hasScreenshotArtifact(snapshot))
  ) {
    channels.push(VISUAL);
  }
  if (
    formats.has("markdown") &&
    (snapshot.markdown !== null || unavailable.has("markdown"))
  ) {
    channels.push(MARKDOWN);
  }
  if (
    formats.has("accessibilityTree") &&
    (snapshot.accessibilityTree !== null || unavailable.has("accessibilityTree"))
  ) {
    channels.push(ACCESSIBILITY);
  }
  if (
    formats.has("content") &&
    (snapshot.content !== null || unavailable.has("content"))
  ) {
    channels.push(CONTENT);
  }
  return channels;
}

export function unavailableEvidenceReason(
  snapshot: BrowserSnapshot,
  tab: EvidenceTab,
): string | null {
  if (!("unavailableFormats" in snapshot) || !Array.isArray(snapshot.unavailableFormats)) {
    return null;
  }
  const format =
    tab === "markdown"
      ? "markdown"
      : tab === "accessibility"
        ? "accessibilityTree"
        : tab === "content"
          ? "content"
          : "screenshot";
  if (!snapshot.unavailableFormats.includes(format)) return null;
  const originalByteLength =
    "outputProjectionOriginalByteLength" in snapshot &&
    typeof snapshot.outputProjectionOriginalByteLength === "number"
      ? snapshot.outputProjectionOriginalByteLength
      : null;
  const size = originalByteLength === null
    ? ""
    : ` (${originalByteLength.toLocaleString()} bytes before projection)`;
  return `Not retained inline: the workflow output exceeded the bounded run-history limit${size}. The durable screenshot artifact remains available.`;
}
