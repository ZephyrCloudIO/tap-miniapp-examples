# Calendar invitations: Superhuman primary-source review

Reviewed October 3, 2026. This is a product behavior and protocol review, not an implementation change. Personal details from the user's screenshots are omitted. Official product images were inspected locally but are not copied into the repository.

## Behavior confirmed by Superhuman

Superhuman supports responding directly from an email invitation. Its launch announcement explicitly documents keyboard operation: Tab selects Yes, and Enter submits the response. It also explicitly supports invitations received through aliases. The article's official demonstration shows a photograph-backed event card with an RSVP row containing **Yes, Maybe, No**, followed by **When, Where, Who**. The time row includes a date, start/end times, and a timezone abbreviation. These visual details are observations of the first-party demonstration, rather than claims about its current internals. [RSVP to Calendar Invites](https://new.superhuman.com/rsvp-to-calendar-invites-29117), [official demonstration](https://cloud.headwayapp.co/changelogs_images/images/big/000/005/966-8a53add3b1561fa62027169bc34a9d7b21c4ec59.gif).

Superhuman also renders calendar response messages as event cards and puts response notes above the invitation. The official example shows a declining attendee's note, a badge identifying who declined, and When, Who, and About fields. That example contains no RSVP row. This supports the distinction between displaying another attendee's response and offering the current user a response action, without documenting Superhuman's parsing rules. [Calendar RSVP Notes](https://new.superhuman.com/calendar-rsvp-notes-124205), [official response-card image](https://cloud.headwayapp.co/changelogs_images/images/big/000/037/245-92aa07a0857399327101f5fd7d6ab92519abbddf.png).

The current Help Center states that opening or hovering over an invitation shows the schedule for its day in the right sidebar. Desktop users can open today's day view with 0, open the week with 2, advance weeks with = or J, return with - or K, and return to today with T. These calendar-context J/K bindings should not be confused with mail-reader navigation. [Calendar Overview](https://help.superhuman.com/hc/en-us/articles/46005615985293-Calendar-Overview).

Superhuman additionally supports RSVP from its calendar view. The official image shows the same Yes, Maybe, No choices alongside event details. [RSVP from Superhuman Calendar](https://new.superhuman.com/rsvp-from-superhuman-calendar-287964), [official calendar RSVP image](https://cloud.headwayapp.co/changelogs_images/images/big/000/124/196-8c4fef73f0b53865c7ff566f5aac3cf11d8ad59f.png).

## Protocol facts that should guide the app

These are standards and provider facts, not evidence of Superhuman's implementation.

| Calendar message | Meaning | Appropriate reader behavior (our recommendation) |
| --- | --- | --- |
| `METHOD:REQUEST` | Organizer invitation, update, rescheduling, or reconfirmation | Render event details; offer Yes/No/Maybe when the current attendee needs to respond. |
| `METHOD:REPLY` | Attendee's response to a request | Render who responded and their participation status; do not treat another person's response as a new invitation to the current user. |
| `METHOD:CANCEL` | Organizer cancellation affecting an event or recurring instance | Show cancellation status and affected event details; do not offer attendance choices for the canceled event. |

REQUEST and REPLY are directed organizer-to-attendee and attendee-to-organizer respectively. REPLY participation values include accepted, declined, and tentative. UID and SEQUENCE distinguish a new invitation from an existing event's update. Cancellation can affect the whole series or an instance identified by RECURRENCE-ID. [RFC 5546 §3.2](https://www.rfc-editor.org/rfc/rfc5546.html#section-3.2).

Google Calendar distinguishes `needsAction`, `accepted`, `declined`, and `tentative` attendee states, plus attendee identity, self/organizer flags, and response comments. Map Yes/No/Maybe to accepted/declined/tentative using the correct attendee identity. [Google Calendar Events reference](https://developers.google.com/workspace/calendar/api/v3/reference/events).

Preserve UID, SEQUENCE, and RECURRENCE-ID when identifying event versions and recurring instances. A moved occurrence retains its original recurrence identifier. Date-time values can be UTC, local with TZID, or floating; floating values have no fixed timezone. DTSTART and DTEND can also be date-only. The app should preserve these distinctions rather than parse every value as the machine's local timestamp. [RFC 5545 §3.8.4.4](https://www.rfc-editor.org/rfc/rfc5545.html#section-3.8.4.4), [§3.2.19](https://www.rfc-editor.org/rfc/rfc5545.html#section-3.2.19), [§3.3.5](https://www.rfc-editor.org/rfc/rfc5545.html#section-3.3.5), [§3.8.2](https://www.rfc-editor.org/rfc/rfc5545.html#section-3.8.2).

## Supported expectation and limits

The screenshots' distinction is consistent with the sources: an acceptance notification should display a rich card identifying the responding attendee, while an actionable invitation should expose Yes/No/Maybe. The screenshots alone do not reveal the underlying METHOD or attendee identity, so the implementation must inspect actual calendar content and provider state.

Recommended behavior is to render structured details even when the only human-visible content is an ICS attachment; resolve the active account and its aliases before exposing response controls; show current/pending/failed response state; and avoid waiting for calendar sidebar data to display the card. Those are implementation recommendations. Public Superhuman materials reviewed here do **not** document MIME parsing, caching, backend APIs, cancellation UI, recurrence update precedence, optimistic response handling, or exact rules for hiding/reopening RSVP controls after a response.
