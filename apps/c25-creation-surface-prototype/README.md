# C25 creation surface — throwaway prototype

Three structurally different creation surfaces, switchable with `?variant=A`, `B`, or `C`:

- **A — Cells + Moments:** eight C25 pads own eight loop cells; saved combinations become Moments.
- **B — Layer Tape:** musical roles stack vertically and their entrances are arranged on a readable tape.
- **C — Performance Arc:** layers orbit a live loop and the arrangement is captured by performing changes over time.

The current playable slice asks two related questions:

1. Which model lets a beginner-to-intermediate C25 Creator make and arrange a first Music sketch without importing DAW concepts?
2. Does “press a pad, perform on the keys, hear it immediately, then hear the one-bar phrase loop” feel like the right first interaction?

From the repository worktree root, run:

```bash
pnpm --filter @tap-examples/c25-creation-surface-prototype dev
```

Open the page in a Chromium browser on `127.0.0.1`, choose **Enable C25 + audio**, press an empty C25 pad, and play a phrase on the keys. The first key begins a one-bar capture; the phrase loops automatically. Tap the same pad to mute or bring it back. The on-screen pads and keys exercise the same path.

Prototype only. Audio and loop state are in memory. Direct browser Web MIDI is a disposable bridge for testing the interaction with the connected hardware; TAP's production contract remains host-owned native MIDI. None of this code is intended for production.
