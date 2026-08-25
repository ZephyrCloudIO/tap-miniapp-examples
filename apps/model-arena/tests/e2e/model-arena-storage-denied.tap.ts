import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import { expectExactProvenance } from "./model-arena-test-support";

test("renders a clean empty state after projected authority is revoked", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, "storage-denied");
  await tap.control.reset();

  const root = surface.locator("#tap-root");
  await expect(root).toBeVisible();
  await expect(root.locator(":scope > *").first()).toBeAttached();
  await expect(surface.locator("#tap-error")).toBeHidden();
  await expect(
    surface.getByRole("heading", { level: 1, name: "Model Arena" }),
  ).toBeVisible();
  await expect(
    surface.getByText("Nothing to chart yet", { exact: true }),
  ).toBeVisible();

  const snapshot = await tap.fixture.snapshot();
  expect(snapshot.state.storage).toEqual([]);
  const ledger = await tap.fixture.ledger.read();
  expect(ledger.dropped).toBe(0);
  expect(
    ledger.entries.some((entry) =>
      ["storage.delete", "storage.set"].includes(entry.operation),
    ),
  ).toBe(false);
});
