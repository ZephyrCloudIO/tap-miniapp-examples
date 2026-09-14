import '@theaiplatform/miniapp-sdk/ui/styles.css';
import type {
  TapFederatedSurfaceMount,
  TapFederatedSurfaceMountContext,
} from '@theaiplatform/miniapp-sdk/surface';
import {
  applyMiniAppTheme,
  installMiniAppAppearanceSync,
} from '@theaiplatform/miniapp-sdk/web';
import { createRoot } from 'react-dom/client';
import { TapEmailApp } from './app';
import './styles.css';

export const surfaceTarget = 'desktop' as const;

export function mount(
  container: HTMLElement,
  context: TapFederatedSurfaceMountContext,
): TapFederatedSurfaceMount {
  const root = createRoot(container);
  let mounted = true;
  const stopAppearanceSync = installMiniAppAppearanceSync({
    applyTheme(theme) {
      applyMiniAppTheme(theme);
      if (mounted) root.render(<TapEmailApp appTheme={theme} surfaceContext={context} />);
    },
  });
  void context.events.publish('tap-email.surface.mounted', {
    instanceId: context.instanceId,
  });
  return {
    unmount() {
      if (!mounted) return;
      mounted = false;
      stopAppearanceSync();
      root.unmount();
      void context.events.publish('tap-email.surface.unmounted', {
        instanceId: context.instanceId,
      });
    },
  };
}

export default Object.freeze({ mount, surfaceTarget });
