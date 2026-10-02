import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  allowTapGithubAccess,
  expectAccessStillRequired,
  expectDeniedRun,
  hasAuthorizationDecision,
  settingsRecord,
} from "./pr-radar-test-support";

test("refuses GitHub access when TAP's GitHub credential may not be used", async ({
  surface,
  tap,
}) => {
  expectDeniedRun(tap, {
    matrixEntryId: "pr-radar-desktop-credentials-use-denied",
    permissionScenario: "deny:credentials.use",
    profileId: "pr-radar-desktop-credentials-use-denied",
  });

  await allowTapGithubAccess(surface);

  await expect(surface.getByTestId("pr-radar-modal-error")).toHaveText(
    /TAP isn.t connected to GitHub yet|TAP.s GitHub connection could not be checked/u,
  );
  await expectAccessStillRequired(surface);

  await expect
    .poll(async () =>
      hasAuthorizationDecision((await tap.fixture.ledger.read()).entries, {
        actionId: "credentials.use",
        allowed: false,
        kind: "host-action",
      }),
    )
    .toBe(true);
  const ledger = await tap.fixture.ledger.read();
  expect(
    ledger.entries.some(
      (entry) => entry.kind === "native" && entry.operation === "http.request",
    ),
  ).toBe(false);
  expect((await tap.fixture.http.requests()).requests).toEqual([]);
  expect(settingsRecord(await tap.fixture.snapshot())).toBeUndefined();
});
