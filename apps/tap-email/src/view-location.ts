import { isSafeMailIdentifier } from '@tap-examples/tap-email-protocol';
import type { AccountSelection, EmailThread, MailSplit } from './domain';
import { MAIL_VIEW_IDS } from './mail-navigation';

export interface MailViewLocation {
  readonly accountId: AccountSelection;
  readonly split: MailSplit;
  readonly threadAccountId: string | null;
  readonly threadId: string | null;
}

export function parseMailViewHash(hash: string): MailViewLocation | null {
  const parameters = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  if (![...parameters.keys()].some(key => ['account', 'split', 'threadAccount', 'thread'].includes(key))) {
    return null;
  }
  const account = parameters.get('account');
  const split = parameters.get('split');
  const threadAccount = parameters.get('threadAccount');
  const thread = parameters.get('thread');
  return {
    accountId: account === 'all' || isSafeMailIdentifier(account) ? account : 'all',
    split: MAIL_VIEW_IDS.has(split as MailSplit) ? split as MailSplit : 'inbox',
    threadAccountId: isSafeMailIdentifier(threadAccount) ? threadAccount : null,
    threadId: isSafeMailIdentifier(thread) ? thread : null,
  };
}

export function mailViewLocation(
  accountId: AccountSelection,
  split: MailSplit,
  thread: Pick<EmailThread, 'accountId' | 'threadId'> | null,
): MailViewLocation {
  return {
    accountId,
    split,
    threadAccountId: thread?.accountId ?? null,
    threadId: thread?.threadId ?? null,
  };
}

export function withMailViewHash(href: string, location: MailViewLocation): string {
  const url = new URL(href);
  const hash = new URLSearchParams();
  hash.set('account', location.accountId);
  hash.set('split', location.split);
  if (location.threadAccountId) hash.set('threadAccount', location.threadAccountId);
  if (location.threadId) hash.set('thread', location.threadId);
  url.hash = hash.toString();
  return url.href;
}

export function mailViewDeepLink(
  accountId: string,
  split: MailSplit,
  threadId: string,
): string {
  const hash = new URLSearchParams({
    account: accountId,
    split,
    threadAccount: accountId,
    thread: threadId,
  });
  return `#${hash.toString()}`;
}
