import {
  expect,
  test,
  type TapRstestFixtures,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  expectExactProvenance,
  expectReadySurface,
  FIXTURE_CHANNEL_ID,
  GITHUB_CREDENTIAL_DISPLAY_NAME,
  GITHUB_EVIDENCE_URL,
  hasAuthorizationDecision,
  openHttpCollection,
  openPlatform,
  requireSingleCredentialAlias,
  seedUnprovisioned,
  STORAGE_KEY,
  STORAGE_NAMESPACE,
} from "./pyre-test-support";

type TapSurface = TapRstestFixtures["surface"];

async function saveFixtureReference(surface: TapSurface): Promise<void> {
  await surface
    .getByRole("button", { name: "Evidence", exact: true })
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
  await expect(surface.getByText("2 present", { exact: true })).toBeVisible();
  await surface
    .getByRole("button", { name: "Evidence", exact: true })
    .click();
  await expect(
    surface.getByText("Checkout error-rate alert", { exact: true }),
  ).toBeVisible();

  await expect
    .poll(async () =>
      (await tap.fixture.ledger.read()).entries.some(
        (entry) =>
          entry.kind === "event" &&
          entry.operation === "pyre.surface.mounted",
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

test("replays a runtime-ID mutation to the exact full fixture state after reset", async ({
  surface,
  tap,
}) => {
  const mutateAndSnapshot = async () => {
    await expectReadySurface(surface);
    await saveFixtureReference(surface);
    return (await tap.fixture.snapshot()).state;
  };

  const first = await mutateAndSnapshot();
  await tap.control.reset();
  const second = await mutateAndSnapshot();
  expect(second).toEqual(first);
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
  await seedUnprovisioned(tap);
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
  expect(snapshot.state.projects).toHaveLength(1);
  expect(snapshot.state.projects[0]).toMatchObject({
    discoverable: false,
    name: "Pyre — Checkout API elevated errors",
  });
  expect(snapshot.state.channels).toHaveLength(1);
  expect(snapshot.state.channels[0]).toMatchObject({
    archived: false,
    title: expect.stringMatching(/^pyre-/u),
  });
  expect(snapshot.state.channels[0]?.messages).toHaveLength(1);

  const ledger = await tap.fixture.ledger.read();
  for (const actionId of [
    "projects.create",
    "channels.create",
    "projects.update",
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

test("installs the specialist, posts a checkpoint, and invokes a saved workflow", async ({
  surface,
  tap,
}) => {
  await openPlatform(surface);
  await surface
    .getByRole("button", { name: "Install & Join", exact: true })
    .click();
  await expect(
    surface.getByText(
      "Pyre specialist installed and joined to the investigation channel.",
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

  await surface
    .getByRole("button", { name: "Configure Collection", exact: true })
    .click();
  await surface
    .getByLabel("Saved workflow")
    .selectOption("pyre-fixture-collection");
  await surface
    .getByLabel("Claim or timeline gap")
    .fill("Determine whether the deployment preceded the elevated errors.");
  await surface.getByLabel("Authorized source").fill("checkout deployment");
  await surface.getByLabel("Time window start").fill("2026-07-24T11:25");
  await surface.getByLabel("Time window end").fill("2026-07-24T11:45");
  await surface
    .getByRole("checkbox", {
      name: /Approve this bounded collection scope/u,
    })
    .check();
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

  const ledger = await tap.fixture.ledger.read();
  for (const actionId of [
    "specialists.manage",
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
  await expect(
    surface.getByLabel("Host credential").getByRole("option", {
      name: `${GITHUB_CREDENTIAL_DISPLAY_NAME} · http bearer`,
      exact: true,
    }),
  ).toHaveAttribute("value", credentialAlias);
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
        }),
      }),
    ],
  });
  const snapshot = await tap.fixture.snapshot();
  expect(snapshot.state.vfsFiles).toHaveLength(2);
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
