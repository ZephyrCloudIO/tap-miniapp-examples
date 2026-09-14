import { describe, expect, it } from '@rstest/core';
import type {
  MiniAppJsonValue,
  MiniAppStorageAddress,
} from '@theaiplatform/miniapp-sdk/sdk';
import { createTapEmailMcpServer, type TapEmailMcpRuntime } from './mcp-runtime';
import { activityAddress, operationalAddress } from './storage';

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
      'get_email_activity_summary',
      'get_mailbox_summary',
    ]);
    await expect(server.tools.get_mailbox_summary.execute()).resolves.toEqual(
      projection.summary,
    );
    expect(fixture.reads).toEqual([operationalAddress]);
    expect(JSON.stringify(projection)).not.toContain('bodyText');
  });

  it('returns a bounded aggregate rather than an action timeline', async () => {
    const projection = {
      schemaVersion: 1,
      generatedAt: '2026-09-14T00:00:00.000Z',
      entries: [
        {
          action: 'reply_sent',
          outcome: 'applied',
          occurredAt: '2026-09-13T14:00:00.000Z',
          timeSource: 'provider_acknowledged_at',
        },
        {
          action: 'thread_archived',
          outcome: 'failed',
          occurredAt: '2026-09-13T15:00:00.000Z',
          timeSource: 'coordinator_accepted_at',
        },
      ],
      coverage: {
        scope: 'installation',
        source: 'private-profile-sqlite',
        trackingStartedAt: '2026-09-01T00:00:00.000Z',
        retainedAfter: '2026-09-01T00:00:00.000Z',
        availableFrom: '2026-09-01T00:00:00.000Z',
        truncated: false,
        warnings: [],
      },
    };
    const fixture = runtime(projection);
    const server = createTapEmailMcpServer(fixture.runtime);

    const result = await server.tools.get_email_activity_summary.execute({
      start_at: '2026-09-13T00:00:00.000Z',
      end_at_exclusive: '2026-09-14T00:00:00.000Z',
      timezone: 'UTC',
    });

    expect(result).toEqual(expect.objectContaining({
      kind: 'email-activity-summary',
      counts: expect.objectContaining({ total: 2, applied: 1 }),
      failures: { total: 1, failed: 1, uncertain: 0, cancelled: 0 },
      coverage: expect.objectContaining({ complete: true, scope: 'installation' }),
    }));
    expect(fixture.reads).toEqual([activityAddress]);
    expect(JSON.stringify(result)).not.toContain('occurredAt');
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
