import {
  expect,
  test,
  type TapRstestFixtures,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  configureFixtureWorkflow,
  expectExactProvenance,
  expectFixtureHttpCredentialBound,
  expectReadySurface,
  FIXTURE_CHANNEL_ID,
  GITHUB_EVIDENCE_URL,
  hasAuthorizationDecision,
  openHttpCollection,
  openPlatform,
  packageEventLocalName,
  requireSingleCredentialAlias,
  seedUnprovisioned,
  selectFixtureCredential,
  STORAGE_KEY,
  STORAGE_NAMESPACE,
} from "./pyre-test-support";

type TapSurface = TapRstestFixtures["surface"];
const RUNTIME_UUID =
  /^(?:audit|evidence)_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function fixtureObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function saveFixtureReference(surface: TapSurface): Promise<void> {
  await surface
    .getByRole("button", { name: /^Evidence(?:\s+\d+)?$/u })
    .click();
  await surface
    .getByRole("button", { name: "Add Evidence", exact: true })
    .click();
  await surface.getByLabel("Evidence title").fill("Fixture incident ticket");
  await surface
    .getByLabel("Source URL or stable locator")
    .fill("https://status.example.com/incidents/fixture-ticket");
  await surface
    .getByLabel("Description")
    .fill("Deterministic ticket reference for the incident.");
  await surface
    .getByRole("button", { name: "Save Reference", exact: true })
    .click();
  await expect(
    surface.getByText("Evidence reference saved.", { exact: true }),
  ).toBeVisible();
}

test("hydrates deterministic investigation state, publishes its mount, and persists a reference", async ({
  surface,
  tap,
}) => {
  const credentialAlias = requireSingleCredentialAlias(tap);
  expectExactProvenance(tap, {
    matrixEntryId: "pyre-desktop-positive",
    permissionScenario: "default",
    profileId: "pyre-desktop",
    seed: 6929,
    theme: "light",
    credentialAliases: [credentialAlias],
  });
  await expectReadySurface(surface);
  await expect(surface.getByText("3 present", { exact: true })).toBeVisible();
  await surface
    .getByRole("button", { name: /^Evidence(?:\s+\d+)?$/u })
    .click();
  await expect(
    surface.getByText("Checkout error-rate alert", { exact: true }),
  ).toBeVisible();

  await expect
    .poll(async () =>
      (await tap.fixture.ledger.read()).entries.some(
        (entry) => packageEventLocalName(entry) === "pyre.surface.mounted",
      ),
    )
    .toBe(true);

  await saveFixtureReference(surface);

  await expect
    .poll(async () => {
      const snapshot = await tap.fixture.snapshot();
      const record = snapshot.state.storage.find(
        (entry) =>
          entry.namespace === STORAGE_NAMESPACE && entry.key === STORAGE_KEY,
      );
      const investigations =
        typeof record?.value === "object" &&
        record.value !== null &&
        !Array.isArray(record.value)
          ? Reflect.get(record.value, "investigations")
          : undefined;
      const evidence = Array.isArray(investigations)
        ? Reflect.get(investigations[0], "evidence")
        : undefined;
      return {
        evidenceCount: Array.isArray(evidence) ? evidence.length : 0,
        revision: record?.revision,
      };
    })
    .toEqual({ evidenceCount: 2, revision: 2 });

  expect(
    hasAuthorizationDecision((await tap.fixture.ledger.read()).entries, {
      actionId: "pyre.investigate",
      allowed: true,
      autonomy: "plan",
      kind: "host-action",
    }),
  ).toBe(true);
});

test("replays exact fixture semantics with fresh runtime IDs after reset", async ({
  surface,
  tap,
}) => {
  const mutateAndSnapshot = async () => {
    await expectReadySurface(surface);
    await saveFixtureReference(surface);
    const state = (await tap.fixture.snapshot()).state;
    const record = state.storage.find(
      (entry) =>
        entry.namespace === STORAGE_NAMESPACE && entry.key === STORAGE_KEY,
    );
    const value = fixtureObject(record?.value);
    const investigations = value?.investigations;
    const investigation = Array.isArray(investigations)
      ? investigations
          .map(fixtureObject)
          .find((candidate) => candidate?.id === "inc_fixture_checkout")
      : undefined;
    const evidence = Array.isArray(investigation?.evidence)
      ? investigation.evidence
          .map(fixtureObject)
          .find(
            (candidate) =>
              candidate?.title === "Fixture incident ticket",
          )
      : undefined;
    const audit = Array.isArray(investigation?.audit)
      ? investigation.audit
          .map(fixtureObject)
          .find(
            (candidate) =>
              candidate?.action === "evidence.created" &&
              candidate?.summary ===
                "Fixture incident ticket (reference)",
          )
      : undefined;
    const evidenceId = evidence?.id;
    const auditId = audit?.id;
    expect(evidenceId).toMatch(RUNTIME_UUID);
    expect(auditId).toMatch(RUNTIME_UUID);
    expect(audit?.entityId).toBe(evidenceId);
    if (typeof evidenceId !== "string" || typeof auditId !== "string") {
      throw new Error("The reference mutation did not create runtime IDs.");
    }

    const surfacePresenceIds = state.presence
      .flatMap((entry) => [
        entry.selfParticipantId,
        ...entry.participants.map((participant) => participant.participantId),
      ])
      .filter((id) => id.startsWith("tap-fixture-presence:"))
      .filter((id, index, ids) => ids.indexOf(id) === index);
    expect(surfacePresenceIds).toHaveLength(1);
    const surfacePresenceId = surfacePresenceIds[0];
    if (!surfacePresenceId) {
      throw new Error("The mounted surface presence identity is missing.");
    }

    const normalizedState = JSON.parse(
      JSON.stringify(state, (_key, valueToNormalize) => {
        if (valueToNormalize === evidenceId) return "<runtime-evidence-id>";
        if (valueToNormalize === auditId) return "<runtime-audit-id>";
        if (valueToNormalize === surfacePresenceId) {
          return "<surface-presence-id>";
        }
        return valueToNormalize;
      }),
    ) as unknown;
    return {
      normalizedState,
      runtimeIds: { auditId, evidenceId, surfacePresenceId },
    };
  };

  const first = await mutateAndSnapshot();
  await tap.control.reset();
  const second = await mutateAndSnapshot();
  expect(second.normalizedState).toEqual(first.normalizedState);
  expect(second.runtimeIds.auditId).not.toBe(first.runtimeIds.auditId);
  expect(second.runtimeIds.evidenceId).not.toBe(
    first.runtimeIds.evidenceId,
  );
  expect(second.runtimeIds.surfacePresenceId).not.toBe(
    first.runtimeIds.surfacePresenceId,
  );
});

test("authorizes and persists an approved report revision", async ({
  surface,
  tap,
}) => {
  await expectReadySurface(surface);
  await surface
    .getByRole("button", { name: "Reports", exact: true })
    .click();
  await surface
    .getByRole("button", { name: "Create Revision", exact: true })
    .click();
  await surface
    .getByRole("button", { name: "Create Draft Revision", exact: true })
    .click();
  await expect(
    surface.getByText(
      "Report revision created from current structured state.",
      { exact: true },
    ),
  ).toBeVisible();
  await surface.getByRole("button", { name: "Done", exact: true }).click();
  await surface.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(
    surface.getByText("Report revision approved.", { exact: true }),
  ).toBeVisible();

  const snapshot = await tap.fixture.snapshot();
  const record = snapshot.state.storage.find(
    (entry) =>
      entry.namespace === STORAGE_NAMESPACE && entry.key === STORAGE_KEY,
  );
  const investigations =
    typeof record?.value === "object" &&
    record.value !== null &&
    !Array.isArray(record.value)
      ? Reflect.get(record.value, "investigations")
      : undefined;
  const reports = Array.isArray(investigations)
    ? Reflect.get(investigations[0], "reports")
    : undefined;
  expect({
    reportStatus: Array.isArray(reports)
      ? Reflect.get(reports[0], "status")
      : undefined,
    revision: record?.revision,
  }).toEqual({
    reportStatus: "approved",
    revision: 3,
  });

  const ledger = await tap.fixture.ledger.read();
  expect(
    hasAuthorizationDecision(ledger.entries, {
      actionId: "pyre.investigate",
      allowed: true,
      autonomy: "plan",
      kind: "host-action",
    }),
  ).toBe(true);
  expect(
    hasAuthorizationDecision(ledger.entries, {
      actionId: "pyre.approve",
      allowed: true,
      autonomy: "listen",
      kind: "host-action",
    }),
  ).toBe(true);
});

test("provisions project and channel rails from an unbound investigation", async ({
  surface,
  tap,
}) => {
  const baseline = await seedUnprovisioned(tap);
  await openPlatform(surface);
  await surface
    .getByRole("button", { name: "Provision Workspace", exact: true })
    .click();
  await expect(
    surface.getByText(
      "Private TAP project, channel, and available VFS folders provisioned.",
      { exact: true },
    ),
  ).toBeVisible();

  const snapshot = await tap.fixture.snapshot();
  const project = snapshot.state.projects.find(
    (candidate) =>
      !baseline.projects.some((existing) => existing.id === candidate.id),
  );
  expect(project).toMatchObject({
    discoverable: false,
    name: "Pyre — Checkout API elevated errors",
  });
  expect(
    snapshot.state.projects.filter(
      (candidate) =>
        !baseline.projects.some((existing) => existing.id === candidate.id),
    ),
  ).toHaveLength(1);
  const channel = snapshot.state.channels.find(
    (candidate) =>
      !baseline.channels.some(
        (existing) => existing.roomId === candidate.roomId,
      ),
  );
  expect(channel).toMatchObject({
    archived: false,
    title: expect.stringMatching(/^pyre-/u),
  });
  expect(
    snapshot.state.channels.filter(
      (candidate) =>
        !baseline.channels.some(
          (existing) => existing.roomId === candidate.roomId,
        ),
    ),
  ).toHaveLength(1);
  expect(channel?.messages).toHaveLength(1);

  const ledger = await tap.fixture.ledger.read();
  for (const actionId of [
    "projects.create",
    "channels.create",
    "channels.send-message",
  ]) {
    expect(
      hasAuthorizationDecision(ledger.entries, {
        actionId,
        allowed: true,
        kind: "host-action",
      }),
    ).toBe(true);
  }
});

test("joins the package specialist, posts a checkpoint, and invokes a saved workflow", async ({
  surface,
  tap,
}) => {
  await openPlatform(surface);
  await surface
    .getByRole("button", { name: "Join Pyre Specialist", exact: true })
    .click();
  await expect(
    surface.getByText(
      "Package-owned Pyre specialist joined the investigation channel.",
      { exact: true },
    ),
  ).toBeVisible();
  await surface
    .getByRole("button", { name: "Post Checkpoint", exact: true })
    .click();
  await expect(
    surface.getByText(
      "Checkpoint posted to the linked investigation channel.",
      { exact: true },
    ),
  ).toBeVisible();

  await configureFixtureWorkflow(surface);
  await surface
    .getByRole("button", { name: "Invoke Workflow", exact: true })
    .click();
  await expect(
    surface.getByText("Workflow started: pyre-fixture-run.", { exact: true }),
  ).toBeVisible();

  const snapshot = await tap.fixture.snapshot();
  const channel = snapshot.state.channels.find(
    (candidate) => candidate.roomId === FIXTURE_CHANNEL_ID,
  );
  expect(channel?.messages).toHaveLength(1);
  expect(channel?.specialistIds).toHaveLength(1);
  expect(snapshot.state.specialists).toHaveLength(1);
  expect(snapshot.state.specialists[0]?.id).toBe(
    "pyre-investigation-specialist",
  );

  const ledger = await tap.fixture.ledger.read();
  for (const actionId of [
    "channels.manage-specialists",
    "channels.send-message",
    "workflows.invoke",
  ]) {
    expect(
      hasAuthorizationDecision(ledger.entries, {
        actionId,
        allowed: true,
        kind: "host-action",
      }),
    ).toBe(true);
  }
});

test("captures governed GitHub evidence and its receipt through VFS", async ({
  surface,
  tap,
}) => {
  await openPlatform(surface);
  await openHttpCollection(surface);
  const credentialAlias = requireSingleCredentialAlias(tap);
  await expectFixtureHttpCredentialBound(tap, credentialAlias);
  await selectFixtureCredential(surface, credentialAlias);
  await surface
    .getByRole("checkbox", {
      name: /Approve this exact read-only request/u,
    })
    .check();
  await expect(
    surface.getByRole("button", { name: "Collect & Capture", exact: true }),
  ).toBeEnabled();
  await surface
    .getByRole("button", { name: "Collect & Capture", exact: true })
    .click();
  await expect(
    surface.getByText(
      "Governed HTTP evidence and receipt captured in VFS.",
      { exact: true },
    ),
  ).toBeVisible();

  const captures = await tap.fixture.http.requests();
  expect(captures).toEqual({
    dropped: 0,
    requests: [
      expect.objectContaining({
        matched: true,
        request: expect.objectContaining({
          method: "GET",
          url: GITHUB_EVIDENCE_URL,
          headers: [
            {
              name: "accept",
              value: "application/vnd.github+json",
            },
            {
              name: "x-github-api-version",
              value: "2022-11-28",
            },
          ],
        }),
      }),
    ],
  });
  const snapshot = await tap.fixture.snapshot();
  expect(snapshot.state.vfsFiles).toHaveLength(2);
  expect(
    snapshot.state.vfsFiles.map((entry) => entry.conversationId),
  ).toEqual([FIXTURE_CHANNEL_ID, FIXTURE_CHANNEL_ID]);
  expect(
    snapshot.state.vfsFiles.map((entry) => entry.path).toSorted(),
  ).toEqual([
    expect.stringMatching(/\/evidence\/evidence_[^/]+-github-api-response$/u),
    expect.stringMatching(/\/receipts\/evidence_[^/]+\.json$/u),
  ]);
  const record = snapshot.state.storage.find(
    (entry) =>
      entry.namespace === STORAGE_NAMESPACE && entry.key === STORAGE_KEY,
  );
  expect(record?.revision).toBe(2);

  const ledger = await tap.fixture.ledger.read();
  expect(
    hasAuthorizationDecision(ledger.entries, {
      actionId: "network.request",
      allowed: true,
      kind: "platform",
    }),
  ).toBe(true);
  expect(
    hasAuthorizationDecision(ledger.entries, {
      actionId: "vfs.write",
      allowed: true,
      kind: "host-action",
    }),
  ).toBe(true);
});
