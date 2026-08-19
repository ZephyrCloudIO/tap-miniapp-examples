import { describe, expect, it } from "@rstest/core";
import {
  buildTokenEdited,
  buildTurnPressureShadowed,
  buildTurnStamped,
  computeTrrMetrics,
  emitSessionTrrEvents,
} from "./trr";
import {
  ComparisonMode,
  SessionState,
  type ModelComparisonSession,
  type ModelOutput,
  type ModelResult,
  type SelectedModel,
} from "./domain";

const model: SelectedModel = { id: "openai/gpt-4o", name: "GPT-4o", provider: "openai" };

function makeOutput(stage: number, completionTokens: number, text = ""): ModelOutput {
  return {
    stage,
    text: text || "x".repeat(completionTokens),
    finishReason: "stop",
    tokens: { prompt: 10, completion: completionTokens, total: 10 + completionTokens, reasoning: undefined, cacheRead: undefined, cacheWrite: undefined },
    latencyMs: 100,
    ttftMs: 50,
    costMicros: 10,
    generationId: `gen-${stage}`,
    providerUsed: "openai",
    fallbackChain: undefined,
  };
}

function makeSession(results: ModelResult[], mode: ComparisonMode): ModelComparisonSession {
  return {
    id: "MA-TEST",
    state: SessionState.Completed,
    createdAt: new Date().toISOString(),
    creator: "tester",
    mode,
    prompt: "prompt",
    systemPrompt: undefined,
    parameters: { temperature: undefined, maxTokens: undefined, topP: undefined, providerSort: undefined, zdr: undefined },
    models: [model],
    results,
    reworkRounds: mode === ComparisonMode.Rework ? 2 : 0,
    critiquePrompt: undefined,
    pipelineRoles: undefined,
    pipelineCombination: undefined,
    linkedMessages: undefined,
    tags: undefined,
    parentSessionId: undefined,
  };
}

describe("computeTrrMetrics", () => {
  it("handles one-shot output with no rework rounds", () => {
    const trr = computeTrrMetrics({ outputs: [makeOutput(1, 100)] });
    expect(trr.stage1Tokens).toBe(100);
    expect(trr.rounds).toHaveLength(0);
    expect(trr.retentionRate).toBeUndefined();
    expect(trr.totalCostMicros).toBe(10);
  });

  it("computes per-round metrics across multiple rework rounds", () => {
    // 100 -> 80 -> 40 tokens across stages 1, 2, 3
    const trr = computeTrrMetrics({
      outputs: [makeOutput(1, 100), makeOutput(2, 80), makeOutput(3, 40)],
    });
    expect(trr.rounds).toHaveLength(2);
    expect(trr.rounds[0]?.discardedTokens).toBe(20);
    expect(trr.rounds[1]?.discardedTokens).toBe(40);
    expect(trr.rounds[1]?.retentionRate).toBeCloseTo(0.5);
    // Overall retention measured against stage 1: 40/100
    expect(trr.retentionRate).toBeCloseTo(0.4);
    expect(trr.discardedTokens).toBe(60);
    expect(trr.totalCostMicros).toBe(30);
    // ECRT = total cost / final retained tokens
    expect(trr.ecrtMicros).toBe(Math.round(30 / 40));
  });

  it("caps overall retention at 1 when the output grows", () => {
    const trr = computeTrrMetrics({ outputs: [makeOutput(1, 50), makeOutput(2, 120)] });
    expect(trr.retentionRate).toBe(1);
    expect(trr.discardedTokens).toBe(0);
  });
});

describe("event builders", () => {
  it("stamps iteration counts relative to stage", () => {
    const result: ModelResult = {
      model,
      outputs: [makeOutput(1, 100), makeOutput(2, 80), makeOutput(3, 60)],
      trr: computeTrrMetrics({ outputs: [] }),
      vcvFeedback: undefined,
    };
    const stage3 = buildTurnStamped("ws", result, 3);
    expect(stage3.iterationCount).toBe(2);
    expect(stage3.discardedCompletionTokens).toBe(20); // vs stage 2, not stage 1
    expect(stage3.regeneratedTokenCount).toBe(60);
  });

  it("classifies a full rewrite as regenerate + critical", () => {
    const result: ModelResult = {
      model,
      outputs: [makeOutput(1, 100), makeOutput(2, 10)],
      trr: computeTrrMetrics({ outputs: [] }),
      vcvFeedback: undefined,
    };
    const event = buildTokenEdited("ws", result, 2);
    expect(event?.deathMode).toBe("regenerate");
    expect(event?.severityTier).toBe("critical");
    expect(event?.tokensRemoved).toBe(90);
  });

  it("returns null for stage 1 edits and pressure", () => {
    const result: ModelResult = {
      model,
      outputs: [makeOutput(1, 100)],
      trr: computeTrrMetrics({ outputs: [] }),
      vcvFeedback: undefined,
    };
    expect(buildTokenEdited("ws", result, 1)).toBeNull();
    expect(buildTurnPressureShadowed("ws", result, 1)).toBeNull();
  });
});

describe("emitSessionTrrEvents", () => {
  it("emits batch+turn events for one-shot sessions", () => {
    const result: ModelResult = {
      model,
      outputs: [makeOutput(1, 100)],
      trr: computeTrrMetrics({ outputs: [] }),
      vcvFeedback: undefined,
    };
    const events = emitSessionTrrEvents(makeSession([result], ComparisonMode.OneShot), "ws");
    expect(events.map((e) => e.kind)).toEqual(["tokenBatchProduced", "turnStamped"]);
  });

  it("emits edit and pressure events for every rework round", () => {
    const result: ModelResult = {
      model,
      outputs: [makeOutput(1, 100), makeOutput(2, 80), makeOutput(3, 60)],
      trr: computeTrrMetrics({ outputs: [] }),
      vcvFeedback: undefined,
    };
    const events = emitSessionTrrEvents(makeSession([result], ComparisonMode.Rework), "ws");
    const kinds = events.map((e) => e.kind);
    expect(kinds.filter((k) => k === "tokenBatchProduced")).toHaveLength(3);
    expect(kinds.filter((k) => k === "turnStamped")).toHaveLength(3);
    expect(kinds.filter((k) => k === "tokenEdited")).toHaveLength(2);
    expect(kinds.filter((k) => k === "turnPressureShadowed")).toHaveLength(2);
    expect(events.every((e) => e.data.workspaceId === "ws")).toBe(true);
  });

  it("emits one batch+turn pair per pipeline role, no edit events", () => {
    const roles = ["Plan", "Deliver", "Review"];
    const results: ModelResult[] = roles.map((role, i) => ({
      model: { id: `vendor/model-${i}`, name: `Model ${i}`, provider: "vendor" },
      arm: i === 2 ? ("specialist" as const) : ("model" as const),
      role,
      outputs: [makeOutput(1, 50 + i * 10)],
      trr: computeTrrMetrics({ outputs: [] }),
      vcvFeedback: undefined,
    }));
    const session = makeSession(results, ComparisonMode.OneShot);
    session.mode = ComparisonMode.Pipeline;
    const events = emitSessionTrrEvents(session, "ws");
    const kinds = events.map((e) => e.kind);
    expect(kinds.filter((k) => k === "tokenBatchProduced")).toHaveLength(3);
    expect(kinds.filter((k) => k === "turnStamped")).toHaveLength(3);
    expect(kinds.filter((k) => k === "tokenEdited")).toHaveLength(0);
  });
});
