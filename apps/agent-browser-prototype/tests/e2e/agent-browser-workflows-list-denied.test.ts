import { expect, test } from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  hasHostAuthorizationDecision,
  hasHostOperation,
} from "./agent-browser-test-support";

test("fails closed when saved-workflow discovery is denied", async ({
  surface,
  tap,
}) => {
  expect(tap.profileId).toBe(
    "agent-browser-workflow-desktop-workflows-list-denied",
  );
  await tap.control.reset();

  await surface.getByText("Workflow execution", { exact: true }).click();
  await surface
    .getByRole("button", { name: "Load saved workflows", exact: true })
    .click();
  await expect(surface.getByRole("alert")).toContainText(
    /host action permission is not granted/iu,
  );

  const entries = (await tap.fixture.ledger.read()).entries;
  expect(hasHostAuthorizationDecision(entries, "workflows.list", false)).toBe(
    true,
  );
  expect(hasHostOperation(entries, "workflows.invoke")).toBe(false);
});
