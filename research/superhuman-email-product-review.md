# Superhuman Mail product review for TAP Email

_Research date: 2026-08-16_

## Executive conclusion

TAP Email should match Superhuman's interaction discipline: a command palette that teaches shortcuts, a tiny inbox-zero decision loop, automatic movement to the next thread, optimistic reversible actions, local-first search and triage, and careful draft/send recovery. It should not be a visual clone.

The strongest product position is:

> **The keyboard-first, locally responsive email command center for all of a user's accounts, conversations, specialists, and workflows—with observable protection against missed critical mail.**

The clearest openings in Superhuman's documented product are:

- no unified inbox in the client, even though its MCP can search multiple accounts;
- no documented systematic sentiment inbox, sentiment trend, or critical-mail coverage audit;
- collaboration centered on shared email links/views rather than native platform conversations;
- per-account AI personalization that must be duplicated manually;
- non-customizable, US-QWERTY-oriented shortcuts;
- a remote MCP with default-account ambiguity, no MCP-specific audit provenance, and no attachment sending;
- documented offline caching, but no equally clear user controls for local cache encryption, inspection, per-account wipe, or remote revocation.

TAP should make these the differentiation, while treating Gmail as authoritative for provider-native mailbox state and TAP as authoritative for derived intelligence, workflows, achievements, and email-to-conversation links.

## Research scope and method

This is a comprehensive review of the official Superhuman material relevant to the proposed product: current Help Center articles, official product and engineering pages, security/legal material, the official shortcut PDF, and current Google Gmail API documentation. It is not a page-by-page audit of unrelated Superhuman Docs, Go, billing, or Microsoft-only documentation.

The installed `/Applications/Superhuman.app` package was inspected only for non-sensitive application metadata and bundled code structure. No account data, mailbox data, tokens, browser profiles, credentials, or user caches were inspected.

## 1. Interaction model and keyboard philosophy

### What Superhuman does

`Cmd+K` on macOS and `Ctrl+K` on Windows opens Superhuman Command, a searchable palette for actions and navigation. The palette displays each action's direct shortcut, while buttons teach shortcuts on hover. Superhuman explicitly recommends starting with a few shortcuts such as `C` for compose and `/` for search; shortcuts cannot currently be customized. [Desktop Shortcuts](https://help.superhuman.com/hc/en-us/articles/46005701270541-Desktop-Shortcuts)

The official shortcut vocabulary covers selection and bulk actions, archive/reminder/star/read/trash/spam/mute/unsubscribe, labels and folders, compose/reply/forward, links and attachments, split navigation, calendar, formatting, tabs, account switching, and undo. [Official shortcut PDF](https://download.superhuman.com/Superhuman_Keyboard_Shortcuts.pdf)

The core inbox-zero decision loop is deliberately small:

| Decision | Superhuman key | Effect |
|---|---:|---|
| Handle today | `J` | Leave in inbox and advance |
| Handle another day | `H` | Set Reminder, remove from current inbox, then advance |
| Handled | `E` | Mark Done/provider archive, then advance |
| File and finish | `V` | Move to label/folder and mark Done |
| Reverse last action | `Z` | Undo |

Superhuman describes the inbox as a task list rather than an unread list, and immediately opens the next conversation after an action to preserve flow. [Achieve Inbox Zero](https://help.superhuman.com/hc/en-us/articles/46005833597709-Achieve-Inbox-Zero)

"Done" maps to archive at the provider, remains searchable, and returns to the inbox if a new reply arrives. "Send + Mark Done" combines sending and clearing the thread. [Mark Done](https://help.superhuman.com/hc/en-us/articles/47439134613773-Mark-Done)

Superhuman supports select-all and "Get Me To Zero" bulk cleanup; the latter can preserve unread/starred conversations and is reversible for seven days. [Mass Archive](https://help.superhuman.com/hc/en-us/articles/46005611576589-Mass-Archive), [Mark Done](https://help.superhuman.com/hc/en-us/articles/47439134613773-Mark-Done)

Its shortcuts currently target US QWERTY and require documented workarounds on international layouts. [Shortcuts for International Keyboards](https://help.superhuman.com/hc/en-us/articles/46005584339597-Shortcuts-for-International-Keyboards)

### TAP decision

Match the command palette, single-key action grammar, immediate next-thread behavior, multi-select/bulk actions, optimistic UI, and universal undo. Make every action discoverable without forcing the user to memorize shortcuts first.

Improve the model with:

- fully remappable shortcuts and first-class international layouts;
- a visible focus ring and predictable keyboard focus in every state;
- shortcut conflict detection;
- one shortcut to open TAP Email inside the Chloe panel and restore the exact queue/thread position;
- an action receipt that shows account, mailbox mutation, sync state, and undo deadline;
- a no-mouse path for every core workflow, including account switching and bringing mail into a conversation.

## 2. Inbox structure, priority, labels, and accounts

### What Superhuman does

Split Inboxes are action-oriented queues rather than storage folders. Default splits include Important/Other, Shared, Team, VIP, News, and Calendar; they show total conversations rather than unread conversations, and `Tab` / `Shift+Tab` moves between them. Superhuman recommends roughly three to seven splits. [Default Split Inbox](https://help.superhuman.com/hc/en-us/articles/46005619081101-Default-Split-Inbox)

Important is intended for person-to-person and high-priority mail, while Other holds lists and automated messages. VIP and Team rules can also duplicate matching mail into Important. [Default Split Inbox](https://help.superhuman.com/hc/en-us/articles/46005619081101-Default-Split-Inbox)

Custom splits can combine sender/recipient/subject-style rules and AI Auto Labels. [Custom Split Inbox](https://help.superhuman.com/hc/en-us/articles/46005636204941-Custom-Split-Inbox), [Organize with AI](https://help.superhuman.com/hc/en-us/articles/46005852837773-Organize-with-AI)

Superhuman supports multiple Gmail and Microsoft 365 accounts and fast keyboard switching, but accounts added on desktop do not automatically appear on mobile. Most importantly, Superhuman says it has no unified client inbox and recommends separate tabs as a workaround. [Managing Accounts](https://help.superhuman.com/hc/en-us/articles/46005777934733-Managing-Accounts), [Unified Inbox Workaround](https://help.superhuman.com/hc/en-us/articles/46005722297229-Unified-Inbox-Workaround)

For Gmail, `L` applies/removes a label and `V` applies a label while archiving. Label deletion still has to be done in Gmail. [Labels for Gmail](https://help.superhuman.com/hc/en-us/articles/46005736546061-Labels-Gmail-Accounts)

### TAP decision

The default TAP view should be a real unified inbox across all connected Google accounts, with a single keystroke to enter a persistent single-account view. Each row and opened thread must clearly identify its account. Compose, reply, draft, and send must make the sending identity visually unavoidable.

Recommended default queues:

1. Critical
2. Needs response
3. Waiting on others
4. Today
5. FYI
6. Newsletters/automated

Users can add rule-based or AI-defined views, but TAP should limit the top-level working set and hide empty optional queues. Provider labels remain available as storage/organization metadata; TAP queues represent action state.

Unlike Superhuman's per-device setup, connected accounts and product settings should follow the user's TAP platform identity across devices, while local message caches remain device-specific.

## 3. Gmail as source of truth

Superhuman describes itself as another client over the same Gmail mailbox. Messages, ordinary drafts, Gmail labels, archive/Done, stars, read state, and Trash synchronize between the clients. [Executive Assistants Working in Gmail via Delegation](https://help.superhuman.com/hc/en-us/articles/47464280644621-Executive-Assistants-Working-in-Gmail-via-Delegation)

Superhuman-owned state does not appear in Gmail: Split Inboxes, Superhuman Important/Other classification, scheduled-send staging, read tracking, Snippets, Reminders, Team Comments, and Shared Conversations. [Executive Assistants Working in Gmail via Delegation](https://help.superhuman.com/hc/en-us/articles/47464280644621-Executive-Assistants-Working-in-Gmail-via-Delegation)

Superhuman's Important/Other behavior depends on Gmail smart features and its Primary categorization rather than simply mirroring Gmail's yellow Important marker. [Structure Your Inbox](https://help.superhuman.com/hc/en-us/articles/46005793275277-Structure-Your-Inbox), [Moving Conversations Between Important and Other](https://help.superhuman.com/hc/en-us/articles/46005707869965-Moving-Conversations-Between-Important-and-Other)

Gmail aliases are configured in Gmail and refreshed into Superhuman; the sender can switch aliases during compose. Superhuman uses the Gmail-configured signature and supports only one active signature directly, suggesting Snippets as a workaround for multiple signatures. [Alias](https://help.superhuman.com/hc/en-us/articles/46005743269901-Alias), [Signatures](https://help.superhuman.com/hc/en-us/articles/46005771841933-Signatures)

Superhuman currently does not allow direct sign-in to a Gmail delegated mailbox even though delegate actions performed in Gmail synchronize back to the account owner's Superhuman view. [Executive Assistants Working in Gmail via Delegation](https://help.superhuman.com/hc/en-us/articles/47464280644621-Executive-Assistants-Working-in-Gmail-via-Delegation)

### TAP state boundary

| State | Authority |
|---|---|
| Message/thread contents, ordinary drafts, sent state, read/unread, stars, archive, trash, Gmail labels | Gmail |
| Account connection and OAuth grant | Google + TAP identity layer |
| Unified views, priority and critical scores, response obligations, sentiment, reminders, achievements, summaries | TAP |
| Email-to-conversation links, comments, workflow runs, specialist decisions, tool approvals, audit provenance | TAP platform |
| Local replica and pending optimistic mutations | TAP device cache, reconciled against Gmail |

Provider state, TAP-derived state, and workflow/agent state should have distinct visual treatment and audit records. A user should always be able to tell what will also be visible in Gmail.

## 4. Search

Superhuman's `/` search covers inbox, labels, and folders. It supports quoted exact matches, common Gmail-style operators, implicit `AND`, explicit `OR`, and `-` exclusions; recent cached messages remain searchable offline. [Search](https://help.superhuman.com/hc/en-us/articles/46005672652301-Search)

Ask AI adds natural-language search and analysis across email, calendar, and the web. Superhuman says it can search up to five years of mail excluding Spam and Trash, keeps up to 90 days of chat context, and can take days to complete initial indexing. [Ask AI](https://help.superhuman.com/hc/en-us/articles/46005676610829-Ask-AI)

Superhuman's MCP can search multiple linked accounts even though the UI lacks a unified inbox, but the user often has to explicitly request all accounts. [Superhuman Mail MCP Server](https://help.superhuman.com/hc/en-us/articles/46005696690317-Superhuman-Mail-MCP-Server)

### TAP decision

Use one search surface with two interoperable modes:

- deterministic structured search for known fields and operators;
- natural-language search that converts intent into visible, editable filters and can synthesize across threads.

In unified view, search all accounts by default. Results and summaries must show the exact accounts, date range, folders, and exclusions that were searched, along with partial-sync or authorization failures. This coverage receipt is essential to the promise that critical messages were not silently missed.

## 5. Compose, reply, drafts, sending, and follow-up

Superhuman's `Cmd/Ctrl+J` drafts or edits with AI. Its Instant Reply offers three contextual reply options, lets `Tab` cycle previews, and inserts the selected option into a normal editable draft. Accepting AI text does not send it. [Compose Quickly](https://help.superhuman.com/hc/en-us/articles/46005794144141-Compose-Quickly)

Auto Drafts generate response and follow-up drafts. They can offer multiple variants, insert explicit placeholders when facts are unknown, warn before sending if placeholders remain, refresh untouched drafts daily as context changes, and stop auto-updating after the user edits. [Auto Reminders & Auto Drafts](https://help.superhuman.com/hc/en-us/articles/46005658551053-Auto-Reminders-Auto-Drafts)

AI personalization covers greeting/signoff, role/company, writing style and length, scheduling preferences, event defaults, personal context, and knowledge sources. Past exchanges with a recipient are used when available. Personalization is currently tied to each account and cannot be shared across accounts. [Personalization](https://help.superhuman.com/hc/en-us/articles/46005802896781-Personalization)

Manual Reminders remove a conversation from the active inbox and return it at a natural-language date/time. Auto Reminders identify outbound messages that appear to need a follow-up, and Auto Drafts can prepare that follow-up before the reminder returns. [Clear Your Inbox](https://help.superhuman.com/hc/en-us/articles/46005796611341-Clear-Your-Inbox), [Auto Reminders & Auto Drafts](https://help.superhuman.com/hc/en-us/articles/46005658551053-Auto-Reminders-Auto-Drafts)

Send Later accepts a suggested or typed date/time. Smart Send can recommend recipient-specific timing from prior recipient activity and timezone data; an "if no reply" option can cancel a scheduled message and return it to draft if a response arrives first. [Switching from Notion Mail to Superhuman Mail](https://help.superhuman.com/hc/en-us/articles/47206763851533-Switching-from-Notion-Mail-to-Superhuman-Mail), [Smart Send](https://help.superhuman.com/hc/en-us/articles/46005572688525-Smart-Send)

Read Statuses report who opened a Superhuman-sent message, when, and on what device. Tracking is configured per account, Recent Opens is a follow-up feed, and Superhuman also exposes a setting to block known tracking pixels. [Read Statuses and Recent Opens Feed](https://help.superhuman.com/hc/en-us/articles/46005603745293-Read-Statuses-and-Recent-Opens-Feed)

Snippets support variables, unresolved placeholders with send warnings, attachments, team sharing, and send/open/reply metrics. [Snippets](https://help.superhuman.com/hc/en-us/articles/46005686571149-Snippets)

### TAP requirements

- autosaving provider-visible drafts with explicit provenance: human, Chloe, specialist, workflow, or imported;
- review-before-send as the default for all AI work;
- placeholder and missing-attachment validation;
- explicit From account/alias on every draft and send approval;
- Send, Send + Done, Send Later, Undo Send, and cancel-on-reply scheduling;
- a durable outbox with queued, sending, sent, failed, retrying, and conflicted states;
- Retry, Edit, Discard, and Copy diagnostics for failed sends;
- shared personalization with optional per-account and per-recipient overrides;
- transparent read-receipt consent and tracking-pixel controls rather than making tracking invisible.

## 6. Local cache, offline behavior, and speed

Superhuman currently documents caching every message opened, searched for, or received in the last 30 days, up to 1,250 messages per Split, plus automatic attachment downloads. Users can triage and reply offline; queued work synchronizes after reconnection with visible connection and progress status. [Offline Access](https://help.superhuman.com/hc/en-us/articles/46005499629325-Offline-Access)

Superhuman's published performance account targets sub-100 ms interaction latency and ideally sub-50 ms, using a local email database, caching, preloading/prerendering likely-next threads, minimal animation, keyboard shortcuts, and immediate feedback. [Built for Speed](https://blog.superhuman.com/superhuman-is-built-for-speed/)

Its published offline architecture models local actions as ordered, durable, idempotent modifiers layered optimistically over cached mail, retried after reconnection, and rolled back after permanent failure. That engineering article is old, so it is useful as a design principle rather than proof of the current implementation. [Architecting a web app to work offline](https://blog.superhuman.com/architecting-a-web-app-to-just-work-offline-part-1/)

Superhuman's design account links flow to immediately displaying the next message and rendering a selected email in under 32 ms. [Designing for Flow](https://blog.superhuman.com/how-to-design-for-flow/)

### TAP performance contract

Set explicit budgets and measure them on normal hardware:

| Interaction | Target |
|---|---:|
| Focused keyboard action reflected locally | <= 50 ms |
| Cached thread useful first paint | <= 50 ms; stretch goal <= 32 ms |
| Cached search useful first results | <= 100 ms |
| Open next likely thread during triage | No visible network wait |
| Optimistic action queue persistence | Before UI confirms completion |

Use an encrypted local relational index, encrypted bounded attachment store, and append-only/idempotent mutation queue. Prefetch the next and previous likely threads and summaries. Make cache horizon and attachment policy configurable; do not blindly copy Superhuman's automatic attachment download. Provide cache size inspection, per-account wipe, full device wipe, and remote revocation.

The installed macOS app inspected locally is version `1041.0.29`, bundle `com.superhuman.electron`, distributed as a signed/notarized Electron shell with a roughly 31 MB `app.asar`. Its package metadata includes `electron-store` and Superhuman push-receiver packages, and the main process references `mail.superhuman.com`. These observations do not establish how current message-cache encryption works, so the official behavior documentation above remains the source for product claims.

## 7. AI, critical-mail protection, summaries, and sentiment

Auto Summarize displays a one-line summary under the subject and expands to bullets with `I`. Superhuman excludes some non-primary/automated and extremely long messages from automatic summarization, although the user can request a manual summary. [Auto Summarize](https://help.superhuman.com/hc/en-us/articles/46005642123917-Auto-Summarize)

Auto Labels use built-in categories or custom natural-language criteria, and Auto Archive can keep selected low-value classes out of the active inbox. [Organize with AI](https://help.superhuman.com/hc/en-us/articles/46005852837773-Organize-with-AI), [Auto Archive](https://help.superhuman.com/hc/en-us/articles/46005662460813-Auto-Archive)

Superhuman's official MCP workflow guide recommends briefings grouped as Urgent, Important, FYI, and Noise, with one-line needs and draft replies. Its prebuilt MCP skills include Morning Briefing, End of Day Wrap-Up, Batch Draft Writer, Deal Tracker, and Meeting Scheduler. [MCP Use Cases](https://help.superhuman.com/hc/en-us/articles/46005872462605-Superhuman-Mail-MCP-Use-Cases), [Superhuman Mail MCP Server](https://help.superhuman.com/hc/en-us/articles/46005696690317-Superhuman-Mail-MCP-Server)

No dedicated sentiment inbox, longitudinal sentiment reporting, negative-tone escalation, or critical-email coverage audit was found in the official Mail AI catalog. The documented surface centers on Ask AI, Auto Archive, Auto Labels, Auto Reminders/Drafts, Auto Summarize, Instant Event/Reply, Knowledge Base, MCP, and Write with AI. [Superhuman AI Overview](https://help.superhuman.com/hc/en-us/articles/46005588676237-Superhuman-AI-Overview), [AI product page](https://superhuman.com/products/mail/ai)

### TAP's trust model for "never miss critical mail"

Every thread should have explicit, queryable derived fields:

- urgency and importance;
- requested action and response obligation;
- owner and due date;
- waiting-on party;
- relationship/VIP risk;
- sentiment and sentiment trajectory;
- financial, legal, security, health, people, or customer-impact tags;
- classifier confidence and human corrections;
- source accounts and synchronization coverage.

Critical detection should be a layered system, not one opaque score:

1. deterministic rules for VIPs, direct mentions, deadlines, security/billing/legal patterns, and known workflows;
2. model classification with visible rationale and confidence;
3. open-loop detection across sent mail, replies, reminders, and channel handoffs;
4. user feedback that changes future routing;
5. daily and weekly coverage audits that surface low-confidence and excluded mail.

Never claim perfect recall. Report an observable coverage receipt: accounts scanned, last successful history cursor, date range, excluded folders, sync failures, number of low-confidence threads, unresolved critical items, and aging response obligations.

Recommended daily/weekly summary measures:

- received, triaged, remaining, and auto-archived counts by account;
- critical/important messages and whether they were acknowledged;
- response-needed and overdue-response threads;
- waiting-on threads and reminders due;
- newly negative or sharply worsening sentiment, with evidence and confidence;
- commitments, decisions, risks, deadlines, and delegated owners;
- threads moved into TAP conversations and their current owners;
- inbox-zero state/streak per account and overall;
- classifier corrections and missed-item feedback;
- coverage or authorization gaps.

## 8. Delight, achievements, and healthy metrics

Superhuman rewards Inbox Zero with a changing full-screen image and a weekly streak; achievement progress is available from the command palette. [Achieve Inbox Zero](https://help.superhuman.com/hc/en-us/articles/46005833597709-Achieve-Inbox-Zero), [Inbox Zero Streaks](https://new.superhuman.com/level-up-with-inbox-zero-streaks-175912)

Superhuman says these images are designed for immersion, emotional reward, surprise, and habit reinforcement, including occasional event-specific details. [How Superhuman chooses Inbox Zero images](https://blog.superhuman.com/how-superhuman-chooses-inbox-zero-images/)

Publicly documented personal metrics are relatively narrow: Inbox Zero streaks and Snippet sends/open/reply performance. [Inbox Zero Streaks](https://new.superhuman.com/level-up-with-inbox-zero-streaks-175912), [Snippets](https://help.superhuman.com/hc/en-us/articles/46005686571149-Snippets)

### TAP decision

Reward control and reliability, not email volume. Candidate moments of delight:

- first zero and first all-account zero;
- zero with no unresolved critical items;
- one week with no overdue response obligation;
- closing an old loop or recovering cleanly after travel;
- improving classification accuracy through corrections;
- a calm end-of-day state with tomorrow's commitments prepared;
- a tasteful, low-motion zero screen that changes without becoming a distraction.

Avoid shaming, public leaderboards, streak-loss pressure, or incentives that encourage archiving without understanding. Let users disable or reduce celebration motion.

## 9. Collaboration and email-to-conversation handoff

Superhuman Shared Conversations expose a publisher's past and future thread messages plus internal comments. They can be shared directly or by link, and external guests can view/comment in a browser. `M` focuses the comment bar and `Cmd/Ctrl+S` shares or copies a link intended for Slack or Teams. [Shared Conversations and Team Comments](https://help.superhuman.com/hc/en-us/articles/46005593675917-Shared-Conversations-and-Team-Comments)

The sharing model is publisher-centric: future messages and visible subthreads can flow into the shared view; removed email recipients trigger warnings; individual participants cannot currently be removed; comments can be deleted by their author but not edited. [Shared Conversations and Team Comments](https://help.superhuman.com/hc/en-us/articles/46005593675917-Shared-Conversations-and-Team-Comments)

Shared Drafts update in real time, but only the original author edits while collaborators comment; sharing a reply draft shares the whole email thread. [Shared Drafts](https://help.superhuman.com/hc/en-us/articles/46005578703885-Shared-Drafts)

Team Reply Indicators show when a teammate is drafting or has a send scheduled to reduce reply collisions. [Team Read Statuses and Team Reply Indicators](https://help.superhuman.com/hc/en-us/articles/46005718826125-Team-Read-Statuses-and-Team-Reply-Indicators)

### TAP decision: `Bring to conversation`

This should be a first-class command and shortcut, not just a copied email link. The action should ask for only the decisions that affect information flow:

- immutable snapshot or live-linked thread;
- whether future email messages flow into the conversation;
- full thread, selected messages, or a redacted summary;
- destination channel and participants;
- whether the email specialist joins;
- whether replies in the conversation may create email drafts or only recommendations.

The created conversation should preserve source account, Gmail thread/message IDs, sharing scope, redactions, attachment policy, and a link back to the original. Membership changes must be reflected in access; participants should be individually revocable. A warning is required when channel membership is broader than email recipients or when future mail may contain new sensitive participants/content.

## 10. Chloe panel, email specialist, tools, and MCP

Superhuman's remote MCP exposes account management, structured and semantic search, thread/message/attachment reads, labels/splits, draft creation/edit/discard, send/schedule/Smart Send/undo, thread mutation, unsubscribe/block, read statuses, availability/calendar actions, and personalization. It supports multiple accounts but defaults unspecified actions to one account and advises users to name the account explicitly. [Superhuman Mail MCP Server](https://help.superhuman.com/hc/en-us/articles/46005696690317-Superhuman-Mail-MCP-Server)

Superhuman strongly recommends confirmation for send because its MCP can dispatch immediately. Enterprise MCP is disabled by default. The MCP is remote, so returned mail data is processed under the external AI provider's policies rather than Superhuman's built-in-AI subprocessor commitments. The docs say there is currently no MCP-specific audit log or identifier distinguishing MCP actions from human actions, and attachment sending is not supported. [Superhuman Mail MCP Server](https://help.superhuman.com/hc/en-us/articles/46005696690317-Superhuman-Mail-MCP-Server)

### TAP operating model

Most mail work should happen directly in the TAP Email surface inside the Chloe panel: keyboard triage, search, read, reply, remind, label, move, bring to conversation, and open summaries. The email specialist should appear when work becomes multi-step or cross-system: a morning briefing, missed-mail audit, batch drafting, weekly sentiment review, account recovery, deal/customer history, or complex scheduling.

The panel, workflows, MCP, and specialist must call the same domain services and produce identical state and audit events. There must not be a "tool draft" silo separate from a "UI draft" silo.

Recommended tool surface:

- accounts: list, connect, disconnect, health, sync coverage;
- mailbox: list/search threads, get thread/message/attachment, list labels/views;
- triage: archive/unarchive, read/unread, star, label, remind, mute, spam, unsubscribe, trash;
- drafts: create, update, discard, validate, share, attach;
- send: preview, send, schedule, cancel, undo, outbox status;
- intelligence: summarize, classify, explain, correct, find open loops, sentiment history;
- workflows: daily briefing, end-of-day wrap, weekly missed-mail audit, batch draft;
- conversations: create from email, add snapshot/live link, update sharing, revoke participant, unlink;
- stats: per-account and aggregate metrics with coverage metadata.

Every write must carry an immutable `account_id`; no write should silently use a default account. Every mutation needs an idempotency key, authorization scope, provenance, preview/dry-run representation, audit event, and undo metadata. Separate permissions for read/search, draft, mailbox mutation, send, destructive actions, cross-account analysis, and cross-channel sharing. Sending, destructive actions, and broadened sharing require explicit confirmation unless the user has granted a narrowly scoped, auditable automation policy.

## 11. Security, privacy, and administration

Superhuman's DPA says Mail is hosted on GCP, uses provider OAuth2 rather than storing provider credentials, and applies TLS 1.2+ in transit, AES-256 at rest, Cloud KMS, least privilege, MFA/RBAC, environment separation, and regular security practices. [Superhuman DPA](https://superhuman.com/legal/dpa)

Enterprise BYOK currently covers email and AI-derived data in Superhuman's Turbopuffer AI-memory layer, not all transactional databases, logs, or AI systems. Revoking the customer-managed Google Cloud KMS key pauses dependent AI features while core email continues. [Bring Your Own Key](https://help.superhuman.com/hc/en-us/articles/46005802988813-Bring-Your-Own-Key-BYOK)

Ask AI indexes mail through a third-party vendor. Superhuman documents encryption in transit/at rest, 90-day retention for Auto Summarize/Instant Reply queries and responses, and retention of Ask AI queries/responses for quality and debugging. [Ask AI](https://help.superhuman.com/hc/en-us/articles/46005676610829-Ask-AI)

The Mail AI page says AI use is opt-in, LLM providers have zero-day data retention, and providers may not train on customer data. [Superhuman Mail AI](https://superhuman.com/products/mail/ai)

Enterprise provisioning supports SCIM, but Superhuman says its SCIM integration does not manage groups or roles. [User Provisioning (SCIM)](https://help.superhuman.com/hc/en-us/articles/46005519038093-User-Provisioning-SCIM)

### TAP security requirements

- encrypted local message/index and attachment storage with keys in the OS credential vault;
- independently revocable OAuth tokens per account;
- configurable cache horizon/size, attachment policy, inspection, export, and wipe;
- remote device revocation and cache invalidation;
- strict separation and retention policies for raw mail, derived features, embeddings, workflow history, and audit logs;
- no-training default and clear model/subprocessor disclosure;
- least-privilege OAuth/tool scopes;
- per-action audit provenance for human, Chloe, specialist, workflow, and external MCP client;
- explicit consent before sending mail data to a channel, specialist, workflow, or external model;
- redaction and data-loss-prevention checks before broader sharing;
- enterprise controls for AI, MCP, workflow scheduling, external sharing, retention, and account connection.

## 12. Google API constraints that shape the implementation

Google recommends an initial full synchronization followed by partial synchronization through `history.list`. Full sync should list IDs, batch message/thread fetches, cache full contents once, and later use minimal responses when only labels may have changed. If a stored `historyId` is outside Google's available range and returns HTTP 404, the client must perform a new full sync. [Synchronize clients with Gmail](https://developers.google.com/workspace/gmail/api/guides/sync)

Gmail supports Cloud Pub/Sub mailbox watches for backend notification delivery; each watch must be renewed at least every seven days, with daily renewal recommended. Google still recommends poll-based synchronization for user-owned devices, and push notifications identify a history position rather than delivering the changed content itself. [Configure push notifications](https://developers.google.com/workspace/gmail/api/guides/push)

Labels belong to messages. A thread's label list is the union of labels on its messages; applying a label to a thread affects existing messages but not messages added later. Draft messages cannot carry user labels. [Manage labels](https://developers.google.com/workspace/gmail/api/guides/labels)

A Gmail draft is a stable draft resource whose contained message is replaced on edits. Sending deletes the draft and creates a new message with a new ID and the `SENT` label. [Create and send draft emails](https://developers.google.com/workspace/gmail/api/guides/drafts)

Broad Gmail access uses restricted OAuth scopes. Google requires restricted-scope verification, and storing or transmitting restricted-scope data on servers requires a security assessment. [Choose Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)

As of Google's June 2026 documentation, Gmail API quotas are measured per project and per user/project, method costs vary substantially, and sending methods are expensive relative to listing/history calls. The API also applies the provider's normal per-user sending limits across all clients. [Gmail API usage limits](https://developers.google.com/workspace/gmail/api/reference/quota), [Resolve Gmail API errors](https://developers.google.com/workspace/gmail/api/guides/handle-errors)

Gmail HTTP batches may contain at most 100 calls, batches over 50 are not recommended because they are more likely to trigger rate limiting, each inner call still counts against quota, and execution order is not guaranteed. [Batch requests](https://developers.google.com/workspace/gmail/api/guides/batch)

### TAP architectural consequences

- maintain a separate cursor, queue, throttler, and health state for each Google account;
- use backend Pub/Sub to wake the platform when appropriate, but keep the client able to recover through history polling;
- persist optimistic mutations before acknowledging them in the UI;
- reconcile idempotently and show conflicts rather than silently choosing a winner;
- treat draft-to-sent as an identity transition, not an in-place state change;
- reapply thread-level TAP label intent when a new Gmail message joins a thread if the product semantics require inheritance;
- implement backoff and per-user concurrency control;
- design OAuth verification and third-party security assessment as launch dependencies, not post-launch cleanup;
- keep raw Gmail API access behind one provider adapter so future providers do not leak provider semantics through the TAP domain model.

## 13. Recommended phased product boundary

### Daily-driver launch bar

- multiple Google accounts, unified and single-account views;
- encrypted local cache, offline read/triage/draft, durable mutation queue, visible sync health;
- full keyboard navigation, command palette, remappable shortcuts, undo;
- inbox-zero loop with Done, Today, Reminder, Move, and automatic next thread;
- structured search across all connected accounts;
- compose/reply/forward, attachments, provider-visible drafts, aliases, signatures, Send + Done;
- safe outbox, scheduled send, cancel, retry, and undo send;
- priority/critical/response-needed classification with explanations and corrections;
- daily briefing and end-of-day open-loop review;
- direct Bring to conversation;
- shared panel/tool/MCP domain API with explicit account IDs and action provenance;
- lightweight delight and per-account/aggregate Inbox Zero progress.

### Next layer

- semantic Ask Email search and cross-thread synthesis;
- Auto Drafts, follow-up drafts, shared personalization, snippets;
- weekly missed-mail, commitments, sentiment, and relationship reports;
- specialist-led batch workflows;
- read receipts and tracking-pixel privacy controls;
- shared drafts, comments, and reply-collision indicators;
- delegated mailbox support after the core direct-account model is reliable.

### Do not copy

- separate account tabs as the primary multi-account model;
- implicit default-account writes from tools;
- all-or-nothing or opaque AI activation;
- non-customizable shortcuts;
- automatic unbounded attachment caching;
- sharing future mail without an explicit live/snapshot decision;
- gamification that rewards sending or archiving volume;
- AI claims about "never missing" mail without coverage, confidence, and failure reporting.

## 14. Decisions for the requirements interview

The research supports resolving these next, one at a time:

1. What exact state counts as "Inbox Zero" in the unified view: every account at zero, or no remaining actionable/critical threads even if FYI queues remain?
2. Which thread classifications are launch-critical, and which may wait for weekly workflows?
3. Should a Reminder exist only in TAP or also create a visible Gmail label/calendar artifact?
4. What should be the default for `Bring to conversation`: immutable snapshot or live-linked thread?
5. Who can see a conversation created from private email, and how should channel membership changes affect it?
6. Which tool actions can Chloe perform without confirmation, and which always require approval?
7. What data may leave the device for summarization/classification, and what retention is acceptable?
8. How much mail and which attachments should be cached by default?
9. Should aliases behave as identities within one account for summaries, safety, and achievements?
10. Is Gmail delegated-mailbox support required for the first daily-driver release?

