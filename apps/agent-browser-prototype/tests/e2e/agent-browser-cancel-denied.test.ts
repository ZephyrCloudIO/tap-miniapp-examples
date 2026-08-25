import { expect, test } from "@theaiplatform/miniapp-sdk/testing/rstest";
import { hasHostAuthorizationDecision } from "./agent-browser-test-support";

test("keeps an active workflow running when call-bound cancellation is denied", async ({
  surface,
  tap,
}) => {
  expect(tap.profileId).toBe(
    "agent-browser-workflow-desktop-cancel-denied",
  );
  await tap.control.reset();

  await surface.getByText("Workflow execution", { exact: true }).click();
  await surface
    .getByRole("button", { name: "Load saved workflows", exact: true })
    .click();
  await surface
    .getByRole("button", { name: "Collect evidence", exact: true })
    .click();
  await surface
    .getByRole("button", { name: "Cancel run", exact: true })
    .click();
  await expect(surface.getByRole("alert")).toContainText(
    /permission is not granted|fresh host decision/iu,
  );

  const entries = (await tap.fixture.ledger.read()).entries;
  expect(
    hasHostAuthorizationDecision(entries, "workflows.runs.cancel", false),
  ).toBe(true);
});
