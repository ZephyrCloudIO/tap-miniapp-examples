import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  expectDeniedRun,
  hasAuthorizationDecision,
} from "./pr-radar-test-support";

test("reports a refused external link instead of leaving TAP", async ({
  surface,
  tap,
}) => {
  expectDeniedRun(tap, {
    matrixEntryId: "pr-radar-desktop-navigation-denied",
    permissionScenario: "deny:navigation.open-external",
    profileId: "pr-radar-desktop-navigation-denied",
  });

  // The seeded approval and open pull request render without a GitHub read.
  const pull = surface.getByTestId("pr-radar-pull");
  await expect(pull).toHaveCount(1);
  await expect(pull).toContainText("Fixture pull request");
  // Let the mount-time poll settle so its outcome cannot overwrite the link error.
  await expect(surface.getByTestId("pr-radar-status")).toHaveText(/· checked /u);

  await pull
    .getByRole("button", {
      name: "Open zephyrcloudio/tap-miniapp-examples pull request 42 on GitHub",
      exact: true,
    })
    .click();

  await expect(surface.getByTestId("pr-radar-error")).toHaveText(
    /The pull request could not be opened/u,
  );
  await expect
    .poll(async () =>
      hasAuthorizationDecision((await tap.fixture.ledger.read()).entries, {
        actionId: "navigation.open-external",
        allowed: false,
        kind: "host-action",
      }),
    )
    .toBe(true);
  expect(
    (await tap.fixture.ledger.read()).entries.filter(
      (entry) => entry.operation === "navigation.open-external",
    ),
  ).toHaveLength(0);
});
