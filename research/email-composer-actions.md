# Email composer actions

Implemented against miniapp SDK 0.19.0, including the Calendar booking-link
contract from [issue #107](https://github.com/ZephyrCloudIO/tap-miniapp-examples/issues/107).

## Composer inputs and toolbar

New messages, inline replies, and sidecar replies share SDK input controls and
action buttons. From uses SDK Select. Recipient fields suggest past sent To/Cc/Bcc
addresses from all connected accounts, with a local outgoing-history fallback.
Cc and Bcc start collapsed and can be revealed independently; populated fields
stay visible. The body has no colored field background or focus border. An
expandable signature preview sits below it; the coordinator adds the verified
platform attribution at send time, once.

Send, Send later, Remind me, Share draft, and Share availability are text actions. Write with AI and
Attach use labelled icon buttons. The toolbar wraps on narrower surfaces.

## Send later and follow-ups

Send later reuses the durable coordinator schedule pipeline. Clearing the custom
time disables submission, confirmation rechecks the current time, and the picker
shows its timezone. Reply schedules retain cancellation on a newer reply.

Remind me stores a duration (1–365 days) and If no reply or Regardless with the
draft. The timer starts from acknowledged delivery, including the real sent time
when reconciling an uncertain outcome. Gmail message/thread identity and reminder
activation are checkpointed together. Stable per-draft reminder IDs prevent
retries from duplicating, restarting, or resurrecting cancelled reminders.
Scheduled sends carry the same intent. Saving, failing, cancelling, or undoing an
unsent message does not activate it. Existing Reminders and Scheduled views
continue to manage these items.

Deploy coordinator migrations `0017_recipient_history.sql` and
`0018_sent_follow_up.sql`, then the coordinator, then the miniapp. Existing
accounts perform one complete recipient-history backfill on their next sync.
Suggestions grow as the paginated backfill completes.

## Share draft

The SDK channel picker previews a frozen snapshot of the unsent subject, To/Cc,
and body. Bcc and attachment bytes are excluded. Posting requires an explicit
Share to channel action. Discussion happens in that channel; this is not a live
collaborative editor or an email send.

The destination and exact snapshot determine a stable `clientMessageId`. SDK
storage holds content-free delivery receipts. Retrying a lost response uses the
same identity; changing the draft or destination creates a new shared version.
A receipt-save failure after a successful post reports success with a warning.
The picker resets when the owning workspace changes.

## Write with AI

The wand or Command/Ctrl+J opens inline instructions and an SDK model picker.
Available models come from `sdk.inference.listModels`; the first is initially
selected. `sdk.inference.send` uses the real owning conversation from the SDK's
live `surfaceContext.owner` subscription. If no conversation is selected, the UI
explains what is required. A workspace/draft ID is never substituted for a
conversation ID.

Instructions, subject, and current body form a bounded text-only request. Email
text is treated as untrusted data. The result is an explicit proposal with Use
draft, Try again, and Discard. Generation does not send or automatically replace
the draft. Edits made during generation disable stale application. Dismissal or
ownership changes ignore late results. Applying uses normal edit/autosave paths.
The manifest declares direct-human `inference.list` and `inference.invoke` access.

## Calendar integration

Share availability queries the Calendar gateway through the supported SDK HTTP
bridge, even when Calendar is closed. It lists the current user's published pages
in the owning workspace, revalidates the selected publication, and inserts its
stored canonical URL at the saved cursor. See the [booking-link contract](../docs/calendar-booking-links.md)
for identity and publication-state guarantees, verification, and deployment order.

## Verification

Unit/integration coverage uses SDK and Gmail doubles for recipient history,
draft preservation, scheduling validation, delivery reconciliation, reminder
idempotency, channel snapshot retry behavior, AI proposal review, and live owner
changes. Browser checks use the local preview with fixture emails; live sending,
channel posting, model invocation, and deployment are not part of verification.

The Test Lab descriptor names the inference capabilities and records temporary
coverage waivers expiring 2026-12-31: its surface profile lacks an owning
conversation and deterministic inference fixture. Host inference integration
remains unverified; these waivers do not grant runtime permissions.
