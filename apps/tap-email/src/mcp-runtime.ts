import { defineMcpServer } from '@theaiplatform/miniapp-sdk/mcp';
import {
  sdk,
  type MiniAppJsonValue,
  type MiniAppMaybePromise,
  type MiniAppMcpExecutionContext,
  type MiniAppStorageAddress,
  type MiniAppStorageEntry,
} from '@theaiplatform/miniapp-sdk/sdk';
import {
  isActiveEmailContext,
  isMailboxSummary,
} from '@tap-examples/tap-email-protocol';
import {
  activityAddress,
  operationalAddress,
  type OperationalProjection,
} from './storage';
import {
  isEmailActivityProjection,
  parseEmailActivitySummaryRequest,
  summarizeEmailActivity,
  type EmailActivityProjection,
} from './activity';

export interface TapEmailMcpRuntime {
  getExecutionContext(): MiniAppMaybePromise<MiniAppMcpExecutionContext>;
  readStorage(
    address: MiniAppStorageAddress,
  ): MiniAppMaybePromise<MiniAppStorageEntry>;
}

const defaultRuntime: TapEmailMcpRuntime = {
  getExecutionContext() {
    if (!sdk.mcp) {
      throw new Error('TAP Email MCP requires host execution context.');
    }
    return sdk.mcp.getExecutionContext();
  },
  readStorage: address => sdk.storage.get(address),
};

function parseProjection(value: MiniAppJsonValue | null): OperationalProjection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('TAP Email has not published an operational projection yet.');
  }
  const candidate = value as Readonly<Record<string, unknown>>;
  if (
    candidate.schemaVersion !== 1 ||
    !isMailboxSummary(candidate.summary) ||
    !isActiveEmailContext(candidate.activeContext)
  ) {
    throw new Error('TAP Email operational projection is malformed.');
  }
  return {
    schemaVersion: 1,
    summary: candidate.summary,
    activeContext: candidate.activeContext,
  };
}

function parseActivityProjection(
  value: MiniAppJsonValue | null,
): EmailActivityProjection {
  if (!isEmailActivityProjection(value)) {
    throw new Error('TAP Email activity projection is unavailable or malformed.');
  }
  return value;
}

export function createTapEmailMcpServer(
  runtime: TapEmailMcpRuntime = defaultRuntime,
) {
  const readStorage = async (address: MiniAppStorageAddress) => {
    const context = await runtime.getExecutionContext();
    if (!context.userId) {
      throw new Error('TAP Email MCP requires a trusted user scope.');
    }
    return (await runtime.readStorage(address)).value;
  };
  const readOperational = async () =>
    parseProjection(await readStorage(operationalAddress));
  const readActivity = async () =>
    parseActivityProjection(await readStorage(activityAddress));
  return defineMcpServer({
    tools: {
      get_mailbox_summary: {
        description:
          'Read bounded TAP Email counts and sync coverage for the current user. It never returns message bodies, subjects, addresses, or recipients.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        execute: async () =>
          (await readOperational()).summary as unknown as MiniAppJsonValue,
      },
      get_active_email_context: {
        description:
          'Read the opaque account, thread, route, and unified-versus-account context currently active in TAP Email. Use the user-initiated conversation handoff to obtain content.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        execute: async () =>
          (await readOperational()).activeContext as unknown as MiniAppJsonValue,
      },
      get_email_activity_summary: {
        description:
          'Aggregate committed user-authored TAP Email actions for one exact half-open RFC3339 range. Returns counts, failures, and coverage only—never subjects, bodies, correspondents, recipients, account IDs, thread IDs, or event timelines.',
        inputSchema: {
          type: 'object',
          properties: {
            start_at: {
              type: 'string',
              description: 'Inclusive RFC3339 timestamp with an explicit offset.',
            },
            end_at_exclusive: {
              type: 'string',
              description: 'Exclusive RFC3339 timestamp with an explicit offset.',
            },
            timezone: {
              type: 'string',
              description: 'IANA timezone used to describe the requested range.',
              minLength: 1,
              maxLength: 64,
            },
          },
          required: ['start_at', 'end_at_exclusive', 'timezone'],
          additionalProperties: false,
        },
        execute: async input =>
          summarizeEmailActivity(
            await readActivity(),
            parseEmailActivitySummaryRequest(input),
          ) as unknown as MiniAppJsonValue,
      },
    },
  });
}
