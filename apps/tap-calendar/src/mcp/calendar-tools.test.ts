import { describe, expect, it } from "@rstest/core";
import type {
  MiniAppJsonValue,
  MiniAppStorageAddress,
} from "@theaiplatform/miniapp-sdk/sdk";
import {
  type CalendarState,
} from "../domain";
import {
  createCalendarEventRangeRequest,
  type CalendarEventCacheSnapshot,
} from "../event-cache";
import { createInitialCalendarState } from "../test-fixtures";
import {
  calendarMcpStorageAddresses,
  createCalendarMcpServer,
  createDailySummaryMcpServer,
  type CalendarMcpExecutionContext,
  type CalendarMcpRuntime,
} from "./calendar-tools";

const NOW = "2026-08-15T16:00:00.000Z";
const DEFAULT_CONFLICT_CALENDAR_IDS = [
  "cal-home",
  "cal-family",
  "cal-google-main",
  "cal-work",
] as const;

function stored(value: CalendarState): MiniAppJsonValue {
  return JSON.parse(JSON.stringify(value)) as MiniAppJsonValue;
}

function storedJson(value: unknown): MiniAppJsonValue {
  return JSON.parse(JSON.stringify(value)) as MiniAppJsonValue;
}

function eventCacheFixture(input: {
  readonly calendarIds?: readonly string[];
  readonly timeMin?: string;
  readonly timeMax?: string;
  readonly syncedAt?: string;
  readonly partial?: boolean;
  readonly events?: CalendarEventCacheSnapshot["entries"][number]["events"];
} = {}): CalendarEventCacheSnapshot {
  const calendarIds = input.calendarIds ?? DEFAULT_CONFLICT_CALENDAR_IDS;
  const timeMin = input.timeMin ?? "2026-08-01T00:00:00.000Z";
  const timeMax = input.timeMax ?? "2026-09-01T00:00:00.000Z";
  const syncedAt = input.syncedAt ?? NOW;
  const request = createCalendarEventRangeRequest({
    timeMin,
    timeMax,
    calendarIds,
  });
  return {
    schemaVersion: 1,
    entries: [{
      ...request,
      events: input.events ?? [],
      calendarSyncedAt: Object.fromEntries(
        request.calendarIds.map(calendarId => [calendarId, syncedAt]),
      ),
      updatedAt: syncedAt,
      lastFullSyncAt: input.partial ? null : syncedAt,
      lastAccessedAt: syncedAt,
      partial: input.partial ?? false,
    }],
  };
}

function runtimeFixture(
  value: MiniAppJsonValue = null,
  context: CalendarMcpExecutionContext = {
    channelId: null,
    userId: "user-alex",
  },
  eventCache: MiniAppJsonValue = value === null
    ? null
    : storedJson(eventCacheFixture()),
) {
  const reads: MiniAppStorageAddress[] = [];
  const addresses = context.userId && context.userId.trim()
    ? calendarMcpStorageAddresses(context.userId)
    : null;
  const runtime: CalendarMcpRuntime = {
    getExecutionContext: () => context,
    readStorage(address) {
      reads.push(address);
      return {
        value: address.key === addresses?.state.key
          ? value
          : eventCache,
        revision: 3,
      };
    },
    now: () => Date.parse(NOW),
  };
  return { reads, runtime };
}

const meetingDraft: Record<string, MiniAppJsonValue> = {
  title: "Customer architecture call",
  calendarId: "cal-work",
  start: "2026-08-17T14:00:00-04:00",
  end: "2026-08-17T14:30:00-04:00",
  meetingProvider: "zoom",
  approvalRequired: false,
  attendees: [
    {
      id: "guest-jordan",
      name: "Jordan Lee",
      email: "jordan@example.com",
      kind: "external",
      required: true,
    },
  ],
};

describe("TAP Calendar MCP tools", () => {
  it("isolates the aggregate daily-summary tool from event-detail tools", () => {
    const calendarServer = createCalendarMcpServer();
    const dailySummaryServer = createDailySummaryMcpServer();
    expect(Object.keys(calendarServer.tools).sort()).toEqual([
      "draft_meeting",
      "find_available_slots",
      "list_events",
    ]);
    expect(Object.keys(dailySummaryServer.tools)).toEqual(["summarize_day"]);
    for (const tool of [
      ...Object.values(calendarServer.tools),
      ...Object.values(dailySummaryServer.tools),
    ]) {
      expect(typeof tool.description).toBe("string");
      expect(tool.inputSchema).toBeDefined();
      expect(typeof tool.execute).toBe("function");
    }
  });

  it("reads only the two declared TAP Calendar storage addresses", async () => {
    const { runtime, reads } = runtimeFixture(stored(createInitialCalendarState()));
    const addresses = calendarMcpStorageAddresses("user-alex");
    const server = createCalendarMcpServer(runtime);
    const dailySummaryServer = createDailySummaryMcpServer(runtime);
    await server.tools.list_events.execute({});
    await dailySummaryServer.tools.summarize_day.execute({
      date: "2026-08-15",
      timeZone: "America/New_York",
    });
    await server.tools.find_available_slots.execute({
      date: "2026-08-17",
      timezoneOffset: "-04:00",
      durationMinutes: 30,
    });
    await server.tools.draft_meeting.execute(meetingDraft);
    expect(reads).toEqual([
      addresses.state,
      addresses.eventCache,
      addresses.state,
      addresses.eventCache,
      addresses.state,
      addresses.eventCache,
      addresses.state,
      addresses.eventCache,
    ]);
  });

  it("lists visible events while redacting free/busy and Work Block content", async () => {
    const initial = createInitialCalendarState();
    const state: CalendarState = {
      ...initial,
      events: initial.events.map(event =>
        event.id === "event-dmitry"
          ? { ...event, title: "Confidential acquisition review" }
          : event,
      ),
    };
    const server = createCalendarMcpServer(runtimeFixture(stored(state)).runtime);
    const result = (await server.tools.list_events.execute({
      start: "2026-08-10T00:00:00Z",
      end: "2026-08-18T00:00:00Z",
    })) as unknown as {
      events: Array<{
        id: string;
        title: string;
        redacted: boolean;
        attendeeCount: number | null;
      }>;
    };
    expect(result.events.find(event => event.id === "event-dmitry")).toMatchObject({
      title: "Busy",
      redacted: true,
      attendeeCount: null,
    });
    expect(result.events.find(event => event.id === "event-work-block")).toMatchObject({
      title: "Busy",
      redacted: true,
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("Confidential acquisition review");
    expect(serialized).not.toContain("Calendar launch checklist");
  });

  it("merges D1-cache-mirror events and exposes bounded cache provenance", async () => {
    const state = createInitialCalendarState();
    const cache = eventCacheFixture({
      calendarIds: ["cal-dmitry", "cal-work"],
      events: [
        {
          id: "provider-secret",
          calendarId: "cal-dmitry",
          title: "Private compensation review",
          start: "2026-08-17T14:00:00.000Z",
          end: "2026-08-17T15:00:00.000Z",
          kind: "meeting",
          status: "confirmed",
          location: "microsoft-teams",
          attendees: [{
            id: "private-attendee",
            name: "Private Person",
            email: "private@example.com",
            kind: "external",
            required: true,
          }],
        },
      ],
    });
    const server = createCalendarMcpServer(
      runtimeFixture(
        stored(state),
        { channelId: null, userId: "user-alex" },
        storedJson(cache),
      ).runtime,
    );
    const result = (await server.tools.list_events.execute({
      start: "2026-08-17T00:00:00.000Z",
      end: "2026-08-18T00:00:00.000Z",
      calendarIds: ["cal-dmitry"],
    })) as unknown as {
      events: Array<{ id: string; title: string; redacted: boolean }>;
      cache: { source: string; ageMs: number; partial: boolean };
      sources: { gatewayD1CacheMirrorEventCount: number };
    };
    expect(result.events).toContainEqual(expect.objectContaining({
      id: "provider-secret",
      title: "Busy",
      redacted: true,
    }));
    expect(result.cache).toMatchObject({
      source: "gateway-d1-cache-mirror",
      ageMs: 0,
      partial: false,
    });
    expect(result.sources.gatewayD1CacheMirrorEventCount).toBe(1);
    expect(JSON.stringify(result)).not.toContain("Private compensation review");
    expect(JSON.stringify(result)).not.toContain("private@example.com");
  });

  it("does not surface events from hidden calendars", async () => {
    const initial = createInitialCalendarState();
    const state: CalendarState = {
      ...initial,
      events: [
        ...initial.events,
        {
          id: "hidden-event",
          calendarId: "cal-charlie",
          title: "Hidden delegated event",
          start: "2026-08-17T13:00:00Z",
          end: "2026-08-17T14:00:00Z",
          kind: "meeting",
          status: "confirmed",
          location: null,
          attendees: [],
        },
      ],
    };
    const server = createCalendarMcpServer(runtimeFixture(stored(state)).runtime);
    const result = (await server.tools.list_events.execute({
      calendarIds: ["cal-charlie"],
    })) as unknown as { events: unknown[] };
    expect(result.events).toEqual([]);
  });

  it("returns no invented events when storage is empty", async () => {
    const server = createCalendarMcpServer(runtimeFixture().runtime);
    const result = (await server.tools.list_events.execute({})) as unknown as {
      stateAvailable: boolean;
      events: unknown[];
    };
    expect(result).toMatchObject({ stateAvailable: false, events: [] });
  });

  it("exposes privacy-safe daily meeting and focused-work totals", async () => {
    const initial = createInitialCalendarState();
    const dailyEvents: CalendarState["events"] = [
      {
        id: "private-meeting",
        calendarId: "cal-work",
        title: "Confidential acquisition review",
        start: "2026-08-15T13:00:00.000Z",
        end: "2026-08-15T14:00:00.000Z",
        kind: "meeting",
        status: "confirmed",
        location: "zoom",
        attendees: [{
          id: "secret-attendee",
          name: "Private Person",
          email: "private@example.com",
          kind: "external",
          required: true,
        }],
      },
      {
        id: "private-work-block",
        calendarId: "cal-work",
        title: "Private TAP task",
        start: "2026-08-15T13:30:00.000Z",
        end: "2026-08-15T15:00:00.000Z",
        kind: "work-block",
        status: "confirmed",
        location: null,
        attendees: [],
        source: {
          kind: "task",
          id: "task-private",
          label: "Secret roadmap task",
        },
      },
    ];
    const state: CalendarState = {
      ...initial,
      events: dailyEvents,
    };
    const server = createDailySummaryMcpServer(runtimeFixture(
      stored(state),
      { channelId: null, userId: "user-alex" },
      storedJson(eventCacheFixture({ events: dailyEvents })),
    ).runtime);
    const result = (await server.tools.summarize_day.execute({
      date: "2026-08-15",
      timeZone: "America/New_York",
    })) as unknown as {
      periodStart: string;
      periodEnd: string;
      scheduled: {
        meetingMinutes: number;
        focusedWorkMinutes: number;
        overlapMinutes: number;
        totalMinutes: number;
      };
      elapsed: {
        meetingMinutes: number;
        focusedWorkMinutes: number;
      };
      eventCounts: { meetings: number; workBlocks: number; focusBlocks: number };
      dataStatus: { status: string; complete: boolean; includedCalendarCount: number };
      basis: string;
      safeToPresent: boolean;
    };
    expect(result).toMatchObject({
      periodStart: "2026-08-15T04:00:00.000Z",
      periodEnd: "2026-08-16T04:00:00.000Z",
      scheduled: {
        meetingMinutes: 60,
        focusedWorkMinutes: 60,
        overlapMinutes: 30,
        totalMinutes: 120,
      },
      elapsed: {
        meetingMinutes: 60,
        focusedWorkMinutes: 60,
      },
      eventCounts: { meetings: 1, workBlocks: 1, focusBlocks: 0 },
      dataStatus: { status: "complete", complete: true, includedCalendarCount: 3 },
      basis: "scheduled-calendar-time",
      safeToPresent: true,
    });
    const serialized = JSON.stringify(result);
    for (const secret of [
      "Confidential acquisition review",
      "private@example.com",
      "secret-attendee",
      "Private TAP task",
      "task-private",
      "Secret roadmap task",
      "private-meeting",
      "private-work-block",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("suppresses daily-summary totals when cache coverage is incomplete", async () => {
    const server = createDailySummaryMcpServer(
      runtimeFixture(
        stored(createInitialCalendarState()),
        { channelId: null, userId: "user-alex" },
        storedJson(eventCacheFixture({ partial: true })),
      ).runtime,
    );
    const result = (await server.tools.summarize_day.execute({
      date: "2026-08-15",
      timeZone: "America/New_York",
    })) as unknown as {
      scheduled: null;
      elapsed: null;
      eventCounts: null;
      safeToPresent: boolean;
      warning: string;
      dataStatus: {
        status: string;
        complete: boolean;
        missingCalendarCount: number;
      };
    };
    expect(result).toMatchObject({
      scheduled: null,
      elapsed: null,
      eventCounts: null,
      safeToPresent: false,
    });
    expect(result.warning).toMatch(/suppressed/u);
    expect(result.dataStatus).toEqual(expect.objectContaining({
      status: "partial",
      complete: false,
      missingCalendarCount: 3,
    }));
  });

  it("marks unmatched local events unverified even with complete fresh cache coverage", async () => {
    const initial = createInitialCalendarState();
    const state: CalendarState = {
      ...initial,
      events: [{
        id: "local-provider-event",
        calendarId: "cal-work",
        title: "Possibly deleted provider event",
        start: "2026-08-15T13:00:00.000Z",
        end: "2026-08-15T14:00:00.000Z",
        kind: "meeting",
        status: "confirmed",
        location: null,
        attendees: [],
        providerHtmlLink: "https://calendar.google.com/calendar/event?eid=opaque",
      }],
    };
    const server = createDailySummaryMcpServer(runtimeFixture(stored(state)).runtime);
    const result = (await server.tools.summarize_day.execute({
      date: "2026-08-15",
      timeZone: "America/New_York",
    })) as unknown as {
      scheduled: null;
      safeToPresent: boolean;
      warning: string;
      dataStatus: {
        status: string;
        complete: boolean;
        unverifiedLocalEventCount: number;
      };
    };
    expect(result).toMatchObject({ scheduled: null, safeToPresent: false });
    expect(result.warning).toMatch(/unverified/u);
    expect(result.dataStatus).toEqual(expect.objectContaining({
      status: "unverified",
      complete: false,
      unverifiedLocalEventCount: 1,
    }));
    expect(JSON.stringify(result)).not.toContain("Possibly deleted provider event");
  });

  it("does not claim a complete zero when no owned calendar is connected", async () => {
    const initial = createInitialCalendarState();
    const state: CalendarState = {
      ...initial,
      accounts: initial.accounts.map(account => ({
        ...account,
        calendars: account.calendars.map(calendar => ({
          ...calendar,
          role: calendar.role === "owner" ? "reader" : calendar.role,
        })),
      })),
      events: [],
    };
    const server = createDailySummaryMcpServer(runtimeFixture(stored(state)).runtime);
    const result = (await server.tools.summarize_day.execute({
      date: "2026-08-15",
      timeZone: "America/New_York",
    })) as unknown as {
      scheduled: null;
      dataStatus: { status: string; complete: boolean; includedCalendarCount: number };
      reason: string;
    };
    expect(result).toMatchObject({
      scheduled: null,
      dataStatus: {
        status: "unavailable",
        complete: false,
        includedCalendarCount: 0,
      },
    });
    expect(result.reason).toContain("No calendars owned");
  });

  it("fails daily summaries closed for unknown zones and non-owned calendars", async () => {
    const server = createDailySummaryMcpServer(
      runtimeFixture(stored(createInitialCalendarState())).runtime,
    );
    await expect(server.tools.summarize_day.execute({
      date: "2026-08-15",
      timeZone: "Mars/Olympus_Mons",
    })).rejects.toThrow(/cannot be resolved/u);
    await expect(server.tools.summarize_day.execute({
      date: "2026-08-15",
      timeZone: "America/New_York",
      calendarIds: ["cal-dmitry"],
    })).rejects.toThrow(/owned/u);
    await expect(server.tools.summarize_day.execute({
      date: "2026-08-15",
      timeZone: "America/New_York",
      calendarIds: [],
    })).rejects.toThrow(/at least one/u);
  });

  it("finds slots from configured schedules and Conflict Calendars", async () => {
    const server = createCalendarMcpServer(
      runtimeFixture(stored(createInitialCalendarState())).runtime,
    );
    const result = (await server.tools.find_available_slots.execute({
      date: "2026-08-18",
      durationMinutes: 30,
      intervalMinutes: 30,
    })) as unknown as {
      scheduleId: string;
      slots: Array<{ start: string; end: string }>;
      conflictCalendarIds: string[];
    };
    expect(result.scheduleId).toBe("availability-standard");
    expect(result.slots[0]).toEqual({
      start: "2026-08-18T14:00:00.000Z",
      end: "2026-08-18T14:30:00.000Z",
    });
    expect(result.conflictCalendarIds).toContain("cal-work");
  });

  it("uses an explicitly requested non-default Availability Schedule", async () => {
    const server = createCalendarMcpServer(
      runtimeFixture(stored(createInitialCalendarState())).runtime,
    );
    const result = (await server.tools.find_available_slots.execute({
      date: "2026-08-18",
      durationMinutes: 30,
      intervalMinutes: 30,
      scheduleId: "availability-customer",
    })) as unknown as {
      scheduleId: string;
      scheduleTimezone: string;
      slots: Array<{ start: string; end: string }>;
    };

    expect(result.scheduleId).toBe("availability-customer");
    expect(result.scheduleTimezone).toBe("America/New_York");
    expect(result.slots[0]).toEqual({
      start: "2026-08-18T15:00:00.000Z",
      end: "2026-08-18T15:30:00.000Z",
    });
  });

  it("rejects dates outside the configured booking horizon before cache checks", async () => {
    const server = createCalendarMcpServer(
      runtimeFixture(stored(createInitialCalendarState()), undefined, null).runtime,
    );
    const result = (await server.tools.find_available_slots.execute({
      date: "2026-10-20",
      durationMinutes: 30,
    })) as unknown as {
      slots: unknown[];
      reason: string;
      blockedByIncompleteCacheCalendarIds: string[];
    };
    expect(result).toMatchObject({
      slots: [],
      reason: "The requested date is outside this Availability Schedule's booking horizon.",
      blockedByIncompleteCacheCalendarIds: [],
    });
  });

  it("finds slots across every enabled timeframe on the same day", async () => {
    const initial = createInitialCalendarState();
    const state: CalendarState = {
      ...initial,
      availability: initial.availability.map(schedule =>
        schedule.id === initial.activeAvailabilityId
          ? {
              ...schedule,
              windows: [
                ...schedule.windows.filter(window => window.day !== 2),
                { id: "tuesday-morning", day: 2, enabled: true, start: "06:00", end: "07:00" },
                { id: "tuesday-evening", day: 2, enabled: true, start: "18:00", end: "19:00" },
              ],
            }
          : schedule,
      ),
    };
    const server = createCalendarMcpServer(runtimeFixture(stored(state)).runtime);
    const result = (await server.tools.find_available_slots.execute({
      date: "2026-08-18",
      timezoneOffset: "-04:00",
      durationMinutes: 30,
      intervalMinutes: 30,
    })) as unknown as { slots: Array<{ start: string; end: string }> };
    expect(result.slots.map(slot => slot.start)).toEqual([
      "2026-08-18T10:00:00.000Z",
      "2026-08-18T10:30:00.000Z",
      "2026-08-18T22:00:00.000Z",
      "2026-08-18T22:30:00.000Z",
    ]);
  });

  it("uses the stored travel-override time zone and custom hours", async () => {
    const initial = createInitialCalendarState();
    const state: CalendarState = {
      ...initial,
      availability: initial.availability.map(schedule =>
        schedule.id === initial.activeAvailabilityId
          ? {
              ...schedule,
              overrides: [...(schedule.overrides ?? []), {
                id: "override-tokyo",
                date: "2026-08-22",
                label: "Tokyo customer week",
                available: true,
                timezone: "Asia/Tokyo",
                start: "09:00",
                end: "10:00",
              }],
            }
          : schedule,
      ),
    };
    const server = createCalendarMcpServer(runtimeFixture(stored(state)).runtime);
    const result = (await server.tools.find_available_slots.execute({
      date: "2026-08-22",
      // A legacy caller may still send an offset. Stored IANA policy is
      // authoritative, so this deliberately incorrect value is ignored.
      timezoneOffset: "-04:00",
      durationMinutes: 30,
      intervalMinutes: 30,
    })) as unknown as {
      scheduleTimezone: string;
      availabilityTimezone: string;
      slots: Array<{ start: string; end: string }>;
    };
    expect(result.scheduleTimezone).toBe("America/New_York");
    expect(result.availabilityTimezone).toBe("Asia/Tokyo");
    expect(result.slots.map(slot => slot.start)).toEqual([
      "2026-08-22T00:00:00.000Z",
      "2026-08-22T00:30:00.000Z",
    ]);
  });

  it("closes availability for an unavailable date override", async () => {
    const server = createCalendarMcpServer(
      runtimeFixture(stored(createInitialCalendarState())).runtime,
    );
    const result = (await server.tools.find_available_slots.execute({
      date: "2026-08-17",
      timezoneOffset: "-04:00",
      durationMinutes: 30,
    })) as unknown as { slots: unknown[]; reason: string };
    expect(result.slots).toEqual([]);
    expect(result.reason).toContain("Customer summit travel");
  });

  it("fails availability closed when a selected Conflict Calendar is stale", async () => {
    const initial = createInitialCalendarState();
    const state: CalendarState = {
      ...initial,
      accounts: initial.accounts.map(account => ({
        ...account,
        calendars: account.calendars.map(calendar =>
          calendar.id === "cal-contoso"
            ? { ...calendar, conflicts: true }
            : calendar,
        ),
      })),
    };
    const server = createCalendarMcpServer(runtimeFixture(stored(state)).runtime);
    const result = (await server.tools.find_available_slots.execute({
      date: "2026-08-17",
      timezoneOffset: "-04:00",
      durationMinutes: 30,
      calendarIds: ["cal-work"],
    })) as unknown as {
      slots: unknown[];
      blockedByStaleCalendarIds: string[];
      reason: string;
    };
    expect(result.slots).toEqual([]);
    expect(result.blockedByStaleCalendarIds).toEqual(["cal-contoso"]);
    expect(result.reason).toContain("closed");
  });

  it("fails availability closed for partial or older-than-five-minutes cache coverage", async () => {
    const state = stored(createInitialCalendarState());
    const partialServer = createCalendarMcpServer(
      runtimeFixture(
        state,
        { channelId: null, userId: "user-alex" },
        storedJson(eventCacheFixture({ partial: true })),
      ).runtime,
    );
    const partial = (await partialServer.tools.find_available_slots.execute({
      date: "2026-08-18",
      timezoneOffset: "-04:00",
      durationMinutes: 30,
    })) as unknown as {
      slots: unknown[];
      blockedByIncompleteCacheCalendarIds: string[];
      cache: { partial: boolean };
      requiresLiveGatewayConfirmation: boolean;
    };
    expect(partial.slots).toEqual([]);
    expect(partial.blockedByIncompleteCacheCalendarIds).toEqual(
      [...DEFAULT_CONFLICT_CALENDAR_IDS].sort(),
    );
    expect(partial.cache.partial).toBe(true);
    expect(partial.requiresLiveGatewayConfirmation).toBe(true);

    const narrowServer = createCalendarMcpServer(
      runtimeFixture(
        state,
        { channelId: null, userId: "user-alex" },
        storedJson(eventCacheFixture({
          timeMin: "2026-08-18T13:00:00.000Z",
          timeMax: "2026-08-18T14:00:00.000Z",
        })),
      ).runtime,
    );
    const narrow = (await narrowServer.tools.find_available_slots.execute({
      date: "2026-08-18",
      timezoneOffset: "-04:00",
      durationMinutes: 30,
    })) as unknown as {
      slots: unknown[];
      blockedByIncompleteCacheCalendarIds: string[];
    };
    expect(narrow.slots).toEqual([]);
    expect(narrow.blockedByIncompleteCacheCalendarIds).toEqual(
      [...DEFAULT_CONFLICT_CALENDAR_IDS].sort(),
    );

    const staleServer = createCalendarMcpServer(
      runtimeFixture(
        state,
        { channelId: null, userId: "user-alex" },
        storedJson(eventCacheFixture({ syncedAt: "2026-08-15T15:54:59.999Z" })),
      ).runtime,
    );
    const stale = (await staleServer.tools.find_available_slots.execute({
      date: "2026-08-18",
      timezoneOffset: "-04:00",
      durationMinutes: 30,
    })) as unknown as {
      slots: unknown[];
      blockedByStaleCalendarIds: string[];
      reason: string;
    };
    expect(stale.slots).toEqual([]);
    expect(stale.blockedByStaleCalendarIds).toEqual(
      [...DEFAULT_CONFLICT_CALENDAR_IDS].sort(),
    );
    expect(stale.reason).toContain("older than five minutes");
  });

  it("uses fresh complete cache events for slot calculation but requires a live check", async () => {
    const cache = eventCacheFixture({
      events: [{
        id: "provider-busy",
        calendarId: "cal-work",
        title: "Gateway-cached meeting",
        start: "2026-08-18T13:00:00.000Z",
        end: "2026-08-18T14:00:00.000Z",
        kind: "meeting",
        status: "confirmed",
        location: "zoom",
        attendees: [],
      }],
    });
    const server = createCalendarMcpServer(
      runtimeFixture(
        stored(createInitialCalendarState()),
        { channelId: null, userId: "user-alex" },
        storedJson(cache),
      ).runtime,
    );
    const result = (await server.tools.find_available_slots.execute({
      date: "2026-08-18",
      timezoneOffset: "-04:00",
      durationMinutes: 30,
      intervalMinutes: 30,
    })) as unknown as {
      slots: Array<{ start: string; end: string }>;
      cache: { partial: boolean; ageMs: number };
      requiresLiveGatewayConfirmation: boolean;
      confirmationPolicy: string;
    };
    expect(result.slots[0]).toEqual({
      start: "2026-08-18T14:30:00.000Z",
      end: "2026-08-18T15:00:00.000Z",
    });
    expect(result.cache).toMatchObject({ partial: false, ageMs: 0 });
    expect(result.requiresLiveGatewayConfirmation).toBe(true);
    expect(result.confirmationPolicy).toContain("live calendar gateway");
  });

  it("loads conflicts across the full before/after buffer range", async () => {
    const initial = createInitialCalendarState();
    const state: CalendarState = {
      ...initial,
      availability: initial.availability.map(schedule =>
        schedule.id === initial.activeAvailabilityId
          ? { ...schedule, bufferBeforeMinutes: 60, bufferAfterMinutes: 0 }
          : schedule,
      ),
    };
    const cache = eventCacheFixture({
      events: [{
        id: "provider-before-window",
        calendarId: "cal-work",
        title: "Ends when availability starts",
        start: "2026-08-18T12:30:00.000Z",
        end: "2026-08-18T13:00:00.000Z",
        kind: "meeting",
        status: "confirmed",
        location: null,
        attendees: [],
      }],
    });
    const server = createCalendarMcpServer(
      runtimeFixture(stored(state), undefined, storedJson(cache)).runtime,
    );

    const result = (await server.tools.find_available_slots.execute({
      date: "2026-08-18",
      durationMinutes: 30,
      intervalMinutes: 30,
    })) as unknown as { slots: Array<{ start: string }> };
    const starts = result.slots.map(slot => slot.start);

    expect(starts).not.toContain("2026-08-18T13:00:00.000Z");
    expect(starts).not.toContain("2026-08-18T13:30:00.000Z");
    expect(starts).toContain("2026-08-18T14:00:00.000Z");
  });

  it("prepares a valid draft without mutating stored state", async () => {
    const state = createInitialCalendarState();
    const before = JSON.stringify(state);
    const server = createCalendarMcpServer(runtimeFixture(stored(state)).runtime);
    const result = (await server.tools.draft_meeting.execute(
      meetingDraft,
    )) as unknown as {
      kind: string;
      valid: boolean;
      writesPerformed: boolean;
      requiresHumanConfirmation: boolean;
      warnings: string[];
    };
    expect(result).toMatchObject({
      kind: "meeting-draft",
      valid: true,
      writesPerformed: false,
      requiresHumanConfirmation: true,
    });
    expect(result.warnings.join(" ")).toContain("without verification");
    expect(JSON.stringify(state)).toBe(before);
  });

  it("warns on TAP-native External Guest drafts and rejects read-only destinations", async () => {
    const server = createCalendarMcpServer(
      runtimeFixture(stored(createInitialCalendarState())).runtime,
    );
    const incompatible = (await server.tools.draft_meeting.execute({
      ...meetingDraft,
      meetingProvider: "tap-huddle",
    })) as unknown as { valid: boolean; warnings: string[]; draft: unknown };
    expect(incompatible.valid).toBe(true);
    expect(incompatible.draft).not.toBeNull();
    expect(incompatible.warnings.join(" ")).toContain("External guests");

    const readOnly = (await server.tools.draft_meeting.execute({
      ...meetingDraft,
      calendarId: "cal-holidays",
    })) as unknown as { valid: boolean; errors: string[] };
    expect(readOnly.valid).toBe(false);
    expect(readOnly.errors).toContain("Choose a writable Destination Calendar.");
  });

  it("reports advisory cached conflicts and staleness without writing or booking", async () => {
    const cache = eventCacheFixture({
      events: [{
        id: "provider-conflict",
        calendarId: "cal-work",
        title: "Existing customer meeting",
        start: "2026-08-17T18:00:00.000Z",
        end: "2026-08-17T19:00:00.000Z",
        kind: "meeting",
        status: "confirmed",
        location: "zoom",
        attendees: [],
      }],
    });
    const server = createCalendarMcpServer(
      runtimeFixture(
        stored(createInitialCalendarState()),
        { channelId: null, userId: "user-alex" },
        storedJson(cache),
      ).runtime,
    );
    const result = (await server.tools.draft_meeting.execute(
      meetingDraft,
    )) as unknown as {
      valid: boolean;
      warnings: string[];
      writesPerformed: boolean;
      requiresLiveGatewayConfirmation: boolean;
      cacheAssessment: {
        completeAndFresh: boolean;
        overlappingEventCount: number;
        conflicts: Array<{ title: string }>;
      };
    };
    expect(result.valid).toBe(true);
    expect(result.cacheAssessment).toMatchObject({
      completeAndFresh: true,
      overlappingEventCount: 1,
    });
    expect(result.cacheAssessment.conflicts[0]?.title).toBe(
      "Existing customer meeting",
    );
    expect(result.warnings.join(" ")).toContain("overlapping busy event");
    expect(result.requiresLiveGatewayConfirmation).toBe(true);
    expect(result.writesPerformed).toBe(false);

    const staleServer = createCalendarMcpServer(
      runtimeFixture(
        stored(createInitialCalendarState()),
        { channelId: null, userId: "user-alex" },
        storedJson(eventCacheFixture({ syncedAt: "2026-08-15T15:54:59.999Z" })),
      ).runtime,
    );
    const stale = (await staleServer.tools.draft_meeting.execute(
      meetingDraft,
    )) as unknown as {
      valid: boolean;
      warnings: string[];
      cacheAssessment: {
        completeAndFresh: boolean;
        staleCalendarIds: string[];
      };
    };
    expect(stale.valid).toBe(true);
    expect(stale.cacheAssessment.completeAndFresh).toBe(false);
    expect(stale.cacheAssessment.staleCalendarIds).toEqual(
      [...DEFAULT_CONFLICT_CALENDAR_IDS].sort(),
    );
    expect(stale.warnings.join(" ")).toContain("older than five minutes");
  });

  it("rejects malformed execution context and stored state", async () => {
    const missingPrincipal = createCalendarMcpServer(
      runtimeFixture(null, { channelId: "channel-one", userId: null }).runtime,
    );
    await expect(missingPrincipal.tools.list_events.execute({})).rejects.toThrow(
      /canonical user identity/u,
    );

    const malformedContext = createCalendarMcpServer(
      runtimeFixture(null, { channelId: null, userId: "  " }).runtime,
    );
    await expect(malformedContext.tools.list_events.execute({})).rejects.toThrow(
      /userId/u,
    );

    const malformedState = createCalendarMcpServer(
      runtimeFixture({ schemaVersion: 99 }).runtime,
    );
    await expect(malformedState.tools.list_events.execute({})).rejects.toThrow(
      /malformed/u,
    );

    const malformedCache = createCalendarMcpServer(
      runtimeFixture(
        stored(createInitialCalendarState()),
        { channelId: null, userId: "user-alex" },
        { schemaVersion: 1, entries: [{ unbounded: true }] },
      ).runtime,
    );
    await expect(malformedCache.tools.list_events.execute({})).rejects.toThrow(
      /event cache is malformed or unbounded/u,
    );
  });
});
