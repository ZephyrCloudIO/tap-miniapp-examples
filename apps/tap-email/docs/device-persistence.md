# Device persistence

Issue #72 replaces the production whole-mailbox snapshot. Preview fixtures still
use disposable localStorage and do not represent the production durability path.

## Authority and limits

- `local_mail_records` holds complete account and thread records, individual
  message metadata, UI preferences, and separately identified body chunks. The
  existing normalized SQL tables provide indexes and counts. Loading, searching,
  and opening historical threads no longer depend on `mailbox_state.state_json`.
- `local_mail_journal` holds pending commands, recoverable send drafts, attempt
  receipts (including command/idempotency identity), pending overlays, and undo
  metadata. It commits in its own transaction before any evictable cache write.
  Mailbox bodies are stripped from thread undo records; command/draft payloads
  are preserved exactly. Applied-action receipts also retain their existing
  independent activity ledger.
- Each JSON record is split into at most 64 KiB parts, measured after JSON
  escaping in UTF-8. Insert batches include SQL, parameters, and a 4 KiB host
  envelope allowance and stay below 512 KiB and 900 parameters. This is below
  both the host's 24 MiB request limit and SQLite's 16 MiB row/value limit.
  Reads also return at most four record parts at a time.
- Metadata has no thread-count eviction limit. The UI reads keyset pages of 100
  threads, plus at most one selected thread. Search scans disk pages and can find
  matches anywhere in history. Meaning search indexes those pages incrementally
  and returns its usual bounded ranked results. Sidebar counts come from disk.
- Hydrated bodies have an 8 MiB UI budget and a 32 MiB disk LRU budget. A single
  cached body record over 8 MiB is not retained. Eviction leaves message headers,
  attachments, searchable previews (up to 8,000 characters), and thread metadata;
  the reader can refetch bodies. Long conversations roll to the requested page
  when accumulated bodies reach the memory budget, with a control to load newest messages again. Body search coverage is still explicitly partial.

## Page and command commits

`beginMailboxSync` creates a generation, or resumes its incomplete checkpoint.
`commitMailboxPage` verifies the generation, expected cursor, and page number in
one transaction, writes the page records/indexes, and writes the next cursor or
explicit completion marker. Any failure rolls back both records and progress.
A late page from a previous generation is rejected. Pages are additive: absence
from one page is not a deletion receipt. Account/device wipes remove all disk
records, including history outside the displayed window.

Revision guards, tombstones, and initial change-stream membership are stored in
`local_mail_versions`. Both head refresh and historical pages respect these guards.
A complete change replay prunes absent rows in bounded batches while retaining
head rows newer than its watermark; interrupted replays never prune. The change
cursor advances only after commit and restarts at zero across sessions. Resumed
history starts after a fresh head request, so older pages cannot delay current mail.

The traversal awaits each page commit before requesting another page. Streaming
mode retains only the current page and bounded duplicate/cycle detection, rather
than a second accumulated mailbox. Unmount aborts traversal and prevents subsequent
requests or commits. SDK 0.17's HTTP transport has no abort option; a request
already sent to the host may finish within its existing 30-second timeout, but
its result is discarded after cancellation.

UI persistence has one active write and one replaceable pending state. A fixed
250 ms timer cannot be extended indefinitely by continuous updates. Command
barriers are released from the exact snapshot committed to the journal, including
on retry. Cache failure does not retract a committed journal or release a newer,
unsaved command. Selection-only saves update UI state, not every mailbox row.
Delayed UI writes also cannot replace a newer provider revision.

## Migration and recovery

Migrations 22–29 are additive. When a legacy JSON snapshot is present:

1. Commit its command/draft/receipt journal first, unless that journal already
   exists. Resuming migration never overwrites newer journal contents.
2. Copy metadata and eligible bodies in transactions of 25 threads. Each
   transaction includes its migration offset. Failure rolls back that batch;
   restart resumes the last committed offset. The original snapshot remains.
3. Commit UI state and remove the old snapshot and migration marker together.
   Old page checkpoints are discarded because their separate writes cannot prove
   that their page records were saved. A fresh traversal uses idempotent upserts.

If opening/migration fails, the app attempts to recover the independent journal.
If even that cannot be read, automatic persistence stays disabled until retry
recovers and merges its commands with current UI actions. An empty UI must never
replace an unread recovery journal. Cache retry releases only its committed
command set.

Before final cutover, the original snapshot provides the migration recovery
source. After cutover, recovery proceeds using records and the journal; do not
roll the application back to a snapshot-only reader. Such a reader does not
understand the new journal. Roll forward with a compatible reader, or restore a
complete profile backup with deliberate reconciliation of any later commands.

## Validation

`bounded-persistence.test.ts` uses real SQLite transactions with enforced host
request/value limits. It covers the 26 MB mailbox reproduction, UTF-8/escaping
boundaries, a real 16 MiB SQLite limit probe, failed page commit/restart, stale
generations, interrupted migration with newer commands, retry/new-command races,
selection-only writes, history paging/search, body LRU retention, and coalescing.
The SQLite limit probe uses Python 3.11+ `sqlite3.setlimit`.
`coordinator-client.test.ts` covers backpressure, failed commits, cancellation,
and streaming traversal beyond 100 pages.
