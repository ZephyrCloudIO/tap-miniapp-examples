import { describe, expect, it } from '@rstest/core';
import type { MiniAppJsonValue, MiniAppStorageApi } from '@theaiplatform/miniapp-sdk/sdk';
import type { EmailActivityProjection } from './activity';
import { activityAddress, publishEmailActivityProjection } from './storage';

function projection(generatedAt: string): EmailActivityProjection {
  return {
    schemaVersion: 1,
    generatedAt,
    entries: [],
    coverage: {
      scope: 'installation',
      source: 'private-profile-sqlite',
      trackingStartedAt: '2026-09-14T00:00:00.000Z',
      retainedAfter: '2026-09-14T00:00:00.000Z',
      availableFrom: '2026-09-14T00:00:00.000Z',
      truncated: false,
      warnings: [],
    },
  };
}

describe('email activity projection publication', () => {
  it('re-reads and retries after an optimistic-concurrency race', async () => {
    let revision = 1;
    let value: MiniAppJsonValue | null = projection('2026-09-14T00:00:00.000Z') as unknown as MiniAppJsonValue;
    let sets = 0;
    const storage: Pick<MiniAppStorageApi, 'get' | 'set'> = {
      get: async address => {
        expect(address).toEqual(activityAddress('user_1'));
        return { revision, value };
      },
      set: async options => {
        sets += 1;
        if (sets === 1) {
          revision = 2;
          throw new Error('storage revision conflict');
        }
        expect(options.expectedRevision).toBe(2);
        revision = 3;
        value = options.value;
        return { revision };
      },
    };

    await publishEmailActivityProjection(
      projection('2026-09-14T01:00:00.000Z'),
      'user_1',
      storage,
    );

    expect(sets).toBe(2);
    expect((value as { generatedAt?: unknown }).generatedAt).toBe(
      '2026-09-14T01:00:00.000Z',
    );
  });

  it('does not overwrite a projection published by a newer surface', async () => {
    let sets = 0;
    const storage: Pick<MiniAppStorageApi, 'get' | 'set'> = {
      get: async () => ({
        revision: 4,
        value: projection('2026-09-14T02:00:00.000Z') as unknown as MiniAppJsonValue,
      }),
      set: async () => {
        sets += 1;
        return { revision: 5 };
      },
    };

    await publishEmailActivityProjection(
      projection('2026-09-14T01:00:00.000Z'),
      'user_1',
      storage,
    );

    expect(sets).toBe(0);
  });

  it('publishes different ledger states generated within the same millisecond', async () => {
    const generatedAt = '2026-09-14T02:00:00.000Z';
    let revision = 4;
    let value = projection(generatedAt) as unknown as MiniAppJsonValue;
    let sets = 0;
    const next = {
      ...projection(generatedAt),
      entries: [{
        action: 'reply_sent' as const,
        outcome: 'applied' as const,
        occurredAt: '2026-09-14T01:59:59.999Z',
        timeSource: 'provider_acknowledged_at' as const,
      }],
    };
    const storage: Pick<MiniAppStorageApi, 'get' | 'set'> = {
      get: async () => ({ revision, value }),
      set: async options => {
        sets += 1;
        revision += 1;
        value = options.value;
        return { revision };
      },
    };

    await publishEmailActivityProjection(next, 'user_1', storage);

    expect(sets).toBe(1);
    expect((value as { entries?: readonly unknown[] }).entries).toHaveLength(1);
  });
});
