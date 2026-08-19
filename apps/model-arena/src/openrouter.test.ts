import { describe, expect, it } from "@rstest/core";
import { buildRequestBody, buildReworkMessages } from "./openrouter";
import type { ModelParameters } from "./domain";

const baseParams: ModelParameters = {
  temperature: undefined,
  maxTokens: undefined,
  topP: undefined,
  providerSort: undefined,
  zdr: undefined,
};

describe("buildRequestBody", () => {
  it("omits max_tokens entirely when maxTokens is unset", () => {
    const body = buildRequestBody("openai/gpt-4o", [{ role: "user", content: "hi" }], baseParams);
    expect(body).not.toHaveProperty("max_tokens");
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("top_p");
    expect(body).not.toHaveProperty("provider");
  });

  it("includes max_tokens only when a cap is set", () => {
    const body = buildRequestBody("openai/gpt-4o", [{ role: "user", content: "hi" }], {
      ...baseParams,
      maxTokens: 512,
    });
    expect(body.max_tokens).toBe(512);
  });

  it("includes optional sampling params only when set", () => {
    const body = buildRequestBody("openai/gpt-4o", [{ role: "user", content: "hi" }], {
      ...baseParams,
      temperature: 0.3,
      topP: 0.9,
    });
    expect(body.temperature).toBe(0.3);
    expect(body.top_p).toBe(0.9);
  });

  it("includes provider prefs only when set", () => {
    const bare = buildRequestBody("m", [{ role: "user", content: "x" }], baseParams);
    expect(bare).not.toHaveProperty("provider");

    const sorted = buildRequestBody("m", [{ role: "user", content: "x" }], {
      ...baseParams,
      providerSort: "price",
      zdr: true,
    });
    expect(sorted.provider).toEqual({ sort: "price", zdr: true });
  });
});

describe("buildReworkMessages", () => {
  it("substitutes the {{output}} placeholder", () => {
    const messages = buildReworkMessages(
      "Write a haiku",
      undefined,
      "old haiku",
      "Improve this:\n{{output}}",
    );
    expect(messages).toEqual([
      { role: "user", content: "Write a haiku" },
      { role: "assistant", content: "old haiku" },
      { role: "user", content: "Improve this:\nold haiku" },
    ]);
  });

  it("appends the previous output when the template has no placeholder", () => {
    const messages = buildReworkMessages("P", "SYS", "prev output", "Critique and revise.");
    expect(messages[0]).toEqual({ role: "system", content: "SYS" });
    const last = messages[messages.length - 1];
    expect(last?.content).toContain("Critique and revise.");
    expect(last?.content).toContain("prev output");
  });
});
