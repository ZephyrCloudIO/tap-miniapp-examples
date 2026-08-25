import { describe, expect, it } from "@rstest/core";
import {
  getInferenceApi,
  isActionAllowed,
  runArenaSpecialistTurn,
  specialistTurnOutput,
} from "./host";

describe("host capabilities", () => {
  it("feature-detects managed inference outside TAP", () => {
    expect(getInferenceApi()).toBeUndefined();
  });

  it("fails closed when authorization introspection is unavailable", async () => {
    await expect(isActionAllowed("inference.invoke", "do")).resolves.toBe(false);
  });
});

describe("specialistTurnOutput", () => {
  it("estimates usage without claiming unary TTFT or cost", () => {
    const output = specialistTurnOutput(
      2,
      { text: "x".repeat(400), modelUsed: "openai/gpt-5", elapsedMs: 1200 },
      "y".repeat(40),
    );
    expect(output.stage).toBe(2);
    expect(output.tokens.completion).toBe(100);
    expect(output.tokens.prompt).toBe(10);
    expect(output.estimated).toBe(true);
    expect(output.modelUsed).toBe("openai/gpt-5");
    expect(output.providerUsed).toBeUndefined();
    expect(output.costMicros).toBeUndefined();
    expect(output.ttftMs).toBeUndefined();
    expect(output.latencyMs).toBe(1200);
  });
});

describe("runArenaSpecialistTurn", () => {
  it("fails clearly outside the host", async () => {
    await expect(runArenaSpecialistTurn({ content: "hi" })).rejects.toThrow(
      /TAP host required/,
    );
  });
});
