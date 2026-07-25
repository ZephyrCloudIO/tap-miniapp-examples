import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  expectExactProvenance,
  hasAuthorizationDecision,
  hasOperation,
} from "./unofficial-suno-player-test-support";

test("does not read storage after channel membership authority is denied", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    matrixEntryId: "unofficial-suno-player-desktop-channel-read-denied",
    permissionScenario: "deny:channels.read",
    profileId: "unofficial-suno-player-desktop-channel-read-denied",
    seed: 6933,
    theme: "dark",
  });
  await expect(
    surface.getByText("Soundtrack unavailable", { exact: true }),
  ).toBeVisible();

  const ledger = await tap.fixture.ledger.read();
  expect(
    hasAuthorizationDecision(ledger.entries, {
      actionId: "channels.read",
      allowed: false,
      kind: "host-action",
    }),
  ).toBe(true);
  expect(hasOperation(ledger.entries, "host-action", "channels.get-access"))
    .toBe(false);
  expect(hasOperation(ledger.entries, "platform", "storage.get")).toBe(false);
});
