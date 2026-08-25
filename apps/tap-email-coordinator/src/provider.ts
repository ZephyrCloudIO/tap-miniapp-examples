import type { MailCommand } from '@tap-examples/tap-email-protocol';

export interface ProviderScope {
  readonly profileId: string;
  readonly accountId: string;
}

export type ProviderExecutionResult =
  | {
      readonly outcome: 'acknowledged';
      readonly providerRevision: string | null;
    }
  | {
      readonly outcome: 'retryable';
      readonly errorCode: string;
    }
  | {
      readonly outcome: 'uncertain';
      readonly errorCode: string;
    }
  | {
      readonly outcome: 'failed';
      readonly errorCode: string;
    };

/**
 * Sole provider-mutation seam for TAP Email. Implementations must carry the
 * command's stable idempotency identity into the provider operation or a
 * provider-visible reconciliation marker before making a write.
 */
export interface GoogleProviderPort {
  execute(
    scope: ProviderScope,
    command: MailCommand,
  ): Promise<ProviderExecutionResult>;
}

/**
 * The first coordinator slice deliberately fails closed until Google OAuth and
 * credential resolution are connected. It never simulates a successful write.
 */
export const unconfiguredGoogleProvider: GoogleProviderPort = {
  async execute() {
    return {
      outcome: 'failed',
      errorCode: 'google_connection_required',
    };
  },
};
