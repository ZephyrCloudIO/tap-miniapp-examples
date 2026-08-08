import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  expectExactProvenance,
  expectMatchingAlert,
  hasAuthorizationDecision,
} from "./engineering-change-test-support";

test("fails closed when runtime authority is revoked after surface projection", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    allowedOrigins: [],
    matrixEntryId: "engineering-change-desktop-all-denied",
    permissionScenario: "all-denied",
    profileId: "engineering-change-desktop-all-denied",
    seed: 7102,
    theme: "dark",
  });
  await expectMatchingAlert(
    surface,
    /Engineering Change could not load this workspace/iu,
  );

  const ledger = await tap.fixture.ledger.read();
  expect(
    hasAuthorizationDecision(ledger.entries, {
      actionId: "storage.read",
      allowed: false,
      kind: "platform",
    }),
  ).toBe(true);
  expect(
    ledger.entries.some(
      (entry) =>
        entry.kind === "platform" && entry.operation === "storage.get",
    ),
  ).toBe(false);
  expect((await tap.fixture.http.requests()).requests).toEqual([]);
});
