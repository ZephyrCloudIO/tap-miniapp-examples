import { describe, expect, it } from "@rstest/core";
import { hostPolicyMatches, sharedHostInput, workspaceHosts } from "./workspace-hosts";
import { createInitialCalendarState } from "./test-fixtures";

describe("workspace hosts", () => {
  it("uses membership as the host roster and excludes former members", () => {
    const hosts = workspaceHosts([{ userId: "new", displayName: "New member" }], [{ principalId: "removed", displayName: "Former member", email: "", version: 1, calendarConnected: true, availabilityReady: true, zoomConnected: true }]);
    expect(hosts).toHaveLength(1);
    expect(hosts[0]).toMatchObject({ principalId: "new", displayName: "New member", calendarConnected: false, zoomConnected: false });
  });
  it("recognizes the server's sorted schedule without repeatedly syncing", () => {
    const input = sharedHostInput(createInitialCalendarState(), null, "Alex")!;
    const host = { ...input, principalId: "alex", version: 1, email: "alex@example.com", schedule: { ...input.schedule, windows: [...input.schedule.windows].sort((a, b) => a.day - b.day).map(({ start, end, day, enabled }) => ({ start, end, day, enabled })) } };
    expect(hostPolicyMatches({ enabled: true, host }, input)).toBe(true);
    expect(hostPolicyMatches({ enabled: true, host }, { ...input, schedule: { ...input.schedule, bufferAfterMinutes: input.schedule.bufferAfterMinutes + 5 } })).toBe(false);
    expect(hostPolicyMatches({ enabled: false, host }, input)).toBe(false);
  });
  it("does not invent availability or switch a saved destination after disconnection", () => {
    const initial = createInitialCalendarState();
    expect(sharedHostInput({ ...initial, availability: [] }, null, "Alex")).toBeNull();
    const input = sharedHostInput(initial, null, "Alex")!;
    const own = { enabled: true, host: { ...input, principalId: "alex", version: 1, email: "alex@example.com", destinationCalendarId: "removed-calendar" } };
    expect(sharedHostInput(initial, own, "Alex")).toBeNull();
  });
});
