import { useCallback, useEffect, useState } from "react";
import type { CalendarGatewayClient } from "./gateway";
import type { PublicBookingAnalytics } from "./public-booking-analytics";

export function usePublicBookingAnalytics(gateway: CalendarGatewayClient, enabled: boolean) {
  const [snapshot, setSnapshot] = useState<{
    readonly gateway: CalendarGatewayClient;
    readonly data: PublicBookingAnalytics;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const refresh = useCallback(() => setAttempt(value => value + 1), []);

  useEffect(() => {
    setLoading(false);
    setError(null);
    if (!enabled) return;
    let active = true;
    let running = false;
    const load = async () => {
      if (navigator.onLine === false) {
        if (active) setError("Offline. Booking analytics cannot refresh.");
        return;
      }
      if (running || document.visibilityState === "hidden") return;
      running = true;
      setLoading(true);
      try {
        const data = await gateway.publicBookingAnalytics();
        if (active) {
          setSnapshot({ gateway, data });
          setError(null);
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Booking analytics could not be loaded.");
      } finally {
        running = false;
        if (active) setLoading(false);
      }
    };
    const catchUp = () => { void load(); };
    void load();
    const timer = globalThis.setInterval(catchUp, 60_000);
    globalThis.addEventListener("focus", catchUp);
    globalThis.addEventListener("online", catchUp);
    globalThis.addEventListener("offline", catchUp);
    document.addEventListener("visibilitychange", catchUp);
    return () => {
      active = false;
      globalThis.clearInterval(timer);
      globalThis.removeEventListener("focus", catchUp);
      globalThis.removeEventListener("online", catchUp);
      globalThis.removeEventListener("offline", catchUp);
      document.removeEventListener("visibilitychange", catchUp);
    };
  }, [gateway, enabled, attempt]);

  return { data: snapshot?.gateway === gateway ? snapshot.data : null, error, loading, refresh };
}
