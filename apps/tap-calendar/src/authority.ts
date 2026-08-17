import { sdk } from "@theaiplatform/miniapp-sdk/sdk";
import type { TapFederatedSurfaceMountContext } from "@theaiplatform/miniapp-sdk/surface";

export const CALENDAR_VIEW_ACTION = "calendar.view";
export const CALENDAR_MANAGE_ACTION = "calendar.manage";
export const CALENDAR_APPROVE_ACTION = "calendar.approve";
export const CALENDAR_PUBLISH_ACTION = "calendar.publish";
export const NETWORK_REQUEST_ACTION = "network.request";
export const CHANNELS_READ_ACTION = "channels.read";

export type CalendarAuthorityAction =
  | typeof CALENDAR_VIEW_ACTION
  | typeof CALENDAR_MANAGE_ACTION
  | typeof CALENDAR_APPROVE_ACTION
  | typeof CALENDAR_PUBLISH_ACTION
  | typeof NETWORK_REQUEST_ACTION
  | typeof CHANNELS_READ_ACTION;

export type CalendarAuthorityGuard = (
  actionId: CalendarAuthorityAction,
) => Promise<boolean>;

const actionAutonomy: Readonly<
  Record<CalendarAuthorityAction, "listen" | "do">
> = {
  [CALENDAR_VIEW_ACTION]: "listen",
  [CALENDAR_MANAGE_ACTION]: "do",
  [CALENDAR_APPROVE_ACTION]: "do",
  [CALENDAR_PUBLISH_ACTION]: "do",
  [NETWORK_REQUEST_ACTION]: "do",
  [CHANNELS_READ_ACTION]: "listen",
};

const actionOperation: Readonly<Record<CalendarAuthorityAction, string>> = {
  [CALENDAR_VIEW_ACTION]: "view calendars",
  [CALENDAR_MANAGE_ACTION]: "manage calendars",
  [CALENDAR_APPROVE_ACTION]: "approve meeting requests",
  [CALENDAR_PUBLISH_ACTION]: "publish booking pages",
  [NETWORK_REQUEST_ACTION]: "reach the Calendar gateway",
  [CHANNELS_READ_ACTION]: "read channel participants",
};

async function waitForHostAuthority(
  context: TapFederatedSurfaceMountContext,
): Promise<void> {
  if (context.hostAuthority.getSnapshot()) return;

  await new Promise<void>((resolve) => {
    let unsubscribe: (() => void) | undefined;
    let settled = false;

    const confirm = () => {
      if (settled || !context.hostAuthority.getSnapshot()) return;
      settled = true;
      unsubscribe?.();
      resolve();
    };

    unsubscribe = context.hostAuthority.subscribe(confirm);
    if (settled) unsubscribe();
    confirm();
  });
}

/**
 * The host only projects a federated surface after satisfying its manifest
 * `authorization.allOf` requirements. Use that exact mount admission for
 * baseline reads instead of repeating an advisory action check, which can be
 * evaluated against a different active scope after a channel surface mounts.
 */
export async function hasCalendarMountAuthority(
  context: TapFederatedSurfaceMountContext | undefined,
  preview: boolean,
): Promise<boolean> {
  if (preview) return true;
  if (!context?.userId?.trim()) return false;
  try {
    await waitForHostAuthority(context);
    return context.hostAuthority.getSnapshot();
  } catch {
    return false;
  }
}

export async function requireCalendarMountAuthority(
  context: TapFederatedSurfaceMountContext | undefined,
  preview: boolean,
): Promise<void> {
  if (!preview && !context?.userId?.trim()) {
    throw new Error(
      "TAP did not provide the canonical user identity required for Calendar access.",
    );
  }
  if (await hasCalendarMountAuthority(context, preview)) return;
  throw new Error(
    "TAP did not authorize this Calendar surface for its current owner.",
  );
}

export async function hasCalendarAuthority(
  context: TapFederatedSurfaceMountContext | undefined,
  preview: boolean,
  actionId: CalendarAuthorityAction,
): Promise<boolean> {
  if (preview) return true;
  if (!context?.userId?.trim()) return false;

  try {
    await waitForHostAuthority(context);
    return (
      await sdk.authorization.check({
        actionId,
        autonomy: actionAutonomy[actionId],
      })
    ).allowed;
  } catch {
    return false;
  }
}

export async function requireCalendarAuthority(
  context: TapFederatedSurfaceMountContext | undefined,
  preview: boolean,
  actionId: CalendarAuthorityAction,
): Promise<void> {
  if (await hasCalendarAuthority(context, preview, actionId)) return;

  throw new Error(
    `TAP authorization does not allow this miniapp to ${actionOperation[actionId]}.`,
  );
}
