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

test("denies review contribution recording before durable side effects", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    allowedOrigins: [],
    matrixEntryId: "engineering-change-desktop-review-denied",
    permissionScenario: "deny:changes.review",
    profileId: "engineering-change-desktop-review-denied",
    seed: 7112,
    theme: "dark",
  });
  await surface.getByRole("button", { name: "Review", exact: true }).click();
  await surface
    .getByTestId("engineering-change-review-evidence-summary")
    .fill("This contribution must never reach durable state.");
  await surface
    .getByTestId("engineering-change-review-add-contribution")
    .click();
  await expectMatchingAlert(
    surface,
    /does not allow this miniapp to coordinate change reviews/iu,
  );

  const { changes, revision } = await readStoredChanges(tap);
  const change = changes[0] as { reviewContributions: unknown[] };
  expect(change.reviewContributions).toHaveLength(0);
  expect(revision).toBe(1);

  const ledger = await tap.fixture.ledger.read();
  expect(
    hasAuthorizationDecision(ledger.entries, {
      actionId: "changes.review",
      allowed: false,
      autonomy: "do",
      kind: "host-action",
    }),
  ).toBe(true);
  expect(hasAnyAuthorizationDecision(ledger.entries, "storage.write")).toBe(
    false,
  );
});
