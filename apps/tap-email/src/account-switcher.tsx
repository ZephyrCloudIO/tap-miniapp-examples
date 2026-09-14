import React from 'react';
import type { EmailAccount } from './domain';

type AccountSwitcherAccount = Pick<
  EmailAccount,
  'accountId' | 'accent' | 'displayName'
>;

export interface AccountSwitcherProps {
  readonly accounts: readonly AccountSwitcherAccount[];
  readonly onSelect: (accountId: string) => void;
  readonly selectedAccountId: string;
}

export function AccountSwitcher({
  accounts,
  onSelect,
  selectedAccountId,
}: AccountSwitcherProps) {
  return (
    <div aria-label="Account view" className="account-switcher">
      <button
        className={selectedAccountId === 'all' ? 'is-active' : ''}
        onClick={() => onSelect('all')}
        type="button"
      >
        All accounts
        <kbd aria-hidden="true" className="account-shortcut">G A</kbd>
      </button>
      {accounts.map((account, index) => (
        <button
          className={selectedAccountId === account.accountId ? 'is-active' : ''}
          key={account.accountId}
          onClick={() => onSelect(account.accountId)}
          type="button"
        >
          <span
            aria-hidden="true"
            className="account-dot"
            style={{ backgroundColor: account.accent }}
          />
          {account.displayName}
          {index < 9 ? (
            <kbd aria-hidden="true" className="account-shortcut">⌃ {index + 1}</kbd>
          ) : null}
        </button>
      ))}
    </div>
  );
}
