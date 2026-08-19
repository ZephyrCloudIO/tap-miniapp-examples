import "@theaiplatform/miniapp-sdk/ui/styles.css";
import { useState, useCallback } from "react";
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

interface ModelArenaAppProps {
  context?: TapFederatedSurfaceMountContext;
  preview?: boolean;
}

type View = "dashboard" | "ledger" | "composer" | "results";

export function ModelArenaApp({ context, preview }: ModelArenaAppProps) {
  const [activeSession, setActiveSession] = useState<ModelComparisonSession | null>(null);
  const [forkSource, setForkSource] = useState<ModelComparisonSession | null>(null);
  const [view, setView] = useState<View>("dashboard");

  const handleSessionCreated = useCallback((session: ModelComparisonSession) => {
    setActiveSession(session);
    setForkSource(null);
    setView("results");
  }, []);

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
            variant={view === "dashboard" ? "default" : "outline"}
            size="sm"
            onClick={handleBackToDashboard}
          >
            Dashboard
          </Button>
          <Button
            variant={view === "ledger" ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setActiveSession(null);
              setForkSource(null);
              setView("ledger");
            }}
          >
            Ledger
          </Button>
          <Button size="sm" onClick={handleNewSession}>
            New Comparison
          </Button>
        </MiniAppPageHeaderActions>
      </MiniAppPageHeader>

      <main className="model-arena-main">
        {view === "dashboard" && (
          <Dashboard onSelectSession={handleSessionCreated} onNewSession={handleNewSession} />
        )}
        {view === "ledger" && (
          <SessionLedger onSelectSession={handleSessionCreated} onNewSession={handleNewSession} />
        )}
        {view === "composer" && (
          <SessionComposer
            onSessionCreated={handleSessionCreated}
            initialDraft={forkSource ?? undefined}
            conversationId={context?.conversationId}
            workspaceId={context?.workspaceId}
          />
        )}
        {view === "results" && activeSession && (
          <ResultsViewer
            session={activeSession}
            onBack={handleBackToDashboard}
            onFork={handleFork}
            conversationId={context?.conversationId}
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
