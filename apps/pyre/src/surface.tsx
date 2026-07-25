import "@theaiplatform/miniapp-sdk/ui/styles.css";
import type {
  TapFederatedSurfaceMount,
  TapFederatedSurfaceMountContext,
} from "@theaiplatform/miniapp-sdk/surface";
import { installMiniAppAppearanceSync } from "@theaiplatform/miniapp-sdk/web";
import { createRoot } from "react-dom/client";
import { PyreApp } from "./app";
import { PyreRuntimeIdProvider } from "./runtime-id";
import "./styles.css";

export const surfaceTarget = "desktop" as const;
export function mount(
  container: HTMLElement,
  context: TapFederatedSurfaceMountContext,
): TapFederatedSurfaceMount {
  const stop = installMiniAppAppearanceSync();
  const root = createRoot(container);
  root.render(
    <PyreRuntimeIdProvider randomUUID={() => context.entropy.randomUUID()}>
      <PyreApp surfaceContext={context} />
    </PyreRuntimeIdProvider>,
  );
  void context.events.publish("pyre.surface.mounted", {
    instanceId: context.instanceId,
  });
  let mounted = true;
  return {
    unmount() {
      if (!mounted) return;
      mounted = false;
      stop();
      root.unmount();
      void context.events.publish("pyre.surface.unmounted", {
        instanceId: context.instanceId,
      });
    },
  };
}
export default Object.freeze({ mount, surfaceTarget });
