import type { EmailAccount, EmailThread } from './domain';

export interface RecipientSuggestion {
  readonly name: string;
  readonly address: string;
  readonly lastSentAt: string;
}

export type RecipientSearch = (query: string) => Promise<readonly RecipientSuggestion[]>;

export const NO_RECIPIENTS: readonly RecipientSuggestion[] = [];

/** Offline/preview fallback; the coordinator searches the complete synced index. */
export function localSentRecipients(
  accounts: readonly EmailAccount[],
  threads: readonly EmailThread[],
): readonly RecipientSuggestion[] {
  const ownAddresses = new Map(accounts.map(account => [account.accountId, account.address.toLowerCase()]));
  const recipients = new Map<string, RecipientSuggestion>();
  for (const thread of threads) {
    const ownAddress = ownAddresses.get(thread.accountId);
    if (!ownAddress || thread.providerResources?.includes('drafts') || thread.labels.includes('DRAFT')) continue;
    for (const message of thread.messages) {
      if (message.from.address.toLowerCase() !== ownAddress) continue;
      for (const recipient of message.to) {
        const address = recipient.address.trim().toLowerCase();
        if (!/^[^\s@,;<>]+@[^\s@,;<>]+$/u.test(address)) continue;
        const previous = recipients.get(address);
        if (!previous || message.sentAt > previous.lastSentAt) {
          recipients.set(address, { address, name: recipient.name, lastSentAt: message.sentAt });
        }
      }
    }
  }
  return [...recipients.values()];
}

/** Recipient fields contain comma-separated addresses; autocomplete the last one. */
export function recipientQuery(value: string): string {
  return value.slice(value.lastIndexOf(',') + 1).trim();
}

export function completeRecipient(value: string, address: string): string {
  const start = value.lastIndexOf(',') + 1;
  return `${start ? `${value.slice(0, start)} ` : ''}${address}`;
}

export function matchRecipients(
  recipients: readonly RecipientSuggestion[],
  query: string,
  selectedValues: readonly string[],
  limit = 8,
): readonly RecipientSuggestion[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const selected = new Set(selectedValues.flatMap(value => value.split(',').map(item => item.trim().toLowerCase())));
  const unique = new Map<string, RecipientSuggestion>();
  for (const recipient of recipients) {
    const address = recipient.address.toLowerCase();
    if (selected.has(address) || (!address.includes(needle) && !recipient.name.toLowerCase().includes(needle))) continue;
    const previous = unique.get(address);
    if (!previous || recipient.lastSentAt > previous.lastSentAt) unique.set(address, { ...recipient, address });
  }
  const rank = (recipient: RecipientSuggestion) => recipient.address.startsWith(needle)
    ? 0 : recipient.name.toLowerCase().startsWith(needle) ? 1 : 2;
  return [...unique.values()].sort((a, b) => rank(a) - rank(b) || b.lastSentAt.localeCompare(a.lastSentAt) || a.address.localeCompare(b.address)).slice(0, limit);
}
