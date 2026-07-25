import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  expectExactProvenance,
  hasAuthorizationDecision,
  packageEventLocalName,
  resetToLobby,
} from "./brainrot-td-test-support";

test("continues gameplay while suppressing denied channel activity", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, "channel-messaging-denied");
  await resetToLobby({ surface, tap });

  const create = surface.getByRole("button", {
    name: "Create game",
    exact: true,
  });
  await expect(create).toBeEnabled();
  await create.click();
  await expect(
    surface.getByRole("heading", {
      level: 1,
      name: "Miniapp Test Fixture User's defense",
      exact: true,
    }),
  ).toBeVisible();

  await expect
    .poll(async () => {
      const ledger = await tap.fixture.ledger.read();
      return {
        play: hasAuthorizationDecision(ledger.entries, {
          kind: "host-action",
          actionId: "brainrot-td.play",
          autonomy: "do",
          allowed: true,
        }),
        channelMessaging: hasAuthorizationDecision(ledger.entries, {
          kind: "host-action",
          actionId: "channels.send-message",
          autonomy: "do",
          allowed: false,
        }),
        event: ledger.entries.some(
          (entry) => packageEventLocalName(entry) === "lobby.created",
        ),
        sessionWrite: ledger.entries.some(
          (entry) =>
            entry.kind === "platform" &&
            entry.operation === "storage.set" &&
            typeof entry.detail === "object" &&
            entry.detail !== null &&
            !Array.isArray(entry.detail) &&
            Reflect.get(entry.detail, "namespace") === "brainrot-td",
        ),
      };
    })
    .toEqual({
      play: true,
      channelMessaging: true,
      event: true,
      sessionWrite: true,
    });

  const ledger = await tap.fixture.ledger.read();
  expect(ledger.dropped).toBe(0);
  expect(
    ledger.entries.some(
      (entry) =>
        entry.kind === "host-action" &&
        entry.operation === "channels.send-message",
    ),
  ).toBe(false);

  const snapshot = await tap.fixture.snapshot();
  expect(
    snapshot.state.storage.some(
      (entry) => entry.namespace === "brainrot-td",
    ),
  ).toBe(true);
  expect(
    snapshot.state.channels.find(
      (channel) => channel.roomId === tap.channelId,
    )?.messages,
  ).toEqual([]);
});
