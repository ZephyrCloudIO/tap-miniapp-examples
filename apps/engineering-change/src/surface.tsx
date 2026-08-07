import "@theaiplatform/miniapp-sdk/ui/styles.css";
import type {
  TapFederatedSurfaceMount,
  TapFederatedSurfaceMountContext,
} from "@theaiplatform/miniapp-sdk/surface";
import { installMiniAppAppearanceSync } from "@theaiplatform/miniapp-sdk/web";
import { createRoot } from "react-dom/client";
import { EngineeringChangeApp } from "./app";
import { EngineeringChangeRuntimeIdProvider } from "./runtime-id";
import "./styles.css";

export const surfaceTarget = "desktop" as const;

export function mount(
  container: HTMLElement,
  context: TapFederatedSurfaceMountContext,
): TapFederatedSurfaceMount {
  const stop = installMiniAppAppearanceSync();
  const root = createRoot(container);
  root.render(
    <EngineeringChangeRuntimeIdProvider randomUUID={() => context.entropy.randomUUID()}>
      <EngineeringChangeApp surfaceContext={context} />
    </EngineeringChangeRuntimeIdProvider>,
  );
  void context.events.publish("engineering-change.surface.mounted", {
    instanceId: context.instanceId,
  });
  let mounted = true;
  return {
    unmount() {
      if (!mounted) return;
      mounted = false;
      stop();
      root.unmount();
      void context.events.publish("engineering-change.surface.unmounted", {
        instanceId: context.instanceId,
      });
    },
  };
}

export default Object.freeze({ mount, surfaceTarget });
