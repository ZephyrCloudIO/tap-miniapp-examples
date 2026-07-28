import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  channelStorageRecord,
  expectExactProvenance,
  hasAuthorizationDecision,
  hasOperation,
  openContext,
} from "./unofficial-suno-player-test-support";

test("does not persist consent when the required channel notice is denied", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    matrixEntryId: "unofficial-suno-player-desktop-channel-send-denied",
    permissionScenario: "deny:channels.send-message",
    profileId: "unofficial-suno-player-desktop-channel-send-denied",
    seed: 6934,
    theme: "dark",
  });
  await openContext(surface);
  await surface
    .getByRole("button", {
      name: "Enable and notify channel",
      exact: true,
    })
    .click();
  await expect(
    surface.getByText(/permission is not granted/iu),
  ).toBeVisible();

  const snapshot = await tap.fixture.snapshot();
  expect(channelStorageRecord(snapshot, tap.channelId)).toEqual(
    expect.objectContaining({
      revision: 1,
      value: expect.objectContaining({
        consent: {
          conversationContextEnabled: false,
          notifiedAt: null,
        },
      }),
    }),
  );
  expect(
    snapshot.state.channels.find(
      (channel) => channel.roomId === tap.channelId,
    )?.messages,
  ).toHaveLength(2);

  const ledger = await tap.fixture.ledger.read();
  expect(
    hasAuthorizationDecision(ledger.entries, {
      actionId: "channels.send-message",
      allowed: false,
      kind: "host-action",
    }),
  ).toBe(true);
  expect(hasOperation(ledger.entries, "host-action", "channels.send-message"))
    .toBe(false);
  expect(hasOperation(ledger.entries, "platform", "storage.set")).toBe(false);
});
