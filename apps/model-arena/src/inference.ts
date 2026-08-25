/* ==========================================================================
   Model Arena — TAP Managed Inference
   Direct inference is isolated and credential-free from the miniapp's point
   of view. TAP owns model routing, provider authentication, spend, and the
   canonical content-free telemetry record.
   ========================================================================== */

import type {
  MiniAppInferenceApi,
  MiniAppInferenceMessage,
  MiniAppInferenceModel,
  MiniAppInferenceResult,
} from "@theaiplatform/miniapp-sdk/sdk";
import type { ModelOutput, ModelParameters, SelectedModel, TokenCount } from "./domain";
import { getInferenceApi } from "./host";

export type ChatMessage = MiniAppInferenceMessage;

export interface CompletionResult {
  output: ModelOutput;
  generationId: string | undefined;
  providerUsed: string | undefined;
}

function requireInference(api?: MiniAppInferenceApi): MiniAppInferenceApi {
  const resolved = api ?? getInferenceApi();
  if (!resolved) {
    throw new Error("Managed inference is unavailable. Open Model Arena in TAP 2.4.1 or newer.");
  }
  return resolved;
}

export function toSelectedModel(model: MiniAppInferenceModel): SelectedModel {
  return {
    id: model.canonicalName,
    name: model.displayName || model.canonicalName,
    provider: model.providerIds.join(", ") || "managed",
  };
}

/** Fetch only models with an eligible host-managed route. */
export async function fetchModels(api?: MiniAppInferenceApi): Promise<SelectedModel[]> {
  const models = await requireInference(api).listModels();
  return models.map(toSelectedModel);
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 4));
}

export function inferenceResultToOutput(
  stage: number,
  result: MiniAppInferenceResult,
  messages: ChatMessage[],
): ModelOutput {
  const estimatedPrompt = estimateTokens(messages.map((message) => message.content).join("\n"));
  const estimatedCompletion = estimateTokens(result.text);
  const prompt = result.usage.inputTokens ?? estimatedPrompt;
  const completion = result.usage.outputTokens ?? estimatedCompletion;
  const total = result.usage.totalTokens ?? prompt + completion;
  const tokens: TokenCount = {
    prompt,
    completion,
    total,
    reasoning: result.usage.reasoningTokens ?? undefined,
    cacheRead: result.usage.cacheReadTokens ?? undefined,
    cacheWrite: result.usage.cacheWriteTokens ?? undefined,
  };

  return {
    stage,
    text: result.text,
    finishReason: result.finishReason,
    tokens,
    latencyMs: result.latencyMs,
    ttftMs: result.ttftMs ?? undefined,
    costMicros:
      result.usage.costUsd === null ? undefined : Math.round(result.usage.costUsd * 1_000_000),
    turnId: result.turnId,
    generationId: result.generationId ?? undefined,
    modelUsed: result.modelUsed,
    providerUsed: result.providerUsed,
    fallbackChain: undefined,
    estimated:
      result.usage.inputTokens === null ||
      result.usage.outputTokens === null ||
      result.usage.totalTokens === null,
    managed: result.managed,
    zdrApplied: result.zdrApplied,
  };
}

/** Send an isolated managed inference request with explicit history. */
export async function sendChatCompletion(
  conversationId: string,
  modelId: string,
  messages: ChatMessage[],
  parameters: ModelParameters,
  stage: number,
  api?: MiniAppInferenceApi,
): Promise<CompletionResult> {
  const result = await requireInference(api).send({
    conversationId,
    model: modelId,
    messages,
    ...(parameters.temperature === undefined ? {} : { temperature: parameters.temperature }),
    ...(parameters.maxTokens === undefined ? {} : { maxTokens: parameters.maxTokens }),
    timeoutMs: 120_000,
  });
  return {
    output: inferenceResultToOutput(stage, result, messages),
    generationId: result.generationId ?? undefined,
    providerUsed: result.providerUsed,
  };
}

/** Convenience wrapper for a single user prompt and optional system prompt. */
export async function sendCompletion(
  conversationId: string,
  modelId: string,
  prompt: string,
  systemPrompt: string | undefined,
  parameters: ModelParameters,
  stage = 1,
  api?: MiniAppInferenceApi,
): Promise<CompletionResult> {
  const messages: ChatMessage[] = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  messages.push({ role: "user", content: prompt });
  return sendChatCompletion(conversationId, modelId, messages, parameters, stage, api);
}

/** Build explicit history for a rework round. Direct inference has no implicit
 * conversation state, so each round gets the original task and prior answer. */
export function buildReworkMessages(
  sessionPrompt: string,
  systemPrompt: string | undefined,
  previousOutput: string,
  critiqueTemplate: string,
): ChatMessage[] {
  const critique = critiqueTemplate.includes("{{output}}")
    ? critiqueTemplate.replaceAll("{{output}}", previousOutput)
    : `${critiqueTemplate}\n\nYour previous response:\n${previousOutput}`;

  const messages: ChatMessage[] = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  messages.push(
    { role: "user", content: sessionPrompt },
    { role: "assistant", content: previousOutput },
    { role: "user", content: critique },
  );
  return messages;
}
