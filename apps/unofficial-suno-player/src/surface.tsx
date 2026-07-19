import type {
  TapFederatedSurfaceMount,
  TapFederatedSurfaceMountContext,
} from "@theaiplatform/miniapp-sdk/surface";
import { installMiniAppAppearanceSync } from "@theaiplatform/miniapp-sdk/web";
import { createRoot } from "react-dom/client";
import { PlayerApp } from "./app";
import "./styles.css";

export const surfaceTarget = "desktop" as const;

const publishLifecycleEvent = (
  context: TapFederatedSurfaceMountContext,
  name: "player.surface.mounted" | "player.surface.unmounted",
): void => {
  void Promise.resolve(context.events.publish(name, {
    contributionId: context.contributionId,
    instanceId: context.instanceId,
  })).catch((error: unknown) => {
    console.error(`TAP event ${name} failed after the surface lifecycle transition.`, error);
  });
};

export function mount(container: HTMLElement, context: TapFederatedSurfaceMountContext): TapFederatedSurfaceMount {
  const stopAppearanceSync = installMiniAppAppearanceSync();
  const root = createRoot(container);
  root.render(<PlayerApp preview={false} context={context} />);
  publishLifecycleEvent(context, "player.surface.mounted");
  let mounted = true;
  return {
    unmount() {
      if (!mounted) return;
      mounted = false;
      publishLifecycleEvent(context, "player.surface.unmounted");
      stopAppearanceSync();
      root.unmount();
      container.replaceChildren();
    },
  };
}

export default Object.freeze({ mount, surfaceTarget });
