# ADR 0004: User-launched Email workflow shells

## Status

Accepted and implemented for the user-launched slice; recurring scheduling remains unavailable in SDK 0.15

## Date

2026-09-14

## Context

TAP Email needs visible, user-launched Morning Brief, EOD Wrap, Daily Rollup, Missed Mail Audit, Prepare Follow-up Drafts, Mail Merge, and Email Activity Summary workflows. The current public SDK can list and invoke saved workspace workflows and can observe a run when the host exposes `getRun` or `subscribeRun`. It cannot create saved workflows or recurring schedules.

Mailbox reports also need stronger truthfulness than an arbitrary UI summary. Each run must say which accounts, mailbox resource, and half-open time range it inspected, and must carry the matching synchronization coverage. Email Activity Summary has a different privacy boundary: it must reuse the existing content-free committed-action aggregate rather than mailbox content.

Not every navigation destination is a reportable mailbox resource. Auto Archived, Scheduled, Outbox, and Snippets are TAP-owned views backed by dedicated state (or by no model yet), not the normalized thread-history table. Treating a zero thread match in one of those views as complete mailbox coverage would be false.

Mail Merge is the highest-risk workflow in this slice. A bulk-send shortcut would make a review mistake consequential across many recipients, and provider retry ambiguity could duplicate messages.

## Decision

Add an Email Workflows surface with a current state of `accepted`, `running`, `succeeded`, or `failed` for each launched run.

The five mailbox-report workflows invoke an existing saved workspace workflow whose stable ID or type is `tap-email.<kind>`, with an exact-name fallback for current hosts. Their payload is bounded to 90 days and 250 matching conversation metadata records. It includes:

- selected TAP account IDs;
- selected mailbox resource;
- inclusive start and exclusive end instants plus IANA timezone;
- a receipt with every selected account's sync state, observation time, backfill boundary, unresolved failure count, warnings, and a fail-closed `complete` flag;
- bounded subject, sender label, and snippet metadata plus aggregate counts.

Mailbox-report resource scope is an explicit allowlist of Inbox, Starred, Drafts, Sent, Done, Reminders, Spam, Trash, Critical, Needs response, and Waiting. Auto Archived, Scheduled, Outbox, and Snippets are omitted from the report selector and rejected by payload validation until each has its own auditable coverage contract. The UI explains this limitation instead of returning a complete zero.

Email Activity Summary invokes its saved workflow with `summarizeEmailActivity` over the existing installation-local `activity/v1` projection. The payload includes action and outcome counts and exact coverage only. It excludes subjects, bodies, recipients, correspondents, account/thread/message IDs, and event timelines.

Mail Merge is a separate, review-gated provider-draft path:

1. A user supplies one explicit From account, at most 25 unique recipients, and subject/body templates of at most 100 KB each.
2. TAP Email expands only `{{name}}` and `{{email}}`, creates an immutable recipient-level plan, and computes SHA-256 digests for every draft and the whole plan.
3. The UI shows every personalized recipient draft. The user must explicitly grant review against the exact draft digests; the grant expires after 30 minutes.
4. The plan produces stable recipient-level command and idempotency keys.
5. TAP Email submits only `save_draft` commands, sequentially. It never produces or submits `send_draft` from this workflow.
6. Failed, uncertain, cancelled, or excessively long pending outcomes stop the sequence and state that no messages were sent. Successful drafts remain provider-visible and individually reviewable.

The explicit review grant is enforced by the app-side plan/command boundary available today. A future remotely invokable Mail Merge tool must move this check to a non-bypassable host or coordinator boundary before it can be exposed.

## Honest SDK limitations

- SDK 0.15 cannot create the named saved workflows. If one is absent, the launch visibly fails instead of simulating success locally.
- SDK 0.15 has no recurring-workflow scheduling operation. Morning Brief, EOD Wrap, and Daily Rollup are user-launched in this release. OS notifications are not used as a scheduler.
- Some hosts may omit both run observation APIs. In that case a successfully invoked run remains visibly `accepted`; TAP Email does not infer completion.
- Host run status strings are versioned. Known terminal success/failure strings are mapped; unknown strings remain `accepted` rather than being treated as success.
- Mail Merge does not send, schedule, or parallelize messages. Provider draft creation is the only supported effect.

## Consequences

- Users get useful workflow entry points now without inventing unsupported SDK operations.
- Reports carry an auditable scope and coverage receipt, including partial-history warnings.
- Activity rollups preserve the existing content-free privacy boundary.
- Mail Merge is intentionally slower and more deliberate, with bounded blast radius and provider-visible review artifacts.
- Recurring runs and remotely callable workflow creation remain future host/SDK work.
