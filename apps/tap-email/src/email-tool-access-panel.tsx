import React, { useEffect, useMemo, useState } from 'react';
import { createCoordinatorClient, type EmailToolAccess } from './coordinator-client';
import type { MailSenderContext } from '@tap-examples/tap-email-protocol';

type Client = Pick<ReturnType<typeof createCoordinatorClient>, 'getEmailToolAccess' | 'createEmailToolAccess' | 'revokeEmailToolAccess'>;

export function EmailToolAccessPanel({ client: suppliedClient, senderContext }: { readonly client?: Client; readonly senderContext?: MailSenderContext }) {
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
    <label><input type="checkbox" checked={allowWrites} disabled={busy || !access} onChange={event => setAllowWrites(event.target.checked)} /> Also allow sending email and saving drafts when I ask.</label>
    <p>Sending is attributed to the workspace where you create this token. Replace the token to change that workspace.</p>
    <p>{access?.connected ? `Credential expires ${new Date(access.expiresAt!).toLocaleDateString()}. ${access.scopes.includes('email.write') ? 'Sending and draft saves enabled.' : 'Read access only.'}` : 'Email tools are not connected.'}</p>
    <button type="button" disabled={busy || !access} onClick={() => void changeAccess(false)}>{access?.connected ? 'Replace connection token' : 'Create connection token'}</button>
    {access?.connected ? <button type="button" disabled={busy} onClick={() => void changeAccess(true)}>Revoke Email tool access</button> : null}
    {token ? <div>
      <p>In TAP’s installed Email MCP settings, save this token as the <strong>tap-email-access-token</strong> credential and grant Chloe access to Email tools and the email-operations skill. The token is shown only here and expires in 30 days. Replacing it revokes the previous token.</p>
      <label>Connection token<input aria-label="Email tool connection token" type="password" readOnly value={token} onFocus={event => event.currentTarget.select()} autoComplete="off" /></label>
      <button type="button" onClick={() => setToken('')}>Hide token</button>
    </div> : null}
    {error ? <p role="alert">{error}</p> : null}
    {error && !access ? <button type="button" onClick={() => setLoadAttempt(attempt => attempt + 1)}>Retry loading tool access</button> : null}
  </section>;
}
