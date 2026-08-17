# TAP Calendar requirements

This is one coherent release requirement set, not a phased roadmap. A checked
surface requirement is implemented in this package. A boundary requirement is
represented honestly in the UI or contract but needs TAP-host or Zephyr gateway
infrastructure before production release.

## Calendar and time model

- [x] Add and display multiple provider accounts and calendars the user owns in
  local/TAP state.
- [x] Start new installations without demo accounts, people, events, booking
  pages, or notification feeds; show recovery-oriented empty states throughout.
- [x] Add several calendars while creating an account and add more calendars to
  an existing account from its action menu.
- [x] Add calendars shared with the user under owner, writer, reader, and
  free/busy roles; read-only calendars can never become the destination.
- [x] Let the user independently show or hide each calendar, matching the Apple
  Calendar interaction model.
- [x] Let the user right-click or use the keyboard context-menu command to
  remove an individual calendar from TAP Calendar without deleting it at the
  provider; persist provider-calendar exclusions across discovery refreshes.
- [x] Keep visibility, conflict participation, writability, and destination
  selection as separate controls.
- [x] Provide working account action menus for editing the TAP-local display
  name, changing all calendar visibility or conflict preferences, and safely
  removing the TAP projection with Destination Calendar and Event Type
  reassignment when required.
- [x] Provide day, work-week, week, month, agenda, and team views.
- [x] Navigate the visible date range with horizontal trackpad, Magic Mouse,
  and Shift-wheel gestures while preserving vertical and nested grid scrolling.
- [x] Create calendar Work Blocks from TAP tasks without copying private source
  content to providers.
- [ ] Channel- and message-backed Work Block pickers require TAP host list/search
  contracts; the domain already stores only a safe source reference.
- [x] Create, duplicate, and configure named availability schedules, preferred
  times, buffers, minimum notice, booking horizon, weekly hours, and date
  overrides in the surface.
- [x] Schedule a meeting with multiple selected participants.
- [x] Warn when an external guest is invited to a TAP-only room or scheduled
  TAP Voice Huddle.
- [x] Provide a locally runnable Zephyr Calendar gateway in Wrangler with D1
  persistence, an explicit no-secret development connector, and Google and
  Microsoft OAuth + calendar-discovery adapters.
- [x] Build TAP-host packages against the authenticated production Calendar
  gateway by default, retain an explicit loopback build override, and expose
  manual/mock calendar controls only when the provider catalog advertises its
  development connector.
- [x] Open Google and Microsoft authorization only through TAP's governed
  system-browser action, with exact provider origins, an explicit human grant,
  and a direct-click fallback in the pending connection state.
- [ ] Google refresh, bounded recurrence expansion, incremental sync, webhook
  repair, serialized provider writes, Google Meet, and expiring approval holds
  are implemented in the local gateway. Production TAP authentication/deployment,
  attachment fidelity, Microsoft event sync/writes, and the remaining
  iCloud/CalDAV/Exchange/ICS adapters still require the deployed gateway.

## Notifications and coordination

- [x] Default the system reminder to 10 minutes and allow a configurable
  reminder offset.
- [x] Model system, TAP, email, SMS, WhatsApp, and Telegram delivery preferences
  with quiet hours.
- [x] Support a private per-user `TAP Calendar Notifications` channel and
  configurable shared team, calendar, or Event Type channels.
- [x] Keep approval details limited to authorized viewers and provide approval
  and decline controls in the surface.
- [x] Use TAP SDK actions for system notifications, channel list/create/read/send,
  task reads, and saved-workflow discovery.
- [ ] Durable reminder scheduling, email/SMS/WhatsApp/Telegram delivery,
  retry/deduplication, and meeting-change webhooks require the always-on gateway.

## Scheduling links

- [x] Model individual, team, and organization booking-profile ownership while
  restricting public booking v1 publication to personal/individual profiles.
- [x] Reserve globally unique profile slugs and profile-local Event Type slugs
  in the gateway with immutable ownership fences and bounded per-owner quotas.
- [x] Generate `cal.with-tap.ai/{profileSlug}/{eventTypeSlug}` URLs, including
  `cal.with-tap.ai/zephyr-zack/30min`.
- [x] Create and edit Booking Profiles, choose individual/team/organization
  ownership and globally unique slugs, and create profile-local Event Types.
- [x] Bind every new Event Type to an explicit Availability Schedule, preserve
  legacy booking pages by pinning them to their stored default, and use that
  relationship for public hours, time zones, travel overrides, notice, horizon,
  preferred ordering, and buffers.
- [x] Resolve the same slug paths directly in local preview so public-page
  routing is acceptance-testable without a TAP account.
- [x] Do not require a verified guest email.
- [x] Show the accountless public booking journey, automatic versus
  approval-required booking, location choice, and no-TAP-account messaging.
- [x] Track page views, slot views, booking starts, requests, confirmations, and
  view-to-confirmed conversion in the calendar domain.
- [x] Describe secure cancel/reschedule management links in the confirmation
  journey.
- [x] Authenticate organizer publication from the TAP miniapp with the
  host-managed platform session, resolve it to the canonical TAP user/workspace,
  and publish/unpublish whole profiles with D1 generation CAS, immutable
  revisions, atomic routing changes, and idempotent replay receipts.
- [ ] Add anonymous public page/availability/booking endpoints, signed
  cancel/reschedule links, transactional email, and durable public analytics.
- [ ] Cloudflare Turnstile must be verified server-side. Cloudflare WAF,
  managed DDoS mitigation, rate limits, and privacy-safe abuse telemetry belong
  at `cal.with-tap.ai`; the organizer UI reports this protection as setup
  pending until the server boundary is live.

## TAP-native extensibility

- [x] Expose selected specialists to four bounded MCP tools rather than a
  direct customer API: `list_events`, `summarize_day`,
  `find_available_slots`, and `draft_meeting`.
- [x] Expose privacy-minimal daily Calendar time totals for owned calendars:
  scheduled Meetings & appointments and Focused work, with DST-safe local-day
  boundaries, overlap de-duplication, explicit cache-quality metadata, and a
  separate aggregate-only MCP server that does not expose event-detail tools.
- [x] Require a canonical host user for MCP execution and limit every read to
  that principal's `tap-calendar:users/{userId}/calendar-state/v2` and bounded
  `tap-calendar:users/{userId}/provider-event-cache/v1` mirror;
  `draft_meeting` never books directly.
- [x] Contribute schema-bound workflow nodes for booking-created normalization,
  booking-cancelled normalization, Work Block drafting, and permission-aware
  channel-summary preparation.
- [x] Keep workflow nodes pure and honest: no native durable trigger is claimed.
- [x] Include a working in-app schedule dialog that accepts multiple participants.
- [x] Contribute a channel-scoped `Schedule` surface and `/schedule` command
  launch contract; both reuse the provider-backed workspace scheduling path.
- [x] Bind each channel scheduling surface to its trusted TAP principal and
  expose only connected, writable destinations owned by that exact principal;
  missing or mismatched ownership fails closed rather than inheriting another
  workspace member's calendar.
- [x] Feature-detect the typed `channels.getParticipants({ channelId })`
  capability, exclude the organizer, show only trusted human members, leave all
  members unchecked, and disable members without an invite email.
- [x] Prefer the official participant method and isolate the temporary SDK
  host-action compatibility path behind exact origin, frame, document, request,
  response-source, response-origin, size, and timeout validation.
- [x] Fall back honestly to manual external guests when the host roster
  capability is unavailable; never infer membership from presence or timeline
  messages.
- [ ] Production TAP hosts must ship the action-command launcher/schema and
  exact-bound channel participant capability before those optional integrations
  are available outside compatible development hosts.
- [ ] Durable booking-created/cancelled workflow triggers originate from the
  Zephyr gateway; the package normalizers are ready to receive those payloads.

## Product constraints

- [x] No direct public customer API is declared; TAP specialists use MCP and
  customers compose TAP workflows from contributed nodes.
- [x] No email verification requirement is introduced for public guests.
- [x] No translation or right-to-left requirement is included in this release.
- [x] The surface models TAP rooms, scheduled TAP Voice Huddles, Google Meet,
  Microsoft Teams, Zoom, Webex, GoTo Meeting, phone, physical locations, and
  custom instructions. Google Meet is provisioned for the connected Google
  adapter; every other choice is visibly unavailable until its adapter/details
  contract is connected.
- [x] The package declares the minimum TAP permissions and effects needed by its
  current surface, tools, and workflow catalog.
