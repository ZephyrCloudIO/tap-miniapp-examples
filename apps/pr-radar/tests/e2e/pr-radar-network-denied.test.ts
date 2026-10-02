import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  allowTapGithubAccess,
  expectAccessStillRequired,
  expectDeniedRun,
  settingsRecord,
} from "./pr-radar-test-support";

test("refuses GitHub access when the host blocks the GitHub API origin", async ({
  surface,
  tap,
}) => {
  expectDeniedRun(tap, {
    matrixEntryId: "pr-radar-desktop-network-denied",
    permissionScenario: "http-denied",
    profileId: "pr-radar-desktop-network-denied",
  });
  expect(tap.allowedNetworkOrigins).toEqual([]);

  await allowTapGithubAccess(surface);

  await expect(surface.getByTestId("pr-radar-modal-error")).toHaveText(
    /TAP.s GitHub connection could not be checked/u,
  );
  await expectAccessStillRequired(surface);

  // The scripted /user route is never consumed and no access choice is saved.
  expect((await tap.fixture.http.requests()).requests).toEqual([]);
  expect(settingsRecord(await tap.fixture.snapshot())).toBeUndefined();
});
