import { Badge, Button, Input, Label, Textarea } from "@theaiplatform/miniapp-sdk/ui";
import { useState } from "react";
import {
  CHANGES_REVIEW_ACTION,
  FINDINGS_DISPOSITION_ACTION,
  TASK_WRITE_ACTION,
  type EngineeringChangeAuthorityGuard,
} from "../authority";
import {
  auditMutation,
  dispositionFinding,
  openFindings,
  type EngineeringChange,
  type Finding,
  type FindingAction,
  type FindingDispositionState,
  type ReviewCapability,
} from "../domain";
import { useRuntimeId } from "../runtime-id";
import { createFindingTask } from "../platform";
import { EmptyPanel, FormField, SectionHeader, SelectInput, TextAreaInput, TextInput } from "../ui-helpers";

const capabilities: ReviewCapability[] = [
  "security",
  "architecture",
  "test-sufficiency",
  "operability",
  "domain-ownership",
];

const dispositions: FindingDispositionState[] = [
  "accepted",
  "waived",
  "false-positive",
  "deferred",
  "duplicate",
];

const actions: FindingAction[] = ["task", "issue", "both", "link", "none"];

export function ReviewView({
  change,
  actorId,
  saving,
  authorize,
  onUpdate,
}: {
  change?: EngineeringChange;
  actorId: string;
  saving: boolean;
  authorize: EngineeringChangeAuthorityGuard;
  onUpdate(next: EngineeringChange, notice: string): Promise<boolean>;
}) {
  const idFactory = useRuntimeId();
  const [capability, setCapability] = useState<ReviewCapability>("architecture");
  const [evidenceSummary, setEvidenceSummary] = useState("");
  const [findingSummary, setFindingSummary] = useState("");
  const [findingStandard, setFindingStandard] = useState("workspace-standards:v3");
  const [severity, setSeverity] = useState<Finding["severity"]>("medium");
  const [dispositionState, setDispositionState] = useState<FindingDispositionState>("accepted");
  const [dispositionAction, setDispositionAction] = useState<FindingAction>("task");
  const [rationale, setRationale] = useState("");
  const [error, setError] = useState<string>();

  if (!change) {
    return (
      <EmptyPanel
        title="No change selected"
        description="Pick a change from the ledger to coordinate its review."
      />
    );
  }

  const addContribution = async () => {
    if (!(await authorize(CHANGES_REVIEW_ACTION))) return;
    const now = new Date().toISOString();
    const contribution = {
      id: idFactory("rc"),
      capability,
      skillId: `${capability}-implementation-review`,
      skillVersion: "1.0.0",
      specialistId: null,
      specialistVersion: null,
      candidateFindingIds: [],
      evidenceSummary: evidenceSummary.trim(),
      createdAt: now,
    };
    await onUpdate(
      auditMutation(
        {
          ...change,
          reviewContributions: [...change.reviewContributions, contribution],
          updatedAt: now,
        },
        actorId,
        "review.contribution",
        `Recorded a ${capability} review contribution.`,
        now,
        idFactory,
      ),
      `${capability} review contribution recorded.`,
    );
    setEvidenceSummary("");
  };

  const addFinding = async () => {
    if (!(await authorize(CHANGES_REVIEW_ACTION)) || !findingSummary.trim()) return;
    const now = new Date().toISOString();
    const finding: Finding = {
      id: idFactory("finding"),
      severity,
      category: capability,
      standard: findingStandard.trim() || "workspace-standards:v3",
      file: null,
      line: null,
      symbol: null,
      summary: findingSummary.trim(),
      confidence: 0.8,
      provenance: actorId,
      verification: "candidate",
      disposition: null,
    };
    await onUpdate(
      auditMutation(
        { ...change, findings: [...change.findings, finding], updatedAt: now },
        actorId,
        "review.finding-raised",
        `Raised a ${severity} ${capability} finding.`,
        now,
        idFactory,
      ),
      "Finding raised as a candidate.",
    );
    setFindingSummary("");
  };

  const verifyFinding = async (findingId: string, verification: Finding["verification"]) => {
    if (!(await authorize(CHANGES_REVIEW_ACTION))) return;
    const now = new Date().toISOString();
    await onUpdate(
      auditMutation(
        {
          ...change,
          findings: change.findings.map((finding) =>
            finding.id === findingId ? { ...finding, verification } : finding,
          ),
          updatedAt: now,
        },
        actorId,
        "review.finding-verified",
        `Coordinator marked a finding ${verification}.`,
        now,
        idFactory,
      ),
      `Finding ${verification}.`,
    );
  };

  const applyDisposition = async (findingId: string) => {
    if (!(await authorize(FINDINGS_DISPOSITION_ACTION))) return;
    if (!rationale.trim()) {
      setError("A disposition needs a human rationale.");
      return;
    }
    setError(undefined);
    const finding = change.findings.find((candidate) => candidate.id === findingId);
    if (!finding) {
      setError(`Unknown finding ${findingId}.`);
      return;
    }
    let linkedWork: string | null = null;
    try {
      if (dispositionAction === "task" || dispositionAction === "both") {
        if (!(await authorize(TASK_WRITE_ACTION))) return;
        const task = await createFindingTask(change, finding);
        linkedWork = `tap-task:${task.id}`;
      }
      const now = new Date().toISOString();
      const saved = await onUpdate(
        auditMutation(
          dispositionFinding(change, findingId, {
            state: dispositionState,
            rationale: rationale.trim(),
            action: dispositionAction,
            linkedWork,
            actorId,
            at: now,
          }),
          actorId,
          "findings.dispositioned",
          `Dispositioned a finding as ${dispositionState} (${dispositionAction}).`,
          now,
          idFactory,
        ),
        linkedWork
          ? `Finding dispositioned as ${dispositionState}; follow-up task ${linkedWork.slice("tap-task:".length)} created.`
          : `Finding dispositioned as ${dispositionState}.`,
      );
      if (saved) setRationale("");
    } catch (reason) {
      setError(`The follow-up action could not be completed. ${String(reason)}`);
    }
  };

  const required = change.effectivePolicy?.requiredCapabilities ?? [];
  const covered = new Set<string>(
    change.reviewContributions.map((contribution) => contribution.capability),
  );
  const missing = required.filter((item) => !covered.has(item));
  const open = openFindings(change);

  return (
    <div className="view-stack" data-component="ReviewView" data-testid="engineering-change-review">
      <SectionHeader
        eyebrow="Coordinated review"
        title="Review contributions and findings"
        description="Specialists contribute immutable reviews; a coordinator verifies findings; humans disposition them."
        action={
          missing.length > 0 ? (
            <Badge variant="destructive" data-testid="engineering-change-review-missing">
              Needs assignment: {missing.join(", ")}
            </Badge>
          ) : (
            <Badge data-testid="engineering-change-review-covered">Coverage complete</Badge>
          )
        }
      />
      {error ? <p className="quiet" data-testid="engineering-change-review-error">{error}</p> : null}
      <section>
        <h3>Record a review contribution</h3>
        <div className="toolbar">
          <Label className="field-inline">
            <span>Capability</span>
            <SelectInput
              aria-label="Review capability"
              data-testid="engineering-change-review-capability"
              value={capability}
              onChange={(event) => setCapability(event.target.value as ReviewCapability)}
            >
              {capabilities.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </SelectInput>
          </Label>
        </div>
        <FormField id="contribution-evidence" label="Evidence summary">
          <TextAreaInput
            id="contribution-evidence"
            data-testid="engineering-change-review-evidence-summary"
            rows={3}
            value={evidenceSummary}
            onChange={(event) => setEvidenceSummary(event.target.value)}
          />
        </FormField>
        <div className="dialog-actions">
          <Button
            variant="outline"
            disabled={saving}
            data-testid="engineering-change-review-add-contribution"
            onClick={() => void addContribution()}
          >
            Record contribution
          </Button>
        </div>
        <ul className="entity-list" data-testid="engineering-change-review-contributions">
          {change.reviewContributions.map((contribution) => (
            <li key={contribution.id}>
              <span className="entity-title">
                <Badge>{contribution.capability}</Badge> {contribution.skillId}@
                {contribution.skillVersion}
              </span>
              <span className="entity-meta">
                <span className="quiet">
                  {contribution.createdAt} · {contribution.evidenceSummary || "no summary"}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3>Raise a candidate finding</h3>
        <div className="toolbar">
          <Label className="field-inline">
            <span>Severity</span>
            <SelectInput
              aria-label="Finding severity"
              data-testid="engineering-change-review-severity"
              value={severity}
              onChange={(event) => setSeverity(event.target.value as Finding["severity"])}
            >
              {["critical", "high", "medium", "low", "info"].map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </SelectInput>
          </Label>
          <TextInput
            aria-label="Cited standard"
            data-testid="engineering-change-review-standard"
            value={findingStandard}
            onChange={(event) => setFindingStandard(event.target.value)}
          />
        </div>
        <FormField id="finding-summary" label="Finding">
          <Textarea
            id="finding-summary"
            data-testid="engineering-change-review-finding-summary"
            rows={2}
            value={findingSummary}
            onChange={(event) => setFindingSummary(event.target.value)}
            placeholder="What violates the cited standard, and why does it matter here?"
          />
        </FormField>
        <div className="dialog-actions">
          <Button
            variant="outline"
            disabled={saving || !findingSummary.trim()}
            data-testid="engineering-change-review-add-finding"
            onClick={() => void addFinding()}
          >
            Raise finding
          </Button>
        </div>
      </section>
      <section>
        <h3>Findings ({open.length} open)</h3>
        <div className="toolbar">
          <Label className="field-inline">
            <span>Disposition</span>
            <SelectInput
              aria-label="Disposition state"
              data-testid="engineering-change-review-disposition-state"
              value={dispositionState}
              onChange={(event) =>
                setDispositionState(event.target.value as FindingDispositionState)
              }
            >
              {dispositions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </SelectInput>
          </Label>
          <Label className="field-inline">
            <span>Action</span>
            <SelectInput
              aria-label="Disposition action"
              data-testid="engineering-change-review-disposition-action"
              value={dispositionAction}
              onChange={(event) => setDispositionAction(event.target.value as FindingAction)}
            >
              {actions.map((item) => (
                <option key={item} value={item}>
                  {item === "task"
                    ? "Create TAP task"
                    : item === "issue"
                      ? "Create repository issue"
                      : item === "both"
                        ? "Create both"
                        : item === "link"
                          ? "Link existing work"
                          : "Record no external action"}
                </option>
              ))}
            </SelectInput>
          </Label>
          <Input
            aria-label="Disposition rationale"
            data-testid="engineering-change-review-rationale"
            placeholder="Human rationale"
            value={rationale}
            onChange={(event) => setRationale(event.target.value)}
          />
        </div>
        <ul className="entity-list" data-testid="engineering-change-review-findings">
          {change.findings.map((finding) => (
            <li key={finding.id}>
              <span className="entity-title">
                <Badge variant={finding.severity === "critical" || finding.severity === "high" ? "destructive" : "outline"}>
                  {finding.severity}
                </Badge>{" "}
                {finding.summary}
              </span>
              <span className="entity-meta">
                <Badge variant="outline">{finding.verification}</Badge>
                <span className="quiet">{finding.standard}</span>
                {finding.disposition ? (
                  <>
                    <Badge>{finding.disposition.state}</Badge>
                    {finding.disposition.linkedWork ? (
                      <span className="quiet">{finding.disposition.linkedWork}</span>
                    ) : null}
                  </>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid={`engineering-change-review-verify-${finding.id}`}
                      onClick={() => void verifyFinding(finding.id, "verified")}
                    >
                      Verify
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid={`engineering-change-review-reject-${finding.id}`}
                      onClick={() => void verifyFinding(finding.id, "rejected")}
                    >
                      Reject
                    </Button>
                    <Button
                      size="sm"
                      data-testid={`engineering-change-review-disposition-${finding.id}`}
                      disabled={saving}
                      onClick={() => void applyDisposition(finding.id)}
                    >
                      Disposition
                    </Button>
                  </>
                )}
              </span>
            </li>
          ))}
          {change.findings.length === 0 ? <li className="quiet">No findings yet.</li> : null}
        </ul>
      </section>
    </div>
  );
}
