/**
 * TAP application-lifecycle expose. Pause/resume map onto the game loop's
 * suspended flag (simulation and presentation stop, audio suspends with it);
 * unmount disposes the running game. The lifecycle expose and the surface
 * expose share this remote's module scope, so the active-game registry is the
 * bridge between them.
 */
import { activeGame } from './tap/activeSurface';

let phase = 'created';

export const prepare = async (): Promise<void> => {
  phase = 'prepared';
};

export const activate = async (): Promise<void> => {
  phase = 'active';
};

export const mount = async (context: { readonly hidden?: boolean } = {}): Promise<void> => {
  phase = context.hidden ? 'paused' : 'mounted';
  if (context.hidden) activeGame()?.setSuspended(true);
};

export const unmount = async (): Promise<void> => {
  phase = 'unmounted';
};

export const deactivate = async (): Promise<void> => {
  phase = 'deactivated';
};

export const prePause = async (): Promise<void> => undefined;

export const pause = async (): Promise<void> => {
  phase = 'paused';
  activeGame()?.setSuspended(true);
};

export const preResume = async (): Promise<void> => undefined;

export const resume = async (): Promise<void> => {
  phase = 'active';
  activeGame()?.setSuspended(false);
};

export const uninstall = async (): Promise<void> => {
  phase = 'uninstalled';
};

export const getLifecyclePhase = (): string => phase;

export const applicationLifecyclePlugin = {
  name: 'kart-royale-lifecycle',
  prePause,
  pause,
  preResume,
  resume,
};

export default applicationLifecyclePlugin;
