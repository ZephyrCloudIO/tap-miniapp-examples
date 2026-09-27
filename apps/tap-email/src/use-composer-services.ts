import { sdk } from '@theaiplatform/miniapp-sdk/sdk';
import type { TapFederatedSurfaceMountContext } from '@theaiplatform/miniapp-sdk/surface';
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { ComposerServices } from './composer-services';

export function useComposerServices(context: TapFederatedSurfaceMountContext | undefined, preview: boolean): ComposerServices {
  const subscribe = useCallback((listener: () => void) => context?.owner?.subscribe(listener) ?? (() => {}), [context]);
  const snapshot = useCallback(() => context?.owner?.getSnapshot() ?? null, [context]);
  const owner = useSyncExternalStore(subscribe, snapshot, snapshot);
  // A retained workspace surface can change its selected conversation without
  // remounting. Never reuse an earlier owner's inference context.
  const workspaceId = preview ? null : owner ? owner.workspaceId : context?.workspaceId ?? null;
  const conversationId = preview ? null : owner ? owner.conversationId : context?.conversationId ?? null;
  return useMemo(() => ({ platform: sdk, workspaceId, conversationId }), [workspaceId, conversationId]);
}
