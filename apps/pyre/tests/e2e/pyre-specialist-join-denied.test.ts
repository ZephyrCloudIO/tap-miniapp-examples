import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  expectMatchingAlert,
  FIXTURE_CHANNEL_ID,
  hasAuthorizationDecision,
  openPlatform,
} from "./pyre-test-support";

test("keeps the package specialist out of the channel when joining is denied", async ({
  surface,
  tap,
}) => {
  await openPlatform(surface);
  await surface
    .getByRole("button", { name: "Join Pyre Specialist", exact: true })
    .click();
  await expectMatchingAlert(
    surface,
    /Specialist join failed.*permission is not granted/iu,
  );

  const snapshot = await tap.fixture.snapshot();
  expect(
    snapshot.state.specialists.some(
      specialist => specialist.id === "pyre-investigation-specialist",
    ),
  ).toBe(true);
  expect(
    snapshot.state.channels.find(
      (candidate) => candidate.roomId === FIXTURE_CHANNEL_ID,
    )?.specialistIds,
  ).toEqual([]);
  expect(
    hasAuthorizationDecision((await tap.fixture.ledger.read()).entries, {
      actionId: "channels.manage-specialists",
      allowed: false,
      kind: "host-action",
    }),
  ).toBe(true);
});
