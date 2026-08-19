import { useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@theaiplatform/miniapp-sdk/ui";
import { ComparisonMode, type ModelComparisonSession } from "../domain";
import { WorkspaceTrrPanel } from "./WorkspaceTrrPanel";
import { shareTextToChat } from "../host";
import { getVfsApi, sessionDir } from "../vfs";

interface ResultsViewerProps {
  session: ModelComparisonSession;
  onBack: () => void;
  onFork: (session: ModelComparisonSession) => void;
  /** Host conversation whose VFS holds this session's artifacts. */
  conversationId?: string | undefined;
}

/** Sorted list of all stages present in the session. */
function allStages(session: ModelComparisonSession): number[] {
  const stages = new Set<number>();
  for (const result of session.results) {
    for (const output of result.outputs) stages.add(output.stage);
  }
  return [...stages].sort((a, b) => a - b);
}

function formatPercent(value: number | undefined): string {
  return value === undefined ? "—" : `${(value * 100).toFixed(1)}%`;
}

/** Build a Markdown export of the session: metrics table + outputs. */
export function exportSessionMarkdown(session: ModelComparisonSession): string {
  const stages = allStages(session);
  const isRework = session.mode === ComparisonMode.Rework || session.mode === ComparisonMode.Benchmark;
  const isBenchmark = session.mode === ComparisonMode.Benchmark;
  const isPipeline = session.mode === ComparisonMode.Pipeline;
  const modeLabel =
    session.mode === ComparisonMode.Benchmark
      ? "Benchmark (model vs model+specialist)"
      : session.mode === ComparisonMode.Pipeline
        ? "Pipeline (role chain)"
        : isRework
          ? "Rework Arena"
          : "One-Shot";

  const header = ["Model"];
  if (isPipeline) header.push("Run", "Role");
  if (isBenchmark) header.push("Arm");
  header.push(...stages.map((s) => `Stage ${s} Tokens`), "Latency (ms)", "Cost (μ$)");
  if (isRework) header.push("Retention", "ECRT (μ$/tok)");
  const lines: string[] = [
    `# Model Arena — ${session.id}`,
    "",
    `- Mode: ${modeLabel}`,
    `- Created: ${session.createdAt}`,
    `- Creator: ${session.creator}`,
    session.parentSessionId ? `- Forked from: ${session.parentSessionId}` : "",
    `- Prompt: ${session.prompt}`,
    "",
    "| " + header.join(" | ") + " |",
    "| " + header.map(() => "---").join(" | ") + " |",
  ].filter((line) => line !== "" || true);

  for (const result of session.results) {
    const totalLatency = result.outputs.reduce((sum, o) => sum + o.latencyMs, 0);
    const estimated = result.outputs.some((o) => o.estimated);
    const row = [result.model.id];
    if (isPipeline) row.push(`#${(result.runIndex ?? 0) + 1}`, result.role ?? "—");
    if (isBenchmark) row.push(result.arm === "specialist" ? "model+specialist" : "model");
    row.push(
      ...stages.map((s) => {
        const value = result.outputs.find((o) => o.stage === s)?.tokens.completion;
        return value === undefined ? "—" : `${value}${estimated ? "*" : ""}`;
      }),
      String(totalLatency),
      String(result.trr.totalCostMicros),
    );
    if (isRework) {
      row.push(formatPercent(result.trr.retentionRate), String(result.trr.ecrtMicros ?? "—"));
    }
    lines.push("| " + row.join(" | ") + " |");
  }

  if (isBenchmark) {
    lines.push("", "\\* Specialist-arm token counts are estimated from text length.");
  }

  lines.push("", "## Outputs", "");
  for (const result of session.results) {
    const armLabel = isBenchmark ? (result.arm === "specialist" ? " — model+specialist" : " — model only") : "";
    const roleLabel = isPipeline && result.role ? `Run #${(result.runIndex ?? 0) + 1} ${result.role} — ` : "";
    lines.push(`### ${roleLabel}${result.model.name} (\`${result.model.id}\`)${armLabel}`, "");
    for (const output of [...result.outputs].sort((a, b) => a.stage - b.stage)) {
      if (isRework) lines.push(`#### Stage ${output.stage}`, "");
      lines.push("```", output.text, "```", "");
    }
  }

  return lines.join("\n");
}

function downloadTextFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function ResultsViewer({ session, onBack, onFork, conversationId }: ResultsViewerProps) {
  const isRework = session.mode === ComparisonMode.Rework || session.mode === ComparisonMode.Benchmark;
  const isBenchmark = session.mode === ComparisonMode.Benchmark;
  const isPipeline = session.mode === ComparisonMode.Pipeline;
  const stages = allStages(session);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);

  const handleExportMarkdown = () => {
    downloadTextFile(`${session.id}.md`, exportSessionMarkdown(session), "text/markdown");
  };

  const handleExportJson = () => {
    downloadTextFile(`${session.id}.json`, JSON.stringify(session, null, 2), "application/json");
  };

  const handleShare = async () => {
    const markdown = exportSessionMarkdown(session);
    if (await shareTextToChat(markdown)) {
      setShareFeedback("Sent to chat composer");
    } else {
      try {
        await navigator.clipboard.writeText(markdown);
        setShareFeedback("Copied to clipboard");
      } catch {
        setShareFeedback("Share failed — use Export instead");
      }
    }
    setTimeout(() => setShareFeedback(null), 3000);
  };

  return (
    <div className="results-viewer">
      <Card>
        <CardHeader>
          <CardTitle>Session {session.id}</CardTitle>
        </CardHeader>
        <CardContent style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <p className="metric-neutral" style={{ margin: 0, fontSize: "0.875rem" }}>
            Mode: {isBenchmark
              ? `Benchmark · ${session.reworkRounds} round${session.reworkRounds === 1 ? "" : "s"}`
              : isPipeline
                ? `Pipeline · ${session.results.length} role${session.results.length === 1 ? "" : "s"}`
                : isRework
                  ? `Rework Arena · ${session.reworkRounds} round${session.reworkRounds === 1 ? "" : "s"}`
                  : "One-Shot"} · {session.models.length} models
            {session.parentSessionId ? ` · forked from ${session.parentSessionId}` : ""}
          </p>
          {conversationId && getVfsApi() && (
            <p className="metric-neutral" style={{ margin: 0, fontSize: "0.75rem" }}>
              Artifacts: {sessionDir(session)}/ (conversation VFS)
            </p>
          )}
          <div className="row">
            <Button variant="default" size="sm" onClick={handleShare}>
              Share Results
            </Button>
            <Button variant="secondary" size="sm" onClick={() => onFork(session)}>
              Fork
            </Button>
            <Button variant="secondary" size="sm" onClick={handleExportMarkdown}>
              Export Markdown
            </Button>
            <Button variant="secondary" size="sm" onClick={handleExportJson}>
              Export JSON
            </Button>
            {shareFeedback && (
              <span className="metric-neutral" style={{ fontSize: "0.8125rem" }}>
                {shareFeedback}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Model</TableHead>
            {isPipeline && <TableHead>Run</TableHead>}
            {isPipeline && <TableHead>Role</TableHead>}
            {isPipeline && <TableHead>Arm</TableHead>}
            {isBenchmark && <TableHead>Arm</TableHead>}
            {stages.map((s) => (
              <TableHead key={s}>Stage {s} Tokens</TableHead>
            ))}
            {isRework && <TableHead>Discarded</TableHead>}
            {isRework && <TableHead>Retention</TableHead>}
            {isRework && <TableHead>Turn Pressure</TableHead>}
            <TableHead>Latency</TableHead>
            <TableHead>Cost (μ$)</TableHead>
            {isRework && <TableHead>ECRT (μ$/tok)</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {session.results.map((result) => {
            const totalLatency = result.outputs.reduce((sum, o) => sum + o.latencyMs, 0);
            const estimated = result.outputs.some((o) => o.estimated);

            return (
              <TableRow key={`${result.runIndex ?? 0}:${result.role ?? result.arm ?? "model"}:${result.model.id}`}>
                <TableCell>{result.model.name}</TableCell>
                {isPipeline && <TableCell className="metric-neutral">#{(result.runIndex ?? 0) + 1}</TableCell>}
                {isPipeline && <TableCell>{result.role ?? "—"}</TableCell>}
                {isPipeline && (
                  <TableCell className="metric-neutral">
                    {result.arm === "specialist" ? "Model + Specialist" : "Model only"}
                  </TableCell>
                )}
                {isBenchmark && (
                  <TableCell className="metric-neutral">
                    {result.arm === "specialist" ? "Model + Specialist" : "Model only"}
                  </TableCell>
                )}
                {stages.map((s) => (
                  <TableCell key={s}>
                    {result.outputs.find((o) => o.stage === s)?.tokens.completion ?? "—"}
                    {estimated && result.outputs.some((o) => o.stage === s) ? "*" : ""}
                  </TableCell>
                ))}
                {isRework && (
                  <TableCell className="metric-negative">{result.trr.discardedTokens ?? 0}</TableCell>
                )}
                {isRework && (
                  <TableCell className={
                    (result.trr.retentionRate ?? 0) >= 0.9
                      ? "metric-positive"
                      : (result.trr.retentionRate ?? 0) >= 0.7
                        ? "metric-neutral"
                        : "metric-negative"
                  }>
                    {formatPercent(result.trr.retentionRate)}
                  </TableCell>
                )}
                {isRework && (
                  <TableCell className="metric-neutral">
                    {result.trr.turnPressure === undefined ? "—" : result.trr.turnPressure.toFixed(3)}
                  </TableCell>
                )}
                <TableCell>{totalLatency}ms</TableCell>
                <TableCell>{result.trr.totalCostMicros}</TableCell>
                {isRework && (
                  <TableCell className="metric-neutral">{result.trr.ecrtMicros ?? "—"}</TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {session.results.some((r) => r.outputs.some((o) => o.estimated)) && (
        <p className="metric-neutral" style={{ margin: 0, fontSize: "0.75rem" }}>
          * Specialist-arm token counts are estimated from text length; the host reports content but not usage for specialist turns.
        </p>
      )}

      {isBenchmark && <BenchmarkDelta session={session} />}

      {isRework && session.results.some((r) => r.trr.rounds.length > 1) && (
        <Card>
          <CardHeader>
            <CardTitle>Per-Round Survival</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead>Round</TableHead>
                  <TableHead>Regenerated</TableHead>
                  <TableHead>Discarded</TableHead>
                  <TableHead>Retention</TableHead>
                  <TableHead>r_i</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {session.results.flatMap((result) =>
                  result.trr.rounds.map((round) => (
                    <TableRow key={`${result.arm ?? "model"}:${result.model.id}-r${round.stage}`}>
                      <TableCell>
                        {result.model.name}
                        {isBenchmark ? (result.arm === "specialist" ? " · +specialist" : " · model only") : ""}
                      </TableCell>
                      <TableCell>Stage {round.stage}</TableCell>
                      <TableCell>{round.regeneratedTokens}</TableCell>
                      <TableCell className="metric-negative">{round.discardedTokens}</TableCell>
                      <TableCell>{formatPercent(round.retentionRate)}</TableCell>
                      <TableCell className="metric-neutral">
                        {round.turnPressure === undefined ? "—" : round.turnPressure.toFixed(3)}
                      </TableCell>
                    </TableRow>
                  )),
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {isPipeline ? (
        [...new Set(session.results.map((r) => r.runIndex ?? 0))]
          .sort((a, b) => a - b)
          .map((runIndex) => {
            const runResults = session.results
              .filter((r) => (r.runIndex ?? 0) === runIndex)
              .sort((a, b) => (session.pipelineRoles ?? []).findIndex((role) => role.label === a.role) - (session.pipelineRoles ?? []).findIndex((role) => role.label === b.role));
            return (
              <div key={runIndex} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                <h3 style={{ margin: 0, fontSize: "0.9375rem" }}>
                  Run #{runIndex + 1}:{" "}
                  <span className="metric-neutral" style={{ fontWeight: 400 }}>
                    {runResults
                      .map((r) => `${r.role}:${r.model.id.split("/").pop()}${r.arm === "specialist" ? "+s" : ""}`)
                      .join(" → ")}
                  </span>
                </h3>
                <div className="output-panels">
                  {runResults.map((result) => (
                    <OutputPanel key={`${result.role}:${result.model.id}`} result={result} isRework={isRework} isPipeline />
                  ))}
                </div>
              </div>
            );
          })
      ) : (
        <div className="output-panels">
          {session.results.map((result) => (
            <OutputPanel
              key={`${result.arm ?? "model"}:${result.model.id}`}
              result={result}
              isRework={isRework}
              isBenchmark={isBenchmark}
            />
          ))}
        </div>
      )}

      <div>
        <Button variant="secondary" onClick={onBack}>
          Back to Ledger
        </Button>
      </div>

      <WorkspaceTrrPanel />
    </div>
  );
}

/** Per-model arm comparison for benchmark sessions: did the specialist arm
 *  retain more, and at what latency/cost trade-off? */
function BenchmarkDelta({ session }: { session: ModelComparisonSession }) {
  const rows = session.models.flatMap((model) => {
    const modelArm = session.results.find((r) => r.model.id === model.id && r.arm !== "specialist");
    const specialistArm = session.results.find((r) => r.model.id === model.id && r.arm === "specialist");
    if (!modelArm || !specialistArm) return [];

    const retentionDelta =
      modelArm.trr.retentionRate !== undefined && specialistArm.trr.retentionRate !== undefined
        ? specialistArm.trr.retentionRate - modelArm.trr.retentionRate
        : undefined;
    const latencyDelta =
      specialistArm.outputs.reduce((s, o) => s + o.latencyMs, 0) -
      modelArm.outputs.reduce((s, o) => s + o.latencyMs, 0);
    const ecrtDelta =
      modelArm.trr.ecrtMicros !== undefined && specialistArm.trr.ecrtMicros !== undefined
        ? specialistArm.trr.ecrtMicros - modelArm.trr.ecrtMicros
        : undefined;

    return [{ model, retentionDelta, latencyDelta, ecrtDelta }];
  });

  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Arm Comparison — Model only vs Model + Specialist</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Model</TableHead>
              <TableHead>Retention Δ</TableHead>
              <TableHead>ECRT Δ (μ$/tok)</TableHead>
              <TableHead>Latency Δ</TableHead>
              <TableHead>Verdict</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ model, retentionDelta, latencyDelta, ecrtDelta }) => (
              <TableRow key={model.id}>
                <TableCell>{model.name}</TableCell>
                <TableCell className={
                  retentionDelta === undefined
                    ? "metric-neutral"
                    : retentionDelta > 0.01
                      ? "metric-positive"
                      : retentionDelta < -0.01
                        ? "metric-negative"
                        : "metric-neutral"
                }>
                  {retentionDelta === undefined
                    ? "—"
                    : `${retentionDelta > 0 ? "+" : ""}${(retentionDelta * 100).toFixed(1)}%`}
                </TableCell>
                <TableCell className="metric-neutral">
                  {ecrtDelta === undefined ? "—" : `${ecrtDelta > 0 ? "+" : ""}${ecrtDelta}`}
                </TableCell>
                <TableCell className="metric-neutral">
                  {latencyDelta > 0 ? "+" : ""}{latencyDelta}ms
                </TableCell>
                <TableCell>
                  {retentionDelta === undefined
                    ? "—"
                    : retentionDelta > 0.01
                      ? "Specialist arm retained more"
                      : retentionDelta < -0.01
                        ? "Model-only arm retained more"
                        : "No meaningful difference"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/** One model/role output card. */
function OutputPanel({
  result,
  isRework,
  isBenchmark = false,
  isPipeline = false,
}: {
  result: ModelComparisonSession["results"][number];
  isRework: boolean;
  isBenchmark?: boolean;
  isPipeline?: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.5rem" }}>
          <span>
            {isPipeline && result.role ? `${result.role} — ` : ""}
            {result.model.name}
            {isBenchmark ? (result.arm === "specialist" ? " · Model + Specialist" : " · Model only") : ""}
            {isPipeline ? (result.arm === "specialist" ? " · specialist" : "") : ""}
          </span>
          <span className="metric-neutral" style={{ fontSize: "0.75rem", fontWeight: 400 }}>
            {result.outputs[0]?.providerUsed ?? ""} {result.outputs[0]?.finishReason}
            {result.outputs.some((o) => o.estimated) ? " · estimated tokens" : ""}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="output-panel-body">
        {[...result.outputs]
          .sort((a, b) => a.stage - b.stage)
          .map((output) => (
            <div key={output.stage} style={{ marginBottom: "1rem" }}>
              {isRework && (
                <div className="output-stage-label">
                  Stage {output.stage}
                  {output.finishReason === "error" ? " · failed" : ""}
                </div>
              )}
              {output.text}
            </div>
          ))}
      </CardContent>
    </Card>
  );
}
