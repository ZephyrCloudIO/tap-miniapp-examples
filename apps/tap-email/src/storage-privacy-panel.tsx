import React, { useEffect, useState } from 'react';
import type { EmailAccount } from './domain';
import type {
  LocalDataWipeReceipt,
  LocalMailStore,
  LocalStorageInventory,
} from './local-store';

export interface StoragePrivacyPanelProps {
  readonly accounts: readonly EmailAccount[];
  readonly store: LocalMailStore;
  readonly onWipe: (receipt: LocalDataWipeReceipt) => void;
}

export function formatStorageBytes(bytes: number | null): string {
  if (bytes === null) return 'Unavailable';
  if (bytes < 1_024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'] as const;
  let value = bytes / 1_024;
  let unit: (typeof units)[number] = units[0];
  for (let index = 1; index < units.length && value >= 1_024; index += 1) {
    value /= 1_024;
    unit = units[index]!;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
}

function indexedThroughLabel(value: string | null): string {
  if (!value) return 'Coverage horizon unavailable';
  return `Indexed through ${new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))}`;
}

export function StoragePrivacyPanel({
  accounts,
  store,
  onWipe,
}: StoragePrivacyPanelProps) {
  const [inventory, setInventory] = useState<LocalStorageInventory | null>(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<LocalDataWipeReceipt | null>(null);

  const refresh = () => {
    setLoadError('');
    return store.inspectStorage()
      .then(setInventory)
      .catch(error => setLoadError(`Storage inventory unavailable: ${String(error)}`));
  };

  useEffect(() => {
    let active = true;
    void store.inspectStorage()
      .then(value => {
        if (active) setInventory(value);
      })
      .catch(error => {
        if (active) setLoadError(`Storage inventory unavailable: ${String(error)}`);
      });
    return () => {
      active = false;
    };
  }, [store]);

  const wipe = async (target: 'device' | string) => {
    if (confirmTarget !== target || busy) {
      setConfirmTarget(target);
      return;
    }
    setBusy(true);
    setLoadError('');
    try {
      const result = target === 'device'
        ? await store.wipeDevice()
        : await store.wipeAccount(target);
      setReceipt(result);
      setConfirmTarget(null);
      onWipe(result);
      await refresh();
    } catch (error) {
      setLoadError(`Local data was not cleared: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="storage-privacy-title" className="storage-privacy-panel">
      <div className="storage-privacy-heading">
        <div>
          <h3 id="storage-privacy-title">On-device mail data</h3>
          <p>Private local replica, search metadata, cached resources, and audit storage.</p>
        </div>
        <button disabled={busy} onClick={() => void refresh()} type="button">Refresh</button>
      </div>
      {loadError ? <p className="storage-warning" role="alert">{loadError}</p> : null}
      {inventory ? (
        <>
          <div className="storage-summary">
            <strong>{formatStorageBytes(inventory.quota.usedBytes)}</strong>
            <span>{indexedThroughLabel(inventory.indexedAt)}</span>
          </div>
          <div className="storage-class-list">
            {inventory.classes.map(item => (
              <div key={item.class}>
                <span>{item.class.replaceAll('-', ' ')}</span>
                <strong>{formatStorageBytes(item.bytes)}</strong>
                <small>{item.measurement}{item.itemCount === null ? '' : ` · ${item.itemCount} items`}</small>
              </div>
            ))}
          </div>
          <div className="storage-account-list">
            {inventory.accounts.map(item => {
              const account = accounts.find(candidate => candidate.accountId === item.accountId);
              return (
                <div key={item.accountId}>
                  <span>
                    <strong>{account?.displayName || account?.address || item.accountId}</strong>
                    <small>{indexedThroughLabel(item.indexedThrough)}</small>
                  </span>
                  <button
                    aria-label={`Clear local data for ${account?.displayName || item.accountId}`}
                    disabled={busy}
                    onBlur={() => setConfirmTarget(current => current === item.accountId ? null : current)}
                    onClick={() => void wipe(item.accountId)}
                    type="button"
                  >
                    {confirmTarget === item.accountId ? 'Confirm clear' : 'Clear local data'}
                  </button>
                </div>
              );
            })}
          </div>
          {inventory.warnings.map(warning => (
            <p className="storage-warning" key={warning}>{warning}</p>
          ))}
          <button
            className="storage-wipe-device"
            disabled={busy}
            onBlur={() => setConfirmTarget(current => current === 'device' ? null : current)}
            onClick={() => void wipe('device')}
            type="button"
          >
            {confirmTarget === 'device' ? 'Confirm clear this device' : 'Clear TAP Email data on this device'}
          </button>
        </>
      ) : loadError ? null : <p role="status">Inspecting local storage…</p>}
      {receipt ? (
        <div className={`storage-receipt${receipt.complete ? ' is-complete' : ' is-partial'}`} role="status">
          <strong>{receipt.complete ? 'Local data cleared' : 'Partially cleared'}</strong>
          <span>{receipt.complete
            ? 'The wipe receipt verified every local storage class.'
            : `Still present: ${receipt.remainingClasses.join(', ') || 'mounted in-memory state'}.`}</span>
          {receipt.warnings.map(warning => <small key={warning}>{warning}</small>)}
        </div>
      ) : null}
    </section>
  );
}
