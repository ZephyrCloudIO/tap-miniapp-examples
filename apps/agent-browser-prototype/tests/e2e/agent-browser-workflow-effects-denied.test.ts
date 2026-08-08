import { expect, test } from "@theaiplatform/miniapp-sdk/testing/rstest";

test("fails closed when durable workflow host effects are unavailable", async ({
  surface,
  tap,
}) => {
  expect(tap.profileId).toBe(
    "agent-browser-workflow-desktop-effects-denied",
  );
  expect(tap.permissionScenario).toBe("all-denied");
  await tap.control.reset();

  await surface.getByText("Workflow execution", { exact: true }).click();
  await surface
    .getByRole("button", { name: "Load saved workflows", exact: true })
    .click();
  await expect(surface.getByRole("alert")).toContainText(
    /host action|permission|effect/iu,
  );
});
