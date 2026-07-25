import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  PACKAGE_ID,
  STORAGE_KEY,
  STORAGE_NAMESPACE,
  expectExactProvenance,
  hasHostAuthorizationDecision,
} from "./family-task-board-test-support";

test("hydrates the deterministic household through the declared storage effect", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    matrixEntryId: "family-task-board-desktop-positive",
    permissionScenario: "default",
    profileId: "family-task-board-desktop",
    seed: 6929,
    theme: "light",
  });

  await expect(
    surface.getByRole("heading", { level: 1, name: "Good afternoon, Alex" }),
  ).toBeVisible();
  await expect(
    surface.getByText("Friday, July 24", { exact: true }),
  ).toBeVisible();
  await expect(
    surface.getByText("Fold the laundry", { exact: true }),
  ).toBeVisible();
  await expect(
    surface.getByText("Soccer practice", { exact: true }),
  ).toBeVisible();

  const snapshot = await tap.fixture.snapshot();
  expect(snapshot.state.storage).toEqual([
    expect.objectContaining({
      key: STORAGE_KEY,
      namespace: STORAGE_NAMESPACE,
      packageId: PACKAGE_ID,
      revision: 1,
      value: expect.objectContaining({
        familyName: "Rivera",
        members: expect.arrayContaining([
          expect.objectContaining({
            id: "fixture-kid-sam",
            name: "Sam",
          }),
        ]),
      }),
      workspaceId: tap.workspaceId,
    }),
  ]);
});

test("persists deterministic transfer safeguards through allowed storage rails", async ({
  surface,
  tap,
}) => {
  await tap.control.reset();
  await surface.getByRole("tab", { name: "Manage", exact: true }).click();

  await surface
    .getByRole("spinbutton", { name: "Maximum transfer (optional)" })
    .fill("12");
  await surface
    .getByRole("spinbutton", { name: "Require parent above (optional)" })
    .fill("6");
  await surface
    .getByRole("button", { name: "Save transfer safeguards", exact: true })
    .click();

  await expect
    .poll(async () => {
      const snapshot = await tap.fixture.snapshot();
      const record = snapshot.state.storage.find(
        (entry) =>
          entry.namespace === STORAGE_NAMESPACE && entry.key === STORAGE_KEY,
      );
      return {
        revision: record?.revision,
        settings:
          typeof record?.value === "object" && record.value !== null
            ? Reflect.get(record.value, "settings")
            : undefined,
      };
    })
    .toEqual({
      revision: 2,
      settings: {
        transferLimit: 12,
        parentApprovalThreshold: 6,
      },
    });

  const ledger = await tap.fixture.ledger.read();
  expect(ledger.dropped).toBe(0);
  expect(
    hasHostAuthorizationDecision(ledger.entries, {
      actionId: "family-task-board.manage",
      autonomy: "do",
      allowed: true,
    }),
  ).toBe(true);
  expect(ledger.entries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "platform",
        operation: "authorization.check",
        detail: expect.objectContaining({
          actionId: "storage.read",
          allowed: true,
        }),
      }),
      expect.objectContaining({
        kind: "platform",
        operation: "authorization.check",
        detail: expect.objectContaining({
          actionId: "storage.write",
          allowed: true,
        }),
      }),
      expect.objectContaining({
        kind: "platform",
        operation: "storage.set",
        detail: expect.objectContaining({
          key: STORAGE_KEY,
          namespace: STORAGE_NAMESPACE,
          revision: 2,
        }),
      }),
    ]),
  );
});
