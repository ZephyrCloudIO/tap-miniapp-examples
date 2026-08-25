import {
  sdk,
  type MiniAppHttpRequestInput,
  type MiniAppHttpRequestOptions,
  type MiniAppHttpResponse,
  type MiniAppMaybePromise,
} from '@theaiplatform/miniapp-sdk/sdk';
import type {
  AccountCoverage,
  MailCommand,
  MailCommandReceipt,
} from '@tap-examples/tap-email-protocol';
import {
  isAccountCoverage,
  isMailCommandReceipt,
} from '@tap-examples/tap-email-protocol';
import {
  isEmailMessage,
  isMailboxSnapshot,
  type EmailMessage,
  type MailboxSnapshot,
} from './domain';

export const coordinatorOrigin = 'https://tap-email-coordinator.theaiplatform.app';

export interface CoordinatorTransport {
  request(
    input: MiniAppHttpRequestInput,
    options?: MiniAppHttpRequestOptions,
  ): MiniAppMaybePromise<MiniAppHttpResponse>;
}

export interface CommandAcceptance {
  readonly accepted: true;
  readonly duplicate: boolean;
  readonly receipt: MailCommandReceipt;
}

export class CoordinatorError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function parseResponse(response: MiniAppHttpResponse): unknown {
  if (response.bodyTruncated || response.bodyKind !== 'text' || !response.bodyText) {
    throw new CoordinatorError(
      response.status,
      'invalid_response',
      'The TAP Email coordinator returned an unreadable response.',
    );
  }
  try {
    return JSON.parse(response.bodyText);
  } catch {
    throw new CoordinatorError(
      response.status,
      'invalid_response',
      'The TAP Email coordinator returned invalid JSON.',
    );
  }
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CoordinatorError(502, 'invalid_response', 'Coordinator response is malformed.');
  }
  return value as Readonly<Record<string, unknown>>;
}

async function call(
  transport: CoordinatorTransport,
  input: MiniAppHttpRequestInput,
  responseBodyLimitBytes = 262_144,
): Promise<unknown> {
  const response = await transport.request(
    { ...input, responseBodyLimitBytes, timeoutMs: 30_000 },
    { credentialRef: 'platform-session' },
  );
  const body = asRecord(parseResponse(response));
  if (response.status < 200 || response.status >= 300) {
    throw new CoordinatorError(
      response.status,
      typeof body.error === 'string' ? body.error : 'coordinator_error',
      typeof body.message === 'string' ? body.message : 'Coordinator request failed.',
    );
  }
  return body;
}

function mailboxSnapshot(value: unknown): MailboxSnapshot {
  const body = asRecord(value);
  const mailbox = asRecord(body.mailbox);
  if (!isMailboxSnapshot(mailbox)) {
    throw new CoordinatorError(502, 'invalid_response', 'Mailbox response is malformed.');
  }
  return mailbox;
}

export function createCoordinatorClient(transport?: CoordinatorTransport) {
  const resolved = transport ?? sdk.http;
  if (!resolved) {
    throw new CoordinatorError(
      0,
      'host_http_unavailable',
      'This TAP host does not provide the coordinator transport.',
    );
  }
  return {
    async beginGoogleConnection(): Promise<string> {
      const body = asRecord(
        await call(resolved, {
          method: 'POST',
          url: `${coordinatorOrigin}/v1/accounts/google/connect`,
        }),
      );
      if (typeof body.authorizationUrl !== 'string') {
        throw new CoordinatorError(502, 'invalid_response', 'Google connection response is malformed.');
      }
      return body.authorizationUrl;
    },
    async getMailbox(): Promise<MailboxSnapshot> {
      return mailboxSnapshot(
        await call(
          resolved,
          { method: 'GET', url: `${coordinatorOrigin}/v1/mailbox` },
          2_097_152,
        ),
      );
    },
    async getThread(accountId: string, threadId: string): Promise<readonly EmailMessage[]> {
      const body = asRecord(
        await call(
          resolved,
          {
            method: 'GET',
            url: `${coordinatorOrigin}/v1/accounts/${encodeURIComponent(accountId)}/threads/${encodeURIComponent(threadId)}`,
          },
          2_097_152,
        ),
      );
      const thread = asRecord(body.thread);
      if (!Array.isArray(thread.messages) || !thread.messages.every(isEmailMessage)) {
        throw new CoordinatorError(502, 'invalid_response', 'Thread response is malformed.');
      }
      return thread.messages;
    },
    async requestSync(accountId: string): Promise<boolean> {
      const body = asRecord(
        await call(resolved, {
          method: 'POST',
          url: `${coordinatorOrigin}/v1/accounts/${encodeURIComponent(accountId)}/sync`,
        }),
      );
      return body.queued === true;
    },
    async submitCommand(command: MailCommand): Promise<CommandAcceptance> {
      const body = asRecord(
        await call(resolved, {
          method: 'POST',
          url: `${coordinatorOrigin}/v1/commands`,
          headers: [{ name: 'Content-Type', value: 'application/json' }],
          body: JSON.stringify(command),
        }),
      );
      if (
        body.accepted !== true ||
        typeof body.duplicate !== 'boolean' ||
        !isMailCommandReceipt(body.receipt)
      ) {
        throw new CoordinatorError(502, 'invalid_response', 'Command receipt is malformed.');
      }
      return {
        accepted: true,
        duplicate: body.duplicate,
        receipt: body.receipt,
      };
    },
    async getCommand(commandId: string): Promise<MailCommandReceipt> {
      const body = asRecord(
        await call(resolved, {
          method: 'GET',
          url: `${coordinatorOrigin}/v1/commands/${encodeURIComponent(commandId)}`,
        }),
      );
      if (!isMailCommandReceipt(body.receipt)) {
        throw new CoordinatorError(502, 'invalid_response', 'Command receipt is malformed.');
      }
      return body.receipt;
    },
    async getCoverage(): Promise<readonly AccountCoverage[]> {
      const body = asRecord(
        await call(resolved, {
          method: 'GET',
          url: `${coordinatorOrigin}/v1/accounts/coverage`,
        }),
      );
      if (!Array.isArray(body.accounts) || !body.accounts.every(isAccountCoverage)) {
        throw new CoordinatorError(502, 'invalid_response', 'Coverage response is malformed.');
      }
      return body.accounts;
    },
  };
}
