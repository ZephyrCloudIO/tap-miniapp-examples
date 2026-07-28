import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  expectExactProvenance,
  expectReadySurface,
  hasAuthorizationDecision,
  hasOperation,
} from "./unofficial-suno-player-test-support";

test("hydrates the mounted channel without exposing denied channel discovery", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    matrixEntryId: "unofficial-suno-player-desktop-channel-list-denied",
    permissionScenario: "deny:channels.list",
    profileId: "unofficial-suno-player-desktop-channel-list-denied",
    seed: 6938,
    theme: "dark",
  });
  await expectReadySurface(surface);
  const channelSwitcher = surface.getByLabel("Channel", { exact: true });
  await expect(channelSwitcher).toHaveValue(tap.channelId);
  expect(await channelSwitcher.locator("option").allTextContents()).toEqual([
    tap.channelId,
  ]);

  await expect
    .poll(async () => {
      const ledger = await tap.fixture.ledger.read();
      return hasAuthorizationDecision(ledger.entries, {
        actionId: "channels.list",
        allowed: false,
        kind: "host-action",
      });
    })
    .toBe(true);
  const ledger = await tap.fixture.ledger.read();
  expect(
    hasAuthorizationDecision(ledger.entries, {
      actionId: "channels.list",
      allowed: false,
      kind: "host-action",
    }),
  ).toBe(true);
  expect(hasOperation(ledger.entries, "host-action", "channels.list"))
    .toBe(false);
  expect(hasOperation(ledger.entries, "host-action", "channels.get-access"))
    .toBe(true);
});
