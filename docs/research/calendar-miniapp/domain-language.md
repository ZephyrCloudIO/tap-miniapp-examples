# TAP Calendar

TAP Calendar is the scheduling context spanning the in-TAP calendar experience and its externally accessible booking experience.

## Language

**TAP Calendar**:
The complete calendar and scheduling product delivered through TAP, including internal collaboration and external booking.
_Avoid_: Calendar miniapp when referring to the whole product

**Public Calendar Page**:
An internet-accessible booking page published through the Zephyr Cloud integration for guests who may not have a TAP account.
_Avoid_: External miniapp, guest miniapp

**Public Booking URL**:
The canonical address of a Public Calendar Page, composed as `https://cal.with-tap.ai/{booking-profile-slug}/{event-type-slug}`.
_Avoid_: Calendly link, calendar link

**Booking Profile Slug**:
The owner-chosen, globally unique first path segment of a Public Booking URL. A Booking Profile Slug may be owned by an individual, team, or organization.
_Avoid_: Username, handle

**Event Type Slug**:
The owner-chosen second path segment identifying a bookable event within a Booking Profile, such as `30min`; it is unique within that profile.
_Avoid_: Meeting name, duration slug

**Event Type**:
A reusable definition of a bookable meeting, including its hosts, scheduling model, durations, availability policy, location, booking questions, confirmation mode, and lifecycle behavior. Its scheduling model may be one-on-one, collective, group/capacity, round robin, or hybrid fixed-and-rotating hosts.
_Avoid_: Meeting template, calendar type

**Managed Event Type**:
An administrator-controlled Event Type assigned to selected users or teams, with policy fields that recipients cannot change.
_Avoid_: Organization template, locked meeting

**Availability Schedule**:
A reusable time policy containing weekly intervals, preferred windows, time zone, date overrides, holidays, and out-of-office periods. Event Types select an Availability Schedule and add booking-specific constraints.
_Avoid_: Working hours, free/busy calendar

**Availability Override**:
A date-specific replacement for an Availability Schedule's weekly intervals. It may close the date entirely or define custom hours, and it may use a Travel Time Zone different from the schedule's ordinary time zone.
_Avoid_: Travel schedule, one-off schedule

**Travel Time Zone**:
The IANA time zone attached to a newly created Availability Override. Its local date boundary and any custom wall-clock hours are interpreted in this zone. Legacy overrides without one inherit their Availability Schedule's time zone.
_Avoid_: Viewer time zone, UTC offset

**Calendar Visibility**:
A per-user preference that enables or disables one connected calendar in TAP Calendar's unified views without disconnecting it.
_Avoid_: Calendar connection, calendar access

**Conflict Calendar**:
A connected calendar whose busy events constrain scheduling availability, regardless of whether it is currently visible.
_Avoid_: Visible calendar, destination calendar

**Free/Busy Privacy**:
The rule that availability computation may reveal whether a time is available but not the conflicting event's title, attendees, calendar, or reason without explicit provider sharing and TAP authorization.
_Avoid_: Calendar redaction, hidden event

**Destination Calendar**:
The writable connected calendar selected to receive a Provider Event Replica for a Booking.
_Avoid_: Conflict calendar, default view

**One-off Meeting**:
A non-reusable meeting proposal offering selected times without creating an Event Type.
_Avoid_: Temporary Event Type, ad hoc event

**Meeting Poll**:
A scheduling proposal in which selected participants indicate which offered times work before an organizer finalizes the meeting.
_Avoid_: Availability survey, group Event Type

**Meeting Location**:
The way participants join or attend an Event Type, including a TAP-native meeting room, TAP Voice Huddle, supported conferencing provider, phone call, physical address, or custom instructions.
_Avoid_: Venue, conference link

**TAP Voice Huddle**:
A TAP voice session created for a scheduled meeting and made available to its TAP participants at the meeting time. External Guests cannot join it.
_Avoid_: Voice channel, conference call

**External Guest Compatibility Warning**:
A blocking warning shown when a TAP-native Meeting Location is selected for one or more External Guests. Confirmation requires removing those guests or selecting an external Meeting Location.
_Avoid_: Guest error, provider failure

**External Guest**:
A person who books through a Public Calendar Page without requiring a TAP account or a verified email address.
_Avoid_: Invitee account, anonymous user

**Booking Management Link**:
An unguessable link that lets an External Guest cancel or reschedule a specific booking without signing into TAP.
_Avoid_: Guest login, verification link

**Booking Question**:
An Event Type field answered during booking. Its answer inherits Booking permissions and is excluded from Provider Event Replicas and Calendar Channel Summaries unless explicitly authorized.
_Avoid_: Intake field, calendar metadata

**Booking Confirmation Mode**:
The Event Type policy that either confirms a booking automatically or requires approval from an authorized approver.
_Avoid_: Booking status

**Tentative Booking Hold**:
A temporary reservation that protects a requested slot while an approval-required booking awaits a decision; it expires after a configurable period.
_Avoid_: Tentative meeting, pending event

**Work Block**:
Protected calendar time linked to a TAP task, channel, or message. It is busy by default, may be changed to soft or free, and links back to its source without copying private source content into external calendars.
_Avoid_: Focus event, task meeting, chat event

**Calendar Notifications Channel**:
A TAP channel dedicated to actionable scheduling lifecycle events, including meeting requests, approvals, bookings, changes, and cancellations. Each user has a private personal channel, and authorized users may configure additional shared channels for selected teams, calendars, or event types.
_Avoid_: Notification feed, calendar alerts chat

**Calendar Channel Summary**:
A permission-aware scheduling summary posted to a Calendar Notifications Channel. Sensitive contact details, booking answers, private calendar descriptions, and linked TAP content are omitted unless every viewer is authorized.
_Avoid_: Calendar event copy, booking transcript

**Notification Workflow**:
An Event Type or organization policy that sends scheduling lifecycle communications through selected TAP channels, system notifications, email, SMS, WhatsApp, or Telegram.
_Avoid_: Reminder rule, alert automation

**Personal Meeting Reminder**:
A user-owned notification configuration for an upcoming Booking, defaulting to a system notification ten minutes before start and supporting multiple offsets, channels, overrides, quiet hours, snooze, actions, and duplicate suppression.
_Avoid_: Notification Workflow, provider alarm

**Regulated-Data Mode**:
A workspace capability, enabled only by an applicable contract and approved controls, that permits defined regulated scheduling data. Ordinary TAP Calendar use does not permit PHI or other sector-regulated sensitive data.
_Avoid_: Compliance mode, secure calendar

**Calendar Tool Surface**:
The permissioned MCP tools and TAP host actions through which specialists and miniapps use TAP Calendar. TAP Calendar does not provide a customer-facing application API.
_Avoid_: Calendar API, developer platform

**Calendar Workflow Node**:
A workflow trigger or action contributed by TAP Calendar for composing customer-defined scheduling automations inside TAP.
_Avoid_: Calendar webhook, integration callback

**Calendar Migration**:
A validated import of supported Calendly or Cal.com configuration, bookings, and history into TAP Calendar, followed by provider reconnection and an old-to-new Public Booking URL mapping.
_Avoid_: Calendar sync, data copy

**Booking**:
The TAP Calendar record of a requested or confirmed meeting, including its participants, lifecycle, approval state, and TAP relationships.
_Avoid_: Provider event, calendar entry

**Provider Event Replica**:
An event written to a connected calendar to represent a TAP Calendar Booking. Provider-side changes to the replica are reconciled back into the Booking.
_Avoid_: Booking, source event

**Calendar Insight**:
A derived scheduling metric used to understand booking outcomes, host distribution, utilization, delivery, or synchronization health.
_Avoid_: Audit record, calendar statistic

**Public Page View**:
A visit to a Public Calendar Page that is eligible to participate in its booking-funnel analytics.
_Avoid_: Impression, profile visit

**Booking Conversion**:
The measured progression from Public Page Views through slot selection and booking initiation to requested or confirmed Bookings.
_Avoid_: Booking count, click-through rate

**Public Booking Protection**:
The Cloudflare-backed protection applied to Public Calendar Pages: edge DDoS mitigation, Managed Turnstile with server-side validation, and WAF rate limiting. It supplements rather than replaces TAP Calendar's atomic slot reservation.
_Avoid_: Email verification, booking approval

**Calendar Audit Event**:
An immutable record of an administrative or Booking mutation, including its actor, source, target, outcome, and time.
_Avoid_: Calendar Insight, activity notification
