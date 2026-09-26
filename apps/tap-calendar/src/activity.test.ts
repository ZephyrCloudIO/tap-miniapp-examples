import { afterEach, describe, expect, it, rs } from "@rstest/core";
import type { ActivitySourceRequest } from "@theaiplatform/miniapp-sdk/activity";
import type { MiniAppStorageApi } from "@theaiplatform/miniapp-sdk/sdk";
import { calendarActivityAddress, calendarActivityTypes, isCalendarActivityProjection, type CalendarActivityProjection } from "./activity-contract";
import { appendAvailabilityActivity } from "./activity-journal";
import { createCalendarActivitySource } from "./activity-source-runtime";
import { synchronizeCalendarActivity } from "./use-calendar-activity-sync";
import { createInitialCalendarState } from "./test-fixtures";
import { loadCalendarState, saveCalendarState } from "./storage";

const started = "2026-09-25T10:00:00.000Z";
const occurred = "2026-09-25T10:15:00.000Z";
const through = "2026-09-25T11:00:00.000Z";
const receiptId = "11111111-1111-4111-8111-111111111111";
const projection: CalendarActivityProjection = { schemaVersion: 1, userId: "user-1", workspaceId: "workspace-1",
  availableFrom: started, availableThrough: through,
  entries: calendarActivityTypes.flatMap(type => type.statuses.map(statusId => ({activityId: type.id, statusId, occurredAt: occurred}))) };
const request: ActivitySourceRequest = { scope: "self", sourceId: "tap-calendar-committed-actions", userId: "user-1", workspaceId: "workspace-1",
  startAt: started, endAtExclusive: through, packageId: "package-1", installationId: "installation-1", releaseId: "release-1", consumerSpecialistId: "chloe" };
const savedState = () => {
  const state = createInitialCalendarState();
  return { ...state, bookingRequests: [], notificationChannels: state.notificationChannels.map(channel => ({
    ...channel, entries: channel.entries.filter(entry => entry.bookingRequestId === undefined),
  })) };
};
const json = (value: unknown) => JSON.parse(JSON.stringify(value));
const SDK_SLOT = Symbol.for("tap.internal.v1");
afterEach(() => { Reflect.deleteProperty(globalThis, SDK_SLOT); });

describe("Calendar committed activity source", () => {
  it("returns every registered type/status as content-free counts with half-open ranges", async () => {
    const get = rs.fn(async () => ({ revision: 1, value: json(projection) }));
    const source = createCalendarActivitySource({ get });
    const result = await source.get(request);
    expect(result.coverage).toBe("complete");
    expect(result.activities).toHaveLength(12);
    expect(new Set(result.activities.map(entry => entry.activityId)).size).toBe(8);
    expect(result.activities.every(entry => entry.value === 1 && entry.unit === "count")).toBe(true);
    expect(get).toHaveBeenCalledWith(calendarActivityAddress("user-1", "workspace-1"));
    const excluded = await source.get({ ...request, endAtExclusive: occurred });
    expect(excluded.activities.every(entry => entry.value === 0)).toBe(true);
    const included = await source.get({ ...request, startAt: occurred });
    expect(included.activities.every(entry => entry.value === 1)).toBe(true);
  });
  it("reports partial history instead of claiming older or unsynchronized time is complete", async () => {
    const source = createCalendarActivitySource({ get: async () => ({ revision: 1, value: json(projection) }) });
    expect((await source.get({ ...request, startAt: "2026-09-24T00:00:00.000Z" })).coverage).toBe("partial");
    expect((await source.get({ ...request, endAtExclusive: "2026-09-26T00:00:00.000Z" })).coverage).toBe("partial");
  });
  it("rejects missing, malformed, or another owner's projections and untrusted scope", async () => {
    for (const value of [null, {}, { ...projection, userId: "peer" }, { ...projection, workspaceId: "other" },
      { ...projection, entries: [{ ...projection.entries[0], title: "Private meeting" }] }]) {
      const source = createCalendarActivitySource({ get: async () => ({ revision: 1, value: json(value) }) });
      await expect(source.get(request)).rejects.toThrow();
    }
    const source = createCalendarActivitySource({ get: async () => ({ revision: 1, value: json(projection) }) });
    await expect(source.get({ ...request, scope: "workspace" })).rejects.toThrow();
    await expect(source.get({ ...request, sourceId: "other" })).rejects.toThrow();
    await expect(source.get({ ...request, endAtExclusive: started })).rejects.toThrow();
    expect(isCalendarActivityProjection(projection)).toBe(true);
  });
});

describe("availability activity journal", () => {
  const initial = () => ({ ...savedState(), activityJournal: { startedAt: started, droppedBefore: null, entries: [] } });
  it("records real policy edits, but ignores views, names, analytics, and publication receipts", () => {
    const state = initial();
    const rename = { ...state, availability: state.availability.map(schedule => ({ ...schedule, name: "New label" })) };
    expect(appendAvailabilityActivity(state, rename, "workspace-1", occurred, receiptId).activityJournal!.entries).toHaveLength(0);
    const edit = { ...state, availability: state.availability.map(schedule => ({ ...schedule, bufferBeforeMinutes: 15 })) };
    const saved = appendAvailabilityActivity(state, edit, "workspace-1", occurred, receiptId);
    expect(saved.activityJournal!.entries).toEqual([{ id: receiptId, workspaceId: "workspace-1", occurredAt: occurred }]);
    expect(appendAvailabilityActivity(saved, saved, "workspace-1", through).activityJournal!.entries).toHaveLength(1);
    const policy = { ...state, bookingProfiles: state.bookingProfiles.map(profile => ({ ...profile, eventTypes: profile.eventTypes.map(event => ({ ...event, approvalRequired: !event.approvalRequired })) })) };
    expect(appendAvailabilityActivity(state, policy, "workspace-1", occurred).activityJournal!.entries).toHaveLength(1);
  });
  it("bounds history and moves coverage beyond a dropped receipt", () => {
    const state = initial();
    const full = { ...state, activityJournal: { ...state.activityJournal, entries: Array.from({ length: 512 }, () => ({ id: receiptId, workspaceId: "workspace-1", occurredAt: occurred })) } };
    const next = appendAvailabilityActivity(full, { ...full, availability: [] }, "workspace-1", through);
    expect(next.activityJournal!.entries).toHaveLength(512);
    expect(next.activityJournal!.droppedBefore).toBe("2026-09-25T10:15:00.001Z");
  });
  it("never commits a receipt after a failed state save, and preserves a competing initialization", async () => {
    const state = initial();
    const set = rs.fn(async () => { throw new Error("conflict"); });
    Reflect.set(globalThis, SDK_SLOT, { storage: { get: async () => ({ value: json(state), revision: 3 }), set } });
    await expect(saveCalendarState(appendAvailabilityActivity(state, { ...state, availability: [] }, "workspace-1"), false, 2, "user-1")).rejects.toThrow("conflict");
    expect(state.activityJournal.entries).toHaveLength(0);
    let reads = 0;
    const get = async () => ++reads === 1 ? { value: json(savedState()), revision: 2 } : { value: json(state), revision: 3 };
    Reflect.set(globalThis, SDK_SLOT, { storage: { get, set } });
    expect((await loadCalendarState(false, "user-1")).revision).toBe(3);
  });
  it("does not overwrite malformed stored state", async () => {
    const set = rs.fn();
    Reflect.set(globalThis, SDK_SLOT, { storage: { get: async () => ({ value: { broken: true }, revision: 3 }), set } });
    await expect(loadCalendarState(false, "user-1")).rejects.toThrow("not been overwritten");
    expect(set).not.toHaveBeenCalled();
  });
});

describe("gateway activity synchronization", () => {
  function harness() {
    const state = { ...savedState(), activityJournal: { startedAt: started, droppedBefore: null,
      entries: [{ id: receiptId, workspaceId: "workspace-1", occurredAt: occurred }, { id: crypto.randomUUID(), workspaceId: "other", occurredAt: occurred }] } };
    let savedRevision = 1;
    let mirror: unknown = null;
    const set = rs.fn(async (input: Parameters<MiniAppStorageApi["set"]>[0]) => { mirror = input.value; return { revision: 1 }; });
    const storage = { get: async (address: { key: string }) => address.key.endsWith("calendar-state/v2")
      ? { value: json(state), revision: savedRevision } : { value: json(mirror), revision: mirror ? 1 : null }, set };
    const gateway = { principalId: "user-1", syncAvailabilityActivity: rs.fn(async () => {}), activity: rs.fn(async () => projection) };
    return { storage, gateway, set, setRevision: (value: number) => { savedRevision = value; }, setMirror: (value: unknown) => { mirror = value; } };
  }
  it("uploads saved self/workspace receipts before publishing coverage and retries mirror CAS", async () => {
    const h = harness();
    h.set.mockRejectedValueOnce(new Error("conflict"));
    await synchronizeCalendarActivity(h.gateway, "workspace-1", h.storage);
    expect(h.gateway.syncAvailabilityActivity).toHaveBeenCalledWith([{ id: receiptId, occurredAt: occurred }]);
    expect(h.set).toHaveBeenCalledTimes(2);
    expect(h.set).toHaveBeenLastCalledWith(expect.objectContaining({ value: projection }));
  });
  it("refreshes gateway activity without reuploading acknowledged receipts on every poll", async () => {
    const h = harness(); const acknowledged = new Set<string>();
    await synchronizeCalendarActivity(h.gateway, "workspace-1", h.storage, acknowledged);
    await synchronizeCalendarActivity(h.gateway, "workspace-1", h.storage, acknowledged);
    expect(h.gateway.syncAvailabilityActivity).toHaveBeenCalledTimes(1);
    expect(h.gateway.activity).toHaveBeenCalledTimes(2);
  });
  it("does not advance coverage on upload failure, concurrent edits, or a stale response", async () => {
    const failed = harness();
    failed.gateway.syncAvailabilityActivity.mockRejectedValueOnce(new Error("offline"));
    await expect(synchronizeCalendarActivity(failed.gateway, "workspace-1", failed.storage)).rejects.toThrow("offline");
    expect(failed.set).not.toHaveBeenCalled();
    const raced = harness();
    raced.gateway.activity.mockImplementation(async () => { raced.setRevision(2); return projection; });
    await expect(synchronizeCalendarActivity(raced.gateway, "workspace-1", raced.storage)).rejects.toThrow("changed");
    expect(raced.set).not.toHaveBeenCalled();
    const stale = harness();
    stale.setMirror({ ...projection, availableThrough: "2026-09-25T12:00:00.000Z" });
    await synchronizeCalendarActivity(stale.gateway, "workspace-1", stale.storage);
    expect(stale.set).not.toHaveBeenCalled();
  });
});
