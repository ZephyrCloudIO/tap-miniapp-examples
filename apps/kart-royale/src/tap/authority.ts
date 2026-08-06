/**
 * Host-authority and permission checks for the packaged surface. Mirrors the
 * pattern the other examples use: wait for the host to project authority for
 * the exact release/frame, then check the declared action — and fail closed
 * when either side is unavailable.
 */
import { sdk } from '@theaiplatform/miniapp-sdk/sdk';
import type { TapFederatedSurfaceMountContext } from '@theaiplatform/miniapp-sdk/surface';

export const KART_ROYALE_PLAY_ACTION = 'kart-royale.play';

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

export async function canPlay(
  context: TapFederatedSurfaceMountContext | undefined,
  preview: boolean,
): Promise<boolean> {
  if (preview) return true;
  if (!context) return false;
  await waitForHostAuthority(context);
  try {
    return (
      await sdk.authorization.check({
        actionId: KART_ROYALE_PLAY_ACTION,
        autonomy: 'do',
      })
    ).allowed;
  } catch {
    return false;
  }
}
