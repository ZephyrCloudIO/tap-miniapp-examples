# Email composer actions

Implementation proposal, 2026-09-26. Based on the Email and Calendar source in this worktree, the installed miniapp SDK 0.15.0, and the local desktop host implementation. This document describes proposed work; it does not mean these additional actions have shipped.

## Shared composer toolbar

Use the same action component in new messages, inline replies, and the reply sidecar. Keep Send, Send later, Remind me, and Share draft as text actions on the left. Put Write with AI, Share availability, and Attach as labelled icon buttons on the right. At narrow widths, move secondary text actions into an accessible More menu. Use SDK Button, Select, Input, Textarea, and Dialog components.

Keep the message editor visually quiet. Open AI instructions inline above the body, retain the collapsed signature below it, and show a small removable reminder summary when configured. Dialogs and menus must return focus to their triggering action without resetting the draft.

## Action contracts

### Send later

Reuse `src/send-later-dialog.tsx`, `scheduleMessageDraft`, and the coordinator's existing durable `scheduled_sends` pipeline. The message is saved as a Gmail draft; the coordinator dispatches it at the selected time even when Email is closed. The existing Scheduled view supports cancellation. Replies can opt to cancel a scheduled message if a newer reply arrives.

Before extending the toolbar, fix the existing custom-time bug: clearing or entering an invalid custom time must invalidate the selection rather than retaining the previous date. Revalidate against the current time when confirming. Display the local timezone and give presets a clear SDK selection treatment. The existing audit records the missing preset layout and date-validation issue.

### Remind me

Offer a follow-up time and two conditions: **If no reply** (default) and **Regardless**. For composer follow-ups, store a duration measured from the actual send, such as two days; display “2 days after sending · If no reply.” An absolute-time option, if added, must remain later than a scheduled delivery time.

Persist the reminder intent with the draft and its send command. Activate it only after delivery is acknowledged or an uncertain delivery is reconciled as sent. Cancellation, undo-send, and failed sends must not create a follow-up reminder. Scheduled delivery carries the intent through to its eventual send.

Existing `remindThread` and `executeTapOwnedCommand` work only on an existing thread. A new compose has no final provider thread identity. Extend the acknowledged send result and durable provider checkpoint to retain the actual Gmail message ID, thread ID, and sent timestamp; create the reminder for that thread with an idempotent identity derived from the send. Recovering a previously sent command must return that same identity. Do not use whichever thread happens to be selected in the UI.

Reuse the existing `tap_reminders` pending/due/satisfied lifecycle and Reminders view. Reply detection must compare against the sent message baseline, including when mailbox synchronization observes a reply before reminder activation. Existing thread reminders can keep their current absolute-time behavior.

### Share draft to a channel

Open a searchable workspace-channel picker and show the exact snapshot to be posted: subject, To/Cc, and body. Keep Bcc and attachment bytes out of the default snapshot. Label it as an unsent email draft. The user posts it with **Share to channel**; the email remains editable and unsent.

Reuse `listConversationHandoffChannels` for discovery and `sdk.channels.sendMessage` for posting. The manifest already declares `channels.list` and `channels.send-message`. Keep a stable `clientMessageId` and persisted receipt for each selected destination and frozen draft snapshot so retries do not duplicate a post. A changed draft produces a new explicitly shared version.

The existing conversation handoff shares received-thread context. An unsent draft needs its own snapshot builder; it cannot reuse a received-thread deep link. Version one is a review snapshot with discussion in the channel. A live collaborative draft would additionally require durable draft IDs, revisions, access control, and a draft deep-link handler.

### Write with AI

Use an inline SDK Textarea opened by the wand button or Command/Ctrl+J. Enter generates; Shift+Enter adds a line. Support writing from instructions and rewriting the current body. Show the result with **Use draft**, **Try again**, and **Discard**. Applying a result uses the same update/autosave path as typing. Preserve the original and reject stale application when the user has edited the draft during generation.

Use `sdk.inference.listModels()` and `sdk.inference.send({ conversationId, model, messages, maxTokens, timeoutMs })`. Model selection comes from the available-model list and a saved preference. The current unary SDK returns a completed result; show a generating state rather than pretending it streams. Bound input/output sizes, handle timeouts and unavailable capabilities, and ignore late results after cancellation or unmount.

Send the user's instructions and necessary draft/reply context. Treat email text as data. Return body text without the platform signature; the existing signature helper appends that separately. Generation never sends the email, posts to a channel, or books a meeting.

Add `inference.list` and `inference.invoke` to the Email surface authorization and owner level, with the corresponding host effects. These action IDs are verified in the local desktop host. The SDK requires a real owning conversation ID, and the host checks it against the mounted conversation. `TapFederatedSurfaceMountContext.conversationId` is nullable for this workspace surface. The integrated experience therefore needs a valid host conversation context; enabling AI everywhere may require a host/SDK extension for workspace-owned inference. Do not substitute a workspace, channel, or draft ID for a conversation ID. The current Chloe action only stages a prompt in Chat and is not inline inference.

### Share availability

Open a picker of the user's published TAP Calendar booking pages, showing their title and duration. Insert the selected, verified public booking URL at the editor selection, followed by normal autosave. Command/Ctrl+Shift+A can open the picker. Calendar owns the booking rules, timezones, conflict checks, and eventual booking.

Calendar already has Booking Profiles, Event Types, publication receipts, `isEventTypePublicationLive`, and `publicBookingUrl`. Its UI enables copying a link only for a confirmed live page. Email should consume a small read-only contract returning `{ profileId, eventTypeId, title, durationMinutes, url }` for those pages, with an explicit empty state that points to Calendar setup.

That cross-app contract is missing today. SDK 0.15.0 has no generic surface-to-surface MCP caller; Calendar's tools currently expose cached event/availability reads and meeting-draft preparation, not a public-booking-link picker. The declared Calendar events are lifecycle/change notices, not request/reply services. Implement a supported host-mediated booking-link query/picker backed by Calendar's authenticated publication records. It must work when the Calendar panel is closed and enforce the signed-in user/workspace boundary. Do not directly read another app's private storage or guess a URL from unpublished slugs. A manual paste of a link copied from Calendar can be an interim option, but is not the integrated picker.

## Delivery order and verification

1. Share the toolbar and fix Send later validation/layout; preserve all existing compose/reply behavior.
2. Add inline inference and channel draft snapshots using existing SDK APIs, including manifest changes and conversation-context handling.
3. Add persisted send-linked reminder intent and provider identity reconciliation.
4. Add the Calendar-owned booking-link contract and Email picker. This is a dependency outside the Email-only UI scope.

Verify shared compose/reply keyboard and focus behavior, generation failure/stale results, correct channel destination/content and retry deduplication, valid versus cleared scheduling times, delayed/failed/undone sends, reminder activation exactly once after acknowledgement/reconciliation, and published versus paused/unpublished booking pages. Use injected SDK/provider doubles for tests; do not send live emails, post live channel messages, or create bookings during verification.

## Source anchors

- Email composer: `apps/tap-email/src/compose-dialog.tsx`, `reply-composer.tsx`, and `message-editor.tsx`.
- Scheduling and acknowledged send processing: `apps/tap-email-coordinator/src/index.ts`.
- Provider send/checkpoint behavior: `apps/tap-email-coordinator/src/google.ts` and `provider.ts`.
- Existing reminders and reply satisfaction: `apps/tap-email-coordinator/src/mailbox.ts`.
- Channel discovery and idempotent posting: `apps/tap-email/src/conversation-handoff.ts` and `conversation-handoff-receipts.ts`.
- Calendar publication state and URL sharing: `apps/tap-calendar/src/app.tsx`, `publication-state.ts`, `public-booking-publication.ts`, and `domain.ts`.
- SDK inference and surface context: installed `@theaiplatform/miniapp-sdk/dist/sdk.d.ts` and `surface.d.ts`.
- Verified host authorization/context checks: `/Users/zackarychapple/code/ze-agency-tauri/apps/desktop/src/lib/workspace-miniapp-host-actions.ts`.
