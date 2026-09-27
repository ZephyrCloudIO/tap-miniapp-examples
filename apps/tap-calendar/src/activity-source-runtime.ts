import { defineActivitySource } from "@theaiplatform/miniapp-sdk/activity";
import type { MiniAppStorageApi } from "@theaiplatform/miniapp-sdk/sdk";
import { CALENDAR_ACTIVITY_SOURCE_ID, calendarActivityAddress, calendarActivityTypes,
  isCalendarActivityProjection } from "./activity-contract";

export function createCalendarActivitySource(storage: Pick<MiniAppStorageApi, "get">) {
  return defineActivitySource({
    async get(request) {
      if (request.scope !== "self" || request.sourceId !== CALENDAR_ACTIVITY_SOURCE_ID) {
        throw new Error("Calendar activity requires trusted self scope.");
      }
      const start = Date.parse(request.startAt), end = Date.parse(request.endAtExclusive);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 15 * 60_000) {
        throw new Error("Calendar activity requires a range of at least 15 minutes.");
      }
      const stored = await storage.get(calendarActivityAddress(request.userId, request.workspaceId));
      if (!isCalendarActivityProjection(stored.value) || stored.value.userId !== request.userId || stored.value.workspaceId !== request.workspaceId) {
        throw new Error("Calendar activity is unavailable. Open Calendar to synchronize its saved activity.");
      }
      const projection = stored.value;
      return {
        coverage: start >= Date.parse(projection.availableFrom) && end <= Date.parse(projection.availableThrough) ? "complete" as const : "partial" as const,
        activities: calendarActivityTypes.flatMap(type => type.statuses.map(statusId => ({
          activityId: type.id, statusId, unit: "count" as const,
          value: projection.entries.filter(entry => entry.activityId === type.id && entry.statusId === statusId
            && Date.parse(entry.occurredAt) >= start && Date.parse(entry.occurredAt) < end).length,
        }))),
      };
    },
  });
}
