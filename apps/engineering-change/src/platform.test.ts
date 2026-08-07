import { describe, expect, it } from "@rstest/core";
import {
  findingTaskOptions,
  GovernedHttpError,
  isGovernedUrl,
} from "./platform";
import type { EngineeringChange, Finding } from "./domain";

describe("governed origin boundary", () => {
  it("admits only the declared governed origins", () => {
    expect(isGovernedUrl("https://api.github.com/repos/example/repo/pulls/1")).toBe(true);
    expect(isGovernedUrl("https://api.github.com")).toBe(true);
    expect(isGovernedUrl("http://api.github.com/repos/example/repo")).toBe(false);
    expect(isGovernedUrl("https://github.com/example/repo")).toBe(false);
    expect(isGovernedUrl("https://example.com/api.github.com")).toBe(false);
    expect(isGovernedUrl("not a url")).toBe(false);
  });

  it("fails closed for out-of-origin reads before any host call", async () => {
    const { governedHttpRead } = await import("./platform");
    await expect(
      governedHttpRead({ url: "https://example.com/evidence" }),
    ).rejects.toBeInstanceOf(GovernedHttpError);
  });
});

describe("finding follow-up tasks", () => {
  it("maps finding severity and provenance into a bounded canonical task", () => {
    const change = {
      id: "EC-2026-0042",
      title: "Harden authorization boundaries",
    } as EngineeringChange;
    const finding = {
      severity: "critical",
      summary: "Reject delegated writes that exceed the caller's authority",
      standard: "workspace-security:authz-4",
      file: "src/authority.ts",
      line: 42,
      symbol: "authorizeMutation",
      provenance: "security-implementation-review@1.0.0",
    } as Finding;

    expect(findingTaskOptions(change, finding)).toEqual({
      title:
        "[EC-2026-0042] Reject delegated writes that exceed the caller's authority",
      description: [
        "Engineering Change: EC-2026-0042 — Harden authorization boundaries",
        "Finding: Reject delegated writes that exceed the caller's authority",
        "Standard: workspace-security:authz-4",
        "Severity: critical",
        "Location: src/authority.ts · line 42 · authorizeMutation",
        "Provenance: security-implementation-review@1.0.0",
      ].join("\n"),
      status: "toDo",
      priority: "urgent",
    });
  });

  it("bounds long task titles", () => {
    const options = findingTaskOptions(
      { id: "EC-2026-0001", title: "Example" } as EngineeringChange,
      {
        severity: "info",
        summary: "x".repeat(500),
        standard: "example:1",
        file: null,
        line: null,
        symbol: null,
        provenance: null,
      } as Finding,
    );
    expect(options.title).toHaveLength(160);
    expect(options.priority).toBe("low");
  });
});
