import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import { PACKAGE_ID, SURFACE_ID, TARGET } from "./pr-radar-test-support";

const SHA256 = /^[a-f0-9]{64}$/u;

test("mounts and remounts the exact declared PR Radar desktop cell", async ({
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
    matrixEntryId: "pr-radar-desktop-default",
    packageId: PACKAGE_ID,
    profileId: "pr-radar-desktop",
    surfaceId: SURFACE_ID,
    target: TARGET,
  });
  expect(tap.sourceDigest).toMatch(SHA256);
  expect(tap.testBundleDigest).toMatch(SHA256);

  await tap.control.reset();
  await expect(surface.getByTestId("pr-radar-shell")).toBeVisible();
  await expect(surface.getByTestId("pr-radar-shell")).toHaveAttribute(
    "data-surface-target",
    TARGET,
  );
});
