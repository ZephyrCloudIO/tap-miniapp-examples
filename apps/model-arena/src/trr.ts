/* ==========================================================================
   Model Arena — TRR Event Emission
   ========================================================================== */

import type {
  ModelComparisonSession,
  ModelOutput,
  ModelResult,
  ReworkRoundMetrics,
  TrrEvent,
  TrrMetrics,
  TrrTokenBatchProduced,
  TrrTurnStamped,
  TrrTokenEdited,
  TrrTurnPressureShadowed,
} from "./domain";

/** Generate a content-free message/turn ID for TRR events. */
function generateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Look up a model's output at a stage. */
function outputAtStage(result: ModelResult, stage: number): ModelOutput | undefined {
  return result.outputs.find((o) => o.stage === stage);
}

/** Sorted stages present for a result. */
function stagesOf(result: ModelResult): number[] {
  return result.outputs.map((o) => o.stage).sort((a, b) => a - b);
}

/** Compute per-round and aggregate TRR metrics from a result's outputs.
 *  Works for one-shot (no rounds) and N-round rework sessions. */
export function computeTrrMetrics(result: Pick<ModelResult, "outputs">): TrrMetrics {
  const outputs = result.outputs;
  const atStage = (stage: number) => outputs.find((o) => o.stage === stage);
  const stages = outputs.map((o) => o.stage).sort((a, b) => a - b);
  const stage1 = atStage(1);
  const stage1Tokens = stage1?.tokens.completion ?? 0;

  const rounds: ReworkRoundMetrics[] = [];
  for (const stage of stages) {
    if (stage < 2) continue;
    const prev = atStage(stage - 1);
    const curr = atStage(stage);
    if (!prev || !curr) continue;

    const discarded = Math.max(0, prev.tokens.completion - curr.tokens.completion);
    const retentionRate =
      prev.tokens.completion > 0 ? 1 - discarded / prev.tokens.completion : undefined;
    const total = prev.tokens.completion + curr.tokens.completion;
    const p_i = total > 0 ? discarded / total : 0;

    rounds.push({
      stage,
      regeneratedTokens: curr.tokens.completion,
      discardedTokens: discarded,
      retentionRate,
      turnPressure: computeTurnPressure(p_i).r_i,
      costMicros: curr.costMicros,
      latencyMs: curr.latencyMs,
    });
  }

  const finalStage = stages[stages.length - 1];
  const finalOutput = finalStage !== undefined ? atStage(finalStage) : undefined;
  const finalTokens = finalOutput?.tokens.completion ?? stage1Tokens;

  const totalCostMicros = outputs.reduce((sum, o) => sum + (o.costMicros ?? 0), 0);

  const hasRework = rounds.length > 0;
  // Approximation: tokens surviving to the final stage. Without a real diff,
  // treat the final output's length relative to stage 1 as the retained share.
  const overallRetention =
    hasRework && stage1Tokens > 0 ? Math.min(1, finalTokens / stage1Tokens) : undefined;
  const totalDiscarded = hasRework ? Math.max(0, stage1Tokens - finalTokens) : undefined;

  return {
    stage1Tokens,
    rounds,
    discardedTokens: totalDiscarded,
    retentionRate: overallRetention,
    turnPressure: hasRework
      ? Math.max(...rounds.map((r) => r.turnPressure ?? 0))
      : undefined,
    ecrtMicros:
      hasRework && finalTokens > 0 ? Math.round(totalCostMicros / finalTokens) : undefined,
    totalCostMicros,
  };
}

/** Retry-pressure transform shared by metrics and events. */
export function computeTurnPressure(p_i: number): { g_of_p: number; r_i: number } {
  const alpha = 0.2;
  const g_of_p = -Math.log(1 - p_i + 0.001);
  const r_i = Math.exp(-alpha * g_of_p);
  return { g_of_p, r_i };
}

/** Build a TokenBatchProduced event from a model result. */
export function buildTokenBatchProduced(
  workspaceId: string,
  result: ModelResult,
  stage: number,
): TrrTokenBatchProduced {
  const output = outputAtStage(result, stage);
  const text = output?.text ?? "";
  const tokens = output?.tokens.completion ?? 0;

  return {
    revisionId: generateId("batch"),
    workspaceId,
    messageId: generateId("msg"),
    modelId: result.model.id,
    providerId: output?.providerUsed,
    graphemesAtEmit: text.length, // Approximate; real impl uses Intl.Segmenter
    tokensAtEmit: tokens,
    costMicros: output?.costMicros,
    emittedAt: Date.now(),
  };
}

/** Build a TurnStamped event for one stage. Iteration count is stage - 1;
 *  discarded tokens are measured against the immediately previous stage. */
export function buildTurnStamped(
  workspaceId: string,
  result: ModelResult,
  stage: number,
): TrrTurnStamped {
  const output = outputAtStage(result, stage);
  const previous = stage >= 2 ? outputAtStage(result, stage - 1) : undefined;

  return {
    turnId: generateId("turn"),
    workspaceId,
    modelId: result.model.id,
    providerId: output?.providerUsed,
    promptTokens: output?.tokens.prompt ?? 0,
    outputTokens: output?.tokens.completion ?? 0,
    iterationCount: stage - 1,
    discardedCompletionTokens:
      previous && output
        ? Math.max(0, previous.tokens.completion - output.tokens.completion)
        : 0,
    regeneratedTokenCount: stage >= 2 ? (output?.tokens.completion ?? 0) : 0,
    ttftMs: output?.ttftMs,
    totalLatencyMs: output?.latencyMs ?? 0,
    costMicros: output?.costMicros,
    fallbackChain: output?.fallbackChain ?? [],
    startedAt: Date.now() - (output?.latencyMs ?? 0),
    completedAt: Date.now(),
  };
}

/** Build a TokenEdited event for one rework round (stage vs stage - 1). */
export function buildTokenEdited(
  workspaceId: string,
  result: ModelResult,
  stage: number,
): TrrTokenEdited | null {
  const previous = outputAtStage(result, stage - 1);
  const current = outputAtStage(result, stage);
  if (stage < 2 || !previous || !current) return null;

  const tokensRemoved = Math.max(0, previous.tokens.completion - current.tokens.completion);
  const tokensAdded = Math.max(0, current.tokens.completion - previous.tokens.completion);
  const graphemesRemoved = Math.max(0, previous.text.length - current.text.length);
  const graphemesAdded = Math.max(0, current.text.length - previous.text.length);

  // Classify severity by rule (matches zephyr-analytics aggregation.rs)
  let severityTier: TrrTokenEdited["severityTier"] = "minor";
  if (tokensRemoved === 0 && tokensAdded === 0) {
    severityTier = "no_op";
  } else if (graphemesRemoved === 0 && tokensAdded > 0) {
    severityTier = "minor";
  } else {
    const churnRatio = tokensRemoved / (tokensRemoved + tokensAdded || 1);
    if (churnRatio >= 0.75) severityTier = "critical";
    else if (churnRatio >= 0.35) severityTier = "major";
    else if (churnRatio <= 0.1) severityTier = "minor";
    else severityTier = "moderate";
  }

  return {
    revisionId: generateId("edit"),
    workspaceId,
    messageId: generateId("msg"),
    producerKind: "specialist",
    graphemesAdded,
    graphemesRemoved,
    tokensAdded,
    tokensRemoved,
    deathMode: tokensRemoved >= previous.tokens.completion * 0.5 ? "regenerate" : "edit",
    severityTier,
    createdAt: Date.now(),
  };
}

/** Build a TurnPressureShadowed event for one rework round. */
export function buildTurnPressureShadowed(
  workspaceId: string,
  result: ModelResult,
  stage: number,
): TrrTurnPressureShadowed | null {
  const previous = outputAtStage(result, stage - 1);
  const current = outputAtStage(result, stage);
  if (stage < 2 || !previous || !current) return null;

  const discarded = Math.max(0, previous.tokens.completion - current.tokens.completion);
  const total = previous.tokens.completion + current.tokens.completion;
  const p_i = total > 0 ? discarded / total : 0;
  const { g_of_p, r_i } = computeTurnPressure(p_i);

  return {
    turnId: generateId("turn"),
    workspaceId,
    iterationCount: stage - 1,
    streamRetryCount: 0,
    p_i,
    g_of_p,
    r_i,
    evaluatedAt: Date.now(),
  };
}

/** Emit all TRR events for a completed session, one set per stage per model. */
export function emitSessionTrrEvents(
  session: ModelComparisonSession,
  workspaceId: string,
): TrrEvent[] {
  const events: TrrEvent[] = [];

  for (const result of session.results) {
    for (const stage of stagesOf(result)) {
      events.push({
        kind: "tokenBatchProduced",
        data: buildTokenBatchProduced(workspaceId, result, stage),
      });
      events.push({
        kind: "turnStamped",
        data: buildTurnStamped(workspaceId, result, stage),
      });

      if (stage >= 2) {
        const tokenEdited = buildTokenEdited(workspaceId, result, stage);
        if (tokenEdited) {
          events.push({ kind: "tokenEdited", data: tokenEdited });
        }

        const turnPressure = buildTurnPressureShadowed(workspaceId, result, stage);
        if (turnPressure) {
          events.push({ kind: "turnPressureShadowed", data: turnPressure });
        }
      }
    }
  }

  return events;
}
