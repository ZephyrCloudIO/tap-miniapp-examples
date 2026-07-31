# C25 creation surface — throwaway prototype

Three structurally different creation surfaces, switchable with `?variant=A`, `B`, or `C`:

- **A — Cells + Moments:** eight C25 pads own eight loop cells; saved combinations become Moments.
- **B — Layer Tape:** musical roles stack vertically and their entrances are arranged on a readable tape.
- **C — Performance Arc:** layers orbit a live loop and the arrangement is captured by performing changes over time.

The question is which model lets a beginner-to-intermediate C25 Creator make and arrange a first Music sketch without importing DAW concepts.

From the repository worktree root, run:

```bash
pnpm --filter @tap-examples/c25-creation-surface-prototype dev
```

Prototype only. State is simulated in memory, audio and MIDI are deliberately absent, and none of this code is intended for production.
