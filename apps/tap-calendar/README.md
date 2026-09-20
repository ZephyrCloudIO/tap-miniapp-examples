# TAP Calendar

TAP Calendar is a workspace miniapp for viewing calendars, shaping availability,
scheduling meetings, publishing booking-page drafts, receiving governed
notifications, and giving selected specialists safe calendar tools.

The package deliberately separates the interactive TAP surface from the
always-on scheduling infrastructure. Production package builds target
`https://calendar-api.theaiplatform.app` and attach the TAP host's
`platform-session` credential only for that exact origin. Each surface starts with an empty,
versioned calendar projection at
`tap-calendar:users/{canonicalTapUserId}/calendar-state/v2`. A companion
Cloudflare Worker in `apps/tap-calendar-gateway` now provides the local Zephyr
Calendar gateway boundary: Wrangler persists connections and discovered
calendars in local D1, exposes an explicit no-secret local connector, and
contains Google Calendar and Microsoft 365 OAuth + discovery adapters. Google
event snapshots, incremental repair, live availability checks, serialized
provider booking commits, expiring approval holds, approval/decline resolution,
and Google Meet provisioning now run in that always-on boundary. Reminder
delivery gateways and public-page hosting remain service responsibilities beyond
the mounted surface.

## Run locally

From the repository root, start the local D1 gateway in one terminal:

```sh
pnpm --filter @tap-examples/tap-calendar-gateway migrate:local
pnpm --filter @tap-examples/tap-calendar-gateway dev
```

Then start the miniapp preview in a second terminal:

```sh
pnpm --filter @tap-examples/tap-calendar dev
```

Wrangler listens at `http://127.0.0.1:8787`; the Rsbuild preview opens at
`http://localhost:3000`. The preview starts empty and does not need a TAP host.
It exercises the same calendar, availability, booking-page, notification, and
scheduling UI as the federated desktop surface. Calendar connections are saved
to local D1 before their projection is persisted in the miniapp.

Calendar ranges use stale-while-revalidate. The miniapp renders a bounded local
LRU immediately, refreshes the current and adjacent normalized ranges, rechecks
the visible range every five minutes while TAP is visible and online, and catches
up on focus or network recovery. D1 remains the canonical shared cache for the
UI, MCP tools, and workflows. Stale data stays visible with its age when a
provider refresh fails; booking commits still validate every Conflict Calendar
live.

Calendar state, the bounded event cache, and the provider-write recovery outbox
are partitioned by the canonical `context.userId` supplied by TAP. A channel
surface without that trusted human principal fails closed. It never falls back
to the old workspace/package-wide storage keys, and MCP tools follow the same
rule. Provider connections returned by the gateway must also name that exact
owner before the surface will expose one as a scheduling destination. This
release does not claim a team-owned calendar ACL; shared/provider calendars are
still connected under the individual TAP principal who authorized them.

Inside a TAP channel, open **Mini Apps → Schedule**. This entry targets the
retained, channel-scoped scheduling surface rather than the full Calendar
workspace. The surface prefers the typed
`sdk.channels.getParticipants` method. Until the published SDK advances past
the current release, one isolated compatibility adapter invokes that same current-host action
over the SDK frame protocol and fails closed if exact frame authority cannot
be established. The organizer is excluded and everyone else starts unchecked.
Members without a calendar invite email cannot be selected. If the host roster
capability is unavailable, the surface says so and accepts manual external
guests instead of inventing a roster. Scheduling still requires an explicit
attendee, a writable Google Destination Calendar, and the live gateway commit
used by the workspace dialog.

The local connector works without secrets. The account UI exposes its manual
calendar rows and Wrangler-specific copy only when `/v1/providers` explicitly
returns `localConnector: true`; production catalogs hide those development
controls and use provider authorization/discovery instead. To test real Google or Microsoft
authorization, follow the `.dev.vars` and callback setup in
[`../tap-calendar-gateway/README.md`](../tap-calendar-gateway/README.md).
Provider sign-in leaves the sandbox only through the host-governed
`navigation.open-external` action. The workspace surface declares the exact
Google and Microsoft authorization origins and requires TAP 2.5.5 or newer;
the pending connection state always keeps a direct-click browser action available.

One account can add several calendars during setup, and its account menu can add
more later. Named Availability Schedules, date overrides, notification channels,
Booking Profiles, and Event Types can also be created in the local preview.
Each Availability Schedule has an explicit Booking Policy editor for preferred
slot starts, before/after buffers, minimum notice, and booking horizon. Conflict
Calendar choices are global and independent of sidebar visibility; every Event
Type is pinned to one Availability Schedule and additionally checks its own
Destination Calendar when it books. Changing the default schedule affects new
Event Types only; existing booking pages keep their selected hours, time zone,
travel overrides, notice, horizon, and buffers. Public
bookings send the buffer-expanded interval to the gateway's final live conflict
check while creating the provider event at its original start and end.
Right-click any calendar in the rail (or press Shift+F10 while its checkbox is
focused) to hide it or remove its TAP projection without deleting the provider
calendar. Removed provider calendars stay excluded after discovery refreshes.
After creating and publishing a profile and Event Type, its public route is
directly testable—for example:

```text
http://localhost:3000/alex-morgan/30min
```

## Install in TAP

Build the production host-installable package from the repository root. This
command embeds `https://calendar-api.theaiplatform.app` as the Calendar gateway:

```sh
pnpm --filter @tap-examples/tap-calendar build:miniapp
```

The explicit alias is equivalent:

```sh
pnpm --filter @tap-examples/tap-calendar build:miniapp:production
```

Build a package for the local Wrangler gateway only when testing the local TAP
host integration:

```sh
pnpm --filter @tap-examples/tap-calendar build:miniapp:local
```

`TAP_CALENDAR_GATEWAY_URL` remains an explicit advanced override and must be an
exact HTTPS origin or a port-qualified `127.0.0.1` development origin. The
standalone Rsbuild preview remains local by design and also accepts
`?gateway=http%3A%2F%2F127.0.0.1%3A9797` for a different loopback port.

In TAP, open **Settings → Miniapps → Custom → Local directory** and select the
Finder-visible `apps/tap-calendar/dist` directory. Then choose
**Discover packages** and install TAP Calendar for the workspace.

## Validate

```sh
pnpm --filter @tap-examples/tap-calendar typecheck
pnpm --filter @tap-examples/tap-calendar test
pnpm --filter @tap-examples/tap-calendar validate:manifest
pnpm --filter @tap-examples/tap-calendar build
pnpm --filter @tap-examples/tap-calendar-gateway typecheck
pnpm --filter @tap-examples/tap-calendar-gateway test
pnpm --filter @tap-examples/tap-calendar-gateway build
```

`test:tap` and `test:tap:list` require a TAP Test Lab session. The checked-in
matrix includes seeded positive, empty-first-run, and storage-denied profiles.

## Package targets

- `desktop` exposes `./tap/lifecycle` and one shared `./ui/desktop` entry. The
  host mounts that entry as either the full workspace Calendar or the compact
  `tap-calendar-channel-scheduler` channel surface by contribution ID.
- The channel scheduler remains available from the channel app menu. SDK 0.16
  reserves `action.command` for artifact-context actions, so it cannot model a
  channel-composer slash command.
- `quickjs` exposes `./mcp/calendar-tools` for event/availability/draft tools and
  the aggregate-only `./mcp/calendar-daily-summary` server for daily briefings.
- `workflow-host` exposes `./workflow-host/catalog` and embeds the referenced
  JSON Schema assets.

Each MCP entry exports only `mcpServer`. The general server exposes
`list_events`, `find_available_slots`, and `draft_meeting`; the separate
least-privilege server exposes only `summarize_day`. Every tool requires a trusted host
user and reads only that user's
`tap-calendar:users/{userId}/calendar-state/v2` and bounded
`tap-calendar:users/{userId}/provider-event-cache/v1` mirror populated from the
gateway's D1 event cache. `list_events` merges that mirror with TAP-created events while
preserving free/busy and Work Block redaction. Availability fails closed unless
the requested range has complete cache coverage no older than five minutes for
every Conflict Calendar. Candidate slots also enforce the schedule's host-local
booking horizon and minimum notice, then rank preferred local start times before
returning results. `summarize_day` exposes aggregate scheduled Meetings &
appointments and Focused work minutes from owned calendars for a requested
local date. It returns no event, attendee, calendar, or linked-TAP identifiers,
and suppresses totals when cache coverage is partial, stale, or unverified;
Calendar time is not proof of attendance or productive activity. A daily-briefing
consumer should be granted only the aggregate server. `draft_meeting` reports advisory cache conflicts and
staleness, but still returns only a draft: all scheduling paths require a final
live gateway commit and explicit human confirmation before anything is booked.
The server stays in the package-runtime boundary; it is not configured as a
remote MCP server until TAP can supply an authenticated production workspace
identity for that boundary.

The workflow catalog exports the requested camel-case functions
`normalizeBookingCreated`, `normalizeBookingCancelled`, `draftWorkBlock`, and
`prepareChannelSummary`. The descriptor references lowercase aliases because
The current SDK requires contribution `exportName` values to match its lowercase
identifier grammar. All four nodes are pure, deterministic transforms. They do
not advertise native or durable triggers.

## Public booking contract

### Booking analytics

The Booking Pages screen reads owner-scoped totals from
`GET /v1/publications/analytics` on open, every minute while visible and online,
on focus/network recovery, and on **Refresh analytics**. Failures retain the last
loaded totals with an error; an initial failure shows unavailable counters.
Server totals are a read projection and do not update publication drafts or
include organizer preview activity.

Requests count committed public booking attempts. Confirmations count bookings
that were confirmed automatically or subsequently approved, including historical
bookings across publication revisions and after cancellation. Retries and
reschedules do not add bookings. The public page separately records views, slot
views, and starts once per ephemeral page visit, without guest details, cookies,
or fingerprinting. These stages begin when tracking is deployed; old traffic
cannot be reconstructed, so the live UI does not calculate a historical
conversion rate from mismatched totals.

Roll out gateway migration `0017_public_booking_analytics.sql` before deploying
the gateway, public page, and updated miniapp package. No booking-data backfill
or provider writes are required: existing booking totals are queried directly.

### Public URLs

Public URLs use:

```text
https://cal.with-tap.ai/{profileSlug}/{eventTypeSlug}
```

Public booking v1 supports individual owners. The organizer publishes only from
the TAP miniapp using the host-managed platform session; the gateway validates
that bearer and resolves it to the canonical TAP user and workspace. A single
generation-checked D1 transaction reserves the global profile slug, reserves
profile-local Event Type slugs, stores immutable public/private revisions, and
publishes or withdraws the complete active page set. Failed and concurrent
publication attempts cannot partially change live routing.

The public page resolves availability from the Event Type's explicit
Availability Schedule, not from whichever schedule is currently marked as the
workspace default. The gateway serves anonymous page resolution, authoritative
slots, public booking commits, signed management links, transactional email,
and durable booking analytics. The separate public app is hosted at
`cal.with-tap.ai`; the gateway enforces Turnstile and request rate limits.

See [REQUIREMENTS.md](./REQUIREMENTS.md) for the complete one-release scope and
the explicit host/service boundaries.
