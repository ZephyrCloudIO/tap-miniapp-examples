import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  expectExactProvenance,
  hasAuthorizationDecision,
  openChangeDetail,
} from "./engineering-change-test-support";

test("keeps the workflow list unavailable state when the list read is denied", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    allowedOrigins: [],
    matrixEntryId: "engineering-change-desktop-workflows-list-denied",
    permissionScenario: "deny:workflows.list",
    profileId: "engineering-change-desktop-workflows-list-denied",
    seed: 7121,
    theme: "dark",
  });
  await openChangeDetail(surface);
  await expect(
    surface.getByTestId("engineering-change-detail-workspace-error"),
  ).toContainText("workflow list is unavailable");
  await expect(
    surface.getByTestId("engineering-change-detail-workflows"),
  ).toContainText("none");

  const ledger = await tap.fixture.ledger.read();
  expect(
    hasAuthorizationDecision(ledger.entries, {
      actionId: "workflows.list",
      allowed: false,
      autonomy: "listen",
      kind: "host-action",
    }),
  ).toBe(true);
});
