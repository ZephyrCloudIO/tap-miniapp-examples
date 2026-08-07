import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  expectExactProvenance,
  expectMatchingAlert,
  hasAuthorizationDecision,
  hasAnyAuthorizationDecision,
  readStoredChanges,
} from "./engineering-change-test-support";

test("denies change creation before durable side effects", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    allowedOrigins: [],
    matrixEntryId: "engineering-change-desktop-propose-denied",
    permissionScenario: "deny:changes.propose",
    profileId: "engineering-change-desktop-propose-denied",
    seed: 7111,
    theme: "dark",
  });
  await surface.getByRole("button", { name: "Ledger", exact: true }).click();
  await surface
    .getByTestId("engineering-change-ledger-new-title")
    .fill("Denied fixture change");
  await surface.getByTestId("engineering-change-ledger-create").click();
  await expectMatchingAlert(
    surface,
    /does not allow this miniapp to shape change proposals/iu,
  );

  const { changes, revision } = await readStoredChanges(tap);
  expect(changes).toHaveLength(1);
  expect(revision).toBe(1);

  const ledger = await tap.fixture.ledger.read();
  expect(
    hasAuthorizationDecision(ledger.entries, {
      actionId: "changes.propose",
      allowed: false,
      autonomy: "plan",
      kind: "host-action",
    }),
  ).toBe(true);
  expect(hasAnyAuthorizationDecision(ledger.entries, "storage.write")).toBe(
    false,
  );
});
