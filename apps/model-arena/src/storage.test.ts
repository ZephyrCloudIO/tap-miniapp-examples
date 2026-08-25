import { afterEach, beforeEach, describe, expect, it } from "@rstest/core";
import {
  ComparisonMode,
  SessionState,
  type ModelComparisonSession,
} from "./domain";
import { loadSessions, saveSession } from "./storage";

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();
  failWrites = false;

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error("quota exceeded");
    this.values.set(key, value);
  }
}

function session(id: string, prompt = "prompt"): ModelComparisonSession {
  return {
    id,
    state: SessionState.Completed,
    createdAt: "2026-08-25T00:00:00.000Z",
    creator: "user-a",
    mode: ComparisonMode.OneShot,
    prompt,
    systemPrompt: undefined,
    parameters: {
      temperature: undefined,
      maxTokens: undefined,
      topP: undefined,
      providerSort: undefined,
      zdr: undefined,
    },
    models: [],
    results: [],
    reworkRounds: 0,
    critiquePrompt: undefined,
    pipelineRoles: undefined,
    pipelineCombination: undefined,
    linkedMessages: undefined,
    tags: undefined,
    parentSessionId: undefined,
  };
}

let originalStorage: PropertyDescriptor | undefined;
let storage: MemoryStorage;

beforeEach(() => {
  originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  storage = new MemoryStorage();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
});

afterEach(() => {
  if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
});

describe("bounded local session ledger", () => {
  it("keeps workspace and user ledgers isolated", () => {
    expect(saveSession(session("A"), "workspace-a", "user-a").persisted).toBe(true);
    expect(saveSession(session("B"), "workspace-b", "user-a").persisted).toBe(true);
    expect(saveSession(session("C"), "workspace-a", "user-b").persisted).toBe(true);

    expect(loadSessions("workspace-a", "user-a").map((entry) => entry.id)).toEqual(["A"]);
    expect(loadSessions("workspace-b", "user-a").map((entry) => entry.id)).toEqual(["B"]);
    expect(loadSessions("workspace-a", "user-b").map((entry) => entry.id)).toEqual(["C"]);
  });

  it("returns a quota result instead of throwing", () => {
    storage.failWrites = true;
    expect(saveSession(session("A"), "workspace-a", "user-a")).toMatchObject({
      persisted: false,
      failure: "quota",
    });
  });

  it("does not attempt to persist a single oversized session", () => {
    const result = saveSession(
      session("A", "x".repeat(3_600_000)),
      "workspace-a",
      "user-a",
    );
    expect(result.persisted).toBe(false);
    expect(result.failure).toBe("session-too-large");
    expect(storage.length).toBe(0);
  });
});
