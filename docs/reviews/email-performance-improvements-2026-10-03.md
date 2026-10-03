# Email performance implementation — 2026-10-03

Updated main from `b96706e` to `2bf806c` (mailbox recovery and the Outbox test fix). Preserved all 66 locally changed/untracked files and verified the restored contents byte for byte. The recovery changes already present locally match the new upstream commits. This implementation finishes the remaining React and cache-bookkeeping findings from the [two-pass review](email-react-two-pass-2026-10-01.md), while retaining the earlier miniapp cache and Pacer activity changes.

## Changes

The app shares one projected mailbox between selection, summary, sidebar counts, and rows. Summaries and counts depend on relevant mailbox data, rather than the entire state object. Sidebar buttons and individual rows have memo boundaries with stable callbacks. Day grouping, account lookup, and timestamp formatting are prepared once for unchanged rows/accounts/local day. Keyboard navigation reuses the committed ordering; a guard rebuilds it when another command or mailbox update changed state in the same batch. Already-read conversations skip redundant read-command preparation.

One minute clock updates due-reminder summaries and time-sensitive search, refreshes day labels at midnight, and catches up on resume. Ordinary selection changes leave those calculations cached. Static list rows do not reformat each minute. SDK attention publication follows mailbox/summary changes instead of being repeated on every selected email; active-context events still follow navigation.

Query cache sizing now uses a byte ledger updated when query data changes or is removed. It measures each new payload once, tracks access order, and releases byte charges on eviction, account removal, garbage collection, and session clearing. Warm opens do not reserialize all cached bodies. Verified disk results populate the miniapp snapshot even if their original reader has left, without replacing a newer snapshot or accepting another account/thread/revision.

SQLite body-access timestamps are coalesced for 250 ms and written in bounded batches of 50. The reader publishes cached bodies before these writes. Ordinary writes flush pending recency before eviction; close waits for foreground work and flushes its recency before closing storage. Updates match provider revision and preserve increasing access time. A recency-write failure does not make a valid body unreadable; this bookkeeping is best effort. Bodies and durable commands retain their existing persistence guarantees.

The miniapp continues to own its QueryClient, Store, Pacer queues, and SDK private SQLite storage. It does not use the host's UI cache.

## Executed regression measurements

| Scenario | Before these changes | After |
| --- | ---: | ---: |
| Ten alternating j/k moves through already-read, downloaded mail: summary derivations | 10 | 0 |
| Same moves: fallback sidebar count derivations | 10 | 0 |
| Same moves: day grouping calls | 19 | 0 |
| Same moves: row timestamp formatting calls | 95 | 0 |
| Same moves: timestamp sort comparisons | 80 | 0 |
| Add ten completed Query snapshots: body size serializations | 55 | 10 |
| Ten SQLite body reads: recency update statements | 10 | 1 |
| Cached read while recency write is held | waits for write | bodies resolve first |

The warm-navigation test also performs Done and j in the same React batch: the archived row disappears, selection advances using current data, and the downloaded next reader has no loading message. Additional tests cover midnight/resume, Strict Mode timer cleanup, useful late disk downloads, cache recency/byte removal, a failing SQLite timestamp write, and closing while a foreground read completes.

These are executed source-app regression counts in jsdom and a real in-memory SQLite adapter. They are not installed-app paint latency or a new Superhuman timing comparison. Cold uncached bodies still need a disk read and potentially a provider request. Changing the selected reader still mounts that reader's disclosure/frame state; a live installed-app profile remains useful for measuring frame initialization and paint.

## Validation

Passed **633 tests across 101 files**, application and TAP type checks, preview build, full SDK package build, and package verification (both targets, one private React runtime, matching archived source maps). Logs are in [the evidence directory](email-performance-evidence-2026-10-03). The changes remain in the working tree; no release was published.
