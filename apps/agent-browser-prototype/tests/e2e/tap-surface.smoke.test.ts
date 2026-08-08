import { expect, test } from "@theaiplatform/miniapp-sdk/testing/rstest";

test("mounts the live Remote Browser surface without allocating a browser", async ({
  surface,
  tap,
}) => {
  expect(tap.packageId).toBe("tap_pkg_examples_agent_browser_prototype_0001");
  expect(tap.surfaceId).toBe("agent-browser-prototype");
  expect(tap.target).toBe("desktop");
  await tap.control.reset();

  await expect(surface.getByText("Remote Browser", { exact: true })).toBeVisible();
  await expect(
    surface.getByText("No remote browser allocated", { exact: true }),
  ).toBeVisible();
  const header = surface.locator("header");
  await expect(header.getByRole("button", { name: "Start live", exact: true })).toBeVisible();
  await expect(header.getByPlaceholder("https://example.com")).toBeVisible();
  await expect(surface.getByText("Feature detection", { exact: true })).toHaveCount(0);
  await expect(surface.getByText("mcpTools.v1", { exact: true })).toHaveCount(0);
  await expect(surface.getByText("workflows.runs.v1", { exact: true })).toHaveCount(0);
  await expect(surface.getByRole("button", { name: "Capture", exact: true })).toHaveCount(0);
  await expect(surface.getByLabel("Browser engine")).toHaveCount(0);
  await expect(surface.getByText("Chromium", { exact: true })).toHaveCount(0);
  await expect(surface.getByText("prototype", { exact: true })).toHaveCount(0);
});

test("keeps signed Remote Browser controls unavailable until a real session starts", async ({
  surface,
  tap,
}) => {
  await tap.control.reset();

  await expect(surface.getByRole("button", { name: "End session", exact: true })).toHaveCount(0);
  await expect(surface.getByRole("button", { name: "Select element", exact: true })).toHaveCount(0);
});
