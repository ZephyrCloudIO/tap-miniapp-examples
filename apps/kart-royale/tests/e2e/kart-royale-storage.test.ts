import { expect, test } from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  CONTROL_PREFS_KEY,
  STORAGE_NAMESPACE,
  expectExactProvenance,
} from "./kart-royale-test-support";

test("hydrates control prefs from TAP storage before the game boots", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, "positive");

  const host = surface.locator("#tap-root .kart-host");
  await expect(host).toBeAttached();
  await expect(surface.locator("#tap-error")).toBeHidden();

  // The hydrate read must have hit the fixture record exactly.
  const snapshot = await tap.fixture.snapshot();
  const record = snapshot.state.storage.find(
    (entry) =>
      entry.namespace === STORAGE_NAMESPACE && entry.key === CONTROL_PREFS_KEY,
  );
  expect(record).toBeDefined();
  expect(record?.revision).toBeGreaterThanOrEqual(1);
  expect(record?.value).toMatchObject({
    scheme: "buttons",
    hand: "left",
    tutorialSeen: 1,
  });

  const ledger = await tap.fixture.ledger.read();
  expect(ledger.dropped).toBe(0);
  expect(ledger.entries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        operation: "storage.get",
        detail: expect.objectContaining({
          namespace: STORAGE_NAMESPACE,
          key: CONTROL_PREFS_KEY,
        }),
      }),
    ]),
  );
});
