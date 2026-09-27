import { describe, expect, it, rs } from '@rstest/core';
import type { ActivitySourceRequest } from '@theaiplatform/miniapp-sdk/activity';
import type { MiniAppJsonValue } from '@theaiplatform/miniapp-sdk/sdk';
import { createEmailActivitySource, TAP_EMAIL_ACTIVITY_SOURCE_ID } from './activity-source-runtime';
import { emailActivityActions } from './activity';
import { activityAddress } from './storage';

const projection: MiniAppJsonValue = {
  schemaVersion: 1, generatedAt: '2026-09-14T00:00:00.000Z',
  entries: [
    { action: 'reply_sent', outcome: 'applied', occurredAt: '2026-09-13T14:00:00.000Z', timeSource: 'provider_acknowledged_at' },
    { action: 'thread_archived', outcome: 'failed', occurredAt: '2026-09-13T15:00:00.000Z', timeSource: 'coordinator_accepted_at' },
    { action: 'thread_viewed', outcome: 'applied', occurredAt: '2026-09-14T00:00:00.000Z', timeSource: 'ui_observed_at' },
  ],
  coverage: { scope: 'installation', source: 'private-profile-sqlite', trackingStartedAt: '2026-09-01T00:00:00.000Z', retainedAfter: '2026-09-01T00:00:00.000Z', availableFrom: '2026-09-01T00:00:00.000Z', truncated: false, warnings: [] },
};
const request: ActivitySourceRequest = {
  userId: 'user_1', workspaceId: 'workspace_1', scope: 'self',
  sourceId: TAP_EMAIL_ACTIVITY_SOURCE_ID, packageId: 'package_1', installationId: 'install_1', releaseId: 'release_1', consumerSpecialistId: 'chloe',
  startAt: '2026-09-13T00:00:00.000Z', endAtExclusive: '2026-09-14T00:00:00.000Z',
};
const fixture = (value: MiniAppJsonValue | null = projection) => {
  const get = rs.fn(async () => ({ value, revision: 1 }));
  return { get, source: createEmailActivitySource({ get }) };
};

describe('registered email activity source', () => {
  it('returns every declared count/status including zeros and respects the exclusive end', async () => {
    const { get, source } = fixture();
    const result = await source.get(request);
    expect(get).toHaveBeenCalledWith(activityAddress('user_1'));
    expect(result.coverage).toBe('complete');
    expect(result.activities).toHaveLength(emailActivityActions.length * 4);
    expect(result.activities.find(a => a.activityId === 'reply-sent' && a.statusId === 'applied')?.value).toBe(1);
    expect(result.activities.find(a => a.activityId === 'thread-archived' && a.statusId === 'failed')?.value).toBe(1);
    expect(result.activities.find(a => a.activityId === 'thread-viewed' && a.statusId === 'applied')?.value).toBe(0);
    expect(Object.keys(result).sort()).toEqual(['activities', 'coverage']);
    for (const aggregate of result.activities) expect(Object.keys(aggregate).sort()).toEqual(['activityId', 'statusId', 'unit', 'value']);
  });
  it('uses the host user key and refuses workspace totals or invalid ranges before reads', async () => {
    const { source, get } = fixture();
    await source.get({ ...request, userId: 'user_2' });
    expect(get).toHaveBeenCalledWith(activityAddress('user_2'));
    get.mockClear();
    for (const changed of [{ scope: 'workspace' as const }, { userId: '' }, { sourceId: 'other' }, { startAt: 'invalid' }, { endAtExclusive: request.startAt }]) {
      await expect(source.get({ ...request, ...changed })).rejects.toThrow();
    }
    expect(get).not.toHaveBeenCalled();
  });
  it('marks the range partial when coordinator reconciliation has not reached its end', async () => {
    const bounded = { ...projection as Record<string, MiniAppJsonValue>, coverage: {
      ...((projection as Record<string, MiniAppJsonValue>).coverage as Record<string, MiniAppJsonValue>),
      availableThrough: '2026-09-13T12:00:00.000Z',
    } };
    expect((await fixture(bounded).source.get(request)).coverage).toBe('partial');
  });
  it('keeps absent or unavailable history distinct from a complete zero', async () => {
    await expect(fixture(null).source.get(request)).rejects.toThrow('unavailable');
    const result = await fixture().source.get({ ...request, startAt: '2026-08-01T00:00:00Z' });
    expect(result.coverage).toBe('partial');
    await expect(fixture({ ...projection as object, subject: 'must not escape' }).source.get(request)).rejects.toThrow('malformed');
  });
});
