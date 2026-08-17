import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  expectExactProvenance,
  expectReadySurface,
} from "./tap-calendar-test-support";

test("mounts and remounts the declared TAP Calendar desktop surface", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    matrixEntryId: "tap-calendar-desktop-positive",
    permissionScenario: "default",
    profileId: "tap-calendar-desktop",
    seed: 8141,
    theme: "light",
  });
  await expectReadySurface(surface);
  expect(
    await surface.locator("html").evaluate(() => window.location.origin),
  ).toBe(new URL(tap.surfaceAssetOrigin).origin);

  await tap.control.remountSurface();
  const root = surface.locator("#tap-root");
  await expect(root).toBeVisible();
  await expect(root.locator(":scope > *").first()).toBeAttached();
  await expect(surface.locator("#tap-error")).toBeHidden();
  await expectReadySurface(surface);
});
