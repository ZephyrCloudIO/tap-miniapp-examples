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

## Shared booking links

Open **Booking pages → Shared bookings** in the TAP workspace. Each required
host connects Google Calendar, chooses an Availability Schedule, and enables
shared bookings from their own account. Their public name and provider-verified
Google identity become available to workspace booking managers.

A workspace owner/admin can claim a globally unique Profile Namespace, add a
shared meeting, select every required host, choose its organizer and duration,
and publish. For example, claiming `zephyr` and publishing `zack-and-vern`
would produce `https://cal.with-tap.ai/zephyr/zack-and-vern`. This is an example;
installing the code does not claim that name or enroll either person.

The gateway offers only times that satisfy every host's schedule, time zone,
notice, buffers, date overrides, live Google conflicts, and existing TAP
reservations. It creates one organizer event and invites the other hosts plus
the guest. Both Google Meet and the organizer's connected Zoom account are
supported. Approval-required meetings appear in the organizer's shared-booking
panel; approval rechecks every host. Guest rescheduling and cancellation update
the same meeting and reservations.

The workspace owns the shared profile. Any authorized workspace manager can
edit it; leaving the creator's account does not transfer calendar credentials.
Profile and published meeting names stay stable. Add a new meeting to use a new
URL. Save shared availability and refresh the links after changing a host's
Availability Schedule or Conflict Calendars. Withdrawing a host immediately
prevents new bookings; existing meetings remain scheduled.

This release supports one guest booking up to ten required Google-connected
hosts. Seat-capacity classes, round robin, external attendees' unconnected
calendars, and collective Microsoft availability are outside this implementation.
In-app individual availability validation also respects reservations created by
shared links; arbitrary attendee emails do not grant calendar access.

The additive migration, authorization binding, and deployment order are in the
[gateway README](../tap-calendar-gateway/README.md#workspace-bookings).

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

## Schedule from the calendar

Click an empty half-hour slot in Day, Work week, or Week to create an event at
that local date and time. Clicking an empty Month cell starts an event at 9 AM
on that date. Existing events still open their details. Keyboard users can Tab
to a day's slot, use Up/Down (or Home/End) to choose a time, and press Enter or
Space to open the editor.

The workspace editor accepts events with no guests, marks them busy, and defaults
to **No video call**. Enter a title and save to block your own calendar; add guests
and optionally Google Meet or connected Zoom for a meeting. Every guest row can
be removed, including the last one. Personal events use the same live conflict
validation, Google provider commit, and durable recovery as meetings. The channel
scheduler continues to require an explicit attendee.

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

The Booking Pages dashboard reads authenticated, owner-scoped totals from
`GET /v2/publications/analytics`. It refreshes on open, every minute while visible
and online, on focus/reconnection, and on **Refresh analytics**. The response
includes its generation time and traffic/conversion coverage dates. Initial
failures display unavailable counters; later failures retain the last successful
snapshot with its timestamp and an error. Organizer preview counts never replace
public totals. Server totals include archived/unpublished pages even if a local
draft is missing.

- **Views:** one per anonymous booking-page visit. Reloading creates a new visit;
  returning to earlier steps or refreshing a changed publication does not.
- **Starts:** visits that reached the guest-details form after selecting a slot.
  Slot views count visits that reached the available-times list.
- **Confirmed bookings:** accepted public bookings whose current status is
  confirmed, including past meetings, excluding cancelled/pending/declined/expired
  bookings. This is not an upcoming-meetings count.
- **Lifetime confirmations:** bookings confirmed at least once, including later
  cancellations. Approval history is durable independently of provider/email
  records. Cancellations, awaiting approval, declines, and expirations are separate.
- **Accepted requests:** committed public booking attempts, including pending
  approval and later terminal outcomes. Failed/uncertain provider attempts are
  excluded. Retries and reschedules never create another accepted request.
- **Conversion:** distinct visits that produced a confirmed booking divided by
  visits within the same attribution coverage period. A visit converts at most
  once; later cancellation does not erase a historical conversion. Historical
  bookings without visit attribution are excluded from both sides of conversion.

The public app uses an in-memory UUID, no cookies or fingerprinting. Transient
tracking failures retry with that same UUID, and reconnect/visibility changes
retry undelivered stages. Verified booking submissions store visit attribution
atomically and repair missing earlier stages. Legacy clients can still book
without a visit ID. Pre-tracking traffic cannot be reconstructed from bookings
and is explicitly labelled unavailable. The v1 endpoint preserves lifetime
confirmation semantics for older organizer packages during upgrades.

#### Production rollout

Run all three applications' tests/typechecks and build their production artifacts.
The current release needs all migrations through 0019, including 0016 (Zoom),
0017 (traffic), and 0018 (collective bookings). Apply migrations before the gateway; deploy the public app
before publishing the organizer package:

```sh
CLOUDFLARE_ACCOUNT_ID=b848db7e2edd56dee8ffcc39c18612a5 pnpm --filter @tap-examples/tap-calendar-gateway migrate:production
pnpm --filter @tap-examples/tap-calendar-gateway deploy:production
pnpm --filter @tap-examples/tap-calendar-public deploy:production
pnpm --filter @tap-examples/tap-calendar build:miniapp:production
pnpm --filter @tap-examples/tap-calendar publish:production
```

`publish:production` refuses to publish until the live gateway readiness endpoint
confirms v2 and its migration, the served public app contains tracking, and the
built organizer package contains v2 and the production gateway. It makes no
analytics writes. `test:release` tests the guard. Upgrade the existing marketplace
installation to the published release; preserve its package and installation
identity so organizer settings and booking profiles remain intact.

Verify that the installed organizer displays current and lifetime counts matching
the server ledger, then exercise a public visit through the details step. Do not
send a real booking/email merely to test analytics; the gateway integration suite
covers confirmed, pending, approved, cancelled, and retried provider outcomes.

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
