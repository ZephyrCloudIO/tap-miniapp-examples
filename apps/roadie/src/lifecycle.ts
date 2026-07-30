// TAP requires every ui.surface contribution to declare a lifecycle expose
// (`lifecycle.lifecycleExpose`) that resolves to a Federation module, and the
// host drives mount/unmount/pause/resume through that module. Roadie has no
// prepare/activate/pause work to do — the host defaults (drive the mount phase,
// retained persistence, no checkpoint) are exactly what we want — so this
// module intentionally declares no lifecycle hooks. Its presence satisfies the
// host descriptor validator; every phase falls through to the host default.
export {};
