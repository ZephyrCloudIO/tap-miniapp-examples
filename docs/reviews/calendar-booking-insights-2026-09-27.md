# Calendar booking insights review

## Data investigation

The reported screen compared four recent visits with twelve historical bookings.
Read-only production aggregates confirmed that all twelve bookings preceded the
start of visit tracking (September 24, 2026, 9:51 PM Eastern). The four recorded
visits happened afterward. None had a confirmed booking linked to it.

The scoped conversion calculation, 0 booked visits / 4 recorded visits, is correct.
The UI made it appear inconsistent by putting historical booking counts in the
same funnel. Historical visits were never recorded, so an all-time conversion
rate cannot be reconstructed. No production records or counters were changed.

## Information architecture review

| Finding | Change |
| --- | --- |
| The funnel mixed visits, booking requests, and current booking status. | Visit progress contains visit counts only. Historical requests and status totals have a separate “All-time bookings” section. |
| The reporting period was buried in a dense paragraph. | Conversion and activity each show their start date beside the section heading. Cards and page summaries use the conversion period consistently. |
| “Confirmed” could mean a visit, a booking, or a current status. | Conversion uses “Booked visits” and an explicit “0 of 4 visits” explanation. The status section shows confirmed, cancelled, awaiting approval, declined, and expired requests. |
| Traffic and conversion coverage can start at different times. | Only append booked visits to the activity funnel when both periods match. Otherwise show conversion separately with its own period. |
| Empty, unavailable, preview, and measured-zero states were ambiguous. | No traffic displays an em dash and a sharing prompt. Missing data displays an unavailable message. Local previews do not invent a live conversion rate. |
| Metric definitions competed with the main result. | Keep the historical-data limitation visible; move detailed counting rules into a keyboard-accessible disclosure. |
| “Published URLs” counted profile landing pages alongside the visible event pages. | “Live booking pages” counts the event pages using the same publication check as their Live badges. A profile with two live event pages now shows two. |

## Visual design review

Reviewed against the [Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines/blob/main/command.md).

- Removed the nested page container that created excessive dialog padding.
- Made conversion the primary number, with readable labels and neutral styling.
- Replaced oversized arrows with aligned progress rows, proportional bars, and
  tabular counts. Mobile keeps the labels and counts without squeezing bars in.
- Aligned booking status counts in a responsive grid and kept labels with values.
- Replaced the full-width primary “Done” action with a compact SDK outline button.
- Preserved bottom padding and aligned card actions across empty and populated pages.
- Aligned Shared bookings with the surrounding sections: 25px outer gutters on
  desktop and 15px below 900px, with matching vertical spacing. Verified both
  desktop and 390px layouts without horizontal overflow.
- Kept semantic headings, definition lists, visible focus, and Escape dismissal.
  The modal focus trap includes the new disclosure, and closing restores focus
  to the Insights button.

## Verification

- Browser review of the actual components in dark and light themes; desktop,
  390 × 844, and 320 × 720 viewports. No horizontal overflow in the mobile dialog.
- Checked populated, no-traffic, and unavailable states; expanded definitions
  with the keyboard; verified focus containment, dismissal, and focus restoration.
- Mobile footer retained approximately 14px below the Close button after scrolling.
- Calendar: 333 unit tests, typecheck, production miniapp build, and manifest check.
- Gateway: 18 public booking route tests, including a regression with twelve
  pre-tracking bookings and four later visits. Existing cases cover retries,
  multiple bookings per visit, cancellation, and mismatched coverage periods.

The analytics changes use the existing v2 analytics API. The workspace host
changes below require a gateway deployment before the miniapp update, with no
new database migration. Calendar remains version 0.3.6 in this pending release.

## Booking page management

The cards previously offered Preview and Insights but had no edit or individual
offline action. Each card now exposes Edit and Take offline; an offline page has
a Publish action. The shared form starts with the saved settings and keeps a
published slug read-only. Domain mutations also enforce the reserved URL and
retain current analytics, publication receipts, and existing calendar events.

Taking a page offline sends the existing authoritative profile publication with
that page omitted. Other active pages stay published. Republishing uses the same
page identity and reserved URL. A failed update remains visibly pending with a
retry action, and the current live URL/count follow the last server receipt.

Verified the edit/provider-change/save, offline, and republish flows in a local
preview using the real publication reconciler and a simulated gateway. Reviewed
desktop and 390px card/form layouts, the failure message, and focus restoration.
Five new UI/domain tests cover these flows, failed persistence, failed publishing,
and taking a page offline after calendar disconnection. All 19 gateway publication
tests pass, including restoring the same page while keeping its prior revision.

## Claimed workspace profile

After a confirmed name claim, replace the setup form with a read-only summary:
a checked “Name claimed” label, display name, reserved URL, Copy link, and explicit
booking readiness. A claimed name with no meetings shows the next setup step;
it does not say that the workspace is accepting bookings. Offline and stale
publications retain the claim while showing their actual publication state.

Edit profile opens the saved settings. Save changes returns to the summary;
Cancel discards the draft. The reserved URL stays fixed, and saving an offline
profile keeps it offline. SDK buttons expose the actions, and keyboard focus
moves to the name field on edit and back to Edit profile after Save or Cancel.

Verified desktop and 390px/320px layouts with no horizontal overflow. Seven new
UI tests cover the claim transition, explicit edit/cancel, saved name and URL,
offline edits, failed claim/edit retries, and confirmed versus stale meetings.
All 333 Calendar tests, typecheck, production build, and manifest validation pass.

## Workspace hosts and Zoom readiness

The host picker now uses all joined workspace members from the SDK roster,
including people who have not opened Calendar. The manifest declares the SDK's
`workspace.read-members` authority. Gateway metadata supplies each member's
Calendar, availability, and Zoom readiness; it does not supply provider secrets.

Removed the separate shared-booking enrollment step. Opening Booking pages syncs
the caller's connected Google calendar and saved availability. Missing Calendar
setup is visible beside each host and blocks publishing a meeting that needs
them. Availability is never invented for another member.

Zoom readiness belongs to the selected organizer. Choosing an organizer without
Zoom shows their name and connection guidance, and blocks publication. Switching
to an organizer with Zoom clears the error. Other required hosts do not need
Zoom. The gateway also validates the organizer's connection when publishing.

Verified the real editor at desktop and 390px widths without horizontal overflow,
including the missing-Zoom error, organizer change, enabled Save, and completed
summary. Seven additional Calendar tests cover roster merging, automatic sync,
policy comparison, and Zoom validation. Twelve collective-booking gateway tests
and five organizer-authorization tests pass, alongside both typechecks, the
miniapp production build, and manifest validation.

Deploy the updated gateway before installing Calendar 0.3.6. No new D1 migration
is needed for host readiness or workspace roster support.
