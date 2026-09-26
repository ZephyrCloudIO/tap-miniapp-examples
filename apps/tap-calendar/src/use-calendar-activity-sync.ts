import { useEffect, useMemo, useState } from "react";
import { sdk, type MiniAppStorageApi } from "@theaiplatform/miniapp-sdk/sdk";
import { calendarActivityAddress, isCalendarActivityProjection, type CalendarActivityProjection } from "./activity-contract";
import { calendarPrincipalStorageAddresses } from "./principal-storage";
import { isCalendarState, type CalendarState } from "./domain";
import type { CalendarGatewayClient } from "./gateway";

export async function synchronizeCalendarActivity(gateway: Pick<CalendarGatewayClient, "principalId" | "activity" | "syncAvailabilityActivity">,
  workspaceId: string, storage: Pick<MiniAppStorageApi, "get" | "set">, acknowledged = new Set<string>()): Promise<void> {
  const stateAddress = calendarPrincipalStorageAddresses(gateway.principalId).state;
  const saved = await storage.get(stateAddress);
  if (!isCalendarState(saved.value) || !saved.value.activityJournal) throw new Error("Saved Calendar activity is not initialized.");
  const journal = saved.value.activityJournal;
  const currentIds = new Set(journal.entries.map(entry => entry.id));
  for (const id of acknowledged) if (!currentIds.has(id)) acknowledged.delete(id);
  const entries = journal.entries.filter(entry => entry.workspaceId === workspaceId && !acknowledged.has(entry.id));
  for (let index = 0; index < entries.length; index += 64) {
    const batch = entries.slice(index, index + 64);
    await gateway.syncAvailabilityActivity(batch.map(({ id, occurredAt }) => ({ id, occurredAt })));
    for (const entry of batch) acknowledged.add(entry.id);
  }
  const remote = await gateway.activity();
  if (remote.userId !== gateway.principalId || remote.workspaceId !== workspaceId) throw new Error("Calendar activity owner mismatch.");
  // A concurrent save may contain receipts this attempt has not sent yet.
  // Do not advance coverage past that save; the next attempt reads it afresh.
  const latest = await storage.get(stateAddress);
  if (latest.revision !== saved.revision) throw new Error("Calendar changed during activity synchronization. Retrying shortly.");
  const availableFrom = [remote.availableFrom, journal.startedAt, journal.droppedBefore ?? journal.startedAt].sort().at(-1)!;
  const projection: CalendarActivityProjection = { ...remote, availableFrom: availableFrom > remote.availableThrough ? remote.availableThrough : availableFrom };
  const address = calendarActivityAddress(gateway.principalId, workspaceId);
  for (let attempt = 0; attempt < 3; attempt++) {
    const previous = await storage.get(address);
    if (isCalendarActivityProjection(previous.value) && previous.value.availableThrough > projection.availableThrough) return;
    try {
      await storage.set({ ...address, expectedRevision: previous.revision, value: JSON.parse(JSON.stringify(projection)) });
      return;
    } catch (cause) { if (attempt === 2) throw cause; }
  }
}

export function useCalendarActivitySync(gateway: CalendarGatewayClient, workspaceId: string | undefined,
  state: CalendarState | null, enabled: boolean) {
  const [error, setError] = useState<string | null>(null);
  const acknowledged = useMemo(() => new Set<string>(), [gateway, workspaceId]);
  useEffect(() => {
    if (!enabled || !workspaceId || !state) return;
    let active = true, running = false;
    const refresh = () => {
      if (running || !active || globalThis.document.visibilityState === "hidden" || !globalThis.navigator.onLine) return;
      running = true;
      void synchronizeCalendarActivity(gateway, workspaceId, sdk.storage, acknowledged)
        .then(() => { if (active) setError(null); })
        .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "Activity is unavailable."); })
        .finally(() => { running = false; });
    };
    refresh();
    const timer = globalThis.setInterval(refresh, 30_000);
    globalThis.addEventListener("focus", refresh);
    globalThis.addEventListener("online", refresh);
    globalThis.document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      globalThis.clearInterval(timer);
      globalThis.removeEventListener("focus", refresh);
      globalThis.removeEventListener("online", refresh);
      globalThis.document.removeEventListener("visibilitychange", refresh);
    };
  }, [acknowledged, enabled, gateway, state, workspaceId]);
  return { error };
}
