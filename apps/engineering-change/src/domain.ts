export const SCHEMA_VERSION = 1 as const;

// ============================================================================
// Lifecycle
// ============================================================================

/**
 * Engineering Change lifecycle. A change may enter at `implementing` when
 * implementation already exists; every other entry starts at `draft`.
 */
export const phases = [
  "draft",
  "shaping",
  "review",
  "ready-for-work",
  "implementing",
  "implemented",
  "closed",
] as const;

export type Phase = (typeof phases)[number];

const legalTransitions: Readonly<Record<Phase, readonly Phase[]>> = {
  draft: ["shaping", "implementing", "closed"],
  shaping: ["review", "draft", "closed"],
  review: ["ready-for-work", "shaping", "closed"],
  "ready-for-work": ["implementing", "shaping", "closed"],
  implementing: ["implemented", "review", "closed"],
  implemented: ["review", "closed"],
  closed: [],
};

export function canTransitionPhase(from: Phase, to: Phase): boolean {
  return legalTransitions[from].includes(to);
}

export function transitionPhase(change: EngineeringChange, to: Phase): EngineeringChange {
  if (!canTransitionPhase(change.phase, to)) {
    throw new Error(`Illegal phase transition from ${change.phase} to ${to}.`);
  }
  return { ...change, phase: to };
}

// ============================================================================
// Assurance
// ============================================================================

export type AssuranceLevel = "lightweight" | "full-rfc" | "rfc-plus-specialists";

const assuranceRank: Record<AssuranceLevel, number> = {
  lightweight: 0,
  "full-rfc": 1,
  "rfc-plus-specialists": 2,
};

export function highestAssuranceLevel(levels: readonly AssuranceLevel[]): AssuranceLevel {
  return levels.reduce<AssuranceLevel>(
    (highest, level) => (assuranceRank[level] > assuranceRank[highest] ? level : highest),
    "lightweight",
  );
}

/** Objective dimensions the initial classifier scores. */
export interface RiskDimensions {
  reach: number;
  reversibility: number;
  novelty: number;
  userImpact: number;
  operationalImpact: number;
  coordination: number;
  /** Hard RFC triggers observed (security, privacy, auth, migration, ...). */
  hardTriggers: string[];
  /** Classifier confidence from 0 to 1. */
  confidence: number;
}

/**
 * A persisted, versioned policy. Scoped policies evaluate independently;
 * locked workspace requirements are the floor that scoped policies cannot
 * weaken, and adjustable values may be overridden within `bounds`.
 */
export interface AssurancePolicy {
  id: string;
  revision: number;
  scope: "workspace" | "team" | "project";
  scopeId: string | null;
  /** Dimension score at or above which `level` applies. */
  threshold: number;
  level: AssuranceLevel;
  /** Review capabilities required before Ready for Work. */
  requiredCapabilities: string[];
  /** Hard triggers that force at least `level` regardless of score. */
  hardTriggers: string[];
  /** Workspace-locked values a scoped policy may not weaken. */
  locked: boolean;
  /** Inclusive bounds a scoped policy may adjust `threshold` within. */
  bounds: { min: number; max: number };
}

export const defaultHardTriggers = [
  "security",
  "privacy",
  "authentication",
  "authorization",
  "persistent-data-migration",
  "public-contract",
  "cross-boundary-architecture",
  "destructive-behavior",
  "standards-exception",
] as const;

export function defaultWorkspacePolicy(): AssurancePolicy {
  return {
    id: "workspace-default",
    revision: 1,
    scope: "workspace",
    scopeId: null,
    threshold: 12,
    level: "full-rfc",
    requiredCapabilities: ["architecture", "test-sufficiency"],
    hardTriggers: [...defaultHardTriggers],
    locked: true,
    bounds: { min: 8, max: 20 },
  };
}

export interface EffectivePolicySnapshot {
  assuranceLevel: AssuranceLevel;
  requiredCapabilities: string[];
  contributingPolicies: Array<{
    policyId: string;
    revision: number;
    scope: AssurancePolicy["scope"];
  }>;
  escalated: boolean;
  rationale: string;
}

function policyScore(dimensions: RiskDimensions): number {
  return (
    dimensions.reach +
    dimensions.reversibility +
    dimensions.novelty +
    dimensions.userImpact +
    dimensions.operationalImpact +
    dimensions.coordination
  );
}

function evaluateOnePolicy(
  policy: AssurancePolicy,
  dimensions: RiskDimensions,
): { level: AssuranceLevel; hit: boolean } {
  const triggered = dimensions.hardTriggers.some((trigger) =>
    policy.hardTriggers.includes(trigger),
  );
  if (triggered) {
    return { level: policy.level, hit: true };
  }
  const threshold = Math.min(Math.max(policy.threshold, policy.bounds.min), policy.bounds.max);
  return {
    level: policyScore(dimensions) >= threshold ? policy.level : "lightweight",
    hit: true,
  };
}

/**
 * Evaluate every applicable policy independently and freeze the effective
 * snapshot. The highest Assurance Level any applicable policy produces wins;
 * low-confidence classification escalates one step rather than silently
 * choosing the lowest level.
 */
export function evaluatePolicies(
  policies: readonly AssurancePolicy[],
  dimensions: RiskDimensions,
): EffectivePolicySnapshot {
  const applicable = policies.length > 0 ? policies : [defaultWorkspacePolicy()];
  const evaluated = applicable.map((policy) => ({
    policy,
    outcome: evaluateOnePolicy(policy, dimensions),
  }));
  const locked = evaluated.filter(({ policy }) => policy.locked && policy.scope === "workspace");
  const floor =
    locked.length > 0
      ? highestAssuranceLevel(locked.map(({ outcome }) => outcome.level))
      : "lightweight";
  const produced = highestAssuranceLevel(evaluated.map(({ outcome }) => outcome.level));
  let level = assuranceRank[produced] >= assuranceRank[floor] ? produced : floor;
  let escalated = false;
  if (dimensions.confidence < 0.5 && assuranceRank[level] < assuranceRank["rfc-plus-specialists"]) {
    level = assuranceRank[level] === 0 ? "full-rfc" : "rfc-plus-specialists";
    escalated = true;
  }
  const requiredCapabilities = [
    ...new Set(
      evaluated
        .filter(({ outcome }) => assuranceRank[outcome.level] > 0)
        .flatMap(({ policy }) => policy.requiredCapabilities),
    ),
  ];
  return {
    assuranceLevel: level,
    requiredCapabilities,
    contributingPolicies: evaluated.map(({ policy }) => ({
      policyId: policy.id,
      revision: policy.revision,
      scope: policy.scope,
    })),
    escalated,
    rationale:
      `score ${policyScore(dimensions)} with confidence ${dimensions.confidence}; ` +
      `${evaluated.length} applicable polic${evaluated.length === 1 ? "y" : "ies"}` +
      (escalated ? "; escalated on low confidence" : ""),
  };
}

// ============================================================================
// Evidence
// ============================================================================

export interface ImpactHypothesis {
  relatedSymbols: string[];
  likelyOwners: string[];
  applicablePolicies: string[];
  relevantStandards: string[];
  similarChanges: string[];
  predictedBlastRadius: string;
  confidence: number;
  unresolvedQuestions: string[];
  recordedAt: string;
}

export interface ImpactEvidence {
  changedSymbols: string[];
  affectedFiles: string[];
  coverageNotes: string;
  fragilityNotes: string;
  drift: "none" | "minor" | "material";
  graphRevision: string | null;
  sourceCommit: string | null;
  recordedAt: string;
}

// ============================================================================
// Review and findings
// ============================================================================

export type ReviewCapability =
  | "security"
  | "architecture"
  | "test-sufficiency"
  | "operability"
  | "domain-ownership";

export interface ReviewContribution {
  id: string;
  capability: ReviewCapability;
  skillId: string;
  skillVersion: string;
  specialistId: string | null;
  specialistVersion: string | null;
  candidateFindingIds: string[];
  evidenceSummary: string;
  createdAt: string;
}

export type FindingDispositionState =
  | "accepted"
  | "waived"
  | "false-positive"
  | "deferred"
  | "duplicate";

export type FindingAction = "task" | "issue" | "both" | "link" | "none";

export interface FindingDisposition {
  state: FindingDispositionState;
  rationale: string;
  action: FindingAction;
  /** Existing work linked when `action` is `link`. */
  linkedWork: string | null;
  /** Durable host action receipts created while applying this disposition. */
  actionReceiptIds?: string[];
  actorId: string;
  at: string;
}

export interface Finding {
  id: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  category: string;
  /** Applicable standard or rule the finding cites. */
  standard: string;
  file: string | null;
  line: number | null;
  symbol: string | null;
  summary: string;
  confidence: number;
  /** Contributing specialist provenance, when machine-produced. */
  provenance: string | null;
  /** Coordinator verification state. */
  verification: "candidate" | "verified" | "rejected" | "unresolved";
  disposition: FindingDisposition | null;
}

export interface ReviewSynthesis {
  id: string;
  coordinatorSkillVersion: string;
  contributionIds: string[];
  findingIds: string[];
  unresolvedDisagreements: string[];
  createdAt: string;
}

// ============================================================================
// Engineering Change
// ============================================================================

export type WorkStartSource =
  | "task-in-progress"
  | "workflow-started"
  | "pull-request-commit"
  | "explicit-start";

export interface EngineeringChange {
  id: string;
  title: string;
  summary: string;
  phase: Phase;
  proposal: string;
  assuranceLevel: AssuranceLevel;
  effectivePolicy: EffectivePolicySnapshot | null;
  impactHypothesis: ImpactHypothesis | null;
  impactEvidence: ImpactEvidence | null;
  reviewContributions: ReviewContribution[];
  reviewSynthesis: ReviewSynthesis | null;
  findings: Finding[];
  readyForWorkAt: string | null;
  workStartedAt: string | null;
  workStartSource: WorkStartSource | null;
  audit: AuditEntry[];
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export interface AuditEntry {
  id: string;
  at: string;
  actorId: string;
  action: string;
  summary: string;
}

// ============================================================================
// Work readiness
// ============================================================================

/**
 * Started Before Ready is reported, never enforced: the earliest observable
 * implementation event wins, and the UI surfaces whether work preceded
 * readiness without blocking the change.
 */
export function startedBeforeReady(change: EngineeringChange): boolean {
  return (
    change.workStartedAt !== null &&
    (change.readyForWorkAt === null || change.workStartedAt < change.readyForWorkAt)
  );
}

export function markReadyForWork(change: EngineeringChange, at: string): EngineeringChange {
  if (change.phase !== "review") {
    throw new Error("Only a change in review can become ready for work.");
  }
  const missing = change.effectivePolicy?.requiredCapabilities.filter(
    (capability) =>
      !change.reviewContributions.some((contribution) => contribution.capability === capability),
  );
  if (missing && missing.length > 0) {
    throw new Error(`Missing required review capabilities: ${missing.join(", ")}.`);
  }
  return { ...change, phase: "ready-for-work", readyForWorkAt: at };
}

export function recordWorkStart(
  change: EngineeringChange,
  at: string,
  source: WorkStartSource,
): EngineeringChange {
  if (change.workStartedAt !== null) return change;
  return { ...change, workStartedAt: at, workStartSource: source, phase: "implementing" };
}

// ============================================================================
// Findings
// ============================================================================

export function dispositionFinding(
  change: EngineeringChange,
  findingId: string,
  disposition: FindingDisposition,
): EngineeringChange {
  const findings = change.findings.map((finding) =>
    finding.id === findingId ? { ...finding, disposition } : finding,
  );
  if (!findings.some((finding) => finding.id === findingId)) {
    throw new Error(`Unknown finding ${findingId}.`);
  }
  return { ...change, findings };
}

/** Open findings are those without a disposition and not coordinator-rejected. */
export function openFindings(change: EngineeringChange): Finding[] {
  return change.findings.filter(
    (finding) => finding.disposition === null && finding.verification !== "rejected",
  );
}

// ============================================================================
// State
// ============================================================================

export interface EngineeringChangeState {
  schemaVersion: typeof SCHEMA_VERSION;
  changes: EngineeringChange[];
  policies: AssurancePolicy[];
}

export function emptyState(): EngineeringChangeState {
  return {
    schemaVersion: SCHEMA_VERSION,
    changes: [],
    policies: [defaultWorkspacePolicy()],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isEngineeringChangeState(value: unknown): value is EngineeringChangeState {
  if (!isRecord(value)) return false;
  if (value.schemaVersion !== SCHEMA_VERSION) return false;
  if (!Array.isArray(value.changes)) return false;
  if (!Array.isArray(value.policies)) return false;
  return value.changes.every(
    (change) =>
      isRecord(change) &&
      typeof change.id === "string" &&
      typeof change.title === "string" &&
      typeof change.phase === "string" &&
      (phases as readonly string[]).includes(change.phase) &&
      Array.isArray(change.findings) &&
      Array.isArray(change.audit),
  );
}

/** Forward-only migration; v1 is the current schema, so unknown data fails. */
export function migrateState(value: unknown): EngineeringChangeState {
  if (isEngineeringChangeState(value)) return value;
  throw new Error("Unsupported Engineering Change state schema.");
}

export function nextChangeId(changes: readonly EngineeringChange[], year: number): string {
  const prefix = `EC-${year}-`;
  const highest = changes.reduce((max, change) => {
    if (!change.id.startsWith(prefix)) return max;
    const serial = Number.parseInt(change.id.slice(prefix.length), 10);
    return Number.isFinite(serial) && serial > max ? serial : max;
  }, 0);
  return `${prefix}${String(highest + 1).padStart(4, "0")}`;
}

// ============================================================================
// Runtime identity and audit
// ============================================================================

export type RuntimeIdFactory = (prefix: string) => string;

/** Deterministic-safe id factory backed by host entropy. */
export const runtimeId: RuntimeIdFactory = (prefix) =>
  `${prefix}_${globalThis.crypto.randomUUID()}`;

/** Append one actor/timestamp audit entry; the audit trail is append-only. */
export function auditMutation(
  change: EngineeringChange,
  actorId: string,
  action: string,
  summary: string,
  at: string,
  idFactory: RuntimeIdFactory = runtimeId,
): EngineeringChange {
  return {
    ...change,
    updatedAt: at,
    audit: [...change.audit, { id: idFactory("audit"), at, actorId, action, summary }],
  };
}
