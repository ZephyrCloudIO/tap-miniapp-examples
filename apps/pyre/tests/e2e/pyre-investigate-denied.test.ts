import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  expectExactProvenance,
  hasAnyAuthorizationDecision,
  hasAuthorizationDecision,
  STORAGE_KEY,
  STORAGE_NAMESPACE,
} from "./pyre-test-support";

test("denies investigation mutation before durable or host side effects", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    allowedOrigins: [],
    matrixEntryId: "pyre-desktop-investigate-denied",
    permissionScenario: "deny:pyre.investigate",
    profileId: "pyre-desktop-investigate-denied",
    seed: 6940,
    theme: "dark",
  });
  await surface
    .getByRole("button", { name: "Evidence", exact: true })
    .click();
  await surface
    .getByRole("button", { name: "Add Evidence", exact: true })
    .click();
  await surface.getByLabel("Evidence title").fill("Denied fixture reference");
  await surface
    .getByLabel("Source URL or stable locator")
    .fill("https://status.example.com/incidents/denied-reference");
  await surface
    .getByLabel("Description")
    .fill("This reference must never reach durable investigation state.");
  await surface
    .getByRole("button", { name: "Save Reference", exact: true })
    .click();
  await surface.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(surface.getByRole("alert")).toContainText(
    /does not allow this miniapp to investigate incidents/iu,
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
  const evidence = Array.isArray(investigations)
    ? Reflect.get(investigations[0], "evidence")
    : undefined;
  expect({
    evidenceCount: Array.isArray(evidence) ? evidence.length : 0,
    revision: record?.revision,
  }).toEqual({
    evidenceCount: 1,
    revision: 1,
  });

  const ledger = await tap.fixture.ledger.read();
  expect(
    hasAuthorizationDecision(ledger.entries, {
      actionId: "pyre.investigate",
      allowed: false,
      autonomy: "plan",
      kind: "host-action",
    }),
  ).toBe(true);
  expect(hasAnyAuthorizationDecision(ledger.entries, "storage.write")).toBe(
    false,
  );
  expect(hasAnyAuthorizationDecision(ledger.entries, "vfs.write")).toBe(false);
});
