/* ==========================================================================
   Model Arena — Host Platform Capabilities
   Provider credentials, model routing, billing, and inference telemetry stay
   inside TAP. The miniapp receives only the managed result envelope.
   ========================================================================== */

import { sdk } from "@theaiplatform/miniapp-sdk/sdk";
import type {
  MiniAppAuthorizationAutonomy,
  MiniAppInferenceApi,
  MiniAppTrrApi,
} from "@theaiplatform/miniapp-sdk/sdk";
import type { ModelOutput } from "./domain";

/** Read the managed inference capability without assuming an older host has it. */
export function getInferenceApi(): MiniAppInferenceApi | undefined {
  try {
    return sdk.inference;
  } catch {
    return undefined;
  }
}

/** Read the host TRR analytics API if installed. Individual reads still
 * enforce their own grants and may reject. */
export function getTrrApi(): MiniAppTrrApi | undefined {
  try {
    return sdk.trr;
  } catch {
    return undefined;
  }
}

/** Advisory authorization check used to disable paid or mutating controls.
 * The actual host operation remains the final enforcement boundary. */
export async function isActionAllowed(
  actionId: string,
  autonomy: MiniAppAuthorizationAutonomy,
): Promise<boolean> {
  try {
    return (await sdk.authorization.check({ actionId, autonomy })).allowed;
  } catch {
    return false;
  }
}

/** Resolved specialist ID for the arena reviser contribution. */
export const ARENA_REVISER_SPECIALIST_ID = "arena-reviser@0.1.0";

/** Place text in the shared chat panel's composer without unmounting the
 * surface. Returns false when the host chat API is unavailable or denied. */
export async function shareTextToChat(text: string): Promise<boolean> {
  try {
    const chat = sdk.chat;
    if (!chat) return false;
    await chat.sendTextToChat(text);
    return true;
  } catch {
    return false;
  }
}

/** Estimate token counts when a specialist result does not report usage. */
function estimateTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 4));
}

/** Run one stateful specialist turn. Channel-less specialist turns use TAP's
 * persistent private room, so callers must label this arm as contextual rather
 * than statistically isolated. */
export async function runArenaSpecialistTurn(options: {
  content: string;
  workspaceId?: string | undefined;
  modelOverride?: string | undefined;
  timeoutMs?: number;
}): Promise<{ text: string; modelUsed: string | undefined; elapsedMs: number }> {
  let specialistApi: unknown;
  try {
    specialistApi = sdk.specialist;
  } catch {
    specialistApi = undefined;
  }
  if (!specialistApi) {
    throw new Error("Specialist API is not available in this environment (TAP host required).");
  }

  const { runSpecialist } = await import("@theaiplatform/miniapp-sdk/sdk");
  const startTime = performance.now();
  const outcome = await runSpecialist({
    specialistId: ARENA_REVISER_SPECIALIST_ID,
    content: options.content,
    ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
    modelOverride: options.modelOverride ?? null,
    timeoutMs: options.timeoutMs ?? 90_000,
  });
  const elapsedMs = Math.round(performance.now() - startTime);

  if (!outcome.ok) {
    throw new Error(`Specialist turn failed (${outcome.failure.reason}): ${outcome.failure.message}`);
  }
  return { text: outcome.text, modelUsed: outcome.modelUsed, elapsedMs };
}

/** Build a ModelOutput from a specialist turn, with estimated usage. */
export function specialistTurnOutput(
  stage: number,
  turn: { text: string; modelUsed: string | undefined; elapsedMs: number },
  promptText: string,
): ModelOutput {
  const completion = estimateTokens(turn.text);
  const prompt = estimateTokens(promptText);
  return {
    stage,
    text: turn.text,
    finishReason: "stop",
    tokens: {
      prompt,
      completion,
      total: prompt + completion,
      reasoning: undefined,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    latencyMs: turn.elapsedMs,
    ttftMs: undefined,
    costMicros: undefined,
    generationId: undefined,
    modelUsed: turn.modelUsed,
    providerUsed: undefined,
    fallbackChain: undefined,
    estimated: true,
  };
}
