import { describe, expect, it } from "@rstest/core";
import type {
  MiniAppJsonValue,
  MiniAppStorageAddress,
} from "@theaiplatform/miniapp-sdk/sdk";
import { emptyState, type EngineeringChangeState } from "./domain";
import {
  createEngineeringChangeMcpServer,
  engineeringChangeMcpStorageAddress,
  type EngineeringChangeMcpExecutionContext,
  type EngineeringChangeMcpRuntime,
} from "./mcp-runtime";
import { mcpServer } from "./mcp";

function runtimeFixture(
  value: MiniAppJsonValue = null,
  context: EngineeringChangeMcpExecutionContext = { channelId: null, userId: "user-1" },
) {
  const reads: MiniAppStorageAddress[] = [];
  const runtime: EngineeringChangeMcpRuntime = {
    getExecutionContext: () => context,
    readStorage(address) {
      reads.push(address);
      return { value, revision: 7 };
    },
  };
  return { runtime, reads };
}

function seededState(): EngineeringChangeState {
  const state = emptyState();
  state.changes.push({
    id: "EC-2026-0001",
    title: "Seed change",
    summary: "Seeded",
    phase: "review",
    proposal: "# Proposal",
    assuranceLevel: "full-rfc",
    effectivePolicy: null,
    impactHypothesis: {
      relatedSymbols: ["evaluatePolicies"],
      likelyOwners: ["team-platform"],
      applicablePolicies: ["workspace-default"],
      relevantStandards: ["workspace-standards:v3"],
      similarChanges: [],
      predictedBlastRadius: "two modules",
      confidence: 0.7,
      unresolvedQuestions: ["Who signs off?"],
      recordedAt: "2026-07-24T12:00:00Z",
    },
    impactEvidence: null,
    reviewContributions: [],
    reviewSynthesis: {
      id: "synthesis-1",
      coordinatorSkillVersion: "1.0.0",
      contributionIds: ["rc-1"],
      findingIds: ["finding-1"],
      unresolvedDisagreements: [],
      createdAt: "2026-07-24T13:00:00Z",
    },
    findings: [
      {
        id: "finding-1",
        severity: "medium",
        category: "architecture",
        standard: "workspace-standards:v3",
        file: "src/domain.ts",
        line: 10,
        symbol: "evaluatePolicies",
        summary: "Finding summary",
        confidence: 0.8,
        provenance: null,
        verification: "verified",
        disposition: null,
      },
    ],
    readyForWorkAt: null,
    workStartedAt: null,
    workStartSource: null,
    audit: [],
    createdAt: "2026-07-24T12:00:00Z",
    updatedAt: "2026-07-24T13:00:00Z",
    closedAt: null,
  });
  return state;
}

describe("Engineering Change MCP server", () => {
  it("exposes the package MCP ABI with four read tools", () => {
    expect(mcpServer).toBeDefined();
    expect(Object.keys(mcpServer.tools).sort()).toEqual([
      "get_change",
      "get_impact_hypothesis",
      "get_review_synthesis",
      "list_changes",
    ]);
    for (const tool of Object.values(mcpServer.tools)) {
      expect(typeof tool.description).toBe("string");
      expect(tool.inputSchema).toBeDefined();
      expect(typeof tool.execute).toBe("function");
    }
  });

  it("reads only the declared storage address", async () => {
    const { runtime, reads } = runtimeFixture(JSON.parse(JSON.stringify(seededState())));
    const server = createEngineeringChangeMcpServer(runtime);
    await server.tools.list_changes.execute();
    expect(reads).toEqual([engineeringChangeMcpStorageAddress]);
  });

  it("lists changes with summaries", async () => {
    const { runtime } = runtimeFixture(JSON.parse(JSON.stringify(seededState())));
    const server = createEngineeringChangeMcpServer(runtime);
    const result = (await server.tools.list_changes.execute()) as {
      changes: Array<Record<string, unknown>>;
    };
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({
      id: "EC-2026-0001",
      phase: "review",
      assuranceLevel: "full-rfc",
      openFindingCount: 1,
    });
  });

  it("returns an empty list when nothing is stored", async () => {
    const { runtime } = runtimeFixture();
    const server = createEngineeringChangeMcpServer(runtime);
    const result = (await server.tools.list_changes.execute()) as {
      changes: unknown[];
    };
    expect(result.changes).toEqual([]);
  });

  it("gets one change, its hypothesis, and its synthesis", async () => {
    const { runtime } = runtimeFixture(JSON.parse(JSON.stringify(seededState())));
    const server = createEngineeringChangeMcpServer(runtime);
    const change = (await server.tools.get_change.execute({
      changeId: "EC-2026-0001",
    })) as { found: boolean };
    expect(change.found).toBe(true);
    const hypothesis = (await server.tools.get_impact_hypothesis.execute({
      changeId: "EC-2026-0001",
    })) as { found: boolean; impactHypothesis: { confidence: number } };
    expect(hypothesis.found).toBe(true);
    expect(hypothesis.impactHypothesis.confidence).toBe(0.7);
    const synthesis = (await server.tools.get_review_synthesis.execute({
      changeId: "EC-2026-0001",
    })) as { found: boolean; findings: unknown[] };
    expect(synthesis.found).toBe(true);
    expect(synthesis.findings).toHaveLength(1);
  });

  it("reports missing changes without throwing", async () => {
    const { runtime } = runtimeFixture(JSON.parse(JSON.stringify(seededState())));
    const server = createEngineeringChangeMcpServer(runtime);
    const result = (await server.tools.get_change.execute({
      changeId: "EC-2026-9999",
    })) as { found: boolean };
    expect(result.found).toBe(false);
  });

  it("rejects malformed execution context and ids", async () => {
    const { runtime } = runtimeFixture(null, { channelId: null, userId: "  " });
    const server = createEngineeringChangeMcpServer(runtime);
    await expect(server.tools.list_changes.execute()).rejects.toThrow(/user/u);

    const healthy = createEngineeringChangeMcpServer(runtimeFixture().runtime);
    await expect(
      healthy.tools.get_change.execute({ changeId: " " }),
    ).rejects.toThrow(/changeId/u);
  });
});
