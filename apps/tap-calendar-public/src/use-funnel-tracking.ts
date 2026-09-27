import { useEffect, useRef } from "react";
import { PublicCalendarApiError, trackPublicBookingFunnel } from "./api";
import { createFunnelTracker, type FunnelStage } from "./funnel-tracker";

export function useFunnelTracking(profileSlug: string, eventTypeSlug: string, visitId: string, step: string) {
  const tracker = useRef<ReturnType<typeof createFunnelTracker> | null>(null);
  useEffect(() => {
    const current = createFunnelTracker({
      send: stage => trackPublicBookingFunnel({ profileSlug, eventTypeSlug, visitId, stage }),
      retryable: error => !(error instanceof PublicCalendarApiError) || error.retryable || error.status === 429,
      onFailure: () => console.warn("Public booking analytics delivery failed; it will retry on reconnection."),
    });
    tracker.current = current;
    const resume = () => current.resume();
    globalThis.addEventListener("online", resume);
    globalThis.addEventListener("pagehide", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      current.stop();
      tracker.current = null;
      globalThis.removeEventListener("online", resume);
      globalThis.removeEventListener("pagehide", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [profileSlug, eventTypeSlug, visitId]);
  useEffect(() => {
    const stage: FunnelStage = step === "details" || step === "success" ? "starts"
      : step === "slot" ? "slotViews" : "views";
    tracker.current?.record(stage);
  }, [profileSlug, eventTypeSlug, visitId, step]);
}
