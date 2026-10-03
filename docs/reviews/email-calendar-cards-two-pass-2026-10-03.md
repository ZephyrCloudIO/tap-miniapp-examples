# Calendar invitation rendering and RSVP: two review passes

Reviewed against main `08865773bb91a42a9e0b379bdbda87ef0b7a4f7f` on October 3, 2026. Prepared miniapp version: **1.0.4**.

## Problem and observed installed behavior

The installed 1.0.3 reader has no calendar renderer. Andrea's acceptance notice contains an ICS attachment and no visible message body, so it displays only the attachment row. Research from the preceding work did not implement this feature. The new card follows the event-card and RSVP behaviors documented in [the primary-source review](../research/email-calendar-invitations-superhuman-2026-10-03.md).

Native TAP validation located the exact reported Andrea acceptance through mail search. Saving its attachment reached the host Save dialog but returned the generic attachment-export error; no local ICS file was produced. The original download decoder accepts only SDK binary responses, whereas the endpoint advertises `text/calendar`. That transport mismatch is a separate defect addressed here. It is not claimed to be the proven cause of the native Save error, since the installed SDK response could not be captured.

## Pass 1: reader, React, cache, and local persistence

- Added a bounded iCalendar projection and memoized reader component. REQUEST, REPLY, CANCEL, updated invitations, comments, safe location links, attendees and organizer details have distinct behavior. REPLY and CANCEL never expose RSVP. REPLY notices without the optional DTSTART still display a card and explain the absent time.
- Zoned and UTC instants display in the viewer's local timezone. Floating and unsupported timezone values preserve the original wall time and timezone instead of inventing an instant. All-day DTEND is exclusive. Unknown custom VTIMEZONE rules are preserved in replies but are not interpreted into an instant by the reader.
- Calendar queries belong to the existing miniapp-session QueryClient; their keys include account, thread, provider revision, message and resources. Attachment reads use the miniapp's SDK private-files cache and SQLite metadata. No host QueryClient is borrowed. Cold calendar attachments may need a download; cached reopening does not fetch them again. Failed projections offer an explicit retry.
- Resolved active-query eviction: budget pruning skips observed queries, avoiding deletion/refetch loops while a card is visible. Inactive results can be evicted. Strict Mode mounting and a cached reopen make **one loader call** in the component test.
- Resolved duplicate cards for identical inline and named ICS parts. Distinct resource bytes are verified separately, and identical parsed events render once.
- Captured immutable command timestamps outside the React updater. Pending and uncertain responses are guarded again at command creation, including rapid repeated activation. Keyboard events inside RSVP controls cannot propagate to mail navigation shortcuts.
- Response receipts live in the same private SQLite transaction as the command journal, independently of the mailbox cache. Recovery merges them, account removal clears them, and history is bounded to 500 records. A persisted uncertain receipt disables another response when the reader is reopened.

## Pass 2: coordinator, authority, transport, and send outcomes

- Added `calendar_rsvp` with message/resource/event identity, response, provider revision and captured TAP user/workspace context. The submission route verifies sender context before recording the durable command. Destination and attendee identity are resolved server-side; client-supplied recipients do not control delivery.
- The provider reads the exact profile/account/thread/message/resource tuple, validates bounded attachment bytes, reparses the calendar, and requires an actionable REQUEST for the connected account's exact email address. Acceptance notices, cancellations, forged event keys, missing identities, and superseded calendar messages fail before sending.
- Resolved the automatic mark-read race: a changed Gmail history revision is allowed only when the provider and stored message-ID sets remain identical. Newly arrived messages fail closed. A stored later calendar message also blocks responding to the older invitation.
- Replies preserve UID, SEQUENCE, recurrence identity and timezone definitions and contain only the responding attendee with METHOD:REPLY. They use the existing durable Gmail draft/send executor. Stable draft IDs are hashes of command IDs, so long identifiers and permitted punctuation cannot invalidate or collide through truncation. The provider draft lease uses the same key.
- Completed draft checkpoints acknowledge command replay without another provider call or send. Unconfirmed send outcomes remain terminal-uncertain; this feature does not introduce automatic resend or expose ordinary-send reconciliation as an RSVP operation.
- Resolved byte transport: the SDK request explicitly accepts `application/octet-stream`. The coordinator preserves the original MIME type in `X-TAP-Attachment-Type`; the client verifies that MIME type, exact size, untruncated binary encoding and final URL. Ordinary requests retain the endpoint's previous content type. This avoids lossy text decoding for calendar and text attachments.
- Activity records use the existing committed-action path and include `calendar_response_sent`.

## Validation

- Reader, protocol and coordinator type checks.
- **684 reader tests**, **278 coordinator tests**, and **19 shared-protocol tests** passed. An initial concurrent run timed out in the existing disk-backed mail-history UI test; a full reader rerun without the competing validation jobs passed. No timeout setting was changed.
- SDK package verification, private React-runtime verification, source-map verification, static TAP checks and TAP test type checks.
- Preview and miniapp package builds; coordinator production dry run, generated-type check and local startup profiling through Wrangler release checks. Local startup profile: 75.6 ms window, 50.4 ms active (including 8.7 ms GC); this is a development-machine startup measurement, not production RSVP or navigation latency.
- Browser validation used the actual ThreadMessageList and CalendarMessage components with synthetic ICS bytes. Desktop acceptance cards show attendee status and details without actions. A 390-pixel invitation card shows Yes/No/Maybe without horizontal overflow. Controls have a minimum height of 44 pixels.
- Local preview screenshots: `/tmp/tap-email-calendar-acceptance.png` and `/tmp/tap-email-calendar-invite-narrow.png`.

No real RSVP was sent. Native end-to-end validation of the fixed card remains a post-merge deployment/install check. This change adds invitation cards and sends standard organizer replies; it does not add a Google Calendar API integration, verified alias identity, a day/week schedule sidebar, or a confirmed update to the attendee's own Google Calendar event. Rendering does not require new Calendar OAuth scopes. Deploy the coordinator before loading the new miniapp release.
