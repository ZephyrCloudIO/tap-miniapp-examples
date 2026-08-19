/* ==========================================================================
   Model Arena — VFS Artifact Store
   Every comparison run gets its own folder under a per-scenario directory in
   the conversation's protected VFS:

     model-arena/scenarios/<mode>/<sessionId>/
       session.json
       prompt.md
       metrics.json
       receipt.json
       outputs/<model-slug>/stage-N.json
       trr-events/<kind>/<index>.json

   The SDK's MiniAppVfsApi is write-only (writeFile/mkdir), so artifacts are
   written durably as they are produced; the local ledger index remains the
   read path. Outside the host (no vfs / no conversation), writes are skipped.
   ========================================================================== */

import { sdk } from "@theaiplatform/miniapp-sdk/sdk";
import type { MiniAppVfsApi } from "@theaiplatform/miniapp-sdk/sdk";
import type { ModelComparisonSession, ModelOutput, ModelResult, TrrEvent } from "./domain";

/** Read the host VFS API if installed (vfs.write grant required to write). */
export function getVfsApi(): MiniAppVfsApi | undefined {
  try {
    return sdk.vfs;
  } catch {
    return undefined;
  }
}

/** Filesystem-safe model slug: "openai/gpt-4o" -> "openai--gpt-4o". */
export function modelSlug(modelId: string): string {
  return modelId.replaceAll("/", "--").replaceAll(/[^a-zA-Z0-9._-]/g, "_");
}

/** Result directory name, disambiguating benchmark arms and pipeline roles. */
export function resultSlug(result: ModelResult): string {
  const suffix = result.role
    ? `--${result.role.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`
    : result.arm === "specialist"
      ? "--specialist"
      : "";
  return `${modelSlug(result.model.id)}${suffix}`;
}

/** Per-run folder for a session. */
export function sessionDir(session: ModelComparisonSession): string {
  return `model-arena/scenarios/${session.mode}/${session.id}`;
}

/** Output directory for one result. Pipeline runs nest under run-NNN. */
export function resultDir(session: ModelComparisonSession, result: ModelResult): string {
  const base =
    result.runIndex !== undefined
      ? `${sessionDir(session)}/outputs/run-${String(result.runIndex).padStart(3, "0")}`
      : `${sessionDir(session)}/outputs`;
  return `${base}/${resultSlug(result)}`;
}

const encoder = new TextEncoder();

function bytes(value: unknown): Uint8Array {
  return encoder.encode(typeof value === "string" ? value : JSON.stringify(value, null, 2));
}

/** Serializable output record written to outputs/<slug>/stage-N.json. */
export function outputArtifact(output: ModelOutput): Record<string, unknown> {
  return {
    stage: output.stage,
    text: output.text,
    finishReason: output.finishReason,
    tokens: output.tokens,
    latencyMs: output.latencyMs,
    ttftMs: output.ttftMs,
    costMicros: output.costMicros,
    generationId: output.generationId,
    providerUsed: output.providerUsed,
    fallbackChain: output.fallbackChain,
    estimated: output.estimated ?? false,
    writtenAt: new Date().toISOString(),
  };
}

/** Compute every artifact path + payload for a session. Pure, so tests can
 *  assert the layout without a host. */
export function planSessionArtifacts(
  session: ModelComparisonSession,
  trrEvents: TrrEvent[],
): { directories: string[]; files: { path: string; data: Uint8Array }[] } {
  const root = sessionDir(session);
  const directories = [root, `${root}/outputs`, `${root}/trr-events`];
  const files: { path: string; data: Uint8Array }[] = [];

  files.push({ path: `${root}/session.json`, data: bytes(session) });
  files.push({
    path: `${root}/prompt.md`,
    data: bytes(
      `${session.systemPrompt ? `# System\n\n${session.systemPrompt}\n\n` : ""}# Prompt\n\n${session.prompt}\n`,
    ),
  });
  files.push({
    path: `${root}/metrics.json`,
    data: bytes(
      session.results.map((r) => ({
        model: r.model.id,
        arm: r.arm,
        role: r.role,
        trr: r.trr,
      })),
    ),
  });
  files.push({
    path: `${root}/receipt.json`,
    data: bytes({
      sessionId: session.id,
      generatedAt: new Date().toISOString(),
      generations: session.results.flatMap((r) =>
        r.outputs.map((o) => ({
          model: r.model.id,
          arm: r.arm,
          role: r.role,
          stage: o.stage,
          generationId: o.generationId,
          providerUsed: o.providerUsed,
        })),
      ),
    }),
  });

  for (const result of session.results) {
    const dir = resultDir(session, result);
    directories.push(dir);
    for (const output of result.outputs) {
      files.push({ path: `${dir}/stage-${output.stage}.json`, data: bytes(outputArtifact(output)) });
    }
  }

  const eventsByKind = new Map<string, number>();
  for (const event of trrEvents) {
    const index = eventsByKind.get(event.kind) ?? 0;
    eventsByKind.set(event.kind, index + 1);
    const dir = `${root}/trr-events/${event.kind}`;
    if (!directories.includes(dir)) directories.push(dir);
    files.push({ path: `${dir}/${String(index).padStart(3, "0")}.json`, data: bytes(event.data) });
  }

  return { directories, files };
}

export interface VfsWriteResult {
  written: number;
  root: string;
}

/** Write a single result's output artifacts (used by pipeline mode to persist
 *  each role's output as soon as it completes, before the next role runs). */
export async function writeResultOutputs(
  session: ModelComparisonSession,
  result: ModelResult,
  conversationId: string | undefined,
): Promise<void> {
  const vfs = getVfsApi();
  if (!vfs || !conversationId) return;
  const dir = resultDir(session, result);
  await vfs.mkdir(conversationId, dir);
  for (const output of result.outputs) {
    await vfs.writeFile(conversationId, `${dir}/stage-${output.stage}.json`, bytes(outputArtifact(output)));
  }
}

/** Write all session artifacts to the VFS. Returns null when the host VFS or
 *  conversation context is unavailable (standalone preview). */
export async function writeSessionArtifacts(
  session: ModelComparisonSession,
  trrEvents: TrrEvent[],
  conversationId: string | undefined,
): Promise<VfsWriteResult | null> {
  const vfs = getVfsApi();
  if (!vfs || !conversationId) return null;

  const { directories, files } = planSessionArtifacts(session, trrEvents);
  for (const dir of directories) {
    await vfs.mkdir(conversationId, dir);
  }
  for (const file of files) {
    await vfs.writeFile(conversationId, file.path, file.data);
  }
  return { written: files.length, root: sessionDir(session) };
}
