export const SCHEMA_VERSION = 2 as const;

export const phases = [
  "intake",
  "evidence collection",
  "analysis",
  "action planning",
  "review",
  "published",
  "follow-up",
] as const;

export type Phase = (typeof phases)[number];
export type Role =
  | "lead"
  | "facilitator"
  | "investigator"
  | "sme"
  | "evidence-owner"
  | "editor"
  | "reviewer"
  | "stakeholder";
export type Confidence = "unverified" | "low" | "medium" | "high" | "confirmed" | "contradicted" | "disputed";
export type Visibility = "investigation" | "restricted" | "public-approved";

export interface AuditEntry {
  id: string;
  at: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  before?: unknown;
  after?: unknown;
}

export interface Member {
  id: string;
  displayName: string;
  role: Role;
  joinedAt: string;
}

export interface Evidence {
  id: string;
  title: string;
  kind: "log" | "alert" | "screenshot" | "metric" | "ticket" | "code" | "message" | "testimony" | "api-result" | "file";
  source: string;
  description: string;
  collectedAt: string;
  collectedBy: string;
  incidentFrom?: string;
  incidentTo?: string;
  visibility: Visibility;
  digest: string;
  mimeType?: string;
  sizeBytes?: number;
  reliability: string;
  systems: string[];
  supportsClaimIds: string[];
  contradictsClaimIds: string[];
  timelineEventIds: string[];
  vfsPath?: string;
  receiptPath?: string;
  immutableSnapshot: boolean;
  collectionStatus: "reference" | "captured" | "quarantined" | "failed";
}

export interface TimelineEvent {
  id: string;
  timestamp: string;
  originalTimestamp: string;
  timezone: string;
  type: "incident" | "detection" | "escalation" | "mitigation" | "recovery" | "investigation";
  actor: string;
  description: string;
  confidence: "confirmed" | "likely" | "uncertain" | "disputed";
  evidenceIds: string[];
  reviewStatus: "proposed" | "confirmed" | "disputed";
  supersedesId?: string;
}

export interface WhyNode {
  id: string;
  parentId?: string;
  question: string;
  answer: string;
  confidence: "unverified" | "supported" | "contradicted";
  supportingEvidenceIds: string[];
  contradictingEvidenceIds: string[];
  assumptions: string[];
  alternatives: string[];
  openQuestionIds: string[];
  authorId: string;
  reviewerIds: string[];
  reviewStatus: "proposed" | "accepted" | "rejected";
  decision: "continue" | "branch" | "revise" | "stop";
  factorType:
    | "trigger"
    | "proximate cause"
    | "contributing factor"
    | "latent condition"
    | "detection gap"
    | "impact amplifier"
    | "confirmed non-cause";
  counterfactual: string;
}

export interface Question {
  id: string;
  text: string;
  owner?: string;
  status: "open" | "answered";
  answer?: string;
  createdAt: string;
}

export interface Decision {
  id: string;
  text: string;
  rationale: string;
  decidedBy: string;
  decidedAt: string;
}

export interface CorrectiveAction {
  id: string;
  title: string;
  factorId?: string;
  category: "containment" | "correction" | "prevention" | "detection" | "resilience";
  priority: "low" | "medium" | "high" | "critical";
  owner: string;
  dueDate?: string;
  acceptanceCriteria: string;
  verificationMethod: string;
  requiredEvidence: string;
  evidenceIds: string[];
  status: "open" | "in-progress" | "awaiting-verification" | "verified" | "cancelled";
  effectiveness?: "effective" | "partly-effective" | "ineffective";
  completionReceipt?: string;
}

export interface ReportRevision {
  id: string;
  number: number;
  createdAt: string;
  createdBy: string;
  visibility: "internal" | "public";
  template: "engineering" | "executive" | "internal-review" | "public-postmortem";
  status: "draft" | "approved" | "published" | "superseded";
  markdown: string;
  html: string;
  digest: string;
  approvedBy?: string;
  approvedAt?: string;
  publishedAt?: string;
  publicationUrl?: string;
}

export interface PlatformBindings {
  projectId?: string;
  channelId?: string;
  specialistId?: string;
  vfsConversationId?: string;
  vfsRoot?: string;
  lastCheckpointMessageId?: string;
}

export interface IncidentTimes {
  start?: string;
  detected?: string;
  mitigated?: string;
  recovered?: string;
  ended?: string;
}

export interface Investigation {
  schemaVersion: 2;
  id: string;
  title: string;
  statement: string;
  severity: "unassessed" | "SEV-1" | "SEV-2" | "SEV-3" | "SEV-4";
  status: "investigating" | "monitoring" | "resolved";
  impact: string;
  businessImpact: string;
  systems: string[];
  regions: string[];
  times: IncidentTimes;
  sourceLinks: string[];
  phase: Phase;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  members: Member[];
  evidence: Evidence[];
  timeline: TimelineEvent[];
  whys: WhyNode[];
  actions: CorrectiveAction[];
  questions: Question[];
  decisions: Decision[];
  reports: ReportRevision[];
  audit: AuditEntry[];
  revision: number;
  bindings: PlatformBindings;
}

export interface PyreState {
  schemaVersion: 2;
  investigations: Investigation[];
  activeId?: string;
}

export interface Actor {
  id: string;
  displayName: string;
}

export const emptyState = (): PyreState => ({ schemaVersion: SCHEMA_VERSION, investigations: [] });
export const runtimeId = (prefix: string): string => `${prefix}_${crypto.randomUUID()}`;
export const timestamp = (): string => new Date().toISOString();
export const splitList = (value: string): string[] => [...new Set(value.split(",").map((part) => part.trim()).filter(Boolean))];

export function validateIncident(input: Pick<Investigation, "title" | "statement" | "impact">): string[] {
  const errors: string[] = [];
  if (input.title.trim().length < 3) errors.push("Enter an incident title with at least 3 characters.");
  if (input.statement.trim().length < 20) errors.push("Describe an observable problem in at least 20 characters.");
  if (!input.impact.trim()) errors.push("Describe the observed impact, or enter “Unknown”.");
  return errors;
}

const EDIT_ROLES = new Set<Role>(["lead", "facilitator", "investigator", "evidence-owner", "editor"]);
const REVIEW_ROLES = new Set<Role>(["lead", "reviewer"]);

export function roleFor(investigation: Investigation, actorId: string): Role | undefined {
  return investigation.members.find((member) => member.id === actorId)?.role;
}
export function canEdit(investigation: Investigation, actorId: string): boolean {
  const role = roleFor(investigation, actorId);
  return role ? EDIT_ROLES.has(role) : false;
}
export function canReview(investigation: Investigation, actorId: string): boolean {
  const role = roleFor(investigation, actorId);
  return role ? REVIEW_ROLES.has(role) : false;
}
export function canManageMembers(investigation: Investigation, actorId: string): boolean {
  return roleFor(investigation, actorId) === "lead";
}

export function auditMutation(
  investigation: Investigation,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
  summary: string,
  before?: unknown,
  after?: unknown,
): Investigation {
  const at = timestamp();
  return {
    ...investigation,
    updatedAt: at,
    revision: investigation.revision + 1,
    audit: [
      ...investigation.audit,
      { id: runtimeId("audit"), at, actorId, action, entityType, entityId, summary, before, after },
    ],
  };
}

export function transitionInvestigation(investigation: Investigation, next: Phase, actorId: string): Investigation {
  if (!canEdit(investigation, actorId) && !canReview(investigation, actorId)) {
    throw new Error("Your investigation role cannot change the lifecycle stage.");
  }
  const currentIndex = phases.indexOf(investigation.phase);
  const nextIndex = phases.indexOf(next);
  if (nextIndex !== currentIndex + 1) throw new Error("Advance one reviewed lifecycle stage at a time.");
  if (next === "review" && investigation.actions.some((action) => !action.owner.trim())) {
    throw new Error("Assign every corrective action before moving to review.");
  }
  if (next === "published") {
    const approvedInternal = investigation.reports.some(
      (report) => report.visibility === "internal" && report.status === "approved",
    );
    if (!approvedInternal) throw new Error("Approve an internal report revision before publication.");
  }
  return auditMutation(
    { ...investigation, phase: next },
    actorId,
    "phase.changed",
    "investigation",
    investigation.id,
    `${investigation.phase} → ${next}`,
    investigation.phase,
    next,
  );
}

export function addReplaySafe<T extends { id: string }>(items: T[], item: T): T[] {
  return items.some((existing) => existing.id === item.id) ? items : [...items, item];
}

export function buildReportMarkdown(investigation: Investigation, visibility: "internal" | "public"): string {
  const allowedEvidence = investigation.evidence.filter((evidence) =>
    visibility === "public" ? evidence.visibility === "public-approved" : true,
  );
  const lines = [
    `# ${investigation.title}`,
    "",
    `**Incident:** ${investigation.id}  `,
    `**Status:** ${investigation.status}  `,
    `**Severity:** ${investigation.severity}  `,
    `**Report visibility:** ${visibility}`,
    "",
    "## Executive Summary",
    investigation.statement,
    "",
    "## Customer & Business Impact",
    investigation.impact,
    investigation.businessImpact || "Business impact has not been established.",
    "",
    "## Detection & Response",
    `Detected: ${investigation.times.detected || "Unknown"}; mitigated: ${investigation.times.mitigated || "Unknown"}; recovered: ${investigation.times.recovered || "Unknown"}.`,
    "",
    "## Timeline",
    ...(investigation.timeline.length
      ? investigation.timeline
          .toSorted((a, b) => a.timestamp.localeCompare(b.timestamp))
          .map((event) => `- ${event.timestamp} — ${event.description} (${event.confidence}, ${event.reviewStatus})`)
      : ["No timeline events have been reviewed."]),
    "",
    "## Evidence Considered",
    ...(allowedEvidence.length
      ? allowedEvidence.map((evidence) => `- ${evidence.title} — ${evidence.source} [${evidence.visibility}]`)
      : [visibility === "public" ? "No evidence is approved for public use." : "No evidence has been collected."]),
    "",
    "## 5 Whys & Contributing Factors",
    ...(investigation.whys.length
      ? investigation.whys.map(
          (node) => `- **${node.factorType}:** ${node.answer} [${node.confidence}, ${node.reviewStatus}]`,
        )
      : ["No causal conclusions have been reviewed."]),
    "",
    "## Corrective & Preventive Actions",
    ...(investigation.actions.length
      ? investigation.actions.map(
          (action) => `- ${action.title} — ${action.owner}; ${action.status}; acceptance: ${action.acceptanceCriteria}`,
        )
      : ["No corrective actions have been defined."]),
    "",
    "## Unresolved Questions & Dissent",
    ...(investigation.questions.filter((question) => question.status === "open").length
      ? investigation.questions
          .filter((question) => question.status === "open")
          .map((question) => `- ${question.text}`)
      : ["No unresolved questions are recorded."]),
    "",
    "## Review & Provenance",
    `Investigation revision ${investigation.revision}. Generated from structured reviewed state; source evidence remains separately governed.`,
  ];
  return lines.join("\n");
}

export function reportReadiness(investigation: Investigation, visibility: "internal" | "public"): string[] {
  const blockers: string[] = [];
  if (!investigation.timeline.some((event) => event.reviewStatus === "confirmed")) blockers.push("Confirm at least 1 timeline event.");
  if (!investigation.evidence.length) blockers.push("Collect or reference at least 1 evidence item.");
  if (investigation.whys.some((node) => node.reviewStatus === "proposed")) blockers.push("Review every proposed causal claim.");
  if (investigation.actions.some((action) => !action.owner.trim())) blockers.push("Assign every corrective action.");
  if (visibility === "public" && investigation.evidence.some((evidence) => evidence.visibility !== "public-approved")) {
    blockers.push("Complete a separate public-source visibility review.");
  }
  return blockers;
}

export function validateSourceLinks(links: string[]): string[] {
  return links.flatMap((link) => {
    try {
      const parsed = new URL(link);
      return parsed.protocol === "https:" || parsed.protocol === "http:" ? [] : [`Source link must use HTTP or HTTPS: ${link}`];
    } catch {
      return [`Source link is not a valid URL: ${link}`];
    }
  });
}

export function isPyreState(value: unknown): value is PyreState {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.schemaVersion === SCHEMA_VERSION && Array.isArray(record.investigations);
}

export function migrateState(value: unknown): PyreState {
  if (isPyreState(value)) return value;
  if (!value || typeof value !== "object") return emptyState();
  const legacy = value as { schemaVersion?: unknown; investigations?: unknown[]; activeId?: unknown };
  if (legacy.schemaVersion !== 1 || !Array.isArray(legacy.investigations)) return emptyState();
  const investigations = legacy.investigations.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const old = raw as Record<string, any>;
    const createdAt = typeof old.createdAt === "string" ? old.createdAt : timestamp();
    const memberEntries = old.members && !Array.isArray(old.members) ? Object.entries(old.members) : [];
    const migrated: Investigation = {
      schemaVersion: 2,
      id: String(old.id || runtimeId("inc")),
      title: String(old.title || "Untitled incident"),
      statement: String(old.statement || "Problem statement not established."),
      severity: ["SEV-1", "SEV-2", "SEV-3", "SEV-4"].includes(old.severity) ? old.severity : "unassessed",
      status: old.status === "resolved" || old.status === "monitoring" ? old.status : "investigating",
      impact: String(old.impact || "Unknown"),
      businessImpact: "",
      systems: Array.isArray(old.systems) ? old.systems.map(String) : [],
      regions: Array.isArray(old.regions) ? old.regions.map(String) : [],
      times: typeof old.times === "object" && old.times ? old.times : {},
      sourceLinks: Array.isArray(old.sourceLinks) ? old.sourceLinks.map(String) : [],
      phase: phases.includes(old.phase) ? old.phase : "intake",
      createdAt,
      updatedAt: createdAt,
      createdBy: String(old.createdBy || "unknown"),
      members: memberEntries.map(([memberId, role]) => ({ id: memberId, displayName: memberId, role: role as Role, joinedAt: createdAt })),
      evidence: Array.isArray(old.evidence)
        ? old.evidence.map((e: any) => ({
            id: String(e.id), title: String(e.title), kind: e.kind === "API result" ? "api-result" : e.kind,
            source: String(e.source), description: String(e.description || ""), collectedAt: String(e.collectedAt || createdAt),
            collectedBy: String(e.collector || old.createdBy || "unknown"), incidentFrom: e.incidentFrom, incidentTo: e.incidentTo,
            visibility: e.visibility || "investigation", digest: String(e.digest || ""), reliability: String(e.reliability || ""),
            systems: Array.isArray(e.systems) ? e.systems : [], supportsClaimIds: e.supports || [], contradictsClaimIds: e.contradicts || [],
            timelineEventIds: [], vfsPath: e.vfsPath, immutableSnapshot: Boolean(e.vfsPath), collectionStatus: e.vfsPath ? "captured" : "reference",
          }))
        : [],
      timeline: Array.isArray(old.timeline)
        ? old.timeline.map((event: any) => ({
            id: String(event.id), timestamp: String(event.at), originalTimestamp: String(event.original || event.at), timezone: "local",
            type: event.type || "incident", actor: String(event.actor || ""), description: String(event.description || ""),
            confidence: event.confidence || "uncertain", evidenceIds: event.evidenceIds || [],
            reviewStatus: event.confidence === "confirmed" ? "confirmed" : event.confidence === "disputed" ? "disputed" : "proposed",
            supersedesId: event.revisionOf,
          }))
        : [],
      whys: Array.isArray(old.whys)
        ? old.whys.map((node: any) => ({
            id: String(node.id), parentId: node.parentId, question: String(node.question || ""), answer: String(node.answer || ""),
            confidence: node.confidence || "unverified", supportingEvidenceIds: node.evidenceIds || [], contradictingEvidenceIds: node.contradictingIds || [],
            assumptions: node.assumptions ? [String(node.assumptions)] : [], alternatives: node.alternatives ? [String(node.alternatives)] : [],
            openQuestionIds: [], authorId: String(node.author || old.createdBy || "unknown"), reviewerIds: node.reviewedBy ? [node.reviewedBy] : [],
            reviewStatus: node.reviewedBy ? "accepted" : "proposed", decision: node.decision || "continue",
            factorType: node.factorType || "contributing factor", counterfactual: "",
          }))
        : [],
      actions: Array.isArray(old.actions)
        ? old.actions.map((action: any) => ({
            id: String(action.id), title: String(action.title), factorId: action.factorId || undefined, category: action.category || "prevention",
            priority: action.priority || "medium", owner: String(action.owner || ""), dueDate: action.due || undefined,
            acceptanceCriteria: String(action.acceptance || ""), verificationMethod: String(action.verification || ""),
            requiredEvidence: String(action.requiredEvidence || ""), evidenceIds: [], status: action.status === "in progress" ? "in-progress" : action.status || "open",
            effectiveness: action.effectiveness,
          }))
        : [],
      questions: Array.isArray(old.questions)
        ? old.questions.map((question: any) => typeof question === "string"
          ? { id: runtimeId("question"), text: question, status: "open", createdAt }
          : question)
        : [],
      decisions: Array.isArray(old.decisions)
        ? old.decisions.map((decision: any) => typeof decision === "string"
          ? { id: runtimeId("decision"), text: decision, rationale: "", decidedBy: String(old.createdBy || "unknown"), decidedAt: createdAt }
          : decision)
        : [],
      reports: [],
      audit: Array.isArray(old.audit)
        ? old.audit.map((entry: any) => ({
            id: String(entry.id), at: String(entry.at), actorId: String(entry.actor || "unknown"), action: String(entry.action),
            entityType: "investigation", entityId: String(old.id), summary: String(entry.detail || ""),
          }))
        : [],
      revision: Number(old.revision || 1),
      bindings: {},
    };
    return [migrated];
  });
  return { schemaVersion: 2, investigations, activeId: typeof legacy.activeId === "string" ? legacy.activeId : investigations[0]?.id };
}
