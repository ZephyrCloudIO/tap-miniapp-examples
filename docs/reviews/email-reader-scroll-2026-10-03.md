# Continuous mail history and retained readers — 2026-10-03

Version: TAP Email 1.0.1. Base: `d11db3be6fd1f4d7f66a8777600d60087f018f3a` (1.0.0).

## Result

The mailbox has one continuous, virtualized list. Scrolling near the bottom appends the next bounded SQLite batch; it does not replace the existing rows. The miniapp retains at most five HTML readers, warms the next and previous conversation after selection settles, and shares their disk/backend reads with the foreground reader through its existing Query owner. Returning to a retained reader reuses its document and completed images. Neighbor preparation reads the SDK's miniapp-private SQLite storage before the coordinator. Warming does not run sender scripts or download external images.

The existing activity queue remains independent of navigation and continues to group SDK publications through TanStack Pacer. These changes introduce no host-owned cache or backend API changes.

## Measured browser evidence

Chrome on this machine, production builds, synthetic downloaded HTML mail. Ten alternating j/k inputs per sample. The measurement starts in the input handler, checks that the intended HTML body exists, then records on the next animation frame. It is a body-ready frame proxy, not a DevTools presentation timestamp. The isolated reader fixture excludes SDK, SQLite, coordinator, full-mailbox React derivation, and image-download latency.

| Metric | 1.0.0 reader fixture | Final retained-reader fixture |
| --- | ---: | ---: |
| Median body-ready frame proxy | 20.4 ms | 12.5 ms |
| p95, nearest rank | 23.7 ms | 15.5 ms |
| iframe loads across ten switches | 10 | 0 |

An earlier after-change sample measured 10.4 ms median and 14.9 ms p95; the final rerun above is the reported result. Both after samples had zero iframe loads. Raw samples are in [measurements.json](email-reader-scroll-evidence-2026-10-03/measurements.json).

The continuous-scroll browser fixture appended 100 → 200 → … → 1,000 emails with 24 mounted email rows at every append. After the first append, `scrollTop` remained 9,011 px, at the old loaded bottom, while total scroll height increased to 19,261 px. Subsequent appends likewise preserved position. Earlier rows stayed reachable; the end marker appeared after the last batch.

The full preview app also passed ten alternating clicks between two emails. Returning to the initial HTML reader retained frame ID `_r_e_`, with three retained readers. Native keyboard input verified j, k, Done advancing to the next email, and Undo restoring the original selection. These are functional checks, not installed-app timing measurements.

The installed 1.0.0 app's reported several-hundred-millisecond click delay has **not** been measured or shown resolved by this fixture. Cold or non-neighbor emails can still require private-disk/backend work. Live validation requires installing the resulting 1.0.1 release and measuring that host path. Sender-script mail remains foreground-only and can recreate its isolated renderer. The reader budget bounds retained raw-body charges to 8 MiB (except the active reader, which must remain readable); it is not a browser heap or iframe memory limit.

## Review pass 1 — rendering, cache ownership, and retention

- Removed mailbox pagination and preserved bounded SQL queries behind continuous scrolling.
- Found and fixed the child virtualizer subscribing before its parent scroll ref attached; a real-browser check exposed the blank initial range. Added a ResizeObserver-enabled regression test.
- Kept iframe DOM order stable so reordering retained readers cannot reload their documents.
- Charged mounted bodies even after Query eviction, limited retention to five readers, and excluded sender-script mail from background retention.
- Preserved the approved-image hydration path: sanitized templates omit remote URLs, so downloaded image data must be inserted before sanitization. Added an assertion that the rendered document contains the approved data URI.

## Review pass 2 — lifecycle, recovery, and duplicate work

- Verified that simultaneous foreground/background disk reads share one lookup, and warm readers require zero disk or coordinator calls.
- Found and fixed prefetched snapshots not being published when an already-mounted inactive reader became active. Activation now publishes the verified snapshot for normal SDK persistence without recreating its frame or refetching its bodies.
- Found and fixed an older-batch failure looking like the end of mail. Loaded rows remain visible and Retry reloads the requested history depth; a SQLite UI regression test exercises failure and recovery.
- Kept selected-row scrolling tied to an actual selection change; appending rows does not pan back to the selected email. A selection absent during initial loading can still scroll into view once its row arrives.
- No outstanding blocking findings in these two passes. Existing embedded-surface edits were preserved locally and excluded from this change.

## Validation

- Full email suite: 644 tests across 105 files passed.
- Focused retained-reader, activation, and virtualizer regression tests passed.
- SQLite history UI test passed, including append, transient failure/retry, older-email selection, and search beyond the loaded history.
- App and TAP typechecks, manifest validation, preview build, and SDK package build/verification passed in a clean isolated checkout of implementation commit `c4cc92d`. The build emitted and verified TAP Email 1.0.1, two runtime targets, six federation exposes, one private React runtime, and six archived source maps matching the package bytes. The subsequent commit updates this report only.

## Reproducing the fixtures

Build `rsbuild.reader-benchmark.config.ts` from `apps/tap-email`, serve `dist-reader-after`, open `/` for the warm-reader fixture and `/scroll.html` for the 1,000-email fixture. Alternate j/k in the labeled input and read the visible measurements. Use the scroll fixture's button to scroll to the loaded bottom repeatedly.

For the before measurement, use the 1.0.0 base sources and the same synthetic reader fixture, replacing the deck with a single `ThreadMessageList` keyed by the selected index and checking the single iframe for readiness. The immutable before-build directory was measured before the changes; it is a local build artifact, not part of the released miniapp. Do not interpret these ten-input samples as production latency percentiles.

## Follow-up: reader panel height

Host-guarded static HTML used an opaque-frame fallback capped at 480 px. This left unused reader space below long emails. The fallback now fills the available reader height below the message header and controls, with the normal bottom padding. A ResizeObserver follows the reader panel, including size changes without a window resize. Readable documents retain content-based sizing; frame sandbox and network policy are unchanged.

Two follow-up review passes checked measurement and lifecycle. Scrolling is normalized out of the top inset to avoid a height feedback loop; mail below the initial viewport keeps a usable native scroller. The opaque observer ignores unchanged panel dimensions and disconnects on cleanup. Regression tests cover tall/short panels, scrolling, host guards, and panel-only resize events.

Chrome's `/panel.html` fixture simulates the TAP document-access guard using public synthetic mail. In a 1,000 px panel, the reader was 956 px and the email frame was 857 px. Resizing the same panel to 560 px changed the reader to 516 px and the frame to 417 px. In both cases the remaining gap was 22.23 px, matching the normal 22 px bottom padding (plus fractional layout rounding). This validates the fallback in a browser; installation validation remains pending.

The original PR CI navigation test crossed a minute boundary and observed one legitimate clock-driven summary update. The performance test now uses a controlled clock and explicitly advances the neighbor warm-up timer before and after navigation, preserving its zero-recomputation assertions. Preview neighbor preparation also preserves existing verified download markers instead of replacing them with new equivalent markers.

Final follow-up validation passed in a clean checkout of `74049d3`: 645 tests across 105 files, app/TAP typechecks, preview build, and the SDK 1.0.1 package build and all package verification checks. The subsequent commit records these results only.
