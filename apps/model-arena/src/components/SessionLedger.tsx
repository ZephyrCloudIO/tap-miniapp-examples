import { useState, type MouseEvent } from "react";
import {
  Badge,
  Button,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@theaiplatform/miniapp-sdk/ui";
import { ComparisonMode, type ModelComparisonSession } from "../domain";
import { deleteSession, loadSessions } from "../storage";

interface SessionLedgerProps {
  onSelectSession: (session: ModelComparisonSession) => void;
  onNewSession: () => void;
}

export function SessionLedger({ onSelectSession, onNewSession }: SessionLedgerProps) {
  const [sessions, setSessions] = useState<ModelComparisonSession[]>(() => loadSessions());
  const [search, setSearch] = useState("");

  const handleDelete = (event: MouseEvent, sessionId: string) => {
    event.stopPropagation();
    setSessions(deleteSession(sessionId));
  };

  const filtered = search.trim()
    ? sessions.filter((s) => {
        const q = search.trim().toLowerCase();
        return (
          s.id.toLowerCase().includes(q) ||
          s.prompt.toLowerCase().includes(q) ||
          s.models.some((m) => m.id.toLowerCase().includes(q)) ||
          (s.tags ?? []).some((t) => t.toLowerCase().includes(q))
        );
      })
    : sessions;

  if (sessions.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No comparison sessions yet</EmptyTitle>
          <EmptyDescription>Create your first comparison to see results here.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={onNewSession}>New Comparison</Button>
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <div className="session-ledger">
      <Input
        type="search"
        className="ledger-search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={`Search ${sessions.length} session${sessions.length === 1 ? "" : "s"}...`}
      />
      {filtered.length === 0 && (
        <p className="metric-neutral" style={{ fontSize: "0.875rem" }}>
          No sessions match "{search}".
        </p>
      )}
      {filtered.map((session) => (
        <Item
          key={session.id}
          variant="outline"
          style={{ cursor: "pointer" }}
          onClick={() => onSelectSession(session)}
        >
          <ItemContent>
            <ItemTitle>
              {session.id} · {session.mode === ComparisonMode.Benchmark
                ? `Benchmark (${session.reworkRounds} round${session.reworkRounds === 1 ? "" : "s"})`
                : session.mode === ComparisonMode.Pipeline
                  ? `Pipeline (${new Set(session.results.map((r) => r.runIndex ?? 0)).size} run${new Set(session.results.map((r) => r.runIndex ?? 0)).size === 1 ? "" : "s"})`
                  : session.mode === ComparisonMode.Rework
                    ? `Rework Arena (${session.reworkRounds} round${session.reworkRounds === 1 ? "" : "s"})`
                    : "One-Shot"}
            </ItemTitle>
            <ItemDescription>
              {new Date(session.createdAt).toLocaleString()} · {session.models.length} models · {session.prompt.slice(0, 60)}
              {session.prompt.length > 60 ? "…" : ""}
              {session.parentSessionId ? ` · fork of ${session.parentSessionId}` : ""}
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            {session.tags?.map((tag) => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => handleDelete(e, session.id)}
            >
              Delete
            </Button>
          </ItemActions>
        </Item>
      ))}
    </div>
  );
}
