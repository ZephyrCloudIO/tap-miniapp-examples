# Mailbox count correctness and refresh — 2026-10-03

The supplied sidebar image exposes multiple issues. Folder totals are explicitly hidden by `showCounts={false}`. Their underlying values come from the bounded in-memory reader/list window, while Critical, Needs response and Waiting use a separate full-replica attention summary. That summary waits for a 250 ms timer, which commands and sync changes can repeatedly restart; the last completed value keeps winning until another query finishes. An incomplete history is mentioned in the card but displayed numbers look definitive.

The classifications themselves are also broad. The email coordinator marks Important or Starred mail as critical, and incoming inbox mail from another person as needing response unless the sender is classified as automated. These are mail flags and potential replies, not independently verified urgency or obligations. The revised navigation descriptions expose that distinction. This patch does not introduce a new classification engine or claim that the screenshot's precise totals match the current provider mailbox.

## Changes

- All supported provider folder and attention counts come from one full-replica summary, scoped to the selected account. A single aggregate reads normalized membership for Inbox, Starred, Drafts, Sent, Done, Reminders, Spam, Trash and the three TAP views. Pending membership changes use bounded metadata reads, rather than one complete reader load per affected email.
- Schema versions 31–32 preserve whether provider resources were explicitly supplied, including an empty array. Migration reconstructs split legacy metadata before checking that marker, so empty provider membership is not treated as an old status/Starred fallback.
- `useMailboxCounts` replaces the previous summary state/effect. It allows one active query and coalesces changes into the latest request; there is no resettable delay. Superseded results and results from another store/account cannot publish.
- A body-free snapshot of observed thread flags applies pending actions immediately to full-replica totals. Acknowledgement preserves the delta until the next matching summary; undo or failure restores it. Reader-only movement does not invalidate summaries. The existing j/k render-work regression still reports no summary, grouping or timestamp work across ten warm moves.
- Folder counts are visible. `≈` identifies partial or refreshing totals; unavailable adapters show `—` instead of invented zeros. Outbox uses the local command journal and is not marked as incomplete merely because provider history is incomplete. Operational Zero remains gated on verified coverage and fresh replica totals. A failed disk refresh preserves cached values and marks them partial.

Counts measure conversations according to the same folder selectors used by the list. Complete local totals depend on full provider/replica synchronization. This UI change does not repair missing remote history or make an unavailable provider current.

## Review pass 1 — membership and persistence

Compared normalized SQL predicates with `threadMatchesSplit`, including explicit empty resources, legacy fallbacks, reminders, overlapping Sent/Starred membership and Trash. Checked pending archive/star adjustments, account filtering, schema upgrade ordering and chunked metadata migration. Counts never hydrate body records. Corrected the summary's Inbox field to use the same resource membership as the visible folder count.

Real SQLite regression: with 240 stored conversations and a 10-row loaded window, Inbox remains 240. Archiving one and starring another yields Inbox 239, Done 1 and Starred 81, while the other account remains zero. Another regression compares every supported folder count with the shared selector and exercises migration of a multipart legacy metadata record containing explicit empty resources.

## Review pass 2 — React and freshness

Reviewed Strict Mode replay, slow query coalescing, superseded inputs, account/store changes, failed refreshes, optimistic acknowledgement and rollback. The render-work test caught unnecessary recomputation caused by depending on the entire UI state; dependencies now follow count-relevant data. The UI regression confirms a 100-row list displays all 111 stored Inbox conversations and still isolates account switching while the next list is loading.

671 tests across 111 files, app and TAP type checks, and both preview/SDK package builds passed. The package checks verified schemas, ABI, private React ownership and archived source maps. No worker API, provider mutation or activity delivery behavior changed.
