import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { loadCalendarState } from "./storage";
import { calendarPrincipalStorageAddresses } from "./principal-storage";
import { createInitialCalendarState } from "./test-fixtures";

const SDK_SLOT = Symbol.for("tap.internal.v1");

afterEach(() => {
  Reflect.deleteProperty(globalThis, SDK_SLOT);
});

describe("TAP Calendar storage", () => {
  it("initializes an empty projection and activity coverage in one revision", async () => {
    const get = rs.fn(async () => ({ value: null, revision: 0 }));
    const set = rs.fn(async () => ({ revision: 10 }));
    Reflect.set(globalThis, SDK_SLOT, { storage: { get, set } });

    const loaded = await loadCalendarState(false, "user-alex");

    expect(loaded).toMatchObject({
      revision: 10,
      state: {
        accounts: [],
        events: [],
        availability: [],
        bookingProfiles: [],
      },
    });
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith(
      calendarPrincipalStorageAddresses("user-alex").state,
    );
    expect(set).toHaveBeenCalledTimes(1);
  });

  it("does not read the legacy workspace state for another principal", async () => {
    const get = rs.fn(async () => ({ value: null, revision: null }));
    Reflect.set(globalThis, SDK_SLOT, { storage: { get, set: rs.fn(async () => ({ revision: 1 })) } });

    await loadCalendarState(false, "user-other");

    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith(
      calendarPrincipalStorageAddresses("user-other").state,
    );
  });

  it("loads schema-v1 Event Types without losing state and pins them to the stored default schedule", async () => {
    const legacy = {
      ...structuredClone(createInitialCalendarState()),
      bookingRequests: [],
      notificationChannels: createInitialCalendarState().notificationChannels.map(channel => ({
        ...channel,
        entries: channel.entries.filter(entry => entry.bookingRequestId === undefined),
      })),
    };
    const legacyEventType = legacy.bookingProfiles[0]!.eventTypes[0]!;
    delete (legacyEventType as { availabilityScheduleId?: string }).availabilityScheduleId;
    const get = rs.fn(async () => ({ value: legacy, revision: 9 }));
    const set = rs.fn(async () => ({ revision: 10 }));
    Reflect.set(globalThis, SDK_SLOT, { storage: { get, set } });

    const loaded = await loadCalendarState(false, "user-alex");

    expect(loaded.revision).toBe(10);
    expect(loaded.state.accounts).toHaveLength(legacy.accounts.length);
    expect(loaded.state.events).toHaveLength(legacy.events.length);
    expect(loaded.state.bookingProfiles).toHaveLength(legacy.bookingProfiles.length);
    expect(
      loaded.state.bookingProfiles[0]!.eventTypes[0]!.availabilityScheduleId,
    ).toBe(legacy.activeAvailabilityId);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 9 }));
  });
});
