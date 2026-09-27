# Superhuman Mail: advertised capabilities and TAP decisions

Research date: **2026-09-27**. TAP checkpoint: `f3fa6b4`, Email `0.3.5`, Miniapp SDK `0.19.0`. This is a current first-party claims ledger and planning input, not a hands-on Superhuman benchmark or a complete TAP execution audit. Every external source below was reopened or retrieved during this pass. Undated help content establishes current documentation, not the date a feature shipped.

**Superhuman competes as a complete daily email client with collaboration, calendaring, and automation. Matching the names of its AI features would leave most of the competitive gap untouched.** TAP should preserve the useful daily-client features, finish grounded retrieval and reliable action paths, and compete on a maintained email → conversation → task → outcome loop. Sixty claims below are inputs to roughly twenty implementation plans, not sixty separate projects.

## Advertising, availability, and evidence

Marketing references used in the ledger:

- **M1 — [Mail product page][m1]:** positions a faster daily client with AI, triage, follow-up, collaboration, snippets, scheduling, tracking, and keyboard navigation.
- **M2 — [Mail AI feature page][m2]:** advertises drafting, auto organization, voice, search/answers, scheduling, and summaries.
- **M3 — [Mail pricing/features][m3]:** the broadest advertised feature checklist, including composer conveniences and enterprise controls.
- **M4 — [Mail calendar page][m4]:** availability, event creation, team scheduling, and combined Google/Outlook calendar viewing.
- **M5 — [Mail updates][m5]:** current release announcements, including meeting rooms, Outlook categories, and redesigned mobile apps.
- **M6 — [Superhuman Go][m6]:** a separate cross-application assistant and agent product. Do not silently attribute all Go features to Mail.

**Documented** means concrete usage instructions exist. It does not mean independently tested, available on every client, or reliable on arbitrary mailboxes. **Advertised** means a marketing claim without enough operational detail here. **Ambiguous** means first-party sources conflict. The feature rows state relevant restrictions; “Business+” means Business or Enterprise.

Current standalone Mail pricing is documented as Starter $30/month or $300/year, Business $40/month or $396/year, Enterprise by quote. Starter includes most core productivity, collaboration, scheduling, and some AI; Business adds Ask AI, Auto Drafts, AI custom labels, MCP and sales features. Suite Free/Pro exclude Mail; Suite Business includes it. The pricing renderer loses checkmark columns in text extraction, so exact gates below rely on prose in the dedicated help articles rather than guessed checkmarks. [Mail pricing help][pricing], [Mail marketing prices][m3], [suite plans][suite].

## SH01–SH17: AI, retrieval, and execution

| ID | Advertised item | What is currently documented | TAP disposition / useful implementation boundary |
| --- | --- | --- | --- |
| **SH01** | Auto Summarize ([M2][m2]) | One-line thread summary with expanded bullets. Automatic summaries exclude some non-primary, smart-link, transactional, and very long messages; manual summarization remains available. [Help][d01] | **P1 build grounded summary output.** Cache by source-message revision; link evidence; show excluded/truncated scope. A chat prompt or provider preview must not masquerade as a summary. |
| **SH02** | Write with AI ([M2][m2]) | Draft/rewrite/translate; Business+ can hand off non-writing requests to Ask AI. [Help][d02] | **P1 improve existing writer.** Current `composer-services.ts` invokes inference on subject/body/instructions; add reviewed thread evidence and task context, preserve stale-draft rejection. Measure accepted drafts and factual edits. |
| **SH03** | Write with Voice ([M2][m2]) | iOS/Android voice generates editable drafts, including To/Subject; English optimized. Accepting a draft does not send it. [Help][d02] | **Defer to TAP host voice.** Reuse host transcription/composer commands; do not build miniapp microphone or speech infrastructure just for parity. |
| **SH04** | Instant Reply ([M1][m1], [M3][m3]) | Three suggested responses; select, edit, send. Some transactional/social/promotion mail is excluded. [Help][d04] | **P2 build after SH02.** Generate a few meaningfully distinct, grounded options on demand; suppress suggestions where intent is unclear. Shared drafting pipeline, not another independent agent. |
| **SH05** | Incoming Auto Drafts ([M3][m3]) | Business+: incoming response/scheduling drafts, alternatives, unresolved placeholders, daily refresh; editing stops auto-refresh. Enabling response Auto Drafts disables Instant Reply. [Help][drafts] | **P2 staged automation.** First deliver opt-in suggestions; later background draft generation with revision guards, cost budgets, and no overwrite of user edits. |
| **SH06** | Auto Reminders ([M2][m2]) | Detect follow-up-worthy sent mail or apply to all external sends; configurable delay and weekdays. [Help][drafts] | **P1 commitment loop.** Use outgoing-message evidence and reply/cancellation reconciliation. Distinguish waiting-for-reply from the underlying work being completed. |
| **SH07** | Follow-up Auto Drafts ([M2][m2]) | Business+: prepare a follow-up around an hour before an existing reminder returns. [Help][drafts] | **P1 one strong workflow.** Check latest reply, task, deadline, and draft state before proposing; prove output via a draft receipt. Reuse SH05 engine, not a separate scheduler. |
| **SH08** | Personalization / voice and tone ([M3][m3]) | Business+: writing, scheduling and event preferences; prior correspondence informs voice. Settings are account-specific, edited on desktop, applied on mobile. [Help][personalization] | **P1 explicit preferences; P2 learned voice.** Account-scoped style and reusable context first; opt-in examples later. Keep style instructions separate from factual memory and recipient identity. |
| **SH09** | Private and team Knowledge Base ([M3][m3]) | Business+: files up to 50 MB and eligible public URLs; private or team-shared sources; desktop authoring, mobile use. No direct external knowledge-base integration documented. [Help][knowledge] | **P1 TAP-context retrieval; defer duplicate KB product.** Retrieve authorized TAP artifacts/conversations with source versions and audience checks. Add source import only where TAP lacks it. |
| **SH10** | Ask AI / semantic inbox answers ([M2][m2]) | Business+: inbox, calendar, web; five years of mail excluding Trash/Spam; initial indexing can take days; chat history up to 90 days. [Help][ask] | **P0 retrieval contract, then P1 answers.** Exact + semantic retrieval over real bodies, explicit account/time/resource coverage, citations, provider fallback and abstention. Do not call the current loaded-window result exhaustive. |
| **SH11** | Ask AI attachment understanding ([M2][m2] answer promise) | Ask AI help explicitly lists reading images, spreadsheets, documents, text/code, and PDFs when the thread is identified. This is distinct from attachment UI preview support. [Help][ask] | **P2 bounded extraction.** Start PDF/text; store page/attachment provenance and extraction status. Never silently imply attachment coverage when only filenames are indexed. |
| **SH12** | Built-in Auto Labels / label library ([M2][m2]) | Content-based categories and opt-in library; new mail plus prior 14 days receive matching labels. [Help][labels] | **P1 quality-gated classifier.** Establish actual labels, confidence, corrections, versioned decisions and a held-out benchmark; separate deterministic signals from model judgment. |
| **SH13** | Custom Auto Labels with AI ([M2][m2], [M3][m3]) | Deterministic AND/OR criteria, exclusions and preview feedback; Business AI prompts; up to ten AI-prompt labels. Prompts exclude timestamps, attachments and CRM information. [Help][labels] | **P2 saved rules after SH12.** Typed deterministic filters plus optional semantic predicate; preview on known coverage, version rules, support dry-run and undo. |
| **SH14** | Auto Archive ([M2][m2]) | Label-based archive plus sender/domain allow/deny lists. Exceptions protect known correspondents/internal domains and mixed-label conversations; provider filters still take precedence. [Help][archive] | **P2, after classification evaluation.** Deterministic exclusions and previews first; track false archives and reversals. Make recovery obvious. |
| **SH15** | Fast exact search ([M3][m3] productivity, [Mail guide][guide]) | Inbox/folder search, quoted exact matches, operators, AND/OR/exclusion; recent cached mail searchable offline. [Help][search] | **P0 finish indexing.** Query durable replica/body indexes, not only the hydrated window; incremental updates must retain fetched bodies. Test history, deletions, changed metadata and paging. |
| **SH16** | Mail MCP / external AI tools ([M3][m3]) | Business+: structured/semantic reads, multi-account access, drafts/send status, attachments, reminders, calendar and mailbox writes. Remote server; no attachment sending or MCP-specific actor/audit identifiers documented. [Help][mcp] | **P0 prove deployed read/write/receipt path; P1 widen tools.** SDK 0.19 code is real substrate. Add tested scopes, discovery, reauth, account isolation and consistent search semantics. Actor-attributed receipts remain useful; merely checking send status is not unique. |
| **SH17** | Complete workflows / reusable skills ([M1][m1]) | Morning Briefing, EOD Wrap, Batch Draft Writer, Deal Tracker, Meeting Scheduler and onboarding prompts. Recurrence is delegated to an external assistant's scheduler. [Help][mcp] | **P1 ship one reproducible workflow.** Package/create required definitions, persist run/step/output state, distinguish accepted from completed, support recovery. **Defer** general autonomous portfolio until the follow-up loop passes evaluation. |

## SH18–SH34: daily email productivity

| ID | Advertised item | What is currently documented | TAP disposition / useful implementation boundary |
| --- | --- | --- | --- |
| **SH18** | Keyboard speed / command palette ([M1][m1]) | Command palette, shortcut menu and desktop shortcut reference. [Help][keys] | **P0 preserve and test.** Keep mail selection, archive, reply, reminder, account switching and search fast; test text-entry/IME boundaries. Measure interactions, not shortcut count. |
| **SH19** | Split Inbox / library ([M1][m1], [M3][m3]) | Custom inbox sections from search criteria or labels, counts and keyboard navigation. [Help][splits] | **P1 saved views.** Build on one query/coverage model used by search and workflows; define overlapping membership and count semantics. |
| **SH20** | Remind Me / Snooze ([M1][m1]) | Manual time, “if no reply” or “regardless”; removes from active inbox and returns when due. “Someday” stays deferred. [Help][remind] | **P0 correctness, P1 ergonomics.** Due reminders must invalidate Operational Zero and remain visible even without new messages; reconcile replies and timezone edits. |
| **SH21** | Personal Snippets ([M1][m1]) | Reusable templates, variables, unresolved-placeholder warnings, desktop creation and mobile insertion. [Help][snippets] | **P1 deterministic templates.** Persist reviewed text/variables/attachment references; validate placeholders and recipients before send. Prefer this over repeated LLM generation for fixed language. |
| **SH22** | Team Snippets ([M1][m1], [M3][m3]) | Shared reusable snippets with author and send/open/reply metrics. [Help][snippets] | **P2 reuse TAP sharing.** Versioned ownership, visibility and import/export; **defer open-rate instrumentation**. Same template model as SH21. |
| **SH23** | Send Later ([M1][m1]) | Desktop/mobile scheduling; already-scheduled messages send while offline; offline-created sends wait for reconnect. [Scheduling guide][later], [offline help][offline] | **P0 reliability / P1 complete UX.** Audit current scheduled-send queue for timezone, cancellation, update, reconnect and uncertain outcomes; no duplicate sends. |
| **SH24** | Undo Send / Undo ([M3][m3]) | Ten-second desktop undo window; mobile undo; window cannot be extended. [Help][undo] | **P1 delivery hold.** Distinguish reversing queued commands from recalling delivered mail. Offer a clear cancelable send period and authoritative state. |
| **SH25** | Offline Support ([M3][m3]) | Cached messages include opened/searched/recent 30-day mail and up to 1,250 per split; attachments downloaded; offline work syncs later. [Help][offline] | **P0 durable state; P1 offline contract.** State exactly which content/actions are available; durable outbox, pending-state UI and conflict reconciliation. A cache alone is not offline parity. |
| **SH26** | Autocomplete ([M3][m3]) | Desktop inline suggestions; pre-trained common phrases, not learned from a user's history; not multilingual. [Help][autocomplete] | **Defer.** Requires low latency, editor stability and acceptance-rate evidence; host/browser support may be sufficient. |
| **SH27** | Autocorrect ([M3][m3]) | Desktop language selection, correction undo and personal dictionary. [Help][autocorrect] | **P2 reuse editor/host spelling.** Avoid silent changes to names, amounts, addresses, or code; defer a bespoke engine. |
| **SH28** | Quick Quote ([M3][m3]) | Select message text, then reply/reply-all/forward with that excerpt quoted; desktop only. [Help][quote] | **P1 small editor improvement.** Preserve selected-message identity and escaped quote formatting; useful for point-by-point replies and evidence. |
| **SH29** | Instant Intro ([M3][m3]) | Thanks introducer, moves them to Bcc; customizable one-line message; desktop/iOS. [Help][intro] | **P2 compose recipe.** Show recipient diff and let user choose introducer; reuse snippets and recipient validation. |
| **SH30** | Unsubscribe / Block / unwanted mail ([M1][m1], [M3][m3]) | Unsubscribe may send a request or open a provider page; sender/domain block and spam actions; optional archive/trash of matching mail. [Help][unwanted] | **P1 safe unsubscribe and spam, P2 bulk cleanup.** Detect supported headers; distinguish provider request from confirmed unsubscribe; preview affected scope and keep receipts. |
| **SH31** | Social insights / Contact Pane ([M1][m1]) | Profile, role, location, social links and recent correspondence from external enrichment providers; user can edit own profile, not others. [Help][contacts] | **P1 first-party relationship context; reject default enrichment clone.** Show verified address, recent threads, associated TAP work and explicit user notes. Defer external data licensing. |
| **SH32** | Read Statuses ([M1][m1]) | Open time/device/person view for Mail-sent messages; account opt-in; tracking pixels can be blocked. [Help][reads] | **Defer tracking.** Prioritize actual replies, delivery receipts and task progress; do not treat a reported open as proof of reading. |
| **SH33** | Recent Opens feed ([M3][m3]) | Business+: recent-open feed; help says no open notifications. [Help][reads] | **Defer with SH32.** Little value to TAP's commitment proposition without a sales-led use case. |
| **SH34** | Smart Send ([M3][m3]) | Business+, desktop; recommends recipient-specific send times from observed activity and third-party timezone data; withholds recommendation when insufficient data. [Help][smart] | **P2 timezone-aware Send Later; defer predictive optimization.** Test response benefit before collecting engagement data or claiming an optimal time. |

## SH35–SH41: calendar and scheduling

| ID | Advertised item | What is currently documented | TAP disposition / useful implementation boundary |
| --- | --- | --- | --- |
| **SH35** | Day/week calendar beside mail ([M4][m4]) | Day sidebar, week view, calendar settings and invite context. [Help][calendar] | **P1 integrate TAP Calendar.** Show contextual agenda/availability and navigate to its canonical event; avoid a second calendar model in Email. |
| **SH36** | Instant Event / Ask AI event creation ([M4][m4]) | Thread-derived attendees, purpose, links and suggested time; Ask AI Business+; editable event before saving. [Help][events] | **P1 reviewed Email→Calendar handoff.** Typed draft, evidence and explicit timezone; Calendar owns event mutation and receipt. |
| **SH37** | Booking Links ([M3][m3], [M4][m4]) | Booking pages include duration, scheduling window, conflict calendars and co-hosts; recipient selects a live available slot. Desktop management. [Help][availability] | **P1 finish/test existing integration.** `booking-links.ts` already lists and revision-validates published TAP Calendar links. Validate the entire compose→recipient booking path. |
| **SH38** | Insert free times / Share Availability ([M4][m4]) | Select slots in compose, insert formatted availability with optional booking link; live link reflects changed conflicts; desktop only. [Help][availability] | **P1 Calendar service extension.** Return account-scoped, timezone-aware candidate slots with expiry; revalidate before insertion/send. Reuse SH37. |
| **SH39** | Team Scheduling / Find Time ([M4][m4]) | Desktop overlapping team availability and timezone conversion. [Help][teamschedule] | **P2 Calendar-owned.** Require authorized free/busy coverage, distinguish unknown from free, and avoid leaking event details. |
| **SH40** | Zoom / Meet / Teams links ([M3][m3]) | Calendar event creation supports conferencing links and configurable defaults. [Help][events] | **P2 Calendar-owned.** Integrate the provider actually used by pilot users first; never fabricate a working meeting URL. |
| **SH41** | Meeting rooms ([M5][m5]) | Current announcement and help document desktop room booking, recent/available room suggestions, and Google/Microsoft authorization requirements. [Announcement][m5], [Help][events] | **Defer unless enterprise calendar demand.** Resource calendars and booking permissions belong in TAP Calendar. This is newly verified scope, not a proven release since Sep20. |

## SH42–SH50: collaboration and integrations

| ID | Advertised item | What is currently documented | TAP disposition / useful implementation boundary |
| --- | --- | --- | --- |
| **SH42** | Shared Conversations ([M1][m1]) | Share publisher's past/future thread view, including subthreads they can see; guests can view/comment. Individual participant removal is not documented as available. [Help][sharing] | **P1 native TAP live handoff.** Keep current snapshot option; add explicit live-sharing scope, audience review, revocation and source refresh. A link alone does not grant permission. |
| **SH43** | Team Comments / mentions ([M1][m1]) | Internal thread comments and mentions; guest browser comments; author's comment deletion, no editing documented. [Help][sharing] | **P1 reuse TAP conversations.** Bind comments to email source/revision and distinguish internal posts from provider replies. Preserve membership and author permissions. |
| **SH44** | Shared Drafts ([M3][m3]) | Teammates see live updates and comment; only original author edits. Sharing a reply draft shares the whole thread. [Help][shareddraft] | **P1 reviewed draft collaboration; P2 live view.** Current TAP `shareDraftSnapshot` is immutable snapshot delivery. Label it as such; add versioned review status, diff and return-to-draft before live syncing. |
| **SH45** | Team Reply Indicators ([M1][m1], [M3][m3]) | Shows teammate drafting or scheduled reply, helping avoid collisions. [Help][teamstatus] | **P2 lightweight presence.** Account/thread-scoped expiring draft lease; show advisory status, not a lock or delivery guarantee. |
| **SH46** | Team Read Statuses ([M3][m3]) | Sharing external-recipient open information with teammates included in the conversation. [Help][teamstatus] | **Defer with SH32.** Prefer explicit task ownership and reply presence over additional tracking infrastructure. |
| **SH47** | HubSpot integration ([M3][m3]) | Business+: display records, edit properties, add contacts, enroll in sequences when HubSpot permits; mobile viewing. Incoming mail logging is not provided. [Help][hubspot] | **Defer connector until demand.** Start read-only relationship context through platform integrations; any later CRM write gets a preview and receipt. |
| **SH48** | Salesforce integration ([M3][m3]) | Business+: read/update CRM fields and add contacts; desktop only; Salesforce API access required; no inbound email logging. [Help][salesforce] | **Defer with SH47.** One canonical integration layer, no email-specific CRM shadow database. |
| **SH49** | Pipedrive integration ([M3][m3]) | Business+, desktop CRM sidebar. **Ambiguous:** page contains field-edit instructions but FAQ says edit access unavailable. [Help][pipedrive] | **Defer.** Treat competitive write parity as unverified; build only for a committed customer use case. |
| **SH50** | Auto Bcc / CRM logging ([Mail help][autobcc]) | Account-specific automatic Bcc; CRM help documents outgoing logging via CRM-generated addresses. [Help][autobcc], [HubSpot][hubspot] | **P2 explicit account setting.** Show hidden recipients in compose/review and all send paths; do not silently copy private mail via inferred rules. |

## SH51–SH60: scope, trust, platform, and composer basics

| ID | Advertised item | What is currently documented | TAP disposition / useful implementation boundary |
| --- | --- | --- | --- |
| **SH51** | Gmail + Outlook / multi-account ([M1][m1]) | Gmail/Google and Microsoft 365-hosted accounts; no generic provider support. Account switching and MCP cross-account access exist; **Mail has no unified inbox**, only a native-tab workaround. [Accounts][accounts], [unified limitation][unified] | **P0 preserve direct Gmail unified inbox; P2 Outlook.** A concrete UX advantage over Mail today. Add Microsoft only after the provider contract and Gmail correctness gates pass. |
| **SH52** | Web, desktop, iOS/iPadOS, Android ([M5][m5]) | Native desktop/Chrome extension and mobile downloads; feature parity varies as noted per row. [Downloads][download] | **P1 responsive host support; defer standalone clients.** Test supported TAP hosts. Do not promise native-mobile parity from a responsive web layout. |
| **SH53** | Email Assistant inside existing Gmail/Outlook ([Go marketing][m6]) | Separate assistant mode performs labeling, archive, drafts and reminders in existing provider inboxes. Six fixed categories; removing a label is not learned feedback. [Gmail help][assistantgmail], [Outlook help][assistantoutlook] | **Defer separate distribution mode.** Finish TAP-native value first; later reuse coordinator/intelligence outputs if provider-native delivery has demand. |
| **SH54** | Team administration / activity analytics ([M3][m3]) | Admin Console on all Mail plans; Enterprise desktop/web activity tab is phased, daily refreshed, includes platform/feature usage and CSV export. [Help][admin] | **P1 use host administration; P2 outcome metrics.** Current activity source counts actions, not productivity gains. Measure corrected drafts, obligations resolved and elapsed work without inventing saved hours. |
| **SH55** | Enterprise security / privacy ([M3][m3], [M2][m2]) | Enterprise SSO/control claims; BYOK specifically protects Turbopuffer AI data via Google KMS, not all stores. No-training claims do not mean no storage; Ask AI documents retained queries/responses. [BYOK scope][byok], [AI retention][ask], [plan help][pricing] | **P0 accurate data map and access controls.** Verify encryption, retention, revocation and actor audit. **Defer** bespoke BYOK/compliance claims to TAP platform and actual customer requirements. |
| **SH56** | Four hours saved / twice as fast / productivity leadership ([M1][m1], [M2][m2]) | Vendor marketing claims; these pages do not provide a reproducible evaluation sufficient to transfer the numbers to TAP or establish superiority. | **Reject copying claims.** Benchmark representative user tasks with the same accounts/data, errors included; report distribution and cohort, not a fabricated universal multiplier. |
| **SH57** | Cross-app agents, Daily Brief, custom agents / suite ([M6][m6]) | **Broader product, not Mail feature parity.** Go markets connected-app context, scheduled/event agents and writing assistance. Suite page marks some Go agent surfaces beta/trial. [Go][m6], [suite][suite] | **TAP platform plan, not Email scope.** Email contributes governed data/tools; Chloe and shared workflows own cross-app reasoning. No second general assistant in the miniapp. |
| **SH58** | Attachment send/download/preview ([Mail help][attachments]) | In-app PDF preview; Office files generally downloaded; provider limits around 25 MB; cloud attachments unsupported. This differs from SH11 AI reading. [Help][attachments] | **P1 complete existing attachments.** Verify preservation in forward/reply, lazy cache/export, missing-file handling and uncertain sends; P2 safe previews/extraction. |
| **SH59** | Rich formatting / signatures ([Mail help][formatting]) | Rich compose formatting and signatures; provider/client differences documented. [Formatting][formatting], [signatures][signatures] | **P1 strengthen existing editor.** Preserve HTML/text equivalence, selection, quote/signature boundaries, pasted content and provider-draft round trips. Treat this as core quality. |
| **SH60** | Instant Copy / Open / Send convenience ([M3][m3]) | Listed in the marketing feature matrix. This pass did **not** establish full individual behavior from dedicated current help pages. | **P2 only after interaction validation.** Define the exact action and keyboard/focus behavior before parity work. **Reject unchecked feature-complete status** based on names alone. |

## What materially changes the Sep20 assessment

These are new findings or expanded verification, **not assertions that Superhuman launched them during this week**:

1. The current MCP inventory explicitly includes `get_draft_send_status`, `get_attachment`, full-message/thread/draft reads and reminder operations. “Our assistant can inspect a send result” is not exclusive differentiation. The narrower opportunity is consistent provenance, coverage, actor attribution and recovery across TAP work. [Current MCP docs][mcp]
2. A directly unified inbox is a more concrete present-day advantage than generic multi-account AI. Superhuman itself says it lacks that UI. [Unified limitation][unified]
3. Collaboration parity means audience-aware live thread sharing, comment identity, draft revisions and reply collisions—not merely posting copied email text into chat. [Shared conversation semantics][sharing], [shared draft semantics][shareddraft]
4. The broader Superhuman brand now markets cross-app agents prominently. Keep Mail, Email Assistant, Go, and Docs/suite boundaries explicit when making claims. [Go][m6], [suite][suite]
5. Several first-party pages conflict: the suite table calls CRM integrations read-only while HubSpot/Salesforce help documents writes; Pipedrive contradicts itself; broad AI marketing says responses are not logged while feature help describes retention. Treat those as documentation ambiguity, not evidence of wrongdoing or guaranteed availability. [Suite][suite], [HubSpot][hubspot], [Salesforce][salesforce], [Pipedrive][pipedrive], [AI marketing][m2], [AI help][ask]

The **TAP** baseline genuinely changed: `0.3.5` uses SDK `0.19.0`; ADR 0005 describes registered live mail MCP reads/draft/send and an activity-source ABI. The composer now has an actual inference-backed writer with stale-proposal checks, plus an idempotent draft-snapshot share; published Calendar links are fetched and checked against revision/generation before insertion. These source facts replace the older assumption that all AI paths only stage a chat prompt. They do **not** prove deployment credentials, host grants, specialist invocation, complete retrieval or background workflows are functioning in production. [Package](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/f3fa6b493ecd757e48ff69eb4015352e7b1d142b/apps/tap-email/package.json), [ADR 0005](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/f3fa6b493ecd757e48ff69eb4015352e7b1d142b/apps/tap-email/docs/adr/0005-sdk-019-activity-and-email-tools.md), [writer](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/f3fa6b493ecd757e48ff69eb4015352e7b1d142b/apps/tap-email/src/ai-writer.tsx), [composer services](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/f3fa6b493ecd757e48ff69eb4015352e7b1d142b/apps/tap-email/src/composer-services.ts), [booking link client](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/f3fa6b493ecd757e48ff69eb4015352e7b1d142b/apps/tap-email/src/booking-links.ts).

The current workflow module still requires pre-existing saved workflows and sends a scope payload; its comments/error text still cite SDK 0.15. The product catalog also still says SDK 0.15. Those are stale descriptions to reconcile with the actual host contract, not grounds for declaring scheduling either available or impossible. [Workflow module](https://github.com/ZephyrCloudIO/tap-miniapp-examples/blob/f3fa6b493ecd757e48ff69eb4015352e7b1d142b/apps/tap-email/src/email-workflows.ts), [catalog](../miniapps/09-tap-email.md).

## Recommended planning bundles

Use these as dependencies, not a feature-count contest:

1. **Correctness first:** retrieval/index lifecycle/coverage (SH10–11, SH15–16), due-reminder and Operational Zero semantics (SH06, SH20), authoritative command/outbox state (SH23–25).
2. **One grounded intelligence pipeline:** summaries, drafting, reply suggestions, preferences and context (SH01–09), classification/rules/views (SH12–14, SH19). Shared source records and evaluation sets prevent divergent assistant answers.
3. **One completed work loop:** durable follow-up workflow (SH07, SH17), native conversation and draft review (SH42–45), canonical task/event state. Require evidence of the outcome, not just a successful tool invocation.
4. **Finish daily-driver basics:** keyboard, snippets, quote/editor/attachments/unsubscribe (SH18, SH21–30, SH58–60); integrate published booking links and Calendar primitives (SH35–40).
5. **Explicitly deferred:** tracking/predictive sales features (SH32–34, SH46), CRM provider breadth (SH47–50), enterprise rooms and keys (SH41, SH55), standalone mobile and provider-native assistant distribution (SH52–53). These should not delay correctness or the native TAP work loop.

For the first pilot, measure answer-bearing-message recall, unsupported-answer rate, indexed-body coverage/freshness, incorrect/duplicate commitments, verified workflow completion, draft factual edits, and time to complete the end-to-end task. The competitive claim worth earning is **“TAP keeps the work attached to the email correct as the conversation changes.”**

[m1]: https://superhuman.com/mail
[m2]: https://superhuman.com/mail/features/ai-native-email-client
[m3]: https://superhuman.com/plans/mail
[m4]: https://superhuman.com/mail/calendar
[m5]: https://new.superhuman.com/
[m6]: https://superhuman.com/go
[suite]: https://superhuman.com/plans
[pricing]: https://help.superhuman.com/hc/en-us/articles/46178817646861-Pricing-Plans
[guide]: https://help.superhuman.com/hc/en-us/articles/46005781623053-Guides
[d01]: https://help.superhuman.com/hc/en-us/articles/46005642123917-Auto-Summarize
[d02]: https://help.superhuman.com/hc/en-us/articles/46005557122957-Write-with-AI
[d04]: https://help.superhuman.com/hc/en-us/articles/46005583725709-Instant-Reply
[drafts]: https://help.superhuman.com/hc/en-us/articles/46005658551053-Auto-Reminders-Auto-Drafts
[personalization]: https://help.superhuman.com/hc/en-us/articles/46005802896781-Personalization
[knowledge]: https://help.superhuman.com/hc/en-us/articles/46005666866829-Knowledge-Base
[ask]: https://help.superhuman.com/hc/en-us/articles/46005676610829-Ask-AI
[labels]: https://help.superhuman.com/hc/en-us/articles/46005657758861-Auto-Labels
[archive]: https://help.superhuman.com/hc/en-us/articles/46005662460813-Auto-Archive
[search]: https://help.superhuman.com/hc/en-us/articles/46005672652301-Search
[mcp]: https://help.superhuman.com/hc/en-us/articles/46005696690317-Superhuman-Mail-MCP-Server
[keys]: https://help.superhuman.com/hc/en-us/articles/46005701270541-Keyboard-Shortcuts-in-Superhuman-Mail
[splits]: https://help.superhuman.com/hc/en-us/articles/46005636204941-Custom-Split-Inbox
[remind]: https://help.superhuman.com/hc/en-us/articles/46005666142733-Remind-Me
[snippets]: https://help.superhuman.com/hc/en-us/articles/46005686571149-Snippets
[later]: https://help.superhuman.com/hc/en-us/articles/47206763851533-Switching-from-Notion-Mail-to-Superhuman-Mail
[offline]: https://help.superhuman.com/hc/en-us/articles/46005499629325-Offline-Access
[undo]: https://help.superhuman.com/hc/en-us/articles/46005666743309-Undo
[autocomplete]: https://help.superhuman.com/hc/en-us/articles/46005685782669-Autocomplete
[autocorrect]: https://help.superhuman.com/hc/en-us/articles/46005640149389-Autocorrect
[quote]: https://help.superhuman.com/hc/en-us/articles/46005692763661-Quick-Quote
[intro]: https://help.superhuman.com/hc/en-us/articles/46005674036877-Instant-Intro
[unwanted]: https://help.superhuman.com/hc/en-us/articles/46005635358349-Dealing-with-Unwanted-Emails
[contacts]: https://help.superhuman.com/hc/en-us/articles/46005778939789-Contact-Pane
[reads]: https://help.superhuman.com/hc/en-us/articles/46005603745293-Read-Statuses-and-Recent-Opens-Feed
[smart]: https://help.superhuman.com/hc/en-us/articles/46005572688525-Smart-Send
[calendar]: https://help.superhuman.com/hc/en-us/articles/46005615985293-Calendar-Overview
[events]: https://help.superhuman.com/hc/en-us/articles/46005621734669-Create-Event
[availability]: https://help.superhuman.com/hc/en-us/articles/46005575115021-Share-Availability
[teamschedule]: https://help.superhuman.com/hc/en-us/articles/46005682760973-Team-Scheduling
[sharing]: https://help.superhuman.com/hc/en-us/articles/46005593675917-Shared-Conversations-and-Team-Comments
[shareddraft]: https://help.superhuman.com/hc/en-us/articles/46005578703885-Shared-Drafts
[teamstatus]: https://help.superhuman.com/hc/en-us/articles/46005718826125-Team-Read-Statuses-and-Team-Reply-Indicators
[hubspot]: https://help.superhuman.com/hc/en-us/articles/46005546891021-HubSpot
[salesforce]: https://help.superhuman.com/hc/en-us/articles/44999426280333-Salesforce
[pipedrive]: https://help.superhuman.com/hc/en-us/articles/46005524701069-Pipedrive
[autobcc]: https://help.superhuman.com/hc/en-us/articles/46005654497549-Auto-Bcc
[accounts]: https://help.superhuman.com/hc/en-us/articles/46005777934733-Managing-Accounts
[unified]: https://help.superhuman.com/hc/en-us/articles/46005722297229-Unified-Inbox-Workaround
[download]: https://help.superhuman.com/hc/en-us/articles/46005778798605-Download-Superhuman-Mail
[assistantgmail]: https://help.superhuman.com/hc/en-us/articles/46005854346893-Email-Assistant-by-Superhuman-Mail-Gmail
[assistantoutlook]: https://help.superhuman.com/hc/en-us/articles/46183302401933-Email-Assistant-by-Superhuman-Mail-Outlook
[admin]: https://help.superhuman.com/hc/en-us/articles/46005770110861-Admin-Console
[byok]: https://help.superhuman.com/hc/en-us/articles/46005802988813-Bring-Your-Own-Key-BYOK
[attachments]: https://help.superhuman.com/hc/en-us/articles/46005568142989-Attachments
[formatting]: https://help.superhuman.com/hc/en-us/articles/46005721681165-Formatting-Text
[signatures]: https://help.superhuman.com/hc/en-us/articles/46005771841933-Signatures
