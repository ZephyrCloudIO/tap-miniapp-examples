import { useEffect, useState } from "react";
import type { TapFederatedSurfaceMountContext } from "@theaiplatform/miniapp-sdk/surface";
import { Alert, AlertDescription, Badge, Button, MiniAppIconButton as SdkIconButton, Progress, ScrollArea, Separator, Skeleton, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@theaiplatform/miniapp-sdk/ui";
import { Activity, AlertTriangle, Archive, ArrowRight, BarChart3, BookOpenCheck, Bot, Check, ChevronDown, CircleUserRound, ClipboardCheck, FileSearch, FileText, Flame, GitBranch, History, LayoutDashboard, Menu, Network, PanelLeftClose, PanelLeftOpen, Plus, Radio, RefreshCw, ShieldCheck, TimerReset, Users, X } from "lucide-react";
import { Onboarding } from "./onboarding";
import { auditMutation, canEdit, canReview, phases, roleFor, transitionInvestigation, type Actor, type Investigation, type Phase } from "./domain";
import { usePyre } from "./use-pyre";
import { OverviewView } from "./views/overview";
import { EvidenceView } from "./views/evidence";
import { TimelineView } from "./views/timeline";
import { AnalysisView } from "./views/analysis";
import { ActionsView } from "./views/actions";
import { ReportsView } from "./views/reports";
import { PlatformView } from "./views/platform";
import { AuditView } from "./views/audit";

type View = "overview" | "evidence" | "timeline" | "analysis" | "actions" | "reports" | "platform" | "audit";
function MiniAppIconButton(props: Omit<React.ComponentProps<typeof SdkIconButton>, "icon"> & { icon?: React.ComponentProps<typeof SdkIconButton>["icon"]; children?: React.ReactNode }) {
  const { children, icon, label, ...rest } = props;
  return children ? <Button aria-label={label} size="icon" variant="ghost" {...rest}>{children}</Button> : icon ? <SdkIconButton icon={icon} label={label} {...rest} /> : null;
}
const views: Array<{ id: View; label: string; icon: React.ReactNode }> = [
  { id: "overview", label: "Overview", icon: <LayoutDashboard aria-hidden="true" /> },
  { id: "evidence", label: "Evidence", icon: <FileSearch aria-hidden="true" /> },
  { id: "timeline", label: "Timeline", icon: <TimerReset aria-hidden="true" /> },
  { id: "analysis", label: "5 Whys", icon: <GitBranch aria-hidden="true" /> },
  { id: "actions", label: "Actions", icon: <ClipboardCheck aria-hidden="true" /> },
  { id: "reports", label: "Reports", icon: <FileText aria-hidden="true" /> },
  { id: "platform", label: "TAP Platform", icon: <Network aria-hidden="true" /> },
  { id: "audit", label: "Audit Log", icon: <History aria-hidden="true" /> },
];

function initialView(): View {
  const value = new URLSearchParams(globalThis.location?.search).get("view");
  return views.some((view) => view.id === value) ? value as View : "overview";
}

export function PyreApp({ preview = false, surfaceContext }: { preview?: boolean; surfaceContext?: TapFederatedSurfaceMountContext }) {
  const controller = usePyre(preview, surfaceContext);
  const [view, setViewState] = useState<View>(initialView);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [stageError, setStageError] = useState<string>();
  const setView = (next: View) => {
    setViewState(next);
    const url = new URL(globalThis.location.href);
    url.searchParams.set("view", next);
    globalThis.history.replaceState(null, "", url);
    setMobileNav(false);
  };
  useEffect(() => { const onPop = () => setViewState(initialView()); globalThis.addEventListener("popstate", onPop); return () => globalThis.removeEventListener("popstate", onPop); }, []);

  if (controller.loading) return <main id="main-content" className="loading-shell"><div className="loading-mark"><Flame aria-hidden="true" /></div><div><Skeleton className="skeleton-title" /><Skeleton className="skeleton-line" /></div><div className="loading-grid"><Skeleton /><Skeleton /><Skeleton /></div><p>Loading investigation workspace…</p></main>;
  if (!controller.active) return <Onboarding state={controller.state} actor={controller.actor} saving={controller.saving} error={controller.error} onCreate={async (incident) => controller.save({ ...controller.state, investigations: [...controller.state.investigations, incident], activeId: incident.id }, "Investigation created and saved.")} />;
  const investigation = controller.active;
  const role = roleFor(investigation, controller.actor.id) || "stakeholder";
  const currentStage = phases.indexOf(investigation.phase);
  const nextPhase = phases[currentStage + 1];
  const canAdvance = Boolean(nextPhase) && investigation.phase !== "review" && (canEdit(investigation, controller.actor.id) || canReview(investigation, controller.actor.id));

  const advance = async () => {
    if (!nextPhase) return;
    try { await controller.updateIncident(transitionInvestigation(investigation, nextPhase, controller.actor.id), `Investigation advanced to ${nextPhase}.`); }
    catch (reason) { setStageError(String(reason)); }
  };
  const deleteIncident = async () => {
    const remaining = controller.state.investigations.filter((item) => item.id !== investigation.id);
    await controller.save({ ...controller.state, investigations: remaining, activeId: remaining[0]?.id }, "Investigation removed from Pyre storage.");
  };

  return <TooltipProvider><div className={`app-shell ${railCollapsed ? "rail-collapsed" : ""}`}>
    <a className="skip-link" href="#main-content">Skip to investigation content</a>
    <aside className={`app-rail ${mobileNav ? "mobile-open" : ""}`} aria-label="Pyre navigation">
      <div className="rail-brand"><span className="brand-icon"><Flame aria-hidden="true" /></span>{!railCollapsed ? <div><strong>Pyre</strong><small>Incident learning</small></div> : null}<MiniAppIconButton className="mobile-close" label="Close navigation" icon={X} onClick={() => setMobileNav(false)} /></div>
      <div className="incident-switcher"><button type="button" className="incident-button"><span className={`severity-dot severity-${investigation.severity.toLowerCase()}`} />{!railCollapsed ? <span><strong>{investigation.title}</strong><small>{investigation.id.slice(-12)}</small></span> : null}{!railCollapsed ? <ChevronDown aria-hidden="true" /> : null}</button>{!railCollapsed ? <div className="incident-menu">{controller.state.investigations.filter((item) => item.id !== investigation.id).map((item) => <button type="button" onClick={() => void controller.selectIncident(item.id)} key={item.id}>{item.title}</button>)}<button type="button" onClick={() => void controller.save({ ...controller.state, activeId: undefined }, "Ready for a new investigation.")}><Plus aria-hidden="true" />New investigation</button></div> : null}</div>
      <nav className="rail-nav">{views.map((item) => <Tooltip key={item.id}><TooltipTrigger asChild><button type="button" className={view === item.id ? "active" : ""} aria-current={view === item.id ? "page" : undefined} onClick={() => setView(item.id)}>{item.icon}{!railCollapsed ? <span>{item.label}</span> : null}{!railCollapsed ? <NavCount view={item.id} investigation={investigation} /> : null}</button></TooltipTrigger>{railCollapsed ? <TooltipContent side="right">{item.label}</TooltipContent> : null}</Tooltip>)}</nav>
      <div className="rail-footer">{!railCollapsed ? <div className="presence"><span className="presence-dot" /><span>{controller.platform.presenceCount} present</span><Badge variant="outline">{controller.context.preview ? "Preview" : "TAP"}</Badge></div> : null}<MiniAppIconButton label={railCollapsed ? "Expand navigation" : "Collapse navigation"} icon={railCollapsed ? PanelLeftOpen : PanelLeftClose} onClick={() => setRailCollapsed((current) => !current)} /></div>
    </aside>
    <div className="workspace-shell">
      <header className="command-header"><MiniAppIconButton className="mobile-menu" label="Open navigation" onClick={() => setMobileNav(true)}><Menu aria-hidden="true" /></MiniAppIconButton><div className="command-title"><div className="title-row"><h1>{investigation.title}</h1><Badge variant={investigation.status === "resolved" ? "default" : "secondary"}>{investigation.status}</Badge><Badge variant="outline">{investigation.severity}</Badge></div><p>{investigation.statement}</p></div><div className="command-actions">{preview ? <label className="identity-select"><span>Viewing as</span><select value={controller.actor.id} onChange={(event) => { const selected = investigation.members.find((item) => item.id === event.target.value); controller.setPreviewActor(selected ? { id: selected.id, displayName: selected.displayName } : { id: "external-stakeholder", displayName: "External stakeholder" }); }}><option value="external-stakeholder">External stakeholder</option>{investigation.members.map((member) => <option value={member.id} key={member.id}>{member.displayName} · {member.role}</option>)}</select></label> : null}<div className="actor-chip"><span className="avatar">{controller.actor.displayName.slice(0, 2).toUpperCase()}</span><div><strong>{controller.actor.displayName}</strong><small>{role}</small></div></div></div></header>
      <div className="stage-bar"><div className="stage-copy"><span className="stage-number">{currentStage + 1}</span><div><small>CURRENT STAGE</small><strong>{investigation.phase}</strong></div></div><div className="stage-track">{phases.map((phase, index) => <div className={index < currentStage ? "complete" : index === currentStage ? "current" : ""} key={phase}><span>{index < currentStage ? <Check aria-hidden="true" /> : index + 1}</span><small>{phase}</small></div>)}</div>{investigation.phase === "review" ? <Tooltip><TooltipTrigger asChild><Button disabled><ShieldCheck aria-hidden="true" />Publish</Button></TooltipTrigger><TooltipContent>Zephyr Cloud publication is not exposed by TAP SDK 0.2.0-pr.6821.02b36a6.</TooltipContent></Tooltip> : nextPhase ? <Button disabled={!canAdvance || controller.saving} onClick={() => void advance()}>{controller.saving ? "Saving…" : <><span className="desktop-advance">Advance to {nextPhase}</span><span className="mobile-advance">Advance</span><ArrowRight aria-hidden="true" /></>}</Button> : null}</div>
      <div className="message-region" aria-live="polite">{controller.notice ? <Alert><Check aria-hidden="true" /><AlertDescription>{controller.notice}</AlertDescription><button aria-label="Dismiss notification" onClick={controller.clearMessage}><X aria-hidden="true" /></button></Alert> : null}{stageError ? <Alert variant="destructive"><AlertTriangle aria-hidden="true" /><AlertDescription>{stageError}</AlertDescription><button aria-label="Dismiss lifecycle error" onClick={() => setStageError(undefined)}><X aria-hidden="true" /></button></Alert> : null}{controller.error ? <Alert variant="destructive"><AlertTriangle aria-hidden="true" /><AlertDescription>{controller.error}</AlertDescription><Button size="sm" variant="outline" onClick={() => void controller.reload()}><RefreshCw aria-hidden="true" />Reload</Button></Alert> : null}</div>
      <ScrollArea className="workspace-scroll"><main id="main-content" className="workspace-content">{view === "overview" ? <OverviewView investigation={investigation} actor={controller.actor} saving={controller.saving} onUpdate={controller.updateIncident} onDelete={deleteIncident} /> : view === "evidence" ? <EvidenceView investigation={investigation} actor={controller.actor} saving={controller.saving} context={controller.context} onUpdate={controller.updateIncident} /> : view === "timeline" ? <TimelineView investigation={investigation} actor={controller.actor} saving={controller.saving} onUpdate={controller.updateIncident} /> : view === "analysis" ? <AnalysisView investigation={investigation} actor={controller.actor} saving={controller.saving} onUpdate={controller.updateIncident} /> : view === "actions" ? <ActionsView investigation={investigation} actor={controller.actor} saving={controller.saving} onUpdate={controller.updateIncident} /> : view === "reports" ? <ReportsView investigation={investigation} actor={controller.actor} saving={controller.saving} onUpdate={controller.updateIncident} /> : view === "platform" ? <PlatformView investigation={investigation} actor={controller.actor} saving={controller.saving} context={controller.context} platform={controller.platform} onUpdate={controller.updateIncident} /> : <AuditView investigation={investigation} />}</main></ScrollArea>
    </div>
  </div></TooltipProvider>;
}

function NavCount({ view, investigation }: { view: View; investigation: Investigation }) {
  const value = view === "evidence" ? investigation.evidence.length : view === "timeline" ? investigation.timeline.length : view === "analysis" ? investigation.whys.length : view === "actions" ? investigation.actions.filter((item) => item.status !== "verified").length : view === "reports" ? investigation.reports.length : view === "audit" ? investigation.audit.length : 0;
  return value ? <span className="nav-count">{value}</span> : null;
}
