# Live Calendar access for specialists

The new `calendar-live-tools` package contribution lets a selected specialist such
as Chloe read current calendars and individual events, create events directly
with a write grant, and analyze configured booking Event Types together or alone.
It uses an OAuth-protected Streamable HTTP server at
`https://calendar-api.theaiplatform.app/mcp/live`. The old QuickJS tools remain
available for snapshot reads, daily aggregate briefings, and draft preparation.

## Tools and data semantics

| Tool | Account scope | Behavior |
| --- | --- | --- |
| `list_calendars` | `calendar.read` or `calendar.analytics` | Connected account's calendars, roles, and write capabilities. Analytics-only grants can discover IDs without receiving event details. |
| `list_events` | `calendar.read` | Live event details with explicit pagination; optional profile/Event Type filter. |
| `get_event` | `calendar.read` | One exact event in a supplied containing date range; title, times, kind, status, attendees, location kind, and recorded Event Type identity. |
| `find_available_slots` | `calendar.read` | Checks requested and configured Conflict Calendars live; this is free-time discovery, not booking-page availability policy. |
| `create_event` | `calendar.write` | Creates an ad hoc Google meeting or Work Block; optionally invites attendees and requests Google Meet or connected Zoom. |
| `list_event_types` | `calendar.analytics` | Configured Event Types, including drafts, descriptions, duration, and approval settings. |
| `calendar_analytics` | `calendar.analytics` | Date-filtered counts and scheduled/busy minutes by calendar, kind, and recorded Event Type. |
| `event_type_analytics` | `calendar.analytics` | Recorded booking-page traffic, requests, current and lifetime confirmations, cancellations, pending/declined/expired requests, and attributed conversions, with totals and coverage timestamps. |

Use both `profileId` and `eventTypeId` to select a type, because Event Type IDs
are scoped to their profiles. `list_events` can return individual occurrences
for that type. Calendar ranges accept explicit RFC 3339 offsets and at most 93
days. Results fail closed if any requested calendar is unavailable or the
provider result exceeds the existing 5,000-entry query budget; reduce the range
instead of interpreting partial totals as complete.

Live queries and writes use the existing Google Calendar adapter, including
shared Google calendars permitted to the connected account. Other discovered
provider types remain visible in `list_calendars`, but their unsupported event
queries fail explicitly; they are never silently omitted from requested totals.

Scheduled and busy minutes sum individual timed calendar entries clipped to the
requested interval. Overlaps and copies on separate calendars count separately.
All-day entries have a separate count and contribute no timed minutes. Cancelled
and declined entries are excluded from active totals. These are scheduling
metrics, not attendance, unique meetings, or productivity measurements.

Event Types are attributed through immutable public-booking revisions and
provider event identities, never guessed from event titles. Ad hoc events and
unlinked history appear as unclassified. Funnel `confirmed` counts currently
confirmed bookings; `lifetimeConfirmed` includes bookings later cancelled.
Current cancelled, pending, declined, and expired counts remain separate. Traffic
and conversion coverage timestamps identify when recording began. These metrics
are not combined with date-filtered scheduled minutes. Aggregates omit event titles
and attendee details; read tools preserve free/busy and Work Block redaction.

## Authorization and creation

1. The host selects this server for a specialist under the package's
   `selected-specialists` consumer policy. Promoted write tools require
   `calendar.manage`; read/analytics tools require `calendar.view`.
2. The host opens OAuth authorization with a registered client, PKCE S256, and
   the exact `/mcp/live` resource. The gateway displays a random code that expires
   in ten minutes and binds the flow to an HttpOnly, SameSite browser cookie.
3. The user opens Calendar → Automations, enters the code, and reviews the client,
   callback origin, and scopes. Approval uses the existing host `platform-session`
   HTTP credential and trusted workspace/principal resolution. It cannot take a
   principal from the approval body. The user may narrow scopes or cancel.
4. The user returns to the OAuth page to complete the connection. Access tokens
   last one hour; refresh grants last thirty days. Narrowed refresh scopes stay
   narrow. Revocation is checked in D1 on every call, including already-issued
   tokens. Workspace membership is rechecked through Authz.

Creation reuses the production provider booking engine: owned writable Google
destination, destination plus all configured/explicit Conflict Calendars, live
provider conflicts, transactional locks, deterministic provider event IDs, and
idempotent recovery. The tool rechecks grant and membership immediately before
the provider write. Callers must supply a UUID idempotency key and retry the
identical request with that key after an uncertain response. A changed intent
requires a new key; failed conflict checks do not create an event. Work Blocks
cannot invite attendees. Booking-page approval policies are not overridden:
`create_event` creates an ad hoc event rather than impersonating an Event Type
booking.

The account grant covers calendars connected to that account, including future
connections. Event Type and conflict configuration are synchronized when Calendar
loads or saves and on window focus; older storage revisions cannot overwrite
newer ones. No event contents, attendee data, cached analytics, or provider secrets
are copied into that configuration. The gateway continues operating when the UI
closes, using current provider events and its durable configuration. If a sync
fails, Automations shows the error and offers a refresh; consent requires a
successful configuration sync.

## Rollout

This change is implemented and tested locally; it does not establish a production
connection for Chloe or publish the package by itself.

1. Provision a dedicated production KV namespace for `OAUTH_KV` and pin its ID in
   `apps/tap-calendar-gateway/wrangler.jsonc` under `env.production.kv_namespaces`.
   The binding without an ID supports local tests and dry builds; do not reuse
   another MCP server's token namespace. Keep `global_fetch_strictly_public` for
   OAuth client metadata discovery.
2. Apply migration `0020_calendar_live_mcp.sql` with the existing gateway
   production migration command. Deploy the gateway with its existing Authz,
   provider secrets, D1, and the new KV binding.
3. Build, publish, and install Calendar `0.3.0`. Its signed remote
   contribution requests `calendar.read`, `calendar.analytics`, and
   `calendar.write`, partitioned by workspace member. For local host testing,
   point both the remote contribution's URL/resource and the UI gateway setting
   to the local gateway before packaging.
4. Select `calendar-live-tools` for Chloe, complete consent from Automations, and
   verify reads with the Calendar window closed. In a designated test calendar,
   create a test event, inspect it, compare an Event Type's metrics with Booking
   pages, and revoke the account grant to verify subsequent calls are denied.

## Four validation passes for the implementation

1. **Host and transport:** verified SDK storage-only QuickJS restrictions; built
   a remote contribution and exercised OAuth registration, consent, PKCE,
   initialize, tools/list, tools/call, refresh, and revocation in workerd.
2. **Authority and privacy:** verified owner isolation, spoofed principal headers
   rejected outside local mode, narrowed scopes, replayed/expired consent,
   token revocation, pre-write reauthorization, and private Work Block redaction.
3. **Provider and analytics:** exercised actual gateway Google adapter code with
   deterministic provider responses, creation replay/conflict handling, real
   public-booking attribution, individual results, clipped minutes, all-day and
   declined cases, and refusal of incomplete provider results.
4. **Packaging and UI:** typechecked and built the gateway and miniapp, checked
   the signed package manifest, ran existing regression suites, and inspected
   the Automations screen in a browser. Host deployment/authentication requires
   the final production smoke test above; no live account invites were sent.

Local validation: 201 gateway tests and 260 miniapp tests pass, including 14 new
gateway cases. Gateway and miniapp typechecks, TAP test-source typecheck, gateway
production dry build, miniapp package build, and package validation pass. The host
surface suite still requires `TAP_MINIAPP_TEST_SESSION_FILE` from TAP Test Lab;
this environment has no live Test Lab session. Provider integration tests use
deterministic Google HTTP responses rather than a live Google account.
