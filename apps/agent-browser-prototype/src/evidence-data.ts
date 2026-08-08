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
  if (
    formats.has("screenshot") &&
    (snapshot.screenshotDataUrl !== null || hasScreenshotArtifact(snapshot))
  ) {
    channels.push(VISUAL);
  }
  if (formats.has("markdown") && snapshot.markdown !== null) {
    channels.push(MARKDOWN);
  }
  if (formats.has("accessibilityTree") && snapshot.accessibilityTree !== null) {
    channels.push(ACCESSIBILITY);
  }
  if (formats.has("content") && snapshot.content !== null) {
    channels.push(CONTENT);
  }
  return channels;
}
