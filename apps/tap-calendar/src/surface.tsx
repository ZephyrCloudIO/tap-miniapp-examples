import type {
  TapFederatedSurfaceMount,
  TapFederatedSurfaceMountContext,
} from "@theaiplatform/miniapp-sdk/surface";
import { installMiniAppAppearanceSync } from "@theaiplatform/miniapp-sdk/web";
import { createRoot } from "react-dom/client";
import { TapCalendarApp } from "./app";
import "./styles.css";

export const surfaceTarget = "desktop" as const;

function publishSurfaceEvent(
  context: TapFederatedSurfaceMountContext,
  event: "calendar.surface.mounted" | "calendar.surface.unmounted",
): void {
  void Promise.resolve(
    context.events.publish(event, {
      contributionId: context.contributionId,
      instanceId: context.instanceId,
    }),
  ).catch(() => undefined);
}

export function mount(
  container: HTMLElement,
  context: TapFederatedSurfaceMountContext,
): TapFederatedSurfaceMount {
  const stopAppearanceSync = installMiniAppAppearanceSync();
  const root = createRoot(container);
  root.render(<TapCalendarApp context={context} />);
  publishSurfaceEvent(context, "calendar.surface.mounted");

  let mounted = true;
  return {
    unmount() {
      if (!mounted) return;
      mounted = false;
      stopAppearanceSync();
      root.unmount();
      publishSurfaceEvent(context, "calendar.surface.unmounted");
    },
  };
}

export default Object.freeze({ mount, surfaceTarget });
