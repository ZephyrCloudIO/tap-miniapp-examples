import { sdk } from '@theaiplatform/miniapp-sdk/sdk';
import type { TapFederatedSurfaceMountContext } from '@theaiplatform/miniapp-sdk/surface';

export const VANTA_COORDINATE_ACTION = 'vanta-companion.coordinate';
export const VANTA_ANALYZE_ACTION = 'vanta-companion.analyze';

export type VantaAuthorityAction =
  | typeof VANTA_COORDINATE_ACTION
  | typeof VANTA_ANALYZE_ACTION;

const actionAutonomy: Readonly<
  Record<VantaAuthorityAction, 'do' | 'plan'>
> = {
  [VANTA_COORDINATE_ACTION]: 'do',
  [VANTA_ANALYZE_ACTION]: 'plan',
};

async function waitForHostAuthority(
  context: TapFederatedSurfaceMountContext,
): Promise<void> {
  if (context.hostAuthority.getSnapshot()) return;
  await new Promise<void>(resolve => {
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

export async function hasVantaAuthority(
  context: TapFederatedSurfaceMountContext | undefined,
  preview: boolean,
  actionId: VantaAuthorityAction,
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

export async function requireVantaAuthority(
  context: TapFederatedSurfaceMountContext | undefined,
  preview: boolean,
  actionId: VantaAuthorityAction,
): Promise<void> {
  if (await hasVantaAuthority(context, preview, actionId)) return;
  const operation =
    actionId === VANTA_ANALYZE_ACTION
      ? 'analyze Vanta data'
      : 'coordinate Vanta work';
  throw new Error(
    `TAP authorization does not allow this miniapp to ${operation}.`,
  );
}
