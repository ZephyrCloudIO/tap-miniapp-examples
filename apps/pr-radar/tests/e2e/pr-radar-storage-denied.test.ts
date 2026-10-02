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

test("keeps GitHub access unapproved when its choice cannot be saved", async ({
  surface,
  tap,
}) => {
  expectDeniedRun(tap, {
    matrixEntryId: "pr-radar-desktop-storage-denied",
    permissionScenario: "deny:storage.write",
    profileId: "pr-radar-desktop-storage-denied",
  });

  await allowTapGithubAccess(surface);

  // The connection probe succeeds; only persisting the choice is refused.
  await expect(surface.getByTestId("pr-radar-modal-error")).toHaveText(
    /PR Radar could not save GitHub access/u,
  );
  await expectAccessStillRequired(surface);

  await expect
    .poll(async () =>
      hasAuthorizationDecision((await tap.fixture.ledger.read()).entries, {
        actionId: "storage.write",
        allowed: false,
        kind: "platform",
      }),
    )
    .toBe(true);
  const requests = (await tap.fixture.http.requests()).requests;
  expect(requests.length).toBeGreaterThan(0);
  expect(
    requests.every(
      (capture) =>
        capture.matched &&
        capture.auth === "github" &&
        capture.request.url === "https://api.github.com/user",
    ),
  ).toBe(true);
  expect(settingsRecord(await tap.fixture.snapshot())).toBeUndefined();
});
