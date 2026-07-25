import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  channelStorageRecord,
  expectExactProvenance,
  hasAuthorizationDecision,
  hasOperation,
  openSettings,
  preferenceStorageRecords,
} from "./unofficial-suno-player-test-support";

test("does not persist listening preferences when storage writes are denied", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    matrixEntryId: "unofficial-suno-player-desktop-storage-denied",
    permissionScenario: "deny:storage.write",
    profileId: "unofficial-suno-player-desktop-storage-denied",
    seed: 6931,
    theme: "dark",
  });

  await openSettings(surface);
  await surface
    .getByRole("checkbox", {
      name: /Broadcast my listening or paused state/u,
    })
    .click();
  await expect(
    surface.getByText("Operation failed", { exact: true }),
  ).toBeVisible();

  await expect
    .poll(async () => {
      const ledger = await tap.fixture.ledger.read();
      return hasAuthorizationDecision(ledger.entries, {
        actionId: "storage.write",
        allowed: false,
        kind: "platform",
      });
    })
    .toBe(true);

  const snapshot = await tap.fixture.snapshot();
  const ledger = await tap.fixture.ledger.read();
  expect(hasOperation(ledger.entries, "platform", "storage.set")).toBe(false);
  expect(channelStorageRecord(snapshot)?.revision).toBe(1);
  expect(preferenceStorageRecords(snapshot)).toEqual([]);
});
