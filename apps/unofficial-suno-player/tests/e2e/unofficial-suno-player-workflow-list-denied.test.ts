import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  expectExactProvenance,
  hasAuthorizationDecision,
  hasOperation,
  openContext,
} from "./unofficial-suno-player-test-support";

test("keeps saved workflow controls unavailable when discovery is denied", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    matrixEntryId: "unofficial-suno-player-desktop-workflow-list-denied",
    permissionScenario: "deny:workflows.list",
    profileId: "unofficial-suno-player-desktop-workflow-list-denied",
    seed: 6939,
    theme: "dark",
  });
  await openContext(surface);
  await expect(
    surface.getByText(/Saved workflows:.*permission is not granted/iu),
  ).toBeVisible();
  await expect(surface.getByLabel("Saved workflow")).toBeDisabled();
  await expect(
    surface.getByRole("button", {
      name: "Invoke saved workflow",
      exact: true,
    }),
  ).toBeDisabled();

  const ledger = await tap.fixture.ledger.read();
  expect(
    hasAuthorizationDecision(ledger.entries, {
      actionId: "workflows.list",
      allowed: false,
      kind: "host-action",
    }),
  ).toBe(true);
  expect(hasOperation(ledger.entries, "host-action", "workflows.list"))
    .toBe(false);
});
