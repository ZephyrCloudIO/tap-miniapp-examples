import { expect, test } from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  hasHostAuthorizationDecision,
  hasHostOperation,
} from "./agent-browser-test-support";

test("lists saved workflows but does not create a denied run", async ({
  surface,
  tap,
}) => {
  expect(tap.profileId).toBe(
    "agent-browser-workflow-desktop-workflows-invoke-denied",
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
  expect(hasHostAuthorizationDecision(entries, "workflows.list", true)).toBe(
    true,
  );
  expect(hasHostAuthorizationDecision(entries, "workflows.invoke", false)).toBe(
    true,
  );
  expect(hasHostOperation(entries, "workflow.runs.wait")).toBe(false);
});
