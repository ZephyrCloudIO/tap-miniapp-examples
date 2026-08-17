import { expect, test } from "@theaiplatform/miniapp-sdk/testing/rstest";
import { expectExactProvenance } from "./kart-royale-test-support";

test("keeps solo play available when platform-session use is denied", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, "credentials-use-denied");

  const host = surface.locator("#tap-root .kart-host");
  await expect(host).toBeAttached();
  await expect(surface.locator("#tap-error")).toBeHidden();

  const toggle = surface.locator(".kr-lobby-toggle");
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(
    surface.getByText("The race server is unreachable — solo play is unaffected."),
  ).toBeVisible();

  const ledger = await tap.fixture.ledger.read();
  expect(ledger.dropped).toBe(0);
});
