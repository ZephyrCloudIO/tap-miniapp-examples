# Calendar miniapp: the Calendly/Cal.com replacement bar

**Research pass:** 3 of 4
**Researched:** 2026-08-14
**Question:** What product and operational capabilities are required before a calendar miniapp inside Tap can credibly claim to replace Calendly or Cal.com for any customer?

## Executive finding

“Replace Calendly or Cal.com for any customer” is not a single feature-parity claim. It combines at least seven distinct markets: general business scheduling, enterprise workforce scheduling, regulated-industry scheduling, GTM lead routing, paid appointments, physical-resource scheduling, and embedded/white-label platforms. A solid core can replace the incumbents for many individual and team users, but **each specialist segment needs its own launch gate**.

The initial seven requirements are necessary but not sufficient. The largest omitted areas are:

- lifecycle notifications beyond a local 10-minute alert;
- organization/tenant administration, RBAC, SSO, SCIM, domain control, and centrally managed templates;
- calendar correctness under retries, concurrent booking, provider outages, recurring events, time-zone changes, and DST;
- public booking pages, embedding, branding, routing, APIs, webhooks, exports, and migration tooling;
- privacy controls, retention/deletion, audit logs, accessibility, localization, and an enterprise security package;
- segment-specific payments/tax, resources/locations/capacity, CRM routing, data residency, HIPAA, and white-labeling.

The recommended product claim is therefore staged: **“replacement for individual and team scheduling”** after the universal core is complete, then separately qualify enterprise, regulated, GTM, commerce, physical-resource, and platform/white-label parity.

## How the bar is classified

- **Must-have parity** — required for a credible general Calendly/Cal.com replacement for ordinary individual and team scheduling.
- **Segment-specific parity** — mandatory before claiming replacement for customers in that segment, but not required for every initial customer.
- **Optional differentiation** — useful leverage from Tap’s chat/task context, but not required to meet incumbent parity.
- **Decision required** — the product team must explicitly choose a supported scope or narrow the replacement claim.

## 1. Must-have parity for general individual and team scheduling

### Scheduling model and calendar correctness

The core needs more than a calendar UI:

- multiple connected calendar accounts per person, with an explicit set of calendars checked for conflicts and one destination calendar for new bookings;
- provider support appropriate to the target market (at minimum Google Calendar and Microsoft 365/Outlook), OAuth consent, token refresh/revocation, reconnect flows, and visible connection health;
- reusable event types with configurable title, duration(s), location, hosts, invitee questions, minimum notice, booking window, start increments, buffers, per-period limits, secret/private and single-use links;
- one-on-one, collective (all required hosts), round robin (one or more host pools), and group/capacity event types;
- book, confirm/request approval, reject, reschedule, cancel, attendee RSVP, add guests, no-show, recurring meeting, and organizer reassignment flows;
- availability schedules, date overrides, holidays, out-of-office, travel/time-zone changes, and event-type-specific conflict rules;
- meeting polls and one-off offered times for cases where a durable public event type is unnecessary.

These are established expectations, not edge features. Calendly documents four event models—one-on-one, group, collective, and round robin—and Cal.com likewise supports personal and team event types with conflict checking against connected calendars ([Calendly event types](https://calendly.com/help/event-types), [Cal.com event types](https://cal.com/help/event-types/event-types)). Calendly exposes minimum notice, booking windows, increments, limits, and buffers, while Cal.com exposes per-event-type calendar conflict selection and team out-of-office forwarding ([Calendly availability rules](https://help.calendly.com/hc/en-us/articles/1500004754122-Managing-additional-rules-for-your-availability), [Cal.com conflict rules](https://cal.com/help/event-types/eventtype-specific-checking-for-conflicts), [Cal.com out of office](https://cal.com/help/availabilities/out-of-office)).

**Acceptance bar:** a slot must never be sold twice because of concurrent requests or stale provider data. Creating, rescheduling, and cancelling must be idempotent; writes must reconcile with the external calendar; partial failures must be recoverable and visible; and the user must be able to understand why a slot is unavailable. Calendly’s own troubleshooting taxonomy includes calendar conflicts, collective-host conflicts, limits, buffers, minimum notice, held poll slots, disconnected calendars, and round-robin fairness—good evidence that explainability is part of a mature product ([Calendly unavailable-time troubleshooting](https://help.calendly.com/hc/en-us/articles/223145627-How-to-use-Calendly-s-Troubleshoot-Tool)).

### Time zones, DST, and calendar interoperability

Store instants in UTC, retain the organizer’s and attendee’s IANA time-zone identifiers, and evaluate recurring availability in the applicable wall-clock zone. Do not store only a numeric UTC offset. Automatically detect the viewer’s zone, allow an override, support a locked zone for physical events, and test both nonexistent and duplicated local times at DST transitions. Calendly explicitly adjusts meetings across DST and can lock an event to a location’s time zone ([Calendly time zones](https://help.calendly.com/hc/en-us/articles/14078163170071-Time-Zones)). IANA maintains the time-zone database used to reflect jurisdictional rule changes ([IANA Time Zone Database](https://www.iana.org/time-zones)).

Import/export and provider interoperability should follow iCalendar semantics for events, attendees, organizer, recurrence, alarms, time zones, free/busy, and change sequence/identity. RFC 5545 defines those interoperable objects and operations rather than treating an `.ics` file as a static timestamp attachment ([RFC 5545](https://www.rfc-editor.org/rfc/rfc5545.html)).

### Notifications and workflows

A configurable local “meeting in 10 minutes” notification is useful, but parity requires the whole booking lifecycle:

- organizer and attendee confirmation, cancellation, reschedule, request/approval, reassignment, location-change, guest-added, payment, and recording messages;
- configurable before/after reminders and follow-ups via email, SMS, push/in-app, and—where selected—chat or WhatsApp;
- per-user defaults, per-event overrides, admin-managed templates, locale/time-zone-aware rendering, dynamic variables, opt-out/consent handling, quiet hours, and accessible links;
- retries, deduplication, delivery status, bounce/failure visibility, and an auditable communication history;
- notification behavior when Tap is closed, the device is offline, the event changes inside the lead time, or multiple calendars contain the same meeting.

Calendly Workflows can trigger on booking, start, end, reschedule, cancellation, no-show, and send customizable email/SMS actions; Cal.com adds triggers such as routing-form-without-booking and payment lifecycle events ([Calendly Workflows](https://help.calendly.com/hc/en-us/articles/360051017814-Automate-tasks-with-Workflows), [Cal.com Workflows](https://cal.com/help/workflows/workflowsoverview)). Cal.com also exposes organization-wide guest-email controls for confirmation, cancellation, reschedule, payment, reassignment, location change, and recording messages ([Cal.com guest notifications](https://cal.com/help/enterprise/guest-notification-settings)).

### Public booking experience, branding, and sharing

General parity requires a no-login public booking page with mobile-responsive slot selection, invitee form, confirmation, cancel/reschedule, automatic viewer time zone, configurable locale, abuse controls, email verification, privacy notice/consent, shareable and single-use links, QR/share affordances, and accessible error recovery.

Branding should include organizer/team identity, logo/avatar, colors, light/dark theme, branded email presentation, removal of vendor branding on paid/enterprise tiers, and embeddable inline/modal/button experiences. Calendly supports removing its badge from pages and emails and offers configurable inline and popup embeds; Cal.com supports brand colors and uses them with embeds ([Calendly branding](https://calendly.com/help/how-to-turn-off-calendly-branding-on-your-scheduling-page), [Calendly embed customization](https://calendly.com/help/how-to-customize-your-embed), [Cal.com customization](https://cal.com/help/quick-start/customization)).

**Decision required:** determine whether a Tap-only URL is sufficient for the first market, or whether vanity subdomains/full custom domains are in scope. Full white-label/custom-domain capability is a segment gate, covered below.

### Accessibility and localization

Target **WCAG 2.2 AA for the complete booking process**, including keyboard-only operation, visible/non-obscured focus, screen-reader names and status announcements, reflow/zoom, contrast, target sizes, error identification/suggestion, accessible authentication, reduced motion, and no drag-only calendar interactions. W3C recommends using WCAG 2.2 for current and future applicability and emphasizes complete-process conformance ([WCAG 2.2](https://www.w3.org/TR/WCAG22/)). Calendly publishes an accessibility conformance report against WCAG 2.0/2.1 A and AA, which is the procurement bar even though the report identifies partial-support exceptions ([Calendly Accessibility Conformance Report](https://help.calendly.com/hc/en-us/article_attachments/9225946278807)).

Localization needs separate organizer UI and invitee-booking locale settings, translated transactional messages, localized date/time/number/currency formats, 12/24-hour clocks, week-start conventions, right-to-left readiness, and safe fallback when a custom template lacks a translation. Calendly exposes English, French, Spanish, German, and Brazilian Portuguese for account UI and separately lets an event select an invitee language; Cal.com can auto-translate attendee workflow messages on organization plans ([Calendly account settings](https://calendly.com/help/account-settings-overview), [Cal.com workflow translation](https://cal.com/help/workflows/workflowsoverview)).

### Baseline security, privacy, and abuse prevention

Before any replacement claim, require tenant isolation, TLS in transit, encryption at rest, secure secret/token storage, least-privilege provider scopes, MFA or inherited Tap MFA, rate limiting, CSRF/session protection, webhook signature validation, abuse/spam controls, security logging, vulnerability management, backup/restore, incident response, and documented subprocessor use.

Privacy UX must distinguish the organizer/customer as controller from Tap as processor where applicable; expose purpose-limited invitee fields, configurable notices/terms and consent, data access/export/deletion, account deletion, deletion propagation, and a stated retention policy. Calendly’s DPA covers processor obligations, subprocessors, breach notification, transfers, and return/destruction on request or termination; Cal.com’s privacy policy states purpose-based retention and access/deletion rights ([Calendly DPA](https://calendly.com/legal/data-processing-addendum), [Cal.com privacy policy](https://cal.com/privacy)).

## 2. Segment-specific parity gates

### A. Enterprise identity, administration, and rollout

Required before claiming enterprise replacement:

- a real tenant hierarchy—organization, groups/departments, teams, users, external guests—with immutable tenant ownership and safe transfer/merge/offboarding;
- built-in owner/admin/member roles plus delegated group/team admins and granular custom permissions for users, bookings, templates, routing, integrations, analytics, audit, billing, and developer credentials;
- SAML 2.0 and OIDC SSO, enforced-login policy, break-glass admin access, MFA policy inheritance, and domain verification/control to prevent unmanaged corporate accounts;
- SCIM 2.0 create/update/deactivate plus group mapping, deprovisioning, license/seat behavior, reconciliation, and failure reporting;
- bulk invite/import/export, admin impersonation with audit, account lock/unlock, calendar/integration health dashboards, and safe user removal/booking ownership transfer;
- centrally managed event/workflow templates with locked fields, group assignment, versioning, staged rollout, rollback, and policy inheritance;
- admin-managed Google Workspace/Microsoft 365 calendar delegation for low-friction rollout, with least privilege and revocation controls;
- enterprise onboarding, sandbox/pilot, deployment documentation, support escalation, status communications, and contractual SLA/support choices.

This is direct incumbent parity. Calendly’s Admin Center manages users, groups, roles, SSO/provisioning, domain control, security, billing, permissions, branding, managed events, and managed workflows ([Calendly Admin Center](https://calendly.com/help/admin-center)); its SCIM integration creates, updates, deactivates, and maps users to groups after SAML SSO is configured ([Calendly SCIM](https://calendly.com/help/how-to-set-up-scim-on-okta)). Cal.com documents SAML and OIDC, SCIM, owner/admin/member roles at organization and team levels, and optional permission-based custom roles ([Cal.com SSO](https://cal.com/docs/developing/guides/auth-and-provision/sso-setup), [Cal.com SCIM](https://cal.com/help/auth-and-provision/scim-okta), [Cal.com access control](https://cal.com/docs/api-reference/v2/access-control)). Cal.com also offers a central delegation credential that auto-connects Google Workspace or Microsoft 365 calendars for domain members ([Cal.com delegation credential](https://cal.com/help/enterprise/delegation-credential)).

**Decision required:** decide whether Tap identity is the only identity boundary. If external customers can use the scheduler independently of Tap, SSO/SCIM must apply to that product surface as well, not merely to the host shell.

### B. Regulated industries, compliance, and residency

Required capabilities depend on the promised market:

- published DPA, subprocessor list/change notices, international transfer mechanism, data inventory/flow, controller/processor roles, data-subject request process, and contractual deletion/return;
- security program and evidence suitable for procurement: SOC 2 Type II and commonly ISO 27001; encryption, key management, access reviews, secure SDLC, vulnerability and penetration testing, incident notification, business continuity/disaster recovery, and vendor risk management;
- configurable retention by data class (bookings, invitee answers, notification content, audit, recordings/transcripts), legal hold/export, and verified deletion across primary stores, caches, search, analytics, and backups;
- configurable data residency and processing-location commitments where marketed; for stricter sovereignty, regional isolation or customer-controlled/self-hosted deployment;
- HIPAA/healthcare only with a signed BAA, PHI-safe fields/workflows, minimum-necessary access, appropriate audit/retention, and vetted downstream processors; similarly, finance/government/education claims need their own legal and control analysis.

Calendly publicly lists SOC 2 Type II, SOC 3, ISO 27001, GDPR/CCPA controls, logical tenant separation, encryption, audit, SCIM, and deletion management, but states that user/invitee data is hosted in U.S. data centers ([Calendly security](https://calendly.com/security), [Calendly data storage](https://calendly.com/help/data-storage-and-international-data-transfers)). Its standard customer terms prohibit PHI and certain other regulated data absent a different agreement, so “matches Calendly” does not itself establish healthcare suitability ([Calendly customer terms](https://calendly.com/legal/customer-terms-conditions)). Cal.com markets SOC 2 Type II, ISO 27001, GDPR, CCPA, HIPAA with BAA, configurable residency, and self-hosting/data-control options ([Cal.com compliance](https://cal.com/compliance), [Cal.com security](https://cal.com/security), [Cal.com enterprise security and self-hosting](https://cal.com/blog/secure-compliant-scheduling-infrastructure)).

**Decision required:** name the jurisdictions and regulated data classes Tap will support. “Any customer” is indefensible without explicit answers on HIPAA/BAA, residency, sovereignty/self-hosting, retention, legal hold, and compliance evidence.

### C. GTM routing and lead qualification

Required before claiming sales/revenue replacement:

- configurable routing forms with typed/required fields, conditional logic, qualification/disqualification, fallback outcomes, test/preview, response history, and export;
- destinations to event type, team/host, message, or safe external redirect;
- round robin by availability and fairness, weighted/priority routing, fixed hosts, multiple host pools, territory/language/skill attributes, contact/account ownership, and reassignment;
- CRM lookup/writeback for at least the selected target stack, duplicate/contact handling, campaign/UTM capture, and assignment explanations;
- headless routing API/embed, conversion funnel analytics (form viewed/submitted, qualified, slot viewed, booked, no-show), and a webhook for form-submitted-without-booking.

Calendly Routing Forms route on form answers, HubSpot/Salesforce lookup, and destinations including events, messages, and external URLs ([Calendly Routing Forms](https://help.calendly.com/hc/en-us/articles/4418606043927-Getting-started-with-Routing-Forms), [Calendly Salesforce integration](https://help.calendly.com/hc/en-us/articles/223195548-Getting-started-with-Salesforce)). Cal.com supports public or headless routing, attribute matching, weighted/priority round robin, fixed hosts, and separate host groups ([Cal.com routing](https://cal.com/help/routing/routing-overview), [Cal.com headless routing](https://cal.com/help/routing/headless-routing), [Cal.com round robin](https://cal.com/help/event-types/round-robin)).

**Decision required:** choose the first CRM(s) and whether routing is a native rules engine or delegated to Tap/customer automation.

### D. Physical location, resource, and capacity scheduling

Required before claiming replacement for clinics, salons, campuses, field services, facilities, or equipment-based businesses:

- structured locations with address, time zone, instructions, accessibility attributes, hours/closures, and allowed meeting types;
- bookable staff plus non-person resources such as room, vehicle, chair, device, interpreter, or equipment;
- capacity/seats, simultaneous-use rules, setup/cleanup/travel buffers, resource combinations, maintenance/blackout periods, and conflict explanations;
- location- or resource-specific services, pricing, intake questions, reminders, check-in/no-show, reassignment, and admin views.

The incumbent core supports virtual, phone, in-person, and invitee-choice locations plus group capacity. Cal.com, for example, supports in-person addresses, custom links, phone, native/third-party video, multiple locations, and capped “seats” ([Cal.com locations](https://cal.com/help/event-types/how-to-add-location), [Cal.com seats](https://cal.com/help/event-types/offer-seats)); Calendly’s group events cap invitees per slot ([Calendly group event overview](https://help.calendly.com/hc/en-us/articles/14073282345111-Group-event-type-overview)). That is not automatically full resource scheduling.

**Decision required:** either design a first-class resource model or explicitly exclude resource-dependent appointment businesses from the replacement claim.

### E. Payments, tax, invoicing, and packages

Required before claiming replacement for paid-service businesses:

- payment required at booking, deposits or full amount, multi-currency, payment status, receipts, refunds, cancellations/no-show policy, coupons, and webhook/API visibility;
- explicit merchant-of-record model, processor account ownership, chargebacks, fraud controls, payout/reconciliation, and PCI scope;
- tax-inclusive/exclusive prices, jurisdiction/rate source, VAT/GST/sales-tax evidence, invoices and required business fields;
- optional packages/credits/subscriptions and partial use/refund semantics if those customers are targeted.

Both incumbents integrate payment into booking: Cal.com uses Stripe; Calendly supports Stripe and PayPal. But payment is not the same as tax compliance—Calendly’s PayPal documentation explicitly says it does not calculate or collect VAT/sales tax and leaves refunds to the account holder ([Cal.com payments](https://cal.com/help/event-types/how-to-receive-payments), [Calendly PayPal](https://help.calendly.com/hc/en-us/articles/115004975234)).

**Decision required:** decide whether Tap merely passes payment to a connected merchant processor or owns invoicing/tax obligations, and which countries/currencies are supported.

### F. Embedded platform, custom domains, and extensibility

Required before claiming white-label/platform replacement:

- responsive inline/modal/button embeds with stable postMessage/event APIs, CSP/cookie guidance, theme variables, prefill, and consent-safe analytics;
- vanity subdomain and/or customer-owned domain with automated DNS verification/certificate issuance, redirect preservation, abuse handling, and tenant isolation;
- full white-label surfaces including booking page, emails/SMS sender identity, confirmation/cancellation, and error states;
- versioned, scoped REST/GraphQL APIs for users, organizations, calendars, schedules, slots, event types, bookings, routing, workflows, and analytics;
- OAuth 2.1 for third-party apps, granular scopes, tenant-admin authorization, token rotation/revocation, quotas/rate-limit headers, pagination, idempotency keys, version/deprecation policy, and a sandbox;
- signed, replay-protected, retrying webhooks with event IDs, ordering caveats, delivery logs, redelivery, dead-letter handling, and booking/form/payment/meeting lifecycle events;
- bulk import/export for users, templates, schedules, bookings, routing responses, analytics, and audit, plus a documented Calendly/Cal.com migration path.

Calendly exposes REST API v2, OAuth 2.1/personal tokens, embed APIs, webhooks, and a scheduling API; Cal.com exposes scoped OAuth across individual/team/organization resources, API v2 for slots/bookings/schedules/event types, and broad signed webhook triggers ([Calendly developer overview](https://developer.calendly.com/getting-started), [Calendly scopes](https://developer.calendly.com/scopes), [Cal.com OAuth scopes](https://cal.com/docs/api-reference/v2/oauth), [Cal.com API v2](https://cal.com/docs/api-reference/v2/introduction), [Cal.com webhooks](https://cal.com/docs/developing/guides/automation/webhooks)). Cal.com markets custom subdomains/full white-labeling on enterprise, while Calendly supports removing vendor branding and customizable embeds ([Cal.com compliance FAQ](https://cal.com/compliance), [Calendly advanced embed](https://calendly.com/help/advanced-calendly-embed-for-developers)).

**Decision required:** define whether the miniapp is only a first-party Tap feature or also a customer-facing scheduling platform. The latter changes the architecture, support, security review, and API stability commitment substantially.

## 3. Audit, analytics, and operational administration

### Audit bar

Enterprise audit events should cover authentication, SSO, failed login/lock, MFA, impersonation, role/membership, domain, SCIM, API credential/webhook, calendar connection, templates/workflows, booking mutations, routing assignment, billing/payment, data deletion/export, and admin settings. Each record needs immutable event ID, tenant, actor/impersonator, source, action, target, before/after where appropriate, result, timestamp, and privacy-safe network/device context. Support filters, export/API/SIEM streaming, tenant-configurable retention, and least-privilege access.

Calendly’s activity log includes API, login, calendar, permissions, SAML/SCIM/domain, routing, user, event, workflow, and compliance actions; it exports CSV/API data but defaults to 90-day retention ([Calendly activity log](https://calendly.com/help/the-activity-log)). Cal.com records security/access/API/workflow/billing/event-type events with result, actor, source, target, and before/after values, but its help center says UI export is not currently available ([Cal.com audit logs](https://cal.com/docs/developing/guides/audit-logs), [Cal.com audit-log help](https://cal.com/help/enterprise/audit-logs)). A replacement can differentiate by offering complete export/SIEM and configurable retention from launch.

### Analytics bar

Provide per-user/team/org dashboards and export/API for booked/completed/cancelled/rescheduled/no-show counts, lead-to-book conversion, time-to-meeting, slot utilization, event/source/UTM, routing outcomes, host distribution/fairness, attendee/host no-show, notification delivery, and payments. Filters must specify the date semantic (booking creation vs meeting occurrence) and report time zone.

Calendly exports meeting details, invitee/time-zone, UTM, CRM, consent, and payment data; Cal.com’s Insights dashboard includes booking status, duration, ratings/CSAT, host/guest no-shows, team-member comparisons, filters, and CSV download ([Calendly tracking/reporting](https://calendly.com/help/tracking-and-reporting), [Cal.com Insights](https://cal.com/help/bookings/insights)).

## 4. Reliability and operational acceptance criteria

A scheduling product is a distributed system coordinating Tap, one or more calendar providers, notification providers, video/meeting providers, and sometimes CRM/payment systems. The launch bar should be expressed as measurable behavior, not “syncs calendars.”

### Correctness and recovery

- atomic slot reservation/booking with optimistic concurrency or equivalent locking;
- idempotency for every externally retryable mutation and webhook consumer;
- source-of-truth and precedence rules for edits from Tap versus an external provider;
- monotonic booking versions, tombstones for deletions, deduplication across providers, and reconciliation jobs;
- bounded reservation holds for polls/payments/approval, with automatic release;
- durable outbox/queue for provider writes and notifications, retry with backoff/jitter, dead-letter and replay tooling;
- explicit degraded states when availability may be stale, credentials are revoked, provider quota is hit, or a downstream write is pending;
- recurrence and exception tests, all-day/free/busy/transparency behavior, organizer transfer, attendee updates, and DST boundary suites;
- restore and disaster-recovery exercises that verify no duplicate notifications or resurrected cancelled bookings.

### Service operations

- SLOs for booking page, slot lookup, booking confirmation, calendar-write propagation, notification dispatch, and webhook delivery;
- separately monitored public components for app, calendar integrations, notifications, third-party integrations, and APIs/webhooks;
- public status page, incident subscription, support runbooks, on-call ownership, customer-facing incident timelines, and post-incident follow-up;
- capacity/load tests around round robin, high-volume campaigns, and synchronized top-of-hour booking; provider quota budgets and backpressure;
- synthetic bookings against every supported provider and region, not only HTTP uptime checks.

The incumbents expose separate status surfaces for these dependencies. Calendly’s status page distinguishes the application, notifications, calendar integrations, third parties, and API/webhooks ([Calendly status](https://calendlystatus.com/)). Cal.com’s incident history illustrates why queue lag and silent error masking must be monitored separately: it has reported delayed webhooks/email and a misconfiguration whose failures appeared as normal 404s until active monitoring was added ([Cal.com status history](https://status.cal.com/events?filter=reports)).

**Decision required:** set the actual SLO/SLA targets, recovery point/time objectives, support hours, and maximum acceptable calendar/notification/webhook propagation delay before enterprise pricing or promises.

## 5. Mobile and enterprise rollout bar

Tap integration may remove the need for a separate calendar app, but it does not remove mobile parity. Require responsive booking and administration, native/system push, deep links to booking and join/reschedule/cancel actions, permission-denied recovery, background delivery behavior, offline/read-only upcoming schedule, local time-zone change handling, and accessible mobile controls. Ensure corporate managed-device/work-profile and notification-policy compatibility if Tap serves enterprise customers.

Calendly’s iOS/Android apps support viewing/managing meetings, booking, link sharing, availability, event types, and push notifications; Cal.com markets iOS/Android plus browser and desktop companions ([Calendly mobile overview](https://calendly.com/help/calendly-mobile-app-overview), [Cal.com Companion](https://cal.com/app)). A Tap miniapp can meet this bar through Tap’s supported clients if the capability and delivery guarantees are equivalent.

Enterprise rollout additionally needs pilot cohorts, feature flags, tenant policy defaults, admin migration reports, calendar connection/provisioning health, in-product training, support escalation, change-management communications, and reversible rollout of managed templates/workflows.

## 6. Optional differentiation enabled by Tap

These should be treated as advantages after correctness and parity, not substitutes for them:

- calendar blocks that retain a typed relationship to a Tap chat, channel, task, project, or goal;
- the proposed channel slash command with a participant picker, permission-aware default selection, common-availability preview, and a final confirmation before invites are sent;
- schedule-from-chat/task with relevant context linked instead of copying sensitive message contents into external calendar descriptions;
- participant-aware meeting preparation, task due-date protection, focus blocks, follow-up task creation, and no-show/reschedule actions in chat;
- natural-language scheduling, suggested participants, and time proposals—always with a deterministic preview and audit trail;
- policy-aware redaction and visibility controls so private channel/task context is not leaked to external invitees or calendars.

## 7. Product decisions that must precede the Wayfinder map

1. **Replacement claim:** general individual/team replacement first, or simultaneous support for enterprise/regulated/GTM/commerce/resource/platform segments?
2. **Customer boundary:** only existing Tap tenants/users, or external standalone scheduler accounts and public developer customers?
3. **Calendar providers:** exact launch matrix for Google, Microsoft 365/Outlook, Exchange/on-prem, Apple/iCloud, CalDAV, and delegated/shared calendars.
4. **Tenant and identity:** reuse Tap tenant/RBAC/SSO/SCIM only, or scheduler-specific organizations, teams, roles, and external administration?
5. **Compliance markets:** supported jurisdictions and whether HIPAA/BAA, data residency, sovereignty/self-hosting, legal hold, and sector-specific controls are promised.
6. **Public identity:** Tap-hosted links only, vanity subdomains, or full customer-domain white-labeling including notification sender identity.
7. **Routing/CRM:** first native routing rules and CRM integrations; ownership of qualification data and routing decisions.
8. **Physical resources:** first-class locations/resources/capacity, or explicit exclusion of appointment/resource businesses.
9. **Payments:** supported countries/currencies/processors and who owns merchant, tax, invoice, refund, and chargeback obligations.
10. **Notifications:** supported channels, consent model, org policy versus user/event overrides, delivery retention, and guaranteed timing.
11. **API/platform:** first-party internal API only or public versioned platform with OAuth, webhooks, sandbox, quotas, and deprecation commitments.
12. **Migration:** which Calendly/Cal.com objects can be imported, how URLs/redirects are preserved, and what evidence proves a tenant is safe to cut over.
13. **Reliability contract:** booking/slot/notification/webhook SLOs, DR objectives, support hours, and paid SLA.
14. **Accessibility/localization:** target conformance level, VPAT/public evidence, and initial organizer/invitee languages.

## Recommended release/claim gates

| Claim | Minimum gate |
| --- | --- |
| **Tap calendar for personal productivity** | Multi-calendar view/sync, availability, meeting creation, reliable 10-minute system notification, chat/task blocks, timezone/DST correctness |
| **Calendly/Cal.com replacement for individuals and teams** | All must-have parity in section 1, public booking/sharing, lifecycle workflows, multi-person event models, import/export, analytics, mobile parity, and proven reliability |
| **Enterprise replacement** | Enterprise identity/admin/rollout gate plus audit/SIEM, managed policies/templates, security evidence, support and SLA |
| **Regulated-industry replacement** | Named compliance/residency/retention controls and contracts for the specific industry/jurisdiction |
| **GTM scheduling replacement** | Routing/qualification, CRM ownership lookup/writeback, attribution and funnel analytics |
| **Paid appointment replacement** | Payment, refund, invoice and tax model for named markets |
| **Physical/resource scheduling replacement** | First-class resource/location/capacity model and operational workflows |
| **Embedded/white-label platform replacement** | Custom domains/branding, public stable APIs/OAuth/webhooks, migration tooling, sandbox and platform operations |

The universal phrase **“for any customer” should be reserved until every row is satisfied or the unsupported rows are explicitly excluded from the addressable market.**
