import { expect, test } from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  ROOMS_URL,
  expectExactProvenance,
} from "./kart-royale-test-support";

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

  const toggle = surface.locator(".kr-lobby-toggle");
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(
    surface.getByText("No open rooms right now — host the first one.", {
      exact: true,
    }),
  ).toBeVisible();

  expect(await tap.fixture.http.requests()).toEqual({
    dropped: 0,
    requests: [
      expect.objectContaining({
        matched: true,
        credentialRef: "platform-session",
        request: expect.objectContaining({
          method: "GET",
          url: ROOMS_URL,
        }),
      }),
    ],
  });
  expect((await tap.fixture.ledger.read()).dropped).toBe(0);
});
