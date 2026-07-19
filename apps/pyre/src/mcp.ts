import { defineMcpServer } from "@theaiplatform/miniapp-sdk/mcp";
import type { MiniAppJsonValue } from "@theaiplatform/miniapp-sdk/sdk";
import type { Investigation } from "./domain";
import { loadState } from "./storage";

function toJson(value: unknown): MiniAppJsonValue {
  return JSON.parse(JSON.stringify(value)) as MiniAppJsonValue;
}

function investigationIdFrom(arguments_: MiniAppJsonValue): string {
  if (!arguments_ || typeof arguments_ !== "object" || Array.isArray(arguments_)) {
    throw new Error("get_investigation requires an object argument.");
  }
  const investigationId = arguments_.investigationId;
  if (typeof investigationId !== "string" || !investigationId.trim()) {
    throw new Error("get_investigation requires a non-empty investigationId.");
  }
  return investigationId;
}

function boundedInvestigation(investigation: Investigation) {
  return {
    ...investigation,
    reports: investigation.reports.map(({ markdown, html, ...report }) => ({
      ...report,
      markdownLength: markdown.length,
      htmlLength: html.length,
    })),
  };
}

export const pyreMcpServer = defineMcpServer({
  tools: {
    list_investigations: {
      description: "List Pyre investigations in the active workspace with lifecycle and evidence counts.",
      inputSchema: { type: "object", additionalProperties: false },
      async execute() {
        const { state } = await loadState(false);
        return toJson({
          activeId: state.activeId ?? null,
          investigations: state.investigations.map((investigation) => ({
            id: investigation.id,
            title: investigation.title,
            statement: investigation.statement,
            severity: investigation.severity,
            status: investigation.status,
            phase: investigation.phase,
            revision: investigation.revision,
            evidenceCount: investigation.evidence.length,
            timelineEventCount: investigation.timeline.length,
            openQuestionCount: investigation.questions.filter((question) => question.status === "open").length,
            openActionCount: investigation.actions.filter((action) => action.status !== "verified" && action.status !== "cancelled").length,
            updatedAt: investigation.updatedAt,
          })),
        });
      },
    },
    get_investigation: {
      description: "Get reviewed structured Pyre investigation state without report body duplication or raw VFS artifact contents.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: { investigationId: { type: "string", minLength: 1 } },
        required: ["investigationId"],
      },
      async execute(arguments_) {
        const investigationId = investigationIdFrom(arguments_);
        const { state } = await loadState(false);
        const investigation = state.investigations.find((item) => item.id === investigationId);
        return investigation
          ? toJson({ found: true, investigation: boundedInvestigation(investigation) })
          : toJson({ found: false, investigationId });
      },
    },
  },
});

export const tools = pyreMcpServer.tools;
export default pyreMcpServer;
