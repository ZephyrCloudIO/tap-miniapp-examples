import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  expectExactProvenance,
  expectReadySurface,
  hasAuthorizationDecision,
} from "./pyre-test-support";

test("keeps a denied presence join out of the fixture realm while storage still hydrates", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    matrixEntryId: "pyre-desktop-presence-denied",
    permissionScenario: "deny:presence.write",
    profileId: "pyre-desktop-presence-denied",
    seed: 6931,
    theme: "dark",
  });
  await expectReadySurface(surface);
  await expect(surface.getByRole("alert")).toContainText(
    /TAP platform connection is limited.*not grant this platform action/iu,
  );

  const ledger = await tap.fixture.ledger.read();
  expect(
    hasAuthorizationDecision(ledger.entries, {
      actionId: "presence.write",
      allowed: false,
      kind: "platform",
    }),
  ).toBe(true);
  expect(
    ledger.entries.some(
      (entry) =>
        entry.kind === "platform" && entry.operation === "presence.join",
    ),
  ).toBe(false);
  expect((await tap.fixture.snapshot()).state.presence[0]?.participants)
    .toHaveLength(2);
});
