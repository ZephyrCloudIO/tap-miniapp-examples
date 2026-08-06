import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRaceStateReader } from "./mcp-state.mjs";

const USER = "user-1";
const CHANNEL = "channel-1";
const KEY = `mcp/users/${USER}/channels/${CHANNEL}/current`;

function fixtureProjection(overrides = {}) {
  return {
    projectionSchema: "kart-royale.mcp.current",
    projectionVersion: 1,
    schemaVersion: 1,
    source: "tap-channel-projection",
    projectionTruncated: false,
    raceId: "race-9",
    channelId: CHANNEL,
    phase: "running",
    members: [
      { userId: "u-a", displayName: "Alpha", role: "player", slot: 0, ready: true, connected: true },
      { userId: "u-b", displayName: "Bravo", role: "spectator", slot: null, ready: false, connected: true },
    ],
    standings: [
      { slot: 0, displayName: "Alpha", lap: 2, place: 1, finished: false },
    ],
    totalMemberCount: 2,
    updatedAtMs: 1751822400000,
    ...overrides,
  };
}

function readerWith(value) {
  return createRaceStateReader({
    readStorage: async (address) => {
      assert.equal(address.namespace, "kart-royale");
      assert.equal(address.key, KEY);
      return { value, revision: 7 };
    },
    getExecutionContext: async () => ({ userId: USER, channelId: CHANNEL }),
  });
}

describe("race-state MCP reader", () => {
  it("returns the validated projection for the trusted context", async () => {
    const out = await readerWith(fixtureProjection())({});
    assert.equal(out.phase, "running");
    assert.equal(out.raceId, "race-9");
    assert.equal(out.members.length, 2);
    assert.equal(out.members[0].displayName, "Alpha");
    assert.equal(out.standings[0].place, 1);
    assert.equal(out.totalMemberCount, 2);
  });

  it("returns an idle projection when nothing is stored", async () => {
    const out = await readerWith(null)({});
    assert.equal(out.phase, "idle");
    assert.equal(out.raceId, null);
    assert.deepEqual(out.members, []);
  });

  it("fails closed on an unknown projection schema", async () => {
    await assert.rejects(
      () => readerWith({ projectionSchema: "something-else" })({}),
      /unknown schema/,
    );
  });

  it("returns the stale idle shape when the asserted raceId differs", async () => {
    const out = await readerWith(fixtureProjection())({ raceId: "race-other" });
    assert.equal(out.phase, "idle");
    assert.equal(out.raceId, null);
    assert.equal(out.staleFor, "race-other");
  });

  it("truncates oversized member and standing lists deterministically", async () => {
    const members = Array.from({ length: 24 }, (_, i) => ({
      userId: `u-${i}`, displayName: `P${i}`, role: "player", slot: i % 8, ready: true, connected: true,
    }));
    const out = await readerWith(fixtureProjection({ members, totalMemberCount: 24 }))({});
    assert.equal(out.members.length, 16);
    assert.equal(out.members[0].userId, "u-0");
    assert.equal(out.projectionTruncated, true);
    assert.equal(out.totalMemberCount, 24);
  });

  it("rejects path-shaped or control identities from the context", async () => {
    const reader = createRaceStateReader({
      readStorage: async () => ({ value: fixtureProjection(), revision: 1 }),
      getExecutionContext: async () => ({ userId: "../escape", channelId: CHANNEL }),
    });
    await assert.rejects(() => reader({}), /must not contain control or path characters/);
  });

  it("drops malformed members and normalizes roles without throwing", async () => {
    const out = await readerWith(
      fixtureProjection({
        members: [
          { userId: "u-a", displayName: "Alpha", role: "player", slot: 0, ready: true, connected: true },
          { userId: 42, displayName: "Broken" },
          { userId: "u-c", displayName: "Cy", role: "admin", slot: 1, ready: false, connected: true },
        ],
      }),
    )({});
    assert.equal(out.members.length, 2);
    assert.equal(out.members[1].role, "spectator");
  });
});
