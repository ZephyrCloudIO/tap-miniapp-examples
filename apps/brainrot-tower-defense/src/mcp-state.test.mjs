import assert from "node:assert/strict";
import test from "node:test";

import {
  brainrotMcpProjectionKey,
  brainrotMcpStorageKeyTemplate,
  brainrotMcpStorageNamespace,
  createGameStateReader,
} from "./mcp-state.mjs";

const CHANNEL_ID = "channel-17";
const CANONICAL_USER_ID = "users-row-42";
const SESSION_ID = "session-29";

function projection(overrides = {}) {
  return {
    projectionSchema: "brainrot-td.mcp.current",
    projectionVersion: 1,
    projectionTruncated: false,
    schemaVersion: 1,
    source: "tap-channel-projection",
    sessionId: SESSION_ID,
    channelId: CHANNEL_ID,
    name: "Friday defense",
    level: 2,
    levelName: "School Hallway Rush",
    wave: 1,
    totalWaves: 5,
    status: "running",
    baseHealth: 90,
    score: 25,
    tick: 12,
    sequence: 3,
    activePlayerCount: 1,
    spectatorCount: 1,
    livePresenceCount: 2,
    defeatedEnemies: 2,
    leakedEnemies: 1,
    pendingEnemyCount: 1,
    totalMemberCount: 2,
    totalDefenderCount: 1,
    totalEnemyCount: 1,
    totalRecentActionCount: 1,
    members: [
      {
        playerId: "player-host",
        displayName: "Host",
        role: "host",
        slot: 0,
        ready: true,
        resources: 50,
        contribution: 10,
      },
      {
        playerId: "player-spectator",
        displayName: "Watcher",
        role: "spectator",
        slot: null,
        ready: false,
        resources: 0,
        contribution: 0,
      },
    ],
    defenders: [
      {
        id: "defender-1",
        ownerId: "player-host",
        kind: "buffer",
        x: 100,
        y: 200,
        level: 1,
        path: "base",
        targetPolicy: "first",
      },
    ],
    enemies: [
      {
        id: "enemy-1",
        kind: "basic",
        path: 0,
        progress: 200,
        health: 9,
        maxHealth: 10,
        slowedTicks: 0,
        armor: 0,
      },
    ],
    recentActions: [{ sequence: 3, actor: "Host", label: "started wave 1" }],
    ...overrides,
  };
}

function readerFixture({
  channelId = CHANNEL_ID,
  userId = CANONICAL_USER_ID,
  omitUserId = false,
  current = projection(),
  unrelatedEntries = 0,
} = {}) {
  const reads = [];
  const values = new Map([
    [brainrotMcpProjectionKey(CANONICAL_USER_ID, CHANNEL_ID), current],
    ...Array.from({ length: unrelatedEntries }, (_, index) => [
      `channels/channel-${index}/sessions/session-${index}`,
      { oversized: "x".repeat(8_192) },
    ]),
  ]);
  const read = createGameStateReader({
    getExecutionContext: () =>
      omitUserId ? { channelId } : { channelId, userId },
    readStorage(address) {
      reads.push(address);
      return {
        value: structuredClone(values.get(address.key) ?? null),
        revision: 4,
      };
    },
  });
  return { read, reads };
}

test("reads only the trusted channel's exact bounded projection", async () => {
  const unrelatedEntries = 300;
  const unrelatedBytes = unrelatedEntries * 8_192;
  const { read, reads } = readerFixture({ unrelatedEntries });
  const result = await read({});

  assert.ok(unrelatedEntries > 256);
  assert.ok(unrelatedBytes > 1_048_576);
  assert.equal(
    brainrotMcpStorageKeyTemplate,
    "mcp/users/{userId}/channels/{channelId}/current",
  );
  assert.deepEqual(reads, [
    {
      namespace: brainrotMcpStorageNamespace,
      key: brainrotMcpProjectionKey(CANONICAL_USER_ID, CHANNEL_ID),
    },
  ]);
  assert.deepEqual(result, {
    schemaVersion: 1,
    source: "tap-channel-projection",
    projectionTruncated: false,
    sessionId: SESSION_ID,
    channelId: CHANNEL_ID,
    name: "Friday defense",
    level: 2,
    levelName: "School Hallway Rush",
    wave: 1,
    totalWaves: 5,
    status: "running",
    baseHealth: 90,
    score: 25,
    tick: 12,
    sequence: 3,
    activePlayerCount: 1,
    spectatorCount: 1,
    livePresenceCount: 2,
    defeatedEnemies: 2,
    leakedEnemies: 1,
    pendingEnemyCount: 1,
    totalMemberCount: 2,
    totalDefenderCount: 1,
    totalEnemyCount: 1,
    totalRecentActionCount: 1,
    members: [
      {
        playerId: "player-host",
        displayName: "Host",
        role: "host",
        slot: 0,
        ready: true,
        resources: 50,
        contribution: 10,
      },
      {
        playerId: "player-spectator",
        displayName: "Watcher",
        role: "spectator",
        slot: null,
        ready: false,
        resources: 0,
        contribution: 0,
      },
    ],
    defenders: [
      {
        id: "defender-1",
        ownerId: "player-host",
        kind: "buffer",
        x: 100,
        y: 200,
        level: 1,
        path: "base",
        targetPolicy: "first",
      },
    ],
    enemies: [
      {
        id: "enemy-1",
        kind: "basic",
        path: 0,
        progress: 200,
        health: 9,
        maxHealth: 10,
        slowedTicks: 0,
        armor: 0,
      },
    ],
    recentActions: [
      { sequence: 3, actor: "Host", label: "started wave 1" },
    ],
  });
});

test("exposes exactly the host package-runtime MCP module ABI", async () => {
  const entry = await import("./mcp.mjs");
  assert.deepEqual(Object.keys(entry), ["mcpServer"]);
  assert.deepEqual(Object.keys(entry.mcpServer.tools), ["get_game_state"]);
});

test("uses sessionId only as a current-session scope assertion", async () => {
  const { read, reads } = readerFixture();
  await assert.rejects(
    read({ sessionId: "session-other" }),
    /does not match its trusted scope/u,
  );
  assert.equal(reads.length, 1);
  await assert.doesNotReject(read({ sessionId: SESSION_ID }));
});

test("fails closed when the trusted execution context has no channel", async () => {
  const { read, reads } = readerFixture({ channelId: null });
  await assert.rejects(read({}), /execution context has no channel/u);
  assert.deepEqual(reads, []);
});

test("fails closed before storage when the trusted execution context has no user", async () => {
  for (const options of [{ userId: null }, { omitUserId: true }]) {
    const { read, reads } = readerFixture(options);
    await assert.rejects(read({}), /execution context has no user/u);
    assert.deepEqual(reads, []);
  }
});

test("isolates the current projection by canonical user and channel", async () => {
  const otherUserId = "users-row-99";
  const { read, reads } = readerFixture({ userId: otherUserId });

  await assert.rejects(read({}), /current channel projection is missing/u);
  assert.deepEqual(reads, [
    {
      namespace: brainrotMcpStorageNamespace,
      key: brainrotMcpProjectionKey(otherUserId, CHANNEL_ID),
    },
  ]);
});

test("fails closed when a projection does not match its trusted channel", async () => {
  const { read } = readerFixture({
    current: projection({ channelId: "channel-other" }),
  });
  await assert.rejects(read({}), /does not match its trusted scope/u);
});

test("rejects malformed and path-shaped identifiers before reading storage", async () => {
  const { read, reads } = readerFixture();
  await assert.rejects(
    read({ sessionId: "../commands" }),
    /requested session identifier is malformed/u,
  );
  assert.deepEqual(reads, []);

  const malformedUser = readerFixture({ userId: "users/escape" });
  await assert.rejects(
    malformedUser.read({}),
    /trusted user identifier is malformed/u,
  );
  assert.deepEqual(malformedUser.reads, []);

  const oversizedCombinedKey = readerFixture({
    userId: "u".repeat(256),
    channelId: "c".repeat(256),
  });
  await assert.rejects(
    oversizedCombinedKey.read({}),
    /projection storage key is out of bounds/u,
  );
  assert.deepEqual(oversizedCombinedKey.reads, []);
});

test("rejects old full snapshots and unknown projection fields", async () => {
  const oldSnapshot = projection();
  delete oldSnapshot.projectionSchema;
  delete oldSnapshot.projectionVersion;
  const oldFixture = readerFixture({ current: oldSnapshot });
  await assert.rejects(oldFixture.read({}), /unsupported shape/u);

  const unknownFixture = readerFixture({
    current: projection({ privateState: "must-not-cross-MCP" }),
  });
  await assert.rejects(unknownFixture.read({}), /unsupported shape/u);
});

test("requires truncation metadata to match represented totals", async () => {
  const truncated = projection({
    projectionTruncated: true,
    totalEnemyCount: 2,
  });
  await assert.doesNotReject(readerFixture({ current: truncated }).read({}));
  await assert.doesNotReject(
    readerFixture({
      current: projection({ projectionTruncated: true }),
    }).read({}),
  );

  const inconsistent = projection({
    projectionTruncated: false,
    totalEnemyCount: 2,
  });
  await assert.rejects(
    readerFixture({ current: inconsistent }).read({}),
    /truncation metadata is inconsistent/u,
  );
});
