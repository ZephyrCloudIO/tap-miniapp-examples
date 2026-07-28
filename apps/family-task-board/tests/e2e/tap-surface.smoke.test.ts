import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  PACKAGE_ID,
  SHA256,
} from "./family-task-board-test-support";

test("mounts the exact declared TAP cell with reproducible provenance", async ({
  surface,
  tap,
}) => {
  expect({
    matrixEntryId: tap.matrixEntryId,
    packageId: tap.packageId,
    profileId: tap.profileId,
    surfaceId: tap.surfaceId,
    target: tap.target,
  }).toEqual({
    matrixEntryId: "family-task-board-desktop-positive",
    packageId: PACKAGE_ID,
    profileId: "family-task-board-desktop",
    surfaceId: "family-task-board",
    target: "desktop",
  });
  expect(tap.seed).toBe(tap.environment.seed);
  expect(tap.sourceDigest).toMatch(SHA256);
  expect(tap.testBundleDigest).toMatch(SHA256);
  expect(tap.descriptorDigest).toMatch(SHA256);
  expect(tap.policyDigest).toMatch(SHA256);
  expect(tap.fixtureDigest).toMatch(SHA256);
  expect(
    await surface.locator("html").evaluate(() => window.location.origin),
  ).toBe(new URL(tap.surfaceAssetOrigin).origin);

  await tap.control.reset();
  const root = surface.locator("#tap-root");
  await expect(root).toBeVisible();
  await expect(root.locator(":scope > *").first()).toBeAttached();
  await expect(surface.locator("#tap-error")).toBeHidden();
  await expect(
    surface.getByRole("heading", { level: 1, name: "Good afternoon, Alex" }),
  ).toBeVisible();
  await expect(
    surface.getByText("Fold the laundry", { exact: true }),
  ).toBeVisible();
});
