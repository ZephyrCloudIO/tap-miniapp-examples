import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  expectMatchingAlert,
  hasAuthorizationDecision,
  openPlatform,
  seedUnprovisioned,
} from "./pyre-test-support";

test("does not create downstream collaboration state when project creation is denied", async ({
  surface,
  tap,
}) => {
  const baseline = await seedUnprovisioned(tap);
  await openPlatform(surface);
  await surface
    .getByRole("button", { name: "Provision Workspace", exact: true })
    .click();
  await expectMatchingAlert(
    surface,
    /Workspace provisioning failed.*permission is not granted/iu,
  );

  const snapshot = await tap.fixture.snapshot();
  expect(snapshot.state.projects).toEqual(baseline.projects);
  expect(snapshot.state.channels).toEqual(baseline.channels);
  const ledger = await tap.fixture.ledger.read();
  expect(
    hasAuthorizationDecision(ledger.entries, {
      actionId: "projects.create",
      allowed: false,
      kind: "host-action",
    }),
  ).toBe(true);
  expect(
    ledger.entries.some(
      (entry) =>
        entry.kind === "host-action" &&
        ["projects.create", "channels.create"].includes(entry.operation),
    ),
  ).toBe(false);
});
