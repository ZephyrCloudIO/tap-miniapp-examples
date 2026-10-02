import type {
  TapFederatedSurfaceMount,
  TapFederatedSurfaceMountContext,
} from "@theaiplatform/miniapp-sdk/surface";
import { mountPrRadarApp } from "../app/pr-radar-app";
import { registerLifecycleParticipant } from "../lifecycle-state";
import { renderPrRadarTemplate } from "./template";

export const surfaceTarget = "desktop" as const;
export const SURFACE_ID = "github-notify-dashboard";

export const prRadarParticipantId = (installationId: string): string =>
  `github-notify:${installationId}`;

const publish = (
  context: TapFederatedSurfaceMountContext,
  name: "surface.mounted" | "surface.unmounted",
): void => {
  try {
    void Promise.resolve(
      context.events.publish(name, {
        contributionId: context.contributionId,
        instanceId: context.instanceId,
        surfaceId: SURFACE_ID,
        target: surfaceTarget,
      }),
    ).catch(() => {
      // Observer failures do not invalidate a successful surface transition.
    });
  } catch {
    // Event publication is best effort after the mount boundary succeeds.
  }
};

export function mount(
  container: HTMLElement,
  context: TapFederatedSurfaceMountContext,
): TapFederatedSurfaceMount {
  const root = renderPrRadarTemplate(container);
  root.dataset.surfaceTarget = surfaceTarget;
  const controller = mountPrRadarApp(root);
  const unregister = registerLifecycleParticipant(
    prRadarParticipantId(context.installationId),
    {
      capture: () => controller.capture(),
      restore: (value) => controller.restore(value),
      pause: () => controller.pause(),
      resume: () => controller.resume(),
    },
  );
  publish(context, "surface.mounted");

  let mounted = true;
  return {
    unmount() {
      if (!mounted) return;
      mounted = false;
      unregister();
      controller.destroy();
      container.replaceChildren();
      publish(context, "surface.unmounted");
    },
  };
}

export default Object.freeze({ mount, surfaceTarget });
