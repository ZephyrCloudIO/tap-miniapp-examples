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
  await expectReadySurface(surface);

  await expect
    .poll(async () => {
      const ledger = await tap.fixture.ledger.read();
      return new Set(
        ledger.entries
          .map(packageEventLocalName)
          .filter((name): name is string => name !== null),
      );
    })
    .toEqual(
      new Set([
        "player.surface.mounted",
        "player.surface.unmounted",
      ]),
    );
});
