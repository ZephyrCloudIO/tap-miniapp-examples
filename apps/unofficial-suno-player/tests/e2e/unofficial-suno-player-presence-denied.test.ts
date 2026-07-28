import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  STORAGE_NAMESPACE,
  channelListeningRoom,
  expectExactProvenance,
  hasAuthorizationDecision,
  hasOperation,
  openSettings,
  preferenceStorageRecords,
} from "./unofficial-suno-player-test-support";

test("persists the opt-in preference but never enters a denied presence room", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    matrixEntryId: "unofficial-suno-player-desktop-presence-denied",
    permissionScenario: "deny:presence.write",
    profileId: "unofficial-suno-player-desktop-presence-denied",
    seed: 6932,
    theme: "dark",
  });
  await openSettings(surface);
  const presenceCheckbox = surface.getByRole("checkbox", {
    name: /Broadcast my listening or paused state/u,
  });
  await presenceCheckbox.click();
  await expect(presenceCheckbox).toBeChecked();
  await expect(
    surface.getByText(/run did not grant this platform action/iu),
  ).toBeVisible();

  const snapshot = await tap.fixture.snapshot();
  expect(
    preferenceStorageRecords(snapshot).some(
      (entry) =>
        typeof entry.value === "object" &&
        entry.value !== null &&
        !Array.isArray(entry.value) &&
        Reflect.get(entry.value, "broadcastPresence") === true,
    ),
  ).toBe(true);
  expect(
    snapshot.state.presence.find(
      (entry) =>
        entry.namespace === STORAGE_NAMESPACE &&
        entry.room === channelListeningRoom(tap.channelId),
    )?.participants.map((participant) => participant.participantId),
  ).toEqual(["fixture-listener-reviewer"]);

  const ledger = await tap.fixture.ledger.read();
  expect(
    hasAuthorizationDecision(ledger.entries, {
      actionId: "presence.write",
      allowed: false,
      kind: "platform",
    }),
  ).toBe(true);
  expect(hasOperation(ledger.entries, "platform", "presence.join")).toBe(false);
});
