import { expect, test } from "@theaiplatform/miniapp-sdk/testing/rstest";
import { expectExactProvenance } from "./kart-royale-test-support";

test("reports the lobby unreachable and keeps solo play when network is denied", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, "http-denied");

  // The game itself mounts and is unaffected: solo play never touches the net.
  const host = surface.locator("#tap-root .kart-host");
  await expect(host).toBeAttached();
  await expect(surface.locator("#tap-error")).toBeHidden();

  // Opening the lobby fails soft with a truthful, non-destructive notice.
  const toggle = surface.locator(".kr-lobby-toggle");
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(
    surface.getByText("The race server is unreachable — solo play is unaffected."),
  ).toBeVisible();

  const ledger = await tap.fixture.ledger.read();
  expect(ledger.dropped).toBe(0);
});
