import { describe, expect, it } from '@rstest/core';
import type { MiniAppHttpResponse } from '@theaiplatform/miniapp-sdk/sdk';
import { CALENDAR_BOOKING_LINKS_URL, createBookingLinksClient, type PublishedBookingLink } from './booking-links';

const context = { userId: 'tap-user', workspaceId: 'tap-workspace' };
const link: PublishedBookingLink = {
  profileId: 'profile', eventTypeId: 'event', title: 'A meeting', durationMinutes: 30,
  url: 'https://cal.with-tap.ai/confirmed/meeting', revisionId: 'revision', generation: 1,
};
const response = (body: unknown, overrides: Partial<MiniAppHttpResponse> = {}): MiniAppHttpResponse => ({
  status: 200, statusText: 'OK', finalUrl: CALENDAR_BOOKING_LINKS_URL, headers: [],
  bodyKind: 'text', bodyText: JSON.stringify(body), bodyBase64: null, bodyTruncated: false,
  sizeBytes: 500, elapsedMs: 1, contentType: 'application/json', ...overrides,
});
const envelope = (body: Record<string, unknown>) => ({ schemaVersion: 'tap.calendar.booking-links.v1', ...context, ...body });

describe('Calendar booking link client', () => {
  it('defers host access until an authorized user request', async () => {
    let checks = 0;
    const client = createBookingLinksClient({ context, authorize: async () => { checks += 1; return false; } });
    expect(checks).toBe(0);
    await expect(client.list()).rejects.toMatchObject({ code: 'denied' });
    expect(checks).toBe(1);
  });

  it('uses only governed GETs, exact Calendar origin and context-bound platform credentials', async () => {
    const actions: string[] = [];
    let calls = 0;
    const client = createBookingLinksClient({
      context,
      authorize: async action => { actions.push(action); return true; },
      transport: { request(input, options) {
        calls += 1;
        expect(input).toMatchObject({
          method: 'GET', url: CALENDAR_BOOKING_LINKS_URL, followRedirects: false,
          headers: [{ name: 'X-TAP-Workspace-Id', value: context.workspaceId }],
        });
        expect(input.body).toBeUndefined();
        expect(options).toEqual({ credentialRef: 'platform-session', expectedContext: context });
        if (calls === 1) return response(envelope({ links: [link] }));
        expect(input.query).toEqual([
          { name: 'profileId', value: 'profile' }, { name: 'eventTypeId', value: 'event' },
          { name: 'revisionId', value: 'revision' }, { name: 'generation', value: '1' },
        ]);
        return response(envelope({ link }));
      } },
    });
    expect(await client.list()).toEqual([link]);
    expect(await client.resolve(link)).toEqual(link);
    expect(calls).toBe(2);
    expect(actions).toEqual(['network.request', 'credentials.use', 'network.request', 'credentials.use']);
  });

  it.each(['network.request', 'credentials.use'])('never requests data when %s is denied', async denied => {
    let requests = 0;
    const client = createBookingLinksClient({ context, authorize: async action => action !== denied,
      transport: { request() { requests += 1; throw new Error('must not request'); } },
    });
    await expect(client.list()).rejects.toMatchObject({ code: 'denied' });
    expect(requests).toBe(0);
  });

  it.each([
    [401, 'denied'], [403, 'denied'], [404, 'unavailable'], [503, 'unavailable'], [409, 'stale'],
  ])('handles HTTP %s as %s', async (status, code) => {
    const client = createBookingLinksClient({ context, authorize: async () => true,
      transport: { request: () => response({}, { status: Number(status) }) },
    });
    await expect(client.resolve(link)).rejects.toMatchObject({ code });
  });

  it.each([
    envelope({ links: [link], userId: 'another-user' }),
    envelope({ links: [link], workspaceId: 'another-workspace' }),
    envelope({ links: [link], schemaVersion: 'unknown' }),
    envelope({ links: [{ ...link, url: 'javascript:alert(1)' }] }),
    envelope({ links: [{ ...link, url: 'https://user:password@example.com/link' }] }),
    envelope({ links: [{ ...link, durationMinutes: 0 }] }),
    envelope({ links: [{ ...link, generation: 1.5 }] }),
    envelope({ links: [{}] }),
  ])('fails closed for wrong identity or malformed publication metadata %#', async body => {
    const client = createBookingLinksClient({ context, authorize: async () => true,
      transport: { request: () => response(body) },
    });
    await expect(client.list()).rejects.toMatchObject({ code: 'unavailable' });
  });

  it.each([
    { bodyTruncated: true }, { bodyText: 'not-json' }, { finalUrl: 'https://untrusted.example/v1/booking-links' },
  ])('rejects incomplete or redirected responses %#', async overrides => {
    const client = createBookingLinksClient({ context, authorize: async () => true,
      transport: { request: () => response(envelope({ links: [link] }), overrides) },
    });
    await expect(client.list()).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('distinguishes a successful empty list from transport unavailability', async () => {
    const client = createBookingLinksClient({ context, authorize: async () => true,
      transport: { request: () => response(envelope({ links: [] })) },
    });
    expect(await client.list()).toEqual([]);
    const offline = createBookingLinksClient({ context, authorize: async () => true,
      transport: { request: () => { throw new Error('offline'); } },
    });
    await expect(offline.list()).rejects.toMatchObject({ code: 'unavailable' });
  });

  it.each(['url', 'generation', 'revisionId', 'profileId', 'eventTypeId'])('rejects a changed selection %s', async field => {
    const client = createBookingLinksClient({ context, authorize: async () => true,
      transport: { request: () => response(envelope({ link: {
        ...link, [field]: field === 'url' ? 'https://cal.with-tap.ai/new/url' : field === 'generation' ? 2 : 'changed',
      } })) },
    });
    await expect(client.resolve(link)).rejects.toMatchObject({ code: 'stale' });
  });
});
