import { expect, test } from "@theaiplatform/miniapp-sdk/testing/rstest";
import { hasHostOperation } from "./agent-browser-test-support";

test("mounts only durable controls on the workspace workflow surface", async ({
  surface,
  tap,
}) => {
  expect(tap.packageId).toBe("tap_pkg_examples_agent_browser_prototype_0001");
  expect(tap.surfaceId).toBe("agent-browser-workflow");
  expect(tap.target).toBe("desktop");
  await tap.control.reset();

  await expect(surface.getByText("Remote Browser", { exact: true })).toBeVisible();
  await expect(surface.getByText("Feature detection", { exact: true })).toHaveCount(0);
  await expect(surface.getByText("mcpTools.v1", { exact: true })).toHaveCount(0);
  await expect(surface.getByText("workflows.runs.v1", { exact: true })).toHaveCount(0);
  await expect(surface.getByRole("button", { name: "Collect evidence", exact: true })).toBeVisible();
  await expect(surface.getByRole("button", { name: "Start live", exact: true })).toHaveCount(0);
  await expect(surface.getByLabel("Browser engine")).toHaveCount(0);
  await expect(surface.getByText("Engine policy", { exact: true })).toHaveCount(0);
  await expect(surface.getByText("Chromium", { exact: true })).toHaveCount(0);
});

test("captures durable evidence through a selected saved workflow", async ({
  surface,
  tap,
}) => {
  await tap.control.reset();

  await surface.getByText("Workflow execution", { exact: true }).click();
  await surface
    .getByRole("button", { name: "Load saved workflows", exact: true })
    .click();
  await expect(
    surface.getByText("Found 1 saved workflow", { exact: true }),
  ).toBeVisible();
  await expect(surface.getByLabel("Saved browser workflow")).toHaveValue(
    "agent-browser-snapshot-workflow",
  );
  await surface
    .getByRole("button", { name: "Collect evidence", exact: true })
    .click();

  await expect(surface.getByRole("status")).toContainText(
    "Evidence captured · 319 ms browser · 412 ms workflow",
  );
  await expect(surface.getByText(/Durable workflow evidence/u)).toBeVisible();

  const entries = (await tap.fixture.ledger.read()).entries;
  expect(hasHostOperation(entries, "workflows.list")).toBe(true);
  expect(hasHostOperation(entries, "workflows.invoke")).toBe(true);
  expect(hasHostOperation(entries, "workflow.runs.wait")).toBe(true);
  expect(hasHostOperation(entries, "workflow.runs.output")).toBe(true);
});
