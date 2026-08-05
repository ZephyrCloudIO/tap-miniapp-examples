import { Badge, Button, Input } from "@theaiplatform/miniapp-sdk/ui";
import { Plus } from "lucide-react";
import { useState } from "react";
import {
  CHANGES_PROPOSE_ACTION,
  type EngineeringChangeAuthorityGuard,
} from "../authority";
import {
  auditMutation,
  nextChangeId,
  openFindings,
  type EngineeringChange,
} from "../domain";
import { useRuntimeId } from "../runtime-id";
import { EmptyPanel, SectionHeader } from "../ui-helpers";

export function LedgerView({
  changes,
  actorId,
  saving,
  authorize,
  onCreate,
  onOpenChange,
}: {
  changes: EngineeringChange[];
  actorId: string;
  saving: boolean;
  authorize: EngineeringChangeAuthorityGuard;
  onCreate(change: EngineeringChange): Promise<boolean>;
  onOpenChange(id: string): void;
}) {
  const idFactory = useRuntimeId();
  const [title, setTitle] = useState("");
  const [filter, setFilter] = useState("");

  const create = async () => {
    if (!title.trim() || !(await authorize(CHANGES_PROPOSE_ACTION))) return;
    const now = new Date().toISOString();
    const change: EngineeringChange = {
      id: nextChangeId(changes, new Date().getUTCFullYear()),
      title: title.trim(),
      summary: "",
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
    if (
      await onCreate(
        auditMutation(change, actorId, "change.created", "Opened the Engineering Change.", now, idFactory),
      )
    ) {
      setTitle("");
    }
  };

  const visible = changes.filter(
    (change) =>
      !filter ||
      change.title.toLowerCase().includes(filter.toLowerCase()) ||
      change.id.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <div className="view-stack" data-component="LedgerView" data-testid="engineering-change-ledger">
      <SectionHeader
        eyebrow="Ledger"
        title="Engineering Changes"
        description="The durable record connecting an idea through shaping, implementation, review, and resolution."
      />
      <div className="toolbar">
        <Input
          aria-label="Filter changes"
          data-testid="engineering-change-ledger-filter"
          placeholder="Filter by title or id"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        <Input
          aria-label="New change title"
          data-testid="engineering-change-ledger-new-title"
          placeholder="New change title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <Button
          data-testid="engineering-change-ledger-create"
          disabled={saving || !title.trim()}
          onClick={() => void create()}
        >
          <Plus aria-hidden="true" /> Open change
        </Button>
      </div>
      {visible.length === 0 ? (
        <EmptyPanel
          title="No changes match"
          description="Open a new Engineering Change to start the governed lifecycle."
        />
      ) : (
        <ul className="entity-list">
          {visible.map((change) => (
            <li key={change.id}>
              <button
                type="button"
                data-testid={`engineering-change-ledger-open-${change.id}`}
                onClick={() => onOpenChange(change.id)}
              >
                <span className="entity-title">{change.title}</span>
                <span className="entity-meta">
                  <Badge variant="outline">{change.id}</Badge>
                  <Badge>{change.phase}</Badge>
                  <Badge variant="outline">{change.assuranceLevel}</Badge>
                  {openFindings(change).length > 0 ? (
                    <Badge variant="destructive">{openFindings(change).length} open findings</Badge>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
