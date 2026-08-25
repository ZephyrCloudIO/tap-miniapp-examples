import { describe, expect, it } from '@rstest/core';
import { TAP_EMAIL_PROTOCOL_VERSION } from '@tap-examples/tap-email-protocol';
import {
  CoordinatorError,
  coordinatorOrigin,
  createCoordinatorClient,
  type CoordinatorTransport,
} from './coordinator-client';

describe('TAP Email coordinator client', () => {
  it('submits a stable account-scoped command with the platform session', async () => {
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
        kind: 'archive',
        createdAt: '2026-08-18T15:30:00.000Z',
        expectedProviderRevision: 'history_1',
        payload: {},
      }),
    ).resolves.toMatchObject({ duplicate: false });
    expect(calls).toEqual([
      expect.objectContaining({
        input: expect.objectContaining({
          method: 'POST',
          url: `${coordinatorOrigin}/v1/commands`,
        }),
        options: { credentialRef: 'platform-session' },
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
                messages: [
                  {
                    messageId: 'message_1',
                    from: { name: 'Maya', address: 'maya@example.com' },
                    to: [],
                    sentAt: '2026-08-18T15:30:00.000Z',
                    bodyText: 'Hello',
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
      expect.objectContaining({ messageId: 'message_1', bodyText: 'Hello' }),
    ]);
    expect(urls).toEqual([
      `${coordinatorOrigin}/v1/mailbox`,
      `${coordinatorOrigin}/v1/accounts/acct_1/threads/thread_1`,
    ]);
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
});
