import { describe, expect, it } from '@rstest/core';
import { MAXIMUM_THREAD_RESPONSE_BYTES, serializedUtf8Bytes } from '@tap-examples/tap-email-protocol';
import { createCoordinatorClient, type CoordinatorTransport } from './coordinator-client';
import type { EmailMessage } from './domain';

const message = (messageId: string, text = 'body', html = '<b>body</b>'): EmailMessage => ({
  messageId, from: { name: 'Sender', address: 'sender@example.com' }, to: [],
  sentAt: '2026-09-24T12:00:00Z', bodyText: text, bodyHtml: html, attachments: [],
});
const page = (messages: readonly EmailMessage[], nextCursor: string | null) => ({
  thread: { accountId: 'account', threadId: 'thread', providerRevision: 'h1', messages,
    pageInfo: { nextCursor, complete: nextCursor === null } },
});
function transportFor(resolve: (url: URL) => unknown): CoordinatorTransport {
  return { request(input) {
    expect(input.responseBodyLimitBytes).toBe(MAXIMUM_THREAD_RESPONSE_BYTES);
    const value = resolve(new URL(input.url));
    const bodyText = JSON.stringify(value);
    const sizeBytes = new TextEncoder().encode(bodyText).byteLength;
    return {
      finalUrl: input.url, status: 200, statusText: 'OK', headers: [], bodyText,
      bodyBase64: null, bodyKind: 'text', bodyTruncated: sizeBytes > input.responseBodyLimitBytes!,
      sizeBytes, elapsedMs: 1, contentType: 'application/json',
    };
  } };
}

describe('conversation page transport', () => {
  it('reads all three large messages through a transport enforcing the shared UTF-8 limit', async () => {
    const text = 'x'.repeat(400_000), html = 'y'.repeat(400_000);
    const messages = Array.from({ length: 3 }, (_, i) => message(`m${i}`, text, html));
    const requests: string[] = [];
    const client = createCoordinatorClient(transportFor(url => {
      requests.push(url.search);
      return url.searchParams.has('cursor') ? page([messages[0]!], null) : page(messages.slice(1), 'older + page');
    }));
    expect(await client.getThread('account', 'thread')).toEqual(messages);
    expect(requests).toEqual(['', '?cursor=older%20%2B%20page']);
  });

  it('accepts a schema-valid heavily escaped single message and rejects oversized wire pages', async () => {
    const escaped = message('escaped', '\u0000'.repeat(500_000), '\u0001'.repeat(500_000));
    expect(serializedUtf8Bytes(page([escaped], null))).toBeGreaterThan(2_097_152);
    expect((await createCoordinatorClient(transportFor(() => page([escaped], null)))
      .getThreadPage('account', 'thread')).messages).toEqual([escaped]);
    await expect(createCoordinatorClient(transportFor(() => page([
      escaped, { ...escaped, messageId: 'second' },
    ], null))).getThreadPage('account', 'thread')).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('deduplicates overlapping pages without dropping older identities', async () => {
    const older = message('older'), latest = message('latest');
    const client = createCoordinatorClient(transportFor(url => url.search
      ? page([older, latest], null) : page([latest], 'next')));
    expect(await client.getThread('account', 'thread')).toEqual([older, latest]);
  });

  it.each(['accountId', 'threadId', 'complete', 'cursor', 'duplicate', 'unpaged'])('rejects malformed %s pagination', async kind => {
    const response = page([message('latest')], null);
    if (kind === 'accountId') response.thread.accountId = 'other';
    if (kind === 'threadId') response.thread.threadId = 'other';
    if (kind === 'complete') response.thread.pageInfo.complete = false;
    if (kind === 'cursor') response.thread.pageInfo.nextCursor = '';
    if (kind === 'duplicate') response.thread.messages = [message('latest'), message('latest')];
    const value = kind === 'unpaged' ? { thread: { ...response.thread, pageInfo: undefined } } : response;
    await expect(createCoordinatorClient(transportFor(() => value)).getThreadPage('account', 'thread'))
      .rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('rejects a cursor cycle and a provider revision change', async () => {
    for (const changedRevision of [false, true]) {
      let requests = 0;
      const client = createCoordinatorClient(transportFor(() => {
        requests += 1;
        const result = page([message(`m${requests}`)], changedRevision && requests > 1 ? 'two' : 'one');
        if (changedRevision && requests > 1) result.thread.providerRevision = 'h2';
        return result;
      }));
      await expect(client.getThread('account', 'thread')).rejects.toBeDefined();
      expect(requests).toBe(2);
    }
  });
});
