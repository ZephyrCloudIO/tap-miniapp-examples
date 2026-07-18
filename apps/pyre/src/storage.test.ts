import { afterEach, describe, expect, it } from "@rstest/core";
import { emptyState } from "./domain";
import { loadState, mapStorageWriteError, saveState, StorageConflictError, StorageDataError } from "./storage";

const installStorage = (initial: Record<string, string> = {}, failWrites = false) => {
  const records = new Map(Object.entries(initial));
  const storage = {
    getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (failWrites) throw new Error("quota exceeded");
      records.set(key, value);
    },
    removeItem: (key: string) => records.delete(key),
    clear: () => records.clear(),
    key: (index: number) => [...records.keys()][index] ?? null,
    get length() { return records.size; },
  } satisfies Storage;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  return records;
};

afterEach(() => {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: undefined });
});

describe("Pyre storage", () => {
  it("serializes and reloads preview state", async () => {
    installStorage();
    const state = emptyState();
    await saveState(state, null, true);
    expect((await loadState(true)).state).toEqual(state);
  });

  it("surfaces malformed persisted data instead of replacing it with an empty workspace", async () => {
    installStorage({ "tap-example.pyre.preview.v2": "{not-json" });
    await expect(loadState(true)).rejects.toBeInstanceOf(StorageDataError);
  });

  it("surfaces preview write failures", async () => {
    installStorage({}, true);
    await expect(saveState(emptyState(), null, true)).rejects.toThrow(/quota exceeded/);
  });

  it("maps revision failures to an actionable conflict", () => {
    expect(mapStorageWriteError(new Error("expected revision conflict"))).toBeInstanceOf(StorageConflictError);
    const networkFailure = new Error("network unavailable");
    expect(mapStorageWriteError(networkFailure)).toBe(networkFailure);
  });
});
