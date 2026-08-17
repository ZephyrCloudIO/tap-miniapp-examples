import { ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const TURNSTILE_SCRIPT_ID = "tap-calendar-turnstile";
const TURNSTILE_SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export type PublicTurnstileAction = "public_booking" | "public_booking_reschedule";

export const publicTurnstileWidgetConfiguration = (
  siteKey: string,
  action: PublicTurnstileAction,
): {
  readonly sitekey: string;
  readonly action: PublicTurnstileAction;
  readonly appearance: "always";
} => ({
  sitekey: siteKey,
  action,
  appearance: "always",
});

function loadTurnstileScript(): Promise<void> {
  if (globalThis.window.turnstile) return Promise.resolve();
  const existing = globalThis.document.getElementById(TURNSTILE_SCRIPT_ID) as HTMLScriptElement | null;
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Security verification could not load.")), { once: true });
    });
  }
  return new Promise((resolve, reject) => {
    const script = globalThis.document.createElement("script");
    script.id = TURNSTILE_SCRIPT_ID;
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error("Security verification could not load.")), { once: true });
    globalThis.document.head.append(script);
  });
}

export function TurnstileVerification({ siteKey, action, resetKey, disabled, onTokenChange }: {
  readonly siteKey: string;
  readonly action: PublicTurnstileAction;
  readonly resetKey: number;
  readonly disabled?: boolean;
  readonly onTokenChange: (token: string | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const callbackRef = useRef(onTokenChange);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  callbackRef.current = onTokenChange;

  useEffect(() => {
    if (disabled || siteKey.trim().length === 0) return;
    let cancelled = false;
    let widgetId: string | null = null;
    setStatus("loading");
    callbackRef.current(null);
    void loadTurnstileScript().then(() => {
      if (cancelled || !containerRef.current || !globalThis.window.turnstile) return;
      widgetId = globalThis.window.turnstile.render(containerRef.current, {
        ...publicTurnstileWidgetConfiguration(siteKey, action),
        callback(token) {
          setStatus("ready");
          callbackRef.current(token);
        },
        "error-callback"() {
          setStatus("error");
          callbackRef.current(null);
        },
        "expired-callback"() {
          setStatus("error");
          callbackRef.current(null);
        },
        "timeout-callback"() {
          setStatus("error");
          callbackRef.current(null);
        },
      });
    }).catch(() => {
      if (cancelled) return;
      setStatus("error");
      callbackRef.current(null);
    });
    return () => {
      cancelled = true;
      if (widgetId && globalThis.window.turnstile) globalThis.window.turnstile.remove(widgetId);
      callbackRef.current(null);
    };
  }, [action, disabled, resetKey, siteKey]);

  return (
    <div className="public-turnstile" data-status={status}>
      <div ref={containerRef} className="public-turnstile-widget" aria-label="Security verification" />
      {status === "loading" ? <p role="status"><ShieldCheck aria-hidden="true" /> Loading security verification…</p> : null}
      {status === "error" ? <p role="alert"><ShieldCheck aria-hidden="true" /> Security verification expired or could not load. Try again.</p> : null}
    </div>
  );
}
