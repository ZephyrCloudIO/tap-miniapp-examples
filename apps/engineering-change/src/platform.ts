import { sdk } from "@theaiplatform/miniapp-sdk/sdk";
import type {
  CreateTaskOptions,
  MiniAppHttpResponse,
  MiniAppTask,
} from "@theaiplatform/miniapp-sdk/sdk";
import type { EngineeringChange, Finding } from "./domain";

/**
 * Governed repository reads used to ground Impact Evidence in the exact
 * upstream revision. Every read goes through the host-mediated HTTP
 * capability, so the declared `https://api.github.com` origin is the only
 * network boundary this package crosses.
 */
export const GOVERNED_HTTP_ORIGINS = ["https://api.github.com"] as const;

export interface GovernedReadReceipt {
  url: string;
  finalUrl: string;
  status: number;
  digest: string;
  sizeBytes: number;
  elapsedMs: number;
  capturedAt: string;
}

export class GovernedHttpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GovernedHttpError";
  }
}

export class TaskCapabilityUnavailableError extends Error {
  constructor() {
    super("This TAP host does not provide the workspace task capability.");
    this.name = "TaskCapabilityUnavailableError";
  }
}

function taskPriorityForFinding(
  severity: Finding["severity"],
): CreateTaskOptions["priority"] {
  switch (severity) {
    case "critical":
      return "urgent";
    case "high":
      return "high";
    case "medium":
      return "medium";
    case "low":
    case "info":
      return "low";
  }
}

export function findingTaskOptions(
  change: EngineeringChange,
  finding: Finding,
): CreateTaskOptions {
  const prefix = `[${change.id}] `;
  const availableSummaryLength = Math.max(1, 160 - prefix.length);
  const summary = finding.summary.slice(0, availableSummaryLength);
  const location = [
    finding.file,
    finding.line === null ? null : `line ${finding.line}`,
    finding.symbol,
  ]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join(" · ");
  return {
    title: `${prefix}${summary}`,
    description: [
      `Engineering Change: ${change.id} — ${change.title}`,
      `Finding: ${finding.summary}`,
      `Standard: ${finding.standard}`,
      `Severity: ${finding.severity}`,
      location ? `Location: ${location}` : null,
      `Provenance: ${finding.provenance ?? "human reviewer"}`,
    ]
      .filter((line): line is string => line !== null)
      .join("\n"),
    status: "toDo",
    priority: taskPriorityForFinding(finding.severity),
  };
}

/** Create a follow-up in the host's canonical Tasks silo for one finding. */
export async function createFindingTask(
  change: EngineeringChange,
  finding: Finding,
): Promise<MiniAppTask> {
  const tasks = sdk.tasks;
  if (!tasks) throw new TaskCapabilityUnavailableError();
  const result = await tasks.create(findingTaskOptions(change, finding));
  return result.task;
}

export function isGovernedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return GOVERNED_HTTP_ORIGINS.some(
      (origin) => parsed.origin === origin && parsed.protocol === "https:",
    );
  } catch {
    return false;
  }
}

async function digestText(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Read one governed URL and return the body with a verifiable receipt. The
 * miniapp never sees credentials; when `credentialRef` is omitted the host
 * performs an unauthenticated read of public data.
 */
export async function governedHttpRead(options: {
  url: string;
  credentialRef?: string;
  timeoutMs?: number;
  capturedAt?: string;
}): Promise<{ body: string; receipt: GovernedReadReceipt }> {
  if (!isGovernedUrl(options.url)) {
    throw new GovernedHttpError(
      `The URL ${options.url} is outside the declared governed origins.`,
    );
  }
  if (!sdk.http) {
    throw new GovernedHttpError("The host HTTP capability is unavailable.");
  }
  const response: MiniAppHttpResponse = await sdk.http.request(
    {
      method: "GET",
      url: options.url,
      headers: [{ name: "accept", value: "application/vnd.github+json" }],
      timeoutMs: options.timeoutMs ?? 30_000,
      responseBodyLimitBytes: 5 * 1024 * 1024,
      followRedirects: false,
    },
    options.credentialRef ? { credentialRef: options.credentialRef } : undefined,
  );
  if (response.status < 200 || response.status >= 300) {
    throw new GovernedHttpError(
      `The governed endpoint returned HTTP ${response.status} ${response.statusText}.`,
    );
  }
  const body = response.bodyText ?? "";
  return {
    body,
    receipt: {
      url: options.url,
      finalUrl: response.finalUrl,
      status: response.status,
      digest: await digestText(body),
      sizeBytes: response.sizeBytes,
      elapsedMs: response.elapsedMs,
      capturedAt: options.capturedAt ?? new Date().toISOString(),
    },
  };
}
