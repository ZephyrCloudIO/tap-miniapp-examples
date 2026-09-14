import { sdk } from '@theaiplatform/miniapp-sdk/sdk';
import type { TapFederatedSurfaceMountContext } from '@theaiplatform/miniapp-sdk/surface';

export const EMAIL_NETWORK_ACTION = 'network.request';
export const EMAIL_OPEN_EXTERNAL_ACTION = 'navigation.open-external';
export const HOST_AUTHORITY_TIMEOUT_MS = 10_000;

export class HostAuthorityTimeoutError extends Error {
  readonly code = 'host_authority_timeout' as const;

  constructor(timeoutMs: number) {
    super(
      `TAP did not confirm this miniapp within ${Math.ceil(timeoutMs / 1_000)} seconds. Approve the API Workbench prompt, then retry.`,
    );
    this.name = 'HostAuthorityTimeoutError';
  }
}

export async function waitForHostAuthority(
  context: TapFederatedSurfaceMountContext | undefined,
  timeoutMs = HOST_AUTHORITY_TIMEOUT_MS,
): Promise<void> {
  if (!context || context.hostAuthority.getSnapshot()) return;
  await new Promise<void>((resolve, reject) => {
    let unsubscribe: (() => void) | undefined;
    let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
    let settled = false;

    const cleanup = () => {
      if (timeout !== undefined) globalThis.clearTimeout(timeout);
      unsubscribe?.();
    };
    const confirm = () => {
      if (settled || !context.hostAuthority.getSnapshot()) return;
      settled = true;
      cleanup();
      resolve();
    };

    try {
      unsubscribe = context.hostAuthority.subscribe(confirm);
    } catch (error) {
      settled = true;
      reject(error);
      return;
    }
    // Some host stores publish their current snapshot synchronously from
    // subscribe(). Clean up the now-assigned subscription in that case.
    if (settled) {
      unsubscribe();
      return;
    }

    timeout = globalThis.setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new HostAuthorityTimeoutError(timeoutMs));
    }, Math.max(0, timeoutMs));
    confirm();
  });
}

export async function hasEmailAuthority(
  context: TapFederatedSurfaceMountContext | undefined,
  actionId: string,
): Promise<boolean> {
  if (!context) return false;
  try {
    await waitForHostAuthority(context);
    return (
      await sdk.authorization.check({ actionId, autonomy: 'do' })
    ).allowed;
  } catch {
    return false;
  }
}
