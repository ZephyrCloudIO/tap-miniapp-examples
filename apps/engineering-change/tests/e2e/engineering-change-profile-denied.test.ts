import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  expectExactProvenance,
  expectReadySurface,
  hasAuthorizationDecision,
} from "./engineering-change-test-support";

test("keeps the actor fallback when the profile read is denied", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    allowedOrigins: [],
    matrixEntryId: "engineering-change-desktop-profile-denied",
    permissionScenario: "deny:profile.read",
    profileId: "engineering-change-desktop-profile-denied",
    seed: 7116,
    theme: "dark",
  });
  await expectReadySurface(surface);
  await expect(
    surface.getByTestId("engineering-change-overview-actor"),
  ).toContainText("Signed in as workspace member");

  const ledger = await tap.fixture.ledger.read();
  expect(
    hasAuthorizationDecision(ledger.entries, {
      actionId: "profile.read",
      allowed: false,
      autonomy: "listen",
      kind: "host-action",
    }),
  ).toBe(true);
});
