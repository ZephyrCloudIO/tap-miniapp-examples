import "@theaiplatform/miniapp-sdk/ui/styles.css";
import { useState, useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { TapFederatedSurfaceMountContext } from "@theaiplatform/miniapp-sdk/surface";
import {
  Button,
  MiniAppPageHeader,
  MiniAppPageHeaderActions,
  MiniAppPageHeaderContent,
  MiniAppPageHeaderTitle,
} from "@theaiplatform/miniapp-sdk/ui";
import { type ModelComparisonSession } from "./domain";
import { SessionComposer } from "./components/SessionComposer";
import { ResultsViewer } from "./components/ResultsViewer";
import { SessionLedger } from "./components/SessionLedger";
import { Dashboard } from "./components/Dashboard";
import { getCreatorIdentity, getWorkspaceId } from "./config";

interface ModelArenaAppProps {
  context?: TapFederatedSurfaceMountContext;
  preview?: boolean;
}

type View = "dashboard" | "ledger" | "composer" | "results";

export function ModelArenaApp({ context, preview }: ModelArenaAppProps) {
  const [activeSession, setActiveSession] = useState<ModelComparisonSession | null>(null);
  const [forkSource, setForkSource] = useState<ModelComparisonSession | null>(null);
  const [view, setView] = useState<View>("dashboard");
  const [isComparisonRunning, setIsComparisonRunning] = useState(false);
  const subscribeOwner = useCallback(
    (listener: () => void) => context?.owner.subscribe(listener) ?? (() => undefined),
    [context],
  );
  const getOwnerSnapshot = useCallback(
    () => context?.owner.getSnapshot() ?? null,
    [context],
  );
  const owner = useSyncExternalStore(subscribeOwner, getOwnerSnapshot, getOwnerSnapshot);
  const conversationId = owner?.conversationId ?? context?.conversationId;
  const workspaceId = owner?.workspaceId ?? context?.workspaceId;
  const storageWorkspaceId = workspaceId ?? getWorkspaceId();
  const storageUserId = context?.userId ?? getCreatorIdentity();
  const storageScope = JSON.stringify([storageWorkspaceId, storageUserId]);
  const currentStorageScope = useRef(storageScope);
  currentStorageScope.current = storageScope;
  const [viewScope, setViewScope] = useState(storageScope);
  const scopeIsCurrent = viewScope === storageScope;
  const visibleView = scopeIsCurrent ? view : "dashboard";

  useEffect(() => {
    if (viewScope === storageScope) return;
    setActiveSession(null);
    setForkSource(null);
    setView("dashboard");
    setViewScope(storageScope);
  }, [storageScope, viewScope]);

  const handleSessionSelected = useCallback((session: ModelComparisonSession) => {
    setActiveSession(session);
    setForkSource(null);
    setView("results");
  }, []);

  const handleSessionCreated = useCallback(
    (session: ModelComparisonSession, sourceScope: string) => {
      if (sourceScope !== currentStorageScope.current) return;
      handleSessionSelected(session);
    },
    [handleSessionSelected],
  );

  const handleNewSession = useCallback(() => {
    setActiveSession(null);
    setForkSource(null);
    setView("composer");
  }, []);

  const handleFork = useCallback((session: ModelComparisonSession) => {
    setActiveSession(null);
    setForkSource(session);
    setView("composer");
  }, []);

  const handleBackToDashboard = useCallback(() => {
    setActiveSession(null);
    setForkSource(null);
    setView("dashboard");
  }, []);

  return (
    <div className="model-arena">
      <MiniAppPageHeader>
        <MiniAppPageHeaderContent>
          <MiniAppPageHeaderTitle>Model Arena</MiniAppPageHeaderTitle>
        </MiniAppPageHeaderContent>
        <MiniAppPageHeaderActions>
          <Button
            variant={visibleView === "dashboard" ? "default" : "outline"}
            size="sm"
            onClick={handleBackToDashboard}
            disabled={isComparisonRunning}
          >
            Dashboard
          </Button>
          <Button
            variant={visibleView === "ledger" ? "default" : "outline"}
            size="sm"
            disabled={isComparisonRunning}
            onClick={() => {
              setActiveSession(null);
              setForkSource(null);
              setView("ledger");
            }}
          >
            Ledger
          </Button>
          <Button size="sm" onClick={handleNewSession} disabled={isComparisonRunning}>
            New Comparison
          </Button>
        </MiniAppPageHeaderActions>
      </MiniAppPageHeader>

      <main className="model-arena-main" key={storageScope}>
        {visibleView === "dashboard" && (
          <Dashboard
            onSelectSession={handleSessionSelected}
            onNewSession={handleNewSession}
            workspaceId={storageWorkspaceId}
            userId={storageUserId}
          />
        )}
        {visibleView === "ledger" && (
          <SessionLedger
            onSelectSession={handleSessionSelected}
            onNewSession={handleNewSession}
            workspaceId={storageWorkspaceId}
            userId={storageUserId}
          />
        )}
        {visibleView === "composer" && (
          <SessionComposer
            onSessionCreated={(session) => handleSessionCreated(session, storageScope)}
            onRunningChange={setIsComparisonRunning}
            initialDraft={scopeIsCurrent ? forkSource ?? undefined : undefined}
            conversationId={conversationId ?? undefined}
            workspaceId={workspaceId ?? undefined}
            creatorId={context?.userId}
          />
        )}
        {visibleView === "results" && scopeIsCurrent && activeSession && (
          <ResultsViewer
            session={activeSession}
            onBack={handleBackToDashboard}
            onFork={handleFork}
          />
        )}
      </main>

      {preview && (
        <div className="preview-banner">Preview Mode</div>
      )}
    </div>
  );
}

export default ModelArenaApp;
