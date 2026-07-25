import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  expectExactProvenance,
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
    ledger.entries.some(
      (entry) =>
        entry.kind === "host-action" &&
        entry.operation === "platform.auth.get-profile",
    ),
  ).toBe(true);
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
            role: "idle",
          }),
        }),
      ],
    }),
  ]);
});

test("persists a lobby, publishes its event, and posts channel activity", async ({
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
      name: `${FIXTURE_USER_NAME}'s defense`,
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
        message: ledger.entries.some(
          (entry) =>
            entry.kind === "host-action" &&
            entry.operation === "channels.send-message",
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
      message: true,
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
  expect(
    hasAuthorizationDecision(ledger.entries, {
      kind: "host-action",
      actionId: "channels.send-message",
      autonomy: "do",
      allowed: true,
    }),
  ).toBe(true);

  const snapshot = await tap.fixture.snapshot();
  expect(new Set(snapshot.state.storage.map((entry) => entry.namespace))).toEqual(
    new Set([
      "brainrot-td",
      "brainrot-td-commands",
    ]),
  );
  expect(snapshot.state.channels).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        roomId: tap.channelId,
        messages: expect.arrayContaining([
          expect.objectContaining({
            body: expect.stringContaining("Brainrot Tower Defense"),
            content: expect.objectContaining({
              type: "brainrot-td.activity",
              event: "lobby.created",
            }),
          }),
        ]),
      }),
    ]),
  );
});

test("replays the SDK entropy stream across an exact fixture reset", async ({
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
  expect(second).toBe(first);
  expect(first).not.toBe(FIXTURE_USER_ID);
});
