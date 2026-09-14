# Superhuman Core Features & Workflows audit for TAP Email

**Reviewed:** 2026-09-14  
**Scope:** the first-party [Superhuman Core Features & Workflows](https://help.superhuman.com/hc/en-us/sections/46130641632525-Core-Features-Workflows) section and the current TAP Email implementation. The supplied screenshots are treated as observed product evidence, not as instructions or as proof of provider state.

## Executive finding

The reported Done behavior is a correctness bug, not a naming ambiguity.

Superhuman defines **Done** as archive: the conversation leaves Inbox, is not deleted, remains searchable, appears in Done, maps to **All Mail in Gmail**, and returns to Inbox when a new reply arrives. `E` performs the action and `Z` immediately undoes it. [Mark Done](https://help.superhuman.com/hc/en-us/articles/47439134613773-Mark-Done)

TAP Email's intended path matches that contract on paper:

1. [`markDone`](../apps/tap-email/src/domain.ts) optimistically sets the selected thread to `done`, removes its provider-neutral `inbox` membership, and queues an `archive` command.
2. The UI holds that command for the five-second undo window before submission. [`app.tsx`](../apps/tap-email/src/app.tsx)
3. The Gmail adapter implements `archive` by calling `threads.modify` with `removeLabelIds: ['INBOX']`. [`google.ts`](../apps/tap-email-coordinator/src/google.ts), [Gmail `users.threads.modify`](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.threads/modify)
4. The next mailbox snapshot derives Inbox membership from Gmail labels and maps an ordinary non-Inbox thread back to `done`. [`mailbox.ts`](../apps/tap-email-coordinator/src/mailbox.ts)

The screenshots show TAP Email and Gmail disagreeing after the action. The running implementation explains that exact state: TAP hides the thread optimistically, but the device-cache permission error prevents the command-persistence barrier from releasing the Gmail archive. The queued command also suppresses periodic refresh, so the false local Done state can persist indefinitely. Separate defects kept failed archive receipts from restoring the row and delayed successful archive projection in the coordinator cache. The definition of Done was correct; its commit protocol and failure UI were not.

## Runtime diagnosis and repair

| Boundary | Finding | Repair in this pass |
| --- | --- | --- |
| Device durability | The presence of `sdk.storage.profile` was treated as a usable SQLite store even when `open()` was denied. A failed save left the optimistic row hidden while correctly blocking the provider write. | Done is blocked while the known device-cache prerequisite is unavailable; if permission is revoked after the action, the unsaved archive is removed and its Inbox before-state is restored. The error banner now has an explicit device-cache retry. |
| Provider settlement | `failed`, `cancelled`, and `uncertain` archive receipts removed the command and Undo entry without reversing the optimistic Done state. | Every non-applied archive settlement restores Inbox membership and selection; only `applied` retains Done. |
| Coordinator projection | Gmail archive was correct, but acknowledged commands updated only read/unread fields in D1. | The same fenced acknowledgement transaction now clears `in_inbox`, removes `INBOX`, clears incompatible triage fields, and advances the provider revision. |
| Queue handoff | If the first queue send failed after command persistence, an identical client retry did not re-enqueue the accepted command. | An exact duplicate with `state = accepted` and `dispatch_pending = 1` reattempts queue delivery without changing command identity. |

The production coordinator is also a launch blocker at review time: `tap-email-coordinator.theaiplatform.app` returns Cloudflare error 1014 and the configured production Worker does not exist yet. Even correct client code cannot change Gmail through that endpoint until the Worker, bindings, secrets, migrations, and route are deployed.

## Required Done invariants

| Invariant | Required behavior |
| --- | --- |
| Provider mutation | For Gmail, remove only `INBOX`; do not trash or delete the thread. |
| Optimistic state | The row may disappear immediately, but it remains explicitly pending until the command has an `applied` receipt. |
| Failure | Restore the row to its previous queue and show a durable retryable failure, rather than leaving a local-only Done state. |
| Reconciliation | After `applied`, read fresh provider state and verify the thread no longer has Inbox membership. |
| Done/search | The archived thread remains available in Done and search. |
| New reply | A later reply that restores Gmail Inbox membership must move the thread back to the active Inbox automatically. |
| Undo | `Z` within the local grace window cancels the pending archive and restores selection. A submitted inverse action needs its own durable command/receipt. |
| Account safety | The mutation and verification use the same immutable account ID; unified Inbox must never guess an account. |

These follow Superhuman's provider-visible archive and return-on-reply contract. [Mark Done](https://help.superhuman.com/hc/en-us/articles/47439134613773-Mark-Done)

## Current coverage against the documented section

| Workflow | TAP Email status | Material difference |
| --- | --- | --- |
| Mark Done | **Implemented, runtime parity failing** | The code maps `E` to Gmail archive, but the supplied Gmail/TAP evidence shows that provider confirmation is not governing the final UI state. Superhuman also offers Send + Mark Done. [Mark Done](https://help.superhuman.com/hc/en-us/articles/47439134613773-Mark-Done) |
| Reply | **Incorrect for multi-person threads** | TAP ignores Reply-To and Cc, derives participants chronologically, and always chooses the first external participant. Both `Enter` and `R` use that path, so a thread started by Alice whose newest reply is from Bob can address Alice. Superhuman distinguishes `Enter` as Reply All and `R` as Reply and can target a selected earlier message. [Quick Quote](https://help.superhuman.com/hc/en-us/articles/46005692763661-Quick-Quote), [Reply to Email on Mobile](https://help.superhuman.com/hc/en-us/articles/46005712692877-Reply-to-Email-on-Mobile) |
| Remind Me | **Broken due lifecycle** | TAP creates pending reminders and has cancel-on-reply logic, but the UI exposes only `if no reply`. When due, the coordinator changes `pending` to `due` while still projecting the thread as `reminded`; Inbox explicitly excludes it, so it never returns to the top of Inbox. Edit, remove/return, `someday`, and a returned-reminder marker are also missing. [Remind Me](https://help.superhuman.com/hc/en-us/articles/46005666142733-Remind-Me) |
| Attachments | **Partial** | TAP can stage outbound attachments and save inbound files, subject to host save authority. It does not yet match click/open preview, PDF preview, PNG quick preview, Copy/Open Link, Include Original Attachments, or automatic attachment forwarding. [Attachments](https://help.superhuman.com/hc/en-us/articles/46005568142989-Attachments) |
| Drafts | **Persistence and resume gaps** | “Save and close draft” silently drops subject/body content when To is empty. Subjectless Send is enabled in the composer but rejected by the Gmail MIME adapter. Provider drafts appear in Drafts, but open in the ordinary reader and cannot be resumed or edited in TAP. |
| Failed sends | **Terminal dead ends** | Immediate failures can only retry the exact unchanged payload—there is no Edit, Discard, or Copy diagnostics. Failed/uncertain scheduled sends show “Needs attention” with no available action. |
| Labels and Move | **Backend primitive only** | The protocol and Gmail adapter have `apply_labels`, but labels are neither rendered nor actionable and there is no complete `L` toggle or `V` move-and-Done workflow. Superhuman keeps Label separate from archive and defines Move as label/folder plus Done. [Labels](https://help.superhuman.com/hc/en-us/articles/46005736546061-Labels) |
| Default Split Inboxes | **Missing as a configurable model** | TAP exposes fixed mailbox resources plus Critical, Needs response, and Waiting. It lacks the documented Important/Other, Team, VIP, News, Calendar, enable/hide/reorder behavior, and explicit total-count semantics. [Default Split Inbox](https://help.superhuman.com/hc/en-us/articles/46005619081101-Default-Split-Inbox), [Split Inbox Library](https://help.superhuman.com/hc/en-us/articles/46005691544973-Split-Inbox-Library) |
| Custom Split Inboxes | **Missing** | No saved rule builder combines sender, recipient, subject, label, or Auto Label criteria; no add-to-split, duplication policy, hide-when-empty, or reorder controls. [Custom Split Inbox](https://help.superhuman.com/hc/en-us/articles/46005636204941-Custom-Split-Inbox) |
| Mass archive | **Missing** | No Select All, Select All From Here, or Get Me To Zero workflow. Superhuman supports bulk Done and a seven-day reversal for Get Me To Zero. [Mass Archive](https://help.superhuman.com/hc/en-us/articles/46005611576589-Mass-Archive) |
| Unwanted mail | **Trash plus read-only Spam destination** | TAP can move a thread to Trash and display provider Spam, but it cannot report/not-report spam, unsubscribe, or block/unblock a sender or domain. [Dealing with Unwanted Emails](https://help.superhuman.com/hc/en-us/articles/46005635358349-Dealing-with-Unwanted-Emails) |
| Important/Other correction | **Missing** | TAP's derived attention queues have correction UI, but there is no provider-aware Important/Other workflow for one conversation, full sender, or domain. [Moving Conversations Between Important and Other](https://help.superhuman.com/hc/en-us/articles/46005707869965-Moving-Conversations-Between-Important-and-Other) |
| Mute | **Missing** | No Gmail Mute/Unmute command or Muted destination. [Muting Conversations](https://help.superhuman.com/hc/en-us/articles/46005597483661-Muting-Conversations) |
| Auto Archived / Snippets | **Misleading navigation shells** | Both appear as ordinary mailbox destinations and render “nothing here” copy even though their selectors always return false. Snippets has no template model, variables/placeholders, attachment reuse, sharing, or metrics. These views should be hidden or labeled unavailable until real models exist. [Snippets](https://help.superhuman.com/hc/en-us/articles/46005686571149-Snippets) |
| Workflow Center | **Availability and recovery gaps** | Cards show “Ready” and enable Run before checking whether the required saved workflow exists. Mail Merge says provider drafts are ready for review, but those drafts cannot be resumed in TAP. |
| Quick Quote / Instant Intro | **Missing** | Selecting message text cannot seed a quoted reply, and there is no one-step introducer-to-Bcc flow. [Quick Quote](https://help.superhuman.com/hc/en-us/articles/46005692763661-Quick-Quote), [Instant Intro](https://help.superhuman.com/hc/en-us/articles/46005674036877-Instant-Intro) |
| Send Later / Smart Send | **Send Later implemented; Smart Send missing** | TAP supports scheduling and cancel-if-reply. It does not recommend recipient-specific times or replace Send Later only when sufficient activity data exists. [Smart Send](https://help.superhuman.com/hc/en-us/articles/46005572688525-Smart-Send) |
| Auto Bcc | **Missing** | No per-account CRM Bcc setting or per-message removal. [Auto Bcc](https://help.superhuman.com/hc/en-us/articles/46005654497549-Auto-Bcc) |
| Out of Office | **Missing** | No per-account Gmail/Outlook responder editing or calendar-derived OOO prompt. [Out of Office](https://help.superhuman.com/hc/en-us/articles/46005626883725-Out-of-Office) |
| Read Statuses / Recent Opens | **Missing** | TAP tracks its own action activity, not recipient opens; there is no per-account tracking control or Recent Opens feed. [Read Statuses and Recent Opens Feed](https://help.superhuman.com/hc/en-us/articles/46005603745293-Read-Statuses-and-Recent-Opens-Feed) |
| Contact Pane | **Missing** | TAP shows message participants but has no contextual person pane, recent-correspondence links, or click-to-search/draft actions. [Contact Pane](https://help.superhuman.com/hc/en-us/articles/46005778939789-Contact-Pane) |
| Autocomplete / Autocorrect | **Missing** | Chloe can stage an editable draft prompt, but there is no inline completion acceptance/dismissal flow or language-aware autocorrect. [Autocomplete](https://help.superhuman.com/hc/en-us/articles/46005685782669-Autocomplete), [Autocorrect](https://help.superhuman.com/hc/en-us/articles/46005640149389-Autocorrect) |

Mobile-only mechanics are not counted as launch blockers because TAP Email's product contract is desktop-first.

## Ranked recommendations

1. **Finish and deploy provider-verified Done.** Ship the repaired durability, rollback, queue, and cache-projection path; add an installed-package end-to-end test covering TAP → Gmail archive → TAP Done → new-reply return. The production Worker/route must exist before this can pass.
2. **Make Reply and Reply All correct.** Preserve Superhuman muscle memory: `R` replies to the latest message sender, `Enter` replies to all appropriate To/Cc recipients, Reply-To wins, the account itself is excluded, and both can target a selected message.
3. **Make drafts genuinely resumable and lossless.** Save content before To is entered, align subject validation across UI/provider, recover failed autosaves, and open provider drafts in an editor rather than the reader.
4. **Give every failed send a way forward.** Immediate and scheduled failures need Edit, Retry when safe, Discard, Copy diagnostics, and explicit reconciliation for delivery-unknown outcomes.
5. **Complete the reminder lifecycle.** Due reminders must return to Inbox, cancel-on-reply must be tested, and users need `regardless`, edit, remove/return, `someday`, and an explicit returned-reminder marker.
6. **Finish Label and Move.** Ship `L` as apply/remove without archiving and `V` as move plus Done, render labels, and keep receipts exactly account-scoped.
7. **Complete outbound core actions.** Add Send + Done only after send acknowledgement, plus Forward with original attachment/provenance preservation, send-as aliases, signatures, and richer editing.
8. **Implement real configurable Split Inboxes and bulk triage.** Add Important/Other, Team, VIP, News, Calendar, custom rules, hide/reorder/count semantics, multi-select, Select All From Here, and a reviewable Get Me To Zero.
9. **Add unwanted-mail controls.** Unsubscribe, report/not-report Spam, sender/domain block/unblock, and Mute must remain semantically distinct from Done and Trash.
10. **Finish attachment open/preview and reply/forward preservation.** Keep save authority explicit, but support file-appropriate inline preview, Open/Copy Link, Include Original Attachments, and whole-message export.
11. **Remove false affordances before adding polish.** Hide or mark unavailable the Auto Archived/Snippets shells, preflight Workflow Center availability, and only then add Snippets, Quick Quote, Instant Intro, Smart Send, Auto Bcc, OOO, Contact Pane, tracking, autocomplete, and broader search grammar.

## Acceptance test for the reported bug

Given a Gmail thread currently carrying `INBOX`, when the user hits `E` in TAP Email:

1. TAP removes it optimistically and exposes an undo affordance.
2. After the undo window, exactly one account-scoped archive command is durably submitted.
3. The command reaches `applied`; any other terminal state restores the row and exposes retry/reconciliation.
4. A fresh Gmail read shows `INBOX` absent while the thread remains retrievable in All Mail.
5. TAP's refreshed Inbox omits the thread and its Done/search views can retrieve it.
6. When an external reply later adds `INBOX`, TAP returns the thread to the active queue on the next history sync.

That test captures the behavior Superhuman documents and the cross-client discrepancy shown in the supplied screenshots. [Mark Done](https://help.superhuman.com/hc/en-us/articles/47439134613773-Mark-Done)
