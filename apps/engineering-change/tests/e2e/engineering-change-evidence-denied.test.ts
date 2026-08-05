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

test("denies evidence capture before durable or network side effects", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    allowedOrigins: [],
    matrixEntryId: "engineering-change-desktop-evidence-denied",
    permissionScenario: "deny:evidence.capture",
    profileId: "engineering-change-desktop-evidence-denied",
    seed: 7115,
    theme: "dark",
  });
  await surface.getByRole("button", { name: "Evidence", exact: true }).click();
  await surface
    .getByTestId("engineering-change-evidence-symbols")
    .fill("denied_symbol");
  await surface
    .getByTestId("engineering-change-evidence-record-hypothesis")
    .click();
  await expectMatchingAlert(
    surface,
    /does not allow this miniapp to capture change evidence/iu,
  );

  const { changes, revision } = await readStoredChanges(tap);
  const change = changes[0] as { impactHypothesis: unknown; impactEvidence: unknown };
  expect(change.impactHypothesis).toBeNull();
  expect(change.impactEvidence).toBeNull();
  expect(revision).toBe(1);
  expect((await tap.fixture.http.requests()).requests).toEqual([]);

  const ledger = await tap.fixture.ledger.read();
  expect(
    hasAuthorizationDecision(ledger.entries, {
      actionId: "evidence.capture",
      allowed: false,
      autonomy: "plan",
      kind: "host-action",
    }),
  ).toBe(true);
  expect(hasAnyAuthorizationDecision(ledger.entries, "storage.write")).toBe(
    false,
  );
});
