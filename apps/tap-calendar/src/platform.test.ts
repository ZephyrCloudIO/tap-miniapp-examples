import { describe, expect, it } from "@rstest/core";
import type {
  MiniAppChannel,
  MiniAppTask,
  MiniAppWorkflow,
} from "@theaiplatform/miniapp-sdk/sdk";
import {
  CALENDAR_HOST_ACTION,
  CALENDAR_NOTIFICATION_CHANNEL_NAME,
  createCalendarPlatform,
  createPreviewCalendarHostRuntime,
  type CalendarHostRuntime,
} from "./platform";

const channel = (
  overrides: Partial<MiniAppChannel> = {},
): MiniAppChannel => ({
  roomId: "calendar-notifications",
  title: CALENDAR_NOTIFICATION_CHANNEL_NAME,
  kind: "channel",
  description: "Calendar updates",
  visibility: "private",
  archived: false,
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

const task = (overrides: Partial<MiniAppTask> = {}): MiniAppTask => ({
  id: "task-1",
  title: "Prepare launch brief",
  status: "inProgress",
  priority: "high",
  assignees: [{ id: "user-1", type: "human", name: "Maya Chen" }],
  workspaceId: "workspace-1",
  channelIds: ["channel-1"],
  createdAt: Date.parse("2026-08-13T12:00:00Z"),
  updatedAt: Date.parse("2026-08-14T12:00:00Z"),
  dueDate: Date.parse("2026-08-17T14:00:00Z"),
  archived: false,
  ...overrides,
});

const workflow = (
  overrides: Partial<MiniAppWorkflow> = {},
): MiniAppWorkflow => ({
  id: "workflow-1",
  name: "Calendar follow-up",
  type: "dag",
  createdAt: Date.parse("2026-08-12T12:00:00Z"),
  updatedAt: Date.parse("2026-08-14T16:00:00Z"),
  ...overrides,
});

describe("TAP Calendar platform adapter", () => {
  it("uses an explicit preview runtime and normalizes notification outcomes", async () => {
    const runtime = createPreviewCalendarHostRuntime({
      notificationResult: {
        disposition: "suppressed",
        reason: "notifications-disabled",
      },
    });
    const platform = createCalendarPlatform(runtime);

    expect(runtime.environment).toBe("preview");
    await expect(platform.notifyImmediately("Standup begins in 10 minutes"))
      .resolves.toEqual({
        ok: true,
        value: {
          delivery: "suppressed",
          reason: "notifications-disabled",
        },
      });
    expect(runtime.snapshot()).toMatchObject({
      authorizationChecks: [
        { actionId: "notifications.show", autonomy: "do" },
      ],
      notifications: ["Standup begins in 10 minutes"],
    });
  });

  it("returns authorization denials without invoking the notification host API", async () => {
    const runtime = createPreviewCalendarHostRuntime({
      deniedActions: [CALENDAR_HOST_ACTION.showNotification],
    });
    const result = await createCalendarPlatform(runtime).notifyImmediately(
      "Standup begins in 10 minutes",
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "authorization-denied",
        actionId: "notifications.show",
      },
    });
    expect(runtime.snapshot().notifications).toEqual([]);
  });

  it("lists then creates one private notification channel and reuses it", async () => {
    const runtime = createPreviewCalendarHostRuntime({
      now: () => 123,
    });
    const platform = createCalendarPlatform(runtime);

    const first = await platform.ensurePrivateNotificationChannel({
      workspaceId: "workspace-1",
    });
    const second = await platform.ensurePrivateNotificationChannel({
      workspaceId: "workspace-1",
    });

    expect(first).toEqual({
      ok: true,
      value: {
        channelId: "preview-calendar-channel-1",
        name: CALENDAR_NOTIFICATION_CHANNEL_NAME,
        visibility: "private",
        created: true,
      },
    });
    expect(second).toEqual({
      ok: true,
      value: {
        channelId: "preview-calendar-channel-1",
        name: CALENDAR_NOTIFICATION_CHANNEL_NAME,
        visibility: "private",
        created: false,
      },
    });
    expect(runtime.snapshot().channels).toEqual([
      expect.objectContaining({
        roomId: "preview-calendar-channel-1",
        visibility: "private",
        archived: false,
      }),
    ]);
  });

  it("does not create a channel when create permission is denied", async () => {
    const runtime = createPreviewCalendarHostRuntime({
      deniedActions: [CALENDAR_HOST_ACTION.createChannel],
    });
    const result = await createCalendarPlatform(
      runtime,
    ).ensurePrivateNotificationChannel();

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "authorization-denied",
        actionId: "channels.create",
      },
    });
    expect(runtime.snapshot().channels).toEqual([]);
  });

  it("checks channel access before posting and deduplicates a stable clientMessageId", async () => {
    const runtime = createPreviewCalendarHostRuntime({
      channels: [channel()],
    });
    const platform = createCalendarPlatform(runtime);
    const input = {
      channelId: "calendar-notifications",
      clientMessageId: "tap-calendar:booking:booking-42:v1",
      kind: "booking" as const,
      title: "Meeting scheduled",
      summary: "Roadmap review · Monday at 2:00 PM",
    };

    const first = await platform.postChannelSummary(input);
    const replay = await platform.postChannelSummary(input);

    expect(first).toEqual(replay);
    expect(first).toMatchObject({
      ok: true,
      value: {
        channelId: "calendar-notifications",
        clientMessageId: input.clientMessageId,
        messageId: "preview-calendar-message-1",
      },
    });
    expect(runtime.snapshot().messages).toEqual([
      {
        channelId: "calendar-notifications",
        clientMessageId: input.clientMessageId,
        messageId: "preview-calendar-message-1",
        body: "Meeting scheduled\nRoadmap review · Monday at 2:00 PM",
      },
    ]);
    expect(runtime.snapshot().authorizationChecks).toEqual([
      { actionId: "channels.read", autonomy: "listen" },
      { actionId: "channels.send-message", autonomy: "do" },
      { actionId: "channels.read", autonomy: "listen" },
      { actionId: "channels.send-message", autonomy: "do" },
    ]);
  });

  it("does not attempt a send when channel access lacks send_message", async () => {
    const runtime = createPreviewCalendarHostRuntime({
      channels: [channel()],
      channelAccess: {
        "calendar-notifications": {
          archived: false,
          capabilities: ["observe"],
          isParticipant: true,
        },
      },
    });
    const result = await createCalendarPlatform(runtime).postChannelSummary({
      channelId: "calendar-notifications",
      clientMessageId: "tap-calendar:health:provider-sync:v1",
      kind: "health",
      title: "Calendar needs attention",
      summary: "Reconnect the provider to resume sync.",
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "channel-send-unavailable" },
    });
    expect(runtime.snapshot().messages).toEqual([]);
    expect(runtime.snapshot().authorizationChecks).toEqual([
      { actionId: "channels.read", autonomy: "listen" },
    ]);
  });

  it("normalizes active TAP tasks into soft Work Block sources", async () => {
    const runtime = createPreviewCalendarHostRuntime({
      tasks: [
        task(),
        task({ id: "task-archived", title: "Old task", archived: true }),
      ],
    });
    const result = await createCalendarPlatform(
      runtime,
    ).listTaskWorkBlockSources("workspace-1");

    expect(result).toEqual({
      ok: true,
      value: [
        {
          kind: "task",
          sourceId: "task-1",
          sourceLabel: "Task · Prepare launch brief",
          suggestedTitle: "Prepare launch brief",
          status: "inProgress",
          priority: "high",
          dueAt: "2026-08-17T14:00:00.000Z",
          assignees: [
            { id: "user-1", name: "Maya Chen", type: "human" },
          ],
        },
      ],
    });
  });

  it("preserves task authorization failures instead of reporting an empty list", async () => {
    const runtime = createPreviewCalendarHostRuntime({
      deniedActions: [CALENDAR_HOST_ACTION.readTasks],
      tasks: [task()],
    });
    const result = await createCalendarPlatform(
      runtime,
    ).listTaskWorkBlockSources("workspace-1");

    expect(result).toEqual({
      ok: false,
      error: {
        code: "authorization-denied",
        operation: "tasks.list",
        message: "TAP did not authorize task.read.",
        actionId: "task.read",
      },
    });
  });

  it("normalizes and sorts saved workflows", async () => {
    const runtime = createPreviewCalendarHostRuntime({
      workflows: [
        workflow({ id: "workflow-z", name: "Notify attendees" }),
        workflow({ id: "workflow-a", name: "Approve booking" }),
      ],
    });
    const result = await createCalendarPlatform(runtime).listSavedWorkflows(
      "workspace-1",
    );

    expect(result).toEqual({
      ok: true,
      value: [
        {
          id: "workflow-a",
          name: "Approve booking",
          type: "dag",
          createdAt: "2026-08-12T12:00:00.000Z",
          updatedAt: "2026-08-14T16:00:00.000Z",
        },
        {
          id: "workflow-z",
          name: "Notify attendees",
          type: "dag",
          createdAt: "2026-08-12T12:00:00.000Z",
          updatedAt: "2026-08-14T16:00:00.000Z",
        },
      ],
    });
  });

  it("normalizes host failures instead of leaking rejected promises", async () => {
    const runtime = createPreviewCalendarHostRuntime();
    const failingRuntime: CalendarHostRuntime = {
      ...runtime,
      workflows: {
        list: async () => {
          throw new Error("workflow service unavailable");
        },
      },
    };
    const result = await createCalendarPlatform(
      failingRuntime,
    ).listSavedWorkflows();

    expect(result).toEqual({
      ok: false,
      error: {
        code: "host-failure",
        operation: "workflows.list",
        actionId: "workflows.list",
        message: "workflow service unavailable",
      },
    });
  });
});
