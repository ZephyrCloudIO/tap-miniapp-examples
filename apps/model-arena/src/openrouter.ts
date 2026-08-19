/* ==========================================================================
   Model Arena — OpenRouter Integration
   All requests go through the host transport (host.ts): inside TAP the host
   mediates HTTP and attaches the workspace OpenRouter credential; outside
   the host a local developer key is used as a preview fallback.
   ========================================================================== */

import type { SelectedModel, ModelOutput, TokenCount, ModelParameters } from "./domain";
import { openrouterRequest } from "./host";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompletionResult {
  output: ModelOutput;
  generationId: string | undefined;
  providerUsed: string | undefined;
}

/** Fetch available models from OpenRouter. Throws on failure — callers
 *  decide how to surface the error; no hardcoded fallback list. */
export async function fetchModels(credentialRef?: string): Promise<SelectedModel[]> {
  const { data } = await openrouterRequest({
    method: "GET",
    path: "/models",
    credentialRef,
  });
  const payload = data as {
    data: Array<{
      id: string;
      name: string;
      description?: string;
      pricing?: { prompt: number; completion: number };
      context_length?: number;
    }>;
  };

  return payload.data.map((model) => ({
    id: model.id,
    name: model.name || model.id,
    provider: model.id.split("/")[0] || "unknown",
  }));
}

/** Build the request body, omitting any parameter the user left unset so
 *  the provider/model default applies (e.g. no max_tokens cap). */
export function buildRequestBody(
  modelId: string,
  messages: ChatMessage[],
  parameters: ModelParameters,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: modelId,
    messages,
    stream: false,
    usage: { include: true },
  };

  if (parameters.temperature !== undefined) body.temperature = parameters.temperature;
  if (parameters.maxTokens !== undefined) body.max_tokens = parameters.maxTokens;
  if (parameters.topP !== undefined) body.top_p = parameters.topP;

  const provider: Record<string, unknown> = {};
  if (parameters.providerSort !== undefined) provider.sort = parameters.providerSort;
  if (parameters.zdr !== undefined) provider.zdr = parameters.zdr;
  if (Object.keys(provider).length > 0) body.provider = provider;

  return body;
}

interface CompletionPayload {
  id: string;
  model: string;
  provider?: string;
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    reasoning_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

/** Send a chat completion request to OpenRouter with arbitrary messages. */
export async function sendChatCompletion(
  modelId: string,
  messages: ChatMessage[],
  parameters: ModelParameters,
  stage: number,
  credentialRef?: string,
): Promise<CompletionResult> {
  const { data, elapsedMs } = await openrouterRequest({
    method: "POST",
    path: "/chat/completions",
    body: buildRequestBody(modelId, messages, parameters),
    credentialRef,
    // Long generations need headroom; the host caps at 120 seconds.
    timeoutMs: 120_000,
  });
  const payload = data as CompletionPayload;

  const usage = payload.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  const tokens: TokenCount = {
    prompt: usage.prompt_tokens,
    completion: usage.completion_tokens,
    total: usage.total_tokens,
    reasoning: usage.reasoning_tokens,
    cacheRead: usage.prompt_tokens_details?.cached_tokens,
    cacheWrite: undefined,
  };

  const output: ModelOutput = {
    stage,
    text: payload.choices[0]?.message.content ?? "",
    finishReason: payload.choices[0]?.finish_reason ?? "",
    tokens,
    latencyMs: elapsedMs,
    ttftMs: elapsedMs, // Non-streaming: same as total
    costMicros: undefined, // Filled by queryGenerationStats reconciliation
    generationId: payload.id,
    providerUsed: payload.provider,
    fallbackChain: undefined,
  };

  return { output, generationId: payload.id, providerUsed: payload.provider };
}

/** Convenience wrapper: single user prompt (+ optional system prompt). */
export async function sendCompletion(
  modelId: string,
  prompt: string,
  systemPrompt: string | undefined,
  parameters: ModelParameters,
  stage = 1,
  credentialRef?: string,
): Promise<CompletionResult> {
  const messages: ChatMessage[] = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  messages.push({ role: "user", content: prompt });
  return sendChatCompletion(modelId, messages, parameters, stage, credentialRef);
}

/** Build the messages for a rework round: the original prompt context plus
 *  the model's own previous output and the critique template. The template
 *  may embed the previous output via the {{output}} placeholder. */
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

/** Query generation stats (cost, native tokens) after completion. */
export async function queryGenerationStats(
  generationId: string,
  credentialRef?: string,
): Promise<{
  costMicros: number;
  tokens: TokenCount;
  provider: string;
} | null> {
  const { data } = await openrouterRequest({
    method: "GET",
    path: "/generation",
    query: { id: generationId },
    credentialRef,
  }).catch(() => ({ data: null }));
  if (!data) return null;

  const payload = data as {
    data: {
      id: string;
      model: string;
      total_cost: number;
      tokens_prompt: number;
      tokens_completion: number;
      provider_name: string;
    };
  };

  const tokens: TokenCount = {
    prompt: payload.data.tokens_prompt,
    completion: payload.data.tokens_completion,
    total: payload.data.tokens_prompt + payload.data.tokens_completion,
    reasoning: undefined,
    cacheRead: undefined,
    cacheWrite: undefined,
  };

  return {
    costMicros: Math.round(payload.data.total_cost * 1_000_000),
    tokens,
    provider: payload.data.provider_name,
  };
}

/** Reconcile an output with exact post-hoc cost/provider data. Mutates the
 *  output in place when stats are available. */
export async function reconcileOutputCost(
  output: ModelOutput,
  credentialRef?: string,
): Promise<void> {
  if (!output.generationId) return;
  const stats = await queryGenerationStats(output.generationId, credentialRef).catch(() => null);
  if (!stats) return;
  output.costMicros = stats.costMicros;
  if (!output.providerUsed) output.providerUsed = stats.provider;
}
