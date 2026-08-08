import { sdk } from "@theaiplatform/miniapp-sdk/sdk";
import {
  emptyState,
  isEngineeringChangeState,
  migrateState,
  type EngineeringChangeState,
} from "./domain";

export const STORAGE_NAMESPACE = "engineering-change";
export const STORAGE_KEY = "changes/v1";

const address = { namespace: STORAGE_NAMESPACE, key: STORAGE_KEY } as const;
const previewKey = "tap-example.engineering-change.preview.v1";

export interface LoadedState {
  state: EngineeringChangeState;
  revision: number | null;
}

export class StorageConflictError extends Error {
  constructor() {
    super(
      "This workspace changed in another session. Reload to review the latest revision before saving again.",
    );
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
  return message.includes("revision") || message.includes("conflict")
    ? new StorageConflictError()
    : error;
}

function parse(raw: unknown, source: string): EngineeringChangeState {
  if (raw === null || raw === undefined) return emptyState();
  try {
    const decoded = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!isEngineeringChangeState(decoded)) throw new Error("unsupported or malformed schema");
    return migrateState(decoded);
  } catch (error) {
    throw new StorageDataError(
      `${source} contains invalid Engineering Change data. Restore a valid revision or clear the damaged preview workspace. ${String(error)}`,
    );
  }
}

export async function loadState(preview: boolean): Promise<LoadedState> {
  if (preview) {
    const storage = globalThis.localStorage;
    if (!storage) {
      throw new StorageDataError(
        "Browser preview storage is unavailable. Enable local storage and reload Engineering Change.",
      );
    }
    return {
      state: parse(storage.getItem(previewKey), "Browser preview storage"),
      revision: null,
    };
  }
  const current = await sdk.storage.get(address);
  return {
    state: parse(current.value, "TAP storage"),
    revision: current.value === null ? null : current.revision,
  };
}

export async function saveState(
  state: EngineeringChangeState,
  revision: number | null,
  preview: boolean,
): Promise<number | null> {
  if (preview) {
    const storage = globalThis.localStorage;
    if (!storage) {
      throw new StorageDataError(
        "Browser preview storage is unavailable. Enable local storage and retry.",
      );
    }
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
