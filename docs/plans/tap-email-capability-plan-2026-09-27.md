# TAP Email capability plan — 2026-09-27

Baseline: main **f3fa6b4**, Email **0.3.5**, Miniapp SDK **0.19.0**. This is an implementation plan, not a statement that the proposed features exist. No application behavior was changed during the review.

Subsequent implementation: [Email 0.3.6 release scope](../../apps/tap-email/docs/releases/0.3.6.md) records the focused fixes now implemented. The [Email 0.3.7 release scope](../../apps/tap-email/docs/releases/0.3.7.md) adds history recovery, durable semantic maintenance and verified tool-access setup. EP03, EP05 and EP11 remain partially implemented; their broader acceptance criteria and the full first delivery gate are not complete.

Read the [implementation review](../../research/tap-email-deep-review-2026-09-27.md), [SDK/host audit](../../research/tap-email-sdk-delta-2026-09-27.md), [backend audit](../../research/tap-email-backend-reality-2026-09-27.md) and [60-item Superhuman ledger](../../research/superhuman-advertised-capabilities-2026-09-27.md) for evidence. Superhuman feature IDs **SH01–SH60** below refer to that source-backed ledger. They cover Mail, with separate rows for Go and Email Assistant; advertised does not mean independently benchmarked.

## Product decision

Make **“TAP keeps the work attached to an email correct as the conversation changes”** the first proposition to validate. Preserve the direct unified inbox. Deliver grounded answers, useful reviewed drafts and a maintained obligation/task/conversation relationship. Measure completion and correction cost. Do not build separate agents for every button or duplicate Calendar, Tasks, identity, administration and knowledge management inside Email.

The first vertical slice is: **prepare the follow-ups I owe today**. It finds due obligations across selected accounts, reads the latest evidence, checks related work and existing drafts, proposes separate replies, saves accepted provider drafts and displays their receipts. Sending remains the existing explicitly invoked action. Scheduled execution comes after this slice works and a background owner is chosen.

Priorities: **P0** fixes incorrect or misleading behavior before expanding AI; **P1** delivers the core product; **P2** expands proven capabilities; **defer** is a deliberate scope decision with a revisit trigger. Owners name the responsible component/team, not an assigned person. Estimates await the first host/corpus integration spike; feature counts are not staffing estimates.

## Shared implementation contracts

Use a small common domain boundary, implemented with the existing protocol package and bounded storage:

- **MailEvidenceRef:** account, thread, message, source revision, body/extraction state, text/page offsets, source timestamp and retrieval timestamp. Source excerpts are data, not tool instructions.
- **CorpusCoverage:** provider traversal/scope, metadata horizon, body/extraction coverage, index watermark, known omissions and freshness. A complete metadata sync cannot establish complete body or attachment search.
- **AIProposal:** requested operation, evidence refs, parsed/validated output, account/workspace/draft revision, model/version/usage, uncertainty and expiry. Applying a proposal rechecks its scope and current revision.
- **Obligation:** evidence refs, owner, action, deadline/timezone with uncertainty, status, corrections, canonical task/conversation links and delivery evidence. New evidence revises the same record; it does not automatically create another task.
- **WorkflowResult:** versioned recipe/input/output contracts, durable run/step IDs, per-item evidence/status/receipts, coverage and partial failures. “Accepted,” “draft saved,” “sent” and “completed” are separate states.

These are proposed contracts, not existing types. Keep raw email content out of aggregate activity and diagnostic logs. The coordinator remains the provider mutation authority; local indexes remain derived, replaceable data. Every new AI feature consumes the same evidence/coverage contracts.

## Implementation cards

### EP01 — Supported release and permission contract

**P0 · Email packaging + host/release owner.** Current SDK is latest; host floor and workflow permission are wrong.

Change `manifest.tap.json` minimum host to **2.24.1**, replace all `workflows.runs.read` declarations with the actual `workflows.read` contract, reconcile stale SDK 0.15 catalog/error copy, and add deployed package/coordinator/schema capability attestation. Validate the signed built package, not only source JSON. Ready status should reject missing required migrations rather than pass on `SELECT 1` alone.

**Done when:** unsupported host rejects early; supported host installs; governed `getRun` succeeds and denied/revoked grants are visible; an authenticated read reaches the intended coordinator; version/schema mismatch is actionable. Use a designated test mailbox for later draft/send checks. **Dependencies:** no SDK bump; live release evidence depends on EP11. **First PR:** compatibility/copy/permission correction; second PR adds capability attestation.

### EP02 — One exact-message retrieval service

**P0 · Coordinator + protocol.** Historical MCP reads ignore body state; long-thread metadata is capped at the oldest 50 without a cursor.

Extract the body-state-aware UI retrieval logic from `mailbox.ts` into a shared account-scoped service used by REST and `mcp-mail.ts`. Return ready/metadata-only/unavailable/oversized distinctly. Hydrate exact requested messages within quota/byte/time budgets. Add revision-bound keyset pagination to thread message metadata, newest-first by default; update MCP schemas, signed manifest inventory and specialist instructions together.

**Done when:** unopened history yields actual content or an explicit missing-content result; genuinely empty email is distinguishable; a 120-message conversation is fully enumerable without duplicates/gaps; deadline changes after message 50 are found; wrong account/profile is rejected; mid-page revision changes invalidate continuation. **Dependencies:** existing provider adapter, no AI dependency. **PRs:** shared reads/body states, then protocol pagination and consumer migration.

### EP03 — Corpus, enrichment and coverage

**P0 · Email storage + coordinator.** Bounded persistence is implemented; same-revision metadata can erase previews and metadata coverage is confused with usable evidence.

In `bounded-mail-replica.ts` preserve richer content at the same revision; replace it only with a newer authoritative body or tombstone. Add separate durable watermarks for metadata, hydrated bodies, extracted attachments and derived indexes. Make report inputs page the repository rather than `MailState.threads`. Update old inbox-only MCP coverage copy to the actual traversal scope. Default background hydration to recent/active obligations and offer explicit deeper history indexing with visible progress and resource limits.

**Done when:** the `saffron contract` preview survives metadata refresh; 350 stored matches produce 350 counts or explicit partial scope; body eviction narrows content coverage; interrupted backfill never prunes unseen records; deletes/wipes remove derived state. Existing journal/migration/host-limit tests remain green. **Dependencies:** EP02. **PRs:** enrichment repair; coverage schema/migration; repository evidence queries.

### EP04 — Correct, ranked lexical search

**P0 correctness; P1 ranking · Email search/storage.** Current disk search scans pages and applies substring matching; `from:` also searches recipients.

First separate From/To/Cc headers and correct account/date/resource semantics, pagination and no-result copy. Implement a bounded app-owned lexical index using ordinary SQLite tables/postings or a persisted library over the canonical corpus. **Do not assume FTS5:** the host denies virtual tables and `bm25`. Run a small supported-index spike before selecting the storage format. Support exact phrases, tokens, exclusion and documented boolean behavior; keep provider fallback explicit and merge/deduplicate its results with local evidence.

**Done when:** recipient-only Bob does not match `from:bob`; never-opened body matches are found after declared ingestion; old-history searches page correctly; restrictive filters and account switching remain correct; offline misses explain coverage; delete/rebuild succeeds within declared device budgets. **Dependencies:** EP03; a new host FTS API is optional, not on the critical path. **PRs:** correctness, index spike, incremental index/provider fallback.

### EP05 — Maintained semantic and hybrid retrieval

**P1 · Email search/indexing.** Existing zvec/model binding and rank fusion are useful foundations.

Move maintenance out of every search into a durable queue keyed by message/chunk revision. Separate embedding content hashes from labels/read/star metadata. Store account/date/header/resource filters with chunks and apply them before top-k where supported; otherwise use explicit bounded candidate expansion. Include account/resource/query/corpus/index generation in query identity and cancellation. Wire tombstones into `deleteThreads`/replacement chunk deletion; maintain a generation registry and bounded cleanup strategy with available SDK APIs. Fuse independent lexical and semantic ranks, then validate answer-bearing evidence.

**Done when:** a valid filtered result below old rank 100 is retrieved; read/star changes do not re-embed content; account changes cannot reuse stale result scope; deleted items leave index/storage; long-thread answers survive chunking; model changes rebuild resumably. Publish recall, latency and cost by mailbox size. **Dependencies:** EP03–EP04, SDK embeddings/zvec. **PRs:** lifecycle, chunking/filters, benchmark-driven ranking.

### EP06 — Attachments as explicit evidence

**P1 attachment integrity; P2 AI extraction · Coordinator + Email.** Attachment transport exists; attachment-aware search/answers do not.

First verify send/download/cache/export and forward/reply preservation with real provider drafts. Then add bounded extraction for text/PDF; record attachment hash, MIME, extraction version, page/offset, omissions and errors. Extend to office documents/images only after choosing supported extraction or model capabilities. SDK `inference.send` currently accepts text, not arbitrary attachment inputs; extracted text must carry provenance. Untrusted documents cannot alter tool authority.

**Done when:** a PDF-only deadline can be cited to its page; unsupported/encrypted/oversized files are explicitly excluded; replaced/deleted attachments invalidate chunks; absent cached files refetch or fail clearly; attachment limits and uncertain sends preserve original draft identity. **Dependencies:** EP02–EP05, provider byte/quota budgets. **PRs:** transport acceptance coverage, PDF/text extraction, indexed evidence consumer.

### EP07 — Inline summaries and Ask Email

**P1 · Email AI/UI.** Existing summary/importance/commitment buttons stage Chat prompts.

Implement selected-thread summary first using EP02 evidence and direct inference; parse/validate a result containing facts, open questions and citations. Direct inference requires a real owning `conversationId`: obtain valid host context or use another supported execution path, and explain unavailability when neither exists. Never invent a conversation ID. Cache by evidence/model/prompt revision. Then implement Ask Email as query planning → lexical/semantic retrieval → exact hydration → bounded answer with citations/coverage. An unavailable source must produce a qualified answer or abstention. Keep explicit Chat handoff as a separate available action. Email search answers can retrieve authorized TAP context through EP32 without building a general assistant inside Email.

**Done when:** one click renders a useful result in Email; every factual claim resolves to current evidence; changed deadlines invalidate summaries; missing history/attachments and conflicting evidence are visible; malicious email text cannot trigger writes; an unsupported claim fails validation/evaluation. **Dependencies:** EP02–EP06 for corpus-wide answers; selected-thread slice can ship earlier. **PRs:** inline summary, evidence viewer/cache, Ask query pipeline.

### EP08 — Grounded writing, reply options and preferences

**P1 · Email composer.** Real inline inference is implemented but sees only subject/body/instructions.

Extend `composer-services.ts` and `AiWriter` with explicit selected-message evidence, correct sender/recipient context and optional authorized task outcome. Store account-specific user-authored style/preferences separately from factual context. Add distinct on-demand reply options through the same proposal pipeline. Later allow opt-in example-based voice, with source control and evaluation. Retain request IDs, parent conversation keys, draft revision checks and review/apply; record model usage without content logging.

**Done when:** suggested dates/amounts/claims are supported or flagged; parent composer owner switches cannot apply stale output or strand generation; denied model access, timeout and cutoff differ visibly; user edits are preserved; no send occurs on accepting text. Measure factual edit rate and accepted usefulness, not just fluency. **Dependencies:** EP02, EP07, EP22. **PRs:** grounded rewrite/reply, explicit preferences, measured reply options.

### EP09 — Obligations, meaningful priority and honest all-clear

**P0 zero correction; P1 intelligence · Email domain.** Current attention is deterministic and reminders are timers.

First share an actionable predicate across `domain.ts`, disk summary and reports that includes due reminders and relevant failed effects. Then introduce the reviewed Obligation contract: evidence, owner, requested outcome, due time/timezone, uncertainty, status and corrections. Extract candidates from current evidence; handle revised/cancelled promises and separate “awaiting reply” from “work completed.” Reuse this evidence for explainable priority/built-in labels. Keep provider flags and model judgments distinguishable; calibrate confidence on labeled examples.

**Done when:** one due reminder prevents all-clear; partial coverage never yields a universal clear claim; later Monday deadline updates the Friday obligation; corrections persist; ambiguous owners/dates remain unresolved; duplicates are suppressed; precision/recall and false-clear failures are measured. **Dependencies:** EP02–EP03, EP07. **PRs:** predicate fix, obligation store/reconciliation, evaluated labeling/priority.

### EP10 — Canonical task and conversation follow-through

**P1 · Email + Tasks integration.** Task creation and source handoff are real, but lifecycle is not maintained.

Immediately move priority/due date into SDK 0.19 `createWithReceipt`; preserve legacy receipt recovery without replaying updates over human changes. Add declared task read/comment/extension/impact permissions and schemas. Store obligation/source links in package-owned task metadata, use phase visit IDs for transitions, and reconcile task/work evidence with later emails. User-approved source deadline changes become explicit task proposals. Prepare a reply from an actual approved outcome; task completion alone does not settle the outbound obligation.

**Done when:** lost create responses reuse one task with atomic initial fields; changed human fields survive replay; task phase conflicts are visible; reopened work reopens the relevant obligation; one source yields one linked record; only the resulting send/evidence settles “customer informed.” **Dependencies:** EP09, SDK 0.19 capabilities/host grants. **PRs:** atomic create, schemas/lifecycle, outcome-to-reply integration.

### EP11 — Specialist and MCP that users can actually connect

**P0 connection proof; P1 inline execution · Email + coordinator + host.** Live tools exist; installed execution is not certified and no inline specialist turn is wired.

Provide a capability/setup view covering host support, signed endpoint, consumer/tool grants, credential expiry, accounts and verified sender workspace. Run account-list/search/exact-read smoke through the installed host. Keep current manual credential binding explicit; replacement affects the single profile token. For inline tool work bind `specialists.invoke` and invoke the declared versioned specialist with a bounded evidence/output contract. Account for persistent specialist-room context; do not assume one fresh room per email. Add reminder/attachment/label tools only as specific workflows require them, through the same authority pipeline.

**Done when:** read-only access cannot write; wrong profile/account fails; expiry/revocation/rotation are actionable; supported host can retrieve a real exact message; duplicate commands have one provider effect; uncertain send never retries under a new identity; outputs cite evidence. Separate actor, consumer and approving principal where host attestation supports it. **Dependencies:** EP01–EP03, EP07/EP12. **PRs:** setup proof, inline specialist, workflow-driven tool expansion.

### EP12 — Workflow runtime and visible results

**P0 data/result correctness; P1 executable recipes · Email + workspace workflow owner.** Six launchers depend on pre-existing saved workflows and hide results.

Introduce versioned recipe IDs/input/output schemas instead of name-only compatibility. Provision/import tested saved definitions through the supported workspace mechanism, or execute a bounded user-triggered recipe in Email; do not invent an SDK workflow-creation API. Query the repository snapshot/coverage, persist run/step identity, preflight observation, expose stalled/denied observation and resume on reopen. Render reports/drafts with source links, per-item statuses and receipts. Availability reflects actual compatible recipes and grants.

**Done when:** missing recipe cannot show Ready; 350 matches are not reported as 100 complete; close/reopen resumes one run; malformed outputs fail visibly; successful results are usable in Email; cancellation/partial failures retain completed steps without duplicate effects. **Dependencies:** EP01–EP03. **PRs:** data input repair, runtime/renderer, versioned recipe packaging. EP13–EP19 define each output separately.

### EP13 — Morning Brief

**P1 · Workflow recipe.** A named launcher exists; no recipe is supplied here.

Build a current-action briefing across selected accounts: due/overdue obligations, important new evidence since the last brief, waiting follow-ups and authorized Calendar conflicts. Include old still-open work even if no email arrived today. Show source links, last sync and omitted scopes; one action opens the relevant draft/task/thread. Start user-triggered with stable output persisted under its scope/timezone.

**Done when:** yesterday's unresolved promise appears today; a resolved item disappears with evidence; incomplete accounts are identified; duplicate runs do not create tasks or send mail; each recommendation explains its source. **Dependencies:** EP09, EP12, optional EP26 Calendar; scheduled delivery later EP20. **PR:** executable Morning Brief schema/recipe/view and evidence fixtures, not another card.

### EP14 — End-of-Day Wrap

**P1 · Workflow recipe.** Shares the current generic date-filtered input defect.

Produce separate sections for work completed during the local day, unresolved obligations carried forward, unanswered requests and failed/uncertain actions. Use committed action timestamps for completion, message timestamps for correspondence and obligation state for outstanding work. Propose tomorrow's priorities without automatically postponing deadlines. Display an explicit cutoff and coverage per section.

**Done when:** a thread updated tomorrow still contributes today's messages/actions correctly; old overdue work remains visible; an accepted command is not counted as delivered; unresolved uncertainty stays unresolved; DST days use the right interval. **Dependencies:** EP09, EP12, EP18. **PR:** EOD contract/query/recipe with cross-day and partial-coverage fixtures; recurrence EP20.

### EP15 — Daily Mail Rollup

**P1 · Workflow recipe.** Current implementation counts latest thread timestamps, not all messages in the requested window.

Define this as a correspondence report with separate incoming/outgoing message counts, unique conversations and important changes. Query message timestamps over an inclusive-start/exclusive-end timezone-resolved window. Page the full eligible repository and separate full counts from capped displayed examples. Add source-linked summaries only after deterministic counts and coverage are correct.

**Done when:** a thread with messages yesterday and today contributes to both appropriate windows without double-counting a message; 350 matches produce complete counts; a 250-example display limit is explicit; later archive/read changes do not rewrite historical event counts. **Dependencies:** EP03, EP07, EP12. **PRs:** deterministic report/query, then optional AI synthesis.

### EP16 — Missed Mail Audit

**P1 · Workflow recipe.** A launcher exists, but “missed” is not a shipped evaluated semantic judgment.

Define candidates as unsatisfied requests/obligations without an adequate reply or linked resolution after a specified cutoff. Search older unresolved work, not just unread Inbox. Include archived and delayed threads under declared scope; use provider hydration/fallback to inspect later responses before recommending action. Return “possibly missed” with reasons when evidence is incomplete; do not infer neglect from unread state.

**Done when:** an archived unanswered request can appear; replied, cancelled and intentionally ignored requests are distinguished; user exclusions persist; missing history prevents an all-clear verdict; sampled precision/recall beats unread-only heuristics. **Dependencies:** EP02–EP05, EP09, EP12. **PR:** audit recipe and review/correction UI with labeled negative cases.

### EP17 — Follow-up and incoming draft preparation

**P1 follow-ups; P2 incoming auto drafts · Workflow + composer.** Existing timers, command receipts and real writer support a complete first slice.

For due obligations, hydrate latest conversation, inspect task/conversation outcomes and existing drafts, generate a grounded proposal, then save each accepted draft via its stable command identity. Return actual provider draft links/receipts and per-item failures. Skip or invalidate when a reply arrives, obligation changes or a human edits. Once measured, extend the same engine to opt-in incoming suggestions with quotas and placeholders for unknown facts; auto-refresh stops after user editing.

**Done when:** the user can open every reported ready draft; restart resumes without duplicate drafts; new reply/deadline/task outcome invalidates old proposals; stale recipients cannot be used; partial batches are recoverable; generating a draft never sends. **Dependencies:** EP02, EP08–EP12, EP21–EP22. **PRs:** user-triggered follow-up vertical slice, then incoming opt-in; background execution EP20.

### EP18 — Activity Summary with honest freshness

**P1 local summary; P2 background completeness · Email + host activity.** The SDK source is registered and aggregates local receipt/view events.

Ship a concrete report that distinguishes drafts, sends, other committed actions and local views, with retention/truncation/freshness. For closed-app briefings, collect authoritative coordinator receipts into a background queryable aggregate with stable event deduplication; keep human views explicitly installation-scoped. Define user/workspace/source semantics and uncertain-to-applied refinement. Do not convert event counts into active minutes or time saved.

**Done when:** a send performed while Email is closed appears once after the supported background collector runs; two devices cannot double-count one provider effect; autosaves do not inflate completed drafts; unavailable history is not zero; consumer grants and identity are enforced. **Dependencies:** EP01, EP12; background EP20 or coordinator query source. **PRs:** report/freshness contract, then durable aggregation.

### EP19 — Mail Merge that ends in editable drafts

**P1 finish existing bounded operation · Email workflow/composer.** Template expansion and draft receipts already work in code.

Preserve the current 25-recipient bound and digest review. Add named template/version, per-recipient preview, duplicate-recipient and unresolved-variable checks, resumable run state and an explicit open/edit action for each saved provider draft. Account/attachments/signature are part of the reviewed input. Personalization may add evidence-backed optional fields later; keep deterministic fields deterministic. Campaign sequencing, automatic bulk send and engagement tracking are deferred.

**Done when:** restart after recipient 12 saves only outstanding items; partial failures are individually recoverable; reviewed recipients/content cannot change underneath approval; Bcc is not leaked in shared previews; every success opens a provider-visible editable draft. **Dependencies:** EP12, EP22–EP23; no model required. **PR:** resume/output/editor integration and provider draft round-trip acceptance.

### EP20 — Recurrence and event-triggered execution

**P2 after the manual workflow succeeds · Coordinator/workspace platform.** No current installed SDK recurring-workflow creation API exists.

Choose one execution owner: a supported platform scheduler if available, otherwise a coordinator-owned durable schedule/queue using existing backend infrastructure. The coordinator option also requires a supported headless model/tool executor, background retrieval and scoped Tasks/Calendar/workspace authority. A Worker cannot simply invoke the surface's local inference/zvec or host workflow APIs. Prove those execution capabilities before promising unattended AI. Email supplies settings and run history, not a browser timer. Store timezone, daylight-saving policy, user/workspace/account authority, recipe version, idempotent occurrence IDs, quotas, cancellation and retry state. Recheck grants/evidence before each run; pause on reauthorization requirements. Background jobs must retrieve evidence without depending on an open Email window.

**Done when:** a closed-surface run can retrieve evidence, execute the model and access authorized dependencies; one run per scheduled occurrence across restarts/DST; duplicate events do not duplicate effects; device sleep does not silently lose server-owned runs; revocation stops future writes; missed-run policy is explicit; failure and next-run state are visible. **Dependencies:** EP11–EP12, one proven EP13–EP19 recipe, supported headless execution and background data authority. **PRs:** capability/execution-owner ADR, durable schedule/runtime, settings/history.

### EP21 — Reminders, scheduled send, undo and recovery

**P0 replay/due correctness; P1 complete lifecycle · Coordinator + Email.** Real primitives exist; manual reminder replay fails in the effect/receipt crash window.

Make TAP-owned reminder effects idempotent and identity-aware, preferably settle effect/receipt together; old replays must not cancel a newer reminder or resurrect cancellation. Align due/returned visibility and all-clear semantics. Complete edit/cancel/if-no-reply/regardless flows, timezone-aware scheduling and fresh provider reply checks. Give failed sends edit/discard/diagnostic recovery and uncertain sends reconcile-only handling. Implement Undo as a cancellable pre-delivery hold, not a promise to recall delivered mail. Offer timezone-aware suggestions before considering predictive “best time.”

**Done when:** crash-window replay has one effect; newer reminders survive old commands; due items surface without new mail; offline/reconnect and schedule updates preserve identity; cancel races settle correctly; uncertainty cannot cause a second send. **Dependencies:** EP09, existing journal/provider authority. **PRs:** replay/zero fix, lifecycle/outbox recovery, reviewed send hold.

### EP22 — Correct recipients and a dependable composer

**P0 recipient resolution; P1 daily-client quality · Email + provider adapter.** Reply currently uses the first participant; editor is plain text with existing attachment/signature support.

Resolve Reply from the selected canonical message's Reply-To/From; implement Reply All and Forward with self/alias exclusion, header/threading correctness, quote selection and attachment choices. Preserve drafts without recipients, support provider-draft reopening and robust offline autosave. Add rich text only with safe HTML/plain-text equivalence, signature/quote boundaries and provider round-trip fidelity. Spellcheck can reuse editor/host facilities. Later Intro and Auto Bcc are explicit recipes/settings showing recipient changes before sending.

**Done when:** multi-party/self/alias/Reply-To fixtures address correctly; Bcc stays private; close/restart/offline retains edits; resumed drafts preserve formatting/attachments; subject validation matches provider behavior; selected quote keeps message identity; failed sends can be corrected. **Dependencies:** EP02, EP21. **PRs:** recipient model/actions, draft resume/autosave, editor round-trip, convenience recipes.

### EP23 — Personal and team snippets

**P1 personal; P2 team · Email + platform sharing.** Navigation vocabulary exists; a complete template product does not.

Implement a persisted template with body, variable schema, attachment references, owner, version and visibility. Insert into the real composer with placeholder validation and preview. Reuse it for Mail Merge and intro/follow-up boilerplate. Team sharing uses existing TAP membership and explicit version updates; no separate snippet-specific identity system. Defer open-rate tracking; count explicit usage only if useful and correctly scoped.

**Done when:** templates survive restart; unresolved variables cannot be silently sent; insertion respects cursor/undo; missing attachments are obvious; revoked team access removes future retrieval; edits do not mutate already-reviewed drafts; local/private templates never leak into team search. **Dependencies:** EP22, EP19 integration. **PRs:** personal template store/editor/insertion, team visibility/versioning.

### EP24 — Saved views, labels and archive rules

**P1 views/labels; P2 automatic archive · Email domain + coordinator.** Provider-backed splits exist, while model-driven labels/rules are not supplied.

Use the shared typed query for saved splits with full-replica counts and explicit overlapping membership. Add deterministic AND/OR/exclusion rules with dry-run previews. Optional semantic predicates consume EP09 evaluated decisions with rule/model revisions and correction feedback. Auto Archive ships only after classification quality is known, with protected correspondents/domains, reviewable affected scope, receipts and recovery. Hide or label unavailable Snippets/Auto Archived destinations until their data model exists.

**Done when:** split counts match query membership across pages/accounts; rule edits are versioned; replay does not repeat effects; dry-run and execution agree on a frozen scope; false archives are measurable and reversible; partial coverage never claims the full affected set. **Dependencies:** EP03–EP05, EP09, EP21. **PRs:** saved views, rules preview, opt-in automation.

### EP25 — Native collaboration with explicit sharing scope

**P1 reviewed collaboration; P2 live updates/presence · Email + TAP conversations.** Current draft sharing is a real immutable snapshot, not a live shared editor.

Keep snapshot sharing clearly labeled and add source/draft revision, audience, review comments, requested changes and return-to-draft diff. Use TAP conversations for internal comments/mentions and identity; distinguish them from provider replies. Add live thread sharing only with explicit past/future scope, membership checks and revocation. Live draft viewing can retain a single editor initially. Add expiring advisory reply/scheduled-send presence after identity and revision semantics are stable.

**Done when:** a reviewer can approve a specific version and see later changes; sharing an email does not silently expose all future messages; revoked users cannot refetch; internal comments never become email; Bcc/attachment sharing is explicit; stale presence expires. **Dependencies:** EP02, EP10, EP22, platform audience enforcement. **PRs:** versioned review snapshots, governed live source access, presence.

### EP26 — Calendar integration without a second calendar

**P1 existing link validation/context; P2 advanced scheduling · TAP Calendar + Email.** Published booking links are already fetched, revision-checked and inserted with draft guards.

First verify compose→insert→recipient booking against current link revisions and account context. Add Calendar-owned agenda/event context and a reviewed event draft from email evidence. Extend its public service with expiring timezone-aware free-time suggestions; revalidate selected slots. Team overlap, conference links and rooms use Calendar's canonical provider authority. Unknown availability is not free. Defer room booking until enterprise demand; integrate conferencing providers actually used by the pilot.

**Done when:** revoked/stale links cannot insert; changed draft selection is not overwritten; recipients reach a working published booking page; event attendee/timezone evidence is reviewable; conflicts invalidate suggestions; created events/links have Calendar receipts. **Dependencies:** existing service contract, EP02/EP07, Calendar capability/grant work. **PRs:** existing-link integration proof, event handoff/agenda, free-busy; team/conference/rooms are separate gated extensions.

### EP27 — Unified inbox, offline work and provider scope

**P0 preserve correctness; P1 offline/performance; P2 Outlook · Email storage/provider.** Direct multi-account Gmail UI and bounded persistence are real advantages to preserve.

Specify offline-supported reads/actions, cached-body coverage, durable pending journal state and conflict recovery. Keep account identities in every query, draft and command. Preserve progressive disk navigation and foreground priority while indexing. Add provider-neutral conformance fixtures before a Microsoft adapter; OAuth/scopes, delta sync, threading, attachments and uncertain-send reconciliation are separate integration work. Do not advertise Outlook until its full adapter passes those tests.

**Done when:** switching accounts during load/search/composition preserves scope; pending offline work survives restart; unavailable bodies are explicit; reconnect does not duplicate mutations; large-mailbox navigation stays within measured budgets while AI runs; account wipe removes cache/index/AI state. **Dependencies:** EP03–EP05, EP21–EP22. **PRs:** offline contract/integration fixtures, measured contention fixes, later Outlook adapter by demand.

### EP28 — Relationship context and CRM

**P1 first-party contact context; defer CRM breadth · Email + platform integrations.** Participant display and source links exist; no full relationship/CRM pane is established.

Start with verified address, recent correspondence, linked obligations/tasks/discussions and explicit user notes. A deal/contact briefing is a query over authorized first-party sources, not automatic enrichment. HubSpot/Salesforce/Pipedrive should be platform connectors requested by pilot customers; start read-only, then previewed, receipt-backed writes with stable record mapping. Pipedrive competitive write support is ambiguous in its first-party docs. Reject default third-party enrichment without a product need and data-source agreement.

**Done when:** same-name people across accounts are not merged incorrectly; every fact has a source; restricted TAP work is absent; stale CRM data is labeled; future connector writes target a reviewed canonical record. **Dependencies:** EP02–EP05, EP10/EP32. **PR:** relationship pane/history; revisit each CRM when a committed workflow and connector owner exist.

### EP29 — Unwanted mail, privacy and tracking decisions

**P0 accurate access/data model; P1 unsubscribe/spam; defer tracking · Email + coordinator/platform.** Current authority/receipts are foundations, not blanket compliance proof.

Implement provider-supported unsubscribe/spam/not-spam/block/mute as distinct actions. Validate List-Unsubscribe sources, show whether a request or confirmed outcome occurred, preview bulk scope and retain recoverable receipts. Publish an accurate data map for provider storage, coordinator encryption, local cache/indexes, model processing, retention and revocation. Preserve actual actor/consumer/action provenance where verified. Defer pixels, recent-open feeds, team open status and predictive send optimization unless a sales-led pilot proves value; opens never establish reading or commitment completion. Enterprise keys/compliance belong to the platform EP32.

**Done when:** malicious unsubscribe URLs/headers cannot cause arbitrary privileged requests; duplicate actions are safe; blocked/muted/archived semantics differ correctly; revoked access prevents new reads; account deletion follows the documented retention path; product copy matches measured behavior. **Dependencies:** EP01, EP11, EP21, platform security ownership. **PRs:** data/scope contract, provider unwanted-mail commands/UI.

### EP30 — Keyboard, accessibility and supported clients

**P1 core usability; defer bespoke voice/autocomplete/native clients · Email + host.** Keyboard navigation exists; polish needs interaction-level proof.

Test command palette, selection, Reply/Reply All/Forward, search, reminders and account switching with real focus/IME/typing boundaries. Ensure screen-reader names, focus return, loading/error announcements and responsive layouts work on supported TAP hosts. Reuse host voice transcription and editor spellcheck where available. Define Instant Copy/Open/Send behavior before implementing names from a marketing matrix. Defer a separate speech engine, predictive autocomplete and standalone mobile apps until usage evidence and host capability justify them.

**Done when:** users can complete the pilot loop by keyboard; no mail shortcut fires in text/IME composition; state changes preserve focus; accessible names/errors are actionable; supported viewport/client matrix passes; suggested text never replaces unaccepted input. **Dependencies:** EP22, EP27, host capabilities. **PRs:** interaction audit/regressions, targeted accessibility/focus fixes, later measured conveniences.

### EP31 — Evaluation, observability and release evidence

**P0 establish gates; ongoing · Product + Email/release.** 708 passing tests establish useful local behavior, not actual model quality or live host success.

Create a consented held-out corpus with old/long threads, changed dates, negative cases, multiple accounts, attachment-only evidence and adversarial email text. Measure answer-bearing-message recall, factual citation support, obligation extraction/revision accuracy, draft factual edits and verified per-item workflow completion. Instrument sync/index lag, hydration failures, queue uncertainty, observation failures and model cost without raw content. Run the installed-host/read smoke plus designated provider draft/send acceptance separately from unit tests. Compare the full follow-up task with users' current workflow.

**Initial proposed gates, not measured results:** retrieval recall@10 ≥95%; factual citation support ≥98%; obligation precision ≥95%/recall ≥90% on declared scope; ≥95% representative workflows deliver their verified output. Require zero known duplicate effects/false-clear outcomes in the crash/partial-coverage regression suite. Report sample sizes, confidence and worst cohorts. Set latency/cost budgets after profiling declared devices/mailbox sizes; do not copy “hours saved.” **Dependencies:** all delivered slices contribute cases. **PRs:** evaluation harness/corpus policy, release attestations, paired pilot report.

### EP32 — Platform boundaries and intentionally deferred products

**P1 reuse platform; defer duplicate products · TAP platform owners.** Go's cross-app agent portfolio and provider-inbox Email Assistant are separate competitor products, not Mail-only parity requirements.

Email should contribute governed evidence, tools and activity to Chloe/shared workflows. Retrieve authorized TAP documents/conversations as knowledge with audience/version checks; use platform administration/SSO/model policy. Request explicit host capabilities for scheduling, bounded FTS, credential onboarding or task metadata where necessary, with testable contracts. Do not build another general assistant, standalone KB, organization administration, BYOK system, Gmail/Outlook extension or autonomous-agent marketplace inside Email.

**Done when:** a cross-app workflow uses canonical task/calendar/knowledge services with separate authority and evidence; Email works without optional integrations; product claims accurately name supported contexts. **Revisit triggers:** a committed customer requires provider-native distribution, enterprise keys, or a missing platform capability blocks a validated workflow. **Dependencies:** EP10–EP12, EP20, EP26/EP28/EP29. **Deliverable:** owner/dependency ADRs and minimal integration contracts, not duplicate implementations.

## Delivery sequence and reviewable PRs

These tracks can overlap after their contracts stabilize. Do not wait for every parity feature to run a pilot.

| Gate | Reviewable slices | Exit evidence |
| --- | --- | --- |
| A: credible foundation | EP01 compatibility; EP02 reads/paging; EP03 enrichment/input coverage; EP09 zero fix; EP21 replay repair; EP22 recipient semantics; EP12 observation/results | Reproduced defects fixed, package tests/typechecks/manifest pass, signed host installation and authenticated read pass. |
| B: useful grounded intelligence | EP04 search correctness/index choice; EP05 maintained chunks; EP07 selected-thread summary; EP08 grounded reply; EP31 evaluation baseline | Source-cited useful output inside Email, honest missing scope, measured retrieval/draft quality. |
| C: first differentiated workflow | EP09 obligations; EP10 task lifecycle; EP12 versioned runtime; EP17 reviewed follow-ups; necessary EP11 tools | A changed email commitment updates the same linked work and produces an editable provider draft with a verified receipt; retries/reopen are safe. |
| D: workflows that keep working | EP13–EP16 report recipes; EP18 activity; EP19 merge completion; EP20 durable recurrence | Every recipe produces its defined visible result; background runs do not depend on the open UI; partial failures and freshness remain visible. |
| E: targeted daily-client breadth | EP06 extraction; EP23 snippets; EP24 saved rules; EP25 collaboration; EP26 Calendar; EP27/EP30 client quality | Pilot tasks improve without regressions in recipient correctness, latency, privacy or durability. |
| F: demand-led extensions | EP28 CRM; deferred portions of EP29–EP32; Outlook, rooms, voice/clients | Named customer workflow, canonical owner, measured benefit and explicit maintenance cost. |

The SDK stays at 0.19.0 unless a specific delivered capability requires a later release. The host minimum changes now; a speculative SDK upgrade is not a substitute for these contracts.

## Review finding closure map

| Finding | Required plan coverage |
| --- | --- |
| F01 UI-window workflow counts / wrong daily date model | EP03, EP12, EP13–EP16 |
| F02 historical empty MCP reads / long-thread gaps | EP02, EP11 |
| F03 searchable preview loss | EP03–EP05 |
| F04 overdue reminder with Operational Zero | EP09, EP21 |
| F05 wrong workflow permission / hidden output | EP01, EP12 |
| F06 host minimum incompatible with MCP | EP01, EP11 |
| F07 Reply participant-order addressing | EP22 |
| F08 sender/filter/query-scope defects | EP04–EP05 |
| F09 query-time indexing / deletion / content coverage | EP03–EP06 |
| F10 manual reminder crash-window replay | EP21 |
| Backend B04 stale coverage / B05 weak readiness | EP01, EP03, EP31 |
| SDK atomic task fields / richer task lifecycle | EP10 |
| SDK FTS5 prohibition / absent recurring API | EP04, EP20, EP32 |
| SDK actual inference/MCP/activity versus claimed end-to-end capability | EP08, EP11, EP18, EP31 |

## Every Superhuman claim: implementation disposition

Each source-backed row in the [competitor ledger](../../research/superhuman-advertised-capabilities-2026-09-27.md) has an owner plan below. A deferred row is intentionally not a promise to implement it. “Build” also includes finishing an existing implementation.

| Claim | Item | Decision and plan |
| --- | --- | --- |
| SH01 | Auto Summarize | Build cited inline summary/cache: EP07. |
| SH02 | Write with AI | Improve real writer with evidence: EP08. |
| SH03 | Voice writing | Reuse host voice if supported; defer bespoke implementation: EP30. |
| SH04 | Instant Reply | Grounded on-demand options after writer quality: EP08. |
| SH05 | Incoming Auto Drafts | Opt-in extension of proven proposal engine; EP17, then EP20. |
| SH06 | Auto Reminders | Evidence-backed obligation suggestions and reliable timers: EP09, EP21. |
| SH07 | Follow-up Auto Drafts | First vertical slice: EP17; background EP20. |
| SH08 | Personalization | Explicit account preferences first, opt-in learned voice later: EP08. |
| SH09 | Private/team Knowledge Base | Use authorized TAP knowledge; defer a duplicate KB: EP07, EP32. |
| SH10 | Ask AI / semantic answers | Correct corpus/retrieval before answers: EP02–EP05, EP07. |
| SH11 | Attachment understanding | Bounded cited extraction with explicit unsupported types: EP06. |
| SH12 | Built-in Auto Labels | Evaluated evidence-based labels/priority: EP09. |
| SH13 | Custom Auto Labels | Versioned saved rules, optional semantic predicates: EP24. |
| SH14 | Auto Archive | Opt-in after rule quality; preview and recovery: EP24. |
| SH15 | Exact search | Header correctness, ranked supported lexical index and fallback: EP04. |
| SH16 | Mail MCP | Prove connectivity/scopes, fix reads, expand by workflow need: EP02, EP11. |
| SH17 | Reusable workflows/skills | Runtime EP12; individual recipes EP13–EP19; recurrence EP20; deal/meeting context EP28/EP26. |
| SH18 | Keyboard speed | Preserve/test actual interactions: EP30. |
| SH19 | Split Inbox | Saved shared-query views with correct counts: EP24. |
| SH20 | Remind Me / Snooze | Complete due/edit/cancel/reply semantics: EP21. |
| SH21 | Personal Snippets | Persisted templates and validated insertion: EP23. |
| SH22 | Team Snippets | Versioned TAP sharing; defer engagement metrics: EP23. |
| SH23 | Send Later | Reliable schedule/cancel/uncertainty/offline behavior: EP21. |
| SH24 | Undo Send | Pre-delivery hold/cancel, not recall: EP21. |
| SH25 | Offline Support | Explicit cached-content/action contract and recovery: EP27. |
| SH26 | Autocomplete | Defer bespoke engine pending latency/acceptance evidence: EP30. |
| SH27 | Autocorrect | Use editor/host language support with reversible edits: EP22, EP30. |
| SH28 | Quick Quote | Selected-source quote/reply/forward behavior: EP22. |
| SH29 | Instant Intro | Later recipient-reviewed composer recipe: EP22, EP23. |
| SH30 | Unsubscribe / Block | Distinct provider actions and scope-aware cleanup: EP29. |
| SH31 | Contact Pane | First-party relationships/work/history; defer enrichment: EP28. |
| SH32 | Read Statuses | Defer tracking pixels; prioritize actual replies/outcomes: EP29. |
| SH33 | Recent Opens | Defer with tracking: EP29. |
| SH34 | Smart Send | Timezone-aware scheduling first; defer predictive optimization: EP21, EP29. |
| SH35 | Calendar views | Context/agenda via canonical TAP Calendar: EP26. |
| SH36 | Instant Event | Evidence-grounded reviewed Calendar handoff: EP26. |
| SH37 | Booking Links | Verify and finish current integration: EP26. |
| SH38 | Insert free times | Calendar service extension with expiring/revalidated slots: EP26. |
| SH39 | Team Scheduling | Later authorized Calendar free/busy: EP26. |
| SH40 | Conference links | Calendar-owned provider integration chosen by pilot demand: EP26. |
| SH41 | Meeting rooms | Defer until enterprise demand; Calendar ownership: EP26. |
| SH42 | Shared Conversations | Governed live sharing after versioned snapshots: EP25. |
| SH43 | Comments / mentions | Native TAP discussion linked to source/version: EP25. |
| SH44 | Shared Drafts | Versioned review first, live viewing later: EP25. |
| SH45 | Reply Indicators | Later expiring advisory presence: EP25. |
| SH46 | Team Read Statuses | Defer tracking: EP29. |
| SH47 | HubSpot | Defer connector until committed customer workflow: EP28. |
| SH48 | Salesforce | Defer connector until committed customer workflow: EP28. |
| SH49 | Pipedrive | Defer; competitive write support ambiguous: EP28. |
| SH50 | Auto Bcc | Later explicit account setting across reviewed send paths: EP22. |
| SH51 | Providers / multi-account | Preserve unified Gmail UI; Outlook after adapter conformance: EP27. |
| SH52 | Desktop/web/mobile clients | Support TAP host matrix; defer independent native clients: EP30. |
| SH53 | Provider-inbox Email Assistant | Defer separate distribution product; reuse future platform contracts: EP32. |
| SH54 | Admin / activity analytics | Host administration, accurate source totals and outcome measurement: EP18, EP31–EP32. |
| SH55 | Security / privacy | Actual access/data/retention proof; enterprise controls platform-owned: EP29, EP32. |
| SH56 | Speed / time-saved claims | Reject unsupported copied claims; comparative pilot evidence: EP31. |
| SH57 | Go / cross-app agents | Platform responsibility; governed Email contributions: EP32. |
| SH58 | Attachment basics | Transport/round-trip integrity first, extraction later: EP06, EP22. |
| SH59 | Formatting / signatures | Safe rich/plain-text and draft round trips: EP22. |
| SH60 | Instant Copy/Open/Send | Define and test interaction before parity claims: EP30. |

## Release definition

A feature is complete when a user can reach it, it uses the promised source scope, returns a usable output, survives relevant interruption/retry, and has the appropriate host/provider/model evidence. A permission declaration, specialist prompt, successful launch, available SDK method or mocked test alone does not satisfy that definition.

Gate A should be the next engineering batch. Gate C is the first competitive product milestone. Defer breadth that does not help users finish that loop.
