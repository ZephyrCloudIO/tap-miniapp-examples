import { Badge, Button } from "@theaiplatform/miniapp-sdk/ui";
import { sdk } from "@theaiplatform/miniapp-sdk/sdk";
import { ArrowRight, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import {
  openFindings,
  phases,
  startedBeforeReady,
  type EngineeringChange,
} from "../domain";
import { Metric, SectionHeader } from "../ui-helpers";

export function OverviewView({
  changes,
  preview,
  onOpenLedger,
  onOpenChange,
}: {
  changes: EngineeringChange[];
  preview: boolean;
  onOpenLedger(): void;
  onOpenChange(id: string): void;
}) {
  const [actor, setActor] = useState<string>("workspace member");
  useEffect(() => {
    let active = true;
    if (preview || !sdk.auth) return undefined;
    void (async () => {
      try {
        const profile = await sdk.auth!.getUserProfile();
        if (active && profile?.name) setActor(profile.name);
      } catch {
        // The surface still renders; the actor line keeps its fallback.
      }
    })();
    return () => {
      active = false;
    };
  }, [preview]);

  const open = changes.filter((change) => change.phase !== "closed");
  const inReview = open.filter((change) => change.phase === "review");
  const ready = open.filter((change) => change.phase === "ready-for-work");
  const early = open.filter(startedBeforeReady);
  const unresolvedFindings = open.reduce((count, change) => count + openFindings(change).length, 0);
  const recent = [...open]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5);

  return (
    <div className="view-stack" data-component="OverviewView" data-testid="engineering-change-overview">
      <SectionHeader
        eyebrow="Workspace"
        title="Change ledger at a glance"
        description="Every open Engineering Change, its assurance level, and what needs a human next."
        action={
          <Button data-testid="engineering-change-overview-open-ledger" onClick={onOpenLedger}>
            Open ledger <ArrowRight aria-hidden="true" />
          </Button>
        }
      />
      <p className="quiet" data-testid="engineering-change-overview-actor">
        Signed in as {actor}
      </p>
      <div className="metric-grid">
        <Metric value={open.length} label="Open changes" />
        <Metric value={inReview.length} label="In review" />
        <Metric value={ready.length} label="Ready for work" />
        <Metric value={unresolvedFindings} label="Open findings" tone={unresolvedFindings > 0 ? "warning" : "neutral"} />
      </div>
      {early.length > 0 ? (
        <div className="notice-banner" data-testid="engineering-change-overview-started-early">
          <ShieldAlert aria-hidden="true" />
          <span>
            {early.length === 1 ? "One change" : `${early.length} changes`} started work before
            readiness. This is reported, not blocked — review the work-start provenance on each
            change.
          </span>
        </div>
      ) : null}
      <section>
        <h3>Recently updated</h3>
        <ul className="entity-list">
          {recent.map((change) => (
            <li key={change.id}>
              <button
                type="button"
                data-testid={`engineering-change-overview-open-${change.id}`}
                onClick={() => onOpenChange(change.id)}
              >
                <span className="entity-title">{change.title}</span>
                <span className="entity-meta">
                  <Badge variant="outline">{change.id}</Badge>
                  <Badge>{change.phase}</Badge>
                  <Badge variant="outline">{change.assuranceLevel}</Badge>
                </span>
              </button>
            </li>
          ))}
          {recent.length === 0 ? <li className="quiet">No open changes yet.</li> : null}
        </ul>
      </section>
      <section>
        <h3>Lifecycle</h3>
        <ol className="phase-list">
          {phases.map((phase) => (
            <li key={phase}>
              <Badge variant="outline">{phase}</Badge>
              <span className="quiet">
                {changes.filter((change) => change.phase === phase).length}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
