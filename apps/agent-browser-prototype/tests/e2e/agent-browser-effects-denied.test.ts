import { expect, test } from "@theaiplatform/miniapp-sdk/testing/rstest";

test("fails closed before attaching a browser stream when all effects are denied", async ({
  surface,
  tap,
}) => {
  expect(tap.profileId).toBe(
    "agent-browser-live-desktop-browser-effects-denied",
  );
  expect(tap.permissionScenario).toBe("all-denied");
  await tap.control.reset();

  await surface.getByText("Session runtime", { exact: true }).click();
  await surface.getByRole("button", { name: "Start live", exact: true }).click();
  await expect(surface.getByRole("alert")).toContainText(
    /browser|permission|effect/iu,
  );

  const entries = (await tap.fixture.ledger.read()).entries;
  expect(
    entries.some(
      (entry) => entry.kind === "native" && entry.operation.includes("browser"),
    ),
  ).toBe(false);
});
