# Sustained email navigation and moving warm cache — 2026-10-03

The installed 1.0.1 source warms one conversation ahead and one behind. Each selection change restarts its 48 ms timer and aborts publication from the preceding effect. Its `Promise.all` waits for both neighbors before making either available to the retained reader deck. A short alternating j/k test exercises those two readers repeatedly; it does not establish sustained navigation through new conversations.

The loading order is miniapp Query snapshot/first page, matching resident downloaded-page marker, SDK private SQLite body record, then coordinator first-page fetch on a miss. Foreground and background loading already share account/thread/provider-revision query identities, including pending disk and network work. This fix retains that owner and loading order.

## Change

A session-owned scheduler now follows the selected conversation through a window of ten preceding and ten following rows. It prioritizes nearby conversations in the direction of movement, preserves overlapping pending downloads, drops obsolete queued targets, and publishes each completed neighbor independently. New preparation starts after 48 ms, but subsequent movement does not restart the outstanding timer. Completed slots are refilled without another debounce interval.

At most two background preparations run concurrently. Uncancelable shared transports retain their slot until they settle, preventing large jumps from creating unlimited orphan requests. SDK/coordinator reads remain deduplicated with the foreground reader. Four nearby ready readers are nominated for DOM warming; the existing deck still bounds mounted readers to five and their body charge to 8 MiB. No background sender scripts or external images are enabled by this change.

Background readiness checks use a non-touching Query lookup so scanning twenty targets does not overwrite actual reader recency. Query bodies remain subject to the existing 8 MiB byte budget and revision/account/session isolation. Ten on each side is the preparation target, not a guarantee that twenty exceptionally large bodies remain resident beyond that budget. An initial cold window needs time to prepare, and navigation can still outrun slow downloads. Cold coordinator misses require I/O. The cache belongs to the miniapp and continues to read its own SDK private SQLite; the host QueryClient is not used.

## Controlled loading measurements

Both loading simulations use 81 synthetic conversation identities, verified downloaded-page markers supplied by simulated disk reads lasting 150 ms, an initial 1,800 ms warm-up, and 60 selection steps spaced 100 ms apart: thirty forward, then thirty reverse. The baseline reproduces the retired 1.0.1 neighbor effect using the same real Query cache and preparation function. The replacement exercises the actual new scheduler and those same components.

| Measurement | Released neighbor effect | Moving window |
| --- | ---: | ---: |
| Initially prepared neighboring bodies | 2 | 20 |
| Bodies ready in memory when selected | 31 / 60 | 60 / 60 |
| Selections that still need a body | 29 / 60 | 0 / 60 |

The moving-window fixture also verifies at most two simultaneous reads, no repeated disk reads for revisited identities, and zero coordinator calls when the disk has matching downloads. These are loading-model measurements, not installed paint latency, real SDK bridge timings, or proof of zero traffic in native TAP. The baseline fixture checks readiness without adding separate foreground miss work; it isolates the warming policy.

The React Strict Mode fixture prepares twenty bodies, shifts the window both ways, limits mounted readers to five, and verifies disposal prevents later preparation. Existing HTML-reader tests still verify frame reuse and no parsing across warm alternating switches. The app render-work regression still reports zero repeated summaries/counts/day grouping/timestamps/sort comparisons across ten already-read j/k moves.

## Review pass 1 — loading ownership and sustained movement

Traced foreground restore, Query deduplication, SDK disk reads, and the old neighbor effect. Checked timer starvation, single-neighbor lookahead, and the combined publication barrier. The replacement uses one scheduler for preparation and the existing foreground query owner. Added sustained sixty-step, stalled-neighbor, rapid-key, direction/boundary, and pending foreground-read regressions. Corrected background readiness lookups to preserve actual LRU order.

## Review pass 2 — React lifecycle, scope and resource bounds

Reviewed effect replay, session teardown, changing rows/provider revisions, direction reversal, and abandoned transports. Added a late obsolete-revision regression and a Strict Mode integration check. Preparation remains outside React render; ready reader-key publication uses a transition and returns the previous array when keys do not change. Background work never publishes mailbox state directly. Confirmed bounded attempts/targets, concurrency, Query memory and mounted DOM readers. No unresolved blocking finding remains in this patch; installed timings and large-body capacity remain the limits described above.

## Verification

654 tests across 107 files passed. App and TAP type checks passed. The preview and SDK 1.0.2 package builds passed, including manifest validation, signed schema/ABI checks, production coordinator guard, both targets, private React runtime verification, and six exact-build diagnostics maps. Existing unrelated local UI edits were preserved in the original checkout; this patch was built in a clean worktree from merged main `9a3f94191eaee496310101340f8dfe1cac52c965`.
