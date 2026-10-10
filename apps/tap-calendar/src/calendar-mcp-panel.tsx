import { Bot, Check, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CalendarState } from "./domain";
import type { CalendarGatewayClient } from "./gateway";
import { calendarMcpConfiguration } from "./calendar-mcp-configuration";
import { CalendarMcpSync } from "./calendar-mcp-sync";
import type { CalendarMcpConfiguration, CalendarMcpConsent, CalendarMcpGrant, CalendarMcpScope } from "./mcp-contract";

const permissionLabels: Record<CalendarMcpScope, string> = {
  "calendar.read": "Read calendars and individual events, including titles, times, locations, and attendees",
  "calendar.analytics": "Read aggregate calendar and Event Type analytics",
  "calendar.write": "Create events directly and send invitations to supplied attendees",
};

export function useCalendarMcpSync(gateway: CalendarGatewayClient, state: CalendarState | null, revision: number | null, enabled: boolean) {
  const configurationJson = state ? JSON.stringify(calendarMcpConfiguration(state)) : null;
  const [error, setError] = useState<string | null>(null);
  const synchronizer = useMemo(() => new CalendarMcpSync(gateway), [gateway]);
  const sync = useCallback(async (replaceRemote = false) => {
    if (!enabled || !configurationJson || revision === null) throw new Error("Load TAP Calendar before connecting a specialist.");
    await synchronizer.sync(JSON.parse(configurationJson) as CalendarMcpConfiguration, replaceRemote);
    setError(null);
  }, [configurationJson, enabled, synchronizer, revision]);
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

interface AssistantCapability {
  readonly scope: CalendarMcpScope;
  readonly title: string;
  readonly tools: readonly { readonly name: string; readonly description: string }[];
}

const assistantCapabilities: readonly AssistantCapability[] = [
  {
    scope: "calendar.read",
    title: "Read your calendar",
    tools: [
      { name: "list_calendars", description: "See your calendars and which ones it can add events to." },
      { name: "list_events", description: "Read events in a date range." },
      { name: "get_event", description: "Open one event’s details." },
      { name: "find_available_slots", description: "Find free time across your Conflict Calendars." },
    ],
  },
  {
    scope: "calendar.analytics",
    title: "Analyze scheduling",
    tools: [
      { name: "list_event_types", description: "List your Event Types, durations, and approval settings." },
      { name: "calendar_analytics", description: "Total scheduled time by calendar, kind, or Event Type." },
      { name: "event_type_analytics", description: "Booking-page visits, requests, and confirmations." },
    ],
  },
  {
    scope: "calendar.write",
    title: "Create events",
    tools: [
      { name: "create_event", description: "Create meetings and Work Blocks and send invitations." },
    ],
  },
];

const scopeTitles: Record<CalendarMcpScope, string> = {
  "calendar.read": "Read",
  "calendar.analytics": "Analytics",
  "calendar.write": "Create events",
};

export function CalendarMcpPanel({ gateway, authorize, configuration, preview, activityError }: {
  readonly gateway: CalendarGatewayClient;
  readonly authorize: () => Promise<unknown>;
  readonly configuration: ReturnType<typeof useCalendarMcpSync>;
  readonly preview: boolean;
  readonly activityError?: string | null;
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
    void gateway.listMcpGrants().then(value => { if (current) setGrants(value); }, cause => { if (current) setError(cause instanceof Error ? cause.message : "Assistant connections could not be loaded."); });
    return () => { current = false; };
  }, [gateway, preview]);
  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError(null); setMessage(null);
    try { await operation(); } catch (cause) { setError(cause instanceof Error ? cause.message : "The assistant connection could not be updated."); } finally { setBusy(false); }
  };
  const grantedScopes = new Set(grants?.flatMap(grant => grant.scopes) ?? []);
  const connected = Boolean(grants?.length);
  const status = preview ? "Available in TAP" : grants === null && !error ? "Checking…" : connected ? "Connected" : "Not connected";
  const connectForm = <form className="assistant-code-form" aria-busy={busy} onSubmit={event => { event.preventDefault(); void run(async () => { await authorize(); await configuration.sync(); const review = await gateway.reviewMcpAuthorization(code.trim()); setConsent(review); setScopes(review.scopes); }); }}>
    <label className="field"><span className="visually-hidden">Connection code</span><input name="assistant-connection-code" aria-label="Connection code" value={code} placeholder="0000-0000-0000-0000" maxLength={19} required autoComplete="off" inputMode="numeric" disabled={preview || busy} onChange={event => setCode(event.currentTarget.value)} /></label>
    <button type="submit" className="primary-button" disabled={preview || busy || !code.trim()}>Review access</button>
  </form>;
  const steps = <ol className="assistant-steps">
    <li><span aria-hidden="true">1</span><div><strong>Turn on Calendar live tools</strong><p>In TAP, open Chloe’s specialist tools and select <b>Calendar live tools</b>.</p></div></li>
    <li><span aria-hidden="true">2</span><div><strong>Connect your account</strong><p>Follow the prompts. The connection page shows a 16-digit code.</p></div></li>
    <li><span aria-hidden="true">3</span><div><strong>Enter the code</strong>{preview ? <p>Open Calendar in TAP to connect an assistant.</p> : connectForm}</div></li>
  </ol>;
  return <section className="automation-section" aria-labelledby="calendar-mcp-title">
    <header className="automation-section-header">
      <div>
        <h2 id="calendar-mcp-title">Assistant access</h2>
        <p>Let Chloe read your calendar and schedule meetings, even while Calendar is closed.</p>
      </div>
      <div className="automation-section-actions">
        <span className={`status-chip ${connected ? "status-confirmed" : "status-pending"}`}>{status}</span>
        {!preview ? <button type="button" className="icon-button" aria-label="Refresh connection status" title="Refresh connection status" disabled={busy} onClick={() => void run(async () => { await configuration.sync(); await refresh(); })}><RefreshCw aria-hidden="true" className={busy ? "is-spinning" : undefined} /></button> : null}
      </div>
    </header>
    {configuration.error || error ? <div className="automation-message is-error" role="alert">
      <p>{error ?? configuration.error}</p>
      {configuration.error && !preview ? <button type="button" className="secondary-button" disabled={busy} onClick={() => void run(async () => { await authorize(); await configuration.sync(true); setMessage("Shared assistant settings now match this device."); })}>Use this device’s settings</button> : null}
    </div> : null}
    {activityError ? <p className="automation-message" role="status">Calendar activity is waiting to sync: {activityError}</p> : null}
    {message ? <p className="automation-message" role="status">{message}</p> : null}
    {consent ? <div className="assistant-consent">
      <h3>Allow {consent.clientName} to use Calendar?</h3>
      <p>After you approve, you’ll return to <code>{consent.redirectOrigin}</code>. Only approve a connection you started.</p>
      <fieldset disabled={busy}><legend>Permissions</legend>{consent.scopes.map(scope => <label className="calendar-mcp-permission" key={scope}><input type="checkbox" checked={scopes.includes(scope)} onChange={event => { const checked = event.currentTarget.checked; setScopes(current => checked ? [...current, scope] : current.filter(item => item !== scope)); }} /><span>{permissionLabels[scope]}</span></label>)}</fieldset>
      <div className="dialog-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => { setConsent(null); setScopes([]); }}>Cancel</button><button type="button" className="primary-button" disabled={busy || !scopes.length} onClick={() => void run(async () => { await authorize(); await configuration.sync(); await gateway.approveMcpAuthorization(code.trim(), scopes); setConsent(null); setCode(""); setScopes([]); await refresh(); setMessage("Access approved. Return to the connection page to finish connecting Chloe."); })}>Grant access</button></div>
    </div> : null}
    {connected ? <ul className="assistant-grants" aria-label="Connected assistants">
      {grants!.map(grant => <li key={grant.id}>
        <span className="assistant-grant-icon" aria-hidden="true"><Bot /></span>
        <div><strong>{grant.clientName}</strong><span>{grant.scopes.map(scope => scopeTitles[scope]).join(" · ")}</span></div>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void run(async () => { await authorize(); await gateway.revokeMcpGrant(grant.id); await refresh(); setMessage("Access revoked. This assistant can no longer use your calendar."); })}>Revoke</button>
      </li>)}
    </ul> : null}
    {!consent ? connected ? <details className="assistant-connect-another"><summary>Connect another assistant</summary>{steps}</details> : steps : null}
    <div className="assistant-capabilities" aria-label="What assistants can do">
      {assistantCapabilities.map(capability => {
        const granted = grantedScopes.has(capability.scope);
        return <section key={capability.scope} className={granted ? "is-granted" : undefined} aria-labelledby={`capability-${capability.scope}`}>
          <header>
            <h3 id={`capability-${capability.scope}`}>{capability.title}</h3>
            {connected ? <span>{granted ? <><Check aria-hidden="true" /> Allowed</> : "Not allowed"}</span> : null}
          </header>
          <ul>{capability.tools.map(tool => <li key={tool.name}><code>{tool.name}</code><span>{tool.description}</span></li>)}</ul>
        </section>;
      })}
    </div>
    <p className="automation-footnote">Free/busy calendars and private Work Blocks stay hidden from assistants. You can revoke access at any time.</p>
  </section>;
}
