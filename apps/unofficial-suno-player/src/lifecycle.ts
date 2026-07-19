import {
  captureCheckpoint,
  clearLifecycleParticipants,
  pauseParticipants,
  restoreCheckpoint,
  resumeParticipants,
  type LifecycleTransitionContext,
} from "./lifecycle-state";

type Phase = "created" | "prepared" | "active" | "mounted" | "paused" | "unmounted" | "deactivated" | "uninstalled";

let phase: Phase = "created";

const move = (next: Phase, allowed: readonly Phase[]): void => {
  if (phase === next) return;
  if (!allowed.includes(phase)) throw new Error(`Player lifecycle cannot transition from ${phase} to ${next}.`);
  phase = next;
};

export const getLifecyclePhase = (): Phase => phase;
export const prepare = async (): Promise<void> => move("prepared", ["created", "deactivated"]);
export const activate = async (): Promise<void> => move("active", ["prepared", "unmounted", "paused"]);
export const mount = async (context: LifecycleTransitionContext = {}): Promise<void> => move(context.hidden ? "paused" : "mounted", ["active", "unmounted"]);
export const unmount = async (): Promise<void> => move("unmounted", ["mounted", "active", "paused"]);
export const deactivate = async (): Promise<void> => move("deactivated", ["active", "unmounted"]);
export const prePause = async (context: LifecycleTransitionContext = {}): Promise<void | false> => (await captureCheckpoint(context)) ? undefined : false;
export const pause = async (): Promise<void> => {
  await pauseParticipants();
  move("paused", ["active", "mounted"]);
};
export const preResume = async (context: LifecycleTransitionContext = {}): Promise<void | false> => (await restoreCheckpoint(context)) ? undefined : false;
export const resume = async (): Promise<void> => {
  await resumeParticipants();
  move("active", ["paused"]);
};
export const uninstall = async (): Promise<void> => {
  clearLifecycleParticipants();
  move("uninstalled", ["created", "prepared", "active", "mounted", "paused", "unmounted", "deactivated"]);
};

export default Object.freeze({ name: "unofficial-suno-player-lifecycle", prePause, pause, preResume, resume });
