import {
  expect,
  test,
  type TapMiniappTestFixtureLedger,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  expectExactProvenance,
  hasAuthorizationDecision,
  STORAGE_KEY,
  STORAGE_NAMESPACE,
} from "./pyre-test-support";

function storageWriteDecisionCount(
  entries: TapMiniappTestFixtureLedger["entries"],
): number {
  return entries.filter(
    (entry) =>
      entry.kind === "platform" &&
      entry.operation === "authorization.check" &&
      typeof entry.detail === "object" &&
      entry.detail !== null &&
      !Array.isArray(entry.detail) &&
      Reflect.get(entry.detail, "actionId") === "storage.write",
  ).length;
}

test("denies report approval without changing the persisted draft", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    allowedOrigins: [],
    matrixEntryId: "pyre-desktop-approve-denied",
    permissionScenario: "deny:pyre.approve",
    profileId: "pyre-desktop-approve-denied",
    seed: 6941,
    theme: "dark",
  });
  await surface
    .getByRole("button", { name: "Reports", exact: true })
    .click();
  await surface
    .getByRole("button", { name: "Create Revision", exact: true })
    .click();
  await surface
    .getByRole("button", { name: "Create Draft Revision", exact: true })
    .click();
  await expect(
    surface.getByText(
      "Report revision created from current structured state.",
      { exact: true },
    ),
  ).toBeVisible();
  await surface.getByRole("button", { name: "Done", exact: true }).click();
  const beforeApproval = await tap.fixture.ledger.read();
  await surface
    .getByRole("button", { name: "Dismiss notification", exact: true })
    .click();
  await surface.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(surface.getByRole("alert")).toContainText(
    /does not allow this miniapp to approve investigation decisions/iu,
  );

  const snapshot = await tap.fixture.snapshot();
  const record = snapshot.state.storage.find(
    (entry) =>
      entry.namespace === STORAGE_NAMESPACE && entry.key === STORAGE_KEY,
  );
  const investigations =
    typeof record?.value === "object" &&
    record.value !== null &&
    !Array.isArray(record.value)
      ? Reflect.get(record.value, "investigations")
      : undefined;
  const reports = Array.isArray(investigations)
    ? Reflect.get(investigations[0], "reports")
    : undefined;
  expect({
    reportStatus: Array.isArray(reports)
      ? Reflect.get(reports[0], "status")
      : undefined,
    revision: record?.revision,
  }).toEqual({
    reportStatus: "draft",
    revision: 2,
  });

  const ledger = await tap.fixture.ledger.read();
  expect(
    hasAuthorizationDecision(ledger.entries, {
      actionId: "pyre.investigate",
      allowed: true,
      autonomy: "plan",
      kind: "host-action",
    }),
  ).toBe(true);
  expect(
    hasAuthorizationDecision(ledger.entries, {
      actionId: "pyre.approve",
      allowed: false,
      autonomy: "listen",
      kind: "host-action",
    }),
  ).toBe(true);
  expect(storageWriteDecisionCount(ledger.entries)).toBe(
    storageWriteDecisionCount(beforeApproval.entries),
  );
});
