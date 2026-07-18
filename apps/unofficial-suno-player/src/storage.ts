import { sdk } from "@theaiplatform/miniapp-sdk/sdk";
import type { MiniAppJsonValue, MiniAppStorageApi } from "@theaiplatform/miniapp-sdk/sdk";
import {
  parseChannelState,
  parsePlayerPreferences,
  type ChannelState,
  type PlayerPreferences,
} from "./domain";

export class StorageConflictError extends Error {
  constructor() {
    super("This soundtrack changed in another surface. Reload the current TAP state before retrying your change.");
    this.name = "StorageConflictError";
  }
}

export class StoredDataError extends Error {
  constructor(kind: "channel" | "preferences") {
    super(`Stored ${kind} data is invalid or from an unsupported future schema. No data was overwritten.`);
    this.name = "StoredDataError";
  }
}

export interface StorageAddress {
  namespace: string;
  key: string;
}

export interface StorageEntry {
  value: MiniAppJsonValue | null;
  revision: number | null;
}

export interface StorageMutationResult {
  revision: number;
}

export interface StoragePort {
  get(address: StorageAddress): Promise<StorageEntry>;
  set(options: StorageAddress & { value: MiniAppJsonValue; expectedRevision: number | null }): Promise<StorageMutationResult>;
  delete(options: StorageAddress & { expectedRevision: number }): Promise<void>;
}

export interface LoadedValue<T> {
  value: T | null;
  revision: number | null;
}

const namespace = "unofficial-suno-player";
const channelAddress = (channelId: string): StorageAddress => ({ namespace, key: `channel/${channelId}/state` });
const preferencesAddress = (userKey: string, channelId: string): StorageAddress => ({ namespace, key: `user/${userKey}/channel/${channelId}/preferences` });

const cloneJson = <T>(value: T): MiniAppJsonValue => JSON.parse(JSON.stringify(value)) as MiniAppJsonValue;

const isConflict = (error: unknown): boolean =>
  error instanceof StorageConflictError
  || (error instanceof Error && /revision|conflict|expected/i.test(error.message));

export const createSdkStoragePort = (): StoragePort => {
  const storage: MiniAppStorageApi = sdk.storage;
  return {
    async get(address) {
      return await storage.get(address);
    },
    async set(options) {
      return await storage.set(options);
    },
    async delete(options) {
      await storage.delete(options);
    },
  };
};

interface PreviewEnvelope {
  revision: number;
  value: MiniAppJsonValue;
}

const previewPrefix = "tap-preview.unofficial-suno-player.v2.";
const previewKey = (address: StorageAddress): string => `${previewPrefix}${encodeURIComponent(address.namespace)}.${encodeURIComponent(address.key)}`;

const isPreviewEnvelope = (value: unknown): value is PreviewEnvelope => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<PreviewEnvelope>;
  return Number.isInteger(candidate.revision) && Number(candidate.revision) >= 1 && Object.hasOwn(candidate, "value");
};

export const createPreviewStoragePort = (storage: Storage = window.localStorage): StoragePort => ({
  async get(address) {
    const raw = storage.getItem(previewKey(address));
    if (raw === null) return { value: null, revision: null };
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new StoredDataError(address.key.includes("preferences") ? "preferences" : "channel");
    }
    if (!isPreviewEnvelope(parsed)) throw new StoredDataError(address.key.includes("preferences") ? "preferences" : "channel");
    return { value: parsed.value, revision: parsed.revision };
  },
  async set(options) {
    const key = previewKey(options);
    const currentRaw = storage.getItem(key);
    let current: PreviewEnvelope | null = null;
    if (currentRaw !== null) {
      try {
        const parsed = JSON.parse(currentRaw) as unknown;
        if (!isPreviewEnvelope(parsed)) throw new Error("invalid preview envelope");
        current = parsed;
      } catch {
        throw new StoredDataError(options.key.includes("preferences") ? "preferences" : "channel");
      }
    }
    const actualRevision = current?.revision ?? null;
    if (actualRevision !== options.expectedRevision) throw new StorageConflictError();
    const revision = (actualRevision ?? 0) + 1;
    storage.setItem(key, JSON.stringify({ revision, value: options.value } satisfies PreviewEnvelope));
    return { revision };
  },
  async delete(options) {
    const key = previewKey(options);
    const raw = storage.getItem(key);
    if (raw === null) throw new StorageConflictError();
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!isPreviewEnvelope(parsed) || parsed.revision !== options.expectedRevision) throw new StorageConflictError();
    } catch (error) {
      if (error instanceof StorageConflictError) throw error;
      throw new StoredDataError(options.key.includes("preferences") ? "preferences" : "channel");
    }
    storage.removeItem(key);
  },
});

export const loadChannelState = async (port: StoragePort, channelId: string): Promise<LoadedValue<ChannelState>> => {
  const entry = await port.get(channelAddress(channelId));
  if (entry.value === null) return { value: null, revision: entry.revision };
  const value = parseChannelState(entry.value);
  if (!value || value.channelId !== channelId) throw new StoredDataError("channel");
  return { value, revision: entry.revision };
};

export const saveChannelState = async (port: StoragePort, state: ChannelState, expectedRevision: number | null): Promise<number> => {
  const validated = parseChannelState(cloneJson(state));
  if (!validated) throw new StoredDataError("channel");
  try {
    const result = await port.set({ ...channelAddress(state.channelId), expectedRevision, value: cloneJson(validated) });
    return result.revision;
  } catch (error) {
    if (isConflict(error)) throw new StorageConflictError();
    throw error;
  }
};

export const loadPlayerPreferences = async (port: StoragePort, userKey: string, channelId: string): Promise<LoadedValue<PlayerPreferences>> => {
  const entry = await port.get(preferencesAddress(userKey, channelId));
  if (entry.value === null) return { value: null, revision: entry.revision };
  const value = parsePlayerPreferences(entry.value);
  if (!value || value.userKey !== userKey || value.channelId !== channelId) throw new StoredDataError("preferences");
  return { value, revision: entry.revision };
};

export const savePlayerPreferences = async (port: StoragePort, preferences: PlayerPreferences, expectedRevision: number | null): Promise<number> => {
  const validated = parsePlayerPreferences(cloneJson(preferences));
  if (!validated) throw new StoredDataError("preferences");
  try {
    const result = await port.set({ ...preferencesAddress(preferences.userKey, preferences.channelId), expectedRevision, value: cloneJson(validated) });
    return result.revision;
  } catch (error) {
    if (isConflict(error)) throw new StorageConflictError();
    throw error;
  }
};

/** Compatibility wrappers for earlier consumers. New code passes an explicit port. */
export const loadState = async (channelId: string, preview: boolean): Promise<LoadedValue<ChannelState>> =>
  loadChannelState(preview ? createPreviewStoragePort() : createSdkStoragePort(), channelId);

export const saveState = async (state: ChannelState, revision: number | null, preview: boolean): Promise<number> =>
  saveChannelState(preview ? createPreviewStoragePort() : createSdkStoragePort(), state, revision);
