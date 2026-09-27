# TAP Email: current implementation, defects, and competitive direction

Reviewed **2026-09-27**, after fetching `origin/main` and fast-forwarding this checkout from `f1ca953` to **`f3fa6b493ecd757e48ff69eb4015352e7b1d142b`**. Email is **0.3.5**, pinned to Miniapp SDK **0.19.0**. The September 20 reports remain historical; several of their central limitations have since been addressed. This pass changes documentation only.

**Historical baseline:** the findings below describe that inspected commit. The subsequent [0.3.6 release note](../apps/tap-email/docs/releases/0.3.6.md) distinguishes implemented fixes from remaining roadmap work.

**There is substantially more real implementation now. The main remaining problem is that data completeness, AI evidence, and completed workflow outcomes do not yet line up.** Shipping more assistant names or workflow cards would amplify those gaps. The next release should make one complete email-to-work loop dependable and measurable.

The detailed deliverable is the [32-item implementation plan](../docs/plans/tap-email-capability-plan-2026-09-27.md), with a disposition for all **60 Superhuman claims**. Supporting audits: [current Superhuman advertising and help](./superhuman-advertised-capabilities-2026-09-27.md), [SDK/host delta](./tap-email-sdk-delta-2026-09-27.md), and [coordinator/backend review](./tap-email-backend-reality-2026-09-27.md).

## What actually exists now

Here, **implemented** means a reachable source path supported by local checks. It does not certify the installed production package, connected host permissions, private mailbox coverage, or real-model quality.

| Area | Current implementation | Remaining limit |
| --- | --- | --- |
| Inline Write with AI | Real `inference.send`, model discovery, permission checks, bounded input/output, review/apply/discard and stale-draft protection. | Receives only instructions, subject and draft body. It does not retrieve thread evidence, attachments, recipients, task outcomes or a learned voice. [Writer service](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/f3fa6b493ecd757e48ff69eb4015352e7b1d142b/apps/tap-email/src/composer-services.ts#L57). |
| Summarize / Why important / Extract commitments | Explicit Chat prompt handoff with up to four locally available messages, 12,000 characters. | These particular actions still do not execute or deliver typed, cited results inside Email. [Prompt builder](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/f3fa6b493ecd757e48ff69eb4015352e7b1d142b/apps/tap-email/src/chloe-email.ts#L39). |
| Email specialist / MCP | Registered live coordinator tools for account listing, search, thread metadata, message reads, draft saving, sending and receipts. Scoped, expiring credential; normal durable write pipeline. | Authenticated installed-host execution remains unverified. Retrieval has body and pagination defects. The Email surface has no production inline specialist call. Local zvec search and remote MCP search are different implementations. [Backend audit](./tap-email-backend-reality-2026-09-27.md). |
| Attention and priorities | Provider state, sender direction, reminders, regex risk labels, explicit corrections and explanations. | These remain deterministic signals, not semantic obligation extraction or calibrated model confidence. [Attention](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/f3fa6b493ecd757e48ff69eb4015352e7b1d142b/apps/tap-email/src/thread-intelligence.ts#L67). |
| Workflow Center | Six saved-workflow launchers, payload construction, polling and progress state. | Definitions must already exist elsewhere; no shipped recipes or result viewer. Permission is wrong and input is now bounded by the visible window. [Workflows](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/f3fa6b493ecd757e48ff69eb4015352e7b1d142b/apps/tap-email/src/email-workflows.ts), [UI](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/f3fa6b493ecd757e48ff69eb4015352e7b1d142b/apps/tap-email/src/workflow-center.tsx#L110). |
| Mail Merge | Bounded template expansion, digest-bound review, sequential provider draft commands and receipts. | A real deterministic operation, not an AI campaign engine. Recovery and opening generated provider drafts still need an end-to-end acceptance path. |
| Text search | Pages the durable local replica and applies the existing query parser/matcher. | No ranked lexical index; scans records and matches substrings of available previews. Body/history coverage remains partial. [Disk query](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/f3fa6b493ecd757e48ff69eb4015352e7b1d142b/apps/tap-email/src/bounded-mail-replica.ts#L317), [matcher](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/f3fa6b493ecd757e48ff69eb4015352e7b1d142b/apps/tap-email/src/mail-search.ts#L446). |
| Meaning search | Local model, persistent zvec/HNSW collection, changed-document upserts and exact/semantic rank fusion. Reads disk pages across the selected account. | One vector per thread; query-time corpus scan; top-100 postfiltering; incomplete body evidence; deletion has no production caller. [Index](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/f3fa6b493ecd757e48ff69eb4015352e7b1d142b/apps/tap-email/src/semantic-email-index.ts), [integration](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/f3fa6b493ecd757e48ff69eb4015352e7b1d142b/apps/tap-email/src/app.tsx#L1288). |
| Local persistence | Incremental bounded SQLite replica, independent command journal, transactional page/cursor commits, deletion/generation handling, migrations, memory/disk body budgets and progressive navigation. | This is a substantial improvement. AI consumers must query that repository rather than mistake its 100-thread UI window for the mailbox. [Persistence design](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/f3fa6b493ecd757e48ff69eb4015352e7b1d142b/apps/tap-email/docs/device-persistence.md). |
| Follow-ups / scheduling | Real provider-aware send-linked reminders, reply satisfaction, due-state cron, schedules, uncertainty handling and conditional-send provider checks. | A timer is not a maintained semantic commitment. Manual reminder effect replay has a crash-window defect. |
| Email → task / conversation | Receipt-backed canonical task creation and explicit conversation handoff. | No maintained obligation/task/outcome/reply relationship. SDK 0.19 can improve this materially. [Task creation](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/f3fa6b493ecd757e48ff69eb4015352e7b1d142b/apps/tap-email/src/email-task.ts). |
| Share draft / Calendar | Idempotent draft snapshot sharing; current, revision-validated published TAP Calendar booking-link insertion. | Snapshot sharing is not live collaboration. Booking links are not the full event/free-busy/team-scheduling product. [Composer service](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/f3fa6b493ecd757e48ff69eb4015352e7b1d142b/apps/tap-email/src/composer-services.ts), [Calendar client](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/f3fa6b493ecd757e48ff69eb4015352e7b1d142b/apps/tap-email/src/booking-links.ts). |
| Activity | Actual SDK activity-source registration with scoped committed-action aggregates. | Installation-local, bounded retention and refreshed while Email is open; not complete background/cross-device activity or measured time saved. |

## Findings in priority order

### F01 — P1: a whole-mailbox workflow can report one UI page as complete

`WorkflowCenter` receives `state` from [app.tsx:3326](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/f3fa6b493ecd757e48ff69eb4015352e7b1d142b/apps/tap-email/src/app.tsx#L3326). The UI is deliberately bounded to about 100 threads, but [createMailboxRollupPayload:326](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/f3fa6b493ecd757e48ff69eb4015352e7b1d142b/apps/tap-email/src/email-workflows.ts#L326) counts only `state.threads`. Its coverage receipt checks account/time coverage independently of this omitted data; `resultTruncated` only notices more than 250 matches in the already-small input.

**Reproduced with the real SQLite store:** persist 350 matching Inbox threads with current coverage, load the normal bounded state, then build the rollup. Result: `diskInbox=350`, `loaded=100`, `reported=100`, `complete=true`, `truncated=false`. This is a correctness defect, not an LLM quality problem.

Use a paginated repository query with explicit snapshot/coverage and independently computed counts. Separate current queue, message-time-window and action-event reports. The existing latest-thread-time filter also omits yesterday's messages when a thread gets a newer reply today. **Plan: EP03, EP12–EP16.**

### F02 — P1: exact MCP reads can return absent content as an empty successful message

Historical ingestion now saves metadata-only messages. [readEmailMessages](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/f3fa6b493ecd757e48ff69eb4015352e7b1d142b/apps/tap-email-coordinator/src/mcp-mail.ts#L774) does not inspect `body_state` or reuse the UI's hydration path. A focused handler test returns `bodyText: ""`, no body truncation and no specific missing-body explanation for a metadata-only record. Overall coverage remains conservatively partial; the exact message still looks successfully read.

Also, [getEmailThread](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/f3fa6b493ecd757e48ff69eb4015352e7b1d142b/apps/tap-email-coordinator/src/mcp-mail.ts#L705) returns the oldest 50 message references with no continuation. In a 55-message probe, the latest-message reference exposes message 54, but messages 50–53 cannot be discovered through the normal tools. Later deadline changes can be missed. **Plan: EP02; reproduction details in [B01/B02](./tap-email-backend-reality-2026-09-27.md).**

### F03 — P1: metadata refresh can erase a searchable body preview

[writeReplicaThreads](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/f3fa6b493ecd757e48ff69eb4015352e7b1d142b/apps/tap-email/src/bounded-mail-replica.ts#L167) lets incoming metadata replace the previous message record, including its searchable preview. It can retain the separate full-body cache at the same provider revision while replacing the preview with empty text.

**Reproduced:** save a body containing `saffron contract`; text query returns one result. Apply metadata-only refresh at the same revision; query returns zero. Hydrated `loadThread` still returns `saffron contract`. Preserve monotonic enrichment at a revision and update corpus/search coverage transactionally. **Plan: EP03–EP05.**

### F04 — P1: Operational Zero still permits an overdue reminder

The new disk summary correctly counts the whole replica but [its final zero predicate](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/f3fa6b493ecd757e48ff69eb4015352e7b1d142b/apps/tap-email/src/bounded-mail-replica.ts#L518) checks only coverage, critical, needs-response and failed commands. It omits `dueReminders`.

**Reproduced against the real store:** `dueReminders=1`, `operationalZero=true`. An unexpired wait can be non-actionable; an overdue reminder cannot support an all-clear claim. Define the due-action set once and use it across disk summary, UI, workflows and MCP. **Plan: EP09, EP21.**

### F05 — P1: workflow authorization and output delivery remain incomplete

The manifest still declares `workflows.runs.read`; SDK/host `tap.workflows.get-run` requires **`workflows.read`**. SDK polling swallows failed ticks, so launch can remain Accepted/Running without visible observation failure. Separately, [WorkflowRunStatus](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/f3fa6b493ecd757e48ff69eb4015352e7b1d142b/apps/tap-email/src/workflow-center.tsx#L110) renders phase/message/run ID, not the collected `run.result`.

Fix permission bindings, observation health, durable run identity, versioned recipe compatibility and typed visible results together. An externally saved workflow with the same display name is not proof of the right implementation. **Plan: EP01, EP12.**

### F06 — P1: declared host minimum admits an incompatible MCP installation

Email declares host **>=2.24.0**. Host **2.24.1** fixes 2.24.0 rejecting Email's header-credential remote MCP declaration. Raise the minimum and test the signed package on that host. SDK 0.19 itself is already current. The fix's manual installation check explicitly did not bind a credential or exercise authenticated Email tools. **Plan: EP01, EP11; [versioned host evidence](./tap-email-sdk-delta-2026-09-27.md).**

### F07 — P1: Reply chooses a participant rather than resolving message headers

[beginReply](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/f3fa6b493ecd757e48ff69eb4015352e7b1d142b/apps/tap-email/src/app.tsx#L2130) addresses `target.participants[0]` and initializes empty Cc/Bcc, while using the last loaded message's Internet Message ID. Participant order is not the canonical sender/Reply-To contract. Multi-party threads need explicit Reply, Reply All and Forward semantics, alias/self exclusion and a specific source message. AI drafting cannot make this recipient path trustworthy on its own. **Plan: EP22.**

### F08 — P2: exact and semantic filters produce misleading omissions

[The `from:` operator](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/f3fa6b493ecd757e48ff69eb4015352e7b1d142b/apps/tap-email/src/mail-search.ts#L417) includes all participants, including recipients. Semantic retrieval takes 100 neighbors before applying most constraints, losing valid matches below that cutoff. Its result identity contains query text but not account scope; changing accounts with the same query can retain the old restricted result set and suppress the ordinary disk query. This is an omission/stale-result defect, not evidence of cross-account disclosure.

Push supported filters before top-k; page or bound remaining candidates explicitly. Key/cancel results by account, resource, normalized query and corpus/index generation. **Plan: EP04, EP05.**

### F09 — P2: index maintenance is still coupled to the user's search

Every Meaning request pages the chosen corpus and checks/upserts threads. Content is capped at 24 KiB per thread; flags/labels/provider revisions can trigger re-embedding without meaningful content change. `deleteThreads` has no production caller. Persisted vectors therefore do not constitute a maintained, complete search corpus.

Use message/chunk identities, independent content/metadata versions, a durable maintenance queue, tombstones and model/index generations. Preserve the new bounded replica rather than rewriting it. **Plan: EP03–EP06.**

### F10 — P2: reminder effect replay is not safe after an interrupted receipt write

The command worker applies [the reminder mutation](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/f3fa6b493ecd757e48ff69eb4015352e7b1d142b/apps/tap-email-coordinator/src/mailbox.ts#L2166) before separately settling the receipt. Repeating the exact effect after the first commit throws a unique-key error. Normal replay of an already-terminal receipt is correctly skipped; the defect is the crash window between effect and receipt.

Make replay identity-aware and ensure an old replay cannot cancel a newer reminder or resurrect a cancelled one. Prefer atomic effect/settlement when possible. Send-linked follow-up creation already has stronger idempotency. **Plan: EP21; [B03 reproduction](./tap-email-backend-reality-2026-09-27.md).**

## SDK update: use what exists, account for what does not

The registry's latest published version is **0.19.0**; the app already pins it. Compared with the prior 0.16 baseline, 0.17 added the activity-source contract, and 0.19 added `expectedContext` fences for queued HTTP plus richer Tasks phases, comments, extensions and outcome observations. There was no published 0.18 release in the registry checked. [Registry and artifact audit](./tap-email-sdk-delta-2026-09-27.md).

The immediate Tasks improvement is to include priority and due date in `createWithReceipt`, now supported atomically, instead of issuing a second update that a replay can apply over later human changes. Longer term, task phase visits and package-owned metadata can support an obligation that stays linked to real work. Additional read/comment/extension/impact permissions must be explicitly bound.

Direct inference still returns text: application validation and evidence checking remain necessary. Specialist turns are available but not invoked inside Email. Saved-workflow observation exists; recipe creation and recurring scheduling are not public installed SDK operations. Activity registration is not a scheduler.

**Do not plan SQLite FTS5 as an available shortcut.** The current host explicitly denies virtual-table creation and does not permit `bm25`. zvec exposes dense retrieval plus scalar filters/FTS clauses, not a standalone sparse/BM25 service. Choose an app-owned lexical index over ordinary tables/files or obtain a deliberate bounded host API. [Host constraints](./tap-email-sdk-delta-2026-09-27.md).

## What would actually be competitive

Superhuman already documents summaries, contextual writing, auto drafts, labels, attachment answers, collaboration, scheduling and MCP-assisted workflows. Its MCP can query send status; its skill library includes morning briefings, EOD and batch drafting. Those names and basic receipts are not a distinguishing proposition. [Official MCP documentation](https://help.superhuman.com/hc/en-us/articles/46005696690317-Superhuman-Mail-MCP-Server). The [claims ledger](./superhuman-advertised-capabilities-2026-09-27.md) distinguishes documented behavior, advertising, tier/client limits, ambiguous CRM documentation, and the separate Go product.

**Bet on maintained follow-through:** identify what was promised, cite the email, link the actual TAP task and discussion, notice later changes, prepare a reply from the completed work, then settle the obligation using the actual send result. Example: a customer changes a security answer deadline from Friday to Monday; TAP updates the same reviewed obligation/task, incorporates the approved answer from the discussion, and drafts the right response. A completed task alone must not imply the customer was answered.

There is also a concrete existing UX opportunity: Superhuman says it **does not have a unified inbox**. Preserve TAP's directly unified multi-account experience while making account-specific queries and sender identity reliable. [Superhuman's documented workaround](https://help.superhuman.com/hc/en-us/articles/46005722297229-Unified-Inbox-Workaround).

The differentiator is a hypothesis until the full loop beats the user's current workflow. Measure missed obligations, factual corrections, verified completion, duplicate effects and preparation time. Do not reproduce vendor time-saved marketing without a comparable study. Use one evidence pipeline and one executor first; add specialists only when a test demonstrates a quality, cost, or authority-boundary benefit.

## Delivery order

1. **Repair trust:** host floor/permissions, exact message retrieval and paging, preview preservation, complete report inputs, due-reminder zero semantics, correct recipient resolution and replay-safe effects.
2. **Make evidence usable:** lexical/semantic corpus lifecycle, citations, inline summary/Ask/reply, and measured retrieval quality.
3. **Complete one work loop:** reviewed obligations → canonical task/conversation → changed evidence → reviewed follow-up provider draft → authoritative outcome.
4. **Expand reusable workflows:** ship each recipe with visible output and resumability; introduce recurrence only with a real background execution owner.
5. **Finish targeted client parity:** snippets, editor/forwarding, Calendar, live collaboration and saved rules. Defer tracking, CRM breadth and independent mobile clients until demand justifies them.

The [implementation plan](../docs/plans/tap-email-capability-plan-2026-09-27.md) turns this order into specific file boundaries, dependencies and acceptance gates for every item.

## Verification and its limits

- Frozen-lockfile installation succeeded without a lockfile change.
- **708 existing tests passed:** Email 495, coordinator 202, protocol 11. All three package typechecks, Email TAP typecheck and SDK 0.19 manifest validation passed. Unlike the September 20 run, this coordinator log did not contain the earlier teardown error.
- Three additional SQLite probes reproduced F01, F03 and F04 using the real bundled store/workflow functions. Three temporary Cloudflare/D1 tests reproduced historical MCP empty-body reads, long-thread gaps and reminder replay failure. The temporary backend test was removed; no implementation/test files were changed.
- SDK published artifacts, official docs and a separately available current host checkout were inspected. Superhuman research used current first-party pages, not a hands-on paid-account comparison.
- Unauthenticated production `/ready` returned 200 and `/mcp` returned credential-required 401. Readiness performs a database connectivity check; it does not attest migrations, installed host grants or authenticated provider actions.
- No private mail was read, model generation benchmark run, credential minted, draft sent, deployment made or production setting changed. Local tests with mocked embeddings/platform methods do not establish model relevance or installed-host integration.

The evidence supports a concrete engineering plan, not a claim that the complete AI product is production-verified.
