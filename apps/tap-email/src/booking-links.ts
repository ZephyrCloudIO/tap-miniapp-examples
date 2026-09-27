import { sdk, type MiniAppHttpExpectedContext } from '@theaiplatform/miniapp-sdk/sdk';
import type { CoordinatorTransport } from './coordinator-client';

export const CALENDAR_BOOKING_LINKS_URL = 'https://calendar-api.theaiplatform.app/v1/booking-links';

export interface PublishedBookingLink {
  readonly profileId: string;
  readonly eventTypeId: string;
  readonly title: string;
  readonly durationMinutes: number;
  readonly url: string;
  readonly revisionId: string;
  readonly generation: number;
}

export interface BookingLinksClient {
  readonly scopeKey: string;
  list(): Promise<readonly PublishedBookingLink[]>;
  resolve(selection: PublishedBookingLink): Promise<PublishedBookingLink>;
}

export class BookingLinksError extends Error {
  constructor(readonly code: 'denied' | 'unavailable' | 'stale') {
    super(code === 'denied'
      ? 'Allow Calendar link access in TAP, then try again.'
      : code === 'stale'
        ? 'This booking page changed or is no longer published. Refresh the list and choose again.'
        : 'Calendar booking links are unavailable. Try again later.');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isLink(value: unknown): value is PublishedBookingLink {
  if (!isRecord(value)) return false;
  if (!['profileId', 'eventTypeId', 'revisionId', 'title'].every(key =>
    typeof value[key] === 'string' && value[key].trim().length > 0 && value[key].length <= 255)) return false;
  if (!Number.isSafeInteger(value.durationMinutes) || Number(value.durationMinutes) <= 0 ||
    !Number.isSafeInteger(value.generation) || Number(value.generation) <= 0 ||
    typeof value.url !== 'string' || value.url.length > 2048) return false;
  try {
    const url = new URL(value.url);
    return url.protocol === 'https:' && !url.username && !url.password &&
      url.href === value.url && !url.hash;
  } catch { return false; }
}

/** Uses the supported SDK HTTP bridge; no Calendar MCP or private storage access. */
export function createBookingLinksClient(options: {
  readonly context: MiniAppHttpExpectedContext;
  readonly authorize: (actionId: string) => Promise<boolean>;
  readonly transport?: CoordinatorTransport;
}): BookingLinksClient {
  const context = { ...options.context };
  const unavailable = () => new BookingLinksError('unavailable');
  async function request(selection?: PublishedBookingLink): Promise<Record<string, unknown>> {
    try {
      if (!context.userId || !context.workspaceId) throw unavailable();
      for (const action of ['network.request', 'credentials.use']) {
        if (!await options.authorize(action)) throw new BookingLinksError('denied');
      }
      const transport = options.transport ?? sdk.http;
      if (!transport) throw unavailable();
      const response = await transport.request({
        method: 'GET',
        url: CALENDAR_BOOKING_LINKS_URL,
        ...(selection ? { query: [
          { name: 'profileId', value: selection.profileId },
          { name: 'eventTypeId', value: selection.eventTypeId },
          { name: 'revisionId', value: selection.revisionId },
          { name: 'generation', value: String(selection.generation) },
        ] } : {}),
        headers: [{ name: 'X-TAP-Workspace-Id', value: context.workspaceId }],
        followRedirects: false,
        timeoutMs: 15_000,
        responseBodyLimitBytes: 2_097_152,
      }, { credentialRef: 'platform-session', expectedContext: context });
      if (response.status === 401 || response.status === 403) throw new BookingLinksError('denied');
      if (response.status === 409) throw new BookingLinksError('stale');
      if (response.status !== 200 || response.bodyTruncated || response.bodyKind !== 'text' || !response.bodyText) throw unavailable();
      const finalUrl = new URL(response.finalUrl);
      if (`${finalUrl.origin}${finalUrl.pathname}` !== CALENDAR_BOOKING_LINKS_URL) throw unavailable();
      const body: unknown = JSON.parse(response.bodyText);
      if (!isRecord(body) || body.schemaVersion !== 'tap.calendar.booking-links.v1' ||
        body.userId !== context.userId || body.workspaceId !== context.workspaceId) throw unavailable();
      return body;
    } catch (error) {
      throw error instanceof BookingLinksError ? error : unavailable();
    }
  }
  return {
    scopeKey: JSON.stringify([context.userId, context.workspaceId]),
    async list() {
      const body = await request();
      if (!Array.isArray(body.links) || body.links.length > 1000 || !body.links.every(isLink)) throw unavailable();
      return body.links;
    },
    async resolve(selection) {
      const body = await request(selection);
      if (!isLink(body.link)) throw unavailable();
      const link = body.link;
      if (link.profileId !== selection.profileId || link.eventTypeId !== selection.eventTypeId ||
        link.revisionId !== selection.revisionId || link.generation !== selection.generation ||
        link.url !== selection.url) throw new BookingLinksError('stale');
      return link;
    },
  };
}
