import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  CHANNEL_ID,
  CHANNEL_STORAGE_KEY,
  PACKAGE_ID,
  SEEDED_SPECIALIST_ID,
  STORAGE_NAMESPACE,
  WORKFLOW_ID,
  channelStorageRecord,
  expectExactProvenance,
  expectReadySurface,
  hasAuthorizationDecision,
  hasOperation,
  openContext,
  openSettings,
  preferenceStorageRecords,
} from "./unofficial-suno-player-test-support";

test("hydrates channel state through the declared identity, channel, and storage authorities", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    matrixEntryId: "unofficial-suno-player-desktop-positive",
    permissionScenario: "default",
    profileId: "unofficial-suno-player-desktop",
    seed: 6929,
    theme: "light",
  });
  await expectReadySurface(surface);

  await expect
    .poll(async () => {
      const ledger = await tap.fixture.ledger.read();
      return {
        surfaceView: hasAuthorizationDecision(ledger.entries, {
          actionId: "suno-player.view",
          allowed: true,
          kind: "host-action",
        }),
        channelList: hasAuthorizationDecision(ledger.entries, {
          actionId: "channels.list",
          allowed: true,
          kind: "host-action",
        }),
        channelRead: hasAuthorizationDecision(ledger.entries, {
          actionId: "channels.read",
          allowed: true,
          kind: "host-action",
        }),
        profileRead: hasAuthorizationDecision(ledger.entries, {
          actionId: "profile.read",
          allowed: true,
          kind: "host-action",
        }),
        storageRead: hasAuthorizationDecision(ledger.entries, {
          actionId: "storage.read",
          allowed: true,
          kind: "platform",
        }),
      };
    })
    .toEqual({
      surfaceView: true,
      channelList: true,
      channelRead: true,
      profileRead: true,
      storageRead: true,
    });

  const ledger = await tap.fixture.ledger.read();
  expect(ledger.dropped).toBe(0);
  expect(hasOperation(ledger.entries, "host-action", "channels.list"))
    .toBe(true);
  expect(hasOperation(ledger.entries, "host-action", "channels.get-access"))
    .toBe(true);
  expect(
    hasOperation(
      ledger.entries,
      "host-action",
      "platform.auth.get-profile",
    ),
  ).toBe(true);
  expect(
    ledger.entries.filter(
      (entry) =>
        entry.kind === "platform" && entry.operation === "storage.get",
    ),
  ).toHaveLength(2);

  const snapshot = await tap.fixture.snapshot();
  expect(channelStorageRecord(snapshot)).toEqual(
    expect.objectContaining({
      key: CHANNEL_STORAGE_KEY,
      namespace: STORAGE_NAMESPACE,
      packageId: PACKAGE_ID,
      revision: 1,
      value: expect.objectContaining({
        channelId: CHANNEL_ID,
        enabled: true,
      }),
    }),
  );
  expect(preferenceStorageRecords(snapshot)).toEqual([]);
});

test("notifies the channel before consent and reads only an explicitly requested timeline", async ({
  surface,
  tap,
}) => {
  await openContext(surface);
  await surface
    .getByRole("button", {
      name: "Enable and notify channel",
      exact: true,
    })
    .click();
  await expect(
    surface.getByText("Enabled with notice", { exact: true }),
  ).toBeVisible();

  await surface
    .getByRole("button", {
      name: "Load visible TAP timeline",
      exact: true,
    })
    .click();
  await expect(
    surface.getByText(
      "The team celebrated a calm launch and wants an instrumental victory theme.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    surface.getByText(
      "Keep private names and customer details out of every song brief.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    surface.getByText("0 excerpts selected", { exact: true }),
  ).toBeVisible();

  const snapshot = await tap.fixture.snapshot();
  expect(channelStorageRecord(snapshot)).toEqual(
    expect.objectContaining({
      revision: 2,
      value: expect.objectContaining({
        consent: {
          conversationContextEnabled: true,
          notifiedAt: "2026-07-24T12:00:00.000Z",
        },
      }),
    }),
  );
  expect(
    snapshot.state.channels.find(
      (channel) => channel.roomId === CHANNEL_ID,
    )?.messages,
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        body: expect.stringContaining(
          "conversation context is now enabled",
        ),
      }),
    ]),
  );

  const ledger = await tap.fixture.ledger.read();
  expect(
    hasAuthorizationDecision(ledger.entries, {
      actionId: "channels.send-message",
      allowed: true,
      kind: "host-action",
    }),
  ).toBe(true);
  expect(
    ledger.entries.filter(
      (entry) =>
        entry.kind === "host-action" &&
        entry.operation === "channels.get-timeline",
    ),
  ).toHaveLength(1);
});

test("lists and invokes a deterministic saved workflow while making the specialist fixture gap visible", async ({
  surface,
  tap,
}) => {
  await openContext(surface);

  await expect
    .poll(async () => {
      const ledger = await tap.fixture.ledger.read();
      return {
        specialistList: hasAuthorizationDecision(ledger.entries, {
          actionId: "specialists.list",
          allowed: true,
          kind: "host-action",
        }),
        workflowList: hasAuthorizationDecision(ledger.entries, {
          actionId: "workflows.list",
          allowed: true,
          kind: "host-action",
        }),
      };
    })
    .toEqual({
      specialistList: true,
      workflowList: true,
    });

  const specialistSelect = surface.getByLabel("Specialist");
  await expect(specialistSelect).toBeDisabled();
  expect(await specialistSelect.locator("option").allTextContents()).toEqual([
    "Select a TAP specialist",
  ]);
  expect(
    (await tap.fixture.snapshot()).state.specialists,
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: SEEDED_SPECIALIST_ID,
      }),
    ]),
  );

  await surface.getByLabel("Saved workflow").selectOption(WORKFLOW_ID);
  await surface
    .getByRole("button", {
      name: "Invoke saved workflow",
      exact: true,
    })
    .click();
  await expect(
    surface.getByText("Workflow accepted by TAP", { exact: true }),
  ).toBeVisible();
  await expect(
    surface.getByText(
      /completed: Fixture summary preparation completed.*fixture-manual-brief-run/u,
    ),
  ).toBeVisible();

  const ledger = await tap.fixture.ledger.read();
  expect(
    hasAuthorizationDecision(ledger.entries, {
      actionId: "workflows.invoke",
      allowed: true,
      kind: "host-action",
    }),
  ).toBe(true);
  expect(hasOperation(ledger.entries, "host-action", "workflows.invoke"))
    .toBe(true);
});

test("persists opt-in listening presence through separately governed storage and presence rails", async ({
  surface,
  tap,
}) => {
  await openSettings(surface);
  await surface
    .getByRole("checkbox", {
      name: /Broadcast my listening or paused state/u,
    })
    .check();

  await expect
    .poll(async () => {
      const snapshot = await tap.fixture.snapshot();
      const listeningRoom = snapshot.state.presence.find(
        (entry) =>
          entry.namespace === STORAGE_NAMESPACE &&
          entry.room === `channel/${CHANNEL_ID}/listening`,
      );
      return {
        preferenceBroadcast:
          preferenceStorageRecords(snapshot).some(
            (entry) =>
              typeof entry.value === "object" &&
              entry.value !== null &&
              !Array.isArray(entry.value) &&
              Reflect.get(entry.value, "broadcastPresence") === true,
          ),
        participantIds: [
          ...(listeningRoom?.participants.map(
            (participant) => participant.participantId,
          ) ?? []),
        ].sort(),
      };
    })
    .toEqual({
      preferenceBroadcast: true,
      participantIds: [
        "fixture-listener-reviewer",
        "tap-fixture-user-v1",
      ],
    });

  await expect
    .poll(async () => {
      const credentialLedger = await tap.fixture.ledger.read();
      return {
        credentialsRead: hasAuthorizationDecision(credentialLedger.entries, {
          actionId: "credentials.read",
          allowed: true,
          kind: "platform",
        }),
        credentialsList: hasOperation(
          credentialLedger.entries,
          "native",
          "credentials.list",
        ),
      };
    })
    .toEqual({
      credentialsRead: true,
      credentialsList: true,
    });
  const ledger = await tap.fixture.ledger.read();
  expect(
    hasAuthorizationDecision(ledger.entries, {
      actionId: "storage.write",
      allowed: true,
      kind: "platform",
    }),
  ).toBe(true);
  expect(
    hasAuthorizationDecision(ledger.entries, {
      actionId: "presence.write",
      allowed: true,
      kind: "platform",
    }),
  ).toBe(true);
  expect(hasOperation(ledger.entries, "platform", "presence.join")).toBe(true);
});

test("replays fixed clock and entropy across a full fixture reset", async ({
  surface,
  tap,
}) => {
  const enableAndRead = async (): Promise<{
    readonly channel: unknown;
    readonly notice: unknown;
  }> => {
    await openContext(surface);
    await surface
      .getByRole("button", {
        name: "Enable and notify channel",
        exact: true,
      })
      .click();
    await expect(
      surface.getByText("Enabled with notice", { exact: true }),
    ).toBeVisible();
    const snapshot = await tap.fixture.snapshot();
    return {
      channel: channelStorageRecord(snapshot),
      notice: snapshot.state.channels
        .find((channel) => channel.roomId === CHANNEL_ID)
        ?.messages.at(-1),
    };
  };

  const first = await enableAndRead();
  await tap.control.reset();
  await expectReadySurface(surface);
  const second = await enableAndRead();

  expect(second).toEqual(first);
});
