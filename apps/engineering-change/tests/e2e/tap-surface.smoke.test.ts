import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  expectReadySurface,
  PACKAGE_ID,
  SHA256,
} from "./engineering-change-test-support";

test("mounts and remounts the exact declared Engineering Change desktop cell", async ({
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
    matrixEntryId: "engineering-change-desktop-positive",
    packageId: PACKAGE_ID,
    profileId: "engineering-change-desktop",
    surfaceId: "engineering-change",
    target: "desktop",
  });
  expect(tap.sourceDigest).toMatch(SHA256);
  expect(tap.testBundleDigest).toMatch(SHA256);

  await tap.control.reset();
  const root = surface.locator("#tap-root");
  await expect(root).toBeVisible();
  await expect(root.locator(":scope > *").first()).toBeAttached();
  await expect(surface.locator("#tap-error")).toBeHidden();
  await expectReadySurface(surface);
  await expect(
    surface.getByTestId("engineering-change-overview-open-ledger"),
  ).toBeVisible();
});
