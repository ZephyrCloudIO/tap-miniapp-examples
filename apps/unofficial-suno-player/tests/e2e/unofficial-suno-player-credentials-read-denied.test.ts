import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  expectExactProvenance,
  hasAuthorizationDecision,
  hasOperation,
  openSettings,
} from "./unofficial-suno-player-test-support";

test("reports credential discovery as unavailable without leaking metadata", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    matrixEntryId: "unofficial-suno-player-desktop-credentials-read-denied",
    permissionScenario: "deny:credentials.read",
    profileId: "unofficial-suno-player-desktop-credentials-read-denied",
    seed: 6940,
    theme: "dark",
  });
  await openSettings(surface);
  await expect(
    surface.getByText("Credential discovery failed", { exact: true }),
  ).toBeVisible();
  await expect(
    surface.getByText(
      "This target does not expose HTTP credential discovery.",
      { exact: true },
    ),
  ).toBeVisible();

  await expect
    .poll(async () => {
      const ledger = await tap.fixture.ledger.read();
      return hasAuthorizationDecision(ledger.entries, {
        actionId: "credentials.read",
        allowed: false,
        kind: "platform",
      });
    })
    .toBe(true);
  const ledger = await tap.fixture.ledger.read();
  expect(
    hasAuthorizationDecision(ledger.entries, {
      actionId: "credentials.read",
      allowed: false,
      kind: "platform",
    }),
  ).toBe(true);
  expect(hasOperation(ledger.entries, "native", "credentials.list"))
    .toBe(false);
});
