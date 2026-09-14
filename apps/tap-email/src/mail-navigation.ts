import type { MailSplit } from './domain';

export interface MailViewDefinition {
  readonly id: MailSplit;
  readonly label: string;
  readonly shortcut: string | null;
  readonly emptyTitle: string;
}

/**
 * Stable mailbox destinations. These IDs belong to TAP Email's UI contract,
 * not to any provider's label vocabulary. Provider adapters can populate them
 * later without changing navigation or multi-account selection.
 */
export const FIXED_MAILBOX_CATEGORIES: readonly MailViewDefinition[] = [
  { id: 'inbox', label: 'Inbox', shortcut: 'G I', emptyTitle: 'Inbox is clear' },
  { id: 'starred', label: 'Starred', shortcut: 'G S', emptyTitle: 'No starred conversations' },
  { id: 'drafts', label: 'Drafts', shortcut: 'G D', emptyTitle: 'No drafts' },
  { id: 'sent', label: 'Sent', shortcut: 'G T', emptyTitle: 'No sent conversations' },
  { id: 'done', label: 'Done', shortcut: 'G E', emptyTitle: 'Nothing marked done' },
  { id: 'auto-archived', label: 'Auto Archived', shortcut: null, emptyTitle: 'Nothing auto archived' },
  { id: 'scheduled', label: 'Scheduled', shortcut: null, emptyTitle: 'Nothing scheduled' },
  { id: 'outbox', label: 'Outbox', shortcut: null, emptyTitle: 'No sends need attention' },
  { id: 'reminders', label: 'Reminders', shortcut: 'G H', emptyTitle: 'No reminders' },
  { id: 'snippets', label: 'Snippets', shortcut: 'G ;', emptyTitle: 'No snippets' },
  { id: 'spam', label: 'Spam', shortcut: 'G !', emptyTitle: 'No spam' },
  { id: 'trash', label: 'Trash', shortcut: 'G #', emptyTitle: 'Trash is empty' },
] as const;

export const TAP_MAIL_VIEWS: readonly MailViewDefinition[] = [
  { id: 'critical', label: 'Critical', shortcut: 'G C', emptyTitle: 'No critical conversations' },
  { id: 'needs-response', label: 'Needs response', shortcut: 'G N', emptyTitle: 'No replies needed' },
  { id: 'waiting', label: 'Waiting', shortcut: 'G W', emptyTitle: 'Nothing waiting' },
] as const;

export const ALL_MAIL_VIEWS: readonly MailViewDefinition[] = [
  ...FIXED_MAILBOX_CATEGORIES,
  ...TAP_MAIL_VIEWS,
] as const;

export const MAIL_VIEW_IDS: ReadonlySet<MailSplit> = new Set(
  ALL_MAIL_VIEWS.map(view => view.id),
);

export function mailViewDefinition(id: MailSplit): MailViewDefinition {
  return ALL_MAIL_VIEWS.find(view => view.id === id) ?? FIXED_MAILBOX_CATEGORIES[0]!;
}
