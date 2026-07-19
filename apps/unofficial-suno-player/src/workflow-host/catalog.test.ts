import { createHash } from "node:crypto";
import { describe, expect, it } from "@rstest/core";
import { node, workflow } from "./catalog";

const sri = (value: string): string => `sha256-${createHash("sha256").update(value).digest("base64")}`;
const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

describe("package workflow catalog", () => {
  it("exports a content-addressed canonical workflow source", () => {
    const file = workflow.files[0];
    expect(file).toBeDefined();
    expect(file?.integrity).toBe(sri(file?.content ?? ""));
    const unsigned = {
      apiVersion: workflow.apiVersion,
      workflowId: workflow.workflowId,
      files: workflow.files,
    };
    expect(workflow.integrity).toBe(sri(canonicalJson(unsigned)));
  });

  it("runs only the declared empty-input pure checkpoint", () => {
    expect(node({ inputs: {}, config: {} })).toEqual({ outcome: "ready" });
    expect(node({ inputs: { undeclared: true }, config: {} })).toEqual({ outcome: "error" });
  });
});
