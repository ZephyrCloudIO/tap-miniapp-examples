import { RefreshCw } from 'lucide-react';
import React from 'react';

interface MailSyncButtonProps {
  readonly onSync: () => void;
  readonly syncing: boolean;
}

/** Keeps its visible and accessible label stable while exposing async state. */
export function MailSyncButton({ onSync, syncing }: MailSyncButtonProps) {
  return (
    <button
      aria-busy={syncing}
      aria-label="Sync mail"
      className={`sync-button${syncing ? ' is-syncing' : ''}`}
      disabled={syncing}
      onClick={onSync}
      type="button"
    >
      <RefreshCw aria-hidden="true" className="app-action-icon" />
      <span className="sync-label">Sync</span>
      <span aria-hidden="true" className="sync-status-icon" />
    </button>
  );
}
