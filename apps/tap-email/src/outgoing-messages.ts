import type { MailDraftAttachment } from '@tap-examples/tap-email-protocol';
import { outboxImmediateSends, type EmailMessage, type EmailThread, type MailState, type OutboxSend } from './domain';

export interface OutgoingThreadMessage {
  readonly message: EmailMessage;
  readonly status: 'sending' | 'delayed' | 'failed' | 'uncertain' | 'sent';
  readonly attachments: readonly MailDraftAttachment[];
  readonly cc?: string;
  readonly bcc?: string;
}

/** Keep local replies separate from provider rows, so paging and cache refreshes cannot erase them. */
export function outgoingThreadMessages(
  state: MailState,
  thread: EmailThread,
  confirmed: readonly OutboxSend[] = [],
  errors: Readonly<Record<string, string>> = {},
): readonly OutgoingThreadMessage[] {
  const candidates = new Map<string, OutboxSend>();
  for (const item of [...outboxImmediateSends(state), ...confirmed]) {
    const command = item.attempts[0]!.command;
    if (command.accountId === thread.accountId && command.threadId === thread.threadId) {
      candidates.set(command.payload.draftKey, item);
    }
  }
  const account = state.accounts.find(item => item.accountId === thread.accountId);
  const received = new Set(thread.messages.map(message => message.internetMessageId));
  return [...candidates.values()].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt)).flatMap(item => {
    const origin = item.attempts[0]!.command;
    const current = item.attempts.at(-1)!;
    const payload = origin.payload;
    // The provider's MIME writer uses this same stable draft identity for retries.
    const internetMessageId = `<${payload.draftKey}@tap-email.local>`;
    if (received.has(internetMessageId)) return [];
    const outcome = current.receipt?.state;
    return [{
      message: {
        messageId: `outgoing:${payload.draftKey}`,
        internetMessageId,
        from: { name: account?.displayName || 'Me', address: account?.address || '' },
        to: [{ name: '', address: payload.to }],
        sentAt: origin.createdAt,
        bodyText: payload.bodyText,
      },
      status: outcome === 'applied' ? 'sent' as const
        : outcome === 'failed' ? 'failed' as const
          : outcome === 'uncertain' ? 'uncertain' as const
            : errors[current.command.commandId] ? 'delayed' as const : 'sending' as const,
      attachments: payload.attachments ?? [],
      cc: payload.cc,
      bcc: payload.bcc,
    }];
  });
}
