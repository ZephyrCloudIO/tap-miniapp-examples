import { defineMcpServer } from "@theaiplatform/miniapp-sdk/mcp";
import {
  sdk,
  type MiniAppJsonValue,
  type MiniAppMaybePromise,
  type MiniAppMcpExecutionContext,
  type MiniAppStorageAddress,
  type MiniAppStorageEntry,
} from "@theaiplatform/miniapp-sdk/sdk";
import {
  emptyState,
  isEngineeringChangeState,
  openFindings,
  type EngineeringChange,
  type EngineeringChangeState,
} from "./domain";

const ADDRESS = {
  namespace: "engineering-change",
  key: "changes/v1",
} as const;
const MAX_STORED_BYTES = 1_000_000;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;

export type EngineeringChangeMcpExecutionContext = MiniAppMcpExecutionContext;

export interface EngineeringChangeMcpRuntime {
  getExecutionContext(): MiniAppMaybePromise<EngineeringChangeMcpExecutionContext>;
  readStorage(
    address: MiniAppStorageAddress,
  ): MiniAppMaybePromise<MiniAppStorageEntry>;
}

const defaultRuntime: EngineeringChangeMcpRuntime = {
  getExecutionContext: () => {
    if (!sdk.mcp) {
      return storageError(
        "the host did not provide package-runtime MCP execution context.",
      );
    }
    return sdk.mcp.getExecutionContext();
  },
  readStorage: (address) => sdk.storage.get(address),
};

function storageError(message: string): never {
  throw new Error(`Engineering Change MCP storage is unavailable: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertExecutionContext(
  value: unknown,
): asserts value is EngineeringChangeMcpExecutionContext {
  if (!isRecord(value)) storageError("the execution context is malformed.");
  const { channelId, userId } = value;
  if (
    channelId !== null &&
    (typeof channelId !== "string" ||
      !channelId.trim() ||
      channelId.length > 256 ||
      CONTROL_CHARACTER.test(channelId))
  ) {
    storageError("the execution context channel is malformed.");
  }
  if (
    userId !== null &&
    (typeof userId !== "string" ||
      !userId.trim() ||
      userId.length > 256 ||
      CONTROL_CHARACTER.test(userId))
  ) {
    storageError("the execution context user is malformed.");
  }
}

function toJson(value: unknown): MiniAppJsonValue {
  return JSON.parse(JSON.stringify(value)) as MiniAppJsonValue;
}

async function loadState(runtime: EngineeringChangeMcpRuntime): Promise<EngineeringChangeState> {
  const context = await runtime.getExecutionContext();
  assertExecutionContext(context);
  const current = await runtime.readStorage(ADDRESS);
  if (current.value === null) return emptyState();
  const decoded =
    typeof current.value === "string" ? JSON.parse(current.value) : current.value;
  if (!isEngineeringChangeState(decoded)) {
    storageError("the stored Engineering Change state is malformed.");
  }
  return decoded;
}

function changeIdFrom(arguments_: unknown): string {
  if (!isRecord(arguments_) || typeof arguments_.changeId !== "string") {
    throw new Error("changeId must be a string.");
  }
  const changeId = arguments_.changeId.trim();
  if (!changeId || changeId.length > 256 || CONTROL_CHARACTER.test(changeId)) {
    throw new Error("changeId is malformed.");
  }
  return changeId;
}

function summarizeChange(change: EngineeringChange) {
  return {
    id: change.id,
    title: change.title,
    phase: change.phase,
    assuranceLevel: change.assuranceLevel,
    openFindingCount: openFindings(change).length,
    readyForWorkAt: change.readyForWorkAt,
    workStartedAt: change.workStartedAt,
    updatedAt: change.updatedAt,
  };
}

export function createEngineeringChangeMcpServer(
  runtime: EngineeringChangeMcpRuntime = defaultRuntime,
) {
  return defineMcpServer({
    tools: {
      list_changes: {
        description:
          "List Engineering Changes in the active workspace with phase, assurance level, and open finding counts.",
        inputSchema: { type: "object", additionalProperties: false },
        async execute() {
          const state = await loadState(runtime);
          return toJson({
            changes: state.changes.map(summarizeChange),
          });
        },
      },
      get_change: {
        description:
          "Get one Engineering Change with its proposal, effective policy snapshot, findings, and audit trail.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            changeId: { type: "string", minLength: 1, maxLength: 256 },
          },
          required: ["changeId"],
        },
        async execute(arguments_) {
          const changeId = changeIdFrom(arguments_);
          const state = await loadState(runtime);
          const change = state.changes.find((item) => item.id === changeId);
          return change
            ? toJson({ found: true, change })
            : toJson({ found: false, changeId });
        },
      },
      get_impact_hypothesis: {
        description:
          "Get the pre-implementation Impact Hypothesis for one Engineering Change, including confidence and unresolved questions.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            changeId: { type: "string", minLength: 1, maxLength: 256 },
          },
          required: ["changeId"],
        },
        async execute(arguments_) {
          const changeId = changeIdFrom(arguments_);
          const state = await loadState(runtime);
          const change = state.changes.find((item) => item.id === changeId);
          return change?.impactHypothesis
            ? toJson({ found: true, impactHypothesis: change.impactHypothesis })
            : toJson({ found: false, changeId });
        },
      },
      get_review_synthesis: {
        description:
          "Get the coordinated Review Synthesis and cited findings for one Engineering Change.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            changeId: { type: "string", minLength: 1, maxLength: 256 },
          },
          required: ["changeId"],
        },
        async execute(arguments_) {
          const changeId = changeIdFrom(arguments_);
          const state = await loadState(runtime);
          const change = state.changes.find((item) => item.id === changeId);
          if (!change?.reviewSynthesis) return toJson({ found: false, changeId });
          return toJson({
            found: true,
            reviewSynthesis: change.reviewSynthesis,
            findings: change.findings,
          });
        },
      },
    },
  });
}

export const engineeringChangeMcpStorageAddress = Object.freeze({ ...ADDRESS });
