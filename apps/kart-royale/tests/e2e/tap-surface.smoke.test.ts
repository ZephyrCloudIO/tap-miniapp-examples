import { expect, test } from "@theaiplatform/miniapp-sdk/testing/rstest";
import { expectExactProvenance, SHA256 } from "./kart-royale-test-support";

test("mounts the exact declared TAP cell with reproducible provenance", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, "positive");
  expect(
    await surface.locator("html").evaluate(() => window.location.origin),
  ).toBe(new URL(tap.surfaceAssetOrigin).origin);

  await tap.control.reset();
  const root = surface.locator("#tap-root");
  await expect(root).toBeVisible();
  await expect(root.locator(":scope > *").first()).toBeAttached();
  await expect(surface.locator("#tap-error")).toBeHidden();

  // The game builds its own scoped scaffold (see src/hostDom.ts): the renderer
  // parent, the HUD overlay, and the boot curtain.
  const host = root.locator(".kart-host");
  await expect(host).toBeAttached();
  await expect(host.locator("#app")).toBeAttached();
  await expect(host.locator("#ui")).toBeAttached();
});
