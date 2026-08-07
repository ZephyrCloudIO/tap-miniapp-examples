import { describe, expect, it } from "@rstest/core";
import {
  canTransitionPhase,
  defaultWorkspacePolicy,
  dispositionFinding,
  emptyState,
  evaluatePolicies,
  highestAssuranceLevel,
  isEngineeringChangeState,
  markReadyForWork,
  migrateState,
  nextChangeId,
  openFindings,
  recordWorkStart,
  startedBeforeReady,
  transitionPhase,
  type EngineeringChange,
  type Finding,
} from "./domain";

function baseChange(overrides: Partial<EngineeringChange> = {}): EngineeringChange {
  return {
    id: "EC-2026-0001",
    title: "Example change",
    summary: "Summary",
    phase: "draft",
    proposal: "",
    assuranceLevel: "lightweight",
    effectivePolicy: null,
    impactHypothesis: null,
    impactEvidence: null,
    reviewContributions: [],
    reviewSynthesis: null,
    findings: [],
    readyForWorkAt: null,
    workStartedAt: null,
    workStartSource: null,
    audit: [],
    createdAt: "2026-07-24T12:00:00Z",
    updatedAt: "2026-07-24T12:00:00Z",
    closedAt: null,
    ...overrides,
  };
}

function baseFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "finding-1",
    severity: "medium",
    category: "architecture",
    standard: "workspace-standards:v3",
    file: "src/domain.ts",
    line: 10,
    symbol: "evaluatePolicies",
    summary: "Finding summary",
    confidence: 0.8,
    provenance: null,
    verification: "candidate",
    disposition: null,
    ...overrides,
  };
}

describe("lifecycle", () => {
  it("walks the forward path and rejects illegal transitions", () => {
    expect(canTransitionPhase("draft", "shaping")).toBe(true);
    expect(canTransitionPhase("review", "ready-for-work")).toBe(true);
    expect(canTransitionPhase("draft", "implemented")).toBe(false);
    expect(canTransitionPhase("closed", "draft")).toBe(false);

    const change = baseChange();
    expect(transitionPhase(change, "shaping").phase).toBe("shaping");
    expect(() => transitionPhase(change, "closed" === "closed" ? "implemented" : "closed")).toThrow(
      /Illegal phase transition/u,
    );
  });

  it("allows entering at implementing when implementation already exists", () => {
    expect(canTransitionPhase("draft", "implementing")).toBe(true);
  });
});

describe("assurance evaluation", () => {
  const dimensions = {
    reach: 3,
    reversibility: 2,
    novelty: 2,
    userImpact: 2,
    operationalImpact: 1,
    coordination: 2,
    hardTriggers: [] as string[],
    confidence: 0.9,
  };

  it("picks the highest level any applicable policy produces", () => {
    expect(highestAssuranceLevel(["lightweight", "full-rfc"])).toBe("full-rfc");
    const snapshot = evaluatePolicies([defaultWorkspacePolicy()], {
      ...dimensions,
      reach: 1,
      novelty: 1,
      userImpact: 1,
      coordination: 1,
    });
    expect(snapshot.assuranceLevel).toBe("lightweight");
    const riskier = evaluatePolicies([defaultWorkspacePolicy()], {
      ...dimensions,
      reach: 6,
      userImpact: 6,
      coordination: 4,
    });
    expect(riskier.assuranceLevel).toBe("full-rfc");
  });

  it("forces the policy level on hard triggers regardless of score", () => {
    const snapshot = evaluatePolicies([defaultWorkspacePolicy()], {
      ...dimensions,
      hardTriggers: ["security"],
    });
    expect(snapshot.assuranceLevel).toBe("full-rfc");
    expect(snapshot.requiredCapabilities).toContain("architecture");
  });

  it("honors the locked workspace floor against weaker scoped policies", () => {
    const weakTeamPolicy = {
      ...defaultWorkspacePolicy(),
      id: "team-weak",
      scope: "team" as const,
      scopeId: "team-1",
      locked: false,
      threshold: 20,
      level: "lightweight" as const,
    };
    const snapshot = evaluatePolicies([defaultWorkspacePolicy(), weakTeamPolicy], {
      ...dimensions,
      hardTriggers: ["privacy"],
    });
    expect(snapshot.assuranceLevel).toBe("full-rfc");
    expect(snapshot.contributingPolicies).toHaveLength(2);
  });

  it("escalates on low confidence instead of choosing the lowest level", () => {
    const snapshot = evaluatePolicies([defaultWorkspacePolicy()], {
      ...dimensions,
      reach: 1,
      novelty: 1,
      userImpact: 1,
      coordination: 1,
      confidence: 0.2,
    });
    expect(snapshot.assuranceLevel).toBe("full-rfc");
    expect(snapshot.escalated).toBe(true);

    const high = evaluatePolicies([defaultWorkspacePolicy()], {
      ...dimensions,
      confidence: 0.2,
    });
    expect(high.assuranceLevel).toBe("rfc-plus-specialists");
    expect(high.escalated).toBe(true);
  });

  it("uses the workspace default when no policies exist", () => {
    const snapshot = evaluatePolicies([], dimensions);
    expect(snapshot.contributingPolicies[0]?.policyId).toBe("workspace-default");
  });
});

describe("work readiness", () => {
  it("requires every required capability before ready for work", () => {
    const change = baseChange({
      phase: "review",
      effectivePolicy: evaluatePolicies([defaultWorkspacePolicy()], {
        reach: 6,
        reversibility: 3,
        novelty: 3,
        userImpact: 4,
        operationalImpact: 2,
        coordination: 2,
        hardTriggers: [],
        confidence: 0.9,
      }),
    });
    expect(() => markReadyForWork(change, "2026-07-24T13:00:00Z")).toThrow(
      /Missing required review capabilities/u,
    );

    const reviewed = {
      ...change,
      reviewContributions: [
        {
          id: "rc-1",
          capability: "architecture" as const,
          skillId: "architecture-review",
          skillVersion: "1.0.0",
          specialistId: null,
          specialistVersion: null,
          candidateFindingIds: [],
          evidenceSummary: "Reviewed",
          createdAt: "2026-07-24T12:30:00Z",
        },
        {
          id: "rc-2",
          capability: "test-sufficiency" as const,
          skillId: "test-sufficiency-review",
          skillVersion: "1.0.0",
          specialistId: null,
          specialistVersion: null,
          candidateFindingIds: [],
          evidenceSummary: "Reviewed",
          createdAt: "2026-07-24T12:35:00Z",
        },
      ],
    };
    const ready = markReadyForWork(reviewed, "2026-07-24T13:00:00Z");
    expect(ready.phase).toBe("ready-for-work");
    expect(ready.readyForWorkAt).toBe("2026-07-24T13:00:00Z");
  });

  it("reports Started Before Ready without blocking", () => {
    const change = recordWorkStart(
      baseChange({ phase: "shaping" }),
      "2026-07-24T12:00:00Z",
      "pull-request-commit",
    );
    expect(change.phase).toBe("implementing");
    expect(startedBeforeReady(change)).toBe(true);

    const readyFirst = {
      ...change,
      readyForWorkAt: "2026-07-24T11:00:00Z",
    };
    expect(startedBeforeReady(readyFirst)).toBe(false);
  });

  it("keeps the earliest observable work start", () => {
    const change = recordWorkStart(
      baseChange({ phase: "review" }),
      "2026-07-24T12:00:00Z",
      "task-in-progress",
    );
    const later = recordWorkStart(change, "2026-07-24T13:00:00Z", "explicit-start");
    expect(later.workStartedAt).toBe("2026-07-24T12:00:00Z");
    expect(later.workStartSource).toBe("task-in-progress");
  });
});

describe("findings", () => {
  it("records a disposition and filters open findings", () => {
    const change = baseChange({
      findings: [
        baseFinding({ id: "finding-1" }),
        baseFinding({ id: "finding-2", verification: "rejected" }),
      ],
    });
    const dispositioned = dispositionFinding(change, "finding-1", {
      state: "accepted",
      rationale: "Real issue",
      action: "task",
      linkedWork: null,
      actorId: "human-1",
      at: "2026-07-24T14:00:00Z",
    });
    expect(openFindings(dispositioned)).toHaveLength(0);
    expect(() =>
      dispositionFinding(change, "finding-missing", {
        state: "waived",
        rationale: "n/a",
        action: "none",
        linkedWork: null,
        actorId: "human-1",
        at: "2026-07-24T14:00:00Z",
      }),
    ).toThrow(/Unknown finding/u);
  });
});

describe("state", () => {
  it("round-trips an empty state and rejects unknown schemas", () => {
    const state = emptyState();
    expect(isEngineeringChangeState(state)).toBe(true);
    expect(migrateState(state)).toBe(state);
    expect(isEngineeringChangeState({ schemaVersion: 99 })).toBe(false);
    expect(() => migrateState({ schemaVersion: 99 })).toThrow(/Unsupported/u);
  });

  it("allocates sequential change ids per year", () => {
    expect(nextChangeId([], 2026)).toBe("EC-2026-0001");
    expect(nextChangeId([baseChange({ id: "EC-2026-0042" })], 2026)).toBe("EC-2026-0043");
    expect(nextChangeId([baseChange({ id: "EC-2025-0099" })], 2026)).toBe("EC-2026-0001");
  });
});
