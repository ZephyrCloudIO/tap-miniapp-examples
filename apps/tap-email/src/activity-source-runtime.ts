import { defineActivitySource } from '@theaiplatform/miniapp-sdk/activity';
import type { MiniAppStorageApi } from '@theaiplatform/miniapp-sdk/sdk';
import { emailActivityActions, isEmailActivityProjection, summarizeEmailActivity } from './activity';
import { activityAddress } from './storage';

export const TAP_EMAIL_ACTIVITY_SOURCE_ID = 'tap-email-committed-actions';
const outcomes = ['applied', 'failed', 'uncertain', 'cancelled'] as const;

export function createEmailActivitySource(storage: Pick<MiniAppStorageApi, 'get'>) {
  return defineActivitySource({
    async get(request) {
      if (request.scope !== 'self' || request.sourceId !== TAP_EMAIL_ACTIVITY_SOURCE_ID ||
        !request.userId || !request.workspaceId) {
        throw new Error('Email activity requires trusted self scope.');
      }
      const start = Date.parse(request.startAt);
      const end = Date.parse(request.endAtExclusive);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 15 * 60_000) {
        throw new Error('Email activity requires a range of at least 15 minutes.');
      }
      const entry = await storage.get(activityAddress(request.userId));
      if (!isEmailActivityProjection(entry.value) || entry.value.coverage.source === 'unavailable') {
        throw new Error('Email activity projection is unavailable or malformed.');
      }
      const summary = summarizeEmailActivity(entry.value, {
        startAt: request.startAt, endAtExclusive: request.endAtExclusive, timeZone: 'UTC',
      });
      return {
        coverage: summary.coverage.complete ? 'complete' as const : 'partial' as const,
        activities: emailActivityActions.flatMap(action => outcomes.map(statusId => ({
          activityId: action.replaceAll('_', '-'), statusId,
          value: summary.counts.byAction[action][statusId], unit: 'count' as const,
        }))),
      };
    },
  });
}
