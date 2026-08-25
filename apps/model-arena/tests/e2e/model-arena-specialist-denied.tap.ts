import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import { expectExactProvenance } from "./model-arena-test-support";

test("keeps one-shot setup available without invoking a denied specialist", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, "specialist-denied");
  await tap.control.reset();

  await surface
    .getByRole("button", { name: "New Comparison", exact: true })
    .first()
    .click();
  await expect(
    surface.getByText(
      "TAP owns provider credentials, routing, cost attribution, and content-free telemetry. No API key enters this miniapp.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    surface.getByRole("button", { name: "Run Comparison", exact: true }),
  ).toBeDisabled();
  await surface.getByRole("button", { name: "Benchmark", exact: true }).click();
  await expect(
    surface.getByText("Specialist benchmark is not authorized", { exact: true }),
  ).toBeVisible();

  const ledger = await tap.fixture.ledger.read();
  expect(ledger.dropped).toBe(0);
  expect(
    ledger.entries.some(
      (entry) =>
        entry.operation === "authorization.check" &&
        typeof entry.detail === "object" &&
        entry.detail !== null &&
        !Array.isArray(entry.detail) &&
        Reflect.get(entry.detail, "actionId") === "specialists.invoke" &&
        Reflect.get(entry.detail, "allowed") === false,
    ),
  ).toBe(true);
  expect(
    ledger.entries.some((entry) => entry.operation === "specialists.invoke"),
  ).toBe(false);
});
