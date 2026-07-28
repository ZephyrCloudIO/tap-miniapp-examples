import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  PACKAGE_ID,
  STORAGE_KEY,
  STORAGE_NAMESPACE,
  expectExactProvenance,
} from "./family-task-board-test-support";

test("fails closed after projected authority is synthetically revoked", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    matrixEntryId: "family-task-board-desktop-storage-denied",
    permissionScenario: "all-denied",
    profileId: "family-task-board-desktop-post-projection-revoked",
    seed: 6930,
    theme: "dark",
  });

  await expect(surface.getByRole("alert")).toHaveText(
    "The household could not be loaded from TAP storage.",
  );

  const ledger = await tap.fixture.ledger.read();
  expect(ledger.dropped).toBe(0);
  expect(ledger.entries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "platform",
        operation: "authorization.check",
        detail: {
          action: "tap.platform.storage.get",
          actionId: "storage.read",
          autonomy: "listen",
          allowed: false,
          documentId: expect.stringMatching(/\S/u),
          instanceId: expect.stringMatching(/\S/u),
        },
      }),
    ]),
  );
  expect(
    ledger.entries.some((entry) =>
      ["storage.delete", "storage.get", "storage.set"].includes(entry.operation),
    ),
  ).toBe(false);

  const snapshot = await tap.fixture.snapshot();
  expect(snapshot.state.storage).toEqual([
    expect.objectContaining({
      key: STORAGE_KEY,
      namespace: STORAGE_NAMESPACE,
      packageId: PACKAGE_ID,
      revision: 1,
    }),
  ]);
});
