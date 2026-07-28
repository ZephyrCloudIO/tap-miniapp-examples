import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  expectExactProvenance,
  hasAuthorizationDecision,
  hasOperation,
  openContext,
} from "./unofficial-suno-player-test-support";

test("keeps specialist controls unavailable when discovery authority is denied", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    matrixEntryId: "unofficial-suno-player-desktop-specialist-list-denied",
    permissionScenario: "deny:specialists.list",
    profileId: "unofficial-suno-player-desktop-specialist-list-denied",
    seed: 6936,
    theme: "dark",
  });
  await openContext(surface);

  await expect(
    surface.getByText("Optional capability unavailable", { exact: true }),
  ).toBeVisible();
  await expect(surface.getByText(/Specialists:.*permission is not granted/iu))
    .toBeVisible();
  await expect(
    surface.getByLabel("Specialist", { exact: true }),
  ).toBeDisabled();
  await expect(
    surface.getByRole("button", {
      name: "Draft with specialist",
      exact: true,
    }),
  ).toBeDisabled();

  const ledger = await tap.fixture.ledger.read();
  expect(
    hasAuthorizationDecision(ledger.entries, {
      actionId: "specialists.list",
      allowed: false,
      kind: "host-action",
    }),
  ).toBe(true);
  expect(
    hasOperation(
      ledger.entries,
      "host-action",
      "platform.specialist.list",
    ),
  ).toBe(false);
});
