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

test("does not create or join a managed specialist when management is denied", async ({
  surface,
  tap,
}) => {
  await openPlatform(surface);
  await surface
    .getByRole("button", { name: "Install & Join", exact: true })
    .click();
  await expectMatchingAlert(
    surface,
    /Specialist installation failed.*permission is not granted/iu,
  );

  const snapshot = await tap.fixture.snapshot();
  expect(snapshot.state.specialists).toEqual([]);
  expect(
    snapshot.state.channels.find(
      (candidate) => candidate.roomId === FIXTURE_CHANNEL_ID,
    )?.specialistIds,
  ).toEqual([]);
  expect(
    hasAuthorizationDecision((await tap.fixture.ledger.read()).entries, {
      actionId: "specialists.manage",
      allowed: false,
      kind: "host-action",
    }),
  ).toBe(true);
});
