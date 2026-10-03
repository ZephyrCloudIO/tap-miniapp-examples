# Email navigation performance: primary-source reference notes

Date: 2026-10-01. These notes support the six-pass review. They contain published product claims, verified library behavior, and proposed architecture; they do **not** contain live Superhuman or TAP latency measurements.

## Superhuman comparison: what the evidence actually establishes

| Evidence | Number or behavior | Interpretation |
| --- | --- | --- |
| [Superhuman speed article](https://blog.superhuman.com/superhuman-is-built-for-speed/), June 2022 | Under 100 ms for digital interactions; aims below 50 ms where possible | Published goal/product claim, not a current J/K p50 or p95 benchmark |
| Same first-party article | Device/browser database; preloads and prerenders threads likely to be viewed next | Speed comes from moving retrieval and preparation before the keystroke |
| [Current Offline Access help](https://help.superhuman.com/hc/en-us/articles/46005499629325-Offline-Access) | Opened, searched, or received messages in last 30 days; up to 1,250 emails per Split; automatically downloads attachments | Documents a substantial local working set rather than an opened-message-only cache |

No cited source publishes a reproducible current J/K latency distribution, hardware/browser conditions, sample count, or navigation-specific request count. Do not relabel the 50 ms goal as a measured Superhuman result. A valid head-to-head needs the same event-to-body-ready definition, actual logged-in clients, warm/cold cases, keyboard cadence, and sample methodology.

Superhuman's [2016 offline architecture](https://blog.superhuman.com/architecting-a-web-app-to-just-work-offline-part-1/) describes caching the message content, metadata, images, and attachments needed to display mail. It applies pure local modifiers immediately and asynchronously persists idempotent operations in per-thread order, including a disk-backed pending queue. That is useful architectural evidence, but its named storage technologies and extension ownership are historical implementation details, not verified current internals.

**Review inference:** warm J/K should change selected ID and show prepared local data. E should apply a local archive overlay, choose the successor from the current ordered list, and show its prepared local content. Provider synchronization can proceed afterwards. A queued mutation is still eventually a backend call; distinguish zero navigation reads from zero total calls, particularly when opening marks an unread message read.

## TanStack Query: caching requires an explicit policy

[Important defaults](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults) document that cached data is stale by default, stale queries can refetch on mount/focus/reconnect, inactive queries normally collect after five minutes, and failed queries retry three times. `staleTime: Infinity` prevents time-based staleness but still allows invalidation. Current docs distinguish `'static'`, which also blocks invalidation and always-refetch behavior.

**Proposed policy:** key content by account, thread ID, and content revision; read the memory cache immediately; use SQLite only on memory miss; use the network only on a genuine local miss. Keep mutable labels/unread/archive metadata separate from content revision so a label mutation does not evict the body. Retain a bounded memory working set independently of durable retention. Synchronization owns freshness. Avoid applying `'static'` to a thread representation that can gain new replies.

[QueryClient reference](https://tanstack.com/query/latest/docs/framework/react/reference/classes/QueryClient) describes `getQueryData` as an imperative, non-reactive cache read. It belongs in callbacks; reader rendering still needs an observer/selector subscription. Current docs mark `fetchQuery` and `ensureQueryData` deprecated in favor of `query`; the [current prefetch guide](https://tanstack.com/query/latest/docs/framework/react/guides/prefetching) also notes eventual next-major removal. Choose APIs against the SDK's actual version instead of blindly copying current examples.

For older v5 runtimes, verified [v5.85.5 QueryClient source](https://github.com/TanStack/query/blob/v5.85.5/packages/query-core/src/queryClient.ts) shows `ensureQueryData` fetching only if cached data is absent; stale revalidation is conditional on `revalidateIfStale`. `getQueryData` reads cached state synchronously. `setQueryData` supplies data directly to the cache. This version is a reference example, **not** an assertion that the host runs v5.85.5.

[v5.85.5 Query source](https://github.com/TanStack/query/blob/v5.85.5/packages/query-core/src/query.ts) reuses the existing retryer promise when the same query is already fetching, except for requested cancellation/refetch cases. This deduplication only helps if navigation and prefetch use the same client/key; unrelated imperative loads will bypass it.

[Cancellation docs](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation) say unused unresolved queries normally finish and populate the cache; consuming the supplied AbortSignal allows cancellation of the underlying request and reversion to the prior state. **Proposed ownership:** keep useful nearby prefetch alive when selection changes, but cancel obsolete distant work and propagate the signal to the transport. Never let an old selected-thread response overwrite the new selected thread.

## Store, React, and Pacer: keep the keystroke path small

[Store's official React example](https://tanstack.com/store/latest/docs/framework/react/examples/simple) uses `useSelector` (formerly `useStore`) and states that selecting one property prevents unrelated-property changes from rerendering the consumer. **Proposal:** subscribe reader to selected thread/content and rows to their own selected/read/archive flags. Avoid subscribing every row to the entire email collection or selection object. Verify the older SDK hook names before adopting latest examples.

[Query render optimizations](https://tanstack.com/query/latest/docs/framework/react/guides/render-optimizations) document structural sharing, tracked properties, and `select` subscriptions; inline selector identity can cause selector recomputation. **Proposal:** stabilize expensive selection functions and transformed email bodies by message revision and rendering preferences. Do not recompute sanitation/HTML preparation because selection flags changed.

[React Profiler](https://react.dev/reference/react/Profiler) reports `actualDuration`, `baseDuration`, start time, and commit time, and requires a profiling production build for production profiling. These explain React work but are not themselves keyboard-to-paint timing. Measure input event, selected-state update, body readiness, and browser frame presentation separately; email image readiness is a separate metric.

[Pacer async queuing](https://tanstack.com/pacer/latest/docs/framework/react/guides/async-queuing) controls concurrency, priority, ordering, expiration, and retries. Default concurrency is one. Priority changes pending start order, not the order of already active task completion. Cancellation reaches the underlying API only if the processing function consumes its signal.

**Proposal:** navigation updates are synchronous; no debounce/throttle on J/K. Queue only speculative work. Give selected misses a reserved/immediate lane; give forward-neighbor bodies higher priority than distant threads/images. Deduplicate by account/thread/revision before scheduling. Start with a small measured window (e.g. next three, previous one), then adapt to direction and cadence; these sizes are proposed experiment settings.

[Pacer async batching](https://tanstack.com/pacer/latest/docs/framework/react/guides/async-batching) triggers on maxSize, an explicit predicate, or a quiet period. Both size and wait default to Infinity; the wait timer restarts on every addition. **Proposal:** configure count and maximum-age flush for durable mutation batches; wait alone can postpone a batch during continuous triage. Persist accepted mutations before relying on delayed transmission. Size/time settings should be selected from measurements rather than added to the navigation path.

## SQLite and zvec: separate deterministic navigation from search

[SQLite query planner](https://www.sqlite.org/queryplanner.html) explains composite/covering indexes and using index order to avoid sorting. [EXPLAIN QUERY PLAN](https://www.sqlite.org/eqp.html) exposes scans, searches, covering indexes, and temporary sort B-trees. **Proposal:** verify actual account/thread/revision point reads and account/mailbox/received-time list queries with representative data. Read bodies without synchronously writing access timestamps; batch cache bookkeeping behind the UI. Keep transactions short enough that list refresh/import writes do not monopolize the local bridge.

[zvec search documentation](https://zvec.org/en/docs/db/data-operations/query/) describes vector, BM25, scalar filters, and combinations. **Inference:** semantic/full-text retrieval belongs in search/indexing. J/K already knows the neighbor's ID, so a vector search adds no retrieval value there. Resolve any zvec search result IDs through the same local body cache; update indexes asynchronously from SQLite revisions.

## Worker API shape for a local-first reader

[Cloudflare D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) places multiple prepared statements in one database call, reducing network round trips. Statements run sequentially, not concurrently, and failure rolls back the batch. A batch of N statements still performs N SQL statements. **Proposal:** first replace per-message body/attachment loops with set-based reads, then batch the remaining independent statements. Measure SQL count and binding round trips separately.

[D1 indexes](https://developers.cloudflare.com/d1/best-practices/use-indexes/) reduce scanned rows; validate with query plans and representative cardinality. [D1 read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/) uses sessions/bookmarks to provide sequential consistency. **Proposal:** if replicas are enabled, carry the bookmark across mutation and later sync/bootstrap requests so a replica cannot revert the client's acknowledged state. An unconstrained first read may favor latency over newest state; choose deliberately.

[Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/) recommend bindings over Cloudflare REST calls, service bindings for Worker-to-Worker communication, and Queues/Workflows for durable asynchronous processing. **Proposal:** acknowledge an E mutation after durable acceptance, queue provider work, and keep render/navigation independent of provider availability. `waitUntil` alone is not a durable mutation outbox.

Suggested API contract, an architectural proposal rather than a Cloudflare-provided feature:

| Operation | Suggested contract | Navigation effect |
| --- | --- | --- |
| Bootstrap/refresh | Ordered summaries, content revisions, cursor, and a bounded initial body window | Hydrates the working set before navigation |
| Body batch | Account-scoped IDs plus known revisions; per-item ready/missing/error result; count and byte caps | Refills neighboring content outside warm keystrokes |
| Delta sync | Cursor-based upserts/tombstones and revision changes, with cursor-expiry recovery | Patches local state without per-selection revalidation |
| Mutation batch | Stable operation IDs, per-thread ordering, durable acceptance, per-item acknowledgments/reconciliation | Archive/read/star updates apply locally immediately |

This design needs account isolation in every cache key, logout cleanup, revision-aware invalidation, bounded prefetch, and durable ordered mutations. Those are correctness requirements that make the zero-read warm path reliable.

## Recommended measurement gates

Proposed TAP targets: warm J/K and E-to-successor body ready p95 below 50 ms, p99 below 100 ms, and zero navigation-triggered backend reads for the warmed working set. These are target gates inspired by Superhuman's published goals, not evidence that either app currently meets them. Record cold first-open separately, plus SQLite-only open, image readiness, backend read count, asynchronous mutation count, cancellations, cache hit tier, and burst behavior.

Run repeated A-B-A, sequential J/K, direction reversal, held-key bursts, and E succession in a production build. Count actual host tool invocations/network requests rather than inferring absence of backend work from a fast UI. Warm tests should also work with the backend blocked. A backend-free render path is incomplete if stale UI overwrites optimistic state during the next sync.
