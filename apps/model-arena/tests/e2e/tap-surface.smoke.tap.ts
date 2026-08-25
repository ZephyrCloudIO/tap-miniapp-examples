import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import { expectExactProvenance } from "./model-arena-test-support";

test("mounts the exact declared Model Arena desktop cell", async ({
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
  await expect(
    surface.getByRole("heading", { level: 1, name: "Model Arena" }),
  ).toBeVisible();
  await expect(
    surface.getByText("Nothing to chart yet", { exact: true }),
  ).toBeVisible();
});

test("opens the comparison composer from the empty dashboard", async ({
  surface,
  tap,
}) => {
  await tap.control.reset();
  await surface
    .getByRole("button", { name: "New Comparison", exact: true })
    .first()
    .click();

  await expect(surface.locator(".session-composer")).toBeVisible();
  await expect(surface.getByLabel("Prompt", { exact: true })).toBeVisible();
  await expect(
    surface.getByText(
      "TAP owns provider credentials, routing, cost attribution, and content-free telemetry. No API key enters this miniapp.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    surface.getByText("Managed inference is not authorized", { exact: true }),
  ).toHaveCount(0);
  await expect(
    surface.getByRole("button", { name: "Run Comparison", exact: true }),
  ).toBeDisabled();
});
