import { describe, expect, it } from '@rstest/core';
import type {
  MiniAppJsonValue,
  MiniAppStorageAddress,
} from '@theaiplatform/miniapp-sdk/sdk';
import { createTapEmailMcpServer, type TapEmailMcpRuntime } from './mcp-runtime';
import { operationalAddress } from './storage';

function runtime(value: MiniAppJsonValue | null): {
  runtime: TapEmailMcpRuntime;
  reads: MiniAppStorageAddress[];
} {
  const reads: MiniAppStorageAddress[] = [];
  return {
    reads,
    runtime: {
      getExecutionContext: () => ({ userId: 'user_1', channelId: null }),
      readStorage(address) {
        reads.push(address);
        return { value, revision: 1 };
      },
    },
  };
}

describe('TAP Email MCP', () => {
  it('exposes only privacy-minimized operational tools', async () => {
    const projection = {
      schemaVersion: 1,
      summary: {
        generatedAt: '2026-08-18T15:30:00.000Z',
        accountIds: ['google_personal'],
        inbox: 2,
        critical: 1,
        needsResponse: 1,
        waiting: 0,
        dueReminders: 0,
        failedCommands: 0,
        operationalZero: false,
        coverageComplete: true,
      },
      activeContext: {
        accountId: 'google_personal',
        threadId: 'gmail_thread_1',
        route: '/inbox/gmail_thread_1',
        view: 'account',
      },
    };
    const fixture = runtime(projection);
    const server = createTapEmailMcpServer(fixture.runtime);
    expect(Object.keys(server.tools).toSorted()).toEqual([
      'get_active_email_context',
      'get_mailbox_summary',
    ]);
    await expect(server.tools.get_mailbox_summary.execute()).resolves.toEqual(
      projection.summary,
    );
    expect(fixture.reads).toEqual([operationalAddress]);
    expect(JSON.stringify(projection)).not.toContain('bodyText');
  });

  it('fails closed without a trusted user scope', async () => {
    const fixture = runtime(null);
    fixture.runtime.getExecutionContext = () => ({ userId: null, channelId: null });
    const server = createTapEmailMcpServer(fixture.runtime);
    await expect(server.tools.get_mailbox_summary.execute()).rejects.toThrow(
      'trusted user scope',
    );
    expect(fixture.reads).toHaveLength(0);
  });
});
