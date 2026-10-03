# Recorded email stalls and serialized reader restoration — 2026-10-03

The supplied 27.816-second recording shows the conversation header available while the body remains at “Loading conversation messages…”. Sampling the status region at 10 frames per second and inspecting representative full frames finds these continuous loading periods:

| Recording interval | Visible loading duration |
| --- | ---: |
| 0.45–2.75 seconds | about 2.3 seconds |
| 3.55–5.25 seconds | about 1.7 seconds |
| 15.85–17.25 seconds | about 1.4 seconds |
| 17.85–19.05 seconds | about 1.2 seconds |

Sampling has approximately 100 ms resolution. These are visible loading-state intervals; the recording has no key-event timestamps, network trace or SDK operation durations. They cannot establish keypress-to-paint latency or distinguish every SDK wait from a coordinator fetch. No email contents, subjects, identifiers, frames or OCR text are included in this repository report.

## Confirmed implementation gap

The 1.0.2 controlled navigation fixture models each full disk restore as an independent 150 ms promise. The real ProfileSqliteMailStore drains reader operations sequentially under its transaction/write queue. For a small downloaded conversation, readThread makes three separate SDK SQL queries: metadata/message previews, body revision coverage, and body record parts. Two concurrent preparation promises therefore do not make these SQL reads parallel. The warm radius of ten each way still exists, but filling its twenty bodies requires sixty bridge reads.

This is a confirmed avoidable loading cost, not proof that all time in the recording came from these reads. The original fixture did not reproduce the serialized store. See the updated real-SQLite regression in conversation-disk-window.test.ts.

## Change prepared as 1.0.3

The moving window registers its pending local queries together. Foreground and warm reads use one session-owned batching adapter that coalesces same-turn requests, runs one disk batch at a time and limits each batch to twenty-one identities. The store reads metadata, revision coverage and eligible body parts for the window with bounded responses. Small twenty-body restores now use three SQL queries. Pending reads still belong to the existing account/thread/revision Query cache; transport batching does not introduce another body cache.

One local-window restoration runs at a time; movement during it coalesces into the latest window. Coordinator fallback stays limited to two background preparations. Missing, stale, legacy and over-budget disk records do not gain downloaded-page markers. Chunk responses contain at most 64 record parts, and hydrated body admission stays within the existing 8 MiB budget. Single-reader fallback remains available for stores without batching support. No host cache is used, and no activity/backend API is changed.

## Measurements and regressions

Real SQLite tests count sixty SELECT calls for twenty individual restores and three for the new window restore. They also verify exact downloaded markers, stale/missing body behavior, multi-response body assembly and memory admission.

A controlled regression wraps the real SQLite adapter with 150 ms latency per query and uses the actual serialized ProfileSqliteMailStore. After a 1,800 ms warm-up, the released policy prepares three neighboring bodies; the batch policy prepares twenty. The replacement keeps all sixty selections ready during thirty forward and thirty reverse moves, 100 ms apart, with no coordinator call when matching downloaded bodies exist. The 150 ms bridge delay is simulated; it was not measured from native TAP.

React Strict Mode replay registers twenty pending disk queries once, then restores all twenty. Adapter tests cover account isolation, cancellation of one sibling, failed-batch retry, twenty-one-identity bounds and one active disk batch. Scheduler tests cover coalescing multiple movements into the latest window and stopping further work on disposal. Existing retained-frame and render-work regressions continue to pass.

## Review pass 1 — disk ownership, correctness and bounds

Traced the serialized store queue and exact SQL call chain. Reviewed body revision admission, legacy markers, part ordering, response limits, cache budget and SDK ownership. Removed inherited metadata download markers before hydration so only actual matching body records can establish readiness. Large-body tests exercise multiple 64-part responses and budget exclusion.

## Review pass 2 — React lifecycle, shared work and failure

Reviewed Strict Mode replay, scope changes, movement during a slow batch, Query deduplication, rejected batches and canceled siblings. Foreground reads share the same disk batch and Query owner; a canceled sibling does not abort another live reader. One disk transport and one window restoration run at a time. Background disk priming issues no coordinator requests itself; the existing fallback scheduler retains its two-request limit. Late completion cannot publish reader keys after disposal. No unresolved blocking finding remains in this patch.

The native host still requires measurement after installation. Cache misses, active write transactions, network body fetches and HTML frame preparation can add latency. This patch does not claim those costs are eliminated or that the installed 1.0.2 app is already fixed.

## Verification

663 tests across 109 files passed. App and TAP type checks passed. The preview and SDK 1.0.3 package builds passed, including schema/ABI, private React runtime and exact diagnostics-map checks. Production coordinator guard and manifest validation passed. Changes were built from merged main in an isolated worktree; unrelated original-checkout edits were preserved.

## Reader spacing follow-up

The supplied comparison exposed another reader issue: the header has an inset, but ordinary HTML and plain-text bodies have zero padding. Adaptive prose and plain text now use 16 px top, the existing message inset at each side (24 px on desktop, 16 px in the narrow desktop layout), and 24 px bottom. Authored newsletters retain their canvas. Mobile keeps its existing outer 16 px gutter and adds only 16 px bottom spacing to prose bodies.

Review pass 1 checked that spacing lives on the outer shell, so it applies to both HTML renderers without changing sanitized content, frame identity, hooks or cache loading. Review pass 2 checked desktop alignment, mobile cascade, full-width newsletter preservation and overflow in Chromium. At 1280 px viewport width, sender and adaptive frame both start 24 px inside the card; at 390 px mobile width, neither receives a duplicate inner gutter. Plain-text spacing matches, authored shell padding remains zero, and neither viewport has horizontal overflow. The browser fixture uses neutral sample content, not the private email in the screenshot. All 49 existing rich-message, resize and thread-message tests and the preview build passed after the CSS change.
