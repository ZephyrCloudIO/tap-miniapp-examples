# TAP Calendar Gateway

This package is the locally runnable Cloudflare Worker boundary for TAP Calendar. It persists provider connections, discovered calendars, revisioned event-cache generations, Google sync cursors, and webhook channels in D1. It also exposes a no-secret local connector for end-to-end miniapp development, OAuth authorization-code + PKCE adapters for Google Calendar and Microsoft 365, and a separate user-managed Zoom OAuth connection for real Zoom conferencing.

## Workspace bookings

Migration `0018_collective_workspace_bookings.sql` adds workspace-owned profile
definitions, self-enrolled host policies, actor audit records, and transactional
host reservations. The public routes retain `/{profileNamespace}/{eventType}`.
Workspace ownership is bound to the canonical workspace ID; the public name
is a namespace claim, not proof of a legal organization or a verified domain.
The workspace owns one profile, with up to 20 meeting types and ten required
hosts per meeting.

- `GET /v1/workspace-bookings` returns the caller's host settings and pending
  shared-meeting approvals. Workspace managers also receive the shared profile,
  enrolled eligible hosts, publication receipt, and host-policy freshness.
- `POST /v1/workspace-bookings/host` enrolls/updates/disables the authenticated
  caller only, with `expectedVersion`. Invite email comes from the connected
  account's discovered owned Google primary calendar, never a supplied email.
- `POST /v1/workspace-bookings/profile` saves and publishes/unpublishes the
  workspace profile with `expectedVersion`. Every event carries `hostIds` and
  `organizerId`; the organizer must be one of those hosts.

Production calls use the existing JWT subject-to-canonical-user check and
`AUTHZ_API.checkWorkspacePrincipalActions({ organizationId, userId, actions })`.
Profile management requires `workspace:manage` (owner/admin in the default
policy). Every host must remain a member with `workspace:read`, own a connected
Google calendar, and explicitly enable this workspace's shared bookings.
Provider credentials always retain their real authorizing principal. The
registry-only `workspace:{workspaceId}` owner key never authorizes provider I/O.
Missing Authz service capabilities, missing calendars, revoked consent, and
partial provider results fail closed.

Reservations cover every host, including individual/native booking commits.
D1 rejects overlapping host reservations in one transaction across different
organizers. Stored buffers remain occupied, and calendar invitation delivery
is not the reservation mechanism. Pending/uncertain provider writes remain
reserved. Rescheduling retains old/new times during uncertainty, cancellation
releases all hosts, and declined/expired holds release their reservations.
Removing an organizer calendar is blocked while it owns active future shared
bookings, because deleting its commit rows would discard other hosts' holds.
An external calendar writer can still race the final provider check; Google
has no atomic availability-and-insert operation across accounts.

Host settings are published snapshots. Updating/revoking a host invalidates
links using the old policy until a manager refreshes the publication. Failed
publication leaves a recoverable draft. `definition_version` identifies the
settings that actually published; `hosts_current` detects stale enrollment.
The UI offers event-link copying only for confirmed, current settings.
Unpublishing remains possible after a host leaves or disables participation.

Deployment order:

1. Apply all D1 migrations, including `0019`, before deploying this gateway.
2. Deploy the gateway and public site, and publish the rebuilt Calendar miniapp.
3. Verify the production Authz RPC includes `checkWorkspacePrincipalActions`.
   Google OAuth now also requests `calendar.events.freebusy`; reconnect accounts
   whose existing grants cannot read selected shared Conflict Calendars.
4. Each host connects their own Google account and enables shared bookings in
   the target workspace. A manager claims an available namespace and publishes
   the meeting. These consent steps cannot be replaced by entering host emails.

No production migration, deployment, namespace claim, or host enrollment is
performed by building or running the test suite.

## Booking notes and additional guests

The public booking POST accepts optional `notes` (up to 2,000 characters) and
`additionalGuests` (up to 10 email addresses). Addresses are normalized and
deduplicated against the primary guest. Both fields are captured in the original
booking attempt and included in its request hash, so retries cannot change the
notes or invitees of an existing booking. Empty fields preserve legacy hashes.
Notes are escaped before being included in the calendar event description;
additional guests receive calendar invitations through the existing provider
flow, including approval, reschedule, and cancellation updates. The secure
management link continues to go only to the primary guest.

Apply `0019_public_booking_details.sql` before deploying the gateway, then deploy
the public site and rebuilt Calendar miniapp. The gateway remains compatible
with existing clients that omit the new fields. The form and organizer preview
share the same inputs, privacy-policy notice, and validation limits.

## Booking analytics

`GET /v2/publications/analytics` returns authenticated individual-page totals for
one canonical workspace/user, plus generation and tracking coverage timestamps.
`confirmed` is current confirmed status; `lifetimeConfirmed` retains confirmation
history after cancellation/provider cleanup. `cancelled`, `pending`, `declined`,
and `expired` are separate. Conversion uses distinct confirmed visits and views
from the same coverage period, never historical booking counts divided by new
traffic. The v1 endpoint retains its original lifetime semantics for old clients.

Migration 0017 adds the anonymous visit ledger. Migration 0019 adds first-claim
visit attribution, durable first-confirmation history, transactional visit repair
for verified submissions, and explicit coverage metadata. It backfills lifetime
confirmation evidence from the existing booking, approval, and notification
records without inventing historical visitor activity. Apply migrations before
deploying. The public `GET /health/booking-analytics` reports only schema readiness
and coverage, never private metrics or identities.

`POST /api/public/pages/{profileSlug}/{eventTypeSlug}/analytics` accepts only a v4
UUID visit ID and a `views`, `slotViews`, or `starts` stage. Later stages imply
earlier ones; retries are idempotent. Guests cannot write booking counts. The
optional booking-request `visitId` is captured by the first durable claim and
cannot be reassigned on retry. Attribution contains no guest details or IPs.

See the Calendar README's production rollout sequence and release guard.

## Start it locally

From the repository root:

```bash
pnpm --filter @tap-examples/tap-calendar-gateway types
pnpm --filter @tap-examples/tap-calendar-gateway migrate:local
pnpm --filter @tap-examples/tap-calendar-gateway dev
```

Wrangler listens on `http://127.0.0.1:8787`. Useful probes:

```bash
curl http://127.0.0.1:8787/health
curl http://127.0.0.1:8787/v1/providers
```

The `dev` script enables Wrangler's scheduled-test route. Trigger a repair cycle locally with `curl http://127.0.0.1:8787/cdn-cgi/handler/scheduled`.

Every organizer route requires the trusted TAP surface identity. In local
development the miniapp sends both `X-TAP-Workspace-Id` and
`X-TAP-Principal-Id`; the latter is the canonical `context.userId` supplied by
the host. In production the miniapp sends the host-managed `platform-session`
Bearer credential. The Worker validates its Auth0 issuer/audience and asks the
`AUTHZ_API` service binding to resolve the external subject to the canonical TAP
user and verify workspace access. Caller-supplied principal headers are never
production authority. For example, the local-only bridge is:

```bash
curl \
  -H 'X-TAP-Workspace-Id: local-preview' \
  -H 'X-TAP-Principal-Id: user-local-preview' \
  http://127.0.0.1:8787/v1/connections
```

The local connector works with no secrets. It deliberately identifies its connection mode as `local`; it does not pretend that Google, Microsoft, Apple, or Zoom granted access.

## Enable real Google, Microsoft, or Zoom authorization

Copy `.dev.vars.example` to `.dev.vars`, then set a random 32-byte base64 `TOKEN_ENCRYPTION_KEY` plus the chosen provider client ID and secret. `.dev.vars` files are ignored by Git. Register these exact local callback URLs with the providers:

- `http://127.0.0.1:8787/v1/oauth/google/callback`
- `http://127.0.0.1:8787/v1/oauth/microsoft/callback`
- `http://127.0.0.1:8787/v1/oauth/zoom/callback`

Zoom must be configured as a **user-managed OAuth app**, because each TAP user authorizes their own Zoom account. In the Zoom app's OAuth Information and allow-list settings, enable strict URL matching and register the callback for the credentials being used:

- Development: `http://127.0.0.1:8787/v1/oauth/zoom/callback`
- Production: `https://calendar-api.theaiplatform.app/v1/oauth/zoom/callback`

Grant exactly these Zoom granular scopes:

- `user:read:user` — verify and label the connected Zoom user.
- `meeting:write:meeting` — create scheduled meetings for that user.
- `meeting:update:meeting` — keep Zoom in sync when a TAP booking is rescheduled.
- `meeting:delete:meeting` — remove Zoom meetings when TAP bookings are cancelled.

Zoom issues separate development and production credentials. Use the corresponding `ZOOM_CLIENT_ID` and `ZOOM_CLIENT_SECRET`; a Zoom app in local-test/beta state is limited to users in the developer's Zoom account, so authorizing external customer accounts also requires completing Zoom's production distribution flow. Zoom derives the requested permissions from the scopes configured on the app and the gateway rejects a completed authorization if any required scope is missing.

For the production Worker, `PUBLIC_BASE_URL` must remain `https://calendar-api.theaiplatform.app`, because the gateway derives the callback from that origin. Store the two Zoom credentials as Worker secrets without replacing the existing `TOKEN_ENCRYPTION_KEY`:

```bash
pnpm --filter @tap-examples/tap-calendar-gateway exec wrangler secret put ZOOM_CLIENT_ID --env production
pnpm --filter @tap-examples/tap-calendar-gateway exec wrangler secret put ZOOM_CLIENT_SECRET --env production
```

Apply the additive Zoom schema before deploying code that reads it, then deploy the Worker:

```bash
pnpm --filter @tap-examples/tap-calendar-gateway migrate:production
pnpm --filter @tap-examples/tap-calendar-gateway deploy:production
```

Migration `0016_zoom_meeting_provider.sql` stores per-principal Zoom connections, single-use OAuth state, rotating-token refresh leases, and meeting-operation recovery state. Do not rotate `TOKEN_ENCRYPTION_KEY` in place: existing calendar and Zoom credentials depend on it.

Tokens and PKCE verifiers are AES-256-GCM encrypted before they enter D1. OAuth state is hashed, expires after ten minutes, and is consumed once. Google discovery reads `users/me/calendarList`; Microsoft discovery reads `/me` and `/me/calendars` and includes calendars shared with the signed-in user.

Zoom is a meeting provider, not a calendar source. A Google Destination Calendar is still required to own the event and availability workflow. When Zoom is selected, TAP creates a scheduled meeting under the connected Zoom user, attaches only the validated attendee `join_url` to the Google event, and keeps the Zoom meeting aligned with TAP reschedules and cancellations. It never exposes Zoom's host-only `start_url`. Approval holds do not create a Zoom meeting until approval. Disconnect is blocked while the connection still owns future Zoom bookings.

Set `PUBLIC_BASE_URL` to the gateway's exact public HTTPS origin to enable Google push-channel registration, for example `https://calendar-gateway.example.com`. Leave it empty for localhost. Google does not send notifications to HTTP endpoints. Each webhook channel uses a random token whose hash—not plaintext—is stored in D1; notifications must match the channel ID, token, resource ID, and expiration before they may schedule an incremental sync. Channels are renewed before expiration.

Apple iCloud is reported separately because Apple does not expose the same public OAuth Calendar API. This build advertises the app-specific-password boundary but does not yet collect or store an Apple credential. Exchange Server and ICS are also reported as unavailable adapters rather than silently creating fake provider sessions.

## Security boundary

The `dev` script injects `LOCAL_DEVELOPMENT=true` only into the local Wrangler
process; it is not committed as a deploy-time Worker variable. `workers_dev` is
disabled, every organizer route requires the exact `X-TAP-Workspace-Id` header,
and CORS is limited to declared TAP/preview origins. Production organizer calls
also require a verified TAP platform session and canonical workspace access;
missing JWT/Authz configuration fails closed. The miniapp manifest permits the
credential only for the exact organizer origin
`https://calendar-api.theaiplatform.app`.

The TAP host also checks `calendar.publish` before the miniapp makes a
publication request. The current platform-session credential proves the user
and workspace to the Worker, but it does not yet carry a signed package/action
attestation. Until the host can mint an action-scoped downstream assertion, the
Worker cannot independently prove that specific host permission decision; it
must not accept a client-supplied replacement header as authority.

`POST /v1/publications/profiles` and
`POST /v1/publications/profiles/unpublish` are organizer-only. They reserve a
bounded global/profile-local namespace and transition the entire active Event
Type set in one generation-checked D1 batch. Guest-safe and private routing
snapshots are separated.

The anonymous surface exposes only guest-safe data:

- `GET /api/public/pages/:profileSlug/:eventTypeSlug` resolves one currently
  published revision.
- `GET /api/public/pages/:profileSlug/:eventTypeSlug/availability` requires the
  displayed revision, checks all server-owned conflict calendars with Google
  FreeBusy, and returns short-lived signed slot proofs containing no owner or
  calendar identifiers.
- `POST /api/public/pages/:profileSlug/:eventTypeSlug/bookings` verifies the
  slot proof and Cloudflare Turnstile server-side, rechecks the live provider
  calendars under owner/calendar serialization, and commits one idempotent
  Google event. Anonymous headers never select the TAP owner or destination.

Booking request IDs and slot-proof uses are claimed atomically in D1. Provider
operation IDs are deterministic, so an ambiguous Google response can be
recovered without creating a second event. Guest management bearer tokens are
derived deterministically but only their SHA-256 hashes are stored; replayed
booking responses reconstruct the same management URL from the Worker secret.
The management URL is reserved for the cancel/reschedule phase and is not yet a
functional endpoint.

Production requires four secrets: `PUBLIC_TURNSTILE_SITE_KEY`,
`TURNSTILE_SECRET_KEY`, `PUBLIC_BOOKING_SLOT_SIGNING_KEY`, and
`PUBLIC_BOOKING_MANAGEMENT_SECRET`. Keep both signing secrets independent and
at least 32 random bytes. Availability and booking routes use separate Worker
rate-limit bindings. Turnstile is always verified through Siteverify; the UI
result alone is never trusted.

Provider connections, OAuth state, availability confirmations, booking commits,
booking locks, and approval resolutions are owned by a canonical TAP principal
inside the workspace. Reads and writes include both identifiers. OAuth callback
ownership comes only from the single-use server-stored state record, never from
a callback query/header. Calendar/watch/cache rows remain descendants of a
globally unique connection/calendar ID and can be reached only through an
owned connection join. Those IDs are generated UUID/opaque identifiers; a
cross-principal collision is rejected atomically and cannot replace, reveal, or
mutate the existing owner's row. Durable idempotency and lock primary keys also
include the principal, so two users in one workspace may safely use the same
client idempotency key. A booking lock is acquired only after its globally
unique destination calendar has been resolved through that principal's owned
connection.

No team-owned authorization model is implied here. A provider calendar shared
with a person is still stored under the TAP principal who connected it. A future
team-owned calendar mode needs an explicit owner type, membership ACL, and
authorization checks before it can share state or provider-write authority.

`POST /mcp` follows the MCP `2025-11-25` Streamable HTTP JSON-RPC request shape
for `initialize`, `tools/list`, and `tools/call`. Local development accepts the
exact workspace/principal bridge; production requires the same verified TAP
platform session and workspace authorization as other organizer routes. The
tools are:

- `list_events`: cache-backed event listing with details always redacted under the current permission.
- `find_available_slots`: proposes slots only when every requested calendar has complete, fresh cache proof.
- `draft_meeting`: creates an unpersisted draft only when the same authoritative-cache check passes.

The legacy `/mcp` route never returns attendee identities, locations, linked TAP content, or provider event titles under this generic local permission, even if a caller supplies an `includeDetails` argument. Event lists are capped at 200 items and draft conflicts at 50; truncation is explicit.

The separate OAuth-protected `/mcp/live` route supports individual event details,
direct creation, and aggregate analytics with explicit account scopes and live
workspace-membership checks. It uses D1 grants and configuration from migration
`0020_calendar_live_mcp.sql` and the `OAUTH_KV` namespace. The OAuth wrapper retains
all existing HTTP routes and scheduled work. See [deployment, consent, tool
semantics, and tests](../../docs/calendar-live-mcp.md) before rollout.

## One-time adoption of pre-principal local data

Migrations `0010_principal_ownership.sql` and
`0011_principal_idempotency_keys.sql` deliberately leave old owner-less rows
unclaimed. Adoption requires naming the one original local owner explicitly;
the gateway never assigns workspace-wide history to whichever member opens the
app first. Use this two-build procedure only for an existing local development
database:

1. Stop TAP Calendar and Wrangler. Back up the local Wrangler D1 persistence
   directory if the data matters.
2. Apply the migrations with
   `pnpm --filter @tap-examples/tap-calendar-gateway migrate:local`.
3. Build one temporary package with the original owner's canonical TAP user id:

   ```bash
   TAP_CALENDAR_LEGACY_OWNER_PRINCIPAL_ID='<canonical-user-id>' \
     pnpm --filter @tap-examples/tap-calendar build:miniapp
   ```

4. Run Wrangler temporarily with the same owner:

   ```bash
   pnpm --filter @tap-examples/tap-calendar-gateway exec wrangler dev \
     --test-scheduled --ip 127.0.0.1 --port 8787 \
     --var LOCAL_DEVELOPMENT:true \
     --var LEGACY_OWNER_PRINCIPAL_ID:'<canonical-user-id>'
   ```

   Keep provider secrets in `.dev.vars`; do not put them on the command line.
5. Install/open that temporary package once as that exact user. The miniapp
   CAS-copies legacy state, event cache, and provider booking outbox into
   `users/<canonical-user-id>/...`; the gateway atomically assigns legacy root
   records and assigns dependent rows only through ownership joins. Every other
   principal receives a mismatch error and sees none of the data.
6. Verify the personal TAP storage keys exist and that the six tables introduced
   in migration 0010 have no `principal_id IS NULL` rows for the local
   workspace. Do not delete the legacy TAP keys until recovery/outbox behavior
   has been exercised successfully.
7. Stop both processes. Rebuild the final installable package with
   `TAP_CALENDAR_LEGACY_OWNER_PRINCIPAL_ID` unset, and restart Wrangler without
   `LEGACY_OWNER_PRINCIPAL_ID`. Reinstall the clean package.

The two owner variables are intentionally different build/runtime controls.
Neither belongs in a customer artifact, committed `.dev.vars`, deployed Worker,
or normal development command. A new or already-principalized installation
must leave both unset.

## Event cache and query contract

Google calendars receive a bounded rolling initial sync covering 31 days of history and up to 180 days in the future, then incremental syncs using Google's `syncToken`. If a very busy calendar still exceeds the bounded page/event budget, bootstrap retries with 90- and then 30-day future windows. The upper bound prevents expanded recurring events on long-lived calendars from turning bootstrap into an unbounded full-history walk. D1 records the exact successful coverage bounds, and the gateway stages a fresh rolling generation before fewer than 14 future days remain or when an in-policy query needs broader coverage. Queries outside the declared coverage fall back to the bounded live provider path instead of treating the cache as complete. Deleted/cancelled events become tombstones. A `410 Gone` token response stages a new safe rolling sync generation. Both full and incremental changes are written into an inactive generation; D1 switches `active_generation` and increments the monotonic `cache_revision` only after all pages are committed. Provider rediscovery upserts surviving calendar rows, so it does not cascade-delete their cache; only calendars actually removed by the provider are deleted.

`POST /v1/events/query` accepts `timeMin`, `timeMax`, `calendarIds`, and optional `revalidate`:

- `wait` (the default) returns an existing D1 slice after a stale/due calendar has completed a bounded incremental refresh. Use this for the visible range so the UI repaints with the committed revision.
- `background` returns a usable D1 slice immediately and schedules stale-while-revalidate with `ExecutionContext.waitUntil`. MCP `list_events` and cache-only consumers use this mode; slot finding and meeting drafts use `wait` before enforcing fresh proof.

The original `events`, `errors`, `truncated`, and `syncedCalendarIds` fields remain. `servedCalendarIds` identifies every complete slice actually returned, while `syncedCalendarIds` identifies only calendars freshly synchronized from a provider during that request. `cache.calendars[]` supplies `calendarId`, `cacheRevision`, effective `freshness`, `coverageTimeMin`, `coverageTimeMax`, `coversRequestedRange`, `lastSuccessAt`, `nextSyncAt`, and the last refresh error. A stale/error cache that still has safe range coverage remains servable and is identified honestly in proof/errors instead of blanking the calendar; a live fallback leaves `coversRequestedRange: false` on the cache proof.

The five-minute cron processes a deterministic, bounded batch of 20 due calendars, respecting per-calendar leases and retry backoff. Within each request or cron invocation, provider authorization is coalesced by workspace/connection so calendars on one account share a single token refresh. Google notifications move only the notified calendar to the front of the repair queue and trigger the same leased incremental-sync path.

## Live availability routes

- `POST /v1/availability/validate` bypasses D1 and reads every requested provider calendar live. It returns `available`, `conclusive`, conflicts, and provider errors.
- `POST /v1/availability/confirm` first replays an identical committed idempotency result when present. For a new key it refreshes stale/incomplete cache state, then rereads every provider live regardless of any client-observed cache revision. `idempotencyKey` records a stable availability-validation result and rejects reuse for different inputs.

The latter is an idempotent **availability confirmation record**, not a provider event write, booking transaction, or concurrency lock. Its affirmative field is `availabilityConfirmed`; callers must still create the meeting through a provider-aware workflow and should validate again if that creation is delayed.

An available slot returns `200` with `availabilityConfirmed: true`, `available: true`, `conclusive: true`, `confirmationId`, the validated range, live-source metadata, and `idempotentReplay`. An unavailable slot returns the stable `409` body `{ "error": "slot_conflict", "message": "That time is no longer available." }`; an identical idempotency replay returns that same status and body.

## Provider booking commits and approval holds

`POST /v1/bookings/commit` is the Google provider-write boundary. It accepts:

```json
{
  "destinationCalendarId": "calendar-id",
  "conflictCalendarIds": ["calendar-id"],
  "idempotencyKey": "stable-client-key",
  "title": "Customer call",
  "start": "2026-08-20T18:00:00Z",
  "end": "2026-08-20T18:30:00Z",
  "conflictTimeMin": "2026-08-20T17:45:00Z",
  "conflictTimeMax": "2026-08-20T18:40:00Z",
  "bookingKind": "meeting",
  "attendeeEmails": ["guest@example.com"],
  "conferenceProvider": "google-meet"
}
```

`conflictTimeMin` and `conflictTimeMax` are an optional pair for buffer-aware validation. If omitted, both default to `start` and `end`. If supplied, both must be RFC 3339 instants, the range must contain the complete booking (`conflictTimeMin <= start < end <= conflictTimeMax`), and it is subject to the same bounded 93-day query limit. TAP overlap checks and the final provider-live conflict read use this expanded range, while the Google event is always written with the original `start` and `end`. The expanded range is part of the idempotency request and remains attached to an approval hold for its final live recheck.

`bookingKind` is `meeting`, `approval-hold`, or `work-block`. `conferenceProvider` is optional and may be `none` (the default), `google-meet`, or `zoom`; every other value is rejected rather than implied to be provisioned. Google Meet and Zoom are available only for meetings. Google Meet uses a deterministic conference request ID and `conferenceDataVersion=1`. The gateway reports `providerJoinUrl` only after Google returns an actual Meet video entry point; while Google is still creating the conference it returns `conferenceStatus: "pending"` and does not label the event as Google Meet. For Zoom, a connected per-user Zoom account is required. The gateway creates the Zoom meeting first, saves its validated `join_url` as the Google event location, and stores the Zoom meeting ID in private Google event properties so subsequent lifecycle operations can prove what they own. Calendar HTML links are accepted only from the exact Google Calendar HTTPS origins and paths. Join links are accepted only from the exact `https://meet.google.com` origin or an HTTPS `zoom.us`/`*.zoom.us` host with a canonical `/j/{meetingId}` path. HTTP, script URLs, credentials, fragments, deceptive subdomains, unexpected query parameters, and unrelated HTTPS origins are discarded. `providerJoinUrl` and `providerHtmlLink` remain stable in the durable idempotency response; treat both as capability-bearing private booking data and do not log them.

For a new key, the gateway acquires short D1 leases for every calendar in the caller's conflict set in deterministic order, rejects overlap with earlier TAP commits, reads every conflict provider live, and only then inserts the destination Google event. The Google event uses a deterministic provider ID plus private TAP request proof, so a same-key retry can recover a successful insert even when the original HTTP response was lost. A successful write is staged into a new revisioned D1 cache generation and that calendar is marked immediately due for incremental reconciliation. The response is `201` with the committed provider event projection; an identical replay is `200` with `idempotentReplay: true`. Reusing the key for different input, an active TAP lease, and a stale slot are distinct `409` responses. Provider/read uncertainty fails closed.

This boundary serializes cooperating TAP requests whose complete conflict-calendar sets overlap. It cannot make Google's separate free/busy read and event insert atomic against a person, another application, or any out-of-band provider writer; Google exposes no transaction spanning those operations. The destination event itself is the immediate provider reservation, so the remaining race is stated rather than hidden.

Recover an uncertain commit or delayed Google Meet URL with the workspace-authenticated `GET /v1/bookings/{idempotencyKey}/status`. The lookup is scoped by both workspace and idempotency key, loads the durable request, fetches the current Google event, and verifies its private TAP commit proof. Its response wraps the original/enriched `CalendarGatewayBookingCommit` under `commit` (always with `idempotentReplay: true`), an explicit `lifecycle` (`active`, `approved`, `declined`, or `expired` with resolution time and removal state), and `currentEvent`. A verified conference that has become ready enriches the immutable commit projection's `providerJoinUrl` and `conferenceStatus`, including on an approval hold that gained Google Meet or Zoom during approval; the final confirmed meeting is exposed separately as `currentEvent`. Declined and expired holds use their already-verified durable terminal transition and return `currentEvent: null`, rather than treating the intentional provider deletion as a proof failure. The status read never changes booking, resolution, idempotency, or event-cache state; an unexpected missing active/approved event or mismatched proof fails closed. The private canonical `request_json` stored with new commits exists only to reconstruct a verified response after an ambiguous write and must not be logged or exposed independently.

An `approval-hold` requires `expiresAt` (a future RFC 3339 instant no more than 30 days away) and creates a private, opaque, tentative Google event. It may accept `attendeeEmails`, but those addresses are stored only in the authorization-protected D1 commit projection as `pendingAttendeeEmails`; they are not sent to Google or invited until approval. Commit responses are immutable: replaying the hold's commit key always returns its original pending projection, while resolution state and replay live on the resolution endpoint. Resolve with `POST /v1/bookings/{bookingIdempotencyKey}/resolve`:

```json
{
  "idempotencyKey": "stable-resolution-key",
  "decision": "approve",
  "title": "Partner review",
  "attendeeEmails": ["partner@example.com"],
  "conferenceProvider": "google-meet",
  "conflictCalendarIds": ["calendar-id", "newly-enabled-calendar-id"]
}
```

The commit stores the canonical, sorted conflict-calendar set with the hold. `approve` forms the sorted union of that snapshot and the caller's required current `conflictCalendarIds`, validates every connected calendar, acquires every union lock, rechecks the union live, excludes only the original destination hold from that check, and fails closed if any slice is missing or inconclusive. It then patches the same reserved provider event to confirmed, uses the durable pending invitees when `attendeeEmails` is omitted (or the explicitly supplied audited set when present), optionally creates Google Meet or Zoom, preserves TAP proof, and sends Google attendee updates. `decline` needs only the destination lock and does not require legacy conflict metadata; it deletes the tentative provider event and tombstones it in the cache.

Each resolution is single-decision and idempotent: an identical replay does no provider work, a conflicting decision/key is rejected, and an ambiguous provider mutation is recovered from private resolution proof. Definite failures before any PATCH/DELETE—lock contention, a new conflict, missing calendar, or partial provider read—do not persist a pending resolution, so the hold can still be declined or approved later. A missing, malformed, disconnected, noncanonical, or destination-free stored conflict set cannot be approved. Both decisions update separate durable resolution state and the revisioned event cache without mutating the original commit response. The same honest Google out-of-band concurrency boundary applies.

The five-minute scheduled handler also processes a bounded batch of expired unresolved holds. It verifies the original private provider proof, deletes the tentative Google event, tombstones the cache, and records `hold_expired_at` idempotently. Approve fails with `410 approval_hold_expired` after the deadline. A pending resolution whose provider mutation may already have occurred is deliberately excluded from automatic deletion until that exact resolution key recovers.
