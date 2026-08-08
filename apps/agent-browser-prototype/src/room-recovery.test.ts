import { describe, expect, it } from "@rstest/core";
import {
  forgetRemoteBrowserSession,
  MAX_CONSECUTIVE_PARTICIPANT_REJOINS,
  nextParticipantRejoinCycle,
  ParticipantRejoinBudgetExhaustedError,
  recalledRemoteBrowserSession,
  rejoinRemoteBrowserParticipant,
  rememberRemoteBrowserSession,
  remoteBrowserRecoveryStorageKey,
} from "./room-recovery";
import type {
  RemoteBrowserMcpClient,
  RemoteBrowserRoomState,
} from "./remote-browser-mcp";

const SESSION_HANDLE = "019899aa-bbcc-7dde-8eff-001122334455";
const PARTICIPANT_ID = `rp_${"a".repeat(64)}`;

function room(): RemoteBrowserRoomState {
  return {
    sessionHandle: SESSION_HANDLE,
    state: "active",
    documentRevision: 1,
    control: {
      holder: "human",
      participantId: PARTICIPANT_ID,
      epoch: 1,
      expiresAt: null,
    },
    participants: [
      {
        participantId: PARTICIPANT_ID,
        kind: "human",
        principalId: "zack@zephyr-cloud.io",
        consumerKind: "package-contribution",
        status: "connected",
        creator: true,
        self: true,
        joinedAt: "2026-08-07T09:00:00.000Z",
        lastSeenAt: "2026-08-07T09:01:00.000Z",
        disconnectedAt: null,
      },
    ],
  };
}

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
}

describe("Remote Browser room recovery", () => {
  it("recalls one opaque handle for the same host frame and isolates another frame", () => {
    const storage = memoryStorage();
    const handle = "019899aa-bbcc-7dde-8eff-001122334455";
    rememberRemoteBrowserSession("frame-1", handle, storage);
    expect(recalledRemoteBrowserSession("frame-1", storage)).toBe(handle);
    expect(recalledRemoteBrowserSession("frame-2", storage)).toBeNull();
  });

  it("clears explicit leave/end recovery and malformed state", () => {
    const storage = memoryStorage();
    const handle = "019899aa-bbcc-7dde-8eff-001122334455";
    rememberRemoteBrowserSession("frame-1", handle, storage);
    forgetRemoteBrowserSession("frame-1", storage);
    expect(recalledRemoteBrowserSession("frame-1", storage)).toBeNull();

    const key = remoteBrowserRecoveryStorageKey("frame-1");
    expect(key).not.toBeNull();
    storage.setItem(key as string, JSON.stringify({ version: 1, sessionHandle: "forged" }));
    expect(recalledRemoteBrowserSession("frame-1", storage)).toBeNull();
    expect(storage.getItem(key as string)).toBeNull();
  });

  it("rejoins the exact prior participant without an invitation and uses bounded backoff", async () => {
    const calls: unknown[] = [];
    const delays: number[] = [];
    let attempt = 0;
    const client = {
      join: async (input) => {
        calls.push(input);
        attempt += 1;
        if (attempt < 3) throw new Error("temporary transport failure");
        return room();
      },
    } satisfies Pick<RemoteBrowserMcpClient, "join">;

    await expect(
      rejoinRemoteBrowserParticipant(client, SESSION_HANDLE, {
        wait: async (delayMs) => void delays.push(delayMs),
      }),
    ).resolves.toEqual(room());
    expect(calls).toEqual([
      { sessionHandle: SESSION_HANDLE },
      { sessionHandle: SESSION_HANDLE },
      { sessionHandle: SESSION_HANDLE },
    ]);
    expect(delays).toEqual([250, 750]);
  });

  it("fails closed on coded denials and after the consecutive rejoin budget", async () => {
    const coded = Object.assign(new Error("participant no longer belongs here"), {
      code: "participant_not_joined",
    });
    let calls = 0;
    const client = {
      join: async () => {
        calls += 1;
        throw coded;
      },
    } satisfies Pick<RemoteBrowserMcpClient, "join">;

    await expect(
      rejoinRemoteBrowserParticipant(client, SESSION_HANDLE, {
        wait: async () => undefined,
      }),
    ).rejects.toBe(coded);
    expect(calls).toBe(1);

    let cycle = 0;
    for (let index = 0; index < MAX_CONSECUTIVE_PARTICIPANT_REJOINS; index += 1) {
      cycle = nextParticipantRejoinCycle(cycle);
    }
    expect(() => nextParticipantRejoinCycle(cycle)).toThrow(
      ParticipantRejoinBudgetExhaustedError,
    );
  });

  it("cancels rejoin after the mounted session changes", async () => {
    let current = true;
    let calls = 0;
    const client = {
      join: async () => {
        calls += 1;
        current = false;
        throw new Error("transport changed with the mounted session");
      },
    } satisfies Pick<RemoteBrowserMcpClient, "join">;

    await expect(
      rejoinRemoteBrowserParticipant(client, SESSION_HANDLE, {
        isCurrent: () => current,
        wait: async () => undefined,
      }),
    ).resolves.toBeNull();
    expect(calls).toBe(1);
  });
});
