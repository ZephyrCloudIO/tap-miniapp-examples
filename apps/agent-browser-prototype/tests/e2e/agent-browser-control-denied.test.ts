import { expect, test } from "@theaiplatform/miniapp-sdk/testing/rstest";
import { hasHostAuthorizationDecision } from "./agent-browser-test-support";

test("surfaces an authoritative live-control denial", async ({
  surface,
  tap,
}) => {
  expect(tap.profileId).toBe(
    "agent-browser-live-desktop-control-denied",
  );
  await tap.control.reset();

  await surface.getByText("Session runtime", { exact: true }).click();
  await surface.getByRole("button", { name: "Start live", exact: true }).click();
  await expect(surface.getByRole("alert")).toContainText(
    "browser.session.control",
  );

  const entries = (await tap.fixture.ledger.read()).entries;
  expect(
    hasHostAuthorizationDecision(entries, "browser.session.control", false),
  ).toBe(true);
});
