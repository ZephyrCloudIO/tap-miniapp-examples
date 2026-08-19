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
  const usable = roles.filter((r) => r.options.length > 0);
  if (usable.length === 0) return [];

  if (mode === "linear") {
    const runCount = Math.max(...usable.map((r) => r.options.length));
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

  // matrix: cartesian product
  return usable.reduce<PipelineRunStep[][]>(
    (runs, role) =>
      runs.flatMap((run) => role.options.map((option) => [...run, { role, option }])),
    [[]],
  );
}

/** Number of runs a configuration would produce, for UI display. */
export function countPipelineRuns(
  optionCounts: number[],
  mode: PipelineCombination,
): number {
  const counts = optionCounts.filter((c) => c > 0);
  if (counts.length === 0) return 0;
  if (mode === "linear") return Math.max(...counts);
  return counts.reduce((product, c) => product * c, 1);
}

/** Short run label: "Plan:A → Deliver:AA → Review:AAA". */
export function runLabel(steps: PipelineRunStep[]): string {
  return steps.map((s) => `${s.role.label}:${s.option.model.id.split("/").pop()}`).join(" → ");
}
