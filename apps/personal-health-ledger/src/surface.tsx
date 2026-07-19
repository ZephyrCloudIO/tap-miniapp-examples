import type { TapFederatedSurfaceMount, TapFederatedSurfaceMountContext } from "@theaiplatform/miniapp-sdk/surface";
import { installMiniAppAppearanceSync } from "@theaiplatform/miniapp-sdk/web";
import { createRoot } from "react-dom/client";
import { HealthLedgerApp } from "./app";
import "./styles.css";
export const surfaceTarget = "desktop" as const;
export function mount(container: HTMLElement, context: TapFederatedSurfaceMountContext): TapFederatedSurfaceMount {
  const stopAppearanceSync = installMiniAppAppearanceSync();
  const root = createRoot(container);
  root.render(<HealthLedgerApp context={context} />);
  void context.events.publish("surface.mounted", { contributionId: context.contributionId, instanceId: context.instanceId });
  let mounted = true;
  return { unmount() { if (!mounted) return; mounted = false; stopAppearanceSync(); root.unmount(); void context.events.publish("surface.unmounted", { contributionId: context.contributionId, instanceId: context.instanceId }); } };
}
export default Object.freeze({ mount, surfaceTarget });
