import { describe, expect, it } from "@rstest/core";
import {
  buildTokenEdited,
  buildTurnPressureShadowed,
  buildTurnStamped,
  computeTrrMetrics,
  buildSessionTrrAuditEvents,
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
    // Provider usage shrinks 100 -> 80 -> 40, while lexical survival is
    // measured from the actual content at each stage.
    const trr = computeTrrMetrics({
      outputs: [
        makeOutput(1, 100, "alpha beta beta gamma"),
        makeOutput(2, 80, "beta alpha delta"),
        makeOutput(3, 40, "alpha epsilon"),
      ],
    });
    expect(trr.rounds).toHaveLength(2);
    expect(trr.rounds[0]?.discardedTokens).toBe(2);
    expect(trr.rounds[0]?.retentionRate).toBeCloseTo(0.5);
    expect(trr.rounds[1]?.discardedTokens).toBe(2);
    expect(trr.rounds[1]?.retentionRate).toBeCloseTo(1 / 3);
    // One of the four stage-1 lexical tokens survives the final stage.
    expect(trr.retentionRate).toBeCloseTo(0.25);
    expect(trr.discardedTokens).toBe(3);
    expect(trr.totalCostMicros).toBe(30);
    // ECRT = total cost / retained lexical tokens.
    expect(trr.ecrtMicros).toBe(30);
  });

  it("retains repeated lexical tokens only as many times as they survive", () => {
    const trr = computeTrrMetrics({
      outputs: [
        makeOutput(1, 50, "Keep keep KEEP other"),
        makeOutput(2, 120, "keep new words"),
      ],
    });
    expect(trr.retentionRate).toBeCloseTo(0.25);
    expect(trr.discardedTokens).toBe(3);
  });

  it("does not mistake equal provider-token counts for retained content", () => {
    const trr = computeTrrMetrics({
      outputs: [
        makeOutput(1, 50, "alpha beta gamma"),
        makeOutput(2, 50, "delta epsilon zeta"),
      ],
    });
    expect(trr.retentionRate).toBe(0);
    expect(trr.discardedTokens).toBe(3);
    expect(trr.ecrtMicros).toBeUndefined();
  });

  it("normalizes case and compatibility forms without counting churn", () => {
    const trr = computeTrrMetrics({
      outputs: [
        makeOutput(1, 50, "HELLO ＦＵＬＬＷＩＤＴＨ"),
        makeOutput(2, 120, "hello fullwidth plus"),
      ],
    });
    expect(trr.retentionRate).toBe(1);
    expect(trr.discardedTokens).toBe(0);
  });

  it("keeps aggregate cost and lexical ECRT unknown when any stage cost is unknown", () => {
    const second = { ...makeOutput(2, 80, "alpha beta"), costMicros: undefined };
    const trr = computeTrrMetrics({
      outputs: [makeOutput(1, 50, "alpha beta gamma"), second],
    });
    expect(trr.totalCostMicros).toBeUndefined();
    expect(trr.ecrtMicros).toBeUndefined();
  });

  it("does not treat a failed rework message as revised lexical content", () => {
    const failure: ModelOutput = {
      ...makeOutput(2, 0, "Error: provider timeout"),
      finishReason: "error",
      costMicros: undefined,
    };
    const trr = computeTrrMetrics({
      outputs: [makeOutput(1, 50, "alpha beta gamma"), failure],
    });
    expect(trr.rounds).toHaveLength(0);
    expect(trr.retentionRate).toBeUndefined();
    expect(trr.discardedTokens).toBeUndefined();
  });
});

describe("event builders", () => {
  it("stamps iteration counts relative to stage", () => {
    const result: ModelResult = {
      model,
      outputs: [
        makeOutput(1, 100, "alpha beta gamma"),
        makeOutput(2, 80, "alpha beta delta"),
        makeOutput(3, 60, "alpha epsilon"),
      ],
      trr: computeTrrMetrics({ outputs: [] }),
      vcvFeedback: undefined,
    };
    const stage3 = buildTurnStamped("ws", result, 3);
    expect(stage3.iterationCount).toBe(2);
    expect(stage3.discardedCompletionTokens).toBe(2); // vs stage 2, not stage 1
    expect(stage3.regeneratedTokenCount).toBe(60);
  });

  it("classifies a full rewrite as regenerate + critical", () => {
    const result: ModelResult = {
      model,
      outputs: [
        makeOutput(1, 100, "alpha beta gamma delta"),
        makeOutput(2, 10, "epsilon"),
      ],
      trr: computeTrrMetrics({ outputs: [] }),
      vcvFeedback: undefined,
    };
    const event = buildTokenEdited("ws", result, 2);
    expect(event?.deathMode).toBe("regenerate");
    expect(event?.severityTier).toBe("critical");
    expect(event?.tokensRemoved).toBe(4);
    expect(event?.tokensAdded).toBe(1);
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

describe("buildSessionTrrAuditEvents", () => {
  it("builds batch+turn audit records for one-shot sessions", () => {
    const result: ModelResult = {
      model,
      outputs: [makeOutput(1, 100)],
      trr: computeTrrMetrics({ outputs: [] }),
      vcvFeedback: undefined,
    };
    const events = buildSessionTrrAuditEvents(makeSession([result], ComparisonMode.OneShot), "ws");
    expect(events.map((e) => e.kind)).toEqual(["tokenBatchProduced", "turnStamped"]);
  });

  it("builds edit and pressure audit records for every rework round", () => {
    const result: ModelResult = {
      model,
      outputs: [makeOutput(1, 100), makeOutput(2, 80), makeOutput(3, 60)],
      trr: computeTrrMetrics({ outputs: [] }),
      vcvFeedback: undefined,
    };
    const events = buildSessionTrrAuditEvents(makeSession([result], ComparisonMode.Rework), "ws");
    const kinds = events.map((e) => e.kind);
    expect(kinds.filter((k) => k === "tokenBatchProduced")).toHaveLength(3);
    expect(kinds.filter((k) => k === "turnStamped")).toHaveLength(3);
    expect(kinds.filter((k) => k === "tokenEdited")).toHaveLength(2);
    expect(kinds.filter((k) => k === "turnPressureShadowed")).toHaveLength(2);
    expect(events.every((e) => e.data.workspaceId === "ws")).toBe(true);
  });

  it("builds one batch+turn pair per pipeline role, with no edit records", () => {
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
    const events = buildSessionTrrAuditEvents(session, "ws");
    const kinds = events.map((e) => e.kind);
    expect(kinds.filter((k) => k === "tokenBatchProduced")).toHaveLength(3);
    expect(kinds.filter((k) => k === "turnStamped")).toHaveLength(3);
    expect(kinds.filter((k) => k === "tokenEdited")).toHaveLength(0);
  });
});
