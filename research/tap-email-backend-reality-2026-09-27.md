# TAP Email backend, MCP, persistence, and follow-up reality review

Reviewed 2026-09-27 against `f3fa6b493ecd757e48ff69eb4015352e7b1d142b` (latest main checked out by the parent review). This is a source review and three focused local reproduction tests, plus two unauthenticated production HTTP checks. It does not attest authenticated live mailbox behavior, installed host permissions, or which source revision is deployed.

## Assessment

The backend has become substantially more useful since the September 20 audit. The specialist now has an implemented route to mailbox metadata, exact message bodies, provider drafts, sending, and command receipts. The coordinator has durable sync and command queues. Gmail synchronization traverses the whole account, with historical metadata and on-demand bodies. Device persistence has moved from a whole-mailbox JSON snapshot to bounded SQLite records and an independent command journal.

Those are real capabilities, but several interfaces were not updated together. In particular, the MCP reader assumes every stored message has a body even though history ingestion now deliberately stores metadata-only messages. Long-thread MCP discovery also stops at the oldest 50 messages. The product can therefore have durable, searchable thread metadata while the assistant still cannot retrieve the necessary evidence.

## What is implemented

| Area | Verified source behavior | Practical limit |
|---|---|---|
| Live Email MCP | Seven tools: account discovery, structured thread search, thread metadata, plaintext message reads, provider draft save, send, command receipt. Registered Streamable HTTP transport and signed tool-schema references. | Requires coordinator deployment, SDK-compatible host, user connection token, consumer grants, and tool permissions. No authenticated live validation in this review. |
| Authentication | Random 256-bit token; only SHA-256 digest stored; 30-day expiry; one credential per profile; rotate/revoke supported. Separate from platform-session authorization. | Read token grants metadata and content over that profile's connected accounts. Optional write scope bundles draft and send; it is not account-specific. |
| Sender attribution | A write token captures a user/workspace verified at issuance. MCP arguments cannot override that context. Submission checks account ownership/active connection and routes through the normal command pipeline. | Changing sending workspace requires replacing the token. Credential delegation is not reverified against Session/Directory on each send. |
| Mail writes | Encrypted durable commands, fixed command/idempotency identity, conflict detection, queue dispatch recovery, provider-draft leases, authoritative applied/failed/uncertain receipts, explicit uncertain-send reconciliation. | MCP supports plaintext draft/send only. Archive, trash, labels, reminders, schedules, attachments, and outbox reconciliation are UI/REST capabilities, not exposed live MCP operations. |
| Ingestion | Gmail account-wide thread listing with `includeSpamTrash=true`; first page requests full content, historical pages request metadata; history polling; durable events and redispatch; full-traversal deletion sweep. | Account metadata coverage and message-body coverage differ. Counts/MIME completeness are not established for exact MCP reads. Google is the implemented provider. |
| Conversation reader | REST selected-thread endpoint can hydrate metadata messages, paginate by ordinal, guard provider revision, and limit response bytes. | These capabilities are not reused by live MCP. |
| Follow-ups | Send-linked reminder creation uses the provider's actual sent thread/time; same-transaction sent checkpoint; idempotent reminder key; reply satisfaction; due-state cron; conditional scheduled send performs a fresh provider reply check. | A reminder is a timed condition, not a maintained semantic commitment. No autonomous draft-and-review follow-up workflow is supplied by these backend pieces. |
| Activity | Actual SDK activity-source contribution backed by a local SQLite receipt/view ledger; zero-valued action/status pairs; coordinator receipt reconciliation includes MCP and scheduled sends. | Only reconciles while Email is open. Installation-local, bounded to 90 days/10,000 local events and 2,048 published entries; cannot represent complete cross-device totals. |
| Device durability | Independent journal, chunked records, bounded reads/writes, resumable migration, transactional page/cursor commits, generation fencing, revision/tombstone handling, body LRU, prioritized navigation, bounded UI window. | Durable metadata does not imply complete body search or a whole-mailbox AI input. Parent review separately reproduced lost search previews and page-limited workflow input. |

Evidence: `mcp.ts:205–434`, `mcp-auth.ts:6–48`, `index.ts:547–698,1317–1444,2176–2190`, `mailbox.ts:1037–1058,1856–1949`, `follow-up.ts:11–53`, `google.ts:858–998`, `activity-source-runtime.ts:9–35`, `activity-ledger.ts:41–63,237–307`, `app.tsx:1757–1803`, `local-store.ts:845–875,905–945,1012–1043`, `bounded-mail-replica.ts:11–45,90–119`. Paths are under `apps/tap-email-coordinator/src` or `apps/tap-email/src` as appropriate.

## Confirmed findings

### B01 — Historical message content can be reported as an empty successful MCP read (P1)

**Trigger:** A historical email has been indexed as metadata and has not been opened/hydrated, or a later metadata sync has replaced a previously hydrated replica message.

- Historical pages explicitly pass `contentState: 'metadata'`: [mailbox.ts](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/f3fa6b493ecd757e48ff69eb4015352e7b1d142b/apps/tap-email-coordinator/src/mailbox.ts#L1049), especially line 1057.
- Persistence encrypts the parsed empty text, stores `body_state: 'metadata'`, and deletes/reinserts message rows: lines 764–796 and 853–877.
- MCP `readEmailMessages` selects only the ciphertext, never selects `body_state`, decrypts it, and reports truncation solely from string length: [mcp-mail.ts](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/f3fa6b493ecd757e48ff69eb4015352e7b1d142b/apps/tap-email-coordinator/src/mcp-mail.ts#L774), lines 774–815.
- The UI's `threadSnapshot` already handles metadata hydration and explicit oversized-body failure: [mailbox.ts](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/f3fa6b493ecd757e48ff69eb4015352e7b1d142b/apps/tap-email-coordinator/src/mailbox.ts#L1856), lines 1856–1949.

**Local reproduction:** Seed the existing MCP fixture, set the thread/message content state to metadata, replace its ciphertext with an encrypted empty string, and call the real `read_email_messages` handler. It succeeds with `bodyText: ""`, `bodyTextTruncated: false`, `coverage.resultTruncated: false`, and fallback `unavailable`. Exact coverage is still conservatively `partial`, but neither the message nor the warning identifies this specific unhydrated body. This makes a missing body look like an empty email and creates a successful read audit/view.

**Fix direction:** Centralize exact-message retrieval behind a body-state-aware service used by UI and MCP. Hydrate by exact profile/account/thread/message scope when allowed; otherwise return explicit metadata-only/unavailable status rather than successful empty content. Preserve genuine empty bodies as a distinct ready state. Include body state and read revision in evidence/citations.

### B02 — MCP cannot enumerate the middle/recent messages of long conversations (P1)

`getEmailThread` orders message metadata by ascending ordinal and returns the first 50: [mcp-mail.ts](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/f3fa6b493ecd757e48ff69eb4015352e7b1d142b/apps/tap-email-coordinator/src/mcp-mail.ts#L705), lines 705–742. It marks truncation but provides no next cursor. Its schema accepts only account and thread: [mcp.ts](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/f3fa6b493ecd757e48ff69eb4015352e7b1d142b/apps/tap-email-coordinator/src/mcp.ts#L296), lines 296–324.

**Local reproduction:** A 55-message thread returns the oldest 50 metadata rows and `nextCursor: null`. `thread.latestMessageRef` exposes message 54, so a caller can separately read the very latest message, but message IDs 50–53 remain undiscoverable through these tools. A summary/commitment extractor cannot prove it incorporated intervening deadline changes.

**Fix direction:** Add revision-bound keyset pagination to thread metadata, defaulting to the newest page, and explicit older/newer continuation. Reuse conversation paging semantics where possible. Update protocol, MCP input schemas, manifest artifact inventory, tests, and specialist instructions together.

### B03 — Reminder creation is not replay-safe across the effect/receipt crash window (P2)

Reminder creation cancels any active reminder and issues a plain `INSERT` with a unique reminder key: [mailbox.ts](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/f3fa6b493ecd757e48ff69eb4015352e7b1d142b/apps/tap-email-coordinator/src/mailbox.ts#L2166), lines 2166–2187. Queue processing executes that mutation and only afterward writes the command outcome: [index.ts](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/f3fa6b493ecd757e48ff69eb4015352e7b1d142b/apps/tap-email-coordinator/src/index.ts#L1399), lines 1399–1409. An interruption between those steps leaves a replayable command whose effect already exists.

**Local reproduction:** Call `executeTapOwnedCommand` twice with the exact same future `create_reminder` command. First returns acknowledged; second throws a D1 `UNIQUE constraint failed` error. The queue maps an unclassified exception to retryable transport error, so receipt recovery can fail even while the reminder exists. This does not mean an ordinary replay of a terminal command is broken: terminal commands are skipped at lines 1330–1332. The defect is the effect-committed/receipt-uncommitted window.

**Fix direction:** Make the reminder effect idempotent and identity-aware, acknowledging an existing matching intent and rejecting changed intent. Do not let an old replay cancel a newer reminder or revive a cancelled/satisfied reminder. Prefer a transaction that binds the TAP-owned effect and durable command settlement when feasible.

### B04 — MCP coverage language still describes the previous inbox-only ingestion model (P2)

[MCP coverage warnings](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/f3fa6b493ecd757e48ff69eb4015352e7b1d142b/apps/tap-email-coordinator/src/mcp-mail.ts#L239), lines 239–246, say only synchronized inbox history is covered. `broadReplicaCanCover` remains true only for `inInbox === true` at line 629. Current ingestion requests all account threads including Spam and Trash (`mailbox.ts:1037–1043`). The conservative partial result avoids false completeness, but the contract now understates metadata coverage and does not explain the much more relevant metadata-versus-body distinction.

**Fix direction:** Replace inferred coverage from folder filters with explicit ingestion scope/version, provider traversal completion, last applied revision, per-message body state, missing/oversized counts, and date horizon. Invalidate or mark old coverage epochs when migrating from narrower ingestion. A completed metadata traversal must never establish content completeness.

### B05 — Production readiness proves configuration and DB reachability, not the new tool chain (verification gap)

Read-only checks at **2026-09-27 13:22 UTC**:

- `GET https://tap-email-coordinator.theaiplatform.app/ready` returned HTTP 200 and `{ "ok": true, "checks": { "configuration": true, "database": true } }`.
- `GET https://tap-email-coordinator.theaiplatform.app/mcp` without credentials returned HTTP 401 `mcp_credential_required`.

These show a running coordinator and the intended authentication challenge. Readiness only performs `SELECT 1` for the database ([readiness.ts](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/f3fa6b493ecd757e48ff69eb4015352e7b1d142b/apps/tap-email-coordinator/src/readiness.ts#L82), lines 82–89). It does not verify migration 0016/0018, the configured service binding's successful behavior, SDK tool inventory, installed grants, credential issuance, mailbox scope, or provider receipt completion. Source ADR 0005 explicitly leaves deployment/installation/Chloe policy changes outside repository changes.

**Fix direction:** Add version/schema capability attestation and a non-destructive authenticated read smoke test through the installed host. Exercise save/send only against a designated test mailbox with explicit test authorization. Do not label the entire chain verified from `/ready`.

## Per-item implementation plan

### 1. Reliable retrieval for specialists, summaries, and commitments

**Deliverable:** One account-scoped read service shared by UI, live MCP, and AI tasks; explicit body states; bounded hydration; revision-bound conversation pagination; structured citations.

**Sequence:** Fix B01 before expanding specialist usage. Implement B02 in the same protocol revision. Add an explicit hydrate/unavailable result contract and propagate it into prompts and UI. Update all signed schemas and package tests.

**Acceptance:** Never-opened historical mail yields its actual body or an explicit unavailable state; genuine empty mail stays distinguishable; 120-message threads can be fully enumerated with no gaps/duplicates; a changed thread invalidates its cursor; wrong-profile/account/message combinations fail; oversized content identifies the omitted body; the latest deadline change is retrieved even when it occurs after message 50. Test MCP and UI against the same fixture service, not separate happy-path fixtures.

**Dependencies:** Coordinator/protocol/package change; provider quota and timeout budget; no new model required.

### 2. Honest indexing and synchronized corpus coverage

**Deliverable:** Persisted metadata and body ingestion coverage with an explicit source revision. Preserve body promotion and searchable previews across metadata refreshes. Make retrieval explain which accounts, folders, dates, and content types were actually searched.

**Sequence:** Repair B04 alongside the parent's lost-search-preview bug. Establish body coverage before adding provider fallback or whole-mailbox generation. Measure full traversal cost and freshness for realistic mailbox sizes and account counts.

**Acceptance:** Completing metadata backfill cannot claim full body coverage; metadata refresh cannot erase a richer same-revision preview/body; deleted mail is excluded after a completed authoritative replay; interrupted traversal never prunes unseen mail; backfill and ongoing history updates preserve revision order; coverage fixtures include Sent, Archive, Drafts, Spam, Trash, attachment-only mail, and oversized MIME.

**Dependencies:** Item 1's read contract, device persistence, ingestion schema, shared search/workflow coverage model. Keep text/semantic evaluation in the parent's search plan.

### 3. Useful specialist tool access and setup

**Deliverable:** A user can connect Email tools once, discover an account, read evidence, save the requested draft, and see an authoritative result. Settings exposes effective availability by tool and consumer.

**Sequence:** Retain current scoped token and sender pipeline. Add an installed-host smoke path for account listing, search, and exact read; report missing permission, expired credential, coordinator failure, or unsupported host separately. If product requires read-only or draft-only agents, split write permissions and support selected-account grants instead of treating one profile-wide write scope as the final model.

**Acceptance:** Read-only consumer cannot draft/send; token cannot call platform REST or mint credentials; wrong account/profile fails; rotated/expired token fails clearly; intended sender workspace is displayed; direct send preserves exact requested recipient/content and reuses its idempotency identity; repeated invocation has one provider effect; uncertain delivery never causes a fresh send. A real installed-host read smoke is required before describing this as live end-to-end.

**Dependencies:** Item 1, SDK host version and consumer grants, deploy/install release ownership. Existing fixtures already cover many authorization and idempotency cases; extend their integration coverage.

### 4. Durable reminders and follow-up workflows

**Deliverable:** Timed follow-ups remain correct through crashes, later replies, rescheduling, and explicit cancellation; a follow-up workflow can use those facts to prepare a reviewed provider draft.

**Sequence:** Fix B03 first. Preserve the stronger send-linked implementation. Add an obligation record only when semantic owner/deadline/status extraction is introduced; link it to source messages and reminder IDs rather than overloading the reminder timer as a semantic commitment. Add missing MCP reminder/schedule operations only when the concrete workflow needs them, routed through the same command pipeline.

**Acceptance:** Crash after reminder insert but before receipt settlement recovers applied once; late replay cannot cancel a newer reminder; replay cannot resurrect cancellation; provider reply before/after send reconciliation satisfies only `if_no_reply`; `regardless` remains pending/due; uncertain send creates no follow-up until delivery identity is known; due reminders remain visible independent of Inbox status; conditional scheduled send checks fresh provider state before execution.

**Dependencies:** B03, item 1 evidence, parent's obligation/workflow plans. Existing send-linked follow-up tests already cover basic delivery replay and uncertain-send timestamp reconciliation.

### 5. Activity a morning brief can trust while Email is closed

**Deliverable:** Either retain and clearly expose installation-local, last-reconciled activity or add a background/coordinator activity aggregation source with durable cursors and deduplicated event identities.

**Sequence:** First make freshness/coverage visible to the brief result. For an actual scheduled briefing, move authoritative receipt collection off the foreground Email surface; keep human conversation views explicitly local if they cannot be centrally observed. Define workspace semantics before presenting workspace totals.

**Acceptance:** A scheduled send performed while Email is closed appears once in the next briefing without requiring the app to open; duplicate receipt/view ingestion is idempotent; uncertain-to-applied transitions refine one event; autosaves count one draft; unavailable history is not zero; retention/truncation narrows coverage; two devices cannot double-count the same provider action.

**Dependencies:** Background workflow/scheduler capability or coordinator query source, host activity contract, identity/deduplication model. Do not infer cross-device totals from the existing projection.

### 6. Preserve the new persistence architecture while integrating AI

**Deliverable:** AI/search/workflows query a bounded disk-backed repository and request explicit materialized evidence instead of treating the visible `MailState.threads` window as the full mailbox.

**Sequence:** Keep the independent journal, additive migrations, transactional page/cursor commits, body budgets, and foreground read priority. Integrate richer-read promotion, deletion, coverage and AI checkpoints into those existing boundaries. Avoid rollback to a snapshot-only reader after journal migration.

**Acceptance:** Existing 26 MB mailbox, SQLite/host limit, migration restart, cache-failure/journal recovery, cancellation, and generation-fencing tests remain green; new AI work cannot starve command journal writes or foreground navigation; a report over 350 stored threads includes all 350 or reports an explicit subset; historical evidence remains retrievable after cache eviction/refetch; account/device wipe removes stored metadata, bodies, derived indexes, and pending AI state according to the same scope.

**Dependencies:** Parent's workflow and search plans; item 1 hydration semantics. This is integration hardening, not a justification for rewriting persistence.

### 7. Release evidence and production operability

**Deliverable:** Each release identifies package/SDK/coordinator/schema versions and records the exact validated tool path, coverage, and command outcomes.

**Sequence:** Add schema/capability checks for B05, then run installed-host read validation and designated test-mailbox draft/send validation. Add bounded metrics for sync lag, hydration failure, queue delay/retry/dead letter, command uncertainty, duplicate-effect attempts, and missing tool grants. Load-test actual queue/provider behavior before publishing freshness or scale targets.

**Acceptance:** Missing required migration prevents ready status; smoke test detects a registered tool with missing grant/credential; command queues can recover from dispatch failure and stale leases; provider throttling preserves cursor and evidence; no content or credential tokens enter diagnostic logs; readiness reports deployed version without revealing secrets. Production send verification is a separate authorized test action, not an assumption from unit tests.

**Dependencies:** Release pipeline, owned test mailbox, SDK installation/grants, infrastructure observability. Current structured logs, durable events, queues, and DLQ declarations are useful foundations.

## Validation and limitations

Three temporary focused tests were run with the existing Cloudflare Vitest/D1 harness: metadata-only MCP body read, 55-message MCP metadata discovery, and exact reminder-effect replay. All three passed their defect-confirmation assertions. The temporary test file was removed; application and test code are unchanged by this review. The parent review runs the normal package suites and reports their results separately.

Production checks were unauthenticated, read-only `/ready` and `/mcp` requests. No token was minted, account connected, mail read, provider draft saved, message sent, or live infrastructure changed.

Cloudflare review used the current [Workers best-practices documentation](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/) and fetched current Workers types (`5.20260927.1`) into `/tmp`; no workspace dependencies were installed or updated. Findings above rely principally on repository source and local reproduction, not assumptions about Cloudflare limits.
