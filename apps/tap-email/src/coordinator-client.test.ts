import { describe, expect, it } from '@rstest/core';
import type { MiniAppHttpRequestInput } from '@theaiplatform/miniapp-sdk/sdk';
import { TAP_EMAIL_PROTOCOL_VERSION } from '@tap-examples/tap-email-protocol';
import {
  CoordinatorError,
  coordinatorOrigin,
  createCoordinatorClient,
  type CoordinatorTransport,
} from './coordinator-client';

function mailboxThread(
  threadId: string,
  receivedAt = '2026-09-13T14:00:00.000Z',
) {
  return {
    threadId,
    accountId: 'acct_1',
    providerRevision: `history_${threadId}`,
    subject: `Subject ${threadId}`,
    participants: [],
    snippet: `Preview ${threadId}`,
    receivedAt,
    unread: false,
    starred: false,
    critical: false,
    needsResponse: false,
    waitingOnOthers: false,
    status: 'inbox',
    labels: ['INBOX'],
    messages: [],
    reminder: null,
  };
}

describe('TAP Email coordinator client', () => {
  it('pins credential creation to the verified sending context in both body and host request', async () => {
    const sender = { userId: 'user_1', workspaceId: 'workspace_1' };
    let calls = 0;
    const transport: CoordinatorTransport = {
      request(input, options) {
        calls += 1;
        expect(input.url).toBe(`${coordinatorOrigin}/v1/mcp/credential`);
        expect(JSON.parse(input.body as string)).toEqual({ allowWrites: true, expectedContext: sender });
        expect(options).toEqual({ credentialRef: 'platform-session', expectedContext: sender });
        return {
          finalUrl: input.url, status: 201, statusText: 'Created', headers: [],
          bodyText: JSON.stringify({ token: `temcp_${'a'.repeat(64)}`, scopes: ['email.metadata.read', 'email.content.read', 'email.write'], expiresAt: '2026-10-24T00:00:00.000Z' }),
          bodyBase64: null, bodyKind: 'text', bodyTruncated: false,
          sizeBytes: 512, elapsedMs: 1, contentType: 'application/json',
        };
      },
    };
    expect((await createCoordinatorClient(transport).createEmailToolAccess(true, sender)).connected).toBe(true);
    expect(calls).toBe(1);
  });

  it('loads every cursor-paginated mailbox page before replacing the local snapshot', async () => {
    const urls: string[] = [];
    const transport: CoordinatorTransport = {
      request(input) {
        urls.push(input.url);
        const firstPage = !input.url.includes('?cursor=');
        const body = firstPage
          ? {
              mailbox: {
                schemaVersion: 1,
                accounts: [],
                threads: [mailboxThread('thread_newer', '2026-09-13T14:00:00.000Z')],
              },
              pageInfo: { nextCursor: 'page 2' },
            }
          : {
              mailbox: {
                schemaVersion: 1,
                accounts: [],
                threads: [
                  mailboxThread('thread_newer', '2026-09-13T14:00:00.000Z'),
                  mailboxThread('thread_older', '2026-09-07T14:00:00.000Z'),
                ],
              },
              pageInfo: { nextCursor: null },
            };
        return {
          finalUrl: input.url,
          status: 200,
          statusText: 'OK',
          headers: [],
          bodyText: JSON.stringify(body),
          bodyBase64: null,
          bodyKind: 'text',
          bodyTruncated: false,
          sizeBytes: 1_000,
          elapsedMs: 5,
          contentType: 'application/json',
        };
      },
    };

    await expect(createCoordinatorClient(transport).getMailbox()).resolves.toMatchObject({
      threads: [
        { threadId: 'thread_newer' },
        { threadId: 'thread_older' },
      ],
    });
    expect(urls).toEqual([
      `${coordinatorOrigin}/v1/mailbox`,
      `${coordinatorOrigin}/v1/mailbox?cursor=page%202`,
    ]);
  });

  it('publishes and checkpoints a bounded page before a later page fails', async () => {
    let requests = 0;
    const seenPages: Array<{ nextCursor: string | null; loadedThreadCount: number }> = [];
    const transport: CoordinatorTransport = {
      request(input) {
        requests += 1;
        if (requests === 2) throw new Error('host request timed out');
        return {
          finalUrl: input.url,
          status: 200,
          statusText: 'OK',
          headers: [],
          bodyText: JSON.stringify({
            mailbox: {
              schemaVersion: 1,
              accounts: [],
              threads: [mailboxThread('thread_recent')],
            },
            pageInfo: { nextCursor: 'older_page' },
          }),
          bodyBase64: null,
          bodyKind: 'text',
          bodyTruncated: false,
          sizeBytes: 1_000,
          elapsedMs: 5,
          contentType: 'application/json',
        };
      },
    };

    await expect(createCoordinatorClient(transport).getMailbox({
      onPage(progress) {
        seenPages.push({
          nextCursor: progress.nextCursor,
          loadedThreadCount: progress.loadedThreadCount,
        });
      },
    })).rejects.toThrow('host request timed out');

    expect(seenPages).toEqual([{
      nextCursor: 'older_page',
      loadedThreadCount: 1,
    }]);
    expect(requests).toBe(2);
  });

  it('loads mailbox history beyond 100 pages and 10,000 threads', async () => {
    const pageSize = 100;
    const pageCount = 101;
    let requests = 0;
    const transport: CoordinatorTransport = {
      request(input) {
        requests += 1;
        const cursor = new URL(input.url).searchParams.get('cursor');
        const pageIndex = cursor === null ? 0 : Number(cursor.slice('page_'.length));
        const firstThreadIndex = pageIndex * pageSize;
        const body = {
          mailbox: {
            schemaVersion: 1,
            accounts: [],
            threads: Array.from(
              { length: pageSize },
              (_, offset) => mailboxThread(`thread_${firstThreadIndex + offset}`),
            ),
          },
          pageInfo: {
            nextCursor: pageIndex + 1 < pageCount ? `page_${pageIndex + 1}` : null,
          },
        };
        return {
          finalUrl: input.url,
          status: 200,
          statusText: 'OK',
          headers: [],
          bodyText: JSON.stringify(body),
          bodyBase64: null,
          bodyKind: 'text',
          bodyTruncated: false,
          sizeBytes: 40_000,
          elapsedMs: 5,
          contentType: 'application/json',
        };
      },
    };

    const mailbox = await createCoordinatorClient(transport).getMailbox();

    expect(requests).toBe(pageCount);
    expect(mailbox.threads).toHaveLength(pageSize * pageCount);
    expect(mailbox.threads[0]?.threadId).toBe('thread_0');
    expect(mailbox.threads.at(-1)?.threadId).toBe('thread_10099');
  });

  it('keeps each coordinator mailbox page bounded', async () => {
    const transport: CoordinatorTransport = {
      request: input => ({
        finalUrl: input.url,
        status: 200,
        statusText: 'OK',
        headers: [],
        bodyText: JSON.stringify({
          mailbox: {
            schemaVersion: 1,
            accounts: [],
            threads: Array.from(
              { length: 101 },
              (_, index) => mailboxThread(`thread_${index}`),
            ),
          },
          pageInfo: { nextCursor: null },
        }),
        bodyBase64: null,
        bodyKind: 'text',
        bodyTruncated: false,
        sizeBytes: 40_000,
        elapsedMs: 5,
        contentType: 'application/json',
      }),
    };

    await expect(createCoordinatorClient(transport).getMailbox()).rejects.toMatchObject({
      status: 502,
      code: 'invalid_response',
    });
  });

  it('rejects mailbox pagination that cycles without a terminal cursor', async () => {
    let requests = 0;
    const transport: CoordinatorTransport = {
      request: input => {
        const page = requests;
        requests += 1;
        return {
          finalUrl: input.url,
          status: 200,
          statusText: 'OK',
          headers: [],
          bodyText: JSON.stringify({
            mailbox: {
              schemaVersion: 1,
              accounts: [],
              threads: [mailboxThread(`thread_${page}`)],
            },
            pageInfo: { nextCursor: 'cursor_a' },
          }),
          bodyBase64: null,
          bodyKind: 'text',
          bodyTruncated: false,
          sizeBytes: 1_000,
          elapsedMs: 5,
          contentType: 'application/json',
        };
      },
    };

    await expect(createCoordinatorClient(transport).getMailbox()).rejects.toMatchObject({
      status: 502,
      code: 'invalid_response',
      message: 'Mailbox pagination did not advance.',
    });
    expect(requests).toBe(2);
  });

  it('rejects a novel cursor when its page adds no mailbox threads', async () => {
    let requests = 0;
    const transport: CoordinatorTransport = {
      request: input => {
        requests += 1;
        return {
          finalUrl: input.url,
          status: 200,
          statusText: 'OK',
          headers: [],
          bodyText: JSON.stringify({
            mailbox: {
              schemaVersion: 1,
              accounts: [],
              threads: [mailboxThread('thread_repeated')],
            },
            pageInfo: { nextCursor: `cursor_${requests}` },
          }),
          bodyBase64: null,
          bodyKind: 'text',
          bodyTruncated: false,
          sizeBytes: 1_000,
          elapsedMs: 5,
          contentType: 'application/json',
        };
      },
    };

    await expect(createCoordinatorClient(transport).getMailbox()).rejects.toMatchObject({
      status: 502,
      code: 'invalid_response',
      message: 'Mailbox pagination did not advance.',
    });
    expect(requests).toBe(2);
  });

  it.each(['user_1', 'google-oauth2|123456789'])('submits sender %s as both durable payload and host context precondition', async userId => {
    const expectedContext = { userId, workspaceId: 'workspace_a' };
    const calls: unknown[] = [];
    const transport: CoordinatorTransport = {
      request(input, options) {
        calls.push({ input, options });
        return {
          finalUrl: input.url,
          status: 202,
          statusText: 'Accepted',
          headers: [],
          bodyText: JSON.stringify({
            accepted: true,
            duplicate: false,
            receipt: {
              commandId: 'cmd_1',
              idempotencyKey: 'tap-email:acct_1:cmd_1',
              accountId: 'acct_1',
              state: 'accepted',
              acceptedAt: '2026-08-18T15:30:00.000Z',
              providerAcknowledgedAt: null,
              errorCode: null,
            },
          }),
          bodyBase64: null,
          bodyKind: 'text',
          bodyTruncated: false,
          sizeBytes: 200,
          elapsedMs: 8,
          contentType: 'application/json',
        };
      },
    };
    const client = createCoordinatorClient(transport);
    await expect(
      client.submitCommand({
        v: TAP_EMAIL_PROTOCOL_VERSION,
        commandId: 'cmd_1',
        idempotencyKey: 'tap-email:acct_1:cmd_1',
        accountId: 'acct_1',
        threadId: 'thread_1',
        kind: 'send_draft',
        createdAt: '2026-08-18T15:30:00.000Z',
        expectedProviderRevision: 'history_1',
        payload: { draftKey: 'draft_1', draftRevision: 1, to: 'person@example.com', subject: 'Hello', bodyText: 'Hi', expectedContext },
      }),
    ).resolves.toMatchObject({ duplicate: false });
    expect(calls).toEqual([
      expect.objectContaining({
        input: expect.objectContaining({
          method: 'POST',
          url: `${coordinatorOrigin}/v1/commands`,
          body: expect.stringContaining(JSON.stringify(expectedContext)),
        }),
        options: { credentialRef: 'platform-session', expectedContext },
      }),
    ]);
  });

  it('surfaces bounded coordinator errors by stable code', async () => {
    const transport: CoordinatorTransport = {
      request: input => ({
        finalUrl: input.url,
        status: 409,
        statusText: 'Conflict',
        headers: [],
        bodyText: JSON.stringify({
          error: 'idempotency_conflict',
          message: 'The command identity is already bound.',
        }),
        bodyBase64: null,
        bodyKind: 'text',
        bodyTruncated: false,
        sizeBytes: 120,
        elapsedMs: 5,
        contentType: 'application/json',
      }),
    };
    const client = createCoordinatorClient(transport);
    await expect(client.getCommand('cmd_1')).rejects.toMatchObject({
      name: 'Error',
      status: 409,
      code: 'idempotency_conflict',
    } satisfies Partial<CoordinatorError>);
  });

  it('reconciles an uncertain command under its original identity', async () => {
    const calls: MiniAppHttpRequestInput[] = [];
    const transport: CoordinatorTransport = {
      request: input => {
        calls.push(input);
        return {
          finalUrl: input.url,
          status: 200,
          statusText: 'OK',
          headers: [],
          bodyText: JSON.stringify({
            receipt: {
              commandId: 'cmd_uncertain_1',
              idempotencyKey: 'tap-email:acct_1:cmd_uncertain_1',
              accountId: 'acct_1',
              state: 'applied',
              acceptedAt: '2026-09-14T12:00:00.000Z',
              providerAcknowledgedAt: '2026-09-14T12:01:00.000Z',
              errorCode: null,
            },
          }),
          bodyBase64: null,
          bodyKind: 'text',
          bodyTruncated: false,
          sizeBytes: 240,
          elapsedMs: 6,
          contentType: 'application/json',
        };
      },
    };
    const client = createCoordinatorClient(transport);

    await expect(client.reconcileCommand('cmd_uncertain_1')).resolves.toMatchObject({
      commandId: 'cmd_uncertain_1',
      state: 'applied',
    });
    expect(calls).toEqual([
      expect.objectContaining({
        method: 'POST',
        url: `${coordinatorOrigin}/v1/commands/cmd_uncertain_1/reconcile`,
      }),
    ]);
  });

  it('reads a bounded, account-scoped Scheduled resource', async () => {
    const transport: CoordinatorTransport = {
      request: input => ({
        finalUrl: input.url,
        status: 200,
        statusText: 'OK',
        headers: [],
        bodyText: JSON.stringify({
          scheduledSends: [{
            scheduleCommandId: 'cmd_schedule_1',
            accountId: 'acct_1',
            threadId: 'thread_1',
            draftKey: 'draft_1',
            to: 'maya@example.com',
            subject: 'Tomorrow',
            dueAt: '2026-08-19T15:30:00.000Z',
            cancelIfReply: true,
            state: 'pending',
            dispatchCommandId: null,
            errorCode: null,
          }],
        }),
        bodyBase64: null,
        bodyKind: 'text',
        bodyTruncated: false,
        sizeBytes: 256,
        elapsedMs: 2,
        contentType: 'application/json',
      }),
    };
    await expect(createCoordinatorClient(transport).getScheduledSends()).resolves.toEqual([
      expect.objectContaining({
        scheduleCommandId: 'cmd_schedule_1',
        accountId: 'acct_1',
        state: 'pending',
      }),
    ]);
  });

  it('uses an explicit development profile without forwarding the TAP session to localhost', async () => {
    const calls: unknown[] = [];
    const transport: CoordinatorTransport = {
      request(input, options) {
        calls.push({ input, options });
        return {
          finalUrl: input.url,
          status: 200,
          statusText: 'OK',
          headers: [],
          bodyText: JSON.stringify({ mailbox: { schemaVersion: 1, accounts: [], threads: [] } }),
          bodyBase64: null,
          bodyKind: 'text',
          bodyTruncated: false,
          sizeBytes: 64,
          elapsedMs: 1,
          contentType: 'application/json',
        };
      },
    };

    await createCoordinatorClient(transport, 'http://localhost:8787').getMailbox();

    expect(calls).toEqual([
      expect.objectContaining({
        input: expect.objectContaining({
          url: 'http://localhost:8787/v1/mailbox',
          headers: [{ name: 'X-TAP-Dev-Profile', value: 'tap-email-local-dev' }],
        }),
        options: undefined,
      }),
    ]);
  });

  it('hydrates mailbox and thread data through governed host HTTP', async () => {
    const urls: string[] = [];
    const transport: CoordinatorTransport = {
      request: input => {
        urls.push(input.url);
        const body = input.url.endsWith('/v1/mailbox')
          ? {
              mailbox: {
                schemaVersion: 1,
                accounts: [],
                threads: [],
              },
            }
          : {
              thread: {
                accountId: 'acct_1',
                threadId: 'thread_1',
                providerRevision: 'history_1',
                pageInfo: { nextCursor: null, complete: true },
                messages: [
                  {
                    messageId: 'message_1',
                    from: { name: 'Maya', address: 'maya@example.com' },
                    to: [],
                    sentAt: '2026-08-18T15:30:00.000Z',
                    bodyText: 'Hello',
                    bodyHtml: '<p><strong>Hello</strong></p>',
                  },
                ],
              },
            };
        return {
          finalUrl: input.url,
          status: 200,
          statusText: 'OK',
          headers: [],
          bodyText: JSON.stringify(body),
          bodyBase64: null,
          bodyKind: 'text',
          bodyTruncated: false,
          sizeBytes: 200,
          elapsedMs: 8,
          contentType: 'application/json',
        };
      },
    };
    const client = createCoordinatorClient(transport);
    await expect(client.getMailbox()).resolves.toMatchObject({
      schemaVersion: 1,
      accounts: [],
    });
    await expect(client.getThread('acct_1', 'thread_1')).resolves.toEqual([
      expect.objectContaining({
        messageId: 'message_1',
        bodyText: 'Hello',
        bodyHtml: '<p><strong>Hello</strong></p>',
      }),
    ]);
    expect(urls).toEqual([
      `${coordinatorOrigin}/v1/mailbox`,
      `${coordinatorOrigin}/v1/accounts/acct_1/threads/thread_1`,
    ]);
  });

  it('rejects an unbounded rich body at the coordinator boundary', async () => {
    const transport: CoordinatorTransport = {
      request: input => ({
        finalUrl: input.url,
        status: 200,
        statusText: 'OK',
        headers: [],
        bodyText: JSON.stringify({
          thread: {
            accountId: 'acct_1',
            threadId: 'thread_1',
            providerRevision: 'history_1',
            pageInfo: { nextCursor: null, complete: true },
            messages: [
              {
                messageId: 'message_1',
                from: { name: 'Maya', address: 'maya@example.com' },
                to: [],
                sentAt: '2026-08-18T15:30:00.000Z',
                bodyText: 'Hello',
                bodyHtml: 'x'.repeat(500_001),
              },
            ],
          },
        }),
        bodyBase64: null,
        bodyKind: 'text',
        bodyTruncated: false,
        sizeBytes: 500_200,
        elapsedMs: 8,
        contentType: 'application/json',
      }),
    };

    await expect(
      createCoordinatorClient(transport).getThread('acct_1', 'thread_1'),
    ).rejects.toMatchObject({ status: 502, code: 'invalid_response' });
  });

  it('rejects malformed nested mailbox data at the coordinator boundary', async () => {
    const transport: CoordinatorTransport = {
      request: input => ({
        finalUrl: input.url,
        status: 200,
        statusText: 'OK',
        headers: [],
        bodyText: JSON.stringify({
          mailbox: {
            schemaVersion: 1,
            accounts: [],
            threads: [{ threadId: 'thread_without_required_fields' }],
          },
        }),
        bodyBase64: null,
        bodyKind: 'text',
        bodyTruncated: false,
        sizeBytes: 120,
        elapsedMs: 5,
        contentType: 'application/json',
      }),
    };
    await expect(createCoordinatorClient(transport).getMailbox()).rejects.toMatchObject({
      status: 502,
      code: 'invalid_response',
    });
  });

  it('loads a bounded remote-image batch through one governed coordinator request', async () => {
    const calls: unknown[] = [];
    const imageUrl = 'https://cdn.example.com/hero.png';
    const transport: CoordinatorTransport = {
      request(input, options) {
        calls.push({ input, options });
        return {
          finalUrl: input.url,
          status: 200,
          statusText: 'OK',
          headers: [],
          bodyText: JSON.stringify({
            images: [{
              url: imageUrl,
              dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
              sizeBytes: 8,
            }],
            blocked: [],
          }),
          bodyBase64: null,
          bodyKind: 'text',
          bodyTruncated: false,
          sizeBytes: 140,
          elapsedMs: 8,
          contentType: 'application/json',
        };
      },
    };

    await expect(createCoordinatorClient(transport).loadRemoteImages({
      accountId: 'account_1',
      threadId: 'thread_1',
      messageId: 'message_1',
    }, [imageUrl, imageUrl])).resolves.toEqual({
      [imageUrl]: 'data:image/png;base64,iVBORw0KGgo=',
    });
    expect(calls).toEqual([{
      input: expect.objectContaining({
        method: 'POST',
        url: `${coordinatorOrigin}/v1/accounts/account_1/threads/thread_1/messages/message_1/remote-images`,
        body: JSON.stringify({ urls: [imageUrl] }),
        responseBodyLimitBytes: 9_000_000,
      }),
      options: { credentialRef: 'platform-session' },
    }]);
  });

  it('loads more than 32 remote images in coordinator-sized batches', async () => {
    const urls = Array.from(
      { length: 65 },
      (_, index) => `https://cdn.example.com/campaign/image-${index}.png`,
    );
    const batches: string[][] = [];
    const transport: CoordinatorTransport = {
      request(input) {
        const batch = (JSON.parse(input.body ?? '{}') as { urls?: string[] }).urls ?? [];
        batches.push(batch);
        return {
          finalUrl: input.url,
          status: 200,
          statusText: 'OK',
          headers: [],
          bodyText: JSON.stringify({
            images: batch.map(url => ({
              url,
              dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
              sizeBytes: 8,
            })),
            blocked: [],
          }),
          bodyBase64: null,
          bodyKind: 'text',
          bodyTruncated: false,
          sizeBytes: 4_000,
          elapsedMs: 8,
          contentType: 'application/json',
        };
      },
    };

    const images = await createCoordinatorClient(transport).loadRemoteImages({
      accountId: 'account_1',
      threadId: 'thread_1',
      messageId: 'message_1',
    }, urls);

    expect(Object.keys(images)).toEqual(urls);
    expect(batches.map(batch => batch.length)).toEqual([32, 32, 1]);
    expect(batches.flat()).toEqual(urls);
  });

  it('returns validated batches explicitly as a partial result when a later batch fails', async () => {
    const urls = Array.from(
      { length: 33 },
      (_, index) => `https://cdn.example.com/campaign/image-${index}.png`,
    );
    let calls = 0;
    const transport: CoordinatorTransport = {
      request(input) {
        calls += 1;
        const batch = (JSON.parse(input.body ?? '{}') as { urls?: string[] }).urls ?? [];
        const succeeded = calls === 1;
        return {
          finalUrl: input.url,
          status: succeeded ? 200 : 503,
          statusText: succeeded ? 'OK' : 'Service Unavailable',
          headers: [],
          bodyText: JSON.stringify(succeeded
            ? {
                images: batch.map(url => ({
                  url,
                  dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
                  sizeBytes: 8,
                })),
                blocked: [],
              }
            : {
                error: 'image_proxy_unavailable',
                message: 'Image proxy unavailable.',
              }),
          bodyBase64: null,
          bodyKind: 'text',
          bodyTruncated: false,
          sizeBytes: succeeded ? 4_000 : 100,
          elapsedMs: 8,
          contentType: 'application/json',
        };
      },
    };

    const images = await createCoordinatorClient(transport).loadRemoteImages({
      accountId: 'account_1',
      threadId: 'thread_1',
      messageId: 'message_1',
    }, urls);

    expect(calls).toBe(2);
    expect(Object.keys(images)).toEqual(urls.slice(0, 32));
    expect(images[urls[32]!]).toBeUndefined();
  });

  it('rejects malformed or size-mismatched remote-image responses', async () => {
    const imageUrl = 'https://cdn.example.com/hero.png';
    const transport: CoordinatorTransport = {
      request: input => ({
        finalUrl: input.url,
        status: 200,
        statusText: 'OK',
        headers: [],
        bodyText: JSON.stringify({
          images: [{
            url: imageUrl,
            dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=',
            sizeBytes: 6,
          }],
          blocked: [],
        }),
        bodyBase64: null,
        bodyKind: 'text',
        bodyTruncated: false,
        sizeBytes: 140,
        elapsedMs: 8,
        contentType: 'application/json',
      }),
    };

    await expect(
      createCoordinatorClient(transport).loadRemoteImages({
        accountId: 'account_1',
        threadId: 'thread_1',
        messageId: 'message_1',
      }, [imageUrl]),
    ).rejects.toMatchObject({ status: 502, code: 'invalid_response' });
  });

  it('downloads an attachment as bounded binary data for the exact message tuple', async () => {
    const calls: unknown[] = [];
    const transport: CoordinatorTransport = {
      request(input, options) {
        calls.push({ input, options });
        return {
          finalUrl: input.url,
          status: 200,
          statusText: 'OK',
          headers: [
            { name: 'Content-Type', value: 'text/plain' },
            { name: 'Content-Length', value: '5' },
          ],
          bodyText: null,
          bodyBase64: 'aGVsbG8=',
          bodyKind: 'binary',
          bodyTruncated: false,
          sizeBytes: 5,
          elapsedMs: 8,
          contentType: 'text/plain',
        };
      },
    };
    const attachment = {
      resourceId: 'attachment_1',
      fileName: 'hello.txt',
      mimeType: 'text/plain',
      sizeBytes: 5,
      disposition: 'attachment' as const,
      contentId: null,
    };

    await expect(createCoordinatorClient(transport).downloadAttachment({
      accountId: 'account_1',
      threadId: 'thread_1',
      messageId: 'message_1',
    }, attachment)).resolves.toEqual(new TextEncoder().encode('hello'));
    expect(calls).toEqual([{
      input: expect.objectContaining({
        method: 'GET',
        url: `${coordinatorOrigin}/v1/accounts/account_1/threads/thread_1/messages/message_1/attachments/attachment_1`,
        responseBodyLimitBytes: 8 * 1_024 * 1_024,
      }),
      options: { credentialRef: 'platform-session' },
    }]);
  });

  it('rejects attachment responses with the wrong body kind, MIME type, or size', async () => {
    const attachment = {
      resourceId: 'attachment_1',
      fileName: 'hello.txt',
      mimeType: 'text/plain',
      sizeBytes: 5,
      disposition: 'attachment' as const,
      contentId: null,
    };
    const response = {
      finalUrl: `${coordinatorOrigin}/v1/accounts/account_1/threads/thread_1/messages/message_1/attachments/attachment_1`,
      status: 200,
      statusText: 'OK',
      headers: [],
      bodyText: null,
      bodyBase64: 'aGVsbG8=',
      bodyKind: 'binary' as const,
      bodyTruncated: false,
      sizeBytes: 5,
      elapsedMs: 8,
      contentType: 'text/plain',
    };
    const context = {
      accountId: 'account_1',
      threadId: 'thread_1',
      messageId: 'message_1',
    };

    for (const malformed of [
      { ...response, bodyKind: 'text' as const, bodyText: 'hello', bodyBase64: null },
      { ...response, contentType: 'application/pdf' },
      { ...response, sizeBytes: 4 },
      { ...response, bodyBase64: 'aGVsbA==' },
      { ...response, bodyTruncated: true },
    ]) {
      const transport: CoordinatorTransport = { request: () => malformed };
      await expect(
        createCoordinatorClient(transport).downloadAttachment(context, attachment),
      ).rejects.toMatchObject({ status: 502, code: 'invalid_response' });
    }
  });

  it('rejects known oversized attachments before making a network request', async () => {
    let requested = false;
    const transport: CoordinatorTransport = {
      request: input => {
        requested = true;
        throw new Error(`Unexpected request to ${input.url}`);
      },
    };

    await expect(createCoordinatorClient(transport).downloadAttachment({
      accountId: 'account_1',
      threadId: 'thread_1',
      messageId: 'message_1',
    }, {
      resourceId: 'attachment_1',
      fileName: 'archive.zip',
      mimeType: 'application/zip',
      sizeBytes: 8 * 1_024 * 1_024 + 1,
      disposition: 'attachment',
      contentId: null,
    })).rejects.toMatchObject({ status: 413, code: 'attachment_too_large' });
    expect(requested).toBe(false);
  });

  it('stages selected bytes in bounded chunks and returns only an opaque draft reference', async () => {
    const calls: Array<{ readonly url: string; readonly body: string | null | undefined }> = [];
    const attachment = {
      stageId: 'stage_1',
      fileName: 'hello.txt',
      mimeType: 'text/plain',
      sizeBytes: 5,
      sha256Base64Url: 'LPJNul-wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ',
    };
    const transport: CoordinatorTransport = {
      request(input) {
        calls.push({ url: input.url, body: input.body });
        const ready = input.url.endsWith('/complete');
        const receivedChunks = input.url.endsWith('/chunks/0')
          ? 1
          : input.url.endsWith('/chunks/1') || ready
            ? 2
            : 0;
        return {
          finalUrl: input.url,
          status: input.url.endsWith('/attachments') ? 201 : 200,
          statusText: 'OK',
          headers: [],
          bodyText: JSON.stringify({
            stage: {
              attachment,
              chunkSize: 3,
              expectedChunks: 2,
              receivedChunks,
              state: ready ? 'ready' : 'staging',
              expiresAt: '2026-09-21T12:00:00.000Z',
            },
          }),
          bodyBase64: null,
          bodyKind: 'text',
          bodyTruncated: false,
          sizeBytes: 300,
          elapsedMs: 2,
          contentType: 'application/json',
        };
      },
    };

    await expect(createCoordinatorClient(transport).stageAttachment({
      accountId: 'account_1',
      draftKey: 'draft_1',
      idempotencyKey: 'attachment_1',
      fileName: 'hello.txt',
      mimeType: 'text/plain',
      bytes: new TextEncoder().encode('hello'),
    })).resolves.toEqual(attachment);

    expect(calls).toHaveLength(4);
    expect(calls.map(call => call.url)).toEqual([
      `${coordinatorOrigin}/v1/accounts/account_1/drafts/draft_1/attachments`,
      `${coordinatorOrigin}/v1/accounts/account_1/drafts/draft_1/attachments/stage_1/chunks/0`,
      `${coordinatorOrigin}/v1/accounts/account_1/drafts/draft_1/attachments/stage_1/chunks/1`,
      `${coordinatorOrigin}/v1/accounts/account_1/drafts/draft_1/attachments/stage_1/complete`,
    ]);
    expect(JSON.parse(calls[0]!.body!)).toEqual({
      idempotencyKey: 'attachment_1',
      fileName: 'hello.txt',
      mimeType: 'text/plain',
      sizeBytes: 5,
      sha256Base64Url: attachment.sha256Base64Url,
    });
    expect(JSON.parse(calls[1]!.body!)).toEqual({ dataBase64: 'aGVs' });
    expect(JSON.parse(calls[2]!.body!)).toEqual({ dataBase64: 'bG8=' });
    expect(calls[3]!.body).toBeUndefined();
    expect(JSON.stringify(attachment)).not.toContain('aGVsbG8');
    expect(attachment).not.toHaveProperty('dataBase64');
  });
});

describe('streamed mailbox backpressure', () => {
  function pages(count: number) {
    let requests = 0;
    const transport: CoordinatorTransport = {
      request(input) {
        requests += 1;
        return { finalUrl: input.url, status: 200, statusText: 'OK', headers: [],
          bodyText: JSON.stringify({ mailbox: { schemaVersion: 1, accounts: [], threads: [mailboxThread(`thread_${requests}`)] },
            pageInfo: { nextCursor: requests < count ? `page_${requests + 1}` : null } }),
          bodyBase64: null, bodyKind: 'text', bodyTruncated: false, sizeBytes: 1000, elapsedMs: 1, contentType: 'application/json' };
      },
    };
    return { client: createCoordinatorClient(transport), requests: () => requests };
  }

  it('does not fetch ahead of a durable page callback or retain collected history', async () => {
    const fixture = pages(150);
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    let observed = 0;
    const loading = fixture.client.getMailbox({ collect: false, async onPage(page) {
      observed = page.loadedThreadCount;
      if (page.pageCount === 1) { enter(); await gate; }
    } });
    await entered;
    expect(fixture.requests()).toBe(1);
    release();
    expect((await loading).threads).toEqual([]);
    expect(observed).toBe(150);
    expect(fixture.requests()).toBe(150);
  });

  it('stops traversal after cancellation during an in-flight page commit', async () => {
    const fixture = pages(150);
    const abort = new AbortController();
    await expect(fixture.client.getMailbox({ collect: false, signal: abort.signal,
      onPage() { abort.abort(); } })).rejects.toThrow();
    expect(fixture.requests()).toBe(1);
  });

  it('never advances when the durable page commit rejects', async () => {
    const fixture = pages(150);
    await expect(fixture.client.getMailbox({ collect: false,
      onPage() { throw new Error('page commit failed'); } })).rejects.toThrow('page commit failed');
    expect(fixture.requests()).toBe(1);
  });
});
