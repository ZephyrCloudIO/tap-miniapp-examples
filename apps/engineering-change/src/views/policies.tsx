import { Badge, Button, Checkbox, Input, Label } from "@theaiplatform/miniapp-sdk/ui";
import { useState } from "react";
import {
  POLICIES_MANAGE_ACTION,
  type EngineeringChangeAuthorityGuard,
} from "../authority";
import {
  defaultHardTriggers,
  evaluatePolicies,
  type AssurancePolicy,
  type EngineeringChangeState,
} from "../domain";
import { SectionHeader, SelectInput, TextInput } from "../ui-helpers";

export function PoliciesView({
  policies,
  saving,
  authorize,
  onSave,
}: {
  policies: AssurancePolicy[];
  saving: boolean;
  authorize: EngineeringChangeAuthorityGuard;
  onSave(policies: AssurancePolicy[], notice: string): Promise<boolean>;
}) {
  const [draft, setDraft] = useState<AssurancePolicy[]>(policies);
  const [error, setError] = useState<string>();

  const update = (index: number, next: Partial<AssurancePolicy>) =>
    setDraft((current) =>
      current.map((policy, position) =>
        position === index ? { ...policy, ...next } : policy,
      ),
    );

  const addScoped = () =>
    setDraft((current) => [
      ...current,
      {
        id: `team-policy-${current.length}`,
        revision: 1,
        scope: "team",
        scopeId: "team-platform",
        threshold: 14,
        level: "rfc-plus-specialists",
        requiredCapabilities: ["security"],
        hardTriggers: [...defaultHardTriggers],
        locked: false,
        bounds: { min: 8, max: 20 },
      },
    ]);

  const save = async () => {
    if (!(await authorize(POLICIES_MANAGE_ACTION))) return;
    const ids = new Set(draft.map((policy) => policy.id));
    if (ids.size !== draft.length) {
      setError("Policy ids must be unique.");
      return;
    }
    if (!draft.some((policy) => policy.scope === "workspace" && policy.locked)) {
      setError("A locked workspace policy is required as the floor.");
      return;
    }
    setError(undefined);
    await onSave(
      draft.map((policy) => ({ ...policy, revision: policy.revision + 1 })),
      "Assurance policies saved with bumped revisions.",
    );
  };

  return (
    <div className="view-stack" data-component="PoliciesView" data-testid="engineering-change-policies">
      <SectionHeader
        eyebrow="Assurance policies"
        title="Scoped policy settings"
        description="Every applicable policy evaluates independently; the highest level wins and locked workspace requirements are the floor."
        action={
          <Button
            variant="outline"
            data-testid="engineering-change-policies-add"
            onClick={addScoped}
          >
            Add scoped policy
          </Button>
        }
      />
      {error ? (
        <p className="quiet" data-testid="engineering-change-policies-error">
          {error}
        </p>
      ) : null}
      <ul className="entity-list" data-testid="engineering-change-policies-list">
        {draft.map((policy, index) => (
          <li key={`${policy.id}-${index}`} className="policy-card">
            <div className="toolbar">
              <TextInput
                aria-label="Policy id"
                data-testid={`engineering-change-policy-id-${index}`}
                value={policy.id}
                onChange={(event) => update(index, { id: event.target.value })}
              />
              <SelectInput
                aria-label="Policy scope"
                data-testid={`engineering-change-policy-scope-${index}`}
                value={policy.scope}
                onChange={(event) =>
                  update(index, {
                    scope: event.target.value as AssurancePolicy["scope"],
                    scopeId:
                      event.target.value === "workspace" ? null : (policy.scopeId ?? "team-platform"),
                  })
                }
              >
                <option value="workspace">workspace</option>
                <option value="team">team</option>
                <option value="project">project</option>
              </SelectInput>
              <SelectInput
                aria-label="Assurance level"
                data-testid={`engineering-change-policy-level-${index}`}
                value={policy.level}
                onChange={(event) =>
                  update(index, { level: event.target.value as AssurancePolicy["level"] })
                }
              >
                <option value="lightweight">lightweight</option>
                <option value="full-rfc">full-rfc</option>
                <option value="rfc-plus-specialists">rfc-plus-specialists</option>
              </SelectInput>
              <Label className="field-inline">
                <span>Threshold</span>
                <Input
                  type="number"
                  aria-label="Threshold"
                  data-testid={`engineering-change-policy-threshold-${index}`}
                  value={policy.threshold}
                  onChange={(event) =>
                    update(index, { threshold: Number(event.target.value) || policy.threshold })
                  }
                />
              </Label>
              <Label className="field-inline">
                <Checkbox
                  aria-label="Locked"
                  data-testid={`engineering-change-policy-locked-${index}`}
                  checked={policy.locked}
                  onCheckedChange={(checked) => update(index, { locked: checked === true })}
                />
                <span>Locked</span>
              </Label>
            </div>
            <div className="toolbar">
              <TextInput
                aria-label="Required capabilities"
                data-testid={`engineering-change-policy-capabilities-${index}`}
                value={policy.requiredCapabilities.join(", ")}
                onChange={(event) =>
                  update(index, {
                    requiredCapabilities: event.target.value
                      .split(",")
                      .map((item) => item.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="security, architecture"
              />
              <Badge variant="outline">revision {policy.revision}</Badge>
            </div>
          </li>
        ))}
      </ul>
      <section>
        <h3>Evaluation preview</h3>
        <p className="quiet" data-testid="engineering-change-policies-preview">
          {
            evaluatePolicies(draft, {
              reach: 3,
              reversibility: 2,
              novelty: 2,
              userImpact: 2,
              operationalImpact: 1,
              coordination: 2,
              hardTriggers: [],
              confidence: 0.9,
            }).rationale
          }
        </p>
      </section>
      <div className="dialog-actions">
        <Button
          disabled={saving}
          data-testid="engineering-change-policies-save"
          onClick={() => void save()}
        >
          Save policies
        </Button>
      </div>
    </div>
  );
}
