import { useState } from "react";
import type { TapFederatedSurfaceMountContext } from "@theaiplatform/miniapp-sdk/surface";
import {
  Alert,
  AlertDescription,
  Button,
  ScrollArea,
  Skeleton,
} from "@theaiplatform/miniapp-sdk/ui";
import {
  ClipboardCheck,
  FileSearch,
  FileText,
  GitBranch,
  LayoutDashboard,
  ListChecks,
  Settings2,
} from "lucide-react";
import {
  requireEngineeringChangeAuthority,
  type EngineeringChangeAuthorityAction,
  type EngineeringChangeAuthorityGuard,
} from "./authority";
import type { EngineeringChange } from "./domain";
import { Onboarding } from "./onboarding";
import { useEngineeringChange } from "./use-engineering-change";
import {
  parseEngineeringChangeViewHash,
  type EngineeringChangeView,
} from "./view-location";
import { ChangeDetailView } from "./views/change-detail";
import { EvidenceView } from "./views/evidence";
import { LedgerView } from "./views/ledger";
import { OverviewView } from "./views/overview";
import { PoliciesView } from "./views/policies";
import { ProposalView } from "./views/proposal";
import { ReviewView } from "./views/review";

const views: Array<{ id: EngineeringChangeView; label: string; icon: React.ReactNode }> = [
  { id: "overview", label: "Overview", icon: <LayoutDashboard aria-hidden="true" /> },
  { id: "ledger", label: "Ledger", icon: <ListChecks aria-hidden="true" /> },
  { id: "change-detail", label: "Change", icon: <GitBranch aria-hidden="true" /> },
  { id: "proposal", label: "Proposal", icon: <FileText aria-hidden="true" /> },
  { id: "evidence", label: "Evidence", icon: <FileSearch aria-hidden="true" /> },
  { id: "review", label: "Review", icon: <ClipboardCheck aria-hidden="true" /> },
  { id: "policies", label: "Policies", icon: <Settings2 aria-hidden="true" /> },
];

function initialView(): EngineeringChangeView {
  return parseEngineeringChangeViewHash(globalThis.location?.hash ?? "");
}

export function EngineeringChangeApp({
  preview = false,
  surfaceContext,
}: {
  preview?: boolean;
  surfaceContext?: TapFederatedSurfaceMountContext;
}) {
  const controller = useEngineeringChange(preview, surfaceContext);
  const [view, setViewState] = useState<EngineeringChangeView>(initialView);
  const [authorityError, setAuthorityError] = useState<string>();
  const actorId = "workspace-member";

  const authorize: EngineeringChangeAuthorityGuard = async (
    actionId: EngineeringChangeAuthorityAction,
  ) => {
    try {
      await requireEngineeringChangeAuthority(surfaceContext, preview, actionId);
      setAuthorityError(undefined);
      return true;
    } catch (reason) {
      setAuthorityError(String(reason instanceof Error ? reason.message : reason));
      return false;
    }
  };

  const setView = (next: EngineeringChangeView) => {
    setViewState(next);
    if (globalThis.location) {
      globalThis.location.hash = new URLSearchParams({ view: next }).toString();
    }
  };

  const openChange = (id: string) => {
    controller.selectChange(id);
    setView("change-detail");
  };

  const createChange = async (change: EngineeringChange) => {
    const ok = await controller.save(
      { ...controller.state, changes: [...controller.state.changes, change] },
      `Opened ${change.id}.`,
    );
    if (ok) openChange(change.id);
    return ok;
  };

  if (controller.loading) {
    return (
      <div className="loading-shell" data-testid="engineering-change-loading">
        <Skeleton className="skeleton-title" />
        <Skeleton className="skeleton-line" />
      </div>
    );
  }

  if (controller.state.changes.length === 0) {
    return (
      <Onboarding
        state={controller.state}
        actorId={actorId}
        saving={controller.saving}
        error={authorityError ?? controller.error}
        authorize={authorize}
        onCreate={createChange}
      />
    );
  }

  return (
    <div className="app-shell" data-component="EngineeringChangeApp">
      <nav className="app-rail" aria-label="Engineering Change views">
        <div className="rail-brand">
          <span className="brand-icon">
            <GitBranch aria-hidden="true" />
          </span>
          <span className="brand-name">Engineering Change</span>
        </div>
        <ScrollArea className="rail-scroll">
          {views.map((item) => (
            <Button
              key={item.id}
              variant={view === item.id ? "secondary" : "ghost"}
              className="rail-item"
              data-testid={`engineering-change-nav-${item.id}`}
              onClick={() => setView(item.id)}
            >
              {item.icon}
              <span>{item.label}</span>
            </Button>
          ))}
        </ScrollArea>
      </nav>
      <main className="app-main">
        {authorityError ? (
          <Alert variant="destructive" data-testid="engineering-change-authority-error">
            <AlertDescription>{authorityError}</AlertDescription>
          </Alert>
        ) : null}
        {controller.error ? (
          <Alert variant="destructive" data-testid="engineering-change-error">
            <AlertDescription>{controller.error}</AlertDescription>
          </Alert>
        ) : null}
        {controller.notice ? (
          <Alert data-testid="engineering-change-notice">
            <AlertDescription>{controller.notice}</AlertDescription>
          </Alert>
        ) : null}
        {view === "overview" ? (
          <OverviewView
            changes={controller.state.changes}
            preview={preview}
            onOpenLedger={() => setView("ledger")}
            onOpenChange={openChange}
          />
        ) : null}
        {view === "ledger" ? (
          <LedgerView
            changes={controller.state.changes}
            actorId={actorId}
            saving={controller.saving}
            authorize={authorize}
            onCreate={createChange}
            onOpenChange={openChange}
          />
        ) : null}
        {view === "change-detail" ? (
          <ChangeDetailView
            change={controller.active}
            actorId={actorId}
            saving={controller.saving}
            onUpdate={controller.updateChange}
          />
        ) : null}
        {view === "proposal" ? (
          <ProposalView
            change={controller.active}
            policies={controller.state.policies}
            actorId={actorId}
            saving={controller.saving}
            authorize={authorize}
            onUpdate={controller.updateChange}
          />
        ) : null}
        {view === "evidence" ? (
          <EvidenceView
            change={controller.active}
            actorId={actorId}
            saving={controller.saving}
            authorize={authorize}
            onUpdate={controller.updateChange}
          />
        ) : null}
        {view === "review" ? (
          <ReviewView
            change={controller.active}
            actorId={actorId}
            saving={controller.saving}
            authorize={authorize}
            onUpdate={controller.updateChange}
          />
        ) : null}
        {view === "policies" ? (
          <PoliciesView
            policies={controller.state.policies}
            saving={controller.saving}
            authorize={authorize}
            onSave={(policies, notice) =>
              controller.save({ ...controller.state, policies }, notice)
            }
          />
        ) : null}
      </main>
    </div>
  );
}
