import { describe, expect, it } from "@rstest/core";
import { countPipelineRuns, expandPipelineRuns, runLabel, type PipelineRoleConfig } from "./pipeline";

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
});
