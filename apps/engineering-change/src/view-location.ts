export const ENGINEERING_CHANGE_VIEW_IDS = [
  "overview",
  "ledger",
  "change-detail",
  "proposal",
  "evidence",
  "review",
  "policies",
] as const;

export type EngineeringChangeView = (typeof ENGINEERING_CHANGE_VIEW_IDS)[number];

export function parseEngineeringChangeViewHash(hash: string): EngineeringChangeView {
  const value = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash).get(
    "view",
  );
  return ENGINEERING_CHANGE_VIEW_IDS.includes(value as EngineeringChangeView)
    ? (value as EngineeringChangeView)
    : "overview";
}

export function withEngineeringChangeViewHash(
  href: string,
  view: EngineeringChangeView,
): string {
  const url = new URL(href);
  const hash = new URLSearchParams(
    url.hash.startsWith("#") ? url.hash.slice(1) : url.hash,
  );
  hash.set("view", view);
  url.hash = hash.toString();
  return url.href;
}
