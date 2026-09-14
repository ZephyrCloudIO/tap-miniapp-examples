import { expect, test } from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  hasHostAuthorizationDecision,
  hasHostOperation,
} from "./agent-browser-test-support";

test("does not read output when workflow-run observation is denied", async ({
  surface,
  tap,
}) => {
  expect(tap.profileId).toBe(
    "agent-browser-workflow-desktop-runs-read-denied",
  );
  await tap.control.reset();

  await surface.getByText("Workflow execution", { exact: true }).click();
  await surface
    .getByRole("button", { name: "Load saved workflows", exact: true })
    .click();
  await surface
    .getByRole("button", { name: "Collect evidence", exact: true })
    .click();
  await expect(surface.getByRole("alert")).toContainText(
    /host action permission is not granted/iu,
  );

  const entries = (await tap.fixture.ledger.read()).entries;
  expect(hasHostOperation(entries, "workflows.invoke")).toBe(true);
  expect(
    hasHostAuthorizationDecision(entries, "workflows.runs.read", false),
  ).toBe(true);
  expect(hasHostOperation(entries, "workflow.runs.output")).toBe(false);
});
