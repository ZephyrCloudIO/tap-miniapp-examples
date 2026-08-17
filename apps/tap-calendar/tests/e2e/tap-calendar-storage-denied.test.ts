import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  expectExactProvenance,
  expectReadySurface,
  hasPlatformAuthorizationDecision,
  storageRecord,
} from "./tap-calendar-test-support";

test("keeps the stored calendar unchanged when storage writes are denied", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    matrixEntryId: "tap-calendar-desktop-storage-denied",
    permissionScenario: "deny:storage.write",
    profileId: "tap-calendar-desktop-storage-denied",
    seed: 8142,
    theme: "dark",
  });
  await expectReadySurface(surface);

  await surface.getByRole("button", { name: "Settings", exact: true }).click();
  const visibility = surface.getByLabel("Show Zephyr Cloud", { exact: true });
  await expect(visibility).toBeChecked();
  await visibility.click();
  await expect(surface.getByRole("alert")).toBeVisible();

  const accountMenuTrigger = surface.getByRole("button", {
    name: "Account actions for zack@zephyr-cloud.io",
    exact: true,
  });
  await accountMenuTrigger.click();
  await surface
    .getByRole("menu", { name: "Actions for zack@zephyr-cloud.io", exact: true })
    .getByRole("menuitem", { name: "Hide all calendars", exact: true })
    .click();
  await expect(visibility).toBeChecked();

  await expect
    .poll(async () => {
      const ledger = await tap.fixture.ledger.read();
      return hasPlatformAuthorizationDecision(ledger.entries, {
        actionId: "storage.write",
        allowed: false,
      });
    })
    .toBe(true);

  const snapshot = await tap.fixture.snapshot();
  expect(storageRecord(snapshot)).toEqual(
    expect.objectContaining({ revision: 1 }),
  );
  expect(storageRecord(snapshot)?.value).toEqual(
    expect.objectContaining({
      accounts: expect.arrayContaining([
        expect.objectContaining({
          calendars: expect.arrayContaining([
            expect.objectContaining({
              id: "fixture-calendar-work",
              visible: true,
            }),
          ]),
        }),
      ]),
    }),
  );
});
