# Cal.com capability research for a Tap calendar miniapp

Research date: 2026-08-14  
Scope: current Cal.com capabilities that define the product bar for replacing Cal.com, using only Cal.com-owned documentation, product/pricing pages, and the official Cal.com GitHub organization.

## Executive summary

Cal.com is not merely a booking-link product. A credible replacement needs four layers:

1. A calendar/availability engine: unlimited calendar connections, selected conflict calendars, a destination calendar, reusable schedules, date overrides, time zones, buffers, notice and booking limits, out-of-office, and per-event conflict rules.
2. A scheduling product: configurable event types, booking questions, confirmation, private links, seats, recurring meetings, cancellations, rescheduling, reassignment, payments, locations, and branded/embedded booking pages.
3. A team distribution system: collective events, sophisticated round robin, managed templates, dynamic group links, routing forms, CRM/attribute routing, common schedules, and team analytics.
4. Enterprise and developer infrastructure: organizations/sub-teams, RBAC/PBAC, SSO/SCIM, audit logs, domain-wide calendar delegation, compliance/data residency, API v2, OAuth, webhooks, embeds, and React “Atoms.”

The most consequential 2026 finding is that **Cal.com Platform is no longer open to new customers**. Cal.com says that, as of 2025-12-15, Platform is deprecated/under restructuring and supported only for existing enterprise customers. The ordinary API v2, API keys, user OAuth (“Continue with Cal.com”), embeds, and OAuth-backed Atoms remain documented and usable. A Tap product should therefore not assume Cal.com’s managed-user/white-label Platform is a currently purchasable dependency. ([API v2 introduction](https://cal.com/docs/api-reference/v2/introduction), [Platform FAQ](https://cal.com/docs/platform/faq))

## Capability inventory

### 1. Connected calendars and conflict handling

- The current Individual plan advertises **unlimited calendar connections**, event types, and meetings. Users can connect multiple calendars to sync availability and prevent double booking. ([pricing and feature breakdown](https://cal.com/pricing))
- The advertised provider set includes Google Calendar, Outlook, Apple Calendar, Zoho Calendar, and others; the developer Atoms specifically expose Google, Outlook, and Apple calendar connection. ([pricing](https://cal.com/pricing), [Atoms introduction](https://cal.com/docs/atoms/introduction))
- A user chooses:
  - one **destination calendar** where new bookings are written; and
  - any number of **selected calendars** whose busy events are checked for conflicts. ([calendar settings Atom](https://cal.com/docs/atoms/calendar-settings))
- Cal.com normally checks every selected calendar. For individual event types, the user can instead choose a per-event subset of calendars to check. Team event types continue to use each assigned member’s default calendar-conflict configuration. Cal.com-created bookings remain globally busy across the user’s individual event types regardless of destination calendar. ([event-type-specific conflict checking](https://cal.com/help/event-types/eventtype-specific-checking-for-conflicts))
- The product does not frame connections as “owned” versus “shared/access-granted” calendars. It exposes calendars returned by the connected provider and lets the user select conflict and destination calendars. A Tap replacement should explicitly model provider account, calendar-level access, write capability, and ownership/role because destination writes and free/busy reads have different permission requirements.
- Organizations can use **Delegation Credentials** to connect Google Workspace or Microsoft 365 calendars domain-wide. New matching members are connected automatically; admins control the credential; members cannot disconnect it but may add other calendars. Google Workspace delegation also enables Google Meet. ([delegation credentials](https://cal.com/help/enterprise/delegation-credential))

### 2. Availability engine

- Users can create **unlimited availability schedules**, name them, duplicate/edit/delete them, set working-day intervals and time zone, and attach schedules to event types. Team/Organization/Enterprise subscriptions add team schedules. ([availability dashboard](https://cal.com/help/availabilities/availability-dashboard-overview))
- Date overrides can make a particular date available for special hours or completely unavailable; expired overrides are automatically removed. ([availability settings Atom](https://cal.com/docs/atoms/availability-settings))
- Event-level controls include multiple durations, time-slot interval, minimum notice, booking window, frequency limits, total-duration limits, maximum active/upcoming bookings per booker, and “first available slot only.” ([pricing feature breakdown](https://cal.com/pricing), [event-type API](https://cal.com/docs/api-reference/v2/event-types/create-an-event-type))
- Before/after buffers protect time around both Cal.com bookings and external calendar events. Buffers can stack between adjacent bookings. ([event buffers](https://cal.com/help/event-types/event-buffer))
- **Out of Office** blocks new bookings across a date range, supports reasons and optional public notes, recurring public holidays, admin management for teammates, and optional forwarding to a teammate (forwarding requires Teams). It does not automatically cancel existing bookings during the OOO period. ([Out of Office](https://cal.com/help/availabilities/out-of-office))
- Automatic attendee time-zone detection and conversion is part of the core product. ([pricing feature breakdown](https://cal.com/pricing))

### 3. Event types and booking behavior

- Accounts can create unlimited personal or team event types. Core fields include name/title, slug/URL, description, one or multiple durations, availability, location, booking questions, and the destination calendar. ([event types](https://cal.com/help/event-types/event-types), [pricing](https://cal.com/pricing))
- Advanced controls include:
  - manual host confirmation/approval;
  - attendee email verification;
  - private/invite-only links;
  - multiple seats at the same time for classes/group sessions;
  - hiding organizer email and custom reply-to;
  - redirects after booking;
  - optimized-slot presentation;
  - localized booking UI and translated event information; and
  - custom branding, logos, theme, and removal of Cal.com branding on paid team tiers. ([pricing feature breakdown](https://cal.com/pricing), [event-type API](https://cal.com/docs/api-reference/v2/event-types/create-an-event-type))
- Recurring events are supported on Teams and above and the API can create regular, recurring, and instant bookings. The Atoms documentation warns that recurring event types are experimental, limited to 32 occurrences, and may have availability issues; this is a useful parity caution rather than a bar to copy blindly. ([pricing](https://cal.com/pricing), [create booking API](https://cal.com/docs/api-reference/v2/bookings/create-a-booking), [event-type Atom](https://cal.com/docs/atoms/event-type))
- A booking may be reassigned to another team member. Hosts and invitees can cancel or reschedule through secure links; account holders can also act from the bookings UI. Host rescheduling can intentionally choose a conflicting slot for personal event types, while other hosts’ conflicts remain enforced on team events. ([pricing](https://cal.com/pricing), [booking FAQ](https://cal.com/scheduling/frequently-asked-questions), [host reschedule busy-slot indicators](https://cal.com/help/bookings/host-reschedule-busy-slots))
- Hosts can mark host/guest no-shows. No-show status is exposed in webhooks, workflows, analytics, and audit history. ([webhooks](https://cal.com/help/webhooks), [Insights](https://cal.com/help/bookings/insights), [audit logs](https://cal.com/help/enterprise/audit-logs))

### 4. Multi-person and team scheduling

Cal.com has several distinct group/team constructs that should not be collapsed into one generic “group meeting”:

- **Collective event:** all selected co-hosts attend. Slots are the intersection of every co-host’s availability, unless an event-specific common schedule overrides individual schedules. ([collective events](https://cal.com/help/event-types/collective-events))
- **Round robin:** an available host is selected according to priority, weights, or least-recently-booked fallback. The availability presented is normally the union of host slots. Only confirmed bookings count toward weighted distribution history. ([round-robin scheduling](https://cal.com/help/event-types/round-robin))
- **Round-robin groups:** one host is chosen from each configured pool, useful for pairing roles such as salesperson + solutions engineer. ([round-robin scheduling](https://cal.com/help/event-types/round-robin))
- **Fixed hosts with round robin:** named hosts always attend, plus rotating host(s) selected from pools. ([round-robin scheduling](https://cal.com/help/event-types/round-robin))
- **Managed event:** an admin-controlled template creates an individual event type for assigned members. Admins can lock selected fields while leaving others editable. Changes to locked fields propagate. Current Managed Events v2 do **not** support Apps or Webhooks. ([managed events](https://cal.com/help/event-types/managed-events))
- **Dynamic group link:** opt-in users can be combined ad hoc with `+` in a URL, e.g. `cal.com/alice+bob`, to create a collective availability link without first defining a team event. Cal.com describes the number of combined users as virtually unlimited. ([dynamic group links](https://cal.com/help/event-types/dynamic))
- Team event types can automatically assign all current and future members. ([team event-type API](https://cal.com/docs/api-reference/v2/teams-event-types/create-an-event-type))

For Tap’s requested slash command, the closest Cal.com parity is a **dynamic collective link**, but Tap has a stronger context advantage: the command can start with current channel participants, allow inclusion/exclusion in a dialog, and then compute collective or hybrid fixed-plus-round-robin availability.

### 5. Routing forms and lead assignment

- Routing forms collect booker answers and route to an event, external URL, or custom message. Headless routing lets a product use its own form and pass field values as URL parameters. ([routing overview](https://cal.com/help/routing/routing-overview))
- Basic routing is on Teams. Organization features add custom/member attributes and attribute-based routing (examples: region, role, language, priority). Attributes may have weights, creating route-specific virtual queues. ([pricing](https://cal.com/pricing), [routing overview](https://cal.com/help/routing/routing-overview))
- Routing supports smart fallback hosts when no attribute match exists, Salesforce ownership-based routing, routing-decision traces for admins, and headless use from an external form. ([routing overview](https://cal.com/help/routing/routing-overview))
- Routing-form submissions can trigger workflows and webhooks even when no booking is created. ([workflows](https://cal.com/help/workflows/workflowsoverview), [webhooks](https://cal.com/help/webhooks))

### 6. Workflows, reminders, and notifications

- A workflow has one trigger and one or more actions, can target selected event types, supports dynamic booking variables, and can run:
  - before event start;
  - on booking, cancellation, reschedule, rejection, or booking request;
  - after event end;
  - on routing-form submission with or without a booking;
  - on payment initiated/succeeded; or
  - on no-show update. ([workflow overview](https://cal.com/help/workflows/workflowsoverview))
- Actions include email to host, attendee, or a fixed address; SMS to attendee/fixed number; WhatsApp to attendee/fixed number; and Cal.ai voice calls. Cal.ai actions consume credits. Messages can include event, host, attendee, time-zone, location, meeting, cancellation, reschedule, rating, and no-show variables. ([workflow overview](https://cal.com/help/workflows/workflowsoverview))
- Free users get a default reminder but cannot customize it. Teams, Organizations, and Enterprise get custom multi-action workflows; self-hosted instances are documented as unrestricted for workflows. Organization plans can auto-translate attendee workflow messages. ([workflow overview](https://cal.com/help/workflows/workflowsoverview))
- Cal.com’s public workflow documentation does **not** promise a general native desktop/mobile OS push notification action. Email, SMS, WhatsApp, calendar notifications, and AI calls are documented. Tap’s requested configurable “meeting in 10 minutes” **system notification** is therefore a meaningful native differentiator and should work independently of provider reminder settings.
- Organization admins can globally disable guest email categories including confirmations, cancellations, reschedules, approval requests, reassignment, payment, location change, guest-added, and Cal Video recording notices. ([guest notification settings](https://cal.com/help/enterprise/guest-notification-settings))

### 7. Conferencing and meeting locations

- Event locations can be Zoom, Google Meet, Microsoft Teams, Cal Video, phone, in-person, or other/custom locations, with multiple location choices offered to the booker. The pricing page claims Google Meet, Teams, Zoom, Cal Video, and 20+ additional conferencing tools. ([pricing](https://cal.com/pricing), [Google Meet guide](https://cal.com/blog/customizing-your-scheduling-experience-with-cal-com-and-google-meet))
- Cal Video is the default when no location is supplied. Public product material describes transcription, recording, instant meetings, and dial-in. Video-related webhooks include meeting start/end, recording ready/transcription generated, and host/guest no-show detection. ([create event type API](https://cal.com/docs/api-reference/v2/event-types/create-an-event-type), [booking FAQ](https://cal.com/scheduling/frequently-asked-questions), [webhooks](https://cal.com/help/webhooks))
- API/Atoms integration is narrower: programmatic app installation supports Google Meet, Zoom, and Microsoft Teams; Cal Video is default; other conferencing apps must be connected in Cal.com’s web app and are unavailable to legacy Platform users. Google Meet requires Google Calendar; Teams requires a work/school Microsoft account. ([conferencing Atom](https://cal.com/docs/atoms/conferencing-apps), [event-type API](https://cal.com/docs/api-reference/v2/event-types/create-an-event-type))
- Organization-only custom host locations let different round-robin hosts use different meeting providers with an event-level fallback. ([team event locations](https://cal.com/help/event-types/setup-location))

### 8. Payments

- Current pricing advertises up-front booking payments via **Stripe and PayPal**, including on the free Individual plan. ([pricing](https://cal.com/pricing))
- The current Atoms event-type/payment UI and API surface document **Stripe only**. The Atom lets a host set amount, currency, and when to charge after connecting Stripe. This means “Cal.com supports PayPal” is true at the hosted-app level but not necessarily in every integration surface. ([event-type Atom](https://cal.com/docs/atoms/event-type), [API v2 navigation](https://cal.com/docs/api-reference/v2/introduction))
- Webhooks distinguish payment initiated, paid/successful, and booking-created lifecycle events. ([webhooks](https://cal.com/help/webhooks))

### 9. Embeds, white-label UI, and headless use

- Standard embeds support inline calendars, element-triggered popups, floating-button popups, and email links. Users can embed an event type, profile/event list, or routing form. The embed works against cloud-hosted and self-hosted instances. ([adding an embed](https://cal.com/help/embedding/adding-embed), [embed product page](https://cal.com/embed))
- Embed options include namespacing, preloading, modal control, hiding event details, maintaining a time-zone selector, and limited styling. ([embed instructions](https://cal.com/help/embedding/embed-instructions))
- **Cal.com Atoms** are customizable React components for booking, availability, event types, calendar connection/settings, conferencing, payments, and onboarding. Supported hosts are React 18/19 and Next.js 14/15. The current path uses ordinary Cal.com users and OAuth; users authorize a Cal.com account and remain managed by Cal.com. ([Atoms introduction](https://cal.com/docs/atoms/introduction), [onboarding embed](https://cal.com/docs/atoms/onboarding-embed))
- The old **Platform managed-user** model was the more fully white-label/headless option: a product created Cal.com-side representations of its users, stored managed-user tokens, and rendered scheduling in its own product without public `cal.com/{user}` pages. It is now deprecated and unavailable to new customers, although docs remain for existing users. ([Platform quickstart](https://cal.com/docs/platform/quickstart), [API v2 introduction](https://cal.com/docs/api-reference/v2/introduction))

### 10. API, OAuth, webhooks, and automation surface

- API v2 covers bookings, schedules, slots, out of office, notifications, credits, insights, calendars, selected/destination calendars, conferencing, event types/private links, routing forms, workflows, webhooks, Stripe, teams, organizations, attributes, delegation credentials, memberships, roles, users, verified resources, OAuth, and API keys. API v1 was shut down on 2026-04-08. ([API v2 introduction](https://cal.com/docs/api-reference/v2/introduction), [v1-to-v2 migration](https://cal.com/docs/api-reference/v2/v1-v2-differences))
- User OAuth supports granular scopes, authorization code flow, PKCE for public clients, refresh tokens, and up to ten redirect URIs per client; a Cal.com admin must approve new OAuth clients. OAuth access tokens currently last 30 minutes. ([OAuth](https://cal.com/docs/api-reference/v2/oauth))
- The default/API-key rate limit is 120 requests per minute. Cal.com says it may raise this to roughly 200, or higher such as 800 for an extra charge, through support. ([API v2 introduction](https://cal.com/docs/api-reference/v2/introduction))
- Slots can be queried by individual event type, team event type, or dynamic usernames for multi-person intersection. A reschedule UID can exclude the original booking from busy-time calculations. ([slots API](https://cal.com/docs/api-reference/v2/slots/get-available-time-slots-for-an-event-type))
- Webhooks can be scoped to a user or event type/team event type, include a secret and custom payload template, and cover booking lifecycle, approval, payments, no-shows, meeting lifecycle, recordings/transcripts, instant meetings, OOO, and routing submissions. SaaS webhook targets must be HTTPS and public; self-hosted targets may use HTTP/private IPs, though cloud metadata and non-HTTP schemes remain blocked. ([webhooks developer guide](https://cal.com/docs/developing/guides/automation/webhooks), [webhook trigger reference](https://cal.com/help/webhooks))
- Cal.com also publishes an official MCP server for supported AI clients, using API-key authentication for local/stdio operation. ([MCP server](https://cal.com/docs/mcp-server))

### 11. Analytics and operational visibility

- The Insights dashboard reports totals/completed/rescheduled/cancelled events; ratings; host and guest no-show rates; CSAT; event-volume trends; average duration; popular event types; most/least booked and completed members; cancellations/no-shows; feedback; and CSV export. Filters include date range/date target, team, member, and event type. ([Insights](https://cal.com/help/bookings/insights))
- Routing traces explain why a host was assigned for form and CRM-routed bookings. ([routing overview](https://cal.com/help/routing/routing-overview))
- Organization audit history records booking create/approve/reject/cancel/reschedule/reassign, attendee/location/no-show/seat changes, and security activity. It shows actor, source (web/API/webhook/system), impersonation, and raw JSON. The help docs say audit logs cannot currently be exported. ([audit logs](https://cal.com/help/enterprise/audit-logs))

### 12. Administration, enterprise, security, and compliance

- Organization structure adds unlimited sub-teams, centralized billing, a company `*.cal.com` subdomain, org-wide workflows, and centralized administration. Enterprise adds custom contracting/support, HRIS/directory integrations, SLA/uptime guarantees, priority Slack/account support, and a dedicated database. ([pricing](https://cal.com/pricing), [Organizations](https://cal.com/organizations))
- Default organization and team roles are owner, admin, and member. Organization owners/admins inherit access across teams; Cal.com also supports opt-in **permission-based access control (PBAC)** for custom granular roles/permissions. ([API access control](https://cal.com/docs/api-reference/v2/access-control))
- Organizations include SAML SSO, SCIM provisioning, role-based permissions, domain-wide delegation, and audit logs. Pricing advertises US/EU hosting and dedicated databases at higher tiers. ([pricing](https://cal.com/pricing), [Organizations](https://cal.com/organizations))
- Cal.com states that it has SOC 2 Type II, ISO 27001, HIPAA, GDPR, and CCPA compliance/certification and publishes a trust center, DPA, certification/report access, annual third-party penetration testing, encryption in transit and at rest, and continuous monitoring. These are vendor claims that procurement should validate against actual reports and contract terms. ([security](https://cal.com/security), [Trust Center](https://security.cal.com/))
- BAA wording varies across current first-party pages: the Organizations page says a BAA is included with Organizations, while the healthcare page says it is included for Enterprise and Organizations with 15+ users and costs $300/month for smaller plans. Treat BAA entitlement as sales-contract dependent and verify before promising parity. ([Organizations](https://cal.com/organizations), [healthcare scheduling](https://cal.com/scheduling/healthcare))

### 13. Apps and integrations

- Cal.com advertises **100+ direct integrations**, plus Zapier and Make for broader automation. Highlighted integrations include Google/Outlook/Apple/Zoho calendars, 20+ conferencing tools, Stripe/PayPal, Salesforce, HubSpot, mobile apps, and browser extensions. ([pricing](https://cal.com/pricing))
- Salesforce and HubSpot are described as two-way sync integrations, with CRM ownership usable for routing. ([pricing](https://cal.com/pricing), [routing overview](https://cal.com/help/routing/routing-overview))
- Integration behavior is surface-dependent. Hosted Cal.com exposes the broad app store, whereas API/Atoms programmatic conferencing is limited to Google Meet, Zoom, and Teams, and Managed Events v2 currently lack Apps/Webhooks. Product requirements should define capability by surface, not just say “supports integration X.”

## Current plan and limit dependencies

Prices and entitlements below are the current public annual-billing presentation; monthly or negotiated prices may differ. ([pricing](https://cal.com/pricing))

| Tier | Public price | Important advertised scope |
| --- | ---: | --- |
| Individual | Free, 1 user | Unlimited event types, calendars, and meetings; email/SMS notifications; 100+ apps; mobile/browser extensions; Stripe/PayPal; Salesforce/HubSpot; Calendly import. Default workflow reminder is not customizable. |
| Teams | $12/user/month billed yearly; 14-day trial | One team; round robin; collective and managed events; recurring events; customizable email/SMS workflows; branding removal; routing forms; booking analytics; custom APIs. OOO forwarding also requires Teams. |
| Organizations | $28/user/month billed yearly; 14-day trial | Teams features plus unlimited sub-teams, custom-variable/attribute routing, company subdomain, SAML SSO/SCIM, instant meetings, domain-wide delegation, role-based permissions, and additional APIs. |
| Enterprise | Custom annual contract | Organizations features plus dedicated onboarding/engineering support, SLA/uptime guarantees, HRIS/directory integrations, priority Slack/account support, and dedicated database. |

Other documented constraints and exceptions:

- Public API rate limit: 120 requests/minute by default; increases are support/possibly paid. ([API v2 introduction](https://cal.com/docs/api-reference/v2/introduction))
- Managed Events v2 currently lack Apps and Webhooks. ([managed events](https://cal.com/help/event-types/managed-events))
- Event-type-specific calendar conflict selection applies only to individual events. ([event-type-specific conflict checking](https://cal.com/help/event-types/eventtype-specific-checking-for-conflicts))
- OOO forwarding requires Teams. ([Out of Office](https://cal.com/help/availabilities/out-of-office))
- Custom host locations for round robin are Organization-only. ([team event locations](https://cal.com/help/event-types/setup-location))
- Workflow customization is paid-team-and-above on SaaS; Organization adds auto-translation; self-hosted workflow usage is documented as unrestricted. ([workflow overview](https://cal.com/help/workflows/workflowsoverview))
- Platform managed users/managed organizations are maintenance-only for existing customers; no new Platform signups. ([API v2 introduction](https://cal.com/docs/api-reference/v2/introduction))

## Self-hosting reality in 2026

The official GitHub repository has materially changed from the older “Cal.com is open core” story. It now presents **Cal.diy** as a community, MIT-licensed self-hosted edition, warns that it is intended for personal/non-production use, and says all commercial/enterprise code has been removed. Specifically, it says Teams, Organizations, Insights, Workflows, SSO/SAML, and other enterprise features are absent; commercial and enterprise-ready scheduling should use hosted Cal.com or separately arranged on-prem enterprise access. ([official `calcom/cal.com` repository](https://github.com/calcom/cal.com))

Therefore:

- “Cal.com is self-hostable” does not mean the current free self-hosted edition is a feature-equivalent replacement for Cal.com SaaS.
- A commercial Tap competitor cannot count on Cal.diy to supply team distribution, workflows, analytics, governance, or enterprise controls.
- Production on-prem parity appears to require a commercial agreement with Cal.com, while running Cal.diy means Tap owns operations, upgrades, security, provider credentials, deliverability, database durability, and missing-feature implementation.

## Replacement implications for Tap

### Minimum parity beyond the seven stated requirements

To support the claim “replace Calendly or Cal.com for any customer,” the Wayfinder map should decide whether the destination includes each of these bars:

- Reusable event types with questions, limits, buffers, private links, confirmation, seats, recurrence, branding, and multiple locations.
- Booking lifecycle: approval/rejection, cancellation/reschedule reasons, guest self-service links, reassignment, attendee editing, and no-show tracking.
- Collective, round-robin, fixed-plus-round-robin, round-robin groups, managed templates, and ad-hoc dynamic groups.
- Routing forms with conditional/attribute routing, fallbacks, CRM ownership, headless mode, and explainable routing traces.
- Multi-channel workflow automation before/after/lifecycle events, not only one reminder offset.
- Public booking pages and embeddable/headless UI with localization, accessibility, time zones, and brand controls.
- Payments and payment lifecycle events.
- Analytics/export, operational history, and auditable administrative actions.
- Organization/sub-team hierarchy, RBAC/PBAC, SSO/SCIM, domain-wide delegation, data residency, compliance evidence, and contractual support/SLA.
- Public API/OAuth/webhooks with versioning, scoped auth, retries/idempotency, rate limits, and integration lifecycle management.

### Areas where Tap can exceed Cal.com naturally

- Native system notifications with a default 10-minute reminder and per-calendar/event/category overrides.
- Calendar objects that link directly to Tap chats and tasks, with bidirectional status/context rather than generic notes or third-party integrations.
- `/schedule` from a channel, pre-populating channel members and letting the initiator select required/optional attendees before availability computation.
- Permission-aware use of internal identity, team/channel membership, working hours, time zone, and presence without creating separate scheduling identities.
- A single internal flow that supports “find time,” immediate event creation, hold/proposal/consensus, or public booking link, rather than forcing every case through an external booking page.

## Questions this research should put onto the Wayfinder frontier

1. Does “replace Cal.com for any customer” mean feature parity with Individual + Teams, or also Organizations/Enterprise, regulated use, public APIs, and on-prem?
2. Is Tap the scheduling system of record, or an orchestration layer over Google/Microsoft/Apple calendar APIs?
3. Which group algorithms ship first: collective intersection, round robin, fixed-plus-rotating, multi-pool, or all?
4. Are external guests first-class identities, link-only attendees, or email/phone records, and what self-service can they perform?
5. Does availability expose only binary free/busy, or preference/priority, working-location, focus time, travel time, holds, and tentative status?
6. Are “calendar blocks for chat and tasks” hard busy blocks, soft holds, or typed work objects with configurable availability effects?
7. What notification engine guarantees a 10-minute OS notification across desktop/mobile, offline devices, time changes, cancellations, and duplicate calendar-provider reminders?
8. Is public booking/embedding/branding in the first destination, and must customers use their own domains?
9. Are payments, routing/CRM, workflow automation, analytics, SSO/SCIM/audit, compliance, and data residency part of the initial replacement claim or explicitly staged/out of scope?
10. What migration contract is required: import event types, availability, workflows, routing logic, historical bookings, links/slugs, and redirects from Calendly/Cal.com?

## Source-quality notes

- All links above are first-party Cal.com sources.
- Cal.com’s current marketing, help, developer, and GitHub materials contain some inconsistencies (notably Platform availability, BAA entitlement, payment surfaces, and the meaning of self-hosting). Where they differ, this note calls out the conflict rather than silently choosing one version.
- Plan entitlements and pricing are especially volatile. Re-verify the live pricing and contract language at product-definition and procurement time.
