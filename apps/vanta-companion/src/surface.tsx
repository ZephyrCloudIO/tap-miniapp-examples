import '@theaiplatform/miniapp-sdk/ui/styles.css';
import type {
  TapFederatedSurfaceMount,
  TapFederatedSurfaceMountContext,
} from '@theaiplatform/miniapp-sdk/surface';
import { installMiniAppAppearanceSync } from '@theaiplatform/miniapp-sdk/web';
import { createRoot } from 'react-dom/client';
import { VantaCompanionApp } from './app';
import './styles.css';
export const surfaceTarget = 'desktop' as const;
export function mount(
  container: HTMLElement,
  context: TapFederatedSurfaceMountContext,
): TapFederatedSurfaceMount {
  const stop = installMiniAppAppearanceSync();
  const root = createRoot(container);
  root.render(
    <VantaCompanionApp
      hostWorkspaceId={context.workspaceId ?? ''}
      hostChannelId={context.channelId ?? ''}
    />,
  );
  void context.events.publish('surface.mounted', {
    contributionId: context.contributionId,
    instanceId: context.instanceId,
  });
  return {
    unmount() {
      stop();
      root.unmount();
      void context.events.publish('surface.unmounted', {
        contributionId: context.contributionId,
        instanceId: context.instanceId,
      });
    },
  };
}
export default Object.freeze({ mount, surfaceTarget });
