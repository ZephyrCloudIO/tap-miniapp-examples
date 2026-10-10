# Calendar performance and caching review

Reviewed on October 9, 2026 at commit `080e971` (TAP Calendar `0.3.7`). Four read-only passes covered the boot and render path, the client network layer, the client event cache, and the gateway Worker's event sync. The highest-impact claims were then re-checked against the source. No production code was changed by this review.

The slowness is architectural, not a single bug. Every foreground calendar read blocks on a server-side Google re-sync of every visible calendar. The client asks for that blocking mode on every navigation, focus, and 5-minute tick. The client cache rarely hits because entries are keyed by an exact time window plus an exact calendar set. Failed calendars never recover, which produces the persistent "Some calendars cached · oldest 9 days ago" label. On top of that, first paint waits for two network calls even though local state is already loaded.

## How a calendar load works today

1. [app.tsx:1753](../../apps/tap-calendar/src/app.tsx) reads stored state, then waits for `shared.open()` (GET `/v1/settings`) **and** `listConnections()` before calling `setState`. Until both return, the full-screen loader shows and no calendar IDs exist, so cached events cannot render either.
2. [use-calendar-event-cache.ts:364](../../apps/tap-calendar/src/use-calendar-event-cache.ts) sends the current range with `revalidate: "wait"` and the two adjacent ranges with `"background"`, all at once.
3. The Worker's `queryEvents` marks any calendar whose last success is older than `CACHE_FRESH_MS` (2 minutes, [index.ts:493](../../apps/tap-calendar-gateway/src/index.ts)) as stale. In wait mode it syncs those calendars with Google before replying, 4 at a time ([index.ts:484](../../apps/tap-calendar-gateway/src/index.ts)).
4. Each calendar sync makes about 10 sequential D1 calls plus 1–2 Google calls, and copies every cached row into a new generation even when nothing changed.
5. The client merges the response, rewrites the whole cache snapshot (up to 900 KB) to host storage, and repeats this every 30 s for settings and connections, and every 5 min plus every focus for events.

For a user with 22 calendars that is 6 sync rounds per navigation, roughly 2.5–6 s before fresh events appear. The adjacent prefetches can make it up to 5 s worse by holding sync leases.

## P0: the causes of "loads slow"

### F1 First paint waits on the network although local state is loaded

Confirmed at [app.tsx:1753-1777](../../apps/tap-calendar/src/app.tsx). With a slow network the host's 30 s timeout applies ([gateway.ts:888](../../apps/tap-calendar/src/gateway.ts)) before stored data appears. That only happens in the catch path, and only if accounts exist.

**Fix:** call `setState(loaded.state)` immediately after `loadCalendarState`, show a "syncing" chip, and reconcile settings and connections in the background. Edits are already gated on `sharedCalendarRef.current?.ready`, so this is safe. Start the event-cache storage load and the first event query in parallel, not in sequence.

### F2 Every foreground read blocks on a full Google re-sync

Confirmed. The client always uses `"wait"` for the current range ([use-calendar-event-cache.ts:364, 380](../../apps/tap-calendar/src/use-calendar-event-cache.ts)). The Worker treats 2 minutes as stale ([index.ts:5420-5424](../../apps/tap-calendar-gateway/src/index.ts)) and syncs synchronously in wait mode.

**Fix, both sides:**
- **Client:** use `"background"` whenever a cached slice exists. Keep `"wait"` for a cold miss or an explicit refresh.
- **Worker:** when D1 covers the requested range, return it immediately and finish revalidation in `waitUntil`. Give wait mode a time budget of about 1–1.5 s. Never poll on another request's sync lease. Extend freshness to hours for calendars with a working push watch.

### F3 Incremental syncs rewrite the entire calendar cache

Confirmed. Each sync copies all rows into a new generation and deletes the old one, even when Google reports zero changes ([index.ts:4694-4765](../../apps/tap-calendar-gateway/src/index.ts)). Bookings do the same ([index.ts:6916-6935](../../apps/tap-calendar-gateway/src/index.ts)). At 22 calendars × ~1,000 rows, that is about 44k row writes per refresh on a single shared D1 database.

**Fix:** on a zero-change sync, update only the token and timestamps. Otherwise apply changes in place in one atomic `batch()` with the state update. Keep generation copies for full rebuilds only.

### F4 The client cache almost never hits

Confirmed at [event-cache.ts:115-126, 266-273](../../apps/tap-calendar/src/event-cache.ts). The key is the exact `timeMin`/`timeMax` plus the exact sorted calendar-ID set.
- Switching day, week, month, or agenda starts cold.
- Showing one more calendar misses for all 22.
- Each visibility combination stores duplicate copies of the same events.
- Prefetched neighbors are stamped `lastAccessedAt = 1970`, so they are evicted first and the prefetch is mostly wasted.

**Fix:** see the re-architecture below. In the short term, reuse any entry whose window covers the request, and fetch only the calendar IDs that are missing.

## P0: why the cache is wrong or stale

### F5 One failing calendar pins the "oldest 9 days ago" label indefinitely

Confirmed end to end.
- **Worker:** it keeps serving a calendar from D1 with its old `lastSuccessAt` and an `error_code`. `stateUsableForQuery` has no maximum age ([index.ts:5404](../../apps/tap-calendar-gateway/src/index.ts)).
- **Client:**
  - It copies that time into `calendarSyncedAt` ([event-cache.ts:473-479](../../apps/tap-calendar/src/event-cache.ts)).
  - Any error marks the entry `partial` ([event-cache.ts:493-497](../../apps/tap-calendar/src/event-cache.ts)).
  - The label shows the oldest timestamp ([event-cache.ts:516-524](../../apps/tap-calendar/src/event-cache.ts)).
  - The error code and calendar are discarded, so the UI cannot say which calendar is broken or offer a fix.

**Why it never recovers:**
- **Token reset is too narrow:** only HTTP 410 drops the `syncToken` ([index.ts:4680](../../apps/tap-calendar-gateway/src/index.ts)). `provider_pagination_limit`, `event_limit_reached`, and `provider_response_too_large` repeat with the same token forever. A likely trigger is an incremental sync with `singleEvents=true` on calendars full of open-ended recurring series, which matches the many "Transferred from …" calendars.
- **Rate limits look permanent:** Google's `rateLimitExceeded` 403 is labelled `provider_access_denied` ([index.ts:4127-4137](../../apps/tap-calendar-gateway/src/index.ts)).
- **Lost calendars are never dropped:** deleted or unshared calendars return 403/404 forever. The calendar list is only rediscovered by the manual `POST /v1/connections/:id/sync`.
- **Backoff is bypassed:** `stateNeedsRevalidation` returns true for any non-fresh state, so `next_sync_at` is ignored and every wait read retries the failing calendar synchronously. A pagination-limit failure costs about 20 sequential Google pages (4–8 s) on every load.
- **Client retries constantly:** `needsCatchUp` is always true for a partial entry ([use-calendar-event-cache.ts:79](../../apps/tap-calendar/src/use-calendar-event-cache.ts)), so every focus fires three more queries.

**Fix:**
- **Worker:** treat those codes as permanent, clear the token and rebuild with the reduced window. Read Google's 403 `reason`. Honor `next_sync_at` on the read path. Rediscover calendar lists daily and on any 403/404.
- **Client:** store per-calendar `{error, lastSuccessAt, nextSyncAt}`. Name the failing calendar with Reconnect and Hide actions. Compute "Updated" from healthy calendars only.

To confirm in production:

```sql
SELECT calendar_id, error_code, error_message, consecutive_failures, last_success_at,
       cache_time_min, cache_time_max, watch_expiration_at
FROM calendar_sync_state
WHERE last_success_at < '2026-10-08'
ORDER BY last_success_at;
```

### F6 One large range can wipe the entire client cache

Confirmed by simulation against the real functions. `pruneCalendarEventCache` pops entries until the cache fits, including the entry just written ([event-cache.ts:319](../../apps/tap-calendar/src/event-cache.ts)). Events carry descriptions up to 64 KB and up to 10 attendees each.

A realistic month of 600 events (about 2 KB each) exceeds 900 KB, so every entry is evicted and an empty cache is persisted ([use-calendar-event-cache.ts:333-336](../../apps/tap-calendar/src/use-calendar-event-cache.ts)). The sync status then stays "syncing" because a `null` entry never updates it, and the refresh button stays disabled.

**Fix:**
- Never evict the key being written.
- Always set sync state when the entry is `null`.
- Drop `description` from the cache and list responses, and load details when an event opens.

### F7 Month view never fetches the leading and trailing weeks

Confirmed. The month fetch window runs from the 1st to the 1st of the next month ([gateway.ts:1074-1076](../../apps/tap-calendar/src/gateway.ts)), but the grid shows 42 days starting on the Sunday before the 1st ([calendar-board.tsx:338-351](../../apps/tap-calendar/src/calendar-board.tsx)). Visible days outside the month never get provider events, which looks like a cache that is not updating. **Fix:** make the fetch window match the grid.

### F8 1 MiB response cap with all-or-nothing validation

Confirmed mechanism, frequency suspected.
- **The cap:** the client sets `responseBodyLimitBytes: 1_048_576` ([gateway.ts:889](../../apps/tap-calendar/src/gateway.ts)); the host default is 5 MiB.
- **Who hits it:** month view, the 30-day agenda, and public-availability windows can exceed it. When they do, the whole range fails as "Refresh failed".
- **One bad event fails everything:** a single event that fails validation rejects the entire response ([gateway.ts:697-698](../../apps/tap-calendar/src/gateway.ts)).

**Fix:** return a slim list projection, raise the limit, and drop invalid events individually.

## P1: steady-state waste

- **The 30 s poll reruns the whole boot load ([app.tsx:1776-1777](../../apps/tap-calendar/src/app.tsx)).** Focus and online events trigger it too, with no in-flight guard.
  - **What each run does:** two HTTP calls and storage reads. It also writes the replica unconditionally ([tap-shared-state/src/index.ts:152](../../apps/tap-shared-state/src/index.ts)).
  - **Re-renders:** it always produces a new state object, so the whole tree re-renders.
  - **Blocks saves:** it shares `queueCalendarWork` with user saves, so a slow refresh delays edits.
  - **Overall load:** about 360 gateway calls per hour from one idle tab.
  - **Fix:** coalesce runs, call `setState` only when the state actually changed, poll every 2–5 min while visible, and take refreshes off the mutation queue.
- **A focus event fans out to many requests.** `listConnections` runs twice, plus meeting providers, MCP configuration, five sequential outbox storage reads, and event catch-ups. Each gateway call first awaits an uncached `sdk.authorization.check`.
  - **Fix:** share one connections resource, cache the authorization decision, and throttle focus handling.
- **Activity sync restarts on every state change ([use-calendar-activity-sync.ts:68](../../apps/tap-calendar/src/use-calendar-activity-sync.ts)).** On every mount it re-posts up to 512 journal entries as 8 sequential POSTs, because acknowledgements live only in memory.
  - **Fix:** key the effect on the journal head and persist an acknowledged watermark.
- **Switching views runs the full shared-save pipeline.** `activeView` is not even a shared field, and the view switcher is disabled while it saves.
  - **Fix:** persist `activeView` locally only.
- **A second event-cache instance is always mounted (`publicAvailabilityCache`).** It loads and validates the full snapshot at boot. While the public booking preview is open, it fights the main instance for the same storage key with an independent revision. A second consecutive conflict silently drops a write.
  - **Fix:** use one shared store per principal.
- **The Worker cron can't keep up.** It syncs 20 calendars per 5-minute run, one at a time, across all users. Every healthy calendar is due again 5 minutes later.
  - **Fix:** use Queues or parallel fan-out, set 6–12 h cadences for watched calendars, and prioritize active users and calendars with errors.
- **Per-request Worker overhead.**
  - `principalScope` makes an authorization RPC plus a 6-table legacy check, twice whenever a live fallback runs.
  - 22 `ensureCalendarSyncState` upserts run, then the same rows are re-read.
  - There is no Smart Placement.
  - **Fix:** pass the scope through, batch the upserts, and add `"placement": { "mode": "smart" }`.
- **Sync locks can stick.** A failed final commit returns without releasing the lock, and `waitUntil` work cut off after 30 s leaves leases held.
  - **Fix:** release the lock on every exit and move full rebuilds to a queue.

## P2: render cost

`TapCalendarApp` holds about 25 `useState`s and no component uses `memo`, so every focus causes 6–10 full-tree renders.

| Hotspot | Cost per render |
| --- | --- |
| Week view slot buttons | 336 buttons, about 672 `Intl` format calls |
| Per-day event filtering | About 14×N date parses; month view about 42×N |
| `Intl.DateTimeFormat` | Constructed inside render loops |
| Upcoming event | `visibleEvents` copied, filtered and sorted |
| `displayState` | O(provider × local) duplicate scan |

There is no code splitting. The time-zone search index (about 400 zones × aliases with Unicode normalization) is built at module scope before the spinner renders.

**Fix:**
- `memo` the board and calendar list.
- Group events by day once.
- Hoist formatters out of render.
- Lazy-load the non-calendar sections and dialogs.
- Build the time-zone index on first use.

## Recommended order

1. **Quick wins (days):**
   - Render stored state at once (F1).
   - Use background revalidation when a cached slice exists (F2, client side).
   - Never evict the entry being written, and drop descriptions from the cache (F6).
   - Fix the month window (F7).
   - Raise the response cap (F8).
   - Coalesce the 30 s poll and skip unchanged `setState`.
2. **Worker correctness (about a week):**
   - Serve cached data first with a wait budget (F2).
   - Make zero-change syncs write nothing (F3).
   - Add permanent-error recovery, honor backoff, and rediscover calendar lists (F5).
   - Release sync locks on every exit.
3. **Client cache redesign (1–2 weeks):** the architecture below, plus the per-calendar health UI (F4, F5).
4. **Render and bundle:** memoization, per-day indexing, lazy sections.

## Target cache architecture

- **One store per principal** shared by every consumer, with one revision and debounced writes.
- **Entries keyed per calendar and per UTC week**, holding `{events, lastSuccessAt, error, nextRetryAt, serverRevision}`. Any view or calendar set is assembled from these chunks, so view switches and visibility toggles always hit.
- **Slim list events.** Descriptions and the full attendee list load when an event opens. Storage is split into an index plus chunks, or uses profile SQLite where available.
- **Background revalidation by default.** Wait only for cold chunks or a manual refresh. Per-calendar backoff honors the server's `nextSyncAt`.
- **Delta requests.** The client sends its per-calendar `cacheRevision`, and the Worker replies `unchanged` for calendars that haven't moved.
- **Optimistic mutations.** Creates, RSVPs, and work blocks patch the store immediately; a forced revalidation reconciles afterwards.

## Client fixes applied (October 10)

These landed in `apps/tap-calendar` and `apps/tap-shared-state`. The Worker items (F2 server side, F3, F5 server side, sync locks, cron) are still open.

- **F1:** saved calendars paint before the settings and connections round trips. A device with no saved accounts still waits.
- **F2, client side:**
  - Automatic loads use `background`: the gateway's cache returns at once, and one follow-up read 5 s later collects the server-side refresh.
  - A range fetched in the last minute is shown without a request.
  - Neighbors are prefetched only after the visible range, and only when due.
  - `wait` is reserved for manual refresh and booking-preview conflict checks.
- **F5, client side:**
  - Cache entries record failed calendars.
  - The label names them ("“Holidays” isn’t updating", full list in the tooltip) instead of showing "oldest 9 days ago".
  - Freshness is computed from healthy calendars only.
  - Partial ranges retry at most once a minute rather than on every focus.
- **F6:** pruning never evicts the most recently viewed range, and sizes each entry once.
- **F7:** the month window matches the 42-day grid.
- **F8:** the response cap is now 5 MiB, and a malformed event is dropped individually.
- **Steady state:**
  - The settings refresh is coalesced, runs every 3 min only while visible, and runs on focus at most every 20 s. It skips `setState` when nothing changed.
  - `SharedState.flush` no longer rewrites an unchanged journal.
  - Activity sync restarts only when the journal changes, never overlaps itself, and polls every 2 min.
  - MCP and activity sync wait for shared settings.
  - The booking-preview cache stays idle until a preview opens.

## Evidence and limits

All findings come from source tracing at the commit above. F6 was confirmed by a simulation against the real `event-cache.ts` functions. Timing figures are estimates from round-trip counts and concurrency limits, not production measurements. Production D1 contents, Google quotas, host storage latency, and real-device render timings were not measured. Run the SQL above to confirm which calendars are behind the "oldest 9 days ago" label.
