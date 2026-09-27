import type {
  MiniAppChannel,
  MiniAppNotificationResult,
  MiniAppPlatformApi,
  MiniAppTask,
  MiniAppWorkflow,
} from "@theaiplatform/miniapp-sdk/sdk";

type MaybePromise<T> = T | Promise<T>;

export const CALENDAR_NOTIFICATION_CHANNEL_NAME =
  "TAP Calendar Notifications";
export const CALENDAR_NOTIFICATION_CHANNEL_DESCRIPTION =
  "Private scheduling updates and approval notices from TAP Calendar.";

export const CALENDAR_HOST_ACTION = Object.freeze({
  showNotification: "notifications.show",
  listChannels: "channels.list",
  createChannel: "channels.create",
  readChannel: "channels.read",
  sendChannelMessage: "channels.send-message",
  readTasks: "task.read",
  listWorkflows: "workflows.list",
} as const);

export type CalendarHostAction =
  (typeof CALENDAR_HOST_ACTION)[keyof typeof CALENDAR_HOST_ACTION];

/**
 * The exact published SDK namespaces used by TAP Calendar.
 *
 * A surface must inject these namespaces from `sdk`. This module deliberately
 * does not import the SDK singleton, auto-detect a host, or silently fall back
 * to preview data.
 */
export interface CalendarHostRuntime {
  readonly environment: "tap-host" | "preview";
  readonly authorization: MiniAppPlatformApi["authorization"];
  readonly channels: Pick<
    MiniAppPlatformApi["channels"],
    "create" | "list" | "getAccess" | "sendMessage"
  >;
  readonly notifications?: MiniAppPlatformApi["notifications"];
  readonly tasks?: Pick<NonNullable<MiniAppPlatformApi["tasks"]>, "list">;
  readonly workflows: Pick<MiniAppPlatformApi["workflows"], "list">;
}

export type CalendarPlatformErrorCode =
  | "authorization-denied"
  | "capability-unavailable"
  | "channel-archived"
  | "channel-membership-required"
  | "channel-send-unavailable"
  | "host-failure"
  | "invalid-input";

export type CalendarPlatformOperation =
  | "notifications.show"
  | "channels.list"
  | "channels.create"
  | "channels.getAccess"
  | "channels.sendMessage"
  | "tasks.list"
  | "workflows.list";

export interface CalendarPlatformError {
  readonly code: CalendarPlatformErrorCode;
  readonly operation: CalendarPlatformOperation;
  readonly message: string;
  readonly actionId?: CalendarHostAction;
}

export interface CalendarPlatformFailure {
  readonly ok: false;
  readonly error: CalendarPlatformError;
}

export type CalendarPlatformResult<T> =
  | { readonly ok: true; readonly value: T }
  | CalendarPlatformFailure;

export type ImmediateNotification =
  | { readonly delivery: "shown" }
  | {
      readonly delivery: "suppressed";
      readonly reason:
        | "notifications-disabled"
        | "permission-denied"
        | "rate-limited";
    };

export interface CalendarNotificationChannel {
  readonly channelId: string;
  readonly name: string;
  readonly visibility: "private";
  readonly created: boolean;
}

export type CalendarChannelSummaryKind =
  | "booking"
  | "approval"
  | "cancellation"
  | "health";

export interface PostCalendarSummaryInput {
  readonly workspaceId?: string;
  readonly channelId: string;
  /**
   * Stable product-owned id, such as `tap-calendar:booking:<booking-id>:v1`.
   * TAP uses it to return the original message instead of creating a replay.
   */
  readonly clientMessageId: string;
  readonly kind: CalendarChannelSummaryKind;
  readonly title: string;
  readonly summary: string;
}

export interface PostedCalendarSummary {
  readonly channelId: string;
  readonly messageId: string;
  readonly clientMessageId: string;
}

export interface TapTaskWorkBlockSource {
  readonly kind: "task";
  readonly sourceId: string;
  readonly sourceLabel: string;
  readonly suggestedTitle: string;
  readonly status: MiniAppTask["phase"];
  readonly priority: MiniAppTask["priority"];
  readonly dueAt: string | null;
  readonly assignees: readonly {
    readonly id: string;
    readonly name: string;
    readonly type: "human" | "specialist";
  }[];
}

export interface CalendarSavedWorkflow {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface EnsureCalendarNotificationChannelInput {
  readonly workspaceId?: string;
  readonly name?: string;
}

export interface CalendarPlatform {
  notifyImmediately(
    message: string,
  ): Promise<CalendarPlatformResult<ImmediateNotification>>;
  ensurePrivateNotificationChannel(
    input?: EnsureCalendarNotificationChannelInput,
  ): Promise<CalendarPlatformResult<CalendarNotificationChannel>>;
  postChannelSummary(
    input: PostCalendarSummaryInput,
  ): Promise<CalendarPlatformResult<PostedCalendarSummary>>;
  listTaskWorkBlockSources(
    workspaceId?: string,
  ): Promise<CalendarPlatformResult<readonly TapTaskWorkBlockSource[]>>;
  listSavedWorkflows(
    workspaceId?: string,
  ): Promise<CalendarPlatformResult<readonly CalendarSavedWorkflow[]>>;
}

const success = <T>(value: T): CalendarPlatformResult<T> => ({
  ok: true,
  value,
});

const failure = (
  code: CalendarPlatformErrorCode,
  operation: CalendarPlatformOperation,
  message: string,
  actionId?: CalendarHostAction,
): CalendarPlatformFailure => ({
  ok: false,
  error: {
    code,
    operation,
    message,
    ...(actionId === undefined ? {} : { actionId }),
  },
});

const describeError = (error: unknown): string =>
  error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "The TAP host did not complete the request.";

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const isoTimestamp = (timestamp: number): string => {
  const date = new Date(timestamp);
  return Number.isNaN(date.valueOf())
    ? "1970-01-01T00:00:00.000Z"
    : date.toISOString();
};

const invalidText = (
  value: string,
  maximumLength: number,
): boolean =>
  value.trim().length === 0 ||
  value.length > maximumLength ||
  value !== value.trim();

const workspaceScope = (
  workspaceId: string | undefined,
): { readonly workspaceId?: string } =>
  workspaceId === undefined ? {} : { workspaceId };

export function createCalendarPlatform(
  runtime: CalendarHostRuntime,
): CalendarPlatform {
  if (runtime === undefined || runtime === null) {
    throw new Error(
      "TAP Calendar requires an explicit tap-host or preview runtime.",
    );
  }

  const authorize = async (
    actionId: CalendarHostAction,
    autonomy: "listen" | "do",
    operation: CalendarPlatformOperation,
  ): Promise<CalendarPlatformFailure | null> => {
    try {
      const decision = await runtime.authorization.check({
        actionId,
        autonomy,
      });
      return decision.allowed
        ? null
        : failure(
            "authorization-denied",
            operation,
            `TAP did not authorize ${actionId}.`,
            actionId,
          );
    } catch (error) {
      return failure(
        "host-failure",
        operation,
        describeError(error),
        actionId,
      );
    }
  };

  const platform: CalendarPlatform = {
    async notifyImmediately(message) {
      if (message.trim().length === 0 || message.length > 512) {
        return failure(
          "invalid-input",
          "notifications.show",
          "Notification messages must contain 1 to 512 characters.",
        );
      }
      if (runtime.notifications === undefined) {
        return failure(
          "capability-unavailable",
          "notifications.show",
          "This TAP host does not expose system notifications.",
        );
      }

      const permission = await authorize(
        CALENDAR_HOST_ACTION.showNotification,
        "do",
        "notifications.show",
      );
      if (permission !== null) return permission;

      try {
        const result = await runtime.notifications.show({ message });
        return success(
          result.disposition === "shown"
            ? { delivery: "shown" as const }
            : {
                delivery: "suppressed" as const,
                reason: result.reason,
              },
        );
      } catch (error) {
        return failure(
          "host-failure",
          "notifications.show",
          describeError(error),
          CALENDAR_HOST_ACTION.showNotification,
        );
      }
    },

    async ensurePrivateNotificationChannel(input = {}) {
      const name = input.name ?? CALENDAR_NOTIFICATION_CHANNEL_NAME;
      if (invalidText(name, 256)) {
        return failure(
          "invalid-input",
          "channels.list",
          "The notification channel name must contain 1 to 256 characters without surrounding whitespace.",
        );
      }

      const listPermission = await authorize(
        CALENDAR_HOST_ACTION.listChannels,
        "listen",
        "channels.list",
      );
      if (listPermission !== null) return listPermission;

      let channels: readonly MiniAppChannel[];
      try {
        channels = (
          await runtime.channels.list(workspaceScope(input.workspaceId))
        ).rooms;
      } catch (error) {
        return failure(
          "host-failure",
          "channels.list",
          describeError(error),
          CALENDAR_HOST_ACTION.listChannels,
        );
      }

      const existing = [...channels]
        .filter(
          channel =>
            channel.title === name &&
            channel.visibility === "private" &&
            !channel.archived,
        )
        .sort(
          (left, right) =>
            left.createdAt - right.createdAt ||
            compareText(left.roomId, right.roomId),
        )[0];
      if (existing !== undefined) {
        return success({
          channelId: existing.roomId,
          name,
          visibility: "private",
          created: false,
        });
      }

      const createPermission = await authorize(
        CALENDAR_HOST_ACTION.createChannel,
        "do",
        "channels.create",
      );
      if (createPermission !== null) return createPermission;

      try {
        const created = await runtime.channels.create({
          ...workspaceScope(input.workspaceId),
          name,
          description: CALENDAR_NOTIFICATION_CHANNEL_DESCRIPTION,
          visibility: "private",
        });
        return success({
          channelId: created.roomId,
          name,
          visibility: "private",
          created: true,
        });
      } catch (error) {
        return failure(
          "host-failure",
          "channels.create",
          describeError(error),
          CALENDAR_HOST_ACTION.createChannel,
        );
      }
    },

    async postChannelSummary(input) {
      if (invalidText(input.channelId, 512)) {
        return failure(
          "invalid-input",
          "channels.sendMessage",
          "A valid channel id is required.",
        );
      }
      if (invalidText(input.clientMessageId, 512)) {
        return failure(
          "invalid-input",
          "channels.sendMessage",
          "A stable clientMessageId containing 1 to 512 characters is required.",
        );
      }
      if (input.title.trim().length === 0 || input.summary.trim().length === 0) {
        return failure(
          "invalid-input",
          "channels.sendMessage",
          "Calendar summaries require both a title and summary.",
        );
      }

      const readPermission = await authorize(
        CALENDAR_HOST_ACTION.readChannel,
        "listen",
        "channels.getAccess",
      );
      if (readPermission !== null) return readPermission;

      let access: Awaited<
        ReturnType<CalendarHostRuntime["channels"]["getAccess"]>
      >;
      try {
        access = await runtime.channels.getAccess({
          ...workspaceScope(input.workspaceId),
          channelId: input.channelId,
        });
      } catch (error) {
        return failure(
          "host-failure",
          "channels.getAccess",
          describeError(error),
          CALENDAR_HOST_ACTION.readChannel,
        );
      }

      if (access.archived) {
        return failure(
          "channel-archived",
          "channels.getAccess",
          "The calendar notification channel is archived.",
        );
      }
      if (!access.isParticipant) {
        return failure(
          "channel-membership-required",
          "channels.getAccess",
          "Join the channel before posting calendar updates.",
        );
      }
      if (!access.capabilities.includes("send_message")) {
        return failure(
          "channel-send-unavailable",
          "channels.getAccess",
          "Your channel role cannot send calendar updates.",
        );
      }

      const sendPermission = await authorize(
        CALENDAR_HOST_ACTION.sendChannelMessage,
        "do",
        "channels.sendMessage",
      );
      if (sendPermission !== null) return sendPermission;

      const body = `${input.title}\n${input.summary}`;
      try {
        const posted = await runtime.channels.sendMessage({
          ...workspaceScope(input.workspaceId),
          channelId: input.channelId,
          clientMessageId: input.clientMessageId,
          name: "TAP Calendar",
          body,
          content: body,
          messageContent: {
            type: "tap.calendar.summary",
            version: 1,
            summaryKind: input.kind,
            title: input.title,
            summary: input.summary,
          },
        });
        return success({
          channelId: input.channelId,
          messageId: posted.messageId,
          clientMessageId: posted.clientMessageId,
        });
      } catch (error) {
        return failure(
          "host-failure",
          "channels.sendMessage",
          describeError(error),
          CALENDAR_HOST_ACTION.sendChannelMessage,
        );
      }
    },

    async listTaskWorkBlockSources(workspaceId) {
      if (runtime.tasks === undefined) {
        return failure(
          "capability-unavailable",
          "tasks.list",
          "This TAP host does not expose workspace tasks.",
        );
      }

      const permission = await authorize(
        CALENDAR_HOST_ACTION.readTasks,
        "listen",
        "tasks.list",
      );
      if (permission !== null) return permission;

      try {
        const listed = await runtime.tasks.list({
          ...workspaceScope(workspaceId),
          includeArchived: false,
        });
        const sources = listed.tasks
          .filter(task => !task.archived)
          .map<TapTaskWorkBlockSource>(task => ({
            kind: "task",
            sourceId: task.id,
            sourceLabel: `Task · ${task.title}`,
            suggestedTitle: task.title,
            status: task.phase,
            priority: task.priority,
            dueAt:
              task.dueAt === undefined
                ? null
                : isoTimestamp(task.dueAt),
            assignees: [],
          }))
          .sort(
            (left, right) =>
              compareText(left.dueAt ?? "\uffff", right.dueAt ?? "\uffff") ||
              compareText(left.suggestedTitle, right.suggestedTitle) ||
              compareText(left.sourceId, right.sourceId),
          );
        return success(sources);
      } catch (error) {
        return failure(
          "host-failure",
          "tasks.list",
          describeError(error),
          CALENDAR_HOST_ACTION.readTasks,
        );
      }
    },

    async listSavedWorkflows(workspaceId) {
      const permission = await authorize(
        CALENDAR_HOST_ACTION.listWorkflows,
        "listen",
        "workflows.list",
      );
      if (permission !== null) return permission;

      try {
        const listed = await runtime.workflows.list(workspaceScope(workspaceId));
        return success(
          listed.workflows
            .map<CalendarSavedWorkflow>(workflow => ({
              id: workflow.id,
              name: workflow.name,
              type: workflow.type,
              createdAt: isoTimestamp(workflow.createdAt),
              updatedAt: isoTimestamp(workflow.updatedAt),
            }))
            .sort(
              (left, right) =>
                compareText(left.name, right.name) ||
                compareText(left.id, right.id),
            ),
        );
      } catch (error) {
        return failure(
          "host-failure",
          "workflows.list",
          describeError(error),
          CALENDAR_HOST_ACTION.listWorkflows,
        );
      }
    },
  };

  return Object.freeze(platform);
}

export interface PreviewChannelAccess {
  readonly archived: boolean;
  readonly capabilities: readonly string[];
  readonly isParticipant: boolean;
  readonly visibleUntilSequence?: number | null;
}

export interface PreviewCalendarHostOptions {
  readonly deniedActions?: readonly CalendarHostAction[];
  readonly notificationResult?: MiniAppNotificationResult;
  readonly channels?: readonly MiniAppChannel[];
  readonly channelAccess?: Readonly<Record<string, PreviewChannelAccess>>;
  readonly tasks?: readonly MiniAppTask[];
  readonly workflows?: readonly MiniAppWorkflow[];
  readonly now?: () => number;
}

export interface PreviewPostedMessage {
  readonly channelId: string;
  readonly clientMessageId: string;
  readonly messageId: string;
  readonly body: string;
}

export interface PreviewCalendarHostSnapshot {
  readonly authorizationChecks: readonly {
    readonly actionId: string;
    readonly autonomy: "listen" | "plan" | "do";
  }[];
  readonly notifications: readonly string[];
  readonly channels: readonly MiniAppChannel[];
  readonly messages: readonly PreviewPostedMessage[];
}

export interface PreviewCalendarHostRuntime extends CalendarHostRuntime {
  readonly environment: "preview";
  snapshot(): PreviewCalendarHostSnapshot;
}

const cloneChannel = (channel: MiniAppChannel): MiniAppChannel => ({
  ...channel,
});

const cloneTask = (task: MiniAppTask): MiniAppTask => ({
  ...task,
  extensions: structuredClone(task.extensions),
});

const cloneWorkflow = (workflow: MiniAppWorkflow): MiniAppWorkflow => ({
  ...workflow,
});

/**
 * Explicit deterministic preview runtime. It is opt-in and in-memory only;
 * packaged surfaces must inject the real TAP SDK namespaces instead.
 */
export function createPreviewCalendarHostRuntime(
  options: PreviewCalendarHostOptions = {},
): PreviewCalendarHostRuntime {
  const denied = new Set(options.deniedActions ?? []);
  const authorizationChecks: {
    actionId: string;
    autonomy: "listen" | "plan" | "do";
  }[] = [];
  const notifications: string[] = [];
  const channels = (options.channels ?? []).map(cloneChannel);
  const tasks = (options.tasks ?? []).map(cloneTask);
  const workflows = (options.workflows ?? []).map(cloneWorkflow);
  const messages: PreviewPostedMessage[] = [];
  const deduplicatedMessages = new Map<
    string,
    { messageId: string; clientMessageId: string }
  >();
  const now = options.now ?? (() => Date.now());
  let nextChannelNumber = channels.length + 1;
  let nextMessageNumber = 1;

  const nextChannelId = (): string => {
    let candidate = `preview-calendar-channel-${nextChannelNumber}`;
    while (channels.some(channel => channel.roomId === candidate)) {
      nextChannelNumber += 1;
      candidate = `preview-calendar-channel-${nextChannelNumber}`;
    }
    nextChannelNumber += 1;
    return candidate;
  };

  const runtime: PreviewCalendarHostRuntime = {
    environment: "preview",
    authorization: {
      async check(input) {
        authorizationChecks.push({ ...input });
        return { allowed: !denied.has(input.actionId as CalendarHostAction) };
      },
    },
    notifications: {
      show(input): MaybePromise<MiniAppNotificationResult> {
        notifications.push(input.message);
        return options.notificationResult ?? { disposition: "shown" };
      },
    },
    channels: {
      list() {
        return {
          rooms: channels.map(cloneChannel),
          readMode: "preview",
        };
      },
      create(input) {
        const timestamp = now();
        const roomId = nextChannelId();
        channels.push({
          roomId,
          title: input.name,
          kind: "channel",
          ...(input.description === undefined
            ? {}
            : { description: input.description }),
          visibility: input.visibility ?? "workspace",
          archived: false,
          ...(input.projectId === null || input.projectId === undefined
            ? {}
            : { projectId: input.projectId }),
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        return { roomId };
      },
      getAccess(input) {
        const configured = options.channelAccess?.[input.channelId];
        if (configured !== undefined) {
          return {
            ...configured,
            capabilities: [...configured.capabilities],
          };
        }
        const channel = channels.find(item => item.roomId === input.channelId);
        if (channel === undefined) {
          throw new Error("The preview channel does not exist.");
        }
        return {
          archived: channel.archived,
          capabilities: ["observe", "send_message"],
          isParticipant: true,
          visibleUntilSequence: null,
        };
      },
      sendMessage(input) {
        const clientMessageId = input.clientMessageId;
        if (clientMessageId === undefined) {
          throw new Error(
            "Preview calendar messages require a stable clientMessageId.",
          );
        }
        const dedupeKey = `${input.channelId}\u0000${clientMessageId}`;
        const replay = deduplicatedMessages.get(dedupeKey);
        if (replay !== undefined) return replay;

        const posted = {
          channelId: input.channelId,
          clientMessageId,
          messageId: `preview-calendar-message-${nextMessageNumber}`,
          body: input.body ?? input.content,
        };
        nextMessageNumber += 1;
        messages.push(posted);
        const result = {
          messageId: posted.messageId,
          clientMessageId,
        };
        deduplicatedMessages.set(dedupeKey, result);
        return result;
      },
    },
    tasks: {
      list(input) {
        const listed = input?.includeArchived
          ? tasks
          : tasks.filter(task => !task.archived);
        return { tasks: listed.map(cloneTask) };
      },
    },
    workflows: {
      list() {
        return { workflows: workflows.map(cloneWorkflow) };
      },
    },
    snapshot() {
      return {
        authorizationChecks: authorizationChecks.map(check => ({ ...check })),
        notifications: [...notifications],
        channels: channels.map(cloneChannel),
        messages: messages.map(message => ({ ...message })),
      };
    },
  };

  return runtime;
}
