import { Alert, AlertDescription, Badge, Button, Input } from "@theaiplatform/miniapp-sdk/ui";
import { sdk } from "@theaiplatform/miniapp-sdk/sdk";
import { ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import {
  auditMutation,
  canTransitionPhase,
  markReadyForWork,
  recordWorkStart,
  startedBeforeReady,
  transitionPhase,
  type EngineeringChange,
  type Phase,
} from "../domain";
import { useRuntimeId } from "../runtime-id";
import { EmptyPanel, SectionHeader } from "../ui-helpers";

const phaseActions: Array<{ from: Phase; to: Phase; label: string }> = [
  { from: "draft", to: "shaping", label: "Start shaping" },
  { from: "shaping", to: "review", label: "Submit for review" },
  { from: "implementing", to: "implemented", label: "Mark implemented" },
  { from: "implemented", to: "closed", label: "Close the change" },
];

export function ChangeDetailView({
  change,
  actorId,
  saving,
  onUpdate,
}: {
  change?: EngineeringChange;
  actorId: string;
  saving: boolean;
  onUpdate(next: EngineeringChange, notice: string): Promise<boolean>;
}) {
  const idFactory = useRuntimeId();
  const [error, setError] = useState<string>();

  if (!change) {
    return (
      <EmptyPanel
        title="No change selected"
        description="Pick a change from the ledger to work its lifecycle."
      />
    );
  }

  const act = (next: EngineeringChange, notice: string) => {
    setError(undefined);
    const now = new Date().toISOString();
    void onUpdate(
      auditMutation(next, actorId, "change.transition", notice, now, idFactory),
      notice,
    ).then((ok) => {
      if (!ok) setError("The transition could not be saved.");
    });
  };

  const readyForWork = () => {
    try {
      act(markReadyForWork(change, new Date().toISOString()), "Marked Ready for Work.");
    } catch (reason) {
      setError(String(reason instanceof Error ? reason.message : reason));
    }
  };

  const startWork = () => {
    act(
      recordWorkStart(change, new Date().toISOString(), "explicit-start"),
      change.readyForWorkAt
        ? "Work started."
        : "Work started before readiness — reported, not blocked.",
    );
  };

  return (
    <div className="view-stack" data-component="ChangeDetailView" data-testid="engineering-change-change-detail">
      <SectionHeader
        eyebrow={change.id}
        title={change.title}
        description={change.summary || "No summary yet — shape the proposal next."}
        action={<Badge data-testid="engineering-change-detail-phase">{change.phase}</Badge>}
      />
      {startedBeforeReady(change) ? (
        <Alert data-testid="engineering-change-detail-started-early">
          <ShieldAlert aria-hidden="true" />
          <AlertDescription>
            Work started at {change.workStartedAt} ({change.workStartSource}) before the change was
            marked Ready for Work. This is reported, not blocked.
          </AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive" data-testid="engineering-change-detail-error">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <section>
        <h3>Lifecycle</h3>
        <div className="toolbar">
          {phaseActions
            .filter((action) => action.from === change.phase && canTransitionPhase(change.phase, action.to))
            .map((action) => (
              <Button
                key={action.to}
                variant="outline"
                disabled={saving}
                data-testid={`engineering-change-detail-${action.to}`}
                onClick={() => act(transitionPhase(change, action.to), `Moved to ${action.to}.`)}
              >
                {action.label}
              </Button>
            ))}
          {change.phase === "review" ? (
            <Button
              disabled={saving}
              data-testid="engineering-change-detail-ready-for-work"
              onClick={readyForWork}
            >
              Mark Ready for Work
            </Button>
          ) : null}
          {change.phase !== "closed" && change.phase !== "implemented" && !change.workStartedAt ? (
            <Button
              variant="outline"
              disabled={saving}
              data-testid="engineering-change-detail-start-work"
              onClick={startWork}
            >
              Start work
            </Button>
          ) : null}
          {change.phase !== "closed" ? (
            <Button
              variant="outline"
              disabled={saving}
              data-testid="engineering-change-detail-close"
              onClick={() =>
                act(
                  { ...transitionPhase(change, "closed"), closedAt: new Date().toISOString() },
                  "Closed the Engineering Change.",
                )
              }
            >
              Close
            </Button>
          ) : null}
        </div>
      </section>
      <section>
        <h3>Readiness</h3>
        <dl className="detail-grid">
          <div>
            <dt>Assurance level</dt>
            <dd data-testid="engineering-change-detail-assurance">{change.assuranceLevel}</dd>
          </div>
          <div>
            <dt>Ready for work at</dt>
            <dd>{change.readyForWorkAt ?? "—"}</dd>
          </div>
          <div>
            <dt>Work started at</dt>
            <dd>{change.workStartedAt ?? "—"}</dd>
          </div>
          <div>
            <dt>Work-start source</dt>
            <dd>{change.workStartSource ?? "—"}</dd>
          </div>
        </dl>
      </section>
      <section>
        <h3>Audit trail</h3>
        <ul className="entity-list" data-testid="engineering-change-detail-audit">
          {[...change.audit].reverse().map((entry) => (
            <li key={entry.id}>
              <span className="entity-title">{entry.summary}</span>
              <span className="entity-meta">
                <Badge variant="outline">{entry.action}</Badge>
                <span className="quiet">
                  {entry.actorId} · {entry.at}
                </span>
              </span>
            </li>
          ))}
          {change.audit.length === 0 ? <li className="quiet">No audit entries yet.</li> : null}
        </ul>
      </section>
      <WorkspaceSection change={change} />
    </div>
  );
}

/**
 * Host-backed transition executors: channel notices, the package review
 * specialist, and saved workflows. Each control exercises a declared host
 * grant; denials surface inline without durable side effects.
 */
function WorkspaceSection({ change }: { change: EngineeringChange }) {
  const [channelId, setChannelId] = useState("engineering-change-fixture-channel");
  const [workflowId, setWorkflowId] = useState("engineering-change-fixture-transition");
  const [workflows, setWorkflows] = useState<Array<{ id: string; name: string }>>([]);
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await sdk.workflows.list({});
        if (!active) return;
        setWorkflows(
          result.workflows.map((workflow) => ({ id: workflow.id, name: workflow.name })),
        );
      } catch (reason) {
        if (!active) return;
        setError(`The workspace workflow list is unavailable. ${String(reason)}`);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const joinSpecialist = async () => {
    setError(undefined);
    try {
      if (!sdk.specialist) throw new Error("The specialist capability is unavailable.");
      await sdk.specialist.joinToChannel(channelId, "engineering-change-specialist");
      setStatus("Package-owned Engineering Change specialist joined the change channel.");
    } catch (reason) {
      setError(String(reason instanceof Error ? reason.message : reason));
    }
  };

  const postNotice = async () => {
    setError(undefined);
    try {
      await sdk.channels.sendMessage({
        channelId,
        name: "Engineering Change",
        content: `${change.id} is now ${change.phase}.`,
      });
      setStatus("Lifecycle notice posted to the linked change channel.");
    } catch (reason) {
      setError(String(reason instanceof Error ? reason.message : reason));
    }
  };

  const invokeWorkflow = async () => {
    setError(undefined);
    try {
      const result = await sdk.workflows.invokeSaved({
        workflowId,
        payload: { changeId: change.id, phase: change.phase },
      });
      if (!result.success) throw new Error(result.error ?? result.message);
      setStatus(`Workflow started: ${result.runId ?? result.status}.`);
    } catch (reason) {
      setError(String(reason instanceof Error ? reason.message : reason));
    }
  };

  return (
    <section data-testid="engineering-change-detail-workspace">
      <h3>Workspace execution</h3>
      <div className="toolbar">
        <Input
          aria-label="Change channel id"
          data-testid="engineering-change-detail-channel-id"
          value={channelId}
          onChange={(event) => setChannelId(event.target.value)}
        />
        <Button
          variant="outline"
          data-testid="engineering-change-detail-join-specialist"
          onClick={() => void joinSpecialist()}
        >
          Join coordinator specialist
        </Button>
        <Button
          variant="outline"
          data-testid="engineering-change-detail-post-notice"
          onClick={() => void postNotice()}
        >
          Post lifecycle notice
        </Button>
      </div>
      <div className="toolbar">
        <Input
          aria-label="Transition workflow id"
          data-testid="engineering-change-detail-workflow-id"
          value={workflowId}
          onChange={(event) => setWorkflowId(event.target.value)}
        />
        <Button
          variant="outline"
          data-testid="engineering-change-detail-invoke-workflow"
          onClick={() => void invokeWorkflow()}
        >
          Invoke transition workflow
        </Button>
      </div>
      <p className="quiet" data-testid="engineering-change-detail-workflows">
        Saved workflows: {workflows.length > 0 ? workflows.map((workflow) => workflow.name).join(", ") : "none"}
      </p>
      {status ? (
        <p className="quiet" data-testid="engineering-change-detail-workspace-status">
          {status}
        </p>
      ) : null}
      {error ? (
        <Alert variant="destructive" data-testid="engineering-change-detail-workspace-error">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </section>
  );
}
