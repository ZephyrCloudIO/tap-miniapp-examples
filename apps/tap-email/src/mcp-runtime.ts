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
  operationalAddress,
  type OperationalProjection,
} from './storage';

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

export function createTapEmailMcpServer(
  runtime: TapEmailMcpRuntime = defaultRuntime,
) {
  const read = async () => {
    const context = await runtime.getExecutionContext();
    if (!context.userId) {
      throw new Error('TAP Email MCP requires a trusted user scope.');
    }
    return parseProjection((await runtime.readStorage(operationalAddress)).value);
  };
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
          (await read()).summary as unknown as MiniAppJsonValue,
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
          (await read()).activeContext as unknown as MiniAppJsonValue,
      },
    },
  });
}
