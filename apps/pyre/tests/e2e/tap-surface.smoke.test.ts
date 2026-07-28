import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  expectReadySurface,
  PACKAGE_ID,
  SHA256,
} from "./pyre-test-support";

test("mounts and remounts the exact declared Pyre desktop cell", async ({
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
    matrixEntryId: "pyre-desktop-positive",
    packageId: PACKAGE_ID,
    profileId: "pyre-desktop",
    surfaceId: "pyre",
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
    surface.getByText("3 present", { exact: true }),
  ).toBeVisible();
});
