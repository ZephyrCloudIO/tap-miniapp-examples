import { sdk } from "@theaiplatform/miniapp-sdk/sdk";
import { emptyState, isPyreState, migrateState, type PyreState } from "./domain";

const address = { namespace: "pyre", key: "investigations/v2" } as const;
const legacyAddress = { namespace: "pyre", key: "investigations/v1" } as const;
const previewKey = "tap-example.pyre.preview.v2";
const previewLegacyKey = "tap-example.pyre.preview.v1";

export interface LoadedState {
  state: PyreState;
  revision: number | null;
}

export class StorageConflictError extends Error {
  constructor() {
    super("This workspace changed in another session. Reload to review the latest revision before saving again.");
    this.name = "StorageConflictError";
  }
}

export class StorageDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageDataError";
  }
}

export function mapStorageWriteError(error: unknown): unknown {
  const message = String(error).toLowerCase();
  return message.includes("revision") || message.includes("conflict") ? new StorageConflictError() : error;
}

function parse(raw: unknown, source: string): PyreState {
  if (raw === null || raw === undefined) return emptyState();
  try {
    const decoded = typeof raw === "string" ? JSON.parse(raw) : raw;
    const schemaVersion = decoded && typeof decoded === "object" ? (decoded as { schemaVersion?: unknown }).schemaVersion : undefined;
    if (!isPyreState(decoded) && schemaVersion !== 1) throw new Error("unsupported or malformed schema");
    return migrateState(decoded);
  } catch (error) {
    throw new StorageDataError(`${source} contains invalid Pyre data. Restore a valid revision or clear the damaged preview workspace. ${String(error)}`);
  }
}

export async function loadState(preview: boolean): Promise<LoadedState> {
  if (preview) {
    const storage = globalThis.localStorage;
    if (!storage) throw new StorageDataError("Browser preview storage is unavailable. Enable local storage and reload Pyre.");
    const current = storage.getItem(previewKey);
    if (current) return { state: parse(current, "Browser preview storage"), revision: null };
    const legacy = storage.getItem(previewLegacyKey);
    return { state: parse(legacy, "Legacy browser preview storage"), revision: null };
  }
  const current = await sdk.storage.get(address);
  if (current.value !== null) return { state: parse(current.value, "TAP storage"), revision: current.revision };
  const legacy = await sdk.storage.get(legacyAddress);
  return { state: parse(legacy.value, "Legacy TAP storage"), revision: null };
}

export async function saveState(state: PyreState, revision: number | null, preview: boolean): Promise<number | null> {
  if (preview) {
    const storage = globalThis.localStorage;
    if (!storage) throw new StorageDataError("Browser preview storage is unavailable. Enable local storage and retry.");
    storage.setItem(previewKey, JSON.stringify(state));
    return revision;
  }
  try {
    const result = await sdk.storage.set({
      ...address,
      expectedRevision: revision,
      value: JSON.parse(JSON.stringify(state)),
    });
    return result.revision;
  } catch (error) {
    throw mapStorageWriteError(error);
  }
}
