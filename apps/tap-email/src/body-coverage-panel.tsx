import React, { useEffect, useMemo, useState } from 'react';
import type { MailBodyCoverage } from '@tap-examples/tap-email-protocol';
import type { EmailAccount } from './domain';
import { createCoordinatorClient } from './coordinator-client';

type Client = Pick<ReturnType<typeof createCoordinatorClient>, 'getBodyCoverage' | 'setBodyBackfill'>;
export function BodyCoveragePanel({ accounts, client: suppliedClient }: {
  readonly accounts: readonly EmailAccount[]; readonly client?: Client;
}) {
  const client = useMemo(() => suppliedClient ?? createCoordinatorClient(), [suppliedClient]);
  const [coverage, setCoverage] = useState<readonly MailBodyCoverage[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      try {
        const result = await client.getBodyCoverage();
        if (active) { setCoverage(result); setError(''); }
      } catch { if (active) setError('Body coverage is unavailable. Retry after checking your mail connection.'); }
      finally { if (active) timer = setTimeout(() => void refresh(), 10_000); }
    };
    void refresh();
    return () => { active = false; clearTimeout(timer); };
  }, [client, attempt]);
  const change = async (item: MailBodyCoverage, enabled: boolean) => {
    if (busy) return;
    setBusy(true); setError('');
    try { setCoverage(await client.setBodyBackfill(item.accountId, enabled)); setAttempt(value => value + 1); }
    catch { setError('Body downloading could not be changed. Reconnect the account if needed, then retry.'); }
    finally { setBusy(false); }
  };
  return <section className="storage-privacy-panel" aria-labelledby="body-coverage-title">
    <h3 id="body-coverage-title">Historical message bodies</h3>
    <p>Download available message bodies from Gmail into encrypted coordinator storage. Downloads continue while Email is closed; pause takes effect after the current bounded batch finishes. This does not download attachment files or guarantee complete local search.</p>
    {!coverage && !error ? <p role="status">Checking downloaded bodies…</p> : null}
    {coverage?.map(item => {
      const account = accounts.find(value => value.accountId === item.accountId);
      const caughtUp = item.pending === 0 && item.unavailable === 0 && item.metadataThreads === 0 && item.providerHistoryComplete;
      return <div className="body-coverage-account" key={item.accountId}>
        <strong>{account?.address ?? item.accountId}</strong>
        <p>{item.downloaded.toLocaleString()} of {item.total.toLocaleString()} known messages downloaded · {item.pending.toLocaleString()} pending · {item.unavailable.toLocaleString()} unavailable</p>
        <p>{caughtUp ? 'Caught up with synchronized history.' : `${item.metadataThreads.toLocaleString()} conversations still need their full inventory checked. ${item.providerHistoryComplete ? 'Provider metadata traversal is current.' : 'Provider history is incomplete or has unresolved sync failures.'}`}</p>
        {item.errorCode ? <p role="alert">Downloading paused or delayed: {item.errorCode}. Reconnect if needed, then retry.</p> : null}
        <button type="button" disabled={busy} onClick={() => void change(item, !item.enabled)}>{item.enabled ? 'Pause body downloads' : 'Download historical bodies'}</button>
        {item.unavailable > 0 || item.errorCode ? <button type="button" disabled={busy} onClick={() => void change(item, true)}>Retry unavailable bodies</button> : null}
        <small>{item.enabled ? 'Automatic body downloading enabled.' : 'Automatic body downloading paused.'} An unavailable body is not an empty email; oversized or unsupported content may require opening Gmail.</small>
      </div>;
    })}
    {coverage?.length === 0 ? <p>Connect an email account to download its history.</p> : null}
    {error ? <p role="alert">{error} <button type="button" disabled={busy} onClick={() => setAttempt(value => value + 1)}>Retry body coverage</button></p> : null}
  </section>;
}
