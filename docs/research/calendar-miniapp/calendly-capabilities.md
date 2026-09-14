# Calendly capability baseline for a Tap calendar miniapp

Research date: 2026-08-14
Scope: current Calendly product capabilities relevant to replacing Calendly or Cal.com. Sources are limited to Calendly's current product, Help Center, developer, security, and legal pages.

## Executive summary

A credible Calendly replacement is much more than a calendar view plus a public booking link. Calendly's current baseline spans multi-calendar conflict checking, reusable and one-off scheduling, four multi-person scheduling models, group availability polling, lead qualification/routing, configurable communications, payment collection, website/mobile/browser surfaces, analytics, APIs/webhooks, and enterprise administration.

The product's clearest structural limitations are equally useful requirements input: each user must connect their own calendars; calendar connections apply to every event type rather than being assigned per event type; Meeting Polls do not support workflows or rescheduling; a displayed cancellation policy does not actually enforce a cutoff; API rescheduling still relies on a returned reschedule URL; and Calendly's current customer terms prohibit customer data containing PHI or other regulated categories named in the agreement.

## Capability inventory

### 1. Calendar connections, ownership, and delegated access

- Calendly connects Google, Outlook/Office 365, and Exchange calendar accounts; iCloud and a local Outlook plug-in are also supported in narrower notification/sync modes. A user chooses calendars to check for conflicts and one main calendar to receive new bookings. Busy events block availability and bookings are written back to the selected calendar. [Calendar connections and multiple calendars](https://calendly.com/help/how-to-manage-multiple-calendars-and-email-addresses) [Availability overview](https://calendly.com/help/availability-overview)
- Free connects one calendar account. Standard, Teams, and Enterprise connect up to six accounts per user. Multiple sub-calendars can be selected for conflict checking. A user with a one-calendar plan can surface other calendars by sharing those calendars into the connected account with read/write access. [Current pricing matrix](https://calendly.com/pricing) [Multiple-calendar guidance](https://calendly.com/help/how-to-manage-multiple-calendars-and-email-addresses)
- Calendly does not model “owned” versus “accessible/shared” calendars as separate product classes. It inherits whatever calendar access the connected provider account grants. The important parity requirement is therefore provider-account connection plus enumeration and selection of owned and delegated calendars.
- Calendar accounts are personal: admins can inspect connection status but cannot connect, disconnect, or change another user's settings, and there is no organization-wide calendar connection. Calendar connections also apply to all of a user's event types; an event type cannot target a different connection. [Admin FAQ](https://calendly.com/help/admins-faq) [Multiple-calendar limitations](https://calendly.com/help/how-to-manage-multiple-calendars-and-email-addresses)
- Free/busy rules can deliberately allow an event type to book over external events or Calendly meetings whose titles match configured exceptions. They do not work with the local Outlook plug-in, and booking over an existing Calendly meeting does not cancel it. [Free/busy rules](https://calendly.com/help/free-busy-rules-overview)

### 2. Availability and booking constraints

- A user can create multiple named schedules, set recurring weekly windows (including split shifts), create non-weekly/date-specific hours, and assign schedules to one or many event types. An event type may instead use custom hours. Availability is the intersection of the assigned schedule, observed holidays, and free/busy state from selected connected calendars. [Setting availability](https://calendly.com/help/how-to-set-your-availability) [Availability overview](https://calendly.com/help/availability-overview)
- Per-event controls include meeting duration, booking horizon (rolling calendar/weekday count, fixed date range, or indefinitely), minimum scheduling notice, start-time increments, buffers before/after, limits per day/week/month, time-zone detection or locking, and event-specific free/busy exceptions. [Fine-tuning availability](https://calendly.com/help/how-to-fine-tune-your-availability-settings)
- Paid plans can offer up to four selectable durations on one booking page, except for Group and Managed Event Types. Events can be secret/unlisted while remaining bookable by direct link. [Multiple durations](https://calendly.com/help/how-to-set-up-multiple-durations-for-an-event-type)
- Calendly has an availability troubleshooting view that explains why a slot is unavailable (calendar conflict, buffer, booking limit, holiday, date range, minimum notice, collective-host conflict, round-robin fairness, reserved poll/one-off slot, and other causes). This is a meaningful support/diagnostics parity feature, not merely an admin nicety. [Availability troubleshooting](https://calendly.com/help/how-to-use-calendly-s-troubleshoot-tool)

### 3. Reusable, one-off, and multi-person scheduling

Calendly's four reusable Event Type models are:

| Model | Scheduling behavior | Current plan boundary |
|---|---|---|
| One-on-one | One host and one invitee | Free includes one Event Type; paid plans allow unlimited Event Types |
| Group | One host, many independently booking invitees in the same slot; capacity 2–9,999 and optional remaining-spots display | Standard and above |
| Collective | Multiple required hosts and one invitee; only mutual availability is shown | Standard and above |
| Round robin | One invitee is assigned to an available host, optimized for maximum availability or even distribution | Teams and Enterprise |

Sources: [Event Types overview](https://calendly.com/help/event-types-overview), [multi-person scheduling](https://calendly.com/help/multi-person-scheduling-options-for-your-organization), and [Group Event Type details](https://calendly.com/help/group-event-type-overview).

- Teams and Enterprise can combine required co-hosts with one or more rotating host pools, enabling patterns such as a required account executive plus an assigned sales engineer. Hosts must be users in the same Calendly organization. Rescheduling can preserve or rerun the round-robin assignment. [Multiple host groups](https://calendly.com/help/how-to-schedule-with-multiple-groups-of-hosts)
- Shared Event Types let coworkers create collective or round-robin scheduling without an admin-managed team page. Team pages provide a branded directory of team Event Types and a shared URL.
- Event templates carry name, description, color, one or more durations where supported, location, hosts, availability, invitee form/questions, booking-page behavior, notifications/workflows, and payment settings. Locations include supported video conferencing, phone, in-person, custom instructions/static link, or an invitee-provided location; one-on-one events can offer several location choices. [Event editor](https://calendly.com/help/event-type-editor-overview) [Meeting locations](https://calendly.com/help/how-to-set-the-location-for-your-event-type)
- Custom invitee questions support required answers and consent checkboxes. Email verification can require a six-digit code before a public booking is confirmed, supplementing built-in spam protection. [Booking-form features](https://calendly.com/help/advanced-booking-form-features) [Email verification](https://calendly.com/help/how-to-require-email-verification-for-event-types)
- Single-use links derive from an Event Type, may customize one-on-one meeting details, and expire after one booking. One-off Meetings instead select particular offered slots, may include up to ten hosts on web, can go outside normal availability or over external events, and optionally reserve every offered slot until one is booked. One-off links cannot use Workflows. [Single-use links](https://calendly.com/help/how-to-create-a-single-use-link) [One-off Meetings](https://calendly.com/help/how-to-create-a-one-off-meeting)

### 4. Scheduling groups whose calendars are not connected

- Meeting Polls allow a host to propose up to 40 slots to up to 40 participants. Anyone with the link can vote without a Calendly account; times display in each voter's local time zone. The organizer reviews results, chooses the final time, may add non-voters, and Calendly sends calendar invitations. Offered times may be reserved on host/co-host calendars until booking. [Meeting Poll setup](https://calendly.com/help/how-to-set-up-a-meeting-poll) [Meeting Poll overview](https://calendly.com/help/meeting-polls-overview)
- Current limitations: votes cannot be changed after submission; slots cannot be added after publication; polls close when booked, deleted, or all options pass; participants are limited to 40; and polls do not support Workflows or rescheduling.
- This is the closest Calendly baseline to Tap's proposed slash-command flow for channel participants. Tap can exceed it by pre-populating channel members, letting the organizer select invitees, reading internal free/busy directly, and falling back to a poll only for external or opaque calendars.

### 5. Routing and qualification

- Native Routing Forms collect answers and evaluate `and`/`or` conditions. A route can send a visitor to an Event Type, an external URL, or a custom disqualification message, with a fallback route for unmatched submissions. Forms can be linked or embedded. Owners/admins create them and may delegate edit access. [Creating a Routing Form](https://calendly.com/help/how-to-create-a-routing-form)
- Higher-end routing can use HubSpot or Salesforce ownership/lookup, connect existing HubSpot, Marketo, or Pardot forms, and coexist with tools such as LeanData or Distribution Engine. The current pricing page puts general qualification/routing on Teams and Salesforce lookup/Microsoft Dynamics on Enterprise. [Calendly Routing](https://calendly.com/help/calendly-routing) [Pricing](https://calendly.com/pricing)
- Routing Form analytics measure submissions through to booked meetings. This is a sales/revenue feature customers may expect from a full replacement even though it is not necessary for Tap's initial internal-calendar use case.

### 6. Notifications, reminders, follow-up, cancellation, and no-shows

- Booking delivery uses either a live calendar invitation from the host's connected calendar or a Calendly email confirmation with an `.ics` attachment. Calendar invitations propagate later edits; email confirmations are static. Group events, iCloud, the local Outlook plug-in, and calendarless setups use email confirmations. Hosts also receive an unavoidable Calendly booking email. [Scheduling notifications](https://calendly.com/help/calendly-scheduling-notifications)
- Paid plans have configurable basic email/text reminders. Standard and above can customize subjects, bodies, and dynamic variables. [Basic notifications](https://calendly.com/help/how-to-set-up-basic-notifications)
- Workflows (Standard and above) send email or SMS at booking, before start, at start, after reschedule, after end, after cancellation, or after a no-show is marked. Uses include reminders, reconfirmation, third-party notification, surveys, thank-yous, and rescheduling outreach. An account/team can create up to 50 Workflows. The cancellation trigger is not supported for Group events. [Workflows overview](https://calendly.com/help/workflows-overview)
- The iOS/Android app supports configurable push notifications for new bookings, cancellations, and upcoming meetings. The documented product does not promise an OS-level desktop notification at a default ten-minute lead time; Tap should treat its proposed system notification as a differentiator and make lead time, channel, meeting types/calendars, quiet hours, batching, and snooze configurable. [Mobile app FAQ](https://calendly.com/help/mobile-app-faq)
- Hosts and invitees can cancel or reschedule through links when enabled; hosts can act from web, mobile, extension, or (with Google sync enabled) Google Calendar. Paid hosts can cancel and email a selectable replacement-time flow with a 1/3/7-day nudge. A displayed cancellation policy is informational only—it does not enforce a cancellation/reschedule cutoff. [Rescheduling](https://calendly.com/help/how-to-reschedule-a-meeting) [Cancellation policy](https://calendly.com/help/how-to-add-a-cancellation-policy)
- Hosts can mark an invitee as a no-show after start time, undo that status, and mark Group attendees individually. No-show status is exportable and can trigger a dedicated Workflow while suppressing ordinary post-meeting messages. [No-shows](https://calendly.com/help/how-to-mark-no-shows-for-meetings)

### 7. Conferencing, integrations, payments, and embeds

- Native conferencing locations include Zoom, Google Meet, Microsoft Teams, Webex, and GoTo Meeting; Calendly creates a unique link after booking. A custom static link supports other tools. [Meeting locations](https://calendly.com/help/how-to-set-the-location-for-your-event-type)
- Calendly advertises more than 100 integrations across Google/Microsoft suites, CRM/marketing (including HubSpot, Salesforce, Marketo, Pardot, Dynamics), recruiting, email, conferencing, analytics, and automation; Zapier supplies a broader no-code connector layer. [Features and integrations](https://calendly.com/features)
- Stripe and PayPal can collect a required payment during booking; Calendly exposes transaction details in meeting records and exports. Calendly also markets meeting packages and standalone payment links, but the June 2026 Stripe help article still labels those two capabilities private beta/limited availability, so they should not be treated as universally deployed parity requirements without customer validation. [Stripe](https://calendly.com/help/calendly-stripe) [Payments product page](https://calendly.com/payments)
- Websites can embed a personal/team landing page or a single Event Type as an inline scheduler, pop-up text link, or floating pop-up widget. JavaScript supports invitee prefill, query parameters, event tracking via `postMessage`, optional auto-resize, and hiding profile/event/cookie-banner details; paid plans add color/button customization. [Embed overview](https://calendly.com/help/embed-options-overview) [Advanced embeds](https://calendly.com/help/advanced-calendly-embed-for-developers)

### 8. Admin, analytics, security, and compliance

- Organization roles are Owner, Admin, Group Admin, Team Manager, and User. Their permissions cover user/group/team administration, Event Type ownership, rescheduling, reporting, and Workflows. Admins can manage other users' event types and meetings but not their calendar connections. [Roles and permissions](https://calendly.com/help/user-roles-and-permissions)
- Managed Events let admins create and assign standardized one-on-one or Group templates. On Teams/Enterprise, sections can be locked so later admin changes sync to assignees; editable sections stop syncing. Managed Workflows apply standardized communications. [Managed Events](https://calendly.com/help/how-to-create-and-assign-managed-events)
- In-app analytics (Standard and above, with broader admin visibility) cover up to one year of created, completed, rescheduled, and canceled events, distribution by duration, popular events/times, and filtering by user/team/group/Event Type. Teams and above add Routing Form conversion analytics. CSV exports include organization event/user data; meeting exports include invitee, UTM, consent, Salesforce, and payment fields. [Calendly analytics](https://calendly.com/help/calendly-analytics) [Tracking/reporting](https://calendly.com/help/tracking-and-reporting)
- Enterprise controls include SAML 2.0 SSO, SCIM user/group provisioning, domain control/account oversight, flexible roles, data-deletion capabilities, outgoing-email auditing, and a real-time activity log. SSO is also sold as a Teams add-on. The activity log records authentication, user, calendar, availability, Event Type, poll, routing, Workflow, integration, API token, and compliance changes. [SSO](https://calendly.com/help/saml-single-sign-on-sso-overview) [Activity log](https://calendly.com/help/the-activity-log) [Pricing](https://calendly.com/pricing)
- Calendly states encryption at rest and in transit, tenant separation, 24/7 monitoring/incident response, and SOC 2 Type 2, SOC 3, ISO/IEC 27001, CSA STAR Level One, GDPR, and CCPA coverage. [Security](https://calendly.com/security)
- Important replacement boundary: Calendly's June 2026 customer terms say customer data must not contain PHI/HIPAA-regulated information, GLBA/SOX-regulated information, or defined sensitive/special-category data. A Tap product intended for healthcare or regulated workflows needs an explicit compliance decision rather than assuming Calendly-equivalent positioning is sufficient. [Customer terms](https://calendly.com/legal/customer-terms-conditions)

### 9. APIs, webhooks, and platform surfaces

- Calendly API v2 is REST/JSON and authenticates internal/private apps with personal access tokens and multi-customer apps with OAuth 2.1. Current granular scopes cover availability, Event Types, locations, routing forms, scheduled events/invitees, links/shares, organizations/groups/users, contacts, webhooks, activity logs, compliance deletion, and outgoing communications. [API overview](https://developer.calendly.com/getting-started) [OAuth scopes](https://developer.calendly.com/scopes)
- The current Scheduling API can create and update Event Types, query availability, update Event Type availability, and create bookings directly without a Calendly-hosted UI. It can also create one-off/single-use shares, cancel scheduled events, and mark no-shows. Creating a booking requires a paid plan. API cancellation is supported, but there is still no direct reschedule endpoint; clients use the invitee resource's reschedule URL. [Supported operations](https://developer.calendly.com/supported-tools) [API FAQ](https://developer.calendly.com/frequently-asked-questions)
- Webhooks cover booking and cancellation/reschedule (reschedule appears as create plus cancel), routing-form submissions, and—by July 2026—contacts and Notetaker recap lifecycle events. Webhook access is paid-plan/role dependent and subscriptions can be user- or organization-scoped. [Webhook guide](https://developer.calendly.com/receive-data-from-scheduled-events-in-real-time-with-webhook-subscriptions) [API release notes](https://developer.calendly.com/release-notes)
- Mobile apps on iOS/Android support meeting management, real-time booking, availability/Event Type management, links, contacts, joining calls, and notifications; calendar-account connection changes remain desktop-only. Browser extensions for Chrome, Edge, Firefox, and Safari plus an Outlook add-in expose links, offered slots, event creation, one-offs, polls, booking, meeting management, contacts, no-shows, and follow-ups inside Gmail, LinkedIn, Google Calendar, Gong, and the browser toolbar. [Mobile overview](https://calendly.com/help/calendly-mobile-app-overview) [Browser extensions](https://calendly.com/help/browser-extensions)

## Plan and limit snapshot

This is the defensible current boundary from Calendly's official pricing and feature help; legacy “Professional” references remain in some Help Center articles but are not a currently sold tier.

| Tier | Replacement-relevant baseline |
|---|---|
| Free | One Event Type, one connected calendar, unlimited meetings, customizable availability/booking page, conferencing, Meeting Polls and one-offs, mobile apps/extensions |
| Standard ($10/seat/month annual) | Up to six calendars, unlimited Event Types, Group/Collective scheduling, Workflows/basic customization, webhooks and paid Scheduling API access, payments, HubSpot/Mailchimp/Zapier, analytics, custom branding |
| Teams ($16/seat/month annual) | Standard plus Round Robin, qualification/routing, Salesforce/marketing integrations, advanced admin/group features; SSO available as an add-on |
| Enterprise (starts at $15,000/year) | Teams plus Salesforce lookup and Dynamics, SSO/SAML, SCIM, domain control, audit/activity controls, data-deletion API, dedicated support and implementation/security review |

Limits that should become explicit Tap product decisions include: six calendar accounts per user; up to four durations per eligible Event Type; Group capacity 9,999; Meeting Polls 40 slots/40 participants; up to ten hosts on a web one-off meeting; 50 Workflows per user/team; and in-app analytics history of one year. Source: [Calendly pricing](https://calendly.com/pricing) and the feature-specific Help Center pages linked above.

## Implications for the Wayfinder conversation

The initial Tap list covers personal/team calendar aggregation, proactive reminders, Tap-native chat/task blocks, availability, internal multi-person scheduling, and channel-based scheduling. To support the stated “replace Calendly or Cal.com for any customer” destination, the requirements conversation must also decide:

1. Whether the destination includes external public booking pages, reusable Event Types, one-offs/single-use links, polls, group capacity, collective/round-robin host pools, and routing—not just an internal calendar UI.
2. Whether Tap will provide revenue features (qualification, CRM ownership routing, payments, conversion analytics) in the first product boundary or explicitly phase them.
3. Whether the calendar authorization model supports provider accounts plus both owned and delegated calendars, and whether admins may centrally provision connections—a deliberate improvement over Calendly.
4. Which notification surface is canonical: Tap desktop/mobile system notifications, provider reminders, email/SMS automation, or all of them, including quiet hours, snooze, per-calendar/event rules, no-show/reconfirmation flows, and compliance/consent.
5. The guest identity model for channel members, organization users, outside email invitees, contacts without connected calendars, and invitees who must not need a Tap account.
6. Whether embedded/public scheduling and APIs are first-class platform surfaces, including OAuth scopes, webhooks, tenant isolation, audit logs, admin templates, data retention/deletion, accessibility, branding, localization, and regulated-data posture.
7. Which Calendly limitations Tap intentionally preserves versus fixes: event-specific calendar targeting, enforceable cancellation windows, editable poll votes, workflow-enabled polls/one-offs, direct API rescheduling, and richer diagnostics.
