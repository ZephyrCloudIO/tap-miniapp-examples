import { describe, expect, it } from "@rstest/core";
import { isOpenRouterCredential, runArenaSpecialistTurn, specialistTurnOutput } from "./host";
import type { MiniAppHttpCredentialMetadata } from "@theaiplatform/miniapp-sdk/sdk";

function credential(overrides: Partial<MiniAppHttpCredentialMetadata>): MiniAppHttpCredentialMetadata {
  return {
    id: "cred-1",
    credentialType: "http_bearer",
    displayName: "Credential",
    metadataFields: {},
    ...overrides,
  };
}

describe("isOpenRouterCredential", () => {
  it("matches on display name", () => {
    expect(isOpenRouterCredential(credential({ displayName: "OpenRouter prod" }))).toBe(true);
  });

  it("matches case-insensitively on metadata fields", () => {
    expect(
      isOpenRouterCredential(
        credential({ metadataFields: { baseUrl: "https://openrouter.ai/api/v1" } }),
      ),
    ).toBe(true);
  });

  it("does not match unrelated credentials", () => {
    expect(
      isOpenRouterCredential(
        credential({ displayName: "GitHub PAT", metadataFields: { host: "api.github.com" } }),
      ),
    ).toBe(false);
  });
});

describe("specialistTurnOutput", () => {
  it("estimates token counts from text and flags the output", () => {
    const output = specialistTurnOutput(
      2,
      { text: "x".repeat(400), modelUsed: "openai/gpt-4o", elapsedMs: 1200 },
      "y".repeat(40),
    );
    expect(output.stage).toBe(2);
    expect(output.tokens.completion).toBe(100); // ~4 chars per token
    expect(output.tokens.prompt).toBe(10);
    expect(output.estimated).toBe(true);
    expect(output.providerUsed).toBe("openai/gpt-4o");
    expect(output.costMicros).toBeUndefined();
    expect(output.latencyMs).toBe(1200);
  });

  it("never reports zero tokens for an empty answer", () => {
    const output = specialistTurnOutput(
      1,
      { text: "", modelUsed: undefined, elapsedMs: 50 },
      "prompt",
    );
    expect(output.tokens.completion).toBe(1);
  });
});

describe("runArenaSpecialistTurn", () => {
  it("fails clearly outside the host", async () => {
    await expect(runArenaSpecialistTurn({ content: "hi" })).rejects.toThrow(
      /not available in this environment/,
    );
  });
});
