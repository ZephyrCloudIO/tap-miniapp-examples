import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  configureFixtureWorkflow,
  expectMatchingAlert,
  hasAuthorizationDecision,
  openPlatform,
  STORAGE_KEY,
  STORAGE_NAMESPACE,
} from "./pyre-test-support";

test("does not record a workflow run when invocation is denied", async ({
  surface,
  tap,
}) => {
  await openPlatform(surface);
  await configureFixtureWorkflow(surface);
  await surface
    .getByRole("button", { name: "Invoke Workflow", exact: true })
    .click();
  await expectMatchingAlert(
    surface,
    /Evidence workflow failed.*permission is not granted/iu,
  );

  const snapshot = await tap.fixture.snapshot();
  expect(
    snapshot.state.storage.find(
      (entry) =>
        entry.namespace === STORAGE_NAMESPACE && entry.key === STORAGE_KEY,
    )?.revision,
  ).toBe(1);
  expect(
    hasAuthorizationDecision((await tap.fixture.ledger.read()).entries, {
      actionId: "workflows.invoke",
      allowed: false,
      kind: "host-action",
    }),
  ).toBe(true);
});
