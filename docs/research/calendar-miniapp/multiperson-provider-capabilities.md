# Provider capabilities for collective booking links

Research date: 2026-09-19 (America/New_York).
Scope: Google Calendar API v3 and Microsoft Graph v1.0 capabilities for TAP Calendar links where **every selected host must attend**. This is primary-source research, not a deployed integration test. Recommendations below are design inferences, not provider guarantees.

## Result

Both providers expose enough data to implement collective availability. TAP must resolve each host to calendars it can actually read, intersect every host's booking schedule, subtract busy intervals, and recheck before creating the meeting. An attendee email alone does not establish calendar access. A successful event creation is not documented as a conflict-free reservation across participants.

The most reliable first release is an explicit set of TAP hosts, each with a verified calendar connection and selected conflict calendars. One organizer owns the provider event; the remaining hosts are required attendees. Arbitrary external invitees can receive invitations, but their availability cannot be guaranteed without their own connection or a verified sharing arrangement.

## Google Calendar

### Free/busy and permissions

`POST /calendar/v3/freeBusy` accepts multiple calendar or group IDs and returns busy intervals per calendar, including per-calendar/per-group errors. Intervals have an inclusive start and exclusive end. `calendarExpansionMax` permits at most 50 calendars; `groupExpansionMax` permits at most 100 members per group. Expanding a group does not bypass the total-calendar limit. The API returns busy time, not working hours. Missing/error responses must remain unknown rather than be treated as empty busy lists. ([freeBusy.query](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query))

Google distinguishes `calendar.freebusy` (the user's own calendars) from `calendar.events.freebusy` (calendars the user can access). The broader `calendar.readonly` and `calendar` scopes are also accepted by `freeBusy.query`. Discovering subscribed calendars can use `calendar.calendarlist.readonly`. Writing meetings needs an appropriate event-write scope in addition to availability access. Scope consent must match the actual read/write operations; a free/busy scope does not grant arbitrary calendar ownership or access. ([scope reference](https://developers.google.com/workspace/calendar/api/auth))

A calendar ACL can grant `freeBusyReader`, which reveals availability without event details. Access can be granted to a user, group, domain, or the public. Workspace administrators can restrict sharing, including sharing outside the domain. Sharing a calendar does not automatically add it to the recipient's `CalendarList`, so discovery solely from subscriptions can miss an accessible calendar. ([calendar sharing](https://developers.google.com/workspace/calendar/api/concepts/sharing))

Domain-wide delegation is an optional enterprise onboarding path: a Workspace super administrator authorizes a service account for specified scopes, after which the app can act on behalf of users in that Workspace domain. It is not authorization to impersonate arbitrary external accounts. ([Google service-account authorization](https://developers.google.com/identity/protocols/oauth2/service-account))

### Working hours, time zones, and invitations

Google's documented Settings resource exposes the user's time zone but does not list working-hours settings. Therefore, do not make a Google working-hours import a prerequisite: keep TAP's per-host availability schedule authoritative unless another supported source is separately verified. This is an inference from the documented API surface, not a claim about all Google products. ([Settings resource](https://developers.google.com/workspace/calendar/api/v3/reference/settings))

Event creation accepts multiple attendees, each with `optional` (default false). Use required hosts with `optional: false`; do not interpret that flag as an enforced attendance or conflict rule. Use invitation delivery, such as `sendUpdates=all`, for the organizer event. Google warns that suppressing updates can prevent external synchronization. New attendees should use `needsAction`: pre-setting `accepted` can be reset by invitation settings, and the event may not appear until the invitee responds. Event start/end zones use IANA names. The insert contract does not document an atomic free/busy check or reservation of every attendee. ([events.insert](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert))

## Microsoft Graph

### Free/busy and account support

`POST /me/calendar/getSchedule` or `/users/{id}/calendar/getSchedule` accepts SMTP addresses for users, distribution lists, and resources. The current v1.0 method reference lists `Calendars.ReadBasic` as least privilege for delegated work/school and application access; delegated personal Microsoft accounts are unsupported. Its interval summary defaults to 30-minute buckets and permits 5–1440 minutes. A timeslot containing more than 1,000 calendar entries can produce error `5006`. ([getSchedule reference](https://learn.microsoft.com/en-us/graph/api/calendar-getschedule?view=graph-rest-1.0))

The conceptual guide documents a maximum of 20 entities, including expanded distribution-list members, and a query range shorter than 62 days. It describes free/busy from a user's default calendar, not every secondary calendar in that mailbox. It also states that calendar owners control the returned event detail. **Documentation discrepancy:** this guide still names `Calendars.Read` as least privilege, whereas the method reference names `Calendars.ReadBasic`; follow the method reference and verify actual granted scopes against representative tenants. ([free/busy guide](https://learn.microsoft.com/en-us/graph/outlook-get-free-busy-schedule))

`scheduleInformation` contains per-entity errors, precise `scheduleItems`, and `workingHours` with days and a time zone. In `availabilityView`, `0` covers both free and working elsewhere; `1` is tentative, `2` busy, and `3` out of office. TAP should normalize precise intervals rather than allow bucket size to define booking precision, preserve errors as unknown, and decide its tentative/working-elsewhere policy explicitly. ([scheduleInformation](https://learn.microsoft.com/en-us/graph/api/resources/scheduleinformation?view=graph-rest-1.0))

For secondary conflict calendars and connected personal Outlook accounts, `calendarView` is a viable read path: it lists recurring occurrences, exceptions, and single events within a time range for a specific calendar. The method supports delegated personal and work/school accounts with `Calendars.ReadBasic` or higher permissions. TAP would normalize those events into busy intervals, including cancellation, response, and show-as rules, and follow pagination. This is an implementation recommendation, not a free/busy endpoint for arbitrary people. ([calendarView](https://learn.microsoft.com/en-us/graph/api/calendar-list-calendarview?view=graph-rest-1.0))

### Cross-organization access

Exchange organization relationships govern external free/busy sharing, and user-level permissions can restrict access even when a relationship exists. Do not assume the organizer's tenant can inspect every email address. ([organization relationships](https://learn.microsoft.com/en-us/exchange/sharing/organization-relationships/organization-relationships))

Microsoft's September 2026 migration documentation also describes Microsoft 365 Cross-Tenant Access Policies for free/busy and calendar sharing. These are inbound policies, with complementary policies required for bidirectional sharing. This is an administrator-controlled deployment option, not something a public booking link can enable. The provider adapter must validate access rather than assume a specific tenant configuration. ([cross-tenant migration guide](https://learn.microsoft.com/en-us/exchange/sharing/migrate-to-m365-xtap))

### Suggestions and event creation

`findMeetingTimes` is optional assistance, not a suitable sole source for TAP's collective algorithm. It supports delegated work/school accounts, requires `Calendars.Read.Shared` or higher, and does not support application or personal-account access. It checks primary calendars. Default confidence is 50%, so default suggestions do not prove everyone is free; the strict scenario would need 100% plus explicit host validation. Its algorithm can change over time. ([findMeetingTimes](https://learn.microsoft.com/en-us/graph/api/user-findmeetingtimes?view=graph-rest-1.0))

Graph event attendees can be `required`, `optional`, or `resource`; `findMeetingTimes` currently treats every person as required regardless of the attendee type. ([attendeeBase](https://learn.microsoft.com/en-us/graph/api/resources/attendeebase?view=graph-rest-1.0))

Creating an event requires `Calendars.ReadWrite`; adding attendees sends invitations automatically. Exchange resource mailboxes can accept/reject requests based on their own scheduling configuration. The create-event method promises creation of an event, not atomic availability validation or acceptance by all human attendees. Resource behavior is not a human-attendee booking guarantee. ([create event](https://learn.microsoft.com/en-us/graph/api/user-post-events?view=graph-rest-1.0))

Graph's event `transactionId` prevents redundant creation attempts for the same event on retries. It is not an overlap lock across separate booking requests. `showAs` can represent free, tentative, busy, out-of-office, working-elsewhere, or unknown. ([event resource](https://learn.microsoft.com/en-us/graph/api/resources/event?view=graph-rest-1.0))

## Recommended TAP contract and boundary

These are design recommendations inferred from the capabilities and limitations above:

1. Save explicit host identities for the link. Each selected host is required and supplies a verified read connection (or verified sharing/delegation access), conflict calendars, a booking schedule, and a time zone. Do not derive authority from channel membership, a display name, or an email alone.
2. Compute `intersection(host booking windows) minus union(all selected host busy intervals and TAP reservations)`, respecting duration, notice, buffers, overrides, and each host's local daylight-saving transitions. A host's second connected account must count as well as their primary account.
3. Batch within provider limits and the credential's authority. Preserve individual failures. If any required host is unverifiable, withhold confirmed availability and explain which connection needs attention to the authorized organizer.
4. At submission, reserve the interval for every required host across all TAP booking links, then recheck live provider availability before creating the organizer event. Different links with overlapping host sets must contend for the same hosts. Hold/reservation expiry, retries, and partial failures need persistent state.
5. Create one meeting with all other required hosts and the booker invited. Retain the organizer, provider event reference, and host identities for rescheduling/cancellation. A required invitation is not proof that the host has accepted or that a provider has durably blocked every attendee calendar.
6. Retain TAP's reservation after confirmation so invitation propagation or Google invitation settings cannot immediately make the same host appear bookable again inside TAP. Reconcile external event changes; state the practical guarantee as preventing conflicting TAP bookings plus checking provider availability at confirmation time. Neither cited provider contract supplies a cross-provider transaction that can prevent an unrelated calendar client writing a simultaneous event.
7. Keep guest availability distinct from host availability. A public guest can select a suitable time without granting calendar access; automated verification of that guest requires a separate connection or sharing arrangement. Never silently promote unreadable guest availability to verified free time.

## Integration validation still required

Test Google consumer/Workspace hosts, Microsoft work/school hosts, personal Outlook via calendarView, mixed providers, multiple accounts per host, secondary calendars, missing sharing grants, revoked refresh tokens, partial free/busy errors, expanded groups, recurrence exceptions, all-day blocks, DST changes, and simultaneous bookings involving overlapping host sets. Verify invitation appearance and cancellation/reschedule propagation with real connected accounts. No live provider credentials were used for this research.
