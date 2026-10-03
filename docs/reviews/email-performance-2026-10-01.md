# Email performance and caching review

Reviewed on October 1, 2026, after pulling `origin/main` with a fast-forward. The reviewed commit is `b96706e23217be5c4f0496d4a11f2ebc0f5f4d9d`; the Email source version is `0.3.10`.

The main problem is that the app prepares conversation bodies after selection. Done advances selection synchronously, but the next conversation often contains only metadata. Returning to a conversation also starts fresh disk and server work despite having its content in memory. The existing list-cache improvements are useful, but they do not provide a complete reader cache or prepare the next body for rapid triage.

Four passes covered navigation and commands; device persistence and cache correctness; the coordinator and provider path; and rendering, images, startup, and verification. This is a review with proposed fixes. Production application code was not changed.

## Evidence and limits

The review used source tracing, the existing suites, real in-memory SQLite probes, Cloudflare's local Worker test runtime, and a preview build. Nine additional diagnostic probes confirmed the behaviors below. Counts are observed operations in synthetic fixtures, not estimates of production milliseconds.

| Probe | Observed behavior |
| --- | --- |
| Cached conversation A → B → A | Three server page requests, although full bodies were supplied on every mount |
| Rapid A → B → C with unresolved responses | Three outstanding server requests; only C's result was published |
| Simple disk body-cache hit | Four SQL operations; the body did not return until the LRU timestamp UPDATE completed |
| Reader request after the first 20 rows of a 100-row refresh | Reader remained queued until the window query completed; eight window operations plus four body-read operations |
| Same message identity, changed provider revision and unread flag | Previously available disk body became a cache miss |
| Done with two metadata-only threads | Selection advanced to the next thread synchronously; its body remained empty |
| Small HTML message, images and scripts disabled | Five direct parses of the supplied HTML and nine DOMParser calls including sanitizer internals |
| First page with a newer response revision | Newer messages were delivered to the parent with the older prop revision |
| Fully cached 20-message server conversation | 43 D1 queries, including 20 separate attachment queries; zero provider requests |

The installed production release, native storage-bridge latency, real keyboard-to-paint latency, and production Gmail/cache hit rates were not measured. Chrome DevTools trace tools are unavailable in this session. No Core Web Vitals score, production percentile, or millisecond savings is claimed.

## Pass 1 Keyboard navigation and Done

### F1 P1 Adjacent conversation bodies are never prepared

The selected-thread effect in [app.tsx](/Users/zackarychapple/code/tap-miniapp-example_email/apps/tap-email/src/app.tsx:1680) begins its disk read after selection. The keyed reader at [app.tsx](/Users/zackarychapple/code/tap-miniapp-example_email/apps/tap-email/src/app.tsx:3521) then mounts and begins its server page read. Neither path warms the next or previous thread. Mail-window queries intentionally omit hydrated bodies.

The Done action in [domain.ts](/Users/zackarychapple/code/tap-miniapp-example_email/apps/tap-email/src/domain.ts:1214) changes selection immediately using optimistic intents. It does not wait for the archive receipt or Gmail. The diagnostic confirmed that the newly selected thread can still have an empty body. The perceived delay therefore has a concrete explanation even when the command path is behaving correctly.

**Proposed fix:** introduce a bounded shared reader cache and warm a small neighborhood of the actual displayed rows, initially two ahead and one behind. Give the selected conversation priority over speculative work. Use the same cache entry when `j`, `k`, a click, or Done selects that thread. Prefetch bodies without marking mail read or recording view activity. Recompute neighbors after optimistic archive, filtering, account changes, and paging. Preserve the durable journal and rollback behavior.

### F2 P1 Repeated opens start redundant disk and server work

[PagedThreadMessages](/Users/zackarychapple/code/tap-miniapp-example_email/apps/tap-email/src/paged-thread-messages.tsx:72) resets its page session and calls `load()` whenever it mounts. It does this even when `messages` already contains the full conversation. The separate app effect also reads disk on a selection change without checking for a ready memory entry.

The cached A → B → A probe made three HTTP page calls. During rapid navigation, cleanup sets `request.active = false` but does not cancel transport work. [getThreadPage](/Users/zackarychapple/code/tap-miniapp-example_email/apps/tap-email/src/coordinator-client.ts:666) accepts no abort signal; requests use the shared 30-second timeout. Stale results are suppressed, which protects the view, but abandoned requests can continue consuming provider, server, and host resources. The probe left three requests outstanding during A → B → C.

**Proposed fix:** deduplicate in-flight loads by scoped conversation identity and page; return ready memory results immediately; restore cursor and page-completeness state with cached bodies. Revalidate according to freshness policy instead of fetching unconditionally. Cancel obsolete work where the TAP transport supports cancellation; otherwise bound concurrent work and discard queued requests for obsolete selections. Do not cancel a shared request while the active reader still needs it.

## Pass 2 Device caching and persistence

### F3 P1 A successful body-cache read waits for a database write

[readThread](/Users/zackarychapple/code/tap-miniapp-example_email/apps/tap-email/src/bounded-mail-replica.ts:304) loads metadata, verifies the body revision, reads the body record, and awaits an LRU timestamp UPDATE before returning. In the simple cached fixture this took four SQL operations. Pausing only the timestamp write prevented the already-read body from reaching the reader.

This is directly on the cached-open path. Larger bodies add bounded record-read round trips. Previous repository reviews describe native persistence cost, but the current native host's save duration was not measured here.

**Proposed fix:** return the body after read validation. Record touches in memory and coalesce them into lower-priority maintenance with bounded batches. A failed recency update should not hide an otherwise readable body. Preserve revision fencing, cancellation, eviction limits, and account-wipe behavior.

### F4 P1 Window refreshes can hold the reader behind a full query

[drainForegroundReads](/Users/zackarychapple/code/tap-miniapp-example_email/apps/tap-email/src/local-store.ts:811) runs its fixed snapshot of reads sequentially. Both [queryThreads](/Users/zackarychapple/code/tap-miniapp-example_email/apps/tap-email/src/local-store.ts:1047) and [loadThread](/Users/zackarychapple/code/tap-miniapp-example_email/apps/tap-email/src/local-store.ts:1063) use that queue. A progressive window read emits 20 rows early, but retains the queue through the rest of the page and its lookahead. Search can retain it while scanning more history.

The gated SQLite probe requested the selected body after the first 20 rows appeared. The body remained blocked while the next metadata batch was paused and ran only after the complete window read. Read priority over queued background writes does not solve this read-versus-read contention. [app.tsx](/Users/zackarychapple/code/tap-miniapp-example_email/apps/tap-email/src/app.tsx:1610) also requests a window refresh when pending thread intents change, including mark-read and archive actions.

**Proposed fix:** distinguish selected-body reads from list refreshes and maintenance. Split long window/search work into bounded units that yield between batches, with guards against changing the revision or journal view mid-query. Coalesce refresh requests during triage. Never interleave operations inside an active atomic write transaction or starve durable command saves.

### F5 P2 Label revisions invalidate unchanged body content

[readThread](/Users/zackarychapple/code/tap-miniapp-example_email/apps/tap-email/src/bounded-mail-replica.ts:309) requires the body record's provider revision to equal the thread's current provider revision. [writeReplicaThreads](/Users/zackarychapple/code/tap-miniapp-example_email/apps/tap-email/src/bounded-mail-replica.ts:197) also retains body enrichment only at the same provider revision. A metadata-only update with unchanged message identity but a new revision removed the cache hit in the probe.

Gmail history includes label additions and removals as well as message changes. A history revision alone therefore does not establish that message content changed. [Gmail history reference](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list). Keyboard navigation queues mark-read for unread conversations, and receipt settlement requests a provider sync, creating an opportunity for this cache churn. Its production frequency remains unmeasured.

**Proposed fix:** distinguish current thread/action revision from proven message-content identity. Preserve cached immutable message bodies across verified label-only changes while reconciling the current inventory and attachment metadata. Keep command preconditions tied to the current provider revision. Treat drafts, changed inventories, deletion, and uncertain content as invalidation cases; do not broadly ignore revision changes.

### F6 P2 First-page bodies can be associated with the wrong revision

The first-page session starts with `revision: null`, so [PagedThreadMessages](/Users/zackarychapple/code/tap-miniapp-example_email/apps/tap-email/src/paged-thread-messages.tsx:37) does not compare that response's revision with its incoming metadata revision. It publishes messages with the **prop** revision at line 56 rather than the response revision. [receiveThreadMessages](/Users/zackarychapple/code/tap-miniapp-example_email/apps/tap-email/src/app.tsx:2237) checks that supplied revision against the current thread before merging.

The probe supplied a newer first-page revision and confirmed that its messages were published with the older metadata revision. If metadata has not refreshed yet, the parent accepts those newer bodies under the old thread revision. A reusable reader cache must not preserve that mismatch.

**Proposed fix:** carry both requested and returned revisions through the load result. On a mismatch, reconcile or reload metadata before binding body content to it. Test initial-page changes as well as later-page changes, and ensure queued late results cannot populate an obsolete cache entry.

## Pass 3 Coordinator and provider loading

### F7 P1 Cached server pages have a serial query waterfall

[threadSnapshot](/Users/zackarychapple/code/tap-miniapp-example_email/apps/tap-email-coordinator/src/mailbox.ts:2014) loops over up to 20 messages. For each one it awaits `readExactMessageBody`, then a separate attachment query. The body helper reads ciphertext again even though the initial message query already returned it, and awaits text and HTML decryption. Each iteration also serializes the cumulative response to check its byte budget. All of this finishes before the JSON response is returned.

The local Worker probe with 20 ready, encrypted bodies made **43 D1 queries**: an initial thread read, one message-list read, 20 exact-body reads, 20 attachment reads, and a final revision read. It made zero Gmail requests. Authentication and any cold hydration would add work outside this count.

**Proposed fix:** validate the account and revision, reuse the selected ciphertext rows, and fetch the page's attachment metadata in one scoped query. Decrypt ready bodies with bounded concurrency and hydrate only missing ones. Preserve the final revision check, exact account/message scope, response-size bounds, chronological order, and pagination guarantees. The cached path should use a small fixed number of query phases rather than two more round trips per message. Cloudflare's guidance supports minimizing work on the response path. [Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/).

### F8 P2 Cold reader requests can hydrate the full conversation first

For a metadata-only thread, [threadSnapshot](/Users/zackarychapple/code/tap-miniapp-example_email/apps/tap-email-coordinator/src/mailbox.ts:1985) calls `fetchAndPersistThreads(..., 'full')` before selecting the newest response page. Large provider responses can trigger the existing oversized-conversation recovery path. Legacy missing-HTML repair can also run inline. This work may precede showing the one latest message that the UI expands by default.

**Proposed fix:** when the message inventory is complete and trustworthy, hydrate the newest requested page first and continue older bodies in background work. Legacy incomplete inventories still need explicit recovery. Bounded adjacent-thread prefetch can move these cold costs before selection without downloading every historical body to the device. Server body backfill helps provider readiness, but does not itself populate the local reader cache.

## Pass 4 Rendering and whole app contention

### F9 P2 A slow abandoned image load delays later cached images

[loadRemoteImages](/Users/zackarychapple/code/tap-miniapp-example_email/apps/tap-email/src/app.tsx:966) places the entire operation behind `remoteImageLoadQueue.current`, including the memory-cache check. An unresolved load for email A can therefore hold B's image work even when B's images are already in memory. Reader cleanup suppresses publishing stale results but does not cancel the queued operation. Body text is not explicitly gated by this queue; the issue affects the fully rendered appearance of image-heavy mail.

**Proposed fix:** resolve memory hits before joining the network queue. Deduplicate authorized missing-image work and apply a small concurrency limit with selected-message priority. Remove obsolete queued work, and publish disk/memory hits without waiting for unrelated misses. Preserve contextual authorization, URL validation, tracking preferences, private storage, and image byte limits.

### F10 P2 Warm opens still repeat substantial synchronous rendering work

The reader key remounts message components on every conversation change. [RichMessageBody](/Users/zackarychapple/code/tap-miniapp-example_email/apps/tap-email/src/rich-message.tsx:794) separately analyzes scripts, presentation, and quoted content before building a sanitized document. Its image effect sets a fresh empty object even when images are disabled, invalidating the document memo. The small static-HTML probe recorded five direct parses and nine total DOMParser calls on one mount.

Other repeated work includes full-message JSON serialization in [boundMailWindow](/Users/zackarychapple/code/tap-miniapp-example_email/apps/tap-email/src/bounded-mail-replica.ts:164), full-page JSON serialization in [MailWindowCache.set](/Users/zackarychapple/code/tap-miniapp-example_email/apps/tap-email/src/mail-window-refresh.ts:70), and rebuilding the list on app state updates. `ThreadListRow` has no memo boundary and receives a new `onSelect` closure for every parent render. These costs are confirmed code paths; their share of production latency is not yet quantified.

**Proposed fix:** reuse one sanitized analysis per immutable HTML value and avoid resetting an already-empty image map. Cache safe document strings with bounded storage and keys covering content, theme, mobile presentation, quotes, image state, script policy, and renderer version. Keep sender-script frames isolated; do not retain hidden live script frames as a shortcut. Cache measured byte sizes per immutable message/page and share body references across list and reader caches. Give list rows stable callbacks and props before adding memoization. React documents that fresh object/function props defeat shallow memoization. [React memo reference](https://react.dev/reference/react/memo).

The Rsbuild preview build passed and reported 1,322.4 kB total assets, 360.1 kB gzip, including an 868.8 kB combined app/vendor JavaScript footprint excluding the React chunk. The app eagerly imports compose, workflow, settings, and other optional UI. Deferring optional interfaces is a startup opportunity supported by [Rsbuild code splitting](https://rsbuild.rs/guide/optimization/code-splitting), but this preview is not the installed federated package, and download size does not explain a new wait on every `j`/`k` press. Address reader readiness first.

## Implementation order and acceptance criteria

1. Establish a shared reader result cache with explicit body readiness, returned revision, newest-page cursor, completeness, and in-flight request ownership. Resolve F6 before retaining results. Empty body text and nonempty snippets are not reliable completeness indicators.
2. Connect memory, disk, and server reads to that cache. Show ready bodies immediately, deduplicate loads, and warm the next two displayed threads and previous thread within a shared byte budget. Begin with at most two speculative requests; this is a proposed initial setting, not a measured optimum.
3. Remove LRU writes from body delivery and yield list/search work to selected-body reads. Preserve durable command priority and atomic transactions.
4. Batch the coordinator's cached-page work and target missing newest bodies rather than full-history hydration where inventories permit it.
5. Reduce redundant HTML parsing, byte serialization, list rendering, and image-queue contention. Investigate startup splitting after measuring the installed package.

Proposed release checks:

- On a ready prefetched neighbor, `j`, `k`, and Done display the correct latest body without waiting for disk, a write, or a server response. A proposed p95 keyboard-to-readable-body target is under 100 ms in the native host; it has not been achieved or measured here.
- A → B → A reuses the ready page and preserves loaded older-message state. Revalidation is independently scheduled and cannot regress displayed content.
- Rapid navigation has bounded outstanding work. Stale account, revision, page, or preference results cannot replace the selected conversation.
- Disk hits remain readable when LRU maintenance is delayed or fails. Large history scans and sync writes do not monopolize reader scheduling.
- Verified label-only changes preserve body hits. New replies, changed drafts, deletions, disconnects, privacy wipes, and uncertain inventories invalidate the correct scoped entries.
- Body retention stays bounded across the reader, recent-page cache, pager, and speculative work. Keep the existing 8 MiB UI-body and 32 MiB disk-body limits as constraints until measurements justify a change; separate caches must not silently multiply the intended budget.
- Cached server-page query counts remain approximately constant as messages per page increase, with existing size, encryption, scope, revision, and pagination tests still passing.

## Validation and remaining measurement work

- Existing Email suite: **574 tests passed across 93 files**.
- Existing coordinator suite: **248 tests passed across 20 files**, exit code zero. The Worker test runtime emitted RPC teardown warnings, so this was not a warning-free run. The isolated coordinator diagnostic passed cleanly.
- Targeted diagnostics: **eight app probes and one coordinator probe passed**.
- Email TypeScript check and Rsbuild preview build passed.
- Temporary probes were removed from application/test directories after execution. Copies and logs are retained locally in `/tmp/tap-email-performance-review-2026-10-01/`; imports in the copied probes assume their original source/test locations. The only retained repository change is this report.

The current diagnostics record startup phases and errors, but do not expose reader cache source, queue delay, request duration, or key-to-body timing. Add scoped timing marks for key handling, selected-body readiness, React commit, and frame readiness. Record cache hit/miss, request count, cancellation, database queue time, and provider hydration time without mailbox content. Measure cold opens, warm forward/back navigation, repeated Done, long HTML threads, image-heavy mail, offline reads, and concurrent history sync in the installed native host. This separates the confirmed causes above from their actual production contribution.
