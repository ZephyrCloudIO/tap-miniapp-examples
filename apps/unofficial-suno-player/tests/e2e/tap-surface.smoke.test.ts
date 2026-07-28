import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  expectExactProvenance,
  expectReadySurface,
  packageEventLocalName,
} from "./unofficial-suno-player-test-support";

test("mounts and remounts the exact declared desktop cell", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    matrixEntryId: "unofficial-suno-player-desktop-positive",
    permissionScenario: "default",
    profileId: "unofficial-suno-player-desktop",
    seed: 6929,
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

  await expect
    .poll(async () =>
      (await tap.fixture.ledger.read()).entries.filter(
        (entry) =>
          packageEventLocalName(entry) === "player.surface.mounted",
      ).length,
    )
    .toBeGreaterThanOrEqual(2);
});
