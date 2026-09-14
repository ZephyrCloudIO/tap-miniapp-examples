import React, { useEffect, useState } from 'react';
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
  const [commandHeld, setCommandHeld] = useState(false);

  useEffect(() => {
    const showCommandHints = (event: KeyboardEvent) => {
      if (event.key === 'Meta' || event.metaKey) setCommandHeld(true);
    };
    const updateCommandHints = (event: KeyboardEvent) => {
      if (event.key === 'Meta' || !event.metaKey) setCommandHeld(false);
    };
    const hideCommandHints = () => setCommandHeld(false);
    const hideCommandHintsWhenInactive = () => {
      if (document.visibilityState !== 'visible') hideCommandHints();
    };

    window.addEventListener('keydown', showCommandHints);
    window.addEventListener('keyup', updateCommandHints);
    window.addEventListener('blur', hideCommandHints);
    document.addEventListener('visibilitychange', hideCommandHintsWhenInactive);

    return () => {
      window.removeEventListener('keydown', showCommandHints);
      window.removeEventListener('keyup', updateCommandHints);
      window.removeEventListener('blur', hideCommandHints);
      document.removeEventListener('visibilitychange', hideCommandHintsWhenInactive);
    };
  }, []);

  return (
    <div
      aria-label="Account view"
      className={`account-switcher${commandHeld ? ' is-command-held' : ''}`}
    >
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
