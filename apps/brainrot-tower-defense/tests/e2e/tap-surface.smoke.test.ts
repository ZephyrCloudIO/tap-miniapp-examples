import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  expectExactProvenance,
  resetToLobby,
} from "./brainrot-td-test-support";

test("mounts the exact desktop cell with reproducible provenance", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, "positive");
  await resetToLobby({ surface, tap });

  await expect(
    surface.getByRole("button", { name: "Create game", exact: true }),
  ).toBeEnabled();
  await tap.control.remountSurface();
  const root = surface.locator("#tap-root");
  await expect(root).toBeVisible();
  await expect(root.locator(":scope > *").first()).toBeAttached();
  await expect(surface.locator("#tap-error")).toBeHidden();
  await expect(
    surface.getByRole("heading", {
      level: 1,
      name: "Defend the feed together.",
      exact: true,
    }),
  ).toBeVisible();
  expectExactProvenance(tap, "positive");
});
