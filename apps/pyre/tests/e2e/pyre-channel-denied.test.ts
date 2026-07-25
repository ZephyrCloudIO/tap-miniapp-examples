import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  FIXTURE_CHANNEL_ID,
  hasAuthorizationDecision,
  openPlatform,
  STORAGE_KEY,
  STORAGE_NAMESPACE,
} from "./pyre-test-support";

test("does not append or persist a checkpoint when channel messaging is denied", async ({
  surface,
  tap,
}) => {
  await openPlatform(surface);
  await surface
    .getByRole("button", { name: "Post Checkpoint", exact: true })
    .click();
  await expect(surface.getByRole("alert")).toContainText(
    /Channel checkpoint failed.*permission is not granted/iu,
  );

  const snapshot = await tap.fixture.snapshot();
  expect(
    snapshot.state.channels.find(
      (candidate) => candidate.roomId === FIXTURE_CHANNEL_ID,
    )?.messages,
  ).toEqual([]);
  expect(
    snapshot.state.storage.find(
      (entry) =>
        entry.namespace === STORAGE_NAMESPACE && entry.key === STORAGE_KEY,
    )?.revision,
  ).toBe(1);
  expect(
    hasAuthorizationDecision((await tap.fixture.ledger.read()).entries, {
      actionId: "channels.send-message",
      allowed: false,
      kind: "host-action",
    }),
  ).toBe(true);
});
