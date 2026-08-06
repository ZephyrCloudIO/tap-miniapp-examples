import { expect, test } from "@theaiplatform/miniapp-sdk/testing/rstest";
import { expectExactProvenance } from "./kart-royale-test-support";

test("fails closed with a permission notice when kart-royale.play is revoked", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, "post-projection-revoked");

  // Under an all-denied projection the surface must not boot the game at all:
  // no renderer scaffold, a truthful blocking notice instead.
  await expect(surface.getByRole("alert")).toHaveText(
    "Kart Royale needs the kart-royale.play permission in this channel before the race can start.",
  );
  await expect(surface.locator("#tap-root .kart-host")).toHaveCount(0);
  await expect(surface.locator("#tap-error")).toBeHidden();

  const ledger = await tap.fixture.ledger.read();
  expect(ledger.dropped).toBe(0);
  // The denial is recorded as a host authorization check, and no storage
  // mutation may reach the fixture ledger under an all-denied projection.
  expect(
    ledger.entries.some(
      (entry) =>
        entry.kind === "host-action" &&
        entry.operation === "authorization.check" &&
        typeof entry.detail === "object" &&
        entry.detail !== null &&
        !Array.isArray(entry.detail) &&
        Reflect.get(entry.detail, "actionId") === "kart-royale.play" &&
        Reflect.get(entry.detail, "allowed") === false,
    ),
  ).toBe(true);
  expect(
    ledger.entries.some((entry) =>
      ["storage.delete", "storage.set"].includes(entry.operation),
    ),
  ).toBe(false);
});
