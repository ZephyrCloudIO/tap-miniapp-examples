import { Badge, Button, Checkbox, Label, Textarea } from "@theaiplatform/miniapp-sdk/ui";
import { useState } from "react";
import {
  CHANGES_PROPOSE_ACTION,
  type EngineeringChangeAuthorityGuard,
} from "../authority";
import {
  auditMutation,
  defaultHardTriggers,
  evaluatePolicies,
  type AssurancePolicy,
  type EngineeringChange,
  type RiskDimensions,
} from "../domain";
import { useRuntimeId } from "../runtime-id";
import { EmptyPanel, SectionHeader } from "../ui-helpers";

const dimensionFields = [
  ["reach", "Reach"],
  ["reversibility", "Reversibility"],
  ["novelty", "Novelty"],
  ["userImpact", "User impact"],
  ["operationalImpact", "Operational impact"],
  ["coordination", "Coordination"],
] as const;

export function ProposalView({
  change,
  policies,
  actorId,
  saving,
  authorize,
  onUpdate,
}: {
  change?: EngineeringChange;
  policies: AssurancePolicy[];
  actorId: string;
  saving: boolean;
  authorize: EngineeringChangeAuthorityGuard;
  onUpdate(next: EngineeringChange, notice: string): Promise<boolean>;
}) {
  const idFactory = useRuntimeId();
  const [proposal, setProposal] = useState(change?.proposal ?? "");
  const [dimensions, setDimensions] = useState<RiskDimensions>({
    reach: 1,
    reversibility: 1,
    novelty: 1,
    userImpact: 1,
    operationalImpact: 1,
    coordination: 1,
    hardTriggers: [],
    confidence: 0.8,
  });

  if (!change) {
    return (
      <EmptyPanel
        title="No change selected"
        description="Pick a change from the ledger to shape its proposal."
      />
    );
  }

  const snapshot = evaluatePolicies(policies, dimensions);

  const saveProposal = async () => {
    if (!(await authorize(CHANGES_PROPOSE_ACTION))) return;
    const now = new Date().toISOString();
    await onUpdate(
      auditMutation(
        { ...change, proposal, updatedAt: now },
        actorId,
        "proposal.updated",
        "Updated the Change Proposal.",
        now,
        idFactory,
      ),
      "Proposal saved.",
    );
  };

  const freezeClassification = async () => {
    if (!(await authorize(CHANGES_PROPOSE_ACTION))) return;
    const now = new Date().toISOString();
    await onUpdate(
      auditMutation(
        {
          ...change,
          effectivePolicy: snapshot,
          assuranceLevel: snapshot.assuranceLevel,
          updatedAt: now,
        },
        actorId,
        "assurance.classified",
        `Classified the change as ${snapshot.assuranceLevel}.`,
        now,
        idFactory,
      ),
      `Assurance level frozen at ${snapshot.assuranceLevel}.`,
    );
  };

  return (
    <div className="view-stack" data-component="ProposalView" data-testid="engineering-change-proposal">
      <SectionHeader
        eyebrow="Proposal shaping"
        title="One proposal, system-assigned depth"
        description="Authors never choose 'brief' or 'RFC' — the applicable Assurance Policies assign the level."
        action={
          <Badge data-testid="engineering-change-proposal-level">{snapshot.assuranceLevel}</Badge>
        }
      />
      <section>
        <h3>Change Proposal</h3>
        <Textarea
          aria-label="Change Proposal"
          data-testid="engineering-change-proposal-editor"
          rows={10}
          value={proposal}
          onChange={(event) => setProposal(event.target.value)}
          placeholder="Intent, target scope, predicted impact, rollback story…"
        />
        <div className="dialog-actions">
          <Button
            variant="outline"
            disabled={saving}
            data-testid="engineering-change-proposal-save"
            onClick={() => void saveProposal()}
          >
            Save proposal
          </Button>
        </div>
      </section>
      <section>
        <h3>Classification inputs</h3>
        <div className="form-grid">
          {dimensionFields.map(([key, label]) => (
            <Label key={key} className="field">
              <span>{label}</span>
              <input
                type="range"
                min={0}
                max={5}
                step={1}
                aria-label={label}
                data-testid={`engineering-change-proposal-${key}`}
                value={dimensions[key]}
                onChange={(event) =>
                  setDimensions((current) => ({
                    ...current,
                    [key]: Number(event.target.value),
                  }))
                }
              />
              <span className="quiet">{dimensions[key]} / 5</span>
            </Label>
          ))}
        </div>
        <h4>Hard RFC triggers</h4>
        <div className="form-grid">
          {defaultHardTriggers.map((trigger) => (
            <Label key={trigger} className="field-inline">
              <Checkbox
                aria-label={trigger}
                data-testid={`engineering-change-proposal-trigger-${trigger}`}
                checked={dimensions.hardTriggers.includes(trigger)}
                onCheckedChange={(checked) =>
                  setDimensions((current) => ({
                    ...current,
                    hardTriggers:
                      checked === true
                        ? [...current.hardTriggers, trigger]
                        : current.hardTriggers.filter((item) => item !== trigger),
                  }))
                }
              />
              <span>{trigger}</span>
            </Label>
          ))}
        </div>
        <Label className="field">
          <span>Classifier confidence</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            aria-label="Classifier confidence"
            data-testid="engineering-change-proposal-confidence"
            value={dimensions.confidence}
            onChange={(event) =>
              setDimensions((current) => ({
                ...current,
                confidence: Number(event.target.value),
              }))
            }
          />
          <span className="quiet">{Math.round(dimensions.confidence * 100)}%</span>
        </Label>
      </section>
      <section>
        <h3>Policy explanation</h3>
        <p className="quiet" data-testid="engineering-change-proposal-rationale">
          {snapshot.rationale}
        </p>
        {snapshot.requiredCapabilities.length > 0 ? (
          <p className="quiet">
            Required review capabilities: {snapshot.requiredCapabilities.join(", ")}
          </p>
        ) : null}
        {snapshot.escalated ? (
          <p className="quiet">
            Low-confidence classification escalated the level instead of silently choosing the
            lowest one.
          </p>
        ) : null}
        <div className="dialog-actions">
          <Button
            disabled={saving}
            data-testid="engineering-change-proposal-freeze"
            onClick={() => void freezeClassification()}
          >
            Freeze effective policy snapshot
          </Button>
        </div>
      </section>
    </div>
  );
}
