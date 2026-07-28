import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  PACKAGE_ID,
  SEEDED_SPECIALIST_ID,
  STORAGE_NAMESPACE,
  WORKFLOW_ID,
  channelListeningRoom,
  channelStorageRecord,
  channelStorageKey,
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
  expect(channelStorageRecord(snapshot, tap.channelId)).toEqual(
    expect.objectContaining({
      key: channelStorageKey(tap.channelId),
      namespace: STORAGE_NAMESPACE,
      packageId: PACKAGE_ID,
      revision: 1,
      value: expect.objectContaining({
        channelId: tap.channelId,
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
  expect(channelStorageRecord(snapshot, tap.channelId)).toEqual(
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
      (channel) => channel.roomId === tap.channelId,
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

  const specialistSelect = surface.getByLabel("Specialist", { exact: true });
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
  const presenceCheckbox = surface.getByRole("checkbox", {
    name: /Broadcast my listening or paused state/u,
  });
  await presenceCheckbox.click();
  await expect(presenceCheckbox).toBeChecked();

  await expect
    .poll(async () => {
      const snapshot = await tap.fixture.snapshot();
      const listeningRoom = snapshot.state.presence.find(
        (entry) =>
          entry.namespace === STORAGE_NAMESPACE &&
          entry.room === channelListeningRoom(tap.channelId),
      );
      const selfParticipantId = listeningRoom?.selfParticipantId ?? "";
      const participantIds =
        listeningRoom?.participants.map(
          (participant) => participant.participantId,
        ) ?? [];
      return {
        preferenceBroadcast:
          preferenceStorageRecords(snapshot).some(
            (entry) =>
              typeof entry.value === "object" &&
              entry.value !== null &&
              !Array.isArray(entry.value) &&
              Reflect.get(entry.value, "broadcastPresence") === true,
          ),
        fixtureListenerPresent: participantIds.includes(
          "fixture-listener-reviewer",
        ),
        participantCount: participantIds.length,
        selfParticipantId,
        selfParticipantPresent:
          selfParticipantId.length > 0 &&
          participantIds.includes(selfParticipantId),
      };
    })
    .toEqual({
      preferenceBroadcast: true,
      fixtureListenerPresent: true,
      participantCount: 2,
      selfParticipantId: expect.stringMatching(/\S/u),
      selfParticipantPresent: true,
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

test("discovers an empty metadata-only credential vault without issuing HTTP", async ({
  surface,
  tap,
}) => {
  await openSettings(surface);
  await expect(
    surface.getByText(
      "0 metadata-only HTTP credential references are visible. Secret values never enter miniapp JavaScript.",
      { exact: true },
    ),
  ).toBeVisible();

  const ledger = await tap.fixture.ledger.read();
  expect(
    hasAuthorizationDecision(ledger.entries, {
      actionId: "credentials.read",
      allowed: true,
      kind: "platform",
    }),
  ).toBe(true);
  expect(hasOperation(ledger.entries, "native", "credentials.list")).toBe(true);
  expect(await tap.fixture.http.requests()).toEqual({
    dropped: 0,
    requests: [],
  });
});

test("keeps fixed clock while allocating distinct host-scoped entropy after a full fixture reset", async ({
  surface,
  tap,
}) => {
  const enableAndRead = async (): Promise<{
    readonly normalized: {
      readonly channel: unknown;
      readonly notice: unknown;
    };
    readonly operationId: string;
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
    const channel = channelStorageRecord(snapshot, tap.channelId);
    const notice = snapshot.state.channels
      .find((candidate) => candidate.roomId === tap.channelId)
      ?.messages.at(-1);
    const channelValue =
      typeof channel?.value === "object" &&
      channel.value !== null &&
      !Array.isArray(channel.value)
        ? channel.value
        : null;
    const appliedOperationIds = channelValue
      ? Reflect.get(channelValue, "appliedOperationIds")
      : null;
    expect(channel).toEqual(
      expect.objectContaining({
        key: channelStorageKey(tap.channelId),
        value: expect.objectContaining({
          channelId: tap.channelId,
        }),
      }),
    );
    expect(notice).toEqual(
      expect.objectContaining({
        body: expect.stringMatching(/\S/u),
        messageId: expect.stringMatching(/\S/u),
      }),
    );
    expect(appliedOperationIds).toEqual([
      expect.stringMatching(
        /^enable-context-state:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
      ),
    ]);
    if (
      !channel ||
      !channelValue ||
      !Array.isArray(appliedOperationIds) ||
      typeof appliedOperationIds[0] !== "string"
    ) {
      throw new Error("The channel operation ID was not persisted.");
    }
    return {
      normalized: {
        channel: {
          ...channel,
          value: {
            ...channelValue,
            appliedOperationIds: [],
          },
        },
        notice,
      },
      operationId: appliedOperationIds[0],
    };
  };

  const first = await enableAndRead();
  await tap.control.reset();
  await expectReadySurface(surface);
  const second = await enableAndRead();

  expect(second.normalized).toEqual(first.normalized);
  expect(second.operationId).not.toBe(first.operationId);
});
