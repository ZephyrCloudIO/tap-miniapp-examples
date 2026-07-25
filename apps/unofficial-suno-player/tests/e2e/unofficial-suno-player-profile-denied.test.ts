import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  expectExactProvenance,
  expectReadySurface,
  hasAuthorizationDecision,
  hasOperation,
} from "./unofficial-suno-player-test-support";

test("falls back to installation-scoped preferences without exposing a denied profile", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    matrixEntryId: "unofficial-suno-player-desktop-profile-denied",
    permissionScenario: "deny:profile.read",
    profileId: "unofficial-suno-player-desktop-profile-denied",
    seed: 6935,
    theme: "dark",
  });
  await expectReadySurface(surface);

  const ledger = await tap.fixture.ledger.read();
  expect(
    hasAuthorizationDecision(ledger.entries, {
      actionId: "profile.read",
      allowed: false,
      kind: "host-action",
    }),
  ).toBe(true);
  expect(
    hasOperation(
      ledger.entries,
      "host-action",
      "platform.auth.get-profile",
    ),
  ).toBe(false);
  expect(
    hasAuthorizationDecision(ledger.entries, {
      actionId: "storage.read",
      allowed: true,
      kind: "platform",
    }),
  ).toBe(true);
});
