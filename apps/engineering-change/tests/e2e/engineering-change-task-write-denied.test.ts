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

test("denies TAP task creation before recording the disposition", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    allowedOrigins: [],
    matrixEntryId: "engineering-change-desktop-task-write-denied",
    permissionScenario: "deny:task.write",
    profileId: "engineering-change-desktop-task-write-denied",
    seed: 7122,
    theme: "dark",
  });
  await surface.getByRole("button", { name: "Review", exact: true }).click();
  await surface
    .getByTestId("engineering-change-review-disposition-action")
    .selectOption("task");
  await surface
    .getByTestId("engineering-change-review-rationale")
    .fill("Task creation must be granted independently.");
  await surface
    .getByTestId("engineering-change-review-disposition-finding-seed-1")
    .click();
  await expectMatchingAlert(
    surface,
    /does not allow this miniapp to create follow-up tasks/iu,
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
      allowed: true,
      autonomy: "do",
      kind: "host-action",
    }),
  ).toBe(true);
  expect(
    hasAuthorizationDecision(ledger.entries, {
      actionId: "task.write",
      allowed: false,
      autonomy: "do",
      kind: "host-action",
    }),
  ).toBe(true);
  expect(hasAnyAuthorizationDecision(ledger.entries, "storage.write")).toBe(
    false,
  );
});
