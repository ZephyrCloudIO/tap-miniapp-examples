import { expect, test } from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  expectExactProvenance,
  hasPlatformAuthorizationDecision,
} from "./kart-royale-test-support";

test("keeps an optional denied presence join out of the fixture realm", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, "presence-denied");

  await expect(surface.locator("#tap-root .kart-host")).toBeAttached();
  await expect(surface.locator(".kr-lobby-toggle")).toBeVisible();
  await expect(surface.locator("#tap-error")).toBeHidden();
  await expect
    .poll(async () => {
      const ledger = await tap.fixture.ledger.read();
      return hasPlatformAuthorizationDecision(ledger.entries, {
        action: "tap.platform.presence.join",
        actionId: "presence.write",
        autonomy: "do",
        allowed: false,
      });
    })
    .toBe(true);

  const ledger = await tap.fixture.ledger.read();
  expect(ledger.dropped).toBe(0);
  expect(
    ledger.entries.some(
      (entry) =>
        entry.kind === "platform" && entry.operation === "presence.join",
    ),
  ).toBe(false);
  expect((await tap.fixture.snapshot()).state.presence).toEqual([]);
});
