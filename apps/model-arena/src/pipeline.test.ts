import { describe, expect, it } from "@rstest/core";
import {
  MAX_PIPELINE_CONCURRENCY,
  MAX_PIPELINE_OPTIONS_PER_ROLE,
  MAX_PIPELINE_ROLES,
  MAX_PIPELINE_RUNS,
  countPipelineRuns,
  expandPipelineRuns,
  mapSettledWithConcurrency,
  runLabel,
  type PipelineRoleConfig,
} from "./pipeline";

function option(modelId: string, arm: "model" | "specialist" = "model") {
  return {
    model: { id: modelId, name: modelId.split("/")[1] ?? modelId, provider: modelId.split("/")[0] ?? "x" },
    arm,
  };
}

function role(id: string, modelIds: string[]): PipelineRoleConfig {
  return {
    id,
    label: id[0]!.toUpperCase() + id.slice(1),
    instruction: `do ${id}`,
    options: modelIds.map((m) => option(m)),
  };
}

describe("expandPipelineRuns", () => {
  it("matrix: single option per role yields one run", () => {
    const runs = expandPipelineRuns(
      [role("plan", ["a/A"]), role("deliver", ["a/AA"]), role("review", ["a/AAA"])],
      "matrix",
    );
    expect(runs).toHaveLength(1);
    expect(runLabel(runs[0]!)).toBe("Plan:A → Deliver:AA → Review:AAA");
  });

  it("matrix: two plans, one deliver, one review yields two runs", () => {
    const runs = expandPipelineRuns(
      [role("plan", ["a/A", "a/B"]), role("deliver", ["a/AA"]), role("review", ["a/AAA"])],
      "matrix",
    );
    expect(runs).toHaveLength(2);
    expect(runLabel(runs[0]!)).toBe("Plan:A → Deliver:AA → Review:AAA");
    expect(runLabel(runs[1]!)).toBe("Plan:B → Deliver:AA → Review:AAA");
  });

  it("matrix: 2×2×3 yields twelve runs", () => {
    const runs = expandPipelineRuns(
      [
        role("plan", ["a/A", "a/B"]),
        role("deliver", ["a/AA", "a/BB"]),
        role("review", ["a/AAA", "a/BBB", "a/CCC"]),
      ],
      "matrix",
    );
    expect(runs).toHaveLength(12);
    // Every step in every run binds the role to one of its own options
    for (const run of runs) {
      expect(run).toHaveLength(3);
      expect(new Set(run.map((s) => s.role.id))).toEqual(new Set(["plan", "deliver", "review"]));
    }
  });

  it("linear: pairs options by position, cycling shorter roles", () => {
    const runs = expandPipelineRuns(
      [role("plan", ["a/A", "a/B", "a/C"]), role("deliver", ["a/AA"])],
      "linear",
    );
    expect(runs).toHaveLength(3);
    expect(runLabel(runs[2]!)).toBe("Plan:C → Deliver:AA");
  });

  it("linear: equal counts zip exactly", () => {
    const runs = expandPipelineRuns(
      [role("plan", ["a/A", "a/B"]), role("deliver", ["a/AA", "a/BB"])],
      "linear",
    );
    expect(runs).toHaveLength(2);
    expect(runLabel(runs[0]!)).toBe("Plan:A → Deliver:AA");
    expect(runLabel(runs[1]!)).toBe("Plan:B → Deliver:BB");
  });

  it("skips roles with no options", () => {
    const runs = expandPipelineRuns(
      [role("plan", ["a/A"]), role("deliver", []), role("review", ["a/AAA"])],
      "matrix",
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]).toHaveLength(2);
  });

  it("caps matrix expansion before materializing an unbounded product", () => {
    const ids = Array.from({ length: 10 }, (_, index) => `a/M${index}`);
    const runs = expandPipelineRuns(
      [role("plan", ids), role("deliver", ids), role("review", ids)],
      "matrix",
    );
    expect(runs).toHaveLength(MAX_PIPELINE_RUNS);
    expect(runLabel(runs[0]!)).toBe("Plan:M0 → Deliver:M0 → Review:M0");
  });

  it("caps linear expansion at the per-role option limit", () => {
    const ids = Array.from({ length: MAX_PIPELINE_RUNS + 10 }, (_, index) => `a/M${index}`);
    expect(expandPipelineRuns([role("plan", ids)], "linear")).toHaveLength(
      MAX_PIPELINE_OPTIONS_PER_ROLE,
    );
  });

  it("caps roles and options before expanding paid work", () => {
    const ids = Array.from(
      { length: MAX_PIPELINE_OPTIONS_PER_ROLE + 3 },
      (_, index) => `a/M${index}`,
    );
    const roles = Array.from(
      { length: MAX_PIPELINE_ROLES + 3 },
      (_, index) => role(`role-${index}`, ids),
    );
    const runs = expandPipelineRuns(roles, "linear");
    expect(runs).toHaveLength(MAX_PIPELINE_OPTIONS_PER_ROLE);
    expect(runs.every((run) => run.length === MAX_PIPELINE_ROLES)).toBe(true);
  });
});

describe("countPipelineRuns", () => {
  it("matrix multiplies option counts", () => {
    expect(countPipelineRuns([2, 1, 1], "matrix")).toBe(2);
    expect(countPipelineRuns([2, 2, 3], "matrix")).toBe(12);
  });

  it("linear takes the max option count", () => {
    expect(countPipelineRuns([3, 1], "linear")).toBe(3);
    expect(countPipelineRuns([2, 2], "linear")).toBe(2);
  });

  it("zero when any configuration is empty", () => {
    expect(countPipelineRuns([], "matrix")).toBe(0);
    expect(countPipelineRuns([0], "matrix")).toBe(0);
  });

  it("reports the capped executable count without overflowing", () => {
    expect(countPipelineRuns([10, 10, 10], "matrix")).toBe(MAX_PIPELINE_RUNS);
    expect(countPipelineRuns([Number.MAX_SAFE_INTEGER, 2], "matrix")).toBe(16);
    expect(countPipelineRuns([MAX_PIPELINE_RUNS + 1], "linear")).toBe(
      MAX_PIPELINE_OPTIONS_PER_ROLE,
    );
  });

  it("applies the role and per-role option caps to counts", () => {
    expect(countPipelineRuns([MAX_PIPELINE_OPTIONS_PER_ROLE + 5], "linear")).toBe(
      MAX_PIPELINE_OPTIONS_PER_ROLE,
    );
    expect(
      countPipelineRuns(
        Array.from({ length: MAX_PIPELINE_ROLES + 5 }, () => 1),
        "matrix",
      ),
    ).toBe(1);
  });
});

describe("mapSettledWithConcurrency", () => {
  it("limits active work and preserves input order", async () => {
    let active = 0;
    let peakActive = 0;
    const values = [30, 5, 20, 10, 15, 1];

    const results = await mapSettledWithConcurrency(
      values,
      async (value, index) => {
        active += 1;
        peakActive = Math.max(peakActive, active);
        await new Promise((resolve) => setTimeout(resolve, value));
        active -= 1;
        return index;
      },
      2,
    );

    expect(peakActive).toBe(2);
    expect(results).toEqual(
      values.map((_, index) => ({ status: "fulfilled", value: index })),
    );
  });

  it("clamps high concurrency and settles individual failures", async () => {
    let active = 0;
    let peakActive = 0;
    const failure = new Error("failed task");

    const results = await mapSettledWithConcurrency(
      Array.from({ length: 12 }, (_, index) => index),
      async (value) => {
        active += 1;
        peakActive = Math.max(peakActive, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active -= 1;
        if (value === 5) throw failure;
        return value * 2;
      },
      100,
    );

    expect(peakActive).toBe(MAX_PIPELINE_CONCURRENCY);
    expect(results[5]).toEqual({ status: "rejected", reason: failure });
    expect(results[11]).toEqual({ status: "fulfilled", value: 22 });
  });

  it("rejects invalid concurrency", async () => {
    await expect(mapSettledWithConcurrency([1], async (value) => value, 0)).rejects.toThrow(
      RangeError,
    );
  });
});
