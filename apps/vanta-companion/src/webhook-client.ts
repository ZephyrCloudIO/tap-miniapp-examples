export interface WebhookEventInput {
  readonly id: string;
  readonly eventType: string;
  readonly occurredAt: string | null;
  readonly receivedAt: string;
}

export interface WebhookEventPage {
  readonly workspaceId: string;
  readonly events: readonly WebhookEventInput[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

const clean = (value: string): string => value.trim();

export function normalizeWebhookApiUrl(value: string): string {
  const input = clean(value);
  if (!input) throw new Error('Webhook API URL is required.');
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('Enter a valid webhook API URL.');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) {
    throw new Error('Webhook API must use HTTPS outside local development.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Use the API origin without credentials, query, or fragment.');
  }
  return url.origin;
}

function parseEvent(value: unknown): WebhookEventInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Webhook API returned an invalid event.');
  }
  const item = value as Readonly<Record<string, unknown>>;
  if (
    typeof item.id !== 'string' ||
    !clean(item.id) ||
    typeof item.eventType !== 'string' ||
    !clean(item.eventType) ||
    typeof item.receivedAt !== 'string' ||
    !Number.isFinite(Date.parse(item.receivedAt)) ||
    (item.occurredAt !== null &&
      (typeof item.occurredAt !== 'string' ||
        !Number.isFinite(Date.parse(item.occurredAt))))
  ) {
    throw new Error('Webhook API returned an invalid event.');
  }
  return {
    id: clean(item.id),
    eventType: clean(item.eventType),
    occurredAt: item.occurredAt,
    receivedAt: new Date(item.receivedAt).toISOString(),
  };
}

export function parseWebhookEventPage(
  value: unknown,
  expectedWorkspaceId: string,
): WebhookEventPage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Webhook API returned an invalid response.');
  }
  const item = value as Readonly<Record<string, unknown>>;
  if (item.workspaceId !== expectedWorkspaceId) {
    throw new Error(
      'Webhook API workspace does not match this TAP workspace. Update the Worker configuration before syncing.',
    );
  }
  if (
    !Array.isArray(item.events) ||
    (item.nextCursor !== null && typeof item.nextCursor !== 'string') ||
    typeof item.hasMore !== 'boolean'
  ) {
    throw new Error('Webhook API returned an invalid response.');
  }
  const events = item.events.map(parseEvent);
  if (new Set(events.map(event => event.id)).size !== events.length) {
    throw new Error('Webhook API returned duplicate event IDs in one page.');
  }
  return {
    workspaceId: expectedWorkspaceId,
    events,
    nextCursor: item.nextCursor,
    hasMore: item.hasMore,
  };
}

export async function fetchWebhookEvents(input: {
  readonly apiUrl: string;
  readonly workspaceId: string;
  readonly cursor: string | null;
}): Promise<WebhookEventPage> {
  const baseUrl = normalizeWebhookApiUrl(input.apiUrl);
  const url = new URL('/v1/events', baseUrl);
  url.searchParams.set('limit', '100');
  if (input.cursor) url.searchParams.set('cursor', input.cursor);
  let response: Response;
  try {
    response = await fetch(url, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
  } catch {
    throw new Error(
      'Could not reach the webhook API. Check the URL, Access session, and allowed origins.',
    );
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(
      `Webhook API returned an unreadable response (${response.status}).`,
    );
  }
  if (!response.ok) {
    const message =
      payload &&
      typeof payload === 'object' &&
      !Array.isArray(payload) &&
      typeof (payload as Readonly<Record<string, unknown>>).message === 'string'
        ? (payload as Readonly<Record<string, string>>).message
        : `Webhook API request failed (${response.status}).`;
    throw new Error(message);
  }
  return parseWebhookEventPage(payload, input.workspaceId);
}
