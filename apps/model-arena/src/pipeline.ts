/* ==========================================================================
   Model Arena — Pipeline Run Expansion
   Each pipeline role offers one or more options (model + arm). Options across
   roles combine into full pipeline runs in one of two modes:

   - matrix: cartesian product. Two plan options, one deliver, one review
     yields 2 runs (A→AA→AAA, B→AA→AAA); 2×2×3 yields 12 runs.
   - linear: index-wise pairing. Run k takes option (k mod count) of each
     role, so run count is the largest option count.
   ========================================================================== */

import type { BenchmarkArm, SelectedModel } from "./domain";

export interface PipelineOption {
  model: SelectedModel;
  arm: BenchmarkArm;
}

export interface PipelineRoleConfig {
  id: string;
  label: string;
  instruction: string;
  options: PipelineOption[];
}

export type PipelineCombination = "matrix" | "linear";

/** Hard release guardrails for paid pipeline execution. */
export const MAX_PIPELINE_RUNS = 24;
export const MAX_PIPELINE_CONCURRENCY = 4;
export const MAX_PIPELINE_ROLES = 8;
export const MAX_PIPELINE_OPTIONS_PER_ROLE = 8;

/** One step in one run: a role bound to one of its options. */
export interface PipelineRunStep {
  role: PipelineRoleConfig;
  option: PipelineOption;
}

/** Expand role configs into full runs according to the combination mode. */
export function expandPipelineRuns(
  roles: PipelineRoleConfig[],
  mode: PipelineCombination,
): PipelineRunStep[][] {
  const usable = roles
    .filter((role) => role.options.length > 0)
    .slice(0, MAX_PIPELINE_ROLES)
    .map((role) => ({
      ...role,
      options: role.options.slice(0, MAX_PIPELINE_OPTIONS_PER_ROLE),
    }));
  if (usable.length === 0) return [];

  if (mode === "linear") {
    const runCount = Math.min(
      MAX_PIPELINE_RUNS,
      Math.max(...usable.map((r) => r.options.length)),
    );
    const runs: PipelineRunStep[][] = [];
    for (let k = 0; k < runCount; k++) {
      runs.push(
        usable.map((role) => ({
          role,
          option: role.options[k % role.options.length]!,
        })),
      );
    }
    return runs;
  }

  // Matrix: cartesian product, stopped as soon as the paid-run cap is reached.
  // Keeping every intermediate set bounded also avoids allocating the full
  // product before slicing it down.
  let runs: PipelineRunStep[][] = [[]];
  for (const role of usable) {
    const expanded: PipelineRunStep[][] = [];
    expansion: for (const run of runs) {
      for (const option of role.options) {
        expanded.push([...run, { role, option }]);
        if (expanded.length === MAX_PIPELINE_RUNS) break expansion;
      }
    }
    runs = expanded;
  }
  return runs;
}

/** Number of executable runs, capped at MAX_PIPELINE_RUNS for UI display. */
export function countPipelineRuns(
  optionCounts: number[],
  mode: PipelineCombination,
): number {
  const counts = optionCounts
    .slice(0, MAX_PIPELINE_ROLES)
    .map((count) => Math.min(count, MAX_PIPELINE_OPTIONS_PER_ROLE))
    .filter((count) => count > 0);
  if (counts.length === 0) return 0;
  if (mode === "linear") return Math.min(MAX_PIPELINE_RUNS, Math.max(...counts));

  let product = 1;
  for (const count of counts) {
    // Avoid overflowing before applying the hard cap.
    if (product >= Math.ceil(MAX_PIPELINE_RUNS / count)) return MAX_PIPELINE_RUNS;
    product *= count;
  }
  return product;
}

/**
 * Map async work with stable result ordering and all-settled semantics.
 * Callers may request a lower concurrency; higher values remain clamped to
 * MAX_PIPELINE_CONCURRENCY so paid fan-out cannot accidentally become unbounded.
 */
export async function mapSettledWithConcurrency<T, R>(
  items: readonly T[],
  mapper: (item: T, index: number) => Promise<R> | R,
  concurrency = MAX_PIPELINE_CONCURRENCY,
): Promise<PromiseSettledResult<R>[]> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new RangeError("concurrency must be a positive integer");
  }

  const workerCount = Math.min(items.length, concurrency, MAX_PIPELINE_CONCURRENCY);
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;

      try {
        results[index] = { status: "fulfilled", value: await mapper(items[index]!, index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

/** Short run label: "Plan:A → Deliver:AA → Review:AAA". */
export function runLabel(steps: PipelineRunStep[]): string {
  return steps.map((s) => `${s.role.label}:${s.option.model.id.split("/").pop()}`).join(" → ");
}
