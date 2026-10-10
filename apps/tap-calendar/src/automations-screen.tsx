import { Check, Copy, GitBranch, MessagesSquare, Zap } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { copyTextToClipboard } from "./clipboard";
import type { CalendarState } from "./domain";
import "./automations-screen.css";

export function AutomationsScreen({ state, assistantPanel }: {
  readonly state: CalendarState;
  readonly assistantPanel: ReactNode;
}) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  useEffect(() => {
    if (!copiedId) return;
    const timer = globalThis.setTimeout(() => setCopiedId(null), 1600);
    return () => globalThis.clearTimeout(timer);
  }, [copiedId]);
  const hasBookingEventSteps = state.workflowNodes.some(node => node.kind === "trigger");
  return (
    <div className="automations">
      {assistantPanel}
      <section className="automation-section" aria-labelledby="workflow-steps-title">
        <header className="automation-section-header">
          <div>
            <h2 id="workflow-steps-title">Workflow steps</h2>
            <p>Calendar steps you can add to workflows in TAP Workflow Builder.</p>
          </div>
        </header>
        <div className="workflow-steps" role="table" aria-label="Calendar workflow steps">
          <div className="workflow-steps-head" role="row">
            <span role="columnheader">Step</span>
            <span role="columnheader">Type</span>
            <span role="columnheader">Node ID</span>
          </div>
          {state.workflowNodes.map(node => (
            <div className="workflow-step" role="row" key={node.id}>
              <div role="cell" className="workflow-step-name">
                <span className={`workflow-step-icon is-${node.kind}`} aria-hidden="true">{node.kind === "trigger" ? <Zap /> : <GitBranch />}</span>
                <div><strong>{node.name}</strong><span>{node.description}</span></div>
              </div>
              <div role="cell"><span className={`workflow-step-kind is-${node.kind}`}>{node.kind === "trigger" ? "Booking event" : "Action"}</span></div>
              <div role="cell" className="workflow-step-id">
                <code>{node.id}</code>
                <button
                  type="button"
                  className="booking-inline-icon"
                  aria-label={copiedId === node.id ? `Copied ${node.name} node ID` : `Copy ${node.name} node ID`}
                  title={copiedId === node.id ? "Copied" : "Copy node ID"}
                  onClick={() => void copyTextToClipboard(node.id).then(() => setCopiedId(node.id), () => undefined)}
                >
                  {copiedId === node.id ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                </button>
              </div>
            </div>
          ))}
        </div>
        {hasBookingEventSteps ? (
          <p className="automation-footnote">Booking event steps format a booking payload that your workflow passes in. Calendar doesn’t send new or cancelled bookings to workflows automatically yet.</p>
        ) : null}
      </section>
      <section className="automation-tip" aria-labelledby="channel-scheduling-title">
        <span aria-hidden="true"><MessagesSquare /></span>
        <div>
          <h2 id="channel-scheduling-title">Schedule from a channel</h2>
          <p>In any TAP channel, open <b>Mini Apps → Schedule</b> to find a time with the people in that channel. You can add external guests by email.</p>
        </div>
      </section>
    </div>
  );
}
