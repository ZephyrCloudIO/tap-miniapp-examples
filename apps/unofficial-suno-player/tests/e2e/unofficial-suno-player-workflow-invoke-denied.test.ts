import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  WORKFLOW_ID,
  expectExactProvenance,
  hasAuthorizationDecision,
  hasOperation,
  openContext,
} from "./unofficial-suno-player-test-support";

test("does not record a saved workflow run when invocation is denied", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    matrixEntryId: "unofficial-suno-player-desktop-workflow-invoke-denied",
    permissionScenario: "deny:workflows.invoke",
    profileId: "unofficial-suno-player-desktop-workflow-invoke-denied",
    seed: 6937,
    theme: "dark",
  });
  await openContext(surface);
  await surface.getByLabel("Saved workflow").selectOption(WORKFLOW_ID);
  await surface
    .getByRole("button", {
      name: "Invoke saved workflow",
      exact: true,
    })
    .click();
  await expect(
    surface.getByText(/permission is not granted/iu),
  ).toBeVisible();
  await expect(
    surface.getByText("Workflow accepted by TAP", { exact: true }),
  ).not.toBeVisible();

  const ledger = await tap.fixture.ledger.read();
  expect(
    hasAuthorizationDecision(ledger.entries, {
      actionId: "workflows.list",
      allowed: true,
      kind: "host-action",
    }),
  ).toBe(true);
  expect(
    hasAuthorizationDecision(ledger.entries, {
      actionId: "workflows.invoke",
      allowed: false,
      kind: "host-action",
    }),
  ).toBe(true);
  expect(hasOperation(ledger.entries, "host-action", "workflows.invoke"))
    .toBe(false);
  expect((await tap.fixture.snapshot()).state.workflows).toHaveLength(1);
});
