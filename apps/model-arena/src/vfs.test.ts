import { describe, expect, it } from "@rstest/core";
import { modelSlug, planSessionArtifacts, resultSlug, sessionDir } from "./vfs";
import {
  ComparisonMode,
  SessionState,
  type ModelComparisonSession,
  type ModelOutput,
  type ModelResult,
} from "./domain";

function makeOutput(stage: number, text: string): ModelOutput {
  return {
    stage,
    text,
    finishReason: "stop",
    tokens: { prompt: 10, completion: 50, total: 60, reasoning: undefined, cacheRead: undefined, cacheWrite: undefined },
    latencyMs: 100,
    ttftMs: 50,
    costMicros: 10,
    generationId: "gen-1",
    providerUsed: "openai",
    fallbackChain: undefined,
  };
}

function makeSession(mode: ComparisonMode, results: ModelResult[]): ModelComparisonSession {
  return {
    id: "MA-TEST42",
    state: SessionState.Completed,
    createdAt: "2026-08-17T12:00:00Z",
    creator: "tester",
    mode,
    prompt: "the prompt",
    systemPrompt: undefined,
    parameters: { temperature: undefined, maxTokens: undefined, topP: undefined, providerSort: undefined, zdr: undefined },
    models: results.map((r) => r.model),
    results,
    reworkRounds: 0,
    critiquePrompt: undefined,
    pipelineRoles: undefined,
    pipelineCombination: undefined,
    linkedMessages: undefined,
    tags: undefined,
    parentSessionId: undefined,
  };
}

describe("artifact layout", () => {
  it("slugs model ids and disambiguates roles and arms", () => {
    expect(modelSlug("openai/gpt-4o")).toBe("openai--gpt-4o");
    expect(resultSlug({ model: { id: "openai/gpt-4o", name: "", provider: "" }, outputs: [], trr: undefined as never, vcvFeedback: undefined })).toBe("openai--gpt-4o");
    expect(
      resultSlug({ model: { id: "openai/gpt-4o", name: "", provider: "" }, arm: "specialist", outputs: [], trr: undefined as never, vcvFeedback: undefined }),
    ).toBe("openai--gpt-4o--specialist");
    expect(
      resultSlug({ model: { id: "openai/gpt-4o", name: "", provider: "" }, role: "Plan", outputs: [], trr: undefined as never, vcvFeedback: undefined }),
    ).toBe("openai--gpt-4o--plan");
  });

  it("gives every scenario and run its own folder", () => {
    const oneShot = makeSession(ComparisonMode.OneShot, []);
    const pipeline = makeSession(ComparisonMode.Pipeline, []);
    expect(sessionDir(oneShot)).toBe("model-arena/scenarios/one-shot/MA-TEST42");
    expect(sessionDir(pipeline)).toBe("model-arena/scenarios/pipeline/MA-TEST42");
  });

  it("plans the full artifact set for a run", () => {
    const session = makeSession(ComparisonMode.Pipeline, [
      { model: { id: "openai/gpt-4o", name: "GPT-4o", provider: "openai" }, role: "Plan", arm: "model", outputs: [makeOutput(1, "plan")], trr: undefined as never, vcvFeedback: undefined },
      { model: { id: "anthropic/claude-sonnet-4", name: "Claude", provider: "anthropic" }, role: "Deliver", arm: "specialist", outputs: [makeOutput(1, "deliverable")], trr: undefined as never, vcvFeedback: undefined },
    ]);
    const { directories, files } = planSessionArtifacts(session, []);
    const paths = files.map((f) => f.path);

    expect(directories).toContain("model-arena/scenarios/pipeline/MA-TEST42/outputs/openai--gpt-4o--plan");
    expect(paths).toContain("model-arena/scenarios/pipeline/MA-TEST42/session.json");
    expect(paths).toContain("model-arena/scenarios/pipeline/MA-TEST42/prompt.md");
    expect(paths).toContain("model-arena/scenarios/pipeline/MA-TEST42/metrics.json");
    expect(paths).toContain("model-arena/scenarios/pipeline/MA-TEST42/receipt.json");
    expect(paths).toContain("model-arena/scenarios/pipeline/MA-TEST42/outputs/openai--gpt-4o--plan/stage-1.json");
    expect(paths).toContain("model-arena/scenarios/pipeline/MA-TEST42/outputs/anthropic--claude-sonnet-4--deliver/stage-1.json");
  });

  it("groups TRR events by kind with sequential filenames", () => {
    const session = makeSession(ComparisonMode.OneShot, []);
    const events = [
      { kind: "tokenBatchProduced" as const, data: { a: 1 } },
      { kind: "tokenBatchProduced" as const, data: { a: 2 } },
      { kind: "turnStamped" as const, data: { b: 1 } },
    ];
    const { files } = planSessionArtifacts(session, events as never);
    const paths = files.map((f) => f.path);
    expect(paths).toContain("model-arena/scenarios/one-shot/MA-TEST42/trr-events/tokenBatchProduced/000.json");
    expect(paths).toContain("model-arena/scenarios/one-shot/MA-TEST42/trr-events/tokenBatchProduced/001.json");
    expect(paths).toContain("model-arena/scenarios/one-shot/MA-TEST42/trr-events/turnStamped/000.json");
  });
});
