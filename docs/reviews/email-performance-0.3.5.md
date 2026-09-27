# Email 0.3.5: progressive cached mail

## Problem

After 0.3.4, Inbox and Sent eventually loaded but still took tens of seconds during history sync. A full 100-thread window loaded each thread and message separately, loaded bodies again, and updated body LRU timestamps before rendering any rows. Native SQLite execute calls persist the database, so even a list read could cause repeated database saves. Navigation also waited for the UI cache write queue.

## Behavior

- Startup loads 20 cached threads for the saved account/folder, without hydrated bodies.
- Lists deliver 20 rows at a time, filling the existing 100-thread page while preserving keyset pagination and account scope. Existing rows stay visible during refresh; the final result removes stale rows.
- Returning to a recent view renders its retained rows before the disk request completes. This cache holds at most 12 pages and 8 MiB, and clears on account membership changes or a privacy wipe.
- Only the selected conversation loads bodies. Superseded navigation and queued reader loads are cancelled.
- A navigation read runs after the active atomic transaction, ahead of queued background operations. It does not flush the UI cache first. Current pending intents are supplied directly, and unsaved row edits remain staged until committed. The durable command dispatch barrier remains in place.
- Thread/message metadata reads, sync revision guards, and prior-record reads are batched. Candidate selection includes local overrides without scanning unrelated folder history, with bounded SQL parameters.

## Read-only production-cache comparison

The same saved mailbox was queried for both accounts and Inbox/Sent. Old list reads used the 0.3.4 body-loading behavior; new list reads use metadata and progressive delivery. Both returned the same 100-thread page size. No production database writes were made; old LRU updates were counted but suppressed.

| View | 0.3.4 bridge calls before rows | 0.3.5 calls before first 20 | 0.3.5 calls for 100 + lookahead |
| --- | ---: | ---: | ---: |
| Account 1 Inbox | 610 | 2 | 8 |
| Account 1 Sent | 508 | 2 | 8 |
| Account 2 Inbox | 538 | 2 | 8 |
| Account 2 Sent | 522 | 2 | 8 |

The old queries also attempted 1–7 LRU writes per view; new list queries perform none. These are database-operation measurements, not native UI timings. An uncached view can still wait for an already-running atomic transaction. Native-host latency must be measured after the merged package is installed; this change does not claim a measured production millisecond SLA.

## Validation

Regression coverage includes first-batch delivery, cancellation, metadata response boundaries and missing records, account-scoped startup, paging, hundreds of pending folder overrides, foreground read priority, staged corrections, and React navigation with delayed/stale reads. Existing command durability, migration, rollback, body budgets, and revision reconciliation tests remain part of the suite.

Local validation: 439 Email tests passed; Email and TAP TypeScript checks passed; manifest validation passed; the 0.3.5 production package passed SDK, private React runtime, and source-map verification.
