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

test("denies the lifecycle channel notice before host side effects", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    allowedOrigins: [],
    matrixEntryId: "engineering-change-desktop-channel-denied",
    permissionScenario: "deny:channels.send-message",
    profileId: "engineering-change-desktop-channel-denied",
    seed: 7118,
    theme: "dark",
  });
  await openChangeDetail(surface);
  await surface.getByTestId("engineering-change-detail-post-notice").click();
  await expect(
    surface.getByTestId("engineering-change-detail-workspace-error"),
  ).toBeVisible();

  const snapshot = await tap.fixture.snapshot();
  const channel = snapshot.state.channels.find(
    (candidate) => candidate.roomId === FIXTURE_CHANNEL_ID,
  );
  expect(channel?.messages).toEqual([]);

  const ledger = await tap.fixture.ledger.read();
  expect(
    hasAuthorizationDecision(ledger.entries, {
      actionId: "channels.send-message",
      allowed: false,
      autonomy: "do",
      kind: "host-action",
    }),
  ).toBe(true);
});
