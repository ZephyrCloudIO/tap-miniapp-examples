import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { createEmptyCalendarEventCache } from "./event-cache";
import {
  loadCalendarEventCache,
  saveCalendarEventCache,
} from "./event-cache-storage";
import { calendarPrincipalStorageAddresses } from "./principal-storage";

const SDK_SLOT = Symbol.for("tap.internal.v1");

afterEach(() => {
  Reflect.deleteProperty(globalThis, SDK_SLOT);
});

describe("calendar event cache storage", () => {
  it("uses an independent versioned TAP storage address", async () => {
    const cache = createEmptyCalendarEventCache();
    const get = rs.fn(async () => ({ value: cache, revision: 7 }));
    const set = rs.fn(async () => ({ revision: 8 }));
    Reflect.set(globalThis, SDK_SLOT, { storage: { get, set } });

    const address = calendarPrincipalStorageAddresses("user-zack").eventCache;
    await expect(loadCalendarEventCache(false, "user-zack")).resolves.toEqual({
      cache,
      revision: 7,
    });
    expect(get).toHaveBeenCalledWith(address);

    await expect(
      saveCalendarEventCache(cache, false, 7, "user-zack"),
    ).resolves.toBe(8);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      ...address,
      expectedRevision: 7,
      value: cache,
    }));
  });

  it("ignores an invalid or old cache snapshot", async () => {
    const get = rs.fn(async () => ({
      value: { schemaVersion: 0, entries: [{ events: "invalid" }] },
      revision: 3,
    }));
    Reflect.set(globalThis, SDK_SLOT, { storage: { get, set: rs.fn() } });

    await expect(loadCalendarEventCache(false, "user-zack")).resolves.toEqual({
      cache: createEmptyCalendarEventCache(),
      revision: 3,
    });
  });
});
