import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  STORAGE_KEY,
  STORAGE_NAMESPACE,
  expectExactProvenance,
  hasHostAuthorizationDecision,
} from "./family-task-board-test-support";

test("keeps the family board readable without allowing a management mutation", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    matrixEntryId: "family-task-board-desktop-manage-denied",
    permissionScenario: "deny:family-task-board.manage",
    profileId: "family-task-board-desktop-manage-denied",
    seed: 6931,
    theme: "dark",
  });

  await expect(
    surface.getByRole("heading", { level: 1, name: "Good afternoon, Alex" }),
  ).toBeVisible();
  await expect(
    surface.getByText("Fold the laundry", { exact: true }),
  ).toBeVisible();
  await expect(
    surface.getByText(
      "View-only access. TAP has not granted household management.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    surface.getByRole("tab", { name: "Manage", exact: true }),
  ).toHaveCount(0);

  await surface
    .getByRole("button", { name: "View as Sam", exact: true })
    .click();
  await expect(
    surface.getByRole("heading", { level: 1, name: "Hey, Sam!" }),
  ).toBeVisible();
  await expect(
    surface.getByRole("button", { name: "Mark done", exact: true }),
  ).toBeDisabled();
  await surface
    .getByRole("tab", { name: "Star Shop", exact: true })
    .click();
  await expect(
    surface.getByRole("button", { name: "Get reward", exact: true }),
  ).toBeDisabled();

  const ledger = await tap.fixture.ledger.read();
  expect(ledger.dropped).toBe(0);
  expect(
    hasHostAuthorizationDecision(ledger.entries, {
      actionId: "family-task-board.manage",
      autonomy: "do",
      allowed: false,
    }),
  ).toBe(true);
  expect(
    ledger.entries.some((entry) => entry.operation === "storage.set"),
  ).toBe(false);

  const snapshot = await tap.fixture.snapshot();
  expect(snapshot.state.storage).toEqual([
    expect.objectContaining({
      key: STORAGE_KEY,
      namespace: STORAGE_NAMESPACE,
      revision: 1,
      value: expect.objectContaining({
        settings: {
          transferLimit: 8,
          parentApprovalThreshold: 4,
        },
        tasks: [
          expect.objectContaining({
            id: "fixture-task-laundry",
            status: "open",
          }),
        ],
      }),
    }),
  ]);
});
