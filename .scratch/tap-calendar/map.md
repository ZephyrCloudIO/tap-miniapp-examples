# Chart the one-shot TAP Calendar replacement

Label: `wayfinder:map`

## Destination

Produce an implementation-ready product and platform specification for a one-shot TAP Calendar launch that replaces Calendly and Cal.com for customers using `cal.with-tap.ai`, within the explicit exclusions below, and integrates calendar, scheduling, public booking, TAP collaboration, specialists, workflows, enterprise administration, migration, analytics, privacy, and reliable multi-provider synchronization.

## Notes

Planning only: this map resolves decisions and hands off an implementation-ready specification; it does not build the product.

Every session should use the Wayfinder, grilling, and domain-modeling skills. Research must use current primary sources. Canonical language lives in [`CONTEXT.md`](../../CONTEXT.md).

Research completed before charting:

- [Calendly capability baseline](../../docs/research/calendar-miniapp/calendly-capabilities.md)
- [Cal.com capability baseline](../../docs/research/calendar-miniapp/calcom-capabilities.md)
- [Calendly/Cal.com replacement bar](../../docs/research/calendar-miniapp/replacement-bar.md)
- [TAP platform fit](../../docs/research/calendar-miniapp/tap-platform-fit.md)

Standing product constraints confirmed while charting:

- This is a one-shot launch, not a phased roadmap.
- Public Booking URLs use `https://cal.with-tap.ai/{booking-profile-slug}/{event-type-slug}`. Individuals, teams, and organizations may own globally unique Booking Profile Slugs; Event Type Slugs are unique within a profile.
- Zephyr Cloud serves one resilient multi-tenant public application with atomically published, versioned routes and last-known-good rollback behavior.
- Supported calendar sources are Google Calendar/Workspace, Microsoft 365/Outlook.com/Exchange Online, Apple iCloud, generic CalDAV, on-premises Exchange, and ICS import/export/subscriptions, including Google/Microsoft domain delegation.
- Calendar Visibility, Conflict Calendar selection, and Destination Calendar selection are independent controls. The unified calendar provides day, work-week, week, month, agenda, and team-availability views on desktop and mobile.
- Availability uses named schedules, preferred windows, date overrides, holidays, out-of-office periods, and Event Type constraints. Scheduling supports one-on-one, collective, group/capacity, round robin, hybrid fixed-and-rotating hosts, one-offs, polls, and recurrence.
- External Guests need neither TAP accounts nor verified email addresses. Booking Management Links provide cancellation and rescheduling. TAP-native meeting rooms and TAP Voice Huddles are TAP-user-only; selecting them with External Guests blocks confirmation until the guest or location changes.
- Event Types support automatic or approval-required confirmation. Approval-required requests create expiring Tentative Booking Holds and actionable Calendar Notifications Channel requests.
- Every user has a private Calendar Notifications Channel; authorized users may configure additional shared channels for teams, calendars, or Event Types. Calendar Channel Summaries and availability obey permission and free/busy privacy.
- Work Blocks reserve time from TAP tasks, channels, or messages without copying private source content to providers.
- Personal Meeting Reminders default to a system notification ten minutes before start and are configurable. Notification Workflows may use TAP channels, system notifications, email, SMS, WhatsApp, and Telegram.
- TAP Calendar contributes workflow trigger/action nodes and a permissioned MCP/tool surface for specialists. It does not expose a customer-facing application API or customer-configured outbound webhooks.
- Public Calendar Pages track privacy-preserving views, funnel stages, campaign attribution, and Booking Conversion. Cloudflare provides DDoS mitigation, Managed Turnstile with server validation, and WAF rate limiting; TAP Calendar still owns atomic booking correctness.
- Public and internal experiences target WCAG 2.2 AA, responsive mobile behavior, keyboard and screen-reader access, automatic viewer time zones, locale-aware formatting, and English product copy.
- TAP identity, organizations, teams, RBAC, SSO, and SCIM remain authoritative. Calendar adds delegation, Managed Event Types and workflows, offboarding transfer, health reporting, Calendar Insights, and immutable Calendar Audit Events.
- Ordinary scheduling PII is supported under TAP controls. PHI or other specially regulated data requires contract-enabled Regulated-Data Mode.
- TAP Calendar is authoritative for Bookings and scheduling policy; connected providers own independent events and receive Provider Event Replicas. Provider-side replica changes reconcile back to TAP Calendar. Stale or unavailable free/busy data fails closed.
- Calendly and Cal.com migration imports supported configuration, upcoming Bookings, and history; providers reconnect and owners receive validation plus old-to-new URL mappings.

## Decisions so far

- [Research the calendar-provider integration contracts](issues/01-research-calendar-provider-contracts.md) established per-calendar capability/freshness profiles, provider-specific synchronization adapters, fail-closed Conflict Calendars, read-only ICS, an enterprise Exchange connector, negotiated CalDAV compatibility, and iCloud's unresolved production contract. Full evidence is on `research/tap-calendar-provider-contracts` at `77b99cb291b6856e5785ae4e50b2a15de6865ce4`.
- [Research communication and conferencing delivery contracts](issues/02-research-communication-and-conferencing-contracts.md) established TAP-owned durable delivery state and consent, channel-specific messaging constraints, calendar-backed Meet/Teams, separately managed Zoom/Webex/GoTo resources, runtime guest-policy checks, and new TAP scheduled-Huddle/video-room primitives. Full evidence is on `research/tap-calendar-communication-conferencing-contracts` at `caf6e40ded9e733a4c43f271a7e84fc2e2546d89`.

## Not yet specified

- Exact storage topology, schemas, tenancy partitions, queue boundaries, and event contracts after provider constraints and the service/host boundary are resolved.
- Concrete UI composition, responsive behavior, empty/error states, and keyboard flows beyond the approved high-level interaction models; these should emerge through the prototype tickets.
- Exact quotas, default limits, retention windows, analytics aggregation rules, and plan/packaging boundaries after cost and operational behavior are known.
- Exact SLOs, SLAs, RPO/RTO, support model, incident communication, provider quota budgets, and disaster-recovery procedures after the canonical lifecycle and delivery systems are specified.
- Detailed Regulated-Data Mode contracts, permitted data classes, residency matrix, and evidence requirements after enterprise data flows are known.
- Release documentation, operator runbooks, customer migration guides, and final implementation decomposition after all product and platform decisions close.

## Out of scope

- Customer-owned or white-label booking domains; `cal.with-tap.ai` is the only public base domain.
- Payment collection, deposits, taxes, invoicing, refunds, and paid-appointment commerce.
- Lead qualification, routing forms, CRM ownership lookup/writeback, and GTM conversion routing.
- Non-person resource scheduling for rooms, equipment, vehicles, desks, or facilities.
- Translated product copy and right-to-left layouts; the launch is English-only.
- Public customer APIs and customer-configured outbound webhooks; TAP workflows, MCP tools, and host actions are the extension surfaces.
- Accountless access to TAP-native meeting rooms or TAP Voice Huddles.
