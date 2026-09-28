import React, { useRef } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@theaiplatform/miniapp-sdk/ui';
import { Archive, CalendarClock, CheckCheck, Clock3, FileText, Inbox, Mail, MailWarning, Menu, MessageSquare, Search, Send, Star, Timer, Trash2, TriangleAlert, X, type LucideIcon } from 'lucide-react';
import type { EmailAccount, MailSplit } from './domain';
import { FIXED_MAILBOX_CATEGORIES, TAP_MAIL_VIEWS, mailViewDefinition } from './mail-navigation';

const icons: Record<MailSplit, LucideIcon> = {
  inbox: Inbox, starred: Star, drafts: FileText, sent: Send, done: CheckCheck,
  'auto-archived': Archive, scheduled: CalendarClock, outbox: Send, reminders: Clock3,
  snippets: FileText, spam: MailWarning, trash: Trash2, critical: TriangleAlert,
  'needs-response': MessageSquare, waiting: Timer,
};

export function MobileMailToolbar({ folder, account, onNavigate, onSearch }: {
  folder: MailSplit; account: string; onNavigate(): void; onSearch(): void;
}) {
  return <div className="mobile-mail-toolbar">
    <button type="button" className="mobile-mail-location" aria-label={`Mailboxes, ${mailViewDefinition(folder).label}, ${account}`} aria-haspopup="dialog" onClick={onNavigate}>
      <Menu aria-hidden="true" />
      <span><strong>{mailViewDefinition(folder).label}</strong><small>{account}</small></span>
    </button>
    <button type="button" className="mobile-mail-search-button" aria-label="Search mail" aria-expanded="false" onClick={onSearch}><Search aria-hidden="true" /></button>
  </div>;
}

export function MobileMailNavigation({ accounts, accountId, folder, onAccount, onFolder, onClose, onRestoreFocus }: {
  accounts: readonly EmailAccount[]; accountId: string; folder: MailSplit;
  onAccount(id: string): void; onFolder(id: MailSplit): void; onClose(): void; onRestoreFocus(): void;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="mobile-mail-navigation" hideCloseButton
      onOpenAutoFocus={event => { event.preventDefault(); closeButton.current?.focus(); }}
      onCloseAutoFocus={event => { event.preventDefault(); onRestoreFocus(); }}>
      <header><DialogTitle>Mailboxes</DialogTitle><button ref={closeButton} type="button" aria-label="Close mailboxes" onClick={onClose}><X aria-hidden="true" /></button></header>
      <DialogDescription className="sr-only">Choose a mailbox or switch email accounts.</DialogDescription>
      <div className="mobile-mail-navigation-scroll">
        {[{ title: 'Mailboxes', views: FIXED_MAILBOX_CATEGORIES }, { title: 'TAP views', views: TAP_MAIL_VIEWS }].map(group =>
          <nav key={group.title} aria-label={group.title}>
            {group.title === 'TAP views' ? <h3>{group.title}</h3> : null}
            {group.views.map(view => {
              const Icon = icons[view.id];
              return <button key={view.id} type="button" aria-current={folder === view.id ? 'page' : undefined} onClick={() => onFolder(view.id)}>
                <Icon aria-hidden="true" /><span>{view.label}</span>
              </button>;
            })}
          </nav>)}
        <section aria-label="Email accounts">
          <h3>Accounts</h3>
          <button type="button" aria-pressed={accountId === 'all'} onClick={() => onAccount('all')}><Mail aria-hidden="true" /><span>All accounts</span></button>
          {accounts.map(account => <button key={account.accountId} type="button" aria-pressed={accountId === account.accountId} onClick={() => onAccount(account.accountId)}>
            <span className="mobile-mail-account-dot" aria-hidden="true" style={{ background: account.accent }} /><span>{account.displayName}</span>
          </button>)}
        </section>
      </div>
    </DialogContent>
  </Dialog>;
}
