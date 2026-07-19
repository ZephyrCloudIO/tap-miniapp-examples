import {
  lifecycle_activate as activate,
  lifecycle_deactivate as deactivate,
  lifecycle_mount as mount,
  lifecycle_pause as pause,
  lifecycle_pre_pause as prePause,
  lifecycle_pre_resume as preResume,
  lifecycle_prepare as prepare,
  lifecycle_resume as resume,
  lifecycle_uninstall as uninstall,
  lifecycle_unmount as unmount
} from "./runtime.mjs";

export { prepare, activate, mount, prePause, pause, preResume, resume, unmount, deactivate, uninstall };
export const applicationLifecyclePlugin = { prePause, pause, preResume, resume };
