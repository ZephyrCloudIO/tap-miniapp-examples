import { describe, expect, it } from "@rstest/core";
import type { MiniAppInferenceApi, MiniAppInferenceResult } from "@theaiplatform/miniapp-sdk/sdk";
import {
  buildReworkMessages,
  fetchModels,
  inferenceResultToOutput,
  sendChatCompletion,
} from "./inference";
import type { ModelParameters } from "./domain";

const parameters: ModelParameters = {
  temperature: 0.3,
  maxTokens: 512,
  topP: undefined,
  providerSort: undefined,
  zdr: undefined,
};

function result(overrides: Partial<MiniAppInferenceResult> = {}): MiniAppInferenceResult {
  return {
    turnId: "turn-1",
    text: "Managed answer",
    finishReason: "stop",
    modelUsed: "openai/gpt-5",
    providerUsed: "openrouter",
    generationId: "gen-1",
    usage: {
      inputTokens: 20,
      outputTokens: 10,
      totalTokens: 30,
      reasoningTokens: 2,
      cacheReadTokens: 4,
      cacheWriteTokens: null,
      costUsd: 0.00125,
    },
    latencyMs: 850,
    ttftMs: null,
    zdrApplied: true,
    managed: true,
    ...overrides,
  };
}

describe("managed inference", () => {
  it("maps the host model catalog", async () => {
    const api = {
      listModels: async () => [
        {
          canonicalName: "openai/gpt-5",
          displayName: "GPT-5",
          description: null,
          providerIds: ["openrouter", "openai"],
          contextLength: 128_000,
          maxOutputTokens: 16_384,
        },
      ],
    } as MiniAppInferenceApi;
    await expect(fetchModels(api)).resolves.toEqual([
      { id: "openai/gpt-5", name: "GPT-5", provider: "openrouter, openai" },
    ]);
  });

  it("sends only SDK-supported sampling parameters", async () => {
    let request: Parameters<MiniAppInferenceApi["send"]>[0] | undefined;
    const api: MiniAppInferenceApi = {
      listModels: async () => [],
      send: async (next) => {
        request = next;
        return result();
      },
    };
    await sendChatCompletion(
      "conversation-1",
      "openai/gpt-5",
      [{ role: "user", content: "Hello" }],
      parameters,
      1,
      api,
    );
    expect(request).toMatchObject({
      conversationId: "conversation-1",
      model: "openai/gpt-5",
      temperature: 0.3,
      maxTokens: 512,
    });
    expect(request).not.toHaveProperty("topP");
    expect(request).not.toHaveProperty("zdr");
  });

  it("uses canonical usage, cost, route, and unary TTFT semantics", () => {
    const output = inferenceResultToOutput(
      2,
      result(),
      [{ role: "user", content: "Hello" }],
    );
    expect(output.tokens).toEqual({
      prompt: 20,
      completion: 10,
      total: 30,
      reasoning: 2,
      cacheRead: 4,
      cacheWrite: undefined,
    });
    expect(output.costMicros).toBe(1250);
    expect(output.turnId).toBe("turn-1");
    expect(output.modelUsed).toBe("openai/gpt-5");
    expect(output.providerUsed).toBe("openrouter");
    expect(output.ttftMs).toBeUndefined();
    expect(output.managed).toBe(true);
    expect(output.zdrApplied).toBe(true);
    expect(output.estimated).toBe(false);
  });

  it("estimates token counts only when provider usage is absent", () => {
    const output = inferenceResultToOutput(
      1,
      result({
        text: "x".repeat(40),
        usage: {
          inputTokens: null,
          outputTokens: null,
          totalTokens: null,
          reasoningTokens: null,
          cacheReadTokens: null,
          cacheWriteTokens: null,
          costUsd: null,
        },
      }),
      [{ role: "user", content: "y".repeat(20) }],
    );
    expect(output.tokens.prompt).toBe(5);
    expect(output.tokens.completion).toBe(10);
    expect(output.estimated).toBe(true);
    expect(output.costMicros).toBeUndefined();
  });
});

describe("buildReworkMessages", () => {
  it("substitutes the previous output into explicit history", () => {
    expect(buildReworkMessages("Write a haiku", undefined, "old haiku", "Improve:\n{{output}}"))
      .toEqual([
        { role: "user", content: "Write a haiku" },
        { role: "assistant", content: "old haiku" },
        { role: "user", content: "Improve:\nold haiku" },
      ]);
  });
});
