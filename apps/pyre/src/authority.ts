import { sdk } from "@theaiplatform/miniapp-sdk/sdk";
import type { TapFederatedSurfaceMountContext } from "@theaiplatform/miniapp-sdk/surface";

export const PYRE_INVESTIGATE_ACTION = "pyre.investigate";
export const PYRE_APPROVE_ACTION = "pyre.approve";

export type PyreAuthorityAction =
  | typeof PYRE_INVESTIGATE_ACTION
  | typeof PYRE_APPROVE_ACTION;

export type PyreAuthorityGuard = (
  actionId: PyreAuthorityAction,
) => Promise<boolean>;

const actionAutonomy: Readonly<
  Record<PyreAuthorityAction, "listen" | "plan">
> = {
  [PYRE_INVESTIGATE_ACTION]: "plan",
  [PYRE_APPROVE_ACTION]: "listen",
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

export async function hasPyreAuthority(
  context: TapFederatedSurfaceMountContext | undefined,
  preview: boolean,
  actionId: PyreAuthorityAction,
): Promise<boolean> {
  if (preview) return true;
  if (!context) return false;
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

export async function requirePyreAuthority(
  context: TapFederatedSurfaceMountContext | undefined,
  preview: boolean,
  actionId: PyreAuthorityAction,
): Promise<void> {
  if (await hasPyreAuthority(context, preview, actionId)) return;
  const operation =
    actionId === PYRE_APPROVE_ACTION
      ? "approve investigation decisions"
      : "investigate incidents";
  throw new Error(
    `TAP authorization does not allow this miniapp to ${operation}.`,
  );
}
