# Email React review: two additional passes, 2026-10-01

Passes 11 and 12 follow the four-pass and six-pass performance reviews. Scope: the React integration of miniapp-owned Query/Store/Pacer, downloaded conversation pages, SQLite restoration, and activity scheduling. Findings below distinguish reproduced defects from source inspection. Fixes are in the working tree.

## Pass 11 — hook ownership, effects, and duplicate reads

**P1, fixed: callback changes restarted a pending conversation read.** `load` depended on `onMessages`; the load effect depended on both. Replacing only the publication callback generated **2 backend requests instead of 1**. The reader now keeps the latest callbacks in a committed ref and keys the load lifecycle by client, cache, account, thread, and revision. Its regression test verifies one request and publication to the latest callback. This is one load owner, not parallel parent/child hydration hooks.

**P1, fixed: effect replay could permanently close the current session's resources.** Source inspection found cleanup closing Pacer queues, SQLite stores/ledgers, and clearing Query while Strict Mode reconnects the same component. Session resources now use lazy state ownership; `useMemo` handles derived values rather than resource lifetime. A single `useSessionCleanup` hook defers finalization one microtask and suppresses cleanup only when the same session reconnects synchronously. Tests verify a real Pacer queue remains usable through replay, closes once on unmount, and a replaced keyed session still finalizes. Authenticated scope checks continue to prevent old-session activity publication.

**P2, fixed: Query shared backend work but not the preceding SQLite read.** Strict Mode started **2 pending local lookups instead of 1**. The miniapp QueryClient now shares account/thread/revision-scoped pending disk reads. Disk queries use `networkMode: 'always'`, zero freshness, and zero retention after completion: SQLite remains the durable cache, and successful reader restoration goes into the existing conversation snapshot. A reader unmount stops publication without cancelling another reader's shared lookup; revision/account removal or session disposal cancels it. Tests cover replay, offline reads, fresh subsequent disk reads, and cancellation after account removal.

**P1, fixed: a resident parent page could discard accumulated downloaded pages.** Reopening a thread with a two-message completed Query snapshot and an earlier one-message parent page rendered only **1 of 2 available messages** and restored the old cursor. The reader now prefers an accumulated Query snapshot, then validated resident data, then a raw first-page result. The regression verifies both messages remain, completion remains true, and no backend request occurs.

Reader Store changes now go through one equality-checked patch function rather than four independent setters. Loading/error and page/window changes publish together; identical updates preserve the current state object. The parent also ignores already-applied message/marker references, avoiding redundant mailbox persistence scheduling.

## Pass 12 — memoization, subscriptions, and repeated rendering work

**P2, fixed: stable content rerendered through reader status and unrelated parent updates.** Neither the list nor message cards had a memo boundary. A ten-render HTML-only/plain-mode diagnostic recorded **20 extra DOMParser calls**. `ThreadMessageList` and each card now use normal `React.memo` comparison. Message composition and outgoing lookup share one `useMemo`; the empty outgoing default is stable. The same diagnostic now records **0 extra parses**, while changing HTML policy still updates the reader. Opening another message also does zero parsing of an unchanged expanded sibling; changing that sibling's body still updates it.

Memoization is wired into the actual app: the iframe and document listener receive one stable keyboard dispatcher whose handler updates at commit, and outgoing-message arrays depend on accounts, commands, outbox, selected conversation bodies, confirmed sends, and errors. The list retains all rendering-policy props in comparison; there is no custom comparator that could conceal body, theme, image, script, or attachment-policy changes.

**P2, fixed: selected-thread lookup repeated mailbox projection and sorting.** The app previously memoized rows against the entire MailState and independently called `selectedThread`, repeating projection/filter/sort. The shared mailbox candidate memo now depends on threads, pending intents, account, split, and whether search is active. Rows and non-search selection reuse it. Outbox derivation has similarly narrowed inputs; selector signatures express those requirements. Selection, preference, and activity-status changes do not invalidate these mailbox candidates.

**P2, fixed: static rich messages rebuilt their document after mount.** Resetting remote images to a new empty object invalidated the existing document memo even when there were no images to fetch. A static-message mount did **9 parser calls**, compared with **7** for a single render. The shared empty map reduces mount to **7**. Script-free/disabled content also avoids requesting the isolated script renderer. Regression coverage verifies the static baseline and that adding a script still requests its renderer.

The reader keeps one Store subscription for its small control state; memoized bodies isolate loading/error updates. Existing rich-body memos have distinct responsibilities: presentation, quote presence, image requests, and the sanitized document. No redundant Query observer hook or parallel Store/React state subscription was added.

## Measured results and limits

| Reproduction | Before this review | After fixes |
| --- | ---: | ---: |
| Callback-only change during a pending read | 2 backend requests | 1 |
| Strict Mode with a pending disk lookup | 2 SQLite lookups | 1 |
| Ten unchanged HTML-only/plain-mode parent renders | 20 additional parser calls | 0 |
| Static rich-message mount, no remote images | 9 parser calls | 7 |
| Reopen completed snapshot with an earlier resident page | 1 of 2 messages | 2 of 2, no fetch |
| Ten already-downloaded alternating opens | 0 page / 0 disk reads (previous fix) | 0 page / 0 disk reads retained |

These are executed regression counts in jsdom, not installed-app paint timings. The previous Superhuman comparison remains in the [six-pass report](email-performance-six-pass-2026-10-01.md); this review does not claim new live j/k latency measurements.

**Follow-up, October 3:** sidebar counts, summary dependencies, row grouping/formatting, stable row callbacks, repeated navigation sorting, Query size accounting, and SQLite recency writes are now addressed in the [implementation report](email-performance-improvements-2026-10-03.md). The broader shell still renders when selected mail changes; installed-app frame/paint latency remains unmeasured. Cold uncached bodies still require disk and possibly a backend read.

## Validation and references

Validation passed: **612 tests across 96 files**, application and TAP type checks, preview build, and the complete SDK package build. Package checks verified both TAP targets, six exposed federation assets, one private React/React DOM runtime, and six matching archived source maps. Logs are recorded in `email-performance-evidence-2026-10-01/react-two-pass`. This review covers the source and built package; it does not publish or install a release.

Relevant source: [session integration](../../apps/tap-email/src/app.tsx), [reader](../../apps/tap-email/src/paged-thread-messages.tsx), [Query cache](../../apps/tap-email/src/conversation-query-cache.ts), [session cleanup](../../apps/tap-email/src/use-session-cleanup.ts), [message boundaries](../../apps/tap-email/src/thread-messages.tsx), [rich document](../../apps/tap-email/src/rich-message.tsx).

Primary React references: [Strict Mode effect replay](https://react.dev/reference/react/StrictMode), [useMemo as an optimization rather than an ownership guarantee](https://react.dev/reference/react/useMemo), and [memo and prop identity](https://react.dev/reference/react/memo). Applied the Vercel React performance skill's guidance on effect dependencies, stable callback refs, lazy initialization, memo boundaries, and stable defaults.
