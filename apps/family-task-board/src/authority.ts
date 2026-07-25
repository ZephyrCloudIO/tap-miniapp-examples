import { sdk } from "@theaiplatform/miniapp-sdk/sdk";
import type { TapFederatedSurfaceMountContext } from "@theaiplatform/miniapp-sdk/surface";

export const FAMILY_MANAGE_ACTION = "family-task-board.manage";

export async function waitForHostAuthority(
  context: TapFederatedSurfaceMountContext | undefined,
): Promise<void> {
  if (!context || context.hostAuthority.getSnapshot()) return;
  await new Promise<void>((resolve) => {
    let unsubscribe = () => {};
    const confirm = () => {
      if (!context.hostAuthority.getSnapshot()) return;
      unsubscribe();
      resolve();
    };
    unsubscribe = context.hostAuthority.subscribe(confirm);
    confirm();
  });
}

export async function canManageFamily(
  context: TapFederatedSurfaceMountContext | undefined,
  preview: boolean,
): Promise<boolean> {
  if (preview) return true;
  if (!context) return false;
  await waitForHostAuthority(context);
  try {
    return (
      await sdk.authorization.check({
        actionId: FAMILY_MANAGE_ACTION,
        autonomy: "do",
      })
    ).allowed;
  } catch {
    return false;
  }
}
