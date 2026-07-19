let phase = 'created';
export const prepare = async () => {
  phase = 'prepared';
};
export const activate = async () => {
  phase = 'active';
};
export const mount = async (c: { hidden?: boolean } = {}) => {
  phase = c.hidden ? 'paused' : 'mounted';
};
export const unmount = async () => {
  phase = 'unmounted';
};
export const deactivate = async () => {
  phase = 'deactivated';
};
export const prePause = async () => undefined;
export const pause = async () => {
  phase = 'paused';
};
export const preResume = async () => undefined;
export const resume = async () => {
  phase = 'active';
};
export const uninstall = async () => {
  phase = 'uninstalled';
};
export const getLifecyclePhase = () => phase;
export default {
  name: 'vanta-companion-lifecycle',
  prePause,
  pause,
  preResume,
  resume,
};
