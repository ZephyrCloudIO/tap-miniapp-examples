/**
 * Lifecycle entry point declared as `lifecycle.lifecycleExpose` in the package
 * manifest. The host calls these phases when the owning realm is activated,
 * paused, resumed, or unmounted by a route change or window occlusion.
 */
import {
  captureCheckpoint,
  clearLifecycleState,
  pauseParticipants,
  restoreCheckpoint,
  resumeParticipants,
  type LifecycleTransitionContext,
} from "./lifecycle-state";

type LifecyclePhase =
  | "created"
  | "prepared"
  | "active"
  | "mounted"
  | "paused"
  | "unmounted"
  | "deactivated"
  | "uninstalled";

let phase: LifecyclePhase = "created";

const moveTo = (
  next: LifecyclePhase,
  allowed: readonly LifecyclePhase[],
): void => {
  if (phase !== next && !allowed.includes(phase)) {
    throw new Error(
      `PR Radar cannot move from ${phase} to ${next}.`,
    );
  }
  phase = next;
};

export const prepare = async (): Promise<void> => {
  moveTo("prepared", ["created", "deactivated"]);
};

export const activate = async (): Promise<void> => {
  moveTo("active", ["prepared", "unmounted", "paused"]);
};

export const mount = async (
  transition: LifecycleTransitionContext = {},
): Promise<void> => {
  // A hidden mount restores from a checkpoint: the host treats it as paused and resumes next.
  moveTo(transition.hidden ? "paused" : "mounted", ["active", "unmounted"]);
};

export const prePause = async (
  transition: LifecycleTransitionContext,
): Promise<void | false> =>
  (await captureCheckpoint(transition)) ? undefined : false;

export const pause = async (): Promise<void> => {
  await pauseParticipants();
  moveTo("paused", ["active", "mounted"]);
};

export const preResume = async (
  transition: LifecycleTransitionContext,
): Promise<void | false> =>
  (await restoreCheckpoint(transition)) ? undefined : false;

export const resume = async (): Promise<void> => {
  await resumeParticipants();
  moveTo("active", ["paused"]);
};

export const unmount = async (): Promise<void> => {
  moveTo("unmounted", ["mounted", "active", "paused"]);
};

export const deactivate = async (): Promise<void> => {
  moveTo("deactivated", ["active", "unmounted"]);
};

export const uninstall = async (): Promise<void> => {
  clearLifecycleState();
  moveTo("uninstalled", [
    "created",
    "prepared",
    "active",
    "mounted",
    "paused",
    "unmounted",
    "deactivated",
  ]);
};

export const applicationLifecyclePlugin = {
  name: "tap-pr-radar-lifecycle",
  prePause,
  pause,
  preResume,
  resume,
};

export default applicationLifecyclePlugin;
