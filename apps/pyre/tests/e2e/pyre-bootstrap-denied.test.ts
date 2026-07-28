import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  expectExactProvenance,
  expectMatchingAlert,
  hasAuthorizationDecision,
  openPlatform,
} from "./pyre-test-support";

test("keeps the platform usable when workflow discovery is denied", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    matrixEntryId: "pyre-desktop-bootstrap-denied",
    permissionScenario: "deny:workflows.list",
    profileId: "pyre-desktop-bootstrap-denied",
    seed: 6932,
    theme: "dark",
  });
  await openPlatform(surface);
  await expect(surface.getByText("Limited", { exact: true }).first())
    .toBeVisible();
  await expectMatchingAlert(
    surface,
    /Some optional TAP capabilities are unavailable.*Workflow discovery is unavailable/iu,
  );
  await expect(
    surface.getByText("No Saved Workflows Available", { exact: true }),
  ).toBeVisible();

  const ledger = await tap.fixture.ledger.read();
  expect(
    hasAuthorizationDecision(ledger.entries, {
      actionId: "workflows.list",
      allowed: false,
      kind: "host-action",
    }),
  ).toBe(true);
  expect(
    ledger.entries.some(
      (entry) =>
        entry.kind === "host-action" &&
        entry.operation === "workflows.list",
    ),
  ).toBe(false);
});
