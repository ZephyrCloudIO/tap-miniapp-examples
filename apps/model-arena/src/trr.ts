/* ==========================================================================
   Model Arena — Local TRR Audit Artifact Modeling
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

/** Generate a content-free message/turn ID for local audit artifacts. */
function generateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Look up a model's output at a stage. */
function outputAtStage(result: ModelResult, stage: number): ModelOutput | undefined {
  return result.outputs.find((o) => o.stage === stage);
}

/** Sorted stages present for a result. */
function stagesOf(result: ModelResult): number[] {
  return result.outputs
    .filter((output) => output.finishReason !== "error")
    .map((output) => output.stage)
    .sort((a, b) => a - b);
}

interface ContentDelta {
  beforeCount: number;
  afterCount: number;
  retainedCount: number;
  removedCount: number;
  addedCount: number;
}

const LEXICAL_TOKEN_PATTERN = /[\p{L}\p{M}\p{N}]+(?:['’_-][\p{L}\p{M}\p{N}]+)*/gu;

/**
 * Tokenize text into normalized lexical units for retention measurement.
 *
 * These are deliberately not provider/billing tokens: provider token counts
 * say how much was generated, but only the text can tell us what survived a
 * rewrite. Case and Unicode compatibility differences do not count as churn.
 */
function lexicalTokens(text: string): string[] {
  return text.normalize("NFKC").toLocaleLowerCase("en-US").match(LEXICAL_TOKEN_PATTERN) ?? [];
}

/** Compare two sequences as multisets so moved content still counts as retained. */
function contentDelta(before: string[], after: string[]): ContentDelta {
  const available = new Map<string, number>();
  for (const item of before) {
    available.set(item, (available.get(item) ?? 0) + 1);
  }

  let retainedCount = 0;
  for (const item of after) {
    const remaining = available.get(item) ?? 0;
    if (remaining > 0) {
      retainedCount += 1;
      available.set(item, remaining - 1);
    }
  }

  return {
    beforeCount: before.length,
    afterCount: after.length,
    retainedCount,
    removedCount: before.length - retainedCount,
    addedCount: after.length - retainedCount,
  };
}

function lexicalDelta(before: string, after: string): ContentDelta {
  return contentDelta(lexicalTokens(before), lexicalTokens(after));
}

/** Compute per-round and aggregate TRR metrics from a result's outputs.
 *  Works for one-shot (no rounds) and N-round rework sessions. */
export function computeTrrMetrics(result: Pick<ModelResult, "outputs">): TrrMetrics {
  const outputs = result.outputs;
  const successfulOutputs = outputs.filter((output) => output.finishReason !== "error");
  const atStage = (stage: number) => successfulOutputs.find((o) => o.stage === stage);
  const stages = successfulOutputs.map((o) => o.stage).sort((a, b) => a - b);
  const stage1 = atStage(1);
  const stage1Tokens = stage1?.tokens.completion ?? 0;

  const rounds: ReworkRoundMetrics[] = [];
  for (const stage of stages) {
    if (stage < 2) continue;
    const prev = atStage(stage - 1);
    const curr = atStage(stage);
    if (!prev || !curr) continue;

    const delta = lexicalDelta(prev.text, curr.text);
    const retentionRate =
      delta.beforeCount > 0 ? delta.retainedCount / delta.beforeCount : undefined;
    const total = delta.beforeCount + delta.afterCount;
    const p_i = total > 0 ? delta.removedCount / total : 0;

    rounds.push({
      stage,
      regeneratedTokens: curr.tokens.completion,
      discardedTokens: delta.removedCount,
      retentionRate,
      turnPressure: computeTurnPressure(p_i).r_i,
      costMicros: curr.costMicros,
      latencyMs: curr.latencyMs,
    });
  }

  const finalStage = stages[stages.length - 1];
  const finalOutput = finalStage !== undefined ? atStage(finalStage) : undefined;
  const totalCostMicros =
    outputs.length > 0 && outputs.every((output) => output.costMicros !== undefined)
      ? outputs.reduce((sum, output) => sum + output.costMicros!, 0)
      : undefined;

  const hasRework = rounds.length > 0;
  const overallDelta =
    hasRework && stage1 && finalOutput ? lexicalDelta(stage1.text, finalOutput.text) : undefined;
  const overallRetention =
    overallDelta && overallDelta.beforeCount > 0
      ? overallDelta.retainedCount / overallDelta.beforeCount
      : undefined;
  const totalDiscarded = overallDelta?.removedCount;

  return {
    stage1Tokens,
    rounds,
    discardedTokens: totalDiscarded,
    retentionRate: overallRetention,
    turnPressure: hasRework
      ? Math.max(...rounds.map((r) => r.turnPressure ?? 0))
      : undefined,
    ecrtMicros:
      overallDelta && overallDelta.retainedCount > 0 && totalCostMicros !== undefined
        ? Math.round(totalCostMicros / overallDelta.retainedCount)
        : undefined,
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
    modelId: output?.modelUsed ?? result.model.id,
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
  const delta = previous && output ? lexicalDelta(previous.text, output.text) : undefined;

  return {
    turnId: output?.turnId ?? generateId("turn"),
    workspaceId,
    modelId: output?.modelUsed ?? result.model.id,
    providerId: output?.providerUsed,
    promptTokens: output?.tokens.prompt ?? 0,
    outputTokens: output?.tokens.completion ?? 0,
    iterationCount: stage - 1,
    discardedCompletionTokens: delta?.removedCount ?? 0,
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

  const tokenDelta = lexicalDelta(previous.text, current.text);
  const graphemeDelta = contentDelta(Array.from(previous.text), Array.from(current.text));
  const tokensRemoved = tokenDelta.removedCount;
  const tokensAdded = tokenDelta.addedCount;
  const graphemesRemoved = graphemeDelta.removedCount;
  const graphemesAdded = graphemeDelta.addedCount;

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
    deathMode:
      tokenDelta.beforeCount > 0 && tokensRemoved >= tokenDelta.beforeCount * 0.5
        ? "regenerate"
        : "edit",
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

  const delta = lexicalDelta(previous.text, current.text);
  const total = delta.beforeCount + delta.afterCount;
  const p_i = total > 0 ? delta.removedCount / total : 0;
  const { g_of_p, r_i } = computeTurnPressure(p_i);

  return {
    turnId: current.turnId ?? generateId("turn"),
    workspaceId,
    iterationCount: stage - 1,
    streamRetryCount: 0,
    p_i,
    g_of_p,
    r_i,
    evaluatedAt: Date.now(),
  };
}

/**
 * Build a content-free, TRR-shaped audit record for a completed session.
 *
 * These records are written only to the session's VFS artifact set. They are
 * not canonical host TRR events: managed inference records that telemetry at
 * the host boundary, and SDK 0.12 intentionally exposes no arbitrary emitter.
 */
export function buildSessionTrrAuditEvents(
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
