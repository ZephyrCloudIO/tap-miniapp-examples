/* ==========================================================================
   Model Arena — Host Platform Transport
   In the TAP host, network and secrets are host-owned: requests go through
   sdk.http.request and authentication attaches via an opaque credentialRef
   resolved from the host credential vault. Secret material never enters
   miniapp JavaScript. Outside the host (standalone rsbuild preview), we fall
   back to direct fetch with a locally stored developer key.
   ========================================================================== */

import { sdk } from "@theaiplatform/miniapp-sdk/sdk";
import type {
  MiniAppHttpApi,
  MiniAppHttpCredentialMetadata,
  MiniAppHttpRequestInput,
  MiniAppTrrApi,
} from "@theaiplatform/miniapp-sdk/sdk";
import { getApiKey, getAttributionHeaders } from "./config";
import type { ModelOutput } from "./domain";

/** Read the host TRR analytics API if installed (SDK 0.8.0+, trr.read grant). */
export function getTrrApi(): MiniAppTrrApi | undefined {
  try {
    return sdk.trr;
  } catch {
    return undefined;
  }
}

/** Resolved specialist ID for the arena reviser contribution. */
export const ARENA_REVISER_SPECIALIST_ID = "arena-reviser@0.1.0";

/** Place text in the shared chat panel's composer without unmounting the
 *  surface. Returns false when the host chat API is unavailable. */
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

/** Estimate token counts from text when the host reports none (specialist
 *  turns). ~4 characters per token is the standard rough heuristic. */
function estimateTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 4));
}

/** Run one specialist turn for a benchmark arm. Channel-less: the host uses
 *  its private per-(workspace, package, specialist) room, so successive
 *  rounds continue one conversation. Throws on failure outcomes. */
export async function runArenaSpecialistTurn(options: {
  content: string;
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
    throw new Error("Specialist API is not available in this environment (host required).");
  }

  const { runSpecialist } = await import("@theaiplatform/miniapp-sdk/sdk");
  const startTime = performance.now();
  const outcome = await runSpecialist({
    specialistId: ARENA_REVISER_SPECIALIST_ID,
    content: options.content,
    modelOverride: options.modelOverride ?? null,
    timeoutMs: options.timeoutMs ?? 90_000,
  });
  const elapsedMs = Math.round(performance.now() - startTime);

  if (!outcome.ok) {
    throw new Error(`Specialist turn failed (${outcome.failure.reason}): ${outcome.failure.message}`);
  }
  return { text: outcome.text, modelUsed: outcome.modelUsed, elapsedMs };
}

/** Build a ModelOutput from a specialist turn, with estimated token counts. */
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
    ttftMs: turn.elapsedMs,
    costMicros: undefined, // Specialist turns don't report cost
    generationId: undefined,
    providerUsed: turn.modelUsed,
    fallbackChain: undefined,
    estimated: true,
  };
}

export interface HostConnection {
  /** Host-mediated HTTP transport is installed by the host. */
  hostHttp: boolean;
  /** Credential metadata discovery is available. */
  credentialDiscovery: boolean;
  /** Metadata-only view of stored HTTP credentials (no secrets). */
  credentials: MiniAppHttpCredentialMetadata[];
}

/** Read the platform safely: unsupported properties raise when read before
 *  the host installs them, so every access is guarded. */
function readPlatform(): { http?: MiniAppHttpApi | undefined; credentials?: { listHttp(): unknown } | undefined } {
  let http: MiniAppHttpApi | undefined;
  let credentials: { listHttp(): unknown } | undefined;
  try {
    http = sdk.http;
  } catch {
    http = undefined;
  }
  try {
    credentials = sdk.credentials;
  } catch {
    credentials = undefined;
  }
  return { http, credentials };
}

/** Inspect the host connection: transport availability plus stored
 *  credential metadata. Never throws. */
export async function inspectHostConnection(): Promise<HostConnection> {
  const { http, credentials } = readPlatform();
  let stored: MiniAppHttpCredentialMetadata[] = [];
  if (credentials) {
    try {
      stored = (await credentials.listHttp()) as MiniAppHttpCredentialMetadata[];
    } catch {
      stored = [];
    }
  }
  return {
    hostHttp: http !== undefined,
    credentialDiscovery: credentials !== undefined,
    credentials: stored,
  };
}

/** Heuristic match for the workspace's OpenRouter credential. Matches the
 *  display name or any metadata field mentioning openrouter. */
export function isOpenRouterCredential(credential: MiniAppHttpCredentialMetadata): boolean {
  const haystack = [credential.displayName, ...Object.values(credential.metadataFields ?? {})]
    .join(" ")
    .toLowerCase();
  return haystack.includes("openrouter");
}

export class TransportError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "TransportError";
    this.status = status;
  }
}

/** One JSON HTTP call to OpenRouter through the best available transport.
 *  Prefers host-mediated HTTP with a host credential reference; falls back
 *  to direct fetch with the local developer key outside the host. */
export async function openrouterRequest(options: {
  method: "GET" | "POST";
  path: string;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
  credentialRef?: string | undefined;
  timeoutMs?: number;
}): Promise<{ data: unknown; elapsedMs: number }> {
  const { http } = readPlatform();
  const url = `https://openrouter.ai/api/v1${options.path}`;

  if (http) {
    const headers: MiniAppHttpRequestInput["headers"] = [
      { name: "Content-Type", value: "application/json" },
      ...Object.entries(getAttributionHeaders()).map(([name, value]) => ({ name, value })),
    ];
    const response = await http.request(
      {
        method: options.method,
        url,
        query: Object.entries(options.query ?? {}).map(([name, value]) => ({ name, value })),
        headers,
        body: options.body ? JSON.stringify(options.body) : null,
        timeoutMs: options.timeoutMs ?? 60_000,
      },
      options.credentialRef ? { credentialRef: options.credentialRef } : undefined,
    );
    if (response.status < 200 || response.status >= 300) {
      throw new TransportError(
        `OpenRouter error: ${response.status} ${response.statusText}${response.bodyText ? ` — ${response.bodyText.slice(0, 300)}` : ""}`,
        response.status,
      );
    }
    return {
      data: response.bodyText ? JSON.parse(response.bodyText) : null,
      elapsedMs: response.elapsedMs,
    };
  }

  // Standalone preview fallback: direct fetch with a local developer key.
  const apiKey = getApiKey();
  const query = new URLSearchParams(options.query ?? {}).toString();
  const startTime = performance.now();
  const response = await fetch(query ? `${url}?${query}` : url, {
    method: options.method,
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      ...getAttributionHeaders(),
    },
    body: options.body ? JSON.stringify(options.body) : null,
  });
  const elapsedMs = Math.round(performance.now() - startTime);
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new TransportError(
      `OpenRouter error: ${response.status} ${response.statusText}${detail ? ` — ${detail.slice(0, 300)}` : ""}`,
      response.status,
    );
  }
  return { data: await response.json(), elapsedMs };
}
