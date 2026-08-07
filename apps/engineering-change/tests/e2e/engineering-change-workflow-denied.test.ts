import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  expectExactProvenance,
  hasAuthorizationDecision,
  openChangeDetail,
} from "./engineering-change-test-support";

test("denies the transition workflow invocation before host side effects", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    allowedOrigins: [],
    matrixEntryId: "engineering-change-desktop-workflow-denied",
    permissionScenario: "deny:workflows.invoke",
    profileId: "engineering-change-desktop-workflow-denied",
    seed: 7120,
    theme: "dark",
  });
  await openChangeDetail(surface);
  await surface.getByTestId("engineering-change-detail-invoke-workflow").click();
  await expect(
    surface.getByTestId("engineering-change-detail-workspace-error"),
  ).toBeVisible();

  const ledger = await tap.fixture.ledger.read();
  expect(
    hasAuthorizationDecision(ledger.entries, {
      actionId: "workflows.invoke",
      allowed: false,
      autonomy: "do",
      kind: "host-action",
    }),
  ).toBe(true);
  expect(
    ledger.entries.some(
      (entry) =>
        entry.kind === "host-action" && entry.operation === "workflows.invoke",
    ),
  ).toBe(false);
});
