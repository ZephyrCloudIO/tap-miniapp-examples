import { sdk } from "@theaiplatform/miniapp-sdk/sdk";
import type { FamilyState } from "./domain";

const address = { namespace: "family-task-board", key: "household/main" } as const;
const previewKey = "tap-example.family-task-board.v2";

const isFamilyState = (value: unknown): value is FamilyState => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.schemaVersion === 2 &&
    typeof record.familyName === "string" &&
    Array.isArray(record.members) &&
    Array.isArray(record.tasks) &&
    Array.isArray(record.ledger) &&
    Array.isArray(record.shop)
  );
};

export const loadFamilyState = async (preview: boolean): Promise<FamilyState | null> => {
  if (!preview) {
    const stored = await sdk.storage.get(address);
    return isFamilyState(stored.value) ? stored.value : null;
  }
  const raw = globalThis.localStorage?.getItem(previewKey);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isFamilyState(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const saveFamilyState = async (value: FamilyState, preview: boolean): Promise<void> => {
  if (!preview) {
    const current = await sdk.storage.get(address);
    const storageValue = JSON.parse(JSON.stringify(value));
    await sdk.storage.set({
      ...address,
      expectedRevision: current.revision,
      value: storageValue,
    });
    return;
  }
  globalThis.localStorage?.setItem(previewKey, JSON.stringify(value));
};
