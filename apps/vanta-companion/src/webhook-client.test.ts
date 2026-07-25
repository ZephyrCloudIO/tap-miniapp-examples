import { describe, expect, it } from '@rstest/core';
import {
  fetchWebhookEvents,
  normalizeWebhookApiUrl,
  parseWebhookEventPage,
} from './webhook-client';

describe('webhook client boundary', () => {
  it('accepts HTTPS origins and explicit local development HTTP only', () => {
    expect(normalizeWebhookApiUrl('https://api.example.com/path')).toBe(
      'https://api.example.com',
    );
    expect(normalizeWebhookApiUrl('http://127.0.0.1:8787')).toBe(
      'http://127.0.0.1:8787',
    );
    expect(() => normalizeWebhookApiUrl('http://api.example.com')).toThrow(
      'HTTPS',
    );
  });

  it('rejects workspace confusion and duplicate page IDs', () => {
    const page = {
      workspaceId: 'workspace-1',
      events: [
        {
          id: 'msg-1',
          eventType: 'control.updated',
          occurredAt: null,
          receivedAt: '2026-07-17T12:00:00.000Z',
        },
      ],
      nextCursor: 'cursor-1',
      hasMore: false,
    };
    expect(() => parseWebhookEventPage(page, 'workspace-2')).toThrow(
      'does not match',
    );
    expect(() =>
      parseWebhookEventPage(
        { ...page, events: [page.events[0], page.events[0]] },
        'workspace-1',
      ),
    ).toThrow('duplicate');
  });

  it('requests the bounded event feed with Access cookies and a cursor', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const page = await fetchWebhookEvents({
      apiUrl: 'https://events.example.com',
      workspaceId: 'workspace-1',
      cursor: 'cursor-1',
      fetchImpl: async (input, init) => {
        requests.push({ url: String(input), init });
        return Response.json({
          workspaceId: 'workspace-1',
          events: [],
          nextCursor: 'cursor-2',
          hasMore: false,
        });
      },
    });

    expect(requests).toEqual([
      {
        url: 'https://events.example.com/v1/events?limit=100&cursor=cursor-1',
        init: {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        },
      },
    ]);
    expect(page).toMatchObject({
      workspaceId: 'workspace-1',
      nextCursor: 'cursor-2',
      hasMore: false,
    });
  });
});
