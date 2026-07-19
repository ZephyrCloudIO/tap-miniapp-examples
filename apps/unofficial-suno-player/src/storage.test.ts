import { describe, expect, it } from "@rstest/core";
import { createDefaultPreferences, createEmptyChannelState } from "./domain";
import {
  StorageConflictError,
  StoredDataError,
  loadChannelState,
  loadPlayerPreferences,
  saveChannelState,
  savePlayerPreferences,
  type StorageAddress,
  type StorageEntry,
  type StorageMutationResult,
  type StoragePort,
} from "./storage";

class RuntimeStorage implements StoragePort {
  readonly entries = new Map<string, StorageEntry>();
  failNextWrite: Error | null = null;

  private key(address: StorageAddress): string {
    return `${address.namespace}/${address.key}`;
  }

  async get(address: StorageAddress): Promise<StorageEntry> {
    return structuredClone(this.entries.get(this.key(address)) ?? { value: null, revision: null });
  }

  async set(options: StorageAddress & { value: StorageEntry["value"]; expectedRevision: number | null }): Promise<StorageMutationResult> {
    if (this.failNextWrite) {
      const error = this.failNextWrite;
      this.failNextWrite = null;
      throw error;
    }
    const key = this.key(options);
    const current = this.entries.get(key) ?? { value: null, revision: null };
    if (current.revision !== options.expectedRevision) throw new Error("expected revision conflict");
    const revision = (current.revision ?? 0) + 1;
    this.entries.set(key, { value: structuredClone(options.value), revision });
    return { revision };
  }

  async delete(options: StorageAddress & { expectedRevision: number }): Promise<void> {
    const key = this.key(options);
    const current = this.entries.get(key);
    if (!current || current.revision !== options.expectedRevision) throw new Error("revision conflict");
    this.entries.delete(key);
  }
}

describe("revisioned storage", () => {
  it("loads an empty initial state and persists channel and user records separately", async () => {
    const storage = new RuntimeStorage();
    const channelId = crypto.randomUUID();
    const userKey = crypto.randomUUID();
    expect(await loadChannelState(storage, channelId)).toEqual({ value: null, revision: null });
    const channel = createEmptyChannelState(channelId);
    const preferences = createDefaultPreferences(userKey, channelId);
    expect(await saveChannelState(storage, channel, null)).toBe(1);
    expect(await savePlayerPreferences(storage, preferences, null)).toBe(1);
    expect((await loadChannelState(storage, channelId)).value).toEqual(channel);
    expect((await loadPlayerPreferences(storage, userKey, channelId)).value).toEqual(preferences);
    expect(storage.entries.size).toBe(2);
  });

  it("surfaces optimistic conflicts without overwriting", async () => {
    const storage = new RuntimeStorage();
    const state = createEmptyChannelState(crypto.randomUUID());
    await saveChannelState(storage, state, null);
    await expect(saveChannelState(storage, { ...state, enabled: true }, null)).rejects.toBeInstanceOf(StorageConflictError);
    expect((await loadChannelState(storage, state.channelId)).value?.enabled).toBe(false);
  });

  it("surfaces platform failures and corrupt stored values", async () => {
    const storage = new RuntimeStorage();
    const state = createEmptyChannelState(crypto.randomUUID());
    storage.failNextWrite = new Error("storage service unavailable");
    await expect(saveChannelState(storage, state, null)).rejects.toThrow("storage service unavailable");
    storage.entries.set(`unofficial-suno-player/channel/${state.channelId}/state`, { value: { schemaVersion: 99 }, revision: 1 });
    await expect(loadChannelState(storage, state.channelId)).rejects.toBeInstanceOf(StoredDataError);
  });
});
