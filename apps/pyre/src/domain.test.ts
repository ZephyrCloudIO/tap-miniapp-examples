import { describe, expect, it } from "@rstest/core";
import {
  addReplaySafe,
  auditMutation,
  buildReportMarkdown,
  canEdit,
  canManageMembers,
  canReview,
  emptyState,
  isPyreState,
  migrateState,
  reportReadiness,
  transitionInvestigation,
  validateIncident,
  validateSourceLinks,
  type Investigation,
  type Role,
} from "./domain";

const makeIncident = (role: Role = "lead"): Investigation => ({
  schemaVersion: 2,
  id: "inc_runtime_test",
  title: "Checkout requests unavailable",
  statement: "Customers received HTTP 503 responses while submitting checkout requests.",
  severity: "SEV-1",
  status: "investigating",
  impact: "Customers could not complete purchases.",
  businessImpact: "Order completion decreased during the incident window.",
  systems: ["checkout-api"],
  regions: ["us-east-1"],
  times: { start: "2026-07-17T09:00:00.000Z" },
  sourceLinks: [],
  phase: "intake",
  createdAt: "2026-07-17T10:00:00.000Z",
  updatedAt: "2026-07-17T10:00:00.000Z",
  createdBy: "actor-1",
  members: [{ id: "actor-1", displayName: "Runtime Actor", role, joinedAt: "2026-07-17T10:00:00.000Z" }],
  evidence: [], timeline: [], whys: [], actions: [], questions: [], decisions: [], reports: [], audit: [], revision: 1, bindings: {},
});

describe("Pyre domain", () => {
  it("starts with no domain records", () => expect(emptyState()).toEqual({ schemaVersion: 2, investigations: [] }));
  it("validates intake boundaries", () => expect(validateIncident({ title: "x", statement: "guess", impact: "" })).toHaveLength(3));
  it("accepts observable incident intake", () => expect(validateIncident(makeIncident())).toEqual([]));
  it("accepts HTTP source links and rejects unsafe or malformed links", () => {
    expect(validateSourceLinks(["https://status.example.com/incidents/123"])).toEqual([]);
    expect(validateSourceLinks(["javascript:alert(1)", "not a URL"])).toHaveLength(2);
  });
  it("round-trips the current schema", () => expect(isPyreState(JSON.parse(JSON.stringify({ ...emptyState(), investigations: [makeIncident()] })))).toBe(true));
  it("migrates the previous schema without inventing records", () => {
    const migrated = migrateState({ schemaVersion: 1, activeId: "old", investigations: [{ id: "old", title: "Old incident", statement: "An observable legacy incident statement.", impact: "Unknown", createdBy: "u", createdAt: "2026-01-01T00:00:00.000Z", members: { u: "lead" }, evidence: [], timeline: [], whys: [], actions: [], questions: [], decisions: [], audit: [] }] });
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.investigations).toHaveLength(1);
    expect(migrated.investigations[0]?.members[0]?.role).toBe("lead");
  });
  it("enforces editor, reviewer, and member-manager permissions", () => {
    expect(canEdit(makeIncident("investigator"), "actor-1")).toBe(true);
    expect(canEdit(makeIncident("stakeholder"), "actor-1")).toBe(false);
    expect(canReview(makeIncident("reviewer"), "actor-1")).toBe(true);
    expect(canManageMembers(makeIncident("lead"), "actor-1")).toBe(true);
    expect(canManageMembers(makeIncident("reviewer"), "actor-1")).toBe(false);
  });
  it("advances lifecycle one reviewed state at a time", () => {
    expect(transitionInvestigation(makeIncident(), "evidence collection", "actor-1").phase).toBe("evidence collection");
    expect(() => transitionInvestigation(makeIncident(), "analysis", "actor-1")).toThrow(/one reviewed/);
  });
  it("rejects lifecycle changes from read-only roles", () => expect(() => transitionInvestigation(makeIncident("stakeholder"), "evidence collection", "actor-1")).toThrow(/role/));
  it("gates review when actions lack an owner", () => {
    const incident = { ...makeIncident(), phase: "action planning" as const, actions: [{ id: "a", title: "Validate config", category: "prevention" as const, priority: "high" as const, owner: "", acceptanceCriteria: "Test passes", verificationMethod: "Run test", requiredEvidence: "CI result", evidenceIds: [], status: "open" as const }] };
    expect(() => transitionInvestigation(incident, "review", "actor-1")).toThrow(/Assign every/);
  });
  it("gates published lifecycle on an approved internal report", () => {
    const incident = { ...makeIncident(), phase: "review" as const };
    expect(() => transitionInvestigation(incident, "published", "actor-1")).toThrow(/Approve/);
  });
  it("records immutable audit before and after values", () => {
    const before = makeIncident(), after = auditMutation({ ...before, status: "resolved" }, "actor-1", "incident.updated", "investigation", before.id, "Resolved", "investigating", "resolved");
    expect(after.revision).toBe(2);
    expect(after.audit[0]?.before).toBe("investigating");
    expect(after.audit[0]?.after).toBe("resolved");
  });
  it("protects duplicate/replayed entity IDs", () => expect(addReplaySafe([{ id: "same" }], { id: "same" })).toHaveLength(1));
  it("redacts non-public evidence from public report variants", () => {
    const incident = { ...makeIncident(), evidence: [{ id: "e1", title: "Private log", kind: "log" as const, source: "private", description: "", collectedAt: "2026-01-01T00:00:00Z", collectedBy: "u", visibility: "restricted" as const, digest: "abc", reliability: "", systems: [], supportsClaimIds: [], contradictsClaimIds: [], timelineEventIds: [], immutableSnapshot: false, collectionStatus: "reference" as const }] };
    expect(buildReportMarkdown(incident, "public")).not.toContain("Private log");
    expect(buildReportMarkdown(incident, "internal")).toContain("Private log");
  });
  it("reports specific approval blockers", () => {
    const blockers = reportReadiness(makeIncident(), "internal");
    expect(blockers).toContain("Confirm at least 1 timeline event.");
    expect(blockers).toContain("Collect or reference at least 1 evidence item.");
  });
  it("requires separate public visibility review", () => {
    const incident = { ...makeIncident(), evidence: [{ id: "e1", title: "Internal log", kind: "log" as const, source: "private", description: "", collectedAt: "2026-01-01T00:00:00Z", collectedBy: "u", visibility: "investigation" as const, digest: "abc", reliability: "", systems: [], supportsClaimIds: [], contradictsClaimIds: [], timelineEventIds: [], immutableSnapshot: false, collectionStatus: "reference" as const }] };
    expect(reportReadiness(incident, "public")).toContain("Complete a separate public-source visibility review.");
  });
});
