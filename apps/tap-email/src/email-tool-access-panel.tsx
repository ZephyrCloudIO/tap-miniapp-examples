import React, { useEffect, useMemo, useState } from 'react';
import { createCoordinatorClient, type EmailToolAccess } from './coordinator-client';
import type { MailSenderContext } from '@tap-examples/tap-email-protocol';

type Client = Pick<ReturnType<typeof createCoordinatorClient>, 'getEmailToolAccess' | 'createEmailToolAccess' | 'revokeEmailToolAccess'>;

export function EmailToolAccessPanel({ client: suppliedClient, senderContext, openSettings }: {
  readonly client?: Client; readonly senderContext?: MailSenderContext; readonly openSettings?: () => Promise<void>;
}) {
  const client = useMemo(() => suppliedClient ?? createCoordinatorClient(), [suppliedClient]);
  const [access, setAccess] = useState<EmailToolAccess | null>(null);
  const [token, setToken] = useState('');
  const [allowWrites, setAllowWrites] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError('');
    void client.getEmailToolAccess().then(value => {
      if (active) {
        setAccess(value);
        setAllowWrites(value.scopes.includes('email.write'));
      }
    })
      .catch(() => { if (active) setError('Could not load Email tool access.'); });
    return () => { active = false; };
  }, [client, loadAttempt]);
  const refresh = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try { setAccess(await client.getEmailToolAccess()); }
    catch { setError('Could not verify tool access. Check the mail connection and retry.'); }
    finally { setBusy(false); }
  };
  const changeAccess = async (revoke: boolean) => {
    if (busy) return;
    setBusy(true); setError(''); setToken('');
    try {
      if (revoke) {
        await client.revokeEmailToolAccess();
        setAccess({ connected: false, scopes: [], expiresAt: null });
      } else {
        if (allowWrites && !senderContext) {
          setError('Open Email in a workspace before enabling sending and draft saves.');
          return;
        }
        const result = await client.createEmailToolAccess(allowWrites, senderContext);
        setAccess(result); setToken(result.token);
      }
    } catch { setError('Email tool access could not be changed. Try again.'); }
    finally { setBusy(false); }
  };
  return <section className="storage-privacy-panel" aria-labelledby="email-tools-title">
    <h3 id="email-tools-title">Chloe &amp; Email tools</h3>
    <p>Let Chloe find and read email from your connected accounts. Activity counts are shared separately through TAP’s activity registry.</p>
    <ol>
      <li>Create a connection token below. Read access covers all email accounts connected to your TAP profile.</li>
      <li>Copy the token before leaving this screen. In TAP’s Email MCP connection settings, save it as <strong>tap-email-access-token</strong> for <strong>TAP Email Live</strong>.</li>
      <li>Enable Email tools and the <strong>email-operations</strong> skill for Chloe. Ask Chloe to list your connected email accounts, then refresh verification here.</li>
    </ol>
    <label><input type="checkbox" name="email-tool-write-access" checked={allowWrites} disabled={busy || !access} onChange={event => setAllowWrites(event.target.checked)} /> Also allow sending email and saving drafts when I ask.</label>
    <p>Sending is attributed to the workspace where you create this token. Replace the token to change that workspace.</p>
    <p role="status">{!access ? 'Checking Email credential…' : access.connected
      ? access.verifiedAt ? `An authenticated Email tool read succeeded at ${new Date(access.verifiedAt).toLocaleString()}.`
        : 'Token created. A successful Email tool read has not been verified for this token.'
      : 'No active Email token. Create one to begin setup.'}</p>
    {access?.connected ? <p>Credential expires {new Date(access.expiresAt!).toLocaleDateString()}. {access.scopes.includes('email.write') ? 'Sending and draft saves enabled.' : 'Read access only.'} This receipt verifies tool access; it does not identify which specialist used it.</p> : null}
    <button type="button" disabled={busy || !access} onClick={() => void changeAccess(false)}>{access?.connected ? 'Replace connection token' : 'Create connection token'}</button>
    {access?.connected ? <button type="button" disabled={busy} onClick={() => void changeAccess(true)}>Revoke Email tool access</button> : null}
    {token ? <div>
      <p>The token is shown only here and expires in 30 days. Replacing it revokes the previous token and resets verification. Copy it before opening settings.</p>
      <label>Connection token<input aria-label="Email tool connection token" type="password" name="email-tool-connection-token" spellCheck={false} readOnly value={token} onFocus={event => event.currentTarget.select()} autoComplete="off" /></label>
      <button type="button" onClick={() => setToken('')}>Hide token</button>
    </div> : null}
    {openSettings ? <button type="button" disabled={busy} onClick={() => {
      void openSettings().catch(() => setError('Could not open TAP settings. Open Marketplace → Installed → TAP Email → MCP connections.'));
    }}>Open installed Email settings</button> : null}
    <button type="button" disabled={busy || !access} onClick={() => void refresh()}>Refresh tool verification</button>
    {error ? <p role="alert">{error}</p> : null}
    {error && !access ? <button type="button" onClick={() => setLoadAttempt(attempt => attempt + 1)}>Retry loading tool access</button> : null}
  </section>;
}
