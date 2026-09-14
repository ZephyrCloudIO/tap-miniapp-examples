import { describe, expect, it, rs } from '@rstest/core';
import type { MiniAppJsonValue } from '@theaiplatform/miniapp-sdk/sdk';
import {
  createEmailActivitySourceRuntime,
  TAP_EMAIL_ACTIVITY_SOURCE_ID,
  type ReadOnlyEmailActivitySourceStorage,
} from './activity-source';
import { activityAddress } from './storage';

const projection: MiniAppJsonValue = {
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

const trustedContext = Object.freeze({
  userId: 'user_1',
  workspaceId: 'workspace_1',
  sourceId: TAP_EMAIL_ACTIVITY_SOURCE_ID,
});

const request = {
  startAt: '2026-09-13T00:00:00.000Z',
  endAtExclusive: '2026-09-14T00:00:00.000Z',
  timeZone: 'UTC',
} as const;

function storageFixture(
  value: MiniAppJsonValue | null = projection,
  revision: number | null = 42,
) {
  const reads: Array<Readonly<{ namespace: string; key: string }>> = [];
  const read = rs.fn(async (address: Readonly<{
    namespace: string;
    key: string;
  }>) => {
    expect(Object.isFrozen(address)).toBe(true);
    reads.push(address);
    return { value, revision };
  });
  return {
    reads,
    read,
    storage: { read } as ReadOnlyEmailActivitySourceStorage,
  };
}

describe('future host-governed email activity source', () => {
  it('returns a content-free exact-range summary with source provenance', async () => {
    const fixture = storageFixture();
    const runtime = createEmailActivitySourceRuntime(fixture.storage);

    const result = await runtime.execute(trustedContext, request);

    expect(Object.isFrozen(runtime)).toBe(true);
    expect(result).toEqual(expect.objectContaining({
      sourceId: TAP_EMAIL_ACTIVITY_SOURCE_ID,
      sourceRevision: '42',
      summary: expect.objectContaining({
        kind: 'email-activity-summary',
        counts: expect.objectContaining({ total: 2, applied: 1 }),
        failures: { total: 1, failed: 1, uncertain: 0, cancelled: 0 },
        coverage: expect.objectContaining({
          complete: true,
          scope: 'installation',
        }),
      }),
    }));
    expect(Object.keys(result).toSorted()).toEqual([
      'sourceId',
      'sourceRevision',
      'summary',
    ]);
    expect(fixture.reads).toEqual([activityAddress]);
    const serialized = JSON.stringify(result);
    for (const forbidden of [
      'occurredAt',
      'user_1',
      'workspace_1',
      'subject',
      'bodyText',
      'recipient',
      'threadId',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('rejects missing, mutable, substituted, or extended host scope before reading', async () => {
    const invalidContexts: unknown[] = [
      null,
      {
        userId: 'user_1',
        workspaceId: 'workspace_1',
        sourceId: TAP_EMAIL_ACTIVITY_SOURCE_ID,
      },
      Object.freeze({
        userId: '',
        workspaceId: 'workspace_1',
        sourceId: TAP_EMAIL_ACTIVITY_SOURCE_ID,
      }),
      Object.freeze({
        userId: 'user_1',
        sourceId: TAP_EMAIL_ACTIVITY_SOURCE_ID,
      }),
      Object.freeze({
        userId: 'user_1',
        workspaceId: 'workspace_1',
        sourceId: 'another-source',
      }),
      Object.freeze({
        ...trustedContext,
        callerSelectedAccountId: 'account_private',
      }),
    ];

    for (const context of invalidContexts) {
      const fixture = storageFixture();
      const runtime = createEmailActivitySourceRuntime(fixture.storage);
      await expect(runtime.execute(context, request)).rejects.toThrow(
        'immutable trusted user, workspace, and source scope',
      );
      expect(fixture.read).not.toHaveBeenCalled();
    }
  });

  it('accepts only the exact host range shape before reading', async () => {
    const invalidRequests: unknown[] = [
      null,
      { ...request, userId: 'substitute_user' },
      {
        start_at: request.startAt,
        end_at_exclusive: request.endAtExclusive,
        timezone: request.timeZone,
      },
      {
        startAt: request.startAt,
        endAtExclusive: request.endAtExclusive,
      },
      { ...request, startAt: 'yesterday' },
      { ...request, endAtExclusive: request.startAt },
      { ...request, timeZone: 'Mars/Olympus_Mons' },
    ];

    for (const invalidRequest of invalidRequests) {
      const fixture = storageFixture();
      const runtime = createEmailActivitySourceRuntime(fixture.storage);
      await expect(runtime.execute(trustedContext, invalidRequest)).rejects.toThrow();
      expect(fixture.read).not.toHaveBeenCalled();
    }
  });

  it('rejects malformed projections and missing source revisions', async () => {
    const malformedProjection = {
      ...(projection as Record<string, MiniAppJsonValue>),
      subject: 'Private subject must never cross the source boundary',
    };
    const malformed = storageFixture(malformedProjection, 42);
    await expect(
      createEmailActivitySourceRuntime(malformed.storage).execute(
        trustedContext,
        request,
      ),
    ).rejects.toThrow('projection is unavailable or malformed');
    expect(malformed.read).toHaveBeenCalledTimes(1);

    const missingRevision = storageFixture(projection, null);
    await expect(
      createEmailActivitySourceRuntime(missingRevision.storage).execute(
        trustedContext,
        request,
      ),
    ).rejects.toThrow('trusted source revision');
    expect(missingRevision.read).toHaveBeenCalledTimes(1);
  });
});
