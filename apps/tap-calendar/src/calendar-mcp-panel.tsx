import { useCallback, useEffect, useState } from "react";
import type { CalendarState } from "./domain";
import type { CalendarGatewayClient } from "./gateway";
import { calendarMcpConfiguration } from "./calendar-mcp-configuration";
import type { CalendarMcpConfiguration, CalendarMcpConsent, CalendarMcpGrant, CalendarMcpScope } from "./mcp-contract";

const permissionLabels: Record<CalendarMcpScope, string> = {
  "calendar.read": "Read calendars and individual events, including titles, times, locations, and attendees",
  "calendar.analytics": "Read aggregate calendar and Event Type analytics",
  "calendar.write": "Create events directly and send invitations to supplied attendees",
};

export function useCalendarMcpSync(gateway: CalendarGatewayClient, state: CalendarState | null, revision: number | null, enabled: boolean) {
  const configurationJson = state ? JSON.stringify(calendarMcpConfiguration(state)) : null;
  const [error, setError] = useState<string | null>(null);
  const sync = useCallback(async () => {
    if (!enabled || !configurationJson || revision === null) throw new Error("Load TAP Calendar in the desktop app before connecting a specialist.");
    await gateway.saveMcpConfiguration(revision, JSON.parse(configurationJson) as CalendarMcpConfiguration);
  }, [configurationJson, enabled, gateway, revision]);
  useEffect(() => {
    if (!enabled || !configurationJson || revision === null) return;
    let current = true;
    const refresh = () => { void sync().then(() => { if (current) setError(null); }, cause => { if (current) setError(cause instanceof Error ? cause.message : "Specialist settings could not synchronize."); }); };
    const timer = globalThis.setTimeout(refresh, 300);
    globalThis.addEventListener("focus", refresh);
    return () => { current = false; globalThis.clearTimeout(timer); globalThis.removeEventListener("focus", refresh); };
  }, [configurationJson, enabled, revision, sync]);
  return { sync, error };
}

export function CalendarMcpPanel({ gateway, authorize, configuration, preview }: {
  readonly gateway: CalendarGatewayClient;
  readonly authorize: () => Promise<unknown>;
  readonly configuration: ReturnType<typeof useCalendarMcpSync>;
  readonly preview: boolean;
}) {
  const [code, setCode] = useState("");
  const [consent, setConsent] = useState<CalendarMcpConsent | null>(null);
  const [scopes, setScopes] = useState<readonly CalendarMcpScope[]>([]);
  const [grants, setGrants] = useState<readonly CalendarMcpGrant[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => setGrants(await gateway.listMcpGrants()), [gateway]);
  useEffect(() => {
    if (preview) return;
    let current = true;
    void gateway.listMcpGrants().then(value => { if (current) setGrants(value); }, cause => { if (current) setError(cause instanceof Error ? cause.message : "Specialist connections could not be loaded."); });
    return () => { current = false; };
  }, [gateway, preview]);
  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError(null); setMessage(null);
    try { await operation(); } catch (cause) { setError(cause instanceof Error ? cause.message : "The specialist connection could not be updated."); } finally { setBusy(false); }
  };
  return <section className="panel calendar-mcp-panel" aria-labelledby="calendar-mcp-title">
    <div className="section-heading"><div><span className="eyebrow">Live specialist connection</span><h2 id="calendar-mcp-title">Calendar access for Chloe</h2><p>Read events, compare Event Types, and create meetings while Calendar is closed.</p></div><span className={`status-chip ${grants?.length ? "status-confirmed" : "status-pending"}`}>{preview ? "Desktop setup required" : grants === null ? "Checking connection" : grants.length ? "Account access granted" : "Not connected"}</span></div>
    <p>In TAP’s specialist tools settings, select <strong>Calendar live tools</strong> for Chloe and connect your account. Return here with the code shown by the connection page.</p>
    <p>Access applies to all calendars connected to this TAP account. Free/busy calendars and private Work Blocks keep their details hidden. Analytics report scheduled time and booking activity.</p>
    {configuration.error || error ? <p role="alert" className="form-error">{error ?? configuration.error}</p> : null}
    {message ? <p role="status">{message}</p> : null}
    <form className="schedule-form" aria-busy={busy} onSubmit={event => { event.preventDefault(); void run(async () => { await authorize(); await configuration.sync(); const review = await gateway.reviewMcpAuthorization(code.trim()); setConsent(review); setScopes(review.scopes); }); }}>
      <label className="field"><span>Connection code</span><input value={code} placeholder="0000-0000-0000-0000" maxLength={19} required autoComplete="off" disabled={preview || busy || consent !== null} onChange={event => setCode(event.currentTarget.value)} /></label>
      {!consent ? <button type="submit" className="secondary-button" disabled={preview || busy || !code.trim()}>Review connection</button> : null}
    </form>
    {consent ? <div className="calendar-mcp-consent">
      <h3>Allow {consent.clientName} to use Calendar?</h3><p>Returns to <code>{consent.redirectOrigin}</code>. Only approve a connection you started.</p>
      <fieldset disabled={busy}><legend>Permissions for this connection</legend>{consent.scopes.map(scope => <label className="calendar-mcp-permission" key={scope}><input type="checkbox" checked={scopes.includes(scope)} onChange={event => { const checked = event.currentTarget.checked; setScopes(current => checked ? [...current, scope] : current.filter(item => item !== scope)); }} /><span>{permissionLabels[scope]}</span></label>)}</fieldset>
      <div className="dialog-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => { setConsent(null); setScopes([]); }}>Cancel</button><button type="button" className="primary-button" disabled={busy || !scopes.length} onClick={() => void run(async () => { await authorize(); await configuration.sync(); await gateway.approveMcpAuthorization(code.trim(), scopes); setConsent(null); setCode(""); setScopes([]); await refresh(); setMessage("Account access approved. Return to the connection page to finish connecting Chloe."); })}>Grant selected access</button></div>
    </div> : null}
    <h3>Account connections</h3>
    {preview ? <p>Open Calendar in TAP to connect or revoke specialist access.</p> : null}
    {grants?.length === 0 ? <p>No specialist account connections yet.</p> : null}
    {grants?.map(grant => <div className="calendar-mcp-grant" key={grant.id}><div><strong>{grant.clientName}</strong><ul>{grant.scopes.map(scope => <li key={scope}>{permissionLabels[scope]}</li>)}</ul></div><button type="button" className="secondary-button" disabled={busy} onClick={() => void run(async () => { await authorize(); await gateway.revokeMcpGrant(grant.id); await refresh(); setMessage("Calendar access revoked. This connection can no longer call calendar tools."); })}>Revoke access</button></div>)}
    {!preview ? <button type="button" className="text-button" disabled={busy} onClick={() => void run(async () => { await configuration.sync(); await refresh(); })}>Refresh connection status</button> : null}
  </section>;
}
