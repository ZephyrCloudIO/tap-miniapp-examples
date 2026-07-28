import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  expectExactProvenance,
  FALLBACK_PLAYER_NAME,
  FIXTURE_USER_ID,
  FIXTURE_USER_NAME,
  hasAuthorizationDecision,
  packageEventLocalName,
  PACKAGE_ID,
  resetToLobby,
  sessionIdFromStorageKey,
} from "./brainrot-td-test-support";

test("hydrates the channel through declared storage and presence effects", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, "positive");
  await resetToLobby({ surface, tap });

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
        storageRead: hasAuthorizationDecision(ledger.entries, {
          kind: "platform",
          action: "tap.platform.storage.get",
          actionId: "storage.read",
          autonomy: "listen",
          allowed: true,
        }),
        presenceWrite: hasAuthorizationDecision(ledger.entries, {
          kind: "platform",
          action: "tap.platform.presence.join",
          actionId: "presence.write",
          autonomy: "do",
          allowed: true,
        }),
      };
    })
    .toEqual({
      play: true,
      storageRead: true,
      presenceWrite: true,
    });

  const ledger = await tap.fixture.ledger.read();
  expect(ledger.dropped).toBe(0);
  expect(
    new Set(
      ledger.entries
        .filter(
          (entry) =>
            entry.kind === "platform" && entry.operation === "storage.get",
        )
        .map((entry) =>
          typeof entry.detail === "object" &&
          entry.detail !== null &&
          !Array.isArray(entry.detail)
            ? Reflect.get(entry.detail, "namespace")
            : null,
        ),
    ),
  ).toEqual(new Set(["brainrot-td", "brainrot-td-progress"]));
  expect(
    ledger.entries.some(
      (entry) =>
        entry.kind === "platform" && entry.operation === "presence.join",
    ),
  ).toBe(true);

  const snapshot = await tap.fixture.snapshot();
  expect(snapshot.state.storage).toEqual([]);
  expect(snapshot.state.presence).toEqual([
    expect.objectContaining({
      packageId: PACKAGE_ID,
      namespace: "brainrot-td",
      room: tap.channelId,
      participants: [
        expect.objectContaining({
          displayName: FIXTURE_USER_NAME,
          state: expect.objectContaining({
            activity: "channel",
            game_id: null,
            ready: false,
            schema_version: 1,
          }),
        }),
      ],
    }),
  ]);
});

test("persists a lobby and publishes its durable package event", async ({
  surface,
  tap,
}) => {
  await resetToLobby({ surface, tap });
  await surface
    .getByRole("button", { name: "Create game", exact: true })
    .click();
  await expect(
    surface.getByRole("heading", {
      level: 1,
      name: `${FALLBACK_PLAYER_NAME}'s defense`,
      exact: true,
    }),
  ).toBeVisible();

  await expect
    .poll(async () => {
      const ledger = await tap.fixture.ledger.read();
      return {
        event: ledger.entries.some(
          (entry) => packageEventLocalName(entry) === "lobby.created",
        ),
        sessionWrite: ledger.entries.some((entry) => {
          if (
            entry.kind !== "platform" ||
            entry.operation !== "storage.set" ||
            typeof entry.detail !== "object" ||
            entry.detail === null ||
            Array.isArray(entry.detail)
          ) {
            return false;
          }
          return (
            Reflect.get(entry.detail, "namespace") === "brainrot-td" &&
            String(Reflect.get(entry.detail, "key")).includes("/sessions/")
          );
        }),
      };
    })
    .toEqual({
      event: true,
      sessionWrite: true,
    });

  await surface.getByRole("button", { name: "Ready", exact: true }).click();
  await expect
    .poll(async () => {
      const ledger = await tap.fixture.ledger.read();
      return ledger.entries.some(
        (entry) =>
          entry.kind === "platform" &&
          entry.operation === "storage.set" &&
          typeof entry.detail === "object" &&
          entry.detail !== null &&
          !Array.isArray(entry.detail) &&
          Reflect.get(entry.detail, "namespace") === "brainrot-td-commands",
      );
    })
    .toBe(true);

  const ledger = await tap.fixture.ledger.read();
  expect(ledger.dropped).toBe(0);
  const snapshot = await tap.fixture.snapshot();
  expect(new Set(snapshot.state.storage.map((entry) => entry.namespace))).toEqual(
    new Set([
      "brainrot-td",
      "brainrot-td-commands",
    ]),
  );
  expect(
    snapshot.state.channels.find(
      (channel) => channel.roomId === tap.channelId,
    )?.messages ?? [],
  ).toEqual([]);
});

test("uses a distinct deterministic entropy realm after fixture reset", async ({
  surface,
  tap,
}) => {
  const createAndReadSessionId = async (): Promise<string> => {
    await resetToLobby({ surface, tap });
    await surface
      .getByRole("button", { name: "Create game", exact: true })
      .click();
    let sessionId: string | null = null;
    await expect
      .poll(async () => {
        const snapshot = await tap.fixture.snapshot();
        sessionId =
          snapshot.state.storage
            .filter((entry) => entry.namespace === "brainrot-td")
            .map((entry) => sessionIdFromStorageKey(entry.key))
            .find((candidate): candidate is string => candidate !== null) ??
          null;
        return sessionId;
      })
      .not.toBeNull();
    return sessionId ?? "";
  };

  const first = await createAndReadSessionId();
  const second = await createAndReadSessionId();

  expect(first).not.toBe("");
  expect(second).not.toBe("");
  expect(second).not.toBe(first);
  expect(first).not.toBe(FIXTURE_USER_ID);
  expect(second).not.toBe(FIXTURE_USER_ID);
});
