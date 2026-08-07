import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  expectExactProvenance,
  FIXTURE_CHANNEL_ID,
  hasAuthorizationDecision,
  openChangeDetail,
} from "./engineering-change-test-support";

test("denies the coordinator specialist join before host side effects", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    allowedOrigins: [],
    matrixEntryId: "engineering-change-desktop-specialist-join-denied",
    permissionScenario: "deny:channels.manage-specialists",
    profileId: "engineering-change-desktop-specialist-join-denied",
    seed: 7119,
    theme: "dark",
  });
  await openChangeDetail(surface);
  await surface.getByTestId("engineering-change-detail-join-specialist").click();
  await expect(
    surface.getByTestId("engineering-change-detail-workspace-error"),
  ).toBeVisible();

  const snapshot = await tap.fixture.snapshot();
  const channel = snapshot.state.channels.find(
    (candidate) => candidate.roomId === FIXTURE_CHANNEL_ID,
  );
  expect(channel?.specialistIds).toEqual([]);
  expect(snapshot.state.specialists).toEqual([]);

  const ledger = await tap.fixture.ledger.read();
  expect(
    hasAuthorizationDecision(ledger.entries, {
      actionId: "channels.manage-specialists",
      allowed: false,
      autonomy: "do",
      kind: "host-action",
    }),
  ).toBe(true);
});
