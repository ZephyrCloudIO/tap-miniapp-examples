import { Alert, AlertDescription, Badge, Button, Input } from "@theaiplatform/miniapp-sdk/ui";
import { useState } from "react";
import {
  EVIDENCE_CAPTURE_ACTION,
  type EngineeringChangeAuthorityGuard,
} from "../authority";
import {
  auditMutation,
  type EngineeringChange,
  type ImpactEvidence,
  type ImpactHypothesis,
} from "../domain";
import { governedHttpRead, GovernedHttpError } from "../platform";
import { useRuntimeId } from "../runtime-id";
import { EmptyPanel, FormField, SectionHeader, TextAreaInput, TextInput } from "../ui-helpers";

function splitList(value: string): string[] {
  return value
    .split(/[\n,]/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function EvidenceView({
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
  const [hypothesisText, setHypothesisText] = useState("");
  const [blastRadius, setBlastRadius] = useState("");
  const [confidence, setConfidence] = useState(0.7);
  const [diffUrl, setDiffUrl] = useState("");
  const [sourceCommit, setSourceCommit] = useState("");
  const [error, setError] = useState<string>();
  const [capturing, setCapturing] = useState(false);

  if (!change) {
    return (
      <EmptyPanel
        title="No change selected"
        description="Pick a change from the ledger to compose its evidence."
      />
    );
  }

  const recordHypothesis = async () => {
    if (!(await authorize(EVIDENCE_CAPTURE_ACTION))) return;
    const hypothesis: ImpactHypothesis = {
      relatedSymbols: splitList(hypothesisText),
      likelyOwners: [],
      applicablePolicies:
        change.effectivePolicy?.contributingPolicies.map((policy) => policy.policyId) ?? [],
      relevantStandards: [],
      similarChanges: [],
      predictedBlastRadius: blastRadius || "unknown",
      confidence,
      unresolvedQuestions: [],
      recordedAt: new Date().toISOString(),
    };
    const now = new Date().toISOString();
    await onUpdate(
      auditMutation(
        { ...change, impactHypothesis: hypothesis, updatedAt: now },
        actorId,
        "evidence.hypothesis-recorded",
        "Recorded the Impact Hypothesis.",
        now,
        idFactory,
      ),
      "Impact Hypothesis recorded.",
    );
  };

  const captureEvidence = async () => {
    if (!(await authorize(EVIDENCE_CAPTURE_ACTION))) return;
    setCapturing(true);
    setError(undefined);
    try {
      const { receipt } = await governedHttpRead({ url: diffUrl });
      const evidence: ImpactEvidence = {
        changedSymbols: [],
        affectedFiles: [receipt.finalUrl],
        coverageNotes: "",
        fragilityNotes: "",
        drift: "none",
        graphRevision: null,
        sourceCommit: sourceCommit.trim() || null,
        recordedAt: receipt.capturedAt,
      };
      const now = new Date().toISOString();
      await onUpdate(
        auditMutation(
          { ...change, impactEvidence: evidence, updatedAt: now },
          actorId,
          "evidence.impact-captured",
          `Captured Impact Evidence (${receipt.digest.slice(0, 12)}…, HTTP ${receipt.status}).`,
          now,
          idFactory,
        ),
        `Impact Evidence captured with digest ${receipt.digest.slice(0, 12)}….`,
      );
    } catch (reason) {
      setError(
        reason instanceof GovernedHttpError
          ? reason.message
          : `The governed read failed. ${String(reason)}`,
      );
    } finally {
      setCapturing(false);
    }
  };

  return (
    <div className="view-stack" data-component="EvidenceView" data-testid="engineering-change-evidence">
      <SectionHeader
        eyebrow="CKG evidence"
        title="Impact Hypothesis and Impact Evidence"
        description="Hypothesis before implementation, exact revision-bound evidence after — drift becomes a Needs Reassessment signal."
      />
      {error ? (
        <Alert variant="destructive" data-testid="engineering-change-evidence-error">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <section>
        <h3>
          Impact Hypothesis{" "}
          {change.impactHypothesis ? <Badge variant="outline">recorded</Badge> : null}
        </h3>
        {change.impactHypothesis ? (
          <dl className="detail-grid" data-testid="engineering-change-evidence-hypothesis">
            <div>
              <dt>Related symbols</dt>
              <dd>{change.impactHypothesis.relatedSymbols.join(", ") || "—"}</dd>
            </div>
            <div>
              <dt>Predicted blast radius</dt>
              <dd>{change.impactHypothesis.predictedBlastRadius}</dd>
            </div>
            <div>
              <dt>Confidence</dt>
              <dd>{Math.round(change.impactHypothesis.confidence * 100)}%</dd>
            </div>
            <div>
              <dt>Recorded at</dt>
              <dd>{change.impactHypothesis.recordedAt}</dd>
            </div>
          </dl>
        ) : null}
        <FormField
          id="hypothesis-symbols"
          label="Related symbols (one per line)"
          hint="Symbols, communities, or processes the proposal likely touches."
        >
          <TextAreaInput
            id="hypothesis-symbols"
            data-testid="engineering-change-evidence-symbols"
            rows={3}
            value={hypothesisText}
            onChange={(event) => setHypothesisText(event.target.value)}
          />
        </FormField>
        <FormField id="blast-radius" label="Predicted blast radius">
          <TextInput
            id="blast-radius"
            data-testid="engineering-change-evidence-blast-radius"
            value={blastRadius}
            onChange={(event) => setBlastRadius(event.target.value)}
            placeholder="two modules and the billing worker"
          />
        </FormField>
        <div className="dialog-actions">
          <Button
            variant="outline"
            disabled={saving}
            data-testid="engineering-change-evidence-record-hypothesis"
            onClick={() => void recordHypothesis()}
          >
            Record hypothesis
          </Button>
        </div>
      </section>
      <section>
        <h3>
          Impact Evidence{" "}
          {change.impactEvidence ? (
            <Badge variant="outline" data-testid="engineering-change-evidence-drift">
              drift: {change.impactEvidence.drift}
            </Badge>
          ) : null}
        </h3>
        {change.impactEvidence ? (
          <dl className="detail-grid" data-testid="engineering-change-evidence-impact">
            <div>
              <dt>Affected files</dt>
              <dd>{change.impactEvidence.affectedFiles.join(", ") || "—"}</dd>
            </div>
            <div>
              <dt>Source commit</dt>
              <dd>{change.impactEvidence.sourceCommit ?? "—"}</dd>
            </div>
            <div>
              <dt>Graph revision</dt>
              <dd>{change.impactEvidence.graphRevision ?? "—"}</dd>
            </div>
            <div>
              <dt>Recorded at</dt>
              <dd>{change.impactEvidence.recordedAt}</dd>
            </div>
          </dl>
        ) : null}
        <FormField
          id="diff-url"
          label="Governed diff URL (https://api.github.com only)"
          hint="The host-mediated read is digested and receipted; no other origin is reachable."
        >
          <TextInput
            id="diff-url"
            data-testid="engineering-change-evidence-diff-url"
            value={diffUrl}
            onChange={(event) => setDiffUrl(event.target.value)}
            placeholder="https://api.github.com/repos/ZephyrCloudIO/ze-agency-tauri/pulls/7989/files"
          />
        </FormField>
        <FormField id="source-commit" label="Source commit (optional)">
          <Input
            id="source-commit"
            data-testid="engineering-change-evidence-source-commit"
            value={sourceCommit}
            onChange={(event) => setSourceCommit(event.target.value)}
            placeholder="0be6c970a…"
          />
        </FormField>
        <div className="dialog-actions">
          <Button
            disabled={saving || capturing || !diffUrl.trim()}
            data-testid="engineering-change-evidence-capture"
            onClick={() => void captureEvidence()}
          >
            Capture governed evidence
          </Button>
        </div>
      </section>
    </div>
  );
}
