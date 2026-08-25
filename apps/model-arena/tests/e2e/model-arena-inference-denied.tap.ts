import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import { expectExactProvenance } from "./model-arena-test-support";

test("blocks paid model turns when managed inference is denied", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, "inference-denied");
  await tap.control.reset();

  await surface
    .getByRole("button", { name: "New Comparison", exact: true })
    .first()
    .click();
  await expect(
    surface.getByText("Managed inference is not authorized", { exact: true }),
  ).toBeVisible();
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
        Reflect.get(entry.detail, "actionId") === "inference.invoke" &&
        Reflect.get(entry.detail, "allowed") === false,
    ),
  ).toBe(true);
  expect(
    ledger.entries.some((entry) => entry.operation === "inference.invoke"),
  ).toBe(false);
});
