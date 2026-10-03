# Email 1.0.0 — two reviews before opening the PR

Base: latest main `2bf806c`. Implementation: `69afd18`. The PR promotes TAP Email from 0.3.10 to **1.0.0**. These two passes review the final implementation, following the earlier performance and React reviews.

## Pass 1: conversation-cache and background-activity correctness

Traced downloaded-page identity through resident React state, the miniapp QueryClient, SDK private SQLite, metadata refresh, revision invalidation, and pagination. Checked pending-read deduplication, late responses, account removal, byte accounting, offline legacy records, and normal/identity-change shutdown. Reviewed activity batching, retries, cumulative projections, and preservation of individual view events.

Fixed two findings:

- **P1 — invalid pagination could poison Retry.** Query cached a successful transport response before reader validation found a repeated cursor or no new messages. Retry then reused that response forever. The reader now discards a failed page; `thread_changed` also discards that revision's accumulated queries and resets pagination state. Two regression cases prove Retry makes a new coordinator request and renders the recovered page.
- **P2 — cumulative activity could exceed its age cap.** Replacing the queued projection cleared the age timer, allowing continuous navigation to postpone SDK publication indefinitely. Replacement now preserves the first queued item's deadline. A regression test replaces projections every 30 ms and verifies the latest is published at 150 ms. All distinct view events remain queued; only cumulative SDK projections are coalesced.

The focused cache, reader, and Pacer suite passed **37 tests**. Memory queries remain session-owned; durable bodies and pagination markers remain in the miniapp's SDK private SQLite. Bookkeeping updates do not delay completed body reads, and command-journal durability remains separate from background activity.

## Pass 2: React lifecycle, repeated work, and release packaging

Reviewed lazy resource initialization, effect cleanup/replay, callback freshness, memo dependencies, selection ordering after queued actions, message preference changes, summary/date updates, and rendering props. There is one reader owner of the body lookup; the removed parent lookup does not reappear through a second hook. Derived mailbox ordering, counts, grouping, and formatting have relevant data dependencies, while session resources use lazy state rather than disposable memo values.

Fixed the scope ref being updated during render: it now changes in a layout effect at commit, so an abandoned render cannot invalidate the active session's background work. Kept semantic search's event-time clock fresh rather than capturing a memoized clock in its callback. Existing Strict Mode and keyed-session tests verify resource replay and cleanup, and the warm-navigation regression also checks Done followed immediately by j in one React batch.

Checked the 1.0.0 package version, build manifest, specialist manifest reference/name/version, and versioned skill frontmatter. Retained historical versioned assets following the repository's release convention. Built and verified both package targets, one private React runtime, MCP ABI/schema assets, and matching archived source maps. Local appearance/embedded-surface work was temporarily shelved for validation and is excluded from this PR.

No unresolved blocking findings in these two passes.

## Validation of the isolated PR contents

- Email unit suite: **624 tests in 98 files**, zero failures/skips.
- Application and TAP type checks: passed.
- Manifest validation: passed; all active release metadata is 1.0.0.
- Repository static policy tests: **48 passed**; TAP discovery verified 11 apps, 13 cells, 92 rows, and 144 cases.
- Preview and full SDK package build/verification: passed for `tap-email@1.0.0`.

Logs: [pre-PR evidence](email-performance-evidence-2026-10-03/pre-pr). The earlier 633-test run included separate local appearance tests; this count covers only the PR contents, including the three new pagination/Pacer regression cases.

Warm regression measurements remain: ten downloaded alternating opens make **0 coordinator page calls and 0 SQLite body reads**; ten already-read j/k moves repeat **0 summary/count/grouping/formatting/sort operations**. Cache sizing is **10 rather than 55 serializations** for ten new snapshots. Ten cold SQLite body reads share **1 rather than 10 recency updates**. These are source-app regression counts, not installed-app paint latency. Cold misses still require disk and potentially coordinator/provider I/O; read/archive mutations still require durable commands and eventual backend dispatch. No package was published or deployed.
