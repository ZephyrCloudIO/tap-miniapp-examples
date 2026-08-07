import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  expectExactProvenance,
  expectMatchingAlert,
  hasAuthorizationDecision,
  hasAnyAuthorizationDecision,
} from "./engineering-change-test-support";

test("denies assurance policy writes before durable side effects", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    allowedOrigins: [],
    matrixEntryId: "engineering-change-desktop-policies-denied",
    permissionScenario: "deny:policies.manage",
    profileId: "engineering-change-desktop-policies-denied",
    seed: 7114,
    theme: "dark",
  });
  await surface.getByRole("button", { name: "Policies", exact: true }).click();
  await surface.getByTestId("engineering-change-policies-add").click();
  await surface.getByTestId("engineering-change-policies-save").click();
  await expectMatchingAlert(
    surface,
    /does not allow this miniapp to manage assurance policies/iu,
  );

  const snapshot = await tap.fixture.snapshot();
  const record = snapshot.state.storage.find(
    (entry) =>
      entry.namespace === "engineering-change" && entry.key === "changes/v1",
  );
  const policies =
    typeof record?.value === "object" && record.value !== null && !Array.isArray(record.value)
      ? (Reflect.get(record.value, "policies") as Array<{ revision: number }>)
      : [];
  expect(policies).toHaveLength(1);
  expect(policies[0]?.revision).toBe(1);

  const ledger = await tap.fixture.ledger.read();
  expect(
    hasAuthorizationDecision(ledger.entries, {
      actionId: "policies.manage",
      allowed: false,
      autonomy: "do",
      kind: "host-action",
    }),
  ).toBe(true);
  expect(hasAnyAuthorizationDecision(ledger.entries, "storage.write")).toBe(
    false,
  );
});
