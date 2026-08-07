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

test("denies finding disposition before durable side effects", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    allowedOrigins: [],
    matrixEntryId: "engineering-change-desktop-disposition-denied",
    permissionScenario: "deny:findings.disposition",
    profileId: "engineering-change-desktop-disposition-denied",
    seed: 7113,
    theme: "dark",
  });
  await surface.getByRole("button", { name: "Review", exact: true }).click();
  await surface
    .getByTestId("engineering-change-review-rationale")
    .fill("Denied disposition attempt");
  await surface
    .getByTestId("engineering-change-review-disposition-finding-seed-1")
    .click();
  await expectMatchingAlert(
    surface,
    /does not allow this miniapp to disposition review findings/iu,
  );

  const { changes, revision } = await readStoredChanges(tap);
  const change = changes[0] as {
    findings: Array<{ disposition: unknown }>;
  };
  expect(change.findings[0]?.disposition).toBeNull();
  expect(revision).toBe(1);

  const ledger = await tap.fixture.ledger.read();
  expect(
    hasAuthorizationDecision(ledger.entries, {
      actionId: "findings.disposition",
      allowed: false,
      autonomy: "do",
      kind: "host-action",
    }),
  ).toBe(true);
  expect(hasAnyAuthorizationDecision(ledger.entries, "storage.write")).toBe(
    false,
  );
});
