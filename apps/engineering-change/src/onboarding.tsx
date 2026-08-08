import { useState } from "react";
import { Alert, AlertDescription, Button, Card, CardContent, FieldGroup, H1, Progress } from "@theaiplatform/miniapp-sdk/ui";
import { ArrowRight, ClipboardCheck, GitBranch, ShieldCheck } from "lucide-react";
import {
  CHANGES_PROPOSE_ACTION,
  type EngineeringChangeAuthorityGuard,
} from "./authority";
import {
  auditMutation,
  nextChangeId,
  type EngineeringChange,
  type EngineeringChangeState,
} from "./domain";
import { useRuntimeId } from "./runtime-id";
import { FormField, TextAreaInput, TextInput } from "./ui-helpers";

export function Onboarding({
  state,
  actorId,
  saving,
  error,
  authorize,
  onCreate,
}: {
  state: EngineeringChangeState;
  actorId: string;
  saving: boolean;
  error?: string;
  authorize: EngineeringChangeAuthorityGuard;
  onCreate(change: EngineeringChange): Promise<boolean>;
}) {
  const idFactory = useRuntimeId();
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [formError, setFormError] = useState<string>();

  const create = async () => {
    if (!title.trim()) {
      setFormError("Give the change a title.");
      return;
    }
    if (!(await authorize(CHANGES_PROPOSE_ACTION))) return;
    setFormError(undefined);
    const now = new Date().toISOString();
    const change: EngineeringChange = {
      id: nextChangeId(state.changes, new Date().getUTCFullYear()),
      title: title.trim(),
      summary: summary.trim(),
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
      createdAt: now,
      updatedAt: now,
      closedAt: null,
    };
    await onCreate(
      auditMutation(change, actorId, "change.created", "Opened the Engineering Change.", now, idFactory),
    );
  };

  return (
    <div className="onboarding-page" data-component="Onboarding" data-testid="engineering-change-onboarding">
      <div className="onboarding-story">
        <span className="pyre-mark">
          <GitBranch aria-hidden="true" /> ENGINEERING CHANGE
        </span>
        <H1>Shape the change before you ship it.</H1>
        <p className="onboarding-lede">
          One durable record from idea through proposal shaping, assurance classification,
          coordinated review, finding disposition, and closure — auditable at every step.
        </p>
        <div className="principle-list">
          <div>
            <ClipboardCheck aria-hidden="true" />
            <span>
              <strong>One proposal, system-assigned depth</strong>
              <small>Assurance Policies decide lightweight proposal, full RFC, or RFC plus specialist reviews.</small>
            </span>
          </div>
          <div>
            <ShieldCheck aria-hidden="true" />
            <span>
              <strong>Review is coordinated, findings are dispositioned</strong>
              <small>A coordinator deduplicates and verifies specialist findings; humans make the final call.</small>
            </span>
          </div>
        </div>
      </div>
      <Card className="intake-card">
        <CardContent>
          <div className="step-heading">
            <div>
              <span className="eyebrow">Start</span>
              <h2>Open an Engineering Change</h2>
            </div>
            <span className="step-count">1 / 1</span>
          </div>
          <Progress value={100} />
          {error ? (
            <Alert variant="destructive" data-testid="engineering-change-onboarding-error">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {formError ? (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}
          <FieldGroup>
            <FormField id="change-title" label="Change title">
              <TextInput
                id="change-title"
                data-testid="engineering-change-intake-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Move billing usage to the fenced referee"
              />
            </FormField>
            <FormField id="change-summary" label="Why now">
              <TextAreaInput
                id="change-summary"
                data-testid="engineering-change-intake-summary"
                rows={4}
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                placeholder="What problem does this change solve, and what happens if we do nothing?"
              />
            </FormField>
          </FieldGroup>
          <div className="dialog-actions">
            <Button
              data-testid="engineering-change-intake-create"
              disabled={saving}
              onClick={() => void create()}
            >
              Open the change <ArrowRight aria-hidden="true" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
