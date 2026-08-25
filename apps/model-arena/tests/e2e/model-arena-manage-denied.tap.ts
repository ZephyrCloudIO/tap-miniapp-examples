import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import { expectExactProvenance } from "./model-arena-test-support";

test("keeps paid comparison controls read-only when manage authority is denied", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, "manage-denied");
  await tap.control.reset();

  await surface
    .getByRole("button", { name: "New Comparison", exact: true })
    .first()
    .click();

  const notice = surface.getByTestId("model-arena-manage-denied");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("Comparison access is read-only");
  await expect(notice).toContainText(
    "Your current role can review saved sessions but cannot run paid comparisons.",
  );
  await expect(
    surface.getByRole("button", { name: "Run Comparison", exact: true }),
  ).toBeDisabled();

  const ledger = await tap.fixture.ledger.read();
  expect(ledger.dropped).toBe(0);
  expect(
    ledger.entries.some(
      (entry) =>
        entry.kind === "host-action" &&
        entry.operation === "authorization.check" &&
        typeof entry.detail === "object" &&
        entry.detail !== null &&
        !Array.isArray(entry.detail) &&
        Reflect.get(entry.detail, "actionId") === "model-arena.manage" &&
        Reflect.get(entry.detail, "allowed") === false,
    ),
  ).toBe(true);
});
