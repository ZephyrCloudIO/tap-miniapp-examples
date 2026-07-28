import {
  expect,
  test,
  type TapMiniappTestFixture,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import type { FamilyState } from "../../src/domain";
import {
  PACKAGE_ID,
  STORAGE_KEY,
  STORAGE_NAMESPACE,
  expectExactProvenance,
  hasHostAuthorizationDecision,
} from "./family-task-board-test-support";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

async function storedHousehold(tap: TapMiniappTestFixture) {
  const snapshot = await tap.fixture.snapshot();
  const record = snapshot.state.storage.find(
    (entry) =>
      entry.namespace === STORAGE_NAMESPACE && entry.key === STORAGE_KEY,
  );
  if (
    !record ||
    typeof record.value !== "object" ||
    record.value === null ||
    Array.isArray(record.value)
  ) {
    throw new Error("The family task board storage fixture is invalid.");
  }
  return {
    record,
    state: record.value as unknown as FamilyState,
  };
}

async function workflowSummary(tap: TapMiniappTestFixture) {
  const { record, state } = await storedHousehold(tap);
  return {
    balance: state.ledger.reduce(
      (total, entry) =>
        total +
        (entry.memberId === "fixture-kid-sam" ? entry.delta : 0),
      0,
    ),
    purchaseStatus: state.purchases[0]?.status ?? null,
    revision: record.revision,
    taskStatus: state.tasks[0]?.status,
  };
}

async function transferSummary(tap: TapMiniappTestFixture) {
  const { record, state } = await storedHousehold(tap);
  const balance = (memberId: string) =>
    state.ledger.reduce(
      (total, entry) =>
        total + (entry.memberId === memberId ? entry.delta : 0),
      0,
    );
  return {
    revision: record.revision,
    rileyBalance: balance("fixture-kid-riley"),
    samBalance: balance("fixture-kid-sam"),
    transferStatus: state.transfers[0]?.status ?? null,
  };
}

async function expectStorageWrites(
  tap: TapMiniappTestFixture,
  revisions: readonly number[],
) {
  const ledger = await tap.fixture.ledger.read();
  expect(ledger.dropped).toBe(0);
  expect(
    ledger.entries
      .filter(
        (entry) =>
          entry.kind === "platform" && entry.operation === "storage.set",
      )
      .map((entry) => entry.detail),
  ).toEqual(
    revisions.map((revision) => ({
      namespace: STORAGE_NAMESPACE,
      key: STORAGE_KEY,
      revision,
    })),
  );
  const storageWriteDecisions = ledger.entries.filter(
    (entry) =>
      entry.kind === "platform" &&
      entry.operation === "authorization.check" &&
      typeof entry.detail === "object" &&
      entry.detail !== null &&
      !Array.isArray(entry.detail) &&
      Reflect.get(entry.detail, "actionId") === "storage.write",
  );
  expect(storageWriteDecisions).toHaveLength(revisions.length);
  expect(
    storageWriteDecisions.every(
      (entry) =>
        typeof entry.detail === "object" &&
        entry.detail !== null &&
        !Array.isArray(entry.detail) &&
        Reflect.get(entry.detail, "allowed") === true,
    ),
  ).toBe(true);
  return ledger;
}

test("hydrates the deterministic household through the declared storage effect", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    matrixEntryId: "family-task-board-desktop-positive",
    permissionScenario: "default",
    profileId: "family-task-board-desktop",
    seed: 6929,
    theme: "light",
  });

  await expect(
    surface.getByRole("heading", { level: 1, name: "Good afternoon, Alex" }),
  ).toBeVisible();
  await expect(
    surface.getByText("Friday, July 24", { exact: true }),
  ).toBeVisible();
  await expect(
    surface.getByText("Fold the laundry", { exact: true }),
  ).toBeVisible();
  await expect(
    surface.getByText("Soccer practice", { exact: true }),
  ).toBeVisible();

  const snapshot = await tap.fixture.snapshot();
  expect(snapshot.state.storage).toEqual([
    expect.objectContaining({
      key: STORAGE_KEY,
      namespace: STORAGE_NAMESPACE,
      packageId: PACKAGE_ID,
      revision: 1,
      value: expect.objectContaining({
        familyName: "Rivera",
        members: expect.arrayContaining([
          expect.objectContaining({
            id: "fixture-kid-sam",
            name: "Sam",
          }),
        ]),
      }),
      workspaceId: tap.workspaceId,
    }),
  ]);
});

test("completes a chore and redeems its reward through persisted user workflows", async ({
  surface,
  tap,
}) => {
  await tap.control.reset();

  await surface
    .getByRole("button", { name: "View as Sam", exact: true })
    .click();
  await surface
    .getByRole("button", { name: "Mark done", exact: true })
    .click();
  await expect
    .poll(() => workflowSummary(tap))
    .toEqual({
      balance: 5,
      purchaseStatus: null,
      revision: 2,
      taskStatus: "submitted",
    });
  await expect(surface.getByText("Waiting", { exact: true })).toBeVisible();

  await surface
    .getByRole("button", { name: "View as Alex", exact: true })
    .click();
  await surface
    .getByRole("button", { name: "Approve", exact: true })
    .click();
  await expect
    .poll(() => workflowSummary(tap))
    .toEqual({
      balance: 8,
      purchaseStatus: null,
      revision: 3,
      taskStatus: "approved",
    });
  await expect(
    surface.getByRole("progressbar", { name: "100% complete", exact: true }),
  ).toBeVisible();

  await surface
    .getByRole("button", { name: "View as Sam", exact: true })
    .click();
  await surface
    .getByRole("tab", { name: "Star Shop", exact: true })
    .click();
  await surface
    .getByRole("button", { name: "Get reward", exact: true })
    .click();
  await expect
    .poll(() => workflowSummary(tap))
    .toEqual({
      balance: 4,
      purchaseStatus: "requested",
      revision: 4,
      taskStatus: "approved",
    });

  await surface
    .getByRole("button", { name: "View as Alex", exact: true })
    .click();
  await surface
    .getByRole("button", { name: "Approve", exact: true })
    .click();
  await expect(
    surface.getByRole("button", { name: "Mark ready", exact: true }),
  ).toBeVisible();
  await surface
    .getByRole("button", { name: "Mark ready", exact: true })
    .click();
  await expect(
    surface.getByRole("button", { name: "Mark used", exact: true }),
  ).toBeVisible();
  await surface
    .getByRole("button", { name: "Mark used", exact: true })
    .click();
  await expect
    .poll(() => workflowSummary(tap))
    .toEqual({
      balance: 4,
      purchaseStatus: "consumed",
      revision: 7,
      taskStatus: "approved",
    });
  await expect(
    surface.getByText("Waiting to be used", { exact: true }),
  ).toHaveCount(0);

  const beforeRemount = await storedHousehold(tap);
  const purchase = beforeRemount.state.purchases[0]!;
  expect(beforeRemount.record).toEqual({
    workspaceId: tap.workspaceId,
    packageId: PACKAGE_ID,
    namespace: STORAGE_NAMESPACE,
    key: STORAGE_KEY,
    revision: 7,
    value: {
      schemaVersion: 2,
      familyName: "Rivera",
      members: [
        {
          id: "fixture-parent-alex",
          name: "Alex",
          role: "parent",
          avatar: "A",
          color: "coral",
        },
        {
          id: "fixture-kid-sam",
          name: "Sam",
          role: "kid",
          avatar: "S",
          color: "violet",
        },
        {
          id: "fixture-kid-riley",
          name: "Riley",
          role: "kid",
          avatar: "R",
          color: "sky",
        },
      ],
      tasks: [
        {
          id: "fixture-task-laundry",
          title: "Fold the laundry",
          assigneeId: "fixture-kid-sam",
          kind: "required",
          stars: 3,
          dueLabel: "Before dinner",
          durationMinutes: 15,
          status: "approved",
        },
      ],
      events: [
        {
          id: "fixture-event-soccer",
          memberId: "fixture-kid-sam",
          title: "Soccer practice",
          timeLabel: "16:30",
          tone: "purple",
        },
      ],
      ledger: [
        {
          id: "fixture-ledger-allowance",
          memberId: "fixture-kid-sam",
          actorId: "fixture-parent-alex",
          type: "bonus",
          delta: 5,
          note: "Fixture allowance",
          createdAt: "2026-07-24T12:00:00.000Z",
        },
        {
          id: expect.stringMatching(UUID_V4),
          memberId: "fixture-kid-sam",
          actorId: "fixture-parent-alex",
          type: "chore",
          delta: 3,
          note: "Fold the laundry",
          createdAt: "2026-07-24T12:00:00.000Z",
          relatedTaskId: "fixture-task-laundry",
        },
        {
          id: expect.stringMatching(UUID_V4),
          memberId: "fixture-kid-sam",
          actorId: "fixture-kid-sam",
          type: "purchase",
          delta: -4,
          note: "Purchased Game time",
          createdAt: "2026-07-24T12:00:00.000Z",
          relatedRewardId: "fixture-reward-game",
          relatedPurchaseId: purchase.id,
        },
      ],
      shop: [
        {
          id: "fixture-reward-game",
          title: "Game time",
          description: "Thirty minutes of game time",
          cost: 4,
          icon: "🎮",
          inventory: null,
        },
      ],
      purchases: [
        {
          id: expect.stringMatching(UUID_V4),
          itemId: "fixture-reward-game",
          memberId: "fixture-kid-sam",
          status: "consumed",
          createdAt: "2026-07-24T12:00:00.000Z",
        },
      ],
      transfers: [],
      settings: {
        transferLimit: 8,
        parentApprovalThreshold: 4,
      },
    },
  });

  const ledger = await expectStorageWrites(tap, [2, 3, 4, 5, 6, 7]);
  expect(
    hasHostAuthorizationDecision(ledger.entries, {
      actionId: "family-task-board.manage",
      autonomy: "do",
      allowed: true,
    }),
  ).toBe(true);

  await tap.control.remountSurface();
  await expect(
    surface.getByRole("progressbar", { name: "100% complete", exact: true }),
  ).toBeVisible();
  await surface
    .getByRole("button", { name: "View as Sam", exact: true })
    .click();
  await surface
    .getByRole("tab", { name: "Star Shop", exact: true })
    .click();
  await expect(surface.locator(".shop-hero .star-pill")).toHaveText("4");
  await expect(
    surface.getByText("Waiting to be used", { exact: true }),
  ).toHaveCount(0);
  expect(await storedHousehold(tap)).toEqual(beforeRemount);
});

test("completes a safeguarded child-to-child transfer and reloads its ledger", async ({
  surface,
  tap,
}) => {
  await tap.control.reset();

  await surface
    .getByRole("button", { name: "View as Sam", exact: true })
    .click();
  await surface
    .getByRole("tab", { name: "Transfers", exact: true })
    .click();
  await surface.getByLabel("Send to", { exact: true }).selectOption({
    label: "Riley",
  });
  await surface
    .getByRole("spinbutton", { name: "Stars", exact: true })
    .fill("5");
  await surface.getByRole("textbox", { name: "Note", exact: true }).fill(
    "Shared game",
  );
  await surface
    .getByRole("button", { name: "Propose transfer", exact: true })
    .click();
  await expect
    .poll(() => transferSummary(tap))
    .toEqual({
      revision: 2,
      rileyBalance: 0,
      samBalance: 5,
      transferStatus: "proposed",
    });

  await surface
    .getByRole("button", { name: "Confirm send", exact: true })
    .click();
  await expect
    .poll(() => transferSummary(tap))
    .toEqual({
      revision: 3,
      rileyBalance: 0,
      samBalance: 5,
      transferStatus: "sender-confirmed",
    });

  await surface
    .getByRole("button", { name: "View as Riley", exact: true })
    .click();
  await surface
    .getByRole("button", { name: "Accept", exact: true })
    .click();
  await expect
    .poll(() => transferSummary(tap))
    .toEqual({
      revision: 4,
      rileyBalance: 0,
      samBalance: 5,
      transferStatus: "awaiting-parent",
    });

  await surface
    .getByRole("button", { name: "View as Alex", exact: true })
    .click();
  await surface
    .getByRole("button", { name: "Approve", exact: true })
    .click();
  await expect
    .poll(() => transferSummary(tap))
    .toEqual({
      revision: 5,
      rileyBalance: 5,
      samBalance: 0,
      transferStatus: "completed",
    });

  const beforeRemount = await storedHousehold(tap);
  const transfer = beforeRemount.state.transfers[0]!;
  expect(beforeRemount.record.revision).toBe(5);
  expect(beforeRemount.state.tasks).toEqual([
    expect.objectContaining({
      id: "fixture-task-laundry",
      status: "open",
    }),
  ]);
  expect(beforeRemount.state.purchases).toEqual([]);
  expect(transfer).toEqual({
    id: expect.stringMatching(UUID_V4),
    senderId: "fixture-kid-sam",
    receiverId: "fixture-kid-riley",
    amount: 5,
    note: "Shared game",
    status: "completed",
    senderConfirmedAt: "2026-07-24T12:00:00.000Z",
    receiverConfirmedAt: "2026-07-24T12:00:00.000Z",
    parentConfirmedAt: "2026-07-24T12:00:00.000Z",
    createdAt: "2026-07-24T12:00:00.000Z",
  });
  expect(beforeRemount.state.ledger).toEqual([
    {
      id: "fixture-ledger-allowance",
      memberId: "fixture-kid-sam",
      actorId: "fixture-parent-alex",
      type: "bonus",
      delta: 5,
      note: "Fixture allowance",
      createdAt: "2026-07-24T12:00:00.000Z",
    },
    {
      id: expect.stringMatching(UUID_V4),
      memberId: "fixture-kid-sam",
      actorId: "fixture-kid-sam",
      type: "transfer-out",
      delta: -5,
      note: "Shared game",
      createdAt: "2026-07-24T12:00:00.000Z",
      relatedTransferId: transfer.id,
    },
    {
      id: expect.stringMatching(UUID_V4),
      memberId: "fixture-kid-riley",
      actorId: "fixture-kid-sam",
      type: "transfer-in",
      delta: 5,
      note: "Shared game",
      createdAt: "2026-07-24T12:00:00.000Z",
      relatedTransferId: transfer.id,
    },
  ]);

  const ledger = await expectStorageWrites(tap, [2, 3, 4, 5]);
  expect(
    hasHostAuthorizationDecision(ledger.entries, {
      actionId: "family-task-board.manage",
      autonomy: "do",
      allowed: true,
    }),
  ).toBe(true);

  await tap.control.remountSurface();
  await surface
    .getByRole("button", { name: "View as Riley", exact: true })
    .click();
  await surface
    .getByRole("tab", { name: "Transfers", exact: true })
    .click();
  await expect(
    surface.getByText("Sam → Riley · 5 stars", { exact: true }),
  ).toBeVisible();
  await expect(surface.getByText("completed", { exact: true })).toBeVisible();
  expect(await storedHousehold(tap)).toEqual(beforeRemount);
});

test("persists deterministic transfer safeguards through allowed storage rails", async ({
  surface,
  tap,
}) => {
  await tap.control.reset();
  await surface.getByRole("tab", { name: "Manage", exact: true }).click();

  await surface
    .getByRole("spinbutton", { name: "Maximum transfer (optional)" })
    .fill("12");
  await surface
    .getByRole("spinbutton", { name: "Require parent above (optional)" })
    .fill("6");
  await surface
    .getByRole("button", { name: "Save transfer safeguards", exact: true })
    .click();

  await expect
    .poll(async () => {
      const snapshot = await tap.fixture.snapshot();
      const record = snapshot.state.storage.find(
        (entry) =>
          entry.namespace === STORAGE_NAMESPACE && entry.key === STORAGE_KEY,
      );
      return {
        revision: record?.revision,
        settings:
          typeof record?.value === "object" && record.value !== null
            ? Reflect.get(record.value, "settings")
            : undefined,
      };
    })
    .toEqual({
      revision: 2,
      settings: {
        transferLimit: 12,
        parentApprovalThreshold: 6,
      },
    });

  const ledger = await tap.fixture.ledger.read();
  expect(ledger.dropped).toBe(0);
  expect(
    hasHostAuthorizationDecision(ledger.entries, {
      actionId: "family-task-board.manage",
      autonomy: "do",
      allowed: true,
    }),
  ).toBe(true);
  expect(ledger.entries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "platform",
        operation: "authorization.check",
        detail: expect.objectContaining({
          actionId: "storage.read",
          allowed: true,
        }),
      }),
      expect.objectContaining({
        kind: "platform",
        operation: "authorization.check",
        detail: expect.objectContaining({
          actionId: "storage.write",
          allowed: true,
        }),
      }),
      expect.objectContaining({
        kind: "platform",
        operation: "storage.set",
        detail: expect.objectContaining({
          key: STORAGE_KEY,
          namespace: STORAGE_NAMESPACE,
          revision: 2,
        }),
      }),
    ]),
  );
});
