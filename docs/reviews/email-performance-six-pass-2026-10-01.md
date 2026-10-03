# Email performance: six additional review passes

2026-10-01 · source `b96706e23217be5c4f0496d4a11f2ebc0f5f4d9d` · mail 0.3.10 · React 19 · SDK 0.19.0.

These six passes follow the [original four-pass review](email-performance-2026-10-01.md). The user’s architectural requirements are explicit: **the miniapp owns its cache**; **activity stays nonblocking and goes through the SDK, grouped/debounced with miniapp-owned TanStack Pacer**. No application changes were made during the original measurement review. The implementation follow-ups below record subsequent source changes.

The main cause is missing coordination of the existing caches. The UI can change selection quickly with resident bodies, but the production reader starts another HTTP body request on every mount. Local bodies arrive after selection and compete with list reads. Activity, provider mutations, and repeated list refreshes add work during triage. SQLite, zvec, or React being present does not make the selected body prepared before the keystroke.

## Pass 1 — Live Superhuman and the measurable comparison

Measurements used an Apple M5 Max, 128 GiB RAM, macOS 26.6.2. Superhuman 1041.0.63 and TAP host 2.25.0 were already running. No CPU/network throttling was applied. Raw synthetic samples, aggregate network evidence, probe sources, and reproduction details are in [the evidence directory](email-performance-evidence-2026-10-01/README.md).

| Measured surface / metric | Samples | Median | Sample p95 | Range |
| --- | ---: | ---: | ---: | ---: |
| **Installed Superhuman**, physical J/K → next paint | 10 | **84 ms** | **128 ms** | 56–128 ms |
| **Current TAP source preview**, physical J/K → next paint | 10 | **24 ms** | **40 ms** | 16–40 ms |
| TAP source preview, J/K → changed body + two animation frames | 10 | 14.55 ms | 31.1 ms | 3.5–31.1 ms |
| TAP source preview, E → next paint | 3 | 24 ms | 40 ms | 24–40 ms |
| TAP source preview, E → successor body + two animation frames | 3 | 8.4 ms | 13.2 ms | 6.5–13.2 ms |
| Current local store, cached 32 KiB HTML read, Node SQLite fixture | 100 | 0.074 ms | 0.154 ms | 0.061–1.03 ms |
| Current Worker `threadSnapshot`, cached 20 messages, local D1 | 30 | 10 ms | 16 ms | 8–20 ms |

**These are real measurements of different scopes, not an apples-to-apples production speed ranking.** Superhuman’s ten navigations alternated between the same security-update and Cloudflare-summary threads visible in TAP. Its native DevTools interaction log measures input-to-next-paint in 8 ms increments; it does not establish when an asynchronously fetched body becomes complete. Earlier setup and an interrupted sample were excluded.

TAP preview used the complete optimized source UI in Chrome, five synthetic inbox threads, and already resident bodies. It excludes the installed host bridge, SQLite, authenticated coordinator, provider and remote images. Body timing starts in the capture-phase key handler, excludes earlier input delay, waits for the new rich iframe’s load when needed, then two animation frames; it is not compositor presentation time. It only demonstrates the resident-body UI path. Three E samples touched disposable fixture mail. At ten samples, nearest-rank p95 is just the maximum; these are exploratory results.

**Installed TAP production J/K p50/p95 and complete-body latency remain unmeasured.** The installed build had no performance recorder or Inspect action, and the session tool found no exact live TAP Dev Host for this worktree. A native J did show the correct cached Cloudflare rich body and “All conversation messages loaded” within a 5,306 ms tool observation bound. That includes automation/accessibility waiting and is not a valid application latency. The live release was not proven equivalent to source HEAD. The installed mailbox also displayed an HTTP timeout; source requests have a 30,000 ms timeout, but that does not mean every navigation took 30 seconds.

Superhuman publishes <100 ms / preferably <50 ms goals and describes local storage, preloading and prerendering; those goals are not measured current J/K values. Its current help documents up to 1,250 messages per Split and recent mail cached for 30 days. [Speed article](https://blog.superhuman.com/superhuman-is-built-for-speed/), [Offline Access](https://help.superhuman.com/hc/en-us/articles/46005499629325-Offline-Access).

A second Superhuman capture contained **58 HAR entries** during 32.4 seconds containing ten warm J/K navigations and surrounding background traffic: 24 image resources, 10 contact-profile requests, 20 analytics/preflight entries, three metrics writes and one activity request. **No HTTP conversation-body endpoint appeared.** Existing WebSocket frames were not inspected, so this does not prove zero body communication over every transport. Image entries can involve browser cache. It also shows that “instant navigation” and “zero total background requests” are different claims. Raw HAR was deleted after aggregation; message content and addresses are absent from the retained evidence.

## Pass 2 — Miniapp cache ownership and React subscriptions

**Baseline P1: a fully hydrated reader requested its first page again (cached reopen fixed locally).** [PagedThreadMessages](../../apps/tap-email/src/paged-thread-messages.tsx#L71) resets its session and calls `load()` on mount; props containing complete bodies do not short-circuit it. A diagnostic with ten hydrated alternating mounts made **10 `getThreadPage` calls**. Cached A→B→A makes three calls. Superseded requests remain active: cleanup only stops publication, and the transport has no cancellation signal. The baseline behavior was the first implementation target.

**Implemented follow-up:** downloaded pages now carry a miniapp-owned readiness marker alongside their bodies, provider revision, next cursor, completeness, windowing state and recent cursors. The reader uses resident bodies first, then awaits its scoped SQLite lookup before issuing a first-page GET. The marker is persisted with full body records, omitted from snippets/startup previews, cleared on body eviction and revision changes, and preserved through same-revision metadata refreshes. Partial downloads resume from their saved cursor. Legacy body arrays remain readable but need one online refresh to establish page readiness. Regression tests show **ten verified hydrated alternating opens: 0 `getThreadPage` calls and 0 SQLite lookups**; **cold A→B→A: 2 GETs**, one for each initial download. This verifies request counts in source tests, not installed-app paint latency. A subsequent TanStack implementation also deduplicates in-flight page reads: pending A→B→A starts only two GETs and publishes the final A once. Already-started transports still lack cancellation; clearing Query prevents late results from repopulating its cache.

**Baseline:** the email package had no direct Query, Store, or Pacer dependency/import; its state was React plus its own store/window caches. The host lockfile has Query 5.101.4, Pacer 0.21.1, and Store 0.11.0 / 0.9.3 transitively. The host’s QueryClient has five-minute freshness/collection and focus refetch disabled. The miniapp executes in an isolated iframe; that client does not own the email reader. **Do not borrow it.** **Implemented follow-up:** the miniapp now directly depends on Query 5.101.4, React Store 0.11.0 and Pacer 0.21.1. A session-owned QueryClient caches verified conversation pages and deduplicates pending body requests, with revision/account keys, an 8 MiB completed-data budget, explicit freshness until revision change, and automatic navigation/focus/reconnect refetch disabled. Store holds reader controls and transient loading/error state. Separate Pacer queues batch view recording and cumulative SDK activity publication; the SDK remains the storage/access boundary. The durable cache remains the miniapp’s private SQLite database on disk through SDK profile storage. Query supplies the memory layer in front of it. User/workspace/installation changes remount the session and discard old-scope queues and Query data. Wiping local mail clears Query data. The rest of the mailbox still uses React state and the existing bounded window cache; this change is not a full mailbox-state migration.

Proposed single ownership model:

| Data | Miniapp owner | Navigation behavior |
| --- | --- | --- |
| Selection, direction, row flags | Narrow Store/selectors or equivalent local subscriptions | Change synchronously, without debounce |
| Bodies, cursors, readiness and in-flight reads | One miniapp QueryClient or equivalent shared reader cache | Read memory first; deduplicate selected/prefetched loads |
| Durable metadata, bodies and outbox | Miniapp-owned SQLite through SDK private storage | Disk read only on memory miss |
| Speculative refill and activity grouping | Separate miniapp Pacer queues/batchers | Outside foreground navigation |
| Semantic embeddings/results | Miniapp zvec index | Used by search, not ordinary J/K |

Body entries need account/thread/message identity, **content revision**, explicit ready/missing state, page cursor/completeness, and byte accounting. Empty text can be legitimate, so nonempty-body checks are not a readiness contract. Mutable read/archive/label revisions must not evict unchanged bodies. Existing disk cache keys use provider history revision; the original probe demonstrates label-only changes destroying a body hit. Also fix the first-page revision mismatch before expanding prefetch: the reader currently publishes new response messages under the older prop revision.

Use synchronization to invalidate content, not per-selection revalidation. A cache entry with an explicit content revision can remain fresh until that revision changes. Navigation/prefetch must use the same miniapp client and keys. Do not retain a second competing body map in a Store while Query independently fetches it. Query v5 defaults/behavior must be checked against the adopted version. [Query defaults](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults).

The root app’s broad `state` dependencies recalculate rows during unrelated changes; row components lack isolation. Separate selected reader subscriptions from ordered row IDs and each row’s flags. Cache sanitized/prepared HTML by message content revision and rendering policy. The original probe measured five direct HTML parses / nine total DOMParser calls on a small mount even with scripts/images disabled. Keep the current message isolation and image/script policy when preparing neighbors.

Activity follow-up uses **100 ms quiet time, 150 ms maximum batch age and eight views per batch**. View recording preserves each event/idempotency key while sharing cleanup, checkpoint and projection reads. An eight-view warm SQLite regression records **13 SQL statements**, compared with the baseline 48 (six per view). Cumulative publication keeps only the latest pending projection while an SDK write is stalled, serializes writes and retries in the background. Command settlement waits for durable local receipts but no longer waits for SDK publication. Normal unmount drains accepted activity before closing the ledger; identity changes discard old-scope pending publication. Deterministic timer tests preserve all twenty views sent 30 ms apart in four batches, beginning at 150 ms; this is scheduler behavior, not installed-app latency.

## Pass 3 — SQLite latency, scheduling and list plans

The genuine Node SQLite read benchmark is fast: **400 SQL operations for 100 cached reads**, median 0.074 ms per read. This excludes native IPC and disk, so it does not exonerate the installed bridge. It does establish that repeated SQL/bridge trips and scheduling are worth distinguishing from SQLite execution itself.

**P1: a cached body waits for access bookkeeping.** [readThread](../../apps/tap-email/src/bounded-mail-replica.ts#L304) reads metadata, checks the body revision, reads body parts, then awaits an LRU timestamp write before returning. The gate probe proves the body cannot return until that write completes. Return readable content first; batch LRU updates behind the reader.

**P1: list and body work share one foreground FIFO.** [local-store](../../apps/tap-email/src/local-store.ts#L1047) cannot interrupt an active list query. The original probe requested a body after 20 list rows; it started after the entire 100-row window/lookahead, with **12 total operations**. Incremental row publication improves appearance but does not release the queue. Yield between bounded list batches and reserve selected-body access. Index maintenance, imports, checkpoints and cache pruning belong behind that lane.

The actual account-scoped inbox query plan was:

- `SCAN thread USING INDEX local_mail_window_idx`;
- correlated resource subqueries using the resource covering primary-key index.

This is evidence of a global ordered scan for the tested account query, not a measured large-mailbox slowdown. The `(? = 'all' OR account_id = ?)` and cursor-OR shape warrant separate unified/account-scoped SQL forms. Verify account/time/thread and resource-driven alternatives with representative multi-account cardinality before choosing another index. Avoid deleting existing indexes based on this small plan alone. [SQLite query plans](https://www.sqlite.org/eqp.html).

## Pass 4 — zvec and activity through SDK + Pacer

zvec is not on the ordinary neighbor lookup path. The app starts semantic maintenance after ten seconds, processes eight jobs at a time and sleeps 250 ms while pending / ten seconds when caught up. Its queue preparation, reads and acknowledgments use the same local-store machinery. Embedding work itself runs outside that queue, but its SQLite phases can still compete with reader work. Keep search/indexing as a separately paced background consumer; warm navigation already knows the next thread ID and needs no vector search. No installed zvec latency was measured.

**Activity is already initiated without awaiting it in the selection effect.** The problem is its per-selection work and publication frequency, not a synchronous `await` inside the J/K handler. [app activity projection](../../apps/tap-email/src/app.tsx#L874) serially records views and publishes via [SDK storage](../../apps/tap-email/src/storage.ts#L74). A ten-view probe produced **60 local SQL statements, 10 SDK storage gets and 10 sets**. Those are capability invocations; no host-level wire-count assertion is implied. Pruning/projection reconstruction happens per view. A failed publication can also delay later work in the activity queue.

Required change: the keystroke only enqueues a small activity event. A miniapp Pacer batcher groups local ledger writes and publishes one latest committed projection through the SDK. Group publication without losing committed action receipts, coverage, idempotency or event order. Serialize publication per activity scope to preserve optimistic concurrency. Rendering must not await recording, publication, retries or flushing. Failures remain independently visible/retryable.

Verified Pacer **0.21.1 source** clears/restarts the wait timer on each `addItem`; `wait` alone is a quiet period despite its option comment saying maximum time. Both wait and size default to Infinity. Also, `AsyncBatcher` can execute another batch while an earlier one is in progress; batching alone does not serialize SDK writes. Use a single publication lane with bounded retry/backpressure.

Actual 0.21.1 timer experiment, 20 events at 30 ms cadence:

| Configuration | Publications during experiment | First publication |
| --- | ---: | ---: |
| 100 ms quiet wait only | One batch of 20 | **695.93 ms** |
| 100 ms quiet wait, size limit 8, explicit maximum age 150 ms | Four batches of five | **151.39 ms** |

These are measured timer batches, not SDK network latencies or chosen production settings. Start with a short measured quiet period, a batch-size/byte cap, and an explicit maximum-age `flush()` timer; tune against real triage cadence. Do not debounce J/K itself. Lifecycle flush is best-effort; durable pending activity must survive interruption when delivery matters. [Pacer batching](https://tanstack.com/pacer/latest/docs/framework/react/guides/async-batching).

## Pass 5 — Worker API read amplification

**P1: cached pages use per-message database loops.** [threadSnapshot](../../apps/tap-email-coordinator/src/mailbox.ts#L1971) performs two initial reads, then a body query and attachment query for each message, then a final revision read. A cached 20-message page uses **43 statements** and zero provider fetches; 30 repeat reads used **1,290 statements**. Measured local runtime p95 was 16 ms, excluding authentication, HTTP and remote D1. Do not turn that into a predicted production latency.

Use a bounded set-based page read including encrypted bodies, one attachment query for accepted message IDs, and the required revision/consistency check. The fully cached path can be structured around approximately four statements rather than 43; that is a proposed shape, not an implemented/timed optimization. Use D1 batch only after reducing statement count: it reduces binding round trips while still executing each statement. Decrypt with bounded concurrency and per-request key reuse. Preserve order, revision checks, tenant scope, response byte caps and partial failures. Avoid repeatedly serializing the growing full response to calculate its size. [D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).

Cold thread reads currently hydrate full provider conversations before selecting a bounded page; legacy HTML repair is also inline. Give cold reads explicit readiness/partial-result semantics and hydrate a bounded message/page set. The existing thread route does not accept known content revisions or serve a body batch, so cache coordination must not depend on repeated full GETs.

Recommended evolution of the existing API, preserving its mailbox delta support:

| API surface | Efficient contract |
| --- | --- |
| Bootstrap | Bounded ordered summaries, content revisions and initial neighboring bodies; resume token |
| Body refill batch | Account-scoped IDs + known content revisions; per-item ready/missing/error, cursor and completeness; count/byte limits |
| Existing mailbox changes | Upserts/tombstones plus content changes; durably advance cursor only after SQLite commit |
| Command submission batch | Stable operation IDs, bounded group, durable acceptance and individual acknowledgments |
| Receipt reconciliation | Receipts for a batch/cursor, replacing one polling loop per command |

The body batch is background refill. Warm J/K should not invoke it. Conditional HTTP alone still incurs a call, so it is not the warm navigation solution. Private message bodies should remain in scoped private caches, with correct logout/account cleanup; generic public/CDN caching is not the intended architecture.

## Pass 6 — E succession, mutation traffic and the zero-read contract

E already selects the successor synchronously in the domain. The original probe confirms that its body can still be absent. A warmed synthetic E worked in 6.5–13.2 ms to successor body/animation frames; production needs that body prepared in advance.

Start by warming three ahead and one behind, with a byte cap and at most two speculative loads; these are experiment settings. Maintain a reserved selected-miss lane. Refill after direction changes, near window edges, and before optimistic E removes the current row. Prefetch must not mark read or publish views. Let useful neighboring in-flight work finish into the miniapp cache; cancel obsolete distant work through the actual transport. Cache prepared HTML, not hidden active frames that execute scripts or bypass image preferences.

[Command dispatch](../../apps/tap-email/src/app.tsx#L2278) is serialized **per account**, including receipt polling and activity settlement. Each command posts separately, may poll up to 120 times at 500 ms intervals, and later requests sync plus refresh. The 60-second polling schedule is a source bound, not a measured provider duration; slow requests can extend it. An unrelated thread’s read/archive can wait behind this account queue. Repeated unread opens add commands and pending-intent list refreshes.

Keep durable local acceptance and immediate optimistic rows/selection. Batch read/archive intents and receipts, with explicit ordering/idempotency and safe undo semantics. Preserve sends/drafts and their authority/context checks rather than coalescing them like read flags. Provider processing and receipt settlement cannot hold reader rendering. Activity receipt requirements must remain intact, but use the grouped SDK lane above. The existing two-minute background refresh and revisioned deltas are useful foundations; do not replace them with a GET on every selection.

**Acceptance contract:** within a warmed working set, J/K and E-to-successor perform zero navigation-triggered backend reads and do not wait on backend writes. Activity publications through the SDK and durable provider mutations are allowed asynchronously in bounded groups. A never-downloaded body is a separate cold case and cannot be promised instant merely by installing a cache library.

Suggested release gates: warm body-ready p95 <50 ms / p99 <100 ms; zero navigation body GETs; complete cached bodies readable with coordinator blocked; direction reversals and held-key bursts do not build an unbounded queue; maximum-age activity publication occurs during continuous input; unrelated rows stay stable; no optimistic-state reversal on sync. Those are proposed gates, not certified measurements.

## Work order and verification

1. Introduce one **miniapp-owned** reader cache with content revision, readiness, cursors and in-flight deduplication; stop cached-mount GETs and fix first-page revision association.
2. Prewarm neighboring bodies/prepared HTML; make disk LRU nonblocking and body reads outrank/yield list/index work.
3. Batch nonblocking activity through SDK + miniapp Pacer, including a maximum-age flush and serialized publication.
4. Reduce Worker per-message SQL reads; add bounded body refill and grouped mutation/receipt contracts.
5. Reduce broad React row/reader recomputation; benchmark large working sets and image-heavy mail.
6. Instrument an attributable native TAP build and repeat the same matched-mail, warm/disk-only/cold/burst tests against Superhuman, including body completion and actual SDK/backend request classification.

Validation this turn: **12 app diagnostic probes and one Worker diagnostic probe passed**, including 100 timed SQLite reads, ten hydrated reader mounts, ten activity views, a real query plan and 30 D1 repeats. The timer experiment used installed Pacer 0.21.1. The optimized preview build succeeded and physical J/K/E samples were recorded. The first review’s 574 app tests, 248 Worker tests and typecheck remain the baseline; they were not needlessly rerun for documentation. Temporary probes/harnesses were moved into the evidence directory, leaving production source unchanged at that point. See [primary-source notes](email-performance-primary-sources-2026-10-01.md) for library/backend references.


Implementation follow-up validation: **601 app tests passed across 95 files**, including cache readiness/disk recovery, pending-reader deduplication, session isolation, bounded memory, Pacer deadlines, serialized retries, eight-view SQL/SDK counts and durable settlement during a stalled SDK publication. App and TAP type checks passed. Optimized preview and full desktop/QuickJS package builds passed; package ABI, private React runtime and source-map checks passed. These local changes have not been deployed, and installed-app paint latency has not been remeasured.
