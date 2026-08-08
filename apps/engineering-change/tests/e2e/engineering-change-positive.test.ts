import {
  expect,
  test,
} from "@theaiplatform/miniapp-sdk/testing/rstest";
import {
  expectExactProvenance,
  expectReadySurface,
  FIXTURE_CHANGE_ID,
  FIXTURE_CHANNEL_ID,
  FIXTURE_WORKFLOW_ID,
  GITHUB_DIFF_URL,
  hasAuthorizationDecision,
  openChangeDetail,
  readStoredChanges,
} from "./engineering-change-test-support";

test("drives the seeded change through review, readiness, and disposition", async ({
  surface,
  tap,
}) => {
  expectExactProvenance(tap, {
    matrixEntryId: "engineering-change-desktop-positive",
    permissionScenario: "default",
    profileId: "engineering-change-desktop",
    seed: 7101,
    theme: "light",
  });
  await expectReadySurface(surface);
  await expect(
    surface.getByTestId("engineering-change-overview-actor"),
  ).toContainText("Signed in as");

  // Proposal shaping: freeze the effective policy snapshot.
  await surface.getByRole("button", { name: "Proposal", exact: true }).click();
  await expect(
    surface.getByTestId("engineering-change-proposal-level"),
  ).toContainText("lightweight");
  await surface
    .getByTestId("engineering-change-proposal-trigger-security")
    .check();
  await expect(
    surface.getByTestId("engineering-change-proposal-level"),
  ).toContainText("full-rfc");
  await surface.getByTestId("engineering-change-proposal-freeze").click();
  await expect(surface.getByTestId("engineering-change-notice")).toContainText(
    "Assurance level frozen at full-rfc",
  );

  // Impact Hypothesis before implementation.
  await surface.getByRole("button", { name: "Evidence", exact: true }).click();
  await surface
    .getByTestId("engineering-change-evidence-symbols")
    .fill("execute_run\nFencedReferee");
  await surface
    .getByTestId("engineering-change-evidence-blast-radius")
    .fill("desktop run lanes");
  await surface
    .getByTestId("engineering-change-evidence-record-hypothesis")
    .click();
  await expect(surface.getByTestId("engineering-change-notice")).toContainText(
    "Impact Hypothesis recorded",
  );

  // Governed Impact Evidence against the declared GitHub origin.
  await surface
    .getByTestId("engineering-change-evidence-diff-url")
    .fill(GITHUB_DIFF_URL);
  await surface
    .getByTestId("engineering-change-evidence-source-commit")
    .fill("0be6c970a");
  await surface.getByTestId("engineering-change-evidence-capture").click();
  await expect(surface.getByTestId("engineering-change-notice")).toContainText(
    "Impact Evidence captured with digest",
  );
  await expect(
    surface.getByTestId("engineering-change-evidence-impact"),
  ).toContainText("0be6c970a");

  // Coordinated review: contributions, candidate finding, verification.
  await surface.getByRole("button", { name: "Review", exact: true }).click();
  await expect(
    surface.getByTestId("engineering-change-review-missing"),
  ).toContainText("Needs assignment");
  await surface
    .getByTestId("engineering-change-review-evidence-summary")
    .fill("Reviewed the referee projection against the approved intent.");
  await surface
    .getByTestId("engineering-change-review-add-contribution")
    .click();
  await surface
    .getByTestId("engineering-change-review-capability")
    .selectOption("test-sufficiency");
  await surface
    .getByTestId("engineering-change-review-add-contribution")
    .click();
  await expect(
    surface.getByTestId("engineering-change-review-covered"),
  ).toBeVisible();
  await surface
    .getByTestId("engineering-change-review-verify-finding-seed-1")
    .click();
  await expect(surface.getByTestId("engineering-change-notice")).toContainText(
    "Finding verified",
  );

  // Human disposition with an external action choice.
  await surface
    .getByTestId("engineering-change-review-disposition-state")
    .selectOption("accepted");
  await surface
    .getByTestId("engineering-change-review-disposition-action")
    .selectOption("task");
  await surface
    .getByTestId("engineering-change-review-rationale")
    .fill("Accepted: the legacy lane must be retired in this change.");
  await surface
    .getByTestId("engineering-change-review-disposition-finding-seed-1")
    .click();
  await expect(surface.getByTestId("engineering-change-notice")).toContainText(
    "follow-up task",
  );

  // Ready for work once required capabilities are covered.
  await openChangeDetail(surface);
  await surface.getByTestId("engineering-change-detail-ready-for-work").click();
  await expect(surface.getByTestId("engineering-change-detail-phase")).toContainText(
    "ready-for-work",
  );

  // Workspace execution: specialist join, channel notice, transition workflow.
  await surface.getByTestId("engineering-change-detail-join-specialist").click();
  await expect(
    surface.getByTestId("engineering-change-detail-workspace-status"),
  ).toContainText("specialist joined the change channel");
  await surface.getByTestId("engineering-change-detail-post-notice").click();
  await expect(
    surface.getByTestId("engineering-change-detail-workspace-status"),
  ).toContainText("Lifecycle notice posted");
  await surface.getByTestId("engineering-change-detail-invoke-workflow").click();
  await expect(
    surface.getByTestId("engineering-change-detail-workspace-status"),
  ).toContainText("Workflow started: engineering-change-fixture-run");

  // Durable state and fixture side effects.
  const { changes } = await readStoredChanges(tap);
  expect(changes).toHaveLength(1);
  const change = changes[0] as Record<string, unknown>;
  expect(change.id).toBe(FIXTURE_CHANGE_ID);
  expect(change.phase).toBe("ready-for-work");
  expect(
    (change.findings as Array<{ disposition?: { state: string } }>)[0]?.disposition
      ?.state,
  ).toBe("accepted");
  expect(
    (change.findings as Array<{ disposition?: { linkedWork: string } }>)[0]
      ?.disposition?.linkedWork,
  ).toMatch(/^tap-task:/u);
  expect(
    (change.findings as Array<{ disposition?: { actionReceiptIds?: string[] } }>)[0]
      ?.disposition?.actionReceiptIds,
  ).toHaveLength(1);
  expect(change.impactHypothesis).not.toBeNull();
  expect(change.impactEvidence).not.toBeNull();

  const snapshot = await tap.fixture.snapshot();
  const channel = snapshot.state.channels.find(
    (candidate) => candidate.roomId === FIXTURE_CHANNEL_ID,
  );
  expect(channel?.messages).toHaveLength(1);
  expect(channel?.specialistIds).toContain("engineering-change-specialist");

  const ledger = await tap.fixture.ledger.read();
  for (const actionId of [
    "changes.propose",
    "changes.review",
    "evidence.capture",
    "findings.disposition",
    "task.write",
    "channels.manage-specialists",
    "channels.send-message",
    "workflows.invoke",
  ]) {
    expect(
      hasAuthorizationDecision(ledger.entries, {
        actionId,
        allowed: true,
        kind: "host-action",
      }) ||
        hasAuthorizationDecision(ledger.entries, {
          actionId,
          allowed: true,
          kind: "platform",
        }),
    ).toBe(true);
  }
});

test("opens a new change from the ledger", async ({ surface, tap }) => {
  await expectReadySurface(surface);
  await surface.getByRole("button", { name: "Ledger", exact: true }).click();
  await surface
    .getByTestId("engineering-change-ledger-new-title")
    .fill("Managed artifact plot backing");
  await surface.getByTestId("engineering-change-ledger-create").click();
  await expect(surface.getByTestId("engineering-change-notice")).toContainText(
    "Opened EC-2026-0002",
  );
  await expect(surface.getByTestId("engineering-change-detail-phase")).toContainText(
    "draft",
  );

  const { changes } = await readStoredChanges(tap);
  expect(changes).toHaveLength(2);
  const created = changes[1] as Record<string, unknown>;
  expect(created.id).toBe("EC-2026-0002");
  expect(created.phase).toBe("draft");

  const ledger = await tap.fixture.ledger.read();
  expect(
    hasAuthorizationDecision(ledger.entries, {
      actionId: "changes.propose",
      allowed: true,
      autonomy: "plan",
      kind: "host-action",
    }) ||
      hasAuthorizationDecision(ledger.entries, {
        actionId: "changes.propose",
        allowed: true,
        autonomy: "plan",
        kind: "platform",
      }),
  ).toBe(true);
});

test("saves scoped assurance policies with bumped revisions", async ({
  surface,
  tap,
}) => {
  await expectReadySurface(surface);
  await surface.getByRole("button", { name: "Policies", exact: true }).click();
  await expect(
    surface.getByTestId("engineering-change-policies-preview"),
  ).toBeVisible();
  await surface.getByTestId("engineering-change-policies-add").click();
  await surface.getByTestId("engineering-change-policies-save").click();
  await expect(surface.getByTestId("engineering-change-notice")).toContainText(
    "Assurance policies saved",
  );

  const snapshot = await tap.fixture.snapshot();
  const record = snapshot.state.storage.find(
    (entry) => entry.namespace === "engineering-change" && entry.key === "changes/v1",
  );
  const policies =
    typeof record?.value === "object" && record.value !== null && !Array.isArray(record.value)
      ? (Reflect.get(record.value, "policies") as Array<{ revision: number }>)
      : [];
  expect(policies.length).toBe(2);
  expect(policies.every((policy) => policy.revision === 2)).toBe(true);

  const ledger = await tap.fixture.ledger.read();
  expect(
    hasAuthorizationDecision(ledger.entries, {
      actionId: "policies.manage",
      allowed: true,
      autonomy: "do",
      kind: "host-action",
    }) ||
      hasAuthorizationDecision(ledger.entries, {
        actionId: "policies.manage",
        allowed: true,
        autonomy: "do",
        kind: "platform",
      }),
  ).toBe(true);
});
