import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  expectExactProvenance,
  hasAuthorizationDecision,
  resetToLobby,
} from "./brainrot-td-test-support";

test("models post-projection authority revocation and remains inert", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, "post-projection-revoked");
  await resetToLobby({ surface, tap });

  const create = surface.getByRole("button", {
    name: "Create game",
    exact: true,
  });
  await expect(create).toBeDisabled();
  await expect(create).toHaveAttribute(
    "title",
    "Brainrot Tower Defense play permission is not granted",
  );
  await expect
    .poll(async () => {
      const ledger = await tap.fixture.ledger.read();
      return {
        play: hasAuthorizationDecision(ledger.entries, {
          kind: "host-action",
          actionId: "brainrot-td.play",
          autonomy: "do",
          allowed: false,
        }),
        storageRead: hasAuthorizationDecision(ledger.entries, {
          kind: "platform",
          action: "tap.platform.storage.get",
          actionId: "storage.read",
          autonomy: "listen",
          allowed: false,
        }),
        presenceWrite: hasAuthorizationDecision(ledger.entries, {
          kind: "platform",
          action: "tap.platform.presence.join",
          actionId: "presence.write",
          autonomy: "do",
          allowed: false,
        }),
      };
    })
    .toEqual({
      play: true,
      storageRead: true,
      presenceWrite: true,
    });

  const ledger = await tap.fixture.ledger.read();
  expect(ledger.dropped).toBe(0);
  expect(
    ledger.entries.some((entry) =>
      [
        "channels.send-message",
        "presence.join",
        "presence.update",
        "storage.get",
        "storage.set",
      ].includes(entry.operation),
    ),
  ).toBe(false);
  expect(
    ledger.entries.some((entry) => entry.kind === "event"),
  ).toBe(false);

  const snapshot = await tap.fixture.snapshot();
  expect(snapshot.state.storage).toEqual([]);
  expect(snapshot.state.presence).toEqual([]);
  expect(
    snapshot.state.channels.find(
      (channel) => channel.roomId === tap.channelId,
    )?.messages,
  ).toEqual([]);
});

test("keeps a post-projection revoked remount inert with stable provenance", async ({
  surface,
  tap,
}) => {
  await resetToLobby({ surface, tap });
  const before = await tap.fixture.snapshot();

  await tap.control.remountSurface();
  await expect(
    surface.getByRole("button", { name: "Create game", exact: true }),
  ).toBeDisabled();
  expectExactProvenance(tap, "post-projection-revoked");

  const after = await tap.fixture.snapshot();
  expect(after.fixtureDigest).toBe(before.fixtureDigest);
  expect(after.state.storage).toEqual([]);
  expect(after.state.presence).toEqual([]);
});
