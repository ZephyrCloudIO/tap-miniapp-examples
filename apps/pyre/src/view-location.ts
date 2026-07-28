export const PYRE_VIEW_IDS = [
  "overview",
  "evidence",
  "timeline",
  "analysis",
  "actions",
  "reports",
  "platform",
  "audit",
] as const;

export type PyreView = (typeof PYRE_VIEW_IDS)[number];

export function parsePyreViewHash(hash: string): PyreView {
  const value = new URLSearchParams(
    hash.startsWith("#") ? hash.slice(1) : hash,
  ).get("view");
  return PYRE_VIEW_IDS.includes(value as PyreView)
    ? (value as PyreView)
    : "overview";
}

export function withPyreViewHash(href: string, view: PyreView): string {
  const url = new URL(href);
  const hash = new URLSearchParams(
    url.hash.startsWith("#") ? url.hash.slice(1) : url.hash,
  );
  hash.set("view", view);
  url.hash = hash.toString();
  return url.href;
}
