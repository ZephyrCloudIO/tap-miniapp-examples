import { describe, expect, it } from "@rstest/core";
import type {
  MiniAppJsonValue,
  MiniAppStorageAddress,
} from "@theaiplatform/miniapp-sdk/sdk";
import {
  createPyreMcpServer,
  loadPyreMcpState,
  pyreMcpStorageAddresses,
  type PyreMcpExecutionContext,
  type PyreMcpRuntime,
} from "./mcp-runtime";
import * as mcpEntry from "./mcp";

const { mcpServer } = mcpEntry;

function runtimeFixture(
  values: Partial<Record<"investigations/v2" | "investigations/v1", MiniAppJsonValue>> = {},
  context: PyreMcpExecutionContext = { channelId: null, userId: "user-1" },
) {
  const reads: MiniAppStorageAddress[] = [];
  const runtime: PyreMcpRuntime = {
    getExecutionContext: () => context,
    readStorage(address) {
      reads.push(address);
      return {
        value: values[address.key as keyof typeof values] ?? null,
        revision: 7,
      };
    },
  };
  return { runtime, reads };
}

function legacyInvestigation(
  overrides: Record<string, MiniAppJsonValue> = {},
): Record<string, MiniAppJsonValue> {
  return {
    id: "legacy-incident",
    title: "Legacy incident",
    statement: "The legacy incident statement is preserved.",
    severity: "SEV-2",
    status: "investigating",
    impact: "Customer requests failed.",
    systems: [],
    regions: [],
    times: {},
    sourceLinks: [],
    phase: "intake",
    createdAt: "2026-01-02T03:04:05.000Z",
    createdBy: "user-1",
    members: { "user-1": "lead" },
    evidence: [],
    timeline: [],
    whys: [],
    actions: [],
    questions: ["Who owns the follow-up?"],
    decisions: [],
    audit: [],
    revision: 1,
    ...overrides,
  };
}

function legacyState(
  investigation: Record<string, MiniAppJsonValue> = legacyInvestigation(),
): MiniAppJsonValue {
  return {
    schemaVersion: 1,
    activeId: investigation.id,
    investigations: [investigation],
  };
}

function currentInvestigation(
  overrides: Record<string, MiniAppJsonValue> = {},
): Record<string, MiniAppJsonValue> {
  return {
    schemaVersion: 2,
    id: "inc-current",
    title: "Current incident",
    statement: "A complete current-schema incident statement.",
    severity: "SEV-2",
    status: "investigating",
    impact: "Customer requests failed.",
    businessImpact: "",
    systems: [],
    regions: [],
    times: {},
    sourceLinks: [],
    phase: "review",
    createdAt: "2026-01-02T03:04:05.000Z",
    updatedAt: "2026-01-02T03:04:05.000Z",
    createdBy: "user-1",
    members: [
      {
        id: "user-1",
        displayName: "Incident Lead",
        role: "lead",
        joinedAt: "2026-01-02T03:04:05.000Z",
      },
    ],
    evidence: [],
    timeline: [],
    whys: [],
    actions: [],
    questions: [],
    decisions: [],
    reports: [],
    audit: [],
    revision: 1,
    bindings: {},
    ...overrides,
  };
}

describe("Pyre MCP server", () => {
  it("declares the bounded read-only investigation tools", () => {
    expect(Object.keys(mcpEntry)).toEqual(["mcpServer"]);
    expect(Object.keys(mcpServer.tools).toSorted()).toEqual([
      "get_investigation",
      "list_investigations",
    ]);
    expect(mcpServer.tools.get_investigation.inputSchema).toMatchObject({
      additionalProperties: false,
      required: ["investigationId"],
    });
  });

  it("accepts a nullable channel and reads only the exact current Pyre address", async () => {
    const { runtime, reads } = runtimeFixture({
      "investigations/v2": { schemaVersion: 2, investigations: [] },
      "investigations/v1": {
        schemaVersion: 1,
        investigations: [{ id: "must-not-be-read" }],
      },
    });
    const server = createPyreMcpServer(runtime);

    await expect(
      server.tools.list_investigations.execute(),
    ).resolves.toEqual({
      activeId: null,
      investigations: [],
    });
    expect(reads).toEqual([pyreMcpStorageAddresses.current]);
  });

  it("is independent of more than 256 unrelated rows totaling over 1 MiB", async () => {
    const unrelated = new Map(
      Array.from({ length: 300 }, (_, index) => [
        `unrelated/${index}`,
        "x".repeat(8_192),
      ]),
    );
    const totalUnrelatedBytes = [...unrelated.values()].reduce(
      (total, value) => total + value.length,
      0,
    );
    const reads: MiniAppStorageAddress[] = [];
    const runtime: PyreMcpRuntime = {
      getExecutionContext: () => ({ channelId: null, userId: "user-1" }),
      readStorage(address) {
        reads.push(address);
        return {
          value:
            address.key === pyreMcpStorageAddresses.current.key
              ? { schemaVersion: 2, investigations: [] }
              : (unrelated.get(address.key) ?? null),
          revision: 1,
        };
      },
    };

    expect(unrelated.size).toBeGreaterThan(256);
    expect(totalUnrelatedBytes).toBeGreaterThan(1_048_576);
    await expect(loadPyreMcpState(runtime)).resolves.toMatchObject({
      schemaVersion: 2,
      investigations: [],
    });
    expect(reads).toEqual([pyreMcpStorageAddresses.current]);
  });

  it("falls back to v1 and migrates generated identifiers deterministically", async () => {
    const { runtime, reads } = runtimeFixture({
      "investigations/v1": legacyState(),
    });

    const state = await loadPyreMcpState(runtime);

    expect(reads).toEqual([
      pyreMcpStorageAddresses.current,
      pyreMcpStorageAddresses.legacy,
    ]);
    expect(state.investigations[0]).toMatchObject({
      id: "legacy-incident",
      title: "Legacy incident",
      questions: [
        {
          id: "question_mcp_migration_1",
          text: "Who owns the follow-up?",
        },
      ],
    });
  });

  it("migrates the same v1 state identically without consulting the clock", async () => {
    const { runtime } = runtimeFixture({
      "investigations/v1": legacyState(),
    });

    const first = await loadPyreMcpState(runtime);
    const second = await loadPyreMcpState(runtime);

    expect(second).toEqual(first);
    expect(second.investigations[0]?.createdAt).toBe(
      "2026-01-02T03:04:05.000Z",
    );
    expect(second.investigations[0]?.updatedAt).toBe(
      "2026-01-02T03:04:05.000Z",
    );
  });

  it("rejects legacy investigations without their original timestamp", async () => {
    const investigation = legacyInvestigation();
    delete investigation.createdAt;
    const { runtime } = runtimeFixture({
      "investigations/v1": legacyState(investigation),
    });

    await expect(loadPyreMcpState(runtime)).rejects.toThrow(
      /legacy investigation 0 createdAt is malformed/u,
    );
  });

  it("rejects legacy investigations with missing required facts", async () => {
    const investigation = legacyInvestigation();
    delete investigation.title;
    const { runtime } = runtimeFixture({
      "investigations/v1": legacyState(investigation),
    });

    await expect(loadPyreMcpState(runtime)).rejects.toThrow(
      /legacy investigation 0 title is malformed/u,
    );
  });

  it("rejects malformed legacy investigation and nested collection items", async () => {
    const malformedInvestigation = runtimeFixture({
      "investigations/v1": {
        schemaVersion: 1,
        activeId: "legacy-incident",
        investigations: [null],
      },
    });
    await expect(
      loadPyreMcpState(malformedInvestigation.runtime),
    ).rejects.toThrow(/legacy investigation 0 is malformed/u);

    const malformedEvidence = runtimeFixture({
      "investigations/v1": legacyState(
        legacyInvestigation({ evidence: [{}] }),
      ),
    });
    await expect(
      loadPyreMcpState(malformedEvidence.runtime),
    ).rejects.toThrow(/legacy investigation 0 evidence 0 id is malformed/u);
  });

  it("rejects oversized legacy rows before migration", async () => {
    const { runtime } = runtimeFixture({
      "investigations/v1": legacyState(
        legacyInvestigation({ padding: "x".repeat(1_000_001) }),
      ),
    });

    await expect(loadPyreMcpState(runtime)).rejects.toThrow(
      /legacy state exceeds the MCP read limit/u,
    );
  });

  it("rejects oversized raw legacy JSON before parsing", async () => {
    const raw = `${JSON.stringify(legacyState())}${" ".repeat(1_000_001)}`;
    const { runtime } = runtimeFixture({ "investigations/v1": raw });

    await expect(loadPyreMcpState(runtime)).rejects.toThrow(
      /legacy state exceeds the MCP read limit/u,
    );
  });

  it("returns deterministic empty state when both storage keys are absent", async () => {
    const { runtime, reads } = runtimeFixture();
    await expect(loadPyreMcpState(runtime)).resolves.toEqual({
      schemaVersion: 2,
      investigations: [],
    });
    expect(reads).toEqual([
      pyreMcpStorageAddresses.current,
      pyreMcpStorageAddresses.legacy,
    ]);
  });

  it("fails closed on malformed current state instead of consulting v1", async () => {
    const malformed = currentInvestigation();
    delete malformed.title;
    const { runtime, reads } = runtimeFixture({
      "investigations/v2": {
        schemaVersion: 2,
        investigations: [malformed],
      },
      "investigations/v1": { schemaVersion: 1, investigations: [] },
    });

    await expect(loadPyreMcpState(runtime)).rejects.toThrow(
      /investigation 0 title is malformed/u,
    );
    expect(reads).toEqual([pyreMcpStorageAddresses.current]);
  });

  it("works with a trusted channel when one is present", async () => {
    const { runtime } = runtimeFixture(
      { "investigations/v2": { schemaVersion: 2, investigations: [] } },
      { channelId: "channel-12", userId: null },
    );
    await expect(loadPyreMcpState(runtime)).resolves.toMatchObject({
      schemaVersion: 2,
    });
  });

  it("returns an explicit miss without inventing an investigation", async () => {
    const { runtime } = runtimeFixture({
      "investigations/v2": { schemaVersion: 2, investigations: [] },
    });
    const server = createPyreMcpServer(runtime);

    await expect(
      server.tools.get_investigation.execute({
        investigationId: "inc_missing",
      }),
    ).resolves.toEqual({
      found: false,
      investigationId: "inc_missing",
    });
  });

  it("recursively redacts report bodies and audit before/after snapshots", async () => {
    const secretMarkdown = "SECRET_REPORT_MARKDOWN";
    const secretHtml = "<p>SECRET_REPORT_HTML</p>";
    const { runtime } = runtimeFixture({
      "investigations/v2": {
        schemaVersion: 2,
        activeId: "inc_sensitive",
        investigations: [
          currentInvestigation({
            id: "inc_sensitive",
            title: "Sensitive report regression",
            reports: [
              {
                id: "report-1",
                number: 1,
                createdAt: "2026-01-02T03:04:05.000Z",
                createdBy: "user-1",
                visibility: "internal",
                template: "engineering",
                status: "draft",
                markdown: secretMarkdown,
                html: secretHtml,
                digest: "report-digest",
              },
            ],
            audit: [
              {
                id: "audit-1",
                at: "2026-01-02T03:04:05.000Z",
                actorId: "user-1",
                action: "report.reviewed",
                entityType: "report",
                entityId: "report-1",
                before: {
                  reports: [{ markdown: secretMarkdown, html: secretHtml }],
                },
                after: {
                  nested: {
                    markdown: secretMarkdown,
                    html: secretHtml,
                  },
                },
                summary: "Report reviewed.",
              },
            ],
            revision: 4,
          }),
        ],
      },
    });
    const server = createPyreMcpServer(runtime);

    const result = await server.tools.get_investigation.execute({
      investigationId: "inc_sensitive",
    });
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain(secretMarkdown);
    expect(serialized).not.toContain(secretHtml);
    expect(result).toMatchObject({
      found: true,
      investigation: {
        reports: [{ markdownLength: 22, htmlLength: 25 }],
        audit: [
          {
            id: "audit-1",
            at: "2026-01-02T03:04:05.000Z",
            action: "report.reviewed",
            entityType: "report",
          },
        ],
      },
    });
    expect((result as any).investigation.audit[0]).not.toHaveProperty("before");
    expect((result as any).investigation.audit[0]).not.toHaveProperty("after");
  });

  it("projects an explicit DTO without unknown or private stored fields", async () => {
    const secret = "UNKNOWN_PRIVATE_SECRET";
    const investigation = currentInvestigation({
      privateSecret: secret,
      reports: [
        {
          id: "report-1",
          number: 1,
          createdAt: "2026-01-02T03:04:05.000Z",
          createdBy: "user-1",
          visibility: "internal",
          template: "engineering",
          status: "draft",
          markdown: "Report body",
          html: "<p>Report body</p>",
          digest: "digest",
          privateSecret: secret,
        },
      ],
      bindings: {
        projectId: "project-private",
        channelId: "channel-private",
      },
      audit: [
        {
          id: "audit-private",
          at: "2026-01-02T03:04:05.000Z",
          actorId: "canonical-user-private",
          action: "platform.connected",
          entityType: "platform-binding",
          entityId: "workflow-run-private",
          summary:
            "Connected project-private to channel-private with specialist-private.",
        },
      ],
    });
    const { runtime } = runtimeFixture({
      "investigations/v2": {
        schemaVersion: 2,
        activeId: investigation.id,
        investigations: [investigation],
      },
    });
    const server = createPyreMcpServer(runtime);

    const result = await server.tools.get_investigation.execute({
      investigationId: "inc-current",
    });
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("project-private");
    expect(serialized).not.toContain("channel-private");
    expect(serialized).not.toContain("canonical-user-private");
    expect(serialized).not.toContain("workflow-run-private");
    expect(serialized).not.toContain("specialist-private");
    expect((result as any).investigation).not.toHaveProperty("privateSecret");
    expect((result as any).investigation).not.toHaveProperty("bindings");
  });

  it("rejects duplicate investigation identifiers", async () => {
    const { runtime } = runtimeFixture({
      "investigations/v2": {
        schemaVersion: 2,
        investigations: [
          currentInvestigation(),
          currentInvestigation({ title: "Duplicate current incident" }),
        ],
      },
    });

    await expect(loadPyreMcpState(runtime)).rejects.toThrow(
      /investigations contains duplicate id inc-current/u,
    );
  });

  it("rejects duplicate nested entity identifiers", async () => {
    const member = {
      id: "user-1",
      displayName: "Incident Lead",
      role: "lead",
      joinedAt: "2026-01-02T03:04:05.000Z",
    };
    const { runtime } = runtimeFixture({
      "investigations/v2": {
        schemaVersion: 2,
        investigations: [
          currentInvestigation({ members: [member, { ...member }] }),
        ],
      },
    });

    await expect(loadPyreMcpState(runtime)).rejects.toThrow(
      /investigation 0 members contains duplicate id user-1/u,
    );
  });

  it("rejects invalid current-schema enum values", async () => {
    const { runtime } = runtimeFixture({
      "investigations/v2": {
        schemaVersion: 2,
        investigations: [
          currentInvestigation({ severity: "SEV-UNBOUNDED" }),
        ],
      },
    });

    await expect(loadPyreMcpState(runtime)).rejects.toThrow(
      /investigation 0 severity is malformed/u,
    );
  });

  it("rejects invalid nested enum values", async () => {
    const { runtime } = runtimeFixture({
      "investigations/v2": {
        schemaVersion: 2,
        investigations: [
          currentInvestigation({
            members: [
              {
                id: "user-1",
                displayName: "Incident Lead",
                role: "super-admin",
                joinedAt: "2026-01-02T03:04:05.000Z",
              },
            ],
          }),
        ],
      },
    });

    await expect(loadPyreMcpState(runtime)).rejects.toThrow(
      /investigation 0 members item 0 role is malformed/u,
    );
  });

  it("rejects dangling nested entity references", async () => {
    const { runtime } = runtimeFixture({
      "investigations/v2": {
        schemaVersion: 2,
        investigations: [
          currentInvestigation({
            actions: [
              {
                id: "action-1",
                title: "Fix the contributing factor",
                factorId: "why-missing",
                category: "prevention",
                priority: "high",
                owner: "user-1",
                acceptanceCriteria: "The regression test passes.",
                verificationMethod: "Run the regression suite.",
                requiredEvidence: "A passing CI receipt.",
                evidenceIds: [],
                status: "open",
              },
            ],
          }),
        ],
      },
    });

    await expect(loadPyreMcpState(runtime)).rejects.toThrow(
      /action action-1 factorId references missing id why-missing/u,
    );
  });

  it("rejects cyclic nested entity references", async () => {
    const timelineEvent = (id: string, supersedesId: string) => ({
      id,
      timestamp: "2026-01-02T03:04:05.000Z",
      originalTimestamp: "2026-01-02T03:04:05.000Z",
      timezone: "UTC",
      type: "investigation",
      actor: "Incident Lead",
      description: `Timeline event ${id}`,
      confidence: "confirmed",
      evidenceIds: [],
      reviewStatus: "confirmed",
      supersedesId,
    });
    const { runtime } = runtimeFixture({
      "investigations/v2": {
        schemaVersion: 2,
        investigations: [
          currentInvestigation({
            timeline: [
              timelineEvent("timeline-a", "timeline-b"),
              timelineEvent("timeline-b", "timeline-a"),
            ],
          }),
        ],
      },
    });

    await expect(loadPyreMcpState(runtime)).rejects.toThrow(
      /timeline supersedes graph contains a cycle/u,
    );
  });

  it("rejects non-reciprocal evidence links", async () => {
    const { runtime } = runtimeFixture({
      "investigations/v2": {
        schemaVersion: 2,
        investigations: [
          currentInvestigation({
            evidence: [
              {
                id: "evidence-1",
                title: "Incident log",
                kind: "log",
                source: "approved source",
                description: "An approved incident log.",
                collectedAt: "2026-01-02T03:04:05.000Z",
                collectedBy: "user-1",
                visibility: "investigation",
                digest: "digest",
                reliability: "source-verified",
                systems: [],
                supportsClaimIds: [],
                contradictsClaimIds: [],
                timelineEventIds: ["timeline-1"],
                immutableSnapshot: false,
                collectionStatus: "reference",
              },
            ],
            timeline: [
              {
                id: "timeline-1",
                timestamp: "2026-01-02T03:04:05.000Z",
                originalTimestamp: "2026-01-02T03:04:05.000Z",
                timezone: "UTC",
                type: "investigation",
                actor: "Incident Lead",
                description: "The investigation began.",
                confidence: "confirmed",
                evidenceIds: [],
                reviewStatus: "confirmed",
              },
            ],
          }),
        ],
      },
    });

    await expect(loadPyreMcpState(runtime)).rejects.toThrow(
      /evidence evidence-1 timeline link to timeline-1 is not reciprocal/u,
    );
  });

  it("rejects a dangling active investigation identifier", async () => {
    const { runtime } = runtimeFixture({
      "investigations/v2": {
        schemaVersion: 2,
        activeId: "inc-missing",
        investigations: [currentInvestigation()],
      },
    });

    await expect(loadPyreMcpState(runtime)).rejects.toThrow(
      /activeId does not reference an investigation/u,
    );
  });
});
