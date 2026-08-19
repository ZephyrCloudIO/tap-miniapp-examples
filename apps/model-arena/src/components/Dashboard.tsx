import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@theaiplatform/miniapp-sdk/ui";
import { ComparisonMode, type ModelComparisonSession } from "../domain";
import { loadSessions } from "../storage";

interface DashboardProps {
  onSelectSession: (session: ModelComparisonSession) => void;
  onNewSession: () => void;
}

interface ModelAggregate {
  modelId: string;
  name: string;
  sessions: number;
  runs: number;
  retentionValues: number[];
  totalCostMicros: number;
  totalLatencyMs: number;
}

const MODE_LABEL: Record<ComparisonMode, string> = {
  [ComparisonMode.OneShot]: "One-Shot",
  [ComparisonMode.Rework]: "Rework",
  [ComparisonMode.Benchmark]: "Benchmark",
  [ComparisonMode.Pipeline]: "Pipeline",
};

function formatMicros(micros: number): string {
  if (micros === 0) return "$0";
  return `$${(micros / 1_000_000).toFixed(4)}`;
}

/** Dashboard over the local session ledger: what have we compared, which
 *  models retain best, and what did it cost. */
export function Dashboard({ onSelectSession, onNewSession }: DashboardProps) {
  const [sessions] = useState<ModelComparisonSession[]>(() => loadSessions());

  const stats = useMemo(() => {
    const byMode = new Map<ComparisonMode, number>();
    const byModel = new Map<string, ModelAggregate>();
    let totalRuns = 0;
    let totalCostMicros = 0;
    const retentionValues: number[] = [];

    for (const session of sessions) {
      byMode.set(session.mode, (byMode.get(session.mode) ?? 0) + 1);
      for (const result of session.results) {
        totalRuns += 1;
        totalCostMicros += result.trr.totalCostMicros;
        const agg = byModel.get(result.model.id) ?? {
          modelId: result.model.id,
          name: result.model.name,
          sessions: 0,
          runs: 0,
          retentionValues: [],
          totalCostMicros: 0,
          totalLatencyMs: 0,
        };
        agg.runs += 1;
        agg.totalCostMicros += result.trr.totalCostMicros;
        agg.totalLatencyMs += result.outputs.reduce((s, o) => s + o.latencyMs, 0);
        if (result.trr.retentionRate !== undefined) {
          agg.retentionValues.push(result.trr.retentionRate);
          retentionValues.push(result.trr.retentionRate);
        }
        byModel.set(result.model.id, agg);
      }
      for (const modelId of new Set(session.results.map((r) => r.model.id))) {
        const agg = byModel.get(modelId);
        if (agg) agg.sessions += 1;
      }
    }

    return {
      byMode,
      byModel: [...byModel.values()].sort((a, b) => b.runs - a.runs),
      totalRuns,
      totalCostMicros,
      avgRetention:
        retentionValues.length > 0
          ? retentionValues.reduce((s, v) => s + v, 0) / retentionValues.length
          : undefined,
    };
  }, [sessions]);

  if (sessions.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Nothing to chart yet</EmptyTitle>
          <EmptyDescription>Run your first comparison and the dashboard will summarize it here.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={onNewSession}>New Comparison</Button>
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "0.75rem" }}>
        <Card>
          <CardHeader><CardTitle style={{ fontSize: "0.75rem", fontWeight: 500 }}>Sessions</CardTitle></CardHeader>
          <CardContent style={{ fontSize: "1.5rem", fontWeight: 600 }}>{sessions.length}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle style={{ fontSize: "0.75rem", fontWeight: 500 }}>Model Runs</CardTitle></CardHeader>
          <CardContent style={{ fontSize: "1.5rem", fontWeight: 600 }}>{stats.totalRuns}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle style={{ fontSize: "0.75rem", fontWeight: 500 }}>Total Cost</CardTitle></CardHeader>
          <CardContent style={{ fontSize: "1.5rem", fontWeight: 600 }}>{formatMicros(stats.totalCostMicros)}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle style={{ fontSize: "0.75rem", fontWeight: 500 }}>Avg Retention</CardTitle></CardHeader>
          <CardContent style={{ fontSize: "1.5rem", fontWeight: 600 }}>
            {stats.avgRetention === undefined ? "—" : `${(stats.avgRetention * 100).toFixed(1)}%`}
          </CardContent>
        </Card>
      </div>

      <div className="row" style={{ flexWrap: "wrap" }}>
        {[...stats.byMode.entries()].map(([mode, count]) => (
          <Badge key={mode} variant="secondary">
            {MODE_LABEL[mode]} × {count}
          </Badge>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle>Models by usage</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Model</TableHead>
                <TableHead>Runs</TableHead>
                <TableHead>Avg Retention</TableHead>
                <TableHead>Avg Latency</TableHead>
                <TableHead>Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stats.byModel.map((agg) => (
                <TableRow key={agg.modelId}>
                  <TableCell>{agg.name}</TableCell>
                  <TableCell>{agg.runs}</TableCell>
                  <TableCell className={
                    agg.retentionValues.length === 0
                      ? "metric-neutral"
                      : (agg.retentionValues.reduce((s, v) => s + v, 0) / agg.retentionValues.length) >= 0.9
                        ? "metric-positive"
                        : "metric-neutral"
                  }>
                    {agg.retentionValues.length === 0
                      ? "—"
                      : `${((agg.retentionValues.reduce((s, v) => s + v, 0) / agg.retentionValues.length) * 100).toFixed(1)}%`}
                  </TableCell>
                  <TableCell className="metric-neutral">
                    {agg.runs > 0 ? `${Math.round(agg.totalLatencyMs / agg.runs)}ms` : "—"}
                  </TableCell>
                  <TableCell>{formatMicros(agg.totalCostMicros)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Recent sessions</CardTitle></CardHeader>
        <CardContent style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
          {sessions.slice(0, 8).map((session) => (
            <Button
              key={session.id}
              variant="ghost"
              style={{ justifyContent: "flex-start", height: "auto", padding: "0.375rem 0.5rem" }}
              onClick={() => onSelectSession(session)}
            >
              {session.id} · {MODE_LABEL[session.mode]} · {session.models.length} models ·{" "}
              <span className="metric-neutral">{session.prompt.slice(0, 50)}{session.prompt.length > 50 ? "…" : ""}</span>
            </Button>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
