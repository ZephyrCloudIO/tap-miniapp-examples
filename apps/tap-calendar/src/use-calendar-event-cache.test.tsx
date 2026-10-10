// @rstest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { CalendarGatewayClient, CalendarGatewayEventQueryResult } from "./gateway";
import {
  CALENDAR_EVENT_FOLLOW_UP_DELAY_MS,
  useCalendarEventCache,
  type CalendarEventCacheResult,
} from "./use-calendar-event-cache";

const anchor = "2026-08-12";
let root: Root;
let container: HTMLDivElement;
let latest: CalendarEventCacheResult;
let serverFresh: boolean;
const calls: { readonly mode: string | undefined; readonly timeMin: string }[] = [];

const gateway = {
  principalId: "user-1",
  async queryEvents(query: { timeMin: string; timeMax: string; calendarIds: readonly string[]; revalidate?: "wait" | "background" }) {
    calls.push({ mode: query.revalidate, timeMin: query.timeMin });
    const now = new Date().toISOString();
    const result: CalendarGatewayEventQueryResult = {
      timeMin: query.timeMin,
      timeMax: query.timeMax,
      syncedAt: now,
      events: [{
        id: `event-${query.timeMin}`, calendarId: "cal-1", title: "Standup",
        start: new Date(Date.parse(query.timeMin) + 86_400_000).toISOString(),
        end: new Date(Date.parse(query.timeMin) + 86_400_000 + 1_800_000).toISOString(),
        kind: "meeting", status: "confirmed", location: null, attendees: [],
      }],
      // Background reads serve the gateway's D1 copy; wait reads sync first.
      syncedCalendarIds: query.revalidate === "wait" ? ["cal-1"] : [],
      servedCalendarIds: ["cal-1"],
      errors: [],
      truncated: false,
      cache: { servedAt: now, calendars: [{
        calendarId: "cal-1", cacheRevision: 1, freshness: serverFresh ? "fresh" : "stale",
        lastSuccessAt: now, nextSyncAt: now, error: null,
      }] },
    };
    return result;
  },
} as unknown as CalendarGatewayClient;

function Harness({ anchorDate }: { readonly anchorDate: string }) {
  latest = useCalendarEventCache({
    preview: true, principalId: "user-1", gateway,
    calendarIds: ["cal-1"], view: "week", anchorDate,
  });
  return null;
}

const render = async (anchorDate: string) => {
  await act(async () => { root.render(<Harness anchorDate={anchorDate} />); });
  await act(async () => { await rs.advanceTimersByTimeAsync(0); });
};
const advance = async (ms: number) => {
  await act(async () => { await rs.advanceTimersByTimeAsync(ms); });
};

beforeEach(() => {
  rs.useFakeTimers();
  rs.setSystemTime(new Date("2026-08-12T15:00:00.000Z"));
  rs.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  globalThis.localStorage.clear();
  calls.length = 0;
  serverFresh = false;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  rs.useRealTimers();
  rs.unstubAllGlobals();
});

describe("calendar event cache request policy", () => {
  it("loads the visible range without blocking on provider sync, then collects the server refresh once", async () => {
    await render(anchor);
    expect(calls.map(call => call.mode)).toEqual(["background", "background", "background"]);
    // The visible week is requested before either prefetched neighbor.
    expect(calls[0]!.timeMin).toBe("2026-08-09T00:00:00.000Z");
    expect(latest.events).toHaveLength(1);
    expect(latest.syncState.status).toBe("syncing");

    serverFresh = true;
    await advance(CALENDAR_EVENT_FOLLOW_UP_DELAY_MS);
    expect(calls).toHaveLength(4);
    expect(calls[3]).toEqual({ mode: "background", timeMin: "2026-08-09T00:00:00.000Z" });
    expect(latest.syncState.status).toBe("ready");
    expect(latest.hasCompleteCoverage).toBe(true);

    await advance(CALENDAR_EVENT_FOLLOW_UP_DELAY_MS * 2);
    expect(calls).toHaveLength(4);
  });

  it("shows a recently fetched range again without another request", async () => {
    serverFresh = true;
    await render(anchor);
    const afterFirstLoad = calls.length;
    await render("2026-08-19");
    const afterNext = calls.length;
    expect(afterNext).toBeGreaterThan(afterFirstLoad);
    await render(anchor);
    expect(calls).toHaveLength(afterNext);
    expect(latest.events).toHaveLength(1);
  });

  it("uses wait mode only for an explicit refresh", async () => {
    serverFresh = true;
    await render(anchor);
    calls.length = 0;
    await act(async () => { latest.refresh(); await rs.advanceTimersByTimeAsync(0); });
    expect(calls[0]).toEqual({ mode: "wait", timeMin: "2026-08-09T00:00:00.000Z" });
    expect(calls.slice(1).every(call => call.mode === "background")).toBe(true);
  });
});
