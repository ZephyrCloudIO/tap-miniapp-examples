import '@theaiplatform/miniapp-sdk/ui/styles.css';
import type {
  TapFederatedSurfaceMount,
  TapFederatedSurfaceMountContext,
} from '@theaiplatform/miniapp-sdk/surface';
import {
  applyMiniAppTheme,
  installMiniAppAppearanceSync,
} from '@theaiplatform/miniapp-sdk/web';
import { sdk } from '@theaiplatform/miniapp-sdk/sdk';
import { createEmailDiagnostics } from './diagnostics';
import { createDiagnosticRoot } from './diagnostic-root';
import { TapEmailApp } from './app';
import './styles.css';

export const surfaceTarget = 'desktop' as const;

export function mount(
  container: HTMLElement,
  context: TapFederatedSurfaceMountContext,
): TapFederatedSurfaceMount {
  const diagnostics = createEmailDiagnostics({ context, storage: sdk.storage });
  const root = createDiagnosticRoot(container, diagnostics);
  let mounted = true;
  const stopAppearanceSync = installMiniAppAppearanceSync({
    applyTheme(theme) {
      applyMiniAppTheme(theme);
      if (mounted) root.render(<TapEmailApp appTheme={theme} surfaceContext={context} diagnostics={diagnostics} />);
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
