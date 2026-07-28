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

test("reports denied credential discovery while preserving public HTTP readiness", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    matrixEntryId: "pyre-desktop-credentials-denied",
    permissionScenario: "deny:credentials.read",
    profileId: "pyre-desktop-credentials-denied",
    seed: 6939,
    theme: "dark",
    allowedOrigins: [],
  });
  await openPlatform(surface);
  await expectMatchingAlert(
    surface,
    /Credential discovery is unavailable.*not grant this platform action/iu,
  );
  await expect(
    surface.getByRole("button", { name: "Collect Evidence", exact: true }),
  ).toBeEnabled();

  const ledger = await tap.fixture.ledger.read();
  expect(
    hasAuthorizationDecision(ledger.entries, {
      actionId: "credentials.read",
      allowed: false,
      kind: "platform",
    }),
  ).toBe(true);
  expect(
    ledger.entries.some(
      (entry) =>
        entry.kind === "platform" &&
        entry.operation === "credentials.list-http",
    ),
  ).toBe(false);
});
