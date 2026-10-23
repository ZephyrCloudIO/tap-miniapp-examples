import { AlertTriangle, CheckCircle2, Contact } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  CalendarGatewayError,
  type CalendarGatewayClient,
  type CalendarGatewayCrmConnection,
  type CalendarGatewayCrmConnectionStatus,
  type CalendarGatewayCrmTestReason,
} from "./gateway";
import "./crm-connection-panel.css";

type CrmStatusState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly value: CalendarGatewayCrmConnectionStatus };

type CrmBusy = "test" | "connect" | "disconnect";
type CrmFeedback = { readonly kind: "ok" | "error"; readonly text: string };

const crmReasonMessages: Record<CalendarGatewayCrmTestReason, string> = {
  invalid_key: "The CRM didn't accept this bot key. Check the key and try again.",
  missing_scope: "This key is missing the contacts.write scope. Use the CRM's Lead writer preset.",
  unreachable: "TAP Calendar couldn't reach the CRM at this URL.",
  rejected: "The CRM rejected the request. Check the URL and key and try again.",
};

// Gateway messages are never shown here so nothing derived from the submitted key can reach the page.
const crmErrorMessage = (cause: unknown): string =>
  cause instanceof CalendarGatewayError && cause.status === 403
    ? "Only workspace admins can change the CRM connection."
    : "TAP Calendar couldn't reach the CRM connection service. Try again.";

const formatCrmTime = (value: string | null): string =>
  value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Never";

const crmStatusLabel = (connection: CalendarGatewayCrmConnection | null): string =>
  connection?.status === "connected" ? "Connected" : connection ? "Needs attention" : "Not connected";

export function CrmConnectionPanel({ gateway, authorize, announce }: {
  readonly gateway: CalendarGatewayClient;
  readonly authorize: () => Promise<unknown>;
  readonly announce: (message: string) => void;
}) {
  const [state, setState] = useState<CrmStatusState>({ status: "loading" });
  const [botKey, setBotKey] = useState("");
  const [busy, setBusy] = useState<CrmBusy | null>(null);
  const [feedback, setFeedback] = useState<CrmFeedback | null>(null);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);

  useEffect(() => {
    let current = true;
    void gateway.readCrmConnection().then(value => {
      if (!current) return;
      setState({ status: "ready", value });
    }, cause => {
      // A gateway without the CRM routes simply has nothing to show.
      if (current) setState(cause instanceof CalendarGatewayError && cause.status === 404
        ? { status: "loading" }
        : { status: "error", message: "TAP Calendar couldn't check the CRM connection." });
    });
    return () => { current = false; };
  }, [gateway]);

  if (state.status === "loading") return null;
  if (state.status === "error") return <CrmShell><p className="crm-connection-message is-error" role="alert">{state.message}</p></CrmShell>;
  const { enabled, canManage, connection } = state.value;
  if (!enabled) return null;

  const run = async (kind: CrmBusy, operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(kind);
    setFeedback(null);
    try {
      await authorize();
      await operation();
    } catch (cause) {
      setFeedback({ kind: "error", text: crmErrorMessage(cause) });
    } finally {
      setBusy(null);
    }
  };
  const outcome = (reason: CalendarGatewayCrmTestReason | null, success: string): CrmFeedback =>
    reason ? { kind: "error", text: crmReasonMessages[reason] } : { kind: "ok", text: success };
  const enteredKey = botKey.trim();

  const testEntered = () => run("test", async () => {
    const result = await gateway.testCrmConnection({ botKey: enteredKey });
    setFeedback(outcome(result.reason, "Connected. The CRM accepted this key."));
  });
  const testStored = () => run("test", async () => {
    const result = await gateway.testCrmConnection({});
    setFeedback(outcome(result.reason, "Connected. The CRM accepted the stored key."));
    setState({ status: "ready", value: await gateway.readCrmConnection() });
  });
  const connect = (event: FormEvent) => {
    event.preventDefault();
    if (!enteredKey) return;
    void run("connect", async () => {
      const key = enteredKey;
      setBotKey("");
      const result = await gateway.connectCrm({ botKey: key });
      if (result.ok) {
        setState({ status: "ready", value: { ...state.value, connection: result.connection } });
        setFeedback({ kind: "ok", text: "Connected to the CRM." });
        announce("CRM connected.");
      } else setFeedback(outcome(result.reason, ""));
    });
  };
  const disconnect = () => run("disconnect", async () => {
    await gateway.disconnectCrm();
    setConfirmingDisconnect(false);
    setState({ status: "ready", value: { ...state.value, connection: null } });
    announce("CRM disconnected.");
  });

  const statusClass = connection?.status === "connected" ? "status-confirmed" : connection ? "status-declined" : "status-pending";
  const showForm = canManage && connection?.status !== "connected";
  return (
    <CrmShell>
      <div className="meeting-provider-row crm-connection-row">
        <span className="provider-icon"><Contact /></span>
        <span className="meeting-provider-copy">
          <strong>CRM</strong>
          <small>{connection ? connection.apiUrl : "Connect your CRM to send bookings from booking pages to it."}</small>
        </span>
        <span className={`status-chip ${statusClass}`}>{connection?.status === "connected" ? <CheckCircle2 /> : connection ? <AlertTriangle /> : null}{crmStatusLabel(connection)}</span>
      </div>
      {connection ? (
        <dl className="crm-connection-details">
          {connection.status === "attention" ? <div className="crm-connection-attention"><dt>Needs attention</dt><dd>{connection.reason ? crmReasonMessages[connection.reason] : "The CRM connection stopped working."}{canManage ? " Reconnect with a new bot key." : ""}</dd></div> : null}
          <div><dt>Last delivered</dt><dd>{formatCrmTime(connection.lastDeliveredAt)}</dd></div>
          <div><dt>Pending</dt><dd>{connection.pendingDeliveries}</dd></div>
        </dl>
      ) : null}
      {!canManage ? <small className="crm-connection-note">Only workspace admins can change the CRM connection.</small> : null}
      {showForm ? (
        <form className="crm-connection-form" aria-busy={busy !== null} onSubmit={connect}>
          <label className="field"><span>Bot key</span><input name="crm-bot-key" type="password" value={botKey} autoComplete="off" disabled={busy !== null} onChange={event => setBotKey(event.currentTarget.value)} /></label>
          <div className="crm-connection-actions">
            <button type="button" className="secondary-button" disabled={busy !== null || !enteredKey} onClick={() => void testEntered()}>Test</button>
            <button type="submit" className="primary-button" disabled={busy !== null || !enteredKey}>{connection ? "Reconnect" : "Connect"}</button>
          </div>
        </form>
      ) : null}
      {connection && canManage ? (
        <div className="crm-connection-actions">
          {confirmingDisconnect ? (
            <>
              <small>Disconnect from the CRM? The stored key is deleted and bookings waiting to be sent are discarded.</small>
              <button type="button" className="secondary-button" disabled={busy !== null} onClick={() => setConfirmingDisconnect(false)}>Cancel</button>
              <button type="button" className="danger-button" disabled={busy !== null} onClick={() => void disconnect()}>Confirm disconnect</button>
            </>
          ) : (
            <>
              <button type="button" className="secondary-button" disabled={busy !== null} onClick={() => void testStored()}>Test</button>
              <button type="button" className="secondary-button" disabled={busy !== null} onClick={() => setConfirmingDisconnect(true)}>Disconnect</button>
            </>
          )}
        </div>
      ) : null}
      {feedback ? <p className={`crm-connection-message${feedback.kind === "error" ? " is-error" : ""}`} role={feedback.kind === "error" ? "alert" : "status"}>{feedback.text}</p> : null}
    </CrmShell>
  );
}

function CrmShell({ children }: { readonly children: ReactNode }) {
  return (
    <div className="meeting-provider-settings crm-connection" aria-labelledby="crm-connection-title">
      <header>
        <div>
          <span className="eyebrow">Integrations</span>
          <h3 id="crm-connection-title">Connect to CRM</h3>
          <p>Send people who book with you to your CRM as new leads.</p>
        </div>
      </header>
      {children}
    </div>
  );
}
