import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  channelStorageRecord,
  expectExactProvenance,
  hasAuthorizationDecision,
  hasOperation,
} from "./unofficial-suno-player-test-support";

test("fails closed when the required view action is revoked after synthetic projection", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    matrixEntryId: "unofficial-suno-player-desktop-post-projection-revoked",
    permissionScenario: "synthetic:post-projection-all-denied",
    profileId: "unofficial-suno-player-desktop-post-projection-revoked",
    seed: 6930,
    theme: "dark",
  });
  await expect(
    surface.getByText("Soundtrack unavailable", { exact: true }),
  ).toBeVisible();

  await expect
    .poll(async () => {
      const ledger = await tap.fixture.ledger.read();
      return {
        surfaceView: hasAuthorizationDecision(ledger.entries, {
          actionId: "suno-player.view",
          allowed: false,
          kind: "host-action",
        }),
      };
    })
    .toEqual({
      surfaceView: true,
    });

  const ledger = await tap.fixture.ledger.read();
  expect(ledger.dropped).toBe(0);
  expect(hasOperation(ledger.entries, "host-action", "channels.list"))
    .toBe(false);
  expect(hasOperation(ledger.entries, "host-action", "channels.get-access"))
    .toBe(false);
  expect(
    hasOperation(
      ledger.entries,
      "host-action",
      "platform.auth.get-profile",
    ),
  ).toBe(false);
  expect(hasOperation(ledger.entries, "platform", "storage.get")).toBe(false);
  expect(hasOperation(ledger.entries, "platform", "presence.join")).toBe(false);

  const snapshot = await tap.fixture.snapshot();
  expect(channelStorageRecord(snapshot)?.revision).toBe(1);
  expect(snapshot.state.channels[0]?.messages).toHaveLength(2);
});
